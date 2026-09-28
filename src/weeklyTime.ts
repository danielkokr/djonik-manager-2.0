import { formatLocalTime, type RhythmConfig } from "./rhythmConfig.js";
import { listRoleFor } from "./rhythmFacts.js";
import type { ListRole } from "./rhythmSignals.js";
import {
  resolveHistoryWindow,
  type HistoryCoverage,
  type HistoryWindow,
  type TrelloAction,
  type TrelloHistoryCard,
  type TrelloList,
} from "./trelloWorkHistory.js";
import { workingWindows } from "./workingTime.js";

/**
 * Weekly time per project (#50): a deterministic, approximate report computed by code from the SAME Trello action
 * log `trello_work_history` reads (`TrelloWorkHistoryClient.readActions`, GET-only, read token). Nothing is stored:
 * every report is recomputed from Trello. This is not billing-grade tracking and not a productivity measure — it
 * shows how long cards sat in In progress inside Daniel's configured working hours.
 *
 * Algorithm (docs/87 §12–§13):
 * 1. Each card's In-progress intervals in the window are reconstructed by reverse replay: start from the card's
 *    current state (list, archived), undo every in-window list move / archive / creation / deletion newest-first to
 *    get its state at the window start, then replay forward. No `lastActivityAt`, no model input.
 * 2. Intervals are clipped to the `work_hours` window of each configured workday (Europe/Kyiv, DST-correct).
 * 3. Within a day, every elementary segment is split equally between the cards In progress during it.
 * 4. If a day's counted time (the union of In-progress time) exceeds `daily_time_cap`, every card's share of that
 *    day is scaled down by the same factor (proportional cap), and the report says how many days were capped.
 * 5. Shares are summed per project label (current label, as in #36); none → «без проєкту», several → «кілька міток».
 */

export const UNLABELLED_PROJECT = "без проєкту";
export const MULTI_LABEL_PROJECT = "кілька міток";
/** Share of counted time with ≥ 2 cards In progress at which the report calls its numbers rough. */
export const ROUGH_PARALLEL_SHARE = 0.25;
export const TIME_REPORT_LABEL = "≈ за переміщеннями в Trello";

export interface InProgressInterval {
  cardId: string;
  project: string;
  /** Epoch ms, `start < end`, inside the window. */
  start: number;
  end: number;
}

export function projectLabelOf(card: Pick<TrelloHistoryCard, "labels"> | undefined): string {
  if (!card) return UNLABELLED_PROJECT;
  const names = (card.labels ?? []).map((label) => label.name?.trim() ?? "").filter((name) => name.length > 0);
  if (names.length === 0) return UNLABELLED_PROJECT;
  return names.length === 1 ? names[0] : MULTI_LABEL_PROJECT;
}

interface ListRef {
  id: string | null;
  name: string | undefined;
}

interface CardState {
  exists: boolean;
  list: ListRef | null;
  closed: boolean;
}

type CardEvent =
  | { at: number; kind: "list"; before: ListRef; after: ListRef }
  | { at: number; kind: "closed"; before: boolean; after: boolean }
  | { at: number; kind: "appear"; list: ListRef }
  | { at: number; kind: "disappear"; list: ListRef | null };

function refOf(value: { id?: string; name?: string } | undefined): ListRef | null {
  if (!value || (value.id === undefined && value.name === undefined)) return null;
  return { id: value.id ?? null, name: value.name };
}

function eventOf(action: TrelloAction, at: number): CardEvent | null {
  const data = action.data;
  if (!data) return null;
  if (action.type === "updateCard") {
    const before = refOf(data.listBefore);
    const after = refOf(data.listAfter);
    if (before && after && (before.id ?? before.name) !== (after.id ?? after.name)) return { at, kind: "list", before, after };
    if (typeof data.old?.closed === "boolean" && typeof data.card?.closed === "boolean" && data.old.closed !== data.card.closed) {
      return { at, kind: "closed", before: data.old.closed, after: data.card.closed };
    }
    return null;
  }
  if (action.type === "createCard" || action.type === "copyCard" || action.type === "moveCardToBoard") {
    const list = refOf(data.list);
    return list ? { at, kind: "appear", list } : null;
  }
  if (action.type === "deleteCard" || action.type === "moveCardFromBoard") return { at, kind: "disappear", list: refOf(data.list) };
  return null;
}

