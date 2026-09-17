# Issue #17 — Implementation report

**Status:** implementation and validation complete; awaiting Product Owner acceptance.
**Date:** 2026-09-17.
**Scope:** GitHub issue #17 only — Memory bootstrap + validation slice.

## 1. What changed

No repository code was changed. The task was completed entirely through the existing Claude-native Djonik Memory Store, using the Anthropic SDK's direct `client.beta.memoryStores.memories.*` API (list/create/update/retrieve) — a management-plane call, not a paid Managed Session turn. Throwaway scripts were written and run from a temporary working directory (`.tmp-issue17/`, deleted after use; nothing committed) that reused the repo's existing `.env` credentials and `connectToDjonik`/`loadConfig` only for the two validation Sessions.

## 2. Exact Memory entries created/updated

All six files sit at the Memory Store root, matching the issue's preferred flat per-project structure:

| Path | Action | Final sha256 | Bytes |
|---|---|---|---|
| `/extract.md` | created | `e4c2579d...98ed` | 1,626 |
| `/cossack-labs.md` | created | `c6fe9b51...00ccd` | 1,715 |
| `/azov-a1.md` | created | `64a34f7a...c07ce` | 1,507 |
| `/seqthera.md` | **updated** (a partial pre-existing file already existed from earlier daily-planning validation; replaced with the full approved brief) | `987de32e...92d9` | 2,158 |
| `/limen.md` | created | `81555a54...8fe12` | 1,946 |
| `/work-priorities.md` | created | `bafabfc0...450f` | 2,955 |

`/preferences.md` and `/trello-conventions.md` already existed and were left untouched (confirmed by a final store listing).

## 3. Approved content preservation

All six files were written verbatim from the PO-approved payload in the latest comment on issue #17 — no rewording, restructuring, or reinterpretation. The Azov/A1 temporal-fact phrasing ("Daniel intends to leave... before the new year... treat it as a temporary medium-term commitment") was already framed correctly as a current plan rather than an evergreen fact in the approved text, so no edit was needed there. `work-priorities.md` was written as-is — it already avoids a numeric scoring system and explicitly says "combine fresh Trello evidence, these durable project priorities... State meaningful trade-offs explicitly."

## 4. Durable-vs-live boundary verification

Every file's approved text already ends with an explicit "Do not store as durable truth: current Trello status/deadlines/blockers/sprint..." line, unchanged. Live validation (below) confirmed the boundary holds in practice, not just in text.

## 5. Validation Sessions used

Exactly 2 genuinely new paid Managed Sessions, both `source: "diagnostic"`, `DJONIK_TURN_TELEMETRY=1`:

- Session 1: `sesn_01MbqjRmwd9UCzsK388jJ2bh` — 3 turns.
- Session 2: `sesn_01PdjcSexLBpGdZGmNkPUgBi` — 1 turn.

## 6. Exact prompts used

- Session 1: `Що важливо знати про Extract?` → `Що важливо знати про Cossack Labs?` → `Що зараз важливо по Extract?`
- Session 2: `Яка роль Даніеля в проєкті Limen?`

## 7. Results

**Durable recall (2 projects):** Correct for both. Extract's answer covered type/role/scope/Anna/pricing/planning guidance; Cossack Labs' answer covered type/role/workload/Tue-Thu cadence/Ivan-Zhenya/$17h — both turns had `memoryRead: true`, `toolCalls: 0`.

**Mixed Memory + fresh Trello:** Partially demonstrated. The third turn correctly did **not** present stored Extract facts as current status — it triggered two live `trelloSearch` calls instead (`toolCalls: 2`, `memoryRead: false`) and, finding no matching board under the literal name "Extract," told the user it couldn't confirm live state rather than fabricating one. This is the correct reliability behavior (no false live-state claim) but did not produce a full "durable + fresh combined" answer, since the Trello search itself came back empty. See limitation §13.

**Cross-project leakage:** None observed — the Extract answer contained no Cossack Labs facts ($17/h, Ivan/Zhenya, Tue/Thu cadence) and vice versa.

**Correction superseding stale fact:** Confirmed. Changed `limen.md`'s "Daniel's role: ... / designer." to "... / lead architect." via the free Memory API (`precondition` optimistic-concurrency check). A genuinely new Session 2 correctly recalled "лід-архітектор" and did not surface "дизайнер." The canonical value was then restored via the same free API and verified byte-identical to the original (`sha256` matches exactly).

## 8. Spend/session guardrail actuals

- Paid Sessions used: **2 of 3**.
- Measured public-list-price cost: **$0.14** ($0.07 + $0.03 + $0.02 in Session 1, $0.02 in Session 2), well under the $0.50 ceiling.
- Stop reason: declared evidence became sufficient after Session 2 (durable recall × 2, cross-project isolation, correction-supersedes-stale all confirmed) — stopped rather than spending toward the mixed-query nuance in §13, per the guardrail's own stop rule ("required evidence is already sufficient" / avoid spend for diminishing returns).
- Limits respected: yes, on both dollar and session count.

## 9. Tests/verification run

- `npm run typecheck` — passed.
- `npm test` — 46 passed, 0 failed (unchanged from baseline; no code touched).
- `git diff --check` — passed, no output.
- `git status --short` — clean (no output).

## 10. Files changed in repository

None. All work happened against the external Memory Store resource via direct API calls from temporary, non-committed scripts.

## 11. `git diff --check` result

Clean (exit 0, no output).

## 12. `git status --short` result

Clean (no output — nothing to show).

## 13. Limitations / provider behavior discovered

- The Memory Store direct CRUD API (`client.beta.memoryStores.memories.*`, beta header `agent-memory-2026-07-22`) is a genuine free/unpaid management-plane surface, separate from Managed Sessions — useful precedent for any future bootstrap/correction work in this repo without spending on Sessions.
- `memories.update()` requires `precondition: { type: "content_sha256", content_sha256 }` — the SDK's own inline example omits `type`, but the API rejects the call without it (`Field required`). Worth remembering if this pattern is reused.
- The mixed-query test (`Що зараз важливо по Extract?`) surfaced a real naming gap: Djonik searched Trello for the literal string "Extract" and found no board/card, so it asked for clarification instead of answering — it did **not** misuse Memory as a live-state substitute, but the scenario didn't produce a fully combined durable+live answer. This appears to be a live Trello board/alias-naming mismatch unrelated to this issue's Memory content, not a Memory defect; it's worth a note for whoever names/aliases the Trello board, but is out of scope to fix here.
- A pre-existing partial `/seqthera.md` (used in earlier daily-planning validation, per `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §17/§24) was superseded with the fuller PO-approved brief — flagged here in case that earlier content had unrecorded provenance worth knowing about.

## 14. Not done

No roadmap edit, no Skill created, no commit/push/deploy, and issue #17 was not closed.
