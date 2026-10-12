import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_R31, RELEASE_R32, RELEASE_R32_CANDIDATE, RELEASES, SERVING_RELEASE, resolveReleaseCandidate, type ReleaseSkill } from "./release.js";
import { attestAgentVersion, attestServingSession, canonicalJsonSha256, compareWithRelease, customToolDefinition, formatServingTuple, normalizeAgentConfig, sha256 } from "./releaseAttestation.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { REMINDER_TOOL, REMINDER_TOOL_NAME } from "./reminderTool.js";
import { readOnlyBoundaryFor } from "./rhythmRuntime.js";
import { TRELLO_WORK_HISTORY_TOOL, TRELLO_WORK_HISTORY_TOOL_NEXT } from "./trelloWorkHistory.js";
import { SOURCE_SYSTEM_PROMPT, agentVersionFixture, r31SkillSource, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

// #70 (docs/110): r32 is the remote-constructed, attested resolution of RELEASE_R32_CANDIDATE — Agent v32, three new
// byte-verified Skill versions (#66/#67/#69), the v2 trello_work_history definition (#66/#69) and the #54 reminder tool
// (#68). #70 constructed it WITHOUT a cutover; the r32 source cutover (docs/111) made it this revision's serving release.
// r31 is the immediate rollback. The host serves it only after a separately authorized deploy.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillSource = (name: string) => readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");

/** Real identifiers as the provider returned them (docs/110). Nothing here is derived. */
const REAL = {
  "planning-and-focus": { skillId: "skill_01PxXTvhbZSrbxqi7gmDs6KW", version: "skver_01JkUyb6btqQcLJVfq4cz9kp", sessionVersion: "1791793798537727", sha: "6da1cf10e92aa5fbe71c0543df3f5823471f1cceab07f2b69bb4a04f42edcb0c" },
  "work-review": { skillId: "skill_0169h7GYNYUDDDZteDCUV2fE", version: "skver_01J39PC8Fvw5UEhsC6ZufHBr", sessionVersion: "1791793802823947", sha: "b52f1b2df4f70b02426a54d19c86fa53fdba483041d17c2b6c686c73681bffc9" },
  "pm-rhythm": { skillId: "skill_01GzpQX3bVuWNk5bhbGcbzku", version: "skver_01QhCPnJ128imU5h4Hhfgi2e", sessionVersion: "1791793807571556", sha: "82d3dd97417d349a0944a1f42acfc8ba144d1a2f862d33c4ead92da5fbefb46e" },
} as const;
const resolution = Object.fromEntries(Object.entries(REAL).map(([name, { skillId, version, sessionVersion }]) => [name, { skillId, version, sessionVersion }]));
const explicit = (skill: ReleaseSkill) => {
  assert.equal(skill.pin.kind, "explicit");
  return skill.pin as Extract<ReleaseSkill["pin"], { kind: "explicit" }>;
};

test("r32 is a reviewed, attestable release and the serving release of this revision (docs/111); r31 is the rollback", () => {
  assert.equal(RELEASES.r32, RELEASE_R32);
  assert.equal(SERVING_RELEASE, RELEASE_R32, "r32 source cutover");
  assert.equal(RELEASES[SERVING_RELEASE.id], RELEASE_R32, "the default `release:check` checks r32");
  assert.equal(RELEASES.r31, RELEASE_R31, "r31 stays a reviewed rollback release");
  assert.deepEqual(RELEASE_R32.agent, { id: RELEASE_R31.agent.id, version: 32 });
  assert.equal(RELEASE_R31.agent.version, 31, "r31 stays pinned to immutable Agent v31");
  assert.equal(RELEASE_R32_CANDIDATE.agent.version, null, "the candidate stays unresolved provenance");
  assert.ok(!Object.values(RELEASES).includes(RELEASE_R32_CANDIDATE as never));
});

test("r32 is exactly the candidate resolved with the real remote pins, measured Session spellings and Agent v32", () => {
  assert.deepEqual(resolveReleaseCandidate(RELEASE_R32_CANDIDATE, { skills: resolution, agentVersion: 32 }), RELEASE_R32);
  assert.equal(RELEASE_R32.systemSha256, sha256(SOURCE_SYSTEM_PROMPT), "the reviewed managed-agents/djonik.md body, unchanged since r31");
  assert.equal(readOnlyBoundaryFor(RELEASE_R32), "pre_execution", "every reviewed mutating tool is gated before execution");
});

test("the r31 → r32 delta is exactly the reviewed scope: three Skill pins, the work-history definition and + reminder", () => {
  const changed = (Object.keys(RELEASE_R32) as Array<keyof typeof RELEASE_R32>).filter((key) => JSON.stringify(RELEASE_R32[key]) !== JSON.stringify(RELEASE_R31[key]));
  assert.deepEqual(changed.sort(), ["agent", "customToolRevisions", "customTools", "id", "skills"]);
  assert.deepEqual(RELEASE_R32.customTools, [...RELEASE_R31.customTools, REMINDER_TOOL_NAME], "no r31 tool lost, one added");
  assert.equal(RELEASE_R32.customTools.filter((name) => name === REMINDER_TOOL_NAME).length, 1);
  assert.deepEqual(RELEASE_R32.customToolRevisions, { trello_work_history: "v2" });
  for (const key of ["model", "systemSha256", "builtInTools", "mcpServers", "mcpToolsets", "confirmationRequired", "session", "specialist"] as const) {
    assert.deepEqual(RELEASE_R32[key], RELEASE_R31[key], `${key} is r31's`);
  }
  assert.equal(RELEASE_R32.session.memoryAccess, "read_write");
});

test("r32 Skill pins: three new explicit versions with measured Session spellings; task-management and studio-intake are r31's exactly", () => {
  assert.deepEqual(RELEASE_R32.skills.map((skill) => skill.name), RELEASE_R31.skills.map((skill) => skill.name), "same five Skills, same order");
  for (const skill of RELEASE_R32.skills) {
    const prior = RELEASE_R31.skills.find((entry) => entry.name === skill.name)!;
    assert.equal(skill.skillId, prior.skillId, `${skill.name} keeps its Skill identity`);
    const pin = explicit(skill);
    assert.match(pin.sessionVersion ?? "", /^\d{16}$/, `${skill.name} has a measured numeric Session spelling`);
    const real = REAL[skill.name as keyof typeof REAL];
    if (real) {
      assert.equal(real.skillId, prior.skillId);
      assert.equal(pin.version, real.version);
      assert.equal(pin.sessionVersion, real.sessionVersion);
      assert.notDeepEqual(skill.pin, prior.pin, `${skill.name} moves to its r32 version`);
      // The pinned version was downloaded byte-identical to this committed source (docs/110).
      assert.equal(sha256(skillSource(skill.name)), real.sha, `${skill.name} repo source drifted from its r32 pin`);
      assert.notEqual(r31SkillSource(skill.name), skillSource(skill.name), `${skill.name}: r31 pins the source minus the #66/#67/#69 edits`);
    } else {
      assert.deepEqual(skill, prior, `${skill.name}: r31 pin reused unchanged`);
      assert.equal(r31SkillSource(skill.name), skillSource(skill.name), `${skill.name}: source unchanged since r31`);
    }
  }
});

test("the v31 → v32 update body regenerates exactly: Skills and tools only; prompt, model, roster and MCP preserved by omission", () => {
  const body = buildCandidateUpdateBody(RELEASE_R32_CANDIDATE, { skills: resolution });
  assert.equal(body.version, 31, "optimistic-concurrency precondition on Agent v31");
  assert.deepEqual(Object.keys(body).sort(), ["skills", "tools", "version"]);
  assert.equal(sha256(JSON.stringify(body)), "8fe8d89baac77aa5c28361c049ccbcf7e2fc0a1a1d89d6106e008b737f92f997", "the body that created Agent v32");
  const v31 = agentVersionFixture(RELEASE_R31);
  const v32 = { ...v31, version: 32, skills: body.skills, tools: body.tools };
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R32, v32));
  assert.deepEqual(v32, agentVersionFixture(RELEASE_R32));
  // The prompt is unchanged, so `release:check -- r32 --plan --from 31` prints the same body.
  assert.deepEqual(buildReleaseUpdateBody(RELEASE_R32, 31), body);
});

