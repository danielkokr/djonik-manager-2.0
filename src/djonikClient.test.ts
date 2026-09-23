import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  createTurnTelemetryCollector,
  computeKyivDueFacts,
  extractVerifiedDueFromTrelloReadContent,
  buildVerifiedDueConfirmation,
  finalizeDueDateReply,
  DjonikSessionDeadError,
  DjonikSpecialistUnverifiedError,
  DjonikUnverifiedMutationError,
  PROJECT_HEALTH_SPECIALIST_AGENT_ID,
  resolveProjectHealthSpecialistName,
  type DjonikTraceEvent,
  type DjonikTurnTelemetry,
} from "./djonikClient.js";

/**
 * Minimal fake of the Anthropic client surface `connectToDjonik` touches.
 * `events` is the scripted sequence the fake stream yields for the one
 * `send()` call each test makes; `createCalls` records every
 * `beta.sessions.create` invocation for assertions on session wiring.
 * `sessionAgent`, when given, is returned as the create response's resolved
 * `session.agent` (#28: the coordinator roster snapshot); omitted, the response
 * carries only an id, exactly as before.
 */
function createFakeClient(events: unknown[], sessionAgent?: unknown): { client: Anthropic; createCalls: unknown[]; sendCalls: unknown[] } {
  const createCalls: unknown[] = [];
  const sendCalls: unknown[] = [];

  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () => {
          if (index >= events.length) return { value: undefined, done: true };
          return { value: events[index++], done: false };
        },
      };
    },
  };

  const client = {
    beta: {
      sessions: {
        create: async (params: unknown) => {
          createCalls.push(params);
          return sessionAgent === undefined ? { id: "session_test123" } : { id: "session_test123", agent: sessionAgent };
        },
        events: {
          stream: async () => stream,
          send: async (_sessionId: string, params: unknown) => {
            sendCalls.push(params);
          },
        },
      },
    },
  } as unknown as Anthropic;

  return { client, createCalls, sendCalls };
}

/**
 * A fake client whose event stream is driven entirely by the test (`push`),
 * instead of a fixed pre-scripted array consumed immediately. This is the
 * seam needed to prove FIFO serialization of concurrent `send()` calls
 * (#25 live-validation blocker): `createFakeClient` above always resolves
 * `iterator.next()` right away, so two overlapping `send()` calls could race
 * through it without ever revealing a serialization bug. Here, `next()`
 * genuinely suspends until the test calls `push(event)`, so a test can
 * assert exactly how many provider `events.send` calls have happened at any
 * point while a turn is deliberately held open — the same shape as two real
 * Managed Agent turns racing on the wire.
 */
function createStreamedFakeClient(sessionAgent?: unknown): { client: Anthropic; createCalls: unknown[]; sendCalls: unknown[]; push: (event: unknown) => void } {
  const createCalls: unknown[] = [];
  const sendCalls: unknown[] = [];
  const queue: unknown[] = [];
  const waiters: Array<(event: unknown) => void> = [];

  function push(event: unknown): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(event);
    } else {
      queue.push(event);
    }
  }

  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<{ value: unknown; done: boolean }> => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          return new Promise((resolve) => {
            waiters.push((event) => resolve({ value: event, done: false }));
          });
        },
      };
    },
  };

  const client = {
    beta: {
      sessions: {
        create: async (params: unknown) => {
          createCalls.push(params);
          return sessionAgent === undefined ? { id: "session_test123" } : { id: "session_test123", agent: sessionAgent };
        },
        events: {
          stream: async () => stream,
          send: async (_sessionId: string, params: unknown) => {
            sendCalls.push(params);
          },
        },
      },
    },
  } as unknown as Anthropic;

  return { client, createCalls, sendCalls, push };
}

/** Lets any currently-resolved microtasks (promise `.then` chains already
 *  scheduled) run to completion before an assertion, without depending on a
 *  specific hop count — safer than a fixed number of `await Promise.resolve()`. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const MEMORY_INSTRUCTIONS =
  "Persistent PM memory across sessions. Write only durable, useful context: " +
  "stable work preferences, client/project facts, important decisions, recurring " +
  "patterns, PM lessons, plans the user has explicitly accepted (e.g. \"так, працюємо " +
  "за цим планом\"), and explicit personal/client commitments the user states (e.g. " +
  "\"я точно зроблю X до пʼятниці\"). Do not write every suggestion or provisional plan " +
  "as if it were accepted — only write an accepted plan or commitment when the user's " +
  "acceptance/commitment is actually explicit, not merely discussed. Do not store live " +
  "Trello/task state, transient chat, or anything trivial. An accepted plan or " +
  "commitment recorded here is historical/decision context, not live task state: fresh " +
  "external tool reads always outrank what is remembered here for current status. When " +
  "the user corrects or cancels an earlier accepted plan/commitment, update what is " +
  "remembered so the new version is current and the superseded one is no longer " +
  "presented as still active.";

const AGENT_MESSAGE = { type: "agent.message", content: [{ type: "text", text: "Готово." }] };
const IDLE = { type: "session.status_idle", stop_reason: { type: "end_turn" } };

function retryingError(message = "MCP server 'trello' initialize failed: retrying"): unknown {
  return { type: "session.error", error: { message, retry_status: { type: "retrying" } } };
}

function exhaustedError(message = "MCP server 'trello' initialize failed: retries exhausted"): unknown {
  return { type: "session.error", error: { message, retry_status: { type: "exhausted" } } };
}

function terminalError(message = "Session crashed"): unknown {
  return { type: "session.error", error: { message, retry_status: { type: "terminal" } } };
}

function mcpToolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  mcp_server_name = "trello",
): unknown {
  return { type: "agent.mcp_tool_use", id, name, mcp_server_name, input };
}

function mcpToolResult(
  mcp_tool_use_id: string,
  is_error = false,
  content?: Array<{ type: string; text?: string }>,
): unknown {
  return { type: "agent.mcp_tool_result", id: `${mcp_tool_use_id}_result`, mcp_tool_use_id, is_error, content };
}

/** A `trelloReadCard` result whose content is the tool's JSON payload, as the real
 *  Trello MCP server returns it — used to exercise the Issue #23 deterministic
 *  due-date/weekday backstop against a realistic same-card read result. */
function trelloCardReadContent(due: string): Array<{ type: string; text: string }> {
  return [{ type: "text", text: JSON.stringify({ id: "card_A", name: "Test card", due }) }];
}

/** A successful Trello result whose content is ONE card object as JSON (#31) — the shape a
 *  `trelloWriteCard` result / direct `trelloReadCard` (`get`) result must carry to be trusted. */
function cardContent(card: Record<string, unknown>): Array<{ type: string; text: string }> {
  return [{ type: "text", text: JSON.stringify(card) }];
}

test("turn telemetry emits content-free explicit-source usage delta with deterministic time", () => {
  const telemetry = createTurnTelemetryCollector("telegram", "session_test123", null, () => "2026-09-16T10:00:00.000Z");
  telemetry.recordModelIteration();
  telemetry.recordModelIteration();
  telemetry.recordMcpToolUse("trelloReadCard");
  telemetry.recordMcpToolUse("trelloSearch");
  telemetry.recordMcpResult();
  telemetry.recordMcpResult();
  telemetry.recordVerificationNudge();
  telemetry.recordBuiltInRead({ file_path: "/workspace/skills/daily-planning/SKILL.md", contents: "not retained" });
  telemetry.recordBuiltInRead({ file_path: "/mnt/memory/djonik-memory/preferences.md", contents: "not retained" });
  telemetry.recordUsage({
    input_tokens: 4,
    cache_creation: { ephemeral_5m_input_tokens: 12 },
    cache_read_input_tokens: 20,
    output_tokens: 6,
    list_cost: { amount: "7", currency: "USD" },
  });

  assert.deepEqual(telemetry.summary(), {
    recordedAt: "2026-09-16T10:00:00.000Z",
    source: "telegram",
    sessionId: "session_test123",
    usageScope: "turn_delta",
    modelIterations: 2,
    toolCalls: 2,
    toolNames: ["trelloReadCard", "trelloSearch"],
    mcpResults: 2,
    verificationNudges: 1,
    skillRead: true,
    memoryRead: true,
    hasImage: false,
    imageMimeType: null,
    imageByteSize: null,
    hasFile: false,
    fileMimeType: null,
    fileByteSize: null,
    fileNamePresent: null,
    sourceBlockCount: 0,
    textBlockCount: 0,
    imageBlockCount: 0,
    documentBlockCount: 0,
    usage: {
      inputTokens: 4,
      cacheCreationInputTokens: 12,
      cacheReadInputTokens: 20,
      outputTokens: 6,
      listCostAmount: "7",
      listCostCurrency: "USD",
    },
  });
});

test("cumulative session usage produces only the second visible turn delta", () => {
  const first = createTurnTelemetryCollector("telegram", "session_test123", null, () => "2026-09-16T10:00:00.000Z");
  first.recordUsage({
    input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 20 }, cache_read_input_tokens: 30,
    output_tokens: 40, list_cost: { amount: "50", currency: "USD" },
  });
  assert.deepEqual(first.summary().usage, {
    inputTokens: 10, cacheCreationInputTokens: 20, cacheReadInputTokens: 30, outputTokens: 40,
    listCostAmount: "50", listCostCurrency: "USD",
  });

  const second = createTurnTelemetryCollector("telegram", "session_test123", first.cumulativeUsage());
  second.recordUsage({
    input_tokens: 13, cache_creation: { ephemeral_5m_input_tokens: 25 }, cache_read_input_tokens: 38,
    output_tokens: 44, list_cost: { amount: "57", currency: "USD" },
  });
  assert.deepEqual(second.summary().usage, {
    inputTokens: 3, cacheCreationInputTokens: 5, cacheReadInputTokens: 8, outputTokens: 4,
    listCostAmount: "7", listCostCurrency: "USD",
  });
});

test("a new session starts with a zero usage baseline", () => {
  const telemetry = createTurnTelemetryCollector("telegram", "session_new");
  telemetry.recordUsage({
    input_tokens: 3, cache_creation: { ephemeral_1h_input_tokens: 5 }, cache_read_input_tokens: 8,
    output_tokens: 2, list_cost: { amount: "7", currency: "USD" },
  });
  assert.deepEqual(telemetry.summary().usage, {
    inputTokens: 3, cacheCreationInputTokens: 5, cacheReadInputTokens: 8, outputTokens: 2,
    listCostAmount: "7", listCostCurrency: "USD",
  });
});

test("connectToDjonik retains the cumulative baseline across two sends in one session", async () => {
  const telemetry: unknown[] = [];
  const { client } = createFakeClient([
    { type: "session.usage", usage: { input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 20 }, cache_read_input_tokens: 30, output_tokens: 40, list_cost: { amount: "50", currency: "USD" } } },
    AGENT_MESSAGE, IDLE,
    { type: "session.usage", usage: { input_tokens: 13, cache_creation: { ephemeral_5m_input_tokens: 25 }, cache_read_input_tokens: 38, output_tokens: 44, list_cost: { amount: "57", currency: "USD" } } },
    AGENT_MESSAGE, IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record), "telegram");

  await session.send("Перший turn");
  await session.send("Другий turn");

  assert.deepEqual((telemetry[1] as { usage: unknown }).usage, {
    inputTokens: 3, cacheCreationInputTokens: 5, cacheReadInputTokens: 8, outputTokens: 4,
    listCostAmount: "7", listCostCurrency: "USD",
  });
  session.close();
});

test("connectToDjonik attaches the Djonik Memory Store and Vault at session creation", async () => {
  const { client, createCalls } = createFakeClient([IDLE]);

  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    agent: "agent_x",
    environment_id: "env_x",
    vault_ids: ["vlt_x"],
    resources: [
      {
        type: "memory_store",
        memory_store_id: "memstore_x",
        access: "read_write",
        instructions: MEMORY_INSTRUCTIONS,
      },
    ],
  });
  assert.equal(session.sessionId, "session_test123");

  session.close();
});

test("connectToDjonik supports a read-only Memory mount and whole-Session validation budget", async () => {
  const { client, createCalls } = createFakeClient([IDLE]);
  const session = await connectToDjonik(
    client,
    "agent_validation",
    "env_x",
    "memstore_x",
    "vlt_x",
    undefined,
    undefined,
    "unknown",
    undefined,
    {
      memoryAccess: "read_only",
      maxListCostUsdCents: "80",
    },
  );

  const created = createCalls[0] as { resources: Array<{ access: string }>; budget: unknown; title?: unknown; metadata?: unknown };
  assert.equal(created.resources[0]?.access, "read_only");
  assert.deepEqual(created.budget, { type: "limit", max_list_cost: { amount: "80", currency: "USD" } });
  assert.equal(created.title, undefined);
  assert.equal(created.metadata, undefined);
  session.close();
});

