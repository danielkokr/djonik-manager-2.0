import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { FIXTURE_REVISION, type Scenario } from "./pmBenchmark.js";

export interface EvalCard {
  key: string; title: string; project: "Seqthera" | "Extract" | "Azov" | "A1" | "Limen" | "Cossack Labs";
  list: "To do" | "In progress" | "Waiting" | "Done";
  due?: string; size?: "S" | "M" | "XL"; checklist?: { done: number; total: number };
}
export const EVAL_BOARD_NAME = "Djonik Eval";
export const EVAL_LISTS = ["To do", "In progress", "Waiting", "Done"] as const;
export const EVAL_CARDS: readonly EvalCard[] = [
  { key: "seq-concept", title: "[EVAL] Seqthera — концепт", project: "Seqthera", list: "In progress", size: "M" },
  { key: "seq-pack", title: "[EVAL] Seqthera — паковання", project: "Seqthera", list: "To do", size: "XL" },
  { key: "seq-site", title: "[EVAL] Seqthera — сайт", project: "Seqthera", list: "To do", size: "S" },
  { key: "ext-pack", title: "[EVAL] Extract — паковання", project: "Extract", list: "In progress", size: "S", checklist: { done: 4, total: 5 } },
  { key: "ext-brief", title: "[EVAL] Extract — бриф", project: "Extract", list: "Waiting" },
  { key: "ext-logo", title: "[EVAL] Extract — логотип", project: "Extract", list: "To do" },
  { key: "az-banner-a", title: "[EVAL] Azov — банер збору A", project: "Azov", list: "In progress" },
  { key: "az-banner-b", title: "[EVAL] Azov — банер збору B", project: "Azov", list: "To do" },
  { key: "az-guides", title: "[EVAL] Azov — гайд", project: "Azov", list: "Done" },
  { key: "limen-flow", title: "[EVAL] Limen — флоу", project: "Limen", list: "In progress" },
  { key: "limen-roadmap", title: "[EVAL] Limen — roadmap", project: "Limen", list: "To do" },
  { key: "cl-deck", title: "[EVAL] Cossack Labs — deck", project: "Cossack Labs", list: "In progress", due: "2026-09-29T12:00:00.000Z" },
  { key: "cl-site", title: "[EVAL] Cossack Labs — сайт", project: "Cossack Labs", list: "To do" },
  { key: "cl-doc", title: "[EVAL] Cossack Labs — документ", project: "Cossack Labs", list: "Done" },
  { key: "seq-followup", title: "[EVAL] Seqthera — фідбек клієнта", project: "Seqthera", list: "Waiting" },
];
/**
 * #59: project-alias scenarios. Production names the Азов project with the Trello label «A1», not «Azov», and Daniel
 * says «Азов». In these scenarios the Azov cards carry «A1» and the real #17 brief excerpts (`Aliases: Азов, A1.`) are
 * the briefs. An older unused «Azov» label may remain on the dedicated eval board from other scenarios; it is not a name
 * the brief records, so the contract still selects «A1» (a near-miss distractor, never a second match).
 */
