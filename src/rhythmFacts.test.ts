import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import {
  buildSignalFacts,
  createRhythmFactCollector,
  historyLookbackDays,
  listRoleFor,
  MAX_WAITING_ENTRY_READS,
  projectOf,
  projectSlug,
  type RhythmTrelloReader,
} from "./rhythmFacts.js";
import { detectSignals } from "./rhythmSignals.js";
import { TrelloWorkHistoryClient, type TrelloAction, type TrelloBoardCard, type TrelloList } from "./trelloWorkHistory.js";

// #39 Stage 2 — read-only fact collector: fresh Trello cards + provable history → Stage 1 SignalFacts.
// Fixtures follow the real Trello REST shapes (ids, labels with colour, memberCreator on actions).

const LISTS: TrelloList[] = [
  { id: "l_inbox", name: "Inbox" },
  { id: "l_backlog", name: "Backlog" },
  { id: "l_week", name: "This week" },
  { id: "l_prog", name: "In progress" },
  { id: "l_wait", name: "Waiting" },
  { id: "l_done", name: "Done" },
  { id: "l_old", name: "Archive 2025" },
];

const label = (name: string) => ({ id: `lbl_${name}`, idBoard: "b1", name, color: "green" });
const card = (id: string, idList: string, extra: Partial<TrelloBoardCard> = {}): TrelloBoardCard => ({
  id,
  name: `Card ${id}`,
  idList,
  closed: false,
  due: null,
  dueComplete: false,
  labels: [label("Seqthera")],
  ...extra,
});
const move = (cardId: string, from: TrelloList, to: TrelloList, date: string): TrelloAction => ({
  id: `act_${cardId}_${date}`,
  type: "updateCard",
  date,
  data: {
    card: { id: cardId, name: `Card ${cardId}` },
    listBefore: { id: from.id, name: from.name },
    listAfter: { id: to.id, name: to.name },
    old: { idList: from.id },
  },
  // Real actions carry the actor; the collector never reads it.
  ...({ memberCreator: { id: "m1", fullName: "Someone" }, idMemberCreator: "m1" } as object),
});
const [INBOX, , WEEK, PROG, WAIT, DONE] = LISTS;
const NOW = new Date("2026-09-29T11:00:00Z");
const COVERAGE = { pagesRead: 1, truncated: false, oldestActionReached: true };

test("list-role mapping: the board's six lists by exact name (case/spacing aside); anything else is other", () => {
  assert.equal(listRoleFor("Inbox"), "backlog");
  assert.equal(listRoleFor("Backlog"), "backlog");
  assert.equal(listRoleFor("This week"), "todo");
  assert.equal(listRoleFor("  this   WEEK "), "todo");
  assert.equal(listRoleFor("In progress"), "in_progress");
  assert.equal(listRoleFor("Waiting"), "waiting");
  assert.equal(listRoleFor("Done"), "done");
  for (const other of ["Archive 2025", "Blocked", "Done ✓", "In review", "", undefined]) assert.equal(listRoleFor(other), "other", String(other));
});

test("project labels: exactly one label → slug; none or several → null (never guessed)", () => {
  assert.equal(projectSlug("Cossack Labs"), "cossack-labs");
  assert.equal(projectSlug("Сек'thera / Studio"), "сек-thera-studio");
  assert.equal(projectOf({ labels: [label("Limen")] }), "limen");
  assert.equal(projectOf({ labels: [] }), null);
  assert.equal(projectOf({ labels: [{ name: "" }] }), null);
  assert.equal(projectOf({ labels: [label("Limen"), label("Extract")] }), null);
});

test("cards: list role, project, due and dueComplete from the fresh read; archived cards dropped", () => {
  const facts = buildSignalFacts({
    cards: [
      card("a", WEEK.id, { due: "2026-09-30T15:00:00.000Z" }),
      card("b", PROG.id, { due: "2026-09-28T15:00:00.000Z", dueComplete: true, labels: [label("Cossack Labs")] }),
      card("c", "l_old"),
      card("d", "l_unknown_id", { labels: [] }),
      card("e", WEEK.id, { closed: true }),
    ],
    lists: LISTS,
    history: { actions: [], coverage: COVERAGE },
  });
  assert.deepEqual(
    facts.cards.map((c) => [c.id, c.list, c.project, c.due, c.dueComplete]),
    [
      ["a", "todo", "seqthera", "2026-09-30T15:00:00.000Z", false],
      ["b", "in_progress", "cossack-labs", "2026-09-28T15:00:00.000Z", true],
      ["c", "other", "seqthera", null, false],
      ["d", "other", null, null, false],
    ],
  );
  assert.deepEqual(facts.followUps, [], "follow-up dates stay in native Memory; the collector never parses them");
  assert.deepEqual(facts.projects, [], "no reviewed priority source → no project facts");
});

