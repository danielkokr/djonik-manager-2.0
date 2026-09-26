import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RHYTHM_CONFIG, type RhythmConfig } from "./rhythmConfig.js";
import {
  dayLabel,
  kyivLocalToInstant,
  morningMinutesFor,
  parseReminderDate,
  resolveReminderWhen,
  ReminderTimeError,
  scheduleLabel,
  type ReminderWhen,
} from "./reminderTime.js";

// #54 reminder date/time authority: code, never the model, turns Daniel's words into a Kyiv date and an instant.
// Zero network, zero inference. Every instant is asserted in UTC so the machine's own time zone cannot matter.

const config = (patch: Partial<RhythmConfig> = {}): RhythmConfig => ({ ...DEFAULT_RHYTHM_CONFIG, ...patch });
/** Saturday 26.09.2026, 12:00 Kyiv (EEST, UTC+3). */
const SAT_NOON = new Date("2026-09-26T09:00:00Z");
/** Monday 28.09.2026, 08:00 Kyiv. */
const MON_0800 = new Date("2026-09-28T05:00:00Z");

const resolve = (when: ReminderWhen, now = SAT_NOON, cfg = config(), rituals = true) => resolveReminderWhen(when, now, cfg, rituals);
const problem = (when: ReminderWhen, now = SAT_NOON, cfg = config()) => {
  try {
    resolveReminderWhen(when, now, cfg);
  } catch (error) {
    assert.ok(error instanceof ReminderTimeError, String(error));
    return error.problem;
  }
  assert.fail("expected a ReminderTimeError");
};

test("tomorrow (date only) is Kyiv tomorrow's morning; a non-workday has no ritual → separate morning message", () => {
  const s = resolve({ day: "tomorrow" });
  assert.equal(s.mode, "morning");
  assert.equal(s.date, "2026-09-27"); // Sunday
  assert.equal(s.time, "09:30");
  assert.equal(s.dueAt, "2026-09-27T06:30:00.000Z");
  assert.equal(s.surface, "separate_message");
  assert.deepEqual(s.requested, { date: "2026-09-27", time: null });
});

test("tomorrow just after Kyiv midnight is decided by the Kyiv date, not UTC", () => {
  // 2026-09-27 00:10 Kyiv = 2026-09-26 21:10 UTC: "tomorrow" is Monday 28.09, not Sunday.
  const s = resolve({ day: "tomorrow" }, new Date("2026-09-26T21:10:00Z"));
  assert.equal(s.date, "2026-09-28");
  assert.equal(s.surface, "monday_plan");
});

test("weekday: the nearest such day strictly after today; on a Monday 'в понеділок' is next Monday", () => {
  assert.equal(resolve({ day: "weekday", weekday: "mon" }).date, "2026-09-28");
  assert.equal(resolve({ day: "weekday", weekday: "sat" }).date, "2026-10-03", "today is Saturday → next Saturday");
  assert.equal(resolve({ day: "weekday", weekday: "mon" }, MON_0800).date, "2026-10-05");
  assert.equal(resolve({ day: "weekday", weekday: "tue" }, MON_0800).date, "2026-09-29");
});

test("weekday + next_week: that weekday inside the next ISO week", () => {
  assert.equal(resolve({ day: "weekday", weekday: "tue", next_week: true }, MON_0800).date, "2026-10-06");
  assert.equal(resolve({ day: "weekday", weekday: "tue", next_week: true }).date, "2026-09-29", "from Saturday the next week starts on Monday 28.09");
  assert.equal(resolve({ day: "weekday", weekday: "sun", next_week: true }, MON_0800).date, "2026-10-11");
});

test("date-only surfaces: Monday plan, Tue–Thu brief, Friday morning; rhythm not running → separate message", () => {
  assert.equal(resolve({ day: "date", date: "28.09" }).surface, "monday_plan");
  assert.equal(resolve({ day: "date", date: "29.09" }).surface, "morning_brief");
  assert.equal(resolve({ day: "date", date: "02.10" }).surface, "friday_morning");
  assert.equal(resolve({ day: "date", date: "29.09" }, SAT_NOON, config(), false).surface, "separate_message");
  // The morning slot follows the ritual time from /rhythm.md.
  const late = resolve({ day: "date", date: "29.09" }, SAT_NOON, config({ morning: 10 * 60 }));
  assert.equal(late.time, "10:00");
  assert.equal(late.dueAt, "2026-09-29T07:00:00.000Z");
});

test("explicit time today and tomorrow", () => {
  const today = resolve({ time: "15:00" });
  assert.equal(today.mode, "timed");
  assert.deepEqual([today.date, today.time, today.dueAt, today.rolledToTomorrow], ["2026-09-26", "15:00", "2026-09-26T12:00:00.000Z", false]);
  const tomorrow = resolve({ day: "tomorrow", time: "11:05" });
  assert.deepEqual([tomorrow.date, tomorrow.time, tomorrow.dueAt], ["2026-09-27", "11:05", "2026-09-27T08:05:00.000Z"]);
  assert.equal(resolve({ time: "15" }).time, "15:00", "a bare hour is HH:00");
});

test("a time-only request whose time has passed rolls to tomorrow — and says so; an explicit day never rolls", () => {
  const rolled = resolve({ time: "10:00" });
  assert.deepEqual([rolled.date, rolled.rolledToTomorrow, rolled.dueAt], ["2026-09-27", true, "2026-09-27T07:00:00.000Z"]);
  assert.equal(problem({ day: "today", time: "10:00" }), "in_past");
  assert.equal(resolve({ time: "12:00" }).rolledToTomorrow, true, "exactly now is not the future → rolls, no error");
});

