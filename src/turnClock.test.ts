import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik, type DjonikTurnPart } from "./djonikClient.js";
import { MessageGroupBuffer, type GroupedIntake } from "./messageGrouping.js";
import { encodeCallbackData } from "./rhythmActions.js";
import { buildExceptionPrompt } from "./rhythmRunner.js";
import { createSessionTurnRunner } from "./rhythmRuntime.js";
import { createMemoryRhythmStateStore, emptyRhythmState } from "./rhythmState.js";
import { createRhythmCallbackHandler, enqueueClickAfterPendingText } from "./rhythmTelegram.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import type { DjonikSessionManager } from "./telegramAdapter.js";
import { buildClockHeader, CLOCK_HEADER_PREFIX, CLOCK_STRIP_DAYS, isClockHeader } from "./turnClock.js";

// #41 — a deterministic Europe/Kyiv clock header on every one of Daniel's turns, as its own first content block.
// Offline: fixed instants, a fake provider client, no network, independent of the machine's time zone.

const FRIDAY = new Date("2026-09-25T11:30:00Z"); // Kyiv: пт 25.09.2026, 14:30 (EEST, UTC+3)
const FRIDAY_HEADER =
  "[Годинник адаптера, не текст Daniel · Зараз: пт 25.09.2026, 14:30 Київ · сб 26.09 · нд 27.09 · пн 28.09 · вт 29.09 · " +
  "ср 30.09 · чт 01.10 · пт 02.10 · сб 03.10 · нд 04.10 · пн 05.10 · вт 06.10 · ср 07.10 · чт 08.10 · пт 09.10]";

// --- The header itself ----------------------------------------------------------------------------------------

test("header: Kyiv weekday, date with year, time and a 14-day date → weekday strip", () => {
  assert.equal(buildClockHeader(FRIDAY), FRIDAY_HEADER);
  assert.ok(isClockHeader(FRIDAY_HEADER));
  assert.ok(FRIDAY_HEADER.startsWith(CLOCK_HEADER_PREFIX));
  assert.equal(FRIDAY_HEADER.split(" · ").length, 2 + CLOCK_STRIP_DAYS, "prefix · now · 14 strip days");
  assert.ok(FRIDAY_HEADER.length < 300, "one short line: cheap on every turn");
});

test("header: the Kyiv calendar day, not UTC — late evening and just after midnight", () => {
  // 23:59 Kyiv is still Friday even though UTC is 20:59; 00:30 Kyiv is Saturday while UTC is still Friday.
  assert.match(buildClockHeader(new Date("2026-09-25T20:59:00Z")), /Зараз: пт 25\.09\.2026, 23:59 Київ · сб 26\.09 ·/);
  assert.match(buildClockHeader(new Date("2026-09-25T21:30:00Z")), /Зараз: сб 26\.09\.2026, 00:30 Київ · нд 27\.09 ·/);
});

test("header: spring DST (29.03.2026, 03:00 → 04:00) keeps dates, times and weekdays right", () => {
  assert.match(buildClockHeader(new Date("2026-03-28T21:59:00Z")), /Зараз: сб 28\.03\.2026, 23:59 Київ · нд 29\.03 · пн 30\.03 ·/);
  assert.match(buildClockHeader(new Date("2026-03-28T22:30:00Z")), /Зараз: нд 29\.03\.2026, 00:30 Київ · пн 30\.03 ·/);
  assert.match(buildClockHeader(new Date("2026-03-29T00:59:00Z")), /Зараз: нд 29\.03\.2026, 02:59 Київ/);
  assert.match(buildClockHeader(new Date("2026-03-29T01:00:00Z")), /Зараз: нд 29\.03\.2026, 04:00 Київ/);
  // A strip that spans the switch: every day appears once, in order, with its weekday.
  assert.equal(
    buildClockHeader(new Date("2026-03-20T10:00:00Z")),
    "[Годинник адаптера, не текст Daniel · Зараз: пт 20.03.2026, 12:00 Київ · сб 21.03 · нд 22.03 · пн 23.03 · вт 24.03 · " +
      "ср 25.03 · чт 26.03 · пт 27.03 · сб 28.03 · нд 29.03 · пн 30.03 · вт 31.03 · ср 01.04 · чт 02.04 · пт 03.04]",
  );
});

