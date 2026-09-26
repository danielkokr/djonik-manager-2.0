import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import { createFileRhythmStateStore, createMemoryRhythmStateStore, emptyRhythmState, remindersOf, type RhythmStateStore } from "./rhythmState.js";
import { createReminderToolExecutor, isReadOnlyReminderInput, parseReminderToolInput, REMINDER_TOOL, reminderConfirmationOf, type ReminderToolExecutor } from "./reminderTool.js";

// #54 `reminder` custom tool: parsing, authority, durable idempotency by custom_tool_use_id, persistence and
// verification. Zero network, zero inference.

/** Saturday 26.09.2026, 12:00 Kyiv. */
const NOW = new Date("2026-09-26T09:00:00Z");

function service(options: { store?: RhythmStateStore | null; now?: () => Date; ids?: string[]; configFails?: boolean } = {}) {
  const store = options.store === undefined ? createMemoryRhythmStateStore() : options.store;
  const ids = [...(options.ids ?? ["aaaa0001", "aaaa0002", "aaaa0003", "aaaa0004"])];
  const execute = createReminderToolExecutor({
    store,
    now: options.now ?? (() => NOW),
    readConfig: async () => {
      if (options.configFails) throw new Error("memory down");
      return DEFAULT_RHYTHM_CONFIG;
    },
    ritualsRunning: () => true,
    newId: () => ids.shift() ?? `id${Math.random().toString(16).slice(2, 8)}`,
  });
  return { store, execute };
}

const human = (toolUseId: string) => ({ toolUseId, authority: "human" as const });
const parse = (content: string) => JSON.parse(content) as Record<string, any>;

async function call(execute: ReminderToolExecutor, input: unknown, toolUseId = `sevt_${Math.random().toString(36).slice(2)}`) {
  const result = await execute(input, human(toolUseId));
  return { ...result, body: parse(result.content) };
}

test("tool contract: one custom tool with the four product operations; the model passes words, not dates", () => {
  assert.equal(REMINDER_TOOL.name, "reminder");
  assert.deepEqual((REMINDER_TOOL.input_schema.properties.op as { enum: string[] }).enum, ["create", "list", "cancel", "snooze"]);
  assert.match(REMINDER_TOOL.description, /never a date you computed/);
  assert.match(REMINDER_TOOL.description, /`confirmation` line exactly/);
  assert.match(REMINDER_TOOL.description, /never changes Trello and is not a commitment/);
  assert.match(REMINDER_TOOL.description, /Say saved only when the result is ok/);
  assert.ok(REMINDER_TOOL.description.length < 1500, `${REMINDER_TOOL.description.length}`);
});

test("parsing: strict fields; list is the only read-only operation", () => {
  assert.deepEqual(parseReminderToolInput({ op: "list" }), { op: "list", includeHistory: false });
  assert.throws(() => parseReminderToolInput({ op: "create", text: "x", when: { day: "tomorrow" }, date: "2026-09-27" }), /Unknown field/);
  assert.throws(() => parseReminderToolInput({ op: "create", text: "  ", when: { day: "tomorrow" } }), /text/);
  assert.throws(() => parseReminderToolInput({ op: "cancel", id: "abc123", match: "банер" }), /exactly one/);
  assert.throws(() => parseReminderToolInput({ op: "create", text: "x", when: { day: "tomorrow" }, card: { id: "not-an-id" } }), /card/);
  assert.equal(isReadOnlyReminderInput({ op: "list" }), true);
  assert.equal(isReadOnlyReminderInput({ op: "create", text: "x", when: { day: "tomorrow" } }), false);
  assert.equal(isReadOnlyReminderInput({ op: "list", surprise: true }), false, "malformed = not provably read-only");
});

test("create persists the code-resolved schedule and returns a ready confirmation line", async () => {
  const { store, execute } = service();
  const result = await call(execute, { op: "create", text: "банер Azov", project: "Azov", when: { day: "weekday", weekday: "mon" } }, "sevt_1");
  assert.equal(result.isError, false);
  assert.equal(result.body.reminder.date, "2026-09-28");
  assert.equal(result.body.reminder.surface, "monday_plan");
  assert.equal(result.body.confirmation, "🔔 Нагадаю післязавтра, пн 28.09 зранку, у плані тижня: банер Azov");
  assert.equal(reminderConfirmationOf(result.content), result.body.confirmation);
  const stored = remindersOf(await store!.load()).items.aaaa0001;
  assert.equal(stored.status, "scheduled");
  assert.equal(stored.schedule.dueAt, "2026-09-28T06:30:00.000Z");
  assert.equal(stored.createdBy, "sevt_1");
  assert.equal(stored.project, "Azov");
});