test("a retrying session.error does not abort a turn that goes on to succeed", async () => {
  const { client } = createFakeClient([retryingError(), AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Привіт");

  assert.equal(reply, "Готово.");
  session.close();
});

test("an exhausted session.error with no assistant message still fails the turn", async () => {
  const { client } = createFakeClient([exhaustedError(), IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send("Привіт"), /no text reply/);
  session.close();
});

test("a terminal session.error immediately fails the turn", async () => {
  const { client } = createFakeClient([retryingError(), terminalError("Session crashed"), AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send("Привіт"), /Session crashed/);
  session.close();
});

test("a Trello write followed by a Trello read in the same turn returns the reply as-is", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", name: "Card A" }),
    mcpToolResult("call_1", false, cardContent({ id: "card_A", name: "Card A" })),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A", name: "Card A" })),
    AGENT_MESSAGE,
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Створи картку");

  assert.equal(reply, "Готово.");
  assert.equal(sendCalls.length, 1, "no corrective nudge should be sent when verification already happened");
  session.close();
});

test("a Trello write with no verifying read triggers exactly one corrective nudge, then succeeds if it verifies", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write only, agent claims success without reading back.
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", name: "Card A" }),
    mcpToolResult("call_1"),
    AGENT_MESSAGE,
    IDLE,
    // Corrective turn: agent verifies with a read, then replies again.
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A", name: "Card A" })),
    { type: "agent.message", content: [{ type: "text", text: "Перевірив: усе гаразд." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Створи картку");

  assert.equal(reply, "Перевірив: усе гаразд.");
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge should have been sent");
  session.close();
});

test("a Trello write that is never verified fails the turn instead of returning a false success", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write only, no read.
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A" }),
    mcpToolResult("call_1"),
    AGENT_MESSAGE,
    IDLE,
    // Corrective turn: agent still doesn't verify.
    { type: "agent.message", content: [{ type: "text", text: "Готово, все ок." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send("Створи картку"), /did not verify the write/);
  assert.equal(sendCalls.length, 2, "one corrective nudge should have been attempted before failing");
  session.close();
});

test("a failed Trello write (is_error) needs no verification, is not nudged, and is reported deterministically (not by the model)", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", name: "Card X" }),
    mcpToolResult("call_1", true, [{ type: "text", text: "Board  not\nfound" }]),
    // The model falsely claims success after the tool error.
    { type: "agent.message", content: [{ type: "text", text: "Готово! Картку створено." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Створи картку");

  assert.equal(reply, "❌ Не виконано (помилка інструмента): «Card X» — Board not found");
  assert.doesNotMatch(reply, /Готово|створено/i, "the model's false success text never reaches the user");
  assert.equal(sendCalls.length, 1, "a failed write is not nudged, so it cannot be replayed");
  session.close();
});

test("write card A then read card A verifies (same object id) and returns the reply as-is", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A", desc: "x" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A", desc: "x" })),
    AGENT_MESSAGE,
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови картку A");

  assert.equal(reply, "Готово.");
  assert.equal(sendCalls.length, 1, "no corrective nudge needed when the read matches the written card");
  session.close();
});

test("write card A then read card B does not verify (different object id), so the turn fails after one nudge", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write A, but the read that follows is for an unrelated card B.
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_B" }),
    mcpToolResult("call_2"),
    { type: "agent.message", content: [{ type: "text", text: "Готово (помилково)." }] },
    IDLE,
    // Corrective turn: still reads the wrong card.
    mcpToolUse("call_3", "trelloReadCard", { cardIdOrUrl: "card_B" }),
    mcpToolResult("call_3"),
    { type: "agent.message", content: [{ type: "text", text: "Готово (все ще помилково)." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send("Онови картку A"), /did not verify the write/);
  assert.equal(sendCalls.length, 2, "one corrective nudge should have been attempted before failing");
  session.close();
});

test("write card A then an unrelated trelloSearch does not verify, so the turn fails after one nudge", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write A, followed only by a search (not a read of card A).
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloSearch", { query: "card A" }),
    mcpToolResult("call_2"),
    AGENT_MESSAGE,
    IDLE,
    // Corrective turn: agent searches again instead of reading the card back.
    mcpToolUse("call_3", "trelloSearch", { query: "card A" }),
    mcpToolResult("call_3"),
    { type: "agent.message", content: [{ type: "text", text: "Готово (без read)." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send("Онови картку A"), /did not verify the write/);
  assert.equal(sendCalls.length, 2, "one corrective nudge should have been attempted before failing");
  session.close();
});

// --- Due-date clearing (#14): the provider's trelloWriteCard schema requires a non-empty
// ISO 8601 string for `due` and has no clear/unset path (confirmed via live tool-schema
// discovery against the real Managed Agent). The write/verify mechanism itself is
// content-agnostic, so these document how it behaves for a clear-due attempt specifically:
// a rejected clear-due write must not demand verification or produce a false success, and
// an (currently hypothetical) accepted one is verified the same way as any other write.

test("a rejected due-clear write (is_error) is not nudged and is reported from the tool error, not the model's wording", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "" }),
    mcpToolResult("call_1", true, [{ type: "text", text: "due must be a non-empty ISO 8601 string" }]),
    { type: "agent.message", content: [{ type: "text", text: "Дедлайн знято з картки A." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Прибери дедлайн з картки A");

  assert.equal(reply, "❌ Не виконано (помилка інструмента): картка card_A — due must be a non-empty ISO 8601 string");
  assert.equal(sendCalls.length, 1, "no corrective nudge should be sent for a failed write");
  session.close();
});

test("a due-clear write verified by a same-card read succeeds like any other write", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A", due: null })),
    { type: "agent.message", content: [{ type: "text", text: "Дедлайн знято з картки A." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Прибери дедлайн з картки A");

  assert.equal(reply, "Дедлайн знято з картки A.");
  assert.equal(sendCalls.length, 1, "no corrective nudge needed when the read matches the written card");
  session.close();
});

// --- Multimodal input (#22): image content blocks on user.message. ---

test("send with an image constructs a user.message with an image block before the text block", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("з цього зроби задачу по Extract", {
    data: "ZmFrZS1pbWFnZS1ieXRlcw==",
    mediaType: "image/jpeg",
    byteSize: 12345,
  });

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "ZmFrZS1pbWFnZS1ieXRlcw==" } },
          { type: "text", text: "з цього зроби задачу по Extract" },
        ],
      },
    ],
  });
  session.close();
});

test("send with a real tiny PNG fixture produces the exact schema-conformant outbound image block (Issue #26 blocker diagnostic)", async () => {
  // A genuinely valid, decodable 1x1 PNG (not an arbitrary fake string), to
  // rule out "something about real PNG bytes specifically" as a cause of the
  // empty-reply defect observed live against the production Haiku Agent.
  const realPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  // Sanity: this fixture really is a valid PNG (magic bytes + IHDR-declared
  // 1x1 dimensions), decoded independently of djonikClient's own code path,
  // so this test cannot pass merely because both sides share a bug.
  const decoded = Buffer.from(realPngBase64, "base64");
  assert.equal(decoded.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "not a real PNG magic number");
  assert.equal(decoded.readUInt32BE(16), 1, "fixture width must be 1");
  assert.equal(decoded.readUInt32BE(20), 1, "fixture height must be 1");
  assert.ok(!realPngBase64.startsWith("data:"), "fixture must not carry a data: URI prefix");

  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("Що на цьому зображенні?", {
    data: realPngBase64,
    mediaType: "image/png",
    byteSize: decoded.length,
  });

  const sent = sendCalls[0] as { events: Array<{ type: string; content: unknown[] }> };
  assert.equal(sent.events.length, 1);
  assert.equal(sent.events[0].type, "user.message");
  const imageBlock = sent.events[0].content[0] as {
    type: string;
    source: { type: string; media_type: string; data: string };
  };
  // Exact official Managed Agents schema (BetaManagedAgentsImageBlock): only
  // `type` and `source`; `source` is only `type`/`media_type`/`data` — no
  // extra/undefined fields, no accidental mutation from the #25 array
  // generalization.
  assert.deepEqual(Object.keys(imageBlock).sort(), ["source", "type"]);
  assert.equal(imageBlock.type, "image");
  assert.deepEqual(Object.keys(imageBlock.source).sort(), ["data", "media_type", "type"]);
  assert.equal(imageBlock.source.type, "base64");
  assert.equal(imageBlock.source.media_type, "image/png");
  assert.equal(imageBlock.source.data, realPngBase64);
  assert.ok(!imageBlock.source.data.startsWith("data:"), "outbound data must not carry a data: URI prefix");
  assert.ok(imageBlock.source.data.length > 0, "outbound data must be non-empty");
  // Round-trip: what actually goes out over the wire decodes back to the
  // exact same real PNG bytes — no corruption/truncation in transport.
  assert.deepEqual(Buffer.from(imageBlock.source.data, "base64"), decoded);

  session.close();
});

test("send with an image and no caption omits the text block entirely", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("", { data: "aW1hZ2UtZGF0YQ==", mediaType: "image/png", byteSize: 99 });

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2UtZGF0YQ==" } }],
      },
    ],
  });
  session.close();
});

test("send with neither text nor an image rejects before sending anything", async () => {
  const { client, sendCalls } = createFakeClient([]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.send(""), /requires non-empty text and\/or an attachment/);
  assert.equal(sendCalls.length, 0);
  session.close();
});

test("turn telemetry records hasImage/mimeType/byteSize for an image turn and stays null for a text-only turn", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE, AGENT_MESSAGE, IDLE]);
  const telemetry: unknown[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record));

  await session.send("що тут треба зробити?", { data: "aW1n", mediaType: "image/webp", byteSize: 4096 });
  await session.send("дякую");

  const [imageTurn, textOnlyTurn] = telemetry as Array<{
    hasImage: boolean;
    imageMimeType: string | null;
    imageByteSize: number | null;
  }>;
  assert.equal(imageTurn.hasImage, true);
  assert.equal(imageTurn.imageMimeType, "image/webp");
  assert.equal(imageTurn.imageByteSize, 4096);
  assert.equal(textOnlyTurn.hasImage, false);
  assert.equal(textOnlyTurn.imageMimeType, null);
  assert.equal(textOnlyTurn.imageByteSize, null);
  session.close();
});

// --- Issue #24: Telegram PDF/file intake — document content-block construction. ---

test("send with a document constructs a user.message with a document block before the text block", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send(
    "Що тут по проекту?",
    undefined,
    { data: "ZmFrZS1wZGYtYnl0ZXM=", mediaType: "application/pdf", byteSize: 54321, filename: "brief.pdf" },
  );

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "ZmFrZS1wZGYtYnl0ZXM=" },
            title: "brief.pdf",
          },
          { type: "text", text: "Що тут по проекту?" },
        ],
      },
    ],
  });
  session.close();
});

test("send with a document and no filename omits the title field", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("", undefined, { data: "cGRm", mediaType: "application/pdf", byteSize: 10 });

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } }],
      },
    ],
  });
  session.close();
});

test("send with a document and no caption omits the text block entirely", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("", undefined, { data: "cGRmMg==", mediaType: "application/pdf", byteSize: 20, filename: "notes.pdf" });

  const sent = sendCalls[0] as { events: Array<{ content: unknown[] }> };
  assert.equal(sent.events[0].content.length, 1, "no text block when caption is empty");
  session.close();
});

test("turn telemetry records hasFile/mimeType/byteSize/fileNamePresent for a document turn and stays null otherwise", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE, AGENT_MESSAGE, IDLE]);
  const telemetry: unknown[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record));

  await session.send("що тут написано?", undefined, {
    data: "ZG9j",
    mediaType: "application/pdf",
    byteSize: 88888,
    filename: "contract.pdf",
  });
  await session.send("дякую");

  const [fileTurn, textOnlyTurn] = telemetry as Array<{
    hasFile: boolean;
    fileMimeType: string | null;
    fileByteSize: number | null;
    fileNamePresent: boolean | null;
  }>;
  assert.equal(fileTurn.hasFile, true);
  assert.equal(fileTurn.fileMimeType, "application/pdf");
  assert.equal(fileTurn.fileByteSize, 88888);
  assert.equal(fileTurn.fileNamePresent, true, "records only that a filename was present, never the filename itself");
  assert.equal(textOnlyTurn.hasFile, false);
  assert.equal(textOnlyTurn.fileMimeType, null);
  assert.equal(textOnlyTurn.fileByteSize, null);
  assert.equal(textOnlyTurn.fileNamePresent, null);
  session.close();
});

test("turn telemetry records fileNamePresent as false for a document with no filename", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const telemetry: unknown[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record));

  await session.send("", undefined, { data: "eA==", mediaType: "application/pdf", byteSize: 1 });

  const [fileTurn] = telemetry as Array<{ fileNamePresent: boolean | null }>;
  assert.equal(fileTurn.fileNamePresent, false);
  session.close();
});

// --- #25: bounded generalization to multiple images/documents per turn (grouped intake). ---

test("send accepts an array of images and constructs one content block per image, in array order", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("альбом", [
    { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 },
    { data: "Qg==", mediaType: "image/jpeg", byteSize: 2 },
  ]);

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQ==" } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "Qg==" } },
          { type: "text", text: "альбом" },
        ],
      },
    ],
  });
  session.close();
});

test("send accepts a mixed grouped intake: multiple images and a document together", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send(
    "текст групи",
    [{ data: "QQ==", mediaType: "image/jpeg", byteSize: 1 }],
    [{ data: "cGRm", mediaType: "application/pdf", byteSize: 3, filename: "brief.pdf" }],
  );

  const sent = sendCalls[0] as { events: Array<{ content: Array<{ type: string }> }> };
  assert.deepEqual(
    sent.events[0].content.map((block) => block.type),
    ["image", "document", "text"],
  );
  session.close();
});

test("a single image/document object still works exactly as before the array generalization (regression)", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send("одне фото", { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 });

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQ==" } },
          { type: "text", text: "одне фото" },
        ],
      },
    ],
  });
  session.close();
});

// --- Issue #27: sendOrdered — caller-supplied ordered text/image/document parts. ---

