// Issue #29 (Wave C2): behavioral rubric for a current-state work review.
//
// Evaluation aid only. Nothing at runtime imports this module: it does not route
// user intent, does not read model output in production, and is not a safeguard.
// It exists so a later, separately authorized ownership experiment can judge every
// candidate (Haiku, or a bounded Sonnet candidate) on the SAME named dimensions.
// The human-readable procedure is docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md;
// a test keeps the two in step. This module ranks no model and sets no threshold.

export type RubricSeverity = "critical" | "major";

export interface RubricDimension {
  readonly id: string;
  readonly title: string;
  readonly severity: RubricSeverity;
  /** true when the lint below can pre-screen part of it; a grader still decides. */
  readonly lintable: boolean;
}

export const WORK_REVIEW_RUBRIC = [
  { id: "R01", title: "Unsupported chronology", severity: "critical", lintable: true },
  { id: "R02", title: "lastActivityAt misuse", severity: "critical", lintable: true },
  { id: "R03", title: "lastActivityAt converted into local-time, relative-date or history meaning", severity: "critical", lintable: true },
  { id: "R04", title: "Current-state factual correctness", severity: "critical", lintable: false },
  { id: "R05", title: "Project isolation", severity: "critical", lintable: false },
  { id: "R06", title: "Conflicting-state handling", severity: "major", lintable: false },
  { id: "R07", title: "Partial-coverage honesty", severity: "critical", lintable: false },
  { id: "R08", title: "Count consistency", severity: "major", lintable: false },
  { id: "R09", title: "Concision, no near-full dump", severity: "major", lintable: false },
  { id: "R10", title: "Plan-vs-current correctness", severity: "critical", lintable: false },
  { id: "R11", title: "Zero mutation", severity: "critical", lintable: false },
  { id: "R12", title: "Project Health ownership boundary", severity: "critical", lintable: false },
  { id: "R13", title: "Honest answer to an unanswerable history question", severity: "major", lintable: false },
  { id: "R14", title: "No vague unsupported interpretation", severity: "major", lintable: true },
  { id: "R15", title: "No transient retrospective judgement persisted", severity: "critical", lintable: false },
] as const satisfies readonly RubricDimension[];

export type RubricDimensionId = (typeof WORK_REVIEW_RUBRIC)[number]["id"];

export interface LintFlag {
  readonly dimension: RubricDimensionId;
  readonly match: string;
}

const MONTHS = "січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня";
const WEEKDAYS =
  "понеділ\\p{L}*|вівтор\\p{L}*|сер(?:еда|еди|еду|едою|еді)|четвер\\p{L}*|пʼятниц\\p{L}*|п'ятниц\\p{L}*|субот\\p{L}*|неділ\\p{L}*";

// Phrases seen (or directly implied) in measured failures. Order/recency of completion.
const ORDERING = new RegExp(
  [
    "остан\\p{L}*\\s+(?:закрит|замкнен|завершен|виконан)\\p{L}*",
    "перш\\p{L}*\\s+(?:закрит|замкнен|завершен|виконан)\\p{L}*",
    "(?:нещодавно|щойно|свіжо|нещодавн\\p{L}*)\\s+(?:закрит|замкнен|завершен|виконан)\\p{L}*",
    "найсвіжіш\\p{L}*\\s+(?:закрит|завершен)\\p{L}*",
    "\\blast\\s+(?:closed|completed|done)\\b",
    "\\bmost\\s+recently\\s+(?:closed|completed)\\b",
  ].join("|"),
  "giu",
);

// A verbatim ISO instant is the one allowed way to show a Trello timestamp.
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

const DERIVED_TIME = new RegExp(
  [
    `\\b\\d{1,2}\\s+(?:${MONTHS})(?![\\p{L}])`,
    "(?<![\\p{L}])о\\s+\\d{1,2}[:.]\\d{2}\\b",
    "\\b\\d{1,2}:\\d{2}\\b",
    `(?<![\\p{L}])(?:${WEEKDAYS})(?![\\p{L}])`,
    "\\b\\d+\\s+(?:дн\\p{L}*|тижн\\p{L}*|годин\\p{L}*)\\s+тому(?![\\p{L}])",
    "(?<![\\p{L}])(?:вчора|сьогодні|завтра)(?![\\p{L}])",
  ].join("|"),
  "giu",
);

const VAGUE_INTERPRETATION = new RegExp(
  [
    "невеликий\\s+процес",
    "продуктивн\\p{L}*\\s+тижд\\p{L}*",
    "непродуктивн\\p{L}*",
    "добре\\s+просува\\p{L}*",
    "йде\\s+повільно",
  ].join("|"),
  "giu",
);

const ORDERING_TEST = new RegExp(ORDERING.source, "iu"); // non-global: safe for repeated .test()
const ACTIVITY_WORDING = /активн\p{L}*|lastActivityAt|recorded activity/iu;
const COMPLETION_VERB = /(?:завершен|закрит|замкнен|виконан|перейшл|перенесен|повернул)\p{L}*/iu;
const DUE_WORDING = /дедлайн|термін|\bdue\b/iu;

/**
 * Pre-screen an answer for the mechanically detectable measured failures.
 * A flag is a prompt for a grader to look, not a verdict; an empty result does NOT
 * show the answer is compliant (most dimensions cannot be linted at all).
 *
 * Scope note: `due` is a valid current-state field. A human-readable due date is never
 * an R03 finding, and this lint never checks it; whether a due rendering is factually
 * right is R04 and needs the raw payload. R03/R02 flags come only from sentences that
 * talk about Trello activity (`lastActivityAt`).
 */
export function lintWorkReviewAnswer(answer: string): LintFlag[] {
  const flags: LintFlag[] = [];
  const withoutVerbatimIso = answer.replace(ISO_INSTANT, " ");
  for (const m of answer.matchAll(ORDERING)) flags.push({ dimension: "R01", match: m[0] });
  for (const m of answer.matchAll(VAGUE_INTERPRETATION)) flags.push({ dimension: "R14", match: m[0] });
  for (const sentence of withoutVerbatimIso.split(/\n|(?<=[.!?])\s+/)) {
    const derived = [...sentence.matchAll(DERIVED_TIME)].map((m) => m[0]);
    if (ACTIVITY_WORDING.test(sentence)) {
      // The measured «Trello записав активність 21 вересня о 07:09»: the raw activity
      // instant re-written as local/relative time (R03) and presented as an event (R02).
      for (const d of derived) flags.push({ dimension: "R03", match: d });
      if (derived.length > 0 || ORDERING_TEST.test(sentence)) flags.push({ dimension: "R02", match: sentence.trim() });
    } else if (derived.length > 0 && COMPLETION_VERB.test(sentence) && !DUE_WORDING.test(sentence)) {
      // A derived time attached to a completion/move verb is an R01 chronology claim.
      flags.push({ dimension: "R01", match: sentence.trim() });
    }
  }
  return flags;
}
