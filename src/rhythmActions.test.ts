import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundTelegramText,
  BUTTON_SETS,
  buttonsFor,
  decodeCallbackData,
  encodeCallbackData,
  MAX_BUTTONS_PER_MESSAGE,
  RHYTHM_ACTIONS,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  TELEGRAM_TEXT_LIMIT,
  toTelegramReplyMarkup,
  utteranceFor,
  type ProactiveKind,
  type RhythmActionId,
} from "./rhythmActions.js";

// #39 Working Rhythm — contextual inline buttons: small, bounded, derived from the message kind, and
// translated into ordinary Ukrainian utterances.

const labels = (kind: ProactiveKind) => buttonsFor(kind).map((a) => RHYTHM_ACTIONS[a].label);

test("Monday plan buttons: Приймаю · Змінити · Детальніше", () => {
  assert.deepEqual(labels("monday-plan"), ["✅ Приймаю", "✏️ Змінити", "📋 Детальніше"]);
});

test("normal morning buttons: Ок · Переставити · Детальніше", () => {
  assert.deepEqual(labels("morning"), ["✅ Ок", "🔄 Переставити", "📋 Детальніше"]);
});

test("Friday review buttons: Перенести · Змінити · Не зараз", () => {
  assert.deepEqual(labels("friday-review"), ["✅ Перенести", "✏️ Змінити", "⏭ Не зараз"]);
});

test("exception buttons: Підняти · Пізніше · Не нагадувати", () => {
  assert.deepEqual(labels("exception"), ["⬆️ Підняти", "⏰ Пізніше", "🔕 Не нагадувати"]);
});

test("button sets are contextual and never exceed three", () => {
  const sets = Object.values(BUTTON_SETS).map((set) => set.join(","));
  assert.equal(new Set(sets).size, sets.length, "no two message kinds share an identical set");
  for (const [kind, set] of Object.entries(BUTTON_SETS)) {
    assert.ok(set.length >= 2 && set.length <= MAX_BUTTONS_PER_MESSAGE, kind);
  }
  assert.ok(buttonsFor("friday-morning").length <= 2, "the lighter Friday morning stays lighter");
});

test("callback_data round-trips and always fits Telegram's 64-byte limit", () => {
  const longestRef = "a".repeat(16);
  for (const action of Object.keys(RHYTHM_ACTIONS) as RhythmActionId[]) {
    const data = encodeCallbackData(action, longestRef);
    assert.ok(Buffer.byteLength(data, "utf8") <= TELEGRAM_CALLBACK_DATA_MAX_BYTES, data);
    assert.deepEqual(decodeCallbackData(data), { ok: true, action, ref: longestRef });
  }
  assert.throws(() => encodeCallbackData("ack", "BAD REF"), /Invalid delivery reference/);
});

test("unknown, malformed, foreign and oversized callback payloads are rejected", () => {
  assert.deepEqual(decodeCallbackData(undefined), { ok: false, reason: "malformed" });
  assert.deepEqual(decodeCallbackData("rh1:zap:abcdef12"), { ok: false, reason: "unknown_action" });
  assert.deepEqual(decodeCallbackData("rh2:ok:abcdef12"), { ok: false, reason: "unknown_version" });
  assert.deepEqual(decodeCallbackData("rh1:ok"), { ok: false, reason: "malformed" });
  assert.deepEqual(decodeCallbackData("rh1:ok:../../etc"), { ok: false, reason: "malformed" });
  assert.deepEqual(decodeCallbackData("trelloWriteCard:move"), { ok: false, reason: "not_rhythm" });
  assert.deepEqual(decodeCallbackData(`rh1:ok:${"a".repeat(80)}`), { ok: false, reason: "malformed" });
});

test("reply markup: one row from the bounded action list; no actions → no keyboard", () => {
  const markup = toTelegramReplyMarkup(["accept_plan", "modify", "details", "ack"], "abcdef123456");
  assert.equal(markup!.inline_keyboard.length, 1);
  assert.equal(markup!.inline_keyboard[0].length, 3);
  assert.deepEqual(markup!.inline_keyboard[0][0], { text: "✅ Приймаю", callback_data: "rh1:acc:abcdef123456" });
  assert.equal(toTelegramReplyMarkup([], "abcdef123456"), undefined);
});

test("clicks translate into ordinary conversational utterances grounded in the original message", () => {
  assert.equal(utteranceFor("accept_plan", "monday-plan", "пн 28.09"), "Так, приймаю цей план (план тижня від пн 28.09).");
  assert.equal(utteranceFor("suppress", "exception", "вт 29.09, 14:10"), "Не нагадуй мені більше про це (твоє повідомлення від вт 29.09, 14:10).");
  for (const action of Object.keys(RHYTHM_ACTIONS) as RhythmActionId[]) {
    const text = utteranceFor(action, "morning", "вт 29.09");
    assert.ok(text.length > 10 && !/rh1|callback|trello/i.test(text), action);
  }
});

test("proactive text is bounded to one Telegram message", () => {
  assert.equal(boundTelegramText("коротко"), "коротко");
  const long = boundTelegramText("х".repeat(5000));
  assert.equal(long.length, TELEGRAM_TEXT_LIMIT);
  assert.ok(long.endsWith("…"));
});
