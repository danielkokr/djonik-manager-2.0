import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionManager,
  downloadTelegramImage,
  formatUserFacingError,
  handleSessionError,
  isAllowedUser,
  MAX_BASE64_IMAGE_BYTES,
  resolveDocumentImageAttachment,
  resolvePhotoAttachment,
  TelegramImageDownloadError,
  TelegramImageTooLargeError,
} from "./telegramAdapter.js";
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

// --- Image intake (#22): Telegram normalization, download, validation. ---

test("resolvePhotoAttachment picks the highest-resolution size and always reports image/jpeg", () => {
  const attachment = resolvePhotoAttachment([
    { file_id: "small" },
    { file_id: "medium" },
    { file_id: "large" },
  ]);
  assert.deepEqual(attachment, { fileId: "large", mimeType: "image/jpeg" });
});

test("resolvePhotoAttachment returns null for an empty or missing photo array", () => {
  assert.equal(resolvePhotoAttachment([]), null);
  assert.equal(resolvePhotoAttachment(undefined), null);
});

test("resolveDocumentImageAttachment accepts a supported image MIME type", () => {
  const attachment = resolveDocumentImageAttachment({ file_id: "doc_1", mime_type: "image/png" });
  assert.deepEqual(attachment, { supported: true, fileId: "doc_1", mimeType: "image/png" });
});

test("resolveDocumentImageAttachment flags an image-shaped but unsupported MIME type", () => {
  const attachment = resolveDocumentImageAttachment({ file_id: "doc_2", mime_type: "image/heic" });
  assert.deepEqual(attachment, { supported: false, mimeType: "image/heic" });
});

test("resolveDocumentImageAttachment returns null for a non-image document (out of scope, e.g. PDF)", () => {
  assert.equal(resolveDocumentImageAttachment({ file_id: "doc_3", mime_type: "application/pdf" }), null);
});

test("resolveDocumentImageAttachment returns null when the document has no MIME type at all", () => {
  assert.equal(resolveDocumentImageAttachment({ file_id: "doc_4" }), null);
});

function fakeImageResponse(bytes: Uint8Array, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as Response) as typeof fetch;
}

test("downloadTelegramImage base64-encodes the downloaded bytes and reports byte size", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const image = await downloadTelegramImage("https://api.telegram.org/file/bot123/photo.jpg", "image/jpeg", fakeImageResponse(bytes));

  assert.equal(image.mediaType, "image/jpeg");
  assert.equal(image.byteSize, 5);
  assert.equal(Buffer.from(image.data, "base64").equals(Buffer.from(bytes)), true);
});

test("downloadTelegramImage throws TelegramImageDownloadError on a non-OK HTTP response", async () => {
  await assert.rejects(
    () => downloadTelegramImage("https://api.telegram.org/file/bot123/x.jpg", "image/jpeg", fakeImageResponse(new Uint8Array(), false, 404)),
    TelegramImageDownloadError,
  );
});

test("downloadTelegramImage throws TelegramImageDownloadError when the fetch itself rejects", async () => {
  const failingFetch = (async () => {
    throw new Error("network unreachable");
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => downloadTelegramImage("https://api.telegram.org/file/bot123/x.jpg", "image/jpeg", failingFetch),
    TelegramImageDownloadError,
  );
});

test("downloadTelegramImage throws TelegramImageTooLargeError once the base64 payload exceeds the configured ceiling", async () => {
  const bytes = new Uint8Array(1000); // encodes to well over a tiny custom ceiling
  await assert.rejects(
    () => downloadTelegramImage("https://api.telegram.org/file/bot123/x.jpg", "image/jpeg", fakeImageResponse(bytes), 100),
    TelegramImageTooLargeError,
  );
});

test("MAX_BASE64_IMAGE_BYTES matches the documented Claude API direct base64 image limit (10 MB)", () => {
  assert.equal(MAX_BASE64_IMAGE_BYTES, 10 * 1024 * 1024);
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
