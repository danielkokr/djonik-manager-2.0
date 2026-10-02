import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRhythmConfig } from "./rhythmConfig.js";
import type { HistoryCoverage, TrelloAction, TrelloHistoryCard, TrelloList } from "./trelloWorkHistory.js";
import {
  allocateWeeklyTime,
  computeProjectTime,
  computeWeeklyTime,
  inProgressIntervals,
  MULTI_LABEL_PROJECT,
  PROJECT_TIME_MAX_CARDS,
  TIME_REPORT_LABEL,
  type WeeklyTimeReader,
} from "./weeklyTime.js";
import { createProjectTimeExecutor, parseProjectTimeInput, PROJECT_TIME_TOOL_NAME, TRELLO_PROJECT_TIME_TOOL } from "./projectTimeTool.js";
import { autonomousWriteViolations } from "./rhythmRunner.js";

// #62: one project's approximate time this week, with a per-card breakdown, from the SAME #50 allocation pass.
// Zero network, zero inference, zero writes.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const H = 3_600_000;
const WORK = parseRhythmConfig("work_hours: 10:00-18:00").config;
const NO_HOURS = parseRhythmConfig("").config;
const LISTS: TrelloList[] = [{ id: "LW", name: "This week" }, { id: "LP", name: "In progress" }, { id: "LD", name: "Done" }];
const REF = { LW: { id: "LW", name: "This week" }, LP: { id: "LP", name: "In progress" }, LD: { id: "LD", name: "Done" } };
const FULL: HistoryCoverage = { pagesRead: 1, truncated: false, oldestActionReached: true };
// Mon 28.09 00:00 Kyiv (EEST, UTC+3) → Fri 02.10 16:30 Kyiv. Work hours 10:00–18:00 Kyiv = 07:00–15:00Z.
const WEEK = { from: new Date("2026-09-27T21:00:00Z"), to: new Date("2026-10-02T13:30:00Z") };
const NOW = WEEK.to;

let seq = 0;
const move = (card: string, at: string, from: keyof typeof REF, to: keyof typeof REF): TrelloAction =>
  ({ id: `a${(seq += 1)}`, type: "updateCard", date: at, data: { card: { id: card }, listBefore: REF[from], listAfter: REF[to] } });
/** A card In progress on [start, end) and Done afterwards. */
const stint = (card: string, start: string, end: string): TrelloAction[] => [move(card, start, "LW", "LP"), move(card, end, "LP", "LD")];
const id = (n: number) => `5f0c0ffee00000000000${String(n).padStart(4, "0")}`;
const cardOf = (cardId: string, name: string, labels: string[], list: keyof typeof REF = "LD"): TrelloHistoryCard =>
  ({ id: cardId, name, idList: list, labels: labels.map((label) => ({ name: label })) });
const hours = (ms: number) => Math.round((ms / H) * 1000) / 1000;
const okOf = (outcome: ReturnType<typeof computeProjectTime>) => {
  assert.equal(outcome.status, "ok", outcome.answerText);
  return outcome as Extract<typeof outcome, { status: "ok" }>;
};

/** The issue's own example: four A1 cards over the week plus an unrelated Extract card. */
const A1_WEEK = (() => {
  const cards = [
    cardOf(id(1), "Пін Азов", ["A1"]), cardOf(id(2), "Допис Fritt Ukraina", ["A1"]), cardOf(id(3), "Допис в Instagram", ["A1"]),
    cardOf(id(4), "Пальчик і листівка", ["A1"]), cardOf(id(5), "Логотип Extract", ["Extract"]),
  ];
  const actions = [
    ...stint(id(1), "2026-09-28T07:00:00Z", "2026-09-28T10:00:00Z"), // 3 h
    ...stint(id(2), "2026-09-29T07:00:00Z", "2026-09-29T09:30:00Z"), // 2.5 h
    ...stint(id(3), "2026-09-30T07:00:00Z", "2026-09-30T08:30:00Z"), // 1.5 h
    ...stint(id(4), "2026-10-01T07:00:00Z", "2026-10-01T07:30:00Z"), // 0.5 h
    ...stint(id(5), "2026-10-01T08:00:00Z", "2026-10-01T10:00:00Z"), // 2 h, Extract
  ].reverse();
  return { cards, lists: LISTS, actions, coverage: FULL, window: WEEK };
})();

