import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { composeProjectTimeReply, connectToDjonik, createCustomToolRouter, type DjonikTraceEvent } from "./djonikClient.js";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { createProjectTimeExecutor } from "./projectTimeTool.js";
import type { TrelloAction, TrelloHistoryCard } from "./trelloWorkHistory.js";
import type { WeeklyTimeReader } from "./weeklyTime.js";

// #62 through the real `connectToDjonik` pipeline: one ordinary turn → the read-only `trello_project_time` executor
// (once per custom_tool_use_id, #40) → the code-owned `answer_text` reaches Daniel byte for byte. Scripted
// official-shape events; zero network, zero inference.

const NOW = new Date("2026-10-02T13:30:00Z"); // Fri 16:30 Kyiv
const WORK = parseRhythmConfig("work_hours: 10:00-18:00").config;
const LISTS = [{ id: "LW", name: "This week" }, { id: "LP", name: "In progress" }, { id: "LD", name: "Done" }];
const CARDS: TrelloHistoryCard[] = [
  { id: "5f0c0ffee000000000000001", name: "Пін Азов", idList: "LD", labels: [{ name: "A1" }] },
  { id: "5f0c0ffee000000000000002", name: "Допис в Instagram", idList: "LD", labels: [{ name: "A1" }] },
  { id: "5f0c0ffee000000000000003", name: "Логотип", idList: "LD", labels: [{ name: "Extract" }] },
];
const stint = (card: string, start: string, end: string): TrelloAction[] => [
  { type: "updateCard", date: end, data: { card: { id: card }, listBefore: LISTS[1], listAfter: LISTS[2] } },
  { type: "updateCard", date: start, data: { card: { id: card }, listBefore: LISTS[0], listAfter: LISTS[1] } },
];
const ACTIONS = [
  ...stint(CARDS[0].id, "2026-09-28T07:00:00Z", "2026-09-28T10:00:00Z"),
  ...stint(CARDS[1].id, "2026-09-29T07:00:00Z", "2026-09-29T08:30:00Z"),
  ...stint(CARDS[2].id, "2026-09-30T07:00:00Z", "2026-09-30T09:00:00Z"),
];
const ANSWER = [
  "A1 — ≈ 4,5 год цього тижня", "", "По задачах:", "• Пін Азов — ≈ 3 год", "• Допис в Instagram — ≈ 1,5 год", "",
  "≈ за переміщеннями в Trello, з точністю до пів години (робочі години 10:00–18:00)",
].join("\n");
const MISSING = "Час по A1 цього тижня не можу оцінити: у /rhythm.md не задані work_hours.\nЯкщо хочеш — задамо робочі години.";

function scripted() {
  const sendCalls: Array<{ events: Array<Record<string, unknown>> }> = [];
  const queue: unknown[] = [];
  const waiters: Array<(result: { value: unknown; done: boolean }) => void> = [];
  const push = (...events: unknown[]) => {
    for (const event of events) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    }
  };
  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<{ value: unknown; done: boolean }> =>
        queue.length > 0 ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise((resolve) => waiters.push(resolve)),
    }),
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "sesn_time" }),
        events: { stream: async () => stream, send: async (_id: string, params: { events: Array<Record<string, unknown>> }) => { sendCalls.push(params); } },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls, push };
}

const use = (id: string, input: unknown) => ({ type: "agent.custom_tool_use", id, name: "trello_project_time", input });
const requiresAction = (idleId: string, ...ids: string[]) => ({ type: "session.status_idle", id: idleId, stop_reason: { type: "requires_action", event_ids: ids } });
const echo = (id: string) => ({ type: "user.custom_tool_result", id: `echo_${id}`, custom_tool_use_id: id, is_error: false, content: [] });
const msg = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });
const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };

async function open(config = WORK) {
  const s = scripted();
  const reads: string[] = [];
  const reader: WeeklyTimeReader = {
    resolveSingleBoard: async () => { reads.push("board"); return { id: "b", name: "B" }; },
    readCards: async () => { reads.push("cards"); return CARDS; },
    readLists: async () => { reads.push("lists"); return LISTS; },
    readActions: async () => { reads.push("actions"); return { actions: ACTIONS, coverage: { pagesRead: 1, truncated: false, oldestActionReached: true } }; },
  };
  const executions: string[] = [];
  const time = createProjectTimeExecutor({ reader, readConfig: async () => config, now: () => NOW });
  const router = createCustomToolRouter({
    projectTime: async (input) => { executions.push("time"); return time(input); },
    workHistory: async () => { executions.push("history"); return { isError: false, content: JSON.stringify({ answer_text: "Цього тижня на дошці: …" }) }; },
    boardSnapshot: async () => { executions.push("snapshot"); return { isError: false, content: "{}" }; },
  });
  const traces: DjonikTraceEvent[] = [];
  const session = await connectToDjonik(s.client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event), undefined, "telegram", router, { now: () => NOW });
  const results = () => s.sendCalls.flatMap((call) => call.events).filter((event) => event.type === "user.custom_tool_result");
  const relay = () => traces.filter((trace) => trace.type === "project_time_relay_composed" || trace.type === "project_time_relay_skipped");
  return { ...s, session, executions, reads, results, traces, relay };
}

