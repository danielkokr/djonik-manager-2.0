import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRhythmConfig } from "./rhythmConfig.js";
import type { HistoryCoverage, TrelloAction, TrelloHistoryCard, TrelloList } from "./trelloWorkHistory.js";
import {
  composeWeeklyTimeReply,
  computeWeeklyTime,
  createWeeklyTimeReporter,
  formatReportHours,
  inProgressIntervals,
  renderWeeklyTimeBlock,
  TIME_REPORT_LABEL,
  UNLABELLED_PROJECT,
  type WeeklyTimeReader,
} from "./weeklyTime.js";

// #50 weekly time per project: deterministic code over Trello's own action log. Zero network, zero inference.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const H = 3_600_000;
const WORK = parseRhythmConfig("work_hours: 10:00-18:00").config;
const LISTS: TrelloList[] = [
  { id: "LW", name: "This week" }, { id: "LP", name: "In progress" }, { id: "LA", name: "Waiting" }, { id: "LD", name: "Done" },
];
const REF = { LW: { id: "LW", name: "This week" }, LP: { id: "LP", name: "In progress" }, LA: { id: "LA", name: "Waiting" }, LD: { id: "LD", name: "Done" } };
const FULL: HistoryCoverage = { pagesRead: 1, truncated: false, oldestActionReached: true };
// Mon 28.09 00:00 Kyiv (EEST) → Fri 02.10 16:30 Kyiv.
const WEEK = { from: new Date("2026-09-27T21:00:00Z"), to: new Date("2026-10-02T13:30:00Z") };

let seq = 0;
const move = (card: string, at: string, from: keyof typeof REF, to: keyof typeof REF): TrelloAction =>
  ({ id: `a${(seq += 1)}`, type: "updateCard", date: at, data: { card: { id: card }, listBefore: REF[from], listAfter: REF[to] } });
const cardOf = (id: string, list: keyof typeof REF, label: string | null, extra: Partial<TrelloHistoryCard> = {}): TrelloHistoryCard =>
  ({ id, name: `Card ${id}`, idList: list, labels: label ? [{ name: label }] : [], ...extra });
const hoursOf = (outcome: ReturnType<typeof computeWeeklyTime>) =>
  outcome.status === "ok" ? Object.fromEntries(outcome.allocation.totals.map((t) => [t.project, Math.round((t.ms / H) * 100) / 100])) : outcome.reason;

test("intervals come from list moves: enter, leave, re-enter; a card still In progress closes at the cutoff", () => {
  const actions = [
    move("a", "2026-09-28T07:00:00Z", "LW", "LP"), move("a", "2026-09-28T10:00:00Z", "LP", "LA"),
    move("a", "2026-09-29T07:00:00Z", "LA", "LP"),
  ].reverse(); // Trello order: newest first
  const intervals = inProgressIntervals({ cards: [cardOf("a", "LP", "Azov")], lists: LISTS, actions, window: WEEK });
  assert.deepEqual(intervals.map((i) => [new Date(i.start).toISOString(), new Date(i.end).toISOString()]), [
    ["2026-09-28T07:00:00.000Z", "2026-09-28T10:00:00.000Z"],
    ["2026-09-29T07:00:00.000Z", "2026-10-02T13:30:00.000Z"],
  ]);
});

test("reverse replay: a card already In progress at the window start counts from Monday; archive ends it; creation starts it", () => {
  const actions: TrelloAction[] = [
    move("old", "2026-09-29T09:00:00Z", "LP", "LD"),
    { id: "arch", type: "updateCard", date: "2026-09-28T12:00:00Z", data: { card: { id: "arc", closed: true }, old: { closed: false } } },
    { id: "new", type: "createCard", date: "2026-09-30T07:00:00Z", data: { card: { id: "new" }, list: REF.LP } },
    move("new", "2026-09-30T09:00:00Z", "LP", "LA"),
  ];
  const cards = [cardOf("old", "LD", "Extract"), cardOf("arc", "LP", "Azov", { closed: true }), cardOf("new", "LA", null)];
  const byCard = Object.fromEntries(inProgressIntervals({ cards, lists: LISTS, actions, window: WEEK }).map((i) => [i.cardId, [i.start, i.end]]));
  assert.deepEqual(byCard.old, [WEEK.from.getTime(), Date.parse("2026-09-29T09:00:00Z")]);
  assert.deepEqual(byCard.arc, [WEEK.from.getTime(), Date.parse("2026-09-28T12:00:00Z")]);
  assert.deepEqual(byCard.new, [Date.parse("2026-09-30T07:00:00Z"), Date.parse("2026-09-30T09:00:00Z")]);
});

