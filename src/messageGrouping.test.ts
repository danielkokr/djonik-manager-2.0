import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCombinedText,
  buildGroupingTelemetry,
  MessageGroupBuffer,
  type GroupedIntake,
  type IncomingFragment,
  type Scheduler,
} from "./messageGrouping.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small, fast windows for tests — the production defaults are documented in the module itself. Deliberately unequal so a precedence test can distinguish which one applied. */
const ADJACENT_WINDOW_MS = 30;
const ALBUM_SETTLE_WINDOW_MS = 60;

/**
 * A fully deterministic, manually-advanced fake clock/timer, used for the
 * timer-race tests below (#25 Product Lead follow-up, point 3). Unlike the
 * real-timer tests elsewhere in this file (which prove correctness under
 * real wall-clock scheduling), this lets a test fire a group's dispatch
 * timer and add a "simultaneous" fragment in the exact same synchronous
 * step, with no wall-clock flakiness possible.
 */
class FakeScheduler implements Scheduler {
  private currentTime = 0;
  private nextId = 1;
  private tasks: Array<{ id: number; due: number; fn: () => void; cancelled: boolean; fired: boolean }> = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.push({ id, due: this.currentTime + ms, fn, cancelled: false, fired: false });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const task = this.tasks.find((t) => t.id === handle);
    if (task) task.cancelled = true;
  }

  /** Advances the clock and synchronously fires every due, non-cancelled task, in due-time order. */
  advance(ms: number): void {
    this.currentTime += ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && !t.fired && t.due <= this.currentTime)
        .sort((a, b) => a.due - b.due || a.id - b.id);
      if (due.length === 0) return;
      due[0].fired = true;
      due[0].fn();
    }
  }
}

function makeBuffer(overrides: Partial<{
  onDispatch: (chatId: number, userId: number, intake: GroupedIntake) => void;
  onFailure: (chatId: number, userId: number, error: unknown) => void;
  scheduler: Scheduler;
  maxFragmentsPerGroup: number;
}> = {}) {
  const dispatches: Array<{ chatId: number; userId: number; intake: GroupedIntake }> = [];
  const failures: Array<{ chatId: number; userId: number; error: unknown }> = [];
  const buffer = new MessageGroupBuffer({
    adjacentWindowMs: ADJACENT_WINDOW_MS,
    albumSettleWindowMs: ALBUM_SETTLE_WINDOW_MS,
    scheduler: overrides.scheduler,
    maxFragmentsPerGroup: overrides.maxFragmentsPerGroup,
    onDispatch: (chatId, userId, intake) => {
      dispatches.push({ chatId, userId, intake });
      overrides.onDispatch?.(chatId, userId, intake);
    },
    onFailure: (chatId, userId, error) => {
      failures.push({ chatId, userId, error });
      overrides.onFailure?.(chatId, userId, error);
    },
  });
  return { buffer, dispatches, failures };
}

function textFragment(over: Partial<IncomingFragment> & { messageId: number; text: string }): IncomingFragment {
  return { chatId: 1, userId: 100, ...over };
}

// --- buildCombinedText ---

test("buildCombinedText returns a single fragment unwrapped (regression: standalone message unaffected)", () => {
  assert.equal(buildCombinedText([{ order: 1, text: "По Extract треба оновити упаковку" }]), "По Extract треба оновити упаковку");
});

test("buildCombinedText wraps multiple fragments with numbered boundaries, preserving order", () => {
  const combined = buildCombinedText([
    { order: 2, text: "друге" },
    { order: 1, text: "перше" },
  ]);
  assert.equal(combined, "[Fragment 1]\nперше\n\n[Fragment 2]\nдруге");
});

test("buildCombinedText returns empty string for no text fragments", () => {
  assert.equal(buildCombinedText([]), "");
});

// --- buildGroupingTelemetry ---

test("buildGroupingTelemetry contains only bounded metadata fields, never text/media content", () => {
  const intake: GroupedIntake = {
    text: "very secret client content",
    images: [{ data: "secretbytes", mediaType: "image/jpeg", byteSize: 10 }],
    documents: [],
    parts: [],
    fragmentCount: 2,
    textCount: 1,
    imageCount: 1,
    documentCount: 0,
    groupingReason: "adjacent_window",
    groupingWaitMs: 42,
  };
  const telemetry = buildGroupingTelemetry(intake);
  assert.deepEqual(telemetry, {
    groupedFragmentCount: 2,
    groupedTextCount: 1,
    groupedImageCount: 1,
    groupedDocumentCount: 0,
    groupingReason: "adjacent_window",
    groupingWaitMs: 42,
  });
  const serialized = JSON.stringify(telemetry);
  assert.ok(!serialized.includes("secret"), "telemetry must never carry message/attachment content");
});

