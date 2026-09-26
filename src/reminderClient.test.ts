import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import {
  composeReminderConfirmations,
  connectToDjonik,
  defaultCustomToolExecutor,
  type DjonikCustomToolExecutor,
  type DjonikTraceEvent,
} from "./djonikClient.js";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import { autonomousWriteViolations } from "./rhythmRunner.js";
import { createMemoryRhythmStateStore, remindersOf } from "./rhythmState.js";
import { createReminderToolExecutor } from "./reminderTool.js";

// #54 through the real `connectToDjonik` pipeline: the #40 per-id lifecycle, #53-style replayed events, the
// authority captured at observation, and the code-owned confirmation relay. Scripted official-shape events;
// zero network, zero inference.

const NOW = new Date("2026-09-26T09:00:00Z"); // Saturday 12:00 Kyiv

function scripted() {
  const sendCalls: Array<{ events: Array<Record<string, unknown>> }> = [];
  const queue: unknown[] = [];
  const waiters: Array<(result: { value: unknown; done: boolean }) => void> = [];
  const sendErrors: unknown[] = [];
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
        create: async () => ({ id: "sesn_reminder" }),
        events: {
          stream: async () => stream,
          send: async (_id: string, params: { events: Array<Record<string, unknown>> }) => {
            if (params.events.some((event) => event.type === "user.custom_tool_result") && sendErrors.length > 0) {
              const error = sendErrors.shift();
              if (error !== undefined) throw error;
            }
            sendCalls.push(params);
          },
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls, push, sendErrors };
}

const use = (id: string, input: Record<string, unknown>) => ({ type: "agent.custom_tool_use", id, name: "reminder", input });
const requiresAction = (idleId: string, ...ids: string[]) => ({ type: "session.status_idle", id: idleId, stop_reason: { type: "requires_action", event_ids: ids } });
const echo = (id: string) => ({ type: "user.custom_tool_result", id: `echo_${id}`, custom_tool_use_id: id, is_error: false, content: [] });
const msg = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });
const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const running = () => ({ type: "session.status_running" });

const CREATE = { op: "create", text: "банер Azov", when: { day: "tomorrow" } };
const CONFIRMATION = "🔔 Нагадаю завтра, нд 27.09 зранку, окремим повідомленням: банер Azov";

async function open() {
  const s = scripted();
  const store = createMemoryRhythmStateStore();
  const reminder = createReminderToolExecutor({ store, now: () => NOW, readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => false });
  const calls: Array<{ input: unknown; toolUseId: string; authority: string }> = [];
  const executor: DjonikCustomToolExecutor = async (input, context) => {
    calls.push({ input, toolUseId: context.toolUseId, authority: context.authority });
    return context.name === "reminder" ? reminder(input, context) : defaultCustomToolExecutor(input, context);
  };
  const traces: DjonikTraceEvent[] = [];
  const session = await connectToDjonik(s.client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event), undefined, "telegram", executor, { now: () => NOW });
  const results = () => s.sendCalls.flatMap((call) => call.events).filter((event) => event.type === "user.custom_tool_result");
  return { ...s, store, session, calls, traces, results };
}

test("replayed custom_tool_use and a re-emitted requires_action for the same id create exactly one reminder", async () => {
  const t = await open();
  t.push(
    use("sevt_A", CREATE),
    use("sevt_A", CREATE), // a replayed event (reconnect catch-up) with the same id
    requiresAction("idle_1", "sevt_A"),
    running(),
    requiresAction("idle_2", "sevt_A"), // re-emitted status
    echo("sevt_A"),
    msg(`Готово. ${CONFIRMATION}`),
    IDLE_OK,
  );
  const reply = await t.session.send("Нагадай завтра про банер Azov");
  assert.equal(t.calls.length, 1, "one execution for one custom_tool_use_id");
  assert.equal(t.results().length, 1, "one result submission");
  assert.equal(Object.keys(remindersOf(await t.store.load()).items).length, 1);
  assert.equal(reply, `Готово. ${CONFIRMATION}`, "the model quoted the code line: nothing added");
  assert.deepEqual(t.traces.filter((trace) => trace.type === "custom_tool_result_sent"), [{ type: "custom_tool_result_sent", toolName: "reminder", isError: false }]);
  assert.deepEqual(t.traces.filter((trace) => trace.type === "reminder_confirmation_composed"), [{ type: "reminder_confirmation_composed", mode: "model_quoted", count: 1 }]);
  t.session.close();
});

test("a cached result is resubmitted after an unknown send outcome without executing again", async () => {
  const t = await open();
  t.sendErrors.push(new APIConnectionError({ message: "socket hang up" }));
  t.push(use("sevt_B", CREATE), requiresAction("idle_1", "sevt_B"), echo("sevt_B"), msg(CONFIRMATION), IDLE_OK);
  await t.session.send("Нагадай завтра про банер Azov");
  assert.equal(t.calls.length, 1);
  assert.equal(t.results().length, 1, "the resend delivered the same cached bytes");
  assert.equal(Object.keys(remindersOf(await t.store.load()).items).length, 1);
  t.session.close();
});

test("the confirmation is code-owned: a model reply that re-dates or omits it gets the resolved line first", async () => {
  const t = await open();
  t.push(use("sevt_C", CREATE), requiresAction("idle_1", "sevt_C"), echo("sevt_C"), msg("Ок, нагадаю в понеділок."), IDLE_OK);
  const reply = await t.session.send("Нагадай завтра про банер Azov");
  assert.equal(reply, `${CONFIRMATION}\n\nОк, нагадаю в понеділок.`);
  assert.deepEqual(t.traces.filter((trace) => trace.type === "reminder_confirmation_composed"), [{ type: "reminder_confirmation_composed", mode: "prepended", count: 1 }]);
  t.session.close();
});

