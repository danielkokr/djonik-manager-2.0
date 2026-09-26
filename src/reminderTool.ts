import { DEFAULT_RHYTHM_CONFIG, type RhythmConfig } from "./rhythmConfig.js";
import { remindersOf, withReminders, type RhythmStateStore } from "./rhythmState.js";
import {
  CANCELLABLE,
  cancelConfirmation,
  cancelReminder,
  cleanReminderText,
  createConfirmation,
  createReminder,
  listReminders,
  MAX_CARD_NAME,
  MAX_PROJECT_TEXT,
  MAX_REMINDER_TEXT,
  newReminderId,
  REMINDER_ID_RE,
  RESCHEDULABLE,
  rescheduleConfirmation,
  rescheduleReminder,
  selectReminder,
  TOOL_CALL_RETENTION_DAYS,
  viewReminder,
  type Reminder,
  type ReminderCard,
  type ReminderLedger,
  type ReminderToolCall,
  type Selector,
} from "./reminders.js";
import { resolveReminderWhen, ReminderTimeError, WEEKDAY_CODES, type ReminderSchedule, type ReminderTimeProblem, type ReminderWhen, type WeekdayCode } from "./reminderTime.js";
import type { MutationAuthority } from "./turnAuthority.js";

/**
 * The `reminder` custom tool (#54): Claude's only way to create, list, cancel or move Daniel's reminders.
 *
 * Claude interprets Daniel's words into a structured request; this executor — code — resolves the date
 * (`reminderTime.ts`), stores the reminder (`reminders.ts` in the rhythm state file) and returns the resolved
 * fact plus a ready `confirmation` line. The model repeats that line; the client additionally guarantees it
 * reaches Daniel (`composeReminderConfirmations` in `djonikClient.ts`).
 *
 * Side-effect safety (docs/01 §13 admission rule for a side-effecting custom tool):
 * - authority: create/cancel/snooze run only for a turn with human authority (Daniel's message or his button);
 *   an autonomous Working Rhythm turn is refused BEFORE any state access. `list` is read-only everywhere;
 * - durable idempotency: the `custom_tool_use_id` is the key. Its outcome is written in the same atomic state
 *   write as the mutation (`toolCalls`), so the same id is never applied twice — not by a re-emitted
 *   `requires_action` (#40 already prevents that in-process), not after a reconnect (#53), not after a restart;
 * - postcondition: success is returned only after a fresh read of the state file shows the intended result.
 */

export const REMINDER_TOOL_NAME = "reminder";

export const REMINDER_TOOL = {
  type: "custom" as const,
  name: REMINDER_TOOL_NAME,
  description:
    "Daniel's reminders, stored and delivered by code: once created, the adapter itself messages him in Telegram at the resolved moment, " +
    "even if this Session ends. Use only when Daniel asks to be reminded (create), asks what he asked to be reminded about (list), or asks to " +
    "cancel or move a reminder (cancel / snooze). Pass his day/time words as structured `when`, never a date you computed: 'завтра' " +
    "{day:'tomorrow'}; 'в понеділок' {day:'weekday',weekday:'mon'}; 'о 15' {time:'15:00'}; 'завтра о 9' {day:'tomorrow',time:'09:00'}; " +
    "'28.09' {day:'date',date:'28.09'}; 'через годину' {in_minutes:60}. No time means that day's morning (in the brief or plan). " +
    "`text` is what to remind, in Daniel's words, short. Link `card` only with an id from a fresh Trello read in this turn. " +
    "cancel/snooze: `id` from list, or `match` with one distinctive word. Say saved only when the result is ok, and give its " +
    "`confirmation` line exactly; if it asks for a time or lists several candidates, ask Daniel one short question. A reminder " +
    "never changes Trello and is not a commitment in Memory.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["op"],
    properties: {
      op: { enum: ["create", "list", "cancel", "snooze"] },
      text: { type: "string", minLength: 1, maxLength: MAX_REMINDER_TEXT },
      when: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { enum: ["today", "tomorrow", "day_after_tomorrow", "weekday", "date"] },
          weekday: { enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
          next_week: { type: "boolean" },
          date: { type: "string", maxLength: 10 },
          time: { type: "string", maxLength: 5 },
          in_minutes: { type: "integer", minimum: 1, maximum: 10080 },
        },
      },
      project: { type: "string", minLength: 1, maxLength: MAX_PROJECT_TEXT },
      card: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" }, name: { type: "string", maxLength: MAX_CARD_NAME } },
      },
      id: { type: "string" },
      match: { type: "string", minLength: 2, maxLength: 80 },
      include_history: { type: "boolean" },
    },
  },
};