// --- Scenario 1: two text fragments inside window -> one dispatch, order preserved ---

test("two text fragments inside the window dispatch once with original order preserved", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 10, text: "По Djonik треба оновити onboarding." }));
  buffer.addFragment(textFragment({ messageId: 11, text: "Зроби з цього одну задачу, без дедлайну." }));

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(
    dispatches[0].intake.text,
    "[Fragment 1]\nПо Djonik треба оновити onboarding.\n\n[Fragment 2]\nЗроби з цього одну задачу, без дедлайну.",
  );
  assert.equal(dispatches[0].intake.groupingReason, "adjacent_window");
  assert.equal(dispatches[0].intake.fragmentCount, 2);
  assert.equal(dispatches[0].intake.textCount, 2);
  // #27 Scenario A: ordered parts preserve each fragment's own boundary as a
  // separate text block, unlabeled and in original order — no merging/rewriting.
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "text", text: "По Djonik треба оновити onboarding." },
    { type: "text", text: "Зроби з цього одну задачу, без дедлайну." },
  ]);
});

// --- Scenario 2: text + image -> one intake, actual image block included ---

test("text followed by an image dispatches once with both text and the resolved image block", async () => {
  const { buffer, dispatches } = makeBuffer();
  const image = { data: "aW1hZ2U=", mediaType: "image/jpeg", byteSize: 123 };

  buffer.addFragment(textFragment({ messageId: 20, text: "ось референс" }));
  buffer.addFragment(
    textFragment({ messageId: 21, text: "", media: { kind: "image", promise: Promise.resolve(image) } }),
  );

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].intake.text, "ось референс");
  assert.deepEqual(dispatches[0].intake.images, [image]);
  assert.equal(dispatches[0].intake.imageCount, 1);
  // #27: text fragment, then the image fragment (no caption of its own) — order preserved.
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "text", text: "ось референс" },
    { type: "image", image },
  ]);
});

// --- Scenario 3: text + PDF -> one intake, actual document block included ---

test("text followed by a PDF dispatches once with both text and the resolved document block", async () => {
  const { buffer, dispatches } = makeBuffer();
  const document = { data: "cGRm", mediaType: "application/pdf", byteSize: 456, filename: "brief.pdf" };

  buffer.addFragment(textFragment({ messageId: 30, text: "деталі проєкту тут" }));
  buffer.addFragment(
    textFragment({ messageId: 31, text: "", media: { kind: "document", promise: Promise.resolve(document) } }),
  );

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].intake.text, "деталі проєкту тут");
  assert.deepEqual(dispatches[0].intake.documents, [document]);
  assert.equal(dispatches[0].intake.documentCount, 1);
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "text", text: "деталі проєкту тут" },
    { type: "document", document },
  ]);
});

// --- Scenario 4: media_group_id with 2+ items -> grouped explicitly, one dispatch, order preserved ---

test("fragments sharing a media_group_id are grouped explicitly with order preserved", async () => {
  const { buffer, dispatches } = makeBuffer();
  const imageA = { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 };
  const imageB = { data: "Qg==", mediaType: "image/jpeg", byteSize: 2 };

  buffer.addFragment(
    textFragment({ messageId: 41, text: "", mediaGroupId: "album_1", media: { kind: "image", promise: Promise.resolve(imageB) } }),
  );
  buffer.addFragment(
    textFragment({ messageId: 40, text: "", mediaGroupId: "album_1", media: { kind: "image", promise: Promise.resolve(imageA) } }),
  );

  await sleep(ALBUM_SETTLE_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].intake.groupingReason, "media_group_id");
  assert.deepEqual(dispatches[0].intake.images, [imageA, imageB], "message_id order preserved regardless of arrival order");
  // #27 Scenario E: native album ordering carried into `parts` too, by message_id, not arrival order.
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "image", image: imageA },
    { type: "image", image: imageB },
  ]);
});

