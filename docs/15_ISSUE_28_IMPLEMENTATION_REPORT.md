# Issue #28 implementation report — Wave C1: Evidence-based project health review

> **Scope:** repository discovery, a bounded source-only Skill, deterministic semantic tests, and this report. No paid Managed Agent Session, live Trello call or mutation, production Agent/Skill sync, commit, push, deploy, roadmap edit, or issue update was performed.

## 1. Summary

Implemented the smallest Claude-native slice: `.claude/skills/project-health/SKILL.md`. It instructs Djonik to make a concise, single-project PM interpretation from fresh Trello reads, distinguish waiting from blocked, explain risk, and recommend one next PM step. It is explicitly read-only, does not calculate or store a health score, and delegates any later requested mutation to the unchanged `task-management` Skill.

No application/runtime code is necessary. The work is reusable PM judgement over existing bounded Trello reads, which is exactly what a Managed Agent Skill is for.

## 2. Current Trello evidence surface discovered

Discovery used the current repository evidence: `task-management`, `daily-planning`, `weekly-planning`, `DJONIK_MEMORY_INSTRUCTIONS`, accepted #15 direct-read rules, the #18 limitation recorded in the canonical roadmap, and the final production-Agent read-back documented in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md`.

The currently enabled/readable surface documented there is:

| Tool | Established usable purpose | Health use in this slice |
|---|---|---|
| `trelloSearch` | Find candidate cards, boards, and lists | Discovery only; never authoritative for exact fields |
| `trelloReadBoard` | Board state / board-level card listing | Scoped board and grouping evidence when returned |
| `trelloReadList` | List state | Current list/grouping evidence when returned |
| `trelloReadCard` | Authoritative card fields | Direct evidence for a material card and its exact current fields |
| `trelloReadMember` | Member metadata / assignment context | Optional only when a fresh result actually exposes relevant assignment context |
| `trelloReadChecklist` | Checklist state | Optional only when a fresh result actually exposes relevant progress |
| `trelloReadInbox`, `trelloReadPlanner`, `trelloReadWorkspace` | Provider/workspace context | Not required by the new Skill; no new dependency created |

## 3. Exact usable fields/signals

Repository/accepted-flow evidence supports board/list/card identity and grouping, direct current list/status, direct card detail, and direct due-date evidence. `task-management` establishes that exact due/list/status claims must use a direct read; search is explicitly unreliable even where it happens to return a field.

The Skill permits use of description, assignment, and checklist/progress only when an actual fresh direct result exposes them. This is intentionally conditional: the repository does not retain the raw current MCP schemas or a no-cost live result proving every possible Trello field.

## 4. Missing or unreliable signals

- `trelloSearch` is not reliable field evidence for due or other exact card details.
- Labels are not established by the repository evidence as a reliable currently returned health signal, so the Skill does not rely on them.
- Assignment/member and checklist/progress are tool-level capabilities, not guaranteed field claims; they are used only if a live direct result exposes them.
- No repository evidence establishes trustworthy card/update/activity timestamps or historical cadence for health review.
- Therefore **staleness unavailable as a hard current-state judgement in this slice due to missing reliable activity evidence**. No guessed age threshold, history store, cache, or event log was added.

> **Superseded by §25.** The first live Session showed this premise was wrong: `trelloReadCard` exposes a card-level `lastActivityAt`. The Skill now uses it as a soft, contextual hint (§25.4–§25.5).

## 5. Architecture decision

Added one source Skill rather than application code. Existing Trello MCP reads supply the evidence boundary; Claude performs the PM interpretation; no correctness gap demonstrated a need for a database, state table, custom rules engine, scheduler, cache, transcript/history store, vector store/RAG, custom Messages loop, phrase router, or subagent.

The live Managed Agent remains authoritative. The new source Skill was not synced or attached to production.

## 6. Project-health Skill design

The Skill requires fresh scoped Trello evidence before current claims, then uses this compact shape:

1. current state;
2. two to four strongest evidence points;
3. concrete blocker/risk only if supported;
4. smallest useful PM next step.

It does not dump cards, force a mutually exclusive label, fake certainty, or use a universal numeric health score. A healthy project is stated briefly with its evidence; mixed evidence is described as mixed.

## 7. Waiting vs blocked rules

Waiting is intentional external pause (for example, a client response) and may only need monitoring. It is not automatically blocked. Blocked requires fresh evidence of a concrete dependency or problem that prevents progress. Undated, lower-priority, old-looking, or merely waiting work cannot be called blocked by default.

## 8. Risk rules

At-risk is an explicit PM interpretation, never stored truth. It must name evidence such as unfinished required work near/past a due date or a concrete blocker threatening a known commitment. An internal Trello due date is not automatically a client commitment, and card count alone is not risk. Overload/under-planning similarly requires supported scoped workload plus actual known commitments/constraints.

## 9. Staleness limitation

The Skill deliberately does not make a stale judgement. Existing documentation proves the enabled read-tool identities and purposes, but does not prove a reliable activity/update signal or historical cadence. If that absence materially affects an answer, Djonik should state the limitation briefly rather than inventing history.

> **Superseded by §25.4–§25.5:** a card-level `lastActivityAt` does exist in `trelloReadCard` listings. The limitation now applies only when that field is absent from the fresh result.

## 10. Fresh-evidence rules and accepted #18 limitation

`trelloSearch` is discovery only. Exact due, list/status, and card-detail claims require appropriate fresh direct evidence from this turn. Durable Memory can supply stable context but cannot override fresh operational state.

The accepted #18 Managed Agents limitation remains unchanged: a Skill can request a conditional same-turn fresh read but cannot deterministically force it. No always-read middleware, custom model loop, or intent router was introduced. A live health answer making exact current claims without fresh evidence remains a failed acceptance scenario.

## 11. Memory boundary

The existing `DJONIK_MEMORY_INSTRUCTIONS` remain unchanged: durable context is useful, live Trello/task state is not. The new Skill explicitly forbids automatic durable writes of transient conclusions such as “Extract is at risk” or “Seqthera is blocked.” Current health is recomputed from fresh evidence.

## 12. Mutation boundary

Project-health is zero-write and has no Calendar dependency. It must not create, update, move, or complete cards as a side effect of a recommendation. If Daniel explicitly asks to act, unchanged `task-management` owns intent, target resolution, bounded write, and separate verification.

## 13. Output behavior

Answers should be concise, scoped to the requested project, and evidence-backed. Other boards' urgent-looking cards must not leak into the requested project's conclusion. The Skill tells Djonik to distinguish proven evidence from interpretation and state uncertainty where a signal is absent.

## 14. Files changed

- `.claude/skills/project-health/SKILL.md` — new bounded, read-only project-health Skill.
- `src/skills.test.ts` — 19 deterministic semantic/source tests for #28 invariants.
- `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` — this implementation report.

## 15. Tests added

The source tests cover natural health triggers; planning/mutation trigger exclusion; explicit daily/weekly/task-management handoffs; fresh reads; search-vs-direct field evidence; waiting versus blocked (including a Waiting list); concrete blockers; explained risk; internal due versus commitment; no universal age/card-count risk threshold; no undated/stale inference; freshness limitation; Memory precedence; zero-write task-management handoff; no persistent score/cache/automatic Memory write; concise output; project isolation; and no Calendar/new Trello write dependency.

They intentionally check semantic constraints rather than a complete response wording.

## 16. Regression results

(Original pass; current totals after the §25 follow-up are 246 passed.) All local regression tests pass: **227 passed, 0 failed**. No TypeScript runtime path, existing Skill, model, tool configuration, Calendar configuration, or production Managed Agent resource was changed.

## 17. `npm run typecheck`

**Passed** (`tsc --noEmit`, exit code 0).

## 18. `npm test`

**Passed** (`node --import tsx --test src/**/*.test.ts`): 227 tests passed, 0 failed, 0 skipped, 0 todo.

## 19. `git diff --check`

**Passed** (exit code 0; no whitespace errors). Git emitted a non-failing Windows line-ending notice for `src/skills.test.ts` and could not read the user-global ignore file due to sandbox permissions; neither affects the patch check.

## 20. `git status --short`

```text
 M src/skills.test.ts
?? .claude/skills/project-health/
?? docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md
```

## 21. Limitations / explicitly deferred work

- No live acceptance was run; it requires later Product Lead review and a separately declared spend guardrail.
- No reliable activity/update signal is established, so staleness is intentionally unavailable in C1.
- No historical review, proactive monitoring, scheduler, dashboard, cross-project workload engine, Calendar integration, automatic mutation, or specialist subagent is included.
- The #18 conditional fresh-read platform limitation remains unresolved by design.

## 23. Final local Skill review before live validation

**Real defects found: yes — three small boundary omissions.** The first implementation already covered health-as-interpretation, fresh direct evidence, project isolation, zero writes, Memory boundary, non-numeric/multi-dimensional judgement, healthy/no-problem conclusions, and explicit staleness limitation. This review found that it did not expressly hand planning follow-ups to daily/weekly planning, did not explicitly say that a list named “Waiting” is not blocker evidence, and did not expressly reject a universal risk-age threshold.

The Skill now has `Scope and handoffs`, which reserves “що робити сьогодні?” and weekly-plan follow-ups to `daily-planning` / `weekly-planning`, and explicit mutations to `task-management`. It also states that Waiting-list evidence supports waiting only, and that no universal age or card-count risk threshold exists. Four semantic tests pin those rules.

Review conclusion:

- **Frontmatter:** covers natural current-project / risk / health / blocked-work questions without claiming planning or mutation requests.
- **Evidence grounding:** fresh direct evidence is required for exact current claims; Memory and prior reviews do not substitute; search stays discovery-only; #18 is not bypassed.
- **Waiting/blocked:** separate; blocked needs a concrete dependency/problem.
- **Risk:** causal explanation required; near/overdue unfinished work may matter; due is not automatically a client commitment; no card-count or age threshold.
- **Staleness:** still unavailable without reliable activity/freshness evidence; no invented age estimates or history infrastructure.
- **Cross-Skill boundaries:** no conflicting ownership: health interprets, daily/weekly plan, and task-management mutates.

No live validation, production sync, Agent configuration change, commit, push, or deploy occurred during this review.

## 24. Final live acceptance — stopped after Scenario A

> **Authorization used:** production sync of the reviewed Skill; maximum $0.20 list cost / two paid Managed Sessions / zero Trello mutations. Validation stopped after one Session and $0.07 because Scenario A exposed material evidence and an acceptance failure. No second Session was created.

### 24.1 Production sync and configuration proof

