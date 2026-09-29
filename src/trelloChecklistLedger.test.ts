import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TrelloMutationLedger,
  describeMutationOutcomes,
  isNudgeable,
  nudgeTargetIds,
  verificationReadsFor,
} from "./trelloMutationLedger.js";

const content = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }];
const use = (ledger: TrelloMutationLedger, id: string, toolName: string, input: Record<string, unknown>) =>
  ledger.recordToolUse({ id, serverName: "trello", toolName, input });
const result = (ledger: TrelloMutationLedger, id: string, value: unknown, isError = false) =>
  ledger.recordToolResult(id, isError, content(value));

test("checklist create requires later list_by_card read of same card and created id/name", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "w", "trelloWriteChecklist", { action: "create", cardId: "CARD", name: "Правки" });
  result(ledger, "w", { id: "CHECK", name: "Правки", checkItems: [] });
  assert.equal(ledger.outcomes()[0].status, "awaiting_read");
  use(ledger, "wrong", "trelloReadChecklist", { action: "list_by_card", cardId: "OTHER" });
  result(ledger, "wrong", { checklists: [{ id: "CHECK", name: "Правки", items: [] }] });
  assert.equal(ledger.outcomes()[0].status, "awaiting_read");
  use(ledger, "r", "trelloReadChecklist", { action: "list_by_card", cardId: "CARD" });
  result(ledger, "r", { checklists: [{ id: "CHECK", name: "Правки", items: [] }] });
  assert.equal(ledger.outcomes()[0].status, "verified");
  assert.match(describeMutationOutcomes(ledger.outcomes()), /читанням чекліста/);
});

test("each add_item needs its own later get read; partial failure remains explicit", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "a", "trelloWriteChecklist", { action: "add_item", checklistId: "CHECK", text: "Логотип більший" });
  result(ledger, "a", { id: "ITEM_A", name: "Логотип більший" });
  use(ledger, "b", "trelloWriteChecklist", { action: "add_item", checklistId: "CHECK", text: "Без градієнта" });
  result(ledger, "b", { error: "rejected" }, true);
  use(ledger, "r", "trelloReadChecklist", { action: "get", checklistId: "CHECK" });
  result(ledger, "r", { id: "CHECK", name: "Правки", checkItems: [{ id: "ITEM_A", name: "Логотип більший" }] });
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), ["verified", "failed"]);
  const report = describeMutationOutcomes(ledger.outcomes());
  assert.match(report, /✅/u);
  assert.match(report, /❌/u);
  assert.doesNotMatch(report, /Без градієнта.*Підтверджено/su);
});

test("write result alone and pre-write read never verify; replayed provider id is ignored", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "r", "trelloReadChecklist", { action: "get", checklistId: "CHECK" });
  result(ledger, "r", { id: "CHECK", items: [{ id: "ITEM", name: "Правка" }] });
  use(ledger, "w", "trelloWriteChecklist", { action: "add_item", checklistId: "CHECK", text: "Правка" });
  result(ledger, "w", { id: "ITEM", name: "Правка" });
  use(ledger, "w", "trelloWriteChecklist", { action: "add_item", checklistId: "WRONG", text: "Інше" });
  result(ledger, "w", { id: "WRONG", name: "Інше" });
  assert.equal(ledger.outcomes()[0].status, "awaiting_read");
});

// ---------------------------------------------------------------------------------------------
// #56: the one bounded corrective nudge covers checklist writes. `verificationReadsFor` derives the
// missing authoritative reads from ledger provenance only; the ordering/target contract is unchanged.
// ---------------------------------------------------------------------------------------------

const CARD = "ari:cloud:trello::card/aaaaaaaaaaaaaaaaaaaaaaaa";
const CHECK = "ari:cloud:trello::checklist/bbbbbbbbbbbbbbbbbbbbbbbb";
const ITEMS = ["Знайти референси концепцій", "Задизайнити сторінку кейсу (UI + 3D)", "Показати колегам", "Відправити на верстку"];
const itemId = (index: number) => `ari:cloud:trello::checkitem/${String(index).repeat(24)}`;
const allItems = (count = ITEMS.length) => ITEMS.slice(0, count).map((name, index) => ({ id: itemId(index + 1), name }));

/** Production shape: create + four add_item writes into the SAME checklist, no read afterwards. */
function productionWrites(ledger = new TrelloMutationLedger()): TrelloMutationLedger {
  use(ledger, "c", "trelloWriteChecklist", { action: "create", cardId: CARD, name: "Чекліст" });
  result(ledger, "c", { id: CHECK, name: "Чекліст", checkItems: [] });
  ITEMS.forEach((text, index) => {
    use(ledger, `i${index}`, "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text });
    result(ledger, `i${index}`, { id: itemId(index + 1), name: text });
  });
  return ledger;
}

const listRead = (ledger: TrelloMutationLedger, id: string, cardId = CARD) => {
  use(ledger, id, "trelloReadChecklist", { action: "list_by_card", cardId });
  result(ledger, id, { checklists: [{ id: CHECK, name: "Чекліст", items: [] }] });
};
const getRead = (ledger: TrelloMutationLedger, id: string, checklistId = CHECK, count = ITEMS.length) => {
  use(ledger, id, "trelloReadChecklist", { action: "get", checklistId });
  result(ledger, id, { id: checklistId, name: "Чекліст", checkItems: allItems(count) });
};

test("#56 A: a checklist create with no read is nudgeable and asks for list_by_card of its card only", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "c", "trelloWriteChecklist", { action: "create", cardId: CARD, name: "Чекліст" });
  result(ledger, "c", { id: CHECK, name: "Чекліст" });
  assert.equal(isNudgeable(ledger.outcomes()[0]), true);
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), [{ kind: "checklist_list", cardId: CARD }]);
  assert.deepEqual(nudgeTargetIds(ledger.outcomes()), [], "never a card-read request for a checklist write");
  listRead(ledger, "r");
  assert.equal(ledger.outcomes()[0].status, "verified");
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), []);
});

