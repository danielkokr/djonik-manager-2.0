import type { RitualKind } from "./rhythmSchedule.js";

/**
 * Telegram inline-button contract for proactive Working Rhythm messages (#39).
 *
 * Buttons are shortcuts for an ordinary reply, never a command channel:
 *   - the set shown under a message is derived here from the message kind, never from model output,
 *     so Claude cannot emit a callback id that reaches internal code;
 *   - a click is translated into one fixed Ukrainian utterance and enters the SAME turn path as typed
 *     text (grouping buffer → FIFO single-flight Session turn), where Claude reasons normally and any
 *     Trello change still needs #31 verification;
 *   - a callback never calls Trello, Memory or any tool itself.
 *
 * The translation table below is transport UI, not conversational intent routing.
 */

/** Every message kind that may carry buttons. */
export type ProactiveKind = RitualKind | "exception";

export type RhythmActionId = "ack" | "accept_plan" | "modify" | "reorder" | "details" | "carry_over" | "not_now" | "raise" | "later" | "suppress";

interface ActionSpec {
  /** Short wire code used inside `callback_data`. */
  code: string;
  label: string;
}

export const RHYTHM_ACTIONS: Record<RhythmActionId, ActionSpec> = {
  ack: { code: "ok", label: "✅ Ок" },
  accept_plan: { code: "acc", label: "✅ Приймаю" },
  modify: { code: "mod", label: "✏️ Змінити" },
  reorder: { code: "ord", label: "🔄 Переставити" },
  details: { code: "det", label: "📋 Детальніше" },
  carry_over: { code: "car", label: "✅ Перенести" },
  not_now: { code: "nn", label: "⏭ Не зараз" },
  raise: { code: "up", label: "⬆️ Підняти" },
  later: { code: "lat", label: "⏰ Пізніше" },
  suppress: { code: "mute", label: "🔕 Не нагадувати" },
};

/** Contextual, small (≤ 3) button sets. A kind absent here (or an empty list) gets no keyboard. */
export const BUTTON_SETS: Record<ProactiveKind, readonly RhythmActionId[]> = {
  "monday-plan": ["accept_plan", "modify", "details"],
  morning: ["ack", "reorder", "details"],
  "friday-morning": ["ack", "reorder"],
  "friday-review": ["carry_over", "modify", "not_now"],
  evening: ["carry_over", "not_now"],
  exception: ["raise", "later", "suppress"],
};

export const MAX_BUTTONS_PER_MESSAGE = 3;

export function buttonsFor(kind: ProactiveKind): readonly RhythmActionId[] {
  return BUTTON_SETS[kind].slice(0, MAX_BUTTONS_PER_MESSAGE);
}

const KIND_PHRASE: Record<ProactiveKind, string> = {
  "monday-plan": "план тижня",
  morning: "ранковий бриф",
  "friday-morning": "пʼятничний бриф",
  "friday-review": "огляд тижня",
  evening: "вечірнє «що переносимо»",
  exception: "твоє повідомлення",
};

/**
 * The ordinary user utterance a click stands for. `when` is a short Kyiv label of the original
 * message (e.g. "пн 28.09") so Claude can ground "this" even if other turns happened since.
 */
export function utteranceFor(action: RhythmActionId, kind: ProactiveKind, when: string): string {
  const about = `${KIND_PHRASE[kind]} від ${when}`;
  switch (action) {
    case "ack":
      return `Ок, тримаємо такий порядок (${about}).`;
    case "accept_plan":
      return `Так, приймаю цей план (${about}).`;
    case "modify":
      return `Хочу дещо змінити (${about}).`;
    case "reorder":
      return `Давай переставимо порядок (${about}).`;
    case "details":
      return `Розпиши детальніше (${about}).`;
    case "carry_over":
      return `Так, переносимо, як ти запропонував (${about}).`;
    case "not_now":
      return `Не зараз, повернемось до цього пізніше (${about}).`;
    case "raise":
      return `Давай піднімемо це вище в плані (${about}).`;
    case "later":
      return `Нагадай про це пізніше (${about}).`;
    case "suppress":
      return `Не нагадуй мені більше про це (${about}).`;
  }
}

// --- callback_data -----------------------------------------------------------------------------------

/** Telegram limit for `callback_data`: 1–64 bytes. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;
const PREFIX = "rh1";
const REF_RE = /^[a-z0-9]{6,16}$/;

/** `rh1:<code>:<ref>` — versioned so a future format can reject old buttons explicitly. */
export function encodeCallbackData(action: RhythmActionId, ref: string): string {
  if (!REF_RE.test(ref)) throw new Error("Invalid delivery reference for callback data.");
  const data = `${PREFIX}:${RHYTHM_ACTIONS[action].code}:${ref}`;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_MAX_BYTES) throw new Error("callback_data exceeds the Telegram limit.");
  return data;
}

export type DecodedCallback = { ok: true; action: RhythmActionId; ref: string } | { ok: false; reason: "not_rhythm" | "unknown_version" | "unknown_action" | "malformed" };

export function decodeCallbackData(data: string | undefined): DecodedCallback {
  if (!data) return { ok: false, reason: "malformed" };
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_MAX_BYTES) return { ok: false, reason: "malformed" };
  const parts = data.split(":");
  if (!parts[0]?.startsWith("rh")) return { ok: false, reason: "not_rhythm" };
  if (parts[0] !== PREFIX) return { ok: false, reason: "unknown_version" };
  if (parts.length !== 3 || !REF_RE.test(parts[2])) return { ok: false, reason: "malformed" };
  const action = (Object.keys(RHYTHM_ACTIONS) as RhythmActionId[]).find((id) => RHYTHM_ACTIONS[id].code === parts[1]);
  if (!action) return { ok: false, reason: "unknown_action" };
  return { ok: true, action, ref: parts[2] };
}

// --- Outbound shape ---------------------------------------------------------------------------------

/** Transport-neutral final outbound message: text plus an optional small set of actions. */
export interface OutboundMessage {
  text: string;
  actions: readonly RhythmActionId[];
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** One row of at most three buttons, or no markup at all when there are no actions. */
export function toTelegramReplyMarkup(actions: readonly RhythmActionId[], ref: string): TelegramInlineKeyboard | undefined {
  const bounded = actions.slice(0, MAX_BUTTONS_PER_MESSAGE);
  if (bounded.length === 0) return undefined;
  return { inline_keyboard: [bounded.map((action) => ({ text: RHYTHM_ACTIONS[action].label, callback_data: encodeCallbackData(action, ref) }))] };
}

/** Telegram's text limit for one message. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Keeps a proactive message within one Telegram message (one set of buttons, one delivery record). */
export function boundTelegramText(text: string): string {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  return `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1).trimEnd()}…`;
}
