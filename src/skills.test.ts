import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSkill(name: string): string {
  return readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n?/g, "\n");
}

function projectHealthSection(content: string, heading: string): string {
  const start = content.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `expected a '${heading}' section in project-health`);
  const nextHeading = content.indexOf("\n## ", start + 1);
  return nextHeading >= 0 ? content.slice(start, nextHeading) : content.slice(start);
}

// Issue #28: evidence-based, read-only project-health interpretation.

test("project-health Skill exists with valid frontmatter", () => {
  const content = readSkill("project-health");
  assert.match(content, /^---\nname: project-health\ndescription: .+\n---\n/);
});

test("project-health frontmatter covers natural health questions without claiming planning or mutation", () => {
  const frontmatter = readSkill("project-health").split("---")[1] ?? "";
  for (const phrase of ["Що зараз по Extract", "Чи є ризики", "Дай health check", "Що тут зависло або заблоковано"]) {
    assert.match(frontmatter, new RegExp(phrase, "i"));
  }
  assert.doesNotMatch(frontmatter, /Що робити сьогодні|Що робити цього тижня|create, update, move, or complete/i);
});

test("project-health explicitly hands daily, weekly, and mutation follow-ups to their owning Skills", () => {
  const section = projectHealthSection(readSkill("project-health"), "Scope and handoffs");
  assert.match(section, /daily-planning/i);
  assert.match(section, /weekly-planning/i);
  assert.match(section, /task-management/i);
});

test("project-health requires fresh Trello evidence for current claims", () => {
  const section = projectHealthSection(readSkill("project-health"), "Gather fresh evidence first");
  assert.match(section, /in this turn/i);
  assert.match(section, /fresh/i);
});

test("project-health does not trust search alone for exact due or status", () => {
  const section = projectHealthSection(readSkill("project-health"), "Gather fresh evidence first");
  assert.match(section, /trelloSearch.*discover/i);
  assert.match(section, /direct read/i);
  assert.match(section, /due/i);
  assert.match(section, /list\/status/i);
});

test("project-health keeps waiting distinct from blocked", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /Waiting may need monitoring, but is not automatically blocked/i);
});

test("project-health requires concrete evidence for blocked", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /concrete dependency or problem/i);
  assert.match(section, /Do not call an item blocked simply because/i);
});

test("project-health does not treat a Waiting list as automatic blocker evidence", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /list named .Waiting.*evidence of waiting/i);
  assert.match(section, /not automatically of blocked work/i);
});

test("project-health requires stated evidence for risk and distinguishes internal due from commitment", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /explain the specific evidence/i);
  assert.match(section, /internal Trello due date is not automatically a client commitment/i);
});

test("project-health does not treat many cards alone as risk", () => {
  assert.match(readSkill("project-health"), /many cards alone are not risk/i);
});

test("project-health has no universal risk-age or card-count threshold", () => {
  assert.match(readSkill("project-health"), /no universal age or card-count threshold for risk/i);
});

test("project-health does not treat undated work as stale", () => {
  const section = projectHealthSection(readSkill("project-health"), "Activity signal and staleness");
  assert.match(section, /undated/i);
  assert.match(section, /Do not label.*stale/i);
});

// Issue #28 correctness follow-ups after the first and second live FAILs:
// due-date wording, no model date/time arithmetic, Backlog != Waiting, simplified
// lastActivityAt/staleness, summary-not-card-dump, and label-based project resolution.

const dateSection = () => projectHealthSection(readSkill("project-health"), "Dates and deadlines");
const activitySection = () => projectHealthSection(readSkill("project-health"), "Activity signal and staleness");
const resolveSection = () => projectHealthSection(readSkill("project-health"), "Resolve the named project");

test("project-health does not derive a weekday from any Trello timestamp", () => {
  const section = dateSection();
  assert.match(section, /never derive or state: a weekday name/i);
  assert.match(section, /From a Trello timestamp/i);
  assert.match(section, /preserved accurately as read/i);
  assert.match(section, /2026-09-25T15:00:00Z/);
});

test("project-health does not convert a Trello timestamp to local or Kyiv time", () => {
  const section = dateSection();
  assert.match(section, /a local or Kyiv clock time or any timezone conversion/i);
  assert.match(section, /not a date formatter/i);
});

test("project-health forbids today/yesterday wording derived from a timestamp", () => {
  const section = dateSection();
  assert.match(section, /«сьогодні», «вчора», «завтра»/);
});

