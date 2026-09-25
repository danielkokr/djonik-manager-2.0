import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_R27,
  RELEASE_R28_CANDIDATE,
  RELEASES,
  resolveReleaseCandidate,
  SERVING_RELEASE,
  UnresolvedReleaseCandidateError,
  type DjonikRelease,
} from "./release.js";
import { attestAgentVersion, compareWithRelease, normalizeAgentConfig, ReleaseAttestationError, sha256 } from "./releaseAttestation.js";
import { buildSystemUpdateBody } from "./releasePlan.js";
import { agentVersionFixture, ISSUE_41_PROMPT_EDITS, PRE_41_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./releaseFixtures.test-helpers.js";

// #41 — source-only r28 candidate: r27 with the coordinator prompt as the only change. Offline; no Agent v28
// exists and none is invented. The Agent-version number below is a visibly TEST-ONLY placeholder.

const TEST_ONLY_AGENT_VERSION = 9_999;

test("r27 is still served; the r28 candidate is not a release, has no Agent version and is not servable", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R27);
  assert.deepEqual(Object.keys(RELEASES).sort(), ["r25", "r26", "r27"]);
  assert.equal(RELEASE_R28_CANDIDATE.agent.version, null, "no Agent v28 exists");
  assert.equal(RELEASE_R28_CANDIDATE.agent.fromVersion, RELEASE_R27.agent.version);
  assert.equal("id" in RELEASE_R28_CANDIDATE, false);
  assert.throws(() => resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { skills: {} }), UnresolvedReleaseCandidateError);
});

test("r28 candidate = r27 with only the prompt changed", () => {
  const { candidateId, becomes, agent, systemSha256, ...rest } = RELEASE_R28_CANDIDATE;
  const { id, agent: r27Agent, systemSha256: r27System, ...r27Rest } = RELEASE_R27;
  assert.equal(becomes, "r28");
  assert.equal(agent.id, r27Agent.id);
  assert.deepEqual(rest, r27Rest, "model, Skills + pins, specialist, tools, policies, MCP and Session resources");
  assert.notEqual(systemSha256, r27System);
});

test("the prompt diff is exactly the two #41 edits: djonik.md = candidate, reverted edits = the served r27 prompt", () => {
  assert.equal(sha256(SYSTEM_PROMPT), RELEASE_R28_CANDIDATE.systemSha256);
  assert.equal(sha256(PRE_41_SYSTEM_PROMPT), RELEASE_R27.systemSha256, "no other prompt change hides behind #41");
  assert.equal(ISSUE_41_PROMPT_EDITS.length, 2);
  assert.ok(ISSUE_41_PROMPT_EDITS[0].before.includes("You do not message him first"));
  assert.ok(!SYSTEM_PROMPT.includes("You do not message him first"), "the stale line is gone");
});

test("the prompt-only update body: v27 precondition + the reviewed prompt, nothing else; a wrong prompt is refused", () => {
  const body = buildSystemUpdateBody(RELEASE_R28_CANDIDATE, SYSTEM_PROMPT);
  assert.deepEqual(Object.keys(body).sort(), ["system", "version"], "Skills, tools, model, MCP and roster preserved by omission");
  assert.equal(body.version, 27);
  assert.equal(body.system, SYSTEM_PROMPT);
  assert.throws(() => buildSystemUpdateBody(RELEASE_R28_CANDIDATE, PRE_41_SYSTEM_PROMPT), /does not match/);
  assert.throws(() => buildSystemUpdateBody(RELEASE_R28_CANDIDATE, `${SYSTEM_PROMPT}\n`), /does not match/);
});

test("the body applied to v27 attests as the resolved r28 (test-only version), and r27/r28 cannot stand in for each other", () => {
  const r28: DjonikRelease = resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { skills: {}, agentVersion: TEST_ONLY_AGENT_VERSION });
  assert.equal(r28.id, "r28");
  const v27 = agentVersionFixture(RELEASE_R27);
  const body = buildSystemUpdateBody(RELEASE_R28_CANDIDATE, SYSTEM_PROMPT);
  const next = { ...v27, version: TEST_ONLY_AGENT_VERSION, system: body.system };
  assert.doesNotThrow(() => attestAgentVersion(r28, next));
  // Served r27 with the new prompt is drift; so is r28 with the old one.
  const drift = compareWithRelease(RELEASE_R27, normalizeAgentConfig({ ...v27, system: SYSTEM_PROMPT }));
  assert.ok(drift.some((line) => line.startsWith("system sha")), drift.join("; "));
  assert.throws(() => attestAgentVersion(r28, { ...next, system: PRE_41_SYSTEM_PROMPT }), ReleaseAttestationError);
});
