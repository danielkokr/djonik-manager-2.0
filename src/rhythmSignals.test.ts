import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRhythmConfig, type RhythmConfig } from "./rhythmConfig.js";
import {
  advanceSignalLedger,
  detectSignals,
  isMuted,
  markSignals,
  occurrenceHandle,
  ritualObservations,
  selectException,
  type CardFact,
  type ExceptionSelectionInput,
  type Signal,
  type SignalFacts,
  type SignalLedger,
} from "./rhythmSignals.js";

// #39 Working Rhythm — deterministic signals: detection is not permission to message. Most signals are
// ritual observations; only a narrow set are interrupt candidates, and even they pass every limit.

const defaults = parseRhythmConfig(null).config;
/** Tuesday 2026-09-29, 11:00 Kyiv (UTC+3). Next workday: Wednesday 2026-09-30. */
const NOW = new Date("2026-09-29T08:00:00Z");

function card(overrides: Partial<CardFact> & { id: string }): CardFact {
  return { name: `Card ${overrides.id}`, project: "extract", list: "todo", due: null, dueComplete: false, enteredListAt: null, reopenedFromDoneAt: null, ...overrides };
}

function facts(partial: Partial<SignalFacts>): SignalFacts {
  return { cards: [], projects: [], followUps: [], ...partial };
}

function only(signals: Signal[], kind: Signal["kind"]): Signal {
  const matching = signals.filter((s) => s.kind === kind);
  assert.equal(matching.length, 1, `expected exactly one ${kind}, got ${signals.map((s) => s.kind).join(",")}`);
  return matching[0];
}

test("due soon (≤ 2 workdays, not started) → ritual observation, not an interrupt", () => {
  const signal = only(detectSignals(facts({ cards: [card({ id: "b", due: "2026-10-01T15:00:00Z" })] }), NOW, defaults), "due_soon");
  assert.equal(signal.channel, "ritual");
  assert.equal(signal.key, "due-soon:b");
});

test("due soon ignores in-progress, Waiting, Done and completed dues", () => {
  const cards = [
    card({ id: "p", list: "in_progress", due: "2026-10-01T15:00:00Z" }),
    card({ id: "w", list: "waiting", due: "2026-10-01T15:00:00Z" }),
    card({ id: "d", list: "done", due: "2026-10-01T15:00:00Z" }),
    card({ id: "c", due: "2026-10-01T15:00:00Z", dueComplete: true }),
    card({ id: "far", due: "2026-10-09T15:00:00Z" }),
  ];
  assert.deepEqual(detectSignals(facts({ cards }), NOW, defaults), []);
});

test("a far-future due date is not due soon and is rejected cheaply", () => {
  const started = Date.now();
  assert.deepEqual(detectSignals(facts({ cards: [card({ id: "far", due: "9999-12-31T12:00:00Z" })] }), NOW, defaults), []);
  assert.ok(Date.now() - started < 200);
});

test("deadline tomorrow + not started → interrupt candidate; in progress → no signal", () => {
  const signal = only(detectSignals(facts({ cards: [card({ id: "a", due: "2026-09-30T15:00:00Z" })] }), NOW, defaults), "due_tomorrow_not_started");
  assert.equal(signal.channel, "interrupt");
  assert.equal(signal.severity, "medium");
  assert.deepEqual(detectSignals(facts({ cards: [card({ id: "a", list: "in_progress", due: "2026-09-30T15:00:00Z" })] }), NOW, defaults), []);
});

test("'tomorrow' means the next workday: on Friday a Monday due is tomorrow", () => {
  const friday = new Date("2026-10-02T08:00:00Z");
  const signal = only(detectSignals(facts({ cards: [card({ id: "m", due: "2026-10-05T12:00:00Z" })] }), friday, defaults), "due_tomorrow_not_started");
  assert.equal(signal.channel, "interrupt");
});

