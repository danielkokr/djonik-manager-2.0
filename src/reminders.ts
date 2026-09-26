import { randomBytes } from "node:crypto";
import { kyivLocal } from "./rhythmSchedule.js";
import { dayLabel, scheduleLabel, type ReminderSchedule } from "./reminderTime.js";

/**
 * Daniel's reminders (#54): code-owned, durable, delivered by code. Claude only understands the request; this
 * module owns the reminder's identity, schedule, lifecycle and wording of the delivered message. Pure functions
 * over a small ledger that lives inside the Working Rhythm state file (`rhythmState.ts`, atomic replacement), so a
 * morning ritual can claim a date-only reminder in the SAME atomic write as its own delivery record.
 *
 * It is not Memory, not Trello and not conversation storage: a reminder keeps only its payload (Daniel's short
 * text, optional project and card link), its resolved schedule and delivery facts.
 *
 * Lifecycle of one reminder (`seq` = delivery generation, +1 on every reschedule):
 *
 *   scheduled ──due (direct)──▶ sending ──Telegram ok──▶ delivered ──✅──▶ done
 *      │  ▲                         ├──definite refusal──▶ scheduled (retry) … ▶ failed
 *      │  │                         └──unknown outcome / crash──▶ ambiguous (never resent)
 *      │  └──reschedule (seq+1): scheduled, delivered, ambiguous, failed
 *      ├──claimed by a morning ritual (`ritualClaim`) ──ritual sending──▶ sending (via ritual) ──▶ as above
 *      │     └──ritual failed / crash before send──▶ claim released (direct fallback)
 *      └──cancel──▶ cancelled
 *
 * `sending` is written BEFORE the Telegram call; a crash there becomes `ambiguous` at startup and is never resent.
 */

export type ReminderStatus = "scheduled" | "sending" | "delivered" | "ambiguous" | "failed" | "done" | "cancelled";

export interface ReminderCard {
  id: string;
  /** The card name as Claude read it fresh when linking; display only. */
  name: string | null;
}

export interface Reminder {
  id: string;
  text: string;
  project: string | null;
  card: ReminderCard | null;
  schedule: ReminderSchedule;
  status: ReminderStatus;
  /** Delivery generation: 1 at creation, +1 on every reschedule. Buttons carry it, so an older button is stale. */
  seq: number;
  /** Delivery attempts of the current `seq`. */
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** The `custom_tool_use_id` that created it (provenance; the durable idempotency key is `toolCalls`). */
  createdBy: string;
  /** A morning ritual occurrence composing this reminder into its message; only while `scheduled`. */
  ritualClaim?: { key: string; at: string };
  via?: "direct" | "ritual";
  ritualKey?: string;
  sendStartedAt?: string;
  sentAt?: string;
  telegramMessageId?: number;
  /** Content-free failure category. */
  failure?: string;
  closedAt?: string;
  closedBy?: "tool" | "button";
  /** A button of the current `seq` was accepted (buttons are single-use). */
  answeredAt?: string;
}

/** One side-effecting tool call, keyed by `custom_tool_use_id`: its exact result is replayed, never re-executed. */
export interface ReminderToolCall {
  op: "create" | "cancel" | "snooze";
  at: string;
  isError: boolean;
  content: string;
}

export interface ReminderLedger {
  version: 1;
  items: Record<string, Reminder>;
  toolCalls: Record<string, ReminderToolCall>;
}

export function emptyReminderLedger(): ReminderLedger {
  return { version: 1, items: {}, toolCalls: {} };
}

export const MAX_REMINDER_TEXT = 300;
export const MAX_PROJECT_TEXT = 60;
export const MAX_CARD_NAME = 120;
/** Upper bound of open reminders — a runaway guard, not a product limit. */
export const MAX_OPEN_REMINDERS = 100;
/** Direct send attempts per `seq` for DEFINITE refusals only; an unknown outcome is never retried. */
export const MAX_DIRECT_ATTEMPTS = 3;
/** Closed/delivered reminders and tool-call records are kept this long, then pruned. */
export const REMINDER_RETENTION_DAYS = 30;
export const TOOL_CALL_RETENTION_DAYS = 14;
/** A direct delivery this late notes when it was due. */
export const LATE_NOTE_MINUTES = 30;

