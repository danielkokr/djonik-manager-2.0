import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RHYTHM_CONFIG,
  describeRhythmConfig,
  EXCEPTION_HARD_CEILING,
  formatLocalTime,
  parseRhythmConfig,
  resolveRhythmActivation,
} from "./rhythmConfig.js";

// #39 Working Rhythm — `/rhythm.md` parsing, safe defaults and the activation gate.

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

test("missing /rhythm.md → the agreed Product Owner defaults", () => {
  const { config, source, warnings, unknownKeys } = parseRhythmConfig(null);
  assert.equal(source, "default");
  assert.deepEqual(warnings, []);
  assert.deepEqual(unknownKeys, []);
  assert.equal(config.enabled, true);
  assert.equal(config.timeZone, "Europe/Kyiv");
  assert.deepEqual(config.workdays, [1, 2, 3, 4, 5]);
  assert.equal(config.morning, t("09:30"));
  assert.equal(config.mondayPlan, t("09:30"));
  assert.equal(config.fridayMorning, t("09:30"));
  assert.equal(config.fridayReview, t("16:30"));
  assert.equal(config.evening, null, "optional 18:30 shutdown is off by default");
  assert.deepEqual(config.quietHours, { start: t("20:00"), end: t("09:30") });
  assert.deepEqual(config.exceptions, { enabled: true, preferredPerDay: 1, maxPerDay: 2, spacingMinutes: 120, weekends: false });
  assert.deepEqual(config.thresholds, { dueSoonWorkdays: 2, waitingDays: 5, staleProjectDays: 10, inProgressMax: 3 });
  assert.deepEqual(config.mutes, []);
});

