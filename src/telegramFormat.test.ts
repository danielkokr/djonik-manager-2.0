import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError, HttpError } from "grammy";
import type { DjonikSessionHandle } from "./djonikClient.js";
import { MessageGroupBuffer } from "./messageGrouping.js";
import { toTelegramReplyMarkup } from "./rhythmActions.js";
import { classifySendError, createTelegramProactiveSender } from "./rhythmTelegram.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import { ProposalConfirmations } from "./proposalConfirmation.js";
import {
  createFormattedTextSender,
  isEntityParseError,
  renderTelegramHtml,
  sendFormattedMessage,
  stripProviderResourceIds,
  type TelegramTextApi,
} from "./telegramFormat.js";

// #39 presentation fix: one shared Telegram HTML rendering path for ordinary replies, fixed notices and
// Working Rhythm proactive messages. Tiny subset only; all source text escaped; one bounded fallback.

const CHAT = 4242;

const parseError = () =>
  new GrammyError(
    "Call to 'sendMessage' failed!",
    { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Can't find end tag corresponding to start tag b" },
    "sendMessage",
    {},
  );

type Call = { chatId: number; text: string; other?: { parse_mode?: "HTML"; reply_markup?: unknown } };

/** Fake `bot.api`: each call consumes the next scripted outcome (an error to throw, or success). */
function fakeApi(outcomes: Array<Error | "ok"> = []) {
  const calls: Call[] = [];
  const api: TelegramTextApi<any> = {
    sendMessage: async (chatId, text, other) => {
      calls.push({ chatId, text, other });
      const outcome = outcomes.shift() ?? "ok";
      if (outcome !== "ok") throw outcome;
      return { message_id: 100 + calls.length };
    },
  };
  return { api, calls };
}

// --- Renderer -----------------------------------------------------------------------------------------

test("1. plain text is unchanged", () => {
  const text = "Сьогодні без пожеж. Основний фокус — Cossack Labs.\n1. Extract\n- Barbers";
  assert.equal(renderTelegramHtml(text), text);
});

test("2–3. **bold** and several bold spans become <b>", () => {
  assert.equal(renderTelegramHtml("**Що робити в першу чергу**"), "<b>Що робити в першу чергу</b>");
  assert.equal(
    renderTelegramHtml("1. **Extract — крем для рук** і потім **Barbers**."),
    "1. <b>Extract — крем для рук</b> і потім <b>Barbers</b>.",
  );
});

test("4. Unicode / Ukrainian and the functional emoji survive intact", () => {
  assert.equal(
    renderTelegramHtml("🎯 **Головне сьогодні**\n⚠️ **Перевірити** ґанок, їжак, є\n⏳ чекаємо ✓ → далі"),
    "🎯 <b>Головне сьогодні</b>\n⚠️ <b>Перевірити</b> ґанок, їжак, є\n⏳ чекаємо ✓ → далі",
  );
});

test("5. <, > and & are escaped, around and inside bold", () => {
  assert.equal(renderTelegramHtml("A < B & **важливо**"), "A &lt; B &amp; <b>важливо</b>");
  assert.equal(renderTelegramHtml("**R&D > 2**"), "<b>R&amp;D &gt; 2</b>");
  assert.equal(renderTelegramHtml("&amp; already"), "&amp;amp; already", "no double-decoding shortcut");
});

test("6. raw model HTML never becomes Telegram markup", () => {
  assert.equal(renderTelegramHtml("<b>x</b> <a href=\"https://e.x\">клік</a>"), "&lt;b&gt;x&lt;/b&gt; &lt;a href=\"https://e.x\"&gt;клік&lt;/a&gt;");
  assert.equal(renderTelegramHtml("**<i>x</i>**"), "<b>&lt;i&gt;x&lt;/i&gt;</b>");
  assert.equal(renderTelegramHtml("`<script>`"), "<code>&lt;script&gt;</code>");
});

test("7. malformed / literal asterisks stay as escaped plain text", () => {
  for (const text of ["**без кінця", "кінець без початку**", "2 ** 3 = 8", "** пробіли **", "****", "a * b * c", "***"]) {
    assert.equal(renderTelegramHtml(text), text, text);
  }
  assert.equal(renderTelegramHtml("**так** і **ні"), "<b>так</b> і **ні");
  assert.equal(renderTelegramHtml("***x***"), "*<b>x</b>*");
});

test("8. multiline: bold never spans lines; each line renders on its own", () => {
  assert.equal(renderTelegramHtml("**перший\nдругий**"), "**перший\nдругий**");
  const reply = "🎯 **Головне сьогодні**\n\n1. **Extract — крем для рук**\n   Дедлайн сьогодні.\n\n→ Якщо залишиться час — Invoice.";
  assert.equal(
    renderTelegramHtml(reply),
    "🎯 <b>Головне сьогодні</b>\n\n1. <b>Extract — крем для рук</b>\n   Дедлайн сьогодні.\n\n→ Якщо залишиться час — Invoice.",
  );
});

test("inline code: `x` → <code>, no bold inside code, code inside bold", () => {
  assert.equal(renderTelegramHtml("файл `rhythm.md`"), "файл <code>rhythm.md</code>");
  assert.equal(renderTelegramHtml("`**не жирний**`"), "<code>**не жирний**</code>");
  assert.equal(renderTelegramHtml("**див. `a<b`**"), "<b>див. <code>a&lt;b</code></b>");
  assert.equal(renderTelegramHtml("одна ` кавичка"), "одна ` кавичка");
});

// --- Send path ----------------------------------------------------------------------------------------

test("10. parse_mode HTML is supplied with the rendered text; 12. success sends exactly once", async () => {
  const { api, calls } = fakeApi();
  const sent = await sendFormattedMessage(api, CHAT, "A < B **важливо**");
  assert.deepEqual(calls, [{ chatId: CHAT, text: "A &lt; B <b>важливо</b>", other: { parse_mode: "HTML" } }]);
  assert.equal(sent.message_id, 101);
});

test("11. an entity-parse rejection triggers exactly one plain fallback (original text, no parse_mode), keyboard kept", async () => {
  const markup = toTelegramReplyMarkup(["accept_plan", "modify"], "abcdef123456")!;
  const { api, calls } = fakeApi([parseError()]);
  const sent = await sendFormattedMessage(api, CHAT, "**План**", markup);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].other, { parse_mode: "HTML", reply_markup: markup });
  assert.deepEqual(calls[1], { chatId: CHAT, text: "**План**", other: { reply_markup: markup } });
  assert.equal(sent.message_id, 102);

  const plain = fakeApi([parseError()]);
  await sendFormattedMessage(plain.api, CHAT, "x");
  assert.deepEqual(plain.calls[1], { chatId: CHAT, text: "x", other: undefined });
});

