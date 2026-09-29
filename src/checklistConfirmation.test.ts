import { test } from "node:test";
import assert from "node:assert/strict";
import { TrelloMutationLedger, isUnresolved } from "./trelloMutationLedger.js";
import { buildChecklistConfirmation, composeChecklistReply } from "./checklistConfirmation.js";
import { finalizeMutationReplyWithMode } from "./djonikClient.js";

// #57: the code-owned checklist confirmation — facts only, never provider state / ids / read mechanics.

const json = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }];
const CARD = "ari:cloud:trello::card/aaaaaaaaaaaaaaaaaaaaaaaa";
const CHECK = "ari:cloud:trello::checklist/bbbbbbbbbbbbbbbbbbbbbbbb";
const itemId = (n: number) => `ari:cloud:trello::checkitem/${String(n).repeat(24)}`;

class Turn {
  readonly ledger = new TrelloMutationLedger();
  call(id: string, toolName: string, input: Record<string, unknown>, result: unknown, isError = false): this {
    this.ledger.recordToolUse({ id, serverName: "trello", toolName, input });
    this.ledger.recordToolResult(id, isError, json(result));
    return this;
  }
  cardRead(name: string, id = CARD): this {
    return this.call(`rc_${id}`, "trelloReadCard", { action: "get", cardIdOrUrl: id }, { id, name });
  }
  create(name: string, id = "c"): this {
    return this.call(id, "trelloWriteChecklist", { action: "create", cardId: CARD, name }, { id: CHECK, name });
  }
  items(names: string[], state = "INCOMPLETE"): this {
    names.forEach((text, i) => this.call(`i${i}`, "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text }, { id: itemId(i + 1), name: text, state }));
    return this;
  }
  readBack(checklistName: string, names: string[], state = "INCOMPLETE"): this {
    const items = names.map((name, i) => ({ id: itemId(i + 1), name, state }));
    this.call("rl", "trelloReadChecklist", { action: "list_by_card", cardId: CARD }, { checklists: [{ id: CHECK, name: checklistName, items }] });
    return this.call("rg", "trelloReadChecklist", { action: "get", checklistId: CHECK }, { id: CHECK, name: checklistName, checkItems: items });
  }
}

const noLeak = (text: string) => {
  for (const forbidden of [/COMPLETE/i, /ari:cloud/, /aaaaaaaa|bbbbbbbb/, /trello(Read|Write)/, /Підтверджено читанням/, /state/i]) assert.doesNotMatch(text, forbidden);
};

test("#57 1: a verified create with no items: card + checklist name only", () => {
  const t = new Turn().cardRead("Банер").create("Кроки").readBack("Кроки", []);
  const block = buildChecklistConfirmation(t.ledger.outcomes())!;
  assert.equal(block, "Готово. На «Банер» додав чекліст «Кроки».");
  noLeak(block);
});

test("#57 1: without a card read in the turn the card name is omitted, never replaced by an id", () => {
  const t = new Turn().create("Кроки").items(["Один"]).readBack("Кроки", ["Один"]);
  assert.equal(buildChecklistConfirmation(t.ledger.outcomes()), "Готово. Додав чекліст «Кроки» з одним пунктом: «Один».");
});

test("#57 2/3: add_item into an existing checklist names the checklist from the verifying read; item names exact", () => {
  const t = new Turn().items(["Драфти клієнту на затвердження", "Рендер на ніч"], "COMPLETE");
  t.call("rg", "trelloReadChecklist", { action: "get", checklistId: CHECK }, {
    id: CHECK, name: "Кроки",
    checkItems: [{ id: itemId(1), name: "Драфти клієнту на затвердження", state: "COMPLETE" }, { id: itemId(2), name: "Рендер на ніч", state: "COMPLETE" }],
  });
  const block = buildChecklistConfirmation(t.ledger.outcomes())!;
  assert.equal(block, "Готово. У чекліст «Кроки» додав пункти: «Драфти клієнту на затвердження», «Рендер на ніч».");
  noLeak(block);
  const one = new Turn().items(["Рендер на ніч"]);
  one.call("rg", "trelloReadChecklist", { action: "get", checklistId: CHECK }, { id: CHECK, name: "Кроки", checkItems: [{ id: itemId(1), name: "Рендер на ніч" }] });
  assert.equal(buildChecklistConfirmation(one.ledger.outcomes()), "Готово. У чекліст «Кроки» додав пункт: «Рендер на ніч».");
});

test("#57 4: state is never rendered — neither the enum nor a translation is invented", () => {
  const t = new Turn().cardRead("Банер").create("Кроки").items(["А", "Б"], "COMPLETE").readBack("Кроки", ["А", "Б"], "COMPLETE");
  const block = buildChecklistConfirmation(t.ledger.outcomes())!;
  assert.equal(block, "Готово. На «Банер» додав чекліст «Кроки» з двома пунктами: «А», «Б».");
  assert.doesNotMatch(block, /викона/u);
});

test("#57: counts read naturally up to ten and fall back to digits beyond", () => {
  const five = Array.from({ length: 5 }, (_, i) => `П${i + 1}`);
  const twelve = Array.from({ length: 12 }, (_, i) => `П${i + 1}`);
  assert.match(buildChecklistConfirmation(new Turn().create("К").items(five).readBack("К", five).ledger.outcomes())!, /з пʼятьма пунктами:/u);
  assert.match(buildChecklistConfirmation(new Turn().create("К").items(twelve).readBack("К", twelve).ledger.outcomes())!, /з 12 пунктами:/u);
});

test("#57: only VERIFIED checklist writes are confirmed; none → no block", () => {
  const unverified = new Turn().create("Кроки").items(["А"]);
  assert.equal(buildChecklistConfirmation(unverified.ledger.outcomes()), null);
  assert.ok(unverified.ledger.outcomes().every(isUnresolved), "still unresolved → the turn fails closed upstream (#56)");
});

test("#57 gate: restatement and provider vocabulary are withheld; unrelated commentary follows verbatim", () => {
  const outcomes = new Turn().cardRead("Банер").create("Кроки").items(["Рендер на ніч"]).readBack("Кроки", ["Рендер на ніч"]).ledger.outcomes();
  const block = buildChecklistConfirmation(outcomes)!;
  assert.equal(composeChecklistReply(block, "", outcomes, true).mode, "none");
  assert.equal(composeChecklistReply(block, "Готово.", outcomes, true).mode, "redundant");
  assert.equal(composeChecklistReply(block, "Додав «Рендер на ніч».", outcomes, true).mode, "withheld_restatement");
  assert.equal(composeChecklistReply(block, "Чекліст на місці.", outcomes, true).mode, "withheld_restatement");
  assert.equal(composeChecklistReply(block, "Усі пункти INCOMPLETE.", outcomes, true).mode, "withheld_provider_state");
  assert.equal(composeChecklistReply(block, "Статус: complete", outcomes, true).mode, "withheld_provider_state");
  assert.deepEqual(composeChecklistReply(block, "Далі — референси.", outcomes, true), { text: `${block}\n\nДалі — референси.`, mode: "appended" });
  // Beside a confirmed card write, the model may be reporting that write: only provider vocabulary withholds it.
  assert.equal(composeChecklistReply(block, "Назву змінив, чекліст додав.", outcomes, false).mode, "appended");
  assert.equal(composeChecklistReply(block, "Назву змінив, усі INCOMPLETE.", outcomes, false).mode, "withheld_provider_state");
});

test("#57 finalize: a due write + checklist → the #23 due block, then the checklist line; no ARI, no second «Готово.»", () => {
  const t = new Turn().cardRead("Банер").create("Кроки").items(["А"]).readBack("Кроки", ["А"]);
  const due = "2026-10-02T15:00:00.000Z";
  t.call("wd", "trelloWriteCard", { action: "update", cardId: CARD, due }, { id: CARD, name: "Банер", due });
  t.call("rd", "trelloReadCard", { action: "get", cardIdOrUrl: CARD }, { id: CARD, name: "Банер", due });
  const finalized = finalizeMutationReplyWithMode("Усі INCOMPLETE.", t.ledger.outcomes());
  assert.equal(
    finalized.text,
    "Готово. Trello підтвердив дедлайн: пʼятниця, 2 жовтня 2026, 18:00 за Києвом.\nНа «Банер» додав чекліст «Кроки» з одним пунктом: «А».",
  );
  assert.equal(finalized.checklistCommentary, "withheld_provider_state");
  noLeak(finalized.text);
});

test("#57 finalize: a verified-specialist turn (reply null) gets the checklist block, not the id-bearing report", () => {
  const t = new Turn().cardRead("Банер").create("Кроки").readBack("Кроки", []);
  assert.equal(finalizeMutationReplyWithMode(null, t.ledger.outcomes()).text, "Готово. На «Банер» додав чекліст «Кроки».");
});

test("#57 finalize: a failed checklist write keeps the authoritative per-mutation report (unchanged)", () => {
  const t = new Turn().create("Кроки").readBack("Кроки", []);
  t.call("bad", "trelloWriteChecklist", { action: "add_item", checklistId: CHECK, text: "Х" }, { error: "rejected" }, true);
  const finalized = finalizeMutationReplyWithMode("Все готово!", t.ledger.outcomes());
  assert.match(finalized.text, /❌ Не виконано/u);
  assert.equal(finalized.checklistCommentary, undefined);
});

test("#57 finalize: turns without a checklist write are byte-for-byte unchanged", () => {
  const t = new Turn();
  t.call("w", "trelloWriteCard", { action: "update", cardId: CARD, name: "Банер" }, { id: CARD, name: "Банер" });
  t.call("r", "trelloReadCard", { action: "get", cardIdOrUrl: CARD }, { id: CARD, name: "Банер" });
  assert.deepEqual(finalizeMutationReplyWithMode("Перейменував.", t.ledger.outcomes()), { text: "Перейменував.", dueCommentary: null });
  assert.deepEqual(finalizeMutationReplyWithMode("Просто відповідь.", []), { text: "Просто відповідь.", dueCommentary: null });
});

// ---------------------------------------------------------------------------------------------
// #57 PL blocker: in a mixed turn the checklist polish must never hide another verified write. When the model's text
// is not shown, one deterministic, id-free line still acknowledges the confirmed non-checklist writes.
// ---------------------------------------------------------------------------------------------

const LABEL = "ari:cloud:trello::label/dddddddddddddddddddddddd";
const renamed = (t: Turn, name = "Банер v2") => {
  t.call("wn", "trelloWriteCard", { action: "update", cardId: CARD, name }, { id: CARD, name });
  return t.call("rn", "trelloReadCard", { action: "get", cardIdOrUrl: CARD }, { id: CARD, name });
};
const checklistTurn = () => new Turn().cardRead("Банер").create("Кроки").items(["А"]).readBack("Кроки", ["А"]);
const CHECKLIST_BLOCK = "Готово. На «Банер» додав чекліст «Кроки» з одним пунктом: «А».";

test("#57 mixed 1: checklist-only + provider enum → the clean checklist block only", () => {
  const finalized = finalizeMutationReplyWithMode("Усі INCOMPLETE.", checklistTurn().ledger.outcomes());
  assert.deepEqual(finalized, { text: CHECKLIST_BLOCK, dueCommentary: null, checklistCommentary: "withheld_provider_state" });
});

test("#57 mixed 2: card-only → the model reply exactly as before", () => {
  const t = renamed(new Turn());
  assert.deepEqual(finalizeMutationReplyWithMode("Перейменував на «Банер v2».", t.ledger.outcomes()), {
    text: "Перейменував на «Банер v2».", dueCommentary: null,
  });
});

test("#57 mixed 3: card + checklist with clean commentary → block + commentary, no extra line", () => {
  const t = renamed(checklistTurn());
  const finalized = finalizeMutationReplyWithMode("Назву змінив, чекліст додав.", t.ledger.outcomes());
  assert.equal(finalized.text, `${CHECKLIST_BLOCK}\n\nНазву змінив, чекліст додав.`);
  assert.equal(finalized.checklistCommentary, "appended");
});

test("#57 mixed 4: card + checklist, commentary with INCOMPLETE → withheld, block shown, card write still acknowledged", () => {
  const t = renamed(checklistTurn());
  const finalized = finalizeMutationReplyWithMode("Назву змінив, чекліст додав — усі пункти INCOMPLETE.", t.ledger.outcomes());
  assert.equal(finalized.text, `${CHECKLIST_BLOCK}\nЗміни картки «Банер v2» також підтверджені.`);
  assert.equal(finalized.checklistCommentary, "withheld_provider_state");
  noLeak(finalized.text);
  // Model silence or a bare «Готово.» also leaves the card write acknowledged.
  assert.equal(finalizeMutationReplyWithMode("", t.ledger.outcomes()).text, `${CHECKLIST_BLOCK}\nЗміни картки «Банер v2» також підтверджені.`);
  assert.equal(finalizeMutationReplyWithMode("Готово.", t.ledger.outcomes()).text, `${CHECKLIST_BLOCK}\nЗміни картки «Банер v2» також підтверджені.`);
});

test("#57 mixed 5: label + checklist with withheld commentary → both classes represented, no ids", () => {
  const t = checklistTurn();
  t.call("wl", "trelloWriteCard", { action: "attach_label", cardId: CARD, labelId: LABEL }, { id: CARD, name: "Банер" });
  t.call("rl2", "trelloReadCard", { action: "get", cardIdOrUrl: CARD }, { id: CARD, name: "Банер", labels: [{ id: LABEL, name: "Extract" }] });
  const finalized = finalizeMutationReplyWithMode("Label додав, пункти COMPLETE.", t.ledger.outcomes());
  assert.equal(finalized.text, `${CHECKLIST_BLOCK}\nЗміни картки «Банер» також підтверджені.`);
  noLeak(finalized.text);
  assert.doesNotMatch(finalized.text, /dddddddd/);
});

test("#57 mixed: a confirmed write with no known card name gets the generic line, never an id", () => {
  const t = checklistTurn();
  const OTHER = "ari:cloud:trello::card/cccccccccccccccccccccccc";
  t.call("wd", "trelloWriteCard", { action: "update", cardId: OTHER, desc: "Опис" }, { id: OTHER, desc: "Опис" });
  t.call("rd", "trelloReadCard", { action: "get", cardIdOrUrl: OTHER }, { id: OTHER, desc: "Опис" });
  const text = finalizeMutationReplyWithMode("Усі INCOMPLETE.", t.ledger.outcomes()).text;
  assert.equal(text, `${CHECKLIST_BLOCK}\nІнші зміни в Trello також підтверджені.`);
  assert.doesNotMatch(text, /cccccccc/);
});

test("#57 mixed: verified-specialist turn (reply null) with card + checklist → block + id-free line", () => {
  const t = renamed(checklistTurn());
  assert.equal(finalizeMutationReplyWithMode(null, t.ledger.outcomes()).text, `${CHECKLIST_BLOCK}\nЗміни картки «Банер v2» також підтверджені.`);
});

test("#57 mixed 6: due + checklist → the #23 due block + checklist line, unchanged by the fallback", () => {
  const t = checklistTurn();
  const due = "2026-10-02T15:00:00.000Z";
  t.call("wd", "trelloWriteCard", { action: "update", cardId: CARD, due }, { id: CARD, name: "Банер", due });
  t.call("rd", "trelloReadCard", { action: "get", cardIdOrUrl: CARD }, { id: CARD, name: "Банер", due });
  assert.equal(
    finalizeMutationReplyWithMode("Усі INCOMPLETE.", t.ledger.outcomes()).text,
    "Готово. Trello підтвердив дедлайн: пʼятниця, 2 жовтня 2026, 18:00 за Києвом.\nНа «Банер» додав чекліст «Кроки» з одним пунктом: «А».",
  );
});

test("#57 mixed 7: failed and unresolved paths unchanged", () => {
  const failed = renamed(checklistTurn());
  failed.call("bad", "trelloWriteCard", { action: "update", cardId: CARD, desc: "x" }, { error: "rejected" }, true);
  const f = finalizeMutationReplyWithMode("Все готово!", failed.ledger.outcomes());
  assert.match(f.text, /❌ Не виконано/u);
  assert.equal(f.checklistCommentary, undefined);
  const unresolved = new Turn().create("Кроки");
  unresolved.call("wn", "trelloWriteCard", { action: "update", cardId: CARD, name: "Н" }, { id: CARD, name: "Н" });
  assert.ok(unresolved.ledger.outcomes().every(isUnresolved), "no read-back → still unresolved → fail closed upstream");
  assert.equal(buildChecklistConfirmation(unresolved.ledger.outcomes()), null);
});
