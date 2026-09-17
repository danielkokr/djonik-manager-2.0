import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionManager,
  downloadTelegramDocument,
  downloadTelegramImage,
  exceedsDocumentSizeEstimate,
  formatGroupFailureError,
  formatUserFacingError,
  handleSessionError,
  isAllowedUser,
  MAX_BASE64_IMAGE_BYTES,
  MAX_DOCUMENT_BASE64_LENGTH,
  MAX_DOCUMENT_RAW_BYTES_ESTIMATE,
  resolveDocumentFileAttachment,
  resolveDocumentImageAttachment,
  resolvePhotoAttachment,
  SUPPORTED_DOCUMENT_MIME_TYPES,
  TelegramDocumentDownloadError,
  TelegramDocumentTooLargeError,
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

test("formatGroupFailureError includes the underlying error message and is worded distinctly from a single-turn failure (#25)", () => {
  const message = formatGroupFailureError(new Error("file too large"));
  assert.match(message, /file too large/);
  assert.notEqual(message, formatUserFacingError(new Error("file too large")));
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

// --- File/document intake (#24): Telegram PDF normalization, download, validation. ---

test("resolveDocumentFileAttachment accepts a supported PDF and passes through the filename", () => {
  const attachment = resolveDocumentFileAttachment({ file_id: "doc_5", mime_type: "application/pdf", file_name: "brief.pdf" });
  assert.deepEqual(attachment, { supported: true, fileId: "doc_5", mimeType: "application/pdf", filename: "brief.pdf", fileSize: undefined });
});

test("resolveDocumentFileAttachment accepts a PDF with no filename", () => {
  const attachment = resolveDocumentFileAttachment({ file_id: "doc_6", mime_type: "application/pdf" });
  assert.deepEqual(attachment, { supported: true, fileId: "doc_6", mimeType: "application/pdf", filename: undefined, fileSize: undefined });
});

test("resolveDocumentFileAttachment flags an unsupported file type", () => {
  const attachment = resolveDocumentFileAttachment({ file_id: "doc_7", mime_type: "application/zip" });
  assert.deepEqual(attachment, { supported: false, mimeType: "application/zip" });
});

test("resolveDocumentFileAttachment flags an image MIME type too (caller checks image first)", () => {
  // resolveDocumentFileAttachment is only reached after resolveDocumentImageAttachment
  // returned null; called directly it has no image-awareness, which is fine since the
  // real dispatcher (telegramCli.ts) always checks image first.
  const attachment = resolveDocumentFileAttachment({ file_id: "doc_8", mime_type: "image/png" });
  assert.deepEqual(attachment, { supported: false, mimeType: "image/png" });
});

test("resolveDocumentFileAttachment returns null when there is no document or no MIME type at all", () => {
  assert.equal(resolveDocumentFileAttachment(undefined), null);
  assert.equal(resolveDocumentFileAttachment({ file_id: "doc_9" }), null);
});

test("SUPPORTED_DOCUMENT_MIME_TYPES is exactly PDF for this slice", () => {
  assert.deepEqual(SUPPORTED_DOCUMENT_MIME_TYPES, ["application/pdf"]);
});

test("downloadTelegramDocument base64-encodes the downloaded bytes, reports byte size, and passes through the filename", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
  const document = await downloadTelegramDocument(
    "https://api.telegram.org/file/bot123/brief.pdf",
    "application/pdf",
    "brief.pdf",
    fakeImageResponse(bytes),
  );

  assert.equal(document.mediaType, "application/pdf");
  assert.equal(document.byteSize, 4);
  assert.equal(document.filename, "brief.pdf");
  assert.equal(Buffer.from(document.data, "base64").equals(Buffer.from(bytes)), true);
});

test("downloadTelegramDocument omits filename when Telegram did not provide one", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const document = await downloadTelegramDocument(
    "https://api.telegram.org/file/bot123/file",
    "application/pdf",
    undefined,
    fakeImageResponse(bytes),
  );

  assert.equal(document.filename, undefined);
});

test("downloadTelegramDocument throws TelegramDocumentDownloadError on a non-OK HTTP response", async () => {
  await assert.rejects(
    () => downloadTelegramDocument(
      "https://api.telegram.org/file/bot123/x.pdf",
      "application/pdf",
      "x.pdf",
      fakeImageResponse(new Uint8Array(), false, 404),
    ),
    TelegramDocumentDownloadError,
  );
});

