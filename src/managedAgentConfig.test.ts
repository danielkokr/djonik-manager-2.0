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
  // Ceiling raised 5000 -> 6500 for the v4 final-answer discipline (user-facing-only final, no pool counts, no
  // unsupported actor, silent self-check): about 1.6k characters of new rules, still bounded and still not a Skill copy.
  assert.ok(system.length < 6500, "system prompt should stay minimal and complement the Skill, not duplicate it");
});

// Wave C1 specialist v2/v3: natural PM voice with evidence discipline. These pin concepts, not exact wording or a
// mandatory answer template, so the specialist can stay conversational.

test("system asks for a natural, concise PM voice and forbids report-like or robotic output", () => {
  assert.match(system, /experienced project manager/i);
  assert.match(system, /naturally/i);
  assert.match(system, /conversational/i);
  assert.match(system, /audit log/i);
  assert.match(system, /compliance checklist/i);
  assert.match(system, /do not list every card/i);
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

// Wave C1 specialist v3: a short health check is a small natural PM read, not a structured report. Concepts only:
// no exact-response snapshot and no pinned example wording.

test("system defaults a short health check to compact natural prose with no headings, bullets or table", () => {
  assert.match(system, /short health check defaults to one compact paragraph/i);
  assert.match(system, /three to five natural sentences/i);
  assert.match(system, /no headings, bullets, or table/i);
  assert.match(system, /no wording template/i);
});

test("system allows structure only when Daniel explicitly asks for details, a list or a table", () => {
  assert.match(system, /explicitly asks for details, a breakdown, a list, all cards, or a table/i);
  assert.match(system, /structure and bullets are fine/i);
});

test("system leads with the PM read rather than a preamble or the evidence process", () => {
  assert.match(system, /Lead with the PM read/);
  assert.match(system, /first sentence answers what Daniel actually asked/i);
  assert.match(system, /not "here is the health check"/i);
});

test("system does not enumerate cards or expose evidence mechanics by default", () => {
  assert.match(system, /only facts that change the judgement/i);
  assert.match(system, /at most a few supporting cards/i);
  assert.match(system, /Done cards/);
  assert.match(system, /Inspecting many cards does not put them in the answer/i);
  assert.match(system, /Do not explain how the project was found/i);
  assert.match(system, /board vs label/i);
  assert.match(system, /unless a scope limit is needed/i);
});

test("system avoids raw timestamps by default but still allows the recorded value when it matters", () => {
  assert.match(system, /Do not quote a raw timestamp just to say a card has a due/i);
  assert.match(system, /if the exact date matters or Daniel asks for it, quote the recorded Trello value as-is/i);
  assert.match(system, /no conversion or derivation/i);
  assert.match(system, /Never compute a weekday/i);
});

test("system treats coordinator-added context as a hint, not evidence, and requires fresh verification", () => {
  assert.match(system, /coordinator-added descriptions or assumptions/i);
  assert.match(system, /hints, not evidence/i);
  assert.match(system, /fresh Trello or trusted durable context/i);
  assert.match(system, /Ignore a coordinator description that is unsupported or conflicts with fresh evidence/i);
});

test("system keeps risk claims proportionate and gives one practical next PM step", () => {
  assert.match(system, /nothing is critical or definitely late without evidence/i);
  assert.match(system, /one practical next PM step/i);
});

// Wave C1 specialist v4: final-answer discipline after the §44 production smoke. Concepts only: no exact-response
// snapshot and no pinned Ukrainian wording.

test("system makes the one message to the coordinator user-facing content only", () => {
  assert.match(system, /user-facing content only/i);
  assert.match(system, /exactly what Daniel should read/i);
  assert.match(system, /relayed to him unchanged/i);
  assert.match(system, /no second channel for coordinator metadata/i);
  assert.match(system, /never add a technical note, a note for the coordinator/i);
  assert.match(system, /handoff or internal text/i);
  assert.match(system, /instructions to the coordinator/i);
  assert.match(system, /postscript addressed to anyone other than Daniel/i);
  assert.match(system, /If something should not be shown to Daniel, do not send it at all/i);
});

test("system keeps evidence, discovery and tool mechanics out of the final message", () => {
  assert.match(system, /evidence-process narration/i);
  assert.match(system, /discovery, search or tool mechanics/i);
  assert.match(system, /counts of what you inspected/i);
  // A needed scope limit is allowed only as one plain clause for Daniel, never as a separate note.
  assert.match(system, /one plain clause inside the answer itself, never as a separate note/i);
});

test("system forbids project-pool summaries and card counts unless Daniel explicitly asks for them", () => {
  assert.match(system, /Do not summarize the rest of the project/i);
  assert.match(system, /no cards per list/i);
  assert.match(system, /no totals or open\/Done\/Backlog counts/i);
  assert.match(system, /no card arithmetic/i);
  assert.match(system, /only when Daniel explicitly asks for counts, totals, an inventory, or a full breakdown/i);
});

test("system bars recommending an unsupported actor, assignee, client or team", () => {
  assert.match(system, /Do not send Daniel to "the executor", "the assignee", "the client", "the team"/i);
  assert.match(system, /a named person, or any other actor/i);
  assert.match(system, /unless fresh Trello evidence or trusted durable context establishes that actor's role/i);
  assert.match(system, /if ownership is unknown, phrase the step without an actor/i);
});

test("system allows exactly one practical next PM step with no extra recommendations or workflow", () => {
  assert.match(system, /exactly one practical next PM step/i);
  assert.match(system, /no second or third recommendation/i);
  assert.match(system, /no speculative workflow/i);
});

test("system requires a silent pre-send self-check that is never exposed", () => {
  assert.match(system, /Before sending, silently check the message/i);
  assert.match(system, /is every sentence meant for Daniel/i);
  assert.match(system, /any card count Daniel did not ask for/i);
  assert.match(system, /any invented actor, owner or assignee/i);
  assert.match(system, /more than one next step/i);
  assert.match(system, /any fact that does not change the judgement/i);
  assert.match(system, /Remove whatever fails the check, and never mention the check/i);
});
