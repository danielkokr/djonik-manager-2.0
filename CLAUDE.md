# Djonik 2.0

Djonik is Daniel's persistent conversational AI Project Manager for freelance and studio work.

## Product role

Djonik should behave like a competent PM / chief of staff rather than a command bot, CRUD wrapper or generic assistant.

Core loop:

`OBSERVE → ASSESS → PLAN → ACT → VERIFY → REMEMBER → FOLLOW UP`

Djonik should:

- understand natural conversation and follow-ups;
- maintain useful work context;
- help prioritize and plan realistically;
- identify risks, missing information and blocked work;
- operate external systems through bounded tools when available;
- verify external actions before claiming success;
- preserve durable information through Claude Memory when appropriate;
- stay concise and practical by default;
- respond in Ukrainian unless Daniel requests another language.

## Claude-native architecture

The authoritative Djonik runtime is a **Claude Managed Agent** created and managed in Claude Console / the Managed Agents API.

The repository is the reviewed product, architecture and integration source. It must not create a competing local Djonik identity or duplicate the Managed Agent system prompt inside application code unless a future explicit architecture decision requires it.

Prefer Claude-native primitives in this order:

1. Managed Agent configuration;
2. Session;
3. Memory Store;
4. Skill;
5. built-in/custom/MCP tool;
6. simple external scheduler/adapter;
7. custom infrastructure only when a measured gap remains.

Do not rebuild a custom Messages tool loop or custom conversation-history system.

## Source of truth

Before substantial work, read:

1. `docs/00_DJONIK_PRODUCT_CONTRACT.md`
2. `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`
3. `docs/02_DEVELOPMENT_ROADMAP.md`
4. `docs/03_TARGET_CAPABILITIES.md`
5. `AGENTS.md`
6. `docs/17_DJONIK_V1_ARCHITECTURE_AUDIT.md` (accepted decisions, evidence and handoff)
7. `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §27 (current validation policy)
8. the GitHub issue that roadmap marks as canonical NOW and its latest comments.

Distinguish proposed fixes, historical acceptance, current recorded Agent configuration and the actual serving Session. A fresh checkout with an older roadmap must obtain the governance documentation change before implementing new issues; issue numbering is not a substitute for canonical scope.

Canonical NOW comes only from `docs/02_DEVELOPMENT_ROADMAP.md`. Do not infer it from issue numbers, dates, another chat or memory.

## Implementation rules

- This is a greenfield rebuild; do not migrate runtime architecture from `danielkokr/djonik-manager`.
- The legacy repo may be consulted for product lessons, scenarios and failure modes.
- Use current official Anthropic/Claude documentation before implementing Managed Agents features; APIs may evolve.
- Keep application code thin.
- Do not introduce Neon, a vector DB, custom RAG or custom memory in the initial architecture.
- Do not create every Skill/subagent/tool in advance; add capabilities only when they enter canonical roadmap scope.
- Mutable live task state must come from fresh external tools, not stale memory.
- Skills encode reusable ways of working, not mutable client/project facts.
- External writes must be bounded, target-safe and verified before success is reported.
- High-risk/destructive actions may require deterministic safeguards even though conversational reasoning belongs to Claude.
- Do not commit secrets.
- Do not commit, push, deploy or close issues unless explicitly authorized by the Product Owner.

## Working model

Roles:

- Daniel — Product Owner / strategist;
- ChatGPT — Product Lead + technical reviewer;
- Claude Code / Codex — Implementation Engineer.

Default workflow:

`canonical bounded issue → implementation without commit/push/deploy → implementation report → review → Product Owner acceptance → manual commit/push → roadmap/issue synchronization`

When a task is complete, report:

- summary;
- files changed;
- architecture/API decisions;
- checks/tests and exact results;
- manual smoke evidence when required;
- limitations/deferred work;
- `git status --short`.