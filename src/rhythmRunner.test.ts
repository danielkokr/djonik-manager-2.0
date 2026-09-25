import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutboundMessage } from "./rhythmActions.js";
import {
  AutonomousTurnFailure,
  AUTONOMOUS_WRITE_NOTICE,
  autonomousWriteViolations,
  buildExceptionPrompt,
  createRhythmScheduler,
  isSilentReply,
  type AutonomousTurnRequest,
  type AutonomousTurnResult,
  type RhythmTickDeps,
  type SendOutcome,
  type ToolUseRecord,
} from "./rhythmRunner.js";
import type { CardFact, SignalFacts } from "./rhythmSignals.js";
import { createMemoryRhythmStateStore, emptyRhythmState, type RhythmState } from "./rhythmState.js";

// #39 Working Rhythm — scheduler tick with injected clock, config, state, Djonik turn and Telegram send.
// Zero network, zero inference.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A scripted turn result; the Session id defaults to the harness's serving Session. */
type ScriptedReply = Omit<AutonomousTurnResult, "sessionId"> & { sessionId?: string };

interface Harness {
  deps: RhythmTickDeps;
  turns: AutonomousTurnRequest[];
  sends: Array<{ message: OutboundMessage; ref: string }>;
  store: ReturnType<typeof createMemoryRhythmStateStore>;
  configReads: number;
  setNow(iso: string): void;
}

function harness(options: {
  now: string;
  enabled?: boolean;
  config?: string | null | (() => never);
  state?: RhythmState;
  reply?: (request: AutonomousTurnRequest) => ScriptedReply | Promise<ScriptedReply>;
  send?: (message: OutboundMessage) => SendOutcome | Promise<SendOutcome>;
  facts?: () => SignalFacts;
  sessionId?: string;
  boundary?: "pre_execution" | "post_hoc_detection_only";
}): Harness {
  let now = new Date(options.now);
  const store = createMemoryRhythmStateStore(options.state ?? emptyRhythmState());
  const h: Harness = {
    turns: [],
    sends: [],
    store,
    configReads: 0,
    setNow: (iso) => {
      now = new Date(iso);
    },
    deps: undefined as unknown as RhythmTickDeps,
  };
  let messageId = 100;
  h.deps = {
    activation: { enabled: options.enabled ?? true, reason: "test" },
    // The fake runner below never writes anything; it stands in for a future enforced boundary.
    readOnlyBoundary: options.boundary ?? "pre_execution",
    now: () => now,
    configSource: {
      read: async () => {
        h.configReads += 1;
        if (typeof options.config === "function") return options.config();
        return options.config ?? null;
      },
    },
    store,
    runTurn: async (request) => {
      h.turns.push(request);
      const scripted = options.reply
        ? await options.reply(request)
        : { reply: "Сьогодні фокус — Cossack Labs.", toolUses: [{ kind: "mcp" as const, name: "trelloReadCard" }] };
      return { sessionId: options.sessionId ?? "sesn_serving", ...scripted };
    },
    send: async (message, ref) => {
      h.sends.push({ message, ref });
      return options.send ? options.send(message) : { status: "sent", messageId: (messageId += 1) };
    },
    // Stage 1 tests tick at arbitrary instants; the exception-only collection cadence has its own test.
    factsIntervalMs: 0,
    ...(options.facts ? { collectFacts: async () => options.facts!() } : {}),
  };
  return h;
}

const MONDAY_0930 = "2026-09-28T06:30:00Z";
const TUESDAY_0935 = "2026-09-29T06:35:00Z";

// --- Feature-off boundary ---------------------------------------------------------------------------

test("feature disabled: no config read, no state write, no model call, no send", async () => {
  const h = harness({ now: MONDAY_0930, enabled: false, facts: () => ({ cards: [], projects: [], followUps: [] }) });
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(report.status, "disabled");
  assert.equal(h.configReads, 0);
  assert.equal(h.turns.length, 0);
  assert.equal(h.sends.length, 0);
  assert.deepEqual(h.store.snapshot(), emptyRhythmState());
});

