import { APIError } from "@anthropic-ai/sdk";

/**
 * Issue #53: the Session-lifetime event feed of ONE Managed Agents Session.
 *
 * Before #53 the client opened `sessions.events.stream` once and read it only inside a turn, so a stream that
 * died during a long idle period was discovered only after Daniel's next message had already been sent, and
 * the whole Session (with its conversational context) was discarded. The feed makes a dropped connection a
 * transport event instead:
 *
 * - it pumps the stream continuously in the background (the SDK stream already buffered between turns; the
 *   feed buffers in its own queue), so a drop is noticed when it happens — eager reconnect, not lazy;
 * - it reconnects to the SAME Session with the documented recipe (Managed Agents "Events and streaming":
 *   open a new stream, list the full event history to seed seen ids, tail the live stream skipping them —
 *   the same order the SDK's own `SessionToolRunner` uses), with bounded backoff;
 * - every event carries a provider id that persists across reconnections, so each id is delivered to the
 *   consumer AT MOST ONCE for the Session's lifetime. History events this feed never delivered are delivered
 *   first, in history order (catch-up); live events already delivered are skipped. Downstream lifecycles
 *   (#31 ledger, #39 confirmations, #40 custom tools) are per-id as well, so a replay can never become a
 *   second action even if it slipped past this layer.
 *
 * The feed never decides turn semantics (#32 anchoring and `end_turn` completion stay in `runTurn`); it only
 * guarantees an ordered, de-duplicated event sequence or an explicit failure. It is in-process only: no
 * persistence, and a process restart still creates a new Session (docs/51).
 */

/** Minimal shape the feed needs from a provider event. */
export interface FeedEvent {
  type: string;
  id?: unknown;
}

/** The Session surface the feed and the pending-message classifier use (the SDK in production). */
export interface SessionEventApi<E extends FeedEvent> {
  /** `sessions.events.stream`: only events emitted after it opens are delivered. */
  openStream(): Promise<{ events: AsyncIterable<E>; abort(): void }>;
  /** `sessions.events.list`: the Session's persisted history, oldest first. */
  listHistory(): AsyncIterable<E>;
  /** `sessions.retrieve(...).status`. */
  retrieveStatus(): Promise<string>;
}

export type StreamDropCause = "ended" | "error";

/** Why a feed can no longer deliver events for its Session. Content-free. */
export type FeedDeathReason =
  /** The provider reports the Session terminated (status or a terminal event). */
  | "session_terminated"
  /** The Session no longer exists (404). */
  | "session_gone"
  /** Bounded reconnect attempts were exhausted (Session possibly alive but unreachable). */
  | "reconnect_exhausted"
  /** A reconnect step failed permanently (non-retryable API error or an unexpected client error). */
  | "reconnect_failed"
  /** `close()` was called. */
  | "closed";

/** Content-free stream-lifecycle telemetry (#53). Never event content, never ids. */
export type StreamLifecycleEvent =
  | {
      type: "stream_reconnect";
      cause: StreamDropCause | "resume_before_turn";
      attempts: number;
      /** History events delivered because the dropped connection never delivered them. */
      catchUpEvents: number;
      inTurn: boolean;
    }
  | {
      type: "stream_reconnect_failed";
      cause: StreamDropCause | "resume_before_turn";
      attempts: number;
      /** `disconnected`: idle, retried before the next turn. `dead`: the Session is given up. */
      outcome: "disconnected" | "dead";
      reason: FeedDeathReason;
      inTurn: boolean;
    }
  | { type: "stream_duplicates_skipped"; count: number };

export class SessionFeedDeadError extends Error {
  constructor(readonly reason: FeedDeathReason) {
    super(`Djonik session event feed is unavailable (${reason}).`);
    this.name = "SessionFeedDeadError";
  }
}

/** Retries: an immediate first attempt, then bounded exponential backoff (~7.5 s in total). */
export const DEFAULT_RECONNECT_DELAYS_MS: readonly number[] = [0, 500, 1000, 2000, 4000];

export interface SessionEventFeedOptions {
  reconnectDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onLifecycle?: (event: StreamLifecycleEvent) => void;
}

type FeedState = "live" | "recovering" | "disconnected" | "dead";

const TERMINATED_STATUS = "terminated";

