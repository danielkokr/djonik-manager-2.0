/**
 * Read-only Trello action-history digest for #36.  This module deliberately
 * owns data selection, week arithmetic, counts and Kyiv rendering; Claude only
 * receives its compact result and narrates it.
 */

export const KYIV_TIME_ZONE = "Europe/Kyiv";
const PAGE_LIMIT = 1000;
const MAX_ACTION_PAGES = 20;

export type WorkHistoryWindowInput =
  | { kind: "this_week" }
  | { kind: "last_week" }
  /** Date-only values are Kyiv calendar dates; `to` is exclusive. RFC3339 instants are also accepted. */
  | { kind: "explicit"; from: string; to: string };

export type WorkHistoryScope = { kind: "board" } | { kind: "project"; label: string };
export type WorkHistoryFormat = "concise" | "detailed";

export interface TrelloWorkHistoryInput {
  window: WorkHistoryWindowInput;
  scope: WorkHistoryScope;
  response_format?: WorkHistoryFormat;
}

export interface HistoryWindow {
  from: Date;
  to: Date;
  label: string;
}

export interface TrelloAction {
  id?: string;
  type?: string;
  date?: string;
  data?: {
    card?: { id?: string; name?: string; closed?: boolean };
    listBefore?: { id?: string; name?: string };
    listAfter?: { id?: string; name?: string };
    old?: { idList?: string; closed?: boolean };
  };
}

export interface TrelloHistoryCard {
  id: string;
  name: string;
  idList?: string;
  closed?: boolean;
  due?: string | null;
  labels?: Array<{ name?: string }>;
}

export interface TrelloList {
  id: string;
  name: string;
}

export interface HistoryCoverage {
  pagesRead: number;
  truncated: boolean;
  oldestActionReached: boolean;
}

export interface WorkHistoryItem {
  card: string;
  at?: string;
  transition?: string;
  occurrences?: number;
  due?: string;
}

export interface WorkHistoryDigest {
  window: { from: string; to: string; label: string };
  scope: { kind: "board" } | { kind: "project"; label: string };
  coverage: HistoryCoverage;
  counts: { reached_done: number; returned_from_done: number; created: number; archived: number; moved: number };
  reached_done?: WorkHistoryItem[];
  returned_from_done?: WorkHistoryItem[];
  created?: WorkHistoryItem[];
  archived?: WorkHistoryItem[];
  moved?: WorkHistoryItem[];
}

export const TRELLO_WORK_HISTORY_TOOL = {
  type: "custom" as const,
  name: "trello_work_history",
  description:
    "Read a compact, read-only Trello board-action digest for a requested week or explicit Kyiv date range. Use it for questions about what moved into Done, returned from Done, was created, archived, or changed during a period. It computes Kyiv dates, counts, current-label project scope, and coverage itself; do not use it for current Project Health, writes, effort, or work outside Trello.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["window", "scope"],
    properties: {
      window: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "this_week" } } },
          { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "last_week" } } },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "from", "to"],
            properties: { kind: { const: "explicit" }, from: { type: "string" }, to: { type: "string" } },
          },
        ],
      },
      scope: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "board" } } },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "label"],
            properties: { kind: { const: "project" }, label: { type: "string", minLength: 1, maxLength: 120 } },
          },
        ],
      },
      response_format: { enum: ["concise", "detailed"] },
    },
  },
};

function partsAt(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: KYIV_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/** Converts a non-ambiguous Kyiv local calendar time into an instant without hard-coded offsets. */
function kyivLocalToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(wanted);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const p = partsAt(candidate);
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const corrected = new Date(candidate.getTime() + (wanted - represented));
    if (corrected.getTime() === candidate.getTime()) return corrected;
    candidate = corrected;
  }
  return candidate;
}

function kyivCalendarStart(date: Date): Date {
  const p = partsAt(date);
  return kyivLocalToUtc(Number(p.year), Number(p.month), Number(p.day));
}

function addKyivDays(start: Date, days: number): Date {
  const p = partsAt(start);
  const calendar = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + days));
  return kyivLocalToUtc(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate());
}

const UK_WEEKDAY: Record<string, number> = { "пн": 0, "вт": 1, "ср": 2, "чт": 3, "пт": 4, "сб": 5, "нд": 6 };

function kyivWeekdayIndex(date: Date): number {
  const weekday = new Intl.DateTimeFormat("uk-UA", { timeZone: KYIV_TIME_ZONE, weekday: "short" }).format(date).replace(".", "").toLowerCase();
  const matched = Object.keys(UK_WEEKDAY).find((key) => weekday.startsWith(key));
  if (matched === undefined) throw new Error("Could not resolve Kyiv weekday.");
  return UK_WEEKDAY[matched];
}

