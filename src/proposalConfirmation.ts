import { randomBytes } from "node:crypto";
import type { TelegramInlineKeyboard } from "./rhythmActions.js";

/** Process-local binding for the one visible Telegram proposal. A restart invalidates buttons safely. */
interface PendingProposal {
  ref: string;
  chatId: number;
  userId: number;
  messageId: number;
  text: string;
  createdAt: number;
}

export const STALE_PROPOSAL_TEXT = "Ця пропозиція вже не актуальна. Перешли повідомлення або попроси нову пропозицію.";
const TTL_MS = 30 * 60 * 1000;
const ACCEPT_RE = /^\s*(?:внести|внось|так[,\s]+внеси|так[,\s]+внести|підтверджую[,\s]+внести)\s*[.!]?\s*$/iu;

/** The one acceptance vocabulary (#48); also used to hold back a voice transcript that looks like acceptance (#49). */
export function isAcceptanceText(text: string): boolean {
  return ACCEPT_RE.test(text);
}

/** #49: a voice transcript never confirms a proposal; the pending proposal stays untouched. */
export const VOICE_CONFIRMATION_REFUSED_TEXT =
  "Голосом пропозицію не підтверджую — натисни «✅ Внести» під нею або напиши «внести» текстом.";

export function isProposalReply(text: string): boolean {
  return text.length <= 3500 && /(?:^|\n)\s*✅\s*Внести\s+✏️\s*Змінити\s*$/u.test(text);
}

export function proposalKeyboard(ref: string): TelegramInlineKeyboard {
  return { inline_keyboard: [[
    { text: "✅ Внести", callback_data: `fp1:a:${ref}` },
    { text: "✏️ Змінити", callback_data: `fp1:m:${ref}` },
  ]] };
}

export type ProposalClick =
  | { kind: "apply"; text: string }
  | { kind: "modify"; text: string }
  | { kind: "stale" }
  | { kind: "not_proposal" };

export class ProposalConfirmations {
  private readonly latest = new Map<string, PendingProposal>();
  constructor(private readonly now: () => number = Date.now) {}

  private key(chatId: number, userId: number): string { return `${chatId}:${userId}`; }

  newRef(): string { return randomBytes(8).toString("hex"); }

  register(chatId: number, userId: number, messageId: number, text: string, ref: string): void {
    if (!isProposalReply(text)) return;
    this.latest.set(this.key(chatId, userId), { ref, chatId, userId, messageId, text, createdAt: this.now() });
  }

  has(chatId: number, userId: number): boolean {
    return this.current(chatId, userId) !== null;
  }

  invalidate(chatId: number, userId: number): void { this.latest.delete(this.key(chatId, userId)); }

  beginRevision(chatId: number, userId: number): void {
    this.invalidate(chatId, userId);
  }

  private current(chatId: number, userId: number): PendingProposal | null {
    const key = this.key(chatId, userId);
    const proposal = this.latest.get(key);
    if (!proposal) return null;
    if (this.now() - proposal.createdAt > TTL_MS) { this.latest.delete(key); return null; }
    return proposal;
  }

  /** A button is bound to its exact sent bot message and the latest proposal for this user/chat. */
  click(data: string | undefined, chatId: number, userId: number, messageId: number): ProposalClick {
    if (!data?.startsWith("fp1:")) return { kind: "not_proposal" };
    const match = /^fp1:([am]):([a-f0-9]{16})$/.exec(data);
    if (!match) return { kind: "stale" };
    const proposal = this.current(chatId, userId);
    if (!proposal || proposal.ref !== match[2] || proposal.messageId !== messageId) return { kind: "stale" };
    if (match[1] === "m") {
      this.beginRevision(chatId, userId);
      return { kind: "modify", text: `Хочу змінити пропозицію з повідомлення №${messageId}. Що саме уточнити?` };
    }
    this.invalidate(chatId, userId);
    return { kind: "apply", text: this.acceptanceText(proposal) };
  }

  typed(text: string, chatId: number, userId: number): ProposalClick {
    if (!isAcceptanceText(text)) return { kind: "not_proposal" };
    const proposal = this.current(chatId, userId);
    if (!proposal) return { kind: "stale" };
    this.invalidate(chatId, userId);
    return { kind: "apply", text: this.acceptanceText(proposal) };
  }

  private acceptanceText(proposal: PendingProposal): string {
    return `Daniel підтверджує саме пропозицію з мого Telegram-повідомлення №${proposal.messageId}:\n${proposal.text}\n` +
      "Виконай лише однозначні погоджені зміни. Перед кожним записом звір ціль зі свіжим Trello; кожен запис перевір окремо. " +
      "Якщо ціль або зміна неоднозначна — спитай і нічого не записуй. Звітуй окремо про підтверджене, непідтверджене й відхилене; не називай пакет атомарним.";
  }
}
