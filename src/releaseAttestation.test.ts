import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R25, RELEASE_R26, type DjonikRelease } from "./release.js";
import {
  attestAgentVersion,
  attestServingSession,
  canonicalJsonSha256,
  compareWithRelease,
  formatServingTuple,
  normalizeAgentConfig,
  ReleaseAttestationError,
} from "./releaseAttestation.js";
import { agentVersionFixture, resolvedLatestFor, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

// #33 startup attestation. Every mismatch must fail closed; the logged tuple must stay content-free.

type Rec = Record<string, any>;

function mismatchesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReleaseAttestationError, `expected ReleaseAttestationError, got ${String(error)}`);
    return error.mismatches;
  }
  return [];
}

function sessionAgent(session: Rec): Rec {
  return session.agent as Rec;
}

for (const release of [RELEASE_R25, RELEASE_R26] as DjonikRelease[]) {
  const options = { resolvedLatest: resolvedLatestFor(release) };

  test(`${release.id}: the exact accepted Agent version and Session snapshot attest`, () => {
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agentVersionFixture(release), options)), []);
    assert.deepEqual(mismatchesOf(() => attestServingSession(release, servingSessionFixture(release), options)), []);
  });

  test(`${release.id}: a wrong Agent version is rejected`, () => {
    const agent = agentVersionFixture(release);
    agent.version = release.agent.version + 1;
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agent, options)), [
      `agent version ${release.agent.version + 1} != ${release.agent.version}`,
    ]);
  });

  test(`${release.id}: a wrong specialist version is rejected (roster pin)`, () => {
    const agent = agentVersionFixture(release) as Rec;
    agent.multiagent.agents[0].version = 5;
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agent, options)), ["specialist version 5 != 4"]);
    const session = servingSessionFixture(release) as Rec;
    sessionAgent(session).multiagent.agents[0].skills[0].version = "skver_other";
    assert.equal(mismatchesOf(() => attestServingSession(release, session, options)).length, 1);
  });

  test(`${release.id}: an extra roster member or a missing specialist is rejected`, () => {
    const agent = agentVersionFixture(release) as Rec;
    agent.multiagent.agents.push({ type: "agent", id: "agent_other", version: 1 });
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agent, options)), ["roster has 2 members, expected 1"]);
    agent.multiagent = null;
    assert.ok(mismatchesOf(() => attestAgentVersion(release, agent, options)).some((m) => m.includes("missing from roster")));
  });

  test(`${release.id}: model, effort, speed and prompt drift are rejected`, () => {
    const agent = agentVersionFixture(release) as Rec;
    agent.model = { id: "claude-haiku-4-5-20251001", effort: { type: "low" }, speed: "fast" };
    agent.system = "a different prompt";
    const mismatches = mismatchesOf(() => attestAgentVersion(release, agent, options));
    assert.equal(mismatches.length, 4);
    assert.ok(mismatches.every((m) => !m.includes("a different prompt")), "a mismatch never echoes prompt text");
  });

  test(`${release.id}: an unexpected or missing Skill is rejected`, () => {
    const agent = agentVersionFixture(release) as Rec;
    const removed = agent.skills.pop();
    agent.skills.push({ type: "custom", skill_id: "skill_unreviewed", version: "skver_x" });
    const mismatches = mismatchesOf(() => attestAgentVersion(release, agent, options));
    assert.ok(mismatches.some((m) => m.includes(removed.skill_id) && m.includes("missing")));
    assert.ok(mismatches.includes("unexpected skill skill_unreviewed"));
  });

  test(`${release.id}: an enabled tool needing confirmation is rejected (the client cannot answer one)`, () => {
    const agent = agentVersionFixture(release) as Rec;
    const trello = agent.tools.find((tool: Rec) => tool.mcp_server_name === "trello");
    trello.configs.find((config: Rec) => config.name === "trelloWriteCard").permission_policy = { type: "always_ask" };
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agent, options)), ["mcp toolset trello needs confirmation: trelloWriteCard"]);
  });

  test(`${release.id}: a widened Trello write surface or enabled Calendar is rejected`, () => {
    const agent = agentVersionFixture(release) as Rec;
    agent.tools.find((tool: Rec) => tool.mcp_server_name === "trello").configs.find((c: Rec) => c.name === "trelloWriteList").enabled = true;
    agent.tools.find((tool: Rec) => tool.mcp_server_name === "google-calendar-calendarmcp").default_config.enabled = true;
    const mismatches = mismatchesOf(() => attestAgentVersion(release, agent, options));
    assert.ok(mismatches.includes("mcp toolset trello overrides differ"));
    assert.ok(mismatches.includes("mcp toolset google-calendar-calendarmcp default enabled true != false"));
  });

  test(`${release.id}: an archived Agent version is rejected`, () => {
    const agent = agentVersionFixture(release);
    agent.archived_at = "2026-09-24T00:00:00Z";
    assert.deepEqual(mismatchesOf(() => attestAgentVersion(release, agent, options)), ["agent version is archived"]);
  });

  test(`${release.id}: Session resources must match — environment, single vault, Memory store and access`, () => {
    const session = servingSessionFixture(release) as Rec;
    session.resources[0].access = "read_only";
    assert.deepEqual(mismatchesOf(() => attestServingSession(release, session, options)), ["memory access read_only != read_write"]);
    session.resources = [];
    session.vault_ids = ["vlt_a", "vlt_b"];
    session.environment_id = "env_other";
    assert.equal(mismatchesOf(() => attestServingSession(release, session, options)).length, 3);
  });
}