function parseExplicitBoundary(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return kyivLocalToUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Explicit history dates must be YYYY-MM-DD or RFC3339 instants.");
  return parsed;
}

/** Monday 00:00 Europe/Kyiv, including across Ukraine's DST transitions. */
export function resolveHistoryWindow(input: WorkHistoryWindowInput, now = new Date()): HistoryWindow {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid current time.");
  if (input.kind === "explicit") {
    const from = parseExplicitBoundary(input.from);
    const to = parseExplicitBoundary(input.to);
    if (to.getTime() <= from.getTime()) throw new Error("History window `to` must be after `from`.");
    return { from, to, label: `${formatKyivDateTime(from)} – ${formatKyivDateTime(to)}` };
  }
  const today = kyivCalendarStart(now);
  const monday = addKyivDays(today, -kyivWeekdayIndex(now));
  const from = input.kind === "this_week" ? monday : addKyivDays(monday, -7);
  const to = input.kind === "this_week" ? now : monday;
  return { from, to, label: input.kind === "this_week" ? "Цей тиждень" : "Минулий тиждень" };
}

/** Stable, code-owned human format used for both action and due instants. */
export function formatKyivDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp from Trello.");
  const p = partsAt(date);
  const weekday = new Intl.DateTimeFormat("uk-UA", { timeZone: KYIV_TIME_ZONE, weekday: "short" }).format(date).replace(".", "");
  return `${weekday} ${p.day}.${p.month}, ${p.hour}:${p.minute}`;
}

