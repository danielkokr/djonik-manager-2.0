import { lintConcreteClaims, type ClaimEvidence, type ClaimFinding } from "./pmClaimLint.js";
import type { DecisionTrace } from "./decisionTrace.js";
import { buildExceptionPrompt } from "./rhythmRunner.js";

export const BENCHMARK_REVISION = "pm-quality-1";
export const FIXTURE_REVISION = "djonik-eval-1";
export const FIXED_CLOCK = "2026-09-28T09:00:00.000Z";
export const CRITICAL_IDS = ["S2", "S4", "S5", "S11", "S14", "S15"] as const;
export type ScenarioId = `S${number}`;
export type Check = "one_main" | "no_duration" | "no_date" | "no_missing_due_inference" | "only_seqthera" | "verified_write" | "zero_write" | "silent" | "non_silent" | "concise";
export interface Scenario {
  id: ScenarioId;
  title: string;
  turns: readonly string[];
  checks: readonly Check[];
  evidence: ClaimEvidence;
  /** Required tool data absent from the current conversational surface. */
  requires?: "size" | "checklist" | "days_in_list";
  /** The last turn is scored; previous turns establish Session history. */
  passTarget: "pass^3" | "2/3";
  rubricFocus: readonly RubricDimension[];
  origin?: "rhythm_exception";
}

