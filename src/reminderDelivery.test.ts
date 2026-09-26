import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import { encodeCallbackData, type OutboundMessage } from "./rhythmActions.js";
import type { AutonomousTurnRequest, SendOutcome } from "./rhythmRunner.js";
import { startWorkingRhythm, type IntervalTimers, type WorkingRhythmRuntime } from "./rhythmRuntime.js";
import { createFileRhythmStateStore, createMemoryRhythmStateStore, emptyRhythmState, remindersOf, type RhythmState, type RhythmStateStore } from "./rhythmState.js";
import { createReminderToolExecutor } from "./reminderTool.js";
import {
  createReminderScheduler,
  decodeReminderCallback,
  encodeReminderCallback,
  REMINDER_ALREADY_TEXT,
  REMINDER_DONE_TEXT,
  REMINDER_STALE_TEXT,
  trelloCardContext,
} from "./reminderDelivery.js";
import type { Reminder } from "./reminders.js";

// #54 reminder delivery: one timer, one state file, rhythm first then reminders. Injected clock, state store, model
// turn and Telegram send. Zero network, zero inference.

const USER = 4242;
const STATE_ENV = { STATE_DIRECTORY: "/var/lib/djonik" };
const RHYTHM_ENV = { ...STATE_ENV, DJONIK_WORKING_RHYTHM: "on" };

/** Kyiv wall-clock (EEST, UTC+3 until 25.10.2026) → instant. */
const kyiv = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);
const SAT_NOON = kyiv("2026-09-26", "12:00");

const idleTimers: IntervalTimers = { setInterval: () => ({}), clearInterval: () => {} };

interface World {
  runtime: WorkingRhythmRuntime;
  store: RhythmStateStore;
  sends: Array<{ message: OutboundMessage; ref: string }>;
  turns: AutonomousTurnRequest[];
  answers: Array<string | undefined>;
  cleared: number[];
  setNow(at: Date): void;
  tick(at?: Date): Promise<void>;
  create(input: Record<string, unknown>, toolUseId?: string): Promise<Record<string, any>>;
  reminders(): Promise<Reminder[]>;
}

function world(options: {
  env?: NodeJS.ProcessEnv;
  store?: RhythmStateStore;
  now?: Date;
  send?: (message: OutboundMessage, index: number) => SendOutcome | Promise<SendOutcome>;
  runTurn?: (request: AutonomousTurnRequest) => Promise<{ reply: string; sessionId: string; toolUses: [] }>;
  remindersEnabled?: boolean;
  cardContext?: (cardId: string) => Promise<{ name: string; finished: boolean } | null>;
}): World {
  let now = options.now ?? SAT_NOON;
  const store = options.store ?? createMemoryRhythmStateStore();
  const sends: World["sends"] = [];
  const turns: AutonomousTurnRequest[] = [];
  const answers: Array<string | undefined> = [];
  const cleared: number[] = [];
  let messageId = 500;
  const runtime = startWorkingRhythm({
    env: options.env ?? STATE_ENV,
    readOnlyBoundary: "pre_execution",
    allowedUserId: String(USER),
    createConfigSource: () => ({ read: async () => null }),
    createStateStore: () => store,
    runTurn: async (request) => {
      turns.push(request);
      return options.runTurn ? options.runTurn(request) : { reply: "🎯 Головне: концепт Seqthera.", sessionId: "sesn_serving", toolUses: [] };
    },
    send: async (message, ref) => {
      sends.push({ message, ref });
      if (options.send) return options.send(message, sends.length - 1);
      messageId += 1;
      return { status: "sent", messageId };
    },
    currentSessionId: () => "sesn_serving",
    answer: async (_query, text) => void answers.push(text),
    clearButtons: async (_chatId, id) => void cleared.push(id),
    enqueueUserText: () => {},
    now: () => now,
    timers: idleTimers,
    reminders: { enabled: options.remindersEnabled ?? true, ...(options.cardContext ? { cardContext: options.cardContext } : {}) },
  });
  const execute = createReminderToolExecutor({ store, now: () => now, readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => runtime.status === "running" });
  let calls = 0;
  return {
    runtime,
    store,
    sends,
    turns,
    answers,
    cleared,
    setNow: (at) => (now = at),
    async tick(at) {
      if (at) now = at;
      await runtime.tickNow!();
    },
    async create(input, toolUseId = `sevt_${++calls}`) {
      const result = await execute({ op: "create", ...input }, { toolUseId, authority: "human" });
      assert.equal(result.isError, false, result.content);
      return JSON.parse(result.content);
    },
    async reminders() {
      return Object.values(remindersOf(await store.load()).items);
    },
  };
}