test("newly overdue meaningful item → high-severity interrupt candidate; older overdue → ritual only", () => {
  const newly = only(detectSignals(facts({ cards: [card({ id: "c", due: "2026-09-29T07:00:00Z" })] }), NOW, defaults), "newly_overdue");
  assert.equal(newly.channel, "interrupt");
  assert.equal(newly.severity, "high");
  assert.equal(newly.key, "overdue:c");
  const old = only(detectSignals(facts({ cards: [card({ id: "c", due: "2026-09-20T07:00:00Z" })] }), NOW, defaults), "overdue");
  assert.equal(old.channel, "ritual");
  assert.equal(old.key, newly.key, "same situation, same stable key");
});

test("an overdue card parked in Waiting is ritual material, not an interrupt (waiting ≠ blocked)", () => {
  const signal = only(detectSignals(facts({ cards: [card({ id: "f", list: "waiting", due: "2026-09-29T07:00:00Z" })] }), NOW, defaults), "overdue");
  assert.equal(signal.channel, "ritual");
});

test("Waiting ≥ 5 days → ritual observation; shorter → nothing; unknown entry time → nothing", () => {
  const long = only(detectSignals(facts({ cards: [card({ id: "e", list: "waiting", enteredListAt: "2026-09-22T09:00:00Z" })] }), NOW, defaults), "waiting_long");
  assert.equal(long.channel, "ritual");
  assert.match(long.fact, /waiting ≠ blocked/);
  assert.deepEqual(detectSignals(facts({ cards: [card({ id: "e", list: "waiting", enteredListAt: "2026-09-26T09:00:00Z" })] }), NOW, defaults), []);
  assert.deepEqual(detectSignals(facts({ cards: [card({ id: "e", list: "waiting" })] }), NOW, defaults), []);
});

test("stale priority project → ritual/review observation; low-priority projects are never flagged", () => {
  const projects = [
    { project: "limen", priority: "medium" as const, lastMovementAt: "2026-09-15T10:00:00Z" },
    { project: "old", priority: "low" as const, lastMovementAt: "2026-08-01T10:00:00Z" },
    { project: "cl", priority: "high" as const, lastMovementAt: "2026-09-28T10:00:00Z" },
  ];
  const signals = detectSignals(facts({ projects }), NOW, defaults);
  assert.deepEqual(signals.map((s) => s.key), ["stale-project:limen"]);
  assert.equal(signals[0].channel, "ritual");
});

test("In Progress over the threshold → ritual observation keyed on the count", () => {
  const cards = ["1", "2", "3", "4"].map((id) => card({ id, list: "in_progress" }));
  const signal = only(detectSignals(facts({ cards }), NOW, defaults), "in_progress_over");
  assert.equal(signal.channel, "ritual");
  assert.equal(signal.fingerprint, "4");
  assert.deepEqual(detectSignals(facts({ cards: cards.slice(0, 3) }), NOW, defaults), []);
});

test("reopened from Done this week → review observation (low)", () => {
  const signal = only(detectSignals(facts({ cards: [card({ id: "g", reopenedFromDoneAt: "2026-09-28T10:00:00Z" })] }), NOW, defaults), "reopened_from_done");
  assert.equal(signal.channel, "ritual");
  assert.equal(signal.severity, "low");
});

test("follow-up next_check reached → ritual observation by default (never a mid-day ping)", () => {
  const followUps = [
    { id: "seqthera-feedback", project: "seqthera", nextCheck: "2026-09-29", status: "waiting" as const },
    { id: "future", project: "extract", nextCheck: "2026-10-01", status: "active" as const },
    { id: "closed", project: "extract", nextCheck: "2026-09-20", status: "resolved" as const },
  ];
  const signals = detectSignals(facts({ followUps }), NOW, defaults);
  assert.deepEqual(signals.map((s) => s.key), ["follow-up:seqthera-feedback"]);
  assert.equal(signals[0].channel, "ritual");
});

