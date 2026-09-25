import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationPolicyProblems,
  RELEASE_R25,
  RELEASE_R26,
  RELEASE_R27_CANDIDATE,
  RELEASES,
  resolveReleaseCandidate,
  REVIEWED_TRELLO_READ_TOOLS,
  SERVING_RELEASE,
  UnresolvedReleaseCandidateError,
  type DjonikRelease,
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
import { readOnlyBoundaryFor, SERVING_READ_ONLY_BOUNDARY, startWorkingRhythm } from "./rhythmRuntime.js";
import { createMemoryRhythmStateStore } from "./rhythmState.js";
import { REVIEWED_CONFIRMATION_TOOLS } from "./toolConfirmation.js";

// #39 Stage 3A — release permission-policy schema, the source-only r27 candidate, attestation of `always_ask`,
// and the rhythm activation gate derived from the served release. Offline; no remote identifiers invented:
// the pins below are visibly TEST-ONLY placeholders used to prove the mechanics of a future resolution.

type Rec = Record<string, any>;

const TEST_ONLY_PINS = { skills: { "pm-rhythm": { skillId: "skill_TESTONLYpmrhythm", version: "skver_TESTONLYpmrhythm", sessionVersion: "1" } } };
/** What Stage 3B would produce once real ids exist — here with test-only placeholders. */
const HYPOTHETICAL_R27: DjonikRelease = resolveReleaseCandidate(RELEASE_R27_CANDIDATE, { ...TEST_ONLY_PINS, agentVersion: 27 });

function mismatchesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReleaseAttestationError, String(error));
    return error.mismatches;
  }
  return [];
}

// --- Serving stays r26 ----------------------------------------------------------------------------------------

test("SERVING_RELEASE is still r26; r27 exists only as the resolved release (Stage 3B-1); the candidate is not servable", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R26);
  assert.deepEqual(Object.keys(RELEASES).sort(), ["r25", "r26", "r27"]);
  assert.equal(Object.values(RELEASES).includes(RELEASE_R27_CANDIDATE as unknown as DjonikRelease), false);
  assert.equal(RELEASE_R27_CANDIDATE.agent.version, null, "no Agent v27 exists");
  assert.equal("id" in RELEASE_R27_CANDIDATE, false, "a candidate has no release id");
});

test("the candidate's pm-rhythm pin is visibly unresolved — no invented skill_/skver_ id anywhere in source", () => {
  const pmRhythm = RELEASE_R27_CANDIDATE.skills.find((skill) => skill.name === "pm-rhythm");
  assert.deepEqual(pmRhythm?.skillId, null);
  assert.equal(pmRhythm?.pin.kind, "unresolved");
});

test("r27 candidate = r26 + pm-rhythm (unresolved) + always_ask gates + fail-closed Trello default; nothing else changes", () => {
  const { candidateId, becomes, agent, skills, confirmationRequired, mcpToolsets, ...rest } = RELEASE_R27_CANDIDATE;
  const { id, agent: r26Agent, skills: r26Skills, mcpToolsets: r26Toolsets, ...r26Rest } = RELEASE_R26;
  assert.deepEqual(rest, r26Rest, "model, prompt, specialist v4, built-ins, custom tool, MCP servers, Session resources");
  // Calendar toolset identical (disabled); Trello: same write overrides, reads named explicitly, ask default.
  assert.deepEqual(mcpToolsets.find((t) => t.server !== "trello"), r26Toolsets.find((t) => t.server !== "trello"));
  const trello = mcpToolsets.find((t) => t.server === "trello")!;
  const r26Trello = r26Toolsets.find((t) => t.server === "trello")!;
  assert.equal(trello.defaultEnabled, true);
  assert.equal(trello.defaultPolicy, "always_ask");
  assert.equal(r26Trello.defaultPolicy, undefined, "r26 keeps its implicit always_allow default");
  assert.deepEqual(trello.overrides, { ...Object.fromEntries(REVIEWED_TRELLO_READ_TOOLS.map((n) => [n, true])), ...r26Trello.overrides });
  assert.equal(agent.id, r26Agent.id);
  assert.equal(agent.fromVersion, 26);
  assert.deepEqual(skills.slice(0, r26Skills.length), r26Skills, "accepted Skills keep their exact pins");
  assert.deepEqual(skills.slice(r26Skills.length).map((skill) => skill.name), ["pm-rhythm"]);
  assert.deepEqual(confirmationRequired, { builtIn: [...REVIEWED_CONFIRMATION_TOOLS.builtIn], mcp: { trello: ["trelloWriteCard"] } });
  assert.deepEqual(confirmationPolicyProblems(RELEASE_R27_CANDIDATE), []);
  assert.equal(candidateId, "r27-candidate");
  assert.equal(becomes, "r27");
  assert.equal(id, "r26");
});

