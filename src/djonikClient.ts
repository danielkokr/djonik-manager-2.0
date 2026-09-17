import Anthropic from "@anthropic-ai/sdk";

/**
 * Raw image bytes for one multimodal turn, transported as an inline base64
 * `image` content block on the `user.message` event (official Managed
 * Agents Sessions support — see `docs/02_DEVELOPMENT_ROADMAP.md` #22
 * discovery). `byteSize` is the decoded (non-base64) size in bytes; it is
 * carried through only for content-free telemetry, never logged as image
 * content.
 */
export interface DjonikImageInput {
  /** Base64-encoded image data, no `data:` URI prefix. */
  data: string;
  /** One of the four MIME types the Claude API accepts: jpeg/png/gif/webp. */
  mediaType: string;
  byteSize: number;
}

/**
 * Raw document bytes for one multimodal turn, transported as an inline base64
 * `document` content block on the `user.message` event (official Managed
 * Agents Sessions support — see `docs/02_DEVELOPMENT_ROADMAP.md` #24
 * discovery; same mechanism as images, no Files API upload step needed).
 * `byteSize` is the decoded (non-base64) size in bytes; `filename`, when
 * present, is passed through as the document block's `title` so the Managed
 * Agent can ground "this came from file X" — never logged, never stored
 * beyond the turn.
 */
export interface DjonikDocumentInput {
  /** Base64-encoded document data, no `data:` URI prefix. */
  data: string;
  /** MIME type of the document (e.g. "application/pdf"). */
  mediaType: string;
  byteSize: number;
  filename?: string;
}

export interface DjonikSessionHandle {
  sessionId: string;
  /**
   * Sends one visible user turn. `text` may be empty when `image` or
   * `document` is present (e.g. a Telegram file with no caption); at least
   * one of the three must be non-empty.
   */
  send(text: string, image?: DjonikImageInput, document?: DjonikDocumentInput): Promise<string>;
  /** Aborts the session's open event stream so the process can exit cleanly. */
  close(): void;
}

export type DjonikTurnSource = "telegram" | "diagnostic" | "unknown";

export interface DjonikCumulativeUsage {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  listCostAmount?: string;
  listCostCurrency?: string;
}

/** Content-free summary emitted once per visible user turn when enabled by the caller. */
export interface DjonikTurnTelemetry {
  /** ISO 8601 UTC instant at which this completed visible turn was recorded. */
  recordedAt: string;
  source: DjonikTurnSource;
  sessionId: string;
  /** Reconciliation must only aggregate records with this explicit per-turn scope. */
  usageScope: "turn_delta";
  modelIterations: number;
  toolCalls: number;
  toolNames: string[];
  mcpResults: number;
  verificationNudges: number;
  skillRead: boolean;
  memoryRead: boolean;
  /** Whether this visible turn included image input. Never carries image bytes/content. */
  hasImage: boolean;
  /** MIME type of the input image (e.g. "image/jpeg"), or null when `hasImage` is false. */
  imageMimeType: string | null;
  /** Decoded byte size of the input image; not sensitive on its own. Null when `hasImage` is false. */
  imageByteSize: number | null;
  /** Whether this visible turn included document/file input (#24). Never carries file bytes/content. */
  hasFile: boolean;
  /** MIME type of the input document (e.g. "application/pdf"), or null when `hasFile` is false. */
  fileMimeType: string | null;
  /** Decoded byte size of the input document; not sensitive on its own. Null when `hasFile` is false. */
  fileByteSize: number | null;
  /** Whether the document had a filename at all — never the filename itself, which could carry
   *  client-sensitive content. Null when `hasFile` is false. */
  fileNamePresent: boolean | null;
  /** Per-visible-turn delta, never the session's cumulative usage snapshot. */
  usage: DjonikCumulativeUsage | null;
}

