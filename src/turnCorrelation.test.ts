import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DjonikSpecialistUnverifiedError,
  DjonikTurnIncompleteError,
  SpecialistTurnProvenance,
  classifyStopReason,
  composeWithSpecialist,
  type SpecialistUnverifiedReason,
} from "./turnCorrelation.js";

const NAME = "Djonik Project Health Specialist";
const THREAD = "sthr_ph_1";
/** #38 natural cue, pinned independently of the source constant so an accidental change fails. */
const WITHHELD_CUE = "Якщо в цьому ж запиті було ще щось — напиши це окремим повідомленням.";

const created = (threadId = THREAD, agentName = NAME) => ({ agent_name: agentName, session_thread_id: threadId });
const sent = (threadId = THREAD, agentName: string | null = NAME) => ({ to_agent_name: agentName, to_session_thread_id: threadId });
const received = (text: string, threadId = THREAD, agentName: string | null = NAME) => ({
  from_agent_name: agentName,
  from_session_thread_id: threadId,
  content: [{ type: "text", text }],
});
const idle = (type: string, threadId = THREAD, agentName = NAME) => ({
  agent_name: agentName,
  session_thread_id: threadId,
  stop_reason: { type },
});

test("classifyStopReason: only end_turn completes; anything unrecognised fails closed as unknown", () => {
  assert.equal(classifyStopReason({ type: "end_turn" }), "end_turn");
  assert.equal(classifyStopReason({ type: "budget_reached" }), "budget_reached");
  assert.equal(classifyStopReason({ type: "requires_action", event_ids: ["e1"] }), "requires_action");
  assert.equal(classifyStopReason({ type: "retries_exhausted" }), "retries_exhausted");
  for (const bad of [undefined, null, {}, { type: "something_new" }, "end_turn", 7]) {
    assert.equal(classifyStopReason(bad), "unknown", String(JSON.stringify(bad)));
  }
});

test("DjonikTurnIncompleteError: deterministic, keeps partial text as data only, says nothing was resumed", () => {
  const error = new DjonikTurnIncompleteError("budget_reached", "Working...", null);
  assert.equal(error.stopKind, "budget_reached");
  assert.equal(error.partialReply, "Working...");
  assert.ok(!error.message.includes("Working..."), "partial text is never part of the user-visible message");
  assert.match(error.message, /budget_reached/);
  assert.match(error.message, /нічого не відновлено і жодну дію не повторено/);
  assert.ok(!error.message.includes("Trello-змін"), "no mutation section without a mutation report");

  const withReport = new DjonikTurnIncompleteError("requires_action", "", "⚠️ НЕ підтверджено: картка A");
  assert.match(withReport.message, /requires_action/);
  assert.match(withReport.message, /Стан Trello-змін цього ходу/);
  assert.match(withReport.message, /⚠️ НЕ підтверджено: картка A/);
});

test("SpecialistTurnProvenance: a result needs THIS turn's own engagement (created or sent-to)", () => {
  const p = new SpecialistTurnProvenance(NAME);
  p.beginTurn();
  p.onThreadCreated(created(), true);
  p.onThreadMessageReceived(received("S"));
  assert.deepEqual(p.verdict(), { status: "verified", text: "S" });

  // Next turn: the thread exists (session lifetime) but the turn has not engaged it: a late result is quarantined.
  p.beginTurn();
  p.onThreadMessageReceived(received("OLD"));
  assert.deepEqual(p.verdict(), { status: "none" });
  assert.equal(p.quarantinedResults, 1);

  // Same thread, legitimately re-messaged this turn: accepted.
  p.beginTurn();
  p.onThreadMessageSent(sent());
  p.onThreadMessageReceived(received("NEW"));
  assert.deepEqual(p.verdict(), { status: "verified", text: "NEW" });
  assert.equal(p.quarantinedResults, 0);
});

