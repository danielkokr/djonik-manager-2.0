/**
 * #44 (S11 mixed verified-write blocker): may the model's own text of a verified due-write turn be shown after the
 * code-owned #23 due confirmation?
 *
 * #23 made the verified due sentence code-owned because the model mis-stated weekdays, dates and times of the value it
 * had just written. Showing the model's text beside that sentence must never reintroduce a second, competing statement
 * of what Trello saved. The model's text is therefore NEVER edited or patched: this gate only decides, as a whole,
 * whether it may follow the code block verbatim. It is withheld when it makes ANY calendar reference — a weekday, a
 * date, a clock time, a relative day or a relative span — so on a due-write turn the only calendar statement Daniel
 * can see is the code's. It is also withheld when it makes its own claim about the due or a write's result (a due
 * noun or a write-result verb), so the code alone says whether and how the write succeeded. Both lexicons are closed
 * and conservative: a false positive merely falls back to the pre-#44 #23 behaviour (the due confirmation alone); a
 * false negative would need a due/write claim with none of those words. It reads only the model's reply, never
 * Daniel's words, and routes nothing.
 */

const L = "\\p{L}";
const word = (body: string) => `(?<!${L})(?:${body})(?!${L})`;

const CALENDAR_PATTERNS: readonly RegExp[] = [
  // Weekdays: full Ukrainian forms (never the preposition «серед»), abbreviations, English names.
  new RegExp(word(`понеділ${L}*|вівтор${L}*|середа|середу|середи|середою|четвер${L}*|п['ʼ’]?ятниц${L}*|субот${L}*|неділ[яіюею]${L}*`), "iu"),
  new RegExp(word("пн|вт|ср|чт|пт|сб|нд"), "iu"),
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // Relative days and spans.
  new RegExp(word(`сьогодн${L}*|післязавтра${L}*|завтра${L}*|позавчора${L}*|[ву]чора${L}*`), "iu"),
  new RegExp(`(?<!${L})(?:наступн|минул|позаминул)${L}*\\s+(?:тижн${L}*|місяц${L}*)`, "iu"),
  new RegExp(`(?<!${L})через\\s+(?:\\d+|один|одну|два|дві|три|чотири|пʼять|п'ять|кілька|декілька)\\s+(?:дн${L}*|тижн${L}*|день|годин${L}*)`, "iu"),
  // Dates: day + month name, numeric day.month(.year), ISO dates.
  new RegExp(`(?<!\\d)\\d{1,2}\\s+(?:січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?!${L})`, "iu"),
  /(?<![\d.])(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.\d{2,4})?(?![\d])/u,
  /\b\d{4}-\d{2}-\d{2}/,
  // Clock times.
  /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/,
];

/** True when `text` makes any calendar reference the #23 due confirmation could be contradicted by. */
export function mentionsCalendar(text: string): boolean {
  return CALENDAR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The second closed lexicon (#44 PL review): a claim of the model's own about the due or about whether/how a write
 * succeeded — «Дедлайн не зберігся», «Дедлайн встановлено», «Я поставив дедлайн», «Trello не оновив картку», «Зміни не
 * записались» — with no calendar word in it. On a verified due-write turn the code exclusively owns such claims, so any
 * due/deadline noun or write-result verb withholds the whole text. Conservative by design: a false positive (e.g. «клієнт
 * підтвердив концепт») only falls back to the code-owned due sentence alone.
 */
const MUTATION_CLAIM_PATTERNS: readonly RegExp[] = [
  // The due itself: any mention is a claim the code block already owns.
  new RegExp(word(`дедлайн${L}*|термін|терміну|терміном|терміни|строк|строку|строки|due|deadlines?`), "iu"),
  // Write-result verbs (never the bare nouns «зміни», «поставка»): saved, written, updated, set, put, changed, moved, confirmed.
  new RegExp(word(`збер[еіо]г${L}*|збереж${L}*|запис${L}*|онов${L}*|встанов${L}*|постав(?:ив|ила|или|ило|лено|лена|лений|ити|лю|ивсь|илось)|змін(?:ив|ила|или|ило|ено|ена|ився|илась|илося|ились)|перен[еі]с${L}*|підтверд${L}*`), "iu"),
  /\b(?:saved|updated|changed|confirmed|failed to (?:save|update|set)|(?:was|were|is) (?:not )?(?:set|saved|updated))\b/i,
];

/** True when `text` makes its own claim about the due or about a write's result (see `MUTATION_CLAIM_PATTERNS`). */
export function mentionsDueMutationClaim(text: string): boolean {
  return MUTATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/** What happened to the model's text on a verified due-write turn (content-free trace value). */
export type DueCommentaryMode =
  /** The model wrote nothing (or only whitespace): the code block is the whole reply. */
  | "none"
  /** Shown verbatim after the code block: no calendar reference, no mismatch. */
  | "appended"
  /** Not appended: the code block already contains it verbatim (e.g. «Готово.»), so it would only repeat. */
  | "redundant"
  /** Withheld: it makes a calendar reference that could compete with the verified due. */
  | "withheld_calendar"
  /** Withheld: it makes its own claim about the due or a write's result, which the code block owns. */
  | "withheld_mutation_claim"
  /** Withheld: Trello holds a different due than was sent, so the mismatch report stands alone. */
  | "withheld_mismatch";

/**
 * The code-owned mutation block first, then — only when the gate allows — the model's text verbatim after one blank
 * line. No label: one Djonik answers. `mismatch` is true when any verified due differs from the value that was sent.
 */
export function composeVerifiedDueReply(block: string, commentary: string | null, mismatch: boolean): { text: string; mode: DueCommentaryMode } {
  const trimmed = (commentary ?? "").trim();
  if (trimmed.length === 0) return { text: block, mode: "none" };
  if (mismatch) return { text: block, mode: "withheld_mismatch" };
  // Redundancy is an exact containment check, not a classification of what the text means.
  const core = trimmed.replace(/[.!…\s]+$/u, "").toLocaleLowerCase("uk");
  if (core.length > 0 && block.toLocaleLowerCase("uk").includes(core)) return { text: block, mode: "redundant" };
  if (mentionsCalendar(trimmed)) return { text: block, mode: "withheld_calendar" };
  if (mentionsDueMutationClaim(trimmed)) return { text: block, mode: "withheld_mutation_claim" };
  return { text: `${block}\n\n${trimmed}`, mode: "appended" };
}
