import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TrelloWorkHistoryClient,
  TrelloWorkHistoryError,
  buildWorkHistoryDigest,
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

test("#36 collapses rapid moves, preserves reopen/re-Done, isolates current project labels and suppresses create+archive noise", () => {
  const digest = buildWorkHistoryDigest(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    history,
    cards,
    { pagesRead: 2, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.deepEqual(digest.counts, { reached_done: 2, returned_from_done: 1, created: 0, archived: 0, moved: 0 });
  assert.equal(digest.reached_done?.length, 1, "one net card item despite two Done entries");
  assert.equal(digest.reached_done?.[0].occurrences, 2);
  assert.equal(digest.reached_done?.[0].transition, "In progress → Done");
  assert.equal(digest.returned_from_done?.[0].card, "Анонімна картка");
  assert.equal(digest.reached_done?.[0].due, "пт 27.03, 18:00");
  assert.equal(digest.coverage.pagesRead, 2);
  assert.doesNotMatch(JSON.stringify(digest), /card_extract|lastActivityAt|""/);
  const board = buildWorkHistoryDigest({ window: { kind: "this_week" }, scope: { kind: "board" } }, history, cards, { pagesRead: 1, truncated: false, oldestActionReached: true }, NOW);
  assert.equal(board.counts.reached_done, 3, "whole-board scope includes the other labelled card");
});

test("#36 concise digest limits each named category to five items and formats Kyiv actions", () => {
  const manyCards = Array.from({ length: 6 }, (_, index) => ({ id: `id_${index}`, name: `Картка ${index}`, labels: [{ name: "Extract" }] }));
  const manyActions = manyCards.map((card, index) => action(`a_${index}`, `2026-03-23T0${index}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }));
  const digest = buildWorkHistoryDigest({ window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } }, manyActions, manyCards, { pagesRead: 1, truncated: true, oldestActionReached: false }, NOW);
  assert.equal(digest.counts.reached_done, 6);
  assert.equal(digest.reached_done?.length, 5);
  assert.equal(digest.coverage.truncated, true);
  assert.equal(formatKyivDateTime("2026-03-23T08:00:00Z"), "пн 23.03, 10:00");
});

test("#36 reports ordinary creation and archival independently when they are not same-window noise", () => {
  const createdCard = { id: "created", name: "Нова картка", labels: [{ name: "Extract" }] };
  const archivedCard = { id: "archived", name: "Архівна картка", labels: [{ name: "Extract" }] };
  const digest = buildWorkHistoryDigest(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    [
      action("created", "2026-03-23T08:00:00Z", "createCard", { card: createdCard }),
      action("archived", "2026-03-23T09:00:00Z", "updateCard", { card: { ...archivedCard, closed: true }, old: { closed: false } }),
    ],
    [createdCard, archivedCard],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(digest.counts.created, 1);
  assert.equal(digest.counts.archived, 1);
  assert.equal(digest.created?.[0].card, "Нова картка");
  assert.equal(digest.archived?.[0].card, "Архівна картка");
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
