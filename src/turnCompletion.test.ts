import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  DjonikSessionDeadError,
  DjonikSpecialistUnverifiedError,
  DjonikTurnIncompleteError,
  DjonikUnverifiedMutationError,
  PROJECT_HEALTH_SPECIALIST_AGENT_ID,
  type DjonikSessionHandle,
  type DjonikTraceEvent,
  type DjonikTurnTelemetry,
} from "./djonikClient.js";

// ---------------------------------------------------------------------------------------------
// Issue #32: turn completion, event correlation and specialist-result preservation.
//
// Every test drives the real `connectToDjonik` pipeline with a scripted official-shape event
// stream and asserts the SAFE outcome. Source fixtures establish event handling, not model
// behaviour (the live mixed-intent smoke is a separately authorized step).
// ---------------------------------------------------------------------------------------------

const PH_NAME = "Djonik Project Health Specialist";
const PH_THREAD = "sthr_ph_1";

function roster(extraEntries: unknown[] = []): unknown {
  return {
    id: "agent_prod",
    multiagent: {
      type: "coordinator",
      agents: [{ type: "agent", id: PROJECT_HEALTH_SPECIALIST_AGENT_ID, name: PH_NAME }, ...extraEntries],
    },
  };
}

interface Scripted {
  client: Anthropic;
  sendCalls: unknown[];
  /** Feeds events to the primary stream, in order. */
  push: (...events: unknown[]) => void;
  /** Ends the stream (the iterator reports `done`). */
  end: () => void;
}

/**
 * A push-driven fake of the Managed Agents client. With `withIds`, `events.send` answers like the
 * official API does — `{ data: [{ id, type: "user.message" }] }` — so a turn's own submission id
 * (`evt_user_<n>`, n counting from 1 over provider sends) is known and `userEcho(n)` can echo it.
 */
function createScripted(agent?: unknown, withIds = false): Scripted {
  const sendCalls: unknown[] = [];
  const queue: unknown[] = [];
  const waiters: Array<(result: { value: unknown; done: boolean }) => void> = [];
  let ended = false;

  function push(...events: unknown[]): void {
    for (const event of events) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    }
  }
  function end(): void {
    ended = true;
    for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<{ value: unknown; done: boolean }> => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };

  const client = {
    beta: {
      sessions: {
        create: async () => (agent === undefined ? { id: "session_test" } : { id: "session_test", agent }),
        events: {
          stream: async () => stream,
          send: async (_sessionId: string, params: unknown) => {
            sendCalls.push(params);
            return withIds ? { data: [{ id: `evt_user_${sendCalls.length}`, type: "user.message" }] } : undefined;
          },
        },
      },
    },
  } as unknown as Anthropic;

  return { client, sendCalls, push, end };
}

const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const idleWith = (type: string, extra: Record<string, unknown> = {}): unknown => ({
  type: "session.status_idle",
  stop_reason: { type, ...extra },
});
const msg = (text: string): unknown => ({ type: "agent.message", content: [{ type: "text", text }] });
const userEcho = (n: number): unknown => ({ type: "user.message", id: `evt_user_${n}`, content: [{ type: "text", text: "x" }] });
const created = (threadId = PH_THREAD, agentName = PH_NAME): unknown => ({
  type: "session.thread_created",
  id: `evt_created_${threadId}`,
  agent_name: agentName,
  session_thread_id: threadId,
});
const sentTo = (threadId = PH_THREAD, agentName = PH_NAME): unknown => ({
  type: "agent.thread_message_sent",
  id: `evt_sent_${Math.random().toString(36).slice(2)}`,
  content: [{ type: "text", text: "task" }],
  to_session_thread_id: threadId,
  to_agent_name: agentName,
});
const childResult = (text: string, threadId = PH_THREAD, agentName: string | null = PH_NAME): unknown => ({
  type: "agent.thread_message_received",
  id: `evt_received_${Math.random().toString(36).slice(2)}`,
  content: [{ type: "text", text }],
  from_session_thread_id: threadId,
  ...(agentName === null ? {} : { from_agent_name: agentName }),
});
const childIdle = (type: string, threadId = PH_THREAD): unknown => ({
  type: "session.thread_status_idle",
  agent_name: PH_NAME,
  session_thread_id: threadId,
  stop_reason: { type },
});
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): unknown => ({
  type: "agent.mcp_tool_use",
  id,
  name,
  mcp_server_name: "trello",
  input,
});
const toolResult = (id: string, isError = false, card?: Record<string, unknown>): unknown => ({
  type: "agent.mcp_tool_result",
  id: `${id}_result`,
  mcp_tool_use_id: id,
  is_error: isError,
  content: card ? [{ type: "text", text: JSON.stringify(card) }] : undefined,
});