test("sendOrdered builds content blocks in exactly the given part order (text -> image -> text)", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.sendOrdered([
    { type: "text", text: "Зроби два варіанти" },
    { type: "image", image: { data: "aW1n", mediaType: "image/png", byteSize: 10 } },
    { type: "text", text: "Корекція: залиш тільки один варіант" },
  ]);

  assert.deepEqual(sendCalls[0], {
    events: [
      {
        type: "user.message",
        content: [
          { type: "text", text: "Зроби два варіанти" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1n" } },
          { type: "text", text: "Корекція: залиш тільки один варіант" },
        ],
      },
    ],
  });
  session.close();
});

test("sendOrdered builds content blocks in exactly the given part order (image -> caption)", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.sendOrdered([
    { type: "image", image: { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 } },
    { type: "text", text: "тільки мобільна версія" },
  ]);

  assert.deepEqual(
    (sendCalls[0] as { events: Array<{ content: Array<{ type: string }> }> }).events[0].content.map((b) => b.type),
    ["image", "text"],
  );
  session.close();
});

test("sendOrdered rejects an empty parts list before sending anything", async () => {
  const { client, sendCalls } = createFakeClient([]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(() => session.sendOrdered([]), /requires non-empty text and\/or an attachment/);
  assert.equal(sendCalls.length, 0);
  session.close();
});

test("sendOrdered skips an empty text part (e.g. a medialess fragment with no caption)", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.sendOrdered([
    { type: "image", image: { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 } },
    { type: "text", text: "" },
  ]);

  const sent = sendCalls[0] as { events: Array<{ content: unknown[] }> };
  assert.equal(sent.events[0].content.length, 1, "empty text part must not produce a text block");
  session.close();
});

test("sendOrdered still enforces write-verify and due-date finalization (shares one pipeline with send)", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", name: "Card A" }),
    mcpToolResult("call_1", false, cardContent({ id: "card_A", name: "Card A" })),
    AGENT_MESSAGE,
    IDLE,
    // Corrective-nudge turn: agent still doesn't verify, so the write ultimately fails closed.
    AGENT_MESSAGE,
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(
    () => session.sendOrdered([{ type: "text", text: "Створи задачу" }]),
    /did not verify the write with an independent read/,
  );
  assert.equal(sendCalls.length, 2, "one initial send plus exactly one corrective nudge");
  session.close();
});

test("turn telemetry records bounded content-block counts for an ordered mixed turn, never block content", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const telemetry: unknown[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record));

  await session.sendOrdered([
    { type: "text", text: "секретний текст клієнта" },
    { type: "image", image: { data: "c2VjcmV0", mediaType: "image/png", byteSize: 5 } },
    { type: "text", text: "друга репліка" },
  ]);

  const [turn] = telemetry as Array<{
    sourceBlockCount: number;
    textBlockCount: number;
    imageBlockCount: number;
    documentBlockCount: number;
  }>;
  assert.equal(turn.sourceBlockCount, 3);
  assert.equal(turn.textBlockCount, 2);
  assert.equal(turn.imageBlockCount, 1);
  assert.equal(turn.documentBlockCount, 0);
  const serialized = JSON.stringify(turn);
  assert.ok(!serialized.includes("секретний"), "content-block telemetry must never carry text content");
  assert.ok(!serialized.includes("c2VjcmV0"), "content-block telemetry must never carry image bytes");
  session.close();
});

test("send()'s legacy fixed order (images, documents, text) is unchanged after the #27 sendOrdered refactor", async () => {
  const { client, sendCalls } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await session.send(
    "текст групи",
    [{ data: "QQ==", mediaType: "image/jpeg", byteSize: 1 }],
    [{ data: "cGRm", mediaType: "application/pdf", byteSize: 3, filename: "brief.pdf" }],
  );

  assert.deepEqual(
    (sendCalls[0] as { events: Array<{ content: Array<{ type: string }> }> }).events[0].content.map((b) => b.type),
    ["image", "document", "text"],
  );
  session.close();
});

test("turn telemetry for a multi-image turn records the first image's mime/size (documented behavior)", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const telemetry: unknown[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record));

  await session.send("альбом", [
    { data: "QQ==", mediaType: "image/jpeg", byteSize: 111 },
    { data: "Qg==", mediaType: "image/png", byteSize: 222 },
  ]);

  const [turn] = telemetry as Array<{ hasImage: boolean; imageMimeType: string | null; imageByteSize: number | null }>;
  assert.equal(turn.hasImage, true);
  assert.equal(turn.imageMimeType, "image/jpeg");
  assert.equal(turn.imageByteSize, 111);
  session.close();
});

test("a document turn does not disturb the #23 due-date deterministic backstop", async () => {
  // Regression: document input must not interfere with the unrelated Issue #23
  // write/verify + due-date finalization path when both occur in the same session.
  const { client } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Понеділок, 22 вересня 2026, 00:30" }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови дедлайн картки A на 22 вересня 00:30 за Києвом");

  assert.equal(reply, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
  session.close();
});

test("write card A with no read, then read card A after the corrective nudge, verifies and succeeds", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write A, agent claims success with no read at all.
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }),
    mcpToolResult("call_1"),
    AGENT_MESSAGE,
    IDLE,
    // Corrective turn: agent reads the correct card this time.
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A" })),
    { type: "agent.message", content: [{ type: "text", text: "Перевірив card A: усе гаразд." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови картку A");

  assert.equal(reply, "Перевірив card A: усе гаразд.");
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge should have been sent");
  session.close();
});

// --- Issue #23: post-write due-date wording must match the verified Trello field. ---
// Prompt/Skill-level guidance was tried twice and failed twice on the same reproducible
// case (correct Kyiv-local date, wrong weekday carried over from the UTC calendar
// date), so this deterministic backstop is narrowly scoped to exactly that one fact.

test("computeKyivDueFacts: no calendar-boundary crossing (Saturday stays Saturday)", () => {
  const facts = computeKyivDueFacts("2026-09-19T19:00:00.000Z");
  assert.ok(facts);
  assert.equal(facts!.kyivDate, "2026-09-19");
  assert.equal(facts!.kyivTime, "22:00");
  assert.equal(facts!.weekdayEn, "Saturday");
  assert.equal(facts!.weekdayUk, "субота");
});

test("computeKyivDueFacts: critical rollover — UTC date is Monday, Kyiv-local date is Tuesday", () => {
  const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z");
  assert.ok(facts);
  assert.equal(facts!.kyivDate, "2026-09-22", "Kyiv-local calendar date must roll over past midnight UTC+3");
  assert.equal(facts!.kyivTime, "00:30");
  assert.equal(facts!.weekdayEn, "Tuesday", "weekday must come from the Kyiv-local date (22 Sep), never the UTC date (21 Sep = Monday)");
  assert.notEqual(facts!.weekdayEn, "Monday");
  assert.equal(facts!.weekdayUk, "вівторок");
});

test("computeKyivDueFacts: UTC calendar date and Kyiv-local calendar date genuinely differ for this timestamp", () => {
  const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z")!;
  const utcDate = "2026-09-21T21:30:00.000Z".slice(0, 10);
  assert.notEqual(facts.kyivDate, utcDate, "this test case only proves anything if the two dates differ");
});

test("computeKyivDueFacts returns null for an unparseable timestamp", () => {
  assert.equal(computeKyivDueFacts("not-a-date"), null);
});

test("extractVerifiedDueFromTrelloReadContent finds a top-level due field in the read result's JSON", () => {
  const content = [{ type: "text", text: JSON.stringify({ id: "card_A", due: "2026-09-21T21:30:00.000Z" }) }];
  assert.equal(extractVerifiedDueFromTrelloReadContent(content), "2026-09-21T21:30:00.000Z");
});

test("extractVerifiedDueFromTrelloReadContent finds a due field nested one level under a wrapper key", () => {
  const content = [{ type: "text", text: JSON.stringify({ card: { id: "card_A", due: "2026-09-19T19:00:00.000Z" } }) }];
  assert.equal(extractVerifiedDueFromTrelloReadContent(content), "2026-09-19T19:00:00.000Z");
});

test("extractVerifiedDueFromTrelloReadContent returns null when there is no due-shaped field", () => {
  const content = [{ type: "text", text: JSON.stringify({ id: "card_A", name: "No due date" }) }];
  assert.equal(extractVerifiedDueFromTrelloReadContent(content), null);
});

test("extractVerifiedDueFromTrelloReadContent returns null for non-JSON text and undefined content", () => {
  assert.equal(extractVerifiedDueFromTrelloReadContent([{ type: "text", text: "not json at all" }]), null);
  assert.equal(extractVerifiedDueFromTrelloReadContent(undefined), null);
});

// A weekday-only contradiction check would miss a wrong-date-but-right-weekday
// reply (e.g. "Вівторок, 23 вересня 2026" when verified is 22 September). So for
// a verified due-date write, the wrapper now deterministically OWNS the entire
// final due-date confirmation instead of trying to detect/patch specific wrong
// words in the model's prose — see `buildVerifiedDueConfirmation`/`finalizeDueDateReply`.

test("buildVerifiedDueConfirmation: verified equals intended — normal success wording", () => {
  const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z")!;
  const text = buildVerifiedDueConfirmation({ intendedDue: "2026-09-21T21:30:00.000Z", verifiedFacts: facts });
  assert.equal(text, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
});

test("buildVerifiedDueConfirmation: intended differs from verified — mismatch is surfaced explicitly", () => {
  const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z")!;
  const text = buildVerifiedDueConfirmation({ intendedDue: "2026-09-22T00:00:00.000Z", verifiedFacts: facts });
  assert.equal(
    text,
    "Картку оновлено, але Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом. Це відрізняється від значення, яке було відправлено.",
  );
});

test("buildVerifiedDueConfirmation: intended and verified are the same instant in different string formats", () => {
  const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z")!;
  // "Z" vs ".000Z" — same instant, different literal string.
  const text = buildVerifiedDueConfirmation({ intendedDue: "2026-09-21T21:30:00Z", verifiedFacts: facts });
  assert.match(text, /^Готово\./, "same instant should not be treated as a mismatch merely because the string differs");
});

test("finalizeDueDateReply returns the reply unchanged when no due-date write was verified this turn", () => {
  assert.equal(finalizeDueDateReply("Готово.", null), "Готово.");
});

for (const [label, modelReply] of [
  ["wrong weekday, correct date", "Понеділок, 22 вересня 2026, 00:30"],
  ["correct weekday, wrong calendar date", "Вівторок, 23 вересня 2026, 00:30"],
  ["correct weekday and date, wrong time", "Вівторок, 22 вересня 2026, 03:15"],
  ["completely wrong wording", "Дедлайн: п'ятниця, 1 січня 2027"],
] as const) {
  test(`finalizeDueDateReply: ${label} — deterministic output is correct regardless`, () => {
    const facts = computeKyivDueFacts("2026-09-21T21:30:00.000Z")!;
    const result = finalizeDueDateReply(modelReply, { intendedDue: "2026-09-21T21:30:00.000Z", verifiedFacts: facts });
    assert.equal(result, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
    assert.doesNotMatch(result, /понеділок|23 вересня|03:15|1 січня 2027/i, "no trace of the wrong model wording survives");
  });
}

test("end-to-end: critical rollover — final reply is the deterministic confirmation, not the model's wrong weekday", async () => {
  const { client } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Понеділок, 22 вересня 2026, 00:30" }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови дедлайн картки A на 22 вересня 00:30 за Києвом");

  assert.equal(reply, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
  assert.doesNotMatch(reply, /понеділок/i, "the model's wrong weekday must not reach the user");
  session.close();
});

test("end-to-end: correct weekday but wrong calendar date in the model's reply is still overridden", async () => {
  const { client } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Вівторок, 23 вересня 2026, 00:30" }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови дедлайн картки A");

  assert.equal(reply, "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.");
  assert.doesNotMatch(reply, /23 вересня/, "a right-weekday-wrong-date reply must not slip through a weekday-only check");
  session.close();
});

test("end-to-end: verified due equals intended due — normal success wording, no mismatch note", async () => {
  const { client } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", due: "2026-09-19T19:00:00.000Z" }),
    mcpToolResult("call_1", false, cardContent({ id: "card_A", due: "2026-09-19T19:00:00.000Z" })),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-19T19:00:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Субота, 19 вересня 2026, 22:00" }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Створи картку A з дедлайном 19 вересня 22:00 за Києвом");

  assert.equal(reply, "Готово. Trello підтвердив дедлайн: субота, 19 вересня 2026, 22:00 за Києвом.");
  assert.doesNotMatch(reply, /відрізняється/, "no mismatch wording when verified equals intended");
  session.close();
});

test("end-to-end: intended differs from verified — deterministic reply reports the verified value and the mismatch", async () => {
  const { client } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Trello підтвердив: понеділок, 22 вересня 2026, 00:30." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови дедлайн картки A");

  assert.equal(
    reply,
    "Картку оновлено, але Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом. Це відрізняється від значення, яке було відправлено.",
  );
  session.close();
});