test("project-health forbids N-days-ago and N-days-from-now wording", () => {
  const section = dateSection();
  assert.match(section, /«N днів тому», «через N днів» or «N днів від тепер»/);
});

test("project-health forbids countdown and relative-age wording with no qualitative exception", () => {
  const section = dateSection();
  assert.match(section, /«менше тижня»/);
  assert.match(section, /any other exact or approximate relative-age or countdown wording/i);
  assert.match(section, /no qualitative exception/i);
  // The earlier allowance for a hedged "looks close" remark is gone.
  assert.doesNotMatch(section, /hedged/i);
  assert.doesNotMatch(section, /fine only when today's date/i);
});

test("project-health applies the date rules to both due and lastActivityAt and gives good/bad examples", () => {
  const section = dateSection();
  assert.match(section, /`due` or `lastActivityAt`/);
  assert.match(section, /quote only the authoritative recorded ISO value/i);
  assert.match(section, /Good: «У Trello дедлайн: 2026-09-25T15:00:00Z\.»/);
  assert.match(section, /Bad: «Дедлайн у пʼятницю через 6 днів\.»/);
});

test("project-health keeps exact due facts behind fresh direct evidence and leaves the due finalizer alone", () => {
  const dates = projectHealthSection(readSkill("project-health"), "Dates and deadlines");
  assert.match(dates, /Exact due facts still require a fresh direct Trello read/i);
  assert.match(dates, /task-management due handling is separate and unchanged/i);
  const gather = projectHealthSection(readSkill("project-health"), "Gather fresh evidence first");
  assert.match(gather, /only from a card's own .due./i);
});

test("project-health does not treat Backlog as Waiting", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /Backlog is a queue, not a problem: it is not Waiting, not Blocked/i);
  assert.match(section, /Being in Backlog.*is never evidence of waiting/i);
});

test("project-health does not treat undated or not-started work as Waiting", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /no due date, being undated, or not having been started is never evidence of waiting/i);
});

test("project-health requires explicit external-dependency evidence for Waiting", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /only when there is explicit evidence that the work is waiting for someone or something external/i);
  assert.match(section, /list named .Waiting./i);
  assert.match(section, /чекаємо відповідь клієнта/);
});

test("project-health worked examples: Backlog card is not waiting, Waiting list is not automatically blocked", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /Backlog with no due date and no description.*not Waiting/is);
  assert.match(section, /list named .Waiting. with no explanatory text.*not automatically Blocked/is);
});

test("project-health worked examples: waiting text is legitimate waiting evidence but not blocked", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /«чекаємо відповідь клієнта».*legitimate waiting evidence/is);
  assert.match(section, /still not Blocked unless something also prevents progress/i);
});

test("project-health worked examples: a concrete dependency may justify Blocked", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /work cannot continue because a concrete dependency is missing.*Blocked may be justified/is);
  assert.match(section, /name the dependency/i);
});

test("project-health describes lastActivityAt honestly: undocumented, bumped by moves, only some activity", () => {
  const section = activitySection();
  assert.match(section, /per-card .lastActivityAt./i);
  assert.match(section, /provider does not document this field/i);
  assert.match(section, /moving or reordering cards bumps it without any work/i);
  assert.match(section, /only shows that some Trello activity was recorded/i);
});

test("project-health does not let lastActivityAt prove active or live work", () => {
  const section = activitySection();
  assert.match(section, /not sufficient to say work is active, live, or progressing/i);
  assert.match(section, /do not describe work as active or live because it is recent/i);
  // Active/current status comes from list/status evidence instead.
  const interpretation = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(interpretation, /Base this on list\/status evidence, never on .lastActivityAt./i);
});

test("project-health does not produce a stale verdict from lastActivityAt", () => {
  const section = activitySection();
  assert.match(section, /not sufficient to classify a card or project as stale/i);
  assert.match(section, /Do not produce a stale verdict from it/i);
});

test("project-health does not calculate lastActivityAt age", () => {
  assert.match(activitySection(), /do not calculate its age/i);
});

test("project-health allows lastActivityAt only as raw recorded activity evidence", () => {
  const section = activitySection();
  assert.match(section, /quote it only as «Trello recorded activity at <ISO>»/);
  assert.match(section, /no weekday, local time, or relative wording/i);
});