test("SpecialistTurnProvenance: a thread announced before this turn's anchor proves identity but never engagement", () => {
  const p = new SpecialistTurnProvenance(NAME);
  p.beginTurn();
  p.onThreadCreated(created(), false); // pre-anchor: identity only
  p.onThreadMessageReceived(received("LATE"));
  assert.deepEqual(p.verdict(), { status: "none" });
  assert.equal(p.quarantinedResults, 1);
});

test("SpecialistTurnProvenance: wrong identity is never accepted", () => {
  const p = new SpecialistTurnProvenance(NAME);
  p.beginTurn();
  p.onThreadCreated(created("sthr_other", "Some Other Agent"), true);
  p.onThreadMessageReceived(received("X", "sthr_other", "Some Other Agent")); // wrong callable name
  p.onThreadMessageReceived(received("X", "sthr_other", NAME)); // right name, thread announced for someone else
  p.onThreadMessageReceived(received("X", "sthr_never_seen", NAME)); // unknown thread
  p.onThreadMessageReceived(received("X", THREAD, null)); // no callable-agent name (from the primary)
  assert.deepEqual(p.verdict(), { status: "none" });
  assert.equal(p.quarantinedResults, 0, "identity failures are ignored, not counted as late canonical results");

  const disabled = new SpecialistTurnProvenance(null);
  disabled.beginTurn();
  disabled.onThreadCreated(created(), true);
  disabled.onThreadMessageReceived(received("X"));
  assert.deepEqual(disabled.verdict(), { status: "none" });
});

test("SpecialistTurnProvenance: an engaged delegation with an unattributable canonical-looking result is unverified, never ignored", () => {
  const stray = (label: string, receive: (p: SpecialistTurnProvenance) => void) => {
    const p = new SpecialistTurnProvenance(NAME);
    p.beginTurn();
    p.onThreadCreated(created(), true);
    p.onThreadMessageReceived(received("GOOD")); // even a good result cannot rescue an ambiguous turn
    receive(p);
    assert.deepEqual(p.verdict(), { status: "unverified", reason: "unrecognized_result" }, label);
  };
  stray("canonical name from a thread never announced", (p) => p.onThreadMessageReceived(received("X", "sthr_unknown", NAME)));
  stray("canonical thread reporting under another name", (p) => p.onThreadMessageReceived(received("X", THREAD, "Some Other Agent")));
  stray("canonical thread reporting with no name", (p) => p.onThreadMessageReceived(received("X", THREAD, null)));

  // ...but an ordinary turn (nothing engaged) only ever ignores it.
  const ordinary = new SpecialistTurnProvenance(NAME);
  ordinary.beginTurn();
  ordinary.onThreadCreated(created(), false);
  ordinary.onThreadMessageReceived(received("X", "sthr_unknown", NAME));
  assert.deepEqual(ordinary.verdict(), { status: "none" });
});

test("SpecialistTurnProvenance: engaged with no result at all is unverified (missing_result)", () => {
  const p = new SpecialistTurnProvenance(NAME);
  p.beginTurn();
  p.onThreadCreated(created(), true);
  assert.deepEqual(p.verdict(), { status: "unverified", reason: "missing_result" });

  p.beginTurn();
  p.onThreadMessageSent(sent());
  assert.deepEqual(p.verdict(), { status: "unverified", reason: "missing_result" }, "a re-engaged persistent thread too");
});

