import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_R28, RELEASE_R29, RELEASES, SERVING_RELEASE, type DjonikReleaseCandidate, type ReleaseSkill } from "./release.js";
import { attestAgentVersion, attestServingSession, compareWithRelease, normalizeAgentConfig, sha256 } from "./releaseAttestation.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { SOURCE_SYSTEM_PROMPT, agentVersionFixture, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changed = ["task-management", "planning-and-focus", "pm-rhythm"];
const sourceHashes: Record<string, string> = {
  "task-management": "aec09d5aa2b8170fe4f9d365a61484d1a1dc8b5e3b49a55382f3b014a8d70b7a",
  "planning-and-focus": "02097376a7872950296e96993b7b76bbf144276236b24669e349e8c760cf9bab",
  "pm-rhythm": "91ed09622bc205b4cc380f62c51a121b91abbbf8ce8f7ae3f732f29e866a2dc7",
};
const measuredVersions: Record<string, string> = {
  "task-management": "1790413381043587",
  "planning-and-focus": "1790413383331016",
  "pm-rhythm": "1790413385648302",
};

test("r29 serves the accepted #45 prompt and only the three changed coordinator Skill pins", () => {
  assert.equal(RELEASES.r29, RELEASE_R29);
  assert.equal(SERVING_RELEASE, RELEASE_R29);
  assert.equal(RELEASE_R29.agent.id, RELEASE_R28.agent.id);
  assert.equal(RELEASE_R29.agent.version, 29);
  assert.equal(RELEASE_R28.agent.version, 28);
  assert.equal(RELEASE_R29.systemSha256, sha256(SOURCE_SYSTEM_PROMPT));
  assert.notEqual(RELEASE_R29.systemSha256, RELEASE_R28.systemSha256);
  const { id, agent, systemSha256, skills, ...rest } = RELEASE_R29;
  const { id: oldId, agent: oldAgent, systemSha256: oldSystem, skills: oldSkills, ...oldRest } = RELEASE_R28;
  assert.deepEqual(rest, oldRest, "model, specialist v4, built-in/custom/MCP surfaces, policies and Session resources stay r28");
  assert.deepEqual(skills.map((skill) => [skill.name, skill.skillId]), oldSkills.map((skill) => [skill.name, skill.skillId]));
  for (const skill of skills) {
    const prior = oldSkills.find((entry) => entry.name === skill.name)!;
    if (changed.includes(skill.name)) {
      assert.notDeepEqual(skill.pin, prior.pin);
      assert.equal(skill.pin.kind, "explicit");
      assert.equal(skill.pin.sessionVersion, measuredVersions[skill.name]);
      const source = readFileSync(join(root, ".claude", "skills", skill.name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
      assert.equal(sha256(source), sourceHashes[skill.name]);
    } else assert.deepEqual(skill, prior);
  }
  assert.deepEqual(RELEASE_R29.customTools, ["trello_work_history"]);
  assert.ok(!RELEASE_R29.customTools.includes("reminder"));
});

test("the v28 → v29 update body regenerates with version 28 and only prompt + three Skill pins", () => {
  const { id: _id, agent: _agent, ...rest } = RELEASE_R28;
  const candidate: DjonikReleaseCandidate = {
    ...rest,
    candidateId: "r29-candidate",
    becomes: "r29",
    agent: { id: RELEASE_R28.agent.id, fromVersion: 28, version: null },
    systemSha256: RELEASE_R29.systemSha256,
    skills: RELEASE_R28.skills.map((skill) => changed.includes(skill.name)
      ? { name: skill.name, skillId: null, pin: { kind: "unresolved" as const, reason: "#45 accepted source" } }
      : skill),
    confirmationRequired: RELEASE_R28.confirmationRequired!,
  };
  const resolution = { skills: Object.fromEntries(RELEASE_R29.skills.filter((skill) => changed.includes(skill.name)).map((skill) => [skill.name, { skillId: skill.skillId, version: (skill.pin as Extract<ReleaseSkill["pin"], { kind: "explicit" }>).version }])) };
  const body = buildCandidateUpdateBody(candidate, resolution, SOURCE_SYSTEM_PROMPT);
  assert.equal(body.version, 28);
  assert.deepEqual(Object.keys(body).sort(), ["skills", "system", "tools", "version"]);
  assert.equal(sha256(JSON.stringify(body)), "0fd8d90860e59dfa9808cc35c67cb71ab90fb7afa126815b8a36042ff2e7e9c3");
  assert.deepEqual(body.tools, agentVersionFixture(RELEASE_R28).tools);
  assert.throws(() => buildReleaseUpdateBody(RELEASE_R29, 28), /changes the prompt/);
});

test("Agent v29 and the measured zero-event inspection snapshot attest; reminder remains absent", () => {
  const v29 = agentVersionFixture(RELEASE_R29);
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R29, v29));
  const session = servingSessionFixture(RELEASE_R29) as Record<string, any>;
  assert.doesNotThrow(() => attestServingSession(RELEASE_R29, session));
  session.resources[0].access = "read_only";
  assert.deepEqual(compareWithRelease(RELEASE_R29, normalizeAgentConfig(session.agent)), []);
  assert.throws(() => attestServingSession(RELEASE_R29, session), /memory access read_only != read_write/);
  assert.ok(!(v29.tools as Array<{ name?: string }>).some((tool) => tool.name === "reminder"));
});
