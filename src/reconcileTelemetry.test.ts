import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTelemetryCapture, parseTelemetryLines, reconcileTelemetry, type TurnUsageRecord } from "./reconcileTelemetry.js";

function record(overrides: Partial<TurnUsageRecord> = {}): TurnUsageRecord {
  return {
    recordedAt: "2026-09-16T10:00:00.000Z",
    source: "telegram",
    usageScope: "turn_delta",
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