const click = (data: string, messageId: number, fromId = USER) => ({ id: "q", data, fromId, chatId: USER, messageId });

// --- Timed reminders --------------------------------------------------------------------------------------

test("a timed reminder fires once, at its moment, as a short code-owned message with ✅ / ⏰ buttons", async () => {
  const w = world({});
  const created = await w.create({ text: "написати клієнту", when: { time: "15:00" } });
  const id = created.reminder.id;
  await w.tick(kyiv("2026-09-26", "14:59"));
  assert.equal(w.sends.length, 0, "not before its moment");
  await w.tick(kyiv("2026-09-26", "15:00"));
  await w.tick(kyiv("2026-09-26", "15:01"));
  await w.tick(kyiv("2026-09-26", "16:30"));
  assert.equal(w.sends.length, 1, "exactly once");
  assert.equal(w.sends[0].message.text, "🔔 Ти просив нагадати: написати клієнту");
  assert.deepEqual(w.sends[0].message.keyboard, {
    inline_keyboard: [[
      { text: "✅ Зроблено", callback_data: `rm1:d:${id}:1` },
      { text: "⏰ Завтра", callback_data: `rm1:t:${id}:1` },
    ]],
  });
  assert.deepEqual(w.sends[0].message.actions, [], "no rhythm buttons on a reminder");
  const [reminder] = await w.reminders();
  assert.deepEqual([reminder.status, reminder.via, reminder.telegramMessageId], ["delivered", "direct", 501]);
  assert.equal(w.turns.length, 0, "delivering a reminder takes no model turn");
});

test("reminders run with the Working Rhythm OFF; with no `reminder` tool in the release nothing is constructed", async () => {
  const on = world({ env: STATE_ENV });
  assert.deepEqual([on.runtime.status, on.runtime.reminders], ["off", "on"]);
  await on.create({ text: "x", when: { time: "15:00" } });
  await on.tick(kyiv("2026-09-26", "15:00"));
  assert.equal(on.sends.length, 1);

  let stores = 0;
  const off = startWorkingRhythm({
    env: STATE_ENV,
    readOnlyBoundary: "pre_execution",
    allowedUserId: String(USER),
    createConfigSource: () => ({ read: async () => null }),
    createStateStore: () => (stores++, createMemoryRhythmStateStore()),
    runTurn: async () => assert.fail("no turn"),
    send: async () => assert.fail("no send"),
    currentSessionId: () => null,
    answer: async () => {},
    enqueueUserText: () => {},
    timers: idleTimers,
    reminders: { enabled: false },
  });
  assert.deepEqual([off.status, off.reminders, stores, off.tickNow], ["off", "off", 0, undefined]);
  assert.equal((await off.handleCallback(click(encodeReminderCallback("done", "abcdef1234", 1), 1))).outcome, "rejected");
});

