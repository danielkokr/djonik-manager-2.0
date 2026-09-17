import { DjonikSessionDeadError, type DjonikImageInput, type DjonikSessionHandle } from "./djonikClient.js";

/** MIME types the Claude API accepts as an `image` content block (Vision docs, 2026-09-17). */
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/**
 * Claude API direct base64 image size ceiling (Vision docs: "10 MB
 * (base64-encoded) when using the Claude API directly"). Checked against the
 * encoded base64 string length, matching how the limit is documented.
 */
export const MAX_BASE64_IMAGE_BYTES = 10 * 1024 * 1024;

interface MinimalPhotoSize {
  file_id: string;
}

interface MinimalDocument {
  file_id: string;
  mime_type?: string;
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
 * `image/heic`) from "not an image at all" (PDFs, arbitrary files — out of
 * scope for this slice, left for the caller to ignore like any other
 * unhandled message type).
 */
export function resolveDocumentImageAttachment(document: MinimalDocument | undefined): DocumentImageAttachment | null {
  const mimeType = document?.mime_type;
  if (!mimeType || !mimeType.startsWith("image/")) return null;
  if ((SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { supported: true, fileId: document!.file_id, mimeType };
  }
  return { supported: false, mimeType };
}

/** Thrown when the Telegram file download itself fails (network/HTTP error). */
export class TelegramImageDownloadError extends Error {}

/** Thrown when the downloaded image exceeds `MAX_BASE64_IMAGE_BYTES` once base64-encoded. */
export class TelegramImageTooLargeError extends Error {}

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