test("1. same allocation: the A1 total is the exact sum of its per-card allocations; the answer matches the issue's shape", () => {
  const outcome = okOf(computeProjectTime({ ...A1_WEEK, project: "A1", config: WORK }));
  assert.equal(outcome.totalMs, outcome.cards.reduce((sum, card) => sum + card.ms, 0), "exact equality before rounding");
  assert.deepEqual(outcome.cards.map((card) => [card.name, hours(card.ms)]),
    [["Пін Азов", 3], ["Допис Fritt Ukraina", 2.5], ["Допис в Instagram", 1.5], ["Пальчик і листівка", 0.5]]);
  assert.equal(outcome.answerText, [
    "A1 — ≈ 7,5 год цього тижня",
    "",
    "По задачах:",
    "• Пін Азов — ≈ 3 год",
    "• Допис Fritt Ukraina — ≈ 2,5 год",
    "• Допис в Instagram — ≈ 1,5 год",
    "• Пальчик і листівка — ≈ 0,5 год",
    "",
    `${TIME_REPORT_LABEL}, з точністю до пів години (робочі години 10:00–18:00)`,
  ].join("\n"));
  // The project level is literally derived from the card level of ONE allocation (no second pass).
  const allocation = allocateWeeklyTime(inProgressIntervals(A1_WEEK), WEEK, WORK);
  for (const total of allocation.totals) {
    const sum = allocation.cards.filter((card) => card.project === total.project).reduce((acc, card) => acc + card.ms, 0);
    assert.equal(total.ms, sum, total.project);
  }
});

test("2. overlap: simultaneous In-progress cards split equally — at card AND project level", () => {
  const cards = [cardOf(id(1), "Банер", ["A1"]), cardOf(id(2), "Сторіз", ["A1"]), cardOf(id(3), "Пакування", ["Extract"])];
  const actions = [
    ...stint(id(1), "2026-09-28T07:00:00Z", "2026-09-28T10:00:00Z"),
    ...stint(id(2), "2026-09-28T07:00:00Z", "2026-09-28T10:00:00Z"),
    ...stint(id(3), "2026-09-28T07:00:00Z", "2026-09-28T10:00:00Z"),
  ];
  const outcome = okOf(computeProjectTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, project: "A1", config: WORK }));
  assert.deepEqual(outcome.cards.map((card) => hours(card.ms)), [1, 1], "3 h × 3 cards → 1 h each");
  assert.equal(hours(outcome.totalMs), 2);
  assert.equal(outcome.totalMs, outcome.cards[0].ms + outcome.cards[1].ms);
  assert.match(outcome.answerText, /поділено порівну, тож цифри грубі/);
  const friday = computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: WORK });
  assert.equal(friday.status === "ok" && friday.allocation.totals.find((t) => t.project === "A1")?.ms, outcome.totalMs, "Friday sees the same A1 total");
});

test("3. daily cap scales every card of the capped day proportionally; card sum still equals the project total", () => {
  const nine = parseRhythmConfig("work_hours: 09:00-19:00").config; // 10 h window, default cap 8 h
  const cards = [cardOf(id(1), "Довга задача", ["A1"]), cardOf(id(2), "Коротка задача", ["A1"])];
  // a: 09:00–19:00 Kyiv (10 h); b: 09:00–14:00 Kyiv (5 h). Shares a 7.5, b 2.5; union 10 h → × 0.8 → a 6, b 2.
  const actions = [...stint(id(1), "2026-09-28T06:00:00Z", "2026-09-28T16:00:00Z"), ...stint(id(2), "2026-09-28T06:00:00Z", "2026-09-28T11:00:00Z")];
  const outcome = okOf(computeProjectTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, project: "A1", config: nine }));
  assert.deepEqual(outcome.cards.map((card) => [card.name, hours(card.ms)]), [["Довга задача", 6], ["Коротка задача", 2]]);
  assert.equal(outcome.totalMs, outcome.cards[0].ms + outcome.cards[1].ms);
  assert.equal(hours(outcome.totalMs), 8);
  assert.match(outcome.answerText, /Ліміт 8 год на день урізав 1 день: у такі дні час кожної задачі зменшено пропорційно\./);
});

test("4. work-hours clipping applies at both levels: time outside work hours is not counted, a card with none is not listed", () => {
  const cards = [cardOf(id(1), "Ранкова", ["A1"]), cardOf(id(2), "Вечірня", ["A1"])];
  // Ранкова 08:00–11:00 Kyiv → only 10:00–11:00 counts; Вечірня 18:00–20:00 Kyiv → nothing.
  const actions = [...stint(id(1), "2026-09-28T05:00:00Z", "2026-09-28T08:00:00Z"), ...stint(id(2), "2026-09-28T15:00:00Z", "2026-09-28T17:00:00Z")];
  const outcome = okOf(computeProjectTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, project: "A1", config: WORK }));
  assert.deepEqual(outcome.cards.map((card) => [card.name, hours(card.ms)]), [["Ранкова", 1]]);
  assert.equal(hours(outcome.totalMs), 1);
  assert.doesNotMatch(outcome.answerText, /Вечірня/);
});

