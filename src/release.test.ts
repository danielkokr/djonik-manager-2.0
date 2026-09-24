import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_TOOL_NAMES, RELEASE_R25, RELEASE_R26, RELEASES, SERVING_RELEASE } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";
import { PROJECT_HEALTH_SPECIALIST_AGENT_ID } from "./djonikClient.js";
import { SYSTEM_PROMPT } from "./releaseFixtures.test-helpers.js";

// #33 release definitions: one reviewed expectation per release, kept in lockstep with the declarative
// Agent source (`managed-agents/*.md`) and the repo Skills, so a release can never silently diverge from
// what review accepted.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...path: string[]) => readFileSync(join(repoRoot, ...path), "utf8").replace(/\r\n/g, "\n");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read("managed-agents", "djonik.md"))![1];
const specialistFrontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read("managed-agents", "project-health-specialist.md"))![1];

test("the serving release of this revision is one of the reviewed releases", () => {
  assert.ok(Object.values(RELEASES).includes(SERVING_RELEASE));
  assert.equal(RELEASES[SERVING_RELEASE.id], SERVING_RELEASE);
});

test("this revision serves r26: Agent v26, every Skill explicitly pinned, #36 exposed (docs/53)", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R26);
  assert.equal(SERVING_RELEASE.agent.version, 26);
  assert.ok(SERVING_RELEASE.skills.every((skill) => skill.pin.kind === "explicit"), "no `latest` is served");
  assert.deepEqual(SERVING_RELEASE.customTools, ["trello_work_history"]);
});

