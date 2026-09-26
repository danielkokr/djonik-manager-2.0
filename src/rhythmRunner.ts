import { createHash } from "node:crypto";
import {
  describeRhythmConfig,
  formatLocalTime,
  parseRhythmConfig,
  type RhythmActivation,
  type RhythmConfig,
  type RhythmConfigSource,
} from "./rhythmConfig.js";
import { boundTelegramText, buttonsFor, RHYTHM_ACTIONS, type OutboundMessage, type ProactiveKind } from "./rhythmActions.js";
import { evaluateRituals, isQuietTime, kyivLocal, WEEKDAY_UK, type RitualKind, type RitualOccurrence } from "./rhythmSchedule.js";
import {
  advanceSignalLedger,
  detectSignals,
  markExceptionFailed,
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
  remindersOf,
  RhythmStateError,
  withReminders,
  type DeliveryRecord,
  type RhythmState,
  type RhythmStateStore,
} from "./rhythmState.js";
import {
  beginRitualSend,
  claimedBy,
  claimForRitual,
  releaseRitualClaims,
  ritualReminderBlock,
  settleRitualSend,
  type CardContext,
  type Reminder,
  type ReminderLedger,
} from "./reminders.js";
import type { ConfirmationRecord } from "./toolConfirmation.js";
import type { TurnOrigin } from "./turnAuthority.js";

/**
 * Working Rhythm scheduler tick (#39). Orchestrates the pure pieces — config, schedule, signals,
 * limits, delivery state — around two injected effects: one autonomous Djonik turn and one Telegram
 * send. It holds no conversation logic: Claude composes every brief/review/exception in the normal
 * serving Session, following the `pm-rhythm` Skill.
 *
 * Wired into `telegramCli.ts` through `rhythmRuntime.ts` (docs/62), behind two locks: the
 * `DJONIK_WORKING_RHYTHM` switch (unset in production) and a genuine pre-execution read-only boundary. Since
 * #39 Stage 3A the client can deny gated tools before execution; serving r27 gates every reviewed mutating
 * tool, so the boundary is pre-execution from the Stage 3B-3A cutover (docs/66; r26 gated none, docs/63).
 * Activation (the switch) is a separate, authorized stage.
 */

/**
 * The four ways a turn can start (defined once in `turnAuthority.ts`, which also maps each origin to its
 * mutation authority). Only `user_message` and `button_callback` are Daniel's; both reach Djonik through the
 * same grouping buffer and FIFO Session queue. The two rhythm origins are autonomous and read-only.
 */
export type { TurnOrigin };

export interface ToolUseRecord {
  kind: "mcp" | "builtin" | "custom";
  name: string;
  /** Custom tools only: the client proved from this call's own input that it cannot change anything (#54: a
   *  `reminder` `list`). Absent = treat as a possible mutation. */
  readOnly?: boolean;
}

/** A tool confirmation the turn runner answered (#39 Stage 3A) — content-free. */
export type { ConfirmationRecord };

export interface AutonomousTurnRequest {
  origin: Extract<TurnOrigin, "rhythm_ritual" | "rhythm_exception">;
  occurrenceKey: string;
  kind: ProactiveKind;
  prompt: string;
}

export interface AutonomousTurnResult {
  /** The final visible reply (#38 final-only: never an interim `agent.message`). */
  reply: string;
  /** The Session that actually produced `reply`. The delivery record is bound to it, never to whatever
   *  Session happens to be current afterwards, so a button under this message goes stale on any change. */
  sessionId: string;
  /** Every tool the turn invoked, for the read-only guard. */
  toolUses: ToolUseRecord[];
  /** Tool confirmations the runner answered (a pre-execution boundary denies every one in these turns). */
  confirmations?: ConfirmationRecord[];
  /** The turn requested a gated (mutating) tool. It was denied before execution; the attempt still blocks. */
  autonomousMutationAttempt?: boolean;
}

