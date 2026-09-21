# Djonik 2.0 — Claude-Native Architecture

> **Canonical architecture document.** Prefer the smallest architecture that keeps product behavior inside Claude Managed Agents and other Claude-native primitives.

## Audit decision and current reliability boundary — 2026-09-21

[docs/17](17_DJONIK_V1_ARCHITECTURE_AUDIT.md) is the accepted evidence/decision record. Keep the architecture below; implement bounded reliability fixes through #31 (per-operation Trello verification), #32 (turn/result correlation and mixed-answer preservation) and #33 (pinned release plus serving-Session evidence). Those fixes are planned, not implemented here. Historical accepted examples do not establish protection for every event sequence.

Recorded Agent v21 is rollback-equivalent to accepted v19; PH specialist remains v4. This is not an attestation of an already-running Telegram Session. Its model/system/Skills are resolved at creation; an Agent update does not automatically change it. #33 will pin accepted Skill versions and verify the actual serving tuple at a completed-turn transition, without replaying external mutations.

#29 now simplifies current-state review and validates ownership in isolation after #31/#32. Haiku remains the coordinator; a bounded extension of the existing read-only Sonnet role is a candidate, not an accepted configuration. No new production specialist is authorized. Source text checks do not prove model behavior.

## 1. Target shape

```text
Claude Console / Managed Agents
   │
   └── Djonik Managed Agent
       ├── versioned agent configuration
       ├── system prompt / PM constitution
       ├── built-in tools
       ├── Skills
       ├── custom tools / MCP
       ├── measured specialist subagents when justified
       └── Sessions
            └── attached Memory Store(s)

                         ↑↓ official Anthropic SDK/API

Telegram → thin Djonik adapter → existing Djonik agent/session resources

External systems reached through bounded tools / MCP:
   ├── Trello
   ├── Google Calendar (later)
   └── other integrations only when justified
```

The **Managed Agent resource in Claude Console is the authoritative Djonik runtime**. The repository does not create a second local agent with a duplicate system prompt or a custom conversation engine.

## 2. Claude owns

Claude should own as much of the intelligent PM behavior as practical:

- natural-language interpretation;
- conversational continuity within Managed Agent Sessions;
- selecting relevant Skills;
- deciding which fresh tool data is needed;
- sequencing bounded tool calls;
- PM judgement and recommendations;
- deciding what durable context is worth remembering within the memory policy;
- composing the final natural-language response;
- specialist delegation where it provides a measured benefit.

## 3. Thin application owns

The application exists only for boundaries that cannot live usefully inside the Managed Agent resource itself:

- Telegram ingress/egress;
- mapping the Telegram user/chat to the correct Managed Agent Session strategy;
- secrets needed by the adapter or client-side custom tools;
- executing client-side custom tools when required;
- hard validation/idempotency for external mutations when the tool boundary requires it;
- bounded delivery/lifecycle integration for later native scheduled work;
- minimal operational logging and failure handling.

Do not put ordinary conversational intent routing into application code.

## 4. Agent configuration

Djonik is a reusable, versioned **Claude Managed Agent** created and managed through Claude Console / the Managed Agents API.

The Managed Agent configuration owns:

- name and model;
- Djonik system prompt / PM constitution;
- built-in tool permissions;
- attached Skills;
- custom tools / MCP servers;
- bounded subagents/advisors only after measured need and explicit acceptance.

The repository remains the reviewed product/architecture source and may contain source copies of Skills, tool adapters and configuration notes. It must not create a competing local Djonik identity.

## 5. Environments and Sessions

A Managed Agent Session is the primary conversational continuity primitive.

A session references the Djonik Managed Agent and an Environment and maintains conversation/tool history across multiple interactions.

Initial strategy:

- create Djonik once in Claude Console;
- create the smallest suitable Environment;
- validate a real multi-turn Session in Claude Console before writing integration code;
- later map the primary Telegram conversation to a long-lived Djonik Session strategy;
- do not invent a custom transcript store in v1;
- define rollover/recovery only after real session behavior demonstrates a need.

Session history is conversational context, not authority over fresh Trello/Calendar state.

## 6. Durable memory

Use Claude Memory Stores as the default long-term memory mechanism.

Memory Stores are attached to Sessions and may contain focused text documents for:

- user work preferences;
- client/project context;
- important decisions;
- recurring constraints/patterns;
- useful PM lessons;
- context that should survive session boundaries.

Memory must not become a stale mirror of live Trello task state.

Start with a small number of focused stores. Do not introduce Neon/vector DB/custom RAG in v1 unless a measured gap requires it.

## 7. Skills

Skills encode reusable PM expertise and workflows. Prefer Managed Agent Skills over expanding the core system prompt indefinitely.

Repository convention when Skills enter implementation:

```text
.claude/
  skills/
    task-management/
      SKILL.md
    daily-planning/
      SKILL.md
    weekly-planning/
      SKILL.md
    project-health/
      SKILL.md
    studio-intake/
      SKILL.md
```

Do not create every Skill immediately. Add each when its capability enters the roadmap.

Skills describe **how to work**. Mutable client/project facts belong in Memory Stores or fresh tools, not inside Skills.