- Created custom Skill **`project-health`**: `skill_01Treson5zdU1TgxXDaREwnY`.
- Created Skill version / latest version: `skver_015toifwzR6d1NRLRs4bQxcD`.
- Agent: `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, version **16 → 17**.
- Exact intended configuration change: one appended custom Skill reference, `{ type: "custom", skill_id: "skill_01Treson5zdU1TgxXDaREwnY", version: "latest" }`.
- Preserved unchanged by post-update read-back: model `claude-haiku-4-5-20251001` / `standard`, system text, MCP servers, and full tools configuration. Existing `task-management`, `daily-planning`, `weekly-planning`, and `studio-intake` entries remained byte-identical.
- Pre-flight / post-sync tool state: `trelloWriteCard=true`; `trelloWriteChecklist=false` (and the other unsupported Trello writes false); Google Calendar toolset default `enabled=false`.

There was no unrelated production drift before sync.

### 24.2 Session, cost, Skill-read, and mutation evidence

- Fresh Session: `sesn_01ELDKuwKmNQPBBKTbAYvwLY`.
- Total list cost: **$0.07** of the authorized $0.20; one of two allowed Sessions.
- The first built-in read was exactly `/workspace/skills/project-health/SKILL.md`, proving the synced Skill was selected/read.
- Trello write calls: **0** (`trelloWriteCard=0`, `trelloWriteChecklist=0`, all other Trello writes=0).
- Calendar MCP calls: **0**.

### 24.3 Scenario A — current Extract health: mixed outcome / acceptance failure

The prompt was the authorized natural-language Extract health-check request, explicitly read-only. The agent correctly recovered the actual project mapping from durable convention (`Extract` is a label on the Djonik board, not a separate board), then read fresh Trello data.

Exact fresh Trello read sequence:

```text
trelloSearch(search_boards, Extract)
→ trelloSearch(search_cards, Extract)
→ trelloReadBoard(list)
→ trelloReadBoard(get, Djonik board)
→ trelloReadCard(list_by_board, Djonik board)
```

The final direct card-list read contained Extract-labelled cards in `This week`, `In progress`, and `Backlog`; it supplied the current list/status, description, labels, due values, and `lastActivityAt` fields. The answer stayed scoped to Extract, gave an interpretation and next step rather than dumping the entire board, and made no mutation.

However, it did **not** meet the factual-accuracy bar:

- Direct evidence for `Брендбук` was `due: 2026-09-25T15:00:00.000Z`; the reply called it `25.09 (ср. 15:00)`. 25 September 2026 is Friday, and 15:00 UTC is not Kyiv-local 15:00. The response therefore made an incorrect exact due/weekday/time claim despite a fresh direct read.
- It labelled `Backlog` as `Очікування` (“waiting”), even though the current Skill defines waiting as explicit external dependency/response evidence rather than a backlog list. That is not enough to accept the waiting/blocked distinction.
- The direct `trelloReadCard(list_by_board)` payload supplied `lastActivityAt` for cards, contradicting the implementation’s discovery premise that a reliable activity/update timestamp was not established. This materially changes the staleness branch and must be resolved before further validation; no silent mid-gate redesign was made.

### 24.4 Scenarios B–F

Not run. Spending more after the Scenario A failure would not establish acceptance. In particular, Scenario D was deliberately not run because the live activity signal invalidated the slice’s stated staleness limitation; Scenarios B/C/E/F remain unproven.

### 24.5 Final verdict

**FAIL — no additional paid validation performed.**

The sync, Skill selection, fresh reads, named-project isolation, and zero-write/zero-Calendar boundary all passed. The gate cannot pass because Scenario A made an incorrect exact due/weekday/time statement, treated Backlog as waiting without external-dependency evidence, and revealed a material mismatch in the documented staleness evidence surface. The #18 deterministic conditional-fresh-read limitation remains a provider/platform caveat, but is not the reason for this failure: this turn did make fresh reads.

Required next step is a new bounded Product Owner decision on correcting the live-discovered health rules (including how `lastActivityAt` qualifies as a reliable staleness signal) and on a subsequent re-sync/revalidation budget. Do not treat the present production Skill as accepted.

## 22. Explicit confirmation

> Applies to the original implementation pass only (§1–§21, §23). §24 records the later authorized live acceptance; §25.9 has the confirmations for the correctness follow-up.

- No paid Managed Session: **confirmed**.
- No live Trello call or mutation: **confirmed**.
- No production Agent/Skill change: **confirmed**.
- No commit, push, or deploy: **confirmed**.

## 25. Correctness follow-up after the first live FAIL

> **Scope:** fix only the three measured gaps from §24.3. Skill text, tests, and this report only. No paid Session, no live Trello call, no production Skill sync, no Agent change, no commit/push/deploy, no roadmap edit, no issue update.

### 25.1 First live FAIL evidence

Scenario A (`sesn_01ELDKuwKmNQPBBKTbAYvwLY`, $0.07) selected and read `project-health`, made fresh project-scoped Trello reads, and made zero writes — but produced three correctness gaps. The recorded event log (44 events) was re-read at zero inference cost through a read-only Managed Agents API `events.list` on the finished Session; no Session was created and Trello was not called. The final answer, the prompt, and the `trelloReadCard` payload (event 37, 34 cards) are the evidence used below.

### 25.2 Due-date rendering defect — root cause and fix

- **Evidence.** Direct read: `Брендбук` `due: 2026-09-25T15:00:00.000Z`. Reply: `25.09 (ср. 15:00)`. Reality: 25 Sept 2026 is a **Friday**, and 15:00Z is **18:00 Kyiv**. So both the weekday and the clock time were model-invented; the instant itself was right.
- **Root cause.** The Skill had no rule about rendering dates. Faced with an ISO instant, the model derived a weekday and a local time itself, unreliably. This is a Skill gap, not a Trello-read gap. (A secondary contributor: the reply also said «менш ніж тиждень», a relative-arithmetic claim with no supporting mechanism.)
- **Fix.** New Skill section `Dates and deadlines`: exact due facts still require a fresh direct read; preserve the verified instant as read; prefer factual wording like «У Trello є дедлайн 2026-09-25T15:00:00Z»; **no** weekday derived from an ISO timestamp, **no** local/Kyiv or other timezone conversion, **no** relative arithmetic presented as exact fact; a hedged qualitative "looks close" remark only when today's date is clearly known. If a local rendering is wanted, say it is not computed in a health review. The `Gather fresh evidence` section also now says to read a deadline only from a card's own `due`.
- **Not changed.** #23's deterministic post-write due finalizer and the `task-management` Skill are untouched; no date middleware was built.

### 25.3 Backlog → Waiting defect — root cause and fix

- **Evidence.** The reply headed its Backlog cards `Очікування (Backlog)`. None of the 10 Extract cards had waiting evidence: none was in the `Waiting` list (that list held Cossack Labs / A1 / Seqthera cards) and no Extract description mentioned waiting or awaiting a response. The reply also listed «Інші картки в Backlog — розпорошені без пріоритизації або дедлайнів» under risk.
- **Root cause.** The Skill defined Waiting only positively and never stated what Waiting is *not*, so the model mapped "not active" onto "waiting".
- **Fix.** Added a **Backlog / not started** state ("a queue, not a problem: not Waiting, not Blocked, not at risk by itself"); Waiting now requires explicit evidence that work is waiting for someone/something external (a list named Waiting, or text such as «чекаємо відповідь клієнта»); Backlog, no due date, undated, or not started is never evidence of waiting; a Waiting list is still not automatically Blocked; Blocked still needs a concrete dependency/problem. Four worked examples were added (Backlog card → not waiting; Waiting list → not automatically blocked; «чекаємо відповідь клієнта» → legitimate waiting evidence; a concrete missing dependency → Blocked may be justified).
- **Small adjacent tightening.** At-risk now also says "backlog or undated work alone is not risk", because the same reply used undated Backlog as a risk. This follows directly from the measured failure and adds no new mechanism.

### 25.4 `lastActivityAt` — exact location and semantics (zero-cost discovery)

**Where it appears (recorded Session `sesn_01ELDKuwKmNQPBBKTbAYvwLY`):**

| Event | Tool / action | `lastActivityAt` present? |
|---|---|---|
| 12, 17 | `trelloSearch` `search_boards` / `search_cards` | Results were **empty** (`nodes: []`) — nothing can be inferred either way |
| 22 | `trelloReadBoard` `list` | **No** — board node has no such field |
| 32 | `trelloReadBoard` `get` | **No** |
| 37 | `trelloReadCard` `list_by_board` | **Yes — on every card node: 34 / 34, all ISO-8601 UTC, none null** |

- It is a **card-level** field (`cards.nodes[].lastActivityAt`). The nested `list` object has only `{id, name}` and the nested `board` object only `{id, name}`; neither carries it. It appeared 34 times in the whole 44-event Session and nowhere else. It sits beside `due`, `dueComplete`, `startedAt` (null on all 34), `closed`, and `complete`.
- **Empirical consistency with card-level activity.** Timestamps vary per card (e.g. `2026-09-12T21:23:27Z` … `2026-09-18T13:09:08Z`); cards in `Done` carry their own values; several cards share near-identical seconds (`11:46:55/56/58`, `13:09:07/08`, `10:31:07/24`), consistent with moves, reordering, or bulk touches rather than substantive work.
- **Provider quirk observed.** In the board node (events 22/32) the `due` field is `2026-09-18T13:09:08.961Z`, **identical to the millisecond** to the maximum card `lastActivityAt` (`UI Fixs`). A board has no due date, so that value is a latest-activity aggregate mislabelled as `due`. The Skill therefore now takes a deadline only from a card's own `due`. (Observation only; no claim about the cause.)
- **Documentation.** The Agent-retrieve API exposes no tool schema (already recorded in `docs/04`). The official Trello MCP page (`trello.com/mcp`) and the `atlassian/trello-mcp-server` README list capability categories only and do **not** document returned card fields — neither `lastActivityAt` nor `list_by_board`. The closest documented analogue is Trello REST `dateLastActivity`: "The datetime of the last activity on the card", with the caveat that some activities update it without creating an action. A developer-community thread reports at least one action (removing a member with no other activity) that does not update it. A Trello REST `dateLastActivity` ↔ `lastActivityAt` identity is therefore an **inference** from name, placement, and values; it is not documented for this MCP.

**Conclusion.** Confirmed by evidence: it is a per-card timestamp of the last recorded Trello activity. Not confirmed by documentation: the exact set of actions that bump it. It is thus a reliable *card-level* signal that some activity occurred, but a weak signal of useful progress — it can be bumped by reordering, moves, or automation/test writes, and may not be bumped by every action.

### 25.5 Staleness product decision

> **Superseded by §27.** The contextual "CASE A, qualified" rules below (including "potentially stale") were removed after the second live FAIL; `lastActivityAt` may now only be quoted as recorded activity and staleness/progress judgement is unavailable.

**CASE A, qualified.** Because the field is confirmed card-level, the Skill may use it — but strictly as a **soft, contextual freshness hint**:

- Use it only when actually present in the fresh direct card result; report it as the recorded date, without a weekday or local-time conversion.
- It only shows that some activity occurred; it is **not** proof that useful work progressed, and a quiet card does not prove no work happened elsewhere.
- **No** universal "N days = stale" rule, **no** fixed age threshold, no numeric cut-off.
- Active/in-progress + old activity relative to an expected near-term outcome (due or accepted commitment) → *may* be flagged as potentially stale. Backlog + old activity → not automatically stale. Waiting + old activity → may be perfectly expected. No expected cadence/commitment → qualify the uncertainty.
- If `lastActivityAt` is absent from the fresh result, the previous limitation applies: reliable staleness judgement is unavailable in this slice; do not guess.

This is deliberately qualified rather than a full "reliable" endorsement: the MCP field is undocumented, so the decision rests on structural evidence plus the guardrails above, which are safe whether or not the field turns out to behave exactly like Trello's `dateLastActivity`.

### 25.6 Risk

Risk may still use a verified due plus unfinished required work as evidence, but never a self-computed weekday, local time, client commitment, timezone-adjusted deadline, or exact countdown. Internal Trello due ≠ client commitment (unchanged).

### 25.7 Skill changes and why no runtime change was needed

Changed only `.claude/skills/project-health/SKILL.md`: a Backlog/not-started state; stricter Waiting and Blocked; four worked examples; the new `Dates and deadlines` section; risk wording; the `Staleness is unavailable…` section replaced by `Staleness and the activity signal`; one sentence about taking deadlines only from a card. All three defects were interpretation/wording gaps that a Skill fixes. Nothing required a DB, health cache, history/event store, date middleware, custom model loop, deterministic intent router, or scheduler, and none was added. #23, #18, and the daily/weekly/task-management/studio-intake Skills are unchanged.

### 25.8 Tests

`src/skills.test.ts`: 2 staleness tests updated to the renamed section and new semantics, plus **19 new** semantic tests (no full-response assertions). Coverage: no weekday from an ISO due; no local/timezone conversion; no exact relative arithmetic; exact due facts still need direct evidence and #23 is untouched; Backlog ≠ Waiting; undated/not-started ≠ Waiting; Waiting requires explicit external-dependency evidence; three worked examples (Backlog card, Waiting list ≠ blocked, «чекаємо відповідь клієнта», concrete blocker); honest `lastActivityAt` semantics; reported as read without weekday/local conversion; old Backlog activity ≠ stale; old Waiting activity ≠ stale; potentially-stale only for active work against an expected outcome; no universal age threshold (including a check that no numeric age cut-off appears anywhere in the Skill); risk not resting on a self-derived date; zero-mutation/Skill-only invariants; and daily/weekly/task-management/studio-intake boundaries unchanged (none adopts `lastActivityAt` or depends on `project-health`).

**Results:** `npm test` — **246 passed, 0 failed, 0 skipped** (was 227). `npm run typecheck` — passed (exit 0).

### 25.9 Explicit confirmation

- No paid Managed Session: **confirmed.** (One read-only `events.list` on the already-finished Scenario A Session; $0 inference.)
- No live Trello call or mutation: **confirmed.**
- No production Skill sync or Agent config change: **confirmed.** The production `project-health` Skill (`skill_01Treson5zdU1TgxXDaREwnY`) still holds the **old, failing** text; this fix exists only in the repo until a separately authorized re-sync and revalidation.
- No commit, push, deploy, roadmap edit, or issue update: **confirmed.**

## 26. Final live retest after correctness hardening — FAIL

> **Authorization used:** re-sync of the EXISTING production `project-health` Skill from the reviewed repo source; exactly 1 fresh paid Managed Session; max $0.13 additional list cost; zero Trello mutations; no other production change. Stopped after two turns and $0.08 because the evidence already decided the verdict. No second Session was opened; no commit, push, deploy, roadmap edit, or issue update.

### 26.1 Pre-flight

- Local: `npm run typecheck` exit 0; `npm test` **246 / 246**; `git diff --check` exit 0; `git status --short` as expected.
- Production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh`: **version 17**; model `claude-haiku-4-5-20251001` / `standard`; five custom Skills attached, all `version: "latest"`; Trello toolset `trelloWriteCard=true` (must not be called), `trelloWriteChecklist=false`, `trelloWriteBoard/Inbox/List/Planner=false`; Google Calendar toolset default `enabled=false`.
- Skill drift check: the latest production versions of `task-management`, `daily-planning`, `weekly-planning`, and `studio-intake` were downloaded and are **byte-identical to the repo** (line endings normalised). Only `project-health` differed (the old, failing text). No unrelated drift.

### 26.2 Skill sync result

| Item | Value |
|---|---|
| Skill | `project-health`, **`skill_01Treson5zdU1TgxXDaREwnY`** (existing; no duplicate created) |
| Old version | `skver_015toifwzR6d1NRLRs4bQxcD` |
| **New version** | **`skver_012ckoEp3EGqaMnTANyBkoMB`** (created 2026-09-19T05:48:36Z) |
| Agent before → after | **v17 → v17** (`updated_at` unchanged) |
| Agent config diff | **None.** The Agent references the Skill as `latest`, so no Agent update was made or needed; the full retrieved Agent JSON is identical before and after (ignoring `version`/`updated_at`) |
| Content proof | The downloaded new version is **byte-identical** to `.claude/skills/project-health/SKILL.md` (LF-normalised sha256 prefix `157d11b3f18009fc` on both) |
| Other Skills | Latest version ids unchanged (`task-management` `skver_012fLb9Z…`, `daily-planning` `skver_01TDfMCn…`, `weekly-planning` `skver_018soRHm…`, `studio-intake` `skver_018sJv1G…`) |

### 26.3 Session, cost, and runner deviations (disclosed)

- **Session: `sesn_01WKShxy3wuJCKxMDr8RUgvz`** — the only Session opened. Agent v17.
- **Total list cost: $0.08** (API-reported cumulative `list_cost.amount = "8"`, minor units; my live estimate was $0.0756). $0.05 of the authorized $0.13 was left unspent.
- **Runner deviation 1 — no platform budget cap.** I intended to attach a platform `budget` (`max_list_cost`) to this Session. The API allows it only at creation ("a session that has no budget cannot gain one"), and `connectToDjonik` does not pass it. My first runner therefore crashed on the `sessions.update` call **after creating the Session but before sending any turn** (cost $0, zero events). To stay within "exactly 1 Session" I reused that unused Session rather than creating a second one, so the cap could not be attached. The $0.13 ceiling was enforced by my runner instead: per-request cost estimated from `span.model_request_end` usage, an automatic `user.interrupt` on est. cost at or above the ceiling (and a per-turn cap), between-turn gating, and an interrupt on any Trello write or non-Trello MCP call. None of those triggers fired.
- **Runner deviation 2 — telemetry.** `connectToDjonik` cannot attach to an already-created Session, so the repo's built-in per-turn telemetry collector was not used. Equivalent content-free evidence (tool sequence, Skill read, usage, write/Calendar counts) was taken from the server-side event log (`events.list`) and my runner's records.
- **Runner deviation 3 — one off-script turn.** Turn "A2" (below) was added because the scripted Scenario A prompt did not reach a health check. It is a user's natural answer to the agent's own clarifying question; it used the same Session and budget.

### 26.4 Scenario A as scripted — no health check delivered

Prompt: `Що зараз по Extract? Дай короткий health check: що активне, що чекає, чи є реальні ризики і що мені варто зробити далі.` (no read-only suffix, as authorized).

- The project-health Skill **was read** (`/workspace/skills/project-health/SKILL.md`, first tool call).
- Fresh Trello reads: `trelloSearch(search_boards, "Extract")` → `trelloReadBoard(list)` — the only open board is `Djonik`.
- The agent did **not** check Memory or the board's cards (in the first Session it had recovered the convention that *Extract is a label on the Djonik board* via a Memory search). It asked where "Extract" lives instead of reviewing anything. No writes, no invented facts, about $0.03.

This is a **project-resolution miss**, not one of the three hardened behaviours: the Skill scopes a review to a "named project" but does not say that a project can be a label on a shared board.

### 26.5 Scenario A2 — clarified health check (the substantive evidence)

Prompt (verbatim): `Extract — це лейбл проєкту на дошці Djonik, окремої дошки Extract немає. Зроби той самий health check по Extract.`

- Fresh reads this turn: `trelloReadBoard(get)` → `trelloReadBoard(list_labels)` → `trelloReadCard(list_by_board)` (the 34-card payload carrying `due` and per-card `lastActivityAt`). Scoped to the ten Extract-labelled cards; no other project's cards drove the verdict. Cost about $0.04–0.05.

**Checked against the PASS bar:**

| # | Criterion | Result |
|---|---|---|
| 1 | Skill selected/read | ✅ (turn A) |
| 2 | Fresh Trello evidence | ✅ |
| 3 | Concise, project-scoped | ❌ **Dumped all ten cards grouped by list, then the health check** — the Skill says not to dump every card |
| 4 | Backlog ≠ Waiting | ✅ Backlog headed «BACKLOG (очікує початку)» (awaiting start), not Waiting |
| 5–6 | Waiting ≠ Blocked; blocker needs evidence | ✅ no blocker or waiting claimed. It did suggest «перевірити, чи не заблоковано "Коментарі по пінкам" — в ній немає опису», a weak inference from an empty description, framed as a check rather than a claim |
| 7 | No invented weekday / local time | ✅ for weekday and Kyiv time. ❌ **but a countdown was stated: «(6 днів від тепер)»** |
| 8–9 | Risk causal; internal due ≠ commitment | ✅ Risk = unstarted Backlog card with a verified due; hedged «Якщо це критичне завдання для клієнта» |
| 10 | No forced risk | ✅ one supported risk only |
| 11 | `lastActivityAt` as a soft signal only | ❌ **«2 завдання в процесі, остання активність — сьогодні… Живий робочий процес»** treats activity as proof of live work, and «остання дія 2 дні тому» is model-computed relative arithmetic |
| 12 | No universal stale threshold | ✅ |
| 13–14 | Zero mutations; no Calendar | ✅ (see §26.10) |