test("restart before due: a new process on the same state file still delivers it — once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-reminders-"));
  try {
    const path = join(dir, "rhythm-state.json");
    const first = world({ store: createFileRhythmStateStore(path) });
    await first.create({ text: "банер Azov", when: { time: "15:00" } });
    await first.runtime.stop();
    const second = world({ store: createFileRhythmStateStore(path) });
    await second.tick(kyiv("2026-09-26", "15:00"));
    await second.tick(kyiv("2026-09-26", "15:05"));
    assert.equal(second.sends.length, 1);
    // Restart after the successful delivery: never again.
    const third = world({ store: createFileRhythmStateStore(path) });
    await third.tick(kyiv("2026-09-26", "15:10"));
    await third.tick(kyiv("2026-09-27", "15:00"));
    assert.equal(third.sends.length, 0);
    assert.equal((await third.reminders())[0].status, "delivered");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("crash during the Telegram call: `sending` was persisted first → ambiguous at restart, never resent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-reminders-"));
  try {
    const path = join(dir, "rhythm-state.json");
    const crashed = world({ store: createFileRhythmStateStore(path), send: () => new Promise<never>(() => {}) });
    await crashed.create({ text: "x", when: { time: "15:00" } });
    crashed.setNow(kyiv("2026-09-26", "15:00"));
    void crashed.runtime.tickNow!(); // the process "dies" inside the send
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await crashed.reminders())[0].status, "sending");
    const restarted = world({ store: createFileRhythmStateStore(path) });
    await restarted.tick(kyiv("2026-09-26", "15:01"));
    await restarted.tick(kyiv("2026-09-26", "18:00"));
    assert.equal(restarted.sends.length, 0);
    const [reminder] = await restarted.reminders();
    assert.deepEqual([reminder.status, reminder.failure], ["ambiguous", "interrupted_during_send"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown Telegram outcome is ambiguous and never blindly retried; a definite refusal retries, then fails visibly in list", async () => {
  const unknown = world({ send: () => ({ status: "unknown", reason: "timeout" }) });
  await unknown.create({ text: "x", when: { time: "15:00" } });
  for (const time of ["15:00", "15:01", "15:02", "16:00"]) await unknown.tick(kyiv("2026-09-26", time));
  assert.equal(unknown.sends.length, 1);
  assert.equal((await unknown.reminders())[0].status, "ambiguous");

  const refused = world({ send: () => ({ status: "rejected", reason: "http_400" }) });
  await refused.create({ text: "y", when: { time: "15:00" } });
  for (const time of ["15:00", "15:01", "15:02", "15:03", "15:04"]) await refused.tick(kyiv("2026-09-26", time));
  assert.equal(refused.sends.length, 3, "MAX_DIRECT_ATTEMPTS definite refusals");
  const [reminder] = await refused.reminders();
  assert.deepEqual([reminder.status, reminder.attempts], ["failed", 3]);
});

test("a late reminder never lands in quiet hours: down over its moment, it waits for the quiet end and says it is late", async () => {
  const w = world({});
  await w.create({ text: "подзвонити", when: { time: "19:00" } });
  await w.tick(kyiv("2026-09-26", "21:00")); // the process was down at 19:00
  await w.tick(kyiv("2026-09-27", "07:00"));
  assert.equal(w.sends.length, 0);
  await w.tick(kyiv("2026-09-27", "09:30"));
  assert.equal(w.sends.length, 1);
  assert.equal(w.sends[0].message.text, "🔔 Ти просив нагадати: подзвонити\n⏱ Мало прийти сьогодні, сб 26.09 о 19:00 — надсилаю із запізненням.".replace("сьогодні, сб", "сб"));
});

test("a cancel while the send is in flight wins: the outcome never resurrects it", async () => {
  let execute: ReturnType<typeof createReminderToolExecutor> | null = null;
  const w = world({
    send: async () => {
      await execute!({ op: "cancel", match: "банер" }, { toolUseId: "sevt_cancel", authority: "human" });
      return { status: "sent", messageId: 9 };
    },
  });
  execute = createReminderToolExecutor({ store: w.store, now: () => kyiv("2026-09-26", "15:00"), readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => false });
  await w.create({ text: "банер", when: { time: "15:00" } });
  await w.tick(kyiv("2026-09-26", "15:00"));
  assert.equal((await w.reminders())[0].status, "cancelled");
});

// --- Date-only reminders and the morning ritual ----------------------------------------------------------

test("date-only: included exactly once in that morning's ritual — code-owned lines first, the ritual's own buttons", async () => {
  const w = world({ env: RHYTHM_ENV });
  assert.equal(w.runtime.status, "running");
  const created = await w.create({ text: "банер Azov", project: "Azov", when: { day: "date", date: "29.09" } });
  assert.equal(created.reminder.surface, "morning_brief");
  await w.tick(kyiv("2026-09-29", "09:30")); // Tuesday brief
  await w.tick(kyiv("2026-09-29", "09:31"));
  await w.tick(kyiv("2026-09-29", "10:30"));
  assert.equal(w.turns.length, 1);
  assert.match(w.turns[0].prompt, /код сам поставить їх першими рядками/);
  assert.match(w.turns[0].prompt, /- банер Azov \(Azov\)/);
  assert.equal(w.sends.length, 1, "no second, direct message");
  assert.equal(w.sends[0].message.text, "🔔 Ти просив нагадати: банер Azov (Azov)\n\n🎯 Головне: концепт Seqthera.");
  assert.deepEqual(w.sends[0].message.actions, ["ack", "reorder", "details"]);
  const [reminder] = await w.reminders();
  assert.deepEqual([reminder.status, reminder.via, reminder.ritualKey], ["delivered", "ritual", "morning:2026-09-29"]);
});

