import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { buildSignalFacts } from "./rhythmFacts.js";
import {
  advanceFocus,
  currentFocus,
  detectTimeboxSignals,
  emptyFocusLedger,
  FocusLedgerError,
  validateFocusLedger,
  type FocusLedger,
} from "./rhythmFocus.js";
import type { CardFact } from "./rhythmSignals.js";
import type { TrelloAction, TrelloBoardCard, TrelloList } from "./trelloWorkHistory.js";

// #50 focus from Trello moves: code-owned, content-light, zero model calls.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = parseRhythmConfig("work_hours: 10:00-18:00").config;

const card = (id: string, list: CardFact["list"], enteredListAt: string | null, project: string | null = "azov"): CardFact => ({
  id, name: `Card ${id}`, project, list, due: null, dueComplete: false, enteredListAt, reopenedFromDoneAt: null,
});

test("a card entering In progress starts a stint from authoritative history; the model is never involved", () => {
  const lists: TrelloList[] = [{ id: "L1", name: "This week" }, { id: "L2", name: "In progress" }, { id: "L3", name: "Waiting" }];
  const cards: TrelloBoardCard[] = [{ id: "c1", name: "Банер", idList: "L2", labels: [{ name: "Azov" }] }];
  const move: TrelloAction = { id: "a1", type: "updateCard", date: "2026-09-28T08:40:00.000Z",
    data: { card: { id: "c1" }, listBefore: { id: "L1", name: "This week" }, listAfter: { id: "L2", name: "In progress" } } };
  const facts = buildSignalFacts({ cards, lists, history: { actions: [move], coverage: { pagesRead: 1, truncated: false, oldestActionReached: true } } });
  const ledger = advanceFocus(emptyFocusLedger(), facts, new Date("2026-09-28T09:00:00Z"));
  assert.deepEqual(ledger.active.c1, { cardId: "c1", project: "azov", enteredAt: "2026-09-28T08:40:00.000Z", observedAt: "2026-09-28T09:00:00.000Z" });
  assert.equal(currentFocus(ledger).current?.cardId, "c1");
  // The collector is the only input: nothing in the focus module reads activity time or text.
  const source = readFileSync(join(repoRoot, "src", "rhythmFocus.ts"), "utf8");
  assert.doesNotMatch(source, /lastActivity|dateLastActivity|desc\b|runTurn|sendTraced/);
});

