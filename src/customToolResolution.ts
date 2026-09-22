import { APIError } from "@anthropic-ai/sdk";

/**
 * Issue #40: Session-scoped resolution of Managed Agents custom-tool calls, keyed by the provider's
 * `custom_tool_use_id` (decision record: docs/30; architecture rule: docs/01 §13).
 *
 * `session.status_idle{requires_action}` is a level-triggered STATUS: the provider may re-emit it —
 * as a different idle event naming the same still-blocking id — whenever the Session becomes idle
 * again (docs/29: a parallel built-in Skill `read` did exactly that). It is therefore never, by
 * itself, permission to run a tool. Execution identity is the `agent.custom_tool_use` event id, and
 * each id moves through one lifecycle for the whole Session:
 *
 *   OBSERVED → EXECUTING → RESULT_READY → SUBMITTED / SEND_UNKNOWN → RESOLVED
 *
 * plus the terminal SEND_REJECTED for a permanent API rejection of the result. Execution and result
 * submission are separate concerns: an id executes AT MOST ONCE; its exact result is cached, and only
 * those cached bytes may ever be (re)submitted. The provider's echo of the persisted
 * `user.custom_tool_result` is the authoritative RESOLVED evidence.
 *
 * This is an in-process guarantee only. It does not make an external side effect crash-safe; a future
 * side-effecting custom tool additionally needs a target-enforced idempotency key or durable intent
 * record plus #31-style verification (docs/01 §13). There is no persistence, event store or reconnect
 * reconciliation here — a dead stream stays `DjonikSessionDeadError` (fail-closed).
 */
export type CustomToolResolutionState =
  | "OBSERVED"
  | "EXECUTING"
  | "RESULT_READY"
  | "SUBMITTED"
  | "SEND_UNKNOWN"
  | "SEND_REJECTED"
  | "RESOLVED";

/** The exact result of one executor run: what the model sees for that custom_tool_use_id. */
export interface CustomToolResult {
  isError: boolean;
  content: string;
}

/** One `user.custom_tool_result` event built from a cached result. */
export interface CustomToolResultEvent {
  type: "user.custom_tool_result";
  custom_tool_use_id: string;
  is_error: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export type CustomToolExecutor = (input: unknown) => Promise<CustomToolResult>;
export type CustomToolResultSender = (events: CustomToolResultEvent[]) => Promise<unknown>;

/** A blocking custom-tool action this client must not (or can no longer) settle. The turn fails
 *  visibly; nothing was re-executed. Messages carry no raw provider ids. */
export class CustomToolResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomToolResolutionError";
  }
}

/** The fixed error payload cached when an executor throws instead of returning a result. */
export const EXECUTOR_EXCEPTION_CONTENT = JSON.stringify({
  error: { type: "executor_exception", message: "The custom tool failed before producing a result." },
});

/**
 * A permanent rejection of a result submission: an HTTP 4xx other than 408/409/429 — the same rule
 * the SDK's own `SessionToolRunner` uses to stop retrying. Anything else (connection error, timeout,
 * 408/409/429, 5xx, a non-API error) leaves the delivery outcome unknown.
 */
export function isPermanentSendRejection(error: unknown): boolean {
  return (
    error instanceof APIError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409 &&
    error.status !== 429
  );
}

/** Send attempts per resolution step: the first send plus ONE resend of the same cached bytes. */
const MAX_SEND_ATTEMPTS = 2;

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  state: CustomToolResolutionState;
  /** Set exactly once, when execution begins; never replaced. */
  execution?: Promise<CustomToolResult>;
  /** The executor's exact result (or the fixed exception payload), cached for the Session. */
  result?: CustomToolResult;
}

export interface BlockingResolution {
  /** Ids whose executor was started by THIS call (each at most once per Session). */
  executed: string[];
  /** Ids whose cached result was accepted by THIS call's submission. */
  submitted: Array<{ id: string; isError: boolean }>;
}

export class CustomToolResolution {
  private readonly entries = new Map<string, Entry>();
  private readonly supported: ReadonlySet<string>;

  constructor(supportedToolNames: readonly string[]) {
    this.supported = new Set(supportedToolNames);
  }

  /** `agent.custom_tool_use`: records the call by its exact event id. A replay of the same id keeps the
   *  first observation; two different ids are always two calls, even with byte-identical name/input. */
  observeUse(event: { id: string; name: string; input: unknown }): void {
    if (this.entries.has(event.id)) return;
    this.entries.set(event.id, { id: event.id, name: event.name, input: event.input, state: "OBSERVED" });
  }