function validActionDate(action: TrelloAction): Date | null {
  if (!action.date) return null;
  const date = new Date(action.date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDone(name: string | undefined): boolean {
  return name?.trim().toLocaleLowerCase("uk-UA") === "done";
}

function limitItems(items: WorkHistoryItem[], format: WorkHistoryFormat): WorkHistoryItem[] | undefined {
  if (items.length === 0) return undefined;
  return format === "concise" ? items.slice(0, 5) : items;
}

interface CardFacts {
  card: TrelloHistoryCard | undefined;
  name: string;
  firstList?: string;
  lastList?: string;
  lastMoveAt?: Date;
  reachedDone: Date[];
  returnedFromDone: Date[];
  created?: Date;
  archived?: Date;
}

function itemFor(facts: CardFacts, date: Date | undefined, occurrences?: number): WorkHistoryItem {
  const item: WorkHistoryItem = { card: facts.name };
  if (date) item.at = formatKyivDateTime(date);
  if (facts.firstList && facts.lastList) item.transition = `${facts.firstList} → ${facts.lastList}`;
  if (occurrences && occurrences > 1) item.occurrences = occurrences;
  if (facts.card?.due) item.due = formatKyivDateTime(facts.card.due);
  return item;
}

/** Collapses raw action history into one net movement per card while retaining reopen/re-Done evidence. */
export function buildWorkHistoryDigest(
  input: TrelloWorkHistoryInput,
  actions: readonly TrelloAction[],
  cards: readonly TrelloHistoryCard[],
  coverage: HistoryCoverage,
  now = new Date(),
): WorkHistoryDigest {
  const window = resolveHistoryWindow(input.window, now);
  const format = input.response_format ?? "concise";
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const projectLabel = input.scope.kind === "project" ? input.scope.label : null;
  const allowed = (card: TrelloHistoryCard | undefined): boolean =>
    projectLabel === null || Boolean(card?.labels?.some((label) => label.name?.trim() === projectLabel));
  const factsByCard = new Map<string, CardFacts>();
  const sorted = [...actions]
    .map((action) => ({ action, date: validActionDate(action) }))
    .filter((entry): entry is { action: TrelloAction; date: Date } => entry.date !== null)
    .filter((entry) => entry.date.getTime() >= window.from.getTime() && entry.date.getTime() < window.to.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const { action, date } of sorted) {
    const id = action.data?.card?.id;
    if (!id) continue;
    const card = cardsById.get(id);
    if (!allowed(card)) continue; // project membership is intentionally the card's CURRENT label.
    let facts = factsByCard.get(id);
    if (!facts) {
      facts = { card, name: card?.name ?? action.data?.card?.name ?? "Картка без назви", reachedDone: [], returnedFromDone: [] };
      factsByCard.set(id, facts);
    }
    if (action.type === "createCard") facts.created ??= date;
    const before = action.data?.listBefore?.name;
    const after = action.data?.listAfter?.name;
    if (before && after && before !== after) {
      facts.firstList ??= before;
      facts.lastList = after;
      facts.lastMoveAt = date;
      if (!isDone(before) && isDone(after)) facts.reachedDone.push(date);
      if (isDone(before) && !isDone(after)) facts.returnedFromDone.push(date);
    }
    if (action.type === "updateCard" && action.data?.old?.closed === false && action.data.card?.closed === true) facts.archived ??= date;
  }

  const visible = [...factsByCard.values()].filter((facts) => !(facts.created && facts.archived));
  const reachedDone = visible.filter((facts) => facts.reachedDone.length > 0).map((facts) => itemFor(facts, facts.reachedDone.at(-1), facts.reachedDone.length));
  const returnedFromDone = visible
    .filter((facts) => facts.returnedFromDone.length > 0)
    .map((facts) => itemFor(facts, facts.returnedFromDone.at(-1), facts.returnedFromDone.length));
  const created = visible.filter((facts) => facts.created).map((facts) => itemFor(facts, facts.created));
  const archived = visible.filter((facts) => facts.archived).map((facts) => itemFor(facts, facts.archived));
  const moved = visible
    .filter((facts) => facts.firstList && facts.lastList && facts.reachedDone.length === 0 && facts.returnedFromDone.length === 0)
    .map((facts) => itemFor(facts, facts.lastMoveAt));

  const digest: WorkHistoryDigest = {
    window: { from: formatKyivDateTime(window.from), to: formatKyivDateTime(window.to), label: window.label },
    scope: input.scope.kind === "board" ? { kind: "board" } : { kind: "project", label: input.scope.label },
    coverage,
    counts: {
      reached_done: reachedDone.reduce((count, item) => count + (item.occurrences ?? 1), 0),
      returned_from_done: returnedFromDone.reduce((count, item) => count + (item.occurrences ?? 1), 0),
      created: created.length,
      archived: archived.length,
      moved: moved.length,
    },
  };
  const sections: Array<[keyof Pick<WorkHistoryDigest, "reached_done" | "returned_from_done" | "created" | "archived" | "moved">, WorkHistoryItem[]]> = [
    ["reached_done", reachedDone], ["returned_from_done", returnedFromDone], ["created", created], ["archived", archived], ["moved", moved],
  ];
  for (const [key, items] of sections) {
    const limited = limitItems(items, format);
    if (limited) digest[key] = limited;
  }
  return digest;
}

export class TrelloWorkHistoryError extends Error {
  constructor(public readonly code: "credentials_missing" | "unauthorized" | "request_failed" | "malformed" | "ambiguous_board" | "project_not_found") {
    super(
      code === "credentials_missing"
        ? "Trello history is unavailable because read-only credentials are not configured."
        : code === "unauthorized"
          ? "Trello history is unavailable because the read-only credentials were rejected."
          : code === "ambiguous_board"
            ? "Trello history is unavailable because the board cannot be resolved unambiguously."
            : code === "project_not_found"
              ? "Trello history is unavailable because the project label was not found on the board."
              : "Trello history is temporarily unavailable.",
    );
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TrelloWorkHistoryClientOptions {
  apiKey?: string;
  readToken?: string;
  fetch?: FetchLike;
  maxPages?: number;
}

/** Minimal GET-only executor. Credentials stay only in the Authorization header and never enter errors. */
export class TrelloWorkHistoryClient {
  private readonly fetcher: FetchLike;
  private readonly maxPages: number;
  private readonly authorization: string;

  constructor(options: TrelloWorkHistoryClientOptions = {}) {
    const apiKey = options.apiKey?.trim();
    const readToken = options.readToken?.trim();
    if (!apiKey || !readToken) throw new TrelloWorkHistoryError("credentials_missing");
    this.fetcher = options.fetch ?? fetch;
    this.maxPages = options.maxPages ?? MAX_ACTION_PAGES;
    // Trello's accepted OAuth header form; never serialise either credential in a URL or error.
    this.authorization = `OAuth oauth_consumer_key="${apiKey.replaceAll('"', "")}", oauth_token="${readToken.replaceAll('"', "")}"`;
  }

  private async getJson(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`https://api.trello.com/1${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), { method: "GET", headers: { Authorization: this.authorization, Accept: "application/json" } });
    } catch {
      throw new TrelloWorkHistoryError("request_failed");
    }
    if (response.status === 401 || response.status === 403) throw new TrelloWorkHistoryError("unauthorized");
    if (!response.ok) throw new TrelloWorkHistoryError("request_failed");
    try {
      return await response.json();
    } catch {
      throw new TrelloWorkHistoryError("malformed");
    }
  }

  async resolveSingleBoard(): Promise<{ id: string; name: string }> {
    const value = await this.getJson("/members/me/boards", { filter: "all", fields: "id,name" });
    if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0]) || typeof value[0].id !== "string" || typeof value[0].name !== "string") {
      throw new TrelloWorkHistoryError("ambiguous_board");
    }
    return { id: value[0].id, name: value[0].name };
  }

  async readCards(boardId: string): Promise<TrelloHistoryCard[]> {
    const value = await this.getJson(`/boards/${encodeURIComponent(boardId)}/cards/all`, { fields: "id,name,idList,closed,due,labels" });
    if (!Array.isArray(value) || value.some((card) => !isRecord(card) || typeof card.id !== "string" || typeof card.name !== "string")) {
      throw new TrelloWorkHistoryError("malformed");
    }
    return value as TrelloHistoryCard[];
  }

  async readActions(boardId: string, window: HistoryWindow): Promise<{ actions: TrelloAction[]; coverage: HistoryCoverage }> {
    const actions: TrelloAction[] = [];
    let before = window.to.toISOString();
    let pagesRead = 0;
    let oldestActionReached = false;
    let truncated = false;
    const seen = new Set<string>();
    for (let page = 0; page < this.maxPages; page += 1) {
      const value = await this.getJson(`/boards/${encodeURIComponent(boardId)}/actions`, {
        filter: "createCard,updateCard,deleteCard,copyCard,moveCardToBoard,moveCardFromBoard",
        since: window.from.toISOString(),
        before,
        limit: String(PAGE_LIMIT),
      });
      if (!Array.isArray(value) || value.some((action) => !isRecord(action))) throw new TrelloWorkHistoryError("malformed");
      if (value.length === 0) {
        oldestActionReached = true;
        break;
      }
      pagesRead += 1;
      const pageActions = value as TrelloAction[];
      for (const action of pageActions) {
        const key = typeof action.id === "string" ? action.id : `${action.date ?? ""}:${JSON.stringify(action.data ?? {})}`;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push(action);
        }
      }
      if (pageActions.length < PAGE_LIMIT) {
        oldestActionReached = true;
        break;
      }
      const oldest = pageActions.at(-1)?.date;
      if (!oldest || oldest >= before) {
        truncated = true;
        break;
      }
      before = oldest;
      if (page === this.maxPages - 1) truncated = true;
    }
    return { actions, coverage: { pagesRead, truncated, oldestActionReached } };
  }

  async execute(input: TrelloWorkHistoryInput, now = new Date()): Promise<WorkHistoryDigest> {
    const window = resolveHistoryWindow(input.window, now);
    const board = await this.resolveSingleBoard();
    const cards = await this.readCards(board.id);
    const projectLabel = input.scope.kind === "project" ? input.scope.label : null;
    if (projectLabel !== null && !cards.some((card) => card.labels?.some((label) => label.name?.trim() === projectLabel))) {
      throw new TrelloWorkHistoryError("project_not_found");
    }
    const { actions, coverage } = await this.readActions(board.id, window);
    return buildWorkHistoryDigest(input, actions, cards, coverage, now);
  }
}

export interface CustomToolExecutionResult { isError: boolean; content: string }

/** Safe boundary for the Session client: neither credentials nor raw Trello errors cross it. */
export async function executeTrelloWorkHistoryFromEnvironment(input: unknown): Promise<CustomToolExecutionResult> {
  try {
    const request = parseTrelloWorkHistoryInput(input);
    const client = new TrelloWorkHistoryClient({ apiKey: process.env.TRELLO_API_KEY, readToken: process.env.TRELLO_READ_TOKEN });
    return { isError: false, content: JSON.stringify(await client.execute(request)) };
  } catch (error) {
    const message = error instanceof TrelloWorkHistoryError ? error.message : "Trello history request is unavailable because its input was invalid.";
    return { isError: true, content: JSON.stringify({ error: { message } }) };
  }
}

export function parseTrelloWorkHistoryInput(value: unknown): TrelloWorkHistoryInput {
  if (!isRecord(value) || !isRecord(value.window) || !isRecord(value.scope)) throw new Error("Invalid tool input.");
  const kind = value.window.kind;
  let window: WorkHistoryWindowInput;
  if (kind === "this_week" || kind === "last_week") window = { kind };
  else if (kind === "explicit" && typeof value.window.from === "string" && typeof value.window.to === "string") window = { kind, from: value.window.from, to: value.window.to };
  else throw new Error("Invalid tool input.");
  const scope = value.scope.kind === "board" ? { kind: "board" as const } : value.scope.kind === "project" && typeof value.scope.label === "string" && value.scope.label.trim() ? { kind: "project" as const, label: value.scope.label.trim() } : null;
  if (!scope) throw new Error("Invalid tool input.");
  const response_format = value.response_format === undefined ? undefined : value.response_format === "concise" || value.response_format === "detailed" ? value.response_format : null;
  if (response_format === null) throw new Error("Invalid tool input.");
  return { window, scope, ...(response_format ? { response_format } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
