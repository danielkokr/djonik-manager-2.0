import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RHYTHM_CONFIG } from "./rhythmConfig.js";
import {
  createFileRhythmStateStore,
  createMemoryRhythmStateStore,
  emptyRhythmState,
  recoverRhythmState,
  remindersOf,
  RhythmStateError,
  withReminders,
} from "./rhythmState.js";
import {
  beginDirectSend,
  claimForRitual,
  createReminder,
  dueReminders,
  emptyReminderLedger,
  RITUAL_CLAIM_TTL_MINUTES,
  recoverReminders,
  rescheduleReminder,
  settleDirectSend,
  validateReminderLedger,
  type Reminder,
  type ReminderLedger,
} from "./reminders.js";
import { resolveReminderWhen } from "./reminderTime.js";
import { createRhythmScheduler } from "./rhythmRunner.js";

// #54 reminder ledger: lifecycle transitions, persistence, validation, recovery, and the module boundary.
// Zero network, zero inference.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-09-26T09:00:00Z");

function ledgerWith(...texts: string[]): ReminderLedger {
  let ledger = emptyReminderLedger();
  texts.forEach((text, index) => {
    const schedule = resolveReminderWhen({ time: `1${5 + index}:00` }, NOW, DEFAULT_RHYTHM_CONFIG);
    const outcome = createReminder(ledger, { id: `aaaa000${index + 1}`, text, project: null, card: null, schedule, toolUseId: `sevt_${index}`, now: NOW });
    ledger = outcome.ledger;
  });
  return ledger;
}

