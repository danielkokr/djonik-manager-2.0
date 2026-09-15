# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundations 1–4 are accepted. `Джонік` exists as the authoritative Claude Managed Agent, Telegram works as a thin channel adapter, and `Djonik Memory` now provides durable Claude-native memory across distinct Managed Sessions. The current focus is the first modular PM competency implemented as a custom Claude Skill.

## Execution order

### DONE — Foundation 1: Real Djonik Managed Agent + first Console Session (#1)

Accepted 2026-09-15.

Verified foundation:

- real `Джонік` Managed Agent exists and is Active;
- model: `claude-sonnet-5`, Low effort;
- `Djonik Default` Cloud Environment exists;
- real Session references that agent + environment;
- second turn correctly used first-turn context;
- no local duplicate agent/session runtime is part of the accepted architecture.

### DONE — Foundation 2: Thin repo client for the existing Djonik Managed Agent (#2)

Accepted 2026-09-15 at commit `ca7c82401059853d6fa7485d7b24c205e48829d3`.

Verified foundation:

- minimal TypeScript/Node client uses the current Managed Agents SDK surface;
- repo references the existing `agent_id` + environment through local configuration;
- no Djonik system prompt or agent configuration is duplicated application-side;
- no custom transcript/history store exists;
- real two-turn local smoke test passed in one Managed Session;
- typecheck and focused tests passed;
- secrets remain outside Git.

### DONE — Foundation 3: Telegram adapter to the existing Djonik Managed Agent (#3)

Accepted 2026-09-15 at commit `43b976e16c52c8090b9e585c03141d3520e4e7a5`.

Verified foundation:

- Telegram adapter reuses the Foundation 2 Managed Agent client boundary;
- development access is protected by a single-user allowlist;
- first accepted Telegram text creates/connects one Managed Session;
- later messages in the same running process reuse that Session;
- real two-turn Telegram smoke passed (`5832` recalled correctly);
- typecheck passed;
- focused tests passed 14/14;
- no prompt duplication, custom transcript store, database, or PM intent router was introduced.

### DONE — Foundation 4: Durable Claude Memory Store across Djonik sessions (#4)

Accepted 2026-09-15 at commit `8617e691c0e791ce5efe6c80876383491f915ec0`.

Verified foundation:

- real `Djonik Memory` Claude Memory Store exists;
- all new Djonik Managed Sessions attach it as a `memory_store` resource with `read_write` access;
- Memory Store ID is supplied through local environment configuration;
- Session A persisted a durable preference;
- persisted memory was verified through the official Memory Store API;
- distinct Session B recalled that fact without transcript replay;
- Telegram remains on the same shared memory-enabled client boundary;
- typecheck passed;
- focused tests passed 16/16;
- no custom DB/vector/RAG memory layer was introduced.

### NOW — Foundation 5: First custom Skill — task-management (#5)

Goal:

`task-related request → Djonik discovers task-management Skill → applies bounded PM task rules`

Scope:

- author one compact custom `task-management` Skill;
- create/upload it to the Claude workspace and obtain its `skill_...` ID;
- attach it to the existing authoritative `Джонік` Managed Agent;
- preserve the existing agent model/system/tools and Memory/Telegram architecture;
- teach task interpretation, corrections/follow-ups, deadline handling, ambiguity handling, advice-vs-action separation, and verify-before-claim behavior;
- keep mutable project/client/live task state out of the Skill;
- validate that a real task-management turn actually loads/reads the Skill;
- validate task request, correction/follow-up, and advice-not-mutation scenarios;
- do not add Trello or any external task mutation yet.

Acceptance evidence:

- one real custom `task-management` Skill exists in the Claude workspace;
- the existing `Джонік` Managed Agent has it attached;
- a real Managed Session demonstrably loads/uses it for a relevant turn;
- the three bounded validation scenarios behave correctly;
- Djonik does not claim external task writes before task tools exist;
- repo retains only canonical Skill source/support needed for maintainability;
- no mutable/live project data is embedded in the Skill;
- typecheck/tests/`git diff --check` pass for repo changes.

### NEXT — Foundation 6: Trello read surface

Give Djonik bounded read-only task/project awareness.

Initial target:

- find/search cards;
- read task details;
- answer natural PM questions from fresh Trello state.

### THEN — Foundation 7: Trello write surface

Add the smallest safe mutation set:

- create task;
- update title/description/date;
- move task;
- complete/reopen.

Writes must be target-safe and verified before Djonik claims success.

### THEN — Conversational PM validation

Exercise realistic multi-turn scenarios:

- "створи задачу по Extract";
- "постав її на пʼятницю";
- "ні, краще на понеділок";
- "це не Extract, а Seqthera";
- "що зараз горить?".

Only after this experience is strong should the product expand significantly.

## Capability waves after the foundation

### Wave A — Planning and work context

- daily planning Skill;
- weekly planning Skill;
- workload/capacity reasoning;
- richer project/client memory;
- accepted plans and commitments where they are genuinely useful.

### Wave B — Studio intake

- screenshots/images;
- PDFs/files;
- grouped related Telegram messages;
- structured task/checklist generation;
- source-preserving context.

### Wave C — Project health and reviews

- project-health Skill;
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

### Wave F — Specialist agents if justified

Potential specialists:

- studio intake analyst;
- research/context agent;
- weekly review analyst.

Do not introduce them because multi-agent is available. Require measured value.

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