import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRhythmConfig } from "./rhythmConfig.js";
import {
  addLocalDays,
  evaluateRituals,
  isQuietTime,
  kyivLocal,
  nextWorkday,
  ritualsForDate,
  weekdayOfLocalDate,
  workdaysBetween,
} from "./rhythmSchedule.js";

// #39 Working Rhythm — deterministic Europe/Kyiv ritual schedule. Every instant is explicit UTC, so the
// results cannot depend on the machine's own time zone.

const defaults = parseRhythmConfig(null).config;
const at = (iso: string) => new Date(iso);
const due = (iso: string, config = defaults) => evaluateRituals(at(iso), config).filter((r) => r.status === "due").map((r) => r.key);

test("Kyiv local time is independent of the process time zone (summer UTC+3, winter UTC+2)", () => {
  assert.deepEqual(kyivLocal(at("2026-09-28T06:30:00Z")), { date: "2026-09-28", weekday: 1, minutes: 570 });
  assert.deepEqual(kyivLocal(at("2026-10-26T07:30:00Z")), { date: "2026-10-26", weekday: 1, minutes: 570 });
  assert.deepEqual(kyivLocal(at("2026-09-28T21:30:00Z")), { date: "2026-09-29", weekday: 2, minutes: 30 }, "UTC evening is already the next Kyiv day");
});

test("Monday: the week plan replaces the normal morning brief", () => {
  assert.deepEqual(
    ritualsForDate("2026-09-28", defaults).map((r) => r.key),
    ["monday-plan:2026-09-28"],
  );
  assert.deepEqual(due("2026-09-28T06:30:00Z"), ["monday-plan:2026-09-28"]);
});

test("Monday with the week plan switched off falls back to the normal brief", () => {
  const config = parseRhythmConfig("monday_plan: off").config;
  assert.deepEqual(ritualsForDate("2026-09-28", config).map((r) => r.key), ["morning:2026-09-28"]);
});

test("Tuesday, Wednesday and Thursday: the normal morning brief", () => {
  assert.deepEqual(due("2026-09-29T06:30:00Z"), ["morning:2026-09-29"]);
  assert.deepEqual(due("2026-09-30T06:45:00Z"), ["morning:2026-09-30"]);
  assert.deepEqual(due("2026-10-01T07:00:00Z"), ["morning:2026-10-01"]);
});

test("Friday: a lighter morning brief AND the afternoon review, independently", () => {
  assert.deepEqual(ritualsForDate("2026-10-02", defaults).map((r) => r.key), ["friday-morning:2026-10-02", "friday-review:2026-10-02"]);
  assert.deepEqual(due("2026-10-02T06:30:00Z"), ["friday-morning:2026-10-02"]);
  assert.deepEqual(due("2026-10-02T13:30:00Z"), ["friday-review:2026-10-02"]);
  const noMorning = parseRhythmConfig("friday_morning: off").config;
  assert.deepEqual(ritualsForDate("2026-10-02", noMorning).map((r) => r.key), ["friday-review:2026-10-02"], "no fallback to a normal brief");
  const noReview = parseRhythmConfig("friday_review: off").config;
  assert.deepEqual(ritualsForDate("2026-10-02", noReview).map((r) => r.key), ["friday-morning:2026-10-02"]);
});

test("optional evening shutdown: absent by default, representable when enabled", () => {
  for (const date of ["2026-09-28", "2026-09-29", "2026-10-02"]) {
    assert.ok(!ritualsForDate(date, defaults).some((r) => r.kind === "evening"), date);
  }
  const config = parseRhythmConfig("evening: 18:30").config;
  assert.deepEqual(due("2026-09-29T15:35:00Z", config), ["evening:2026-09-29"]);
});

test("weekends are silent by default; a configured workday set is respected", () => {
  assert.deepEqual(ritualsForDate("2026-10-03", defaults), []);
  assert.deepEqual(ritualsForDate("2026-10-04", defaults), []);
  const noWednesday = parseRhythmConfig("workdays: mon,tue,thu,fri").config;
  assert.deepEqual(ritualsForDate("2026-09-30", noWednesday), []);
  const saturday = parseRhythmConfig("workdays: mon-sat").config;
  assert.deepEqual(ritualsForDate("2026-10-03", saturday).map((r) => r.key), ["morning:2026-10-03"]);
  assert.deepEqual(ritualsForDate("2026-09-29", parseRhythmConfig("enabled: off").config), []);
});