## 8. Tools and MCP

Prefer bounded semantic tools instead of exposing broad low-level APIs.

Examples:

- `search_tasks`
- `get_task`
- `create_task`
- `update_task`
- `move_task`
- `complete_task`
- `reopen_task`

Later:

- checklist lifecycle;
- calendar reads/writes;
- reminder/proactive actions;
- file/source handling.

Rules:

- Claude chooses and sequences tools;
- application/tool code validates hard invariants where needed;
- writes are verified before success is reported;
- destructive or high-risk actions can require explicit confirmation/policy;
- raw database access and generic unrestricted HTTP are not default agent capabilities.

## 9. Subagents / multi-agent

Djonik remains one persistent primary collaborator. Multi-agent is **not** the default architecture and must not become a generic routing layer.

Issue #28 produced the first measured case where a specialist is justified. Repeated live Project Health validation on the Haiku production baseline showed recurring PM-judgement errors despite progressively simplified Skill guidance: unsupported Waiting interpretations, model-derived relative/weekday date wording, misuse of `lastActivityAt` as progress evidence, and overstated risk. A bounded Sonnet diagnostic using the same `project-health` Skill and live Trello data did not reproduce those dominant correctness failures in the observed A/B scenarios, although it still showed residual verbosity and one invented entity. The diagnostic also confirmed that missing same-turn fresh reads are **not** solved by a stronger model: the accepted #18 platform limitation appeared on both Haiku and Sonnet.