test("header: autumn DST (25.10.2026, 04:00 → 03:00) keeps dates, times and weekdays right", () => {
  assert.match(buildClockHeader(new Date("2026-10-24T20:59:00Z")), /Зараз: сб 24\.10\.2026, 23:59 Київ · нд 25\.10 ·/);
  assert.match(buildClockHeader(new Date("2026-10-24T21:30:00Z")), /Зараз: нд 25\.10\.2026, 00:30 Київ · пн 26\.10 ·/);
  // The repeated hour: both instants read 03:30 Kyiv, same day.
  assert.match(buildClockHeader(new Date("2026-10-25T00:30:00Z")), /Зараз: нд 25\.10\.2026, 03:30 Київ/);
  assert.match(buildClockHeader(new Date("2026-10-25T01:30:00Z")), /Зараз: нд 25\.10\.2026, 03:30 Київ/);
  assert.equal(
    buildClockHeader(new Date("2026-10-23T20:30:00Z")),
    "[Годинник адаптера, не текст Daniel · Зараз: пт 23.10.2026, 23:30 Київ · сб 24.10 · нд 25.10 · пн 26.10 · вт 27.10 · " +
      "ср 28.10 · чт 29.10 · пт 30.10 · сб 31.10 · нд 01.11 · пн 02.11 · вт 03.11 · ср 04.11 · чт 05.11 · пт 06.11]",
  );
});

test("header: year boundary — Kyiv New Year while UTC is still 31.12", () => {
  assert.match(buildClockHeader(new Date("2026-12-31T22:30:00Z")), /Зараз: пт 01\.01\.2027, 00:30 Київ · сб 02\.01 · нд 03\.01 · пн 04\.01 ·/);
});

test("header strip agrees with an independent Intl oracle (Kyiv noon of each date) for a whole year of instants", () => {
  const oracle = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", weekday: "short", day: "2-digit", month: "2-digit" });
  const label = (instant: Date) => {
    const parts = Object.fromEntries(oracle.formatToParts(instant).map((part) => [part.type, part.value]));
    return `${parts.weekday.replace(".", "")} ${parts.day}.${parts.month}`;
  };
  for (let day = 0; day < 366; day += 1) {
    for (const hourUtc of [0, 9, 21, 23]) {
      const now = new Date(Date.UTC(2026, 0, 1 + day, hourUtc, 15));
      const strip = buildClockHeader(now).slice(0, -1).split(" · ").slice(2);
      assert.equal(strip.length, CLOCK_STRIP_DAYS);
      // Kyiv "today" per the oracle, then each following Kyiv noon (09:00–10:00 UTC is always noon-ish in Kyiv).
      const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
      const [y, m, d] = todayKey.split("-").map(Number);
      const expected = Array.from({ length: CLOCK_STRIP_DAYS }, (_, i) => label(new Date(Date.UTC(y, m - 1, d + i + 1, 9, 30))));
      assert.deepEqual(strip, expected, now.toISOString());
    }
  }
});

test("header is deterministic and does not depend on the process time zone", () => {
  const original = process.env.TZ;
  try {
    const outputs = ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Europe/Kyiv"].map((zone) => {
      process.env.TZ = zone;
      return buildClockHeader(new Date(FRIDAY));
    });
    assert.deepEqual(outputs, outputs.map(() => FRIDAY_HEADER));
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  assert.equal(buildClockHeader(FRIDAY), buildClockHeader(new Date(FRIDAY.getTime())));
});

test("layering: the human-turn clock depends only on the pure Kyiv calendar primitives, never the rhythm orchestrator", () => {
  const read = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
  const importsOf = (name: string) => [...read(name).matchAll(/from "\.\/([\w.]+)\.js"/g)].map((match) => match[1]).sort();
  assert.deepEqual(importsOf("turnClock.ts"), ["rhythmConfig", "rhythmSchedule"]);
  assert.deepEqual(importsOf("rhythmSchedule.ts"), ["rhythmConfig"]);
  assert.deepEqual(importsOf("rhythmConfig.ts"), []);
});

// --- Every human-turn path ------------------------------------------------------------------------------------

type Block = { type: string; text?: string; source?: unknown; title?: string };
type Batch = { events: Array<{ type: string; content: Block[] }> };

const AGENT_MESSAGE = { type: "agent.message", content: [{ type: "text", text: "Готово." }] };
const IDLE = { type: "session.status_idle", stop_reason: { type: "end_turn" } };
const IMAGE = { data: "aW1hZ2UtZGF0YQ==", mediaType: "image/png", byteSize: 99 };
const PDF = { data: "JVBERi0xLjQ=", mediaType: "application/pdf", byteSize: 8, filename: "brief.pdf" };

