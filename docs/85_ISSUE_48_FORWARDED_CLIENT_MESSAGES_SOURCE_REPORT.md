# #48 — Forwarded client messages: source and offline validation report

2026-09-28. Implementation Engineer. **Source-only candidate for Product Lead review.** No commit, branch, push, deployment, Agent/Skill/Session remote change, production Trello or Memory write, paid inference, or paid benchmark run occurred. Canonical NOW remains #48.

## 1. Summary

Telegram forwards now carry Telegram-provided attribution through the existing ordered grouping path. A grouped forward is one read-only Managed Agent turn. A forwarded or status-change proposal ending in `✅ Внести` / `✏️ Змінити` gets one compact keyboard. A process-local binding ties confirmation to the exact latest bot message for that chat and user; typed short acceptance uses the same binding. A new forward, a correction, expiry, a consumed click, restart, or a different message id makes an old button stale. The later acceptance becomes one ordinary human-authority turn; #31 still verifies each Trello mutation independently.

Native checklist `create` and `add_item` have a source-level permission and readback path. Skills cover proposal shaping, exact target/project resolution, links, commitments, Size limitation, and status reports. The existing unresolved next-release candidate carries the changed Skills and checklist permission. This is not a live or behavioral acceptance claim.

## 2. Files changed

- Forwarding and Telegram: `src/forwardedSource.ts`, `src/messageGrouping.ts`, `src/telegramCli.ts`, `src/telegramDispatch.ts`, `src/proposalConfirmation.ts`, `src/turnAuthority.ts`.
- Permissions, verification and memory: `src/djonikClient.ts`, `src/toolConfirmation.ts`, `src/trelloMutationLedger.ts`.
- Source instructions and release intent: `.claude/skills/studio-intake/SKILL.md`, `.claude/skills/task-management/SKILL.md`, `.claude/skills/planning-and-focus/SKILL.md`, `src/release.ts`.
- Evaluation: `src/pmBenchmark.ts`, `src/pmClaimLint.ts`, and the related/new tests (`src/forwardedSource.test.ts`, `src/forwardedDispatch.test.ts`, `src/proposalConfirmation.test.ts`, `src/trelloChecklistLedger.test.ts`, `src/trelloMutationLedger.test.ts`, `src/toolConfirmation.test.ts`, `src/commitmentContract.test.ts`, `src/skills.test.ts`, `src/planningAndFocus.test.ts`, `src/release.test.ts`, `src/releaseR29.test.ts`, `src/releaseR30Candidate.test.ts`, `src/pmBenchmark.test.ts`).
- This report.

## 3. Final architecture and ownership

`studio-intake` derives the one proposal from ordered source material: useful title/context, concrete checklist candidates, exact relevant URLs, exact commitment quote, attribution, and `❓ тобі` versus `❓ клієнту`. Vague wording remains a question. `task-management` owns fresh board snapshot for broad resolution, direct card/checklist reads for exact targets, Inbox plus existing project-label flow for a new card, mutation intent and verified writes. `planning-and-focus` owns what enters the working plan and asks `скільки даємо? S / M / L або години` once in that context when Size is absent. No new Skill, board mirror, transaction service or second grouping system was added.

The current Trello MCP metadata exposes `trelloWriteChecklist create(cardId,name)` returning a checklist id, `add_item(checklistId,text)` returning an item id, and `trelloReadChecklist list_by_card(cardId)` / `get(checklistId)` with complete embedded items. `trelloWriteCard` exposes `move(cardId,listId)` and no Custom Field write. These are schema facts, not live result-shape validation for this patch.

## 4. Forwarded-message and source attribution model

`forwardedSourceOf` reads Telegram `forward_origin` and legacy forward fields. It keeps a sender/display name and source timestamp when supplied by Telegram. Hidden/absent sender becomes `null` and is shown as `невідомо`; wording inside the forwarded message never establishes sender identity. Each forwarded fragment gets its own source boundary and remains in Telegram message-id order alongside its image, PDF and caption. Any grouped intake containing a forward is `forwarded_source`, hence read-only even if it also contains non-forwarded text. Daniel's later acceptance is a separate turn.

The source wrapper explicitly labels forwarded words as data, not Daniel's command. The model still interprets that data for a proposal; source interpretation and quote fidelity need behavioral validation.

## 5. Proposal → confirmation → write lifecycle

The first forwarded turn can read and propose but its `forwarded_source` authority denies gated Trello and Memory writes. A proposal reply ending with both visible actions receives a random reference and Telegram message id; this same format also binds a status-change proposal. The registry holds the latest proposal per chat/user for 30 minutes, entirely in process. A new forwarded update invalidates the prior proposal immediately, including during buffering. `✅` requires reference, chat/user and exact message id; typed `внести`/`так, внеси` requires one current proposal. `✏️` or ordinary intervening text enters revision rather than applying the old proposal. Stale/unknown confirmations produce a visible decline.

Acceptance passes the exact proposal text to one human-authority Session turn with an instruction to re-read targets, execute only unambiguous approved changes, verify each write, and distinguish confirmed/unconfirmed/failed results. Existing `always_ask` server confirmations remain internal per reviewed tool call; Daniel gives one proposal confirmation in Telegram. The batch is not atomic. #31 and #40 retain per-tool-use correlation and replay behavior. On ambiguity, the Skill requires one useful question and zero writes.

## 6. Checklist verification model

The unresolved candidate enables `trelloWriteChecklist`; `toolConfirmation` permits only its `create` and `add_item` actions on a human turn. `update`, `update_item`, missing/unknown actions and autonomous turns are denied. Checklist write results supply identity only. The ledger requires a later successful `trelloReadChecklist list_by_card` for the requested card and created checklist id/name, or `get` for the requested checklist and created item id/text. Pre-write reads, wrong targets, missing ids, errors and malformed/incomplete reads do not verify. Each item has its own outcome; a successful sibling does not make a failed item successful. Checklist writes are not eligible for the card-read nudge. Live provider payload shape remains unmeasured for this candidate.

