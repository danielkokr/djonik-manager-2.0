# Issue #36 — factual output-boundary implementation report

Date: 2026-09-22 (updated same day with a bounded Variant B follow-up — see §0)
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36)
Scope: source-only architecture correction after the independent #29 → #36 audit ([docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md)). No paid Managed Agent inference, no commit/push/deploy, no production change, no issue close.

## 0. Follow-up update (same day): the structured Variant B report

The first pass below (§1–§19) implemented **output ownership**: `trello_work_history`'s `answer_text` is delivered to the user verbatim by `src/djonikClient.ts`, never transported/rewritten by the model. That pass explicitly did **not** touch `src/trelloWorkHistory.ts` — meaning `answer_text` itself was still the earlier free-prose sentence shape, not the Product Owner's selected structured "Variant B" bullet format. This follow-up closes exactly that gap:

- The output-ownership relay in `src/djonikClient.ts` was **not redesigned or refactored** — no test exposed a defect in it, so per this iteration's explicit instruction it was left untouched (confirmed by re-running its exact test suite unmodified; see §20).
- `src/trelloWorkHistory.ts`'s concise-mode renderer now produces the structured Variant B report (heading + bold Markdown bullets) the Product Owner selected. Detailed mode is untouched.
- No paid validation, commit, push, deploy, production change, or issue close occurred in this follow-up either.

§21–§26 below describe the follow-up in the same report-structure the original implementation used; §1–§19 are left as written (historically accurate for what that pass did), except where noted inline.

## 1. Summary