test("create persists across reload; two reminders stay distinct; an older-format state (no reminders) still loads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "djonik-ledger-"));
  try {
    const path = join(dir, "rhythm-state.json");
    writeFileSync(path, JSON.stringify(emptyRhythmState()));
    const store = createFileRhythmStateStore(path);
    assert.equal((await store.load()).reminders, undefined);
    await store.update((state) => withReminders(state, ledgerWith("банер", "Limen")));
    const reloaded = remindersOf(await createFileRhythmStateStore(path).load());
    assert.deepEqual(Object.values(reloaded.items).map((item) => [item.id, item.text, item.status]), [
      ["aaaa0001", "банер", "scheduled"],
      ["aaaa0002", "Limen", "scheduled"],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rhythm-only state file is never given an empty reminders section; rhythm writes keep an existing one", async () => {
  assert.equal(withReminders(emptyRhythmState(), emptyReminderLedger()).reminders, undefined);
  const store = createMemoryRhythmStateStore({ ...emptyRhythmState(), reminders: ledgerWith("банер") });
  // The same spread every rhythm writer (and an older revision) uses.
  await store.update((current) => ({ ...current, signals: {} }));
  assert.equal(Object.keys(remindersOf(store.snapshot()).items).length, 1);
});

test("invalid or corrupt reminder state fails closed: load throws, the rhythm tick sends nothing", async () => {
  const good = ledgerWith("банер");
  const corruptions: unknown[] = [
    { ...good, version: 2 },
    { ...good, items: { aaaa0001: { ...good.items.aaaa0001, status: "whatever" } } },
    { ...good, items: { aaaa0001: { ...good.items.aaaa0001, id: "other" } } },
    { ...good, items: { aaaa0001: { ...good.items.aaaa0001, schedule: { ...good.items.aaaa0001.schedule, dueAt: "later" } } } },
    { ...good, toolCalls: { x: { op: "delete", at: NOW.toISOString(), isError: false, content: "" } } },
    [],
  ];
  const dir = mkdtempSync(join(tmpdir(), "djonik-ledger-"));
  try {
    for (const [index, reminders] of corruptions.entries()) {
      assert.throws(() => validateReminderLedger(reminders), Error, String(index));
      const path = join(dir, `state-${index}.json`);
      writeFileSync(path, JSON.stringify({ ...emptyRhythmState(), reminders }));
      await assert.rejects(createFileRhythmStateStore(path).load(), RhythmStateError);
      const sends: unknown[] = [];
      const report = await createRhythmScheduler({
        activation: { enabled: true, reason: "test" },
        readOnlyBoundary: "pre_execution",
        now: () => new Date("2026-09-29T06:30:00Z"),
        configSource: { read: async () => null },
        store: createFileRhythmStateStore(path),
        runTurn: async () => assert.fail("no model turn on a corrupt state"),
        send: async (message) => (sends.push(message), { status: "sent", messageId: 1 }),
      }).tick();
      assert.equal(report.status, "state_unavailable");
      assert.equal(sends.length, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("direct send: begin only on the same generation; an outcome for an older generation is ignored", () => {
  const ledger = ledgerWith("банер");
  const begun = beginDirectSend(ledger, "aaaa0001", 1, NOW)!;
  assert.equal(begun.reminder.status, "sending");
  assert.equal(beginDirectSend(begun.ledger, "aaaa0001", 1, NOW), null, "already sending");
  const moved = rescheduleReminder(begun.ledger, "aaaa0001", resolveReminderWhen({ day: "tomorrow", time: "11:00" }, NOW, DEFAULT_RHYTHM_CONFIG), NOW);
  const settled = settleDirectSend(moved, "aaaa0001", 1, { status: "sent", messageId: 5 }, NOW);
  assert.deepEqual([settled.items.aaaa0001.status, settled.items.aaaa0001.seq, settled.items.aaaa0001.telegramMessageId], ["scheduled", 2, undefined]);
});

test("ritual claims: only today's morning reminders; a claim protects from direct delivery, then expires if stranded", () => {
  let ledger = ledgerWith("timed");
  const morning = resolveReminderWhen({ day: "date", date: "29.09" }, NOW, DEFAULT_RHYTHM_CONFIG);
  ledger = createReminder(ledger, { id: "bbbb0001", text: "банер", project: null, card: null, schedule: morning, toolUseId: "sevt_m", now: NOW }).ledger;
  const at = new Date("2026-09-29T06:30:00Z");
  const { ledger: claimed, claimed: list } = claimForRitual(ledger, "morning:2026-09-29", "2026-09-29", at);
  assert.deepEqual(list.map((item: Reminder) => item.id), ["bbbb0001"]);
  assert.deepEqual(dueReminders(claimed, at).map((item) => item.id), ["aaaa0001"], "the claimed one is not directly due");
  const later = new Date(at.getTime() + RITUAL_CLAIM_TTL_MINUTES * 60_000);
  assert.deepEqual(dueReminders(claimed, later).map((item) => item.id), ["aaaa0001", "bbbb0001"], "a stranded claim expires");
});

test("recovery: sending → ambiguous, claims released, old closed pruned, open kept however old", () => {
  let ledger = ledgerWith("sending", "claimed", "old-done", "old-open");
  const old = "2026-07-01T00:00:00.000Z";
  ledger.items.aaaa0001 = { ...ledger.items.aaaa0001, status: "sending" };
  ledger.items.aaaa0002 = { ...ledger.items.aaaa0002, ritualClaim: { key: "morning:x", at: NOW.toISOString() } };
  ledger.items.aaaa0003 = { ...ledger.items.aaaa0003, status: "done", updatedAt: old };
  ledger.items.aaaa0004 = { ...ledger.items.aaaa0004, updatedAt: old };
  ledger = { ...ledger, toolCalls: { old: { op: "create", at: old, isError: false, content: "{}" }, fresh: { op: "create", at: NOW.toISOString(), isError: false, content: "{}" } } };
  const recovered = recoverReminders(ledger, NOW);
  assert.equal(recovered.items.aaaa0001.status, "ambiguous");
  assert.equal(recovered.items.aaaa0002.ritualClaim, undefined);
  assert.equal(recovered.items.aaaa0003, undefined);
  assert.equal(recovered.items.aaaa0004.status, "scheduled");
  assert.deepEqual(Object.keys(recovered.toolCalls), ["fresh"]);
  // The rhythm recovery carries the reminders along.
  assert.equal(recoverRhythmState({ ...emptyRhythmState(), reminders: ledger }, NOW).reminders!.items.aaaa0001.status, "ambiguous");
});

test("module boundary: reminder code has no Trello write, Session client, custom-tool lifecycle or network path", () => {
  const files = readdirSync(join(repoRoot, "src")).filter((name) => /^reminder.*\.ts$/.test(name) && !name.includes(".test"));
  assert.deepEqual(files.sort(), ["reminderDelivery.ts", "reminderTime.ts", "reminderTool.ts", "reminders.ts"]);
  for (const name of files) {
    const source = readFileSync(join(repoRoot, "src", name), "utf8");
    assert.doesNotMatch(source, /from "\.\/(trelloMutationLedger|customToolResolution|djonikClient|toolConfirmation)\.js"/, name);
    assert.doesNotMatch(source, /\bfetch\(|api\.trello\.com|trelloWrite\w*|memoryStores|\.memories\./, name);
    for (const [, path] of source.matchAll(/^import (?!type)[^;]*from "(\.\/trelloWorkHistory)\.js"/gm)) assert.fail(`${name} value-imports ${path}`);
  }
  // Delivery reads a card only through the GET-only reader interface.
  assert.match(readFileSync(join(repoRoot, "src", "reminderDelivery.ts"), "utf8"), /import type \{ TrelloCardState \} from "\.\/trelloWorkHistory\.js"/);
});