  /** `user.custom_tool_result` echo: the provider persisted a result for this id — authoritative
   *  RESOLVED. An echo for an id this Session never observed carries no state to update. */
  observeResultEcho(customToolUseId: string): void {
    const entry = this.entries.get(customToolUseId);
    if (entry) entry.state = "RESOLVED";
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  name(id: string): string | undefined {
    return this.entries.get(id)?.name;
  }

  state(id: string): CustomToolResolutionState | undefined {
    return this.entries.get(id)?.state;
  }

  /** The one cached result for this id, if its execution has settled. */
  result(id: string): CustomToolResult | undefined {
    return this.entries.get(id)?.result;
  }

  /**
   * Acts on one `requires_action` status naming `blockingIds`. The whole list is validated before
   * anything runs, so a list this client cannot settle executes nothing:
   *  - malformed (not a non-empty list of distinct strings), unobserved or unsupported ids fail closed;
   *  - a RESOLVED id contradicts the provider's own echo, and a SEND_REJECTED id was permanently
   *    refused: both fail visibly, with no re-execution and no resend.
   * Then OBSERVED ids begin execution (once); EXECUTING / SUBMITTED ids are no-ops; ids holding a
   * cached result that was never accepted (RESULT_READY, SEND_UNKNOWN) are submitted from the cache.
   * A status whose ids are all already in flight or submitted does nothing at all.
   */
  async resolveBlocking(
    blockingIds: unknown,
    executor: CustomToolExecutor,
    send: CustomToolResultSender,
  ): Promise<BlockingResolution> {
    if (
      !Array.isArray(blockingIds) ||
      blockingIds.length === 0 ||
      blockingIds.some((id) => typeof id !== "string") ||
      new Set(blockingIds).size !== blockingIds.length
    ) {
      throw new CustomToolResolutionError("Djonik requested a malformed custom-tool action; the turn was not completed.");
    }
    const entries = (blockingIds as string[]).map((id) => this.entries.get(id));
    if (entries.some((entry) => !entry || !this.supported.has(entry.name))) {
      throw new CustomToolResolutionError("Djonik requested an unsupported custom tool; the turn was not completed.");
    }
    const blocking = entries as Entry[];
    if (blocking.some((entry) => entry.state === "RESOLVED")) {
      throw new CustomToolResolutionError(
        "Djonik received a new action request for a custom-tool call the Session had already resolved; " +
          "the turn was not completed. Nothing was re-executed or resent.",
      );
    }
    if (blocking.some((entry) => entry.state === "SEND_REJECTED")) {
      throw new CustomToolResolutionError(
        "Djonik's custom-tool result was previously rejected by the Managed Agents API; the turn was not " +
          "completed. Nothing was re-executed or resent.",
      );
    }

    const toExecute = blocking.filter((entry) => entry.state === "OBSERVED");
    await Promise.all(toExecute.map((entry) => this.execute(entry, executor)));

    const toSubmit = blocking.filter((entry) => entry.state === "RESULT_READY" || entry.state === "SEND_UNKNOWN");
    if (toSubmit.length > 0) await this.submit(toSubmit, send);
    return {
      executed: toExecute.map((entry) => entry.id),
      submitted: toSubmit.map((entry) => ({ id: entry.id, isError: entry.result!.isError })),
    };
  }

  /** OBSERVED → EXECUTING → RESULT_READY. The only place an executor runs; an executor that throws
   *  yields one cached `is_error` result so the Session is never left blocked. */
  private execute(entry: Entry, executor: CustomToolExecutor): Promise<CustomToolResult> {
    if (entry.execution) return entry.execution;
    entry.state = "EXECUTING";
    entry.execution = (async () => {
      let result: CustomToolResult;
      try {
        const returned = await executor(entry.input);
        result = { isError: returned.isError, content: returned.content };
      } catch {
        result = { isError: true, content: EXECUTOR_EXCEPTION_CONTENT };
      }
      entry.result = result;
      // An echo may already have resolved the id while the executor ran; never regress it.
      if (entry.state === "EXECUTING") entry.state = "RESULT_READY";
      return result;
    })();
    return entry.execution;
  }

  /**
   * Submits the cached results of `entries` in one request. Accepted → SUBMITTED. A permanent
   * rejection → SEND_REJECTED and a visible failure, no retry. An unknown outcome → SEND_UNKNOWN, then
   * at most one resend of the SAME cached event bytes; if that is unknown too, the ids stay
   * SEND_UNKNOWN (cache intact) and the turn fails visibly. Never re-executes.
   */
  private async submit(entries: Entry[], send: CustomToolResultSender): Promise<void> {
    const events: CustomToolResultEvent[] = entries.map((entry) => ({
      type: "user.custom_tool_result",
      custom_tool_use_id: entry.id,
      is_error: entry.result!.isError,
      content: [{ type: "text", text: entry.result!.content }],
    }));
    const setState = (state: CustomToolResolutionState) => {
      for (const entry of entries) if (entry.state !== "RESOLVED") entry.state = state;
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        await send(events);
        setState("SUBMITTED");
        return;
      } catch (error) {
        if (isPermanentSendRejection(error)) {
          setState("SEND_REJECTED");
          throw new CustomToolResolutionError(
            "The Managed Agents API rejected the custom-tool result; the turn was not completed. " +
              "Nothing was re-executed or resent.",
          );
        }
        setState("SEND_UNKNOWN");
        if (attempt >= MAX_SEND_ATTEMPTS) {
          throw new CustomToolResolutionError(
            "Djonik could not confirm delivery of a custom-tool result; the turn was not completed. " +
              "The tool was not re-executed.",
          );
        }
      }
    }
  }
}
