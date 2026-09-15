import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik } from "./djonikClient.js";

/**
 * Minimal fake of the Anthropic client surface `connectToDjonik` touches.
 * Only `beta.sessions.create` is asserted on here; the stream is a stub that
 * immediately reports the session idle so `close()` has something to abort.
 */
function createFakeClient(): { client: Anthropic; createCalls: unknown[] } {
  const createCalls: unknown[] = [];

  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next: async () => {
          if (done) return { value: undefined, done: true };
          done = true;
          return { value: { type: "session.status_idle" }, done: false };
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

test("connectToDjonik attaches the Djonik Memory Store as a read_write session resource", async () => {
  const { client, createCalls } = createFakeClient();

  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x");

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    agent: "agent_x",
    environment_id: "env_x",
    resources: [
      {
        type: "memory_store",
        memory_store_id: "memstore_x",
        access: "read_write",
        instructions:
          "Persistent PM memory across sessions. Write only durable, useful context: " +
          "stable work preferences, client/project facts, important decisions, recurring " +
          "patterns, PM lessons. Do not store live Trello/task state, transient chat, or " +
          "anything trivial. Fresh external tool reads always outrank what is remembered here.",
      },
    ],
  });
  assert.equal(session.sessionId, "session_test123");

  session.close();
});
