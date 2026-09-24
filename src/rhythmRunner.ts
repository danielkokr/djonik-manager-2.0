import { createHash } from "node:crypto";
import {
  describeRhythmConfig,
  parseRhythmConfig,
  type RhythmActivation,
  type RhythmConfig,
  type RhythmConfigSource,
} from "./rhythmConfig.js";
import { boundTelegramText, buttonsFor, RHYTHM_ACTIONS, type OutboundMessage, type ProactiveKind } from "./rhythmActions.js";
import { evaluateRituals, kyivLocal, type RitualKind, type RitualOccurrence } from "./rhythmSchedule.js";
import {
  advanceSignalLedger,
  detectSignals,
  markSignals,
  occurrenceHandle,
  ritualObservations,
  selectException,
  type ExceptionHistoryEntry,
  type Signal,
  type SignalFacts,
} from "./rhythmSignals.js";
import {
  mayAttempt,
  newDeliveryRef,
  recoverRhythmState,
  RhythmStateError,
  type DeliveryRecord,
  type RhythmState,
  type RhythmStateStore,
} from "./rhythmState.js";

/**
 * Working Rhythm scheduler tick (#39). Orchestrates the pure pieces — config, schedule, signals,
 * limits, delivery state — around two injected effects: one autonomous Djonik turn and one Telegram
 * send. It holds no conversation logic: Claude composes every brief/review/exception in the normal
 * serving Session, following the `pm-rhythm` Skill.
 *
 * Nothing here is wired into `telegramCli.ts` in this revision. Activation is a separate, authorized
 * stage (docs/61 §12, §17).
 */

/**
 * The four ways a turn can start. Only the first and last are Daniel's; both reach Djonik through the
 * same grouping buffer and FIFO Session queue. The two rhythm origins are autonomous and read-only.
 */
export type TurnOrigin = "user_message" | "button_callback" | "rhythm_ritual" | "rhythm_exception";

export interface ToolUseRecord {
  kind: "mcp" | "builtin" | "custom";
  name: string;
}

export interface AutonomousTurnRequest {
  origin: Extract<TurnOrigin, "rhythm_ritual" | "rhythm_exception">;
  occurrenceKey: string;
  kind: ProactiveKind;
  prompt: string;
}

export interface AutonomousTurnResult {
  /** The final visible reply (#38 final-only: never an interim `agent.message`). */
  reply: string;
  /** Every tool the turn invoked, for the read-only guard. */
  toolUses: ToolUseRecord[];
}

export type AutonomousTurnRunner = (request: AutonomousTurnRequest) => Promise<AutonomousTurnResult>;

export type SendOutcome =
  | { status: "sent"; messageId: number }
  /** Telegram answered and refused: definitely not delivered. */
  | { status: "rejected"; reason: string }
  /** No answer (network, timeout, crash): may have been delivered. */
  | { status: "unknown"; reason: string };

export type ProactiveSender = (message: OutboundMessage, ref: string) => Promise<SendOutcome>;

// --- Autonomous read-only guard ---------------------------------------------------------------------

const MUTATING_VERBS = "create|update|delete|remove|move|archive|send|write|patch|insert|respond";
/** `trelloWrite*`, a snake_case mutating verb (`create_event`) or a camelCase one (`cardMove`). */
const MUTATING_MCP_NAME = new RegExp(
  `^trelloWrite|(^|_)(${MUTATING_VERBS})(_|$)|[a-z](${MUTATING_VERBS.replace(/(^|\|)(\w)/g, (_m, sep: string, c: string) => sep + c.toUpperCase())})([A-Z]|$)`,
);
const READ_ONLY_CUSTOM_TOOLS = new Set(["trello_work_history"]);

/**
 * Tools an autonomous turn must never use: any Trello write, any MCP tool with a mutating verb
 * (Calendar included), Memory `write`/`edit`, and any custom tool other than the read-only
 * `trello_work_history`. Provider-side MCP calls cannot be intercepted before they run, so this is a
 * detector: a violating turn's text is never delivered; a fixed notice tells Daniel instead.
 */
