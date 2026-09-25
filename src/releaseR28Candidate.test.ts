import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_R27,
  RELEASE_R28_CANDIDATE,
  RELEASES,
  resolveReleaseCandidate,
  RETIRED_BY_R28,
  SERVING_RELEASE,
  UnresolvedReleaseCandidateError,
  type DjonikRelease,
} from "./release.js";
import { attestAgentVersion, compareWithRelease, normalizeAgentConfig, ReleaseAttestationError, sha256 } from "./releaseAttestation.js";
import { buildCandidateUpdateBody } from "./releasePlan.js";
import {
  agentVersionFixture,
  ISSUE_41_PROMPT_EDITS,
  ISSUE_42_PROMPT_EDITS,
  PRE_41_SYSTEM_PROMPT,
  PRE_42_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./releaseFixtures.test-helpers.js";

// #41 + #42 — the one combined source-only r28 candidate (Product Owner: one cutover for both). r27 with exactly
// two changes: the coordinator prompt, and daily-planning + weekly-planning → planning-and-focus. Offline; no Agent
// v28 and no planning-and-focus Skill exist and none is invented. Ids and versions below are visibly TEST-ONLY.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ONLY_AGENT_VERSION = 9_999;
const TEST_ONLY_PINS = {
  skills: { "planning-and-focus": { skillId: "skill_TEST_ONLY_planning_and_focus", version: "skver_TEST_ONLY_planning_and_focus" } },
};
/** The #41-only candidate prompt, as reviewed and accepted before #42 (docs/72 §2.5). */
const ISSUE_41_CANDIDATE_SHA = "8469c4e0b463c92ca0a9c62495243629f591014b7674c84e28347860ef13813c";

const names = (skills: ReadonlyArray<{ name: string }>) => skills.map((skill) => skill.name);

test("r27 is still served; the r28 candidate is not a release, has no Agent version and is not servable", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R27);
  assert.deepEqual(Object.keys(RELEASES).sort(), ["r25", "r26", "r27"]);
  assert.equal(RELEASE_R28_CANDIDATE.agent.version, null, "no Agent v28 exists");
  assert.equal(RELEASE_R28_CANDIDATE.agent.fromVersion, RELEASE_R27.agent.version);
  assert.equal("id" in RELEASE_R28_CANDIDATE, false);
  assert.throws(() => resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { skills: {}, agentVersion: TEST_ONLY_AGENT_VERSION }), UnresolvedReleaseCandidateError);
  assert.throws(() => resolveReleaseCandidate(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS), UnresolvedReleaseCandidateError, "agent version required");
});

test("r28 candidate = r27 with only the prompt and the planning Skills changed", () => {
  const { candidateId, becomes, agent, systemSha256, skills, ...rest } = RELEASE_R28_CANDIDATE;
  const { id, agent: r27Agent, systemSha256: r27System, skills: r27Skills, ...r27Rest } = RELEASE_R27;
  assert.equal(becomes, "r28");
  assert.equal(agent.id, r27Agent.id);
  assert.deepEqual(rest, r27Rest, "model, specialist, tools, permission policies, MCP and Session resources");
  assert.notEqual(systemSha256, r27System);
  // Every other Skill keeps r27's exact pin, in r27's order.
  const kept = r27Skills.filter((skill) => !(RETIRED_BY_R28 as readonly string[]).includes(skill.name));
  assert.deepEqual(skills.filter((skill) => skill.name !== "planning-and-focus"), kept);
});

test("#42: daily-planning and weekly-planning are not in the next release; planning-and-focus replaces them, unresolved", () => {
  assert.deepEqual([...RETIRED_BY_R28], ["daily-planning", "weekly-planning"]);
  assert.deepEqual(names(RELEASE_R28_CANDIDATE.skills), ["task-management", "planning-and-focus", "studio-intake", "work-review", "pm-rhythm"]);
  for (const retired of RETIRED_BY_R28) {
    assert.ok(names(RELEASE_R27.skills).includes(retired), `${retired} is part of the served r27 (rollback stays possible)`);
    assert.ok(!names(RELEASE_R28_CANDIDATE.skills).includes(retired), `${retired} must not reach r28`);
    const retiredId = RELEASE_R27.skills.find((skill) => skill.name === retired)!.skillId;
    assert.ok(!RELEASE_R28_CANDIDATE.skills.some((skill) => skill.skillId === retiredId), `${retired}'s Skill id must not reach r28`);
    assert.equal(existsSync(join(repoRoot, ".claude", "skills", retired)), false, `${retired} source is retired from the repo (git history keeps it)`);
  }
  const planning = RELEASE_R28_CANDIDATE.skills.filter((skill) => skill.name === "planning-and-focus");
  assert.equal(planning.length, 1, "exactly one planning owner");
  assert.deepEqual(planning[0].pin.kind, "unresolved", "no remote id or version is invented");
  assert.equal(planning[0].skillId, null);
  assert.ok(existsSync(join(repoRoot, ".claude", "skills", "planning-and-focus", "SKILL.md")));
});

