import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileRhythmStateStore,
  createMemoryRhythmStateStore,
  emptyRhythmState,
  findDeliveryByRef,
  mayAttempt,
  MAX_DELIVERY_ATTEMPTS,
  recoverRhythmState,
  RhythmStateError,
  type DeliveryRecord,
} from "./rhythmState.js";

// #39 Working Rhythm — the small durable host-side state: atomic, fail-closed, no content.

function record(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    key: "morning:2026-09-29",
    kind: "morning",
    status: "sent",
    attempts: 1,
    ref: "abcdef123456",
    sessionId: "sesn_1",
    createdAt: "2026-09-29T06:30:00.000Z",
    updatedAt: "2026-09-29T06:31:00.000Z",
    actions: ["ack"],
    ...overrides,
  };
}

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "djonik-rhythm-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("file store: a missing file is an empty state; updates persist atomically without temp leftovers", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "nested", "rhythm-state.json");
    const store = createFileRhythmStateStore(path);
    assert.deepEqual(await store.load(), emptyRhythmState());
    await store.update((state) => ({ ...state, deliveries: { [record().key]: record() } }));
    const reread = await createFileRhythmStateStore(path).load();
    assert.equal(reread.deliveries["morning:2026-09-29"].status, "sent");
    assert.deepEqual(await readdir(join(dir, "nested")), ["rhythm-state.json"]);
    assert.doesNotMatch(await readFile(path, "utf8"), /Сьогодні|brief text/, "no message content is stored");
  });
});

test("file store: corrupt or unknown state fails closed (never treated as empty)", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "rhythm-state.json");
    await writeFile(path, "{not json");
    await assert.rejects(() => createFileRhythmStateStore(path).load(), RhythmStateError);
    await writeFile(path, JSON.stringify({ version: 2, deliveries: {}, signals: {} }));
    await assert.rejects(() => createFileRhythmStateStore(path).load(), RhythmStateError);
    await assert.rejects(() => createFileRhythmStateStore(path).update((s) => s), RhythmStateError);
  });
});

test("concurrent updates are serialized: no lost write between scheduler and callback", async () => {
  await withDir(async (dir) => {
    const store = createFileRhythmStateStore(join(dir, "rhythm-state.json"));
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.update((state) => ({ ...state, deliveries: { ...state.deliveries, [`k${i}`]: record({ key: `k${i}`, ref: `ref00000${i}` }) } })),
      ),
    );
    assert.equal(Object.keys((await store.load()).deliveries).length, 10);
  });
  const memory = createMemoryRhythmStateStore();
  await Promise.all([1, 2, 3].map((i) => memory.update((s) => ({ ...s, deliveries: { ...s.deliveries, [`k${i}`]: record({ key: `k${i}` }) } }))));
  assert.equal(Object.keys(memory.snapshot().deliveries).length, 3);
});

test("a failed mutation does not poison later updates", async () => {
  const store = createMemoryRhythmStateStore();
  await assert.rejects(() => store.update(() => { throw new Error("boom"); }));
  await store.update((s) => ({ ...s, deliveries: { a: record({ key: "a" }) } }));
  assert.ok(store.snapshot().deliveries.a);
});

test("restart recovery: `sending` becomes ambiguous (never resent); `claimed` may retry; old records pruned", () => {
  const now = new Date("2026-09-29T07:00:00Z");
  const state = {
    ...emptyRhythmState(),
    deliveries: {
      a: record({ key: "a", status: "sending" }),
      b: record({ key: "b", status: "claimed", updatedAt: "2026-09-29T06:59:00.000Z" }),
      old: record({ key: "old", updatedAt: "2026-08-01T00:00:00.000Z" }),
    },
  };
  const recovered = recoverRhythmState(state, now);
  assert.equal(recovered.deliveries.a.status, "ambiguous");
  assert.equal(mayAttempt(recovered.deliveries.a), false);
  assert.equal(recovered.deliveries.b.status, "claimed");
  assert.equal(mayAttempt(recovered.deliveries.b), true);
  assert.equal(recovered.deliveries.old, undefined);
});

test("restart recovery: an exception interrupted before send is dropped, so it cannot block later exceptions", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const state = { ...emptyRhythmState(), deliveries: { e: record({ key: "e", kind: "exception", status: "claimed", updatedAt: "2026-09-29T11:00:00.000Z" }) } };
  const recovered = recoverRhythmState(state, now);
  assert.equal(recovered.deliveries.e.status, "failed");
  assert.equal(mayAttempt(recovered.deliveries.e), false);
});

test("mayAttempt: only unseen, interrupted-claim or definite-failure occurrences may (re)start", () => {
  assert.equal(mayAttempt(undefined), true);
  for (const status of ["sent", "ambiguous", "silent", "blocked", "sending"] as const) {
    assert.equal(mayAttempt(record({ status })), false, status);
  }
  assert.equal(mayAttempt(record({ status: "failed", retryable: false })), false, "a failed turn is never re-run blindly");
  assert.equal(mayAttempt(record({ status: "failed", retryable: true })), true);
  assert.equal(mayAttempt(record({ status: "failed", retryable: true, attempts: MAX_DELIVERY_ATTEMPTS })), false);
});

test("findDeliveryByRef locates the record a button refers to", () => {
  const state = { ...emptyRhythmState(), deliveries: { a: record({ key: "a", ref: "aaaaaa111111" }), b: record({ key: "b", ref: "bbbbbb222222" }) } };
  assert.equal(findDeliveryByRef(state, "bbbbbb222222")?.key, "b");
  assert.equal(findDeliveryByRef(state, "cccccc333333"), undefined);
});