test("activation invariant: switched on but with only post-hoc write detection → no config read, no model call, no send", async () => {
  const h = harness({ now: MONDAY_0930, boundary: "post_hoc_detection_only", facts: () => overdue() });
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(report.status, "read_only_boundary_missing");
  assert.equal(h.configReads + h.turns.length + h.sends.length, 0);
  assert.deepEqual(h.store.snapshot(), emptyRhythmState());
});

test("activation invariant: no non-test source declares a pre-execution read-only boundary yet", () => {
  const sources = readdirSync(join(repoRoot, "src")).filter((name) => name.endsWith(".ts") && !name.includes(".test"));
  for (const name of sources) {
    const source = readFileSync(join(repoRoot, "src", name), "utf8");
    assert.doesNotMatch(source, /readOnlyBoundary:\s*"pre_execution"/, `${name} must not claim a boundary that does not exist`);
  }
});

test("a state write failing mid-tick fails closed: no throw, no send", async () => {
  const h = harness({ now: TUESDAY_0935 });
  let updates = 0;
  const inner = h.deps.store;
  h.deps.store = { load: inner.load, update: async (mutate) => (++updates === 2 ? Promise.reject(new Error("disk full")) : inner.update(mutate)) };
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(report.status, "error");
  assert.equal(h.sends.length, 0);
});

test("`enabled: off` in /rhythm.md: no model call, no send", async () => {
  const h = harness({ now: MONDAY_0930, config: "enabled: off" });
  assert.equal((await createRhythmScheduler(h.deps).tick()).status, "config_disabled");
  assert.equal(h.turns.length + h.sends.length, 0);
});

test("config source unavailable → skip the tick rather than guess", async () => {
  const h = harness({ now: MONDAY_0930, config: () => { throw new Error("memory down"); } });
  assert.equal((await createRhythmScheduler(h.deps).tick()).status, "config_unavailable");
  assert.equal(h.turns.length + h.sends.length, 0);
});

test("corrupt/unavailable state → no model call, no send", async () => {
  const h = harness({ now: MONDAY_0930 });
  h.deps.store = { load: async () => { throw new Error("corrupt"); }, update: async () => { throw new Error("corrupt"); } };
  assert.equal((await createRhythmScheduler(h.deps).tick()).status, "state_unavailable");
  assert.equal(h.turns.length + h.sends.length, 0);
});

// --- Rituals ------------------------------------------------------------------------------------------

test("Monday 09:30: one read-only week-plan turn, delivered once with Monday buttons", async () => {
  const h = harness({ now: MONDAY_0930 });
  const scheduler = createRhythmScheduler(h.deps);
  const report = await scheduler.tick();
  assert.deepEqual(report.delivery, { key: "monday-plan:2026-09-28", kind: "monday-plan", status: "sent" });
  assert.equal(h.turns.length, 1);
  assert.equal(h.turns[0].origin, "rhythm_ritual");
  assert.match(h.turns[0].prompt, /^\[Робочий ритм · автоматичний хід · план тижня/);
  assert.match(h.turns[0].prompt, /Не змінюй Trello, Memory чи Calendar/);
  assert.match(h.turns[0].prompt, /pm-rhythm/);
  assert.deepEqual(h.sends[0].message.actions, ["accept_plan", "modify", "details"]);
  const record = h.store.snapshot().deliveries["monday-plan:2026-09-28"];
  assert.equal(record.status, "sent");
  assert.equal(record.sessionId, "sesn_serving");
  assert.equal(record.telegramMessageId, 101);
  assert.equal(record.ref, h.sends[0].ref);
});

test("the same occurrence is never sent twice (repeat ticks, a second scheduler after restart)", async () => {
  const h = harness({ now: TUESDAY_0935 });
  await createRhythmScheduler(h.deps).tick();
  h.setNow("2026-09-29T06:50:00Z");
  await createRhythmScheduler(h.deps).tick();
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length, 1);
  assert.equal(h.sends.length, 1);
});

