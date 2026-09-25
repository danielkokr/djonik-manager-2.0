import type { RhythmConfig, RhythmMute } from "./rhythmConfig.js";
import { addLocalDays, isQuietTime, kyivLocal, localDaysBetween, nextWorkday, workdaysBetween } from "./rhythmSchedule.js";

/**
 * Deterministic Working Rhythm signals (#39). Small pure functions, not a PM rules engine:
 *
 *   detect → classify (ritual observation vs interrupt candidate) → lifecycle (no repeat of
 *   unchanged facts, mutes, resolution) → selection limits (quiet hours, weekends, daily caps,
 *   spacing, grouping) → only then may Claude judge SEND/SILENT and phrase a message.
 *
 * Detection is never permission to message Daniel. Most signals are ritual observations: hints for
 * the next brief/review, which Claude composes from fresh Trello anyway. Only a narrow set of
 * time-critical facts become interrupt candidates, and even they pass every limit first.
 */

/** Board-list role, mapped from the live list name by the (future) fact collector. */
export type ListRole = "backlog" | "todo" | "in_progress" | "waiting" | "done" | "other";

export interface CardFact {
  id: string;
  name: string;
  /** Project slug from the card's project label, or null when unlabelled. */
  project: string | null;
  list: ListRole;
  /** RFC3339 due instant, or null. A due is not automatically a hard client commitment. */
  due: string | null;
  dueComplete: boolean;
  /** When the card entered its current list (Trello action history), or null when unknown. */
  enteredListAt: string | null;
  /** Most recent move out of Done (Trello action history), or null. */
  reopenedFromDoneAt: string | null;
}

export interface ProjectFact {
  project: string;
  /** From Daniel's accepted priorities; only high/medium projects can be stale-flagged. */
  priority: "high" | "medium" | "low";
  /** Latest real board movement for the project (history), or null when unknown. */
  lastMovementAt: string | null;
}

/** A follow-up date Daniel accepted. Supplied by whoever reads it; this module never reads Memory. */
export interface FollowUpCheckFact {
  id: string;
  project: string | null;
  /** YYYY-MM-DD, Kyiv. */
  nextCheck: string;
  status: "active" | "waiting" | "resolved" | "cancelled";
}

export interface SignalFacts {
  cards: CardFact[];
  projects: ProjectFact[];
  followUps: FollowUpCheckFact[];
}

export type SignalKind =
  | "due_soon"
  | "due_tomorrow_not_started"
  | "overdue"
  | "newly_overdue"
  | "waiting_long"
  | "stale_project"
  | "in_progress_over"
  | "deadline_collision"
  | "follow_up_due"
  | "reopened_from_done";

/** `ritual`: collected for the next brief/review only. `interrupt`: may be considered for an exception. */
export type SignalChannel = "ritual" | "interrupt";
export type SignalSeverity = "low" | "medium" | "high";

export interface Signal {
  /** Stable identity of the situation, e.g. `overdue:<cardId>`. */
  key: string;
  kind: SignalKind;
  channel: SignalChannel;
  severity: SignalSeverity;
  /** The material fact; a change makes the same key a new occurrence (e.g. a re-dated due). */
  fingerprint: string;
  project: string | null;
  /** Content-light reference for the prompt (card name or project), never a Trello mutation target. */
  subject: string;
  /** Short factual hint for Claude; wording of the actual message stays Claude's. */
  fact: string;
}

/** `<key>@<fingerprint>`: what a "не нагадуй про це" mute names for one exact occurrence. */
export function occurrenceHandle(signal: Pick<Signal, "key" | "fingerprint">): string {
  return `${signal.key}@${signal.fingerprint}`;
}

const HOUR = 3_600_000;

function localDateOf(instant: string): string | null {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : kyivLocal(date).date;
}

function daysSince(instant: string | null, now: Date): number | null {
  if (!instant) return null;
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  return Math.floor((now.getTime() - at.getTime()) / 86_400_000);
}

/** Open, not-finished work: excludes Done and completed dues. */
function isOpen(card: CardFact): boolean {
  return card.list !== "done" && !card.dueComplete;
}

/** Not started means it has not reached In progress (and is not parked on someone else). */
function isNotStarted(card: CardFact): boolean {
  return card.list === "backlog" || card.list === "todo" || card.list === "other";
}

