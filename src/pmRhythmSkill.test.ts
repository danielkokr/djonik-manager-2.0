import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KNOWN_RHYTHM_KEYS, parseRhythmConfig } from "./rhythmConfig.js";
import { RHYTHM_ACTIONS, utteranceFor } from "./rhythmActions.js";
import { SILENT_TOKEN } from "./rhythmRunner.js";

// #39: the pm-rhythm Skill encodes reusable judgement/content behaviour — not timing config, not project
// facts, not transport. Source text checks do not prove model behaviour.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(repoRoot, ".claude", "skills", "pm-rhythm", "SKILL.md"), "utf8").replace(/\r\n?/g, "\n");

function section(heading: string): string {
  const start = skill.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `expected a '${heading}' section`);
  const next = skill.indexOf("\n## ", start + 1);
  return next >= 0 ? skill.slice(start, next) : skill.slice(start);
}

test("pm-rhythm exists with valid frontmatter that triggers on automatic turns and natural tuning", () => {
  assert.match(skill, /^---\nname: pm-rhythm\ndescription: .+\n---\n/);
  const frontmatter = skill.split("---")[1];
  for (const cue of ["Робочий ритм · автоматичний хід", "бриф о 10", "не нагадуй про це", "менше пиши про waiting"]) {
    assert.ok(frontmatter.includes(cue), cue);
  }
});

test("automatic turns are read-only and never accept on Daniel's behalf", () => {
  const rules = section("Automatic turns are read-only");
  assert.match(rules, /Do not create, move, re-date or complete any card/);
  assert.match(rules, /do not write or edit Memory/);
  assert.match(rules, /Never accept a plan/);
});

test("every ritual and the quiet day have their own section", () => {
  for (const heading of ["Monday — week-plan proposal", "Tuesday–Thursday — morning brief", "Friday morning — lighter", "Friday afternoon — weekly review", "Quiet day", "Exceptions — interrupt only when waiting would hurt"]) {
    section(heading);
  }
  assert.match(section("Tuesday–Thursday — morning brief"), /One main focus/);
  assert.match(section("Monday — week-plan proposal"), /\*\*proposal\*\*/);
  assert.match(section("Monday — week-plan proposal"), /consciously \*\*not\*\* push/);
});

test("core PM semantics: conclusion first, no board dump, facts vs judgement, one easy action, no scores", () => {
  const every = section("What every rhythm message is");
  for (const phrase of ["Conclusion first", "No board dump", "Facts vs judgement", "One easy next action", "No scores"]) {
    assert.ok(every.includes(phrase), phrase);
  }
  const evidence = section("Evidence rules (shared semantics, not repeated here in full)");
  assert.match(evidence, /Fresh Trello owns current task state/);
  assert.match(evidence, /Memory owns accepted durable context/);
  assert.match(evidence, /not automatically a hard client commitment/);
  assert.match(evidence, /Waiting is not blocked/);
});

test("exception silence token matches the runtime", () => {
  assert.ok(section("Exceptions — interrupt only when waiting would hurt").includes(`\`${SILENT_TOKEN}\``));
});

test("buttons are shortcuts; typed text is first-class; a click authorises nothing extra", () => {
  const buttons = section("Buttons are shortcuts, text is first-class");
  assert.match(buttons, /never authorises more than the same words typed would/);
  assert.match(buttons, /verified write/);
  // The example utterance in the Skill is exactly what the transport produces.
  assert.ok(buttons.includes(utteranceFor("accept_plan", "monday-plan", "пн 28.09")));
  assert.ok(buttons.includes(RHYTHM_ACTIONS.accept_plan.label));
});

test("the Skill holds no timing defaults (those live in code / /rhythm.md), only Daniel's example requests", () => {
  for (const defaultTime of ["09:30`", "16:30`", "20:00-", "18:30`"]) {
    assert.ok(!skill.includes(defaultTime), defaultTime);
  }
  assert.match(skill, /A missing key means the system default; do not invent a value/);
});