test("the prompt diff is exactly the #41 and #42 edits: djonik.md = candidate, minus #42 = the #41 candidate, minus both = served r27", () => {
  assert.equal(sha256(SYSTEM_PROMPT), RELEASE_R28_CANDIDATE.systemSha256);
  assert.equal(sha256(PRE_42_SYSTEM_PROMPT), ISSUE_41_CANDIDATE_SHA, "#41 is intact under #42; no other prompt change hides behind #42");
  assert.equal(sha256(PRE_41_SYSTEM_PROMPT), RELEASE_R27.systemSha256, "no other prompt change hides behind #41");
  assert.equal(ISSUE_41_PROMPT_EDITS.length, 2);
  assert.equal(ISSUE_42_PROMPT_EDITS.length, 4);
  assert.ok(ISSUE_42_PROMPT_EDITS[1].after.startsWith("\n# Deciding what matters\n"), "the PM core is one new section");
  assert.ok(!SYSTEM_PROMPT.includes("You do not message him first"), "the stale pre-#41 line stays gone");
});

test("the update body: v27 precondition, the real Skill pins, tools unchanged and the reviewed prompt — together", () => {
  const body = buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS, SYSTEM_PROMPT) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["skills", "system", "tools", "version"], "model, MCP servers and roster preserved by omission");
  assert.equal(body.version, 27);
  assert.equal(body.system, SYSTEM_PROMPT);
  const r27Body = agentVersionFixture(RELEASE_R27);
  assert.deepEqual(body.tools, r27Body.tools, "tool surface and permission policies are r27's");
  const skillIds = (body.skills as Array<{ skill_id: string; version: string }>).map((skill) => `${skill.skill_id}@${skill.version}`);
  assert.equal(skillIds.length, 5);
  assert.ok(skillIds.includes("skill_TEST_ONLY_planning_and_focus@skver_TEST_ONLY_planning_and_focus"));
  for (const retired of RETIRED_BY_R28) {
    const id = RELEASE_R27.skills.find((skill) => skill.name === retired)!.skillId;
    assert.ok(!skillIds.some((entry) => entry.startsWith(id)), `${retired} is not sent`);
  }
});

test("the body cannot be built half: no unresolved Skill, no prompt without Skills, no wrong prompt", () => {
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, { skills: {} }, SYSTEM_PROMPT), UnresolvedReleaseCandidateError);
  assert.throws(
    () => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, { skills: { "planning-and-focus": { skillId: "planning-and-focus", version: "latest" } } }, SYSTEM_PROMPT),
    UnresolvedReleaseCandidateError,
  );
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS), /changes the prompt/);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS, PRE_42_SYSTEM_PROMPT), /does not match/, "the #41-only prompt");
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS, PRE_41_SYSTEM_PROMPT), /does not match/);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS, `${SYSTEM_PROMPT}\n`), /does not match/);
});

test("the body applied to v27 attests as the resolved r28 (test-only ids), and r27/r28 cannot stand in for each other", () => {
  const r28: DjonikRelease = resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { ...TEST_ONLY_PINS, agentVersion: TEST_ONLY_AGENT_VERSION });
  assert.equal(r28.id, "r28");
  const v27 = agentVersionFixture(RELEASE_R27);
  const body = buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, TEST_ONLY_PINS, SYSTEM_PROMPT);
  const next = { ...v27, version: TEST_ONLY_AGENT_VERSION, system: body.system, skills: body.skills, tools: body.tools };
  assert.doesNotThrow(() => attestAgentVersion(r28, next));
  // Served r27 with the new prompt or the new Skills is drift; so is r28 with the old prompt or the old Skills.
  const promptDrift = compareWithRelease(RELEASE_R27, normalizeAgentConfig({ ...v27, system: SYSTEM_PROMPT }));
  assert.ok(promptDrift.some((line) => line.startsWith("system sha")), promptDrift.join("; "));
  assert.ok(compareWithRelease(RELEASE_R27, normalizeAgentConfig({ ...v27, skills: body.skills })).length > 0, "r27 with r28's Skills");
  assert.throws(() => attestAgentVersion(r28, { ...next, system: PRE_41_SYSTEM_PROMPT }), ReleaseAttestationError);
  assert.throws(() => attestAgentVersion(r28, { ...next, system: PRE_42_SYSTEM_PROMPT }), ReleaseAttestationError);
  assert.throws(() => attestAgentVersion(r28, { ...next, skills: v27.skills }), ReleaseAttestationError, "r28 with the retired Skills");
});

test("release:check --plan cannot print a partial r28: a Skills/tools-only body is refused across a prompt change", async () => {
  const { buildReleaseUpdateBody } = await import("./releasePlan.js");
  const { RELEASE_R25, RELEASE_R26 } = await import("./release.js");
  // Same-prompt transitions keep working exactly as before (#33 cutover and rollback, #39).
  assert.doesNotThrow(() => buildReleaseUpdateBody(RELEASE_R26, 25));
  assert.doesNotThrow(() => buildReleaseUpdateBody(RELEASE_R27, 26));
  assert.doesNotThrow(() => buildReleaseUpdateBody(RELEASE_R25, 26));
  // Once resolved, r28 from v27 changes the prompt: that body must come from buildCandidateUpdateBody with `system`.
  const r28 = resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { ...TEST_ONLY_PINS, agentVersion: TEST_ONLY_AGENT_VERSION });
  assert.throws(() => buildReleaseUpdateBody(r28, 27), /changes the prompt/);
  assert.throws(() => buildReleaseUpdateBody(RELEASE_R27, 12_345), /No reviewed release/);
});