test("defaults are not shared mutable state between parses", () => {
  const a = parseRhythmConfig(null).config;
  a.workdays.push(6);
  a.mutes.push({ target: "x", until: null });
  const b = parseRhythmConfig(null).config;
  assert.deepEqual(b.workdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(b.mutes, []);
  assert.deepEqual(DEFAULT_RHYTHM_CONFIG.workdays, [1, 2, 3, 4, 5]);
});

test("valid custom times are applied (бриф о 10, Friday review о 17)", () => {
  const { config, warnings } = parseRhythmConfig("morning: 10:00\nfriday_review: 17:00\n");
  assert.deepEqual(warnings, []);
  assert.equal(config.morning, t("10:00"));
  assert.equal(config.fridayReview, t("17:00"));
});

test("`on` for Monday plan / Friday morning follows the configured morning time", () => {
  const { config } = parseRhythmConfig("monday_plan: on\nfriday_morning: on\nmorning: 10:15");
  assert.equal(config.mondayPlan, t("10:15"));
  assert.equal(config.fridayMorning, t("10:15"));
});

test("invalid time → that field keeps its safe default, with a warning", () => {
  for (const bad of ["25:00", "9.30", "noon", "03:00", "23:30", ""]) {
    const { config, warnings } = parseRhythmConfig(`morning: ${bad}`);
    assert.equal(config.morning, t("09:30"), bad);
    assert.equal(warnings.length, 1, bad);
  }
});

test("workday changes: list, range and Ukrainian day names", () => {
  assert.deepEqual(parseRhythmConfig("workdays: mon, tue, thu").config.workdays, [1, 2, 4]);
  assert.deepEqual(parseRhythmConfig("workdays: mon-thu").config.workdays, [1, 2, 3, 4]);
  assert.deepEqual(parseRhythmConfig("workdays: пн-пт").config.workdays, [1, 2, 3, 4, 5]);
  const bad = parseRhythmConfig("workdays: funday");
  assert.deepEqual(bad.config.workdays, [1, 2, 3, 4, 5]);
  assert.equal(bad.warnings.length, 1);
});

test("rituals enable/disable independently (Friday morning vs Friday review)", () => {
  const noFridayMorning = parseRhythmConfig("friday_morning: off").config;
  assert.equal(noFridayMorning.fridayMorning, null);
  assert.equal(noFridayMorning.fridayReview, t("16:30"));
  assert.equal(noFridayMorning.morning, t("09:30"));

  const noReview = parseRhythmConfig("friday_review: off").config;
  assert.equal(noReview.fridayReview, null);
  assert.equal(noReview.fridayMorning, t("09:30"));

  const noMorning = parseRhythmConfig("morning: off").config;
  assert.equal(noMorning.morning, null);
  assert.equal(noMorning.mondayPlan, t("09:30"), "morning off does not silently switch off the Monday plan");

  assert.equal(parseRhythmConfig("evening: on").config.evening, t("18:30"));
  assert.equal(parseRhythmConfig("enabled: off").config.enabled, false);
});

test("quiet hours parse, including invalid and zero-length ranges", () => {
  assert.deepEqual(parseRhythmConfig("quiet_hours: 19:00-09:00").config.quietHours, { start: t("19:00"), end: t("09:00") });
  assert.deepEqual(parseRhythmConfig("quiet_hours: 19:00–09:00").config.quietHours, { start: t("19:00"), end: t("09:00") });
  for (const bad of ["19:00", "10:00-10:00", "late-early"]) {
    const parsed = parseRhythmConfig(`quiet_hours: ${bad}`);
    assert.deepEqual(parsed.config.quietHours, { start: t("20:00"), end: t("09:30") }, bad);
    assert.equal(parsed.warnings.length, 1, bad);
  }
});

test("exception caps: custom values, hard ceiling of two, preferred never above max", () => {
  assert.equal(parseRhythmConfig("exceptions_per_day: 0").config.exceptions.preferredPerDay, 0);
  const high = parseRhythmConfig("exceptions_per_day: 5\nexceptions_max_per_day: 9");
  assert.equal(high.config.exceptions.preferredPerDay, EXCEPTION_HARD_CEILING);
  assert.equal(high.config.exceptions.maxPerDay, EXCEPTION_HARD_CEILING);
  assert.ok(high.warnings.some((w) => /capped/.test(w)));

  const inverted = parseRhythmConfig("exceptions_per_day: 2\nexceptions_max_per_day: 1").config.exceptions;
  assert.equal(inverted.maxPerDay, 1);
  assert.equal(inverted.preferredPerDay, 1);

  assert.equal(parseRhythmConfig("exceptions: off").config.exceptions.enabled, false);
  assert.equal(parseRhythmConfig("weekend_exceptions: on").config.exceptions.weekends, true);
});

test("spacing and thresholds: valid units, extreme or malformed values fall back", () => {
  assert.equal(parseRhythmConfig("exception_spacing: 3h").config.exceptions.spacingMinutes, 180);
  assert.equal(parseRhythmConfig("exception_spacing: 90m").config.exceptions.spacingMinutes, 90);
  assert.equal(parseRhythmConfig("exception_spacing: 5m").config.exceptions.spacingMinutes, 120);
  assert.equal(parseRhythmConfig("exception_spacing: 99h").config.exceptions.spacingMinutes, 120);

  const custom = parseRhythmConfig("due_soon_workdays: 3\nwaiting_days: 7\nstale_project_days: 14\nin_progress_max: 4").config.thresholds;
  assert.deepEqual(custom, { dueSoonWorkdays: 3, waitingDays: 7, staleProjectDays: 14, inProgressMax: 4 });

  const extreme = parseRhythmConfig("due_soon_workdays: 0\nwaiting_days: -1\nstale_project_days: 1000\nin_progress_max: 2.5");
  assert.deepEqual(extreme.config.thresholds, DEFAULT_RHYTHM_CONFIG.thresholds);
  assert.equal(extreme.warnings.length, 4);
});

test("unknown keys are kept for forward compatibility, never an error", () => {
  const parsed = parseRhythmConfig("morning: 10:00\nlunch_break: 13:00\nfuture_feature: yes\nlunch_break: 14:00");
  assert.deepEqual(parsed.unknownKeys, ["lunch_break", "future_feature"]);
  assert.equal(parsed.config.morning, t("10:00"));
  assert.deepEqual(parsed.warnings, []);
});

test("timezone invariant: only Europe/Kyiv; any other zone is ignored with a warning", () => {
  const ok = parseRhythmConfig("timezone: Europe/Kyiv");
  assert.deepEqual(ok.warnings, []);
  const other = parseRhythmConfig("timezone: America/New_York\nmorning: 10:00");
  assert.equal(other.config.timeZone, "Europe/Kyiv");
  assert.equal(other.config.morning, t("10:00"));
  assert.equal(other.warnings.length, 1);
});

test("a ```rhythm block scopes parsing; prose, headings and comments around it are ignored", () => {
  const text = [
    "# Ритм роботи",
    "Примітка: це налаштування для Джоніка.",
    "",
    "```rhythm",
    "morning: 10:00",
    "- friday_morning: off",
    "# коментар",
    "mute: project:limen",
    "mute: overdue:abc@2026-09-30T15:00:00.000Z until 2026-10-02",
    "```",
    "evening: 18:30",
  ].join("\n");
  const parsed = parseRhythmConfig(text);
  assert.equal(parsed.config.morning, t("10:00"));
  assert.equal(parsed.config.fridayMorning, null);
  assert.equal(parsed.config.evening, null, "lines outside the block are ignored when a block exists");
  assert.deepEqual(parsed.config.mutes, [
    { target: "project:limen", until: null },
    { target: "overdue:abc@2026-09-30T15:00:00.000Z", until: "2026-10-02" },
  ]);
  assert.deepEqual(parsed.unknownKeys, []);
});

test("invalid mute entries are ignored; duplicate scalar keys: last wins with a warning", () => {
  const parsed = parseRhythmConfig("mute: a b c\nmute: x until 2026-02-30\nmorning: 10:00\nmorning: 11:00");
  assert.deepEqual(parsed.config.mutes, []);
  assert.equal(parsed.config.morning, t("11:00"));
  assert.equal(parsed.warnings.filter((w) => /mute/.test(w)).length, 2);
  assert.ok(parsed.warnings.some((w) => /duplicate key morning/.test(w)));
});

test("CRLF text parses the same as LF", () => {
  assert.equal(parseRhythmConfig("morning: 10:00\r\nfriday_review: off\r\n").config.fridayReview, null);
});

test("activation gate: OFF unless the host sets exactly DJONIK_WORKING_RHYTHM=on", () => {
  assert.equal(resolveRhythmActivation({}).enabled, false);
  assert.equal(resolveRhythmActivation({ DJONIK_WORKING_RHYTHM: "" }).enabled, false);
  assert.equal(resolveRhythmActivation({ DJONIK_WORKING_RHYTHM: "1" }).enabled, false);
  assert.equal(resolveRhythmActivation({ DJONIK_WORKING_RHYTHM: "true" }).enabled, false);
  assert.equal(resolveRhythmActivation({ DJONIK_WORKING_RHYTHM: "ON" }).enabled, false);
  assert.equal(resolveRhythmActivation({ DJONIK_WORKING_RHYTHM: "on" }).enabled, true);
});

test("describeRhythmConfig is compact and content-free", () => {
  const line = describeRhythmConfig(parseRhythmConfig("friday_morning: off").config);
  assert.match(line, /ранковий бриф: 09:30/);
  assert.match(line, /пт зранку: вимкнено/);
  assert.match(line, /тиха зона: 20:00–09:30/);
  assert.equal(formatLocalTime(t("07:05")), "07:05");
});