**Accepted production configuration (Wave C1):** the primary Djonik coordinator stays on the intentional Haiku baseline and delegates Project Health to one dedicated **Sonnet Project Health specialist subagent** (`agent_01KNiQDzzPjaMU6LLF4mU6uM`, pinned v4) through Claude Managed Agents' native multi-agent roster. A delegated live validation ("Scenario A", `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §42) confirmed native delegation, zero pre-result coordinator messages, exactly one specialist child result, byte-identical coordinator relay, and passing specialist factual/voice/shape grading against fresh Trello evidence. Production Djonik (`agent_01WGRHDBjQa3eMhoGJMmQ1dh`) was then cut over to v18 (§43): it now carries a single pinned roster entry for the specialist and no longer owns the `project-health` Skill directly — the specialist exclusively owns that pinned Skill. Native Managed Agents multi-agent roster is the production mechanism for Project Health; there is no Advisor and no application-level phrase/intent router. The accepted #18 same-turn fresh-read platform limitation is unchanged by this cutover. A real production smoke (§44) proved this topology and runtime (v18 resolved, native delegation, silent wait, fresh Trello, one child message, zero mutation) but failed the final specialist-shape and exact-relay acceptance; the specialist was therefore hardened to v4 (final-answer discipline only) and production was repinned to it as **v19** (§45), with the architecture unchanged. The final production-v19 smoke (§46) then proved the topology and specialist v4 itself pass (native delegation, silent wait, fresh Trello, compact factual specialist answer, one child message, zero mutation, end-turn) but that production Haiku's exact relay remains nondeterministic under prompt-only control: it rewrote a clean specialist answer (§46; §44 had dropped a paragraph; §42 happened to relay exactly). A **smallest deterministic reply-boundary safeguard** is therefore implemented in the thin Session client (`src/djonikClient.ts`, §47): after Claude has natively delegated and the canonical Project Health specialist has returned exactly one result, that exact string — not the coordinator's message — is what the caller receives. It does **not** route user intent (Claude still decides delegation natively; the code reads no user text), does not reason about Project Health or parse the specialist's prose, and acts only on official Session/event provenance (the resolved Session's one-child coordinator roster naming the canonical specialist plus the matching `session.thread_created` / `agent.thread_message_received` events); it falls back to coordinator output when provenance is missing or ambiguous (a bypass of exact-preservation protection, not a general fail-closed guarantee; see #32) and stays out of any turn that attempted a Trello write. At that point production Djonik was v19 (Haiku) and the specialist v4 (Sonnet), with the Agent/Skill/model/MCP configuration unchanged (production is now v21, a rollback-equivalent of v19; see "Work Review (Wave C2)" below). **The final live acceptance (§48) PASSED** through the real repository `connectToDjonik()` path on one fresh production-v19 Session: the create response itself carried the roster provenance, delegation was native to the canonical specialist v4, Trello evidence was fresh, the specialist's answer was factually correct, the exact specialist string was returned to the caller (`runtimeReturnedReply === specialistFinal`), and there were zero Trello/Calendar/Memory writes — so the deterministic reply-boundary safeguard is live-validated (in that sample Haiku happened to relay exactly, so its rewrite-substitution branch remains covered by unit tests rather than a live rewrite). It is still not an intent router: Claude decides delegation natively, and the safeguard only preserves the already-returned specialist result for the bounded read-only Project Health path. The temporary validation coordinator (`agent_01GFCLFYq6uLRHG8vMCrAgeK`, v5) was archived at closeout (§49) and is not part of production; there is no Advisor. Wave C1 implementation and live acceptance are complete; the accepted #18 same-turn fresh-read platform limitation is unchanged.

Rules for that specialist:

- Djonik/Haiku remains the primary user-facing coordinator unless a separate Product Owner decision changes the baseline.
- The Project Health specialist is a separately versioned Managed Agent with its own Sonnet model, focused system prompt, `project-health` Skill, and only the Trello read capabilities it actually needs.
- The specialist must have **no Trello mutation capability** and no Calendar capability for Project Health.
- Skills, MCP servers, tools, and context are not assumed to be shared automatically between coordinator and specialist; required capabilities must be configured explicitly on the specialist.
- Delegation must use the native Managed Agents multi-agent roster. Do not add an application-level phrase/intent router.
- For delegated Project Health turns, the coordinator must preserve the specialist's evidence-backed factual interpretation and must not recompute dates, waiting/blocked status, risk, or activity semantics on its own.
- Ownership of `project-health` has moved from the coordinator to the specialist (production v18, roster now pinning specialist v4 in production v19): the coordinator's `system` no longer references the Skill directly and instead carries the delegation transport contract; the specialist exclusively owns the pinned Skill.
- Do **not** add an Advisor for this C1 slice. Advisor is reserved for future consultative cases where the primary agent should remain the executor and only needs strategic guidance.
- Referenced specialist agents are versioned/pinned by the coordinator roster; updating the specialist requires an explicit coordinator roster update and review.
- Keep delegation one level deep. Do not create specialist-of-specialist chains.
- Treat Sonnet cost as a bounded escalation cost, not the default cost of ordinary Djonik turns. Validation and production telemetry must distinguish coordinator and specialist usage.
- The #18 same-turn fresh-read limitation remains a separate platform constraint. Do not represent subagent delegation as fixing it.

**Work Review (Wave C2, #29) — production attach failed acceptance and was rolled back.** Production Djonik is now **v21** (Haiku coordinator). v21 is **rollback-equivalent to the accepted v19** coordinator configuration: it differs from v19 only in `version`/`updated_at`, has exactly the four accepted coordinator Skills (`task-management`, `daily-planning`, `weekly-planning`, `studio-intake`) and no `project-health` Skill, and keeps the same system, model, Trello MCP, disabled Calendar and native roster → Project Health specialist **v4 / Sonnet**. The custom `work-review` Skill (`skill_01RMRGWbrjW9EHSieymZ2NDV`, `skver_01JCf5J73Sik966ZR31u6Rhr`, byte-identical to `.claude/skills/work-review/SKILL.md`) still exists in the workspace but is **not attached to production** and is **not an accepted production capability**. Slice 3 (attach as v20 plus bounded live acceptance, `docs/16` §26) **failed**: the Skill was read and fresh Trello was used, but Haiku fabricated completion ordering («остання замкнена») from `lastActivityAt`, rewrote a UTC timestamp as a local-looking date/time, and made counting errors; Project Health routing to specialist v4 worked, but the relay boundary was not revalidated because Turn 2 ended `budget_reached` (Session cost $0.32 against a $0.30 ceiling). Production was rolled back v20 → v21 (`docs/16` §27). A work review remains a **current-state retrospective only**: the Trello MCP still exposes no Activity & History primitive, and no history store, snapshot, webhook, router or new specialist was added. Project Health acceptance from #28 and the #18 same-turn fresh-read limitation are unchanged.

Future specialists may still be justified for research/context retrieval, studio intake analysis, or historical/weekly review, but each requires its own measured benefit before introduction.

## 10. Proactive work

Claude does not need a custom PM rules engine to be proactive.

After v1, prefer official [Scheduled Deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) before adding a custom scheduler. They support cron/timezone and bounded per-run resources/budgets; workspace availability must be checked. Timing may jitter by up to nine minutes, so do not promise exact-minute delivery.

A thin channel boundary should handle SEND/SILENT, delivery deduplication, snooze/resolution and ambiguous-send recovery. Scheduled execution bypasses the current connectToDjonik entry point, so reuse tested turn/write/reply finalization before delivering its output. This is deferred design, not an implemented scheduler or notification system. For example:

```text
schedule
  ↓
"Run the morning PM review"
  ↓
Djonik uses memory + skills + fresh tools
  ↓
Djonik decides whether something deserves a Telegram message
```

Scheduling is external timing. PM judgement remains in Claude.

## 11. Initial technology choices

- Claude Managed Agents as the authoritative runtime.
- Claude Console first for creating/configuring/testing the real Djonik agent.
- Official Anthropic SDK/API later for the thin Telegram/integration adapter.
- TypeScript / Node.js for that thin application layer unless a later constraint gives a reason to change.
- Claude-managed Sessions and Memory Stores first.
- No application database in the initial foundation.
- Secrets only through runtime secret management / local environment for integration code.

## 12. Architecture decision rule

Before adding a new component ask:

1. Can the Managed Agent configuration solve this?
2. Can a Session solve this?
3. Can a Memory Store solve this?
4. Can a Skill solve this?
5. Can a built-in/custom/MCP tool solve this?
6. Can a simple scheduler/adapter solve this?
7. Only then: is custom infrastructure actually necessary?

The burden of proof is on adding infrastructure, not on keeping Djonik Claude-native.