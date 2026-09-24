import { posix } from "node:path";
import { DjonikTracedTurnError, type DjonikTracedSessionHandle } from "./djonikClient.js";
import { resolveRhythmActivation, type RhythmConfigSource } from "./rhythmConfig.js";
import {
  AutonomousTurnFailure,
  createRhythmScheduler,
  type AutonomousReadOnlyBoundary,
  type AutonomousTurnRunner,
  type ProactiveSender,
  type RhythmScheduler,
  type RhythmTickDeps,
} from "./rhythmRunner.js";
import type { RhythmStateStore } from "./rhythmState.js";
import {
  createRhythmCallbackHandler,
  STALE_BUTTON_TEXT,
  type CallbackResolution,
  type RhythmCallbackDeps,
  type RhythmCallbackQuery,
} from "./rhythmTelegram.js";
import { handleSessionError, isAllowedUser, type DjonikSessionManager } from "./telegramAdapter.js";

/**
 * Working Rhythm runtime wiring (#39 Stage 2): the glue between the Stage 1 pieces and the one hosted
 * Telegram process. It owns no product logic.
 *
 * Two independent locks, both closed in this revision:
 *  1. `DJONIK_WORKING_RHYTHM` must be exactly `on` (unset in production; the unit does not set it);
 *  2. the serving turn runner must provide a genuine pre-execution read-only boundary. It does not
 *     (`SERVING_READ_ONLY_BOUNDARY`), so even with the switch on nothing is read, written, asked or sent.
 */

/**
 * The read-only boundary the serving turn runner actually provides for scheduled turns.
 *
 * `post_hoc_detection_only`, measured against the installed SDK (0.125.0) and the current Managed Agents
 * docs (docs/62 §4): write prevention exists only as a tool `permission_policy` (`always_ask`, answered by
 * `user.tool_confirmation` deny). It lives in the Agent's tool configuration (or a Session-level tool
 * override/update), not per turn; serving r26 pins Agent v26 whose Trello write and Memory write/edit tools
 * are `always_allow`, and changing that is an Agent/release change (Stage 3). Until then scheduled turns
 * could only be checked after the fact, so Working Rhythm stays non-activatable.
 */
export const SERVING_READ_ONLY_BOUNDARY: AutonomousReadOnlyBoundary = "post_hoc_detection_only";

/** One minute: rituals are minute-level. */
export const RHYTHM_TICK_INTERVAL_MS = 60_000;

export const RHYTHM_STATE_FILE = "rhythm-state.json";

/**
 * Where the host-side delivery state lives: `DJONIK_RHYTHM_STATE_PATH` (absolute), else systemd's
 * `StateDirectory` (`$STATE_DIRECTORY`, e.g. `/var/lib/djonik`) + `rhythm-state.json`. Null → unknown, and
 * the rhythm does not start (never a guessed path; the unit's `ProtectSystem=strict` allows nothing else).
 * POSIX paths: the serving host is Linux (docs/52).
 */
export function resolveRhythmStatePath(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.DJONIK_RHYTHM_STATE_PATH?.trim();
  if (explicit) return posix.isAbsolute(explicit) ? explicit : null;
  const stateDirectory = env.STATE_DIRECTORY?.split(":")[0]?.trim();
  return stateDirectory && posix.isAbsolute(stateDirectory) ? posix.join(stateDirectory, RHYTHM_STATE_FILE) : null;
}

// --- Timer ------------------------------------------------------------------------------------------

