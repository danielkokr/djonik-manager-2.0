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
  type DjonikTurnTelemetry,
} from "./djonikClient.js";

/**
 * Minimal fake of the Anthropic client surface `connectToDjonik` touches.
 * `events` is the scripted sequence the fake stream yields for the one
 * `send()` call each test makes; `createCalls` records every
 * `beta.sessions.create` invocation for assertions on session wiring.
 */
function createFakeClient(events: unknown[]): { client: Anthropic; createCalls: unknown[]; sendCalls: unknown[] } {
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
          return { id: "session_test123" };
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
function createStreamedFakeClient(): { client: Anthropic; createCalls: unknown[]; sendCalls: unknown[]; push: (event: unknown) => void } {
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
          return { id: "session_test123" };
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
const IDLE = { type: "session.status_idle" };

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
    mcpToolUse("call_1", "trelloWriteCard"),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard"),
    mcpToolResult("call_2"),
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
    mcpToolUse("call_1", "trelloWriteCard"),
    mcpToolResult("call_1"),
    AGENT_MESSAGE,
    IDLE,
    // Corrective turn: agent verifies with a read, then replies again.
    mcpToolUse("call_2", "trelloReadCard"),
    mcpToolResult("call_2"),
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
    mcpToolUse("call_1", "trelloWriteCard"),
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

test("a failed Trello write (is_error) does not require verification", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard"),
    mcpToolResult("call_1", true),
    { type: "agent.message", content: [{ type: "text", text: "Не вдалося створити картку." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Створи картку");

  assert.equal(reply, "Не вдалося створити картку.");
  assert.equal(sendCalls.length, 1);
  session.close();
});

// --- Object-identity verification: a read only counts if it names the same card. ---

test("write card A then read card A verifies (same object id) and returns the reply as-is", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A", desc: "x" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2"),
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

test("a rejected due-clear write (is_error) does not require verification and reports honestly", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "" }),
    mcpToolResult("call_1", true),
    { type: "agent.message", content: [{ type: "text", text: "Не вдалося очистити дедлайн: інструмент не підтримує порожнє значення due." }] },
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");

  const reply = await session.send("Прибери дедлайн з картки A");

  assert.equal(reply, "Не вдалося очистити дедлайн: інструмент не підтримує порожнє значення due.");
  assert.equal(sendCalls.length, 1, "no corrective nudge should be sent for a failed write");
  session.close();
});

test("a due-clear write verified by a same-card read succeeds like any other write", async () => {
  const { client, sendCalls } = createFakeClient([
    mcpToolUse("call_1", "trelloWriteCard", { action: "update", cardId: "card_A", due: "" }),
    mcpToolResult("call_1"),
    mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }),
    mcpToolResult("call_2"),
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
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", cardId: "card_A" }),
    mcpToolResult("call_1"),
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
    mcpToolResult("call_2"),
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
    mcpToolUse("call_1", "trelloWriteCard", { action: "create", cardId: "card_A", due: "2026-09-19T19:00:00.000Z" }),
    mcpToolResult("call_1"),
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
    mcpToolResult("call_2", false, trelloCardReadContent("2026-09-21T21:30:00.000Z")),
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
  push({ type: "session.status_idle" });
  const reply1 = await p1;
  assert.equal(reply1, "Відповідь 1", "reply must stay attributed to the caller that sent turn 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "turn 2 starts its own provider send only once turn 1 has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });
  await assert.rejects(() => p1, /no text reply/);

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "the second queued turn must still start after the first one failed");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });
  await p1;

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
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
  push(mcpToolResult("call_2"));
  push({ type: "agent.message", content: [{ type: "text", text: "Готово (turn 1)." }] });
  push({ type: "session.status_idle" });

  assert.equal(await p1, "Готово (turn 1).", "turn 1 succeeds purely from its own verification");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "turn 2 only starts once turn 1's own verification has fully settled");
  push({ type: "agent.message", content: [{ type: "text", text: "Сонячно." }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });
  assert.equal(await p1, "Відповідь 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "sendOrdered's own provider turn starts only once send()'s turn has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });
  assert.equal(await p1, "Відповідь 1");

  await flushMicrotasks();
  assert.equal(sendCalls.length, 2, "send()'s turn starts only once sendOrdered()'s turn has fully settled");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });

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
  push({ type: "session.status_idle" });
  assert.equal(await p1, "Привіт!");

  push(mcpToolUse("call_1", "trelloWriteCard", { cardId: "card_A" }));
  push(mcpToolResult("call_1"));
  push(mcpToolUse("call_2", "trelloReadCard", { cardIdOrUrl: "card_A" }));
  push(mcpToolResult("call_2"));
  push({ type: "agent.message", content: [{ type: "text", text: "Готово (turn 2)." }] });
  push({ type: "session.status_idle" });
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
  push({ type: "session.status_idle" });

  assert.equal(
    await p1,
    "Готово. Trello підтвердив дедлайн: вівторок, 22 вересня 2026, 00:30 за Києвом.",
    "the #23 deterministic Kyiv weekday/date backstop must be unaffected by a second turn queued behind it",
  );

  push({ type: "agent.message", content: [{ type: "text", text: "Привіт!" }] });
  push({ type: "session.status_idle" });
  assert.equal(await p2, "Привіт!");

  session.close();
});