test("a different media_group_id never merges into an already-locked album — it flushes and starts a new group", async () => {
  const { buffer, dispatches } = makeBuffer();
  const imageA = { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 };
  const imageB = { data: "Qg==", mediaType: "image/jpeg", byteSize: 2 };

  buffer.addFragment(
    textFragment({ messageId: 50, mediaGroupId: "album_1", text: "", media: { kind: "image", promise: Promise.resolve(imageA) } }),
  );
  // Arrives immediately (before album_1's settle window elapses) with a *different* media_group_id.
  buffer.addFragment(
    textFragment({ messageId: 60, mediaGroupId: "album_2", text: "", media: { kind: "image", promise: Promise.resolve(imageB) } }),
  );

  await sleep(ALBUM_SETTLE_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2, "two separate albums must never be merged into one intake");
  const reasons = dispatches.map((d) => d.intake.groupingReason);
  assert.deepEqual(reasons, ["media_group_id", "media_group_id"]);
});

// --- Scenario 5 & 6: isolation across chats/users ---

test("two different chats are never grouped, even with identical timing", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "hello from chat 1" });
  buffer.addFragment({ chatId: 2, userId: 100, messageId: 1, text: "hello from chat 2" });

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2);
  const byChat = new Map(dispatches.map((d) => [d.chatId, d.intake.text]));
  assert.equal(byChat.get(1), "hello from chat 1");
  assert.equal(byChat.get(2), "hello from chat 2");
});

test("two different users in the same chat are never grouped", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "user A" });
  buffer.addFragment({ chatId: 1, userId: 200, messageId: 1, text: "user B" });

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2);
  const byUser = new Map(dispatches.map((d) => [d.userId, d.intake.text]));
  assert.equal(byUser.get(100), "user A");
  assert.equal(byUser.get(200), "user B");
});

// --- Scenario 7: outside the grouping window -> separate dispatches ---

test("a fragment arriving after the window expired starts a new, separate dispatch", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "перше" }));
  await sleep(ADJACENT_WINDOW_MS + 40);
  buffer.addFragment(textFragment({ messageId: 2, text: "друге, вже пізно" }));
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].intake.text, "перше");
  assert.equal(dispatches[1].intake.text, "друге, вже пізно");
  assert.equal(dispatches[0].intake.groupingReason, "single");
  assert.equal(dispatches[1].intake.groupingReason, "single");
});

// --- Scenario 8: completed group removed from buffer ---

test("a completed group is removed from the buffer immediately after dispatch", async () => {
  const { buffer } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "single" }));
  assert.equal(buffer.hasActiveGroup(1, 100), true, "group is active while buffering");

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(buffer.hasActiveGroup(1, 100), false, "group is cleared once dispatched");
});

// --- Scenario 9: attachment validation/download failure -> no partial Agent call, zero mutation ---

test("a failing attachment fails the whole grouped intake — onDispatch is never called", async () => {
  const { buffer, dispatches, failures } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "ось референс" }));
  buffer.addFragment(
    textFragment({
      messageId: 2,
      text: "",
      media: { kind: "image", promise: Promise.reject(new Error("file too large")) },
    }),
  );

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 0, "onDispatch (the only path to session.send/Trello) must never fire");
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].error), /file too large/);
});

test("a synchronously-known-bad attachment (already-rejected promise) fails fast, before the window elapses", async () => {
  const { buffer, dispatches, failures } = makeBuffer();
  const start = Date.now();

  buffer.addFragment(
    textFragment({
      messageId: 1,
      text: "",
      media: { kind: "image", promise: Promise.reject(new Error("unsupported format")) },
    }),
  );

  // Poll briefly rather than sleeping the full window, to prove failure is fast.
  for (let i = 0; i < 10 && failures.length === 0; i += 1) await sleep(5);

  assert.equal(failures.length, 1);
  assert.ok(Date.now() - start < ADJACENT_WINDOW_MS, "failure must not wait for the debounce window");
  assert.equal(dispatches.length, 0);
});

// --- Scenario 10: no duplicate Agent dispatch after grouping ---

