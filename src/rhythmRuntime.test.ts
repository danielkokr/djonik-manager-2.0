import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { DjonikSessionDeadError, DjonikTracedTurnError, type DjonikTracedSessionHandle, type DjonikTurnPart } from "./djonikClient.js";
import { MessageGroupBuffer } from "./messageGrouping.js";
import { encodeCallbackData } from "./rhythmActions.js";
import {
  createCallbackListener,
  createRhythmTimer,
  createSessionTurnRunner,
  resolveRhythmStatePath,
  RHYTHM_TICK_INTERVAL_MS,
  SERVING_READ_ONLY_BOUNDARY,
  startWorkingRhythm,
  type IntervalTimers,
  type WorkingRhythmDeps,
} from "./rhythmRuntime.js";
import { AutonomousTurnFailure } from "./rhythmRunner.js";
import { createMemoryRhythmStateStore, emptyRhythmState, type DeliveryRecord } from "./rhythmState.js";
import { enqueueClickAfterPendingText, STALE_BUTTON_TEXT } from "./rhythmTelegram.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import { createSessionManager } from "./telegramAdapter.js";

// #39 Stage 2 — runtime wiring: activation locks, state path, timer lifecycle, the Session turn runner, and
// real grammY `callback_query:data` dispatch. Zero network, zero inference.

const USER = 4242;

