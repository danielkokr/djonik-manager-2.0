import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { workingDeadline, workingMsBetween, workingWindows } from "./workingTime.js";

// #50 working time: explicit work_hours only, Europe/Kyiv, workdays, DST-correct. Pure; no clock.

const H = 3_600_000;
const config = (text: string) => parseRhythmConfig(text).config;
const WORK = config("work_hours: 10:00-18:00"); // Mon–Fri default workdays

test("no work_hours → no working time at all (unavailable, never an invented schedule)", () => {
  const none = config("");
  assert.equal(none.workHours, null);
  assert.deepEqual(workingWindows(new Date("2026-09-28T00:00:00Z"), new Date("2026-10-02T00:00:00Z"), none), []);
  assert.equal(workingMsBetween(new Date("2026-09-28T00:00:00Z"), new Date("2026-10-02T00:00:00Z"), none), null);
  assert.equal(workingDeadline(new Date("2026-09-28T07:00:00Z"), 2 * H, none), null);
});

test("quiet hours are not working hours: changing quiet_hours never creates working time", () => {
  const quietOnly = config("quiet_hours: 22:00-07:00");
  assert.equal(quietOnly.workHours, null);
  assert.equal(workingMsBetween(new Date("2026-09-28T00:00:00Z"), new Date("2026-09-29T00:00:00Z"), quietOnly), null);
});

test("clipping: before, inside and after working hours on a Kyiv workday (EEST, UTC+3)", () => {
  // Mon 28.09: 10:00–18:00 Kyiv = 07:00–15:00Z.
  assert.equal(workingMsBetween(new Date("2026-09-28T04:00:00Z"), new Date("2026-09-28T07:00:00Z"), WORK), 0, "07:00–10:00 Kyiv");
  assert.equal(workingMsBetween(new Date("2026-09-28T05:00:00Z"), new Date("2026-09-28T09:30:00Z"), WORK), 2.5 * H);
  assert.equal(workingMsBetween(new Date("2026-09-28T14:00:00Z"), new Date("2026-09-28T20:00:00Z"), WORK), 1 * H, "17:00–23:00 Kyiv");
  assert.equal(workingMsBetween(new Date("2026-09-28T00:00:00Z"), new Date("2026-09-29T00:00:00Z"), WORK), 8 * H);
});

test("weekends and non-configured workdays never count", () => {
  // Fri 02.10 16:00 Kyiv → Mon 05.10 12:00 Kyiv: 2 h Friday + 2 h Monday.
  assert.equal(workingMsBetween(new Date("2026-10-02T13:00:00Z"), new Date("2026-10-05T09:00:00Z"), WORK), 4 * H);
  const monWed = config("work_hours: 10:00-18:00\nworkdays: mon, wed");
  assert.equal(workingMsBetween(new Date("2026-09-28T00:00:00Z"), new Date("2026-10-03T00:00:00Z"), monWed), 16 * H);
});

test("DST: local working hours hold across the autumn and spring transitions (real elapsed time)", () => {
  // Autumn: Sun 25.10.2026 04:00 EEST → 03:00 EET. Fri 23.10 is UTC+3, Mon 26.10 is UTC+2.
  const fri = workingWindows(new Date("2026-10-23T00:00:00Z"), new Date("2026-10-24T00:00:00Z"), WORK)[0];
  assert.equal(new Date(fri.start).toISOString(), "2026-10-23T07:00:00.000Z");
  const mon = workingWindows(new Date("2026-10-26T00:00:00Z"), new Date("2026-10-27T00:00:00Z"), WORK)[0];
  assert.equal(new Date(mon.start).toISOString(), "2026-10-26T08:00:00.000Z");
  assert.equal(mon.end - mon.start, 8 * H);
  // Spring: Sun 29.03.2026 03:00 → 04:00. A window over the gap on a configured Sunday is 1 h shorter in real time.
  const sunday = config("work_hours: 02:00-05:00\nworkdays: sun");
  assert.equal(workingMsBetween(new Date("2026-03-28T12:00:00Z"), new Date("2026-03-29T12:00:00Z"), sunday), 2 * H);
  // …and autumn's repeated hour makes the same wall-clock window one hour longer.
  assert.equal(workingMsBetween(new Date("2026-10-24T12:00:00Z"), new Date("2026-10-25T12:00:00Z"), sunday), 4 * H);
});

test("deadline: a 2 h budget counts only working time and skips the evening and weekend", () => {
  // Started Mon 17:00 Kyiv: 1 h Monday, the second hour Tuesday 10:00–11:00.
  assert.equal(workingDeadline(new Date("2026-09-28T14:00:00Z"), 2 * H, WORK)?.toISOString(), "2026-09-29T08:00:00.000Z");
  // Started Fri 17:30 Kyiv: 30 min Friday, 90 min Monday → Mon 11:30 Kyiv.
  assert.equal(workingDeadline(new Date("2026-10-02T14:30:00Z"), 2 * H, WORK)?.toISOString(), "2026-10-05T08:30:00.000Z");
  // Started before hours: the clock starts at 10:00.
  assert.equal(workingDeadline(new Date("2026-09-28T05:00:00Z"), 2 * H, WORK)?.toISOString(), "2026-09-28T09:00:00.000Z");
});

test("config: work_hours and daily_time_cap parse deterministically; invalid values warn and stay safe", () => {
  const ok = parseRhythmConfig("work_hours: 09:30-18:30\ndaily_time_cap: 7.5h");
  assert.deepEqual(ok.config.workHours, { start: 570, end: 1110 });
  assert.equal(ok.config.dailyTimeCapMinutes, 450);
  assert.deepEqual(ok.warnings, []);
  assert.equal(parseRhythmConfig("").config.dailyTimeCapMinutes, 480, "default cap 8 h");
  assert.equal(parseRhythmConfig("daily_time_cap: 6 год").config.dailyTimeCapMinutes, 360);
  assert.equal(parseRhythmConfig("daily_time_cap: 420").config.dailyTimeCapMinutes, 420);
  for (const bad of ["work_hours: 18:00-10:00", "work_hours: 22:00-01:00", "work_hours: 10:00-10:15", "work_hours: зранку", "daily_time_cap: 30m", "daily_time_cap: 20h", "daily_time_cap: 7.5"]) {
    const parsed = parseRhythmConfig(bad);
    assert.equal(parsed.warnings.length, 1, bad);
    assert.equal(parsed.config.workHours, null, bad);
    assert.ok(parsed.config.dailyTimeCapMinutes === 480, bad);
  }
  assert.equal(parseRhythmConfig("work_hours: 10:00-18:00\nwork_hours: off").config.workHours, null, "off removes it");
  assert.deepEqual(parseRhythmConfig("work_hours: 10:00-18:00\nfuture_key: x").unknownKeys, ["future_key"], "unknown keys stay compatible");
});