const OPEN: ReadonlySet<ReminderStatus> = new Set(["scheduled", "sending", "failed"]);
const STATUSES: ReadonlySet<string> = new Set(["scheduled", "sending", "delivered", "ambiguous", "failed", "done", "cancelled"]);

export function isOpen(reminder: Reminder): boolean {
  return OPEN.has(reminder.status);
}

export function newReminderId(): string {
  return randomBytes(5).toString("hex");
}

export const REMINDER_ID_RE = /^[a-z0-9]{6,16}$/;

/** Lower-case letters/digits only: identity of a text for duplicate detection and `match`. */
export function normalizeReminderText(text: string): string {
  return text.toLocaleLowerCase("uk-UA").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** One line, trimmed: the stored payload. */
export function cleanReminderText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// --- Validation (the state file is data; a malformed ledger fails closed) ---------------------------

export class ReminderLedgerError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptString = (value: unknown) => value === undefined || typeof value === "string";
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value: unknown) => typeof value === "string" && /^\d{2}:\d{2}$/.test(value);

function isSchedule(value: unknown): value is ReminderSchedule {
  if (!isRecord(value) || !isRecord(value.requested) || !isRecord(value.quietHours)) return false;
  return (
    (value.mode === "timed" || value.mode === "morning") &&
    isDate(value.requested.date) &&
    (value.requested.time === null || isTime(value.requested.time)) &&
    isDate(value.date) &&
    isTime(value.time) &&
    isIso(value.dueAt) &&
    typeof value.quietShifted === "boolean" &&
    typeof value.rolledToTomorrow === "boolean" &&
    Number.isInteger(value.quietHours.start) &&
    Number.isInteger(value.quietHours.end) &&
    isOptString(value.surface)
  );
}

function isReminder(key: string, value: unknown): value is Reminder {
  if (!isRecord(value)) return false;
  const card = value.card;
  const claim = value.ritualClaim;
  return (
    value.id === key &&
    REMINDER_ID_RE.test(key) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= MAX_REMINDER_TEXT &&
    (value.project === null || typeof value.project === "string") &&
    (card === null || (isRecord(card) && typeof card.id === "string" && (card.name === null || typeof card.name === "string"))) &&
    isSchedule(value.schedule) &&
    typeof value.status === "string" &&
    STATUSES.has(value.status) &&
    Number.isInteger(value.seq) &&
    (value.seq as number) >= 1 &&
    Number.isInteger(value.attempts) &&
    (value.attempts as number) >= 0 &&
    isIso(value.createdAt) &&
    isIso(value.updatedAt) &&
    typeof value.createdBy === "string" &&
    (claim === undefined || (isRecord(claim) && typeof claim.key === "string" && isIso(claim.at))) &&
    (value.via === undefined || value.via === "direct" || value.via === "ritual") &&
    isOptString(value.ritualKey) &&
    (value.telegramMessageId === undefined || Number.isInteger(value.telegramMessageId))
  );
}

/** Validates a ledger read from disk. Anything unrecognised throws: the caller then sends and saves nothing. */
export function validateReminderLedger(value: unknown): ReminderLedger {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.items) || !isRecord(value.toolCalls)) {
    throw new ReminderLedgerError("reminder ledger has an unknown shape or version");
  }
  for (const [key, item] of Object.entries(value.items)) {
    if (!isReminder(key, item)) throw new ReminderLedgerError("reminder ledger has a malformed reminder");
  }
  for (const call of Object.values(value.toolCalls)) {
    if (
      !isRecord(call) ||
      !["create", "cancel", "snooze"].includes(call.op as string) ||
      !isIso(call.at) ||
      typeof call.isError !== "boolean" ||
      typeof call.content !== "string"
    ) {
      throw new ReminderLedgerError("reminder ledger has a malformed tool-call record");
    }
  }
  return value as unknown as ReminderLedger;
}

// --- Helpers ---------------------------------------------------------------------------------------

function put(ledger: ReminderLedger, reminder: Reminder): ReminderLedger {
  return { ...ledger, items: { ...ledger.items, [reminder.id]: reminder } };
}

function withoutClaim(reminder: Reminder): Reminder {
  const { ritualClaim: _claim, ...rest } = reminder;
  return rest;
}

