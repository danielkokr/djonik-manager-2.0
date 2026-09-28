import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutboundMessage } from "./rhythmActions.js";
import { AUTONOMOUS_WRITE_NOTICE, createRhythmScheduler, type AutonomousTurnRequest, type AutonomousTurnResult, type RhythmTickDeps } from "./rhythmRunner.js";
import type { CardFact, SignalFacts } from "./rhythmSignals.js";
import { emptyFocusLedger, type FocusLedger } from "./rhythmFocus.js";
import {
  createFileRhythmStateStore,
  createMemoryRhythmStateStore,
  emptyRhythmState,
  focusOf,
  recoverRhythmState,
  RhythmStateError,
  withFocus,
  type DeliveryRecord,
  type RhythmState,
} from "./rhythmState.js";
import type { WeeklyTimeReporter } from "./weeklyTime.js";

// #50 through the real scheduler tick: focus from facts with zero model calls, the timebox exception lifecycle, and
// the Friday exact relay. Injected clock, facts, turn and send; zero network, zero inference.

const WORK = "work_hours: 10:00-18:00";
const ENTERED = "2026-09-29T07:00:00.000Z"; // Tue 10:00 Kyiv

function sentRitual(key: string, kind: DeliveryRecord["kind"], at: string): DeliveryRecord {
  return { key, kind, status: "sent", attempts: 1, ref: "abcdef123456", sessionId: "s", createdAt: at, updatedAt: at, sentAt: at, actions: [] };
}

/** Tuesday with the morning ritual already delivered at 09:30 Kyiv. */
function tuesdayState(focus?: FocusLedger): RhythmState {
  const base: RhythmState = { ...emptyRhythmState(), deliveries: { "morning:2026-09-29": sentRitual("morning:2026-09-29", "morning", "2026-09-29T06:30:00.000Z") } };
  return focus ? withFocus(base, focus) : base;
}

const inProgress = (id: string, enteredListAt: string | null = ENTERED): CardFact =>
  ({ id, name: `Картка ${id}`, project: "azov", list: "in_progress", due: null, dueComplete: false, enteredListAt, reopenedFromDoneAt: null });

function budgeted(minutes = 120): FocusLedger {
  return { ...emptyFocusLedger(), active: { a: { cardId: "a", project: "azov", enteredAt: ENTERED, observedAt: ENTERED } },
    budgets: { a: { cardId: "a", enteredAt: ENTERED, minutes, setAt: ENTERED, toolUseId: "toolu_1" } } };
}

function harness(options: { now: string; config?: string; state?: RhythmState; facts?: SignalFacts; reply?: (r: AutonomousTurnRequest) => Omit<AutonomousTurnResult, "sessionId">; weeklyTime?: WeeklyTimeReporter }) {
  let now = new Date(options.now);
  const store = createMemoryRhythmStateStore(options.state ?? emptyRhythmState());
  const turns: AutonomousTurnRequest[] = [];
  const sends: OutboundMessage[] = [];
  let collections = 0;
  const deps: RhythmTickDeps = {
    activation: { enabled: true, reason: "test" },
    readOnlyBoundary: ["pre", "execution"].join("_") as RhythmTickDeps["readOnlyBoundary"],
    now: () => now,
    configSource: { read: async () => options.config ?? WORK },
    store,
    runTurn: async (request) => {
      turns.push(request);
      return { sessionId: "s", ...(options.reply ? options.reply(request) : { reply: "SILENT", toolUses: [] }) };
    },
    send: async (message) => {
      sends.push(message);
      return { status: "sent", messageId: 500 + sends.length };
    },
    factsIntervalMs: 0,
    collectFacts: async () => {
      collections += 1;
      return options.facts ?? { cards: [], projects: [], followUps: [] };
    },
    ...(options.weeklyTime ? { weeklyTime: options.weeklyTime } : {}),
  };
  return { deps, store, turns, sends, setNow: (iso: string) => (now = new Date(iso)), collections: () => collections };
}

