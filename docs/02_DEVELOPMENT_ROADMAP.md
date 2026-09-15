# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundations 1–3 are accepted. `Джонік` exists as the authoritative Claude Managed Agent, the repo has a thin TypeScript/Node Managed Agents client, and Telegram now works as a thin single-user channel adapter. Real two-turn continuity has been verified in Console, through the repo client, and through Telegram. Durable cross-session Claude-native memory is the current focus.

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

### NOW — Foundation 4: Durable Claude Memory Store across Djonik sessions (#4)

Goal:

`Djonik Managed Session + Claude Memory Store → durable fact written → new Managed Session → fact recalled`

Scope:

- create one real Claude Memory Store for Djonik;
- attach it as a `memory_store` session resource with `read_write` access whenever a new Djonik Managed Session is created;
- supply the Memory Store ID through local environment configuration;
- keep Telegram using the same shared memory-enabled session boundary;
- give the attachment concise instructions limiting memory to durable useful PM context;
- prove a durable fact is written in Session A and recalled from a distinct Session B;
- inspect the persisted memory in Claude Console/API/CLI;
- keep the memory architecture entirely Claude-native.

Explicitly out of scope:

- Trello/Google MCP enablement;
- Skills;
- custom memory extraction/classification pipelines;
- vector DB/custom RAG/Neon/database;
- multiple/per-project memory stores;
- production deployment;
- images/files/voice;
- subagents;
- proactive scheduler.

Acceptance evidence:

- `Djonik Memory` store exists;
- all new Djonik sessions attach it as read-write;
- Session A persists a durable memory;
- that memory is visible in the store;
- a distinct Session B recalls it without replaying Session A transcript;
- Telegram still works through the shared client boundary;
- typecheck/tests/`git diff --check` pass;
- no custom memory persistence is introduced.

### NEXT — Foundation 5: First Skill

Add `task-management` as the first custom Skill and validate progressive, task-relevant behavior without bloating the core system prompt.

### THEN — Foundation 6: Trello read surface

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
- do not turn adapter code into a phrase/intent router;
- keep Skills separate from mutable project data;
- keep external live state fresh through tools;
- verify mutations;
- prefer bounded vertical slices over broad scaffolding.

## Legacy repo

`danielkokr/djonik-manager` may be consulted for product lessons, test scenarios and failure modes.

Do not treat its architecture or open backlog as the roadmap for Djonik 2.0.