import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignalFacts } from "./rhythmFacts.js";
import { collectBoardSnapshot, daysInCurrentList, renderKyivDue, resolveSizeDefinition, sizeOf, checklistProgress,
  executeTrelloBoardSnapshot, executeTrelloBoardSnapshotFromEnvironment, type SnapshotReader } from "./trelloBoardSnapshot.js";
import { TrelloWorkHistoryClient, type TrelloAction, type TrelloBoardCard } from "./trelloWorkHistory.js";

const NOW = new Date("2026-09-28T06:30:00.000Z");
const lists = [{ id: "inbox", name: "Inbox" }, { id: "backlog", name: "Backlog" }, { id: "progress", name: "In progress" },
  { id: "waiting", name: "Waiting" }, { id: "done", name: "Done" }];
const field = [{ id: "size", name: "Size", type: "list", options: [
  { id: "small", value: { text: "S" } }, { id: "medium", value: { text: "M" } }, { id: "large", value: { text: "XL" } },
] }];
const card = (id: string, idList: string, extra: Partial<TrelloBoardCard> = {}): TrelloBoardCard => ({
  id, idList, name: `Card ${id}`, closed: false, labels: [{ name: "Seqthera" }], due: null,
  dueComplete: false, customFieldItems: [], idChecklists: [], ...extra,
});
const move = (id: string, from: string, to: string, date: string): TrelloAction => ({ type: "updateCard", date,
  data: { card: { id }, listBefore: { id: from }, listAfter: { id: to } } });
const baseCards = [
  card("a", "progress", { name: "Concept", due: "2026-09-28T21:30:00.000Z", customFieldItems: [{ idCustomField: "size", idValue: "medium" }], idChecklists: ["cl"] }),
  card("w", "waiting", { name: "Feedback", labels: [{ name: "Cossack Labs" }] }),
  card("b", "backlog"), card("i", "inbox"), card("d", "done"), card("x", "progress", { closed: true }),
];
function reader(options: { cards?: TrelloBoardCard[]; entries?: Record<string, TrelloAction | null>; checklists?: Record<string, unknown>; definitions?: unknown } = {}): SnapshotReader {
  return {
    resolveSingleBoard: async () => ({ id: "board", name: "Board" }),
    readSnapshotCards: async () => options.cards ?? baseCards,
    readLists: async () => lists,
    readCustomFieldDefinitions: async () => options.definitions ?? field,
    readLatestListEntry: async (id) => options.entries?.[id] ?? null,
    readCardChecklists: async (id) => options.checklists?.[id] ?? (id === "a" ? [{ id: "cl", checkItems: [
      { state: "complete" }, { state: "complete" }, { state: "complete" }, { state: "complete" }, { state: "incomplete" },
    ] }] : []),
  };
}

test("normal snapshot shows open active facts; Done excluded, Backlog/Inbox collapsed, rhythm agrees", async () => {
  const entries = { a: move("a", "backlog", "progress", "2026-09-24T07:00:00Z"),
    w: move("w", "done", "waiting", "2026-09-19T08:00:00Z") };
  const snapshot = await collectBoardSnapshot(reader({ entries }), {}, NOW);
  const byName = Object.fromEntries(snapshot.lists.map((list) => [list.name, list]));
  assert.equal(byName.Backlog.count, 1);
  assert.equal(byName.Backlog.cards, undefined);
  assert.equal(byName.Inbox.cards, undefined);
  assert.equal(byName.Done, undefined);
  assert.deepEqual(byName["In progress"].cards?.[0], { id: "a", name: "Concept", project: "seqthera",
    daysInList: 4, due: "вт 29.09.2026 00:30 Kyiv", dueComplete: false, size: "M", checklist: "4/5" });
  assert.equal(byName.Waiting.cards?.[0]?.daysInList, 9);
  assert.equal(byName.Waiting.cards?.[0]?.project, "cossack-labs");
  const rhythm = buildSignalFacts({ cards: baseCards, lists, history: null, latestEntries: new Map(Object.entries(entries)) });
  assert.equal(rhythm.cards.find((item) => item.id === "w")?.enteredListAt, "2026-09-19T08:00:00.000Z");
  assert.equal(rhythm.cards.find((item) => item.id === "w")?.reopenedFromDoneAt, "2026-09-19T08:00:00.000Z");
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") < 10_000);
  assert.doesNotMatch(JSON.stringify(snapshot), /lastActivityAt|checkItems|listBefore|listAfter|Card d/);
});

test("detailed mode is bounded and keeps active cards ahead of backlog", async () => {
  const many = [...baseCards, ...Array.from({ length: 50 }, (_, index) => card(`z${index}`, "backlog"))];
  const result = await collectBoardSnapshot(reader({ cards: many }), { response_format: "detailed" }, NOW);
  assert.equal(result.lists.find((list) => list.name === "Backlog")?.omitted, 14);
  assert.equal(result.lists.find((list) => list.name === "In progress")?.cards?.[0]?.id, "a");
  assert.ok(result.lists.flatMap((list) => list.cards ?? []).length <= 40);
});

test("representative 30-card planning snapshot stays below 10 KB of model-facing UTF-8", async () => {
  const cards = Array.from({ length: 30 }, (_, index) => card(`active-${index}`, index % 3 === 0 ? "waiting" : "progress", {
    name: `Representative design task ${index} · Seqthera`,
    customFieldItems: [{ idCustomField: "size", idValue: index % 2 ? "small" : "large" }],
  }));
  const snapshot = await collectBoardSnapshot(reader({ cards }), {}, NOW);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  console.log(`representative snapshot payload: ${bytes} UTF-8 bytes`);
  assert.ok(bytes < 10_000);
});

