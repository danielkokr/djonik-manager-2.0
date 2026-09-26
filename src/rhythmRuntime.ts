import { posix } from "node:path";
import { DjonikTracedTurnError, type DjonikTracedSessionHandle } from "./djonikClient.js";
import { parseRhythmConfig, resolveRhythmActivation, type RhythmConfig, type RhythmConfigSource } from "./rhythmConfig.js";
import {
  AutonomousTurnFailure,
  createRhythmScheduler,
  type AutonomousReadOnlyBoundary,
  type AutonomousTurnRunner,
  type ProactiveSender,
  type RhythmScheduler,
  type RhythmTickDeps,
} from "./rhythmRunner.js";
import { recoverRhythmState, type RhythmStateStore } from "./rhythmState.js";
import type { CardContext } from "./reminders.js";
import {
  createReminderCallbackHandler,
  createReminderScheduler,
  isReminderCallbackData,
  type ReminderCallbackResolution,
  type ReminderScheduler,
} from "./reminderDelivery.js";
import {
  createRhythmCallbackHandler,
  STALE_BUTTON_TEXT,
  type CallbackResolution,
  type RhythmCallbackDeps,
  type RhythmCallbackQuery,
} from "./rhythmTelegram.js";
import { isAllowedUser, runWithSessionRecovery, type DjonikSessionManager, type SessionRecoveryEvent } from "./telegramAdapter.js";
import { confirmationPolicyProblems, REVIEWED_TRELLO_READ_TOOLS, SERVING_RELEASE, type DjonikRelease } from "./release.js";
import { REVIEWED_CONFIRMATION_TOOLS } from "./toolConfirmation.js";

/**
 * Working Rhythm runtime wiring (#39 Stage 2): the glue between the Stage 1 pieces and the one hosted
 * Telegram process. It owns no product logic.
 *
 * Two independent locks:
 *  1. `DJONIK_WORKING_RHYTHM` must be exactly `on` (unset in production; the unit does not set it) — so
 *     Working Rhythm stays off until a separately authorized activation;
 *  2. the serving turn runner must provide a genuine pre-execution read-only boundary
 *     (`SERVING_READ_ONLY_BOUNDARY`, derived from the serving release). Serving r27 provides it (docs/66);
 *     under r25/r26 even the switch on read, wrote, asked and sent nothing.
 */

/**
 * The read-only boundary a release gives scheduled turns (#39 Stage 3A, docs/63).
 *
 * The client side exists in source: `sendTraced(…, "rhythm_ritual" | "rhythm_exception")` denies every
 * `always_ask` tool confirmation before the provider executes it (`toolConfirmation.ts`). That is only a
 * pre-execution boundary when the provider actually gates every reviewed mutating tool, i.e. when the
 * served release declares exactly `REVIEWED_CONFIRMATION_TOOLS` as `always_ask` — which startup attestation
 * then proves against the Agent version and the Session snapshot, failing closed on drift. A release that
 * lets any reviewed mutating tool run as `always_allow` (r25, r26) gives `post_hoc_detection_only`.
 */
/** Reviewed read inventory per reviewed MCP server (explicitly `always_allow` in a pre-execution release). */
const REVIEWED_MCP_READ_TOOLS: Readonly<Record<string, readonly string[]>> = { trello: REVIEWED_TRELLO_READ_TOOLS };

/** Built-ins that cannot change anything (r26 allowlist minus the gated `write`/`edit`). */
const READ_ONLY_BUILT_INS: ReadonlySet<string> = new Set(["read", "glob", "grep"]);

