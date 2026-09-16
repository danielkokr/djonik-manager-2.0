import Anthropic from "@anthropic-ai/sdk";

export interface DjonikSessionHandle {
  sessionId: string;
  send(text: string): Promise<string>;
  /** Aborts the session's open event stream so the process can exit cleanly. */
  close(): void;
}

export type DjonikTurnSource = "telegram" | "diagnostic" | "unknown";

export interface DjonikCumulativeUsage {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  listCostAmount?: string;
  listCostCurrency?: string;
}

/** Content-free summary emitted once per visible user turn when enabled by the caller. */
export interface DjonikTurnTelemetry {
  /** ISO 8601 UTC instant at which this completed visible turn was recorded. */
  recordedAt: string;
  source: DjonikTurnSource;
  sessionId: string;
  /** Reconciliation must only aggregate records with this explicit per-turn scope. */
  usageScope: "turn_delta";
  modelIterations: number;
  toolCalls: number;
  toolNames: string[];
  mcpResults: number;
  verificationNudges: number;
  skillRead: boolean;
  memoryRead: boolean;
  /** Per-visible-turn delta, never the session's cumulative usage snapshot. */
  usage: DjonikCumulativeUsage | null;
}

export interface DjonikTurnTelemetryCollector {
  recordModelIteration(): void;
  recordMcpToolUse(toolName: string): void;
  recordMcpResult(): void;
  recordBuiltInRead(input: Record<string, unknown>): void;
  recordVerificationNudge(): void;
  recordUsage(usage: {
    input_tokens?: number;
    cache_creation?: object | null;
    cache_read_input_tokens?: number;
    output_tokens?: number;
    list_cost?: { amount: string; currency: string } | null;
  }): void;
  summary(): DjonikTurnTelemetry;
  cumulativeUsage(): DjonikCumulativeUsage | null;
}

/** Aggregates event metadata only; it never accepts message, Memory, or MCP-result content. */
export function createTurnTelemetryCollector(
  source: DjonikTurnSource,
  sessionId: string,
  previousUsage: DjonikCumulativeUsage | null = null,
  now: () => string = () => new Date().toISOString(),
): DjonikTurnTelemetryCollector {
  let modelIterations = 0;
  const toolNames: string[] = [];
  let mcpResults = 0;
  let verificationNudges = 0;
  let skillRead = false;
  let memoryRead = false;
  let cumulativeUsage: DjonikCumulativeUsage | null = null;

  function delta(current: number | undefined, previous: number | undefined): number | undefined {
    if (current === undefined) return undefined;
    const result = current - (previous ?? 0);
    return result >= 0 ? result : undefined;
  }

  function listCostDelta(): Pick<DjonikCumulativeUsage, "listCostAmount" | "listCostCurrency"> {
    if (!cumulativeUsage?.listCostAmount || !cumulativeUsage.listCostCurrency) return {};
    if (
      previousUsage?.listCostCurrency !== undefined &&
      previousUsage.listCostCurrency !== cumulativeUsage.listCostCurrency
    ) return {};
    try {
      const result = BigInt(cumulativeUsage.listCostAmount) - BigInt(previousUsage?.listCostAmount ?? "0");
      return result >= 0n
        ? { listCostAmount: result.toString(), listCostCurrency: cumulativeUsage.listCostCurrency }
        : {};
    } catch {
      return {};
    }
  }

  function turnUsage(): DjonikCumulativeUsage | null {
    if (cumulativeUsage === null) return null;
    return {
      inputTokens: delta(cumulativeUsage.inputTokens, previousUsage?.inputTokens),
      cacheCreationInputTokens: delta(
        cumulativeUsage.cacheCreationInputTokens,
        previousUsage?.cacheCreationInputTokens,
      ),
      cacheReadInputTokens: delta(cumulativeUsage.cacheReadInputTokens, previousUsage?.cacheReadInputTokens),
      outputTokens: delta(cumulativeUsage.outputTokens, previousUsage?.outputTokens),
      ...listCostDelta(),
    };
  }

  return {
    recordModelIteration: () => { modelIterations += 1; },
    recordMcpToolUse: (toolName) => { toolNames.push(toolName); },
    recordMcpResult: () => { mcpResults += 1; },
    recordBuiltInRead: (input) => {
      const path = typeof input.file_path === "string" ? input.file_path : "";
      skillRead ||= /(?:^|\/)skills\//.test(path);
      memoryRead ||= /(?:^|\/)memory\//.test(path);
    },
    recordVerificationNudge: () => { verificationNudges += 1; },
    recordUsage: (nextUsage) => {
      const cacheCreationInputTokens = Object.values(nextUsage.cache_creation ?? {}).reduce(
        (sum, value) => sum + (typeof value === "number" ? value : 0),
        0,
      );
      cumulativeUsage = {
        inputTokens: nextUsage.input_tokens,
        cacheCreationInputTokens,
        cacheReadInputTokens: nextUsage.cache_read_input_tokens,
        outputTokens: nextUsage.output_tokens,
        listCostAmount: nextUsage.list_cost?.amount,
        listCostCurrency: nextUsage.list_cost?.currency,
      };
    },
    summary: () => ({
      recordedAt: now(),
      source,
      sessionId,
      usageScope: "turn_delta",
      modelIterations,
      toolCalls: toolNames.length,
      toolNames: [...toolNames],
      mcpResults,
      verificationNudges,
      skillRead,
      memoryRead,
      usage: turnUsage(),
    }),
    cumulativeUsage: () => cumulativeUsage === null ? null : { ...cumulativeUsage },
  };
}

