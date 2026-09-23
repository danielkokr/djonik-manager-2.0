/**
 * Issue #31: per-mutation Trello verification.
 *
 * The thin Session client used to keep ONE pending-write slot, so a later write overwrote an
 * earlier one, a create (which has no input `cardId`) was "verified" by any unrelated read, and
 * `due` extraction could pick up an unrelated nested object's `due`. This module replaces that
 * slot with a small deterministic ledger that tracks every `trelloWriteCard` call by its own MCP
 * tool-use identity and decides — from the event stream alone — whether each mutation has been
 * verified against ITS OWN target and ITS OWN requested result.
 *
 * It is deliberately not a workflow engine, intent router or Trello client: it never calls
 * Trello, never replays a write, never reads user text or model prose, and never stores state
 * beyond one visible turn. It only correlates the `agent.mcp_tool_use` / `agent.mcp_tool_result`
 * events the Session already emits.
 *
 * Rules (each one is a regression fixture in `trelloMutationLedger.test.ts`):
 *  - a create's target is the card id in ITS OWN successful result; an update/move's target is
 *    its input `cardId`. No unambiguous identity => `target_unknown`, never verified;
 *  - a read verifies a write only if it is a successful direct `trelloReadCard` (`get`) that
 *    STARTED after the write's result, whose parseable result is a single card object whose own
 *    `id` is the write's target. Search/board/list/member reads, other cards, errors, ambiguous
 *    or unparseable results, and reads before the write never count;
 *  - a verified read is compared against the fields the write requested (name, desc, list, due);
 *  - #37: a project-label write (`attach_label`/`detach_label`, its own mutation — a create never
 *    carries a label) requests the `label` field: that label id present (attach) / absent (detach)
 *    in the verified card's OWN `labels`, compared by provider id. Absent/unparseable/paged labels
 *    never confirm; only a later write of the SAME label to the same card owns that field;
 *  - sequential writes to one card: the latest write to a field owns that field; earlier writes'
 *    overwritten fields inherit the later write's outcome. The latest valid read after a write
 *    is the reference read.
 */

export type ToolContent = Array<{ type: string; text?: string }> | undefined;

const TRELLO_MCP_SERVER_PATTERN = /trello/i;
const TRELLO_WRITE_TOOL_PATTERN = /^trelloWrite/;
const TRELLO_READ_TOOL_PATTERN = /^trelloRead/;
const CARD_WRITE_TOOL = "trelloWriteCard";
const CARD_READ_TOOL = "trelloReadCard";

export function isTrelloWriteTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_WRITE_TOOL_PATTERN.test(toolName);
}

export function isTrelloReadTool(serverName: string, toolName: string): boolean {
  return TRELLO_MCP_SERVER_PATTERN.test(serverName) && TRELLO_READ_TOOL_PATTERN.test(toolName);
}

// ---------------------------------------------------------------------------------------------
// Card object / due extraction (anchored: never walks into unrelated nested objects)
// ---------------------------------------------------------------------------------------------

