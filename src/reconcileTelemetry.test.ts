import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeTelemetryCapture,
  groupTelegramTurnsBySession,
  parseTelemetryLines,
  reconcileTelemetry,
  type TurnUsageRecord,
} from "./reconcileTelemetry.js";

function record(overrides: Partial<TurnUsageRecord> = {}): TurnUsageRecord {
  return {
    recordedAt: "2026-09-16T10:00:00.000Z",
    source: "telegram",
    usageScope: "turn_delta",
    sessionId: "sesn_default",
    modelIterations: 1,
    toolCalls: 0,
    toolNames: [],
    memoryRead: false,
    skillRead: false,
    verificationNudges: 0,
    usage: {
      inputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 5, outputTokens: 7,
      listCostAmount: "11", listCostCurrency: "USD",
    },
    ...overrides,
  };
}

test("reconciliation aggregates only Telegram turn deltas within [from, to)", () => {
  const report = reconcileTelemetry([
    record(),
    record({ recordedAt: "2026-09-16T10:30:00.000Z", usage: {
      inputTokens: 11, cacheCreationInputTokens: 13, cacheReadInputTokens: 17, outputTokens: 19,
      listCostAmount: "23", listCostCurrency: "USD",
    } }),
    record({ source: "diagnostic" }),
    record({ recordedAt: "2026-09-16T11:00:00.000Z" }),
  ], "2026-09-16T10:00:00.000Z", "2026-09-16T11:00:00.000Z", "50");

  assert.deepEqual(report, {
    from: "2026-09-16T10:00:00.000Z", to: "2026-09-16T11:00:00.000Z",
    visibleTurns: 2, usageMeasuredTurns: 2, missingUsageTurns: 0,
    uncachedInputTokens: 13, cacheCreationInputTokens: 16, cacheReadInputTokens: 22,
    totalInputCompositionTokens: 51, outputTokens: 26,
    listCostAmount: "34", listCostCurrency: "USD",
    consoleListCostAmount: "50", estimatedNonTelegramListCostAmount: "16",
    ignoredNonTelegramRecords: 1,
  });
});

test("parser ignores ordinary logs, rejects malformed records, and refuses cumulative records", () => {
  const valid = JSON.stringify(record());
  const parsed = parseTelemetryLines([
    "Connecting to Djonik",
    `[turn] ${valid}`,
    "[turn] not-json",
    `[turn] ${JSON.stringify({ ...record(), usageScope: "session_cumulative" })}`,
  ]);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.ignoredNonTelemetryLines, 1);
  assert.equal(parsed.ignoredMalformedTelemetryLines, 1);
  assert.equal(parsed.ignoredNonTurnDeltaRecords, 1);
});

test("parser accepts a PowerShell-prefixed telemetry object wrapped across lines", () => {
  const wrapped = JSON.stringify(record()).replace(',"source"', ',\n"source"');
  const parsed = parseTelemetryLines([`node.exe : [turn] ${wrapped}`]);
  assert.deepEqual(parsed.records, [record()]);
});

test("PowerShell UTF-16 capture decoding preserves telemetry records", () => {
  const capture = `node.exe : [turn] ${JSON.stringify(record())}`;
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(capture, "utf16le")]);
  assert.deepEqual(parseTelemetryLines(decodeTelemetryCapture(utf16).split(/\r?\n/)).records, [record()]);
});

test("parser rejects a turn_delta record missing #20 per-turn metadata (e.g. pre-#20 sessionId-less records)", () => {
  const { sessionId, ...withoutSessionId } = record();
  const parsed = parseTelemetryLines([`[turn] ${JSON.stringify(withoutSessionId)}`]);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.ignoredMalformedTelemetryLines, 1);
});

test("groupTelegramTurnsBySession orders turns by recordedAt into a sequential turnIndex per session", () => {
  const report = groupTelegramTurnsBySession([
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:10:00.000Z", modelIterations: 2 }),
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:00:00.000Z", modelIterations: 1 }),
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:20:00.000Z", modelIterations: 3 }),
  ]);

  assert.equal(report.sessionCount, 1);
  assert.equal(report.totalTurns, 3);
  const [session] = report.sessions;
  assert.equal(session.sessionId, "sesn_A");
  assert.deepEqual(
    session.turns.map((turn) => [turn.turnIndex, turn.recordedAt, turn.modelIterations]),
    [
      [1, "2026-09-16T10:00:00.000Z", 1],
      [2, "2026-09-16T10:10:00.000Z", 2],
      [3, "2026-09-16T10:20:00.000Z", 3],
    ],
  );
});

test("groupTelegramTurnsBySession keeps multiple real sessions separate with independent turnIndex sequences", () => {
  const report = groupTelegramTurnsBySession([
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:00:00.000Z" }),
    record({ sessionId: "sesn_B", recordedAt: "2026-09-16T09:00:00.000Z" }),
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:05:00.000Z" }),
  ]);

  assert.equal(report.sessionCount, 2);
  assert.equal(report.totalTurns, 3);
  const sessionA = report.sessions.find((session) => session.sessionId === "sesn_A");
  const sessionB = report.sessions.find((session) => session.sessionId === "sesn_B");
  assert.equal(sessionA?.turnCount, 2);
  assert.equal(sessionB?.turnCount, 1);
  assert.equal(sessionB?.turns[0].turnIndex, 1);
});

test("groupTelegramTurnsBySession excludes non-Telegram records and preserves missing-usage turns as null", () => {
  const report = groupTelegramTurnsBySession([
    record({ sessionId: "sesn_A" }),
    record({ sessionId: "sesn_A", source: "diagnostic" }),
    record({ sessionId: "sesn_A", recordedAt: "2026-09-16T10:05:00.000Z", usage: null }),
  ]);

  assert.equal(report.sessionCount, 1);
  assert.equal(report.sessions[0].turnCount, 2);
  const missingUsageTurn = report.sessions[0].turns[1];
  assert.equal(missingUsageTurn.totalInputCompositionTokens, null);
  assert.equal(missingUsageTurn.outputTokens, null);
  assert.equal(missingUsageTurn.listCostAmount, null);
});

test("groupTelegramTurnsBySession output is content-free: only the documented per-turn fields are present", () => {
  const report = groupTelegramTurnsBySession([record()]);
  const turn = report.sessions[0].turns[0];
  assert.deepEqual(Object.keys(turn).sort(), [
    "cacheCreationInputTokens",
    "cacheReadInputTokens",
    "listCostAmount",
    "listCostCurrency",
    "memoryRead",
    "modelIterations",
    "outputTokens",
    "recordedAt",
    "sessionId",
    "skillRead",
    "toolCalls",
    "toolNames",
    "totalInputCompositionTokens",
    "turnIndex",
    "uncachedInputTokens",
    "verificationNudges",
  ].sort());
});

test("existing #19 reconciliation totals do not regress after #20 metadata was added to TurnUsageRecord", () => {
  const report = reconcileTelemetry(
    [record(), record({ recordedAt: "2026-09-16T10:30:00.000Z" })],
    "2026-09-16T10:00:00.000Z",
    "2026-09-16T11:00:00.000Z",
  );
  assert.equal(report.visibleTurns, 2);
  assert.equal(report.usageMeasuredTurns, 2);
  assert.equal(report.totalInputCompositionTokens, 20);
  assert.equal(report.outputTokens, 14);
  assert.equal(report.listCostAmount, "22");
});
