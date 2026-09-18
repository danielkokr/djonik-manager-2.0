import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik, type DjonikDocumentInput, type DjonikImageInput, type DjonikSessionHandle } from "./djonikClient.js";
import type { DjonikSessionManager } from "./telegramAdapter.js";
import { MessageGroupBuffer } from "./messageGrouping.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";

/**
 * Integration-level coverage for #25 Product Lead follow-up point 6:
 * "at the telegramCli integration level, not only MessageGroupBuffer unit
 * level, prove two grouped fragments produce exactly one call into the
 * Managed Agent session." This wires the real `MessageGroupBuffer` to the
 * real `createGroupDispatchHandlers` (the exact same production glue
 * `telegramCli.ts` uses) against a fake `DjonikSessionHandle`/session
 * manager and a fake Telegram `sendMessage` — no grammY `Bot`/`Context` and
 * no live network, but otherwise the real integration path.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WINDOW_MS = 30;

interface SendCall {
  text: string;
  image?: DjonikImageInput | DjonikImageInput[];
  document?: DjonikDocumentInput | DjonikDocumentInput[];
}

function createFakeSession(): { session: DjonikSessionHandle; calls: SendCall[] } {
  const calls: SendCall[] = [];
  const session: DjonikSessionHandle = {
    sessionId: "fake_session",
    send: async (text, image, document) => {
      calls.push({ text, image, document });
      return "Готово.";
    },
    close: () => {},
  };
  return { session, calls };
}

function createFakeSessionManager(session: DjonikSessionHandle): DjonikSessionManager {
  return {
    getSession: async () => session,
    closeIfOpen: () => {},
    invalidate: () => {},
  };
}

function setUp() {
  const { session, calls } = createFakeSession();
  const djonikSession = createFakeSessionManager(session);
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession,
    sendMessage: async (chatId, text) => {
      sentMessages.push({ chatId, text });
    },
    logError: () => {}, // keep test output quiet; not the thing under test
  });
  const buffer = new MessageGroupBuffer({
    adjacentWindowMs: WINDOW_MS,
    albumSettleWindowMs: WINDOW_MS,
    onDispatch,
    onFailure,
  });
  return { buffer, calls, sentMessages };
}

test("integration: two grouped text fragments produce exactly one Managed Agent session.send call", async () => {
  const { buffer, calls, sentMessages } = setUp();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "По Djonik треба оновити onboarding." });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 2, text: "Зроби з цього одну задачу, без дедлайну." });

  await sleep(WINDOW_MS + 40);

  assert.equal(calls.length, 1, "exactly one call into the Managed Agent session for the whole grouped intake");
  assert.equal(
    calls[0].text,
    "[Fragment 1]\nПо Djonik треба оновити onboarding.\n\n[Fragment 2]\nЗроби з цього одну задачу, без дедлайну.",
  );
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 1);
});

test("integration: text + image produces exactly one Managed Agent session.send call carrying both", async () => {
  const { buffer, calls } = setUp();
  const image: DjonikImageInput = { data: "aW1n", mediaType: "image/jpeg", byteSize: 42 };

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "ось референс" });
  buffer.addFragment({
    chatId: 1,
    userId: 100,
    messageId: 2,
    text: "",
    media: { kind: "image", promise: Promise.resolve(image) },
  });

  await sleep(WINDOW_MS + 40);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "ось референс");
  assert.deepEqual(calls[0].image, [image]);
  assert.equal(calls[0].document, undefined);
});

test("integration: text + PDF produces exactly one Managed Agent session.send call carrying both", async () => {
  const { buffer, calls } = setUp();
  const document: DjonikDocumentInput = { data: "cGRm", mediaType: "application/pdf", byteSize: 99, filename: "brief.pdf" };

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "деталі проєкту тут" });
  buffer.addFragment({
    chatId: 1,
    userId: 100,
    messageId: 2,
    text: "",
    media: { kind: "document", promise: Promise.resolve(document) },
  });

  await sleep(WINDOW_MS + 40);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "деталі проєкту тут");
  assert.deepEqual(calls[0].document, [document]);
  assert.equal(calls[0].image, undefined);
});

test("integration: a media_group_id album (3 items) produces exactly one Managed Agent session.send call", async () => {
  const { buffer, calls } = setUp();
  const images: DjonikImageInput[] = [
    { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 },
    { data: "Qg==", mediaType: "image/jpeg", byteSize: 2 },
    { data: "Qw==", mediaType: "image/jpeg", byteSize: 3 },
  ];

  buffer.addFragment({
    chatId: 1, userId: 100, messageId: 10, mediaGroupId: "album_1", text: "",
    media: { kind: "image", promise: Promise.resolve(images[0]) },
  });
  buffer.addFragment({
    chatId: 1, userId: 100, messageId: 11, mediaGroupId: "album_1", text: "",
    media: { kind: "image", promise: Promise.resolve(images[1]) },
  });
  buffer.addFragment({
    chatId: 1, userId: 100, messageId: 12, mediaGroupId: "album_1", text: "",
    media: { kind: "image", promise: Promise.resolve(images[2]) },
  });

  await sleep(WINDOW_MS + 40);

  assert.equal(calls.length, 1, "exactly one call for the whole 3-item album");
  assert.deepEqual(calls[0].image, images);
});

test("integration: a failed grouped attachment never calls session.send (structural zero-mutation guarantee)", async () => {
  const { buffer, calls, sentMessages } = setUp();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "зроби задачу з цього" });
  buffer.addFragment({
    chatId: 1,
    userId: 100,
    messageId: 2,
    text: "",
    media: { kind: "document", promise: Promise.reject(new Error("file too large")) },
  });

  await sleep(WINDOW_MS + 40);

  assert.equal(calls.length, 0, "session.send must never be called for a failed grouped intake");
  assert.equal(sentMessages.length, 1, "the user still gets exactly one visible failure message");
  assert.match(sentMessages[0].text, /file too large/);
});

// --- #25 live-validation blocker regression: two independent groups whose
// debounce timers happen to fire only a few ms apart must not race two
// concurrent turns on the same underlying Managed Session. This reproduces
// the exact live-validation incident (Scenario A: `groupingWaitMs` 1209 and
// 1215 — two singleton groups settling ~6ms apart) end-to-end, against a
// REAL `connectToDjonik` session (not the always-resolves-immediately fake
// used by the tests above), to prove the fix lives at the
// `DjonikSessionHandle` boundary, not merely in `MessageGroupBuffer`.

function createControllableAnthropicClient(): { client: Anthropic; sendCalls: unknown[]; push: (event: unknown) => void } {
  const sendCalls: unknown[] = [];
  const queue: unknown[] = [];
  const waiters: Array<(event: unknown) => void> = [];

  function push(event: unknown): void {
    const waiter = waiters.shift();
    if (waiter) waiter(event);
    else queue.push(event);
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
        create: async () => ({ id: "session_test123" }),
        events: {
          stream: async () => stream,
          send: async (_sessionId: string, params: unknown) => {
            sendCalls.push(params);
          },
        },
      },
    },
  } as unknown as Anthropic;

  return { client, sendCalls, push };
}

test("integration (#25 live-validation blocker): two independent groups settling ~6ms apart still serialize into two separate, correctly-attributed Managed Session turns", async () => {
  const { client, sendCalls, push } = createControllableAnthropicClient();
  const realSession = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  const djonikSession = createFakeSessionManager(realSession);
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession,
    sendMessage: async (chatId, text) => { sentMessages.push({ chatId, text }); },
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });

  // Group 1: a genuine standalone fragment, left alone long enough to settle on its own.
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "Тест A, фрагмент 1" });
  await sleep(20);
  // Group 2: a second, independent standalone fragment (outside group 1's window,
  // exactly like the live incident) whose own timer will fire only a few ms after
  // group 1's dispatch callback started running.
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 2, text: "Тест A, фрагмент 2" });

  await sleep(8); // both dispatch callbacks have now fired; neither provider turn has finished yet

  assert.equal(sendCalls.length, 1, "only group 1's turn should have reached the provider so far");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 1" }] });
  push({ type: "session.status_idle" });
  await sleep(10);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].text, "Відповідь 1");
  assert.equal(sendCalls.length, 2, "group 2's turn starts its own provider send only after group 1 fully finished");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle" });
  await sleep(10);

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].text, "Відповідь 2", "group 2's reply is its own, not overwritten/mixed with group 1's");

  realSession.close();
});
