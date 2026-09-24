import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { parseRhythmConfig } from "./rhythmConfig.js";
import {
  createMemoryRhythmConfigSource,
  RHYTHM_CONFIG_PATH,
  RhythmConfigReadError,
  sdkRhythmMemoryReader,
  type RhythmMemoryListItem,
  type RhythmMemoryReader,
  type RhythmMemoryRecord,
} from "./rhythmMemoryConfig.js";
import { SERVING_RELEASE } from "./release.js";

// #39 Stage 2 — the one reviewed direct Memory API read: `/rhythm.md`, read-only, production store only.

const STORE = SERVING_RELEASE.session.memoryStoreId;

interface Recorded {
  lists: Array<{ store: string; params: unknown }>;
  retrieves: Array<{ id: string; params: unknown }>;
}

function fakeReader(root: RhythmMemoryListItem[], records: Record<string, RhythmMemoryRecord | Error> = {}): RhythmMemoryReader & Recorded {
  const recorded: Recorded = { lists: [], retrieves: [] };
  return {
    list(store, params) {
      recorded.lists.push({ store, params });
      return (async function* () {
        yield* root;
      })();
    },
    async retrieve(id, params) {
      recorded.retrieves.push({ id, params });
      const record = records[id];
      if (record === undefined) throw new Error("404 not_found");
      if (record instanceof Error) throw record;
      return record;
    },
    get lists() {
      return recorded.lists;
    },
    get retrieves() {
      return recorded.retrieves;
    },
  };
}

const ROOT: RhythmMemoryListItem[] = [
  { type: "memory_prefix", path: "/commitments/" },
  { type: "memory_prefix", path: "/projects/" },
  { type: "memory", path: "/preferences.md", id: "mem_prefs" },
  { type: "memory", path: "/rhythm.md", id: "mem_rhythm" },
];
const RHYTHM: RhythmMemoryRecord = { id: "mem_rhythm", path: "/rhythm.md", memory_store_id: STORE, content: "morning: 10:00\n" };

test("reads exactly /rhythm.md from the configured production store: one root listing (paths only), one retrieve", async () => {
  const reader = fakeReader(ROOT, { mem_rhythm: RHYTHM });
  const text = await createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read();
  assert.equal(text, "morning: 10:00\n");
  assert.deepEqual(reader.lists, [{ store: STORE, params: { path_prefix: "/", depth: 1, view: "basic" } }]);
  assert.deepEqual(reader.retrieves, [{ id: "mem_rhythm", params: { memory_store_id: STORE, view: "full" } }]);
  assert.equal(RHYTHM_CONFIG_PATH, "/rhythm.md");
});

test("commitment records are untouched: a subdirectory marker is never opened or retrieved, nor any other file", async () => {
  const reader = fakeReader(ROOT, { mem_rhythm: RHYTHM });
  await createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read();
  assert.equal(reader.lists.length, 1, "no drill-down into /commitments/ or /projects/");
  assert.deepEqual(reader.retrieves.map((call) => call.id), ["mem_rhythm"]);
});

test("missing /rhythm.md → null (Stage 1 defaults, no warning)", async () => {
  const reader = fakeReader(ROOT.filter((item) => item.path !== "/rhythm.md"));
  const text = await createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read();
  assert.equal(text, null);
  assert.equal(reader.retrieves.length, 0);
  const parsed = parseRhythmConfig(text);
  assert.equal(parsed.source, "default");
  assert.deepEqual(parsed.warnings, []);
});

test("a nested or look-alike path is not the config", async () => {
  const reader = fakeReader([
    { type: "memory_prefix", path: "/rhythm.md/" },
    { type: "memory", path: "/Rhythm.md", id: "mem_case" },
    { type: "memory", path: "/rhythm.md.bak", id: "mem_bak" },
  ]);
  assert.equal(await createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read(), null);
  assert.equal(reader.retrieves.length, 0);
});

test("provider failure (list or retrieve) → throws, so the tick reports config_unavailable and sends nothing", async () => {
  const failingList: RhythmMemoryReader = {
    list: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("503")) }),
    }),
    retrieve: async () => RHYTHM,
  };
  await assert.rejects(() => createMemoryRhythmConfigSource({ reader: failingList, memoryStoreId: STORE }).read(), /503/);
  const failingRetrieve = fakeReader(ROOT, { mem_rhythm: new Error("500") });
  await assert.rejects(() => createMemoryRhythmConfigSource({ reader: failingRetrieve, memoryStoreId: STORE }).read(), /500/);
});

test("an unexpected record (other store, renamed, no content) is refused rather than trusted", async () => {
  for (const record of [
    { ...RHYTHM, memory_store_id: "memstore_other" },
    { ...RHYTHM, path: "/elsewhere.md" },
    { ...RHYTHM, content: null },
    { ...RHYTHM, id: "mem_other" },
  ]) {
    const reader = fakeReader(ROOT, { mem_rhythm: record });
    await assert.rejects(() => createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read(), RhythmConfigReadError);
  }
});

test("bounded: a root with more entries than the limit fails instead of scanning without end", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ type: "memory", path: `/n${i}.md`, id: `mem_${i}` }));
  const reader = fakeReader([...many, { type: "memory", path: "/rhythm.md", id: "mem_rhythm" }], { mem_rhythm: RHYTHM });
  await assert.rejects(() => createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE, maxEntries: 3 }).read(), /too_many_root_entries/);
});

test("malformed text is returned as-is; the Stage 1 parser falls back safely without throwing", async () => {
  const reader = fakeReader(ROOT, { mem_rhythm: { ...RHYTHM, content: "morning: 99:99\n\u0000garbage ::: \nquiet_hours: -" } });
  const text = await createMemoryRhythmConfigSource({ reader, memoryStoreId: STORE }).read();
  const parsed = parseRhythmConfig(text);
  assert.equal(parsed.config.morning, 9 * 60 + 30, "invalid morning → default");
  assert.ok(parsed.warnings.length >= 2);
});

test("SDK binding: only memories.list and memories.retrieve are called, with the official parameter shapes", async () => {
  const calls: string[] = [];
  const client = {
    beta: {
      memoryStores: {
        memories: {
          list: (store: string, params: unknown) => {
            calls.push(`list ${store} ${JSON.stringify(params)}`);
            return (async function* () {
              yield { type: "memory", path: "/rhythm.md", id: "mem_rhythm" };
            })();
          },
          retrieve: async (id: string, params: unknown) => {
            calls.push(`retrieve ${id} ${JSON.stringify(params)}`);
            return RHYTHM;
          },
          create: () => assert.fail("never create"),
          update: () => assert.fail("never update"),
          delete: () => assert.fail("never delete"),
        },
      },
    },
  } as unknown as Anthropic;
  const text = await createMemoryRhythmConfigSource({ reader: sdkRhythmMemoryReader(client), memoryStoreId: STORE }).read();
  assert.equal(text, RHYTHM.content);
  assert.deepEqual(calls, [
    `list ${STORE} {"path_prefix":"/","depth":1,"view":"basic"}`,
    `retrieve mem_rhythm {"memory_store_id":"${STORE}","view":"full"}`,
  ]);
});