/**
 * Detects and classifies signals from supplied facts at `now`. Pure and deterministic. Interrupt
 * candidates are deliberately narrow:
 *   - due tomorrow (next workday) and materially not started;
 *   - newly overdue (due passed within the last 24 h) and still open, not parked in Waiting;
 *   - a real deadline collision today or on the next workday.
 * Everything else — due soon, older overdue, Waiting, stale projects, In progress load, follow-up
 * dates, reopened work — is a ritual observation for the next brief/review.
 */
export function detectSignals(facts: SignalFacts, now: Date, config: RhythmConfig): Signal[] {
  const { thresholds, workdays } = config;
  const today = kyivLocal(now).date;
  const tomorrowWork = nextWorkday(today, workdays);
  const signals: Signal[] = [];

  for (const card of facts.cards) {
    const base = { project: card.project, subject: card.name };
    if (isOpen(card) && card.due) {
      const dueAt = new Date(card.due);
      const dueDate = localDateOf(card.due);
      if (dueDate !== null) {
        if (dueAt.getTime() <= now.getTime()) {
          const newly = now.getTime() - dueAt.getTime() < 24 * HOUR && card.list !== "waiting";
          signals.push({
            ...base,
            key: `overdue:${card.id}`,
            kind: newly ? "newly_overdue" : "overdue",
            channel: newly ? "interrupt" : "ritual",
            severity: newly ? "high" : "medium",
            fingerprint: card.due,
            fact: `due ${dueDate} минув, картка не в Done`,
          });
        } else if (dueDate === tomorrowWork && isNotStarted(card)) {
          signals.push({
            ...base,
            key: `due-tomorrow:${card.id}`,
            kind: "due_tomorrow_not_started",
            channel: "interrupt",
            severity: "medium",
            fingerprint: `${card.due}|${card.list}`,
            fact: `due ${dueDate} (наступний робочий день), ще не в роботі`,
          });
        } else if (
          card.list !== "in_progress" &&
          card.list !== "waiting" &&
          dueDate >= today &&
          // N workdays never span more than 7N calendar days (at least one workday per week), so a far
          // due date is rejected before the day-by-day count.
          localDaysBetween(today, dueDate) <= thresholds.dueSoonWorkdays * 7 &&
          workdaysBetween(today, dueDate, workdays) <= thresholds.dueSoonWorkdays
        ) {
          signals.push({
            ...base,
            key: `due-soon:${card.id}`,
            kind: "due_soon",
            channel: "ritual",
            severity: "medium",
            fingerprint: card.due,
            fact: `due ${dueDate}, ще не в роботі`,
          });
        }
      }
    }

    if (card.list === "waiting") {
      const days = daysSince(card.enteredListAt, now);
      if (days !== null && days >= thresholds.waitingDays) {
        signals.push({
          ...base,
          key: `waiting:${card.id}`,
          kind: "waiting_long",
          channel: "ritual",
          severity: "medium",
          // Same Waiting stint = same fact; a new stint (re-entered) is a new occurrence.
          fingerprint: card.enteredListAt!,
          fact: `у Waiting ${days} дн. (waiting ≠ blocked)`,
        });
      }
    }

    if (card.reopenedFromDoneAt && card.list !== "done") {
      const days = daysSince(card.reopenedFromDoneAt, now);
      if (days !== null && days <= 7) {
        signals.push({
          ...base,
          key: `reopened:${card.id}`,
          kind: "reopened_from_done",
          channel: "ritual",
          severity: "low",
          fingerprint: card.reopenedFromDoneAt,
          fact: "повернулась із Done цього тижня",
        });
      }
    }
  }

  const inProgress = facts.cards.filter((card) => card.list === "in_progress");
  if (inProgress.length > thresholds.inProgressMax) {
    signals.push({
      key: "workload:in-progress",
      kind: "in_progress_over",
      channel: "ritual",
      severity: "medium",
      fingerprint: String(inProgress.length),
      project: null,
      subject: "In progress",
      fact: `${inProgress.length} карток в In progress (поріг ${thresholds.inProgressMax})`,
    });
  }

  // Collision: two or more open, not-Waiting cards due on the same day, today or the next workday.
  // A collision further out is ordinary workload for the brief, not an interruption.
  const byDate = new Map<string, CardFact[]>();
  for (const card of facts.cards) {
    if (!isOpen(card) || card.list === "waiting" || !card.due) continue;
    if (new Date(card.due).getTime() <= now.getTime()) continue;
    const dueDate = localDateOf(card.due);
    if (dueDate === null || dueDate > addLocalDays(today, 14)) continue;
    byDate.set(dueDate, [...(byDate.get(dueDate) ?? []), card]);
  }
  for (const [date, cards] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (cards.length < 2) continue;
    const near = date === today || date === tomorrowWork;
    const ids = cards.map((card) => card.id).sort();
    signals.push({
      key: `collision:${date}`,
      kind: "deadline_collision",
      channel: near ? "interrupt" : "ritual",
      severity: date === today ? "high" : "medium",
      fingerprint: ids.join(","),
      project: null,
      subject: cards.map((card) => card.name).join(" / "),
      fact: `${cards.length} дедлайни на ${date}`,
    });
  }

  for (const project of facts.projects) {
    if (project.priority === "low") continue;
    const days = daysSince(project.lastMovementAt, now);
    if (days !== null && days >= thresholds.staleProjectDays) {
      signals.push({
        key: `stale-project:${project.project}`,
        kind: "stale_project",
        channel: "ritual",
        severity: "medium",
        fingerprint: project.lastMovementAt!,
        project: project.project,
        subject: project.project,
        fact: `без руху на дошці ${days} дн.`,
      });
    }
  }

  // A follow-up date is morning-brief material: a date-only check never triggers a mid-day ping.
  for (const followUp of facts.followUps) {
    if (followUp.status !== "active" && followUp.status !== "waiting") continue;
    if (localDaysBetween(followUp.nextCheck, today) < 0) continue;
    signals.push({
      key: `follow-up:${followUp.id}`,
      kind: "follow_up_due",
      channel: "ritual",
      severity: "medium",
      fingerprint: followUp.nextCheck,
      project: followUp.project,
      subject: followUp.id,
      fact: `дата перевірки ${followUp.nextCheck} настала`,
    });
  }

  return signals;
}

