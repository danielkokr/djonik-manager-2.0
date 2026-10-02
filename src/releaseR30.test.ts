import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R29, RELEASE_R30, RELEASE_R30_CANDIDATE, RELEASES, SERVING_RELEASE, resolveReleaseCandidate, type ReleaseSkill } from "./release.js";
import { attestAgentVersion, attestServingSession, compareWithRelease, formatServingTuple, normalizeAgentConfig, sha256 } from "./releaseAttestation.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { readOnlyBoundaryFor } from "./rhythmRuntime.js";
import { PROJECT_HEALTH_SPECIALIST_AGENT_ID } from "./djonikClient.js";
import { R30_SYSTEM_PROMPT, agentVersionFixture, r30SkillSource, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

// #55 (docs/92): r30 is the remote-constructed, attested resolution of RELEASE_R30_CANDIDATE — Agent v30, four new
// byte-verified Skill versions, no roster. #56 (docs/93): this revision serves it; the host serves r29 until deployed.


/** Real identifiers as the provider returned them (docs/92 §7–§8, §22). Nothing here is derived. */
const REAL = {
  "task-management": { skillId: "skill_01WS6JtY1GMu3rGZaKCVR9w1", version: "skver_01KzWwpv88cC2K2nncoTdkt2", sessionVersion: "1790666094447918", sha: "e30e8aa1d86bc8ce9a04a822bc27106edc8609583cc771eb39366cd6010180d5" },
  "planning-and-focus": { skillId: "skill_01PxXTvhbZSrbxqi7gmDs6KW", version: "skver_01L9cL8yv244qmpXSyqvmqzJ", sessionVersion: "1790666103656343", sha: "a1f743f67de58ef0aa99cb4ca941789f8b976fb4ce1cead8059f81f2461c9f08" },
  "studio-intake": { skillId: "skill_015c8dtDnWyDfVLwS6NLS7r6", version: "skver_01SYUXncujJcAWuXz1wbD69U", sessionVersion: "1790666109304881", sha: "e96b38c0e2606b1eb8488e93347f9a09f8e25b2611bf749e1a06c543f0bdc0d0" },
  "pm-rhythm": { skillId: "skill_01GzpQX3bVuWNk5bhbGcbzku", version: "skver_01BetXsjNcGqmaHY9MpNQgns", sessionVersion: "1790666114030041", sha: "f3592baa50fe4708805e3717d07a1efee2c48ada392ed811d5124d31f23a7d0f" },
} as const;
const resolution = Object.fromEntries(Object.entries(REAL).map(([name, { skillId, version, sessionVersion }]) => [name, { skillId, version, sessionVersion }]));
const explicit = (skill: ReleaseSkill) => {
  assert.equal(skill.pin.kind, "explicit");
  return skill.pin as Extract<ReleaseSkill["pin"], { kind: "explicit" }>;
};

test("r30 is a reviewed, attestable release and the serving release of this revision (#56); r29 is the rollback", () => {
  assert.equal(RELEASES.r30, RELEASE_R30);
  assert.equal(SERVING_RELEASE, RELEASE_R30, "#56 source cutover");
  assert.equal(RELEASES[SERVING_RELEASE.id], RELEASE_R30, "the default `release:check` checks r30");
  assert.equal(RELEASES.r29, RELEASE_R29, "r29 stays a reviewed rollback release");
  assert.equal(RELEASE_R30.id, "r30");
  assert.deepEqual(RELEASE_R30.agent, { id: RELEASE_R29.agent.id, version: 30 });
  assert.equal(RELEASE_R29.agent.version, 29, "r29 stays pinned to immutable Agent v29");
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null, "the candidate stays unresolved provenance");
});

