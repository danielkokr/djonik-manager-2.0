import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { pathToFileURL } from "node:url";

export interface TurnUsageRecord {
  recordedAt: string;
  source: "telegram" | "diagnostic" | "unknown";
  usageScope: "turn_delta";
  usage: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    outputTokens: number;
    listCostAmount: string;
    listCostCurrency: string;
  } | null;
}

export interface ReconciliationReport {
  from: string;
  to: string;
  visibleTurns: number;
  usageMeasuredTurns: number;
  missingUsageTurns: number;
  uncachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalInputCompositionTokens: number;
  outputTokens: number;
  listCostAmount: string | null;
  listCostCurrency: string | null;
  estimatedNonTelegramListCostAmount?: string;
  consoleListCostAmount?: string;
  ignoredNonTelemetryLines: number;
  ignoredMalformedTelemetryLines: number;
  ignoredNonTurnDeltaRecords: number;
  ignoredNonTelegramRecords: number;
}

function isUtcInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isCompleteUsage(value: unknown): value is NonNullable<TurnUsageRecord["usage"]> {
  if (!value || typeof value !== "object") return false;
  const usage = value as Record<string, unknown>;
  return ["inputTokens", "cacheCreationInputTokens", "cacheReadInputTokens", "outputTokens"].every(
    (key) => typeof usage[key] === "number" && Number.isFinite(usage[key]) && (usage[key] as number) >= 0,
  ) && typeof usage.listCostAmount === "string" && /^\d+$/.test(usage.listCostAmount) &&
    typeof usage.listCostCurrency === "string" && usage.listCostCurrency.length > 0;
}

function asTurnUsageRecord(value: unknown): TurnUsageRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isUtcInstant(String(record.recordedAt)) ||
      !["telegram", "diagnostic", "unknown"].includes(String(record.source)) ||
      record.usageScope !== "turn_delta") return null;
  return {
    recordedAt: record.recordedAt as string,
    source: record.source as TurnUsageRecord["source"],
    usageScope: "turn_delta",
    usage: isCompleteUsage(record.usage) ? record.usage : null,
  };
}

function jsonObjectEnd(input: string, start: number): number | null {
  if (input[start] !== "{") return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index + 1;
  }
  return null;
}

/** Reads explicit `[turn]` JSON even when PowerShell prefixes/wraps stderr; normal output is ignored. */
export function parseTelemetryLines(lines: string[]): {
  records: TurnUsageRecord[];
  ignoredNonTelemetryLines: number;
  ignoredMalformedTelemetryLines: number;
  ignoredNonTurnDeltaRecords: number;
} {
  const records: TurnUsageRecord[] = [];
  let ignoredNonTelemetryLines = 0;
  let ignoredMalformedTelemetryLines = 0;
  let ignoredNonTurnDeltaRecords = 0;

  const input = lines.join("\n");
  const markers = [...input.matchAll(/\[turn\]\s+/g)];
  ignoredNonTelemetryLines = lines.filter((line) => line.trim().length > 0).length - markers.length;

  for (const marker of markers) {
    const payloadStart = (marker.index ?? 0) + marker[0].length;
    const objectEnd = jsonObjectEnd(input, payloadStart);
    if (objectEnd === null) {
      ignoredMalformedTelemetryLines += 1;
      continue;
    }
    try {
      // Telemetry is emitted by JSON.stringify() on one line. PowerShell can insert
      // display-wrap newlines while redirecting native stderr, so remove only those
      // transport artifacts inside this otherwise compact JSON payload.
      const parsed = JSON.parse(input.slice(payloadStart, objectEnd).replace(/\r?\n/g, "")) as Record<string, unknown>;
      if (parsed.usageScope !== "turn_delta") {
        ignoredNonTurnDeltaRecords += 1;
        continue;
      }
      const record = asTurnUsageRecord(parsed);
      if (record === null) {
        ignoredMalformedTelemetryLines += 1;
      } else {
        records.push(record);
      }
    } catch {
      ignoredMalformedTelemetryLines += 1;
    }
  }
  return { records, ignoredNonTelemetryLines, ignoredMalformedTelemetryLines, ignoredNonTurnDeltaRecords };
}