/** A provider fake that answers every submitted turn with one final message; records every `events.send`. */
function fakeClient() {
  const sendCalls: Batch[] = [];
  const queue: unknown[] = [];
  const waiters: Array<(event: unknown) => void> = [];
  const push = (event: unknown) => {
    const waiter = waiters.shift();
    if (waiter) waiter(event);
    else queue.push(event);
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "session_test123" }),
        events: {
          stream: async () => ({
            controller: { abort: () => {} },
            [Symbol.asyncIterator]: () => ({
              next: () =>
                queue.length > 0
                  ? Promise.resolve({ value: queue.shift(), done: false })
                  : new Promise((resolve) => waiters.push((value) => resolve({ value, done: false }))),
            }),
          }),
          send: async (_id: string, params: Batch) => {
            sendCalls.push(params);
            // A user turn gets its reply; tool results/confirmations get nothing more.
            if (params.events[0]?.type === "user.message") {
              push(AGENT_MESSAGE);
              push(IDLE);
            }
          },
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls };
}

async function connect(now: () => Date = () => FRIDAY) {
  const fake = fakeClient();
  const session = await connectToDjonik(fake.client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, undefined, "telegram", undefined, { now });
  return { ...fake, session };
}

/** The blocks of the n-th provider submission. */
const blocksOf = (sendCalls: Batch[], index = 0) => sendCalls[index].events[0].content;
const clockBlocks = (blocks: Block[]) => blocks.filter((block) => block.type === "text" && isClockHeader(block.text ?? ""));

function managerFor<H>(session: H): DjonikSessionManager {
  return { getSession: async () => session, closeIfOpen: () => {}, invalidate: () => {} } as unknown as DjonikSessionManager;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("path 1 — ordinary typed text: [clock, Daniel's text], his text byte-identical", async () => {
  const { session, sendCalls } = await connect();
  await session.send("яке сьогодні число і що в мене в понеділок?");
  assert.deepEqual(blocksOf(sendCalls), [
    { type: "text", text: FRIDAY_HEADER },
    { type: "text", text: "яке сьогодні число і що в мене в понеділок?" },
  ]);
  session.close();
});

test("path 2 — grouped Telegram fragments: one turn, the header exactly once, the intake itself untouched", async () => {
  const { session, sendCalls } = await connect();
  const intakes: GroupedIntake[] = [];
  const { onDispatch, onFailure } = createGroupDispatchHandlers({ djonikSession: managerFor(session), sendMessage: async () => undefined, logError: () => {} });
  const buffer = new MessageGroupBuffer({
    adjacentWindowMs: 5,
    albumSettleWindowMs: 5,
    onDispatch: (chatId, userId, intake) => {
      intakes.push(structuredClone(intake));
      return onDispatch(chatId, userId, intake);
    },
    onFailure,
  });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "Extract, новий банер" });
  buffer.addFragment({ chatId: 1, userId: 100, messageId: 2, text: "дедлайн — наступний понеділок" });
  await sleep(40);

  assert.equal(sendCalls.length, 1, "grouped fragments stay one Managed Agent turn");
  const blocks = blocksOf(sendCalls);
  assert.equal(clockBlocks(blocks).length, 1, "the header is not repeated per fragment");
  assert.deepEqual(blocks[0], { type: "text", text: FRIDAY_HEADER });
  // What follows is exactly the intake's own parts; the header never entered the intake, its text or its parts.
  assert.equal(intakes.length, 1);
  assert.deepEqual(blocks.slice(1), intakes[0].parts.map((part) => ({ type: "text", text: (part as { text: string }).text })));
  assert.ok(!intakes[0].text.includes(CLOCK_HEADER_PREFIX));
  assert.ok(!JSON.stringify(intakes[0].parts).includes(CLOCK_HEADER_PREFIX));
  session.close();
});

test("path 3 — image / document / mixed multimodal: header first, then Daniel's blocks in his order", async () => {
  const { session, sendCalls } = await connect();
  const parts: DjonikTurnPart[] = [
    { type: "image", image: IMAGE },
    { type: "text", text: "з цього зроби задачу" },
    { type: "document", document: PDF },
  ];
  await session.sendOrdered(parts);
  await session.send("", IMAGE); // an image with no caption
  await session.send("", undefined, PDF); // a file with no caption

  assert.deepEqual(blocksOf(sendCalls, 0), [
    { type: "text", text: FRIDAY_HEADER },
    { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE.data } },
    { type: "text", text: "з цього зроби задачу" },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF.data }, title: "brief.pdf" },
  ]);
  assert.deepEqual(blocksOf(sendCalls, 1), [
    { type: "text", text: FRIDAY_HEADER },
    { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE.data } },
  ]);
  assert.deepEqual(blocksOf(sendCalls, 2), [
    { type: "text", text: FRIDAY_HEADER },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF.data }, title: "brief.pdf" },
  ]);
  session.close();
});

