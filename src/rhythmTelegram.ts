import { GrammyError } from "grammy";
import type { IncomingFragment, MessageGroupBuffer } from "./messageGrouping.js";
import { decodeCallbackData, toTelegramReplyMarkup, utteranceFor, type OutboundMessage, type RhythmActionId, type TelegramInlineKeyboard } from "./rhythmActions.js";
import { kyivLabel, type ProactiveSender, type SendOutcome } from "./rhythmRunner.js";
import { findDeliveryByRef, type RhythmStateStore } from "./rhythmState.js";
import { isAllowedUser } from "./telegramAdapter.js";
import { sendFormattedMessage, type TelegramTextApi } from "./telegramFormat.js";

/**
 * Telegram transport for Working Rhythm (#39): sending a final proactive message with an optional
 * inline keyboard, and turning a button click back into an ordinary user turn. No PM logic lives here.
 */

// --- Outbound ----------------------------------------------------------------------------------------

/** The subset of grammY's `bot.api` this transport needs (keeps it testable without a live bot). */
export type TelegramProactiveApi = TelegramTextApi<TelegramInlineKeyboard>;

/** An API refusal (Telegram answered `ok: false`) is definite non-delivery; anything else is unknown. */
export function classifySendError(error: unknown): SendOutcome {
  if (error instanceof GrammyError) return { status: "rejected", reason: `http_${error.error_code}` };
  return { status: "unknown", reason: error instanceof Error ? error.name : "error" };
}

/**
 * Sends one final proactive message to Daniel's private chat. The keyboard comes only from the
 * delivery's bounded action list; the text is Claude's final reply (never interim text), rendered by the
 * same shared Telegram HTML path as ordinary replies (`sendFormattedMessage`). A parse-error fallback's
 * own failure is classified exactly like any other send failure.
 */
export function createTelegramProactiveSender(api: TelegramProactiveApi, chatId: number): ProactiveSender {
  return async (message: OutboundMessage, ref: string) => {
    const replyMarkup = toTelegramReplyMarkup(message.actions, ref);
    try {
      const sent = await sendFormattedMessage(api, chatId, message.text, replyMarkup);
      return { status: "sent", messageId: sent.message_id };
    } catch (error) {
      return classifySendError(error);
    }
  };
}

// --- Inbound callbacks --------------------------------------------------------------------------------

export const STALE_BUTTON_TEXT = "Ця кнопка вже неактуальна. Напиши, будь ласка, текстом — так надійніше.";
export const ALREADY_ANSWERED_TEXT = "Відповідь на це повідомлення вже прийнята. Якщо хочеш щось змінити — напиши текстом.";

/** Buttons older than this are stale even inside the same Session. */
export const BUTTON_TTL_HOURS = 48;

export interface RhythmCallbackQuery {
  /** Telegram's callback query id, for the acknowledgement. */
  id?: string;
  data?: string;
  fromId?: number;
  chatId?: number;
  /** The id of the bot message the button is attached to. */
  messageId?: number;
}

export interface RhythmCallbackDeps {
  allowedUserId: string;
  store: RhythmStateStore;
  now(): Date;
  /** The Session currently serving; a button from an earlier Session has lost its context. */
  currentSessionId(): string | null;
  /** Acknowledges this callback query; `alert` text is shown as a dismissible notice. */
  answer(query: RhythmCallbackQuery, alert?: string): Promise<unknown>;
  /** Best-effort removal of the keyboard after a click (buttons are single-use). */
  clearButtons?(chatId: number, messageId: number): Promise<unknown>;
  /** The same entry point typed text uses: the grouping buffer → FIFO Session turn. */
  enqueueUserText(fragment: Pick<IncomingFragment, "chatId" | "userId" | "messageId" | "text">): void;
  log?(line: string): void;
}

/**
 * The `enqueueUserText` the wiring uses. A click carries the id of the (older) bot message, so it must
 * never join a still-buffering group (sorting by message id would put it first). `enqueueAfterPending`
 * makes it its own intake after everything this chat already sent — a still-arriving album is not split,
 * it settles on its own window — and before anything sent next, through the same buffer and FIFO Session
 * queue. Only this chat/user is affected (no global flush).
 */
