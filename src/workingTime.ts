import type { RhythmConfig } from "./rhythmConfig.js";
import { addLocalDays, kyivLocal, weekdayOfLocalDate } from "./rhythmSchedule.js";
import { kyivLocalInstant } from "./trelloWorkHistory.js";

/**
 * Daniel's configured working time (#50): the `work_hours` window of `/rhythm.md` on each configured workday,
 * Europe/Kyiv. Pure arithmetic shared by the timebox check and the weekly time report — no clock, no I/O.
 *
 * Window edges are Kyiv wall-clock minutes converted to instants per calendar date (`kyivLocalInstant`), so a
 * window keeps its local hours across a DST change and its length is real elapsed time. Without `work_hours`
 * there is no working time at all: callers must treat that as "unavailable", never as a guessed schedule.
 */

export interface WorkingWindow {
  /** Kyiv calendar date of the window. */
  date: string;
  /** Epoch milliseconds, `start < end`. */
  start: number;
  end: number;
}

/** The working windows of `[from, to)`, clipped to it, in time order. Empty without `work_hours`. */
export function workingWindows(from: Date, to: Date, config: Pick<RhythmConfig, "workHours" | "workdays">): WorkingWindow[] {
  const hours = config.workHours;
  if (hours === null || !(from.getTime() < to.getTime())) return [];
  const windows: WorkingWindow[] = [];
  const last = kyivLocal(to).date;
  for (let date = kyivLocal(from).date; date <= last; date = addLocalDays(date, 1)) {
    if (!config.workdays.includes(weekdayOfLocalDate(date))) continue;
    const start = Math.max(kyivLocalInstant(date, hours.start).getTime(), from.getTime());
    const end = Math.min(kyivLocalInstant(date, hours.end).getTime(), to.getTime());
    if (start < end) windows.push({ date, start, end });
  }
  return windows;
}

/** Working milliseconds inside `[from, to)`; null when no `work_hours` is configured. */
export function workingMsBetween(from: Date, to: Date, config: Pick<RhythmConfig, "workHours" | "workdays">): number | null {
  if (config.workHours === null) return null;
  return workingWindows(from, to, config).reduce((sum, window) => sum + (window.end - window.start), 0);
}

/** How far ahead a budget deadline is searched; a budget that cannot elapse within it has no deadline. */
export const DEADLINE_HORIZON_DAYS = 21;

/**
 * The instant at which `budgetMs` of working time since `from` is used up, or null (no `work_hours`, no workday
 * within the horizon). Time outside working hours never counts.
 */
export function workingDeadline(from: Date, budgetMs: number, config: Pick<RhythmConfig, "workHours" | "workdays">): Date | null {
  if (config.workHours === null || !(budgetMs > 0)) return null;
  const horizon = new Date(kyivLocalInstant(addLocalDays(kyivLocal(from).date, DEADLINE_HORIZON_DAYS), 0).getTime());
  let remaining = budgetMs;
  for (const window of workingWindows(from, horizon, config)) {
    const length = window.end - window.start;
    if (remaining <= length) return new Date(window.start + remaining);
    remaining -= length;
  }
  return null;
}
