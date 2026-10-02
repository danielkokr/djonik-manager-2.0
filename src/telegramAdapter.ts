import {
  DjonikSessionDeadError,
  DjonikTracedTurnError,
  DjonikUnverifiedMutationError,
  type DjonikDocumentInput,
  type DjonikImageInput,
  type DjonikSessionHandle,
  type PendingMessageState,
} from "./djonikClient.js";
import { canResubmit } from "./sessionEventFeed.js";
import { classifyProviderFailure, type ProviderFailure, type ProviderFailureCategory, type ServingStage } from "./providerFailure.js";

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

/** #53: the reply could not be obtained and the message provably never started processing anywhere. */
export const SESSION_LOST_RESEND_TEXT = "⚠️ Не вдалося отримати відповідь — перешли, будь ласка, ще раз.";

/** #53: the reply could not be obtained and the message may already have been acted on. */
export const SESSION_LOST_CHECK_TEXT =
  "⚠️ Не вдалося отримати відповідь — зв'язок із сесією обірвався. Перешли, будь ласка, ще раз; " +
  "якщо просив зміну в Trello, спершу перевір, чи вона вже є.";

/** #56: a Trello write was attempted but not authoritatively confirmed after the one corrective read.
 *  It may have applied, so this never says it failed, never says it succeeded, and names no ids. */
export const UNVERIFIED_MUTATION_TEXT =
  "⚠️ Зміна в Trello могла виконатися, але я не зміг надійно підтвердити результат. " +
  "Перевір картку в Trello перед повторною спробою.";

/** #60: Claude was unavailable and nothing of this message was submitted (Session connect, or a 4xx throttle). */
export const PROVIDER_UNAVAILABLE_TEXT =
  "⚠️ Сервіс Claude зараз тимчасово недоступний, тож це повідомлення я не обробив. Спробуй надіслати його ще раз за хвилину.";

/** #60: Claude failed with a 5xx/connection error after the message may have reached it. */
export const PROVIDER_UNAVAILABLE_CHECK_TEXT =
  "⚠️ Сервіс Claude тимчасово відповів помилкою, тож відповіді немає. Спробуй ще раз за хвилину; " +
  "якщо просив зміну в Trello, спершу перевір, чи вона вже є.";

/** #60: the host credential/permission was refused (401/403) — an operator problem, not Daniel's message. */
export const PROVIDER_CONFIG_TEXT =
  "⚠️ Джонік зараз не може підключитися до Claude. Це проблема налаштувань сервісу, а не твого повідомлення, " +
  "тож повторне надсилання не допоможе, доки її не виправлено.";

/** #60: the provider refused this request (another 4xx). */
export const PROVIDER_REJECTED_TEXT =
  "⚠️ Claude не прийняв цей запит, тож відповіді немає. Якщо було вкладення, спробуй інший формат або надішли текстом.";

/** #60: no Session could be opened for a reason that is not a classified provider failure (e.g. attestation). */
export const SESSION_UNAVAILABLE_TEXT =
  "⚠️ Джонік зараз не зміг відкрити сесію з Claude, тож це повідомлення я не обробив. Спробуй ще раз трохи пізніше.";

/**
 * #60: no Session could be obtained for a turn (`getSession` failed: Session creation, serving attestation or the
 * first stream open). Nothing of the turn was submitted anywhere. `cause` is the original error, kept for logs.
 */
export class DjonikSessionConnectError extends Error {
  readonly providerFailure: ProviderFailure | null;

  constructor(readonly cause: unknown) {
    const failure = classifyProviderFailure(cause);
    super(`Djonik could not open a Managed Session (${failure ? `${failure.category}, status=${failure.status ?? "none"}` : "unclassified"}).`);
    this.name = "DjonikSessionConnectError";
    this.providerFailure = failure;
  }
}

function providerText(category: ProviderFailureCategory, delivered: "not_submitted" | "unknown"): string {
  if (category === "auth_config") return PROVIDER_CONFIG_TEXT;
  if (category === "request_rejected") return PROVIDER_REJECTED_TEXT;
  return delivered === "not_submitted" ? PROVIDER_UNAVAILABLE_TEXT : PROVIDER_UNAVAILABLE_CHECK_TEXT;
}

/** Bounds a failed turn to a short, secret-free, user-visible message. A lost Session (#53) never shows
 *  raw provider/runtime text: one fixed Ukrainian line, with a Trello check hint unless the message
 *  provably never started processing. An unverified Trello mutation (#56) shows one fixed line too:
 *  its `message` is an internal diagnostic (provider ids, per-mutation verifier detail) that stays in
 *  logs/traces and on `outcomes`. Only its already user-safe Project Health section (#32) follows.
 *  #60: a provider (Anthropic API) failure never shows its raw text either — one fixed line per class, with the
 *  Trello hint whenever the message may have reached Claude. Only non-provider application errors keep the
 *  existing wording. */