test("SpecialistTurnProvenance: duplicate, several-thread, non-plain and abnormally-stopped results are unverified", () => {
  const dup = new SpecialistTurnProvenance(NAME);
  dup.beginTurn();
  dup.onThreadCreated(created(), true);
  dup.onThreadMessageReceived(received("ONE"));
  dup.onThreadMessageReceived(received("TWO"));
  assert.deepEqual(dup.verdict(), { status: "unverified", reason: "duplicate_results" });

  const two = new SpecialistTurnProvenance(NAME);
  two.beginTurn();
  two.onThreadCreated(created("a"), true);
  two.onThreadCreated(created("b"), true);
  two.onThreadMessageReceived(received("ONE", "a"));
  two.onThreadMessageReceived(received("TWO", "b"));
  assert.deepEqual(two.verdict(), { status: "unverified", reason: "multiple_threads" });

  const twoOneResult = new SpecialistTurnProvenance(NAME);
  twoOneResult.beginTurn();
  twoOneResult.onThreadCreated(created("a"), true);
  twoOneResult.onThreadCreated(created("b"), true);
  twoOneResult.onThreadMessageReceived(received("ONE", "a"));
  assert.deepEqual(twoOneResult.verdict(), { status: "unverified", reason: "multiple_threads" }, "two engaged threads are ambiguous even with a single result");

  for (const content of [
    [{ type: "text", text: "A" }, { type: "image", source: {} }],
    [{ type: "text", text: "" }],
    [],
  ]) {
    const plain = new SpecialistTurnProvenance(NAME);
    plain.beginTurn();
    plain.onThreadCreated(created(), true);
    plain.onThreadMessageReceived({ from_agent_name: NAME, from_session_thread_id: THREAD, content });
    assert.deepEqual(plain.verdict(), { status: "unverified", reason: "not_exact_text" });
  }

  for (const stop of ["budget_reached", "requires_action", "retries_exhausted", "weird"]) {
    const stopped = new SpecialistTurnProvenance(NAME);
    stopped.beginTurn();
    stopped.onThreadCreated(created(), true);
    stopped.onThreadMessageReceived(received("WORKING..."));
    stopped.onThreadIdle(idle(stop));
    assert.deepEqual(stopped.verdict(), { status: "unverified", reason: "child_not_completed" }, stop);
  }

  const ok = new SpecialistTurnProvenance(NAME);
  ok.beginTurn();
  ok.onThreadCreated(created(), true);
  ok.onThreadMessageReceived(received("FINAL"));
  ok.onThreadIdle(idle("end_turn"));
  assert.deepEqual(ok.verdict(), { status: "verified", text: "FINAL" });
});

test("SpecialistTurnProvenance: turn state never leaks into the next turn", () => {
  const p = new SpecialistTurnProvenance(NAME);
  p.beginTurn();
  p.onThreadCreated(created(), true);
  p.onThreadMessageReceived(received("ONE"));
  p.onThreadMessageReceived(received("TWO"));
  p.onThreadIdle(idle("budget_reached"));
  assert.equal(p.verdict().status, "unverified");

  p.beginTurn();
  assert.deepEqual(p.verdict(), { status: "none" });
  p.onThreadMessageSent(sent());
  p.onThreadMessageReceived(received("CLEAN"));
  assert.deepEqual(p.verdict(), { status: "verified", text: "CLEAN" }, "no duplicate/incomplete state carried over");
});

