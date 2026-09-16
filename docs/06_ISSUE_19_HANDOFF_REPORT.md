# Issue #19 — Source-correlated usage telemetry

**Status:** acceptance measurement complete for one defined UTC hour.  
**Date:** 2026-09-16  
**Scope:** GitHub issue #19 only.

## 1. Summary

Implemented minimal, local source-correlated usage telemetry for Djonik's Telegram adapter.

- Telegram telemetry remains opt-in through `DJONIK_TURN_TELEMETRY=1`.
- Each emitted content-free `[turn]` record now has a UTC `recordedAt` timestamp and `usageScope: "turn_delta"`.
- `usage` now means a per-visible-turn delta, not a cumulative Managed Session total.
- Added a stateless local reconciliation CLI for a UTC `[from, to)` window.
- No database, dashboard, scheduler, hosted service, custom accounting service, transcript store, or production Managed Agent configuration was added.

## 2. Native Managed Agents tagging/filtering finding

### Measured / documented fact

- The current Managed Agents Sessions API supports session `metadata` and `title`.
- Current Console session-viewer documentation says session metadata and cumulative cost are visible there.
- Current Usage and Cost Admin API documentation supports reporting grouped by workspace and description.
- Neither current official document establishes filtering or grouping Managed Agent usage/cost by a session `metadata` value or `title`.
- The installed `@anthropic-ai/sdk` version is `0.125.0`; its session-create types also expose `metadata` and `title`.

### Inference

`metadata: { source: "telegram" }` or a Telegram-specific session title could help find a session in the viewer, but is not a trustworthy source-cost reporting dimension. It was therefore not added.

### Not available / not verified

No documented native Managed Agents session tag, label, metadata, or title can currently be verified as a source dimension in Claude Console Usage/Analytics or an official Usage/Cost report for this account architecture.

## 3. Cumulative-usage finding

Official Anthropic documentation and the installed SDK types both identify `session.usage` and `session.usage` events as **cumulative session usage across all turns**.

Therefore, summing snapshots from a long-lived Telegram session would double-count earlier visible turns. The adapter keeps the latest completed cumulative snapshot only in live process memory and calculates:

```text
turn delta = current cumulative snapshot - prior completed-turn snapshot
```

- A new/reconnected session starts from a zero baseline.
- Delta includes uncached input, cache creation, cache reads, output, and `list_cost`.
- Cost is kept as an exact integer string in the API's lowest currency unit; it is never passed through binary floating point.
- Raw cumulative data is not emitted in telemetry, making it visibly wrong for the reconciliation utility to aggregate it.

## 4. Architecture/API decisions

- Kept the authoritative runtime as the existing Claude Managed Agent.
- Did not add a custom Messages API loop, session store, or conversation-history system.
- Kept channel code thin: the adapter only calculates in-memory deltas and emits telemetry when explicitly enabled.
- The reconciliation tool accepts only `usageScope: "turn_delta"`; it ignores normal logs and rejects malformed/cumulative/non-delta records.
- The optional Console comparison reports a non-Telegram remainder as an **estimate**, not exact attribution.

## 5. Files changed

- `src/djonikClient.ts`
- `src/djonikClient.test.ts`
- `src/reconcileTelemetry.ts`
- `src/reconcileTelemetry.test.ts`
- `docs/05_SOURCE_CORRELATED_USAGE_TELEMETRY.md`
- `docs/06_ISSUE_19_HANDOFF_REPORT.md`
- `package.json`

## 6. Exact reconciliation method

Enable telemetry and capture both output streams locally:

```powershell
$env:DJONIK_TURN_TELEMETRY = "1"
npm run telegram 2>&1 | Tee-Object -FilePath telegram-turns.log
```

Choose a UTC window and copy the matching Claude Console list-cost total. Then run:

```powershell
npm run telemetry:reconcile -- -- --file telegram-turns.log --from 2026-09-16T12:00:00.000Z --to 2026-09-16T18:00:00.000Z --console-list-cost 1234
```

The report returns:

- visible turns;
- measured turns and missing-usage turns;
- uncached input tokens;
- cache-creation input tokens;
- cache-read input tokens;
- total input composition;
- output tokens;
- list cost;
- optional `estimatedNonTelegramListCostAmount`.

```text
estimated non-Telegram usage = Console window total - measured Telegram total
```

The remainder can include Console, CLI, diagnostics, other callers, missing Telegram telemetry, or reporting differences. It must not be described as purely Console cost.

## 7. Tests and checks

- `npm run typecheck` — passed.
- `npm test` — passed: 38 tests passed, 0 failed.
- `git diff --check` — passed.
- Reconciliation CLI smoke test — passed.

Focused test coverage includes content-free source-explicit telemetry, deterministic timestamps, first-turn deltas, subsequent cumulative-session deltas, fresh-session baselines, exact cost delta, reconciliation/window filtering, non-Telegram exclusion, and malformed/non-telemetry handling.

## 8. Acceptance window — 2026-09-16 14:00–15:00 UTC

The reconciliation utility was run against the real local `telegram-turns.log` capture for:

```text
[2026-09-16T14:00:00.000Z, 2026-09-16T15:00:00.000Z)
```

It returned two measured Telegram turns and no missing usage snapshots.

### Measured Telegram totals

| Metric | Total |
|---|---:|
| Visible turns | 2 |
| Uncached input tokens | 20 |
| Cache-creation input tokens | 29,759 |
| Cache-read input tokens | 235,659 |
| Input composition | **265,438** |
| Output tokens | **1,777** |
| List cost | **14 USD cents ($0.14)** |

### Measured Console totals

The independent Claude Console API token-usage export for the same full hour has exactly one Managed Agents / `claude-sonnet-5` row:

| Console field | Total |
|---|---:|
| `usage_input_tokens_no_cache` | 20 |
| `usage_input_tokens_cache_write_5m` | 29,759 |
| `usage_input_tokens_cache_write_1h` | 0 |
| `usage_input_tokens_cache_read` | 235,659 |
| Input composition | **265,438** |
| `usage_output_tokens` | **1,777** |

The Console Managed Session viewer independently displayed approximately `20` input tokens, `236k` cache reads, `29.8k` cache writes, `1.8k` output tokens, and `$0.14` cost for the Telegram session; the rounded display agrees with the exact local values.

### Reconciliation conclusion

**Measured:** Console and Telegram telemetry both total **265,438 input-composition tokens** and **1,777 output tokens**. The measured non-Telegram token remainder for this exported hour is therefore exactly **0 tokens**.

**Inference / estimate:** estimated non-Telegram list-cost remainder is **$0.00** (`$0.14` session viewer cost minus `$0.14` local telemetry). This remains an estimate rather than an independently measured Console Cost API remainder because the supplied hourly Console export has no cost column. The exact token match and independent session-cost display strongly support it.

This validates the reconciliation method for this defined recent window only; it does not prove that every future hour has the same attribution result.

## 9. Limitations / explicitly deferred

- No automatic historical recovery is possible for turns captured before telemetry was enabled.
- No native Console/API source grouping by session metadata/title is verified.
- No database, dashboard, recurring export, or scheduled job was created.
- No Agent, Skill, Memory, MCP, Calendar, Trello, roadmap, issue state, deployment, commit, or push was changed.

## 10. Git status

```text
 M package.json
 M src/djonikClient.test.ts
 M src/djonikClient.ts
?? docs/05_SOURCE_CORRELATED_USAGE_TELEMETRY.md
?? docs/06_ISSUE_19_HANDOFF_REPORT.md
?? src/reconcileTelemetry.test.ts
?? src/reconcileTelemetry.ts
```