test("date-only on a Monday rides the week plan", async () => {
  const w = world({ env: RHYTHM_ENV });
  await w.create({ text: "виділити день на Limen", when: { day: "weekday", weekday: "mon" } });
  await w.tick(kyiv("2026-09-28", "09:30"));
  assert.equal(w.turns[0].kind, "monday-plan");
  assert.match(w.sends[0].message.text, /^🔔 Ти просив нагадати: виділити день на Limen\n\n/);
});

test("ritual missing (rhythm off / non-workday) → a separate morning message at the morning time", async () => {
  const off = world({ env: STATE_ENV });
  await off.create({ text: "банер", when: { day: "date", date: "29.09" } });
  await off.tick(kyiv("2026-09-29", "09:29"));
  assert.equal(off.sends.length, 0);
  await off.tick(kyiv("2026-09-29", "09:30"));
  assert.equal(off.sends.length, 1);
  assert.equal(off.sends[0].message.text, "🔔 Ти просив нагадати: банер");

  const sunday = world({ env: RHYTHM_ENV });
  await sunday.create({ text: "полити квіти", when: { day: "tomorrow" } }); // Sunday: no ritual
  await sunday.tick(kyiv("2026-09-27", "09:30"));
  assert.deepEqual([sunday.turns.length, sunday.sends.length], [0, 1]);
});

test("the ritual turn fails → its claim is released and the reminder goes out directly in the same tick", async () => {
  const w = world({
    env: RHYTHM_ENV,
    runTurn: async () => {
      throw new Error("model down");
    },
  });
  await w.create({ text: "банер", when: { day: "date", date: "29.09" } });
  await w.tick(kyiv("2026-09-29", "09:30"));
  assert.equal(w.sends.length, 1);
  assert.equal(w.sends[0].message.text, "🔔 Ти просив нагадати: банер");
  const [reminder] = await w.reminders();
  assert.deepEqual([reminder.status, reminder.via, reminder.ritualClaim], ["delivered", "direct", undefined]);
});

test("the ritual message's send outcome is unknown → the reminder it carried is ambiguous too (never resent directly)", async () => {
  const w = world({ env: RHYTHM_ENV, send: () => ({ status: "unknown", reason: "timeout" }) });
  await w.create({ text: "банер", when: { day: "date", date: "29.09" } });
  await w.tick(kyiv("2026-09-29", "09:30"));
  await w.tick(kyiv("2026-09-29", "10:30"));
  assert.equal(w.sends.length, 1);
  assert.equal((await w.reminders())[0].status, "ambiguous");
});

test("a reminder cancelled while the ritual turn runs is not included", async () => {
  let cancel: (() => Promise<unknown>) | null = null;
  const w = world({
    env: RHYTHM_ENV,
    runTurn: async () => {
      await cancel!();
      return { reply: "Бриф.", sessionId: "sesn_serving", toolUses: [] };
    },
  });
  const execute = createReminderToolExecutor({ store: w.store, now: () => kyiv("2026-09-29", "09:30"), readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => true });
  cancel = () => execute({ op: "cancel", match: "банер" }, { toolUseId: "sevt_c", authority: "human" });
  await w.create({ text: "банер", when: { day: "date", date: "29.09" } });
  await w.tick(kyiv("2026-09-29", "09:30"));
  assert.equal(w.sends.length, 1);
  assert.equal(w.sends[0].message.text, "Бриф.");
  assert.equal((await w.reminders())[0].status, "cancelled");
});

test("reminders are not exception signals: never counted, never suppressed by other proactive messages", async () => {
  const today = "2026-09-26";
  const sent = (key: string, kind: "exception" | "morning", at: string) => ({
    key, kind, status: "sent" as const, attempts: 1, ref: "abcdef123456", sessionId: "s", createdAt: at, updatedAt: at, sentAt: at, actions: [],
  });
  const seeded: RhythmState = {
    ...emptyRhythmState(),
    deliveries: {
      [`morning:${today}`]: sent(`morning:${today}`, "morning", `${today}T06:30:00.000Z`),
      [`exception:${today}:a`]: sent(`exception:${today}:a`, "exception", `${today}T08:00:00.000Z`),
      [`exception:${today}:b`]: sent(`exception:${today}:b`, "exception", `${today}T10:00:00.000Z`),
    },
  };
  const w = world({ store: createMemoryRhythmStateStore(seeded) });
  await w.create({ text: "x", when: { time: "15:00" } });
  await w.create({ text: "y", when: { time: "15:00" } });
  await w.tick(kyiv(today, "15:00"));
  assert.equal(w.sends.length, 2, "two reminders at the same minute, after the day's caps were already reached");
  const state = await w.store.load();
  assert.deepEqual(Object.keys(state.deliveries).sort(), Object.keys(seeded.deliveries).sort(), "no reminder enters the rhythm delivery ledger");
});

