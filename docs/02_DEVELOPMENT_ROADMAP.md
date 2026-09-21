# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundations 1–12 are accepted. `Джонік` is the authoritative Claude Managed Agent; Telegram is the thin channel adapter; `Djonik Memory` provides durable cross-session memory; `task-management`, `daily-planning`, and `weekly-planning` Skills are attached and live; Trello MCP read/write flows work against live data with same-card verify-after-write; daily/weekly planning, project/client context, and accepted plans/commitments have been validated. Due-date clearing is blocked by the external Trello MCP tool surface. The Managed Agent token/cost audit is complete: Google Calendar remains attached but is disabled until Wave E, five unsupported Trello write tools are already disabled, opt-in per-turn telemetry and a planning regression matrix are live, and the three tested optional Trello reads remain enabled because the final quality gate did not establish safe behavioral equivalence. Conditional same-turn fresh-read enforcement for short planning follow-ups is a Managed Agents platform limitation under the accepted architecture; daily/weekly planning Skills continue to request fresh evidence, but that guidance is best-effort rather than a hard guarantee for this edge case. Source-correlated Telegram usage telemetry (#19) is accepted and validated against an independent Console export. Real Telegram session-growth measurement (#20) found a modest ~19% increase in input composition across comparable early vs late turns in one 7-turn session, but no material list-cost shift; rollover/compaction is therefore not justified by current evidence. The development/validation spend guardrail (#21) is now canonical in `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §27. Project Context Bootstrap (#17) is accepted: canonical project briefs now exist in `Djonik Memory`; durable recall was validated across new Managed Sessions; durable Memory and fresh Trello were successfully combined in one answer; cross-project isolation passed; a correction superseding stale Memory passed; validation used 3 paid Sessions and $0.27 total, within the declared $0.50 guardrail. Wave B1: Telegram screenshot/image intake into the Djonik Managed Agent (#22) is accepted at commit `3dbe0561777f22fefa202a3ffbaa76d403f9f0f7`: Telegram screenshots/images reach the authoritative Djonik Managed Agent as actual visual input via official Managed Agents multimodal `user.message` blocks with inline base64; screenshot understanding was live-validated; explicit screenshot → Trello task works through the production `connectToDjonik` path with same-card verify-after-write exercised live; prompt-injection text inside an image remained untrusted source data; text-only Telegram regression passed; validation finished within guardrail at $0.31 total / 2 paid Sessions. Post-write due-date wording must match verified Trello field (#23) is accepted at commit `072e50cf02a65b5d8a829b1145ba7df150a9520d`: due-date write confirmations are now grounded in the verified same-card Trello read rather than model wording; two rounds of Skill-only guidance proved insufficient for timezone-boundary weekday correctness, so a final bounded deterministic safeguard was added that activates only for a Trello write whose input changes `due`, once the same card is verified by `trelloReadCard` and a parseable `due` is extracted from that verified read; the verified UTC `due` is converted with `Intl.DateTimeFormat` using `Europe/Kyiv`, and calendar date, time, and weekday are all derived from that same verified instant, so contradictory model-generated due wording cannot reach the user for this path; an intended-vs-verified mismatch is surfaced explicitly rather than silently claimed as success; a missing/unparseable verified `due` fails closed instead of fabricating a confirmation; live production validation passed the critical UTC-date-vs-Kyiv-local-date rollover case; typecheck passed and tests passed 85/85. Wave B2 — Telegram PDF/file intake into Djonik Managed Agent (#24) is accepted at commit `6a584d28481fc9769a98e3364cab6ac6673addbb`: Telegram PDFs now reach the authoritative Djonik Managed Agent as actual document content via the official Managed Agents `document` content block with inline base64, matching the #22 image-intake pattern; caption + document are supported together in one turn; scope is PDF-only; the size guard is a 20 MB encoded-base64 ceiling with an optimistic ~15 MB early raw-size rejection from Telegram's self-reported file size before download; actual PDF understanding was live-validated against the real production Managed Agent; a PDF → exactly one verified Trello task was live-validated end-to-end; ambiguity produces clarification with zero write; embedded prompt-injection text inside a PDF remained untrusted source data with zero unauthorized tool calls; existing text/image regressions passed; validation finished at ~$0.10 total across 4 paid Sessions with exactly 1 Trello mutation; local tests passed 109/109. Wave B3 — grouped related Telegram messages (#25) is accepted at commits `035432216cdeee84b719e2be50df88d83cf78e31` and `04c8a028f293cb5969969bd94c6dd2ddadb3b79d`: related Telegram fragments are deterministically grouped in-memory by explicit `media_group_id` or a bounded adjacent-message window, ordered by `message_id`, isolated by chat/user, bounded to 20 fragments, and dispatched once; grouped image/PDF transport reuses the accepted native #22/#24 paths; a live concurrency blocker was found and fixed by FIFO-serializing `DjonikSessionHandle.send()` so one Managed Session never has overlapping turns; same-card Trello verification, #23 due-date finalization, telemetry attribution, and grouped dispatch remain isolated; live A–G acceptance completed within guardrail at $0.23 total / 2 paid Sessions / exactly 1 verified Trello mutation; local tests passed 154/154. Wave B4 — structured task/checklist generation from studio intake (#26) is accepted at commit `778ffd26984bba44df94e0008117f7c69242a1cf`: the new `studio-intake` Skill turns text, grouped Telegram input, screenshots/images, and PDFs into concise actionable task structure with useful substeps when warranted while leaving mutation/target/verification ownership in `task-management`; atomic tasks remain atomic; explicit create still uses the existing verified `trelloWriteCard` path; `trelloWriteChecklist` remains disabled and generated substeps are represented honestly in card description; a live wrong-project ambiguity failure on Haiku was fixed by hardening `task-management` so new-task project identity cannot be inherited from mere conversational recency, and the final deconfounded live retest asked for project clarification with zero mutation; production Haiku remains the intentional baseline; an intermittent provider-side Managed Agents `Could not process image` failure was isolated as non-local and remains a residual provider caveat; local tests passed 178/178. Wave B5 — Preserve source context across rich studio intake (#27) is accepted at commit `28c3db2d12d55e89533ef1c91d5c3d305476e66a`: Telegram rich intake now preserves native cross-modal content-block order and caption↔attachment relationships through one shared Managed Agent turn pipeline; live validation passed text→image→correction, caption authority, text→PDF→correction, native album ordering, prompt-injection safety, and no raw-source persistence; execution-critical negative constraints were hardened after live validation exposed an omission, and the final verified Trello card preserved `Mobile version NOT required`, targeted Djonik / Backlog, used exactly one `trelloWriteCard`, and passed same-card `trelloReadCard` verification; `trelloWriteChecklist` remained disabled. Product Owner accepted one residual non-blocking caveat: Haiku may omit an explicitly requested textual provenance line in the Trello description even though source provenance is preserved and used for reasoning; no deterministic write-path safeguard is added for that caveat in Wave B. Wave B is complete. The canonical NOW item is Wave C1 — Evidence-based project health review (#28).