export function readOnlyBoundaryFor(release: Pick<DjonikRelease, "builtInTools" | "mcpToolsets" | "confirmationRequired">): AutonomousReadOnlyBoundary {
  const policy = release.confirmationRequired;
  if (!policy || confirmationPolicyProblems(release).length > 0) return "post_hoc_detection_only";
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  // Every enabled reviewed mutating built-in is gated (a disabled one cannot run at all)…
  const builtInsGated = sameSet(
    policy.builtIn,
    REVIEWED_CONFIRMATION_TOOLS.builtIn.filter((name) => (release.builtInTools as readonly string[]).includes(name)),
  );
  // …and every reviewed mutating MCP tool that the release enables, on every server, and nothing else.
  const servers = new Set([...Object.keys(policy.mcp), ...Object.keys(REVIEWED_CONFIRMATION_TOOLS.mcp)]);
  const mcpGated = [...servers].every((server) => {
    const toolset = release.mcpToolsets.find((entry) => entry.server === server);
    const enabledReviewed = (REVIEWED_CONFIRMATION_TOOLS.mcp[server] ?? []).filter((name) => toolset?.overrides[name] ?? toolset?.defaultEnabled ?? false);
    return sameSet(policy.mcp[server] ?? [], enabledReviewed);
  });
  // An MCP server outside the reviewed surface (Calendar) must be fully disabled, and a reviewed server may
  // enable no other explicitly named write tool: either would be an ungated mutation path.
  const noOtherMutators = release.mcpToolsets.every((toolset) => {
    const reviewed = REVIEWED_CONFIRMATION_TOOLS.mcp[toolset.server];
    const enabledNamed = Object.entries(toolset.overrides).filter(([, enabled]) => enabled).map(([name]) => name);
    if (!reviewed) return !toolset.defaultEnabled && enabledNamed.length === 0;
    // A reviewed server fails closed for tools this release has not reviewed: an enabled default must be
    // `always_ask` (an unknown future tool then waits for a confirmation the client never allows), and every
    // explicitly enabled tool is either a reviewed read (left `always_allow`) or a reviewed, gated mutation.
    if (toolset.defaultEnabled && toolset.defaultPolicy !== "always_ask") return false;
    const reads: readonly string[] = REVIEWED_MCP_READ_TOOLS[toolset.server] ?? [];
    const gated = policy.mcp[toolset.server] ?? [];
    const readsExplicit = reads.every((name) => toolset.overrides[name] === true && !gated.includes(name));
    const onlyReviewed = enabledNamed.every((name) => reads.includes(name) || (reviewed.includes(name) && gated.includes(name)));
    return readsExplicit && onlyReviewed;
  });
  // Every other enabled built-in must be a pure read: `bash` (and the network tools) could write Memory files
  // or have side effects without passing a gate.
  const builtInsReadOnly = release.builtInTools.every((name) => READ_ONLY_BUILT_INS.has(name) || policy.builtIn.includes(name));
  return builtInsGated && builtInsReadOnly && mcpGated && noOtherMutators ? "pre_execution" : "post_hoc_detection_only";
}

/**
 * The read-only boundary the serving turn runner actually provides for scheduled turns: derived from the
 * one release this revision serves. Serving r27 (Agent v27) gates every reviewed mutating tool `always_ask`,
 * so this is `pre_execution` — never hard-coded: it is recomputed from the release, and startup attestation
 * proves those policies against the Agent version and Session snapshot. (r26 gave `post_hoc_detection_only`.)
 * Working Rhythm still needs lock 1, the `DJONIK_WORKING_RHYTHM` switch.
 */
export const SERVING_READ_ONLY_BOUNDARY: AutonomousReadOnlyBoundary = readOnlyBoundaryFor(SERVING_RELEASE);

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
  /** One tick now, through the same single-flight guard; resolves when it (or the tick already in flight) has
   *  finished. Tests and diagnostics — production relies on the interval. */
  runNow(): Promise<void>;
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
    async runNow() {
      fire();
      await inFlight;
    },
  };
}

// --- Scheduled turn through the serving Session --------------------------------------------------------

/**
 * The scheduler's `runTurn`: one text turn through the SAME serving Session, FIFO queue and pipeline as
 * Daniel's messages (`sendTraced`), returning the final reply, the Session that produced it and the turn's
 * tool uses. A Session given up mid-turn goes through the same #53 recovery as a typed turn (replacement, and a
 * resubmission only when the prompt provably never started processing), so a rhythm turn — and therefore its
 * one proactive delivery — still produces at most one result. A failed turn surfaces its tool uses so the
 * read-only guard still sees an attempted write.
 */
