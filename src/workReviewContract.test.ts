import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRELLO_WORK_HISTORY_TOOL, TRELLO_WORK_HISTORY_TOOL_NEXT } from "./trelloWorkHistory.js";
import {
  WORK_REVIEW_RUBRIC,
  extractEvidenceTrace,
  gradeEvidenceAcquisition,
  lintWeekJudgement,
  lintWorkReviewAnswer,
} from "./workReviewRubric.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(root, ".claude", "skills", "work-review", "SKILL.md"), "utf8");

test("#36 work-review Skill has current required YAML frontmatter", () => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
  assert.ok(match, "SKILL.md must begin with YAML frontmatter");
  const frontmatter = match[1];
  assert.match(frontmatter, /^name: work-review$/m);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";
  assert.ok(description.length > 0, "frontmatter description must be non-empty");
  assert.match(description, /Trello action history/i);
  assert.match(description, /this week, last week, or an explicit date range/i);
});

// #29's rubric/source remains historical evidence. These assertions replace only its now-superseded
// current-state Skill contract with #36's action-history tool contract.
test("#36 work-review Skill is thin, history-first, actor-safe and read-only", () => {
  // #69 raised the cap from 3 KB to 4 KB for one paragraph: how a week is judged. Still a thin Skill.
  assert.ok(Buffer.byteLength(skill, "utf8") <= 4 * 1024);
  assert.match(skill, /trello_work_history/);
  assert.match(skill, /на дошці перейшло в Done/);
  assert.match(skill, /not «ти зробив» or «Daniel завершив»/);
  assert.match(skill, /coverage/i);
  assert.match(skill, /Project Health remains its own capability/);
  assert.match(skill, /history is unavailable/i);
  assert.match(skill, /Do not write Trello, Calendar, or Memory/);
  assert.doesNotMatch(skill, /lastActivityAt/);
  assert.match(skill, /Do not make Project Health judgements, productivity scores, effort\/time claims, trend analysis/i);
});

// docs/28 #36 output-ownership remediation: three local-remediation candidates (docs/27) proved that
// handing Claude the factual content of a review — however pre-rendered, down to a fully-complete
// `answer_text` — still lets it add unsupported interpretation or drop a sentence while restating it.
// The accepted fix moves relay of the authoritative factual block OUT of the model entirely: the thin
// client now delivers `answer_text` verbatim by provenance (`src/djonikClient.ts`), so the Skill's job
// changes from "relay this exactly" to "do not touch it at all" plus one short PM-owned addition.
test("#36 work-review Skill treats answer_text as delivered by the client, not something Claude relays or rewrites", () => {
  assert.match(skill, /answer_text/);
  assert.doesNotMatch(skill, /fact_lines/);
  assert.match(skill, /client delivers it to Daniel verbatim/i);
  assert.match(skill, /do not repeat, rewrite, reformat, or summarize/i);
  assert.match(skill, /ONE short PM-level conclusion/i);
  assert.match(skill, /схоже/);
  assert.doesNotMatch(skill, /without summarizing, categorizing, generalizing/i);
});

