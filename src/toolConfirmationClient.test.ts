import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionTimeoutError, BadRequestError } from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  DjonikTracedTurnError,
  DjonikTurnIncompleteError,
  DjonikUnverifiedMutationError,
  type DjonikCustomToolExecutor,
  type DjonikTraceEvent,
} from "./djonikClient.js";
import { DENY_MESSAGES, ToolConfirmationError } from "./toolConfirmation.js";

// #39 Stage 3A — the Djonik client against provider-shaped `always_ask` sequences (SDK 0.125.0 shapes,
// permission-policies docs): gated tool-use event with `evaluated_permission: "ask"` → idle
// `requires_action{event_ids}` → `user.tool_confirmation{tool_use_id, result}` → echo → execution (allow) or a
// rejection tool result (deny). Zero network, zero inference.

function createScripted(options: { sendErrors?: unknown[] } = {}) {
  const sendCalls: Array<{ events: Array<Record<string, unknown>> }> = [];
  const sendErrors = [...(options.sendErrors ?? [])];
  const queue: unknown[] = [];
  const waiters: Array<(result: { value: unknown; done: boolean }) => void> = [];
  const push = (...events: unknown[]) => {
    for (const event of events) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    }
  };
  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<{ value: unknown; done: boolean }> =>
        queue.length > 0 ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise((resolve) => waiters.push(resolve)),
    }),
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "sesn_confirm" }),
        events: {
          stream: async () => stream,
          send: async (_id: string, params: { events: Array<Record<string, unknown>> }) => {
            sendCalls.push(params);
            const isConfirmation = params.events.some((event) => event.type === "user.tool_confirmation");
            if (isConfirmation && sendErrors.length > 0) {
              const error = sendErrors.shift();
              if (error !== undefined) throw error;
            }
            return undefined;
          },
        },
      },
    },
  } as unknown as Anthropic;
  const confirmationsSent = () => sendCalls.flatMap((call) => call.events.filter((event) => event.type === "user.tool_confirmation"));
  return { client, sendCalls, push, confirmationsSent };
}

const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const msg = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });
const ASK = { evaluated_permission: "ask", evaluation: { type: "always_ask" } };
const mcpAsk = (id: string, name = "trelloWriteCard", input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  type: "agent.mcp_tool_use",
  id,
  name,
  mcp_server_name: "trello",
  input,
  ...ASK,
  ...extra,
});
const mcpRead = (id: string, name = "trelloReadCard", input: Record<string, unknown> = {}) => ({
  type: "agent.mcp_tool_use",
  id,
  name,
  mcp_server_name: "trello",
  input,
  evaluated_permission: "allow",
  evaluation: { type: "always_allow" },
});
const mcpResult = (id: string, card?: Record<string, unknown>, isError = false) => ({
  type: "agent.mcp_tool_result",
  id: `${id}_r`,
  mcp_tool_use_id: id,
  is_error: isError,
  content: [{ type: "text", text: card ? JSON.stringify(card) : "{}" }],
});
const builtInAsk = (id: string, name: "write" | "edit", input: Record<string, unknown> = {}) => ({ type: "agent.tool_use", id, name, input, ...ASK });
const builtInRead = (id: string) => ({ type: "agent.tool_use", id, name: "read", input: { file_path: "/mnt/memory/djonik/rhythm.md" }, evaluated_permission: "allow" });
const toolResult = (id: string, isError = false) => ({ type: "agent.tool_result", id: `${id}_r`, tool_use_id: id, is_error: isError, content: [{ type: "text", text: "ok" }] });
const echo = (toolUseId: string, result: "allow" | "deny") => ({ type: "user.tool_confirmation", id: `echo_${toolUseId}`, tool_use_id: toolUseId, result });
const requiresAction = (ids: unknown[]) => ({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ids } });
const customUse = (id: string) => ({ type: "agent.custom_tool_use", id, name: "trello_work_history", input: { window: { kind: "this_week" }, scope: { kind: "board" } } });