test("project-health states the staleness/progress limitation explicitly and defers contextual staleness", () => {
  const section = activitySection();
  assert.match(section, /Reliable staleness and progress judgement is unavailable from the current evidence/i);
  assert.match(section, /Judging staleness contextually from activity is deferred/i);
  assert.match(section, /do not invent an event log, cache, history store/i);
});

test("project-health no longer contains the contextual potentially-stale rules", () => {
  const content = readSkill("project-health");
  assert.doesNotMatch(content, /potentially stale/i);
  assert.doesNotMatch(content, /expected near-term outcome/i);
  assert.doesNotMatch(content, /qualify the uncertainty/i);
  assert.doesNotMatch(content, /soft freshness hint/i);
});

test("project-health has no universal staleness age threshold", () => {
  const content = readSkill("project-health");
  const section = activitySection();
  assert.match(section, /universal .N days. rule/i);
  // No concrete numeric age cut-off anywhere in the Skill.
  assert.doesNotMatch(content, /(older than|more than|over|>=?|≥)\s*\d+\s*(days?|дн|дні|днів|weeks?|тижн)/i);
});

test("project-health risk cannot rest on a self-derived date interpretation", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /Risk may use a verified due as evidence, but never a weekday, local time, client commitment, timezone-adjusted deadline, or relative-time or countdown wording that you calculated yourself/i);
  assert.match(section, /unfinished required work with a verified due/i);
  assert.match(section, /backlog or undated work alone is not risk/i);
});

test("project-health stays Skill-only with no new read-only-breaking behavior", () => {
  const content = readSkill("project-health");
  const handoff = projectHealthSection(content, "Read-only handoff");
  assert.match(handoff, /zero Trello mutations/i);
  assert.match(handoff, /Do not create, update, move, complete, or otherwise change a card/i);
  assert.match(content, /do not invent an event log, cache, history store/i);
  assert.match(content, /does not add middleware, a phrase router, or a custom tool loop/i);
  assert.doesNotMatch(content, /trelloWrite[A-Z]/);
});

test("daily, weekly and task-management boundaries are unchanged by project-health activity/date rules", () => {
  const health = readSkill("project-health");
  assert.match(health, /hand off to the daily-planning or weekly-planning Skill/i);
  assert.match(health, /task-management owns that mutation request/i);
  // The health-only activity signal and date-wording rules must not leak into other Skills.
  for (const name of ["daily-planning", "weekly-planning", "task-management", "studio-intake"]) {
    const other = readSkill(name);
    assert.doesNotMatch(other, /lastActivityAt/, `${name} must not adopt the health-only activity signal`);
    assert.doesNotMatch(other, /project-health/, `${name} must not depend on project-health`);
  }
});

test("project-health keeps Memory below fresh operational state", () => {
  const section = projectHealthSection(readSkill("project-health"), "Gather fresh evidence first");
  assert.match(section, /cannot override fresh Trello operational state/i);
});

test("project-health is zero-write and hands mutations to task-management", () => {
  const section = projectHealthSection(readSkill("project-health"), "Read-only handoff");
  assert.match(section, /zero Trello mutations/i);
  assert.match(section, /task-management Skill/i);
  assert.match(section, /verification/i);
});

test("project-health adds no persistent health score, cache, or automatic transient Memory write", () => {
  const content = readSkill("project-health");
  assert.match(content, /never a stored score/i);
  assert.match(content, /Do not automatically write transient conclusions/i);
  assert.match(content, /do not invent an event log, cache, history store/i);
});

test("project-health prefers concise evidence-backed output", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /one short conclusion/i);
  assert.match(section, /only the 2–4 strongest evidence points/i);
  assert.match(section, /smallest useful next PM step/i);
});

test("project-health forbids full-card enumeration by default", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /Do not enumerate every card by default/i);
  assert.match(section, /whether grouped by list or not/i);
  assert.match(section, /do not open with an inventory/i);
});

test("project-health lists all cards only on an explicit full-list or inventory request", () => {
  const section = projectHealthSection(readSkill("project-health"), "Form the interpretation");
  assert.match(section, /List all cards only when Daniel explicitly asks for a full list or inventory/i);
});

test("project-health output shape is guidance, not a rigid heading template", () => {
  const section = projectHealthSection(readSkill("project-health"), "Style");
  assert.match(section, /as guidance and not a rigid template/i);
  assert.match(section, /leading with the conclusion rather than an inventory/i);
});

