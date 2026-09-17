# Issue #20 — Measurement report

**Status:** acceptance measurement complete for one real observation window. Part 1 (§1–§9) is the tooling slice. Part 2 (§10 onward) is the final Product-Owner-readable measurement.
**Date:** 2026-09-17.
**Scope:** GitHub issue #20 only. Measurement only — no session lifecycle change.

## 1. Summary

Prepared `#20` (measure real Telegram session token growth over turn count) for a real observation window using the existing `#19` per-turn telemetry.

Existing telemetry already emitted `sessionId`, `modelIterations`, `toolCalls`, `toolNames`, `memoryRead`, `skillRead`, and `verificationNudges` per turn, but the local reconciliation CLI's parser discarded all of it except `recordedAt`/`source`/`usageScope`/`usage`. The gap was in the parsing/reporting layer, not the telemetry emitter, so the fix is a minimal extension of `src/reconcileTelemetry.ts` rather than any change to `src/djonikClient.ts`, the Managed Agent, Skills, Memory, or session lifecycle.

This slice adds session-grouped, turn-indexed, content-free reporting. It does not itself contain a growth finding — that requires a real captured observation window, described in §5 below.

## 2. Was existing telemetry sufficient?

**Not quite.** The emitter (`src/djonikClient.ts`) was already sufficient and unchanged. The local reconciliation CLI's `TurnUsageRecord` type and parser were not: they validated and kept only `recordedAt`, `source`, `usageScope`, and `usage`, silently dropping `sessionId` and the rest. Without `sessionId` surviving parsing, turns from a real capture could not be grouped by session at all.

## 3. Minimal implementation

Extended `src/reconcileTelemetry.ts` only — no new file, no new framework, no database/dashboard/service:

- `TurnUsageRecord` now also parses and validates `sessionId`, `modelIterations`, `toolCalls`, `toolNames`, `memoryRead`, `skillRead`, `verificationNudges` (all already emitted by `#19`, just not previously read).
- New exported `groupTelegramTurnsBySession()`:
  - filters to `source: "telegram"`;
  - groups by `sessionId`;
  - sorts each group by `recordedAt`;
  - assigns `turnIndex = 1, 2, 3, …` per session;
  - reports per turn: `turnIndex`, `recordedAt`, `sessionId`, `modelIterations`, `toolCalls`, `toolNames`, `memoryRead`, `skillRead`, `verificationNudges`, `uncachedInputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `totalInputCompositionTokens`, `outputTokens`, `listCostAmount`, `listCostCurrency` — usage fields are `null` when a turn has no usable usage snapshot, never fabricated.
- CLI gained a `--mode session-growth` flag; default mode remains the existing `#19` `reconcile` behavior, fully backward compatible. No new npm script was needed.
- Validation stays strict, matching the existing `#19` style: a `turn_delta` record missing any of the new fields is rejected as malformed rather than defaulted, since real `djonikClient.ts` telemetry always includes them.
- `totalInputCompositionTokens` uses the same definition as the existing aggregate reconciliation report (`uncached + cache-creation + cache-read`), so per-turn and window-level numbers stay consistent.

## 4. Files changed

- `src/reconcileTelemetry.ts`
- `src/reconcileTelemetry.test.ts`

No `src/djonikClient.ts` change, no Agent/Skill/Memory/MCP/session-lifecycle change, no `package.json` change.

## 5. Exact local command for analyzing a captured Telegram log

Capture (same method as `#19`):

```powershell
$env:DJONIK_TURN_TELEMETRY = "1"
npm run telegram 2>&1 | Tee-Object -FilePath telegram-turns.log
```

Analyze by session/turn position:

```bash
npm run telemetry:reconcile -- -- --mode session-growth --file telegram-turns.log
```

Output is a JSON report: `sessionCount`, `totalTurns`, and per session an ordered `turns[]` array with the fields listed in §3, plus the existing ignored-line counters.

## 6. Proposed real observation window / minimum useful sample

Target **one continuous real Telegram process/session** — not synthetic Console prompts — since the question is turn position within the *same* live session.

