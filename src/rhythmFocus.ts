import type { RhythmConfig } from "./rhythmConfig.js";
import type { ListRole, Signal, SignalFacts } from "./rhythmSignals.js";
import { formatKyivDateTime } from "./trelloWorkHistory.js";
import { workingDeadline } from "./workingTime.js";

/**
 * Current focus from Trello moves (#50): code-owned, content-light, zero model calls.
 *
 * The authoritative signal is a card entering the board's In progress list, as Trello's own action history proves
 * it (`CardFact.enteredListAt`, the same list-entry evidence the Working Rhythm already uses). Every fact collection
 * advances this ledger from fresh facts; nothing here reads a card's activity time, a description, or conversation.
 * Trello proves that a card was In progress — not that Daniel worked on it continuously.
 *
 * Several cards may be In progress at once. Semantics (documented in docs/87 §6):
 * - every In-progress card is an active stint (the weekly report splits overlapping time equally among them);
 * - the CURRENT focus is the stint with the most recent authoritative entry; an entry time that is unknown never
 *   outranks a known one. A second card entering In progress therefore becomes the current focus without ending the
 *   first one; the first ends only when it leaves In progress.
 *
 * A focus budget is Daniel's own explicit duration for one stint (the `focus_budget` tool, never Size). It is bound to
 * that stint's entry time, so it disappears with the stint and never carries over to a later return to In progress.
 */

export interface FocusStint {
  cardId: string;
  /** Project slug from the card's label at the latest observation; null when unlabelled/ambiguous. */
  project: string | null;
  /** Authoritative Trello entry into In progress, or null when history could not establish it. */
  enteredAt: string | null;
  /** When code first observed this stint. */
  observedAt: string;
}

/** Where an ended stint's card is now: a list role, `gone` (archived/deleted/other board), or `unknown` (left and
 *  re-entered In progress between two observations). */
export type FocusEndedTo = ListRole | "gone" | "unknown";

export interface FocusEnded {
  cardId: string;
  project: string | null;
  enteredAt: string | null;
  /** Authoritative entry into the list the card is in now — an upper bound on when the stint ended; null = unknown. */
  nextListEnteredAt: string | null;
  /** When code observed the end. */
  observedAt: string;
  to: FocusEndedTo;
}

export interface FocusBudget {
  cardId: string;
  /** The stint this budget belongs to (its authoritative In-progress entry). */
  enteredAt: string;
  /** Daniel's explicit working-time budget. */
  minutes: number;
  setAt: string;
  /** The `custom_tool_use_id` that set it (idempotency key). */
  toolUseId: string;
}

export interface FocusToolCall {
  op: "set" | "clear";
  at: string;
  isError: boolean;
  content: string;
}

export interface FocusLedger {
  version: 1;
  active: Record<string, FocusStint>;
  /** Most recent ended stints, oldest first; bounded (`MAX_ENDED`, `ENDED_RETENTION_DAYS`). */
  ended: FocusEnded[];
  budgets: Record<string, FocusBudget>;
  toolCalls: Record<string, FocusToolCall>;
}

export const MAX_ENDED = 20;
export const ENDED_RETENTION_DAYS = 14;
export const FOCUS_TOOL_CALL_RETENTION_DAYS = 14;

export function emptyFocusLedger(): FocusLedger {
  return { version: 1, active: {}, ended: [], budgets: {}, toolCalls: {} };
}

export function isEmptyFocusLedger(ledger: FocusLedger): boolean {
  return (
    Object.keys(ledger.active).length === 0 &&
    ledger.ended.length === 0 &&
    Object.keys(ledger.budgets).length === 0 &&
    Object.keys(ledger.toolCalls).length === 0
  );
}

export class FocusLedgerError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isIsoOrNull = (value: unknown) => value === null || isIso(value);
const isSlugOrNull = (value: unknown) => value === null || typeof value === "string";
const ENDED_TO = new Set<string>(["backlog", "todo", "in_progress", "waiting", "done", "other", "gone", "unknown"]);

