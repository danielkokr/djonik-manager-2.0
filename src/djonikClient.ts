import Anthropic from "@anthropic-ai/sdk";
import {
  TrelloMutationLedger,
  describeMutationOutcomes,
  describeMutationTarget,
  extractCardObject,
  isConfirmed,
  isFailed,
  isNudgeable,
  isUnresolved,
  isValidUtcDue,
  nudgeTargetIds,
  type MutationOutcome,
} from "./trelloMutationLedger.js";
import {
  DjonikSpecialistUnverifiedError,
  DjonikTurnIncompleteError,
  SpecialistTurnProvenance,
  classifyStopReason,
  composeWithSpecialist,
  specialistBlockForError,
  specialistUnverifiedNotice,
  type IncompleteStopKind,
  type SpecialistCompositionMode,
  type SpecialistUnverifiedReason,
} from "./turnCorrelation.js";
import { executeTrelloWorkHistoryFromEnvironment, type CustomToolExecutionResult } from "./trelloWorkHistory.js";

export { DjonikSpecialistUnverifiedError, DjonikTurnIncompleteError } from "./turnCorrelation.js";

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

/**
 * One text/image/document part of a turn, in the exact order it should
 * appear as a `user.message` content block (#27). This is the single
 * ordered representation `sendOrdered` builds content from; `send`'s
 * legacy `(text, image, document)` shape is converted into this same
 * representation internally rather than having its own parallel transport.
 */
export type DjonikTurnPart =
  | { type: "text"; text: string }
  | { type: "image"; image: DjonikImageInput }
  | { type: "document"; document: DjonikDocumentInput };

