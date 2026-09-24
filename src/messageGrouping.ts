import type { DjonikDocumentInput, DjonikImageInput, DjonikTurnPart } from "./djonikClient.js";

/**
 * Deterministic, in-memory grouping of related Telegram fragments into one
 * coherent Managed Agent intake (#25). Framework-agnostic on purpose: it
 * knows nothing about grammY/`Context`, only the primitive identifiers a
 * Telegram update already carries (`chat.id`, `from.id`, `message_id`,
 * `media_group_id`) and promises resolving to the already-accepted #22/#24
 * `DjonikImageInput`/`DjonikDocumentInput` shapes. This keeps the grouping
 * logic unit-testable without a live bot and without duplicating any
 * download/transport code.
 */

export type GroupingReason = "single" | "adjacent_window" | "media_group_id";

type MediaFragment =
  | { kind: "image"; promise: Promise<DjonikImageInput> }
  | { kind: "document"; promise: Promise<DjonikDocumentInput> };

/**
 * One incoming Telegram fragment. `media`'s promise must already be
 * in-flight (the caller starts the download/validation immediately on
 * arrival, before calling `addFragment`) so buffering time and download time
 * overlap instead of stacking — the debounce window never adds attachment
 * download latency on top of itself.
 */
export interface IncomingFragment {
  chatId: number;
  userId: number;
  messageId: number;
  /** Telegram's explicit album relation, when this fragment is part of one. */
  mediaGroupId?: string;
  /** Plain text or caption; "" when this fragment carries no text at all. */
  text: string;
  media?: MediaFragment;
}

export interface GroupedIntake {
  /** Combined text across all text-bearing fragments, ordered and bounded (see `buildCombinedText`). */
  text: string;
  /** Resolved images in Telegram message-id order. */
  images: DjonikImageInput[];
  /** Resolved documents in Telegram message-id order. */
  documents: DjonikDocumentInput[];
  /**
   * Ordered text/image/document parts, one per fragment's own content, in
   * Telegram `message_id` order (#27). Unlike `text`/`images`/`documents`
   * above (which flatten the group into three separate groups, losing
   * cross-modal order and caption ↔ attachment association), `parts`
   * preserves each fragment's own media immediately alongside that same
   * fragment's own text — a caption stays next to its image, and a
   * text → image → correcting-text sequence keeps that exact order. Within
   * one fragment, its media part (if any) comes before its text part (if
   * any), matching the pre-#27 fixed single-attachment order so a
   * single-fragment intake (plain text, one image+caption, one PDF+caption)
   * produces byte-identical content blocks to before. Feed this to
   * `DjonikSessionHandle.sendOrdered`, not `send`.
   */
  parts: DjonikTurnPart[];
  fragmentCount: number;
  textCount: number;
  imageCount: number;
  documentCount: number;
  groupingReason: GroupingReason;
  /** Elapsed ms from the group's first fragment to dispatch. */
  groupingWaitMs: number;
}

/** Content-free telemetry shape for a grouped dispatch — counts/reason/duration only, never text/media content. */
export interface GroupingTelemetry {
  groupedFragmentCount: number;
  groupedTextCount: number;
  groupedImageCount: number;
  groupedDocumentCount: number;
  groupingReason: GroupingReason;
  groupingWaitMs: number;
}

export function buildGroupingTelemetry(intake: GroupedIntake): GroupingTelemetry {
  return {
    groupedFragmentCount: intake.fragmentCount,
    groupedTextCount: intake.textCount,
    groupedImageCount: intake.imageCount,
    groupedDocumentCount: intake.documentCount,
    groupingReason: intake.groupingReason,
    groupingWaitMs: intake.groupingWaitMs,
  };
}

/**
 * Deterministic representation for several combined text fragments (adjacent
 * messages and/or captions), preserving order and boundaries without
 * summarizing/rewriting anything — Djonik must see the user's original
 * words. A single text-bearing fragment is returned unwrapped so a
 * standalone message is byte-for-byte unaffected by grouping (regression
 * requirement).
 */