test("startup recovery runs before any ritual claim: a crash-left claim is released, a crash-left send is ambiguous", async () => {
  const w0 = world({});
  await w0.create({ text: "claimed", when: { day: "date", date: "29.09" } });
  await w0.create({ text: "sending", when: { time: "15:00" } });
  const state = await w0.store.load();
  const ledger = remindersOf(state);
  const [claimed, sending] = Object.values(ledger.items);
  ledger.items[claimed.id] = { ...claimed, ritualClaim: { key: "morning:2026-09-29", at: "2026-09-29T06:30:00.000Z" } };
  ledger.items[sending.id] = { ...sending, status: "sending" };
  const w = world({ env: STATE_ENV, store: createMemoryRhythmStateStore({ ...state, reminders: ledger }) });
  await w.tick(kyiv("2026-09-29", "09:31"));
  const items = await w.reminders();
  assert.equal(items.find((item) => item.text === "sending")!.status, "ambiguous");
  assert.equal(items.find((item) => item.text === "claimed")!.status, "delivered", "released, then delivered directly");
  assert.equal(w.sends.length, 1);
});

// --- Card context -----------------------------------------------------------------------------------

const CARD = { id: "0123456789abcdef01234567", name: "Банер" };

test("a linked card already Done is said at delivery; Trello down or slow never blocks the reminder", async () => {
  const done = world({ cardContext: trelloCardContext({ readCardState: async () => ({ name: "Банер 2", closed: false, dueComplete: false, listName: "Done" }) }) });
  await done.create({ text: "банер", project: "Azov", card: CARD, when: { time: "15:00" } });
  await done.tick(kyiv("2026-09-26", "15:00"));
  assert.equal(done.sends[0].message.text, "🔔 Ти просив нагадати: банер\nПроєкт: Azov · картка «Банер 2» уже в Done");

  const down = world({ cardContext: async () => Promise.reject(new Error("503")) });
  await down.create({ text: "банер", card: CARD, when: { time: "15:00" } });
  await down.tick(kyiv("2026-09-26", "15:00"));
  assert.equal(down.sends[0].message.text, "🔔 Ти просив нагадати: банер\nКартка: «Банер»");

  // Slow Trello: bounded wait, then delivery without context.
  const store = createMemoryRhythmStateStore();
  const creator = world({ store });
  await creator.create({ text: "банер", card: CARD, when: { time: "15:00" } });
  const sends: string[] = [];
  const scheduler = createReminderScheduler({
    store,
    now: () => kyiv("2026-09-26", "15:00"),
    send: async (message) => (sends.push(message.text), { status: "sent", messageId: 1 }),
    ritualConfig: () => null,
    cardContext: () => new Promise(() => {}),
    cardContextTimeoutMs: 10,
  });
  await scheduler.tick();
  assert.deepEqual(sends, ["🔔 Ти просив нагадати: банер\nКартка: «Банер»"]);
});

// --- Buttons -----------------------------------------------------------------------------------------

test("✅ Зроблено closes the reminder once; a second press is gently refused; nothing else is touched", async () => {
  const w = world({});
  const { reminder } = await w.create({ text: "банер", when: { time: "15:00" } });
  await w.tick(kyiv("2026-09-26", "15:00"));
  const messageId = (await w.reminders())[0].telegramMessageId!;
  const data = encodeReminderCallback("done", reminder.id, 1);
  const [first, second] = await Promise.all([w.runtime.handleCallback(click(data, messageId)), w.runtime.handleCallback(click(data, messageId))]);
  assert.deepEqual(first, { outcome: "done", id: reminder.id });
  assert.deepEqual(second, { outcome: "rejected", reason: "already_answered" });
  assert.deepEqual(w.answers, [REMINDER_DONE_TEXT, REMINDER_ALREADY_TEXT]);
  assert.deepEqual(w.cleared, [messageId]);
  const [item] = await w.reminders();
  assert.deepEqual([item.status, item.closedBy], ["done", "button"]);
  assert.equal(w.turns.length, 0, "no model turn, so no Trello tool can run");
});