test("11b. the fallback is bounded: a second failure propagates, no third send", async () => {
  const { api, calls } = fakeApi([parseError(), parseError()]);
  await assert.rejects(sendFormattedMessage(api, CHAT, "x"), GrammyError);
  assert.equal(calls.length, 2);
});

test("13. unrelated failures propagate unchanged with no second send (no duplicate)", async () => {
  const failures = [
    new HttpError("Network request failed", new Error("ECONNRESET")),
    new GrammyError("x", { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }, "sendMessage", {}),
    new GrammyError("x", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {}),
    new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: message is too long" }, "sendMessage", {}),
    new Error("timeout"),
  ];
  for (const failure of failures) {
    const { api, calls } = fakeApi([failure]);
    await assert.rejects(sendFormattedMessage(api, CHAT, "**x**"), (error) => error === failure);
    assert.equal(calls.length, 1, failure.message);
    assert.equal(isEntityParseError(failure), false);
  }
  assert.equal(isEntityParseError(parseError()), true);
});

// --- Proactive (Working Rhythm) uses the same path ------------------------------------------------------

test("9. proactive message: rendered HTML + parse_mode + the exact inline keyboard", async () => {
  const { api, calls } = fakeApi();
  const send = createTelegramProactiveSender(api, CHAT);
  const outcome = await send({ text: "🎯 **Головне на тиждень**\nНормальний план?", actions: ["accept_plan", "modify", "details"] }, "abcdef123456");
  assert.deepEqual(outcome, { status: "sent", messageId: 101 });
  assert.deepEqual(calls[0], {
    chatId: CHAT,
    text: "🎯 <b>Головне на тиждень</b>\nНормальний план?",
    other: { parse_mode: "HTML", reply_markup: toTelegramReplyMarkup(["accept_plan", "modify", "details"], "abcdef123456") },
  });
});

