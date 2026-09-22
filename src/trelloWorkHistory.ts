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
  /** Number of same-kind events represented by this card when it is greater than one. */
  occurrences?: number;
  due?: string;
}

/**
 * Internal-only intermediate shape, kept for tests/debugging (docs/28 #36 fact-skeleton
 * remediation). `total` is authoritative and `items` are named representatives, but this
 * shape is deliberately NOT sent to the model: two live candidates rewrote `total` into a
 * different number by treating `items.length` as the total. The model-facing contract is
 * `WorkHistoryFactSkeleton.fact_lines`, which renders every quantitative claim as text.
 */
export interface WorkHistoryCategory {
  total: number;
  total_kind: "event_occurrences" | "cards";
  shown: number;
  omitted: number;
  items: WorkHistoryItem[];
}

export interface WorkHistoryCategories {
  reached_done?: WorkHistoryCategory;
  returned_from_done?: WorkHistoryCategory;
  created?: WorkHistoryCategory;
  archived?: WorkHistoryCategory;
  moved?: WorkHistoryCategory;
}

/**
 * The model-facing #36 contract (docs/29 remediation). `answer_text` is already the complete,
 * ready-to-send Ukrainian review — not a list of facts for Claude to summarize. Three live
 * candidates showed that handing Claude any parallel numeric/categorical structure (a `total`
 * beside an `items` array, or a flat list of 15–25 already-rendered `fact_lines` it still had to
 * compress into "коротко") gives it room to invent: rewrite a total, misattribute a moved card as
 * created, or add an unsupported "majority direction"/causal claim while condensing. Deterministic
 * code now performs that compression itself, so a normal successful call requires no factual
 * summarization, categorization, or generalization from Claude at all.
 */
