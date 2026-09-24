import type { RhythmConfig } from "./rhythmConfig.js";
import type { CardFact, ListRole, ProjectFact, SignalFacts } from "./rhythmSignals.js";
import type { HistoryCoverage, HistoryWindow, TrelloAction, TrelloBoardCard, TrelloList } from "./trelloWorkHistory.js";

/**
 * Read-only fact collector for the Working Rhythm scheduler (#39): fresh Trello state plus what the board's
 * own action history proves, mapped into the Stage 1 `SignalFacts` contract. It reuses the accepted #36
 * GET-only Trello client (read token, Authorization header); it never writes, never caches, keeps no
 * snapshot and has no webhook. Fresh Trello is the only source.
 *
 * What it deliberately does not do:
 * - no `dateLastActivity`/`lastActivityAt`: activity is not work evidence, and a waiting duration is never
 *   inferred from a card's modification time;
 * - no actor identity: history says a card moved, not who moved it;
 * - no project priority unless a reviewed source supplies it (none exists yet, so `projects` is empty and
 *   the stale-project signal stays off);
 * - no follow-up dates: accepted `next_check` values live in native Memory, which the application does not
 *   parse (#34). The scheduled turn reads them itself; `followUps` stays empty here.
 */

/** The GET-only subset of `TrelloWorkHistoryClient` the collector uses. */
export interface RhythmTrelloReader {
  resolveSingleBoard(): Promise<{ id: string; name: string }>;
  readOpenCards(boardId: string): Promise<TrelloBoardCard[]>;
  readLists(boardId: string): Promise<TrelloList[]>;
  readActions(boardId: string, window: HistoryWindow): Promise<{ actions: TrelloAction[]; coverage: HistoryCoverage }>;
  readLatestListEntry(cardId: string): Promise<TrelloAction | null>;
}

/** At most this many per-card history reads per collection (one per card currently in Waiting). */
export const MAX_WAITING_ENTRY_READS = 20;

/**
 * The board's lists (docs/45 §LISTS: `Inbox · Backlog · This week · In progress · Waiting · Done`) mapped to
 * the Stage 1 roles. Exact names only (case and spacing aside); anything else is `other` — never guessed.
 * Inbox counts as backlog: neither is planned work yet.
 */
export const LIST_ROLE_BY_NAME: Readonly<Record<string, ListRole>> = {
  inbox: "backlog",
  backlog: "backlog",
  "this week": "todo",
  "in progress": "in_progress",
  waiting: "waiting",
  done: "done",
};

export function listRoleFor(name: string | undefined): ListRole {
  if (!name) return "other";
  return LIST_ROLE_BY_NAME[name.trim().replace(/\s+/g, " ").toLocaleLowerCase("uk-UA")] ?? "other";
}