test("end-to-end: verified due missing/unparseable from the read result — fails closed, no fabricated confirmation", async () => {
  const { client, sendCalls } = createFakeClient([
    // First turn: write with a due, but the read-back result carries no due field at all.
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, [{ type: "text", text: JSON.stringify({ id: "card_A", name: "Test card" }) }]),
    { type: "agent.message", content: [{ type: "text", text: "Готово. Дедлайн оновлено на вівторок, 22 вересня." }] },
    IDLE,
    // Corrective turn: still no parseable due in the read-back.
    mcpToolUse("call_3", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_3", false, [{ type: "text", text: JSON.stringify({ id: "card_A", name: "Test card" }) }]),
    { type: "agent.message", content: [{ type: "text", text: "Готово (все ще без підтвердженого due)." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(
    () => session.send("Онови дедлайн картки A"),
    /did not verify the write/,
    "an unconfirmable due-date write must fail the whole turn rather than let any exact due claim through",
  );
  assert.equal(sendCalls.length, 2, "one corrective nudge should have been attempted before failing closed");
  session.close();
});

test("normal Trello writes without a due-date change are unaffected by the backstop", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", name: "Renamed" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2", false, cardContent({ id: "card_A", name: "Renamed", due: "2026-09-21T21:30:00.000Z" })),
    { type: "agent.message", content: [{ type: "text", text: "Назву картки A оновлено." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Перейменуй картку A");

  assert.equal(reply, "Назву картки A оновлено.", "no due-date confirmation replaces a non-due-date reply");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("existing same-card identity verification is unaffected by the due-date backstop", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_B" }),
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Готово (помилково)." }] },
    IDLE,
    mcpToolUse("call_3", "trelloReadCard", { cardIdOrUrl: "card_B" }),
    mcpToolResult("call_3", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
    { type: "agent.message", content: [{ type: "text", text: "Готово (все ще помилково)." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(
    () => session.send("Онови картку A"),
    /did not verify the write/,
    "a read of the wrong card must still fail identity verification, due-date content notwithstanding",
  );
  assert.equal(sendCalls.length, 2);
  session.close();
});

test("text-only and image turns with no Trello activity are unaffected by the due-date backstop", async () => {
  const { client } = createFakeClient([AGENT_MESSAGE, IDLE]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Привіт!");

  assert.equal(reply, "Готово.");
  session.close();
});

// --- #25 live-validation blocker: DjonikSessionHandle.send() must FIFO-serialize
// concurrent calls on one handle. Live acceptance testing (Scenario A) found two
// grouped-Telegram dispatches settling only ~6ms apart, both calling `send()`
// concurrently on the same session. `send()`'s per-turn closure state
// (turnTelemetry, pendingWriteTool/ObjectId/Due, dueOutcomeForTurn,
// unverifiedTrelloWrite, mcpToolCallsById) and the single event-stream
// `iterator` are only safe for one in-flight turn — see
// `docs/12_ISSUE_25_IMPLEMENTATION_REPORT.md` for the full incident writeup.

test("Scenario A: two concurrent send() calls are FIFO-serialized — turn 2's provider send never starts before turn 1 fully finishes", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("перший turn");
  const p2 = session.send("другий turn");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 1, "turn 2 must not reach the provider before turn 1 has even started resolving");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 1" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  const reply1 = await p1;
  assert.equal(reply1, "Відповідь 1", "reply must stay attributed to the caller that sent turn 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "turn 2 starts its own provider send only once turn 1 has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  const reply2 = await p2;
  assert.equal(reply2, "Відповідь 2", "reply must stay attributed to the caller that sent turn 2, not swapped with turn 1");

  session.close();
});

test("Scenario B: a failed first queued turn does not poison the queue — the second queued turn still runs", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("перший turn");
  const p2 = session.send("другий turn");
  await flushMicrotasks();
  assert.equal(sendCalls.length, 1);

  // Ordinary (non-terminal) turn failure: session ends idle with no assistant text.
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await assert.rejects(() => p1, /no text reply/);

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "the second queued turn must still start after the first one failed");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Відповідь 2");

  session.close();
});

test("Scenario C: a DjonikSessionDeadError from the first queued turn stays correctly typed, and the already-queued next turn still runs on the same (now-dead) handle without any auto-reconnect", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("перший turn");
  const p2 = session.send("другий turn");
  await flushMicrotasks();
  assert.equal(sendCalls.length, 1);

  push({ type: "session.status_terminated" });
  await assert.rejects(() => p1, DjonikSessionDeadError);

  // Documented current behavior: the queue does not skip or reconnect — it
  // still starts the next queued turn on the same handle, which independently
  // hits the same dead stream. `DjonikSessionManager` (the Telegram adapter's
  // one-session-per-process cache), not `DjonikSessionHandle` itself, owns
  // reconnection via `DjonikSessionDeadError`.
  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "the queue still attempts the next turn rather than skipping it");
  push({ type: "session.status_terminated" });
  await assert.rejects(() => p2, DjonikSessionDeadError);

  session.close();
});

test("Scenario D: two concurrently requested turns produce two independent telemetry records — no mixed tool counts, no swapped media flags", async () => {
  const { client, push } = createStreamedFakeClient();
  const telemetry: DjonikTurnTelemetry[] = [];
  const session = await connectToDjonik(
    client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (t) => telemetry.push(t),
  );

  const p1 = session.send("перший", { data: "QQ==", mediaType: "image/jpeg", byteSize: 111 });
  const p2 = session.send("другий", undefined, { data: "cGRm", mediaType: "application/pdf", byteSize: 222 });

  await flushMicrotasks();
  push(mcpToolUse("call_1", "trelloSearch"));
  push(mcpToolResult("call_1"));
  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 1" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await p1;

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await p2;

  assert.equal(telemetry.length, 2);
  assert.equal(telemetry[0].hasImage, true, "turn 1's own image flag must not be lost");
  assert.equal(telemetry[0].hasFile, false, "turn 1 must not inherit turn 2's document");
  assert.deepEqual(telemetry[0].toolNames, ["trelloSearch"], "turn 1's tool call must not leak into turn 2's count");
  assert.equal(telemetry[1].hasImage, false, "turn 2 must not inherit turn 1's image");
  assert.equal(telemetry[1].hasFile, true, "turn 2's own document flag must not be lost");
  assert.deepEqual(telemetry[1].toolNames, [], "turn 2 had no tool calls of its own");

  session.close();
});

test("Scenario E: a concurrently queued read-only turn cannot reset an earlier queued turn's pending Trello write-verification state", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("Онови картку A"); // will write + same-card verify
  const p2 = session.send("Яка сьогодні погода?"); // ordinary turn, no Trello activity at all

  await flushMicrotasks();
  assert.equal(sendCalls.length, 1, "turn 2 cannot run concurrently and therefore cannot touch turn 1's pending-write state");

  push(mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }));
  push(mcpToolResult("call_1"));
  push(mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }));
  push(mcpToolResult("call_2", false, cardContent({ id: "card_A" })));
  push({ type: "agent.message", content: [{ type: "text", text: "Готово (turn 1)." }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });

  assert.equal(await p1, "Готово (turn 1).", "turn 1 succeeds purely from its own verification");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "turn 2 only starts once turn 1's own verification has fully settled");
  push({ type: "agent.message", content: [{ type: "text", text: "Сонячно." }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Сонячно.", "turn 2's reply remains its own, unaffected by turn 1's write");

  session.close();
});

// --- Issue #27 Product Lead review point 1: send() and sendOrdered() must
// share the exact same FIFO queue/pipeline, not a second parallel one. ---

test("Scenario F (#27): send() and sendOrdered() interleaved on one handle FIFO-serialize into the same queue — sendOrdered's provider turn never starts before send()'s finishes", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  // p1 via the legacy send(); p2 via the new sendOrdered() — issued back to
  // back, exactly like two independent grouped Telegram dispatches (or one
  // grouped dispatch racing the diagnostic cli.ts path) could in production.
  const p1 = session.send("перший (send)");
  const p2 = session.sendOrdered([{ type: "text", text: "другий (sendOrdered)" }]);

  await flushMicrotasks();
  assert.equal(sendCalls.length, 1, "sendOrdered's provider turn must not start before send()'s turn has even begun resolving — proves one shared queue, not two independent ones");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 1" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p1, "Відповідь 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "sendOrdered's own provider turn starts only once send()'s turn has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Відповідь 2", "sendOrdered's reply stays attributed to its own call, not swapped with send()'s");

  session.close();
});

test("Scenario G (#27): the reverse order — sendOrdered() first, then send() — still FIFO-serializes on the same queue", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.sendOrdered([
    { type: "image", image: { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 } },
    { type: "text", text: "caption" },
  ]);
  const p2 = session.send("звичайний текст");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 1, "send()'s provider turn must not start before sendOrdered()'s turn has even begun resolving");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 1" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p1, "Відповідь 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "send()'s turn starts only once sendOrdered()'s turn has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Відповідь 2");

  session.close();
});

test("Scenario H (#27): sendOrdered() shares the exact same event-stream iterator as send() — no second iterator, no second live subscription", async () => {
  // If sendOrdered had its own parallel queue/iterator, this turn's events
  // (pushed onto the ONE fake stream both methods must read from) would
  // never be consumed by it and the call would hang/timeout instead of
  // resolving. Resolving here is itself the proof there is exactly one
  // iterator being advanced by both send() and sendOrdered().
  const { client, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p = session.sendOrdered([{ type: "text", text: "чи бачиш цей event?" }]);
  await flushMicrotasks();
  push({ type: "agent.message", content: [{ type: "text", text: "Так, бачу." }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });

  assert.equal(await p, "Так, бачу.", "sendOrdered consumed events from the same single stream iterator send() uses");
  session.close();
});

test("Scenario I (#27): a DjonikSessionDeadError raised by sendOrdered() behaves identically to send() — same dead-session typing, same non-reconnecting queue", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.sendOrdered([{ type: "text", text: "перший" }]);
  const p2 = session.sendOrdered([{ type: "text", text: "другий" }]);
  await flushMicrotasks();
  assert.equal(sendCalls.length, 1);

  push({ type: "session.status_terminated" });
  await assert.rejects(() => p1, DjonikSessionDeadError);

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "the queue still attempts the next sendOrdered() turn rather than skipping it — identical to send()'s documented behavior");
  push({ type: "session.status_terminated" });
  await assert.rejects(() => p2, DjonikSessionDeadError);

  session.close();
});

test("Scenario E (inverse order): a queued write+verify turn still verifies correctly when an earlier read-only turn is queued ahead of it", async () => {
  const { client, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("Привіт");
  const p2 = session.send("Онови картку A");

  await flushMicrotasks();
  push({ type: "agent.message", content: [{ type: "text", text: "Привіт!" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p1, "Привіт!");

  push(mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }));
  push(mcpToolResult("call_1"));
  push(mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }));
  push(mcpToolResult("call_2", false, cardContent({ id: "card_A" })));
  push({ type: "agent.message", content: [{ type: "text", text: "Готово (turn 2)." }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Готово (turn 2).", "turn 2's own write is still verified correctly after an unrelated turn 1");

  session.close();
});

test("Scenario F (#23 regression): deterministic Kyiv due-date finalization is unaffected by concurrent request pressure from another queued turn", async () => {
  const { client, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("Онови дедлайн картки A на 22 вересня 00:30 за Києвом");
  const p2 = session.send("Привіт"); // unrelated concurrently-requested turn

  await flushMicrotasks();
  push(mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }));
  push(mcpToolResult("call_1"));
  push(mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }));
  push(mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")));
  push({ type: "agent.message", content: [{ type: "text", text: "Понеділок, 22 вересня 2026, 00:30" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });

  assert.equal(
    await p1,
    "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.",
    "the #23 deterministic Kyiv weekday/date backstop must be unaffected by a second turn queued behind it",
  );

  push({ type: "agent.message", content: [{ type: "text", text: "Привіт!" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "Привіт!");

  session.close();
});

// ---------------------------------------------------------------------------------------------
// Issue #28: deterministic Project Health relay finalizer (reply boundary).
//
// Claude still decides whether to delegate; these tests script the *events* of a turn that has
// already been natively delegated and prove only transport integrity: a proven, single, exactly
// relayable specialist result becomes the reply, everything else is left exactly as before.
// ---------------------------------------------------------------------------------------------

const PH_NAME = "Djonik Project Health Specialist";
const PH_THREAD = "sthr_ph_1";

/** Start of the fixed notice shown when coordinator text is withheld beside a verified specialist result (#32). */
const WITHHELD_NOTICE = "ℹ️ Джонік також сформував власний текст";

/** Asserts the turn fails visibly because the specialist-backed result could not be established (#32). */
async function assertSpecialistUnverified(promise: Promise<string>, reason: string, label = ""): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DjonikSpecialistUnverifiedError, `${label} expected DjonikSpecialistUnverifiedError, got ${String(error)}`);
    assert.equal(error.reason, reason, label);
    assert.match(error.message, /НЕ підтверджено/, label);
    return error;
  }
  assert.fail(`${label} expected the turn to fail visibly`);
}

/** A resolved `session.agent` whose coordinator roster is exactly the canonical specialist. */
function projectHealthSessionAgent(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "agent_prod",
    version: 19,
    multiagent: {
      type: "coordinator",
      agents: [{ type: "agent", id: PROJECT_HEALTH_SPECIALIST_AGENT_ID, version: 4, name: PH_NAME, ...overrides }],
    },
  };
}

function threadCreated(agentName = PH_NAME, threadId = PH_THREAD): unknown {
  return { type: "session.thread_created", id: `evt_created_${threadId}`, agent_name: agentName, session_thread_id: threadId };
}

function specialistMessage(text: string, fromAgentName: string | null = PH_NAME, fromThreadId = PH_THREAD): unknown {
  return {
    type: "agent.thread_message_received",
    id: `evt_received_${Math.random().toString(36).slice(2)}`,
    content: [{ type: "text", text }],
    from_session_thread_id: fromThreadId,
    ...(fromAgentName === null ? {} : { from_agent_name: fromAgentName }),
  };
}

/** The coordinator's task/follow-up to a child (official `agent.thread_message_sent` on the primary stream). */
function threadMessageSent(threadId = PH_THREAD, agentName = PH_NAME): unknown {
  return {
    type: "agent.thread_message_sent",
    id: `evt_sent_${Math.random().toString(36).slice(2)}`,
    content: [{ type: "text", text: "delegated task" }],
    to_session_thread_id: threadId,
    to_agent_name: agentName,
  };
}

function primaryMessage(text: string): unknown {
  return { type: "agent.message", content: [{ type: "text", text }] };
}

const THREAD_IDLE = { type: "session.thread_status_idle", agent_name: "Джонік", session_thread_id: "sthr_primary", stop_reason: { type: "end_turn" } };

test("resolveProjectHealthSpecialistName: only a one-entry coordinator roster of the canonical specialist proves it", () => {
  assert.equal(resolveProjectHealthSpecialistName(projectHealthSessionAgent()), PH_NAME);
  // Anything else fails closed, including a bare Session with no roster at all.
  assert.equal(resolveProjectHealthSpecialistName(undefined), null);
  assert.equal(resolveProjectHealthSpecialistName({ id: "agent_prod", multiagent: null }), null);
  assert.equal(resolveProjectHealthSpecialistName(projectHealthSessionAgent({ id: "agent_someone_else" })), null);
  assert.equal(resolveProjectHealthSpecialistName(projectHealthSessionAgent({ type: "advisor" })), null);
  assert.equal(resolveProjectHealthSpecialistName(projectHealthSessionAgent({ name: "" })), null);
  // #32/R7: an unrelated second roster entry no longer disables the safeguard, in either order.
  const unrelated = { type: "agent", id: "agent_second", name: "Second" };
  const canonical = { type: "agent", id: PROJECT_HEALTH_SPECIALIST_AGENT_ID, name: PH_NAME };
  assert.equal(resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [canonical, unrelated] } }), PH_NAME);
  assert.equal(resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [unrelated, canonical] } }), PH_NAME);
  assert.equal(
    resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [canonical, { type: "advisor", model: "x" }] } }),
    PH_NAME,
    "an Advisor entry beside the canonical specialist is unrelated too",
  );
  // ...while ambiguity still fails closed.
  assert.equal(
    resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [canonical, { ...canonical }] } }),
    null,
    "a duplicated canonical entry is ambiguous",
  );
  assert.equal(
    resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [canonical, { ...unrelated, name: PH_NAME }] } }),
    null,
    "another entry answering to the same callable name would make thread events ambiguous",
  );
  assert.equal(
    resolveProjectHealthSpecialistName({ multiagent: { type: "coordinator", agents: [unrelated] } }),
    null,
    "no canonical entry: nothing is proven, however many other entries exist",
  );
});

