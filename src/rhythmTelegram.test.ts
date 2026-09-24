import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError, HttpError } from "grammy";
import type { DjonikSessionHandle, DjonikTurnPart } from "./djonikClient.js";
import { MessageGroupBuffer } from "./messageGrouping.js";
import { encodeCallbackData } from "./rhythmActions.js";
import { createRhythmScheduler } from "./rhythmRunner.js";
import { createMemoryRhythmStateStore, emptyRhythmState, type DeliveryRecord, type RhythmState } from "./rhythmState.js";
import {
  ALREADY_ANSWERED_TEXT,
  classifySendError,
  createRhythmCallbackHandler,
  createTelegramProactiveSender,
  enqueueClickAfterPendingText,
  STALE_BUTTON_TEXT,
  type RhythmCallbackDeps,
  type RhythmCallbackQuery,
} from "./rhythmTelegram.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";

// #39 Working Rhythm — Telegram transport: final message + optional inline keyboard out; a button click
// back in as an ordinary user turn through the SAME grouping buffer and FIFO Session path as typed text.

const USER = 4242;
const CHAT = 4242;
const REF = "abcdef123456";
const SENT_AT = "2026-09-28T06:31:00.000Z";

function sentRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    key: "monday-plan:2026-09-28",
    kind: "monday-plan",
    status: "sent",
    attempts: 1,
    ref: REF,
    sessionId: "sesn_serving",
    createdAt: "2026-09-28T06:30:00.000Z",
    updatedAt: SENT_AT,
    sentAt: SENT_AT,
    telegramMessageId: 777,
    actions: ["accept_plan", "modify", "details"],
    ...overrides,
  };
}

function stateWith(record: DeliveryRecord): RhythmState {
  return { ...emptyRhythmState(), deliveries: { [record.key]: record } };
}

function setUp(options: { record?: DeliveryRecord; sessionId?: string; now?: string } = {}) {
  const store = createMemoryRhythmStateStore(stateWith(options.record ?? sentRecord()));
  const answers: Array<string | undefined> = [];
  const cleared: number[] = [];
  const enqueued: Array<{ chatId: number; userId: number; messageId: number; text: string }> = [];
  const deps: RhythmCallbackDeps = {
    allowedUserId: String(USER),
    store,
    now: () => new Date(options.now ?? "2026-09-28T07:00:00Z"),
    currentSessionId: () => options.sessionId ?? "sesn_serving",
    answer: async (_query, alert) => {
      answers.push(alert);
    },
    clearButtons: async (_chat, messageId) => {
      cleared.push(messageId);
    },
    enqueueUserText: (fragment) => {
      enqueued.push(fragment);
    },
  };
  return { handle: createRhythmCallbackHandler(deps), store, answers, cleared, enqueued };
}

const click = (action = encodeCallbackData("accept_plan", REF), overrides: Partial<RhythmCallbackQuery> = {}): RhythmCallbackQuery => ({
  data: action,
  fromId: USER,
  chatId: CHAT,
  messageId: 777,
  ...overrides,
});

// --- Outbound -----------------------------------------------------------------------------------------

test("proactive sender: final text plus the bounded keyboard; no actions → no reply_markup", async () => {
  const calls: Array<{ chatId: number; text: string; other?: unknown }> = [];
  const send = createTelegramProactiveSender({ sendMessage: async (chatId, text, other) => (calls.push({ chatId, text, other }), { message_id: 55 }) }, CHAT);
  assert.deepEqual(await send({ text: "План тижня…", actions: ["accept_plan", "modify", "details"] }, REF), { status: "sent", messageId: 55 });
  assert.deepEqual(calls[0].other, {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Приймаю", callback_data: "rh1:acc:abcdef123456" },
        { text: "✏️ Змінити", callback_data: "rh1:mod:abcdef123456" },
        { text: "📋 Детальніше", callback_data: "rh1:det:abcdef123456" },
      ]],
    },
  });
  await send({ text: "Notice", actions: [] }, REF);
  assert.equal(calls[1].other, undefined);
});