export function enqueueClickAfterPendingText(buffer: Pick<MessageGroupBuffer, "enqueueAfterPending">): RhythmCallbackDeps["enqueueUserText"] {
  return (fragment) => buffer.enqueueAfterPending(fragment);
}

export type CallbackResolution =
  | { outcome: "ignored"; reason: "unauthorized" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "enqueued"; action: RhythmActionId; utterance: string };

/**
 * Handles one callback query. It never calls Trello, Memory or the Session directly: a valid click
 * becomes one fixed utterance pushed into the ordinary user-turn path, where Claude reasons and any
 * external change goes through the normal verified mutation path. Unknown, malformed, expired,
 * already-used or context-less (after a restart) buttons fail gently and ask for a text reply.
 */
export function createRhythmCallbackHandler(deps: RhythmCallbackDeps): (query: RhythmCallbackQuery) => Promise<CallbackResolution> {
  const log = deps.log ?? (() => {});
  let tail: Promise<unknown> = Promise.resolve();

  async function handle(query: RhythmCallbackQuery): Promise<CallbackResolution> {
    if (!isAllowedUser(query.fromId, deps.allowedUserId)) return { outcome: "ignored", reason: "unauthorized" };

    const reject = async (reason: string, alert = STALE_BUTTON_TEXT): Promise<CallbackResolution> => {
      log(`[rhythm] callback_rejected reason=${reason}`);
      await deps.answer(query, alert).catch(() => undefined);
      return { outcome: "rejected", reason };
    };

    const decoded = decodeCallbackData(query.data);
    if (!decoded.ok) return reject(decoded.reason);
    if (query.chatId === undefined || query.messageId === undefined) return reject("no_message");

    let accepted: { kind: Parameters<typeof utteranceFor>[1]; when: string } | null = null;
    let rejection: string | null = null;
    try {
      // Validate and mark answered in one serialized update, so a double click cannot enqueue twice.
      await deps.store.update((state) => {
        const record = findDeliveryByRef(state, decoded.ref);
        const now = deps.now();
        if (!record) rejection = "unknown_ref";
        else if (record.status !== "sent" || record.sentAt === undefined) rejection = "not_delivered";
        else if (record.telegramMessageId !== query.messageId) rejection = "message_mismatch";
        else if (!record.actions.includes(decoded.action)) rejection = "action_not_offered";
        else if (record.answeredAt !== undefined) rejection = "already_answered";
        else if (record.sessionId === null || record.sessionId !== deps.currentSessionId()) rejection = "session_changed";
        else if (now.getTime() - new Date(record.sentAt).getTime() > BUTTON_TTL_HOURS * 3_600_000) rejection = "expired";
        if (rejection !== null || !record) return state;
        accepted = { kind: record.kind, when: kyivLabel(new Date(record.sentAt!), record.kind === "exception" || record.kind === "evening") };
        return {
          ...state,
          deliveries: { ...state.deliveries, [record.key]: { ...record, answeredAt: now.toISOString(), answeredAction: decoded.action } },
        };
      });
    } catch {
      return reject("state_unavailable");
    }
    if (rejection === "already_answered") return reject(rejection, ALREADY_ANSWERED_TEXT);
    if (rejection !== null || accepted === null) return reject(rejection ?? "unknown");

    const { kind, when } = accepted as { kind: Parameters<typeof utteranceFor>[1]; when: string };
    const utterance = utteranceFor(decoded.action, kind, when);
    // Enqueue first (synchronously, still inside this serialized handler), so arrival order is fixed before
    // any network acknowledgement; the acknowledgement and keyboard removal are best-effort.
    deps.enqueueUserText({ chatId: query.chatId, userId: query.fromId!, messageId: query.messageId, text: utterance });
    await deps.answer(query).catch(() => undefined);
    await deps.clearButtons?.(query.chatId, query.messageId).catch(() => undefined);
    log(`[rhythm] callback_enqueued action=${decoded.action}`);
    return { outcome: "enqueued", action: decoded.action, utterance };
  }

  // Callbacks are handled one at a time, in arrival order.
  return (query) => {
    const run = tail.then(() => handle(query));
    tail = run.catch(() => undefined);
    return run;
  };
}