const S = "HEALTH ONLY";

async function open(agent?: unknown, withIds = false) {
  const traces: DjonikTraceEvent[] = [];
  const telemetry: DjonikTurnTelemetry[] = [];
  const scripted = createScripted(agent, withIds);
  const session: DjonikSessionHandle = await connectToDjonik(
    scripted.client,
    "agent_x",
    "env_x",
    "memstore_x",
    "vlt_x",
    (event) => traces.push(event),
    (record) => telemetry.push(record),
    "telegram",
  );
  return { ...scripted, session, traces, telemetry };
}

/** Start of the fixed notice shown when coordinator text is withheld beside a verified specialist result. */
const WITHHELD_NOTICE = "ℹ️ Джонік також сформував власний текст";

/** The turn must fail visibly because the specialist-backed Project Health result was not established. */
async function unverifiedSpecialist(promise: Promise<unknown>, reason: string): Promise<DjonikSpecialistUnverifiedError> {
  const error = await rejection(promise);
  assert.ok(error instanceof DjonikSpecialistUnverifiedError, `expected DjonikSpecialistUnverifiedError, got ${String(error)}`);
  assert.equal(error.reason, reason);
  assert.match(error.message, /Результат Project Health від спеціаліста НЕ підтверджено/);
  assert.ok(!/sthr_|sevt_/.test(error.message), "no raw provider internals in the user-visible message");
  return error;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  assert.fail("expected the turn to be rejected");
}

// ---------------------------------------------------------------------------------------------
// 1–6. Completion: only an authoritative end_turn completes a turn.
// ---------------------------------------------------------------------------------------------

test("#32 1: an ordinary end_turn returns the reply exactly", async () => {
  const { session, push } = await open();
  push(msg("Привіт!"), IDLE_OK);
  assert.strictEqual(await session.send("Привіт"), "Привіт!");
  session.close();
});

test("#32 2 (R3): partial text then budget_reached is NOT a completed reply", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(msg("Working..."), idleWith("budget_reached"));

  const error = await rejection(session.send("Зроби щось"));
  assert.ok(error instanceof DjonikTurnIncompleteError);
  assert.equal(error.stopKind, "budget_reached");
  assert.equal(error.partialReply, "Working...", "partial text survives only as data on the error");
  assert.ok(!error.message.includes("Working..."), "and is never part of what the user is shown");
  assert.equal(sendCalls.length, 1, "no resend, no nudge, no automatic resume");
  assert.deepEqual(traces.filter((t) => t.type === "turn_incomplete"), [{ type: "turn_incomplete", stopKind: "budget_reached" }]);

  // The Session itself is not dead: the next turn works normally.
  push(msg("Ок."), IDLE_OK);
  assert.strictEqual(await session.send("Тепер інше"), "Ок.");
  session.close();
});

test("#32 3: budget_reached with no text is an incomplete turn, not an 'empty reply'", async () => {
  const { session, push } = await open();
  push(idleWith("budget_reached"));
  const error = await rejection(session.send("Привіт"));
  assert.ok(error instanceof DjonikTurnIncompleteError);
  assert.equal(error.stopKind, "budget_reached");
  assert.equal(error.partialReply, "");
  session.close();
});

test("#32 4: requires_action is an incomplete turn (this client resolves no blocking events)", async () => {
  const { session, push, sendCalls } = await open();
  push(msg("Зараз підтверджу..."), idleWith("requires_action", { event_ids: ["sevt_1"] }));
  const error = await rejection(session.send("Привіт"));
  assert.ok(error instanceof DjonikTurnIncompleteError);
  assert.equal(error.stopKind, "requires_action");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#32 5: provider/error stops — exhausted retries, terminal error, termination — are never replies", async () => {
  const exhausted = await open();
  exhausted.push(
    msg("Half an answer"),
    { type: "session.error", error: { message: "provider failed", retry_status: { type: "exhausted" } } },
    idleWith("retries_exhausted"),
  );
  const incomplete = await rejection(exhausted.session.send("Привіт"));
  assert.ok(incomplete instanceof DjonikTurnIncompleteError);
  assert.equal(incomplete.stopKind, "retries_exhausted");
  exhausted.session.close();

  const terminal = await open();
  terminal.push(msg("Half an answer"), { type: "session.error", error: { message: "boom", retry_status: { type: "terminal" } } });
  assert.ok((await rejection(terminal.session.send("Привіт"))) instanceof DjonikSessionDeadError);
  terminal.session.close();

  const terminated = await open();
  terminated.push(msg("Half an answer"), { type: "session.status_terminated" });
  assert.ok((await rejection(terminated.session.send("Привіт"))) instanceof DjonikSessionDeadError);
  terminated.session.close();
});