test("missed/late tick within grace delivers once; after grace nothing is sent late", async () => {
  const late = harness({ now: "2026-09-29T08:30:00Z" }); // 11:30 Kyiv
  await createRhythmScheduler(late.deps).tick();
  await createRhythmScheduler(late.deps).tick();
  assert.equal(late.sends.length, 1);
  const expired = harness({ now: "2026-09-29T10:00:00Z" }); // 13:00 Kyiv
  await createRhythmScheduler(expired.deps).tick();
  assert.equal(expired.turns.length + expired.sends.length, 0);
});

test("weekend: silent", async () => {
  const h = harness({ now: "2026-10-03T06:30:00Z" });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length + h.sends.length, 0);
});

test("quiet day: a ritual always speaks; an empty or SILENT ritual reply is a failure, not a send", async () => {
  for (const reply of ["", "SILENT"]) {
    const h = harness({ now: TUESDAY_0935, reply: () => ({ reply, toolUses: [] }) });
    await createRhythmScheduler(h.deps).tick();
    assert.equal(h.sends.length, 0, JSON.stringify(reply));
    assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "failed");
  }
});

// --- Delivery safety ----------------------------------------------------------------------------------

test("restart recovery: an occurrence interrupted mid-send is ambiguous and never resent", async () => {
  const state: RhythmState = {
    ...emptyRhythmState(),
    deliveries: {
      "morning:2026-09-29": {
        key: "morning:2026-09-29", kind: "morning", status: "sending", attempts: 1, ref: "abcdef123456", sessionId: "sesn_old",
        createdAt: "2026-09-29T06:30:00.000Z", updatedAt: "2026-09-29T06:30:05.000Z", actions: ["ack", "reorder", "details"],
      },
    },
  };
  const h = harness({ now: TUESDAY_0935, state });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length + h.sends.length, 0);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "ambiguous");
});

test("restart recovery: an occurrence interrupted before any send (claimed) is retried once", async () => {
  const state: RhythmState = {
    ...emptyRhythmState(),
    deliveries: {
      "morning:2026-09-29": {
        key: "morning:2026-09-29", kind: "morning", status: "claimed", attempts: 1, ref: "abcdef123456", sessionId: "sesn_old",
        createdAt: "2026-09-29T06:30:00.000Z", updatedAt: "2026-09-29T06:30:05.000Z", actions: [],
      },
    },
  };
  const h = harness({ now: TUESDAY_0935, state });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  const record = h.store.snapshot().deliveries["morning:2026-09-29"];
  assert.equal(record.status, "sent");
  assert.equal(record.attempts, 2);
  assert.equal(record.ref, "abcdef123456", "the reference is stable across attempts");
});

test("ambiguous send outcome (network) → never blindly resent", async () => {
  const h = harness({ now: TUESDAY_0935, send: () => ({ status: "unknown", reason: "HttpError" }) });
  await createRhythmScheduler(h.deps).tick();
  h.setNow("2026-09-29T06:45:00Z");
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.turns.length, 1);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "ambiguous");
});

test("a throwing sender is treated as an ambiguous outcome too", async () => {
  const h = harness({ now: TUESDAY_0935, send: () => { throw new Error("socket hang up"); } });
  await createRhythmScheduler(h.deps).tick();
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "ambiguous");
});

test("definite Telegram refusal → one bounded retry, then stop", async () => {
  let refusals = 0;
  const h = harness({ now: TUESDAY_0935, send: () => (refusals += 1, { status: "rejected", reason: "http_400" }) });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(h.sends.length, 2);
  const record = h.store.snapshot().deliveries["morning:2026-09-29"];
  assert.equal(record.status, "failed");
  assert.equal(record.attempts, 2);
});

test("a failed model turn is never re-run blindly", async () => {
  const h = harness({ now: TUESDAY_0935, reply: () => { throw new Error("DjonikTurnIncompleteError"); } });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(h.turns.length, 1);
  assert.equal(h.sends.length, 0);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].failure, "turn_failed");
});

