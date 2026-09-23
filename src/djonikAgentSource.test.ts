import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Issue #38: `managed-agents/djonik.md` is the reviewed repo source for the primary Djonik
// coordinator's system prompt. These tests pin durable invariants — the voice contract, the
// honesty boundary (no capability the runtime does not have), the Memory/fresh-data boundary,
// and the absence of Skill copies or secrets. They deliberately do NOT snapshot prose: the
// prompt must stay editable without rewriting this file for every wording change.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "managed-agents", "djonik.md"), "utf8").replace(/\r\n/g, "\n");
const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(source);
assert.ok(match, "expected YAML frontmatter followed by a blank line and the system prompt body");
const frontmatter = match[1];
/** The system prompt as it would be sent: the file's body without the file's own trailing newline. */
const system = match[2].replace(/\n$/, "");

const skillSources = ["task-management", "daily-planning", "weekly-planning", "studio-intake"].map((name) =>
  readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n"),
);

// --- A. The file exists and parses as the declarative managed-agent format ---------------------

test("source parses as frontmatter + system body and declares the Sonnet 5 low coordinator baseline", () => {
  assert.match(frontmatter, /^name: Джонік$/m);
  assert.match(frontmatter, /^model:\n  id: claude-sonnet-5\n  effort: low\n  speed: standard$/m);
  assert.ok(system.length > 0);
  // The four coordinator Skills, recorded exactly as production pins them.
  const skills = [...frontmatter.matchAll(/- type: custom\n\s+skill_id: (\S+)\n\s+version: (\S+)/g)];
  assert.deepEqual(
    skills.map((entry) => entry[1]),
    [
      "skill_01WS6JtY1GMu3rGZaKCVR9w1",
      "skill_01G9DtQEzPYxgw78riFh8k99",
      "skill_01PTmbvLHJj1HuUxvDKhpaiE",
      "skill_015c8dtDnWyDfVLwS6NLS7r6",
    ],
  );
  // `project-health` is owned exclusively by the specialist (#28); the coordinator must not re-attach it.
  assert.doesNotMatch(frontmatter, /skill_01Treson5zdU1TgxXDaREwnY/);
});

test("source pins the Project Health specialist through the native coordinator roster, at an explicit version", () => {
  assert.match(frontmatter, /multiagent:\n\s+type: coordinator/);
  const roster = [...frontmatter.matchAll(/- type: agent\n\s+id: (\S+)\n\s+version: (\d+)/g)];
  assert.equal(roster.length, 1, "exactly one pinned specialist");
  assert.equal(roster[0][1], "agent_01KNiQDzzPjaMU6LLF4mU6uM");
  assert.match(roster[0][2], /^\d+$/, "the roster entry must pin a version, never float");
});

test("source records the production Trello write surface: only trelloWriteCard is enabled", () => {
  const writes = [...frontmatter.matchAll(/- name: (trelloWrite\w+)\n\s+enabled: (true|false)/g)];
  assert.equal(writes.length, 6, "all six Trello write tools stay explicitly stated");
  const enabled = writes.filter((entry) => entry[2] === "true").map((entry) => entry[1]);
  assert.deepEqual(enabled, ["trelloWriteCard"]);
});

test("source records the Google Calendar toolset as default-disabled, so the prompt may not promise Calendar", () => {
  const calendar = /mcp_server_name: google-calendar-calendarmcp\n\s+default_config:\n\s+enabled: (true|false)/.exec(frontmatter);
  assert.ok(calendar, "the Calendar MCP toolset must be represented");
  assert.equal(calendar[1], "false");
  assert.doesNotMatch(system, /calendar/i);
});

// --- B. No secrets ------------------------------------------------------------------------------
// A source regression, not a security audit: it catches an obvious paste, not a determined leak.