test("5. card names: human-readable, whitespace-flattened and bounded; ids never visible; a long tail folds into one line", () => {
  const many = Array.from({ length: PROJECT_TIME_MAX_CARDS + 2 }, (_, i) => i + 1);
  const cards = many.map((n) => cardOf(id(n), n === 1 ? `Дуже\nдовга   назва ${"х".repeat(120)}` : `Задача ${n}`, ["A1"]));
  // Each card gets its own 30-minute slot on Mon–Wed working hours, no overlap.
  const actions = many.flatMap((n) => {
    const start = Date.parse("2026-09-28T07:00:00Z") + Math.floor((n - 1) / 8) * 24 * H + ((n - 1) % 8) * 0.5 * H;
    return stint(id(n), new Date(start).toISOString(), new Date(start + 0.5 * H).toISOString());
  });
  const outcome = okOf(computeProjectTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, project: "A1", config: WORK }));
  for (const n of many) assert.ok(!outcome.answerText.includes(id(n)), "no card id in the answer");
  assert.doesNotMatch(JSON.stringify(outcome.cards), /5f0c0ffee/, "no card id in the structured result either");
  const listed = outcome.answerText.split("\n").filter((line) => line.startsWith("• "));
  assert.equal(listed.length, PROJECT_TIME_MAX_CARDS + 1);
  assert.equal(listed.at(-1), "• ще 2 задачі — ≈ 1 год");
  const longLine = listed.find((line) => line.startsWith("• Дуже довга назва"))!;
  assert.ok(longLine, "newlines and runs of spaces are flattened");
  assert.match(longLine, /…/);
  assert.ok(longLine.length < 110, "the name is bounded");
});

test("6. project filtering: an A1 query returns only A1 cards; other projects never leak; multi-label time is named apart", () => {
  const outcome = okOf(computeProjectTime({ ...A1_WEEK, project: "A1", config: WORK }));
  assert.doesNotMatch(outcome.answerText, /Extract|Логотип/);
  const extract = okOf(computeProjectTime({ ...A1_WEEK, project: "Extract", config: WORK }));
  assert.deepEqual(extract.cards.map((card) => card.name), ["Логотип Extract"]);
  assert.doesNotMatch(extract.answerText, /Азов|Instagram|A1/);
  // A card carrying A1 AND another label belongs to the «кілька міток» bucket (Friday semantics): not in the A1 sum,
  // but said once instead of silently dropped.
  const cards = [cardOf(id(1), "Банер", ["A1"]), cardOf(id(2), "Спільний макет", ["A1", "Extract"])];
  const actions = [...stint(id(1), "2026-09-28T07:00:00Z", "2026-09-28T09:00:00Z"), ...stint(id(2), "2026-09-29T07:00:00Z", "2026-09-29T08:00:00Z")];
  const mixed = okOf(computeProjectTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, project: "A1", config: WORK }));
  assert.equal(hours(mixed.totalMs), 2);
  assert.equal(hours(mixed.multiLabelMs), 1);
  assert.deepEqual(mixed.cards.map((card) => card.name), ["Банер"]);
  assert.match(mixed.answerText, /Окремо ≈ 1 год — задачі з A1 і ще іншою міткою; у суму не входять\./);
  assert.ok(allocateWeeklyTime(inProgressIntervals({ cards, lists: LISTS, actions, window: WEEK }), WEEK, WORK).totals.some((t) => t.project === MULTI_LABEL_PROJECT));
});

/** A GET-only reader that records every call; it has no write method to call. */
function spyReader(overrides: Partial<WeeklyTimeReader> = {}) {
  const calls: string[] = [];
  const reader: WeeklyTimeReader = {
    resolveSingleBoard: async () => { calls.push("board"); return { id: "b", name: "B" }; },
    readCards: async () => { calls.push("cards"); return A1_WEEK.cards; },
    readLists: async () => { calls.push("lists"); return LISTS; },
    readActions: async (_board, window) => { calls.push(`actions:${window.from.toISOString()}→${window.to.toISOString()}`); return { actions: A1_WEEK.actions, coverage: FULL }; },
    ...overrides,
  };
  return { reader, calls };
}
const parse = (content: string) => JSON.parse(content) as { status: string; reason?: string; answer_text: string; project_label: string; week: string };

