import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DecisionTraceCollector, explainRecordedTurn, historyScopeDigest } from "./decisionTrace.js";
import { CRITICAL_IDS, SCENARIOS, runBenchmark, type CandidateTurn, type ScenarioId } from "./pmBenchmark.js";
import { fakeGrader } from "./pmGrader.js";
import { S49_RHYTHM, labelsForScenario, memoriesForScenario } from "./pmFixture.js";
import { resolveProjectName } from "./projectIdentityOracle.js";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { RELEASE_R30, RELEASE_R31_CANDIDATE, RELEASES, SERVING_RELEASE, UnresolvedReleaseCandidateError } from "./release.js";
import { buildCandidateUpdateBody } from "./releasePlan.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";
import { ISSUE_62_SKILL_EDITS, SOURCE_SYSTEM_PROMPT, r30SkillSource } from "./releaseFixtures.test-helpers.js";
import { createHash } from "node:crypto";

// #62 (docs/100): the time question reaches the deterministic tool with the label #59 resolved; generic history is not an
// effort estimator. Static/offline: these prove the contract and the measuring tools, not live model compliance.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const scenario = (id: string) => SCENARIOS.find((entry) => entry.id === id)!;
const briefsOf = (id: string) => Object.fromEntries(Object.entries(memoriesForScenario(scenario(id)))
  .filter(([path]) => path.startsWith("/projects/")).map(([path, text]) => [path.slice("/projects/".length, -".md".length), text]));

test("14. trace: the label given to trello_project_time is recorded as the #59 content-free digest, live and in replay", () => {
  const trace = new DecisionTraceCollector(1);
  trace.custom("trello_project_time", { project_label: " A1 " });
  trace.custom("trello_project_time", { project_label: "" });
  const done = trace.finish([]);
  assert.deepEqual(done.projectTimeScopes, [historyScopeDigest("A1")]);
  assert.equal(done.historyScopes, undefined, "time is not a history scope");
  assert.ok(!JSON.stringify(done).includes("A1"), "never the label text");
  const replayed = explainRecordedTurn([
    { type: "user.message", content: [{ text: "Скільки часу на Азов?" }] },
    { type: "agent.custom_tool_use", name: "trello_project_time", input: { project_label: "A1" } },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ], 1);
  assert.deepEqual(replayed?.projectTimeScopes, [historyScopeDigest("A1")]);
});

test("14. #59 compatibility: S48/S49 expect the label the brief resolves «Азов» to — no second resolver in #62", () => {
  for (const id of ["S48", "S49"]) {
    assert.ok((CRITICAL_IDS as readonly string[]).includes(id), id);
    assert.match(scenario(id).turns[0], /на Азов\?$/u);
    assert.equal(scenario(id).expectedTimeLabel, (resolveProjectName("Азов", briefsOf(id), labelsForScenario(scenario(id))) as { label: string }).label, id);
    assert.equal(scenario(id).expectedTimeLabel, "A1");
  }
  // The capability takes the canonical label as given: no brief reading, alias list or fuzzy match in #62 code.
  const tool = read("src", "projectTimeTool.ts");
  assert.doesNotMatch(tool, /Aliases|projects\/|resolveProjectName|briefNames|toLowerCase|localeCompare/);
  // The fixture: S48 has no /rhythm.md (production 2026-10-01), S49 configures work hours; the eval executor parses the same text.
  assert.equal(memoriesForScenario(scenario("S48"))["/rhythm.md"], undefined);
  assert.equal(parseRhythmConfig(memoriesForScenario(scenario("S48"))["/rhythm.md"] ?? null).config.workHours, null);
  assert.equal(memoriesForScenario(scenario("S49"))["/rhythm.md"], S49_RHYTHM);
  assert.notEqual(parseRhythmConfig(S49_RHYTHM).config.workHours, null);
  assert.match(read("src", "pmBenchmarkCli.ts"), /context\.name === "trello_project_time" \? projectTime\(toolInput\)/);
});

const blank: CandidateTurn["trace"] = { sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [] };
const run = async (id: string, reply: string, trace: CandidateTurn["trace"] = blank) => (await runBenchmark({ mode: id as ScenarioId, release: "offline", repetitions: 1,
  grader: fakeGrader(), fixture: { async reset() { return { evidenceAvailable: true }; } },
  candidate: { async open() { return { async send() { return { reply, trace }; }, close() {} }; } } }))[0];