test("no update body and no release can be produced while pm-rhythm is unresolved", () => {
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, { skills: {} }), UnresolvedReleaseCandidateError);
  assert.throws(
    () => buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, { skills: { "pm-rhythm": { skillId: "pm-rhythm", version: "latest" } } }),
    UnresolvedReleaseCandidateError,
    "a non-skill_/non-skver_ value is not a pin",
  );
  assert.throws(() => resolveReleaseCandidate(RELEASE_R27_CANDIDATE, { skills: {} , agentVersion: 27 }), UnresolvedReleaseCandidateError);
  assert.throws(() => resolveReleaseCandidate(RELEASE_R27_CANDIDATE, TEST_ONLY_PINS), UnresolvedReleaseCandidateError, "agent version required");
  assert.throws(() => resolveReleaseCandidate(RELEASE_R27_CANDIDATE, { ...TEST_ONLY_PINS, agentVersion: 26 }), UnresolvedReleaseCandidateError);
});

// --- Update body ------------------------------------------------------------------------------------------------

test("r25/r26 update bodies are unchanged by the schema: every permission_policy stays always_allow", () => {
  for (const release of [RELEASE_R25, RELEASE_R26]) {
    const body = JSON.stringify(buildAgentUpdateBody(release, 1));
    assert.doesNotMatch(body, /always_ask|"auto"/, release.id);
  }
});

test("r26 cutover body is byte-identical to the one generated at Stage 2 HEAD 4e2ec69 (the body that created v26)", () => {
  // SHA-256 of JSON.stringify(buildAgentUpdateBody(RELEASE_R26, 25)), measured on a clean 4e2ec69 checkout.
  assert.equal(sha256(JSON.stringify(buildAgentUpdateBody(RELEASE_R26, 25))), "8883b7e1d88794078e93c95f813b2cff3d321a6ac574b0031aaa2419ffff5ef2");
  assert.equal(sha256(JSON.stringify(buildAgentUpdateBody(RELEASE_R25, 26))), "72d609826f9923bd5398dfb397692bdd2d4b2114e6711371e91f41dd55487688");
});

test("candidate update body: Trello default always_ask; reviewed reads explicit always_allow; write/edit/trelloWriteCard always_ask; disabled writes stay disabled; Calendar disabled", () => {
  const body = buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, TEST_ONLY_PINS) as Rec;
  assert.equal(body.version, 26, "optimistic-concurrency precondition on v26");
  assert.deepEqual(Object.keys(body).sort(), ["skills", "tools", "version"]);
  assert.deepEqual(body.skills.at(-1), { type: "custom", skill_id: "skill_TESTONLYpmrhythm", version: "skver_TESTONLYpmrhythm" });
  const [builtIn, custom, trello, calendar] = body.tools as Rec[];
  assert.deepEqual(builtIn.default_config, { enabled: false, permission_policy: { type: "always_allow" } });
  assert.deepEqual(
    Object.fromEntries(builtIn.configs.map((c: Rec) => [c.name, c.permission_policy.type])),
    { read: "always_allow", write: "always_ask", edit: "always_ask", glob: "always_allow", grep: "always_allow" },
  );
  assert.equal(custom.name, "trello_work_history");
  assert.equal("permission_policy" in custom, false, "custom tools are not governed by permission policies");
  assert.deepEqual(trello.default_config, { enabled: true, permission_policy: { type: "always_ask" } }, "unknown tools inherit ask");
  assert.deepEqual(
    Object.fromEntries(trello.configs.map((c: Rec) => [c.name, [c.enabled, c.permission_policy.type]])),
    {
      trelloReadBoard: [true, "always_allow"],
      trelloReadCard: [true, "always_allow"],
      trelloReadChecklist: [true, "always_allow"],
      trelloReadInbox: [true, "always_allow"],
      trelloReadList: [true, "always_allow"],
      trelloReadMember: [true, "always_allow"],
      trelloReadPlanner: [true, "always_allow"],
      trelloReadWorkspace: [true, "always_allow"],
      trelloSearch: [true, "always_allow"],
      trelloWriteBoard: [false, "always_allow"],
      trelloWriteCard: [true, "always_ask"],
      trelloWriteChecklist: [false, "always_allow"],
      trelloWriteInbox: [false, "always_allow"],
      trelloWriteList: [false, "always_allow"],
      trelloWritePlanner: [false, "always_allow"],
    },
  );
  assert.deepEqual(calendar.default_config, { enabled: false, permission_policy: { type: "always_allow" } });
});

