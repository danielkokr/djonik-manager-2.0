import { RHYTHM_TIME_ZONE, type IsoWeekday, type LocalMinutes, type RhythmConfig } from "./rhythmConfig.js";

/**
 * Deterministic Working Rhythm schedule (#39): for a supplied instant, which ritual occurrences are
 * due, and whether it is quiet time. Pure — no clock, timer or process-local state. All local time is
 * Europe/Kyiv via `Intl`, so results never depend on the machine's own time zone, including across
 * Ukraine's DST transitions.
 */

export interface KyivLocal {
  /** Kyiv calendar date, YYYY-MM-DD. */
  date: string;
  weekday: IsoWeekday;
  minutes: LocalMinutes;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: RHYTHM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS: Record<string, IsoWeekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function kyivLocal(instant: Date): KyivLocal {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid instant.");
  const parts = Object.fromEntries(PARTS.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Adds calendar days to a Kyiv date string (calendar arithmetic, no time zone involved). */
export function addLocalDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function weekdayOfLocalDate(date: string): IsoWeekday {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/** Whole Kyiv calendar days from `from` to `to` (negative when `to` is earlier). */
export function localDaysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Configured workdays strictly after `from` up to and including `to` (0 when `to` <= `from`). */
export function workdaysBetween(from: string, to: string, workdays: readonly IsoWeekday[]): number {
  let count = 0;
  for (let date = addLocalDays(from, 1); date <= to; date = addLocalDays(date, 1)) {
    if (workdays.includes(weekdayOfLocalDate(date))) count += 1;
  }
  return count;
}

export function nextWorkday(from: string, workdays: readonly IsoWeekday[]): string {
  if (workdays.length === 0) return addLocalDays(from, 1);
  let date = addLocalDays(from, 1);
  while (!workdays.includes(weekdayOfLocalDate(date))) date = addLocalDays(date, 1);
  return date;
}

/** Quiet hours may wrap midnight (default 20:00–09:30). Start inclusive, end exclusive. */
export function isQuietTime(minutes: LocalMinutes, quiet: RhythmConfig["quietHours"]): boolean {
  return quiet.start < quiet.end
    ? minutes >= quiet.start && minutes < quiet.end
    : minutes >= quiet.start || minutes < quiet.end;
}

export type RitualKind = "monday-plan" | "morning" | "friday-morning" | "friday-review" | "evening";

export interface RitualOccurrence {
  kind: RitualKind;
  /** Stable idempotency identity, e.g. `morning:2026-09-29`. Independent of process time. */
  key: string;
  date: string;
  scheduledMinutes: LocalMinutes;
}

/**
 * How long after its scheduled minute a ritual is still worth sending when a tick arrives late
 * (restart, slow previous turn). After it, the occurrence is expired, never sent late.
 */
export const RITUAL_GRACE_MINUTES: Record<RitualKind, number> = {
  "monday-plan": 150,
  morning: 150,
  "friday-morning": 150,
  "friday-review": 120,
  evening: 60,
};

/**
 * The ritual occurrences of one Kyiv date. Monday: the week plan replaces the brief (normal brief
 * only when the plan is switched off). Friday: the lighter Friday brief (nothing in the morning when
 * it is off) plus the afternoon review. Non-workdays: nothing.
 */
export function ritualsForDate(date: string, config: RhythmConfig): RitualOccurrence[] {
  const weekday = weekdayOfLocalDate(date);
  if (!config.enabled || !config.workdays.includes(weekday)) return [];
  const out: RitualOccurrence[] = [];
  const add = (kind: RitualKind, minutes: LocalMinutes | null) => {
    if (minutes !== null) out.push({ kind, key: `${kind}:${date}`, date, scheduledMinutes: minutes });
  };
  if (weekday === 1) {
    if (config.mondayPlan !== null) add("monday-plan", config.mondayPlan);
    else add("morning", config.morning);
  } else if (weekday === 5) {
    add("friday-morning", config.fridayMorning);
    add("friday-review", config.fridayReview);
  } else {
    add("morning", config.morning);
  }
  add("evening", config.evening);
  return out.sort((a, b) => a.scheduledMinutes - b.scheduledMinutes);
}

export type RitualStatus = "not_yet" | "due" | "expired";

export interface EvaluatedRitual extends RitualOccurrence {
  status: RitualStatus;
}

/** Status of each of today's rituals at `now`. Only `due` occurrences may be sent. */
export function evaluateRituals(now: Date, config: RhythmConfig): EvaluatedRitual[] {
  const local = kyivLocal(now);
  return ritualsForDate(local.date, config).map((ritual) => {
    const lateBy = local.minutes - ritual.scheduledMinutes;
    let status: RitualStatus = lateBy < 0 ? "not_yet" : lateBy < RITUAL_GRACE_MINUTES[ritual.kind] ? "due" : "expired";
    // A late ritual never spills into quiet hours unless it was itself scheduled inside them.
    if (
      status === "due" &&
      lateBy > 0 &&
      isQuietTime(local.minutes, config.quietHours) &&
      !isQuietTime(ritual.scheduledMinutes, config.quietHours)
    ) {
      status = "expired";
    }
    return { ...ritual, status };
  });
}