/**
 * Reconstructs every card's In-progress intervals inside `window` (exported for tests). Actions outside the window,
 * without a card id or a valid date are ignored; a card with no in-window action keeps its current state throughout.
 */
export function inProgressIntervals(input: {
  cards: readonly TrelloHistoryCard[];
  lists: readonly TrelloList[];
  actions: readonly TrelloAction[];
  window: Pick<HistoryWindow, "from" | "to">;
}): InProgressInterval[] {
  const from = input.window.from.getTime();
  const to = input.window.to.getTime();
  const listNames = new Map(input.lists.map((list) => [list.id, list.name]));
  const roleOf = (ref: ListRef | null): ListRole => (ref === null ? "other" : listRoleFor((ref.id ? listNames.get(ref.id) : undefined) ?? ref.name));
  const cards = new Map(input.cards.map((card) => [card.id, card]));

  const events = new Map<string, CardEvent[]>();
  for (const action of input.actions) {
    const cardId = action.data?.card?.id;
    const at = action.date ? Date.parse(action.date) : Number.NaN;
    if (!cardId || Number.isNaN(at) || at < from || at >= to) continue;
    const event = eventOf(action, at);
    if (event) events.set(cardId, [...(events.get(cardId) ?? []), event]);
  }

  const intervals: InProgressInterval[] = [];
  for (const cardId of new Set([...cards.keys(), ...events.keys()])) {
    const card = cards.get(cardId);
    // Ascending by time; Trello lists actions newest first, so equal timestamps take the reverse of their read order.
    const own = (events.get(cardId) ?? [])
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.at - b.event.at || b.index - a.index)
      .map(({ event }) => event);
    // Current state, then undo newest-first → the state at the window start.
    let state: CardState = card
      ? { exists: true, list: card.idList ? { id: card.idList, name: undefined } : null, closed: card.closed === true }
      : { exists: false, list: null, closed: false };
    for (const event of [...own].reverse()) {
      if (event.kind === "list") state = { ...state, list: event.before };
      else if (event.kind === "closed") state = { ...state, closed: event.before };
      else if (event.kind === "appear") state = { ...state, exists: false };
      else state = { exists: true, list: event.list ?? state.list, closed: false };
    }
    const inProgress = (value: CardState) => value.exists && !value.closed && roleOf(value.list) === "in_progress";
    const project = projectLabelOf(card);
    let openedAt: number | null = inProgress(state) ? from : null;
    for (const event of own) {
      if (event.kind === "list") state = { ...state, list: event.after };
      else if (event.kind === "closed") state = { ...state, closed: event.after };
      else if (event.kind === "appear") state = { exists: true, list: event.list, closed: false };
      else state = { ...state, exists: false };
      const active = inProgress(state);
      if (active && openedAt === null) openedAt = event.at;
      if (!active && openedAt !== null) {
        if (event.at > openedAt) intervals.push({ cardId, project, start: openedAt, end: event.at });
        openedAt = null;
      }
    }
    // An interval still open at the cutoff (the report time) closes there.
    if (openedAt !== null && to > openedAt) intervals.push({ cardId, project, start: openedAt, end: to });
  }
  return intervals.sort((a, b) => a.start - b.start || a.cardId.localeCompare(b.cardId));
}

export interface ProjectTime {
  project: string;
  ms: number;
}

export interface WeeklyTimeAllocation {
  /** Per project, largest first; the unlabelled buckets last. */
  totals: ProjectTime[];
  /** Counted time after the daily cap. */
  countedMs: number;
  /** Working time with at least one card In progress, before the cap. */
  unionMs: number;
  /** Working time with two or more cards In progress at once. */
  parallelMs: number;
  /** Days whose counted time was scaled down to the cap. */
  cappedDays: number;
  rough: boolean;
}

