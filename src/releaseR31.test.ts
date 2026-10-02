import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_R30, RELEASE_R31, RELEASE_R31_CANDIDATE, RELEASES, SERVING_RELEASE, resolveReleaseCandidate, type ReleaseSkill } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS, attestAgentVersion, attestServingSession, canonicalJsonSha256, compareWithRelease, formatServingTuple, normalizeAgentConfig, sha256 } from "./releaseAttestation.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { TRELLO_PROJECT_TIME_TOOL } from "./projectTimeTool.js";
import { readOnlyBoundaryFor } from "./rhythmRuntime.js";
import { R30_SYSTEM_PROMPT, SOURCE_SYSTEM_PROMPT, agentVersionFixture, r30SkillSource, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

// #64 (docs/102): r31 is the remote-constructed, attested resolution of RELEASE_R31_CANDIDATE — Agent v31, two new
// byte-verified Skill versions (#59 task-management, #62 work-review), the #59 prompt and the #62 trello_project_time tool.
// Constructed WITHOUT a cutover: this revision still serves r30, which is also the immediate rollback.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillSource = (name: string) => readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");

/** Real identifiers as the provider returned them (docs/102 §7–§9, §16). Nothing here is derived. */
const REAL = {
  "task-management": { skillId: "skill_01WS6JtY1GMu3rGZaKCVR9w1", version: "skver_017sbYxMKd3NoUytYFwadrgD", sessionVersion: "1790934141493830", sha: "fce799a31abd44267678d350bf1aa311d4e3cbf205161dd74bad2629d83beac2" },
  "work-review": { skillId: "skill_0169h7GYNYUDDDZteDCUV2fE", version: "skver_0155j1qEvdXYq286L8x6vBFF", sessionVersion: "1790934146362297", sha: "d1b2a22360bad6a00fd94a1d32b36af9e15fefa0f9f5b4527db7d74026523b27" },
} as const;
const resolution = Object.fromEntries(Object.entries(REAL).map(([name, { skillId, version, sessionVersion }]) => [name, { skillId, version, sessionVersion }]));
const explicit = (skill: ReleaseSkill) => {
  assert.equal(skill.pin.kind, "explicit");
  return skill.pin as Extract<ReleaseSkill["pin"], { kind: "explicit" }>;
};

test("r31 is a reviewed, attestable release but NOT the serving release; r30 serves and stays the rollback", () => {
  assert.equal(RELEASES.r31, RELEASE_R31);
  assert.equal(SERVING_RELEASE, RELEASE_R30, "#64 constructs r31 without a source cutover");
  assert.equal(RELEASES[SERVING_RELEASE.id], RELEASE_R30, "the default `release:check` still checks r30");
  assert.equal(RELEASES.r30, RELEASE_R30);
  assert.deepEqual(RELEASE_R31.agent, { id: RELEASE_R30.agent.id, version: 31 });
  assert.equal(RELEASE_R30.agent.version, 30, "r30 stays pinned to immutable Agent v30");
  assert.equal(RELEASE_R31_CANDIDATE.agent.version, null, "the candidate stays unresolved provenance");
  assert.ok(!Object.values(RELEASES).includes(RELEASE_R31_CANDIDATE as never));
});

test("r31 is exactly the candidate resolved with the real remote pins, measured Session spellings and Agent v31", () => {
  assert.deepEqual(resolveReleaseCandidate(RELEASE_R31_CANDIDATE, { skills: resolution, agentVersion: 31 }), RELEASE_R31);
  assert.equal(RELEASE_R31.systemSha256, sha256(SOURCE_SYSTEM_PROMPT), "the reviewed managed-agents/djonik.md body (#59)");
  assert.equal(RELEASE_R30.systemSha256, sha256(R30_SYSTEM_PROMPT));
  assert.equal(readOnlyBoundaryFor(RELEASE_R31), "pre_execution", "every reviewed mutating tool is gated before execution");
});

test("the r30 → r31 delta is exactly the reviewed scope: prompt, two Skill pins and + trello_project_time", () => {
  const changed = (Object.keys(RELEASE_R31) as Array<keyof typeof RELEASE_R31>).filter((key) => JSON.stringify(RELEASE_R31[key]) !== JSON.stringify(RELEASE_R30[key]));
  assert.deepEqual(changed.sort(), ["agent", "customTools", "id", "skills", "systemSha256"]);
  assert.deepEqual(RELEASE_R31.customTools, [...RELEASE_R30.customTools, "trello_project_time"], "no r30 tool lost, one added");
  assert.ok(!RELEASE_R31.customTools.includes("reminder"), "#54 reminder stays dormant");
  for (const key of ["model", "builtInTools", "mcpServers", "mcpToolsets", "confirmationRequired", "session"] as const) {
    assert.deepEqual(RELEASE_R31[key], RELEASE_R30[key], `${key} is r30's`);
  }
  assert.equal(RELEASE_R31.specialist, null, "no roster");
  assert.equal(RELEASE_R31.session.memoryAccess, "read_write");
});

test("r31 Skill pins: two new explicit versions with measured Session spellings; the other three are r30's exactly", () => {
  assert.deepEqual(RELEASE_R31.skills.map((skill) => skill.name), RELEASE_R30.skills.map((skill) => skill.name), "same five Skills, same order");
  for (const skill of RELEASE_R31.skills) {
    const prior = RELEASE_R30.skills.find((entry) => entry.name === skill.name)!;
    assert.equal(skill.skillId, prior.skillId, `${skill.name} keeps its Skill identity`);
    const pin = explicit(skill);
    assert.match(pin.sessionVersion ?? "", /^\d{16}$/, `${skill.name} has a measured numeric Session spelling`);
    const real = REAL[skill.name as keyof typeof REAL];
    if (real) {
      assert.equal(pin.version, real.version);
      assert.equal(pin.sessionVersion, real.sessionVersion);
      assert.notDeepEqual(skill.pin, prior.pin, `${skill.name} moves to its r31 version`);
      // The pinned version was downloaded byte-identical to this committed source (docs/102 §8).
      assert.equal(sha256(skillSource(skill.name)), real.sha, `${skill.name} repo source drifted from its r31 pin`);
      assert.notEqual(r30SkillSource(skill.name), skillSource(skill.name), `${skill.name}: r30 pins the source minus the #59/#62 edit`);
    } else {
      assert.deepEqual(skill, prior, `${skill.name}: r30 pin reused unchanged`);
    }
  }
});

test("the v30 → v31 update body regenerates exactly: prompt, Skills and tools together; roster and MCP preserved", () => {
  const body = buildCandidateUpdateBody(RELEASE_R31_CANDIDATE, { skills: resolution }, SOURCE_SYSTEM_PROMPT);
  assert.equal(body.version, 30, "optimistic-concurrency precondition on Agent v30");
  assert.deepEqual(Object.keys(body).sort(), ["skills", "system", "tools", "version"], "model, roster, MCP servers, name, description and metadata preserved by omission");
  assert.equal(sha256(JSON.stringify(body)), "316f8a0a319ae65309ab07dd2b39c7cdf44a98f5d1acbc3b17980deb9547986c", "the body that created Agent v31");
  const v30 = agentVersionFixture(RELEASE_R30);
  const v31 = { ...v30, version: 31, skills: body.skills, tools: body.tools, system: body.system };
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R31, v31));
  assert.deepEqual(v31, agentVersionFixture(RELEASE_R31));
  // `release:check -- r31 --plan` refuses a Skills/tools-only body for a prompt change.
  assert.throws(() => buildReleaseUpdateBody(RELEASE_R31, 30), /changes the prompt/);
});

