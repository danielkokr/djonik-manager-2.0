import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSkill(name: string): string {
  return readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8");
}

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

test("studio-intake Skill does not contradict the new task-management project-identity rule", () => {
  const content = readSkill("studio-intake");
  // studio-intake must keep deferring target/project resolution to
  // task-management rather than asserting its own competing rule about when
  // a project may be assumed for a write.
  assert.match(content, /does not own Trello mutation, verification, or target\/project resolution/i);
  assert.doesNotMatch(content, /## Project identity/i);
});
