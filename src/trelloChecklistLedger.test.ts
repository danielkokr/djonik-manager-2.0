import { test } from "node:test";
import assert from "node:assert/strict";
import { TrelloMutationLedger, describeMutationOutcomes } from "./trelloMutationLedger.js";

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
