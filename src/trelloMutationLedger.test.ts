import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TrelloMutationLedger,
  cardLabelState,
  describeMutationOutcomes,
  extractCardObject,
  identifiersMatch,
  isConfirmed,
  isFailed,
  isNudgeable,
  isUnresolved,
  nudgeTargetIds,
  type MutationOutcome,
  type MutationStatus,
} from "./trelloMutationLedger.js";

// Behavioral tests for the per-mutation ledger (#31). Every test drives the ledger with the same
// tool-use / tool-result events the Session stream emits and asserts the SAFE desired outcome.

type Content = Array<{ type: string; text: string }>;

const card = (value: Record<string, unknown>): Content => [{ type: "text", text: JSON.stringify(value) }];

/** Scripted event driver: `write`/`read` emit a tool-use immediately followed by its result. */
class Script {
  readonly ledger = new TrelloMutationLedger();

  use(id: string, toolName: string, input: Record<string, unknown> = {}, serverName = "trello"): this {
    this.ledger.recordToolUse({ id, serverName, toolName, input });
    return this;
  }

  result(id: string, content?: Content, isError = false): this {
    this.ledger.recordToolResult(id, isError, content);
    return this;
  }

  write(id: string, input: Record<string, unknown>, content?: Content, isError = false): this {
    return this.use(id, "trelloWriteCard", input).result(id, content, isError);
  }

  read(id: string, cardIdOrUrl: string, content?: Content, isError = false, extra: Record<string, unknown> = {}): this {
    return this.use(id, "trelloReadCard", { action: "get", cardIdOrUrl, ...extra }).result(id, content, isError);
  }

  statuses(): MutationStatus[] {
    return this.ledger.outcomes().map((outcome) => outcome.status);
  }

  outcome(index = 0): MutationOutcome {
    return this.ledger.outcomes()[index];
  }
}

// --- extractCardObject: one anchored card object, never a nested/unrelated one ---

// (The live provider's single-node `{cards:{nodes:[card]}}` connection is covered in the #37 section below.)
test("extractCardObject: accepts a bare card object and a single-key {card} wrapper, never a deeper wrapper", () => {
  assert.equal(extractCardObject(card({ id: "A", name: "x" }))?.id, "A");
  assert.equal(extractCardObject(card({ card: { id: "A" } }))?.id, "A");
  assert.equal(extractCardObject(card({ card: { id: "A" }, extra: 1 })), null, "a wrapper with siblings is not a card");
  assert.equal(extractCardObject(card({ data: { card: { id: "A" } } })), null, "no deeper unwrapping");
  assert.equal(extractCardObject(card({ name: "no id", board: { id: "board" } })), null, "a nested board is never the card");
});

test("extractCardObject: arrays, empty ids, non-JSON, no content and conflicting blocks are all null", () => {
  assert.equal(extractCardObject(card([{ id: "A" }] as unknown as Record<string, unknown>)), null);
  assert.equal(extractCardObject(card({ id: "  " })), null);
  assert.equal(extractCardObject([{ type: "text", text: "Created card A" }]), null);
  assert.equal(extractCardObject(undefined), null);
  assert.equal(extractCardObject([{ type: "image" }]), null);
  assert.equal(
    extractCardObject([
      { type: "text", text: JSON.stringify({ id: "A" }) },
      { type: "text", text: JSON.stringify({ id: "B" }) },
    ]),
    null,
    "two different card ids in one result are ambiguous",
  );
});

test("identifiersMatch: bare ids, ARIs and case; incomparable forms do not match", () => {
  const oid = "6aad12eb1d878e89bdc4a657";
  assert.equal(identifiersMatch(oid, oid.toUpperCase()), true);
  assert.equal(identifiersMatch(`ari:cloud:trello::card/${oid}`, oid), true);
  assert.equal(identifiersMatch("card_A", "card_A"), true);
  assert.equal(identifiersMatch("card_A", "card_B"), false);
  assert.equal(identifiersMatch("https://trello.com/c/W9ArsrgP/58-x", oid), false);
});

// --- Target identity ---

test("create: the target is the id in the write's OWN result; an input cardId on a create is never trusted", () => {
  const s = new Script().write("w", { action: "create", cardId: "FAKE", name: "A" }, card({ id: "A", name: "A" }));
  assert.deepEqual(s.outcome().targetCardIds, ["A"]);
  s.read("r", "FAKE", card({ id: "FAKE", name: "A" }));
  assert.equal(s.outcome().status, "awaiting_read", "a read of the input cardId cannot verify a create");
  s.read("r2", "A", card({ id: "A", name: "A" }));
  assert.equal(s.outcome().status, "verified");
});

test("create with no unambiguous result identity stays target_unknown no matter what is read afterwards", () => {
  const shapes: Array<[string, Content | undefined]> = [
    ["no content", undefined],
    ["prose", [{ type: "text", text: "Card created" }]],
    ["no id field", card({ name: "A" })],
    ["array result", card([{ id: "A" }] as unknown as Record<string, unknown>)],
    ["nested id only", card({ result: { id: "A" } })],
    ["two conflicting ids", [
      { type: "text", text: JSON.stringify({ id: "A" }) },
      { type: "text", text: JSON.stringify({ id: "B" }) },
    ]],
  ];
  for (const [label, content] of shapes) {
    const s = new Script().write("w", { action: "create", name: "A" }, content);
    s.read("r", "A", card({ id: "A", name: "A" }));
    s.read("r2", "B", card({ id: "B", name: "A" }));
    assert.equal(s.outcome().status, "target_unknown", label);
    assert.equal(isUnresolved(s.outcome()), true, label);
    assert.equal(isNudgeable(s.outcome()), false, `${label}: another read can never resolve an unidentified create`);
  }
});

