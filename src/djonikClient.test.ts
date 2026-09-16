import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik } from "./djonikClient.js";

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

function mcpToolResult(mcp_tool_use_id: string, is_error = false): unknown {
  return { type: "agent.mcp_tool_result", id: `${mcp_tool_use_id}_result`, mcp_tool_use_id, is_error };
}

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
