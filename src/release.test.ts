import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_TOOL_NAMES, RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28_CANDIDATE, RELEASE_R29, RELEASES, RETIRED_BY_R28, SERVING_RELEASE, type DjonikRelease } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";
import { buildAgentUpdateBody } from "./releasePlan.js";
import { PROJECT_HEALTH_SPECIALIST_AGENT_ID } from "./djonikClient.js";
import { PRE_41_SYSTEM_PROMPT, R28_SYSTEM_PROMPT, SOURCE_SYSTEM_PROMPT } from "./releaseFixtures.test-helpers.js";

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

test("this revision serves r29: Agent v29, every Skill pinned with its measured Session spelling, #36 exposed, writes gated", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R29);
  assert.equal(SERVING_RELEASE.agent.version, 29);
  assert.ok(SERVING_RELEASE.skills.every((skill) => skill.pin.kind === "explicit"), "no `latest` is served");
  // Without its measured Session spelling a pinned Skill fails the startup Session attestation closed.
  assert.ok(SERVING_RELEASE.skills.every((skill) => skill.pin.kind === "explicit" && /^\d+$/.test(skill.pin.sessionVersion ?? "")), "every sessionVersion measured");
  assert.deepEqual(SERVING_RELEASE.customTools, ["trello_work_history"]);
  assert.deepEqual(SERVING_RELEASE.confirmationRequired, { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard"] } });
});

/** The subset of YAML the declarative frontmatter uses: block maps and lists, plain scalars, and JSON-compatible
 *  quoted strings / flow objects. Test-only; enough to read `skills` and `tools` structurally. */
function parseFrontmatter(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let i = 0;
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const scalar = (raw: string): unknown => {
    if (raw === "true" || raw === "false") return raw === "true";
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw.startsWith('"') || raw.startsWith("{") || raw.startsWith("[")) return JSON.parse(raw);
    return raw;
  };
  // Parses `key: value` / `key:` entries at `indent`; `first` is an entry already cut from a `- ` list line.
  const block = (indent: number, first?: string): unknown => {
    if (first === undefined && lines[i].trimStart().startsWith("- ")) {
      const list: unknown[] = [];
      while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trimStart().startsWith("- ")) {
        const entry = lines[i].trimStart().slice(2);
        i++;
        list.push(block(indent + 2, entry));
      }
      return list;
    }
    const map: Record<string, unknown> = {};
    const take = (entry: string) => {
      const [, key, rest] = /^([\w-]+):(?: (.*))?$/.exec(entry)!;
      map[key] = rest === undefined ? block(indentOf(lines[i])) : scalar(rest);
    };
    if (first !== undefined) take(first);
    while (i < lines.length && indentOf(lines[i]) === indent && !lines[i].trimStart().startsWith("- ")) {
      const entry = lines[i].trimStart();
      i++;
      take(entry);
    }
    return map;
  };
  return block(0) as Record<string, unknown>;
}

const declared = parseFrontmatter(frontmatter);
const declaredSurface = { skills: declared.skills, tools: declared.tools };
const surfaceOf = (release: DjonikRelease) => {
  const { skills, tools } = buildAgentUpdateBody(release, release.agent.version - 1);
  // YAML states an empty `configs` (the disabled Calendar toolset) by omitting it.
  const omitEmpty = (tool: Record<string, unknown>) => {
    const { configs, ...rest } = tool;
    return Array.isArray(configs) && configs.length === 0 ? rest : tool;
  };
  return { skills, tools: (tools as Array<Record<string, unknown>>).map(omitEmpty) };
};

