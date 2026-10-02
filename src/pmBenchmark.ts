import { lintConcreteClaims, type ClaimEvidence, type ClaimFinding } from "./pmClaimLint.js";
import { historyScopeDigest, type DecisionTrace } from "./decisionTrace.js";
import { buildExceptionPrompt, buildRitualPrompt } from "./rhythmRunner.js";
import { parseRhythmConfig } from "./rhythmConfig.js";
import type { Signal } from "./rhythmSignals.js";

export const BENCHMARK_REVISION = "pm-quality-5";
export const FIXTURE_REVISION = "djonik-eval-1";
export const FIXED_CLOCK = "2026-09-28T09:00:00.000Z";
export const CRITICAL_IDS = ["S2", "S4", "S5", "S11", "S14", "S15", "S17", "S18", "S19", "S20", "S21", "S22", "S23", "S24", "S25", "S26", "S27", "S28", "S29", "S30", "S31", "S32", "S33", "S34", "S35", "S36", "S37", "S38", "S39", "S40", "S41", "S42", "S43", "S44", "S45", "S46", "S47", "S48", "S49"] as const;
export type ScenarioId = `S${number}`;
export type Check = "one_main" | "no_duration" | "no_date" | "no_missing_due_inference" | "only_seqthera" | "verified_write" | "zero_write" | "silent" | "non_silent" | "concise"
  /** #50: exact SILENT, or one short message (≤ 4 non-empty lines). */
  | "silent_or_short"
  /** #50: at most 8 non-empty lines — the delta for today, not a full plan. */
  | "delta"
  /** #50: the model's own text never states an hour total (the code block owns them). */
  | "no_hours_restated"
  /** #51: no attempted Memory write (`write`/`edit` of a Memory path) in the scored turn. */
  | "no_memory_write"
  /** #51: the reply asks Daniel something (an ambiguous contact is a question, not a guess). */
  | "asks_question"
  /** #51: no 🔥 — a durable profile expectation never turns a "не терміново" source into a fire. */
  | "no_fire"
  /** #51: the reply names the one project the contact decoder resolves to (`expectedProject` aliases). */
  | "expected_project"
  /** #59: every `trello_work_history` call in the scored turn is project-scoped to exactly `expectedHistoryLabel`
   *  (compared as the trace's content-free digest); none at all fails. */
  | "history_scope"
  /** #59: a recorded alias is resolved, not confirmed back — no «ти мав на увазі A1?»-style question. */
  | "no_alias_question"
  /** #62: every `trello_project_time` call in the scored turn gets exactly `expectedTimeLabel` (content-free digest);
   *  none at all fails — the deterministic time tool, not model reasoning, must answer a time question. */
  | "time_scope"
  /** #62: `trello_work_history` is not used in a time question (no effort estimate from raw moves). */
  | "no_history_effort"
  /** #62: the reply leads with the code-owned time answer for `expectedTimeLabel` (total or unavailable sentence). */
  | "time_relay"
  | "remember_offer" | "no_remember_offer" | "no_second_remember_offer" | "working_style_only" | "no_preferences_write"
  | "style_review" | "no_style_review";
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
  origin?: "rhythm_exception" | "rhythm_ritual" | "forwarded_source";
  /** #51: aliases of the project the known-contact scenario must resolve to. */
  expectedProject?: readonly string[];
  /** #59: the current Trello label the known project word must reach the work-history tool as. */
  expectedHistoryLabel?: string;
  /** #62: the canonical current label the time question must reach `trello_project_time` as (after #59 resolution). */
  expectedTimeLabel?: string;
  /** Optional scenario clock for rhythm turns; earlier scenarios retain FIXED_CLOCK. */
  fixedClock?: string;
  /** #52: checks on the first turn of a multi-turn approval/rejection scenario. */
  firstTurnChecks?: readonly Check[];
}

