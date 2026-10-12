import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import type { OutboundMessage } from "./rhythmActions.js";
import { createRhythmFactCollector, RhythmFactsUnavailableError, type RhythmTrelloReader } from "./rhythmFacts.js";
import {
  createRhythmScheduler,
  FRESH_BOARD_REQUIRED,
  FRESH_FACTS_RETRY_MINUTES,
  freshFactsNotice,
  freshFactsNoticeKey,
  type AutonomousTurnRequest,
  type RhythmTickDeps,
  type SendOutcome,
} from "./rhythmRunner.js";
import { startWorkingRhythm, type IntervalTimers } from "./rhythmRuntime.js";
import type { SignalFacts } from "./rhythmSignals.js";
import {
  createFileRhythmStateStore,
  createMemoryRhythmStateStore,
  emptyRhythmState,
  recoverRhythmState,
  remindersOf,
  RhythmStateError,
  type RhythmState,
  type RhythmStateStore,
} from "./rhythmState.js";
import { createReminderToolExecutor } from "./reminderTool.js";

// #71 — a ritual never runs on stale context: when the fresh Trello read fails the scheduler makes no model turn,
// sends one short notice, re-arms the occurrence for a later fresh attempt and gives up after a fixed number of
// them. Injected clock, facts, model turn and Telegram send. Zero network, zero inference.

/** Kyiv wall-clock (EEST, UTC+3 until 25.10.2026) → instant. */
const kyiv = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);
const MONDAY = "2026-09-28";
const PLAN_KEY = `monday-plan:${MONDAY}`;
const NOTICE_KEY = freshFactsNoticeKey(PLAN_KEY);
const EMPTY_FACTS: SignalFacts = { cards: [], projects: [], followUps: [] };
const PLAN_REPLY = "📅 Тиждень: головне — концепт Seqthera.\n\nПриймаєш?";

const unavailable = () => new RhythmFactsUnavailableError({ stage: "open_cards", reason: "http_5xx", status: 503, retryable: true }, 3);

interface Harness {
  deps: RhythmTickDeps;
  store: ReturnType<typeof createMemoryRhythmStateStore>;
  turns: AutonomousTurnRequest[];
  sends: OutboundMessage[];
  lines: string[];
  factReads: number;
  /** Whether the next fact collection fails. */
  trelloDown: boolean;
  tick(at: Date): ReturnType<ReturnType<typeof createRhythmScheduler>["tick"]>;
}

/** A new scheduler instance on every tick: whatever survives between ticks survives in the state store only. */
function harness(options: { state?: RhythmState; send?: (index: number) => SendOutcome; failure?: () => unknown } = {}): Harness {
  let now = kyiv(MONDAY, "09:30");
  const store = createMemoryRhythmStateStore(options.state ?? emptyRhythmState());
  let messageId = 100;
  const h: Harness = {
    store,
    turns: [],
    sends: [],
    lines: [],
    factReads: 0,
    trelloDown: true,
    deps: undefined as unknown as RhythmTickDeps,
    tick: (at) => {
      now = at;
      return createRhythmScheduler(h.deps).tick();
    },
  };
  h.deps = {
    activation: { enabled: true, reason: "test" },
    readOnlyBoundary: "pre_execution",
    now: () => now,
    configSource: { read: async () => null },
    store,
    runTurn: async (request) => {
      h.turns.push(request);
      return { reply: PLAN_REPLY, sessionId: "sesn_serving", toolUses: [] };
    },
    send: async (message) => {
      h.sends.push(message);
      return options.send ? options.send(h.sends.length - 1) : { status: "sent", messageId: (messageId += 1) };
    },
    collectFacts: async () => {
      h.factReads += 1;
      if (h.trelloDown) throw (options.failure ?? unavailable)();
      return EMPTY_FACTS;
    },
    log: (line) => h.lines.push(line),
  };
  return h;
}

/** Every minute from `from` to `to` inclusive (same Kyiv day). */
async function tickEveryMinute(h: Harness, date: string, from: string, to: string): Promise<void> {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  for (let at = minutes(from); at <= minutes(to); at += 1) {
    await h.tick(kyiv(date, `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`));
  }
}

// --- D: fail closed ----------------------------------------------------------------------------------------

