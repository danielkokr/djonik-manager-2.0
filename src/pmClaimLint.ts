/** Offline benchmark lint. Reply and evidence text are transient; callers persist findings only. */
export type ClaimType = "weekday" | "date" | "duration" | "size" | "client_expectation" | "missing_due_inference";
export interface ClaimEvidence {
  /** Only concrete slots actually available to this turn. Earlier model answers are excluded. */
  slots: readonly { type: ClaimType; value: string; source: "daniel" | "clock" | "trello" | "memory" }[];
  /** Daniel's available time is context, never a task-duration estimate. */
  availableMinutes?: number;
  dueKnown?: boolean;
}
export interface ClaimFinding { type: ClaimType; value: string; confidence: "high" | "review" }

const DAYS: Record<string, string> = {
  "пн": "пн", "понеділок": "пн", "понеділка": "пн", "понеділокові": "пн",
  "вт": "вт", "вівторок": "вт", "вівторка": "вт", "ср": "ср", "середа": "ср", "середу": "ср",
  "чт": "чт", "четвер": "чт", "четверга": "чт", "пт": "пт", "пʼятниця": "пт", "п'ятницю": "пт",
  "сб": "сб", "субота": "сб", "нд": "нд", "неділя": "нд",
};
const WEEKDAY = /(?<![\p{L}])(?:понеділок|понеділка|вівторок|вівторка|середа|середу|четвер|четверга|п[ʼ']ятниця|п[ʼ']ятницю|субота|неділя|пн|вт|ср|чт|пт|сб|нд)(?![\p{L}])/giu;
const DATE = /(?<!\d)\d{1,2}\.\d{1,2}(?:\.\d{4})?(?!\d)/gu;
const DURATION = /(?<!\d)(\d+(?:[.,]\d+)?)\s*(хв(?:илин[а-я]*)?|год(?:ин[а-я]*)?|h|min)(?![\p{L}])/giu;
const SIZE = /\b(?:size\s*[:=]\s*)?(?:XS|S|M|L|XL)\b/giu;
const CLIENT = /(?:клієнт|замовник)\s+(?:чекає|очікує|просив|обіцяв)|(?:обіця[вл]|показ)\p{L}*\s+(?:клієнт|замовник)/giu;
const MISSING_DUE = /(?:без\s+(?:дедлайну|due)|немає\s+(?:дедлайну|due))[^.!?\n]{0,55}(?:(?:може|можна)\s+почекати|не\s+термінов|не\s+горить)/giu;

function normalize(type: ClaimType, value: string): string {
  const lowered = value.toLowerCase().replace(/\s+/g, "").replace(/'/g, "ʼ");
  if (type === "weekday") return DAYS[lowered] ?? lowered;
  if (type === "date") return lowered.split(".").map((part, i) => i < 2 ? part.padStart(2, "0") : part).join(".");
  if (type === "duration") {
    const match = value.match(DURATION);
    if (match) {
      const amount = Number.parseFloat(value.replace(",", "."));
      return `${amount}${/год|\bh\b/iu.test(value) ? "год" : "хв"}`;
    }
  }
  if (type === "size") return value.replace(/^size\s*[:=]\s*/iu, "").toUpperCase();
  return type === "client_expectation" ? lowered : "missing_due_inference";
}

export function lintConcreteClaims(reply: string, evidence: ClaimEvidence): ClaimFinding[] {
  const found: ClaimFinding[] = [];
  const seen = new Set<string>();
  const add = (type: ClaimType, raw: string, confidence: ClaimFinding["confidence"] = "high") => {
    const value = normalize(type, raw);
    const key = `${type}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    const supported = evidence.slots.some((slot) => slot.type === type && normalize(type, slot.value) === value &&
      // The clock establishes today's date/weekday, not a client event or task deadline.
      (slot.source !== "clock" || type === "date" || type === "weekday"));
    if (!supported) found.push({ type, value, confidence });
  };
  const polarity = (index: number): ClaimFinding["confidence"] => {
    const clause = reply.slice(Math.max(0, index - 55), Math.min(reply.length, index + 30));
    return /(?:не\s+погодж|невідом|немає|гіпотетич|умовн|припущен)/iu.test(clause) ? "review" : "high";
  };
  for (const match of reply.matchAll(WEEKDAY)) add("weekday", match[0], polarity(match.index));
  for (const match of reply.matchAll(DATE)) add("date", match[0], polarity(match.index));
  for (const match of reply.matchAll(DURATION)) {
    const value = normalize("duration", match[0]);
    // When the reply repeats Daniel's own available-time budget, it is not task effort.
    const amount = Number.parseFloat(value);
    const minutes = value.endsWith("год") ? amount * 60 : amount;
    if (minutes === evidence.availableMinutes && /(?:маю|є|залишил|лишил|вільн)/iu.test(reply.slice(Math.max(0, match.index - 30), match.index))) continue;
    add("duration", match[0]);
  }
  for (const match of reply.matchAll(SIZE)) if (/size\s*[:=]|\b(?:XS|XL)\b/iu.test(match[0])) add("size", match[0], "review");
  for (const match of reply.matchAll(CLIENT)) add("client_expectation", match[0], "review");
  if (evidence.dueKnown === false) for (const match of reply.matchAll(MISSING_DUE)) add("missing_due_inference", match[0]);
  return found;
}
