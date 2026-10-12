import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik, createCustomToolRouter, DJONIK_MEMORY_INSTRUCTIONS, type DjonikTraceEvent } from "./djonikClient.js";
import * as releaseModule from "./release.js";
import { RELEASE_R31, RELEASES, SERVING_RELEASE, type DjonikRelease, type DjonikReleaseCandidate } from "./release.js";
import { canonicalJsonSha256, normalizeAgentConfig, sha256, SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";
import { buildAgentUpdateBody } from "./releasePlan.js";
import { SOURCE_SYSTEM_PROMPT } from "./releaseFixtures.test-helpers.js";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import { createMemoryRhythmStateStore, remindersOf, type RhythmStateStore } from "./rhythmState.js";
import { createReminderToolExecutor, REMINDER_TOOL, REMINDER_TOOL_NAME } from "./reminderTool.js";

// #68 (docs/107). Production, 2026-10-08: «нагадай мені завтра заповнити звіт в 10 ранку» → "окремого інструменту
// нагадувань у мене зараз немає". Root cause: the accepted #54 `reminder` tool is executable by the application but no
// reviewed release up to the serving r31 (Agent v31) exposes it, so the model truthfully had no such tool.
//
// What is proven here, with zero network and zero inference:
//  1. the release surface — the omission is pinned as a known historical fact, and no later release or candidate may
//     repeat it silently;
//  2. the executable path — the tool call a model produces for exactly that message runs through the serving router
//     and the real executor and answers with the code-resolved 10:00, never a morning-brief slot.
// What is NOT proven: that the model turns Daniel's sentence into that call. Only a live turn on an Agent version that
// exposes the tool can show that (docs/04 §27).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The last Agent version constructed without `reminder`. Releases up to it are immutable history. */
const LAST_AGENT_VERSION_WITHOUT_REMINDER = 31;

// --- 1. Release surface ---------------------------------------------------------------------------------------------

test("#68 root cause: the serving release and every reviewed release up to r31 omit `reminder`, so the adapter keeps reminders off", () => {
  assert.equal(SERVING_RELEASE, RELEASE_R31, "this revision still serves r31; #68 changes no serving tuple");
  for (const release of Object.values(RELEASES)) {
    if (release.agent.version > LAST_AGENT_VERSION_WITHOUT_REMINDER) continue;
    assert.ok(!release.customTools.includes(REMINDER_TOOL_NAME), `${release.id} is immutable history without reminder`);
  }
  // The one switch of the whole capability: tool store, delivery timer and buttons all hang on this expression.
  const cli = readFileSync(join(repoRoot, "src", "telegramCli.ts"), "utf8");
  assert.match(cli, /const remindersEnabled = release\.customTools\.includes\(REMINDER_TOOL_NAME\);/);
});

test("#68 guard: a release or candidate built after Agent v31 cannot silently omit `reminder`", () => {
  for (const release of Object.values(RELEASES)) {
    if (release.agent.version <= LAST_AGENT_VERSION_WITHOUT_REMINDER) continue;
    assert.ok(release.customTools.includes(REMINDER_TOOL_NAME), `${release.id} (Agent v${release.agent.version}) must expose the accepted #54 reminder tool`);
  }
  const candidates = Object.values(releaseModule).filter(
    (value): value is DjonikReleaseCandidate => typeof value === "object" && value !== null && "candidateId" in value,
  );
  assert.ok(candidates.length >= 4, "the candidates are discovered from release.ts exports");
  for (const candidate of candidates) {
    if (candidate.agent.fromVersion < LAST_AGENT_VERSION_WITHOUT_REMINDER) continue;
    assert.ok(candidate.customTools.includes(REMINDER_TOOL_NAME), `${candidate.candidateId} must expose the accepted #54 reminder tool`);
  }
});

test("#68 readiness: adding `reminder` to r31's tools yields an update body whose tool is exactly the one this application executes", () => {
  const next: DjonikRelease = { ...RELEASE_R31, customTools: [...RELEASE_R31.customTools, REMINDER_TOOL_NAME] };
  const body = buildAgentUpdateBody(next, RELEASE_R31.agent.version);
  const observed = normalizeAgentConfig({ tools: body.tools }).customTools;
  assert.deepEqual(observed.map((tool) => tool.name), [...RELEASE_R31.customTools, REMINDER_TOOL_NAME], "no r31 tool lost, one added");
  const reminder = observed.find((tool) => tool.name === REMINDER_TOOL_NAME)!;
  assert.equal(SUPPORTED_CUSTOM_TOOLS[REMINDER_TOOL_NAME], REMINDER_TOOL);
  assert.equal(reminder.schemaSha256, canonicalJsonSha256(REMINDER_TOOL.input_schema));
  assert.equal(reminder.descriptionSha256, sha256(REMINDER_TOOL.description));
});

test("#68: no active instruction denies reminders or sends them to Trello or the brief — the tool description is the only authority", () => {
  const skillsDir = join(repoRoot, ".claude", "skills");
  const sources: Record<string, string> = { "coordinator prompt": SOURCE_SYSTEM_PROMPT };
  for (const name of readdirSync(skillsDir)) sources[`Skill ${name}`] = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
  for (const [label, text] of Object.entries(sources)) assert.doesNotMatch(text, /remind/i, `${label} carries no reminder instruction`);
  assert.match(DJONIK_MEMORY_INSTRUCTIONS, /Promise a reminder only after the reminder tool saved it\./);
  assert.doesNotMatch(DJONIK_MEMORY_INSTRUCTIONS, /do not promise reminders/);
  // The routing the model needs ships with the tool itself, including the exact production shape (day + time).
  assert.match(REMINDER_TOOL.description, /Use only when Daniel asks to be reminded \(create\)/);
  assert.match(REMINDER_TOOL.description, /'завтра о 9' \{day:'tomorrow',time:'09:00'\}/);
  assert.match(REMINDER_TOOL.description, /never changes Trello and is not a commitment in Memory/);
});

// --- 2. Executable path for the production message ------------------------------------------------------------------

const MESSAGE = "нагадай мені завтра заповнити звіт в 10 ранку";
/** The structured call the tool description asks the model for: Daniel's words, never a computed date. */
const MODEL_CALL = { op: "create", text: "заповнити звіт", when: { day: "tomorrow", time: "10:00" } };
/** Thursday 2026-10-08, 14:00 Kyiv — the day of the production message. */
const NOW = new Date("2026-10-08T11:00:00Z");
const CONFIRMATION = "🔔 Нагадаю завтра, пт 09.10 о 10:00: заповнити звіт";

async function turn(store: RhythmStateStore | null, modelText: string) {
  const sent: Array<Record<string, unknown>> = [];
  const events: unknown[] = [
    { type: "agent.custom_tool_use", id: "sevt_68", name: REMINDER_TOOL_NAME, input: MODEL_CALL },
    { type: "session.status_idle", id: "idle_68", stop_reason: { type: "requires_action", event_ids: ["sevt_68"] } },
    { type: "user.custom_tool_result", id: "echo_68", custom_tool_use_id: "sevt_68", is_error: false, content: [] },
    { type: "agent.message", content: [{ type: "text", text: modelText }] },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<{ value: unknown; done: boolean }> =>
        events.length > 0 ? Promise.resolve({ value: events.shift(), done: false }) : new Promise(() => {}),
    }),
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "sesn_68" }),
        events: {
          stream: async () => stream,
          send: async (_id: string, params: { events: Array<Record<string, unknown>> }) => void sent.push(...params.events),
        },
      },
    },
  } as unknown as Anthropic;
  // The serving adapter's own router (`telegramCli.ts`), with the real executor behind `reminder`.
  const router = createCustomToolRouter({
    reminder: createReminderToolExecutor({ store, now: () => NOW, readConfig: async () => DEFAULT_RHYTHM_CONFIG, ritualsRunning: () => true }),
    workHistory: async () => assert.fail("a reminder never reaches Trello history"),
    boardSnapshot: async () => assert.fail("a reminder never reaches Trello"),
  });
  const traces: DjonikTraceEvent[] = [];
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x", (event) => traces.push(event), undefined, "telegram", router, { now: () => NOW });
  const reply = await session.send(MESSAGE);
  session.close();
  const results = sent.filter((event) => event.type === "user.custom_tool_result");
  return { reply, traces, results };
}

