/**
 * Issue #32: turn completion, event correlation and specialist-result preservation.
 *
 * Pure, dependency-light helpers the thin Session client uses to decide, from OFFICIAL Managed
 * Agents event provenance only, (a) whether a turn actually completed, (b) which specialist
 * child result (if any) belongs to the current visible turn and whether it can be trusted, and
 * (c) what the caller may be shown when a verified specialist result meets coordinator prose.
 *
 * It is deliberately not an intent router or a prose parser: it never reads user text, never
 * interprets model text (the only text operation is exact string equality between two strings the
 * transport already holds), never calls the API and never stores anything beyond one visible turn
 * (plus the session-lifetime set of thread ids the Session itself announced).
 *
 * Official schema facts relied on (`@anthropic-ai/sdk` 0.125 `BetaManagedAgentsSessionEvent`;
 * `docs/19_ISSUE_32_IMPLEMENTATION_REPORT.md` §3):
 *  - `session.status_idle` carries a REQUIRED `stop_reason`: `end_turn | requires_action |
 *    retries_exhausted | budget_reached`. Idle alone is not completion;
 *  - `session.thread_created` (`agent_name`, `session_thread_id`) announces a child thread;
 *  - `agent.thread_message_sent` (`to_agent_name`, `to_session_thread_id`) is the coordinator's
 *    task/follow-up to a child; `agent.thread_message_received` (`from_agent_name`,
 *    `from_session_thread_id`) is a child's report to the coordinator;
 *  - `session.thread_status_idle` (`agent_name`, `session_thread_id`, `stop_reason`) is a
 *    thread-scoped idle (never the turn's completion);
 *  - threads are persistent, so a later turn may re-message an existing child without a new
 *    `session.thread_created`; and a paused turn's child may report late;
 *  - a primary-stream `agent.message` carries ONLY `id`, `content`, `processed_at`: nothing says
 *    what it was derived from. That absence is why coordinator prose can never be classified as
 *    "a rewrite of the specialist" versus "independent output" from events (see
 *    `composeWithSpecialist`).
 */

export type TurnStopKind = "end_turn" | "budget_reached" | "requires_action" | "retries_exhausted" | "unknown";
export type IncompleteStopKind = Exclude<TurnStopKind, "end_turn">;

/** Classifies an idle event's `stop_reason`. A missing/unrecognised value is `unknown` (fail closed). */
export function classifyStopReason(stopReason: unknown): TurnStopKind {
  const type = (stopReason as { type?: unknown } | null | undefined)?.type;
  return type === "end_turn" || type === "budget_reached" || type === "requires_action" || type === "retries_exhausted"
    ? type
    : "unknown";
}

const INCOMPLETE_STOP_EXPLANATION: Record<IncompleteStopKind, string> = {
  budget_reached:
    "Managed Session зупинилась через ліміт бюджету (budget_reached), не завершивши відповідь.",
  requires_action:
    "Managed Session чекає на дію (requires_action), яку цей клієнт не виконує.",
  retries_exhausted:
    "Managed Session вичерпала повтори після помилок (retries_exhausted).",
  unknown:
    "Managed Session зупинилась без підтвердженого завершення ходу (stop_reason відсутній або невідомий).",
};

/**
 * Thrown when a turn ended WITHOUT an authoritative `end_turn` (budget pause, requires_action,
 * exhausted retries, unknown stop). Any text the model produced before the stop is only DATA
 * (`partialReply`) — it must never be shown as a finished answer. The message is deterministic and
 * says explicitly that nothing was resumed, retried or replayed; when the turn had attempted Trello
 * writes it also carries the per-mutation report so an interrupted write is never read as success.
 * The Session itself is not dead; the caller decides what to do next (this client never raises
 * the budget, resumes, or resends the user's turn).
 */
export class DjonikTurnIncompleteError extends Error {
  readonly stopKind: IncompleteStopKind;
  readonly partialReply: string;