test("⏰ Завтра moves the SAME reminder to tomorrow (same time) once; older buttons go stale; it fires again once", async () => {
  const w = world({});
  const { reminder } = await w.create({ text: "написати клієнту", when: { time: "15:00" } });
  await w.tick(kyiv("2026-09-26", "15:00"));
  const messageId = (await w.reminders())[0].telegramMessageId!;
  const tomorrow = encodeReminderCallback("tomorrow", reminder.id, 1);
  assert.deepEqual(await w.runtime.handleCallback(click(tomorrow, messageId)), { outcome: "rescheduled", id: reminder.id, label: "завтра, нд 27.09 о 15:00" });
  assert.equal(w.answers[0], "⏰ Нагадаю завтра, нд 27.09 о 15:00.");
  for (const data of [tomorrow, encodeReminderCallback("done", reminder.id, 1)]) {
    assert.deepEqual(await w.runtime.handleCallback(click(data, messageId)), { outcome: "rejected", reason: "stale_generation" });
  }
  assert.equal(w.answers.at(-1), REMINDER_STALE_TEXT);
  const [moved] = await w.reminders();
  assert.deepEqual([moved.status, moved.seq, moved.schedule.dueAt], ["scheduled", 2, "2026-09-27T12:00:00.000Z"]);
  await w.tick(kyiv("2026-09-27", "15:00"));
  await w.tick(kyiv("2026-09-27", "15:05"));
  assert.equal(w.sends.length, 2);
  assert.equal(w.sends[1].message.keyboard!.inline_keyboard[0][0].callback_data, `rm1:d:${reminder.id}:2`);
});

test("button safety: strangers ignored, malformed/unknown/undelivered/wrong-message refused, rhythm buttons still routed", async () => {
  const w = world({ env: RHYTHM_ENV });
  const { reminder } = await w.create({ text: "x", when: { time: "15:00" } });
  const data = encodeReminderCallback("done", reminder.id, 1);
  assert.deepEqual(await w.runtime.handleCallback(click(data, 1, 777)), { outcome: "ignored", reason: "unauthorized" });
  assert.deepEqual(await w.runtime.handleCallback(click("rm1:zz:abc:1", 1)), { outcome: "rejected", reason: "malformed" });
  assert.deepEqual(await w.runtime.handleCallback(click(encodeReminderCallback("done", "ffffffffff", 1), 1)), { outcome: "rejected", reason: "unknown_reminder" });
  assert.deepEqual(await w.runtime.handleCallback(click(data, 1)), { outcome: "rejected", reason: "not_delivered" });
  await w.tick(kyiv("2026-09-26", "15:00"));
  assert.deepEqual(await w.runtime.handleCallback(click(data, 99999)), { outcome: "rejected", reason: "message_mismatch" });
  // A rhythm button still reaches the rhythm handler (here: an unknown delivery ref).
  assert.deepEqual(await w.runtime.handleCallback(click(encodeCallbackData("ack", "abcdef123456"), 1)), { outcome: "rejected", reason: "unknown_ref" });
});

test("an ambiguous delivery's button is accepted: the click itself proves it arrived", async () => {
  const w = world({ send: () => ({ status: "unknown", reason: "timeout" }) });
  const { reminder } = await w.create({ text: "x", when: { time: "15:00" } });
  await w.tick(kyiv("2026-09-26", "15:00"));
  assert.deepEqual(await w.runtime.handleCallback(click(encodeReminderCallback("done", reminder.id, 1), 321)), { outcome: "done", id: reminder.id });
});

test("callback data: versioned, bounded, content-free", () => {
  const data = encodeReminderCallback("tomorrow", "abcdef1234", 12);
  assert.equal(data, "rm1:t:abcdef1234:12");
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.deepEqual(decodeReminderCallback(data), { ok: true, button: "tomorrow", id: "abcdef1234", seq: 12 });
  assert.deepEqual(decodeReminderCallback("rh1:ok:abcdef123456"), { ok: false, reason: "not_reminder" });
  assert.throws(() => encodeReminderCallback("done", "BAD ID", 1));
});
