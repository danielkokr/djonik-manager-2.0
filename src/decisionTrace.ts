import { isTrelloReadTool, isTrelloWriteTool, TrelloMutationLedger, type MutationOutcome } from "./trelloMutationLedger.js";

export interface DecisionTrace {
  sessionTurnIndex: number;
  clockHeader?: string;
  toolNames: string[];
  skillPaths: string[];
  memoryPathsRead: string[];
  memoryPathsWritten: string[];
  cardIdsRead: string[];
  cardIdsWritten: string[];
  mutations: Array<{ cardIds: string[]; status: MutationOutcome["status"] }>;
  /** Present only when a source-aware lint was run. Absent means unknown, not "none". */
  unsupportedConcrete?: Array<{ type: string; value: string }>;
  answerKind?: "planning" | "task" | "rhythm" | "project_health";
}

function normalizedPath(input: unknown): { kind: "skill" | "memory"; path: string } | null {
  if (typeof input !== "string") return null;
  const path = input.replace(/\\/g, "/");
  const skill = path.match(/(?:^|\/)skills\/([a-z0-9-]+)\/SKILL\.md$/i);
  if (skill) return { kind: "skill", path: skill[1].toLowerCase() };
  const memory = path.match(/(?:^|\/)memory\/(?:[^/]+\/)?(.+)$/i);
  if (!memory || !/^[\p{L}\p{N}_./-]+$/u.test(memory[1]) || memory[1].includes("..")) return null;
  return { kind: "memory", path: memory[1] };
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

/** Accepts tool metadata only. Never retains arbitrary input values or result content. */
export class DecisionTraceCollector {
  private readonly value: DecisionTrace;

  constructor(sessionTurnIndex: number, clockHeader?: string) {
    this.value = {
      sessionTurnIndex, ...(clockHeader ? { clockHeader } : {}), toolNames: [], skillPaths: [], memoryPathsRead: [],
      memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [],
    };
  }

  builtIn(name: string, input: Record<string, unknown>): void {
    addUnique(this.value.toolNames, `builtin:${name}`);
    if (name !== "read" && name !== "write" && name !== "edit") return;
    const parsed = normalizedPath(input.file_path);
    if (!parsed) return;
    if (parsed.kind === "skill" && name === "read") addUnique(this.value.skillPaths, parsed.path);
    if (parsed.kind === "memory") addUnique(name === "read" ? this.value.memoryPathsRead : this.value.memoryPathsWritten, parsed.path);
  }

  mcp(server: string, name: string, input: Record<string, unknown>): void {
    addUnique(this.value.toolNames, `mcp:${name}`);
    if (!isTrelloReadTool(server, name) && !isTrelloWriteTool(server, name)) return;
    // Only a direct-card input field is an authoritative identity. Search query, name and prose are not.
    const raw = input.cardIdOrUrl ?? input.cardId;
    if (typeof raw !== "string") return;
    const urlId = raw.match(/^https:\/\/trello\.com\/c\/([A-Za-z0-9]+)(?:\/[^\s]*)?$/);
    const id = urlId?.[1] ?? (/^[\w-]{3,64}$/.test(raw) ? raw : null);
    if (!id) return;
    addUnique(isTrelloWriteTool(server, name) ? this.value.cardIdsWritten : this.value.cardIdsRead, id);
  }

  custom(name: string): void { addUnique(this.value.toolNames, `custom:${name}`); }

  finish(outcomes: readonly MutationOutcome[]): DecisionTrace {
    this.value.mutations = outcomes.map((outcome) => ({ cardIds: [...outcome.targetCardIds], status: outcome.status }));
    for (const outcome of outcomes) for (const id of outcome.targetCardIds) addUnique(this.value.cardIdsWritten, id);
    const names = this.value.skillPaths;
    this.value.answerKind = names.includes("project-health") ? "project_health"
      : names.includes("pm-rhythm") ? "rhythm"
      : names.includes("task-management") ? "task"
      : names.includes("planning-and-focus") ? "planning" : undefined;
    return structuredClone(this.value);
  }
}

/** Content-safe replay for one completed turn's already bounded events. */
export function explainRecordedTurn(events: readonly Record<string, unknown>[], turnIndex: number): DecisionTrace | null {
  let visible = 0;
  let collecting: DecisionTraceCollector | null = null;
  let ledger = new TrelloMutationLedger();
  let completedTarget = false;
  for (const event of events) {
    if (event.type === "user.message") {
      // A verification nudge is a second user.message, but never a new visible turn. The caller
      // supplies a bounded nudge classifier from the known runtime prefix below.
      const content = event.content;
      const text = Array.isArray(content) && typeof content[0]?.text === "string" ? content[0].text : "";
      if (text.startsWith("Системна перевірка: у цьому turn є Trello-запис")) continue;
      if (collecting && completedTarget) return collecting.finish(ledger.outcomes());
      visible += 1;
      collecting = visible === turnIndex ? new DecisionTraceCollector(turnIndex, text.startsWith("[Годинник адаптера") ? text : undefined) : null;
      ledger = new TrelloMutationLedger();
      completedTarget = false;
    }
    if (!collecting) continue;
    if (event.type === "agent.tool_use") collecting.builtIn(String(event.name ?? ""), (event.input ?? {}) as Record<string, unknown>);
    if (event.type === "agent.custom_tool_use") collecting.custom(String(event.name ?? ""));
    if (event.type === "agent.mcp_tool_use") {
      const server = String(event.mcp_server_name ?? "");
      const name = String(event.name ?? "");
      const input = (event.input ?? {}) as Record<string, unknown>;
      collecting.mcp(server, name, input);
      ledger.recordToolUse({ id: String(event.id ?? ""), serverName: server, toolName: name, input });
    }
    if (event.type === "agent.mcp_tool_result") ledger.recordToolResult(
      String(event.mcp_tool_use_id ?? ""), Boolean(event.is_error),
      event.content as Array<{ type: string; text?: string }> | undefined,
    );
    if (event.type === "session.status_idle" && (event.stop_reason as { type?: string } | undefined)?.type === "end_turn") completedTarget = true;
  }
  return collecting && completedTarget ? collecting.finish(ledger.outcomes()) : null;
}