test("every /rhythm.md line the Skill teaches parses cleanly with the runtime parser", () => {
  const lines = [...section("Tuning the rhythm by conversation — `/rhythm.md`").matchAll(/`([a-z_]+: [^`]+)`/g)].map((m) => m[1]).filter((line) => line !== "key: value");
  assert.ok(lines.length >= 7, lines.join(" | "));
  for (const line of lines) {
    const concrete = line.replace("<that exact id>", "overdue:abc@2026-09-30T15:00:00.000Z").replace("<id>", "overdue:abc@x").replace("<YYYY-MM-DD>", "2026-10-01").replace("<current end>", "10:00");
    const parsed = parseRhythmConfig(concrete);
    assert.deepEqual(parsed.warnings, [], line);
    assert.deepEqual(parsed.unknownKeys, [], line);
  }
  const otherKeys = section("Tuning the rhythm by conversation — `/rhythm.md`").match(/Other keys: ([^.]+)\./)![1];
  for (const key of [...otherKeys.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])) {
    assert.ok((KNOWN_RHYTHM_KEYS as readonly string[]).includes(key), key);
  }
});

test("the Skill never edits /rhythm.md inside an automatic turn", () => {
  assert.match(skill, /never edit `\/rhythm\.md` during one/);
});

test("'less' is not 'never': soft preferences never become a mute; snoozes need an accepted date", () => {
  const tuning = section("Tuning the rhythm by conversation — `/rhythm.md`");
  const hard = tuning.slice(tuning.indexOf("1. **Hard suppression**"), tuning.indexOf("2. **Temporary suppression**"));
  const temporary = tuning.slice(tuning.indexOf("2. **Temporary suppression**"), tuning.indexOf("3. **Softer preference"));
  const soft = tuning.slice(tuning.indexOf("3. **Softer preference"), tuning.indexOf("Remove a mute line"));
  for (const part of [hard, temporary, soft]) assert.ok(part.length > 0);

  for (const phrase of ["не нагадуй про це", "не пиши мені про waiting", "не пінгуй про Limen"]) assert.ok(hard.includes(phrase), phrase);
  assert.match(hard, /mute: kind:waiting_long/);

  assert.ok(temporary.includes("пізніше") && temporary.includes("до понеділка не нагадуй"));
  assert.match(temporary, /only after he accepts/);

  for (const phrase of ["менше пиши про waiting", "менше про Limen", "не треба так часто про це"]) assert.ok(soft.includes(phrase), phrase);
  assert.match(soft, /never a mute/);
  assert.match(soft, /Do not write a `mute:` line/);
  assert.doesNotMatch(soft, /`mute: /, "no mute line is taught for a softer preference");
  // Nowhere in the Skill is a "менше …" request mapped to a mute line.
  for (const line of skill.split("\n").filter((l) => /менше/.test(l))) {
    assert.doesNotMatch(line, /→ `mute:/, line);
  }
});

// --- #45: the approved docs/77 message system -----------------------------------------------------------------------
// Shapes, not a renderer: these pin the vocabulary, the omission rules and each ritual's markers, and that the
// templates never ask the model to fill a slot without a source. Model output quality stays a benchmark question (#46).

test("#45 / docs/77 §2: one fixed marker vocabulary, the same in every rhythm message", () => {
  const markers = section("Markers");
  for (const [emoji, meaning] of [["🎯", "головне"], ["➕", "якщо встигнеш"], ["⏳", "чекаємо на когось"], ["🔥", "справді горить"], ["⚠️", "ризик / виняток"], ["✅", "зроблено"], ["➡️", "переносимо / свідомо відпускаємо"], ["📌", "обіцянка комусь"], ["💭", "моя думка"]]) {
    assert.ok(markers.includes(`${emoji} ${meaning}`), `${emoji} ${meaning}`);
  }
  for (const header of ["🗓 week plan", "🏁 Friday morning", "📊 🔄 ⏸ Friday review"]) assert.ok(markers.includes(header), header);
  assert.match(markers, /One marker per line/);
});

test("#45 / docs/77 §3: empty sections are omitted, 💭 is rare and grounded, templates are not slots to fill", () => {
  const markers = section("Markers");
  assert.match(markers, /An empty section is not shown/);
  assert.match(markers, /three true lines beat seven with one invented/);
  assert.match(markers, /not slots to fill/);
  assert.match(markers, /💭 only when you see something non-obvious/);
  assert.match(markers, /resting on facts in the same message/);
  assert.match(markers, /Never praise, moralise, repeat what is above, or invent a date or estimate/);
  assert.match(section("What every rhythm message is"), /Up to about 10 short Telegram lines; a quiet day is one or two/);
});

test("#45 / docs/77 decision 3: waiting days only when a code hint states them (3+), never counted by the model", () => {
  const markers = section("Markers");
  assert.match(markers, /⏳ without day counts by default/);
  assert.match(markers, /only when a code hint in this turn states it \(e\.g\. «у Waiting 6 дн\.»\) and it is 3 or more/);
  assert.match(markers, /never count days yourself/);
  // The hint the Skill quotes is the runtime's own wording for a long Waiting stint.
  assert.match(readFileSync(join(repoRoot, "src", "rhythmSignals.ts"), "utf8"), /`у Waiting \$\{days\} дн\. \(waiting ≠ blocked\)`/);
});

test("#45: every concrete detail in a rhythm message has a source this turn; an earlier rhythm message is not one", () => {
  const evidence = section("Evidence rules (shared semantics, not repeated here in full)");
  assert.match(evidence, /Every date, duration, size, person or promise in a message has a source in this turn/);
  assert.match(evidence, /an earlier rhythm message is not one/);
  assert.match(evidence, /does not fit what Daniel has said about his time/);
  assert.match(section("Markers"), /🔥 and ⚠️ only for a real cost of waiting[^.]*resting on a fact read in this turn/);
});

test("#45 / docs/77 §4: each ritual carries its approved shape", () => {
  const monday = section("Monday — week-plan proposal");
  for (const line of ["🗓 Тиждень", "🎯 1.", "📌 Обіцянки цього тижня:", "⏳ Чекаємо:", "➡️ Свідомо не чіпаємо:", "💭", "Приймаєш?"]) assert.ok(monday.includes(line), line);
  assert.match(monday, /з рядка годинника/, "the week's dates come from the clock line");
  assert.match(monday, /promises only as recorded in `commitments\/`/);
  assert.match(monday, /up to three outcomes/i);
  const brief = section("Tuesday–Thursday — morning brief");
  for (const line of ["🎯 Головне:", "➕ Якщо встигнеш:", "⏳ Чекаємо:", "🔥", "Тримаємо так?"]) assert.ok(brief.includes(line), line);
  assert.match(brief, /A plain reason \("він у роботі й найближчий до здачі"\) is enough/);
  const friday = section("Friday morning — lighter");
  for (const line of ["🏁 Реально закрити сьогодні:", "➡️ Спокійно на наступний тиждень:"]) assert.ok(friday.includes(line), line);
  const quiet = section("Quiet day");
  assert.match(quiet, /One or two lines/);
  assert.ok(quiet.includes("«🎯 Без змін з учора: далі концепт Seqthera. Пожеж немає.»"));
  const exception = section("Exceptions — interrupt only when waiting would hurt");
  assert.ok(exception.includes("⚠️ <факт: що і чому саме зараз>"));
  // No evening template (PO decision 5): the Skill teaches no evening ritual.
  assert.doesNotMatch(skill, /^## .*(?:evening|вечір)/im);
});

test("#45: examples state the premise that sources every concrete detail they show", () => {
  const brief = section("Tuesday–Thursday — morning brief");
  const premise = brief.slice(brief.indexOf("Example, when"), brief.indexOf("«🎯 Головне: концепт"));
  for (const source of [/checklist 4\/5/, /three projects In progress/, /Daniel said the Azov banner edits are ready/, /code hint says «у Waiting 6 дн\.»/]) {
    assert.match(premise, source, `the example's premise names ${source}`);
  }
  const monday = section("Monday — week-plan proposal");
  assert.match(monday, /when `priorities\.md` ranks Limen second/, "a 💭 challenge rests on a recorded priority, not on a remembered pattern");
});