export function createSessionTurnRunner(
  sessions: DjonikSessionManager<DjonikTracedSessionHandle>,
  onSessionRecovery?: (event: SessionRecoveryEvent) => void,
): AutonomousTurnRunner {
  return async (request) => {
    let sessionId: string | null = null;
    try {
      return await runWithSessionRecovery(
        sessions,
        (session) => {
          sessionId = session.sessionId;
          // The origin is the scheduler's own (`rhythm_ritual` / `rhythm_exception`): autonomous authority, so
          // the client denies every gated tool before it executes (#39 Stage 3A).
          return session.sendTraced([{ type: "text", text: request.prompt }], request.origin);
        },
        onSessionRecovery,
      );
    } catch (error) {
      if (error instanceof DjonikTracedTurnError) {
        throw new AutonomousTurnFailure(error.toolUses, error.sessionId, error.autonomousMutationAttempt);
      }
      throw new AutonomousTurnFailure([], sessionId);
    }
  };
}

// --- Runtime assembly ---------------------------------------------------------------------------------

export type WorkingRhythmStatus = "off" | "blocked" | "running";

export interface WorkingRhythmRuntime {
  status: WorkingRhythmStatus;
  /** Content-free reason for the startup log. */
  reason: string;
  /** #54: whether code-owned reminder delivery runs in this process. */
  reminders: "on" | "off";
  /** Handles a callback query from an allowed user. Off/blocked: a stale-button answer, no state access. */
  handleCallback(query: RhythmCallbackQuery): Promise<CallbackResolution | ReminderCallbackResolution>;
  /** Stops the timer (no further ticks) and waits for an in-flight tick. */
  stop(): Promise<void>;
  /** Present only while running (tests and diagnostics). */
  scheduler?: RhythmScheduler;
  /** Present only while reminders are on (tests and diagnostics). */
  reminderScheduler?: ReminderScheduler;
  /** One combined tick now through the timer's single-flight guard (tests and diagnostics); absent when inert. */
  tickNow?: () => Promise<void>;
}

/**
 * Reminder delivery (#54). Independent of the rhythm switch: a reminder is a promise Djonik made to Daniel, so its
 * delivery runs whenever the serving release exposes the `reminder` tool and the state file has a known home — even
 * with the Working Rhythm off (then every reminder is delivered directly). It needs no read-only boundary: delivering
 * a reminder involves no model turn at all.
 */
export interface ReminderRuntimeDeps {
  /** The serving release exposes the `reminder` custom tool (derived from the release, never from the env). */
  enabled: boolean;
  /** Fresh read-only card state for a card-linked reminder; its failure never blocks delivery. */
  cardContext?: (cardId: string) => Promise<CardContext | null>;
  /** A short, dismissible acknowledgement of a reminder button (defaults to `answer`). */
  notify?: (query: RhythmCallbackQuery, text: string) => Promise<unknown>;
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
  /** #54 reminder delivery; absent = off (the pre-#54 behaviour, byte for byte). */
  reminders?: ReminderRuntimeDeps;
}

/**
 * Assembles and starts the Working Rhythm and (#54) reminder delivery — or, with both off, returns an inert runtime
 * whose only behaviour is to answer an allowed user's (necessarily old) button with the stale-button text.
 * Call only after the serving Session is attested (telegramCli does, before polling starts).
 *
 * One timer, one state store instance, one lifecycle: every tick first recovers the shared state file once (at
 * startup), then runs the rhythm tick (a morning ritual claims today's date-only reminders atomically with its own
 * record) and then the reminder tick (every other due reminder, directly). They never run concurrently, so two
 * workers can never claim the same reminder. `createStateStore` is called once; the adapter passes the SAME store
 * instance its `reminder` tool executor writes through, so all writes share one serialized update chain.
 */