// --- Input ----------------------------------------------------------------------------------------

export type ReminderToolInput =
  | { op: "create"; text: string; when: ReminderWhen; project: string | null; card: ReminderCard | null }
  | { op: "list"; includeHistory: boolean }
  | { op: "cancel"; selector: Selector }
  | { op: "snooze"; selector: Selector; when: ReminderWhen };

export class ReminderInputError extends Error {}

const TOP_KEYS = new Set(["op", "text", "when", "project", "card", "id", "match", "include_history"]);
const WHEN_KEYS = new Set(["day", "weekday", "next_week", "date", "time", "in_minutes"]);
const DAYS = new Set(["today", "tomorrow", "day_after_tomorrow", "weekday", "date"]);
const TRELLO_ID_RE = /^[0-9a-fA-F]{24}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseWhen(value: unknown): ReminderWhen {
  if (!isRecord(value) || Object.keys(value).some((key) => !WHEN_KEYS.has(key))) throw new ReminderInputError("`when` must be an object with day/weekday/next_week/date/time/in_minutes.");
  const when: ReminderWhen = {};
  if (value.day !== undefined) {
    if (typeof value.day !== "string" || !DAYS.has(value.day)) throw new ReminderInputError("`when.day` is not one of the allowed values.");
    when.day = value.day as ReminderWhen["day"];
  }
  if (value.weekday !== undefined) {
    if (typeof value.weekday !== "string" || !(value.weekday in WEEKDAY_CODES)) throw new ReminderInputError("`when.weekday` must be mon…sun.");
    when.weekday = value.weekday as WeekdayCode;
  }
  if (value.next_week !== undefined) {
    if (typeof value.next_week !== "boolean") throw new ReminderInputError("`when.next_week` must be a boolean.");
    when.next_week = value.next_week;
  }
  for (const key of ["date", "time"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") throw new ReminderInputError(`\`when.${key}\` must be a string.`);
    when[key] = value[key] as string;
  }
  if (value.in_minutes !== undefined) {
    if (typeof value.in_minutes !== "number" || !Number.isInteger(value.in_minutes)) throw new ReminderInputError("`when.in_minutes` must be an integer.");
    when.in_minutes = value.in_minutes;
  }
  return when;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new ReminderInputError(`\`${field}\` must be a string.`);
  const cleaned = cleanReminderText(value);
  if (cleaned.length === 0) return null;
  if (cleaned.length > max) throw new ReminderInputError(`\`${field}\` is too long.`);
  return cleaned;
}

function parseSelector(value: Record<string, unknown>): Selector {
  const hasId = value.id !== undefined;
  const hasMatch = value.match !== undefined;
  if (hasId === hasMatch) throw new ReminderInputError("Give exactly one of `id` or `match`.");
  if (hasId) {
    if (typeof value.id !== "string" || !REMINDER_ID_RE.test(value.id)) throw new ReminderInputError("`id` is not a reminder id from list.");
    return { id: value.id };
  }
  if (typeof value.match !== "string" || cleanReminderText(value.match).length < 2) throw new ReminderInputError("`match` needs a distinctive word.");
  return { match: cleanReminderText(value.match) };
}

export function parseReminderToolInput(value: unknown): ReminderToolInput {
  if (!isRecord(value)) throw new ReminderInputError("Input must be an object.");
  const unknown = Object.keys(value).filter((key) => !TOP_KEYS.has(key));
  if (unknown.length > 0) throw new ReminderInputError(`Unknown field(s): ${unknown.join(", ")}.`);
  switch (value.op) {
    case "list":
      if (value.include_history !== undefined && typeof value.include_history !== "boolean") throw new ReminderInputError("`include_history` must be a boolean.");
      return { op: "list", includeHistory: value.include_history === true };
    case "create": {
      const text = optionalText(value.text, "text", MAX_REMINDER_TEXT);
      if (text === null) throw new ReminderInputError("`text` is required for create.");
      if (value.when === undefined) throw new ReminderInputError("`when` is required for create.");
      let card: ReminderCard | null = null;
      if (value.card !== undefined) {
        if (!isRecord(value.card) || typeof value.card.id !== "string" || !TRELLO_ID_RE.test(value.card.id)) {
          throw new ReminderInputError("`card.id` must be a Trello card id from a fresh read.");
        }
        card = { id: value.card.id, name: optionalText(value.card.name, "card.name", MAX_CARD_NAME) };
      }
      return { op: "create", text, when: parseWhen(value.when), project: optionalText(value.project, "project", MAX_PROJECT_TEXT), card };
    }
    case "cancel":
      return { op: "cancel", selector: parseSelector(value) };
    case "snooze":
      if (value.when === undefined) throw new ReminderInputError("`when` is required for snooze.");
      return { op: "snooze", selector: parseSelector(value), when: parseWhen(value.when) };
    default:
      throw new ReminderInputError("`op` must be create, list, cancel or snooze.");
  }
}

/** A `list` call is the only read-only use; anything else (or unparsable input) counts as a mutation attempt. */
export function isReadOnlyReminderInput(input: unknown): boolean {
  try {
    return parseReminderToolInput(input).op === "list";
  } catch {
    return false;
  }
}

// --- Results --------------------------------------------------------------------------------------

export interface ReminderToolResult {
  isError: boolean;
  content: string;
}

type ErrorCode =
  | "invalid_input"
  | "not_allowed_in_autonomous_turn"
  | "unavailable"
  | "not_found"
  | "several_match"
  | "closed"
  | "already_delivered"
  | "too_many"
  | "not_verified"
  | ReminderTimeProblem;

const ASK: Partial<Record<ErrorCode, string>> = {
  missing_when: "Коли нагадати?",
  in_past: "Цей момент уже минув — на коли нагадати?",
  needs_time: "Сьогоднішній ранок уже минув — о котрій нагадати сьогодні?",
  too_far: "Це більш ніж за рік — на коли нагадати?",
  several_match: "Про яке саме нагадування йдеться?",
};

const MESSAGE: Record<ErrorCode, string> = {
  invalid_input: "The call was malformed; fix it and call again.",
  not_allowed_in_autonomous_turn: "Reminders can be created, cancelled or moved only in Daniel's own turn. Propose it; do not claim it.",
  unavailable: "Reminders are unavailable right now; nothing was saved. Tell Daniel it is not saved.",
  not_found: "No such reminder. See `active`.",
  several_match: "Several reminders match; nothing was changed. Ask Daniel which one (see `candidates`).",
  closed: "That reminder is already done or cancelled; nothing was changed. Create a new one if Daniel wants it.",
  already_delivered: "That reminder was already delivered; nothing to cancel.",
  too_many: "Too many open reminders; nothing was saved.",
  not_verified: "The reminder store could not confirm the change; say it is not confirmed.",
  missing_when: "Daniel gave no day or time; nothing was saved. Ask one short question.",
  invalid_when: "`when` is inconsistent (e.g. in_minutes with a day, or weekday without a weekday); fix the call.",
  invalid_date: "`when.date` is not a valid DD.MM, DD.MM.YYYY or YYYY-MM-DD date; fix the call or ask.",
  invalid_time: "`when.time` must be HH:MM; fix the call or ask.",
  in_past: "That moment has already passed; nothing was saved. Ask Daniel for another moment.",
  needs_time: "Today's morning slot has passed and no time was given; nothing was saved. Ask for a time.",
  too_far: "More than a year ahead; nothing was saved.",
};

function errorResult(op: string, code: ErrorCode, extra: Record<string, unknown> = {}, message = MESSAGE[code]): ReminderToolResult {
  return {
    isError: true,
    content: JSON.stringify({ ok: false, op, error: { code, message }, ...(ASK[code] ? { ask: ASK[code] } : {}), ...extra }),
  };
}

function okResult(payload: Record<string, unknown>): ReminderToolResult {
  return { isError: false, content: JSON.stringify({ ok: true, ...payload }) };
}

function describeReminder(reminder: Reminder, now: Date): Record<string, unknown> {
  const schedule = reminder.schedule;
  return {
    ...viewReminder(reminder, now),
    mode: schedule.mode,
    date: schedule.date,
    time: schedule.mode === "timed" ? schedule.time : null,
    ...(schedule.quietShifted ? { quiet_hours_shift: { requested: schedule.requested.time, delivers_at: schedule.time } } : {}),
    ...(schedule.rolledToTomorrow ? { rolled_to_tomorrow: true } : {}),
    ...(schedule.surface ? { surface: schedule.surface } : {}),
  };
}

// --- Executor -------------------------------------------------------------------------------------

export interface ReminderToolContext {
  toolUseId: string;
  authority: MutationAuthority;
}

export interface ReminderServiceDeps {
  /** The rhythm state file store; null → reminders unavailable (nothing is ever promised). */
  store: RhythmStateStore | null;
  now(): Date;
  /** Parsed `/rhythm.md` (quiet hours, morning time). A failure falls back to the safe defaults. */
  readConfig(): Promise<RhythmConfig>;
  /** Whether morning rituals currently run (only the confirmation's surface hint). */
  ritualsRunning(): boolean;
  newId?: () => string;
  log?: (line: string) => void;
}

export type ReminderToolExecutor = (input: unknown, context: ReminderToolContext) => Promise<ReminderToolResult>;

function pruneToolCalls(ledger: ReminderLedger, now: Date): ReminderLedger {
  const cutoff = now.getTime() - TOOL_CALL_RETENTION_DAYS * 86_400_000;
  return { ...ledger, toolCalls: Object.fromEntries(Object.entries(ledger.toolCalls).filter(([, call]) => Date.parse(call.at) >= cutoff)) };
}

/** The postcondition a fresh read of the state must show before success is reported. */
type Postcondition = (ledger: ReminderLedger) => boolean;

export function createReminderToolExecutor(deps: ReminderServiceDeps): ReminderToolExecutor {
  const log = deps.log ?? (() => {});
  const newId = deps.newId ?? newReminderId;

  async function resolveSchedule(when: ReminderWhen, now: Date): Promise<ReminderSchedule> {
    let config: RhythmConfig;
    try {
      config = await deps.readConfig();
    } catch {
      log("[reminder] config_unavailable_defaults_used");
      config = DEFAULT_RHYTHM_CONFIG;
    }
    return resolveReminderWhen(when, now, config, deps.ritualsRunning());
  }

  return async (rawInput, context) => {
    let input: ReminderToolInput;
    try {
      input = parseReminderToolInput(rawInput);
    } catch (error) {
      const op = isRecord(rawInput) && typeof rawInput.op === "string" ? rawInput.op : "unknown";
      return errorResult(op, "invalid_input", {}, `${MESSAGE.invalid_input} ${error instanceof ReminderInputError ? error.message : ""}`.trim());
    }
    const store = deps.store;
    if (input.op !== "list" && context.authority !== "human") {
      // Refused before any state access: an autonomous rhythm turn only reads and proposes.
      log(`[reminder] ${input.op} refused_autonomous`);
      return errorResult(input.op, "not_allowed_in_autonomous_turn");
    }
    if (store === null) return errorResult(input.op, "unavailable");
    const now = deps.now();

    if (input.op === "list") {
      try {
        const view = listReminders(remindersOf(await store.load()), now, input.includeHistory);
        return okResult({ op: "list", ...view });
      } catch {
        return errorResult("list", "unavailable");
      }
    }

    let schedule: ReminderSchedule | null = null;
    if (input.op === "create" || input.op === "snooze") {
      try {
        schedule = await resolveSchedule(input.when, now);
      } catch (error) {
        if (error instanceof ReminderTimeError) return errorResult(input.op, error.problem);
        throw error;
      }
    }

    const op = input.op;
    let result: ReminderToolResult | null = null;
    let postcondition: Postcondition = () => true;
    try {
      await store.update((state) => {
        const current = remindersOf(state);
        const cached = current.toolCalls[context.toolUseId];
        if (cached) {
          // The same custom_tool_use_id again (replay after reconnect/restart): its recorded result, nothing re-applied.
          result = { isError: cached.isError, content: cached.content };
          postcondition = () => true;
          return state;
        }
        const applied = apply(input, current, schedule, context.toolUseId, now, newId);
        result = applied.result;
        postcondition = applied.postcondition;
        const call: ReminderToolCall = { op, at: now.toISOString(), isError: applied.result.isError, content: applied.result.content };
        return withReminders(state, pruneToolCalls({ ...applied.ledger, toolCalls: { ...applied.ledger.toolCalls, [context.toolUseId]: call } }, now));
      });
    } catch {
      log(`[reminder] ${op} store_unavailable`);
      return errorResult(op, "unavailable");
    }

    // Verify against a fresh read before any success reaches the model.
    const outcome = result as ReminderToolResult | null;
    if (outcome === null) return errorResult(op, "unavailable");
    if (!outcome.isError) {
      let verified = false;
      try {
        verified = postcondition(remindersOf(await store.load()));
      } catch {
        verified = false;
      }
      if (!verified) {
        log(`[reminder] ${op} not_verified`);
        return errorResult(op, "not_verified");
      }
    }
    log(`[reminder] ${op} ${outcome.isError ? "refused" : "ok"}`);
    return outcome;
  };
}

function apply(
  input: Exclude<ReminderToolInput, { op: "list" }>,
  ledger: ReminderLedger,
  schedule: ReminderSchedule | null,
  toolUseId: string,
  now: Date,
  newId: () => string,
): { ledger: ReminderLedger; result: ReminderToolResult; postcondition: Postcondition } {
  const unchanged = (result: ReminderToolResult) => ({ ledger, result, postcondition: () => true });
  const active = () => listReminders(ledger, now, false).active;

  if (input.op === "create") {
    let id = newId();
    while (ledger.items[id]) id = newId();
    const outcome = createReminder(ledger, { id, text: input.text, project: input.project, card: input.card, schedule: schedule!, toolUseId, now });
    if (outcome.kind === "too_many") return unchanged(errorResult("create", "too_many"));
    const duplicate = outcome.kind === "duplicate";
    const reminder = outcome.reminder;
    return {
      ledger: outcome.ledger,
      result: okResult({ op: "create", ...(duplicate ? { duplicate: true } : {}), reminder: describeReminder(reminder, now), confirmation: createConfirmation(reminder, now, duplicate) }),
      postcondition: (fresh) => fresh.items[reminder.id]?.status === "scheduled" && fresh.items[reminder.id]?.schedule.dueAt === reminder.schedule.dueAt,
    };
  }

  const eligible = input.op === "cancel" ? CANCELLABLE : RESCHEDULABLE;
  const selected = selectReminder(ledger, input.selector, eligible);
  if (selected.kind === "none") return unchanged(errorResult(input.op, "not_found", { active: active() }));
  if (selected.kind === "several") return unchanged(errorResult(input.op, "several_match", { candidates: selected.candidates.map((item) => viewReminder(item, now)) }));
  const target = selected.reminder;

  if (input.op === "cancel") {
    if (target.status === "cancelled" || target.status === "done") {
      return unchanged(okResult({ op: "cancel", changed: false, reminder: viewReminder(target, now), confirmation: cancelConfirmation(target) }));
    }
    if (target.status === "delivered" || target.status === "ambiguous") return unchanged(errorResult("cancel", "already_delivered", { reminder: viewReminder(target, now) }));
    const next = cancelReminder(ledger, target.id, now);
    return {
      ledger: next,
      result: okResult({ op: "cancel", reminder: viewReminder(next.items[target.id], now), confirmation: cancelConfirmation(target) }),
      postcondition: (fresh) => fresh.items[target.id]?.status === "cancelled",
    };
  }

  if (!RESCHEDULABLE(target)) return unchanged(errorResult("snooze", "closed", { reminder: viewReminder(target, now) }));
  const next = rescheduleReminder(ledger, target.id, schedule!, now);
  const moved = next.items[target.id];
  return {
    ledger: next,
    result: okResult({ op: "snooze", reminder: describeReminder(moved, now), confirmation: rescheduleConfirmation(moved, now) }),
    postcondition: (fresh) => fresh.items[target.id]?.seq === moved.seq && fresh.items[target.id]?.schedule.dueAt === moved.schedule.dueAt,
  };
}

/** The `confirmation` line of a successful reminder mutation result, or null (list, errors, malformed). */
export function reminderConfirmationOf(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { ok?: unknown; op?: unknown; confirmation?: unknown };
    if (parsed.ok !== true || parsed.op === "list" || typeof parsed.confirmation !== "string" || parsed.confirmation.length === 0) return null;
    return parsed.confirmation;
  } catch {
    return null;
  }
}