test("r26: a `latest` Skill reference is rejected where an explicit pin is required", () => {
  const agent = agentVersionFixture(RELEASE_R26) as Rec;
  agent.skills[0].version = "latest";
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R26, agent)), [
    "skill task-management version latest != skver_01CJQkVY1kp1urhBWQgHUYxW",
  ]);
});

test("r26: a wrong explicit Skill version is rejected", () => {
  const session = servingSessionFixture(RELEASE_R26) as Rec;
  sessionAgent(session).skills[4].version = "skver_newer_unreviewed";
  assert.deepEqual(mismatchesOf(() => attestServingSession(RELEASE_R26, session)), [
    "skill work-review version skver_newer_unreviewed != skver_015LYzVdivGGMsBpuki4kW4S",
  ]);
});

test("r25: `latest` is accepted only while it still resolves to the accepted version", () => {
  const agent = agentVersionFixture(RELEASE_R25);
  const resolvedLatest = { ...resolvedLatestFor(RELEASE_R25), skill_01WS6JtY1GMu3rGZaKCVR9w1: "skver_uploaded_later" };
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R25, agent, { resolvedLatest })), [
    "skill task-management latest resolves to skver_uploaded_later != skver_01CJQkVY1kp1urhBWQgHUYxW",
  ]);
  // Unknown resolution (not read) is not silently accepted either.
  assert.equal(mismatchesOf(() => attestAgentVersion(RELEASE_R25, agent)).length, 4);
});

test("r26: bash, web_fetch or web_search re-enabled on the Agent is rejected", () => {
  const agent = agentVersionFixture(RELEASE_R26) as Rec;
  agent.tools[0].configs.push({ name: "bash", enabled: true, permission_policy: { type: "always_allow" } });
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R26, agent)), [
    "built-in tools [bash,edit,glob,grep,read,write] != [edit,glob,grep,read,write]",
  ]);
  // The r25 default-enabled toolset (everything on) does not satisfy the r26 allowlist.
  const wide = agentVersionFixture(RELEASE_R26) as Rec;
  wide.tools[0] = { type: "agent_toolset_20260401", default_config: { enabled: true, permission_policy: { type: "always_allow" } }, configs: [] };
  assert.equal(mismatchesOf(() => attestAgentVersion(RELEASE_R26, wide)).length, 1);
});