/** Fields of the previous delivery generation, cleared when a reminder is rescheduled or re-armed. */
function clearDelivery(reminder: Reminder): Reminder {
  const { ritualClaim: _c, via: _v, ritualKey: _k, sendStartedAt: _s, sentAt: _t, telegramMessageId: _m, failure: _f, answeredAt: _a, ...rest } = reminder;
  return rest;
}

export function sortByDue(reminders: readonly Reminder[]): Reminder[] {
  return [...reminders].sort((a, b) => a.schedule.dueAt.localeCompare(b.schedule.dueAt) || a.createdAt.localeCompare(b.createdAt));
}

// --- Tool operations (pure) ------------------------------------------------------------------------

export interface CreateRequest {
  id: string;
  text: string;
  project: string | null;
  card: ReminderCard | null;
  schedule: ReminderSchedule;
  toolUseId: string;
  now: Date;
}

export type CreateOutcome =
  | { kind: "created"; ledger: ReminderLedger; reminder: Reminder }
  /** The same text is already scheduled for the same moment: nothing new is created. */
  | { kind: "duplicate"; ledger: ReminderLedger; reminder: Reminder }
  | { kind: "too_many"; ledger: ReminderLedger };

export function createReminder(ledger: ReminderLedger, request: CreateRequest): CreateOutcome {
  const normalized = normalizeReminderText(request.text);
  const existing = Object.values(ledger.items).find(
    (item) => item.status === "scheduled" && item.schedule.dueAt === request.schedule.dueAt && normalizeReminderText(item.text) === normalized,
  );
  if (existing) return { kind: "duplicate", ledger, reminder: existing };
  if (Object.values(ledger.items).filter(isOpen).length >= MAX_OPEN_REMINDERS) return { kind: "too_many", ledger };
  const stamp = request.now.toISOString();
  const reminder: Reminder = {
    id: request.id,
    text: request.text,
    project: request.project,
    card: request.card,
    schedule: request.schedule,
    status: "scheduled",
    seq: 1,
    attempts: 0,
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: request.toolUseId,
  };
  return { kind: "created", ledger: put(ledger, reminder), reminder };
}

export type Selector = { id: string } | { match: string };

export type SelectOutcome =
  | { kind: "one"; reminder: Reminder }
  | { kind: "none" }
  | { kind: "several"; candidates: Reminder[] };

/**
 * Conservative identity: an exact id, or a `match` that is contained in exactly one eligible reminder's text or
 * project. Several plausible matches are returned, never guessed between.
 */
export function selectReminder(ledger: ReminderLedger, selector: Selector, eligible: (reminder: Reminder) => boolean): SelectOutcome {
  if ("id" in selector) {
    const reminder = ledger.items[selector.id];
    return reminder ? { kind: "one", reminder } : { kind: "none" };
  }
  const needle = normalizeReminderText(selector.match);
  if (needle.length === 0) return { kind: "none" };
  const hits = sortByDue(
    Object.values(ledger.items).filter(
      (item) => eligible(item) && (normalizeReminderText(item.text).includes(needle) || (item.project !== null && normalizeReminderText(item.project) === needle)),
    ),
  );
  if (hits.length === 0) return { kind: "none" };
  if (hits.length === 1) return { kind: "one", reminder: hits[0] };
  return { kind: "several", candidates: hits };
}

/** Reminders `cancel` acts on: not yet delivered. */
export const CANCELLABLE = (reminder: Reminder): boolean => reminder.status === "scheduled" || reminder.status === "failed" || reminder.status === "sending";
/** Reminders `snooze` acts on: anything not closed (a delivered one is re-armed). */
export const RESCHEDULABLE = (reminder: Reminder): boolean => reminder.status !== "done" && reminder.status !== "cancelled";

export function cancelReminder(ledger: ReminderLedger, id: string, now: Date, by: "tool" | "button" = "tool"): ReminderLedger {
  const reminder = ledger.items[id];
  const stamp = now.toISOString();
  return put(ledger, { ...withoutClaim(reminder), status: "cancelled", closedAt: stamp, closedBy: by, updatedAt: stamp });
}

/** Same reminder, new moment: `seq` +1 (older buttons go stale), delivery facts of the old generation cleared. */
export function rescheduleReminder(ledger: ReminderLedger, id: string, schedule: ReminderSchedule, now: Date): ReminderLedger {
  const reminder = clearDelivery(ledger.items[id]);
  return put(ledger, { ...reminder, schedule, status: "scheduled", seq: reminder.seq + 1, attempts: 0, updatedAt: now.toISOString() });
}