/** Validates a loaded focus ledger (fail closed: a malformed ledger makes the whole state file unreadable). */
export function validateFocusLedger(value: unknown): FocusLedger {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.active) || !Array.isArray(value.ended) || !isRecord(value.budgets) || !isRecord(value.toolCalls)) {
    throw new FocusLedgerError("focus ledger has an unknown shape or version");
  }
  for (const [id, stint] of Object.entries(value.active)) {
    if (!isRecord(stint) || stint.cardId !== id || !isSlugOrNull(stint.project) || !isIsoOrNull(stint.enteredAt) || !isIso(stint.observedAt)) {
      throw new FocusLedgerError("focus ledger has a malformed stint");
    }
  }
  for (const ended of value.ended) {
    if (
      !isRecord(ended) || typeof ended.cardId !== "string" || !isSlugOrNull(ended.project) || !isIsoOrNull(ended.enteredAt) ||
      !isIsoOrNull(ended.nextListEnteredAt) || !isIso(ended.observedAt) || !ENDED_TO.has(ended.to as string)
    ) {
      throw new FocusLedgerError("focus ledger has a malformed ended stint");
    }
  }
  for (const [id, budget] of Object.entries(value.budgets)) {
    if (
      !isRecord(budget) || budget.cardId !== id || !isIso(budget.enteredAt) || !isIso(budget.setAt) || typeof budget.toolUseId !== "string" ||
      typeof budget.minutes !== "number" || !Number.isInteger(budget.minutes) || budget.minutes <= 0
    ) {
      throw new FocusLedgerError("focus ledger has a malformed budget");
    }
  }
  for (const call of Object.values(value.toolCalls)) {
    if (!isRecord(call) || (call.op !== "set" && call.op !== "clear") || !isIso(call.at) || typeof call.isError !== "boolean" || typeof call.content !== "string") {
      throw new FocusLedgerError("focus ledger has a malformed tool-call record");
    }
  }
  return value as unknown as FocusLedger;
}

/**
 * Advances the ledger with one fresh fact collection. Pure; zero model calls.
 *
 * - A card In progress now and not before starts a stint (entry time from history, possibly unknown).
 * - A stint whose card left In progress ends; `to` says where the card is now (`gone` when no longer an open card).
 * - A card whose known entry time changed left and re-entered between observations: the old stint ends (`unknown`)
 *   and a new one starts. An entry time that becomes unknown (a degraded history read) never ends a stint.
 * - A budget survives only while its own stint is active.
 */
export function advanceFocus(previous: FocusLedger, facts: Pick<SignalFacts, "cards">, now: Date): FocusLedger {
  const at = now.toISOString();
  const cards = new Map(facts.cards.map((card) => [card.id, card]));
  const active: Record<string, FocusStint> = {};
  const ended: FocusEnded[] = [...previous.ended];
  for (const card of facts.cards) {
    if (card.list !== "in_progress") continue;
    const prior = previous.active[card.id];
    if (!prior) {
      active[card.id] = { cardId: card.id, project: card.project, enteredAt: card.enteredListAt, observedAt: at };
    } else if (prior.enteredAt === null || card.enteredListAt === null || prior.enteredAt === card.enteredListAt) {
      active[card.id] = { ...prior, project: card.project, enteredAt: prior.enteredAt ?? card.enteredListAt };
    } else {
      ended.push({ cardId: prior.cardId, project: prior.project, enteredAt: prior.enteredAt, nextListEnteredAt: null, observedAt: at, to: "unknown" });
      active[card.id] = { cardId: card.id, project: card.project, enteredAt: card.enteredListAt, observedAt: at };
    }
  }
  for (const prior of Object.values(previous.active)) {
    if (active[prior.cardId]) continue;
    const card = cards.get(prior.cardId);
    ended.push({
      cardId: prior.cardId,
      project: card?.project ?? prior.project,
      enteredAt: prior.enteredAt,
      nextListEnteredAt: card?.enteredListAt ?? null,
      observedAt: at,
      to: card ? card.list : "gone",
    });
  }
  const cutoff = now.getTime() - ENDED_RETENTION_DAYS * 86_400_000;
  const budgets: Record<string, FocusBudget> = {};
  for (const budget of Object.values(previous.budgets)) {
    if (active[budget.cardId]?.enteredAt === budget.enteredAt) budgets[budget.cardId] = budget;
  }
  return {
    ...previous,
    active,
    ended: ended.filter((entry) => Date.parse(entry.observedAt) >= cutoff).slice(-MAX_ENDED),
    budgets,
  };
}