test("r26: the custom tool must be exactly the definition this revision executes", () => {
  const drifted = agentVersionFixture(RELEASE_R26) as Rec;
  const tool = drifted.tools.find((entry: Rec) => entry.type === "custom");
  tool.input_schema = { ...tool.input_schema, required: ["window"] };
  assert.equal(mismatchesOf(() => attestAgentVersion(RELEASE_R26, drifted)).length, 1);

  const missing = agentVersionFixture(RELEASE_R26) as Rec;
  missing.tools = missing.tools.filter((entry: Rec) => entry.type !== "custom");
  assert.deepEqual(mismatchesOf(() => attestAgentVersion(RELEASE_R26, missing)), ["custom tools [] != [trello_work_history]"]);

  // An Agent exposing a custom tool this client cannot settle would stall on requires_action.
  const unknown = agentVersionFixture(RELEASE_R26) as Rec;
  unknown.tools.push({ type: "custom", name: "trello_write_anything", description: "x", input_schema: { type: "object" } });
  assert.ok(mismatchesOf(() => attestAgentVersion(RELEASE_R26, unknown)).includes("custom tool trello_write_anything is not executable by this application"));
});

test("r25 serves no custom tool: the #36 tool appearing on v25 is drift", () => {
  const agent = agentVersionFixture(RELEASE_R26) as Rec;
  agent.version = 25;
  const mismatches = compareWithRelease(RELEASE_R25, normalizeAgentConfig(agent), { resolvedLatest: resolvedLatestFor(RELEASE_R25) });
  assert.ok(mismatches.includes("custom tools [trello_work_history] != []"));
});

test("canonical schema hashing ignores key order (the provider re-orders JSON Schema keys)", () => {
  assert.equal(canonicalJsonSha256({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 0 } }), canonicalJsonSha256({ a: { c: 0, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.notEqual(canonicalJsonSha256({ a: [1, 2] }), canonicalJsonSha256({ a: [2, 1] }));
});

test("the serving tuple line is content-free: ids, versions and hash prefixes only", () => {
  const session = servingSessionFixture(RELEASE_R26);
  const observed = attestServingSession(RELEASE_R26, session);
  const line = formatServingTuple({ release: RELEASE_R26, appRevision: "0123456789abcdef0123456789abcdef01234567", sessionId: "sesn_x", observed, trelloHistory: "ok/expires=never" });
  assert.match(line, /^\[release\] serving release=r26 /);
  assert.match(line, /agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26/);
  assert.match(line, /skill_pins=explicit/);
  assert.match(line, /builtin=edit,glob,grep,read,write/);
  assert.match(line, /custom_tools=trello_work_history#[0-9a-f]{12}/);
  assert.match(line, /specialist=agent_01KNiQDzzPjaMU6LLF4mU6uM@4/);
  assert.ok(line.length < 1200);
  // No prompt text, no instructions, no full 64-hex hashes that could be mistaken for secrets.
  assert.doesNotMatch(line, /Джонік|Daniel|Trello board-action digest/);
  assert.doesNotMatch(line, /\b[0-9a-f]{64}\b/);

  const r25Line = formatServingTuple({ release: RELEASE_R25, appRevision: "abc1234", sessionId: "sesn_y", observed: attestServingSession(RELEASE_R25, servingSessionFixture(RELEASE_R25), { resolvedLatest: resolvedLatestFor(RELEASE_R25) }) });
  assert.match(r25Line, /skill_pins=latest-resolved/);
  assert.match(r25Line, /custom_tools=none/);
});

test("the observed config never retains the prompt itself, only its hash", () => {
  const observed = normalizeAgentConfig(agentVersionFixture(RELEASE_R26));
  assert.doesNotMatch(JSON.stringify(observed), /Джонік|Kyiv date range/);
  assert.equal(observed.systemSha256, RELEASE_R26.systemSha256);
});

test("attestation input is not trusted: garbage input fails closed instead of throwing a TypeError", () => {
  for (const garbage of [null, undefined, 42, "agent", [], { tools: "x", skills: {} }]) {
    const mismatches = mismatchesOf(() => attestAgentVersion(RELEASE_R26, garbage));
    assert.ok(mismatches.length > 0);
  }
  assert.ok(mismatchesOf(() => attestServingSession(RELEASE_R26, { agent: null })).length > 0);
});
