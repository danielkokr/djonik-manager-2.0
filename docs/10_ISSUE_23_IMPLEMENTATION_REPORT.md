# Issue #23 implementation report — Post-write due-date wording must match verified Trello field

> **Scope:** Issue #23. Discovery, reproduction, and a Skill-level fix only. No commit, push, deploy, roadmap edit, or issue close was performed as part of this report.

## 1. Summary

Reproduced the reported defect live, isolated the exact mechanism, and applied the smallest fix consistent with the Claude-native architecture: a new rule in the `task-management` Skill. No adapter code, no Managed Agent Console change, no new persistence/state mirror was introduced.

## 2. Root cause

Not an adapter defect. `src/djonikClient.ts`'s verify-after-write logic (`isTrelloWriteTool` / `isTrelloReadTool` / `readVerifiesWrite`) only checks tool-call **identity** — same `cardId` read after write — and by design never inspects mutated field values (see the existing code comment: "It never inspects mutated field values... This is identity verification only"). It structurally cannot be the source of a wording mismatch.

Live reproduction (below) isolated the defect to **model response composition**: after a verified `due` read whose UTC value converts to a *different* Kyiv calendar date than the write before it, the agent correctly advances the stated calendar date but does not recompute the **weekday** for that new local date — it carries over the weekday word used a turn earlier for the same card.

## 3. Reproduction evidence

Live session `sesn_01NBrT6TKuwwP3VTYAcsWLaW`, board "Djonik", test card `[TEST #23] Due-date wording check A` (real, reversible test card left on the live board for Daniel to archive).

An earlier session `sesn_01G4unsmRtgHuTRMksvRNGZP` was aborted with zero Trello mutation because the originally intended "Extract" project does not exist as a board in this environment (only "Djonik" does); the scenario was re-run against the real "Djonik" board.

| Turn | Requested (Kyiv) | Verified `due` (UTC, direct read) | Kyiv-local calendar date | Actual weekday | Agent's stated weekday | Verdict |
|---|---|---|---|---|---|---|
| 1 (create) | 19 Sep 2026, 21:00 | `2026-09-19T18:00:00.000Z` | 19 Sep 2026 | Saturday (Субота) | "Субота, 19 вересня 2026" | ✅ correct |
| 2 (update) | 20 Sep 2026, 01:00 | `2026-09-19T22:00:00.000Z` | 20 Sep 2026 | **Sunday (Неділя)** | "**Субота**, 20 вересня 2026" | ❌ **defect reproduced** |

Turn 2 is the reproduction: the UTC→Kyiv date conversion itself was correct (`22:00 UTC` → `01:00` next day Kyiv, dates advance from 19→20 Sep), and the raw verified value matched what was written — but the weekday word was not recomputed for the new local date, so it stayed "Субота" (Saturday) when the date it just stated, 20 Sep 2026, is actually a Sunday.

No intended-vs-verified **value** mismatch occurred in either turn (Trello stored exactly what was requested both times) — the defect is confined to weekday-word staleness across a local-date rollover, not to the `due` field value itself.

## 4. Architecture decision

Preference order applied (per issue and `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` §12):

