import type { TelegramInlineKeyboard } from "./rhythmActions.js";
import { DEFAULT_RHYTHM_CONFIG, type RhythmConfig } from "./rhythmConfig.js";
import type { ProactiveSender, SendOutcome } from "./rhythmRunner.js";
import { isQuietTime, kyivLocal } from "./rhythmSchedule.js";
import { mayAttempt, remindersOf, withReminders, type RhythmState, type RhythmStateStore } from "./rhythmState.js";
import {
  beginDirectSend,
  directReminderText,
  dueReminders,
  markReminderDone,
  REMINDER_ID_RE,
  rescheduleReminder,
  settleDirectSend,
  type CardContext,
  type Reminder,
} from "./reminders.js";
import { morningRitualFor, resolveReminderWhen, scheduleLabel } from "./reminderTime.js";
import { listRoleFor } from "./rhythmFacts.js";
import { isAllowedUser } from "./telegramAdapter.js";
import type { TrelloCardState } from "./trelloWorkHistory.js";

/**
 * Direct reminder delivery and reminder buttons (#54). Deterministic: no model turn is involved in delivering a
 * reminder or in handling its buttons, so a reminder reaches Daniel even when the Working Rhythm is off, the
 * Session was replaced or Trello is down.
 *
 * One lifecycle owns every due reminder. The serving process runs ONE timer; each tick first runs the Working
 * Rhythm (whose morning ritual may claim today's date-only reminders in its own atomic write, `rhythmRunner.ts`)
 * and then this scheduler, which delivers every other due reminder. A reminder claimed by a ritual is never
 * touched here; a date-only reminder waits for its morning ritual only while that ritual can still carry it.
 */

// --- Buttons ------------------------------------------------------------------------------------------

export type ReminderButton = "done" | "tomorrow";

const BUTTON_CODE: Record<ReminderButton, string> = { done: "d", tomorrow: "t" };
export const REMINDER_BUTTON_LABEL: Record<ReminderButton, string> = { done: "✅ Зроблено", tomorrow: "⏰ Завтра" };
export const REMINDER_CALLBACK_PREFIX = "rm1";

/** `rm1:<d|t>:<reminder id>:<seq>` — the reminder's own identity and generation, never content. */
export function encodeReminderCallback(button: ReminderButton, id: string, seq: number): string {
  if (!REMINDER_ID_RE.test(id) || !Number.isInteger(seq) || seq < 1) throw new Error("Invalid reminder callback identity.");
  return `${REMINDER_CALLBACK_PREFIX}:${BUTTON_CODE[button]}:${id}:${seq}`;
}

export type DecodedReminderCallback = { ok: true; button: ReminderButton; id: string; seq: number } | { ok: false; reason: "not_reminder" | "malformed" };

export function isReminderCallbackData(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith(`${REMINDER_CALLBACK_PREFIX}:`);
}

export function decodeReminderCallback(data: string | undefined): DecodedReminderCallback {
  if (!isReminderCallbackData(data)) return { ok: false, reason: "not_reminder" };
  const parts = data!.split(":");
  if (parts.length !== 4 || data!.length > 64) return { ok: false, reason: "malformed" };
  const button = (Object.keys(BUTTON_CODE) as ReminderButton[]).find((key) => BUTTON_CODE[key] === parts[1]);
  const seq = Number(parts[3]);
  if (!button || !REMINDER_ID_RE.test(parts[2]) || !/^\d{1,6}$/.test(parts[3]) || seq < 1) return { ok: false, reason: "malformed" };
  return { ok: true, button, id: parts[2], seq };
}

export function reminderKeyboard(reminder: Pick<Reminder, "id" | "seq">): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      (["done", "tomorrow"] as const).map((button) => ({ text: REMINDER_BUTTON_LABEL[button], callback_data: encodeReminderCallback(button, reminder.id, reminder.seq) })),
    ],
  };
}

// --- Scheduler --------------------------------------------------------------------------------------

/** How long a date-only reminder waits after its morning ritual's time for that ritual to carry it. */
export const RITUAL_WAIT_MINUTES = 30;
/** Direct deliveries per tick (a runaway bound; one minute later the rest follow). */
export const MAX_REMINDERS_PER_TICK = 5;
/** Trello context is a nicety: never wait longer than this for it. */
export const CARD_CONTEXT_TIMEOUT_MS = 3_000;

export interface ReminderDeliveryDeps {
  store: RhythmStateStore;
  now(): Date;
  send: ProactiveSender;
  /** The config under which morning rituals run as of this tick, or null when no ritual can run. */
  ritualConfig(): RhythmConfig | null;
  /** Fresh read-only card state for a linked card; its failure never blocks delivery. */
  cardContext?: (cardId: string) => Promise<CardContext | null>;
  /** Longest wait for card context (default `CARD_CONTEXT_TIMEOUT_MS`). */
  cardContextTimeoutMs?: number;
  maxPerTick?: number;
  log?: (line: string) => void;
}