/**
 * Thrown when the underlying Managed Session/event stream itself has died
 * (stream ended, session terminated, or a terminal session.error) rather than
 * an ordinary turn-level failure (e.g. unverified write, empty reply) where
 * the session is still usable for the next message. Callers that cache a
 * session (e.g. the Telegram adapter's one-session-per-process manager) can
 * use this to know the cached session must be discarded and reconnected,
 * without discarding it on every turn failure.
 */
export class DjonikSessionDeadError extends Error {}

/**
 * Optional observability hook for validation/debugging (e.g. Foundation 8 live
 * scenario traces). Purely informational — never consulted for verification
 * logic, which stays entirely in the event-stream handling below.
 */
export type DjonikTraceEvent =
  | { type: "mcp_tool_use"; serverName: string; toolName: string; input: Record<string, unknown> }
  | { type: "mcp_tool_result"; serverName: string; toolName: string; isError: boolean }
  | { type: "verification_nudge_sent"; attempt: number }
  | { type: "write_unverified_failure" };

/**
 * Session-specific guidance shown to the agent alongside the memory store's
 * name/description (see the store's own `description` for what it is).
 * Memory stores attach only at session creation time, so this text travels
 * with every new Djonik session rather than living in agent configuration.
 */
const DJONIK_MEMORY_INSTRUCTIONS =
  "Persistent PM memory across sessions. Write only durable, useful context: " +
  "stable work preferences, client/project facts, important decisions, recurring " +
  "patterns, PM lessons, plans the user has explicitly accepted (e.g. \"так, працюємо " +
  "за цим планом\"), and explicit personal/client commitments the user states (e.g. " +
  "\"я точно зроблю X до пʼятниці\"). Do not write every suggestion or provisional plan " +
  "as if it were accepted — only write an accepted plan or commitment when the user's " +
  "acceptance/commitment is actually explicit, not merely discussed. Do not store live " +
  "Trello/task state, transient chat, or anything trivial. An accepted plan or " +
  "commitment recorded here is historical/decision context, not live task state: fresh " +
  "external tool reads always outrank what is remembered here for current status. When " +
  "the user corrects or cancels an earlier accepted plan/commitment, update what is " +
  "remembered so the new version is current and the superseded one is no longer " +
  "presented as still active.";

/**
 * Deterministic backstop for the task-management Skill's verify-before-claiming-success
 * rule. The Skill asks Djonik to re-read a Trello object after every mutation before
 * replying, but a real Telegram turn proved instruction-following alone is not
 * reliable (Foundation 7 acceptance blocker: a `trelloWriteCard` call was followed by
 * a success reply with no `agent.mcp_tool_use` read call in between).
 *
 * This inspects the same `agent.mcp_tool_use` / `agent.mcp_tool_result` events the
 * session stream already emits — no custom Trello client, no stored task state, no
 * intent router. It only tracks tool-call *shape*: which write tool ran, the object id
 * it names, and whether a read of the matching type later names that same object id.
 * It never inspects mutated field values (title/desc/due/list) — whether the *content*
 * of a write was correct remains entirely the Skill's/Claude's job. This is identity
 * verification only: did a read of the same object happen, not was the write right.
 */
const TRELLO_MCP_SERVER_PATTERN = /trello/i;
const TRELLO_WRITE_TOOL_PATTERN = /^trelloWrite/;
const TRELLO_READ_TOOL_PATTERN = /^trelloRead/;

function isTrelloWriteTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_WRITE_TOOL_PATTERN.test(toolName);
}

function isTrelloReadTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_READ_TOOL_PATTERN.test(toolName);
}

/**
 * For each Trello write tool whose input names an object id, the read tool + input
 * field that must name the *same* id to count as verification. A write tool absent
 * from this map (none currently — only `trelloWriteCard` is enabled per Foundation 7)
 * falls back to the looser "any successful Trello read clears it" behavior, since no
 * identity field is known to check.
 */