test("r30 is exactly the candidate resolved with the real remote pins, measured Session spellings and Agent v30", () => {
  assert.deepEqual(resolveReleaseCandidate(RELEASE_R30_CANDIDATE, { skills: resolution, agentVersion: 30 }), RELEASE_R30);
  assert.equal(RELEASE_R30.systemSha256, sha256(R30_SYSTEM_PROMPT), "the reviewed managed-agents/djonik.md body minus the unsynced #59 edit");
  assert.equal(RELEASE_R30.specialist, null, "coordinator-only topology (#44)");
  assert.deepEqual(RELEASE_R30.model, RELEASE_R29.model);
  assert.deepEqual(RELEASE_R30.builtInTools, RELEASE_R29.builtInTools);
  assert.deepEqual(RELEASE_R30.session, RELEASE_R29.session, "same environment, vault, Memory store and read_write access");
  assert.deepEqual(RELEASE_R30.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget"]);
  assert.ok(!RELEASE_R30.customTools.includes("reminder"), "#54 reminder stays dormant");
  assert.deepEqual(RELEASE_R30.mcpServers, [{ name: "trello", url: "https://mcp.trello.com/v1" }], "Calendar MCP removed");
  assert.deepEqual(RELEASE_R30.confirmationRequired, { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard", "trelloWriteChecklist"] } });
  assert.equal(readOnlyBoundaryFor(RELEASE_R30), "pre_execution", "every reviewed mutating tool is gated before execution");
});

test("r30 Skill pins: four new explicit versions with measured Session spellings; work-review keeps its r29 pin", () => {
  assert.deepEqual(RELEASE_R30.skills.map((skill) => skill.name), RELEASE_R29.skills.map((skill) => skill.name), "same five Skills, same order");
  for (const skill of RELEASE_R30.skills) {
    const prior = RELEASE_R29.skills.find((entry) => entry.name === skill.name)!;
    assert.equal(skill.skillId, prior.skillId, `${skill.name} keeps its Skill identity`);
    const pin = explicit(skill);
    assert.match(pin.sessionVersion ?? "", /^\d{16}$/, `${skill.name} has a measured numeric Session spelling`);
    const real = REAL[skill.name as keyof typeof REAL];
    if (real) {
      assert.equal(pin.version, real.version);
      assert.equal(pin.sessionVersion, real.sessionVersion);
      assert.notDeepEqual(skill.pin, prior.pin, `${skill.name} moves to its r30 version`);
      // The pinned version was downloaded byte-identical to this committed source (docs/92 §9).
      assert.equal(sha256(r30SkillSource(skill.name)), real.sha, `${skill.name} repo source (minus unsynced #59 edits) drifted from its r30 pin`);
    } else {
      assert.equal(skill.name, "work-review");
      assert.deepEqual(skill, prior, "work-review: remote bytes already equal the repo; the r29 pin is reused");
      assert.equal(sha256(r30SkillSource("work-review")).slice(0, 8), "c079d285", "work-review source minus the unsynced #62 edit = its r29/r30 pin");
    }
  }
});

test("the v29 → v30 update body regenerates exactly: prompt, Skills, tools, MCP servers and the roster clear together", () => {
  const body = buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: resolution }, R30_SYSTEM_PROMPT);
  assert.equal(body.version, 29, "optimistic-concurrency precondition on Agent v29");
  assert.deepEqual(Object.keys(body).sort(), ["mcp_servers", "multiagent", "skills", "system", "tools", "version"], "model, name, description and metadata preserved by omission");
  assert.ok("multiagent" in body && body.multiagent === null, "the roster is cleared explicitly, never preserved by omission");
  assert.equal(sha256(JSON.stringify(body)), "718770ea25098f79cf251605b945f7231f944509582c3ee3541dee6f78127da4", "the body that created Agent v30");
  const v29 = agentVersionFixture(RELEASE_R29);
  const v30 = { ...v29, version: 30, skills: body.skills, tools: body.tools, system: body.system, mcp_servers: body.mcp_servers, multiagent: body.multiagent };
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R30, v30));
  assert.deepEqual(v30, agentVersionFixture(RELEASE_R30));
  // `release:check -- r30 --plan` refuses a Skills/tools-only body for a prompt + roster change.
  assert.throws(() => buildReleaseUpdateBody(RELEASE_R30, 29), /changes the prompt/);
});