/**
 * A scheduled turn that failed after possibly invoking tools. The runner still applies the read-only guard
 * to `toolUses`: a failed turn that tried to write gets the same fixed notice as a completed one.
 */
export class AutonomousTurnFailure extends Error {
  constructor(
    readonly toolUses: ToolUseRecord[],
    readonly sessionId: string | null,
    readonly autonomousMutationAttempt = false,
  ) {
    super("autonomous turn failed");
    this.name = "AutonomousTurnFailure";
  }
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
 * `trello_work_history` or a call the client proved read-only from its input (#54 `reminder` `list`). This is the
 * post-hoc detector: a violating turn's text is never delivered; a fixed notice tells Daniel instead. Under a
 * pre-execution release the same rule applies to a gated call the client denied
 * (`AutonomousTurnResult.autonomousMutationAttempt`): prevented, but still a violation. A `reminder` mutation in an
 * autonomous turn is refused by its executor before any state access — prevented, and still a violation here.
 */
export function autonomousWriteViolations(toolUses: readonly ToolUseRecord[]): ToolUseRecord[] {
  return toolUses.filter((use) => {
    if (use.kind === "mcp") return MUTATING_MCP_NAME.test(use.name);
    if (use.kind === "builtin") return use.name === "write" || use.name === "edit";
    return !READ_ONLY_CUSTOM_TOOLS.has(use.name) && use.readOnly !== true;
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

/** Content-free identity of a set of `/rhythm.md` warnings; null when there are none. */
export function configNoticeDigest(warnings: readonly string[]): string | null {
  if (warnings.length === 0) return null;
  return createHash("sha256").update([...warnings].sort().join("\n")).digest("hex").slice(0, 16);
}

export function buildRitualPrompt(
  ritual: RitualOccurrence,
  config: RhythmConfig,
  observations: readonly Signal[],
  now: Date,
  configWarnings: readonly string[] = [],
  reminders: readonly Reminder[] = [],
): string {
  const lines = [
    `[Робочий ритм · автоматичний хід · ${RITUAL_SECTION[ritual.kind]} · ${kyivLabel(now, true)}]`,
    `Це запланований хід, а не повідомлення від Daniel. Склади повідомлення за Skill pm-rhythm, розділ «${RITUAL_SECTION[ritual.kind]}», зі свіжим Trello.`,
    READ_ONLY_RULES,
    "Твоя відповідь піде Daniel як є, одним повідомленням.",
    buttonLine(ritual.kind),
    `Налаштування ритму: ${describeRhythmConfig(config)}.`,
  ];
  if (reminders.length > 0) {
    // #54: code prepends these lines itself (a guaranteed fact, never a hint the model may drop).
    lines.push(
      "Нагадування, які Daniel просив на сьогодні: код сам поставить їх першими рядками цього повідомлення. Не повторюй їх; " +
        "врахуй у плані, якщо стосуються. Не створюй, не скасовуй і не перенось нагадування в цьому ході:",
      ...reminders.map((reminder) => `- ${reminder.text}${reminder.project ? ` (${reminder.project})` : ""}`),
    );
  }
  if (observations.length > 0) {
    lines.push("Підказки коду (перевір свіжим Trello; це не готові висновки):", ...hintLines(observations));
  }
  if (configWarnings.length > 0) {
    lines.push(
      "У /rhythm.md є значення, які не вдалося застосувати; для них діють дефолти. Одним реченням наприкінці скажи про це Daniel " +
        "і запропонуй виправити словами (сам /rhythm.md у цьому ході не змінюй):",
      ...configWarnings.map((warning) => `- ${warning}`),
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** The next ritual still to come today, if any: the one an exception would otherwise wait for. */
export interface NextRitual {
  kind: RitualKind;
  scheduledMinutes: number;
}

function nextRitualLine(next: NextRitual | null | undefined): string {
  if (next === undefined) return "";
  if (next === null) return "Сьогодні запланованих ритуалів більше немає; наступний — ранковий хід наступного робочого дня.";
  return `Наступний ритуал сьогодні: ${RITUAL_SECTION[next.kind]} о ${formatLocalTime(next.scheduledMinutes)}.`;
}

export function buildExceptionPrompt(signals: readonly Signal[], now: Date, nextRitual?: NextRitual | null): string {
  return [
    `[Робочий ритм · автоматичний хід · можливий виняток · ${kyivLabel(now, true)}]`,
    "Код знайшов факти, які, можливо, не можуть чекати наступного ритуалу. Перевір їх свіжим Trello і за Skill pm-rhythm (розділ «винятки») виріши, чи писати зараз.",
    nextRitualLine(nextRitual),
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
 * - `pre_execution`: writes are impossible before they run: the Agent's mutating tools are `always_ask` and
 *   the client denies every confirmation in an autonomous turn (#39 Stage 3A). Derived from the served
 *   release (`readOnlyBoundaryFor` in `rhythmRuntime.ts`); serving r27 qualifies, r25/r26 do not.
 * - `post_hoc_detection_only`: `autonomousWriteViolations` can only notice a provider-side write after
 *   it happened and withhold the message. That is not prevention.
 *
 * INVARIANT (docs/61 §12–§13): Working Rhythm must not be activated in production until a later bounded
 * stage establishes a genuine pre-execution read-only boundary for autonomous ritual/exception turns.
 * The scheduler enforces it: with anything but `pre_execution` it makes no model call and sends nothing.
 */
export type AutonomousReadOnlyBoundary = "pre_execution" | "post_hoc_detection_only";

/** Default cadence for exception-only fact collection (see `RhythmTickDeps.factsIntervalMs`). */
export const DEFAULT_FACTS_INTERVAL_MS = 15 * 60_000;

export interface RhythmTickDeps {
  activation: RhythmActivation;
  /** Declared by the wiring for its `runTurn`; see `AutonomousReadOnlyBoundary`. */
  readOnlyBoundary: AutonomousReadOnlyBoundary;
  now(): Date;
  configSource: RhythmConfigSource;
  store: RhythmStateStore;
  runTurn: AutonomousTurnRunner;
  send: ProactiveSender;
  /** Fresh deterministic facts for signals; absent → rituals only, no exceptions. */
  collectFacts?: (context: { now: Date; config: RhythmConfig }) => Promise<SignalFacts>;
  /**
   * Minimum time between fact collections that serve only exception checks (default 15 min). A due ritual
   * always collects fresh facts; outside an exception window (off, quiet hours, non-workday without
   * weekend exceptions) nothing is collected unless a ritual is due.
   */
  factsIntervalMs?: number;
  newRef?: () => string;
  log?: (line: string) => void;
  /**
   * Startup recovery on the first tick (default true). The serving runtime recovers the shared state file once
   * itself, before either the rhythm or the reminder scheduler acts, and passes false (#54).
   */
  recoverOnFirstTick?: boolean;
  /** Fresh read-only card state for a card-linked reminder in a morning ritual (#54); failure = no context. */
  reminderCardContext?: (cardId: string) => Promise<CardContext | null>;
}

/** The rituals that carry date-only reminders (#54): the morning of a work day. */
export const REMINDER_RITUALS: ReadonlySet<RitualKind> = new Set(["monday-plan", "morning", "friday-morning"]);

const CARD_CONTEXT_TIMEOUT_MS = 3_000;

async function cardContexts(reminders: readonly Reminder[], lookup: RhythmTickDeps["reminderCardContext"]): Promise<Map<string, CardContext | null>> {
  const contexts = new Map<string, CardContext | null>();
  if (!lookup) return contexts;
  for (const reminder of reminders) {
    if (!reminder.card || contexts.has(reminder.card.id)) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const context = await Promise.race([
      lookup(reminder.card.id).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CARD_CONTEXT_TIMEOUT_MS);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    contexts.set(reminder.card.id, context);
  }
  return contexts;
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
  /** Date-only reminders the due ritual claimed (#54). */
  remindersClaimed?: number;
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
  /** The config under which rituals could run at the last tick; null when none could (off, disabled, unreadable)
   *  — then a date-only reminder never waits for a ritual (#54). */
  ritualConfig(): RhythmConfig | null;
}

export function createRhythmScheduler(deps: RhythmTickDeps): RhythmScheduler {
  const log = deps.log ?? (() => {});
  const newRef = deps.newRef ?? newDeliveryRef;
  const factsIntervalMs = deps.factsIntervalMs ?? DEFAULT_FACTS_INTERVAL_MS;
  let running = false;
  let recovered = false;
  let ritualConfig: RhythmConfig | null = null;
  /** In-memory cadence only (not task state): when facts were last requested. */
  let lastFactsAt: number | null = null;

  async function attempt(
    state: RhythmState,
    key: string,
    kind: ProactiveKind,
    origin: AutonomousTurnRequest["origin"],
    prompt: string,
    report: TickReport,
    extra: Partial<DeliveryRecord> = {},
    carriesReminders = false,
  ): Promise<{ state: RhythmState; outcome: DeliveryRecord["status"] }> {
    const previous = state.deliveries[key];
    const stamp = () => deps.now().toISOString();
    let record: DeliveryRecord = {
      key,
      kind,
      status: "claimed",
      attempts: (previous?.attempts ?? 0) + 1,
      ref: previous?.ref ?? newRef(),
      // Unknown until the turn reports the Session that produced its reply.
      sessionId: null,
      createdAt: previous?.createdAt ?? stamp(),
      updatedAt: stamp(),
      actions: [],
      ...extra,
    };
    /** Writes the record — and, for a ritual carrying reminders (#54), their transition — in ONE atomic update. */
    const persist = async (reminders?: (ledger: ReminderLedger) => ReminderLedger) => {
      state = await deps.store.update((current) => {
        const next = { ...current, deliveries: { ...current.deliveries, [key]: record } };
        return carriesReminders && reminders ? withReminders(next, reminders(remindersOf(next))) : next;
      });
    };
    /** Nothing will be sent for this occurrence: its reminder claims go back to direct delivery. */
    const release = (ledger: ReminderLedger) => releaseRitualClaims(ledger, key, deps.now());
    // Durable intent before any model call or send.
    await persist();

    let result: AutonomousTurnResult;
    try {
      report.modelCalls += 1;
      result = await deps.runTurn({ origin, occurrenceKey: key, kind, prompt });
    } catch (error) {
      // Never re-run a turn blindly: it may have done something before failing. A failed turn that tried to
      // write still gets the fixed notice (below); any other failure is silent here and logged.
      const failure = error instanceof AutonomousTurnFailure ? error : null;
      const attempted = failure !== null && (failure.autonomousMutationAttempt || autonomousWriteViolations(failure.toolUses).length > 0);
      if (!attempted) {
        record = { ...record, status: "failed", failure: "turn_failed", retryable: false, updatedAt: stamp() };
        await persist(release);
        log(`[rhythm] ${key} turn_failed`);
        return { state, outcome: record.status };
      }
      result = { reply: "", sessionId: failure.sessionId ?? "", toolUses: failure.toolUses, autonomousMutationAttempt: failure.autonomousMutationAttempt };
    }

    const violations = autonomousWriteViolations(result.toolUses);
    let message: OutboundMessage;
    let sentStatus: DeliveryRecord["status"] = "sent";
    if (violations.length > 0 || result.autonomousMutationAttempt === true) {
      // Denied before execution (pre-execution boundary) or detected after the fact: either way the attempt is
      // a safety violation, the model's text is never delivered and Daniel gets the fixed notice.
      message = { text: AUTONOMOUS_WRITE_NOTICE, actions: [] };
      sentStatus = "blocked";
      const names = [...new Set([...violations.map((v) => v.name), ...(result.confirmations ?? []).map((c) => c.name)])];
      log(`[rhythm] ${key} autonomous_write_${result.autonomousMutationAttempt === true ? "denied" : "detected"} tools=${names.join(",")}`);
    } else if (origin === "rhythm_exception" && isSilentReply(result.reply)) {
      record = { ...record, status: "silent", updatedAt: stamp() };
      await persist(release);
      return { state, outcome: record.status };
    } else if (result.reply.trim() === "" || isSilentReply(result.reply)) {
      // A ritual always speaks (quiet day = tiny brief); an empty/SILENT ritual reply is a turn failure.
      record = { ...record, status: "failed", failure: "empty_reply", retryable: false, updatedAt: stamp() };
      await persist(release);
      return { state, outcome: record.status };
    } else {
      message = { text: boundTelegramText(result.reply), actions: buttonsFor(kind) };
    }

    // Durable "send started" before the Telegram call: a crash from here on is ambiguous, never resent.
    record = {
      ...record,
      status: "sending",
      actions: [...message.actions],
      // The exact Session that produced this reply (a blocked notice has no buttons; its id is informational).
      sessionId: result.sessionId === "" ? null : result.sessionId,
      sendStartedAt: stamp(),
      updatedAt: stamp(),
    };
    // #54: the reminders this ritual still holds become `sending` in the SAME write as the record, and their
    // code-owned lines lead the message — the model's reply or the fixed notice alike. A reminder cancelled or
    // moved while the turn ran has lost its claim and is not included.
    let included: Reminder[] = [];
    const cards = carriesReminders ? await cardContexts(claimedBy(remindersOf(state), key), deps.reminderCardContext) : new Map<string, CardContext | null>();
    await persist((ledger) => {
      const begun = beginRitualSend(ledger, key, deps.now());
      included = begun.included;
      return begun.ledger;
    });
    if (included.length > 0) message = { ...message, text: boundTelegramText(`${ritualReminderBlock(included, cards)}\n\n${message.text}`) };

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
    const settled = outcome;
    await persist((ledger) => settleRitualSend(ledger, key, settled, deps.now()));
    log(`[rhythm] ${key} ${record.status}`);
    return { state, outcome: record.status };
  }

  async function tickOnce(): Promise<TickReport> {
    const report: TickReport = { status: "ran", modelCalls: 0, sends: 0 };
    ritualConfig = null;
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
    if (!recovered && deps.recoverOnFirstTick !== false) state = await deps.store.update((current) => recoverRhythmState(current, now));
    recovered = true;
    const local = kyivLocal(now);
    const today = local.date;
    // From here on rituals can run under `config`: a date-only reminder may wait for its morning ritual (#54).
    ritualConfig = config;

    // Rituals first; at most one proactive message per tick.
    const rituals = evaluateRituals(now, config);
    const dueRitual = rituals.find((ritual) => ritual.status === "due" && mayAttempt(state.deliveries[ritual.key]));
    const exceptionWindowOpen =
      config.exceptions.enabled &&
      config.exceptions.maxPerDay > 0 &&
      !isQuietTime(local.minutes, config.quietHours) &&
      (config.workdays.includes(local.weekday) || config.exceptions.weekends);
    const factsDue =
      deps.collectFacts !== undefined &&
      (dueRitual !== undefined || (exceptionWindowOpen && (lastFactsAt === null || now.getTime() - lastFactsAt >= factsIntervalMs)));

    let signals: Signal[] = [];
    let factsCollected = false;
    if (factsDue) {
      lastFactsAt = now.getTime();
      try {
        const detected = detectSignals(await deps.collectFacts!({ now, config }), now, config);
        state = await deps.store.update((current) => ({ ...current, signals: advanceSignalLedger(current.signals, detected, now) }));
        signals = detected;
        factsCollected = true;
      } catch {
        log("[rhythm] facts_unavailable");
        signals = [];
      }
    }

    if (dueRitual) {
      // A changed set of /rhythm.md warnings is mentioned once, inside the next ritual — never on its own.
      const notice = configNoticeDigest(parsed.warnings);
      const noteWarnings = notice !== null && state.configNotice?.digest !== notice;
      // #54: a morning ritual claims today's date-only reminders before its turn, so the prompt can name them and no
      // other worker delivers them meanwhile. The claim, the send and its outcome are atomic with the ritual record.
      const carriesReminders = REMINDER_RITUALS.has(dueRitual.kind);
      let claimed: Reminder[] = [];
      if (carriesReminders) {
        state = await deps.store.update((current) => {
          const result = claimForRitual(remindersOf(current), dueRitual.key, today, now);
          claimed = result.claimed;
          return result.claimed.length > 0 ? withReminders(current, result.ledger) : current;
        });
        if (claimed.length > 0) report.remindersClaimed = claimed.length;
      }
      const prompt = buildRitualPrompt(dueRitual, config, ritualObservations(signals, config, now), now, noteWarnings ? parsed.warnings : [], claimed);
      const result = await attempt(state, dueRitual.key, dueRitual.kind, "rhythm_ritual", prompt, report, {}, carriesReminders);
      if (noteWarnings && (result.outcome === "sent" || result.outcome === "ambiguous")) {
        await deps.store.update((current) => ({ ...current, configNotice: { digest: notice, notedAt: now.toISOString() } }));
      }
      return { ...report, delivery: { key: dueRitual.key, kind: dueRitual.kind, status: result.outcome } };
    }
    if (parsed.warnings.length === 0 && state.configNotice !== undefined) {
      // Warnings fixed: forget the note, so a later, reintroduced problem is mentioned again.
      state = await deps.store.update(({ configNotice: _cleared, ...current }) => current);
    }

    if (!factsCollected || !exceptionWindowOpen) return report;
    const history = exceptionHistory(state);
    // Today's only: a record stuck from an earlier day (until restart recovery) must not block exceptions forever.
    const inFlight = Object.values(state.deliveries).some(
      (record) => record.kind === "exception" && record.key.startsWith(`exception:${today}:`) && (record.status === "claimed" || record.status === "sending"),
    );
    // The next ritual still to come today (the due one, if any, was handled above). `evaluateRituals` is sorted.
    const upcoming = rituals.find((ritual) => ritual.status === "not_yet" && mayAttempt(state.deliveries[ritual.key]));
    const nextRitual: NextRitual | null = upcoming ? { kind: upcoming.kind, scheduledMinutes: upcoming.scheduledMinutes } : null;
    const decision = selectException({
      now,
      config,
      signals,
      ledger: state.signals,
      exceptionsSent: history,
      lastRitualSentAt: lastRitualSentToday(state, today),
      exceptionInFlight: inFlight,
      minutesToNextRitual: nextRitual ? nextRitual.scheduledMinutes - local.minutes : null,
    });
    report.exceptionDecision = decision.decision === "consider" ? "consider" : `${decision.decision}:${decision.reason}`;
    if (decision.decision !== "consider") return report;

    const key = exceptionKey(today, decision.signals);
    if (!mayAttempt(state.deliveries[key])) return report;
    const result = await attempt(state, key, "exception", "rhythm_exception", buildExceptionPrompt(decision.signals, now, nextRitual), report, {
      severity: decision.severity,
      signalHandles: decision.signals.map(occurrenceHandle),
    });
    // An occurrence that ended without delivery and may not retry (failed turn, empty reply, refused twice):
    // nothing reached Daniel, so its signals stay `open` but are blocked for the rest of this Kyiv day. Same day,
    // a later tick cannot regroup them under a new key and pay for another turn; a later day (a weekend high
    // exception when enabled, or the next ritual) may still raise them. Never used for ambiguous sends.
    if (result.outcome === "failed" && !mayAttempt(result.state.deliveries[key])) {
      await deps.store.update((current) => ({ ...current, signals: markExceptionFailed(current.signals, decision.signals, now) }));
    }
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
    ritualConfig: () => ritualConfig,
  };
}