export const PROJECT_ALIAS_SCENARIOS = ["S42", "S43", "S44", "S45", "S46", "S47", "S48", "S49"];
/** #62 S49: Daniel's configured working day. S48 has no `/rhythm.md` at all — the production 2026-10-01 case. */
export const S49_RHYTHM = "work_hours: 10:00-18:00\n";
const isAliasScenario = (scenario: Scenario) => PROJECT_ALIAS_SCENARIOS.includes(scenario.id);
export function labelsForScenario(scenario: Scenario): EvalCard["project"][] {
  return isAliasScenario(scenario) ? ["Seqthera", "Extract", "A1", "Limen", "Cossack Labs"] : ["Seqthera", "Extract", "Azov", "Limen", "Cossack Labs"];
}
/** #59 S47: a second project whose recorded aliases also include «Азов» — the word then names two projects. */
export const S47_SECOND_AZOV_BRIEF = "# Фонд Азов\nEval fixture only; a second project whose recorded aliases share «Азов».\nAliases: Фонд Азов, Азов.\n";
export function cardsForScenario(scenario: Scenario): readonly EvalCard[] {
  if (isAliasScenario(scenario)) return EVAL_CARDS.map((card) => card.project === "Azov" ? { ...card, project: "A1" } : card);
  if (scenario.id === "S1") return EVAL_CARDS.map((card) =>
    card.key === "az-banner-a" || card.key === "cl-deck" ? { ...card, list: "To do" } : card);
  if (scenario.id === "S2") return EVAL_CARDS.map(({ size: _size, ...card }) => card);
  // #50 S22: nothing competes with the budgeted Seqthera concept — the Cossack Labs deck has no due.
  if (scenario.id === "S22") return EVAL_CARDS.map(({ due: _due, ...card }) => card);
  // #51 S26: no due or Size separates the Cossack Labs and Seqthera sites; only the recorded expectations differ.
  if (scenario.id === "S26") return EVAL_CARDS.map(({ due: _due, size: _size, ...card }) => card);
  // #44 S41: the concept (under an accepted review commitment) is unfinished; the site has a due and no commitment.
  if (scenario.id === "S41") return EVAL_CARDS.map((card) =>
    card.key === "seq-concept" ? { ...card, checklist: { done: 1, total: 4 } }
      : card.key === "seq-site" ? { ...card, due: "2026-09-29T12:00:00.000Z" } : card);
  return EVAL_CARDS;
}
export const EVAL_MEMORIES: Readonly<Record<string, string>> = {
  "/priorities.md": "Eval fixture only. Seqthera concept has an accepted client commitment. Limen remains important without a due date.",
  "/projects/seqthera.md": "Eval fixture only. Concept is in progress. No client presentation date has been agreed.",
  "/projects/extract.md": "Eval fixture only. Packaging is near completion. Feedback is waiting; no person has promised a response date.",
  "/working-style.md": "Eval fixture only. Daniel prefers one main choice and concise practical reasoning.",
  "/commitments/seqthera.md": "Eval fixture only. Accepted commitment: send the Seqthera concept for review. No date is recorded.",
};

/**
 * #51: representative excerpts of the PO-approved #17 briefs (issue #17 comment 2026-09-17, moved to `projects/` by #37),
 * without rates or other commercial detail. Eval-only; they stand in for "what the brief already says".
 */
export const ISSUE_17_BRIEF_EXCERPTS: Readonly<Record<string, string>> = {
  "extract": "# Extract\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Extract, Екстракт.\n" +
    "Working model:\n- communication is mostly async via messages;\n- collaboration can be slowed by long approvals;\n" +
    "- ambiguous or noncommittal client feedback is a recurring friction point.\n" +
    "Decision-maker: Anna is an important client-side decision-maker.\n",
  "cossack-labs": "# Cossack Labs\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Cossack Labs, CL.\n" +
    "Working model:\n- work is coordinated through calls and messages;\n- recurring sync calls: Tuesday 13:30 and Thursday 14:00.\n" +
    "Decision-makers / important contacts: Ivan, Zhenya.\n" +
    "Recurring friction:\n- ambiguous feedback;\n- high perfectionism from a key decision-maker can prolong iterations and approvals.\n",
  "seqthera": "# Seqthera\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Seqthera, Секютера, пептиди.\n" +
    "Client structure:\n- Daniel works through Anastasia as an intermediary;\n- there are three end-client decision-makers.\n" +
    "Recurring friction:\n- feedback can be indirect or difficult to interpret.\n",
  "azov-a1": "# Азов / A1\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Азов, A1.\n" +
    "Working model:\n- tasks arrive chaotically;\n- urgency is a recurring characteristic.\n" +
    "Decision-makers / important contacts: Ганнуся, Коля.\n",
};

/**
 * #51: the same briefs after eval-only interview answers. Every #17 line keeps its words (a heading may be normalised
 * into a profile section); new lines carry `(сказав Daniel, <clock date>)`. `lintProfileBrief` proves both.
 * Aliases are chosen so that «Аня» deliberately matches Extract and Seqthera (S29) and «Коля» only Azov (S28).
 */