## 7. Commitment quote and provenance model

The #34 Memory record gains `source_sender` and `source_quote`; `project`, `card`, `status`, `accepted` and the prior lifecycle remain. An exact relevant quote and sender/`unknown` are written only after Daniel explicitly accepts the proposed commitment. The entire forwarded transcript is not stored, and client text cannot instruct Memory writes. The acceptance is distinct from an internal Trello due. Fresh Trello remains authoritative for current task state. The Memory attachment instruction is 4,088 UTF-8 bytes, below its 4,096-byte limit. Offline tests prove the source contract, not actual model compliance or remote Memory persistence.

## 8. Size-write capability decision

The active `trelloWriteCard` schema has no Custom Field input, and no reviewed Trello MCP write exposes `Size`. The Skill asks Daniel once when an unsized task really enters the working plan, but does not claim the answer was saved to `Size`. The value can guide the current conversation; durable card persistence is deferred until a reviewed write primitive with idempotency and post-write verification exists. No description pseudo-field or custom side-effecting REST tool was added.

## 9. Status reports and wrong-Done recovery

Task-management resolves the exact card from current evidence. A report such as `я доробив`, `відправив на фідбек`, or a client date change is a proposed change unless Daniel explicitly requests the safe action. Two plausible cards mean one question and zero writes. Done uses `trelloWriteCard move` to the Done list only after confirmation, followed by a direct card read; `mark_done` is excluded by the Skill because its completion flag has no exposed reversal. If a Done move was wrong and the intended prior list is known from a fresh read or Daniel, a second `move` back is separately verified. If that destination is unknown, recovery asks and performs zero writes. An offline ledger test proves the two move postconditions; no live wrong-Done exercise occurred. After a verified state change, planning-and-focus supplies the next useful PM step.

## 10. Benchmark integration

S1–S16 remain in order. S17–S21 cover an attributed forwarded deadline, `зробіть яскравіше`, two plausible Azov banner targets, a forwarded ТЗ URL, and an ambiguous status report. The fixture already has the relevant Extract card and two banner candidates; the new scenarios use the existing `zero_write`, factual source-aware and rubric paths. Forwarded claim evidence is a distinct source. The benchmark revision is `pm-quality-2`. No paid run occurred, so no behavioral `pass^3` is claimed. The benchmark uses a read-only Memory fixture; acceptance/write behavior is covered by offline architecture tests rather than a paid scenario here.

## 11. Release boundary and r29 immutability

`SERVING_RELEASE` remains r29 / Agent v29. Historical r25–r29 definitions, tuples and pins are unchanged. The pre-existing unresolved `RELEASE_R30_CANDIDATE` now also marks `task-management` and `studio-intake` unresolved, keeps #47's snapshot, planning Skill changes and Calendar MCP removal, and adds only the checklist tool/confirmation requirement. No Agent v30, remote Skill id/version or Session id was invented. `reminder` stays dormant. Release tests compare the serving release against its recorded historical hashes and check candidate-only changes.

## 12. Exact checks and results

- `npm run typecheck`: passed.
- `npm run build`: passed (local `dist` write required sandbox escalation; no network/remote action).
- Focused forwarding/grouping/checklist batch: 49/49 passed before the final two added contract tests; the later skills/ledger focused batch passed 156/156. Earlier release/permission/Skill focused batch passed 159/159.
- `npm test`: final full suite 1,199/1,201 passed. The only failures were the documented Windows baseline cases in `src/deployConfig.test.ts` (CRLF shell-script assertion) and `src/processExit.test.ts` (child exit code 1 versus 78). Those tests and `deploy/deploy.sh` have no diff; docs/83 and docs/84 recorded the same two failures.
- `git diff --check`: passed.
- `git status --short`: below. No production or paid validation was run.

## 13. Limitations and deferred live evidence

The proposal's quality, exact quote selection, link deduplication and ambiguity handling are Skill/model behavior; static tests cannot establish real response quality. The proposal registry is deliberately process-local: restart invalidates pending buttons, and a queued but not yet processed proposal does not survive a crash. It is not a durable transaction. The checklist ledger is fail-closed against unknown response shapes, but needs one later isolated provider-result readback check before promotion. Size cannot currently be persisted to the real Custom Field. The new benchmark scenarios have not been run with paid inference. A status recovery requires a known intended destination list; it cannot undo an unknown historical list or reverse `mark_done`.

## 14. `git status --short`

```text
 M .claude/skills/planning-and-focus/SKILL.md
 M .claude/skills/studio-intake/SKILL.md
 M .claude/skills/task-management/SKILL.md
 M src/commitmentContract.test.ts
 M src/djonikClient.ts
 M src/messageGrouping.ts
 M src/planningAndFocus.test.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmClaimLint.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR29.test.ts
 M src/releaseR30Candidate.test.ts
 M src/skills.test.ts
 M src/telegramCli.ts
 M src/telegramDispatch.ts
 M src/toolConfirmation.test.ts
 M src/toolConfirmation.ts
 M src/trelloMutationLedger.test.ts
 M src/trelloMutationLedger.ts
 M src/turnAuthority.ts
?? docs/85_ISSUE_48_FORWARDED_CLIENT_MESSAGES_SOURCE_REPORT.md
?? src/forwardedDispatch.test.ts
?? src/forwardedSource.test.ts
?? src/forwardedSource.ts
?? src/proposalConfirmation.test.ts
?? src/proposalConfirmation.ts
?? src/trelloChecklistLedger.test.ts
```