test("send errors: Telegram API refusal is definite; network failure is unknown (never blindly resent)", () => {
  const refusal = new GrammyError("Bad Request", { ok: false, error_code: 400, description: "bad" }, "sendMessage", {});
  assert.deepEqual(classifySendError(refusal), { status: "rejected", reason: "http_400" });
  assert.equal(classifySendError(new HttpError("Network request failed", new Error("ECONNRESET"))).status, "unknown");
  assert.equal(classifySendError(new Error("timeout")).status, "unknown");
});

// --- Inbound callbacks ----------------------------------------------------------------------------------

test("a valid click becomes one ordinary utterance, acknowledged, buttons cleared, marked answered", async () => {
  const { handle, store, answers, cleared, enqueued } = setUp();
  const result = await handle(click());
  assert.deepEqual(result, { outcome: "enqueued", action: "accept_plan", utterance: "Так, приймаю цей план (план тижня від пн 28.09)." });
  assert.deepEqual(enqueued, [{ chatId: CHAT, userId: USER, messageId: 777, text: "Так, приймаю цей план (план тижня від пн 28.09)." }]);
  assert.deepEqual(answers, [undefined], "plain acknowledgement, no alert");
  assert.deepEqual(cleared, [777]);
  const record = store.snapshot().deliveries["monday-plan:2026-09-28"];
  assert.equal(record.answeredAction, "accept_plan");
  assert.ok(record.answeredAt);
});

test("double click: the second press is rejected gently and enqueues nothing", async () => {
  const { handle, enqueued, answers } = setUp();
  const [first, second] = await Promise.all([handle(click()), handle(click(encodeCallbackData("modify", REF)))]);
  assert.equal(first.outcome, "enqueued");
  assert.deepEqual(second, { outcome: "rejected", reason: "already_answered" });
  assert.equal(enqueued.length, 1);
  assert.equal(answers[1], ALREADY_ANSWERED_TEXT);
});

test("unknown / malformed callback payloads are rejected safely with a text-reply hint", async () => {
  for (const data of ["rh1:zap:abcdef123456", "garbage", "rh2:ok:abcdef123456", undefined]) {
    const { handle, enqueued, answers } = setUp();
    const result = await handle({ ...click(), data });
    assert.equal(result.outcome, "rejected", String(data));
    assert.equal(enqueued.length, 0);
    assert.deepEqual(answers, [STALE_BUTTON_TEXT]);
  }
});

test("stale callbacks fail gently: unknown ref, restart (new Session), expired, wrong message, action not offered, undelivered", async () => {
  const cases: Array<[string, ReturnType<typeof setUp>, RhythmCallbackQuery]> = [
    ["unknown_ref", setUp(), click(encodeCallbackData("accept_plan", "ffffff000000"))],
    ["session_changed", setUp({ sessionId: "sesn_after_restart" }), click()],
    ["expired", setUp({ now: "2026-09-30T07:00:00Z" }), click()],
    ["message_mismatch", setUp(), click(undefined, { messageId: 778 })],
    ["action_not_offered", setUp(), click(encodeCallbackData("suppress", REF))],
    ["not_delivered", setUp({ record: sentRecord({ status: "ambiguous", sentAt: undefined }) }), click()],
  ];
  for (const [reason, context, query] of cases) {
    const result = await context.handle(query);
    assert.deepEqual(result, { outcome: "rejected", reason }, reason);
    assert.equal(context.enqueued.length, 0, reason);
    assert.deepEqual(context.answers, [STALE_BUTTON_TEXT], reason);
    assert.equal(context.store.snapshot().deliveries["monday-plan:2026-09-28"].answeredAt, undefined, reason);
  }
});

test("a click from anyone but Daniel is ignored without any effect", async () => {
  const { handle, enqueued, answers } = setUp();
  assert.deepEqual(await handle(click(undefined, { fromId: 1 })), { outcome: "ignored", reason: "unauthorized" });
  assert.equal(enqueued.length + answers.length, 0);
});