test("overlapping ticks are single-flight", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const h = harness({ now: TUESDAY_0935, reply: async () => (await gate, { reply: "Бриф.", toolUses: [] }) });
  const scheduler = createRhythmScheduler(h.deps);
  const first = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await scheduler.tick()).status, "busy");
  release();
  await first;
  assert.equal(h.sends.length, 1);
});

test("final-only: exactly the turn's final reply is delivered, bounded to one Telegram message", async () => {
  const h = harness({ now: TUESDAY_0935, reply: () => ({ reply: "х".repeat(5000), toolUses: [] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].message.text.length, 4096);
});

// --- Autonomous read-only boundary ----------------------------------------------------------------------

test("autonomous write detection: Trello writes, mutating MCP verbs, Memory write/edit, unknown custom tools", () => {
  const uses: ToolUseRecord[] = [
    { kind: "mcp", name: "trelloReadCard" },
    { kind: "mcp", name: "trelloSearch" },
    { kind: "mcp", name: "list_events" },
    { kind: "builtin", name: "read" },
    { kind: "builtin", name: "grep" },
    { kind: "custom", name: "trello_work_history" },
  ];
  assert.deepEqual(autonomousWriteViolations(uses), []);
  const bad: ToolUseRecord[] = [
    { kind: "mcp", name: "trelloWriteCard" },
    { kind: "mcp", name: "create_event" },
    { kind: "mcp", name: "cardMove" },
    { kind: "builtin", name: "write" },
    { kind: "builtin", name: "edit" },
    { kind: "custom", name: "some_future_tool" },
  ];
  assert.deepEqual(autonomousWriteViolations(bad), bad);
});

test("a scheduled turn that wrote to Trello is not delivered as a brief; Daniel gets a fixed notice", async () => {
  const h = harness({
    now: TUESDAY_0935,
    reply: () => ({ reply: "Переніс картку на завтра ✅", toolUses: [{ kind: "mcp", name: "trelloWriteCard" }, { kind: "mcp", name: "trelloReadCard" }] }),
  });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].message.text, AUTONOMOUS_WRITE_NOTICE);
  assert.deepEqual(h.sends[0].message.actions, [], "no buttons under the notice");
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "blocked");
});

test("Stage 3A: a mutation DENIED before execution is still an autonomous attempt → blocked notice, never the model's text", async () => {
  // The client denied the gated call; the turn completed with the model's (possibly false-success) text and even
  // an empty tool list must not hide the attempt — `autonomousMutationAttempt` alone blocks the delivery.
  const h = harness({
    now: TUESDAY_0935,
    reply: () => ({
      reply: "Переніс картку на завтра ✅",
      toolUses: [],
      confirmations: [{ kind: "mcp", name: "trelloWriteCard", decision: "deny", reason: "autonomous_read_only" }],
      autonomousMutationAttempt: true,
    }),
  });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].message.text, AUTONOMOUS_WRITE_NOTICE);
  assert.deepEqual(h.sends[0].message.actions, []);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "blocked");
});

test("Stage 3A: a failed turn whose only trace is a denied attempt is blocked (not a silent turn_failed)", async () => {
  const h = harness({ now: TUESDAY_0935, reply: () => Promise.reject(new AutonomousTurnFailure([], "sesn_serving", true)) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends[0]?.message.text, AUTONOMOUS_WRITE_NOTICE);
  assert.equal(h.store.snapshot().deliveries["morning:2026-09-29"].status, "blocked");
  // Blocked rituals are never re-run the same day (no alert loop).
  h.setNow("2026-09-29T06:50:00Z");
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.turns.length, 1);
  assert.equal(h.sends.length, 1);
});

test("a scheduled turn that edited Memory (e.g. 'accepted' the plan itself) is blocked the same way", async () => {
  const h = harness({ now: MONDAY_0930, reply: () => ({ reply: "План прийнято.", toolUses: [{ kind: "builtin", name: "edit" }] }) });
  await createRhythmScheduler(h.deps).tick();
  assert.equal(h.sends[0].message.text, AUTONOMOUS_WRITE_NOTICE);
});