// The pure specialist decision/composition rules now live in src/turnCorrelation.test.ts (#32).

test("#28 1: an ordinary non-delegated turn returns the coordinator reply exactly", async () => {
  const { client } = createFakeClient([primaryMessage("ordinary"), IDLE], projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  assert.equal(await session.send("Привіт"), "ordinary");
  session.close();
});

test("#28 2 (#32): a proven Project Health result stays the authoritative answer; the coordinator's differing text is withheld VISIBLY", async () => {
  const traces: DjonikTraceEvent[] = [];
  const { client } = createFakeClient(
    [threadCreated(), specialistMessage("SPECIALIST EXACT"), primaryMessage("HAIKU REWRITE"), IDLE],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event));

  const reply = await session.send("Що зараз по Extract?");

  assert.ok(reply.startsWith("SPECIALIST EXACT"), "the exact specialist string is the answer");
  assert.ok(!reply.includes("HAIKU REWRITE"), "Haiku's rewrite can never appear beside it as another Project Health answer (#28)");
  assert.ok(reply.includes(WITHHELD_NOTICE), "but the withholding is never silent (#32)");
  assert.deepEqual(
    traces.filter((event) => event.type === "specialist_reply_composed"),
    [{ type: "specialist_reply_composed", mode: "coordinator_withheld" }],
    "the trace is content-free: it carries no specialist or user text",
  );
  session.close();
});

test("#28 3: the specialist string is returned with no trim, normalization or reformatting", async () => {
  const exact = "\n  **Стан:**\r\n- «Брендбук» — 2026-09-25T15:00:00.000Z; ¯\\_(ツ)_/¯  \t \n\n(кінець)  \n";
  const { client } = createFakeClient(
    [threadCreated(), specialistMessage(exact), primaryMessage("сумарія"), IDLE],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Що зараз по Extract?");

  assert.ok(reply.startsWith(exact), "no trim, normalization or reformatting of the specialist string");
  assert.strictEqual(reply.slice(0, exact.length), exact);
  assert.ok(!reply.includes("сумарія"));
  assert.ok(reply.includes(WITHHELD_NOTICE));
  session.close();
});

test("#28 4: an already-exact coordinator relay returns that same string, once, with no duplication", async () => {
  const traces: DjonikTraceEvent[] = [];
  const { client } = createFakeClient(
    [threadCreated(), specialistMessage("X"), primaryMessage("X"), IDLE],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event));

  assert.strictEqual(await session.send("Що зараз по Extract?"), "X");
  assert.deepEqual(
    traces.filter((event) => event.type === "specialist_reply_composed"),
    [{ type: "specialist_reply_composed", mode: "exact" }],
  );
  session.close();
});

test("#28 5: without proven canonical engagement the coordinator reply stays authoritative (no generic subagent interception)", async () => {
  const cases: Array<{ label: string; agent: unknown; events: unknown[] }> = [
    { label: "no resolved roster on the Session", agent: undefined, events: [threadCreated(), specialistMessage("CHILD"), primaryMessage("PRIMARY"), IDLE] },
    {
      label: "roster's only child is some other agent",
      agent: projectHealthSessionAgent({ id: "agent_someone_else" }),
      events: [threadCreated(), specialistMessage("CHILD"), primaryMessage("PRIMARY"), IDLE],
    },
    {
      label: "child thread was created under a different agent name",
      agent: projectHealthSessionAgent(),
      events: [threadCreated("Some Other Agent"), specialistMessage("CHILD", "Some Other Agent"), primaryMessage("PRIMARY"), IDLE],
    },
    { label: "message arrives with no canonical delegation engaged at all", agent: projectHealthSessionAgent(), events: [specialistMessage("CHILD"), primaryMessage("PRIMARY"), IDLE] },
  ];
  for (const { label, agent, events } of cases) {
    const { client } = createFakeClient(events, agent);
    const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
    assert.strictEqual(await session.send("Що зараз по Extract?"), "PRIMARY", label);
    session.close();
  }
});

test("#28 5a (#32): once the canonical delegation IS engaged, an unattributable result fails visibly instead of falling back to coordinator prose", async () => {
  const cases: Array<{ label: string; events: unknown[] }> = [
    {
      label: "message from a thread this Session never created for the specialist",
      events: [threadCreated(), specialistMessage("CHILD", PH_NAME, "sthr_unknown"), primaryMessage("PRIMARY"), IDLE],
    },
    {
      label: "message from the canonical thread naming a different callable agent",
      events: [threadCreated(), specialistMessage("CHILD", "Some Other Agent"), primaryMessage("PRIMARY"), IDLE],
    },
    {
      label: "message from the canonical thread carrying no callable-agent name",
      events: [threadCreated(), specialistMessage("CHILD", null), primaryMessage("PRIMARY"), IDLE],
    },
  ];
  for (const { label, events } of cases) {
    const { client } = createFakeClient(events, projectHealthSessionAgent());
    const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
    const error = await assertSpecialistUnverified(session.send("Що зараз по Extract?"), "unrecognized_result", label);
    assert.ok(!error.message.includes("PRIMARY"), label);
    session.close();
  }
});

test("#28 5b (#32): a canonical child message that is not a plain non-empty string fails visibly, never relayed as exact", async () => {
  const notPlain: unknown[] = [
    { type: "agent.thread_message_received", content: [{ type: "text", text: "A" }, { type: "image", source: {} }], from_session_thread_id: PH_THREAD, from_agent_name: PH_NAME },
    { type: "agent.thread_message_received", content: [{ type: "text", text: "" }], from_session_thread_id: PH_THREAD, from_agent_name: PH_NAME },
    { type: "agent.thread_message_received", content: [], from_session_thread_id: PH_THREAD, from_agent_name: PH_NAME },
  ];
  for (const message of notPlain) {
    const { client } = createFakeClient([threadCreated(), message, primaryMessage("PRIMARY"), IDLE], projectHealthSessionAgent());
    const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
    const error = await assertSpecialistUnverified(session.send("Що зараз по Extract?"), "not_exact_text");
    assert.ok(!error.message.includes("PRIMARY"));
    session.close();
  }
});

