import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRELLO_WORK_HISTORY_TOOL } from "./trelloWorkHistory.js";
import {
  WORK_REVIEW_RUBRIC,
  extractEvidenceTrace,
  gradeEvidenceAcquisition,
  lintWorkReviewAnswer,
} from "./workReviewRubric.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(root, ".claude", "skills", "work-review", "SKILL.md"), "utf8");

// #29's rubric/source remains historical evidence. These assertions replace only its now-superseded
// current-state Skill contract with #36's action-history tool contract.
test("#36 work-review Skill is thin, history-first, actor-safe and read-only", () => {
  assert.ok(Buffer.byteLength(skill, "utf8") <= 3 * 1024);
  assert.match(skill, /trello_work_history/);
  assert.match(skill, /2–4 concise Ukrainian sentences/);
  assert.match(skill, /на дошці перейшло в Done/);
  assert.match(skill, /not «ти зробив» or «Daniel завершив»/);
  assert.match(skill, /coverage/i);
  assert.match(skill, /Project Health remains its own capability/);
  assert.match(skill, /history is unavailable/i);
  assert.match(skill, /Do not write Trello, Calendar, or Memory/);
  assert.doesNotMatch(skill, /lastActivityAt/);
  assert.match(skill, /Do not make Project Health judgements, productivity scores, effort\/time claims, trend analysis/i);
});

test("#36 exports one bounded custom-tool schema with semantic window, scope and format inputs", () => {
  assert.equal(TRELLO_WORK_HISTORY_TOOL.type, "custom");
  assert.equal(TRELLO_WORK_HISTORY_TOOL.name, "trello_work_history");
  assert.match(TRELLO_WORK_HISTORY_TOOL.description, /read-only/i);
  const schema = JSON.stringify(TRELLO_WORK_HISTORY_TOOL.input_schema);
  for (const token of ["this_week", "last_week", "explicit", "from", "to", "project", "board", "response_format", "concise", "detailed"]) {
    assert.ok(schema.includes(token), `schema must include ${token}`);
  }
  assert.doesNotMatch(schema, /http|endpoint|url|api_key/i);
});

// These are deliberately retained from #29 as source-level regression helpers. They no longer
// prescribe the superseded current-state Skill wording, but stay useful for historical evaluation
// artifacts and must not silently lose their independent mechanics.
test("historical work-review rubric keeps all named dimensions and model-neutral severity metadata", () => {
  assert.deepEqual(WORK_REVIEW_RUBRIC.map((dimension) => dimension.id), Array.from({ length: 16 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`));
  assert.ok(WORK_REVIEW_RUBRIC.every((dimension) => dimension.severity === "critical" || dimension.severity === "major"));
});

test("historical lint helper flags unsupported chronology but leaves a human-readable due date to factual review", () => {
  const flags = lintWorkReviewAnswer("Остання закрита картка була вчора. Дедлайн: 21 вересня.");
  assert.ok(flags.some((flag) => flag.dimension === "R01"));
  assert.ok(!flags.some((flag) => flag.dimension === "R03"));
});

test("historical fresh-evidence trace counts only Trello discovery before the final message", () => {
  const trace = extractEvidenceTrace([
    { type: "agent.tool_use", name: "read", input: {} },
    { type: "agent.mcp_tool_use", mcp_server_name: "trello", name: "trelloReadBoard" },
    { type: "agent.message", content: [{ type: "text", text: "Уточнити?" }] },
    { type: "agent.mcp_tool_use", mcp_server_name: "trello", name: "trelloReadCard" },
  ]);
  assert.deepEqual(trace.trelloDiscoveryToolNames, ["trelloReadBoard"]);
  assert.equal(trace.finalMessageAsksQuestion, true);
});

test("historical fresh-evidence grader rejects a premature clarification and accepts a discovered ambiguity", () => {
  const premature = gradeEvidenceAcquisition({
    entityNamed: true,
    exactIdentitySupplied: false,
    discoveryAvailable: true,
    trace: { trelloDiscoveryCalls: 0, trelloDiscoveryToolNames: [], finalMessage: "Уточнити?", finalMessageAsksQuestion: true },
  });
  assert.equal(premature.verdict, "FAIL");
  const discovered = gradeEvidenceAcquisition({
    entityNamed: true,
    exactIdentitySupplied: false,
    discoveryAvailable: true,
    discoveryOutcome: "multiple_matches",
    trace: { trelloDiscoveryCalls: 1, trelloDiscoveryToolNames: ["trelloReadBoard"], finalMessage: "Уточнити?", finalMessageAsksQuestion: true },
  });
  assert.equal(discovered.verdict, "PASS");
});