// --- Mutes ----------------------------------------------------------------------------------------

/**
 * Whether a mute from `/rhythm.md` covers this signal on `today`. Targets: the exact occurrence
 * handle (a changed fact is a new occurrence, so it is not covered), the signal key (all future
 * states), `project:<slug>` or `kind:<kind>`.
 */
export function isMuted(signal: Signal, mutes: readonly RhythmMute[], today: string): boolean {
  return mutes.some((mute) => {
    if (mute.until !== null && mute.until < today) return false;
    return (
      mute.target === occurrenceHandle(signal) ||
      mute.target === signal.key ||
      (signal.project !== null && mute.target === `project:${signal.project}`) ||
      mute.target === `kind:${signal.kind}`
    );
  });
}

// --- Lifecycle --------------------------------------------------------------------------------------

/**
 * `open`: current, not yet raised by an exception. `notified`: raised by a delivered exception.
 * `evaluated`: Claude saw it as an exception candidate and chose SILENT. Both of the latter prevent
 * a repeat while the fingerprint is unchanged. An exception that ended without delivery (failed turn, empty
 * reply, Telegram refused twice) leaves its signals `open` with `failedOn` = that Kyiv date: not reconsidered
 * the same day (no regrouping loop), but a later day may raise it again under the ordinary limits. `resolved`: the fact is gone. Suppression is not a
 * stored status: it is derived from `/rhythm.md` mutes on every evaluation, so a stale suppression can
 * never outlive the mute that caused it.
 */
export type SignalStatus = "open" | "notified" | "evaluated" | "resolved";

export interface SignalRecord {
  key: string;
  status: SignalStatus;
  fingerprint: string;
  firstSeenAt: string;
  lastChangedAt: string;
  notifiedAt?: string;
  resolvedAt?: string;
  /** Kyiv date an exception carrying this occurrence ended without delivery; blocks it for that day only. */
  failedOn?: string;
}

export type SignalLedger = Record<string, SignalRecord>;

