import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  type DjonikDocumentInput,
  type DjonikImageInput,
  type DjonikSessionHandle,
  type DjonikTurnPart,
} from "./djonikClient.js";
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

/**
 * `createGroupDispatchHandlers` calls `session.sendOrdered(intake.parts)`
 * (#27), so this fake records ordered-part calls; the legacy `send` is still
 * implemented (interface requirement) but production `onDispatch` no longer
 * calls it, so no test here should assert on `send`-shaped calls.
 */
function createFakeSession(): { session: DjonikSessionHandle; orderedCalls: DjonikTurnPart[][] } {
  const orderedCalls: DjonikTurnPart[][] = [];
  const session: DjonikSessionHandle = {
    sessionId: "fake_session",
    send: async () => {
      throw new Error("send() should not be called by grouped dispatch — use sendOrdered");
    },
    sendOrdered: async (parts) => {
      orderedCalls.push(parts);
      return "Готово.";
    },
    close: () => {},
  };
  return { session, orderedCalls };
}

function createFakeSessionManager(session: DjonikSessionHandle): DjonikSessionManager {
  return {
    getSession: async () => session,
    closeIfOpen: () => {},
    invalidate: () => {},
  };
}

function setUp() {
  const { session, orderedCalls } = createFakeSession();
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
  return { buffer, orderedCalls, sentMessages };
}

test("integration: two grouped text fragments produce exactly one Managed Agent sendOrdered call, order preserved", async () => {
  const { buffer, orderedCalls, sentMessages } = setUp();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "По Djonik треба оновити onboarding." });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 2, text: "Зроби з цього одну задачу, без дедлайну." });

  await sleep(WINDOW_MS + 40);

  assert.equal(orderedCalls.length, 1, "exactly one call into the Managed Agent session for the whole grouped intake");
  assert.deepEqual(orderedCalls[0], [
    { type: "text", text: "По Djonik треба оновити onboarding." },
    { type: "text", text: "Зроби з цього одну задачу, без дедлайну." },
  ]);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 1);
});

test("integration (#27, Product Lead review point 7): grouped dispatch never sends the legacy [Fragment N]-labeled combined text — only the unlabeled ordered parts", async () => {
  const { buffer, orderedCalls } = setUp();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "перший фрагмент" });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 2, text: "другий фрагмент" });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 3, text: "третій фрагмент" });

  await sleep(WINDOW_MS + 40);

  assert.equal(orderedCalls.length, 1);
  const serialized = JSON.stringify(orderedCalls[0]);
  assert.ok(!serialized.includes("[Fragment"), "the model-facing ordered parts must never carry the legacy [Fragment N] labels");
  // Each fragment's own text is its own separate, unlabeled block — proving
  // no duplication through a second, legacy-text codepath (Product Lead
  // review point 4): three fragments in, exactly three text parts out.
  assert.deepEqual(orderedCalls[0], [
    { type: "text", text: "перший фрагмент" },
    { type: "text", text: "другий фрагмент" },
    { type: "text", text: "третій фрагмент" },
  ]);
});

test("integration: text + image produces exactly one Managed Agent sendOrdered call carrying both, in order", async () => {
  const { buffer, orderedCalls } = setUp();
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

  assert.equal(orderedCalls.length, 1);
  assert.deepEqual(orderedCalls[0], [
    { type: "text", text: "ось референс" },
    { type: "image", image },
  ]);
});

test("integration: text + PDF produces exactly one Managed Agent sendOrdered call carrying both, in order", async () => {
  const { buffer, orderedCalls } = setUp();
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

  assert.equal(orderedCalls.length, 1);
  assert.deepEqual(orderedCalls[0], [
    { type: "text", text: "деталі проєкту тут" },
    { type: "document", document },
  ]);
});

test("integration: a media_group_id album (3 items) produces exactly one Managed Agent sendOrdered call, message_id order", async () => {
  const { buffer, orderedCalls } = setUp();
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

  assert.equal(orderedCalls.length, 1, "exactly one call for the whole 3-item album");
  assert.deepEqual(orderedCalls[0], images.map((image) => ({ type: "image" as const, image })));
});

test("integration: a failed grouped attachment never calls sendOrdered (structural zero-mutation guarantee)", async () => {
  const { buffer, orderedCalls, sentMessages } = setUp();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "зроби задачу з цього" });
  buffer.addFragment({
    chatId: 1,
    userId: 100,
    messageId: 2,
    text: "",
    media: { kind: "document", promise: Promise.reject(new Error("file too large")) },
  });

  await sleep(WINDOW_MS + 40);

  assert.equal(orderedCalls.length, 0, "sendOrdered must never be called for a failed grouped intake");
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
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await sleep(10);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].text, "Відповідь 1");
  assert.equal(sendCalls.length, 2, "group 2's turn starts its own provider send only after group 1 fully finished");

  push({ type: "agent.message", content: [{ type: "text", text: "Відповідь 2" }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await sleep(10);

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].text, "Відповідь 2", "group 2's reply is its own, not overwritten/mixed with group 1's");

  realSession.close();
});

// --- #38: the Telegram delivery boundary ---------------------------------------------------------
//
// docs/34 §7.1/§17.4 recorded a real production-like Session whose single visible turn emitted NINE
// interim `agent.message` process-narration events ("Тепер перевірю картку:", "Спробую подивитися на
// дошку інакше:") before the final answer. #38 asks whether such text can reach Telegram.
//
// These tests answer it from the real path, end to end: the real `connectToDjonik` session, the real
// `createGroupDispatchHandlers`, the real `MessageGroupBuffer`. Only the provider event stream and
// `bot.api.sendMessage` are fakes. No second reimplementation of `connectToDjonik` is introduced —
// the existing `createControllableAnthropicClient` seam above is reused.