function fakeTimers() {
  const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const timers: IntervalTimers = {
    setInterval: (fn, ms) => {
      const handle = { fn, ms, cleared: false };
      intervals.push(handle);
      return handle;
    },
    clearInterval: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return { timers, intervals, fire: () => intervals.filter((i) => !i.cleared).forEach((i) => i.fn()) };
}

interface Effects {
  configSources: number;
  stores: string[];
  collectors: number;
  turns: number;
  sends: number;
  answers: Array<string | undefined>;
  enqueued: string[];
}

function deps(env: NodeJS.ProcessEnv, boundary: WorkingRhythmDeps["readOnlyBoundary"], extra: Partial<WorkingRhythmDeps> = {}) {
  const effects: Effects = { configSources: 0, stores: [], collectors: 0, turns: 0, sends: 0, answers: [], enqueued: [] };
  const clock = fakeTimers();
  const store = createMemoryRhythmStateStore();
  const d: WorkingRhythmDeps = {
    env,
    readOnlyBoundary: boundary,
    allowedUserId: String(USER),
    createConfigSource: () => (effects.configSources++, { read: async () => null }),
    createStateStore: (path) => (effects.stores.push(path), store),
    createFactCollector: () => (effects.collectors++, async () => ({ cards: [], projects: [], followUps: [] })),
    runTurn: async () => (effects.turns++, { reply: "Бриф.", sessionId: "sesn_serving", toolUses: [] }),
    send: async () => (effects.sends++, { status: "sent", messageId: 900 }),
    currentSessionId: () => "sesn_serving",
    answer: async (_query, alert) => void effects.answers.push(alert),
    enqueueUserText: (fragment) => void effects.enqueued.push(fragment.text),
    now: () => new Date("2026-09-29T06:35:00Z"), // Tuesday 09:35 Kyiv: a ritual is due
    timers: clock.timers,
    ...extra,
  };
  return { d, effects, clock, store };
}

const zeroEffects = (effects: Effects) => effects.configSources + effects.stores.length + effects.collectors + effects.turns + effects.sends;

// --- Locks ------------------------------------------------------------------------------------------------

test("feature OFF (env unset): nothing constructed — no Memory config read, no state, no facts, no model call, no timer", async () => {
  const { d, effects, clock } = deps({ STATE_DIRECTORY: "/var/lib/djonik" }, "pre_execution");
  const runtime = startWorkingRhythm(d);
  assert.equal(runtime.status, "off");
  assert.equal(zeroEffects(effects), 0);
  assert.equal(clock.intervals.length, 0);
  // An allowed user's old button: stale answer, still no state access.
  assert.deepEqual(await runtime.handleCallback({ id: "q", data: encodeCallbackData("accept_plan", "abcdef123456"), fromId: USER, chatId: USER, messageId: 1 }), {
    outcome: "rejected",
    reason: "rhythm_off",
  });
  assert.deepEqual(effects.answers, [STALE_BUTTON_TEXT]);
  assert.deepEqual(await runtime.handleCallback({ id: "q", data: "x", fromId: 1 }), { outcome: "ignored", reason: "unauthorized" });
  assert.equal(effects.answers.length, 1, "strangers get no answer");
  assert.equal(zeroEffects(effects) + effects.enqueued.length, 0);
});

test("feature OFF for anything but exactly `on`", () => {
  for (const value of ["", "1", "true", "ON", "yes", " off "]) {
    const { d, effects } = deps({ DJONIK_WORKING_RHYTHM: value, STATE_DIRECTORY: "/var/lib/djonik" }, "pre_execution");
    assert.equal(startWorkingRhythm(d).status, "off", JSON.stringify(value));
    assert.equal(zeroEffects(effects), 0);
  }
});

test("switched ON but only post-hoc detection (the serving boundary): blocked — zero autonomous model calls, zero reads", async () => {
  assert.equal(SERVING_READ_ONLY_BOUNDARY, "post_hoc_detection_only");
  const { d, effects, clock } = deps({ DJONIK_WORKING_RHYTHM: "on", STATE_DIRECTORY: "/var/lib/djonik" }, SERVING_READ_ONLY_BOUNDARY);
  const runtime = startWorkingRhythm(d);
  assert.equal(runtime.status, "blocked");
  assert.equal(runtime.reason, "read_only_boundary=post_hoc_detection_only");
  assert.equal(zeroEffects(effects), 0);
  assert.equal(clock.intervals.length, 0, "no timer at all");
  await runtime.stop();
});

test("switched ON with a boundary but no known state path: blocked, nothing constructed", () => {
  const { d, effects } = deps({ DJONIK_WORKING_RHYTHM: "on" }, "pre_execution");
  const runtime = startWorkingRhythm(d);
  assert.equal(runtime.status, "blocked");
  assert.equal(runtime.reason, "state_path_unknown");
  assert.equal(zeroEffects(effects), 0);
});

test("both locks open (test-only boundary): one 60 s timer; a tick runs one ritual; stop ends future ticks", async () => {
  const { d, effects, clock } = deps({ DJONIK_WORKING_RHYTHM: "on", STATE_DIRECTORY: "/var/lib/djonik" }, "pre_execution");
  const runtime = startWorkingRhythm(d);
  assert.equal(runtime.status, "running");
  assert.deepEqual(effects.stores, ["/var/lib/djonik/rhythm-state.json"]);
  assert.equal(clock.intervals.length, 1);
  assert.equal(clock.intervals[0].ms, RHYTHM_TICK_INTERVAL_MS);
  assert.equal(RHYTHM_TICK_INTERVAL_MS, 60_000);
  clock.fire();
  await runtime.stop();
  assert.equal(effects.turns, 1);
  assert.equal(effects.sends, 1);
  assert.equal(clock.intervals[0].cleared, true);
  clock.intervals[0].fn(); // a stray callback after stop does nothing
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(effects.turns, 1);
});

// --- State path ---------------------------------------------------------------------------------------------

test("state path: explicit absolute override, else systemd StateDirectory; relative or absent → unknown", () => {
  assert.equal(resolveRhythmStatePath({ STATE_DIRECTORY: "/var/lib/djonik" }), "/var/lib/djonik/rhythm-state.json");
  assert.equal(resolveRhythmStatePath({ STATE_DIRECTORY: "/var/lib/djonik:/var/lib/other" }), resolveRhythmStatePath({ STATE_DIRECTORY: "/var/lib/djonik" }));
  assert.equal(resolveRhythmStatePath({ DJONIK_RHYTHM_STATE_PATH: "/srv/state.json", STATE_DIRECTORY: "/var/lib/djonik" }), "/srv/state.json");
  assert.equal(resolveRhythmStatePath({ DJONIK_RHYTHM_STATE_PATH: "state.json" }), null);
  assert.equal(resolveRhythmStatePath({ STATE_DIRECTORY: "relative" }), null);
  assert.equal(resolveRhythmStatePath({}), null);
});

// --- Timer --------------------------------------------------------------------------------------------------

test("timer: overlapping fires are single-flight; a throwing tick is logged and never crashes; stop waits for the in-flight tick", async () => {
  const clock = fakeTimers();
  const lines: string[] = [];
  let calls = 0;
  let release: () => void = () => {};
  const timer = createRhythmTimer({
    tick: () => {
      calls += 1;
      if (calls === 1) return new Promise<void>((resolve) => (release = resolve));
      throw new Error("boom");
    },
    timers: clock.timers,
    log: (line) => lines.push(line),
  });
  timer.start();
  timer.start(); // idempotent
  assert.equal(clock.intervals.length, 1);
  clock.fire();
  await new Promise((resolve) => setImmediate(resolve));
  clock.fire(); // still running → skipped
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  clock.fire(); // throws synchronously inside the tick
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(lines, ["[rhythm] tick_threw"]);
  let stopped = false;
  clock.fire();
  const stopping = timer.stop().then(() => (stopped = true));
  await stopping;
  assert.ok(stopped);
  assert.equal(clock.intervals[0].cleared, true);
});

// --- Session turn runner --------------------------------------------------------------------------------------

function tracedSession(sendTraced: DjonikTracedSessionHandle["sendTraced"]): DjonikTracedSessionHandle {
  return { sessionId: "sesn_serving", send: async () => "", sendOrdered: async () => "", sendTraced, close: () => {} };
}

test("Session turn runner: the scheduled prompt goes through sendTraced as one text part; result passes through", async () => {
  const parts: DjonikTurnPart[][] = [];
  const manager = createSessionManager(async () =>
    tracedSession(async (p) => (parts.push(p), { reply: "Бриф.", sessionId: "sesn_serving", toolUses: [{ kind: "mcp", name: "trelloReadCard" }] })),
  );
  const run = createSessionTurnRunner(manager);
  const result = await run({ origin: "rhythm_ritual", occurrenceKey: "morning:2026-09-29", kind: "morning", prompt: "[Робочий ритм · …]" });
  assert.deepEqual(parts, [[{ type: "text", text: "[Робочий ритм · …]" }]]);
  assert.deepEqual(result, { reply: "Бриф.", sessionId: "sesn_serving", toolUses: [{ kind: "mcp", name: "trelloReadCard" }] });
});

test("Session turn runner: a failed turn surfaces its tools; a dead Session is invalidated exactly like a typed turn", async () => {
  let connects = 0;
  const manager = createSessionManager(async () => {
    connects += 1;
    return tracedSession(async () => {
      throw new DjonikTracedTurnError(new DjonikSessionDeadError("stream ended"), `sesn_${connects}`, [{ kind: "builtin", name: "edit" }]);
    });
  });
  const run = createSessionTurnRunner(manager);
  const request = { origin: "rhythm_ritual" as const, occurrenceKey: "k", kind: "morning" as const, prompt: "p" };
  const error = await run(request).then(() => assert.fail("must reject"), (reason: unknown) => reason);
  assert.ok(error instanceof AutonomousTurnFailure);
  assert.deepEqual(error.toolUses, [{ kind: "builtin", name: "edit" }]);
  assert.equal(error.sessionId, "sesn_1");
  assert.equal(manager.currentSessionId(), null, "dead Session discarded");
  await run(request).catch(() => undefined);
  assert.equal(connects, 2, "the next turn reconnects");

  const unreachable = createSessionTurnRunner(createSessionManager(async () => Promise.reject(new Error("attestation"))));
  const noSession = await unreachable(request).then(() => assert.fail("must reject"), (reason: unknown) => reason);
  assert.ok(noSession instanceof AutonomousTurnFailure);
  assert.deepEqual(noSession.toolUses, []);
});

// --- grammY callback wiring --------------------------------------------------------------------------------

const BOT_INFO = { id: 1, is_bot: true, first_name: "Djonik", username: "djonik_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as UserFromGetMe;

function testBot() {
  const bot = new Bot("123:TEST", { botInfo: BOT_INFO });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  return { bot, apiCalls };
}

let updateId = 1;
const callbackUpdate = (data: string, fromId = USER, messageId = 777) => ({
  update_id: updateId++,
  callback_query: {
    id: `cbq_${updateId}`,
    chat_instance: "ci",
    data,
    from: { id: fromId, is_bot: false, first_name: "Daniel" },
    message: { message_id: messageId, date: 0, chat: { id: USER, type: "private" as const, first_name: "Daniel" } },
  },
});

function sentRecord(): DeliveryRecord {
  return {
    key: "monday-plan:2026-09-28", kind: "monday-plan", status: "sent", attempts: 1, ref: "abcdef123456", sessionId: "sesn_serving",
    createdAt: "2026-09-28T06:30:00.000Z", updatedAt: "2026-09-28T06:31:00.000Z", sentAt: "2026-09-28T06:31:00.000Z",
    telegramMessageId: 777, actions: ["accept_plan", "modify", "details"],
  };
}

test("grammY: callback_query:data from Daniel reaches the runtime; the same allowed-user rule ignores anyone else", async () => {
  const { bot, apiCalls } = testBot();
  const off = startWorkingRhythm(deps({}, SERVING_READ_ONLY_BOUNDARY).d);
  const seen: unknown[] = [];
  const runtime = { handleCallback: async (query: unknown) => (seen.push(query), off.handleCallback(query as never)) };
  bot.on("callback_query:data", createCallbackListener(runtime, { allowedUserId: String(USER) }));
  await bot.handleUpdate(callbackUpdate("rh1:acc:abcdef123456", 999));
  assert.equal(seen.length, 0, "a stranger's click never reaches the runtime");
  assert.equal(apiCalls.length, 0, "and is not answered");
  await bot.handleUpdate(callbackUpdate("rh1:acc:abcdef123456"));
  assert.deepEqual(seen, [{ id: `cbq_${updateId}`, data: "rh1:acc:abcdef123456", fromId: USER, chatId: USER, messageId: 777 }]);
});

test("grammY end to end (running runtime): valid click → ordinary user turn through the buffer and FIFO Session; double click and stale Session rejected", async () => {
  const { bot, apiCalls } = testBot();
  const store = createMemoryRhythmStateStore({ ...emptyRhythmState(), deliveries: { "monday-plan:2026-09-28": sentRecord() } });
  const sessionCalls: DjonikTurnPart[][] = [];
  const replies: string[] = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: {
      getSession: async () => ({ sessionId: "sesn_serving", send: async () => "", sendOrdered: async (parts) => (sessionCalls.push(parts), "Добре, фіксую план."), close: () => {} }),
      closeIfOpen: () => {},
      invalidate: () => {},
    },
    sendMessage: async (_chat, text) => void replies.push(text),
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });
  let currentSession = "sesn_serving";
  const { d } = deps({ DJONIK_WORKING_RHYTHM: "on", STATE_DIRECTORY: "/var/lib/djonik" }, "pre_execution", {
    createStateStore: () => store,
    currentSessionId: () => currentSession,
    now: () => new Date("2026-09-28T07:00:00Z"),
    answer: (query, alert) => bot.api.answerCallbackQuery(query.id!, alert ? { text: alert, show_alert: true } : undefined),
    clearButtons: (chatId, messageId) => bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } }),
    enqueueUserText: enqueueClickAfterPendingText(buffer),
  });
  const runtime = startWorkingRhythm(d);
  bot.on("callback_query:data", createCallbackListener(runtime, { allowedUserId: String(USER) }));

  await bot.handleUpdate(callbackUpdate("rh1:acc:abcdef123456"));
  await bot.handleUpdate(callbackUpdate("rh1:mod:abcdef123456")); // double click (other button, same message)
  await buffer.whenIdle();
  await runtime.stop();

  assert.deepEqual(sessionCalls, [[{ type: "text", text: "Так, приймаю цей план (план тижня від пн 28.09)." }]], "one ordinary text turn");
  assert.deepEqual(replies, ["Добре, фіксую план."]);
  assert.deepEqual(
    apiCalls.map((call) => [call.method, call.payload.text ?? null]),
    [
      ["answerCallbackQuery", null],
      ["editMessageReplyMarkup", null],
      ["answerCallbackQuery", "Відповідь на це повідомлення вже прийнята. Якщо хочеш щось змінити — напиши текстом."],
    ],
  );
  assert.ok(apiCalls.every((call) => !/sendMessage|Trello/i.test(call.method)), "a click never sends or mutates anything itself");

  // A new serving Session (restart) makes the old buttons stale.
  const other = createMemoryRhythmStateStore({ ...emptyRhythmState(), deliveries: { "monday-plan:2026-09-28": sentRecord() } });
  currentSession = "sesn_after_restart";
  const restarted = startWorkingRhythm({ ...d, createStateStore: () => other });
  assert.deepEqual(await restarted.handleCallback({ id: "q2", data: "rh1:acc:abcdef123456", fromId: USER, chatId: USER, messageId: 777 }), {
    outcome: "rejected",
    reason: "session_changed",
  });
  await restarted.stop();
});
