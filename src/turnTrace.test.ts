import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  DjonikTracedTurnError,
  DjonikTurnIncompleteError,
  DjonikUnverifiedMutationError,
  type DjonikCustomToolExecutor,
  type DjonikTurnTelemetry,
} from "./djonikClient.js";
import { isClockHeader } from "./turnClock.js";

// #39 Stage 2 — `sendTraced`: the same serving Session, FIFO queue and turn pipeline as `send`/`sendOrdered`,
// returning the final reply, the Session that produced it and the turn's content-free tool uses.
// Scripted official-shape events; zero network, zero inference.

function createScripted(withIds = false) {
  const sendCalls: unknown[] = [];
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
        create: async () => ({ id: "sesn_traced" }),
        events: {
          stream: async () => stream,
          send: async (_id: string, params: unknown) => {
            sendCalls.push(params);
            return withIds ? { data: [{ id: `evt_user_${sendCalls.length}`, type: "user.message" }] } : undefined;
          },
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls, push };
}

const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const msg = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });
const mcpUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "agent.mcp_tool_use", id, name, mcp_server_name: "trello", input });
const mcpResult = (id: string, card?: Record<string, unknown>) => ({
  type: "agent.mcp_tool_result",
  id: `${id}_r`,
  mcp_tool_use_id: id,
  is_error: false,
  content: card ? [{ type: "text", text: JSON.stringify(card) }] : [{ type: "text", text: "{}" }],
});
const builtIn = (id: string, name: string, input: Record<string, unknown>) => ({ type: "agent.tool_use", id, name, input });
const customUse = (id: string) => ({ type: "agent.custom_tool_use", id, name: "trello_work_history", input: { window: { kind: "this_week" }, scope: { kind: "board" } } });
const requiresAction = (ids: string[]) => ({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ids } });

async function open(executor?: DjonikCustomToolExecutor, withIds = false, onTurnTelemetry?: (record: DjonikTurnTelemetry) => void) {
  const scripted = createScripted(withIds);
  const session = await connectToDjonik(scripted.client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, onTurnTelemetry, "telegram", executor);
  return { ...scripted, session };
}

test("#46 telemetry records content-free paths, verified card identity and visible turn index", async () => {
  const records: DjonikTurnTelemetry[] = [];
  const { session, push, sendCalls } = await open(undefined, false, (record) => records.push(record));
  const card = { id: "card_A", name: "A" };
  push(
    builtIn("s", "read", { file_path: "/workspace/skills/planning-and-focus/SKILL.md" }),
    builtIn("m", "read", { file_path: "/mnt/memory/djonik/priorities.md" }),
    builtIn("e", "edit", { file_path: "/mnt/memory/djonik/projects/seqthera.md", old_string: "SECRET" }),
    mcpUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", name: "A" }),
    mcpResult("w", card), msg("SECRET REPLY"), IDLE_OK,
  );
  const first = session.send("SECRET USER");
  await new Promise((resolve) => setImmediate(resolve));
  push(mcpUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }), mcpResult("r", card), msg("verified"), IDLE_OK);
  await first;
  assert.equal(sendCalls.length, 2, "nudge is not a second visible turn");
  const firstTrace = records[0].decisionTrace!;
  assert.equal(firstTrace.sessionTurnIndex, 1);
  assert.deepEqual(firstTrace.skillPaths, ["planning-and-focus"]);
  assert.deepEqual(firstTrace.memoryPathsRead, ["priorities.md"]);
  assert.deepEqual(firstTrace.memoryPathsWritten, ["projects/seqthera.md"]);
  assert.deepEqual(firstTrace.cardIdsRead, ["card_A"]);
  assert.deepEqual(firstTrace.mutations, [{ cardIds: ["card_A"], status: "verified" }]);
  assert.doesNotMatch(JSON.stringify(firstTrace), /SECRET|\/mnt\/memory/);
  push(msg("second"), IDLE_OK);
  await session.send("another user turn");
  assert.equal(records[1].decisionTrace?.sessionTurnIndex, 2);
  session.close();
});

test("traced turn: final reply, the producing Session id, and every MCP / built-in / custom tool name — content-free", async () => {
  const executor: DjonikCustomToolExecutor = async () => ({ isError: false, content: JSON.stringify({ answer_text: "Цього тижня на дошці: одна картка в Done." }) });
  const { session, push } = await open(executor);
  push(
    builtIn("b1", "read", { file_path: "/mnt/memory/djonik/rhythm.md" }),
    mcpUse("m1", "trelloReadBoard", { action: "list_cards", secretish: "CLIENT NAME" }),
    mcpResult("m1"),
    customUse("c1"),
    requiresAction(["c1"]),
    msg("Бриф: фокус — Seqthera."),
    IDLE_OK,
  );
  const traced = await session.sendTraced([{ type: "text", text: "[Робочий ритм · автоматичний хід …]" }], "rhythm_ritual");
  assert.equal(traced.sessionId, "sesn_traced");
  assert.equal(traced.sessionId, session.sessionId);
  assert.deepEqual(traced.toolUses, [
    { kind: "builtin", name: "read" },
    { kind: "mcp", name: "trelloReadBoard" },
    { kind: "custom", name: "trello_work_history" },
  ]);
  assert.doesNotMatch(JSON.stringify(traced.toolUses), /CLIENT NAME|rhythm\.md|this_week/, "names only, never inputs");
  // #36 relay and #40 continuation are the shared pipeline's: the verified answer_text leads the reply.
  assert.equal(traced.reply, "Цього тижня на дошці: одна картка в Done.\n\n---\nPM-висновок:\nБриф: фокус — Seqthera.");
  session.close();
});

