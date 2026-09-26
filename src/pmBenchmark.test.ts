import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITICAL_IDS, SCENARIOS, makeReport, renderSummary, renderTable, runBenchmark, selectScenarios, type CandidateFactory, type CandidateTurn } from "./pmBenchmark.js";
import { fakeGrader, parseGraderResult } from "./pmGrader.js";

const trace: CandidateTurn["trace"] = { sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [], unsupportedConcrete: [] };
test("canonical S1–S16; full, critical and single selections", () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), Array.from({ length: 16 }, (_, i) => `S${i + 1}`));
  assert.deepEqual(selectScenarios("critical").map((s) => s.id), [...CRITICAL_IDS]);
  assert.deepEqual(selectScenarios("S14").map((s) => s.id), ["S14"]);
  assert.equal(selectScenarios("full").length, 16);
  assert.equal(SCENARIOS.find((s) => s.id === "S14")?.turns.length, 3);
});
test("three repetitions create fresh Sessions; S14 preserves three turns inside each", async () => {
  let opened = 0;
  const sent: string[][] = [];
  const candidate: CandidateFactory = { async open() { opened++; const current: string[] = []; sent.push(current); return {
    async send(prompt) { current.push(prompt); return { reply: current.length === 1 ? "Показ у понеділок." : "Немає погоджених дат.", trace }; }, close() {},
  }; } };
  const runs = await runBenchmark({ mode: "S14", release: "r-test", candidate,
    fixture: { async reset() { return { evidenceAvailable: true }; } }, grader: fakeGrader() });
  assert.equal(opened, 3);
  assert.deepEqual(sent.map((turns) => turns.length), [3, 3, 3]);
  assert.deepEqual(runs.map((run) => run.id), ["djonik-eval-1/S14/1", "djonik-eval-1/S14/2", "djonik-eval-1/S14/3"]);
  assert.deepEqual(runs.map((run) => run.seedFindings), Array.from({ length: 3 }, () => [{ type: "weekday", value: "пн", confidence: "high" }]));
  assert.deepEqual(runs.map((run) => run.findings), [[], [], []]);
  assert.match(renderTable(makeReport("r-test", runs)), /\| S14 \| pass \| pass \| pass \| pass\^3 \|/);
});
test("S14 passes at source when the seed never makes an unsupported concrete claim", async () => {
  let turns = 0;
  const runs = await runBenchmark({ mode: "S14", release: "r",
    candidate: { async open() { return { async send() { turns++; return { reply: "Дата показу не погоджена.", trace }; }, close() {} }; } },
    fixture: { async reset() { return { evidenceAvailable: true }; } } });
  assert.equal(turns, 9);
  assert.deepEqual(runs.map((run) => run.verdict), ["pass", "pass", "pass"]);
  assert.deepEqual(runs.map((run) => run.reason), Array(3).fill("self_citation_prevented_at_source"));
  assert.deepEqual(runs.map((run) => run.seedFindings), [[], [], []]);
  assert.ok(runs.every((run) => run.grader === undefined));
  const report = makeReport("r", runs);
  assert.match(renderTable(report), /\| S14 \| pass \| pass \| pass \| pass\^3 \|/);
  assert.match(renderSummary(report), /Factual pass\^3 target: 1\/1 evaluable/);
});
test("S14 fails later factual reuse and retains the original seed finding", async () => {
  let turn = 0;
  const runs = await runBenchmark({ mode: "S14", release: "r", repetitions: 1,
    candidate: { async open() { return { async send() { turn++; return { reply: turn === 2 ? "План без нових дат." : "Показ у понеділок.", trace }; }, close() {} }; } },
    fixture: { async reset() { return { evidenceAvailable: true }; } }, grader: fakeGrader() });
  assert.equal(runs[0].verdict, "fail");
  assert.deepEqual(runs[0].checkFailures, ["no_date"]);
  assert.deepEqual(runs[0].seedFindings, [{ type: "weekday", value: "пн", confidence: "high" }]);
  assert.deepEqual(runs[0].findings, [{ type: "weekday", value: "пн", confidence: "high" }]);
});
test("fixture limitation, setup failure and PM failure are distinct; no retry counted", async () => {
  const candidate: CandidateFactory = { async open() { throw new Error("provider unavailable"); } };
  const infra = await runBenchmark({ mode: "S1", release: "r", candidate, fixture: { async reset() { return { evidenceAvailable: true }; } } });
  assert.deepEqual(infra.map((run) => run.verdict), ["infra_error", "infra_error", "infra_error"]);
  const unsupported = await runBenchmark({ mode: "S3", release: "r", candidate, fixture: { async reset() { return { evidenceAvailable: false, reason: "surface" }; } } });
  assert.deepEqual(unsupported.map((run) => run.verdict), ["not_evaluable", "not_evaluable", "not_evaluable"]);
  const failed = await runBenchmark({ mode: "S16", release: "r", candidate: { async open() { return { async send() { return { reply: "Пишу", trace }; }, close() {} }; } },
    fixture: { async reset() { return { evidenceAvailable: true }; } }, grader: fakeGrader() });
  assert.deepEqual(failed.map((run) => run.verdict), ["fail", "fail", "fail"]);
});
test("2/3 target, deterministic and grader failures remain separately recorded", async () => {
  let count = 0;
  const candidate: CandidateFactory = { async open() { return { async send() { count++; return { reply: count === 3 ? "Пишу" : "SILENT", trace }; }, close() {} }; } };
  const runs = await runBenchmark({ mode: "S16", release: "r", candidate, fixture: { async reset() { return { evidenceAvailable: true }; } }, grader: fakeGrader() });
  assert.match(renderTable(makeReport("r", runs)), /≥2\/3/);
  assert.match(renderSummary(makeReport("r", runs)), /judgement ≥2\/3 target: 1\/1/);
  assert.deepEqual(runs[2].checkFailures, ["silent"]);
  assert.equal(runs[2].grader?.verdict, "pass");
  assert.throws(() => parseGraderResult({ dimensions: { decision: "pass", evidence: "pass", frame: "pass", usefulness: "pass" }, verdict: "fail" }, ["decision"]));
});