export function reconcileTelemetry(
  records: TurnUsageRecord[],
  from: string,
  to: string,
  consoleListCostAmount?: string,
): Omit<ReconciliationReport, "ignoredNonTelemetryLines" | "ignoredMalformedTelemetryLines" | "ignoredNonTurnDeltaRecords"> {
  if (!isUtcInstant(from) || !isUtcInstant(to) || Date.parse(from) >= Date.parse(to)) {
    throw new Error("--from and --to must be ISO 8601 UTC instants with from before to.");
  }
  if (consoleListCostAmount !== undefined && !/^\d+$/.test(consoleListCostAmount)) {
    throw new Error("--console-list-cost must be a non-negative integer in the Console's lowest currency unit.");
  }

  const selected = records.filter(
    (record) => record.source === "telegram" && record.recordedAt >= from && record.recordedAt < to,
  );
  const measured = selected.filter((record): record is TurnUsageRecord & { usage: NonNullable<TurnUsageRecord["usage"]> } => record.usage !== null);
  const currencies = new Set(measured.map((record) => record.usage.listCostCurrency));
  if (currencies.size > 1) throw new Error("Telegram telemetry has mixed list-cost currencies in one window.");

  const total = measured.reduce((sum, record) => ({
    uncachedInputTokens: sum.uncachedInputTokens + record.usage.inputTokens,
    cacheCreationInputTokens: sum.cacheCreationInputTokens + record.usage.cacheCreationInputTokens,
    cacheReadInputTokens: sum.cacheReadInputTokens + record.usage.cacheReadInputTokens,
    outputTokens: sum.outputTokens + record.usage.outputTokens,
    listCostAmount: sum.listCostAmount + BigInt(record.usage.listCostAmount),
  }), { uncachedInputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, listCostAmount: 0n });
  const listCostCurrency = currencies.values().next().value ?? null;
  const listCostAmount = measured.length === 0 ? null : total.listCostAmount.toString();
  const report = {
    from,
    to,
    visibleTurns: selected.length,
    usageMeasuredTurns: measured.length,
    missingUsageTurns: selected.length - measured.length,
    uncachedInputTokens: total.uncachedInputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens,
    totalInputCompositionTokens: total.uncachedInputTokens + total.cacheCreationInputTokens + total.cacheReadInputTokens,
    outputTokens: total.outputTokens,
    listCostAmount,
    listCostCurrency,
    ...(consoleListCostAmount !== undefined && listCostAmount !== null
      ? { consoleListCostAmount, estimatedNonTelegramListCostAmount: (BigInt(consoleListCostAmount) - BigInt(listCostAmount)).toString() }
      : {}),
    ignoredNonTelegramRecords: records.filter((record) => record.source !== "telegram").length,
  };
  return report;
}

function usage(): never {
  throw new Error("Usage: npm run telemetry:reconcile -- -- --from <UTC> --to <UTC> [--file <path>] [--console-list-cost <integer>]");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) usage();
  return args[index + 1];
}

export function decodeTelemetryCapture(bytes: Buffer): string {
  // Windows PowerShell's Tee-Object commonly writes UTF-16 LE with a BOM.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  return bytes.toString("utf8");
}

async function readInput(file: string | undefined): Promise<string> {
  if (file) return decodeTelemetryCapture(await readFile(file));
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  // npm's Windows argument forwarding can retain one or more separator tokens.
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const from = option(args, "--from");
  const to = option(args, "--to");
  if (!from || !to) usage();
  const input = await readInput(option(args, "--file"));
  const parsed = parseTelemetryLines(input.split(/\r?\n/));
  const report = reconcileTelemetry(parsed.records, from, to, option(args, "--console-list-cost"));
  console.log(JSON.stringify({
    ...report,
    ignoredNonTelemetryLines: parsed.ignoredNonTelemetryLines,
    ignoredMalformedTelemetryLines: parsed.ignoredMalformedTelemetryLines,
    ignoredNonTurnDeltaRecords: parsed.ignoredNonTurnDeltaRecords,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
