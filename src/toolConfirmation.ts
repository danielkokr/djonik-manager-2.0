import { isPermanentSendRejection } from "./customToolResolution.js";
import type { MutationAuthority } from "./turnAuthority.js";

/**
 * #39 Stage 3A: Session-scoped lifecycle of Managed Agents tool confirmations (`permission_policy:
 * always_ask`), keyed by the provider's blocking event id — the `agent.tool_use` / `agent.mcp_tool_use`
 * event id that `user.tool_confirmation.tool_use_id` answers (measured protocol: docs/63 §2–§3).
 *
 * A confirmation is PERMISSION TO ATTEMPT a server-executed tool, never evidence that it succeeded: an
 * allowed Trello write still goes through #31 target/result correlation and verify-after-write, and #32
 * `end_turn` completion, exactly as an `always_allow` write did before.
 *
 * The decision is made ONCE, when the gated tool-use event is observed, from the authority of the turn
 * that observed it, and is immutable for the Session: an id is never answered `allow` once and `deny`
 * later. Lifecycle per id:
 *
 *   DECIDED → SUBMITTED → RESOLVED            (RESOLVED = the provider echoed a matching confirmation)
 *   DECIDED → SEND_UNKNOWN                    (ambiguous send: never resent automatically)
 *   DECIDED → SEND_REJECTED                   (permanent API rejection)
 *   any     → CONTRADICTED                    (the provider echoed a different result for this id)
 *
 * `session.status_idle{requires_action}` is a level-triggered status, as for custom tools (#40): a
 * repeated idle naming an already SUBMITTED id changes nothing and sends nothing.
 *
 * This is an in-process guarantee with no persistence. A #53 stream reconnect replays nothing into it twice
 * (per-id feed), and a replayed request would keep its first, immutable decision anyway.
 */

/** The only tools a human turn may confirm: the reviewed mutating surface that r27 sets to `always_ask`.
 *  Built-in `write`/`edit` include native Memory writes; `trelloWriteCard` is the one enabled Trello write
 *  (#31 verifies it). Calendar is disabled and the other Trello writes stay disabled. Any other tool that
 *  asks for confirmation is outside the reviewed surface and is denied (fail closed). */
export const REVIEWED_CONFIRMATION_TOOLS: Readonly<{ builtIn: readonly string[]; mcp: Readonly<Record<string, readonly string[]>> }> = {
  builtIn: ["write", "edit"],
  mcp: { trello: ["trelloWriteCard"] },
};

export type ConfirmationDecision = "allow" | "deny";

export type ConfirmationReason =
  /** Daniel's turn, reviewed mutating tool: the provider may attempt it. */
  | "human_authority"
  /** Autonomous Working Rhythm turn: read-only, every gated tool is denied. */
  | "autonomous_read_only"
  /** The tool is not in `REVIEWED_CONFIRMATION_TOOLS`. */
  | "unreviewed_tool"
  /** The request was cross-posted from a subagent thread (the specialist is read-only). */
  | "subagent_thread"
  /** The gated event's `evaluation` is not `always_ask` (e.g. `auto`): policy drift from the release. */
  | "unexpected_evaluation";

export type ConfirmationState = "DECIDED" | "SUBMITTED" | "SEND_UNKNOWN" | "SEND_REJECTED" | "RESOLVED" | "CONTRADICTED";

/** A gated tool-use event, reduced to what the decision may depend on. Never its input. */
export interface ConfirmationRequest {
  id: string;
  kind: "builtin" | "mcp";
  name: string;
  /** `mcp_server_name` for MCP tools. */
  serverName?: string;
  /** `session_thread_id` when cross-posted from a subagent thread; null/absent on the primary thread. */
  threadId?: string | null;
  /** `evaluation.type` when present. Docs: absent on events recorded before `evaluation` existed. */
  evaluationType?: string | null;
}

/** Content-free record of one confirmation, for the traced turn and the rhythm runner. */
export interface ConfirmationRecord {
  kind: "builtin" | "mcp";
  name: string;
  decision: ConfirmationDecision;
  reason: ConfirmationReason;
}