export interface CurrentFocus {
  /** The most recently entered active stint; null when nothing is In progress. */
  current: FocusStint | null;
  /** Every other active stint (overlapping In-progress work). */
  parallel: FocusStint[];
}

/** Current focus = the latest authoritative In-progress entry; unknown entry times sort last (stable by id). */
export function currentFocus(ledger: FocusLedger): CurrentFocus {
  const stints = Object.values(ledger.active).sort((a, b) => {
    if (a.enteredAt !== b.enteredAt) {
      if (a.enteredAt === null) return 1;
      if (b.enteredAt === null) return -1;
      return b.enteredAt.localeCompare(a.enteredAt);
    }
    return a.cardId.localeCompare(b.cardId);
  });
  return { current: stints[0] ?? null, parallel: stints.slice(1) };
}

/** `120` → `2 год`, `90` → `1,5 год`, `45` → `45 хв`. */
export function formatBudget(minutes: number): string {
  if (minutes < 60) return `${minutes} хв`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} год` : Number.isInteger(hours * 2) ? `${String(hours).replace(".", ",")} год` : `${Math.floor(hours)} год ${minutes % 60} хв`;
}

/** Budgeted working time counts from the later of the stint's entry and the moment Daniel set the budget. */
export function budgetStart(budget: Pick<FocusBudget, "enteredAt" | "setAt">): Date {
  return new Date(Math.max(Date.parse(budget.enteredAt), Date.parse(budget.setAt)));
}

/** When the budget's working time is used up; null without `work_hours` (then there is no timebox at all). */
export function budgetDeadline(budget: Pick<FocusBudget, "enteredAt" | "setAt" | "minutes">, config: Pick<RhythmConfig, "workHours" | "workdays">): Date | null {
  return workingDeadline(budgetStart(budget), budget.minutes * 60_000, config);
}

/**
 * Timebox exception candidates (#50): one per active stint whose explicit budget of working time has elapsed.
 * No budget → no candidate (a qualitative Size is never a duration). No `work_hours` → no candidate. The key and
 * fingerprint bind the occurrence to that stint and budget, so the existing signal lifecycle raises it at most once
 * (`notified` / `evaluated`), and every existing limit (quiet hours, caps, spacing, mutes) applies unchanged.
 */
export function detectTimeboxSignals(ledger: FocusLedger, facts: Pick<SignalFacts, "cards">, now: Date, config: Pick<RhythmConfig, "workHours" | "workdays">): Signal[] {
  const cards = new Map(facts.cards.map((card) => [card.id, card]));
  const signals: Signal[] = [];
  const activeCount = Object.keys(ledger.active).length;
  for (const budget of Object.values(ledger.budgets).sort((a, b) => a.cardId.localeCompare(b.cardId))) {
    const stint = ledger.active[budget.cardId];
    const card = cards.get(budget.cardId);
    if (!stint || stint.enteredAt !== budget.enteredAt || !card || card.list !== "in_progress") continue;
    const deadline = budgetDeadline(budget, config);
    if (deadline === null || deadline.getTime() > now.getTime()) continue;
    const parallel = activeCount - 1;
    signals.push({
      key: `timebox:${budget.cardId}`,
      kind: "timebox_elapsed",
      channel: "interrupt",
      severity: "medium",
      fingerprint: `${budget.enteredAt}|${budget.setAt}|${budget.minutes}`,
      project: card.project,
      subject: card.name,
      fact:
        `⏱ бюджет Daniel ${formatBudget(budget.minutes)} робочого часу вичерпано ${formatKyivDateTime(deadline)} ` +
        `(рахую з ${formatKyivDateTime(budgetStart(budget))})${parallel > 0 ? `; паралельно в In progress ще ${parallel}` : ""}`,
    });
  }
  return signals;
}
