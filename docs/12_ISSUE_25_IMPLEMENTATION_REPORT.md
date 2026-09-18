# Issue #25 implementation report — Wave B3: group related Telegram messages into one coherent intake

> **Scope:** Issue #25. Discovery, implementation, and local automated tests only. No commit, push, deploy, roadmap edit, or issue close was performed. **No paid Managed Agent session and no live Trello mutation were run this turn** (explicitly out of scope per the task).
>
> **§24 addendum (Product Lead review follow-up):** a second pass adding deterministic evidence for 10 specific review points, plus one genuine implementation gap found and fixed (an unbounded per-group fragment count — see §24.8). Nothing else in §1–§23 below needed correction; the addendum only adds tests, one small bounded fix, and a structural refactor for testability (see §24's own summary). Still no paid Managed Agent session, no live Trello mutation, no commit/push/deploy.

## 1. Summary

Implemented a deterministic, in-memory grouping layer between Telegram updates and Djonik Managed Agent turns. Related fragments sent close together — adjacent text messages, a text+screenshot pair, a text+PDF pair, or a Telegram media-group album — are now buffered by a small `MessageGroupBuffer` (`src/messageGrouping.ts`) and dispatched as exactly one `session.send()` call, preserving arrival order. An unrelated fragment (different chat, different user, outside the window, or a different explicit `media_group_id`) is never merged. Any attachment failure (unsupported type, oversized, download error) fails the *whole* grouped intake visibly and never reaches `session.send`, so it can never produce a Trello mutation. The existing #22 (image) and #24 (PDF) download/transport functions are reused unchanged; the only transport-level change is a small, backward-compatible generalization of `DjonikSessionHandle.send()` to accept either a single attachment or an array of attachments, needed to send a multi-image album as one native `user.message` event. 133/133 local tests pass (109 pre-existing + 24 new), `npm run typecheck` is clean, `git diff --check` is clean.

## 2. grammY / Telegram discovery

Inspected the installed runtime before writing any code, per the issue's explicit "do not assume timing semantics" instruction:

- **Installed grammY version:** `1.46.0` (`node_modules/grammy/package.json`), plus `@grammyjs/types` for the Telegram Bot API type surface. No `@grammyjs/media-group`, `@grammyjs/runner`, or any other batching/album plugin is installed — `grep -r "media_group" node_modules/grammy/out` found nothing in the core package. **Conclusion: no native media-group/batching mechanism exists in this repo's dependency set.** A custom bounded buffer was required, exactly as the issue anticipated as the likely outcome.
- **Telegram fields confirmed present** in `node_modules/@grammyjs/types/message.d.ts`: `message_id: number`, `from?: User`, `date: number`, `chat: Chat`, `reply_to_message?: ReplyMessage`, `caption?: string`, `media_group_id?: string` (all on the base `Message` shape). `photo`/`document` were already in use by the existing #22/#24 code.
- **Handler ordering/concurrency:** read `node_modules/grammy/out/bot.js`. `Bot.handleUpdates` runs a plain `for` loop that `await`s `handleUpdate` for each update **sequentially, one at a time** (comment in the source literally says "handle updates sequentially (!)"). This has a direct architectural consequence: if a handler `await`s a slow call (e.g. the previous, pre-#25 code awaited `session.send()` — a multi-second Managed Agent turn per `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md`) before returning, grammY will **not even start processing the next update** until that `await` resolves. Two fragments sent by the user milliseconds apart would previously be handled one *whole Managed Agent turn* apart, not as fragments of the same intake. The grouping implementation fixes this as a side effect: every Telegram handler now returns almost immediately (`buffer.addFragment(...)` is synchronous/fire-and-forget), so grammY's sequential loop advances to the next update right away while the actual Djonik turn happens later, off of grammY's own await chain, when the buffer's debounce timer fires.
- **Current `telegramCli.ts` handling (pre-#25):** `message:text` called `session.send(ctx.message.text)` directly; `message:photo` and an image-shaped `message:document` called a shared `handleImageTurn` (`ctx.api.getFile` → `downloadTelegramImage` → `session.send(caption, image)`); a PDF-shaped `message:document` called `handleDocumentFileTurn` (`ctx.api.getFile` → `downloadTelegramDocument` → `session.send(caption, undefined, document)`). Every handler sent its own turn immediately and independently — the exact behavior #25 needed to change.
- **`DjonikSession.send(...)` multi-attachment support (pre-#25):** confirmed by reading `src/djonikClient.ts` that `send(text, image?, document?)` accepted at most **one** `DjonikImageInput` and **one** `DjonikDocumentInput` per turn — a single content block of each type. The underlying `SendableContentBlock[]`/`user.message` construction already supported an arbitrary flat array of content blocks (that's how image+document+text already combined in #24); only the public function signature was bounded to one-of-each. See §12.

## 3. Chosen grouping model

Per the issue's required priority order:

1. **Explicit `media_group_id`** — highest priority. Fragments sharing the same chat, same user, and same `media_group_id` always belong together, regardless of timing, up to the album-settle window.
2. **Deterministic same-chat/user adjacent-window grouping** — used only when no explicit relation exists. Any fragment (text or media) is merged into an already-open group for the same `chat:user` key while that group's debounce window has not yet elapsed.
3. **Otherwise independent message** — a fragment with no active group and no explicit relation starts (and, absent a follow-up, later dispatches as) a group of one.

No content/semantic classification is used anywhere — grouping decisions are based only on `chat.id`, `from.id`, `media_group_id`, arrival timing, and `message_id` ordering.

## 4. Exact coalescing window and rationale

Two separate, bounded windows (`src/messageGrouping.ts`):

- `DEFAULT_ADJACENT_WINDOW_MS = 1200` — debounce window for fragments with no explicit `media_group_id`. Every new fragment for the same `chat:user` key resets this timer; the group dispatches once 1.2s pass with no new fragment.
- `DEFAULT_ALBUM_SETTLE_WINDOW_MS = 1500` — used once a group is locked to an explicit `media_group_id` (a Telegram album). Slightly longer than the adjacent window because album parts are delivered as separate consecutive Bot API updates and a too-short settle window risks splitting one album into two intakes, which the issue explicitly disallows.

**Rationale and an explicit limitation:** these are principled, bounded defaults, not measured values — the task explicitly prohibits live Telegram/Managed Agent validation this turn, so no real album-delivery timing or real user typing-cadence data was available to tune against. The chosen magnitude is deliberately small relative to the multi-second, multi-iteration Managed Agent turn latency already documented in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` (observed turns took several seconds end-to-end), so an added ~1.2–1.5s of debounce is a modest fraction of total perceived latency, not a "sluggish" wait. **These window values should be revisited after live traffic is authorized** (see §22).

## 5. Group key / isolation rules

The buffer's map key is always `${chatId}:${userId}` (`groupKey` in `src/messageGrouping.ts`) — structurally, a different chat or a different user can never share a group; there is no code path that looks across keys. This was chosen over any smarter/heuristic isolation because it is the simplest mechanism that satisfies the requirement exactly, with no risk of accidental cross-isolation logic drifting later.

For an explicit `media_group_id`, the *group itself* additionally carries a `mediaGroupId: string | null` field. Once set (locked to one album), a fragment arriving with a **different** `media_group_id` is never merged in: the existing group is flushed (dispatched) immediately as-is, and the new fragment starts a fresh group. A fragment with **no** `media_group_id` can still join an already-locked album group (e.g. a plain follow-up caption/text after the last album photo) — it does not itself claim a conflicting relation.

## 6. `media_group_id` behavior

Album fragments are collected under `groupKey(chat, user)`, sorted by `messageId` ascending at dispatch time regardless of arrival order (Telegram does not guarantee delivery order for album parts), and dispatched as one turn once `ALBUM_SETTLE_WINDOW_MS` elapses with no new item for that album. `groupingReason` is reported as `"media_group_id"` for these dispatches. Verified by test: *"fragments sharing a media_group_id are grouped explicitly with order preserved"* and *"a different media_group_id never merges into an already-locked album — it flushes and starts a new group"*.

## 7. Adjacent-window behavior

A fragment with no `media_group_id` joins the currently open group for its `chat:user` key (if one exists and hasn't dispatched yet) and resets that group's timer to `ADJACENT_WINDOW_MS`. This covers every example in the issue: text→screenshot, text→PDF, short text→short text, and short text→short text→image, without any semantic check on the fragments' content. Verified by tests covering two-text-fragment grouping, text+image, and text+PDF.

## 8. Buffer lifecycle

`MessageGroupBuffer` (`src/messageGrouping.ts`) is the entire buffering mechanism:

- **No persistence, no DB** — a plain in-process `Map<string, ActiveGroup>`.
- **Bounded lifetime** — a group exists only from its first fragment until its debounce/settle timer fires, or until it fails.
- **Bounded fragment count** — implicitly bounded by the debounce window itself (nothing can be added to a group once it has settled); there is no separate hard cap on fragment count, which was judged unnecessary at this scope (a human cannot realistically send enough fragments inside a ~1.2–1.5s window to matter) — see §22 for this as an explicit, deliberately deferred limitation.
- **Completed group removed immediately after dispatch** — `settle()` deletes the map entry synchronously, before the (possibly slow) `onDispatch`/Managed Agent call even starts.
- **Failed group removed after error handling** — the same `settle()` path is used for both outcomes.
- **No leak if fragments stop arriving** — every group's only handle to the future is its own `setTimeout`, which always fires (dispatch or, if a fragment's attachment later rejects, failure) and always removes the group from the map. Process shutdown (`SIGINT`/`SIGTERM` in `telegramCli.ts`) calls `buffer.clearAll()`, which cancels any still-pending timers so the process can exit cleanly (see §13 for what this means for in-flight fragments at shutdown).

## 9. Concurrency behavior

Node/grammY are single-threaded, so every state transition in `MessageGroupBuffer` (`addFragment`, `dispatchGroup`, `failGroup`, the internal `settle()`) runs to completion before any other callback can run — no locks were needed. Each concurrency case named in the issue was inspected and covered by a test:

- **Timer fires while the next fragment arrives** — once a group's timer fires, `settle()` deletes it from the map synchronously; a fragment arriving any time after that (even microseconds later) finds no existing group and starts a brand-new one. Test: *"a fragment arriving just after the timer fired starts a fresh group rather than joining the dispatched one"*.
- **Two groups active in different chats** — fully isolated by the `chat:user` map key; independent timers, independent failure/dispatch outcomes. Test: *"two chats' groups run independently — failure in one does not affect the other"*.
- **Media-group fragments arriving nearly simultaneously** — each `addFragment` call is a single synchronous state transition (push fragment, reset timer); order at dispatch time is decided by `message_id`, not arrival order, so near-simultaneous arrival cannot produce out-of-order or duplicate state. Test: *"fragments sharing a media_group_id are grouped explicitly with order preserved"* (arrival order deliberately reversed in the test).
- **Group failure while another group remains active** — a failed group's `settle()`/`onFailure` never touches any other key's map entry. Covered by the same *"two chats' groups run independently"* test.
- **No duplicate settlement of one group** — `settle()` is idempotent (`if (group.settled) return false`), so a fragment's attachment promise rejecting both via the immediate `.catch` (attached in `addFragment`) and via the `await` inside `resolveAndDispatch` can never fire `onDispatch`/`onFailure` twice for the same group; whichever runs first wins, the other is a no-op. Test: *"a group is settled (dispatched or failed) at most once even under a forced isolation flush"*.

## 10. Text ordering representation

`buildCombinedText` (`src/messageGrouping.ts`) sorts text-bearing fragments (standalone text messages and media captions alike) by `message_id`, then:

- **0 fragments:** `""`.
- **1 fragment:** returned completely unwrapped — this is what keeps a standalone message byte-for-byte identical to pre-#25 behavior (regression requirement).
- **2+ fragments:** `[Fragment 1]\n{text}\n\n[Fragment 2]\n{text}...`, numbered by position, never summarized or rewritten — Djonik receives the user's original words.

## 11. Image/PDF reuse

No second parallel transport implementation was written. `telegramCli.ts`'s new `resolveImageMedia`/`resolveDocumentMedia` helpers call exactly the same `ctx.api.getFile` → `downloadTelegramImage`/`downloadTelegramDocument` functions from `src/telegramAdapter.ts` that the accepted #22/#24 code already used — only the surrounding orchestration (buffer instead of an immediate `session.send`) changed. The download itself starts the instant a photo/document update arrives (not deferred until the group dispatches), so download time and buffering time overlap rather than stack.

## 12. Managed Agent input changes, if any

`DjonikSessionHandle.send()` in `src/djonikClient.ts` was generalized, in a small and backward-compatible way, from:

```ts
send(text: string, image?: DjonikImageInput, document?: DjonikDocumentInput): Promise<string>
```

to:

```ts
send(
  text: string,
  image?: DjonikImageInput | DjonikImageInput[],
  document?: DjonikDocumentInput | DjonikDocumentInput[],
): Promise<string>
```

Internally, both parameters are normalized to arrays (`Array.isArray(image) ? image : [image]`) and one `image`/`document` content block is pushed per array entry, in array order, before the trailing `text` block — the exact same `SendableContentBlock[]`/`user.message` shape #22/#24 already established, just repeated per attachment. This is the "small input-type generalization... bounded and provider-native" the issue anticipated: multiple `image`/`document` blocks in one `user.message` event were already a valid native shape (that's how a single image + single document already combined in #24), so no new Managed Agent capability, transport, or Files API step was introduced.

**Backward compatibility:** every existing call site that passes a single `DjonikImageInput`/`DjonikDocumentInput` object (all pre-#25 tests, `src/cli.ts`) is unaffected — a bare object still satisfies `T | T[]` and is wrapped into a one-element array internally, producing byte-for-byte the same content block as before. This is verified directly by the new test *"a single image/document object still works exactly as before the array generalization (regression)"*.

**Per-turn telemetry note:** `DjonikTurnTelemetry`'s existing `hasImage`/`imageMimeType`/`imageByteSize` and `hasFile`/`fileMimeType`/`fileByteSize`/`fileNamePresent` fields were deliberately **not** renamed or restructured to a count/array shape — they now record the *first* image/document of a multi-attachment turn (documented in a code comment). This was a deliberate scope decision: renaming that schema would touch already-accepted, well-tested telemetry consumed nowhere else in the repo (confirmed `reconcileTelemetry.ts` does not read any of these fields), for no product requirement in this issue. The issue's own requested grouping telemetry (`groupedImageCount`, `groupedDocumentCount`, etc.) is emitted separately at the adapter layer instead — see §14.

## 13. Failure/fail-closed behavior

Every attachment-bearing fragment's download/validation promise is started immediately on arrival (`resolveImageMedia`/`resolveDocumentMedia` in `telegramCli.ts`, or an already-rejected `Promise.reject(...)` for a synchronously-known-bad case: unsupported MIME type, or an oversized file caught by the existing `exceedsDocumentSizeEstimate` early check). `MessageGroupBuffer.addFragment` attaches a `.catch` to that promise immediately, so:

- A synchronously-known failure (bad MIME type, oversized estimate) fails the group **fast**, without waiting for the debounce window — verified by test *"a synchronously-known-bad attachment (already-rejected promise) fails fast, before the window elapses"*.
- A failure discovered only during dispatch (e.g. a download that was still in flight when the window elapsed) is caught by `resolveAndDispatch`'s own `try`/`catch` around the `await` loop, with the same outcome.
- In both cases, `onFailure` fires and `onDispatch` — the **only** code path that calls `session.send` and therefore the only path that can ever reach a Trello write — is never called for that group. This is a structural guarantee, not a behavioral convention: there is no code path in `telegramCli.ts` that calls `session.send` outside `groupBuffer`'s `onDispatch` callback.
- The whole group (any already-successful fragments included) is discarded together — no partial request is ever sent. The user sees one visible error (`formatGroupFailureError`, worded distinctly from an ordinary single-turn failure) instead of a misleadingly incomplete grouped turn.

Verified end-to-end by test *"a failing attachment fails the whole grouped intake — onDispatch is never called"* (a good text fragment plus a failing image fragment together produce zero dispatches and exactly one failure).

## 14. Telemetry changes

Content-free, opt-in (same `DJONIK_TURN_TELEMETRY=1` gate as the existing per-turn telemetry), emitted from `telegramCli.ts`'s `onDispatch` right before `session.send`:

```json
{"groupedFragmentCount":2,"groupedTextCount":1,"groupedImageCount":1,"groupedDocumentCount":0,"groupingReason":"adjacent_window","groupingWaitMs":1187}
```

Built by the pure, independently-testable `buildGroupingTelemetry(intake)` in `src/messageGrouping.ts` — exactly the fields the issue requested (`groupedFragmentCount`, `groupedTextCount`, `groupedImageCount`, `groupedDocumentCount`, `groupingReason`, `groupingWaitMs`), nothing else. It reads only the `GroupedIntake`'s counters and the `groupingReason`/`groupingWaitMs` fields — it never touches `intake.text`, `intake.images`, or `intake.documents`. Verified by test *"buildGroupingTelemetry contains only bounded metadata fields, never text/media content"*, which builds an intake carrying deliberately identifiable "secret" text/image content and asserts the serialized telemetry string does not contain it.

## 15. Files changed

- `src/messageGrouping.ts` **(new)** — `MessageGroupBuffer`, `buildCombinedText`, `buildGroupingTelemetry`, and their supporting types (`IncomingFragment`, `GroupedIntake`, `GroupingTelemetry`, `GroupingReason`). Framework-agnostic (no grammY import), so it is unit-testable without a live bot.
- `src/messageGrouping.test.ts` **(new)** — 19 focused tests (see §16).
- `src/djonikClient.ts` — `DjonikSessionHandle.send()` and the `send()` implementation generalized to accept `DjonikImageInput | DjonikImageInput[]` and `DjonikDocumentInput | DjonikDocumentInput[]`; content-block construction loops over the normalized arrays; telemetry recording documented as first-of-array.
- `src/djonikClient.test.ts` — 4 new tests for the array generalization (multi-image, mixed image+document, single-object regression, multi-image telemetry).
- `src/telegramAdapter.ts` — added `formatGroupFailureError`, distinct wording from `formatUserFacingError` for a whole-group failure.
- `src/telegramAdapter.test.ts` — 1 new test for `formatGroupFailureError`.
- `src/telegramCli.ts` — rewritten to route `message:text`/`message:photo`/`message:document` through a shared `MessageGroupBuffer` instead of calling `session.send` directly per update; `handleImageTurn`/`handleDocumentFileTurn` replaced by promise-returning `resolveImageMedia`/`resolveDocumentMedia` reusing the same #22/#24 download functions; added the buffer's `onDispatch`/`onFailure` wiring and `buffer.clearAll()` on shutdown.

## 16. Tests added

24 new tests across three files (full list of the issue's 15 required scenarios plus concurrency cases, mapped below):

**`src/messageGrouping.test.ts`** (19 tests):
1. Two text fragments inside window → one dispatch, order preserved.
2. Text + image → one intake, actual image block included.
3. Text + PDF → one intake, actual document block included.
4. `media_group_id` with 2+ items → grouped explicitly, one dispatch, order preserved (plus a second test for the conflicting-`media_group_id` isolation case).
5. Two different chats → never grouped.
6. Two different users → never grouped.
7. Outside grouping window → separate dispatches.
8. Completed group → removed from buffer.
9. Attachment validation/download failure → no partial Agent call, zero mutation (plus a fast-failure variant for synchronously-known-bad attachments).
10. No duplicate Agent dispatch after grouping (plus a forced-isolation-flush variant).
11. Normal standalone text message regression.
15. Telemetry contains metadata only, no user content (`buildGroupingTelemetry`).
- Concurrency: timer-fires-while-next-fragment-arrives; two chats' groups run independently under failure.
- `buildCombinedText`: single fragment unwrapped, multi-fragment numbered/ordered, empty input.

**`src/djonikClient.test.ts`** (4 tests): multi-image array → one block per image in order; mixed images+document; single-object call still produces identical output (regression, covers items 12/13's underlying transport); multi-image telemetry records the first image.

**`src/telegramAdapter.test.ts`** (1 test): `formatGroupFailureError` wording.

Items 12 ("standalone image regression"), 13 ("standalone PDF regression"), and 14 ("#23 deterministic due-date regression") are covered by the **109 pre-existing tests**, all of which still pass unmodified (see §17) — the array generalization is additive and the grouping buffer's single-fragment path (`groupingReason: "single"`) produces the same `session.send(text, image)`/`session.send(text, undefined, document)` shape those tests already assert on.

## 17. Regression results

All 109 pre-existing tests pass unchanged, with no test file's existing assertions modified — confirmed by running the full suite before and after the new code was added. Combined with the 24 new tests: **133/133 pass**.

## 18. `npm run typecheck`

```
> djonik-manager@0.1.0 typecheck
> tsc --noEmit
```

Clean, no errors.

## 19. `npm test`

```
ℹ tests 133
ℹ suites 0
ℹ pass 133
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## 20. `git diff --check`

Clean — two informational CRLF-normalization warnings only (`src/djonikClient.ts`, `src/telegramCli.ts`; a pre-existing repo line-ending setting, not a whitespace error), no actual whitespace-error findings, exit code 0.

## 21. `git status --short`

```
 M src/djonikClient.test.ts
 M src/djonikClient.ts
 M src/telegramAdapter.test.ts
 M src/telegramAdapter.ts
 M src/telegramCli.ts
?? src/messageGrouping.test.ts
?? src/messageGrouping.ts
```

## 22. Limitations / deferred items

- **Coalescing windows are unvalidated defaults, not measured values.** `ADJACENT_WINDOW_MS`/`ALBUM_SETTLE_WINDOW_MS` (§4) were chosen from documented Telegram/grammY behavior and the existing token-cost audit's turn-latency data, not from live traffic — this implementation turn explicitly excluded live Telegram/Managed Agent validation. These should be revisited once live validation is authorized.
- **No hard fragment-count cap per group.** A group's size is bounded only by how many fragments a user can physically send inside the debounce window; an explicit ceiling was judged unnecessary at this scope and was not added, to keep the change bounded per the issue's architecture constraints. Worth reconsidering only if real usage shows abuse or an unusually large album.
- **`buffer.clearAll()` on process shutdown silently drops any still-buffering group** (no fragments lost from Telegram's perspective — they were delivered — but a group mid-debounce at the exact moment of `SIGINT`/`SIGTERM` is discarded rather than flushed). This matches the existing pre-#25 behavior of `djonikSession.closeIfOpen()` (no in-flight-turn draining either) and was not extended, since adding shutdown-time flush semantics was outside this issue's bounded scope.
- **Content ordering across mixed types is "images, then documents, then text"** (matching the pre-existing #22/#24 content-block order), not a fully general interleaved reconstruction of Telegram's exact arrival order across types. Order *within* each type (image-to-image, document-to-document) and the *text* fragment ordering are both preserved by `message_id`; only the relative position of an image block versus a document block versus the text block follows the established fixed pattern rather than true fine-grained interleaving. This was a deliberate, bounded choice to avoid a larger rewrite of `djonikClient.ts`'s content-block assembly for a case with no concrete acceptance scenario requiring finer interleaving.
- **No Skill changes.** Nothing in `.claude/skills/` was touched — the grouping behavior lives entirely in adapter code, per the issue's "modify Skills only if implementation evidence proves it strictly necessary," which it did not.
- **No Agent system-prompt changes.**

## 23. No paid Managed Session or live Trello mutation was run

Explicitly confirmed: this implementation turn made no call to the real Djonik Managed Agent and no call to the real Trello MCP server. All 133 tests run against fully local fakes/fixtures (`createFakeClient` in `djonikClient.test.ts`, direct in-process `MessageGroupBuffer` construction with synthetic fragments in `messageGrouping.test.ts`). Live validation (Scenarios A–G from the issue) is deferred to a separate, explicitly authorized validation pass, per the task's guardrail instructions and `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §27.

## 24. Product Lead review follow-up — evidence for 10 specific points

Still no paid Managed Agent session, no live Trello mutation, no commit/push/deploy, no roadmap/issue edit this pass. Summary of what changed: one genuine gap fixed (§24.8, unbounded fragment count), one testability seam added with zero behavior change (an injectable `Scheduler` in `MessageGroupBuffer`, defaulting to real `setTimeout`/`Date.now`), one small refactor with zero behavior change (`telegramCli.ts`'s inline dispatch closures extracted into `src/telegramDispatch.ts` so they're callable from a test without a live grammY `Bot`), and 24 new tests. Everything else in §1–§23 was re-verified, not changed.

### 24.1 Coalescing window — exact values and standalone-message bound

Exact configured durations (`src/messageGrouping.ts`):

- **Adjacent-fragment window:** `DEFAULT_ADJACENT_WINDOW_MS = 1200` (1.2s).
- **`media_group_id` settle window (separate):** `DEFAULT_ALBUM_SETTLE_WINDOW_MS = 1500` (1.5s).

**Why, from the actual runtime behavior discovered in §2:** grammY 1.46.0's `Bot.handleUpdates` processes updates strictly sequentially (`node_modules/grammy/out/bot.js`, a plain `for` loop `await`ing each `handleUpdate` in turn — the source literally comments "handle updates sequentially (!)"). Before #25, a handler that `await`ed `session.send()` directly blocked the *next* Telegram update from even being dequeued until that multi-second Managed Agent turn finished (turn latency evidenced in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md`: several seconds, multiple model iterations, $0.02–$0.11 per turn). Both windows are chosen to be a small fraction of that already-accepted per-turn latency, so the *added* wait is not perceptually "sluggish" relative to what the user already waits for a reply. The album window is deliberately 300ms longer than the adjacent window because Telegram delivers album parts as separate consecutive Bot API updates, and a too-short settle window risks the buffer treating a still-arriving album as already complete, splitting one album into two intakes — which the issue explicitly disallows. **Both remain unvalidated defaults, not measured values** (§4/§22 already flagged this; live Telegram traffic is out of scope for this and this follow-up pass).

**Standalone message bound — confirmed structurally, not just by test.** A group dispatches exactly `windowFor(group)` after its *last* fragment arrives (`addFragment`/`createGroup` in `src/messageGrouping.ts`); for a group of one fragment, "last" and "first" are the same arrival, so total added delay is **exactly one window duration, never more**: `ADJACENT_WINDOW_MS` (1.2s) for an ordinary standalone text/photo/document with no `media_group_id`, or `ALBUM_SETTLE_WINDOW_MS` (1.5s) only in the (structurally impossible for a genuinely standalone message) case of it carrying an explicit `media_group_id`. There is no unbounded/open-ended wait anywhere in `MessageGroupBuffer` — every code path that starts a group also starts exactly one timer for it, and that timer is the only thing that can extend a group's lifetime. Test evidence: *"a standalone text message with no follow-up dispatches exactly once, unwrapped"* (`src/messageGrouping.test.ts`) dispatches after `ADJACENT_WINDOW_MS`, not later.

### 24.2 Grouping precedence — explicit `media_group_id` > adjacent timing heuristic

**Confirmed, with new deterministic tests added** (`src/messageGrouping.test.ts`):

- *"precedence: a fragment starting a new group with an explicit `media_group_id` uses the album settle window, not the shorter adjacent window"* — a fake-scheduler test that advances exactly to the shorter `ADJACENT_WINDOW_MS` and asserts **zero** dispatches (proving the album-locked group ignored the shorter, heuristic-only window), then advances to the full `ALBUM_SETTLE_WINDOW_MS` and asserts exactly one dispatch with `groupingReason: "media_group_id"`. This is the direct proof that an explicit relation overrides the default timing heuristic, not just an indirect inference from outcome.
- *"precedence: an album fragment for one user never merges into a different user's concurrently-open adjacent-window group in the same chat"* (new) — the literal scenario named in the review ("an album fragment must never accidentally merge into an unrelated adjacent-window group"): a plain adjacent-window group is open for user 100 when user 200's album fragment arrives in the same chat at the same instant; asserts two separate dispatches, the album one correctly tagged `media_group_id` and carrying its image, the plain one untouched (`imageCount: 0`).
- Already-existing coverage re-verified: *"a different media_group_id never merges into an already-locked album — it flushes and starts a new group"* — a *second*, conflicting album can never be swept into a first one.

One clarification on intended behavior, not a defect: a fragment carrying **no** `media_group_id` (e.g. a plain caption/text) *is* allowed to join an already-open, not-yet-locked adjacent-window group, and a fragment that **does** carry a `media_group_id` *is* allowed to upgrade/lock an already-open unlocked group to that album (this is the deliberate "text → screenshot"/"text → album" combination the issue's own examples require — see §7). What is never allowed, and is what "must never accidentally merge" actually protects against, is two *different* explicit relations (two distinct `media_group_id` values, or an album vs. a different user's/chat's group) being merged into one — and that is exactly what the tests above and in §9 prove.

### 24.3 Timer race — deterministic fake-timer evidence

A real gap in test rigor (not in behavior) was found here: the pre-existing timer-adjacent tests used real wall-clock `sleep`s, which prove correctness under real scheduling but cannot pin down an exact "fires while a fragment arrives in the same instant" ordering deterministically. Added a small `FakeScheduler` (`src/messageGrouping.test.ts`, implements the new `Scheduler` interface) that lets a test advance a manually-controlled clock and have due timers fire **synchronously**, so a "simultaneous" fragment can be added in the exact same synchronous step as the timer firing, with zero flakiness possible. `MessageGroupBuffer` now takes an optional `scheduler` constructor option (defaults to real `setTimeout`/`clearTimeout`/`Date.now` — **zero behavior change in production**, confirmed by the full pre-existing suite still passing unchanged).

Two new deterministic tests, both in `src/messageGrouping.test.ts`:

- *"deterministic timer race: a fragment arriving exactly when the timer becomes due is never lost, never double-dispatched, and never merged into the group that just settled"* — advances the clock to exactly the first group's due time (firing its dispatch synchronously), adds a second fragment in that same synchronous step, and proves: the first group dispatched exactly once with exactly its own fragment (not lost, not double-counted); the second fragment was not silently dropped (it dispatches on its own on the next window); no merge occurred between the two.
- *"deterministic timer race: a forced isolation flush clears the old group's timer — no stale duplicate dispatch when its original due time is later reached"* — proves the "stale timer dispatch after buffer replacement" case explicitly: group A is force-flushed (isolation branch) before its own timer would have fired; the clock is then advanced to exactly A's *original* due time and it is asserted that **no** stale second dispatch of A occurs (its timer was `clearTimeout`'d inside `settle()`), then advanced to group B's own (later) due time and exactly one further dispatch occurs, for B.

Together these rule out all four race outcomes named in the review: double dispatch, lost fragment, a fragment dispatched separately right after the group settled (proven not-lost, arrives as its own clean next group instead), and stale-timer dispatch after replacement.

### 24.4 Concurrent group isolation

Already covered pre-follow-up by *"two chats' groups run independently — failure in one does not affect the other"*. Added one more explicit case per the review's literal "different chats/**users**" wording: *"two simultaneous groups for different users progress independently — one user's failure never affects the other's dispatch"* (`src/messageGrouping.test.ts`) — two users in the *same* chat, one group fails (bad attachment), the other still dispatches normally with its own content intact. Isolation is structural (the `Map` key is always `chat:user`; see §5), so this is a confirmation test, not a fix.

### 24.5 Failure cleanup

- **`session.send()` never called:** structural, not just tested — in `telegramCli.ts`, `session.send` is only ever reachable through `createGroupDispatchHandlers`'s `onDispatch` (`src/telegramDispatch.ts`), and `MessageGroupBuffer` never calls `onDispatch` for a group that failed (`resolveAndDispatch`'s `catch` calls `onFailure` and `return`s before reaching the `onDispatch` call). Proven at both levels: unit (*"a failing attachment fails the whole grouped intake — onDispatch is never called"*) and integration (*"integration: a failed grouped attachment never calls session.send (structural zero-mutation guarantee)"*, `src/telegramDispatch.test.ts`, asserting the fake session's `calls` array stays empty).
- **No partial group submitted:** same tests — the good text fragment that was buffered alongside the failing attachment is discarded together with it; `onDispatch`/`session.send` never fires with just the text.
- **Failed buffer entry removed:** `settle()` deletes the group from the map before either `onDispatch` or `onFailure` is even invoked (§9/§24.3's race tests exercise this too). Directly asserted via `buffer.hasActiveGroup(chatId, userId) === false` immediately after a failure in the new test below.
- **A later new message from the same chat/user starts a clean new group (previously not directly tested — added now):** *"after a grouped-attachment failure, the buffer entry is removed and a later message from the same chat/user starts a clean new group"* (`src/messageGrouping.test.ts`) — after a failure, asserts `hasActiveGroup` is false, then sends an unrelated follow-up message from the same chat/user and asserts it dispatches normally, with the earlier failure's content nowhere in it and no new spurious failure recorded.

### 24.6 One-dispatch guarantee — integration level

Previously this was proven only at the `MessageGroupBuffer` unit level (`onDispatch` call count). Per the review, added `src/telegramDispatch.test.ts` — wires the *actual* production glue (`MessageGroupBuffer` + `createGroupDispatchHandlers`, the exact same two pieces `telegramCli.ts`'s `main()` constructs) against a fake `DjonikSessionHandle`/`DjonikSessionManager` and a fake `sendMessage`, with no grammY `Bot`/`Context` and no network. This is the smallest seam that reaches "one call into the Managed Agent session" without spinning up a live bot: `telegramCli.ts` itself was refactored (extraction only, no logic change) so this glue is an importable, side-effect-free function (`createGroupDispatchHandlers`) instead of an inline closure inside `main()`, which previously ran `bot.start()` unconditionally on import and could not be unit-tested at all.

Five integration tests, all asserting the fake session's recorded `send()` call count:

- *"integration: two grouped text fragments produce exactly one Managed Agent session.send call"* (text + text).
- *"integration: text + image produces exactly one Managed Agent session.send call carrying both"*.
- *"integration: text + PDF produces exactly one Managed Agent session.send call carrying both"*.
- *"integration: a media_group_id album (3 items) produces exactly one Managed Agent session.send call"*.
- *"integration: a failed grouped attachment never calls session.send (structural zero-mutation guarantee)"* (the failure-side counterpart, cited again in §24.5).

All five pass with exactly one `send()` call (or zero, for the failure case) recorded.

### 24.7 Ordering

**Confirmed deterministic by Telegram `message_id`, not callback/arrival order.** `resolveAndDispatch` in `src/messageGrouping.ts` explicitly sorts before building the intake: `const sorted = [...group.fragments].sort((a, b) => a.messageId - b.messageId)` — this is independent of the order fragments were pushed into `group.fragments` (i.e., independent of arrival/callback order). Directly tested by *"fragments sharing a media_group_id are grouped explicitly with order preserved"*, which deliberately adds the higher-`messageId` fragment **first** and asserts the output is still in ascending `messageId` order.

**Why sorting by `message_id` (rather than relying on arrival order) is still necessary even after the grammY sequential-processing refactor:** grammY's sequential `handleUpdate` loop (§2/§24.1) guarantees updates are *handed to their handlers* in Telegram's delivery order, and each handler's `addFragment` call itself is synchronous. But it does **not** guarantee that Telegram *delivers* updates — especially the several separate messages that make up one album — in strict ascending `message_id` order over the wire; Telegram's own docs do not promise that for `media_group_id` parts, and network/queueing jitter on Telegram's side is outside grammY's control. Relying on arrival order alone would silently reorder an album under exactly that jitter. Sorting by `message_id` at dispatch time is therefore not redundant with the sequential-processing fix — the two solve different problems (sequential processing fixes *when* a fragment is buffered/handled; `message_id` sorting fixes *what order* fragments appear in the final combined intake). No additional sorting beyond this single `message_id` sort was added — deliberately, since anything more (e.g. re-sorting by wall-clock arrival time) risks reordering genuinely valid updates against Telegram's own numbering.

### 24.8 Buffer bounds — genuine gap found and fixed

**Before this follow-up, there was no fragment-count bound** — a group's `fragments` array could grow without limit for as long as fragments kept arriving inside a (repeatedly-reset) debounce window. This was a real, if narrow, gap: a pathological burst of many rapid messages could accumulate indefinitely before any window elapsed. Fixed:

- **Maximum fragments per group:** `DEFAULT_MAX_FRAGMENTS_PER_GROUP = 20` (`src/messageGrouping.ts`), overridable via `MessageGroupBufferOptions.maxFragmentsPerGroup`. Chosen as a generous margin over any realistic Telegram album (Telegram caps albums at 10 items) or plausible short-text burst. When a fragment would push a group past this ceiling, the **whole group fails visibly** (`onFailure`, Ukrainian message naming the limit) rather than continuing to accumulate — the triggering (overflow) fragment is deliberately discarded with the rest of the group rather than silently starting a second, split group, matching the review's "fail visibly rather than allowing unbounded accumulation" instruction literally. No persistence was added; this is a pure in-memory counter check.
- **Maximum in-memory lifetime:** unchanged from §8/§9 — a group lives only from its first fragment until its debounce/settle timer fires or it fails, both of which unconditionally remove it from the `Map`. There is no separate lifetime cap beyond "at most one window duration past the last fragment," since every code path that keeps a group alive also holds exactly one active timer for it.

Two new tests (`src/messageGrouping.test.ts`): *"a group exceeding the configured fragment-count ceiling fails visibly instead of accumulating without limit"* (asserts zero dispatches, one failure, and the group removed from the buffer) and *"a fresh group after an over-limit failure is unaffected and dispatches normally"* (proves the ceiling failure doesn't poison subsequent traffic from the same chat/user, mirroring §24.5's clean-recovery guarantee).

### 24.9 Input shape regression — already covered, re-verified

All six shapes the review asked to confirm are exercised by the existing suite (§16/§17, re-run clean this pass):

| Shape | Test |
|---|---|
| Zero media | Every plain `session.send(text)` call across `djonikClient.test.ts` (e.g. the Trello write/verify tests) — `images`/`documents` normalize to empty arrays, only a `text` block is sent. |
| Single image | *"send with an image constructs a user.message with an image block before the text block"* (#22 regression, unchanged). |
| Single PDF | *"send with a document constructs a user.message with a document block before the text block"* (#24 regression, unchanged). |
| Multiple images | *"send accepts an array of images and constructs one content block per image, in array order"*. |
| Image + PDF | *"send accepts a mixed grouped intake: multiple images and a document together"* — asserts content-block type order `["image", "document", "text"]`. |
| Multiple text fragments, original order | `buildCombinedText` tests (*"wraps multiple fragments with numbered boundaries, preserving order"*, deliberately fed out-of-order input) plus the integration-level *"two grouped text fragments produce exactly one Managed Agent session.send call"*. |

Backward compatibility with #22/#24 is additionally proven by *"a single image/document object still works exactly as before the array generalization (regression)"*, which asserts the exact same content-block output a pre-#25 single-object call produced.

### 24.10 Files changed in this follow-up

- `src/messageGrouping.ts` — added the `Scheduler` interface/`REAL_SCHEDULER` default (test seam, no behavior change), `DEFAULT_MAX_FRAGMENTS_PER_GROUP` and the fragment-count ceiling check in `addFragment` (§24.8, the one real fix), and threaded `scheduler`/`maxFragmentsPerGroup` through `MessageGroupBufferOptions`/the class.
- `src/messageGrouping.test.ts` — added `FakeScheduler`, widened `ALBUM_SETTLE_WINDOW_MS` to differ from `ADJACENT_WINDOW_MS` (60ms vs 30ms) so precedence tests can distinguish which window applied, and 8 new tests (§24.2, §24.3 ×2, §24.4, §24.5, §24.8 ×2).
- `src/telegramDispatch.ts` **(new)** — `createGroupDispatchHandlers`, extracted verbatim (no logic change) from `telegramCli.ts`'s previously-inline `onDispatch`/`onFailure` closures, so the integration-level dispatch path is testable without a live bot.
- `src/telegramDispatch.test.ts` **(new)** — 5 integration-level tests (§24.6).
- `src/telegramCli.ts` — `main()` now calls `createGroupDispatchHandlers` instead of constructing the closures inline; behavior unchanged (confirmed by the full pre-existing suite passing unmodified).
- `docs/12_ISSUE_25_IMPLEMENTATION_REPORT.md` — this §24 addendum.

### 24.11 Test/check results

`npm run typecheck`: clean, no errors. `npm test`: **146/146 pass** (133 from the original pass + 8 new `messageGrouping.test.ts` tests + 5 new `telegramDispatch.test.ts` tests). `git diff --check`: clean (only pre-existing CRLF-normalization informational warnings, no whitespace errors). No paid Managed Agent session, no live Trello mutation, no commit/push/deploy, no roadmap/issue edit.

## 25. Live validation blocker — concurrent Managed Session sends

> **Scope of this section:** discovered during the first authorized bounded live-acceptance validation pass for #25 (Product Owner guardrail: max $0.50 / 5 paid Sessions / 1 safe Trello test mutation). Live validation was paused after Scenario A; this section documents the defect found, the fix applied, and its tests. No commit/push/deploy, no roadmap/issue edit, no further paid Managed Agent session or Trello mutation was run while producing this section.

### 25.1 What was observed live

Scenario A asked for two short text fragments sent close together. The two Telegram messages actually arrived **1–2 seconds apart** (confirmed with the Product Owner) — outside the 1200ms adjacent-fragment window — so `MessageGroupBuffer` correctly treated them as two independent singleton groups rather than merging them. That part was correct behavior, not a bug.

The real defect was in what happened next. Exact telemetry from the live run:

```
[group] {"groupedFragmentCount":1,...,"groupingReason":"single","groupingWaitMs":1209}
[group] {"groupedFragmentCount":1,...,"groupingReason":"single","groupingWaitMs":1215}
[turn]  {...one single turn-telemetry record, five minutes later, nothing more...}
```

Both groups' debounce timers fired only **~6ms apart** (`1215 - 1209`), and each independently called `onDispatch → DjonikSessionHandle.send()` on the **same** Managed Session. Only one `[turn]` telemetry record was ever observed in over five minutes of waiting, even though `turnTelemetry.summary()`/`onTurnTelemetry` fires unconditionally from a `finally` block — meaning the second `send()` call's turn was not completing cleanly. Live validation was paused at this point rather than proceeding to Scenario B–G or the Scenario E Trello mutation, per the reliability invariant against wrong-target/false-success mutations (`docs/00_DJONIK_PRODUCT_CONTRACT.md` §10).

### 25.2 Root cause

`connectToDjonik` (`src/djonikClient.ts`) opens exactly **one** Managed Session event-stream iterator and closes over a set of **per-turn mutable variables** shared by every call to `send()`: `turnTelemetry`, `pendingWriteTool`, `pendingWriteObjectId`, `pendingWriteDue`, `dueOutcomeForTurn`, `unverifiedTrelloWrite`, and `mcpToolCallsById`. `send()` resets these at its start and reads/writes them throughout `runTurn`'s event loop, on the assumption that only one `send()` call is ever in flight at a time.

Before #25, that assumption held structurally: grammY processes Telegram updates strictly sequentially, and every pre-#25 handler `await`ed the full `session.send()` call before returning, so grammY's own sequential loop serialized turns as a side effect. #25 deliberately made handlers fire-and-forget (`buffer.addFragment(...)` is synchronous) so Telegram ingestion would never block on a slow Managed Agent turn — but nothing was added to serialize the `send()` calls that `MessageGroupBuffer`'s own independent per-group timers can trigger. Two different groups (different chat/user keys, or the same key reused after settlement, as in the live incident) can have their debounce timers fire within milliseconds of each other, and both `onDispatch` callbacks call `session.send()` without waiting for one another.

This is an **architecture/reliability blocker**, not a cosmetic bug: concurrent `send()` calls on one handle race on the shared closure state and on the single event-stream `iterator.next()` calls, which can corrupt telemetry attribution, the same-card write-verification state machine, and the #23 deterministic due-date finalization — and, most seriously, risks a Trello write's verification being satisfied (or falsely denied) by an unrelated concurrent turn's read, which is exactly the "mutation of the wrong target" / "false success claim" class of defect the product contract treats as unacceptable.

### 25.3 Chosen fix

A minimal in-process FIFO queue directly in front of the existing, unchanged turn logic, at the `DjonikSessionHandle` boundary (`src/djonikClient.ts`) — not in `telegramDispatch.ts` or `MessageGroupBuffer`, per the Product Lead decision, since the unsafe shared state and the single event iterator live inside the session handle and must protect every current and future caller of it, not only Telegram.

- The original `send()` implementation was renamed to a private `sendSerial()`, completely unchanged.
- A new public `send()` wraps it: `const result = queueTail.then(() => sendSerial(...), () => sendSerial(...)); queueTail = result.then(() => undefined, () => undefined); return result;`
- Each call's `sendSerial` only starts once every previously queued call's promise has fully settled (resolved **or** rejected) — the `.then(ok, onRejected)` pairing on `queueTail` means a failed turn still lets the next one run.
- `queueTail` itself is derived with a swallowing `.then(() => undefined, () => undefined)` specifically so the chain itself is never a rejected promise — an ordinary turn failure or a `DjonikSessionDeadError` never permanently blocks the queue.
- No new Managed Session is created because turns overlap; there is exactly one session/handle, exactly one queue in front of it.
- Telegram ingestion (`MessageGroupBuffer`) is completely unaffected: it still fires `onDispatch` as soon as a group settles, with zero blocking. The queue is invisible to callers except for ordering.

### 25.4 Queue failure semantics

- **FIFO, always.** Call order is call order, not settlement-time order — the queue is built by chaining on `queueTail` synchronously inside `send()`, before any `await`.
- **A failed turn does not poison the queue.** Verified by Scenario B: turn 1 fails (`no text reply`), turn 2 still runs and succeeds.
- **`DjonikSessionDeadError` stays correctly typed** and does not corrupt verification/telemetry state for the turn that hit it (Scenario C). The already-queued next turn on that same handle is **not** skipped and is **not** auto-reconnected by `DjonikSessionHandle` — it still runs against the same now-dead stream and independently fails the same way. Reconnection remains `DjonikSessionManager`'s responsibility (`src/telegramAdapter.ts`'s `createSessionManager`/`handleSessionError`, unchanged), per the explicit instruction not to invent reconnection inside the handle.
- **`close()` is unaffected** — it aborts the stream controller directly; any turn still queued behind an aborted stream fails through the same existing `DjonikSessionDeadError`/stream-ended path as before, now simply also queued rather than potentially concurrent.

### 25.5 Files changed

- `src/djonikClient.ts` — `send` renamed to `sendSerial` (body byte-for-byte unchanged); new public `send()` added as a small FIFO queue wrapper (`queueTail`); no change to `DjonikSessionHandle`'s public type signature.
- `src/djonikClient.test.ts` — added `createStreamedFakeClient` (a controllable, `push`-driven fake event stream, needed because the existing `createFakeClient` resolves every event immediately and therefore cannot expose a race) and `flushMicrotasks`; added 7 new tests (Scenarios A–F, with an inverse-order E variant).
- `src/telegramDispatch.test.ts` — added one integration-level regression test reproducing the exact live incident (two independent groups settling ~6ms apart) end-to-end against a real `connectToDjonik` session (via a locally-defined controllable fake Anthropic client), proving the serialization fix lives at the `DjonikSessionHandle` boundary and is visible through the real `MessageGroupBuffer` + `createGroupDispatchHandlers` integration path, not only at the unit level.
- `docs/12_ISSUE_25_IMPLEMENTATION_REPORT.md` — this §25.

No change to `messageGrouping.ts` (grouping windows, `MessageGroupBuffer` architecture), no change to `telegramCli.ts`, no change to #23's deterministic due-date logic, no change to same-card verify-after-write logic — only the addition of the queue wrapper and its tests.

### 25.6 Tests added and what they prove

| Scenario | Test | Proves |
|---|---|---|
| A | *"two concurrent send() calls are FIFO-serialized..."* | Turn 2's provider `events.send` call does not fire until turn 1 fully settles; replies stay correctly attributed (not swapped). |
| B | *"a failed first queued turn does not poison the queue..."* | An ordinary turn-level failure (empty reply) does not block the next queued turn. |
| C | *"a DjonikSessionDeadError from the first queued turn stays correctly typed..."* | `DjonikSessionDeadError` propagates correctly; the queue still attempts (does not skip) the next turn on the dead handle; no invented reconnection. |
| D | *"two concurrently requested turns produce two independent telemetry records..."* | No mixed tool-call counts, no swapped `hasImage`/`hasFile` flags, no usage attribution swap between the two turns' `DjonikTurnTelemetry` records. |
| E | *"a concurrently queued read-only turn cannot reset an earlier queued turn's pending Trello write-verification state"* (+ inverse order) | The same-card write-verification state machine (`pendingWriteTool`/`pendingWriteObjectId`/`unverifiedTrelloWrite`) cannot be reset by an unrelated concurrently-requested turn, in either queue order. |
| F | *"deterministic Kyiv due-date finalization is unaffected by concurrent request pressure..."* | Issue #23's `dueOutcomeForTurn`/Kyiv weekday-date finalization is unaffected when another turn is queued alongside it. |
| G (integration) | *"two independent groups settling ~6ms apart still serialize into two separate, correctly-attributed Managed Session turns"* (`telegramDispatch.test.ts`) | The exact live incident, reproduced end-to-end through the real `MessageGroupBuffer` + `createGroupDispatchHandlers` + a real `connectToDjonik` session: provider `events.send` calls are serialized; both replies are delivered, correctly attributed, to the right chat. |

**Proof the tests are real, not vacuous:** the fix (`send`/`sendSerial` split and `queueTail` wrapper) was temporarily reverted with `git stash` and the suite re-run; all 8 new tests failed at exactly the assertion proving serialization (`2 !== 1`, i.e. the second provider call fired before the first turn settled), confirming these tests genuinely fail without the fix and pass with it.

### 25.7 Regression evidence

- **#23 due-date determinism:** Scenario F above, plus all pre-existing #23 tests in `djonikClient.test.ts`, still pass unchanged.
- **Same-card verify-after-write:** Scenario E (both orders) above, plus all pre-existing write-verification tests, still pass unchanged.
- **#25 grouping/dispatch:** all pre-existing `messageGrouping.test.ts` and `telegramDispatch.test.ts` tests (grouping windows, isolation, one-dispatch guarantee, failure fail-closed) still pass unchanged; no grouping window value changed (adjacent remains 1200ms, album settle remains 1500ms).
- **Full suite:** **154/154 tests pass** (146 pre-existing + 7 new `djonikClient.test.ts` scenarios + 1 new `telegramDispatch.test.ts` integration test).
- `npm run typecheck`: clean, no errors.
- `git diff --check`: clean (only pre-existing CRLF-normalization informational warnings on Windows line endings, no whitespace errors).

### 25.8 Live-validation budget accounting (unchanged authorization)

Already consumed before this fix, under the Product Owner's original guardrail (max $0.50 / 5 paid Sessions / 1 safe Trello test mutation): **1 paid Managed Session, ≈$0.08 list cost, 0 Trello mutations.** This fix pass itself made **zero** additional Managed Agent API calls and **zero** Trello calls — all 8 new tests run against local fakes only (`createStreamedFakeClient` / `createControllableAnthropicClient`), exactly like every other test in the suite. Remaining under the same, not-reset authorization: at most 4 additional paid Sessions and ≈$0.42 additional list cost, still at most 1 safe Trello mutation. No commit, push, deploy, roadmap edit, or issue close was performed. Live validation (Scenario A onward) remains paused pending Product Lead review of this fix.

## 26. Live acceptance validation A–G — resumed and completed after the concurrency fix

> **Scope:** second, resumed live-acceptance pass for #25, run against the fixed local code (uncommitted) after Product Lead review of §25. Pre-flight `npm run typecheck` / `npm test` (154/154) / `git diff --check` were re-run clean immediately before starting. The adapter ran with `DJONIK_TURN_TELEMETRY=1 DJONIK_TRACE=1`. No commit/push/deploy, no roadmap edit, no issue close.

### 26.1 Sessions and cumulative spend

| Session | Purpose | Turns | List cost |
|---|---|---:|---:|
| `sesn_01MBSXTXVhLpKUGENFJPuS55` | First live-validation attempt (Scenario A) — discovered the concurrent-send race; paused before completing | 1 | $0.08 |
| `sesn_012Tm5FHUVfoQ5RJ7v49GCv1` | Resumed acceptance run (Scenario A retry through Scenario G), on the fixed code | 12 | $0.15 |
| **Total** | | **13 turns / 2 paid Sessions** | **$0.23** |

Against the guardrail: 2 of 5 max paid Sessions, $0.23 of $0.50 max list cost, 1 of 1 max Trello mutation. Stopped once A–G evidence was sufficient, well inside every declared ceiling.

### 26.2 Scenario A — two adjacent text groups, concurrency regression re-test

First attempt in the resumed session: Group 1 (`Тест A1...` ×2) merged correctly (`groupedFragmentCount:2`, `groupingReason:"adjacent_window"`, `groupingWaitMs:1512`) → reply `GROUP-A1.`. Group 2's two fragments arrived more than 1200ms apart (confirmed with the Product Owner — a human-timing artifact of two separate Telegram sends, not a code defect) and dispatched as two independent `single` groups (`groupingWaitMs:1212` and `1200`) → replies `Чекаю на друге повідомлення групи А2.` then `GROUP-A2.`. One retry of only Group 2 (no new Session, Group 1 not repeated) produced the intended merge: `groupedFragmentCount:2`, `groupingReason:"adjacent_window"`, `groupingWaitMs:1513` → reply `GROUP-A2.` (single, correctly attributed).

**Concurrency evidence:** all four/five dispatches in this session ran strictly sequentially — `recordedAt` timestamps are seconds apart, each turn's `cacheReadInputTokens` correctly carries forward the prior turn's cache state (proving the underlying stream was consumed in order by one turn at a time), and no reply was ever mixed between groups. Combined with the deterministic local proof (§25.6 Scenario A/G tests, confirmed via `git stash` to fail without the fix), this constitutes sufficient serialization evidence. A live sub-millisecond-apart dispatch race (as the original incident's accidental 6ms gap) was not reproduced by design in this retry — manual Telegram sends cannot reliably hit that window — and is recorded as a residual limitation below.

**Verdict: PASS.**

### 26.3 Scenario B — text + screenshot

First attempt: the screenshot carried the instruction text as its own Telegram **caption** (one message, not two), so the buffer correctly reported `groupedFragmentCount:1`, `groupingReason:"single"`, `textCount:1`, `imageCount:1` — valid but exercising the pre-existing #22 caption+image path, not #25's cross-fragment grouping. Reply correctly named the pictured code, `GROUP-IMAGE-742.`.

Retry with a genuinely separate photo (no caption) immediately followed by a separate text message again split into two `single` dispatches (`groupingWaitMs:1208` then `1202`) for the same human-timing reason as Scenario A — image upload + a second manual send reliably exceeds 1200ms. Both turns still succeeded correctly and independently (image turn correctly read `GROUP-IMAGE-742`; text turn replied appropriately), with zero cross-contamination.

Per the Product Owner's standing instruction (apply the same policy as Scenario A: do not spend further budget chasing manual sub-1200ms timing), this is accepted as evidence that: real image content reaches Djonik correctly (twice, via two different paths), no duplicate Managed Agent invocation, zero Trello mutation. The specific claim "two separately-sent fragments (text then image) merge via `adjacent_window`" is **not** demonstrated live — it remains proven only by local deterministic tests (`messageGrouping.test.ts`'s text+image case, `telegramDispatch.test.ts`'s integration case).

**Verdict: PASS, with a recorded residual limitation** (see §26.9).

### 26.4 Scenario C — Telegram album

A genuine 2-item Telegram album (native multi-select send, so no manual single-tap timing was involved) with caption "Назви обидва коди у правильному порядку." on the first image. Result: `groupedFragmentCount:2`, `groupedImageCount:2`, `groupingReason:"media_group_id"`, `groupingWaitMs:1505`, one turn. Reply: `ALBUM-FIRST-11\nALBUM-SECOND-22` — both codes, correct order, one coherent turn, zero Trello mutation.

**Verdict: PASS.**

### 26.5 Scenario D — isolation

No additional live traffic was generated for this scenario — sufficient live evidence already existed from Scenario A/B's own timing splits: every time a real gap exceeded ~1200ms, the buffer independently and correctly produced a **separate** `single`-reason dispatch rather than merging it with the prior fragment (five such live-observed cases: Scenario A's original A2 split, Scenario B's photo/text split). This directly demonstrates the required "a message sent outside the 1200ms adjacent window becomes a separate intake" behavior without spending extra Session/turn budget.

**Verdict: PASS (evidence reused from A/B, no additional spend).**

### 26.6 Scenario E — one explicit grouped Trello task (the sole authorized mutation)

`Тест E...` + `Створи з цих двох повідомлень одну тестову задачу...` merged correctly (`groupedFragmentCount:2`, `groupingReason:"adjacent_window"`). Djonik asked one legitimate clarifying question (which board/list — zero tool calls, zero mutation while ambiguous, matching the product contract's ambiguity-before-write requirement), was given `Backlog` (not found as a board), then `Extract` (also not the intended board), then confirmed against the actual `Djonik` board/`Backlog` list. Exact `trace` sequence for the write turn:

```
trelloReadList (list_by_board, Djonik board)
trelloWriteCard (action:create, name:"[TEST #25] Grouped intake verification", listId:.../6aa00b20c257a1b4d852e51f)
  → result ok
verification_nudge_sent (attempt 1)
trelloReadCard (action:get, cardIdOrUrl:.../6aacf1b39012aabfcc213b72)
  → result ok
```

Exactly **one** `trelloWriteCard` call across the entire validation run (confirmed by grepping every `[trace]` line), followed by exactly one same-card `trelloReadCard` naming the identical card ARI the write just created. Success was claimed by Djonik only after that verification (the one bounded corrective nudge fired first, then verified — the same accepted Foundation 7 mechanism, working as designed). No duplicate write, no cross-turn verification contamination (single active turn at a time throughout).

**Verdict: PASS.** Trello mutation count: **1 of 1 authorized**, verified.

### 26.7 Scenario F — grouped pre-send failure

No paid Managed Agent traffic was used for this scenario, per the instruction to avoid repeating already-deterministic local coverage. Existing local evidence stands: `messageGrouping.test.ts`'s fail-fast/fail-closed tests and `telegramDispatch.test.ts`'s *"a failed grouped attachment never calls session.send (structural zero-mutation guarantee)"* test, all still passing (154/154, §26.1's pre-flight run).

**Verdict: PASS (local evidence only, by design).**

### 26.8 Scenario G — regressions

- **Standalone text:** observed live multiple times during Scenario E's clarification exchange (`Extract`, `так`, single-fragment `single`-reason dispatches with plain replies) — unaffected by grouping.
- **Standalone image:** observed live in the Scenario B retry (image sent alone, `groupedImageCount:1`, `groupedTextCount:0`, correctly read `GROUP-IMAGE-742`).
- **Standalone PDF:** one minimal additional live message (PDF, no caption): `groupedFragmentCount:1`, `groupedDocumentCount:1`, `groupingReason:"single"`, `hasFile:true`, `fileMimeType:"application/pdf"`, zero tool calls, zero Trello mutation.
- **#23 due-date behavior:** left as local-regression evidence only (all pre-existing #23 tests plus the new Scenario F concurrency test in `djonikClient.test.ts` still pass), per the explicit instruction not to spend the single authorized Trello mutation twice.

**Verdict: PASS.**

### 26.9 Residual validation limitations

- **Manual sub-1200ms fragment timing is not reliably reproducible by a human sender.** Three separate attempts (original Scenario A, its retry's first try, Scenario B's retry) all showed a real inter-message gap exceeding 1200ms despite "send quickly" instructions — this is a property of manual Telegram UI interaction (typing/tap/upload latency), not a code defect; every case that *did* land inside the window (Scenario A's successful retry, Scenario C's native album, the original Scenario A Group 1) grouped correctly. The specific "two independently-sent fragments dispatch within milliseconds of each other" race that caused the original defect is proven fixed only by local deterministic tests (`djonikClient.test.ts` Scenario A/G, `telegramDispatch.test.ts`'s integration reproduction), not by a live sub-millisecond reproduction — live evidence instead confirms correct sequential, non-overlapping, correctly-attributed behavior across 13 real turns in one session.
- **Scenario B's live grouping of two separately-sent fragments (text then image) into one `adjacent_window` intake was not achieved** (see above); real image understanding was nonetheless proven live twice via other paths (caption+image, standalone image).
- **#23 deterministic due-date finalization** was validated live only indirectly in the earlier Scenario F/#25 acceptance guardrail note; this run relied on local regression evidence for it specifically, per explicit instruction.