test("path 4 — Working Rhythm button: the click's utterance reaches the Session as Daniel's turn, with the header", async () => {
  const { session, sendCalls } = await connect(() => new Date("2026-09-28T07:00:00Z"));
  const { onDispatch, onFailure } = createGroupDispatchHandlers({ djonikSession: managerFor(session), sendMessage: async () => undefined, logError: () => {} });
  const buffer = new MessageGroupBuffer({ adjacentWindowMs: 5, albumSettleWindowMs: 5, onDispatch, onFailure });
  const ref = "abcdef123456";
  const store = createMemoryRhythmStateStore({
    ...emptyRhythmState(),
    deliveries: {
      "monday-plan:2026-09-28": {
        key: "monday-plan:2026-09-28",
        kind: "monday-plan",
        status: "sent",
        attempts: 1,
        ref,
        sessionId: "sesn_serving",
        createdAt: "2026-09-28T06:30:00.000Z",
        updatedAt: "2026-09-28T06:31:00.000Z",
        sentAt: "2026-09-28T06:31:00.000Z",
        telegramMessageId: 777,
        actions: ["accept_plan", "modify", "details"],
      },
    },
  });
  const handle = createRhythmCallbackHandler({
    allowedUserId: "4242",
    store,
    now: () => new Date("2026-09-28T07:00:00Z"),
    currentSessionId: () => "sesn_serving",
    answer: async () => undefined,
    enqueueUserText: enqueueClickAfterPendingText(buffer),
  });
  const resolution = await handle({ data: encodeCallbackData("accept_plan", ref), fromId: 4242, chatId: 4242, messageId: 777 });
  assert.equal(resolution.outcome, "enqueued");
  await sleep(40);

  assert.equal(sendCalls.length, 1);
  assert.deepEqual(blocksOf(sendCalls), [
    { type: "text", text: buildClockHeader(new Date("2026-09-28T07:00:00Z")) },
    { type: "text", text: resolution.outcome === "enqueued" ? resolution.utterance : "" },
  ]);
  assert.match(blocksOf(sendCalls)[0].text!, /Зараз: пн 28\.09\.2026, 10:00 Київ/);
  session.close();
});

test("a traced human turn (button_callback origin) also gets the header", async () => {
  const { session, sendCalls } = await connect();
  await session.sendTraced([{ type: "text", text: "Приймаю план" }], "button_callback");
  assert.deepEqual(blocksOf(sendCalls), [
    { type: "text", text: FRIDAY_HEADER },
    { type: "text", text: "Приймаю план" },
  ]);
  session.close();
});

// --- Boundary: system context vs Daniel's content ---------------------------------------------------------------

test("the header is its own block: never merged into, prefixed onto or quoted inside Daniel's content", async () => {
  const { session, sendCalls } = await connect();
  await session.send("з цього зроби задачу", IMAGE);
  const [clock, ...daniel] = blocksOf(sendCalls);
  assert.deepEqual(clock, { type: "text", text: FRIDAY_HEADER });
  assert.deepEqual(daniel, [
    { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE.data } },
    { type: "text", text: "з цього зроби задачу" },
  ]);
  assert.ok(daniel.every((block) => !JSON.stringify(block).includes("Годинник")), "no header text inside Daniel's blocks");
  assert.ok(FRIDAY_HEADER.includes("не текст Daniel"), "the block labels itself as not Daniel's words");
  session.close();
});

test("content-free turn telemetry still counts only Daniel's blocks", async () => {
  const fake = fakeClient();
  const telemetry: Array<{ textBlockCount?: number; imageBlockCount?: number }> = [];
  const session = await connectToDjonik(fake.client, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, (record) => telemetry.push(record as never), "telegram", undefined, {
    now: () => FRIDAY,
  });
  await session.send("з цього зроби задачу", IMAGE);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].textBlockCount, 1);
  assert.equal(telemetry[0].imageBlockCount, 1);
  session.close();
});