test("state unavailable → gentle rejection, no turn", async () => {
  const context = setUp();
  const handle = createRhythmCallbackHandler({
    allowedUserId: String(USER),
    store: { load: async () => { throw new Error("x"); }, update: async () => { throw new Error("x"); } },
    now: () => new Date("2026-09-28T07:00:00Z"),
    currentSessionId: () => "sesn_serving",
    answer: async (_query, alert) => void context.answers.push(alert),
    enqueueUserText: (fragment) => void context.enqueued.push(fragment),
  });
  assert.deepEqual(await handle(click()), { outcome: "rejected", reason: "state_unavailable" });
  assert.equal(context.enqueued.length, 0);
});

// --- Integration: the click enters the normal user-turn path --------------------------------------------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("integration: typed text and a click share one grouping buffer and the FIFO Session path; the click is plain text, zero tools", async () => {
  const calls: DjonikTurnPart[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const session: DjonikSessionHandle = {
    sessionId: "sesn_serving",
    send: async () => {
      throw new Error("not used");
    },
    sendOrdered: async (parts) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(parts);
      await sleep(5);
      inFlight -= 1;
      return "Добре.";
    },
    close: () => {},
  };
  // A FIFO like the real handle's `enqueue`, so ordering is observable.
  let tail: Promise<unknown> = Promise.resolve();
  const fifo: DjonikSessionHandle = {
    ...session,
    sendOrdered: (parts) => {
      const run = tail.then(() => session.sendOrdered(parts));
      tail = run.catch(() => undefined);
      return run;
    },
  };
  const replies: string[] = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => fifo, closeIfOpen: () => {}, invalidate: () => {} },
    sendMessage: async (_chat, text) => void replies.push(text),
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 10, albumSettleWindowMs: 10, onDispatch, onFailure });
  const context = setUp();
  const handle = createRhythmCallbackHandler({
    allowedUserId: String(USER),
    store: context.store,
    now: () => new Date("2026-09-28T07:00:00Z"),
    currentSessionId: () => "sesn_serving",
    answer: async () => {},
    enqueueUserText: enqueueClickAfterPendingText(buffer),
  });

  buffer.addFragment({ chatId: CHAT, userId: USER, messageId: 900, text: "Що по Extract?" });
  await sleep(30);
  await handle(click());
  await sleep(30);
  await buffer.whenIdle();

  assert.equal(calls.length, 2, "one turn for the typed text, one for the click");
  assert.deepEqual(calls[0], [{ type: "text", text: "Що по Extract?" }], "typed text unchanged");
  assert.deepEqual(calls[1], [{ type: "text", text: "Так, приймаю цей план (план тижня від пн 28.09)." }]);
  assert.equal(maxInFlight, 1, "single-flight");
  assert.deepEqual(replies, ["Добре.", "Добре."], "final replies only, one per turn");
});

test("ordering: text typed just before a click stays first (the click never merges into and jumps ahead of it)", async () => {
  const calls: DjonikTurnPart[][] = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: {
      getSession: async () => ({ sessionId: "s", send: async () => "", sendOrdered: async (parts) => (calls.push(parts), "Ок."), close: () => {} }),
      closeIfOpen: () => {},
      invalidate: () => {},
    },
    sendMessage: async () => {},
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 50, albumSettleWindowMs: 50, onDispatch, onFailure });
  const context = setUp();
  const handle = createRhythmCallbackHandler({
    allowedUserId: String(USER),
    store: context.store,
    now: () => new Date("2026-09-28T07:00:00Z"),
    currentSessionId: () => "sesn_serving",
    answer: async () => {},
    enqueueUserText: enqueueClickAfterPendingText(buffer),
  });
  buffer.addFragment({ chatId: CHAT, userId: USER, messageId: 900, text: "Тільки Limen прибери." });
  await handle(click()); // within the 50 ms window, bot message id 777 < 900
  await sleep(120);
  await buffer.whenIdle();
  assert.deepEqual(calls.map((parts) => (parts[0] as { text: string }).text), [
    "Тільки Limen прибери.",
    "Так, приймаю цей план (план тижня від пн 28.09).",
  ]);
});