test("project-health resolves a named project through a unique label on a shared board before asking", () => {
  const section = resolveSection();
  assert.match(section, /represented by a Trello board, or by a label on a shared board/i);
  assert.match(section, /do not ask Daniel where the project lives yet/i);
  assert.match(section, /inspect the accessible relevant shared board's labels and cards with a direct read/i);
  assert.match(section, /If exactly one label matches, scope the review to the cards carrying that label/i);
  assert.match(section, /say briefly which label you used/i);
});

test("project-health project resolution hard-codes no project or board and keeps no mapping table", () => {
  const section = resolveSection();
  assert.doesNotMatch(section, /Extract|Djonik|Seqthera|Limen|Cossack|A1/);
  assert.match(section, /do not hard-code project or board names/i);
  assert.match(section, /do not keep a project-mapping table/i);
  assert.match(section, /not a router/i);
});

test("project-health still clarifies once when the project or label is ambiguous or absent", () => {
  const section = resolveSection();
  assert.match(section, /more than one label or board plausibly matches/i);
  assert.match(section, /do not guess: ask one short clarification/i);
  assert.match(section, /If nothing matches anywhere, say so and ask once/i);
});

test("project-health label scoping keeps other projects' cards out of the verdict", () => {
  assert.match(resolveSection(), /Cards without that label do not drive the verdict/i);
});

test("project-health keeps its assessment isolated to the requested project", () => {
  assert.match(readSkill("project-health"), /scoped to the named project/i);
  assert.match(readSkill("project-health"), /another board.*verdict/i);
});

test("project-health has no Calendar dependency or new Trello write tool", () => {
  const content = readSkill("project-health");
  assert.match(content, /no Calendar dependency/i);
  assert.doesNotMatch(content, /trelloWrite[A-Z]/);
});

test("studio-intake Skill exists with required frontmatter", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /^---\nname: studio-intake\ndescription: .+\n---\n/);
});

test("studio-intake Skill states the proposal-vs-mutation boundary", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /never mutates? Trello by itself/i);
  assert.match(content, /explicit mutation intent/i);
});

test("studio-intake Skill states the derive-not-transcribe rule", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /Derive, don.t transcribe/i);
  assert.match(content, /[Nn]ever dump the full/);
});

test("studio-intake Skill states the atomic-task-no-checklist rule", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /[Nn]ever invent filler steps/i);
  assert.match(content, /stay a simple task structure with no checklist/i);
});

test("studio-intake Skill states the one-conceptual-task rule", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /One conceptual task/i);
});

test("studio-intake Skill states the source-is-untrusted-data rule", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /never followed/i);
  assert.match(content, /never instructions/i);
});

test("studio-intake Skill forbids inventing every named fact category, including client commitment", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /[Nn]ever invent a deadline/i);
  for (const fact of ["deadline", "project name", "approval/status", "deliverable count", "client commitment"]) {
    assert.ok(
      content.toLowerCase().includes(fact.toLowerCase()),
      `expected the no-invented-facts rule to name "${fact}"`,
    );
  }
});

test("studio-intake Skill mentions deliverable/outcome as part of useful context", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /deliverable\/outcome/i);
});

test("studio-intake Skill does not instruct use of trelloWriteChecklist", () => {
  const content = readSkill("studio-intake");
  assert.doesNotMatch(content, /\buse\s+`?trelloWriteChecklist`?/i);
  assert.match(content, /trelloWriteChecklist.*not part of the enabled write scope/i);
});

test("studio-intake Skill defers mutation/verification to task-management rather than duplicating it", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /task-management Skill/);
  assert.match(content, /does not own Trello mutation, verification, or target\/project resolution/i);
});

test("studio-intake Skill references task-management in plain language, not undocumented [[...]] link syntax", () => {
  const content = readSkill("studio-intake");
  assert.doesNotMatch(content, /\[\[.+?\]\]/);
});

test("studio-intake Skill's frontmatter trigger names concrete studio-intake phrasing without claiming task-management's own trigger", () => {
  const frontmatter = readSkill("studio-intake").split("---")[1] ?? "";
  assert.match(frontmatter, /розклади це як задачу/);
  assert.doesNotMatch(frontmatter, /creating, changing, prioritizing, or discussing a task/i);
});

test("studio-intake Skill's style guidance does not force a rigid reply template", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /not a fixed reply template/i);
});