test("Waiting entry: the latest proven move INTO the card's current list; otherwise unknown", () => {
  const facts = buildSignalFacts({
    cards: [card("w1", WAIT.id), card("w2", WAIT.id), card("w3", WAIT.id)],
    lists: LISTS,
    history: {
      actions: [
        move("w1", PROG, WAIT, "2026-09-20T09:00:00.000Z"),
        move("w1", WAIT, PROG, "2026-09-22T09:00:00.000Z"),
        move("w1", PROG, WAIT, "2026-09-23T10:00:00.000Z"), // second stint → the one that counts
        move("w2", WAIT, PROG, "2026-09-25T09:00:00.000Z"), // history disagrees with the current list
      ],
      coverage: COVERAGE,
    },
  });
  const byId = Object.fromEntries(facts.cards.map((c) => [c.id, c.enteredListAt]));
  assert.equal(byId.w1, "2026-09-23T10:00:00.000Z");
  assert.equal(byId.w2, null, "inconsistent evidence → unknown");
  assert.equal(byId.w3, null, "no evidence → unknown, never the card's modification time");
});

test("Waiting entry beyond the board window: the card's own latest list entry proves a long wait", () => {
  const facts = buildSignalFacts({
    cards: [card("w", WAIT.id)],
    lists: LISTS,
    history: { actions: [], coverage: COVERAGE },
    latestEntries: new Map([["w", move("w", PROG, WAIT, "2026-07-01T08:00:00.000Z")]]),
  });
  assert.equal(facts.cards[0].enteredListAt, "2026-07-01T08:00:00.000Z");
  const signals = detectSignals(facts, NOW, DEFAULT_RHYTHM_CONFIG);
  assert.equal(signals.find((s) => s.kind === "waiting_long")?.fingerprint, "2026-07-01T08:00:00.000Z", "stable fingerprint = the stint");
});

test("a card created directly in Waiting counts that creation as its entry", () => {
  const created: TrelloAction = { id: "a1", type: "createCard", date: "2026-09-10T08:00:00.000Z", data: { card: { id: "n" }, list: { id: WAIT.id, name: "Waiting" } } };
  const facts = buildSignalFacts({ cards: [card("n", WAIT.id)], lists: LISTS, history: { actions: [created], coverage: COVERAGE } });
  assert.equal(facts.cards[0].enteredListAt, "2026-09-10T08:00:00.000Z");
});

test("reopened from Done: a move out of Done; a move into Done or between other lists is not", () => {
  const facts = buildSignalFacts({
    cards: [card("r", PROG.id), card("d", DONE.id), card("m", PROG.id)],
    lists: LISTS,
    history: {
      actions: [
        move("r", PROG, DONE, "2026-09-24T09:00:00.000Z"),
        move("r", DONE, PROG, "2026-09-26T09:00:00.000Z"),
        move("d", PROG, DONE, "2026-09-26T10:00:00.000Z"),
        move("m", WEEK, PROG, "2026-09-26T11:00:00.000Z"),
      ],
      coverage: COVERAGE,
    },
  });
  const byId = Object.fromEntries(facts.cards.map((c) => [c.id, c.reopenedFromDoneAt]));
  assert.deepEqual(byId, { r: "2026-09-26T09:00:00.000Z", d: null, m: null });
  assert.ok(detectSignals(facts, NOW, DEFAULT_RHYTHM_CONFIG).some((s) => s.key === "reopened:r"));
});

test("project movement: latest real list change of the project's cards, only for projects with a reviewed priority", () => {
  const facts = buildSignalFacts({
    cards: [card("s1", PROG.id), card("x1", WEEK.id, { labels: [label("Extract")] })],
    lists: LISTS,
    history: {
      actions: [
        move("s1", WEEK, PROG, "2026-09-15T09:00:00.000Z"),
        move("s1", INBOX, WEEK, "2026-09-10T09:00:00.000Z"),
        // A comment/edit is not movement (filtered out: no list change).
        { id: "e1", type: "updateCard", date: "2026-09-28T09:00:00.000Z", data: { card: { id: "x1" }, old: { closed: false } } as TrelloAction["data"] },
      ],
      coverage: COVERAGE,
    },
    projectPriorities: new Map([
      ["seqthera", "high"],
      ["extract", "medium"],
    ]),
  });
  assert.deepEqual(facts.projects, [
    { project: "seqthera", priority: "high", lastMovementAt: "2026-09-15T09:00:00.000Z" },
    { project: "extract", priority: "medium", lastMovementAt: null },
  ]);
});

test("no lastActivityAt inference: activity-only fields never create evidence", () => {
  const facts = buildSignalFacts({
    cards: [{ ...card("w", WAIT.id), ...({ dateLastActivity: "2026-08-01T00:00:00.000Z" } as object) }],
    lists: LISTS,
    history: { actions: [], coverage: COVERAGE },
  });
  assert.equal(facts.cards[0].enteredListAt, null);
  assert.equal(detectSignals(facts, NOW, DEFAULT_RHYTHM_CONFIG).filter((s) => s.kind === "waiting_long").length, 0);
});

// --- Collector (reader boundary) -------------------------------------------------------------------------