test("occurrence identity is stable across ticks and instants of the same Kyiv day", () => {
  const early = evaluateRituals(at("2026-09-29T06:30:00Z"), defaults)[0];
  const late = evaluateRituals(at("2026-09-29T08:10:00Z"), defaults)[0];
  assert.equal(early.key, "morning:2026-09-29");
  assert.equal(late.key, early.key);
});

test("before time: not yet; within grace: due; after grace: expired (never sent late)", () => {
  const status = (iso: string) => evaluateRituals(at(iso), defaults)[0].status;
  assert.equal(status("2026-09-29T06:29:00Z"), "not_yet");
  assert.equal(status("2026-09-29T06:30:00Z"), "due");
  assert.equal(status("2026-09-29T08:59:00Z"), "due", "a late tick (restart) still delivers within the grace window");
  assert.equal(status("2026-09-29T09:00:00Z"), "expired");
  const review = (iso: string) => evaluateRituals(at(iso), defaults).find((r) => r.kind === "friday-review")!.status;
  assert.equal(review("2026-10-02T15:29:00Z"), "due");
  assert.equal(review("2026-10-02T15:30:00Z"), "expired");
});

test("a late ritual never spills into quiet hours", () => {
  const config = parseRhythmConfig("friday_review: 19:00").config;
  const status = (iso: string) => evaluateRituals(at(iso), config).find((r) => r.kind === "friday-review")!.status;
  assert.equal(status("2026-10-02T16:30:00Z"), "due"); // 19:30 Kyiv
  assert.equal(status("2026-10-02T17:05:00Z"), "expired"); // 20:05 Kyiv, quiet
});

test("DST end (2026-10-25): Monday 09:30 Kyiv is 07:30Z after vs 06:30Z the Monday before", () => {
  assert.deepEqual(due("2026-10-19T06:30:00Z"), ["monday-plan:2026-10-19"]);
  assert.deepEqual(due("2026-10-26T06:30:00Z"), [], "08:30 Kyiv in winter: not yet");
  assert.deepEqual(due("2026-10-26T07:30:00Z"), ["monday-plan:2026-10-26"]);
});

test("DST start (2027-03-28): Friday before is UTC+2, Monday after is UTC+3", () => {
  assert.deepEqual(due("2027-03-26T07:30:00Z"), ["friday-morning:2027-03-26"]);
  assert.deepEqual(due("2027-03-26T06:30:00Z"), []);
  assert.deepEqual(due("2027-03-29T06:30:00Z"), ["monday-plan:2027-03-29"]);
});

test("quiet hours wrap midnight; start inclusive, end exclusive", () => {
  const quiet = defaults.quietHours;
  assert.equal(isQuietTime(19 * 60 + 59, quiet), false);
  assert.equal(isQuietTime(20 * 60, quiet), true);
  assert.equal(isQuietTime(2 * 60, quiet), true);
  assert.equal(isQuietTime(9 * 60 + 29, quiet), true);
  assert.equal(isQuietTime(9 * 60 + 30, quiet), false);
  assert.equal(isQuietTime(13 * 60, { start: 12 * 60, end: 14 * 60 }), true, "non-wrapping range");
});

test("calendar helpers: weekday, next workday and workday distance", () => {
  assert.equal(weekdayOfLocalDate("2026-09-28"), 1);
  assert.equal(addLocalDays("2026-10-31", 1), "2026-11-01");
  assert.equal(nextWorkday("2026-10-02", defaults.workdays), "2026-10-05", "Friday → Monday");
  assert.equal(workdaysBetween("2026-10-02", "2026-10-06", defaults.workdays), 2);
  assert.equal(workdaysBetween("2026-10-02", "2026-10-02", defaults.workdays), 0);
});
