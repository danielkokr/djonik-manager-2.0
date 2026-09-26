import { RUBRIC, type Grader, type GraderInput, type GraderResult, type RubricDimension } from "./pmBenchmark.js";

/** The grader is an isolated later-stage observer. No tested Session receives this text or its output. */
export const GRADER_INSTRUCTIONS = `Judge one Djonik PM answer against the scenario, available evidence, and four dimensions.
decision: one sensible main PM choice, with priority based on commitments and work state.
evidence: no invented concrete source facts; unknown fields stay unknown; prior model answers are not evidence.
frame: follow Daniel's explicit scope and distinguish it from an accepted external commitment.
usefulness: concise, actionable next step instead of a card inventory or vague reassurance.
Use only dimensions named in rubricFocus. Return JSON with dimensions (pass/fail/not_applicable), verdict (pass/fail), and a short rationaleCode; no hidden reasoning. A failing focused dimension means fail. Do not infer unavailable Trello fields.`;

export function graderPayload(input: GraderInput): string {
  return JSON.stringify({
    scenario: { id: input.scenario.id, title: input.scenario.title, turns: input.scenario.turns, rubricFocus: input.scenario.rubricFocus },
    availableEvidence: input.scenario.evidence,
    priorCandidateReplies: input.priorReplies,
    candidateReply: input.reply,
    deterministicFindings: input.findings,
    observableTrace: input.trace,
  });
}

/** Accept only a bounded parsed grader result. A malformed paid response is infra failure, never PM FAIL. */
export function parseGraderResult(value: unknown, focus: readonly RubricDimension[]): GraderResult {
  if (!value || typeof value !== "object") throw new Error("grader result is not an object");
  const row = value as Record<string, unknown>;
  const raw = row.dimensions;
  if (!raw || typeof raw !== "object") throw new Error("grader dimensions missing");
  const dimensions = {} as GraderResult["dimensions"];
  for (const dimension of RUBRIC) {
    const grade = (raw as Record<string, unknown>)[dimension];
    if (grade !== "pass" && grade !== "fail" && grade !== "not_applicable") throw new Error(`grader ${dimension} malformed`);
    dimensions[dimension] = grade;
  }
  const expected = focus.some((dimension) => dimensions[dimension] === "fail") ? "fail" : "pass";
  if (row.verdict !== expected || focus.some((dimension) => dimensions[dimension] === "not_applicable")) throw new Error("grader verdict conflicts with focused dimensions");
  const rationaleCode = typeof row.rationaleCode === "string" && /^[a-z0-9_]{1,40}$/.test(row.rationaleCode) ? row.rationaleCode : undefined;
  return { dimensions, verdict: expected, ...(rationaleCode ? { rationaleCode } : {}) };
}

/** Adapter for a separately authorized grader call, or a replayed recorded JSON string. */
export function createGrader(invoke: (instructions: string, payload: string) => Promise<string>): Grader {
  return { async grade(input) { return parseGraderResult(JSON.parse(await invoke(GRADER_INSTRUCTIONS, graderPayload(input))) as unknown, input.scenario.rubricFocus); } };
}

/** Offline test grader: deterministic and explicitly labelled fake by construction. */
export function fakeGrader(verdict: "pass" | "fail" = "pass"): Grader {
  return { async grade(input) {
    const dimensions = Object.fromEntries(RUBRIC.map((dimension) => [dimension,
      input.scenario.rubricFocus.includes(dimension) ? verdict : "not_applicable"])) as GraderResult["dimensions"];
    return { dimensions, verdict, rationaleCode: "offline_fake" };
  } };
}