test("a group is settled (dispatched or failed) at most once even under a forced isolation flush", async () => {
  const { buffer, dispatches, failures } = makeBuffer();
  const imageA = { data: "QQ==", mediaType: "image/jpeg", byteSize: 1 };
  const imageB = { data: "Qg==", mediaType: "image/jpeg", byteSize: 2 };

  buffer.addFragment(
    textFragment({ messageId: 1, mediaGroupId: "album_1", text: "", media: { kind: "image", promise: Promise.resolve(imageA) } }),
  );
  buffer.addFragment(
    textFragment({ messageId: 2, mediaGroupId: "album_2", text: "", media: { kind: "image", promise: Promise.resolve(imageB) } }),
  );

  await sleep(ALBUM_SETTLE_WINDOW_MS + 40);

  assert.equal(dispatches.length + failures.length, 2, "exactly one settlement per group, no duplicates");
});

// --- Scenario 11 (regression-shaped): normal standalone text message ---

test("a standalone text message with no follow-up dispatches exactly once, unwrapped", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "Привіт!" }));
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].intake.text, "Привіт!");
  assert.equal(dispatches[0].intake.groupingReason, "single");
  assert.equal(dispatches[0].intake.images.length, 0);
  assert.equal(dispatches[0].intake.documents.length, 0);
  // #27 regression: standalone text produces exactly one plain text part.
  assert.deepEqual(dispatches[0].intake.parts, [{ type: "text", text: "Привіт!" }]);
});

// --- #27: ordered parts preserve cross-modal order and caption/attachment relationship ---

test("Scenario B: text -> image -> correcting text keeps that exact order in parts", async () => {
  const { buffer, dispatches } = makeBuffer();
  const image = { data: "aW1n", mediaType: "image/png", byteSize: 10 };

  buffer.addFragment(textFragment({ messageId: 1, text: "Зроби два варіанти" }));
  buffer.addFragment(
    textFragment({ messageId: 2, text: "", media: { kind: "image", promise: Promise.resolve(image) } }),
  );
  buffer.addFragment(textFragment({ messageId: 3, text: "Корекція: залиш тільки один варіант" }));

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "text", text: "Зроби два варіанти" },
    { type: "image", image },
    { type: "text", text: "Корекція: залиш тільки один варіант" },
  ]);
});

test("Scenario C: a caption arriving with its image stays adjacent to that image, image block first", async () => {
  const { buffer, dispatches } = makeBuffer();
  const image = { data: "aW1n", mediaType: "image/jpeg", byteSize: 5 };

  buffer.addFragment(
    textFragment({
      messageId: 1,
      text: "тільки мобільна версія",
      media: { kind: "image", promise: Promise.resolve(image) },
    }),
  );

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "image", image },
    { type: "text", text: "тільки мобільна версія" },
  ]);
});

test("Scenario D: text -> PDF -> correcting text keeps that exact order in parts", async () => {
  const { buffer, dispatches } = makeBuffer();
  const document = { data: "cGRm", mediaType: "application/pdf", byteSize: 20, filename: "brief.pdf" };

  buffer.addFragment(textFragment({ messageId: 1, text: "ось бриф" }));
  buffer.addFragment(
    textFragment({ messageId: 2, text: "", media: { kind: "document", promise: Promise.resolve(document) } }),
  );
  buffer.addFragment(textFragment({ messageId: 3, text: "Корекція: дедлайну немає" }));

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "text", text: "ось бриф" },
    { type: "document", document },
    { type: "text", text: "Корекція: дедлайну немає" },
  ]);
});

test("Scenario G (mixed): image + PDF + text together preserve message_id order across kinds", async () => {
  const { buffer, dispatches } = makeBuffer();
  const image = { data: "aW1n", mediaType: "image/png", byteSize: 1 };
  const document = { data: "cGRm", mediaType: "application/pdf", byteSize: 2, filename: "spec.pdf" };

  buffer.addFragment(
    textFragment({ messageId: 1, text: "", media: { kind: "image", promise: Promise.resolve(image) } }),
  );
  buffer.addFragment(
    textFragment({ messageId: 2, text: "", media: { kind: "document", promise: Promise.resolve(document) } }),
  );
  buffer.addFragment(textFragment({ messageId: 3, text: "Зроби це для Extract" }));

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].intake.parts, [
    { type: "image", image },
    { type: "document", document },
    { type: "text", text: "Зроби це для Extract" },
  ]);
});

