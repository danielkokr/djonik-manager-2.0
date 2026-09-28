import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_R29, RELEASE_R30_CANDIDATE, RELEASES, SERVING_RELEASE, UnresolvedReleaseCandidateError } from "./release.js";
import { buildCandidateUpdateBody } from "./releasePlan.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

test("#47 candidate preserves immutable r29 and remains unresolved", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R29);
  assert.equal(RELEASES.r29, RELEASE_R29);
  assert.equal(RELEASES.r30, undefined);
  assert.deepEqual(RELEASE_R29.customTools, ["trello_work_history"]);
  assert.ok(RELEASE_R29.mcpServers.some((server) => server.name === "google-calendar-calendarmcp"));
  assert.deepEqual(RELEASE_R30_CANDIDATE.customTools, ["trello_work_history", "trello_board_snapshot"]);
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
  assert.deepEqual((body.tools as Array<{ type: string; name?: string; mcp_server_name?: string }>).filter((tool) => tool.type === "custom").map((tool) => tool.name), ["trello_work_history", "trello_board_snapshot"]);
  assert.ok(!(body.tools as Array<{ name?: string }>).some((tool) => tool.name === "reminder"));
  assert.equal(body.system, undefined);
  assert.equal(SUPPORTED_CUSTOM_TOOLS.trello_board_snapshot?.description.length > 0, true);
});