export function markReminderDone(ledger: ReminderLedger, id: string, now: Date): ReminderLedger {
  const stamp = now.toISOString();
  return put(ledger, { ...withoutClaim(ledger.items[id]), status: "done", closedAt: stamp, closedBy: "button", answeredAt: stamp, updatedAt: stamp });
}

// --- Ritual composition (morning date-only reminders) --------------------------------------------

/** Claims today's still-unclaimed morning reminders for the ritual occurrence `ritualKey`. */
export function claimForRitual(ledger: ReminderLedger, ritualKey: string, date: string, now: Date): { ledger: ReminderLedger; claimed: Reminder[] } {
  const stamp = now.toISOString();
  let next = ledger;
  const claimed: Reminder[] = [];
  for (const reminder of sortByDue(Object.values(ledger.items))) {
    if (reminder.status !== "scheduled" || reminder.schedule.mode !== "morning" || reminder.schedule.date !== date || claimIsLive(reminder, now)) continue;
    const updated = { ...reminder, ritualClaim: { key: ritualKey, at: stamp }, updatedAt: stamp };
    next = put(next, updated);
    claimed.push(updated);
  }
  return { ledger: next, claimed };
}

export function claimedBy(ledger: ReminderLedger, ritualKey: string): Reminder[] {
  return sortByDue(Object.values(ledger.items).filter((item) => item.status === "scheduled" && item.ritualClaim?.key === ritualKey));
}

/** The ritual message is about to be sent: its still-claimed reminders become `sending` (via ritual). A reminder
 *  cancelled or moved while the ritual turn ran lost its claim and is not included. */
export function beginRitualSend(ledger: ReminderLedger, ritualKey: string, now: Date): { ledger: ReminderLedger; included: Reminder[] } {
  const stamp = now.toISOString();
  let next = ledger;
  const included: Reminder[] = [];
  for (const reminder of claimedBy(ledger, ritualKey)) {
    const updated: Reminder = { ...withoutClaim(reminder), status: "sending", via: "ritual", ritualKey, attempts: reminder.attempts + 1, sendStartedAt: stamp, updatedAt: stamp };
    next = put(next, updated);
    included.push(updated);
  }
  return { ledger: next, included };
}

export type SendSettlement = { status: "sent"; messageId: number } | { status: "rejected"; reason: string } | { status: "unknown"; reason: string };

function settle(reminder: Reminder, outcome: SendSettlement, stamp: string, retryOnRejection: boolean): Reminder {
  if (outcome.status === "sent") {
    return { ...reminder, status: "delivered", sentAt: stamp, telegramMessageId: outcome.messageId, updatedAt: stamp };
  }
  if (outcome.status === "unknown") {
    return { ...reminder, status: "ambiguous", failure: `send_unknown:${outcome.reason}`.slice(0, 80), updatedAt: stamp };
  }
  const failure = `telegram_rejected:${outcome.reason}`.slice(0, 80);
  if (retryOnRejection && reminder.attempts < MAX_DIRECT_ATTEMPTS) {
    const { via: _v, ritualKey: _k, sendStartedAt: _s, ...rest } = reminder;
    return { ...rest, status: "scheduled", failure, updatedAt: stamp };
  }
  return { ...reminder, status: "failed", failure, updatedAt: stamp };
}

/** Outcome of the ritual message for the reminders it carried. A definite refusal hands them back for direct
 *  delivery; an unknown outcome makes them `ambiguous`, exactly like the ritual itself. */
export function settleRitualSend(ledger: ReminderLedger, ritualKey: string, outcome: SendSettlement, now: Date): ReminderLedger {
  const stamp = now.toISOString();
  let next = ledger;
  for (const reminder of Object.values(ledger.items)) {
    if (reminder.status !== "sending" || reminder.via !== "ritual" || reminder.ritualKey !== ritualKey) continue;
    next = put(next, settle(reminder, outcome, stamp, true));
  }
  return next;
}

/** The ritual will send nothing (turn failed, empty reply, crash): its claims are released for direct delivery. */
export function releaseRitualClaims(ledger: ReminderLedger, ritualKey: string, now: Date): ReminderLedger {
  const stamp = now.toISOString();
  let next = ledger;
  for (const reminder of claimedBy(ledger, ritualKey)) next = put(next, { ...withoutClaim(reminder), updatedAt: stamp });
  return next;
}