  constructor(stopKind: IncompleteStopKind, partialReply: string, mutationReport: string | null) {
    super(
      `Хід не завершено. ${INCOMPLETE_STOP_EXPLANATION[stopKind]} ` +
        "Частковий текст відкинуто; нічого не відновлено і жодну дію не повторено." +
        (mutationReport
          ? `\nСтан Trello-змін цього ходу (лише за подіями інструментів):\n${mutationReport}`
          : ""),
    );
    this.name = "DjonikTurnIncompleteError";
    this.stopKind = stopKind;
    this.partialReply = partialReply;
  }
}

// ---------------------------------------------------------------------------------------------
// Canonical specialist provenance
// ---------------------------------------------------------------------------------------------

/** Exact text of one child→coordinator message: its text blocks joined verbatim. Null when the
 *  message is not a plain non-empty string (any non-text block, or no text at all). */
function exactMessageText(content: unknown): string | null {
  if (!Array.isArray(content) || content.length === 0) return null;
  let text = "";
  for (const block of content as Array<{ type?: string; text?: unknown }>) {
    if (block.type !== "text" || typeof block.text !== "string") return null;
    text += block.text;
  }
  return text.length > 0 ? text : null;
}

/** Why an ENGAGED canonical delegation could not be turned into a verified specialist result. */
export type SpecialistUnverifiedReason =
  | "missing_result"
  | "duplicate_results"
  | "multiple_threads"
  | "unrecognized_result"
  | "not_exact_text"
  | "child_not_completed";

export type SpecialistVerdict =
  /** No canonical delegation was engaged this turn: an ordinary turn, nothing here applies. */
  | { status: "none" }
  | { status: "verified"; text: string }
  /** A canonical delegation WAS engaged but its result cannot be established reliably. */
  | { status: "unverified"; reason: SpecialistUnverifiedReason };

interface EngagedThread {
  /** Exact text of each child→coordinator message received on this thread this turn (null = not plain text). */
  results: Array<string | null>;
  /** The child thread itself reported a stop other than `end_turn` this turn. */
  incomplete: boolean;
}

/**
 * Per-visible-turn provenance of the canonical specialist. A child result belongs to THIS turn
 * only if this turn's own stream showed the coordinator engaging that thread first
 * (`session.thread_created` for it, or `agent.thread_message_sent` to it) — so a late result from
 * a child a previous, stopped turn started is quarantined instead of becoming a later reply, while
 * a reused persistent thread that is legitimately messaged again in this turn is accepted.
 *
 * `known` (session lifetime) is only the set of thread ids the Session announced for the canonical
 * callable agent; it proves identity, never that a result belongs to the current turn.
 */
export class SpecialistTurnProvenance {
  private readonly known = new Set<string>();
  private engaged = new Map<string, EngagedThread>();
  private lateResults = 0;
  private unrecognized = 0;

  /** @param canonicalName callable-agent name of the canonical specialist (null disables all of this). */
  constructor(private readonly canonicalName: string | null) {}

  beginTurn(): void {
    this.engaged = new Map();
    this.lateResults = 0;
    this.unrecognized = 0;
  }

  /** Canonical-specialist results that arrived without an in-turn engagement (quarantined). */
  get quarantinedResults(): number {
    return this.lateResults;
  }

  private isCanonicalThread(name: string | null | undefined, threadId: string | null | undefined): threadId is string {
    return (
      this.canonicalName !== null &&
      name === this.canonicalName &&
      typeof threadId === "string" &&
      this.known.has(threadId)
    );
  }

  private engage(threadId: string): void {
    if (!this.engaged.has(threadId)) this.engaged.set(threadId, { results: [], incomplete: false });
  }

  /** `inTurn` is false for an event that predates this turn's anchor: identity only, no engagement. */
  onThreadCreated(event: { agent_name?: string; session_thread_id?: string }, inTurn: boolean): void {
    if (this.canonicalName === null || event.agent_name !== this.canonicalName) return;
    if (typeof event.session_thread_id !== "string") return;
    this.known.add(event.session_thread_id);
    if (inTurn) this.engage(event.session_thread_id);
  }

  /** Only ever called for events at or after this turn's anchor. */
  onThreadMessageSent(event: { to_agent_name?: string | null; to_session_thread_id?: string }): void {
    if (this.isCanonicalThread(event.to_agent_name, event.to_session_thread_id)) {
      this.engage(event.to_session_thread_id);
    }
  }