test("trello_project_time on r31 is the executable #62 source: name, description and schema, byte/canonically", () => {
  assert.equal(SUPPORTED_CUSTOM_TOOLS.trello_project_time, TRELLO_PROJECT_TIME_TOOL);
  const body = buildCandidateUpdateBody(RELEASE_R31_CANDIDATE, { skills: resolution }, SOURCE_SYSTEM_PROMPT);
  const tool = (body.tools as Array<Record<string, unknown>>).find((entry) => entry.name === "trello_project_time")!;
  assert.equal(tool.type, "custom");
  assert.equal(tool.description, TRELLO_PROJECT_TIME_TOOL.description);
  assert.equal(JSON.stringify(tool.input_schema), JSON.stringify(TRELLO_PROJECT_TIME_TOOL.input_schema));
  // As measured on the Agent v31 read-back (docs/102 §13).
  assert.equal(canonicalJsonSha256(TRELLO_PROJECT_TIME_TOOL.input_schema), "92a7f5b4492ac7cd33667158a5b34ab4c642abd77240c7bb5237b30a54183818");
  assert.equal(sha256(TRELLO_PROJECT_TIME_TOOL.description), "dc5d60388407e0b06e7e0bb4f91e74f184bd8711943f3529731543cb73d09d2e");
});

