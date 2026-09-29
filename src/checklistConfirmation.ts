import { identifiersMatch, isConfirmed, type MutationOutcome } from "./trelloMutationLedger.js";

/**
 * #57: the user-facing confirmation of verified checklist writes is code-owned.
 *
 * Production showed a verified checklist turn whose reply — the model's own text, shown verbatim — ended with the
 * Trello MCP item state enum («Усі три INCOMPLETE») and led with the verification mechanics («Підтверджено
 * читанням: …»). The enum reaches the model only through the provider's tool result, which the runtime cannot rewrite,
 * and the Skill that shapes this wording is pinned by the serving release. So, as for the verified due (#23/#44), the
 * wrapper states what was added and where from the ledger's own facts — checklist name, item names, the card's name
 * when a card read in this turn named it — and never an item state, id, tool name or read mechanics.
 *
 * The model's text is never edited. It may follow the code block verbatim only when it neither restates the checklist
 * (which the block owns) nor carries provider checklist-state vocabulary. It reads only the model's reply and the
 * ledger, never Daniel's words, and changes nothing about what was written or how it was verified.
 */

type ChecklistOutcome = MutationOutcome & { checklist: NonNullable<MutationOutcome["checklist"]> };

function effectiveChecklistOutcomes(outcomes: MutationOutcome[]): ChecklistOutcome[] {
  return outcomes.filter((o): o is ChecklistOutcome => o.checklist !== undefined && isConfirmed(o) && !o.superseded);
}

const COUNT_INSTRUMENTAL: readonly string[] = [
  "", "одним пунктом", "двома пунктами", "трьома пунктами", "чотирма пунктами", "пʼятьма пунктами",
  "шістьма пунктами", "сімома пунктами", "вісьмома пунктами", "девʼятьма пунктами", "десятьма пунктами",
];

const quote = (text: string) => `«${text.trim()}»`;

interface Group {
  checklistId: string | null;
  create: ChecklistOutcome | null;
  items: ChecklistOutcome[];
}

function groupByChecklist(outcomes: ChecklistOutcome[]): Group[] {
  const groups: Group[] = [];
  for (const outcome of outcomes) {
    const id = outcome.checklist.checklistId;
    let group = id === null ? undefined : groups.find((g) => g.checklistId !== null && identifiersMatch(g.checklistId, id));
    if (!group) {
      group = { checklistId: id, create: null, items: [] };
      groups.push(group);
    }
    if (outcome.checklist.action === "create") group.create = outcome;
    else group.items.push(outcome);
  }
  return groups;
}

function describeGroup(group: Group): string {
  const itemNames = group.items.map((item) => quote(item.checklist.name));
  if (group.create) {
    const cardName = group.create.checklist.cardName;
    const head = cardName ? `На ${quote(cardName)} додав чекліст ${quote(group.create.checklist.name)}` : `Додав чекліст ${quote(group.create.checklist.name)}`;
    if (itemNames.length === 0) return `${head}.`;
    const count = COUNT_INSTRUMENTAL[itemNames.length] ?? `${itemNames.length} пунктами`;
    return `${head} з ${count}: ${itemNames.join(", ")}.`;
  }
  const checklistName = group.items.find((item) => item.checklist.checklistName)?.checklist.checklistName;
  const into = checklistName ? `У чекліст ${quote(checklistName)}` : "У чекліст";
  return `${into} додав ${itemNames.length === 1 ? "пункт" : "пункти"}: ${itemNames.join(", ")}.`;
}

/** The code-owned confirmation of this turn's verified checklist writes, or null when there are none. `lead` is
 *  false when it follows another code-owned confirmation (the #23 due block), so «Готово.» is not repeated. */
export function buildChecklistConfirmation(outcomes: MutationOutcome[], lead = true): string | null {
  const checklistOutcomes = effectiveChecklistOutcomes(outcomes);
  if (checklistOutcomes.length === 0) return null;
  const lines = groupByChecklist(checklistOutcomes).map(describeGroup).join("\n");
  return lead ? `Готово. ${lines}` : lines;
}

