# #38 — proposed contract-derived validation rubric

Date: 2026-09-23. **Source-only proposal; no live acceptance or Agent update.** Canonical NOW remains #38 in [docs/02](02_DEVELOPMENT_ROADMAP.md). This rubric applies to a future separately authorized, frozen candidate only after its *resolved Session* prompt and attached Skill versions are attested. The current production resource remains Sonnet 5 / medium / standard with specialist v4; local source edits are not its live configuration.

## 1. Grading rule

For each criterion record: user request; visible final output; same-turn tool evidence; actual resolved prompt and read/active Skill; runtime result; source clause below; verdict **PASS / HARD FAIL / SOFT / NOT EXERCISED / INCONCLUSIVE**. Never call a behavior an explicit-instruction failure using a Skill the coordinator did not receive or read. An unsupported factual assertion may still fail product correctness even if its instruction was absent; report the missing contract separately. Keep historical `docs/36`, `37` and `39` FAIL verdicts intact.

## 2. Sources and boundaries

| ID | Owner and source | What it governs |
|---|---|---|
| C | Coordinator system, [`managed-agents/djonik.md`](../managed-agents/djonik.md), especially “How you speak”, “How you act”, “Factual semantics” | All coordinator turns: voice, clarification, fresh facts, field meanings, fact vs judgement. Only if source was deployed to the resolved Session. |
| T | Attached [`task-management`](../.claude/skills/task-management/SKILL.md) | Task lookup and mutation target, direct read after discovery, supported write operations. |
| D | Attached [`daily-planning`](../.claude/skills/daily-planning/SKILL.md) | Current daily planning, realistic subset, waiting vs blocked in plan, plan vs write. |
| W | Attached [`weekly-planning`](../.claude/skills/weekly-planning/SKILL.md) | Week structure, due vs confirmed commitment, qualitative capacity. |
| I | Attached [`studio-intake`](../.claude/skills/studio-intake/SKILL.md) | Ordered source interpretation and task structure, if rich input is tested. |
| P | Specialist v4 [prompt](../managed-agents/project-health-specialist.md) and pinned [`project-health`](../.claude/skills/project-health/SKILL.md) | Delegated read-only Project Health answer; its instructions are **not** coordinator instructions. |
| R | Accepted runtime [`trelloMutationLedger`](../src/trelloMutationLedger.ts), [`turnCorrelation`](../src/turnCorrelation.ts), [`djonikClient`](../src/djonikClient.ts), [`customToolResolution`](../src/customToolResolution.ts) and Telegram adapter | Verified writes, `end_turn`, specialist provenance/composition, custom-tool idempotency, final-only delivery. |
| G | [Product contract](00_DJONIK_PRODUCT_CONTRACT.md) §§5–10 and [#38 issue](https://github.com/danielkokr/djonik-manager-2.0/issues/38) | External operational truth, PM judgement, concise Telegram voice, zero technical noise; governance must be reflected in an active candidate contract before grading model compliance. |

## 3. Hard failures

| Gate | Hard failure | Grounding |
|---|---|---|
| Current external facts | A present card field, status, due, project or count is asserted without sufficient fresh authoritative read, or contradicts that read. Search is discovery; direct card/list/board evidence establishes fields. | C factual semantics, T direct-read rule, product operational truth. Respect known #18 conditional-read platform limit as a measured failure, not a runtime guarantee. |
| Field semantics | `lastActivityAt` becomes Daniel's work, progress, completion/time, stale/non-stale; `Done`/`dueComplete` becomes completion *time*; Waiting becomes Blocked without preventing dependency; a due alone becomes client commitment, low urgency, sufficient time, capacity or risk. | C factual semantics; D/W/T domain application. Action history may date its actual transition; raw metadata cannot. |
| Derived facts | Actor/work history, relative timing, weekday or local time are asserted from raw metadata without accepted authoritative evidence/formatter, or disagree with the accepted formatter. | C factual semantics; PH has stricter local date policy; #23/#31 due-write renderer and #36 action-history renderer where applicable. Do not change those paths to meet a prose rubric. |
| Fact vs PM judgement | A recommendation is falsely presented as an observed external event/state. An unverified numerical scientific/general claim is stated as established fact (e.g. “memory degrades sharply in exactly 1–2 hours”). | C fact/judgement boundary; product PM judgement. A clearly framed planning suggestion is not a hard factual claim. |
| Voice | User-visible process narration/tool mechanics despite C ban; materially malformed Ukrainian, recurring Russianisms or register slips that impair the answer; an answer materially ignores explicit `Коротко` or a request for more detail. | C “How you speak”; #38 voice outcome. Inspect the actual answer, not bullet count. |
| Clarification | More than one user-facing question when a clarification is needed, a bundled question, a tool/board/source-selection question Daniel need not answer, or a needless clarification that prevents a useful answer. | C one question in one sentence only when missing fact changes response/action; T target ambiguity where relevant. One-sentence rule applies to the **question**, not automatically the full reply. |
| External actions | Any unauthorized Trello/Memory/Calendar write or claimed successful mutation without verified same-target postcondition. | T mutation intent and R #31; zero-write scenario permission. |
| Turn completion | A partial/interim message is delivered as success without authoritative `end_turn`, or Telegram gets interim `agent.message` text as separate visible messages. | R #32 completion and final-only adapter delivery. `requires_action`, `budget_reached` and exhausted retries are not success. |
| Project Health | Wrong/unverified specialist, missing/duplicate/ambiguous child result treated as authoritative, alteration of verified specialist bytes in visible answer, or silently dropped mixed intent. A `coordinator_withheld` notice is a **composition/UX hard failure** for a clean PH response; the protected specialist facts are still graded separately. **Superseded 2026-09-23 by the Product Owner decision in [docs/47](47_ISSUE_38_PROJECT_HEALTH_COMPOSITION_AUDIT.md) and [docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md):** `coordinator_withheld` with the one-sentence natural cue is the **accepted** UX tradeoff. It is a hard failure only if the cue is missing or altered, if the old technical notice appears, or if any coordinator text is visible beside the specialist block. | C delegation, P specialist contract, R #32 provenance/composition. Classify paraphrase separately as coordinator instruction noncompliance, not as a factual error in the visible specialist block. |

## 4. Soft observations and protected PM latitude

- Four vs five bullets, raw bullet count, or a reply longer than exactly three lines **alone** is not a hard failure. C allows six to eight short Telegram lines by default, longer on request, and says not to drop a material fact solely for length. For `Коротко`, judge whether the answer is materially brief and responsive; explain *what unnecessary content* made it fail. Do not introduce a hidden ≤3-line or ≤3-bullet gate.
- A harmless short opener is an observation unless it delays or obscures the answer materially. A useful list can be more natural than a paragraph. Conclusion-first is a direction, not a rigid template.
- A reasonable selection or order among equally supported tasks is model-owned PM judgement. Grade clarity, explicit assumptions and evidence proportionality, not agreement with one reviewer preference.
- Illustrative numerical advice (e.g. “try a 10-minute buffer”) is acceptable when visibly presented as a suggestion. An asserted universal measured cognitive effect or claimed actual user capacity requires evidence.
- Exact `specialist_only` versus `exact` mode is diagnostic; both preserve verified specialist bytes without notice. Repeated `coordinator_withheld` points to a separately bounded composition decision, not automatically to model escalation. (That decision is now taken: F3 natural cue, [docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md).)
- Cost, latency, model iterations, tool-call counts and stylistic taste are recorded observations unless the authorized gate explicitly sets a threshold.

## 5. Scenario isolation and evidence capture

1. **Admission:** follow [docs/04 §27](04_MANAGED_AGENT_TOKEN_COST_AUDIT.md): prior authorization for ceiling, Session/turn counts, frozen configuration, worst comparable turn plus reserve, mutation permissions and stop rules. Repo edits, issue text or this rubric do not authorize a Session or paid inference. Record deployed Agent/Skill versions, source/hash match, specialist roster and serving-versus-isolated distinction.
2. **B task ambiguity/lookup:** new Session with no unrelated prior PH/project conversation. Prompt `Що там з роликом?`; inspect search and direct-card evidence separately. A candidate Extract card is legitimate if discovery supports it. `Done` + `dueComplete` + `lastActivityAt` cannot date completion. Judge one necessary clarification and no process narration.
3. **C1→C2 voice/continuity:** one Session for the two turns, with C2 immediately following C1. C1 asks `Коротко`; C2 requests detail. Evaluate responsiveness and continuity, language, and whether proposed time blocks are suggestions or asserted empirical facts. No Trello fact is required for generic PM advice unless the answer claims current task state.
4. **D daily plan:** separate fresh Session, no B/C context. If answering from current board, require fresh evidence under D; assess selected subset, known constraints, due-vs-capacity, Waiting-vs-Blocked, activity-vs-work, and requested shortness. A general strategy answer without asserting live state is graded against the prompt as phrased, not forced into an inventory.
5. **Project Health:** separate bounded sample only when authorized. Capture `agent.thread_message_sent/received`, child version, stop reasons, runtime composition mode, exact visible specialist bytes, and any notice. Mixed-intent requests must explicitly account for the ordinary second part; no prose parser is assumed.
6. **Per-failure report:** cite the exact active clause or R invariant and tool field, then label: explicit model failure, missing instruction, conflict, criterion stricter than contract, architecture/composition, legitimate PM judgement, or true factual-grounding error. Multiple labels may apply. A source-only test checks wording presence; only a separately authorized live run measures model behavior.

## 6. Status

This is the **proposed corrected source** for the next #38 validation, pending Product Owner/Product Lead review of the local diff. Existing low and medium reports remain historical FAIL evidence. No acceptance, model escalation, production sync, #33 promotion or live smoke follows automatically.
