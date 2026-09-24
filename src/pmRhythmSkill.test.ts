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