test("working-hours clipping, workdays and the open-interval cutoff", () => {
  // In progress Mon 08:00 Kyiv → still there at Fri 16:30: Mon–Thu 8 h each + Fri 10:00–16:30 = 38.5 h, capped at 8 h/day = 38.5.
  const outcome = computeWeeklyTime({ cards: [cardOf("a", "LP", "Azov")], lists: LISTS, actions: [move("a", "2026-09-28T05:00:00Z", "LW", "LP")], coverage: FULL, window: WEEK, config: WORK });
  assert.deepEqual(hoursOf(outcome), { Azov: 38.5 });
  // Weekend-only In progress counts nothing.
  const weekend = { from: new Date("2026-10-02T21:00:00Z"), to: new Date("2026-10-04T20:00:00Z") };
  const none = computeWeeklyTime({ cards: [cardOf("a", "LP", "Azov")], lists: LISTS, actions: [], coverage: FULL, window: weekend, config: WORK });
  assert.equal(none.status === "ok" && none.allocation.totals.length, 0);
  assert.match(none.block, /в In progress нічого не було/);
});

test("parallel cards split each overlapping segment equally: 2 cards × 2 working hours → ≈1 h each", () => {
  const actions = [
    move("a", "2026-09-28T07:00:00Z", "LW", "LP"), move("b", "2026-09-28T07:00:00Z", "LW", "LP"),
    move("a", "2026-09-28T09:00:00Z", "LP", "LD"), move("b", "2026-09-28T09:00:00Z", "LP", "LD"),
  ];
  const cards = [cardOf("a", "LD", "Azov"), cardOf("b", "LD", "Extract")];
  const outcome = computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: WORK });
  assert.deepEqual(hoursOf(outcome), { Azov: 1, Extract: 1 });
  assert.equal(outcome.status === "ok" && outcome.allocation.rough, true, "all counted time was parallel → rough");
  assert.match(outcome.block, /цифри грубі/);
});

test("partial overlap: exclusive time stays with its card; rough only when parallel time is material", () => {
  // a: 10:00–14:00; b: 13:00–14:00 → a gets 3 + 0.5, b 0.5; parallel 1 h of 4 h = 25 % → rough.
  const actions = [move("a", "2026-09-28T07:00:00Z", "LW", "LP"), move("b", "2026-09-28T10:00:00Z", "LW", "LP"), move("a", "2026-09-28T11:00:00Z", "LP", "LD"), move("b", "2026-09-28T11:00:00Z", "LP", "LD")];
  const cards = [cardOf("a", "LD", "Azov"), cardOf("b", "LD", "Azov")];
  const outcome = computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: WORK });
  assert.deepEqual(hoursOf(outcome), { Azov: 4 });
  // a: 10:00–14:00; b: 13:30–14:00 → parallel 0.5 of 4 h = 12.5 % → not rough.
  const light = [move("a", "2026-09-28T07:00:00Z", "LW", "LP"), move("b", "2026-09-28T10:30:00Z", "LW", "LP"), move("a", "2026-09-28T11:00:00Z", "LP", "LD"), move("b", "2026-09-28T11:00:00Z", "LP", "LD")];
  const lightOutcome = computeWeeklyTime({ cards, lists: LISTS, actions: light, coverage: FULL, window: WEEK, config: WORK });
  assert.equal(lightOutcome.status === "ok" && lightOutcome.allocation.rough, false);
  assert.doesNotMatch(lightOutcome.block, /грубі/);
});

