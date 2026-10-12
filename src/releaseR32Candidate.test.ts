import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R31, RELEASE_R31_CANDIDATE, RELEASE_R32_CANDIDATE, RELEASES, CHANGED_BY_R32, UnresolvedReleaseCandidateError, resolveReleaseCandidate, type DjonikRelease } from "./release.js";
import { CUSTOM_TOOL_REVISIONS, SUPPORTED_CUSTOM_TOOLS, attestAgentVersion, canonicalJsonSha256, customToolDefinition, normalizeAgentConfig, sha256 } from "./releaseAttestation.js";
import { buildAgentUpdateBody, buildCandidateUpdateBody } from "./releasePlan.js";
import { REMINDER_TOOL } from "./reminderTool.js";
import { TRELLO_WORK_HISTORY_TOOL, TRELLO_WORK_HISTORY_TOOL_NEXT } from "./trelloWorkHistory.js";
import { SOURCE_SYSTEM_PROMPT, agentVersionFixture } from "./releaseFixtures.test-helpers.js";

// #70 (docs/110): the r32 candidate is r31 plus exactly the accepted, still-unreleased Agent surface of #66–#69 — three
// Skills, revision v2 of the existing trello_work_history definition and the #54 reminder tool. #71 is application
// runtime only and adds nothing here. Zero network: the pins below are placeholders of the right shape, never sent.

const PLACEHOLDER = Object.fromEntries(
  CHANGED_BY_R32.map((name, index) => [name, { skillId: RELEASE_R31.skills.find((skill) => skill.name === name)!.skillId, version: `skver_placeholder${index}` }]),
);
const body = () => buildCandidateUpdateBody(RELEASE_R32_CANDIDATE, { skills: PLACEHOLDER });
const toolsByKey = (tools: unknown) => Object.fromEntries((tools as Array<Record<string, any>>).map((tool) => [tool.name ?? tool.mcp_server_name ?? tool.type, tool]));

test("r32 candidate: unresolved, not a release, updates Agent v31 of the same coordinator", () => {
  assert.deepEqual(RELEASE_R32_CANDIDATE.agent, { id: RELEASE_R31.agent.id, fromVersion: 31, version: null });
  assert.equal(RELEASE_R32_CANDIDATE.becomes, "r32");
  assert.ok(!Object.values(RELEASES).includes(RELEASE_R32_CANDIDATE as never));
  assert.throws(() => resolveReleaseCandidate(RELEASE_R32_CANDIDATE, { skills: {}, agentVersion: 32 }), UnresolvedReleaseCandidateError);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R32_CANDIDATE, { skills: {} }), UnresolvedReleaseCandidateError, "no body with a placeholder Skill");
});

test("r32 candidate Skills: exactly work-review, pm-rhythm and planning-and-focus are unresolved; the other two are r31's pins", () => {
  assert.deepEqual(RELEASE_R32_CANDIDATE.skills.map((skill) => skill.name), RELEASE_R31.skills.map((skill) => skill.name), "same five Skills, same order");
  const unresolved = RELEASE_R32_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").map((skill) => skill.name);
  assert.deepEqual(unresolved.sort(), ["planning-and-focus", "pm-rhythm", "work-review"]);
  for (const name of ["task-management", "studio-intake"]) {
    assert.deepEqual(RELEASE_R32_CANDIDATE.skills.find((skill) => skill.name === name), RELEASE_R31.skills.find((skill) => skill.name === name), `${name}: r31 pin reused unchanged`);
  }
});

test("r32 candidate keeps every other r31 field: prompt, model, built-ins, MCP, policies, roster, Session resources", () => {
  for (const key of ["model", "systemSha256", "builtInTools", "mcpServers", "mcpToolsets", "confirmationRequired", "session", "specialist"] as const) {
    assert.deepEqual(RELEASE_R32_CANDIDATE[key], RELEASE_R31[key], `${key} is r31's`);
  }
  assert.equal(RELEASE_R32_CANDIDATE.systemSha256, sha256(SOURCE_SYSTEM_PROMPT), "the committed managed-agents/djonik.md body is still the r31 prompt");
  assert.equal(RELEASE_R32_CANDIDATE.session.memoryAccess, "read_write");
  // No field beyond the r31 candidate's shape except the per-release tool revision: #71 added nothing to the tuple.
  assert.deepEqual(Object.keys(RELEASE_R32_CANDIDATE).sort(), [...Object.keys(RELEASE_R31_CANDIDATE), "customToolRevisions"].sort());
});

