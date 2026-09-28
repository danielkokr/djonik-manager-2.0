import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R29, RELEASE_R30_CANDIDATE, RELEASES, SERVING_RELEASE, UnresolvedReleaseCandidateError } from "./release.js";
import { buildCandidateUpdateBody } from "./releasePlan.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

test("#47/#48/#50 candidate preserves immutable r29 and remains unresolved", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R29);
  assert.equal(RELEASES.r29, RELEASE_R29);
  assert.equal(RELEASES.r30, undefined);
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
  } });
  assert.equal(body.version, 29);
  assert.deepEqual((body.mcp_servers as Array<{ name: string }>).map((server) => server.name), ["trello"]);
  assert.deepEqual((body.tools as Array<{ type: string; name?: string; mcp_server_name?: string }>).filter((tool) => tool.type === "custom").map((tool) => tool.name), ["trello_work_history", "trello_board_snapshot", "focus_budget"]);
  assert.ok(!(body.tools as Array<{ name?: string }>).some((tool) => tool.name === "reminder"));
  assert.equal(body.system, undefined);
  assert.equal(SUPPORTED_CUSTOM_TOOLS.trello_board_snapshot?.description.length > 0, true);
});

test("#50: focus_budget exists only on the unresolved candidate; r25–r29 and the serving release never expose it", async () => {
  const { RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28 } = await import("./release.js");
  for (const release of [RELEASE_R25, RELEASE_R26, RELEASE_R27, RELEASE_R28, RELEASE_R29, SERVING_RELEASE]) {
    assert.ok(!release.customTools.includes("focus_budget"), release.id);
  }
  assert.equal(SERVING_RELEASE.id, "r29");
  assert.ok(RELEASE_R30_CANDIDATE.customTools.includes("focus_budget"));
  assert.ok(!RELEASE_R30_CANDIDATE.customTools.includes("reminder"), "reminder stays dormant");
  assert.equal(RELEASE_R30_CANDIDATE.agent.version, null, "no invented Agent v30");
  assert.ok(RELEASE_R30_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").every((skill) => skill.skillId === null), "no invented remote Skill ids");
  assert.deepEqual(RELEASE_R30_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved").map((skill) => skill.name).sort(), ["planning-and-focus", "pm-rhythm", "studio-intake", "task-management"]);
  const body = buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, { skills: Object.fromEntries(["planning-and-focus", "pm-rhythm", "task-management", "studio-intake"].map((name) => [name, { skillId: `skill_TEST${name.length}`, version: "skver_TEST" }])) });
  const focus = (body.tools as Array<{ type: string; name?: string; input_schema?: unknown }>).find((tool) => tool.name === "focus_budget");
  assert.deepEqual(focus?.input_schema, SUPPORTED_CUSTOM_TOOLS.focus_budget.input_schema);
});
