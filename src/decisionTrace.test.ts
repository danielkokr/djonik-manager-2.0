import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionTraceCollector, explainRecordedTurn } from "./decisionTrace.js";
import { renderExplanation } from "./turnExplain.js";

test("Skill, Memory read/write, authoritative card input and ledger status only", () => {
  const trace = new DecisionTraceCollector(2, "[Годинник адаптера · пн 28.09]");
  trace.builtIn("read", { file_path: "/workspace/skills/planning-and-focus/SKILL.md" });
  trace.builtIn("read", { file_path: "/mnt/memory/djonik/projects/seqthera.md" });
  trace.builtIn("write", { file_path: "/mnt/memory/djonik/rhythm.md", content: "SECRET CLIENT" });
  trace.mcp("trello", "trelloReadCard", { cardIdOrUrl: "card_A", query: "SECRET CLIENT" });
  trace.mcp("trello", "trelloWriteCard", { cardId: "card_A", name: "SECRET CLIENT" });
  const summary = trace.finish([{ toolUseId: "w", status: "verified", targetCardIds: ["card_A"], label: null, unconfirmedFields: [], superseded: false }]);
  assert.deepEqual(summary.skillPaths, ["planning-and-focus"]);
  assert.deepEqual(summary.memoryPathsRead, ["projects/seqthera.md"]);
  assert.deepEqual(summary.memoryPathsWritten, ["rhythm.md"]);
  assert.deepEqual(summary.cardIdsRead, ["card_A"]);
  assert.deepEqual(summary.mutations, [{ cardIds: ["card_A"], status: "verified" }]);
  assert.doesNotMatch(JSON.stringify(summary), /SECRET CLIENT|\/mnt\/memory|\/workspace/);
});
test("recorded provider events explain one completed turn, ignore nudge and all prose", () => {
  const events = [
    { type: "user.message", content: [{ text: "[Годинник адаптера, не текст Daniel · Зараз: пн 28.09]" }] },
    { type: "agent.message", content: [{ text: "SECRET CLIENT" }] },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
    { type: "user.message", content: [{ text: "[Годинник адаптера, не текст Daniel · Зараз: пн 28.09]" }] },
    { type: "agent.tool_use", name: "read", input: { file_path: "/workspace/skills/pm-rhythm/SKILL.md" } },
    { type: "user.message", content: [{ text: "Системна перевірка: у цьому turn є Trello-запис" }] },
    { type: "agent.message", content: [{ text: "SECRET CLIENT" }] },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  const explanation = renderExplanation(explainRecordedTurn(events, 2), "sesn_test", 2);
  assert.match(explanation, /Skills: pm-rhythm/);
  assert.match(explanation, /turn 2/);
  assert.doesNotMatch(explanation, /SECRET CLIENT/);
  assert.match(renderExplanation(null, "sesn_test", 3), /unknown/);
});
test("explain includes the verification nudge before the next visible turn", () => {
  const card = { id: "card_A", name: "A" };
  const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: "agent.mcp_tool_use", id, mcp_server_name: "trello", name, input });
  const result = (id: string) => ({ type: "agent.mcp_tool_result", mcp_tool_use_id: id, content: [{ type: "text", text: JSON.stringify(card) }] });
  const events = [
    { type: "user.message", content: [{ text: "[Годинник адаптера · пн]" }] },
    use("w", "trelloWriteCard", { action: "update", cardId: "card_A", name: "A" }), result("w"),
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
    { type: "user.message", content: [{ text: "Системна перевірка: у цьому turn є Trello-запис" }] },
    use("r", "trelloReadCard", { action: "get", cardIdOrUrl: "card_A" }), result("r"),
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
    { type: "user.message", content: [{ text: "[Годинник адаптера · вт]" }] },
  ];
  const first = explainRecordedTurn(events, 1);
  assert.deepEqual(first?.mutations, [{ cardIds: ["card_A"], status: "verified" }]);
  assert.equal(first?.sessionTurnIndex, 1);
  assert.equal(explainRecordedTurn(events, 2), null, "second visible turn has not completed");
});