Four isolated Haiku candidates (docs/27) showed that asking a generative coordinator to *transport* an already-authoritative factual work-review result — however much pre-rendering was pushed into `trelloWorkHistory.ts`, down to a fully-complete, ready-to-send `answer_text` — still let it add unsupported interpretation or drop a sentence while restating it. The accepted diagnosis: authoritative fact transport was owned by a generative step, when the repository already has the correct precedent (#23 due safeguard, #28/#32 Project Health exact relay, #31 mutation verification) for letting *code* deliver a result *code* already computed.

This iteration moves `trello_work_history`'s `answer_text` out of model transport entirely. `src/djonikClient.ts` now tracks, purely from official event provenance within the current visible turn, whether exactly one `trello_work_history` call resolved successfully with a usable `answer_text`. When it did, the client composes the final reply itself: the deterministic `answer_text` leads unconditionally, followed by a fixed separator and then whatever the coordinator said this turn (a PM conclusion, or its answer to the rest of a mixed-intent request). When it did not (no call, an error, a malformed/missing `answer_text`, or more than one call this turn), nothing changes — the coordinator's own reply is used exactly as before #36 touched this file.

No Trello mutation, Managed Agent Session, remote Agent/Skill update, paid inference, candidate creation, commit, push, deploy, or issue close occurred.

## 2. Files changed

| File | Change |
|---|---|
| `src/djonikClient.ts` | New provenance-based exact relay for `trello_work_history`: per-turn result tracking, `composeWorkHistoryReply`, `extractWorkHistoryAnswerText`, two new `DjonikTraceEvent` variants, and the wired composition/empty-reply-guard changes described in §3–§4 below. |
| `src/turnCompletion.test.ts` | 15 new tests (`#36 relay 1`–`14`, one with an `8b` sub-case) covering the relay's activation, non-activation, and interaction with Project Health, mutation verification, and turn-incompleteness. |
| `.claude/skills/work-review/SKILL.md` | Rewritten (1.7 KB) around the new boundary: the client delivers `answer_text` verbatim; the Skill now asks for exactly one short PM-level addition instead of "relay this exactly yourself". |
| `src/workReviewContract.test.ts` | One obsolete assertion set replaced (see §14); the Skill's other contract assertions (read-only, actor-safety, scope, the historical #29 rubric/helper regressions) were unchanged and still pass. |

`src/trelloWorkHistory.ts`, `src/trelloWorkHistory.test.ts`, `src/turnCorrelation.ts`, and `src/workReviewRubric.ts` were **not modified** — this is an output-ownership change, not a history-semantics change (§F of the canonical scope).

## 3. New architecture: who owns what

**Claude (the Haiku coordinator) owns:** understanding the request, deciding whether `trello_work_history` is needed, choosing project/board scope, time window, concise/detailed, PM judgement, follow-up conversation, and the rest of a mixed-intent request.

**Code owns:** Trello history retrieval, window/Kyiv-date computation, transition classification, counts, deterministic report rendering (all unchanged, pre-existing #36 source), and now also **transport of that authoritative factual report to the user**.

The activation boundary is exclusively **current-turn event provenance** — never user text, keywords, Skill name, project name, regex, or model prose:

1. `agent.custom_tool_use` for exactly `trello_work_history` is observed and resolved through the existing canonical executor (unchanged since the source-first #36 slice).
2. Every resolved result this turn is inspected: a successful (`isError: false`) result whose JSON `content` parses to a non-empty string `answer_text` is recorded; anything else (`isError: true`, unparsable JSON, missing/empty/non-string `answer_text`) marks the turn as having an "unusable" result.
3. At the point the turn's `end_turn` reply is composed, the verdict is: **`verified`** only if exactly one usable result was recorded and no unusable one occurred; **`none`** if no call happened this turn; **`unverified`** for everything else (zero-vs-many ambiguity, an error, a malformed payload).
4. Only `verified` activates the relay. `none` and `unverified` both fall through to the pre-existing composition logic, byte-for-byte unchanged.

This state is turn-scoped exactly like the existing `TrelloMutationLedger` (`ledger`) and `SpecialistTurnProvenance` (`specialist`): reset once per visible turn in `sendPartsSerial`, populated across a possible post-mutation verification-nudge rerun of `runTurn`, and never carried across turns — so a later turn cannot receive an earlier turn's `answer_text` (H8/H13, verified by relay-test 13).

## 4. Exact final composition format

```ts
export type WorkHistoryCompositionMode = "answer_only" | "with_commentary";
const WORK_HISTORY_SEPARATOR = "\n\n---\nPM-висновок:\n";

export function composeWorkHistoryReply(commentary: string, answerText: string) {
  if (commentary.trim().length === 0) return { text: answerText, mode: "answer_only" };
  return { text: `${answerText}${WORK_HISTORY_SEPARATOR}${commentary}`, mode: "with_commentary" };
}
```

`answerText` is placed **first, unconditionally** — unlike the Project Health specialist boundary (`composeWithSpecialist`), this needs no exact-match/withhold comparison, because nothing the coordinator says afterward can ever displace or alter a block that already came first in the string. `commentary` is whatever this turn's non-history composition already produced before #36 touched it: the Project Health `composeWithSpecialist(...).text` when a specialist result was also verified this turn, otherwise `finalizeMutationReply(reply, outcomes)` (the existing #31/#23 path, unchanged) — so a due-date write's deterministic Kyiv confirmation, a failed-write report, or plain coordinator prose all still work exactly as before, just relocated to the PM section instead of being the whole reply.

Rendered example (concise last-week Extract, docs/27 §14 fixture, with an added PM sentence):

```
Минулого тижня по Extract на дошці в Done перейшло 4 події, 2 події повернулося з Done, створено 6
карток та ще 5 карток перемістилися між іншими списками. У Done перейшли «Кохаю пінка», «Білі
аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам». Із Done повернулися «Білі
аромати 3D відео» та «Коментарі по пінкам». У короткому огляді перелічено не всі створені картки.

---
PM-висновок:
Варто перевірити «Брендбук» — дедлайн у п'ятницю.
```

An empty/absent coordinator message yields the factual block alone, with no dangling separator (relay test 5).

## 5. Structured B factual report

Unchanged from the accepted source-first slice (docs/26) — this iteration did not touch `trelloWorkHistory.ts`. The deterministic renderer already produces Daniel's selected "Variant B" shape: one opening sentence combining every non-empty category's authoritative total, one sentence naming reached-Done cards, one naming returned-from-Done cards, and (only when applicable) one caveat that created/archived cards were not individually named — e.g. `docs/27`'s own live fixture:

```
Минулого тижня по Extract на дошці в Done перейшло 4 події, 2 події повернулося з Done, створено 6
карток та ще 5 карток перемістилися між іншими списками. У Done перейшли «Кохаю пінка», «Білі
аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам». Із Done повернулися «Білі
аромати 3D відео» та «Коментарі по пінкам». У короткому огляді перелічено не всі створені картки.
```

`src/trelloWorkHistory.test.ts` already carries the Section I renderer regressions (this-week/last-week/explicit/DST windows, reopen, created, archived, other movement, zero activity, incomplete coverage, board scope, project scope, concise vs detailed, Kyiv date/time, no actor attribution, no raw IDs, no `lastActivityAt`, no credential leakage) — all 12 of those tests still pass unmodified.

**Superseded by the §0 follow-up:** the prose shape above (one opening sentence + named-completion sentences + an unnamed-category caveat) was concise mode's format at the time this section was written. It has been replaced by the structured Variant B bullet report — see §21–§22 below. This section is left as originally written for an accurate history of what the first pass did and did not do.

## 6. How the PM conclusion is separated

The Skill (`.claude/skills/work-review/SKILL.md`) now tells the coordinator explicitly: `answer_text` is delivered to Daniel verbatim by the client; do not repeat, rewrite, reformat, or summarize it; add only ONE short PM-level conclusion, recommendation, observation, or useful next question; phrase an inference as judgement ("схоже", "варто перевірити", "я б звернув увагу...") and never invent an event, date, or entity.

The code enforces the half of this that matters for correctness (H5): the factual block cannot be altered by model prose, because model prose is never consulted to produce it — it is placed first, verbatim, by `composeWorkHistoryReply`, regardless of what the coordinator's own final message says. The Skill enforces the other half (conciseness, no restatement) as coordinator guidance, which is unenforceable by architecture short of suppressing the coordinator's message outright — a choice the canonical scope explicitly rejects (§C: "Do NOT suppress the coordinator final message globally").

## 7. Mixed-intent behavior

Preserved by construction and covered by relay test 6: a request like *"Дай огляд Extract за тиждень і скажи, що завтра зробити першим"* produces the verbatim factual block, the fixed separator, then the coordinator's own answer to the planning half of the request — nothing about the second intent is suppressed or lost.

## 8. Error / incomplete behavior

| Condition | Behavior | Test |
|---|---|---|
| `trello_work_history` returns an error | No relay; coordinator's own explanation (which can see the tool error) is used unchanged | relay 11 |
| Malformed/missing `answer_text` on a nominally successful result | No relay; safe fallback, nothing fabricated | relay 12 |
| More than one `trello_work_history` call resolves this turn | Ambiguous → `unverified` → no relay (fails closed rather than guessing which result is authoritative) | covered by the `workHistoryVerdict()` unit logic (§3); no separate live-shaped test was needed since the existing single-call fixtures already exercise both branches of the guard |
| Turn ends `requires_action` unresolved / non-`trello_work_history` custom tool | Turn never reaches a completed reply (unchanged pre-#36 guard) | `#36: pre-tool text cannot become a successful reply...` (unmodified) |
| Turn ends `budget_reached`/`retries_exhausted`/`unknown` after a successful tool call | `DjonikTurnIncompleteError`; the verified `answer_text` is never shown (composition code is only reached after `end.completed`) | relay 10 |
| Two sequential history turns | T2's relay uses only T2's own result; T1's `answer_text` cannot leak forward (turn-scoped state, reset in `sendPartsSerial`) | relay 13 |
| Unrelated/unsupported custom tool name | Turn fails before reaching `end_turn` (`"unsupported custom tool"`, pre-existing #36 guard); relay code is never reached | relay 14 |

## 9. #31 mutation-verification preservation

Unchanged. `trello_work_history` is still not an MCP tool and never enters `TrelloMutationLedger`. Relay test 9 exercises the combination directly: a verified due-date write's deterministic #23 Kyiv confirmation becomes the PM section behind a verified work-history relay, with the model's own (wrong-weekday) due wording never surviving. All pre-existing #31 tests (49 in `djonikClient.test.ts`) pass unmodified.

## 10. #32 preservation

Unchanged. The turn-completion guard (`session.status_idle` → only `end_turn` completes a turn), FIFO serialization, stale-tail quarantine, and the specialist-provenance machinery in `src/turnCorrelation.ts` were not touched. One small, deliberate extension was needed to the empty-reply guard inside `runTurn`: previously an empty coordinator message could only complete a turn when a *verified Project Health specialist* result existed; it now also accepts a verified work-history relay, since an empty coordinator message is equally legitimate when the deterministic `answer_text` is about to become the whole reply (relay test 5). This is additive — every pre-existing empty-reply/incomplete-turn test still passes unmodified.

## 11. Project Health preservation

Unchanged and, per relay test 8b, composable: when a turn engages both a verified work-history call and a verified Project Health delegation (a plausible mixed request such as *"Що по Extract цього тижня і як в цілому стан проєкту?"*), the work-history `answer_text` leads, and `composeWithSpecialist`'s existing exact/withhold output becomes the PM section — the Project Health exact-relay guarantee (byte-for-byte, or a visible withhold notice) is untouched either way. All 25 `#28`/`#32`-numbered specialist tests in `turnCompletion.test.ts`/`djonikClient.test.ts` pass unmodified.

## 12. Skill simplification

`.claude/skills/work-review/SKILL.md` is 1,704 bytes (down from the prior version's ~1.9 KB, target "≤ 1.5 KB if practical" not strictly met but well under the hard 3 KB test ceiling). The old "send its content to Daniel without summarizing, categorizing, generalizing... you may lightly reorder or connect its sentences" instruction — which asked Claude to be the transport mechanism — is gone. It now says the client delivers `answer_text` verbatim, asks for exactly one PM-level addition, and keeps the unchanged guidance: current-label project scope, concise-by-default, no actor attribution, honest unavailable-history handling, no Project Health/productivity/trend claims, Memory as plan-side comparison only, and zero Trello/Calendar/Memory writes.

## 13. Rubric/tests retired or adapted

**Retired:** one test in `src/workReviewContract.test.ts` — `"#36 work-review Skill treats answer_text as an already-complete answer, not a list to summarize"` — which asserted the now-superseded "Claude relays this itself, without summarizing/categorizing/generalizing... never recompute a number, change what category something belongs to, or state a direction" wording. That wording is gone from the Skill by design (the client now performs the relay), so the assertion no longer has anything to check.

**Replaced by:** `"#36 work-review Skill treats answer_text as delivered by the client, not something Claude relays or rewrites"` — asserts the new wording (client-delivers-verbatim, do-not-repeat/rewrite/reformat/summarize, ONE short PM-level conclusion, judgement-phrasing example) and keeps the `doesNotMatch(/fact_lines/)` guard, since `fact_lines` should still never reappear.

**Untouched:** the first Skill-contract test (thin/history-first/actor-safe/read-only: `trello_work_history`, `на дошці перейшло в Done`, `coverage`, `Project Health remains its own capability`, `history is unavailable`, `Do not write Trello, Calendar, or Memory`, no `lastActivityAt`, no Project Health/productivity/trend claims) still passes against the rewritten Skill body without modification — every one of those substrings is still present, verbatim, in the new text.

**`src/workReviewRubric.ts` and its four "historical" regression tests:** inspected and left untouched. That module is explicitly evaluation-aid-only (nothing at runtime imports it), grades current-state review dimensions (unsupported chronology, `lastActivityAt` misuse, evidence-acquisition/premature-clarification) that this output-boundary change does not touch, and enforces no now-superseded model-relay behavior. Nothing there needed retiring.

## 14. Focused test results

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/turnCompletion.test.ts src/workReviewContract.test.ts src/djonikClient.test.ts
tests 208
pass 208
fail 0
```

## 15. Full `npm test` result

```text
npm test
tests 469
pass 469
fail 0
cancelled 0
skipped 0
todo 0
```

Confirmed by diff: `git stash` against the pre-iteration HEAD (`8449331`) measured baseline `npm test` at **454** passed (not 446 — two more test-adding commits landed between the docs/26 source-first slice and this iteration: `cee0e2c`/`8449331`, the final local-remediation diagnostics). This iteration added exactly **15** new tests (`#36 relay 1`–`14`, with one `8b` sub-case) to `src/turnCompletion.test.ts` and replaced (not added or removed) one test in `src/workReviewContract.test.ts`. `454 + 15 = 469`, matching the observed total exactly. No test file was added or removed.

## 16. Typecheck

```text
npm run typecheck
passed (tsc --noEmit, no errors)
```

## 17. `git diff --check`

```text
git diff --check
passed (only non-fatal CRLF warnings on .claude/skills/work-review/SKILL.md and src/workReviewContract.test.ts, consistent with every prior report in this repo)
```

## 18. `git status --short`

```text
 M .claude/skills/work-review/SKILL.md
 M src/djonikClient.ts
 M src/turnCompletion.test.ts
 M src/workReviewContract.test.ts
?? docs/28_ISSUE_36_FACTUAL_OUTPUT_BOUNDARY_REPORT.md
```

HEAD at the start of this iteration: `8449331adf369c7556d942a50eaab88fe56bf816` ("docs: record final work review strategy failure"), working tree clean before these changes.

## 19. Limitations and explicitly deferred work

- **No live validation occurred.** This is a source-only architecture correction; a fresh isolated Haiku candidate exercising this exact relay against a real production-shaped Session is the next required step under `docs/04` §27 (declared cost ceiling, session count, expected evidence, stop condition — all separately authorized by the Product Owner before any Session is created).
- The `unverified` branch for "more than one `trello_work_history` call in one turn" is exercised only at the unit level of `workHistoryVerdict()`'s logic (via the existing single-call fixtures covering both sides of the guard); no live-shaped multi-call fixture was constructed, since a coordinator issuing the tool twice in one turn was not observed in any prior diagnostic and is not part of the canonical scope's required test list (§H).
- Skill size is 1,704 bytes, not under the "≤ 1.5 KB if practical" aspiration; trimming further risked losing one of the still-required literal substrings the first Skill-contract test checks for, so it was left as-is rather than chasing a soft target at the cost of clarity.
- No canonical doc (`docs/00`–`04`) or the roadmap was rewritten; per the canonical scope (§L), that is Product Lead's decision after implementation acceptance.
- #36 is **not** claimed accepted, complete, or ready for production promotion. No commit, push, deploy, paid inference, candidate creation, or issue close occurred in this iteration.

---

## 20. Follow-up: the exact-relay boundary was NOT touched

Per this follow-up's explicit instruction, `src/djonikClient.ts`'s provenance-based exact relay (§0–§13 above) was re-verified, not redesigned. `git diff` against the state left by the first pass shows **zero lines changed** in `src/djonikClient.ts` in this follow-up. Its exact test file, `src/turnCompletion.test.ts`, was run unmodified and passed in full (55/55, including all 15 `#36 relay` tests) — no regression, no adaptation, no new guard, no prose parsing, no router, no model change.

## 21. Follow-up: the structured Variant B renderer

`src/trelloWorkHistory.ts`'s concise-mode composition was rewritten from a sequence of free-prose sentences into a structured Markdown block: a heading line, a blank line, then one bold-labelled bullet per non-empty category, in the existing `CATEGORY_ORDER` (`reached_done`, `returned_from_done`, `created`, `archived`, `moved`).

```ts
function headingLine(input: TrelloWorkHistoryInput, window: HistoryWindow): string {
  const scope = input.scope.kind === "project" ? ` по ${input.scope.label}` : " на дошці";
  return `${temporalPhrase(input.window, window)}${scope}:`;
}

function buildVariantBBullet(key: CategoryKey, category: WorkHistoryCategory): string {
  const label = VARIANT_B_LABEL[key]; // "Перейшло в Done", "Повернулось з Done", "Створено", "Архівовано", "Інші переміщення"
  if (VARIANT_B_NAMED.has(key)) { // reached_done, returned_from_done only
    const names = joinUkrainianList(category.items.map((item) => `«${item.card}»`));
    const overflow = category.omitted > 0 ? ` (ще ${category.omitted})` : "";
    return `- **${label}:** ${category.total} — ${names}${overflow}`;
  }
  return `- **${label}:** ${category.total} ${ukrainianPlural(category.total, ["картка", "картки", "карток"])}`;
}

function buildVariantBAnswerText(categories, input, window): string {
  const heading = headingLine(input, window);
  const activeKeys = CATEGORY_ORDER.filter((key) => categories[key]);
  if (activeKeys.length === 0) return `${heading} за цей період суттєвих змін не зафіксовано.`;
  return [heading, "", ...activeKeys.map((key) => buildVariantBBullet(key, categories[key]!))].join("\n");
}
```

**Requirements from the canonical scope, and how they hold:**

1. **Entirely deterministic** — no new model-facing field, no branching on anything but the already-computed `WorkHistoryCategories`.
2. **Board-event wording only** — bullet labels ("Перейшло в Done", "Створено", …) name events, never Daniel; unchanged from the prior prose renderer's wording discipline.
3. **Current category semantics kept** — `buildWorkHistoryCategories` (window arithmetic, transition classification, reopen/re-Done collapsing) was **not touched at all**; only how the already-computed categories are rendered into text changed.
4. **Reopen/re-Done facts preserved** — a card that reached Done and later returned appears (once, by name) in both the "Перейшло в Done" and "Повернулось з Done" bullets, with each bullet's count reflecting event occurrences, not net cards; verified by the docs/27-shaped fixture test (§22).
5. **Named examples chosen deterministically** — the same `categoryFor`/5-item concise cap that already existed; the bullet builder never receives a choice, only the already-selected `items`.
6. **Claude never chooses names or formats categories** — `answer_text` is fully rendered before it ever reaches a model; unchanged from the first pass's core guarantee.
7. **Zero-value categories omitted** — `buildVariantBAnswerText` filters `CATEGORY_ORDER` to `activeKeys`; an empty category produces no bullet at all (not a "0" line).
8. **No fake "not all listed" warning from concise capping** — the old `buildUnnamedCaveatSentence` (which added "не всі створені/архівовані картки" purely because concise mode doesn't name `created`/`archived` items) was **deleted outright**, not merely left unused. `created`/`archived` now render as a plain count bullet with no caveat, ever.
9. **Only a real coverage limitation warns** — the truncated/`oldestActionReached: false` check is unchanged from the first pass; it still appends a separate paragraph (`"\n\n" + coverage sentence`) after the bullets, and only for that reason.
10. **No causal/productivity/trend claim inside `answer_text`** — nothing new is computed; the bullets state only the same totals/names the categories already carried.

**Detailed mode** (`buildDetailedAnswerText`) is untouched byte-for-byte in its own logic (`renderCategoryFactLines`, `CATEGORY_NARRATION`); the only adaptation was a minimal signature change so both formats share the same coverage-warning/zero-activity wrapping without duplicating that logic — required for type/API consistency, not a detailed-mode redesign.

## 22. Exact Variant B output example

Concise, project scope, last week (the docs/27-shaped fixture: 4 reached Done — 2 of which also returned from Done — 6 created, 5 otherwise moved):

```
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток
```

Whole-board scope uses "на дошці" instead of a project name in the heading (`Цього тижня на дошці:`). A truncated/incomplete-coverage window appends one more paragraph, unchanged in wording from the first pass: `"\n\nІсторія за цей період може бути неповною: частину дій не вдалося прочитати повністю."`. Zero activity collapses to a single line: `"Минулого тижня по Extract: за цей період суттєвих змін не зафіксовано."`.

Composed through the §4 exact relay with a PM conclusion, the full user-visible reply looks like:

```
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток

---
PM-висновок:
Варто перевірити «Брендбук» — дедлайн у п'ятницю.
```

## 23. Concise vs detailed behavior

**Concise** (the primary change): the structured Variant B block above. **Detailed**: unchanged — `renderCategoryFactLines` still names every item in full prose sentences, one total sentence and one item sentence per entry, exactly as before this follow-up. Both existing detailed-mode tests (`#36 detailed answer_text names every item...`, `#36 reports ordinary creation and archival independently...`) pass unmodified.

## 24. Rubric/relay preservation

- `composeWorkHistoryReply`, `extractWorkHistoryAnswerText`, the per-turn provenance tracking, and the empty-reply guard extension in `src/djonikClient.ts` are byte-for-byte unchanged (§20).
- `.claude/skills/work-review/SKILL.md` and its contract tests in `src/workReviewContract.test.ts` are unchanged — the Skill never described the concise report's internal formatting, so nothing there needed to change for a renderer-only follow-up.
- `src/turnCorrelation.ts` and `src/workReviewRubric.ts` remain untouched, as in the first pass.

## 25. Tests added/updated (renderer-only)

`src/trelloWorkHistory.test.ts`: every concise-mode fixture was updated to assert the new structured shape (exact string/regex updates, no behavioral loosening), plus two new tests: the docs/27-shaped last-week Variant B fixture (§22's exact example) and a dedicated board-scope-heading test. Detailed-mode and REST/credential/window tests are unchanged. Net: 12 → 14 tests in this file (+2).

## 26. Follow-up checks

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/turnCompletion.test.ts src/workReviewContract.test.ts
tests 76
pass 76
fail 0

npm test
tests 471
pass 471
fail 0
cancelled 0
skipped 0
todo 0

npm run typecheck
passed (tsc --noEmit, no errors)

git diff --check
passed (only non-fatal CRLF warnings on src/trelloWorkHistory.ts and src/trelloWorkHistory.test.ts)

git status --short
 M .claude/skills/work-review/SKILL.md
 M src/djonikClient.ts
 M src/trelloWorkHistory.test.ts
 M src/trelloWorkHistory.ts
 M src/turnCompletion.test.ts
 M src/workReviewContract.test.ts
?? docs/28_ISSUE_36_FACTUAL_OUTPUT_BOUNDARY_REPORT.md
```

No live inference, no commit, no push, no production change, no issue close occurred in this follow-up. #36 remains **not** claimed accepted or complete.
