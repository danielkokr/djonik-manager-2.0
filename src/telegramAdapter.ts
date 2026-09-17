import {
  DjonikSessionDeadError,
  type DjonikDocumentInput,
  type DjonikImageInput,
  type DjonikSessionHandle,
} from "./djonikClient.js";

/** MIME types the Claude API accepts as an `image` content block (Vision docs, 2026-09-17). */
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/**
 * Claude API direct base64 image size ceiling (Vision docs: "10 MB
 * (base64-encoded) when using the Claude API directly"). Checked against the
 * encoded base64 string length, matching how the limit is documented.
 */
export const MAX_BASE64_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * MIME types Djonik accepts as a `document` content block (#24). Only PDF is
 * in scope for this slice — the PDF support docs describe this as the
 * supported document format for the `document`/base64 content-block path.
 */
export const SUPPORTED_DOCUMENT_MIME_TYPES = ["application/pdf"] as const;

/**
 * Ceiling on the ENCODED BASE64 STRING LENGTH of a PDF document block —
 * deliberately well below the 32 MB "maximum request size" the Claude API PDF
 * support docs document, because that 32 MB covers the ENTIRE request
 * payload: the `user.message` event/JSON envelope, the `document` block's own
 * structure, the optional `title` (filename), and any caption sent as a
 * sibling `text` block — none of which are accounted for by the base64
 * payload alone. 20 MB of base64 leaves 12 MB (well over a third of the total
 * limit) of headroom for all of that overhead, which in practice never
 * exceeds a few kilobytes — a deliberately conservative margin, not a tight
 * calculation of actual overhead.
 *
 * Name reflects what is actually measured: this is a base64 CHARACTER COUNT,
 * not a count of raw/decoded file bytes (a base64 string is ~4/3 the size of
 * the bytes it encodes). See `MAX_DOCUMENT_RAW_BYTES_ESTIMATE` for the
 * corresponding raw-byte estimate used for early rejection.
 */
export const MAX_DOCUMENT_BASE64_LENGTH = 20 * 1024 * 1024;

/**
 * Approximate RAW (decoded) byte ceiling implied by `MAX_DOCUMENT_BASE64_LENGTH`
 * (base64 inflates size by ~4/3, so this is `* 3/4`). This is an *estimate*
 * for an early, optimistic rejection using Telegram's self-reported
 * `file_size` — before any network download — not the authoritative check.
 * The authoritative check is always the actual encoded payload length
 * computed in `downloadTelegramDocument` after download.
 */
export const MAX_DOCUMENT_RAW_BYTES_ESTIMATE = Math.floor((MAX_DOCUMENT_BASE64_LENGTH * 3) / 4);

interface MinimalPhotoSize {
  file_id: string;
}

interface MinimalDocument {
  file_id: string;
  mime_type?: string;
  file_name?: string;
  /** Telegram-reported raw file size in bytes, when present. Used only for an
   *  optimistic early rejection before downloading — never authoritative. */
  file_size?: number;
}

/** Telegram photos are always re-encoded to JPEG by Telegram itself. */
export function resolvePhotoAttachment(
  photo: readonly MinimalPhotoSize[] | undefined,
): { fileId: string; mimeType: string } | null {
  if (!photo || photo.length === 0) return null;
  // Telegram lists photo sizes ascending; the last entry is the highest resolution.
  const largest = photo[photo.length - 1];
  return { fileId: largest.file_id, mimeType: "image/jpeg" };
}

export type DocumentImageAttachment =
  | { supported: true; fileId: string; mimeType: string }
  | { supported: false; mimeType: string };

/**
 * Resolves a Telegram document message to an image attachment when its MIME
 * type looks like an image, distinguishing "unsupported image subtype" (e.g.
 * `image/heic`) from "not an image at all" (PDFs and other files — handled
 * separately by `resolveDocumentFileAttachment`, #24).
 */
export function resolveDocumentImageAttachment(document: MinimalDocument | undefined): DocumentImageAttachment | null {
  const mimeType = document?.mime_type;
  if (!mimeType || !mimeType.startsWith("image/")) return null;
  if ((SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { supported: true, fileId: document!.file_id, mimeType };
  }
  return { supported: false, mimeType };
}

export type DocumentFileAttachment =
  | { supported: true; fileId: string; mimeType: string; filename?: string; fileSize?: number }
  | { supported: false; mimeType: string };

/**
 * Resolves a Telegram document message to a file/document attachment (#24) —
 * called only after `resolveDocumentImageAttachment` has ruled out an image.
 * Any remaining document is now a deliberate file-intake attempt: PDF is
 * supported, anything else gets a concise visible rejection rather than the
 * pre-#24 silent ignore, matching the issue's explicit "unsupported type ->
 * visible error" requirement. Returns null only when there is no document at
 * all or it has no MIME type to judge. `fileSize`, when Telegram reports one,
 * is passed through only for the optimistic early-rejection check in
 * `exceedsDocumentSizeEstimate` — never trusted as the final size.
 */
export function resolveDocumentFileAttachment(document: MinimalDocument | undefined): DocumentFileAttachment | null {
  const mimeType = document?.mime_type;
  if (!document || !mimeType) return null;
  if ((SUPPORTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { supported: true, fileId: document.file_id, mimeType, filename: document.file_name, fileSize: document.file_size };
  }
  return { supported: false, mimeType };
}

/**
 * Optimistic, non-authoritative early rejection using Telegram's self-reported
 * `file_size` (raw bytes), so an obviously-oversized PDF can be rejected
 * before spending a network round-trip downloading it. Returns `false`
 * (never reject) when no size was reported — the authoritative check in
 * `downloadTelegramDocument`, against the actual encoded payload, always
 * still runs regardless of this function's result.
 */
export function exceedsDocumentSizeEstimate(fileSizeBytes: number | undefined): boolean {
  return fileSizeBytes !== undefined && fileSizeBytes > MAX_DOCUMENT_RAW_BYTES_ESTIMATE;
}

/** Thrown when the Telegram file download itself fails (network/HTTP error). */
export class TelegramImageDownloadError extends Error {}

/** Thrown when the downloaded image exceeds `MAX_BASE64_IMAGE_BYTES` once base64-encoded. */
export class TelegramImageTooLargeError extends Error {}

/** Thrown when the Telegram document download itself fails (network/HTTP error). */
export class TelegramDocumentDownloadError extends Error {}

/** Thrown when the downloaded document's base64 encoding exceeds `MAX_DOCUMENT_BASE64_LENGTH`. */
export class TelegramDocumentTooLargeError extends Error {}

/**
 * Downloads a Telegram file by its public `file_path` URL and base64-encodes
 * it for the Djonik Managed Session's inline `image` content block. Kept
 * decoupled from the grammy `Bot`/`Context` so it stays unit-testable with a
 * fake `fetchImpl`. Never logs the downloaded bytes.
 */
export async function downloadTelegramImage(
  fileUrl: string,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
  maxBase64Bytes: number = MAX_BASE64_IMAGE_BYTES,
): Promise<DjonikImageInput> {
  let response: Response;
  try {
    response = await fetchImpl(fileUrl);
  } catch (error) {
    throw new TelegramImageDownloadError(
      `Failed to download image from Telegram: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new TelegramImageDownloadError(`Telegram file download failed with status ${response.status}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString("base64");

  if (data.length > maxBase64Bytes) {
    const megabytes = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new TelegramImageTooLargeError(
      `Image is too large (${megabytes} MB). Djonik currently supports images up to ~7.5 MB.`,
    );
  }

  return { data, mediaType: mimeType, byteSize: arrayBuffer.byteLength };
}

/**
 * Downloads a Telegram document by its public `file_path` URL and
 * base64-encodes it for the Djonik Managed Session's inline `document`
 * content block (#24). Mirrors `downloadTelegramImage` deliberately rather
 * than sharing an abstraction — the two have independent size ceilings and
 * error types the caller needs to distinguish. Never logs the downloaded
 * bytes, the base64 string, or the file URL.
 */
export async function downloadTelegramDocument(
  fileUrl: string,
  mimeType: string,
  filename: string | undefined,
  fetchImpl: typeof fetch = fetch,
  maxBase64Length: number = MAX_DOCUMENT_BASE64_LENGTH,
): Promise<DjonikDocumentInput> {
  let response: Response;
  try {
    response = await fetchImpl(fileUrl);
  } catch (error) {
    throw new TelegramDocumentDownloadError(
      `Failed to download file from Telegram: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new TelegramDocumentDownloadError(`Telegram file download failed with status ${response.status}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString("base64");

  // This is the authoritative size check — it runs against the actual encoded
  // payload regardless of what any pre-download size estimate concluded.
  if (data.length > maxBase64Length) {
    const megabytes = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new TelegramDocumentTooLargeError(
      `File is too large (${megabytes} MB). Djonik currently supports files up to ~15 MB.`,
    );
  }

  return { data, mediaType: mimeType, byteSize: arrayBuffer.byteLength, ...(filename ? { filename } : {}) };
}

/**
 * Compares the Telegram sender id against the single-user allowlist. Only an
 * exact match reaches Djonik; every other sender is silently ignored by the
 * caller so the dev bot does not confirm its own existence to strangers.
 */
export function isAllowedUser(fromId: number | undefined, allowedUserId: string): boolean {
  return fromId !== undefined && String(fromId) === allowedUserId.trim();
}

/** Bounds a failed turn to a short, secret-free, user-visible message. */
export function formatUserFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Джонік не зміг відповісти на це повідомлення: ${message}`;
}

/**
 * Bounds a failed *grouped* intake (#25) to a short, secret-free,
 * user-visible message. Deliberately distinct wording from
 * `formatUserFacingError`: a grouped-intake failure means the whole related
 * batch of fragments was discarded (fail-closed, zero Trello mutation), not
 * just one ordinary single-message turn.
 */
export function formatGroupFailureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Джонік не зміг обробити цю групу повідомлень: ${message}`;
}

export interface DjonikSessionManager {
  /** Resolves the single in-process Djonik session, connecting it on first use. */
  getSession(): Promise<DjonikSessionHandle>;
  /** Closes the session's event stream if one was ever opened. */
  closeIfOpen(): void;
  /**
   * Discards the cached session so the next `getSession()` reconnects instead
   * of reusing a session whose event stream has already died. Call this only
   * for a `DjonikSessionDeadError` (see `handleSessionError`) — ordinary
   * turn-level failures (unverified write, empty reply) leave a perfectly
   * usable session and must not be torn down.
   */
  invalidate(): void;
}

/**
 * Memoizes exactly one Djonik Managed Session for the lifetime of the
 * running process: the first accepted Telegram message triggers `connect`,
 * every later message reuses the same promise/session so conversational
 * continuity stays inside the official Managed Agent Session, not in
 * adapter-side state. A failed connect attempt is not cached, so the next
 * message can retry.
 */
export function createSessionManager(connect: () => Promise<DjonikSessionHandle>): DjonikSessionManager {
  let sessionPromise: Promise<DjonikSessionHandle> | null = null;

  function getSession(): Promise<DjonikSessionHandle> {
    if (!sessionPromise) {
      sessionPromise = connect().catch((error: unknown) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }

  function closeIfOpen(): void {
    sessionPromise?.then((session) => session.close()).catch(() => {});
  }

  function invalidate(): void {
    sessionPromise = null;
  }

  return { getSession, closeIfOpen, invalidate };
}

/**
 * Discards a session whose event stream/Managed Session has actually died
 * (`DjonikSessionDeadError`) so the next Telegram message reconnects fresh,
 * instead of every later message failing forever against the same dead
 * cached session. Ordinary turn-level failures are left alone: the session
 * behind them is still usable, so tearing it down would lose conversational
 * continuity for no reason.
 */
export function handleSessionError(manager: DjonikSessionManager, error: unknown): void {
  if (error instanceof DjonikSessionDeadError) {
    manager.invalidate();
  }
}
