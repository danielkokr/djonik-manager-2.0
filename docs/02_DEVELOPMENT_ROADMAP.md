# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state — governance decision 2026-09-21

Foundations 1–12, studio intake Wave B and Project Health #28 retain their historical acceptance. #29 discovery/source work was accepted but its production attach failed live behavior; recorded Agent v21 rolled back to the accepted v19 configuration, with PH specialist v4. Work-review is retained remotely but unattached and unaccepted. An already-serving Telegram Session has not been attested by this audit.

**Update 2026-09-22 — #29 superseded (Product Owner decision; [docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md)).** #29 asked a current-state-only review to answer a weekly question the connected tool surface cannot evidence. The second production-like Haiku diagnostic (`docs/16` §31) failed on due-time rendering, concision and a vague actor claim, after correct discovery. The architecture audit found that Trello itself records an authoritative action history (REST board actions: list moves, archive, `dueComplete`, time, actor) that only the official Trello MCP does not yet expose. #29 is closed as superseded; its discovery, rubric and live evidence remain historical record. The zero-inference spike returned GO ([docs/23](23_WORK_HISTORY_SPIKE_REPORT.md)) and canonical NOW became [#36](https://github.com/danielkokr/djonik-manager-2.0/issues/36) (now blocked by #40; see the runtime-audit update below). GitHub texts: [docs/22](22_ISSUE_29_SUPERSESSION_DRAFTS.md).

**Update 2026-09-22 — runtime audit; canonical NOW is #40 (Product Owner decision; [docs/30](30_RUNTIME_EVENT_LOOP_AUDIT.md)).** The latest #36 live diagnostic ([docs/29](29_ISSUE_36_FACTUAL_RELAY_LIVE_DIAGNOSTIC.md)) proved the deterministic Variant-B work-history facts correct and the visible reply beginning with them exactly. It also exposed a generic runtime defect below the product layer: the client executed the same custom-tool event twice after two legitimate `session.status_idle{requires_action}` events named the same unresolved `custom_tool_use_id`. The independent audit (decision **B — refactor the custom-tool continuation abstraction**) keeps the persistent stream / FIFO / anchoring architecture and requires a per-id continuation lifecycle ([docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) §13). That runtime problem was accepted in [#40](https://github.com/danielkokr/djonik-manager-2.0/issues/40) at commit `e5b0df2d8eb520c139a2c6f41bc0b95e726cb352` ([docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md)). The canonical NOW therefore returns to #36 for its one separately authorized live diagnostic.

The [architecture audit](17_DJONIK_V1_ARCHITECTURE_AUDIT.md) exposes uncovered deterministic verification/completion/relay cases despite 330 passing baseline tests. These are reachable offline failures, not a claim of production frequency. Fix those boundaries before further review-model experimentation. #18 conditional fresh-read enforcement, due-clearing provider limitations, disabled Calendar and previously accepted intake caveats remain unchanged.