// --- End to end offline: scheduled delivery → button → conversational turn -------------------------------

test("end to end (offline): scheduled week plan with buttons → click → ordinary turn; stale after a restart", async () => {
  const store = createMemoryRhythmStateStore();
  const sentMarkup: unknown[] = [];
  const sender = createTelegramProactiveSender({ sendMessage: async (_c, _t, other) => (sentMarkup.push(other), { message_id: 3001 }) }, CHAT);
  const scheduler = createRhythmScheduler({
    activation: { enabled: true, reason: "test" },
    readOnlyBoundary: "pre_execution", // the fake runner below never writes
    now: () => new Date("2026-09-28T06:30:00Z"),
    configSource: { read: async () => null },
    store,
    runTurn: async () => ({
      reply: "На цей тиждень я б тримав три результати… Нормальний план?",
      sessionId: "sesn_serving",
      toolUses: [{ kind: "mcp", name: "trelloReadCard" }],
    }),
    send: sender,
    newRef: () => "e2e000000001",
  });
  await scheduler.tick();
  const markup = sentMarkup[0] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
  const acceptData = markup.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(acceptData, "rh1:acc:e2e000000001");

  const enqueued: string[] = [];
  const base = {
    allowedUserId: String(USER),
    store,
    now: () => new Date("2026-09-28T07:10:00Z"),
    answer: async () => {},
    enqueueUserText: (fragment: { text: string }) => void enqueued.push(fragment.text),
  };
  const afterRestart = createRhythmCallbackHandler({ ...base, currentSessionId: () => "sesn_new" });
  assert.deepEqual(await afterRestart({ data: acceptData, fromId: USER, chatId: CHAT, messageId: 3001 }), { outcome: "rejected", reason: "session_changed" });
  const live = createRhythmCallbackHandler({ ...base, currentSessionId: () => "sesn_serving" });
  assert.equal((await live({ data: acceptData, fromId: USER, chatId: CHAT, messageId: 3001 })).outcome, "enqueued");
  assert.deepEqual(enqueued, ["Так, приймаю цей план (план тижня від пн 28.09)."]);
});

test("album in progress → click: the complete album is ONE Session turn, the click the following turn (same FIFO)", async () => {
  const calls: DjonikTurnPart[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const sendOrdered = (parts: DjonikTurnPart[]) => {
    const run = tail.then(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(parts);
      await sleep(5);
      inFlight -= 1;
      return "Ок.";
    });
    tail = run.catch(() => undefined);
    return run;
  };
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => ({ sessionId: "s", send: async () => "", sendOrdered, close: () => {} }), closeIfOpen: () => {}, invalidate: () => {} },
    sendMessage: async () => {},
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 20, albumSettleWindowMs: 40, onDispatch, onFailure });
  const context = setUp();
  const handle = createRhythmCallbackHandler({
    allowedUserId: String(USER),
    store: context.store,
    now: () => new Date("2026-09-28T07:00:00Z"),
    currentSessionId: () => "sesn_serving",
    answer: async () => {},
    enqueueUserText: enqueueClickAfterPendingText(buffer),
  });
  const photo = (label: string) => ({ kind: "image" as const, promise: Promise.resolve({ data: label, mediaType: "image/jpeg", byteSize: 1 }) });
  buffer.addFragment({ chatId: CHAT, userId: USER, messageId: 900, mediaGroupId: "alb", text: "Референси", media: photo("p1") });
  await handle(click()); // bot message 777, while the album is still arriving
  buffer.addFragment({ chatId: CHAT, userId: USER, messageId: 901, mediaGroupId: "alb", text: "", media: photo("p2") });
  await sleep(120);
  await buffer.whenIdle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].map((part) => part.type), ["image", "text", "image"], "whole album, one turn");
  assert.deepEqual(calls[1], [{ type: "text", text: "Так, приймаю цей план (план тижня від пн 28.09)." }]);
  assert.equal(maxInFlight, 1, "single-flight");
});