test("#56 B: one add_item with no read asks for get of its checklist; a later get verifies it", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "i", "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text: ITEMS[0] });
  result(ledger, "i", { id: itemId(1), name: ITEMS[0] });
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), [{ kind: "checklist_get", checklistId: CHECK }]);
  getRead(ledger, "r", CHECK, 1);
  assert.equal(ledger.outcomes()[0].status, "verified");
});

test("#56 C/E: four items in one checklist need ONE get — the request is deduplicated and one read verifies all four", () => {
  const ledger = new TrelloMutationLedger();
  ITEMS.forEach((text, index) => {
    use(ledger, `i${index}`, "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text });
    result(ledger, `i${index}`, { id: itemId(index + 1), name: text });
  });
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), [{ kind: "checklist_get", checklistId: CHECK }]);
  getRead(ledger, "r");
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), ["verified", "verified", "verified", "verified"]);
});

test("#56 D: create + four items → exactly one list_by_card and one get; both reads verify all five mutations", () => {
  const ledger = productionWrites();
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), [
    { kind: "checklist_list", cardId: CARD },
    { kind: "checklist_get", checklistId: CHECK },
  ]);
  listRead(ledger, "r1");
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), [{ kind: "checklist_get", checklistId: CHECK }], "only the still-missing read");
  getRead(ledger, "r2");
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), Array(5).fill("verified"));
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), []);
});

test("#56 F: a wrong checklist id or wrong card id never verifies", () => {
  const ledger = productionWrites();
  const OTHER_CHECK = "ari:cloud:trello::checklist/cccccccccccccccccccccccc";
  listRead(ledger, "wrong_card", "ari:cloud:trello::card/dddddddddddddddddddddddd");
  getRead(ledger, "wrong_check", OTHER_CHECK);
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), Array(5).fill("awaiting_read"));
  // A read of the right checklist whose result names another checklist is not trusted either.
  use(ledger, "mislabelled", "trelloReadChecklist", { action: "get", checklistId: CHECK });
  result(ledger, "mislabelled", { id: OTHER_CHECK, checkItems: allItems() });
  assert.deepEqual(ledger.outcomes().slice(1).map((outcome) => outcome.status), Array(4).fill("awaiting_read"));
});

test("#56 G: reads taken before the writes never verify them", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "pre1", "trelloReadChecklist", { action: "list_by_card", cardId: CARD });
  result(ledger, "pre1", { checklists: [{ id: CHECK, name: "Чекліст", items: [] }] });
  use(ledger, "pre2", "trelloReadChecklist", { action: "get", checklistId: CHECK });
  result(ledger, "pre2", { id: CHECK, checkItems: allItems() });
  productionWrites(ledger);
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), Array(5).fill("awaiting_read"));
  assert.equal(verificationReadsFor(ledger.outcomes()).length, 2);
});

test("#56 G': a get that started before a later add_item's result does not verify that later item", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "i0", "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text: ITEMS[0] });
  result(ledger, "i0", { id: itemId(1), name: ITEMS[0] });
  use(ledger, "r", "trelloReadChecklist", { action: "get", checklistId: CHECK });
  use(ledger, "i1", "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text: ITEMS[1] });
  result(ledger, "i1", { id: itemId(2), name: ITEMS[1] });
  result(ledger, "r", { id: CHECK, checkItems: allItems(2) });
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), ["verified", "awaiting_read"]);
});

test("#56 H: errored, unparseable or search reads never verify", () => {
  const ledger = productionWrites();
  use(ledger, "err", "trelloReadChecklist", { action: "get", checklistId: CHECK });
  result(ledger, "err", { id: CHECK, checkItems: allItems() }, true);
  use(ledger, "junk", "trelloReadChecklist", { action: "get", checklistId: CHECK });
  ledger.recordToolResult("junk", false, [{ type: "text", text: "Checklist has 4 items" }]);
  use(ledger, "junk_list", "trelloReadChecklist", { action: "list_by_card", cardId: CARD });
  ledger.recordToolResult("junk_list", false, [{ type: "text", text: "not json" }]);
  use(ledger, "search", "trelloSearch", { query: "Чекліст" });
  result(ledger, "search", { checklists: [{ id: CHECK, name: "Чекліст" }] });
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), Array(5).fill("awaiting_read"));
});

test("#56: a failed checklist write and an unsupported checklist action are never nudged", () => {
  const ledger = new TrelloMutationLedger();
  use(ledger, "f", "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text: "x" });
  result(ledger, "f", { error: "rejected" }, true);
  use(ledger, "u", "trelloWriteChecklist", { action: "update_item", checklistId: CHECK, checkItemId: itemId(1), name: "y" });
  result(ledger, "u", { id: itemId(1), name: "y" });
  assert.deepEqual(ledger.outcomes().map((outcome) => outcome.status), ["failed", "target_unknown"]);
  assert.deepEqual(verificationReadsFor(ledger.outcomes()), []);
});

test("#56: card and checklist requests combine without changing the card request", () => {
  const ledger = productionWrites();
  use(ledger, "w", "trelloWriteCard", { action: "update", cardId: CARD, name: "RDAS" });
  result(ledger, "w", { id: CARD, name: "RDAS" });
  assert.deepEqual(verificationReadsFor(ledger.outcomes()).map((read) => read.kind), ["checklist_list", "checklist_get", "card"]);
  assert.deepEqual(nudgeTargetIds(ledger.outcomes()), [CARD]);
});