test("a successful reminder change with no model text is still a complete answer: the confirmation itself", async () => {
  const t = await open();
  t.push(use("sevt_D", CREATE), requiresAction("idle_1", "sevt_D"), echo("sevt_D"), IDLE_OK);
  assert.equal(await t.session.send("Нагадай завтра про банер Azov"), CONFIRMATION);
  t.session.close();
});

test("a refused call adds no confirmation: nothing is claimed as saved by code", async () => {
  const t = await open();
  t.push(use("sevt_E", { op: "create", text: "x", when: { day: "today", time: "10:00" } }), requiresAction("i", "sevt_E"), echo("sevt_E"), msg("О котрій нагадати?"), IDLE_OK);
  assert.equal(await t.session.send("Нагадай сьогодні о 10"), "О котрій нагадати?");
  assert.equal(Object.keys(remindersOf(await t.store.load()).items).length, 0);
  t.session.close();
});

test("autonomous origin: a reminder mutation is refused before any state access and blocks the rhythm delivery; list is read-only", async () => {
  const t = await open();
  t.push(use("sevt_F", CREATE), requiresAction("i", "sevt_F"), echo("sevt_F"), msg("Бриф."), IDLE_OK);
  const traced = await t.session.sendTraced([{ type: "text", text: "[Робочий ритм · автоматичний хід …]" }], "rhythm_ritual");
  assert.equal(t.calls[0].authority, "autonomous_read_only");
  const content = (t.results()[0].content as Array<{ text: string }>)[0].text;
  assert.equal(JSON.parse(content).error.code, "not_allowed_in_autonomous_turn");
  assert.equal(Object.keys(remindersOf(await t.store.load()).items).length, 0);
  assert.equal(autonomousWriteViolations(traced.toolUses).length, 1, "the rhythm runner withholds this turn's text");

  t.push(use("sevt_G", { op: "list" }), requiresAction("i2", "sevt_G"), echo("sevt_G"), msg("Бриф."), IDLE_OK);
  const listed = await t.session.sendTraced([{ type: "text", text: "[Робочий ритм · автоматичний хід …]" }], "rhythm_ritual");
  assert.deepEqual(listed.toolUses, [{ kind: "custom", name: "reminder", readOnly: true }]);
  assert.equal(autonomousWriteViolations(listed.toolUses).length, 0);
  t.session.close();
});

test("authority is the OBSERVING turn's: Daniel's turn → human; the default executor never promises without a store", async () => {
  const t = await open();
  t.push(use("sevt_H", CREATE), requiresAction("i", "sevt_H"), echo("sevt_H"), msg(CONFIRMATION), IDLE_OK);
  await t.session.send("Нагадай завтра про банер Azov");
  assert.equal(t.calls[0].authority, "human");
  const refused = await defaultCustomToolExecutor({ op: "create" }, { toolUseId: "x", name: "reminder", authority: "human" });
  assert.equal(refused.isError, true);
  assert.equal(JSON.parse(refused.content).error.code, "unavailable");
  t.session.close();
});

test("typed follow-ups through ordinary turns: 'перенеси на завтра о 11' moves the same reminder; 'скасуй' cancels it", async () => {
  const t = await open();
  t.push(use("u1", { op: "create", text: "написати клієнту", when: { time: "15:00" } }), requiresAction("i1", "u1"), echo("u1"), IDLE_OK);
  await t.session.send("Нагадай о 15:00 написати клієнту");
  t.push(use("u2", { op: "snooze", match: "клієнту", when: { day: "tomorrow", time: "11:00" } }), requiresAction("i2", "u2"), echo("u2"), IDLE_OK);
  assert.equal(await t.session.send("Перенеси це нагадування на завтра об 11"), "⏰ Переніс нагадування на завтра, нд 27.09 о 11:00: написати клієнту");
  let items = Object.values(remindersOf(await t.store.load()).items);
  assert.deepEqual(items.map((item) => [item.seq, item.status, item.schedule.dueAt]), [[2, "scheduled", "2026-09-27T08:00:00.000Z"]]);
  t.push(use("u3", { op: "cancel", match: "клієнту" }), requiresAction("i3", "u3"), echo("u3"), msg("Скасовано."), IDLE_OK);
  assert.equal(await t.session.send("Скасуй нагадування про клієнта"), "🔕 Скасував нагадування: написати клієнту\n\nСкасовано.");
  items = Object.values(remindersOf(await t.store.load()).items);
  assert.equal(items[0].status, "cancelled");
  t.push(use("u4", { op: "list" }), requiresAction("i4", "u4"), echo("u4"), msg("Активних нагадувань немає."), IDLE_OK);
  assert.equal(await t.session.send("Що я просив нагадати?"), "Активних нагадувань немає.", "list adds no confirmation line");
  t.session.close();
});

test("composeReminderConfirmations: verbatim lines stay; missing ones lead; duplicates are not repeated", () => {
  assert.deepEqual(composeReminderConfirmations("Готово: A", ["A"]), { text: "Готово: A", mode: "model_quoted" });
  assert.deepEqual(composeReminderConfirmations("Готово", ["A", "B"]), { text: "A\nB\n\nГотово", mode: "prepended" });
  assert.deepEqual(composeReminderConfirmations("  ", ["A"]), { text: "A", mode: "prepended" });
});