test("Agent v31 attests as r31 and never as r30; a missing project-time tool or the r30 prompt fails closed", () => {
  const v31 = agentVersionFixture(RELEASE_R31) as Record<string, any>;
  assert.equal(v31.multiagent, null);
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R31, v31));
  assert.throws(() => attestAgentVersion(RELEASE_R30, v31), /agent version 31 != 30/);
  assert.throws(() => attestAgentVersion(RELEASE_R31, agentVersionFixture(RELEASE_R30)), /agent version 30 != 31/);
  const withoutTool = { ...v31, tools: v31.tools.filter((tool: Record<string, unknown>) => tool.name !== "trello_project_time") };
  assert.throws(() => attestAgentVersion(RELEASE_R31, withoutTool), /custom tools/);
  assert.throws(() => attestAgentVersion(RELEASE_R31, { ...v31, system: R30_SYSTEM_PROMPT }), /system sha/);
});

test("the measured zero-event inspection snapshot attests as r31; it differs from serving only by read_only Memory", () => {
  const session = servingSessionFixture(RELEASE_R31, "sesn_01KBpyKTVamwzvTwtJTUk3HX") as Record<string, any>;
  assert.deepEqual(session.agent.skills.map((skill: Record<string, string>) => skill.version),
    ["1790934141493830", "1790666103656343", "1790666109304881", "1790934146362297", "1790666114030041"], "the snapshot spells pins numerically");
  assert.doesNotThrow(() => attestServingSession(RELEASE_R31, session));
  session.resources[0].access = "read_only";
  assert.deepEqual(compareWithRelease(RELEASE_R31, normalizeAgentConfig(session.agent)), []);
  assert.throws(() => attestServingSession(RELEASE_R31, session), /^(?!.*skill).*memory access read_only != read_write/);
});

test("a wrong, `latest` or unmeasured Session spelling of an r31 pin fails closed", () => {
  const good = servingSessionFixture(RELEASE_R31) as Record<string, any>;
  const offByOne = structuredClone(good);
  offByOne.agent.skills[3].version = "1790934146362298";
  assert.throws(() => attestServingSession(RELEASE_R31, offByOne), /skill work-review version 1790934146362298/);
  const latest = structuredClone(good);
  latest.agent.skills[0].version = "latest";
  assert.throws(() => attestServingSession(RELEASE_R31, latest), /skill task-management version latest/);
  // r30's task-management spelling is not r31's.
  const stale = structuredClone(good);
  stale.agent.skills[0].version = explicit(RELEASE_R30.skills[0]).sessionVersion;
  assert.throws(() => attestServingSession(RELEASE_R31, stale), /skill task-management version 1790666094447918/);
  const unmeasured = { ...RELEASE_R31, skills: RELEASE_R31.skills.map((skill) => skill.name === "task-management" ? { ...skill, pin: { kind: "explicit" as const, version: explicit(skill).version } } : skill) };
  assert.throws(() => attestServingSession(unmeasured, good), /skill task-management version 1790934141493830 != skver_017sbYxMKd3NoUytYFwadrgD/);
});

test("the r31 serving tuple line would record four custom tools and both gated Trello writes", () => {
  const observed = normalizeAgentConfig(agentVersionFixture(RELEASE_R31));
  const line = formatServingTuple({ release: RELEASE_R31, appRevision: "rev", sessionId: "sesn_x", observed });
  assert.match(line, /release=r31 /);
  assert.match(line, /agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@31 /);
  assert.match(line, /specialist=none/);
  assert.match(line, /always_ask=edit,trello\/trelloWriteCard,trello\/trelloWriteChecklist,write/);
  assert.match(line, /custom_tools=trello_work_history#\w+,trello_board_snapshot#\w+,focus_budget#\w+,trello_project_time#92a7f5b4492a/);
});