Recommend collecting **at least ~8–10 natural visible turns in one uninterrupted session**, covering normal daily/weekly-planning usage rather than one-off pings, so an early cluster (turns 1–3) can be compared against a later cluster (turns ~6+) while still being able to eyeball `toolCalls`/`memoryRead`/`skillRead` per turn to separate workload growth from session-age growth (the issue's explicit confounder).

This is a practical minimum for a legible comparison, not a statistically rigorous threshold. With a real single-digit-turn sample, formal significance is not achievable, and the eventual acceptance report must say so explicitly rather than imply otherwise if the sample stays thin. Multiple natural sessions would strengthen the finding but are not required for this first slice.

## 7. Tests / checks and exact results

- `npm run typecheck` — passed, no errors.
- `npm test` — **46 passed, 0 failed** (40 pre-existing + 6 new).
  - New tests cover: grouping by `sessionId`; deterministic `turnIndex` ordering by `recordedAt` even when input is out of order; multiple sessions remain separate with independent `turnIndex` sequences; non-Telegram records excluded and missing-usage turns preserved as `null` rather than dropped or fabricated; output is content-free (exact field whitelist assertion); malformed `turn_delta` records missing `#20` metadata (e.g. pre-`#20` records without `sessionId`) are rejected; `#19` reconciliation totals are unchanged after the `TurnUsageRecord` extension.
- `git diff --check` — passed (only CRLF line-ending advisories on Windows, no actual whitespace errors).
- Manual CLI smoke test of `--mode session-growth` against a synthetic content-free log (2 sessions, 3 turns) — produced correct per-session `turnCount`, sequential `turnIndex`, and correct `totalInputCompositionTokens` math; scratch file removed afterward.

## 8. Limitations / explicitly deferred

- No real production observation window has been captured yet. This slice only prepares the tooling; the actual `#20` acceptance measurement requires running it against a real captured window per §6.
- No growth trend, MEASURED/INFERENCE finding, or compaction/rollover recommendation is made in this slice — that is the acceptance deliverable, deferred until a real window exists.
- `mcpResults` (also present in `DjonikTurnTelemetry`) was intentionally left out of the parsed/reported fields since it is not in the issue's explicit per-turn field list and was not needed for this deliverable.
- No Agent, Skill, Memory, MCP, Calendar, Trello, roadmap, issue state, deployment, commit, or push was changed.

## 9. Git status

```text
 M src/reconcileTelemetry.test.ts
 M src/reconcileTelemetry.ts
```

`git diff --stat`:

```text
 src/reconcileTelemetry.test.ts | 110 +++++++++++++++++++++++++++++++-
 src/reconcileTelemetry.ts      | 139 +++++++++++++++++++++++++++++++++++++++--
 2 files changed, 244 insertions(+), 5 deletions(-)
```

No commit, push, deploy, roadmap edit, or issue close was performed.

---

# Part 2 — Final #20 measurement (real production observation window)

**Date:** 2026-09-17. **Evidence labels:** **MEASURED** means values taken directly from the supplied real Telegram telemetry. **INFERENCE** is constrained by that evidence. Neither label is used beyond what the sample actually supports.

The existing first-slice tooling (`groupTelegramTurnsBySession` in `src/reconcileTelemetry.ts`) already represents exactly this shape of evidence — `turnIndex` per session, `modelIterations`, `toolNames`, `skillRead`, `memoryRead`, `totalInputCompositionTokens`, `outputTokens`, `listCostAmount`. The supplied real observation window did not require any new field, so **no additional instrumentation was added** and **no additional paid Managed Agent turns were run** for this report.

## 10. Observation window

- **Session:** one continuous real Telegram Managed Session, `sessionId: sesn_019JLgXxkpFKpYhcFzGh1XMh`.
- **Window:** `2026-09-17T06:57:59.940Z` through `2026-09-17T07:04:40.214Z` (approximately 6 minutes 40 seconds of real usage).
- **Sample size:** 7 natural visible Telegram turns, `turnIndex` 1–7, in this one session.

## 11. Per-turn measured data

| Turn | modelIterations | tools | skillRead | memoryRead | totalInputCompositionTokens | outputTokens | listCostAmount (¢) |
|---:|---:|---|:---:|:---:|---:|---:|---:|
| 1 | 5 | trelloSearch, trelloReadCard | true | false | 136,750 | 1,786 | 9 |
| 2 | 1 | none | false | false | 39,491 | 931 | 2 |
| 3 | 1 | none | false | false | 40,425 | 81 | 1 |
| 4 | 5 | trelloReadMember, trelloWriteCard, trelloReadCard | false | false | 210,556 | 1,829 | 7 |
| 5 | 3 | none | true | false | 137,198 | 1,950 | 5 |
| 6 | 1 | none | false | false | 47,515 | 172 | 2 |
| 7 | 1 | none | false | false | 47,706 | 202 | 1 |

## 12. Comparable-turn calculation

Turns 1, 4, 5 are excluded from the session-age comparison: each did extra model iterations and/or Trello tool calls and/or a Skill read, which the audit already established as strong independent cost drivers (`docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §5, §11). Comparing them across session position would confound workload with session age.

Turns 2, 3, 6, 7 are the comparable subset: each has exactly 1 model iteration, zero MCP/tool calls, no Skill read, no Memory read, and no verification nudge — the closest available approximation to holding workload constant.

- **Early cluster** (turns 2–3): `(39,491 + 40,425) / 2 = 39,958` average input composition.
- **Late cluster** (turns 6–7): `(47,515 + 47,706) / 2 = 47,610.5` average input composition.
- **Observed increase:** `(47,610.5 − 39,958) / 39,958 ≈ +19.15%`.
- **List cost, same clusters:** early turns 1–2¢ each; late turns 1–2¢ each — no observed shift.

## 13. Measured findings

**MEASURED:**
- Seven natural visible turns were observed in one continuous real Telegram Managed Session.
- The comparable one-iteration / no-tool / no-Skill / no-Memory subset (turns 2, 3, 6, 7) increased from an average of ~39,958 input-composition tokens early in the session to ~47,611 late in the session — approximately **+19.15%**.
- Cache-read tokens rise correspondingly within that comparable subset (from the 38,193/39,489-token range early to the 47,466/47,513-token range late), consistent with more accumulated session context being carried into later turns even when the immediate tool path is unchanged.
- List cost for the same comparable early vs. late turns stayed in the same observed 1–2 USD-cent range — no measured list-cost shift accompanied the token-composition increase.
- The largest per-turn costs in the window (turns 1, 4, 5: 9¢, 7¢, 5¢) correlate strongly with extra model iterations and/or Trello tool calls and/or a Skill read, not with turn position — consistent with the existing audit's finding (`docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §11) that tool/iteration workload, not session age, is the dominant observed cost driver.

## 14. Inference

**INFERENCE:**
- Accumulated session history appears to add a modest token-composition cost even when the immediate tool path is held comparable across turns.
- This 7-turn, single-session sample does **not** establish a statistically rigorous growth curve. Four comparable data points split into two 2-turn clusters is the practical minimum for a legible trend, not a basis for confidence intervals, curve-fitting, or extrapolation beyond this window.
- Current evidence does not show that session age creates a material **list-cost** problem over seven turns: the token-composition increase did not move the comparable turns out of their existing 1–2¢ cost band.
- Tool/iteration workload remains a much larger observed driver of per-turn cost than session position, both in this window and in the original audit (#16).

## 15. Recommendation

**Do not create a rollover/compaction/history-trimming implementation issue from this evidence alone.**

A measured token-composition growth trend (~+19% over 4 comparable turns spanning ~6.5 minutes and 7 total visible turns) exists in this one real session, but there is not yet evidence that it produces enough cost or reliability impact to justify additional session-lifecycle complexity: list cost for the comparable turns did not move, and the dominant observed cost driver in this window (as in #16) remains tool/iteration workload, not session position.

Real usage telemetry (opt-in, content-free, per #19) can continue to accumulate naturally through ordinary Telegram usage without any further deliberate collection effort for #20. Revisit session-lifecycle work only if later production evidence — accumulated the same way, without synthetic prompts — shows materially higher late-session **list cost**, latency, context pressure, or answer-quality degradation, not token-composition growth alone.

## 16. Explicitly not done in this report

- No rollover, compaction, history trimming, or other session-lifecycle behavior was implemented or proposed as immediate work.
- No additional telemetry field, log category, or instrumentation was added — the existing `#19`/first-slice tooling already represented the supplied evidence shape without modification.
- No additional paid Managed Agent turn was run to produce this report; all data above was supplied from the real production window already captured.
- No Agent, Skill, Memory, MCP, Calendar, Trello, roadmap, or issue state was changed.

## 17. Tests / checks and exact results (Part 2)

No runtime or tooling code changed for this report, so these confirm the working tree (including the preserved first-slice changes from Part 1) remains in the same verified state:

- `npm run typecheck` — passed, no errors.
- `npm test` — 46 passed, 0 failed (unchanged from Part 1: 40 pre-existing + 6 first-slice tests).
- `git diff --check` — passed (CRLF line-ending advisories only, no whitespace errors).
- `git status --short` — only the Part 1 tooling changes and this report remain uncommitted; see below.

## 18. Git status (Part 2)

```text
 M src/reconcileTelemetry.test.ts
 M src/reconcileTelemetry.ts
?? docs/07_ISSUE_20_FIRST_SLICE_REPORT.md
```

No commit, push, deploy, roadmap edit, or issue close was performed.
