import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRhythmConfig, type RhythmConfig } from "./rhythmConfig.js";
import { createFocusBudgetExecutor, FOCUS_BUDGET_TOOL, type FocusCardReader } from "./focusBudgetTool.js";
import { createMemoryRhythmStateStore, emptyRhythmState, focusOf, type RhythmStateStore } from "./rhythmState.js";
import type { TrelloAction, TrelloCardState } from "./trelloWorkHistory.js";

// #50 focus_budget: side-effecting custom tool over code-owned rhythm state (docs/01 §13). Zero network.

const CARD = "a".repeat(24);
const OTHER = "b".repeat(24);
const NOW = new Date("2026-09-28T08:40:00Z"); // Mon 11:40 Kyiv

function world(options: { card?: Partial<TrelloCardState>; entry?: TrelloAction | null; config?: RhythmConfig; store?: RhythmStateStore | null } = {}) {
  const store = options.store === undefined ? createMemoryRhythmStateStore(emptyRhythmState()) : options.store;
  let reads = 0;
  const reader: FocusCardReader = {
    readCardState: async () => { reads += 1; return { name: "Банер збору", closed: false, dueComplete: false, listName: "In progress", listId: "LP", ...options.card }; },
    readLatestListEntry: async () => (options.entry === undefined
      ? { id: "act", type: "updateCard", date: "2026-09-28T08:38:00.000Z", data: { card: { id: CARD }, listBefore: { id: "LW", name: "This week" }, listAfter: { id: "LP", name: "In progress" } } }
      : options.entry),
  };
  const logs: string[] = [];
  const execute = createFocusBudgetExecutor({ store, reader, now: () => NOW, readConfig: async () => options.config ?? parseRhythmConfig("work_hours: 10:00-18:00").config, log: (line) => logs.push(line) });
  return { store, execute, logs, reads: () => reads };
}

const parse = (content: string) => JSON.parse(content) as { ok: boolean; op: string; confirmation?: string; error?: { code: string } };

test("schema: only explicit minutes Daniel gave; no Size field, no invented remote id", () => {
  const properties = Object.keys(FOCUS_BUDGET_TOOL.input_schema.properties);
  assert.deepEqual(properties, ["op", "card_id", "minutes"]);
  assert.match(FOCUS_BUDGET_TOOL.description, /never derive minutes from Size \(S\/M\/L\/XL are not durations\)/);
  assert.match(FOCUS_BUDGET_TOOL.description, /fresh Trello read in this turn/);
});

test("set: binds the budget to the card's current In-progress stint and returns a code-owned confirmation", async () => {
  const w = world();
  const result = await w.execute({ op: "set", card_id: CARD, minutes: 120 }, { toolUseId: "toolu_1", authority: "human" });
  const body = parse(result.content);
  assert.equal(result.isError, false);
  assert.equal(body.confirmation, "⏱ Бюджет на «Банер збору»: 2 год робочого часу, рахую з пн 28.09, 11:40; після пн 28.09, 13:40 перевірю, чи варто перемикатись.");
  const focus = focusOf(await w.store!.load());
  assert.deepEqual(focus.budgets[CARD], { cardId: CARD, enteredAt: "2026-09-28T08:38:00.000Z", minutes: 120, setAt: NOW.toISOString(), toolUseId: "toolu_1" });
  assert.equal(focus.active[CARD].enteredAt, "2026-09-28T08:38:00.000Z");
  assert.equal(Object.keys(focus.toolCalls).length, 1);
});

test("idempotency: the same custom_tool_use_id replays its recorded result and applies nothing again", async () => {
  const w = world();
  const first = await w.execute({ op: "set", card_id: CARD, minutes: 120 }, { toolUseId: "toolu_1", authority: "human" });
  const before = await w.store!.load();
  const readsBefore = w.reads();
  const replay = await w.execute({ op: "set", card_id: CARD, minutes: 30 }, { toolUseId: "toolu_1", authority: "human" });
  assert.deepEqual(replay, first);
  assert.deepEqual(await w.store!.load(), before, "no second mutation");
  assert.equal(w.reads(), readsBefore, "no Trello re-read for a recorded id");
  // A restart (new executor, same durable store) still replays.
  const restarted = createFocusBudgetExecutor({ store: w.store, reader: null, now: () => NOW, readConfig: async () => parseRhythmConfig("").config });
  assert.deepEqual(await restarted({ op: "set", card_id: CARD, minutes: 30 }, { toolUseId: "toolu_1", authority: "human" }), first);
});

