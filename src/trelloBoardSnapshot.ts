import { buildSignalFacts, listRoleFor, type RhythmTrelloReader } from "./rhythmFacts.js";
import { KYIV_TIME_ZONE, TrelloWorkHistoryClient, TrelloWorkHistoryError, type TrelloAction, type TrelloBoardCard, type TrelloList } from "./trelloWorkHistory.js";

export const TRELLO_BOARD_SNAPSHOT_TOOL = {
  type: "custom" as const,
  name: "trello_board_snapshot",
  description: "Read a fresh, compact Trello current-board factual snapshot for planning, workload, nearly finished work, and Waiting. Includes real Size, checklist progress, Kyiv due, and evidenced days in the current list. Backlog and Inbox are counts by default. Use Trello MCP for exact card detail or writes; use trello_work_history for retrospective changes. This tool never ranks work or writes.",
  input_schema: {
    type: "object", additionalProperties: false, properties: { response_format: { enum: ["concise", "detailed"] } },
  },
};

export type SnapshotFormat = "concise" | "detailed";
export interface SnapshotInput { response_format?: SnapshotFormat }
export interface SnapshotCard {
  id: string;
  name: string;
  project: string;
  daysInList: number | "невідомо";
  due: string;
  dueComplete: boolean;
  size: string;
  checklist: string;
}
export interface SnapshotList { name: string; role: string; count: number; cards?: SnapshotCard[]; omitted?: number }
export interface BoardSnapshot {
  board: string;
  snapshotAt: string;
  timeZone: typeof KYIV_TIME_ZONE;
  lists: SnapshotList[];
}

export interface SnapshotReader extends Pick<RhythmTrelloReader, "resolveSingleBoard" | "readLists" | "readLatestListEntry"> {
  readSnapshotCards(boardId: string): Promise<TrelloBoardCard[]>;
  readCustomFieldDefinitions(boardId: string): Promise<unknown>;
  readCardChecklists(cardId: string): Promise<unknown>;
}

const absent = "не вказано";
const unknown = "невідомо";
const MAX_ACTIVE_CARDS = 40;
const DETAILED_CARD_LIMIT = 40;
const MAX_MODEL_BYTES = 16_384;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function malformed(): never { throw new TrelloWorkHistoryError("malformed"); }
const validInstant = (value: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

function kyivParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: KYIV_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values as ReturnType<typeof kyivParts>;
}