test("#28 6 (#32): an engaged delegation with no child result fails visibly; an empty non-delegated turn keeps the empty-reply failure", async () => {
  const { client } = createFakeClient([threadCreated(), primaryMessage("PRIMARY"), IDLE], projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  const error = await assertSpecialistUnverified(session.send("Що зараз по Extract?"), "missing_result");
  assert.ok(!error.message.includes("PRIMARY"), "the coordinator's unverified Project Health prose is not shown");
  session.close();

  const empty = createFakeClient([IDLE], projectHealthSessionAgent());
  const emptySession = await connectToDjonik(empty.client, "agent_x", "env_x", "memstore_x", "vlt_x");
  await assert.rejects(emptySession.send("Що зараз по Extract?"), /no text reply/);
  emptySession.close();
});

test("#28 6b: an exact specialist result with no coordinator message of its own still completes the turn", async () => {
  const { client } = createFakeClient([threadCreated(), specialistMessage("ONLY THE SPECIALIST"), IDLE], projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  assert.strictEqual(await session.send("Що зараз по Extract?"), "ONLY THE SPECIALIST");
  session.close();
});

test("#28 7: a verified Trello write turn is left to the existing write pipeline even if a specialist result was received", async () => {
  const { client, sendCalls } = createFakeClient(
    [
      threadCreated(),
      specialistMessage("SPECIALIST EXACT"),
      mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A" }),
      mcpToolResult("call_1"),
      mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
      mcpToolResult("call_2", false, cardContent({ id: "card_A" })),
      primaryMessage("Готово, картку оновлено."),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Проаналізуй Extract і онови картку A");
  assert.match(reply, /^✅ Підтверджено читанням картки/, "the mutation outcome is system-owned and leads (#31)");
  assert.ok(reply.includes("SPECIALIST EXACT"), "the read-only specialist result is preserved beside it (#32)");
  assert.ok(!reply.includes("Готово, картку оновлено."), "model text is never shown beside a verified specialist result");
  assert.ok(reply.includes(WITHHELD_NOTICE));
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#28 7b: a failed (is_error) Trello write attempt also keeps the mutation turn out of the finalizer", async () => {
  const { client } = createFakeClient(
    [
      threadCreated(),
      specialistMessage("SPECIALIST EXACT"),
      mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A" }),
      mcpToolResult("call_1", true),
      primaryMessage("Не вдалося оновити картку."),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  // The model's text never reaches the user: the mutation outcome is the tool outcome (#31); the verified,
  // read-only specialist result is preserved verbatim after it (#32).
  const reply = await session.send("Онови картку A");
  assert.ok(reply.startsWith("❌ Не виконано (помилка інструмента): картка card_A"));
  assert.ok(!reply.includes("Не вдалося оновити картку."), "model prose is still not used for a failed write");
  assert.ok(reply.includes("SPECIALIST EXACT"));
  session.close();
});

test("#28 7c: an unverified Trello write still fails the turn (verification is not bypassed by a specialist result)", async () => {
  const { client } = createFakeClient(
    [
      threadCreated(),
      specialistMessage("SPECIALIST EXACT"),
      mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A" }),
      mcpToolResult("call_1"),
      primaryMessage("Готово."),
      IDLE,
      primaryMessage("Все ще готово."),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  await assert.rejects(session.send("Онови картку A"), /did not verify the write/);
  session.close();
});

test("#28 8: the Issue #23 due-date finalizer keeps owning a verified due-date write turn", async () => {
  const { client } = createFakeClient(
    [
      threadCreated(),
      specialistMessage("SPECIALIST EXACT"),
      mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "2026-09-21T21:30:00.000Z" }),
      mcpToolResult("call_1"),
      mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
      mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
      primaryMessage("Понеділок, 22 вересня 2026, 00:30"),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Онови дедлайн картки A на 22 вересня 00:30 за Києвом");
  assert.ok(
    reply.startsWith("Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом."),
    "the #23 sentence still leads and never carries the model's wrong weekday",
  );
  assert.ok(!reply.includes("Понеділок, 22 вересня"));
  assert.ok(reply.includes("SPECIALIST EXACT"));
  session.close();
});

test("#28 10 (#32): several specialist results / threads in one turn are never guessed between — the turn fails visibly", async () => {
  const oneThread = createFakeClient(
    [threadCreated(), specialistMessage("FIRST"), specialistMessage("SECOND"), primaryMessage("PRIMARY"), IDLE],
    projectHealthSessionAgent(),
  );
  const s1 = await connectToDjonik(oneThread.client, "agent_x", "env_x", "memstore_x", "vlt_x");
  await assertSpecialistUnverified(s1.send("Що зараз по Extract?"), "duplicate_results");
  s1.close();

  const twoThreads = createFakeClient(
    [
      threadCreated(PH_NAME, "sthr_a"),
      threadCreated(PH_NAME, "sthr_b"),
      specialistMessage("FIRST", PH_NAME, "sthr_a"),
      specialistMessage("SECOND", PH_NAME, "sthr_b"),
      primaryMessage("PRIMARY"),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const s2 = await connectToDjonik(twoThreads.client, "agent_x", "env_x", "memstore_x", "vlt_x");
  await assertSpecialistUnverified(s2.send("Що зараз по Extract?"), "multiple_threads");
  s2.close();
});

test("#28 11: the decision is made on authoritative session.status_idle, not a transient thread idle", async () => {
  const { client, push } = createStreamedFakeClient(projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  let settled: string | null = null;
  const turn = session.send("Що зараз по Extract?").then((reply) => {
    settled = reply;
    return reply;
  });

  push(threadCreated());
  push(THREAD_IDLE); // the coordinator's own thread going idle mid-turn
  push(primaryMessage("INTERIM COORDINATOR TEXT"));
  push(specialistMessage("SPECIALIST EXACT"));
  push({ type: "session.thread_status_idle", agent_name: PH_NAME, session_thread_id: PH_THREAD, stop_reason: { type: "end_turn" } });
  await flushMicrotasks();
  assert.equal(settled, null, "thread-level idle events must not complete the turn");

  push(primaryMessage("HAIKU REWRITE"));
  push(THREAD_IDLE);
  await flushMicrotasks();
  assert.equal(settled, null, "still no authoritative session.status_idle");

  push(IDLE);
  const reply = await turn;
  assert.ok(reply.startsWith("SPECIALIST EXACT"));
  assert.ok(!reply.includes("HAIKU REWRITE") && !reply.includes("INTERIM COORDINATOR TEXT"));
  assert.ok(reply.includes(WITHHELD_NOTICE));
  session.close();
});

test("#28 12: thread proof lives for the Session, but each turn's result is its own (no cross-turn leakage)", async () => {
  const { client, push } = createStreamedFakeClient(projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const t1 = session.send("Що зараз по Extract?");
  push(threadCreated());
  push(specialistMessage("EXACT ONE"));
  push(primaryMessage("REWRITE ONE"));
  push(IDLE);
  const r1 = await t1;
  assert.ok(r1.startsWith("EXACT ONE") && !r1.includes("REWRITE ONE") && r1.includes(WITHHELD_NOTICE));

  // Turn 2: the existing child thread is messaged again — no new session.thread_created, but the
  // coordinator's own agent.thread_message_sent to it is this turn's delegation evidence (#32).
  const t2 = session.send("А тепер по Seqthera?");
  push(threadMessageSent());
  push(specialistMessage("EXACT TWO"));
  push(primaryMessage("REWRITE TWO"));
  push(IDLE);
  const r2 = await t2;
  assert.ok(r2.startsWith("EXACT TWO") && !r2.includes("REWRITE TWO") && !r2.includes("EXACT ONE"));

  // Turn 3: no specialist involvement at all — turn 1/2 results must not leak in.
  const t3 = session.send("Дякую");
  push(primaryMessage("Будь ласка"));
  push(IDLE);
  assert.strictEqual(await t3, "Будь ласка");
  session.close();
});

test("#28 9: FIFO serialization still attributes each queued turn's own specialist result to its own caller", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient(projectHealthSessionAgent());
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("Що зараз по Extract?");
  const p2 = session.send("Що зараз по Seqthera?");
  await flushMicrotasks();
  assert.equal(sendCalls.length, 1, "turn 2 must not start before turn 1 settles");

  push(threadCreated());
  push(specialistMessage("EXACT ONE"));
  push(primaryMessage("REWRITE ONE"));
  push(IDLE);
  const r1 = await p1;
  assert.ok(r1.startsWith("EXACT ONE") && !r1.includes("EXACT TWO"));

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2);
  push(threadMessageSent());
  push(specialistMessage("EXACT TWO"));
  push(primaryMessage("REWRITE TWO"));
  push(IDLE);
  const r2 = await p2;
  assert.ok(r2.startsWith("EXACT TWO") && !r2.includes("EXACT ONE"));
  session.close();
});

test("#28: the finalizer does not touch telemetry — model-iteration and tool accounting is unchanged with a specialist result", async () => {
  const records: DjonikTurnTelemetry[] = [];
  const { client } = createFakeClient(
    [
      threadCreated(),
      { type: "span.model_request_end" },
      specialistMessage("SPECIALIST EXACT"),
      { type: "span.model_request_end" },
      primaryMessage("HAIKU REWRITE"),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (t) => records.push(t));

  assert.ok((await session.send("Що зараз по Extract?")).startsWith("SPECIALIST EXACT"));
  assert.equal(records.length, 1);
  assert.equal(records[0].modelIterations, 2);
  assert.equal(records[0].toolCalls, 0);
  session.close();
});

// ---------------------------------------------------------------------------------------------
// Issue #31: every Trello mutation is verified against its OWN target and its OWN requested
// result. These drive the real `connectToDjonik` pipeline with scripted event streams and assert
// the SAFE outcome (the audit R1/R2/R6 reproductions must no longer report success).
// ---------------------------------------------------------------------------------------------

const DUE_A = "2026-09-21T21:30:00.000Z"; // Kyiv: вівторок, 22 вересня 2026, 00:30
const DUE_KYIV_A = "вівторок, 22 вересня 2026, 00:30 за Києвом";

function msg(text: string): unknown {
  return { type: "agent.message", content: [{ type: "text", text }] };
}

/** The text of the n-th event batch the client sent to the provider (0 = the user turn). */
function sentText(sendCalls: unknown[], index: number): string {
  const call = sendCalls[index] as { events: Array<{ content: Array<{ text?: string }> }> };
  return call.events[0].content.map((block) => block.text ?? "").join("");
}

async function connect(events: unknown[], agent?: unknown) {
  const fake = createFakeClient(events, agent);
  const session = await connectToDjonik(fake.client, "agent_x", "env_x", "memstore_x", "vlt_x");
  return { ...fake, session };
}

async function unverified(promise: Promise<string>): Promise<DjonikUnverifiedMutationError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DjonikUnverifiedMutationError, `expected DjonikUnverifiedMutationError, got ${String(error)}`);
    return error;
  }
  assert.fail("the turn must fail closed instead of returning the model's reply");
}

test("#31 R1: create A followed only by an unrelated board read never verifies A", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "create", name: "A" }),
    mcpToolResult("w", false, cardContent({ id: "A", name: "A" })),
    mcpToolUse("r", "trelloReadBoard", { action: "get", boardId: "other" }),
    mcpToolResult("r", false, cardContent({ id: "other", name: "Other board" })),
    msg("Created A"),
    IDLE,
    // Corrective turn: still only a board read.
    mcpToolUse("r2", "trelloReadBoard", { action: "get", boardId: "other" }),
    mcpToolResult("r2", false, cardContent({ id: "other" })),
    msg("Created A, really"),
    IDLE,
  ]);

  const error = await unverified(session.send("Створи картку A"));

  assert.equal(sendCalls.length, 2, "exactly one bounded corrective nudge");
  assert.match(sentText(sendCalls, 1), /A/, "the nudge names the card to read");
  assert.match(sentText(sendCalls, 1), /НЕ повторюй запис/, "the nudge must never ask for the write to be replayed");
  assert.deepEqual(error.outcomes.map((o) => o.status), ["awaiting_read"]);
  assert.match(error.message, /did not verify the write/);
  assert.match(error.message, /⚠️ НЕ підтверджено.*«A» \(A\)/);
  assert.equal(error.modelReply, "Created A, really", "the unvetted model text is exposed only as data, not as the outcome");
  session.close();
});

test("#31 R2: writes A and B with a direct read of B only — B verifies, A is reported unresolved", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "new B" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("r", false, cardContent({ id: "B", name: "new B" })),
    msg("Updated both"),
    IDLE,
    msg("Yes, both are updated"), // corrective turn: no read of A
    IDLE,
  ]);

  const error = await unverified(session.send("Онови A і B"));

  assert.equal(sendCalls.length, 2);
  assert.match(sentText(sendCalls, 1), /\bA\b/);
  assert.doesNotMatch(sentText(sendCalls, 1), /\bB\b/, "the nudge asks only for the unresolved card, not the verified one");
  assert.deepEqual(error.outcomes.map((o) => o.status), ["awaiting_read", "verified"]);
  assert.match(error.message, /⚠️ НЕ підтверджено.*«new A» \(A\)/);
  assert.match(error.message, /✅ Підтверджено.*«new B» \(B\)/, "the verified part of a partial outcome is preserved");
  session.close();
});

test("#31 R2 recovery: the one corrective nudge reads A after B, and both then verify", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "new B" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("r", false, cardContent({ id: "B", name: "new B" })),
    msg("Updated both"),
    IDLE,
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r2", false, cardContent({ id: "A", name: "new A" })),
    msg("Перевірив обидві."),
    IDLE,
  ]);

  assert.equal(await session.send("Онови A і B"), "Перевірив обидві.");
  assert.equal(sendCalls.length, 2);
  session.close();
});

test("#31: both writes followed by their own correct direct reads verify independently with no nudge", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "new B" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", name: "new A" })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "new B" })),
    msg("Обидві картки оновлено."),
    IDLE,
  ]);

  assert.equal(await session.send("Онови A і B"), "Обидві картки оновлено.");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31: a direct read that happened BEFORE the write does not verify the later write", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("r0", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r0", false, cardContent({ id: "A", name: "new A" })),
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    msg("Готово."),
    IDLE,
    msg("Так, все ок."),
    IDLE,
  ]);

  const error = await unverified(session.send("Онови A"));
  assert.equal(sendCalls.length, 2);
  assert.deepEqual(error.outcomes.map((o) => o.status), ["awaiting_read"]);
  session.close();
});

for (const [label, readEvents] of [
  [
    "a direct read of a DIFFERENT card",
    [
      mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
      mcpToolResult("r", false, cardContent({ id: "B", name: "new A" })),
    ],
  ],
  [
    "an errored direct read of the right card",
    [
      mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
      mcpToolResult("r", true, cardContent({ id: "A", name: "new A" })),
    ],
  ],
  [
    "an ambiguous (id-less) direct read result",
    [
      mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
      mcpToolResult("r", false, [{ type: "text", text: "Картка виглядає нормально" }]),
    ],
  ],
  [
    "a trelloSearch that happens to list the card",
    [
      mcpToolUse("r", "trelloSearch", { action: "search_cards", query: "A" }),
      mcpToolResult("r", false, cardContent({ id: "A", name: "new A" })),
    ],
  ],
] as const) {
  test(`#31: ${label} does not verify the write (one nudge, then fail closed)`, async () => {
    const { session, sendCalls } = await connect([
      mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }),
      mcpToolResult("w", false, cardContent({ id: "A" })),
      ...readEvents,
      msg("Готово."),
      IDLE,
      msg("Все ще готово."),
      IDLE,
    ]);

    const error = await unverified(session.send("Онови A"));
    assert.equal(sendCalls.length, 2);
    assert.deepEqual(error.outcomes.map((o) => o.status), ["awaiting_read"]);
    session.close();
  });
}

test("#31: a create whose result exposes no unambiguous card id stays unverified and cannot be fixed by a nudge", async () => {
  for (const content of [
    undefined,
    [{ type: "text", text: "Card created" }],
    cardContent({ name: "A" }),
    [
      { type: "text", text: JSON.stringify({ id: "A" }) },
      { type: "text", text: JSON.stringify({ id: "B" }) },
    ],
  ]) {
    const { session, sendCalls } = await connect([
      mcpToolUse("w", "trelloWriteCard", { action: "create", name: "A" }),
      mcpToolResult("w", false, content),
      // Even a perfect-looking read afterwards cannot retroactively identify the created card.
      mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
      mcpToolResult("r", false, cardContent({ id: "A", name: "A" })),
      msg("Створено A"),
      IDLE,
    ]);

    const error = await unverified(session.send("Створи A"));
    assert.equal(sendCalls.length, 1, "no nudge: another read cannot identify an unidentified create");
    assert.deepEqual(error.outcomes.map((o) => o.status), ["target_unknown"]);
    assert.match(error.message, /немає ID картки/);
    session.close();
  }
});

test("#31: create result id A followed by a direct read of A verifies and returns the reply as-is", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "create", name: "Нова картка", desc: "опис", listId: "L1" }),
    mcpToolResult("w", false, cardContent({ id: "A", name: "Нова картка" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", name: "Нова картка", desc: "опис", list: { id: "L1", name: "Backlog" } })),
    msg("Створено «Нова картка» у Backlog."),
    IDLE,
  ]);

  assert.equal(await session.send("Створи картку"), "Створено «Нова картка» у Backlog.");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31 postconditions: a verified read whose requested field differs is NOT reported as success", async () => {
  const { session } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", listId: "DONE" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", list: { id: "BACKLOG", name: "Backlog" } })),
    msg("Переніс у Done."),
    IDLE,
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r2", false, cardContent({ id: "A", list: { id: "BACKLOG", name: "Backlog" } })),
    msg("Переніс у Done, точно."),
    IDLE,
  ]);

  const error = await unverified(session.send("Перенеси A у Done"));
  assert.deepEqual(error.outcomes.map((o) => o.status), ["field_mismatch"]);
  assert.match(error.message, /Trello після запису показує інші значення: список/);
  session.close();
});