test("past or impossible dates are refused, never guessed", () => {
  assert.equal(problem({ day: "date", date: "2026-09-25" }), "in_past");
  assert.equal(problem({ day: "date", date: "31.02" }), "invalid_date");
  assert.equal(problem({ day: "date", date: "tomorrow" }), "invalid_date");
  assert.equal(problem({ day: "weekday" }), "invalid_when");
  assert.equal(problem({}), "missing_when");
  assert.equal(problem({ day: "date", date: "01.01.2028" }), "too_far");
  // DD.MM without a year is the next such date from today.
  assert.equal(parseReminderDate("25.09", "2026-09-26"), "2027-09-25");
  assert.equal(parseReminderDate("26.09", "2026-09-26"), "2026-09-26");
  assert.equal(parseReminderDate("29.02", "2026-09-26"), "2028-02-29");
});

test("date-only today: fine before the morning slot, refused (needs_time) after it", () => {
  const early = resolve({ day: "today" }, new Date("2026-09-26T04:00:00Z")); // 07:00 Kyiv
  assert.deepEqual([early.date, early.time], ["2026-09-26", "09:30"]);
  assert.equal(problem({ day: "today" }), "needs_time");
});

test("quiet hours: an evening moment → next morning's end; an early moment → same morning; requested is kept", () => {
  const evening = resolve({ day: "tomorrow", time: "21:00" });
  assert.deepEqual([evening.date, evening.time, evening.quietShifted], ["2026-09-28", "09:30", true]);
  assert.deepEqual(evening.requested, { date: "2026-09-27", time: "21:00" });
  const early = resolve({ day: "tomorrow", time: "07:00" });
  assert.deepEqual([early.date, early.time, early.quietShifted], ["2026-09-27", "09:30", true]);
  assert.equal(resolve({ day: "tomorrow", time: "09:30" }).quietShifted, false, "the quiet end itself is not quiet");
  assert.equal(resolve({ day: "tomorrow", time: "19:59" }).quietShifted, false);
  // Custom quiet hours from /rhythm.md.
  const custom = resolve({ day: "tomorrow", time: "22:30" }, SAT_NOON, config({ quietHours: { start: 23 * 60, end: 8 * 60 } }));
  assert.equal(custom.quietShifted, false);
});

test("in_minutes: now plus N; cannot be combined with a day; lands in quiet → shifted", () => {
  const hour = resolve({ in_minutes: 60 });
  assert.deepEqual([hour.date, hour.time, hour.dueAt], ["2026-09-26", "13:00", "2026-09-26T10:00:00.000Z"]);
  assert.equal(problem({ in_minutes: 60, day: "tomorrow" }), "invalid_when");
  assert.equal(problem({ in_minutes: 0 }), "invalid_when");
  const late = resolve({ in_minutes: 60 }, new Date("2026-09-26T16:30:00Z")); // 19:30 Kyiv → 20:30 (quiet)
  assert.deepEqual([late.date, late.time, late.quietShifted, late.requested.time], ["2026-09-27", "09:30", true, "20:30"]);
});

test("DST end (25.10.2026): Monday 10:00 after the switch is 08:00Z (EET), not 07:00Z", () => {
  const friday = new Date("2026-10-23T09:00:00Z"); // Fri 12:00 EEST
  const s = resolve({ day: "weekday", weekday: "mon", time: "10:00" }, friday);
  assert.deepEqual([s.date, s.dueAt], ["2026-10-26", "2026-10-26T08:00:00.000Z"]);
  // Date-only across the switch: Sunday's 09:30 EET.
  const sunday = resolve({ day: "tomorrow" }, new Date("2026-10-24T07:00:00Z"));
  assert.equal(sunday.dueAt, "2026-10-25T07:30:00.000Z");
});

test("DST local-time edge cases: a skipped time moves forward by the gap; a repeated time takes the first", () => {
  // 29.03.2027 is not the switch; 28.03.2027 03:00 EET → 04:00 EEST, so 03:30 does not exist.
  assert.equal(kyivLocalToInstant("2027-03-28", 3 * 60 + 30).toISOString(), "2027-03-28T01:30:00.000Z"); // shown 04:30 EEST
  // 25.10.2026 04:00 EEST → 03:00 EET, so 03:30 happens twice: the first (EEST) wins.
  assert.equal(kyivLocalToInstant("2026-10-25", 3 * 60 + 30).toISOString(), "2026-10-25T00:30:00.000Z");
  // Ordinary days either side.
  assert.equal(kyivLocalToInstant("2026-07-01", 9 * 60).toISOString(), "2026-07-01T06:00:00.000Z");
  assert.equal(kyivLocalToInstant("2026-12-01", 9 * 60).toISOString(), "2026-12-01T07:00:00.000Z");
});

test("the result does not depend on the machine's time zone (Intl-based Kyiv, as #41)", () => {
  const original = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      assert.equal(resolve({ day: "weekday", weekday: "mon", time: "10:00" }).dueAt, "2026-09-28T07:00:00.000Z", tz);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("labels are code-owned: relative day, weekday, date, time or morning surface", () => {
  assert.equal(dayLabel("2026-09-27", SAT_NOON), "завтра, нд 27.09");
  assert.equal(dayLabel("2026-09-28", SAT_NOON), "післязавтра, пн 28.09");
  assert.equal(dayLabel("2026-09-30", SAT_NOON), "ср 30.09");
  assert.equal(scheduleLabel(resolve({ day: "weekday", weekday: "mon" }), SAT_NOON), "післязавтра, пн 28.09 зранку, у плані тижня");
  assert.equal(scheduleLabel(resolve({ time: "15:00" }), SAT_NOON), "сьогодні, сб 26.09 о 15:00");
  assert.equal(morningMinutesFor("2026-09-29", config({ morning: 8 * 60 })), 9 * 60 + 30, "a morning inside quiet hours moves to their end");
});
