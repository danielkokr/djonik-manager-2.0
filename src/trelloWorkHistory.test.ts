import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRELLO_WORK_HISTORY_TOOL,
  TRELLO_WORK_HISTORY_TOOL_NEXT,
  TrelloWorkHistoryClient,
  TrelloWorkHistoryError,
  asksForDetailedHistory,
  buildWorkHistoryAnswer,
  buildWorkHistoryCategories,
  executeTrelloWorkHistory,
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

test("#36 concise answer_text is the structured Variant B report: project heading, bold bullet labels, named completions, no raw IDs, no lastActivityAt, no actor claim", () => {
  const answer = buildWorkHistoryAnswer(
    { window: { kind: "this_week" }, scope: { kind: "project", label: "Extract" } },
    history,
    cards,
    { pagesRead: 2, truncated: false, oldestActionReached: true },
    NOW,
  );
  assert.equal(
    answer.answer_text,
    "Цього тижня по Extract:\n\n" +
      "- **Перейшло в Done:** 2 — «Анонімна картка»\n" +
      "- **Повернулось з Done:** 1 — «Анонімна картка»",
  );
  assert.doesNotMatch(answer.answer_text, /card_extract|lastActivityAt|ти зробив|daniel/i);
});

test("#36 Variant B board-scope heading says «на дошці», never a project name that was not requested", () => {
  const board = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" } }, history, cards, { pagesRead: 1, truncated: false, oldestActionReached: true }, NOW);
  assert.ok(board.answer_text.startsWith("Цього тижня на дошці:\n"), board.answer_text);
  assert.match(board.answer_text, /\*\*Перейшло в Done:\*\* 3 —/, "whole-board scope includes the other labelled card in the Done bullet's total");
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

// #66: the five-name cut is the BOARD overview's; a project overview names its cards (see the #66 tests below).
test("#36 concise Variant B limits named completions to five, folds the omitted count into the same bullet, and shows a coverage warning ONLY for a real truncated/partial retrieval", () => {
  const manyCards = Array.from({ length: 6 }, (_, index) => ({ id: `id_${index}`, name: `Картка ${index}`, labels: [{ name: "Extract" }] }));
  const manyActions = manyCards.map((card, index) => action(`a_${index}`, `2026-03-23T0${index}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }));
  const answer = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" } }, manyActions, manyCards, { pagesRead: 1, truncated: true, oldestActionReached: false }, NOW);
  assert.equal(
    answer.answer_text,
    "Цього тижня на дошці:\n\n" +
      "- **Перейшло в Done:** 6 — «Картка 0», «Картка 1», «Картка 2», «Картка 3» та «Картка 4» (ще 1)\n\n" +
      "Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю.",
  );
  assert.equal(formatKyivDateTime("2026-03-23T08:00:00Z"), "пн 23.03, 10:00");

  // The same 6-card shape with COMPLETE coverage must never show that warning — concise mode's
  // ordinary 5-item example cap is not a data-coverage limitation (requirement #9).
  const complete = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" } }, manyActions, manyCards, { pagesRead: 1, truncated: false, oldestActionReached: true }, NOW);
  assert.doesNotMatch(complete.answer_text, /може бути неповною|не всі|not all/i);
  assert.equal(
    complete.answer_text,
    "Цього тижня на дошці:\n\n- **Перейшло в Done:** 6 — «Картка 0», «Картка 1», «Картка 2», «Картка 3» та «Картка 4» (ще 1)",
  );
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
  // Only the one applicable bullet is rendered — the four other (zero-value) categories are
  // omitted entirely rather than shown as "0" (requirement #6/#7 of the Variant B follow-up).
  assert.equal(answer.answer_text, "Цього тижня по Extract:\n\n- **Інші переміщення:** 7 карток");
  assert.doesNotMatch(answer.answer_text, /«Рух|moved_\d|lastActivityAt|5 карт|Перейшло в Done|Повернулось з Done|Створено|Архівовано/);
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

  assert.match(answer.answer_text, /\*\*Перейшло в Done:\*\* 4 —/, "reached-Done total is stated exactly, with no lower substitute total");
  assert.match(answer.answer_text, /\*\*Створено:\*\* 6 карток/, "created total is stated exactly, not the five internally shown, and never individually named");
  assert.match(answer.answer_text, /«Завершення 1», «Завершення 2», «Завершення 3» та «Завершення 4»/, "all four reached-Done examples are named because the concise limit (5) is not exceeded");
  assert.doesNotMatch(answer.answer_text, /Нова картка/, "created cards are never individually named in a concise answer");
  // Requirement #8: concise mode's per-category example cap is never presented as a coverage gap —
  // complete coverage here must not print any "not all listed" caveat.
  assert.doesNotMatch(answer.answer_text, /не всі|not all|може бути неповною/i);
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
  assert.match(answer.answer_text, /\*\*Перейшло в Done:\*\* 4 —/, "4 reached-Done events");
  assert.match(answer.answer_text, /\*\*Повернулось з Done:\*\* 2 —/, "2 returned-from-Done events");
  assert.match(answer.answer_text, /\*\*Створено:\*\* 6 карток/, "6 created cards");
  assert.match(answer.answer_text, /\*\*Інші переміщення:\*\* 5 карток/, "5 moved cards");
  // 5: the moved card "Міні-парфуми адаптація" never appears anywhere, so it cannot be misdescribed as created.
  assert.doesNotMatch(answer.answer_text, /адаптація/i);
  // 6/7: no direction/majority claim, so «Брендбук»'s real (backward) direction cannot be contradicted.
  assert.doesNotMatch(answer.answer_text, /більшість|напрям|Backlog\s*→|Брендбук/i);
  // 8: no invented reason for the Done-returns.
  assert.doesNotMatch(answer.answer_text, /правок|доробк/i);
  // 9: no productivity/trend framing.
  assert.doesNotMatch(answer.answer_text, /активн|ресурс|продуктивн/i);
  // 10: stays within the intended short-answer budget — one bullet per active category, no more.
  const bulletCount = answer.answer_text.split("\n").filter((line) => line.startsWith("- ")).length;
  assert.equal(bulletCount, 4, `expected exactly 4 bullets, got ${bulletCount}: ${answer.answer_text}`);
});

test("#36 Variant B: docs/27-shaped last-week Extract fixture renders the exact structured report Daniel selected", () => {
  // Same facts docs/27's live diagnostics exercised (4 reached Done, 2 of those also returned from
  // Done, 6 created, 5 otherwise-moved), but using window: "last_week" (requirement #11) and dates
  // that actually fall in that resolved window, to prove the end-to-end structured shape Daniel
  // selected ("Минулого тижня по Extract: ..."), not just isolated total/name assertions.
  const doneCards = [
    { id: "kohaiu", name: "Кохаю пінка", labels: [{ name: "Extract" }] },
    { id: "bili3d", name: "Білі аромати 3D відео", labels: [{ name: "Extract" }] },
    { id: "avtorender", name: "Автоматизація рендеру", labels: [{ name: "Extract" }] },
    { id: "komentari", name: "Коментарі по пінкам", labels: [{ name: "Extract" }] },
  ];
  const createdOnlyCards = [
    { id: "bili50", name: "Білі аромати 50 ML", labels: [{ name: "Extract" }] },
    { id: "chorni100", name: "Чорні аромати 100 ML", labels: [{ name: "Extract" }] },
  ];
  const movedOnlyCards = Array.from({ length: 5 }, (_, i) => ({ id: `moved_${i}`, name: `Рух ${i + 1}`, labels: [{ name: "Extract" }] }));
  const allCards = [...doneCards, ...createdOnlyCards, ...movedOnlyCards];

  const actions: TrelloAction[] = [
    // All four created early in the window (before Done/move actions), so factsByCard insertion
    // order — which the bullet's named list follows — matches doneCards' own order.
    ...[...doneCards, ...createdOnlyCards].map((card, i) => action(`create_${i}`, `2026-03-16T0${i + 1}:00:00Z`, "createCard", { card })),
    ...movedOnlyCards.map((card, i) => action(`move_${i}`, `2026-03-17T0${i + 1}:00:00Z`, "updateCard", { card, listBefore: { name: "Backlog" }, listAfter: { name: "This week" } })),
    ...doneCards.map((card, i) => action(`done_${i}`, `2026-03-18T0${i + 1}:00:00Z`, "updateCard", { card, listBefore: { name: "In progress" }, listAfter: { name: "Done" } })),
    // Two of the four reopen after reaching Done: «Білі аромати 3D відео» (index 1) and «Коментарі по пінкам» (index 3).
    action("return_1", "2026-03-18T05:00:00Z", "updateCard", { card: doneCards[1], listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
    action("return_3", "2026-03-18T06:00:00Z", "updateCard", { card: doneCards[3], listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
  ];

  const answer = buildWorkHistoryAnswer(
    { window: { kind: "last_week" }, scope: { kind: "project", label: "Extract" }, response_format: "concise" },
    actions,
    allCards,
    { pagesRead: 1, truncated: false, oldestActionReached: true },
    NOW,
  );

  assert.equal(
    answer.answer_text,
    "Минулого тижня по Extract:\n\n" +
      "- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»\n" +
      "- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»\n" +
      "- **Створено:** 6 карток\n" +
      "- **Інші переміщення:** 5 карток",
  );
  assert.doesNotMatch(answer.answer_text, /card_|lastActivityAt|ти зробив|daniel|не всі|може бути неповною/i);
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
  assert.equal(answer.answer_text, "Цього тижня по Extract: за цей період суттєвих змін не зафіксовано.");
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

// ---------------------------------------------------------------------------------------------
// #66: the smallest deterministic answer for the question asked. Production evidence: the weekly review, a
// follow-up and «По CL, які задачі було закрито» all led with the `detailed` event dump (timestamps, `due`,
// Created/moved lines) — the only mode that named every card. A narrow question now has its own deduplicated
// answer, a project overview names its cards, and `detailed` needs Daniel's own request, established by the client.
// ---------------------------------------------------------------------------------------------

const CL_NAMES = ["Whitepaper PDF", "Футболка", "RDAS", "Пост в LinkedIn", "Google Slides V3", "Банер", "Лендинг", "Іконки", "Презентація", "Стікери", "Мерч"];
const clCards: TrelloHistoryCard[] = [
  ...CL_NAMES.map((name, index) => ({ id: `cl_${index}`, name, due: "2026-03-27T16:00:00Z", labels: [{ name: "Cossack Labs" }] })),
  { id: "cl_new", name: "Нова картка CL", labels: [{ name: "Cossack Labs" }] },
  { id: "cl_moved", name: "Бриф", labels: [{ name: "Cossack Labs" }] },
  { id: "other_done", name: "Чужа картка", labels: [{ name: "Extract" }] },
];
const toDone = (id: string, card: string, hour: number) =>
  action(id, `2026-03-23T${String(hour).padStart(2, "0")}:00:00Z`, "updateCard", { card: { id: card }, listBefore: { name: "In progress" }, listAfter: { name: "Done" } });
const clActions: TrelloAction[] = [
  ...CL_NAMES.map((_name, index) => toDone(`d_${index}`, `cl_${index}`, index + 1)),
  // «Футболка» goes Done → In progress → Done: two Done events, one card.
  action("back", "2026-03-23T13:00:00Z", "updateCard", { card: { id: "cl_1" }, listBefore: { name: "Done" }, listAfter: { name: "In progress" } }),
  toDone("again", "cl_1", 14),
  action("new", "2026-03-23T15:00:00Z", "createCard", { card: { id: "cl_new" } }),
  action("move", "2026-03-23T16:00:00Z", "updateCard", { card: { id: "cl_moved" }, listBefore: { name: "Backlog" }, listAfter: { name: "In progress" } }),
  toDone("other", "other_done", 17),
];
const FULL: Parameters<typeof buildWorkHistoryAnswer>[3] = { pagesRead: 1, truncated: false, oldestActionReached: true };
const CL = { kind: "project", label: "Cossack Labs" } as const;
/** What only the event chronology contains: an action timestamp, a due value, a per-event sentence. */
const CHRONOLOGY = /\d{2}:\d{2}|due |У Done перейшла|Створено «/;

test("#66 narrow project Done question: exactly the deduplicated closed cards and the unique count — no other category, timestamp or due", () => {
  const answer = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: CL, focus: "completed" }, clActions, clCards, FULL, NOW);
  assert.equal(
    answer.answer_text,
    "Cossack Labs — закрито цього тижня:\n" +
      CL_NAMES.map((name) => `• ${name}`).join("\n") +
      "\n11 унікальних карток. Одна картка заходила в Done двічі.",
  );
  assert.doesNotMatch(answer.answer_text, CHRONOLOGY);
  assert.doesNotMatch(answer.answer_text, /Нова картка CL|Бриф|Чужа картка|Створено|переміщ|Повернулось/i, "nothing but the requested slice");
  assert.equal(answer.detail_note, undefined);
});

test("#66 every focus is its own slice; an empty slice is one line; board scope and an explicit range have honest headings", () => {
  const focused = (focus: "returned" | "created" | "archived" | "moved") =>
    buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: CL, focus }, clActions, clCards, FULL, NOW).answer_text;
  assert.equal(focused("returned"), "Cossack Labs — повернулось із Done цього тижня:\n• Футболка");
  assert.equal(focused("created"), "Cossack Labs — створено цього тижня:\n• Нова картка CL");
  assert.equal(focused("moved"), "Cossack Labs — переміщено між списками цього тижня:\n• Бриф (Backlog → In progress)");
  assert.equal(focused("archived"), "Cossack Labs — архівовано цього тижня: нічого.");
  const board = buildWorkHistoryAnswer({ window: { kind: "last_week" }, scope: { kind: "board" }, focus: "completed" }, clActions, clCards, FULL, new Date("2026-04-01T12:00:00Z")).answer_text;
  assert.match(board, /^Дошка — закрито минулого тижня:\n/);
  assert.match(board, /• Чужа картка\n12 унікальних карток\. Одна картка заходила в Done двічі\.$/);
  const ranged = buildWorkHistoryAnswer({ window: { kind: "explicit", from: "2026-03-23", to: "2026-03-24" }, scope: CL, focus: "created" }, clActions, clCards, FULL, NOW).answer_text;
  assert.equal(ranged, "Cossack Labs — створено за період пн 23.03, 00:00 – вт 24.03, 00:00:\n• Нова картка CL");
});

test("#66 a long focused list is cut at 30 with an explicit remainder; the count still covers every card", () => {
  const many = Array.from({ length: 33 }, (_, index) => ({ id: `m_${index}`, name: `К${index}`, labels: [{ name: "Extract" }] }));
  const moves = many.map((card, index) => action(`mm_${index}`, `2026-03-23T08:${String(index).padStart(2, "0")}:00Z`, "updateCard", { card: { id: card.id }, listBefore: { name: "In progress" }, listAfter: { name: "Done" } }));
  const text = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" }, focus: "completed" }, moves, many, FULL, NOW).answer_text;
  assert.equal(text.split("\n").filter((line) => line.startsWith("• К")).length, 30);
  assert.match(text, /\n• … ще 3\n33 унікальні картки\.$/);
});

test("#66 default weekly overview stays the compact Variant B: a board names five, a project names its closed cards — never chronology", () => {
  const board = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: { kind: "board" } }, clActions, clCards, FULL, NOW).answer_text;
  assert.equal(
    board,
    "Цього тижня на дошці:\n\n" +
      "- **Перейшло в Done:** 13 — «Whitepaper PDF», «Футболка», «RDAS», «Пост в LinkedIn» та «Google Slides V3» (ще 7)\n" +
      "- **Повернулось з Done:** 1 — «Футболка»\n" +
      "- **Створено:** 1 картка\n" +
      "- **Інші переміщення:** 1 картка",
  );
  const project = buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: CL }, clActions, clCards, FULL, NOW).answer_text;
  for (const name of CL_NAMES) assert.ok(project.includes(`«${name}»`), `a project overview names ${name}`);
  assert.doesNotMatch(project, /\(ще \d+\)/);
  assert.equal(project.split("\n").length, 6, "heading, blank line and four category bullets");
  for (const text of [board, project]) assert.doesNotMatch(text, CHRONOLOGY);
});

test("#66 `detailed` without Daniel's own request is withheld: the compact answer plus a model-only note; with it, the chronology is unchanged", () => {
  const input = { window: { kind: "this_week" }, scope: CL, response_format: "detailed" } as const;
  const withheld = buildWorkHistoryAnswer(input, clActions, clCards, FULL, NOW, { detailRequested: false });
  assert.equal(withheld.answer_text, buildWorkHistoryAnswer({ window: { kind: "this_week" }, scope: CL }, clActions, clCards, FULL, NOW).answer_text);
  assert.doesNotMatch(withheld.answer_text, CHRONOLOGY);
  assert.match(withheld.detail_note ?? "", /not produced[\s\S]*Daniel's own message[\s\S]*Do not narrate events/);
  assert.ok(!withheld.answer_text.includes(withheld.detail_note!), "the note is for the model, never part of what Daniel sees");

  const delivered = buildWorkHistoryAnswer(input, clActions, clCards, FULL, NOW, { detailRequested: true });
  assert.equal(delivered.detail_note, undefined);
  assert.match(delivered.answer_text, /^У Done перейшло 12 подій\. У Done перейшла «Whitepaper PDF» — пн 23\.03, 03:00, due пт 27\.03, 18:00\./);
  assert.match(delivered.answer_text, /«Футболка» — пн 23\.03, 16:00 \(2 рази\)/);
  assert.match(delivered.answer_text, /Створено «Нова картка CL» — пн 23\.03, 17:00\./);
  // A focused detailed request narrows the chronology to that kind of change.
  const focused = buildWorkHistoryAnswer({ ...input, focus: "created" }, clActions, clCards, FULL, NOW, { detailRequested: true }).answer_text;
  assert.equal(focused, "Створено 1 картка. Створено «Нова картка CL» — пн 23.03, 17:00.");
});

test("#66 coverage/truncation semantics are unchanged in every new shape: the warning is kept, never invented", () => {
  const partial = { pagesRead: 20, truncated: true, oldestActionReached: false };
  const WARNING = "Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю.";
  const shapes = [
    { window: { kind: "this_week" }, scope: CL, focus: "completed" },
    { window: { kind: "this_week" }, scope: CL, focus: "archived" },
    { window: { kind: "this_week" }, scope: CL, response_format: "detailed" },
    { window: { kind: "this_week" }, scope: { kind: "board" } },
  ] as const;
  for (const input of shapes) {
    const cut = buildWorkHistoryAnswer(input, clActions, clCards, partial, NOW, { detailRequested: false });
    assert.ok(cut.answer_text.endsWith(`\n\n${WARNING}`), JSON.stringify(input));
    assert.deepEqual(cut.coverage, partial);
    assert.ok(!buildWorkHistoryAnswer(input, clActions, clCards, FULL, NOW, { detailRequested: false }).answer_text.includes(WARNING));
  }
  // The explicitly requested chronology keeps its own closing warning too.
  assert.ok(buildWorkHistoryAnswer(shapes[2], clActions, clCards, partial, NOW, { detailRequested: true }).answer_text.endsWith(` ${WARNING}`));
});

test("#66 the executor is closed by default and accepts the released input shape and the next one; a bad focus is a safe error", async () => {
  const client = new TrelloWorkHistoryClient({
    apiKey: "k", readToken: "t",
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/boards")) return Response.json([{ id: "board_1", name: "Djonik" }]);
      return Response.json(path.endsWith("/cards/all") ? clCards : clActions);
    },
  });
  const run = async (input: unknown, policy?: { detailRequested: boolean }) => JSON.parse((await executeTrelloWorkHistory(input, client, NOW, policy)).content);
  const released = { window: { kind: "this_week" }, scope: CL, response_format: "detailed" };
  assert.doesNotMatch((await run(released)).answer_text, CHRONOLOGY, "no policy → no chronology");
  assert.ok((await run(released)).detail_note);
  assert.match((await run(released, { detailRequested: true })).answer_text, /^У Done перейшло 12 подій\./);
  assert.match((await run({ window: { kind: "this_week" }, scope: CL, focus: "completed" })).answer_text, /^Cossack Labs — закрито цього тижня:\n• Whitepaper PDF\n/);
  for (const focus of ["everything", "toString", 5, null]) {
    const bad = await executeTrelloWorkHistory({ window: { kind: "this_week" }, scope: CL, focus }, client, NOW);
    assert.equal(bad.isError, true, String(focus));
  }
});

test("#66 an explicit request for detail is a short list of plain phrasings; ordinary review questions are not one", () => {
  for (const text of ["покажи детально", "Дай всі переміщення по CL", "повна історія за тиждень", "дай повну історію", "Розпиши детальніше (огляд тижня від пт 09.10).", "хочу хронологію", "покажи кожну подію", "докладно, будь ласка"]) {
    assert.equal(asksForDetailedHistory(text), true, text);
  }
  for (const text of ["По CL, які задачі було закрито", "тобто цей тиждень успішний?", "огляд тижня", "Що по Extract минулого тижня?", "яка історія з Limen?", "що рухалось цього тижня"]) {
    assert.equal(asksForDetailedHistory(text), false, text);
  }
});

test("#66 the next tool definition only adds `focus`; the released definition (Agent v26–v31) is untouched", () => {
  assert.deepEqual(Object.keys(TRELLO_WORK_HISTORY_TOOL.input_schema.properties), ["window", "scope", "response_format"]);
  assert.doesNotMatch(TRELLO_WORK_HISTORY_TOOL.description, /focus/);
  const { focus, ...rest } = TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema.properties;
  assert.deepEqual(rest, TRELLO_WORK_HISTORY_TOOL.input_schema.properties);
  assert.deepEqual(focus, { enum: ["overview", "completed", "returned", "created", "archived", "moved"] });
  assert.deepEqual(TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema.required, ["window", "scope"], "focus and response_format stay optional: the default is the overview");
  assert.equal(TRELLO_WORK_HISTORY_TOOL_NEXT.name, "trello_work_history");
  assert.match(TRELLO_WORK_HISTORY_TOOL_NEXT.description, /only when Daniel's own message asks for detail/);
  assert.match(TRELLO_WORK_HISTORY_TOOL_NEXT.description, /never request it to gather material/);
});
