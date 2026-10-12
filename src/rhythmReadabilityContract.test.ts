import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GrammyError } from "grammy";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { buttonsFor } from "./rhythmActions.js";
import { buildExceptionPrompt, buildRitualPrompt } from "./rhythmRunner.js";
import type { RitualKind } from "./rhythmSchedule.js";
import { detectSignals, type CardFact } from "./rhythmSignals.js";
import { createTelegramProactiveSender } from "./rhythmTelegram.js";
import { renderTelegramHtml } from "./telegramFormat.js";

// #67: Working Rhythm messages are scan-first and say «дедлайн», never `due`. The model writes the message, so these
// tests cover what code owns: the words code hands the model, the examples the Skills teach, and the real Telegram
// path the taught layout travels through. Source text checks do not prove model behaviour.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillText = (name: string) => readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n?/g, "\n");
const pmRhythm = skillText("pm-rhythm");

function section(heading: string): string {
  const start = pmRhythm.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `expected a '${heading}' section`);
  const next = pmRhythm.indexOf("\n## ", start + 1);
  return next >= 0 ? pmRhythm.slice(start, next) : pmRhythm.slice(start);
}

const RAW_DUE = /(?<![\p{L}\p{N}_])due(?![\p{L}\p{N}_])/iu;
const contentLines = (text: string) => text.split("\n").filter((line) => line.trim().length > 0);

const defaults = parseRhythmConfig(null).config;
/** Monday 2026-10-05, 09:30 Kyiv — the production case's morning. */
const MONDAY = new Date("2026-10-05T06:30:00Z");

function card(overrides: Partial<CardFact> & { id: string }): CardFact {
  return { name: `Card ${overrides.id}`, project: "extract", list: "todo", due: null, dueComplete: false, enteredListAt: null, reopenedFromDoneAt: null, ...overrides };
}

/** Every dated situation code can hint at, in the shape of the 2026-10-05 board: two deadlines today in one project,
 *  one tomorrow not started, one later this week, one overdue, one long in Waiting. */
const productionShapedSignals = () =>
  detectSignals(
    {
      cards: [
        card({ id: "aroma", name: "Аромати", due: "2026-10-05T15:00:00Z" }),
        card({ id: "pdf", name: "Whitepaper PDF", due: "2026-10-05T15:00:00Z" }),
        card({ id: "ui", name: "UI Design 2.0", project: "seqthera", due: "2026-10-06T15:00:00Z" }),
        card({ id: "rdas", name: "RDAS", project: "cossack-labs", due: "2026-10-07T12:00:00Z" }),
        card({ id: "old", name: "Банер", project: "azov", due: "2026-10-01T15:00:00Z" }),
        card({ id: "wait", name: "Хайлайт", list: "waiting", enteredListAt: "2026-09-29T09:00:00Z" }),
      ],
      projects: [],
      followUps: [],
    },
    MONDAY,
    defaults,
  );

test("#67 code hints say «дедлайн»: no fact handed to the model carries the raw field name", () => {
  const signals = productionShapedSignals();
  for (const kind of ["overdue", "due_tomorrow_not_started", "due_soon", "deadline_collision", "waiting_long"]) {
    assert.ok(signals.some((signal) => signal.kind === kind), `the fixture produces ${kind}`);
  }
  for (const signal of signals) assert.doesNotMatch(signal.fact, RAW_DUE, `${signal.kind}: ${signal.fact}`);
  assert.ok(signals.filter((signal) => /^дедлайн \d{4}-\d{2}-\d{2}/.test(signal.fact)).length >= 3, "dated hints use the Ukrainian word with the card's own date");
});

test("#67 every rhythm prompt — Monday plan, morning brief, Friday morning, Friday review, exception — is free of `due` outside mute ids", () => {
  const signals = productionShapedSignals();
  // The bracketed occurrence handle is an opaque id for «не нагадуй» (its keys are stored in /rhythm.md and state).
  const withoutHandles = (prompt: string) => prompt.replace(/ \[[^\]\n]+\]$/gm, "");
  const kinds: RitualKind[] = ["monday-plan", "morning", "friday-morning", "friday-review"];
  for (const kind of kinds) {
    const prompt = buildRitualPrompt({ kind, key: `${kind}:2026-10-05`, date: "2026-10-05", scheduledMinutes: 570 }, defaults, signals, MONDAY);
    assert.match(prompt, /Підказки коду/);
    assert.match(prompt, /Аромати \(extract\): дедлайн 2026-10-05/);
    assert.doesNotMatch(withoutHandles(prompt), RAW_DUE, kind);
  }
  assert.doesNotMatch(withoutHandles(buildExceptionPrompt(signals, MONDAY, null)), RAW_DUE);
});