export interface ReminderTickReport {
  status: "ran" | "busy" | "state_unavailable" | "error";
  sends: number;
  deliveries: Array<{ id: string; status: Reminder["status"] }>;
}

/** Card context with a hard timeout; any failure is simply no context. */
export async function boundedCardContext(lookup: ReminderDeliveryDeps["cardContext"], cardId: string, timeoutMs = CARD_CONTEXT_TIMEOUT_MS): Promise<CardContext | null> {
  if (!lookup) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(cardId).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Card context from the accepted GET-only Trello client (#36 read token): "finished" only for a card in the Done
 * list, marked `dueComplete` or archived — the one state worth saying next to a reminder. Never a write.
 */
export function trelloCardContext(reader: { readCardState(cardId: string): Promise<TrelloCardState> }): (cardId: string) => Promise<CardContext | null> {
  return async (cardId) => {
    const card = await reader.readCardState(cardId);
    return { name: card.name, finished: card.closed || card.dueComplete || listRoleFor(card.listName ?? undefined) === "done" };
  };
}

/** A date-only reminder for today whose morning ritual can still carry it. */
export function waitsForRitual(reminder: Reminder, state: RhythmState, now: Date, config: RhythmConfig | null): boolean {
  if (reminder.schedule.mode !== "morning" || config === null) return false;
  const local = kyivLocal(now);
  if (reminder.schedule.date !== local.date) return false;
  const ritual = morningRitualFor(local.date, config);
  if (!ritual) return false;
  const record = state.deliveries[ritual.key];
  if (record && !mayAttempt(record)) return false; // the ritual has concluded without it
  return local.minutes < ritual.minutes + RITUAL_WAIT_MINUTES;
}

export interface ReminderScheduler {
  tick(): Promise<ReminderTickReport>;
}

export function createReminderScheduler(deps: ReminderDeliveryDeps): ReminderScheduler {
  const log = deps.log ?? (() => {});
  const maxPerTick = deps.maxPerTick ?? MAX_REMINDERS_PER_TICK;
  let running = false;

  async function deliver(reminder: Reminder, report: ReminderTickReport): Promise<void> {
    const card = reminder.card ? await boundedCardContext(deps.cardContext, reminder.card.id, deps.cardContextTimeoutMs) : null;
    const now = deps.now();
    let claimed: Reminder | null = null;
    // Durable "send started" before the Telegram call; a reminder changed meanwhile (cancel, move) is skipped.
    await deps.store.update((state) => {
      const begun = beginDirectSend(remindersOf(state), reminder.id, reminder.seq, now);
      if (!begun) return state;
      claimed = begun.reminder;
      return withReminders(state, begun.ledger);
    });
    const sending = claimed as Reminder | null;
    if (sending === null) return;

    let outcome: SendOutcome;
    try {
      outcome = await deps.send({ text: directReminderText(sending, now, card), actions: [], keyboard: reminderKeyboard(sending) }, sending.id);
    } catch {
      outcome = { status: "unknown", reason: "send_threw" };
    }
    if (outcome.status === "sent") report.sends += 1;
    const state = await deps.store.update((current) => withReminders(current, settleDirectSend(remindersOf(current), sending.id, sending.seq, outcome, deps.now())));
    const status = remindersOf(state).items[sending.id]?.status ?? "sending";
    report.deliveries.push({ id: sending.id, status });
    log(`[reminder] ${sending.id} ${status}`);
  }

  async function tickOnce(): Promise<ReminderTickReport> {
    const report: ReminderTickReport = { status: "ran", sends: 0, deliveries: [] };
    let state: RhythmState;
    try {
      state = await deps.store.load();
    } catch {
      log("[reminder] state_unavailable");
      return { ...report, status: "state_unavailable" };
    }
    const now = deps.now();
    const config = deps.ritualConfig();
    const minutes = kyivLocal(now).minutes;
    const due = dueReminders(remindersOf(state), now).filter(
      // A late reminder never lands inside the quiet hours it was scheduled under; an on-time one never can.
      (reminder) => !isQuietTime(minutes, reminder.schedule.quietHours) && !waitsForRitual(reminder, state, now, config),
    );
    for (const reminder of due.slice(0, maxPerTick)) await deliver(reminder, report);
    return report;
  }

  return {
    async tick() {
      if (running) return { status: "busy", sends: 0, deliveries: [] };
      running = true;
      try {
        return await tickOnce();
      } catch {
        // A state write failed mid-delivery: `sending` stays (becomes ambiguous at restart), never resent.
        log("[reminder] tick_error");
        return { status: "error", sends: 0, deliveries: [] };
      } finally {
        running = false;
      }
    },
  };
}

// --- Button callbacks -----------------------------------------------------------------------------

export const REMINDER_DONE_TEXT = "✅ Закрив нагадування.";
export const REMINDER_STALE_TEXT = "Це нагадування вже змінилось. Якщо треба — напиши текстом.";
export const REMINDER_ALREADY_TEXT = "Вже прийнято. Якщо треба щось змінити — напиши текстом.";

export interface ReminderCallbackQuery {
  id?: string;
  data?: string;
  fromId?: number;
  chatId?: number;
  messageId?: number;
}

export interface ReminderCallbackDeps {
  allowedUserId: string;
  store: RhythmStateStore;
  now(): Date;
  /** Quiet hours / morning time for "⏰ Завтра"; a failure falls back to the safe defaults. */
  readConfig(): Promise<RhythmConfig>;
  /** Acknowledges the click with a short notice. */
  answer(query: ReminderCallbackQuery, text?: string): Promise<unknown>;
  /** Best-effort removal of the keyboard after an accepted click. */
  clearButtons?(chatId: number, messageId: number): Promise<unknown>;
  log?(line: string): void;
}

export type ReminderCallbackResolution =
  | { outcome: "ignored"; reason: "unauthorized" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "done"; id: string }
  | { outcome: "rescheduled"; id: string; label: string };

/**
 * `✅ Зроблено` closes the reminder (never the Trello card); `⏰ Завтра` moves the SAME reminder to tomorrow through
 * the same date authority as a typed "перенеси на завтра" (a timed reminder keeps its time, a date-only one goes to
 * tomorrow's morning). Validation and mutation are one serialized state update, so a double click acts once; the
 * reminder's `seq` makes every older button stale. No model turn: these are Daniel's own actions on code-owned state.
 */
export function createReminderCallbackHandler(deps: ReminderCallbackDeps): (query: ReminderCallbackQuery) => Promise<ReminderCallbackResolution> {
  const log = deps.log ?? (() => {});

  return async (query) => {
    if (!isAllowedUser(query.fromId, deps.allowedUserId)) return { outcome: "ignored", reason: "unauthorized" };
    const reject = async (reason: string, text = REMINDER_STALE_TEXT): Promise<ReminderCallbackResolution> => {
      log(`[reminder] callback_rejected reason=${reason}`);
      await deps.answer(query, text).catch(() => undefined);
      return { outcome: "rejected", reason };
    };
    const decoded = decodeReminderCallback(query.data);
    if (!decoded.ok) return reject(decoded.reason);
    if (query.chatId === undefined || query.messageId === undefined) return reject("no_message");

    let config: RhythmConfig = DEFAULT_RHYTHM_CONFIG;
    if (decoded.button === "tomorrow") {
      try {
        config = await deps.readConfig();
      } catch {
        config = DEFAULT_RHYTHM_CONFIG;
      }
    }

    const now = deps.now();
    let rejection: string | null = null;
    let label = "";
    try {
      await deps.store.update((state) => {
        const ledger = remindersOf(state);
        const reminder = ledger.items[decoded.id];
        if (!reminder) rejection = "unknown_reminder";
        else if (reminder.seq !== decoded.seq) rejection = "stale_generation";
        else if (reminder.answeredAt !== undefined || reminder.status === "done" || reminder.status === "cancelled") rejection = "already_answered";
        else if (reminder.status !== "delivered" && reminder.status !== "ambiguous") rejection = "not_delivered";
        // An ambiguous send has no message id: the click itself proves it arrived.
        else if (reminder.telegramMessageId !== undefined && reminder.telegramMessageId !== query.messageId) rejection = "message_mismatch";
        if (rejection !== null || !reminder) return state;
        if (decoded.button === "done") return withReminders(state, markReminderDone(ledger, reminder.id, now));
        const schedule = resolveReminderWhen(
          reminder.schedule.mode === "timed" && reminder.schedule.requested.time !== null
            ? { day: "tomorrow", time: reminder.schedule.requested.time }
            : { day: "tomorrow" },
          now,
          config,
        );
        label = scheduleLabel(schedule, now);
        return withReminders(state, rescheduleReminder(ledger, reminder.id, schedule, now));
      });
    } catch {
      return reject("state_unavailable");
    }
    if (rejection === "already_answered") return reject(rejection, REMINDER_ALREADY_TEXT);
    if (rejection !== null) return reject(rejection);

    const text = decoded.button === "done" ? REMINDER_DONE_TEXT : `⏰ Нагадаю ${label}.`;
    await deps.answer(query, text).catch(() => undefined);
    await deps.clearButtons?.(query.chatId, query.messageId).catch(() => undefined);
    log(`[reminder] callback_${decoded.button} ${decoded.id}`);
    return decoded.button === "done" ? { outcome: "done", id: decoded.id } : { outcome: "rescheduled", id: decoded.id, label };
  };
}
