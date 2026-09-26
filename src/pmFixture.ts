import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { FIXTURE_REVISION, type Scenario } from "./pmBenchmark.js";

export interface EvalCard {
  key: string; title: string; project: "Seqthera" | "Extract" | "Azov" | "Limen" | "Cossack Labs";
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
export function cardsForScenario(scenario: Scenario): readonly EvalCard[] {
  if (scenario.id === "S1") return EVAL_CARDS.map((card) =>
    card.key === "az-banner-a" || card.key === "cl-deck" ? { ...card, list: "To do" } : card);
  if (scenario.id === "S2") return EVAL_CARDS.map(({ size: _size, ...card }) => card);
  return EVAL_CARDS;
}
export const EVAL_MEMORIES: Readonly<Record<string, string>> = {
  "/priorities.md": "Eval fixture only. Seqthera concept has an accepted client commitment. Limen remains important without a due date.",
  "/projects/seqthera.md": "Eval fixture only. Concept is in progress. No client presentation date has been agreed.",
  "/projects/extract.md": "Eval fixture only. Packaging is near completion. Feedback is waiting; no person has promised a response date.",
  "/working-style.md": "Eval fixture only. Daniel prefers one main choice and concise practical reasoning.",
  "/commitments/seqthera.md": "Eval fixture only. Accepted commitment: send the Seqthera concept for review. No date is recorded.",
};

export function memoriesForScenario(scenario: Scenario): Record<string, string> {
  const memories = { ...EVAL_MEMORIES };
  if (scenario.id === "S6") {
    memories["/commitments/extract.md"] = "Eval fixture only. Accepted external commitment: send Extract packaging review on Monday 28 September 2026. Daniel now says not to touch Extract today.";
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
  await driver.ensureProjectLabels(["Seqthera", "Extract", "Azov", "Limen", "Cossack Labs"]);
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