test("parts never carry chatId/userId/messageId/mediaGroupId — only text/image/document content", async () => {
  const { buffer, dispatches } = makeBuffer();
  const image = { data: "aW1n", mediaType: "image/jpeg", byteSize: 1 };

  buffer.addFragment(
    textFragment({
      messageId: 99,
      mediaGroupId: "album_secret",
      text: "caption",
      media: { kind: "image", promise: Promise.resolve(image) },
    }),
  );

  await sleep(ALBUM_SETTLE_WINDOW_MS + 40);

  const serialized = JSON.stringify(dispatches[0].intake.parts);
  assert.ok(!serialized.includes("album_secret"), "media_group_id must never leak into a content part");
  assert.ok(!serialized.includes("99"), "message_id must never leak into a content part");
  assert.ok(!serialized.includes("chatId") && !serialized.includes("userId"));
});

// --- Concurrency: two groups active in different chats settle independently ---

test("two chats' groups run independently — failure in one does not affect the other", async () => {
  const { buffer, dispatches, failures } = makeBuffer();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "ok chat" });
  buffer.addFragment({
    chatId: 2,
    userId: 100,
    messageId: 1,
    text: "",
    media: { kind: "document", promise: Promise.reject(new Error("download failed")) },
  });

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].chatId, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].chatId, 2);
});

// --- Concurrency: timer fires while the "next" fragment arrives ---

test("a fragment arriving just after the timer fired starts a fresh group rather than joining the dispatched one", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "перший" }));
  await sleep(ADJACENT_WINDOW_MS + 5); // let the timer fire and settle the group
  buffer.addFragment(textFragment({ messageId: 2, text: "другий" }));
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].intake.fragmentCount, 1);
  assert.equal(dispatches[1].intake.fragmentCount, 1);
});

// --- Product Lead follow-up point 2: grouping precedence (explicit media_group_id > adjacent timing heuristic) ---

test("precedence: a fragment starting a new group with an explicit media_group_id uses the album settle window, not the shorter adjacent window", () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });

  buffer.addFragment(textFragment({ messageId: 1, mediaGroupId: "album_1", text: "альбом" }));

  scheduler.advance(ADJACENT_WINDOW_MS); // shorter window elapses first
  assert.equal(dispatches.length, 0, "an album-locked group must NOT dispatch on the shorter adjacent window");

  scheduler.advance(ALBUM_SETTLE_WINDOW_MS - ADJACENT_WINDOW_MS);
  assert.equal(dispatches.length, 1, "dispatches once the (longer) album settle window fully elapses");
  assert.equal(dispatches[0].intake.groupingReason, "media_group_id");
});

test("precedence: an album fragment for one user never merges into a different user's concurrently-open adjacent-window group in the same chat", async () => {
  const { buffer, dispatches } = makeBuffer();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "user A plain text, no album" });
  buffer.addFragment({
    chatId: 1,
    userId: 200,
    messageId: 1,
    mediaGroupId: "album_x",
    text: "",
    media: { kind: "image", promise: Promise.resolve({ data: "QQ==", mediaType: "image/jpeg", byteSize: 1 }) },
  });

  await sleep(ALBUM_SETTLE_WINDOW_MS + 40);

  assert.equal(dispatches.length, 2, "the album fragment must never be absorbed into the other user's group");
  const byUser = new Map(dispatches.map((d) => [d.userId, d.intake]));
  assert.equal(byUser.get(100)!.groupingReason, "single");
  assert.equal(byUser.get(100)!.imageCount, 0);
  assert.equal(byUser.get(200)!.groupingReason, "media_group_id");
  assert.equal(byUser.get(200)!.imageCount, 1);
});

// --- Product Lead follow-up point 3: deterministic timer-race coverage (fake scheduler, no wall-clock flakiness) ---

test("deterministic timer race: a fragment arriving exactly when the timer becomes due is never lost, never double-dispatched, and never merged into the group that just settled", () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });

  buffer.addFragment(textFragment({ messageId: 1, text: "перший" }));
  // Advancing to exactly the due time synchronously fires the dispatch timer.
  scheduler.advance(ADJACENT_WINDOW_MS);
  // "Simultaneous" arrival: added immediately after the timer fired, in the same synchronous test step.
  buffer.addFragment(textFragment({ messageId: 2, text: "другий" }));

  assert.equal(dispatches.length, 1, "the first group dispatched exactly once at its due time");
  assert.equal(dispatches[0].intake.fragmentCount, 1);
  assert.equal(dispatches[0].intake.text, "перший", "first fragment not lost");

  scheduler.advance(ADJACENT_WINDOW_MS);
  assert.equal(dispatches.length, 2, "the second (not-lost) fragment dispatches on its own, separate timer");
  assert.equal(dispatches[1].intake.fragmentCount, 1);
  assert.equal(dispatches[1].intake.text, "другий");
});