export function buildCombinedText(fragments: Array<{ order: number; text: string }>): string {
  const sorted = [...fragments].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return sorted[0].text;
  return sorted.map((fragment, index) => `[Fragment ${index + 1}]\n${fragment.text}`).join("\n\n");
}

/** Debounce window for immediately adjacent fragments with no explicit Telegram relation (see report §4 for rationale). */
export const DEFAULT_ADJACENT_WINDOW_MS = 1200;

/** Settle window for fragments sharing an explicit `media_group_id` (see report §4 for rationale). */
export const DEFAULT_ALBUM_SETTLE_WINDOW_MS = 1500;

/**
 * Hard ceiling on how many fragments one group may accumulate. This is the
 * bounded-lifetime guarantee's fragment-count counterpart: without it, a
 * pathological burst of messages inside one debounce window could grow a
 * single group's fragment array without limit. Reaching the ceiling fails
 * the group visibly (see `addFragment`) rather than silently continuing to
 * accumulate. 20 is a generous margin over any realistic Telegram album
 * (max 10 items) or plausible burst of short adjacent text messages.
 */
export const DEFAULT_MAX_FRAGMENTS_PER_GROUP = 20;

/**
 * Minimal scheduler seam so tests can drive grouping decisions
 * deterministically (a fake, manually-advanced clock) instead of relying on
 * real wall-clock `sleep`s to exercise timer-race conditions. Production
 * code always uses `REAL_SCHEDULER` (the default); nothing about runtime
 * behavior changes because of this seam.
 */
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_SCHEDULER: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface MessageGroupBufferOptions {
  adjacentWindowMs?: number;
  albumSettleWindowMs?: number;
  /** Hard per-group fragment ceiling (see `DEFAULT_MAX_FRAGMENTS_PER_GROUP`). */
  maxFragmentsPerGroup?: number;
  /** Test-only seam; defaults to real `setTimeout`/`Date.now`. */
  scheduler?: Scheduler;
  /** Called once per settled group with a successfully resolved intake. Never called more than once per group. */
  onDispatch: (chatId: number, userId: number, intake: GroupedIntake) => void | Promise<void>;
  /** Called once per settled group when any required attachment fails MIME/size/download/preparation, or the fragment-count ceiling is exceeded. No `onDispatch` call happens for that group. */
  onFailure: (chatId: number, userId: number, error: unknown) => void | Promise<void>;
}

interface ActiveGroup {
  key: string;
  chatId: number;
  userId: number;
  mediaGroupId: string | null;
  fragments: IncomingFragment[];
  timer: unknown;
  startedAt: number;
  /** True once this group has been dispatched or failed — guards against any double-settling race. */
  settled: boolean;
  /** The previous intake of the same chat/user, when it was not yet handed off at creation (#39). */
  prev: ActiveGroup | null;
  /** True once this intake was handed to `onDispatch`/`onFailure`, or discarded by `clearAll`. */
  handed: boolean;
  handedOff: Promise<void>;
  markHandedOff: () => void;
}

function groupKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

/**
 * The smallest in-memory buffer needed to group related Telegram fragments:
 * no persistence, no DB, bounded lifetime (a group lives only until its
 * debounce timer fires or it fails), and a completed/failed group is removed
 * from the map immediately, so nothing leaks if fragments stop arriving.
 *
 * Isolation is structural: the map key is always `chat:user`, so different
 * chats/users can never share a group. An explicit `media_group_id` locks a
 * group to that album; a fragment carrying a *different* `media_group_id`
 * than the group's own is never merged into it — the existing group is
 * flushed immediately and the new fragment starts a fresh group instead.
 *
 * Node is single-threaded: every state transition below (`addFragment`,
 * `dispatchGroup`, `failGroup`) runs to completion before the next callback
 * can run, so no locks are needed for the concurrency cases the issue calls
 * out (timer firing while a fragment arrives, two chats active at once,
 * near-simultaneous album fragments, one group failing while another stays
 * active).
 */