export const EVAL_PROFILE_BRIEFS: Readonly<Record<string, string>> = {
  "extract": "# Extract\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Extract, Екстракт.\n" +
    "Working model:\n- communication is mostly async via messages;\n- collaboration can be slowed by long approvals;\n" +
    "Contacts:\n- Decision-maker: Anna is an important client-side decision-maker.\n" +
    "- Anna (Анна, Аня) — фінальне затвердження паковання (сказав Daniel, 28.09.2026)\n" +
    "Typical edits / friction:\n- ambiguous or noncommittal client feedback is a recurring friction point.\n",
  "cossack-labs": "# Cossack Labs\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Cossack Labs, CL.\n" +
    "Working model:\n- work is coordinated through calls and messages;\n- recurring sync calls: Tuesday 13:30 and Thursday 14:00.\n" +
    "Contacts:\n- Decision-makers / important contacts: Ivan, Zhenya.\n" +
    "Expectations:\n- Перенесення показу — зазвичай зсуває затвердження на наступний синк (сказав Daniel, 28.09.2026)\n" +
    "Typical edits / friction:\n- ambiguous feedback;\n- high perfectionism from a key decision-maker can prolong iterations and approvals.\n",
  "seqthera": "# Seqthera\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Seqthera, Секютера, пептиди.\n" +
    "Contacts:\n- Daniel works through Anastasia as an intermediary;\n- there are three end-client decision-makers.\n" +
    "- Anastasia (Анастасія, Настя, Аня) — посередниця, передає фідбек трьох рішення-приймачів (сказав Daniel, 28.09.2026)\n" +
    "Expectations:\n- Перенесення на кілька днів — зазвичай ок, якщо попередити (сказав Daniel, 28.09.2026)\n" +
    "Typical edits / friction:\n- feedback can be indirect or difficult to interpret.\n",
  "azov-a1": "# Азов / A1\nEval fixture only; excerpt of the approved #17 brief.\nAliases: Азов, A1.\n" +
    "Working model:\n- tasks arrive chaotically;\n- urgency is a recurring characteristic.\n" +
    "Contacts:\n- Decision-makers / important contacts: Ганнуся, Коля.\n" +
    "- Ганнуся — затверджує макети збору (сказав Daniel, 28.09.2026)\n- Коля — ставить задачі на соцмережі (сказав Daniel, 28.09.2026)\n" +
    "Expectations:\n- Ганнуся — зазвичай чекає відповідь того ж дня (сказав Daniel, 28.09.2026)\n",
};

/** #51 S30: three resolved Azov commitments whose accepted source quotes show the same short-turnaround request. */
const S30_COMMITMENTS: Readonly<Record<string, string>> = Object.fromEntries([
  ["banner-preview", "прев'ю банера", "Потрібно прев'ю банера сьогодні до вечора."],
  ["stories-set", "набір сторіз", "Терміново, сторіз треба на ранок."],
  ["poster-fix", "правки плаката", "Можна правки плаката сьогодні? Дуже горить."],
].map(([slug, outcome, quote]) => [`/commitments/azov-a1/${slug}.md`,
  `# ${outcome}\nproject: Азов / A1\ncard: none\nstatus: resolved\nwaiting_on: none\nnext_check: none\n` +
  `accepted: Daniel прийняв пропозицію з пересланого\nsource_sender: Ганнуся\nsource_quote: ${quote}\nclosed: Daniel сказав, що надіслав\n`]));

const PROFILE_SCENARIOS = ["S26", "S27", "S28", "S29", "S30"];

export function memoriesForScenario(scenario: Scenario): Record<string, string> {
  const memories = { ...EVAL_MEMORIES };
  if (Number(scenario.id.slice(1)) >= 31) {
    memories["/working-style.md"] = "# Спілкування\n- Одне головне рішення в плані (сказав Daniel, 2026-09-20)\n\n# Робота\n- Концепти краще ставити зранку (прийняв Daniel, 2026-09-21)\n";
    if (scenario.id === "S35") memories["/working-style.md"] = "# Спілкування\n- Докладні відповіді за замовчуванням (сказав Daniel, 2026-09-20)\n\n# Робота\n- Концепти краще ставити зранку (прийняв Daniel, 2026-09-21)\n";
  }
  if (PROFILE_SCENARIOS.includes(scenario.id)) {
    // #51: the enriched #17 briefs replace the one-line eval briefs; no accepted commitment competes with the profile.
    for (const [slug, brief] of Object.entries(EVAL_PROFILE_BRIEFS)) memories[`/projects/${slug}.md`] = brief;
    delete memories["/commitments/seqthera.md"];
    memories["/priorities.md"] = "Eval fixture only. No accepted commitments. Cossack Labs, Seqthera, Extract and Azov have comparable priority this week.";
    if (scenario.id === "S30") Object.assign(memories, S30_COMMITMENTS);
  }
  if (isAliasScenario(scenario)) {
    // #59: the approved #17 brief excerpts carry each project's title and Aliases line; nothing else changes.
    for (const [slug, brief] of Object.entries(ISSUE_17_BRIEF_EXCERPTS)) memories[`/projects/${slug}.md`] = brief;
    if (scenario.id === "S47") memories["/projects/azov-fund.md"] = S47_SECOND_AZOV_BRIEF;
    if (scenario.id === "S49") memories["/rhythm.md"] = S49_RHYTHM;
  }
  if (scenario.id === "S6") {
    memories["/commitments/extract.md"] = "Eval fixture only. Accepted external commitment: send Extract packaging review on Monday 28 September 2026. Daniel now says not to touch Extract today.";
  }
  if (scenario.id === "S23") {
    memories["/commitments/cossack-labs.md"] = "Eval fixture only. Accepted external commitment: send the Cossack Labs deck to the client by Tuesday 29 September 2026, 15:00 Kyiv. Status: active.";
  }
  if (scenario.id === "S41") {
    // #44: the one threatened thing is this accepted, dated review; nothing is recorded for the site or the feedback card.
    memories["/commitments/seqthera.md"] = "Eval fixture only. Accepted external commitment: send the Seqthera concept to the client for review by Wednesday 30 September 2026, 18:00 Kyiv. Status: active. Nothing else is promised for Seqthera.";
  }
  if (scenario.id === "S13") {
    delete memories["/commitments/seqthera.md"];
    memories["/priorities.md"] = "Eval fixture only. No accepted commitments or overdue tasks. Limen remains strategically important without a due date.";
  }
  return memories;
}