test("#71 D: Monday plan without fresh board facts → no model turn, no pseudo-plan, one short notice without buttons", async () => {
  const h = harness();
  const report = await h.tick(kyiv(MONDAY, "09:30"));
  assert.equal(report.freshFacts, "deferred");
  assert.equal(report.modelCalls, 0);
  assert.equal(h.turns.length, 0, "Claude gets no planning turn to fill from Memory or the Session");
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].text, freshFactsNotice("monday-plan"));
  assert.equal(
    h.sends[0].text,
    "⚠️ Не можу зараз зібрати нормальний план тижня: Trello не віддав свіжий стан дошки. Не хочу спиратися на старі дані — спробую ще раз трохи пізніше.",
  );
  assert.deepEqual(h.sends[0].actions, [], "nothing to accept");
  assert.equal(h.sends[0].keyboard, undefined);
  assert.doesNotMatch(h.sends[0].text, /Прийма|503|http|stage=|Memory|порожн|немає задач/i);
  const state = h.store.snapshot();
  assert.equal(state.deliveries[PLAN_KEY], undefined, "the ritual occurrence is not consumed");
  assert.equal(state.deliveries[NOTICE_KEY].status, "sent");
  assert.deepEqual(state.deferredRituals?.[PLAN_KEY], {
    failures: 1,
    firstFailedAt: kyiv(MONDAY, "09:30").toISOString(),
    nextAttemptAt: kyiv(MONDAY, "09:37").toISOString(),
  });
  assert.ok(h.lines.includes("[rhythm] facts_unavailable stage=open_cards reason=http_5xx status=503 retryable=true attempts=3"));
  assert.ok(h.lines.includes(`[rhythm] ${PLAN_KEY} fresh_facts_deferred failures=1 retry_in_min=7`));
});

test("#71: every ritual kind is a current-state artifact and fails closed; each gets its own wording", async () => {
  assert.deepEqual(Object.keys(FRESH_BOARD_REQUIRED).sort(), ["evening", "friday-morning", "friday-review", "monday-plan", "morning"]);
  assert.ok(Object.values(FRESH_BOARD_REQUIRED).every(Boolean));
  for (const [date, time, kind, subject] of [
    ["2026-09-29", "09:30", "morning", "ранковий бриф"],
    ["2026-10-02", "09:30", "friday-morning", "ранковий бриф"],
    ["2026-10-02", "16:30", "friday-review", "огляд тижня"],
  ] as const) {
    const h = harness();
    const report = await h.tick(kyiv(date, time));
    assert.equal(report.freshFacts, "deferred", kind);
    assert.equal(h.turns.length, 0, kind);
    assert.equal(h.sends.length, 1, kind);
    assert.ok(h.sends[0].text.includes(`нормальний ${subject}:`), kind);
    assert.deepEqual(h.sends[0].actions, []);
    assert.equal(h.store.snapshot().deliveries[`${kind}:${date}`], undefined);
  }
  assert.match(freshFactsNotice("evening"), /вечірній підсумок/);
});

test("#71: a failure that is not a classified Trello failure fails closed the same way", async () => {
  const h = harness({ failure: () => new Error("boom with oauth_token=secret-token") });
  await h.tick(kyiv(MONDAY, "09:30"));
  assert.equal(h.turns.length, 0);
  assert.equal(h.sends[0].text, freshFactsNotice("monday-plan"));
  assert.ok(h.lines.includes("[rhythm] facts_unavailable reason=unknown"));
  assert.doesNotMatch(h.lines.join("\n"), /secret-token|boom/);
});

// --- E: deferred retry ----------------------------------------------------------------------------------------

