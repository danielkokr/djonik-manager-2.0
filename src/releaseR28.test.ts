import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmationPolicyProblems,
  RELEASE_R27,
  RELEASE_R28,
  RELEASE_R28_CANDIDATE,
  RELEASES,
  resolveReleaseCandidate,
  RETIRED_BY_R28,
  SERVING_RELEASE,
} from "./release.js";
import {
  attestAgentVersion,
  attestServingSession,
  compareWithRelease,
  formatServingTuple,
  normalizeAgentConfig,
  ReleaseAttestationError,
  sha256,
} from "./releaseAttestation.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { agentVersionFixture, PRE_41_SYSTEM_PROMPT, servingSessionFixture, R28_SYSTEM_PROMPT } from "./releaseFixtures.test-helpers.js";
import { readOnlyBoundaryFor, SERVING_READ_ONLY_BOUNDARY } from "./rhythmRuntime.js";

// #41 + #42 — the real r28 (Agent v28, created 2026-09-25 from v27; docs/74) and its source cutover (docs/75). Offline:
// the Session shapes below are the content-free Skill references of the zero-event inspection Session
// `sesn_016UCPyKFRwMTXzLxC4xdLoE` pinned to v28. r28 remains an immutable reviewed release and rollback target.

type Rec = Record<string, any>;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_PLANNING_AND_FOCUS = { skillId: "skill_01PxXTvhbZSrbxqi7gmDs6KW", version: "skver_01RzxVaCr47k6R11pHLWr62e", sessionVersion: "1790341201541171" };
/** Coordinator Skill references of the r28 inspection Session snapshot (numeric Session spellings, docs/53 §4). */
const MEASURED_V28_SESSION_SKILLS = [
  { skill_id: "skill_01WS6JtY1GMu3rGZaKCVR9w1", type: "custom", version: "1790164354565465" },
  { skill_id: "skill_01PxXTvhbZSrbxqi7gmDs6KW", type: "custom", version: "1790341201541171" },
  { skill_id: "skill_015c8dtDnWyDfVLwS6NLS7r6", type: "custom", version: "1789734659839542" },
  { skill_id: "skill_0169h7GYNYUDDDZteDCUV2fE", type: "custom", version: "1790083840153637" },
  { skill_id: "skill_01GzpQX3bVuWNk5bhbGcbzku", type: "custom", version: "1790320523604075" },
];
const names = (skills: ReadonlyArray<{ name: string }>) => skills.map((skill) => skill.name);

function mismatchesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReleaseAttestationError, String(error));
    return error.mismatches;
  }
  return [];
}

// --- Definition -----------------------------------------------------------------------------------------------

test("r28 remains a reviewed rollback release after the r29 source cutover", () => {
  assert.equal(RELEASES.r28, RELEASE_R28);
  assert.deepEqual(RELEASE_R28.agent, { id: RELEASE_R27.agent.id, version: 28 });
  assert.notEqual(SERVING_RELEASE, RELEASE_R28);
  assert.equal(RELEASES.r27, RELEASE_R27);
  assert.equal(SERVING_READ_ONLY_BOUNDARY, readOnlyBoundaryFor(SERVING_RELEASE));
  assert.equal(SERVING_READ_ONLY_BOUNDARY, "pre_execution");
  assert.equal(readOnlyBoundaryFor(RELEASE_R28), "pre_execution", "the same #39 pre-execution boundary");
  // r27 is untouched: Agent v27, pre-#41 prompt, its six pins including the two retired planning Skills.
  assert.equal(RELEASE_R27.agent.version, 27);
  assert.equal(RELEASE_R27.systemSha256, sha256(PRE_41_SYSTEM_PROMPT));
  assert.deepEqual(names(RELEASE_R27.skills), ["task-management", "daily-planning", "weekly-planning", "studio-intake", "work-review", "pm-rhythm"]);
});

test("r28 is exactly the candidate resolved with the real remote identifiers (nothing else)", () => {
  assert.deepEqual(RELEASE_R28, resolveReleaseCandidate(RELEASE_R28_CANDIDATE, { skills: { "planning-and-focus": REAL_PLANNING_AND_FOCUS }, agentVersion: 28 }));
  assert.equal(RELEASE_R28.id, "r28");
  assert.deepEqual(confirmationPolicyProblems(RELEASE_R28), []);
});

test("r28 = r27 + the #41/#42 prompt + planning-and-focus in place of daily/weekly; everything else r27's", () => {
  const { id, agent, systemSha256, skills, ...rest } = RELEASE_R28;
  const { id: _id, agent: _agent, systemSha256: r27System, skills: r27Skills, ...r27Rest } = RELEASE_R27;
  assert.deepEqual(rest, r27Rest, "model, specialist v4, tools, permission policies, custom tool, MCP, Session resources");
  assert.equal(systemSha256, sha256(R28_SYSTEM_PROMPT), "the reviewed djonik.md body as synced to v28 (source minus the #45 edits)");
  assert.notEqual(systemSha256, r27System);
  assert.deepEqual(names(skills), ["task-management", "planning-and-focus", "studio-intake", "work-review", "pm-rhythm"]);
  for (const retired of RETIRED_BY_R28) assert.ok(!names(skills).includes(retired), `${retired} is not in r28`);
  assert.deepEqual(
    skills.filter((skill) => skill.name !== "planning-and-focus"),
    r27Skills.filter((skill) => !(RETIRED_BY_R28 as readonly string[]).includes(skill.name)),
    "the other four pins are r27's, in r27's order",
  );
  for (const skill of skills) {
    assert.equal(skill.pin.kind, "explicit", `${skill.name} is immutable`);
    if (skill.pin.kind === "explicit") assert.match(skill.pin.version, /^skver_\w+$/);
  }
  // No placeholder; the Session spelling is the measured one (docs/75).
  assert.deepEqual(skills[1], {
    name: "planning-and-focus",
    skillId: REAL_PLANNING_AND_FOCUS.skillId,
    pin: { kind: "explicit", version: REAL_PLANNING_AND_FOCUS.version, sessionVersion: REAL_PLANNING_AND_FOCUS.sessionVersion },
  });
  assert.doesNotMatch(JSON.stringify(RELEASE_R28), /TEST_ONLY|unresolved/);
});

