/**
 * Working Rhythm configuration (#39): the small canonical `/rhythm.md` format, its deterministic
 * parser, safe defaults and the process-level activation gate.
 *
 * `/rhythm.md` is a native Memory file that Claude edits on Daniel's natural-language request
 * ("бриф о 10", "не пиши в п'ятницю зранку"). This module only parses text it is given; it never
 * reads Memory itself. How the adapter obtains the file is the `RhythmConfigSource` boundary below,
 * implemented by the reviewed read-only `rhythmMemoryConfig.ts` (docs/62 §3).
 *
 * Parsing never throws: every invalid value falls back to its safe default with a warning, unknown
 * keys are kept for forward compatibility, and a missing file yields the agreed defaults.
 */

export const RHYTHM_TIME_ZONE = "Europe/Kyiv";

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Minutes after local midnight, Europe/Kyiv. */
export type LocalMinutes = number;

export interface RhythmMute {
  /** Occurrence handle (`<signal key>@<fingerprint>`), a signal key, `project:<slug>` or `kind:<kind>`. */
  target: string;
  /** Inclusive last Kyiv date (YYYY-MM-DD) the mute applies to; null = until removed. */
  until: string | null;
}

export interface RhythmConfig {
  enabled: boolean;
  timeZone: typeof RHYTHM_TIME_ZONE;
  workdays: IsoWeekday[];
  /** Tuesday–Thursday (and any other non-Monday/Friday workday) morning brief; null = off. */
  morning: LocalMinutes | null;
  /** Monday week-plan proposal, which replaces the Monday morning brief; null = off (normal brief). */
  mondayPlan: LocalMinutes | null;
  /** Lighter Friday morning brief; null = off (no Friday morning message). */
  fridayMorning: LocalMinutes | null;
  /** Friday afternoon weekly review; null = off. */
  fridayReview: LocalMinutes | null;
  /** Optional "що переносимо?" shutdown; off by default. */
  evening: LocalMinutes | null;
  quietHours: { start: LocalMinutes; end: LocalMinutes };
  exceptions: {
    enabled: boolean;
    /** Ordinary cap: exceptions per work day before a second needs new high severity. */
    preferredPerDay: number;
    /** Absolute cap outside rituals; never above `EXCEPTION_HARD_CEILING`. */
    maxPerDay: number;
    spacingMinutes: number;
    /** Weekend exceptions are off by default; when on, only high severity may pass. */
    weekends: boolean;
  };
  thresholds: {
    dueSoonWorkdays: number;
    waitingDays: number;
    staleProjectDays: number;
    inProgressMax: number;
  };
  mutes: RhythmMute[];
}

/** Product ceiling (Product Owner 2026-09-24): never more than two unsolicited messages per day. */
export const EXCEPTION_HARD_CEILING = 2;

const hm = (hours: number, minutes: number): LocalMinutes => hours * 60 + minutes;

export const DEFAULT_RHYTHM_CONFIG: RhythmConfig = Object.freeze({
  enabled: true,
  timeZone: RHYTHM_TIME_ZONE,
  workdays: [1, 2, 3, 4, 5] as IsoWeekday[],
  morning: hm(9, 30),
  mondayPlan: hm(9, 30),
  fridayMorning: hm(9, 30),
  fridayReview: hm(16, 30),
  evening: null,
  quietHours: { start: hm(20, 0), end: hm(9, 30) },
  exceptions: { enabled: true, preferredPerDay: 1, maxPerDay: 2, spacingMinutes: 120, weekends: false },
  thresholds: { dueSoonWorkdays: 2, waitingDays: 5, staleProjectDays: 10, inProgressMax: 3 },
  mutes: [] as RhythmMute[],
}) as RhythmConfig;

export interface ParsedRhythmConfig {
  config: RhythmConfig;
  /** "default" when no `/rhythm.md` text was supplied. */
  source: "default" | "memory";
  /** Content-free, human-readable notes about values that fell back to defaults. */
  warnings: string[];
  /** Keys this revision does not know; kept for forward compatibility, never an error. */
  unknownKeys: string[];
}

