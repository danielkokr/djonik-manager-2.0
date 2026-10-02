import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DJONIK_MEMORY_INSTRUCTIONS } from "./djonikClient.js";
import { DecisionTraceCollector, explainRecordedTurn, historyScopeDigest } from "./decisionTrace.js";
import { CRITICAL_IDS, SCENARIOS, runBenchmark, type CandidateTurn, type ScenarioId } from "./pmBenchmark.js";
import { fakeGrader } from "./pmGrader.js";
import { ISSUE_17_BRIEF_EXCERPTS, PROJECT_ALIAS_SCENARIOS, S47_SECOND_AZOV_BRIEF, cardsForScenario, labelsForScenario, memoriesForScenario } from "./pmFixture.js";
import { briefNames, resolveProjectName } from "./projectIdentityOracle.js";
import { TrelloWorkHistoryClient, TrelloWorkHistoryError, executeTrelloWorkHistory } from "./trelloWorkHistory.js";

// #59 (docs/99): Daniel's word for a project («Азов») resolves through the project's brief (title + `Aliases:`) to the
// project, then to its one fresh Trello label («A1») — before any Trello read, history or write. Memory answers "which
// project"; fresh Trello answers "which label/card/state". Static tests prove the contract and the measuring tools,
// not live model compliance.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const system = /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/.exec(read("managed-agents", "djonik.md"))![1];
const skill = (name: string) => read(".claude", "skills", name, "SKILL.md");
/** Production-shaped board labels (issue #59): the Азов project is the label «A1». */
const LIVE_LABELS = ["Extract", "Seqthera", "Cossack Labs", "A1", "Limen"];
const scenario = (id: string) => SCENARIOS.find((entry) => entry.id === id)!;
const briefsOf = (id: string) => Object.fromEntries(Object.entries(memoriesForScenario(scenario(id)))
  .filter(([path]) => path.startsWith("/projects/")).map(([path, text]) => [path.slice("/projects/".length, -".md".length), text]));

// --- A. The resolution contract (eval oracle over brief text) -----------------------------------------------------

test("#59 known alias → canonical project → its one fresh label; the canonical name resolves to itself", () => {
  assert.deepEqual(briefNames(ISSUE_17_BRIEF_EXCERPTS["azov-a1"]), ["Азов", "A1"], "title «Азов / A1» and `Aliases: Азов, A1.`");
  assert.deepEqual(resolveProjectName("Азов", ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS), { kind: "resolved", project: "azov-a1", label: "A1" });
  assert.deepEqual(resolveProjectName("A1", ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS), { kind: "resolved", project: "azov-a1", label: "A1" });
  assert.deepEqual(resolveProjectName("Екстракт", ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS), { kind: "resolved", project: "extract", label: "Extract" });
});

test("#59 only case and spacing are normalized — never a partial, transliterated or similar name", () => {
  for (const word of ["азов", "  АЗОВ ", "a1"]) assert.equal((resolveProjectName(word, ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS) as { label?: string }).label, "A1", word);
  for (const word of ["Аз", "A-one-ish", "Azov", "Азовсталь", "Марс", ""]) {
    assert.deepEqual(resolveProjectName(word, ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS), { kind: "unknown" }, word);
  }
});

test("#59 a word that is itself a label needs no brief; a brief without a live label is not a label", () => {
  assert.deepEqual(resolveProjectName("Limen", ISSUE_17_BRIEF_EXCERPTS, LIVE_LABELS), { kind: "resolved", project: null, label: "Limen" });
  assert.deepEqual(resolveProjectName("Азов", ISSUE_17_BRIEF_EXCERPTS, ["Extract", "Seqthera"]), { kind: "no_label", project: "azov-a1" },
    "Memory names the project; it never supplies a label the board does not have");
});

test("#59 ambiguity stays ambiguous: two briefs, two matching labels, or another project's label", () => {
  const twoBriefs = { ...ISSUE_17_BRIEF_EXCERPTS, "azov-fund": S47_SECOND_AZOV_BRIEF };
  assert.deepEqual(resolveProjectName("Азов", twoBriefs, LIVE_LABELS), { kind: "ambiguous", projects: ["azov-a1", "azov-fund"], labels: [] });
  assert.equal(resolveProjectName("Азов", ISSUE_17_BRIEF_EXCERPTS, [...LIVE_LABELS, "Азов"]).kind, "ambiguous", "labels «A1» and «Азов» both match");
  const clash = { x: "# X\nAliases: X, Shared.\n" };
  assert.equal(resolveProjectName("Shared", clash, ["X", "Shared"]).kind, "ambiguous", "the word is a label of a different project");
});

