import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import { ProposalConfirmations } from "./proposalConfirmation.js";
import type { DjonikSessionHandle, DjonikTurnPart } from "./djonikClient.js";
import type { GroupedIntake } from "./messageGrouping.js";

test("one forward makes one read-only proposal, then one typed acceptance carries that exact proposal", async () => {
  const calls: Array<{ parts: DjonikTurnPart[]; origin?: string }> = [];
  const replies: string[] = [];
  const registry = new ProposalConfirmations(() => 0);
  const proposal = "📨 Extract · паковання\n✂️ Логотип більший\n✅ Внести  ✏️ Змінити";
  const session: DjonikSessionHandle = {
    sessionId: "fake", send: async () => { throw new Error("legacy send"); }, close() {},
    async sendOrdered(parts, origin) { calls.push({ parts, origin }); return calls.length === 1 ? proposal : "Зміни перевірено."; },
  };
  const handlers = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session, invalidate() {}, closeIfOpen() {} },
    proposals: registry,
    sendProposal: async (_chat, text, keyboard) => { replies.push(text); assert.equal(keyboard.inline_keyboard[0].length, 2); return { message_id: 42 }; },
    sendMessage: async (_chat, text) => { replies.push(text); },
    logError: () => {},
  });
  const forwarded: GroupedIntake = {
    text: "forward", images: [], documents: [], parts: [{ type: "text", text: "[Переслане джерело; від: Анна]\nЛоготип більший" }],
    hasForwardedSource: true, fragmentCount: 1, textCount: 1, imageCount: 0, documentCount: 0,
    groupingReason: "single", groupingWaitMs: 0,
  };
  await handlers.onDispatch(1, 7, forwarded);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin, "forwarded_source");
  assert.equal(registry.has(1, 7), true);
  const confirmation = { ...forwarded, text: "внести", parts: [{ type: "text" as const, text: "внести" }], hasForwardedSource: false };
  await handlers.onDispatch(1, 7, confirmation);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].origin, "user_message");
  assert.match((calls[1].parts[0] as { text: string }).text, /Логотип більший/);
  assert.equal(registry.has(1, 7), false);
  assert.deepEqual(replies, [proposal, "Зміни перевірено."]);
});

test("a new forwarded intake invalidates the older proposal even when no replacement can be formed", async () => {
  const registry = new ProposalConfirmations(() => 0);
  const old = "Попередня пропозиція\n✅ Внести  ✏️ Змінити";
  const oldRef = registry.newRef();
  registry.register(1, 7, 41, old, oldRef);
  const session: DjonikSessionHandle = {
    sessionId: "fake", send: async () => { throw new Error("legacy send"); }, close() {},
    async sendOrdered() { return "Яку саме картку маєте на увазі?"; },
  };
  const handlers = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session, invalidate() {}, closeIfOpen() {} },
    proposals: registry,
    sendProposal: async () => { throw new Error("not a proposal"); },
    sendMessage: async () => {}, logError: () => {},
  });
  await handlers.onDispatch(1, 7, {
    text: "нове джерело", images: [], documents: [], parts: [{ type: "text", text: "нове джерело" }],
    hasForwardedSource: true, fragmentCount: 1, textCount: 1, imageCount: 0, documentCount: 0,
    groupingReason: "single", groupingWaitMs: 0,
  });
  assert.deepEqual(registry.click(`fp1:a:${oldRef}`, 1, 7, 41), { kind: "stale" });
  assert.deepEqual(registry.typed("внести", 1, 7), { kind: "stale" });
});

test("a status report proposal uses the same one-confirmation binding", async () => {
  const registry = new ProposalConfirmations(() => 0);
  const calls: string[] = [];
  const session: DjonikSessionHandle = {
    sessionId: "fake", send: async () => { throw new Error("legacy send"); }, close() {},
    async sendOrdered(parts) {
      const text = parts.find((part) => part.type === "text")?.text ?? "";
      calls.push(text);
      return calls.length === 1 ? "Банер Azov → Done після підтвердження\n✅ Внести  ✏️ Змінити" : "✅ Перевірено";
    },
  };
  const handlers = createGroupDispatchHandlers({
    djonikSession: { getSession: async () => session, invalidate() {}, closeIfOpen() {} },
    proposals: registry,
    sendProposal: async () => ({ message_id: 52 }),
    sendMessage: async () => {}, logError: () => {},
  });
  const intake = (text: string): GroupedIntake => ({
    text, images: [], documents: [], parts: [{ type: "text", text }], hasForwardedSource: false,
    fragmentCount: 1, textCount: 1, imageCount: 0, documentCount: 0, groupingReason: "single", groupingWaitMs: 0,
  });
  await handlers.onDispatch(1, 7, intake("Я доробив банер Azov"));
  assert.equal(registry.has(1, 7), true);
  await handlers.onDispatch(1, 7, intake("так, внеси"));
  assert.match(calls[1], /Банер Azov → Done після підтвердження/);
  assert.equal(registry.has(1, 7), false);
});