1. **Agent-level system-prompt instruction** — not applied. This session has no Managed Agent Console/API access; changing the Djonik Agent's system prompt is an external manual Console action outside this session's tool surface (flagged per `AGENTS.md`, not replaced with a workaround).
2. **Task-management Skill guidance** — **applied**. This defect is squarely workflow-specific (post-Trello-write field wording), which is exactly what this Skill already governs (it already contains the adjacent "Verify before claiming success" rule from #8/#15).
3. **Deterministic adapter safeguard** — not needed. The verified value itself was always correct; only natural-language wording composition was wrong, which adapter code has no business generating (that would mean the adapter, not Claude, composing date prose — against the "Claude owns reasoning" architecture rule).

## 5. Exact fix

Added a new section, **"Exact due-date/weekday wording must match the verified read,"** to `.claude/skills/task-management/SKILL.md`, requiring:

- exact date/weekday wording is always re-derived from the same-turn verified `due` read — never from intent, memory, or an earlier turn;
- convert UTC `due` to Europe/Kyiv local time (the established basis for this product, per `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md`'s existing "20:00 Kyiv" evidence) before stating date/day;
- recompute the weekday fresh from that converted local date every time a date is stated, even when only the time (not the date) appears to have changed — this is the exact defect reproduced in turn 2 above;
- if the verified value differs from what was intended/requested, state the verified value as truth and say so plainly, using the issue's own example wording.

## 6. Files changed

- `.claude/skills/task-management/SKILL.md` — one new section added; no other file touched.

## 7. Before vs. after behavior

**Before:** a weekday word could survive across a local-date rollover from an earlier turn, producing a date/day-mismatched claim (reproduced above; matches the original #22 anecdote's date/day mismatch pattern).

**After (per new Skill instruction):** weekday must be recomputed from the Kyiv-local date being stated, sourced only from the current-turn verified read; intended-vs-verified value mismatches must be reported honestly rather than claimed as success.

## 8. Live validation session IDs

- `sesn_01G4unsmRtgHuTRMksvRNGZP` — aborted, "Extract" board not found, zero mutation.
- `sesn_01NBrT6TKuwwP3VTYAcsWLaW` — baseline reproduction, **pre-fix** Skill content (the fix was written after this session, based on its evidence).

No post-fix live session was run. The Skill content the live Managed Agent actually uses is a separately-managed Console resource, not read live from this repository at runtime — syncing the edited Skill file to Console is a manual Product Owner action outside this session's tool access. Re-validating against the still-unsynced (old) Skill would add no evidence, so validation stopped here per the diminishing-returns clause of the declared guardrail.

## 9. Intended vs. verified due values

- Turn 1 intended: 19 Sep 2026, 21:00 Kyiv → verified `2026-09-19T18:00:00.000Z` (matches).
- Turn 2 intended: 20 Sep 2026, 01:00 Kyiv → verified `2026-09-19T22:00:00.000Z` (matches).

No value-level mismatch was produced live; the mismatch-handling requirement in the new Skill rule is covered by explicit instruction only, since there is no adapter code path to fixture a forced provider-side mismatch for a natural-language wording defect.

## 10. Final user-visible wording (verbatim)

- Turn 1: "Субота, 19 вересня 2026, 21:00 за Києвом" — correct.
- Turn 2: "Субота, 20 вересня 2026, 01:00 за Києвом" — **weekday wrong** (should be "Неділя").

## 11. Weekday/date correctness evidence

19 Sep 2026 = Saturday; 20 Sep 2026 = Sunday. Turn 1 matched; turn 2 did not (see §3 table).

## 12. Validation spend guardrail

Declared before the first paid turn: max spend $0.50; max 4 paid Managed Sessions; expected evidence = exact-wording match (A), weekday correctness (B), honest mismatch reporting (C), no regression to ordinary verify-after-write (D).

**Actuals:** 2 of 4 sessions used (1 aborted with zero mutation, 1 two-turn reproduction). Per-turn cost telemetry was not enabled for this diagnostic CLI run, so an exact dollar figure was not captured; based on comparable historical two/three-turn create+verify flows in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` and `docs/09_ISSUE_22_IMPLEMENTATION_REPORT.md` (~$0.14–0.31 for similar turn counts), this stayed well under the $0.50 ceiling. Stopped voluntarily once root cause was conclusively identified and the fix was scoped — further paid runs against the still-unsynced Skill would be diminishing returns.

## 13. Tests/checks and exact results

- `npm run typecheck` — passed, no errors.
- `npm test` — **61/61 passed**, 0 failed, 0 regressions (verify-after-write identity logic, telemetry, Telegram adapter all intact).
- No new TypeScript test was added: the fix is a natural-language Skill instruction with no corresponding adapter code path to unit-test. Behavior was validated live instead, which is the only mechanism available for a wording-composition defect.
- `git diff --check` — clean (exit 0).
- `git status --short`:
  ```
   M .claude/skills/task-management/SKILL.md
  ```

## 14. Limitations / deferred items

- The updated Skill content must be synced to the Console-managed Skill resource by the Product Owner before it takes effect on the live agent.
- A live post-sync re-validation, repeating this exact timezone-boundary scenario, should follow once that sync happens, under a fresh guardrail declaration.
- The mismatch-reporting requirement (issue's item 4 / acceptance item 4) was validated only by instruction, not by a reproduced live mismatch — Trello stored exactly what was written in both test turns.

## 15. Scope discipline

No commit, push, deploy, branch creation, issue close, roadmap edit, or unrelated cleanup was performed. Out of scope per the issue and left untouched: due-date clearing limitation (#14), image intake, unrelated Trello logic. The one live side effect outside the repository is the real test card left on the "Djonik" Trello board (`[TEST #23] Due-date wording check A`), reversible by Daniel via the Trello UI.