/** Session-level events after which the Session will never run another turn. */
export function isTerminalSessionEvent(event: FeedEvent): boolean {
  if (event.type === "session.status_terminated" || event.type === "session.deleted") return true;
  if (event.type !== "session.error") return false;
  const retry = (event as { error?: { retry_status?: { type?: unknown } } }).error?.retry_status?.type;
  return retry === "terminal";
}

function eventId(event: FeedEvent): string | null {
  return typeof event.id === "string" && event.id.length > 0 ? event.id : null;
}

function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.status === 404;
}

/** Retryable transport failures: connection errors (no status), 408/409/429 and 5xx — the SDK's own rule.
 *  Anything else (another 4xx, or a non-API error) will not be fixed by retrying. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const status = error.status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

export class SessionEventFeed<E extends FeedEvent> {
  private readonly delivered = new Set<string>();
  private readonly queue: E[] = [];
  private readonly waiters: Array<{ resolve: (event: E) => void; reject: (error: unknown) => void }> = [];
  private state: FeedState = "live";
  private deathReason: FeedDeathReason | null = null;
  private terminalObserved = false;
  private abortCurrent: (() => void) | null = null;
  private recovery: Promise<void> | null = null;
  private turnActive = false;
  /** Live events skipped because their id was already delivered, not yet reported. */
  private pendingDuplicates = 0;
  private readonly delays: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onLifecycle?: (event: StreamLifecycleEvent) => void;

  private constructor(private readonly api: SessionEventApi<E>, options: SessionEventFeedOptions) {
    this.delays = options.reconnectDelaysMs && options.reconnectDelaysMs.length > 0 ? options.reconnectDelaysMs : DEFAULT_RECONNECT_DELAYS_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.onLifecycle = options.onLifecycle;
  }

  /** Opens the first stream (before anything is sent, as the docs require) and starts pumping it. A fresh
   *  Session has no turn history, so nothing is listed here; a failure propagates to the connect call. */
  static async open<E extends FeedEvent>(api: SessionEventApi<E>, options: SessionEventFeedOptions = {}): Promise<SessionEventFeed<E>> {
    const feed = new SessionEventFeed(api, options);
    const stream = await api.openStream();
    feed.pump(stream);
    return feed;
  }

  /** Marks whether a visible turn is in progress: a drop inside a turn that cannot be repaired gives the
   *  Session up; outside a turn the feed only becomes `disconnected` and is retried before the next turn. */
  setTurnActive(active: boolean): void {
    this.turnActive = active;
    if (!active) this.reportDuplicates();
  }

  /** Why the feed is dead, or null while it can still deliver. A terminal event already delivered to the
   *  queue counts: the Session will never run another turn. */
  deadReason(): FeedDeathReason | null {
    if (this.state === "dead") return this.deathReason;
    return this.terminalObserved ? "session_terminated" : null;
  }

  /**
   * Called before anything is submitted: resolves when the Session's stream is (again) connected, so a
   * message is only ever sent to a Session whose turn this client can observe. An in-flight reconnect is
   * awaited; a `disconnected` feed gets one more bounded round. Throws `SessionFeedDeadError` otherwise —
   * then nothing was sent.
   */
  async ensureReady(): Promise<void> {
    for (;;) {
      const dead = this.deadReason();
      if (dead !== null) throw new SessionFeedDeadError(dead);
      if (this.state === "live") return;
      if (this.state === "recovering" && this.recovery) {
        await this.recovery;
        continue;
      }
      // disconnected: the idle-time round failed without evidence the Session is gone. Retry once now.
      await this.startRecovery("resume_before_turn");
      if (this.state === "disconnected") this.die("reconnect_exhausted");
    }
  }

  /** The next event, in order, each id at most once per Session. Rejects with `SessionFeedDeadError` when
   *  the feed can deliver nothing more. */
  next(): Promise<E> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.state === "dead") return Promise.reject(new SessionFeedDeadError(this.deathReason ?? "reconnect_failed"));
    if (this.state === "disconnected") {
      // Reached only if a turn reads while idle-disconnected; a turn always calls `ensureReady` first.
      return Promise.reject(new SessionFeedDeadError("reconnect_exhausted"));
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Records provider evidence that the Session is dead (e.g. a send refused by a terminated Session). */
  markDead(reason: FeedDeathReason): void {
    this.die(reason);
  }

  close(): void {
    this.die("closed");
  }

  // --- internals -----------------------------------------------------------------------------------

  /** A method (not an inline comparison) so state read after an `await` is not narrowed by TypeScript. */
  private isDead(): boolean {
    return this.state === "dead";
  }

  private reportDuplicates(): void {
    if (this.pendingDuplicates > 0) this.onLifecycle?.({ type: "stream_duplicates_skipped", count: this.pendingDuplicates });
    this.pendingDuplicates = 0;
  }

  private deliver(event: E): boolean {
    const id = eventId(event);
    if (id !== null) {
      if (this.delivered.has(id)) return false;
      this.delivered.add(id);
    }
    if (isTerminalSessionEvent(event)) this.terminalObserved = true;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(event);
    else this.queue.push(event);
    return true;
  }

  private pump(stream: { events: AsyncIterable<E>; abort(): void }): void {
    this.abortCurrent = () => stream.abort();
    void (async () => {
      let cause: StreamDropCause = "ended";
      try {
        for await (const event of stream.events) {
          if (this.isDead()) return;
          if (!this.deliver(event)) this.pendingDuplicates += 1;
          else this.reportDuplicates(); // a run of replayed ids ended
        }
      } catch {
        cause = "error";
      }
      this.reportDuplicates();
      if (this.isDead()) return;
      this.abortCurrent = null;
      if (this.terminalObserved) {
        // The Session announced its own end; there is nothing to reconnect to.
        this.die("session_terminated");
        return;
      }
      void this.startRecovery(cause);
    })();
  }

  private startRecovery(cause: StreamDropCause | "resume_before_turn"): Promise<void> {
    if (this.recovery) return this.recovery;
    this.state = "recovering";
    const round = this.recover(cause).finally(() => {
      if (this.recovery === round) this.recovery = null;
    });
    this.recovery = round;
    return round;
  }

  private async recover(cause: StreamDropCause | "resume_before_turn"): Promise<void> {
    let attempts = 0;
    let failure: FeedDeathReason = "reconnect_exhausted";
    for (const delay of this.delays) {
      await this.sleep(delay);
      if (this.isDead()) return;
      attempts += 1;
      try {
        const catchUp = await this.reconnectOnce();
        if (catchUp !== null) {
          this.onLifecycle?.({ type: "stream_reconnect", cause, attempts, catchUpEvents: catchUp, inTurn: this.turnActive });
          return;
        }
        // The provider reported the Session terminated during the attempt (or the feed was closed).
        if (this.deathReason === "closed") return;
        failure = this.deathReason ?? "session_terminated";
        break;
      } catch (error) {
        if (this.isDead()) return;
        if (isNotFound(error)) {
          failure = "session_gone";
          break;
        }
        if (!isRetryable(error)) {
          failure = "reconnect_failed";
          break;
        }
      }
    }
    const giveUp = failure !== "reconnect_exhausted" || this.turnActive || this.waiters.length > 0;
    this.onLifecycle?.({
      type: "stream_reconnect_failed",
      cause,
      attempts,
      outcome: giveUp ? "dead" : "disconnected",
      reason: failure,
      inTurn: this.turnActive,
    });
    if (giveUp) this.die(failure); // no-op when the attempt already recorded the death
    else this.state = "disconnected";
  }

  /** One reconnect attempt. Returns the number of catch-up events delivered, or null if the Session is
   *  gone for good. Throws on a failed step (the caller decides whether to retry). */
  private async reconnectOnce(): Promise<number | null> {
    const status = await this.api.retrieveStatus();
    if (status === TERMINATED_STATUS) {
      // Nothing to stream from any more, but what the Session persisted before it ended is still the
      // provider's record: a turn that completed while disconnected is delivered, not lost (best effort).
      try {
        this.deliverCatchUp(await this.readHistory());
      } catch {
        // unreadable history: the turn is classified conservatively by the caller
      }
      this.die("session_terminated");
      return null;
    }
    // Official recipe: open the new stream FIRST so nothing emitted while listing is lost, then list.
    const stream = await this.api.openStream();
    let history: E[];
    try {
      history = await this.readHistory();
    } catch (error) {
      stream.abort();
      throw error;
    }
    if (this.isDead()) {
      stream.abort();
      return null;
    }
    const catchUp = this.deliverCatchUp(history);
    this.state = "live";
    this.pump(stream);
    return catchUp;
  }

  private async readHistory(): Promise<E[]> {
    const history: E[] = [];
    for await (const event of this.api.listHistory()) history.push(event);
    return history;
  }

  /** Delivers, in history order, every event this feed has not delivered yet; returns how many. */
  private deliverCatchUp(history: E[]): number {
    let catchUp = 0;
    // Events before the Session's first `user.message` are creation-time preamble the original stream
    // (opened after creation) never delivered by design; they belong to no turn and are only marked seen.
    let preamble = true;
    for (const event of history) {
      if (event.type === "user.message") preamble = false;
      if (preamble) {
        const id = eventId(event);
        if (id !== null) this.delivered.add(id);
        continue;
      }
      if (this.deliver(event)) catchUp += 1;
    }
    return catchUp;
  }

  private die(reason: FeedDeathReason): void {
    if (this.isDead()) return;
    this.state = "dead";
    this.deathReason = reason;
    const abort = this.abortCurrent;
    this.abortCurrent = null;
    try {
      abort?.();
    } catch {
      // aborting an already-finished stream is harmless
    }
    for (const waiter of this.waiters.splice(0)) waiter.reject(new SessionFeedDeadError(reason));
  }
}