test("real deadline collision today → high interrupt; next workday → medium interrupt; later → ritual", () => {
  const today = detectSignals(facts({ cards: [card({ id: "x", due: "2026-09-29T14:00:00Z" }), card({ id: "y", list: "in_progress", due: "2026-09-29T15:00:00Z" })] }), NOW, defaults);
  const collision = only(today, "deadline_collision");
  assert.equal(collision.channel, "interrupt");
  assert.equal(collision.severity, "high");
  assert.equal(collision.fingerprint, "x,y");

  const later = detectSignals(facts({ cards: [card({ id: "x", list: "in_progress", due: "2026-10-06T14:00:00Z" }), card({ id: "y", list: "in_progress", due: "2026-10-06T15:00:00Z" })] }), NOW, defaults);
  assert.equal(only(later, "deadline_collision").channel, "ritual");

  const waitingPair = detectSignals(facts({ cards: [card({ id: "x", list: "waiting", due: "2026-09-29T14:00:00Z" }), card({ id: "y", list: "in_progress", due: "2026-09-29T15:00:00Z" })] }), NOW, defaults);
  assert.ok(!waitingPair.some((s) => s.kind === "deadline_collision"), "a Waiting card is not part of a collision");
});

// --- Lifecycle ----------------------------------------------------------------------------------------

const overdueC = (due = "2026-09-29T07:00:00Z") => detectSignals(facts({ cards: [card({ id: "c", due })] }), NOW, defaults);

test("lifecycle: new → open; unchanged → no reset; changed fact → new occurrence; gone → resolved", () => {
  let ledger: SignalLedger = advanceSignalLedger({}, overdueC(), NOW);
  assert.equal(ledger["overdue:c"].status, "open");
  ledger = markSignals(ledger, overdueC(), "notified", NOW);

  const later = new Date("2026-09-29T09:00:00Z");
  const unchanged = advanceSignalLedger(ledger, overdueC(), later);
  assert.equal(unchanged["overdue:c"].status, "notified", "no resend while the fact is unchanged");
  assert.equal(unchanged["overdue:c"].firstSeenAt, NOW.toISOString());

  const redated = advanceSignalLedger(unchanged, overdueC("2026-09-29T07:30:00Z"), later);
  assert.equal(redated["overdue:c"].status, "open", "a changed material fact is a new eligible occurrence");
  assert.equal(redated["overdue:c"].firstSeenAt, later.toISOString());

  const resolved = advanceSignalLedger(redated, [], later);
  assert.equal(resolved["overdue:c"].status, "resolved");

  const reopened = advanceSignalLedger(resolved, overdueC("2026-09-29T07:30:00Z"), new Date("2026-09-29T10:00:00Z"));
  assert.equal(reopened["overdue:c"].status, "open", "a resolved key that returns never reuses its old state");
});

test("markSignals ignores a signal whose fingerprint no longer matches the ledger", () => {
  const ledger = advanceSignalLedger({}, overdueC(), NOW);
  const marked = markSignals(ledger, overdueC("2026-09-29T07:30:00Z"), "notified", NOW);
  assert.equal(marked["overdue:c"].status, "open");
});

test("resolved records are pruned after the retention window", () => {
  const ledger = advanceSignalLedger(advanceSignalLedger({}, overdueC(), NOW), [], NOW);
  const muchLater = new Date("2026-10-20T08:00:00Z");
  assert.equal(advanceSignalLedger(ledger, [], muchLater)["overdue:c"], undefined);
});

test("mutes: exact occurrence, key, project, kind, and expiry", () => {
  const [signal] = overdueC();
  const handle = occurrenceHandle(signal);
  assert.equal(handle, "overdue:c@2026-09-29T07:00:00Z");
  assert.equal(isMuted(signal, [{ target: handle, until: null }], "2026-09-29"), true);
  assert.equal(isMuted(overdueC("2026-09-29T07:30:00Z")[0], [{ target: handle, until: null }], "2026-09-29"), false, "a changed fact is not covered by an occurrence mute");
  assert.equal(isMuted(signal, [{ target: "overdue:c", until: null }], "2026-09-29"), true);
  assert.equal(isMuted(signal, [{ target: "project:extract", until: null }], "2026-09-29"), true);
  assert.equal(isMuted(signal, [{ target: "kind:newly_overdue", until: null }], "2026-09-29"), true);
  assert.equal(isMuted(signal, [{ target: handle, until: "2026-09-29" }], "2026-09-29"), true, "until is inclusive");
  assert.equal(isMuted(signal, [{ target: handle, until: "2026-09-28" }], "2026-09-29"), false);
});