export function formatUserFacingError(error: unknown): string {
  const dead = sessionDeadErrorOf(error);
  if (dead) {
    if (canResubmit(dead.pendingMessage)) return SESSION_LOST_RESEND_TEXT;
    return dead.reason === "provider_unavailable" ? PROVIDER_UNAVAILABLE_CHECK_TEXT : SESSION_LOST_CHECK_TEXT;
  }
  if (error instanceof DjonikSessionConnectError) {
    return error.providerFailure ? providerText(error.providerFailure.category, "not_submitted") : SESSION_UNAVAILABLE_TEXT;
  }
  const unverified = unverifiedMutationErrorOf(error);
  if (unverified) return UNVERIFIED_MUTATION_TEXT + (unverified.specialistSection ?? "");
  const provider = classifyProviderFailure(error);
  if (provider) {
    // Unattributed to a stage: a 4xx is a refusal (nothing accepted); a 5xx/connection failure may not be.
    const refused = provider.status !== null && provider.status < 500;
    return providerText(provider.category, refused ? "not_submitted" : "unknown");
  }
  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Джонік не зміг відповісти на це повідомлення: ${message}`;
}

/**
 * Bounds a failed *grouped* intake (#25) to a short, secret-free,
 * user-visible message. Deliberately distinct wording from
 * `formatUserFacingError`: a grouped-intake failure means the whole related
 * batch of fragments was discarded (fail-closed, zero Trello mutation), not
 * just one ordinary single-message turn. #60: a provider/Session failure that
 * somehow reaches this path never shows its raw text — it gets the turn wording.
 */
export function formatGroupFailureError(error: unknown): string {
  if (classifyProviderFailure(error) !== null || sessionDeadErrorOf(error) !== null || error instanceof DjonikSessionConnectError) {
    return formatUserFacingError(error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Джонік не зміг обробити цю групу повідомлень: ${message}`;
}

export interface DjonikSessionManager<H extends DjonikSessionHandle = DjonikSessionHandle> {
  /** Resolves the single in-process Djonik session, connecting it on first use. */
  getSession(): Promise<H>;
  /** Closes the session's event stream if one was ever opened. */
  closeIfOpen(): void;
  /**
   * Discards the cached session so the next `getSession()` reconnects instead
   * of reusing a session that has been given up. Call this only
   * for a `DjonikSessionDeadError` (see `handleSessionError`) — ordinary
   * turn-level failures (unverified write, empty reply) leave a perfectly
   * usable session and must not be torn down. With `handle` (#53), only that
   * exact handle is discarded: a replacement created meanwhile is kept.
   */
  invalidate(handle?: H): void;
}

/**
 * Memoizes exactly one Djonik Managed Session for the lifetime of the
 * running process: the first accepted Telegram message triggers `connect`,
 * every later message reuses the same promise/session so conversational
 * continuity stays inside the official Managed Agent Session, not in
 * adapter-side state. A failed connect attempt is not cached, so the next
 * message can retry.
 */
export function createSessionManager<H extends DjonikSessionHandle>(
  connect: () => Promise<H>,
): DjonikSessionManager<H> & {
  /** Id of the connected Session, or null while none is connected (never connected, or invalidated). */
  currentSessionId(): string | null;
} {
  let sessionPromise: Promise<H> | null = null;
  let connected: H | null = null;

  function getSession(): Promise<H> {
    if (!sessionPromise) {
      const attempt: Promise<H> = connect().then(
        (session) => {
          if (sessionPromise === attempt) connected = session;
          return session;
        },
        (error: unknown) => {
          if (sessionPromise === attempt) sessionPromise = null;
          throw error;
        },
      );
      sessionPromise = attempt;
    }
    return sessionPromise;
  }

  function closeIfOpen(): void {
    sessionPromise?.then((session) => session.close()).catch(() => {});
  }

  function invalidate(handle?: H): void {
    if (handle !== undefined && connected !== handle) return;
    connected?.close();
    sessionPromise = null;
    connected = null;
  }

  return { getSession, closeIfOpen, invalidate, currentSessionId: () => connected?.sessionId ?? null };
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
  if (sessionDeadErrorOf(error)) {
    manager.invalidate();
  }
}

/** The `DjonikSessionDeadError` behind `error`, including one wrapped by a traced (#39) turn. */
function unverifiedMutationErrorOf(error: unknown): DjonikUnverifiedMutationError | null {
  if (error instanceof DjonikUnverifiedMutationError) return error;
  if (error instanceof DjonikTracedTurnError && error.error instanceof DjonikUnverifiedMutationError) return error.error;
  return null;
}

export function sessionDeadErrorOf(error: unknown): DjonikSessionDeadError | null {
  if (error instanceof DjonikSessionDeadError) return error;
  if (error instanceof DjonikTracedTurnError && error.error instanceof DjonikSessionDeadError) return error.error;
  return null;
}

/** Content-free Session-replacement telemetry (#53). */
export type SessionRecoveryEvent =
  | { type: "session_replaced"; pendingMessage: PendingMessageState; resubmit: boolean }
  | { type: "message_resubmitted"; outcome: "completed" | "turn_failed" | "not_delivered" };

/**
 * #60: one content-free line per failed serving turn attempt, enough to place a future provider incident: the
 * stage, the class (structured, never `error.message`), the HTTP status, what happened to the cached Session and
 * what is known about the message's delivery. No message text, ids, request ids, URLs or credentials.
 */