test("#67 no Ukrainian phrase the rhythm and planning Skills quote contains `due`", () => {
  // task-management quotes Daniel's own «забери due date» as a request to recognise; that is input, not Djonik's voice.
  for (const name of ["pm-rhythm", "planning-and-focus"]) {
    const spoken = [...skillText(name).matchAll(/«([^»]*)»|"([^"\n]*[а-яіїєґ][^"\n]*)"/giu)].map((match) => match[1] ?? match[2]);
    assert.ok(spoken.length > 0, name);
    for (const phrase of spoken) assert.doesNotMatch(phrase, RAW_DUE, `${name}: ${phrase}`);
  }
});

test("#67 the Skill states the plain-words and scan rules, and keeps simple messages simple", () => {
  const every = section("What every rhythm message is");
  assert.match(every, /\*\*Plain words\.\*\* Field and tool vocabulary never reaches Daniel: no `due`/);
  assert.match(every, /«дедлайн 05\.10», «до 05\.10» or «здати 05\.10» — one form through the whole message, and only a date read in this turn/);
  assert.match(every, /\*\*Easy to scan\.\*\* Telegram shows a blank line and `\*\*bold\*\*` as written/);
  assert.match(every, /One item stays on its marker's line; two or more go under it as `• ` lines, one thought each/);
  assert.match(every, /each is its own block with the project name in bold/);
  assert.match(every, /a quiet day, a one-focus brief or an exception stays a few plain lines/);
  assert.match(every, /Blank lines do not count towards the ten lines; bullets do/);
  // The length contract is unchanged: formatting is not a licence for a longer message.
  assert.match(every, /Up to about 10 short Telegram lines; a quiet day is one or two/);
});

const mondayExample = /«(🗓 Тиждень 05\.10–09\.10\n[\s\S]*?\nПриймаєш\?)»/.exec(section("Monday — week-plan proposal"))?.[1] ?? "";

test("#67 the taught Monday plan is grouped, sourced and no longer than before", () => {
  assert.ok(mondayExample.length > 0, "the Monday section carries a worked multi-project example");
  const monday = section("Monday — week-plan proposal");
  const premise = monday.slice(monday.indexOf("Example, when"), monday.indexOf("«🗓 Тиждень 05.10"));
  // Every concrete detail in the example has a named source in its premise (#45).
  for (const source of [/clock line gives the week 05\.10–09\.10/, /this turn's snapshot/, /card date of 05\.10/, /card date of 06\.10/, /«Хайлайт» in Waiting/]) assert.match(premise, source);
  for (const date of mondayExample.match(/\d{2}\.\d{2}/g) ?? []) assert.ok(premise.includes(date), `${date} is in the premise`);

  assert.doesNotMatch(mondayExample, RAW_DUE);
  const lines = contentLines(mondayExample);
  assert.ok(lines.length <= 10, `${lines.length} content lines`);
  // Projects are separate blocks with a bold name; several tasks of one project are separate bullets.
  assert.match(mondayExample, /\n\n🎯 \*\*Extract\*\*\n• Аромати — дедлайн 05\.10\n• Whitepaper PDF — дедлайн 05\.10\n\n🎯 \*\*Seqthera\*\* — /);
  // One thought per bullet: the task and one fact about it.
  for (const bullet of lines.filter((line) => line.startsWith("• "))) assert.equal(bullet.split(" — ").length, 2, bullet);
  // One deadline convention through the message.
  assert.equal((mondayExample.match(/дедлайн \d{2}\.\d{2}/g) ?? []).length, 3);
  assert.doesNotMatch(mondayExample, /(?:до|здати) \d{2}\.\d{2}/);
  // Markers keep their meaning and stay one per line.
  for (const line of lines) assert.ok(([...line.matchAll(/🗓|🎯|📌|⏳|➡️|💭/gu)]).length <= 1, line);
  assert.equal(lines[0], "🗓 Тиждень 05.10–09.10");
  assert.equal(lines.at(-1), "Приймаєш?");
});

test("#67 that plan through the real proactive Telegram path: bold project names, blank lines and bullets survive; buttons are untouched", async () => {
  const calls: Array<{ chatId: number; text: string; other?: unknown }> = [];
  const send = createTelegramProactiveSender({ sendMessage: async (chatId, text, other) => (calls.push({ chatId, text, other }), { message_id: 7 }) }, 4242);
  assert.deepEqual(await send({ text: mondayExample, actions: buttonsFor("monday-plan") }, "abcdef123456"), { status: "sent", messageId: 7 });

  const sent = calls[0].text;
  assert.equal(sent, renderTelegramHtml(mondayExample), "rhythm messages use the same renderer as ordinary replies");
  assert.match(sent, /\n\n🎯 <b>Extract<\/b>\n• Аромати — дедлайн 05\.10\n• Whitepaper PDF — дедлайн 05\.10\n\n🎯 <b>Seqthera<\/b> — UI Design 2\.0 — дедлайн 06\.10\n\n⏳ /);
  assert.doesNotMatch(sent, /\*\*/, "no literal asterisks reach Daniel");
  assert.equal(sent.split("\n\n").length, mondayExample.split("\n\n").length, "every blank line is delivered");
  assert.equal(sent.replace(/<\/?b>/g, ""), mondayExample.replace(/\*\*/g, ""), "nothing but the bold markup changed");
  assert.deepEqual(calls[0].other, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Приймаю", callback_data: "rh1:acc:abcdef123456" },
        { text: "✏️ Змінити", callback_data: "rh1:mod:abcdef123456" },
        { text: "📋 Детальніше", callback_data: "rh1:det:abcdef123456" },
      ]],
    },
  });
});

