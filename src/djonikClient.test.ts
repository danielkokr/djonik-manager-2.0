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
function createFakeClient(events: unknown[]): { client: Anthropic; createCalls: unknown[] } {
  const createCalls: unknown[] = [];

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
          send: async () => {},
        },
      },
    },
  } as unknown as Anthropic;

  return { client, createCalls };
}

const MEMORY_INSTRUCTIONS =
  "Persistent PM memory across sessions. Write only durable, useful context: " +
  "stable work preferences, client/project facts, important decisions, recurring " +
  "patterns, PM lessons. Do not store live Trello/task state, transient chat, or " +
  "anything trivial. Fresh external tool reads always outrank what is remembered here.";

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
