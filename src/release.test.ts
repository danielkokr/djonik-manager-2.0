import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_TOOL_NAMES, RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28_CANDIDATE, RELEASE_R29, RELEASE_R30, RELEASE_R30_CANDIDATE, RELEASE_R31, RELEASE_R31_CANDIDATE, RELEASES, RETIRED_BY_R28, SERVING_RELEASE, type DjonikRelease } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";
import { buildAgentUpdateBody } from "./releasePlan.js";
import { PROJECT_HEALTH_SPECIALIST_AGENT_ID } from "./djonikClient.js";
import { ISSUE_44_PROMPT_EDITS, ISSUE_59_PROMPT_EDITS, PRE_41_SYSTEM_PROMPT, R28_SYSTEM_PROMPT, R29_SYSTEM_PROMPT, R30_SYSTEM_PROMPT, SOURCE_SYSTEM_PROMPT, r30SkillSource } from "./releaseFixtures.test-helpers.js";

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

test("this revision serves r31 (#65): Agent v31, no specialist, every Skill pinned with its measured Session spelling, writes gated", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R31);
  assert.equal(SERVING_RELEASE.agent.version, 31);
  assert.equal(SERVING_RELEASE.specialist, null, "coordinator-only Project Health topology (#44)");
  assert.ok(SERVING_RELEASE.skills.every((skill) => skill.pin.kind === "explicit"), "no `latest` is served");
  // Without its measured Session spelling a pinned Skill fails the startup Session attestation closed.
  assert.ok(SERVING_RELEASE.skills.every((skill) => skill.pin.kind === "explicit" && /^\d+$/.test(skill.pin.sessionVersion ?? "")), "every sessionVersion measured");
  assert.deepEqual(SERVING_RELEASE.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget", "trello_project_time"]);
  assert.deepEqual(SERVING_RELEASE.mcpServers.map((server) => server.name), ["trello"], "no Calendar MCP");
  assert.deepEqual(SERVING_RELEASE.confirmationRequired, { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard", "trelloWriteChecklist"] } });
});

/** The subset of YAML the declarative frontmatter uses: block maps and lists, plain scalars, and JSON-compatible
 *  quoted strings / flow objects. Test-only; enough to read `skills` and `tools` structurally. */
function parseFrontmatter(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let i = 0;
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const scalar = (raw: string): unknown => {
    if (raw === "null") return null;
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

test("the serving release r31 (Agent v31) equals the declarative coordinator source managed-agents/djonik.md — body and frontmatter", () => {
  // #64 created Agent v31 from this file's body and the real r31 pins (docs/102); #65 (docs/103) made it the serving release,
  // so declaration == SERVING_RELEASE == RELEASE_R31 again. The body is the #59 prompt; reverting exactly
  // ISSUE_59_PROMPT_EDITS gives the r30 (rollback) prompt, and then ISSUE_44_PROMPT_EDITS the r29 prompt.
  assert.equal(SERVING_RELEASE, RELEASE_R31);
  assert.equal(RELEASES.r31, RELEASE_R31);
  const release = SERVING_RELEASE;
  assert.equal(release.systemSha256, sha(SOURCE_SYSTEM_PROMPT), "r31 prompt SHA = djonik.md body");
  assert.equal(RELEASE_R31_CANDIDATE.systemSha256, release.systemSha256, "the reviewed candidate prompt is the synced one");
  assert.equal(RELEASE_R30.systemSha256, sha(R30_SYSTEM_PROMPT), "r30 prompt = djonik.md body minus the #59 edit");
  assert.equal(ISSUE_59_PROMPT_EDITS.length, 1);
  assert.equal(RELEASE_R30_CANDIDATE.systemSha256, RELEASE_R30.systemSha256);
  assert.equal(RELEASE_R29.systemSha256, sha(R29_SYSTEM_PROMPT), "r29 prompt = r30 prompt minus the #44 edit");
  assert.equal(ISSUE_44_PROMPT_EDITS.length, 1);
  assert.equal(RELEASE_R28_CANDIDATE.systemSha256, sha(R28_SYSTEM_PROMPT));
  assert.deepEqual(declared.model, { id: release.model.id, effort: release.model.effort, speed: release.model.speed });
  assert.equal(release.specialist, null);
  assert.ok("multiagent" in declared, "the cleared roster is stated, not omitted");
  assert.equal(declared.multiagent, null, "no roster: Agent v31 reads back `multiagent: null`");
  assert.deepEqual(declared.mcp_servers, release.mcpServers.map((server) => ({ type: "url", name: server.name, url: server.url })));
  // Skills (with explicit pins) and every tool — enabled flags AND permission policies — exactly as the
  // generated update body of r31 states them.
  assert.deepEqual(declaredSurface, surfaceOf(release));
  const declaredIds = (declared.skills as Array<Record<string, string>>).map((skill) => skill.skill_id);
  for (const retired of RETIRED_BY_R28) {
    assert.ok(!declaredIds.includes(RELEASE_R27.skills.find((skill) => skill.name === retired)!.skillId), `${retired} is not declared`);
  }
});

test("the r30 rollback differs from the served declaration (r31) by exactly the reviewed r31 transition (#59 + #62)", () => {
  // #65: r31 is served and declared. Rolling back to r30 (docs/52 §6, docs/103) reverts exactly #59 (prompt +
  // task-management) and #62 (work-review + the read-only trello_project_time tool) — nothing else.
  assert.equal(SERVING_RELEASE, RELEASE_R31);
  assert.equal(RELEASES.r30, RELEASE_R30, "r30 stays a reviewed rollback release");
  assert.deepEqual(surfaceOf(SERVING_RELEASE), declaredSurface, "served == declared");
  const rollback = surfaceOf(RELEASE_R30);
  assert.notDeepEqual(rollback, declaredSurface);
  assert.notEqual(RELEASE_R30.systemSha256, sha(SOURCE_SYSTEM_PROMPT), "prompt: #59");
  assert.equal(RELEASE_R30.specialist, null);
  assert.equal(declared.multiagent, null, "roster: none → none");
  assert.deepEqual(declared.mcp_servers, RELEASE_R30.mcpServers.map((server) => ({ type: "url", ...server })), "MCP servers unchanged");
  const pins = (skills: unknown) => (skills as Array<Record<string, string>>).map((skill) => `${skill.skill_id}@${skill.version}`);
  assert.deepEqual((rollback.skills as Array<Record<string, string>>).map((skill) => skill.skill_id), (declaredSurface.skills as Array<Record<string, string>>).map((skill) => skill.skill_id), "same five Skill identities, same order");
  const moved = RELEASE_R30.skills.filter((_skill, index) => pins(rollback.skills)[index] !== pins(declaredSurface.skills)[index]).map((skill) => skill.name);
  assert.deepEqual(moved.sort(), ["task-management", "work-review"]);
  const byKey = (tools: unknown) => Object.fromEntries((tools as Array<Record<string, any>>).map((tool) => [tool.name ?? tool.mcp_server_name ?? tool.type, tool]));
  const [before, after] = [byKey(rollback.tools), byKey(declaredSurface.tools)];
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual(changed, ["trello_project_time"], "built-in, Trello toolset/policies and the three r30 custom tools unchanged");
  assert.equal(before.trello_project_time, undefined);
  assert.deepEqual(after.trello_project_time, SUPPORTED_CUSTOM_TOOLS.trello_project_time, "the executable #62 definition, not a copy");
});

test("r29 differs from r30 by exactly the reviewed r30 transition", () => {
  // #56 served r30 with r29 as its rollback (docs/93); since #65 r31 serves and r30 is the immediate rollback. r29 stays a
  // reviewed release: whatever differs between r29 and r30 must be one of the reviewed r30 changes, and each must differ.
  const r30 = surfaceOf(RELEASE_R30);
  assert.equal(RELEASES.r30, RELEASE_R30);
  assert.equal(RELEASES.r29, RELEASE_R29, "r29 stays a reviewed release");
  const r29 = surfaceOf(RELEASE_R29);
  assert.notDeepEqual(r29, r30);
  assert.notEqual(RELEASE_R29.systemSha256, sha(R30_SYSTEM_PROMPT), "prompt: #44");
  assert.ok(RELEASE_R29.specialist && RELEASE_R30.specialist === null, "roster: specialist v4 → none");
  assert.deepEqual(RELEASE_R29.mcpServers.map((server) => server.name), ["trello", "google-calendar-calendarmcp"]);
  assert.deepEqual(RELEASE_R30.mcpServers.map((server) => server.name), ["trello"], "MCP: Calendar removed");
  // Skills: same five identities in the same order; exactly the four unresolved-candidate Skills move to new pins.
  const pins = (skills: unknown) => (skills as Array<Record<string, string>>).map((skill) => `${skill.skill_id}@${skill.version}`);
  assert.deepEqual((r29.skills as Array<Record<string, string>>).map((skill) => skill.skill_id), (r30.skills as Array<Record<string, string>>).map((skill) => skill.skill_id));
  const moved = RELEASE_R30.skills.filter((_skill, index) => pins(r29.skills)[index] !== pins(r30.skills)[index]).map((skill) => skill.name);
  assert.deepEqual(moved.sort(), ["planning-and-focus", "pm-rhythm", "studio-intake", "task-management"]);
  // Tools: built-in and trello_work_history unchanged; + board snapshot, + focus budget; checklist write gated; Calendar gone.
  const byKey = (tools: unknown) => Object.fromEntries((tools as Array<Record<string, any>>).map((tool) => [tool.name ?? tool.mcp_server_name ?? tool.type, tool]));
  const [before, after] = [byKey(r29.tools), byKey(r30.tools)];
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual(changed.sort(), ["focus_budget", "google-calendar-calendarmcp", "trello", "trello_board_snapshot"]);
  const checklist = (tool: Record<string, any>) => tool.configs.find((config: Record<string, unknown>) => config.name === "trelloWriteChecklist");
  assert.deepEqual(checklist(before.trello), { name: "trelloWriteChecklist", enabled: false, permission_policy: { type: "always_allow" } });
  assert.deepEqual(checklist(after.trello), { name: "trelloWriteChecklist", enabled: true, permission_policy: { type: "always_ask" } });
  assert.deepEqual({ ...before.trello, configs: before.trello.configs.filter((c: Record<string, unknown>) => c.name !== "trelloWriteChecklist") },
    { ...after.trello, configs: after.trello.configs.filter((c: Record<string, unknown>) => c.name !== "trelloWriteChecklist") }, "every other Trello override and the default policy unchanged");
});

test("r27 (production until the r28 deploy, then the rollback) keeps the pre-#41 prompt and its six pins", () => {
  assert.equal(RELEASES.r27, RELEASE_R27);
  assert.equal(RELEASE_R27.agent.version, 27);
  assert.equal(RELEASE_R27.systemSha256, sha(PRE_41_SYSTEM_PROMPT));
  assert.deepEqual(surfaceOf(RELEASE_R27).tools, surfaceOf(RELEASE_R29).tools, "r27 → r29 keep the same tools and permission policies");
});

test("the declaration cannot silently fall back to r26 (#39 Stage 3B-3A)", () => {
  assert.notDeepEqual(declaredSurface, surfaceOf(RELEASE_R26), "djonik.md still declares r26");
  const trello = (declared.tools as Array<Record<string, any>>).find((tool) => tool.mcp_server_name === "trello")!;
  assert.equal(trello.default_config.permission_policy.type, "always_ask", "Trello fails closed for unreviewed tools");
  const policies = (tools: Array<Record<string, any>>) =>
    tools.flatMap((tool) => (tool.configs ?? []).filter((c: Record<string, any>) => c.permission_policy.type === "always_ask").map((c: Record<string, any>) => c.name));
  assert.deepEqual(policies(declared.tools as Array<Record<string, any>>), ["write", "edit", "trelloWriteCard", "trelloWriteChecklist"]);
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
  // #44: every reviewed release r25–r29 still pins specialist v4 (r29 is r30's rollback); r30 (#55) has none.
  assert.equal(RELEASE_R30.specialist, null);
  assert.equal(RELEASES.r31.specialist, null, "r31 (#64) keeps no specialist");
  assert.deepEqual(Object.values(RELEASES).filter((entry) => entry.specialist === null).map((entry) => entry.id), ["r30", "r31"]);
  for (const release of Object.values(RELEASES).filter((entry) => entry.specialist !== null)) {
    assert.ok(release.specialist, `${release.id} keeps its specialist`);
    assert.equal(release.specialist.id, PROJECT_HEALTH_SPECIALIST_AGENT_ID);
    const [pin] = release.specialist.skills;
    assert.match(specialistFrontmatter, new RegExp(`skill_id: ${pin.skillId}\\n\\s+version: ${pin.version}`));
  }
  const lock = JSON.parse(read("claude-lock.json"));
  assert.equal(lock.resources["./managed-agents/project-health-specialist.md"].version, String(RELEASE_R26.specialist!.version));
});

test("pinned Skill versions are the accepted repo Skills (recorded hashes in docs/42 and docs/32)", () => {
  const recorded: Record<string, string> = {
    "work-review": "c079d285",
  };
  for (const [name, prefix] of Object.entries(recorded)) {
    assert.ok(RELEASE_R26.skills.some((skill) => skill.name === name));
    // #62 edits work-review in source only (r31 candidate); the pinned bytes are the source minus that edit.
    assert.equal(sha(r30SkillSource(name)).slice(0, 8), prefix, `${name} repo source drifted from its pinned version`);
  }
  // task-management's older pin (r26–r28) was synced from `e994d31a…`; r29 pins the accepted #45 source.
  assert.ok(RELEASE_R26.skills.some((skill) => skill.name === "task-management"));
  assert.notEqual(sha(read(".claude", "skills", "task-management", "SKILL.md")), "aec09d5aa2b8170fe4f9d365a61484d1a1dc8b5e3b49a55382f3b014a8d70b7a", "#48 source is unsynced; r29 pin remains historical");
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