test("r32 candidate custom tools: the four r31 tools in order, plus `reminder` exactly once", () => {
  assert.deepEqual(RELEASE_R32_CANDIDATE.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget", "trello_project_time", "reminder"]);
  assert.equal(RELEASE_R32_CANDIDATE.customTools.filter((name) => name === "reminder").length, 1);
  assert.ok(!RELEASE_R31.customTools.includes("reminder"), "r31 stays without reminder");
  assert.deepEqual(RELEASE_R32_CANDIDATE.customToolRevisions, { trello_work_history: "v2" }, "one tool changes its definition, under its own name");
});

test("per-release tool definitions: r32 selects the final #66/#69 trello_work_history, every reviewed release keeps the original", () => {
  assert.equal(customToolDefinition(RELEASE_R32_CANDIDATE, "trello_work_history"), TRELLO_WORK_HISTORY_TOOL_NEXT);
  assert.equal(CUSTOM_TOOL_REVISIONS.trello_work_history.v2, TRELLO_WORK_HISTORY_TOOL_NEXT);
  assert.equal(TRELLO_WORK_HISTORY_TOOL_NEXT.name, TRELLO_WORK_HISTORY_TOOL.name, "the same tool, not a second name");
  assert.deepEqual(Object.keys(SUPPORTED_CUSTOM_TOOLS).filter((name) => name.includes("work_history")), ["trello_work_history"]);
  for (const release of Object.values(RELEASES).filter((entry) => entry.agent.version <= 31)) {
    assert.equal(release.customToolRevisions, undefined, `${release.id} names no revision`);
    if (release.customTools.includes("trello_work_history")) assert.equal(customToolDefinition(release, "trello_work_history"), TRELLO_WORK_HISTORY_TOOL, release.id);
  }
  // The frozen original, as Agent v26–v31 store it (docs/102 §13), and the v2 that differs from it.
  assert.equal(canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL.input_schema).slice(0, 8), "dcf09961");
  assert.equal(sha256(TRELLO_WORK_HISTORY_TOOL.description).slice(0, 8), "b7622094");
  assert.notEqual(canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema), canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL.input_schema));
  assert.deepEqual((TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema.properties as Record<string, any>).focus, { enum: ["overview", "completed", "returned", "created", "archived", "moved"] });
  assert.match(TRELLO_WORK_HISTORY_TOOL_NEXT.description, /`focus`/);
  assert.match(TRELLO_WORK_HISTORY_TOOL_NEXT.description, /«N карток» is unique cards and «переходів»\/«подій» is Done transitions/, "#69 wording, not an intermediate #66-only text");
  // Every other tool has one definition only.
  for (const name of ["trello_board_snapshot", "focus_budget", "trello_project_time", "reminder"]) {
    assert.equal(customToolDefinition(RELEASE_R32_CANDIDATE, name), SUPPORTED_CUSTOM_TOOLS[name], name);
  }
  assert.equal(customToolDefinition(RELEASE_R32_CANDIDATE, "reminder"), REMINDER_TOOL, "the executable #54 definition itself");
});

