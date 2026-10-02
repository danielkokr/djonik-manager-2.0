import type { GroupedIntake } from "./messageGrouping.js";
import { buildGroupingTelemetry } from "./messageGrouping.js";
import {
  isAcceptanceText,
  isProposalReply,
  proposalKeyboard,
  ProposalConfirmations,
  STALE_PROPOSAL_TEXT,
  VOICE_CONFIRMATION_REFUSED_TEXT,
} from "./proposalConfirmation.js";
import {
  formatGroupFailureError,
  formatUserFacingError,
  runWithSessionRecovery,
  type DjonikSessionManager,
  type SessionRecoveryEvent,
} from "./telegramAdapter.js";
import type { TurnOrigin } from "./turnAuthority.js";
import { formatVoiceFailure, VOICE_GROUP_SUFFIX, VoiceInputError } from "./voiceInput.js";

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
  /** Optional proposal UI; code builds the keyboard and binds the returned Telegram message id. */
  sendProposal?: (chatId: number, text: string, keyboard: ReturnType<typeof proposalKeyboard>) => Promise<{ message_id: number }>;
  proposals?: ProposalConfirmations;
  /** Content-free grouping telemetry sink (see `buildGroupingTelemetry`); omit to disable. */
  onGroupTelemetry?: (telemetry: ReturnType<typeof buildGroupingTelemetry>) => void;
  /** Defaults to `console.error`; overridable so tests can assert on/silence it. */
  logError?: (message: string, error: unknown) => void;
  /** Content-free Session replacement / resubmission telemetry (#53). */
  onSessionRecovery?: (event: SessionRecoveryEvent) => void;
}

export interface GroupDispatchHandlers {
  onDispatch: (chatId: number, userId: number, intake: GroupedIntake) => Promise<void>;
  onFailure: (chatId: number, userId: number, error: unknown, fragmentCount?: number) => Promise<void>;
}

/**
 * The trusted origin of a Telegram intake (#48, refined by #58), from transport provenance only — never from
 * what any text says. Source-only forwarded material is `forwarded_source` (read-only). A forward grouped with
 * Daniel's own typed text or caption is his ordinary `user_message` turn; the forwarded parts keep their
 * source wrapper and remain data, not instruction.
 */
export function intakeOrigin(intake: Pick<GroupedIntake, "hasForwardedSource" | "hasOwnTypedText">): TurnOrigin {
  return intake.hasForwardedSource === true && intake.hasOwnTypedText !== true ? "forwarded_source" : "user_message";
}

export function createGroupDispatchHandlers(deps: GroupDispatchDeps): GroupDispatchHandlers {
  const logError = deps.logError ?? ((message, error) => console.error(message, error));

  return {
    onDispatch: async (chatId, userId, intake) => {
      deps.onGroupTelemetry?.(buildGroupingTelemetry(intake));
      try {
        const proposals = deps.proposals;
        if (intake.hasForwardedSource) proposals?.invalidate(chatId, userId);
        // #49 fail-closed: speech-to-text is not trusted to authorize the #48 bound proposal. While one is
        // pending, a confirmation-like transcript of Daniel's own voice is not sent as a human-authority turn
        // (Claude would see it next to its proposal) and the proposal is left pending, not revised or consumed.
        if (
          !intake.hasForwardedSource &&
          proposals?.has(chatId, userId) === true &&
          intake.ownVoiceTranscripts?.some(isAcceptanceText) === true
        ) {
          await deps.sendMessage(chatId, intake.fragmentCount > 1 ? VOICE_CONFIRMATION_REFUSED_TEXT + VOICE_GROUP_SUFFIX : VOICE_CONFIRMATION_REFUSED_TEXT);
          return;
        }
        const soleText = intake.parts.length === 1 && intake.parts[0].type === "text" ? intake.parts[0].text : null;
        const typed = !intake.hasForwardedSource && soleText !== null ? proposals?.typed(soleText, chatId, userId) : undefined;
        if (typed?.kind === "stale") { await deps.sendMessage(chatId, STALE_PROPOSAL_TEXT); return; }
        const hadPending = !intake.hasForwardedSource && typed?.kind !== "apply" && proposals?.has(chatId, userId) === true;
        if (hadPending) proposals?.beginRevision(chatId, userId);
        const parts = typed?.kind === "apply" ? [{ type: "text" as const, text: typed.text }] : intake.parts;
        // #27: send in original Telegram order/relationship (caption next to
        // its own image, text → image → correction kept in sequence) via
        // `sendOrdered`, not the legacy `send(text, images, documents)`
        // flattening, which loses that structure. #53: a Session given up
        // mid-turn is replaced, and the intake resubmitted only when provably
        // unprocessed — never twice, never a possibly processed turn.
        const reply = await runWithSessionRecovery(
          deps.djonikSession,
          (session) => session.sendOrdered(parts, intakeOrigin(intake)),
          deps.onSessionRecovery,
          logError,
        );
        if (proposals && deps.sendProposal && isProposalReply(reply)) {
          const ref = proposals.newRef();
          const sent = await deps.sendProposal(chatId, reply, proposalKeyboard(ref));
          proposals.register(chatId, userId, sent.message_id, reply, ref);
        } else {
          await deps.sendMessage(chatId, reply);
        }
      } catch (error) {
        logError("Djonik grouped turn failed:", error);
        await deps.sendMessage(chatId, formatUserFacingError(error));
      }
    },
    onFailure: async (chatId, _userId, error, fragmentCount = 1) => {
      // Pre-send failure (#25): at least one attachment in this grouped
      // intake failed MIME/size/download/preparation, or the group exceeded
      // its fragment-count ceiling. The whole group is discarded here —
      // `session.send` is never called for it, so this path can never reach
      // Trello, matching the "fail the whole grouped intake, zero mutation"
      // requirement.
      // #49: a failed voice/audio transcription gets one fixed line (never provider text); a forwarded voice
      // failure likewise produces no proposal, because no turn is sent.
      if (error instanceof VoiceInputError) {
        logError("Djonik voice input failed before send:", `reason=${error.reason}`);
        await deps.sendMessage(chatId, formatVoiceFailure(error, fragmentCount));
        return;
      }
      logError("Djonik grouped intake failed before send:", error);
      await deps.sendMessage(chatId, formatGroupFailureError(error));
    },
  };
}