const RESOLVED_RETENTION_DAYS = 14;

/**
 * Advances the per-key lifecycle with the current detection. A new key or a changed fingerprint
 * (re-dated due, re-entered Waiting, card reopened) starts a fresh `open` occurrence; an unchanged
 * one keeps its status; a key no longer detected becomes `resolved`. Returns a new ledger.
 */
export function advanceSignalLedger(previous: SignalLedger, signals: readonly Signal[], now: Date): SignalLedger {
  const at = now.toISOString();
  const next: SignalLedger = {};
  const current = new Set<string>();
  for (const signal of signals) {
    current.add(signal.key);
    const prior = previous[signal.key];
    if (prior && prior.status !== "resolved" && prior.fingerprint === signal.fingerprint) {
      next[signal.key] = { ...prior };
    } else {
      next[signal.key] = { key: signal.key, status: "open", fingerprint: signal.fingerprint, firstSeenAt: at, lastChangedAt: at };
    }
  }
  for (const [key, prior] of Object.entries(previous)) {
    if (current.has(key)) continue;
    if (prior.status === "resolved") {
      if ((daysSince(prior.resolvedAt ?? null, now) ?? 0) <= RESOLVED_RETENTION_DAYS) next[key] = { ...prior };
      continue;
    }
    next[key] = { ...prior, status: "resolved", resolvedAt: at, lastChangedAt: at };
  }
  return next;
}

/** Marks the given signals' current occurrences as raised (`notified`) or silently judged (`evaluated`). */
export function markSignals(ledger: SignalLedger, signals: readonly Signal[], status: "notified" | "evaluated", now: Date): SignalLedger {
  const next = { ...ledger };
  for (const signal of signals) {
    const record = next[signal.key];
    if (!record || record.fingerprint !== signal.fingerprint) continue;
    next[signal.key] = { ...record, status, lastChangedAt: now.toISOString(), ...(status === "notified" ? { notifiedAt: now.toISOString() } : {}) };
  }
  return next;
}

/** An undelivered, non-ambiguous exception: its signals stay `open` but wait until another Kyiv day. */
export function markExceptionFailed(ledger: SignalLedger, signals: readonly Signal[], now: Date): SignalLedger {
  const next = { ...ledger };
  const today = kyivLocal(now).date;
  for (const signal of signals) {
    const record = next[signal.key];
    if (!record || record.fingerprint !== signal.fingerprint || record.status !== "open") continue;
    next[signal.key] = { ...record, failedOn: today, lastChangedAt: now.toISOString() };
  }
  return next;
}

// --- Selection limits ------------------------------------------------------------------------------

/** Unsolicited exception deliveries already made (confirmed sent) — rituals never count. */
export interface ExceptionHistoryEntry {
  sentAt: string;
  severity: SignalSeverity;
}

export interface ExceptionSelectionInput {
  now: Date;
  config: RhythmConfig;
  signals: readonly Signal[];
  ledger: SignalLedger;
  /** Confirmed exception deliveries (any day; filtered to today here). */
  exceptionsSent: readonly ExceptionHistoryEntry[];
  /** Latest ritual delivery today, if any: facts known before it belonged to that ritual. */
  lastRitualSentAt: string | null;
  /** Any exception occurrence that is in flight or ambiguous blocks another one (no blind resend). */
  exceptionInFlight: boolean;
  /**
   * Minutes until the next ritual still to come TODAY (Kyiv), or null when none remains. A ritual carries
   * every non-muted signal (`ritualObservations`), so a candidate it can reasonably carry waits for it.
   */
  minutesToNextRitual?: number | null;
}

export type ExceptionDecision =
  | { decision: "none"; reason: string }
  | { decision: "defer"; reason: string }
  | { decision: "consider"; signals: Signal[]; severity: SignalSeverity; ordinal: number };

/** At most this many signals are grouped into one exception message. */
export const MAX_SIGNALS_PER_EXCEPTION = 3;

const SEVERITY_RANK: Record<SignalSeverity, number> = { low: 0, medium: 1, high: 2 };