function cloneDefaults(): RhythmConfig {
  const d = DEFAULT_RHYTHM_CONFIG;
  return {
    ...d,
    workdays: [...d.workdays],
    quietHours: { ...d.quietHours },
    exceptions: { ...d.exceptions },
    thresholds: { ...d.thresholds },
    mutes: [],
  };
}

const WEEKDAY_NAMES: Record<string, IsoWeekday> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
  пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, нд: 7,
};

const ON = new Set(["on", "yes", "true", "так", "увімкнено"]);
const OFF = new Set(["off", "no", "false", "ні", "вимкнено"]);

export function parseLocalTime(value: string): LocalMinutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hm(hours, minutes);
}

export function formatLocalTime(minutes: LocalMinutes): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Rituals are daytime work messages: a configured time outside 06:00–21:59 is treated as invalid. */
const RITUAL_EARLIEST = hm(6, 0);
const RITUAL_LATEST = hm(21, 59);

function parseToggleOrTime(
  raw: string,
  fallbackTime: LocalMinutes,
): { ok: true; value: LocalMinutes | null } | { ok: false } {
  const value = raw.trim().toLowerCase();
  if (OFF.has(value)) return { ok: true, value: null };
  if (ON.has(value)) return { ok: true, value: fallbackTime };
  const time = parseLocalTime(value);
  if (time === null || time < RITUAL_EARLIEST || time > RITUAL_LATEST) return { ok: false };
  return { ok: true, value: time };
}

function parseToggle(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (ON.has(value)) return true;
  if (OFF.has(value)) return false;
  return null;
}