test("update/move: the target is the input cardId; a conflicting result id makes it unknown", () => {
  const ok = new Script().write("w", { action: "update", cardId: "A", name: "n" }, card({ id: "A", name: "n" }));
  assert.deepEqual(ok.outcome().targetCardIds, ["A"]);
  const conflict = new Script().write("w", { action: "update", cardId: "A", name: "n" }, card({ id: "B", name: "n" }));
  assert.equal(conflict.outcome().status, "target_unknown");
});

test("an update with no cardId and no result identity is target_unknown", () => {
  assert.equal(new Script().write("w", { action: "update", name: "n" }).outcome().status, "target_unknown");
});

test("a non-card Trello write tool has no verification contract and is never verified", () => {
  const s = new Script().use("w", "trelloWriteChecklist", { cardId: "A" }).result("w", card({ id: "A" }));
  s.read("r", "A", card({ id: "A" }));
  assert.equal(s.outcome().status, "target_unknown");
});

// --- Which reads may verify ---

function pendingCreate(): Script {
  return new Script().write("w", { action: "create", name: "A" }, card({ id: "A", name: "A" }));
}

test("a read that happened BEFORE the write does not verify it", () => {
  const s = new Script().read("r0", "A", card({ id: "A", name: "A" }));
  s.write("w", { action: "update", cardId: "A", name: "A" }, card({ id: "A" }));
  assert.equal(s.outcome().status, "awaiting_read");
});

test("a read that STARTED before the write finished does not verify it (it may show pre-write state)", () => {
  const s = new Script().use("w", "trelloWriteCard", { action: "update", cardId: "A", name: "A" });
  s.use("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" });
  s.result("w", card({ id: "A" }));
  s.result("r", card({ id: "A", name: "A" }));
  assert.equal(s.outcome().status, "awaiting_read");
});

test("search / board / list / member / list_by_board reads never verify", () => {
  const s = pendingCreate();
  s.use("q", "trelloSearch", { action: "search_cards", query: "A" }).result("q", card({ id: "A", name: "A" }));
  s.use("b", "trelloReadBoard", { action: "get", boardId: "A" }).result("b", card({ id: "A", name: "A" }));
  s.use("l", "trelloReadList", { action: "list_by_board", boardId: "A" }).result("l", card({ id: "A", name: "A" }));
  s.use("m", "trelloReadMember", { action: "get_me" }).result("m", card({ id: "A", name: "A" }));
  s.use("lb", "trelloReadCard", { action: "list_by_board", cardIdOrUrl: "A" }).result("lb", card({ id: "A", name: "A" }));
  assert.equal(s.outcome().status, "awaiting_read");
});

test("a direct read of another card does not verify (input and result both name B)", () => {
  const s = pendingCreate();
  s.read("r", "B", card({ id: "B", name: "A" }));
  assert.equal(s.outcome().status, "awaiting_read");
});

test("a read whose input names A but whose result is card B is untrusted (inconsistent) and does not verify", () => {
  const s = pendingCreate();
  s.read("r", "A", card({ id: "B", name: "A" }));
  assert.equal(s.outcome().status, "awaiting_read");
});

test("an errored read does not verify", () => {
  const s = pendingCreate();
  s.read("r", "A", card({ id: "A", name: "A" }), true);
  assert.equal(s.outcome().status, "awaiting_read");
});

test("ambiguous / unparseable / id-less / missing read results do not verify", () => {
  for (const content of [
    undefined,
    [{ type: "text", text: "the card looks fine" }] as Content,
    card({ name: "A" }),
    card({ nodes: [{ id: "A", name: "A" }] }),
    card({ card: { id: "A" }, other: {} }),
  ]) {
    const s = pendingCreate();
    s.read("r", "A", content);
    assert.equal(s.outcome().status, "awaiting_read");
  }
  const noIdentifier = pendingCreate();
  noIdentifier.use("r", "trelloReadCard", { action: "get" }).result("r", card({ id: "A", name: "A" }));
  assert.equal(noIdentifier.outcome().status, "awaiting_read", "a direct read must name the card it read");
});

test("a valid direct read after the write verifies it (bare id, ARI and {card} wrapper forms)", () => {
  const oid = "6aad12eb1d878e89bdc4a657";
  const bare = new Script().write("w", { action: "create", name: "A" }, card({ id: oid, name: "A" }));
  bare.read("r", oid, card({ id: oid, name: "A" }));
  assert.equal(bare.outcome().status, "verified");

  const ari = new Script().write("w", { action: "create", name: "A" }, card({ id: oid, name: "A" }));
  ari.read("r", `ari:cloud:trello::card/${oid}`, card({ id: `ari:cloud:trello::card/${oid}`, name: "A" }));
  assert.equal(ari.outcome().status, "verified");

  const wrapped = new Script().write("w", { action: "create", name: "A" }, card({ id: oid, name: "A" }));
  wrapped.read("r", oid, card({ card: { id: oid, name: "A" } }));
  assert.equal(wrapped.outcome().status, "verified");
});

// --- Multiple mutations: independence ---

test("A + B written, only B read: B verifies, A stays unresolved (no shared slot)", () => {
  const s = new Script()
    .write("a", { action: "update", cardId: "A", name: "new A" }, card({ id: "A" }))
    .write("b", { action: "update", cardId: "B", name: "new B" }, card({ id: "B" }))
    .read("r", "B", card({ id: "B", name: "new B" }));
  assert.deepEqual(s.statuses(), ["awaiting_read", "verified"]);
  assert.deepEqual(nudgeTargetIds(s.ledger.outcomes()), ["A"]);
});

test("A + B written, both read correctly: both verify independently", () => {
  const s = new Script()
    .write("a", { action: "update", cardId: "A", name: "new A" }, card({ id: "A" }))
    .write("b", { action: "update", cardId: "B", name: "new B" }, card({ id: "B" }))
    .read("ra", "A", card({ id: "A", name: "new A" }))
    .read("rb", "B", card({ id: "B", name: "new B" }));
  assert.deepEqual(s.statuses(), ["verified", "verified"]);
});

