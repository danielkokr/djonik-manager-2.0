import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  confirmationPolicyProblems,
  RELEASE_R26,
  RELEASE_R27,
  RELEASE_R27_CANDIDATE,
  RELEASES,
  resolveReleaseCandidate,
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
import { buildAgentUpdateBody, buildCandidateUpdateBody } from "./releasePlan.js";
import { agentVersionFixture, servingSessionFixture } from "./releaseFixtures.test-helpers.js";
import { readOnlyBoundaryFor, SERVING_READ_ONLY_BOUNDARY } from "./rhythmRuntime.js";

// #39 Stage 3B-1 — the real r27 (Agent v27, created 2026-09-25; docs/64). Offline: the provider shapes below
// are the content-free parts (Skill references, permission policies) of the measured v27 read-back and of the
// zero-event inspection Session `sesn_01MN2WHdhwexuwxhu8sLB91G`.

type Rec = Record<string, any>;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_PM_RHYTHM = { skillId: "skill_01GzpQX3bVuWNk5bhbGcbzku", version: "skver_01Y77TKeXY9suV99XZU3cv5a", sessionVersion: "1790320523604075" };

function mismatchesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReleaseAttestationError, String(error));
    return error.mismatches;
  }
  return [];
}

const allow = { type: "always_allow" };
const ask = { type: "always_ask" };
/** The built-in and MCP toolsets exactly as `agents.retrieve(…, {version: 27})` and the inspection Session
 *  snapshot returned them (identical in both; built-in configs carry a provider-added `type`). */
const MEASURED_V27_TOOLSETS = [
  {
    type: "agent_toolset_20260401",
    default_config: { enabled: false, permission_policy: allow },
    configs: [
      { enabled: true, name: "read", permission_policy: allow, type: "read" },
      { enabled: true, name: "write", permission_policy: ask, type: "write" },
      { enabled: true, name: "edit", permission_policy: ask, type: "edit" },
      { enabled: true, name: "glob", permission_policy: allow, type: "glob" },
      { enabled: true, name: "grep", permission_policy: allow, type: "grep" },
    ],
  },
  {
    type: "mcp_toolset",
    mcp_server_name: "trello",
    default_config: { enabled: true, permission_policy: ask },
    configs: [
      ...["trelloReadBoard", "trelloReadCard", "trelloReadChecklist", "trelloReadInbox", "trelloReadList", "trelloReadMember", "trelloReadPlanner", "trelloReadWorkspace", "trelloSearch"].map(
        (name) => ({ enabled: true, name, permission_policy: allow }),
      ),
      { enabled: false, name: "trelloWriteBoard", permission_policy: allow },
      { enabled: true, name: "trelloWriteCard", permission_policy: ask },
      { enabled: false, name: "trelloWriteChecklist", permission_policy: allow },
      { enabled: false, name: "trelloWriteInbox", permission_policy: allow },
      { enabled: false, name: "trelloWriteList", permission_policy: allow },
      { enabled: false, name: "trelloWritePlanner", permission_policy: allow },
    ],
  },
  { type: "mcp_toolset", mcp_server_name: "google-calendar-calendarmcp", default_config: { enabled: false, permission_policy: allow }, configs: [] },
];
/** Coordinator Skill references of the inspection Session snapshot (numeric Session spellings, docs/53 §4). */
const MEASURED_V27_SESSION_SKILLS = [
  { skill_id: "skill_01WS6JtY1GMu3rGZaKCVR9w1", type: "custom", version: "1790164354565465" },
  { skill_id: "skill_01G9DtQEzPYxgw78riFh8k99", type: "custom", version: "1790164356765333" },
  { skill_id: "skill_01PTmbvLHJj1HuUxvDKhpaiE", type: "custom", version: "1790164359202020" },
  { skill_id: "skill_015c8dtDnWyDfVLwS6NLS7r6", type: "custom", version: "1789734659839542" },
  { skill_id: "skill_0169h7GYNYUDDDZteDCUV2fE", type: "custom", version: "1790083840153637" },
  { skill_id: "skill_01GzpQX3bVuWNk5bhbGcbzku", type: "custom", version: "1790320523604075" },
];