test("the v31 → v32 update body: Skills and tools only — no prompt, model, roster or MCP server change", () => {
  const update = body();
  assert.equal(update.version, 31, "optimistic-concurrency precondition on Agent v31");
  assert.deepEqual(Object.keys(update).sort(), ["skills", "tools", "version"]);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R32_CANDIDATE, { skills: PLACEHOLDER }, SOURCE_SYSTEM_PROMPT), /do not send `system`/);
  const r31Body = buildAgentUpdateBody(RELEASE_R31, 30);
  const pins = (skills: unknown) => (skills as Array<Record<string, string>>).map((skill) => `${skill.skill_id}@${skill.version}`);
  assert.deepEqual((update.skills as Array<Record<string, string>>).map((skill) => skill.skill_id), (r31Body.skills as Array<Record<string, string>>).map((skill) => skill.skill_id), "no new Skill identity");
  const moved = RELEASE_R31.skills.filter((_skill, index) => pins(update.skills)[index] !== pins(r31Body.skills)[index]).map((skill) => skill.name);
  assert.deepEqual(moved.sort(), ["planning-and-focus", "pm-rhythm", "work-review"]);
  const [before, after] = [toolsByKey(r31Body.tools), toolsByKey(update.tools)];
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual(changed.sort(), ["reminder", "trello_work_history"], "built-in toolset, Trello toolset/policies and three custom tools byte-identical");
  assert.deepEqual((update.tools as Array<Record<string, any>>).filter((tool) => tool.type === "custom").map((tool) => tool.name), RELEASE_R32_CANDIDATE.customTools);
});

test("the body's two changed tools are the executable source definitions, byte for byte", () => {
  const tools = toolsByKey(body().tools);
  assert.deepEqual(tools.trello_work_history, { type: "custom", name: "trello_work_history", description: TRELLO_WORK_HISTORY_TOOL_NEXT.description, input_schema: TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema });
  assert.deepEqual(tools.reminder, { type: "custom", name: "reminder", description: REMINDER_TOOL.description, input_schema: REMINDER_TOOL.input_schema });
  assert.equal(JSON.stringify(tools.reminder.input_schema), JSON.stringify(REMINDER_TOOL.input_schema));
});

test("attestation is per release: v31 attests only with the original definition, a v32-shaped Agent only with v2 + reminder", () => {
  const r32 = resolveReleaseCandidate(RELEASE_R32_CANDIDATE, { skills: PLACEHOLDER, agentVersion: 32 });
  const v31 = agentVersionFixture(RELEASE_R31) as Record<string, any>;
  const update = body();
  const v32 = { ...v31, version: 32, skills: update.skills, tools: update.tools };
  assert.doesNotThrow(() => attestAgentVersion(RELEASE_R31, v31), "historical r31 is untouched");
  assert.doesNotThrow(() => attestAgentVersion(r32, v32));
  assert.throws(() => attestAgentVersion(RELEASE_R31, v32), /custom tools/);
  assert.throws(() => attestAgentVersion(r32, v31), /custom tools/);
  // The same Agent with only the tool definition swapped: each release rejects the other's definition.
  const swap = (agent: Record<string, any>, definition: { description: string; input_schema: unknown }) => ({
    ...agent,
    tools: agent.tools.map((tool: Record<string, unknown>) => (tool.name === "trello_work_history" ? { ...tool, ...definition } : tool)),
  });
  assert.throws(() => attestAgentVersion(RELEASE_R31, swap(v31, TRELLO_WORK_HISTORY_TOOL_NEXT)), /custom tool trello_work_history (schema|description)/);
  assert.throws(() => attestAgentVersion(r32, swap(v32, TRELLO_WORK_HISTORY_TOOL)), /custom tool trello_work_history (schema|description)/);
  const observed = normalizeAgentConfig(v32).customTools;
  assert.equal(observed.filter((tool) => tool.name === "reminder").length, 1);
  assert.equal(observed.length, 5);
});

test("an unknown or misplaced tool revision fails closed, in attestation and in the update body", () => {
  const v31 = agentVersionFixture(RELEASE_R31);
  const unknown: DjonikRelease = { ...RELEASE_R31, customToolRevisions: { trello_work_history: "v9" } };
  assert.equal(customToolDefinition(unknown, "trello_work_history"), undefined);
  assert.throws(() => attestAgentVersion(unknown, v31), /revision v9 is not a reviewed definition/);
  assert.throws(() => buildAgentUpdateBody(unknown, 31), /No reviewed definition of custom tool trello_work_history/);
  const misplaced: DjonikRelease = { ...RELEASE_R31, customToolRevisions: { reminder: "v2" } };
  assert.throws(() => attestAgentVersion(misplaced, v31), /revision names reminder, which the release does not expose/);
});