/**
 * #57 mixed turns: one deterministic line acknowledging this turn's confirmed NON-checklist writes (card fields,
 * project label), used whenever the model's text — which would otherwise report them — is not shown beside the
 * checklist block. Names only a card the verified outcomes already name (a write's own confirmed card name, or the
 * card a verified checklist create named); never ids, tool names or verification mechanics. Null when there is none.
 */
export function otherVerifiedWritesLine(outcomes: MutationOutcome[]): string | null {
  const others = outcomes.filter((o) => !o.checklist && isConfirmed(o) && !o.superseded);
  if (others.length === 0) return null;
  const creates = effectiveChecklistOutcomes(outcomes).filter((o) => o.checklist.action === "create" && o.checklist.cardName);
  const names: string[] = [];
  for (const outcome of others) {
    const name = outcome.label
      ?? creates.find((c) => c.targetCardIds.some((id) => outcome.targetCardIds.some((other) => identifiersMatch(id, other))))?.checklist.cardName
      ?? null;
    if (name === null) return "Інші зміни в Trello також підтверджені.";
    if (!names.includes(name)) names.push(name);
  }
  return names.length === 1
    ? `Зміни картки ${quote(names[0])} також підтверджені.`
    : `Зміни карток ${names.map(quote).join(", ")} також підтверджені.`;
}

/** The checklist/item names of this turn's verified checklist writes (what the code block states). */
function checklistNames(outcomes: MutationOutcome[]): string[] {
  return effectiveChecklistOutcomes(outcomes).flatMap((o) => [o.checklist.name, o.checklist.checklistName ?? ""]).filter((n) => n.trim());
}

const L = "\\p{L}";
/** Provider checklist item-state vocabulary (Trello MCP `INCOMPLETE`/`COMPLETE`, REST `incomplete`/`complete`). */
const PROVIDER_STATE = new RegExp(`(?<!${L})(?:in)?complete(?!${L})`, "iu");
/** A statement about the checklist or its items: the code block owns that. */
const CHECKLIST_CLAIM = new RegExp(`(?<!${L})(?:чек-?ліст${L}*|checklists?|пункт${L}*)(?!${L})`, "iu");

/** What happened to the model's text beside a code-owned checklist confirmation (content-free trace value). */
export type ChecklistCommentaryMode =
  | "none"
  | "appended"
  | "redundant"
  /** Withheld: it restates the checklist or its items, which the code block already states. */
  | "withheld_restatement"
  /** Withheld: it carries raw provider checklist-state vocabulary. */
  | "withheld_provider_state";

/**
 * The code block first, then — only when the gate allows — the model's text verbatim after one blank line.
 * `restatementOwned` is false when the turn also confirmed a non-checklist write the model's text may be reporting;
 * the text is then withheld only for provider vocabulary, never for mentioning the checklist.
 */
export function composeChecklistReply(
  block: string,
  commentary: string | null,
  outcomes: MutationOutcome[],
  restatementOwned: boolean,
): { text: string; mode: ChecklistCommentaryMode } {
  const trimmed = (commentary ?? "").trim();
  if (trimmed.length === 0) return { text: block, mode: "none" };
  const core = trimmed.replace(/[.!…\s]+$/u, "").toLocaleLowerCase("uk");
  if (core.length > 0 && block.toLocaleLowerCase("uk").includes(core)) return { text: block, mode: "redundant" };
  if (PROVIDER_STATE.test(trimmed)) return { text: block, mode: "withheld_provider_state" };
  if (restatementOwned) {
    const lower = trimmed.toLocaleLowerCase("uk");
    const namesIt = checklistNames(outcomes).some((name) => lower.includes(name.trim().toLocaleLowerCase("uk")));
    if (namesIt || CHECKLIST_CLAIM.test(trimmed)) return { text: block, mode: "withheld_restatement" };
  }
  return { text: `${block}\n\n${trimmed}`, mode: "appended" };
}