test("autonomous rhythm turns cannot set or clear a budget — refused before any Trello read or state access", async () => {
  let touched = false;
  const store: RhythmStateStore = { load: async () => { touched = true; return emptyRhythmState(); }, update: async () => { touched = true; return emptyRhythmState(); } };
  const w = world({ store });
  for (const op of [{ op: "set", card_id: CARD, minutes: 60 }, { op: "clear", card_id: CARD }]) {
    const result = await w.execute(op, { toolUseId: `t_${op.op}`, authority: "autonomous_read_only" });
    assert.equal(parse(result.content).error?.code, "not_allowed_in_autonomous_turn");
  }
  assert.equal(touched, false);
  assert.equal(w.reads(), 0);
});

test("target proof: a card not In progress, or without an authoritative entry, gets zero writes", async () => {
  for (const [options, code] of [
    [{ card: { listName: "This week", listId: "LW" } }, "not_in_progress"],
    [{ card: { closed: true } }, "not_in_progress"],
    [{ entry: null }, "entry_unknown"],
    [{ entry: { id: "x", type: "updateCard", date: "2026-09-28T08:00:00Z", data: { card: { id: CARD }, listBefore: { id: "LP" }, listAfter: { id: "LA", name: "Waiting" } } } }, "entry_unknown"],
    [{ entry: { id: "x", type: "updateCard", date: "2026-09-28T08:00:00Z", data: { card: { id: OTHER }, listBefore: { id: "LW" }, listAfter: { id: "LP", name: "In progress" } } } }, "entry_unknown"],
  ] as const) {
    const w = world(options as Parameters<typeof world>[0]);
    const result = await w.execute({ op: "set", card_id: CARD, minutes: 60 }, { toolUseId: "t", authority: "human" });
    assert.equal(parse(result.content).error?.code, code, JSON.stringify(options));
    assert.deepEqual(await w.store!.load(), emptyRhythmState(), "nothing written");
  }
});

test("invalid input: no Size words, no hours outside bounds, strict card id", async () => {
  const w = world();
  for (const input of [{ op: "set", card_id: CARD, size: "M" }, { op: "set", card_id: CARD, minutes: 5 }, { op: "set", card_id: CARD, minutes: 1.5 }, { op: "set", card_id: "Банер", minutes: 60 }, { op: "start", card_id: CARD }]) {
    assert.equal(parse((await w.execute(input, { toolUseId: "t", authority: "human" })).content).error?.code, "invalid_input", JSON.stringify(input));
  }
  assert.deepEqual(await w.store!.load(), emptyRhythmState());
});

test("no work_hours: the budget is stored but the confirmation says honestly that the timer will not fire", async () => {
  const w = world({ config: parseRhythmConfig("").config });
  const body = parse((await w.execute({ op: "set", card_id: CARD, minutes: 90 }, { toolUseId: "t", authority: "human" })).content);
  assert.match(body.confirmation!, /1,5 год робочого часу.*Робочі години \(work_hours\) не задані — таймер не спрацює/);
});

test("clear removes only that card's budget and is verified; a missing store is unavailable, never a promise", async () => {
  const w = world();
  await w.execute({ op: "set", card_id: CARD, minutes: 60 }, { toolUseId: "t1", authority: "human" });
  const cleared = parse((await w.execute({ op: "clear", card_id: CARD }, { toolUseId: "t2", authority: "human" })).content);
  assert.equal(cleared.confirmation, "⏱ Таймер для цієї картки знято.");
  assert.deepEqual(focusOf(await w.store!.load()).budgets, {});
  const none = world({ store: null });
  assert.equal(parse((await none.execute({ op: "set", card_id: CARD, minutes: 60 }, { toolUseId: "t", authority: "human" })).content).error?.code, "unavailable");
});

test("postcondition: a store that loses the write is reported as not verified", async () => {
  const inner = createMemoryRhythmStateStore(emptyRhythmState());
  let writes = 0;
  const lossy: RhythmStateStore = { load: inner.load, update: async (mutate) => { writes += 1; mutate(await inner.load()); return inner.load(); } };
  const w = world({ store: lossy });
  const result = await w.execute({ op: "set", card_id: CARD, minutes: 60 }, { toolUseId: "t", authority: "human" });
  assert.equal(writes, 1);
  assert.equal(parse(result.content).error?.code, "not_verified");
});
