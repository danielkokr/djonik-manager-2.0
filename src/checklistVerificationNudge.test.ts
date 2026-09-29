import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildVerificationNudgeText,
  connectToDjonik,
  DjonikTracedTurnError,
  DjonikUnverifiedMutationError,
  type DjonikSessionHandle,
  type DjonikTraceEvent,
} from "./djonikClient.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import { formatUserFacingError, UNVERIFIED_MUTATION_TEXT } from "./telegramAdapter.js";
import type { GroupedIntake } from "./messageGrouping.js";

// ---------------------------------------------------------------------------------------------
// Issue #56 production defect: Daniel confirmed a checklist proposal for RDAS («Так»), Trello got the
// checklist and all four items, but the turn ended without the checklist read-back. Checklist writes
// were excluded from the one bounded verification nudge, so the turn failed closed and Telegram
// showed the internal verifier diagnostic with raw ARIs. These tests drive the real
// `connectToDjonik` pipeline (and the real Telegram dispatch) with official-shape events.
// ---------------------------------------------------------------------------------------------

const CARD = "ari:cloud:trello::card/aaaaaaaaaaaaaaaaaaaaaaaa";
const CHECK = "ari:cloud:trello::checklist/bbbbbbbbbbbbbbbbbbbbbbbb";
const ITEMS = ["Знайти референси концепцій", "Задизайнити сторінку кейсу (UI + 3D)", "Показати колегам", "Відправити на верстку"];
const itemId = (index: number) => `ari:cloud:trello::checkitem/${String(index).repeat(24)}`;

function createScripted() {
  const sendCalls: unknown[] = [];
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
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<{ value: unknown; done: boolean }> =>
          queue.length > 0 ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise((resolve) => waiters.push(resolve)),
      };
    },
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "sesn_test" }),
        events: { stream: async () => stream, send: async (_id: string, params: unknown) => { sendCalls.push(params); } },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls, push };
}

async function open() {
  const traces: DjonikTraceEvent[] = [];
  const scripted = createScripted();
  const session = await connectToDjonik(scripted.client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event));
  return { ...scripted, session, traces };
}