// --- Direct delivery ----------------------------------------------------------------------------

/**
 * A ritual claim protects a reminder only while that ritual can plausibly still send it. A claim left behind by
 * a ritual whose own state write failed mid-way (no restart to release it) expires, so the reminder is never stuck.
 */
export const RITUAL_CLAIM_TTL_MINUTES = 20;

export function claimIsLive(reminder: Reminder, now: Date): boolean {
  return reminder.ritualClaim !== undefined && now.getTime() - Date.parse(reminder.ritualClaim.at) < RITUAL_CLAIM_TTL_MINUTES * 60_000;
}

/** Scheduled, not held by a live ritual claim, and due at `now`, earliest first. */
export function dueReminders(ledger: ReminderLedger, now: Date): Reminder[] {
  return sortByDue(Object.values(ledger.items).filter((item) => item.status === "scheduled" && !claimIsLive(item, now) && Date.parse(item.schedule.dueAt) <= now.getTime()));
}

/** Durable "send started" for one direct delivery; null when the reminder changed meanwhile (skip it). */
export function beginDirectSend(ledger: ReminderLedger, id: string, seq: number, now: Date): { ledger: ReminderLedger; reminder: Reminder } | null {
  const reminder = ledger.items[id];
  if (!reminder || reminder.seq !== seq || reminder.status !== "scheduled" || claimIsLive(reminder, now)) return null;
  const stamp = now.toISOString();
  const updated: Reminder = { ...withoutClaim(reminder), status: "sending", via: "direct", attempts: reminder.attempts + 1, sendStartedAt: stamp, updatedAt: stamp };
  return { ledger: put(ledger, updated), reminder: updated };
}

/** Records a direct send outcome — only onto the same generation still `sending` (a cancel meanwhile wins). */
export function settleDirectSend(ledger: ReminderLedger, id: string, seq: number, outcome: SendSettlement, now: Date): ReminderLedger {
  const reminder = ledger.items[id];
  if (!reminder || reminder.seq !== seq || reminder.status !== "sending") return ledger;
  return put(ledger, settle(reminder, outcome, now.toISOString(), true));
}

// --- Recovery and retention --------------------------------------------------------------------

/**
 * Startup recovery: a reminder left `sending` may already be on Daniel's screen → `ambiguous`, never resent. A
 * ritual claim left by a crash is released (the ritual retries and re-claims, or direct delivery takes over).
 * Old closed reminders and old tool-call records are pruned; open ones never are.
 */
export function recoverReminders(ledger: ReminderLedger, now: Date): ReminderLedger {
  const stamp = now.toISOString();
  const cutoff = now.getTime() - REMINDER_RETENTION_DAYS * 86_400_000;
  const callCutoff = now.getTime() - TOOL_CALL_RETENTION_DAYS * 86_400_000;
  const items: Record<string, Reminder> = {};
  for (const [id, reminder] of Object.entries(ledger.items)) {
    if (reminder.status === "sending") {
      items[id] = { ...reminder, status: "ambiguous", failure: "interrupted_during_send", updatedAt: stamp };
    } else if (reminder.ritualClaim) {
      items[id] = { ...withoutClaim(reminder), updatedAt: stamp };
    } else if (!isOpen(reminder) && Date.parse(reminder.updatedAt) < cutoff) {
      continue;
    } else {
      items[id] = reminder;
    }
  }
  const toolCalls = Object.fromEntries(Object.entries(ledger.toolCalls).filter(([, call]) => Date.parse(call.at) >= callCutoff));
  return { ...ledger, items, toolCalls };
}

// --- Wording (code-owned; docs/77 style) -------------------------------------------------------

export interface CardContext {
  name: string;
  /** Done list, `dueComplete` or archived: the only state worth saying at delivery. */
  finished: boolean;
}

