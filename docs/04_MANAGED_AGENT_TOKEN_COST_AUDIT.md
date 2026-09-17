# Djonik 2.0 — Managed Agent token and cost audit

> **Scope:** Issue #16. Audit-first evidence only; no runtime optimization or product-semantic change was made.
>
> **Audit date:** 2026-09-16. **Evidence labels:** **Measured** means Claude Console/Analytics or repository evidence. **Inference** is constrained by that evidence. **Not measured** is deliberately not estimated.
>
> **Canonical spend policy (Issue #21):** any future paid Managed Agent audit or A/B validation follow-up in this repository must declare its budget before starting per **§27, Development / validation spend guardrail**.

## 1. Executive summary

A small number of visible user messages can produce millions of input tokens because a Managed Agent turn is often a chain of model iterations, rather than one request. Each iteration reuses large stable agent context and incorporates the growing tool/conversation state. Stable context is generally cache-read, but cache-read tokens remain visible in input usage.

The strongest representative observation was one daily-planning message: seven model iterations, nine tool calls, `242k` input-token composition (`227k` cache read, `15.6k` cache creation, `14` uncached), `2.0k` output, and `$0.10` session cost. An exact-deadline lookup required four iterations and totalled `131k` input-token composition / `$0.11` despite a one-sentence answer.

## 2. Current usage architecture

`Telegram message → telegramCli.ts → createSessionManager() → connectToDjonik() → Managed Session event stream → Managed Agent → Skills / Memory / MCP`

- `src/telegramCli.ts` forwards raw Telegram text to `session.send()`.
- `src/telegramAdapter.ts` keeps one Managed Session for the running Telegram process.
- `src/djonikClient.ts` creates the session with agent, environment, vault, and read/write Memory Store.
- The Console-owned agent configuration provides system prompt, Skills, MCP schemas and tools.
- The local client observes MCP use/results but does not receive or persist usage/cost events.

For every successful `trelloWriteCard`, the local backstop requires a successful same-card `trelloReadCard`. If absent, it sends one corrective nudge and fails closed if verification still does not happen. This is intentional correctness work, not an accidental retry.

## 3. Measured baseline per scenario

Console reports uncached input, cache writes, cache reads, and output at session total. “Input composition” is their sum. Console does not expose a per-tool, per-Skill, or per-Memory-file token allocation.

| Scenario | Session | Iterations | Input composition | Output | Tool calls/results | Skill | Memory files read | MCP | Cost |
|---|---|---:|---:|---:|---:|---|---:|---|---:|
| D-like: exact deadline, `Автоматизація рендеру` | `sesn_01BQvrKfdzEVxnUm6bmd3qfR` | 4 | `8` uncached + `34.5k` write + `96.3k` read = **131k** | `479` | 4 / 4 | `task-management` | 0 observed | `trelloSearch`, `trelloReadCard` | **$0.11** |
| C-like: daily planning | `sesn_01EwekE3LiVQ3tVDpVjrtJBR` | 5 | `10` uncached + `15.1k` write + `159k` read = **174k** | `1.9k` | 7 / 7 | `daily-planning` | 3 | `trelloSearch`, `trelloReadCard` | **$0.09** |
| C-like: daily planning, wider direct-read path | `sesn_016coG8epmk829L6u2hw9PEA` | 7 | `14` uncached + `15.6k` write + `227k` read = **242k** | `2.0k` | 9 / 9 | `daily-planning` | 3 | member/card/board/card reads; one card-read failed | **$0.10** |
| Earlier factual lookup; not authoritative after #15 | `sesn_0191YS6pYKtYqpxr41QQN94J` | 2 | `4` uncached + `963` write + `59.9k` read = **60.8k** | `149` | 1 / 1 | none | 0 | `trelloSearch` | **$0.02** |

### Requested scenarios not yet controlled

The bounded follow-up on 2026-09-16 controlled A (`Привіт`) and F (the same prompt, fresh versus continued session); its measured evidence is in §16. B (`Що зараз горить?`) and E (reversible verified write) remain deliberately unmeasured: this issue does not authorize extra prompts or a live Trello mutation beyond the bounded follow-up.

## 4. Cost/token per visible turn

**Measured:** observed visible-turn costs are `$0.02`, `$0.09`, `$0.10`, and `$0.11`. The variation follows internal model/tool passes, not response length.

**Measured:** first internal model passes consistently began around `29.9k–30.1k` input tokens. This is the available measurement of stable per-iteration overhead.

**Inference:** that prefix contains agent instructions, tool-use instructions, configured schemas, agent/Skill metadata, and session-resource instructions. Console does not apportion exact token shares.

## 5. Session growth

In the seven-iteration planning session, displayed per-iteration input grew from `30.1k` to `45.5k`. The turn read a Skill, listed/read Memory, received an erroring direct-card read, read board/card state, then reasoned over it. This directly shows tool activity growing later context inside one turn.

**Not measured:** controlled first, second, and fifth *user turns* in one Managed Session. Telegram intentionally keeps the session for its process lifetime; whether longer history is compacted or becomes excessive needs controlled F before any lifecycle change.

## 6. MCP/tool-schema overhead

The inspected session exposed **17 tools**, including **nine Trello tools**. The detailed planning run used five tool identities and nine calls.

Anthropic documents that tool definitions/schemas, tool-use blocks and tool-result blocks contribute to input tokens. The current API/Console evidence does not give token counts per schema or prove the full schema is counted on every particular pass; that attribution remains inference.

## 7. Memory and Skill overhead

Daily planning read its Skill, enumerated Memory, then read `preferences.md`, `trello-conventions.md`, and `seqthera.md`. Those actions add calls and make their content available to subsequent model passes.

This is evidence that Memory/Skills participate in cost, not evidence that they are redundant. Removing them would risk PM quality and contradict product architecture.

## 8. Prompt-cache evidence

Caching is active and material:

- representative session cache reads: `59.6k`–`227k`;
- representative cache writes: `963`–`34.5k`;
- Console cache analytics: `71.3%` cache-read ratio, `1.8M` cache reads of `3.2M` input-token composition in its displayed seven-day window.

Caching reduces billed input but does not make counters small or remove creation, output, and repeated-agent-pass costs. Anthropic pricing confirms that tool schemas, tool blocks and tool results are input-token contributors: <https://docs.anthropic.com/en/docs/about-claude/pricing>.

## 9. Tool-result and retry-loop evidence

One planning trace had a failed `trelloReadCard` followed by additional reads. That added model passes and context growth; it is not evidence of a duplicate top-level Telegram message.

No observed representative write exercised the local verification nudge. The code bounds it to one extra turn and fails closed. Its exact live cost is **not measured**.

## 10. Development tests versus real Telegram usage

Console Usage for 2026-09-16 showed **11,674,445 input tokens** and **71,312 output tokens**, grouped as Sonnet 5. The session list showed many recent Djonik sessions minutes apart with diagnostic-style prompts and roughly `60.8k–242k` input-token composition each.

**Inference:** repeated Foundation/Console validation can materially drive daily usage.

**Not measurable from current dashboard:** a source label separating Telegram, CLI, raw Managed Session diagnostics, and Console. A session with no deployment can originate from Console or the thin adapter. No percentage split is claimed without source-correlated telemetry or a usage export grouped by distinct credential/tag.

## 11. Ranked root causes

1. **Repeated stable Managed Agent context across internal iterations** — measured `~30k` starting input and `45.5k` later in one turn.
2. **Tool loops and results** — measured 4–9 calls and 2–7 iterations for one visible message.
3. **Memory/Skill retrieval** — measured in planning; exact token share unavailable.
4. **Configured tool surface** — measured 17 visible tools / 9 Trello tools; exact schema share unavailable.
5. **Long-lived Telegram history** — plausible risk, not yet measured across multiple user turns.

## 12. Bounded optimization options — do not implement in #16

| Option | Expected impact | Risk | Layer | Behavior change |
|---|---|---|---|---|
| Add per-visible-turn observability: session ID, MCP count, result count, nudge count, Console trace link | High attribution value; no immediate cost reduction | Low | Thin adapter/client | No |
| Development test budgets and fixed representative matrix | Prevents avoidable validation spikes | Low | Workflow | No product change |
| Measure rollover threshold after F | Unknown until measured | Medium: continuity | Session lifecycle | Potentially |
| Narrow tool surface only after schema/use evidence | Potential stable-prefix reduction | Medium/high: capability loss | Agent config | Possibly |
| Bound unusually large tool results only with evidence | Potential later-context reduction | Medium: freshness/planning | MCP config | Possibly |

## 13. Recommended cost guardrails

1. Treat Console session cost/token totals as development stop signals before repeating validation.
2. Establish a per-validation budget and maximum session count.
3. Add source correlation before the next audit pass so Console, CLI and Telegram can be separated.
4. Verify current Managed Agent support for per-session/request ceilings before configuring any; do not replace Managed Agents with a custom loop.
5. Reserve a distinct cost envelope for verified writes, which deliberately include a same-card read and possibly one corrective turn.

## 14. Do not optimize away

- authoritative direct Trello reads;
- same-card verify-after-write;
- bounded corrective nudge and fail-closed behavior;
- Memory attachment and durable-vs-live-state policy;
- reusable PM Skills;
- fresh MCP reads needed for operational truth.

## 15. Verification and repository status

- `npm run typecheck` — passed.
- `npm test` — passed: 32 tests, 32 passed, 0 failed.
- `git diff --check` — passed.
- `git status --short` before this report — clean.

This report is the only intended working-tree change. No commit, push, deploy, runtime optimization, or Issue closure was performed.

## 16. Bounded follow-up: trivial turn and fresh versus continued session (2026-09-16)

### Scope and method

**Measured.** Exactly two new Managed Sessions and three visible prompts were used, all in the Console against the current `Джонік` agent, `Djonik Default` environment, `Djonik Personal` vault, and attached `Djonik Memory` store with the same memory instructions as `src/djonikClient.ts`. No Agent, Skill, Memory, MCP, model, thinking, budget, runtime, or lifecycle configuration was changed.

Session A (`sesn_01DqiSioxXyQcumgxBPa9BA9`) received `Привіт`, then the identical `Привіт` after it became idle. Fresh Session B (`sesn_01J9JFaDdf1MLtQUhnUK1zfP`) received one `Привіт`. Numbers below are exact `session.usage` values from the Console event payloads, except where marked as a difference.

The test is production-path representative at the Managed Session resource level, but it is **not** a Telegram adapter lifetime measurement: Console sessions have no deployment and only two user turns were observed.

### Measured table

| Metric | A1 fresh | A2 continued delta | B1 fresh control |
|---|---:|---:|---:|
| Session ID | `sesn_01DqiSioxXyQcumgxBPa9BA9` | same session | `sesn_01J9JFaDdf1MLtQUhnUK1zfP` |
| Model/agent iterations | 3 | 1 | 2 |
| Uncached `input_tokens` | 6 | +2 | 4 |
| `cache_creation_input_tokens` (5m) | 31,476 | +31,509 | 159 |
| `cache_read_input_tokens` | 60,936 | +0 | 60,784 |
| `output_tokens` | 173 | +48 | 141 |
| Input composition (`input + write + read`) | 92,418 | +31,511 | 60,947 |
| Cumulative session composition after turn | 92,418 | 123,929 | 60,947 |
| List cost | $0.09 | +$0.08 | $0.01 |
| Cumulative session list cost after turn | $0.09 | $0.17 | $0.01 |
| Tool calls / tool results | 2 / 2 | 0 / 0 | 1 / 1 |
| Skill files read | 0 | 0 | 0 |
| Memory files read | 1 (`preferences.md`) | 0 | 0 |
| MCP calls | 0 | 0 | 0 |

`input_tokens` is uncached input; cache-read tokens are intentionally reported separately and are not relabelled as uncached. `list_cost` is the Console's cumulative public list-cost amount in USD.

### What the three measurements establish

**Measured — baseline.** A user-visible greeting is not necessarily a no-tool turn. A1 ran three model passes, listed the mounted Memory directory, read `preferences.md`, and cost $0.09. B1 ran two model passes and listed the Memory directory, but did not read a Memory file; it cost $0.01 because 60,784 of its 60,947 input composition tokens were cache reads. Therefore the measured simple-turn baseline is a range in this small sample, not a single invariant number: 60,947–92,418 input-composition tokens and $0.01–$0.09.

**Measured — continued versus fresh.** A2 added one pass, no tool work, 2 uncached input tokens, 48 output tokens, and 31,509 **new cache-write** tokens. It had zero cache reads and added $0.08. Its 31,511-token composition is lower than either fresh first turn, but it was not cheap relative to B1 because cache reuse did not occur. A2's cumulative total was exactly A1 plus its displayed delta.

**Measured — cache.** Prompt caching was active in A1 and B1 (60,936 and 60,784 cache reads respectively), but was not used by A2 (zero cache reads) after an 8m49s gap. That timing is consistent with the documented short-lived cache window, but the causal attribution is an **inference**, not a Console-proven expiry reason. The cache-written prefix is not decomposed by API into system prompt, schemas, Memory instructions, or history.

**Measured — session growth evidence.** The second visible turn did not replay the first turn's tool results into a new model call in the observed trace: it had one model request, no tools, and its per-request usage was `2 input → 48 output · 0 cache read · 31,509 cache write`. This is evidence against immediate tool-loop amplification on turn two. It is insufficient to conclude anything about fifth-turn growth, automatic compaction, or Telegram process-lifetime sessions.

**Measured — accidental extra iterations.** Yes: both genuinely fresh `Привіт` turns performed extra internal iterations (A1: 3; B1: 2) because the agent invoked the mounted-memory directory listing; A1 additionally read `preferences.md`. A2 did not: one model iteration, no tools.

### Interpretation and next safe step

There is **not yet** evidence to test a Telegram session rollover policy. This bounded result shows that a continued turn can be smaller in composed tokens but can miss cache reuse and create a full new cached prefix. The next optimization step should therefore remain observability/measurement: correlate session usage with Telegram traffic and capture later controlled turns before changing lifecycle. It must not remove Skills, Memory, MCP, or verify-after-write safeguards.

### Exact additional spend of this bounded test

**Measured:** the three permitted prompts consumed $0.18 in Console public list cost: Session A finished at $0.17 and Session B at $0.01. Summing the two session totals gives 12 uncached input tokens, 63,144 cache-creation tokens, 121,720 cache-read tokens, and 362 output tokens (184,876 input-composition tokens). This is a sum of per-session cumulative usage, not a category-level invoice reconciliation.

## 17. Bounded follow-up: Tool Surface Audit (2026-09-16)

### Executive summary

**Measured.** The current `Джонік` Agent, version 11, configures 32 named server-executed tools: eight built-ins, 15 Trello MCP entries, and nine Google Calendar MCP entries. Eight built-ins, nine Trello reads plus `trelloWriteCard`, and all nine Calendar tools have `Always allow` permission. Five other Trello writes have `Always deny` permission.

**Important distinction.** `Always deny` is a permission policy, not proof of `enabled: false`. Anthropic documents that policy governs execution of an enabled tool and that `enabled: false` is the operation that removes a tool from the agent. Therefore this audit does not assume that the five denied Trello entries have zero schema/prefix impact.

**Measured / not measured.** The Console exposes tool names, descriptions for built-ins, permissions, and MCP server URLs, but not the raw MCP `input_schema` payloads. Existing session traces do not contain them either. Consequently no per-tool serialized bytes or reliable schema-token counts were measured, and the observed ~30k stable first-pass prefix cannot be apportioned to tools. The Messages token-count endpoint is not a valid replacement: Anthropic documents that it rejects requests containing the MCP connector.

**Conclusion.** There is enough evidence to plan, but not yet to safely narrow the active surface. `trelloSearch`, `trelloReadCard`, `trelloReadBoard`, `trelloReadList`, and `trelloWriteCard` protect accepted task/planning flows. The only plausible later *candidates for an A/B configuration test* are `trelloReadChecklist`, `trelloReadInbox`, and `trelloReadPlanner`; no change is recommended in this audit. Calendar is a larger currently-unused configured surface, but Calendar is explicitly a later capability and requires a separate product decision rather than opportunistic removal.

### Method and limits

Read-only Console inspection was used; no Agent config was saved, no Session was created, and no user-visible prompt was sent. Evidence is from the current Agent configuration, the Foundation 8–16 evidence preserved in this report/repository, and the canonical Skills and product documents.

For each MCP entry, **enabled** below means its Console permission was `Always allow`; **execution-blocked** means `Always deny`. It does not claim `enabled:false` unless explicitly observed (it was not). “Used” means observed in the retained Foundation/audit traces or required by accepted Skill/runtime evidence; it does not mean a complete production-traffic census.

### Later-established configuration correction

The preceding Console-only statements are historical evidence, not the final configuration truth. The later official Agent API retrieval recorded in §23 proved that production Agent v12 has `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, and `trelloWritePlanner` at `enabled:false`; `trelloWriteCard` remains `enabled:true`. The earlier Console inspection could not prove that enabled state. Therefore these five unsupported writes are absent from the current active tool surface and no additional saving remains to be obtained by disabling them.

### Full current tool inventory

| Tool | Provider | Current permission/state | Read / write | Purpose | Schema bytes / tokens | Foundation 8–16 evidence |
|---|---|---|---|---|---|---|
| `bash` | built-in | Always allow | command execution | list/query sandbox files | Not exposed | Used on both fresh greeting traces to list `/mnt/memory` |
| `read` | built-in | Always allow | read | read Skills, Memory, staged large results | Not exposed | Used to read `preferences.md`; required for progressive Skill/Memory loading |
| `write` | built-in | Always allow | write | write sandbox files | Not exposed | No retained trace |
| `edit` | built-in | Always allow | write | string replacement in sandbox files | Not exposed | No retained trace |
| `glob` | built-in | Always allow | read/search | file pattern matching | Not exposed | No retained trace |
| `grep` | built-in | Always allow | read/search | regex text search | Not exposed | No retained trace |
| `web_fetch` | built-in | Always allow | read/network | fetch URL content | Not exposed | No retained trace |
| `web_search` | built-in | Always allow | read/network | search the web | Not exposed | No retained trace |
| `trelloReadBoard` | Trello MCP | Always allow | read | board state / board-level card listing | Not exposed | Used in wider daily-planning trace |
| `trelloReadCard` | Trello MCP | Always allow | read | authoritative card fields | Not exposed | Used for factual reads, planning, and the same-card verification invariant |
| `trelloReadChecklist` | Trello MCP | Always allow | read | checklist state | Not exposed | No retained trace |
| `trelloReadInbox` | Trello MCP | Always allow | read | inbox state | Not exposed | No retained trace |
| `trelloReadList` | Trello MCP | Always allow | read | list state | Not exposed | No retained trace |
| `trelloReadMember` | Trello MCP | Always allow | read | member metadata / assignment context | Not exposed | Used in wider daily-planning trace |
| `trelloReadPlanner` | Trello MCP | Always allow | read | provider planner state | Not exposed | No retained trace |
| `trelloReadWorkspace` | Trello MCP | Always allow | read | workspace metadata | Not exposed | No retained trace |
| `trelloSearch` | Trello MCP | Always allow | read/discovery | find candidate cards/boards/lists | Not exposed | Used in factual and planning traces; Skill requires it only for discovery |
| `trelloWriteBoard` | Trello MCP | Historical Console: execution-blocked (`Always deny`); later API: `enabled:false` | write | mutate board | Not exposed | No retained trace; outside current accepted scope |
| `trelloWriteCard` | Trello MCP | Always allow | write | bounded create/update/move/complete card | Not exposed | Accepted Foundation 7 write surface; deterministic verification observes it |
| `trelloWriteChecklist` | Trello MCP | Historical Console: execution-blocked (`Always deny`); later API: `enabled:false` | write | mutate checklist | Not exposed | Outside current accepted scope |
| `trelloWriteInbox` | Trello MCP | Historical Console: execution-blocked (`Always deny`); later API: `enabled:false` | write | mutate inbox | Not exposed | Outside current accepted scope |
| `trelloWriteList` | Trello MCP | Historical Console: execution-blocked (`Always deny`); later API: `enabled:false` | write | mutate list | Not exposed | Outside current accepted scope |
| `trelloWritePlanner` | Trello MCP | Historical Console: execution-blocked (`Always deny`); later API: `enabled:false` | write | mutate provider planner | Not exposed | Outside current accepted scope |
| `create_event` | Google Calendar MCP | Always allow | write | create calendar event | Not exposed | No retained trace; Calendar is later roadmap capability |
| `delete_event` | Google Calendar MCP | Always allow | write | delete calendar event | Not exposed | No retained trace; Calendar is later roadmap capability |
| `get_event` | Google Calendar MCP | Always allow | read | read one event | Not exposed | No retained trace; Calendar is later roadmap capability |
| `list_calendars` | Google Calendar MCP | Always allow | read | enumerate calendars | Not exposed | No retained trace; Calendar is later roadmap capability |
| `list_events` | Google Calendar MCP | Always allow | read | list event/availability state | Not exposed | No retained trace; Calendar is later roadmap capability |
| `respond_to_event` | Google Calendar MCP | Always allow | write | RSVP/respond to event | Not exposed | No retained trace; Calendar is later roadmap capability |
| `search_events` | Google Calendar MCP | Always allow | read | search events | Not exposed | No retained trace; Calendar is later roadmap capability |
| `suggest_time` | Google Calendar MCP | Always allow | read | propose available time | Not exposed | No retained trace; Calendar is later roadmap capability |
| `update_event` | Google Calendar MCP | Always allow | write | update event | Not exposed | No retained trace; Calendar is later roadmap capability |

The earlier audit's “17 visible tools / nine Trello” was from an inspected historical Session trace; it is not a schema inventory and must not be combined arithmetically with the current version-11 configuration.

### Trello matrix for accepted functionality

| Category | Tools | Evidence and decision |
|---|---|---|
| **REQUIRED NOW** | `trelloSearch`, `trelloReadCard`, `trelloReadBoard`, `trelloReadList`, `trelloWriteCard` | `task-management` requires discovery followed by authoritative direct-card reads; `trelloReadCard` is the deterministic same-card verify-after-write pair; daily/weekly Skills require fresh board/list evidence; current bounded card write is accepted functionality. Do not disable. |
| **USEFUL BUT NOT CURRENTLY REQUIRED** | `trelloReadMember`, `trelloReadWorkspace` | Member reading occurred in a planning trace; workspace context can help cross-project/board discovery. Neither is an explicit invariant of the current Skills, but absence from a short trace set is not sufficient to remove them. |
| **CURRENTLY UNUSED / A/B CANDIDATE, NOT A CHANGE RECOMMENDATION** | `trelloReadChecklist`, `trelloReadInbox`, `trelloReadPlanner` | No retained Foundation 8–16 trace or accepted current Skill requires these. Checklist lifecycle, inbox, and planner operations are outside the current bounded task-management scope. First obtain schema/cost measurement and run a reversible config A/B before any disabling decision. |
| **LATER PROVEN DISABLED** | `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, `trelloWritePlanner` | Later official Agent API read-back proves `enabled:false`; correctly outside current write scope and absent from the active model surface. |

### Built-in tool assessment

`bash` and `read` are demonstrated requirements of the current Memory path: fresh greetings used `bash` to enumerate the mounted Memory directory and one then used `read` for `preferences.md`. `read`, `glob`, and `grep` are also the natural progressive-loading surface for Skills and large results. Disabling any of them risks breaking Memory/Skill loading before a dedicated test proves otherwise.

`write` and `edit` have no retained Foundation trace, but native Memory is attached with read/write access and the Agent product is intended to remember durable information; no current evidence proves they are irrelevant to that managed runtime. `web_fetch` and `web_search` likewise have no observed use, but are enabled built-ins rather than a measured source of the current greeting/tool loops. No built-in tool should be disabled on this evidence.

### Stable-prefix and schema impact

| Claim | Status |
|---|---|
| First internal pass has roughly 30k stable input | **Measured** in the initial audit traces. |
| Current config has 32 named entries / 27 `Always allow` entries | **Measured** from Console Agent v11. |
| Per-tool raw schema character/byte size | **Not measured**: Console and historical events do not expose MCP schemas. |
| Per-tool token count | **Not measured**: no schema input exists for a reliable local calculation; the official Messages count-tokens endpoint rejects MCP connector requests. |
| Tool-schema contribution to ~30k prefix | **Inference only**: definitions plausibly contribute, but the API provides no attribution. |

The correct next measurement is to export/obtain the exact MCP discovery schema without model inference, serialize it canonically, and compute local bytes/tokens against that artifact. Do not substitute a hand-written approximation or a Messages-only request without the MCP connector.

### Native Managed Agents capabilities: confirmed versus not confirmed

**Confirmed for Managed Agents.** Anthropic's Managed Agents MCP Connector documentation supports per-tool `enabled` configuration, both a denylist and a `default_config.enabled: false` allowlist. It also supports per-tool permission policies. That makes a narrow native MCP surface technically available without a custom Messages loop. [Managed Agents MCP Connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector), [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies).

**Not confirmed for Managed Agents.** The Managed Agents MCP Connector documentation inspected in this follow-up says each MCP tool config accepts `name`, `enabled`, and `permission_policy`; it does not document `defer_loading` or Tool Search for Managed Agents. The separate general/Messages API Tool Search and MCP Connector documentation does describe `defer_loading`, dynamic tool references, and MCP toolsets, but that is not proof of Managed Agents parity. Do not plan a Managed-Agent lazy-loading implementation until Anthropic publishes it for this API. [Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool), [Messages MCP Connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).

### Memory on a trivial greeting

The session-local `DJONIK_MEMORY_INSTRUCTIONS` says what may be written and what is durable; it never says “read Memory on every turn” or “read Memory for greetings.” The Agent system prompt says to remember durable information that materially improves future PM decisions, and the planning Skills restrict Memory to durable facts that shape planning judgement. None explicitly requires a greeting-time lookup.

Thus the observed A1/B1 directory listing is **measured agent behavior**, while “the current visible instruction caused it” is **not established**. The most defensible inference is that the model chooses to discover a mounted Memory resource when it is available; an uninspected managed-runtime attachment instruction could also contribute. The A1 preference-file read is a model choice after listing, not an explicit instruction requirement shown in the repository/Console.

A possible future prompt experiment is: “Consult Memory when personal or project context can materially improve the answer; do not retrieve it for a context-free greeting.” Its quality risk is low-to-medium: it could improve trivial-turn cost but must be tested against preference-sensitive greetings and planning. It must not change durable-memory write policy, attachment, or live-Trello precedence.

### Ranked safe candidates and exact next experiment

| Candidate | Expected token impact | Quality risk | Layer | Next action |
|---|---|---|---|---|
| Export exact MCP discovery schemas and measure serialized bytes/tokens | Attribution only; no runtime savings | None | Audit/observability | Read-only schema capture; no prompt/session. |
| Config A/B: retain required Trello five, set the three unused read candidates to `enabled:false` in a copy/version | Unknown until schema capture; could reduce stable prefix | Medium | Managed Agent MCP config | Compare one controlled fresh factual/planning matrix; restore immediately on any capability regression. |
| Config A/B: revise greeting-time Memory retrieval guidance | Potentially avoids 1–2 internal passes on context-free greetings | Low–medium | Agent/session instruction | Compare one fresh greeting plus preference-sensitive prompt after explicit approval. |
| Calendar surface review as a separate product decision | Potentially material: nine current always-allowed tools | Medium–high | Managed Agent MCP config / roadmap | Do not remove under #16; decide whether “later Calendar” should remain attached before Calendar foundation starts. |

### Do not disable and final decision

Do not disable the five required Trello tools, `bash`, `read`, progressive file-search tools, Memory attachment, Skills, or the same-card `trelloReadCard` verify-after-write path. Do not turn off a tool merely because it did not appear in the retained traces. There is **not enough evidence to safely narrow the current tool surface today**: direct schema size is unavailable and disabling is a behavioral change. There is enough evidence to authorize a narrowly scoped, reversible future A/B after Product Owner approval.

## 18. Bounded follow-up: raw MCP schema acquisition (2026-09-16)

### Result

**No raw MCP tool definitions were acquired. No model inference, Managed Session creation, user prompt, Agent update, permission change, or provider operation was performed.** Therefore there are no measured per-tool JSON character counts, UTF-8 byte counts, or token counts to report.

### Acquisition paths checked

1. **Current Console Agent v11 configuration (read-only):** exposes tool names, MCP server URLs, `enabled`/permission state, but not MCP `description` or `input_schema` definitions.
2. **Official Managed Agents Agent retrieval shape:** the installed official SDK's `BetaManagedAgentsAgent` returns `mcp_servers` and `mcp_toolset` configs. Each resolved MCP config contains only `name`, `enabled`, and `permission_policy`; it has no raw schema field. This agrees with the Managed Agents MCP Connector documentation, which treats tool schemas as provider-discovered server details rather than an Agent-retrieve response.
3. **Existing Session viewer/events:** official docs describe the Tools view as configured-tool names, call counts, failures, durations, and calls. Existing events expose MCP calls/results, not tool definitions. No historical event contained an `input_schema`.
4. **Direct provider MCP discovery:** MCP's normal `tools/list` discovery operation would require authenticating directly to each provider. Managed Agents documentation states that credentials are held in a vault and are supplied to an MCP server when a Session is created; the vault token is not returned by Agent retrieval. The repository shell had no usable Anthropic API credential for a separate retrieval call, and no credential was requested, exposed, or copied. Creating a new authorized Session solely to discover schemas is explicitly out of scope for this follow-up.

The relevant official constraints are: [Managed Agents MCP Connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector), [Managed Agents event stream/viewer](https://platform.claude.com/docs/en/managed-agents/events-and-streaming), and the [MCP `tools/list` protocol schema](https://modelcontextprotocol.io/specification/2025-06-18/schema).

### Per-tool schema table

All 24 requested MCP definitions have the same measured result: **raw definition unavailable in the permitted read-only scope**. `—` is intentionally not treated as zero.

| Provider / group | Tools | Raw definition | JSON chars | UTF-8 bytes | Claude-compatible tokens |
|---|---|---|---:|---:|---:|
| Trello — all configured | all 15 named `trello*` entries in §17 | unavailable | — | — | — |
| Trello — REQUIRED NOW | `trelloSearch`, `trelloReadCard`, `trelloReadBoard`, `trelloReadList`, `trelloWriteCard` | unavailable | — | — | — |
| Trello — unused-read A/B candidates | `trelloReadChecklist`, `trelloReadInbox`, `trelloReadPlanner` | unavailable | — | — | — |
| Trello — execution-blocked writes | `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, `trelloWritePlanner` | unavailable | — | — | — |
| Google Calendar — all configured | `create_event`, `delete_event`, `get_event`, `list_calendars`, `list_events`, `respond_to_event`, `search_events`, `suggest_time`, `update_event` | unavailable | — | — | — |
| Trello + Calendar total | all 24 MCP entries | unavailable | — | — | — |

### Relation to the measured ~30k stable prefix

The ~29.9k–30.1k first-pass stable input remains **measured**. The current 24 named MCP entries remain **measured configuration metadata**. Any percentage of that prefix assigned to MCP schemas is **unknown**: raw schemas, managed-runtime system instructions, built-in tool definitions, Agent system prompt rendering, Skill metadata, Memory attachment instructions, and hidden orchestration context are not apportioned by the API.

It would be misleading to multiply tool count by a guessed average schema size or treat an `Always deny` tool as zero-cost. The official Messages token-count endpoint cannot fill this gap because it rejects MCP connector requests; it would not measure the Managed Agents-rendered prefix even if a hand-written equivalent schema were supplied.

### Decision matrix after this measurement

| Group | Likely saving potential | Current product impact | Risk | Decision |
|---|---|---|---|---|
| Google Calendar (9 tools) | Potentially the largest candidate by count; **size unknown** | No accepted Foundation 1–12 Calendar flow; roadmap places Calendar in Wave E | Low for a temporary controlled A/B; medium if removed permanently without a Wave-E decision | Worth the first reversible A/B once prompts/Sessions are explicitly authorized. |
| Five Trello unsupported writes | No remaining saving to test: later API proved production `enabled:false` | None in current accepted write scope | Low | No further A/B; do not re-enable merely to create a baseline. |
| Three unused Trello reads | Potentially nonzero; **size unknown** | Medium: absence in retained traces does not prove no PM usefulness | Medium | Do not test before Calendar / blocked-writes. |
| Required Trello five | Unknown | Critical factual-read, planning, and same-card verification paths | High | Never use as a cost-only experiment. |

### Exact first reversible A/B recommendation

When the Product Owner separately authorizes inference-bearing testing, use **Google Calendar toolset exclusion as the first A/B**:

- **Control:** current Agent v11-equivalent surface.
- **Variant:** a session-local or isolated Agent-version configuration with the Calendar MCP toolset set to `default_config.enabled: false`; leave all Trello, built-ins, Skills, Memory, model, system prompt, and vault wiring unchanged.
- **Prompts:** one fresh context-free greeting and one current accepted Trello planning/factual read; no Calendar request and no write.
- **Capture:** exact `session.usage`, per-iteration input/cache composition, tool events, output quality, and any unexpected Calendar dependency.
- **Pass condition:** lower stable input/composed-token usage with no regression in the two current PM flows. Restore/abandon the variant on any regression.

This is a recommendation based on tool count and current roadmap scope, **not** a measured claim that Calendar schemas dominate the 30k prefix. The Memory-greeting conclusion is unchanged: its lookup was model behavior, not an explicit visible instruction requirement, and is not re-tested here.

### Remaining limitation

To produce real schema-footprint numbers, a future authorized measurement must either obtain an authenticated read-only `tools/list` response through a provider-approved credential path, or Anthropic must expose resolved MCP schemas in a Managed Agents read endpoint. Neither is available in this follow-up without violating the no-new-session/no-credential-access constraints.

## 19. Attempted Calendar-exclusion A/B — stopped before inference (2026-09-16)

### Result

**No A/B measurement was run.** Two new idle, production-like Managed Sessions were created: control `sesn_01VgzspjXdKFNjFZyr8VqUA1` and intended variant `sesn_01SGmz7ywae4vZ5Y6WnQAbiM`. Both remained at Console list cost **$0.00** with no events, no user-visible prompt, no model iteration, no tool call, and no MCP operation.

The intended one-prompt-per-session comparison was `Який дедлайн у Автоматизація рендеру?`. It was deliberately not sent.

### Why the test stopped

**Measured.** The Console Session-creation UI exposed the current Agent v11 resources and both MCP servers. For Google Calendar it exposed its nine individual tools and their `Always allow` *permission policy*, but did not expose a session-local `enabled:false` control or an editor for replacing `agent.tools` / `agent.mcp_servers`.

**Measured.** The freshly created Session UI exposed no discoverable safe session-local configuration update action. This is distinct from the documented API capability: the Console surface available for this test did not provide a verifiable way to make Calendar unavailable while preserving the full, byte/semantically-identical Trello and built-in configuration.

**Decision.** Per the bounded-test rule, no production-Agent workaround, permission-only substitute, Agent-version change, or prompt was attempted. `Always deny` would not be an equivalent experiment because it still leaves a configured tool visible to the model and would test execution policy rather than schema/surface exclusion.

### Consequence for the audit

There is no control-vs-variant token, cache, cost, or quality delta to interpret. The first reversible A/B remains valid in principle, but needs an authenticated, official Session API path that can update the idle Session's complete local `mcp_servers`/tool configuration and then read it back before either prompt. It must not be replaced by an Agent-wide change.

The underlying production Agent was not modified: this attempt used Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` (current Console version 11), `Djonik Default`, `Djonik Personal`, and the unchanged read/write `Djonik Memory` attachment. The report records the two idle session IDs solely for auditability; no runtime, Skills, Memory, Trello, Calendar, model, system prompt, effort, or product behavior was changed.

## 20. Calendar-exclusion A/B via Session Update API — blocked before GET (2026-09-16)

### Requested API method

The intended operation was the official SDK sequence: `client.beta.sessions.retrieve()` for both existing idle sessions, a full-array `client.beta.sessions.update(variantId, { agent: { tools } })` changing only the Google Calendar MCP toolset's `default_config.enabled` to `false`, followed by another `retrieve()` read-back. This is the documented session-local update path; it would not update the underlying Agent.

### Blocking evidence

**Measured.** The repository has no `.env` file (only `.env.example`), and the process environment has no `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `DJONIK_AGENT_ID`, `DJONIK_ENVIRONMENT_ID`, `DJONIK_MEMORY_STORE_ID`, or `DJONIK_VAULT_ID`. An official SDK `retrieve()` attempt therefore failed locally before making an authenticated request: the SDK could not resolve an authentication method. No credential value was read or printed.

**Not measured.** Because GET was unauthenticated, the current state/usability of `sesn_01VgzspjXdKFNjFZyr8VqUA1` and `sesn_01SGmz7ywae4vZ5Y6WnQAbiM` was not re-verified by the API. No Session update, read-back, user prompt, model iteration, Trello/Calendar call, or cost was incurred in this follow-up.

### Decision

The A/B was stopped before inference, as required. There is no control/variant telemetry, first-pass delta, total-turn delta, cache comparison, behavioral-equivalence result, or spend to report. The production Agent remains untouched because no authenticated write was possible.

The next step is operational rather than an optimization: make a scoped Anthropic API credential available to the approved local diagnostic path (without printing or committing it), then repeat exactly the bounded GET → session-local full-tool-array update → read-back → two-prompt protocol. Do not use the Console permission UI as a substitute and do not create replacement sessions.

### Retry after reported credential restoration

**Measured (same date).** After the requested local credential restoration, the official SDK retrieval was retried. It again failed before an authenticated request because the actual repository root visible to the diagnostic process still had no `.env` file and no `ANTHROPIC_API_KEY` in the process environment. Only file presence and variable presence were tested; no credential values were displayed, logged, or written.

The two existing Sessions were not retrieved, updated, prompted, or replaced during this retry. Additional test spend remains **$0.00**.

## 21. Completed Calendar-exclusion A/B via Session Update API (2026-09-16)

### Method and pre-inference verification

**Measured.** The official Anthropic SDK retrieved the two pre-created Sessions: control `sesn_01VgzspjXdKFNjFZyr8VqUA1` and variant `sesn_01SGmz7ywae4vZ5Y6WnQAbiM`. Both were `idle`, had an empty event list, zero input/output/cache usage, and `list_cost.amount: "0"` (USD minor units).

Both resolved snapshots matched before the update: Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, version 11; `claude-sonnet-5` / low effort / standard speed; identical system, Skills, MCP-server, tools, Memory-resource-instructions hashes; the same `Djonik Default` environment and `Djonik Personal` vault.

**Measured.** The variant alone was updated while idle using `client.beta.sessions.update(variantId, { agent: { tools } })`. The complete retrieved `tools` array was copied and posted back. The sole change was `google-calendar-calendarmcp` `mcp_toolset.default_config.enabled: true → false`. `mcp_servers` was omitted, so it was preserved. Read-back confirmed:

- Calendar MCP server remained declared, while its toolset default was `enabled:false` (all nine Calendar tools unavailable);
- Trello toolset/configs and built-in `agent_toolset_20260401` were unchanged;
- Agent ID/version, model, system, Skills, Memory, vault, and environment were unchanged.

This was a session-local update only. A final Agent-resource GET matched the original production Agent v11 system/Skills/tools/MCP-server hashes; no production Agent update occurred.

### Exact A/B telemetry

Both Sessions received exactly one identical prompt: `Який дедлайн у Автоматизація рендеру?`. No retry and no additional Session were used. Input composition is `uncached input + cache creation + cache read`.

| Metric | Control: full surface | Variant: Calendar disabled | Control − variant |
|---|---:|---:|---:|
| Model iterations | 3 | 3 | 0 |
| First-pass uncached input | 2 | 217 | — |
| First-pass cache creation | 30,407 | 21,657 | — |
| First-pass cache read | 0 | 0 | — |
| **First-pass input composition** | **30,409** | **21,874** | **8,535 (28.07%)** |
| Total uncached input | 6 | 221 | — |
| Total cache creation (5m) | 32,176 | 23,573 | — |
| Total cache read | 61,687 | 44,378 | — |
| Output tokens | 394 | 289 | — |
| **Total input composition** | **93,869** | **68,172** | **25,697 (27.38%)** |
| List cost | $0.10 | $0.07 | $0.03 |
| Trello MCP calls / results | 2 / 2 | 2 / 2 | 0 / 0 |
| Observed Skill-file reads | 0 | 0 | — |
| Observed Memory-file reads | 0 | 0 | — |
| Observed Calendar MCP calls | 0 | 0 | — |

`list_cost.amount` returned by the API was `"10"` and `"7"` USD minor units respectively, hence $0.10 and $0.07. Exact total test spend was **$0.17** list cost.

### Behavioral equivalence

**Measured.** Both traces used the required factual-read sequence: `trelloSearch` discovery, followed by authoritative `trelloReadCard` for the same matching card. Both reported the verified due timestamp `2026-09-18T17:00:00.000Z` correctly as 18 September 2026, 20:00 Kyiv time. Neither invoked Calendar, wrote Trello, read a Skill/Memory file, retried, or changed product behavior beyond the intended variant-local Calendar availability.

### Interpretation and recommendation

**Measured:** with the same Agent snapshot, resources, prompt, three model iterations, and Trello call sequence, Calendar exclusion reduced the first model-request input composition by **8,535 tokens (28.07%)** and total-turn composition by **25,697 tokens (27.38%)**. It also reduced this sample's list cost by $0.03.

**Cache caveat:** neither first pass used a cache read; its difference is principally 8,750 fewer cache-creation tokens, partly offset by 215 more uncached tokens in the variant. Later cache-read totals also differ (`61,687` vs `44,378`). This is strong A/B evidence for the rendered session surface, but it does **not** apportion the savings exactly to raw Calendar schemas or prove that every future cache state will save the same dollar amount.

**Recommendation:** set the Google Calendar MCP toolset to `enabled:false` in the production Agent configuration until Wave E, subject to Product Owner approval. This is the highest-confidence safe optimization measured so far: Calendar is explicitly later-scope, the current factual Trello path retained quality and correctness, and the observed first-pass saving is material. Do not alter Trello, Memory, Skills, built-ins, or verify-after-write safeguards. The next optimization step is to review/accept this one measured configuration change; do not run another A/B in this issue without new authorization.

## 22. Production rollout: Calendar toolset disabled until Wave E (2026-09-16)

### Production configuration change

**Measured.** After Product Owner acceptance of §21, the production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` was retrieved at version 11, then updated with the official `client.beta.agents.update()` API and concurrency guard `version: 11`.

The API request used a full copy of the retrieved `tools` array. Its sole change was:

```text
google-calendar-calendarmcp.default_config.enabled: true → false
```

`mcp_servers` was deliberately omitted from the update, preserving the attached Google Calendar server and its credential/vault path for Wave E. No individual Calendar permission policy was changed. Model (`claude-sonnet-5`, low effort, standard speed), system prompt, Skills, Trello toolset/configs, built-ins, and the session-level Environment/Vault/Memory behavior were not changed.

### Read-back verification

**Measured.** The API response and a subsequent Agent GET both returned version **12**. They confirmed:

- Google Calendar MCP server is still configured;
- `google-calendar-calendarmcp` toolset is `enabled:false` with no per-tool override that re-enables it;
- Trello toolset and all six explicit write-tool configs are unchanged;
- built-in toolset is unchanged;
- model, system, Skills, and MCP-server hashes are unchanged from v11.

### Production smoke evidence

One fresh production-like Managed Session (`sesn_017bbLCcm6H5C9pNupUZyDFo`) was created through the existing thin client with the normal Environment, Vault, and read/write Djonik Memory attachment. Exactly two prompts were sent; no Calendar prompt, Calendar call, Trello mutation, or retry occurred.

| Smoke prompt | First-pass composition | Turn composition | Iterations | Tools/results | Result |
|---|---:|---:|---:|---|---|
| `Який дедлайн у Автоматизація рендеру?` | 21,659 (`2` input + `21,657` cache creation + `0` cache read) | 67,601 (`6` + `23,407` + `44,188`) | 3 | `trelloSearch → trelloReadCard`; 2 / 2 | Correctly reported 18 Sep 2026, 20:00 Kyiv. |
| `Що мені сьогодні варто зробити?` | 23,514 (`2` + `105` + `23,407`) | 85,599 delta (`6` + `13,387` + `72,206`) | 3 | `trelloReadCard`, `trelloReadBoard`; 2 / 2; one built-in `read` | Fresh Trello-grounded daily priorities, deadlines, waiting-state risks, and explicit deferrals. |

The second prompt is a continued-session smoke, so its cache reads and turn composition include prior conversational context; it is validation evidence, not a new isolated baseline. The Session's final cumulative usage was `12` uncached input, `36,794` cache-creation input, `116,394` cache-read input, and `1,843` output tokens. API `list_cost` was $0.07 after the first prompt and $0.13 cumulative after the second, so exact smoke spend was **$0.13**.

### Decision

Calendar remains attached but unavailable to Claude in production until Wave E. Current factual Trello and daily-planning behavior remained intact, including the required authoritative direct-card read for an exact due-date claim. No further optimization experiment was run.

## 23. Attempted five-Trello-write exclusion A/B — invalid baseline; production state already excluded them (2026-09-16)

### Test method and pre-inference verification

This bounded follow-up used exactly two genuinely fresh official Managed Sessions, pinned to production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` version 12: control `sesn_01HwHg9avomV3BWe6ZrBsgfN` and variant `sesn_012BZYm4CT9nKf4q6H5SHcmi`. Before inference, API retrieval confirmed each was `idle`, had zero events, zero input/cache/output usage, and `$0.00` list cost. They had the same Agent ID/version, model (`claude-sonnet-5`, low effort, standard speed), system, Skills, environment, vault, Memory attachment/instructions, MCP servers, and resolved tool array.

For the variant, the complete retrieved `agent.tools` array was submitted to the official `client.beta.sessions.update()` API. Only the five named configurations were assigned `enabled:false`: `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, and `trelloWritePlanner`. The mandatory API read-back passed: all five were `enabled:false`; `trelloWriteCard` and all required Trello reads were unchanged; Calendar stayed excluded; and built-ins, Agent identity/version, system, model, Skills, Memory, environment, vault, and MCP servers were unchanged.

### Critical baseline discrepancy

The final read-only production-Agent retrieval showed that version 12 already had the same five writes at `enabled:false` (each with `Always allow` policy), while `trelloWriteCard` was `enabled:true`. Google Calendar was still attached but excluded. This contradicts the requested premise that the five writes were merely execution-blocked / `Always deny` and not confirmed `enabled:false`.

Accordingly, the unchanged control already excluded the five tools, and the session-local variant made no effective surface change. This is **not a valid control-versus-enabled A/B** and cannot measure the token/cost overhead of removing those tools. No production-Agent mutation was issued in this work.

### One-prompt-per-session telemetry

After successful read-back, each Session received exactly one identical prompt and no retry:

`Який дедлайн у Автоматизація рендеру?`

| Metric | Control | Variant | Control − variant |
|---|---:|---:|---:|
| Model iterations | 5 | 4 | 1 |
| First-pass uncached input | 2 | 2 | 0 |
| First-pass cache creation | 21,657 | 0 | 21,657 |
| First-pass cache read | 0 | 21,657 | -21,657 |
| **First-pass input composition** | **21,659** | **21,659** | **0 (0.00%)** |
| Total uncached input | 10 | 8 | — |
| Total cache creation | 26,278 | 2,160 | — |
| Total cache read | 97,197 | 89,551 | — |
| **Total input composition** | **123,485** | **91,719** | **31,766 (25.72%)** |
| Output tokens | 432 | 496 | — |
| List cost | $0.09 | $0.03 | $0.06 |
| Trello MCP calls / results | 3 / 3 | 3 / 3 | 0 / 0 |
| Calendar calls | 0 | 0 | 0 |
| Observed built-in `read` calls | 1 | 0 | — |

The first model-pass composition was identical, as expected for two sessions with the same already-excluded surface. The total-turn difference is not an eligible tool-surface saving: the control made a fifth internal model request and one extra built-in read, while cache creation/read placement also differed. It must not be attributed to the five Trello tool configurations or used as a dollar-savings estimate.

### Behavioral evidence and cache caveat

Both sessions made the same Trello factual path plus one member lookup: `trelloSearch → trelloReadCard → trelloReadMember`; neither mutated Trello, invoked Calendar, read a Skill file, or retried. Both reported the same verified deadline: 18 September 2026, 20:00 Kyiv. The wording contained different incidental card metadata, but the factual due-date claim was equivalent. There is no observed user-facing regression in this one-turn check, but the internal iteration count was not identical.

The control's first request created a 21,657-token cache prefix whereas the variant's first request read that same-sized prefix from cache. Cache counters and the extra control iteration explain why list cost differs even though first-pass composition does not. This invalid baseline cannot establish an independent cost effect for the five writes.

### Exact spend, decision, and next step

The two permitted prompts consumed exactly **$0.12** public list cost in total ($0.09 control + $0.03 variant). Production Agent v12 remained unchanged by this task; final API read-back confirmed its five named writes were already `enabled:false`, `trelloWriteCard` remained enabled, and Calendar remained excluded.

No further production change is recommended from this attempt: the intended configuration is already present, and no enabled-versus-disabled comparison was run. The next optimization step is operational reconciliation: establish when/why production v12 received these five `enabled:false` settings and correct the audit baseline/history before considering any new authorized experiment. Do not re-enable the writes merely to manufacture a cost comparison, and do not change Memory, Skills, built-ins, direct Trello reads, or verify-after-write safeguards.

## 24. Three unused Trello-read exclusion A/B (2026-09-16)

### Corrected historical baseline

Section 17's original Console inspection reported permissions only and could not prove per-tool `enabled` state. The later official Agent API read-back in §23 established the current truth: production v12 already has the five unsupported Trello writes at `enabled:false`. They were not part of this experiment and no further saving remains to obtain from them. This section tests only the three reads that inherit the Trello toolset's current default `enabled:true` state: `trelloReadChecklist`, `trelloReadInbox`, and `trelloReadPlanner`.

### Method and pre-inference configuration verification

Exactly two genuinely fresh official Managed Sessions were created against production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` version 12: control `sesn_01KscJavtkmo3qVZ5Ginye4z` and variant `sesn_014QTkvgExSmd1RZYtSVe2e4`. Before inference, both were `idle`, had empty event lists, zero input/cache/output usage, and `$0.00` list cost.

Both resolved snapshots had the same Agent/version, `claude-sonnet-5` / low effort / standard speed model, system, Skills, environment, vault, Memory attachment/instructions, MCP servers, built-ins, and complete tool array. Google Calendar remained attached with toolset default `enabled:false`; the five unsupported Trello writes remained explicit `enabled:false`; `trelloWriteCard` stayed explicit `enabled:true`; and all required Trello reads retained their inherited enabled state.

The control was left unchanged. The variant used the official idle-session `client.beta.sessions.update()` full replacement of the retrieved `agent.tools` array, adding only three Trello per-tool overrides: `trelloReadChecklist.enabled:false`, `trelloReadInbox.enabled:false`, and `trelloReadPlanner.enabled:false`. Mandatory API read-back confirmed those were the only tool differences. Required reads (`trelloSearch`, `trelloReadCard`, `trelloReadBoard`, `trelloReadList`, `trelloReadMember`, and `trelloReadWorkspace`), `trelloWriteCard`, the five disabled writes, Calendar, built-ins, model, system, Skills, Memory, environment, vault, and MCP servers were unchanged.

Each session then received exactly one prompt, with no retry:

`Що мені сьогодні варто зробити?`

### Telemetry

Input composition is `uncached input + cache creation + cache read`.

| Metric | Control: production v12 | Variant: three reads disabled | Control − variant |
|---|---:|---:|---:|
| Model iterations | 5 | 5 | 0 |
| First-pass uncached input | 2 | 167 | — |
| First-pass cache creation | 21,653 | 19,357 | — |
| First-pass cache read | 0 | 0 | 0 |
| **First-pass input composition** | **21,655** | **19,524** | **2,131 (9.84%)** |
| Total uncached input | 10 | 175 | — |
| Total cache creation | 36,853 | 34,729 | — |
| Total cache read | 96,363 | 86,227 | — |
| **Total input composition** | **133,226** | **121,131** | **12,095 (9.08%)** |
| Output tokens | 1,895 | 1,885 | — |
| List cost | $0.13 | $0.12 | $0.01 |
| Trello MCP calls / results | 3 / 3 | 3 / 3 | 0 / 0 |
| Calendar calls | 0 | 0 | 0 |
| Skill reads | 1 (`daily-planning`) | 1 (`daily-planning`) | 0 |
| Memory reads | 3 (`preferences.md`, `seqthera.md`, `trello-conventions.md`) | 3 (the same files) | 0 |

Control calls were `trelloReadMember → trelloSearch → trelloReadCard`; variant calls were `trelloReadMember → trelloReadBoard → trelloReadCard`. The variant did not attempt any of its three disabled reads. Neither turn mutated Trello or invoked Calendar.

### Cache caveat and behavioral comparison

Both first passes had zero cache reads, so the primary 2,131-token / 9.84% difference is a real rendered-first-pass difference for this one controlled pair, chiefly 2,296 fewer cache-creation tokens in the variant partly offset by 165 more uncached tokens. Later cache-read totals differ by 10,136 tokens and must not be treated as a fixed dollar saving. The $0.01 list-cost difference is likewise only this sample, not a general cost forecast.

Both answers used the daily-planning Skill, fresh Trello facts, Extract-first prioritization, explicit waiting-state handling for `Зробити Google Slides` and `Діадіа`, and no false success/mutation claim. The answers were not fully behaviorally identical, however: control promoted `Мудборд` and `СТРУМ лінії` as work to advance before their 17 September deadlines, while variant correctly preserved those deadlines but deferred them outside today's plan. This can be normal model/tool-path variation, but this one-prompt budget cannot distinguish that from a meaningful planning-quality regression.

### Exact spend, production decision, and next step

Exact public list-cost spend was **$0.25** ($0.13 control + $0.12 variant). A final read-only production-Agent retrieval confirmed Agent v12 remained unchanged: Calendar default is still `enabled:false`, the five unsupported writes remain `enabled:false`, `trelloWriteCard` remains `enabled:true`, and the three tested reads remain inherited-enabled in production.

The measured first-pass reduction is material, but production disabling of these three reads is **not recommended yet**: daily-planning recommendation coverage differed, so behavioral equivalence was not established within the authorized one-prompt A/B. Do not run a Memory optimization experiment. The recommended next optimization target remains per-visible-turn/source observability and a Product-Owner-approved capability regression matrix for any future tool-surface decision; it should establish planning equivalence before another production tool change.

## 25. Planning regression matrix and per-turn observability (2026-09-16)

### Why §24 is inconclusive for a production tool change

The three-read variant reduced first-pass input composition by 9.84% and total composition by 9.08%, but the daily plans were not equivalent enough to treat that as a safe production optimization. Both preserved factual due/waiting state, but control promoted two next-day deadlines while variant deferred them. With one prompt per session, the audit cannot tell whether this arose from normal planning variation or a capability regression. Token savings alone are therefore insufficient evidence.

### Canonical planning regression matrix

The matrix evaluates live facts and recommendation buckets, never exact prose. Before each future scenario pair, record the relevant fresh Trello card snapshot and the current date/time; use that evidence as the comparison source. A card is **high priority** when the snapshot shows a due-today/overdue deadline, a near deadline that requires action today, active in-progress work, or an explicit durable/current priority that the plan relies on.

| ID | Prompt / setup | Factual acceptance fields |
|---|---|---|
| A — today planning | `Що мені сьогодні варто зробити?` | Relevant open cards are discovered; due dates and waiting states are preserved; every high-priority card is either a today candidate or explicitly deferred with a reason; future/no-due work is not silently promoted above urgent work; no mutation; exact due/status claims use an authoritative direct read rather than search alone. |
| B — urgency | `Що зараз горить?` | Overdue/due-today/near-deadline cards are discovered and called out; waiting cards remain waiting rather than actionable; future cards and undated backlog do not displace urgent work; all stated deadlines are direct-read-backed; no false due claim or mutation. |
| C — active-project planning | `Що по Extract на цей тиждень?` (replace `Extract` only if it is no longer an active multi-card project) | Cards are scoped to the named project; in-progress, hard-deadline, waiting, future, and undated cards are classified; the plan distinguishes current-week candidates from later/deferred work; no cross-project card is presented as project work; factual fields are direct-read-backed where exact; no mutation. |
| D — mixed status/deadline fixture | Use a fresh live set containing at least one due today/soon card, one waiting card, one future-due card, and one undated open card; ask `Що мені сьогодні варто зробити?` | All four fixture cards are accounted for: urgent is today/explicitly deferred with cause, waiting is non-actionable, future is next/future, undated is backlog/deferred unless another priority justifies it. Due dates and states remain accurate; no high-priority card is missing; no mutation; exact field claims have authoritative direct-read evidence. |

The matrix derives from `daily-planning`, `weekly-planning`, and `task-management`: planning is grounded in fresh Trello, deadlines/in-progress/waiting states are distinct evidence, capacity deferrals are named, and search alone cannot establish a precise card field.

### Behavioral-equivalence rubric

For every card in the union of the control and variant card sets, compare this structured row:

| Field | Required comparison |
|---|---|
| Presence | Present in both; if absent in one, determine whether it was a high-priority or required fixture card. |
| Due | Same date/time or both correctly omit a due claim; any exact claim must match authoritative evidence. |
| State | Same live state classification, especially waiting/blocked versus actionable. |
| Priority bucket | `today`, `next/future`, `deferred`, or `waiting/non-actionable`; record the stated cause of any change. |
| Recommendation | Identify whether the practical instruction materially differs, not merely its wording or order. |

Classify each difference as one of:

- **Wording-only:** same cards, facts, bucket, and practical recommendation.
- **Acceptable planning variation:** facts/state remain correct; a non-urgent card moves between today and deferred with a coherent capacity/priority reason; no urgent/required card is displaced.
- **Material regression:** an urgent card is missing; a due date is wrong; a waiting card is treated as actionable; a future task outranks urgent work without grounded reason; project scope is mixed up; an exact field claim relies on stale/search-only data; or a planning turn mutates Trello.

A future surface A/B is eligible for production recommendation only when every required fixture/high-priority row is present and factually equivalent, and there are no material regressions. A wording-only or acceptable-variation label must include the factual row evidence that supports it.

### Current observability gap and minimal design

Before this follow-up, the thin client could emit optional raw MCP trace events, but it did not produce one safe record for a visible turn. The existing Managed Session stream already supplies model-request completion spans, MCP tool-use/result events, built-in `read` events, and cumulative `session.usage` snapshots. The client cannot identify a Console-originated turn because Console does not invoke this adapter; that source remains unknown outside the caller. It also cannot safely infer a source for an arbitrary API caller.

The smallest supported implementation is now in `src/djonikClient.ts`:

- `createTurnTelemetryCollector()` aggregates only event metadata for one visible turn: supplied source, session ID, model iterations, MCP tool count/names/results, verification-nudge count, Skill/Memory-read booleans, and the latest cumulative input/cache/output/list-cost values when a `session.usage` event is present.
- It does not retain or log user/assistant text, Memory contents, MCP inputs, MCP result payloads, secrets, or full file paths.
- `DJONIK_TURN_TELEMETRY=1` prints one concise `[turn]` JSON summary to stderr after each turn. `telegramCli.ts` labels it `telegram`; `cli.ts` labels it `diagnostic`; callers that do not provide a source remain `unknown`.
- The feature is opt-in and observational only. It does not add an API retrieval, transcript store, custom Messages loop, or any branch that can affect reasoning, tools, replies, or verification.

The API exposes token/list-cost data through `session.usage` events when emitted. If a particular runtime omits such an event, the summary reports `usage: null` rather than inventing values. The smallest supported enrichment path, if later required, is a single `client.beta.sessions.retrieve(sessionId)` after the turn completes; do not add it until the stream gap is measured because it is an extra API call and remains cumulative-session—not per-turn—usage.

### Implementation and checks

Implemented the opt-in telemetry collector plus one focused aggregation test. Existing PM-behavior and verification tests were not changed.

- `npm run typecheck` — passed.
- `npm test` — passed: 33 tests, 33 passed, 0 failed.
- `git diff --check` — passed.

### Recommended exact next A/B protocol

Do not run this protocol without fresh Product Owner authorization because the full four-scenario matrix requires more than the previously authorized one-prompt pair.

1. Freeze the candidate session-local tool delta and retrieve/read back the full control and variant configurations while idle.
2. For each matrix scenario, capture the fresh authoritative Trello fixture snapshot immediately before the paired prompts; use the same prompt and current time basis in both sessions.
3. Enable `DJONIK_TURN_TELEMETRY=1` for the diagnostic caller to retain content-free execution metadata, and preserve controlled answer text only in the bounded audit evidence needed for the rubric.
4. Compare every union-card row using the rubric, separately from token/cache metrics. Treat any material regression as a failed A/B regardless of savings.
5. Recommend production `enabled:false` only when first-pass reduction is material, all required behavior passes, and the read-back proves no unrelated configuration changed.

No Agent, Skill, Memory, MCP, or production configuration changed in this follow-up. Production Agent v12 remains unchanged.

## 26. Final behavioral regression gate for three unused Trello reads (2026-09-16)

### Configuration and budget

This gate used exactly two fresh Managed Sessions pinned to production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` version 12: control `sesn_01UQKa54D3ea1kZjzGrMRzRH` and variant `sesn_01RcbePbUQjGExypTUubJeSu`. Before inference, both were idle/empty/zero-usage and had identical Agent version, system, model (`claude-sonnet-5`, low effort, standard speed), Skills, Memory attachment/instructions, Environment, Vault, MCP servers, Calendar exclusion, built-ins, and Trello tool surface.

The variant's official session-local full `tools` replacement added only `enabled:false` overrides for `trelloReadChecklist`, `trelloReadInbox`, and `trelloReadPlanner`. Read-back confirmed required reads, `trelloWriteCard`, and the five already-disabled unsupported writes were unchanged. The final production-Agent GET remained version 12: Calendar default `enabled:false`; the five writes `enabled:false`; `trelloWriteCard` `enabled:true`; and the three candidate reads still inherited the production Trello default `enabled:true` state.

`DJONIK_TURN_TELEMETRY=1` was enabled. Eight prompts completed (A–D in each Session), no Trello mutation occurred, no Calendar call occurred, no verification nudge occurred, and the candidate disabled reads were never invoked by the variant. Exact total public list-cost spend was **$0.40** ($0.22 control + $0.18 variant), below the $0.80 stop ceiling.

### Execution-order limitation

Each Session executed the four prompts in A → B → C → D order. However, a diagnostic wait implementation treated a prior `session.status_idle` event as completion of a newly submitted turn, so A–C were accepted before the intended pair barrier had observed the counterpart's new terminal idle event. This did not create extra prompts, sessions, or writes, but it means A–C are not cleanly serialized control/variant pairs for causal token comparison. D used a corrected per-user-event boundary. This limitation alone prevents using the gate as stronger token evidence than §24.

### Scenarios and telemetry

The natural mixed fixture for D existed: Google Slides and Діадіа were waiting with due-today deadlines; Мудборд/СТРУМ лінії had next-day deadlines; and multiple open undated cards existed. Input composition is `input + cache creation + cache read`; usage is calculated from per-model-request spans. List cost is cumulative-session API evidence; the API omitted a control-B usage snapshot, so no invented per-turn amount is reported.

| Scenario | Control telemetry | Variant telemetry | First-pass composition (C / V) | Turn composition (C / V) | Cumulative/incremental list cost evidence |
|---|---|---|---:|---:|---|
| A — today | 6 iterations; `trelloReadMember → trelloReadCard → trelloSearch → trelloReadCard`; 4/4 MCP calls/results; Skill+Memory yes | 6 iterations; `trelloReadMember → trelloSearch → trelloReadCard`; 3/3; Skill+Memory yes | 21,655 / 19,524 | 159,301 / 144,356 | $0.14 / $0.13 |
| B — urgency | 1 iteration; no MCP; no Skill/Memory read | 1 iteration; no MCP; no Skill/Memory read | 38,089 / 36,256 | 38,089 / 36,256 | Control B+C combined +$0.03; variant +$0.02 |
| C — Extract week | 1 iteration; no MCP; no Skill/Memory read | 1 iteration; no MCP; no Skill/Memory read | 38,580 / 36,884 | 38,580 / 36,884 | Control split unavailable; variant +$0.01 |
| D — mixed status/deadline | 2 iterations; `trelloReadCard`; 1/1; no Skill/Memory read | 1 iteration; no MCP; no Skill/Memory read | 39,190 / 37,422 | 89,351 / 37,422 | +$0.05 / +$0.02 |

All turns had zero Calendar calls and zero verification nudges. The variant did not attempt `trelloReadChecklist`, `trelloReadInbox`, or `trelloReadPlanner`.

### Behavioral-equivalence comparison

| Scenario / union cards | Presence, due, state, project scope, and bucket comparison | Classification |
|---|---|---|
| A — Автоматизація рендеру; Рендер відео білих ароматів; Брендбук | Both preserve Extract scope, in-progress/backlog state, the 18 Sep deadline where claimed, and today priority. | Wording-only |
| A — Мудборд; СТРУМ лінії | Both preserve next-day deadlines. Control promotes both; variant promotes Мудборд and defers СТРУМ. Neither silently loses the near-term cards. | Acceptable planning variation |
| A — Google Slides; Діадіа | Both preserve Cossack Labs/A1 scope, due-today status, and Waiting/non-actionable classification. | Wording-only |
| A — Міні-парфуми адаптація; Документи; Футболка | Both leave undated open work out of today's priority set. | Wording-only |
| B — Google Slides; Діадіа; Мудборд; СТРУМ лінії | Both flag the two due-today waiting cards and retain next-day urgency context; variant is more expansive about the near-term cards. Both make exact current-field claims without a fresh direct read in B. | **Material regression (shared baseline)** |
| C — Extract open cards (Автоматизація рендеру, Рендер відео білих ароматів, Брендбук, Міні-парфуми адаптація) and completed cards | Both preserve Extract scope, list states, due/undated distinctions, and weekly priority. Both make exact field/status claims without a fresh direct read in C. | **Material regression (shared baseline)** |
| D — Google Slides; Діадіа; Автоматизація рендеру; Рендер відео білих ароматів; Мудборд; Брендбук; СТРУМ лінії; undated backlog | Both preserve the practical buckets: due-today Waiting requires a blocker follow-up, active Extract work remains today, Мудборд is near-term, and undated backlog is deferred. Variant made these exact state/due claims with **zero** Trello calls; control made one direct-card read, insufficient to prove every stated field fresh. | **Material regression (variant; and direct-read coverage incomplete in control)** |

The material classifications follow the §25 rubric and current Skills: a planning turn must refresh live Trello state, and an exact due/status claim cannot rely on a prior turn's context or search-only evidence. The fact that B/C's defect appears in control as well does not make it acceptable; it shows a shared baseline-quality issue rather than a proven effect of the three-read variant.

### Token/cost interpretation and decision

First-pass direction remained lower in the variant in every scenario: A 9.84%, B 4.81%, C 4.40%, D 4.51%. The unweighted aggregate first-pass composition was 137,514 control versus 130,086 variant (5.40% lower). This is only directional evidence: later turns reuse different cached/session context, A–C were not pair-serialized correctly, and D has different model-iteration/tool paths. The aggregate whole-turn composition (325,321 control / 254,918 variant) is correspondingly not a production-saving forecast.

**Quality conclusion:** the final gate has material regressions. **Production recommendation: do not set these three reads to `enabled:false`. Stop further cost optimization of `trelloReadChecklist`, `trelloReadInbox`, and `trelloReadPlanner` under Issue #16.** The first follow-up before any new tool-surface proposal must investigate the shared fresh-read planning gap without altering the accepted production surface. Do not start a Memory optimization experiment.

Production Agent v12 remained unchanged throughout this gate; no Agent update, Skill change, Memory change, MCP change, Calendar action, or Trello mutation occurred.

## 27. Development / validation spend guardrail (Issue #21)

> **Process/documentation only.** This section adds no runtime enforcement code, billing API, database, dashboard, scheduled usage polling, or Agent/Skill/Memory/MCP/session-lifecycle change. It generalizes the ad hoc ceilings already used informally in §16 ($0.18 bounded-test spend), §21 ($0.17), §23 ($0.12), §24 ($0.25), and §26 (an explicit "$0.80 stop ceiling," reached at $0.40) into one reusable rule for future work.

### Scope

This guardrail applies to:

- Managed Agent token/cost audits (work of the kind done under #16);
- paid Console/CLI A/B experiments comparing Agent/session configurations;
- any other bounded validation run that intentionally generates additional Managed Agent traffic beyond real product usage.

It does **not** need to apply mechanically to:

- ordinary real Telegram production usage;
- passive telemetry collection from natural usage (e.g. the `#19` per-turn telemetry, or the `#20` session-growth observation, which only reads telemetry already produced by real traffic);
- local unit tests, typecheck, or other checks that make no Managed Agent API call;
- static code inspection;
- documentation-only work;
- already-occurring user traffic that is merely being observed rather than deliberately generated for the validation.

### Required declaration before execution

Before running any paid Managed Agent audit or A/B validation follow-up in scope above, the bounded issue or its working plan must declare, in writing, before the first Session is created or the first prompt is sent:

1. **Maximum dollar spend** for the follow-up (Console public list cost).
2. **Maximum number of paid Managed Sessions** the follow-up will create.
3. **What evidence is expected** from those sessions — the specific measurement or comparison the spend is meant to produce, stated concretely enough that "we already have that evidence" or "this run added nothing new" can be judged afterward.
4. **Explicit stop condition** — which of the stop rules below (or a stricter one) ends the run.
5. **Whether further spend beyond the declared ceiling requires Product Owner approval** — for any follow-up using the default ceiling below, the answer is always yes.

### Default guardrail

Unless the canonical evidence already collected for the specific follow-up strongly suggests a different value, and that different value is declared upfront per the previous section, use:

- **Default bounded follow-up spend ceiling: $0.50** (Console public list cost).
- **Default maximum paid Managed Sessions: 5.**

These are defaults for an ordinary bounded follow-up, not absolute universal limits. A bounded issue may declare a different ceiling or session count when the declaration above justifies it (for example, a multi-scenario behavioral-equivalence gate like §26 needed a higher ceiling than a single-prompt A/B like §21) — but the different ceiling must be declared before starting, not discovered by exceeding the default.

### Stop rules

Validation work in scope must stop when **any** of the following happens, whichever comes first:

1. the declared dollar ceiling is reached;
2. the declared paid-session-count ceiling is reached;
3. the required evidence declared before starting is already sufficient;
4. repeated runs are no longer producing materially new evidence (diminishing returns — e.g. two consecutive scenario pairs would tell the same story as the ones already captured);
5. an unexpected high-cost session materially consumes the remaining declared budget (for example, one session alone burning most of a $0.50 ceiling), even if the raw dollar ceiling has not technically been crossed yet.

If the result is still inconclusive at the point a stop rule triggers, the correct recorded outcome is exactly:

`inconclusive — additional spend requires Product Owner approval`

Do not silently continue past a triggered stop rule, and do not quietly round up the declared ceiling to accommodate "one more" session.

### Cost accounting in audit reports

Where practical, future audit/validation reports should separate production/user traffic from deliberate validation/test traffic, using the source-correlated telemetry and reconciliation method introduced in `#19` (`src/reconcileTelemetry.ts`, `usageScope: "turn_delta"`, `source` labelling). Deliberate validation spend must be reported as part of the audit's own evidence (as every bounded follow-up in this document already does per-session), not folded silently into a general Console Usage total where it cannot be distinguished from real Telegram traffic.

### Rationale for the $0.50 / 5-session default

**Measured basis.** Every individual bounded follow-up actually run and accepted in this audit (§16, §21, §23, §24, §26) spent between $0.12 and $0.40 in Console public list cost, using between two and eight paid Sessions. The one follow-up that named an explicit ceiling in advance (§26) used **$0.80** and stayed within it at $0.40 actually spent, with two Sessions and eight total prompts.

**Why $0.50, not $0.80.** $0.80 was this audit's own ad hoc ceiling for its single largest, most evidence-dense follow-up (an eight-prompt, two-Session behavioral-equivalence gate across four planning scenarios) — the highest-cost bounded run actually observed here, not a typical one. Generalizing it as the default would set the routine ceiling at the historical maximum rather than the historical norm. $0.50 sits above every other individual follow-up's actual spend ($0.12–$0.40) while still leaving headroom below the one outlier case, so an ordinary single-comparison or few-scenario A/B fits comfortably inside it without the default being set so low that legitimate two/three-session comparisons routinely need an override.

**Why 5 sessions, not 2 or 8.** Most follow-ups here used exactly two Sessions (one control, one variant). The largest one (§26) used two Sessions but eight total prompts across four scenarios. Five paid Sessions covers a control/variant pair plus meaningful headroom for a slightly larger comparison (e.g. a three-way or re-run-after-a-fix case) without defaulting to a number large enough to make repeated, low-value re-runs cheap to justify. A follow-up genuinely needing more — like a multi-scenario behavioral gate — declares that need and a higher ceiling upfront, as §26 effectively did.

**Not a hard-coded restatement of one experiment.** The default is derived from the *range* of actual accepted spend across five independent follow-ups, not copied from any single one, and it remains explicitly overridable when a bounded issue declares a different, justified ceiling before starting.

### How this interacts with #19/#20

`#19`'s source-correlated telemetry and `#20`'s session-growth analysis both read telemetry that real Telegram production traffic already produced; neither deliberately generates new Managed Agent traffic to obtain evidence, so neither is itself subject to a spend ceiling under this guardrail's scope rule above. If a future `#19`/`#20`-style measurement ever needs to *generate* additional Managed Agent traffic beyond what real usage already produced (for example, deliberately running extra Console turns to fill a thin sample), that generation step becomes an in-scope bounded validation follow-up and must declare its own budget/session count under this guardrail before it starts.