/** Equal split per elementary segment, per-day proportional cap, per-project sums. Pure (exported for tests). */
export function allocateWeeklyTime(
  intervals: readonly InProgressInterval[],
  window: Pick<HistoryWindow, "from" | "to">,
  config: Pick<RhythmConfig, "workHours" | "workdays" | "dailyTimeCapMinutes">,
): WeeklyTimeAllocation {
  const capMs = config.dailyTimeCapMinutes * 60_000;
  const byProject = new Map<string, number>();
  let countedMs = 0;
  let unionMs = 0;
  let parallelMs = 0;
  let cappedDays = 0;
  for (const day of workingWindows(window.from, window.to, config)) {
    const inside = intervals.filter((interval) => interval.start < day.end && interval.end > day.start);
    if (inside.length === 0) continue;
    const points = [...new Set([day.start, day.end, ...inside.flatMap((interval) => [interval.start, interval.end])])]
      .filter((point) => point >= day.start && point <= day.end)
      .sort((a, b) => a - b);
    const share = new Map<InProgressInterval, number>();
    let dayUnion = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const active = inside.filter((interval) => interval.start <= a && interval.end >= b);
      if (active.length === 0) continue;
      dayUnion += b - a;
      if (active.length >= 2) parallelMs += b - a;
      for (const interval of active) share.set(interval, (share.get(interval) ?? 0) + (b - a) / active.length);
    }
    unionMs += dayUnion;
    const factor = dayUnion > capMs ? capMs / dayUnion : 1;
    if (factor < 1) cappedDays += 1;
    for (const [interval, ms] of share) byProject.set(interval.project, (byProject.get(interval.project) ?? 0) + ms * factor);
    countedMs += dayUnion * factor;
  }
  const bucketLast = (project: string) => (project === UNLABELLED_PROJECT || project === MULTI_LABEL_PROJECT ? 1 : 0);
  const totals = [...byProject.entries()]
    .map(([project, ms]) => ({ project, ms }))
    .filter((entry) => entry.ms > 0)
    .sort((a, b) => bucketLast(a.project) - bucketLast(b.project) || b.ms - a.ms || a.project.localeCompare(b.project, "uk"));
  return { totals, countedMs, unionMs, parallelMs, cappedDays, rough: unionMs > 0 && parallelMs / unionMs >= ROUGH_PARALLEL_SHARE };
}

/** Rounded to half an hour, Ukrainian decimal comma: `14 год`, `7,5 год`, `< 0,5 год`. */
export function formatReportHours(ms: number): string {
  const halfHours = Math.round(ms / 1_800_000);
  if (halfHours === 0) return "< 0,5 год";
  return `${String(halfHours / 2).replace(".", ",")} год`;
}

function daysWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "дні";
  return "днів";
}

/** The deterministic Friday block. Claude never recomputes or rewrites it (#36 exact-relay principle). */
export function renderWeeklyTimeBlock(allocation: WeeklyTimeAllocation, config: Pick<RhythmConfig, "workHours" | "dailyTimeCapMinutes">): string {
  const hours = config.workHours ? ` (робочі години ${formatLocalTime(config.workHours.start)}–${formatLocalTime(config.workHours.end)})` : "";
  if (allocation.totals.length === 0) return `⏱ Час по проєктах ${TIME_REPORT_LABEL}${hours}: цього тижня в робочі години в In progress нічого не було.`;
  const lines = [`⏱ Час по проєктах ${TIME_REPORT_LABEL}${hours}:`, ...allocation.totals.map((entry) => `${entry.project} — ${formatReportHours(entry.ms)}`)];
  if (allocation.rough) lines.push("Часто в In progress було кілька карток одночасно — такий час поділено порівну, тож цифри грубі.");
  if (allocation.cappedDays > 0) {
    lines.push(
      `Ліміт ${formatReportHours(config.dailyTimeCapMinutes * 60_000)} на день урізав ${allocation.cappedDays} ${daysWord(allocation.cappedDays)}: ` +
        "у такі дні час кожного проєкту зменшено пропорційно.",
    );
  }
  return lines.join("\n");
}

export type WeeklyTimeUnavailableReason = "work_hours_missing" | "history_incomplete" | "history_unavailable";

const UNAVAILABLE_TEXT: Record<WeeklyTimeUnavailableReason, string> = {
  work_hours_missing: "не задані робочі години (work_hours у /rhythm.md)",
  history_incomplete: "історію Trello за тиждень не вдалося прочитати повністю",
  history_unavailable: "історія Trello зараз недоступна",
};