/** A provider-shaped object with the measured toolsets; the custom tool keeps the fixture's source definition. */
function withMeasuredToolsets(agent: Rec): Rec {
  const custom = (agent.tools as Rec[]).filter((tool) => tool.type === "custom");
  return { ...agent, tools: [MEASURED_V27_TOOLSETS[0], ...custom, ...MEASURED_V27_TOOLSETS.slice(1)] };
}

// --- Definition -----------------------------------------------------------------------------------------------

test("r27 is served (Stage 3B-3A, docs/66); the serving boundary derives as pre_execution; r26 stays the post-hoc rollback", () => {
  assert.equal(RELEASES.r27, RELEASE_R27);
  assert.equal(SERVING_RELEASE, RELEASE_R27);
  assert.equal(SERVING_RELEASE.agent.version, 27);
  // Derived, not asserted into existence: the serving boundary is whatever the serving release's tool surface gives.
  assert.equal(SERVING_READ_ONLY_BOUNDARY, readOnlyBoundaryFor(SERVING_RELEASE));
  assert.equal(SERVING_READ_ONLY_BOUNDARY, "pre_execution");
  assert.equal(readOnlyBoundaryFor(RELEASE_R27), "pre_execution");
  assert.equal(readOnlyBoundaryFor(RELEASE_R26), "post_hoc_detection_only");
  // The rollback release is still a reviewed, checkable release of its own.
  assert.equal(RELEASES.r26, RELEASE_R26);
  assert.equal(RELEASE_R26.agent.version, 26);
  assert.equal(RELEASE_R26.confirmationRequired, undefined);
});

test("r27 is exactly the Stage 3A candidate resolved with the real remote identifiers (nothing else)", () => {
  assert.deepEqual(RELEASE_R27, resolveReleaseCandidate(RELEASE_R27_CANDIDATE, { skills: { "pm-rhythm": REAL_PM_RHYTHM }, agentVersion: 27 }));
  assert.equal(RELEASE_R27.id, "r27");
  assert.deepEqual(RELEASE_R27.agent, { id: RELEASE_R26.agent.id, version: 27 });
  assert.deepEqual(confirmationPolicyProblems(RELEASE_R27), []);
});

test("r27 vs r26: same model, prompt, specialist, custom tool, MCP servers, Session resources; accepted pins unchanged; + pm-rhythm", () => {
  const same = (release: typeof RELEASE_R26) => ({
    model: release.model,
    systemSha256: release.systemSha256,
    specialist: release.specialist,
    builtInTools: release.builtInTools,
    customTools: release.customTools,
    mcpServers: release.mcpServers,
    calendar: release.mcpToolsets.find((toolset) => toolset.server !== "trello"),
    session: release.session,
  });
  assert.deepEqual(same(RELEASE_R27), same(RELEASE_R26));
  assert.deepEqual(RELEASE_R27.skills.slice(0, RELEASE_R26.skills.length), RELEASE_R26.skills);
  assert.deepEqual(RELEASE_R27.skills.slice(RELEASE_R26.skills.length), [
    { name: "pm-rhythm", skillId: REAL_PM_RHYTHM.skillId, pin: { kind: "explicit", version: REAL_PM_RHYTHM.version, sessionVersion: REAL_PM_RHYTHM.sessionVersion } },
  ]);
  for (const skill of RELEASE_R27.skills) {
    assert.equal(skill.pin.kind, "explicit", `${skill.name} is immutable`);
    if (skill.pin.kind === "explicit") assert.match(skill.pin.version, /^skver_\w+$/);
  }
  assert.equal(RELEASE_R26.confirmationRequired, undefined);
  assert.deepEqual(RELEASE_R27.confirmationRequired, { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard"] } });
});

test("the pinned pm-rhythm version is the committed repo Skill (SHA-256 recorded at sync, docs/64 §3)", () => {
  const source = readFileSync(join(repoRoot, ".claude", "skills", "pm-rhythm", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(source, "utf8").digest("hex"), "8617fd5c7e4d536a8b5a2d3a3e8e2efec41d22c9a5c41db853ddf6f760c984f9");
});

// --- The body that created v27 ----------------------------------------------------------------------------------

test("the v26 → v27 update body regenerates byte-identically from r27 and from the candidate (the body actually sent)", () => {
  const body = buildAgentUpdateBody(RELEASE_R27, 26);
  // SHA-256 of JSON.stringify(body) as sent on 2026-09-25 (docs/64 §5).
  assert.equal(sha256(JSON.stringify(body)), "5371b2ec9ecd20c84d701124c7ec18d887bc3ef9d9eebb8180e63b768073f70e");
  assert.deepEqual(body, buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, { skills: { "pm-rhythm": REAL_PM_RHYTHM } }));
  assert.equal(body.version, 26);
  assert.deepEqual(Object.keys(body).sort(), ["skills", "tools", "version"], "model, system, MCP servers and roster preserved by omission");
});

// --- Attestation against the measured provider shapes -----------------------------------------------------------

test("measured Agent v27 permission policies attest as r27", () => {
  const v27 = withMeasuredToolsets(agentVersionFixture(RELEASE_R27));
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R27, v27)), []);
  const observed = normalizeAgentConfig(v27);
  assert.deepEqual(observed.builtIn?.alwaysAsk, ["edit", "write"]);
  const trello = observed.mcpToolsets.find((toolset) => toolset.server === "trello")!;
  assert.equal(trello.defaultPolicy, "always_ask");
  assert.deepEqual(trello.alwaysAsk, ["trelloWriteCard"]);
  assert.deepEqual(trello.needsConfirmation, ["trelloWriteCard", "*"]);
});

