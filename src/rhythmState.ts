import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProactiveKind, RhythmActionId } from "./rhythmActions.js";
import type { SignalLedger, SignalSeverity } from "./rhythmSignals.js";

/**
 * Host-side durable state for the Working Rhythm (#39): one small JSON file, replaced atomically.
 * No database, no event store, no Trello mirror, no message content — only occurrence identities,
 * delivery status, Telegram message ids, button refs and the signal lifecycle.
 *
 * Delivery lifecycle per occurrence key (`morning:2026-09-29`, `exception:2026-09-29#1`):
 *
 *   claimed ──model reply──▶ sending ──Telegram ok──▶ sent
 *      │                        ├──definite API refusal──▶ failed (retryable while attempts remain)
 *      │                        └──network/unknown outcome──▶ ambiguous (terminal: never resent)
 *      ├──model error──▶ failed (terminal: a turn is never re-run blindly)
 *      ├──SILENT (exceptions)──▶ silent
 *      └──autonomous write detected──▶ blocked (a fixed notice is sent instead)
 *
 * The record is written BEFORE the model call and again BEFORE the Telegram call. A crash leaves
 * `claimed` (nothing visible happened; may retry) or `sending` (the send may have happened; on restart
 * it becomes `ambiguous` and is never resent).
 */

export type DeliveryStatus = "claimed" | "sending" | "sent" | "ambiguous" | "failed" | "silent" | "blocked";

export interface DeliveryRecord {
  key: string;
  kind: ProactiveKind;
  status: DeliveryStatus;
  attempts: number;
  /** Short random reference carried in `callback_data`; never derived from content. */
  ref: string;
  /** The serving Session the message's context lives in; a button from another Session is stale. */
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the Telegram call started; for an ambiguous record this is the best "possibly sent at". */
  sendStartedAt?: string;
  sentAt?: string;
  telegramMessageId?: number;
  actions: RhythmActionId[];
  /** Content-free failure category. */
  failure?: string;
  /** Model/Telegram failures that may be retried (definite non-delivery only). */
  retryable?: boolean;
  /** Exceptions only. */
  severity?: SignalSeverity;
  signalHandles?: string[];
  /** A button under this message was accepted (buttons are single-use). */
  answeredAt?: string;
  answeredAction?: RhythmActionId;
}

export interface RhythmState {
  version: 1;
  deliveries: Record<string, DeliveryRecord>;
  signals: SignalLedger;
}

export function emptyRhythmState(): RhythmState {
  return { version: 1, deliveries: {}, signals: {} };
}

export class RhythmStateError extends Error {}

/**
 * `update` is the only write path: a serialized load → mutate → atomic save, so the scheduler and a
 * button callback in the same process can never overwrite each other's changes. Each writer changes
 * only its own fields (the scheduler: its occurrence records and the signal ledger; a callback: the
 * answered fields of one sent record).
 */
export interface RhythmStateStore {
  load(): Promise<RhythmState>;
  update(mutate: (state: RhythmState) => RhythmState): Promise<RhythmState>;
}

/** Serializes `update` calls through one promise chain (single process; one poller per bot token). */
function serialized(load: () => Promise<RhythmState>, save: (state: RhythmState) => Promise<void>): RhythmStateStore["update"] {
  let tail: Promise<unknown> = Promise.resolve();
  return (mutate) => {
    const run = tail.then(async () => {
      const next = mutate(await load());
      await save(next);
      return next;
    });
    tail = run.catch(() => undefined);
    return run;
  };
}

function isState(value: unknown): value is RhythmState {
  const candidate = value as Partial<RhythmState> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.version === 1 &&
    typeof candidate.deliveries === "object" &&
    candidate.deliveries !== null &&
    typeof candidate.signals === "object" &&
    candidate.signals !== null
  );
}

/**
 * File store with atomic replacement (write a sibling temp file, fsync, rename). A missing file is an
 * empty state; an unreadable or unrecognised file throws `RhythmStateError`, and the scheduler then
 * sends nothing — a lost state must never turn into duplicate messages.
 */
export function createFileRhythmStateStore(path: string): RhythmStateStore {
  const load = async (): Promise<RhythmState> => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRhythmState();
      throw new RhythmStateError(`rhythm state unreadable: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RhythmStateError("rhythm state is not valid JSON");
    }
    if (!isState(parsed)) throw new RhythmStateError("rhythm state has an unknown shape or version");
    return parsed;
  };
  const save = async (state: RhythmState): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const handle = await open(temp, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  };
  return { load, update: serialized(load, save) };
}

/** In-memory store for tests and offline runs (same contract, deep-copied on every call). */
export function createMemoryRhythmStateStore(initial: RhythmState = emptyRhythmState()): RhythmStateStore & { snapshot(): RhythmState } {
  let current = structuredClone(initial);
  const load = async () => structuredClone(current);
  return {
    load,
    update: serialized(load, async (state) => {
      current = structuredClone(state);
    }),
    snapshot() {
      return structuredClone(current);
    },
  };
}

export function newDeliveryRef(): string {
  return randomBytes(6).toString("hex");
}

const RETENTION_DAYS = 21;

/**
 * Startup recovery: a record left in `sending` may already be on Daniel's screen, so it becomes
 * `ambiguous` and is never resent. A ritual left `claimed` stays retryable: nothing visible happened
 * and the ritual is expected. An exception left `claimed` is dropped (`failed`): its facts wait for
 * the next ritual instead of an interruption re-attempted after a crash. Old records are pruned.
 */
export function recoverRhythmState(state: RhythmState, now: Date): RhythmState {
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  const deliveries: Record<string, DeliveryRecord> = {};
  for (const [key, record] of Object.entries(state.deliveries)) {
    if (new Date(record.updatedAt).getTime() < cutoff) continue;
    if (record.status === "sending") {
      deliveries[key] = { ...record, status: "ambiguous", failure: "interrupted_during_send", retryable: false, updatedAt: now.toISOString() };
    } else if (record.status === "claimed" && record.kind === "exception") {
      deliveries[key] = { ...record, status: "failed", failure: "interrupted_before_send", retryable: false, updatedAt: now.toISOString() };
    } else {
      deliveries[key] = { ...record };
    }
  }
  return { ...state, deliveries };
}

/** Maximum model+send attempts per occurrence (only definite non-delivery or an interrupted claim retries). */
export const MAX_DELIVERY_ATTEMPTS = 2;

/** Whether an occurrence may start (again). Anything visible or possibly visible is final. */
export function mayAttempt(record: DeliveryRecord | undefined): boolean {
  if (!record) return true;
  if (record.attempts >= MAX_DELIVERY_ATTEMPTS) return false;
  if (record.status === "claimed") return true; // interrupted before anything was sent
  return record.status === "failed" && record.retryable === true;
}

export function findDeliveryByRef(state: RhythmState, ref: string): DeliveryRecord | undefined {
  return Object.values(state.deliveries).find((record) => record.ref === ref);
}
