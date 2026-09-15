import { DjonikSessionDeadError, type DjonikSessionHandle } from "./djonikClient.js";

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