test("deterministic timer race: a forced isolation flush clears the old group's timer — no stale duplicate dispatch when its original due time is later reached", () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });

  buffer.addFragment(textFragment({ messageId: 1, mediaGroupId: "album_A", text: "album A caption" }));
  // A conflicting album arrives well before album A's settle window elapses -> forces an immediate flush of A.
  scheduler.advance(5);
  buffer.addFragment(textFragment({ messageId: 2, mediaGroupId: "album_B", text: "album B caption" }));

  assert.equal(dispatches.length, 1, "the conflicting fragment forces an immediate flush of the old group");
  assert.equal(dispatches[0].intake.text, "album A caption");

  // Advance to just before album A's ORIGINAL due time (t=0+ALBUM_SETTLE_WINDOW_MS). Had its timer
  // not been cleared by the forced flush's `settle()`, this is close to when a stale second dispatch
  // would fire. Current time is t=5 (from the advance(5) above); go to t=ALBUM_SETTLE_WINDOW_MS-1.
  scheduler.advance(ALBUM_SETTLE_WINDOW_MS - 5 - 1);
  assert.equal(dispatches.length, 1, "no dispatch yet — neither A's stale timer nor B's own timer is due");

  // Advance exactly to album A's original due time (t=ALBUM_SETTLE_WINDOW_MS). A's timer was cleared
  // by `settle()`, so this must NOT produce a stale duplicate dispatch of A.
  scheduler.advance(1);
  assert.equal(dispatches.length, 1, "no stale duplicate dispatch of the already-flushed group A");

  // Advance to album B's own due time (t=5+ALBUM_SETTLE_WINDOW_MS).
  scheduler.advance(5);
  assert.equal(dispatches.length, 2, "exactly one further dispatch, for B's own timer");
  assert.equal(dispatches[1].intake.text, "album B caption");
});

// --- Product Lead follow-up point 4: concurrent group isolation (explicit, beyond the existing chat-isolation test) ---

test("two simultaneous groups for different users progress independently — one user's failure never affects the other's dispatch", async () => {
  const { buffer, dispatches, failures } = makeBuffer();

  buffer.addFragment({ chatId: 1, userId: 100, messageId: 1, text: "user A: ok" });
  buffer.addFragment({
    chatId: 1,
    userId: 200,
    messageId: 1,
    text: "",
    media: { kind: "image", promise: Promise.reject(new Error("unsupported format")) },
  });

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].userId, 100);
  assert.equal(dispatches[0].intake.text, "user A: ok");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].userId, 200);
});

// --- Product Lead follow-up point 5: failure cleanup — clean new group after a prior failure ---

test("after a grouped-attachment failure, the buffer entry is removed and a later message from the same chat/user starts a clean new group", async () => {
  const { buffer, dispatches, failures } = makeBuffer();

  buffer.addFragment(textFragment({ messageId: 1, text: "текст" }));
  buffer.addFragment(
    textFragment({ messageId: 2, text: "", media: { kind: "image", promise: Promise.reject(new Error("too large")) } }),
  );
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(buffer.hasActiveGroup(1, 100), false, "the failed group is removed from the buffer");

  // A brand-new, unrelated message from the same chat/user, sent afterward.
  buffer.addFragment(textFragment({ messageId: 3, text: "новий чистий запит" }));
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1, "the later message dispatches cleanly, unaffected by the earlier failure");
  assert.equal(dispatches[0].intake.text, "новий чистий запит");
  assert.equal(dispatches[0].intake.fragmentCount, 1);
  assert.equal(failures.length, 1, "no new failure recorded for the clean follow-up message");
});

// --- Product Lead follow-up point 8: bounded fragment count per group ---