### 26.6 Scenarios B, C, D — not run

After A2 the Session had about $0.08 spent; each remaining scenario requires a fresh direct card read (about $0.04–0.05 for the 38k-token payload), so the remaining $0.05 could fund at most one more turn and could not change the verdict. Stopped per the stop rule. **B (Waiting vs Blocked), C (due/risk), and D (staleness) remain unproven live.** The Extract data also contains no Waiting-list card and no waiting/blocked text, so B would in any case be largely a "nothing is blocked" check.

### 26.7 Due wording evidence

Direct read: `Брендбук` `due: 2026-09-25T15:00:00.000Z` (a Friday; 18:00 Kyiv).

- Reply: «дедлайн **2026-09-25T15:00:00.000Z**» — the exact direct-read value, **no weekday, no Kyiv/local time**. The original defect (`ср. 15:00`) is **fixed**.
- Reply also: «2026-09-25 (**6 днів від тепер**)» — a model-computed countdown. The number happens to be correct for 2026-09-19, but it is unsupported by any deterministic/authoritative source and is precisely what the retest's date-safety rule forbids. **Not fixed.**
- Likely cause: the Skill's own "a hedged qualitative remark is fine when today's date is known" allowance was read as licence for an exact day count (the model dropped the hedge).

### 26.8 Waiting/Blocked evidence

Fresh payload: no Extract card is in the `Waiting` list (that list holds `Документи` [Cossack Labs], `Діадіа` [A1], `Зробити головну сторінку` [Seqthera]); no Extract description contains waiting or blocker text. The reply made no Waiting claim and no Blocked claim, labelled Backlog as not-started, and kept other projects out. This satisfies the intended semantics for this data set but was not exercised with positive Waiting/Blocked evidence.

### 26.9 `lastActivityAt` / staleness evidence

- The field was present on all 34 cards and quoted as recorded (`2026-09-19T05:31:20`), without weekday or local conversion.
- **New discovery.** Between the first Scenario A payload (2026-09-18) and this one, three cards changed before this Session started (05:31Z; not by this Session, which wrote nothing): `Чорні аромати` moved Backlog → In progress (`lastActivityAt` → 05:31:20), `Підтримка UI` moved This week → In progress (→ 05:31:43), and `Коментарі по пінкам` — same list, empty description — was bumped to 05:31:37, between the two moves. That is consistent with **reordering/moves bumping `lastActivityAt` without any work**, exactly the caveat the Skill states. The agent nevertheless inferred «Живий робочий процес» from it.
- No universal stale threshold was applied and nothing was labelled stale. The Backlog/Waiting-old-activity and expected-outcome rules were **not exercised** (Scenario D not run).

### 26.10 Mutation and Calendar counts (authoritative server-side event log, 45 events, whole Session)

- Trello write calls: **0** (`trelloWriteCard=0`, `trelloWriteChecklist=0`, all other writes 0).
- Non-Trello MCP / Google Calendar calls: **0**.
- Tool calls in total: 1 built-in `read` (the Skill) + 5 Trello MCP reads (`trelloSearch`, `trelloReadBoard` x3, `trelloReadCard`). No bash / Memory writes.

### 26.11 Final verdict — **FAIL**

The hardening fixed the two originally measured defects that were observable — **no invented weekday/Kyiv time** and **Backlog no longer labelled Waiting** — and preserved the zero-write / zero-Calendar / project-isolation boundary. But the final acceptance bar is not met:

1. a model-computed countdown («6 днів від тепер») and relative activity age («2 дні тому») appeared, contrary to the date-safety rule;
2. the answer was not concise (a full card dump before the interpretation);
3. `lastActivityAt` was treated as evidence of live work, contrary to "soft signal, not proof of progress";
4. Scenario A as scripted stalled on project resolution, and B/C/D are unproven.

Not INCONCLUSIVE: items 1–3 are direct violations of specific PASS criteria in an observed answer.

### 26.12 Suggested next bounded step (for Product Owner decision; nothing was changed)

Repo-only Skill edits, then a separately budgeted re-sync and revalidation:

- Remove the "hedged qualitative remark" allowance and forbid **any** day count or relative time phrase («N днів», «від тепер», «тому», «сьогодні», «менше тижня») for both `due` and `lastActivityAt`; instruct to quote the recorded ISO value only.
- State that `lastActivityAt` never supports "active/live work"; add that reordering/moves bump it.
- Tighten "Do not dump every card": give the answer shape first and say not to list cards by list.
- Add project resolution: a project may be a label on a shared board — if no board matches, read the board's cards/labels before asking Daniel, and state which label was used.

Budget note: a fresh 4-scenario run with a full card read per turn costs roughly $0.04–0.05 per scenario on Haiku; a cap near $0.20 would be needed for all four.

### 26.13 Residual #18 caveat

Unchanged: a Skill can request a same-turn fresh read but Managed Agents cannot force one deterministically. This retest did make fresh reads in both turns, so #18 is not the reason for the FAIL. Turn A's clarifying question shows a related, separate variance: the agent may also skip the Memory convention that resolves a project name, and that is not enforceable from a Skill either.

### 26.14 Confirmations

- Paid Managed Sessions: **1** (`sesn_01WKShxy3wuJCKxMDr8RUgvz`), total **$0.08** of the authorized $0.13.
- Trello mutations: **0**. Calendar calls: **0**.
- Production change: **only** the new `project-health` Skill version `skver_012ckoEp3EGqaMnTANyBkoMB` (Agent v17 untouched; model, task-management, daily-planning, weekly-planning, studio-intake, MCP permissions, Calendar unchanged).
- No commit, push, deploy, roadmap edit, or issue update.

## 27. Final simplification pass after the second live FAIL

> **Scope:** fix only the four gaps measured in §26. Skill text, tests, and this report only. No paid Session, no Trello call, no production Skill sync, no Agent change, no commit/push/deploy, no roadmap edit, no issue update. The production `project-health` Skill (`skver_012ckoEp3EGqaMnTANyBkoMB`) still holds the §25 text that failed; this pass exists only in the repo until a separately authorized re-sync and revalidation.

### 27.1 Second live FAIL evidence (from §26)

Session `sesn_01WKShxy3wuJCKxMDr8RUgvz` ($0.08, zero writes, zero Calendar calls). The §25 hardening fixed the invented weekday/Kyiv time and Backlog→Waiting, but four gaps remained:

1. **Model-generated relative time:** «(6 днів від тепер)» for a verified due and «остання дія 2 дні тому» for `lastActivityAt`.
2. **`lastActivityAt` read as proof of live work:** «остання активність — сьогодні… Живий робочий процес». Recorded evidence showed why this is unsound: a card with no list change and an empty description had its `lastActivityAt` bumped between two moves of other cards.
3. **Card dump:** all ten Extract cards were listed by list before the interpretation.
4. **Project resolution:** the scripted prompt stalled — no board named Extract exists, and the agent asked Daniel where it lives instead of checking the shared board's labels/cards, although Extract is a label on the shared board.

### 27.2 Root causes

- **1:** the §25 Skill still allowed "a hedged, qualitative remark … when today's date is clearly known". The model dropped the hedge and produced an exact count, and did the same for the activity timestamp because the date rules were framed around `due`.
- **2:** the §25 Skill turned `lastActivityAt` into a contextual signal (active + old + expected outcome → potentially stale; Backlog/Waiting exceptions). That was too subtle for the Haiku baseline, which inverted it: recent activity ⇒ live work.
- **3:** "Do not dump every card" was one clause inside a longer sentence, and the Skill never said what to do instead or when a full list is legitimate.
- **4:** the Skill scoped a review to a "named project" but never said a project may be a label on a shared board.

### 27.3 Skill changes (`.claude/skills/project-health/SKILL.md` only)

- **`Dates and deadlines` (rewritten).** For any Trello timestamp — `due` or `lastActivityAt` — quote only the authoritative recorded ISO value. Never derive or state a weekday, a local/Kyiv time or any timezone conversion, «сьогодні/вчора/завтра», «N днів тому», «через N днів», «N днів від тепер», «менше тижня», or any other exact or approximate relative-age or countdown wording. **The qualitative "looks close" allowance was removed** ("no qualitative exception"). Good/bad examples added: «У Trello дедлайн: 2026-09-25T15:00:00Z.» vs «Дедлайн у пʼятницю через 6 днів.» Exact due facts still need a fresh direct read; the task-management due handling stays separate and unchanged. No date middleware.
- **`Activity signal and staleness` (replaces `Staleness and the activity signal`).** `lastActivityAt` is undocumented by the provider, is bumped by moving/reordering without work, and only shows that some Trello activity was recorded. It is **not sufficient** to classify anything as stale or to say work is active, live, or progressing; no stale verdict, no "active/live because recent", no age calculation. If relevant it may be quoted only as «Trello recorded activity at <ISO>». Reliable staleness and progress judgement is stated as unavailable from the current evidence; contextual staleness is deferred until a better historical/progress evidence surface exists. **Removed:** the "active + old activity + expected outcome → potentially stale" rules, the Backlog/Waiting old-activity bullets, and the "soft freshness hint" framing.
- **`Form the interpretation`.** One short conclusion, only the 2–4 strongest evidence points, blocker/risk only if supported, the smallest useful next PM step. **Do not enumerate every card by default** (grouped by list or not; do not open with an inventory); list all cards only when Daniel explicitly asks for a full list or inventory. `Active/current` is now based on list/status evidence, never on `lastActivityAt`. The risk bullet now forbids "relative-time or countdown wording" calculated by the model.
- **`Resolve the named project` (new, generic).** A project may be a board or a label on a shared board. If no board matches, inspect the accessible relevant shared board's labels/cards with a direct read before asking Daniel; if exactly one label matches, scope the review to cards with that label and say which label was used; other cards do not drive the verdict. If more than one label/board plausibly matches, or it is unclear which shared board is relevant, ask one short clarification; if nothing matches, say so and ask once. No hard-coded project/board names, no mapping table, not a router.
- **`Style`.** Leads with the conclusion; the output shape is explicitly guidance, not a rigid heading template.

### 27.4 Preserved unchanged

Backlog ≠ Waiting; undated/not-started ≠ Waiting; Waiting needs explicit external-dependency evidence; Waiting ≠ Blocked; Blocked needs a concrete blocker; backlog/card count alone ≠ risk; internal due ≠ client commitment; the four worked examples; zero-write / no-Calendar; Memory boundary; scope/handoffs to daily-planning, weekly-planning, task-management; fresh-evidence rules. The other Skills (`task-management`, `daily-planning`, `weekly-planning`, `studio-intake`) were not touched.

### 27.5 Tests (`src/skills.test.ts`)

**20 new**, **9 obsolete removed** (the §25 tests that pinned the removed contextual-staleness rules and the old weekday/tz/relative wording), and **4 rewritten** in place (`undated ≠ stale`, risk-without-self-derived-date, no universal age threshold, concise output). All semantic phrase checks, no full-response assertions.

New coverage: no weekday derivation; no timezone conversion; no today/yesterday; no N-days-ago/from-now; no countdown/relative age and no hedged exception; date rules apply to both `due` and `lastActivityAt` with good/bad examples; `lastActivityAt` honestly described; cannot prove active/live work (and Active/current uses list/status); cannot produce a stale verdict; age not calculated; quotable only as «Trello recorded activity at <ISO>»; staleness limitation explicit and deferral stated; old potentially-stale rules gone; no universal age threshold (including no numeric cut-off anywhere); no full-card enumeration by default; full list only on explicit request; shape is guidance not a template; unique shared-board label resolves the project; no hard-coded project/board and no mapping table; ambiguity/absence still clarifies once; label scoping keeps other projects out. Existing tests keep guarding Waiting/Blocked/risk, zero-write, and daily/weekly/task-management/studio-intake boundaries.

**Mutation check.** Run against the previous production Skill text (the version that failed live), **24** project-health tests fail, covering all four measured gaps; the 233 others (Waiting/Blocked/risk rules, zero-write, handoffs, all other Skills) still pass. The current Skill was then restored byte-identically.

### 27.6 Results

- `npm run typecheck`: passed (exit 0).
- `npm test`: **257 passed, 0 failed, 0 skipped** (was 246).
- `git diff --check`: passed (exit 0; only the existing CRLF notice for `src/skills.test.ts`).

### 27.7 Explicit confirmation

No paid Managed Session; no live Trello call or mutation; no production Skill sync or Agent change; no runtime/date middleware, DB, health cache, event store, router, or scheduler; no commit, push, deploy, roadmap edit, or issue update.

### 27.8 Residual risk

Skill text cannot force Haiku to comply; the §26 failures were compliance failures on already-present rules, and this pass simplifies rather than adds nuance in the hope of higher compliance. It is unproven until a separately authorized re-sync and live revalidation. Scenarios B (Waiting vs Blocked with positive evidence), C (due/risk), and D (staleness question) have still never run live. The #18 caveat is unchanged.

## 28. Final live acceptance after the simplification pass — FAIL

> **Authorization used:** re-sync of the EXISTING production `project-health` Skill from the reviewed repo source; exactly 1 fresh Managed Session; max $0.20 additional list cost; zero Trello mutations; no other production change. Stopped after three turns and $0.14 because the verdict was already clear and the remaining scenario would only repeat a failure. No second Session; no commit, push, deploy, roadmap edit, or issue update.

### 28.1 Pre-flight