test("verification of one mutation is never reused for another (same read cannot satisfy a different card)", () => {
  const s = new Script()
    .write("a", { action: "update", cardId: "A", name: "n" }, card({ id: "A" }))
    .write("b", { action: "update", cardId: "B", name: "n" }, card({ id: "B" }))
    .read("r", "A", card({ id: "A", name: "n" }));
  assert.deepEqual(s.statuses(), ["verified", "awaiting_read"]);
});

test("two creates: each is bound to its own returned id, so reading only the second leaves the first unresolved", () => {
  const s = new Script()
    .write("w1", { action: "create", name: "One" }, card({ id: "C1", name: "One" }))
    .write("w2", { action: "create", name: "Two" }, card({ id: "C2", name: "Two" }))
    .read("r", "C2", card({ id: "C2", name: "Two" }));
  assert.deepEqual(s.statuses(), ["awaiting_read", "verified"]);
});

// --- Sequential writes to the same card ---

test("same card, two sequential writes to one field, final read shows the latest value: both resolve, the earlier is superseded", () => {
  const s = new Script()
    .write("w1", { action: "update", cardId: "A", name: "First" }, card({ id: "A" }))
    .write("w2", { action: "update", cardId: "A", name: "Second" }, card({ id: "A" }))
    .read("r", "A", card({ id: "A", name: "Second" }));
  assert.deepEqual(s.statuses(), ["verified", "verified"]);
  assert.equal(s.outcome(0).superseded, true);
  assert.equal(s.outcome(1).superseded, false);
});

test("same card, two sequential writes, final read shows the OLD value: the later write mismatches and so does the overwritten one", () => {
  const s = new Script()
    .write("w1", { action: "update", cardId: "A", name: "First" }, card({ id: "A" }))
    .write("w2", { action: "update", cardId: "A", name: "Second" }, card({ id: "A" }))
    .read("r", "A", card({ id: "A", name: "First" }));
  assert.deepEqual(s.statuses(), ["field_mismatch", "field_mismatch"]);
});

test("same card, different fields: each write is checked only for its own field", () => {
  const s = new Script()
    .write("w1", { action: "update", cardId: "A", name: "New name" }, card({ id: "A" }))
    .write("w2", { action: "update", cardId: "A", desc: "New desc" }, card({ id: "A" }))
    .read("r", "A", card({ id: "A", name: "New name", desc: "New desc" }));
  assert.deepEqual(s.statuses(), ["verified", "verified"]);
  assert.equal(s.outcome(0).superseded, false);
});

test("same card: a read taken between two writes verifies only the first; the second still needs its own later read", () => {
  const s = new Script()
    .write("w1", { action: "update", cardId: "A", name: "First" }, card({ id: "A" }))
    .read("r1", "A", card({ id: "A", name: "First" }))
    .write("w2", { action: "update", cardId: "A", name: "Second" }, card({ id: "A" }));
  assert.deepEqual(s.statuses(), ["verified", "awaiting_read"]);
  s.read("r2", "A", card({ id: "A", name: "Second" }));
  assert.deepEqual(s.statuses(), ["verified", "verified"]);
});

test("create then update of the created card: the update is bound to the created id and both resolve from one final read", () => {
  const s = new Script()
    .write("w1", { action: "create", name: "Draft" }, card({ id: "C", name: "Draft" }))
    .write("w2", { action: "update", cardId: "C", name: "Final" }, card({ id: "C" }))
    .read("r", "C", card({ id: "C", name: "Final" }));
  assert.deepEqual(s.statuses(), ["verified", "verified"]);
});

test("a later valid read supersedes an earlier stale one for the same write", () => {
  const s = new Script()
    .write("w", { action: "update", cardId: "A", name: "New" }, card({ id: "A" }))
    .read("r1", "A", card({ id: "A", name: "Old" }));
  assert.equal(s.outcome().status, "field_mismatch");
  s.read("r2", "A", card({ id: "A", name: "New" }));
  assert.equal(s.outcome().status, "verified");
});

// --- Changed-field postconditions ---

test("name / desc postconditions: match (whitespace/CRLF tolerant), mismatch, and unavailable", () => {
  const run = (requested: Record<string, unknown>, actual: Record<string, unknown>) =>
    new Script()
      .write("w", { action: "update", cardId: "A", ...requested }, card({ id: "A" }))
      .read("r", "A", card({ id: "A", ...actual }))
      .outcome();
  assert.equal(run({ name: "Title" }, { name: " Title " }).status, "verified");
  assert.equal(run({ desc: "a\nb" }, { desc: "a\r\nb" }).status, "verified");
  const wrong = run({ name: "Title" }, { name: "Other" });
  assert.equal(wrong.status, "field_mismatch");
  assert.deepEqual(wrong.unconfirmedFields, ["name"]);
  const missing = run({ desc: "text" }, {});
  assert.equal(missing.status, "field_unconfirmed");
  assert.deepEqual(missing.unconfirmedFields, ["desc"]);
});

test("name/desc aliases: a write using title/description is compared against the card's title/description too", () => {
  const s = new Script().write("w", { action: "update", cardId: "A", title: "T", description: "D" }, card({ id: "A" }));
  s.read("r", "A", card({ id: "A", title: "T", description: "D" }));
  assert.equal(s.outcome().status, "verified");
});

