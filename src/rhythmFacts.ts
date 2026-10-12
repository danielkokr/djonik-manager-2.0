import type { RhythmConfig } from "./rhythmConfig.js";
import type { CardFact, ListRole, ProjectFact, SignalFacts } from "./rhythmSignals.js";
import type { HistoryCoverage, HistoryWindow, TrelloAction, TrelloBoardCard, TrelloList, TrelloWorkHistoryError } from "./trelloWorkHistory.js";

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

/** At most this many per-card entry reads for cards currently In progress (#50 focus: when did the stint start). */
export const MAX_IN_PROGRESS_ENTRY_READS = 10;

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
export function listEntry(action: TrelloAction): { id: string | null; name: string | undefined; from?: { id: string | null; name: string | undefined } } | null {
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
        reopenedFromDoneAt:
          latestEntry !== null && latestAt !== null && latestEntry.from &&
          roleOf(latestEntry.from.id, latestEntry.from.name) === "done" &&
          roleOf(latestEntry.id, latestEntry.name) !== "done"
            ? new Date(latestAt).toISOString()
            : history?.reopenedFromDoneAt ?? null,
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

// --- Required fresh reads: failure classes and a small bounded retry (#71) ---------------------------

/** The three reads without which there is no current board state. */
export type FactReadStage = "board" | "open_cards" | "lists";

export type FactFailureReason =
  | "network"
  | "timeout"
  | "rate_limited"
  | "http_5xx"
  | "http_error"
  | "unauthorized"
  | "malformed"
  | "board_config"
  | "unknown";

/** Content-free description of one failed required read: enums and an HTTP status only. */
export interface FactFailure {
  stage: FactReadStage;
  reason: FactFailureReason;
  status?: number;
  /** Whether the same read may succeed a moment later (network, timeout, 429, 5xx). */
  retryable: boolean;
}

class ReadTimeout extends Error {}

/**
 * Sorts a failed read into a retry class. It reads only the structured `code`/`detail` the GET-only client
 * attaches (`TrelloWorkHistoryError`) and never the error's message, so nothing provider-authored can reach a log
 * line. Anything unrecognised is permanent: an unknown failure is not retried blindly.
 */
export function classifyFactFailure(error: unknown): Omit<FactFailure, "stage"> {
  if (error instanceof ReadTimeout) return { reason: "timeout", retryable: true };
  const failure = (typeof error === "object" && error !== null ? error : {}) as Partial<Pick<TrelloWorkHistoryError, "code" | "detail">>;
  const status = typeof failure.detail?.status === "number" ? failure.detail.status : undefined;
  const withStatus = status === undefined ? {} : { status };
  switch (failure.code) {
    case "unauthorized":
      return { reason: "unauthorized", ...withStatus, retryable: false };
    case "malformed":
      return { reason: "malformed", retryable: false };
    case "ambiguous_board":
    case "credentials_missing":
      return { reason: "board_config", retryable: false };
    case "request_failed":
      if (status === 429) return { reason: "rate_limited", status, retryable: true };
      if (status !== undefined && status >= 500) return { reason: "http_5xx", status, retryable: true };
      if (status !== undefined) return { reason: "http_error", status, retryable: false };
      return { reason: failure.detail?.transport === "timeout" ? "timeout" : "network", retryable: true };
    default:
      return { reason: "unknown", retryable: false };
  }
}

/** `stage=open_cards reason=http_5xx status=503 retryable=true` — the whole diagnostic vocabulary. */
export function describeFactFailure(failure: FactFailure): string {
  return `stage=${failure.stage} reason=${failure.reason}${failure.status === undefined ? "" : ` status=${failure.status}`} retryable=${failure.retryable}`;
}

/** The required reads failed after the bounded retry: there is no fresh board state for this tick. */
export class RhythmFactsUnavailableError extends Error {
  constructor(
    readonly failure: FactFailure,
    readonly attempts: number,
  ) {
    super("Fresh Trello board facts are unavailable.");
    this.name = "RhythmFactsUnavailableError";
  }
}

class StageFailure extends Error {
  constructor(readonly failure: FactFailure) {
    super("fact read failed");
  }
}

/** Waits before the 2nd and 3rd attempt of the required reads; after the last one the collection fails. */
export const FACT_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000];
/** Longest wait for one required read, so a hung request cannot hold the scheduler. */
export const FACT_READ_TIMEOUT_MS = 8_000;

function withTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    read,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ReadTimeout()), ms);
      (timer as { unref?: () => void }).unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export interface RhythmFactCollectorOptions {
  reader: RhythmTrelloReader;
  projectPriorities?: ProjectPriorities;
  log?: (line: string) => void;
  /** Backoff between attempts of the required reads (default `FACT_RETRY_DELAYS_MS`); its length + 1 = attempts. */
  retryDelaysMs?: readonly number[];
  /** Per-read timeout (default `FACT_READ_TIMEOUT_MS`). */
  readTimeoutMs?: number;
  /** Injected in tests so the backoff costs no real time. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The `collectFacts` the scheduler uses. Board, open cards and lists are required. A transient failure there
 * (network, timeout, 429, 5xx) is retried a few times with a short backoff, every attempt reading all three anew;
 * a permanent one (401/403, malformed, board/configuration) is not. When they still fail the collection rejects
 * with `RhythmFactsUnavailableError`, and the scheduler then sends no ritual built on stale context and considers
 * no exception (#71). A failed or truncated history read degrades instead: history-derived fields become null
 * (unknown), which never creates a Waiting/reopened/stale signal on its own.
 */
export function createRhythmFactCollector(options: RhythmFactCollectorOptions): (context: { now: Date; config: RhythmConfig }) => Promise<SignalFacts> {
  const log = options.log ?? (() => {});
  const delays = options.retryDelaysMs ?? FACT_RETRY_DELAYS_MS;
  const timeoutMs = options.readTimeoutMs ?? FACT_READ_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const staged = async <T>(stage: FactReadStage, read: () => Promise<T>): Promise<T> => {
    try {
      return await withTimeout(read(), timeoutMs);
    } catch (error) {
      throw new StageFailure({ stage, ...classifyFactFailure(error) });
    }
  };
  const readRequired = async () => {
    const board = await staged("board", () => options.reader.resolveSingleBoard());
    const [cards, lists] = await Promise.all([
      staged("open_cards", () => options.reader.readOpenCards(board.id)),
      staged("lists", () => options.reader.readLists(board.id)),
    ]);
    return { board, cards, lists };
  };
  const readRequiredWithRetry = async () => {
    const attempts = delays.length + 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await readRequired();
      } catch (error) {
        const failure: FactFailure = error instanceof StageFailure ? error.failure : { stage: "board", ...classifyFactFailure(error) };
        log(`[rhythm] trello_facts_failed ${describeFactFailure(failure)} attempt=${attempt}/${attempts}`);
        if (!failure.retryable || attempt >= attempts) throw new RhythmFactsUnavailableError(failure, attempt);
        await sleep(delays[attempt - 1]);
      }
    }
  };
  return async ({ now, config }) => {
    const { board, cards, lists } = await readRequiredWithRetry();
    const from = new Date(now.getTime() - historyLookbackDays(config) * 86_400_000);
    let history: FactsInput["history"] = null;
    try {
      history = await options.reader.readActions(board.id, { from, to: now, label: "rhythm" });
      if (history.coverage.truncated) log("[rhythm] history_truncated");
    } catch {
      log("[rhythm] history_unavailable");
    }
    const listsById = new Map(lists.map((list) => [list.id, list]));
    const inRole = (role: ListRole) => cards.filter((card) => card.closed !== true && listRoleFor(listsById.get(card.idList ?? "")?.name) === role);
    const waiting = inRole("waiting");
    if (waiting.length > MAX_WAITING_ENTRY_READS) log("[rhythm] waiting_entries_capped");
    // #50: an In-progress stint's start is its latest authoritative list entry, however old (focus is code-owned).
    const inProgress = inRole("in_progress");
    if (inProgress.length > MAX_IN_PROGRESS_ENTRY_READS) log("[rhythm] in_progress_entries_capped");
    const latestEntries = new Map<string, TrelloAction | null>();
    for (const [card, label] of [
      ...waiting.slice(0, MAX_WAITING_ENTRY_READS).map((card) => [card, "waiting"] as const),
      ...inProgress.slice(0, MAX_IN_PROGRESS_ENTRY_READS).map((card) => [card, "in_progress"] as const),
    ]) {
      try {
        latestEntries.set(card.id, await options.reader.readLatestListEntry(card.id));
      } catch {
        log(`[rhythm] ${label}_entry_unavailable`);
      }
    }
    return buildSignalFacts({ cards, lists, history, latestEntries, projectPriorities: options.projectPriorities });
  };
}
