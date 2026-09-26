import { formatLocalTime, parseLocalTime, RHYTHM_TIME_ZONE, type IsoWeekday, type LocalMinutes, type RhythmConfig } from "./rhythmConfig.js";
import { addLocalDays, isQuietTime, kyivLocal, localDaysBetween, ritualsForDate, weekdayOfLocalDate, WEEKDAY_UK, type RitualKind } from "./rhythmSchedule.js";

/**
 * Reminder date/time authority (#54). Claude passes Daniel's day/time words as a small structured `when`; this
 * module — never the model — turns them into one Europe/Kyiv calendar decision and one delivery instant, on the
 * #39/#41 calendar primitives (`rhythmSchedule.ts`: DST-safe, independent of the machine's time zone). Pure: the
 * caller supplies `now` and the Working Rhythm config (quiet hours, morning time).
 *
 * Semantics (each covered by `reminderTime.test.ts`):
 * - `today` / `tomorrow` / `day_after_tomorrow`: Kyiv calendar days from today.
 * - `weekday` ("в понеділок"): the NEAREST such weekday strictly after today (1–7 days; on a Monday "в
 *   понеділок" is next Monday — today is `today`). `next_week: true` ("наступного тижня в понеділок"): that
 *   weekday inside the next ISO week (Mon–Sun).
 * - `date`: `DD.MM` (the next such date from today: this year, else next year), `DD.MM.YYYY` or `YYYY-MM-DD`.
 * - `time` only ("о 15:00"): today at that time, or — when it has already passed — tomorrow at that time; the
 *   result says it rolled over, so the confirmation shows the real day.
 * - an explicit day with a time already past, or a date before today: refused (`in_past`), never guessed.
 * - a day without a time: a MORNING reminder, surfaced in that day's morning ritual (Monday plan / brief /
 *   Friday morning) or, when none runs, as its own message at the morning time. Today without a time after the
 *   morning slot is refused (`needs_time`): there is no "morning" left to put it in.
 * - `in_minutes` ("через годину"): now plus that many minutes; it cannot be combined with a day or time.
 * - quiet hours (default 20:00–09:30): a moment inside them is delivered at their END — the same morning for
 *   an early hour, the next morning for an evening hour. The requested and the scheduled moments are both kept.
 * - DST: a local time is converted with the offset Kyiv actually has on that date. A time that does not exist
 *   (spring-forward gap) moves forward by the gap; a time that occurs twice (fall-back) takes the first one.
 */

export type ReminderDayKind = "today" | "tomorrow" | "day_after_tomorrow" | "weekday" | "date";
export type WeekdayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAY_CODES: Record<WeekdayCode, IsoWeekday> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** What Claude understood from Daniel's words — never a computed date. */
export interface ReminderWhen {
  day?: ReminderDayKind;
  weekday?: WeekdayCode;
  next_week?: boolean;
  /** Daniel's literal date: `DD.MM`, `DD.MM.YYYY` or `YYYY-MM-DD`. */
  date?: string;
  /** `HH:MM` (Kyiv). */
  time?: string;
  in_minutes?: number;
}

export type ReminderMode = "timed" | "morning";

/** Where a morning reminder is expected to surface (a hint for the confirmation; delivery never depends on it). */
export type MorningSurface = "monday_plan" | "morning_brief" | "friday_morning" | "separate_message";

/** The authoritative resolution stored with the reminder and returned to the model. */
export interface ReminderSchedule {
  mode: ReminderMode;
  /** What Daniel asked for, resolved: the Kyiv date and (timed only) the local time before any quiet shift. */
  requested: { date: string; time: string | null };
  /** When delivery is due: Kyiv date/time and the exact instant (ISO, UTC). */
  date: string;
  time: string;
  dueAt: string;
  /** A timed request moved out of quiet hours. */
  quietShifted: boolean;
  /** Time-only request whose time had passed today → tomorrow. */
  rolledToTomorrow: boolean;
  /** Quiet hours as applied at resolution (kept so a late delivery respects the same window). */
  quietHours: { start: LocalMinutes; end: LocalMinutes };
  surface?: MorningSurface;
}