Governance [#30](https://github.com/danielkokr/djonik-manager-2.0/issues/30) records this authorized docs/issues handoff. Documents are local until explicitly committed/published; a fresh checkout with the old roadmap must obtain this change before implementing the new queue. #30 stays open pending publication/PO closeout; its open state does not select implementation scope.

## Canonical delivery queue

**Update 2026-09-22 — no "v1 release".** Product Owner decision: the target is a normal working PM agent, not a release milestone ([docs/00](00_DJONIK_PRODUCT_CONTRACT.md#working-pm-baseline--product-owner-decision-2026-09-22-replaces-the-2026-09-21-v1-release-boundary), [PM-agent audit docs/25](25_PM_AGENT_BEHAVIOR_AUDIT.md)). The queue below is the canonical order. #35 becomes a two-week working-rhythm pilot.

### DONE — Reliability: verify every Trello mutation against its own target and result (#31)

Accepted 2026-09-21 at commit `591b406934b650eae059275ca92abd7e2d31503c`.

Verified outcome:
- every Trello mutation is tracked independently against its own tool-use/result identity and target;
- create verification is anchored to the actual card identity returned by the successful mutation;
- each mutation requires its own authoritative post-write direct-card evidence and supported field postconditions;
- failed, ambiguous, mismatched or unverified mutations cannot be represented as successful by model prose;
- due extraction is anchored to the verified card object and preserves the accepted Europe/Kyiv #23 safeguard;
- audit regressions R1/R2/R6 are covered;
- focused tests passed 175/175, full suite passed 411/411, typecheck and `git diff --check` passed;
- live Trello result-shape validation remains deferred to a separately authorized bounded smoke.

### DONE — Reliability: correlate turn completion and preserve specialist results safely (#32)

Accepted 2026-09-21 at commit `82f50cdd8d51fc389e11ab3b71f62b7535297a80`.

Verified outcome:
- only authoritative `end_turn` completes a visible turn; budget/retry/action/incomplete stops cannot surface partial text as success;
- late specialist results cannot replace a later ordinary turn, and reused child threads require current-turn engagement;
- canonical Project Health specialist identity remains stable with unrelated roster entries;
- verified Project Health output remains authoritative byte-for-byte;
- ambiguous, missing, duplicate, malformed or incomplete specialist outcomes fail visibly rather than silently falling back to coordinator Project Health reasoning;
- #31 mutation verification, #23 due safeguards, FIFO and telemetry remain intact;
- focused tests passed 230/230, full suite passed 459/459, typecheck and `git diff --check` passed;
- live `user.message` echo/anchor behavior and mixed-intent production behavior remain for later explicitly authorized smoke validation.

| Order | Bounded issue | Start / acceptance condition |
|---|---|---|
| 1 | [#31 — Trello mutation verification](https://github.com/danielkokr/djonik-manager-2.0/issues/31) | DONE |
| 2 | [#32 — Turn completion and specialist results](https://github.com/danielkokr/djonik-manager-2.0/issues/32) | DONE |
| ~~—~~ | ~~[#29 — Current-state review and ownership validation](https://github.com/danielkokr/djonik-manager-2.0/issues/29)~~ | Superseded 2026-09-22 by #36 ([docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md)) |
| 3 | [#40 — Idempotent Managed Agents custom-tool continuation by event id](https://github.com/danielkokr/djonik-manager-2.0/issues/40) | DONE — accepted 2026-09-22 at `e5b0df2` ([docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md)) |
| 4 | [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36) | DONE — accepted 2026-09-22; post-#40 live diagnostic PASS at `3312706` ([docs/32](32_ISSUE_36_POST_40_LIVE_DIAGNOSTIC.md)) |
| 5 | [#37 — Project label on create + Memory hygiene](https://github.com/danielkokr/djonik-manager-2.0/issues/37) | DONE — accepted 2026-09-23; source+Memory at `e1f9a31`, final isolated live smoke PASS at `71975a0` ([docs/33](33_ISSUE_37_SOURCE_AND_MEMORY_PROPOSAL.md), [docs/34](34_ISSUE_37_FINAL_LIVE_SMOKE.md)) |
| 6 | [#38 — Voice and Telegram UX](https://github.com/danielkokr/djonik-manager-2.0/issues/38) | DONE — accepted 2026-09-24: ordinary coordinator on Sonnet 5 medium/standard ([docs/46](46_ISSUE_38_ENRICHED_TRELLO_PLANNING_SMOKE.md)), Project Health F3 composition at `1014c05` ([docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md)), final live PH smoke PASS at `210a26d` ([docs/49](49_ISSUE_38_FINAL_PROJECT_HEALTH_LIVE_SMOKE.md)); closeout [docs/50](50_ISSUE_38_CLOSEOUT_AND_33_PROMOTION.md) |
| 7 | **NOW — [#33 — Pinned release, always-on host, serving Session](https://github.com/danielkokr/djonik-manager-2.0/issues/33)** | Promotes the accepted #40 runtime revision together with accepted #36/#37/#38; always-on adapter host and secrets (see #33 comments). Scope decomposition and first bounded step: [docs/50](50_ISSUE_38_CLOSEOUT_AND_33_PROMOTION.md) §5–§6. Start source-only; no Agent/Skill update, serving switch, deployment or secret migration without separate authorization |
| 8 | [#34 — Commitments, waiting and follow-up](https://github.com/danielkokr/djonik-manager-2.0/issues/34) | After #33; accepted plan items keep Trello card ID/project; check dates feed #39 |
| 9 | [#39 — Working rhythm: brief, Monday plan, Friday review, exception signals](https://github.com/danielkokr/djonik-manager-2.0/issues/39) | Depends on #40; after #33 (host) and #34; design in [docs/25](25_PM_AGENT_BEHAVIOR_AUDIT.md) §5 and [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) §10 |
| 10 | [#35 — Working-rhythm pilot (≈ two working weeks)](https://github.com/danielkokr/djonik-manager-2.0/issues/35) | After #39; Daniel decides what works and what to change next |

Only one item is NOW. The next item starts when this roadmap is updated. There is no parallel source work: we intentionally return to one NOW item to reduce variables. Live runs follow docs/04 §27 one at a time.

**#38 model decision and migration — 2026-09-23:** The Product Owner discontinued Haiku as coordinator after repeated live failures in [docs/36](36_ISSUE_38_LIVE_VOICE_VALIDATION.md) and [docs/37](37_ISSUE_38_TARGETED_LIVE_REVALIDATION.md), informed by [docs/38](38_DJONIK_COORDINATOR_MODEL_ARCHITECTURE_AUDIT.md). Production Agent v21 → v22 changed only the model to **Claude Sonnet 5, effort low, speed standard**; Project Health remains the separate Sonnet 5 specialist pinned at v4. The accepted repo prompt is still not the live Agent prompt: production retained its previous prompt because this was a model-only update. The remaining gate is a small live Sonnet 5 low acceptance smoke, not another Haiku comparison. Until that smoke passes, #38 stays open and #33 is not NOW. Existing serving Sessions keep their creation-time model configuration; #33 handles the serving transition.

**#38 configuration synchronization — 2026-09-23:** The subsequent authorized v22 → v23 update changed only the production Agent's `system` field to the accepted `managed-agents/djonik.md` prompt (2572 bytes; SHA-256 `fa361ed9…817f`). Model, Skills, tools, MCP, permissions, Calendar state and specialist v4 roster were unchanged. A separate idle Session pinned to v23 is prepared for the small smoke with read-only Memory; it has no events, tokens or list cost. The preceding v21 → v22 paragraph records that earlier step and is superseded as a *current configuration* statement by this update. No Telegram serving Session transition occurred; #38 remains NOW until smoke PASS.

**#38 Sonnet 5 low acceptance smoke — 2026-09-23:** The subsequent isolated v23 smoke ran five visible turns for $0.37 list cost, with zero external writes and authoritative `end_turn` throughout. It **FAILED**: Project Health again produced `coordinator_withheld`; the ambiguity reply contained two sentences; the first ordinary-voice reply was too long for `Коротко`; and the direct PM reply derived the wrong weekday from a freshly read Trello due date. Exact outputs, per-turn costs/latencies and tool evidence are in [docs/39](39_ISSUE_38_SONNET_5_LOW_MODEL_MIGRATION_REPORT.md). This supersedes the preceding paragraph's *current* zero-usage/prepared-smoke statement. No prompt, Agent, tool, specialist or runtime change follows from this result. The next separately decided coordinator candidate for reasoning/instruction-following is Sonnet 5 medium. **#38 remains canonical NOW; #33 is not promoted.**

**#38 medium-effort follow-up — 2026-09-23:** Product Owner authorized changing only primary Agent effort from Sonnet 5 low to medium and repeating the same isolated acceptance smoke. Production v23 → v24 applied exactly that model-field change with a version-23 concurrency precondition. Read-back showed the same prompt SHA, Skills, tools/permissions, MCP, specialist v4 and all other configuration fields. This supersedes the preceding paragraph's *next candidate* statement as a current-state action; its low-effort evidence remains historical. Medium acceptance is pending; #38 remains canonical NOW and #33 is not promoted.

**#38 medium acceptance result — 2026-09-23:** The fresh v24 isolated Session ran all five matching turns for **$0.51** list cost, zero writes and authoritative `end_turn`. It **FAILED**: A still produced `coordinator_withheld`; B still missed the one-sentence/no-unsupported-project clarification criterion; C1 was too long for `Коротко`; C2 added pseudo-precise claims and mixed English; D was freshly grounded and avoided the low-effort weekday error but was too long. Exact outputs, provenance, low-vs-medium comparison and metrics are in [docs/39](39_ISSUE_38_SONNET_5_LOW_MODEL_MIGRATION_REPORT.md). The preceding paragraph's *pending-smoke* statement is superseded as current status. Because B/C/D also failed materially, stop for Product Owner decision on whether to test higher effort or a stronger model; the relay-only `specialist_only` decision branch does not apply. **#38 remains canonical NOW; #33 is not promoted.**

**#38 clean medium revalidation — 2026-09-23:** Product Owner review identified a methodological confound in the preceding medium B result: it followed A in one Session, so its Extract mention could have been normal continuity. The new bounded run used **three independent v24 Sessions** for B, C1+C2 and D, with no shared history across scenarios; it cost **$0.26** total, with zero writes and authoritative `end_turn` throughout ([docs/39](39_ISSUE_38_SONNET_5_LOW_MODEL_MIGRATION_REPORT.md)). Clean B had fresh evidence for an Extract video card, so the prior “unsupported Extract mention” judgment is withdrawn; it nevertheless made an unsupported completion-date claim from `lastActivityAt` and narrated its search. C1 again missed `Коротко` and had a malformed word; C2 made an unsupported memory-timing claim; D treated `lastActivityAt` as work progress, conflated Waiting with blocked, and claimed spare time without capacity evidence. **Ordinary Sonnet 5 medium still materially fails.** Do not raise effort automatically; Product Owner decides whether to test high effort or a stronger model. PH exact relay remains a separate composition issue. **#38 remains canonical NOW; #33 is not promoted.**

**#38 source-only instruction/rubric alignment — 2026-09-23:** The preceding model-choice sentence is superseded as the *current next action*: Product Owner froze model escalation at Sonnet 5 medium/standard. [docs/40](40_DJONIK_INSTRUCTION_ARCHITECTURE_AUDIT.md) identified shared factual semantics missing from the coordinator's active contract and criteria stricter than that contract. Local source updates propose one global coordinator block, narrow planning/task Skill alignment and a contract-derived [rubric](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md); previous FAIL reports are not relabeled PASS. Production v24, remote Skills and existing serving Sessions remain unchanged. #38 remains NOW and unaccepted; diff review precedes any separately authorized live validation. #33 is not promoted.

**#38 remote synchronization — 2026-09-23:** After Product Lead review, the Product Owner authorized syncing the accepted source to Managed Agents without paid inference. This supersedes the preceding paragraph's *production v24 and remote Skills unchanged* statement as current state. The `task-management`, `daily-planning` and `weekly-planning` Skills received new versions that are byte-identical to their repo files: `skver_01CJQkVY1kp1urhBWQgHUYxW`, `skver_01EL7d3fy4WWYBSsD3PmK9LQ` and `skver_01FdtnnkbePBjNJGTuJyAvhw`. The previous remote task-management predated #37, so the accepted #37 label rules now reach the production Skill as well. `studio-intake` was already identical and was not re-versioned. Primary Agent v24 → **v25** changed only the prompt (3529 B, SHA-256 `3e204453…b4b6`, byte-identical to `managed-agents/djonik.md`). The model stays Sonnet 5 medium/standard as the frozen baseline. Skills remain `latest`, and tools, MCP, permissions and specialist v4 are unchanged. Isolated Session `sesn_015pyFLex524B9ASrk8fxHHP` is prepared: pinned to v25, Memory `read_only`, no events, zero tokens and cost, and a 1¢ backstop. **Paid validation has not run.** The next gate is the docs/41 contract-derived smoke, pending its own authorization and budget. The Telegram serving path was not switched. Details are in [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md). **#38 remains canonical NOW and unaccepted; #33 is not promoted.**

**#38 contract-derived live smoke — 2026-09-23:** The Product Owner authorized one bounded smoke with a $1.20 total ceiling. It ran three independent Sessions pinned to v25, all with read-only Memory: B `sesn_015pyFLex524B9ASrk8fxHHP`, C `sesn_01AdHUP9u2gCjH5r9NU1MGkb` and D `sesn_01PbKLQFE5xYpSmsS5R62LLH`. The four turns cost **$0.31** list cost. All four ended with an authoritative `end_turn`, and there were zero external writes. [docs/43](43_ISSUE_38_CONTRACT_DERIVED_LIVE_SMOKE.md) records the grading against [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md). B, C1 and C2 had no hard failure; they had soft voice observations and one borderline uncited research claim in C2. D had **one hard failure**: it said “без дедлайну — чекає без ризику”, although the model had read the daily-planning rule “Do not equate no due date with low urgency” in that same turn. This is classified as an explicit-instruction model failure. Completion-date inference and activity-as-work are fixed. Waiting=Blocked was not exercised. Due semantics recurred with the opposite polarity. This supersedes the preceding paragraph's *paid validation has not run* statement. The ordinary coordinator is **not accepted**. The result led to no prompt, Skill or effort change and no retry. Next: Product Owner review. Project Health composition remains a separate step. **#38 remains canonical NOW; #33 is not promoted.**

**#38 ordinary coordinator accepted — 2026-09-23 (Product Owner decision):** One isolated v25 Session (`sesn_0179PBufPGSoW3y3mWub8ocX`, Sonnet 5 medium/standard, Memory `read_only`) repeated the D planning prompt after Daniel enriched the Trello card descriptions. It cost **$0.21**, ended with `end_turn` and made zero writes ([docs/46](46_ISSUE_38_ENRICHED_TRELLO_PLANNING_SMOKE.md)). The main task was chosen from explicit description evidence, activity-as-work did not recur, and Waiting was handled correctly. “Можуть почекати день без наслідків” is still too strong. The agent's initial grading was a narrow HARD FAIL. The Product Owner and Product Lead accepted the run as **PASS WITH SOFT OBSERVATION**, treating that line as an overconfident PM formulation rather than a blocker. This supersedes the preceding paragraph's *ordinary coordinator not accepted* statement: **ordinary coordinator behavior on Sonnet 5 medium/standard is accepted for #38.** Model escalation is closed. There is no model, effort, prompt or Skill change, and no further planning smoke. The same run showed that the official Trello MCP `list_by_board` returns `checklists: []` even for cards that have checklists, and it does not expose Custom Field `Size`. This is recorded as a tool limitation, not a #38 blocker. [docs/45](45_TRELLO_AI_PROJECT_MANAGEMENT_AUDIT.md) remains design evidence, not deployed instruction. **The next and final bounded #38 area is Project Health composition** ([docs/47](47_ISSUE_38_PROJECT_HEALTH_COMPOSITION_AUDIT.md), audit only). **#38 remains canonical NOW; #33 is not promoted.**

**#38 Project Health composition — final live smoke PASS, 2026-09-23:** The Product Owner rejected F1 (coordinator-evidence gate) because it could silently lose a tool-free part of a mixed request. F3 was accepted and committed at `1014c05`: the #32 composition semantics are unchanged, and the technical `coordinator_withheld` notice is replaced by one natural sentence ([docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md)). One authorized pure-PH turn («Як там Extract?») ran through the real `connectToDjonik()` → `sendOrdered()` path in a fresh Session, `sesn_01KBcYnkpka5aP8e9q3WqAWQ`. The configuration was v25 Sonnet 5 medium/standard with specialist v4, Memory `read_only` and a 45¢ backstop. The coordinator natively delegated to canonical specialist v4. There was exactly one same-turn plain-text result, and both child and parent ended with `end_turn`. The coordinator's final text paraphrased the result and differed from it, so the mode was `coordinator_withheld`. The visible reply was exactly the specialist bytes plus the separator and the new cue. Neither the coordinator's prose nor the interim message leaked, and the old notice was absent. The run cost **$0.24**, with zero Trello, Memory and Calendar writes and no Agent, Skill or prompt change ([docs/49](49_ISSUE_38_FINAL_PROJECT_HEALTH_LIVE_SMOKE.md)). This supersedes the preceding paragraph's *next area* statement. **#38 is ready for Product Lead review and closeout decision; it is not closed, and #33 is not promoted.**

**#38 ACCEPTED; #33 promoted to NOW — 2026-09-24 (Product Owner decision; [docs/50](50_ISSUE_38_CLOSEOUT_AND_33_PROMOTION.md)).** This supersedes every preceding *#38 remains NOW / #33 not promoted* statement. #38 is accepted on the evidence at `210a26d6`: the ordinary coordinator on Sonnet 5 medium/standard (docs/46, PASS WITH SOFT OBSERVATION); final-only Telegram delivery (source regressions from `bb755be`; interim `agent.message` text did not leak live in docs/49); and Project Health F3 composition at `1014c05` (docs/48), with the final live smoke through `connectToDjonik()` PASS (docs/49, $0.24, zero Trello/Memory/Calendar writes). Remaining observations are non-blocking and deferred: the Trello MCP does not expose Custom Fields or checklists through bulk `list_by_board`, enriched board payloads cost more (docs/46: 43 KB, 14¢ → 21¢), and there are minor PM wording imperfections. **Canonical NOW is [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33).** Its first bounded step is source-only (docs/50 §6); #34 and later items are not promoted.

**#33 source hardening — 2026-09-24 (implementation report, pending review; [docs/51](51_ISSUE_33_PRODUCTION_RELEASE_HARDENING.md), runbook [docs/52](52_PRODUCTION_SERVING_RUNBOOK.md)).** Source/offline only; no Agent, Skill, Session, Trello, Memory, secret or deploy change, and no paid inference. The release unit is the provider's Agent version, made immutable by explicit `skver_` pins and bound to the app revision and Session resources in reviewed `src/release.ts`. Serving Sessions are pinned to `{id, version}`, tagged `source/release/app_revision`, and attested fail-closed at startup (Agent-version preflight, then the Session's own snapshot) before Telegram is polled. The shutdown is graceful: polling stops, accepted fragments flush and in-flight turns drain; 409 and 401 exit cleanly. This revision serves **r25** (production v25; `latest` Skills proven to resolve to the accepted versions). **r26** is the fully specified target: explicit pins, accepted #36 work-review + `trello_work_history`, and a built-in allowlist without `bash`/`web_*`. The Agent v26 update body is generated from source. Session continuity is process-scoped by decision (Memory is the durable layer). Recommended host: small VPS + systemd; fallback: Railway. Remaining steps each need Product Owner authorization (docs/51 §18): accept r26 contents, rotate the Trello read token (expires about 2026-10-22), create Agent v26, provision the host, flip `SERVING_RELEASE`, deploy, run the serving-boundary smoke. **#33 remains canonical NOW.**

### Acceptance record — #40 / #36 / #37 / #38

**#40 — ACCEPTED 2026-09-22:** principal offline pass accepted at `e5b0df2`; exact docs/29 regression failed pre-fix and passed post-fix; full suite 495/495, typecheck and `git diff --check` passed; no paid inference ([docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md)).

**#36 — ACCEPTED 2026-09-22:** one isolated post-#40 Haiku Session reproduced the provider's duplicate-`requires_action` sequence for the same `custom_tool_use_id`; the accepted runtime executed and submitted the tool once, kept provenance verified, exact-relayed the deterministic Variant-B factual block byte-for-byte, completed on authoritative `end_turn`, and made zero Trello/Calendar/Memory writes. The run used one Session / one visible turn and cost $0.03 ([docs/32](32_ISSUE_36_POST_40_LIVE_DIAGNOSTIC.md)). Haiku repeated the factual report inside the model-owned PM section; this was explicitly graded as a non-hard UX observation and is deferred to real working-rhythm observation rather than another #36 hardening loop.

**#37 — ACCEPTED 2026-09-23:** source + Memory phase accepted at `e1f9a31` ([docs/33](33_ISSUE_37_SOURCE_AND_MEMORY_PROPOSAL.md)); Memory was migrated only after exact id/path/version/SHA preconditions matched and 31/31 post-write checks passed. The final isolated real-provider gate ([docs/34](34_ISSUE_37_FINAL_LIVE_SMOKE.md), committed at `71975a0`) passed all 22 hard criteria: fresh board-label resolution, exactly one card created in Inbox, separate `attach_label`, direct same-card post-write verification with both mutations `verified`, and a separate no-project Session that asked one clarification and made zero writes. Total deliberate smoke cost was $0.09; production Agent and production Skill remained unchanged. Non-hard observations (board-resolution noise, a blocked `bash`/curl workaround attempt, and interim agent messages) are not #37 blockers; interim-message delivery is directly in #38 scope.

**#38 — ACCEPTED 2026-09-24:**
- ordinary coordinator accepted on production Agent v25, Claude Sonnet 5 medium/standard ([docs/46](46_ISSUE_38_ENRICHED_TRELLO_PLANNING_SMOKE.md), $0.21, PASS WITH SOFT OBSERVATION); model escalation is closed;
- repo-source coordinator prompt `managed-agents/djonik.md` is byte-identical to v25 (SHA-256 `3e204453…b4b6`);
- final-only Telegram delivery is protected by source regressions (`bb755be`);
- Project Health F3 natural cue at `1014c057` ([docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md)); final live PH smoke PASS through `connectToDjonik()` ([docs/49](49_ISSUE_38_FINAL_PROJECT_HEALTH_LIVE_SMOKE.md), $0.24, zero writes). It showed native delegation to specialist v4, one verified same-turn result, exact specialist bytes, withheld coordinator prose, no old notice, and child + parent `end_turn`;
- evidence HEAD `210a26d6`.

Non-blocking, deferred: Trello MCP Custom Fields and bulk checklist exposure (tool limitations), enriched-payload cost, minor PM wording (“без наслідків”, “робота триває”).

Scope promotion requires updating this roadmap; an open/closed issue or larger number never selects the next task by itself. Share later authorized smoke evidence where sufficient instead of duplicating paid runs. The current [validation policy](04_MANAGED_AGENT_TOKEN_COST_AUDIT.md#27-development--validation-spend-guardrail-issue-21) requires explicit budget, candidate isolation, full-turn admission reserve and stop reasons; this governance change authorizes no paid experiment.

## Historical execution / acceptance record

The entries below preserve earlier accepted scope and evidence. They are not universal guarantees: #31 extends #8/#23 verification coverage, #32 extends #28 completion/relay coverage, and #33 verifies actual serving configuration.


### DONE — Foundation 1: Real Djonik Managed Agent + first Console Session (#1)
Accepted 2026-09-15.

### DONE — Foundation 2: Thin repo client for the existing Djonik Managed Agent (#2)
Accepted 2026-09-15 at commit `ca7c82401059853d6fa7485d7b24c205e48829d3`.

### DONE — Foundation 3: Telegram adapter to the existing Djonik Managed Agent (#3)
Accepted 2026-09-15 at commit `43b976e16c52c8090b9e585c03141d3520e4e7a5`.

### DONE — Foundation 4: Durable Claude Memory Store across Djonik sessions (#4)
Accepted 2026-09-15 at commit `8617e691c0e791ce5efe6c80876383491f915ec0`.

### DONE — Foundation 5: First custom Skill — task-management (#5)
Accepted 2026-09-15 at commit `478cd60c604392fdce3ae3b56624fa7c6299f7df`.

### DONE — Blocker: Session vault wiring and retryable MCP errors (#6)
Accepted 2026-09-15 at commit `ddbd3dfb117ff4da16f15598619499f686a4b53e`.

### DONE — Foundation 6: Trello read surface through Claude MCP (#7)
Accepted 2026-09-15.

### DONE — Foundation 7: Trello write surface with verified mutations (#8)
Accepted 2026-09-15 at commits `842352a0e90b143f2e5d397e92586ea4673cf696` and `5bec33a53c1e57eed2edb53ad5cceb01d3e77be6`.

Verified foundation:
- `trelloWriteCard` is the bounded enabled mutation tool;
- create/update/move work against live Trello;
- every claimed card write is backed by a same-card verification read;
- unrelated reads cannot satisfy verification;
- one bounded corrective nudge is allowed, then fail-closed.

### DONE — Foundation 8: Conversational PM validation across Telegram and Trello (#9)
Accepted 2026-09-15 at commits `f1a25bae9ad441d3dabb8ccfe6f6832cffaf7e97` and `b46824bb9a815be1d1f345e3b7503d9d63b6c727`.

Verified foundation:
- realistic Telegram scenarios A–F passed;
- referents and corrections resolve to the intended task without duplicates;
- advice-only turns cause zero mutation;
- live-state answers use fresh Trello evidence;
- ambiguity produces clarification and zero write;
- durable Memory survives a new Session while live Trello outranks remembered task state;
- dead Managed Sessions are invalidated and transparently reconnected;
- typecheck passed, tests passed 30/30, and `git diff --check` was clean.

### DONE — Foundation 9: Daily planning Skill and work-context reasoning (#10)
Accepted 2026-09-16 at commit `d95c0e85ed6287078e944c64bbe26cce01c00b9a`.

Verified foundation:
- custom `daily-planning` Skill exists in Claude workspace and is attached to the existing Djonik agent;
- canonical source is `.claude/skills/daily-planning/SKILL.md`;
- daily plans are grounded in fresh Trello reads;
- planning-only turns produce zero Trello mutation;
- explicit priorities and conversational plan corrections are handled coherently;
- capacity overload is handled by proposing a realistic subset instead of pretending everything fits;
- after live Trello state changed, a fresh read changed the updated plan, proving live state outranks prior plan/Memory;
- task-management and write-verification regressions were absent;
- typecheck passed, tests passed 30/30, and `git diff --check` was clean.

### DONE — Foundation 10: Weekly planning Skill and capacity reasoning (#11)
Accepted 2026-09-16 at commit `c7fdca193c79f127b90c979901dca23051aa5820`.

Verified foundation:
- custom `weekly-planning` Skill exists in Claude workspace and is attached alongside existing Skills;
- canonical source is `.claude/skills/weekly-planning/SKILL.md`;
- weekly plans use fresh Trello evidence and distinguish deadlines, in-progress, waiting/blocked, and backlog work;
- overload is surfaced explicitly with realistic deferrals rather than pretending everything fits;
- weekly→daily drill-down stays coherent with `daily-planning`;
- planning-only turns produce zero Trello mutation;
- live Trello changes override prior plans/Memory;
- task-management, daily-planning, and write-verification regressions were absent;
- typecheck passed, tests passed 30/30, and `git diff --check` was clean.

### DONE — Foundation 11: Project/client context memory (#12)
Accepted 2026-09-16 with no repo/config/Skill/Agent change required.

Verified foundation:
- existing Claude-native Memory behavior already handles useful durable project/client context;
- stable context survives genuinely new Managed Sessions without transcript replay;
- durable Memory and fresh Trello evidence can coexist coherently in one answer;
- corrected durable context supersedes stale context in a later Session;
- project/client facts remain correctly scoped without cross-project leakage;
- transient task/list/due state is not trusted over fresh Trello;
- existing `DJONIK_MEMORY_INSTRUCTIONS` already encode the durable-vs-live boundary;
- typecheck passed, tests passed 30/30, and `git diff --check` was clean.

### DONE — Foundation 12: Accepted plans and commitments (#13)
Accepted 2026-09-16 at commit `d495d1ca7e52ff40339289c650dd22f904cf23a8`.

Verified foundation:
- unaccepted suggestions are not treated as commitments;
- explicitly accepted plans survive genuinely new Managed Sessions;
- explicit personal/client commitments survive new Sessions;
- corrections/cancellations supersede stale accepted context;
- remembered agreements are kept distinct from fresh Trello operational truth;
- the bounded fix lives only in `DJONIK_MEMORY_INSTRUCTIONS`; no new Skill, DB, state mirror, event log, or persistence service was introduced;
- task-management, daily-planning, weekly-planning and same-card write verification remained intact;
- typecheck passed, tests passed 30/30, and `git diff --check` was clean.

### DONE / PROVIDER LIMITATION — Trello write surface: support clearing due dates (#14)

Investigated 2026-09-16 at commit `f5fa1de46fe593f5f1ee127a5306ea2b85e1b29f`.

Outcome:
- the exposed Trello MCP `trelloWriteCard` schema can set/change a due date but has no supported clear/unset/null path;
- no other exposed Trello MCP tool provides due-date clearing;
- Djonik now reports the limitation honestly rather than faking success or inventing a sentinel date;
- same-card verification and normal due-date changes remain intact;
- issue closed `not_planned` until the provider exposes a safe clearing path.

### DONE — Trello read surface: due-date accuracy across search vs direct card read (#15)

Accepted 2026-09-16 at commit `580dfa49510881cabd1d3de9ee16d37800222a96` plus Managed Agent system-prompt version 11.

Verified outcome:
- `trelloSearch` is treated as discovery only for exact card-field questions;
- exact due/list/status/current-state claims require an authoritative direct read;
- `due: null` from search is not treated as proof that no deadline exists;
- the formerly failing no-due Scenario C passed 3/3 fresh sessions after the Agent-level rule;
- ambiguity produces clarification without false field claims or mutation;
- daily/weekly planning remained grounded in live Trello reads;
- no cache/state mirror/custom Trello client was introduced.

### DONE — Audit: Managed Agent token usage and cost (#16)

Accepted 2026-09-16 at commits `51b70cd64ea65536fd1610520f3b4c6dcd140908`, `02da7fa4670c38589e368fe3885d4eb81e8f017c`, and `9da00a58451dca98db616d93ad7ba8b32df26754`, plus production Managed Agent version 12.

Verified outcome:
- a small number of visible turns can generate large input-token composition because one visible turn may contain multiple internal model/tool iterations;
- prompt caching is active and materially reduces billed repeated context, but cache-read tokens still appear in usage totals;
- disabling the unused Google Calendar toolset reduced controlled first-pass context by 28.07% and total-turn composition by 27.38% with no regression in the validated factual Trello flow;
- Google Calendar remains attached but `enabled:false` in production until Wave E;
- five unsupported Trello write tools are confirmed `enabled:false`, while `trelloWriteCard` remains enabled;
- three optional Trello reads showed a potential first-pass reduction, but the final quality gate found material planning regressions / insufficient same-turn fresh evidence, so they remain enabled and further optimization of them is stopped;
- opt-in content-free per-turn telemetry and a canonical planning regression matrix were added;
- Memory, Skills, authoritative direct reads, and same-card verify-after-write were not optimized away.

### DONE / PROVIDER LIMITATION — Blocker: fresh Trello evidence per planning turn (#18)

Investigated 2026-09-16.

Outcome:
- the baseline defect was reproduced: short planning follow-ups could make exact current Trello claims without a same-turn direct read;
- an isolated stronger Agent-instruction experiment passed, but production Agent v13 failed validation on `Що зараз горить?` with zero Trello calls;
- production was restored to Agent v14, whose system prompt is byte-for-byte equivalent to the accepted v12 baseline; all other Agent configuration remains unchanged;
- current Managed Agent Sessions expose no native deterministic per-turn tool choice, required MCP-call mechanism, or pre-response enforcement gate that can conditionally require a Trello read;
- prompt and Skill guidance continue to request fresh evidence, but are best-effort for this short-follow-up edge case and must not be represented as a hard guarantee;
- do not add an always-read-every-turn workaround, semantic routing, or a custom Messages API loop;
- revisit only if Managed Agents exposes a native deterministic per-turn tool requirement or pre-response enforcement capability.

### DONE — Source-correlated usage telemetry: separate Telegram production cost from Console/CLI validation cost (#19)

Accepted 2026-09-16 at commit `9b510182a1e0314c5dd12c7447b78091f1158e9a`.

Verified outcome:
- opt-in, content-free Telegram telemetry emits explicit `source: telegram`, UTC timestamps, and `usageScope: turn_delta`;
- cumulative Managed Session `session.usage` is converted to per-visible-turn deltas, preventing double-counting across long-lived sessions;
- a local stateless reconciliation utility aggregates a defined UTC window without a DB, dashboard, scheduler, or hosted accounting service;
- a real two-turn Telegram capture totalled 265,438 input-composition tokens, 1,777 output tokens, and $0.14 list cost;
- an independent Console token export for the same UTC hour matched the Telegram token totals exactly, leaving a measured non-Telegram token remainder of 0 for that window;
- the estimated non-Telegram list-cost remainder was $0.00, explicitly retained as an estimate because the supplied Console export contained token fields but no Cost API cost column;
- no Agent/Skill/Memory/MCP/Calendar/Trello production configuration changed;
- typecheck passed, tests passed 40/40, and `git diff --check` was clean.

### DONE — Measure real Telegram session token growth over time using existing turn telemetry (#20)

Accepted 2026-09-17 at commit `fbd82d20b190e8efd322ecb5ffe9b526b89933d5`.

Verified outcome:
- one continuous real Telegram Managed Session was observed for 7 natural visible turns;
- a content-free local reporting mode groups telemetry by `sessionId`, orders turns by timestamp, and assigns deterministic per-session turn indexes;
- the clean comparable subset (turns 2, 3, 6, 7: one model iteration, zero tools, no Skill/Memory reads) increased from ~39,958 average input-composition tokens early to ~47,611 late, approximately +19.15%;
- comparable early and late turns stayed in the same observed 1–2¢ list-cost band;
- higher-cost turns correlated with extra model iterations, Trello tool work, and/or Skill loading rather than turn position;
- current evidence therefore does not justify rollover, compaction, or history trimming; revisit only if later natural production telemetry shows materially higher late-session cost, latency, context pressure, or quality degradation;
- no Agent/Skill/Memory/MCP/session-lifecycle behavior changed;
- typecheck passed, tests passed 46/46, and `git diff --check` was clean.

### DONE — Adopt a development/validation spend guardrail for future token/cost audits (#21)

Accepted 2026-09-17 at commit `f7331b4fd1749006936f271cccfd10faafc79de4`.

Verified outcome:
- canonical policy lives in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §27;
- every future paid Managed Agent audit/A-B follow-up must declare maximum dollar spend, maximum paid Sessions, expected evidence, stop condition, and PO-approval trigger before execution;
- default guardrail is $0.50 / 5 paid Sessions, with justified upfront overrides allowed;
- validation stops on budget/session ceiling, sufficient evidence, diminishing returns, or a materially high-cost session; inconclusive work requires Product Owner approval for further spend;
- passive natural-usage telemetry such as #19/#20 is excluded unless it deliberately generates extra Managed Agent traffic;
- no runtime or Agent configuration changed.

### DONE — Project Context Bootstrap: canonical project briefs in Djonik Memory (#17)

Accepted 2026-09-17.

Verified outcome:
- canonical project briefs now exist in `Djonik Memory`;
- durable recall was validated across new Managed Sessions;
- durable Memory and fresh Trello were successfully combined in one answer;
- cross-project isolation passed;
- a correction superseding stale Memory passed;
- validation used 3 paid Sessions and $0.27 total, within the declared $0.50 guardrail.

### DONE — Wave B1: Telegram screenshot/image intake into Djonik Managed Agent (#22)

Accepted at commit `3dbe0561777f22fefa202a3ffbaa76d403f9f0f7`.

Verified outcome:
- Telegram screenshots/images reach the authoritative Djonik Managed Agent as actual visual input;
- implementation uses official Managed Agents multimodal `user.message` blocks with inline base64, not a custom vision path;
- screenshot understanding was live-validated (task content demonstrably derived from visible image content, not caption/filename);
- explicit screenshot → Trello task works end-to-end through the production `connectToDjonik` path;
- same-card verify-after-write was exercised live for an image-originated write;
- prompt-injection text inside an image remained untrusted source data — no unauthorized tool action;
- text-only Telegram regression passed;
- validation finished within guardrail at $0.31 total / 2 paid Sessions.

### DONE — Post-write due-date wording must match verified Trello field (#23)

Accepted at commit `072e50cf02a65b5d8a829b1145ba7df150a9520d`.

Verified outcome:
- due-date write confirmations are grounded in the verified same-card Trello read, not model wording;
- two rounds of Skill-only guidance proved insufficient for timezone-boundary weekday correctness;
- the final bounded deterministic safeguard activates only for a verified Trello due-date write (write carries `due`, same-card `trelloReadCard` verifies it, a parseable `due` is extracted);
- verified `due` is converted with `Intl.DateTimeFormat` using `Europe/Kyiv`;
- calendar date, time, and weekday are all derived from that same verified instant;
- contradictory model-generated due wording cannot reach the user for this path;
- intended-vs-verified mismatch is surfaced explicitly rather than claimed as success;
- missing/unparseable verified `due` fails closed instead of fabricating a confirmation;
- live production validation passed the critical UTC-date-vs-Kyiv-local-date rollover case;
- typecheck passed and tests passed 85/85.

### DONE — Wave B2: Telegram PDF/file intake into Djonik Managed Agent (#24)

Accepted at commit `6a584d28481fc9769a98e3364cab6ac6673addbb`.

Verified outcome:
- Telegram PDFs reach the authoritative Djonik Managed Agent as actual document content;
- implementation uses the official Managed Agents `document` content block with inline base64, not a custom document path;
- caption + document are supported together in one turn;
- scope is PDF-only;
- size guard is a 20 MB encoded-base64 ceiling with an optimistic ~15 MB early raw-size estimate rejection before download;
- actual PDF understanding was live-validated against the real production Managed Agent;
- PDF → exactly one verified Trello task was live-validated end-to-end;
- ambiguity produces clarification with zero write;
- embedded prompt-injection text inside a PDF remained untrusted source data;
- existing text/image regressions passed;
- validation finished at ~$0.10 total across 4 paid Sessions with exactly 1 Trello mutation;
- local tests passed 109/109.

### DONE — Wave B3: Group related Telegram messages into one coherent intake (#25)

Accepted at commits `035432216cdeee84b719e2be50df88d83cf78e31` and `04c8a028f293cb5969969bd94c6dd2ddadb3b79d`.

Verified outcome:
- related Telegram fragments are grouped in-memory into one coherent intake using explicit `media_group_id` first and a bounded adjacent-message window otherwise;
- order is deterministic by Telegram `message_id`, chat/user isolation is structural, and groups are bounded to 20 fragments;
- text + image/PDF and native Telegram albums reuse the accepted #22/#24 Managed Agent content-block paths without duplicate transport or persistence;
- pre-send grouped attachment failure fails closed and cannot partially reach the Managed Agent or Trello;
- a live overlapping-send race was discovered during acceptance and fixed at the correct boundary by FIFO-serializing `DjonikSessionHandle.send()`;
- concurrent requests can no longer overlap on one Managed Session, protecting telemetry attribution, same-card verification, and #23 due-date finalization;
- live acceptance A–G completed within guardrail at $0.23 total / 2 paid Sessions / exactly 1 verified Trello mutation;
- local typecheck passed and tests passed 154/154.

### DONE — Wave B4: Structured task/checklist generation from studio intake (#26)

Accepted at commit `778ffd26984bba44df94e0008117f7c69242a1cf`.

Verified outcome:
- `studio-intake` is live and owns source/context → useful task structure for text, grouped Telegram input, screenshots/images, and PDFs;
- non-trivial intake yields concise title/context/outcome/substeps when useful, while atomic work stays simple;
- proposal-only turns remain zero-write; explicit creates still hand off to `task-management` and the existing same-card verify-after-write path;
- native Trello checklist mutation remains out of scope: `trelloWriteChecklist` stayed disabled and generated substeps are represented honestly in card description;
- embedded source instructions remain untrusted data;
- a live wrong-project create exposed a safety gap under the intentional Haiku baseline; `task-management` was hardened so a new task cannot inherit project identity from mere conversational recency;
- the final deconfounded live retest asked for project clarification and performed zero mutation;
- at that Wave B gate, production Haiku remained the intentional baseline after a bounded regression gate (superseded by the 2026-09-23 #38 model decision);
- intermittent Managed Agents image failures (`Could not process image`) were isolated as provider-side/non-local and remain a residual caveat;
- local typecheck passed and tests passed 178/178.

### DONE — Wave B5: Preserve source context across rich studio intake (#27)

Accepted at commit `28c3db2d12d55e89533ef1c91d5c3d305476e66a` with one Product Owner-approved residual caveat.

Verified outcome:
- grouped Telegram intake preserves native cross-modal order into Managed Agent content blocks instead of flattening text/images/documents into separate modality buckets;
- caption↔attachment adjacency is preserved, later explicit Daniel corrections outrank conflicting earlier/source facts, and source content remains untrusted;
- live validation passed text→image→correction, caption+image authority, text→PDF→correction, native album ordering, prompt-injection safety, and the no-persistence/Memory boundary;
- execution-critical negative constraints were hardened in `studio-intake` after live validation exposed an omission; the final verified Trello card preserved `Mobile version NOT required`;
- explicit create targeted Djonik / Backlog, performed exactly one `trelloWriteCard`, then a same-card `trelloReadCard` before success;
- `trelloWriteChecklist` remained disabled and no duplicate/unrelated mutation occurred;
- local typecheck passed and tests passed 208/208;
- residual accepted caveat: Haiku may omit an explicitly requested textual provenance line such as `Джерело: Telegram + PDF brief` from the Trello description even though provenance is available and used in reasoning; Wave B does not add a deterministic write-path safeguard solely for this model-following limitation.

Wave B — Studio intake is complete.

### DONE — Wave C1: Evidence-based project health review (#28)

Accepted and closed 2026-09-21 (GitHub #28 closed / completed); closeout commit `017c826c56a803e2c1d3b5693e0264ed751fc36e`.

Accepted outcome:

- production Djonik **v19 / Haiku** coordinator;
- **Project Health specialist v4 / Sonnet**, read-only;
- **native Managed Agents delegation accepted** (no Advisor, no application phrase/intent router);
- **deterministic Project Health reply safeguard accepted** — thin Session client, `src/djonikClient.ts` (§47);
- **final live acceptance PASS** (§48): one fresh production-v19 Session, $0.21, zero Trello/Calendar/Memory writes;
- the **temporary validation coordinator archived** (§49);
- **#18 remains an accepted platform limitation** (same-turn fresh-read gap), unchanged by this wave.

Project Health remains a fresh, read-only PM interpretation over Trello evidence, never stored competing truth.

Measured live validation changed the implementation direction:

- repeated Haiku runs showed persistent nuanced PM-judgement failures despite simplified Skill guidance;
- Sonnet avoided the dominant Haiku correctness failures in the observed A/B comparison, while still having residual verbosity and one invented entity;
- missing same-turn fresh reads occurred on both models and remains the accepted #18 platform limitation;
- the bounded slice is **Haiku coordinator → one Sonnet Project Health specialist subagent** using native Managed Agents multi-agent orchestration;
- the specialist is Trello-read-only, has no Calendar capability, and owns the `project-health` Skill; it returns an evidence-backed result that the coordinator relays without recomputing PM facts;
- no Advisor, custom phrase router, custom Messages loop, DB, health cache, or deterministic fresh-read middleware was added in this slice;
- delegated live acceptance ("Scenario A", `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §42) has passed: native delegation, silent-wait, exactly one specialist child result, byte-identical coordinator relay, and specialist factual/voice/shape grading against fresh Trello evidence all passed;
- the production Managed Agent configuration cutover has been applied (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §43): production Djonik is now v18, a Haiku coordinator delegating Project Health to the pinned specialist v3 roster entry, with the `project-health` Skill removed from the coordinator's own configuration;
- the real production-v18 smoke (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §44, one Session, $0.21) proved the production topology and runtime — v18 resolved, native delegation to specialist v3, silent wait, fresh Trello evidence, exactly one child→coordinator message, zero mutation/Calendar/Memory, end-turn — but **failed** the final specialist shape and exact-relay acceptance: the specialist appended a coordinator-addressed technical note, included pool inventory with a count error and an unsupported "виконавець" actor, and the coordinator then omitted the note (so raw equality failed), after adding unnecessary evidence dimensions to its delegated task;
- specialist v4 hardening has been applied (§45): only the specialist's final-answer discipline changed (user-facing-only final message, no coordinator/technical note, no pool inventory or counts unless asked, no unsupported actor/assignee, exactly one next step, silent pre-send self-check); production was then repinned to it as **v19** with only the roster changed (specialist v3 → v4). Architecture, coordinator model, Trello tool surface, Skill text and the validation coordinator (v5, still pinned to specialist v3 until archive) are unchanged;
- the final production-v19 smoke (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §46, one Session, $0.31) proved the topology and specialist v4 **PASS** (v19 resolved, roster → specialist v4, clean delegation, silent wait, fresh Trello, factual compact specialist answer with no note/counts/actor, one child message, zero mutation, end-turn) but **exact relay FAIL**: production Haiku rewrote the correct specialist answer into a bulleted report with a countdown, an unsupported risk, urgency and extra steps. The measured root gap is that post-specialist Haiku rewrite; prompt-only relay control is now proven insufficient (§42 passed by luck, §44 dropped a paragraph, §46 rewrote it);
- a **deterministic reply-boundary safeguard** was implemented (§47, `src/djonikClient.ts`, tests in `src/djonikClient.test.ts`): after Claude has natively delegated and the canonical specialist returned exactly one result, the Session client returns that exact string instead of the coordinator's message. It is not an intent router (no user-text inspection; Claude still decides delegation), falls back to coordinator output when provenance is missing/ambiguous (exact-preservation protection is bypassed; see #32), and leaves any Trello-write turn to the existing verified-write/#23 pipeline. No Agent/Skill/model/MCP/architecture change — production stays v19, specialist v4;
- the **final live acceptance (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §48) PASSED**, one fresh production-v19 Session, $0.21, through the real `connectToDjonik()` production path: the create response carried the roster provenance, delegation was native to the canonical specialist v4, Trello evidence was fresh, the specialist's answer was factually correct, the exact specialist string was returned to the caller (`runtimeReturnedReply === specialistFinal`, 747 = 747 characters), and there were zero Trello/Calendar/Memory writes. Production v19 + specialist v4 and the deterministic relay safeguard are **accepted**. (In that one sample Haiku happened to relay exactly, so the safeguard's rewrite-substitution branch is covered by unit tests, not by a live rewrite.);
- the temporary validation coordinator (`agent_01GFCLFYq6uLRHG8vMCrAgeK`, v5) was **archived** at closeout (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §49); it is retained only as historical validation infrastructure and is not part of production;
- **Wave C1 implementation, live acceptance and administrative closeout are COMPLETE.** #28 is closed as completed; capability order in `docs/03` is not execution order;
- the accepted #18 same-turn fresh-read platform limitation is unchanged and remains an accepted platform limitation, not something this cutover fixes.

### DONE — Runtime reliability: idempotent Managed Agents custom-tool continuation by event id (#40)

Accepted 2026-09-22 at commit `e5b0df2d8eb520c139a2c6f41bc0b95e726cb352`; implementation evidence: [docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md). Decision record: [docs/30](30_RUNTIME_EVENT_LOOP_AUDIT.md); architecture rule: [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) §13.

Verified outcome:
- Session-scoped lifecycle resolves custom tools by distinct `custom_tool_use_id` and executes each id at most once;
- exact executor results are cached, submission state is separate from execution, and result echo is authoritative RESOLVED evidence;
- repeated `requires_action` for the same unresolved id does not re-execute the tool;
- #36 provenance counts distinct current-turn ids rather than result submissions;
- specialist thread idle is last-wins and same-id MCP replay cannot overwrite an already-correlated #31 ledger outcome;
- the exact docs/29 sequence failed on pre-fix runtime and passed after the fix;
- full suite passed 495/495, typecheck and `git diff --check` passed;
- no paid inference or production change occurred; the real-provider smoke is the one post-#40 #36 diagnostic.

### DONE — Wave C2: Weekly work review from Trello action history (#36)

Accepted 2026-09-22 after the single authorized post-#40 live diagnostic; evidence: [docs/32](32_ISSUE_36_POST_40_LIVE_DIAGNOSTIC.md), committed at `3312706`.

Verified outcome:
- Claude selected `trello_work_history` with project `Extract`, `last_week`, concise;
- deterministic Trello action-history facts were complete for the window and rendered by Variant-B;
- the visible response began with the exact deterministic `answer_text` byte-for-byte;
- the provider re-emitted `requires_action` for the same custom-tool id; #40 handled it with executor 1 / submission 1 / echo 1 and verified provenance;
- zero Trello, Calendar or Memory writes; production Agent unchanged;
- authoritative `end_turn`; one fresh Session, one visible turn, $0.03 list cost;
- Haiku duplicated the factual report inside the model-owned PM section; accepted as a non-hard UX observation to evaluate in the later working-rhythm pilot rather than reopening prompt/renderer hardening.

Source history: [docs/26](26_ISSUE_36_SOURCE_FIRST_IMPLEMENTATION_REPORT.md), [docs/27](27_ISSUE_36_LIVE_VALIDATION_REPORT.md), [docs/28](28_ISSUE_36_FACTUAL_OUTPUT_BOUNDARY_REPORT.md), [docs/29](29_ISSUE_36_FACTUAL_RELAY_LIVE_DIAGNOSTIC.md), runtime correction [docs/30](30_RUNTIME_EVENT_LOOP_AUDIT.md) / [docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md), final gate [docs/32](32_ISSUE_36_POST_40_LIVE_DIAGNOSTIC.md).

### DONE — Wave C2 spike: Trello work-history evidence (GO, 2026-09-22)

Executed from the PO-approved plan without a separate GitHub issue (draft body kept in [docs/22](22_ISSUE_29_SUPERSESSION_DRAFTS.md) §2). Decision record: [docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md). `docs/03_TARGET_CAPABILITIES.md` §8.

Bounded goal: **establish, with zero model inference and zero mutation, whether Trello's own action history can answer "what changed on project X this week" reliably enough for Daniel.**

- Read-only Trello REST board actions (`filter`, `since`/`before`, `limit`, `page`) for the Djonik board over the current and previous Kyiv week; separately authorized read-only token kept only in local environment, never committed.
- Check against known facts: the four Extract cards currently in Done, `Брендбук` in This week (`docs/16` §26/§31) — list-move, `closed`, `dueComplete` actions with time and actor.
- Measure retention depth, actions per week, payload size, pagination; confirm that label changes are not returned by nested actions (project = current label).
- Build an offline deterministic digest (Kyiv-local time/weekday, transitions, coverage flags, no `lastActivityAt`) in scratch only, and ask Daniel whether it answers the weekly question.
- **GO:** Done transitions with time for all four known cards, retention ≥ 2 weeks, Daniel judges the digest useful → open the follow-up issues below. **NO-GO:** no work-review capability; current state stays with Project Health / task-management; the existing `work-review` Skill is not attached.

**Spike result 2026-09-22 ([docs/23](23_WORK_HISTORY_SPIKE_REPORT.md)): GO — technical criteria passed and the Product Owner judged the offline digest useful.** 508 board actions since board creation (08.09), one page, 6 GETs, $0. All four known Extract Done cards show timed Done transitions, including reopen; `Брендбук` due confirmed as Fri 25.09 18:00 Kyiv. Limits: every action is attributed to the same Trello account (Djonik's MCP writes are not distinguishable from Daniel's), validation test cards add noise, and the digest must show one net transition per card per window. Follow-ups after GO (both now scoped together in #36):
1. read-only custom tool `trello_work_history` + deterministic digest (window, transitions, counts, coverage, Kyiv formatting) and client handling of custom tool calls consistent with #32;
2. thin `work-review` Skill v2 over that tool, then one isolated Haiku diagnostic and the §27 five-plus-one gate (the five-plus-one gate is superseded for #36 by the post-#40 single-diagnostic stop rule above).

Boundaries: no Managed Agent/Skill/Memory change, no paid Session, no Trello mutation, no event store, webhooks, snapshot store or episodic journal in this spike. After GO the Product Owner added the weekly transitions review to the working PM baseline (2026-09-22).

### SUPERSEDED 2026-09-22 — Wave C2: Reliable current-state work review and capability ownership validation (#29)

Superseded by the work-history spike above ([docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md)). The record below is preserved as history; it no longer selects scope.

Canonical bounded issue (historical): #29. `docs/03_TARGET_CAPABILITIES.md` §8 — Work history and reviews.

Bounded goal: **support honest evidence-based work reviews from the history/current-state evidence the existing Trello surface actually exposes, without inventing chronology or adding history infrastructure prematurely.**

Current accepted progress:

- **Slice 1 — discovery: DONE / accepted**, committed at `cdb132e1cf08b9f8eeb825675db9dc766c5ab184` and recorded in `docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md`. The current Trello MCP supports useful **current-state retrospective** (current list/status, Done workflow state, closed/archive state, due/dueComplete where freshly read), but it does **not** expose reliable completion timestamps, list-movement history, reopen history, actor history, or an Activity & History primitive.
- `lastActivityAt` remains a weak activity timestamp only. It is **not** evidence of completion, movement, reopen, progress, staleness, actor identity, or membership in a requested time window.
- Plan-vs-actual is only partially supported: durable Memory may supply an explicitly accepted plan/commitment, while fresh Trello supplies the **current actual state**; without historical transition evidence, Djonik must not claim that an item was completed during a specific period.
- **Slice 2 — source-only `work-review` Skill: DONE / accepted**, committed at `51c0b719e0bc98c7f84e0948f4337755161da176`. Canonical source: `.claude/skills/work-review/SKILL.md`; deterministic source tests are in `src/skills.test.ts`; local suite passed **330/330**. The Skill explicitly prevents fake chronology, narrows `lastActivityAt`, keeps reviews read-only, treats Memory as plan/context only, and leaves current health/risk/blocking judgement to the accepted Project Health path.
- **Slice 3 — production attach + bounded live acceptance: FAILED live acceptance** (`docs/16` §26). The reviewed Skill was synced (`skill_01RMRGWbrjW9EHSieymZ2NDV` / `skver_01JCf5J73Sik966ZR31u6Rhr`, byte-identical to the committed source) and attached as production **v20**; the configuration part passed (only `skills` changed; specialist v4 untouched). Measured failures in the live Session (`sesn_01QS3gZyCGyrSZKVNSU6F7pR`):
  - Haiku **fabricated completion ordering**: «остання замкнена» ("the last closed task"), an unsupported chronology that also contradicted the answer's own history caveat;
  - `lastActivityAt` was used as completion/order evidence;
  - the raw UTC activity timestamp was **naturalized into a local-looking date/time** («21 вересня о 07:09»; that clock time is UTC, Kyiv would be 10:09);
  - current-state **inventory/counting errors** occurred (three Done cards announced while four were listed; five This-week cards listed when six existed) and the answer was close to a raw dump of nine cards plus a vague unsupported phrase («невеликий процес»);
  - **Project Health routing itself worked**: the health question delegated natively to specialist **v4 / Sonnet** with fresh Trello reads and `work-review` did not take it over;
  - the **PH relay boundary was not revalidated**: Turn 2 ended `budget_reached` before the coordinator could relay, so `send()` returned no reply;
  - total Session list cost reached **$0.32 against the $0.30 requested ceiling** (the Turn-2 gate under-estimated a delegated Sonnet health turn). 0 Trello writes, 0 Calendar calls, 0 Memory writes; no retry, no budget increase.
- **Recovery (`docs/16` §27):** production was **rolled back v20 → v21**. v21 removes only `work-review` and is otherwise semantically identical to accepted v19 (four accepted coordinator Skills, same Haiku model/system/tools/Trello MCP/disabled Calendar, roster → specialist v4). The remote `work-review` Skill is **retained but not attached to production** and is **not** an accepted production capability. No Session, inference, or Trello/Calendar/Memory access occurred during recovery.
- **Recorded Agent configuration after rollback (serving Session not attested):** Djonik **v21 / Haiku**; Project Health remains delegated to specialist **v4 / Sonnet** with the accepted #28 reply-boundary safeguard.
- **Source-only current-state review contract + behavioral rubric: DONE / accepted**, committed at `754b554b446a5193fd79877f85043252e026015b`. The `work-review` Skill is simplified around current-state evidence; the rubric is model-neutral and covers unsupported chronology, `lastActivityAt`, current-state correctness, project isolation, conflicting completion signals, partial coverage, counts, concision, plan-vs-current, zero mutation, Project Health ownership, honest history limits, vague interpretation and transient-Memory persistence. Source tests passed 27/27 focused, 112/112 with Skill tests, full suite 458/458; typecheck and `git diff --check` passed.
- **First isolated Haiku diagnostic: INCONCLUSIVE; evidence-acquisition gate follow-up DONE / accepted**, committed at `67173957b7f5c3b1e68c2e4edf63fcec873f92f6`. The first paid sample exposed a setup confound (candidate materially poorer than production context) and a missing rubric dimension rather than proving Haiku unsuitable. R16 now requires Trello discovery/read before clarification when the named project can be resolved; clarification is allowed only after ambiguous/failed discovery. Focused tests passed 41/41 and 126/126 with Skill tests; full suite 472/472; typecheck and `git diff --check` passed. **NEXT:** one fresh, separately authorized Haiku diagnostic using a closer-to-production isolated candidate: same Haiku/system, read-only production Memory context where safely possible, the four accepted coordinator Skills, full Trello read/discovery surface including search, all writes disabled, Calendar disabled, and no PH/Sonnet roster for budget isolation. Production remains unchanged and Sonnet comparison has not started.
- **Second isolated Haiku diagnostic: FAIL** (`docs/16` §31, $0.06, `end_turn`). Production-like candidate (same Haiku/system, five pinned Skills, production Memory read-only, full Trello read surface, all writes disabled, no PH roster). Discovery succeeded (R16 PASS), zero mutation, no `lastActivityAt` misuse or fake chronology; but R04 critical (raw UTC due `2026-09-25T15:00Z` rendered as «25 вересня о 15:00», Kyiv is 18:00), R09 (all 12 Extract cards despite «Дай коротко») and R14 («Зробив що-небудь на цих картах»). Haiku was not accepted and no Sonnet comparison started.
- **Superseded 2026-09-22** by the architecture audit in `docs/21`; see the NOW section above.
- A weekly journal/checkpoint or other persisted history mechanism is **not part of the current #29 implementation by default**. It may be considered only after live acceptance demonstrates a measured product gap that the bounded current-state review cannot satisfy; any persistent snapshot/journal/history mechanism requires a separate bounded architecture decision rather than being added implicitly here.
- The accepted #18 same-turn fresh-read limitation is unchanged.
- The 2026-09-21 governance decision supersedes the former rule that #29 must close before other work; the canonical queue above now selects reliability first.

Boundaries remain those of GitHub issue #29:

- read-only work review; zero Trello writes by default;
- no fake completion/movement/reopen chronology;
- no event/history DB, Trello mirror, snapshot store, webhook history pipeline, scheduler/cron, proactive notification system, vector DB/RAG, custom Messages loop, phrase/intent router, Calendar integration, or new specialist agent without a separate measured decision;
- current health/risk/waiting/blocking interpretation remains owned by the accepted Project Health specialist path;
- transient retrospective conclusions are not persisted to durable Memory as operational truth.

## Long-term capability map after the current queue

### Wave B — Studio intake
- screenshots/images;
- PDFs/files;
- grouped related Telegram messages;
- structured task/checklist generation;
- source-preserving context.

### Wave C — Project health and reviews
- project-health capability (accepted, Wave C1);
- bounded Sonnet Project Health specialist behind the primary coordinator (accepted in Wave C1 under Haiku; coordinator baseline changed to Sonnet 5 medium/standard in #38);
- weekly transitions review from Trello's own action history (Wave C2 spike; replaces #29 current-state review); historical trend analytics remain deferred;
- stale/blocked/risk judgement;
- meaningful follow-up lifecycle.

### Wave D — Proactive PM (#39 working rhythm; further triggers only with measured need)

Decision 2026-09-22 ([docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) §10): the schedule runs in the always-on adapter (#33 host), because the #36 custom tool executes there; native Scheduled Deployments remain an alternative. Bounded delivery state (SEND/SILENT, deduplication, suppression, ambiguous-send handling) reuses tested finalization. Rhythm settings live in Memory `/rhythm.md`, content and tone in Skill `pm-rhythm`, signal rules in `src/`. Implemented by #39 (not yet started).

- scheduled morning/weekly agent turns;
- reminder/follow-up triggers;
- exception monitoring, silent by default (≤ 2 unsolicited messages/day, quiet hours 20:00–09:30 Kyiv);
- Telegram delivery only when useful.

### Wave E — Calendar and wider integrations (measured planning need)
- Google Calendar awareness;
- calendar-informed planning;
- bounded event management;
- selected additional integrations only when they improve the PM loop.

### Wave F — Additional specialist agents if justified
Project Health is the first measured specialist case and was handled in Wave C1 (accepted).

Potential later specialists:
- studio intake analyst;
- research/context agent;
- weekly review analyst.

Do not introduce additional specialists because multi-agent is available. Require measured value for each role.

## Architecture guardrails

During all phases:
- the Claude Managed Agent resource is the authoritative Djonik runtime;
- Claude reasoning stays primary;
- do not rebuild a custom Messages tool loop;
- do not create a duplicate local Djonik agent when Console/Managed Agents owns the configuration;
- Claude Memory Stores are the default durable memory mechanism;
- do not create a custom DB/memory system without measured evidence;
- Skills contain reusable expertise/workflows, not mutable project data;
- do not turn adapter code into a phrase/intent router;
- keep external live state fresh through tools;
- verify mutations;
- prefer bounded vertical slices over broad scaffolding.

## Legacy repo

`danielkokr/djonik-manager` may be consulted for product lessons, test scenarios and failure modes.

Do not treat its architecture or open backlog as the roadmap for Djonik 2.0.
