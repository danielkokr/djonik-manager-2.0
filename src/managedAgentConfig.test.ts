import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Issue #28 (Wave C1): safety invariants of the reviewed Project Health specialist
// definition. Narrow on purpose: it pins the read-only / no-Calendar / pinned-Skill
// boundary of one declarative file, not a config framework.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "managed-agents", "project-health-specialist.md"), "utf8").replace(/\r\n/g, "\n");
const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
assert.ok(match, "expected YAML frontmatter followed by a system prompt body");
const frontmatter = match[1];
const system = match[2];

/** Names enabled by the config entries inside one `tools:` item (from `- type: <type>` to the next item). */
function enabledNames(toolType: string): string[] {
  const start = frontmatter.indexOf(`  - type: ${toolType}`);
  assert.ok(start >= 0, `expected a ${toolType} tool entry`);
  const rest = frontmatter.slice(start + 1);
  const next = rest.indexOf("\n  - type:");
  const block = next >= 0 ? rest.slice(0, next) : rest;
  assert.match(block, /default_config:\n\s+enabled: false/, `${toolType} must be default-disabled`);
  return [...block.matchAll(/- name: (\w+)\n\s+enabled: (true|false)/g)].filter((m) => m[2] === "true").map((m) => m[1]);
}

test("specialist is a Sonnet agent with no multiagent roster of its own", () => {
  assert.match(frontmatter, /^model: claude-sonnet-5$/m);
  assert.doesNotMatch(frontmatter, /haiku/i);
  assert.doesNotMatch(frontmatter, /multiagent/);
});

test("specialist attaches only the project-health Skill, pinned to an explicit version", () => {
  const skills = [...frontmatter.matchAll(/- type: custom\n\s+skill_id: (\S+)\n\s+version: (\S+)/g)];
  assert.equal(skills.length, 1);
  assert.equal(skills[0][1], "skill_01Treson5zdU1TgxXDaREwnY");
  assert.match(skills[0][2], /^skver_/);
  assert.equal((frontmatter.match(/skill_id:/g) ?? []).length, 1);
  assert.doesNotMatch(frontmatter, /type: anthropic/);
});

test("specialist declares Trello only and enables exactly the four Project Health reads", () => {
  assert.deepEqual([...frontmatter.matchAll(/^\s+- type: url\n\s+name: (\S+)/gm)].map((m) => m[1]), ["trello"]);
  assert.deepEqual(enabledNames("mcp_toolset"), ["trelloSearch", "trelloReadBoard", "trelloReadList", "trelloReadCard"]);
});

test("every enabled Trello read has an explicit always_allow policy so delegation cannot stall on confirmation", () => {
  const reads = [...frontmatter.matchAll(/- name: (trello\w+)\n\s+enabled: true\n\s+permission_policy:\n\s+type: (\w+)/g)];
  assert.equal(reads.length, 4);
  for (const read of reads) assert.equal(read[2], "always_allow", read[1]);
});

test("specialist has zero Trello mutation capability", () => {
  assert.doesNotMatch(source, /trelloWrite/);
  for (const name of enabledNames("mcp_toolset")) assert.match(name, /^trello(Search|Read)/);
});

test("specialist has no Google Calendar capability", () => {
  // The system prose may state "no Calendar"; the declared configuration must not name it at all.
  assert.doesNotMatch(frontmatter, /calendar/i);
  assert.doesNotMatch(frontmatter, /googleapis/i);
});

test("built-in toolset is default-disabled with only read enabled for loading the Skill", () => {
  assert.deepEqual(enabledNames("agent_toolset_20260401"), ["read"]);
  assert.doesNotMatch(frontmatter, /type: custom\n\s+name:/);
});

test("system contract states the read-only, fresh-evidence, and no-invention boundaries without restating the Skill", () => {
  assert.match(system, /read-only/i);
  assert.match(system, /read again/i);
  assert.match(system, /Keep Waiting and Blocked distinct/);
  assert.match(system, /Backlog is never Waiting/);
  assert.match(system, /`lastActivityAt` is never evidence/);
  assert.match(system, /Do not invent people, entities, dependencies, commitments, or risk/);
  assert.match(system, /self-contained/i);
  assert.ok(system.length < 4200, "system prompt should stay minimal and complement the Skill, not duplicate it");
});

// Wave C1 specialist v2: natural PM voice with evidence discipline. These pin concepts, not exact wording or a
// mandatory answer template, so the specialist can stay conversational.

test("system asks for a natural, concise PM voice and forbids report-like or robotic output", () => {
  assert.match(system, /experienced project manager/i);
  assert.match(system, /naturally/i);
  assert.match(system, /conversational/i);
  assert.match(system, /audit log/i);
  assert.match(system, /compliance checklist/i);
  assert.match(system, /Do not list every card/i);
  assert.match(system, /Do not mention tools, Skills, or this setup/);
  // Voice guidance must not smuggle in a rigid template.
  assert.doesNotMatch(system, /must (use|follow) (this|the following) (template|format|headings)/i);
});

test("system allows PM interpretation only in proportion to the evidence", () => {
  assert.match(system, /interpret/i);
  assert.match(system, /proportionate to the evidence/i);
  assert.match(system, /strongest direct evidence/i);
  assert.match(system, /Do not invent people, entities, dependencies, commitments, or risk/);
});

test("system bars progress, liveness and recency claims from activity or timestamps", () => {
  assert.match(system, /`lastActivityAt` is never evidence of progress, live work, or staleness/);
  assert.match(system, /Never compute a weekday/i);
  assert.match(system, /countdown/i);
  assert.match(system, /vague recency/i);
});

test("system does not treat an internal Trello due alone as a confirmed risk", () => {
  assert.match(system, /internal Trello due alone is not a confirmed risk/i);
  assert.match(system, /reason to check/i);
});

test("system requires silent work and exactly one final report to the coordinator", () => {
  assert.match(system, /work silently/i);
  assert.match(system, /exactly ONE message/);
  assert.match(system, /single clarification question/i);
  assert.match(system, /acknowledgements/i);
  assert.match(system, /progress or status notes/i);
  assert.match(system, /partial reports/i);
});
