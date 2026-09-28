/**
 * #51 client profiles — offline evaluation and validation tooling only. Pure; no I/O, no Memory API, and never imported
 * by the serving path. At runtime Claude reads and edits the one project brief (`projects/<slug>.md`) with its native
 * Memory tools, under the Memory instructions and the planning-and-focus Skill; nothing here parses, caches or rewrites
 * production Memory.
 *
 * Two uses:
 *  - `lintProfileBrief(before, after)` checks that an enriched brief (a fixture, or a later authorised read-back)
 *    preserves the existing #17 content, adds each fact once, carries provenance on new lines, and holds no personality
 *    label or live Trello state. Heuristic by design: it screens, it does not judge meaning.
 *  - `resolveContact(sender, briefs)` is the benchmark's oracle for the contact decoder: exact recorded name/alias →
 *    unique / ambiguous / unmatched, and a hidden sender is `unknown`. Message text is never an input.
 */

/** Profile sections #51 adds inside the existing brief (docs/88 §5). */
export const PROFILE_SECTIONS = ["Contacts", "Expectations", "Approval", "Typical edits / friction"] as const;

/** A new line's provenance: Daniel said or confirmed it; the date is the clock line's, or absent. */
export const PROVENANCE = /\(сказав Daniel(?:, \d{2}\.\d{2}\.\d{4})?\)\.?$/u;

/** Observable conventions only: labels about a person's character are never profile facts. */
const PERSONALITY = /складн\p{L}*|емоційн\p{L}*|токсичн\p{L}*|тривожн\p{L}*|ірраціональн\p{L}*|(?:важк|легк|поган|хорош)\p{L}*\s+клієнт|\b(?:difficult|emotional|toxic|anxious|irrational|easy client|bad client)\b/iu;

/** Live Trello state belongs to fresh reads, never to a brief. */
const LIVE_STATE = /\b(?:due|In progress|Waiting|Backlog|To do|Done)\b|дедлайн\p{L}*|спринт\p{L}*|картк\p{L}*/iu;

export type ProfileFindingType =
  | "lost_existing_line" | "duplicate_fact" | "missing_provenance" | "backdated_provenance"
  | "personality_label" | "live_state" | "same_subject_twice";
export interface ProfileFinding { type: ProfileFindingType; line: string }

const normalize = (line: string) => line.trim().replace(/^[-*]\s+/, "").replace(/\s+/g, " ");
const isHeading = (line: string) => /^[^:]+:$/.test(line) || /^#/.test(line);
const factLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map(normalize).filter((line) => line && !isHeading(line));

/** The section each fact line sits under (a `Heading:` line starts one). */
function sectioned(text: string): Array<{ section: string; line: string }> {
  let section = "";
  const out: Array<{ section: string; line: string }> = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = normalize(raw);
    if (!line) continue;
    if (/^[^:]+:$/.test(line)) { section = line.slice(0, -1); continue; }
    if (!/^#/.test(line)) out.push({ section, line });
  }
  return out;
}

/**
 * `before`: the existing brief. `after`: the brief after one or more #51 updates. `superseded`: stale lines a
 * correction replaced (they may disappear; a correction does not keep both).
 */
export function lintProfileBrief(before: string, after: string, superseded: readonly string[] = []): ProfileFinding[] {
  const findings: ProfileFinding[] = [];
  const old = factLines(before);
  const next = factLines(after);
  const stale = new Set(superseded.map(normalize));
  const withoutProvenance = (line: string) => line.replace(PROVENANCE, "").trim();
  for (const line of old) {
    if (next.includes(line) || stale.has(line)) continue;
    if (!PROVENANCE.test(line) && next.some((candidate) => PROVENANCE.test(candidate) && withoutProvenance(candidate) === line)) {
      findings.push({ type: "backdated_provenance", line });
    } else findings.push({ type: "lost_existing_line", line });
  }
  const seen = new Set<string>();
  for (const line of next) {
    const key = withoutProvenance(line).toLowerCase();
    if (seen.has(key)) findings.push({ type: "duplicate_fact", line });
    seen.add(key);
  }
  const added = next.filter((line) => !old.includes(line));
  for (const line of added) {
    if (!PROVENANCE.test(line) && !old.includes(withoutProvenance(line))) findings.push({ type: "missing_provenance", line });
    if (PERSONALITY.test(line)) findings.push({ type: "personality_label", line });
    if (LIVE_STATE.test(line)) findings.push({ type: "live_state", line });
  }
  const subjects = new Map<string, number>();
  for (const { section, line } of sectioned(after)) {
    if (!(PROFILE_SECTIONS as readonly string[]).includes(section) || !line.includes(" — ")) continue;
    const key = `${section}|${line.split(" — ")[0].replace(/\s*\(.*\)$/, "").toLowerCase()}`;
    subjects.set(key, (subjects.get(key) ?? 0) + 1);
    if (subjects.get(key) === 2) findings.push({ type: "same_subject_twice", line });
  }
  return findings;
}

export interface ContactEntry { project: string; person: string; aliases: string[]; role: string }

/**
 * Under `Contacts:` (or a #17 brief's own contact line anywhere): `- Name (alias, alias) — role (сказав Daniel, …)` and
 * the pre-existing #17 form `Decision-makers / important contacts: Ivan, Zhenya.` (single-word names only). Other lines
 * are context, not a decoder.
 */
export function parseContacts(project: string, brief: string): ContactEntry[] {
  return sectioned(brief).flatMap(({ section, line }) => {
    const legacy = line.match(/^(Decision-makers?(?: \/ important contacts)?):\s*(.+?)\.?$/u);
    if (legacy) {
      const names = legacy[2].split(/,\s*|\s+and\s+/u).map((name) => name.trim());
      return names.every((name) => /^\p{L}+$/u.test(name))
        ? names.map((person) => ({ project, person, aliases: [], role: legacy[1] })) : [];
    }
    if (section !== "Contacts") return [];
    const match = line.match(/^([^(—]+?)(?:\s+\(([^)]*)\))?\s+—\s+(.+)$/u);
    if (!match) return [];
    return [{ project, person: match[1].trim(), aliases: (match[2] ?? "").split(",").map((alias) => alias.trim()).filter(Boolean),
      role: match[3].replace(PROVENANCE, "").trim() }];
  });
}

export type ContactResolution =
  | { kind: "unique"; project: string; person: string }
  | { kind: "ambiguous"; projects: string[] }
  | { kind: "unmatched" }
  | { kind: "unknown" };

/** Exact, case-insensitive name/alias match on the Telegram sender only. A hidden sender (`null`) is unknown. */
export function resolveContact(sender: string | null, briefs: Readonly<Record<string, string>>): ContactResolution {
  if (sender === null || !sender.trim()) return { kind: "unknown" };
  const wanted = sender.trim().toLocaleLowerCase("uk");
  const hits = Object.entries(briefs).flatMap(([project, brief]) => parseContacts(project, brief))
    .filter((entry) => [entry.person, ...entry.aliases].some((name) => name.toLocaleLowerCase("uk") === wanted));
  const projects = [...new Set(hits.map((hit) => hit.project))];
  const people = new Set(hits.map((hit) => `${hit.project}|${hit.person.toLocaleLowerCase("uk")}`));
  if (hits.length === 0) return { kind: "unmatched" };
  if (people.size > 1) return { kind: "ambiguous", projects };
  return { kind: "unique", project: hits[0].project, person: hits[0].person };
}