export interface ToolConfirmationEvent {
  type: "user.tool_confirmation";
  tool_use_id: string;
  result: ConfirmationDecision;
  deny_message?: string;
  session_thread_id?: string;
}

export type ToolConfirmationSender = (events: ToolConfirmationEvent[]) => Promise<unknown>;

/** Fixed, content-free text the model receives with a denial. */
export const DENY_MESSAGES: Readonly<Record<Exclude<ConfirmationReason, "human_authority">, string>> = {
  autonomous_read_only:
    "Автоматичний хід робочого ритму лише для читання: зміни в Trello, Memory чи Calendar не виконуються. " +
    "Не повторюй виклик; за потреби запропонуй зміну Daniel словами.",
  unreviewed_tool: "Цей інструмент не входить до перевіреного набору дозволених змін; виклик відхилено. Не повторюй його.",
  subagent_thread: "Субагент не може виконувати зміни; виклик відхилено.",
  unexpected_evaluation: "Політика дозволів цього інструмента не відповідає перевіреному релізу; виклик відхилено.",
};

/** A confirmation this client must not (or can no longer) settle. The turn fails visibly. */
export class ToolConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolConfirmationError";
  }
}

export function isReviewedConfirmationTool(request: Pick<ConfirmationRequest, "kind" | "name" | "serverName">): boolean {
  if (request.kind === "builtin") return REVIEWED_CONFIRMATION_TOOLS.builtIn.includes(request.name);
  const names = request.serverName === undefined ? undefined : REVIEWED_CONFIRMATION_TOOLS.mcp[request.serverName];
  return names !== undefined && names.includes(request.name);
}

/**
 * The deterministic policy. No model judgement, no input parsing, no exception for "small" writes.
 * Everything that is not exactly "Daniel's turn asking for a reviewed mutating tool on the primary thread
 * under `always_ask`" is denied.
 */
export function decideConfirmation(
  request: ConfirmationRequest,
  authority: MutationAuthority,
): { decision: ConfirmationDecision; reason: ConfirmationReason } {
  if (typeof request.threadId === "string" && request.threadId.length > 0) return { decision: "deny", reason: "subagent_thread" };
  if (request.evaluationType !== undefined && request.evaluationType !== null && request.evaluationType !== "always_ask") {
    return { decision: "deny", reason: "unexpected_evaluation" };
  }
  if (!isReviewedConfirmationTool(request)) return { decision: "deny", reason: "unreviewed_tool" };
  if (authority !== "human") return { decision: "deny", reason: "autonomous_read_only" };
  return { decision: "allow", reason: "human_authority" };
}

interface Entry {
  readonly request: ConfirmationRequest;
  readonly decision: ConfirmationDecision;
  readonly reason: ConfirmationReason;
  state: ConfirmationState;
}

export interface ConfirmationResolution {
  /** Ids whose decision THIS call submitted and the API accepted. */
  submitted: Array<{ id: string; record: ConfirmationRecord }>;
}

export class ToolConfirmationLifecycle {
  private readonly entries = new Map<string, Entry>();