/**
 * Stage 2 reviewed exceptions (docs/62): each wiring module may reach exactly one external boundary, and
 * only read-only. Every other rhythm module keeps the Stage 1 rule: no Trello, Session client or Memory path.
 */
const REVIEWED_RHYTHM_IMPORTS: Record<string, RegExp> = {
  "rhythmFacts.ts": /^\.\/(rhythmConfig|rhythmSignals|trelloWorkHistory)\.js$/, // type-only use of the GET-only client
  "rhythmMemoryConfig.ts": /^\.\/rhythmConfig\.js$/,
  // #39 Stage 3A: the reviewed release (to derive the serving boundary) and the reviewed confirmation surface.
  "rhythmRuntime.ts": /^\.\/(djonikClient|release|rhythmConfig|rhythmRunner|rhythmState|rhythmTelegram|telegramAdapter|toolConfirmation)\.js$/,
};

test("the rhythm runtime has no deterministic path to Trello writes, the Session client or Memory (reviewed exceptions only)", () => {
  const files = readdirSync(join(repoRoot, "src")).filter((name) => /^rhythm.*\.ts$/.test(name) && !name.includes(".test"));
  assert.ok(files.length >= 9, files.join(","));
  for (const name of files) {
    const source = readFileSync(join(repoRoot, "src", name), "utf8");
    assert.doesNotMatch(source, /from "\.\/(trelloMutationLedger|customToolResolution)\.js"/, name);
    assert.doesNotMatch(source, /\bfetch\(|api\.trello\.com|trelloWrite\w*\(/, name);
    const allowed = REVIEWED_RHYTHM_IMPORTS[name];
    if (allowed) {
      for (const [, path] of source.matchAll(/from "(\.\/[^"]+)"/g)) assert.match(path, allowed, `${name} imports ${path}`);
    } else {
      assert.doesNotMatch(source, /from "\.\/(djonikClient|trelloWorkHistory)\.js"/, name);
    }
    if (name !== "rhythmMemoryConfig.ts") assert.doesNotMatch(source, /memoryStores|\.memories\./, name);
  }
  // The fact collector only ever sees the GET-only reader interface.
  const facts = readFileSync(join(repoRoot, "src", "rhythmFacts.ts"), "utf8");
  assert.match(facts, /import type \{[^}]*\} from "\.\/trelloWorkHistory\.js"/);
  // The runtime's only Session call is the traced send through the shared queue.
  const runtime = readFileSync(join(repoRoot, "src", "rhythmRuntime.ts"), "utf8");
  assert.deepEqual([...runtime.matchAll(/session\.(\w+)\(/g)].map((m) => m[1]), ["sendTraced"]);
});

test("feature-off / non-activatable boundary: the serving entry point wires the rhythm behind both locks", () => {
  const cli = readFileSync(join(repoRoot, "src", "telegramCli.ts"), "utf8");
  assert.match(cli, /readOnlyBoundary: SERVING_READ_ONLY_BOUNDARY/, "the serving runner declares its real boundary");
  assert.doesNotMatch(cli, /pre_execution|DJONIK_WORKING_RHYTHM\s*=|process\.env\.DJONIK_WORKING_RHYTHM\s*=/);
  // Started only after the attested Session exists, before polling starts.
  const attested = cli.indexOf("await djonikSession.getSession()");
  const started = cli.indexOf("startWorkingRhythm(");
  const polling = cli.indexOf("bot.start(");
  assert.ok(attested > 0 && started > attested && polling > started, "attestation → rhythm wiring → polling");
  const runtime = readFileSync(join(repoRoot, "src", "rhythmRuntime.ts"), "utf8");
  // Stage 3A: the boundary is derived from the one release this revision serves — never declared by hand.
  assert.match(runtime, /export const SERVING_READ_ONLY_BOUNDARY: AutonomousReadOnlyBoundary = readOnlyBoundaryFor\(SERVING_RELEASE\);/);
  const unit = readFileSync(join(repoRoot, "deploy", "djonik-telegram.service"), "utf8");
  assert.doesNotMatch(unit, /^\s*Environment=.*DJONIK_WORKING_RHYTHM/m, "production activation env is absent");
  assert.match(unit, /^StateDirectory=djonik$/m);
  assert.match(unit, /^StateDirectoryMode=0700$/m);
  assert.match(unit, /^ProtectSystem=strict$/m, "hardening unchanged");
});

// --- Exceptions ---------------------------------------------------------------------------------------

/** Tuesday 14:00 Kyiv; the morning ritual is past its grace window. */
const TUESDAY_1400 = "2026-09-29T11:00:00Z";
const overdue = (due = "2026-09-29T10:30:00Z"): SignalFacts => ({
  cards: [{ id: "c1", name: "Концепт упаковки", project: "seqthera", list: "todo", due, dueComplete: false, enteredListAt: null, reopenedFromDoneAt: null } as CardFact],
  projects: [],
  followUps: [],
});

test("deterministic filtering: ritual-only signals never cause a model call", async () => {
  const h = harness({
    now: TUESDAY_1400,
    facts: () => ({ cards: [{ id: "w", name: "Фідбек", project: "extract", list: "waiting", due: null, dueComplete: false, enteredListAt: "2026-09-10T10:00:00Z", reopenedFromDoneAt: null }], projects: [], followUps: [] }),
  });
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(report.exceptionDecision, "none:no_candidate");
  assert.equal(h.turns.length + h.sends.length, 0);
  assert.equal(h.store.snapshot().signals["waiting:w"].status, "open", "observed for the next brief, not raised");
});

test("interrupt candidate → one read-only exception turn with exception buttons; unchanged fact never repeats", async () => {
  const h = harness({ now: TUESDAY_1400, facts: () => overdue(), reply: () => ({ reply: "Seqthera: концепт упаковки прострочено пів години тому. Підняти на зараз?", toolUses: [] }) });
  const scheduler = createRhythmScheduler(h.deps);
  const report = await scheduler.tick();
  assert.equal(report.delivery?.kind, "exception");
  assert.equal(report.delivery?.status, "sent");
  assert.equal(h.turns[0].origin, "rhythm_exception");
  assert.match(h.turns[0].prompt, /відповідай рівно SILENT/);
  assert.match(h.turns[0].prompt, /\[overdue:c1@2026-09-29T10:30:00Z\]/);
  assert.deepEqual(h.sends[0].message.actions, ["raise", "later", "suppress"]);
  const state = h.store.snapshot();
  assert.equal(state.signals["overdue:c1"].status, "notified");
  const record = Object.values(state.deliveries).find((r) => r.kind === "exception")!;
  assert.equal(record.severity, "high");
  assert.deepEqual(record.signalHandles, ["overdue:c1@2026-09-29T10:30:00Z"]);

  h.setNow("2026-09-29T13:30:00Z");
  await scheduler.tick();
  assert.equal(h.turns.length, 1, "no repeat of an unchanged fact, not even a model call");
});

test("exception SILENT → nothing sent, and the unchanged candidate is not re-evaluated", async () => {
  const h = harness({ now: TUESDAY_1400, facts: () => overdue(), reply: () => ({ reply: "SILENT", toolUses: [] }) });
  const scheduler = createRhythmScheduler(h.deps);
  const report = await scheduler.tick();
  assert.equal(report.delivery?.status, "silent");
  assert.equal(h.sends.length, 0);
  assert.equal(h.store.snapshot().signals["overdue:c1"].status, "evaluated");
  h.setNow("2026-09-29T11:30:00Z");
  await scheduler.tick();
  assert.equal(h.turns.length, 1);
});

test("a fact seen before today's brief is folded into that brief, not re-raised as an interruption", async () => {
  const facts = () => overdue("2026-09-29T06:00:00Z"); // 09:00 Kyiv, just before the brief
  const h = harness({ now: TUESDAY_0935, facts });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick(); // morning brief: the overdue fact is a hint in its prompt
  assert.match(h.turns[0].prompt, /Підказки коду/);
  assert.match(h.turns[0].prompt, /overdue:c1@/);
  h.setNow("2026-09-29T07:00:00Z");
  const report = await scheduler.tick();
  assert.equal(report.exceptionDecision, "none:no_candidate");
  assert.equal(h.turns.length, 1);
});

test("exception daily cap: an ambiguous exception counts; a medium follow-up waits for the ritual", async () => {
  let n = 0;
  const h = harness({
    now: TUESDAY_1400,
    facts: () => (n === 0 ? overdue() : { ...overdue(), cards: [...overdue().cards, { id: "a", name: "Hero", project: "cl", list: "todo", due: "2026-09-30T12:00:00Z", dueComplete: false, enteredListAt: null, reopenedFromDoneAt: null }] }),
    send: () => ({ status: "unknown", reason: "timeout" }),
  });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  n = 1;
  h.setNow("2026-09-29T14:30:00Z"); // 17:30 Kyiv, beyond spacing
  const report = await scheduler.tick();
  assert.equal(report.exceptionDecision, "none:preferred_cap_reached");
  assert.equal(h.sends.length, 1);
});

test("an in-flight or ambiguous exception from an earlier day neither blocks nor counts toward today's cap", async () => {
  const yesterday = (status: "sending" | "ambiguous"): RhythmState["deliveries"] => ({
    [`exception:2026-09-28:${status}000000`]: {
      key: `exception:2026-09-28:${status}000000`, kind: "exception", status, attempts: 1, ref: "abcdef123456", sessionId: "sesn_serving",
      createdAt: "2026-09-28T11:00:00.000Z", updatedAt: "2026-09-28T11:00:00.000Z", sendStartedAt: "2026-09-28T11:00:01.000Z", actions: [],
    },
  });
  // Restart case: yesterday's `sending` is recovered to ambiguous today; its time must stay yesterday's.
  const restarted = harness({ now: TUESDAY_1400, state: { ...emptyRhythmState(), deliveries: yesterday("sending") }, facts: () => overdue() });
  assert.equal((await createRhythmScheduler(restarted.deps).tick()).delivery?.kind, "exception");
  assert.equal(restarted.sends.length, 1);

  // In-process case: a record stuck in `sending` since yesterday (no restart in between).
  let facts: SignalFacts = { cards: [], projects: [], followUps: [] };
  const live = harness({ now: TUESDAY_1400, facts: () => facts });
  const scheduler = createRhythmScheduler(live.deps);
  await scheduler.tick(); // startup recovery happens here, with nothing to do
  await live.deps.store.update((s) => ({ ...s, deliveries: { ...s.deliveries, ...yesterday("sending") } }));
  facts = overdue();
  assert.equal((await scheduler.tick()).delivery?.kind, "exception");
  assert.equal(live.sends.length, 1);
});

test("exception prompt and SILENT detection", () => {
  assert.equal(isSilentReply(" SILENT "), true);
  assert.equal(isSilentReply("SILENT."), true);
  assert.equal(isSilentReply("Silent night"), false);
  const prompt = buildExceptionPrompt([], new Date(TUESDAY_1400));
  assert.match(prompt, /автоматичний хід · можливий виняток · вт 29\.09, 14:00/);
});

// --- Stage 2: runtime-wiring contracts -----------------------------------------------------------------

test("Session provenance: the delivery is bound to the Session that produced the reply, not a later one", async () => {
  const h = harness({ now: TUESDAY_0935, reply: () => ({ reply: "Бриф.", sessionId: "sesn_that_ran_the_turn", toolUses: [] }) });
  await createRhythmScheduler(h.deps).tick();
  const record = h.store.snapshot().deliveries["morning:2026-09-29"];
  assert.equal(record.status, "sent");
  assert.equal(record.sessionId, "sesn_that_ran_the_turn");
});

test("a scheduled turn that failed AFTER attempting a write still gets the fixed notice (blocked)", async () => {
  const h = harness({
    now: TUESDAY_0935,
    reply: () => {
      throw new AutonomousTurnFailure([{ kind: "mcp", name: "trelloWriteCard" }], "sesn_serving");
    },
  });
  const report = await createRhythmScheduler(h.deps).tick();
  assert.equal(report.delivery?.status, "blocked");
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].message.text, AUTONOMOUS_WRITE_NOTICE);
  assert.deepEqual(h.sends[0].message.actions, []);
});

