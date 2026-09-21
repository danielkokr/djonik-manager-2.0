# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state — governance decision 2026-09-21

Foundations 1–12, studio intake Wave B and Project Health #28 retain their historical acceptance. #29 discovery/source work was accepted but its production attach failed live behavior; recorded Agent v21 rolled back to the accepted v19 configuration, with PH specialist v4. Work-review is retained remotely but unattached and unaccepted. An already-serving Telegram Session has not been attested by this audit.

The [architecture audit](17_DJONIK_V1_ARCHITECTURE_AUDIT.md) exposes uncovered deterministic verification/completion/relay cases despite 330 passing baseline tests. These are reachable offline failures, not a claim of production frequency. Fix those boundaries before further review-model experimentation. #18 conditional fresh-read enforcement, due-clearing provider limitations, disabled Calendar and previously accepted intake caveats remain unchanged.

Governance [#30](https://github.com/danielkokr/djonik-manager-2.0/issues/30) records this authorized docs/issues handoff. Documents are local until explicitly committed/published; a fresh checkout with the old roadmap must obtain this change before implementing the new queue. #30 stays open pending publication/PO closeout; its open state does not select implementation scope.

## Canonical v1 delivery queue

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
| 1 | [#31 — Trello mutation verification](https://github.com/danielkokr/djonik-manager-2.0/issues/31) | Governance handoff available; source fixes first |
| 2 | [#32 — Turn completion and specialist results](https://github.com/danielkokr/djonik-manager-2.0/issues/32) | #31 source checks pass; correlate late/reused child results and preserve mixed answers |
| 3 | [#29 — Current-state review and ownership validation](https://github.com/danielkokr/djonik-manager-2.0/issues/29) | #31/#32; simplify contract before an authorized isolated experiment |
| 4 | [#33 — Pinned release and serving Telegram Session](https://github.com/danielkokr/djonik-manager-2.0/issues/33) | Preparation may precede #29 experiments; actual promotion follows accepted candidate and explicit rollout authorization |
| 5 | [#34 — Conversational commitment/waiting/follow-up](https://github.com/danielkokr/djonik-manager-2.0/issues/34) | #33; extend accepted #13 and align deadline/waiting semantics |
| 6 | [#35 — Daily-use v1 acceptance](https://github.com/danielkokr/djonik-manager-2.0/issues/35) | Required gates accepted; working-week pilot and PO accept/hold |

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

### NOW — Wave C2: Reliable current-state work review and capability ownership validation (#29)

Canonical bounded issue: #29 (open). `docs/03_TARGET_CAPABILITIES.md` §8 — Work history and reviews.

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
- **Revised next slice (after #31/#32):** simplify current-state review and build a behavioral rubric. Later isolated, budgeted ownership validation may compare Haiku with a bounded extension of the existing Sonnet PH role; neither winner nor production attach is predetermined. Prior hardening-only recommendation is superseded by docs/17 and revised #29.
- A weekly journal/checkpoint or other persisted history mechanism is **not part of the current #29 implementation by default**. It may be considered only after live acceptance demonstrates a measured product gap that the bounded current-state review cannot satisfy; any persistent snapshot/journal/history mechanism requires a separate bounded architecture decision rather than being added implicitly here.
- The accepted #18 same-turn fresh-read limitation is unchanged.
- The 2026-09-21 governance decision supersedes the former rule that #29 must close before other work; the canonical queue above now selects reliability first.

Boundaries remain those of GitHub issue #29:

- read-only work review; zero Trello writes by default;
- no fake completion/movement/reopen chronology;
- no event/history DB, Trello mirror, snapshot store, webhook history pipeline, scheduler/cron, proactive notification system, vector DB/RAG, custom Messages loop, phrase/intent router, Calendar integration, or new specialist agent without a separate measured decision;
- current health/risk/waiting/blocking interpretation remains owned by the accepted Project Health specialist path;
- transient retrospective conclusions are not persisted to durable Memory as operational truth.

## Long-term capability map after the v1 queue

### Wave B — Studio intake
- screenshots/images;
- PDFs/files;
- grouped related Telegram messages;
- structured task/checklist generation;
- source-preserving context.

### Wave C — Project health and reviews
- project-health capability (accepted, Wave C1);
- bounded Sonnet Project Health specialist behind the primary Haiku coordinator (accepted, Wave C1);
- current-state work review (queued #29, Wave C2); historical chronology remains deferred;
- stale/blocked/risk judgement;
- meaningful follow-up lifecycle.

### Wave D — Proactive PM (after v1, measured need)

Prefer native Scheduled Deployments after checking workspace availability; up to nine minutes of jitter precludes exact-minute promises. Add only bounded delivery state (SEND/SILENT, deduplication, snooze/resolution, ambiguous-send handling), reusing tested finalization. No scheduler is being implemented now.

- scheduled morning/weekly agent turns;
- reminder/follow-up triggers;
- silent-by-default exception monitoring;
- Telegram delivery only when useful.

### Wave E — Calendar and wider integrations (after v1, measured planning need)
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