test("list/move postcondition: card.list.id, idList and listId; ARI-vs-bare ids compare by ObjectId", () => {
  const list = "6aa00b20c257a1b4d852e51f";
  const run = (actual: Record<string, unknown>) =>
    new Script()
      .write("w", { action: "update", cardId: "A", listId: list }, card({ id: "A" }))
      .read("r", "A", card({ id: "A", ...actual }))
      .outcome().status;
  assert.equal(run({ list: { id: list, name: "Backlog" } }), "verified");
  assert.equal(run({ idList: list }), "verified");
  assert.equal(run({ listId: list }), "verified");
  assert.equal(run({ list: { id: `ari:cloud:trello::list/${list}` } }), "verified");
  assert.equal(run({ list: { id: "6aa00b20c257a1b4d852e999" } }), "field_mismatch");
  assert.equal(run({ list: { name: "Backlog" } }), "field_unconfirmed", "a list name alone is not the requested list id");
  assert.equal(run({}), "field_unconfirmed");
});

test("create postconditions: the created card must carry the requested name, desc, list and due", () => {
  const s = new Script().write(
    "w",
    { action: "create", name: "T", desc: "D", listId: "L1", due: "2026-09-19T19:00:00.000Z" },
    card({ id: "C" }),
  );
  s.read("r", "C", card({ id: "C", name: "T", desc: "D", list: { id: "L1" }, due: "2026-09-19T19:00:00.000Z" }));
  assert.equal(s.outcome().status, "verified");
  assert.deepEqual(s.outcome().due, { intendedDue: "2026-09-19T19:00:00.000Z", verifiedDue: "2026-09-19T19:00:00.000Z" });

  const partial = new Script().write("w", { action: "create", name: "T", desc: "D" }, card({ id: "C" }));
  partial.read("r", "C", card({ id: "C", name: "T", desc: "different" }));
  assert.equal(partial.outcome().status, "field_mismatch");
  assert.deepEqual(partial.outcome().unconfirmedFields, ["desc"]);
});

test("a write requesting only fields with no known postcondition is verified by the identity read alone", () => {
  const s = new Script().write("w", { action: "update", cardId: "A", dueComplete: true }, card({ id: "A" }));
  s.read("r", "A", card({ id: "A" }));
  assert.equal(s.outcome().status, "verified");
});

// --- Due: anchored to the verified card object (#23 / R6) ---

test("due: a set-due write with a DIFFERENT verified due is the terminal due_differs status: confirmed read, not nudgeable, not unresolved", () => {
  const s = new Script().write("w", { action: "update", cardId: "A", due: "2026-09-22T00:00:00.000Z" }, card({ id: "A" }));
  s.read("r", "A", card({ id: "A", due: "2026-09-21T21:30:00.000Z" }));
  const outcome = s.outcome();
  assert.equal(outcome.status, "due_differs");
  assert.equal(isUnresolved(outcome), false, "an authoritative differing value cannot be resolved by another read");
  assert.equal(isNudgeable(outcome), false);
  assert.equal(isConfirmed(outcome), true);
  assert.deepEqual(outcome.due, { intendedDue: "2026-09-22T00:00:00.000Z", verifiedDue: "2026-09-21T21:30:00.000Z" });
  const report = describeMutationOutcomes(s.ledger.outcomes());
  assert.match(report, /2026-09-21T21:30:00.000Z/, "the report states the VERIFIED due");
  assert.doesNotMatch(report, /2026-09-22T00:00:00/, "and never the requested one");
});

test("due: same instant in a different string format is plain verified, not due_differs", () => {
  const s = new Script().write("w", { action: "update", cardId: "A", due: "2026-09-21T21:30:00Z" }, card({ id: "A" }));
  s.read("r", "A", card({ id: "A", due: "2026-09-21T21:30:00.000Z" }));
  assert.equal(s.outcome().status, "verified");
});

test("due_differs never masks an unconfirmed sibling field: a name mismatch keeps the mutation unresolved", () => {
  const s = new Script().write("w", { action: "update", cardId: "A", name: "New", due: "2026-09-22T00:00:00.000Z" }, card({ id: "A" }));
  s.read("r", "A", card({ id: "A", name: "Old", due: "2026-09-21T21:30:00.000Z" }));
  assert.equal(s.outcome().status, "field_mismatch");
  assert.deepEqual(s.outcome().unconfirmedFields, ["name"]);
});

test("failed write: carries a bounded, whitespace-collapsed tool error and a display target, is not unresolved and never nudgeable", () => {
  const s = new Script().write(
    "w",
    { action: "update", cardId: "A", name: "n" },
    [{ type: "text", text: "  Trello\n\nrejected   it  " }],
    true,
  );
  const outcome = s.outcome();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.errorText, "Trello rejected it");
  assert.deepEqual(outcome.targetCardIds, ["A"], "display-only target for the report");
  assert.equal(isFailed(outcome), true);
  assert.equal(isUnresolved(outcome), false);
  assert.equal(isNudgeable(outcome), false);
  assert.deepEqual(nudgeTargetIds(s.ledger.outcomes()), [], "a failed write is never asked to be re-read or replayed");
  assert.match(describeMutationOutcomes(s.ledger.outcomes()), /^❌ Не виконано \(помилка інструмента\): «n» \(A\) — Trello rejected it$/);
  const capped = new Script().write("w", { action: "create", name: "n" }, [{ type: "text", text: "y".repeat(500) }], true);
  assert.equal(capped.outcome().errorText?.length, 201);
});

test("a failed create is display-bound to no card id (a create never trusts an input cardId)", () => {
  const s = new Script().write("w", { action: "create", cardId: "FAKE", name: "n" }, undefined, true);
  assert.deepEqual(s.outcome().targetCardIds, []);
});

test("due: card due:null with an unrelated nested board.due is NOT verified and never yields the board's due", () => {
  const s = new Script().write("w", { action: "update", cardId: "cardA", due: "2026-09-22T21:30:00.000Z" }, card({ id: "cardA" }));
  s.read("r", "cardA", card({ id: "cardA", due: null, board: { id: "board", due: "2026-09-22T21:30:00.000Z" } }));
  assert.equal(s.outcome().status, "field_mismatch");
  assert.equal(s.outcome().due, undefined);
  assert.deepEqual(s.outcome().unconfirmedFields, ["due"]);
});