test("a confirmation policy naming a disabled or unnamed tool is refused (it would silently stay always_allow)", () => {
  assert.throws(() => buildAgentUpdateBody({ ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: ["bash"], mcp: {} } }, 26), /not enabled/);
  assert.throws(() => buildAgentUpdateBody({ ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: [], mcp: { trello: ["trelloWriteList"] } } }, 26), /explicitly enabled/);
  assert.throws(() => buildAgentUpdateBody({ ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: [], mcp: { trello: ["trelloSomethingNew"] } } }, 26), /explicitly enabled/);
});

// --- Attestation ----------------------------------------------------------------------------------------------

test("the generated body applied to v26 attests as the (hypothetical) r27 — Agent version and Session snapshot", () => {
  const body = buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, TEST_ONLY_PINS) as Rec;
  const v27 = { ...agentVersionFixture(RELEASE_R26), version: 27, skills: body.skills, tools: body.tools };
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(HYPOTHETICAL_R27, v27)), []);
  assert.deepEqual(mismatchesOf(() => attestServingSession(HYPOTHETICAL_R27, servingSessionFixture(HYPOTHETICAL_R27))), []);
  const observed = normalizeAgentConfig(v27);
  assert.deepEqual(observed.builtIn?.alwaysAsk, ["edit", "write"]);
  assert.deepEqual(observed.mcpToolsets.find((t) => t.server === "trello")?.alwaysAsk, ["trelloWriteCard"]);
});

test("an unknown future Trello tool inherits always_ask (never allow) under the candidate policy", () => {
  const agent = agentVersionFixture(HYPOTHETICAL_R27) as Rec;
  const trello = normalizeAgentConfig(agent).mcpToolsets.find((t) => t.server === "trello")!;
  assert.equal(trello.defaultPolicy, "always_ask");
  // `*` = every tool the Agent does not name: they wait for a confirmation (which the client only grants to
  // REVIEWED_CONFIRMATION_TOOLS — see toolConfirmationClient.test.ts).
  assert.deepEqual([...trello.needsConfirmation].sort(), ["*", "trelloWriteCard"]);
  assert.equal(REVIEWED_CONFIRMATION_TOOLS.mcp.trello.includes("trelloFutureTool"), false);
  // Under r26 the same unknown tool would inherit always_allow — the gap this hardening closes for r27.
  assert.equal(normalizeAgentConfig(agentVersionFixture(RELEASE_R26)).mcpToolsets.find((t) => t.server === "trello")!.defaultPolicy, "always_allow");
});

test("r26 serving attestation still passes, and r26 cannot claim r27 (nor r27 pass as r26)", () => {
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R26, agentVersionFixture(RELEASE_R26))), []);
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R26, servingSessionFixture(RELEASE_R26))), []);
  const r26AsR27 = compareWithRelease(HYPOTHETICAL_R27, normalizeAgentConfig({ ...agentVersionFixture(RELEASE_R26), version: 27, skills: agentVersionFixture(HYPOTHETICAL_R27).skills }));
  assert.deepEqual(r26AsR27, [
    "built-in tools need confirmation: [] != [edit,write]",
    "built-in always_ask tools [] != [edit,write]",
    "mcp toolset trello overrides differ",
    "mcp toolset trello default policy always_allow != always_ask",
    "mcp toolset trello needs confirmation: [] != [*,trelloWriteCard]",
    "mcp toolset trello always_ask tools [] != [trelloWriteCard]",
  ]);
  const r27AsR26 = compareWithRelease(RELEASE_R26, normalizeAgentConfig({ ...agentVersionFixture(HYPOTHETICAL_R27), version: 26, skills: agentVersionFixture(RELEASE_R26).skills }));
  assert.ok(r27AsR26.includes("built-in tools need confirmation: [edit,write] != []"), r27AsR26.join("; "));
  assert.ok(r27AsR26.includes("mcp toolset trello needs confirmation: [*,trelloWriteCard] != []"), r27AsR26.join("; "));
  assert.ok(r27AsR26.includes("mcp toolset trello default policy always_ask != always_allow"), r27AsR26.join("; "));
});

