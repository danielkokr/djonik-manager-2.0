import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITICAL_IDS, EVAL_TIME_BLOCK, SCENARIOS, makeReport, renderSummary, renderTable, runBenchmark, selectScenarios, type CandidateFactory, type CandidateTurn } from "./pmBenchmark.js";
import { fakeGrader, parseGraderResult } from "./pmGrader.js";
import { cardsForScenario, memoriesForScenario } from "./pmFixture.js";

const trace: CandidateTurn["trace"] = { sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [], unsupportedConcrete: [] };
test("canonical S1–S16 retained; #48 appends S17–S21; #50 appends S22–S25", () => {
  assert.deepEqual(SCENARIOS.slice(0, 16).map((s) => s.id), Array.from({ length: 16 }, (_, i) => `S${i + 1}`));
  assert.deepEqual(SCENARIOS.slice(16, 21).map((s) => s.id), ["S17", "S18", "S19", "S20", "S21"]);
  assert.deepEqual(SCENARIOS.slice(21).map((s) => s.id), ["S22", "S23", "S24", "S25"]);
  assert.deepEqual(selectScenarios("critical").map((s) => s.id), [...CRITICAL_IDS]);
  assert.deepEqual(selectScenarios("S14").map((s) => s.id), ["S14"]);
  assert.equal(selectScenarios("full").length, 25);
  assert.equal(SCENARIOS.find((s) => s.id === "S14")?.turns.length, 3);
});
test("#48 offline fixtures preserve source attribution, exact link and two plausible card targets", () => {
  const scenario = (id: string) => SCENARIOS.find((entry) => entry.id === id)!;
  assert.equal(scenario("S17").origin, "forwarded_source");
  assert.match(scenario("S17").turns[0], /від: Анна.*Чекаю до пт 2\.10 18:00/su);
  assert.match(scenario("S18").turns[0], /зробіть яскравіше/u);
  assert.deepEqual(cardsForScenario(scenario("S19")).filter((card) => card.project === "Azov" && card.title.includes("банер")).map((card) => card.key),
    ["az-banner-a", "az-banner-b"]);
  assert.deepEqual(scenario("S19").checks.includes("zero_write"), true);
  assert.match(scenario("S20").turns[0], /https:\/\/drive\.google\.com\/file\/d\/eval-brief\/view/u);
  assert.deepEqual(scenario("S21").checks.includes("zero_write"), true);
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
test("S3/S8/S10 require observed snapshot evidence before behavioural grading", async () => {
  for (const id of ["S3", "S8", "S10"] as const) {
    const runs = await runBenchmark({ mode: id, release: "offline", repetitions: 1,
      candidate: { async open() { return { async send() { return { reply: "Some recommendation", trace }; }, close() {} }; } },
      fixture: { async reset() { return { evidenceAvailable: true }; } }, grader: fakeGrader() });
    assert.equal(runs[0].verdict, "not_evaluable");
    assert.equal(runs[0].reason, "snapshot_not_observed");
  }
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

test("#50 S22–S25: runtime-built prompts, fixtures and mechanical checks (no paid run, no pass^3 claim)", async () => {
  const scenario = (id: string) => SCENARIOS.find((entry) => entry.id === id)!;
  assert.equal(scenario("S22").origin, "rhythm_exception");
  assert.match(scenario("S22").turns[0], /бюджет Daniel 2 год робочого часу вичерпано пн 28\.09, 12:00/);
  assert.match(scenario("S22").turns[0], /чи варто Daniel зараз змінити, що він робить/);
  assert.equal(cardsForScenario(scenario("S22")).find((card) => card.key === "cl-deck")?.due, undefined, "nothing competes in S22");
  assert.match(memoriesForScenario(scenario("S23"))["/commitments/cossack-labs.md"], /Cossack Labs deck.*29 September 2026/);
  assert.equal(scenario("S24").origin, "forwarded_source");
  assert.equal(scenario("S25").origin, "rhythm_ritual");
  assert.ok(scenario("S25").turns[0].includes(EVAL_TIME_BLOCK), "the model sees the code block it must not restate");
  assert.match(scenario("S25").turns[0], /пʼятничний огляд/);

  const verdicts = async (id: string, reply: string) => (await runBenchmark({ mode: id as `S${number}`, release: "r-test", repetitions: 1, grader: fakeGrader(),
    fixture: { async reset() { return { evidenceAvailable: true }; } },
    candidate: { async open() { return { async send() { return { reply, trace }; }, close() {} }; } } }))[0];
  assert.equal((await verdicts("S22", "SILENT")).checkFailures.length, 0);
  assert.equal((await verdicts("S22", "⏱ Бюджет минув, але концепт і далі головне.\nПродовжуй?")).checkFailures.length, 0);
  assert.deepEqual((await verdicts("S22", Array.from({ length: 6 }, (_, i) => `рядок ${i}`).join("\n"))).checkFailures, ["silent_or_short"]);
  assert.deepEqual((await verdicts("S23", "SILENT")).checkFailures, ["non_silent"]);
  assert.deepEqual((await verdicts("S24", Array.from({ length: 10 }, (_, i) => `рядок ${i}`).join("\n"))).checkFailures, ["delta"]);
  assert.deepEqual((await verdicts("S25", "⏸ Не рухалось: сайт Limen.\n💭 Seqthera — 14 год, це половина тижня.")).checkFailures, ["no_hours_restated"]);
  assert.equal((await verdicts("S25", "⏸ Не рухалось: сайт Limen.\n💭 Seqthera з'їла найбільше часу — варто обговорити бюджет.")).checkFailures.length, 0);
});