const IDLE_OK = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const msg = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: "agent.mcp_tool_use", id, name, mcp_server_name: "trello", input });
const res = (id: string, value: unknown, isError = false) => ({
  type: "agent.mcp_tool_result",
  id: `${id}_result`,
  mcp_tool_use_id: id,
  is_error: isError,
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/** The observed production writes: create + four add_item into that checklist, all successful. */
const productionWrites = () => [
  use("w_create", "trelloWriteChecklist", { action: "create", cardId: CARD, name: "Чекліст" }),
  res("w_create", { id: CHECK, name: "Чекліст", checkItems: [] }),
  ...ITEMS.flatMap((text, index) => [
    use(`w_item_${index}`, "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text }),
    res(`w_item_${index}`, { id: itemId(index + 1), name: text }),
  ]),
];
const listByCard = (id = "r_list") => [
  use(id, "trelloReadChecklist", { action: "list_by_card", cardId: CARD }),
  res(id, { checklists: [{ id: CHECK, name: "Чекліст", items: ITEMS.map((name, index) => ({ id: itemId(index + 1), name })) }] }),
];
const getChecklist = (id = "r_get") => [
  use(id, "trelloReadChecklist", { action: "get", checklistId: CHECK }),
  res(id, { id: CHECK, name: "Чекліст", checkItems: ITEMS.map((name, index) => ({ id: itemId(index + 1), name })) }),
];

const nudgeTextOf = (params: unknown): string => {
  const events = (params as { events: Array<{ type: string; content: Array<{ type: string; text?: string }> }> }).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "user.message", "the nudge is a plain user message — never a tool result or confirmation");
  assert.equal(events[0].content.length, 1);
  return events[0].content[0].text ?? "";
};

test("#56 production case: one nudge asks only for list_by_card + one get; all five writes verify; normal reply", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(
    ...productionWrites(),
    msg("Готово, чекліст додано."),
    IDLE_OK,
    // --- the one corrective verification nudge ---
    ...listByCard(),
    ...getChecklist(),
    msg("Додав чекліст «Чекліст» на RDAS: 4 пункти, перевірено."),
    IDLE_OK,
  );
  const reply = await session.send("Так");
  assert.equal(reply, "Додав чекліст «Чекліст» на RDAS: 4 пункти, перевірено.");
  assert.equal(sendCalls.length, 2, "Daniel's turn plus exactly one verification nudge");

  const nudge = nudgeTextOf(sendCalls[1]);
  assert.ok(nudge.startsWith("Системна перевірка: у цьому turn є Trello-запис"), "decisionTrace still recognises it as a nudge");
  assert.equal(nudge.match(/trelloReadChecklist \(action list_by_card, cardId /g)?.length, 1);
  assert.equal(nudge.match(/trelloReadChecklist \(action get, checklistId /g)?.length, 1, "four items → ONE checklist get");
  assert.ok(nudge.includes(`cardId ${CARD}`) && nudge.includes(`checklistId ${CHECK}`));
  assert.ok(!/trelloReadCard/.test(nudge), "no card read for checklist writes");
  assert.ok(!/trelloWrite/.test(nudge), "never names a write tool");
  assert.match(nudge, /НЕ повторюй жоден запис/);

  assert.deepEqual(
    traces.filter((t) => t.type === "verification_nudge_sent"),
    [{ type: "verification_nudge_sent", attempt: 1, readKinds: ["checklist_list", "checklist_get"] }],
  );
  assert.equal(traces.some((t) => t.type === "write_unverified_failure"), false);
  session.close();
});

test("#56 I: still unverified after the one nudge → fail closed, no second nudge, nothing replayed", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(
    ...productionWrites(),
    msg("Готово."),
    IDLE_OK,
    // nudge rerun: only the create is read back; the items stay unconfirmed
    ...listByCard(),
    msg("Все готово!"),
    IDLE_OK,
  );
  let error: unknown;
  try {
    await session.send("Так");
  } catch (caught) {
    error = caught;
  }
  const inner = error instanceof DjonikTracedTurnError ? error.error : error;
  assert.ok(inner instanceof DjonikUnverifiedMutationError, `expected DjonikUnverifiedMutationError, got ${String(error)}`);
  assert.equal(sendCalls.length, 2, "exactly one nudge — never a second");
  assert.equal(traces.filter((t) => t.type === "verification_nudge_sent").length, 1);
  assert.equal(traces.filter((t) => t.type === "write_unverified_failure").length, 1);
  assert.deepEqual(inner.outcomes.map((o) => o.status), ["verified", "awaiting_read", "awaiting_read", "awaiting_read", "awaiting_read"]);
  // Internal diagnostics are retained for logs; only the Telegram rendering is sanitized.
  assert.match(inner.message, /ari:cloud:trello/);
  const visible = formatUserFacingError(error);
  assert.equal(visible, UNVERIFIED_MUTATION_TEXT);
  session.close();
});

test("#56 I': a nudge rerun that ends without any read also fails closed after one nudge", async () => {
  const { session, push, sendCalls } = await open();
  push(...productionWrites(), msg("Готово."), IDLE_OK, msg("Так, усе додано."), IDLE_OK);
  await assert.rejects(session.send("Так"), (error: unknown) => {
    const inner = error instanceof DjonikTracedTurnError ? error.error : error;
    return inner instanceof DjonikUnverifiedMutationError && inner.outcomes.every((o) => o.status === "awaiting_read");
  });
  assert.equal(sendCalls.length, 2);
  session.close();
});

test("#56: reads the model already did in its own turn are respected — no nudge when checklist read-back is complete", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(...productionWrites(), ...listByCard(), ...getChecklist(), msg("Додав 4 пункти, перевірено."), IDLE_OK);
  assert.equal(await session.send("Так"), "Додав 4 пункти, перевірено.");
  assert.equal(sendCalls.length, 1);
  assert.equal(traces.some((t) => t.type === "verification_nudge_sent"), false);
  session.close();
});

test("#56: the nudge asks only for the still-missing read (create already read back in the turn)", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(...productionWrites(), ...listByCard(), msg("Готово."), IDLE_OK, ...getChecklist(), msg("Перевірено."), IDLE_OK);
  assert.equal(await session.send("Так"), "Перевірено.");
  const nudge = nudgeTextOf(sendCalls[1]);
  assert.ok(!/list_by_card/.test(nudge));
  assert.equal(nudge.match(/action get, checklistId/g)?.length, 1);
  assert.deepEqual(traces.find((t) => t.type === "verification_nudge_sent"), { type: "verification_nudge_sent", attempt: 1, readKinds: ["checklist_get"] });
  session.close();
});