export interface IntervalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const REAL_TIMERS: IntervalTimers = {
  setInterval: (fn, ms) => {
    const handle = setInterval(fn, ms);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RhythmTimer {
  start(): void;
  /** Stops future ticks at once; resolves when an in-flight tick (and its turn) has finished. */
  stop(): Promise<void>;
}

/**
 * One interval in the serving process — no cron, no second process. A tick never overlaps another (the
 * scheduler is single-flight too) and can never throw into the timer: an error is logged, the process lives.
 */
export function createRhythmTimer(options: {
  tick: () => Promise<unknown>;
  intervalMs?: number;
  timers?: IntervalTimers;
  log?: (line: string) => void;
}): RhythmTimer {
  const timers = options.timers ?? REAL_TIMERS;
  const log = options.log ?? (() => {});
  let handle: unknown = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  function fire(): void {
    if (stopped || inFlight !== null) return;
    inFlight = Promise.resolve()
      .then(options.tick)
      .then(
        () => undefined,
        () => log("[rhythm] tick_threw"),
      )
      .finally(() => {
        inFlight = null;
      });
  }

  return {
    start() {
      if (stopped || handle !== null) return;
      handle = timers.setInterval(fire, options.intervalMs ?? RHYTHM_TICK_INTERVAL_MS);
    },
    async stop() {
      stopped = true;
      if (handle !== null) timers.clearInterval(handle);
      handle = null;
      await inFlight;
    },
  };
}

// --- Scheduled turn through the serving Session --------------------------------------------------------

/**
 * The scheduler's `runTurn`: one text turn through the SAME serving Session, FIFO queue and pipeline as
 * Daniel's messages (`sendTraced`), returning the final reply, the Session that produced it and the turn's
 * tool uses. A dead Session is invalidated exactly as for a typed turn. A failed turn surfaces its tool uses
 * so the read-only guard still sees an attempted write.
 */
export function createSessionTurnRunner(sessions: DjonikSessionManager<DjonikTracedSessionHandle>): AutonomousTurnRunner {
  return async (request) => {
    let session: DjonikTracedSessionHandle;
    try {
      session = await sessions.getSession();
    } catch {
      throw new AutonomousTurnFailure([], null);
    }
    try {
      return await session.sendTraced([{ type: "text", text: request.prompt }]);
    } catch (error) {
      if (error instanceof DjonikTracedTurnError) {
        handleSessionError(sessions, error.error);
        throw new AutonomousTurnFailure(error.toolUses, error.sessionId);
      }
      throw new AutonomousTurnFailure([], session.sessionId);
    }
  };
}

// --- Runtime assembly ---------------------------------------------------------------------------------

export type WorkingRhythmStatus = "off" | "blocked" | "running";

export interface WorkingRhythmRuntime {
  status: WorkingRhythmStatus;
  /** Content-free reason for the startup log. */
  reason: string;
  /** Handles a callback query from an allowed user. Off/blocked: a stale-button answer, no state access. */
  handleCallback(query: RhythmCallbackQuery): Promise<CallbackResolution>;
  /** Stops the timer (no further ticks) and waits for an in-flight tick. */
  stop(): Promise<void>;
  /** Present only while running (tests and diagnostics). */
  scheduler?: RhythmScheduler;
}

export interface WorkingRhythmDeps {
  env: NodeJS.ProcessEnv;
  readOnlyBoundary: AutonomousReadOnlyBoundary;
  allowedUserId: string;
  /** Factories are called only once both locks are open; closed, nothing is constructed. */
  createConfigSource: () => RhythmConfigSource;
  createStateStore: (path: string) => RhythmStateStore;
  createFactCollector?: () => NonNullable<RhythmTickDeps["collectFacts"]>;
  runTurn: AutonomousTurnRunner;
  send: ProactiveSender;
  currentSessionId(): string | null;
  answer: RhythmCallbackDeps["answer"];
  clearButtons?: RhythmCallbackDeps["clearButtons"];
  enqueueUserText: RhythmCallbackDeps["enqueueUserText"];
  now?: () => Date;
  intervalMs?: number;
  timers?: IntervalTimers;
  log?: (line: string) => void;
}

/**
 * Assembles and starts the Working Rhythm — or, with either lock closed, returns an inert runtime whose
 * only behaviour is to answer an allowed user's (necessarily old) button with the stale-button text.
 * Call only after the serving Session is attested (telegramCli does, before polling starts).
 */
export function startWorkingRhythm(deps: WorkingRhythmDeps): WorkingRhythmRuntime {
  const log = deps.log ?? (() => {});
  const inert = (status: Exclude<WorkingRhythmStatus, "running">, reason: string): WorkingRhythmRuntime => {
    log(`[rhythm] ${status} reason=${reason}`);
    return {
      status,
      reason,
      async handleCallback(query) {
        if (!isAllowedUser(query.fromId, deps.allowedUserId)) return { outcome: "ignored", reason: "unauthorized" };
        await deps.answer(query, STALE_BUTTON_TEXT).catch(() => undefined);
        return { outcome: "rejected", reason: `rhythm_${status}` };
      },
      stop: async () => {},
    };
  };

  const activation = resolveRhythmActivation(deps.env);
  if (!activation.enabled) return inert("off", activation.reason);
  if (deps.readOnlyBoundary !== "pre_execution") return inert("blocked", `read_only_boundary=${deps.readOnlyBoundary}`);
  const statePath = resolveRhythmStatePath(deps.env);
  if (statePath === null) return inert("blocked", "state_path_unknown");

  const now = deps.now ?? (() => new Date());
  const store = deps.createStateStore(statePath);
  const scheduler = createRhythmScheduler({
    activation,
    readOnlyBoundary: deps.readOnlyBoundary,
    now,
    configSource: deps.createConfigSource(),
    store,
    runTurn: deps.runTurn,
    send: deps.send,
    ...(deps.createFactCollector ? { collectFacts: deps.createFactCollector() } : {}),
    log,
  });
  const timer = createRhythmTimer({ tick: () => scheduler.tick().then((report) => log(`[rhythm] tick ${report.status}`)), intervalMs: deps.intervalMs, timers: deps.timers, log });
  const handleCallback = createRhythmCallbackHandler({
    allowedUserId: deps.allowedUserId,
    store,
    now,
    currentSessionId: deps.currentSessionId,
    answer: deps.answer,
    clearButtons: deps.clearButtons,
    enqueueUserText: deps.enqueueUserText,
    log,
  });
  timer.start();
  log("[rhythm] running");
  return { status: "running", reason: activation.reason, handleCallback, stop: () => timer.stop(), scheduler };
}

// --- grammY callback wiring ---------------------------------------------------------------------------

/** The minimal grammY `Context` shape the callback listener reads. */
export interface CallbackContextLike {
  callbackQuery?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
  };
}

/**
 * The `callback_query:data` listener. Only the allowed user's clicks reach the runtime; anyone else's are
 * ignored without an answer (the bot does not confirm itself to strangers, like `message:text`). It never
 * throws into grammY.
 */
export function createCallbackListener(runtime: Pick<WorkingRhythmRuntime, "handleCallback">, options: { allowedUserId: string; log?: (line: string) => void }) {
  const log = options.log ?? (() => {});
  return async (ctx: CallbackContextLike): Promise<void> => {
    const query = ctx.callbackQuery;
    if (!query || !isAllowedUser(query.from.id, options.allowedUserId)) {
      log(`[rhythm] callback_ignored_unauthorized`);
      return;
    }
    try {
      await runtime.handleCallback({
        id: query.id,
        data: query.data,
        fromId: query.from.id,
        chatId: query.message?.chat.id,
        messageId: query.message?.message_id,
      });
    } catch {
      log("[rhythm] callback_error");
    }
  };
}