export interface DjonikSessionHandle {
  sessionId: string;
  /**
   * Sends one visible user turn. `text` may be empty when `image` and/or
   * `document` is present (e.g. a Telegram file with no caption); at least
   * one of the three must be non-empty. `image`/`document` each accept
   * either a single attachment (the #22/#24 shape, unchanged) or an array —
   * the bounded generalization #25 needed to send a Telegram album or a
   * multi-attachment grouped intake as one native `user.message` event
   * (multiple `image`/`document` content blocks are an already-accepted
   * provider shape; this is not a new transport). Order within each array
   * is preserved as the block order.
   *
   * The resulting content-block order is fixed: every image, then every
   * document, then the text block (if any) — the historical #22/#24/#25
   * order, unchanged. For a turn that needs a different, source-faithful
   * interleaving of text/image/document (e.g. text → image → correcting
   * text), use `sendOrdered` instead.
   */
  send(
    text: string,
    image?: DjonikImageInput | DjonikImageInput[],
    document?: DjonikDocumentInput | DjonikDocumentInput[],
  ): Promise<string>;
  /**
   * Sends one visible user turn whose `user.message` content blocks are
   * built in exactly `parts`' order (#27) — the mechanism a rich, ordered
   * Telegram intake (grouped text/image/document fragments, a caption next
   * to its own image, a later correction after a screenshot) needs to reach
   * the Managed Agent with its original cross-modal order and caption
   * association intact, instead of being flattened into separate
   * images/documents/text groups. Shares the same content-block builder,
   * write-verification, due-date finalization, and telemetry pipeline as
   * `send` — this is not a second transport.
   */
  sendOrdered(parts: DjonikTurnPart[]): Promise<string>;
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
  /** Total content blocks sent this turn (text + image + document). Bounded count only,
   *  never the blocks' content (#27). */
  sourceBlockCount: number;
  /** Text content blocks sent this turn. Bounded count only (#27). */
  textBlockCount: number;
  /** Image content blocks sent this turn. Bounded count only (#27). */
  imageBlockCount: number;
  /** Document content blocks sent this turn. Bounded count only (#27). */
  documentBlockCount: number;
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
  /** Records bounded per-type content-block counts for this turn (#27) — counts only, never block content. */
  recordContentBlockCounts(counts: { textBlockCount: number; imageBlockCount: number; documentBlockCount: number }): void;
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
  let textBlockCount = 0;
  let imageBlockCount = 0;
  let documentBlockCount = 0;
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
    recordContentBlockCounts: (counts) => {
      textBlockCount = counts.textBlockCount;
      imageBlockCount = counts.imageBlockCount;
      documentBlockCount = counts.documentBlockCount;
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
      sourceBlockCount: textBlockCount + imageBlockCount + documentBlockCount,
      textBlockCount,
      imageBlockCount,
      documentBlockCount,
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
  /** Content-free #36 audit marker: the only supported client-side custom tool was requested/resolved. */
  | { type: "custom_tool_result_sent"; toolName: "trello_work_history"; isError: boolean }
  | { type: "verification_nudge_sent"; attempt: number }
  | { type: "write_unverified_failure" }
  | { type: "due_date_reply_finalized"; verifiedDue: string; kyivDate: string; weekdayEn: string; mismatch: boolean }
  /** Content-free (#28, composition contract since #32): a VERIFIED Project Health specialist result
   *  was preserved in the turn's reply. `mode` says how it met the rest of the reply. */
  | { type: "specialist_reply_composed"; mode: SpecialistCompositionMode }
  /** Content-free (#32): the turn saw a specialist result it could not call verified, so nothing
   *  was substituted and the coordinator's reply stayed authoritative. */
  | { type: "specialist_result_unverified"; reason: SpecialistUnverifiedReason }
  /** Content-free (#32): the turn ended without an authoritative `end_turn`; nothing was resumed/replayed. */
  | { type: "turn_incomplete"; stopKind: IncompleteStopKind }
  /** Content-free (#32): events that provably (or, without an anchor, conservatively) belonged to an
   *  earlier turn were ignored. `preAnchorEvents` predate this turn's own `user.message` echo;
   *  `lateSpecialistResults` are canonical specialist results with no in-turn engagement. */
  | { type: "late_events_quarantined"; preAnchorEvents: number; lateSpecialistResults: number };

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
 * Issue #31: verification is per mutation. Every `trelloWriteCard` call is tracked by its own
 * tool-use identity in a `TrelloMutationLedger` (`src/trelloMutationLedger.ts`) and is verified
 * only by a successful direct `trelloReadCard` of ITS OWN card, started after the write, whose
 * card object carries the fields the write requested. Same event stream, no custom Trello client,
 * no stored task state, no intent router.
 */

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
/**
 * Extracts the verified `due` value from a `trelloReadCard` MCP tool result's content blocks.
 *
 * Issue #31: anchored to the ONE card object the result describes (its own `id`; a bare card or a
 * single-key `{ card }` wrapper). Only that object's own `due` is ever considered — never a
 * nested `board`/`list`/other object, never an array element, never a regex scan of raw text —
 * so a card with `due: null` yields null even when an unrelated nested object carries a `due`.
 * Returns null (never throws) for any missing/ambiguous/unparseable result so the safeguard
 * cleanly no-ops rather than fabricating a value.
 */
export function extractVerifiedDueFromTrelloReadContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string | null {
  const card = extractCardObject(content);
  return card !== null && isValidUtcDue(card.due) ? card.due : null;
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

/**
 * Issue #28 deterministic relay boundary for the read-only Project Health path, reshaped by #32.
 *
 * Measured, not assumed: three live production-style smokes showed prompt-only control cannot make
 * the Haiku coordinator relay the specialist's answer exactly (§42 happened to pass, §44 dropped a
 * paragraph, §46 rewrote a clean specialist answer wholesale). The specialist's own result is the
 * accepted PM answer, so once Claude has natively delegated and the canonical specialist replied,
 * this transport boundary — not the coordinator model — guarantees that exact string reaches the
 * caller.
 *
 * #32 kept that authority and made its limits explicit. Nothing in the official event surface links a
 * coordinator `agent.message` to the child result it may derive from, so the transport cannot tell a
 * coordinator REWRITE of the specialist (the #28 failure) from independently requested coordinator
 * output. Rather than guess with an intent/prose parser, a VERIFIED specialist result stays the
 * authoritative Project Health answer, byte for byte; any other coordinator text is withheld behind a
 * visible notice (`composeWithSpecialist`, `src/turnCorrelation.ts`). And when a canonical delegation
 * was engaged but its result cannot be established (missing, duplicate, several threads, stray,
 * non-text, stopped child) the turn fails visibly (`DjonikSpecialistUnverifiedError`) instead of
 * falling back to coordinator Project Health prose.
 *
 * This is NOT an intent router. It never reads user text, never decides whether Project Health
 * should be delegated (Claude does that natively), and never parses or interprets prose. It acts
 * only on official Session/event provenance: the resolved Session's coordinator roster (which
 * identifies the canonical specialist independently of unrelated entries) plus the thread events
 * `SpecialistTurnProvenance` correlates to the CURRENT turn.
 */
export const PROJECT_HEALTH_SPECIALIST_AGENT_ID = "agent_01KNiQDzzPjaMU6LLF4mU6uM";

/**
 * The callable-agent name (as it appears in thread events) of the canonical Project Health
 * specialist, or null when the resolved Session does not prove it unambiguously.
 *
 * Independent of unrelated roster entries (#32/R7): the coordinator roster may carry other agents,
 * and a future/unrelated entry must not disable the protection. What is required is exactly ONE
 * plain-agent entry (not an Advisor) with the canonical specialist id and a non-empty name that no
 * OTHER entry shares — a duplicate canonical id, or another entry answering to the same callable
 * name, would make thread events ambiguous and fails closed. Structurally typed and lenient so a
 * Session without a roster (e.g. an older production version) simply disables the safeguard.
 */
export function resolveProjectHealthSpecialistName(agent: unknown): string | null {
  const multiagent = (agent as { multiagent?: { type?: string; agents?: unknown } | null } | null | undefined)?.multiagent;
  if (!multiagent || multiagent.type !== "coordinator" || !Array.isArray(multiagent.agents)) return null;
  const entries = multiagent.agents as Array<{ type?: string; id?: string; name?: string } | null>;
  const canonical = entries.filter((entry) => entry?.type === "agent" && entry.id === PROJECT_HEALTH_SPECIALIST_AGENT_ID);
  if (canonical.length !== 1) return null;
  const name = canonical[0]?.name;
  if (typeof name !== "string" || name.length === 0) return null;
  const sameName = entries.filter((entry) => entry?.name === name);
  return sameName.length === 1 ? name : null;
}

/**
 * The single bounded corrective nudge (#8, kept by #31). It asks for direct reads only — never a
 * replay of the write — and names the exact cards whose mutations are still unverified.
 */
export function buildVerificationNudgeText(cardIds: string[]): string {
  return (
    "Системна перевірка: у цьому turn є Trello-запис(и), які ще не підтверджені прямим " +
    "читанням САМЕ ТІЄЇ картки, яку вони змінили, після запису (trelloReadCard, action get). " +
    "НЕ повторюй запис і не створюй нову картку. Перш ніж відповідати користувачу, зроби окремий " +
    "trelloReadCard для кожної з цих карток: " +
    cardIds.join(", ") +
    ". Потім повідом лише підтверджений результат кожної зміни (або чесно скажи, якщо " +
    "перевірка показала розбіжність)."
  );
}

/**
 * Thrown when a turn attempted Trello mutations and at least one is still unverified after the one
 * bounded corrective nudge (#31). The message is deterministic, user-safe and honest about each
 * mutation (what Trello confirmed, what it did not) — it is derived from tool events, never from
 * model prose. `modelReply` is the model's own, UNVETTED final text: it may claim success for an
 * unverified mutation, so callers must not show it as an outcome.
 */
export class DjonikUnverifiedMutationError extends Error {
  readonly outcomes: MutationOutcome[];
  readonly modelReply: string;

  /** `specialistSection` (#32) is a deterministic, prebuilt block about the same turn's Project Health
   *  delegation — the VERIFIED result (read-only content that cannot claim a mutation, preserved
   *  verbatim) or the notice that it could not be established — appended after the mutation report. */
  constructor(outcomes: MutationOutcome[], modelReply: string, specialistSection: string | null = null) {
    super(
      "Djonik mutated Trello but did not verify the write with an independent read in this turn.\n" +
        describeMutationOutcomes(outcomes, describeDueForUser) +
        (specialistSection === null ? "" : specialistSection),
    );
    this.name = "DjonikUnverifiedMutationError";
    this.outcomes = outcomes;
    this.modelReply = modelReply;
  }
}

/**
 * One due line, deterministically from the VERIFIED Trello due only (#23): the requested due is
 * never stated as fact. A verified due equal to the requested instant is the normal confirmation;
 * a different one is the explicit mismatch sentence. Also used to render the partial-outcome report.
 */
function describeDueForUser(due: { intendedDue: string; verifiedDue: string }): string {
  const verifiedFacts = computeKyivDueFacts(due.verifiedDue);
  return verifiedFacts !== null
    ? buildVerifiedDueConfirmation({ intendedDue: due.intendedDue, verifiedFacts })
    : `дедлайн у Trello: ${due.verifiedDue}`;
}

/** Kyiv facts for every effective (non-superseded) confirmed mutation that carried a due-date result. */
export function dueOutcomesFromMutations(outcomes: MutationOutcome[]): DueWriteOutcome[] {
  const dueOutcomes: DueWriteOutcome[] = [];
  for (const outcome of outcomes) {
    if (!isConfirmed(outcome) || outcome.superseded || !outcome.due) continue;
    const verifiedFacts = computeKyivDueFacts(outcome.due.verifiedDue);
    if (verifiedFacts !== null) dueOutcomes.push({ intendedDue: outcome.due.intendedDue, verifiedFacts });
  }
  return dueOutcomes;
}

/**
 * Final reply for a turn with NO unresolved mutation (#31; the unresolved case throws
 * `DjonikUnverifiedMutationError` before this).
 *
 * - Any `failed` (tool-errored) write: the tool error is authoritative, so the reply is the
 *   deterministic per-mutation report (`❌` failed, `✅`/`⚠️` confirmed ones) and the model's text
 *   is NOT used at all — it could claim the failed write succeeded, and telling it apart from an
 *   honest message would need prose parsing.
 * - `reply === null` (#32: a turn holding a VERIFIED specialist result, where the model's free text
 *   is never shown) yields the deterministic per-mutation report instead of model text.
 * - Otherwise ordinary confirmed turns keep the model's reply, except that a confirmed due-date
 *   write keeps the #23 guarantee: the wrapper owns the whole confirmation (a lone confirmed
 *   mutation gets the exact #23 sentence — the "differs from what was sent" wording when Trello holds
 *   another due; several get one deterministic line each), so no model due wording survives.
 */
export function finalizeMutationReply(reply: string | null, outcomes: MutationOutcome[]): string {
  if (outcomes.some(isFailed)) return describeMutationOutcomes(outcomes, describeDueForUser);

  const effective = outcomes.filter((outcome) => isConfirmed(outcome) && !outcome.superseded);
  const dueOutcomes = dueOutcomesFromMutations(outcomes);
  if (dueOutcomes.length === 0) return reply ?? describeMutationOutcomes(outcomes, describeDueForUser);
  if (effective.length === 1) return finalizeDueDateReply(reply ?? "", dueOutcomes[0]);
  return effective
    .map((outcome) => {
      const line = outcome.due ? describeDueForUser(outcome.due) : "Зміни підтверджено читанням картки.";
      return `${describeMutationTarget(outcome)}: ${line}`;
    })
    .join("\n");
}

const MAX_VERIFICATION_NUDGES = 1;

type SendableContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string }; title?: string };

type SendableEvent = { type: "user.message"; content: SendableContentBlock[] };

/** Injected in local tests only; production uses the bounded environment-backed executor. */
export type DjonikCustomToolExecutor = (input: unknown) => Promise<CustomToolExecutionResult>;

/** Narrow Session-creation controls for isolated validation. Production callers retain the defaults. */
export interface DjonikSessionOptions {
  /** Validation may inspect durable context without granting the candidate a Memory write path. */
  memoryAccess?: "read_write" | "read_only";
  /** Optional whole-Session public-list-cost backstop, expressed as USD cents. */
  maxListCostUsdCents?: string;
}

/** How one submitted `user.message` ended (#32). Only `end_turn` is a completed turn. */
type TurnEnd =
  | { completed: true; reply: string }
  | { completed: false; stopKind: IncompleteStopKind; partialReply: string };

/** Event types that are session-level facts rather than an earlier turn's late tail, so they are
 *  still honoured before this turn's own `user.message` anchor: terminal failures must never be
 *  swallowed and the cumulative usage snapshot must never lose cost. */
const PRE_ANCHOR_PASSTHROUGH: ReadonlySet<string> = new Set([
  "session.error",
  "session.status_terminated",
  "session.deleted",
  "session.usage",
]);

/** The id of the single `user.message` the provider accepted (official `events.send` response
 *  `data[0].id`), or null when the response carries none (then no per-turn anchor is available). */
function submittedUserEventId(response: unknown): string | null {
  const data = (response as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data) || data.length !== 1) return null;
  const id = (data[0] as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

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
 * with `read_write` access by default, since memory stores can only be attached at
 * session creation time (not added to a running session). An isolated validation may
 * explicitly use a `read_only` mount without changing this production default.
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
  customToolExecutor: DjonikCustomToolExecutor = executeTrelloWorkHistoryFromEnvironment,
  sessionOptions: DjonikSessionOptions = {},
): Promise<DjonikSessionHandle> {
  const memoryAccess = sessionOptions.memoryAccess ?? "read_write";
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    vault_ids: [vaultId],
    ...(sessionOptions.maxListCostUsdCents === undefined
      ? {}
      : { budget: { type: "limit" as const, max_list_cost: { amount: sessionOptions.maxListCostUsdCents, currency: "USD" as const } } }),
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: memoryAccess,
        instructions: DJONIK_MEMORY_INSTRUCTIONS,
      },
    ],
  });

  const stream = await client.beta.sessions.events.stream(session.id);
  const iterator = stream[Symbol.asyncIterator]();

  /** Callable-agent name of the canonical Project Health specialist, proven from the resolved
   *  Session's coordinator roster at creation (#28/#32); null disables the specialist safeguard. */
  const projectHealthSpecialistName = resolveProjectHealthSpecialistName(session.agent);
  /** Specialist thread/result provenance (#32). Thread identity is Session-lifetime (threads are
   *  persistent); which results belong to a turn is decided per turn from that turn's own events. */
  const specialist = new SpecialistTurnProvenance(projectHealthSpecialistName);
  /** Whether this Session's stream has ever echoed a `user.message` event. Once it has, a turn's own
   *  echo (matched by the id `events.send` returned) is the anchor that separates earlier turns'
   *  late events from this turn's (#32). Learned, never assumed: a stream that does not echo
   *  simply never becomes strict, so this can never hang or fail a turn that has no anchor. */
  let userEchoObserved = false;
  /** Events ignored this visible turn because they predate its own anchor (content-free count). */
  let preAnchorEventsQuarantined = 0;

  /**
   * Correlates `agent.mcp_tool_result` events back to the tool call that produced
   * them (results only carry `mcp_tool_use_id`, not the tool name/server/input).
   * Scoped to one `send()` call — cleared at the start of each.
   */
  const mcpToolCallsById = new Map<string, { serverName: string; toolName: string; input: Record<string, unknown> }>();
  /** Custom uses are keyed by the provider event id. Only ids named by requires_action may be answered. */
  const customToolCallsById = new Map<string, { name: string; input: unknown }>();
  /** This turn's per-mutation Trello verification ledger (#31); replaced at the start of every turn. */
  let ledger = new TrelloMutationLedger();
  let turnTelemetry: DjonikTurnTelemetryCollector | null = null;
  /** Session usage events are cumulative; this is the completed-turn baseline. */
  let previousSessionUsage: DjonikCumulativeUsage | null = null;

  /**
   * Submits one `user.message` and reads the primary event stream up to that submission's
   * authoritative idle. Returns `completed: true` ONLY for `stop_reason: end_turn` (#32); a budget
   * pause, `requires_action`, exhausted retries or an unrecognised stop is `completed: false` and its
   * partial text is data, never a reply. It never resumes, resends or raises a budget.
   */
  async function runTurn(events: SendableEvent[]): Promise<TurnEnd> {
    const sent = await client.beta.sessions.events.send(session.id, { events });
    const submittedId = submittedUserEventId(sent);
    // Strict only when the platform has already shown it echoes `user.message` on this stream AND
    // told us this submission's id: then every event before this turn's own echo is an earlier
    // turn's (a late tail, a stale idle) and is quarantined. Otherwise nothing waits for an anchor.
    const strict = submittedId !== null && userEchoObserved;
    let anchored = !strict;
    let reply = "";

    for (;;) {
      const { value: event, done } = await iterator.next();
      if (done) {
        throw new DjonikSessionDeadError("Djonik session event stream ended unexpectedly.");
      }

      if (event.type === "user.message") {
        userEchoObserved = true;
        if (strict && !anchored) {
          if (event.id !== submittedId) {
            // Single-flight (FIFO) submission makes another message's echo impossible here, so a
            // different id is a provenance violation: fail visibly instead of guessing.
            throw new Error("Djonik could not correlate this turn: unexpected user.message echo on the event stream.");
          }
          anchored = true;
        }
        continue;
      }
      if (!anchored && !PRE_ANCHOR_PASSTHROUGH.has(event.type)) {
        if (event.type === "session.thread_created") specialist.onThreadCreated(event, false);
        preAnchorEventsQuarantined += 1;
        continue;
      }

      switch (event.type) {
        case "agent.message":
          reply = event.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("");
          break;
        case "session.thread_created":
          specialist.onThreadCreated(event, true);
          break;
        case "agent.thread_message_sent":
          specialist.onThreadMessageSent(event);
          break;
        case "agent.thread_message_received":
          specialist.onThreadMessageReceived(event);
          break;
        case "session.thread_status_idle":
          specialist.onThreadIdle(event);
          break;
        case "agent.mcp_tool_use":
          mcpToolCallsById.set(event.id, {
            serverName: event.mcp_server_name,
            toolName: event.name,
            input: event.input as Record<string, unknown>,
          });
          ledger.recordToolUse({
            id: event.id,
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
          // Every Trello write/read result is correlated to ITS OWN tool call by tool-use id (#31).
          if (call) {
            ledger.recordToolResult(
              event.mcp_tool_use_id,
              Boolean(event.is_error),
              event.content as Array<{ type: string; text?: string }> | undefined,
            );
          }
          break;
        }
        case "agent.custom_tool_use":
          // `session_thread_id` can identify a cross-posted subagent event, but is informational.
          // Result routing is exclusively by the observed blocking custom-tool event id below.
          customToolCallsById.set(event.id, { name: event.name, input: event.input });
          break;
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
          // is dying. A turn that ends via "exhausted" then idles with
          // `stop_reason: retries_exhausted` (incomplete, below) or with an
          // empty end_turn (the empty-reply check below).
          if (event.error.retry_status.type === "terminal") {
            throw new DjonikSessionDeadError(`Djonik session error: ${event.error.message}`);
          }
          break;
        case "session.status_terminated":
          throw new DjonikSessionDeadError("Djonik session terminated unexpectedly.");
        case "session.status_idle": {
          // Idle is a pause, not a verdict: only `end_turn` completes the turn (#32).
          const stopKind = classifyStopReason(event.stop_reason);
          if (stopKind === "requires_action") {
            const blockingIds = event.stop_reason && "event_ids" in event.stop_reason ? event.stop_reason.event_ids : undefined;
            // Existing non-custom action pauses (for example a server-side confirmation) remain
            // incomplete exactly as #32 requires; this client must not guess how to settle them.
            if (customToolCallsById.size === 0) return { completed: false, stopKind, partialReply: reply };
            if (!Array.isArray(blockingIds) || blockingIds.length === 0 || new Set(blockingIds).size !== blockingIds.length) {
              throw new Error("Djonik requested a malformed custom-tool action; the turn was not completed.");
            }
            const calls = blockingIds.map((id) => (typeof id === "string" ? customToolCallsById.get(id) : undefined));
            if (calls.some((call) => !call || call.name !== "trello_work_history")) {
              throw new Error("Djonik requested an unsupported custom tool; the turn was not completed.");
            }
            // Any text before a tool pause is provisional. It cannot become a visible answer if the
            // post-tool continuation somehow reaches end_turn without a fresh final message.
            reply = "";
            const results = await Promise.all(calls.map((call) => customToolExecutor(call!.input)));
            await client.beta.sessions.events.send(session.id, {
              events: blockingIds.map((id, index) => ({
                type: "user.custom_tool_result" as const,
                custom_tool_use_id: id,
                is_error: results[index].isError,
                content: [{ type: "text" as const, text: results[index].content }],
              })),
            });
            for (const result of results) onTrace?.({ type: "custom_tool_result_sent", toolName: "trello_work_history", isError: result.isError });
            continue;
          }
          if (stopKind !== "end_turn") return { completed: false, stopKind, partialReply: reply };
          // A turn with a verified specialist result is complete even if the coordinator produced
          // no message of its own (#28) — unless it attempted Trello writes, whose outcome then has
          // no coordinator text to accompany it; `sendPartsSerial` composes the reply.
          const idleVerdict = specialist.verdict().status;
          if (!reply && idleVerdict !== "unverified" && (idleVerdict !== "verified" || ledger.outcomes().length > 0)) {
            throw new Error("Djonik produced no text reply for this turn.");
          }
          return { completed: true, reply };
        }
        default:
          break;
      }
    }
  }

  /** Canonical content-block builder (#27): the only place a `DjonikTurnPart[]`
   *  becomes `SendableContentBlock[]`, used by both `send` (legacy fixed order)
   *  and `sendOrdered` (caller-supplied order) — never duplicated. Empty text
   *  parts are skipped, matching the pre-#27 "omit the text block when there's
   *  no caption" behavior. */
  function buildContentBlocks(parts: DjonikTurnPart[]): SendableContentBlock[] {
    const content: SendableContentBlock[] = [];
    for (const part of parts) {
      if (part.type === "image") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: part.image.mediaType, data: part.image.data },
        });
      } else if (part.type === "document") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: part.document.mediaType, data: part.document.data },
          ...(part.document.filename ? { title: part.document.filename } : {}),
        });
      } else if (part.text) {
        content.push({ type: "text", text: part.text });
      }
    }
    return content;
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
   * `parts`' image/document entries are sent as inline base64 `image`/`document`
   * content blocks in exactly `parts`' order (see `DjonikTurnPart`). All of them
   * are untrusted source data like any other external content — they carry no
   * special instruction/tool authority; that boundary lives in the Managed
   * Agent's own configuration, not in this transport code.
   *
   * This is the single implementation both `send` and `sendOrdered` share —
   * see the FIFO `send`/`sendOrdered` wrappers below for why every call must
   * still go through one queue.
   */
  async function sendPartsSerial(parts: DjonikTurnPart[]): Promise<string> {
    ledger = new TrelloMutationLedger();
    specialist.beginTurn();
    preAnchorEventsQuarantined = 0;
    mcpToolCallsById.clear();
    customToolCallsById.clear();
    turnTelemetry = createTurnTelemetryCollector(turnSource, session.id, previousSessionUsage);

    // A grouped multi-attachment turn (#25) still records only the first
    // image/document here — this per-turn telemetry shape predates grouping
    // and existing consumers/tests depend on it. Full per-fragment counts
    // for a grouped turn are recorded separately by the adapter's
    // content-free grouping telemetry (`buildGroupingTelemetry`).
    const firstImagePart = parts.find((part): part is Extract<DjonikTurnPart, { type: "image" }> => part.type === "image");
    const firstDocumentPart = parts.find(
      (part): part is Extract<DjonikTurnPart, { type: "document" }> => part.type === "document",
    );
    if (firstImagePart) {
      turnTelemetry.recordInputImage({ mimeType: firstImagePart.image.mediaType, byteSize: firstImagePart.image.byteSize });
    }
    if (firstDocumentPart) {
      turnTelemetry.recordInputDocument({
        mimeType: firstDocumentPart.document.mediaType,
        byteSize: firstDocumentPart.document.byteSize,
        hasFilename: Boolean(firstDocumentPart.document.filename),
      });
    }

    const content = buildContentBlocks(parts);
    turnTelemetry.recordContentBlockCounts({
      textBlockCount: content.filter((block) => block.type === "text").length,
      imageBlockCount: content.filter((block) => block.type === "image").length,
      documentBlockCount: content.filter((block) => block.type === "document").length,
    });
    if (content.length === 0) {
      throw new Error("Djonik turn requires non-empty text and/or an attachment.");
    }

    try {
      let end = await runTurn([{ type: "user.message", content }]);

      let outcomes = ledger.outcomes();
      // A nudge is a corrective read request for a turn that COMPLETED with an unverified write. A turn
      // that stopped without `end_turn` is never resumed or re-prompted here (#32).
      for (let attempt = 0; end.completed && outcomes.some(isNudgeable) && attempt < MAX_VERIFICATION_NUDGES; attempt += 1) {
        onTrace?.({ type: "verification_nudge_sent", attempt: attempt + 1 });
        turnTelemetry.recordVerificationNudge();
        end = await runTurn([
          {
            type: "user.message",
            content: [{ type: "text", text: buildVerificationNudgeText(nudgeTargetIds(outcomes)) }],
          },
        ]);
        outcomes = ledger.outcomes();
      }

      if (!end.completed) {
        // Budget pause / requires_action / exhausted retries / unknown stop: never a reply. Any Trello
        // writes the turn attempted are reported from tool events only — no replay, no assumed success.
        onTrace?.({ type: "turn_incomplete", stopKind: end.stopKind });
        if (outcomes.some(isUnresolved)) onTrace?.({ type: "write_unverified_failure" });
        throw new DjonikTurnIncompleteError(
          end.stopKind,
          end.partialReply,
          outcomes.length > 0 ? describeMutationOutcomes(outcomes, describeDueForUser) : null,
        );
      }
      let reply = end.reply;

      const verdict = specialist.verdict();
      if (verdict.status === "unverified") onTrace?.({ type: "specialist_result_unverified", reason: verdict.reason });
      const specialistText = verdict.status === "verified" ? verdict.text : null;
      const mutationReport = outcomes.length > 0 ? describeMutationOutcomes(outcomes, describeDueForUser) : null;

      if (outcomes.some(isUnresolved)) {
        onTrace?.({ type: "write_unverified_failure" });
        throw new DjonikUnverifiedMutationError(
          outcomes,
          reply,
          verdict.status === "verified"
            ? specialistBlockForError(verdict.text)
            : verdict.status === "unverified"
              ? `\n\n———\n${specialistUnverifiedNotice(verdict.reason)}`
              : null,
        );
      }

      // Issue #32: a canonical Project Health delegation was engaged but its result cannot be
      // established reliably. The coordinator's text may present Project Health as specialist-backed
      // and events cannot say which part does, so it is never shown — the turn fails visibly. No
      // retry, no re-delegation, no replay; any Trello outcome is reported from tool events.
      if (verdict.status === "unverified") {
        throw new DjonikSpecialistUnverifiedError(verdict.reason, reply, mutationReport);
      }

      // Issue #23 (per mutation since #31): prompt/Skill guidance alone was tried twice and failed
      // twice on the same reproducible case. For a verified due-date write the wrapper — not the
      // model — owns the whole final due-date confirmation deterministically.
      for (const dueOutcome of dueOutcomesFromMutations(outcomes)) {
        const dueTrace = describeDueOutcomeForTrace(dueOutcome);
        if (dueTrace) onTrace?.({ type: "due_date_reply_finalized", ...dueTrace });
      }

      // Issue #28 boundary, made explicit by #32: a VERIFIED specialist result (one engaged thread,
      // one plain-text result, a child that completed) is the authoritative Project Health answer,
      // byte for byte. Coordinator text other than exactly that string is withheld behind a visible
      // notice — events cannot prove it is independent of, rather than a rewrite of, the specialist.
      // A turn with a Trello mutation leads with the system-owned mutation reply (#31/#23), never
      // model text, so no model wording can reach the user beside the specialist block.
      if (specialistText !== null) {
        const composed = composeWithSpecialist(
          reply,
          specialistText,
          outcomes.length > 0 ? finalizeMutationReply(null, outcomes) : null,
        );
        onTrace?.({ type: "specialist_reply_composed", mode: composed.mode });
        return composed.text;
      }

      reply = finalizeMutationReply(reply, outcomes);

      return reply;
    } finally {
      if (preAnchorEventsQuarantined > 0 || specialist.quarantinedResults > 0) {
        onTrace?.({
          type: "late_events_quarantined",
          preAnchorEvents: preAnchorEventsQuarantined,
          lateSpecialistResults: specialist.quarantinedResults,
        });
      }
      const completedTelemetry = turnTelemetry.summary();
      // A turn that saw no usage snapshot must not reset the cumulative baseline (that would make the
      // next turn's delta re-count everything before it).
      previousSessionUsage = turnTelemetry.cumulativeUsage() ?? previousSessionUsage;
      onTurnTelemetry?.(completedTelemetry);
      turnTelemetry = null;
    }
  }

  /**
   * FIFO serialization boundary (#25 live-validation blocker fix). Grouped
   * Telegram dispatches settle on independent timers and can therefore call
   * `send`/`sendOrdered` concurrently on the same handle; `sendPartsSerial`
   * above and its private closure state (`turnTelemetry`, the per-turn Trello mutation
   * `ledger` (#31), `mcpToolCallsById`) and the single event-stream
   * `iterator` are only safe for one in-flight turn at a time. `enqueue` is a
   * thin queue in front of the unchanged `sendPartsSerial` logic: each call
   * waits for every previously queued call to fully settle (resolve or
   * reject) before its own `sendPartsSerial` starts, so at most one turn ever
   * touches the shared state or reads from `iterator` concurrently.
   * `queueTail` is derived with a swallowing `.then(ok, ok)` specifically so a
   * failed turn (an ordinary turn-level error, or even
   * `DjonikSessionDeadError`) never poisons the chain — the next queued call
   * still runs (and, for a dead session, will independently discover and
   * report that same dead state; this handle does not reconnect itself,
   * matching `DjonikSessionManager` owning that responsibility). Both `send`
   * and `sendOrdered` (#27) go through this one queue, since both ultimately
   * call the same `sendPartsSerial`.
   */
  let queueTail: Promise<void> = Promise.resolve();

  function enqueue(run: () => Promise<string>): Promise<string> {
    const previous = queueTail;
    const result = previous.then(run, run);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function send(
    text: string,
    image?: DjonikImageInput | DjonikImageInput[],
    document?: DjonikDocumentInput | DjonikDocumentInput[],
  ): Promise<string> {
    const images = image === undefined ? [] : Array.isArray(image) ? image : [image];
    const documents = document === undefined ? [] : Array.isArray(document) ? document : [document];
    // Legacy fixed order (#22/#24/#25, unchanged): every image, then every
    // document, then the text block (if any).
    const parts: DjonikTurnPart[] = [
      ...images.map((img): DjonikTurnPart => ({ type: "image", image: img })),
      ...documents.map((doc): DjonikTurnPart => ({ type: "document", document: doc })),
      ...(text ? [{ type: "text", text } as const] : []),
    ];
    return enqueue(() => sendPartsSerial(parts));
  }

  function sendOrdered(parts: DjonikTurnPart[]): Promise<string> {
    return enqueue(() => sendPartsSerial(parts));
  }

  function close(): void {
    stream.controller.abort();
  }

  return { sessionId: session.id, send, sendOrdered, close };
}