export interface DjonikTurnTelemetryCollector {
  recordModelIteration(): void;
  recordMcpToolUse(toolName: string): void;
  recordMcpResult(): void;
  recordBuiltInRead(input: Record<string, unknown>): void;
  recordVerificationNudge(): void;
  /** Records that this turn's input included an image. Content-free: mimeType/byteSize only. */
  recordInputImage(meta: { mimeType: string; byteSize: number }): void;
  /** Records that this turn's input included a document/file (#24). Content-free: mimeType/byteSize
   *  and whether a filename was present, never the filename or file content itself. */
  recordInputDocument(meta: { mimeType: string; byteSize: number; hasFilename: boolean }): void;
  recordUsage(usage: {
    input_tokens?: number;
    cache_creation?: object | null;
    cache_read_input_tokens?: number;
    output_tokens?: number;
    list_cost?: { amount: string; currency: string } | null;
  }): void;
  summary(): DjonikTurnTelemetry;
  cumulativeUsage(): DjonikCumulativeUsage | null;
}

/** Aggregates event metadata only; it never accepts message, Memory, or MCP-result content. */
export function createTurnTelemetryCollector(
  source: DjonikTurnSource,
  sessionId: string,
  previousUsage: DjonikCumulativeUsage | null = null,
  now: () => string = () => new Date().toISOString(),
): DjonikTurnTelemetryCollector {
  let modelIterations = 0;
  const toolNames: string[] = [];
  let mcpResults = 0;
  let verificationNudges = 0;
  let skillRead = false;
  let memoryRead = false;
  let hasImage = false;
  let imageMimeType: string | null = null;
  let imageByteSize: number | null = null;
  let hasFile = false;
  let fileMimeType: string | null = null;
  let fileByteSize: number | null = null;
  let fileNamePresent: boolean | null = null;
  let cumulativeUsage: DjonikCumulativeUsage | null = null;

  function delta(current: number | undefined, previous: number | undefined): number | undefined {
    if (current === undefined) return undefined;
    const result = current - (previous ?? 0);
    return result >= 0 ? result : undefined;
  }

  function listCostDelta(): Pick<DjonikCumulativeUsage, "listCostAmount" | "listCostCurrency"> {
    if (!cumulativeUsage?.listCostAmount || !cumulativeUsage.listCostCurrency) return {};
    if (
      previousUsage?.listCostCurrency !== undefined &&
      previousUsage.listCostCurrency !== cumulativeUsage.listCostCurrency
    ) return {};
    try {
      const result = BigInt(cumulativeUsage.listCostAmount) - BigInt(previousUsage?.listCostAmount ?? "0");
      return result >= 0n
        ? { listCostAmount: result.toString(), listCostCurrency: cumulativeUsage.listCostCurrency }
        : {};
    } catch {
      return {};
    }
  }

  function turnUsage(): DjonikCumulativeUsage | null {
    if (cumulativeUsage === null) return null;
    return {
      inputTokens: delta(cumulativeUsage.inputTokens, previousUsage?.inputTokens),
      cacheCreationInputTokens: delta(
        cumulativeUsage.cacheCreationInputTokens,
        previousUsage?.cacheCreationInputTokens,
      ),
      cacheReadInputTokens: delta(cumulativeUsage.cacheReadInputTokens, previousUsage?.cacheReadInputTokens),
      outputTokens: delta(cumulativeUsage.outputTokens, previousUsage?.outputTokens),
      ...listCostDelta(),
    };
  }

  return {
    recordModelIteration: () => { modelIterations += 1; },
    recordMcpToolUse: (toolName) => { toolNames.push(toolName); },
    recordMcpResult: () => { mcpResults += 1; },
    recordBuiltInRead: (input) => {
      const path = typeof input.file_path === "string" ? input.file_path : "";
      skillRead ||= /(?:^|\/)skills\//.test(path);
      memoryRead ||= /(?:^|\/)memory\//.test(path);
    },
    recordVerificationNudge: () => { verificationNudges += 1; },
    recordInputImage: (meta) => {
      hasImage = true;
      imageMimeType = meta.mimeType;
      imageByteSize = meta.byteSize;
    },
    recordInputDocument: (meta) => {
      hasFile = true;
      fileMimeType = meta.mimeType;
      fileByteSize = meta.byteSize;
      fileNamePresent = meta.hasFilename;
    },
    recordUsage: (nextUsage) => {
      const cacheCreationInputTokens = Object.values(nextUsage.cache_creation ?? {}).reduce(
        (sum, value) => sum + (typeof value === "number" ? value : 0),
        0,
      );
      cumulativeUsage = {
        inputTokens: nextUsage.input_tokens,
        cacheCreationInputTokens,
        cacheReadInputTokens: nextUsage.cache_read_input_tokens,
        outputTokens: nextUsage.output_tokens,
        listCostAmount: nextUsage.list_cost?.amount,
        listCostCurrency: nextUsage.list_cost?.currency,
      };
    },
    summary: () => ({
      recordedAt: now(),
      source,
      sessionId,
      usageScope: "turn_delta",
      modelIterations,
      toolCalls: toolNames.length,
      toolNames: [...toolNames],
      mcpResults,
      verificationNudges,
      skillRead,
      memoryRead,
      hasImage,
      imageMimeType,
      imageByteSize,
      hasFile,
      fileMimeType,
      fileByteSize,
      fileNamePresent,
      usage: turnUsage(),
    }),
    cumulativeUsage: () => cumulativeUsage === null ? null : { ...cumulativeUsage },
  };
}