test("#32 6: a stream that ends, or an idle without a recognised stop_reason, never yields the partial text", async () => {
  const ended = await open();
  ended.push(msg("Partial before the stream died"));
  const pending = rejection(ended.session.send("Привіт"));
  ended.end();
  assert.ok((await pending) instanceof DjonikSessionDeadError);

  for (const stop of [undefined, {}, { type: "something_new" }]) {
    const odd = await open();
    odd.push(msg("Looks finished"), { type: "session.status_idle", ...(stop === undefined ? {} : { stop_reason: stop }) });
    const error = await rejection(odd.session.send("Привіт"));
    assert.ok(error instanceof DjonikTurnIncompleteError, JSON.stringify(stop));
    assert.equal(error.stopKind, "unknown");
    odd.session.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 7–9. Correlation: stale idle, late child result, reused child thread.
// ---------------------------------------------------------------------------------------------

test("#32 7: a stale idle/tail from an earlier turn cannot complete or answer the current one (anchored on the turn's own echo)", async () => {
  const { session, push, traces, telemetry } = await open(undefined, true);

  // Turn 1: the platform echoes our user.message, so this Session's stream is known to echo.
  push(userEcho(1), msg("ONE"), IDLE_OK);
  assert.strictEqual(await session.send("Перше"), "ONE");

  // Turn 2: a stale paused-turn tail is already in the stream BEFORE turn 2's own echo.
  push(
    msg("STALE PARTIAL"),
    { type: "span.model_request_end" },
    idleWith("budget_reached"),
    userEcho(2),
    msg("TWO"),
    IDLE_OK,
  );
  assert.strictEqual(await session.send("Друге"), "TWO");
  assert.deepEqual(
    traces.filter((t) => t.type === "late_events_quarantined"),
    [{ type: "late_events_quarantined", preAnchorEvents: 3, lateSpecialistResults: 0 }],
  );
  assert.equal(telemetry[1].modelIterations, 0, "the stale tail's model request is not attributed to turn 2 (telemetry)");
  session.close();
});

test("#32 7b: without a learned echo nothing waits for an anchor (never hangs or fails a turn that has none)", async () => {
  const { session, push } = await open(undefined, true);
  push(msg("ONE"), IDLE_OK);
  assert.strictEqual(await session.send("Перше"), "ONE");
  push(msg("TWO"), IDLE_OK);
  assert.strictEqual(await session.send("Друге"), "TWO");
  session.close();
});

test("#32 7c: an unexpected echo on an anchored stream is a visible correlation failure, not a guess", async () => {
  const { session, push } = await open(undefined, true);
  push(userEcho(1), msg("ONE"), IDLE_OK);
  await session.send("Перше");
  push({ type: "user.message", id: "evt_someone_else", content: [] }, msg("TWO"), IDLE_OK);
  const error = await rejection(session.send("Друге"));
  assert.match(error.message, /could not correlate this turn/);
  session.close();
});

test("#32 8 (R5): a late child result after a budget stop never replaces the next ordinary turn's reply", async () => {
  const { session, push, traces } = await open(roster());

  push(created(), sentTo(), idleWith("budget_reached"));
  assert.ok((await rejection(session.send("Що по Extract?"))) instanceof DjonikTurnIncompleteError);

  // Turn 2 is ordinary; the OLD child result arrives during it.
  push(childResult("OLD HEALTH"), msg("NEW ORDINARY ANSWER"), IDLE_OK);
  assert.strictEqual(await session.send("Дякую"), "NEW ORDINARY ANSWER");
  assert.deepEqual(
    traces.filter((t) => t.type === "late_events_quarantined"),
    [{ type: "late_events_quarantined", preAnchorEvents: 0, lateSpecialistResults: 1 }],
  );
  session.close();
});

test("#32 8b: with an anchor, even a late thread_created + result from the old turn is quarantined", async () => {
  const { session, push } = await open(roster(), true);
  push(userEcho(1), msg("ONE"), IDLE_OK);
  await session.send("Перше");

  push(created(), childResult("OLD HEALTH"), userEcho(2), msg("NEW"), IDLE_OK);
  assert.strictEqual(await session.send("Друге"), "NEW");
  session.close();
});

test("#32 8c: a verified specialist result is never shown from a turn that did not complete", async () => {
  const { session, push } = await open(roster());
  push(created(), childResult("SPECIALIST FINAL"), msg("Збираю відповідь..."), idleWith("budget_reached"));
  const error = await rejection(session.send("Що по Extract?"));
  assert.ok(error instanceof DjonikTurnIncompleteError);
  assert.ok(!error.message.includes("SPECIALIST FINAL"));
  session.close();
});

test("#32 9: a reused child thread on a later, legitimate delegation is accepted for that turn only", async () => {
  const { session, push } = await open(roster());

  push(created(), sentTo(), childResult("EXACT ONE"), msg("EXACT ONE"), IDLE_OK);
  assert.strictEqual(await session.send("Extract?"), "EXACT ONE");

  push(sentTo(), childResult("EXACT TWO"), msg("EXACT TWO"), IDLE_OK);
  assert.strictEqual(await session.send("Seqthera?"), "EXACT TWO");

  push(msg("Будь ласка"), IDLE_OK);
  assert.strictEqual(await session.send("Дякую"), "Будь ласка", "turn 3 has no delegation: nothing leaks in");
  session.close();
});

test("#32 9b: an old late result plus a new one on the same re-engaged thread is ambiguous — fail-visible, never guessed", async () => {
  const { session, push, traces } = await open(roster());
  push(created(), sentTo(), idleWith("budget_reached"));
  await rejection(session.send("Extract?"));

  push(sentTo(), childResult("OLD LATE"), childResult("NEW"), msg("COORDINATOR ANSWER"), IDLE_OK);
  const error = await unverifiedSpecialist(session.send("Extract ще раз?"), "duplicate_results");
  assert.ok(!error.message.includes("COORDINATOR ANSWER") && !error.message.includes("OLD LATE") && !error.message.includes("NEW"));
  assert.deepEqual(
    traces.filter((t) => t.type === "specialist_result_unverified"),
    [{ type: "specialist_result_unverified", reason: "duplicate_results" }],
  );
  session.close();
});

// ---------------------------------------------------------------------------------------------
// 10–13. Missing / duplicate / ambiguous / wrong-identity child results.
// ---------------------------------------------------------------------------------------------

test("#32 10: an engaged delegation with NO child result fails visibly — the coordinator's Project Health prose is not shown", async () => {
  const { session, push, traces, sendCalls } = await open(roster());
  push(created(), sentTo(), msg("COORDINATOR"), IDLE_OK);
  const error = await unverifiedSpecialist(session.send("Extract?"), "missing_result");
  assert.equal(error.coordinatorReply, "COORDINATOR", "kept only as data on the error");
  assert.ok(!error.message.includes("COORDINATOR"));
  assert.equal(sendCalls.length, 1, "no retry and no automatic re-delegation");
  assert.equal(traces.filter((t) => t.type === "specialist_reply_composed").length, 0);
  session.close();
});

test("#32 10b: that turn's late result never answers the next turn, and the next ordinary turn is unaffected", async () => {
  const { session, push } = await open(roster());
  push(created(), sentTo(), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(session.send("Extract?"), "missing_result");

  push(childResult("LATE HEALTH"), msg("Звичайна відповідь."), IDLE_OK);
  assert.strictEqual(await session.send("Дякую"), "Звичайна відповідь.");
  session.close();
});

test("#32 11: duplicate canonical results fail visibly and are never called verified", async () => {
  const { session, push, traces } = await open(roster());
  push(created(), sentTo(), childResult("FIRST"), childResult("SECOND"), msg("COORDINATOR"), IDLE_OK);
  const error = await unverifiedSpecialist(session.send("Extract?"), "duplicate_results");
  assert.ok(!error.message.includes("FIRST") && !error.message.includes("SECOND") && !error.message.includes("COORDINATOR"));
  assert.deepEqual(
    traces.filter((t) => t.type === "specialist_result_unverified"),
    [{ type: "specialist_result_unverified", reason: "duplicate_results" }],
  );
  session.close();
});

test("#32 12: ambiguous provenance — two engaged threads, a stray/unknown thread, a stopped child — fails visibly", async () => {
  const two = await open(roster());
  two.push(created("a"), created("b"), childResult("ONE", "a"), childResult("TWO", "b"), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(two.session.send("Extract?"), "multiple_threads");
  two.session.close();

  const twoOneResult = await open(roster());
  twoOneResult.push(created("a"), created("b"), childResult("ONE", "a"), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(twoOneResult.session.send("Extract?"), "multiple_threads");
  twoOneResult.session.close();

  const unknownThread = await open(roster());
  unknownThread.push(created(), childResult("FROM NOWHERE", "sthr_never_announced"), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(unknownThread.session.send("Extract?"), "unrecognized_result");
  unknownThread.session.close();

  const strayBesideGood = await open(roster());
  strayBesideGood.push(created(), sentTo(), childResult("GOOD"), childResult("STRAY", "sthr_never_announced"), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(strayBesideGood.session.send("Extract?"), "unrecognized_result");
  strayBesideGood.session.close();
});

test("#32 12b: a canonical child that itself stopped abnormally, or returned non-text, fails visibly", async () => {
  for (const stop of ["budget_reached", "requires_action", "retries_exhausted"]) {
    const stopped = await open(roster());
    stopped.push(created(), sentTo(), childResult("WORKING..."), childIdle(stop), msg("COORDINATOR"), IDLE_OK);
    const error = await unverifiedSpecialist(stopped.session.send("Extract?"), "child_not_completed");
    assert.ok(!error.message.includes("WORKING...") && !error.message.includes("COORDINATOR"), stop);
    stopped.session.close();
  }

  const malformed = await open(roster());
  malformed.push(
    created(),
    sentTo(),
    { type: "agent.thread_message_received", content: [{ type: "text", text: "A" }, { type: "image", source: {} }], from_session_thread_id: PH_THREAD, from_agent_name: PH_NAME },
    msg("COORDINATOR"),
    IDLE_OK,
  );
  await unverifiedSpecialist(malformed.session.send("Extract?"), "not_exact_text");
  malformed.session.close();
});

test("#32 12c: an ordinary coordinator turn is unchanged — with a roster, with an unrelated child engaged, and after a fail-visible turn", async () => {
  const other = { type: "agent", id: "agent_other", name: "Other Specialist" };
  const { session, push } = await open(roster([other]));

  push(msg("Привіт!"), IDLE_OK);
  assert.strictEqual(await session.send("Привіт"), "Привіт!");

  // An unrelated roster child's delegation is not the canonical specialist's: nothing to verify or withhold.
  push(created("sthr_other", "Other Specialist"), sentTo("sthr_other", "Other Specialist"), childResult("OTHER RESULT", "sthr_other", "Other Specialist"), msg("COORDINATOR"), IDLE_OK);
  assert.strictEqual(await session.send("Щось?"), "COORDINATOR");

  push(created(), sentTo(), msg("COORDINATOR"), IDLE_OK);
  await unverifiedSpecialist(session.send("Extract?"), "missing_result");
  push(msg("Знову звичайна."), IDLE_OK);
  assert.strictEqual(await session.send("Дякую"), "Знову звичайна.", "a fail-visible turn leaves no state behind");
  session.close();
});

test("#32 13: wrong child identity is never accepted", async () => {
  const other = { type: "agent", id: "agent_other", name: "Other Specialist" };
  const { session, push } = await open(roster([other]));

  // The unrelated roster child reports: not the canonical specialist.
  push(created("sthr_other", "Other Specialist"), sentTo("sthr_other", "Other Specialist"), childResult("OTHER RESULT", "sthr_other", "Other Specialist"), msg("COORDINATOR"), IDLE_OK);
  assert.strictEqual(await session.send("Щось?"), "COORDINATOR");

  // A result labelled with the canonical name from a thread announced for someone else.
  push(sentTo("sthr_other"), childResult("SPOOF", "sthr_other", PH_NAME), msg("COORDINATOR 2"), IDLE_OK);
  assert.strictEqual(await session.send("Ще?"), "COORDINATOR 2");
  session.close();
});

// ---------------------------------------------------------------------------------------------
// 14–17. Canonical identity beside an unrelated roster entry; pure and mixed composition.
// ---------------------------------------------------------------------------------------------

test("#32 14 (R7): the canonical specialist keeps its protection beside an unrelated second roster entry", async () => {
  const unrelated = { type: "agent", id: "agent_future", name: "Future Specialist" };
  const { session, push } = await open(roster([unrelated]));
  push(created(), sentTo(), childResult(S), msg("HAIKU REWRITE"), IDLE_OK);
  const reply = await session.send("Що по Extract?");
  assert.ok(reply.startsWith(S), "the canonical result is preserved verbatim");
  assert.ok(!reply.includes("HAIKU REWRITE") && reply.includes(WITHHELD_NOTICE));
  session.close();
});

test("#32 15: a pure Project Health turn preserves the canonical result exactly (relay, or coordinator silent)", async () => {
  const relayed = await open(roster());
  relayed.push(created(), sentTo(), childResult(S), msg(S), IDLE_OK);
  assert.strictEqual(await relayed.session.send("Що по Extract?"), S);
  relayed.session.close();

  const silent = await open(roster());
  silent.push(created(), sentTo(), childResult(S), IDLE_OK);
  assert.strictEqual(await silent.session.send("Що по Extract?"), S);
  silent.session.close();
});

test("#32 16 (R4/#28): pure PH — a coordinator rewrite can never appear beside the specialist result as another Project Health answer", async () => {
  const { session, push, traces } = await open(roster());
  push(created(), sentTo(), childResult("СТАН: ЗДОРОВИЙ, ризиків немає."), msg("СТАН: КРИТИЧНИЙ, є ризик, залишилось 2 дні!"), IDLE_OK);
  const reply = await session.send("Що по Extract?");
  assert.ok(reply.startsWith("СТАН: ЗДОРОВИЙ, ризиків немає."));
  assert.ok(!reply.includes("КРИТИЧНИЙ") && !reply.includes("2 дні"), "the contradicting Haiku judgement is never shown");
  assert.ok(reply.includes(WITHHELD_NOTICE), "and its absence is announced, never silent");
  assert.deepEqual(
    traces.filter((t) => t.type === "specialist_reply_composed"),
    [{ type: "specialist_reply_composed", mode: "coordinator_withheld" }],
  );
  session.close();
});

test("#32 16b (R4): PH + a genuinely separate daily-plan output — events cannot tell it from a rewrite, so it is withheld VISIBLY and must be re-asked", async () => {
  const { session, push } = await open(roster());
  push(created(), sentTo(), childResult("HEALTH ONLY"), msg("HEALTH AND DAILY PLAN"), IDLE_OK);
  const reply = await session.send("Що по Extract і що робити сьогодні?");
  assert.ok(reply.startsWith("HEALTH ONLY"));
  assert.ok(!reply.includes("DAILY PLAN"), "the plan text is not shown: it cannot be proven independent of Project Health");
  assert.match(reply, /Якщо ви просили ще щось окреме \(наприклад, план дня\), надішліть це окремим повідомленням\./);
  session.close();
});

test("#32 17: coordinator text that merely CONTAINS the specialist string is not exempt — extras cannot be classified either", async () => {
  const { session, push, traces } = await open(roster());
  const coordinator = `Ось стан проєкту:\n${S}\n\nА ось план на сьогодні: 1) A 2) B`;
  push(created(), sentTo(), childResult(S), msg(coordinator), IDLE_OK);
  const reply = await session.send("Extract і план?");
  assert.ok(reply.startsWith(S) && !reply.includes("А ось план") && reply.includes(WITHHELD_NOTICE));
  assert.deepEqual(
    traces.filter((t) => t.type === "specialist_reply_composed"),
    [{ type: "specialist_reply_composed", mode: "coordinator_withheld" }],
  );
  session.close();
});

// ---------------------------------------------------------------------------------------------
// 18–20. #31 / #23 boundary: mutations keep their fail-closed guarantees beside a specialist result.
// ---------------------------------------------------------------------------------------------

const CARD = { id: "card_A", name: "Card A", due: null };

test("#32 18: Project Health + a verified Trello write keeps #31's guarantees and preserves the result; the write is not replayed", async () => {
  const { session, push, sendCalls, traces } = await open(roster());
  push(
    created(),
    sentTo(),
    childResult(S),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, CARD),
    msg("Готово, оновив Card A."),
    IDLE_OK,
  );
  const reply = await session.send("Що по Extract і перейменуй картку A");
  assert.match(reply, /^✅ Підтверджено читанням картки/, "the system-owned, verified mutation outcome leads (#31)");
  assert.ok(!reply.includes("Готово, оновив Card A."), "model text is never shown beside a verified specialist result");
  assert.ok(reply.includes(S));
  assert.equal(sendCalls.length, 1);
  assert.equal(traces.filter((t) => t.type === "mcp_tool_use" && t.toolName === "trelloWriteCard").length, 1);
  session.close();
});

test("#32 19: Project Health + a failed Trello write — the tool error overrides model text; the specialist result is kept", async () => {
  const { session, push, sendCalls } = await open(roster());
  push(
    created(),
    sentTo(),
    childResult(S),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", true),
    msg("Готово, все оновив!"),
    IDLE_OK,
  );
  const reply = await session.send("Що по Extract і перейменуй картку A");
  assert.ok(reply.startsWith("❌ Не виконано (помилка інструмента)"));
  assert.ok(!reply.includes("Готово, все оновив!"), "model false-success is never shown");
  assert.ok(reply.includes(S));
  assert.equal(sendCalls.length, 1, "a failed write is never re-prompted or replayed");
  session.close();
});

test("#32 19b: Project Health + an unverified Trello write fails closed after ONE nudge; the specialist result rides in the error, the write is not replayed", async () => {
  const { session, push, sendCalls, traces } = await open(roster());
  push(
    created(),
    sentTo(),
    childResult(S),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    msg("Готово, оновив!"),
    IDLE_OK,
    msg("Так, точно оновив!"),
    IDLE_OK,
  );
  const error = await rejection(session.send("Що по Extract і перейменуй картку A"));
  assert.ok(error instanceof DjonikUnverifiedMutationError);
  assert.match(error.message, /НЕ підтверджено/);
  assert.ok(!error.message.includes("Готово, оновив!") && !error.message.includes("Так, точно оновив!"));
  assert.ok(error.message.includes(S), "the read-only specialist result is preserved verbatim after the report");
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge");
  assert.equal(traces.filter((t) => t.type === "mcp_tool_use" && t.toolName === "trelloWriteCard").length, 1);
  session.close();
});

test("#32 19c: a specialist result received before the nudge still counts once the nudged read verifies the write", async () => {
  const { session, push } = await open(roster());
  push(
    created(),
    sentTo(),
    childResult(S),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    msg("Готово!"),
    IDLE_OK,
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, CARD),
    msg("Підтверджено: Card A оновлена."),
    IDLE_OK,
  );
  const reply = await session.send("Що по Extract і перейменуй картку A");
  assert.match(reply, /^✅ Підтверджено читанням картки/);
  assert.ok(!reply.includes("Підтверджено: Card A оновлена."));
  assert.ok(reply.includes(S));
  session.close();
});

test("#32 20: a due-date write keeps the #23 sentence (Kyiv weekday) even beside a specialist result", async () => {
  const due = "2026-09-21T21:30:00.000Z"; // Kyiv: вівторок, 22 вересня 2026, 00:30
  const card = { id: "card_A", name: "Card A", due };
  const { session, push } = await open(roster());
  push(
    created(),
    sentTo(),
    childResult(S),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", due }),
    toolResult("w", false, card),
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, card),
    msg("Понеділок, 22 вересня, 00:30"),
    IDLE_OK,
  );
  const reply = await session.send("Що по Extract і постав дедлайн");
  assert.ok(reply.startsWith("Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом."));
  assert.ok(!reply.includes("Понеділок"));
  assert.ok(reply.includes(S));
  session.close();
});

test("#32 19d: an engaged-but-unverified specialist beside a Trello write still reports the write from tool events, and never shows coordinator prose", async () => {
  // verified write + duplicate specialist results
  const verified = await open(roster());
  verified.push(
    created(), sentTo(), childResult("ONE"), childResult("TWO"),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, CARD),
    msg("Готово, і ось здоров'я проєкту: все чудово!"),
    IDLE_OK,
  );
  const first = await unverifiedSpecialist(verified.session.send("Extract і перейменуй картку A"), "duplicate_results");
  assert.match(first.message, /✅ Підтверджено читанням картки/, "what Trello confirmed is still reported");
  assert.ok(!first.message.includes("все чудово"));
  assert.equal(verified.sendCalls.length, 1);
  verified.session.close();

  // failed write + missing specialist result
  const failed = await open(roster());
  failed.push(
    created(), sentTo(),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", true),
    msg("Готово!"),
    IDLE_OK,
  );
  const second = await unverifiedSpecialist(failed.session.send("Extract і перейменуй картку A"), "missing_result");
  assert.match(second.message, /❌ Не виконано \(помилка інструмента\)/);
  assert.ok(!second.message.includes("Готово!"));
  failed.session.close();

  // unresolved write + unverified specialist: the #31 error still wins and carries the specialist notice
  const unresolved = await open(roster());
  unresolved.push(
    created(), sentTo(), childResult("ONE"), childResult("TWO"),
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    msg("Готово!"),
    IDLE_OK,
    msg("Точно готово!"),
    IDLE_OK,
  );
  const third = await rejection(unresolved.session.send("Extract і перейменуй картку A"));
  assert.ok(third instanceof DjonikUnverifiedMutationError);
  assert.match(third.message, /НЕ підтверджено: /);
  assert.match(third.message, /Результат Project Health від спеціаліста НЕ підтверджено/);
  assert.ok(!third.message.includes("Готово!") && !third.message.includes("Точно готово!"));
  assert.equal(unresolved.sendCalls.length, 2, "exactly one nudge; the write is never replayed");
  unresolved.session.close();
});

test("#32 20b: a budget stop during/after a mutation is reported from tool events — never as success, never replayed", async () => {
  const noResult = await open(roster());
  noResult.push(
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    msg("Готово, оновив!"),
    idleWith("budget_reached"),
  );
  const first = await rejection(noResult.session.send("Перейменуй картку A"));
  assert.ok(first instanceof DjonikTurnIncompleteError);
  assert.match(first.message, /НЕ підтверджено/);
  assert.ok(!first.message.includes("Готово, оновив!"));
  assert.equal(noResult.sendCalls.length, 1, "no nudge, no resend, no replayed write");
  noResult.session.close();

  // A write whose read is still owed (nudgeable) but whose turn stopped at the budget: never nudged/resumed.
  const awaitingRead = await open(roster());
  awaitingRead.push(
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    msg("Готово!"),
    idleWith("budget_reached"),
  );
  const awaiting = await rejection(awaitingRead.session.send("Перейменуй картку A"));
  assert.ok(awaiting instanceof DjonikTurnIncompleteError);
  assert.match(awaiting.message, /НЕ підтверджено/);
  assert.equal(awaitingRead.sendCalls.length, 1, "a budget-stopped turn is never re-prompted, even with a read owed");
  awaitingRead.session.close();

  const verifiedThenStopped = await open(roster());
  verifiedThenStopped.push(
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, CARD),
    msg("Готово, і ще..."),
    idleWith("budget_reached"),
  );
  const second = await rejection(verifiedThenStopped.session.send("Перейменуй картку A"));
  assert.ok(second instanceof DjonikTurnIncompleteError);
  assert.match(second.message, /✅ Підтверджено читанням картки/, "what Trello did confirm is still reported honestly");
  assert.equal(verifiedThenStopped.sendCalls.length, 1);
  verifiedThenStopped.session.close();

  const stoppedDuringNudge = await open(roster());
  stoppedDuringNudge.push(
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    msg("Готово!"),
    IDLE_OK,
    msg("Перечитую..."),
    idleWith("budget_reached"),
  );
  const third = await rejection(stoppedDuringNudge.session.send("Перейменуй картку A"));
  assert.ok(third instanceof DjonikTurnIncompleteError);
  assert.match(third.message, /НЕ підтверджено/);
  assert.equal(stoppedDuringNudge.sendCalls.length, 2, "the one bounded nudge only; nothing after the budget stop");
  stoppedDuringNudge.session.close();
});

test("#32 20c: a late specialist result after a mutation turn does not touch the next turn", async () => {
  const { session, push } = await open(roster());
  push(
    toolUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", title: "Card A" }),
    toolResult("w", false, CARD),
    toolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    toolResult("r", false, CARD),
    msg("Готово."),
    IDLE_OK,
  );
  assert.strictEqual(await session.send("Перейменуй картку A"), "Готово.");

  push(childResult("LATE HEALTH"), msg("Звичайна відповідь."), IDLE_OK);
  assert.strictEqual(await session.send("Дякую"), "Звичайна відповідь.");
  session.close();
});

// ---------------------------------------------------------------------------------------------
// 21–23. FIFO, no cross-turn leakage, telemetry attribution.
// ---------------------------------------------------------------------------------------------

test("#32 21: FIFO — an incomplete turn does not poison or overlap the queue", async () => {
  const { session, push, sendCalls } = await open();
  const p1 = rejection(session.send("Перше"));
  const p2 = session.send("Друге");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sendCalls.length, 1, "turn 2 must not start before turn 1 settles");

  push(msg("Working..."), idleWith("budget_reached"));
  assert.ok((await p1) instanceof DjonikTurnIncompleteError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sendCalls.length, 2);
  push(msg("ANSWER TWO"), IDLE_OK);
  assert.strictEqual(await p2, "ANSWER TWO");
  session.close();
});

test("#32 22: one turn's child state (unverified, duplicate, stopped) never leaks into another turn", async () => {
  const { session, push } = await open(roster());
  push(created(), sentTo(), childResult("ONE"), childResult("TWO"), childIdle("budget_reached"), msg("C1"), IDLE_OK);
  await unverifiedSpecialist(session.send("Extract?"), "duplicate_results");

  push(sentTo(), childResult("CLEAN"), childIdle("end_turn"), msg("C2"), IDLE_OK);
  const reply = await session.send("Ще Extract?");
  assert.ok(reply.startsWith("CLEAN") && !reply.includes("C2") && !reply.includes("ONE"));
  session.close();
});

test("#32 23: telemetry stays attributed to the visible turn that produced it, across an incomplete turn", async () => {
  const usage = (input: number, cost: string) => ({
    type: "session.usage",
    usage: { input_tokens: input, cache_creation: {}, cache_read_input_tokens: 0, output_tokens: 1, list_cost: { amount: cost, currency: "USD" } },
  });
  const { session, push, telemetry } = await open();

  push({ type: "span.model_request_end" }, usage(10, "100"), msg("A"), IDLE_OK);
  await session.send("A");

  // Turn B stops at the budget WITHOUT any usage snapshot.
  push({ type: "span.model_request_end" }, { type: "span.model_request_end" }, msg("partial"), idleWith("budget_reached"));
  await rejection(session.send("B"));

  push({ type: "span.model_request_end" }, usage(25, "260"), msg("C"), IDLE_OK);
  await session.send("C");

  assert.equal(telemetry.length, 3, "one record per visible turn, including the incomplete one");
  assert.deepEqual(telemetry.map((t) => t.modelIterations), [1, 2, 1]);
  assert.equal(telemetry[0].usage?.inputTokens, 10);
  assert.equal(telemetry[1].usage, null, "no snapshot in turn B: no invented usage");
  assert.equal(telemetry[2].usage?.inputTokens, 15, "turn C's delta is against turn A's baseline, not re-counted from zero");
  assert.equal(telemetry[2].usage?.listCostAmount, "160");
  session.close();
});