test("due: absent, unparseable or non-UTC due on the card object is unconfirmed, not verified", () => {
  for (const actual of [{}, { due: "tomorrow" }, { due: "2026-09-22T00:30:00+03:00" }, { due: 12345 }]) {
    const s = new Script().write("w", { action: "update", cardId: "A", due: "2026-09-21T21:30:00.000Z" }, card({ id: "A" }));
    s.read("r", "A", card({ id: "A", ...actual }));
    assert.equal(s.outcome().status, "field_unconfirmed", JSON.stringify(actual));
  }
});

test("due: a clear request (\"\" or null) verifies only against an explicit null and produces no due outcome", () => {
  for (const clear of ["", null]) {
    const ok = new Script().write("w", { action: "update", cardId: "A", due: clear }, card({ id: "A" }));
    ok.read("r", "A", card({ id: "A", due: null }));
    assert.equal(ok.outcome().status, "verified");
    assert.equal(ok.outcome().due, undefined);

    const still = new Script().write("w", { action: "update", cardId: "A", due: clear }, card({ id: "A" }));
    still.read("r", "A", card({ id: "A", due: "2026-09-21T21:30:00.000Z" }));
    assert.equal(still.outcome().status, "field_mismatch");
  }
});

// --- Failed / missing results and honest reporting ---

test("a failed write is `failed` (not applied, not unresolved); a write with no result is unresolved", () => {
  const failed = new Script().write("w", { action: "update", cardId: "A", name: "n" }, undefined, true);
  assert.equal(failed.outcome().status, "failed");
  assert.equal(isUnresolved(failed.outcome()), false);

  const pending = new Script().use("w", "trelloWriteCard", { action: "update", cardId: "A", name: "n" });
  assert.equal(pending.outcome().status, "no_result");
  assert.equal(isUnresolved(pending.outcome()), true);
});

test("partial success: failed A + verified B + unresolved C are reported independently and honestly", () => {
  const s = new Script()
    .write("a", { action: "create", name: "Alpha" }, undefined, true)
    .write("b", { action: "update", cardId: "B", name: "Bravo" }, card({ id: "B" }))
    .write("c", { action: "update", cardId: "C", name: "Charlie" }, card({ id: "C" }))
    .read("rb", "B", card({ id: "B", name: "Bravo" }));
  assert.deepEqual(s.statuses(), ["failed", "verified", "awaiting_read"]);
  const report = describeMutationOutcomes(s.ledger.outcomes());
  assert.match(report, /❌ Не виконано.*«Alpha»/);
  assert.match(report, /✅ Підтверджено.*«Bravo» \(B\)/);
  assert.match(report, /⚠️ НЕ підтверджено.*«Charlie» \(C\)/);
});

test("non-Trello MCP tools and unrelated Trello tools are ignored by the ledger", () => {
  const s = new Script()
    .use("x", "calendarCreateEvent", { title: "x" }, "google-calendar")
    .result("x", card({ id: "A" }))
    .use("t", "trelloWriteCard", { action: "update", cardId: "A", name: "n" }, "not-the-tool-server")
    .result("t", card({ id: "A" }));
  assert.deepEqual(s.ledger.outcomes(), []);
});

test("#40: a replay of an already-recorded tool-use id after its result preserves the correlated outcome", () => {
  // Verified write, then the same write event is replayed: still verified, never reset to no_result.
  const verified = new Script()
    .write("w", { action: "update", cardId: "A", name: "New" }, card({ id: "A", name: "New" }))
    .read("r", "A", card({ id: "A", name: "New" }))
    .use("w", "trelloWriteCard", { action: "update", cardId: "A", name: "New" });
  assert.deepEqual(verified.statuses(), ["verified"]);

  // A replayed READ keeps its original ordering after the write, so it still verifies it.
  const replayedRead = new Script()
    .write("w", { action: "update", cardId: "A", name: "New" }, card({ id: "A", name: "New" }))
    .read("r", "A", card({ id: "A", name: "New" }))
    .use("r", "trelloReadCard", { action: "get", cardIdOrUrl: "A" });
  assert.deepEqual(replayedRead.statuses(), ["verified"]);

  // A failed write replayed stays failed with its bounded error, never unresolved.
  const failed = new Script()
    .write("w", { action: "update", cardId: "A", name: "New" }, [{ type: "text", text: "Trello said no" }], true)
    .use("w", "trelloWriteCard", { action: "update", cardId: "A", name: "New" });
  assert.equal(failed.outcome().status, "failed");
  assert.equal(failed.outcome().errorText, "Trello said no");

  // A replay whose result is replayed too does not duplicate or overwrite anything.
  const doubled = new Script()
    .write("w", { action: "update", cardId: "A", name: "New" }, card({ id: "A", name: "New" }))
    .write("w", { action: "update", cardId: "A", name: "Other" }, card({ id: "A", name: "Other" }))
    .read("r", "A", card({ id: "A", name: "New" }));
  assert.deepEqual(doubled.statuses(), ["verified"], "one write, first observation kept");
});

// ---------------------------------------------------------------------------------------------
// Issue #37: a new task whose project is anchored must carry that project's EXISTING Trello label,
// proven by a direct post-write read of THAT card. Fixtures use the live provider shapes recorded in
// Session events (docs/33 §3): ARIs for every id, `{cards:{nodes:[card],totalCount:1}}` for
// `trelloWriteCard` results and `trelloReadCard` `get` results, and `labels:[{color,id,name}]` plus
// `labelsHasMore` on the card node.
//
// Which project a task belongs to stays Claude's judgement in the task-management Skill (its semantic
// rules are covered in skills.test.ts); code owns only this post-write verification boundary.
// ---------------------------------------------------------------------------------------------