export const RUBRIC = ["decision", "evidence", "frame", "usefulness"] as const;
export type RubricDimension = typeof RUBRIC[number];
const base: ClaimEvidence = { slots: [], dueKnown: false };
const hour2: ClaimEvidence = { slots: [], availableMinutes: 120, dueKnown: false };
/** #50 fixture facts, rendered as the runtime renders them: Daniel's explicit 2 h budget on the Seqthera concept, set when it
 *  entered In progress at 10:00 Kyiv, used up at 12:00 (FIXED_CLOCK). */
export const TIMEBOX_SIGNAL: Signal = {
  key: "timebox:seq-concept", kind: "timebox_elapsed", channel: "interrupt", severity: "medium",
  fingerprint: "2026-09-28T07:00:00.000Z|2026-09-28T07:00:00.000Z|120", project: "seqthera", subject: "[EVAL] Seqthera — концепт",
  fact: "⏱ бюджет Daniel 2 год робочого часу вичерпано пн 28.09, 12:00 (рахую з пн 28.09, 10:00)",
};
/** The deterministic block S25's runtime would place after the work-history facts (fixed eval numbers). */
export const EVAL_TIME_BLOCK = "⏱ Час по проєктах ≈ за переміщеннями в Trello (робочі години 10:00–18:00):\nSeqthera — 14 год\nExtract — 10 год\nCossack Labs — 7 год\nЧасто в In progress було кілька карток одночасно — такий час поділено порівну, тож цифри грубі.";
const FRIDAY_REVIEW_PROMPT = buildRitualPrompt(
  { kind: "friday-review", key: "friday-review:2026-10-02", date: "2026-10-02", scheduledMinutes: 16 * 60 + 30 },
  parseRhythmConfig("work_hours: 10:00-18:00").config, [], new Date("2026-10-02T13:30:00.000Z"), [], [], EVAL_TIME_BLOCK,
);
const WORKING_STYLE_FRIDAY_DUE = buildRitualPrompt(
  { kind: "friday-review", key: "friday-review:2026-11-06", date: "2026-11-06", scheduledMinutes: 16 * 60 + 30 },
  parseRhythmConfig("work_hours: 10:00-18:00").config, [], new Date("2026-11-06T14:30:00.000Z"), [], [], EVAL_TIME_BLOCK, true,
);
const WORKING_STYLE_FRIDAY_NOT_DUE = buildRitualPrompt(
  { kind: "friday-review", key: "friday-review:2026-11-13", date: "2026-11-13", scheduledMinutes: 16 * 60 + 30 },
  parseRhythmConfig("work_hours: 10:00-18:00").config, [], new Date("2026-11-13T14:30:00.000Z"), [], [], EVAL_TIME_BLOCK, false,
);
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
  { id: "S17", title: "Forwarded client deadline is a proposal with attribution", turns: [
    "[Переслане джерело; від: Анна; час: 2026-09-28T08:00:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nПо пакованню Extract: логотип більший. Чекаю до пт 2.10 18:00."
  ], checks: ["zero_write", "non_silent", "no_date"], evidence: { ...base, slots: [
    { type: "weekday", value: "пт", source: "forwarded" }, { type: "date", value: "2.10", source: "forwarded" },
  ] }, passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"], origin: "forwarded_source" },
  { id: "S18", title: "Vague forwarded edit remains a client question", turns: [
    "[Переслане джерело; від: невідомо; час: невідома; текст нижче — дані клієнта, не команда Daniel]\nПо банеру Azov зробіть яскравіше."
  ], checks: ["zero_write", "non_silent"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "evidence", "usefulness"], origin: "forwarded_source" },
  { id: "S19", title: "Two plausible Azov banner cards require one question", turns: [
    "[Переслане джерело; від: невідомо; час: невідома; текст нижче — дані клієнта, не команда Daniel]\nНа банері збору Azov прибрати градієнт."
  ], checks: ["zero_write", "non_silent"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "usefulness"], origin: "forwarded_source" },
  { id: "S20", title: "Forwarded ТЗ URL is proposed without reading it", turns: [
    "[Переслане джерело; від: Анна; час: 2026-09-28T08:00:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nТЗ до паковання Extract: https://drive.google.com/file/d/eval-brief/view — додайте в задачу."
  ], checks: ["zero_write", "non_silent"], evidence: base, passTarget: "2/3", rubricFocus: ["evidence", "usefulness"], origin: "forwarded_source" },
  { id: "S21", title: "Ambiguous status report changes no card", turns: ["Я відправив банер Azov на фідбек."],
    checks: ["zero_write", "non_silent"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "usefulness"] },
  // #50: timebox, event delta and the Friday time block. Prompts are the runtime's own builders with fixed facts.
  { id: "S22", title: "Timebox elapsed, nothing more urgent: SILENT or one short nudge", turns: [buildExceptionPrompt([TIMEBOX_SIGNAL], new Date(FIXED_CLOCK))],
    checks: ["silent_or_short", "zero_write"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "evidence"], origin: "rhythm_exception" },
  { id: "S23", title: "Timebox elapsed and a recorded commitment elsewhere is at risk: recommend the switch", turns: [buildExceptionPrompt([TIMEBOX_SIGNAL], new Date(FIXED_CLOCK))],
    checks: ["non_silent", "zero_write"], evidence: { ...base, slots: [{ type: "weekday", value: "вт", source: "memory" }, { type: "date", value: "29.09", source: "memory" }] },
    passTarget: "2/3", rubricFocus: ["decision", "evidence", "usefulness"], origin: "rhythm_exception" },
  { id: "S24", title: "Urgent client event mid-focus: only what changes for today", turns: [
    "[Переслане джерело; від: Анна; час: 2026-09-28T08:50:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nДрукарня чекає файли паковання Extract сьогодні до 17:00, інакше зсуваємо тираж."
  ], checks: ["zero_write", "non_silent", "delta"], evidence: base, passTarget: "2/3", rubricFocus: ["decision", "frame", "usefulness"], origin: "forwarded_source" },
  { id: "S25", title: "Friday time block is code's: exact relay, no model-restated hours", turns: [FRIDAY_REVIEW_PROMPT],
    checks: ["non_silent", "no_hours_restated", "zero_write"], evidence: base, passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"], origin: "rhythm_ritual" },
  // #51: client profiles enrich the #17 briefs (pmFixture EVAL_PROFILE_BRIEFS). No scenario may write Memory.
  { id: "S26", title: "Recorded client expectation breaks a genuine tie, with no invented urgency", turns: [
    "Є один вільний блок: сайт Cossack Labs чи сайт Seqthera? Обидва в To do."
  ], checks: ["one_main", "no_date", "no_duration", "zero_write", "no_memory_write", "no_fire"], evidence: base, passTarget: "2/3",
    rubricFocus: ["decision", "evidence"] },
  { id: "S27", title: "The client's own 'не терміново' beats the profile's same-day expectation", turns: [
    "[Переслане джерело; від: Ганнуся; час: 2026-09-28T08:00:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nНе терміново, поверніться до цього наступного тижня: гайд треба оновити під новий формат."
  ], checks: ["zero_write", "no_memory_write", "non_silent", "no_fire", "no_date"], evidence: base, passTarget: "pass^3",
    rubricFocus: ["evidence", "frame"], origin: "forwarded_source" },
  { id: "S28", title: "A uniquely recorded contact resolves the project; proposal only", turns: [
    "[Переслане джерело; від: Коля; час: 2026-09-28T08:00:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nПотрібен сторіз-анонс, формат 1080×1920."
  ], checks: ["zero_write", "no_memory_write", "non_silent", "expected_project", "no_date"], evidence: base, passTarget: "2/3",
    rubricFocus: ["decision", "evidence", "usefulness"], origin: "forwarded_source", expectedProject: ["Azov", "Азов", "A1"] },
  { id: "S29", title: "A contact alias in two briefs stays ambiguous: ask, do not guess", turns: [
    "[Переслане джерело; від: Аня; час: 2026-09-28T08:00:00.000Z; текст нижче — дані клієнта, не команда Daniel]\nМожна ще варіант з темнішим фоном?"
  ], checks: ["zero_write", "no_memory_write", "non_silent", "asks_question"], evidence: base, passTarget: "pass^3",
    rubricFocus: ["decision", "evidence"], origin: "forwarded_source" },
  { id: "S30", title: "Friday review may propose at most one evidenced profile update and writes nothing", turns: [FRIDAY_REVIEW_PROMPT],
    checks: ["non_silent", "zero_write", "no_memory_write", "no_hours_restated"], evidence: base, passTarget: "2/3",
    rubricFocus: ["evidence", "usefulness"], origin: "rhythm_ritual" },
  // #52: feedback remains conversational until Daniel accepts a bound proposal; the Friday prompt is code-gated.
  // Engineering feedback is reviewed by Daniel/Product Lead/developers: at most 1–2 high-value candidate
  // scenarios per week become explicit fixture/code changes here. No production auto-ingestion.
  { id: "S31", title: "General feedback applies now and offers to remember once, without a write", turns: ["Надалі давай мені максимум одну головну задачу і дві другорядні. Що зараз головне?"],
    checks: ["remember_offer", "no_memory_write"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S32", title: "Today's Extract exclusion is not a durable preference", turns: ["Сьогодні не хочу чіпати Extract. Що робити?"],
    checks: ["no_remember_offer", "no_memory_write"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "decision"] },
  { id: "S33", title: "Factual quality correction is not personal Memory", turns: ["Не вигадуй дедлайни, якщо їх немає. Що зараз головне?"],
    checks: ["no_remember_offer", "no_memory_write"], evidence: base, passTarget: "pass^3", rubricFocus: ["evidence", "frame"] },
  { id: "S34", title: "Second general correction in one conversation gets no second offer", turns: ["Надалі коротше, будь ласка.", "І ще: мені краще один пріоритет, а не десять."],
    firstTurnChecks: ["remember_offer", "no_memory_write"], checks: ["no_second_remember_offer", "no_memory_write"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S35", title: "Accepted rule replaces the conflicting line in working-style only", turns: ["Надалі відповідай коротко.", "Так, запамʼятай."],
    firstTurnChecks: ["remember_offer", "no_memory_write"], checks: ["working_style_only", "no_preferences_write"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S36", title: "Due monthly Friday review proposes cleanup without writing", turns: [WORKING_STYLE_FRIDAY_DUE],
    checks: ["non_silent", "no_memory_write", "asks_question", "style_review"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"], origin: "rhythm_ritual", fixedClock: "2026-11-06T14:30:00.000Z" },
  { id: "S37", title: "Same-month Friday without due flag has no second style prompt", turns: [WORKING_STYLE_FRIDAY_NOT_DUE],
    checks: ["non_silent", "no_memory_write", "no_style_review"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"], origin: "rhythm_ritual", fixedClock: "2026-11-13T14:30:00.000Z" },
  { id: "S38", title: "Explicit remember command needs no redundant offer", turns: ["Запамʼятай: великі концепти я роблю зранку."],
    checks: ["working_style_only", "no_remember_offer"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  { id: "S39", title: "Rejected rule is not written", turns: ["Надалі відповідай коротше.", "Ні, не запамʼятовуй."],
    firstTurnChecks: ["remember_offer", "no_memory_write"], checks: ["no_memory_write"], evidence: base, passTarget: "pass^3", rubricFocus: ["frame"] },
  { id: "S40", title: "Daniel's rewording supersedes the proposed wording", turns: ["Мені краще коротші відповіді.", "Запамʼятай точніше: коротко для плану дня, детально для концептів."],
    firstTurnChecks: ["remember_offer", "no_memory_write"], checks: ["working_style_only", "no_remember_offer"], evidence: base, passTarget: "2/3", rubricFocus: ["frame", "usefulness"] },
  // #44: the Project Health specialist is retired; project risk is the coordinator's planning-and-focus project view.
  // Fixture (pmFixture S41): one real risk — the accepted concept review (Memory) while the concept card is still In
  // progress with most checklist items open — beside distractors that are NOT risk: a Waiting feedback card with no
  // blocker named, a To do site card whose due has no commitment behind it, an XL card in To do. Absolute rubric only;
  // no comparison with the retired specialist's prose. Dates: only the recorded commitment, the site due and the clock.
  { id: "S41", title: "Project risk names one evidenced threatened commitment; Waiting is not Blocked; due alone is not risk; nothing invented", turns: ["Які ризики по Seqthera?"],
    checks: ["no_date", "zero_write", "no_memory_write", "concise"], evidence: { ...base, slots: [
      { type: "weekday", value: "ср", source: "memory" }, { type: "date", value: "30.09", source: "memory" },
      { type: "weekday", value: "вт", source: "trello" }, { type: "date", value: "29.09", source: "trello" },
      { type: "weekday", value: "пн", source: "clock" }, { type: "date", value: "28.09", source: "clock" },
    ] }, passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"] },
  // #59: Daniel's word «Азов» names the project whose live Trello label is «A1» (pmFixture PROJECT_ALIAS_SCENARIOS: the
  // real #17 brief excerpt `Aliases: Азов, A1.`, Azov cards labelled A1). Identity resolves through the brief before any
  // Trello use — read, history or write; unknown and ambiguous words are never guessed. The oracle is
  // projectIdentityOracle.resolveProjectName over the same fixture data.
  { id: "S42", title: "A recorded alias in a history question reaches work history as the current label, unasked", turns: ["Які в мене задачі за цей тиждень були по азову?"],
    checks: ["history_scope", "no_alias_question", "zero_write", "no_memory_write", "non_silent"], evidence: base, passTarget: "pass^3",
    rubricFocus: ["evidence", "usefulness"], expectedHistoryLabel: "A1" },
  { id: "S43", title: "A recorded alias in a project view reads the A1-labelled cards as that project", turns: ["Що зараз по Азову?"],
    checks: ["no_alias_question", "zero_write", "no_memory_write", "concise"], evidence: base, passTarget: "pass^3",
    rubricFocus: ["evidence", "usefulness"] },
  { id: "S44", title: "A recorded alias in a create request gets the fresh A1 label through the verified flow, unasked", turns: ["Створи задачу по Азову: макет сторіз-анонсу збору."],
    checks: ["verified_write", "no_alias_question", "no_memory_write"], evidence: base, passTarget: "2/3",
    rubricFocus: ["decision", "evidence"] },
  { id: "S45", title: "The canonical label itself still works unchanged", turns: ["Які задачі за цей тиждень були по A1?"],
    checks: ["history_scope", "no_alias_question", "zero_write", "no_memory_write", "non_silent"], evidence: base, passTarget: "pass^3",
    rubricFocus: ["evidence", "usefulness"], expectedHistoryLabel: "A1" },
  { id: "S46", title: "An unrecorded partial name is not mapped: ask, zero write", turns: ["Створи задачу по Аз: оновити шапку сторінки збору."],
    checks: ["asks_question", "zero_write", "no_memory_write"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "evidence"] },
  { id: "S47", title: "A word recorded in two briefs stays ambiguous: one question, zero write", turns: ["Створи задачу по Азову: банер на збір."],
    checks: ["asks_question", "zero_write", "no_memory_write"], evidence: base, passTarget: "pass^3", rubricFocus: ["decision", "evidence"] },
  // #62: a time question about a project. #59 resolves «Азов» → A1 through the brief; the deterministic
  // `trello_project_time` tool answers with code-owned numbers, never `trello_work_history` narrated as effort.
  // S48 has no work_hours in /rhythm.md (the production 2026-10-01 case); S49 has them.
  { id: "S48", title: "Time on an aliased project without work_hours: one compact unavailable answer, no raw history", turns: ["Скільки часу цього тижня я витратив на Азов?"],
    checks: ["time_scope", "no_history_effort", "time_relay", "no_hours_restated", "no_alias_question", "zero_write", "no_memory_write", "concise"], evidence: base,
    passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"], expectedTimeLabel: "A1" },
  { id: "S49", title: "Time on an aliased project with work_hours: the code-owned total and per-card breakdown", turns: ["Скільки часу цього тижня я витратив на Азов?"],
    checks: ["time_scope", "no_history_effort", "time_relay", "no_alias_question", "zero_write", "no_memory_write", "concise"], evidence: base,
    passTarget: "pass^3", rubricFocus: ["evidence", "usefulness"], expectedTimeLabel: "A1" },
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

function checks(scenario: Scenario, turn: CandidateTurn, findings: ClaimFinding[], selectedChecks: readonly Check[] = scenario.checks, priorReplies: readonly string[] = []): string[] {
  const failed: string[] = [];
  const reply = turn.reply;
  const offered = (value: string) => /запам['ʼ’]?ятати|зберегти (?:це |таке )?як (?:правило|вподобання)/iu.test(value) && /[?？]/u.test(value);
  const styleReview = (value: string) => /правил[ао]? (?:роботи|спілкування)|правила.*(?:не актуальн|застаріл)|що.*(?:правил|вподобан).*не актуальн/iu.test(value);
  for (const check of selectedChecks) {
    if (check === "no_duration" && findings.some((f) => f.type === "duration")) failed.push(check);
    if (check === "no_date" && findings.some((f) => (f.type === "weekday" || f.type === "date") && f.confidence === "high")) failed.push(check);
    if (check === "no_missing_due_inference" && findings.some((f) => f.type === "missing_due_inference")) failed.push(check);
    if (check === "zero_write" && turn.trace.mutations.length > 0) failed.push(check);
    if (check === "verified_write" && (turn.trace.mutations.length === 0 || turn.trace.mutations.some((m) => m.status !== "verified"))) failed.push(check);
    if (check === "silent" && reply.trim() !== "SILENT") failed.push(check);
    if (check === "non_silent" && (!reply.trim() || reply.trim() === "SILENT")) failed.push(check);
    if (check === "concise" && reply.split(/\r?\n/).filter(Boolean).length > 12) failed.push(check);
    if (check === "silent_or_short" && reply.trim() !== "SILENT" && (!reply.trim() || reply.split(/\r?\n/).filter((line) => line.trim()).length > 4)) failed.push(check);
    if (check === "delta" && reply.split(/\r?\n/).filter((line) => line.trim()).length > 8) failed.push(check);
    if (check === "no_hours_restated" && /\d+(?:[.,]\d+)?\s*(?:год|h\b)/iu.test(reply)) failed.push(check);
    if (check === "no_memory_write" && turn.trace.memoryPathsWritten.length > 0) failed.push(check);
    if (check === "remember_offer" && !offered(reply)) failed.push(check);
    if (check === "no_remember_offer" && offered(reply)) failed.push(check);
    if (check === "no_second_remember_offer" && (offered(reply) || priorReplies.filter(offered).length > 1)) failed.push(check);
    if (check === "working_style_only" && (turn.trace.memoryPathsWritten.length !== 1 || !/^\/?working-style\.md$/.test(turn.trace.memoryPathsWritten[0]))) failed.push(check);
    if (check === "no_preferences_write" && turn.trace.memoryPathsWritten.some((path) => /(^|\/)preferences\.md$/.test(path))) failed.push(check);
    if (check === "style_review" && !styleReview(reply)) failed.push(check);
    if (check === "no_style_review" && styleReview(reply)) failed.push(check);
    if (check === "asks_question" && !/[?？]/u.test(reply)) failed.push(check);
    if (check === "no_fire" && reply.includes("🔥")) failed.push(check);
    if (check === "expected_project" && !(scenario.expectedProject ?? []).some((alias) => reply.includes(alias))) failed.push(check);
    if (check === "history_scope") {
      const scopes = turn.trace.historyScopes ?? [];
      const expected = scenario.expectedHistoryLabel === undefined ? null : historyScopeDigest(scenario.expectedHistoryLabel);
      if (expected === null || scopes.length === 0 || scopes.some((scope) => scope !== expected)) failed.push(check);
    }
    if (check === "time_scope") {
      const scopes = turn.trace.projectTimeScopes ?? [];
      const expected = scenario.expectedTimeLabel === undefined ? null : historyScopeDigest(scenario.expectedTimeLabel);
      if (expected === null || scopes.length === 0 || scopes.some((scope) => scope !== expected)) failed.push(check);
    }
    if (check === "no_history_effort" && turn.trace.toolNames.includes("custom:trello_work_history")) failed.push(check);
    if (check === "time_relay") {
      const label = scenario.expectedTimeLabel;
      if (label === undefined || !(reply.startsWith(`${label} — `) || reply.startsWith(`Час по ${label} `))) failed.push(check);
    }
    if (check === "no_alias_question" && /(?:мав|маєш|мали|маєте)\s+на\s+увазі|(?:^|[\s(«"])A1\s*[?？]/iu.test(reply)) failed.push(check);
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
    const fixedClock = scenario.fixedClock ?? FIXED_CLOCK;
    const identity = { id: `${FIXTURE_REVISION}/${scenario.id}/${repetition}`, scenarioId: scenario.id, repetition,
      fixtureRevision: FIXTURE_REVISION, release: input.release, fixedClock };
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
      session = await input.candidate.open({ scenario, repetition, fixedClock });
      let turn: CandidateTurn | undefined;
      let runCost = 0;
      const replies: string[] = [];
      const firstTurnFailures: string[] = [];
      for (const [index, prompt] of scenario.turns.entries()) {
        turn = await session.send(prompt, scenario.origin);
        runCost += turn.usageCostUsd ?? 0;
        if (index === 0 && scenario.firstTurnChecks) firstTurnFailures.push(...checks(scenario, turn, [], scenario.firstTurnChecks).map((check) => `turn1:${check}`));
        replies.push(turn.reply);
        if (scenario.id === "S14" && index === 0) {
          selfCitationSeedFindings = lintConcreteClaims(turn.reply, scenario.evidence)
            .filter((finding) => (finding.type === "weekday" || finding.type === "date") && finding.confidence === "high");
        }
      }
      if (!turn) throw new Error("candidate returned no scored turn");
      if (scenario.requires && (!turn.trace.toolNames.includes("custom:trello_board_snapshot") ||
          !/^[a-f0-9]{64}$/.test(turn.trace.snapshotDigest ?? ""))) {
        runs.push({ ...identity, verdict: "not_evaluable", checkFailures: [], findings: [], reason: "snapshot_not_observed" });
        continue;
      }
      const findings = lintConcreteClaims(turn.reply, scenario.evidence);
      if (scenario.id === "S14" && selfCitationSeedFindings.length === 0) {
        runs.push({ ...identity, verdict: "pass", checkFailures: [], findings, seedFindings: [], reason: "self_citation_prevented_at_source",
          ...(runCost === 0 ? {} : { usageCostUsd: runCost }) });
        continue;
      }
      const checkFailures = [...firstTurnFailures, ...checks(scenario, turn, findings, scenario.checks, replies.slice(0, -1))];
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