export type ReminderTimeProblem =
  | "missing_when"
  | "invalid_when"
  | "invalid_date"
  | "invalid_time"
  | "in_past"
  | "needs_time"
  | "too_far";

export class ReminderTimeError extends Error {
  constructor(readonly problem: ReminderTimeProblem) {
    super(problem);
    this.name = "ReminderTimeError";
  }
}

/** Farthest a reminder may be scheduled. */
export const MAX_REMINDER_HORIZON_DAYS = 366;
/** Longest `in_minutes` (one week). */
export const MAX_IN_MINUTES = 7 * 24 * 60;
/** Morning time when the config names none (the default brief time). */
export const DEFAULT_MORNING_MINUTES: LocalMinutes = 9 * 60 + 30;

const MORNING_RITUALS: ReadonlySet<RitualKind> = new Set(["monday-plan", "morning", "friday-morning"]);
const SURFACE_BY_RITUAL: Partial<Record<RitualKind, MorningSurface>> = {
  "monday-plan": "monday_plan",
  morning: "morning_brief",
  "friday-morning": "friday_morning",
};

// --- Kyiv local time → instant ------------------------------------------------------------------------

function sameLocal(instant: number, date: string, minutes: LocalMinutes): boolean {
  const local = kyivLocal(new Date(instant));
  return local.date === date && local.minutes === minutes;
}

/** Kyiv UTC offset (ms) at `instant`, from `Intl` — never hard-coded. */
function kyivOffsetAt(instant: number): number {
  const local = kyivLocal(new Date(instant));
  const [y, m, d] = local.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(local.minutes / 60), local.minutes % 60);
  const floored = Math.floor(instant / 60_000) * 60_000;
  return asUtc - floored;
}

/**
 * The instant of a Kyiv wall-clock minute. Candidates use the offsets in force 12 h before and after, which
 * covers both DST transitions: two valid candidates (fall-back overlap) → the earlier; none (spring-forward gap)
 * → the pre-transition offset, i.e. the time moved forward by the gap.
 */
export function kyivLocalToInstant(date: string, minutes: LocalMinutes): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const before = wanted - kyivOffsetAt(wanted - 12 * 3_600_000);
  const after = wanted - kyivOffsetAt(wanted + 12 * 3_600_000);
  const valid = [before, after].filter((candidate) => sameLocal(candidate, date, minutes));
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(before);
}

// --- Parsing ----------------------------------------------------------------------------------------

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Daniel's literal date → a Kyiv calendar date. `DD.MM` without a year is the next such date from `today`. */
export function parseReminderDate(value: string, today: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isValidCalendarDate(y, m, d)) throw new ReminderTimeError("invalid_date");
    return isoDate(y, m, d);
  }
  const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?$/.exec(text);
  if (!dotted) throw new ReminderTimeError("invalid_date");
  const [d, m] = [Number(dotted[1]), Number(dotted[2])];
  if (dotted[3] !== undefined) {
    const y = Number(dotted[3]);
    if (!isValidCalendarDate(y, m, d)) throw new ReminderTimeError("invalid_date");
    return isoDate(y, m, d);
  }
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1, year + 2, year + 3, year + 4]) {
    // 29.02 without a year: the next leap year that is still ahead.
    if (!isValidCalendarDate(y, m, d)) continue;
    const candidate = isoDate(y, m, d);
    if (candidate >= today) return candidate;
  }
  throw new ReminderTimeError("invalid_date");
}

/** `HH:MM` / `H:MM` / `HH` (Kyiv). */
export function parseReminderTime(value: string): LocalMinutes {
  const text = value.trim();
  const minutes = /^\d{1,2}$/.test(text) ? parseLocalTime(`${text}:00`) : parseLocalTime(text);
  if (minutes === null) throw new ReminderTimeError("invalid_time");
  return minutes;
}