const WS = "5f1a2b3c4d5e6f708192a3b4";
const ari = (entity: string, oid: string) => `ari:cloud:trello::${entity}/workspace/${WS}/${oid}`;
const CARD_NEW = ari("card", "6aad12eb1d878e89bdc4a657");
const CARD_OTHER = ari("card", "6aad12eb1d878e89bdc4a658");
const LIST_INBOX = ari("list", "68c0a1b2c3d4e5f60718293a");
const LABEL_EXTRACT = ari("label", "68c0aaaaaaaaaaaaaaaaaa01");
const LABEL_SEQTHERA = ari("label", "68c0aaaaaaaaaaaaaaaaaa02");

const asText = (value: unknown): Content => [{ type: "text", text: JSON.stringify(value) }];

function cardNode(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: "Hero банер",
    desc: "",
    due: null,
    dueComplete: false,
    closed: false,
    complete: false,
    list: { id: LIST_INBOX, name: "Inbox" },
    board: { id: ari("board", "68c0bbbbbbbbbbbbbbbbbb01"), name: "Djonik" },
    labels: [],
    labelsHasMore: false,
    members: [],
    ...overrides,
  };
}

/** A live single-card connection result. */
const liveCard = (id: string, overrides: Record<string, unknown> = {}): Content =>
  asText({ cards: { nodes: [cardNode(id, overrides)], totalCount: 1 } });

const extractLabel = { color: "green", id: LABEL_EXTRACT, name: "Extract" };
const seqtheraLabel = { color: "purple", id: LABEL_SEQTHERA, name: "Seqthera" };
const ATTACH_ERROR_RESULT: Content = [{ type: "text", text: '{"error":true,"message":"TrelloAddLabelToCard failed"}' }];

/** Scripted driver for the create + `attach_label` flow on live shapes. */
class LabelScript extends Script {
  create(id: string, content?: Content, isError = false): this {
    return this.use(id, "trelloWriteCard", { action: "create", listId: LIST_INBOX, name: "Hero банер" }).result(
      id,
      content,
      isError,
    );
  }

  /** `labelId: null` omits the label from the input. */
  attach(id: string, cardId = CARD_NEW, labelId: string | null = LABEL_EXTRACT, content?: Content, isError = false): this {
    const input: Record<string, unknown> = { action: "attach_label", cardId };
    if (labelId !== null) input.labelId = labelId;
    return this.use(id, "trelloWriteCard", input).result(id, content ?? liveCard(cardId, { labels: [extractLabel] }), isError);
  }

  outcomes(): MutationOutcome[] {
    return this.ledger.outcomes();
  }
}

test("#37: extractCardObject accepts the live single-node {cards:{nodes}} connection and nothing looser", () => {
  assert.equal(extractCardObject(liveCard(CARD_NEW))?.id, CARD_NEW);
  assert.equal(extractCardObject(asText({ cards: { nodes: [cardNode(CARD_NEW)] } }))?.id, CARD_NEW);
  assert.equal(
    extractCardObject(asText({ cards: { nodes: [cardNode(CARD_NEW)], totalCount: 1, hasNextPage: false } }))?.id,
    CARD_NEW,
  );
  for (const value of [
    { cards: { nodes: [], totalCount: 0 } },
    { cards: { nodes: [cardNode(CARD_NEW), cardNode(CARD_OTHER)], totalCount: 2 } },
    { cards: { nodes: [cardNode(CARD_NEW)], totalCount: 2 } },
    { cards: { nodes: [cardNode(CARD_NEW)], totalCount: 1, hasNextPage: true } },
    { cards: { nodes: [cardNode(CARD_NEW)], totalCount: 1, extra: 1 } },
    { cards: { nodes: [cardNode(CARD_NEW)] }, boards: {} },
    { cards: [cardNode(CARD_NEW)] },
    { cards: { nodes: [{ name: "no id" }] } },
    { nodes: [cardNode(CARD_NEW)] },
  ]) {
    assert.equal(extractCardObject(asText(value)), null, JSON.stringify(Object.keys(value)));
  }
});

test("#37: no label-creation path can ever count as a verified project assignment", () => {
  // Label creation is not a `trelloWriteCard` action; any other Trello write tool is never verified.
  const s = new LabelScript()
    .use("mk", "trelloWriteBoard", { action: "create_label", boardId: ari("board", "68c0bbbbbbbbbbbbbbbbbb01"), name: "Limen" })
    .result("mk", asText({ id: ari("label", "68c0aaaaaaaaaaaaaaaaaa09"), name: "Limen" }))
    .read("r", CARD_NEW, liveCard(CARD_NEW));
  const [outcome] = s.outcomes();
  assert.equal(outcome.status, "target_unknown");
  assert.ok(isUnresolved(outcome) && !isConfirmed(outcome));
});

test("#37: create + attach_label + a later direct read of that card showing the label verifies both", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel] }));
  const [create, label] = s.outcomes();
  assert.equal(create.status, "verified");
  assert.equal(label.status, "verified");
  assert.deepEqual(label.targetCardIds, [CARD_NEW]);
  assert.deepEqual(label.projectLabel, { action: "attach", labelId: LABEL_EXTRACT, name: "Extract" });
  assert.equal(label.label, "Hero банер", "the label line is reported under the created card's name");
  assert.equal(
    describeMutationOutcomes(s.outcomes()),
    [
      `✅ Підтверджено читанням картки: «Hero банер» (${CARD_NEW})`,
      `✅ Підтверджено читанням картки: label проєкту «Extract» на картці «Hero банер» (${CARD_NEW})`,
    ].join("\n"),
  );
});