export function renderWeeklyTimeUnavailable(reason: WeeklyTimeUnavailableReason): string {
  return `⏱ Час по проєктах: недоступний — ${UNAVAILABLE_TEXT[reason]}. Годин не оцінюю.`;
}

export type WeeklyTimeOutcome =
  | { status: "ok"; block: string; allocation: WeeklyTimeAllocation }
  | { status: "unavailable"; block: string; reason: WeeklyTimeUnavailableReason };

export function weeklyTimeUnavailable(reason: WeeklyTimeUnavailableReason): WeeklyTimeOutcome {
  return { status: "unavailable", reason, block: renderWeeklyTimeUnavailable(reason) };
}

/** One report from one fresh read (pure; exported for tests). Incomplete history is unavailable, never partial. */
export function computeWeeklyTime(input: {
  cards: readonly TrelloHistoryCard[];
  lists: readonly TrelloList[];
  actions: readonly TrelloAction[];
  coverage: HistoryCoverage;
  window: Pick<HistoryWindow, "from" | "to">;
  config: Pick<RhythmConfig, "workHours" | "workdays" | "dailyTimeCapMinutes">;
}): WeeklyTimeOutcome {
  if (input.config.workHours === null) return weeklyTimeUnavailable("work_hours_missing");
  if (input.coverage.truncated || !input.coverage.oldestActionReached) return weeklyTimeUnavailable("history_incomplete");
  const allocation = allocateWeeklyTime(inProgressIntervals(input), input.window, input.config);
  return { status: "ok", block: renderWeeklyTimeBlock(allocation, input.config), allocation };
}

/** The GET-only subset of `TrelloWorkHistoryClient` the report uses — the same client and action log as #36. */
export interface WeeklyTimeReader {
  resolveSingleBoard(): Promise<{ id: string; name: string }>;
  readCards(boardId: string): Promise<TrelloHistoryCard[]>;
  readLists(boardId: string): Promise<TrelloList[]>;
  readActions(boardId: string, window: HistoryWindow): Promise<{ actions: TrelloAction[]; coverage: HistoryCoverage }>;
}

export type WeeklyTimeReporter = (context: { now: Date; config: RhythmConfig }) => Promise<WeeklyTimeOutcome>;

/** This week (Monday 00:00 Kyiv → now), freshly read. Any read failure is `history_unavailable`, never a guess. */
export function createWeeklyTimeReporter(options: { reader: WeeklyTimeReader; log?: (line: string) => void }): WeeklyTimeReporter {
  const log = options.log ?? (() => {});
  return async ({ now, config }) => {
    // No working hours → nothing to count against; no Trello read at all.
    if (config.workHours === null) return weeklyTimeUnavailable("work_hours_missing");
    let outcome: WeeklyTimeOutcome;
    try {
      const window = resolveHistoryWindow({ kind: "this_week" }, now);
      const board = await options.reader.resolveSingleBoard();
      const [cards, lists] = await Promise.all([options.reader.readCards(board.id), options.reader.readLists(board.id)]);
      const { actions, coverage } = await options.reader.readActions(board.id, { ...window, label: "weekly-time" });
      outcome = computeWeeklyTime({ cards, lists, actions, coverage, window, config });
    } catch {
      outcome = weeklyTimeUnavailable("history_unavailable");
    }
    log(`[rhythm] weekly_time ${outcome.status}${outcome.status === "unavailable" ? ` reason=${outcome.reason}` : ""}`);
    return outcome;
  };
}

/**
 * Places the code-owned time block in the Friday review (exact relay): right after the verified #36 work-history
 * block when the reply starts with it, otherwise first. Claude's own text always follows; nothing is rewritten.
 */
export function composeWeeklyTimeReply(reply: string, workHistoryAnswerText: string | null | undefined, block: string): string {
  if (workHistoryAnswerText && reply.startsWith(workHistoryAnswerText)) {
    return `${workHistoryAnswerText}\n\n${block}${reply.slice(workHistoryAnswerText.length)}`;
  }
  return reply.trim().length === 0 ? block : `${block}\n\n${reply}`;
}