test("Agent v30 attests as r30 and never as r29; the retired specialist or any roster member fails closed", () => {
  const v30 = agentVersionFixture(RELEASE_R30) as Record<string, any>;
  assert.equal(v30.multiagent, null);
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R30, v30));
  assert.throws(() => attestAgentVersion(RELEASE_R29, v30), /agent version 30 != 29/);
  assert.throws(() => attestAgentVersion(RELEASE_R30, agentVersionFixture(RELEASE_R29)), /agent version 29 != 30/);
  const stale = { ...v30, multiagent: { type: "coordinator", agents: [{ type: "agent", id: PROJECT_HEALTH_SPECIALIST_AGENT_ID, version: 4 }] } };
  assert.throws(() => attestAgentVersion(RELEASE_R30, stale), /unexpected roster member agent_01KNiQDzzPjaMU6LLF4mU6uM@4/);
  const calendar = { ...v30, mcp_servers: agentVersionFixture(RELEASE_R29).mcp_servers };
  assert.throws(() => attestAgentVersion(RELEASE_R30, calendar), /mcp servers/);
});

test("the measured zero-event inspection snapshot attests as r30; it differs from serving only by read_only Memory", () => {
  const session = servingSessionFixture(RELEASE_R30, "sesn_017J9XJDeTKVngGTZ5hq49dH") as Record<string, any>;
  assert.deepEqual(session.agent.skills.map((skill: Record<string, string>) => skill.version),
    ["1790666094447918", "1790666103656343", "1790666109304881", "1790083840153637", "1790666114030041"], "the snapshot spells pins numerically");
  assert.equal(session.agent.multiagent, null);
  assert.doesNotThrow(() => attestServingSession(RELEASE_R30, session));
  session.resources[0].access = "read_only";
  assert.deepEqual(compareWithRelease(RELEASE_R30, normalizeAgentConfig(session.agent)), []);
  assert.throws(() => attestServingSession(RELEASE_R30, session), /^(?!.*skill).*memory access read_only != read_write/);
});

test("a wrong, `latest` or unmeasured Session spelling of an r30 pin fails closed", () => {
  const good = servingSessionFixture(RELEASE_R30) as Record<string, any>;
  const offByOne = structuredClone(good);
  offByOne.agent.skills[1].version = "1790666103656344";
  assert.throws(() => attestServingSession(RELEASE_R30, offByOne), /skill planning-and-focus version 1790666103656344/);
  const latest = structuredClone(good);
  latest.agent.skills[0].version = "latest";
  assert.throws(() => attestServingSession(RELEASE_R30, latest), /skill task-management version latest/);
  // Without its measured spelling the pin would fail at startup — which is why it was measured, never guessed.
  const unmeasured = { ...RELEASE_R30, skills: RELEASE_R30.skills.map((skill) => skill.name === "pm-rhythm" ? { ...skill, pin: { kind: "explicit" as const, version: explicit(skill).version } } : skill) };
  assert.throws(() => attestServingSession(unmeasured, good), /skill pm-rhythm version 1790666114030041 != skver_01BetXsjNcGqmaHY9MpNQgns/);
});

test("the r30 serving tuple line would record no specialist and both gated Trello writes", () => {
  const observed = normalizeAgentConfig(agentVersionFixture(RELEASE_R30));
  const line = formatServingTuple({ release: RELEASE_R30, appRevision: "rev", sessionId: "sesn_x", observed });
  assert.match(line, /release=r30 /);
  assert.match(line, /agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@30 /);
  assert.match(line, /specialist=none/);
  assert.match(line, /always_ask=edit,trello\/trelloWriteCard,trello\/trelloWriteChecklist,write/);
  assert.match(line, /custom_tools=trello_work_history#\w+,trello_board_snapshot#\w+,focus_budget#\w+/);
});