test("leaving In progress ends the stint and records where the card went; a vanished card is `gone`", () => {
  let ledger = advanceFocus(emptyFocusLedger(), { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z"), card("b", "in_progress", "2026-09-28T07:30:00.000Z")] }, new Date("2026-09-28T08:00:00Z"));
  ledger = advanceFocus(ledger, { cards: [card("a", "waiting", "2026-09-28T09:10:00.000Z")] }, new Date("2026-09-28T09:15:00Z"));
  assert.deepEqual(Object.keys(ledger.active), []);
  assert.deepEqual(ledger.ended.map((e) => [e.cardId, e.to, e.nextListEnteredAt]), [["a", "waiting", "2026-09-28T09:10:00.000Z"], ["b", "gone", null]]);
});

test("another card entering becomes the current focus; the first stays active (overlap is preserved, not ended)", () => {
  let ledger = advanceFocus(emptyFocusLedger(), { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z")] }, new Date("2026-09-28T07:05:00Z"));
  ledger = advanceFocus(ledger, { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z"), card("b", "in_progress", "2026-09-28T09:00:00.000Z", "extract")] }, new Date("2026-09-28T09:05:00Z"));
  const focus = currentFocus(ledger);
  assert.equal(focus.current?.cardId, "b");
  assert.deepEqual(focus.parallel.map((s) => s.cardId), ["a"]);
  assert.equal(ledger.ended.length, 0);
});

test("unknown entry times never outrank a known one; a degraded history read never ends a stint", () => {
  let ledger = advanceFocus(emptyFocusLedger(), { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z"), card("z", "in_progress", null)] }, new Date("2026-09-28T08:00:00Z"));
  assert.equal(currentFocus(ledger).current?.cardId, "a");
  ledger = advanceFocus(ledger, { cards: [card("a", "in_progress", null), card("z", "in_progress", null)] }, new Date("2026-09-28T08:15:00Z"));
  assert.equal(ledger.active.a.enteredAt, "2026-09-28T07:00:00.000Z");
  assert.equal(ledger.ended.length, 0);
});

test("left and re-entered between two observations: the old stint ends (`unknown`) and a new stint starts", () => {
  let ledger = advanceFocus(emptyFocusLedger(), { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z")] }, new Date("2026-09-28T07:05:00Z"));
  ledger = advanceFocus(ledger, { cards: [card("a", "in_progress", "2026-09-28T09:00:00.000Z")] }, new Date("2026-09-28T09:05:00Z"));
  assert.equal(ledger.active.a.enteredAt, "2026-09-28T09:00:00.000Z");
  assert.deepEqual(ledger.ended.map((e) => [e.cardId, e.to, e.enteredAt]), [["a", "unknown", "2026-09-28T07:00:00.000Z"]]);
});

const withBudget = (minutes: number, enteredAt = "2026-09-28T07:00:00.000Z", setAt = "2026-09-28T07:00:00.000Z"): FocusLedger => ({
  ...emptyFocusLedger(),
  active: { a: { cardId: "a", project: "azov", enteredAt, observedAt: enteredAt } },
  budgets: { a: { cardId: "a", enteredAt, minutes, setAt, toolUseId: "toolu_1" } },
});

test("a budget belongs to one stint: leaving or re-entering In progress drops it", () => {
  const left = advanceFocus(withBudget(120), { cards: [card("a", "waiting", null)] }, new Date("2026-09-28T08:00:00Z"));
  assert.deepEqual(left.budgets, {});
  const reentered = advanceFocus(withBudget(120), { cards: [card("a", "in_progress", "2026-09-28T09:00:00.000Z")] }, new Date("2026-09-28T09:05:00Z"));
  assert.deepEqual(reentered.budgets, {});
  const kept = advanceFocus(withBudget(120), { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z")] }, new Date("2026-09-28T08:00:00Z"));
  assert.equal(kept.budgets.a.minutes, 120);
});

test("timebox: no budget → no candidate, even for a card with a qualitative Size", () => {
  const ledger = advanceFocus(emptyFocusLedger(), { cards: [card("a", "in_progress", "2026-09-27T07:00:00.000Z")] }, new Date("2026-09-28T07:00:00Z"));
  // The CardFact contract has no Size at all: S/M/L/XL can never reach the timebox as a duration.
  assert.deepEqual(detectTimeboxSignals(ledger, { cards: [card("a", "in_progress", "2026-09-27T07:00:00.000Z")] }, new Date("2026-09-30T15:00:00Z"), WORK), []);
});

test("timebox: explicit 2 h budget elapses only in working time; no work_hours → no candidate", () => {
  const facts = { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z")] };
  // Mon 10:00 Kyiv + 2 working hours = 12:00 Kyiv (09:00Z).
  assert.deepEqual(detectTimeboxSignals(withBudget(120), facts, new Date("2026-09-28T08:59:00Z"), WORK), []);
  const [signal] = detectTimeboxSignals(withBudget(120), facts, new Date("2026-09-28T09:00:00Z"), WORK);
  assert.equal(signal.kind, "timebox_elapsed");
  assert.equal(signal.channel, "interrupt");
  assert.equal(signal.key, "timebox:a");
  assert.equal(signal.fingerprint, "2026-09-28T07:00:00.000Z|2026-09-28T07:00:00.000Z|120");
  assert.match(signal.fact, /бюджет Daniel 2 год робочого часу вичерпано пн 28\.09, 12:00 \(рахую з пн 28\.09, 10:00\)/);
  assert.deepEqual(detectTimeboxSignals(withBudget(120), facts, new Date("2026-09-30T09:00:00Z"), parseRhythmConfig("").config), []);
  // Evening: a budget set at 17:00 Kyiv cannot elapse overnight.
  const evening = withBudget(120, "2026-09-28T14:00:00.000Z", "2026-09-28T14:00:00.000Z");
  const eveningFacts = { cards: [card("a", "in_progress", "2026-09-28T14:00:00.000Z")] };
  assert.deepEqual(detectTimeboxSignals(evening, eveningFacts, new Date("2026-09-29T05:00:00Z"), WORK), []);
  assert.equal(detectTimeboxSignals(evening, eveningFacts, new Date("2026-09-29T08:00:00Z"), WORK).length, 1);
});

test("timebox: the budget counts from when Daniel set it when that is later than the entry; parallel work is noted", () => {
  const ledger: FocusLedger = { ...withBudget(60, "2026-09-28T07:00:00.000Z", "2026-09-28T10:00:00.000Z"),
    active: { a: { cardId: "a", project: "azov", enteredAt: "2026-09-28T07:00:00.000Z", observedAt: "x" }, b: { cardId: "b", project: null, enteredAt: "2026-09-28T08:00:00.000Z", observedAt: "x" } } };
  const facts = { cards: [card("a", "in_progress", "2026-09-28T07:00:00.000Z"), card("b", "in_progress", "2026-09-28T08:00:00.000Z")] };
  assert.equal(detectTimeboxSignals(ledger, facts, new Date("2026-09-28T10:59:00Z"), WORK).length, 0);
  const [signal] = detectTimeboxSignals(ledger, facts, new Date("2026-09-28T11:00:00Z"), WORK);
  assert.match(signal.fact, /паралельно в In progress ще 1/);
});

test("ledger validation fails closed on malformed data and accepts the empty ledger", () => {
  assert.deepEqual(validateFocusLedger(emptyFocusLedger()), emptyFocusLedger());
  assert.throws(() => validateFocusLedger({ ...emptyFocusLedger(), version: 2 }), FocusLedgerError);
  assert.throws(() => validateFocusLedger({ ...emptyFocusLedger(), budgets: { a: { cardId: "a", enteredAt: "x", minutes: 1, setAt: "x", toolUseId: "t" } } }), FocusLedgerError);
  assert.throws(() => validateFocusLedger({ ...emptyFocusLedger(), ended: [{ cardId: "a", project: null, enteredAt: null, nextListEnteredAt: null, observedAt: "2026-09-28T00:00:00Z", to: "moon" }] }), FocusLedgerError);
});
