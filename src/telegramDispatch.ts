import type { GroupedIntake } from "./messageGrouping.js";
import { buildGroupingTelemetry } from "./messageGrouping.js";
import {
  formatGroupFailureError,
  formatUserFacingError,
  runWithSessionRecovery,
  type DjonikSessionManager,
  type SessionRecoveryEvent,
} from "./telegramAdapter.js";

/**
 * The `MessageGroupBuffer.onDispatch`/`onFailure` pair `telegramCli.ts` wires
 * up, extracted into a small, framework-agnostic, independently-testable
 * unit (#25 Product Lead follow-up, point 6). This is the ONLY place a
 * grouped/single intake reaches `DjonikSessionHandle.send` — the exact
 * integration seam an "exactly one Managed Agent call per grouped intake"
 * test needs, without requiring a live grammY `Bot`/`Context` or a real
 * Telegram update. `telegramCli.ts` supplies the real `djonikSession`
 * manager and `bot.api.sendMessage`; tests supply fakes.
 */
export interface GroupDispatchDeps {
  djonikSession: DjonikSessionManager;
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
  /** Content-free grouping telemetry sink (see `buildGroupingTelemetry`); omit to disable. */
  onGroupTelemetry?: (telemetry: ReturnType<typeof buildGroupingTelemetry>) => void;
  /** Defaults to `console.error`; overridable so tests can assert on/silence it. */
  logError?: (message: string, error: unknown) => void;
  /** Content-free Session replacement / resubmission telemetry (#53). */
  onSessionRecovery?: (event: SessionRecoveryEvent) => void;
}

export interface GroupDispatchHandlers {
  onDispatch: (chatId: number, userId: number, intake: GroupedIntake) => Promise<void>;
  onFailure: (chatId: number, userId: number, error: unknown) => Promise<void>;
}

export function createGroupDispatchHandlers(deps: GroupDispatchDeps): GroupDispatchHandlers {
  const logError = deps.logError ?? ((message, error) => console.error(message, error));

  return {
    onDispatch: async (chatId, _userId, intake) => {
      deps.onGroupTelemetry?.(buildGroupingTelemetry(intake));
      try {
        // #27: send in original Telegram order/relationship (caption next to
        // its own image, text → image → correction kept in sequence) via
        // `sendOrdered`, not the legacy `send(text, images, documents)`
        // flattening, which loses that structure. #53: a Session given up
        // mid-turn is replaced, and the intake resubmitted only when provably
        // unprocessed — never twice, never a possibly processed turn.
        const reply = await runWithSessionRecovery(
          deps.djonikSession,
          (session) => session.sendOrdered(intake.parts),
          deps.onSessionRecovery,
          logError,
        );
        await deps.sendMessage(chatId, reply);
      } catch (error) {
        logError("Djonik grouped turn failed:", error);
        await deps.sendMessage(chatId, formatUserFacingError(error));
      }
    },
    onFailure: async (chatId, _userId, error) => {
      // Pre-send failure (#25): at least one attachment in this grouped
      // intake failed MIME/size/download/preparation, or the group exceeded
      // its fragment-count ceiling. The whole group is discarded here —
      // `session.send` is never called for it, so this path can never reach
      // Trello, matching the "fail the whole grouped intake, zero mutation"
      // requirement.
      logError("Djonik grouped intake failed before send:", error);
      await deps.sendMessage(chatId, formatGroupFailureError(error));
    },
  };
}