test("#45 keeps the #36 exact relay: the Friday review never writes, repeats or rewords the work-history facts", () => {
  const review = section("Friday afternoon — weekly review");
  assert.match(review, /the trello_work_history facts block, delivered by code/);
  assert.match(review, /reaches Daniel verbatim ahead of your text/);
  assert.match(review, /never write, repeat or reword closed or moved cards yourself; your text starts at ⏸/);
  assert.match(review, /If history is unavailable, say so in one line — never rebuild it from current card state/);
  assert.match(review, /only for cards that clearly match a planned outcome/);
  // The template lines the model writes start at ⏸; ✅/🔄 are never model-written lines.
  const template = /```\n([\s\S]*?)```/.exec(review)?.[1] ?? "";
  assert.doesNotMatch(template, /^✅|^🔄/m);
});

test("#45 keeps #39: read-only automatic turns, SILENT, quiet hours and verified carry-over are unchanged", () => {
  const rules = section("Automatic turns are read-only");
  assert.match(rules, /Do not create, move, re-date or complete any card/);
  assert.match(rules, /Never accept a plan, a carry-over or a commitment on Daniel's behalf/);
  assert.match(section("Exceptions — interrupt only when waiting would hurt"), /Otherwise answer exactly `SILENT` and nothing else/);
  assert.match(section("Friday afternoon — weekly review"), /only after Daniel explicitly asks, through the task-management verified path/);
  assert.match(skill, /"не пиши мені після 19" \| `quiet_hours: 19:00-<current end>`/);
});