test("#31 move: a same-card read showing the requested list verifies", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", listId: "DONE" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", list: { id: "DONE", name: "Done" } })),
    msg("Переніс у Done."),
    IDLE,
  ]);
  assert.equal(await session.send("Перенеси A у Done"), "Переніс у Done.");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31 R6: card due:null with a nested unrelated board.due is never confirmed with the board's due", async () => {
  const boardDue = "2026-09-25T10:00:00.000Z";
  assert.equal(
    extractVerifiedDueFromTrelloReadContent(cardContent({ id: "cardA", due: null, board: { id: "b", due: boardDue } })),
    null,
    "extraction is anchored to the verified card object",
  );
  assert.equal(
    extractVerifiedDueFromTrelloReadContent(cardContent({ id: "cardA", board: { id: "b", due: boardDue } })),
    null,
    "a missing card due is not filled from a nested object either",
  );

  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "cardA", due: DUE_A }),
    mcpToolResult("w", false, cardContent({ id: "cardA" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "cardA" }),
    mcpToolResult("r", false, cardContent({ id: "cardA", due: null, board: { id: "b", due: boardDue } })),
    msg("Дедлайн виставлено."),
    IDLE,
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "cardA" }),
    mcpToolResult("r2", false, cardContent({ id: "cardA", due: null, board: { id: "b", due: boardDue } })),
    msg("Дедлайн виставлено, точно."),
    IDLE,
  ]);

  const error = await unverified(session.send("Постав дедлайн"));
  assert.equal(sendCalls.length, 2);
  assert.deepEqual(error.outcomes.map((o) => o.status), ["field_mismatch"]);
  assert.doesNotMatch(error.message, /25 вересня/, "the board's due must never be presented as the card's");
  session.close();
});

test("#31: sequential writes to the SAME card resolve from one final read of the latest value", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w1", "trelloWriteCard", { action: "update", cardId: "A", name: "Перша" }),
    mcpToolResult("w1", false, cardContent({ id: "A" })),
    mcpToolUse("w2", "trelloWriteCard", { action: "update", cardId: "A", name: "Друга" }),
    mcpToolResult("w2", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", name: "Друга" })),
    msg("Назву змінено на «Друга»."),
    IDLE,
  ]);
  assert.equal(await session.send("Перейменуй A двічі"), "Назву змінено на «Друга».");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31: sequential writes to the same card fail closed when the final read shows a stale value", async () => {
  const { session } = await connect([
    mcpToolUse("w1", "trelloWriteCard", { action: "update", cardId: "A", name: "Перша" }),
    mcpToolResult("w1", false, cardContent({ id: "A" })),
    mcpToolUse("w2", "trelloWriteCard", { action: "update", cardId: "A", name: "Друга" }),
    mcpToolResult("w2", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", name: "Перша" })),
    msg("Змінено."),
    IDLE,
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r2", false, cardContent({ id: "A", name: "Перша" })),
    msg("Змінено."),
    IDLE,
  ]);
  const error = await unverified(session.send("Перейменуй A двічі"));
  assert.ok(error.outcomes.every((o) => o.status === "field_mismatch"));
  session.close();
});

test("#31 partial failure: a tool-errored write plus a verified write return a deterministic mixed report, not model text", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("a", true),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "Bravo" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "Bravo" })),
    msg("Створив Alpha і оновив Bravo."),
    IDLE,
  ]);

  const reply = await session.send("Створи Alpha і онови Bravo");

  assert.equal(sendCalls.length, 1, "a failed write is not retried or nudged");
  assert.equal(
    reply,
    ["❌ Не виконано (помилка інструмента): «Alpha»", "✅ Підтверджено читанням картки: «Bravo» (B)"].join("\n"),
  );
  assert.doesNotMatch(reply, /Створив Alpha/, "the model's claim that Alpha was created never reaches the user");
  session.close();
});

test("#31 partial failure: failed A + verified B + unverified C fails closed with all three reported", async () => {
  const { session } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("a", true),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "Bravo" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("c", "trelloWriteCard", { action: "update", cardId: "C", name: "Charlie" }),
    mcpToolResult("c", false, cardContent({ id: "C" })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "Bravo" })),
    msg("Усе зроблено."),
    IDLE,
    msg("Так, усе."),
    IDLE,
  ]);
  const error = await unverified(session.send("Alpha, Bravo, Charlie"));
  assert.deepEqual(error.outcomes.map((o) => o.status), ["failed", "verified", "awaiting_read"]);
  assert.match(error.message, /❌.*«Alpha»/);
  assert.match(error.message, /✅.*«Bravo»/);
  assert.match(error.message, /⚠️.*«Charlie»/);
  session.close();
});

test("#31: a write with no result event is unresolved (whether it applied is unknown) and is not nudged into a replay", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", name: "n" }),
    msg("Готово."),
    IDLE,
  ]);
  const error = await unverified(session.send("Онови A"));
  assert.equal(sendCalls.length, 1);
  assert.deepEqual(error.outcomes.map((o) => o.status), ["no_result"]);
  session.close();
});

test("#31: a write replayed during the corrective nudge is a NEW tracked mutation and never launders the original", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "create", name: "A" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    msg("Створено."),
    IDLE,
    // Misbehaving corrective turn: creates a duplicate instead of reading A.
    mcpToolUse("w2", "trelloWriteCard", { action: "create", name: "A" }),
    mcpToolResult("w2", false, cardContent({ id: "A2" })),
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "A2" }),
    mcpToolResult("r2", false, cardContent({ id: "A2", name: "A" })),
    msg("Перевірено."),
    IDLE,
  ]);
  const error = await unverified(session.send("Створи A"));
  assert.equal(sendCalls.length, 2, "still only one nudge");
  assert.deepEqual(error.outcomes.map((o) => o.status), ["awaiting_read", "verified"]);
  session.close();
});

test("#31 #23: a verified due write still owns the whole confirmation (single mutation, mismatch reporting preserved)", async () => {
  const same = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", due: DUE_A }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", due: DUE_A, board: { due: "2026-01-01T00:00:00.000Z" } })),
    msg("Понеділок, 22 вересня"),
    IDLE,
  ]);
  assert.equal(await same.session.send("Дедлайн A"), `Готово. Trello підтвердив дедлайн: ${DUE_KYIV_A}.`);
  same.session.close();

  const differs = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", due: DUE_A })),
    msg("Готово"),
    IDLE,
  ]);
  assert.equal(
    await differs.session.send("Дедлайн A"),
    `Картку оновлено, але Trello підтвердив дедлайн: ${DUE_KYIV_A}. Це відрізняється від значення, яке було відправлено.`,
  );
  differs.session.close();
});

test("#31 #23: several verified mutations with due dates get one deterministic line each — no model wording survives", async () => {
  const { session } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "Alpha", due: DUE_A }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "Bravo", due: "2026-09-19T19:00:00.000Z" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", name: "Alpha", due: DUE_A })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "Bravo", due: "2026-09-19T19:00:00.000Z" })),
    msg("Alpha — понеділок, Bravo — неділя"),
    IDLE,
  ]);
  const reply = await session.send("Постав дедлайни");
  assert.equal(
    reply,
    [
      `«Alpha» (A): Готово. Trello підтвердив дедлайн: ${DUE_KYIV_A}.`,
      "«Bravo» (B): Готово. Trello підтвердив дедлайн: субота, 19 вересня 2026, 22:00 за Києвом.",
    ].join("\n"),
  );
  session.close();
});

test("#31: a verified due write next to an unrelated failed write is reported deterministically for both", async () => {
  const { session } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", due: DUE_A }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("x", "trelloWriteCard", { action: "create", name: "Zed" }),
    mcpToolResult("x", true),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", due: DUE_A })),
    msg("Усе гаразд, Zed теж створено"),
    IDLE,
  ]);
  const reply = await session.send("Дедлайн A і створи Zed");
  assert.equal(
    reply,
    [`✅ картка A: Готово. Trello підтвердив дедлайн: ${DUE_KYIV_A}.`, "❌ Не виконано (помилка інструмента): «Zed»"].join("\n"),
  );
  session.close();
});

test("#31: Project Health read-only path is unaffected — Trello reads plus one exact specialist result still relay exactly", async () => {
  const { session, sendCalls } = await connect(
    [
      threadCreated(),
      mcpToolUse("s", "trelloSearch", { action: "search_boards", query: "Extract" }),
      mcpToolResult("s", false, cardContent({ id: "board", name: "Extract" })),
      mcpToolUse("r", "trelloReadCard", { action: "list_by_board", boardIdOrUrl: "board" }),
      mcpToolResult("r", false, cardContent({ nodes: [] })),
      specialistMessage("SPECIALIST EXACT"),
      primaryMessage("coordinator rewrite"),
      IDLE,
    ],
    projectHealthSessionAgent(),
  );
  const reply = await session.send("Що зараз по Extract?");
  assert.ok(reply.startsWith("SPECIALIST EXACT") && !reply.includes("coordinator rewrite") && reply.includes(WITHHELD_NOTICE));
  assert.equal(sendCalls.length, 1, "read-only turns never trigger a verification nudge");
  session.close();
});

test("#31 FIFO: an unverified turn does not leak its ledger into the next queued turn, and the session stays usable", async () => {
  const { client, sendCalls, push } = createStreamedFakeClient();
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const p1 = session.send("Онови A");
  const p2 = session.send("Онови B");
  const outcome1 = p1.then(
    () => "resolved",
    (error: unknown) => error,
  );

  await flushMicrotasks();
  assert.equal(sendCalls.length, 1);
  // Turn 1: write A, never read A — even after the corrective nudge.
  push(mcpToolUse("w1", "trelloWriteCard", { action: "update", cardId: "A", name: "new A" }));
  push(mcpToolResult("w1", false, cardContent({ id: "A" })));
  push(msg("Готово A."));
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "turn 1's own single nudge, before turn 2 may start");
  push(msg("Так, A готово."));
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.ok((await outcome1) instanceof DjonikUnverifiedMutationError);

  await flushMicrotasks();
  assert.equal(sendCalls.length, 3, "the queued turn 2 starts only after turn 1 fully settled");
  // Turn 2: a clean, fully verified write of a DIFFERENT card. A's stale requirement must not apply.
  push(mcpToolUse("w2", "trelloWriteCard", { action: "update", cardId: "B", name: "new B" }));
  push(mcpToolResult("w2", false, cardContent({ id: "B" })));
  push(mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }));
  push(mcpToolResult("r2", false, cardContent({ id: "B", name: "new B" })));
  push(msg("B готово."));
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  assert.equal(await p2, "B готово.");
  assert.equal(sendCalls.length, 3, "no nudge for the clean second turn");

  session.close();
});

// ---------------------------------------------------------------------------------------------
// #31 follow-up review: (1) a tool-errored mutation must never reach the user as model-authored
// success; (2) the #23 intended-vs-verified due mismatch is an explicit, terminal, deterministic
// outcome — never nudged/replayed, never stating the requested due as fact.
// ---------------------------------------------------------------------------------------------

const FALSE_SUCCESS = "Готово! Усе виконано успішно.";

for (const [label, input] of [
  ["create", { action: "create", name: "Нова" }],
  ["update", { action: "update", cardId: "A", name: "Нова" }],
  ["move", { action: "update", cardId: "A", listId: "DONE" }],
] as const) {
  test(`#31 failed ${label}: a single errored write + a model that claims success → the user only sees the failure`, async () => {
    const { session, sendCalls } = await connect([
      mcpToolUse("w", "trelloWriteCard", input),
      mcpToolResult("w", true, [{ type: "text", text: "Trello API 400" }]),
      msg(FALSE_SUCCESS),
      IDLE,
    ]);

    const reply = await session.send("Зроби це");

    assert.match(reply, /^❌ Не виконано \(помилка інструмента\): /);
    assert.match(reply, /Trello API 400/, "the tool's own error text is surfaced");
    assert.doesNotMatch(reply, /Готово|успішно/, "no model-authored success text");
    assert.equal(sendCalls.length, 1, "a failed write is never nudged, so it can never be replayed");
    session.close();
  });
}

test("#31 failed write: a trivial model reply is irrelevant to the failure report", async () => {
  const { session } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", name: "n" }),
    mcpToolResult("w", true),
    msg("."),
    IDLE,
  ]);
  assert.equal(await session.send("Онови A"), "❌ Не виконано (помилка інструмента): «n» (A)");
  session.close();
});

test("#31 failed + verified: only the deterministic report reaches the user; a model that says both succeeded is not used", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "Alpha" }),
    mcpToolResult("a", true, [{ type: "text", text: "card locked" }]),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "Bravo" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "Bravo" })),
    msg("Обидві картки оновлено!"),
    IDLE,
  ]);
  const reply = await session.send("Онови A і B");
  assert.equal(
    reply,
    [
      "❌ Не виконано (помилка інструмента): «Alpha» (A) — card locked",
      "✅ Підтверджено читанням картки: «Bravo» (B)",
    ].join("\n"),
  );
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31 failed + unresolved: the turn fails closed; the report names the failed write and the nudge only asks about the unresolved card", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "Alpha" }),
    mcpToolResult("a", true, [{ type: "text", text: "card locked" }]),
    mcpToolUse("c", "trelloWriteCard", { action: "update", cardId: "C", name: "Charlie" }),
    mcpToolResult("c", false, cardContent({ id: "C" })),
    msg("Обидві оновлено!"),
    IDLE,
    msg("Так, обидві."), // corrective turn: C is still not read
    IDLE,
  ]);

  const error = await unverified(session.send("Онови A і C"));

  assert.equal(sendCalls.length, 2, "exactly one nudge");
  assert.match(sentText(sendCalls, 1), /\bC\b/);
  assert.doesNotMatch(sentText(sendCalls, 1), /\bA\b/, "the nudge never asks about (or for a retry of) the failed write");
  assert.deepEqual(error.outcomes.map((o) => o.status), ["failed", "awaiting_read"]);
  assert.match(error.message, /❌ Не виконано \(помилка інструмента\): «Alpha» \(A\) — card locked/);
  assert.match(error.message, /⚠️ НЕ підтверджено: «Charlie» \(C\)/);
  assert.doesNotMatch(error.message, /Обидві|Так, обидві/, "the model's text is not part of the message");
  session.close();
});

