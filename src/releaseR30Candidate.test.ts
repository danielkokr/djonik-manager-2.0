import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28, RELEASE_R29, RELEASE_R30, RELEASE_R30_CANDIDATE, RELEASES, SERVING_RELEASE, UnresolvedReleaseCandidateError, resolveReleaseCandidate } from "./release.js";
import { buildCandidateUpdateBody, buildReleaseUpdateBody } from "./releasePlan.js";
import { SUPPORTED_CUSTOM_TOOLS, attestAgentVersion, attestServingSession, formatServingTuple, normalizeAgentConfig } from "./releaseAttestation.js";
import { R30_SYSTEM_PROMPT, agentVersionFixture, servingSessionFixture } from "./releaseFixtures.test-helpers.js";
import { PROJECT_HEALTH_SPECIALIST_AGENT_ID } from "./djonikClient.js";

test("#47/#48/#50 candidate preserves immutable r29 and remains unresolved", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R30, "#56 serves the resolved r30, never the candidate");
  assert.equal(RELEASES.r29, RELEASE_R29);
  // #55 resolved the candidate into a separate, written-out RELEASE_R30; the candidate itself stays unresolved provenance.
  assert.equal(RELEASES.r30, RELEASE_R30);
  assert.ok(!Object.values(RELEASES).includes(RELEASE_R30_CANDIDATE as never));
  assert.deepEqual(RELEASE_R29.customTools, ["trello_work_history"]);
  assert.ok(RELEASE_R29.mcpServers.some((server) => server.name === "google-calendar-calendarmcp"));
  assert.deepEqual(RELEASE_R30_CANDIDATE.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget"]);
  assert.deepEqual(RELEASE_R30_CANDIDATE.mcpServers.map((server) => server.name), ["trello"]);
  assert.deepEqual(RELEASE_R30_CANDIDATE.mcpToolsets.map((toolset) => toolset.server), ["trello"]);
  assert.ok(!RELEASE_R30_CANDIDATE.customTools.includes("reminder"));
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null);
  assert.equal(RELEASE_R30_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").length, 4);
  assert.equal(RELEASE_R29.mcpToolsets[0].overrides.trelloWriteChecklist, false);
  assert.equal(RELEASE_R30_CANDIDATE.mcpToolsets[0].overrides.trelloWriteChecklist, true);
  assert.deepEqual(RELEASE_R30_CANDIDATE.confirmationRequired.mcp.trello, ["trelloWriteCard", "trelloWriteChecklist"]);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: {} }), UnresolvedReleaseCandidateError);
});

test("candidate update would replace MCP servers and tools together, with no invented remote ids", () => {
  const body = buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: {
    "planning-and-focus": { skillId: "skill_TEST", version: "skver_TEST" },
    "pm-rhythm": { skillId: "skill_TEST2", version: "skver_TEST2" },
    "task-management": { skillId: "skill_TEST3", version: "skver_TEST3" },
    "studio-intake": { skillId: "skill_TEST4", version: "skver_TEST4" },
  } }, R30_SYSTEM_PROMPT);
  assert.equal(body.version, 29);
  assert.deepEqual((body.mcp_servers as Array<{ name: string }>).map((server) => server.name), ["trello"]);
  assert.deepEqual((body.tools as Array<{ type: string; name?: string; mcp_server_name?: string }>).filter((tool) => tool.type === "custom").map((tool) => tool.name), ["trello_work_history", "trello_board_snapshot", "focus_budget"]);
  assert.ok(!(body.tools as Array<{ name?: string }>).some((tool) => tool.name === "reminder"));
  // #44: the r30 prompt drops the Project Health delegation, so the reviewed body travels with the Skills/tools,
  // and the roster is cleared in the same update.
  assert.equal(body.system, R30_SYSTEM_PROMPT);
  assert.equal(body.multiagent, null);
  assert.equal(SUPPORTED_CUSTOM_TOOLS.trello_board_snapshot?.description.length > 0, true);
});

