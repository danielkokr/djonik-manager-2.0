import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORK_REVIEW_RUBRIC, lintWorkReviewAnswer, type RubricDimensionId } from "./workReviewRubric.js";

// Issue #29 (Wave C2), source-only slice: contract fixtures for the simplified
// current-state work-review Skill and the behavioral rubric.
//
// IMPORTANT: these are deterministic SOURCE checks. They prove that the canonical
// Skill text and the rubric explicitly encode each required boundary. They do NOT
// prove that any model (Haiku or Sonnet) follows the Skill — a prior live Haiku run
// failed despite explicit prohibitions in the text. Behavior is judged only by the
// later, separately authorized experiment, using docs/20 on the same dimensions.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), "utf8").replace(/\r\n?/g, "\n");
}

const SKILL = readRepoFile(".claude", "skills", "work-review", "SKILL.md");
const RUBRIC_DOC = readRepoFile("docs", "20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md");

function section(heading: string): string {
  const start = SKILL.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `expected a '${heading}' section in work-review`);
  const next = SKILL.indexOf("\n## ", start + 1);
  return next >= 0 ? SKILL.slice(start, next) : SKILL.slice(start);
}

interface ContractAssertion {
  readonly section: string;
  readonly pattern: RegExp;
}

interface ContractFixture {
  readonly id: string;
  readonly title: string;
  readonly userPrompt: string;
  /** Synthetic description of the fresh evidence a grader would hold; no real card data. */
  readonly evidence: string;
  readonly expectedContract: string;
  readonly dimensions: readonly RubricDimensionId[];
  readonly assertions: readonly ContractAssertion[];
}