export class MessageGroupBuffer {
  private readonly groups = new Map<string, ActiveGroup>();
  /** Albums still settling after a button click closed them to other fragments (#39), per chat/user. */
  private readonly sealedAlbums = new Map<string, ActiveGroup[]>();
  /** Per chat/user: the hand-off of the most recently created intake. A later intake is never handed to
   *  `onDispatch` before an earlier one of the same chat/user, so they reach the FIFO Session queue in
   *  arrival order even when an earlier intake is still resolving an attachment. */
  private readonly tails = new Map<string, ActiveGroup>();
  /** Settled groups whose dispatch/failure handling (the whole Djonik turn and its reply) has not finished
   *  yet, keyed to their chat — what a graceful shutdown drains (#33). */
  private readonly inFlight = new Map<Promise<void>, number>();
  private readonly adjacentWindowMs: number;
  private readonly albumSettleWindowMs: number;
  private readonly maxFragmentsPerGroup: number;
  private readonly scheduler: Scheduler;
  private readonly onDispatch: MessageGroupBufferOptions["onDispatch"];
  private readonly onFailure: MessageGroupBufferOptions["onFailure"];

  constructor(options: MessageGroupBufferOptions) {
    this.adjacentWindowMs = options.adjacentWindowMs ?? DEFAULT_ADJACENT_WINDOW_MS;
    this.albumSettleWindowMs = options.albumSettleWindowMs ?? DEFAULT_ALBUM_SETTLE_WINDOW_MS;
    this.maxFragmentsPerGroup = options.maxFragmentsPerGroup ?? DEFAULT_MAX_FRAGMENTS_PER_GROUP;
    this.scheduler = options.scheduler ?? REAL_SCHEDULER;
    this.onDispatch = options.onDispatch;
    this.onFailure = options.onFailure;
  }

  /** True while a group for this chat/user is still buffering (test/introspection helper). */
  hasActiveGroup(chatId: number, userId: number): boolean {
    const key = groupKey(chatId, userId);
    return this.groups.has(key) || (this.sealedAlbums.get(key)?.length ?? 0) > 0;
  }

  private buffering(): ActiveGroup[] {
    return [...[...this.sealedAlbums.values()].flat(), ...this.groups.values()];
  }

  /** Cancels every pending timer without dispatching or failing anything (process shutdown only). */
  clearAll(): void {
    for (const group of this.buffering()) {
      this.scheduler.clearTimeout(group.timer);
      group.markHandedOff();
    }
    this.groups.clear();
    this.sealedAlbums.clear();
  }

  /**
   * Dispatches every still-buffering group immediately instead of waiting for its window (graceful
   * shutdown, #33). Its fragments were already received and acknowledged to Telegram, so dropping them
   * would silently lose an accepted user turn (contract §10).
   */
  flushAll(): void {
    for (const group of this.buffering()) this.dispatchGroup(group);
  }

  /**
   * Adds a fragment that must be its own intake, placed after everything this chat/user already sent and
   * before anything they send next — a Working Rhythm button click (#39), which carries the id of an older
   * bot message and so must never be sorted into, or merged with, a group of fresh input.
   *
   * - A still-buffering text/single group is closed now: nothing still arriving belongs to it, and a later
   *   message belongs after the click.
   * - A still-arriving album is NOT split: it keeps its own settle window and stays one intake; only its own
   *   `media_group_id` fragments may still join it. Anything else starts a new group.
   * - The click is handed to `onDispatch` only after every earlier intake of this chat/user (including an
   *   album still settling or an attachment still downloading), so it reaches the same FIFO Session queue
   *   as the following turn.
   */
  enqueueAfterPending(fragment: IncomingFragment): void {
    const key = groupKey(fragment.chatId, fragment.userId);
    const active = this.groups.get(key);
    if (active) {
      if (active.mediaGroupId !== null) {
        this.groups.delete(key);
        this.sealedAlbums.set(key, [...(this.sealedAlbums.get(key) ?? []), active]);
      } else {
        this.dispatchGroup(active);
      }
    }
    fragment.media?.promise.catch(() => {});
    this.dispatchGroup(this.newGroup(key, fragment));
  }

