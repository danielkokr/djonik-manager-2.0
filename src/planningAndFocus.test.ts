import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DJONIK_MEMORY_INSTRUCTIONS } from "./djonikClient.js";

// #42 — planning-and-focus: the single owner of "what should Daniel focus on" (daily-planning + weekly-planning
// merged), and the Memory places it reads. OFFLINE source tests. They pin decisions, ownership and boundaries —
// concepts, not sentences — and prove the known failure sources of the old Skills (due-first ladder, "name
// everything deferred", day-by-day precision) are gone. They do not prove model behaviour; that needs the
// separately authorized live check.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(repoRoot, ".claude", "skills");
const read = (...path: string[]) => readFileSync(join(repoRoot, ...path), "utf8").replace(/\r\n?/g, "\n");
const skill = read(".claude", "skills", "planning-and-focus", "SKILL.md");
const [, frontmatter = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill) ?? [];
const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
const section = (heading: string) => {
  const start = body.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `expected a '${heading}' section`);
  const next = body.indexOf("\n## ", start + 1);
  return next >= 0 ? body.slice(start, next) : body.slice(start);
};
/** One bullet of a section, found by a concept it must be about. */
const bullet = (heading: string, concept: RegExp) => {
  const line = section(heading).split("\n").find((candidate) => candidate.startsWith("- ") && concept.test(candidate));
  assert.ok(line, `expected a '${heading}' bullet about ${concept}`);
  return line;
};
const coordinator = read("managed-agents", "djonik.md");
const M = DJONIK_MEMORY_INSTRUCTIONS;

// --- Ownership ------------------------------------------------------------------------------------

test("planning-and-focus exists with valid frontmatter and replaces both old planning Skills", () => {
  assert.match(skill, /^---\nname: planning-and-focus\ndescription: .+\n---\n/);
  assert.equal(existsSync(join(skillsDir, "daily-planning")), false);
  assert.equal(existsSync(join(skillsDir, "weekly-planning")), false);
});

test("its trigger covers the everyday focus phrases, for any horizon, and claims no mutation", () => {
  // The phrases the issue names as ownerless before #42 — these are the trigger contract, not prose.
  for (const phrase of ["що далі", "сьогодні", "тиждень", "що горить", "перенести", "3 години тільки Seqthera", "Extract не чіпаю", "по Azov що в мене", "поміняй місцями"]) {
    assert.ok(description.includes(phrase), `trigger lacks "${phrase}"`);
  }
  assert.match(description, /hour[^.]*day[^.]*week/i, "one Skill for every horizon");
  assert.match(description, /never changes Trello/i);
});