export function autonomousWriteViolations(toolUses: readonly ToolUseRecord[]): ToolUseRecord[] {
  return toolUses.filter((use) => {
    if (use.kind === "mcp") return MUTATING_MCP_NAME.test(use.name);
    if (use.kind === "builtin") return use.name === "write" || use.name === "edit";
    return !READ_ONLY_CUSTOM_TOOLS.has(use.name);
  });
}

export const AUTONOMOUS_WRITE_NOTICE =
  "⚠️ Під час автоматичного ходу робочого ритму Джонік спробував щось змінити, а цього не можна робити без тебе. " +
  "Повідомлення не надіслано. Глянь, будь ласка, дошку Trello — і напиши, якщо щось виглядає не так.";

/** An exception turn that decides not to interrupt answers exactly this token. */
export const SILENT_TOKEN = "SILENT";

export function isSilentReply(reply: string): boolean {
  return reply.trim().replace(/[.!]$/, "") === SILENT_TOKEN;
}

// --- Prompts (turn instructions only; voice and content rules live in the pm-rhythm Skill) ----------

const WEEKDAY_UK = ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"];

export function kyivLabel(instant: Date, withTime = false): string {
  const local = kyivLocal(instant);
  const [, month, day] = local.date.split("-");
  const time = `${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;
  return `${WEEKDAY_UK[local.weekday]} ${day}.${month}${withTime ? `, ${time}` : ""}`;
}

const RITUAL_SECTION: Record<RitualKind, string> = {
  "monday-plan": "план тижня (понеділок)",
  morning: "ранковий бриф (вт–чт)",
  "friday-morning": "пʼятничний ранок",
  "friday-review": "пʼятничний огляд",
  evening: "вечірнє «що переносимо?»",
};

const READ_ONLY_RULES =
  "Хід лише для читання: можна читати Memory, Trello і trello_work_history. Не змінюй Trello, Memory чи Calendar, " +
  "не пиши клієнтам і не приймай нічого за Daniel — будь-яку зміну лише запропонуй.";

function buttonLine(kind: ProactiveKind): string {
  const labels = buttonsFor(kind).map((action) => RHYTHM_ACTIONS[action].label);
  return labels.length > 0 ? `Під повідомленням будуть кнопки ${labels.join(" · ")}; Daniel може й просто відповісти текстом.` : "";
}

function hintLines(signals: readonly Signal[]): string[] {
  return signals.map((signal) => `- ${signal.subject}${signal.project ? ` (${signal.project})` : ""}: ${signal.fact} [${occurrenceHandle(signal)}]`);
}

export function buildRitualPrompt(ritual: RitualOccurrence, config: RhythmConfig, observations: readonly Signal[], now: Date): string {
  const lines = [
    `[Робочий ритм · автоматичний хід · ${RITUAL_SECTION[ritual.kind]} · ${kyivLabel(now, true)}]`,
    `Це запланований хід, а не повідомлення від Daniel. Склади повідомлення за Skill pm-rhythm, розділ «${RITUAL_SECTION[ritual.kind]}», зі свіжим Trello.`,
    READ_ONLY_RULES,
    "Твоя відповідь піде Daniel як є, одним повідомленням.",
    buttonLine(ritual.kind),
    `Налаштування ритму: ${describeRhythmConfig(config)}.`,
  ];
  if (observations.length > 0) {
    lines.push("Підказки коду (перевір свіжим Trello; це не готові висновки):", ...hintLines(observations));
  }
  return lines.filter(Boolean).join("\n");
}

export function buildExceptionPrompt(signals: readonly Signal[], now: Date): string {
  return [
    `[Робочий ритм · автоматичний хід · можливий виняток · ${kyivLabel(now, true)}]`,
    "Код знайшов факти, які, можливо, не можуть чекати наступного ритуалу. Перевір їх свіжим Trello і за Skill pm-rhythm (розділ «винятки») виріши, чи писати зараз.",
    `Якщо чекання до наступного брифу чи огляду суттєво нічого не погіршує — відповідай рівно ${SILENT_TOKEN} і нічого більше.`,
    READ_ONLY_RULES,
    "Якщо пишеш: одне коротке повідомлення про все разом, висновок першим, одна легка дія.",
    buttonLine("exception"),
    "Факти (id у дужках — для «не нагадуй», див. pm-rhythm):",
    ...hintLines(signals),
  ]
    .filter(Boolean)
    .join("\n");
}

// --- Tick -------------------------------------------------------------------------------------------

/**
 * How the autonomous turn runner keeps rhythm turns read-only.
 *
 * - `pre_execution`: writes are impossible before they run (e.g. the Agent's write tools require a
 *   confirmation that autonomous turns deny). No such runner exists yet.
 * - `post_hoc_detection_only`: `autonomousWriteViolations` can only notice a provider-side write after
 *   it happened and withhold the message. That is not prevention.
 *
 * INVARIANT (docs/61 §12–§13): Working Rhythm must not be activated in production until a later bounded
 * stage establishes a genuine pre-execution read-only boundary for autonomous ritual/exception turns.
 * The scheduler enforces it: with anything but `pre_execution` it makes no model call and sends nothing.
 */
export type AutonomousReadOnlyBoundary = "pre_execution" | "post_hoc_detection_only";

export interface RhythmTickDeps {
  activation: RhythmActivation;
  /** Declared by the wiring for its `runTurn`; see `AutonomousReadOnlyBoundary`. */
  readOnlyBoundary: AutonomousReadOnlyBoundary;
  now(): Date;
  configSource: RhythmConfigSource;
  store: RhythmStateStore;
  runTurn: AutonomousTurnRunner;
  send: ProactiveSender;
  /** The serving Session the turn ran in; recorded so an old button after a restart is recognised as stale. */
  currentSessionId(): string | null;
  /** Fresh deterministic facts for signals; absent → rituals only, no exceptions. */
  collectFacts?: () => Promise<SignalFacts>;
  newRef?: () => string;
  log?: (line: string) => void;
}

export interface DeliveryAttemptReport {
  key: string;
  kind: ProactiveKind;
  status: DeliveryRecord["status"];
}

export interface TickReport {
  status:
    | "disabled"
    | "read_only_boundary_missing"
    | "config_disabled"
    | "config_unavailable"
    | "state_unavailable"
    | "error"
    | "busy"
    | "ran";
  modelCalls: number;
  sends: number;
  delivery?: DeliveryAttemptReport;
  exceptionDecision?: string;
  configWarnings?: string[];
}

function exceptionKey(date: string, signals: readonly Signal[]): string {
  const digest = createHash("sha256").update(signals.map(occurrenceHandle).sort().join("\n")).digest("hex").slice(0, 12);
  return `exception:${date}:${digest}`;
}

/** When a delivered or possibly-delivered message reached Daniel. Never `updatedAt`: recovery rewrites it. */
function deliveredAt(record: DeliveryRecord): string {
  return record.sentAt ?? record.sendStartedAt ?? record.createdAt;
}

/** Confirmed and possibly-delivered exceptions both count against the daily caps. */
function exceptionHistory(state: RhythmState): ExceptionHistoryEntry[] {
  return Object.values(state.deliveries)
    .filter((record) => record.kind === "exception" && (record.status === "sent" || record.status === "ambiguous" || record.status === "blocked"))
    .map((record) => ({ sentAt: deliveredAt(record), severity: record.severity ?? "medium" }));
}

function lastRitualSentToday(state: RhythmState, today: string): string | null {
  const times = Object.values(state.deliveries)
    .filter((record) => record.kind !== "exception" && record.key.endsWith(`:${today}`) && (record.status === "sent" || record.status === "ambiguous"))
    .map(deliveredAt)
    .sort();
  return times.at(-1) ?? null;
}

export interface RhythmScheduler {
  /** One evaluation. Single-flight: an overlapping call returns `busy` without doing anything. */
  tick(): Promise<TickReport>;
}

export function createRhythmScheduler(deps: RhythmTickDeps): RhythmScheduler {
  const log = deps.log ?? (() => {});
  const newRef = deps.newRef ?? newDeliveryRef;
  let running = false;
  let recovered = false;

  async function attempt(
    state: RhythmState,
    key: string,
    kind: ProactiveKind,
    origin: AutonomousTurnRequest["origin"],
    prompt: string,
    report: TickReport,
    extra: Partial<DeliveryRecord> = {},
  ): Promise<{ state: RhythmState; outcome: DeliveryRecord["status"] }> {
    const previous = state.deliveries[key];
    const stamp = () => deps.now().toISOString();
    let record: DeliveryRecord = {
      key,
      kind,
      status: "claimed",
      attempts: (previous?.attempts ?? 0) + 1,
      ref: previous?.ref ?? newRef(),
      sessionId: deps.currentSessionId(),
      createdAt: previous?.createdAt ?? stamp(),
      updatedAt: stamp(),
      actions: [],
      ...extra,
    };
    const persist = async () => {
      state = await deps.store.update((current) => ({ ...current, deliveries: { ...current.deliveries, [key]: record } }));
    };
    // Durable intent before any model call or send.
    await persist();

    let result: AutonomousTurnResult;
    try {
      report.modelCalls += 1;
      result = await deps.runTurn({ origin, occurrenceKey: key, kind, prompt });
    } catch {
      // Never re-run a turn blindly: it may have done something before failing.
      record = { ...record, status: "failed", failure: "turn_failed", retryable: false, updatedAt: stamp() };
      await persist();
      log(`[rhythm] ${key} turn_failed`);
      return { state, outcome: record.status };
    }

    const violations = autonomousWriteViolations(result.toolUses);
    let message: OutboundMessage;
    let sentStatus: DeliveryRecord["status"] = "sent";
    if (violations.length > 0) {
      message = { text: AUTONOMOUS_WRITE_NOTICE, actions: [] };
      sentStatus = "blocked";
      log(`[rhythm] ${key} autonomous_write_detected tools=${violations.map((v) => v.name).join(",")}`);
    } else if (origin === "rhythm_exception" && isSilentReply(result.reply)) {
      record = { ...record, status: "silent", updatedAt: stamp() };
      await persist();
      return { state, outcome: record.status };
    } else if (result.reply.trim() === "" || isSilentReply(result.reply)) {
      // A ritual always speaks (quiet day = tiny brief); an empty/SILENT ritual reply is a turn failure.
      record = { ...record, status: "failed", failure: "empty_reply", retryable: false, updatedAt: stamp() };
      await persist();
      return { state, outcome: record.status };
    } else {
      message = { text: boundTelegramText(result.reply), actions: buttonsFor(kind) };
    }

    // Durable "send started" before the Telegram call: a crash from here on is ambiguous, never resent.
    record = { ...record, status: "sending", actions: [...message.actions], sessionId: deps.currentSessionId(), sendStartedAt: stamp(), updatedAt: stamp() };
    await persist();

    let outcome: SendOutcome;
    try {
      outcome = await deps.send(message, record.ref);
    } catch {
      outcome = { status: "unknown", reason: "send_threw" };
    }
    if (outcome.status === "sent") {
      report.sends += 1;
      record = { ...record, status: sentStatus, sentAt: stamp(), telegramMessageId: outcome.messageId, updatedAt: stamp() };
    } else if (outcome.status === "rejected") {
      record = { ...record, status: "failed", failure: `telegram_rejected:${outcome.reason}`.slice(0, 80), retryable: true, updatedAt: stamp() };
    } else {
      record = { ...record, status: "ambiguous", failure: `send_unknown:${outcome.reason}`.slice(0, 80), retryable: false, updatedAt: stamp() };
    }
    await persist();
    log(`[rhythm] ${key} ${record.status}`);
    return { state, outcome: record.status };
  }

  async function tickOnce(): Promise<TickReport> {
    const report: TickReport = { status: "ran", modelCalls: 0, sends: 0 };
    // Kill switch first: disabled means no config read, no state write, no model call, no send.
    if (!deps.activation.enabled) return { ...report, status: "disabled" };
    // Even when switched on, autonomous turns run only behind a genuine pre-execution read-only boundary.
    if (deps.readOnlyBoundary !== "pre_execution") return { ...report, status: "read_only_boundary_missing" };

    let configText: string | null;
    try {
      configText = await deps.configSource.read();
    } catch {
      log("[rhythm] config_unavailable");
      return { ...report, status: "config_unavailable" };
    }
    const parsed = parseRhythmConfig(configText);
    const { config } = parsed;
    report.configWarnings = parsed.warnings;
    if (!config.enabled) return { ...report, status: "config_disabled" };

    let state: RhythmState;
    try {
      state = await deps.store.load();
    } catch (error) {
      log(`[rhythm] state_unavailable ${error instanceof RhythmStateError ? error.message : "error"}`);
      return { ...report, status: "state_unavailable" };
    }
    const now = deps.now();
    if (!recovered) {
      state = await deps.store.update((current) => recoverRhythmState(current, now));
      recovered = true;
    }
    const today = kyivLocal(now).date;

    let signals: Signal[] = [];
    if (deps.collectFacts) {
      try {
        const detected = detectSignals(await deps.collectFacts(), now, config);
        state = await deps.store.update((current) => ({ ...current, signals: advanceSignalLedger(current.signals, detected, now) }));
        signals = detected;
      } catch {
        log("[rhythm] facts_unavailable");
        signals = [];
      }
    }

    // Rituals first; at most one proactive message per tick.
    for (const ritual of evaluateRituals(now, config)) {
      if (ritual.status !== "due" || !mayAttempt(state.deliveries[ritual.key])) continue;
      const prompt = buildRitualPrompt(ritual, config, ritualObservations(signals, config, now), now);
      const result = await attempt(state, ritual.key, ritual.kind, "rhythm_ritual", prompt, report);
      return { ...report, delivery: { key: ritual.key, kind: ritual.kind, status: result.outcome } };
    }

    if (!deps.collectFacts) return report;
    const history = exceptionHistory(state);
    // Today's only: a record stuck from an earlier day (until restart recovery) must not block exceptions forever.
    const inFlight = Object.values(state.deliveries).some(
      (record) => record.kind === "exception" && record.key.startsWith(`exception:${today}:`) && (record.status === "claimed" || record.status === "sending"),
    );
    const decision = selectException({
      now,
      config,
      signals,
      ledger: state.signals,
      exceptionsSent: history,
      lastRitualSentAt: lastRitualSentToday(state, today),
      exceptionInFlight: inFlight,
    });
    report.exceptionDecision = decision.decision === "consider" ? "consider" : `${decision.decision}:${decision.reason}`;
    if (decision.decision !== "consider") return report;

    const key = exceptionKey(today, decision.signals);
    if (!mayAttempt(state.deliveries[key])) return report;
    const result = await attempt(state, key, "exception", "rhythm_exception", buildExceptionPrompt(decision.signals, now), report, {
      severity: decision.severity,
      signalHandles: decision.signals.map(occurrenceHandle),
    });
    const raised: "evaluated" | "notified" | null =
      result.outcome === "silent"
        ? "evaluated"
        : // An ambiguous send may be on screen: treat it as raised so it is never repeated.
          result.outcome === "sent" || result.outcome === "ambiguous" || result.outcome === "blocked"
          ? "notified"
          : null;
    if (raised !== null) {
      await deps.store.update((current) => ({ ...current, signals: markSignals(current.signals, decision.signals, raised, now) }));
    }
    return { ...report, delivery: { key, kind: "exception", status: result.outcome } };
  }

  return {
    async tick() {
      if (running) return { status: "busy", modelCalls: 0, sends: 0 };
      running = true;
      try {
        return await tickOnce();
      } catch {
        // Fail closed: a state write that failed mid-attempt leaves `claimed` (nothing sent; may retry)
        // or `sending` (never resent). The tick itself never throws into the caller's timer.
        log("[rhythm] tick_error");
        return { status: "error", modelCalls: 0, sends: 0 };
      } finally {
        running = false;
      }
    },
  };
}
