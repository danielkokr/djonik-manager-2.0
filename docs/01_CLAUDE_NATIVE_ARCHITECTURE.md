# Djonik 2.0 — Claude-Native Architecture

> **Canonical architecture document.** Prefer the smallest architecture that keeps product behavior inside Claude-native primitives.

## 1. Target shape

```text
Telegram
   ↓
thin Djonik app / adapter
   ↓
Claude Managed Agent / Agent SDK
   │
   ├── Agent configuration / system behavior
   ├── Session
   ├── Memory Store
   ├── Skills
   ├── built-in agent tools
   ├── bounded custom tools / MCP
   └── specialist agents only when justified
   │
   ↓
External systems
   ├── Trello
   ├── Google Calendar (later)
   └── other bounded integrations (later)
```

The app should not become a second reasoning/orchestration engine beside Claude.

## 2. Claude owns

Claude should own as much of the intelligent PM behavior as practical:

- natural-language interpretation;
- conversational continuity within sessions;
- selecting relevant Skills;
- deciding which fresh tool data is needed;
- sequencing bounded tool calls;
- PM judgement and recommendations;
- deciding what durable context is worth remembering within the memory policy;
- composing the final natural-language response;
- specialist delegation where it provides a measured benefit.

## 3. Thin application owns

The application exists for boundaries that should not be delegated to model inference:

- Telegram ingress/egress;
- mapping a Telegram user/chat to the correct Claude resources/session strategy;
- secrets and authentication;
- executing client-side custom tools when required;
- hard validation/idempotency for external mutations;
- scheduling/waking the agent for proactive work;
- minimal operational logging and failure handling.

Do not put ordinary conversational intent routing into application code.

## 4. Agent configuration

Djonik should be defined as a reusable, versioned Claude agent configuration.

The stable behavior derives from:

- the Djonik product contract / constitution;
- selected tools;
- selected MCP integrations;
- attached/custom Skills;
- memory resources;
- optional specialist agents later.

The repository is the source for reviewed product instructions and repo-backed Skills. Runtime deployment may create/version the corresponding Claude resources.

## 5. Sessions

A Claude Session is the primary conversational continuity primitive.

A session maintains the current conversation and tool interaction history across multiple user turns.

Initial strategy:

- one active Djonik session for the primary Telegram conversation;
- continue the same session while it remains healthy/useful;
- do not invent a custom transcript store in v1;
- define rollover/recovery only after real session behavior requires it.

Session history is conversational context, not authority over fresh Trello/Calendar state.

## 6. Durable memory

Use Claude Memory Stores as the default long-term memory mechanism.

Memory may contain focused text documents for:

- user work preferences;
- client/project context;
- important decisions;
- recurring constraints/patterns;
- useful PM lessons;
- context that should survive session boundaries.

Memory must not become a stale mirror of live Trello task state.

Start with a small number of focused stores. Do not introduce Neon/vector DB/custom RAG in v1 unless a measured gap requires it.

## 7. Skills

Skills encode reusable PM expertise and workflows.

Repository convention:

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

Skills describe **how to work**. Mutable client/project facts belong in memory or fresh tools, not inside Skills.

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
- application/tool code validates hard invariants;
- writes are verified before success is reported;
- destructive or high-risk actions can require explicit confirmation/policy;
- raw database access and generic unrestricted HTTP are not default agent capabilities.

## 9. Subagents / multi-agent

Do not start with a multi-agent architecture.

The main Djonik agent should handle ordinary PM conversation and tool use itself.

Introduce a specialist only when isolated context or parallel work clearly improves quality/cost/latency. Candidate later roles:

- research/context retrieval;
- studio intake analysis;
- weekly review / historical analysis.

## 10. Proactive work

Claude does not need a custom PM rules engine to be proactive.

A thin scheduler may wake/start a bounded agent turn, for example:

```text
schedule
  ↓
"Run the morning PM review"
  ↓
Djonik loads memory + skills + fresh tools
  ↓
Djonik decides whether something deserves a Telegram message
```

Scheduling is external timing. PM judgement remains in Claude.

## 11. Initial technology choices

- TypeScript / Node.js for the thin application layer.
- Official Anthropic SDK / current Claude Managed Agents APIs.
- Claude-managed session and memory primitives first.
- No application database in the initial foundation.
- Secrets only through environment/runtime secret management.
- Docker/deployment choice deferred until the local agent foundation works.

## 12. Architecture decision rule

Before adding a new component ask:

1. Can Agent configuration solve this?
2. Can Session solve this?
3. Can Memory solve this?
4. Can a Skill solve this?
5. Can a bounded built-in/custom/MCP tool solve this?
6. Can a simple scheduler/adapter solve this?
7. Only then: is custom infrastructure actually necessary?

The burden of proof is on adding infrastructure, not on keeping Djonik Claude-native.