import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCustomToolRouter, SUPPORTED_CLIENT_CUSTOM_TOOLS, type CustomToolCallContext } from "./djonikClient.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

// #50 regression: the serving adapter used to route every non-reminder custom tool to trello_work_history, so the r30
// candidate's trello_board_snapshot would have run the wrong executor. Each tool now reaches exactly its own executor.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function recordingRouter() {
  const calls: string[] = [];
  const executor = (label: string) => async (input: unknown, context?: { toolUseId: string; authority: string }) => {
    calls.push(`${label}:${JSON.stringify(input)}${context ? `:${context.toolUseId}:${context.authority}` : ""}`);
    return { isError: false, content: label };
  };
  const route = createCustomToolRouter({
    workHistory: executor("history"), boardSnapshot: executor("snapshot"), reminder: executor("reminder"), focusBudget: executor("focus"),
  });
  return { calls, route };
}

const context = (name: string): CustomToolCallContext => ({ name, toolUseId: `toolu_${name}`, authority: "human" });

test("each supported custom tool routes to its own executor, with id and authority for side-effecting ones", async () => {
  const { calls, route } = recordingRouter();
  const expected: Record<string, string> = { trello_work_history: "history", trello_board_snapshot: "snapshot", reminder: "reminder", focus_budget: "focus" };
  assert.deepEqual([...SUPPORTED_CLIENT_CUSTOM_TOOLS].sort(), Object.keys(expected).sort());
  assert.deepEqual(Object.keys(SUPPORTED_CUSTOM_TOOLS).sort(), Object.keys(expected).sort());
  for (const [name, label] of Object.entries(expected)) assert.equal((await route({ x: 1 }, context(name))).content, label, name);
  assert.deepEqual(calls, [
    'history:{"x":1}', 'snapshot:{"x":1}', 'reminder:{"x":1}:toolu_reminder:human', 'focus:{"x":1}:toolu_focus_budget:human',
  ]);
});

test("an unknown tool fails closed: no executor runs, and it never becomes work history", async () => {
  const { calls, route } = recordingRouter();
  const result = await route({ window: { kind: "this_week" } }, context("trello_board_snapshot_v2"));
  assert.equal(result.isError, true);
  assert.match(result.content, /"code":"unknown_tool"/);
  assert.deepEqual(calls, []);
});

test("side-effecting tools without a bound executor are unavailable, never silently promised", async () => {
  const route = createCustomToolRouter({ workHistory: async () => ({ isError: false, content: "history" }) });
  for (const name of ["reminder", "focus_budget"]) {
    const result = await route({}, context(name));
    assert.equal(result.isError, true);
    assert.match(result.content, /"code":"unavailable"/);
  }
});

test("the serving adapter uses the shared router, not a name-agnostic fallback", () => {
  const cli = readFileSync(join(repoRoot, "src", "telegramCli.ts"), "utf8");
  assert.match(cli, /createCustomToolRouter\(\{ reminder: reminderExecutor, focusBudget: focusBudgetExecutor \}\)/);
  assert.doesNotMatch(cli, /executeTrelloWorkHistoryFromEnvironment/);
});