/**
 * Thrown when the underlying Managed Session/event stream itself has died
 * (stream ended, session terminated, or a terminal session.error) rather than
 * an ordinary turn-level failure (e.g. unverified write, empty reply) where
 * the session is still usable for the next message. Callers that cache a
 * session (e.g. the Telegram adapter's one-session-per-process manager) can
 * use this to know the cached session must be discarded and reconnected,
 * without discarding it on every turn failure.
 */
export class DjonikSessionDeadError extends Error {}

/**
 * Optional observability hook for validation/debugging (e.g. Foundation 8 live
 * scenario traces). Purely informational — never consulted for verification
 * logic, which stays entirely in the event-stream handling below.
 */
export type DjonikTraceEvent =
  | { type: "mcp_tool_use"; serverName: string; toolName: string; input: Record<string, unknown> }
  | { type: "mcp_tool_result"; serverName: string; toolName: string; isError: boolean }
  | { type: "verification_nudge_sent"; attempt: number }
  | { type: "write_unverified_failure" }
  | { type: "due_date_reply_finalized"; verifiedDue: string; kyivDate: string; weekdayEn: string; mismatch: boolean };

/**
 * Session-specific guidance shown to the agent alongside the memory store's
 * name/description (see the store's own `description` for what it is).
 * Memory stores attach only at session creation time, so this text travels
 * with every new Djonik session rather than living in agent configuration.
 */
const DJONIK_MEMORY_INSTRUCTIONS =
  "Persistent PM memory across sessions. Write only durable, useful context: " +
  "stable work preferences, client/project facts, important decisions, recurring " +
  "patterns, PM lessons, plans the user has explicitly accepted (e.g. \"так, працюємо " +
  "за цим планом\"), and explicit personal/client commitments the user states (e.g. " +
  "\"я точно зроблю X до пʼятниці\"). Do not write every suggestion or provisional plan " +
  "as if it were accepted — only write an accepted plan or commitment when the user's " +
  "acceptance/commitment is actually explicit, not merely discussed. Do not store live " +
  "Trello/task state, transient chat, or anything trivial. An accepted plan or " +
  "commitment recorded here is historical/decision context, not live task state: fresh " +
  "external tool reads always outrank what is remembered here for current status. When " +
  "the user corrects or cancels an earlier accepted plan/commitment, update what is " +
  "remembered so the new version is current and the superseded one is no longer " +
  "presented as still active.";

/**
 * Deterministic backstop for the task-management Skill's verify-before-claiming-success
 * rule. The Skill asks Djonik to re-read a Trello object after every mutation before
 * replying, but a real Telegram turn proved instruction-following alone is not
 * reliable (Foundation 7 acceptance blocker: a `trelloWriteCard` call was followed by
 * a success reply with no `agent.mcp_tool_use` read call in between).
 *
 * This inspects the same `agent.mcp_tool_use` / `agent.mcp_tool_result` events the
 * session stream already emits — no custom Trello client, no stored task state, no
 * intent router. It only tracks tool-call *shape*: which write tool ran, the object id
 * it names, and whether a read of the matching type later names that same object id.
 * It never inspects mutated field values (title/desc/due/list) — whether the *content*
 * of a write was correct remains entirely the Skill's/Claude's job. This is identity
 * verification only: did a read of the same object happen, not was the write right.
 */