// --- Pending-message classification ----------------------------------------------------------------------

/**
 * What is known about the one `user.message` a failed turn submitted, when its Session is given up (#53).
 * Only `not_submitted` and `unprocessed` allow an automatic resubmission to a replacement Session.
 */
export type PendingMessageState =
  /** Nothing reached the Session (it was dead before sending, or it refused the send). */
  | "not_submitted"
  /** The Session holds the message but provably never started on it, and — being terminated — never will. */
  | "unprocessed"
  /** The Session started (or finished) processing it; resubmitting could duplicate the turn. */
  | "processed"
  /** Cannot be established safely. Never resubmitted. */
  | "unknown";

export function canResubmit(state: PendingMessageState): boolean {
  return state === "not_submitted" || state === "unprocessed";
}

/** Events that may follow an unprocessed message in a terminated Session without implying any work on it. */
const NON_PROCESSING_AFTER: ReadonlySet<string> = new Set(["session.error", "session.status_terminated", "session.deleted"]);

/**
 * Classifies a submitted message of a Session that is being given up. Conservative by construction:
 * `unprocessed` needs (a) the provider reporting the Session terminated — an alive-but-unreachable Session
 * could still process a queued message later — and (b) the listed history holding that exact message, not
 * marked processed, with no event after it that could reflect work. Every failed or inconsistent read is
 * `unknown`.
 */