function reader(overrides: Partial<RhythmTrelloReader> = {}): RhythmTrelloReader & { windows: Array<{ from: Date; to: Date }>; entryReads: string[] } {
  const windows: Array<{ from: Date; to: Date }> = [];
  const entryReads: string[] = [];
  return {
    windows,
    entryReads,
    resolveSingleBoard: async () => ({ id: "b1", name: "Djonik" }),
    readOpenCards: async () => [card("w", WAIT.id), card("t", WEEK.id, { due: "2026-09-30T09:00:00.000Z" })],
    readLists: async () => LISTS,
    readActions: async (_board, window) => (windows.push(window), { actions: [move("t", INBOX, WEEK, "2026-09-25T09:00:00.000Z")], coverage: COVERAGE }),
    readLatestListEntry: async (cardId) => (entryReads.push(cardId), move(cardId, PROG, WAIT, "2026-09-01T09:00:00.000Z")),
    ...overrides,
  };
}

test("collector: board history window covers the configured stale threshold; Waiting entries read per card", async () => {
  const r = reader();
  const facts = await createRhythmFactCollector({ reader: r })({ now: NOW, config: DEFAULT_RHYTHM_CONFIG });
  assert.equal(historyLookbackDays(DEFAULT_RHYTHM_CONFIG), 11);
  assert.equal(r.windows[0].to.toISOString(), NOW.toISOString());
  assert.equal(NOW.getTime() - r.windows[0].from.getTime(), 11 * 86_400_000);
  assert.deepEqual(r.entryReads, ["w"], "only cards currently in Waiting");
  assert.equal(facts.cards.find((c) => c.id === "w")?.enteredListAt, "2026-09-01T09:00:00.000Z");
});

test("collector degrades safely: failed history → unknown history, cards still fresh; failed entry read → unknown", async () => {
  const lines: string[] = [];
  const r = reader({
    readActions: async () => {
      throw new Error("503");
    },
    readLatestListEntry: async () => {
      throw new Error("429");
    },
  });
  const facts = await createRhythmFactCollector({ reader: r, log: (line) => lines.push(line) })({ now: NOW, config: DEFAULT_RHYTHM_CONFIG });
  assert.equal(facts.cards.length, 2);
  assert.ok(facts.cards.every((c) => c.enteredListAt === null && c.reopenedFromDoneAt === null));
  assert.deepEqual(lines, ["[rhythm] history_unavailable", "[rhythm] waiting_entry_unavailable"]);
});

test("collector: a failed board/card/list read rejects (the scheduler then treats facts as unavailable)", async () => {
  for (const broken of ["resolveSingleBoard", "readOpenCards", "readLists"] as const) {
    const r = reader({ [broken]: async () => Promise.reject(new Error("401")) });
    await assert.rejects(() => createRhythmFactCollector({ reader: r })({ now: NOW, config: DEFAULT_RHYTHM_CONFIG }), /401/, broken);
  }
});

test("collector: per-card Waiting reads are bounded", async () => {
  const many = Array.from({ length: MAX_WAITING_ENTRY_READS + 5 }, (_, i) => card(`w${i}`, WAIT.id));
  const lines: string[] = [];
  const r = reader({ readOpenCards: async () => many });
  await createRhythmFactCollector({ reader: r, log: (line) => lines.push(line) })({ now: NOW, config: DEFAULT_RHYTHM_CONFIG });
  assert.equal(r.entryReads.length, MAX_WAITING_ENTRY_READS);
  assert.ok(lines.includes("[rhythm] waiting_entries_capped"));
});

test("the accepted GET-only Trello client serves the collector: GETs only, read token in the header, expected endpoints", async () => {
  const requests: Array<{ url: URL; method: string; auth: string }> = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, method: String(init?.method), auth: String((init?.headers as Record<string, string>).Authorization) });
    const path = url.pathname;
    const body =
      path === "/1/members/me/boards" ? [{ id: "b1", name: "Djonik" }]
      : path === "/1/boards/b1/cards" ? [card("w", WAIT.id)]
      : path === "/1/boards/b1/lists" ? LISTS
      : path === "/1/cards/w/actions" ? [move("w", PROG, WAIT, "2026-09-01T09:00:00.000Z")]
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = new TrelloWorkHistoryClient({ apiKey: "key", readToken: "token", fetch });
  const facts = await createRhythmFactCollector({ reader: client })({ now: NOW, config: DEFAULT_RHYTHM_CONFIG });
  assert.equal(facts.cards[0].enteredListAt, "2026-09-01T09:00:00.000Z");
  assert.ok(requests.every((r) => r.method === "GET"));
  assert.ok(requests.every((r) => r.auth.includes('oauth_token="token"') && !r.url.search.includes("token")));
  const cards = requests.find((r) => r.url.pathname === "/1/boards/b1/cards")!;
  assert.equal(cards.url.searchParams.get("filter"), "open");
  assert.equal(cards.url.searchParams.get("fields"), "id,name,idList,closed,due,dueComplete,labels");
  assert.doesNotMatch(cards.url.search, /dateLastActivity/);
  const entry = requests.find((r) => r.url.pathname === "/1/cards/w/actions")!;
  assert.equal(entry.url.searchParams.get("filter"), "updateCard:idList,createCard,copyCard,moveCardToBoard");
  assert.equal(entry.url.searchParams.get("limit"), "1");
});