const timeA1 = { ...blank, toolNames: ["custom:trello_project_time"], projectTimeScopes: [historyScopeDigest("A1")] };
const MISSING = "Час по A1 цього тижня не можу оцінити: у /rhythm.md не задані work_hours.\nЯкщо хочеш — задамо робочі години.";
const ANSWER = "A1 — ≈ 4,5 год цього тижня\n\nПо задачах:\n• Пін Азов — ≈ 3 год\n• Допис в Instagram — ≈ 1,5 год\n\n≈ за переміщеннями в Trello, з точністю до пів години (робочі години 10:00–18:00)";

test("S48: the production 2026-10-01 answer fails; the deterministic unavailable answer passes", async () => {
  const ok = await run("S48", MISSING, timeA1);
  assert.deepEqual(ok.checkFailures, []);
  assert.equal(ok.verdict, "pass");
  // Production: generic history, raw transitions narrated, then "can't calculate hours".
  const production = [
    "Ось рухи по A1 за тиждень:", "- Пін Азов: This week → In progress (пн 10:00)", "- Пін Азов: In progress → Done (пн 13:00)",
    "- Допис в Instagram: This week → In progress (вт 10:00)", "- Допис в Instagram: In progress → Done (вт 11:30)",
    "- Пальчик і листівка: This week → In progress (чт 10:00)", "- Пальчик і листівка: In progress → Waiting (чт 10:30)",
    "- Пальчик і листівка: Waiting → In progress (чт 12:00)", "- Пальчик і листівка: In progress → Done (чт 12:30)",
    "- Допис Fritt Ukraina: This week → In progress (ср 10:00)", "- Допис Fritt Ukraina: In progress → Done (ср 12:30)",
    "- Логотип: Inbox → This week (ср 09:00)", "Точно порахувати години не можу: не задані work_hours.",
  ].join("\n");
  const history = { ...blank, toolNames: ["custom:trello_work_history"], historyScopes: [historyScopeDigest("A1")] };
  assert.deepEqual((await run("S48", production, history)).checkFailures, ["time_scope", "no_history_effort", "time_relay", "concise"]);
  // A model guess of hours, even after the right tool, fails.
  assert.deepEqual((await run("S48", `${MISSING}\n\nОрієнтовно 6 год.`, timeA1)).checkFailures, ["no_hours_restated"]);
  // The raw word passed to the tool is wrong (#59 not applied).
  assert.deepEqual((await run("S48", "Мітки «Азов» на дошці Trello не знайшов, тож час не рахую.", { ...timeA1, projectTimeScopes: [historyScopeDigest("Азов")] })).checkFailures,
    ["time_scope", "time_relay"]);
});

test("S49: the code-owned total + breakdown passes; history used as an effort estimate, or a model-made total, fails", async () => {
  assert.deepEqual((await run("S49", ANSWER, timeA1)).checkFailures, []);
  assert.deepEqual((await run("S49", ANSWER, { ...timeA1, toolNames: [...timeA1.toolNames, "custom:trello_work_history"] })).checkFailures, ["no_history_effort"]);
  assert.deepEqual((await run("S49", "Приблизно 7 годин на A1 цього тижня.")).checkFailures, ["time_scope", "time_relay"]);
  assert.deepEqual((await run("S49", "Ти мав на увазі A1?", timeA1)).checkFailures, ["time_relay", "no_alias_question"]);
});