const FIXTURES: readonly ContractFixture[] = [
  {
    id: "A",
    title: "Historical-looking question",
    userPrompt: "Що я зробив цього тижня?",
    evidence: "Fresh board read: three cards currently in Done, two in In progress; no completion times exist in the data.",
    expectedContract:
      "States once that current data cannot prove what was completed in that window, still gives a bounded current-state summary, invents no dates/order/movement.",
    dimensions: ["R01", "R13"],
    assertions: [
      { section: "History is not available", pattern: /cannot show when a card was completed/i },
      { section: "History is not available", pattern: /cannot prove what was completed, moved or reopened in that period/i },
      { section: "History is not available", pattern: /Give the useful current state that is supported/i },
      { section: "History is not available", pattern: /Add no dates, order, movement, reopen events or causes/i },
      { section: "History is not available", pattern: /Do not present current Done cards as .this week's. work/i },
      { section: "History is not available", pattern: /«що завершили за останні дні\?», «що повернулось у роботу\?», «що просунулось цього тижня\?»/ },
    ],
  },
  {
    id: "B",
    title: "Project review with Done / active / waiting cards",
    userPrompt: "Дай короткий review по Extract",
    evidence: "Nine open cards: four Done, three In progress, two in a list named Waiting.",
    expectedContract: "A few strongest supported facts; no per-card inventory, totals, chronology or score by default.",
    dimensions: ["R09", "R14"],
    assertions: [
      { section: "Shape of the answer", pattern: /a few of the strongest supported facts/i },
      { section: "Shape of the answer", pattern: /what is currently Done, what is active, what is waiting/i },
      { section: "Shape of the answer", pattern: /No chronology, totals, score, percentage or productivity verdict/i },
      { section: "Shape of the answer", pattern: /no line for every card, no opening inventory/i },
      { section: "Shape of the answer", pattern: /Name only the few cards that carry the point/i },
      { section: "Shape of the answer", pattern: /Do not add vague interpretation such as «невеликий процес»/ },
      { section: "Shape of the answer", pattern: /List everything only when Daniel explicitly asks for a list or table/i },
    ],
  },
  {
    id: "C",
    title: "lastActivityAt",
    userPrompt: "Що по Extract рухалось останнім часом?",
    evidence: "A Done card with lastActivityAt 2026-09-21T07:09:13.924Z (raw UTC); other Done cards with earlier values.",
    expectedContract:
      "lastActivityAt is never completion/order/progress/time-window evidence; no naturalized clock time such as «о 07:09» is produced from it.",
    dimensions: ["R02", "R03"],
    assertions: [
      { section: "Signals stay distinct", pattern: /only means Trello recorded some activity on the card at that raw timestamp/i },
      { section: "Signals stay distinct", pattern: /Never use it as evidence of completion, order, movement, reopening, progress, an actor, staleness, or membership in a period/i },
      { section: "Signals stay distinct", pattern: /never to choose which cards to include/i },
      { section: "Signals stay distinct", pattern: /Never rewrite it as a local date or time, a weekday, or relative wording, and never present it as when something happened/i },
      { section: "Signals stay distinct", pattern: /copy the raw ISO string verbatim as «Trello recorded activity at <ISO>»/ },
      { section: "Signals stay distinct", pattern: /«21 вересня о 07:09» is a measured failure/ },
    ],
  },
  {
    id: "D",
    title: "Conflicting Done / closed / dueComplete state",
    userPrompt: "Що з цих задач уже виглядає завершеним?",
    evidence:
      "One archived card outside Done; one card in Done with dueComplete false; one card with dueComplete true in In progress; one not-Done card whose recorded due has passed.",
    expectedContract:
      "Done/list, closed and dueComplete reported for what they are; material conflicts among them named; no invented reconciliation. due stays an independent current fact, not a completion-state signal.",
    dimensions: ["R06", "R04"],
    assertions: [
      { section: "Signals stay distinct", pattern: /Three signals speak to completion state\. Report each for what it is and keep them apart/i },
      { section: "Signals stay distinct", pattern: /a card in a list named Done: the board currently treats it as Done/i },
      { section: "Signals stay distinct", pattern: /`closed`: the card is archived now, which does not mean the work was finished/i },
      { section: "Signals stay distinct", pattern: /`dueComplete`: a current boolean with no completion time/i },
      { section: "Signals stay distinct", pattern: /state what each shows and that they differ/i },
      { section: "Signals stay distinct", pattern: /Do not pick a winner or invent a transition/i },
      { section: "Signals stay distinct", pattern: /Three signals speak to completion state/i },
      { section: "Signals stay distinct", pattern: /`due` is not one of these signals: a deadline is not proof that work is or is not finished/i },
      { section: "Signals stay distinct", pattern: /report it as a current fact on its own and not as a completion-state conflict/i },
    ],
  },
  {
    id: "E",
    title: "Partial retrieval",
    userPrompt: "Що активно по Seqthera?",
    evidence: "Card listing returned with hasNextPage true (or limit reached); only open cards read.",
    expectedContract: "Coverage disclosed before any aggregate; no «усі», «це все», «всього N» unless coverage proves it.",
    dimensions: ["R07"],
    assertions: [
      { section: "Coverage and counts", pattern: /whether the result was cut off \(`hasNextPage`, a reached `limit`/i },
      { section: "Coverage and counts", pattern: /say so first, and speak only about what was retrieved/i },
      { section: "Coverage and counts", pattern: /Do not say «усі завершені», «це все, що активно», «всього N» or «жодної» unless coverage proves it/ },
    ],
  },
  {
    id: "F",
    title: "Explicit count request",
    userPrompt: "Скільки задач по Extract зараз у Done?",
    evidence: "Four Done cards in the retrieved set (one is archived); coverage complete for the scope.",
    expectedContract: "Count defined over a named set, equal to the enumerated cards; partial coverage disclosed.",
    dimensions: ["R08", "R07"],
    assertions: [
      { section: "Coverage and counts", pattern: /Give no counts by default/i },
      { section: "Coverage and counts", pattern: /name the set it covers \(scope, open and closed or open only\)/i },
      { section: "Coverage and counts", pattern: /tally the returned cards one by one/i },
      { section: "Coverage and counts", pattern: /a number that equals the cards you actually enumerate/i },
      { section: "Coverage and counts", pattern: /the number must match the names shown/i },
      { section: "Coverage and counts", pattern: /With partial coverage, say the count is of what was read/i },
    ],
  },
  {
    id: "G",
    title: "Accepted plan and a matching current card",
    userPrompt: "Що з плану виконано станом на зараз?",
    evidence: "Memory holds an explicitly accepted plan naming task X; one card X in the same project is currently in Done.",
    expectedContract: "Plan side and current-actual side stated separately; no completed-this-week claim.",
    dimensions: ["R10"],
    assertions: [
      { section: "Accepted plan and current state", pattern: /may supply only the plan side/i },
      { section: "Accepted plan and current state", pattern: /Fresh Trello supplies only the current side/i },
      { section: "Accepted plan and current state", pattern: /only when both are reliable and the card is clearly the same task in the same project/i },
      { section: "Accepted plan and current state", pattern: /Allowed: «У прийнятому плані була X; зараз у Trello вона в Done\.»/ },
      { section: "Accepted plan and current state", pattern: /Never write «виконано за планом цього тижня»/ },
      { section: "Accepted plan and current state", pattern: /Memory never proves that work was completed, moved or reopened/i },
    ],
  },
  {
    id: "H",
    title: "Accepted plan missing, ambiguous or in the wrong project",
    userPrompt: "Що з плану виконано станом на зараз?",
    evidence:
      "Variants: no accepted plan in Memory; a plan later cancelled; two similarly named cards; the only matching card belongs to another project.",
    expectedContract: "No fabricated comparison; say what is missing or ambiguous and give the current-state review.",
    dimensions: ["R10"],
    assertions: [
      { section: "Accepted plan and current state", pattern: /A suggestion that was only discussed is not a plan/i },
      { section: "Accepted plan and current state", pattern: /is not an accepted plan unless Daniel says so/i },
      { section: "Accepted plan and current state", pattern: /no accepted plan is available, or it looks cancelled, superseded or of unclear period, say so/i },
      { section: "Accepted plan and current state", pattern: /instead of inventing a plan/i },
      { section: "Accepted plan and current state", pattern: /could match more than one card, or the only match is in another project, do not compare/i },
      { section: "Accepted plan and current state", pattern: /ask one short question or name the item you could not match/i },
    ],
  },
  {
    id: "I",
    title: "Single-project isolation",
    userPrompt: "Дай короткий review по Extract",
    evidence: "Shared board read returns cards of several projects, including an urgent-looking card labelled for another project.",
    expectedContract: "Only the named project's cards are named, counted or flagged; nothing from another project leaks.",
    dimensions: ["R05"],
    assertions: [
      { section: "Project scope", pattern: /Keep a single-project review inside that project/i },
      { section: "Project scope", pattern: /Cards of other projects are not named, counted or flagged, even when urgent-looking/i },
      { section: "Project scope", pattern: /do not add «а ще в іншому проєкті…»/i },
      { section: "Project scope", pattern: /If more than one board or label plausibly matches, or none does, ask one short clarification/i },
      { section: "Project scope", pattern: /Do not hard-code project names/i },
      { section: "Project scope", pattern: /keep each project's facts separate/i },
    ],
  },
  {
    id: "J",
    title: "Project Health ownership boundary",
    userPrompt: "Чи є ризики по Extract і що там зараз у Done?",
    evidence: "Mixed request: a health/risk question plus a current-state question; Waiting list present.",
    expectedContract:
      "Risk/blocking/health judgement stays with Project Health; the specialist result is not restated or extended; Waiting is only a direct fact.",
    dimensions: ["R12", "R04"],
    assertions: [
      { section: "Scope and handoffs", pattern: /Health, risk, blocking, staleness or overload.{0,10} belong to the Project Health capability and its specialist/i },
      { section: "Scope and handoffs", pattern: /do not restate, paraphrase or extend a Project Health result/i },
      { section: "Scope and handoffs", pattern: /the runtime keeps that result authoritative/i },
      { section: "Shape of the answer", pattern: /what is waiting \(only as the direct fact that the card sits in that list or says so itself\)/i },
      { section: "Evidence", pattern: /in this turn/i },
      { section: "Evidence", pattern: /`trelloSearch` only discovers candidates; it is not authoritative field evidence/i },
      { section: "Evidence", pattern: /Use only values the fresh result actually returned/i },
    ],
  },
  {
    id: "K",
    title: "Review-only scenario stays read-only",
    userPrompt: "Дай короткий review по Extract",
    evidence: "Review recommends a next action on a card; Daniel has not asked to change anything.",
    expectedContract: "Zero Trello writes, no Calendar, no transient retrospective judgement written to Memory.",
    dimensions: ["R11", "R15"],
    assertions: [
      { section: "Read-only and Memory", pattern: /zero Trello writes and has no Calendar dependency/i },
      { section: "Read-only and Memory", pattern: /never change a card because a review recommends an action/i },
      { section: "Read-only and Memory", pattern: /explicitly asks to act, hand it to task-management/i },
      { section: "Read-only and Memory", pattern: /Do not write transient retrospective conclusions to durable Memory/i },
      { section: "Read-only and Memory", pattern: /recompute from fresh Trello each time/i },
    ],
  },
];

for (const fixture of FIXTURES) {
  test(`fixture ${fixture.id} (${fixture.title}): the canonical Skill encodes the required contract`, () => {
    assert.ok(fixture.userPrompt.length > 0 && fixture.evidence.length > 0 && fixture.expectedContract.length > 0);
    for (const a of fixture.assertions) {
      assert.match(section(a.section), a.pattern, `fixture ${fixture.id}: '${a.section}' must match ${a.pattern}`);
    }
  });
}

test("fixtures cover the required scenarios A to K exactly once and every rubric dimension at least once", () => {
  assert.deepEqual(
    FIXTURES.map((f) => f.id),
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
  );
  const known = new Set<string>(WORK_REVIEW_RUBRIC.map((d) => d.id));
  const covered = new Set<string>();
  for (const f of FIXTURES) for (const d of f.dimensions) {
    assert.ok(known.has(d), `fixture ${f.id} names unknown dimension ${d}`);
    covered.add(d);
  }
  for (const id of known) assert.ok(covered.has(id), `rubric dimension ${id} has no fixture`);
});

// ---- Skill shape: simpler, positive contract, no chronology / totals / mandatory takeaway ----

test("work-review Skill has valid frontmatter and covers current-state and history-limited questions without claiming health, planning or mutation", () => {
  assert.match(SKILL, /^---\nname: work-review\ndescription: .+\n---\n/);
  const frontmatter = SKILL.split("---")[1] ?? "";
  for (const phrase of [
    "Що зараз у Done",
    "Дай короткий review по Extract",
    "Що я зробив цього тижня",
    "Що завершили за останні дні",
    "Що повернулось у роботу",
    "Що просунулось цього тижня",
  ]) {
    assert.ok(frontmatter.includes(phrase), `frontmatter should cover «${phrase}»`);
  }
  assert.match(frontmatter, /Read-only/);
  assert.doesNotMatch(frontmatter, /create, update, move, or complete|Що робити сьогодні|Що робити цього тижня|Дай health check|Чи є ризики/i);
});

test("work-review is simpler than the previous candidate and keeps the expected sections", () => {
  const bytes = Buffer.byteLength(SKILL, "utf8");
  assert.ok(bytes < 11_515, `expected a smaller contract than the previous 11,515-byte Skill, got ${bytes}`);
  const headings = [...SKILL.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, [
    "Scope and handoffs",
    "Evidence",
    "History is not available",
    "Signals stay distinct",
    "Coverage and counts",
    "Accepted plan and current state",
    "Project scope",
    "Shape of the answer",
    "Read-only and Memory",
  ]);
});

test("work-review no longer requires chronology, totals, a mandatory takeaway or a forced progress judgement", () => {
  const shape = section("Shape of the answer");
  assert.match(shape, /Add one next action only when a card's own evidence directly supports it; otherwise stop with the facts/i);
  assert.doesNotMatch(SKILL, /end with one useful retrospective insight|must (?:include|give) (?:a )?(?:total|count|takeaway)/i);
  assert.doesNotMatch(SKILL, /Lead with the current PM read/i);
});

test("work-review forbids ordering cards in time and names the measured ordering phrases", () => {
  const history = section("History is not available");
  assert.match(history, /never as «остання закрита», «перша завершена», «нещодавно закрита» or «свіжо завершена»/);
  assert.match(history, /This includes ordering the cards against each other in time/i);
});

test("work-review has no Trello write tool name, no Calendar use and no numeric age threshold", () => {
  assert.doesNotMatch(SKILL, /trelloWrite[A-Z]/);
  assert.doesNotMatch(SKILL, /(older than|more than|over|>=?|≥)\s*\d+\s*(days?|дн|дні|днів|weeks?|тижн)/i);
  assert.doesNotMatch(SKILL, /\brouter\b|\bparser\b|\bmiddleware\b|\btool loop\b/i);
});

test("existing Skills stay independent of work-review and work-review does not restate Project Health states", () => {
  for (const name of ["daily-planning", "weekly-planning", "task-management", "studio-intake", "project-health"]) {
    assert.doesNotMatch(readRepoFile(".claude", "skills", name, "SKILL.md"), /work-review/, `${name} must not depend on work-review`);
  }
  assert.doesNotMatch(SKILL, /Backlog is a queue|not automatically Blocked|Blocked may be justified/i);
});

test("work-review treats due as a valid current deadline field: no raw-ISO-only rule, no date middleware, no countdown", () => {
  const signals = section("Signals stay distinct");
  assert.match(signals, /`due` is a different kind of field: a current deadline, recorded on the card/i);
  assert.match(signals, /may be shown in a correct human-readable form, and needs no raw ISO when the wording is exactly right/i);
  assert.match(signals, /If you are unsure of a conversion or a weekday, quote the recorded ISO instead/i);
  assert.match(signals, /Do not derive a countdown or lateness from it/i);
  // The raw-ISO-only restriction is for lastActivityAt alone.
  assert.doesNotMatch(signals, /\(or `due`\)|дедлайн у Trello: <ISO>/);
  assert.doesNotMatch(SKILL, /middleware|deterministic date/i);
});

test("rubric R03 is limited to lastActivityAt and leaves due correctness to R04", () => {
  const r03 = RUBRIC_DOC.slice(RUBRIC_DOC.indexOf("### R03 —"), RUBRIC_DOC.indexOf("### R04 —"));
  assert.match(r03, /^### R03 — lastActivityAt converted into/);
  assert.match(r03, /`due` \*\*не\*\* входить у R03/);
  assert.match(r03, /не вимагає сирого ISO/);
  assert.match(r03, /оцінюється в R04/);
  assert.match(r03, /date-middleware тут не додано/);
  assert.doesNotMatch(r03, /`lastActivityAt`, `due`/);
  const r04 = RUBRIC_DOC.slice(RUBRIC_DOC.indexOf("### R04 —"), RUBRIC_DOC.indexOf("### R05 —"));
  assert.match(r04, /`due`.{0,60}(?:зон|день тижня)/);
  assert.match(WORK_REVIEW_RUBRIC.find((d) => d.id === "R03")!.title, /^lastActivityAt /);
});

test("rubric R06 covers Done/list, closed and dueComplete, and treats due independently under R04", () => {
  const r06 = RUBRIC_DOC.slice(RUBRIC_DOC.indexOf("### R06 —"), RUBRIC_DOC.indexOf("### R07 —"));
  assert.match(r06, /три сигнали стану завершення — поточний Done\/список, `closed`\/архів і `dueComplete`/);
  assert.match(r06, /`due` — не сигнал стану завершення/);
  assert.match(r06, /R04/);
  assert.match(r06, /вигадана історія/);
  assert.doesNotMatch(r06, /сигнали Done-список, `closed`, `dueComplete`, `due`/);
});

// ---- Rubric: doc and module stay in step; lint pre-screens measured failures ----

test("rubric document defines every dimension with a matching severity and lists fixtures A to K", () => {
  for (const d of WORK_REVIEW_RUBRIC) {
    assert.match(RUBRIC_DOC, new RegExp(`### ${d.id} — .+ \\(${d.severity}\\)`), `docs/20 must define ${d.id} as ${d.severity}`);
  }
  for (const id of "ABCDEFGHIJK") assert.match(RUBRIC_DOC, new RegExp(`\\| ${id} \\|`), `docs/20 must list fixture ${id}`);
  const minimum = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12"];
  for (const id of minimum) assert.ok(WORK_REVIEW_RUBRIC.some((d) => d.id === id));
});

test("rubric is model-neutral: it names no winner and ranks no model", () => {
  assert.doesNotMatch(RUBRIC_DOC, /winner is|переможець[:\s]+(Haiku|Sonnet)|кращий кандидат/i);
  assert.match(RUBRIC_DOC, /ранжує моделі/);
  assert.match(RUBRIC_DOC, /не доводять поведінку моделі/);
});

const MEASURED_FAILED_ANSWER = `Готово. Зараз у Done стоять три карти Extract:

1. **Коментарі по пінкам** — зараз у Done, Trello записав активність 21 вересня о 07:09
2. **Автоматизація рендеру** — зараз у Done, мала дедлайн 18 вересня
3. **Білі аромати 3D відео** — зараз у Done, мала дедлайн 14 вересня
4. **Кохаю пінка** — зараз у Done, мала дедлайн 14 вересня

Щодо того, коли саме вони туди потрапили — Trello показує поточний стан, але не історію переходів, тож підтвердити «за цей тиждень» я не можу.

У **This week** наразі 5 карт Extract, які ще не у Done:
- Брендбук (дедлайн 25 вересня)

На фоні — невеликий процес. Коментарі по пінкам було останньою замкненою задачею з Extract.`;

test("lint pre-screen flags the measured failed Haiku answer on the mechanically visible dimensions", () => {
  const flags = lintWorkReviewAnswer(MEASURED_FAILED_ANSWER);
  const dims = new Set(flags.map((f) => f.dimension));
  for (const d of ["R01", "R02", "R03", "R14"] as const) assert.ok(dims.has(d), `expected a ${d} flag`);
  assert.ok(flags.some((f) => f.dimension === "R01" && /останньою замкненою/.test(f.match)));
  assert.ok(flags.some((f) => f.dimension === "R03" && /07:09/.test(f.match)));
  assert.ok(flags.some((f) => f.dimension === "R14" && /невеликий процес/.test(f.match)));
  // The counting errors (R08) are not lintable; the rubric says so rather than pretending.
  assert.equal(WORK_REVIEW_RUBRIC.find((d) => d.id === "R08")?.lintable, false);
});

test("lint pre-screen does not flag a contract-shaped answer, verbatim ISO, or the recommended coverage wording", () => {
  const compliant = [
    "Зараз у Done стоять «Коментарі по пінкам» і «Автоматизація рендеру». Коли саме вони туди потрапили, Trello не показує, тож «за тиждень» підтвердити не можу.",
    "Серед прочитаних карток у This week лежить «Брендбук»; дедлайн у Trello: 2026-09-25T15:00:00Z.",
    "Trello recorded activity at 2026-09-21T07:09:13.924Z; це лише слабка ознака активності, не доказ завершення.",
    "У прийнятому плані була «Флакони 1.5 ML»; зараз у Trello вона в Done. Архівована картка лежить поза Done — сигнали різні.",
  ];
  for (const answer of compliant) assert.deepEqual(lintWorkReviewAnswer(answer), [], answer);
});

test("lint pre-screen catches derived weekday, relative and naturalized-time wording but is only a pre-screen", () => {
  // Activity converted into relative/local time is R03 (and an event claim, R02).
  const activity = lintWorkReviewAnswer("Trello записав активність у середу о 10:09, тобто 3 дні тому.");
  assert.ok(activity.filter((f) => f.dimension === "R03").length >= 3, JSON.stringify(activity));
  assert.ok(activity.some((f) => f.dimension === "R02"));
  // A derived time attached to a completion verb is an R01 chronology claim.
  assert.ok(lintWorkReviewAnswer("Картка завершена вчора.").some((f) => f.dimension === "R01"));
  assert.ok(lintWorkReviewAnswer("Остання завершена картка — A.").some((f) => f.dimension === "R01"));
  // An empty result never proves compliance: a fabricated non-lintable claim passes the lint.
  assert.deepEqual(lintWorkReviewAnswer("Усього 7 задач у Done."), []);
});

test("lint never treats a human-readable due date as an R03 finding; due correctness is left to R04", () => {
  const dueRenderings = [
    "Брендбук — дедлайн 25 вересня.",
    "Дедлайн у Брендбук: 25 вересня о 18:00 за київським часом.",
    "Флакони 1.5 ML мають due у пʼятницю.",
    "Автоматизація рендеру зараз у Done, дедлайн був 18 вересня.",
    "Дедлайн завершеної картки — 14 вересня.",
  ];
  for (const answer of dueRenderings) assert.deepEqual(lintWorkReviewAnswer(answer), [], answer);
  // Even a WRONG due rendering is not lintable (it needs the raw payload): it is graded under R04, not flagged as R03.
  assert.deepEqual(lintWorkReviewAnswer("Дедлайн — у понеділок, 3 дні тому."), []);
  assert.equal(WORK_REVIEW_RUBRIC.find((d) => d.id === "R04")?.lintable, false);
});
