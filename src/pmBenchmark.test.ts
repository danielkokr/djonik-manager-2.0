import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITICAL_IDS, EVAL_TIME_BLOCK, SCENARIOS, makeReport, renderSummary, renderTable, runBenchmark, selectScenarios, type CandidateFactory, type CandidateTurn } from "./pmBenchmark.js";
import { fakeGrader, parseGraderResult } from "./pmGrader.js";
import { cardsForScenario, memoriesForScenario } from "./pmFixture.js";

const trace: CandidateTurn["trace"] = { sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [], unsupportedConcrete: [] };
test("canonical S1–S16 retained; #48 appends S17–S21; #50 appends S22–S25; #51 appends S26–S30; #52 S31–S40; #44 S41", () => {
  assert.deepEqual(SCENARIOS.slice(0, 16).map((s) => s.id), Array.from({ length: 16 }, (_, i) => `S${i + 1}`));
  assert.deepEqual(SCENARIOS.slice(16, 21).map((s) => s.id), ["S17", "S18", "S19", "S20", "S21"]);
  assert.deepEqual(SCENARIOS.slice(21, 25).map((s) => s.id), ["S22", "S23", "S24", "S25"]);
  assert.deepEqual(SCENARIOS.slice(25, 30).map((s) => s.id), ["S26", "S27", "S28", "S29", "S30"]);
  assert.deepEqual(SCENARIOS.slice(30, 40).map((s) => s.id), Array.from({ length: 10 }, (_, i) => `S${i + 31}`));
  assert.deepEqual(SCENARIOS.slice(40).map((s) => s.id), ["S41"]);
  assert.deepEqual(selectScenarios("critical").map((s) => s.id), [...CRITICAL_IDS]);
  assert.deepEqual(selectScenarios("S14").map((s) => s.id), ["S14"]);
  assert.equal(selectScenarios("full").length, 41);
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

test("#52 S31–S40 preserve S1–S30, use a due-only Friday prompt and score approval boundaries", async () => {
  const scenario = (id: string) => SCENARIOS.find((entry) => entry.id === id)!;
  assert.match(scenario("S36").turns[0], /Цього місяця настав короткий огляд working-style/);
  assert.doesNotMatch(scenario("S37").turns[0], /Цього місяця настав короткий огляд working-style/);
  assert.match(memoriesForScenario(scenario("S35"))["/working-style.md"], /Докладні відповіді/);
  assert.equal(memoriesForScenario(scenario("S35"))["/preferences.md"], undefined);
  const run = async (id: string, replies: string[], writes: string[][] = replies.map(() => [])) => {
    let index = 0;
    return (await runBenchmark({ mode: id as `S${number}`, release: "offline", repetitions: 1, grader: fakeGrader(),
      fixture: { async reset() { return { evidenceAvailable: true }; } },
      candidate: { async open() { return { async send() { const at = index++; return { reply: replies[at], trace: { ...trace, memoryPathsWritten: writes[at] } }; }, close() {} }; } } }))[0].checkFailures;
  };
  assert.deepEqual(await run("S31", ["Головне — концепт. Запамʼятати це як правило?"]), []);
  assert.deepEqual(await run("S31", ["Головне — концепт."]), ["remember_offer"]);
  assert.deepEqual(await run("S32", ["Сьогодні Extract не чіпаємо."]), []);
  assert.deepEqual(await run("S33", ["Дедлайн не вказано."]), []);
  assert.deepEqual(await run("S34", ["Запамʼятати?", "Один пріоритет зараз." ]), []);
  assert.deepEqual(await run("S34", ["Запамʼятати?", "І це запамʼятати?" ]), ["no_second_remember_offer"]);
  assert.deepEqual(await run("S35", ["Запамʼятати?", "Збережено."], [[], ["/working-style.md"]]), []);
  assert.deepEqual(await run("S35", ["Запамʼятати?", "Збережено."], [[], ["/preferences.md"]]), ["working_style_only", "no_preferences_write"]);
  assert.deepEqual(await run("S39", ["Запамʼятати?", "Добре."], [[], []]), []);
  assert.deepEqual(await run("S39", ["Запамʼятати?", "Добре."], [[], ["/working-style.md"]]), ["no_memory_write"]);
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

test("#44 S41: project risk fixture has one evidenced threatened commitment and non-risk distractors", () => {
  const s41 = SCENARIOS.find((entry) => entry.id === "S41")!;
  assert.deepEqual(s41.turns, ["Які ризики по Seqthera?"]);
  assert.equal(s41.passTarget, "pass^3", "factual invariants use the benchmark's pass^3 standard");
  assert.deepEqual([...s41.checks].sort(), ["concise", "no_date", "no_memory_write", "zero_write"]);
  assert.deepEqual(s41.rubricFocus, ["evidence", "usefulness"]);
  assert.equal(s41.requires, undefined, "judged on its facts whatever read path the coordinator takes");
  assert.equal(s41.origin, undefined, "Daniel's own turn");
  assert.doesNotMatch(s41.title, /specialist/i, "absolute rubric; never compared with the retired specialist");
  assert.ok((CRITICAL_IDS as readonly string[]).includes("S41"));
  const cards = cardsForScenario(s41).filter((card) => card.project === "Seqthera");
  const card = (key: string) => cards.find((entry) => entry.key === key)!;
  // The threatened thing and its evidence: accepted dated review (Memory) + an unfinished concept (Trello).
  assert.match(memoriesForScenario(s41)["/commitments/seqthera.md"], /Accepted external commitment: send the Seqthera concept[^.]*by Wednesday 30 September 2026/);
  assert.deepEqual([card("seq-concept").list, card("seq-concept").checklist], ["In progress", { done: 1, total: 4 }]);
  // Distractors that are NOT risk: Waiting without a blocker, a due without a commitment, an XL card queued.
  assert.equal(card("seq-followup").list, "Waiting");
  assert.equal(card("seq-site").due, "2026-09-29T12:00:00.000Z");
  assert.equal(card("seq-site").list, "To do");
  assert.doesNotMatch(memoriesForScenario(s41)["/commitments/seqthera.md"], /site|сайт|feedback|фідбек/i, "nothing is promised for the distractors");
  assert.deepEqual([card("seq-pack").list, card("seq-pack").size], ["To do", "XL"]);
  // Other scenarios keep their fixtures.
  assert.equal(cardsForScenario(SCENARIOS.find((entry) => entry.id === "S9")!).find((entry) => entry.key === "seq-site")?.due, undefined);
  assert.match(memoriesForScenario(SCENARIOS.find((entry) => entry.id === "S4")!)["/commitments/seqthera.md"], /No date is recorded/);
});

test("#44 S41 mechanical checks: invented dates, writes, Memory writes and a card dump fail; the recorded facts pass", async () => {
  const run = async (reply: string, turnTrace: CandidateTurn["trace"] = trace) => (await runBenchmark({ mode: "S41", release: "offline", repetitions: 1,
    grader: fakeGrader(), fixture: { async reset() { return { evidenceAvailable: true }; } },
    candidate: { async open() { return { async send() { return { reply, trace: turnTrace }; }, close() {} }; } } }))[0];
  const grounded = [
    "Один ризик: огляд концепту Seqthera, обіцяний клієнту до ср 30.09, а концепт ще в роботі (1/4 чекліста).",
    "Фідбек клієнта в Waiting — це очікування, не блокер.",
    "Дедлайн сайту (вт 29.09) сам по собі не ризик: обіцянки по ньому немає.",
    "🎯 Далі: концепт.",
  ].join("\n");
  const ok = await run(grounded);
  assert.deepEqual(ok.checkFailures, []);
  assert.equal(ok.verdict, "pass");
  assert.deepEqual((await run("Ризик: концепт треба показати в пт 2.10.")).checkFailures, ["no_date"], "an invented date fails");
  const mutation: CandidateTurn["trace"]["mutations"][number] = { cardIds: ["card_seq_site"], status: "verified" };
  assert.deepEqual((await run(grounded, { ...trace, mutations: [mutation] })).checkFailures, ["zero_write"], "a risk question writes nothing");
  assert.deepEqual((await run(grounded, { ...trace, memoryPathsWritten: ["/projects/seqthera.md"] })).checkFailures, ["no_memory_write"], "no stored health/risk state");
  assert.deepEqual((await run(Array.from({ length: 14 }, (_, i) => `картка ${i}`).join("\n"))).checkFailures, ["concise"], "no card dump");
});

test("#44: offline critical simulation includes S41 with no paid inference (fake candidate, fake grader)", async () => {
  const runs = await runBenchmark({ mode: "critical", release: "offline", repetitions: 1, grader: fakeGrader(),
    fixture: { async reset() { return { evidenceAvailable: true }; } },
    candidate: { async open() { return { async send() { return { reply: "SILENT", trace }; }, close() {} }; } } });
  const s41 = runs.filter((run) => run.scenarioId === "S41");
  assert.equal(s41.length, 1);
  assert.notEqual(s41[0].verdict, "infra_error");
  assert.ok(runs.every((run) => run.usageCostUsd === undefined), "no paid usage recorded");
  for (const id of ["S9", "S10", "S11"]) assert.ok(SCENARIOS.some((entry) => entry.id === id), `${id} is retained`);
});

test("#44 S11 unchanged: the r30 composed mixed reply (verified due first, project view after) meets its mechanical checks offline", async () => {
  const { finalizeMutationReply } = await import("./djonikClient.js");
  const s11 = SCENARIOS.find((entry) => entry.id === "S11")!;
  assert.deepEqual(s11.checks, ["verified_write"], "S11 is not weakened or rewritten");
  assert.equal(s11.turns[0], "Що по Seqthera і постав дедлайн концепту на п'ятницю 2 жовтня?");
  const due = "2026-10-02T15:00:00.000Z";
  const view = "По Seqthera: концепт у роботі, фідбек клієнта в Waiting — це очікування, не блокер.";
  const reply = finalizeMutationReply(view, [{ toolUseId: "w", status: "verified", targetCardIds: ["card_seq"], label: "[EVAL] Seqthera — концепт",
    unconfirmedFields: [], superseded: false, due: { intendedDue: due, verifiedDue: due } }]);
  assert.ok(reply.includes(view), "the read/judgement half is visible (the docs/91 §13 blocker)");
  assert.match(reply, /^Готово\. Trello підтвердив дедлайн: пʼятниця, 2 жовтня 2026, 18:00 за Києвом\./);
  const run = async (mutations: CandidateTurn["trace"]["mutations"]) => (await runBenchmark({ mode: "S11", release: "offline", repetitions: 1, grader: fakeGrader(),
    fixture: { async reset() { return { evidenceAvailable: true }; } },
    candidate: { async open() { return { async send() { return { reply, trace: { ...trace, mutations } }; }, close() {} }; } } }))[0];
  const verified = await run([{ cardIds: ["card_seq"], status: "verified" }]);
  assert.deepEqual(verified.checkFailures, []);
  assert.deepEqual(verified.findings, [], "the code-owned sentence only restates Daniel's own пт / 2 жовтня");
  assert.deepEqual((await run([])).checkFailures, ["verified_write"]);
});