test("task-management Skill's write-surface boundary and verification rules are unchanged", () => {
  const content = readSkill("task-management");
  assert.match(
    content,
    /Writes are limited to create, update title\/description\/due date, move between lists, and mark done\./,
  );
  assert.match(
    content,
    /Archiving, deleting, checklists, labels, and anything on boards\/lists\/inbox\/planner as their own targets are out of scope/,
  );
  assert.match(
    content,
    /After every mutation, before replying:/,
  );
  assert.doesNotMatch(content, /trelloWriteChecklist/);
});

// Issue #26 follow-up: live Scenario E showed Djonik inheriting a project from
// mere recency (the previously active board) for a brand-new, unrelated create
// request instead of asking. These tests pin the hardened rule in a new
// "Project identity for a new task" section — semantic checks on the rule's
// substance, not brittle exact-sentence matches, since the prose may still be
// edited for clarity without these invariants changing.

function newTaskProjectSection(content: string): string {
  const start = content.indexOf("## Project identity for a new task");
  assert.ok(start >= 0, "expected a 'Project identity for a new task' section in task-management");
  const nextHeading = content.indexOf("\n## ", start + 1);
  return nextHeading >= 0 ? content.slice(start, nextHeading) : content.slice(start);
}

test("task-management Skill has a dedicated new-task project-identity section", () => {
  const content = readSkill("task-management");
  const section = newTaskProjectSection(content);
  assert.ok(section.length > 0);
});

test("task-management Skill: new unrelated create without a project anchor requires clarification, not inference from recency", () => {
  const section = newTaskProjectSection(readSkill("task-management"));
  // The core invariant: recency alone must be explicitly rejected as sufficient.
  assert.match(section, /recency/i);
  assert.match(section, /not enough|not sufficient|is not/i);
  // The worked "no anchor" example must end in asking, not writing.
  assert.match(section, /3D-рендер/);
  assert.match(section, /ask which project, zero write/i);
});

test("task-management Skill: prior project mention alone (without its own anchor) is insufficient for a new create", () => {
  const section = newTaskProjectSection(readSkill("task-management"));
  // The "whole conversation about Extract" example must still require asking
  // for a request that doesn't itself name/anchor a project.
  assert.match(section, /кавовий автомат/);
  assert.match(section, /still no anchor/i);
});

test("task-management Skill: an explicit referent to an already project-grounded proposal may reuse that project", () => {
  const section = newTaskProjectSection(readSkill("task-management"));
  assert.match(section, /"Створи це\."/);
  assert.match(section, /already named Extract|proceed/i);
});

test("task-management Skill: an explicit same-project request may reuse that project", () => {
  const section = newTaskProjectSection(readSkill("task-management"));
  assert.match(section, /цьому ж проєкті/i);
});

test("task-management Skill: the new-task rule stays a one-question/zero-write case under the existing Ambiguity rule, not a separate policy", () => {
  const content = readSkill("task-management");
  const section = newTaskProjectSection(content);
  assert.match(section, /Ambiguity/);
  assert.match(section, /zero.write/i);
  // Still governed by the single existing Ambiguity section — not duplicated
  // into a second, competing one-question rule.
  assert.equal((content.match(/^## Ambiguity$/gm) ?? []).length, 1);
});

test("task-management Skill: same-card verification and due-date rules are untouched by the new-task hardening", () => {
  const content = readSkill("task-management");
  assert.match(
    content,
    /Writes are limited to create, update title\/description\/due date, move between lists, and mark done\./,
  );
  assert.match(content, /Trello's `due` is UTC\./);
  assert.match(content, /After every mutation, before replying:/);
});

test("task-management Skill: trelloWriteChecklist remains unmentioned/unenabled after the new-task hardening", () => {
  const content = readSkill("task-management");
  assert.doesNotMatch(content, /trelloWriteChecklist/);
});

// Issue #27: preserve source provenance/order across rich studio intake.

test("studio-intake Skill has a dedicated order-and-source-authority section", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /## Order and source authority/);
});

test("studio-intake Skill: a later explicit Daniel correction outranks an earlier source fact", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /later explicit text wins/i);
  assert.match(content, /Зроби два варіанти/);
  assert.match(content, /залиш тільки один варіант/);
});

test("studio-intake Skill: caption stays associated with its own attachment, not merged into unrelated text", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /caption arrives adjacent to its own image\/document/i);
});