test("a scheduled turn that failed with only reads is a quiet failure: nothing sent, never re-run", async () => {
  const h = harness({
    now: TUESDAY_0935,
    reply: () => {
      throw new AutonomousTurnFailure([{ kind: "builtin", name: "read" }, { kind: "custom", name: "trello_work_history" }], "sesn_serving");
    },
  });
  const scheduler = createRhythmScheduler(h.deps);
  assert.equal((await scheduler.tick()).delivery?.status, "failed");
  await scheduler.tick();
  assert.equal(h.sends.length, 0);
  assert.equal(h.turns.length, 1);
});

test("fact cadence: exception-only collection is spaced; a due ritual always collects; nothing in quiet hours", async () => {
  let collections = 0;
  const h = harness({ now: TUESDAY_1400, facts: () => (collections++, { cards: [], projects: [], followUps: [] }) });
  h.deps.factsIntervalMs = 15 * 60_000;
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  h.setNow("2026-09-29T11:05:00Z");
  await scheduler.tick();
  assert.equal(collections, 1, "within the interval: no second Trello read");
  h.setNow("2026-09-29T11:16:00Z");
  await scheduler.tick();
  assert.equal(collections, 2);
  h.setNow("2026-09-29T19:00:00Z"); // 22:00 Kyiv, quiet hours, no ritual due
  await scheduler.tick();
  assert.equal(collections, 2, "no exception window → no collection");
  h.setNow("2026-09-30T06:31:00Z"); // Wednesday 09:31: the morning ritual collects fresh facts regardless
  await scheduler.tick();
  assert.equal(collections, 3);
  assert.equal(h.turns.length, 1);
});