test("measured inspection-Session snapshot (numeric Skill spellings + same policies) attests as r27", () => {
  const session = servingSessionFixture(RELEASE_R27) as Rec;
  session.agent = { ...withMeasuredToolsets(session.agent), skills: MEASURED_V27_SESSION_SKILLS };
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R27, session)), []);
  // Only pm-rhythm's own two spellings are accepted: another number (or the Skill's `latest`) is drift.
  for (const wrong of ["1790320523604076", "latest"]) {
    const drifted = { ...session, agent: { ...session.agent, skills: MEASURED_V27_SESSION_SKILLS.map((s) => (s.skill_id === REAL_PM_RHYTHM.skillId ? { ...s, version: wrong } : s)) } };
    assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R27, drifted)), [`skill pm-rhythm version ${wrong} != ${REAL_PM_RHYTHM.version}`]);
  }
});

test("the r27 inspection Session is not a serving Session: its read_only Memory mount is the only resource difference", () => {
  const session = servingSessionFixture(RELEASE_R27) as Rec;
  session.resources = [{ ...session.resources[0], access: "read_only" }];
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R27, session)), ["memory access read_only != read_write"]);
});

test("r26 and r27 cannot stand in for each other", () => {
  const r26AsR27 = compareWithRelease(RELEASE_R27, normalizeAgentConfig({ ...agentVersionFixture(RELEASE_R26), version: 27 }));
  assert.ok(r26AsR27.includes(`skill pm-rhythm (${REAL_PM_RHYTHM.skillId}) missing`), r26AsR27.join("; "));
  assert.ok(r26AsR27.includes("mcp toolset trello default policy always_allow != always_ask"), r26AsR27.join("; "));
  const r27AsR26 = compareWithRelease(RELEASE_R26, normalizeAgentConfig(withMeasuredToolsets(agentVersionFixture(RELEASE_R27))));
  assert.ok(r27AsR26.includes("agent version 27 != 26"), r27AsR26.join("; "));
  assert.ok(r27AsR26.includes(`unexpected skill ${REAL_PM_RHYTHM.skillId}`), r27AsR26.join("; "));
  assert.ok(r27AsR26.includes("built-in always_ask tools [edit,write] != []"), r27AsR26.join("; "));
});

test("r27 serving tuple names the pm-rhythm pin and the attested always_ask set (content-free)", () => {
  const line = formatServingTuple({ release: RELEASE_R27, appRevision: "abc1234", sessionId: "sesn_1", observed: normalizeAgentConfig(withMeasuredToolsets(agentVersionFixture(RELEASE_R27))) });
  assert.match(line, /^\[release\] serving release=r27 /);
  assert.match(line, / agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 /);
  assert.match(line, /pm-rhythm@skver_01Y77TKeXY9suV99XZU3cv5a/);
  assert.match(line, / skill_pins=explicit /);
  assert.match(line, / always_ask=edit,trello\/trelloWriteCard,write memory=read_write session=sesn_1$/);
});
