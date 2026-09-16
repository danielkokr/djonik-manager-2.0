# Source-correlated usage telemetry (#19)

## Product Owner report — implementation status (2026-09-16)

**Implemented:** content-free, opt-in Telegram turn telemetry now reports a UTC timestamp and a per-visible-turn usage delta. A local, stateless reconciliation command aggregates those records for a named UTC `[from, to)` window.

**Acceptance measurement completed:** a real Telegram capture and an independent Console token-usage export reconcile exactly for the UTC hour `[2026-09-16T14:00:00.000Z, 2026-09-16T15:00:00.000Z)`. This validates this defined window and the method; it does not establish attribution for future windows.

**No production configuration changed:** this work does not change the Managed Agent, Agent version/configuration, Skills, Memory, MCP, Calendar, Trello surface, or session lifecycle. It adds no database, dashboard, hosted service, scheduled job, or transcript store.

## Evidence and native-source-tagging investigation

### Measured / documented fact

- The current official [Managed Agents Sessions API](https://platform.claude.com/docs/en/api/beta/sessions) calls `session.usage` “cumulative token usage for a session across all turns.” The current [event-stream documentation](https://platform.claude.com/docs/en/managed-agents/events-and-streaming) likewise calls `session.usage` a cumulative snapshot and states that the idle-transition event arrives immediately before the session becomes idle.
- Installed `@anthropic-ai/sdk` `0.125.0` types confirm the same: `BetaManagedAgentsSessionUsage` is documented as cumulative across all turns and `BetaManagedAgentsSessionUsageEvent` as a periodic cumulative snapshot.
- The current session-create API and installed SDK support `metadata` (up to 16 string pairs) and a human-readable `title`. The current Console session viewer documents that it shows session metadata and cumulative cost.
- The current official [Usage and Cost Admin API documentation](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) documents aggregate grouping by workspace and description; it does not document grouping or filtering usage/cost by Managed Agent session `metadata` or `title`. It also requires Admin API credentials and is unavailable to individual accounts.

### Inference

A `metadata: { source: "telegram" }` value or Telegram-specific session title would be useful for finding a session in the session viewer, but is not a trustworthy source-cost dimension for this issue: the documented Console/official reporting surfaces do not establish that usage or cost can be grouped or filtered by either field. This implementation therefore does not add metadata or title just to create an unreportable label.

### Not available / not verified

No current official documentation found for a Managed Agents session-level tag, label, metadata, or title that can be used to filter/group Claude Console Usage/Analytics or an official Usage/Cost report by Telegram versus diagnostic traffic. No account-specific Admin API entitlement was assumed or exercised.

## Why the emitted usage is a delta

Long-lived Telegram Sessions intentionally preserve conversation continuity. Their `session.usage` snapshots are cumulative, so summing the snapshot after turn 1 and the snapshot after turn 2 would bill turn 1 twice.

`src/djonikClient.ts` now keeps the most recently completed cumulative snapshot in memory for that live session only. At the end of each visible turn it emits:

`turn delta = current cumulative session usage − prior completed-turn cumulative usage`

The first turn of a newly created/reconnected session uses a zero baseline. A new session has its own zero baseline. The code calculates input tokens, cache-creation tokens, cache-read tokens, output tokens, and `list_cost.amount`; cost remains an integer string in the API's lowest currency unit, so it is never converted through binary floating point.

The emitted record sets `usageScope: "turn_delta"`. The reconciliation command refuses records without exactly that value, including older cumulative-only records. Raw cumulative snapshots stay only in the live adapter state used to form the next delta; they are not emitted as telemetry.

Telemetry records remain content-free: they contain no user or assistant message text, Memory contents, MCP input/result payloads, secrets, or file paths.

## Capture and reconcile a real Telegram window

1. Start the Telegram adapter with telemetry enabled and capture **stderr** locally. In PowerShell:

   ```powershell
   $env:DJONIK_TURN_TELEMETRY = "1"
   npm run telegram 2>&1 | Tee-Object -FilePath telegram-turns.log
   ```

   Keep the capture running for the chosen real-usage window. Each completed visible turn writes one `[turn] {json}` record. Stop it after the window; do not edit those lines. The reconciliation tool also accepts PowerShell's `node.exe :` stderr prefix, display wrapping, and UTF-16 LE `Tee-Object` capture files.

2. Choose exact UTC boundaries, for example `[2026-09-16T12:00:00.000Z, 2026-09-16T18:00:00.000Z)`. In Claude Console Usage/Cost, copy the Console total for that same UTC window and use the same list-cost unit/currency that the session telemetry reports (currently USD cents).

3. Reconcile the locally captured file. The command ignores normal log lines and all non-Telegram records:

   ```powershell
   npm run telemetry:reconcile -- -- --file telegram-turns.log --from 2026-09-16T12:00:00.000Z --to 2026-09-16T18:00:00.000Z --console-list-cost 1234
   ```

   Omit `--file` to read piped log lines from stdin. Omit `--console-list-cost` when only the measured Telegram total is available.

4. Read the JSON report. It gives visible turns, uncached input, cache-creation input, cache-read input, total input composition, output tokens, and exact list cost. `usageMeasuredTurns < visibleTurns` means the window is incomplete because one or more turns had no usable usage snapshot; do not treat its cost total as complete.

## Console comparison and limitation

When `--console-list-cost` is supplied, the report computes:

`estimated non-Telegram usage = Console window list cost − measured Telegram list cost`

This is explicitly an **estimate**, not source attribution. The remainder can include Console work, CLI diagnostic work, another adapter/API caller, missing Telegram telemetry, reporting-timing differences, or other traffic in the same Console window. A negative remainder is an evident reconciliation mismatch to investigate, not evidence of negative cost.

The utility is intentionally local and stateless: it consumes logs, prints one aggregate, and stores nothing. It does not recover turns from before telemetry was enabled, and it does not replace Anthropic billing/reports.

## Real acceptance example — 2026-09-16 14:00–15:00 UTC

The local reconciliation utility was run against the real PowerShell `telegram-turns.log` capture:

```text
visibleTurns:                 2
uncachedInputTokens:         20
cacheCreationInputTokens:    29,759
cacheReadInputTokens:        235,659
totalInputCompositionTokens: 265,438
outputTokens:                1,777
listCostAmount:              14 USD cents ($0.14)
```

### Measured

- The two Telegram turn-delta records total **265,438 input-composition tokens**, **1,777 output tokens**, and **$0.14 list cost**.
- The independent Claude Console API token-usage export for the whole hour reports `20` uncached input + `29,759` 5-minute cache write + `0` 1-hour cache write + `235,659` cache read = **265,438 input-composition tokens**, plus **1,777 output tokens**.
- The measured non-Telegram **token** remainder in that exported hour is exactly **0 tokens**.
- The Console Managed Session viewer shows `$0.14` for the Telegram session, agreeing with the exact local telemetry after viewer rounding.

### Inference / estimate

The estimated non-Telegram **list-cost** remainder is **$0.00**. This is an estimate, rather than an independently measured Console Cost API remainder: the supplied hourly Console export contains token fields but no cost column. The exact token match and the independently displayed session cost strongly support the estimate.