test("#71 E: the re-arm is persisted; while waiting nothing is read or sent; a later fresh read sends the real plan exactly once", async () => {
  const h = harness();
  await h.tick(kyiv(MONDAY, "09:30"));
  // Trello is back at once, but the occurrence waits for its scheduled attempt: no read, no turn, no message.
  h.trelloDown = false;
  for (const time of ["09:31", "09:33", "09:36"]) {
    const waiting = await h.tick(kyiv(MONDAY, time));
    assert.deepEqual([waiting.status, waiting.freshFacts, waiting.modelCalls, waiting.sends], ["ran", "waiting", 0, 0], time);
  }
  assert.equal(h.factReads, 1);
  assert.equal(h.sends.length, 1);

  const report = await h.tick(kyiv(MONDAY, "09:37"));
  assert.equal(h.factReads, 2, "a NEW Trello read, never the failed one");
  assert.deepEqual(report.delivery, { key: PLAN_KEY, kind: "monday-plan", status: "sent" });
  assert.equal(h.turns.length, 1);
  assert.match(h.turns[0].prompt, /^\[Робочий ритм · автоматичний хід · план тижня/);
  assert.equal(h.sends.length, 2);
  assert.equal(h.sends[1].text, PLAN_REPLY);
  assert.deepEqual(h.sends[1].actions, ["accept_plan", "modify", "details"]);
  const state = h.store.snapshot();
  assert.equal(state.deliveries[PLAN_KEY].status, "sent");
  assert.equal("deferredRituals" in state, false, "the deferral is gone once the ritual is sent");
  assert.ok(h.lines.includes(`[rhythm] ${PLAN_KEY} fresh_facts_recovered`));

  await tickEveryMinute(h, MONDAY, "09:38", "12:10");
  assert.equal(h.turns.length, 1, "the plan is never composed twice");
  assert.equal(h.sends.length, 2);
});

test("#71 E: a deferral survives a restart through the state file and resumes with a fresh read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-71-"));
  try {
    const path = join(dir, "rhythm-state.json");
    const first = harness();
    first.deps.store = createFileRhythmStateStore(path);
    await first.tick(kyiv(MONDAY, "09:30"));
    // A new process: new store instance, new scheduler, startup recovery.
    const second = harness();
    const store = createFileRhythmStateStore(path);
    await store.update((current) => recoverRhythmState(current, kyiv(MONDAY, "09:34")));
    second.deps.store = store;
    second.trelloDown = false;
    assert.equal((await second.tick(kyiv(MONDAY, "09:35"))).freshFacts, "waiting");
    await second.tick(kyiv(MONDAY, "09:37"));
    assert.equal(second.turns.length, 1);
    assert.deepEqual(second.sends.map((message) => message.text), [PLAN_REPLY], "the notice is not repeated after the restart");
    assert.equal((await store.load()).deliveries[NOTICE_KEY].status, "sent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- F: repeated failure stays bounded ---------------------------------------------------------------------

test("#71 F: Trello down all morning → one notice, four fresh attempts, then the occurrence is closed; no per-tick spam", async () => {
  const h = harness();
  await tickEveryMinute(h, MONDAY, "09:30", "10:22");
  assert.deepEqual(FRESH_FACTS_RETRY_MINUTES, [7, 15, 30]);
  assert.equal(h.factReads, 4, "09:30, 09:37, 09:52, 10:22 — and no read in between");
  assert.equal(h.turns.length, 0);
  assert.deepEqual(h.sends.map((message) => message.text), [freshFactsNotice("monday-plan")], "exactly one degraded notice");
  assert.deepEqual(
    h.lines.filter((line) => line.includes("fresh_facts_")),
    [
      `[rhythm] ${PLAN_KEY} fresh_facts_deferred failures=1 retry_in_min=7`,
      `[rhythm] ${PLAN_KEY} fresh_facts_deferred failures=2 retry_in_min=15`,
      `[rhythm] ${PLAN_KEY} fresh_facts_deferred failures=3 retry_in_min=30`,
      `[rhythm] ${PLAN_KEY} fresh_facts_gave_up failures=4`,
    ],
  );
  const state = h.store.snapshot();
  assert.deepEqual(
    [state.deliveries[PLAN_KEY].status, state.deliveries[PLAN_KEY].failure, state.deliveries[PLAN_KEY].retryable],
    ["failed", "fresh_facts_unavailable", false],
  );
  assert.equal("deferredRituals" in state, false);

  // Even with Trello back the closed occurrence is not reopened: no late plan, no second notice.
  h.trelloDown = false;
  await tickEveryMinute(h, MONDAY, "10:23", "12:30");
  assert.equal(h.turns.length, 0);
  assert.equal(h.sends.length, 1);
});

test("#71 F: a notice whose send outcome is unknown is never repeated; a definite refusal is retried once, then silence", async () => {
  const ambiguous = harness({ send: () => ({ status: "unknown", reason: "timeout" }) });
  await tickEveryMinute(ambiguous, MONDAY, "09:30", "10:30");
  assert.equal(ambiguous.sends.length, 1, "it may be on screen");
  assert.equal(ambiguous.store.snapshot().deliveries[NOTICE_KEY].status, "ambiguous");

  const refused = harness({ send: () => ({ status: "rejected", reason: "chat_not_found" }) });
  await tickEveryMinute(refused, MONDAY, "09:30", "10:30");
  assert.equal(refused.sends.length, 2, "bounded by the ordinary two delivery attempts");
  assert.equal(refused.turns.length, 0);
});

test("#71 F: a ritual that expires while deferred is simply over; its stale deferral is pruned", async () => {
  const h = harness();
  await h.tick(kyiv("2026-10-02", "18:25")); // Friday review (16:30), five minutes before its grace window ends
  assert.equal(h.sends.length, 1);
  h.trelloDown = false;
  await tickEveryMinute(h, "2026-10-02", "18:26", "19:30"); // expired at 18:30, before the 18:32 attempt
  assert.equal(h.turns.length, 0, "never sent late");
  assert.equal(h.sends.length, 1);
  assert.equal(h.store.snapshot().deliveries["friday-review:2026-10-02"], undefined);
  // Monday's failure drops Friday's leftover in the same write; startup recovery drops any day-old one.
  const withLeftover: RhythmState = { ...emptyRhythmState(), deferredRituals: { "friday-review:2026-10-02": { failures: 1, firstFailedAt: kyiv("2026-10-02", "16:30").toISOString(), nextAttemptAt: kyiv("2026-10-02", "16:37").toISOString() } } };
  const next = harness({ state: withLeftover });
  await next.tick(kyiv("2026-10-05", "09:30"));
  assert.deepEqual(Object.keys(next.store.snapshot().deferredRituals ?? {}), ["monday-plan:2026-10-05"]);
  assert.equal("deferredRituals" in recoverRhythmState(withLeftover, kyiv("2026-10-05", "09:00")), false);
});

// --- Exceptions and partial evidence -------------------------------------------------------------------------

test("#71: an exception-only collection that fails stays silent — no notice, no deferral, no turn, no signal", async () => {
  const h = harness();
  const report = await h.tick(kyiv("2026-09-29", "14:00")); // Tuesday afternoon, no ritual due
  assert.deepEqual([report.status, report.modelCalls, report.sends, report.freshFacts, report.exceptionDecision], ["ran", 0, 0, undefined, undefined]);
  assert.equal(h.turns.length + h.sends.length, 0);
  assert.deepEqual(h.store.snapshot(), emptyRhythmState());
});

test("#71: partial evidence still proceeds — board, cards and lists fresh, history unreadable → the ritual runs", async () => {
  const reader: RhythmTrelloReader = {
    resolveSingleBoard: async () => ({ id: "b1", name: "Djonik" }),
    readOpenCards: async () => [],
    readLists: async () => [{ id: "l1", name: "This week" }],
    readActions: async () => {
      throw new Error("history down");
    },
    readLatestListEntry: async () => null,
  };
  const h = harness();
  h.deps.collectFacts = createRhythmFactCollector({ reader, log: (line) => h.lines.push(line) });
  const report = await h.tick(kyiv(MONDAY, "09:30"));
  assert.deepEqual(report.delivery, { key: PLAN_KEY, kind: "monday-plan", status: "sent" });
  assert.equal(report.freshFacts, undefined);
  assert.equal(h.turns.length, 1);
  assert.ok(h.lines.includes("[rhythm] history_unavailable"));
});

// --- No fact collector at all -----------------------------------------------------------------------------

test("#71 invariant: a Monday ritual in a scheduler with NO fact collector cannot invoke the model — same notice, same bounded deferral", async () => {
  const h = harness();
  delete h.deps.collectFacts;
  const report = await h.tick(kyiv(MONDAY, "09:30"));
  assert.deepEqual([report.freshFacts, report.modelCalls, report.sends], ["deferred", 0, 1]);
  assert.equal(h.turns.length, 0);
  assert.deepEqual(h.sends.map((message) => [message.text, message.actions]), [[freshFactsNotice("monday-plan"), []]]);
  assert.equal(h.store.snapshot().deliveries[PLAN_KEY], undefined);
  assert.ok(h.lines.includes("[rhythm] facts_unavailable stage=reader reason=reader_unavailable retryable=false attempts=0"));

  // Bounded and quiet: three later looks at +7 / +22 / +52 min (no network — there is no reader), then closed.
  await tickEveryMinute(h, MONDAY, "09:31", "12:30");
  assert.equal(h.turns.length, 0, "never a model turn, however long it lasts");
  assert.equal(h.sends.length, 1, "one notice only");
  assert.equal(h.factReads, 0);
  assert.equal(h.lines.filter((line) => line.includes("reason=reader_unavailable")).length, 4);
  assert.equal(h.lines.filter((line) => line.includes("fresh_facts_deferred")).length, 3);
  assert.ok(h.lines.includes(`[rhythm] ${PLAN_KEY} fresh_facts_gave_up failures=4`));
  const state = h.store.snapshot();
  assert.deepEqual([state.deliveries[PLAN_KEY].status, state.deliveries[PLAN_KEY].failure], ["failed", "fresh_facts_unavailable"]);
  assert.equal("deferredRituals" in state, false);
});

test("#71 invariant: with no fact collector and no ritual due, nothing happens at all (exceptions stay off)", async () => {
  const h = harness();
  delete h.deps.collectFacts;
  const report = await h.tick(kyiv("2026-09-29", "14:00"));
  assert.deepEqual([report.status, report.modelCalls, report.sends, report.freshFacts, report.exceptionDecision], ["ran", 0, 0, undefined, undefined]);
  assert.equal(h.lines.length, 0);
  assert.deepEqual(h.store.snapshot(), emptyRhythmState());
});

test("#71 invariant: the serving wiring without Trello read credentials fails closed too, and says so once at startup", async () => {
  const trello = { down: false, reads: 0 };
  const w = world(trello, { withoutCollector: true });
  assert.deepEqual(w.lines.filter((line) => line.includes("fact_reader")), ["[rhythm] fact_reader_unavailable rituals_fail_closed"]);
  await w.remind("виділити день на Limen");
  await w.span("09:30", "12:30");
  assert.equal(w.turns.length, 0);
  assert.deepEqual(w.sends.map((message) => message.text), [freshFactsNotice("monday-plan"), REMINDER_LINE], "the reminder still arrives, by code");
  assert.equal(trello.reads, 0);
});

// --- State ----------------------------------------------------------------------------------------------------

test("#71 state: deferrals are validated on load (malformed → unreadable, nothing is sent); an old state has no such field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-71-"));
  try {
    const path = join(dir, "rhythm-state.json");
    writeFileSync(path, JSON.stringify({ ...emptyRhythmState(), deferredRituals: { [PLAN_KEY]: { failures: 0, firstFailedAt: "x", nextAttemptAt: "y" } } }));
    await assert.rejects(() => createFileRhythmStateStore(path).load(), RhythmStateError);
    writeFileSync(path, JSON.stringify(emptyRhythmState()));
    const h = harness();
    h.trelloDown = false;
    h.deps.store = createFileRhythmStateStore(path);
    await h.tick(kyiv(MONDAY, "09:30"));
    assert.equal("deferredRituals" in (await h.deps.store.load()), false, "a rhythm that never failed never writes the field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- G: a reminder riding the ritual -------------------------------------------------------------------------

const USER = 4242;
const idleTimers: IntervalTimers = { setInterval: () => ({}), clearInterval: () => {} };

/** The real runtime: one timer, the rhythm tick first, then the reminder tick (as in production wiring). */
function world(trello: { down: boolean; reads: number }, options: { withoutCollector?: boolean } = {}) {
  let now = kyiv("2026-09-26", "12:00");
  const store: RhythmStateStore = createMemoryRhythmStateStore();
  const sends: OutboundMessage[] = [];
  const turns: AutonomousTurnRequest[] = [];
  const lines: string[] = [];
  let messageId = 500;
  const runtime = startWorkingRhythm({
    env: { STATE_DIRECTORY: "/var/lib/djonik", DJONIK_WORKING_RHYTHM: "on" },
    readOnlyBoundary: "pre_execution",
    allowedUserId: String(USER),
    createConfigSource: () => ({ read: async () => null }),
    createStateStore: () => store,
    ...(options.withoutCollector
      ? {}
      : {
          createFactCollector: () => async () => {
            trello.reads += 1;
            if (trello.down) throw unavailable();
            return EMPTY_FACTS;
          },
        }),
    log: (line) => lines.push(line),
    runTurn: async (request) => {
      turns.push(request);
      return { reply: PLAN_REPLY, sessionId: "sesn_serving", toolUses: [] };
    },
    send: async (message) => {
      sends.push(message);
      return { status: "sent", messageId: (messageId += 1) };
    },
    currentSessionId: () => "sesn_serving",
    answer: async () => undefined,
    enqueueUserText: () => {},
    now: () => now,
    timers: idleTimers,
    reminders: { enabled: true },
  });
  const execute = createReminderToolExecutor({ store, now: () => now, readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => runtime.status === "running" });
  return {
    sends,
    turns,
    lines,
    async remind(text: string) {
      const result = await execute({ op: "create", text, when: { day: "weekday", weekday: "mon" } }, { toolUseId: "sevt_1", authority: "human" });
      assert.equal(result.isError, false, result.content);
    },
    async tick(time: string) {
      now = kyiv(MONDAY, time);
      await runtime.tickNow!();
    },
    async span(from: string, to: string) {
      const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      for (let at = minutes(from); at <= minutes(to); at += 1) await this.tick(`${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
    },
    reminder: async () => Object.values(remindersOf(await store.load()).items)[0],
  };
}

const REMINDER_LINE = "🔔 Ти просив нагадати: виділити день на Limen";

test("#71 G: Trello fails on a reminder-carrying ritual → the reminder is not claimed, not sent with the notice, and rides the later plan once", async () => {
  const trello = { down: true, reads: 0 };
  const w = world(trello);
  await w.remind("виділити день на Limen");
  await w.tick("09:30");
  assert.equal(w.turns.length, 0);
  assert.deepEqual(w.sends.map((message) => message.text), [freshFactsNotice("monday-plan")], "the notice carries no reminder line");
  let reminder = await w.reminder();
  assert.deepEqual([reminder.status, reminder.ritualClaim, reminder.attempts, reminder.schedule.time], ["scheduled", undefined, 0, "09:30"], "untouched: not claimed, not delivered, not re-timed");

  trello.down = false;
  await w.span("09:31", "09:37");
  assert.equal(w.sends.length, 2);
  assert.equal(w.sends[1].text, `${REMINDER_LINE}\n\n${PLAN_REPLY}`);
  reminder = await w.reminder();
  assert.deepEqual([reminder.status, reminder.via, reminder.ritualKey], ["delivered", "ritual", PLAN_KEY]);

  await w.span("09:38", "11:00");
  assert.equal(w.sends.length, 2, "neither the plan nor the reminder is sent again");
  assert.equal(w.sends.filter((message) => message.text.includes(REMINDER_LINE)).length, 1);
});

test("#71 G: Trello stays down → the reminder goes out directly after its accepted 30-minute wait, and a late plan does not repeat it", async () => {
  const trello = { down: true, reads: 0 };
  const w = world(trello);
  await w.remind("виділити день на Limen");
  await w.span("09:30", "09:59");
  assert.deepEqual(w.sends.map((message) => message.text), [freshFactsNotice("monday-plan")], "still waiting for the ritual");
  await w.tick("10:00");
  assert.equal(w.sends.length, 2);
  assert.equal(w.sends[1].text, REMINDER_LINE, "delivered by code, on time for a date-only reminder, without any model turn");
  let reminder = await w.reminder();
  assert.deepEqual([reminder.status, reminder.via], ["delivered", "direct"]);

  // The last deferred attempt (10:22) finds Trello back: the plan is sent once, without the reminder it no longer holds.
  trello.down = false;
  await w.span("10:01", "11:30");
  assert.equal(w.turns.length, 1);
  assert.doesNotMatch(w.turns[0].prompt, /Нагадування, які Daniel просив/);
  assert.equal(w.sends.length, 3);
  assert.equal(w.sends[2].text, PLAN_REPLY);
  assert.equal(w.sends.filter((message) => message.text.includes(REMINDER_LINE)).length, 1, "exactly once");
  reminder = await w.reminder();
  assert.deepEqual([reminder.status, reminder.via, reminder.attempts], ["delivered", "direct", 1]);
});

test("#71 G: Trello never recovers → the plan is given up, the reminder was still delivered exactly once", async () => {
  const trello = { down: true, reads: 0 };
  const w = world(trello);
  await w.remind("виділити день на Limen");
  await w.span("09:30", "12:30");
  assert.equal(w.turns.length, 0);
  assert.deepEqual(w.sends.map((message) => message.text), [freshFactsNotice("monday-plan"), REMINDER_LINE]);
  assert.equal((await w.reminder()).status, "delivered");
});