  /** Resolves once no settled group is still being dispatched, including any that start while waiting. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight.keys()]);
  }

  /** Chats whose turn is still in flight (content-free: chat ids only). */
  inFlightChatIds(): number[] {
    return [...new Set(this.inFlight.values())];
  }

  private track(chatId: number, work: Promise<unknown>): void {
    const entry: Promise<void> = work.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      this.inFlight.delete(entry);
    });
    this.inFlight.set(entry, chatId);
  }

  addFragment(fragment: IncomingFragment): void {
    const key = groupKey(fragment.chatId, fragment.userId);
    // A late fragment of an album a button click sealed (#39) still joins that album, never anything else.
    const sealed =
      fragment.mediaGroupId === undefined ? undefined : this.sealedAlbums.get(key)?.find((album) => album.mediaGroupId === fragment.mediaGroupId);
    const existing = sealed ?? this.groups.get(key);

    let group: ActiveGroup;
    if (existing && existing.mediaGroupId !== null && fragment.mediaGroupId !== undefined && fragment.mediaGroupId !== existing.mediaGroupId) {
      // Isolation: a different explicit album must never merge into the
      // current one. The current album is definitively over — flush it as
      // it stands and start a brand-new group for this fragment.
      this.dispatchGroup(existing);
      group = this.createGroup(key, fragment);
    } else if (existing) {
      if (existing.fragments.length >= this.maxFragmentsPerGroup) {
        // Bounded lifetime's fragment-count counterpart: never accumulate
        // without limit. Fail the whole group visibly (including the
        // triggering fragment, which is deliberately not split off into its
        // own group — a burst this large is treated as one failed batch,
        // not silently re-chunked) rather than growing further.
        fragment.media?.promise.catch(() => {});
        this.failGroup(
          existing,
          new Error(
            `Забагато повідомлень в одній групі (ліміт ${this.maxFragmentsPerGroup}). Спробуй, будь ласка, надіслати менше повідомлень одразу.`,
          ),
        );
        return;
      }
      this.scheduler.clearTimeout(existing.timer);
      existing.fragments.push(fragment);
      if (existing.mediaGroupId === null && fragment.mediaGroupId !== undefined) {
        existing.mediaGroupId = fragment.mediaGroupId;
      }
      existing.timer = this.scheduler.setTimeout(() => this.dispatchGroup(existing), this.windowFor(existing));
      group = existing;
    } else {
      group = this.createGroup(key, fragment);
    }

    if (fragment.media) {
      // Fail fast: a known-bad attachment (unsupported type, oversized
      // estimate, download error) should not sit silently until the
      // debounce window expires. Attaching this handler immediately also
      // means the (possibly already-rejected) promise always has a handler
      // before this synchronous call returns, so Node never reports it as
      // an unhandled rejection even if the group settles first via its
      // timer.
      fragment.media.promise.catch((error: unknown) => this.failGroup(group, error));
    }
  }

  private windowFor(group: Pick<ActiveGroup, "mediaGroupId">): number {
    return group.mediaGroupId !== null ? this.albumSettleWindowMs : this.adjacentWindowMs;
  }

  /** A new intake, chained after the previous intake of the same chat/user; not buffered, no timer. */
  private newGroup(key: string, fragment: IncomingFragment): ActiveGroup {
    let resolveHandedOff: () => void = () => {};
    const handedOff = new Promise<void>((resolve) => (resolveHandedOff = resolve));
    const tail = this.tails.get(key);
    const group: ActiveGroup = {
      key,
      chatId: fragment.chatId,
      userId: fragment.userId,
      mediaGroupId: fragment.mediaGroupId ?? null,
      fragments: [fragment],
      startedAt: this.scheduler.now(),
      timer: null,
      settled: false,
      prev: tail !== undefined && !tail.handed ? tail : null,
      handed: false,
      handedOff,
      markHandedOff: () => {
        if (group.handed) return;
        group.handed = true;
        if (this.tails.get(key) === group) this.tails.delete(key);
        resolveHandedOff();
      },
    };
    this.tails.set(key, group);
    return group;
  }

  private createGroup(key: string, fragment: IncomingFragment): ActiveGroup {
    const group = this.newGroup(key, fragment);
    group.timer = this.scheduler.setTimeout(() => this.dispatchGroup(group), this.windowFor(group));
    this.groups.set(key, group);
    return group;
  }

  private settle(group: ActiveGroup): boolean {
    if (group.settled) return false;
    group.settled = true;
    this.scheduler.clearTimeout(group.timer);
    if (this.groups.get(group.key) === group) this.groups.delete(group.key);
    const sealed = this.sealedAlbums.get(group.key);
    if (sealed?.includes(group)) {
      const rest = sealed.filter((album) => album !== group);
      if (rest.length > 0) this.sealedAlbums.set(group.key, rest);
      else this.sealedAlbums.delete(group.key);
    }
    return true;
  }

  private failGroup(group: ActiveGroup, error: unknown): void {
    if (!this.settle(group)) return;
    const fail = () => {
      group.markHandedOff();
      return this.onFailure(group.chatId, group.userId, error);
    };
    const prev = group.prev;
    this.track(group.chatId, prev === null || prev.handed ? Promise.resolve(fail()) : prev.handedOff.then(fail));
  }

  private dispatchGroup(group: ActiveGroup): void {
    if (!this.settle(group)) return;
    this.track(group.chatId, this.resolveAndDispatch(group));
  }

  private async resolveAndDispatch(group: ActiveGroup): Promise<void> {
    const sorted = [...group.fragments].sort((a, b) => a.messageId - b.messageId);
    const images: DjonikImageInput[] = [];
    const documents: DjonikDocumentInput[] = [];
    const textFragments: Array<{ order: number; text: string }> = [];
    const parts: DjonikTurnPart[] = [];

    try {
      for (const fragment of sorted) {
        if (fragment.text) textFragments.push({ order: fragment.messageId, text: fragment.text });
        if (fragment.media) {
          if (fragment.media.kind === "image") {
            const image = await fragment.media.promise;
            images.push(image);
            parts.push({ type: "image", image });
          } else {
            const document = await fragment.media.promise;
            documents.push(document);
            parts.push({ type: "document", document });
          }
        }
        // Media part (if any) precedes this fragment's own text part, matching
        // the pre-#27 fixed single-attachment order (image/document block,
        // then its caption) — see the `parts` field doc above.
        if (fragment.text) parts.push({ type: "text", text: fragment.text });
      }
    } catch (error) {
      // A slow attachment can still fail after the window already elapsed
      // and dispatch began (the early `.catch` in `addFragment` only wins
      // the race when the rejection happens *before* the timer fires).
      // `settle()` already ran once for this group, so this is the only
      // place reporting the failure in that ordering — never a duplicate.
      if (group.prev !== null && !group.prev.handed) await group.prev.handedOff;
      group.markHandedOff();
      await this.onFailure(group.chatId, group.userId, error);
      return;
    }

    const reason: GroupingReason =
      group.mediaGroupId !== null ? "media_group_id" : sorted.length > 1 ? "adjacent_window" : "single";

    const intake: GroupedIntake = {
      text: buildCombinedText(textFragments),
      images,
      documents,
      parts,
      fragmentCount: sorted.length,
      textCount: textFragments.length,
      imageCount: images.length,
      documentCount: documents.length,
      groupingReason: reason,
      groupingWaitMs: this.scheduler.now() - group.startedAt,
    };

    // Arrival order (#39): hand off only after the previous intake of this chat/user was handed off.
    // `onDispatch` reaches the Session queue synchronously after that (its first await is the shared
    // `getSession()` promise, whose continuations run in registration order), so FIFO order follows.
    if (group.prev !== null && !group.prev.handed) await group.prev.handedOff;
    group.markHandedOff();
    await this.onDispatch(group.chatId, group.userId, intake);
  }
}