test("ritual observations exclude hard-muted signals ('не пиши мені про waiting' → kind mute)", () => {
  const signals = detectSignals(
    facts({ cards: [card({ id: "e", list: "waiting", enteredListAt: "2026-09-20T09:00:00Z" }), card({ id: "b", due: "2026-10-01T15:00:00Z" })] }),
    NOW,
    defaults,
  );
  const config: RhythmConfig = { ...defaults, mutes: [{ target: "kind:waiting_long", until: null }] };
  assert.deepEqual(ritualObservations(signals, config, NOW).map((s) => s.kind), ["due_soon"]);
});

// --- Selection limits -----------------------------------------------------------------------------------

function selection(signals: Signal[], overrides: Partial<ExceptionSelectionInput> = {}): ExceptionSelectionInput {
  const now = overrides.now ?? NOW;
  return {
    now,
    config: defaults,
    signals,
    ledger: advanceSignalLedger({}, signals, new Date(now.getTime() - 60_000)),
    exceptionsSent: [],
    lastRitualSentAt: null,
    exceptionInFlight: false,
    ...overrides,
  };
}

const interruptHigh = overdueC();
const interruptMedium = detectSignals(facts({ cards: [card({ id: "a", due: "2026-09-30T15:00:00Z" })] }), NOW, defaults);
const ritualOnly = detectSignals(facts({ cards: [card({ id: "b", due: "2026-10-01T15:00:00Z" })] }), NOW, defaults);

test("only interrupt candidates are considered; ritual observations never trigger an exception", () => {
  assert.deepEqual(selectException(selection(ritualOnly)), { decision: "none", reason: "no_candidate" });
  const decision = selectException(selection([...ritualOnly, ...interruptMedium]));
  assert.equal(decision.decision, "consider");
  assert.deepEqual(decision.decision === "consider" && decision.signals.map((s) => s.key), ["due-tomorrow:a"]);
});

test("grouping: several candidates become ONE exception, highest severity first, bounded", () => {
  const decision = selectException(selection([...interruptMedium, ...interruptHigh]));
  assert.equal(decision.decision, "consider");
  if (decision.decision !== "consider") return;
  assert.deepEqual(decision.signals.map((s) => s.key), ["overdue:c", "due-tomorrow:a"]);
  assert.equal(decision.severity, "high");
  assert.equal(decision.ordinal, 1);
});

test("no repeat: a notified or silently evaluated occurrence is not considered again", () => {
  for (const status of ["notified", "evaluated"] as const) {
    const input = selection(interruptHigh);
    const decision = selectException({ ...input, ledger: markSignals(input.ledger, interruptHigh, status, NOW) });
    assert.deepEqual(decision, { decision: "none", reason: "no_candidate" }, status);
  }
});

test("suppression: a muted candidate is never considered", () => {
  const config: RhythmConfig = { ...defaults, mutes: [{ target: occurrenceHandle(interruptHigh[0]), until: null }] };
  assert.deepEqual(selectException(selection(interruptHigh, { config })), { decision: "none", reason: "no_candidate" });
});

test("a fact known before today's ritual belonged to that ritual, not to an interruption", () => {
  const input = selection(interruptHigh);
  const ritualAfter = new Date(NOW.getTime() + 1000).toISOString();
  assert.deepEqual(selectException({ ...input, lastRitualSentAt: ritualAfter }), { decision: "none", reason: "no_candidate" });
  const ritualBefore = new Date(NOW.getTime() - 3_600_000).toISOString();
  assert.equal(selectException({ ...input, lastRitualSentAt: ritualBefore }).decision, "consider");
});

test("cap 1 preferred: after one exception, a medium candidate waits for the next ritual", () => {
  const sent = [{ sentAt: "2026-09-29T05:00:00Z", severity: "medium" as const }];
  const input = selection(interruptMedium, { exceptionsSent: sent });
  assert.deepEqual(selectException(input), { decision: "none", reason: "preferred_cap_reached" });
});

