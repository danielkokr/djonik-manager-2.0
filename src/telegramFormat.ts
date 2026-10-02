import { GrammyError } from "grammy";

/**
 * The one Telegram presentation path (#39 presentation fix). Djonik writes lightweight Markdown; Telegram
 * would show it literally. Every user-visible send — ordinary replies, fixed notices and Working Rhythm
 * proactive messages — goes through `sendFormattedMessage`, which renders a deliberately tiny subset into
 * Telegram HTML parse mode. This is not a Markdown parser and never passes model HTML through.
 */

/** The subset of grammY's `bot.api` the send path needs (keeps it testable without a live bot). */
export interface TelegramTextApi<Markup = unknown> {
  sendMessage(chatId: number, text: string, other?: { parse_mode?: "HTML"; reply_markup?: Markup }): Promise<{ message_id: number }>;
}

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Inline code: one line, non-empty, no backtick inside. Bold: one line, content neither starts nor ends
// with whitespace or `*` (so `2 ** 3`, a lone `**` or `***` stay literal). Anything that does not match
// is left as escaped plain text — malformed markup is preserved rather than guessed at.
const CODE = /`([^`\n]+)`/g;
const INLINE = /`([^`\n]+)`|\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g;

function renderCode(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    out += escapeTelegramHtml(text.slice(last, match.index)) + `<code>${escapeTelegramHtml(match[1])}</code>`;
    last = match.index + match[0].length;
  }
  return out + escapeTelegramHtml(text.slice(last));
}

/**
 * Renders `**bold**` → `<b>` and `` `code` `` → `<code>`. All source text is HTML-escaped first; the only
 * tags in the output are the ones generated here, so raw `<tag>` from the model can never become markup.
 */
export function renderTelegramHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escapeTelegramHtml(text.slice(last, match.index));
    out += match[1] !== undefined ? `<code>${escapeTelegramHtml(match[1])}</code>` : `<b>${renderCode(match[2])}</b>`;
    last = match.index + match[0].length;
  }
  return out + escapeTelegramHtml(text.slice(last));
}

// #63: an Atlassian Resource Identifier (Trello MCP ids are `ari:cloud:trello::card/workspace/<ws>/<id>`). It must
// start a token — after start, whitespace or opening punctuation — so an `ari:cloud:` inside a URL is never touched.
// The id body stops before sentence punctuation, so a trailing `.`/`,` stays.
const ARI = String.raw`(?<![^\s(\[«"'„“\x60])ari:cloud:[a-z0-9-]+:[a-z0-9-]*:[a-z0-9-]+(?:[/.][\w-]+)*`;
/** A bracket/backtick wrapper holding only ARIs (and the space before it) goes with them: `«Назва» (ari:…)` → `«Назва»`. */
const WRAPPED_ARIS = new RegExp(String.raw`[ \t]*(?:\(\s*${ARI}(?:\s*,\s*${ARI})*\s*\)|\[\s*${ARI}\s*\]|\x60${ARI}\x60)`, "giu");
const BARE_ARI = new RegExp(String.raw`[ \t]*${ARI}`, "giu");

/**
 * Removes opaque provider resource identifiers (ARIs) from user-visible text (#63). Code-owned Trello reports are
 * already id-free at their source (`MutationReportAudience`); this is the delivery-boundary guarantee for model
 * prose, which arrives as plain text after the model has seen ARIs in tool results. Only ARI syntax is matched —
 * URLs (Google Docs, `https://trello.com/c/…`), other parentheses and prose are returned unchanged.
 */
export function stripProviderResourceIds(text: string): string {
  if (!/ari:cloud:/i.test(text)) return text;
  return text.replace(WRAPPED_ARIS, "").replace(BARE_ARI, "");
}

/** Telegram refused the message only because it could not parse the HTML entities. */
export function isEntityParseError(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 400 && /can't parse entities|can't find end of the entity/i.test(error.description);
}

/**
 * Sends `text` rendered as Telegram HTML, keeping `reply_markup` exactly as given. If — and only if —
 * Telegram rejects the entities, one fallback sends the original text without `parse_mode` (a parse
 * rejection means nothing was delivered, so this cannot duplicate). Every other failure propagates
 * unchanged, so the caller's delivery classification stays as it was. Both sends carry the ARI-free text (#63).
 */
export async function sendFormattedMessage<Markup>(
  api: TelegramTextApi<Markup>,
  chatId: number,
  original: string,
  replyMarkup?: Markup,
): Promise<{ message_id: number }> {
  const text = stripProviderResourceIds(original);
  const markup = replyMarkup === undefined ? {} : { reply_markup: replyMarkup };
  try {
    return await api.sendMessage(chatId, renderTelegramHtml(text), { parse_mode: "HTML", ...markup });
  } catch (error) {
    if (!isEntityParseError(error)) throw error;
    return api.sendMessage(chatId, text, replyMarkup === undefined ? undefined : markup);
  }
}

/** `(chatId, text)` sender for ordinary replies and fixed notices (dispatch, shutdown notice). */
export function createFormattedTextSender(api: TelegramTextApi<never>): (chatId: number, text: string) => Promise<{ message_id: number }> {
  return (chatId, text) => sendFormattedMessage(api, chatId, text);
}