const TRELLO_MCP_SERVER_PATTERN = /trello/i;
const TRELLO_WRITE_TOOL_PATTERN = /^trelloWrite/;
const TRELLO_READ_TOOL_PATTERN = /^trelloRead/;

function isTrelloWriteTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_WRITE_TOOL_PATTERN.test(toolName);
}

function isTrelloReadTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_READ_TOOL_PATTERN.test(toolName);
}

/**
 * For each Trello write tool whose input names an object id, the read tool + input
 * field that must name the *same* id to count as verification. A write tool absent
 * from this map (none currently — only `trelloWriteCard` is enabled per Foundation 7)
 * falls back to the looser "any successful Trello read clears it" behavior, since no
 * identity field is known to check.
 */
const CARD_OBJECT_ID_VERIFICATION = {
  writeTool: "trelloWriteCard",
  writeIdField: "cardId",
  readTool: "trelloReadCard",
  readIdFields: ["cardIdOrUrl", "cardId"],
} as const;

function readStringField(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The object id a write tool call names, or null if this write tool has no known identity field. */
function writeObjectId(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === CARD_OBJECT_ID_VERIFICATION.writeTool) {
    return readStringField(input, CARD_OBJECT_ID_VERIFICATION.writeIdField);
  }
  return null;
}

/**
 * Whether a successful read call verifies the given pending write: same write/read
 * tool pairing (e.g. trelloWriteCard verified only by trelloReadCard, never by
 * trelloReadBoard/trelloSearch/etc.) and the read names the exact same object id.
 */
function readVerifiesWrite(
  pendingWriteTool: string,
  pendingObjectId: string,
  readToolName: string,
  readInput: Record<string, unknown>,
): boolean {
  if (pendingWriteTool !== CARD_OBJECT_ID_VERIFICATION.writeTool) return false;
  if (readToolName !== CARD_OBJECT_ID_VERIFICATION.readTool) return false;
  return CARD_OBJECT_ID_VERIFICATION.readIdFields.some(
    (field) => readStringField(readInput, field) === pendingObjectId,
  );
}

/**
 * Deterministic backstop for Issue #23 (post-write due-date wording must match the
 * verified Trello field). Prompt/Skill-level guidance was tried twice and failed
 * twice on the same reproducible case: given a verified UTC `due` whose Kyiv-local
 * calendar date differs from its UTC calendar date, the model correctly converts
 * the date but states the *UTC* date's weekday instead of the *Kyiv-local* date's
 * weekday. This is narrowly scoped to exactly that one fact: Trello due-date write
 * -> same-card verified read -> exact post-write due-date confirmation. It never
 * rewrites general assistant text, never parses arbitrary prose, and never touches
 * any other field or turn shape.
 */
const ISO_UTC_DUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Bounded (depth-limited) structured lookup for a `due` field in a Trello MCP tool
 *  result's parsed JSON — not a generic object walker, only ever looking for this
 *  one key, and only trusting a value shaped like a Trello UTC due timestamp. */
