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
/** What Daniel asked about (#66): the whole period, or one kind of change only. */
export type WorkHistoryFocus = "overview" | "completed" | "returned" | "created" | "archived" | "moved";

export interface TrelloWorkHistoryInput {
  window: WorkHistoryWindowInput;
  scope: WorkHistoryScope;
  response_format?: WorkHistoryFormat;
  focus?: WorkHistoryFocus;
}

/** Decided by the client from the turn, never by the model's input (#66). */
export interface WorkHistoryDeliveryPolicy {
  /** The event-by-event chronology is rendered only when Daniel's own message of this turn asked for it. */
  detailRequested: boolean;
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
    /** The list a card was created in (`createCard`/`copyCard`/`moveCardToBoard`). */
    list?: { id?: string; name?: string };
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

/** An open card as the Working Rhythm fact collector reads it (#39). */
export interface TrelloBoardCard extends TrelloHistoryCard {
  dueComplete?: boolean;
  customFieldItems?: unknown;
  idChecklists?: unknown;
}

export interface TrelloList {
  id: string;
  name: string;
}

/** A single card's current state as a reminder delivery reads it (#54). */
export interface TrelloCardState {
  name: string;
  closed: boolean;
  dueComplete: boolean;
  listName: string | null;
  /** The card's current list id (#50 focus budget binds to the current In-progress stint). */
  listId?: string | null;
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
  /** Unique cards in the category (#69). Equals `total` for a `cards` category; for `event_occurrences` it is what a
   *  re-entered Done must not inflate: a card that entered Done twice is 2 in `total` and 1 here. */
  cards: number;
  shown: number;
  omitted: number;
  /** Unique cards not named because of the display limit (#69); `omitted` is the same remainder in `total`'s unit. */
  cards_omitted: number;
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
  /** Present only when `detailed` was requested but not delivered (#66); for the model, never shown to Daniel. */
  detail_note?: string;
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

/**
 * #66 source intent for the next Agent version; NOT what any reviewed release exposes. Agent v26–v31 carry
 * `TRELLO_WORK_HISTORY_TOOL` above byte for byte (attestation compares against it), so that definition stays frozen
 * until a release-construction issue ships this one together with the #66 `work-review` Skill edit. It adds the
 * explicit `focus` and says what `detailed` is for. The executor already accepts both input shapes.
 */
export const TRELLO_WORK_HISTORY_TOOL_NEXT = {
  type: "custom" as const,
  name: TRELLO_WORK_HISTORY_TOOL.name,
  description:
    "Read a compact, read-only Trello board-action digest for a requested week or explicit Kyiv date range. The client shows its `answer_text` to Daniel verbatim, so request exactly what he asked. `focus`: `overview` (default) for a week or project review; one kind of change (`completed` = moved into Done, `returned` = came back from Done, `created`, `archived`, `moved`) for a narrow question — the answer is then only that deduplicated card list. `response_format: detailed` is the event-by-event chronology: code delivers it only when Daniel's own message asks for detail, so never request it to gather material for your own summary. In the text «N карток» is unique cards and «переходів»/«подій» is Done transitions; neither counts completed tasks or achieved outcomes. It computes Kyiv dates, counts, current-label project scope, and coverage itself; do not use it for current Project Health, writes, effort, or work outside Trello.",
  input_schema: {
    ...TRELLO_WORK_HISTORY_TOOL.input_schema,
    properties: {
      ...TRELLO_WORK_HISTORY_TOOL.input_schema.properties,
      focus: { enum: ["overview", "completed", "returned", "created", "archived", "moved"] },
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

/** The instant of a Kyiv wall-clock minute on a Kyiv calendar date (`YYYY-MM-DD`), DST-correct (#50 work hours). */
export function kyivLocalInstant(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  return kyivLocalToUtc(year, month, day, Math.floor(minutes / 60), minutes % 60);
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

/** Named cards per category in an overview. A project is the narrow scope, so its names are not cut at five (#66):
 *  that cut made a full `detailed` dump the only way to learn which cards a project closed. */
const OVERVIEW_NAMED_LIMIT = { board: 5, project: 15 } as const;
/** Cards listed by a single-focus answer before "ще N". */
const FOCUS_LIST_LIMIT = 30;

function categoryFor(
  items: WorkHistoryItem[],
  total_kind: WorkHistoryCategory["total_kind"],
  limit: number | null,
): WorkHistoryCategory | undefined {
  if (items.length === 0) return undefined;
  const shownItems = limit === null ? items : items.slice(0, limit);
  const total = total_kind === "event_occurrences" ? items.reduce((count, item) => count + (item.occurrences ?? 1), 0) : items.length;
  const shown = total_kind === "event_occurrences" ? shownItems.reduce((count, item) => count + (item.occurrences ?? 1), 0) : shownItems.length;
  return { total, total_kind, cards: items.length, shown, omitted: total - shown, cards_omitted: items.length - shownItems.length, items: shownItems };
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
  /** Renders the authoritative total sentence, e.g. "У Done перейшло 4 події (3 унікальні картки)." */
  total: (category: WorkHistoryCategory) => string;
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
  return item.due ? `, дедлайн ${item.due}` : "";
}

const UNIQUE_CARDS_NOUN = ["унікальна картка", "унікальні картки", "унікальних карток"] as const;
const CARDS_NOUN = ["картка", "картки", "карток"] as const;

/**
 * #69: an event total never stands alone. The chronology counts transitions, so «24 події» with no card count beside it
 * was the only number available and got retold as «24 картки». Code states the unique-card count next to it, always.
 */
function eventTotal(lead: string, category: WorkHistoryCategory): string {
  const events = `${category.total} ${ukrainianPlural(category.total, ["подія", "події", "подій"])}`;
  return `${lead} ${events} (${category.cards} ${ukrainianPlural(category.cards, UNIQUE_CARDS_NOUN)}).`;
}

function cardTotal(lead: string, category: WorkHistoryCategory): string {
  return `${lead} ${category.total} ${ukrainianPlural(category.total, CARDS_NOUN)}.`;
}

const CATEGORY_NARRATION: Record<CategoryKey, CategoryNarration> = {
  reached_done: {
    total: (category) => eventTotal("У Done перейшло", category),
    item: (item) => `У Done перейшла «${item.card}»${item.at ? ` — ${item.at}` : ""}${occurrenceSuffix(item)}${dueSuffix(item)}.`,
    overflowNoun: ["подія", "події", "подій"],
    overflowGender: "fem",
  },
  returned_from_done: {
    total: (category) => eventTotal("Із Done повернулося", category),
    item: (item) => `Із Done повернулася «${item.card}»${item.at ? ` — ${item.at}` : ""}${occurrenceSuffix(item)}${dueSuffix(item)}.`,
    overflowNoun: ["подія", "події", "подій"],
    overflowGender: "fem",
  },
  created: {
    total: (category) => cardTotal("Створено", category),
    item: (item) => `Створено «${item.card}»${item.at ? ` — ${item.at}` : ""}${dueSuffix(item)}.`,
    overflowNoun: ["картка", "картки", "карток"],
    overflowGender: "fem",
  },
  archived: {
    total: (category) => cardTotal("Архівовано", category),
    item: (item) => `Архівовано «${item.card}»${item.at ? ` — ${item.at}` : ""}.`,
    overflowNoun: ["картка", "картки", "карток"],
    overflowGender: "fem",
  },
  moved: {
    total: (category) => cardTotal("Між іншими списками переміщено", category),
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
    lines.push(narration.total(category));
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

function temporalPhrase(input: WorkHistoryWindowInput, window: HistoryWindow): string {
  if (input.kind === "this_week") return "Цього тижня";
  if (input.kind === "last_week") return "Минулого тижня";
  return `За період ${formatKyivDateTime(window.from)} – ${formatKyivDateTime(window.to)}`;
}

/** The structured "Variant B" heading line, e.g. "Минулого тижня по Extract:" or
 *  "Цього тижня на дошці:" for a whole-board review (Product Owner decision 2026-09-22). */
function headingLine(input: TrelloWorkHistoryInput, window: HistoryWindow): string {
  const scope = input.scope.kind === "project" ? ` по ${input.scope.label}` : " на дошці";
  return `${temporalPhrase(input.window, window)}${scope}:`;
}

const VARIANT_B_LABEL: Record<CategoryKey, string> = {
  reached_done: "Перейшло в Done",
  returned_from_done: "Повернулось з Done",
  created: "Створено",
  archived: "Архівовано",
  moved: "Інші переміщення",
};

/** The two categories Daniel is most likely to want by name (docs/29's "named-example policy":
 *  deterministic code chooses and orders names; Claude is never handed a list to choose from).
 *  `created`/`archived`/`moved` stay count-only — never individually named in a concise review,
 *  and (Product Owner decision) never accompanied by a "not all listed" caveat either: that
 *  caveat conflated a real data-coverage gap with concise mode's ordinary example limit. */
const VARIANT_B_NAMED: ReadonlySet<CategoryKey> = new Set(["reached_done", "returned_from_done"]);

const VARIANT_B_COUNT_NOUN: readonly [string, string, string] = ["картка", "картки", "карток"];

/** The event noun of a named category, used only when its event count differs from its unique-card count (#69). */
const VARIANT_B_EVENT_NOUN: Partial<Record<CategoryKey, readonly [string, string, string]>> = {
  reached_done: ["перехід", "переходи", "переходів"],
  returned_from_done: ["повернення", "повернення", "повернень"],
};

/**
 * One structured bullet for a single non-empty category. Every count carries its unit (#69). The overview is about
 * cards, so a named category leads with its unique-card count; the event-occurrence total (`category.total`, where a
 * Done → reopen → Done card counts twice) follows in brackets only when it differs: «2 картки (3 переходи)». Before
 * #69 the bullet was a bare «24 — «…»» of event occurrences beside card names and sibling «N карток» bullets — the
 * text that got retold as «24 картки перейшли в Done». The names and «(ще N)» are cards too. Overflow stays folded
 * into the same bullet, so it never grows the answer's line count.
 */
function buildVariantBBullet(key: CategoryKey, category: WorkHistoryCategory): string {
  const label = VARIANT_B_LABEL[key];
  const cards = `${category.cards} ${ukrainianPlural(category.cards, VARIANT_B_COUNT_NOUN)}`;
  if (VARIANT_B_NAMED.has(key)) {
    const names = joinUkrainianList(category.items.map((item) => `«${item.card}»`));
    const eventNoun = VARIANT_B_EVENT_NOUN[key];
    const events = eventNoun && category.total !== category.cards ? ` (${category.total} ${ukrainianPlural(category.total, eventNoun)})` : "";
    const overflow = category.cards_omitted > 0 ? ` (ще ${category.cards_omitted})` : "";
    return `- **${label}:** ${cards}${events} — ${names}${overflow}`;
  }
  return `- **${label}:** ${cards}`;
}

/**
 * The deterministic concise `answer_text` in the Product Owner's selected structured "Variant B"
 * shape: a heading line, then one Markdown bullet per non-empty category, in `CATEGORY_ORDER`.
 * A category with zero items is omitted entirely rather than rendered as "0" (requirement #7).
 * No direction/trend/reason is stated anywhere, because no such fact is computed.
 */
function buildVariantBAnswerText(categories: WorkHistoryCategories, input: TrelloWorkHistoryInput, window: HistoryWindow): string {
  const heading = headingLine(input, window);
  const activeKeys = CATEGORY_ORDER.filter((key) => categories[key]);
  if (activeKeys.length === 0) return `${heading} за цей період суттєвих змін не зафіксовано.`;
  return [heading, "", ...activeKeys.map((key) => buildVariantBBullet(key, categories[key]!))].join("\n");
}

const FOCUS_CATEGORY: Record<Exclude<WorkHistoryFocus, "overview">, CategoryKey> = {
  completed: "reached_done",
  returned: "returned_from_done",
  created: "created",
  archived: "archived",
  moved: "moved",
};

const FOCUS_LABEL: Record<CategoryKey, string> = {
  reached_done: "закрито",
  returned_from_done: "повернулось із Done",
  created: "створено",
  archived: "архівовано",
  moved: "переміщено між списками",
};

const FOCUS_REPEAT_VERB: Partial<Record<CategoryKey, readonly [one: string, few: string, many: string]>> = {
  reached_done: ["заходила в Done", "заходили в Done", "заходило в Done"],
  returned_from_done: ["поверталась із Done", "повертались із Done", "поверталось із Done"],
};

function focusPeriod(input: WorkHistoryWindowInput, window: HistoryWindow): string {
  if (input.kind === "this_week") return "цього тижня";
  if (input.kind === "last_week") return "минулого тижня";
  return `за період ${formatKyivDateTime(window.from)} – ${formatKyivDateTime(window.to)}`;
}

/** "Одна картка заходила в Done двічі." — the only mention of a repeated Done/reopen in a focused answer. */
function repeatSentence(key: CategoryKey, items: readonly WorkHistoryItem[]): string | null {
  const verb = FOCUS_REPEAT_VERB[key];
  const repeated = items.filter((item) => (item.occurrences ?? 1) > 1);
  if (!verb || repeated.length === 0) return null;
  if (repeated.length === 1) {
    const times = repeated[0].occurrences!;
    return `Одна картка ${verb[0]} ${times === 2 ? "двічі" : `${times} ${ukrainianPlural(times, ["раз", "рази", "разів"])}`}.`;
  }
  return `${repeated.length} ${ukrainianPlural(repeated.length, VARIANT_B_COUNT_NOUN)} ${ukrainianPlural(repeated.length, verb)} більше одного разу.`;
}

/**
 * The deterministic answer to a narrow question (#66) — «По CL, які задачі було закрито?»: exactly the requested kind
 * of change as one deduplicated card list, then the unique-card count. No other category, no timestamp, no due value
 * and no event chronology. A card that entered Done twice is listed once; the repeat is one short closing sentence.
 */
function buildFocusAnswerText(key: CategoryKey, category: WorkHistoryCategory | undefined, input: TrelloWorkHistoryInput, window: HistoryWindow): string {
  const scope = input.scope.kind === "project" ? input.scope.label : "Дошка";
  const heading = `${scope} — ${FOCUS_LABEL[key]} ${focusPeriod(input.window, window)}`;
  if (!category) return `${heading}: нічого.`;
  const count = category.items.length;
  const listed = category.items.slice(0, FOCUS_LIST_LIMIT);
  const lines = [`${heading}:`, ...listed.map((item) => `• ${item.card}${key === "moved" && item.transition ? ` (${item.transition})` : ""}`)];
  if (count > listed.length) lines.push(`• … ще ${count - listed.length}`);
  const closing = [
    ...(count > 1 ? [`${count} ${ukrainianPlural(count, ["унікальна картка", "унікальні картки", "унікальних карток"])}.`] : []),
    ...[repeatSentence(key, category.items)].filter((sentence): sentence is string => sentence !== null),
  ];
  if (closing.length > 0) lines.push(closing.join(" "));
  return lines.join("\n");
}

/** The deterministic detailed `answer_text`: every category total and every named item, in full —
 *  the same computation `renderCategoryFactLines` already performs, just no longer a separate
 *  model-facing field Claude would have to fold into prose itself. Unchanged by the Variant B
 *  concise-mode rework (Product Owner decision: adapt concise only). */
function buildDetailedAnswerText(categories: WorkHistoryCategories, coverageWarning: string | null): string {
  const sentences = renderCategoryFactLines(categories);
  if (coverageWarning) sentences.push(coverageWarning);
  if (sentences.length === 0) sentences.push("За цей період суттєвих змін не зафіксовано.");
  return sentences.join(" ");
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
  // Only the overview caps its named examples; a detailed or single-focus answer needs every item.
  const limit = input.response_format === "detailed" || (input.focus ?? "overview") !== "overview" ? null : OVERVIEW_NAMED_LIMIT[input.scope.kind];
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
    const category = categoryFor(items, totalKind, limit);
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
  policy: WorkHistoryDeliveryPolicy = { detailRequested: true },
): WorkHistoryAnswer {
  const window = resolveHistoryWindow(input.window, now);
  // #66: `detailed` is the model's request; whether Daniel asked for it is the client's fact. Without that fact the
  // answer is the ordinary compact one, so a full event dump cannot reach him by the model's choice alone.
  const withheld = input.response_format === "detailed" && !policy.detailRequested;
  const format: WorkHistoryFormat = input.response_format === "detailed" && !withheld ? "detailed" : "concise";
  const focus = input.focus ?? "overview";
  const focusKey = focus === "overview" ? null : FOCUS_CATEGORY[focus];
  const all = buildWorkHistoryCategories({ ...input, response_format: format }, actions, cards, now);
  const categories: WorkHistoryCategories = focusKey === null ? all : all[focusKey] ? { [focusKey]: all[focusKey] } : {};
  const incomplete = coverage.truncated || !coverage.oldestActionReached;
  // Only a real data-coverage limitation (truncated/partial retrieval) produces this warning —
  // never concise mode's ordinary per-category example cap, which is not a coverage gap.
  const coverageWarning = incomplete ? "Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю." : null;
  const conciseText = focusKey === null ? buildVariantBAnswerText(categories, input, window) : buildFocusAnswerText(focusKey, categories[focusKey], input, window);
  const answerText =
    format === "concise" ? conciseText + (coverageWarning ? `\n\n${coverageWarning}` : "") : buildDetailedAnswerText(categories, coverageWarning);
  return {
    window: { from: formatKyivDateTime(window.from), to: formatKyivDateTime(window.to), label: window.label },
    scope: input.scope.kind === "board" ? { kind: "board" } : { kind: "project", label: input.scope.label },
    coverage,
    answer_text: answerText,
    ...(withheld ? { detail_note: DETAIL_WITHHELD_NOTE } : {}),
  };
}

const DETAIL_WITHHELD_NOTE =
  "The detailed chronology was not produced: it is shown only when Daniel's own message in this turn asks for it " +
  "(«детально», «повна історія», «всі переміщення»). `answer_text` is the compact answer he sees. Do not narrate events " +
  "yourself; if detail would help, say in one short line that he can ask for it.";

/**
 * Whether Daniel's own message explicitly asks for the detailed history (#66). Deliberately a short list of plain
 * requests, not intent recognition: it only permits what the model also has to ask for, so a false match shows nothing
 * by itself, and a miss costs one compact answer plus a line telling Daniel how to get the detail.
 */
const DETAIL_REQUEST =
  /детальн|докладн|подробиц|розгорнут|розпиши|хронолог|повн\S*\s+істор|вс[іея]\S*\s+(?:переміщен|поді|рух|істор)|кожн\S*\s+(?:переміщен|поді|картк)|in detail|detailed|full history/iu;

export function asksForDetailedHistory(text: string): boolean {
  return DETAIL_REQUEST.test(text);
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
  /** An explicit board for an isolated read-only validation fixture; ordinary production keeps single-board resolution. */
  boardId?: string;
  fetch?: FetchLike;
  maxPages?: number;
}

/** Minimal GET-only executor. Credentials stay only in the Authorization header and never enter errors. */
export class TrelloWorkHistoryClient {
  private readonly fetcher: FetchLike;
  private readonly maxPages: number;
  private readonly authorization: string;
  private readonly boardId: string | undefined;

  constructor(options: TrelloWorkHistoryClientOptions = {}) {
    const apiKey = options.apiKey?.trim();
    const readToken = options.readToken?.trim();
    if (!apiKey || !readToken) throw new TrelloWorkHistoryError("credentials_missing");
    this.fetcher = options.fetch ?? fetch;
    this.maxPages = options.maxPages ?? MAX_ACTION_PAGES;
    if (options.boardId !== undefined && !/^[0-9a-f]{24}$/i.test(options.boardId)) throw new TrelloWorkHistoryError("ambiguous_board");
    this.boardId = options.boardId;
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
    if (this.boardId) {
      const board = await this.getJson(`/boards/${this.boardId}`, { fields: "id,name,closed" });
      if (!isRecord(board) || board.id !== this.boardId || typeof board.name !== "string" || board.closed !== false) throw new TrelloWorkHistoryError("ambiguous_board");
      return { id: board.id, name: board.name };
    }
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

  /** Open cards with the fields the Working Rhythm needs (#39); never `dateLastActivity`. */
  async readOpenCards(boardId: string): Promise<TrelloBoardCard[]> {
    const value = await this.getJson(`/boards/${encodeURIComponent(boardId)}/cards`, { filter: "open", fields: "id,name,idList,closed,due,dueComplete,labels" });
    if (!Array.isArray(value) || value.some((card) => !isRecord(card) || typeof card.id !== "string" || typeof card.name !== "string")) {
      throw new TrelloWorkHistoryError("malformed");
    }
    return value as TrelloBoardCard[];
  }

  /** The snapshot requests its source fields explicitly; missing nested fields are a coverage error. */
  async readSnapshotCards(boardId: string): Promise<TrelloBoardCard[]> {
    const value = await this.getJson(`/boards/${encodeURIComponent(boardId)}/cards`, {
      filter: "open", fields: "id,name,idList,closed,due,dueComplete,labels,idChecklists", customFieldItems: "true",
    });
    if (!Array.isArray(value) || value.some((card) => !isRecord(card) || typeof card.id !== "string" || typeof card.name !== "string")) {
      throw new TrelloWorkHistoryError("malformed");
    }
    return value as TrelloBoardCard[];
  }

  async readCustomFieldDefinitions(boardId: string): Promise<unknown> {
    return this.getJson(`/boards/${encodeURIComponent(boardId)}/customFields`);
  }

  async readCardChecklists(cardId: string): Promise<unknown> {
    return this.getJson(`/cards/${encodeURIComponent(cardId)}/checklists`, { checkItems: "all", checkItem_fields: "state", fields: "id" });
  }

  /** Every list of the board, archived included, so a card in an archived list still resolves a name (#39). */
  async readLists(boardId: string): Promise<TrelloList[]> {
    const value = await this.getJson(`/boards/${encodeURIComponent(boardId)}/lists`, { filter: "all", fields: "id,name" });
    if (!Array.isArray(value) || value.some((list) => !isRecord(list) || typeof list.id !== "string" || typeof list.name !== "string")) {
      throw new TrelloWorkHistoryError("malformed");
    }
    return value as TrelloList[];
  }

  /** One card's current name, list name and completion flags, read fresh at reminder delivery (#54). */
  async readCardState(cardId: string): Promise<TrelloCardState> {
    const value = await this.getJson(`/cards/${encodeURIComponent(cardId)}`, { fields: "name,closed,dueComplete,idList", list: "true" });
    if (!isRecord(value) || typeof value.name !== "string") throw new TrelloWorkHistoryError("malformed");
    const list = isRecord(value.list) && typeof value.list.name === "string" ? value.list.name : null;
    const listId = typeof value.idList === "string" ? value.idList : null;
    return { name: value.name, closed: value.closed === true, dueComplete: value.dueComplete === true, listName: list, listId };
  }

  /** The card's most recent list-changing action (a move, or its creation), however old, or null (#39). */
  async readLatestListEntry(cardId: string): Promise<TrelloAction | null> {
    const value = await this.getJson(`/cards/${encodeURIComponent(cardId)}/actions`, {
      filter: "updateCard:idList,createCard,copyCard,moveCardToBoard",
      limit: "1",
    });
    if (!Array.isArray(value) || value.some((action) => !isRecord(action))) throw new TrelloWorkHistoryError("malformed");
    return (value[0] as TrelloAction | undefined) ?? null;
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

  async execute(input: TrelloWorkHistoryInput, now = new Date(), policy?: WorkHistoryDeliveryPolicy): Promise<WorkHistoryAnswer> {
    const window = resolveHistoryWindow(input.window, now);
    const board = await this.resolveSingleBoard();
    const cards = await this.readCards(board.id);
    const projectLabel = input.scope.kind === "project" ? input.scope.label : null;
    if (projectLabel !== null && !cards.some((card) => card.labels?.some((label) => label.name?.trim() === projectLabel))) {
      throw new TrelloWorkHistoryError("project_not_found");
    }
    const { actions, coverage } = await this.readActions(board.id, window);
    return buildWorkHistoryAnswer(input, actions, cards, coverage, now, policy);
  }
}

export interface CustomToolExecutionResult { isError: boolean; content: string }

/** Safe boundary for the Session client: neither credentials nor raw Trello errors cross it. */
/** Without a policy the executor is closed: a caller that cannot say Daniel asked for detail never gets the chronology. */
export async function executeTrelloWorkHistory(
  input: unknown,
  client: TrelloWorkHistoryClient,
  now = new Date(),
  policy: WorkHistoryDeliveryPolicy = { detailRequested: false },
): Promise<CustomToolExecutionResult> {
  try {
    const request = parseTrelloWorkHistoryInput(input);
    return { isError: false, content: JSON.stringify(await client.execute(request, now, policy)) };
  } catch (error) {
    const message = error instanceof TrelloWorkHistoryError ? error.message : "Trello history request is unavailable because its input was invalid.";
    return { isError: true, content: JSON.stringify({ error: { message } }) };
  }
}

export async function executeTrelloWorkHistoryFromEnvironment(input: unknown, policy?: WorkHistoryDeliveryPolicy): Promise<CustomToolExecutionResult> {
  try {
    const client = new TrelloWorkHistoryClient({ apiKey: process.env.TRELLO_API_KEY, readToken: process.env.TRELLO_READ_TOKEN });
    return executeTrelloWorkHistory(input, client, new Date(), policy);
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
  const focus = value.focus === undefined ? undefined : FOCUS_VALUES.find((candidate) => candidate === value.focus) ?? null;
  if (focus === null) throw new Error("Invalid tool input.");
  return { window, scope, ...(response_format ? { response_format } : {}), ...(focus ? { focus } : {}) };
}

const FOCUS_VALUES: readonly WorkHistoryFocus[] = ["overview", "completed", "returned", "created", "archived", "moved"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
