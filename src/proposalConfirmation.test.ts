import { test } from "node:test";
import assert from "node:assert/strict";
import { ProposalConfirmations, isProposalReply, proposalKeyboard } from "./proposalConfirmation.js";

const proposal = "📨 Extract · паковання\n✂️ Логотип більший\n📌 «до п'ятниці» — Анна\n✅ Внести  ✏️ Змінити";

test("proposal button is bound to exact latest Telegram message and consumed once", () => {
  const registry = new ProposalConfirmations(() => 100);
  assert.equal(isProposalReply(proposal), true);
  const a = registry.newRef();
  registry.register(1, 7, 101, proposal, a);
  assert.equal(proposalKeyboard(a).inline_keyboard[0].length, 2);
  const b = registry.newRef();
  registry.register(1, 7, 102, proposal.replace("Логотип більший", "Без градієнта"), b);
  assert.deepEqual(registry.click(`fp1:a:${a}`, 1, 7, 101), { kind: "stale" });
  assert.deepEqual(registry.click(`fp1:a:${b}`, 1, 7, 101), { kind: "stale" });
  assert.deepEqual(registry.click(`fp1:a:${b}`, 1, 8, 102), { kind: "stale" });
  const accepted = registry.click(`fp1:a:${b}`, 1, 7, 102);
  assert.equal(accepted.kind, "apply");
  assert.match(accepted.kind === "apply" ? accepted.text : "", /Без градієнта/);
  assert.deepEqual(registry.click(`fp1:a:${b}`, 1, 7, 102), { kind: "stale" });
});

test("proposal binding requires the two actions as the final line", () => {
  assert.equal(isProposalReply("У джерелі сказано ✅ Внести і ✏️ Змінити, але ціль неясна."), false);
  assert.equal(isProposalReply("Картка: банер\n✅ Внести  ✏️ Змінити"), true);
});

test("typed confirmation applies only a current proposal; expiry and ambiguity fail closed", () => {
  let now = 0;
  const registry = new ProposalConfirmations(() => now);
  assert.deepEqual(registry.typed("внести", 1, 7), { kind: "stale" });
  registry.register(1, 7, 1, proposal, registry.newRef());
  assert.equal(registry.typed("так, внеси", 1, 7).kind, "apply");
  assert.deepEqual(registry.typed("внести", 1, 7), { kind: "stale" });
  registry.register(1, 7, 2, proposal, registry.newRef());
  now = 31 * 60_000;
  assert.deepEqual(registry.typed("внести", 1, 7), { kind: "stale" });
});