test("it is the single planning owner: no other coordinator Skill claims plan or focus questions", () => {
  const cues = /що мені робити|з чого почати|як розкласти|що далі|що горить|plan\/order of work|daily work plan|weekly work plan/i;
  for (const name of readdirSync(skillsDir)) {
    // pm-rhythm owns only the automatic-turn format (#39); project-health belongs to the specialist, not the coordinator.
    if (name === "planning-and-focus" || name === "pm-rhythm" || name === "project-health") continue;
    const other = read(".claude", "skills", name, "SKILL.md");
    const otherDescription = /^description: (.+)$/m.exec(other)?.[1] ?? "";
    assert.doesNotMatch(otherDescription, cues, `${name} must not claim planning`);
    assert.doesNotMatch(other, /daily-planning|weekly-planning/, `${name} must not hand off to a retired Skill`);
  }
  assert.doesNotMatch(skill, /daily-planning|weekly-planning|\[\[/, "no references to retired Skills, no [[…]] link syntax");
});

test("one decision at two zoom levels — not a day procedure plus a week procedure", () => {
  assert.doesNotMatch(body, /^## (?:Daily|Weekly|Day|Week)\b/m, "no per-horizon sections");
  assert.match(body, /same decision/i);
});

// --- The decision --------------------------------------------------------------------------------

test("explicit-instruction precedence: the plan follows Daniel's words; a broken obligation is warned about, never used to overrule him", () => {
  const words = bullet("Decide", /His words/);
  assert.ok(section("Decide").split("\n").filter((line) => line.startsWith("- "))[0] === words, "his words are the first signal");
  assert.match(words, /real obligation/i);
  assert.match(words, /concrete consequence/i, "the conflict is surfaced as a consequence");
  assert.match(words, /plan still follows his words/i);
  assert.match(words, /his call/i);
  assert.match(words, /strongly you recommend/i, "a strong recommendation stays allowed");
  // The worked case keeps the exclusion and leaves the decision with Daniel.
  const excluded = section("Cases — the decision, not the wording").split("\n").find((line) => /Excluded project/.test(line));
  assert.ok(excluded);
  assert.match(excluded, /stays out of the plan/i);
  assert.match(excluded, /Daniel decides/i);
  // Nothing in the Skill lets an obligation or Djonik's view override what Daniel said for now.
  assert.doesNotMatch(skill, /override[sn]? (?:his|Daniel's) (?:words|instruction|exclusion)|(?:ignore|disregard) (?:his|Daniel's) (?:words|instruction)/i);
});

test("no due-first ladder: a due is a signal to check, and the first signal is Daniel's own words", () => {
  const commitment = bullet("Decide", /Commitment/);
  assert.match(commitment, /waiting for[^.]*outranks[^.]*only has a date/i);
  assert.match(commitment, /own marker/i);
  // The old ladders (daily "due dates and how soon", weekly "recorded due dates → in-progress → …") are gone.
  assert.doesNotMatch(skill, /due(?: dates?)?\s*(?:→|->|first\b)|how soon|soonest/i);
});

test("judgement, not a formula: no score, weights, points or fixed order", () => {
  assert.match(section("Decide"), /no score and no fixed order/i);
  assert.doesNotMatch(skill, /\d+\s*(?:points?|pts)\b|\bweights?\s*[:=]|\bscore\s*[:=(]|×\s*\d|\d\s*×|\d+\s*%/i);
});

test("the PM signals: finishing, WIP, passing the ball, week frame, fit, Waiting and Backlog", () => {
  const finish = bullet("Decide", /Finish before starting/);
  assert.match(finish, /lastActivityAt/, "in progress comes from the list or card, never from activity");
  assert.match(finish, /two or three/i, "a soft WIP limit");
  assert.match(finish, /One or two projects a day/i);
  assert.match(bullet("Decide", /Pass the ball/), /feedback/i);
  const week = bullet("Decide", /Week frame/);
  assert.match(week, /accepted week plan/i);
  assert.match(week, /priorities\.md/);
  assert.match(bullet("Decide", /\*\*Fit/), /Do not invent hours/i);
  const waiting = bullet("Decide", /Waiting and Backlog/);
  assert.match(waiting, /check is due/i);
  assert.match(waiting, /Backlog is a queue/i);
});

test("focus limits: a dedicated block narrows the choice to that project; an excluded project leaves today's answer", () => {
  const words = bullet("Decide", /His words/);
  assert.match(words, /3 години тільки Seqthera[^.]*inside Seqthera/i);
  assert.match(words, /other projects go quiet/i);
  assert.match(words, /Extract не чіпаю[^.]*Extract leaves today's answer/i);
});

test("ask only when a wrong guess would be costly; otherwise take the likely reading and name it", () => {
  const commitment = bullet("Decide", /Commitment/);
  assert.match(commitment, /likely reading and name it/i);
  assert.match(commitment, /Ask[^.]*only when a wrong guess would be costly/i);
});

// --- The answer ----------------------------------------------------------------------------------

test("short answers: one main thing, up to two secondary, the rest can wait, at most one risk; details on request", () => {
  const shape = bullet("Answer", /main thing/);
  for (const part of [/One main thing/i, /up to two secondary/i, /rest can wait/i, /at most one risk/i]) assert.match(shape, part);
  assert.match(bullet("Answer", /on request/), /Details/i);
});

test("no board dump: deferred work is not enumerated — named only when Daniel would expect it now", () => {
  assert.match(bullet("Answer", /inventory/), /Do not inventory what you leave out/i);
  assert.match(bullet("Answer", /inventory/), /expect it now/i);
  // The old instructions that produced lists of deferrals are gone.
  assert.doesNotMatch(skill, /Never silently drop|name it as deferred|what didn't make|named note/i);
});

test("the week answer has a few outcomes and trade-offs, not a day-by-day grid", () => {
  const week = bullet("Answer", /\*\*Week/);
  assert.match(week, /Up to three outcomes/i);
  assert.match(week, /overloaded/i);
  assert.match(week, /No day-by-day grid unless he asks/i);
  assert.doesNotMatch(skill, /spread realistically across days|Distribute across the week|Mon–Fri slot/i);
});

test("'що горить?' names only real fires, and says so when there is none", () => {
  const fire = bullet("Answer", /Що горить/);
  assert.match(fire, /commitment at risk/i);
  assert.match(fire, /If nothing is, say so/i);
});

test("project view: in progress, next step, waiting, one risk — and a full health review stays with the specialist", () => {
  const view = bullet("Answer", /Project view/);
  for (const part of [/in progress/i, /next step/i, /waiting on whom/i, /one risk/i, /not the card list/i]) assert.match(view, part);
  assert.match(view, /health review[^.]*Project Health specialist/i);
  // The coordinator states the same boundary, so delegation and the Skill agree.
  assert.match(coordinator, /"по X що в мене\?"[^.]*focus planning/);
});

// --- Evidence, plans and Trello ----------------------------------------------------------------------

test("fresh Trello before every plan, rebuild or correction; facts, decisions and judgement stay distinguishable", () => {
  const fresh = bullet("Evidence", /fresh Trello/);
  assert.match(fresh, /every plan, rebuild or correction/i);
  assert.match(fresh, /earlier answer is not evidence/i);
  assert.match(bullet("Evidence", /distinguishable/), /Trello says[^.]*Memory says[^.]*choice is yours/i);
});

test("#41 clock: dates come from the clock line; the Skill carries no date arithmetic of its own", () => {
  assert.match(bullet("Evidence", /clock line/), /do not compute/i);
  assert.doesNotMatch(skill, /getDay|\bUTC\b|\btimezone\b|\+\s*\d+\s*days?|days? from now|count(?:ing)? (?:the )?days/i);
});

test("a plan is not a Trello mutation; an explicit card change follows task-management's verified path", () => {
  const plan = bullet("Plans, corrections and Trello", /A plan is conversation/);
  assert.match(plan, /creates, moves or re-dates nothing/i);
  assert.match(plan, /change the plan, not the board/i);
  assert.match(plan, /task-management Skill and its verified write/i);
  assert.doesNotMatch(skill, /trelloWrite/);
});

test("a correction continues the same plan, re-checked against fresh Trello", () => {
  const correction = bullet("Plans, corrections and Trello", /correction/);
  assert.match(correction, /plan under discussion/i);
  assert.match(correction, /re-check fresh Trello/i);
  assert.match(correction, /Do not start a second plan/i);
});

test("the accepted week plan is written only on explicit acceptance, where the Memory instructions say; a day focus is not stored", () => {
  const accepted = bullet("Plans, corrections and Trello", /accepted plan/);
  assert.match(accepted, /only when Daniel explicitly accepts it/i);
  assert.match(accepted, /plans\/current-week\.md/);
  assert.match(accepted, /Memory instructions/);
  assert.match(accepted, /day focus is not stored/i);
});

// --- Cases -------------------------------------------------------------------------------------------

test("a small set of canonical cases teaches decisions, covering the situations Daniel actually hits", () => {
  const cases = section("Cases — the decision, not the wording");
  const items = cases.split("\n").filter((line) => /^\d+\. \*\*/.test(line));
  assert.ok(items.length >= 5 && items.length <= 8, `5–8 cases, got ${items.length}`);
  for (const situation of [/due vs real commitment/i, /Almost done/i, /Pass the ball/i, /Focus block/i, /Excluded project/i, /Overloaded week/i, /Project view/i]) {
    assert.match(cases, situation);
  }
  assert.match(cases, /illustrative/i);
  // Decisions, not reply templates: no case prescribes a quoted Telegram answer.
  for (const item of items) assert.doesNotMatch(item, /→\s*«/, "a case states the decision, not a reply to copy");
});

test("the merged Skill is smaller than the two it replaces", () => {
  const bytes = Buffer.byteLength(skill, "utf8");
  assert.ok(bytes < 5558 + 8307, `planning-and-focus is ${bytes} B; daily + weekly were 13 865 B`);
  assert.ok(bytes <= 8000, `review planning-and-focus growth (${bytes} B); 8000 is an editorial heuristic`);
});

// --- Memory contract (#42) -----------------------------------------------------------------------------

const places = () => {
  const start = M.indexOf("Fixed places:");
  assert.ok(start >= 0, "the Memory instructions name fixed places");
  return M.slice(start, M.indexOf("\n\nCommitments"));
};

test("#42 Memory: working-style.md holds only what Daniel states or accepts — never an inferred profile", () => {
  assert.match(places(), /working-style.md[^;]{0,60}states or accepts[^;]{0,20}never inferred/i);
});

test("#42 Memory: plans/current-week.md — one accepted week plan with a week marker from the clock", () => {
  assert.match(places(), /plans\/current-week\.md is the one accepted week plan/);
  assert.match(places(), /week: <[^>]*Monday[^>]*clock line>/, "a week marker, taken from the clock line");
  assert.match(places(), /up to 3 outcomes/i);
});

test("#42 Memory: the week plan lifecycle — only on acceptance; replaced by the next one, edited on an accepted change, stale in another week", () => {
  assert.match(places(), /newly accepted week plan replaces it/i);
  assert.match(places(), /accepted change edits it/i);
  assert.match(places(), /Another week's plan is not this week's frame/i);
  assert.match(M, /A suggestion is not a plan: only write an accepted plan or commitment when the user's acceptance\/commitment is actually explicit/);
});

test("#42 Memory: accepted context is never live task state — no day plans, no card fields, fresh reads win", () => {
  assert.match(places(), /No day plans/i);
  assert.match(places(), /no card state/i);
  assert.match(M, /Do not store live Trello\/task state/);
  assert.match(M, /fresh external tool reads always outrank what is remembered here for current status/);
  assert.doesNotMatch(places(), /\b(?:list|due|labels?|members?|checklists?|lastActivityAt)\b\s*:/, "no Trello field in the plan record");
});

test("#42 Memory: the Skill, the Memory instructions and the unchanged pm-rhythm agree on the week plan's place", () => {
  for (const path of ["plans/current-week.md", "working-style.md"]) {
    assert.ok(M.includes(path), `Memory instructions name ${path}`);
    assert.ok(skill.includes(path), `planning-and-focus reads ${path}`);
  }
  // pm-rhythm (#39, unchanged) records an accepted Monday plan "following the Memory instructions for accepted
  // plans" — which now name the one fixed place. The layout itself lives only in the Memory instructions.
  assert.match(read(".claude", "skills", "pm-rhythm", "SKILL.md"), /record the accepted week plan in Memory, following the Memory instructions for accepted plans/);
  assert.doesNotMatch(coordinator, /current-week\.md|working-style\.md/, "the coordinator does not duplicate the Memory layout");
});

test("#42 Memory: the #34 date discipline still holds — the week marker is Daniel's clock, never a guessed date", () => {
  assert.equal(M.match(/YYYY-MM-DD/g)?.length, 1, "the only exact-date format stays the conditional next_check one");
  assert.doesNotMatch(M, /<date|timestamp|today's date\)/i);
});