Wave C1 live diagnostics have now established a measured architecture split. Haiku remains the intentional production baseline and is suitable for ordinary operational flows, but repeated Project Health tests exposed persistent nuanced PM-judgement failures even after Skill simplification. A bounded Sonnet diagnostic on the same `project-health` Skill and live Trello data avoided the dominant observed Haiku correctness failures in the tested A/B scenarios (unsupported Waiting, model-derived weekday/countdown wording, `lastActivityAt`-as-progress, and overstated due/risk), while still showing residual verbosity and one invented entity. The same-turn fresh-read gap also occurred on Sonnet, confirming that #18 is a Managed Agents/platform limitation rather than a Haiku-only weakness. Product Owner direction: the next bounded C1 architecture slice is native Managed Agents delegation from the primary Haiku Djonik coordinator to one read-only Sonnet Project Health specialist subagent. Advisor is not part of this slice; no application phrase router is allowed; production remains unchanged until delegated live acceptance passes.

## Execution order

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
- production Haiku remains the intentional baseline after a bounded regression gate;
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

### NOW — Wave C1: Evidence-based project health review (#28)

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
- **one final production smoke** through a fresh Session that resolves production v19 (and specialist v4) is the only remaining gate before Issue #28 closes — no Session/turn has been run against v19 yet, and #28 remains open;
- the accepted #18 same-turn fresh-read platform limitation is unchanged and remains an accepted platform limitation, not something this cutover fixes.

Historical reviews and proactive follow-up remain later Wave C slices.

## Capability waves after reliability/cost closeout

### Wave B — Studio intake
- screenshots/images;
- PDFs/files;
- grouped related Telegram messages;
- structured task/checklist generation;
- source-preserving context.

### Wave C — Project health and reviews
- project-health capability;
- bounded Sonnet Project Health specialist behind the primary Haiku coordinator when accepted;
- evidence-based work review;
- stale/blocked/risk judgement;
- meaningful follow-up lifecycle.

### Wave D — Proactive PM
- scheduled morning/weekly agent turns;
- reminder/follow-up triggers;
- silent-by-default exception monitoring;
- Telegram delivery only when useful.

### Wave E — Calendar and wider integrations
- Google Calendar awareness;
- calendar-informed planning;
- bounded event management;
- selected additional integrations only when they improve the PM loop.

### Wave F — Additional specialist agents if justified
Project Health is the first measured specialist case and is being handled in Wave C1.

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