test("r26 equals the declarative coordinator source managed-agents/djonik.md", () => {
  assert.equal(RELEASE_R26.systemSha256, sha(SYSTEM_PROMPT), "prompt SHA = djonik.md body");
  assert.match(frontmatter, new RegExp(`^model:\\n  id: ${RELEASE_R26.model.id}\\n  effort: ${RELEASE_R26.model.effort}\\n  speed: ${RELEASE_R26.model.speed}$`, "m"));
  const skills = [...frontmatter.matchAll(/- type: custom\n\s+skill_id: (\S+)\n\s+version: (\S+)/g)].map((m) => `${m[1]}@${m[2]}`);
  assert.deepEqual(
    skills,
    RELEASE_R26.skills.map((skill) => `${skill.skillId}@${skill.pin.kind === "explicit" ? skill.pin.version : "latest"}`),
  );
  const roster = [...frontmatter.matchAll(/- type: agent\n\s+id: (\S+)\n\s+version: (\d+)/g)].map((m) => `${m[1]}@${m[2]}`);
  assert.deepEqual(roster, [`${RELEASE_R26.specialist.id}@${RELEASE_R26.specialist.version}`]);
  const servers = [...frontmatter.matchAll(/- type: url\n\s+name: (\S+)\n\s+url: (\S+)/g)].map((m) => `${m[1]}=${m[2]}`);
  assert.deepEqual(servers, RELEASE_R26.mcpServers.map((server) => `${server.name}=${server.url}`));
  const writes = Object.fromEntries([...frontmatter.matchAll(/- name: (trelloWrite\w+)\n\s+enabled: (true|false)/g)].map((m) => [m[1], m[2] === "true"]));
  assert.deepEqual(writes, RELEASE_R26.mcpToolsets.find((toolset) => toolset.server === "trello")!.overrides);
  const custom = [...frontmatter.matchAll(/^  - type: custom\n    name: (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(custom, RELEASE_R26.customTools);
});

test("r25 (current production, rollback target) is r26 minus exactly the three #33 changes", () => {
  const strip = (release: typeof RELEASE_R25) => ({ ...release, id: "", agent: { ...release.agent, version: 0 }, skills: [], builtInTools: [], customTools: [] });
  assert.deepEqual(strip(RELEASE_R25), strip(RELEASE_R26), "model, prompt, MCP, specialist and Session resources are unchanged");
  // 1. Skill pins: same accepted content — r25's `latest` must resolve to exactly r26's explicit pins.
  const r25 = RELEASE_R25.skills.map((skill) => `${skill.skillId}@${skill.pin.kind === "latest" ? skill.pin.expectedResolved : "?"}`);
  const r26 = RELEASE_R26.skills.map((skill) => `${skill.skillId}@${skill.pin.kind === "explicit" ? skill.pin.version : "?"}`);
  assert.deepEqual(r26.slice(0, 4), r25);
  // 2. #36: work-review Skill + trello_work_history appear only in r26.
  assert.deepEqual(r26.slice(4), ["skill_0169h7GYNYUDDDZteDCUV2fE@skver_015LYzVdivGGMsBpuki4kW4S"]);
  assert.deepEqual(RELEASE_R25.customTools, []);
  assert.deepEqual(RELEASE_R26.customTools, ["trello_work_history"]);
  // 3. Built-in toolset: r25 is everything (as production is today); r26 drops bash and the web tools.
  assert.deepEqual([...RELEASE_R25.builtInTools].sort(), [...BUILT_IN_TOOL_NAMES].sort());
  assert.deepEqual(
    BUILT_IN_TOOL_NAMES.filter((name) => !RELEASE_R26.builtInTools.includes(name)),
    ["bash", "web_fetch", "web_search"],
  );
});

test("no release that pins explicitly carries a `latest` Skill; r26 is fully immutable", () => {
  for (const skill of RELEASE_R26.skills) {
    assert.equal(skill.pin.kind, "explicit");
    if (skill.pin.kind === "explicit") assert.match(skill.pin.version, /^skver_\w+$/);
  }
});

test("Skills and memory still have the file tools they need in every release", () => {
  // Attached Skills are loaded with `read`; Memory is a mounted directory read/written with read/write/edit.
  for (const release of Object.values(RELEASES)) {
    for (const tool of ["read", "write", "edit"] as const) assert.ok(release.builtInTools.includes(tool), `${release.id} needs ${tool}`);
    assert.equal(release.session.memoryAccess, "read_write", `${release.id} production Memory is read_write`);
  }
});

test("every custom tool a release exposes is one this application executes", () => {
  for (const release of Object.values(RELEASES)) {
    for (const name of release.customTools) assert.ok(SUPPORTED_CUSTOM_TOOLS[name], `${release.id}: ${name}`);
  }
});

test("the specialist pin matches the reviewed specialist source and the client's canonical id", () => {
  for (const release of Object.values(RELEASES)) {
    assert.equal(release.specialist.id, PROJECT_HEALTH_SPECIALIST_AGENT_ID);
    const [pin] = release.specialist.skills;
    assert.match(specialistFrontmatter, new RegExp(`skill_id: ${pin.skillId}\\n\\s+version: ${pin.version}`));
  }
  const lock = JSON.parse(read("claude-lock.json"));
  assert.equal(lock.resources["./managed-agents/project-health-specialist.md"].version, String(RELEASE_R26.specialist.version));
});

test("pinned Skill versions are the accepted repo Skills (recorded hashes in docs/42 and docs/32)", () => {
  const recorded: Record<string, string> = {
    "task-management": "e994d31a",
    "daily-planning": "7fc9ff92",
    "weekly-planning": "0d6cca38",
    "work-review": "c079d285",
  };
  for (const [name, prefix] of Object.entries(recorded)) {
    assert.ok(RELEASE_R26.skills.some((skill) => skill.name === name));
    assert.equal(sha(read(".claude", "skills", name, "SKILL.md")).slice(0, 8), prefix, `${name} repo source drifted from its pinned version`);
  }
});

test("release definitions hold identifiers only — nothing credential-shaped", () => {
  const source = read("src", "release.ts");
  assert.doesNotMatch(source, /sk-ant-|\b\d{8,10}:[A-Za-z0-9_-]{30,}\b|\b[a-f0-9]{32}\b(?![a-f0-9])/i);
  assert.doesNotMatch(source, /process\.env/);
});

test("the generated v26 update body produces exactly the r26 release (cutover cannot be hand-typed wrong)", async () => {
  const { buildAgentUpdateBody } = await import("./releasePlan.js");
  const { attestAgentVersion } = await import("./releaseAttestation.js");
  const { agentVersionFixture } = await import("./releaseFixtures.test-helpers.js");
  const body = buildAgentUpdateBody(RELEASE_R26, 25);
  assert.equal(body.version, 25, "optimistic-concurrency precondition on the current production version");
  assert.deepEqual(Object.keys(body).sort(), ["skills", "tools", "version"], "model, system, MCP servers and roster are preserved by omission");
  // Apply the body to today's v25 and attest the result as r26.
  const v25 = agentVersionFixture(RELEASE_R25);
  const v26 = { ...v25, version: 26, skills: body.skills, tools: body.tools };
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R26, v26));
  // The rollback direction (r25 shape) is reproducible the same way.
  const back = buildAgentUpdateBody(RELEASE_R25, 26);
  assert.doesNotThrow(() =>
    attestAgentVersion({ ...RELEASE_R25, agent: { ...RELEASE_R25.agent, version: 27 } }, { ...v26, version: 27, skills: back.skills, tools: back.tools }, {
      resolvedLatest: Object.fromEntries(RELEASE_R25.skills.map((s) => [s.skillId, s.pin.kind === "latest" ? s.pin.expectedResolved : ""])),
    }),
  );
});