test("r27 policy drift fails closed: auto instead of always_ask, a missing gate, a gate on a read, an allow default, a missing read", () => {
  const drift = (mutate: (agent: Rec) => void) => {
    const agent = agentVersionFixture(HYPOTHETICAL_R27) as Rec;
    mutate(agent);
    return mismatchesOf(() => attestAgentVersion(HYPOTHETICAL_R27, agent));
  };
  const builtIn = (agent: Rec) => agent.tools.find((t: Rec) => t.type === "agent_toolset_20260401");
  const trello = (agent: Rec) => agent.tools.find((t: Rec) => t.mcp_server_name === "trello");
  assert.deepEqual(
    drift((a) => (builtIn(a).configs.find((c: Rec) => c.name === "write").permission_policy = { type: "auto" })),
    ["built-in always_ask tools [edit] != [edit,write]"],
    "auto is not always_ask even though it may pause",
  );
  assert.deepEqual(
    drift((a) => (builtIn(a).configs.find((c: Rec) => c.name === "edit").permission_policy = { type: "always_allow" })),
    ["built-in tools need confirmation: [write] != [edit,write]", "built-in always_ask tools [write] != [edit,write]"],
  );
  assert.deepEqual(
    drift((a) => (trello(a).configs.find((c: Rec) => c.name === "trelloWriteCard").permission_policy = { type: "always_allow" })),
    ["mcp toolset trello needs confirmation: [*] != [*,trelloWriteCard]", "mcp toolset trello always_ask tools [] != [trelloWriteCard]"],
  );
  assert.deepEqual(
    drift((a) => (builtIn(a).configs.find((c: Rec) => c.name === "read").permission_policy = { type: "always_ask" })),
    ["built-in tools need confirmation: [edit,read,write] != [edit,write]", "built-in always_ask tools [edit,read,write] != [edit,write]"],
  );
  assert.deepEqual(
    drift((a) => (trello(a).default_config.permission_policy = { type: "always_allow" })),
    ["mcp toolset trello default policy always_allow != always_ask", "mcp toolset trello needs confirmation: [trelloWriteCard] != [*,trelloWriteCard]"],
    "an allow default would let an unknown future tool run ungated",
  );
  assert.deepEqual(
    drift((a) => (trello(a).configs = trello(a).configs.filter((c: Rec) => c.name !== "trelloReadCard"))),
    ["mcp toolset trello overrides differ"],
    "a removed explicit read allow is drift",
  );
  assert.deepEqual(
    drift((a) => (trello(a).configs.find((c: Rec) => c.name === "trelloSearch").permission_policy = { type: "always_ask" })),
    ["mcp toolset trello needs confirmation: [*,trelloSearch,trelloWriteCard] != [*,trelloWriteCard]", "mcp toolset trello always_ask tools [trelloSearch,trelloWriteCard] != [trelloWriteCard]"],
  );
});

test("serving tuple: r26 line has no always_ask field; an r27 line names the attested gated set (content-free)", () => {
  const r26 = formatServingTuple({ release: RELEASE_R26, appRevision: "abc1234", sessionId: "sesn_1", observed: normalizeAgentConfig(agentVersionFixture(RELEASE_R26)) });
  assert.doesNotMatch(r26, /always_ask/);
  const r27 = formatServingTuple({ release: HYPOTHETICAL_R27, appRevision: "abc1234", sessionId: "sesn_1", observed: normalizeAgentConfig(agentVersionFixture(HYPOTHETICAL_R27)) });
  assert.match(r27, / always_ask=edit,trello\/trelloWriteCard,write memory=read_write session=sesn_1$/);
});

test("permission-policy comparison is order-insensitive (provider ordering is not meaningful)", () => {
  const agent = agentVersionFixture(HYPOTHETICAL_R27) as Rec;
  for (const tool of agent.tools as Rec[]) if (Array.isArray(tool.configs)) tool.configs.reverse();
  (agent.tools as Rec[]).reverse();
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(HYPOTHETICAL_R27, agent)), []);
});

// --- Rhythm activation gate ------------------------------------------------------------------------------------

test("read-only boundary: r25/r26 → post_hoc_detection_only; the serving process (r26) cannot claim pre_execution", () => {
  assert.equal(readOnlyBoundaryFor(RELEASE_R25), "post_hoc_detection_only");
  assert.equal(readOnlyBoundaryFor(RELEASE_R26), "post_hoc_detection_only");
  assert.equal(SERVING_READ_ONLY_BOUNDARY, "post_hoc_detection_only");
});