function kyivDayNumber(date: Date): number {
  const p = kyivParts(date);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

export function daysInCurrentList(enteredAt: string | null, now: Date): number | "невідомо" {
  if (enteredAt === null) return unknown;
  const entered = new Date(enteredAt);
  if (Number.isNaN(entered.getTime()) || entered.getTime() > now.getTime()) return unknown;
  return Math.max(0, kyivDayNumber(now) - kyivDayNumber(entered));
}

const weekdays = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
export function renderKyivDue(due: string | null): string {
  if (due === null) return absent;
  if (!validInstant(due)) malformed();
  const date = new Date(due);
  const p = kyivParts(date);
  const weekday = weekdays[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}.${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} Kyiv`;
}

interface SizeDefinition { id: string; type: string; options: Map<string, string> }
export function resolveSizeDefinition(value: unknown): SizeDefinition {
  if (!Array.isArray(value)) malformed();
  const matches = value.filter((field) => record(field) && field.name === "Size");
  if (matches.length !== 1) malformed();
  const field = matches[0] as Record<string, unknown>;
  if (typeof field.id !== "string" || !["list", "text", "number"].includes(String(field.type))) malformed();
  const options = new Map<string, string>();
  if (field.type === "list") {
    if (!Array.isArray(field.options)) malformed();
    for (const option of field.options) {
      if (!record(option) || typeof option.id !== "string" || !record(option.value) || typeof option.value.text !== "string" || options.has(option.id)) malformed();
      options.set(option.id, option.value.text);
    }
  }
  return { id: field.id, type: field.type as string, options };
}

export function sizeOf(items: unknown, definition: SizeDefinition): string {
  if (!Array.isArray(items)) malformed();
  const matches = items.filter((item) => record(item) && item.idCustomField === definition.id);
  if (matches.length > 1 || items.some((item) => !record(item) || typeof item.idCustomField !== "string")) malformed();
  if (matches.length === 0) return absent;
  const item = matches[0] as Record<string, unknown>;
  if (definition.type === "list") {
    if (typeof item.idValue !== "string" || !definition.options.has(item.idValue)) malformed();
    const value = definition.options.get(item.idValue)!;
    if (!value.trim()) malformed();
    return value;
  }
  if (!record(item.value) || typeof item.value[definition.type] !== "string") malformed();
  const value = String(item.value[definition.type]);
  if (!value.trim()) malformed();
  return value;
}

export function checklistProgress(value: unknown, expectedIds: unknown): string {
  if (!Array.isArray(expectedIds) || expectedIds.some((id) => typeof id !== "string")) malformed();
  if (!Array.isArray(value)) malformed();
  if (value.length !== expectedIds.length) malformed();
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length) malformed();
  let total = 0;
  let completed = 0;
  for (const checklist of value) {
    if (!record(checklist) || typeof checklist.id !== "string" || !expected.delete(checklist.id) || !Array.isArray(checklist.checkItems)) malformed();
    for (const item of checklist.checkItems) {
      if (!record(item) || (item.state !== "complete" && item.state !== "incomplete")) malformed();
      total += 1;
      if (item.state === "complete") completed += 1;
    }
  }
  if (expected.size !== 0) malformed();
  return value.length === 0 ? "немає" : `${completed}/${total}`;
}

function validateCard(card: TrelloBoardCard, lists: Map<string, TrelloList>): void {
  if (!card.id || typeof card.name !== "string" || typeof card.idList !== "string" || !lists.has(card.idList) ||
      typeof card.closed !== "boolean" || typeof card.dueComplete !== "boolean" ||
      (card.due !== null && (typeof card.due !== "string" || !validInstant(card.due))) ||
      !Array.isArray(card.labels) || card.labels.some((label) => !record(label) || typeof label.name !== "string") ||
      !Array.isArray(card.customFieldItems) || !Array.isArray(card.idChecklists)) malformed();
  // No project label is a real absence; two named labels are ambiguous, not an absent project.
  if (card.labels.filter((label) => Boolean(label.name?.trim())).length > 1) malformed();
}

/** Fresh GET-only projection. A failed/malformed required read fails the whole snapshot. Only age can be
 * unknown when Trello returns no authoritative list-entry action; it is never derived from activity. */
export async function collectBoardSnapshot(reader: SnapshotReader, input: SnapshotInput = {}, now = new Date()): Promise<BoardSnapshot> {
  const board = await reader.resolveSingleBoard();
  const [cards, lists, definitions] = await Promise.all([
    reader.readSnapshotCards(board.id), reader.readLists(board.id), reader.readCustomFieldDefinitions(board.id),
  ]);
  const sizeDefinition = resolveSizeDefinition(definitions);
  const listsById = new Map(lists.map((list) => [list.id, list]));
  if (listsById.size !== lists.length) malformed();
  const open = cards.filter((card) => card.closed !== true && listRoleFor(listsById.get(card.idList ?? "")?.name) !== "done");
  if (new Set(open.map((card) => card.id)).size !== open.length) malformed();
  for (const card of open) validateCard(card, listsById);
  const groups = lists.map((list) => ({ list, cards: open.filter((card) => card.idList === list.id) })).filter((group) => group.cards.length > 0);
  const detail = input.response_format === "detailed";
  const active = groups.flatMap((group) => listRoleFor(group.list.name) === "backlog" && !detail ? [] : group.cards);
  if (active.filter((card) => listRoleFor(listsById.get(card.idList!)!.name) !== "backlog").length > MAX_ACTIVE_CARDS) malformed();
  const selected = detail
    ? [...active.filter((card) => listRoleFor(listsById.get(card.idList!)!.name) !== "backlog"),
      ...active.filter((card) => listRoleFor(listsById.get(card.idList!)!.name) === "backlog")].slice(0, DETAILED_CARD_LIMIT)
    : active;
  const extra = await Promise.all(selected.map(async (card) => ({
    id: card.id,
    entry: await reader.readLatestListEntry(card.id),
    checklists: Array.isArray(card.idChecklists) && card.idChecklists.length === 0 ? [] : await reader.readCardChecklists(card.id),
  })));
  const latestEntries = new Map<string, TrelloAction | null>();
  const checklistById = new Map<string, unknown>();
  for (const item of extra) {
    if (item.entry !== null) {
      const data = item.entry.data;
      const destination = data?.listAfter ?? data?.list;
      if (!["updateCard", "createCard", "copyCard", "moveCardToBoard"].includes(item.entry.type ?? "") ||
          typeof item.entry.date !== "string" || !validInstant(item.entry.date) ||
          !record(data) || !record(data.card) || data.card.id !== item.id ||
          !record(destination) || (typeof destination.id !== "string" && typeof destination.name !== "string")) malformed();
    }
    latestEntries.set(item.id, item.entry);
    checklistById.set(item.id, item.checklists);
  }
  const factsById = new Map(buildSignalFacts({ cards: open, lists, history: null, latestEntries }).cards.map((fact) => [fact.id, fact]));
  const selectedIds = new Set(selected.map((card) => card.id));
  const result: BoardSnapshot = { board: board.name, snapshotAt: renderKyivDue(now.toISOString()), timeZone: KYIV_TIME_ZONE, lists: groups.map(({ list, cards: inList }) => {
    const shown = inList.filter((card) => selectedIds.has(card.id));
    const projected: SnapshotList = { name: list.name, role: listRoleFor(list.name), count: inList.length };
    if (shown.length > 0) projected.cards = shown.map((card) => {
      const fact = factsById.get(card.id)!;
      return { id: card.id, name: card.name, project: fact.project ?? absent,
        daysInList: daysInCurrentList(fact.enteredListAt, now), due: renderKyivDue(fact.due), dueComplete: fact.dueComplete,
        size: sizeOf(card.customFieldItems, sizeDefinition),
        checklist: checklistProgress(checklistById.get(card.id), card.idChecklists) };
    });
    if (shown.length < inList.length && detail) projected.omitted = inList.length - shown.length;
    return projected;
  }) };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_MODEL_BYTES) malformed();
  return result;
}

export function parseBoardSnapshotInput(value: unknown): SnapshotInput {
  if (!record(value) || Object.keys(value).some((key) => key !== "response_format")) throw new Error("Invalid snapshot input.");
  if (value.response_format !== undefined && value.response_format !== "concise" && value.response_format !== "detailed") throw new Error("Invalid snapshot input.");
  return value.response_format ? { response_format: value.response_format as SnapshotFormat } : {};
}

export async function executeTrelloBoardSnapshot(input: unknown, reader: SnapshotReader, now = new Date()): Promise<{ isError: boolean; content: string }> {
  try {
    const request = parseBoardSnapshotInput(input);
    return { isError: false, content: JSON.stringify(await collectBoardSnapshot(reader, request, now)) };
  } catch {
    return { isError: true, content: JSON.stringify({ error: { message: "Trello board snapshot is unavailable or incomplete. Do not infer missing board facts." } }) };
  }
}

export async function executeTrelloBoardSnapshotFromEnvironment(input: unknown): Promise<{ isError: boolean; content: string }> {
  try {
    const reader = new TrelloWorkHistoryClient({ apiKey: process.env.TRELLO_API_KEY, readToken: process.env.TRELLO_READ_TOKEN });
    return executeTrelloBoardSnapshot(input, reader);
  } catch {
    return { isError: true, content: JSON.stringify({ error: { message: "Trello board snapshot is unavailable or incomplete. Do not infer missing board facts." } }) };
  }
}