export interface WorkHistoryAnswer {
  window: { from: string; to: string; label: string };
  scope: { kind: "board" } | { kind: "project"; label: string };
  coverage: HistoryCoverage;
  answer_text: string;
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

function categoryFor(
  items: WorkHistoryItem[],
  total_kind: WorkHistoryCategory["total_kind"],
  format: WorkHistoryFormat,
): WorkHistoryCategory | undefined {
  if (items.length === 0) return undefined;
  const shownItems = format === "concise" ? items.slice(0, 5) : items;
  const total = total_kind === "event_occurrences" ? items.reduce((count, item) => count + (item.occurrences ?? 1), 0) : items.length;
  const shown = total_kind === "event_occurrences" ? shownItems.reduce((count, item) => count + (item.occurrences ?? 1), 0) : shownItems.length;
  return { total, total_kind, shown, omitted: total - shown, items: shownItems };
}

/** Ukrainian one/few/many noun selection for a count-agreeing phrase ("1 картка", "2 картки", "5 карток"). */
function ukrainianPlural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const [one, few, many] = forms;
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

/** The predicate agreeing with a counted noun is singular only for exactly 1; every other count takes the plural form. */
function notListedPredicate(n: number, gender: "fem" | "neut"): string {
  if (n === 1) return gender === "fem" ? "не перелічена" : "не перелічене";
  return "не перелічені";
}

type CategoryKey = keyof WorkHistoryCategories;

interface CategoryNarration {
  /** Renders the authoritative total sentence, e.g. "У Done перейшло 4 події." */
  total: (n: number) => string;
  /** Renders one named example sentence for a single item. */
  item: (item: WorkHistoryItem) => string;
  /** Noun forms and gender used for the "N more not listed" overflow sentence. */
  overflowNoun: readonly [one: string, few: string, many: string];
  overflowGender: "fem" | "neut";
}

function occurrenceSuffix(item: WorkHistoryItem): string {
  if (!item.occurrences || item.occurrences <= 1) return "";
  return ` (${item.occurrences} ${ukrainianPlural(item.occurrences, ["раз", "рази", "разів"])})`;
}

function dueSuffix(item: WorkHistoryItem): string {
  return item.due ? `, due ${item.due}` : "";
}

const CATEGORY_NARRATION: Record<CategoryKey, CategoryNarration> = {
  reached_done: {
    total: (n) => `У Done перейшло ${n} ${ukrainianPlural(n, ["подія", "події", "подій"])}.`,
    item: (item) => `У Done перейшла «${item.card}»${item.at ? ` — ${item.at}` : ""}${occurrenceSuffix(item)}${dueSuffix(item)}.`,
    overflowNoun: ["подія", "події", "подій"],
    overflowGender: "fem",
  },
  returned_from_done: {
    total: (n) => `Із Done повернулося ${n} ${ukrainianPlural(n, ["подія", "події", "подій"])}.`,
    item: (item) => `Із Done повернулася «${item.card}»${item.at ? ` — ${item.at}` : ""}${occurrenceSuffix(item)}${dueSuffix(item)}.`,
    overflowNoun: ["подія", "події", "подій"],
    overflowGender: "fem",
  },
  created: {
    total: (n) => `Створено ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])}.`,
    item: (item) => `Створено «${item.card}»${item.at ? ` — ${item.at}` : ""}${dueSuffix(item)}.`,
    overflowNoun: ["картка", "картки", "карток"],
    overflowGender: "fem",
  },
  archived: {
    total: (n) => `Архівовано ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])}.`,
    item: (item) => `Архівовано «${item.card}»${item.at ? ` — ${item.at}` : ""}.`,
    overflowNoun: ["картка", "картки", "карток"],
    overflowGender: "fem",
  },
  moved: {
    total: (n) => `Між іншими списками переміщено ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])}.`,
    item: (item) => `«${item.card}»${item.transition ? ` перейшла ${item.transition}` : ""}${item.at ? ` — ${item.at}` : ""}${dueSuffix(item)}.`,
    overflowNoun: ["переміщення", "переміщення", "переміщень"],
    overflowGender: "neut",
  },
};

const CATEGORY_ORDER: CategoryKey[] = ["reached_done", "returned_from_done", "created", "archived", "moved"];

/**
 * Renders every quantitative claim in `categories` into already-computed Ukrainian sentences.
 * Claude receives only this text: the category's authoritative `total` becomes the total
 * sentence, each shown item becomes a named-example sentence, and a non-zero `omitted`
 * becomes its own "N more not listed" sentence — never left for the model to infer from
 * `items.length`.
 */
export function renderCategoryFactLines(categories: WorkHistoryCategories): string[] {
  const lines: string[] = [];
  for (const key of CATEGORY_ORDER) {
    const category = categories[key];
    if (!category) continue;
    const narration = CATEGORY_NARRATION[key];
    lines.push(narration.total(category.total));
    for (const item of category.items) lines.push(narration.item(item));
    if (category.omitted > 0) {
      const noun = ukrainianPlural(category.omitted, narration.overflowNoun);
      const predicate = notListedPredicate(category.omitted, narration.overflowGender);
      lines.push(`Ще ${category.omitted} ${noun} ${predicate} в короткому огляді.`);
    }
  }
  return lines;
}

/** Joins Ukrainian list items with a comma, and "та" before the last one. Empty/singleton-safe. */
function joinUkrainianList(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} та ${parts.at(-1)}`;
}

/** Lowercase, non-terminal clause form of each category's total, for folding several categories
 *  into one opening sentence instead of one standalone sentence per category. */
const TOTAL_CLAUSE: Record<CategoryKey, (n: number) => string> = {
  reached_done: (n) => `в Done перейшло ${n} ${ukrainianPlural(n, ["подія", "події", "подій"])}`,
  returned_from_done: (n) => `${n} ${ukrainianPlural(n, ["подія", "події", "подій"])} повернулося з Done`,
  created: (n) => `створено ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])}`,
  archived: (n) => `архівовано ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])}`,
  moved: (n) => `ще ${n} ${ukrainianPlural(n, ["картка", "картки", "карток"])} перемістилися між іншими списками`,
};

function temporalPhrase(input: WorkHistoryWindowInput, window: HistoryWindow): string {
  if (input.kind === "this_week") return "Цього тижня";
  if (input.kind === "last_week") return "Минулого тижня";
  return `За період ${formatKyivDateTime(window.from)} – ${formatKyivDateTime(window.to)}`;
}

function scopePhrase(scope: WorkHistoryScope): string {
  return scope.kind === "project" ? ` по ${scope.label} на дошці` : " на дошці";
}

/**
 * One combined opening sentence stating every non-empty category's authoritative total —
 * deliberately one sentence for however many categories are active, rather than one standalone
 * sentence per category, so a busy week does not by itself blow past a short answer's sentence
 * budget. Returns null only when every category is empty (the zero-activity fallback applies).
 */
function buildOpeningSentence(categories: WorkHistoryCategories, input: TrelloWorkHistoryInput, window: HistoryWindow): string | null {
  const clauses = CATEGORY_ORDER.filter((key) => categories[key]).map((key) => TOTAL_CLAUSE[key](categories[key]!.total));
  if (clauses.length === 0) return null;
  return `${temporalPhrase(input.window, window)}${scopePhrase(input.scope)} ${joinUkrainianList(clauses)}.`;
}

type NamedCategoryKey = "reached_done" | "returned_from_done";

const NAMED_SENTENCE: Record<NamedCategoryKey, { subjectPrefix: string; singularVerb: string; pluralVerb: string }> = {
  reached_done: { subjectPrefix: "У Done", singularVerb: "перейшла", pluralVerb: "перейшли" },
  returned_from_done: { subjectPrefix: "Із Done", singularVerb: "повернулася", pluralVerb: "повернулися" },
};

/**
 * Names the cards behind a "completion" category (reached/returned-from Done) — the facts Daniel
 * is most likely to want by name. Only `items` already selected/capped by `buildWorkHistoryCategories`
 * are used (docs/29's "named-example policy": deterministic code chooses and orders names; Claude
 * is never handed a list to choose from). A non-zero `omitted` is folded into the same sentence as
 * "(ще N)" instead of a separate sentence, so overflow never grows the answer's sentence count.
 */
function buildNamedSentence(key: NamedCategoryKey, category: WorkHistoryCategory | undefined): string | null {
  if (!category || category.items.length === 0) return null;
  const config = NAMED_SENTENCE[key];
  const verb = category.items.length === 1 ? config.singularVerb : config.pluralVerb;
  const names = joinUkrainianList(category.items.map((item) => `«${item.card}»`));
  const overflow = category.omitted > 0 ? ` (ще ${category.omitted})` : "";
  return `${config.subjectPrefix} ${verb} ${names}${overflow}.`;
}

const UNNAMED_CAVEAT_LABEL: Partial<Record<CategoryKey, string>> = {
  created: "створені",
  archived: "архівовані",
};

/**
 * `created`/`archived` cards are never individually named in a concise answer (only `moved`'s
 * bulk-noise total is even less named, deliberately with no caveat: the "ще N карток
 * перемістилися" phrasing never promised names). When either is non-empty, one honest sentence
 * says their names were not listed here — never silently, and never as a per-category sentence.
 */
function buildUnnamedCaveatSentence(categories: WorkHistoryCategories): string | null {
  const labels = (["created", "archived"] as const).filter((key) => categories[key]).map((key) => UNNAMED_CAVEAT_LABEL[key]!);
  if (labels.length === 0) return null;
  return `У короткому огляді перелічено не всі ${joinUkrainianList(labels)} картки.`;
}

/**
 * The deterministic concise `answer_text`: one opening sentence with every category's total, one
 * sentence naming reached-Done cards, one naming returned-from-Done cards, and (only when
 * applicable) one caveat that created/archived cards were not individually named. Typically
 * 1–4 sentences before any coverage/zero-activity suffix. No direction/trend/reason is stated for
 * `moved`, or anywhere else, because no such fact is computed.
 */
function buildConciseAnswerText(categories: WorkHistoryCategories, input: TrelloWorkHistoryInput, window: HistoryWindow): string[] {
  const sentences: string[] = [];
  const opening = buildOpeningSentence(categories, input, window);
  if (opening) sentences.push(opening);
  const done = buildNamedSentence("reached_done", categories.reached_done);
  if (done) sentences.push(done);
  const returned = buildNamedSentence("returned_from_done", categories.returned_from_done);
  if (returned) sentences.push(returned);
  const caveat = buildUnnamedCaveatSentence(categories);
  if (caveat) sentences.push(caveat);
  return sentences;
}

/** The deterministic detailed `answer_text`: every category total and every named item, in full —
 *  the same computation `renderCategoryFactLines` already performs, just no longer a separate
 *  model-facing field Claude would have to fold into prose itself. */
function buildDetailedAnswerText(categories: WorkHistoryCategories): string[] {
  return renderCategoryFactLines(categories);
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

/**
 * Collapses raw action history into one net movement per card while retaining reopen/re-Done
 * evidence, and returns the internal per-category totals/items. Exported for tests/debugging
 * only (docs/21 §10, docs/28, docs/29 remediation) — the model-facing result is
 * {@link buildWorkHistoryAnswer}'s `answer_text`, not this structure.
 */
export function buildWorkHistoryCategories(
  input: TrelloWorkHistoryInput,
  actions: readonly TrelloAction[],
  cards: readonly TrelloHistoryCard[],
  now = new Date(),
): WorkHistoryCategories {
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

  const categories: WorkHistoryCategories = {};
  const sections: Array<[CategoryKey, WorkHistoryItem[], WorkHistoryCategory["total_kind"]]> = [
    ["reached_done", reachedDone, "event_occurrences"],
    ["returned_from_done", returnedFromDone, "event_occurrences"],
    ["created", created, "cards"],
    ["archived", archived, "cards"],
    ["moved", moved, "cards"],
  ];
  for (const [key, items, totalKind] of sections) {
    const category = categoryFor(items, totalKind, format);
    if (category) categories[key] = category;
  }
  return categories;
}

/**
 * The model-facing #36 entry point (docs/29 remediation). Builds the internal per-category
 * totals, then renders the FINAL ready-to-send `answer_text` itself — concise mode folds totals
 * into one opening sentence plus named-completion sentences and an unnamed-category caveat
 * (`buildConciseAnswerText`); detailed mode names every item (`buildDetailedAnswerText`, reusing
 * `renderCategoryFactLines`). Either way, Claude receives one already-composed piece of prose with
 * no parallel structured field to re-derive or re-summarize a number from.
 */
export function buildWorkHistoryAnswer(
  input: TrelloWorkHistoryInput,
  actions: readonly TrelloAction[],
  cards: readonly TrelloHistoryCard[],
  coverage: HistoryCoverage,
  now = new Date(),
): WorkHistoryAnswer {
  const window = resolveHistoryWindow(input.window, now);
  const categories = buildWorkHistoryCategories(input, actions, cards, now);
  const format = input.response_format ?? "concise";
  const sentences = format === "concise" ? buildConciseAnswerText(categories, input, window) : buildDetailedAnswerText(categories);
  if (coverage.truncated || !coverage.oldestActionReached) {
    sentences.push("Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю.");
  }
  if (sentences.length === 0) {
    sentences.push("За цей період суттєвих змін не зафіксовано.");
  }
  return {
    window: { from: formatKyivDateTime(window.from), to: formatKyivDateTime(window.to), label: window.label },
    scope: input.scope.kind === "board" ? { kind: "board" } : { kind: "project", label: input.scope.label },
    coverage,
    answer_text: sentences.join(" "),
  };
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

  async execute(input: TrelloWorkHistoryInput, now = new Date()): Promise<WorkHistoryAnswer> {
    const window = resolveHistoryWindow(input.window, now);
    const board = await this.resolveSingleBoard();
    const cards = await this.readCards(board.id);
    const projectLabel = input.scope.kind === "project" ? input.scope.label : null;
    if (projectLabel !== null && !cards.some((card) => card.labels?.some((label) => label.name?.trim() === projectLabel))) {
      throw new TrelloWorkHistoryError("project_not_found");
    }
    const { actions, coverage } = await this.readActions(board.id, window);
    return buildWorkHistoryAnswer(input, actions, cards, coverage, now);
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