function shortText(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function projectSuffix(reminder: Pick<Reminder, "project">): string {
  return reminder.project ? ` (${reminder.project})` : "";
}

/** One `🔔` line of a morning ritual message. */
export function ritualReminderLine(reminder: Reminder, card?: CardContext | null): string {
  const done = card?.finished ? ` — картка «${card.name}» уже в Done` : "";
  return `🔔 Ти просив нагадати: ${reminder.text}${projectSuffix(reminder)}${done}`;
}

/** The code-owned reminder block a morning ritual message starts with. */
export function ritualReminderBlock(reminders: readonly Reminder[], cards: ReadonlyMap<string, CardContext | null> = new Map()): string {
  return reminders.map((reminder) => ritualReminderLine(reminder, reminder.card ? cards.get(reminder.card.id) : null)).join("\n");
}

/** The whole text of a direct reminder message. Trello context only when it matters and was readable. */
export function directReminderText(reminder: Reminder, now: Date, card?: CardContext | null): string {
  const lines = [`🔔 Ти просив нагадати: ${reminder.text}`];
  const context: string[] = [];
  if (reminder.project) context.push(`Проєкт: ${reminder.project}`);
  if (card?.finished) context.push(`картка «${card.name}» уже в Done`);
  else if (reminder.card?.name) context.push(`Картка: «${reminder.card.name}»`);
  if (context.length > 0) lines.push(context.join(" · "));
  if (now.getTime() - Date.parse(reminder.schedule.dueAt) > LATE_NOTE_MINUTES * 60_000) {
    lines.push(`⏱ Мало прийти ${scheduleLabel({ ...reminder.schedule, surface: undefined }, now)} — надсилаю із запізненням.`);
  }
  return lines.join("\n");
}

export function createConfirmation(reminder: Reminder, now: Date, duplicate: boolean): string {
  const label = scheduleLabel(reminder.schedule, now);
  const text = shortText(reminder.text);
  if (duplicate) return `🔔 Таке нагадування вже є — ${label}: ${text}`;
  if (reminder.schedule.quietShifted) return `🔔 ${reminder.schedule.requested.time} — це тихі години, тож нагадаю ${label}: ${text}`;
  return `🔔 Нагадаю ${label}: ${text}`;
}

export function cancelConfirmation(reminder: Reminder): string {
  return `🔕 Скасував нагадування: ${shortText(reminder.text)}`;
}

export function rescheduleConfirmation(reminder: Reminder, now: Date): string {
  const label = scheduleLabel(reminder.schedule, now);
  const quiet = reminder.schedule.quietShifted ? ` (${reminder.schedule.requested.time} — тихі години)` : "";
  return `⏰ Переніс нагадування на ${label}${quiet}: ${shortText(reminder.text)}`;
}

// --- The compact view Claude answers "що я просив нагадати?" from ------------------------------

export interface ReminderView {
  id: string;
  text: string;
  project?: string;
  card?: string;
  when: string;
  status: "scheduled" | "sending" | "not_delivered" | "delivered" | "maybe_delivered" | "done" | "cancelled";
}

const VIEW_STATUS: Record<ReminderStatus, ReminderView["status"]> = {
  scheduled: "scheduled",
  sending: "sending",
  failed: "not_delivered",
  delivered: "delivered",
  ambiguous: "maybe_delivered",
  done: "done",
  cancelled: "cancelled",
};

export function viewReminder(reminder: Reminder, now: Date): ReminderView {
  const closed = !isOpen(reminder);
  const when = closed && reminder.sentAt ? dayLabel(kyivLocal(new Date(reminder.sentAt)).date, now) : scheduleLabel(reminder.schedule, now);
  return {
    id: reminder.id,
    text: reminder.text,
    ...(reminder.project ? { project: reminder.project } : {}),
    ...(reminder.card?.name ? { card: reminder.card.name } : {}),
    when,
    status: VIEW_STATUS[reminder.status],
  };
}

/** How many past reminders `list` returns when history is asked for. */
export const HISTORY_LIMIT = 10;
export const HISTORY_DAYS = 14;

export function listReminders(ledger: ReminderLedger, now: Date, includeHistory: boolean): { active: ReminderView[]; history?: ReminderView[] } {
  const active = sortByDue(Object.values(ledger.items).filter(isOpen)).map((item) => viewReminder(item, now));
  if (!includeHistory) return { active };
  const since = now.getTime() - HISTORY_DAYS * 86_400_000;
  const history = Object.values(ledger.items)
    .filter((item) => !isOpen(item) && Date.parse(item.updatedAt) >= since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, HISTORY_LIMIT)
    .map((item) => viewReminder(item, now));
  return { active, history };
}