test("#50: focus_budget exists only on the r30 candidate and its resolution r30 (served since #56); r25–r29 never expose it", async () => {
  const { RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28 } = await import("./release.js");
  for (const release of [RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28, RELEASE_R29]) {
    assert.ok(!release.customTools.includes("focus_budget"), release.id);
  }
  assert.equal(SERVING_RELEASE, RELEASE_R30);
  assert.ok(SERVING_RELEASE.customTools.includes("focus_budget"), "the served r30 exposes the #50 tool");
  assert.ok(RELEASE_R30_CANDIDATE.customTools.includes("focus_budget"));
  assert.ok(!RELEASE_R30_CANDIDATE.customTools.includes("reminder"), "reminder stays dormant");
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null, "no invented Agent v30");
  assert.ok(RELEASE_R30_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").every((skill) => skill.skillId === null), "no invented remote Skill ids");
  assert.deepEqual(RELEASE_R30_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").map((skill) => skill.name).sort(), ["planning-and-focus", "pm-rhythm", "studio-intake", "task-management"]);
  const body = buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: Object.fromEntries(["planning-and-focus", "pm-rhythm", "task-management", "studio-intake"].map((name) => [name, { skillId: `skill_TEST${name.length}`, version: "skver_TEST" }])) }, R30_SYSTEM_PROMPT);
  const focus = (body.tools as Array<{ type: string; name?: string; input_schema?: unknown }>).find((tool) => tool.name === "focus_budget");
  assert.deepEqual(focus?.input_schema, SUPPORTED_CUSTOM_TOOLS.focus_budget.input_schema);
});

// --- #44: Project Health specialist retired in r30; r29 keeps it for rollback ------------------------------------

const R30_TEST_PINS = Object.fromEntries(["planning-and-focus", "pm-rhythm", "task-management", "studio-intake"]
  .map((name, index) => [name, { skillId: `skill_TEST44${index}`, version: `skver_TEST44${index}` }]));
/** Test-only resolution of the candidate: invented ids never leave this file (the real r30 has no Agent version yet). */
const resolvedR30 = () => resolveReleaseCandidate(RELEASE_R30_CANDIDATE, { skills: R30_TEST_PINS, agentVersion: 30 });

test("#44 topology: r25–r29 pin specialist v4 unchanged; the r30 candidate has no specialist; no r31; r30 serves (#56)", () => {
  for (const release of [RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28, RELEASE_R29]) {
    assert.deepEqual(release.specialist, {
      id: PROJECT_HEALTH_SPECIALIST_AGENT_ID,
      version: 4,
      skills: [{ skillId: "skill_01Treson5zdU1TgxXDaREwnY", version: "skver_01JLTtMvUgfEqdcBBGj4WGVm" }],
    }, `${release.id} keeps specialist v4`);
  }
  assert.equal(RELEASE_R30_CANDIDATE.specialist, null, "absence is explicit, not a missing field");
  assert.ok("specialist" in RELEASE_R30_CANDIDATE);
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null, "the candidate never carries an Agent version; RELEASE_R30 does (#55)");
  assert.deepEqual(Object.keys(RELEASES), ["r25", "r26", "r27", "r28", "r29", "r30"], "r30 is attestable (#55); no r31");
  assert.equal(RELEASE_R30.specialist, null);
  assert.equal(SERVING_RELEASE, RELEASE_R30);
  assert.equal(SERVING_RELEASE.specialist, null, "the served topology is coordinator-only");
  assert.equal(RELEASE_R30_CANDIDATE.model, RELEASE_R29.model, "#44 changes neither model nor effort");
  assert.deepEqual(RELEASE_R30_CANDIDATE.builtInTools, RELEASE_R29.builtInTools, "#44 changes no tool permission");
});