test(`#68: the model's reminder call for «${MESSAGE}» is saved as a timed 10:00 reminder and confirmed with the code-resolved time`, async () => {
  const store = createMemoryRhythmStateStore();
  // The model paraphrases instead of quoting: the code-owned line must still reach Daniel, first and unchanged.
  const { reply, traces, results } = await turn(store, "Готово, нагадаю.");
  assert.equal(reply.split("\n")[0], CONFIRMATION);
  assert.ok(reply.includes("Готово, нагадаю."));
  assert.deepEqual(traces.filter((trace) => trace.type === "reminder_confirmation_composed"), [{ type: "reminder_confirmation_composed", mode: "prepended", count: 1 }]);
  assert.equal(results.length, 1, "one result for one custom_tool_use_id");

  const items = Object.values(remindersOf(await store.load()).items);
  assert.equal(items.length, 1);
  const [reminder] = items;
  assert.equal(reminder.status, "scheduled");
  assert.equal(reminder.text, "заповнити звіт");
  assert.equal(reminder.schedule.mode, "timed", "an explicit time is never turned into a morning-brief reminder");
  assert.equal(reminder.schedule.date, "2026-10-09");
  assert.equal(reminder.schedule.mode === "timed" && reminder.schedule.time, "10:00");
  assert.equal(reminder.schedule.dueAt, "2026-10-09T07:00:00.000Z", "10:00 Europe/Kyiv (UTC+3 on that date)");
  assert.ok(!reminder.schedule.quietShifted, "10:00 is outside the default quiet hours (20:00–09:30)");
  assert.equal(reminder.card ?? null, null);
});

test("#68: when the store is missing the model gets the bounded `unavailable` failure — no confirmation is composed and nothing is promised", async () => {
  const { reply, traces, results } = await turn(null, "Не вдалося зберегти нагадування — воно не збережене.");
  assert.equal(reply, "Не вдалося зберегти нагадування — воно не збережене.");
  assert.ok(!reply.includes("🔔"));
  assert.deepEqual(traces.filter((trace) => trace.type === "reminder_confirmation_composed"), []);
  assert.equal(results.length, 1);
  assert.equal(results[0].is_error, true);
  assert.match(JSON.stringify(results[0].content), /unavailable/);
  assert.match(JSON.stringify(results[0].content), /nothing was saved/);
});
