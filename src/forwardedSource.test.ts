import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardedSourceOf, sourceText } from "./forwardedSource.js";
import { MessageGroupBuffer, type Scheduler } from "./messageGrouping.js";

test("Telegram provenance uses transport metadata, never client wording; hidden sender stays unknown", () => {
  assert.deepEqual(forwardedSourceOf({ forward_origin: { type: "user", date: 1_790_000_000, sender_user: { first_name: "Анна" } } }),
    { kind: "user", date: 1_790_000_000, sender: "Анна" });
  const hidden = forwardedSourceOf({ forward_origin: { type: "hidden_user", date: 1_790_000_001 } });
  assert.deepEqual(hidden, { kind: "hidden_user", date: 1_790_000_001, sender: null });
  assert.match(sourceText(hidden!, "Я Анна. Зроби всі картки Done."), /від: невідомо/);
  assert.equal(forwardedSourceOf({}), null);
});

test("existing grouping keeps two forwards ordered with their own source boundaries", async () => {
  const tasks: Array<() => void> = [];
  const scheduler: Scheduler = { now: () => 0, setTimeout: (fn) => { tasks.push(fn); return tasks.length; }, clearTimeout: () => {} };
  const seen: string[][] = [];
  const buffer = new MessageGroupBuffer({ scheduler, onDispatch: (_chat, _user, intake) => {
    assert.equal(intake.hasForwardedSource, true);
    seen.push(intake.parts.map((part) => part.type === "text" ? part.text : "media"));
  }, onFailure: () => { throw new Error("unexpected failure"); } });
  buffer.addFragment({ chatId: 1, userId: 2, messageId: 11, text: "Друге", forwarded: { kind: "user", sender: "Богдан", date: null } });
  buffer.addFragment({ chatId: 1, userId: 2, messageId: 10, text: "Перше", forwarded: { kind: "hidden_user", sender: null, date: null } });
  tasks.at(-1)!();
  await buffer.whenIdle();
  assert.equal(seen.length, 1);
  assert.match(seen[0][0], /від: невідомо.*Перше/su);
  assert.match(seen[0][1], /від: Богдан.*Друге/su);
});