test("#44 attestation: r29 requires exactly specialist v4; a missing or foreign roster fails closed", () => {
  const agent = agentVersionFixture(RELEASE_R29) as Record<string, any>;
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R29, agent));
  assert.doesNotThrow(() => attestServingSession(RELEASE_R29, servingSessionFixture(RELEASE_R29)));
  const withoutRoster = { ...agent, multiagent: null };
  assert.throws(() => attestAgentVersion(RELEASE_R29, withoutRoster), /roster has 0 members, expected 1.*specialist agent_01KNiQDzzPjaMU6LLF4mU6uM missing/);
  const session = servingSessionFixture(RELEASE_R29) as Record<string, any>;
  session.agent.multiagent = null;
  assert.throws(() => attestServingSession(RELEASE_R29, session), /specialist agent_01KNiQDzzPjaMU6LLF4mU6uM missing/);
  assert.match(formatServingTuple({ release: RELEASE_R29, appRevision: "rev", sessionId: "sesn_x", observed: normalizeAgentConfig(agent) }),
    /specialist=agent_01KNiQDzzPjaMU6LLF4mU6uM@4/);
});

test("#44 attestation: r30 requires NO roster; the retired specialist or any other member fails closed", () => {
  const r30 = resolvedR30();
  assert.equal(r30.specialist, null);
  const agent = agentVersionFixture(r30) as Record<string, any>;
  assert.equal(agent.multiagent, null);
  assert.doesNotThrow(() => attestAgentVersion(r30, agent));
  assert.doesNotThrow(() => attestServingSession(r30, servingSessionFixture(r30)));
  // The retired specialist reappearing (e.g. a v30 created without clearing the roster) is drift, not "unverified".
  const stale = { ...agent, multiagent: { type: "coordinator", agents: [{ type: "agent", id: PROJECT_HEALTH_SPECIALIST_AGENT_ID, version: 4 }] } };
  assert.throws(() => attestAgentVersion(r30, stale), /roster has 1 members, expected none.*unexpected roster member agent_01KNiQDzzPjaMU6LLF4mU6uM@4/);
  const session = servingSessionFixture(RELEASE_R29) as Record<string, any>;
  const r30Session = servingSessionFixture(r30) as Record<string, any>;
  r30Session.agent.multiagent = session.agent.multiagent;
  assert.throws(() => attestServingSession(r30, r30Session), /unexpected roster member agent_01KNiQDzzPjaMU6LLF4mU6uM@4/);
  const other = { ...agent, multiagent: { type: "coordinator", agents: [{ type: "agent", id: "agent_other", version: 1 }] } };
  assert.throws(() => attestAgentVersion(r30, other), /unexpected roster member agent_other@1/);
  assert.match(formatServingTuple({ release: r30, appRevision: "rev", sessionId: "sesn_x", observed: normalizeAgentConfig(agent) }), /specialist=none/);
});

test("#44 plan: the r30 update body clears the roster, and applied to v29 it attests as r30 (no partial update)", () => {
  const r30 = resolvedR30();
  const body = buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: R30_TEST_PINS }, R30_SYSTEM_PROMPT);
  assert.ok("multiagent" in body && body.multiagent === null, "omitting multiagent would silently keep specialist v4");
  const v29 = agentVersionFixture(RELEASE_R29);
  const v30 = { ...v29, version: 30, skills: body.skills, tools: body.tools, system: body.system, mcp_servers: body.mcp_servers, multiagent: body.multiagent };
  assert.doesNotThrow(() => attestAgentVersion(r30, v30));
  // The same body without the roster clear would be caught by attestation.
  assert.throws(() => attestAgentVersion(r30, { ...v30, multiagent: v29.multiagent }), /unexpected roster member/);
  // A Skills/tools-only release body can never carry a roster change.
  assert.throws(() => buildReleaseUpdateBody({ ...RELEASE_R29, id: "r29-no-specialist", agent: { ...RELEASE_R29.agent, version: 30 }, specialist: null }, 29),
    /changes the specialist roster/);
  // Adding or repinning a specialist is not a reviewed transition.
  assert.throws(() => buildCandidateUpdateBody({ ...RELEASE_R30_CANDIDATE, specialist: { ...RELEASE_R29.specialist!, version: 5 } }, { skills: R30_TEST_PINS }, R30_SYSTEM_PROMPT),
    /changes the specialist roster/);
});
