import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TrelloWorkHistoryClient,
  TrelloWorkHistoryError,
  buildWorkHistoryAnswer,
  buildWorkHistoryCategories,
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
  // buildWorkHistoryCategories is the pre-#36-fix, arithmetic-only intermediate shape. It is never
  // sent to the model (docs/28, docs/29), but stays useful here to test counting independently of
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

test("#36 concise answer_text is one already-complete Ukrainian review: combined totals, named completions, no raw IDs, no lastActivityAt, no actor claim", () => {
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } },
    history,
    cards,
    { pagesRead: 2, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(
    answer.answer_text,
    "Цього тижня по Extract на дошці в Done перейшло 2 події та 1 подія повернулося з Done. " +
      "У Done перейшла «Анонімна картка». " +
      "Із Done повернулася «Анонімна картка».",
  );
  assert.doesNotMatch(answer.answer_text, /card_extract|lastActivityAt|ти зробив|daniel/i);
  const board = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" } }, history, cards, { pagesRead: 1, truncated: false, oldestActionReached: true }, NOW);
  assert.match(board.answer_text, /в Done перейшло 3 події/, "whole-board scope includes the other labelled card in the combined opening sentence");
});

test("#36 detailed answer_text names every item and never emits an omitted-example sentence", () => {
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    history,
    cards,
    { pagesRead: 2, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(
    answer.answer_text,
    "У Done перейшло 2 події. У Done перейшла «Анонімна картка» — пн 23.03, 13:00 (2 рази), due пт 27.03, 18:00. " +
      "Із Done повернулося 1 подія. Із Done повернулася «Анонімна картка» — пн 23.03, 11:00, due пт 27.03, 18:00.",
  );
});

test("#36 concise answer_text limits named completions to five, folds the omitted count into the same sentence, and flags incomplete coverage", () => {
  const manyCards = Array.from({ length: 6 }, (_, index) => ({ id: `id_${index}`, name: `Картка ${index}`, labels: [{ name: "Extract" }] }));
  const manyActions = manyCards.map((card, index) => action(`a_${index}`, `2026-03-23T0${index}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }));
  const answer = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } }, manyActions, manyCards, { pagesRead: 1, truncated: true, oldestActionReached: false }, NOW);
  assert.equal(
    answer.answer_text,
    "Цього тижня по Extract на дошці в Done перейшло 6 подій. " +
      "У Done перейшли «Картка 0», «Картка 1», «Картка 2», «Картка 3» та «Картка 4» (ще 1). " +
      "Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю.",
  );
  assert.equal(formatKyivDateTime("2026-03-23T08:00:00Z"), "пн 23.03, 10:00");
});

test("#36 fixture A (first live failure): a concise board-noise moved total never leaks into a named sentence and states 7, not 5", () => {
  // Reproduces docs/27's first live failure: Haiku answered "5 moved" when the deterministic
  // count was 7. `moved` cards are never individually named in a concise answer (docs/29), so
  // there is no shown-subset number anywhere near the authoritative total for Claude to substitute.
  const movedCards = Array.from({ length: 7 }, (_, index) => ({ id: `moved_${index}`, name: `Рух ${index + 1}`, labels: [{ name: "Extract" }] }));
  const movedActions = movedCards.map((card, index) =>
    action(`move_${index}`, `2026-03-23T${String(index + 1).padStart(2, "0")}:00:00Z`, "updateCard", {
      card,
      listBefore: { name: "Backlog" },
      listAfter: { name: "This week" },
    }),
  );
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    movedActions,
    movedCards,
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(answer.answer_text, "Цього тижня по Extract на дошці ще 7 карток перемістилися між іншими списками.");
  assert.doesNotMatch(answer.answer_text, /«Рух|moved_\d|lastActivityAt|5 карт/);
});

test("#36 fixture B (second live failure): reached-Done and created totals stay authoritative and created cards are never individually named", () => {
  // Reproduces docs/27's second live failure: with reached_done=4 and created=6 (5 shown), Haiku
  // answered "3 completed" and "5 created" — treating a displayed/selected subset as the total.
  const reachedDoneCards = Array.from({ length: 4 }, (_, index) => ({ id: `rd_${index}`, name: `Завершення ${index + 1}`, labels: [{ name: "Extract" }] }));
  const reachedDoneActions = reachedDoneCards.map((card, index) =>
    action(`rd_action_${index}`, `2026-03-16T0${index + 1}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }),
  );
  const createdCards = Array.from({ length: 6 }, (_, index) => ({ id: `cr_${index}`, name: `Нова картка ${index + 1}`, labels: [{ name: "Extract" }] }));
  const createdActions = createdCards.map((card, index) => action(`cr_action_${index}`, `2026-03-17T0${index + 1}:00:00Z`, "createCard", { card }));

  const answer = buildWorkHistoryAnswer(
    { window: { kind: "explicit", from: "2026-03-14", to: "2026-03-21" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    [...reachedDoneActions, ...createdActions],
    [...reachedDoneCards, ...createdCards],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );

  assert.match(answer.answer_text, /в Done перейшло 4 поді[їй]/, "reached-Done total is stated exactly, with no lower substitute total");
  assert.match(answer.answer_text, /створено 6 карток/, "created total is stated exactly, not the five internally shown");
  assert.match(answer.answer_text, /перейшли «Завершення 1», «Завершення 2», «Завершення 3» та «Завершення 4»/, "all four reached-Done examples are named because the concise limit (5) is not exceeded");
  assert.doesNotMatch(answer.answer_text, /Нова картка/, "created cards are never individually named in a concise answer");
  assert.match(answer.answer_text, /не всі створені картки/, "the caveat says created cards were not individually listed");
  assert.doesNotMatch(answer.answer_text, /\b5\b.*created|created.*\b5\b/i);
});

test("#36 exact third live diagnostic fixture (docs/27 §12): every requirement from the fact-skeleton-compression remediation", () => {
  // Reproduces the exact facts behind docs/27 §12's fact-skeleton candidate FAIL: correct totals
  // (4/2/6/5) were narrated, but Haiku still misdescribed «Міні-парфуми адаптація» as created,
  // claimed an unsupported "majority Backlog → This week/In progress" direction contradicted by
  // «Брендбук» (This week → Backlog), invented "потребували правок", and added productivity framing.
  const doneCards = [
    { id: "kohaiu", name: "Кохаю пінка", labels: [{ name: "Extract" }] },
    { id: "bili3d", name: "Білі аромати 3D відео", labels: [{ name: "Extract" }] },
    { id: "avtorender", name: "Автоматизація рендеру", labels: [{ name: "Extract" }] },
    { id: "komentari", name: "Коментарі по пінкам", labels: [{ name: "Extract" }] },
  ];
  const createdOnlyCards = [
    { id: "bili50", name: "Білі аромати 50 ML", labels: [{ name: "Extract" }] },
    { id: "chorni100", name: "Чорні аромати 100 ML", labels: [{ name: "Extract" }] },
    { id: "flakony75", name: "Флакони 7.5 ML", labels: [{ name: "Extract" }] },
    { id: "flakony15", name: "Флакони 1.5 ML", labels: [{ name: "Extract" }] },
  ];
  const movedOnlyCards = [
    { id: "adaptatsiya", name: "Міні-парфуми адаптація", labels: [{ name: "Extract" }] },
    { id: "brendbuk", name: "Брендбук", labels: [{ name: "Extract" }] },
    { id: "moved_extra_1", name: "Рух 1", labels: [{ name: "Extract" }] },
    { id: "moved_extra_2", name: "Рух 2", labels: [{ name: "Extract" }] },
    { id: "moved_extra_3", name: "Рух 3", labels: [{ name: "Extract" }] },
  ];
  const allCards = [...doneCards, ...createdOnlyCards, ...movedOnlyCards];

  const actions: TrelloAction[] = [
    ...doneCards.map((card, i) => action(`done_${i}`, `2026-03-16T0${i + 1}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } })),
    // Two of the four Done cards also returned from Done earlier in the window (reopen).
    action("return_0", "2026-03-16T00:30:00Z", "updateCard", { card: doneCards[0], listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
    action("return_1", "2026-03-16T00:45:00Z", "updateCard", { card: doneCards[1], listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
    // Six created cards this window: 4 done cards plus 2 created-only cards.
    ...[...doneCards.slice(0, 2), ...createdOnlyCards].map((card, i) => action(`create_${i}`, `2026-03-14T0${i + 1}:00:00Z`, "createCard", { card })),
    // Five dedicated moved (non-Done, non-created-this-window) cards, including one that moved
    // BACKWARD (This week → Backlog) — the direction a live candidate wrongly generalized about.
    action("move_0", "2026-03-14T05:00:00Z", "updateCard", { card: movedOnlyCards[0], listBefore: { name: "Backlog" }, listAfter: { name: "This week" } }),
    action("move_1", "2026-03-14T06:00:00Z", "updateCard", { card: movedOnlyCards[1], listBefore: { name: "This week" }, listAfter: { name: "Backlog" } }),
    action("move_2", "2026-03-14T07:00:00Z", "updateCard", { card: movedOnlyCards[2], listBefore: { name: "Backlog" }, listAfter: { name: "In progress" } }),
    action("move_3", "2026-03-14T08:00:00Z", "updateCard", { card: movedOnlyCards[3], listBefore: { name: "Backlog" }, listAfter: { name: "This week" } }),
    action("move_4", "2026-03-14T09:00:00Z", "updateCard", { card: movedOnlyCards[4], listBefore: { name: "This week" }, listAfter: { name: "In progress" } }),
  ];

  const answer = buildWorkHistoryAnswer(
    { window: { kind: "explicit", from: "2026-03-14", to: "2026-03-21" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    actions,
    allCards,
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );

  // 1-4: every authoritative total is stated correctly.
  assert.match(answer.answer_text, /в Done перейшло 4 поді[їй]/, "4 reached-Done events");
  assert.match(answer.answer_text, /2 поді[їй] повернулося з Done/, "2 returned-from-Done events");
  assert.match(answer.answer_text, /створено 6 карток/, "6 created cards");
  assert.match(answer.answer_text, /5 карток перемістилися між іншими списками/, "5 moved cards");
  // 5: the moved card "Міні-парфуми адаптація" never appears anywhere, so it cannot be misdescribed as created.
  assert.doesNotMatch(answer.answer_text, /адаптація/i);
  // 6/7: no direction/majority claim, so «Брендбук»'s real (backward) direction cannot be contradicted.
  assert.doesNotMatch(answer.answer_text, /більшість|напрям|Backlog\s*→|Брендбук/i);
  // 8: no invented reason for the Done-returns.
  assert.doesNotMatch(answer.answer_text, /правок|доробк/i);
  // 9: no productivity/trend framing.
  assert.doesNotMatch(answer.answer_text, /активн|ресурс|продуктивн/i);
  // 10: stays within the intended short-answer sentence budget.
  const sentenceCount = answer.answer_text.split(". ").length;
  assert.ok(sentenceCount <= 4, `expected <=4 sentences, got ${sentenceCount}: ${answer.answer_text}`);
});

test("#36 reports ordinary creation and archival independently when they are not same-window noise", () => {
  const createdCard = { id: "created", name: "Нова картка", labels: [{ name: "Extract" }] };
  const archivedCard = { id: "archived", name: "Архівна картка", labels: [{ name: "Extract" }] };
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" }, response_format: "detailed" },
    [
      action("created", "2026-03-23T08:00:00Z", "createCard", { card: createdCard }),
      action("archived", "2026-03-23T09:00:00Z", "updateCard", { card: { ...archivedCard, closed: true }, old: { closed: false } }),
    ],
    [createdCard, archivedCard],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(
    answer.answer_text,
    "Створено 1 картка. Створено «Нова картка» — пн 23.03, 10:00. Архівовано 1 картка. Архівовано «Архівна картка» — пн 23.03, 11:00.",
  );
});

test("#36 create+archive noise within the same window is suppressed cleanly and an inactive project reports zero categories without arithmetic", () => {
  const noiseCard = { id: "noise", name: "Тестовий шум", closed: true, labels: [{ name: "Extract" }] };
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } },
    [
      action("n1", "2026-03-23T07:00:00Z", "createCard", { card: noiseCard }),
      action("n2", "2026-03-23T12:00:00Z", "updateCard", { card: noiseCard, old: { closed: false } }),
    ],
    [noiseCard],
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(answer.answer_text, "За цей період суттєвих змін не зафіксовано.");
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