test("Size resolves list options and text/number values; true absence differs from malformed", () => {
  const list = resolveSizeDefinition(field);
  assert.equal(sizeOf([{ idCustomField: "size", idValue: "large" }], list), "XL");
  assert.equal(sizeOf([], list), "не вказано");
  assert.throws(() => sizeOf([{ idCustomField: "size", idValue: "bad" }], list));
  assert.equal(sizeOf([{ idCustomField: "size", value: { text: "S" } }], resolveSizeDefinition([{ id: "size", name: "Size", type: "text" }])), "S");
  assert.equal(sizeOf([{ idCustomField: "size", value: { number: "3" } }], resolveSizeDefinition([{ id: "size", name: "Size", type: "number" }])), "3");
});

test("checklist counts complete state, including all complete; empty list differs from failure", () => {
  assert.equal(checklistProgress([{ id: "c", checkItems: [{ state: "complete" }, { state: "complete" }] }], ["c"]), "2/2");
  assert.equal(checklistProgress([], []), "немає");
  assert.throws(() => checklistProgress([], ["c"]));
  assert.throws(() => checklistProgress([{ id: "c", checkItems: [{ state: "unknown" }] }], ["c"]));
});

test("Kyiv due and list age use calendar days across DST, never last activity", () => {
  assert.equal(renderKyivDue("2026-03-29T00:30:00Z"), "нд 29.03.2026 02:30 Kyiv");
  assert.equal(renderKyivDue("2026-03-29T01:30:00Z"), "нд 29.03.2026 04:30 Kyiv");
  assert.equal(renderKyivDue(null), "не вказано");
  assert.throws(() => renderKyivDue("2026-09-29"), "a date without an authoritative instant is not a Kyiv due");
  assert.equal(daysInCurrentList("2026-03-28T22:30:00Z", new Date("2026-03-29T22:30:00Z")), 1);
  assert.equal(daysInCurrentList(null, NOW), "невідомо");
  assert.equal(daysInCurrentList("2026-09-29T00:00:00Z", NOW), "невідомо");
});

test("partial or ambiguous reads fail instead of fabricating absent facts", async () => {
  await assert.rejects(collectBoardSnapshot(reader({ definitions: [...field, ...field] }), {}, NOW));
  await assert.rejects(collectBoardSnapshot(reader({ cards: [card("bad", "progress", { customFieldItems: undefined })] }), {}, NOW));
  await assert.rejects(collectBoardSnapshot(reader({ cards: [card("bad", "progress", { due: undefined })] }), {}, NOW));
  await assert.rejects(collectBoardSnapshot(reader({ cards: [card("bad", "progress", { labels: [{ name: "A" }, { name: "B" }] })] }), {}, NOW));
  await assert.rejects(collectBoardSnapshot(reader({ checklists: { a: [] } }), {}, NOW));
  await assert.rejects(collectBoardSnapshot({ ...reader(), readCardChecklists: async () => { throw new Error("private credential and raw HTTP body"); } }, {}, NOW));
  await assert.rejects(collectBoardSnapshot({ ...reader(), readSnapshotCards: async () => { throw new Error("partial board read"); } }, {}, NOW));
  await assert.rejects(collectBoardSnapshot(reader({ entries: { a: { type: "updateCard", date: "bad", data: { card: { id: "a" } } } } }), {}, NOW));
  const noEntry = await collectBoardSnapshot(reader(), {}, NOW);
  assert.equal(noEntry.lists.find((list) => list.name === "Waiting")?.cards?.[0]?.daysInList, "невідомо");
});

test("REST source fetches use only GET with authorization header; environment errors are bounded", async () => {
  const methods: string[] = [];
  const client = new TrelloWorkHistoryClient({ apiKey: "secret-key", readToken: "secret-token", fetch: async (url, init) => {
    methods.push(init?.method ?? "");
    assert.ok(!url.includes("secret"));
    assert.match(String((init?.headers as Record<string, string>)?.Authorization), /OAuth/);
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(path.includes("customFields") ? field : path.includes("checklists") ? [] : []), { status: 200 });
  } });
  await client.readSnapshotCards("b"); await client.readCustomFieldDefinitions("b"); await client.readCardChecklists("c");
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
  const failure = await executeTrelloBoardSnapshotFromEnvironment({ bad: true });
  assert.equal(failure.isError, true);
  assert.doesNotMatch(failure.content, /secret|https|Authorization/);
  const requestFailure = await executeTrelloBoardSnapshot({}, { ...reader(), readSnapshotCards: async () => { throw new Error("secret raw HTTP response"); } }, NOW);
  assert.equal(requestFailure.isError, true);
  assert.doesNotMatch(requestFailure.content, /secret|raw HTTP/);
});

test("eval snapshot reader pins the dedicated board through a separate read-token client", async () => {
  const boardId = "a".repeat(24);
  const paths: string[] = [];
  const client = new TrelloWorkHistoryClient({ boardId, apiKey: "eval-key", readToken: "eval-read-token",
    fetch: async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.ok(!url.includes("eval-read-token"));
      paths.push(new URL(url).pathname);
      return new Response(JSON.stringify({ id: boardId, name: "Djonik Eval", closed: false }), { status: 200 });
    } });
  assert.deepEqual(await client.resolveSingleBoard(), { id: boardId, name: "Djonik Eval" });
  assert.deepEqual(paths, [`/1/boards/${boardId}`]);
  assert.throws(() => new TrelloWorkHistoryClient({ boardId: "production?", apiKey: "k", readToken: "t" }));
});
