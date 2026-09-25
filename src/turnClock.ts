import { formatLocalTime } from "./rhythmConfig.js";
import { addLocalDays, kyivLocal, weekdayOfLocalDate, WEEKDAY_UK } from "./rhythmSchedule.js";

/**
 * Deterministic "now" for Daniel's turns (#41, docs/70 §7.3). Ordinary turns used to carry no current
 * date, so the model guessed weekdays; Working Rhythm turns already carry their own `kyivLabel` line.
 *
 * The header is adapter context, not Daniel's words: it travels as its own first text block, and its fixed
 * prefix says so. Pure — Europe/Kyiv via the #39 calendar primitives of `rhythmSchedule.ts` (DST-safe,
 * independent of the machine's time zone), never the rhythm orchestrator; the strip is a calendar-date lookup,
 * never parsed from or routed on the turn's text.
 */

/** How many days after today the strip lists. */
export const CLOCK_STRIP_DAYS = 14;

/** Fixed opening of every clock header — also how the header is recognised as system context. */
export const CLOCK_HEADER_PREFIX = "[Годинник адаптера, не текст Daniel · Зараз:";

function dayMonth(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}.${month}`;
}

/** e.g. `[Годинник адаптера, не текст Daniel · Зараз: пт 25.09.2026, 14:30 Київ · сб 26.09 · нд 27.09 · … · пт 09.10]` */
export function buildClockHeader(now: Date): string {
  const local = kyivLocal(now);
  const today = `${WEEKDAY_UK[local.weekday]} ${dayMonth(local.date)}.${local.date.slice(0, 4)}, ${formatLocalTime(local.minutes)} Київ`;
  const strip = Array.from({ length: CLOCK_STRIP_DAYS }, (_, index) => {
    const date = addLocalDays(local.date, index + 1);
    return `${WEEKDAY_UK[weekdayOfLocalDate(date)]} ${dayMonth(date)}`;
  });
  return `${CLOCK_HEADER_PREFIX} ${today} · ${strip.join(" · ")}]`;
}

export function isClockHeader(text: string): boolean {
  return text.startsWith(CLOCK_HEADER_PREFIX);
}