test("composeWithSpecialist: a verified specialist string stays authoritative; other coordinator text is withheld VISIBLY", () => {
  const S = "HEALTH ONLY";
  assert.deepEqual(composeWithSpecialist("", S, null), { text: S, mode: "specialist_only" });
  assert.deepEqual(composeWithSpecialist(S, S, null), { text: S, mode: "exact" });

  for (const coordinator of ["HAIKU REWRITE", "HEALTH AND DAILY PLAN", `Ось:\n${S}\nА ще план дня.`]) {
    const composed = composeWithSpecialist(coordinator, S, null);
    assert.equal(composed.mode, "coordinator_withheld");
    assert.ok(composed.text.startsWith(S), "the specialist string is first, byte for byte");
    assert.ok(!composed.text.includes(coordinator), "no coordinator prose is ever shown beside it");
    // #38: exactly the specialist bytes, then one short natural cue — nothing else.
    assert.equal(composed.text, `${S}\n\n———\n${WITHHELD_CUE}`);
  }
  // The cue is one plain sentence with no technical vocabulary and no claim that a second part existed.
  assert.equal(WITHHELD_CUE.split(/[.!?]\s/).length, 1);
  assert.doesNotMatch(WITHHELD_CUE, /координатор|спеціаліст|coordinator|specialist|withheld|runtime|приховано|помилк|ℹ️|⚠️/i);
  assert.match(WITHHELD_CUE, /^Якщо /, "conditional: it never asserts a second request existed");

  // A turn with Trello writes leads with the system-owned mutation reply, then the specialist block.
  const withWrite = composeWithSpecialist("Готово, все зроблено!", S, "✅ Підтверджено читанням картки: A");
  assert.equal(withWrite.mode, "coordinator_withheld");
  assert.ok(withWrite.text.startsWith("✅ Підтверджено читанням картки: A\n\n———\nВисновок Project Health (без змін):\nHEALTH ONLY"));
  assert.ok(!withWrite.text.includes("Готово, все зроблено!"));
  assert.equal(
    withWrite.text,
    `✅ Підтверджено читанням картки: A\n\n———\nВисновок Project Health (без змін):\nHEALTH ONLY\n\n———\n${WITHHELD_CUE}`,
  );
  assert.deepEqual(composeWithSpecialist(S, S, "✅ A"), {
    mode: "exact",
    text: "✅ A\n\n———\nВисновок Project Health (без змін):\nHEALTH ONLY",
  });
  assert.deepEqual(composeWithSpecialist("", S, "✅ A"), {
    mode: "specialist_only",
    text: "✅ A\n\n———\nВисновок Project Health (без змін):\nHEALTH ONLY",
  });

  // Byte-exactness: no trim or normalisation of the specialist string.
  const raw = "\n  **Стан:**\r\n- «Брендбук»  \t\n";
  assert.ok(composeWithSpecialist("інше", raw, null).text.startsWith(raw));
});

test("DjonikSpecialistUnverifiedError: deterministic, names the reason, keeps coordinator text as data only", () => {
  const reasons: SpecialistUnverifiedReason[] = [
    "missing_result", "duplicate_results", "multiple_threads", "unrecognized_result", "not_exact_text", "child_not_completed",
  ];
  const messages = new Set<string>();
  for (const reason of reasons) {
    const error = new DjonikSpecialistUnverifiedError(reason, "COORDINATOR HEALTH PROSE", null);
    assert.equal(error.reason, reason);
    assert.equal(error.coordinatorReply, "COORDINATOR HEALTH PROSE");
    assert.match(error.message, /Результат Project Health від спеціаліста НЕ підтверджено/);
    assert.match(error.message, /Нічого не перепідсилалось і не делегувалось повторно/);
    assert.ok(!error.message.includes("COORDINATOR HEALTH PROSE"));
    assert.ok(!/sthr_|sevt_|stack/i.test(error.message), "no raw provider internals");
    assert.ok(!error.message.includes("Trello-змін"));
    messages.add(error.message);
  }
  assert.equal(messages.size, reasons.length, "each reason is explained distinctly");
  assert.match(
    new DjonikSpecialistUnverifiedError("missing_result", "", "✅ Підтверджено читанням картки: A").message,
    /Стан Trello-змін цього ходу[^]*✅ Підтверджено читанням картки: A/,
  );
});

test("SpecialistTurnProvenance (#40): the latest thread idle wins — requires_action then end_turn is complete, and vice versa", () => {
  const resumed = new SpecialistTurnProvenance(NAME);
  resumed.beginTurn();
  resumed.onThreadCreated(created(), true);
  resumed.onThreadIdle(idle("requires_action"));
  resumed.onThreadMessageReceived(received("FINAL"));
  resumed.onThreadIdle(idle("end_turn"));
  assert.deepEqual(resumed.verdict(), { status: "verified", text: "FINAL" });

  const stoppedLater = new SpecialistTurnProvenance(NAME);
  stoppedLater.beginTurn();
  stoppedLater.onThreadCreated(created(), true);
  stoppedLater.onThreadMessageReceived(received("WORKING..."));
  stoppedLater.onThreadIdle(idle("end_turn"));
  stoppedLater.onThreadIdle(idle("budget_reached"));
  assert.deepEqual(stoppedLater.verdict(), { status: "unverified", reason: "child_not_completed" });
});