test("trello_work_history on r32 is the final #66/#69 definition; on r31 it is still the frozen original", () => {
  assert.equal(customToolDefinition(RELEASE_R32, "trello_work_history"), TRELLO_WORK_HISTORY_TOOL_NEXT);
  assert.equal(customToolDefinition(RELEASE_R31, "trello_work_history"), TRELLO_WORK_HISTORY_TOOL);
  // As measured on the Agent v32 and v31 read-backs (docs/110).
  assert.equal(canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema), "32042ea1ce27e6034dcbb912147b55c903972bc78d962249fdd5d0be1bb2bc87");
  assert.equal(sha256(TRELLO_WORK_HISTORY_TOOL_NEXT.description), "58cb3e65d3495988de3b182c1a62b28a12b6c369b38de0a0b7665a6b415eb6fe");
  assert.equal(canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL.input_schema), "dcf099612535293e275cd64281dd7ed8e1ee6c44b19159c3cf221976d845b196");
  assert.equal(sha256(TRELLO_WORK_HISTORY_TOOL.description), "b7622094570277c2aebe08341343efb29bd1c5686d4cfea63bc7ddb38b0fd1cc");
  const tools = normalizeAgentConfig(agentVersionFixture(RELEASE_R32)).customTools;
  assert.equal(tools.find((tool) => tool.name === "trello_work_history")!.schemaSha256.slice(0, 12), "32042ea1ce27");
});