function parseWorkdays(raw: string): IsoWeekday[] | null {
  const tokens = raw.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const days = new Set<IsoWeekday>();
  for (const token of tokens) {
    const range = /^([a-zа-яії]+)-([a-zа-яії]+)$/.exec(token);
    if (range) {
      const from = WEEKDAY_NAMES[range[1]];
      const to = WEEKDAY_NAMES[range[2]];
      if (!from || !to || from > to) return null;
      for (let day = from; day <= to; day += 1) days.add(day as IsoWeekday);
      continue;
    }
    const day = WEEKDAY_NAMES[token];
    if (!day) return null;
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

function parseBoundedInt(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value >= min && value <= max ? value : null;
}

/** `2h`, `90m`, `120` (minutes). Bounded to 60–480 minutes. */
function parseSpacing(raw: string): number | null {
  const match = /^(\d+)\s*(h|m|год|хв)?$/.exec(raw.trim().toLowerCase());
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = match[2] === "h" || match[2] === "год" ? amount * 60 : amount;
  return minutes >= 60 && minutes <= 480 ? minutes : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `mute: <target> [until YYYY-MM-DD]`. Targets are opaque tokens without whitespace. */
function parseMute(raw: string): RhythmMute | null {
  const match = /^(\S+)(?:\s+until\s+(\S+))?$/i.exec(raw.trim());
  if (!match) return null;
  const until = match[2] ?? null;
  if (until !== null && !isRealDate(until)) return null;
  if (match[1].length > 128) return null;
  return { target: match[1], until };
}

export const KNOWN_RHYTHM_KEYS = [
  "enabled",
  "timezone",
  "workdays",
  "morning",
  "monday_plan",
  "friday_morning",
  "friday_review",
  "evening",
  "quiet_hours",
  "exceptions",
  "exceptions_per_day",
  "exceptions_max_per_day",
  "exception_spacing",
  "weekend_exceptions",
  "due_soon_workdays",
  "waiting_days",
  "stale_project_days",
  "in_progress_max",
  "mute",
] as const;

/**
 * The config lines of `/rhythm.md`: the body of a ```rhythm fenced block when one exists, else every
 * line of the file. Prose, headings and comments (`#`, `<!-- -->`) are ignored.
 */
function configLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const fenced = /```rhythm[^\n]*\n([\s\S]*?)```/.exec(normalized);
  const body = fenced ? fenced[1] : normalized;
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--"));
}

/**
 * Parses `/rhythm.md` text. `null` (file absent) → the agreed defaults. Never throws; the last
 * occurrence of a repeated scalar key wins with a warning; `mute` may repeat.
 */
export function parseRhythmConfig(text: string | null): ParsedRhythmConfig {
  const config = cloneDefaults();
  const warnings: string[] = [];
  const unknownKeys: string[] = [];
  if (text === null) return { config, source: "default", warnings, unknownKeys };

  const seen = new Set<string>();
  const invalid = (key: string) => warnings.push(`invalid value for ${key}; using the default`);

  // Toggle-or-time values resolve `on` against the morning time, so read `morning` first.
  const entries: Array<[string, string]> = [];
  for (const line of configLines(text)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    entries.push([match[1].toLowerCase(), match[2].replace(/\s+#.*$/, "").trim()]);
  }
  const morningEntries = entries.filter(([key]) => key === "morning");
  const ordered = [...morningEntries, ...entries.filter(([key]) => key !== "morning")];

  for (const [key, value] of ordered) {
    if (!(KNOWN_RHYTHM_KEYS as readonly string[]).includes(key)) {
      if (!unknownKeys.includes(key)) unknownKeys.push(key);
      continue;
    }
    if (key !== "mute") {
      if (seen.has(key)) warnings.push(`duplicate key ${key}; the last value wins`);
      seen.add(key);
    }
    const morningOrDefault = config.morning ?? DEFAULT_RHYTHM_CONFIG.morning!;
    switch (key) {
      case "enabled": {
        const parsed = parseToggle(value);
        if (parsed === null) invalid(key);
        else config.enabled = parsed;
        break;
      }
      case "timezone":
        // Invariant: the rhythm is defined in Europe/Kyiv. Any other zone is ignored, not adopted.
        if (value !== RHYTHM_TIME_ZONE) warnings.push(`timezone ${value ? "is not supported" : "is empty"}; the rhythm stays on ${RHYTHM_TIME_ZONE}`);
        break;
      case "workdays": {
        const parsed = parseWorkdays(value);
        if (parsed === null) invalid(key);
        else config.workdays = parsed;
        break;
      }
      case "morning": {
        const parsed = parseToggleOrTime(value, DEFAULT_RHYTHM_CONFIG.morning!);
        if (!parsed.ok) invalid(key);
        else config.morning = parsed.value;
        break;
      }
      case "monday_plan": {
        const parsed = parseToggleOrTime(value, morningOrDefault);
        if (!parsed.ok) invalid(key);
        else config.mondayPlan = parsed.value;
        break;
      }
      case "friday_morning": {
        const parsed = parseToggleOrTime(value, morningOrDefault);
        if (!parsed.ok) invalid(key);
        else config.fridayMorning = parsed.value;
        break;
      }
      case "friday_review": {
        const parsed = parseToggleOrTime(value, DEFAULT_RHYTHM_CONFIG.fridayReview!);
        if (!parsed.ok) invalid(key);
        else config.fridayReview = parsed.value;
        break;
      }
      case "evening": {
        const parsed = parseToggleOrTime(value, hm(18, 30));
        if (!parsed.ok) invalid(key);
        else config.evening = parsed.value;
        break;
      }
      case "quiet_hours": {
        const match = /^(\S+)\s*[-–]\s*(\S+)$/.exec(value);
        const start = match ? parseLocalTime(match[1]) : null;
        const end = match ? parseLocalTime(match[2]) : null;
        if (start === null || end === null || start === end) invalid(key);
        else config.quietHours = { start, end };
        break;
      }
      case "exceptions": {
        const parsed = parseToggle(value);
        if (parsed === null) invalid(key);
        else config.exceptions.enabled = parsed;
        break;
      }
      case "exceptions_per_day": {
        const parsed = parseBoundedInt(value, 0, 99);
        if (parsed === null) invalid(key);
        else if (parsed > EXCEPTION_HARD_CEILING) {
          warnings.push(`exceptions_per_day above ${EXCEPTION_HARD_CEILING} is capped`);
          config.exceptions.preferredPerDay = EXCEPTION_HARD_CEILING;
        } else config.exceptions.preferredPerDay = parsed;
        break;
      }
      case "exceptions_max_per_day": {
        const parsed = parseBoundedInt(value, 0, 99);
        if (parsed === null) invalid(key);
        else if (parsed > EXCEPTION_HARD_CEILING) {
          warnings.push(`exceptions_max_per_day above ${EXCEPTION_HARD_CEILING} is capped`);
          config.exceptions.maxPerDay = EXCEPTION_HARD_CEILING;
        } else config.exceptions.maxPerDay = parsed;
        break;
      }
      case "exception_spacing": {
        const parsed = parseSpacing(value);
        if (parsed === null) invalid(key);
        else config.exceptions.spacingMinutes = parsed;
        break;
      }
      case "weekend_exceptions": {
        const parsed = parseToggle(value);
        if (parsed === null) invalid(key);
        else config.exceptions.weekends = parsed;
        break;
      }
      case "due_soon_workdays": {
        const parsed = parseBoundedInt(value, 1, 10);
        if (parsed === null) invalid(key);
        else config.thresholds.dueSoonWorkdays = parsed;
        break;
      }
      case "waiting_days": {
        const parsed = parseBoundedInt(value, 1, 60);
        if (parsed === null) invalid(key);
        else config.thresholds.waitingDays = parsed;
        break;
      }
      case "stale_project_days": {
        const parsed = parseBoundedInt(value, 2, 90);
        if (parsed === null) invalid(key);
        else config.thresholds.staleProjectDays = parsed;
        break;
      }
      case "in_progress_max": {
        const parsed = parseBoundedInt(value, 1, 20);
        if (parsed === null) invalid(key);
        else config.thresholds.inProgressMax = parsed;
        break;
      }
      case "mute": {
        const parsed = parseMute(value);
        if (parsed === null) warnings.push("invalid mute entry ignored");
        else config.mutes.push(parsed);
        break;
      }
    }
  }

  // The ordinary cap can never exceed the absolute one.
  if (config.exceptions.preferredPerDay > config.exceptions.maxPerDay) {
    warnings.push("exceptions_per_day exceeds exceptions_max_per_day; using the maximum");
    config.exceptions.preferredPerDay = config.exceptions.maxPerDay;
  }

  return { config, source: "memory", warnings, unknownKeys };
}

// --- Boundaries ---------------------------------------------------------------------------------

/**
 * Where the adapter obtains `/rhythm.md` text (null = file absent). Throwing means "unknown": the
 * scheduler then skips the tick rather than guessing. The production implementation is the one reviewed
 * read-only Memory API exception, `rhythmMemoryConfig.ts` (docs/62 §3).
 */
export interface RhythmConfigSource {
  read(): Promise<string | null>;
}

export interface RhythmActivation {
  enabled: boolean;
  /** Content-free reason for the startup log. */
  reason: string;
}

/**
 * Process-level kill switch. The rhythm is OFF unless the host explicitly sets
 * `DJONIK_WORKING_RHYTHM=on`; anything else (absent, empty, typo) keeps it off. Deploying this source
 * therefore changes nothing until a separately authorized activation stage sets the variable.
 *
 * Setting it is not enough on its own: Working Rhythm must not be activated in production until a later
 * bounded stage establishes a genuine pre-execution read-only boundary for autonomous ritual/exception
 * turns. The scheduler refuses to run without one (`AutonomousReadOnlyBoundary` in `rhythmRunner.ts`).
 */
export function resolveRhythmActivation(env: NodeJS.ProcessEnv): RhythmActivation {
  const raw = env.DJONIK_WORKING_RHYTHM;
  if (raw === undefined || raw.trim() === "") return { enabled: false, reason: "DJONIK_WORKING_RHYTHM not set" };
  if (raw.trim() === "on") return { enabled: true, reason: "DJONIK_WORKING_RHYTHM=on" };
  return { enabled: false, reason: "DJONIK_WORKING_RHYTHM is not exactly 'on'" };
}

/** A compact, content-free description of the effective settings for a scheduled turn's prompt. */
export function describeRhythmConfig(config: RhythmConfig): string {
  const t = (value: LocalMinutes | null) => (value === null ? "вимкнено" : formatLocalTime(value));
  const names = ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"];
  return [
    `робочі дні: ${config.workdays.map((d) => names[d]).join(", ")}`,
    `ранковий бриф: ${t(config.morning)}`,
    `план тижня (пн): ${t(config.mondayPlan)}`,
    `пт зранку: ${t(config.fridayMorning)}`,
    `огляд тижня (пт): ${t(config.fridayReview)}`,
    `тиха зона: ${formatLocalTime(config.quietHours.start)}–${formatLocalTime(config.quietHours.end)}`,
  ].join("; ");
}