test("downloadTelegramDocument throws TelegramDocumentDownloadError when the fetch itself rejects", async () => {
  const failingFetch = (async () => {
    throw new Error("network unreachable");
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => downloadTelegramDocument("https://api.telegram.org/file/bot123/x.pdf", "application/pdf", "x.pdf", failingFetch),
    TelegramDocumentDownloadError,
  );
});

test("downloadTelegramDocument throws TelegramDocumentTooLargeError once the base64 payload exceeds the configured ceiling", async () => {
  const bytes = new Uint8Array(1000); // encodes to well over a tiny custom ceiling
  await assert.rejects(
    () => downloadTelegramDocument(
      "https://api.telegram.org/file/bot123/x.pdf",
      "application/pdf",
      "x.pdf",
      fakeImageResponse(bytes),
      100,
    ),
    TelegramDocumentTooLargeError,
  );
});

// --- Size-guard hardening: MAX_DOCUMENT_BASE64_LENGTH stays safely below the
// documented 32 MB whole-request ceiling, leaving headroom for the user.message
// envelope, the document block structure, an optional title, and an optional
// caption/text block — none of which are part of the base64 payload itself. ---

test("MAX_DOCUMENT_BASE64_LENGTH is a conservative base64-length ceiling with real headroom below the 32 MB request cap", () => {
  const CLAUDE_API_MAX_REQUEST_SIZE = 32 * 1024 * 1024;
  assert.equal(MAX_DOCUMENT_BASE64_LENGTH, 20 * 1024 * 1024);
  assert.ok(
    MAX_DOCUMENT_BASE64_LENGTH < CLAUDE_API_MAX_REQUEST_SIZE,
    "the encoded-document ceiling alone must leave room for envelope/title/caption overhead",
  );
  const headroomBytes = CLAUDE_API_MAX_REQUEST_SIZE - MAX_DOCUMENT_BASE64_LENGTH;
  assert.ok(
    headroomBytes >= 10 * 1024 * 1024,
    "headroom should be generous (>=10 MB) relative to the few KB an envelope/title/caption actually costs",
  );
});

test("a document just under MAX_DOCUMENT_BASE64_LENGTH is allowed", async () => {
  // Construct raw bytes whose base64 length lands just under the ceiling.
  const rawBytes = Math.floor((MAX_DOCUMENT_BASE64_LENGTH - 8) * 3 / 4);
  const bytes = new Uint8Array(rawBytes);
  const document = await downloadTelegramDocument(
    "https://api.telegram.org/file/bot123/big-but-ok.pdf",
    "application/pdf",
    "big-but-ok.pdf",
    fakeImageResponse(bytes),
  );
  assert.equal(document.byteSize, rawBytes);
});

test("a document just over MAX_DOCUMENT_BASE64_LENGTH is rejected", async () => {
  // Construct raw bytes whose base64 length lands just over the ceiling.
  const rawBytes = Math.ceil((MAX_DOCUMENT_BASE64_LENGTH + 8) * 3 / 4);
  const bytes = new Uint8Array(rawBytes);
  await assert.rejects(
    () => downloadTelegramDocument(
      "https://api.telegram.org/file/bot123/too-big.pdf",
      "application/pdf",
      "too-big.pdf",
      fakeImageResponse(bytes),
    ),
    TelegramDocumentTooLargeError,
  );
});

test("MAX_DOCUMENT_RAW_BYTES_ESTIMATE is derived from the base64 ceiling (~3/4, accounting for base64 expansion)", () => {
  assert.equal(MAX_DOCUMENT_RAW_BYTES_ESTIMATE, Math.floor((MAX_DOCUMENT_BASE64_LENGTH * 3) / 4));
  assert.equal(MAX_DOCUMENT_RAW_BYTES_ESTIMATE, 15 * 1024 * 1024);
});

test("exceedsDocumentSizeEstimate flags a Telegram-reported file_size over the raw-byte estimate", () => {
  assert.equal(exceedsDocumentSizeEstimate(MAX_DOCUMENT_RAW_BYTES_ESTIMATE + 1), true);
  assert.equal(exceedsDocumentSizeEstimate(MAX_DOCUMENT_RAW_BYTES_ESTIMATE), false);
});

test("exceedsDocumentSizeEstimate never rejects when Telegram reports no file_size (authoritative check still applies later)", () => {
  assert.equal(exceedsDocumentSizeEstimate(undefined), false);
});

test("resolveDocumentFileAttachment passes through Telegram's reported file_size for early-rejection use", () => {
  const attachment = resolveDocumentFileAttachment({ file_id: "doc_10", mime_type: "application/pdf", file_size: 123 });
  assert.deepEqual(attachment, { supported: true, fileId: "doc_10", mimeType: "application/pdf", filename: undefined, fileSize: 123 });
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