  onThreadMessageReceived(
    event: { from_agent_name?: string | null; from_session_thread_id?: string; content?: unknown },
  ): void {
    if (this.canonicalName === null) return;
    const nameMatches = event.from_agent_name === this.canonicalName;
    const threadIsCanonical = typeof event.from_session_thread_id === "string" && this.known.has(event.from_session_thread_id);
    if (nameMatches !== threadIsCanonical) {
      // Exactly one half of the identity matches: a canonical name from a thread the Session never
      // announced for it, or a canonical thread reporting under another/no name. Not a result we can
      // attribute — counted so an engaged delegation cannot silently fall back to coordinator prose.
      this.unrecognized += 1;
      return;
    }
    if (!nameMatches) return; // some other agent entirely
    const thread = this.engaged.get(event.from_session_thread_id as string);
    if (!thread) {
      this.lateResults += 1;
      return;
    }
    thread.results.push(exactMessageText(event.content));
  }

  onThreadIdle(event: { agent_name?: string; session_thread_id?: string; stop_reason?: unknown }): void {
    if (!this.isCanonicalThread(event.agent_name, event.session_thread_id)) return;
    const thread = this.engaged.get(event.session_thread_id);
    if (thread && classifyStopReason(event.stop_reason) !== "end_turn") thread.incomplete = true;
  }

  /**
   * `none` when this turn engaged no canonical delegation (ordinary turn; late/unrelated results
   * are only quarantined). Once a canonical delegation WAS engaged, the only trusted outcome is
   * `verified`: exactly one engaged thread, exactly one plain-text result from it, no unattributable
   * canonical-looking result, and a child that did not itself stop abnormally. Every other shape —
   * no result at all, several results or threads, a non-text result, a stopped child, a stray
   * result — is `unverified`: never guessed between and never called verified relay.
   */
  verdict(): SpecialistVerdict {
    if (this.engaged.size === 0) return { status: "none" };
    if (this.unrecognized > 0) return { status: "unverified", reason: "unrecognized_result" };
    if (this.engaged.size > 1) return { status: "unverified", reason: "multiple_threads" };
    const [thread] = [...this.engaged.values()];
    if (thread.results.length === 0) return { status: "unverified", reason: "missing_result" };
    if (thread.results.length > 1) return { status: "unverified", reason: "duplicate_results" };
    const [only] = thread.results;
    if (only === null) return { status: "unverified", reason: "not_exact_text" };
    if (thread.incomplete) return { status: "unverified", reason: "child_not_completed" };
    return { status: "verified", text: only };
  }
}

// ---------------------------------------------------------------------------------------------
// Fail-visible ambiguous specialist provenance
// ---------------------------------------------------------------------------------------------

const UNVERIFIED_REASON_TEXT: Record<SpecialistUnverifiedReason, string> = {
  missing_result: "делегування розпочато, але результат спеціаліста в цьому ході не надійшов",
  duplicate_results: "спеціаліст надіслав кілька результатів, і з подій не можна довести, який остаточний",
  multiple_threads: "делегування йшло до кількох гілок спеціаліста, і з подій не можна довести, яка з них авторитетна",
  unrecognized_result: "надійшов результат, який не вдалося зіставити з канонічним спеціалістом",
  not_exact_text: "результат спеціаліста не є простим текстом",
  child_not_completed: "гілка спеціаліста зупинилась без нормального завершення",
};

/** The deterministic explanation shared by the thrown error and by the notice appended to a mutation report. */
export function specialistUnverifiedNotice(reason: SpecialistUnverifiedReason): string {
  return (
    `Результат Project Health від спеціаліста НЕ підтверджено: ${UNVERIFIED_REASON_TEXT[reason]}. ` +
    "Текст координатора не показано: з подій не можна відокремити в ньому висновок Project Health, " +
    "а він не підтверджений спеціалістом. Нічого не перепідсилалось і не делегувалось повторно; " +
    "повторіть запит окремим повідомленням."
  );
}

