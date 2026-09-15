import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionManager, formatUserFacingError, handleSessionError, isAllowedUser } from "./telegramAdapter.js";
import { DjonikSessionDeadError, type DjonikSessionHandle } from "./djonikClient.js";

test("isAllowedUser accepts only the configured Telegram user id", () => {
  assert.equal(isAllowedUser(12345, "12345"), true);
  assert.equal(isAllowedUser(999, "12345"), false);
  assert.equal(isAllowedUser(undefined, "12345"), false);
});

test("isAllowedUser trims the configured allowlist value", () => {
  assert.equal(isAllowedUser(12345, " 12345 "), true);
});

test("formatUserFacingError includes the underlying error message", () => {
  assert.match(formatUserFacingError(new Error("stream ended unexpectedly")), /stream ended unexpectedly/);
});

test("formatUserFacingError handles non-Error throws", () => {
  assert.match(formatUserFacingError("boom"), /boom/);
});

test("createSessionManager connects once and reuses the session across calls", async () => {
  let connectCalls = 0;
  const fakeSession: DjonikSessionHandle = {
    sessionId: "sess_1",
    send: async (text) => `echo:${text}`,
    close: () => {},
  };
  const manager = createSessionManager(async () => {
    connectCalls += 1;
    return fakeSession;
  });

  const first = await manager.getSession();
  const second = await manager.getSession();

  assert.equal(connectCalls, 1);
  assert.equal(first, fakeSession);
  assert.equal(second, fakeSession);
});

test("createSessionManager allows retry after a failed connect", async () => {
  let connectCalls = 0;
  const manager = createSessionManager(async () => {
    connectCalls += 1;
    if (connectCalls === 1) {
      throw new Error("connect failed");
    }
    return { sessionId: "sess_2", send: async () => "ok", close: () => {} };
  });

  await assert.rejects(manager.getSession());
  const session = await manager.getSession();

  assert.equal(connectCalls, 2);
  assert.equal(session.sessionId, "sess_2");
});

test("handleSessionError invalidates the cached session on a dead-session error, so the next message reconnects", async () => {
  let connectCalls = 0;
  const manager = createSessionManager(async () => {
    connectCalls += 1;
    return { sessionId: `sess_${connectCalls}`, send: async () => "ok", close: () => {} };
  });

  const first = await manager.getSession();
  handleSessionError(manager, new DjonikSessionDeadError("Djonik session event stream ended unexpectedly."));
  const second = await manager.getSession();

  assert.equal(connectCalls, 2, "a dead-session error must force a reconnect");
  assert.notEqual(first.sessionId, second.sessionId);
});

test("handleSessionError leaves the cached session alone for an ordinary turn failure", async () => {
  let connectCalls = 0;
  const manager = createSessionManager(async () => {
    connectCalls += 1;
    return { sessionId: `sess_${connectCalls}`, send: async () => "ok", close: () => {} };
  });

  const first = await manager.getSession();
  handleSessionError(manager, new Error("Djonik mutated Trello but did not verify the write with an independent read in this turn."));
  const second = await manager.getSession();

  assert.equal(connectCalls, 1, "an ordinary turn failure must not tear down a healthy session");
  assert.equal(first, second);
});