/** `Cossack Labs` → `cossack-labs`: the slug `project:<slug>` mutes and prompts use. */
export function projectSlug(label: string): string {
  return label
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** A label means the project (task-management Skill). Exactly one named label → its slug; none or several → null. */
export function projectOf(card: Pick<TrelloBoardCard, "labels">): string | null {
  const names = (card.labels ?? []).map((label) => label.name?.trim() ?? "").filter((name) => name.length > 0);
  if (names.length !== 1) return null;
  const slug = projectSlug(names[0]);
  return slug.length > 0 ? slug : null;
}

export type ProjectPriorities = ReadonlyMap<string, ProjectFact["priority"]>;

export interface FactsInput {
  cards: readonly TrelloBoardCard[];
  lists: readonly TrelloList[];
  /** Board history for the lookback window; null when the read failed (reopen/movement then unknown). */
  history: { actions: readonly TrelloAction[]; coverage: HistoryCoverage } | null;
  /** Per card: its latest list-changing action, however old (read for Waiting cards); null = none/unknown.
   *  Proves how long a card has been in its current list even beyond the board-history window. */
  latestEntries?: ReadonlyMap<string, TrelloAction | null>;
  /** Only from a reviewed source; absent → no project facts. */
  projectPriorities?: ProjectPriorities;
}

interface CardHistory {
  /** Latest proven entry into a list: which list and when. */
  entered?: { listId: string | null; listName: string | undefined; at: string };
  reopenedFromDoneAt?: string;
}

function actionDate(action: TrelloAction): number | null {
  if (!action.date) return null;
  const at = new Date(action.date).getTime();
  return Number.isNaN(at) ? null : at;
}

/** Where an action put the card, if it did: a move between lists, or the list a card was created in. */
function listEntry(action: TrelloAction): { id: string | null; name: string | undefined; from?: { id: string | null; name: string | undefined } } | null {
  const data = action.data;
  if (!data) return null;
  const before = data.listBefore;
  const after = data.listAfter;
  if (action.type === "updateCard" && after && (after.id ?? after.name) !== undefined && (before?.id ?? before?.name) !== (after.id ?? after.name)) {
    return { id: after.id ?? null, name: after.name, from: { id: before?.id ?? null, name: before?.name } };
  }
  if ((action.type === "createCard" || action.type === "copyCard" || action.type === "moveCardToBoard") && data.list) {
    return { id: data.list.id ?? null, name: data.list.name };
  }
  return null;
}

/** Pure mapping from one fresh read to `SignalFacts` (exported for tests). */
export function buildSignalFacts(input: FactsInput): SignalFacts {
  const listsById = new Map(input.lists.map((list) => [list.id, list]));
  const roleOf = (id: string | null | undefined, name: string | undefined): ListRole =>
    listRoleFor((id ? listsById.get(id)?.name : undefined) ?? name);
  const cardsById = new Map(input.cards.map((card) => [card.id, card]));

  const histories = new Map<string, CardHistory>();
  const lastMovement = new Map<string, number>();
  if (input.history !== null) {
    const ordered = input.history.actions
      .map((action) => ({ action, at: actionDate(action) }))
      .filter((entry): entry is { action: TrelloAction; at: number } => entry.at !== null)
      .sort((a, b) => a.at - b.at);
    for (const { action, at } of ordered) {
      const cardId = action.data?.card?.id;
      if (!cardId) continue;
      const entry = listEntry(action);
      if (!entry) continue;
      const iso = new Date(at).toISOString();
      const history = histories.get(cardId) ?? {};
      history.entered = { listId: entry.id, listName: entry.name, at: iso };
      if (entry.from && roleOf(entry.from.id, entry.from.name) === "done" && roleOf(entry.id, entry.name) !== "done") {
        history.reopenedFromDoneAt = iso;
      }
      histories.set(cardId, history);
      // Project movement: a real list change or a new card, attributed by the card's CURRENT label (#36 rule).
      const card = cardsById.get(cardId);
      const project = card ? projectOf(card) : null;
      if (project !== null) lastMovement.set(project, Math.max(lastMovement.get(project) ?? 0, at));
    }
  }

  const cards: CardFact[] = input.cards
    .filter((card) => card.closed !== true)
    .map((card) => {
      const history = histories.get(card.id);
      const latest = input.latestEntries?.get(card.id);
      const latestEntry = latest ? listEntry(latest) : null;
      const latestAt = latest ? actionDate(latest) : null;
      const entered =
        latestEntry !== null && latestAt !== null
          ? { listId: latestEntry.id, listName: latestEntry.name, at: new Date(latestAt).toISOString() }
          : history?.entered;
      // Only when the latest proven entry is into the card's CURRENT list; otherwise unknown, never guessed.
      const enteredCurrent =
        entered !== undefined && (entered.listId !== null ? entered.listId === card.idList : roleOf(card.idList, undefined) === listRoleFor(entered.listName))
          ? entered.at
          : null;
      return {
        id: card.id,
        name: card.name,
        project: projectOf(card),
        list: roleOf(card.idList, undefined),
        due: typeof card.due === "string" && card.due.length > 0 ? card.due : null,
        dueComplete: card.dueComplete === true,
        enteredListAt: enteredCurrent,
        reopenedFromDoneAt: history?.reopenedFromDoneAt ?? null,
      };
    });

  const projects: ProjectFact[] = [];
  for (const [project, priority] of input.projectPriorities ?? []) {
    const at = lastMovement.get(project);
    projects.push({ project, priority, lastMovementAt: at === undefined || input.history === null ? null : new Date(at).toISOString() });
  }

  return { cards, projects, followUps: [] };
}

/** Board history needed for the stale-project threshold and "reopened this week", plus a day. How long a
 *  card has waited comes from its own latest list entry instead, so it is not bounded by this window. */
export function historyLookbackDays(config: RhythmConfig): number {
  return Math.max(config.thresholds.staleProjectDays, 7) + 1;
}

export interface RhythmFactCollectorOptions {
  reader: RhythmTrelloReader;
  projectPriorities?: ProjectPriorities;
  log?: (line: string) => void;
}

/**
 * The `collectFacts` the scheduler uses. Board, open cards and lists are required: any failure there
 * rejects, and the scheduler then runs rituals without deterministic hints and considers no exception. A
 * failed or truncated history read degrades instead: history-derived fields become null (unknown), which
 * never creates a Waiting/reopened/stale signal on its own.
 */
export function createRhythmFactCollector(options: RhythmFactCollectorOptions): (context: { now: Date; config: RhythmConfig }) => Promise<SignalFacts> {
  const log = options.log ?? (() => {});
  return async ({ now, config }) => {
    const board = await options.reader.resolveSingleBoard();
    const [cards, lists] = await Promise.all([options.reader.readOpenCards(board.id), options.reader.readLists(board.id)]);
    const from = new Date(now.getTime() - historyLookbackDays(config) * 86_400_000);
    let history: FactsInput["history"] = null;
    try {
      history = await options.reader.readActions(board.id, { from, to: now, label: "rhythm" });
      if (history.coverage.truncated) log("[rhythm] history_truncated");
    } catch {
      log("[rhythm] history_unavailable");
    }
    const listsById = new Map(lists.map((list) => [list.id, list]));
    const waiting = cards.filter((card) => card.closed !== true && listRoleFor(listsById.get(card.idList ?? "")?.name) === "waiting");
    if (waiting.length > MAX_WAITING_ENTRY_READS) log("[rhythm] waiting_entries_capped");
    const latestEntries = new Map<string, TrelloAction | null>();
    for (const card of waiting.slice(0, MAX_WAITING_ENTRY_READS)) {
      try {
        latestEntries.set(card.id, await options.reader.readLatestListEntry(card.id));
      } catch {
        log("[rhythm] waiting_entry_unavailable");
      }
    }
    return buildSignalFacts({ cards, lists, history, latestEntries, projectPriorities: options.projectPriorities });
  };
}
