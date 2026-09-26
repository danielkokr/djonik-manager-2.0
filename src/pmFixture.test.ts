import { test } from "node:test";
import assert from "node:assert/strict";
import { EVAL_CARDS, EVAL_MEMORIES, cardsForScenario, memoriesForScenario, resetEvalFixture, type EvalBoardDriver } from "./pmFixture.js";
import { SCENARIOS } from "./pmBenchmark.js";
import { TrelloEvalBoardDriver } from "./pmTrelloFixture.js";

test("fixture identities and memory are dedicated and stable", () => {
  assert.equal(EVAL_CARDS.length, 15);
  assert.equal(new Set(EVAL_CARDS.map((card) => card.key)).size, 15);
  assert.equal(EVAL_CARDS.filter((card) => card.title.includes("банер збору")).length, 2);
  assert.ok(EVAL_CARDS.some((card) => card.checklist?.done === 4 && card.checklist.total === 5));
  assert.ok(EVAL_CARDS.some((card) => card.size === "XL"));
  assert.equal(cardsForScenario(SCENARIOS[0]).filter((card) => card.list === "In progress").length, 3);
  assert.ok(cardsForScenario(SCENARIOS[1]).every((card) => card.size === undefined));
  assert.ok(cardsForScenario(SCENARIOS[2]).some((card) => card.size === "XL"));
  assert.ok(Object.keys(EVAL_MEMORIES).includes("/commitments/seqthera.md"));
  assert.ok(memoriesForScenario(SCENARIOS[5])["/commitments/extract.md"].includes("Monday"));
  assert.equal(memoriesForScenario(SCENARIOS[12])["/commitments/seqthera.md"], undefined);
});
test("reset verifies board and card postconditions; old Waiting age remains an honest limitation", async () => {
  const calls: string[] = [];
  const driver: EvalBoardDriver = {
    async assertDedicatedBoard() { calls.push("board"); }, async ensureLists() { calls.push("lists"); },
    async ensureProjectLabels() { calls.push("labels"); }, async ensureSizeField() { calls.push("size"); },
    async resetCards() { calls.push("cards"); }, async verify() { calls.push("verify"); },
    async waitingEnteredAt() { return null; },
  };
  const result = await resetEvalFixture(driver, SCENARIOS[9]);
  assert.deepEqual(calls, ["board", "lists", "labels", "size", "cards", "verify"]);
  assert.deepEqual(result, { evidenceAvailable: false, reason: "waiting_age_not_established" });
});
test("Trello driver rejects a non-eval board before any write", async () => {
  const methods: string[] = [];
  const fetcher = async (_url: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return new Response(JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Production", closed: false }), { status: 200 });
  };
  const driver = new TrelloEvalBoardDriver({ boardId: "aaaaaaaaaaaaaaaaaaaaaaaa", apiKey: "fake", token: "fake", fetcher: fetcher as typeof fetch });
  await assert.rejects(driver.assertDedicatedBoard("Djonik Eval"));
  assert.deepEqual(methods, ["GET"]);
});