- Local: `npm run typecheck` exit 0; `npm test` **257 / 257**; `git diff --check` exit 0; `git status --short` as expected.
- Production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh`: **v17**; model `claude-haiku-4-5-20251001` / `standard`; five custom Skills all `version: "latest"`; `trelloWriteCard=true` (must not be called), `trelloWriteChecklist=false`, other Trello writes false; Google Calendar default `enabled=false`.
- Drift check: production `task-management`, `daily-planning`, `weekly-planning`, `studio-intake` **byte-identical** to the repo (line endings normalised). Only `project-health` differed (production = the §25 text, sha prefix `157d11b3…`; repo = the simplified text, `c64318f4…`). No unrelated drift.

### 28.2 Skill sync result

| Item | Value |
|---|---|
| Skill | `project-health`, **`skill_01Treson5zdU1TgxXDaREwnY`** (existing; no duplicate) |
| Old version | `skver_012ckoEp3EGqaMnTANyBkoMB` |
| **New version** | **`skver_01JLTtMvUgfEqdcBBGj4WGVm`** (created 2026-09-19T06:28:52Z) |
| Agent before → after | **v17 → v17**, `updated_at` unchanged |
| Agent config diff | **None** (Skill referenced as `latest`; full retrieved Agent JSON identical before/after apart from `version`/`updated_at`) |
| Content proof | downloaded new version **byte-identical** to `.claude/skills/project-health/SKILL.md` (sha prefix `c64318f46da417db`) |
| Other Skills | latest version ids unchanged |

### 28.3 Session and cost

- **Session: `sesn_01D98FHE268ZjvHyXd7o1V3i`** — the only Session opened; Agent v17. Created with a **platform budget of $0.20 attached at creation** (verified on read-back), memory store and vault as `connectToDjonik` does (memory instructions taken verbatim from the repo source).
- **Total list cost: $0.14** (API-reported `list_cost.amount = "14"`; my per-request estimate $0.138): A ≈ 7.1¢, B ≈ 5.1¢, D ≈ 1.6¢. $0.06 of the $0.20 unspent.
- Turns were driven by a single-turn runner attached to this Session (per-request cost estimate, automatic `user.interrupt` on any Trello write / non-Trello MCP call / cost ceiling, per-turn caps). None triggered. Evidence below comes from the runner's records and the server-side event log (72 events); the repo's built-in per-turn telemetry collector cannot attach to an already-created Session and was not used.

### 28.4 Scenario A — project resolution + concise health: **resolution PASS; answer FAIL**

Prompt sent exactly as authorized.

**Exact read sequence (server-side log):**

```text
read /workspace/skills/project-health/SKILL.md
trelloSearch(search_boards, "Extract")            → no board
bash: grep -r -i "extract" /mnt/memory/djonik-memory/   (read-only)
trelloReadBoard(list, open)                       → the single board "Djonik"
trelloReadBoard(get, Djonik)
trelloReadBoard(list_labels, Djonik)              → Extract, Cossack Labs, A1, Seqthera, Limen, (unnamed)
trelloReadCard(list_by_board, Djonik)             → 34 cards; 10 carry the Extract label
```

**Project-resolution evidence.** No board named Extract exists. The agent did **not** ask Daniel; it inspected the shared board's labels and cards, found exactly **one** `Extract` label (of five named labels), and scoped the review to the ten cards carrying it. No hard-coded mapping was involved. **The new §27 resolution rule worked live.** (The first Session that recovered this only via Memory and the second that asked Daniel are both superseded by this behaviour.)

**Against the bar:**

| Criterion | Result |
|---|---|
| Skill read; fresh evidence this turn; label resolution; no hard-coded mapping | ✅ |
| Zero mutation | ✅ |
| Concise (one short interpretation, 2–4 points, one next step) | ❌ ~1.2k chars; **six cards itemised with details** (three "Active", two "Backlog", the due card), then three next steps and a question. Not every card, but a card-by-card list |
| Backlog not described as Waiting | ❌ (soft) the header «**Чекають виконання** (Backlog, без дедлайну)» answers "що чекає" with Backlog items, and «Рендер Відео білих ароматів — **чекає** в Backlog». Same conflation as the original defect in milder words |
| No model-derived date/time wording | ❌ **«(через 6 днів)»**, **«дедлайн в пʼятницю»**, **«остання активність вчора»**, **«остання активність сьогодні, 05:31 UTC»** |
| `lastActivityAt` not used as progress evidence | ❌ **«Сидить у Backlog, **без прогресу** (остання активність 2026-09-17)»**; recent activity used to present a card as current work; **«Закінчи Коментарі по пінкам … здається близько»** is an invented progress claim |
| No invented risk / internal due ≠ client commitment | ❌ «**Це критичний дедлайн**, що вже сигналить про ризик» — an internal Trello due on a not-started Backlog card is called critical with no client-commitment evidence |

### 28.5 Scenario B — Waiting vs Blocked: **FAIL (partial)**

Fresh reads: `trelloReadCard(get)` ×4 (`Чорні аромати`, `Коментарі по пінкам`, `Флакони 1.5 ML`, `Брендбук`); statements about the two other Backlog cards came from turn A's context.

- ✅ Correct headline: «**Справді заблоковано: нема явних залежностей**» — no blocker invented.
- ✅ No date arithmetic, no `lastActivityAt` use.
- ❌ **Waiting without evidence:** «Чекає (на клієнта?): **Брендбук**» and `Коментарі по пінкам` «без опису, невідомо, на що чекає». Payload check: **no Extract card is in the Waiting list** and **none has waiting or blocker text**; Брендбук is an empty-description Backlog card. So Waiting was inferred from emptiness — the rule "Backlog/undated/not started ≠ Waiting; Waiting needs explicit evidence" was violated.
- ❌ Not concise: about eight cards enumerated by list; due called «Критичне».

### 28.6 Scenario C — not run

Its distinctive risk (repeat of the date/relative-time failure) was already demonstrated in A; per the stop rule, no turn was spent to repeat a known failure. Due/risk causality is therefore evidenced only by A (see §28.4).

### 28.7 Scenario D — staleness boundary: **FAIL (partial)**

- ✅ **The C1 conclusion was stated correctly and honestly:** «я не можу … робити висновки про staleness на основі `lastActivityAt` — це поле змінюється й від простого переміщення карт без реальної роботи.» No stale verdict; raw ISO values quoted; correctly explained that progress evidence (checklists, comments) is what is needed.
- ❌ **No fresh Trello evidence this turn** (`mcpSequence: []`): exact `lastActivityAt` values for seven cards were quoted from the earlier turn — an exact current claim without a same-turn read (the fresh-evidence rule; #18).
- ❌ «**(сьогодні)**» beside two cards. The reply also leaks the internal Skill name («За Skill project-health…») and lists seven cards in a table.

### 28.8 Due wording, Waiting/Blocked, `lastActivityAt` — summary evidence

- **Due (`2026-09-25T15:00:00.000Z`):** quoted exactly in A (✅ no Kyiv/local time conversion), **but** with «через 6 днів» and «в пʼятницю» (❌).
- **Waiting/Blocked:** correct "nothing blocked"; incorrect speculative Waiting for an empty Backlog card (B).
- **`lastActivityAt`:** correctly disclaimed when asked directly (D); misused as progress/liveness in A and given a relative «вчора/сьогодні» in A and D.

### 28.9 Mutation and Calendar counts (server-side log, whole Session)

- Trello write calls: **0** (`trelloWriteCard=0`, `trelloWriteChecklist=0`, all others 0).
- Calendar / non-Trello MCP calls: **0**.
- The only `bash` call was a read-only `grep` of the Memory directory.

### 28.10 Final verdict — **FAIL**

Progress since §26: **project resolution now works** (label found and used without asking); the agent no longer derives Kyiv/local clock times or calls Backlog «Очікування»; it correctly reports "nothing blocked" and, when asked directly, correctly states that staleness/progress cannot be judged from `lastActivityAt`.

Still failing the bar: model-derived weekday/relative time (**A**, **D**) — criterion 8; `lastActivityAt` as progress evidence (**A**) — 11; not concise (**A**, **B**, **D**) — 4; Waiting/Backlog conflation (**A** soft, **B** explicit) — 5; internal due called critical (**A**, **B**) — 10; a same-turn fresh read missing in **D** — 3. Criteria 1, 2, 6, 7, 12, 13, 14 pass; 9 is only partly evidenced.

### 28.11 Diagnosis and options for the Product Owner (nothing changed)

- **Skill text has now failed twice to hold Haiku to explicit prohibitions**, even after being simplified. Rules the model *does* follow (label resolution, "nothing blocked", the D disclaimer) are ones with a clear positive action; the ones it breaks are negative rules ("do not say …") on fluent, natural-sounding phrases.
- **Priming by the Skill's "Bad:" example is possible but is probably not the main cause.** Turn A's «в пʼятницю» and «через 6 днів» closely echo the Skill's example «Дедлайн у пʼятницю через 6 днів». But the first Session (§24) ran a Skill with **no** date guidance at all and still produced «ср. 15:00» and «дедлайн менш ніж тиждень», and the second (§26) produced «6 днів від тепер» / «2 дні тому». So this is a spontaneous PM-style phrasing habit of the model that persists across three different Skill wordings; removing the literal example is a cheap experiment but should not be expected to fix it alone.
- **Options, each needing a new decision:** (a) one more repo-only Skill iteration (positive-only wording, no forbidden-phrase list, an explicit output cap such as "at most three sentences of evidence, no per-card list") — nearly free, low expected gain given the above; (b) accept a narrower C1 contract that drops the date-wording and concision criteria for Haiku and ships what works (label resolution, Waiting/Blocked, staleness disclaimer); (c) run this Skill on a stronger model — a configuration change outside this issue; (d) a deterministic output check like #23's finalizer — previously ruled out as date middleware. My assessment: if the date-wording criterion is a hard requirement, (a) alone is unlikely to satisfy it and (c) or (d) will probably be needed; if the Product Owner can accept residual model phrasing, (b) is the pragmatic path.
- **Budget note:** this three-turn Session cost $0.14 — A alone was 7¢ because of the full card read. A full four-scenario run needs roughly $0.20–0.25.

### 28.12 Residual #18 caveat

Unchanged: a Skill can request but not force a same-turn fresh read. Scenario D is a live instance — the agent answered a fresh-state question from the previous turn's context with no read. This is the accepted #18 platform limitation and was not addressed in this gate, but it did cost criterion 3 on that turn.

### 28.13 Confirmations

- Paid Managed Sessions: **1** (`sesn_01D98FHE268ZjvHyXd7o1V3i`), **$0.14** of the authorized $0.20.
- Trello mutations: **0**. Calendar calls: **0**.
- Production change: **only** the new `project-health` Skill version `skver_01JLTtMvUgfEqdcBBGj4WGVm` (Agent v17 untouched; model, task-management, daily-planning, weekly-planning, studio-intake, MCP permissions, Calendar unchanged).
- No commit, push, deploy, roadmap edit, or issue update.

## 29. Bounded Sonnet diagnostic — INCONCLUSIVE (ceiling exceeded after Scenario A)

> **Purpose:** does the current reviewed `project-health` Skill behave correctly on Sonnet under the same live Trello evidence where Haiku repeatedly failed? **Diagnostic only** — no production baseline change, no Skill/repo text change, no Trello mutation, no Calendar, no commit/push/deploy, no roadmap edit, no issue update.
>
> **Budget breach, stated up front:** the authorized ceiling was **$0.20**; the Session's reported list cost is **$0.23**. Scenarios B, D, and C were therefore **not run**, and any further spend needs Product Owner approval. Cause in §29.3.

### 29.1 Pre-flight (current production)

- Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v17**, model `claude-haiku-4-5-20251001` / `standard`; five custom Skills all `version: "latest"`; `trelloWriteCard=true` (must not be called), `trelloWriteChecklist=false`, other Trello writes false; Google Calendar default `enabled=false`.
- `project-health` latest = **`skver_01JLTtMvUgfEqdcBBGj4WGVm`**; all five production Skills **byte-identical to the repo** (line endings normalised). No drift. No Skill version was created.
- Local: `npm run typecheck` exit 0; `npm test` 257 / 257 (unchanged).

### 29.2 Diagnostic configuration strategy and config diff

**Strategy — session-level model override, no Agent mutation.** The API supports `agent_with_overrides` at Session creation, so the Session referenced the *unchanged* production Agent (`id` + `version: 17`) and replaced only `model`. This is safer than a clone or an in-place model change: nothing on the Agent or its Skills was edited, so nothing needed restoring.

- **Sonnet model id: `claude-sonnet-5`**, `speed: standard`. I requested `effort: low` (the configuration production used before the move to Haiku), but the resolved Session snapshot shows **no `effort`** — I could not verify it was applied, so effort must be treated as the provider default. This weakens any "low effort" reading of the result.
- Environment, vault, and Memory resource/instructions were identical to normal Djonik Sessions (instructions taken verbatim from `src/djonikClient.ts`). A platform budget of **$0.20** was attached at creation and verified.

**Exact diff, production Agent v17 (pre-test) vs the resolved Session agent, taken before any turn:**

| Path | Pre-test production | Session agent |
|---|---|---|
| `.model.id` | `claude-haiku-4-5-20251001` | `claude-sonnet-5` |
| `.archived_at`, `.created_at`, `.metadata`, `.updated_at` | present | *absent from the Session snapshot* (bookkeeping fields, not configuration) |

`system`, `skills`, `mcp_servers`, `tools`, and `name` are **identical**.

### 29.3 Session, cost, and how the ceiling was exceeded

- **Session: `sesn_01RUA5XNV6FbrhTvY9niKt2z`** — the only Session opened. Status `idle`; budget-limited at 20¢ so it cannot take further model requests without a raised budget.
- **Total list cost: $0.23** (API `list_cost.amount = "23"`; my estimate at 2x Haiku rates was 23.3¢). Scenario A alone cost that; Haiku's Scenario A cost 7¢, so this Sonnet turn was about 3.3x.
- **Why it exceeded $0.20 (per-request breakdown from the event log, estimated at 2x Haiku rates).** Requests 1–9 (a cold-cache first request at ≈5.6¢, then Memory lookups and three searches) cost ≈12.2¢ cumulatively. **Request 10 alone cost ≈11.1¢** — it wrote the 31.8k-token 53-card payload into the cache and generated a 2.6k-token answer — taking the total to ≈23.3¢. The total was well under the ceiling when that request began, so a between-request guard (mine, or the platform cap, which stops *new* requests once the limit is reached) could not have prevented it. My planning error was expecting a Sonnet Scenario A to cost ≈14¢ and running it with only 20¢ available: with Sonnet, the one full-board read plus answer is about 11¢ by itself. The interrupt fired after the final message was already complete (the reply is whole). This was my budgeting error, not a provider fault.

### 29.4 Scenario A (only scenario run) — prompt as authorized

**Read/tool sequence (server-side log, 53 events):**

```text
read /workspace/skills/project-health/SKILL.md
bash rg -il 'extract' /mnt/memory/            (read-only)
read /mnt/memory/djonik-memory/extract.md
trelloSearch(search_boards, "Extract")         → no board
trelloSearch(search_cards, "Extract")
grep + read /mnt/memory/djonik-memory/trello-conventions.md
trelloSearch(search_boards, "Djonik")
trelloReadCard(list_by_board, Djonik, filter: "all")   → 53 cards
```

**Project resolution.** No board named Extract exists; the agent did **not** ask Daniel. It resolved Extract to a label on the shared board using **Memory** (`trello-conventions.md`: "Projects/clients are NOT separate boards — they are represented as labels on the Djonik board"), then read the board's cards directly. It did **not** call `list_labels`, so the new §27 label-discovery rule was **not independently exercised** here (the mapping came from durable Memory, which the Skill allows as context).

**Data note.** `filter: "all"` returned 53 cards, of which 19 are archived (`closed: true`); the earlier Haiku calls used the default filter (34 open cards). The open Extract set is the same **10** cards. The answer was built from open cards only.

**Against the PASS bar:**

| Criterion | Result |
|---|---|
| Skill read; fresh evidence this turn; no ask; no hard-coded mapping | ✅ (mapping from Memory, not code) |
| Zero mutation | ✅ |
| Backlog ≠ Waiting; no unsupported Waiting/Blocked | ✅ «явних Waiting/Blocked карток з лейблом Extract зараз немає» (verified: 0 Extract cards in Waiting, 0 with waiting/blocker text); «Це не "заблоковано"» |
| No invented risk; risk causal; internal due ≠ commitment | ✅ single point of attention: `Брендбук` has a Trello due but sits in Backlog, "потребує старту, **якщо дедлайн реальний**"; suggests verifying the deadline is firm |
| Due wording | ✅ exact `2026-09-25T15:00:00.000Z`; no weekday, no local/Kyiv time, no countdown. It also wrote «(25.09)», a short restatement of the same date (no conversion) |
| Relative-time arithmetic | ✅ none computed. Minor: «**Нещодавно** завершено» is soft relative wording (no arithmetic, no `lastActivityAt` cited) |
| `lastActivityAt` not used as active/progress/stale | ✅ not mentioned at all |
| Concise, no card-by-card dump | ⚠️ **partial fail.** ~1.4k chars in the intended shape (conclusion → evidence → risk → next step), but the four "evidence" bullets **name 9 of the 10 open Extract cards** (all but `Рендер Відео білих ароматів`) grouped by list — the pattern the Skill says not to use |
| No invented facts | ❌ **new failure:** «перевірити з **Анною**, чи дедлайн … твердий». No "Анна" exists in any tool result (Trello payload, the two Memory files it read), the Agent system prompt, or the repo Skills — an **invented person** in the next-step recommendation |

### 29.5 Scenarios B, D, C — not run

The ceiling was already exceeded, so B (Waiting vs Blocked), D (staleness boundary, including the same-turn fresh-read requirement), and optional C (due/risk) were **not run**. This is the main reason the result is inconclusive: the Haiku failures on B (unsupported Waiting) and D (no fresh read; «сьогодні») remain untested on Sonnet.

### 29.6 Haiku vs Sonnet — do the observed #28 failure modes reproduce?

Haiku results are from §26 (second retest) and §28 (final acceptance). Sonnet evidence is Scenario A only.

| Behavior | Haiku | Sonnet (A only) |
|---|---|---|
| Extract label resolution | §26: stalled and **asked Daniel**; §28: resolved via `list_labels` + card read | Resolved **without asking**, via Memory convention + card read; `list_labels` not called |
| Concise output | ❌ 6–10 cards itemised in A, ~8 in B, a 7-row table in D | ⚠️ right shape, but **9 of 10 open cards named** — partly reproduces |
| Backlog vs Waiting | ❌ «Чекають виконання (Backlog)» / «чекає в Backlog» (A) | ✅ Backlog not called waiting; states none waiting |
| Waiting vs Blocked | B: ✅ "nothing blocked"; ❌ Брендбук «Чекає (на клієнта?)» with no evidence | ✅ no unsupported Waiting/Blocked (in A). **B untested** |
| Due wording | ✅ exact ISO, ❌ «через 6 днів», «в пʼятницю» | ✅ exact ISO, no weekday, no countdown |
| Relative date arithmetic | ❌ «6 днів від тепер», «2 дні тому», «вчора», «сьогодні» (A, D) | ✅ none computed (soft «Нещодавно») |
| `lastActivityAt` interpretation | ❌ «без прогресу», "live work", «здається близько»; ✅ correct disclaimer when asked directly (D) | ✅ not used. **D untested** |
| Risk causality | ❌ «критичний дедлайн», invented progress | ✅ causal, hedged, questions whether the due is a real commitment |
| Same-turn fresh reads | A ✅, B ✅ (partial), D ❌ (zero reads) | A ✅. **D untested** |
| Zero-write | ✅ 0 writes, 0 Calendar | ✅ 0 writes, 0 Calendar |
| Invented facts | none observed | ❌ **invented person «Анна»** |
| Cost of Scenario A | ≈ 7¢ | ≈ 23¢ (3.3x; 10 model requests) |

**Not a ranking of models** — this only records which #28 failure modes reproduced.

### 29.7 Zero mutation and zero Calendar (server-side event log, whole Session)

- Trello write calls: **0** (`trelloWriteCard=0`, `trelloWriteChecklist=0`, all others 0).
- Calendar / non-Trello MCP calls: **0**. The only `bash` call was a read-only `rg` of the Memory directory.

### 29.8 Diagnostic verdict — **C. INCONCLUSIVE**

Not verdict A: Sonnet was not a clean pass — it partly reproduced the card enumeration and introduced an invented name — and Scenarios B and D, where Haiku also failed, were not run. Not verdict B: the failure modes that dominated Haiku's results (model-derived weekday/relative time, `lastActivityAt` as progress, unsupported Waiting, "critical" due, invented progress) **did not recur** in Sonnet's Scenario A. The comparison is incomplete because the ceiling was reached, not because of a provider or tool problem. This is **not** a production model decision.

### 29.9 Production baseline — restore proof

Because the override was Session-scoped, **production was never changed and no restore was needed.** Re-read after the diagnostic:

- The full retrieved Agent JSON is **identical** to the pre-test snapshot, including `version` (**17**) and `updated_at` (`2026-09-18T13:08:46.751798Z`).
- `model` = `claude-haiku-4-5-20251001` / `standard`; `system`, `skills`, `mcp_servers`, `tools`, `name` each identical.
- `trelloWriteCard=true`, `trelloWriteChecklist=false`, other Trello writes false; Google Calendar default `enabled=false`.
- Skill latest versions unchanged (`task-management` `skver_012fLb9Z…`, `daily-planning` `skver_01TDfMCn…`, `weekly-planning` `skver_018soRHm…`, `studio-intake` `skver_018sJv1G…`, `project-health` `skver_01JLTtMv…`).
- Nothing was cloned or created. The diagnostic Session `sesn_01RUA5XNV6FbrhTvY9niKt2z` remains `idle` and budget-capped; it holds no production configuration and I did not archive it.

### 29.10 Recommendation for the Product Owner (nothing changed)

1. **The evidence leans toward model capability as a large contributor**, not proof of it: on the same Skill and data, Sonnet did not reproduce the date/activity/Waiting/risk failures in A. But it also shows the Skill does not fully bind even a stronger model on card enumeration, and a stronger model can invent an entity («Анна»).
2. **To get a decisive answer** the cheapest path is to run B and D on this same Session after raising its budget (a budget may be raised, and the cache is warm): roughly $0.08–0.12 per turn, so about $0.20 more for B and D, plus about $0.10 for C. A fresh full four-scenario Sonnet run would cost about $0.50. Additional spend requires your approval; I would recommend the same-Session route.
3. **If Sonnet is later considered for production,** that is a separate cost/quality decision: Scenario A cost about 3.3x Haiku here.
4. **Consider adding "no invented people or entities in recommendations" to the #28 acceptance bar** — it surfaced only on the stronger model and is not currently a criterion.
5. **Process lesson (mine):** a turn that must ingest a ~30k-token tool result can cost about 11¢ in a single request on Sonnet, and neither a guard between requests nor the platform cap can stop a request already in flight. For a pricier model the ceiling must be sized so that the worst single request still fits (here, do not start a full-board-read turn with less than about 12¢ of headroom), or the authorization must be sized for it.

### 29.11 Confirmations

- Paid Managed Sessions: **1** (`sesn_01RUA5XNV6FbrhTvY9niKt2z`), **$0.23** — **$0.03 over** the $0.20 authorization.
- Trello mutations: **0**. Calendar calls: **0**.
- Production change: **none** (Agent v17 and all Skills unchanged; no Skill version created; repo Skill text unchanged).
- No commit, push, deploy, roadmap edit, or issue update.

## 30. Sonnet diagnostic completion — Scenarios B + D — INCONCLUSIVE (D not run)

> **Scope:** complete the §29 Haiku-vs-Sonnet diagnostic with Scenarios B and D on the EXISTING Sonnet Session. No new Session, no Agent/model/Skill change, no Skill version, no repo implementation change, no Trello mutation, no Calendar, no commit/push/deploy, no roadmap edit, no issue update. **Scenario B ran; Scenario D did not** (budget headroom, §30.4). Total spend stayed within the authorization.

### 30.1 Pre-check (no spend)

- Session **`sesn_01RUA5XNV6FbrhTvY9niKt2z`**: `idle`; resolved model `claude-sonnet-5` / `standard`; Agent v17; 53 events containing exactly the Scenario A context (one user turn); list cost **23¢**; **0 Trello writes, 0 Calendar/non-Trello MCP calls** so far.
- Production Agent v17: full retrieved JSON **identical** to the pre-diagnostic snapshot (Haiku, system, Skills, MCP, tools, Calendar disabled).

### 30.2 Budget before/after

| | Ceiling on the Session | List cost |
|---|---|---|
| Before | 20¢ (set at creation, exceeded in §29) | 23¢ |
| Raised to | **32¢** | 23¢ |
| After Scenario B | 32¢ (Session can no longer start requests) | **40¢** |

**Why 32¢, not 45¢.** The authorized absolute ceiling is $0.45. In §29 a single request cost ≈11¢ while the total was still under the cap, and a platform cap only stops *new* requests. So I set the cap at the ceiling minus a worst-case single request (≈13¢): a request begun just under 32¢ could still end at or below 45¢. This is the minimum raise that permits the authorized total while keeping it honest. Only this Session's budget was changed.

- **Added cost: 17¢. Total Session cost: $0.40** (`list_cost.amount = "40"`), $0.05 under the $0.45 ceiling and within the +$0.22 authorization.

### 30.3 Scenario B — Waiting vs Blocked: **FAIL on criterion 1 only; substantively correct**

Prompt sent exactly: `Що тут реально заблоковано, а що просто чекає?`

**Fresh-read sequence: none.** The turn made **1 model request and 0 tool calls** (server-side log). Every claim about list membership, descriptions, and the due came from Scenario A's read, taken 10.5 minutes earlier.

**Assessment against the bar:**

| # | Criterion | Result |
|---|---|---|
| 1 | Fresh Trello evidence in THIS turn | ❌ **none** — answered from the previous turn's payload |
| 2 | Backlog ≠ Waiting | ✅ «Беклог сам по собі — це черга, а не "чекання" чи ризик» |
| 3 | Undated / not-started / empty description ≠ Waiting | ✅ `Брендбук` (empty-description Backlog card with a due): «це не блокер і не waiting» |
| 4 | Waiting only with explicit dependency evidence | ✅ says none: not in the "Waiting" list, no text like «чекаємо відповідь клієнта» (payload check: 0 Extract cards in Waiting, 0 with waiting/blocker text) |
| 5–7 | Waiting ≠ Blocked; Blocked needs a concrete blocker; say so plainly if none | ✅ «Заблоковано: жодної картки… Чекає: теж формально жодної» |
| 8 | No invented people/entities/dependencies | ✅ none («перевірити з клієнтом» is a generic role, not a person) |
| 9 | Concise, no card inventory | ⚠️ 918 chars, no table, but one sentence names six cards by list («по факту все, що є, — це…») |
| 10 | Zero mutation | ✅ |

**Haiku comparison target.** Haiku's B failures — «Брендбук чекає на клієнта» with no evidence, and treating an empty description as "must be waiting" — **did not recur.** Due wording: exact `2026-09-25T15:00:00.000Z`, no weekday/local time/countdown.

### 30.4 Scenario D — not run

- After B the Session stands at 40¢; the platform cap (32¢) already blocks further requests, and only about 5¢ remains to the $0.45 ceiling.
- A compliant D needs a fresh Trello read. Measured from this Session: a full-board read writes about 32k tokens to the cache (≈8¢ at Sonnet rates) plus warm-cache reads of the ≈64k-token context (≈1.3¢) plus the answer, so a worst-case D is **about 10–12¢** against **about 5¢** of headroom. (At the time of writing the cache is still warm — about two minutes after B — so this is the *cheap* case; if D ran after a gap above five minutes it would also re-write the ≈64k-token context, ≈16¢ more.) Because the agent chose a full-board read in Scenario A, I cannot assume a cheaper read; the worst case does not fit under $0.45.
- Per the stop rule: **inconclusive — additional spend requires Product Owner approval.** The staleness boundary and same-turn fresh-read behaviour therefore remain unobserved on Sonnet.

### 30.5 Why B cost 16.6¢ with no tool call (root cause of the budget shortfall)

- The interval between Scenario A ending (06:41:49Z) and B's message (06:52:21Z) was **10.5 minutes**, longer than the 5-minute prompt-cache lifetime. B's single request therefore had to re-create the whole conversation in the cache: `cache_creation 62,613 tokens, cache_read 0, output 988` ≈ **16.6¢** at Sonnet rates.
- The "warm Session" premise behind this authorization (about $0.10 per turn) was wrong: it holds only when turns are within about 5 minutes of each other. **This is my planning error**, not a provider fault.
- **Architectural note (no change made):** Djonik is designed around persistent Sessions with irregular gaps. After any idle gap above ~5 minutes, each turn pays a full-context cache re-write — roughly 8¢ on Haiku and 16–17¢ on Sonnet for a ≈63k-token context — regardless of what the turn does. Cost models and future model choices must include this.

### 30.6 Invented-person/entity and concise-output checks (whole Sonnet Session)

- **Invented entities:** Scenario A: ❌ «**Анна**» (no source anywhere). Scenario B: ✅ none. Scenario D: not run.
- **Concise output:** Scenario A: ⚠️ 9 of 10 open Extract cards named across four grouped bullets. Scenario B: ⚠️ six cards named in one sentence, no table, 918 chars. Neither is a Haiku-style dump or table, but both still list more cards than the Skill's "do not enumerate" rule intends. These are residual style issues and are reported separately from the correctness failures.

### 30.7 Mutation and Calendar counts (server-side event log, whole existing Session)

- Trello write calls: **0**. Calendar / non-Trello MCP calls: **0** across A and B.

### 30.8 Completed Haiku-vs-Sonnet comparison

Haiku = §26 and §28 results; Sonnet = §29 Scenario A plus §30 Scenario B. **Not a ranking of models** — only which #28 failure modes reproduced.

| Behavior | Haiku | Sonnet |
|---|---|---|
| Extract label resolution | asked Daniel (§26); resolved via `list_labels` (§28) | resolved without asking, via Memory convention + card read (A) |
| Concise output | ❌ 6–10 cards itemised (A), ~8 (B), 7-row table (D) | ⚠️ 9 of 10 cards named in grouped bullets (A); 6 cards in one sentence (B) |
| Backlog vs Waiting | ❌ «чекає в Backlog» (A); «Чекає (на клієнта?): Брендбук» (B) | ✅ Backlog is a queue, not waiting (A, B) |
| Unsupported Waiting | ❌ recurred (B) | ✅ did **not** recur |
| Waiting vs Blocked | ✅ "nothing blocked" but unsupported Waiting | ✅ none of either, stated plainly (B) |
| Due wording | ❌ «через 6 днів», «в пʼятницю» | ✅ exact ISO only (A, B) |
| Relative date arithmetic | ❌ «6 днів від тепер», «2 дні тому», «вчора», «сьогодні» | ✅ none computed (soft «Нещодавно завершено», «найближчим часом») |
| `lastActivityAt` interpretation | ❌ «без прогресу», "live work" (A); ✅ correct disclaimer when asked (D) | ✅ never used (A, B). **D unobserved** |
| Risk causality | ❌ «критичний дедлайн», invented «здається близько» | ✅ causal, hedged, questions whether due is a real commitment |
| **Same-turn fresh reads** | A ✅; B ✅ (partial); **D ❌ (no read)** | A ✅; **B ❌ (no read)**; D not run |
| Invented entities | none observed | ❌ «Анна» (A); none in B |
| Zero-write / zero-Calendar | ✅ | ✅ |
| Cost of a turn | A ≈ 7¢ (cold cache) | A ≈ 23¢; B ≈ 17¢ (cache expired) |

### 30.9 Final diagnostic verdict — **C. INCONCLUSIVE**

Not verdict A: D did not run, so the staleness boundary and the fresh-read requirement — one of Haiku's repeated failure classes — are unobserved on Sonnet, and B **itself failed the fresh-read criterion**. Not verdict B: Sonnet did not reproduce the failure classes that dominated Haiku's results — unsupported Waiting, «X днів» / weekday / «сьогодні» date wording, `lastActivityAt` treated as progress, an overstated «critical» due. The classes that **did** recur on Sonnet: (1) no same-turn fresh read (B), (2) residual card enumeration (A, B), and Sonnet added (3) an invented person (A). The inconclusiveness comes from budget headroom, not from a provider or tool limitation.

### 30.10 Architectural implication (no production change)

- **Model capability plausibly explains** the date-wording, unsupported-Waiting, and `lastActivityAt`-misuse failures: identical Skill text and data, and Sonnet did not reproduce them (A, B). It does **not** explain the missing same-turn fresh read, which appears on both models (Haiku D, Sonnet B) — consistent with the accepted #18 platform limitation (a Skill can request but not force a fresh read on every turn). If "fresh read every turn" must be a hard #28 acceptance criterion, no Skill or model choice is likely to satisfy it; it needs either a deterministic mechanism (previously ruled out as middleware) or acceptance criteria that state the limitation.
- **Invented entities and residual enumeration** are not fixed by a stronger model alone (Sonnet exhibited both).
- **Cost** is a separate axis: Sonnet ≈ 2x Haiku list pricing, and idle gaps above the 5-minute cache lifetime make each turn expensive on either model (§30.5).
- **Decision for the Product Owner (nothing changed here):** (a) a decisive D on this Session would need the ceiling raised by roughly **+$0.10** (to about $0.55) and must be run within about five minutes of the previous turn to stay warm — otherwise plan for roughly **+$0.30** for a cold-cache D; (b) treat #18 as an accepted caveat and rewrite the #28 acceptance bar so that same-turn fresh reads are required only where a Skill can plausibly force them; or (c) consider the model question separately for cost and quality.

### 30.11 Confirmations

- Sessions: **the same single existing Session** (`sesn_01RUA5XNV6FbrhTvY9niKt2z`); **no new Session.** Added cost $0.17; total **$0.40** of the $0.45 ceiling.
- Trello mutations: **0**. Calendar calls: **0**.
- Production change: **none.** Agent v17 unchanged; no Skill created or versioned; repo Skill text unchanged. Only this diagnostic Session's own budget cap was raised (20¢ → 32¢).
- No commit, push, deploy, roadmap edit, or issue update.

---

## 31. Wave C1 architecture slice 1 — repo-side Project Health specialist definition

> **Scope:** discovery plus one reviewable, declarative Managed Agent definition, a narrow safety test, and this section. **Configuration source only.** No live Agent was created, and the production Haiku coordinator and its roster are untouched. No inference, no Session, no Trello or Calendar call, no commit/push/deploy, no roadmap edit, no issue update. This supersedes the "specialist subagent is out of scope" line in the original #28 body, per the Product Owner comment and current `docs/01` §9 / `docs/02`.

### 31.1 Official Managed Agents multiagent API findings (fetched 2026-09-19)

Sources: `platform.claude.com/docs/en/managed-agents/` pages `multiagent-orchestration`, `agent-setup`, `tools`, `mcp-connector`, `skills`, `budgets`; the Skills guide for the version-id format. Beta header `managed-agents-2026-04-01`.

**No material contradiction with `docs/01` §9 or `docs/02` was found; the pass proceeded.**

| # | Question | Current official answer |
|---|---|---|
| 1 | Coordinator config shape | On the coordinator agent: `multiagent: {"type": "coordinator", "agents": [ … ]}`. 1–20 entries. Replaced as a whole on update; `null` clears it. |
| 2 | Referenced-agent roster | Entry forms: `{"type":"agent","id":…}`, `{"type":"agent","id":…,"version":<int>}`, `{"type":"self"}`, `{"type":"advisor","model":…}`. Entries must be distinct, non-archived agents. |
| 3 | Version pinning | With `version`, the reference is pinned. Without it, the reference is pinned to the referenced agent's latest version **at the time the coordinator is created or updated**. Either way the roster is a snapshot: a later specialist update is **not** picked up until the coordinator is updated. Matches `docs/01`. |
| 4 | Does delegation require `agent_toolset_20260401` on the coordinator? | **Not stated as a requirement.** Every coordinator example includes it, but the advisor example has `multiagent` and no `tools`. Delegation appears to use platform-provided thread tools (`list_agents`, `send_to_agent`). Production already has the toolset; nothing to change. |
| 5 | Child isolation | "Each agent uses its own configuration: model, system prompt, tools, MCP servers, and skills … Tools, MCP servers, and context are not shared." Each thread has its own conversation history. |
| 6 | MCP/vault across threads | MCP servers are agent-scoped; vault credentials are session-scoped (`vault_ids` apply to every thread). "To limit an agent's access, declare only the servers it needs." Credentials match by normalized URL. |
| 7 | One-level restriction | Referencing an agent that itself has a `multiagent` roster fails create/update with a validation error. |
| 8 | Skill syntax | `skills: [{"type":"custom","skill_id":"skill_…","version":"latest"\|<pin>}]`. Custom versions are `skver_…` ids (Skills guide). |
| 9 | MCP allow/disable | `mcp_toolset` with `default_config: {enabled: false}` and `configs: [{name, enabled, permission_policy}]`; `name` is the bare server tool name. Docs recommend this pattern so tools the operator adds later stay off. |
| 10 | Budget | One shared cap across all threads; each thread priced at its own model; threads pause independently; attachable only at session creation; a request in flight when the cap is crossed still finishes. |
| 11 | Delegation result | The child's report reaches the primary thread as `agent.thread_message_received` (`from_agent_name`, `content`); the coordinator's task is `agent.thread_message_sent`. Full child activity is only on the child's own thread stream. Threads are **persistent**: a follow-up to the same child keeps its earlier context. |

Additional findings that shape the design:

- **MCP permission default.** The docs say an `mcp_toolset` defaults to `always_ask`; production shows explicit `always_allow`. A child thread waiting on confirmation is cross-posted to the primary thread as `requires_action` and would stall the turn. The specialist therefore sets `always_allow` explicitly on each enabled read.
- **Inference geo.** Coordinator and roster members must all pin the same `inference_geo` or all leave it unset. Production Haiku has none; the specialist sets none.
- **Session overrides do not reach roster agents.** Overrides apply to the coordinator and its `self` copies only, so the earlier session-level model-override diagnostic pattern does not apply to a specialist.
- **Persistent threads and freshness.** A reused specialist thread retains prior Trello payloads. That is a stale-evidence hazard for a fresh-evidence capability, so the system contract tells the specialist that earlier turns are not evidence.

### 31.2 Installed SDK compatibility

`@anthropic-ai/sdk` **0.125.0** already exposes everything needed; **no upgrade is required.** `AgentCreateParams` accepts `multiagent`, `skills`, `mcp_servers`, `tools`; roster entries are typed (`BetaManagedAgentsAgentParams` has `id`, `type`, optional numeric `version`); `BetaManagedAgentsCustomSkillParams` has `skill_id`, `type`, optional `version: string`; `BetaManagedAgentsMCPToolsetParams` has `default_config` and `configs`; `beta.sessions.threads` exists.

Verification: a scratch (not committed) file declared the specialist's exact shape `satisfies Anthropic.Beta.Agents.AgentCreateParams` and a future roster entry `satisfies BetaManagedAgentsMultiagentRosterEntryParams`; `tsc` passed. A negative control (an added unknown key) failed with `TS2353`, so the check does reject bad shapes. The scratch file copies the shape by hand; the committed test in §31.8 is what guards the repo file.

### 31.3 Read-only live discovery (GET only)

Calls: `beta.agents.retrieve`, `beta.skills.list`, `beta.skills.retrieve`, `beta.skills.versions.list`. Nothing else.

- Production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh`: **v17**, `claude-haiku-4-5-20251001` / standard, `multiagent: null`, five custom Skills all `version: "latest"`, no `inference_geo`.
- MCP servers: `trello` → `https://mcp.trello.com/v1`; `google-calendar-calendarmcp` → `https://calendarmcp.googleapis.com/mcp/v1` (toolset default `enabled:false`).
- Trello toolset: default `enabled:true` / `always_allow`; `trelloWriteCard` enabled; `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, `trelloWritePlanner` disabled.
- `project-health`: Skill `skill_01Treson5zdU1TgxXDaREwnY`, latest `skver_01JLTtMvUgfEqdcBBGj4WGVm` (2026-09-19T06:28:52Z); earlier versions `skver_012ckoEp…`, `skver_015toifw…`. The repo `SKILL.md` (LF-normalized sha256 prefix `c64318f46da417db`) matches the §28.2 sync, so the pinned version is the reviewed text.
- **Not done:** enumerating the Trello MCP server's live tool list. That needs the vault credential and a Session, which this pass may not create. Tool names come from the repo's recorded evidence (below); `default_config.enabled:false` means any name not listed, including future ones, stays off.

### 31.4 Isolation semantics that the specialist config relies on

| Aspect | Semantics | Consequence in the definition |
|---|---|---|
| Model | Per agent | Specialist `claude-sonnet-5`; coordinator stays Haiku. |
| System prompt | Per agent | The specialist has its own short contract. Nothing from the Djonik system prompt is inherited. |
| Tools | Per agent, not shared | Declared explicitly; not copied from the coordinator. |
| MCP servers | Per agent | Only `trello` is declared. Calendar is unreachable even though the session vault may hold a Calendar credential. |
| Skills | Per agent (session cap 500, deduplicated) | One Skill, attached explicitly and pinned. |
| Context | Separate thread history; persistent per thread | The specialist cannot see the Telegram conversation; the coordinator must delegate a self-contained task. Old thread context must not count as evidence. |
| Vault credentials | Session-scoped, matched by URL | The existing Trello credential works for the specialist's identical URL; no new credential. |
| Budget | One shared session cap | Specialist spend counts against the same session budget at Sonnet rates. |

### 31.5 Specialist configuration architecture

New file: **`managed-agents/project-health-specialist.md`**, in the official declarative `ant apply` format (YAML frontmatter = agent configuration; body = `system`). This is the smallest explicit convention; no existing Managed Agent config-source convention existed in the repo (only Skills under `.claude/skills/`). `managed-agents/README.md` documents it: reviewed source only, not read by runtime code, applying it is a live change needing PO authorization. It is deliberately not under `.claude/agents/`, which is Claude Code's own subagent location.

```yaml
name: Djonik Project Health Specialist
model: claude-sonnet-5
skills:  [ custom project-health, pinned skver_01JLTtMvUgfEqdcBBGj4WGVm ]
mcp_servers: [ trello https://mcp.trello.com/v1 ]
tools:
  - agent_toolset_20260401   # default disabled; only `read` enabled
  - mcp_toolset trello       # default disabled; four reads enabled, always_allow
# no multiagent, no calendar, no custom tools
```

**Built-in `read` only.** Attached Skills are loaded by the agent reading `/workspace/skills/<name>/SKILL.md`; the recorded production sessions (§24, §28) show that as the first tool call. The docs describe this `read` dependency for repository Skills; that it also applies to an attached Skill inside a child thread is **inferred, not verified**, and is a named live-acceptance check (§31.13). `bash`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search` stay disabled.

**Effort is left unset.** The Sonnet diagnostic (§29–§30) ran at the provider default effort (the requested `low` was not applied through the session-level override), so the specialist matches what was actually measured. Setting agent-level `effort` is a cost decision for later.

### 31.6 Trello reads exposed, and why

Names come from the repo's recorded evidence (`docs/04` tool inventory and the §24/§28/§29 event logs), not a live tool listing.

| Tool | Why required | Live evidence |
|---|---|---|
| `trelloSearch` | Skill: discover a candidate board/list/card (discovery only). | Called in the recorded health sessions (§24, §26, §28, §29). |
| `trelloReadBoard` | Board and label resolution (`list`, `get`, `list_labels`). | Called in §26 and §28. |
| `trelloReadCard` | Authoritative card fields: list/status, description, `due`, labels, `lastActivityAt` (`list_by_board`, `get`). | Called in the recorded health sessions (§24, §26, §28, §29). |
| `trelloReadList` | The Skill names it as an authoritative direct read for list state. | **Never observed live.** Kept because the Skill requires it by name; a candidate to drop if acceptance shows it is unused. |

**Excluded on purpose:** `trelloReadMember` and `trelloReadChecklist` (the Skill allows them only conditionally, when a fresh result actually exposes assignment or progress; nothing recorded demonstrates they are needed), and `trelloReadInbox`, `trelloReadPlanner`, `trelloReadWorkspace` (the Skill states it does not need them). **Known mismatch:** the Skill text still mentions member/checklist reads as optional, and the specialist cannot call them. If live acceptance shows checklist or assignment evidence matters, adding them is a one-entry change to this file.

### 31.7 Proof that all Trello writes and Calendar are excluded

- **Writes.** The Trello toolset is `default_config: {enabled: false}` and lists no `trelloWrite*` name; the string `trelloWrite` appears nowhere in the file. Every enabled name matches `^trello(Search|Read)`. A new write tool the provider adds later is also off by default.
- **Calendar.** No Calendar server or toolset is declared anywhere in the frontmatter, and MCP servers are agent-scoped, so the specialist has no path to Calendar even though the session vault may contain a Calendar credential.
- **Enforced by test and checked by mutation** (§31.8): adding a write tool, enabling the Trello default, adding a Calendar server, un-pinning the Skill, enabling `bash`, adding a `multiagent` roster, and dropping an `always_allow` each fail the tests (7/7 mutations caught; file restored byte-identical).
- **Not yet proven:** the API's resolved read-back of the created agent. That is a required check when the agent is actually created (§31.13).

### 31.8 Test added

`src/managedAgentConfig.test.ts` — 8 narrow tests on one file, no framework: Sonnet model and no roster; exactly one pinned custom Skill; Trello-only with exactly the four reads; explicit `always_allow` on each; zero Trello mutation; no Calendar in the declared config; built-in toolset default-off with only `read`; and the system-contract boundary phrases plus a length bound. The tests use line-based patterns over the regular YAML, matching the repo's existing Skill-test style, because no YAML parser is installed and none was added.

### 31.9 Skill ID / version strategy

- Attach only `project-health`: `skill_01Treson5zdU1TgxXDaREwnY`, pinned to `skver_01JLTtMvUgfEqdcBBGj4WGVm`, the repo-identical reviewed text. The Skill contents are not copied into the system prompt.
- **The pin format is documented but not yet proven for Managed Agents.** The Skills guide documents `skver_…` version ids for pinning, and the SDK types `version` as a string. The Managed Agents Skills page says only "pin to a specific version". The first agent create will confirm it.
- **Asymmetry to decide later.** The production coordinator references this Skill as `latest`. A new `project-health` version would change the coordinator silently while the specialist stays pinned. The Skill text is unchanged in this pass; the coordinator/Skill ownership move is deferred to the acceptance-gated slice.

### 31.10 Specialist system-contract rationale

The body is about 1.9k characters and refers to the Skill instead of duplicating it. Requirement → contract line:

| Requirement | Contract line |
|---|---|
| Receives delegated work; result is relayed | Opening paragraph: reply is relayed by the coordinator "as-is"; Ukrainian by default. |
| Grounded in fresh evidence; project health is interpretation | "Ground every current-state claim in Trello data you read during this task … read again"; "interpretation of evidence, not stored truth". Explicitly demotes earlier thread turns, the coordinator's message and Memory (the persistent-thread hazard). |
| Waiting ≠ Blocked; Backlog ≠ Waiting | Stated verbatim as binding. |
| `lastActivityAt`; no derived weekday/local/countdown | Two short lines; timestamps quoted as recorded ISO only. |
| No invented people, entities, dependencies, commitments, risk | Explicit rule, aimed at the "Анна" failure seen on Sonnet (§29.4). |
| Concise, no inventory | Explicit rule, aimed at the residual card enumeration seen on Sonnet (§29–§30). |
| Self-contained result | Return shape: scope used, conclusion, evidence, supported risk, one next step, unknowns; a clarification question if the project is ambiguous; no tool/Skill talk. |
| Zero mutation | "You are read-only … outside your role and hand it back". |

This does **not** address #18. Nothing forces the specialist to read fresh data on every delegated turn; the contract only requires that it read or say it could not. The same-turn fresh-read limitation remains a platform limitation.

### 31.11 Handoff boundary deferred to the next slice (not implemented)

1. **Roster attachment by explicit id and version.** Update the production Agent so `multiagent` is `{"type":"coordinator","agents":[{"type":"agent","id":"<specialist agent id>","version":<specialist version>}]}`. Both values come from the specialist's create response. `agents.update` replaces `tools`, `skills` and `multiagent` as whole values, so the update must resend the full existing arrays; supply `version: 17` for optimistic concurrency. Updating the specialist later requires a reviewed coordinator roster update.
2. **Faithful relay.** For delegated Project Health, Haiku must relay the specialist's factual interpretation and must **not** independently recompute or reinterpret: dates; weekday or countdown wording; Waiting vs Blocked; `lastActivityAt`; risk; people or entities. It should also relay a clarification question or a "could not read fresh data" statement as given, and add no project claims of its own.

   Must **not** happen:
   ```text
   Specialist:   due = 2026-09-25T15:00:00Z
   Coordinator:  «дедлайн у пʼятницю через 6 днів»
   ```
3. **Ownership move.** `project-health` moves from the coordinator to the specialist only after delegated acceptance (`docs/01` §9); until then production is unchanged, and the coordinator keeps its current Skill.
4. **Adapter and telemetry, not inspected here.** `src/djonikClient.ts` has no handling of thread events (`session_thread_id`, `agent.thread_message_*`, `requires_action`). The next slice must confirm unknown events cannot break a turn and that telemetry separates coordinator and specialist usage (`docs/01` §9; per-thread `usage` is exposed on thread retrieval). Existing verify-after-write and the #23 finalizer do not apply, since the specialist is read-only.
5. **Budget.** Guardrail sizing for any live acceptance must account for Sonnet rates, the coordinator's own Haiku turns in the same shared session budget, and the cache-cold cost measured in §30.5.

### 31.12 Files changed

- `managed-agents/project-health-specialist.md` — new; the reviewed specialist definition.
- `managed-agents/README.md` — new; the config-source convention.
- `src/managedAgentConfig.test.ts` — new; 8 narrow safety-invariant tests.
- `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` — this section appended.

Unchanged: `docs/02_DEVELOPMENT_ROADMAP.md`, `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`, all Skills, `src/` runtime code, `package.json`, issue #28.

### 31.13 Explicitly deferred work

- Creating the specialist Agent resource, and reading it back to confirm the resolved tool configs (no write tool enabled, Calendar absent), the `skver_` pin, the Sonnet model and the default effort.
- Verifying that a child thread can load an attached Skill with only `read` enabled, and how session memory instructions reach a child thread.
- Coordinator roster attachment, coordinator prompt/Skill changes, and the relay-fidelity rules (§31.11).
- Delegated live validation and cost A/B, under a declared spend guardrail (`docs/04` §27), with coordinator and specialist usage reported separately.
- Deciding on `trelloReadMember` / `trelloReadChecklist`, keeping or dropping `trelloReadList`, and agent-level `effort`.
- Any change to the `project-health` Skill text, including the residual specialist-level verbosity and invented-entity risks measured on Sonnet.
- Thread-event handling in the thin Telegram adapter; #18 remains a platform limitation.

### 31.14 Explicit confirmation

- **No inference**, and **no paid Managed Session**. Inference spend: **$0.00**.
- **No Agent create/update/archive.** Only `agents.retrieve` was called.
- **No Skill create/update.** Only `skills.list`, `skills.retrieve`, `skills.versions.list` were called.
- **No Trello call or mutation.** **No Calendar call.**
- **No commit, push, deploy, branch, roadmap edit, or issue update.**
- Checks: see the final verification below.

### 31.15 Final verification (after the test-portability fix)

The first run of this slice was red: `npm test` reported 264 pass / 1 fail. The failing test was `project-health Skill exists with valid frontmatter` in `src/skills.test.ts`. This was a test portability problem, not a Skill-content problem: on this Windows checkout `core.autocrlf=true` writes `.claude/skills/project-health/SKILL.md` as CRLF (the index holds LF), while the `readSkill()` helper read raw UTF-8 and the Skill tests assume LF.

**Fix (test-only, one line):** `readSkill()` in `src/skills.test.ts` now normalizes CRLF/CR to LF (`.replace(/\r\n?/g, "\n")`) so every Skill test sees canonical newline text. No assertion was weakened or removed, no second helper was added, and `.claude/skills/project-health/SKILL.md`, Git config, runtime code and the Managed Agent definition were not changed.

Final results:

- `npm run typecheck`: passed, exit 0.
- `npm test`: **265 tests, 265 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo.** The 8 managed-agent configuration tests in `src/managedAgentConfig.test.ts` still pass (8/8).
- `git diff --check`: exit 0.
- `git status --short`:

```text
 M docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md
 M src/skills.test.ts
?? docs/16_ISSUE_28_SPECIALIST_SLICE1_REPORT.md
?? docs/17_ISSUE_28_TEST_EOL_FIX_REPORT.md
?? managed-agents/
?? src/managedAgentConfig.test.ts
```

No inference, no Session, no Agent or Skill create/update, no Trello or Calendar call, no commit/push/deploy, no roadmap or issue change.

---

## 32. Wave C1 architecture slice 2 — real standalone Project Health specialist Agent

> **Scope:** create the reviewed specialist from `managed-agents/project-health-specialist.md` as a real, versioned, standalone Managed Agent via `ant apply`, verify the stored resource, and record it. **Not attached to production Djonik.** The only live change was creating one Agent. 0 Sessions, 0 `user.message` events, $0 inference, 0 Trello calls, 0 Calendar calls; no commit, push or deploy; no roadmap or issue change.

### 32.1 Official `ant apply` / API semantics verified (fetched 2026-09-19)

Source: `platform.claude.com/docs/en/cli-sdks-libraries/cli/apply` and the CLI quickstart. **No discrepancy with the reviewed definition or with `docs/01` / `docs/02`; the slice proceeded.**

- `ant apply` requires CLI **≥ 1.30.0**. The frontmatter is the agent's create-request fields and the Markdown body is `system`.
- Kind inference, first match wins: (1) a top-level `type` field, (2) the directory (`agents/`, `environments/`, `memory_stores/`, `deployments/`), (3) a file name starting with the kind. "A **named** Markdown file that matches none is treated as an agent." The reviewed file has no top-level `type`, sits in `managed-agents/`, and is named `project-health-specialist.md`, so it matches none and is an agent only because it is named on the command line. That is why `ant apply .` must not be used: a directory walk would skip it. The path did not need to change.
- `claude-lock.json` is written in the directory `ant apply` runs from. It records the resource id, version, the organization/workspace, and two hashes (`hash` of what was sent, `remote_hash` of what the API returned).
- Without a terminal, `--yes` is required to apply. `--dry-run` prints the detailed plan and changes nothing. `--force` (not used) overwrites out-of-band edits.
- `ant apply` cannot adopt an existing resource: only lockfile entries are managed, and applying a file that describes an existing agent creates a second one. **Consequence for the next slice:** production Djonik was not created by `ant apply`, so its roster update must be a direct `agents.update` (or `ant beta:agents update`) with an explicit specialist id and version, not an `ant apply` of a coordinator file.
- Skill reference: an object such as `{type: custom, skill_id, version}` is "sent to the API as written", so the `skver_` pin passes through unchanged.
- `ant apply` refuses credentials that resolve to a different organization/workspace than the lockfile, so later applies are bound to this workspace.

### 32.2 Pre-flight (no mutation)

- Working tree clean at `ddf75fc`; no `claude-lock.json` existed.
- **`ant` was not installed** (no Go, no Homebrew). With explicit Product Owner approval I downloaded the official release `ant_1.34.0_windows_amd64.zip` (9,754,437 bytes) from `github.com/anthropics/anthropic-cli` (release v1.34.0, Latest), verified its SHA-256 (`6f0d96db9e16e129120b0d9d284f0123ecaff2b5755022a45cff04fbd792d222`) against the release's `ant_1.34.0_checksums.txt`, and extracted it into the session scratchpad only: no global install, no PATH/registry change, nothing inside the repository. **`ant version 1.34.0`** satisfies ≥ 1.30.0.
- Authentication: `ANTHROPIC_API_KEY` from the repository's existing `.env`, passed as a process environment variable. It was never printed or written anywhere; the lockfile holds no secrets.
- Production Agent (retrieved with `ant beta:agents retrieve`): `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **version 17**, `claude-haiku-4-5-20251001` / standard, `multiagent: null`, five custom Skills all `latest`, MCP servers `trello` and `google-calendar-calendarmcp` (Calendar toolset default `enabled:false`), `trelloWriteCard` enabled and the other five Trello write tools disabled. The full JSON was saved as a byte-exact baseline (5,362 bytes, sha256 prefix `a7339692ff19`).
- Workspace inventory: exactly one agent existed (production), so there was no name collision and nothing to adopt.
- Skill pin: `skver_01JLTtMvUgfEqdcBBGj4WGVm` exists (`name: project-health`, created 2026-09-19T06:28:52Z) and is still the Skill's `latest_version_id`.
- Target: organization `06870e1a-3b11-4fdc-ba26-a3ed6b0ab15c`, workspace `wrkspc_012dgYerRAUo4ayusy4MtteG`, host `api.anthropic.com`. That workspace is the one holding the production Agent, since the same key retrieved it.

### 32.3 Dry run (`ant apply --dry-run --verbose managed-agents/project-health-specialist.md`)

Exit 0. The complete plan was:

```text
First apply  ./claude-lock.json does not exist yet and will be created
Resources will be created with
  credentials   API key (--api-key / ANTHROPIC_API_KEY)
  host          api.anthropic.com
  organization  06870e1a-3b11-4fdc-ba26-a3ed6b0ab15c
  workspace     wrkspc_012dgYerRAUo4ayusy4MtteG
Preview  ./claude-lock.json (new)
+ ./managed-agents/project-health-specialist.md  create
    description, mcp_servers, model, name, skills, system, tools  (= the reviewed file)
Resources  + 1 to create
```

**PASS:** exactly one `create`, no update, archive, delete or adopt of any existing resource. The shown fields equal the reviewed file: `model: claude-sonnet-5`; `skills: [{custom, skill_01Treson5zdU1TgxXDaREwnY, skver_01JLTtMvUgfEqdcBBGj4WGVm}]`; `mcp_servers: [trello]`; built-in toolset default-disabled with only `read`; Trello toolset default-disabled with the four reads. The dry run wrote no lockfile.

### 32.4 Apply

`ant apply --yes managed-agents/project-health-specialist.md`, no `--force`, one file, not repo-wide. Exit 0:

```text
+ ./managed-agents/project-health-specialist.md  created    agent_01KNiQDzzPjaMU6LLF4mU6uM
Resources  + 1 created
State written to ./claude-lock.json
```

**Specialist: `agent_01KNiQDzzPjaMU6LLF4mU6uM`, version 1**, created 2026-09-19T07:59:48.705453Z.

### 32.5 Read-back against the repo definition (official SDK `agents.retrieve`)

A read-only script compared the stored resource with the repo file and the lockfile: **31 checks, 30 PASS, 1 FAIL that was a checker flaw and is resolved below.**

| Area | Stored value | Result |
|---|---|---|
| Identity | name `Djonik Project Health Specialist`; type `agent`; `archived_at: null`; version 1; description and empty metadata as reviewed | PASS |
| Model | `{"effort":{"type":"high"},"id":"claude-sonnet-5","speed":"standard"}`; no `inference_geo`; "haiku" appears nowhere in the resource | PASS |
| Multiagent | `multiagent: null` (no roster; it cannot delegate further) | PASS |
| Skills | exactly `[{"type":"custom","skill_id":"skill_01Treson5zdU1TgxXDaREwnY","version":"skver_01JLTtMvUgfEqdcBBGj4WGVm"}]`: pinned, not `latest`, no other Skill | PASS |
| MCP servers | exactly `[{trello, url, https://mcp.trello.com/v1}]` | PASS |
| Built-in tools | default-disabled; enabled set is exactly `read`; no `bash`, `write`, `edit`, `glob`, `grep`, `web_*` | PASS |
| Trello toolset | `mcp_server_name: trello`; `default_config.enabled: false`; enabled allowlist exactly `trelloSearch`, `trelloReadBoard`, `trelloReadList`, `trelloReadCard`, each `always_allow` | PASS |
| Custom tools | none | PASS |
| System | equals the repo body exactly after trimming; 1,934 characters | PASS |
| Top-level keys | exactly the standard set; no generated extras | PASS |

The one FAIL was my "no `calendar` anywhere in the stored resource" check, which scanned the whole JSON including the system prose that deliberately says "no Calendar" (the same trap as in the repo test, §31.8). Re-run against the declared configuration only (everything except `system`): **no `calendar` or `googleapis`, false**; the only Calendar mention is that sentence in the prose.

**Resolved values the reviewed file did not spell out (recorded, no action):**

- **Effort resolved to `high`.** The reviewed file leaves `effort` unset, so the API filled in `claude-sonnet-5`'s default. This settles the §31.5 note that the Sonnet diagnostic ran at "provider default": that default is `high`. The Sonnet cost figures in §29–§30 were therefore measured at high effort, and lowering effort is an open cost decision (deferred; see §32.11).
- The Trello toolset's own `default_config.permission_policy` resolved to `always_ask`, but it is moot because the default is disabled; the four reads carry explicit `always_allow`.
- The built-in `read` entry resolved with `type: read` and `always_allow`.

### 32.6 Proof of zero Trello writes, zero Calendar, no roster

- **Trello writes:** `default_config.enabled: false`; the enabled set is exactly the four `trelloSearch`/`trelloRead*` names; the string `trelloWrite` does not occur anywhere in the stored `tools`; no custom tools exist. Any tool the Trello server adds later stays disabled.
- **Calendar:** no Calendar MCP server or toolset is stored. MCP servers are agent-scoped, so the specialist cannot reach Calendar even if the session vault holds a Calendar credential.
- **Roster:** `multiagent: null`.
- **Not proven, and not claimable without a Session:** that the Trello server's live tool names match these four names. They come from recorded evidence (§31.6); the API stores allowlist names without checking them against the server.

### 32.7 `claude-lock.json`

Created at the repository root by `ant apply` (not hand-edited, no secrets), exactly one resource entry:

```json
{
  "version": 1,
  "origin": {
    "base_url": "https://api.anthropic.com",
    "organization_id": "06870e1a-3b11-4fdc-ba26-a3ed6b0ab15c",
    "workspace_id": "wrkspc_012dgYerRAUo4ayusy4MtteG"
  },
  "resources": {
    "./managed-agents/project-health-specialist.md": {
      "kind": "agent",
      "id": "agent_01KNiQDzzPjaMU6LLF4mU6uM",
      "version": "1",
      "hash": "d7cf3e7f66452caee16e5f6cb358956a",
      "remote_hash": "a53a95e4bc87d0ade000d4e6f8f39006"
    }
  }
}
```

It maps the reviewed file to the new Agent id and version 1, and there is no unexpected extra entry. The lockfile holds the organization and workspace identifiers (not credentials); committing it discloses them in the repository. A second `ant apply --dry-run` of the file reported **"Everything is up to date. Resources 1 unchanged"** and left the lockfile byte-unchanged, so the lockfile and remote state agree.

### 32.8 Production coordinator after creation

Production was re-retrieved and its JSON is **byte-identical** to the pre-flight snapshot (5,362 bytes, sha256 prefix `a7339692ff19` both times): same id `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **version 17**, `updated_at` `2026-09-18T13:08:46.751798Z` unchanged, `claude-haiku-4-5-20251001`, same system prompt, five Skills (all `latest`), MCP servers, tools and Trello write toggles, `multiagent: null`, Calendar toolset default `enabled:false`. Production does not reference the specialist id anywhere. The workspace now has exactly two agents (production and the specialist). The specialist has no Sessions (its Session list is empty; the newest Session in the workspace, `sesn_01RUA5XN…`, was created at 06:40Z, before the specialist existed at 07:59Z). It is unreachable from production.

### 32.9 Files changed

- `claude-lock.json` — new; generated by `ant apply`, one entry.
- `managed-agents/README.md` — status updated: the specialist now exists as a live standalone agent (`agent_01KNiQDzzPjaMU6LLF4mU6uM`, v1), still not attached to production; one convention added about applying a named file from the repo root.
- `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` — this section.

Unchanged: `managed-agents/project-health-specialist.md`, the `project-health` Skill and every other Skill, `docs/01`, `docs/02`, all `src/` code, `package.json`, issue #28. Scratch artifacts (the `ant` binary and its zip, the dry-run/apply transcripts, the production before/after JSON, the stored specialist JSON, and the read-back script) live only in the session scratchpad.

### 32.10 Verification

- `npm run typecheck`: passed, exit 0.
- `npm test`: **265 tests, 265 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo.**
- `git diff --check`: exit 0. Git printed only the non-failing notice that `managed-agents/README.md` will be converted LF to CRLF on the next touch.
- `git status --short`:

```text
 M docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md
 M managed-agents/README.md
?? claude-lock.json
```

### 32.11 Limitations / deferred work

- **Not exercised:** no Session, so nothing is proven about runtime behavior: Skill loading in a child thread with only `read`, the four Trello tool names against the live server, MCP authentication for the specialist, and delegated Project Health quality.
- **Effort is `high`** by default; lowering it (a new specialist version) is a later cost decision with measured evidence.
- **Coordinator roster attachment** and the faithful-relay rules remain the next reviewed slice (§31.11). The roster entry will be `{"type":"agent","id":"agent_01KNiQDzzPjaMU6LLF4mU6uM","version":1}`, applied to production with a direct `agents.update` (`version: 17`, whole `tools`/`skills`/`multiagent` arrays resent), not via `ant apply` (it cannot adopt the existing production agent, §32.1).
- Editing the specialist file later and re-applying creates version 2, and the coordinator stays pinned to version 1 until its roster is updated.
- The `claude-lock.json` is uncommitted, as required; committing it and this section is a manual Product Owner step.
- Delegated live acceptance under a declared spend guardrail, coordinator/specialist usage separation, adapter thread-event handling, and #18 (a platform limitation) are unchanged.

### 32.12 Explicit confirmation

- **0 Sessions created; 0 `user.message` events; $0 inference.**
- **0 Trello calls; 0 Calendar calls.**
- **Live changes: exactly one Agent created** (`agent_01KNiQDzzPjaMU6LLF4mU6uM`, v1). No Agent update or archive, no production coordinator change, no roster, no Advisor, no Skill create/update.
- Read-only API/CLI calls only otherwise: `agents.retrieve`, `agents.list`, `skills.retrieve`, `skills.versions.retrieve`, `sessions.list`, and two `--dry-run` applies.
- No commit, push, deploy, branch, roadmap edit, or issue change.

---

## 33. Wave C1 architecture slice 3 — isolated validation coordinator

> **Scope:** create exactly one **temporary, validation-only** coordinator Agent so native delegation to the specialist can be validated in the next slice without touching production. One live change: one Agent created. **0 Sessions, 0 `user.message` events, $0 inference, 0 Trello calls, 0 Calendar calls.** Production Djonik, the specialist, `claude-lock.json`, Skills, `docs/01`, `docs/02` and issue #28 are untouched; no commit, push or deploy.

### 33.1 Current official API discovery (fetched 2026-09-19)

Sources: `platform.claude.com/docs/en/managed-agents/` pages `sessions`, `multiagent-orchestration`, `agent-setup`. The installed SDK 0.125.0 was checked as well. **No discrepancy with `docs/01`, `docs/02` or the expected finding was found; the slice proceeded.**

- **Session overrides cannot carry a roster.** The `agent_with_overrides` form accepts `model`, `system`, `tools`, `mcp_servers` and `skills` only ("include any of `model`, `system`, `tools`, `mcp_servers`, or `skills`"), and the SDK type `BetaManagedAgentsAgentWithOverridesParams` has exactly those fields plus `id`, `type` and `version`. There is no `multiagent`, `name` or `description` override. Overrides never merge (a `tools` override must list every tool), and a `model` override drops the agent's `effort`.
- **Overrides do not reach roster agents.** They apply to the coordinator and its `self` copies; "roster entries referenced by ID are unaffected".
- **Roster semantics unchanged from §31.1:** `multiagent: {type: coordinator, agents: [...]}`; an entry `{type: agent, id, version}` pins that version, and an omitted version pins the latest at create/update time; the roster is a snapshot of the coordinator's creation or update, so later specialist updates are not picked up. Delegation is one level deep; a referenced agent with its own roster fails validation. The coordinator's and every roster member's `inference_geo` must all match or all be unset (all unset here).
- **Threads and budget:** one shared session budget across all threads, each thread priced at its own model; threads are persistent; a child's report reaches the primary thread as `agent.thread_message_received`.

### 33.2 Why a temporary coordinator instead of a session override

The delegated topology (Haiku coordinator → pinned Sonnet specialist) needs `multiagent` on the coordinator, and a session override cannot supply it (§33.1). The only ways to run it are to update production Djonik's roster, which the canonical decision forbids until delegated acceptance, or to run the topology on a separate agent. This slice therefore creates one standalone validation coordinator that reproduces production v17 apart from the intentional differences. It exists only for #28 validation, is not tracked in `claude-lock.json`, and has no repo-side config file.

### 33.3 Production pre-flight (read-only)

Working tree clean at `cd3ff89`. Production `agent_01WGRHDBjQa3eMhoGJMmQ1dh`: **version 17**, `updated_at` `2026-09-18T13:08:46.751798Z`, `claude-haiku-4-5-20251001` / standard (no `effort`, no `inference_geo`), `multiagent: null`, system prompt 2,256 characters ending "…actually available in the current environment.", five custom Skills all `latest` (`task-management`, `daily-planning`, `weekly-planning`, `studio-intake`, `project-health` = `skill_01Treson5zdU1TgxXDaREwnY`), MCP servers `trello` (`https://mcp.trello.com/v1`) and `google-calendar-calendarmcp` (`https://calendarmcp.googleapis.com/mcp/v1`), `agent_toolset_20260401` fully enabled with `always_allow`, Trello toolset default enabled with only `trelloWriteCard` enabled among the writes, Calendar toolset default `enabled:false`. The canonical (key-sorted) snapshot was saved to scratch (sha256 prefix `9033962c176e59db`) and deep-equals the slice-2 baseline.

### 33.4 Specialist pre-flight (read-only)

`agent_01KNiQDzzPjaMU6LLF4mU6uM`: **version 1**, `updated_at` `2026-09-19T07:59:48.705453Z`, not archived; `claude-sonnet-5` / standard, effort resolved `high`; `multiagent: null`; exactly one Skill, pinned `skill_01Treson5zdU1TgxXDaREwnY@skver_01JLTtMvUgfEqdcBBGj4WGVm`; MCP `trello` only; built-in toolset default-disabled with only `read`; Trello default-disabled with exactly `trelloSearch`, `trelloReadBoard`, `trelloReadList`, `trelloReadCard`; no `trelloWrite*`; no Calendar in the declared config; version matches `claude-lock.json`. 21 of 21 substantive pre-flight checks passed. Canonical snapshot sha256 prefix `42cf1fd9e714845a`.

### 33.5 Exact system addendum (appended after the untouched production prompt, separated by `\n\n`)

```text
Project Health delegation:

For a current Project Health or nuanced project-condition assessment (for example the condition, risks, blockers, waiting work, or health of a named project), delegate the review to the "Djonik Project Health Specialist" agent instead of assessing it yourself. Send it a self-contained task: the project Daniel named and what he asked, in his own words. The specialist reads fresh Trello evidence and owns the PM interpretation for that review. For each new Project Health question, delegate again; do not answer it from an earlier specialist reply.

When the specialist responds, relay its factual interpretation faithfully and concisely, in Ukrainian. Do not recompute or reinterpret anything it states: Trello dates and any weekday, local-time, or countdown wording; Waiting versus Blocked; what lastActivityAt shows; risk; or people, entities, dependencies, and commitments. Do not add new factual project claims of your own. If it asks a clarification question, relay that question. If it says fresh evidence was unavailable, relay that limitation.

All other work, including planning, creating or changing tasks, and other project questions, stays with you and your existing Skills and tools.
```

Scope audit: 1,228 characters, native coordinator reasoning only (no phrase list, no router). "Delegate again for each new question" is a deliberate freshness measure because specialist threads are persistent; it does not add an enforcement mechanism, so #18 is unaffected. It states no behaviour beyond delegation, faithful relay, and ownership of everything else.

### 33.6 Exact validation-coordinator config diff (request built from the retrieved production v17)

Created through the official SDK (`client.beta.agents.create`), not `ant apply`. Compared field by field with production before sending:

| Field | Request vs production v17 |
|---|---|
| `name` | **different:** `Djonik Project Health Validation Coordinator` |
| `description` | **different:** `Temporary Issue #28 validation coordinator for native Project Health delegation. Not production.` |
| `model` | identical: `{"id":"claude-haiku-4-5-20251001","speed":"standard"}` |
| `system` | **different:** production text byte-for-byte as prefix + `\n\n` + addendum (2,256 → 3,484 characters, +1,228) |
| `tools` | identical (retrieved array passed through unchanged) |
| `mcp_servers` | identical (Trello and Calendar) |
| `skills` | **different:** `project-health` (`skill_01Treson5zdU1TgxXDaREwnY`) removed; the other four unchanged, all `latest` |
| `multiagent` | **different:** `{"type":"coordinator","agents":[{"type":"agent","id":"agent_01KNiQDzzPjaMU6LLF4mU6uM","version":1}]}` |
| `metadata` | identical (`{}`) |

A guard aborted if an agent with the same name already existed. No other live mutation was needed.

### 33.7 Created validation coordinator

**`agent_01GFCLFYq6uLRHG8vMCrAgeK`, version 1**, created 2026-09-19T08:11:45.095674Z, not archived. It is **temporary**: it must be archived after the #28 delegated validation is complete (§33.13).

### 33.8 Complete read-back comparison (fresh `agents.retrieve` of the new agent vs production v17)

33 checks (the coordinator comparison plus the production, specialist and Session checks), **33 PASS, 0 FAIL.**

- **Unchanged from production:** model deep-equals production (Haiku, no `inference_geo`, no `effort`); `tools` deep-equal; `mcp_servers` deep-equal; the Calendar server and its toolset (`default_config.enabled:false`) equal production exactly; Trello write toggles as production (`trelloWriteCard` the only enabled write); `metadata` equal; the production system text is a byte-for-byte prefix and the remainder is exactly `"\n\n" + addendum`; the non-`project-health` Skills equal production in order and fields.
- **Intentional differences only:** name and description as specified; `project-health` absent; one appended addendum; one pinned roster entry.
- **No unexpected top-level keys.**

### 33.9 Roster pins specialist v1; no other agents

Stored `multiagent` is exactly `{"type":"coordinator","agents":[{"type":"agent","id":"agent_01KNiQDzzPjaMU6LLF4mU6uM","version":1}]}`. The resolved `version` is the number 1 (strictly), the roster has one entry, and it contains no `self`, no Advisor, and no other agent.

### 33.10 `project-health` Skill absent from the validation coordinator

Stored `skills` are the four production Skills (`skill_01WS6JtY…`, `skill_01G9DtQE…`, `skill_01PTmbvL…`, `skill_015c8dtD…`), all `custom` and `latest`. The string `skill_01Treson5zdU1TgxXDaREwnY` appears nowhere in the coordinator's `skills`. In the target topology the Skill lives only on the specialist, pinned.

### 33.11 Other Skills, tools and MCP preserved

Deep equality with production for `tools` (built-in toolset, Trello toolset with its six write toggles, Calendar toolset) and `mcp_servers`, and equality of the four remaining Skills, confirm nothing else drifted.

### 33.12 Production and specialist before/after

Production was re-retrieved after the create and compared with the pre-flight snapshot: the canonical JSON is **byte-identical** (sha256 prefix `9033962c176e59db` before and after). Same id, **version 17**, `updated_at` `2026-09-18T13:08:46.751798Z`, Haiku, system, five Skills (including `project-health` still attached), MCP servers, tools, and `multiagent: null`. It references neither the specialist id nor the validation coordinator id. The specialist is likewise byte-identical (v1, `42cf1fd9e714845a` before and after). The workspace now holds exactly three agents (production, specialist, validation coordinator), all unarchived. `sessions.list` filtered by the validation coordinator's id and by the specialist's id both return nothing, and the newest Session in the workspace (`sesn_01RUA5XN…`, 06:40Z) predates both agents.

### 33.13 Confirmations, and the temporary status

- **0 Sessions created; 0 `user.message` events; $0 inference; 0 Trello calls; 0 Calendar calls.** No delegation was tested.
- **Live change: exactly one Agent created** (`agent_01GFCLFYq6uLRHG8vMCrAgeK`, v1). No production update or roster change, no specialist update, no Skill change, no Advisor.
- Other API calls were read-only: `agents.retrieve`, `agents.list`, `sessions.list`.
- **The validation coordinator is temporary.** It duplicates production's configuration by design and would drift as production evolves. It must be **archived** once #28 delegated validation is complete, and must not be used for real traffic. Archiving is a separate live action needing Product Owner authorization.

### 33.14 Files changed, verification and deferred work

- **Repo diff: only `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md`** (this section). No config file was created for the temporary agent; `claude-lock.json`, `managed-agents/*`, Skills, `docs/01`, `docs/02`, and `src/` are unchanged. Scratch artifacts (request/created/stored JSON, canonical snapshots, scripts) live in the session scratchpad only.
- `npm run typecheck`: passed, exit 0. `npm test`: **265 tests, 265 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo.** `git diff --check`: exit 0.
- **Deferred to the next slice:** a Product Owner-approved spend/Session guardrail (`docs/04` §27) declared before any delegated inference; delegated live validation of faithful relay on the validation coordinator (including the three named failure cases: a specialist due of `2026-09-25T15:00:00Z` rendered as «у пʼятницю через 6 днів», «no supported Waiting evidence» turned into «чекає на клієнта», and «`lastActivityAt` does not prove progress» turned into «активно рухається»); runner support for a multiagent Session (the existing `connectToDjonik` and the adapter have no thread-event handling, §31.11); coordinator/specialist usage reporting. Still unproven without a Session: that delegation works at all, that the specialist can load its Skill with only `read`, the Trello tool names against the live server, and specialist quality. Effort `high` on the specialist and #18 remain open as before.