export const ISO_UTC_DUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** A Trello UTC due timestamp: ISO-8601 `Z` shape AND a real instant. */
export function isValidUtcDue(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC_DUE_PATTERN.test(value) && !Number.isNaN(new Date(value).getTime());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasCardId(value: unknown): value is Record<string, unknown> & { id: string } {
  return isPlainObject(value) && typeof value.id === "string" && value.id.trim().length > 0;
}

export type CardObject = Record<string, unknown> & { id: string };

const SINGLE_CARD_CONNECTION_KEYS: ReadonlySet<string> = new Set(["nodes", "totalCount", "hasNextPage"]);

/**
 * Issue #37: the live official Trello MCP returns `trelloWriteCard` results and `trelloReadCard`
 * `get` results as a one-node connection, `{ "cards": { "nodes": [<card>], "totalCount": 1 } }`
 * (recorded Session events, docs/33 §3). That exact single-card form is accepted; a connection
 * with zero or several nodes, a `totalCount` other than 1, a further page, or any other key is not
 * one card.
 */
function singleCardFromConnection(parsed: Record<string, unknown>): unknown {
  if (Object.keys(parsed).length !== 1 || !isPlainObject(parsed.cards)) return null;
  const connection = parsed.cards;
  if (!Object.keys(connection).every((key) => SINGLE_CARD_CONNECTION_KEYS.has(key))) return null;
  if (!Array.isArray(connection.nodes) || connection.nodes.length !== 1) return null;
  if (connection.totalCount !== undefined && connection.totalCount !== 1) return null;
  if (connection.hasNextPage !== undefined && connection.hasNextPage !== false) return null;
  return connection.nodes[0];
}

/**
 * The ONE card object a tool result describes, or null when that is not unambiguous.
 * Accepted shapes: the parsed JSON text block is itself a card object (has a string `id`), a
 * single-key `{ card: <card object> }` wrapper, or the live provider's single-node
 * `{ cards: { nodes: [<card object>] } }` connection (#37). Nothing deeper — a nested
 * `board`/`list`/`members` object is never a candidate, and arrays (search/list results) are never
 * a single card. Several text blocks that each parse to a card object are ambiguous unless they are
 * the same card id.
 */
export function extractCardObject(content: ToolContent): CardObject | null {
  if (!Array.isArray(content)) return null;
  const candidates: CardObject[] = [];
  for (const block of content) {
    if (!block || block.type !== "text" || typeof block.text !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      continue;
    }
    if (hasCardId(parsed)) {
      candidates.push(parsed);
    } else if (isPlainObject(parsed) && Object.keys(parsed).length === 1 && hasCardId(parsed.card)) {
      candidates.push(parsed.card);
    } else if (isPlainObject(parsed)) {
      const node = singleCardFromConnection(parsed);
      if (hasCardId(node)) candidates.push(node);
    }
  }
  if (candidates.length === 0) return null;
  const first = candidates[0];
  return candidates.every((candidate) => candidate.id === first.id) ? first : null;
}

// ---------------------------------------------------------------------------------------------
// Card identity
// ---------------------------------------------------------------------------------------------

/** Trello ids may arrive as a bare 24-hex ObjectId or embedded in an ARI/URL; the last standalone
 *  24-hex token is the comparable key. */
function objectIdKey(identifier: string): string | null {
  const matches = identifier.match(/(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/gi);
  return matches ? matches[matches.length - 1].toLowerCase() : null;
}

function isPlainToken(identifier: string): boolean {
  return !/[/:]/.test(identifier);
}

/** Two identifiers positively name the same card. Unknown/incomparable forms do NOT match. */
export function identifiersMatch(a: string, b: string): boolean {
  const keyA = objectIdKey(a);
  const keyB = objectIdKey(b);
  if (keyA !== null && keyB !== null) return keyA === keyB;
  return a.trim() === b.trim();
}

/** Two identifiers positively name DIFFERENT cards (as opposed to merely being incomparable). */
function identifiersConflict(a: string, b: string): boolean {
  const keyA = objectIdKey(a);
  const keyB = objectIdKey(b);
  if (keyA !== null && keyB !== null) return keyA !== keyB;
  if (isPlainToken(a) && isPlainToken(b)) return a.trim() !== b.trim();
  return false;
}

function readString(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Requested fields (what a write asked Trello to change) and their postconditions
// ---------------------------------------------------------------------------------------------

export type CheckedField = "name" | "desc" | "list" | "due" | "label";

/** `due` in a write's input: a value to set, or a clear request (`""`/`null`). */
type RequestedDue = { kind: "set"; value: string } | { kind: "clear" };

/**
 * #37: the live `trelloWriteCard` label contract is its own mutation — `action: "attach_label"` /
 * `"detach_label"` with `cardId` and `labelId` (ARIs). A create never carries a label. `labelId`
 * is null when the input named none: such a write can never be confirmed.
 */
export type LabelAction = "attach" | "detach";
type RequestedLabel = { action: LabelAction; labelId: string | null };

const LABEL_ACTIONS: Readonly<Record<string, LabelAction>> = { attach_label: "attach", detach_label: "detach" };

interface RequestedFields {
  name?: string;
  desc?: string;
  listId?: string;
  due?: RequestedDue;
  label?: RequestedLabel;
}

function requestedFieldsOf(input: Record<string, unknown>): RequestedFields {
  const requested: RequestedFields = {};
  const labelAction = typeof input.action === "string" ? LABEL_ACTIONS[input.action] : undefined;
  if (labelAction !== undefined) {
    requested.label = { action: labelAction, labelId: readString(input, "labelId") };
  }
  const name = readString(input, "name") ?? readString(input, "title");
  if (name !== null) requested.name = name;
  const desc = readString(input, "desc") ?? readString(input, "description");
  if (desc !== null) requested.desc = desc;
  const listId = readString(input, "listId") ?? readString(input, "idList");
  if (listId !== null) requested.listId = listId;
  if ("due" in input) {
    const due = input.due;
    if (typeof due === "string" && due.trim().length > 0) requested.due = { kind: "set", value: due };
    else if (due === null || due === "") requested.due = { kind: "clear" };
  }
  return requested;
}

function requestedFieldNames(requested: RequestedFields): CheckedField[] {
  const fields: CheckedField[] = [];
  if (requested.name !== undefined) fields.push("name");
  if (requested.desc !== undefined) fields.push("desc");
  if (requested.listId !== undefined) fields.push("list");
  if (requested.due !== undefined) fields.push("due");
  if (requested.label !== undefined) fields.push("label");
  return fields;
}

/** Two writes request the SAME label (so a later one owns the earlier one's `label` field). */
function sameRequestedLabel(a: RequestedFields, b: RequestedFields): boolean {
  const idA = a.label?.labelId;
  const idB = b.label?.labelId;
  return typeof idA === "string" && typeof idB === "string" && identifiersMatch(idA, idB);
}

export type CardLabelState = "present" | "absent" | "unavailable";

/**
 * Whether ONE card object's own `labels` carry `labelId`, compared by provider id — never by
 * display name. Presence needs one well-formed element with that id. Absence is only claimed from a
 * complete, fully parseable array: a missing/non-array `labels`, a malformed element, or a further
 * page (`labelsHasMore: true`) make an absent label `unavailable`, never proven absent.
 */
export function cardLabelState(card: Record<string, unknown>, labelId: string): CardLabelState {
  const labels = card.labels;
  if (!Array.isArray(labels)) return "unavailable";
  let complete = card.labelsHasMore !== true;
  for (const element of labels) {
    if (!isPlainObject(element) || typeof element.id !== "string" || element.id.trim().length === 0) {
      complete = false;
      continue;
    }
    if (identifiersMatch(element.id, labelId)) return "present";
  }
  return complete ? "absent" : "unavailable";
}

/** The display name of `labelId` on this card object, when it carries a well-formed element for it. */
function cardLabelName(card: Record<string, unknown>, labelId: string): string | null {
  if (!Array.isArray(card.labels)) return null;
  for (const element of card.labels) {
    if (isPlainObject(element) && typeof element.id === "string" && identifiersMatch(element.id, labelId)) {
      return typeof element.name === "string" && element.name.trim().length > 0 ? element.name : null;
    }
  }
  return null;
}

type FieldResult = "match" | "mismatch" | "unavailable";

interface FieldEvaluation {
  result: FieldResult;
  /** Only for `due`: the parseable verified value found on the card object itself. */
  verifiedDue?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function cardListId(card: Record<string, unknown>): string | null {
  const list = card.list;
  if (isPlainObject(list) && typeof list.id === "string" && list.id.length > 0) return list.id;
  for (const key of ["idList", "listId"]) {
    const value = card[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function evaluateField(field: CheckedField, requested: RequestedFields, card: Record<string, unknown>): FieldEvaluation {
  switch (field) {
    case "name":
    case "desc": {
      // Mirror the input aliases (`title`/`description`) so a read is compared under the same name.
      const actual = field === "name" ? (card.name ?? card.title) : (card.desc ?? card.description);
      if (typeof actual !== "string") return { result: "unavailable" };
      const wanted = field === "name" ? requested.name! : requested.desc!;
      return { result: normalizeText(actual) === normalizeText(wanted) ? "match" : "mismatch" };
    }
    case "list": {
      const actual = cardListId(card);
      if (actual === null) return { result: "unavailable" };
      return { result: identifiersMatch(actual, requested.listId!) ? "match" : "mismatch" };
    }
    case "due": {
      const wanted = requested.due!;
      if (!("due" in card)) return { result: "unavailable" };
      const actual = card.due;
      if (wanted.kind === "clear") {
        if (actual === null) return { result: "match" };
        return { result: typeof actual === "string" ? "mismatch" : "unavailable" };
      }
      // A set-due request is confirmed only by a parseable `due` on THIS card object. A different
      // parseable instant is still "verified" (reported as an intended-vs-verified mismatch by the
      // #23 wording); an explicit `null` means Trello holds no deadline at all.
      if (isValidUtcDue(actual)) return { result: "match", verifiedDue: actual };
      return { result: actual === null ? "mismatch" : "unavailable" };
    }
    case "label": {
      const wanted = requested.label!;
      if (wanted.labelId === null) return { result: "unavailable" };
      const state = cardLabelState(card, wanted.labelId);
      if (state === "unavailable") return { result: "unavailable" };
      const wantedState: CardLabelState = wanted.action === "attach" ? "present" : "absent";
      return { result: state === wantedState ? "match" : "mismatch" };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------------------------

export type MutationStatus =
  /** Every requested field confirmed on a valid direct read taken after the write. */
  | "verified"
  /**
   * The direct read confirmed the card and every other requested field, but Trello holds a DIFFERENT
   * parseable deadline than the one requested (#23 intended-vs-verified mismatch). This is a
   * terminal, authoritative outcome: another read cannot change it, so it is never nudged, and the
   * final reply states the verified Trello due deterministically — never the requested one.
   */
  | "due_differs"
  /** Target known, but no valid direct read of that card has followed the write yet. */
  | "awaiting_read"
  /** A valid direct read followed, but a requested field holds a different value. */
  | "field_mismatch"
  /** A valid direct read followed, but a requested field's value is absent/unparseable on it. */
  | "field_unconfirmed"
  /** No single unambiguous card identity could be established for this write. */
  | "target_unknown"
  /** The write call never produced a result event, so whether it applied is unknown. */
  | "no_result"
  /**
   * The write call returned an error result: authoritatively NOT applied. Terminal and never
   * nudged (a retry could duplicate); the final reply is built from this outcome, not from model text.
   */
  | "failed";

export interface MutationOutcome {
  toolUseId: string;
  status: MutationStatus;
  /** Card identifiers the mutation is bound to (empty when `target_unknown`). For `failed`/`no_result` only the
   *  input `cardId` of a non-create, shown for honest reporting and never used to verify anything. */
  targetCardIds: string[];
  /** The requested card name, when the write carried one — for honest reporting only. A label
   *  write (#37) carries no name, so it shows the name another write in this turn requested for the
   *  same card, if any. */
  label: string | null;
  /** #37: present only for a project-label write (`attach_label`/`detach_label`). `name` is the
   *  label's display name taken from the verified card read; null when not confirmed there. */
  projectLabel?: { action: LabelAction; labelId: string | null; name: string | null };
  /** #37: true when the write was a `create` (its target is the card its own result returned). */
  isCreate?: boolean;
  /** Requested fields whose latest-writer check did NOT confirm (mismatch/unavailable). */
  unconfirmedFields: CheckedField[];
  /** True when every requested field was overwritten by a later write to the same card. */
  superseded: boolean;
  /** Present only when this write is the effective writer of `due` and the read gave a parseable value. */
  due?: { intendedDue: string; verifiedDue: string };
  /** Only for `failed`: the tool's own error text, whitespace-collapsed and length-bounded. */
  errorText?: string;
}

/** Statuses for which one more direct read of the target card could plausibly resolve the write. */
const NUDGEABLE_STATUSES: ReadonlySet<MutationStatus> = new Set(["awaiting_read", "field_mismatch", "field_unconfirmed"]);
/** Statuses that block reporting success. */
const UNRESOLVED_STATUSES: ReadonlySet<MutationStatus> = new Set([
  "awaiting_read",
  "field_mismatch",
  "field_unconfirmed",
  "target_unknown",
  "no_result",
]);

export function isUnresolved(outcome: MutationOutcome): boolean {
  return UNRESOLVED_STATUSES.has(outcome.status);
}

export function isNudgeable(outcome: MutationOutcome): boolean {
  return NUDGEABLE_STATUSES.has(outcome.status);
}

/** The card was authoritatively read back after the write and the mutation applied (a differing
 *  `due` is applied-with-a-different-value, reported explicitly rather than as plain success). */
export function isConfirmed(outcome: MutationOutcome): boolean {
  return outcome.status === "verified" || outcome.status === "due_differs";
}

export function isFailed(outcome: MutationOutcome): boolean {
  return outcome.status === "failed";
}

const MAX_ERROR_TEXT = 200;

function boundedErrorText(content: ToolContent): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block) => (block && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return undefined;
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;
}

interface RecordedCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  useSeq: number;
  resultSeq?: number;
  isError?: boolean;
  content?: ToolContent;
}

interface ValidRead {
  useSeq: number;
  resultSeq: number;
  card: CardObject;
}

interface ResolvedWrite {
  call: RecordedCall & { resultSeq: number };
  requested: RequestedFields;
  ids: string[];
}

export class TrelloMutationLedger {
  private seq = 0;
  private readonly calls = new Map<string, RecordedCall>();

  /** Records a Trello MCP tool call. Non-Trello calls and Trello tools that are neither the card
   *  write nor a read are ignored. A replay of an already-recorded tool-use id (same provider event)
   *  is ignored too (#40): it must never reset that call's ordering, correlated result or outcome. */
  recordToolUse(call: { id: string; serverName: string; toolName: string; input: Record<string, unknown> }): void {
    if (!isTrelloWriteTool(call.serverName, call.toolName) && !isTrelloReadTool(call.serverName, call.toolName)) return;
    if (this.calls.has(call.id)) return;
    this.seq += 1;
    this.calls.set(call.id, { id: call.id, toolName: call.toolName, input: call.input ?? {}, useSeq: this.seq });
  }

  /** Records the result belonging to a previously recorded call (matched by tool-use id). */
  recordToolResult(toolUseId: string, isError: boolean, content: ToolContent): void {
    const call = this.calls.get(toolUseId);
    if (!call || call.resultSeq !== undefined) return;
    this.seq += 1;
    call.resultSeq = this.seq;
    call.isError = isError;
    call.content = content;
  }

  /** One outcome per attempted Trello write call, in the order the calls were made. */
  outcomes(): MutationOutcome[] {
    const writeCalls = [...this.calls.values()].filter((call) => TRELLO_WRITE_TOOL_PATTERN.test(call.toolName));
    const validReads = this.validDirectReads();
    const resolved: ResolvedWrite[] = [];
    const preliminary = new Map<string, MutationOutcome>();

    for (const call of writeCalls) {
      const requested = call.toolName === CARD_WRITE_TOOL ? requestedFieldsOf(call.input) : {};
      const base: MutationOutcome = {
        toolUseId: call.id,
        status: "target_unknown",
        targetCardIds: [],
        label: requested.name ?? null,
        unconfirmedFields: [],
        superseded: false,
        ...(requested.label
          ? { projectLabel: { action: requested.label.action, labelId: requested.label.labelId, name: null } }
          : {}),
        ...(call.toolName === CARD_WRITE_TOOL && call.input.action === "create" ? { isCreate: true } : {}),
      };
      // Display-only target for the report; a failed or result-less write is never bound to a
      // verification target (#37 needs it to tie an unconfirmed label write to its created card).
      const shownId = call.input.action === "create" ? null : readString(call.input, "cardId");
      if (call.resultSeq === undefined) {
        preliminary.set(call.id, { ...base, status: "no_result", targetCardIds: shownId !== null ? [shownId] : [] });
      } else if (call.isError) {
        const errorText = boundedErrorText(call.content);
        preliminary.set(call.id, {
          ...base,
          status: "failed",
          targetCardIds: shownId !== null ? [shownId] : [],
          ...(errorText !== undefined ? { errorText } : {}),
        });
      } else if (call.toolName !== CARD_WRITE_TOOL) {
        // No known identity/result contract for any other write tool: never verified.
        preliminary.set(call.id, base);
      } else {
        const ids = this.targetIdsOf(call);
        if (ids.length === 0) {
          preliminary.set(call.id, base);
        } else {
          preliminary.set(call.id, { ...base, status: "awaiting_read", targetCardIds: ids });
          resolved.push({ call: call as ResolvedWrite["call"], requested, ids });
        }
      }
    }

    const evaluated = new Map<string, MutationOutcome>();
    const evaluate = (write: ResolvedWrite): MutationOutcome => {
      const cached = evaluated.get(write.call.id);
      if (cached) return cached;
      const outcome = this.evaluateWrite(write, resolved, validReads, evaluate, preliminary.get(write.call.id)!);
      evaluated.set(write.call.id, outcome);
      return outcome;
    };
    for (const write of resolved) evaluate(write);

    const outcomes = writeCalls.map((call) => evaluated.get(call.id) ?? preliminary.get(call.id)!);
    return outcomes.map((outcome) => this.withBorrowedCardName(outcome, outcomes));
  }

  /** Display only (#37): a label write names no card, so report it under the name another write in
   *  this turn requested for the same card. Never affects status or identity. */
  private withBorrowedCardName(outcome: MutationOutcome, all: MutationOutcome[]): MutationOutcome {
    if (outcome.label !== null || !outcome.projectLabel) return outcome;
    const ids = outcome.targetCardIds;
    const named = all.find(
      (other) => other.label !== null && other.targetCardIds.some((otherId) => ids.some((id) => identifiersMatch(id, otherId))),
    );
    return named ? { ...outcome, label: named.label } : outcome;
  }

  /** Identifiers a successful card write is bound to; empty when its identity is not unambiguous. */
  private targetIdsOf(call: RecordedCall): string[] {
    const resultCard = extractCardObject(call.content);
    const resultId = resultCard ? resultCard.id : null;
    if (call.input.action === "create") {
      // A create has no input target: only the authoritative result names the new card. An input
      // `cardId` on a create is never trusted.
      return resultId !== null ? [resultId] : [];
    }
    const inputId = readString(call.input, "cardId");
    if (inputId !== null) {
      if (resultId !== null && identifiersConflict(inputId, resultId)) return [];
      return resultId !== null && !identifiersMatch(inputId, resultId) ? [inputId, resultId] : [inputId];
    }
    return resultId !== null ? [resultId] : [];
  }

  /** Successful direct card reads (`trelloReadCard` `get`) whose result is one identifiable card. */
  private validDirectReads(): Array<ValidRead & { inputId: string }> {
    const reads: Array<ValidRead & { inputId: string }> = [];
    for (const call of this.calls.values()) {
      if (call.toolName !== CARD_READ_TOOL || call.resultSeq === undefined || call.isError) continue;
      if (call.input.action !== undefined && call.input.action !== "get") continue;
      const inputId = readString(call.input, "cardIdOrUrl") ?? readString(call.input, "cardId");
      const card = extractCardObject(call.content);
      if (inputId === null || card === null) continue;
      // The call asked for one card and the result says it is another: do not trust either.
      if (identifiersConflict(inputId, card.id)) continue;
      reads.push({ useSeq: call.useSeq, resultSeq: call.resultSeq, card, inputId });
    }
    return reads;
  }

  private evaluateWrite(
    write: ResolvedWrite,
    allWrites: ResolvedWrite[],
    reads: ValidRead[],
    evaluate: (write: ResolvedWrite) => MutationOutcome,
    base: MutationOutcome,
  ): MutationOutcome {
    const sameCard = (other: ResolvedWrite) =>
      other.ids.some((otherId) => write.ids.some((id) => identifiersMatch(id, otherId)));
    const isReadOfThisCard = (read: ValidRead) => write.ids.some((id) => identifiersMatch(id, read.card.id));

    // Reference read: the latest valid direct read of this card that STARTED after this write's result.
    let reference: ValidRead | null = null;
    for (const read of reads) {
      if (read.useSeq > write.call.resultSeq && isReadOfThisCard(read)) {
        if (reference === null || read.resultSeq > reference.resultSeq) reference = read;
      }
    }
    if (reference === null) return base; // awaiting_read

    const fields = requestedFieldNames(write.requested);
    const unconfirmed: CheckedField[] = [];
    let mismatch = false;
    let supersededFields = 0;
    let due: MutationOutcome["due"];

    for (const field of fields) {
      // A later write to this card, completed before the reference read began, owns the field.
      let owner: ResolvedWrite | null = null;
      for (const other of allWrites) {
        if (other === write || !sameCard(other)) continue;
        if (other.call.resultSeq <= write.call.resultSeq || other.call.resultSeq >= reference.useSeq) continue;
        if (!requestedFieldNames(other.requested).includes(field)) continue;
        // A label write only owns the same label: attaching label B never settles label A (#37).
        if (field === "label" && !sameRequestedLabel(write.requested, other.requested)) continue;
        if (owner === null || other.call.resultSeq > owner.call.resultSeq) owner = other;
      }
      if (owner !== null) {
        supersededFields += 1;
        const ownerOutcome = evaluate(owner);
        if (ownerOutcome.unconfirmedFields.includes(field)) {
          unconfirmed.push(field);
          // An overwritten field inherits the owner's failure kind.
          if (ownerOutcome.status === "field_mismatch") mismatch = true;
        }
        continue;
      }
      const evaluation = evaluateField(field, write.requested, reference.card);
      if (evaluation.result === "match") {
        if (field === "due" && evaluation.verifiedDue !== undefined && write.requested.due?.kind === "set") {
          due = { intendedDue: write.requested.due.value, verifiedDue: evaluation.verifiedDue };
        }
      } else {
        unconfirmed.push(field);
        if (evaluation.result === "mismatch") mismatch = true;
      }
    }

    // Unconfirmed fields always outrank a differing deadline: the mutation is then unresolved.
    const dueDiffers = due !== undefined && new Date(due.intendedDue).getTime() !== new Date(due.verifiedDue).getTime();
    const status: MutationStatus =
      unconfirmed.length > 0 ? (mismatch ? "field_mismatch" : "field_unconfirmed") : dueDiffers ? "due_differs" : "verified";
    const labelId = write.requested.label?.labelId ?? null;
    return {
      ...base,
      status,
      unconfirmedFields: unconfirmed,
      superseded: fields.length > 0 && supersededFields === fields.length,
      ...((status === "verified" || status === "due_differs") && due ? { due } : {}),
      ...(base.projectLabel && labelId !== null
        ? { projectLabel: { ...base.projectLabel, name: cardLabelName(reference.card, labelId) } }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Honest reporting (deterministic, user-facing Ukrainian; never derived from model prose)
// ---------------------------------------------------------------------------------------------

function describeCard(outcome: MutationOutcome): string {
  const id = outcome.targetCardIds[0];
  if (outcome.label !== null) return id ? `«${outcome.label}» (${id})` : `«${outcome.label}»`;
  return id ? `картка ${id}` : "картка без відомого ID";
}

/** #37: a project-label write is reported as that label change on its card, never as the card write. */
function describeTarget(outcome: MutationOutcome): string {
  const projectLabel = outcome.projectLabel;
  if (!projectLabel) return describeCard(outcome);
  const id = outcome.targetCardIds[0];
  const card = outcome.label !== null ? describeCard(outcome) : (id ?? "без відомого ID");
  const name = projectLabel.name !== null ? ` «${projectLabel.name}»` : "";
  return projectLabel.action === "attach"
    ? `label проєкту${name} на картці ${card}`
    : `зняття label${name} з картки ${card}`;
}

const FIELD_LABEL_UK: Record<CheckedField, string> = {
  name: "назва",
  desc: "опис",
  list: "список",
  due: "дедлайн",
  label: "label проєкту",
};

/**
 * #37 partial success: a create Trello confirmed, followed by a project-label attach on THAT card
 * which is not confirmed (failed, unverified or unknown). The card exists and is not erased from the
 * report, but it must not read as belonging to its project.
 */
function partialProjectAssignmentLine(outcomes: MutationOutcome[]): string | null {
  const createdIds = outcomes.filter((outcome) => outcome.isCreate === true && isConfirmed(outcome)).flatMap((o) => o.targetCardIds);
  const unconfirmedAttach = outcomes.some(
    (outcome) =>
      outcome.projectLabel?.action === "attach" &&
      !isConfirmed(outcome) &&
      outcome.targetCardIds.some((id) => createdIds.some((createdId) => identifiersMatch(id, createdId))),
  );
  return unconfirmedAttach
    ? "⚠️ Картку створено, але належність до проєкту (label) НЕ підтверджено — поки що вона без проєкту."
    : null;
}

function describeReason(outcome: MutationOutcome): string {
  const fields = outcome.unconfirmedFields.map((field) => FIELD_LABEL_UK[field]).join(", ");
  switch (outcome.status) {
    case "awaiting_read":
      return "після запису не було успішного прямого читання цієї картки";
    case "field_mismatch":
      return `Trello після запису показує інші значення: ${fields}`;
    case "field_unconfirmed":
      return `пряме читання не підтвердило значення: ${fields}`;
    case "target_unknown":
      return "не вдалося встановити однозначну ціль запису (немає ID картки в результаті), тож перевірити його неможливо";
    case "no_result":
      return "результат виклику запису невідомий";
    default:
      return "";
  }
}

type DueDescriber = (due: { intendedDue: string; verifiedDue: string }) => string;

/** Fallback wording when the caller supplies no Kyiv formatter: states only the VERIFIED Trello due. */
const describeDueFallback: DueDescriber = (due) => `дедлайн у Trello: ${due.verifiedDue}`;

/**
 * Multi-line report of every mutation, derived purely from tool events: what Trello confirmed
 * (`✅`), confirmed-but-different deadline or unconfirmed (`⚠️`), and what the tool rejected
 * (`❌`, with the tool's own bounded error text). `describeDue` renders a due line and must state
 * only the verified Trello due.
 */
export function describeMutationOutcomes(outcomes: MutationOutcome[], describeDue: DueDescriber = describeDueFallback): string {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "verified") {
      if (outcome.superseded) continue;
      lines.push(
        outcome.due
          ? `✅ ${describeTarget(outcome)}: ${describeDue(outcome.due)}`
          : `✅ Підтверджено читанням картки: ${describeTarget(outcome)}`,
      );
    } else if (outcome.status === "due_differs") {
      if (!outcome.superseded && outcome.due) lines.push(`⚠️ ${describeTarget(outcome)}: ${describeDue(outcome.due)}`);
    } else if (outcome.status === "failed") {
      lines.push(
        `❌ Не виконано (помилка інструмента): ${describeTarget(outcome)}${outcome.errorText ? ` — ${outcome.errorText}` : ""}`,
      );
    } else {
      lines.push(`⚠️ НЕ підтверджено: ${describeTarget(outcome)} — ${describeReason(outcome)}`);
    }
  }
  const partial = partialProjectAssignmentLine(outcomes);
  if (partial !== null) lines.push(partial);
  return lines.join("\n");
}

/** Targets a corrective nudge should ask the agent to read (deduplicated, in order). */
export function nudgeTargetIds(outcomes: MutationOutcome[]): string[] {
  const ids: string[] = [];
  for (const outcome of outcomes) {
    if (!isNudgeable(outcome)) continue;
    for (const id of outcome.targetCardIds.slice(0, 1)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function describeMutationTarget(outcome: MutationOutcome): string {
  return describeTarget(outcome);
}
