/**
 * #59 project identity — offline evaluation tooling only. Pure; no I/O, no Memory API, and never imported by the
 * serving path. At runtime Claude resolves Daniel's word for a project through the briefs it reads natively from
 * Memory (`projects/<slug>.md`), under the coordinator prompt and task-management, and then passes the fresh Trello
 * label to Trello tools (`trello_work_history`, `trelloWriteCard` `attach_label`, …). Nothing here parses, caches or
 * rewrites production Memory, and there is no project registry: every name comes from the brief text it is given.
 *
 * `resolveProjectName(word, briefs, labels)` is the benchmark's oracle for that contract:
 *  - a project's names are its brief's title (`# Азов / A1` → «Азов», «A1») and its `Aliases:` line;
 *  - the word resolves to the one brief that records it, then to the one fresh label equal to one of that brief's names;
 *  - a word no brief records resolves only if it is itself exactly one label;
 *  - two briefs, two matching labels, or a word that is another project's label → ambiguous; nothing similar is guessed.
 * Matching is exact up to case and spacing. Grammatical forms («по Азову») are the model's job; the oracle takes the
 * base form a scenario author chose.
 */

export type ProjectResolution =
  | { kind: "resolved"; project: string | null; label: string }
  | { kind: "no_label"; project: string }
  | { kind: "ambiguous"; projects: string[]; labels: string[] }
  | { kind: "unknown" };

const key = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("uk");

/** A brief's own names: its `# ` title split on «/», and its `Aliases:` line split on commas. */
export function briefNames(brief: string): string[] {
  const lines = brief.replace(/\r\n?/g, "\n").split("\n");
  const title = lines.find((line) => /^#\s+\S/.test(line))?.replace(/^#\s+/, "") ?? "";
  const aliases = lines.find((line) => /^Aliases:/i.test(line.trim()))?.trim().replace(/^Aliases:\s*/i, "") ?? "";
  const names = [...title.split("/"), ...aliases.split(",")]
    .map((name) => name.trim().replace(/\.$/, "").trim())
    .filter(Boolean);
  return [...new Map(names.map((name) => [key(name), name])).values()];
}

export function resolveProjectName(word: string, briefs: Readonly<Record<string, string>>, labels: readonly string[]): ProjectResolution {
  const wanted = key(word);
  if (!wanted) return { kind: "unknown" };
  const named = Object.entries(briefs).filter(([, brief]) => briefNames(brief).some((name) => key(name) === wanted)).map(([slug]) => slug);
  const literal = labels.filter((label) => key(label) === wanted);
  if (named.length > 1) return { kind: "ambiguous", projects: named, labels: literal };
  if (named.length === 0) {
    if (literal.length === 1) return { kind: "resolved", project: null, label: literal[0] };
    return literal.length > 1 ? { kind: "ambiguous", projects: [], labels: literal } : { kind: "unknown" };
  }
  const project = named[0];
  const names = new Set(briefNames(briefs[project]).map(key));
  const matching = labels.filter((label) => names.has(key(label)));
  // The word is literally a label that is not one of this project's names: two projects are meant.
  if (literal.some((label) => !matching.includes(label))) return { kind: "ambiguous", projects: [project], labels: [...matching, ...literal] };
  if (matching.length === 1) return { kind: "resolved", project, label: matching[0] };
  return matching.length === 0 ? { kind: "no_label", project } : { kind: "ambiguous", projects: [project], labels: matching };
}