export async function classifyPendingMessage<E extends FeedEvent>(
  api: SessionEventApi<E>,
  submittedId: string | null,
): Promise<PendingMessageState> {
  if (submittedId === null) return "unknown";
  try {
    if ((await api.retrieveStatus()) !== TERMINATED_STATUS) return "unknown";
    const history: E[] = [];
    for await (const event of api.listHistory()) history.push(event);
    const index = history.findIndex((event) => event.type === "user.message" && eventId(event) === submittedId);
    if (index < 0) return "unknown";
    const processedAt = (history[index] as { processed_at?: unknown }).processed_at;
    if (typeof processedAt === "string" && processedAt.length > 0) return "processed";
    const after = history.slice(index + 1);
    if (after.some((event) => !NON_PROCESSING_AFTER.has(event.type))) return "processed";
    return "unprocessed";
  } catch {
    return "unknown";
  }
}

/** A send refused by the provider (an HTTP 4xx response, so the event was not accepted) — only then can
 *  a dead Session prove the message never reached it. A connection error or 5xx stays ambiguous. */
export function isRefusedSend(error: unknown): boolean {
  return error instanceof APIError && typeof error.status === "number" && error.status >= 400 && error.status < 500;
}

/** Whether the provider says this Session can never run another turn: status terminated, or gone (404).
 *  Any other answer, or a failed read, is not proof. */
export async function sessionIsGone<E extends FeedEvent>(api: SessionEventApi<E>): Promise<FeedDeathReason | null> {
  try {
    return (await api.retrieveStatus()) === TERMINATED_STATUS ? "session_terminated" : null;
  } catch (error) {
    return isNotFound(error) ? "session_gone" : null;
  }
}
