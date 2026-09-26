import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLOCK_HEADER_PREFIX } from "./turnClock.js";

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

// #42: planning-and-focus replaces daily-planning + weekly-planning in the next release.
const skillSources = ["task-management", "planning-and-focus", "studio-intake", "pm-rhythm"].map((name) =>
  readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n"),
);

// --- A. The file exists and parses as the declarative managed-agent format ---------------------

test("source parses as frontmatter + system body and declares the Sonnet 5 medium coordinator baseline", () => {
  assert.match(frontmatter, /^name: Джонік$/m);
  assert.match(frontmatter, /^model:\n  id: claude-sonnet-5\n  effort: medium\n  speed: standard$/m);
  assert.ok(system.length > 0);
  // r28 (#41 + #42, Agent v28; docs/74): task-management, the #42 planning-and-focus Skill in place of daily-planning
  // and weekly-planning, studio-intake, the accepted #36 work-review Skill and the #39 pm-rhythm Skill.
  const skills = [...frontmatter.matchAll(/- type: custom\n\s+skill_id: (\S+)\n\s+version: (\S+)/g)];
  assert.deepEqual(
    skills.map((entry) => entry[1]),
    [
      "skill_01WS6JtY1GMu3rGZaKCVR9w1",
      "skill_01PxXTvhbZSrbxqi7gmDs6KW",
      "skill_015c8dtDnWyDfVLwS6NLS7r6",
      "skill_0169h7GYNYUDDDZteDCUV2fE",
      "skill_01GzpQX3bVuWNk5bhbGcbzku",
    ],
  );
  // #33 invariant: no accidental `latest` — every Skill reference is an explicit, immutable version.
  for (const entry of skills) assert.match(entry[2], /^skver_\w+$/, `${entry[1]} must pin an explicit skver_`);
  assert.doesNotMatch(frontmatter, /version: latest/);
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

test("built-in toolset is an allowlist: file tools for Skills and Memory only — no bash, no web tools (#33)", () => {
  const start = frontmatter.indexOf("  - type: agent_toolset_20260401");
  const end = frontmatter.indexOf("\n  - type:", start + 1);
  const block = frontmatter.slice(start, end);
  assert.match(block, /default_config:\n\s+enabled: false/, "built-in toolset must be default-disabled");
  const enabled = [...block.matchAll(/- name: (\w+)\n\s+enabled: true\n\s+permission_policy:\n\s+type: (always_\w+)/g)].map((m) => `${m[1]}=${m[2]}`);
  // #39 r27: the mutating file tools (incl. native Memory writes) are gated before execution.
  assert.deepEqual(enabled, ["read=always_allow", "write=always_ask", "edit=always_ask", "glob=always_allow", "grep=always_allow"]);
  assert.doesNotMatch(block, /\b(bash|web_fetch|web_search)\b/);
});

test("source exposes exactly the accepted #36 custom tool, byte-for-byte the definition the client executes", async () => {
  const { TRELLO_WORK_HISTORY_TOOL } = await import("./trelloWorkHistory.js");
  const { canonicalJsonSha256 } = await import("./releaseAttestation.js");
  const custom = [...frontmatter.matchAll(/^  - type: custom\n    name: (\S+)\n    description: (.+)\n    input_schema: (.+)$/gm)];
  assert.equal(custom.length, 1);
  assert.equal(custom[0][1], TRELLO_WORK_HISTORY_TOOL.name);
  assert.equal(JSON.parse(custom[0][2]), TRELLO_WORK_HISTORY_TOOL.description);
  assert.equal(canonicalJsonSha256(JSON.parse(custom[0][3])), canonicalJsonSha256(TRELLO_WORK_HISTORY_TOOL.input_schema));
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

test("prompt states the capabilities that exist — Working Rhythm and accepted commitments — and their read-only boundary", () => {
  // The exact promises docs/25 §4.1 flagged in production v21.
  assert.doesNotMatch(system, /\bproactive\b/i);
  assert.doesNotMatch(system, /follows work through to completion/i);
  assert.doesNotMatch(system, /will gradually receive/i);
  // #41: the pre-#34/#39 boundary line contradicted the active rhythm and commitments; it is gone.
  assert.doesNotMatch(system, /You do not message him first/i);
  assert.doesNotMatch(system, /never promise that/i);
  // The current truth, stated once: the rhythm runs, accepted commitments are remembered, autonomous turns
  // only read and propose, and external changes stay on Daniel's verified path.
  assert.match(system, /run his Working Rhythm/i);
  assert.match(system, /remember commitments he explicitly accepts/i);
  // "Autonomous" = the rhythm prompts' own "автоматичний хід"; a button reply is Daniel's turn, not one of them.
  assert.match(system, /Autonomous rhythm turns only read and propose/i);
  assert.match(system, /external changes happen only in his own turn, on his instruction or confirmation/i);
  // Verification is stated once, globally, and applies to those changes too.
  assert.match(system, /Never say an external change succeeded before it was verified/);
  assert.match(system, /Use only what this environment gives you/i);
});

test("prompt takes now, today's weekday and nearby weekdays from the adapter clock line, never its own arithmetic (#41)", () => {
  const line = system.split("\n").find((entry) => /Годинник адаптера/.test(entry));
  assert.ok(line, "the clock rule names the adapter clock line");
  // One rule, merged into the existing formatter sentence: the clock line is THE formatter for today and the
  // next 14 days; no arithmetic, no guessing.
  assert.match(line, /authoritative evidence or a formatter, never your own arithmetic or a guess/i);
  assert.match(line, /for today and the next 14 days, that is the "\[Годинник адаптера …\]" line opening Daniel's messages/);
  // The clock line is system context: never Daniel's words or intake material.
  assert.match(line, /system context, not his words or intake source/i);
  // It must match the header the adapter actually sends.
  assert.ok(CLOCK_HEADER_PREFIX.startsWith("[Годинник адаптера"));
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
  // Date derivation is owned by accepted evidence/formatters, not model arithmetic.
  assert.match(system, /relative timing/i);
  assert.match(system, /weekday/i);
  assert.match(system, /local time/i);
  assert.match(system, /authoritative evidence or a formatter/i);
  assert.match(system, /never your own arithmetic/i);
  assert.ok(
    system.split("\n").filter((line) => /weekday/i.test(line)).length <= 1,
    "weekday handling stays one line; the algorithm stays out of the prompt",
  );
});

// #45 (docs/76 §10.1): one source principle replaced the field blacklist. The field meanings #38 made global survive as
// short examples of that principle, one sentence each, so they are pinned per sentence rather than per character window.
const factsSection = () => {
  const section = system.split("# Where facts come from\n")[1]?.split("\n# ")[0];
  assert.ok(section, "the global facts section must exist in the coordinator, independent of Skill activation");
  return section;
};
const factSentence = (concept: RegExp) => {
  const sentence = factsSection().split(/(?<=[.!?])\s+/).find((candidate) => concept.test(candidate));
  assert.ok(sentence, `expected a facts sentence about ${concept}`);
  return sentence;
};
const negation = /\b(?:not|never|neither|cannot|doesn't|needs)\b/i;

test("#45: every concrete detail needs a source — the principle, its why, and the sources it names", () => {
  const principle = factSentence(/concrete detail/i);
  for (const kind of [/date/i, /weekday/i, /time/i, /duration/i, /size/i, /person/i, /promise/i, /client expectation/i]) {
    assert.match(principle, kind, `the principle covers ${kind}`);
  }
  for (const source of [/fresh read/i, /Memory/, /his own words/i, /clock/i]) assert.match(principle, source, `a source: ${source}`);
  assert.match(factSentence(/trust/i), /invented detail[^.]*honest unknown/i, "the why, not only the rule");
  assert.match(factsSection(), /leave it out or call it unknown/i, "no source → leave out or name the unknown");
});

test("#45: a missing field is unknown, not a value — the r28 failure 'no due → can wait' is named as the example", () => {
  const missing = factSentence(/missing field/i);
  assert.match(missing, /unknown, not a value/i);
  assert.match(missing, /no `due` is not "can wait"/);
  assert.match(missing, /no size is not "quick"/);
  assert.match(missing, /no recorded promise is not "nobody waits"/);
});

test("#45: Djonik's own earlier answers are not evidence until a read or Daniel confirms them", () => {
  assert.match(factSentence(/earlier answers/i), /not evidence until a read or Daniel confirms/i);
});

test("#45: judgement stays decisive — a plain sourced reason is complete, and inventing one is named", () => {
  const core = system.split("# Deciding what matters\n")[1]?.split("\n# ")[0] ?? "";
  assert.match(core, /plain sourced reason[^.]*вже в роботі й найближче до здачі[^.]*complete/i);
  assert.match(core, /never invent a date, event or effort/i);
  assert.match(core, /choose for him/i, "choosing stays Djonik's job");
  assert.match(core, /what fits the time he says he has/i, "fit is his stated time, not an estimated capacity");
  assert.doesNotMatch(system, /realistically fits his time/i);
});

test("#45: one principle, not a longer blacklist — the old field section is gone and not re-grown", () => {
  assert.doesNotMatch(system, /^# Factual semantics$/m);
  assert.equal(factsSection().split("\n\n").length, 2, "two paragraphs: the principle, then the field examples");
  assert.ok(Buffer.byteLength(factsSection(), "utf8") <= 1650, "the facts section replaces the old one (1289 B), it does not double it");
});

test("coordinator keeps the #38 field meanings as short examples of the principle, independent of Skill activation", () => {
  const search = factSentence(/Search/);
  assert.match(search, /candidate/i);
  assert.match(search, /direct card\/list\/board reads establish fields/i);
  assert.match(system, /fresh read/i);
  assert.match(system, /outrank Memory/i);

  const activity = factSentence(/lastActivityAt/);
  assert.match(activity, /only Trello activity/i);
  for (const concept of [/Daniel's work/i, /progress/i, /complet/i, /stale|staleness/i]) {
    assert.match(activity, concept, `lastActivityAt must not establish ${concept}`);
  }

  const completion = factSentence(/dueComplete/);
  assert.match(completion, /current state, not when/i);
  assert.match(completion, /only action history dates a transition/i);

  const blocked = factSentence(/Blocked/);
  assert.match(blocked, /concrete dependency or problem that prevents progress/i);
  assert.match(blocked, /Waiting alone does not prove that/i);
  assert.match(factSentence(/`Backlog`/), /not started is not Waiting, Blocked or at risk/i);

  const due = factSentence(/Trello `due`/);
  assert.match(due, negation);
  for (const concept of [/client commitment/i, /capacity/i, /urgency/i, /risk/i, /enough time/i]) {
    assert.match(due, concept, `due alone must not establish ${concept}`);
  }

  const inference = factSentence(/actor/);
  assert.match(inference, /Never infer an actor or work history from raw metadata/i);
  assert.match(inference, /present a judgement as an external fact/i);
  const clock = factSentence(/relative timing/);
  assert.match(clock, /weekday/i);
  assert.match(clock, /local time/i);
  assert.match(clock, /authoritative evidence or a formatter/i);
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
  // Cross-domain field meanings belong here; domain procedures still belong in Skills. #42 moved the one-line
  // Backlog meaning up with Waiting/Blocked; how to plan around a backlog stays in planning-and-focus.
  assert.match(system, /`Backlog` is a queue/);
  assert.match(system, /lastActivityAt/);
  assert.match(system, /dueComplete/);
  assert.match(system, /Waiting/);
  assert.match(system, /Blocked/);
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
  // Editorial review heuristic, not a Product Contract invariant or an answer-length rule. The
  // old 2600-byte source ceiling was superseded when #38 added always-visible factual semantics.
  // Review this upper bound whenever an intentional architecture change needs more core text;
  // there is no minimum prompt size.
  // #42 (docs/70 §7.1) intentionally moved the PM judgement core here, because a priority model inside a Skill the
  // model may not load cannot shape ordinary turns or rhythm turns: 3794 → ~5.4 KB. The bound was reviewed for it.
  // #45 (docs/76 §10.1) replaced the field blacklist with one source principle plus its field examples and dropped a
  // duplicated "ask only if" line: 5499 → ~5.8 KB. The bound was reviewed for it; the next growth needs a new review.
  const bytes = Buffer.byteLength(system, "utf8");
  assert.ok(bytes <= 5800, `review coordinator prompt growth (${bytes} bytes); 5800 is an editorial heuristic`);
});

// --- H. PM judgement core (#42) ------------------------------------------------------------------
// The coordinator carries a compact decision model that is present in every turn — ordinary and rhythm — without a
// Skill being loaded first. Like the rest of this file, these tests pin concepts and boundaries, not sentences.

const pmCore = () => {
  const section = system.split("# Deciding what matters\n")[1]?.split("\n# ")[0];
  assert.ok(section, "the PM core is its own coordinator section");
  return section;
};
const pmSignals = () => pmCore().split("\n").filter((line) => line.startsWith("- "));
const signalAbout = (concept: RegExp) => {
  const line = pmSignals().find((candidate) => concept.test(candidate));
  assert.ok(line, `expected a PM signal about ${concept}`);
  return line;
};

test("#42 PM core: Daniel delegates the choice; Trello supplies facts, the priority is Djonik's judgement", () => {
  assert.match(system, /designer/i);
  assert.match(system, /delegates the PM work to you/i);
  const core = pmCore();
  assert.match(core, /\bchoose\b/i);
  assert.match(core, /Trello[^.]*facts[^.]*judgement/i);
  assert.match(core, /board leave his attention|most of the board/i, "the why: less to hold, not more");
  assert.match(core, /rhythm turn/i, "the same judgement serves rhythm turns without touching pm-rhythm");
});

test("#42 PM core: a handful of signals — commitments, finishing, context switching, passing the ball, week frame, fit", () => {
  assert.ok(pmSignals().length >= 4 && pmSignals().length <= 6, "a handful of signals, not a policy manual");
  assert.match(signalAbout(/commitment/i), /external|someone waits/i);
  assert.match(signalAbout(/finish/i), /start/i);
  assert.match(signalAbout(/finish/i), /context switch/i, "WIP / switching has a cost");
  assert.match(signalAbout(/ball/i), /feedback|client/i);
  assert.match(signalAbout(/week plan/i), /priorit/i);
  assert.match(signalAbout(/week plan/i), /fits/i);
});

test("#42 explicit-instruction precedence: Daniel's words lead; Djonik warns strongly but never overrules them", () => {
  const words = pmSignals()[0];
  assert.match(words, /His words/i, "his explicit words are the first signal");
  assert.match(words, /outrank[^.]*inferred plan[^.]*your own preference/i);
  // A real obligation at stake is surfaced as a consequence of HIS choice — it does not reverse the instruction.
  assert.match(words, /still follow them/i);
  assert.match(words, /concrete consequence/i);
  assert.match(words, /his conscious choice/i);
  // Nothing in the prompt lets an obligation, a plan or Djonik's view override what Daniel said.
  assert.doesNotMatch(system, /override[sn]? (?:them|his (?:words|instruction))|(?:ignore|disregard|set aside) (?:his|Daniel's) (?:words|instruction)/i);
});

test("#42 PM core: a due is evidence, not urgency — and no signal list starts from due", () => {
  assert.match(signalAbout(/`due`/), /evidence[^.]*not urgency/i);
  assert.doesNotMatch(pmSignals()[0], /\bdue\b/i, "the first signal is Daniel's own words, never the due date");
  // No due-first ordering anywhere in the coordinator: "due dates → …", "due first", "ranked by how soon".
  assert.doesNotMatch(system, /due(?: dates?)?\s*(?:→|->|first\b)|by how soon|soonest due/i);
});

test("#42 PM core: judgement, not a formula — no score, weights, points or fixed order", () => {
  assert.match(pmCore(), /no score or fixed order/i);
  assert.doesNotMatch(system, /\d+\s*(?:points?|pts)\b|\bweights?\s*[:=]|\bscore\s*[:=(]|×\s*\d|\d\s*×|\d+\s*%/i);
  assert.doesNotMatch(system, /\b(?:first|then|finally)\s*[:,]?\s*(?:rank|sort)\b/i);
});

test("#42 PM core: short decisions — one main thing, ≤ two secondary, the rest can wait, ≤ one risk; asking stays the global rule", () => {
  const core = pmCore();
  assert.match(core, /one main thing/i);
  assert.match(core, /up to two secondary/i);
  assert.match(core, /rest can wait/i);
  assert.match(core, /at most one risk/i);
  // #45 dropped the core's own "ask only if…" line: it repeated the global rule in "How you speak", which still holds.
  assert.match(system, /Ask only when the missing piece would change what you do or say/i);
  assert.doesNotMatch(core, /name (?:everything|all|each)[^.]*defer|never (?:silently )?drop/i, "no requirement to enumerate deferred work");
});

test("#42: Project Health keeps health reviews; 'по X що в мене?' is focus planning", () => {
  const projectHealthSection = system.slice(system.indexOf("# Project Health"));
  assert.match(projectHealthSection, /health review[^.;]*risks, blockers[^.;]*Project Health Specialist/i);
  assert.match(projectHealthSection, /"по X що в мене\?"[^.]*focus planning/i);
});