function findDueField(value: unknown, depth: number): string | null {
  if (depth < 0 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDueField(item, depth - 1);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.due === "string" && ISO_UTC_DUE_PATTERN.test(obj.due)) return obj.due;
  for (const key of Object.keys(obj)) {
    const found = findDueField(obj[key], depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts the verified `due` value from a `trelloReadCard` MCP tool result's
 * content blocks. Only text blocks are inspected; the text is first tried as JSON
 * (the expected shape), then, if that fails, scanned with a narrow `"due":"..."`
 * regex as a tolerant fallback. Returns null (never throws) when no due-shaped
 * value can be found, so the deterministic safeguard cleanly no-ops rather than
 * fabricating a value or crashing the turn.
 */
export function extractVerifiedDueFromTrelloReadContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string | null {
  if (!content) return null;
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    try {
      const parsed = findDueField(JSON.parse(block.text), 3);
      if (parsed) return parsed;
    } catch {
      // fall through to the regex fallback below
    }
    const match = block.text.match(/"due"\s*:\s*"([^"]+)"/);
    if (match && ISO_UTC_DUE_PATTERN.test(match[1])) return match[1];
  }
  return null;
}

/** Verified Trello `due`, deterministically converted to Europe/Kyiv using the
 *  platform's own IANA timezone database (via `Intl`) — never a hardcoded
 *  UTC+2/+3 offset, so this stays correct across the DST transition. */
export interface VerifiedDueFacts {
  /** The raw verified UTC value, unchanged, for display/traceability. */
  isoUtc: string;
  /** Kyiv-local calendar date, `YYYY-MM-DD`. */
  kyivDate: string;
  /** Kyiv-local time, `HH:MM` (24h). */
  kyivTime: string;
  /** English weekday name for the Kyiv-local calendar date, e.g. "Tuesday". */
  weekdayEn: string;
  /** Ukrainian nominative weekday name for the Kyiv-local calendar date, e.g. "вівторок". */
  weekdayUk: string;
  /** 1-indexed day of month (Kyiv-local). */
  day: number;
  /** 1-indexed month (Kyiv-local). */
  month: number;
  /** Full year (Kyiv-local). */
  year: number;
}

const EN_TO_UA_WEEKDAY: Record<string, string> = {
  Sunday: "неділя",
  Monday: "понеділок",
  Tuesday: "вівторок",
  Wednesday: "середа",
  Thursday: "четвер",
  Friday: "пʼятниця",
  Saturday: "субота",
};

const UA_MONTH_GENITIVE = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
] as const;

export function computeKyivDueFacts(isoUtc: string): VerifiedDueFacts | null {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = part("year");
  const month = part("month");
  const day = part("day");
  let hour = part("hour");
  const minute = part("minute");
  if (hour === "24") hour = "00"; // some ICU builds emit "24" for midnight under hour12:false
  const weekdayEn = part("weekday");
  if (!year || !month || !day || !weekdayEn) return null;

  return {
    isoUtc,
    kyivDate: `${year}-${month}-${day}`,
    kyivTime: `${hour}:${minute}`,
    weekdayEn,
    weekdayUk: EN_TO_UA_WEEKDAY[weekdayEn] ?? weekdayEn,
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

/**
 * A due-bearing Trello write whose SAME card was verified by a `trelloReadCard`
 * whose result yielded a parseable `due`. `intendedDue` is the write's own `due`
 * argument, kept only for this one same-turn comparison — never stored beyond
 * the turn, never trusted as the answer itself.
 */
export interface DueWriteOutcome {
  intendedDue: string;
  verifiedFacts: VerifiedDueFacts;
}

/**
 * Canonical, fully deterministic due-date confirmation sentence — every field
 * (date, time, weekday) comes from the same `Intl`-formatted Kyiv-local instant,
 * so they cannot disagree with each other by construction. Does not depend on,
 * or even look at, anything the model said.
 */
export function buildVerifiedDueConfirmation(outcome: DueWriteOutcome): string {
  const f = outcome.verifiedFacts;
  const kyivPhrase = `${f.weekdayUk}, ${f.day} ${UA_MONTH_GENITIVE[f.month - 1]} ${f.year}, ${f.kyivTime} за Києвом`;
  const intendedMs = new Date(outcome.intendedDue).getTime();
  const verifiedMs = new Date(f.isoUtc).getTime();
  const sameInstant = !Number.isNaN(intendedMs) && intendedMs === verifiedMs;
  return sameInstant
    ? `Готово. Trello підтвердив дедлайн: ${kyivPhrase}.`
    : `Картку оновлено, але Trello підтвердив дедлайн: ${kyivPhrase}. Це відрізняється від значення, яке було відправлено.`;
}

/**
 * Issue #23's actual guarantee: for a turn whose due-date write was verified
 * (identity + a parseable same-card `due`), the wrapper — not the model — owns
 * the whole final due-date confirmation, replacing the model's reply outright
 * rather than trying to detect and patch just the wrong part of its prose. This
 * is deliberately the "cleaner and safer" option: no parsing of arbitrary
 * assistant text is needed for correctness, so a wrong weekday, a wrong
 * calendar date, a wrong time, or entirely different wording all fail the same
 * (harmless) way — they're simply never consulted. When `outcome` is null (no
 * due-date write this turn, or the write's due value never changed), the reply
 * is returned completely untouched.
 */
export function finalizeDueDateReply(reply: string, outcome: DueWriteOutcome | null): string {
  return outcome ? buildVerifiedDueConfirmation(outcome) : reply;
}

/** Trace payload for a finalized due-date reply, or null when no due-date write
 *  was finalized this turn. Takes `outcome` as a plain parameter (rather than
 *  reading a closed-over mutable variable) so its type narrows normally. */
export function describeDueOutcomeForTrace(
  outcome: DueWriteOutcome | null,
): { verifiedDue: string; kyivDate: string; weekdayEn: string; mismatch: boolean } | null {
  if (!outcome) return null;
  return {
    verifiedDue: outcome.verifiedFacts.isoUtc,
    kyivDate: outcome.verifiedFacts.kyivDate,
    weekdayEn: outcome.verifiedFacts.weekdayEn,
    mismatch: new Date(outcome.intendedDue).getTime() !== new Date(outcome.verifiedFacts.isoUtc).getTime(),
  };
}

const VERIFICATION_NUDGE_TEXT =
  "Системна перевірка: у цьому turn був виклик Trello write-інструменту без " +
  "наступного read-виклику САМЕ ТОГО Ж об'єкта (той самий cardId), що підтверджує " +
  "результат. Перш ніж відповідати користувачу, зроби окремий Trello read саме того " +
  "об'єкта, який ти щойно змінив, і повідом користувачу підтверджений результат (або " +
  "скажи чесно, якщо перевірка показала розбіжність).";

const MAX_VERIFICATION_NUDGES = 1;

type SendableContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string }; title?: string };

