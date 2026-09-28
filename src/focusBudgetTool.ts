import { DEFAULT_RHYTHM_CONFIG, type RhythmConfig } from "./rhythmConfig.js";
import { listEntry, listRoleFor } from "./rhythmFacts.js";
import { budgetDeadline, budgetStart, FOCUS_TOOL_CALL_RETENTION_DAYS, formatBudget, type FocusLedger, type FocusToolCall } from "./rhythmFocus.js";
import { focusOf, withFocus, type RhythmStateStore } from "./rhythmState.js";
import { formatKyivDateTime, type TrelloAction, type TrelloCardState } from "./trelloWorkHistory.js";
import type { MutationAuthority } from "./turnAuthority.js";

/**
 * The `focus_budget` custom tool (#50): the one way Claude records Daniel's own explicit time budget for the card he
 * is working on now ("беру Azov на 2 години"). It is not a focus-management API: current focus itself comes from
 * Trello In-progress moves with zero model calls (`rhythmFocus.ts`); this tool only attaches a duration to the card's
 * CURRENT In-progress stint, or removes it. A qualitative Size is never a duration and never reaches this tool.
 *
 * Side-effect safety (docs/01 §13 admission rule — the side effect is code-owned rhythm state, no external write):
 * - authority: only a turn with human authority (Daniel's message or his button); an autonomous Working Rhythm turn
 *   is refused BEFORE any Trello read or state access;
 * - target: the card id must be a Trello id, and a fresh GET must show the card open and In progress with an
 *   authoritative entry into its current list; the budget binds to that entry, so no remote id is invented;
 * - durable idempotency: the `custom_tool_use_id` is the key, recorded in the same atomic state write as the change
 *   (`focus.toolCalls`); a replay returns the recorded result and applies nothing again;
 * - postcondition: success is returned only after a fresh read of the state file shows the intended result.
 */

export const FOCUS_BUDGET_TOOL_NAME = "focus_budget";

export const MIN_BUDGET_MINUTES = 15;
export const MAX_BUDGET_MINUTES = 12 * 60;

export const FOCUS_BUDGET_TOOL = {
  type: "custom" as const,
  name: FOCUS_BUDGET_TOOL_NAME,
  description:
    "Daniel's own explicit time budget for the card he is working on now, stored by code as the timebox of that card's current " +
    "In-progress stint. `set` only when Daniel himself gives a duration for work he is taking ('беру Azov на 2 години' → minutes 120); " +
    "never derive minutes from Size (S/M/L/XL are not durations) and never estimate them. The card must already be In progress — " +
    "move it there first through the verified Trello write — and `card_id` must come from a fresh Trello read in this turn. " +
    "`clear` removes the budget ('без таймера'). Say it is set only when the result is ok, and give its `confirmation` line exactly. " +
    "Only working time from /rhythm.md `work_hours` counts; when the budget is used up, Djonik may check once whether Daniel should " +
    "switch — the timer never means 'stop'.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["op", "card_id"],
    properties: {
      op: { enum: ["set", "clear"] },
      card_id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
      minutes: { type: "integer", minimum: MIN_BUDGET_MINUTES, maximum: MAX_BUDGET_MINUTES },
    },
  },
};

export type FocusBudgetInput = { op: "set"; cardId: string; minutes: number } | { op: "clear"; cardId: string };

export class FocusBudgetInputError extends Error {}

const TRELLO_ID_RE = /^[0-9a-fA-F]{24}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseFocusBudgetInput(value: unknown): FocusBudgetInput {
  if (!isRecord(value)) throw new FocusBudgetInputError("Input must be an object.");
  const unknown = Object.keys(value).filter((key) => !["op", "card_id", "minutes"].includes(key));
  if (unknown.length > 0) throw new FocusBudgetInputError(`Unknown field(s): ${unknown.join(", ")}.`);
  if (typeof value.card_id !== "string" || !TRELLO_ID_RE.test(value.card_id)) throw new FocusBudgetInputError("`card_id` must be a Trello card id from a fresh read.");
  if (value.op === "clear") {
    if (value.minutes !== undefined) throw new FocusBudgetInputError("`clear` takes no minutes.");
    return { op: "clear", cardId: value.card_id };
  }
  if (value.op !== "set") throw new FocusBudgetInputError("`op` must be set or clear.");
  const minutes = value.minutes;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < MIN_BUDGET_MINUTES || minutes > MAX_BUDGET_MINUTES) {
    throw new FocusBudgetInputError(`\`minutes\` must be an integer ${MIN_BUDGET_MINUTES}–${MAX_BUDGET_MINUTES} that Daniel himself gave.`);
  }
  return { op: "set", cardId: value.card_id, minutes };
}