test("traced turn: a Memory write/edit is listed as a built-in tool (the guard sees it)", async () => {
  const { session, push } = await open();
  push(builtIn("w", "write", { file_path: "/mnt/memory/djonik/x.md", content: "secret" }), builtIn("e", "edit", {}), msg("Ок."), IDLE_OK);
  const traced = await session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual");
  assert.deepEqual(traced.toolUses, [
    { kind: "builtin", name: "write" },
    { kind: "builtin", name: "edit" },
  ]);
  session.close();
});

test("#31 kept: the verification-nudge rerun belongs to the same turn and its tools are listed too", async () => {
  const card = { id: "card_A", name: "A", due: null };
  const { session, push, sendCalls } = await open();
  push(mcpUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", name: "A" }), mcpResult("w", card), msg("Готово."), IDLE_OK);
  const pending = session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual");
  await new Promise((resolve) => setImmediate(resolve));
  push(mcpUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }), mcpResult("r", card), msg("Підтверджено."), IDLE_OK);
  const traced = await pending;
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge");
  assert.deepEqual(traced.toolUses.map((use) => use.name), ["trelloWriteCard", "trelloReadCard"]);
  session.close();
});

test("a failed traced turn carries the Session id and the tools it used (unverified write, #31)", async () => {
  const { session, push } = await open();
  push(mcpUse("w", "trelloWriteCard", { action: "update", cardId: "card_A", name: "A" }), mcpResult("w", { id: "card_A", name: "A" }), msg("Готово."), IDLE_OK);
  const pending = session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual");
  await new Promise((resolve) => setImmediate(resolve));
  push(msg("Готово."), IDLE_OK); // the nudge is answered without a read
  const error = await pending.then(
    () => assert.fail("must reject"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof DjonikTracedTurnError);
  assert.ok(error.error instanceof DjonikUnverifiedMutationError);
  assert.equal(error.sessionId, "sesn_traced");
  assert.deepEqual(error.toolUses, [{ kind: "mcp", name: "trelloWriteCard" }]);
  session.close();
});

test("#32 kept: an incomplete traced turn (non-custom requires_action) is never a reply", async () => {
  const { session, push } = await open();
  push(mcpUse("x", "trelloWriteCard", {}), msg("Чекаю підтвердження…"), requiresAction(["x"]));
  const error = await session.sendTraced([{ type: "text", text: "x" }], "rhythm_ritual").then(
    () => assert.fail("must reject"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof DjonikTracedTurnError);
  assert.ok(error.error instanceof DjonikTurnIncompleteError);
  assert.equal((error.error as DjonikTurnIncompleteError).stopKind, "requires_action");
  session.close();
});

test("one FIFO queue: send, sendTraced and sendOrdered run strictly in call order; send/sendOrdered still return plain strings", async () => {
  const { session, push, sendCalls } = await open();
  const blocks = () => sendCalls.map((call) => (call as { events: Array<{ content: Array<{ text: string }> }> }).events[0].content);
  // #41: Daniel's turns (A, C) open with the clock header; the autonomous turn B does not.
  const texts = () => blocks().map((content) => content.filter((block) => !isClockHeader(block.text))[0].text);
  const a = session.send("A");
  const b = session.sendTraced([{ type: "text", text: "B" }], "rhythm_ritual");
  const c = session.sendOrdered([{ type: "text", text: "C" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(texts(), ["A"], "single-flight: B waits for A");
  push(mcpUse("m", "trelloReadCard", {}), mcpResult("m"), msg("reply A"), IDLE_OK, msg("reply B"), IDLE_OK, msg("reply C"), IDLE_OK);
  assert.equal(await a, "reply A");
  const traced = await b;
  assert.equal(await c, "reply C");
  assert.deepEqual(texts(), ["A", "B", "C"]);
  assert.deepEqual(blocks().map((content) => isClockHeader(content[0].text)), [true, false, true]);
  assert.deepEqual(
    traced,
    { reply: "reply B", sessionId: "sesn_traced", toolUses: [], confirmations: [], autonomousMutationAttempt: false },
    "A's tool use never leaks into B",
  );
  session.close();
});

test("an earlier turn's late tail (quarantined before this turn's own echo, #32) is not listed as this turn's tool use", async () => {
  const { session, push } = await open(undefined, true);
  push({ type: "user.message", id: "evt_user_1", content: [] }, msg("one"), IDLE_OK);
  assert.equal(await session.send("first"), "one");
  push(mcpUse("late", "trelloWriteCard", {}), { type: "user.message", id: "evt_user_2", content: [] }, msg("two"), IDLE_OK);
  const traced = await session.sendTraced([{ type: "text", text: "second" }], "rhythm_ritual");
  assert.equal(traced.reply, "two");
  assert.deepEqual(traced.toolUses, []);
  session.close();
});