test("project aggregation by current label; unlabelled → «без проєкту», listed last", () => {
  const actions = [move("a", "2026-09-28T07:00:00Z", "LW", "LP"), move("a", "2026-09-28T08:00:00Z", "LP", "LD"),
    move("c", "2026-09-29T07:00:00Z", "LW", "LP"), move("c", "2026-09-29T10:00:00Z", "LP", "LD"),
    move("u", "2026-09-30T07:00:00Z", "LW", "LP"), move("u", "2026-09-30T12:00:00Z", "LP", "LD")];
  const cards = [cardOf("a", "LD", "Cossack Labs"), cardOf("c", "LD", "Cossack Labs"), cardOf("u", "LD", null)];
  const outcome = computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: WORK });
  assert.deepEqual(outcome.status === "ok" && outcome.allocation.totals.map((t) => t.project), ["Cossack Labs", UNLABELLED_PROJECT]);
  assert.equal(outcome.block, [`⏱ Час по проєктах ${TIME_REPORT_LABEL} (робочі години 10:00–18:00):`, "Cossack Labs — 4 год", "без проєкту — 5 год"].join("\n"));
});

test("daily cap: default 8 h scales every card of that day proportionally and says so; the cap is configurable", () => {
  const nine = parseRhythmConfig("work_hours: 09:00-19:00").config; // 10 h window
  const actions = [move("a", "2026-09-28T06:00:00Z", "LW", "LP"), move("a", "2026-09-28T16:00:00Z", "LP", "LD"),
    move("b", "2026-09-28T06:00:00Z", "LW", "LP"), move("b", "2026-09-28T16:00:00Z", "LP", "LD")];
  const cards = [cardOf("a", "LD", "Azov"), cardOf("b", "LD", "Extract")];
  const capped = computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: nine });
  assert.deepEqual(hoursOf(capped), { Azov: 4, Extract: 4 }, "10 h union → 8 h, split 4 + 4");
  assert.equal(capped.status === "ok" && capped.allocation.cappedDays, 1);
  assert.match(capped.block, /Ліміт 8 год на день урізав 1 день: у такі дні час кожного проєкту зменшено пропорційно\./);
  const six = parseRhythmConfig("work_hours: 09:00-19:00\ndaily_time_cap: 6h").config;
  assert.deepEqual(hoursOf(computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: six })), { Azov: 3, Extract: 3 });
  const twelve = parseRhythmConfig("work_hours: 09:00-19:00\ndaily_time_cap: 12h").config;
  assert.deepEqual(hoursOf(computeWeeklyTime({ cards, lists: LISTS, actions, coverage: FULL, window: WEEK, config: twelve })), { Azov: 5, Extract: 5 });
});

test("DST: the week that contains the autumn change counts real working hours each day", () => {
  // Mon 26.10.2026 is EET (UTC+2): 10:00–18:00 Kyiv = 08:00–16:00Z.
  const window = { from: new Date("2026-10-25T22:00:00Z"), to: new Date("2026-10-27T00:00:00Z") };
  const outcome = computeWeeklyTime({ cards: [cardOf("a", "LD", "Azov")], lists: LISTS, coverage: FULL, window, config: WORK,
    actions: [move("a", "2026-10-26T07:00:00Z", "LW", "LP"), move("a", "2026-10-26T09:00:00Z", "LP", "LD")] });
  assert.deepEqual(hoursOf(outcome), { Azov: 1 }, "07:00Z is 09:00 Kyiv in winter time: only 10:00–11:00 counts");
});

