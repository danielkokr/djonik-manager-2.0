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