/**
 * Thrown when a turn COMPLETED (`end_turn`) after engaging the canonical Project Health specialist
 * but the specialist-backed result could not be reliably established. The coordinator's own text is
 * only DATA (`coordinatorReply`): it may state Project Health as if it were specialist-backed, and
 * events cannot say which part of it does, so it is never shown. Nothing is retried, re-delegated
 * or replayed. The message names the reason without raw provider internals and, when the turn
 * attempted Trello writes, carries the per-mutation report so their outcome is never hidden.
 */
export class DjonikSpecialistUnverifiedError extends Error {
  readonly reason: SpecialistUnverifiedReason;
  readonly coordinatorReply: string;

  constructor(reason: SpecialistUnverifiedReason, coordinatorReply: string, mutationReport: string | null) {
    super(
      specialistUnverifiedNotice(reason) +
        (mutationReport ? `\nСтан Trello-змін цього ходу (лише за подіями інструментів):\n${mutationReport}` : ""),
    );
    this.name = "DjonikSpecialistUnverifiedError";
    this.reason = reason;
    this.coordinatorReply = coordinatorReply;
  }
}

// ---------------------------------------------------------------------------------------------
// Reply contract for a VERIFIED specialist result
// ---------------------------------------------------------------------------------------------

export type SpecialistCompositionMode = "specialist_only" | "exact" | "coordinator_withheld";

const SECTION_BREAK = "\n\n———\n";
const SPECIALIST_LABEL = "Висновок Project Health (без змін):";

const COORDINATOR_WITHHELD_NOTICE =
  "ℹ️ Джонік також сформував власний текст у цьому ході, але з подій не можна довести, що він не " +
  "переказує й не суперечить висновку Project Health вище, тому його приховано. Чинний лише цей " +
  "висновок. Якщо ви просили ще щось окреме (наприклад, план дня), надішліть це окремим повідомленням.";

/** The labelled specialist block appended to a deterministic mutation message (never the model's text). */
export function specialistBlockForError(specialist: string): string {
  return `${SECTION_BREAK}${SPECIALIST_LABEL}\n${specialist}`;
}

/**
 * What the caller may be shown for a turn holding one VERIFIED specialist result `specialist`
 * (see `SpecialistTurnProvenance.verdict`), the coordinator's own text `coordinatorReply` and — for
 * a turn with Trello writes — the system-owned mutation reply `systemReply` (#31/#23).
 *
 * The event surface proves which string the specialist produced, but a primary-stream
 * `agent.message` has no provenance at all, so NOTHING can separate a coordinator REWRITE of that
 * string (Haiku reinterpreting a correct Sonnet judgement — the accepted #28 failure) from a
 * coordinator's independently requested output (a daily plan, another answer). Guessing either way
 * would need an intent/prose parser, so the fail-safe keeps the accepted #28 authority and is
 * loud about the price:
 *  - the verified specialist string is the Project Health answer, byte for byte, and is always shown;
 *  - coordinator text that is empty or EXACTLY the specialist string adds nothing to withhold
 *    (`specialist_only` / `exact` — the accepted #28 relay, no notice);
 *  - any other coordinator text is NOT shown (`coordinator_withheld`); a fixed notice tells the user
 *    it was withheld and why, and to re-ask any separate request in its own message. Never silent.
 * A turn with Trello writes leads with `systemReply` (the verified/failed mutation outcome derived
 * from tool events), then the specialist block, then the notice when applicable.
 */
export function composeWithSpecialist(
  coordinatorReply: string,
  specialist: string,
  systemReply: string | null,
): { text: string; mode: SpecialistCompositionMode } {
  const mode: SpecialistCompositionMode =
    coordinatorReply === "" ? "specialist_only" : coordinatorReply === specialist ? "exact" : "coordinator_withheld";
  const notice = mode === "coordinator_withheld" ? `${SECTION_BREAK}${COORDINATOR_WITHHELD_NOTICE}` : "";
  const body = systemReply === null ? specialist : `${systemReply}${specialistBlockForError(specialist)}`;
  return { text: `${body}${notice}`, mode };
}