test("#59 the mapping is read from brief data, not hardcoded: change the brief and the result follows it", () => {
  const renamed = { "azov-a1": "# Азов / A2\nAliases: Азов, A2.\n" };
  assert.deepEqual(resolveProjectName("Азов", renamed, ["A1", "A2"]), { kind: "resolved", project: "azov-a1", label: "A2" });
  const code = read("src", "projectIdentityOracle.ts").replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Азов|\bA1\b|azov/i, "no single-case branch outside comments");
});

test("#59 the oracle is eval-only: no serving module imports it, and no application code reads project briefs", () => {
  const sources = readdirSync(join(root, "src")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".test-helpers.ts"));
  for (const name of sources) assert.doesNotMatch(read("src", name), /from "\.\/projectIdentityOracle\.js"/, `${name} must not import the eval oracle`);
  // The adapter's direct Memory API use stays exactly what it was: /rhythm.md (rhythmMemoryConfig) and the eval store.
  const memoryApi = sources.filter((name) => /memoryStores\.memories/.test(read("src", name))).sort();
  assert.deepEqual(memoryApi, ["pmFixture.ts", "rhythmMemoryConfig.ts"]);
});

// --- B. Where the contract lives: coordinator (every flow) + task-management (label step) -------------------------

test("#59 coordinator: project names resolve through the brief before any Trello read, history or write", () => {
  const act = system.split("# How you act\n")[1]?.split("\n# ")[0] ?? "";
  const rule = act.split("\n\n").find((paragraph) => /project's names/i.test(paragraph));
  assert.ok(rule, "one identity paragraph in the always-present coordinator section, not in one Skill");
  assert.match(rule, /title and `Aliases:` line \(`projects\/<slug>\.md`\)/);
  assert.match(rule, /Before any Trello read, history or write/);
  assert.match(rule, /in any grammatical form/, "«по азову» is the word «Азов»");
  assert.match(rule, /without asking/, "a recorded alias is not confirmed back («A1?»)");
  assert.match(rule, /one fresh board label equal to one of them/);
  assert.ok(rule.indexOf("resolve his word") < rule.indexOf("fresh board label"), "semantic resolution comes before the label match");
  assert.match(rule, /A word that is itself a label needs no brief/, "projects without a brief keep working");
  assert.match(rule, /stays unknown: never guess from a similar name/);
  assert.match(rule, /two projects, or two matching labels: one question, no write/);
  assert.doesNotMatch(system, /Азов|\bA1\b/, "no single-case mapping in the prompt");
  // Memory still never supplies live state; the brief only names the project.
  assert.match(system, /Fresh reads are the truth about current state and outrank Memory/);
});

test("#59 task-management: the label step matches a recorded brief name, read fresh; ids never come from Memory", () => {
  const section = skill("task-management").split("## Project label on a new task\n")[1].split("\n## ")[0];
  const steps = section.split("\n").filter((line) => /^\d\. /.test(line));
  assert.match(steps[0], /Read the board's labels fresh in this turn/);
  assert.match(steps[0], /Never take a label or its id from Memory/);
  assert.match(steps[1], /one of the anchored project's names — Daniel's word or a name its brief records \(title or `Aliases:`\)/);
  assert.match(steps[1], /A recorded alias needs no confirmation from Daniel/);
  assert.match(steps[1], /never a partial, unrecorded or "close enough" name/);
  assert.doesNotMatch(section, /plainly names that same project/, "the vague alias test that produced the production refusal is gone");
  assert.match(steps[3], /No match → never create or rename a label/);
  assert.match(steps[4], /More than one plausible match → ask which one\. Zero write/);
  assert.doesNotMatch(skill("task-management"), /Азов|\bA1\b/);
});

test("#59 work-review and Memory instructions are unchanged: history takes the current label; briefs hold no label ids", () => {
  assert.match(skill("work-review"), /a project uses its \*\*current Trello label\*\*/, "the tool input is the post-resolution label");
  assert.match(DJONIK_MEMORY_INSTRUCTIONS, /projects\/<slug>\.md is the one brief per project: extend it, never a second file/);
  assert.match(DJONIK_MEMORY_INSTRUCTIONS, /Never store the card's current list, status, due, labels, members or checklist/);
  assert.ok(Buffer.byteLength(DJONIK_MEMORY_INSTRUCTIONS, "utf8") <= 4096);
});

// --- C. The deterministic boundary stays literal: the tool gets the canonical label, it does not guess ------------

const NOW = new Date("2026-10-02T09:00:00.000Z");
const historyClient = () => new TrelloWorkHistoryClient({
  apiKey: "k", readToken: "t",
  fetch: async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/boards")) return Response.json([{ id: "board_1", name: "Djonik" }]);
    if (path.endsWith("/cards/all")) return Response.json([{ id: "card_a1", name: "Банер збору", idList: "l", closed: false, labels: [{ name: "A1" }] }]);
    return Response.json([]);
  },
});

test("#59 trello_work_history: the resolved label A1 is served; the raw word «Азов» is project_not_found, never fuzzy-matched", async () => {
  const ok = await executeTrelloWorkHistory({ window: { kind: "this_week" }, scope: { kind: "project", label: "A1" } }, historyClient(), NOW);
  assert.equal(ok.isError, false);
  assert.match(JSON.parse(ok.content).answer_text, /по A1/);
  await assert.rejects(historyClient().execute({ window: { kind: "this_week" }, scope: { kind: "project", label: "Азов" } }, NOW),
    (error: unknown) => error instanceof TrelloWorkHistoryError && error.code === "project_not_found");
});

// --- D. Measurement: which label reached work history, content-free --------------------------------------------

test("#59 decision trace records the work-history scope as a digest of the label, never its text", () => {
  const trace = new DecisionTraceCollector(1);
  trace.custom("trello_work_history", { window: { kind: "this_week" }, scope: { kind: "project", label: " A1 " } });
  trace.custom("trello_work_history", { window: { kind: "last_week" }, scope: { kind: "board" } });
  trace.custom("trello_board_snapshot", { response_format: "concise" });
  const summary = trace.finish([]);
  assert.deepEqual(summary.historyScopes, [historyScopeDigest("A1"), "board"]);
  assert.notEqual(historyScopeDigest("A1"), historyScopeDigest("Азов"));
  assert.doesNotMatch(JSON.stringify(summary), /"A1"|Азов/);
  assert.equal(new DecisionTraceCollector(1).finish([]).historyScopes, undefined, "absent means no history call");
  const replay = explainRecordedTurn([
    { type: "user.message", content: [{ text: "[Годинник адаптера · пт]" }] },
    { type: "agent.custom_tool_use", name: "trello_work_history", input: { window: { kind: "this_week" }, scope: { kind: "project", label: "A1" } } },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ], 1);
  assert.deepEqual(replay?.historyScopes, [historyScopeDigest("A1")]);
});

// --- E. Offline benchmark: S42–S47 (fixture = production shape; checks fail on the observed production failures) -----

test("#59 S42–S47 are appended, critical, and their fixtures make «Азов» name the A1-labelled project", () => {
  assert.deepEqual(SCENARIOS.slice(41).map((entry) => entry.id), PROJECT_ALIAS_SCENARIOS);
  for (const id of PROJECT_ALIAS_SCENARIOS) {
    assert.ok((CRITICAL_IDS as readonly string[]).includes(id), id);
    assert.ok(labelsForScenario(scenario(id)).includes("A1") && !labelsForScenario(scenario(id)).includes("Azov"), id);
    assert.ok(cardsForScenario(scenario(id)).every((card) => card.project !== "Azov"), `${id}: Azov cards carry A1`);
    assert.equal(cardsForScenario(scenario(id)).filter((card) => card.project === "A1").length, 3, id);
    assert.equal(memoriesForScenario(scenario(id))["/projects/azov-a1.md"], ISSUE_17_BRIEF_EXCERPTS["azov-a1"], id);
  }
  // Earlier scenarios keep their fixture.
  assert.ok(cardsForScenario(scenario("S19")).some((card) => card.project === "Azov"));
  assert.ok(labelsForScenario(scenario("S9")).includes("Azov"));
  assert.equal(memoriesForScenario(scenario("S9"))["/projects/azov-a1.md"], undefined);
  // Expectations agree with the oracle over the same fixture data.
  const labels = labelsForScenario(scenario("S42"));
  assert.equal(scenario("S42").expectedHistoryLabel, (resolveProjectName("Азов", briefsOf("S42"), labels) as { label: string }).label);
  assert.equal(scenario("S45").expectedHistoryLabel, (resolveProjectName("A1", briefsOf("S45"), labels) as { label: string }).label);
  assert.equal(resolveProjectName("Азов", briefsOf("S44"), labels).kind, "resolved");
  assert.equal(resolveProjectName("Аз", briefsOf("S46"), labels).kind, "unknown");
  assert.equal(resolveProjectName("Азов", briefsOf("S47"), labels).kind, "ambiguous");
  assert.match(scenario("S42").turns[0], /по азову/u, "the production wording, inflected and lower-case");
  for (const id of ["S46", "S47"]) assert.deepEqual([...scenario(id).checks].sort(), ["asks_question", "no_memory_write", "zero_write"], id);
  assert.ok(scenario("S44").checks.includes("verified_write") && scenario("S44").checks.includes("no_alias_question"));
});

const blank: CandidateTurn["trace"] = { sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [] };
const run = async (id: string, reply: string, trace: CandidateTurn["trace"] = blank) => (await runBenchmark({ mode: id as ScenarioId, release: "offline", repetitions: 1,
  grader: fakeGrader(), fixture: { async reset() { return { evidenceAvailable: true }; } },
  candidate: { async open() { return { async send() { return { reply, trace }; }, close() {} }; } } }))[0];

test("#59 S42 checks: the production failures fail; the resolved history call passes (offline, no paid inference)", async () => {
  const a1 = { ...blank, toolNames: ["custom:trello_work_history"], historyScopes: [historyScopeDigest("A1")] };
  const ok = await run("S42", "💭 Схоже, тиждень по A1 пішов на банери.", a1);
  assert.deepEqual(ok.checkFailures, []);
  assert.equal(ok.verdict, "pass");
  assert.equal(ok.usageCostUsd, undefined);
  // Production 2026-10-02: no label «Азов», asked whether he meant A1, no history call.
  assert.deepEqual((await run("S42", "Проєкту «Азов» на дошці немає. Ти мав на увазі A1?")).checkFailures, ["history_scope", "no_alias_question"]);
  // The raw word passed to the tool is wrong even when the reply looks fine.
  assert.deepEqual((await run("S42", "Ось що було.", { ...a1, historyScopes: [historyScopeDigest("Азов")] })).checkFailures, ["history_scope"]);
  assert.deepEqual((await run("S42", "Ось що було.", { ...a1, historyScopes: ["board"] })).checkFailures, ["history_scope"], "a board-wide answer is not the project");
  assert.deepEqual((await run("S45", "Ось що було.", a1)).checkFailures, [], "the canonical label still works");
});

test("#59 S43/S44/S46/S47 checks: no «A1?» confirmation; unknown and ambiguous words ask and write nothing", async () => {
  assert.deepEqual((await run("S43", "По Азову (A1) банер у роботі, один чекає фідбеку.")).checkFailures, []);
  assert.deepEqual((await run("S43", "Не бачу лейбла «Азов». Це A1?")).checkFailures, ["no_alias_question"]);
  const verified = { ...blank, mutations: [{ cardIds: ["card_new"], status: "verified" as const }] };
  assert.deepEqual((await run("S44", "Створив у Inbox з міткою A1.", verified)).checkFailures, []);
  // Production: «немає мітки Азов — створити без мітки проєкту?» with zero writes.
  assert.deepEqual((await run("S44", "Мітки «Азов» немає, є A1. Створити без мітки проєкту?")).checkFailures, ["verified_write"]);
  assert.deepEqual((await run("S46", "Який проєкт ти маєш на увазі під «Аз»?")).checkFailures, []);
  assert.deepEqual((await run("S46", "Створив у A1.", verified)).checkFailures, ["asks_question", "zero_write"], "a partial name is never mapped");
  assert.deepEqual((await run("S47", "«Азов» — це A1 чи Фонд Азов?")).checkFailures, []);
  assert.deepEqual((await run("S47", "Створив у A1.", verified)).checkFailures, ["asks_question", "zero_write"], "ambiguity is never a write");
});