/** One dispatch-boundary rig: real client + real handlers, with a hand-driven provider stream. */
async function setUpDeliveryBoundary() {
  const { client, sendCalls, push } = createControllableAnthropicClient();
  const realSession = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession: createFakeSessionManager(realSession),
    sendMessage: async (chatId, text) => { sentMessages.push({ chatId, text }); },
    logError: () => {},
  });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });
  return { buffer, sentMessages, sendCalls, push, realSession };
}

/** The nine interim messages docs/34 observed, in the same process-narration register. */
const DOCS_34_INTERIM_MESSAGES = [
  "Зараз подивлюсь дошку:",
  "Спробую подивитися на дошку інакше:",
  "Тепер перевірю картку:",
  "Ще раз пошукаю labels:",
  "Спробую інший запит:",
  "Читаю списки дошки:",
  "Створюю картку:",
  "Перевіряю результат:",
  "Тепер перевірю картку ще раз:",
];

const DOCS_34_FINAL_REPLY = "Створив «Djonik #38 smoke» в Inbox, з лейблом Extract. Дедлайну не ставив.";

test("#38 delivery boundary: nine interim agent.message events reach Telegram zero times; only the final accepted reply is sent", async () => {
  const { buffer, sentMessages, sendCalls, push, realSession } = await setUpDeliveryBoundary();

  buffer.addFragment({ chatId: 7, userId: 100, messageId: 1, text: "Створи задачу «Djonik #38 smoke» для Extract. Без дедлайну." });
  await sleep(20);
  assert.equal(sendCalls.length, 1, "exactly one Managed Agent turn is invoked for the grouped intake");

  // Interim narration interleaved with tool work, exactly as the live Session produced it.
  for (const [index, interim] of DOCS_34_INTERIM_MESSAGES.entries()) {
    push({ type: "agent.message", content: [{ type: "text", text: interim }] });
    push({ type: "agent.mcp_tool_use", id: `tool_${index}`, mcp_server_name: "trello", name: "trelloReadBoard", input: {} });
    push({ type: "agent.mcp_tool_result", mcp_tool_use_id: `tool_${index}`, is_error: index < 3, content: [] });
    await sleep(2);
    assert.equal(
      sentMessages.length,
      0,
      `no Telegram message may be sent while the turn is unresolved (after interim #${index + 1})`,
    );
  }

  // Provider-level pauses that are NOT `end_turn` are still not a verdict (#32): the turn stays open.
  push({ type: "session.thread_status_idle", thread_id: "thr_unrelated", stop_reason: { type: "end_turn" } });
  await sleep(5);
  assert.equal(sentMessages.length, 0, "a thread idle is not the visible turn's completion");

  push({ type: "agent.message", content: [{ type: "text", text: DOCS_34_FINAL_REPLY }] });
  await sleep(5);
  assert.equal(sentMessages.length, 0, "even the final agent.message alone is not deliverable before end_turn");

  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await sleep(10);

  assert.equal(sentMessages.length, 1, "exactly one Telegram message for the whole turn");
  assert.equal(sentMessages[0].chatId, 7);
  assert.equal(sentMessages[0].text, DOCS_34_FINAL_REPLY, "the delivered text is the accepted final reply");
  for (const interim of DOCS_34_INTERIM_MESSAGES) {
    assert.ok(!sentMessages[0].text.includes(interim), `interim narration leaked into the delivered reply: ${interim}`);
  }
  assert.equal(sendCalls.length, 1, "no extra provider turn was started");

  realSession.close();
});

test("#38 delivery boundary: a turn that stops without authoritative end_turn sends the error path, never the last interim message", async () => {
  const { buffer, sentMessages, push, realSession } = await setUpDeliveryBoundary();

  buffer.addFragment({ chatId: 7, userId: 100, messageId: 1, text: "Що зараз по Extract?" });
  await sleep(20);

  push({ type: "agent.message", content: [{ type: "text", text: "Зараз подивлюсь дошку:" }] });
  push({ type: "agent.message", content: [{ type: "text", text: "Ще дивлюсь, майже готово…" }] });
  await sleep(5);
  assert.equal(sentMessages.length, 0);

  // #32: a budget pause is not a completed turn, and its partial text is data, never a reply.
  push({ type: "session.status_idle", stop_reason: { type: "budget_reached" } });
  await sleep(10);

  assert.equal(sentMessages.length, 1, "the user still gets exactly one visible message");
  assert.match(sentMessages[0].text, /^⚠️ Джонік не зміг відповісти/, "the existing user-facing error path, unchanged");
  assert.match(sentMessages[0].text, /budget_reached/, "the incomplete stop is named, as before");
  assert.ok(!sentMessages[0].text.includes("Ще дивлюсь"), "the last interim model message must never be delivered as success");
  assert.ok(!sentMessages[0].text.includes("Зараз подивлюсь"), "no earlier interim message may be delivered either");

  realSession.close();
});

test("#38 delivery boundary: an interim message before a tool pause cannot become the visible answer of the continued turn", async () => {
  const { buffer, sentMessages, push, realSession } = await setUpDeliveryBoundary();

  buffer.addFragment({ chatId: 7, userId: 100, messageId: 1, text: "Створи задачу для Extract." });
  await sleep(20);

  push({ type: "agent.message", content: [{ type: "text", text: "Перевіряю дошку, зараз створю:" }] });
  push({ type: "agent.message", content: [{ type: "text", text: DOCS_34_FINAL_REPLY }] });
  push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
  await sleep(10);

  assert.equal(sentMessages.length, 1);
  assert.equal(
    sentMessages[0].text,
    DOCS_34_FINAL_REPLY,
    "the last accepted agent.message of the completed turn wins; earlier interim text is discarded, not appended",
  );

  realSession.close();
});