export function startWorkingRhythm(deps: WorkingRhythmDeps): WorkingRhythmRuntime {
  const log = deps.log ?? (() => {});
  const staleAnswer = async (query: RhythmCallbackQuery, reason: string): Promise<CallbackResolution> => {
    if (!isAllowedUser(query.fromId, deps.allowedUserId)) return { outcome: "ignored", reason: "unauthorized" };
    await deps.answer(query, STALE_BUTTON_TEXT).catch(() => undefined);
    return { outcome: "rejected", reason };
  };

  const activation = resolveRhythmActivation(deps.env);
  const statePath = resolveRhythmStatePath(deps.env);
  let status: WorkingRhythmStatus = "running";
  let reason = activation.reason;
  if (!activation.enabled) status = "off";
  else if (deps.readOnlyBoundary !== "pre_execution") [status, reason] = ["blocked", `read_only_boundary=${deps.readOnlyBoundary}`];
  else if (statePath === null) [status, reason] = ["blocked", "state_path_unknown"];
  const remindersOn = deps.reminders?.enabled === true && statePath !== null;
  if (status !== "running") log(`[rhythm] ${status} reason=${reason}`);
  if (deps.reminders?.enabled === true && !remindersOn) log("[reminder] off reason=state_path_unknown");

  if (status !== "running" && !remindersOn) {
    return {
      status,
      reason,
      reminders: "off",
      handleCallback: (query) => staleAnswer(query, `rhythm_${status}`),
      stop: async () => {},
    };
  }

  const now = deps.now ?? (() => new Date());
  const store = deps.createStateStore(statePath!);
  const configSource = deps.createConfigSource();
  const scheduler =
    status === "running"
      ? createRhythmScheduler({
          activation,
          readOnlyBoundary: deps.readOnlyBoundary,
          now,
          configSource,
          store,
          runTurn: deps.runTurn,
          send: deps.send,
          ...(deps.createFactCollector ? { collectFacts: deps.createFactCollector() } : {}),
          log,
          // The runtime recovers the shared file once, before either scheduler acts.
          recoverOnFirstTick: false,
          ...(deps.reminders?.cardContext ? { reminderCardContext: deps.reminders.cardContext } : {}),
        })
      : undefined;
  const reminderScheduler = remindersOn
    ? createReminderScheduler({
        store,
        now,
        send: deps.send,
        // With the rhythm not running no ritual can carry a reminder: every one is delivered directly.
        ritualConfig: () => scheduler?.ritualConfig() ?? null,
        ...(deps.reminders?.cardContext ? { cardContext: deps.reminders.cardContext } : {}),
        log,
      })
    : undefined;

  let recovered = false;
  const tick = async (): Promise<void> => {
    if (!recovered) {
      try {
        await store.update((current) => recoverRhythmState(current, now()));
        recovered = true;
      } catch {
        // Unreadable state: nothing is sent this tick (a lost state must never become a duplicate message).
        log("[proactive] recovery_failed");
        return;
      }
    }
    if (scheduler) log(`[rhythm] tick ${(await scheduler.tick()).status}`);
    if (reminderScheduler) {
      const report = await reminderScheduler.tick();
      if (report.status !== "ran" || report.deliveries.length > 0) log(`[reminder] tick ${report.status} sends=${report.sends}`);
    }
  };
  const timer = createRhythmTimer({ tick, intervalMs: deps.intervalMs, timers: deps.timers, log });

  const rhythmCallback = scheduler
    ? createRhythmCallbackHandler({
        allowedUserId: deps.allowedUserId,
        store,
        now,
        currentSessionId: deps.currentSessionId,
        answer: deps.answer,
        clearButtons: deps.clearButtons,
        enqueueUserText: deps.enqueueUserText,
        log,
      })
    : null;
  const reminderCallback = remindersOn
    ? createReminderCallbackHandler({
        allowedUserId: deps.allowedUserId,
        store,
        now,
        readConfig: reminderConfigReader(configSource),
        answer: (query, text) => (deps.reminders?.notify && text !== undefined ? deps.reminders.notify(query, text) : deps.answer(query, text)),
        clearButtons: deps.clearButtons,
        log,
      })
    : null;
  const handleCallback = (query: RhythmCallbackQuery): Promise<CallbackResolution | ReminderCallbackResolution> => {
    if (isReminderCallbackData(query.data)) {
      if (reminderCallback) return reminderCallback(query);
      return staleAnswer(query, "reminders_off");
    }
    if (rhythmCallback) return rhythmCallback(query);
    return staleAnswer(query, `rhythm_${status}`);
  };

  timer.start();
  if (scheduler) log("[rhythm] running");
  if (reminderScheduler) log("[reminder] running");
  return {
    status,
    reason,
    reminders: remindersOn ? "on" : "off",
    handleCallback,
    stop: () => timer.stop(),
    tickNow: () => timer.runNow(),
    ...(scheduler ? { scheduler } : {}),
    ...(reminderScheduler ? { reminderScheduler } : {}),
  };
}

/** Reads the rhythm config for a reminder decision; an unreadable `/rhythm.md` is the safe defaults (#54). */
export function reminderConfigReader(source: RhythmConfigSource): () => Promise<RhythmConfig> {
  return async () => parseRhythmConfig(await source.read()).config;
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