export interface FocusBudgetResult {
  isError: boolean;
  content: string;
}

type ErrorCode = "invalid_input" | "not_allowed_in_autonomous_turn" | "unavailable" | "not_in_progress" | "entry_unknown" | "not_verified";

const MESSAGE: Record<ErrorCode, string> = {
  invalid_input: "The call was malformed; fix it and call again.",
  not_allowed_in_autonomous_turn: "A focus budget can be set or cleared only in Daniel's own turn. Propose it; do not claim it.",
  unavailable: "Focus budgets are unavailable right now; nothing was saved. Tell Daniel the timer is not set.",
  not_in_progress: "The card is not In progress (fresh Trello read); nothing was saved. Move it to In progress through the verified write first, or ask.",
  entry_unknown: "Trello history does not prove when this card entered In progress; nothing was saved. Tell Daniel the timer is not set.",
  not_verified: "The state store could not confirm the change; say the timer is not confirmed.",
};

function errorResult(op: string, code: ErrorCode, message = MESSAGE[code]): FocusBudgetResult {
  return { isError: true, content: JSON.stringify({ ok: false, op, error: { code, message } }) };
}

function okResult(payload: Record<string, unknown>): FocusBudgetResult {
  return { isError: false, content: JSON.stringify({ ok: true, ...payload }) };
}

/** The GET-only reads the executor needs (the same read-token client as the rhythm). */
export interface FocusCardReader {
  readCardState(cardId: string): Promise<TrelloCardState>;
  readLatestListEntry(cardId: string): Promise<TrelloAction | null>;
}

export interface FocusBudgetDeps {
  /** The rhythm state store; null → unavailable (nothing is ever promised without a durable home). */
  store: RhythmStateStore | null;
  reader: FocusCardReader | null;
  now(): Date;
  /** Parsed `/rhythm.md` (work hours, workdays); a failure falls back to the defaults (no work hours). */
  readConfig(): Promise<RhythmConfig>;
  log?: (line: string) => void;
}

export interface FocusBudgetContext {
  toolUseId: string;
  authority: MutationAuthority;
}

export type FocusBudgetExecutor = (input: unknown, context: FocusBudgetContext) => Promise<FocusBudgetResult>;

function pruneToolCalls(ledger: FocusLedger, now: Date): FocusLedger {
  const cutoff = now.getTime() - FOCUS_TOOL_CALL_RETENTION_DAYS * 86_400_000;
  return { ...ledger, toolCalls: Object.fromEntries(Object.entries(ledger.toolCalls).filter(([, call]) => Date.parse(call.at) >= cutoff)) };
}

/** Fresh Trello proof that the card is open, In progress, and when it entered its current list. */
async function currentStint(reader: FocusCardReader, cardId: string): Promise<{ name: string; enteredAt: string } | ErrorCode> {
  const card = await reader.readCardState(cardId);
  if (card.closed || listRoleFor(card.listName ?? undefined) !== "in_progress") return "not_in_progress";
  const action = await reader.readLatestListEntry(cardId);
  const entry = action ? listEntry(action) : null;
  const at = action?.date ? Date.parse(action.date) : Number.NaN;
  const intoCurrent = entry !== null && (entry.id !== null && card.listId ? entry.id === card.listId : listRoleFor(entry.name) === "in_progress");
  if (!intoCurrent || Number.isNaN(at) || action?.data?.card?.id !== cardId) return "entry_unknown";
  return { name: card.name, enteredAt: new Date(at).toISOString() };
}