test("an empty turn is still rejected: the header never makes a contentless turn sendable", async () => {
  const { session, sendCalls } = await connect();
  await assert.rejects(() => session.sendOrdered([{ type: "text", text: "" }]), /non-empty text and\/or an attachment/);
  assert.equal(sendCalls.length, 0);
  session.close();
});

test("the header is stamped when the turn is actually sent (after the FIFO queue), from the injected clock", async () => {
  let current = FRIDAY;
  const { session, sendCalls } = await connect(() => current);
  const first = session.send("перше");
  current = new Date("2026-09-25T11:31:00Z");
  const second = session.send("друге");
  await Promise.all([first, second]);
  assert.match(blocksOf(sendCalls, 0)[0].text!, /14:3[01] Київ/);
  assert.match(blocksOf(sendCalls, 1)[0].text!, /14:31 Київ/);
  session.close();
});

// --- Not Daniel's turns: no header --------------------------------------------------------------------------------

test("autonomous rhythm turns keep only their own time line: no clock header, prompt unchanged", async () => {
  const { session, sendCalls } = await connect();
  const runTurn = createSessionTurnRunner(managerFor(session) as never);
  const ritualPrompt = "[Робочий ритм · автоматичний хід · пʼятничний огляд · пт 25.09, 16:30]\nтест";
  await runTurn({ prompt: ritualPrompt, origin: "rhythm_ritual" } as never);
  await session.sendTraced([{ type: "text", text: "виняток" }], "rhythm_exception");
  assert.deepEqual(blocksOf(sendCalls, 0), [{ type: "text", text: ritualPrompt }]);
  assert.deepEqual(blocksOf(sendCalls, 1), [{ type: "text", text: "виняток" }]);
  assert.equal(clockBlocks([...blocksOf(sendCalls, 0), ...blocksOf(sendCalls, 1)]).length, 0);
  session.close();
});

test("rhythm prompts themselves are unchanged by #41 (still their own kyivLabel line, no clock header)", () => {
  const exception = buildExceptionPrompt([], FRIDAY, null);
  assert.match(exception, /^\[Робочий ритм · автоматичний хід · можливий виняток · пт 25\.09, 14:30\]/);
  assert.ok(!exception.includes(CLOCK_HEADER_PREFIX));
});

test("the write-verification nudge is not Daniel's turn: no header on it", async () => {
  const fake = fakeClient();
  // Turn 1: an unverified Trello write, then end_turn → the client nudges once; the nudge reply verifies it.
  const events = [
    { type: "agent.mcp_tool_use", id: "w1", name: "trelloWriteCard", mcp_server_name: "trello", input: { cardId: "card_A" } },
    { type: "agent.mcp_tool_result", id: "w1_result", mcp_tool_use_id: "w1", is_error: false, content: [{ type: "text", text: JSON.stringify({ id: "card_A", name: "A" }) }] },
    { type: "agent.message", content: [{ type: "text", text: "Зробив." }] },
    IDLE,
    { type: "agent.mcp_tool_use", id: "r1", name: "trelloReadCard", mcp_server_name: "trello", input: { cardId: "card_A" } },
    { type: "agent.mcp_tool_result", id: "r1_result", mcp_tool_use_id: "r1", is_error: false, content: [{ type: "text", text: JSON.stringify({ id: "card_A", name: "A" }) }] },
    { type: "agent.message", content: [{ type: "text", text: "Перевірив." }] },
    IDLE,
  ];
  const scripted = {
    beta: {
      sessions: {
        create: async () => ({ id: "session_test123" }),
        events: {
          stream: async () => {
            let index = 0;
            return {
              controller: { abort: () => {} },
              [Symbol.asyncIterator]: () => ({ next: async () => (index < events.length ? { value: events[index++], done: false } : { value: undefined, done: true }) }),
            };
          },
          send: async (_id: string, params: Batch) => {
            fake.sendCalls.push(params);
          },
        },
      },
    },
  } as unknown as Anthropic;
  const session = await connectToDjonik(scripted, "agent_x", "env_x", "memstore_x", "vlt_x", undefined, undefined, "telegram", undefined, { now: () => FRIDAY });
  await session.send("перейменуй картку A");
  assert.equal(fake.sendCalls.length, 2, "Daniel's turn + one verification nudge");
  assert.equal(clockBlocks(blocksOf(fake.sendCalls, 0)).length, 1);
  assert.equal(clockBlocks(blocksOf(fake.sendCalls, 1)).length, 0, "the nudge carries no clock header");
  session.close();
});