test("invalid /rhythm.md values: mentioned once inside the next ritual, never as a separate or repeated message", async () => {
  const config = "morning: 25:99\nfriday_review: never";
  const h = harness({ now: TUESDAY_0935, config });
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  assert.match(h.turns[0].prompt, /У \/rhythm\.md є значення, які не вдалося застосувати/);
  assert.match(h.turns[0].prompt, /invalid value for morning/);
  assert.ok(h.store.snapshot().configNotice?.digest, "only a digest is stored, never the text");
  assert.doesNotMatch(JSON.stringify(h.store.snapshot()), /morning; using|friday_review/);

  h.setNow("2026-09-29T11:00:00Z");
  await scheduler.tick();
  h.setNow("2026-09-30T06:35:00Z"); // next morning, same warnings
  await scheduler.tick();
  assert.equal(h.turns.length, 2);
  assert.doesNotMatch(h.turns[1].prompt, /не вдалося застосувати/, "unchanged warnings are not repeated");
  assert.equal(h.sends.length, 2, "no standalone warning message ever");
});

test("invalid config note: fixed warnings are forgotten, so a later new problem is mentioned again", async () => {
  let config = "morning: 25:99";
  const h = harness({ now: TUESDAY_0935, config: null });
  h.deps.configSource = { read: async () => config };
  const scheduler = createRhythmScheduler(h.deps);
  await scheduler.tick();
  config = "morning: 09:30";
  h.setNow("2026-09-29T11:00:00Z");
  await scheduler.tick();
  assert.equal(h.store.snapshot().configNotice, undefined);
  config = "morning: 25:99";
  h.setNow("2026-09-30T06:35:00Z");
  await scheduler.tick();
  assert.match(h.turns[1].prompt, /не вдалося застосувати/);
});