test("7. missing work_hours: unavailable, compact, configuration-oriented — and no Trello read at all", async () => {
  assert.equal(computeProjectTime({ ...A1_WEEK, project: "A1", config: NO_HOURS }).answerText,
    "Час по A1 цього тижня не можу оцінити: у /rhythm.md не задані work_hours.\nЯкщо хочеш — задамо робочі години.");
  const { reader, calls } = spyReader();
  const result = await createProjectTimeExecutor({ reader, readConfig: async () => NO_HOURS, now: () => NOW })({ project_label: "A1" });
  assert.equal(result.isError, false, "a final code-owned answer, relayed like any verified result");
  const body = parse(result.content);
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "work_hours_missing");
  assert.equal(body.answer_text, "Час по A1 цього тижня не можу оцінити: у /rhythm.md не задані work_hours.\nЯкщо хочеш — задамо робочі години.");
  assert.deepEqual(calls, [], "no Trello history read without work hours, exactly like the Friday reporter");
  // A config read failure is unavailable too, still before Trello.
  const failed = parse((await createProjectTimeExecutor({ reader, readConfig: async () => { throw new Error("memory down"); } })({ project_label: "A1" })).content);
  assert.equal(failed.reason, "config_unavailable");
  assert.doesNotMatch(failed.answer_text, /\d+(?:[.,]\d+)?\s*год/);
  assert.deepEqual(calls, []);
});

test("8. incomplete or failed history: fail closed, no partial hours", async () => {
  const truncated = computeProjectTime({ ...A1_WEEK, coverage: { ...FULL, truncated: true }, project: "A1", config: WORK });
  assert.equal(truncated.status === "unavailable" && truncated.reason, "history_incomplete");
  assert.equal(truncated.answerText, "Час по A1 цього тижня не можу оцінити: історію Trello за тиждень не вдалося прочитати повністю. Годин не вгадую.");
  const notReached = computeProjectTime({ ...A1_WEEK, coverage: { ...FULL, oldestActionReached: false }, project: "A1", config: WORK });
  assert.equal(notReached.status, "unavailable");
  const { reader } = spyReader({ readActions: async () => { throw new Error("502"); } });
  const failed = parse((await createProjectTimeExecutor({ reader, readConfig: async () => WORK, now: () => NOW })({ project_label: "A1" })).content);
  assert.equal(failed.reason, "history_unavailable");
  assert.equal(failed.answer_text, "Час по A1 цього тижня не можу оцінити: історія Trello зараз недоступна. Годин не вгадую.");
  const noReader = parse((await createProjectTimeExecutor({ reader: null, readConfig: async () => WORK })({ project_label: "A1" })).content);
  assert.equal(noReader.reason, "history_unavailable");
});

test("9. an unknown canonical label is an explicit not-found — no guess, no substitute, no action-log read", async () => {
  const { reader, calls } = spyReader();
  const run = createProjectTimeExecutor({ reader, readConfig: async () => WORK, now: () => NOW });
  const body = parse((await run({ project_label: "Азов" })).content);
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "project_not_found");
  assert.equal(body.answer_text, "Мітки «Азов» на дошці Trello не знайшов, тож час не рахую.");
  assert.ok(!calls.some((call) => call.startsWith("actions")), "the label check precedes the action log");
  // Exact match only, as trello_work_history: a near name is not A1.
  for (const near of ["a1", "A 1", "A1 Азов"]) assert.equal(parse((await run({ project_label: near })).content).reason, "project_not_found", near);
  assert.equal(computeProjectTime({ ...A1_WEEK, project: "Seqthera", config: WORK }).status, "unavailable");
});

