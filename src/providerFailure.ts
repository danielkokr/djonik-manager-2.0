import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";

/**
 * Issue #60: one structured classification of a failed Anthropic API call, from the SDK's own error class and
 * HTTP status — never from `error.message` (the production incident's `503 credential validation failed` is
 * only a regression fixture). Content-free: no message text, request id, URL or body ever leaves here.
 *
 * - `upstream_transient`: provider availability (connection error/timeout, 5xx, 408/409/429). The SDK has already
 *   retried it (`maxRetries`, default 2) before the application sees it.
 * - `auth_config`: 401/403. The host credential or its permissions were refused; resending cannot fix it.
 * - `request_rejected`: any other 4xx. The provider refused this request.
 */
export type ProviderFailureCategory = "upstream_transient" | "auth_config" | "request_rejected";

export interface ProviderFailure {
  category: ProviderFailureCategory;
  /** HTTP status, or null for a connection-level failure (no response). */
  status: number | null;
  /** SDK error class name, e.g. `InternalServerError`, `AuthenticationError`, `APIConnectionError`. */
  errorClass: string;
}

/** Where in a serving turn a provider failure happened. */
export type ServingStage =
  /** `sessions.create` + serving attestation + first stream open (`getSession`). Nothing was sent. */
  | "session_connect"
  /** Before `events.send` (#53 `ensureReady`). Nothing was sent. */
  | "pre_send"
  /** `events.send` of the turn's own `user.message`. */
  | "event_send"
  /** Reading the turn's events after a successful send (#53 feed). */
  | "turn_stream"
  /** Not attributed to a specific provider call. */
  | "turn";

function unwrap(error: unknown): unknown {
  if (error instanceof APIError) return error;
  // A traced turn (#39) wraps the turn's error in `.error`; a connect failure (#60) keeps it in `.cause`.
  const inner = (error as { error?: unknown; cause?: unknown } | null) ?? null;
  if (inner?.error instanceof APIError) return inner.error;
  if (inner?.cause instanceof APIError) return inner.cause;
  return error;
}

/** The provider failure behind `error` (directly, or wrapped once), or null when it is not an API failure. */
export function classifyProviderFailure(error: unknown): ProviderFailure | null {
  const candidate = unwrap(error);
  if (!(candidate instanceof APIError) || candidate instanceof APIUserAbortError) return null;
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const errorClass = candidate.constructor.name;
  if (status === null || status >= 500 || status === 408 || status === 409 || status === 429) {
    return { category: "upstream_transient", status, errorClass };
  }
  if (status === 401 || status === 403) return { category: "auth_config", status, errorClass };
  return { category: "request_rejected", status, errorClass };
}

/**
 * Whether the cached Session should be given up after a provider failure at `stage`.
 *
 * Only a 5xx or a connection failure of a Session-scoped call replaces the Session: the SDK already retried it,
 * and production (#60) showed a process restart — i.e. a fresh Session — restoring service. 4xx answers are
 * refusals: 408/409/429 are account/request throttling a new Session would not escape, 401/403 would hit any
 * Session with the same credential, and other 4xx belong to the request. Domain/model failures (no provider
 * failure) never replace a Session.
 */
export function sessionDisposition(failure: ProviderFailure | null, stage: ServingStage): "keep" | "replace" {
  if (failure === null || failure.category !== "upstream_transient") return "keep";
  if (failure.status !== null && failure.status < 500) return "keep";
  return stage === "event_send" ? "replace" : "keep";
}