test("work-review routes time questions to the tool; its accepted #36 contract is otherwise byte-identical", () => {
  const skill = read(".claude", "skills", "work-review", "SKILL.md");
  assert.match(skill, /How much time or how many hours went into a project is not a review: call `trello_project_time`/);
  assert.match(skill, /`unavailable` included — never use this tool's moves to estimate effort\./);
  assert.match(skill, /Do not make Project Health judgements, productivity scores, effort\/time claims, trend analysis/, "#36 line kept");
  assert.ok(Buffer.byteLength(skill, "utf8") <= 3 * 1024);
  assert.deepEqual(Object.keys(ISSUE_62_SKILL_EDITS), ["work-review"], "#62 edits exactly one Skill");
  assert.equal(createHash("sha256").update(r30SkillSource("work-review"), "utf8").digest("hex").slice(0, 8), "c079d285", "minus the edit = the pinned bytes");
  // The coordinator prompt is not touched by #62 (#59's paragraph already covers name → label; the size budget is spent).
  assert.ok(Buffer.byteLength(SOURCE_SYSTEM_PROMPT, "utf8") <= 5800);
  assert.doesNotMatch(SOURCE_SYSTEM_PROMPT, /trello_project_time/);
});

test("release: the tool exists only on the unresolved r31 candidate; r30 stays immutable and serving", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R30);
  assert.deepEqual(RELEASE_R30.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget"]);
  for (const release of Object.values(RELEASES)) assert.ok(!release.customTools.includes("trello_project_time"), release.id);
  assert.ok(!Object.values(RELEASES).includes(RELEASE_R31_CANDIDATE as never));
  assert.equal(RELEASES.r31, undefined);
  assert.equal(RELEASE_R31_CANDIDATE.agent.fromVersion, 30);
  assert.equal(RELEASE_R31_CANDIDATE.agent.version, null, "no invented Agent version");
  assert.deepEqual(RELEASE_R31_CANDIDATE.customTools, ["trello_work_history", "trello_board_snapshot", "focus_budget", "trello_project_time"]);
  assert.ok(!RELEASE_R31_CANDIDATE.customTools.includes("reminder"), "reminder stays dormant");
  const unresolved = RELEASE_R31_CANDIDATE.skills.filter((skill) => skill.pin.kind === "unresolved");
  assert.deepEqual(unresolved.map((skill) => skill.name).sort(), ["task-management", "work-review"]);
  assert.ok(unresolved.every((skill) => skill.skillId === null), "no invented remote Skill ids");
  // Everything else is r30's.
  assert.deepEqual(RELEASE_R31_CANDIDATE.skills.filter((skill) => skill.pin.kind !== "unresolved"), RELEASE_R30.skills.filter((skill) => !["task-management", "work-review"].includes(skill.name)));
  assert.equal(RELEASE_R31_CANDIDATE.model, RELEASE_R30.model);
  assert.equal(RELEASE_R31_CANDIDATE.specialist, null);
  assert.deepEqual(RELEASE_R31_CANDIDATE.builtInTools, RELEASE_R30.builtInTools);
  assert.deepEqual(RELEASE_R31_CANDIDATE.mcpToolsets, RELEASE_R30.mcpToolsets);
  assert.deepEqual(RELEASE_R31_CANDIDATE.confirmationRequired, RELEASE_R30.confirmationRequired);
  assert.deepEqual(RELEASE_R31_CANDIDATE.session, RELEASE_R30.session);
  // The candidate's prompt is the reviewed source (#59 paragraph included).
  assert.equal(RELEASE_R31_CANDIDATE.systemSha256, createHash("sha256").update(SOURCE_SYSTEM_PROMPT, "utf8").digest("hex"));
  assert.notEqual(RELEASE_R31_CANDIDATE.systemSha256, RELEASE_R30.systemSha256);
  assert.throws(() => buildCandidateUpdateBody(RELEASE_R31_CANDIDATE, { skills: {} }), UnresolvedReleaseCandidateError);
  const body = buildCandidateUpdateBody(RELEASE_R31_CANDIDATE, { skills: {
    "task-management": { skillId: "skill_TEST62a", version: "skver_TEST62a" }, "work-review": { skillId: "skill_TEST62b", version: "skver_TEST62b" },
  } }, SOURCE_SYSTEM_PROMPT);
  assert.equal(body.version, 30);
  assert.equal(body.system, SOURCE_SYSTEM_PROMPT);
  const custom = (body.tools as Array<{ type: string; name?: string; description?: string; input_schema?: unknown }>).filter((tool) => tool.type === "custom");
  assert.deepEqual(custom.map((tool) => tool.name), ["trello_work_history", "trello_board_snapshot", "focus_budget", "trello_project_time"]);
  const time = custom.find((tool) => tool.name === "trello_project_time")!;
  assert.equal(time.description, SUPPORTED_CUSTOM_TOOLS.trello_project_time.description);
  assert.deepEqual(time.input_schema, SUPPORTED_CUSTOM_TOOLS.trello_project_time.input_schema);
  // The Agent source file still describes the serving r30 (no remote sync happened).
  assert.doesNotMatch(read("managed-agents", "djonik.md"), /trello_project_time/);
});

test("no second time algorithm: the allocation exists once, and no Skill or prompt carries time arithmetic", () => {
  const sources = readdirSync(join(root, "src")).filter((name) => name.endsWith(".ts") && !name.includes(".test"));
  const allocators = sources.filter((name) => /export function allocateWeeklyTime|dailyTimeCapMinutes \* 60_000\s*;/.test(read("src", name)));
  assert.deepEqual(allocators, ["weeklyTime.ts"]);
  assert.match(read("src", "weeklyTime.ts"), /computeProjectTime[\s\S]*allocateWeeklyTime\(inProgressIntervals\(input\)/);
  for (const name of readdirSync(join(root, ".claude", "skills"))) {
    const skill = read(".claude", "skills", name, "SKILL.md");
    assert.doesNotMatch(skill, /split (?:them )?equally|proportional(?:ly)? cap|divide .* by/i, name);
  }
});
