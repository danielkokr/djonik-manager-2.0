import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TrelloWorkHistoryClient,
  TrelloWorkHistoryError,
  buildWorkHistoryCategories,
  buildWorkHistoryFactSkeleton,
  executeTrelloWorkHistoryFromEnvironment,
  formatKyivDateTime,
  resolveHistoryWindow,
  type TrelloAction,
  type TrelloHistoryCard,
} from "./trelloWorkHistory.js";

const NOW = new Date("2026-03-25T12:00:00Z");
const cards: TrelloHistoryCard[] = [
  { id: "card_extract", name: "Анонімна картка", idList: "list_done", due: "2026-03-27T16:00:00Z", labels: [{ name: "Extract" }] },
  { id: "card_other", name: "Інший проєкт", idList: "list_done", labels: [{ name: "Limen" }] },
  { id: "card_noise", name: "Тестовий шум", idList: "list_archived", closed: true, labels: [{ name: "Extract" }] },
];

function action(id: string, date: string, type: string, data: TrelloAction["data"]): TrelloAction {
  return { id, date, type, data };
}

const history: TrelloAction[] = [
  // Done → reopen → Done must retain both categories while exposing one card per category.
  action("a1", "2026-03-23T08:00:00Z", "updateCard", { card: { id: "card_extract", name: "stale" }, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }),
  action("a2", "2026-03-23T09:00:00Z", "updateCard", { card: { id: "card_extract", name: "stale" }, listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
  action("a3", "2026-03-23T10:00:00Z", "updateCard", { card: { id: "card_extract", name: "stale" }, listBefore: { name: "In progress" }, listAfter: { name: "This week" } }),
  action("a4", "2026-03-23T11:00:00Z", "updateCard", { card: { id: "card_extract", name: "stale" }, listBefore: { name: "This week" }, listAfter: { name: "Done" } }),
  action("other", "2026-03-23T11:00:00Z", "updateCard", { card: { id: "card_other", name: "Інший проєкт" }, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }),
  action("n1", "2026-03-23T07:00:00Z", "createCard", { card: { id: "card_noise", name: "Тестовий шум" } }),
  action("n2", "2026-03-23T12:00:00Z", "updateCard", { card: { id: "card_noise", name: "Тестовий шум", closed: true }, old: { closed: false } }),
];

test("#36 resolves Kyiv Monday week boundaries, last week and the DST change without a fixed offset", () => {
  const thisWeek = resolveHistoryWindow({ kind: "this_week" }, NOW);
  assert.equal(thisWeek.from.toISOString(), "2026-03-22T22:00:00.000Z");
  assert.equal(thisWeek.to.toISOString(), NOW.toISOString());
  const lastWeek = resolveHistoryWindow({ kind: "last_week" }, NOW);
  assert.equal(lastWeek.from.toISOString(), "2026-03-15T22:00:00.000Z");
  assert.equal(lastWeek.to.toISOString(), "2026-03-22T22:00:00.000Z");
  // Kyiv switches to UTC+3 on 29 March 2026; Monday 30th is 21:00Z, not 22:00Z.
  assert.equal(resolveHistoryWindow({ kind: "this_week" }, new Date("2026-04-01T12:00:00Z")).from.toISOString(), "2026-03-29T21:00:00.000Z");
  const explicit = resolveHistoryWindow({ kind: "explicit", from: "2026-03-23", to: "2026-03-24" });
  assert.equal(explicit.from.toISOString(), "2026-03-22T22:00:00.000Z");
  assert.equal(explicit.to.toISOString(), "2026-03-23T22:00:00.000Z");
});

test("#36 internal categories (debug/test-only) still count occurrences vs cards correctly and isolate current project labels", () => {
  // buildWorkHistoryCategories is the pre-#36-fix, arithmetic-only intermediate shape. It is no
  // longer sent to the model (docs/28), but stays useful here to test counting independently of
  // sentence rendering.
  const categories = buildWorkHistoryCategories({ window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" }, history, cards, NOW);
  assert.equal(categories.reached_done?.total, 2, "reached-Done total counts event occurrences, not net cards");
  assert.equal(categories.reached_done?.items.length, 1, "one net card item represents two Done entries");
  assert.equal(categories.reached_done?.items[0].occurrences, 2);
  assert.equal(categories.reached_done?.items[0].transition, "In progress → Done");
  assert.equal(categories.returned_from_done?.total, 1);
  assert.equal(categories.returned_from_done?.items[0].card, "Анонімна картка");
  assert.equal(categories.reached_done?.items[0].due, "пт 27.03, 18:00");
  const board = buildWorkHistoryCategories({ window: { kind: "this_week" }, scope: { kind: "board" } }, history, cards, NOW);
  assert.equal(board.reached_done?.total, 3, "whole-board scope includes the other labelled card");
});

test("#36 fact skeleton renders reopen/re-Done as already-computed Ukrainian sentences with no raw IDs, no lastActivityAt, and no actor claim", () => {
  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    history,
    cards,
    { pagesRead: 2, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.deepEqual(skeleton.fact_lines, [
    "У Done перейшло 2 події.",
    "У Done перейшла «Анонімна картка» — пн 23.03, 13:00 (2 рази), due пт 27.03, 18:00.",
    "Із Done повернулося 1 подія.",
    "Із Done повернулася «Анонімна картка» — пн 23.03, 11:00, due пт 27.03, 18:00.",
  ]);
  const joined = skeleton.fact_lines.join(" ");
  assert.doesNotMatch(joined, /card_extract|lastActivityAt|ти зробив|daniel/i);
  const board = buildWorkHistoryFactSkeleton({ window: { kind: "this_week" }, scope: { kind: "board" } }, history, cards, { pagesRead: 1, truncated: false, oldestActionReached: true }, NOW);
  assert.ok(board.fact_lines.includes("У Done перейшло 3 події."), "whole-board scope includes the other labelled card in its own authoritative total sentence");
});

test("#36 concise fact skeleton limits named examples to five, states the omitted count as its own sentence, and flags incomplete coverage", () => {
  const manyCards = Array.from({ length: 6 }, (_, index) => ({ id: `id_${index}`, name: `Картка ${index}`, labels: [{ name: "Extract" }] }));
  const manyActions = manyCards.map((card, index) => action(`a_${index}`, `2026-03-23T0${index}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }));
  const skeleton = buildWorkHistoryFactSkeleton({ window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } }, manyActions, manyCards, { pagesRead: 1, truncated: true, oldestActionReached: false }, NOW);
  assert.deepEqual(skeleton.fact_lines, [
    "У Done перейшло 6 подій.",
    "У Done перейшла «Картка 0» — пн 23.03, 02:00.",
    "У Done перейшла «Картка 1» — пн 23.03, 03:00.",
    "У Done перейшла «Картка 2» — пн 23.03, 04:00.",
    "У Done перейшла «Картка 3» — пн 23.03, 05:00.",
    "У Done перейшла «Картка 4» — пн 23.03, 06:00.",
    "Ще 1 подія не перелічена в короткому огляді.",
    "Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю.",
  ]);
  assert.equal(formatKyivDateTime("2026-03-23T08:00:00Z"), "пн 23.03, 10:00");
});

test("#36 fixture A (first live failure): a concise project skeleton makes 7 moved cards and 5 named examples factually unambiguous", () => {
  // Reproduces docs/27's first live failure: Haiku answered "5 moved" when the deterministic
  // count was 7, because 7 and 5 were both present as competing numbers (`counts.moved` vs an
  // `items` array of length 5). The fact skeleton must never emit that second number as a count.
  const movedCards = Array.from({ length: 7 }, (_, index) => ({ id: `moved_${index}`, name: `Рух ${index + 1}`, labels: [{ name: "Extract" }] }));
  const movedActions = movedCards.map((card, index) =>
    action(`move_${index}`, `2026-03-23T${String(index + 1).padStart(2, "0")}:00:00Z`, "updateCard", {
      card,
      listBefore: { name: "Backlog" },
      listAfter: { name: "This week" },
    }),
  );
  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    movedActions,
    movedCards,
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(skeleton.fact_lines[0], "Між іншими списками переміщено 7 карток.", "the total sentence states 7, not the shown subset");
  assert.equal(skeleton.fact_lines.filter((line) => line.startsWith("«Рух")).length, 5, "at most five named examples appear");
  assert.equal(skeleton.fact_lines.at(-1), "Ще 2 переміщення не перелічені в короткому огляді.", "the omitted amount is its own factual sentence, not something to subtract");
  assert.doesNotMatch(skeleton.fact_lines.join(" "), /moved_\d|lastActivityAt/);
});

test("#36 fixture B (second live failure): reached-Done and created totals stay authoritative even when created is truncated to five examples", () => {
  // Reproduces docs/27's second live failure: with reached_done.total=4 and
  // created.total=6/shown=5/omitted=1, Haiku answered "3 completed" and "5 created", again
  // treating a displayed/selected subset as the authoritative count.
  const reachedDoneCards = Array.from({ length: 4 }, (_, index) => ({ id: `rd_${index}`, name: `Завершення ${index + 1}`, labels: [{ name: "Extract" }] }));
  const reachedDoneActions = reachedDoneCards.map((card, index) =>
    action(`rd_action_${index}`, `2026-03-16T0${index + 1}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }),
  );
  const createdCards = Array.from({ length: 6 }, (_, index) => ({ id: `cr_${index}`, name: `Нова картка ${index + 1}`, labels: [{ name: "Extract" }] }));
  const createdActions = createdCards.map((card, index) => action(`cr_action_${index}`, `2026-03-17T0${index + 1}:00:00Z`, "createCard", { card }));

  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "explicit", from: "2026-03-14", to: "2026-03-21" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    [...reachedDoneActions, ...createdActions],
    [...reachedDoneCards, ...createdCards],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );

  assert.ok(skeleton.fact_lines.includes("У Done перейшло 4 події."), "reached-Done total is stated exactly, with no lower substitute total");
  assert.ok(skeleton.fact_lines.includes("Створено 6 карток."), "created total is stated exactly, not the five shown");
  assert.ok(skeleton.fact_lines.includes("Ще 1 картка не перелічена в короткому огляді."), "the one omitted created card is its own factual sentence");
  assert.equal(skeleton.fact_lines.filter((line) => line.startsWith("У Done перейшла")).length, 4, "all four reached-Done examples are named because the concise limit (5) is not exceeded");
  assert.equal(skeleton.fact_lines.filter((line) => line.startsWith("Створено «")).length, 5, "created examples are capped at five even though six cards were created");
});

test("#36 detailed fact skeleton names every item and never emits an omitted-example sentence", () => {
  const manyCards = Array.from({ length: 6 }, (_, index) => ({ id: `detail_${index}`, name: `Деталь ${index}`, labels: [{ name: "Extract" }] }));
  const manyActions = manyCards.map((card, index) =>
    action(`detail_action_${index}`, `2026-03-23T${String(index + 1).padStart(2, "0")}:00:00Z`, "updateCard", {
      card,
      listBefore: { name: "Backlog" },
      listAfter: { name: "This week" },
    }),
  );
  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    manyActions,
    manyCards,
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(skeleton.fact_lines[0], "Між іншими списками переміщено 6 карток.");
  assert.equal(skeleton.fact_lines.filter((line) => line.startsWith("«Деталь")).length, 6);
  assert.ok(!skeleton.fact_lines.some((line) => line.startsWith("Ще ")), "detailed mode names every item, so there is nothing left to omit");
});

test("#36 reports ordinary creation and archival independently when they are not same-window noise", () => {
  const createdCard = { id: "created", name: "Нова картка", labels: [{ name: "Extract" }] };
  const archivedCard = { id: "archived", name: "Архівна картка", labels: [{ name: "Extract" }] };
  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    [
      action("created", "2026-03-23T08:00:00Z", "createCard", { card: createdCard }),
      action("archived", "2026-03-23T09:00:00Z", "updateCard", { card: { ...archivedCard, closed: true }, old: { closed: false } }),
    ],
    [createdCard, archivedCard],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.deepEqual(skeleton.fact_lines, [
    "Створено 1 картка.",
    "Створено «Нова картка» — пн 23.03, 10:00.",
    "Архівовано 1 картка.",
    "Архівовано «Архівна картка» — пн 23.03, 11:00.",
  ]);
});

test("#36 create+archive noise within the same window is suppressed cleanly and an inactive project reports zero categories without arithmetic", () => {
  const noiseCard = { id: "noise", name: "Тестовий шум", closed: true, labels: [{ name: "Extract" }] };
  const skeleton = buildWorkHistoryFactSkeleton(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } },
    [
      action("n1", "2026-03-23T07:00:00Z", "createCard", { card: noiseCard }),
      action("n2", "2026-03-23T12:00:00Z", "updateCard", { card: noiseCard, old: { closed: false } }),
    ],
    [noiseCard],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.deepEqual(skeleton.fact_lines, ["За цей період суттєвих змін не зафіксовано."]);
});

test("#36 read-only REST paging uses since/before and reports coverage without credentials in requests or errors", async () => {
  const seen: Array<{ url: URL; init?: RequestInit }> = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => action(`p_${index}`, `2026-03-23T${String(23 - Math.floor(index / 50)).padStart(2, "0")}:00:00Z`, "updateCard", { card: { id: "card_extract", name: "A" } }));
  const client = new TrelloWorkHistoryClient({
    apiKey: "key_should_not_leak",
    readToken: "token_should_not_leak",
    fetch: async (url, init) => {
      const parsed = new URL(url);
      seen.push({ url: parsed, init });
      if (parsed.pathname.endsWith("/boards")) return Response.json([{ id: "board_1", name: "Djonik" }]);
      if (parsed.pathname.endsWith("/cards/all")) return Response.json(cards);
      return Response.json(seen.filter((entry) => entry.url.pathname.endsWith("/actions")).length === 1 ? firstPage : []);
    },
  });
  const result = await client.execute({ window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } }, NOW);
  assert.equal(result.coverage.pagesRead, 1);
  assert.equal(result.coverage.oldestActionReached, true);
  const actionRequests = seen.filter((entry) => entry.url.pathname.endsWith("/actions"));
  assert.equal(actionRequests.length, 2);
  assert.ok(actionRequests[0].url.searchParams.has("since"));
  assert.ok(actionRequests[0].url.searchParams.has("before"));
  assert.equal(actionRequests[0].url.searchParams.has("key"), false);
  assert.equal(actionRequests[0].url.searchParams.has("token"), false);
  assert.equal((actionRequests[0].init?.headers as Record<string, string>).Authorization.startsWith("OAuth "), true);
});