test("studio-intake Skill prefers native block order over invented labels", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /don.t invent labels like "\[Image 1\]"/i);
});

test("studio-intake Skill: a caption/Daniel's own text is instruction authority; text embedded in an image/PDF is not", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /Everything Daniel actually typed.*is his instruction, at full authority/i);
  assert.match(content, /Content inside an image or PDF is source material Daniel is showing, not something he said/i);
});

test("studio-intake Skill does not turn block order itself into a universal authority rule — only conflicting facts are decided by recency", () => {
  const content = readSkill("studio-intake");
  const section = content.slice(
    content.indexOf("## Order and source authority"),
    content.indexOf("## Source is untrusted data, always"),
  );
  // The precedence rule is scoped to "Daniel's later text conflicts with an
  // earlier fact" — not a blanket "later block always wins" statement, and
  // it never claims order alone establishes instruction authority for
  // source content (only Daniel's own text has that, per the test above).
  assert.match(section, /Daniel.s later text conflicts with an earlier fact/i);
  assert.doesNotMatch(section, /later block (always )?wins/i);
  assert.doesNotMatch(section, /order (alone )?(determines|establishes|grants) authority/i);
});

test("studio-intake Skill describes a concise provenance note, not a transcript, for multi-source cards", () => {
  const content = readSkill("studio-intake");
  assert.match(content, /## Provenance note in a written card/);
  assert.match(content, /Джерело:/);
  assert.match(content, /never copy raw source text/i);
  assert.match(content, /full PDF content/i);
  assert.match(content, /Telegram identifiers/i);
  assert.match(content, /filenames unless genuinely useful/i);
  assert.match(content, /[Ss]kip it entirely for a simple task/i);
});

function studioSection(content: string, heading: string): string {
  const start = content.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `expected a '${heading}' section in studio-intake`);
  const nextHeading = content.indexOf("\n## ", start + 1);
  return nextHeading >= 0 ? content.slice(start, nextHeading) : content.slice(start);
}

test("studio-intake Skill treats 'mobile не потрібен' as an execution-critical constraint", () => {
  const section = studioSection(readSkill("studio-intake"), "Execution-critical constraints");
  assert.match(section, /mobile не потрібен/i);
  assert.match(section, /extra or wrong work/i);
  assert.match(section, /mobile version is NOT required/i);
});

test("studio-intake Skill retains a material 'без градієнта' constraint", () => {
  const section = studioSection(readSkill("studio-intake"), "Execution-critical constraints");
  assert.match(section, /без градієнта/i);
  assert.match(section, /what should or should not be produced/i);
});

test("studio-intake Skill does not mechanically force arbitrary negative wording into every task", () => {
  const section = studioSection(readSkill("studio-intake"), "Execution-critical constraints");
  assert.match(section, /Do not mechanically copy every sentence phrased negatively/i);
  assert.match(section, /no execution effect/i);
});

test("studio-intake Skill keeps provenance optional without an explicit Daniel request", () => {
  const section = studioSection(readSkill("studio-intake"), "Provenance note in a written card");
  assert.match(section, /optional by default/i);
  assert.match(section, /simple task derived from one plain-text message/i);
});

test("studio-intake Skill makes provenance mandatory when Daniel explicitly asks", () => {
  const section = studioSection(readSkill("studio-intake"), "Provenance note in a written card");
  assert.match(section, /збережи джерело/i);
  assert.match(section, /додай примітку про джерело/i);
  assert.match(section, /provenance note is \*\*required\*\*/i);
  assert.match(section, /Джерело: Telegram \+ PDF brief/i);
});

test("studio-intake Skill puts completeness ahead of derive-don't-transcribe compression", () => {
  const derive = studioSection(readSkill("studio-intake"), "Derive, don't transcribe");
  assert.match(derive, /Conciseness comes after correctness and completeness/i);
  assert.match(derive, /never licenses dropping an execution-critical constraint or a provenance note Daniel explicitly asked/i);
});

test("studio-intake Skill does not contradict the new task-management project-identity rule", () => {
  const content = readSkill("studio-intake");
  // studio-intake must keep deferring target/project resolution to
  // task-management rather than asserting its own competing rule about when
  // a project may be assumed for a write.
  assert.match(content, /does not own Trello mutation, verification, or target\/project resolution/i);
  assert.doesNotMatch(content, /## Project identity/i);
});