const DUE = "2026-09-21T21:30:00.000Z";
const CARD = { id: "card_A", name: "Card A", due: DUE };

async function open(executor?: DjonikCustomToolExecutor, sendErrors?: unknown[]) {
  const scripted = createScripted({ sendErrors });
  const traces: DjonikTraceEvent[] = [];
  const session = await connectToDjonik(scripted.client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event), undefined, "telegram", executor);
  return { ...scripted, session, traces };
}

// --- Daniel's turns: ALLOW is permission to attempt, never verification ---------------------------------------

test("human Trello write: confirmation → ALLOW → provider executes → #31 ledger → verification read → end_turn → verified reply", async () => {
  const { session, push, confirmationsSent, traces } = await open();
  push(
    mcpAsk("w1", "trelloWriteCard", { action: "update", cardId: "card_A", due: DUE }),
    requiresAction(["w1"]),
    echo("w1", "allow"),
    mcpResult("w1", CARD),
    mcpRead("r1", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpResult("r1", CARD),
    msg("Готово."),
    IDLE_OK,
  );
  const reply = await session.send("Онови дедлайн картки A");
  // The #23 wrapper owns the verified confirmation — derived from the same-card READ, not from the ALLOW.
  assert.equal(reply, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
  assert.deepEqual(confirmationsSent(), [{ type: "user.tool_confirmation", tool_use_id: "w1", result: "allow" }]);
  assert.deepEqual(traces.filter((t) => t.type === "tool_confirmation_sent"), [
    { type: "tool_confirmation_sent", toolName: "trelloWriteCard", decision: "allow", reason: "human_authority" },
  ]);
  session.close();
});

test("human Trello write ALLOWED but never verified: the confirmation does not count as verification (#31 still fails the turn)", async () => {
  const { session, push, confirmationsSent } = await open();
  push(
    mcpAsk("w1", "trelloWriteCard", { action: "update", cardId: "card_A", name: "Card A" }),
    requiresAction(["w1"]),
    echo("w1", "allow"),
    mcpResult("w1", { id: "card_A", name: "Card A" }),
    msg("Готово, оновив."),
    IDLE_OK,
    // The single corrective nudge (#31) — the model still does not read the card.
    msg("Так, усе оновлено."),
    IDLE_OK,
  );
  await assert.rejects(session.send("Перейменуй картку A"), DjonikUnverifiedMutationError);
  assert.equal(confirmationsSent().length, 1);
  session.close();
});

test("human Memory write/edit: confirmation → ALLOW → native tool result → normal reply (Memory semantics unchanged)", async () => {
  const { session, push, confirmationsSent } = await open();
  push(
    builtInAsk("m1", "write", { file_path: "/mnt/memory/djonik/commitments/extract/feedback.md", content: "…" }),
    requiresAction(["m1"]),
    echo("m1", "allow"),
    toolResult("m1"),
    builtInAsk("m2", "edit", { file_path: "/mnt/memory/djonik/commitments/extract/feedback.md" }),
    requiresAction(["m2"]),
    echo("m2", "allow"),
    toolResult("m2"),
    msg("Записав."),
    IDLE_OK,
  );
  assert.equal(await session.send("ок, перевіримо в четвер"), "Записав.");
  assert.deepEqual(confirmationsSent().map((event) => [event.tool_use_id, event.result]), [["m1", "allow"], ["m2", "allow"]]);
  session.close();
});

test("human turn: text before a confirmation pause is provisional; only the fresh final message is the reply", async () => {
  const { session, push } = await open();
  push(msg("Зараз оновлю…"), builtInAsk("m1", "write"), requiresAction(["m1"]), echo("m1", "allow"), toolResult("m1"), msg("Записав."), IDLE_OK);
  assert.equal(await session.send("запам'ятай"), "Записав.");
  session.close();
});

// --- Autonomous turns: DENY before execution -------------------------------------------------------------

test("rhythm turn → trelloWriteCard confirmation → DENY; the mutation never executes; no #31 outcome; attempt recorded", async () => {
  const { session, push, confirmationsSent, traces } = await open();
  push(
    mcpRead("r0", "trelloReadBoard"),
    mcpResult("r0"),
    mcpAsk("w1", "trelloWriteCard", { action: "update", cardId: "card_A", due: DUE }),
    requiresAction(["w1"]),
    echo("w1", "deny"),
    // Docs: a denied tool does not run; the agent receives a rejection tool result.
    mcpResult("w1", undefined, true),
    msg("Не можу змінювати дошку в автоматичному ході."),
    IDLE_OK,
  );
  const traced = await session.sendTraced([{ type: "text", text: "[Робочий ритм · автоматичний хід …]" }], "rhythm_ritual");
  assert.deepEqual(confirmationsSent(), [
    { type: "user.tool_confirmation", tool_use_id: "w1", result: "deny", deny_message: DENY_MESSAGES.autonomous_read_only },
  ]);
  assert.equal(confirmationsSent().some((event) => event.result === "allow"), false, "never allow in an autonomous turn");
  // No DjonikUnverifiedMutationError, no mutation report: a denied call is not a mutation attempt for #31.
  assert.equal(traced.reply, "Не можу змінювати дошку в автоматичному ході.");
  assert.equal(traces.some((t) => t.type === "write_unverified_failure" || t.type === "verification_nudge_sent"), false);
  assert.equal(traced.autonomousMutationAttempt, true);
  assert.deepEqual(traced.confirmations, [{ kind: "mcp", name: "trelloWriteCard", decision: "deny", reason: "autonomous_read_only" }]);
  assert.doesNotMatch(JSON.stringify(traced), /card_A|2026-09-21/, "content-free: no tool input in the trace");
  session.close();
});

test("rhythm turn → built-in write and edit (Memory) → DENY before execution", async () => {
  for (const name of ["write", "edit"] as const) {
    const { session, push, confirmationsSent } = await open();
    push(builtInAsk("m1", name, { file_path: "/mnt/memory/djonik/plans/week.md" }), requiresAction(["m1"]), echo("m1", "deny"), toolResult("m1", true), msg("План — лише пропозиція."), IDLE_OK);
    const traced = await session.sendTraced([{ type: "text", text: "[Робочий ритм …]" }], "rhythm_exception");
    assert.deepEqual(confirmationsSent().map((event) => [event.tool_use_id, event.result]), [["m1", "deny"]], name);
    assert.equal(traced.autonomousMutationAttempt, true);
    assert.deepEqual(traced.confirmations, [{ kind: "builtin", name, decision: "deny", reason: "autonomous_read_only" }]);
    session.close();
  }
});

test("read-only rhythm turn: no confirmations, reads and trello_work_history work, end_turn completes normally", async () => {
  const executor: DjonikCustomToolExecutor = async () => ({ isError: false, content: JSON.stringify({ answer_text: "Факти тижня." }) });
  const { session, push, sendCalls } = await open(executor);
  push(builtInRead("b1"), toolResult("b1"), mcpRead("r1", "trelloReadBoard"), mcpResult("r1"), customUse("c1"), requiresAction(["c1"]), msg("Бриф."), IDLE_OK);
  const traced = await session.sendTraced([{ type: "text", text: "[Робочий ритм …]" }], "rhythm_ritual");
  assert.equal(traced.autonomousMutationAttempt, false);
  assert.deepEqual(traced.confirmations, []);
  assert.equal(traced.reply, "Факти тижня.\n\n---\nPM-висновок:\nБриф.");
  assert.equal(sendCalls.filter((call) => call.events.some((e) => e.type === "user.tool_confirmation")).length, 0);
  session.close();
});

test("a failed autonomous turn still reports its denied attempt (DjonikTracedTurnError)", async () => {
  const { session, push } = await open();
  push(mcpAsk("w1"), requiresAction(["w1"]), echo("w1", "deny"), { type: "session.status_idle", stop_reason: { type: "retries_exhausted" } });
  const error = await session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual").then(
    () => assert.fail("expected failure"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof DjonikTracedTurnError);
  assert.equal(error.autonomousMutationAttempt, true);
  assert.deepEqual(error.confirmations.map((c) => c.decision), ["deny"]);
  session.close();
});

// --- Repeated / ambiguous / unknown -------------------------------------------------------------------------

test("repeated requires_action naming the same confirmation id → one logical decision, one send", async () => {
  const { session, push, confirmationsSent } = await open();
  push(builtInAsk("m1", "write"), requiresAction(["m1"]), requiresAction(["m1"]), echo("m1", "allow"), requiresAction(["m1"]), toolResult("m1"), msg("Ок."), IDLE_OK);
  // The third idle (after the echo) contradicts the provider's own acknowledgement → fail closed.
  await assert.rejects(session.send("x"), ToolConfirmationError);
  assert.equal(confirmationsSent().length, 1, "never a second confirmation for one id");
  session.close();
});

test("repeated requires_action before the echo is a no-op; the turn completes", async () => {
  const { session, push, confirmationsSent } = await open();
  push(builtInAsk("m1", "write"), requiresAction(["m1"]), requiresAction(["m1"]), echo("m1", "allow"), toolResult("m1"), msg("Ок."), IDLE_OK);
  assert.equal(await session.send("x"), "Ок.");
  assert.equal(confirmationsSent().length, 1);
  session.close();
});

test("two distinct confirmation ids in one idle → one request carrying both decisions", async () => {
  const { session, push, sendCalls } = await open();
  push(builtInAsk("m1", "write"), builtInAsk("m2", "edit"), requiresAction(["m1", "m2"]), echo("m1", "allow"), echo("m2", "allow"), toolResult("m1"), toolResult("m2"), msg("Ок."), IDLE_OK);
  assert.equal(await session.send("x"), "Ок.");
  const confirmationCalls = sendCalls.filter((call) => call.events.some((e) => e.type === "user.tool_confirmation"));
  assert.equal(confirmationCalls.length, 1);
  assert.deepEqual(confirmationCalls[0].events.map((e) => e.tool_use_id), ["m1", "m2"]);
  session.close();
});

test("an idle naming a confirmation plus an unknown id is unsupported: nothing is confirmed, the turn is incomplete", async () => {
  const { session, push, confirmationsSent } = await open();
  push(builtInAsk("m1", "write"), requiresAction(["m1", "sevt_unknown"]));
  await assert.rejects(session.send("x"), DjonikTurnIncompleteError);
  assert.equal(confirmationsSent().length, 0);
  session.close();
});

test("malformed blocking lists with a known confirmation id fail closed (duplicate, empty, non-string)", async () => {
  for (const ids of [["m1", "m1"], ["m1", ""], ["m1", 7]]) {
    const { session, push, confirmationsSent } = await open();
    push(builtInAsk("m1", "write"), requiresAction(ids));
    await assert.rejects(session.send("x"), DjonikTurnIncompleteError, JSON.stringify(ids));
    assert.equal(confirmationsSent().length, 0);
    session.close();
  }
});

test("an unknown blocking id with no known confirmation keeps the pre-Stage-3A incomplete behaviour", async () => {
  const { session, push, sendCalls } = await open();
  push(requiresAction(["sevt_unknown"]));
  await assert.rejects(session.send("x"), DjonikTurnIncompleteError);
  assert.equal(sendCalls.length, 1, "only the user.message");
  session.close();
});

test("a gated tool outside the reviewed set is denied even in Daniel's turn (unknown tool / not a reviewed mutator)", async () => {
  const { session, push, confirmationsSent } = await open();
  push(mcpAsk("x1", "trelloWriteList"), mcpAsk("x2", "trelloReadCard"), requiresAction(["x1", "x2"]), echo("x1", "deny"), echo("x2", "deny"), msg("Не вийшло."), IDLE_OK);
  assert.equal(await session.send("x"), "Не вийшло.");
  assert.deepEqual(confirmationsSent().map((e) => [e.tool_use_id, e.result, e.deny_message]), [
    ["x1", "deny", DENY_MESSAGES.unreviewed_tool],
    ["x2", "deny", DENY_MESSAGES.unreviewed_tool],
  ]);
  session.close();
});

test("an unknown future Trello tool (inherits r27's always_ask default) is never auto-allowed — not even for Daniel", async () => {
  for (const origin of ["user_message", "rhythm_ritual"] as const) {
    const { session, push, confirmationsSent } = await open();
    // `evaluation` names the policy that produced `ask`: the inherited default, not a per-tool override.
    push(mcpAsk("f1", "trelloFutureTool", { anything: true }), requiresAction(["f1"]), echo("f1", "deny"), mcpResult("f1", undefined, true), msg("Не можу."), IDLE_OK);
    const traced = await session.sendTraced([{ type: "text", text: "x" }], origin);
    assert.deepEqual(confirmationsSent(), [{ type: "user.tool_confirmation", tool_use_id: "f1", result: "deny", deny_message: DENY_MESSAGES.unreviewed_tool }], origin);
    assert.deepEqual(traced.confirmations, [{ kind: "mcp", name: "trelloFutureTool", decision: "deny", reason: "unreviewed_tool" }]);
    session.close();
  }
});

test("a cross-posted subagent request is denied and routed with session_thread_id; an `auto` evaluation is denied as drift", async () => {
  const { session, push, confirmationsSent } = await open();
  push(
    mcpAsk("s1", "trelloWriteCard", {}, { session_thread_id: "sth_ph" }),
    mcpAsk("a1", "trelloWriteCard", {}, { evaluation: { type: "auto", evaluated_permission: { type: "ask", reason_code: "indeterminate" } } }),
    requiresAction(["s1", "a1"]),
    msg("Ок."),
    IDLE_OK,
  );
  assert.equal(await session.send("x"), "Ок.");
  assert.deepEqual(confirmationsSent(), [
    { type: "user.tool_confirmation", tool_use_id: "s1", result: "deny", deny_message: DENY_MESSAGES.subagent_thread, session_thread_id: "sth_ph" },
    { type: "user.tool_confirmation", tool_use_id: "a1", result: "deny", deny_message: DENY_MESSAGES.unexpected_evaluation },
  ]);
  session.close();
});

test("an ungated tool-use id named in requires_action is never confirmed (not an `ask` event)", async () => {
  const { session, push, confirmationsSent } = await open();
  push(mcpRead("r1"), requiresAction(["r1"]));
  await assert.rejects(session.send("x"), DjonikTurnIncompleteError);
  assert.equal(confirmationsSent().length, 0);
  session.close();
});

test("confirmation send: permanent rejection fails the turn visibly and is never resent", async () => {
  const { session, push, confirmationsSent } = await open(undefined, [new BadRequestError(400, undefined, "x", new Headers())]);
  push(mcpAsk("w1"), requiresAction(["w1"]));
  await assert.rejects(session.send("x"), /rejected a tool confirmation/);
  assert.equal(confirmationsSent().length, 1);
  session.close();
});

test("confirmation send: ambiguous outcome fails the turn honestly and creates no duplicate confirmation", async () => {
  const { session, push, confirmationsSent } = await open(undefined, [new APIConnectionTimeoutError()]);
  push(mcpAsk("w1"), requiresAction(["w1"]));
  await assert.rejects(session.send("x"), /may or may not have been applied/);
  assert.equal(confirmationsSent().length, 1);
  // A later status naming the same id is not a licence to resend.
  push(requiresAction(["w1"]));
  await assert.rejects(session.send("y"), /does not resend/);
  assert.equal(confirmationsSent().length, 1);
  session.close();
});

test("a provider echo that contradicts the client's decision fails the turn visibly", async () => {
  const { session, push } = await open();
  push(mcpAsk("w1"), requiresAction(["w1"]), echo("w1", "allow"));
  await assert.rejects(session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual"), (error: unknown) => {
    assert.ok(error instanceof DjonikTracedTurnError);
    assert.ok(error.error instanceof ToolConfirmationError);
    assert.equal(error.autonomousMutationAttempt, true);
    return true;
  });
  session.close();
});

test("late/stale: a request first seen in an autonomous turn stays DENY when a later human turn's idle names it", async () => {
  const { session, push, confirmationsSent } = await open();
  // The autonomous turn observes the gated call, then its stream ends that turn without the pause.
  push(builtInAsk("m1", "write"), msg("Бриф."), IDLE_OK);
  await session.sendTraced([{ type: "text", text: "[ритм]" }], "rhythm_ritual");
  // Daniel's next turn: the stale request surfaces now. The decision was made once, under autonomous authority.
  push(requiresAction(["m1"]), echo("m1", "deny"), msg("Ок."), IDLE_OK);
  assert.equal(await session.send("привіт"), "Ок.");
  assert.deepEqual(confirmationsSent().map((e) => [e.tool_use_id, e.result]), [["m1", "deny"]]);
  session.close();
});

// --- Coexistence with #40 custom tools ------------------------------------------------------------------------

test("mixed idle: one confirmation + one trello_work_history call → both settled once, never confused", async () => {
  let executions = 0;
  const executor: DjonikCustomToolExecutor = async () => (executions++, { isError: false, content: JSON.stringify({ answer_text: "Факти." }) });
  const { session, push, sendCalls } = await open(executor);
  push(customUse("c1"), builtInAsk("m1", "write"), requiresAction(["c1", "m1"]), requiresAction(["c1", "m1"]), echo("m1", "allow"), toolResult("m1"), msg("Записав."), IDLE_OK);
  const reply = await session.send("x");
  assert.equal(executions, 1, "custom tool executed once");
  const confirmations = sendCalls.flatMap((c) => c.events).filter((e) => e.type === "user.tool_confirmation");
  const results = sendCalls.flatMap((c) => c.events).filter((e) => e.type === "user.custom_tool_result");
  assert.deepEqual(confirmations.map((e) => e.tool_use_id), ["m1"], "the custom tool id is never sent as a confirmation");
  assert.deepEqual(results.map((e) => e.custom_tool_use_id), ["c1"], "the confirmation id is never sent as a custom result");
  assert.equal(reply, "Факти.\n\n---\nPM-висновок:\nЗаписав.");
  session.close();
});

test("mixed idle in an autonomous turn: the read-only custom tool runs, the write is denied", async () => {
  const executor: DjonikCustomToolExecutor = async () => ({ isError: false, content: JSON.stringify({ answer_text: "Факти." }) });
  const { session, push, sendCalls } = await open(executor);
  push(customUse("c1"), mcpAsk("w1"), requiresAction(["w1", "c1"]), echo("w1", "deny"), mcpResult("w1", undefined, true), msg("Бриф."), IDLE_OK);
  const traced = await session.sendTraced([{ type: "text", text: "[ритм]" }], "rhythm_ritual");
  const events = sendCalls.flatMap((c) => c.events);
  assert.deepEqual(events.filter((e) => e.type === "user.tool_confirmation").map((e) => [e.tool_use_id, e.result]), [["w1", "deny"]]);
  assert.deepEqual(events.filter((e) => e.type === "user.custom_tool_result").map((e) => e.custom_tool_use_id), ["c1"]);
  assert.equal(traced.autonomousMutationAttempt, true);
  session.close();
});

test("an idle naming a confirmation plus an unobserved custom-looking id fails closed without executing anything", async () => {
  let executions = 0;
  const { session, push, sendCalls } = await open(async () => (executions++, { isError: false, content: "{}" }));
  push(builtInAsk("m1", "write"), requiresAction(["m1", "c_never_observed"]));
  await assert.rejects(session.send("x"), DjonikTurnIncompleteError);
  assert.equal(executions, 0);
  assert.equal(sendCalls.length, 1);
  session.close();
});