// #66: the old line "Choose `concise` unless Daniel asks for detail" left the model one way to learn every card name —
// `detailed`, whose block the client then showed Daniel verbatim. The Skill now maps the question to the answer shape.
test("#66 work-review Skill answers the question asked: one call, a focus for a narrow question, detail only on Daniel's request", () => {
  assert.match(skill, /Answer the question Daniel asked, with one call/);
  assert.match(skill, /default `focus: overview`/);
  for (const focus of ["completed", "returned", "created", "archived", "moved"]) assert.match(skill, new RegExp(`\`${focus}\``));
  assert.match(skill, /only that deduplicated card list/);
  assert.match(skill, /`response_format: detailed` is the event-by-event chronology, only when Daniel's own message asks for it/);
  assert.match(skill, /never request it to gather material for your own summary/);
  assert.match(skill, /needs no second call and no repeated facts/);
  assert.doesNotMatch(skill, /Choose `concise` unless/);
  // Every focus the Skill names is one the next tool definition accepts.
  assert.deepEqual(TRELLO_WORK_HISTORY_TOOL_NEXT.input_schema.properties.focus.enum, ["overview", "completed", "returned", "created", "archived", "moved"]);
});

test("#36 exports one bounded custom-tool schema with semantic window, scope and format inputs", () => {
  assert.equal(TRELLO_WORK_HISTORY_TOOL.type, "custom");
  assert.equal(TRELLO_WORK_HISTORY_TOOL.name, "trello_work_history");
  assert.match(TRELLO_WORK_HISTORY_TOOL.description, /read-only/i);
  const schema = JSON.stringify(TRELLO_WORK_HISTORY_TOOL.input_schema);
  for (const token of ["this_week", "last_week", "explicit", "from", "to", "project", "board", "response_format", "concise", "detailed"]) {
    assert.ok(schema.includes(token), `schema must include ${token}`);
  }
  assert.doesNotMatch(schema, /http|endpoint|url|api_key/i);
});

// These are deliberately retained from #29 as source-level regression helpers. They no longer
// prescribe the superseded current-state Skill wording, but stay useful for historical evaluation
// artifacts and must not silently lose their independent mechanics.
test("historical work-review rubric keeps all named dimensions and model-neutral severity metadata", () => {
  assert.deepEqual(WORK_REVIEW_RUBRIC.map((dimension) => dimension.id), Array.from({ length: 16 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`));
  assert.ok(WORK_REVIEW_RUBRIC.every((dimension) => dimension.severity === "critical" || dimension.severity === "major"));
});

test("historical lint helper flags unsupported chronology but leaves a human-readable due date to factual review", () => {
  const flags = lintWorkReviewAnswer("Остання закрита картка була вчора. Дедлайн: 21 вересня.");
  assert.ok(flags.some((flag) => flag.dimension === "R01"));
  assert.ok(!flags.some((flag) => flag.dimension === "R03"));
});

test("historical fresh-evidence trace counts only Trello discovery before the final message", () => {
  const trace = extractEvidenceTrace([
    { type: "agent.tool_use", name: "read", input: {} },
    { type: "agent.mcp_tool_use", mcp_server_name: "trello", name: "trelloReadBoard" },
    { type: "agent.message", content: [{ type: "text", text: "Уточнити?" }] },
    { type: "agent.mcp_tool_use", mcp_server_name: "trello", name: "trelloReadCard" },
  ]);
  assert.deepEqual(trace.trelloDiscoveryToolNames, ["trelloReadBoard"]);
  assert.equal(trace.finalMessageAsksQuestion, true);
});

test("historical fresh-evidence grader rejects a premature clarification and accepts a discovered ambiguity", () => {
  const premature = gradeEvidenceAcquisition({
    entityNamed: true,
    exactIdentitySupplied: false,
    discoveryAvailable: true,
    trace: { trelloDiscoveryCalls: 0, trelloDiscoveryToolNames: [], finalMessage: "Уточнити?", finalMessageAsksQuestion: true },
  });
  assert.equal(premature.verdict, "FAIL");
  const discovered = gradeEvidenceAcquisition({
    entityNamed: true,
    exactIdentitySupplied: false,
    discoveryAvailable: true,
    discoveryOutcome: "multiple_matches",
    trace: { trelloDiscoveryCalls: 1, trelloDiscoveryToolNames: ["trelloReadBoard"], finalMessage: "Уточнити?", finalMessageAsksQuestion: true },
  });
  assert.equal(discovered.verdict, "PASS");
});

// ---------------------------------------------------------------------------------------------
// #69: «тобто цей тиждень успішний?» was answered from activity volume, with the Done-event count retold as that many
// cards. The Skill now says what a week is judged by. A Skill test proves the instruction exists and is coherent; it
// does not prove the model follows it — that needs a separately authorized paid run (docs/04 §27).
// ---------------------------------------------------------------------------------------------

const weekRule = /\*\*«Тиждень успішний\?»\*\*[\s\S]*?with no score or percentage\./.exec(skill)?.[0] ?? "";

test("#69 work-review Skill judges a week by planned and important outcomes, in a stated evidence order", () => {
  assert.ok(weekRule.length > 0, "the week-judgement rule is one paragraph");
  assert.match(weekRule, /a judgement about outcomes, never activity/);
  // Accepted plan first, then commitments and priorities — the existing Memory conventions, no new storage.
  const order = ["plans/current-week.md", "commitments/", "priorities.md"].map((path) => weekRule.indexOf(path));
  assert.ok(order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2], "plan → commitments → priorities");
  assert.match(weekRule, /a proposal or another week's plan does not count/);
  assert.match(weekRule, /closed or clearly moved, and what stayed open, sits in Waiting or carries over/);
  assert.match(weekRule, /Counts are support at most/);
  assert.match(weekRule, /One to three sentences — verdict, what carried it, what stayed open/);
  assert.match(weekRule, /with no score or percentage/);
});

test("#69 work-review Skill keeps the three metrics apart and names what does not prove an outcome", () => {
  assert.match(weekRule, /«N карток» is unique cards that entered Done and «переходів»\/«подій» is transitions/);
  assert.match(weekRule, /never call either that many completed tasks, and neither proves a planned outcome/);
  assert.match(weekRule, /nor does a card date, a new card or a list move/);
  assert.match(weekRule, /If a planned outcome does not clearly match a card, say so/);
  // The Skill never hands the model arithmetic: it names the code's own wording, no formula, weight or threshold.
  assert.doesNotMatch(weekRule, /\d+\s*%|score of|weight|threshold|at least \d|more than \d/i);
});

test("#69 work-review Skill: without an accepted plan the assessment is partial, and counts do not stand in for it", () => {
  assert.match(weekRule, /With no accepted plan for this week, say the assessment is partial instead of letting counts stand in/);
});

test("#69 the follow-up stays a judgement: no second history call, only the missing evidence is read (#66 boundary kept)", () => {
  assert.match(skill, /needs no second call and no repeated facts/, "#66 sentence is untouched");
  assert.match(weekRule, /read it if this conversation has not/);
  assert.match(weekRule, /one `trello_board_snapshot` if their current state is not already read/);
  assert.doesNotMatch(weekRule, /trello_work_history|response_format|detailed/, "the rule never sends the model back to the history tool");
  assert.match(skill, /Do not write Trello, Calendar, or Memory during a review/);
});

// The lint is the highest deterministic reading of an ANSWER available offline. These are production-shaped texts:
// the 2026-10-09 reply (24 events retold as 24 cards, verdict from volume) and the two directions from #69.
const NOISY_WEEK = { doneEvents: 24, doneCards: 21 };
const PRODUCTION_REPLY = "Так, тиждень виглядає продуктивним: 24 картки перейшли в Done, 14 створено, лише одна повернулась із Done і ще кілька переміщень.";
const PLANNED_REPLY =
  "Скоріше так. Основні ставки тижня по Extract і Cossack Labs закрили або просунули, але RDAS лишився великим хвостом і два важливі пункти ще у Waiting. " +
  "Тобто головне зрушили, але тиждень закритий не повністю чисто.";
const NO_PLAN_REPLY =
  "Схоже, тиждень був активний і кілька важливих речей закрились, але без прийнятого плану тижня я не можу чесно сказати, що саме головне було виконано. " +
  "Тож оцінка лише часткова.";

test("#69 week-judgement lint: the production reply is flagged for the relabel and for a count-led verdict", () => {
  const flags = lintWeekJudgement(PRODUCTION_REPLY, { ...NOISY_WEEK, acceptedPlanAvailable: true });
  assert.ok(flags.includes("event_count_as_tasks"), "24 events said as 24 cards");
  assert.ok(flags.includes("count_led"), "activity volume carries the verdict");
  // The same number is not a relabel when the unit is right, or when events and cards really coincide.
  assert.ok(!lintWeekJudgement("Скоріше так: обидві ставки закрито. У Done було 24 переходи, але це тло.", { ...NOISY_WEEK, acceptedPlanAvailable: true }).includes("event_count_as_tasks"));
  assert.ok(!lintWeekJudgement("Скоріше так: обидві ставки закрито. 24 картки зайшли в Done, але це тло.", { doneEvents: 24, doneCards: 24, acceptedPlanAvailable: true }).includes("event_count_as_tasks"));
});

test("#69 week-judgement lint: a plan-based judgement passes; one supporting count with the right unit is allowed", () => {
  assert.deepEqual(lintWeekJudgement(PLANNED_REPLY, { ...NOISY_WEEK, acceptedPlanAvailable: true }), []);
  assert.deepEqual(lintWeekJudgement("Скоріше так: обидві ставки тижня закрито, RDAS переноситься. 21 картка зайшла в Done, але це лише тло.", { ...NOISY_WEEK, acceptedPlanAvailable: true }), []);
});

test("#69 week-judgement lint: with no accepted plan the answer must say it is partial", () => {
  assert.deepEqual(lintWeekJudgement(NO_PLAN_REPLY, { ...NOISY_WEEK, acceptedPlanAvailable: false }), []);
  assert.deepEqual(lintWeekJudgement(PLANNED_REPLY, { ...NOISY_WEEK, acceptedPlanAvailable: false }), ["missing_partial_note"], "certainty without a plan");
});

test("#69 week-judgement lint: a score, a long report or a repeated review block is not a judgement", () => {
  const context = { ...NOISY_WEEK, acceptedPlanAvailable: true };
  assert.ok(lintWeekJudgement("Так, тиждень на 80% успішний.", context).includes("score"));
  assert.ok(lintWeekJudgement("Тиждень 8/10. Головне закрито.", context).includes("score"));
  assert.ok(lintWeekJudgement("Так. Extract закрито. CL закрито. RDAS ні. Waiting два.", context).includes("too_long"));
  assert.ok(lintWeekJudgement("Цього тижня на дошці:\n\n- **Перейшло в Done:** 21 картка (24 переходи) — «А»\n\n---\nPM-висновок:\nТак.", context).includes("history_repeated"));
});