test("#37: the label is compared by provider id, not display name", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [{ color: "green", id: LABEL_SEQTHERA, name: "Extract" }] }));
  assert.equal(s.outcomes()[1].status, "field_mismatch", "a same-named label with another id is not the attached label");

  const raw = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [{ color: "green", id: "68c0aaaaaaaaaaaaaaaaaa01", name: "Extract" }] }));
  assert.equal(raw.outcomes()[1].status, "verified", "an ARI and its bare object id name the same label");
});

test("#37: a valid direct read without the expected label is NOT plain verified — partial project assignment", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [seqtheraLabel] }));
  const [create, label] = s.outcomes();
  assert.equal(create.status, "verified", "the card itself exists and is not erased");
  assert.equal(label.status, "field_mismatch");
  assert.deepEqual(label.unconfirmedFields, ["label"]);
  assert.ok(isUnresolved(label) && isNudgeable(label) && !isConfirmed(label));
  assert.deepEqual(nudgeTargetIds(s.outcomes()), [CARD_NEW]);
  assert.equal(
    describeMutationOutcomes(s.outcomes()),
    [
      `✅ Підтверджено читанням картки: «Hero банер» (${CARD_NEW})`,
      `⚠️ НЕ підтверджено: label проєкту на картці «Hero банер» (${CARD_NEW}) — Trello після запису показує інші значення: label проєкту`,
      "⚠️ Картку створено, але належність до проєкту (label) НЕ підтверджено — поки що вона без проєкту.",
    ].join("\n"),
  );
});

test("#37: absent, non-array, malformed or paged label data never confirms an attach", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no labels field", { labels: undefined }],
    ["labels not an array", { labels: { nodes: [extractLabel] } }],
    ["malformed element", { labels: [{ name: "Extract" }] }],
    ["null element", { labels: [null] }],
    ["label absent on a further page", { labels: [seqtheraLabel], labelsHasMore: true }],
  ];
  for (const [name, overrides] of cases) {
    const node = cardNode(CARD_NEW, overrides);
    if (overrides.labels === undefined) delete node.labels;
    const s = new LabelScript()
      .create("c", liveCard(CARD_NEW))
      .attach("l")
      .read("r", CARD_NEW, asText({ cards: { nodes: [node], totalCount: 1 } }));
    const label = s.outcomes()[1];
    assert.equal(label.status, "field_unconfirmed", name);
    assert.ok(!isConfirmed(label), name);
  }
  // Presence is still proof even when more labels exist on a further page.
  const paged = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel], labelsHasMore: true }));
  assert.equal(paged.outcomes()[1].status, "verified");
  // An attach that names no label can never be confirmed.
  const noLabelId = new LabelScript()
    .attach("l", CARD_NEW, null)
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel] }));
  assert.equal(noLabelId.outcomes()[0].status, "field_unconfirmed");
});

test("#37: cardLabelState — present by id, absent only from a complete parseable array", () => {
  assert.equal(cardLabelState(cardNode(CARD_NEW, { labels: [extractLabel] }), LABEL_EXTRACT), "present");
  assert.equal(cardLabelState(cardNode(CARD_NEW, { labels: [] }), LABEL_EXTRACT), "absent");
  assert.equal(cardLabelState(cardNode(CARD_NEW, { labels: [], labelsHasMore: true }), LABEL_EXTRACT), "unavailable");
  assert.equal(cardLabelState(cardNode(CARD_NEW, { labels: "Extract" }), LABEL_EXTRACT), "unavailable");
  assert.equal(cardLabelState(cardNode(CARD_NEW, { labels: [{ id: "" }] }), LABEL_EXTRACT), "unavailable");
});

test("#37: a direct read of a DIFFERENT card carrying the label cannot verify the attach", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_OTHER, liveCard(CARD_OTHER, { labels: [extractLabel] }));
  const [create, label] = s.outcomes();
  assert.equal(create.status, "awaiting_read");
  assert.equal(label.status, "awaiting_read");
  // A read that asks for card X but returns card Y is trusted for neither.
  const lying = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l")
    .read("r", CARD_NEW, liveCard(CARD_OTHER, { labels: [extractLabel] }));
  assert.equal(lying.outcomes()[1].status, "awaiting_read");
});

test("#37: a read taken before the label write — or started before its result — cannot verify it", () => {
  const before = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel] }))
    .attach("l");
  assert.equal(before.outcomes()[0].status, "verified", "the create is verified by the read after it");
  assert.equal(before.outcomes()[1].status, "awaiting_read", "the attach has no read after it");

  const interleaved = new LabelScript().create("c", liveCard(CARD_NEW));
  interleaved.use("l", "trelloWriteCard", { action: "attach_label", cardId: CARD_NEW, labelId: LABEL_EXTRACT });
  interleaved.use("r", "trelloReadCard", { action: "get", cardIdOrUrl: CARD_NEW });
  interleaved.result("l", liveCard(CARD_NEW, { labels: [extractLabel] }));
  interleaved.result("r", liveCard(CARD_NEW, { labels: [extractLabel] }));
  assert.equal(interleaved.outcomes()[1].status, "awaiting_read");
});

test("#37: the write tool's own echoed labels are never the verification", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l", CARD_NEW, LABEL_EXTRACT, liveCard(CARD_NEW, { labels: [extractLabel] }));
  assert.equal(s.outcomes()[1].status, "awaiting_read");
});