test("source contains no credential-shaped material", () => {
  const forbidden: Array<[RegExp, string]> = [
    [/sk-ant-[A-Za-z0-9_-]{8,}/, "Anthropic API key"],
    [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, "Telegram bot token"],
    [/\b[a-f0-9]{64}\b/i, "Trello token / 64-hex secret"],
    [/\b[a-f0-9]{32}\b/i, "Trello API key / 32-hex secret"],
    [/(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*\S+/i, "inline credential assignment"],
    [/TRELLO_(API_KEY|READ_TOKEN)|TELEGRAM_BOT_TOKEN|ANTHROPIC_API_KEY/, "secret environment variable"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(source, pattern, `${label} must never appear in a reviewed agent source`);
  }
});

// --- C. No unsupported capability promise -------------------------------------------------------

test("prompt makes no proactive, scheduled or commitment-tracking promise it cannot keep today", () => {
  // The exact promises docs/25 §4.1 flagged in production v21.
  assert.doesNotMatch(system, /\bproactive\b/i);
  assert.doesNotMatch(system, /follows work through to completion/i);
  assert.doesNotMatch(system, /will gradually receive/i);
  // And an explicit, positive statement of the current boundary (#33/#34/#39 are not built).
  assert.match(system, /You do not message him first/i);
  assert.match(system, /run a schedule/i);
  assert.match(system, /track his commitments automatically/i);
  assert.match(system, /never promise that/i);
  assert.match(system, /Use only what this environment gives you/i);
});

// --- D. Voice invariants ------------------------------------------------------------------------

test("prompt sets Ukrainian, informal address and a colleague register as the default voice", () => {
  assert.match(system, /Ukrainian by default/i);
  assert.match(system, /"ти"/);
  assert.match(system, /like a colleague/i);
  assert.match(system, /not like a report/i);
});

test("prompt asks for clean, natural Ukrainian without Russianisms or mixed-language phrasing", () => {
  // Live gate docs/36: Russianisms and mixed forms recurred in two independent samples. One
  // cross-cutting principle, deliberately not a vocabulary list or banned-word check.
  assert.match(system, /natural Ukrainian/i);
  assert.match(system, /no Russianisms/i);
  assert.match(system, /mixed-language/i);
});

test("prompt states the conclusion-first shape with a bounded number of supporting facts", () => {
  assert.match(system, /Conclusion first/i);
  assert.match(system, /one to three/i);
  // A shape, never a rigid template — the same discipline the specialist source keeps.
  assert.match(system, /A shape, not a template/i);
  assert.doesNotMatch(system, /must (use|follow) (this|the following) (template|format|headings)/i);
});

test("prompt defaults to a short Telegram answer but never truncates facts, and expands on request", () => {
  assert.match(system, /six to eight short Telegram lines by default/i);
  assert.match(system, /Longer when Daniel asks for detail/i);
  assert.match(system, /"розпиши"/);
  assert.match(system, /"детально"/);
  assert.match(system, /never drop a fact just to stay short/i);
});

test("prompt forbids process narration in the final answer while keeping a real failure sayable", () => {
  assert.match(system, /Never narrate your process/i);
  assert.match(system, /"шукаю"/);
  assert.match(system, /do not name tools or Skills unless Daniel asks a technical question/i);
  // A failure is an outcome, not narration: this must not become "stay silent about failures".
  assert.match(system, /A real failure is a result/i);
  assert.match(system, /what you therefore do not claim/i);
});

test("prompt keeps fact and judgement distinguishable without a mechanical label", () => {
  assert.match(system, /Fact and judgement read differently/i);
  assert.match(system, /у Trello/);
  assert.match(system, /я б/);
  assert.doesNotMatch(system, /prefix every sentence/i);
});

test("prompt handles an unknown in one sentence and asks at most one clarification, only when it matters", () => {
  assert.match(system, /Say an unknown in one sentence/i);
  assert.match(system, /no apology paragraph/i);
  assert.match(system, /Ask only when the missing piece would change what you do or say/i);
  assert.match(system, /reasonable low-risk assumption/i);
});

test("a necessary clarification is exactly one question for the single most important missing fact", () => {
  // Live gate docs/36 Session D: "one clarification" let Haiku bundle three questions, one of them
  // about where to look. The rule stays general — no scenario wording, no decision tree.
  assert.match(system, /exactly one question/i);
  assert.match(system, /in one sentence/i);
  assert.match(system, /single missing fact that matters most/i);
  assert.match(system, /never bundle questions/i);
  // Choosing where or how to look is Djonik's job, never a question for Daniel.
  assert.match(system, /ask Daniel to pick a tool, board or source/i);
});

test("prompt bans filler and routine praise", () => {
  assert.match(system, /No filler/i);
  assert.match(system, /no praise for routine work/i);
  assert.match(system, /no fake enthusiasm/i);
});

// --- E. Memory / external-truth boundary --------------------------------------------------------

test("prompt makes fresh external reads outrank Memory and keeps Memory out of live state", () => {
  assert.match(system, /Fresh reads are the truth about current state/i);
  assert.match(system, /outrank Memory/i);
  assert.match(system, /never live task state/i);
  assert.match(system, /durable context/i);
  // Daniel's durable preferences live in Memory, not as a second copy inside the prompt.
  assert.match(system, /preferences, priorities, project briefs/i);
  assert.doesNotMatch(system, /20:00/, "working-hours facts belong in Memory, not duplicated here");
});

test("prompt states Daniel's working timezone and leaves date arithmetic to code", () => {
  assert.match(system, /Europe\/Kyiv/);
  // Board conventions (projects as labels, new task → Inbox) are task-management's, not the coordinator's.
  assert.doesNotMatch(system, /labels on one Trello board/i);
  // Date derivation is owned by code (#23/#31), stated once, not as a conversion policy.
  assert.match(system, /Dates and weekdays come from the tool data and the code that formats it/i);
  assert.ok(
    system.split("\n").filter((line) => /weekday/i.test(line)).length <= 1,
    "weekday handling stays one line; the algorithm lives in code",
  );
});

// --- F. Verified-write principle ----------------------------------------------------------------

test("prompt states the verified-write principle once, without restating the #31 algorithm", () => {
  assert.match(system, /Never say an external change succeeded before it was verified/i);
  assert.match(system, /do not count it as done/i);
  // The deterministic procedure is code's (#31 ledger, #23 finalization): no nudges, retries or tool recipes here.
  assert.doesNotMatch(system, /trelloReadCard/);
  assert.doesNotMatch(system, /verification nudge/i);
  assert.doesNotMatch(system, /re-?read the card/i);
});

// --- G. No Skill duplication ---------------------------------------------------------------------

test("prompt delegates domain detail to the Skills instead of restating their procedures", () => {
  assert.match(system, /Use the Skill that owns the request/i);
  assert.match(system, /it owns the domain detail, not this prompt/i);
  // Concrete Skill-owned procedures that used to leak into the prompt, or could.
  assert.doesNotMatch(system, /attach_label|list_labels/i);
  assert.doesNotMatch(system, /Inbox/);
  assert.doesNotMatch(system, /checklist/i);
  assert.doesNotMatch(system, /Waiting|Blocked|Backlog/);
  assert.doesNotMatch(system, /dueComplete/i);
  assert.doesNotMatch(system, /lastActivityAt/i);
});

test("prompt shares no long verbatim block with any coordinator Skill", () => {
  // Structural, not stylistic: no sentence of 60+ characters may appear in both.
  const sentences = system
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 60);
  assert.ok(sentences.length > 5, "sanity: the prompt should have substantive sentences to compare");
  for (const sentence of sentences) {
    for (const skill of skillSources) {
      assert.ok(!skill.includes(sentence), `prompt sentence is copied from a Skill: ${sentence.slice(0, 80)}…`);
    }
  }
});

test("prompt keeps Project Health delegation to the coordinator-level rule that code cannot enforce", () => {
  // Still required: Claude decides delegation natively, and nothing in code stops the coordinator
  // from answering Project Health itself or from colouring the delegated task.
  assert.match(system, /Djonik Project Health Specialist/);
  assert.match(system, /Specialist, not to you/i);
  assert.match(system, /adding nothing of your own/i);
  // Dropped: the transport/correlation detail #28/#32 and SpecialistTurnProvenance already guarantee.
  assert.doesNotMatch(system, /wait silently/i);
  assert.doesNotMatch(system, /thread/i);
});

test("prompt requires the coordinator to return the specialist's answer exactly, with nothing added or changed", () => {
  // Not a duplicate of code. #32 guarantees the specialist's AUTHORITY: the verified string is always
  // shown byte for byte, and any different coordinator text is withheld behind a fixed notice
  // (`composeWithSpecialist`). Only the coordinator can make that notice unnecessary, by replying with
  // the specialist's string itself. Live gate docs/36 (B, C): without this rule Haiku reworded 2/2.
  const projectHealthSection = system.slice(system.indexOf("# Project Health"));
  assert.match(projectHealthSection, /specialist's answer exactly as received/i);
  for (const change of ["add", "remove", "reword", "reformat", "acknowledge"]) {
    assert.match(projectHealthSection, new RegExp(`\\b${change}\\b[^.]*nothing`, "i"), `must forbid: ${change}`);
  }
  assert.match(projectHealthSection, /before or after it/i);
});

test("Project Health stays a small part of the coordinator prompt", () => {
  const projectHealthSection = system.slice(system.indexOf("# Project Health"));
  assert.ok(
    projectHealthSection.length < system.length / 4,
    "Project Health must no longer occupy about a third of the coordinator prompt (docs/25 §4.1)",
  );
});

test("prompt stays a role/voice/boundaries document rather than growing into a policy manual", () => {
  // A source-architecture ceiling, not a rule about how long Djonik's answers may be. Production v21
  // was 3686 bytes, a third of it detail that Skills and code already own; #38 brought the coordinator
  // back to role, voice and boundaries. The ceiling is deliberately generous (the current body is well
  // under it) so wording can breathe — but it fails loudly if domain or runtime documentation starts
  // migrating back into the coordinator instead of into a Skill.
  const bytes = Buffer.byteLength(system, "utf8");
  assert.ok(bytes <= 2600, `coordinator system prompt should stay ~2 KB (was ${bytes} bytes)`);
});