test("reminder on r32 is the executable #54 source: name, description and schema, byte/canonically", () => {
  assert.equal(customToolDefinition(RELEASE_R32, REMINDER_TOOL_NAME), REMINDER_TOOL);
  // As measured on the Agent v32 read-back (docs/110).
  assert.equal(canonicalJsonSha256(REMINDER_TOOL.input_schema), "1ad79abe2cae7a0bc4e3c06570a06999c3e264098c04a8f1993d9d347ab1e797");
  assert.equal(sha256(REMINDER_TOOL.description), "4220682332e5e40c001aaf655ee46d5ffb651d4c50fdbdcd3a094a31669996fe");
  assert.ok(!RELEASE_R31.customTools.includes(REMINDER_TOOL_NAME), "r31 has none");
});

test("Agent v32 attests as r32 and never as r31; v31 attests as r31 and never as r32 — the rollback stays exact", () => {
  const v32 = agentVersionFixture(RELEASE_R32) as Record<string, any>;
  const v31 = agentVersionFixture(RELEASE_R31) as Record<string, any>;
  assert.equal(v32.multiagent, null);
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R32, v32));
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R31, v31));
  assert.throws(() => attestAgentVersion(RELEASE_R31, v32), /agent version 32 != 31/);
  assert.throws(() => attestAgentVersion(RELEASE_R32, v31), /agent version 31 != 32/);
  const withoutReminder = { ...v32, tools: v32.tools.filter((tool: Record<string, unknown>) => tool.name !== REMINDER_TOOL_NAME) };
  assert.throws(() => attestAgentVersion(RELEASE_R32, withoutReminder), /custom tools/);
  const duplicated = { ...v32, tools: [...v32.tools, v32.tools.find((tool: Record<string, unknown>) => tool.name === REMINDER_TOOL_NAME)] };
  assert.throws(() => attestAgentVersion(RELEASE_R32, duplicated), /custom tools/);
  const oldDefinition = { ...v32, tools: v32.tools.map((tool: Record<string, unknown>) => (tool.name === "trello_work_history" ? { ...tool, description: TRELLO_WORK_HISTORY_TOOL.description, input_schema: TRELLO_WORK_HISTORY_TOOL.input_schema } : tool)) };
  assert.throws(() => attestAgentVersion(RELEASE_R32, oldDefinition), /custom tool trello_work_history schema dcf099612535 != 32042ea1ce27/);
});

test("the measured zero-event inspection snapshot attests as r32; it differs from serving only by read_only Memory", () => {
  const session = servingSessionFixture(RELEASE_R32, "sesn_01T19sr3fCmXmTDSQ9wcHZrm") as Record<string, any>;
  assert.deepEqual(session.agent.skills.map((skill: Record<string, string>) => skill.version),
    ["1790934141493830", "1791793798537727", "1790666109304881", "1791793802823947", "1791793807571556"], "the snapshot spells pins numerically");
  assert.doesNotThrow(() => attestServingSession(RELEASE_R32, session));
  session.resources[0].access = "read_only";
  assert.deepEqual(compareWithRelease(RELEASE_R32, normalizeAgentConfig(session.agent)), []);
  assert.throws(() => attestServingSession(RELEASE_R32, session), /^(?!.*skill).*memory access read_only != read_write/);
});

test("a wrong, `latest` or stale Session spelling of an r32 pin fails closed", () => {
  const good = servingSessionFixture(RELEASE_R32) as Record<string, any>;
  const offByOne = structuredClone(good);
  offByOne.agent.skills[3].version = "1791793802823948";
  assert.throws(() => attestServingSession(RELEASE_R32, offByOne), /skill work-review version 1791793802823948/);
  const latest = structuredClone(good);
  latest.agent.skills[1].version = "latest";
  assert.throws(() => attestServingSession(RELEASE_R32, latest), /skill planning-and-focus version latest/);
  // r31's pm-rhythm spelling is not r32's.
  const stale = structuredClone(good);
  stale.agent.skills[4].version = explicit(RELEASE_R31.skills[4]).sessionVersion;
  assert.throws(() => attestServingSession(RELEASE_R32, stale), /skill pm-rhythm version 1790666114030041/);
});

test("the r32 serving tuple line would record five custom tools, reminder included", () => {
  const observed = normalizeAgentConfig(agentVersionFixture(RELEASE_R32));
  const line = formatServingTuple({ release: RELEASE_R32, appRevision: "rev", sessionId: "sesn_x", observed });
  assert.match(line, /release=r32 /);
  assert.match(line, /agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@32 /);
  assert.match(line, /specialist=none/);
  assert.match(line, /always_ask=edit,trello\/trelloWriteCard,trello\/trelloWriteChecklist,write/);
  assert.match(line, /custom_tools=trello_work_history#32042ea1ce27,trello_board_snapshot#\w+,focus_budget#\w+,trello_project_time#92a7f5b4492a,reminder#1ad79abe2cae/);
});