test("unavailable, never guessed: no work_hours, incomplete history, or a failed read", async () => {
  const noHours = computeWeeklyTime({ cards: [], lists: LISTS, actions: [], coverage: FULL, window: WEEK, config: parseRhythmConfig("").config });
  assert.equal(noHours.status, "unavailable");
  assert.equal(noHours.block, "⏱ Час по проєктах: недоступний — не задані робочі години (work_hours у /rhythm.md). Годин не оцінюю.");
  const truncated = computeWeeklyTime({ cards: [], lists: LISTS, actions: [], coverage: { ...FULL, truncated: true }, window: WEEK, config: WORK });
  assert.equal(truncated.status === "unavailable" && truncated.reason, "history_incomplete");
  let reads = 0;
  const failing: WeeklyTimeReader = {
    resolveSingleBoard: async () => { reads += 1; return { id: "b", name: "B" }; },
    readCards: async () => { throw new Error("401"); }, readLists: async () => LISTS,
    readActions: async () => ({ actions: [], coverage: FULL }),
  };
  const failed = await createWeeklyTimeReporter({ reader: failing })({ now: new Date("2026-10-02T13:30:00Z"), config: WORK });
  assert.equal(failed.status === "unavailable" && failed.reason, "history_unavailable");
  const skipped = await createWeeklyTimeReporter({ reader: failing })({ now: new Date("2026-10-02T13:30:00Z"), config: parseRhythmConfig("").config });
  assert.equal(skipped.status === "unavailable" && skipped.reason, "work_hours_missing");
  assert.equal(reads, 1, "no Trello read without work hours");
});

test("the reporter reads this week (Mon 00:00 Kyiv → now) through the same GET-only history client shape", async () => {
  const windows: Array<{ from: string; to: string }> = [];
  const reader: WeeklyTimeReader = {
    resolveSingleBoard: async () => ({ id: "b", name: "B" }), readCards: async () => [cardOf("a", "LP", "Azov")], readLists: async () => LISTS,
    readActions: async (_board, window) => { windows.push({ from: window.from.toISOString(), to: window.to.toISOString() }); return { actions: [move("a", "2026-10-02T07:00:00Z", "LW", "LP")], coverage: FULL }; },
  };
  const outcome = await createWeeklyTimeReporter({ reader })({ now: new Date("2026-10-02T13:30:00Z"), config: WORK });
  assert.deepEqual(windows, [{ from: "2026-09-27T21:00:00.000Z", to: "2026-10-02T13:30:00.000Z" }]);
  assert.deepEqual(hoursOf(outcome), { Azov: 6.5 });
  // One client for history: the module never fetches or writes on its own.
  assert.doesNotMatch(readFileSync(join(repoRoot, "src", "weeklyTime.ts"), "utf8"), /\bfetch\(|api\.trello\.com|trelloWrite/);
});

test("rendering: half-hour rounding with a decimal comma; tiny shares are shown, not dropped", () => {
  assert.equal(formatReportHours(14 * H), "14 год");
  assert.equal(formatReportHours(7.4 * H), "7,5 год");
  assert.equal(formatReportHours(10 * 60_000), "< 0,5 год");
  const block = renderWeeklyTimeBlock({ totals: [{ project: "Azov", ms: 14 * H }], cards: [{ cardId: "a", project: "Azov", ms: 14 * H }], countedMs: 14 * H, unionMs: 14 * H, parallelMs: 0, cappedDays: 3, rough: false }, WORK);
  assert.match(block, /Ліміт 8 год на день урізав 3 дні/);
});

test("Friday exact relay order: work-history facts → time block → Claude's commentary, bytes unchanged", () => {
  const history = "Цього тижня на дошці:\n\n- **Перейшло в Done:** 2 — «А» та «Б»";
  const block = "⏱ Час по проєктах ≈ за переміщеннями в Trello (робочі години 10:00–18:00):\nAzov — 14 год";
  const reply = `${history}\n\n---\nPM-висновок:\n⏸ Не рухалось: сайт Limen.\n💭 Azov з'їв тиждень.`;
  assert.equal(composeWeeklyTimeReply(reply, history, block), `${history}\n\n${block}\n\n---\nPM-висновок:\n⏸ Не рухалось: сайт Limen.\n💭 Azov з'їв тиждень.`);
  assert.equal(composeWeeklyTimeReply(history, history, block), `${history}\n\n${block}`, "answer-only history");
  // No verified history block (unavailable/unverified): the code block leads; the model text follows untouched.
  assert.equal(composeWeeklyTimeReply("Історія недоступна.\n⏸ …", undefined, block), `${block}\n\nІсторія недоступна.\n⏸ …`);
  // A model reply that merely resembles the history text is never treated as the verified block.
  assert.equal(composeWeeklyTimeReply("Azov — 20 год", "Цього тижня", block), `${block}\n\nAzov — 20 год`);
});