const CARD_OBJECT_ID_VERIFICATION = {
  writeTool: "trelloWriteCard",
  writeIdField: "cardId",
  readTool: "trelloReadCard",
  readIdFields: ["cardIdOrUrl", "cardId"],
} as const;

function readStringField(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The object id a write tool call names, or null if this write tool has no known identity field. */
function writeObjectId(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === CARD_OBJECT_ID_VERIFICATION.writeTool) {
    return readStringField(input, CARD_OBJECT_ID_VERIFICATION.writeIdField);
  }
  return null;
}

/**
 * Whether a successful read call verifies the given pending write: same write/read
 * tool pairing (e.g. trelloWriteCard verified only by trelloReadCard, never by
 * trelloReadBoard/trelloSearch/etc.) and the read names the exact same object id.
 */
function readVerifiesWrite(
  pendingWriteTool: string,
  pendingObjectId: string,
  readToolName: string,
  readInput: Record<string, unknown>,
): boolean {
  if (pendingWriteTool !== CARD_OBJECT_ID_VERIFICATION.writeTool) return false;
  if (readToolName !== CARD_OBJECT_ID_VERIFICATION.readTool) return false;
  return CARD_OBJECT_ID_VERIFICATION.readIdFields.some(
    (field) => readStringField(readInput, field) === pendingObjectId,
  );
}

const VERIFICATION_NUDGE_TEXT =
  "Системна перевірка: у цьому turn був виклик Trello write-інструменту без " +
  "наступного read-виклику САМЕ ТОГО Ж об'єкта (той самий cardId), що підтверджує " +
  "результат. Перш ніж відповідати користувачу, зроби окремий Trello read саме того " +
  "об'єкта, який ти щойно змінив, і повідом користувачу підтверджений результат (або " +
  "скажи чесно, якщо перевірка показала розбіжність).";

const MAX_VERIFICATION_NUDGES = 1;

type SendableEvent = { type: "user.message"; content: Array<{ type: "text"; text: string }> };

/**
 * Connects to the already-existing Djonik Managed Agent (Claude Console is
 * the authoritative runtime/configuration for the agent itself) by starting
 * one Managed Agent Session against `agentId` + `environmentId`, then opens
 * that session's event stream once. `send()` reuses the same session/stream
 * for every turn, so conversational continuity is the official Managed
 * Agents Session primitive — this client never builds or replays its own
 * message history.
 *
 * The Djonik Memory Store is attached as a `memory_store` session resource
 * with `read_write` access, since memory stores can only be attached at
 * session creation time (not added to a running session).
 *
 * The Djonik Personal Vault is passed via `vault_ids` so the session's
 * attached MCP servers (Trello, Google Calendar) can authenticate; without
 * it every new session emits `mcp_authentication_failed_error` events for
 * those servers.
 */