export interface ServingTurnFailureEvent {
  type: "serving_turn_failure";
  stage: ServingStage;
  category: ProviderFailureCategory | "session_dead" | "application";
  status: number | null;
  errorClass: string;
  /** `replace`: the Session was given up; `keep`: it serves the next turn; `none`: no Session was obtained. */
  sessionAction: "replace" | "keep" | "none";
  delivery: PendingMessageState;
}

/** Builds the #60 failure event for an error `runWithSessionRecovery` saw. */
export function servingTurnFailureOf(error: unknown): ServingTurnFailureEvent {
  if (error instanceof DjonikSessionConnectError) {
    const failure = error.providerFailure;
    return {
      type: "serving_turn_failure",
      stage: "session_connect",
      category: failure?.category ?? "application",
      status: failure?.status ?? null,
      errorClass: failure?.errorClass ?? errorClassOf(error.cause),
      sessionAction: "none",
      delivery: "not_submitted",
    };
  }
  const dead = sessionDeadErrorOf(error);
  if (dead) {
    const failure = dead.providerFailure;
    return {
      type: "serving_turn_failure",
      stage: dead.stage,
      category: failure?.category ?? "session_dead",
      status: failure?.status ?? null,
      errorClass: failure?.errorClass ?? `DjonikSessionDeadError:${dead.reason}`,
      sessionAction: "replace",
      delivery: dead.pendingMessage,
    };
  }
  const failure = classifyProviderFailure(error);
  return {
    type: "serving_turn_failure",
    stage: "turn",
    category: failure?.category ?? "application",
    status: failure?.status ?? null,
    errorClass: failure?.errorClass ?? errorClassOf(error instanceof DjonikTracedTurnError ? error.error : error),
    sessionAction: "keep",
    // A 4xx is a refusal of the request; anything else is not established here.
    delivery: failure !== null && failure.status !== null && failure.status < 500 ? "not_submitted" : "unknown",
  };
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/**
 * #53: runs one turn on the process's Session and owns the only Session REPLACEMENT path. A dropped stream
 * never reaches here — the handle reconnects to the same Session itself; this handles the Session being
 * given up (`DjonikSessionDeadError`):
 *
 * - the dead handle (and only it) is discarded, so the next turn gets a fresh Session;
 * - the turn is run again on the replacement ONCE, and only when the error proves its message never
 *   started processing (`not_submitted` / `unprocessed`). A possibly processed message (`processed`,
 *   `unknown`) is never resubmitted: the original error propagates and the caller shows the fixed
 *   Ukrainian line (`formatUserFacingError`), so Daniel decides — nothing is duplicated.
 *
 * A failure of the replacement Session itself propagates as the ORIGINAL error (safe to resend, since
 * nothing was processed); a second give-up on the replacement only invalidates it.
 *
 * #60: a Session that cannot be obtained at all (`getSession` failed) becomes `DjonikSessionConnectError` —
 * nothing was submitted, and the user-facing line says so without the provider's raw text. That includes the
 * replacement here: its message provably never started processing (that is why it was being resubmitted).
 * Every failed attempt is reported once, content-free, to `onFailure`.
 */
export async function runWithSessionRecovery<H extends DjonikSessionHandle, T>(
  manager: DjonikSessionManager<H>,
  run: (session: H) => Promise<T>,
  onRecovery?: (event: SessionRecoveryEvent) => void,
  logError: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
  onFailure?: (event: ServingTurnFailureEvent) => void,
): Promise<T> {
  const fail = (error: unknown): unknown => {
    onFailure?.(servingTurnFailureOf(error));
    return error;
  };
  let session: H;
  try {
    session = await manager.getSession();
  } catch (connectError) {
    throw fail(new DjonikSessionConnectError(connectError));
  }
  try {
    return await run(session);
  } catch (error) {
    fail(error);
    const dead = sessionDeadErrorOf(error);
    if (!dead) throw error;
    const resubmit = canResubmit(dead.pendingMessage);
    manager.invalidate(session);
    onRecovery?.({ type: "session_replaced", pendingMessage: dead.pendingMessage, resubmit });
    if (!resubmit) throw error;

    let replacement: H;
    try {
      replacement = await manager.getSession();
    } catch (connectError) {
      logError("Djonik replacement Session could not be created:", connectError);
      onRecovery?.({ type: "message_resubmitted", outcome: "not_delivered" });
      const connectFailure = new DjonikSessionConnectError(connectError);
      fail(connectFailure);
      // A classified provider failure gets its own (still "not processed") line; anything else keeps #53's.
      throw connectFailure.providerFailure ? connectFailure : error;
    }
    try {
      const result = await run(replacement);
      onRecovery?.({ type: "message_resubmitted", outcome: "completed" });
      return result;
    } catch (retryError) {
      onRecovery?.({ type: "message_resubmitted", outcome: "turn_failed" });
      fail(retryError);
      if (sessionDeadErrorOf(retryError)) manager.invalidate(replacement);
      throw retryError;
    }
  }
}