test("focus is tracked from each fact collection with zero model calls; no budget → no timer", async () => {
  const h = harness({ now: "2026-09-29T08:00:00Z", state: tuesdayState(), facts: { cards: [inProgress("a"), inProgress("b", "2026-09-29T07:30:00.000Z")], projects: [], followUps: [] } });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  h.setNow("2026-09-30T14:00:00Z"); // long after any plausible duration: still nothing without an explicit budget
  await scheduler.tick();
  assert.equal(h.turns.length, 0, "zero model calls");
  const focus = focusOf(h.store.snapshot());
  assert.deepEqual(Object.keys(focus.active).sort(), ["a", "b"]);
  assert.equal(h.collections(), 2);
  assert.ok(!Object.keys(h.store.snapshot().signals).some((key) => key.startsWith("timebox:")));
});

test("an elapsed explicit budget raises one exception turn; SILENT is final — no repeat on later ticks", async () => {
  const h = harness({ now: "2026-09-29T09:05:00Z", state: tuesdayState(budgeted()), facts: { cards: [inProgress("a")], projects: [], followUps: [] } });
  const scheduler = createRhythmScheduler(h.deps);
  const report = await scheduler.tick();
  assert.equal(h.turns.length, 1);
  assert.equal(h.turns[0].origin, "rhythm_exception");
  assert.match(h.turns[0].prompt, /чи варто Daniel зараз змінити, що він робить/);
  assert.match(h.turns[0].prompt, /Бюджет сам по собі не означає «зупинись»/);
  assert.match(h.turns[0].prompt, /Спершу свіжий trello_board_snapshot і записані обіцянки/);
  assert.match(h.turns[0].prompt, /бюджет Daniel 2 год робочого часу вичерпано вт 29\.09, 12:00 \(рахую з вт 29\.09, 10:00\) \[timebox:a@/);
  assert.equal(report.delivery?.status, "silent");
  assert.equal(h.sends.length, 0);
  assert.equal(h.store.snapshot().signals["timebox:a"].status, "evaluated");
  for (const at of ["2026-09-29T09:30:00Z", "2026-09-29T12:00:00Z"]) {
    h.setNow(at);
    await scheduler.tick();
  }
  assert.equal(h.turns.length, 1, "the same elapsed stint is never judged twice");
});

test("change-of-action case: a written reply is delivered once as an exception with its buttons; duplicate ticks send nothing", async () => {
  const h = harness({
    now: "2026-09-29T09:05:00Z", state: tuesdayState(budgeted()), facts: { cards: [inProgress("a")], projects: [], followUps: [] },
    reply: () => ({ reply: "⏱ 2 години на банер минули. Deck Cossack Labs обіцяний на завтра — я б перемкнувся.\nПеремикаємось?", toolUses: [{ kind: "custom", name: "trello_board_snapshot", readOnly: true }] }),
  });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(h.sends.length, 1);
  assert.deepEqual(h.sends[0].actions, ["raise", "later", "suppress"]);
  assert.equal(h.store.snapshot().signals["timebox:a"].status, "notified");
});

test("before the budget elapses in working time nothing happens; the evening and quiet hours never fire it", async () => {
  const early = harness({ now: "2026-09-29T08:55:00Z", state: tuesdayState(budgeted()), facts: { cards: [inProgress("a")], projects: [], followUps: [] } });
  await createRhythmScheduler(early.deps).tick();
  assert.equal(early.turns.length, 0);
  // Work hours reach into quiet time: the budget elapses 20:30 Kyiv (quiet from 20:00) → deferred, no model call.
  const late = harness({ now: "2026-09-29T17:30:00Z", config: "work_hours: 10:00-22:00", state: tuesdayState(budgeted(630)), facts: { cards: [inProgress("a")], projects: [], followUps: [] } });
  const report = await createRhythmScheduler(late.deps).tick();
  assert.equal(late.turns.length, 0);
  assert.equal(report.exceptionDecision ?? "", "", "no exception window during quiet hours");
});

test("caps and spacing apply unchanged: an exception already sent today leaves no room for a medium timebox", async () => {
  const state = tuesdayState(budgeted());
  state.deliveries["exception:2026-09-29:abc"] = { ...sentRitual("exception:2026-09-29:abc", "exception", "2026-09-29T08:30:00.000Z"), severity: "medium" };
  const h = harness({ now: "2026-09-29T09:05:00Z", state, facts: { cards: [inProgress("a")], projects: [], followUps: [] } });
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length, 0);
  assert.equal(report.exceptionDecision, "none:preferred_cap_reached");
});