test("#36 turns missing and expired read credentials into safe tool errors with no secret leakage", async () => {
  assert.throws(() => new TrelloWorkHistoryClient({}), (error: unknown) => error instanceof TrelloWorkHistoryError && error.code === "credentials_missing");
  assert.throws(() => new TrelloWorkHistoryClient({ apiKey: "only-key" }), (error: unknown) => error instanceof TrelloWorkHistoryError && error.code === "credentials_missing");
  assert.throws(() => new TrelloWorkHistoryClient({ readToken: "only-token" }), (error: unknown) => error instanceof TrelloWorkHistoryError && error.code === "credentials_missing");
  const client = new TrelloWorkHistoryClient({ apiKey: "private-key", readToken: "private-token", fetch: async () => new Response("no", { status: 401 }) });
  await assert.rejects(client.resolveSingleBoard(), (error: unknown) => {
    assert.ok(error instanceof TrelloWorkHistoryError);
    assert.equal(error.code, "unauthorized");
    assert.doesNotMatch(error.message, /private-(key|token)/);
    return true;
  });
  const safe = await executeTrelloWorkHistoryFromEnvironment({ nope: true });
  assert.equal(safe.isError, true);
  assert.doesNotMatch(safe.content, /TRELLO_API_KEY|token/i);
});