test("read-only boundary: the candidate / an attested r27 shape satisfies the source contract → pre_execution", () => {
  assert.equal(readOnlyBoundaryFor(RELEASE_R27_CANDIDATE), "pre_execution");
  assert.equal(readOnlyBoundaryFor(HYPOTHETICAL_R27), "pre_execution");
});

function withTrello(change: (toolset: DjonikRelease["mcpToolsets"][number]) => DjonikRelease["mcpToolsets"][number]): DjonikRelease {
  return { ...HYPOTHETICAL_R27, mcpToolsets: HYPOTHETICAL_R27.mcpToolsets.map((t) => (t.server === "trello" ? change(t) : t)) };
}

test("read-only boundary: any ungated mutation path keeps it post-hoc", () => {
  const variants: Array<[string, DjonikRelease]> = [
    ["edit not gated", { ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: ["write"], mcp: { trello: ["trelloWriteCard"] } } }],
    ["trelloWriteCard not gated", { ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: ["write", "edit"], mcp: {} } }],
    ["Calendar enabled", { ...HYPOTHETICAL_R27, mcpToolsets: HYPOTHETICAL_R27.mcpToolsets.map((t) => (t.server === "trello" ? t : { ...t, defaultEnabled: true })) }],
    [
      "another Trello write enabled",
      { ...HYPOTHETICAL_R27, mcpToolsets: HYPOTHETICAL_R27.mcpToolsets.map((t) => (t.server === "trello" ? { ...t, overrides: { ...t.overrides, trelloWriteList: true } } : t)) },
    ],
    ["bash enabled", { ...HYPOTHETICAL_R27, builtInTools: [...HYPOTHETICAL_R27.builtInTools, "bash"] }],
    ["policy names a disabled tool", { ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard", "trelloWriteList"] } } }],
    ["Trello default back to always_allow", withTrello((t) => ({ ...t, defaultPolicy: "always_allow" }))],
    ["Trello default policy absent (implicit allow)", withTrello(({ defaultPolicy: _p, ...t }) => t)],
    ["an explicit read allow removed", withTrello((t) => ({ ...t, overrides: Object.fromEntries(Object.entries(t.overrides).filter(([n]) => n !== "trelloReadCard")) }))],
    ["an unreviewed tool explicitly enabled", withTrello((t) => ({ ...t, overrides: { ...t.overrides, trelloFutureTool: true } }))],
    ["a reviewed read gated", { ...HYPOTHETICAL_R27, confirmationRequired: { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard", "trelloSearch"] } } }],
  ];
  for (const [label, release] of variants) assert.equal(readOnlyBoundaryFor(release), "post_hoc_detection_only", label);
});

function rhythmDeps(boundary: ReturnType<typeof readOnlyBoundaryFor>) {
  let turns = 0;
  return {
    get turns() {
      return turns;
    },
    deps: {
      env: { DJONIK_WORKING_RHYTHM: "on", STATE_DIRECTORY: "/var/lib/djonik" } as NodeJS.ProcessEnv,
      readOnlyBoundary: boundary,
      allowedUserId: "1",
      createConfigSource: () => ({ read: async () => null }),
      createStateStore: () => createMemoryRhythmStateStore(),
      runTurn: async () => (turns++, { reply: "Бриф.", sessionId: "sesn_x", toolUses: [], confirmations: [], autonomousMutationAttempt: false }),
      send: async () => ({ status: "sent" as const, messageId: 1 }),
      currentSessionId: () => "sesn_x",
      answer: async () => {},
      enqueueUserText: () => {},
      now: () => new Date("2026-09-29T06:35:00Z"),
      timers: { setInterval: () => ({}), clearInterval: () => {} },
    },
  };
}

test("activation gate: a hypothetical attested pre-execution release lets the existing runner pass; serving r26 stays blocked", async () => {
  const hypothetical = rhythmDeps(readOnlyBoundaryFor(HYPOTHETICAL_R27));
  const running = startWorkingRhythm(hypothetical.deps);
  assert.equal(running.status, "running");
  const report = await running.scheduler!.tick();
  assert.equal(report.status, "ran");
  assert.equal(hypothetical.turns, 1);
  await running.stop();

  const serving = rhythmDeps(SERVING_READ_ONLY_BOUNDARY);
  const blocked = startWorkingRhythm(serving.deps);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, "read_only_boundary=post_hoc_detection_only");
  assert.equal(serving.turns, 0);
});