test("the serving release (r29) equals the declarative coordinator source managed-agents/djonik.md", () => {
  const release = SERVING_RELEASE;
  assert.equal(release.systemSha256, sha(SOURCE_SYSTEM_PROMPT), "serving prompt SHA = current djonik.md body");
  assert.equal(RELEASE_R28_CANDIDATE.systemSha256, sha(R28_SYSTEM_PROMPT));
  assert.deepEqual(declared.model, { id: release.model.id, effort: release.model.effort, speed: release.model.speed });
  assert.deepEqual(declared.multiagent, { type: "coordinator", agents: [{ type: "agent", id: release.specialist.id, version: release.specialist.version }] });
  assert.deepEqual(declared.mcp_servers, release.mcpServers.map((server) => ({ type: "url", name: server.name, url: server.url })));
  // Skills (with explicit pins) and every tool — enabled flags AND permission policies — exactly as the
  // generated update body of the serving release states them.
  assert.deepEqual(declaredSurface, surfaceOf(release));
  const declaredIds = (declared.skills as Array<Record<string, string>>).map((skill) => skill.skill_id);
  for (const retired of RETIRED_BY_R28) {
    assert.ok(!declaredIds.includes(RELEASE_R27.skills.find((skill) => skill.name === retired)!.skillId), `${retired} is not declared`);
  }
});

test("r27 (production until the r28 deploy, then the rollback) keeps the pre-#41 prompt and its six pins", () => {
  assert.equal(RELEASES.r27, RELEASE_R27);
  assert.equal(RELEASE_R27.agent.version, 27);
  assert.equal(RELEASE_R27.systemSha256, sha(PRE_41_SYSTEM_PROMPT));
  assert.deepEqual(surfaceOf(RELEASE_R27).tools, declaredSurface.tools, "rollback keeps the same tools and permission policies");
});

test("the declaration cannot silently fall back to r26 (#39 Stage 3B-3A)", () => {
  assert.notDeepEqual(declaredSurface, surfaceOf(RELEASE_R26), "djonik.md still declares r26");
  const trello = (declared.tools as Array<Record<string, any>>).find((tool) => tool.mcp_server_name === "trello")!;
  assert.equal(trello.default_config.permission_policy.type, "always_ask", "Trello fails closed for unreviewed tools");
  const policies = (tools: Array<Record<string, any>>) =>
    tools.flatMap((tool) => (tool.configs ?? []).filter((c: Record<string, any>) => c.permission_policy.type === "always_ask").map((c: Record<string, any>) => c.name));
  assert.deepEqual(policies(declared.tools as Array<Record<string, any>>), ["write", "edit", "trelloWriteCard"]);
  const skills = (declared.skills as Array<Record<string, string>>).map((skill) => skill.skill_id);
  assert.ok(skills.includes(RELEASE_R27.skills.find((skill) => skill.name === "pm-rhythm")!.skillId), "pm-rhythm is declared");
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
    "work-review": "c079d285",
  };
  for (const [name, prefix] of Object.entries(recorded)) {
    assert.ok(RELEASE_R26.skills.some((skill) => skill.name === name));
    assert.equal(sha(read(".claude", "skills", name, "SKILL.md")).slice(0, 8), prefix, `${name} repo source drifted from its pinned version`);
  }
  // task-management's older pin (r26–r28) was synced from `e994d31a…`; r29 pins the accepted #45 source.
  assert.ok(RELEASE_R26.skills.some((skill) => skill.name === "task-management"));
  assert.equal(sha(read(".claude", "skills", "task-management", "SKILL.md")), "aec09d5aa2b8170fe4f9d365a61484d1a1dc8b5e3b49a55382f3b014a8d70b7a");
  // #42 retires daily-planning (`7fc9ff92…`) and weekly-planning (`0d6cca38…`) from the next release. Their pinned
  // versions stay immutable on the provider for the served r27 and its rollback; their source leaves the repo
  // (git history keeps it), so no repo file can silently drift from — or be re-synced as — a retired Skill.
  for (const retired of RETIRED_BY_R28) {
    assert.ok(RELEASE_R27.skills.some((skill) => skill.name === retired && skill.pin.kind === "explicit"), `${retired} stays pinned in r27`);
    assert.throws(() => read(".claude", "skills", retired, "SKILL.md"), /ENOENT/, `${retired} source is retired`);
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