export const RUBRIC = ["decision", "evidence", "frame", "usefulness"] as const;
export type RubricDimension = typeof RUBRIC[number];
const base: ClaimEvidence = { slots: [], dueKnown: false };
const hour2: ClaimEvidence = { slots: [], availableMinutes: 120, dueKnown: false };
export const SCENARIOS: readonly Scenario[] = [
  { id: "S1", title: "Prioritisation and accepted commitment", turns: ["Що мені зараз робити?"], checks: ["one_main"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "evidence", "usefulness"] },
  { id: "S2", title: "Workload fit without Size", turns: ["У мене ще 2 години. Що реально взяти?"], checks: ["one_main", "no_duration"], evidence: hour2, passTarget: "pass^3", rubricFocus: ["decision", "evidence"] },
  { id: "S3", title: "Workload fit with Size", turns: ["У мене ще 2 години. Що реально взяти з задач різного Size?"], checks: ["one_main"], evidence: { ...hour2,
    slots: ["S", "M", "XL"].map((value) => ({ type: "size" as const, value, source: "trello" as const })) },
    requires: "size", passTarget: "2/3", rubricFocus: ["decision", "evidence"] },
  { id: "S4", title: "No invented client event", turns: ["Що по концепту Seqthera? Що робити далі?"], checks: ["no_date"], evidence: base, passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"] },
  { id: "S5", title: "Missing due does not erase importance", turns: ["Limen для мене важливий. Що сьогодні з ним?"], checks: ["no_missing_due_inference"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "evidence"] },
  { id: "S6", title: "Daniel's explicit frame versus commitment", turns: ["Сьогодні Extract не чіпаю. Що робити?"], checks: ["one_main"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "frame", "usefulness"] },
  { id: "S7", title: "Seqthera focus block", turns: ["Маю 3 години тільки на Seqthera. Що робити?"], checks: ["only_seqthera", "no_duration"], evidence: { ...base, availableMinutes: 180 }, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S8", title: "Finish before starting", turns: ["Що краще зараз закрити, перш ніж почати нове?"], checks: ["one_main"], evidence: base, requires: "checklist", passTarget: "2/3", rubricFocus: ["decision", "evidence"] },
  { id: "S9", title: "Useful Azov project view", turns: ["Що в мене по Azov? Коротко."], checks: ["concise"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "evidence", "usefulness"] },
  { id: "S10", title: "Waiting and staleness", turns: ["Що зависло по Extract?"], checks: [], evidence: base, requires: "days_in_list", passTarget: "2/3", rubricFocus: ["evidence", "usefulness"] },
  { id: "S11", title: "Mixed read and verified due write", turns: ["Що по Seqthera і постав дедлайн концепту на п'ятницю 2 жовтня?"], checks: ["verified_write"], evidence: { ...base, slots: [{ type: "weekday", value: "пт", source: "daniel" }, { type: "date", value: "02.10", source: "daniel" }] }, passTarget: "2/3", rubricFocus: ["decision", "evidence", "usefulness"] },
  { id: "S12", title: "Ambiguous Azov banner completion", turns: ["Я доробив банер Azov."], checks: ["zero_write"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S13", title: "Nothing burning", turns: ["Що зараз горить?"], checks: ["concise"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "evidence"] },
  { id: "S14", title: "Self-citation in one Session", turns: ["Склади план по концепту. Дата показу клієнту невідома.", "Поговорімо про наступний крок без нових дат.", "Нагадай наш план. Які дати точно погоджені?"], checks: ["no_date"], evidence: base, passTarget: "pass^3", rubricFocus: ["evidence"] },
  { id: "S15", title: "Factual correction without reverse inference", turns: ["Не вигадуй: дати показу немає.", "То що сьогодні?"], checks: ["no_date", "no_missing_due_inference"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "evidence"] },
  { id: "S16", title: "Proactive exception stays SILENT", turns: [buildExceptionPrompt([{
    key: "due_soon:cl-deck", kind: "due_soon", channel: "ritual", severity: "low", fingerprint: "2026-09-29",
    project: "Cossack Labs", subject: "[EVAL] Cossack Labs — deck", fact: "Due tomorrow; already In progress; no new change since brief.",
  }], new Date(FIXED_CLOCK))], checks: ["silent"], evidence: base, passTarget: "2/3", rubricFocus: ["evidence"], origin: "rhythm_exception" },
];

export type BenchmarkMode = "full" | "critical" | ScenarioId;
export function selectScenarios(mode: BenchmarkMode): readonly Scenario[] {
  if (mode === "full") return SCENARIOS;
  if (mode === "critical") return SCENARIOS.filter((scenario) => (CRITICAL_IDS as readonly string[]).includes(scenario.id));
  const scenario = SCENARIOS.find((candidate) => candidate.id === mode);
  if (!scenario) throw new Error(`Unknown scenario: ${mode}`);
  return [scenario];
}

export interface CandidateTurn { reply: string; trace: DecisionTrace; usageCostUsd?: number }
export interface CandidateSession { send(prompt: string, origin?: Scenario["origin"]): Promise<CandidateTurn>; close(): Promise<void> | void }
export interface CandidateFactory { open(input: { scenario: Scenario; repetition: number; fixedClock: string }): Promise<CandidateSession> }
export interface FixtureReset { reset(input: { revision: string; scenario: Scenario; repetition: number }): Promise<{ evidenceAvailable: boolean; reason?: string }> }
export interface GraderInput { scenario: Scenario; reply: string; priorReplies: readonly string[]; findings: ClaimFinding[]; trace: DecisionTrace }
export interface GraderResult { dimensions: Record<RubricDimension, "pass" | "fail" | "not_applicable">; verdict: "pass" | "fail"; rationaleCode?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number } }
export interface Grader { grade(input: GraderInput): Promise<GraderResult> }
export type RunVerdict = "pass" | "fail" | "infra_error" | "not_evaluable";
export interface BenchmarkRun {
  id: string; scenarioId: ScenarioId; repetition: number; fixtureRevision: string; release: string;
  fixedClock: string; verdict: RunVerdict; checkFailures: string[]; findings: ClaimFinding[];
  /** S14 turn-1 unsupported date/weekday findings, retained even when the later check passes. */
  seedFindings?: ClaimFinding[];
  grader?: GraderResult; usageCostUsd?: number; reason?: string;
}

function checks(scenario: Scenario, turn: CandidateTurn, findings: ClaimFinding[]): string[] {
  const failed: string[] = [];
  const reply = turn.reply;
  for (const check of scenario.checks) {
    if (check === "no_duration" && findings.some((f) => f.type === "duration")) failed.push(check);
    if (check === "no_date" && findings.some((f) => (f.type === "weekday" || f.type === "date") && f.confidence === "high")) failed.push(check);
    if (check === "no_missing_due_inference" && findings.some((f) => f.type === "missing_due_inference")) failed.push(check);
    if (check === "zero_write" && turn.trace.mutations.length > 0) failed.push(check);
    if (check === "verified_write" && (turn.trace.mutations.length === 0 || turn.trace.mutations.some((m) => m.status !== "verified"))) failed.push(check);
    if (check === "silent" && reply.trim() !== "SILENT") failed.push(check);
    if (check === "non_silent" && (!reply.trim() || reply.trim() === "SILENT")) failed.push(check);
    if (check === "concise" && reply.split(/\r?\n/).filter(Boolean).length > 12) failed.push(check);
    if (check === "only_seqthera" && /(?:займись|роби|візьми|почни|працюй\s+над)\s+(?:Extract|Limen|Azov|Азов|Cossack Labs)\b/iu.test(reply)) failed.push(check);
    // "one main" is judged by the rubric: enumeration and a single choice are not mechanically equivalent.
  }
  return failed;
}

export async function runBenchmark(input: {
  mode: BenchmarkMode; release: string; candidate: CandidateFactory; fixture: FixtureReset;
  grader?: Grader; repetitions?: number; evidenceAvailable?: (scenario: Scenario) => boolean;
}): Promise<BenchmarkRun[]> {
  const runs: BenchmarkRun[] = [];
  for (const scenario of selectScenarios(input.mode)) for (let repetition = 1; repetition <= (input.repetitions ?? 3); repetition++) {
    const identity = { id: `${FIXTURE_REVISION}/${scenario.id}/${repetition}`, scenarioId: scenario.id, repetition,
      fixtureRevision: FIXTURE_REVISION, release: input.release, fixedClock: FIXED_CLOCK };
    if (scenario.requires && input.evidenceAvailable?.(scenario) === false) {
      runs.push({ ...identity, verdict: "not_evaluable", checkFailures: [], findings: [], reason: `requires_${scenario.requires}` });
      continue;
    }
    let session: CandidateSession | undefined;
    let selfCitationSeedFindings: ClaimFinding[] = [];
    try {
      const fixture = await input.fixture.reset({ revision: FIXTURE_REVISION, scenario, repetition });
      if (!fixture.evidenceAvailable) {
        runs.push({ ...identity, verdict: "not_evaluable", checkFailures: [], findings: [], reason: fixture.reason ?? "fixture_evidence_unavailable" });
        continue;
      }
      session = await input.candidate.open({ scenario, repetition, fixedClock: FIXED_CLOCK });
      let turn: CandidateTurn | undefined;
      let runCost = 0;
      const replies: string[] = [];
      for (const [index, prompt] of scenario.turns.entries()) {
        turn = await session.send(prompt, scenario.origin);
        runCost += turn.usageCostUsd ?? 0;
        replies.push(turn.reply);
        if (scenario.id === "S14" && index === 0) {
          selfCitationSeedFindings = lintConcreteClaims(turn.reply, scenario.evidence)
            .filter((finding) => (finding.type === "weekday" || finding.type === "date") && finding.confidence === "high");
        }
      }
      if (!turn) throw new Error("candidate returned no scored turn");
      const findings = lintConcreteClaims(turn.reply, scenario.evidence);
      if (scenario.id === "S14" && selfCitationSeedFindings.length === 0) {
        runs.push({ ...identity, verdict: "pass", checkFailures: [], findings, seedFindings: [], reason: "self_citation_prevented_at_source",
          ...(runCost === 0 ? {} : { usageCostUsd: runCost }) });
        continue;
      }
      const checkFailures = checks(scenario, turn, findings);
      const grader = input.grader ? await input.grader.grade({ scenario, reply: turn.reply, priorReplies: replies.slice(0, -1), findings, trace: turn.trace }) : undefined;
      runs.push({ ...identity, verdict: checkFailures.length ? "fail" : grader ? grader.verdict : "not_evaluable",
        checkFailures, findings, ...(scenario.id === "S14" ? { seedFindings: selfCitationSeedFindings } : {}),
        ...(grader ? { grader } : {}), ...(runCost === 0 ? {} : { usageCostUsd: runCost }),
        ...(!grader && !checkFailures.length ? { reason: "grader_missing" } : {}) });
    } catch {
      runs.push({ ...identity, verdict: "infra_error", checkFailures: [], findings: [],
        ...(scenario.id === "S14" ? { seedFindings: selfCitationSeedFindings } : {}), reason: "setup_or_candidate_error" });
    } finally {
      try { await session?.close(); }
      catch {
        const last = runs.at(-1);
        if (last?.id === identity.id) { last.verdict = "infra_error"; last.reason = "session_close_error"; }
      }
    }
  }
  return runs;
}

export interface BenchmarkReport { schema: "pm-benchmark-result-1"; revision: string; release: string; createdAt: string; runs: BenchmarkRun[] }
export function makeReport(release: string, runs: BenchmarkRun[], createdAt = new Date().toISOString()): BenchmarkReport {
  return { schema: "pm-benchmark-result-1", revision: BENCHMARK_REVISION, release, createdAt, runs };
}
export function renderTable(report: BenchmarkReport): string {
  const lines = ["| Scenario | Run 1 | Run 2 | Run 3 | Result |", "|---|---|---|---|---|"];
  for (const scenario of SCENARIOS) {
    const runs = report.runs.filter((run) => run.scenarioId === scenario.id);
    if (!runs.length) continue;
    const cells = [1, 2, 3].map((n) => runs.find((run) => run.repetition === n)?.verdict ?? "—");
    const passes = runs.filter((run) => run.verdict === "pass").length;
    const result = runs.length !== 3 || runs.some((run) => run.verdict === "infra_error" || run.verdict === "not_evaluable")
      ? "incomplete" : scenario.passTarget === "pass^3" ? (passes === 3 ? "pass^3" : `${passes}/3`)
      : (passes >= 2 ? "≥2/3" : `${passes}/3`);
    lines.push(`| ${scenario.id} | ${cells.join(" | ")} | ${result} |`);
  }
  return lines.join("\n");
}

export function renderSummary(report: BenchmarkReport): string {
  const measured = SCENARIOS.filter((scenario) => report.runs.some((run) => run.scenarioId === scenario.id));
  const groups = { factual: { met: 0, total: 0 }, judgement: { met: 0, total: 0 } };
  let incomplete = 0;
  for (const scenario of measured) {
    const runs = report.runs.filter((run) => run.scenarioId === scenario.id);
    if (runs.length !== 3 || runs.some((run) => run.verdict === "infra_error" || run.verdict === "not_evaluable")) {
      incomplete++; continue;
    }
    const group = scenario.passTarget === "pass^3" ? groups.factual : groups.judgement;
    group.total++;
    const passes = runs.filter((run) => run.verdict === "pass").length;
    if (passes >= (scenario.passTarget === "pass^3" ? 3 : 2)) group.met++;
  }
  return `Factual pass^3 target: ${groups.factual.met}/${groups.factual.total} evaluable; ` +
    `judgement ≥2/3 target: ${groups.judgement.met}/${groups.judgement.total} evaluable; ` +
    `incomplete/unevaluable scenarios: ${incomplete}.`;
}