type SendableEvent = { type: "user.message"; content: SendableContentBlock[] };

/**
 * Connects to the already-existing Djonik Managed Agent (Claude Console is
 * the authoritative runtime/configuration for the agent itself) by starting
 * one Managed Agent Session against `agentId` + `environmentId`, then opens
 * that session's event stream once. `send()` reuses the same session/stream
 * for every turn, so conversational continuity is the official Managed
 * Agents Session primitive — this client never builds or replays its own
 * message history.
 *
 * The Djonik Memory Store is attached as a `memory_store` session resource
 * with `read_write` access, since memory stores can only be attached at
 * session creation time (not added to a running session).
 *
 * The Djonik Personal Vault is passed via `vault_ids` so the session's
 * attached MCP servers (Trello, Google Calendar) can authenticate; without
 * it every new session emits `mcp_authentication_failed_error` events for
 * those servers.
 */
export async function connectToDjonik(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  memoryStoreId: string,
  vaultId: string,
  onTrace?: (event: DjonikTraceEvent) => void,
  onTurnTelemetry?: (telemetry: DjonikTurnTelemetry) => void,
  turnSource: DjonikTurnSource = "unknown",
): Promise<DjonikSessionHandle> {
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    vault_ids: [vaultId],
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: "read_write",
        instructions: DJONIK_MEMORY_INSTRUCTIONS,
      },
    ],
  });

  const stream = await client.beta.sessions.events.stream(session.id);
  const iterator = stream[Symbol.asyncIterator]();

  /**
   * Correlates `agent.mcp_tool_result` events back to the tool call that produced
   * them (results only carry `mcp_tool_use_id`, not the tool name/server/input).
   * Scoped to one `send()` call — cleared at the start of each.
   */
  const mcpToolCallsById = new Map<string, { serverName: string; toolName: string; input: Record<string, unknown> }>();
  /** True from a successful Trello write until a verifying read of the same object is observed. */
  let unverifiedTrelloWrite = false;
  /** Which write tool is pending verification, so a read can be checked against the right pairing. */
  let pendingWriteTool: string | null = null;
  /** The object id the pending write named, or null when this write tool has no known identity field
   *  (falls back to "any successful Trello read clears it"). */
  let pendingWriteObjectId: string | null = null;
  /** The `due` value the pending write's own input named, if any — never trusted as
   *  the final answer, only used to know a due-date claim needs deterministic backup. */
  let pendingWriteDue: string | null = null;
  /** Set once this turn's pending due-date write is verified by a same-card read whose
   *  result contains a parseable `due` — at that point the wrapper, not the model,
   *  owns the turn's final due-date confirmation wording (Issue #23). */
  let dueOutcomeForTurn: DueWriteOutcome | null = null;
  let turnTelemetry: DjonikTurnTelemetryCollector | null = null;
  /** Session usage events are cumulative; this is the completed-turn baseline. */
  let previousSessionUsage: DjonikCumulativeUsage | null = null;

  async function runTurn(events: SendableEvent[]): Promise<string> {
    await client.beta.sessions.events.send(session.id, { events });

    let reply = "";

    for (;;) {
      const { value: event, done } = await iterator.next();
      if (done) {
        throw new DjonikSessionDeadError("Djonik session event stream ended unexpectedly.");
      }

      switch (event.type) {
        case "agent.message":
          reply = event.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("");
          break;
        case "agent.mcp_tool_use":
          mcpToolCallsById.set(event.id, {
            serverName: event.mcp_server_name,
            toolName: event.name,
            input: event.input as Record<string, unknown>,
          });
          onTrace?.({
            type: "mcp_tool_use",
            serverName: event.mcp_server_name,
            toolName: event.name,
            input: event.input as Record<string, unknown>,
          });
          turnTelemetry?.recordMcpToolUse(event.name);
          break;
        case "agent.mcp_tool_result": {
          const call = mcpToolCallsById.get(event.mcp_tool_use_id);
          if (call) {
            onTrace?.({
              type: "mcp_tool_result",
              serverName: call.serverName,
              toolName: call.toolName,
              isError: Boolean(event.is_error),
            });
            turnTelemetry?.recordMcpResult();
          }
          if (call && !event.is_error) {
            if (isTrelloWriteTool(call.serverName, call.toolName)) {
              unverifiedTrelloWrite = true;
              pendingWriteTool = call.toolName;
              pendingWriteObjectId = writeObjectId(call.toolName, call.input);
              pendingWriteDue = readStringField(call.input, "due");
            } else if (isTrelloReadTool(call.serverName, call.toolName) && unverifiedTrelloWrite) {
              // Identity known: only a read of the exact same object verifies it. An
              // unrelated or mismatched-id read leaves the write unverified. No identity
              // field known for this write tool type (e.g. a card create, before an id
              // exists): fall back to the looser "any successful Trello read clears it".
              const identityVerified =
                pendingWriteObjectId !== null
                  ? pendingWriteTool !== null &&
                    readVerifiesWrite(pendingWriteTool, pendingWriteObjectId, call.toolName, call.input)
                  : true;

              if (identityVerified && pendingWriteDue === null) {
                // Ordinary write with no due-date change: identity verification alone
                // is sufficient, exactly as before Issue #23.
                unverifiedTrelloWrite = false;
                pendingWriteTool = null;
                pendingWriteObjectId = null;
              } else if (identityVerified && pendingWriteDue !== null) {
                // Issue #23: a due-bearing write additionally requires a parseable
                // verified `due` from THIS SAME read before the write counts as
                // verified at all — never the write's own input, never memory, never
                // an earlier turn. If extraction fails, deliberately leave the write
                // state untouched (still unverified) so the existing corrective-nudge
                // / fail-closed mechanism below applies to due-date writes exactly as
                // it already does to identity — no fabricated exact due confirmation
                // is ever produced from an unconfirmable read.
                const verifiedDue = extractVerifiedDueFromTrelloReadContent(event.content);
                const verifiedFacts = verifiedDue !== null ? computeKyivDueFacts(verifiedDue) : null;
                if (verifiedDue !== null && verifiedFacts !== null) {
                  dueOutcomeForTurn = { intendedDue: pendingWriteDue, verifiedFacts };
                  unverifiedTrelloWrite = false;
                  pendingWriteTool = null;
                  pendingWriteObjectId = null;
                  pendingWriteDue = null;
                }
              }
            }
          }
          break;
        }
        case "agent.tool_use":
          if (event.name === "read") {
            turnTelemetry?.recordBuiltInRead(event.input as Record<string, unknown>);
          }
          break;
        case "span.model_request_end":
          turnTelemetry?.recordModelIteration();
          break;
        case "session.usage":
          turnTelemetry?.recordUsage(event.usage);
          break;
        case "session.error":
          // "retrying" and "exhausted" are non-terminal per the Managed
          // Agents API: the session keeps running (or returns to idle to
          // accept a new prompt). Only "terminal" means the session itself
          // is dying. A turn that ends via "exhausted" with no assistant
          // message is still caught below by the empty-reply check on
          // session.status_idle.
          if (event.error.retry_status.type === "terminal") {
            throw new DjonikSessionDeadError(`Djonik session error: ${event.error.message}`);
          }
          break;
        case "session.status_terminated":
          throw new DjonikSessionDeadError("Djonik session terminated unexpectedly.");
        case "session.status_idle":
          if (!reply) {
            throw new Error("Djonik produced no text reply for this turn.");
          }
          return reply;
        default:
          break;
      }
    }
  }

  /**
   * Sends one user turn, then enforces verify-after-write deterministically:
   * if the turn ends with a successful Trello write and no successful Trello
   * read afterward, the reply is a false-success candidate. Rather than trust
   * the Skill's instruction-following alone (the Foundation 7 acceptance
   * blocker), nudge the agent once to verify and reply again in the same
   * session; if it still hasn't verified, fail the turn instead of returning
   * an unverified success claim to the user.
   *
   * `image`/`document`, when present, are sent as inline base64 `image`/`document`
   * content blocks alongside `text` in the same `user.message` event (see
   * `DjonikImageInput`/`DjonikDocumentInput`). Both are untrusted source data like
   * any other external content — they carry no special instruction/tool authority;
   * that boundary lives in the Managed Agent's own configuration, not in this
   * transport code.
   */
  async function send(text: string, image?: DjonikImageInput, document?: DjonikDocumentInput): Promise<string> {
    unverifiedTrelloWrite = false;
    pendingWriteTool = null;
    pendingWriteObjectId = null;
    pendingWriteDue = null;
    dueOutcomeForTurn = null;
    mcpToolCallsById.clear();
    turnTelemetry = createTurnTelemetryCollector(turnSource, session.id, previousSessionUsage);
    if (image) {
      turnTelemetry.recordInputImage({ mimeType: image.mediaType, byteSize: image.byteSize });
    }
    if (document) {
      turnTelemetry.recordInputDocument({
        mimeType: document.mediaType,
        byteSize: document.byteSize,
        hasFilename: Boolean(document.filename),
      });
    }

    const content: SendableContentBlock[] = [];
    if (image) {
      content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
    }
    if (document) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: document.mediaType, data: document.data },
        ...(document.filename ? { title: document.filename } : {}),
      });
    }
    if (text) {
      content.push({ type: "text", text });
    }
    if (content.length === 0) {
      throw new Error("Djonik turn requires non-empty text and/or an attachment.");
    }

    try {
      let reply = await runTurn([{ type: "user.message", content }]);

      for (let attempt = 0; unverifiedTrelloWrite && attempt < MAX_VERIFICATION_NUDGES; attempt += 1) {
        onTrace?.({ type: "verification_nudge_sent", attempt: attempt + 1 });
        turnTelemetry.recordVerificationNudge();
        reply = await runTurn([{ type: "user.message", content: [{ type: "text", text: VERIFICATION_NUDGE_TEXT }] }]);
      }

      if (unverifiedTrelloWrite) {
        onTrace?.({ type: "write_unverified_failure" });
        throw new Error(
          "Djonik mutated Trello but did not verify the write with an independent read in this turn.",
        );
      }

      // Issue #23: prompt/Skill guidance alone was tried twice and failed twice on the
      // same reproducible case, including a weekday-only contradiction check that a
      // wrong-date-but-right-weekday reply would slip past. For a verified due-date
      // write, the wrapper now owns the entire final due-date confirmation
      // deterministically instead of trusting or patching the model's wording.
      const dueTrace = describeDueOutcomeForTrace(dueOutcomeForTurn);
      if (dueTrace) onTrace?.({ type: "due_date_reply_finalized", ...dueTrace });
      reply = finalizeDueDateReply(reply, dueOutcomeForTurn);

      return reply;
    } finally {
      const completedTelemetry = turnTelemetry.summary();
      previousSessionUsage = turnTelemetry.cumulativeUsage();
      onTurnTelemetry?.(completedTelemetry);
      turnTelemetry = null;
    }
  }

  function close(): void {
    stream.controller.abort();
  }

  return { sessionId: session.id, send, close };
}