test("10. rendering: compact Ukrainian, approximate Trello-movement label, explicit nothing-this-week, no billing claim", async () => {
  const quiet = okOf(computeProjectTime({ ...A1_WEEK, actions: [], cards: A1_WEEK.cards.map((card) => ({ ...card, idList: "LD" })), project: "A1", config: WORK }));
  assert.equal(quiet.answerText, `A1 — цього тижня в робочі години в In progress нічого не було.\n\n${TIME_REPORT_LABEL}, з точністю до пів години (робочі години 10:00–18:00)`);
  const { reader, calls } = spyReader();
  const body = parse((await createProjectTimeExecutor({ reader, readConfig: async () => WORK, now: () => NOW })({ project_label: " A1 " })).content);
  assert.equal(body.status, "ok");
  assert.equal(body.project_label, "A1");
  assert.equal(body.week, "this_week");
  assert.equal(body.answer_text, okOf(computeProjectTime({ ...A1_WEEK, project: "A1", config: WORK })).answerText);
  assert.ok(body.answer_text.split("\n").length <= 12, "compact");
  assert.match(body.answer_text, /≈ за переміщеннями в Trello/);
  assert.doesNotMatch(body.answer_text, /рахун|інвойс|оплат|billing/i);
  // The model sees only the ready answer: no hours as numbers to recombine, no card ids, no raw moves.
  assert.deepEqual(Object.keys(body).sort(), ["answer_text", "project_label", "status", "week"]);
  // This week = Monday 00:00 Kyiv → now (the Friday reporter's window).
  assert.deepEqual(calls.filter((call) => call.startsWith("actions")), ["actions:2026-09-27T21:00:00.000Z→2026-10-02T13:30:00.000Z"]);
});

test("11. Friday regression: the weekly block is byte-identical in shape and sees the same project totals", () => {
  const friday = computeWeeklyTime({ ...A1_WEEK, config: WORK });
  assert.equal(friday.block, [`⏱ Час по проєктах ${TIME_REPORT_LABEL} (робочі години 10:00–18:00):`, "A1 — 7,5 год", "Extract — 2 год"].join("\n"));
  assert.ok(!friday.block.includes("По задачах"), "Friday stays per-project");
  const missing = computeWeeklyTime({ ...A1_WEEK, config: NO_HOURS });
  assert.equal(missing.block, "⏱ Час по проєктах: недоступний — не задані робочі години (work_hours у /rhythm.md). Годин не оцінюю.");
  const time = okOf(computeProjectTime({ ...A1_WEEK, project: "A1", config: WORK }));
  assert.equal(friday.status === "ok" && friday.allocation.totals.find((t) => t.project === "A1")?.ms, time.totalMs);
});

test("input contract: exactly one bounded project_label; anything else is an invalid call that counts nothing", async () => {
  assert.equal(TRELLO_PROJECT_TIME_TOOL.name, PROJECT_TIME_TOOL_NAME);
  assert.deepEqual(TRELLO_PROJECT_TIME_TOOL.input_schema.required, ["project_label"]);
  assert.equal(TRELLO_PROJECT_TIME_TOOL.input_schema.additionalProperties, false);
  assert.deepEqual(parseProjectTimeInput({ project_label: "  A1 " }), { projectLabel: "A1" });
  const { reader, calls } = spyReader();
  const run = createProjectTimeExecutor({ reader, readConfig: async () => WORK, now: () => NOW });
  for (const bad of [null, {}, { project_label: "" }, { project_label: "x".repeat(121) }, { project_label: "A1", window: "last_week" }, ["A1"]]) {
    const result = await run(bad);
    assert.equal(result.isError, true, JSON.stringify(bad));
    assert.doesNotMatch(result.content, /answer_text/);
  }
  assert.deepEqual(calls, []);
  // Description routes semantically and forbids the noisy fallback.
  assert.match(TRELLO_PROJECT_TIME_TOOL.description, /never estimate time from trello_work_history/);
  assert.match(TRELLO_PROJECT_TIME_TOOL.description, /`unavailable` result .* is the final answer/);
  assert.match(TRELLO_PROJECT_TIME_TOOL.description, /resolving his word through the project brief/);
  assert.match(TRELLO_PROJECT_TIME_TOOL.description, /Read-only; this week only; not billing-grade\./);
});

test("15. read-only: GET-only reader shape, no write path, no Memory API, no state store; autonomous use is not a violation", () => {
  const tool = readFileSync(join(repoRoot, "src", "projectTimeTool.ts"), "utf8");
  const weekly = readFileSync(join(repoRoot, "src", "weeklyTime.ts"), "utf8");
  for (const source of [tool, weekly]) {
    assert.doesNotMatch(source, /\bfetch\(|api\.trello\.com|trelloWrite|memoryStores|\.memories\.|rhythmState|createFileRhythmStateStore|\.save\(|\.update\(/);
  }
  // The executor only ever sees the four GET methods of WeeklyTimeReader.
  assert.match(tool, /reader: WeeklyTimeReader \| null/);
  assert.deepEqual(autonomousWriteViolations([{ kind: "custom", name: "trello_project_time" }]), []);
  // No hardcoded project: the label always comes from the call.
  assert.doesNotMatch(tool + weekly, /Азов|"A1"/);
});