test("#67 if Telegram rejects the entities, the plain fallback still keeps the blocks and bullets", async () => {
  const calls: Array<{ text: string; other?: { parse_mode?: string } }> = [];
  const parseError = new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, "sendMessage", {});
  const send = createTelegramProactiveSender(
    { sendMessage: async (_chatId, text, other) => { calls.push({ text, other }); if (calls.length === 1) throw parseError; return { message_id: 8 }; } },
    4242,
  );
  assert.deepEqual(await send({ text: mondayExample, actions: [] }, "abcdef123456"), { status: "sent", messageId: 8 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].other?.parse_mode, undefined);
  assert.equal(calls[1].text, mondayExample, "layout does not depend on bold: blank lines and bullets are plain text");
});

test("#67 simpler messages are not forced into project blocks: the brief, quiet-day and exception examples stay plain lines", () => {
  const brief = /«(🎯 Головне: концепт упаковки[\s\S]*?Тримаємо так\?)»/.exec(section("Tuesday–Thursday — morning brief"))?.[1] ?? "";
  const quiet = /«(🎯 Без змін з учора[^»]*)»/.exec(section("Quiet day"))?.[1] ?? "";
  const exception = /«(⚠️ Дедлайн по концепту Seqthera[\s\S]*?)»\n/.exec(section("Exceptions — interrupt only when waiting would hurt"))?.[1] ?? "";
  for (const [name, example, max] of [["brief", brief, 5], ["quiet day", quiet, 1], ["exception", exception, 2]] as const) {
    assert.ok(example.length > 0, name);
    assert.doesNotMatch(example, /\*\*|^• |\n\n/m, `${name} has no bold, bullets or blank lines`);
    assert.ok(contentLines(example).length <= max, `${name}: ${contentLines(example).length} lines`);
    assert.doesNotMatch(example, RAW_DUE, name);
    assert.equal(renderTelegramHtml(example), example, `${name} reaches Telegram unchanged`);
  }
  for (const template of [section("Tuesday–Thursday — morning brief"), section("Friday morning — lighter"), section("Friday afternoon — weekly review")].map((part) => /```\n([\s\S]*?)```/.exec(part)?.[1] ?? "")) {
    assert.ok(template.length > 0);
    assert.doesNotMatch(template, /\*\*<проєкт>\*\*/, "only the Monday plan is taught as project blocks");
  }
});

test("#67 leaves the #66 relay alone: the Friday review still starts at ⏸ after code's facts block", () => {
  const review = section("Friday afternoon — weekly review");
  assert.match(review, /Its facts block reaches Daniel verbatim ahead of your text/);
  assert.match(review, /never write, repeat or reword closed or moved cards yourself; your text starts at ⏸/);
});