test("timed create in quiet hours: confirmation says what was asked and when it will come", async () => {
  const { execute } = service();
  const result = await call(execute, { op: "create", text: "написати клієнту", when: { day: "tomorrow", time: "21:00" } });
  assert.equal(result.body.confirmation, "🔔 21:00 — це тихі години, тож нагадаю післязавтра, пн 28.09 о 09:30: написати клієнту");
  assert.deepEqual(result.body.reminder.quiet_hours_shift, { requested: "21:00", delivers_at: "09:30" });
});

test("durable idempotency: the SAME custom_tool_use_id never creates twice — not even through a new executor (restart)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-reminder-"));
  try {
    const path = join(dir, "rhythm-state.json");
    const first = service({ store: createFileRhythmStateStore(path) });
    const a = await call(first.execute, { op: "create", text: "банер", when: { day: "tomorrow" } }, "sevt_same");
    const b = await call(first.execute, { op: "create", text: "банер", when: { day: "tomorrow" } }, "sevt_same");
    // A fresh process with a fresh store instance on the same file.
    const restarted = service({ store: createFileRhythmStateStore(path), ids: ["bbbb0001"] });
    const c = await call(restarted.execute, { op: "create", text: "банер", when: { day: "tomorrow" } }, "sevt_same");
    assert.equal(b.content, a.content, "cached result bytes");
    assert.equal(c.content, a.content, "cached across restart");
    const ledger = remindersOf(JSON.parse(readFileSync(path, "utf8")));
    assert.deepEqual(Object.keys(ledger.items), ["aaaa0001"]);
    assert.deepEqual(Object.keys(ledger.toolCalls), ["sevt_same"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two different calls stay two reminders; the same text at the same moment is reported as a duplicate, not re-created", async () => {
  const { store, execute } = service();
  await call(execute, { op: "create", text: "банер Azov", when: { day: "tomorrow" } }, "sevt_1");
  await call(execute, { op: "create", text: "виділити день на Limen", when: { day: "tomorrow" } }, "sevt_2");
  const dup = await call(execute, { op: "create", text: "Банер  Azov!", when: { day: "tomorrow" } }, "sevt_3");
  assert.equal(dup.body.duplicate, true);
  assert.match(dup.body.confirmation, /^🔔 Таке нагадування вже є/);
  assert.equal(Object.keys(remindersOf(await store!.load()).items).length, 2);
});

test("autonomous origin cannot create, cancel or move — refused before any state access; list stays available", async () => {
  let loads = 0;
  let updates = 0;
  const inner = createMemoryRhythmStateStore();
  const counting: RhythmStateStore = {
    load: () => ((loads += 1), inner.load()),
    update: (mutate) => ((updates += 1), inner.update(mutate)),
  };
  const { execute } = service({ store: counting });
  for (const input of [
    { op: "create", text: "x", when: { day: "tomorrow" } },
    { op: "cancel", match: "банер" },
    { op: "snooze", id: "aaaa0001", when: { day: "tomorrow" } },
  ]) {
    const result = await execute(input, { toolUseId: "sevt_auto", authority: "autonomous_read_only" });
    assert.equal(result.isError, true);
    assert.equal(parse(result.content).error.code, "not_allowed_in_autonomous_turn");
  }
  assert.deepEqual([loads, updates], [0, 0]);
  const list = await execute({ op: "list" }, { toolUseId: "sevt_auto_list", authority: "autonomous_read_only" });
  assert.equal(list.isError, false);
});

test("list: active reminders only by default, compact, earliest first; history only when asked", async () => {
  const { execute } = service();
  await call(execute, { op: "create", text: "Limen", when: { day: "weekday", weekday: "wed" } });
  await call(execute, { op: "create", text: "написати клієнту", when: { time: "15:00" } });
  const cancelled = await call(execute, { op: "create", text: "старе", when: { day: "tomorrow" } });
  await call(execute, { op: "cancel", id: cancelled.body.reminder.id });
  const list = await call(execute, { op: "list" });
  assert.deepEqual(list.body.active.map((item: { text: string; when: string; status: string }) => [item.text, item.when, item.status]), [
    ["написати клієнту", "сьогодні, сб 26.09 о 15:00", "scheduled"],
    ["Limen", "ср 30.09 зранку, у ранковому брифі", "scheduled"],
  ]);
  assert.equal(list.body.history, undefined);
  const withHistory = await call(execute, { op: "list", include_history: true });
  assert.deepEqual(withHistory.body.history.map((item: { text: string; status: string }) => [item.text, item.status]), [["старе", "cancelled"]]);
});

test("cancel by a distinctive word; several matches → one question, nothing changed; unknown → not_found with the list", async () => {
  const { store, execute } = service();
  await call(execute, { op: "create", text: "банер Azov", when: { day: "tomorrow" } });
  await call(execute, { op: "create", text: "банер Seqthera", when: { day: "tomorrow" } });
  const several = await call(execute, { op: "cancel", match: "банер" });
  assert.equal(several.isError, true);
  assert.equal(several.body.error.code, "several_match");
  assert.equal(several.body.candidates.length, 2);
  assert.equal(several.body.ask, "Про яке саме нагадування йдеться?");
  const none = await call(execute, { op: "cancel", match: "Extract" });
  assert.equal(none.body.error.code, "not_found");
  assert.equal(none.body.active.length, 2);
  const ok = await call(execute, { op: "cancel", match: "seqthera" });
  assert.equal(ok.body.confirmation, "🔕 Скасував нагадування: банер Seqthera");
  const items = remindersOf(await store!.load()).items;
  assert.deepEqual(Object.values(items).map((item) => [item.text, item.status]), [["банер Azov", "scheduled"], ["банер Seqthera", "cancelled"]]);
  const again = await call(execute, { op: "cancel", id: "aaaa0002" });
  assert.equal(again.body.changed, false, "cancelling a cancelled reminder is a no-op");
});

test("snooze moves the SAME reminder (seq+1, new moment), never a second active one", async () => {
  const { store, execute } = service();
  const created = await call(execute, { op: "create", text: "банер", when: { time: "15:00" } });
  const moved = await call(execute, { op: "snooze", id: created.body.reminder.id, when: { day: "tomorrow", time: "11:00" } });
  assert.equal(moved.isError, false);
  assert.equal(moved.body.confirmation, "⏰ Переніс нагадування на завтра, нд 27.09 о 11:00: банер");
  const ledger = remindersOf(await store!.load());
  assert.equal(Object.keys(ledger.items).length, 1);
  const item = ledger.items[created.body.reminder.id];
  assert.deepEqual([item.seq, item.status, item.schedule.dueAt], [2, "scheduled", "2026-09-27T08:00:00.000Z"]);
});

test("time problems are returned for one short question and save nothing", async () => {
  const { store, execute } = service();
  const past = await call(execute, { op: "create", text: "x", when: { day: "today", time: "10:00" } });
  assert.deepEqual([past.isError, past.body.error.code, past.body.ask], [true, "in_past", "Цей момент уже минув — на коли нагадати?"]);
  const needsTime = await call(execute, { op: "create", text: "x", when: { day: "today" } });
  assert.equal(needsTime.body.error.code, "needs_time");
  assert.equal(Object.keys(remindersOf(await store!.load()).items).length, 0);
});

test("no durable home → unavailable, nothing promised; an unreadable /rhythm.md falls back to safe defaults", async () => {
  const none = service({ store: null });
  const result = await call(none.execute, { op: "create", text: "x", when: { day: "tomorrow" } });
  assert.equal(result.body.error.code, "unavailable");
  const fallback = service({ configFails: true });
  const ok = await call(fallback.execute, { op: "create", text: "x", when: { day: "tomorrow", time: "21:00" } });
  assert.equal(ok.body.reminder.time, "09:30", "default quiet hours still apply");
});

test("a corrupt state file fails closed: nothing saved, nothing promised, the file untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-reminder-"));
  try {
    const path = join(dir, "rhythm-state.json");
    const corrupt = JSON.stringify({ ...emptyRhythmState(), reminders: { version: 1, items: { bad: { id: "bad" } }, toolCalls: {} } });
    writeFileSync(path, corrupt);
    const { execute } = service({ store: createFileRhythmStateStore(path) });
    const created = await call(execute, { op: "create", text: "x", when: { day: "tomorrow" } });
    assert.equal(created.body.error.code, "unavailable");
    const listed = await call(execute, { op: "list" });
    assert.equal(listed.body.error.code, "unavailable");
    assert.equal(readFileSync(path, "utf8"), corrupt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("success is reported only after a fresh read shows the intended state (postcondition)", async () => {
  const inner = createMemoryRhythmStateStore();
  // A store whose writes silently do not stick: the executor must not report success.
  const lying: RhythmStateStore = { load: () => inner.load(), update: async (mutate) => mutate(await inner.load()) };
  const { execute } = service({ store: lying });
  const result = await call(execute, { op: "create", text: "x", when: { day: "tomorrow" } });
  assert.equal(result.isError, true);
  assert.equal(result.body.error.code, "not_verified");
  assert.equal(reminderConfirmationOf(result.content), null);
});