test("#56 J: a card-only nudge keeps the exact #31 wording", () => {
  assert.equal(
    buildVerificationNudgeText([{ kind: "card", cardId: "card_A" }, { kind: "card", cardId: "card_B" }]),
    "Системна перевірка: у цьому turn є Trello-запис(и), які ще не підтверджені прямим " +
      "читанням САМЕ ТІЄЇ картки, яку вони змінили, після запису (trelloReadCard, action get). " +
      "НЕ повторюй запис і не створюй нову картку. Перш ніж відповідати користувачу, зроби окремий " +
      "trelloReadCard для кожної з цих карток: card_A, card_B. Потім повідом лише підтверджений результат " +
      "кожної зміни (або чесно скажи, якщо перевірка показала розбіжність).",
  );
});

test("#56 J: the card-write nudge path is unchanged end to end (trace carries only the card kind)", async () => {
  const { session, push, sendCalls, traces } = await open();
  push(
    use("w", "trelloWriteCard", { action: "update", cardId: "card_A", name: "A" }),
    res("w", { id: "card_A", name: "A" }),
    msg("Готово."),
    IDLE_OK,
    use("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }),
    res("r", { id: "card_A", name: "A" }),
    msg("Підтверджено."),
    IDLE_OK,
  );
  assert.equal(await session.send("Перейменуй A"), "Підтверджено.");
  assert.equal(nudgeTextOf(sendCalls[1]), buildVerificationNudgeText([{ kind: "card", cardId: "card_A" }]));
  assert.deepEqual(traces.find((t) => t.type === "verification_nudge_sent"), { type: "verification_nudge_sent", attempt: 1, readKinds: ["card"] });
  session.close();
});

// --- Telegram boundary (real dispatch → real client) ---

const typed = (text: string): GroupedIntake => ({
  text, images: [], documents: [], parts: [{ type: "text", text }],
  hasForwardedSource: false, fragmentCount: 1, textCount: 1, imageCount: 0, documentCount: 0,
  groupingReason: "single", groupingWaitMs: 0,
});

async function dispatchThroughTelegram(events: unknown[]) {
  const { session, push, sendCalls } = await open();
  const replies: string[] = [];
  const logged: unknown[] = [];
  const handlers = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session as DjonikSessionHandle, invalidate() {}, closeIfOpen() {} },
    sendMessage: async (_chat, text) => { replies.push(text); },
    logError: (_message, error) => { logged.push(error); },
  });
  push(...events);
  await handlers.onDispatch(1, 7, typed("Так"));
  session.close();
  return { replies, logged, sendCalls };
}

test("#56 Telegram: the production case now reaches Daniel as the normal reply", async () => {
  const { replies, sendCalls } = await dispatchThroughTelegram([
    ...productionWrites(), msg("Готово."), IDLE_OK, ...listByCard(), ...getChecklist(), msg("Чекліст на RDAS додано: 4 пункти."), IDLE_OK,
  ]);
  assert.deepEqual(replies, ["Чекліст на RDAS додано: 4 пункти."]);
  assert.equal(sendCalls.length, 2);
});

test("#56 Telegram: a genuinely unverified checklist write shows one safe Ukrainian line, never internals", async () => {
  const { replies, logged } = await dispatchThroughTelegram([...productionWrites(), msg("Готово."), IDLE_OK, msg("Все ок."), IDLE_OK]);
  assert.equal(replies.length, 1);
  const [visible] = replies;
  assert.equal(visible, UNVERIFIED_MUTATION_TEXT);
  for (const forbidden of [/DjonikUnverifiedMutationError/, /Djonik mutated Trello/, /ari:cloud/, /agent_/, /sesn_/, /bbbbbbbbbbbbbbbbbbbbbbbb/, /НЕ підтверджено/, /trello(Read|Write)/]) {
    assert.doesNotMatch(visible, forbidden);
  }
  assert.match(visible, /не зміг надійно підтвердити/);
  assert.match(visible, /Перевір/);
  assert.doesNotMatch(visible, /Готово|Все ок/, "model success prose is never shown");
  // The full diagnostic still reaches the internal log.
  const inner = logged[0] instanceof DjonikTracedTurnError ? logged[0].error : logged[0];
  assert.ok(inner instanceof DjonikUnverifiedMutationError);
  assert.match(inner.message, /Djonik mutated Trello/);
});
