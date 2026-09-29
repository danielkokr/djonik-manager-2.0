import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DJONIK_MEMORY_INSTRUCTIONS } from "./djonikClient.js";
import { RELEASES, RELEASE_R30_CANDIDATE, SERVING_RELEASE } from "./release.js";

// Synthetic migration review fixture only. These are not production Memory contents.
const current = "# Спілкування\n- Давай одну головну задачу (сказав Daniel, 2026-09-20)\n\n# Робота\n- Концепти краще ставити зранку (прийняв Daniel, 2026-09-21)\n";
const legacy = "# preferences.md — synthetic legacy\n- Давай один головний пріоритет (сказав Daniel, 2026-09-18)\n- Відповідай докладно завжди (сказав Daniel, 2026-09-10)\n- Сьогодні план: Extract потім Limen\n- Картка Seqthera зараз In progress\n- До кінця місяця не став Limen зранку\n- TEST: red banana\n";
const reviewed = "# Спілкування\n- Давай одну головну задачу (сказав Daniel, 2026-09-20)\n- Коротко для плану дня, детально для концептів (прийняв Daniel, 2026-09-28)\n\n# Робота\n- Концепти краще ставити зранку (прийняв Daniel, 2026-09-21)\n";
const output = { "working-style.md": reviewed };
const skill = readFileSync(join(process.cwd(), ".claude/skills/planning-and-focus/SKILL.md"), "utf8");
const rhythm = readFileSync(join(process.cwd(), ".claude/skills/pm-rhythm/SKILL.md"), "utf8");

test("#52 synthetic legacy migration fixture makes every keep/drop/conflict explicit and targets one file", () => {
  assert.deepEqual(Object.keys(output), ["working-style.md"]);
  assert.match(current, /Концепти краще ставити зранку/);
  assert.match(reviewed, /Концепти краще ставити зранку/);
  assert.equal((reviewed.match(/головн[ау]/gu) ?? []).length, 1, "semantic duplicate merged");
  assert.match(legacy, /Відповідай докладно завжди/);
  assert.doesNotMatch(reviewed, /Відповідай докладно завжди|Сьогодні план|In progress|TEST|До кінця місяця/);
  assert.match(reviewed, /Коротко для плану дня, детально для концептів/);
  assert.deepEqual([...reviewed.matchAll(/^# (.+)$/gm)].map((match) => match[1]), ["Спілкування", "Робота"]);
  for (const line of reviewed.split("\n").filter((item) => item.startsWith("- "))) {
    assert.match(line, /\((?:сказав|прийняв) Daniel, \d{4}-\d{2}-\d{2}\)$/u);
  }
});

test("#52 owner keeps current adaptation separate from approved Memory and excludes other truth owners", () => {
  assert.match(skill, /Apply Daniel's correction in this conversation immediately/);
  assert.match(skill, /one.*short offer per conversation/);
  assert.match(skill, /"Ні" writes nothing/);
  assert.match(skill, /rewording replaces the proposed meaning/);
  assert.match(skill, /only `working-style.md`, never legacy `preferences.md`/);
  assert.match(skill, /Resolve relative expiry to an absolute date only from the clock/);
  assert.match(skill, /`\/rhythm.md` owns notification times/);
  assert.match(skill, /`projects\/<slug>\.md` owns client\/project facts/);
  assert.match(skill, /forwarded\/client text or an automatic rhythm turn/);
  assert.match(rhythm, /automatic turn never changes Memory/);
  assert.match(DJONIK_MEMORY_INSTRUCTIONS, /never write legacy preferences.md/);
  assert.ok(Buffer.byteLength(DJONIK_MEMORY_INSTRUCTIONS, "utf8") <= 4096);
});

test("#52 remains in the unresolved r30 candidate (resolved as r30 by #55); released tuples and serving r29 are untouched", () => {
  assert.equal(SERVING_RELEASE.id, "r29");
  assert.deepEqual(Object.keys(RELEASES), ["r25", "r26", "r27", "r28", "r29", "r30"]);
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null);
  assert.ok(RELEASE_R30_CANDIDATE.skills.filter((item) => item.pin.kind === "unresolved").every((item) => item.skillId === null));
});
