# #52 — Feedback → approved working-style rules: source report

2026-09-28. Implementation Engineer. Canonical NOW: [GitHub #52](https://github.com/danielkokr/djonik-manager-2.0/issues/52), no comments. **Source and offline validation only; Product Lead review pending. #52 is not complete.**

## 1. Summary

Feedback changes the current conversation immediately. Only Daniel's explicit `запамʼятай` or approval of one context-bound offer permits a durable rule. `working-style.md` is the sole new-rule target. No production Memory, Trello, Agent, Session, remote Skill, branch, commit, push or deploy was changed.

## 2. Existing Memory discovery

`docs/33` §15 documents an **authorized 2026-09-23 cleanup** of `/preferences.md`: the read-back then contained two approved preferences, concise daily PM updates and no work disturbance after 20:00 unless urgent. It removed a test snack, stale day plan, Trello due, Extract-specific tone (moved to the Extract brief) and a conflicting absolute priority tie-break. `docs/88` §2 says later source shows model writes to `working-style.md`, but did not read its live content. Therefore neither file's **current** production content, versions or conflict state is established by this pass. The older noisy content is historical evidence, not a claimed live diff.

## 3. Canonical owner and feedback semantics

`planning-and-focus` owns applying corrections, judging general versus one-off feedback, a single remember offer, and approved writes. `pm-rhythm` owns Friday's small review question. Session Memory instructions name the single file and authority boundary. No new Skill, classifier, correction log or store was introduced.

`сьогодні Extract не чіпаю` changes today's plan only. `не вигадуй дедлайни` is a quality/factual correction, not a personal rule. `надалі`, `зазвичай` and clear general preferences are plausible durable candidates; Claude judges the meaning rather than routing on a regex. A correction applies now even if Daniel declines or ignores a Memory offer.

## 4. Offer, acceptance and correction

At most one short offer occurs in a conversation, and an ignored offer is not repeated. An explicit `запамʼятай` skips the question. Only a yes bound to the pending proposal writes; a stale unrelated yes does not. No means zero write. Daniel's rewording replaces the proposal. A successful Memory write is required before saying it was saved. A corrected rule replaces its conflicting old line while unrelated lines survive.

The target has only `# Спілкування` and `# Робота`, one concise line per active rule with `(сказав/прийняв Daniel, YYYY-MM-DD)`. The date comes from the adapter clock; no guessed date. If the clock is unavailable, no date is fabricated. About 15 active rules is a maintenance target: merge equivalents and remove superseded, expired or re-derivable facts; ask Daniel when a real conflict cannot be resolved safely. Relative expiry must become an absolute date from authoritative clock context before storage, or be clarified.

## 5. Legacy migration: future authorized operation

The future one-time operation must read both live files and their current versions, identify approved nonconflicting durable lines, route notification timing to `/rhythm.md`, and drop test noise, stale plans, task status, re-derivable facts and superseded lines. Normalize only surviving Daniel-approved working and communication preferences into `working-style.md`, verify its resulting content and versions, then retire/stop reading `preferences.md`. Do not use startup/deploy migration. The exact 2026-09-23 two-line `preferences.md` snapshot can guide questions but **cannot authorize a present-day diff**. The 20:00 contact boundary is rhythm configuration, so it must not be copied as a working-style line. The concise-update preference may survive if the current live files still support it and no newer rule supersedes it. No production migration was attempted.

The synthetic fixture in `src/workingStyle.test.ts` demonstrates preserving a durable morning-concepts rule, merging a duplicate main-priority rule, replacing a conflicting response-detail rule, and dropping a day plan, task state, vague relative expiry and test noise. It has one output target and proves section/provenance shape. It is **not** a production Memory snapshot or automatic merge implementation.

## 6. Other truth owners

`/rhythm.md` owns morning/review times, quiet hours, `work_hours`, mutes and exception settings; an evening aversion to complex conceptual work can be a separate working preference. `projects/<slug>.md` owns client contacts, approval patterns and project facts. Trello owns current card state; accepted plans have their existing owner. The monthly review distinguishes durable rules, dated/expired rules and facts these sources can re-derive. Cleanup still needs Daniel's later approval.

## 7. Monthly cadence and autonomous safety

The existing rhythm state now carries optional `workingStyleReviewMonth: YYYY-MM`, a content-free marker that survives the 21-day delivery-record retention. A Friday review with an absent marker establishes a baseline **without asking**, because an older month's prompt may have been pruned. The first eligible Friday in a later calendar month claims the marker before the model turn and includes the due instruction. Other Fridays have no style-review instruction. A failed, retried or ambiguous delivery cannot cause a second prompt in that month; a crash before the turn fails safe by skipping the month. This trades a possible missed review for the required maximum of one. The automatic turn reads and proposes only; the existing read-only boundary still blocks Memory writes.

## 8. Engineering feedback channel

A recurring `не вигадуй`, invented due or wrong priority belongs to the reviewed PM benchmark development loop, not `working-style.md`. Daniel/Product Lead/developer may select at most **1–2 high-value candidate scenarios per week** from observed failures, with an explicit source fixture/code review in normal development. No production ingestion, event log, automatic benchmark edit, transcript mining or prompt self-edit was added. `src/pmBenchmark.ts` remains the scenario owner; this report records the review workflow.

## 9. Memory instruction budget and API/release boundary

Before #52: 4,026 UTF-16 characters / 4,079 UTF-8 bytes (`docs/88` §14). After #52: **4,012 characters / 4,065 bytes**, below the existing 4,096-byte safety bound. The opening paragraph was shortened: explicit acceptance, no live task/transient content, fresh-tool precedence, supersession and card identity remain. The `working-style.md` sentence now states approval, clock date/source, conflict replacement and no `preferences.md` writes. The accepted commitment/profile clauses remain. The current SDK's Session Memory instruction cap is the existing architectural basis; no API redesign was needed.

`SERVING_RELEASE` remains r29; r25–r29 tuples are unchanged. The same `RELEASE_R30_CANDIDATE` still has Agent version `null` and unresolved local Skills, now including #52 in their unresolved reason. No r31, Agent version or remote IDs exist. This app revision's Memory instructions and monthly prompt depend on r30-only Skill semantics; **do not deploy it under r29**.

## 10. Benchmark S31–S40

S1–S30 scenario meanings and fixtures remain intact. `pm-quality-5` adds: lasting rule (S31), one-off frame (S32), quality correction (S33), second offer (S34), acceptance/conflict (S35), due and nondue Fridays (S36–S37), explicit remember (S38), rejection (S39), and rewording (S40). First-turn checks now score the pre-approval offer and zero write; final-turn checks inspect the written Memory path. The November Friday scenarios carry matching per-scenario adapter clocks. S31–S40 fixtures use synthetic `working-style.md` content; S35 begins with a conflicting rule. The future live benchmark uses only a separately verified eval Memory store with read/write access for S31–S40. No paid run occurred. Mechanical checks are screening, not semantic proof that the model applied or replaced the correct rule; that needs reviewed Memory read-back and behavioral scoring.

## 11. Tests and exact results

- Focused eight files: **168 passed, 0 failed**.
- `npm run typecheck`: pass. `npm run build`: pass.
- `npm test`: **1,325 passed, 2 failed**, exactly the existing Windows baseline failures `deployConfig.test.ts` (CRLF shell-script assertion) and `processExit.test.ts` (expected exit 78, actual 1). An earlier concurrent full run also had a transient `reminderDelivery.test.ts` timing failure; isolated rerun passed **21/21**, and the subsequent full run had only the two baseline failures.
- `npm run benchmark:pm -- --offline --mode critical --release r30-candidate --output <temp file>`: executed; fake candidate/grader simulation only, no behavioral or pass^3 claim. The first invocation without `--release`/`--output` exited before a run with the CLI's required-option message.
- `git diff --check`: pass. `git status --short`: see §12.

No manual Console, Telegram or production Memory smoke was authorized or performed. Future authorized work must read both live Memory files, review the exact merge with Daniel, perform and verify one-time migration, resolve the r30 candidate, and run any separately authorized behavioral validation. The source pass does not close #52.

## 12. `git status --short`

Recorded after source edits and before handoff; no unrelated changes were present at start:

```text
 M .claude/skills/planning-and-focus/SKILL.md
 M .claude/skills/pm-rhythm/SKILL.md
 M src/clientProfile.test.ts
 M src/commitmentContract.test.ts
 M src/djonikClient.ts
 M src/planningAndFocus.test.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmBenchmarkCli.ts
 M src/pmFixture.ts
 M src/release.ts
 M src/rhythmRunner.test.ts
 M src/rhythmRunner.ts
 M src/rhythmState.ts
?? docs/89_ISSUE_52_WORKING_STYLE_FEEDBACK_SOURCE_REPORT.md
?? src/workingStyle.test.ts
```