test("a mute on the timebox is respected", async () => {
  const h = harness({ now: "2026-09-29T09:05:00Z", config: `${WORK}\nmute: kind:timebox_elapsed`, state: tuesdayState(budgeted()), facts: { cards: [inProgress("a")], projects: [], followUps: [] } });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length, 0);
});

test("a timebox is not deferred to a ritual hours away (Friday review), unlike ordinary medium facts", async () => {
  // Fri 02.10, 12:05 Kyiv; the review is at 16:30. Friday morning already sent.
  const entered = "2026-10-02T07:00:00.000Z";
  const focus: FocusLedger = { ...emptyFocusLedger(), active: { a: { cardId: "a", project: "azov", enteredAt: entered, observedAt: entered } },
    budgets: { a: { cardId: "a", enteredAt: entered, minutes: 120, setAt: entered, toolUseId: "t" } } };
  const state = withFocus({ ...emptyRhythmState(), deliveries: { "friday-morning:2026-10-02": sentRitual("friday-morning:2026-10-02", "friday-morning", "2026-10-02T06:30:00.000Z") } }, focus);
  const h = harness({ now: "2026-10-02T09:05:00Z", state, facts: { cards: [inProgress("a", entered)], projects: [], followUps: [] } });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length, 1);
});

test("an autonomous turn that tries to set a focus budget is blocked like any other write", async () => {
  const h = harness({ now: "2026-09-29T09:05:00Z", state: tuesdayState(budgeted()), facts: { cards: [inProgress("a")], projects: [], followUps: [] },
    reply: () => ({ reply: "Поставив новий таймер.", toolUses: [{ kind: "custom", name: "focus_budget" }] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends[0].text, AUTONOMOUS_WRITE_NOTICE);
});

// --- Friday review exact relay ---------------------------------------------------------------------------------------

const FRIDAY_REVIEW = "2026-10-02T13:30:00Z"; // 16:30 Kyiv
const HISTORY = "Цього тижня на дошці:\n\n- **Перейшло в Done:** 2 — «А» та «Б»";
const BLOCK = "⏱ Час по проєктах ≈ за переміщеннями в Trello (робочі години 10:00–18:00):\nAzov — 14 год\nExtract — 10 год";
const fridayState = (): RhythmState => ({ ...emptyRhythmState(), deliveries: { "friday-morning:2026-10-02": sentRitual("friday-morning:2026-10-02", "friday-morning", "2026-10-02T06:30:00.000Z") } });

test("Friday review: work-history facts → deterministic time block → Claude's commentary; Claude cannot alter the totals", async () => {
  const commentary = "⏸ Не рухалось: сайт Limen.\n💭 Azov — 20 год, це забагато.";
  const h = harness({
    now: FRIDAY_REVIEW, state: fridayState(),
    weeklyTime: async () => ({ status: "ok", block: BLOCK, allocation: { totals: [], countedMs: 0, unionMs: 0, parallelMs: 0, cappedDays: 0, rough: false } }),
    reply: () => ({ reply: `${HISTORY}\n\n---\nPM-висновок:\n${commentary}`, workHistoryAnswerText: HISTORY, toolUses: [{ kind: "custom", name: "trello_work_history" }] }),
  });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns[0].origin, "rhythm_ritual");
  assert.ok(h.turns[0].prompt.includes(BLOCK), "the model sees the block to comment on");
  assert.match(h.turns[0].prompt, /Не повторюй, не перераховуй, не округлюй і не переказуй ці години/);
  assert.equal(h.sends[0].text, `${HISTORY}\n\n${BLOCK}\n\n---\nPM-висновок:\n${commentary}`);
  assert.ok(h.sends[0].text.indexOf("Azov — 14 год") < h.sends[0].text.indexOf("Azov — 20 год"), "the code block always precedes model text");
  assert.deepEqual(h.sends[0].actions, ["carry_over", "modify", "not_now"]);
});

test("Friday review: an unavailable report is said honestly by code; no reporter → unavailable, never estimated", async () => {
  const h = harness({ now: FRIDAY_REVIEW, state: fridayState(), reply: () => ({ reply: "⏸ …", toolUses: [] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.match(h.turns[0].prompt, /Якщо блок каже «недоступний» — не оцінюй години сам/);
  assert.equal(h.sends[0].text, "⏱ Час по проєктах: недоступний — історія Trello зараз недоступна. Годин не оцінюю.\n\n⏸ …");
  const thrower = harness({ now: FRIDAY_REVIEW, state: fridayState(), weeklyTime: async () => { throw new Error("boom"); }, reply: () => ({ reply: "⏸ …", toolUses: [] }) });
  await createRhythmScheduler(thrower.deps).tick();
  assert.match(thrower.sends[0].text, /^⏱ Час по проєктах: недоступний/);
});

test("Friday review: a blocked autonomous write sends only the fixed notice (no time block, no model text)", async () => {
  const h = harness({ now: FRIDAY_REVIEW, state: fridayState(), weeklyTime: async () => ({ status: "ok", block: BLOCK, allocation: { totals: [], countedMs: 0, unionMs: 0, parallelMs: 0, cappedDays: 0, rough: false } }),
    reply: () => ({ reply: "Переніс картки.", toolUses: [{ kind: "mcp", name: "trelloWriteCard" }] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends[0].text, AUTONOMOUS_WRITE_NOTICE);
});

test("other rituals carry no time block", async () => {
  const h = harness({ now: "2026-09-29T06:35:00Z", weeklyTime: async () => { throw new Error("must not be called"); }, reply: () => ({ reply: "🎯 Головне: банер.", toolUses: [] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends[0].text, "🎯 Головне: банер.");
  assert.doesNotMatch(h.turns[0].prompt, /Блок часу/);
});

// --- State: restart and rollback compatibility ------------------------------------------------------------------------

test("focus survives a restart through the file store; a rhythm-only state stays byte-free of `focus`", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-focus-"));
  const path = join(dir, "rhythm-state.json");
  const store = createFileRhythmStateStore(path);
  await store.update((state) => withFocus(state, emptyFocusLedger()));
  assert.equal("focus" in (await store.load()), false, "an empty ledger is never written");
  await store.update((state) => withFocus(state, budgeted()));
  const reloaded = await createFileRhythmStateStore(path).load();
  assert.deepEqual(focusOf(reloaded), budgeted());
  // Restart recovery keeps focus and unrelated reminders/deliveries untouched.
  assert.deepEqual(focusOf(recoverRhythmState(reloaded, new Date("2026-09-29T08:00:00Z"))), budgeted());
});

test("rollback: the pre-#50 state shape loads unchanged, and an unknown future field survives every writer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-rollback-"));
  const path = join(dir, "rhythm-state.json");
  const legacy = { version: 1, deliveries: {}, signals: {}, reminders: { version: 1, items: {}, toolCalls: {} } };
  writeFileSync(path, `${JSON.stringify(legacy)}\n`);
  const store = createFileRhythmStateStore(path);
  assert.deepEqual(await store.load(), legacy);
  // A state written by #50 as an OLDER revision would see it: its writers spread the state they loaded.
  writeFileSync(path, `${JSON.stringify({ ...legacy, focus: budgeted(), futureField: { x: 1 } })}\n`);
  await store.update((state) => recoverRhythmState(state, new Date("2026-09-29T08:00:00Z")));
  await store.update((state) => ({ ...state, deliveries: { ...state.deliveries } }));
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(after.focus, budgeted());
  assert.deepEqual(after.futureField, { x: 1 });
});

test("a malformed focus field makes the state unreadable (fail closed: nothing is sent)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-bad-"));
  const path = join(dir, "rhythm-state.json");
  writeFileSync(path, `${JSON.stringify({ version: 1, deliveries: {}, signals: {}, focus: { version: 1, active: [], ended: [], budgets: {}, toolCalls: {} } })}\n`);
  await assert.rejects(createFileRhythmStateStore(path).load(), RhythmStateError);
});