// --- Resolution -------------------------------------------------------------------------------------

/** The morning ritual that owns a date-only reminder on `date` under `config`, if one runs that day. */
export function morningRitualFor(date: string, config: RhythmConfig): { kind: RitualKind; key: string; minutes: LocalMinutes } | null {
  const ritual = ritualsForDate(date, config).find((occurrence) => MORNING_RITUALS.has(occurrence.kind));
  return ritual ? { kind: ritual.kind, key: ritual.key, minutes: ritual.scheduledMinutes } : null;
}

/** Morning slot of `date`: that day's morning ritual time, else the configured (or default) morning time, never
 *  inside quiet hours. */
export function morningMinutesFor(date: string, config: RhythmConfig): LocalMinutes {
  const minutes = morningRitualFor(date, config)?.minutes ?? config.morning ?? DEFAULT_MORNING_MINUTES;
  return isQuietTime(minutes, config.quietHours) ? config.quietHours.end : minutes;
}

/** Moves a Kyiv moment out of quiet hours to their end (same morning for early hours, next morning otherwise). */
export function shiftOutOfQuiet(date: string, minutes: LocalMinutes, quiet: RhythmConfig["quietHours"]): { date: string; minutes: LocalMinutes; shifted: boolean } {
  if (!isQuietTime(minutes, quiet)) return { date, minutes, shifted: false };
  const wraps = quiet.start > quiet.end;
  const nextDay = wraps && minutes >= quiet.start;
  return { date: nextDay ? addLocalDays(date, 1) : date, minutes: quiet.end, shifted: true };
}

function resolveDay(when: ReminderWhen, today: string, todayWeekday: IsoWeekday): string | null {
  switch (when.day) {
    case undefined:
      return null;
    case "today":
      return today;
    case "tomorrow":
      return addLocalDays(today, 1);
    case "day_after_tomorrow":
      return addLocalDays(today, 2);
    case "weekday": {
      const target = when.weekday ? WEEKDAY_CODES[when.weekday] : undefined;
      if (target === undefined) throw new ReminderTimeError("invalid_when");
      if (when.next_week === true) return addLocalDays(today, 7 - (todayWeekday - 1) + (target - 1));
      const ahead = ((target - todayWeekday + 7) % 7) || 7;
      return addLocalDays(today, ahead);
    }
    case "date":
      if (typeof when.date !== "string") throw new ReminderTimeError("invalid_when");
      return parseReminderDate(when.date, today);
    default:
      throw new ReminderTimeError("invalid_when");
  }
}

function checkHorizon(dueAt: Date, now: Date): void {
  if (dueAt.getTime() - now.getTime() > MAX_REMINDER_HORIZON_DAYS * 86_400_000) throw new ReminderTimeError("too_far");
}

function timedSchedule(requestedDate: string, requestedMinutes: LocalMinutes, config: RhythmConfig, rolled: boolean): ReminderSchedule {
  const shifted = shiftOutOfQuiet(requestedDate, requestedMinutes, config.quietHours);
  return {
    mode: "timed",
    requested: { date: requestedDate, time: formatLocalTime(requestedMinutes) },
    date: shifted.date,
    time: formatLocalTime(shifted.minutes),
    dueAt: kyivLocalToInstant(shifted.date, shifted.minutes).toISOString(),
    quietShifted: shifted.shifted,
    rolledToTomorrow: rolled,
    quietHours: { ...config.quietHours },
  };
}

/**
 * `when` → the authoritative schedule, or a `ReminderTimeError` naming what Claude should ask Daniel.
 * `ritualsRunning` says whether the Working Rhythm currently owns morning rituals (only the surface hint).
 */