/** Driver functions must verify remote postconditions; the fixture orchestration never targets a production board. */
export interface EvalBoardDriver {
  assertDedicatedBoard(name: typeof EVAL_BOARD_NAME): Promise<void>;
  ensureLists(names: readonly string[]): Promise<void>;
  ensureProjectLabels(names: readonly EvalCard["project"][]): Promise<void>;
  ensureSizeField(): Promise<void>;
  resetCards(cards: readonly EvalCard[]): Promise<void>;
  verify(cards: readonly EvalCard[]): Promise<void>;
  waitingEnteredAt(key: string): Promise<string | null>;
}

export async function resetEvalFixture(driver: EvalBoardDriver, scenario: Scenario): Promise<{ evidenceAvailable: boolean; reason?: string }> {
  const cards = cardsForScenario(scenario);
  await driver.assertDedicatedBoard(EVAL_BOARD_NAME);
  await driver.ensureLists(EVAL_LISTS);
  await driver.ensureProjectLabels(labelsForScenario(scenario));
  await driver.ensureSizeField();
  await driver.resetCards(cards);
  await driver.verify(cards);
  if (scenario.requires === "days_in_list") {
    const entered = await driver.waitingEnteredAt("ext-brief");
    const elapsed = entered === null ? 0 : Date.parse("2026-09-28T09:00:00.000Z") - Date.parse(entered);
    if (!Number.isFinite(elapsed) || elapsed < 12 * 86_400_000) return { evidenceAvailable: false, reason: "waiting_age_not_established" };
  }
  return { evidenceAvailable: true };
}

/** Separate eval store; caller creates it intentionally and passes its ID. No production Memory paths are touched. */
export async function resetEvalMemory(client: Anthropic, memoryStoreId: string, scenario: Scenario): Promise<void> {
  if (!/^memstore_[\w-]+$/.test(memoryStoreId)) throw new Error("An explicit eval Memory store ID is required");
  const store = await client.beta.memoryStores.retrieve(memoryStoreId);
  if (store.name !== EVAL_BOARD_NAME || store.metadata?.purpose !== "djonik-eval") {
    throw new Error("Refusing to reset a non-eval Memory store");
  }
  const existing = new Map<string, { id: string; content_sha256: string }>();
  const desired = memoriesForScenario(scenario);
  for await (const item of client.beta.memoryStores.memories.list(memoryStoreId, { path_prefix: "/", view: "basic" })) {
    if (item.type === "memory") existing.set(item.path, { id: item.id, content_sha256: item.content_sha256 });
  }
  for (const [path, content] of Object.entries(desired)) {
    const old = existing.get(path);
    if (!old) await client.beta.memoryStores.memories.create(memoryStoreId, { path, content });
    else if (old.content_sha256 !== createHash("sha256").update(content).digest("hex")) {
      await client.beta.memoryStores.memories.update(old.id, { memory_store_id: memoryStoreId, content,
        precondition: { type: "content_sha256", content_sha256: old.content_sha256 } });
    }
  }
  for (const [path, old] of existing) if (!(path in desired)) await client.beta.memoryStores.memories.delete(old.id, { memory_store_id: memoryStoreId });
  const actual = new Map<string, string>();
  for await (const item of client.beta.memoryStores.memories.list(memoryStoreId, { path_prefix: "/", view: "basic" })) {
    if (item.type === "memory") actual.set(item.path, item.content_sha256);
  }
  if (actual.size !== Object.keys(desired).length || Object.entries(desired).some(([path, content]) =>
    actual.get(path) !== createHash("sha256").update(content).digest("hex"))) {
    throw new Error(`Eval Memory reset did not verify ${FIXTURE_REVISION}`);
  }
}
