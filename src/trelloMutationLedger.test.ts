import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TrelloMutationLedger,
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

test("extractCardObject: accepts a bare card object and a single-key {card} wrapper only", () => {
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