export function createFocusBudgetExecutor(deps: FocusBudgetDeps): FocusBudgetExecutor {
  const log = deps.log ?? (() => {});
  return async (rawInput, context) => {
    let input: FocusBudgetInput;
    try {
      input = parseFocusBudgetInput(rawInput);
    } catch (error) {
      const op = isRecord(rawInput) && typeof rawInput.op === "string" ? rawInput.op : "unknown";
      return errorResult(op, "invalid_input", `${MESSAGE.invalid_input} ${error instanceof FocusBudgetInputError ? error.message : ""}`.trim());
    }
    if (context.authority !== "human") {
      // Refused before any Trello read or state access: an autonomous rhythm turn only reads and proposes.
      log(`[focus] ${input.op} refused_autonomous`);
      return errorResult(input.op, "not_allowed_in_autonomous_turn");
    }
    const store = deps.store;
    if (store === null) return errorResult(input.op, "unavailable");
    const now = deps.now();

    try {
      // A replay of an id already applied answers from its record without another Trello read.
      const recorded = focusOf(await store.load()).toolCalls[context.toolUseId];
      if (recorded) return { isError: recorded.isError, content: recorded.content };
    } catch {
      return errorResult(input.op, "unavailable");
    }
    if (input.op === "set" && deps.reader === null) return errorResult(input.op, "unavailable");

    let stint: { name: string; enteredAt: string } | null = null;
    let config: RhythmConfig = DEFAULT_RHYTHM_CONFIG;
    if (input.op === "set") {
      try {
        const found = await currentStint(deps.reader!, input.cardId);
        if (typeof found === "string") {
          log(`[focus] set refused reason=${found}`);
          return errorResult("set", found);
        }
        stint = found;
      } catch {
        return errorResult("set", "unavailable");
      }
      try {
        config = await deps.readConfig();
      } catch {
        log("[focus] config_unavailable_defaults_used");
      }
    }

    let result: FocusBudgetResult | null = null;
    let replayed = false;
    try {
      await store.update((state) => {
        const current = focusOf(state);
        const cached = current.toolCalls[context.toolUseId];
        if (cached) {
          result = { isError: cached.isError, content: cached.content };
          replayed = true;
          return state;
        }
        let next: FocusLedger;
        if (input.op === "set") {
          const budget = { cardId: input.cardId, enteredAt: stint!.enteredAt, minutes: input.minutes, setAt: now.toISOString(), toolUseId: context.toolUseId };
          const deadline = budgetDeadline(budget, config);
          const start = formatKyivDateTime(budgetStart(budget));
          const confirmation =
            `⏱ Бюджет на «${stint!.name}»: ${formatBudget(input.minutes)} робочого часу, рахую з ${start}` +
            (deadline ? `; після ${formatKyivDateTime(deadline)} перевірю, чи варто перемикатись.` : ". Робочі години (work_hours) не задані — таймер не спрацює, доки їх не вкажеш.");
          result = okResult({ op: "set", card_id: input.cardId, minutes: input.minutes, counts_from: start, check_after: deadline ? formatKyivDateTime(deadline) : null, confirmation });
          // Also record the stint itself from this authoritative read, so the next fact collection keeps the budget.
          const prior = current.active[input.cardId];
          next = {
            ...current,
            active: {
              ...current.active,
              [input.cardId]: prior && prior.enteredAt === stint!.enteredAt ? prior : { cardId: input.cardId, project: prior?.project ?? null, enteredAt: stint!.enteredAt, observedAt: now.toISOString() },
            },
            budgets: { ...current.budgets, [input.cardId]: budget },
          };
        } else {
          const had = current.budgets[input.cardId] !== undefined;
          const { [input.cardId]: _removed, ...budgets } = current.budgets;
          result = okResult({ op: "clear", card_id: input.cardId, changed: had, confirmation: had ? "⏱ Таймер для цієї картки знято." : "⏱ Таймера для цієї картки не було." });
          next = { ...current, budgets };
        }
        const call: FocusToolCall = { op: input.op, at: now.toISOString(), isError: false, content: (result as FocusBudgetResult).content };
        return withFocus(state, pruneToolCalls({ ...next, toolCalls: { ...next.toolCalls, [context.toolUseId]: call } }, now));
      });
    } catch {
      log(`[focus] ${input.op} store_unavailable`);
      return errorResult(input.op, "unavailable");
    }

    const outcome = result as FocusBudgetResult | null;
    if (outcome === null) return errorResult(input.op, "unavailable");
    // Verify against a fresh read before any success reaches the model.
    let verified = false;
    try {
      const fresh = focusOf(await store.load());
      // A replay is verified by its durable record alone (a later call may legitimately have changed the budget since).
      verified =
        fresh.toolCalls[context.toolUseId] !== undefined &&
        (replayed || (input.op === "set" ? fresh.budgets[input.cardId]?.toolUseId === context.toolUseId : fresh.budgets[input.cardId] === undefined));
    } catch {
      verified = false;
    }
    if (!verified) {
      log(`[focus] ${input.op} not_verified`);
      return errorResult(input.op, "not_verified");
    }
    log(`[focus] ${input.op} ok`);
    return outcome;
  };
}