test("12/13. an ordinary time question reaches the project-time executor exactly once; its answer_text is the visible reply, unchanged", async () => {
  const t = await open();
  t.push(
    use("sevt_T", { project_label: "A1" }),
    use("sevt_T", { project_label: "A1" }), // replayed event (reconnect catch-up)
    requiresAction("idle_1", "sevt_T"),
    requiresAction("idle_2", "sevt_T"), // re-emitted status
    echo("sevt_T"),
    IDLE_OK,
  );
  const turn = await t.session.sendTraced([{ type: "text", text: "Скільки часу цього тижня я витратив на Азов?" }], "user_message");
  assert.deepEqual(t.executions, ["time"], "one execution, never trello_work_history");
  assert.equal(t.results().length, 1);
  assert.equal(turn.reply, ANSWER, "byte for byte the code-owned answer");
  assert.deepEqual(turn.toolUses, [{ kind: "custom", name: "trello_project_time", readOnly: true }]);
  assert.deepEqual(t.relay(), [{ type: "project_time_relay_composed", mode: "answer_only" }]);
  // The model saw the same answer_text the user sees, and nothing to recompute from.
  const submitted = JSON.parse(((t.results()[0].content as Array<{ text: string }>)[0]).text);
  assert.equal(submitted.answer_text, ANSWER);
  assert.ok(!JSON.stringify(submitted).includes("5f0c0ffee"), "no card id reaches the model or Daniel");
  t.session.close();
});

test("13. model text cannot alter the numbers: a model-only hour figure is withheld; the code answer stays exact", async () => {
  const t = await open();
  t.push(use("sevt_D", { project_label: "A1" }), requiresAction("idle_1", "sevt_D"), echo("sevt_D"),
    msg("A1 — 12 год цього тижня, найбільше на пін."), IDLE_OK);
  const reply = await t.session.send("Скільки часу цього тижня я витратив на Азов?");
  assert.equal(reply, ANSWER);
  assert.doesNotMatch(reply, /12 год/);
  assert.deepEqual(t.relay(), [{ type: "project_time_relay_composed", mode: "commentary_withheld" }]);
  t.session.close();
});

test("13. one short number-free line may follow the code answer, after it and untouched", async () => {
  const t = await open();
  t.push(use("sevt_C", { project_label: "A1" }), requiresAction("idle_1", "sevt_C"), echo("sevt_C"),
    msg("Схоже, основний час забрав пін."), IDLE_OK);
  const reply = await t.session.send("Скільки часу цього тижня я витратив на Азов?");
  assert.equal(reply, `${ANSWER}\n\nСхоже, основний час забрав пін.`);
  assert.ok(reply.startsWith(ANSWER));
  t.session.close();
});

test("7 via the client: missing work_hours → the compact unavailable answer, no Trello read, no history fallback", async () => {
  const t = await open(parseRhythmConfig("").config);
  t.push(use("sevt_M", { project_label: "A1" }), requiresAction("idle_1", "sevt_M"), echo("sevt_M"), IDLE_OK);
  const reply = await t.session.send("А чи можеш ти подивитись по трело, скільки часу я потратив цього тижня на азов?");
  assert.equal(reply, MISSING);
  assert.deepEqual(t.executions, ["time"]);
  assert.deepEqual(t.reads, [], "no Trello read at all");
  t.session.close();
});

test("not a generic relay: two project-time calls, or an error result, are never relayed — the coordinator text stands", async () => {
  const two = await open();
  two.push(use("sevt_1", { project_label: "A1" }), use("sevt_2", { project_label: "A1" }), requiresAction("idle_1", "sevt_1", "sevt_2"),
    echo("sevt_1"), echo("sevt_2"), msg("Не можу однозначно відповісти."), IDLE_OK);
  assert.equal(await two.session.send("Скільки часу на A1?"), "Не можу однозначно відповісти.");
  assert.deepEqual(two.relay(), [{ type: "project_time_relay_skipped" }]);
  two.session.close();

  const bad = await open();
  bad.push(use("sevt_E", { label: "A1" }), requiresAction("idle_1", "sevt_E"), echo("sevt_E"), msg("Не вийшло порахувати."), IDLE_OK);
  assert.equal(await bad.session.send("Скільки часу на A1?"), "Не вийшло порахувати.");
  assert.deepEqual(bad.relay(), [{ type: "project_time_relay_skipped" }]);
  bad.session.close();

  // Other custom tools are untouched by #62: a board snapshot turn is the model's reply, with no relay trace.
  const snap = await open();
  snap.push({ type: "agent.custom_tool_use", id: "sevt_S", name: "trello_board_snapshot", input: {} }, requiresAction("idle_1", "sevt_S"),
    echo("sevt_S"), msg("На дошці три картки в роботі."), IDLE_OK);
  assert.equal(await snap.session.send("Що на дошці?"), "На дошці три картки в роботі.");
  assert.deepEqual(snap.relay(), []);
  snap.session.close();
});

test("composition: code-owned commentary (a verified write, a reminder) is never withheld, even with an hour figure", () => {
  assert.deepEqual(composeProjectTimeReply("⏱ Таймер 2 год для картки встановлено.", ANSWER, { modelOnly: false }),
    { text: `${ANSWER}\n\n⏱ Таймер 2 год для картки встановлено.`, mode: "with_commentary" });
  assert.deepEqual(composeProjectTimeReply("   ", ANSWER, { modelOnly: true }), { text: ANSWER, mode: "answer_only" });
  assert.deepEqual(composeProjectTimeReply("Разом 4.5h", ANSWER, { modelOnly: true }), { text: ANSWER, mode: "commentary_withheld" });
});