export function resolveReminderWhen(when: ReminderWhen, now: Date, config: RhythmConfig, ritualsRunning = true): ReminderSchedule {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid current time.");
  const local = kyivLocal(now);

  if (when.in_minutes !== undefined) {
    if (when.day !== undefined || when.time !== undefined || when.date !== undefined || when.weekday !== undefined) {
      throw new ReminderTimeError("invalid_when");
    }
    if (!Number.isInteger(when.in_minutes) || when.in_minutes < 1 || when.in_minutes > MAX_IN_MINUTES) throw new ReminderTimeError("invalid_when");
    // Whole minutes: the requested moment is the next minute boundary at or after now + N.
    const target = kyivLocal(new Date(Math.ceil((now.getTime() + when.in_minutes * 60_000) / 60_000) * 60_000));
    return timedSchedule(target.date, target.minutes, config, false);
  }

  const day = resolveDay(when, local.date, local.weekday);
  if (day === null && when.time === undefined) throw new ReminderTimeError("missing_when");
  if (day !== null && day < local.date) throw new ReminderTimeError("in_past");

  if (when.time !== undefined) {
    const minutes = parseReminderTime(when.time);
    let date = day ?? local.date;
    let rolled = false;
    if (kyivLocalToInstant(date, minutes).getTime() <= now.getTime()) {
      if (day !== null) throw new ReminderTimeError("in_past");
      date = addLocalDays(date, 1);
      rolled = true;
    }
    const schedule = timedSchedule(date, minutes, config, rolled);
    checkHorizon(new Date(schedule.dueAt), now);
    return schedule;
  }

  // Date only: that day's morning.
  const date = day!;
  const minutes = morningMinutesFor(date, config);
  if (date === local.date && local.minutes >= minutes) throw new ReminderTimeError("needs_time");
  const ritual = ritualsRunning ? morningRitualFor(date, config) : null;
  const dueAt = kyivLocalToInstant(date, minutes);
  checkHorizon(dueAt, now);
  return {
    mode: "morning",
    requested: { date, time: null },
    date,
    time: formatLocalTime(minutes),
    dueAt: dueAt.toISOString(),
    quietShifted: false,
    rolledToTomorrow: false,
    quietHours: { ...config.quietHours },
    surface: ritual ? SURFACE_BY_RITUAL[ritual.kind] : "separate_message",
  };
}

// --- Labels (code-owned wording of resolved dates) ---------------------------------------------------

function dayMonth(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}.${month}`;
}

/** e.g. `пн 28.09`, prefixed with `сьогодні` / `завтра` / `післязавтра` relative to `now`. */
export function dayLabel(date: string, now: Date): string {
  const base = `${WEEKDAY_UK[weekdayOfLocalDate(date)]} ${dayMonth(date)}`;
  const ahead = localDaysBetween(kyivLocal(now).date, date);
  const relative = ahead === 0 ? "сьогодні" : ahead === 1 ? "завтра" : ahead === 2 ? "післязавтра" : null;
  return relative ? `${relative}, ${base}` : base;
}

const SURFACE_LABEL: Record<MorningSurface, string> = {
  monday_plan: "у плані тижня",
  morning_brief: "у ранковому брифі",
  friday_morning: "у пʼятничному ранковому повідомленні",
  separate_message: "окремим повідомленням",
};

/** e.g. `завтра, вт 29.09 о 15:00` or `пн 28.09 зранку, у плані тижня`. */
export function scheduleLabel(schedule: Pick<ReminderSchedule, "mode" | "date" | "time" | "surface">, now: Date): string {
  if (schedule.mode === "timed") return `${dayLabel(schedule.date, now)} о ${schedule.time}`;
  const surface = schedule.surface ? `, ${SURFACE_LABEL[schedule.surface]}` : "";
  return `${dayLabel(schedule.date, now)} зранку${surface}`;
}

export const REMINDER_TIME_ZONE = RHYTHM_TIME_ZONE;