test("the pinned planning-and-focus version was synced from SHA-256 0efaf7d2…b628 (docs/74 §3); #45 moves the repo Skill ahead of it", () => {
  // The r28 pin stays the synced text. The #45 source revision (factual grounding, docs/77 templates) is not synced:
  // it reaches production only as a new Skill version in a separately authorized release.
  const source = readFileSync(join(repoRoot, ".claude", "skills", "planning-and-focus", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  assert.notEqual(createHash("sha256").update(source, "utf8").digest("hex"), "0efaf7d29ae9f1cb6bf54518b796dd806b031bc789ef44af720a6b278043b628");
});

// --- The body that created v28 ----------------------------------------------------------------------------------

test("the v27 → v28 update body regenerates byte-identically (the body actually sent, docs/74 §5)", () => {
  const body = buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, { skills: { "planning-and-focus": REAL_PLANNING_AND_FOCUS } }, R28_SYSTEM_PROMPT);
  assert.equal(sha256(JSON.stringify(body)), "4c59a49cdd619cc63efe21b7dc0d21dc4e71bf266e4b76ca1a9ccc8854d774e6");
  assert.deepEqual(Object.keys(body).sort(), ["skills", "system", "tools", "version"], "model, MCP servers and roster preserved by omission");
  assert.equal(body.version, 27);
  assert.deepEqual(body.tools, agentVersionFixture(RELEASE_R27).tools, "tool surface and permission policies unchanged");
  // A Skills/tools-only body for r28 (e.g. via `release:check --plan`) stays refused: it would be a partial update.
  assert.throws(() => buildReleaseUpdateBody(RELEASE_R28, 27), /changes the prompt/);
});

// --- Attestation ------------------------------------------------------------------------------------------------

test("an Agent v28 shaped like the read-back attests as r28; r27 and r28 cannot stand in for each other", () => {
  const v28 = agentVersionFixture(RELEASE_R28);
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R28, v28)), []);
  const v27 = agentVersionFixture(RELEASE_R27);
  const r27AsR28 = compareWithRelease(RELEASE_R28, normalizeAgentConfig({ ...v27, version: 28 }));
  assert.ok(r27AsR28.some((line) => line.startsWith("system sha")), r27AsR28.join("; "));
  assert.ok(r27AsR28.includes(`skill planning-and-focus (${REAL_PLANNING_AND_FOCUS.skillId}) missing`), r27AsR28.join("; "));
  const r28AsR27 = compareWithRelease(RELEASE_R27, normalizeAgentConfig(v28));
  assert.ok(r28AsR27.includes("agent version 28 != 27"), r28AsR27.join("; "));
  assert.ok(r28AsR27.includes(`unexpected skill ${REAL_PLANNING_AND_FOCUS.skillId}`), r28AsR27.join("; "));
});

test("measured inspection-Session snapshot (numeric Skill spellings) attests as r28; only planning-and-focus's own spellings pass", () => {
  const session = servingSessionFixture(RELEASE_R28) as Rec;
  session.agent = { ...session.agent, skills: MEASURED_V28_SESSION_SKILLS };
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R28, session)), []);
  // The four kept Skills are spelled exactly as they were in the r27 Session (same versions, docs/64 §10).
  for (const skill of RELEASE_R28.skills.filter((entry) => entry.name !== "planning-and-focus")) {
    assert.deepEqual(skill, RELEASE_R27.skills.find((entry) => entry.name === skill.name));
  }
  for (const wrong of ["1790341201541172", "latest"]) {
    const skills = MEASURED_V28_SESSION_SKILLS.map((skill) => (skill.skill_id === REAL_PLANNING_AND_FOCUS.skillId ? { ...skill, version: wrong } : skill));
    assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R28, { ...session, agent: { ...session.agent, skills } })), [
      `skill planning-and-focus version ${wrong} != ${REAL_PLANNING_AND_FOCUS.version}`,
    ]);
  }
});

test("the r28 inspection Session is not a serving Session: its read_only Memory mount is the only resource difference", () => {
  const session = servingSessionFixture(RELEASE_R28) as Rec;
  session.agent = { ...session.agent, skills: MEASURED_V28_SESSION_SKILLS };
  session.resources = [{ ...session.resources[0], access: "read_only" }];
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R28, session)), ["memory access read_only != read_write"]);
});

test("r28 serving tuple names the planning-and-focus pin and the unchanged always_ask set (content-free)", () => {
  const line = formatServingTuple({ release: RELEASE_R28, appRevision: "abc1234", sessionId: "sesn_1", observed: normalizeAgentConfig(agentVersionFixture(RELEASE_R28)) });
  assert.match(line, /^\[release\] serving release=r28 /);
  assert.match(line, / agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@28 /);
  assert.match(line, /planning-and-focus@skver_01RzxVaCr47k6R11pHLWr62e/);
  assert.doesNotMatch(line, /daily-planning|weekly-planning/);
  assert.match(line, / always_ask=edit,trello\/trelloWriteCard,write memory=read_write session=sesn_1$/);
});
