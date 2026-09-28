# #47 — read-only Trello board snapshot: source report

Date: 2026-09-28. Canonical NOW: [#47](https://github.com/danielkokr/djonik-manager-2.0/issues/47), no issue comments at implementation time. Source and offline fixtures only. No commit, push, branch, deploy, Agent/Skill sync, Session, paid inference, or production Trello/Memory mutation.

## Summary and files

`trello_board_snapshot` is a fresh, read-only factual projection for planning. Claude receives current board facts; it still chooses priorities and writes the answer. `src/trelloBoardSnapshot.ts` owns strict projection and compact JSON. `src/trelloWorkHistory.ts` adds three GET reads through the existing read-token client. `src/rhythmFacts.ts` remains the shared project/list/due/list-entry calculation and now recognizes a latest move out of Done as reopen evidence. `src/djonikClient.ts`, `src/releaseAttestation.ts`, and `src/decisionTrace.ts` wire the tool and content-free trace into the existing #40/#53 Session lifecycle. The two planning Skills prefer the snapshot for board-wide current state. `src/pmBenchmark.ts` requires an observed successful snapshot for S3/S8/S10 to be evaluable; `src/pmBenchmarkCli.ts` pins the future eval snapshot to its dedicated board and separate read token. `src/release.ts` and `src/releasePlan.ts` define an unresolved next-release candidate and the full-replacement Calendar removal. Focused tests cover these changes; r29 source-lockstep tests now distinguish its historical Skill hashes from the new unsynced source.

## Snapshot data contract

The model-facing JSON contains `board`, a Kyiv `snapshotAt`, `timeZone`, and per-list `{name, role, count, cards?, omitted?}`. Listed cards contain stable id, name, project slug or `не вказано`, `daysInList` number or `невідомо`, Kyiv weekday/date/time due or `не вказано`, `dueComplete`, Size value or `не вказано`, and checklist `completed/total` or `немає`. Normal mode collapses Inbox/Backlog to counts; detailed mode exposes at most 40 cards, listing active work before queue cards and counting omissions. Open Done cards and closed cards are excluded. No activity timestamp, raw action, checklist prose, score, stored snapshot, or model assessment enters the result. More than 40 non-queue active cards, malformed required source data, or a result above 16 KiB returns a bounded error rather than a silently partial planning view.

The 30-card representative planning fixture serializes to **6,421 UTF-8 bytes** (fixture with ordinary names and Size values), below the 10 KB target. This is payload size, not a measured live turn or a production Trello board claim.

## Reads and epistemic semantics

The existing `TRELLO_API_KEY` + `TRELLO_READ_TOKEN` OAuth header is reused. All added calls are GET: board open cards with explicit `customFieldItems` and `idChecklists`, board Custom Field definitions, and checklist details for cards with checklist IDs. Existing list and latest list-entry action reads are reused. No write token is used. The source shape follows [Trello Custom Fields](https://developer.atlassian.com/cloud/trello/guides/rest-api/getting-started-with-custom-fields/) and [Trello card checklist APIs](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/).

`Size` resolves by the unique board field named `Size`; list option IDs resolve to their option text, and text/number values are also accepted. No value means `не вказано`; duplicate definitions/items, unknown option IDs, malformed values, or unavailable definitions fail. Checklist progress counts Trello `complete` states across all retrieved checklist items. `idChecklists: []` means `немає`; a missing field, missing checklist, failed request, or malformed state fails. Due `null` is `не вказано`; malformed or timezone-less due fails. A zero project label is explicit absence; ambiguous named labels fail rather than pretending there is no project.

Days in current list use the latest authoritative list-changing card action and the same `buildSignalFacts` mapping as Working Rhythm. The action must identify the card and list; an entry that disagrees with current `idList` yields `невідомо`. No action likewise yields `невідомо`; neither card creation ID nor activity time is used as a substitute. A latest move from Done establishes reopen time. The duration is Kyiv calendar-day difference, tested across DST. Due is rendered deterministically with Kyiv weekday and local clock time. An error fetching action or malformed action fails; an authoritative empty action list establishes only that age is unknown.

## Runtime, Skills and benchmark

The #40 Session-scoped custom-tool lifecycle admits `trello_board_snapshot` and still executes a repeated `custom_tool_use_id` once. Autonomous rhythm authority can read it. The default executor catches all errors and returns one bounded, credential-free failure message. `trello_work_history` exact relay and dormant side-effecting `reminder` authority are unchanged. `DecisionTrace` records `custom:trello_board_snapshot` and SHA-256 of the successful exact model-facing result only after provider submission/resolution; it stores no result text or card name. Existing telemetry fields remain optional/backward-compatible.

`planning-and-focus` uses the snapshot for board context and one-card MCP detail only when needed. `pm-rhythm` uses it for current board facts, retaining `trello_work_history` for Friday retrospective facts. The approved Waiting age line is allowed only from a current snapshot or code hint establishing at least three days in Waiting; age alone is not an exception signal. S3 Size, S8 checklist, and S10 Waiting-age fixtures existed in #46. The runner now marks them `not_evaluable` when the scored turn lacks the snapshot tool name or digest. The future live eval runner requires `TRELLO_EVAL_READ_TOKEN`, resolves only its explicit eval board ID, and routes both custom Trello reads through that reader; it has no fallback to production credentials. No rubric or model prompt was changed. These offline contract checks are not behavioural pass^3 evidence.

Skill source economy (LF-normalized UTF-8): `planning-and-focus` **11,107 → 11,863 B** (+756 B); `pm-rhythm` **13,851 → 14,241 B** (+390 B). The coordinator prompt has no diff.

## Release boundary and deferred work

The serving `RELEASE_R29`, its Agent v29 pin, r25–r29 Calendar arrays/toolsets, custom tools, and all reviewed rollback semantics remain unchanged. `RELEASE_R30_CANDIDATE` is unresolved and cannot serve. It describes exactly the existing r29 surface plus `trello_board_snapshot`, two unsynced changed Skill versions, and removal of the disabled Calendar server/toolset. `buildCandidateUpdateBody` includes a full replacement `mcp_servers` array only when that candidate changes the servers, consistent with [Anthropic's Agent update contract](https://platform.claude.com/docs/en/api/beta/agents/update). No remote Skill, Agent version, or Session identifier is invented. Later release work must sync reviewed Skill bytes, resolve real pins, create/read back a new Agent version under separate authorization, and attest a serving Session. No such action occurred here.

## Offline checks

- Snapshot tests: **9/9 passed**; representative result 6,421 bytes. Includes partial failure, ambiguous Size, checklist completion/absence/failure, reopen, Waiting age, Kyiv DST, collapsed/detailed projection, GET-only HTTP, eval board pinning, and safe error text.
- Focused runtime/source tests: `turnTrace`, `customToolResolution`, `decisionTrace`, release candidate/r29, Skills, rhythm, and benchmark tests passed after source expectations were updated.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: final full run **1,183/1,185 passed; two unchanged Windows baseline failures** in `deployConfig.test.ts` (CRLF shell-script assertion) and `processExit.test.ts` (child process exit-code mismatch). Neither implementation nor test target was edited. Timing-sensitive `messageGrouping` and `reminderDelivery` tests each failed once in separate concurrent full runs, passed alone, and were absent from the final full-run failures.
- `git diff --check`: passed. No manual production smoke or paid benchmark was run.

Later measurement remains necessary for real planning-turn payload size/tool-call reduction and S3/S8/S10 behavioural results. The dedicated eval board must have an actual established Waiting-entry age for S10; fixture reset refuses to invent it.
The production board's actual `Size` definition/type was not read in this source-only pass; official Trello list option IDs and the repository's text-field eval convention are both supported, with unknown forms failing safely.