/**
 * Decides, before any model call, whether an exception may be considered now. The structure prefers
 * 0 over 1 over 2: no candidate → none; quiet hours / weekend / spacing → defer (the facts wait for
 * the next ritual, they are not queued into a burst); the first exception of the day needs at least
 * medium severity; a second needs a NEW high-severity candidate; never more than the absolute cap.
 *
 * Nearest-ritual merge: a candidate the next ritual can reasonably carry is not sent separately. Without
 * high severity it waits for any ritual still to come today; with high severity only for one within the
 * exception spacing (a separate message that close to a ritual would be a burst). There is no stored queue:
 * a deferred candidate stays `open` in the ledger and is re-detected from fresh facts on every later tick,
 * so a situation that resolved meanwhile is never raised, and one that persists is judged again as current.
 */
export function selectException(input: ExceptionSelectionInput): ExceptionDecision {
  const { now, config, ledger } = input;
  const { exceptions } = config;
  if (!config.enabled || !exceptions.enabled || exceptions.maxPerDay === 0) return { decision: "none", reason: "exceptions_off" };
  if (input.exceptionInFlight) return { decision: "none", reason: "exception_in_flight" };

  const local = kyivLocal(now);
  const today = local.date;
  const sentToday = input.exceptionsSent.filter((entry) => kyivLocal(new Date(entry.sentAt)).date === today);
  const lastSent = sentToday.map((entry) => entry.sentAt).sort().at(-1) ?? null;

  const candidates = input.signals.filter((signal) => {
    if (signal.channel !== "interrupt") return false;
    if (isMuted(signal, config.mutes, today)) return false;
    const record = ledger[signal.key];
    if (!record || record.fingerprint !== signal.fingerprint) return false;
    if (record.status !== "open") return false; // notified / evaluated: no repeat of an unchanged fact
    if (record.failedOn === today) return false; // an undelivered exception today: a later day may retry
    // Known before today's ritual → it was that ritual's material, not a reason to interrupt.
    if (input.lastRitualSentAt && record.firstSeenAt <= input.lastRitualSentAt) return false;
    return SEVERITY_RANK[signal.severity] >= SEVERITY_RANK.medium;
  });
  if (candidates.length === 0) return { decision: "none", reason: "no_candidate" };

  if (sentToday.length >= exceptions.maxPerDay) return { decision: "none", reason: "daily_max_reached" };

  let eligible = candidates;
  if (sentToday.length >= exceptions.preferredPerDay) {
    // Beyond the ordinary cap only a NEW high-severity situation (first seen after the last exception).
    eligible = candidates.filter(
      (signal) => signal.severity === "high" && (lastSent === null || ledger[signal.key].firstSeenAt > lastSent),
    );
    if (eligible.length === 0) return { decision: "none", reason: "preferred_cap_reached" };
  }

  const isWorkday = config.workdays.includes(local.weekday);
  if (!isWorkday) {
    if (!exceptions.weekends) return { decision: "defer", reason: "non_workday" };
    eligible = eligible.filter((signal) => signal.severity === "high");
    if (eligible.length === 0) return { decision: "defer", reason: "non_workday" };
  }
  if (isQuietTime(local.minutes, config.quietHours)) return { decision: "defer", reason: "quiet_hours" };
  if (lastSent !== null && now.getTime() - new Date(lastSent).getTime() < exceptions.spacingMinutes * 60_000) {
    return { decision: "defer", reason: "spacing" };
  }
  const toRitual = input.minutesToNextRitual ?? null;
  if (toRitual !== null && toRitual >= 0) {
    const urgent = eligible.some((signal) => signal.severity === "high");
    if (!urgent || toRitual <= exceptions.spacingMinutes) return { decision: "defer", reason: "next_ritual" };
  }

  const grouped = [...eligible]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.key.localeCompare(b.key))
    .slice(0, MAX_SIGNALS_PER_EXCEPTION);
  const severity = grouped.some((signal) => signal.severity === "high") ? "high" : "medium";
  return { decision: "consider", signals: grouped, severity, ordinal: sentToday.length + 1 };
}

/** Non-muted ritual material for a brief/review prompt (interrupt candidates included: rituals absorb them). */
export function ritualObservations(signals: readonly Signal[], config: RhythmConfig, now: Date): Signal[] {
  const today = kyivLocal(now).date;
  return signals.filter((signal) => !isMuted(signal, config.mutes, today));
}