test("a group exceeding the configured fragment-count ceiling fails visibly instead of accumulating without limit", async () => {
  const { buffer, dispatches, failures } = makeBuffer({ maxFragmentsPerGroup: 3 });

  buffer.addFragment(textFragment({ messageId: 1, text: "1" }));
  buffer.addFragment(textFragment({ messageId: 2, text: "2" }));
  buffer.addFragment(textFragment({ messageId: 3, text: "3" }));
  // 4th fragment exceeds the ceiling of 3.
  buffer.addFragment(textFragment({ messageId: 4, text: "4" }));

  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 0, "a group that exceeded the ceiling must never dispatch (onDispatch never called)");
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].error), /ліміт/);
  assert.equal(buffer.hasActiveGroup(1, 100), false, "the over-limit group is removed, not left accumulating");
});

test("a fresh group after an over-limit failure is unaffected and dispatches normally", async () => {
  const { buffer, dispatches, failures } = makeBuffer({ maxFragmentsPerGroup: 2 });

  buffer.addFragment(textFragment({ messageId: 1, text: "1" }));
  buffer.addFragment(textFragment({ messageId: 2, text: "2" }));
  buffer.addFragment(textFragment({ messageId: 3, text: "3 (over limit)" }));
  await sleep(ADJACENT_WINDOW_MS + 40);
  assert.equal(failures.length, 1);
  assert.equal(dispatches.length, 0);

  buffer.addFragment(textFragment({ messageId: 4, text: "clean follow-up" }));
  await sleep(ADJACENT_WINDOW_MS + 40);

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].intake.text, "clean follow-up");
});

// --- Graceful shutdown support (#33) ---

test("flushAll dispatches every still-buffering group immediately instead of dropping it", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  buffer.addFragment(textFragment({ chatId: 1, messageId: 1, text: "перше" }));
  buffer.addFragment(textFragment({ chatId: 1, messageId: 2, text: "друге" }));
  buffer.addFragment(textFragment({ chatId: 2, userId: 200, messageId: 3, text: "інший чат" }));
  buffer.flushAll();
  await buffer.whenIdle();
  assert.equal(dispatches.length, 2, "one turn per chat group, nothing lost");
  assert.equal(dispatches[0].intake.fragmentCount, 2);
  assert.equal(buffer.hasActiveGroup(1, 100), false);
  scheduler.advance(10_000);
  assert.equal(dispatches.length, 2, "a flushed group's timer never dispatches it a second time");
});

test("whenIdle waits for in-flight turns (including their reply) and reports their chats meanwhile", async () => {
  const scheduler = new FakeScheduler();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const buffer = new MessageGroupBuffer({
    scheduler,
    onDispatch: async () => {
      await held;
    },
    onFailure: () => {},
  });
  buffer.addFragment(textFragment({ chatId: 7, messageId: 1, text: "довгий turn" }));
  scheduler.advance(10_000);
  await flushMicrotasks();
  assert.deepEqual(buffer.inFlightChatIds(), [7]);
  let idle = false;
  const waiting = buffer.whenIdle().then(() => (idle = true));
  await flushMicrotasks();
  assert.equal(idle, false, "still in flight");
  release();
  await waiting;
  assert.deepEqual(buffer.inFlightChatIds(), []);
});

test("a failing dispatch still settles whenIdle (drain can never hang on a rejected turn)", async () => {
  const scheduler = new FakeScheduler();
  const buffer = new MessageGroupBuffer({
    scheduler,
    onDispatch: async () => {
      throw new Error("boom");
    },
    onFailure: () => {},
  });
  buffer.addFragment(textFragment({ messageId: 1, text: "x" }));
  buffer.flushAll();
  await buffer.whenIdle();
  assert.deepEqual(buffer.inFlightChatIds(), []);
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- #39: a Working Rhythm button click enters after pending input, without splitting an album ---------------

const image = (label: string): IncomingFragment["media"] => ({
  kind: "image",
  promise: Promise.resolve({ data: label, mediaType: "image/jpeg", byteSize: label.length }),
});

test("#39 album + click: an active album stays ONE intake; the click becomes the following intake", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  buffer.addFragment(textFragment({ messageId: 10, mediaGroupId: "alb", text: "Референси до Limen", media: image("p1") }));
  buffer.addFragment(textFragment({ messageId: 11, mediaGroupId: "alb", text: "", media: image("p2") }));
  // Daniel taps an old button (bot message id 5 < 10) while the album is still arriving.
  buffer.enqueueAfterPending(textFragment({ messageId: 5, text: "Так, приймаю цей план (план тижня від пн 28.09)." }));
  // The rest of the album arrives after the click and still joins its own album.
  buffer.addFragment(textFragment({ messageId: 12, mediaGroupId: "alb", text: "", media: image("p3") }));
  await sleep(0);
  assert.equal(dispatches.length, 0, "the click waits; the album is not flushed early");
  scheduler.advance(ALBUM_SETTLE_WINDOW_MS);
  await sleep(0);
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].intake.groupingReason, "media_group_id");
  assert.equal(dispatches[0].intake.imageCount, 3, "complete album, one intake");
  assert.equal(dispatches[0].intake.text, "Референси до Limen");
  assert.deepEqual(dispatches[1].intake.parts, [{ type: "text", text: "Так, приймаю цей план (план тижня від пн 28.09)." }]);
  assert.equal(dispatches[1].intake.fragmentCount, 1, "the click never merges with anything");
});

