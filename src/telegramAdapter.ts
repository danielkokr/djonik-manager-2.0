import type { DjonikSessionHandle } from "./djonikClient.js";

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

  return { getSession, closeIfOpen };
}