test("#37: an unrelated later label write cannot satisfy or overwrite the expected label", () => {
  // Attaching another label to the same card does not own the Extract field.
  const other = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l1")
    .attach("l2", CARD_NEW, LABEL_SEQTHERA, liveCard(CARD_NEW, { labels: [seqtheraLabel] }))
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [seqtheraLabel] }));
  assert.deepEqual(other.outcomes().map((o) => o.status), ["verified", "field_mismatch", "verified"]);

  // The same label attached to ANOTHER card does not own it either.
  const otherCard = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l1")
    .attach("l2", CARD_OTHER, LABEL_EXTRACT, liveCard(CARD_OTHER, { labels: [extractLabel] }))
    .read("r1", CARD_OTHER, liveCard(CARD_OTHER, { labels: [extractLabel] }))
    .read("r2", CARD_NEW, liveCard(CARD_NEW));
  assert.deepEqual(otherCard.outcomes().map((o) => o.status), ["verified", "field_mismatch", "verified"]);

  // An explicit later detach of the SAME label on the same card owns it (sequential-writer rule).
  const corrected = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l1")
    .use("d", "trelloWriteCard", { action: "detach_label", cardId: CARD_NEW, labelId: LABEL_EXTRACT })
    .result("d", liveCard(CARD_NEW))
    .read("r", CARD_NEW, liveCard(CARD_NEW));
  const [, attach, detach] = corrected.outcomes();
  assert.equal(detach.status, "verified");
  assert.deepEqual(detach.projectLabel, { action: "detach", labelId: LABEL_EXTRACT, name: null });
  assert.equal(attach.superseded, true);
});

test("#37: a detach is confirmed only when that label is absent from the card's own complete labels", () => {
  const stillThere = new LabelScript()
    .use("d", "trelloWriteCard", { action: "detach_label", cardId: CARD_NEW, labelId: LABEL_EXTRACT })
    .result("d", liveCard(CARD_NEW))
    .read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel] }));
  assert.equal(stillThere.outcomes()[0].status, "field_mismatch");
  assert.equal(
    describeMutationOutcomes(stillThere.outcomes()),
    `⚠️ НЕ підтверджено: зняття label «Extract» з картки ${CARD_NEW} — Trello після запису показує інші значення: label проєкту`,
  );
});

test("#37: create identity is the card its OWN successful create result returned", () => {
  // An input `cardId` on a create is ignored; only the result names the new card.
  const s = new LabelScript()
    .use("c", "trelloWriteCard", { action: "create", listId: LIST_INBOX, name: "Hero банер", cardId: CARD_OTHER })
    .result("c", liveCard(CARD_NEW))
    .read("r1", CARD_OTHER, liveCard(CARD_OTHER))
    .read("r2", CARD_NEW, liveCard(CARD_NEW));
  assert.deepEqual(s.outcomes()[0].targetCardIds, [CARD_NEW]);
  assert.equal(s.outcomes()[0].status, "verified");
  // A create result that is not ONE card has no identity: never verified.
  const many = new LabelScript()
    .create("c", asText({ cards: { nodes: [cardNode(CARD_NEW), cardNode(CARD_OTHER)], totalCount: 2 } }))
    .read("r", CARD_NEW, liveCard(CARD_NEW));
  assert.equal(many.outcomes()[0].status, "target_unknown");
});

test("#37: create verified + attach tool error → the card is reported created, the project NOT assigned", () => {
  const s = new LabelScript()
    .create("c", liveCard(CARD_NEW))
    .attach("l", CARD_NEW, LABEL_EXTRACT, ATTACH_ERROR_RESULT, true)
    .read("r", CARD_NEW, liveCard(CARD_NEW));
  const [create, label] = s.outcomes();
  assert.equal(create.status, "verified");
  assert.ok(isFailed(label));
  assert.equal(
    describeMutationOutcomes(s.outcomes()),
    [
      `✅ Підтверджено читанням картки: «Hero банер» (${CARD_NEW})`,
      `❌ Не виконано (помилка інструмента): label проєкту на картці «Hero банер» (${CARD_NEW}) — ${ATTACH_ERROR_RESULT[0].text}`,
      "⚠️ Картку створено, але належність до проєкту (label) НЕ підтверджено — поки що вона без проєкту.",
    ].join("\n"),
  );
});

test("#37: create verified + attach with no result is unresolved and partial", () => {
  const s = new LabelScript().create("c", liveCard(CARD_NEW)).read("r", CARD_NEW, liveCard(CARD_NEW));
  s.use("l", "trelloWriteCard", { action: "attach_label", cardId: CARD_NEW, labelId: LABEL_EXTRACT });
  const [create, label] = s.outcomes();
  assert.equal(create.status, "verified");
  assert.equal(label.status, "no_result");
  assert.match(describeMutationOutcomes(s.outcomes()), /Картку створено, але належність до проєкту \(label\) НЕ підтверджено/);
});

test("#37: the partial line is for a created card only — never for an attach on an existing card or a failed create", () => {
  const existing = new LabelScript().attach("l", CARD_OTHER, LABEL_EXTRACT, [{ type: "text", text: "boom" }], true);
  assert.doesNotMatch(describeMutationOutcomes(existing.outcomes()), /Картку створено/);

  const failedCreate = new LabelScript()
    .create("c", [{ type: "text", text: "boom" }], true)
    .attach("l", CARD_NEW, LABEL_EXTRACT, [{ type: "text", text: "boom" }], true);
  assert.doesNotMatch(describeMutationOutcomes(failedCreate.outcomes()), /Картку створено/);
});

test("#37 (#40): a same-id replay of the attach tool use/result after its result preserves the outcome", () => {
  const s = new LabelScript().create("c", liveCard(CARD_NEW)).attach("l");
  s.read("r", CARD_NEW, liveCard(CARD_NEW, { labels: [extractLabel] }));
  const before = s.outcomes();
  s.use("l", "trelloWriteCard", { action: "attach_label", cardId: CARD_NEW, labelId: LABEL_SEQTHERA });
  s.result("l", [{ type: "text", text: "late duplicate" }], true);
  assert.deepEqual(s.outcomes(), before);
  assert.equal(s.outcomes()[1].status, "verified");
});