  /**
   * A gated (`evaluated_permission: "ask"`) tool-use event. Decides once, from `authority` — the authority
   * of the turn that observed the event. A replayed event with the same id keeps the first decision.
   */
  observeRequest(request: ConfirmationRequest, authority: MutationAuthority): ConfirmationRecord {
    const existing = this.entries.get(request.id);
    if (existing) return recordOf(existing);
    const { decision, reason } = decideConfirmation(request, authority);
    const entry: Entry = { request, decision, reason, state: "DECIDED" };
    this.entries.set(request.id, entry);
    return recordOf(entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  decision(id: string): ConfirmationDecision | undefined {
    return this.entries.get(id)?.decision;
  }

  state(id: string): ConfirmationState | undefined {
    return this.entries.get(id)?.state;
  }

  /**
   * The provider's `user.tool_confirmation` echo on the event stream — the authoritative acknowledgement
   * (the SDK's own `SessionToolRunner` reads verdicts from these events). A matching result → RESOLVED.
   * A different result for an id this client decided → CONTRADICTED and a visible failure: someone or
   * something else answered this request. An echo for an id this client never saw carries no state.
   */
  observeEcho(toolUseId: string, result: unknown): void {
    const entry = this.entries.get(toolUseId);
    if (!entry) return;
    if (result === entry.decision) {
      if (entry.state !== "CONTRADICTED") entry.state = "RESOLVED";
      return;
    }
    entry.state = "CONTRADICTED";
    throw new ToolConfirmationError(
      "The Managed Agents Session recorded a different tool confirmation than Djonik decided; the turn was not completed.",
    );
  }

  /**
   * Acts on the confirmation ids of one `requires_action` status. All ids must be known to this lifecycle
   * (the caller partitions the blocking list). DECIDED ids are submitted in one request with their
   * immutable decisions; SUBMITTED ids are a no-op. RESOLVED (the provider already acknowledged it),
   * CONTRADICTED, SEND_REJECTED and SEND_UNKNOWN ids fail closed: nothing is resent.
   */
  async resolveBlocking(ids: readonly string[], send: ToolConfirmationSender): Promise<ConfirmationResolution> {
    const entries = ids.map((id) => this.entries.get(id));
    if (entries.some((entry) => entry === undefined)) {
      throw new ToolConfirmationError("Djonik received an unknown tool confirmation request; nothing was confirmed.");
    }
    const blocking = entries as Entry[];
    if (blocking.some((entry) => entry.state === "RESOLVED" || entry.state === "CONTRADICTED")) {
      throw new ToolConfirmationError(
        "Djonik received a new confirmation request for a tool call the Session had already answered; nothing was resent.",
      );
    }
    if (blocking.some((entry) => entry.state === "SEND_REJECTED")) {
      throw new ToolConfirmationError("A tool confirmation was previously rejected by the Managed Agents API; nothing was resent.");
    }
    if (blocking.some((entry) => entry.state === "SEND_UNKNOWN")) {
      throw new ToolConfirmationError(
        "Delivery of an earlier tool confirmation is unknown; Djonik does not resend it automatically. The turn was not completed.",
      );
    }
    const toSubmit = blocking.filter((entry) => entry.state === "DECIDED");
    if (toSubmit.length === 0) return { submitted: [] };

    const events: ToolConfirmationEvent[] = toSubmit.map((entry) => ({
      type: "user.tool_confirmation",
      tool_use_id: entry.request.id,
      result: entry.decision,
      ...(entry.decision === "deny" ? { deny_message: DENY_MESSAGES[entry.reason as keyof typeof DENY_MESSAGES] } : {}),
      ...(typeof entry.request.threadId === "string" && entry.request.threadId.length > 0 ? { session_thread_id: entry.request.threadId } : {}),
    }));
    const setState = (state: ConfirmationState) => {
      for (const entry of toSubmit) if (entry.state === "DECIDED" || entry.state === "SEND_UNKNOWN") entry.state = state;
    };
    try {
      await send(events);
    } catch (error) {
      if (isPermanentSendRejection(error)) {
        setState("SEND_REJECTED");
        throw new ToolConfirmationError("The Managed Agents API rejected a tool confirmation; the turn was not completed. Nothing was resent.");
      }
      setState("SEND_UNKNOWN");
      const allowed = toSubmit.some((entry) => entry.decision === "allow");
      throw new ToolConfirmationError(
        "Djonik could not confirm delivery of a tool confirmation; the turn was not completed and nothing was resent." +
          (allowed ? " A requested change may or may not have been applied — it was not verified." : ""),
      );
    }
    setState("SUBMITTED");
    return { submitted: toSubmit.map((entry) => ({ id: entry.request.id, record: recordOf(entry) })) };
  }
}

function recordOf(entry: Entry): ConfirmationRecord {
  return { kind: entry.request.kind, name: entry.request.name, decision: entry.decision, reason: entry.reason };
}