export async function connectToDjonik(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  memoryStoreId: string,
  vaultId: string,
  onTrace?: (event: DjonikTraceEvent) => void,
  onTurnTelemetry?: (telemetry: DjonikTurnTelemetry) => void,
  turnSource: DjonikTurnSource = "unknown",
): Promise<DjonikSessionHandle> {
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    vault_ids: [vaultId],
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: "read_write",
        instructions: DJONIK_MEMORY_INSTRUCTIONS,
      },
    ],
  });

  const stream = await client.beta.sessions.events.stream(session.id);
  const iterator = stream[Symbol.asyncIterator]();

  /**
   * Correlates `agent.mcp_tool_result` events back to the tool call that produced
   * them (results only carry `mcp_tool_use_id`, not the tool name/server/input).
   * Scoped to one `send()` call — cleared at the start of each.
   */
  const mcpToolCallsById = new Map<string, { serverName: string; toolName: string; input: Record<string, unknown> }>();
  /** True from a successful Trello write until a verifying read of the same object is observed. */
  let unverifiedTrelloWrite = false;
  /** Which write tool is pending verification, so a read can be checked against the right pairing. */
  let pendingWriteTool: string | null = null;
  /** The object id the pending write named, or null when this write tool has no known identity field
   *  (falls back to "any successful Trello read clears it"). */
  let pendingWriteObjectId: string | null = null;
  let turnTelemetry: DjonikTurnTelemetryCollector | null = null;
  /** Session usage events are cumulative; this is the completed-turn baseline. */
  let previousSessionUsage: DjonikCumulativeUsage | null = null;

  async function runTurn(events: SendableEvent[]): Promise<string> {
    await client.beta.sessions.events.send(session.id, { events });

    let reply = "";

    for (;;) {
      const { value: event, done } = await iterator.next();
      if (done) {
        throw new DjonikSessionDeadError("Djonik session event stream ended unexpectedly.");
      }

      switch (event.type) {
        case "agent.message":
          reply = event.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("");
          break;
        case "agent.mcp_tool_use":
          mcpToolCallsById.set(event.id, {
            serverName: event.mcp_server_name,
            toolName: event.name,
            input: event.input as Record<string, unknown>,
          });
          onTrace?.({
            type: "mcp_tool_use",
            serverName: event.mcp_server_name,
            toolName: event.name,
            input: event.input as Record<string, unknown>,
          });
          turnTelemetry?.recordMcpToolUse(event.name);
          break;
        case "agent.mcp_tool_result": {
          const call = mcpToolCallsById.get(event.mcp_tool_use_id);
          if (call) {
            onTrace?.({
              type: "mcp_tool_result",
              serverName: call.serverName,
              toolName: call.toolName,
              isError: Boolean(event.is_error),
            });
            turnTelemetry?.recordMcpResult();
          }
          if (call && !event.is_error) {
            if (isTrelloWriteTool(call.serverName, call.toolName)) {
              unverifiedTrelloWrite = true;
              pendingWriteTool = call.toolName;
              pendingWriteObjectId = writeObjectId(call.toolName, call.input);
            } else if (isTrelloReadTool(call.serverName, call.toolName) && unverifiedTrelloWrite) {
              if (pendingWriteObjectId !== null) {
                // Identity known: only a read of the exact same object verifies it.
                // An unrelated or mismatched-id read leaves the write unverified.
                if (
                  pendingWriteTool !== null &&
                  readVerifiesWrite(pendingWriteTool, pendingWriteObjectId, call.toolName, call.input)
                ) {
                  unverifiedTrelloWrite = false;
                  pendingWriteTool = null;
                  pendingWriteObjectId = null;
                }
              } else {
                // No identity field known for this write tool type: fall back to the
                // looser "any successful Trello read clears it" behavior.
                unverifiedTrelloWrite = false;
                pendingWriteTool = null;
              }
            }
          }
          break;
        }
        case "agent.tool_use":
          if (event.name === "read") {
            turnTelemetry?.recordBuiltInRead(event.input as Record<string, unknown>);
          }
          break;
        case "span.model_request_end":
          turnTelemetry?.recordModelIteration();
          break;
        case "session.usage":
          turnTelemetry?.recordUsage(event.usage);
          break;
        case "session.error":
          // "retrying" and "exhausted" are non-terminal per the Managed
          // Agents API: the session keeps running (or returns to idle to
          // accept a new prompt). Only "terminal" means the session itself
          // is dying. A turn that ends via "exhausted" with no assistant
          // message is still caught below by the empty-reply check on
          // session.status_idle.
          if (event.error.retry_status.type === "terminal") {
            throw new DjonikSessionDeadError(`Djonik session error: ${event.error.message}`);
          }
          break;
        case "session.status_terminated":
          throw new DjonikSessionDeadError("Djonik session terminated unexpectedly.");
        case "session.status_idle":
          if (!reply) {
            throw new Error("Djonik produced no text reply for this turn.");
          }
          return reply;
        default:
          break;
      }
    }
  }

  /**
   * Sends one user turn, then enforces verify-after-write deterministically:
   * if the turn ends with a successful Trello write and no successful Trello
   * read afterward, the reply is a false-success candidate. Rather than trust
   * the Skill's instruction-following alone (the Foundation 7 acceptance
   * blocker), nudge the agent once to verify and reply again in the same
   * session; if it still hasn't verified, fail the turn instead of returning
   * an unverified success claim to the user.
   */
  async function send(text: string): Promise<string> {
    unverifiedTrelloWrite = false;
    pendingWriteTool = null;
    pendingWriteObjectId = null;
    mcpToolCallsById.clear();
    turnTelemetry = createTurnTelemetryCollector(turnSource, session.id, previousSessionUsage);

    try {
      let reply = await runTurn([{ type: "user.message", content: [{ type: "text", text }] }]);

      for (let attempt = 0; unverifiedTrelloWrite && attempt < MAX_VERIFICATION_NUDGES; attempt += 1) {
        onTrace?.({ type: "verification_nudge_sent", attempt: attempt + 1 });
        turnTelemetry.recordVerificationNudge();
        reply = await runTurn([{ type: "user.message", content: [{ type: "text", text: VERIFICATION_NUDGE_TEXT }] }]);
      }

      if (unverifiedTrelloWrite) {
        onTrace?.({ type: "write_unverified_failure" });
        throw new Error(
          "Djonik mutated Trello but did not verify the write with an independent read in this turn.",
        );
      }

      return reply;
    } finally {
      const completedTelemetry = turnTelemetry.summary();
      previousSessionUsage = turnTelemetry.cumulativeUsage();
      onTurnTelemetry?.(completedTelemetry);
      turnTelemetry = null;
    }
  }

  function close(): void {
    stream.controller.abort();
  }

  return { sessionId: session.id, send, close };
}