test("proactive: parse fallback is one send, still 'sent' with the fallback's message id and keyboard", async () => {
  const { api, calls } = fakeApi([parseError()]);
  const outcome = await createTelegramProactiveSender(api, CHAT)({ text: "**x**", actions: ["details"] }, "abcdef123456");
  assert.deepEqual(outcome, { status: "sent", messageId: 102 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].other, { reply_markup: toTelegramReplyMarkup(["details"], "abcdef123456") });
});

test("proactive: delivery classification unchanged — network failure is unknown, API refusal is rejected, one send each", async () => {
  const network = new HttpError("Network request failed", new Error("ECONNRESET"));
  const refusal = new GrammyError("x", { ok: false, error_code: 403, description: "Forbidden" }, "sendMessage", {});
  for (const failure of [network, refusal]) {
    const { api, calls } = fakeApi([failure]);
    const outcome = await createTelegramProactiveSender(api, CHAT)({ text: "x", actions: [] }, "abcdef123456");
    assert.deepEqual(outcome, classifySendError(failure));
    assert.equal(calls.length, 1);
  }
});

// --- Ordinary replies and notices use the same path ------------------------------------------------------

test("ordinary reply and error notice via dispatch + createFormattedTextSender render the same way", async () => {
  const { api, calls } = fakeApi();
  let reply = "⚠️ **Перевірити**\nБрендбук Extract & Invoice <скоро>";
  const session: DjonikSessionHandle = {
    sessionId: "s",
    send: async () => "",
    sendOrdered: async () => {
      if (reply === "") throw new Error("boom");
      return reply;
    },
    close: () => {},
  };
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session, closeIfOpen: () => {}, invalidate: () => {} },
    sendMessage: createFormattedTextSender(api),
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });
  buffer.addFragment({ chatId: CHAT, userId: CHAT, messageId: 1, text: "Що сьогодні?" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await buffer.whenIdle();
  assert.deepEqual(calls[0], { chatId: CHAT, text: "⚠️ <b>Перевірити</b>\nБрендбук Extract &amp; Invoice &lt;скоро&gt;", other: { parse_mode: "HTML" } });

  reply = "";
  buffer.addFragment({ chatId: CHAT, userId: CHAT, messageId: 2, text: "ще" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await buffer.whenIdle();
  assert.equal(calls.length, 2, "one user-facing error notice, one send");
  assert.deepEqual(calls[1].other, { parse_mode: "HTML" });
});

// --- #63: provider resource ids (ARIs) never reach Telegram -------------------------------------------

const WS = "6aa00b1e1ea493a95808aa9d";
const CARD_ARI = `ari:cloud:trello::card/workspace/${WS}/6aad27a85ca581b8c2c9c95e`;
const LIST_ARI = `ari:cloud:trello::list/workspace/${WS}/68c0a1b2c3d4e5f60718293a`;
const AZOV = "Мерч Азов: лонгслів + свічка";
const AZOV_DUE_LINE = "Готово. Trello підтвердив дедлайн: понеділок, 5 жовтня 2026, 18:00 за Києвом.";

test("#63 (1): production-shaped reply — the title stays, the ARI is gone", () => {
  const visible = stripProviderResourceIds(`«${AZOV}» (${CARD_ARI}). ${AZOV_DUE_LINE}\nЗміни підтверджено читанням картки.`);
  assert.equal(visible, `«${AZOV}». ${AZOV_DUE_LINE}\nЗміни підтверджено читанням картки.`);
  assert.doesNotMatch(visible, /ari:cloud:trello::/);
});

test("#63 (2): several references — parenthesized, bare, backticked, bracketed, comma-listed — are all removed", () => {
  const visible = stripProviderResourceIds(
    `«${AZOV}» (${CARD_ARI}) у списку ${LIST_ARI}.\nКартка \`${CARD_ARI}\`, список [${LIST_ARI}], обидва (${CARD_ARI}, ${LIST_ARI}).\n` +
      `${CARD_ARI}: ${AZOV_DUE_LINE}`,
  );
  assert.equal(visible, `«${AZOV}» у списку.\nКартка, список, обидва.\n: ${AZOV_DUE_LINE}`);
  assert.doesNotMatch(visible, /ari:cloud/);
  assert.doesNotMatch(visible, new RegExp(WS));
});

test("#63 (3): ordinary URLs — Google Docs, Drive, Figma, trello.com — are unchanged, even one carrying an ARI", () => {
  const text = [
    "Бриф: https://docs.google.com/document/d/1AbC-dEf_ghI/edit?usp=sharing",
    "Папка: https://drive.google.com/drive/folders/1xYz",
    "Макет: https://www.figma.com/design/AbCdEf/Azov-merch?node-id=1-2",
    "Картка: https://trello.com/c/hu6lbfoV/60-test-27-source-context-final",
    "(https://trello.com/c/TJ11ldeK)",
    `Дивно, але так: https://example.com/open?ref=${CARD_ARI}`,
  ].join("\n");
  assert.equal(stripProviderResourceIds(text), text);
});

test("#63 (4): ordinary parentheses and prose are untouched", () => {
  const text =
    "Пріоритет (за твоїм рішенням) — Azov. Розмір: M (2–3 год). Ціна (ARI-ставка) не змінилась; ari: це не id. " +
    "Пінг (див. вище) і «Назва (чернетка)» лишаються.";
  assert.equal(stripProviderResourceIds(text), text);
});

test("#63 (5): a verified due confirmation is identical apart from the removed provider id", () => {
  const block = `«${AZOV}»: Зміни підтверджено читанням картки.\n«${AZOV}»: ${AZOV_DUE_LINE}`;
  assert.equal(stripProviderResourceIds(block), block, "the code-owned block is already id-free and passes through unchanged");
  assert.equal(stripProviderResourceIds(`«${AZOV}» (${CARD_ARI}): ${AZOV_DUE_LINE}`), `«${AZOV}»: ${AZOV_DUE_LINE}`);
});

test("#63 (10): Telegram delivery — sendMessage, its parse-error fallback and sendProposal never carry an ARI", async () => {
  // Plain reply through dispatch + createFormattedTextSender (the exact telegramCli wiring); the first send is
  // refused for entities so the raw-text fallback is exercised too.
  const { api, calls } = fakeApi([parseError(), "ok", "ok"]);
  let reply = `**«${AZOV}»** (${CARD_ARI}). ${AZOV_DUE_LINE}`;
  const session: DjonikSessionHandle = { sessionId: "s", send: async () => "", sendOrdered: async () => reply, close: () => {} };
  const registry = new ProposalConfirmations(() => 0);
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session, closeIfOpen: () => {}, invalidate: () => {} },
    sendMessage: createFormattedTextSender(api),
    sendProposal: (chatId, text, keyboard) => sendFormattedMessage(api, chatId, text, keyboard),
    proposals: registry,
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });
  buffer.addFragment({ chatId: CHAT, userId: CHAT, messageId: 1, text: "Створи задачу по Азову" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await buffer.whenIdle();
  assert.deepEqual(calls.map((call) => call.text), [
    `<b>«${AZOV}»</b>. ${AZOV_DUE_LINE}`,
    `**«${AZOV}»**. ${AZOV_DUE_LINE}`,
  ]);

  // Proposal reply: the keyboard is still attached and bound; only the visible text loses the ARI.
  reply = `Перенести «${AZOV}» (${CARD_ARI}) з In progress → Waiting?\n\n✅ Внести · ✏️ Змінити`;
  buffer.addFragment({ chatId: CHAT, userId: CHAT, messageId: 2, text: "Азов чекає фідбек" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await buffer.whenIdle();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].text, `Перенести «${AZOV}» з In progress → Waiting?\n\n✅ Внести · ✏️ Змінити`);
  assert.ok(calls[2].other?.reply_markup, "the proposal keyboard is unchanged");
  assert.equal(registry.has(CHAT, CHAT), true, "the proposal is still bound");
  for (const call of calls) assert.doesNotMatch(call.text, /ari:cloud/);
});