test("#31 failed write: a write REPLAYED during the corrective nudge is a new mutation; the original failure still stands in the report", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("a", true, [{ type: "text", text: "temporary error" }]),
    mcpToolUse("c", "trelloWriteCard", { action: "update", cardId: "C", name: "Charlie" }),
    mcpToolResult("c", false, cardContent({ id: "C" })),
    msg("Готово."),
    IDLE,
    // Misbehaving corrective turn: replays the failed create (succeeding this time) and reads C.
    mcpToolUse("a2", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("a2", false, cardContent({ id: "A2", name: "Alpha" })),
    mcpToolUse("rc", "trelloReadCard", { action: "get", cardIdOrUrl: "C" }),
    mcpToolResult("rc", false, cardContent({ id: "C", name: "Charlie" })),
    mcpToolUse("ra2", "trelloReadCard", { action: "get", cardIdOrUrl: "A2" }),
    mcpToolResult("ra2", false, cardContent({ id: "A2", name: "Alpha" })),
    msg("Перевірено."),
    IDLE,
  ]);
  const reply = await session.send("Створи Alpha, онови Charlie");
  assert.equal(sendCalls.length, 2, "still only one nudge");
  // The replay is tracked as its own verified mutation; the ORIGINAL failure is never erased or laundered.
  assert.equal(
    reply,
    [
      "❌ Не виконано (помилка інструмента): «Alpha» — temporary error",
      "✅ Підтверджено читанням картки: «Charlie» (C)",
      "✅ Підтверджено читанням картки: «Alpha» (A2)",
    ].join("\n"),
  );
  session.close();
});

test("#31 failed write with no tool error text still reports a failure and never success", async () => {
  const { session } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("w", true),
    msg(FALSE_SUCCESS),
    IDLE,
  ]);
  assert.equal(await session.send("Створи Alpha"), "❌ Не виконано (помилка інструмента): «Alpha»");
  session.close();
});

test("#31 failed write: an over-long tool error is bounded", async () => {
  const { session } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "create", name: "Alpha" }),
    mcpToolResult("w", true, [{ type: "text", text: "x".repeat(1000) }]),
    msg(FALSE_SUCCESS),
    IDLE,
  ]);
  const reply = await session.send("Створи Alpha");
  assert.ok(reply.length < 300, `bounded, was ${reply.length}`);
  assert.match(reply, /…$/);
  session.close();
});

test("#31 #23 due mismatch: Trello holds a different due — the reply states ONLY the verified due, one read, no nudge, no replay", async () => {
  const traces: DjonikTraceEvent[] = [];
  const fake = createFakeClient([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", due: DUE_A })),
    msg("Готово, дедлайн 22 вересня о 03:00 за Києвом"),
    IDLE,
  ]);
  const session = await connectToDjonik(fake.client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event));

  const reply = await session.send("Постав дедлайн A");

  assert.equal(
    reply,
    `Картку оновлено, але Trello підтвердив дедлайн: ${DUE_KYIV_A}. Це відрізняється від значення, яке було відправлено.`,
  );
  assert.doesNotMatch(reply, /03:00/, "neither the requested nor the model's due is asserted");
  assert.equal(fake.sendCalls.length, 1, "a differing due is terminal: no corrective nudge, so no replay");
  assert.equal(traces.filter((e) => e.type === "verification_nudge_sent").length, 0);
  assert.deepEqual(
    traces.filter((e) => e.type === "due_date_reply_finalized"),
    [{ type: "due_date_reply_finalized", verifiedDue: DUE_A, kyivDate: "2026-09-22", weekdayEn: "Tuesday", mismatch: true }],
  );
  session.close();
});

test("#31 #23 due mismatch next to a failed write: report shows the verified due for one and the failure for the other", async () => {
  const { session } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "Alpha", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("x", "trelloWriteCard", { action: "create", name: "Zed" }),
    mcpToolResult("x", true),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", name: "Alpha", due: DUE_A })),
    msg("Усе зроблено як просили"),
    IDLE,
  ]);
  const reply = await session.send("Alpha і Zed");
  assert.equal(
    reply,
    [
      `⚠️ «Alpha» (A): Картку оновлено, але Trello підтвердив дедлайн: ${DUE_KYIV_A}. Це відрізняється від значення, яке було відправлено.`,
      "❌ Не виконано (помилка інструмента): «Zed»",
    ].join("\n"),
  );
  session.close();
});

test("#31 #23 due mismatch alongside an unresolved mutation: fails closed, and the report still states only the verified due", async () => {
  const { session } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("c", "trelloWriteCard", { action: "update", cardId: "C", name: "Charlie" }),
    mcpToolResult("c", false, cardContent({ id: "C" })),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", due: DUE_A })),
    msg("Усе гаразд"),
    IDLE,
    msg("Так"),
    IDLE,
  ]);
  const error = await unverified(session.send("A і C"));
  assert.deepEqual(error.outcomes.map((o) => o.status), ["due_differs", "awaiting_read"]);
  assert.match(error.message, new RegExp(`⚠️ картка A: Картку оновлено, але Trello підтвердив дедлайн: ${DUE_KYIV_A}`));
  assert.match(error.message, /⚠️ НЕ підтверджено: «Charlie» \(C\)/);
  session.close();
});

test("#31 #23 due mismatch: several mutations — a differing due gets its own deterministic mismatch line", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("a", "trelloWriteCard", { action: "update", cardId: "A", name: "Alpha", due: "2026-09-22T00:00:00.000Z" }),
    mcpToolResult("a", false, cardContent({ id: "A" })),
    mcpToolUse("b", "trelloWriteCard", { action: "update", cardId: "B", name: "Bravo", due: "2026-09-19T19:00:00.000Z" }),
    mcpToolResult("b", false, cardContent({ id: "B" })),
    mcpToolUse("ra", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("ra", false, cardContent({ id: "A", name: "Alpha", due: DUE_A })),
    mcpToolUse("rb", "trelloReadCard", { action: "get", cardIdOrUrl: "B" }),
    mcpToolResult("rb", false, cardContent({ id: "B", name: "Bravo", due: "2026-09-19T19:00:00.000Z" })),
    msg("Обидва дедлайни виставлено як просили"),
    IDLE,
  ]);
  const reply = await session.send("Дедлайни");
  assert.equal(
    reply,
    [
      `«Alpha» (A): Картку оновлено, але Trello підтвердив дедлайн: ${DUE_KYIV_A}. Це відрізняється від значення, яке було відправлено.`,
      "«Bravo» (B): Готово. Trello підтвердив дедлайн: субота, 19 вересня 2026, 22:00 за Києвом.",
    ].join("\n"),
  );
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#31 #23 due: an explicit card due:null after a set-due write is NOT a differing-due outcome — it is unresolved and fails closed", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: "A", due: DUE_A }),
    mcpToolResult("w", false, cardContent({ id: "A" })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" }),
    mcpToolResult("r", false, cardContent({ id: "A", due: null })),
    msg("Дедлайн виставлено."),
    IDLE,
    msg("Так."),
    IDLE,
  ]);
  const error = await unverified(session.send("Дедлайн A"));
  assert.equal(sendCalls.length, 2, "a null due can still be a stale read, so it gets the one nudge before failing closed");
  assert.deepEqual(error.outcomes.map((o) => o.status), ["field_mismatch"]);
  session.close();
});

// ---------------------------------------------------------------------------------------------
// Issue #37: project label on create, verified by the #31 per-mutation boundary. Events use the
// live Trello MCP shapes recorded in Session history (docs/33 §3): ARIs, `attach_label` as its own
// `trelloWriteCard` mutation, and `{cards:{nodes:[card],totalCount:1}}` results.
// ---------------------------------------------------------------------------------------------

const L37_WS = "5f1a2b3c4d5e6f708192a3b4";
const L37_CARD = `ari:cloud:trello::card/workspace/${L37_WS}/6aad12eb1d878e89bdc4a657`;
const L37_LIST = `ari:cloud:trello::list/workspace/${L37_WS}/68c0a1b2c3d4e5f60718293a`;
const L37_LABEL = `ari:cloud:trello::label/workspace/${L37_WS}/68c0aaaaaaaaaaaaaaaaaa01`;
const L37_EXTRACT = { color: "green", id: L37_LABEL, name: "Extract" };

function liveCardContent(overrides: Record<string, unknown> = {}): Array<{ type: string; text: string }> {
  const node = {
    id: L37_CARD,
    name: "Hero банер",
    desc: "",
    due: null,
    list: { id: L37_LIST, name: "Inbox" },
    labels: [],
    labelsHasMore: false,
    ...overrides,
  };
  return [{ type: "text", text: JSON.stringify({ cards: { nodes: [node], totalCount: 1 } }) }];
}

const L37_CREATE = mcpToolUse("c", "trelloWriteCard", { action: "create", listId: L37_LIST, name: "Hero банер" });
const L37_ATTACH = mcpToolUse("l", "trelloWriteCard", { action: "attach_label", cardId: L37_CARD, labelId: L37_LABEL });

test("#37: create + attach_label + direct read showing the label is full success on live result shapes (no nudge)", async () => {
  const { session, sendCalls } = await connect([
    L37_CREATE,
    mcpToolResult("c", false, liveCardContent()),
    L37_ATTACH,
    mcpToolResult("l", false, liveCardContent({ labels: [L37_EXTRACT] })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: L37_CARD }),
    mcpToolResult("r", false, liveCardContent({ labels: [L37_EXTRACT] })),
    msg("Створив «Hero банер» в Inbox з label Extract."),
    IDLE,
  ]);
  const reply = await session.send("Створи задачу по Extract: Hero банер");
  assert.equal(reply, "Створив «Hero банер» в Inbox з label Extract.");
  assert.equal(sendCalls.length, 1, "a fully verified create + label needs no corrective nudge");
  session.close();
});

test("#37: create verified + attach_label tool error → deterministic partial report, never the model's full-success text", async () => {
  const { session, sendCalls } = await connect([
    L37_CREATE,
    mcpToolResult("c", false, liveCardContent()),
    L37_ATTACH,
    mcpToolResult("l", true, [{ type: "text", text: "TrelloAddLabelToCard failed" }]),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: L37_CARD }),
    mcpToolResult("r", false, liveCardContent()),
    msg(FALSE_SUCCESS),
    IDLE,
  ]);
  const reply = await session.send("Створи задачу по Extract: Hero банер");
  assert.equal(
    reply,
    [
      `✅ Підтверджено читанням картки: «Hero банер» (${L37_CARD})`,
      `❌ Не виконано (помилка інструмента): label проєкту на картці «Hero банер» (${L37_CARD}) — TrelloAddLabelToCard failed`,
      "⚠️ Картку створено, але належність до проєкту (label) НЕ підтверджено — поки що вона без проєкту.",
    ].join("\n"),
  );
  assert.equal(sendCalls.length, 1, "a failed label write is never nudged into a retry");
  session.close();
});

test("#37: create verified + label absent on the direct read → one read nudge, then fail closed as a partial project assignment", async () => {
  const { session, sendCalls } = await connect([
    L37_CREATE,
    mcpToolResult("c", false, liveCardContent()),
    L37_ATTACH,
    mcpToolResult("l", false, liveCardContent({ labels: [L37_EXTRACT] })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: L37_CARD }),
    mcpToolResult("r", false, liveCardContent()),
    msg("Готово, картка в проєкті Extract."),
    IDLE,
    mcpToolUse("r2", "trelloReadCard", { action: "get", cardIdOrUrl: L37_CARD }),
    mcpToolResult("r2", false, liveCardContent()),
    msg("Так, усе в Extract."),
    IDLE,
  ]);
  const error = await unverified(session.send("Створи задачу по Extract: Hero банер"));
  assert.equal(sendCalls.length, 2, "exactly one bounded corrective read nudge");
  assert.match(sentText(sendCalls, 1), /НЕ повторюй запис/);
  assert.deepEqual(error.outcomes.map((o) => o.status), ["verified", "field_mismatch"]);
  assert.match(error.message, /✅ Підтверджено читанням картки: «Hero банер»/);
  assert.match(error.message, /⚠️ НЕ підтверджено: label проєкту на картці «Hero банер»/);
  assert.match(error.message, /Картку створено, але належність до проєкту \(label\) НЕ підтверджено/);
  session.close();
});

test("#37: the live {cards:{nodes}} read shape now carries the #23 verified-due confirmation end to end", async () => {
  const { session, sendCalls } = await connect([
    mcpToolUse("w", "trelloWriteCard", { action: "update", cardId: L37_CARD, due: DUE_A }),
    mcpToolResult("w", false, liveCardContent({ due: DUE_A })),
    mcpToolUse("r", "trelloReadCard", { action: "get", cardIdOrUrl: L37_CARD }),
    mcpToolResult("r", false, liveCardContent({ due: DUE_A })),
    msg("Дедлайн — понеділок, 21 вересня."),
    IDLE,
  ]);
  const reply = await session.send("Дедлайн Hero банер");
  assert.equal(reply, `Готово. Trello підтвердив дедлайн: ${DUE_KYIV_A}.`);
  assert.equal(sendCalls.length, 1);
  session.close();
});