test("#39 click after typed text: the text group closes as it stands and goes first; nothing typed later jumps ahead of the click", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  buffer.addFragment(textFragment({ messageId: 20, text: "Тільки Limen прибери." }));
  buffer.enqueueAfterPending(textFragment({ messageId: 7, text: "CLICK" }));
  buffer.addFragment(textFragment({ messageId: 21, text: "і ще одне" }));
  await sleep(0);
  scheduler.advance(ADJACENT_WINDOW_MS);
  await sleep(0);
  assert.deepEqual(
    dispatches.map((d) => d.intake.text),
    ["Тільки Limen прибери.", "CLICK", "і ще одне"],
  );
});

test("#39 hand-off order: a later intake never overtakes an earlier one still resolving an attachment", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  let release: () => void = () => {};
  const slow = new Promise<{ data: string; mediaType: string; byteSize: number }>((resolve) => (release = () => resolve({ data: "x", mediaType: "image/jpeg", byteSize: 1 })));
  buffer.addFragment(textFragment({ messageId: 30, text: "скрін", media: { kind: "image", promise: slow } }));
  scheduler.advance(ADJACENT_WINDOW_MS); // settled, still downloading
  buffer.enqueueAfterPending(textFragment({ messageId: 8, text: "CLICK" }));
  await sleep(0);
  assert.equal(dispatches.length, 0, "the click waits for the earlier intake's hand-off");
  release();
  await sleep(0);
  assert.deepEqual(dispatches.map((d) => d.intake.text), ["скрін", "CLICK"]);
});

test("#39 click with nothing pending dispatches at once; other chats are never affected", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  buffer.addFragment(textFragment({ chatId: 2, userId: 200, messageId: 40, mediaGroupId: "other", text: "", media: image("o") }));
  buffer.enqueueAfterPending(textFragment({ messageId: 9, text: "CLICK" }));
  await sleep(0);
  assert.deepEqual(dispatches.map((d) => d.intake.text), ["CLICK"]);
  assert.equal(buffer.hasActiveGroup(2, 200), true, "another chat's album keeps buffering");
});

test("#39 shutdown flush includes an album sealed by a click; clearAll releases waiting intakes", async () => {
  const scheduler = new FakeScheduler();
  const { buffer, dispatches } = makeBuffer({ scheduler });
  buffer.addFragment(textFragment({ messageId: 50, mediaGroupId: "alb2", text: "a", media: image("a") }));
  buffer.enqueueAfterPending(textFragment({ messageId: 6, text: "CLICK" }));
  assert.equal(buffer.hasActiveGroup(1, 100), true);
  buffer.flushAll();
  await buffer.whenIdle();
  assert.deepEqual(dispatches.map((d) => d.intake.text), ["a", "CLICK"]);

  const second = makeBuffer({ scheduler: new FakeScheduler() });
  second.buffer.addFragment(textFragment({ messageId: 60, mediaGroupId: "alb3", text: "b", media: image("b") }));
  second.buffer.enqueueAfterPending(textFragment({ messageId: 6, text: "CLICK" }));
  second.buffer.clearAll();
  await second.buffer.whenIdle();
  assert.deepEqual(second.dispatches.map((d) => d.intake.text), ["CLICK"], "a discarded album never blocks the click forever");
});
