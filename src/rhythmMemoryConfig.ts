import type Anthropic from "@anthropic-ai/sdk";
import type { RhythmConfigSource } from "./rhythmConfig.js";

/**
 * The ONE reviewed direct Memory API read in the application (#39, Product Lead decision 2026-09-24): the
 * Working Rhythm settings file `/rhythm.md` in the production Memory Store. Everything else in Memory —
 * the #34 accepted-outcome records above all — is read and written only by Claude with its native file tools.
 *
 * Measured from the installed SDK (0.125.0) and the current Memory docs: a memory is retrieved by its
 * `mem_…` id, and the only path lookup is a list with a segment-aligned `path_prefix`. So the source lists
 * the store ROOT at `depth: 1` with `view: "basic"` (paths only, never content; every subdirectory, the #34
 * records included, comes back as a bare `memory_prefix` marker and is skipped, never opened), takes the id of
 * the exact `/rhythm.md` memory, then retrieves that one memory. It never creates, updates, deletes,
 * enumerates a subdirectory, reads another file's content, caches, or touches another store.
 *
 * Outcomes the scheduler relies on: file absent → `null` (Stage 1 defaults); any provider failure or an
 * unexpected answer → throws (the tick reports `config_unavailable` and nothing is sent); malformed text is
 * returned as-is for the Stage 1 parser, which never throws.
 */

export const RHYTHM_CONFIG_PATH = "/rhythm.md";

/** Upper bound on root entries examined; beyond it the read fails rather than scanning without limit. */
export const MAX_ROOT_ENTRIES = 1000;

export interface RhythmMemoryListItem {
  type: string;
  path: string;
  id?: string;
}

export interface RhythmMemoryRecord {
  id: string;
  path: string;
  memory_store_id: string;
  content?: string | null;
}

/** The only two Memory API operations the source may use — both reads. */
export interface RhythmMemoryReader {
  list(memoryStoreId: string, params: { path_prefix: "/"; depth: 1; view: "basic" }): AsyncIterable<RhythmMemoryListItem>;
  retrieve(memoryId: string, params: { memory_store_id: string; view: "full" }): Promise<RhythmMemoryRecord>;
}

/** Binds the reader to the official SDK (`client.beta.memoryStores.memories`; list auto-paginates). */
export function sdkRhythmMemoryReader(client: Anthropic): RhythmMemoryReader {
  const memories = client.beta.memoryStores.memories;
  return {
    list: (memoryStoreId, params) => memories.list(memoryStoreId, params),
    retrieve: (memoryId, params) => memories.retrieve(memoryId, params),
  };
}

export class RhythmConfigReadError extends Error {
  constructor(readonly code: "too_many_root_entries" | "unexpected_record") {
    super(`rhythm config read failed: ${code}`);
    this.name = "RhythmConfigReadError";
  }
}

export function createMemoryRhythmConfigSource(options: { reader: RhythmMemoryReader; memoryStoreId: string; maxEntries?: number }): RhythmConfigSource {
  const { reader, memoryStoreId } = options;
  const maxEntries = options.maxEntries ?? MAX_ROOT_ENTRIES;
  return {
    async read() {
      let memoryId: string | null = null;
      let seen = 0;
      for await (const item of reader.list(memoryStoreId, { path_prefix: "/", depth: 1, view: "basic" })) {
        seen += 1;
        if (seen > maxEntries) throw new RhythmConfigReadError("too_many_root_entries");
        if (item.type !== "memory" || item.path !== RHYTHM_CONFIG_PATH) continue;
        if (typeof item.id !== "string" || item.id.length === 0) throw new RhythmConfigReadError("unexpected_record");
        memoryId = item.id;
        break;
      }
      if (memoryId === null) return null;
      const record = await reader.retrieve(memoryId, { memory_store_id: memoryStoreId, view: "full" });
      if (record.id !== memoryId || record.path !== RHYTHM_CONFIG_PATH || record.memory_store_id !== memoryStoreId || typeof record.content !== "string") {
        throw new RhythmConfigReadError("unexpected_record");
      }
      return record.content;
    },
  };
}