test("second exception requires a NEW high-severity situation (first seen after the first exception)", () => {
  const firstSentAt = "2026-09-29T05:00:00Z";
  const input = selection(interruptHigh, { exceptionsSent: [{ sentAt: firstSentAt, severity: "medium" }] });
  const decision = selectException(input);
  assert.equal(decision.decision, "consider");
  assert.equal(decision.decision === "consider" && decision.ordinal, 2);

  const oldHigh = { ...input, ledger: { "overdue:c": { ...input.ledger["overdue:c"], firstSeenAt: "2026-09-29T04:00:00Z" } } };
  assert.deepEqual(selectException(oldHigh), { decision: "none", reason: "preferred_cap_reached" });
});

test("absolute max 2 per day, and 3+ is impossible even with new high severity", () => {
  const sent = [
    { sentAt: "2026-09-29T05:00:00Z", severity: "medium" as const },
    { sentAt: "2026-09-29T06:00:00Z", severity: "high" as const },
  ];
  assert.deepEqual(selectException(selection(interruptHigh, { exceptionsSent: sent })), { decision: "none", reason: "daily_max_reached" });
});

test("yesterday's exceptions do not count toward today's cap", () => {
  const sent = [
    { sentAt: "2026-09-28T10:00:00Z", severity: "high" as const },
    { sentAt: "2026-09-28T13:00:00Z", severity: "high" as const },
  ];
  assert.equal(selectException(selection(interruptMedium, { exceptionsSent: sent })).decision, "consider");
});

test("2h spacing between unsolicited deliveries", () => {
  const sent = [{ sentAt: "2026-09-29T07:00:00Z", severity: "medium" as const }];
  assert.deepEqual(selectException(selection(interruptHigh, { exceptionsSent: sent })), { decision: "defer", reason: "spacing" });
  const later = new Date("2026-09-29T09:01:00Z");
  const decision = selectException(selection(detectSignals(facts({ cards: [card({ id: "c", due: "2026-09-29T08:30:00Z" })] }), later, defaults), { now: later, exceptionsSent: sent }));
  assert.equal(decision.decision, "consider");
});

test("quiet hours defer (no queue burst: the fact waits for the next ritual)", () => {
  const night = new Date("2026-09-29T19:00:00Z"); // 22:00 Kyiv
  const signals = detectSignals(facts({ cards: [card({ id: "c", due: "2026-09-29T18:30:00Z" })] }), night, defaults);
  assert.deepEqual(selectException(selection(signals, { now: night })), { decision: "defer", reason: "quiet_hours" });
});

test("weekends: silent by default; with weekend_exceptions on only high severity passes", () => {
  const saturday = new Date("2026-10-03T09:00:00Z");
  const high = detectSignals(facts({ cards: [card({ id: "c", due: "2026-10-03T08:00:00Z" })] }), saturday, defaults);
  assert.deepEqual(selectException(selection(high, { now: saturday })), { decision: "defer", reason: "non_workday" });
  const weekendsOn: RhythmConfig = { ...defaults, exceptions: { ...defaults.exceptions, weekends: true } };
  assert.equal(selectException(selection(high, { now: saturday, config: weekendsOn })).decision, "consider");
  const medium = detectSignals(facts({ cards: [card({ id: "a", due: "2026-10-05T12:00:00Z" })] }), saturday, defaults);
  assert.equal(medium[0].channel, "interrupt");
  assert.deepEqual(selectException(selection(medium, { now: saturday, config: weekendsOn })), { decision: "defer", reason: "non_workday" });
});

test("exceptions off, max 0 or an in-flight/ambiguous exception → none", () => {
  const off: RhythmConfig = { ...defaults, exceptions: { ...defaults.exceptions, enabled: false } };
  assert.equal(selectException(selection(interruptHigh, { config: off })).decision, "none");
  const zero: RhythmConfig = { ...defaults, exceptions: { ...defaults.exceptions, maxPerDay: 0, preferredPerDay: 0 } };
  assert.equal(selectException(selection(interruptHigh, { config: zero })).decision, "none");
  assert.deepEqual(selectException(selection(interruptHigh, { exceptionInFlight: true })), { decision: "none", reason: "exception_in_flight" });
});
