# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundation 1 is accepted. A real Claude Managed Agent named `Джонік` exists in Claude Console, `Djonik Default` Cloud Environment exists, and a real Managed Agent Session passed a two-turn continuity smoke test without any custom transcript/runtime. No application-side integration has been accepted yet.

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

### NOW — Foundation 2: Thin repo client for the existing Djonik Managed Agent (#2)

Goal:

`local test input → existing Djonik agent_id + environment_id → Managed Agent Session → response`

Scope:

- initialize/retain only the minimal TypeScript/Node client needed for this slice;
- use the current official Anthropic Managed Agents API/SDK primitives;
- reference the already-created Djonik Agent and Environment through environment configuration;
- create/use a real Managed Agent Session;
- send one local test message and receive a natural-language response;
- send a second message to the same Session and prove continuity;
- expose the smallest clean client boundary Foundation 3 can later call from Telegram;
- keep secrets and resource IDs in local environment configuration where appropriate;
- do not duplicate the Djonik system prompt or agent configuration in repo code.

Explicitly out of scope:

- Telegram;
- Trello/Google MCP enablement;
- Memory Store;
- Skills;
- subagents;
- proactive scheduler;
- database;
- legacy runtime migration;
- production deployment.

Acceptance evidence:

- clean install works;
- one documented command runs the local client;
- existing Managed Agent + Environment are referenced rather than recreated;
- first local turn receives a real Managed Agent response;
- second turn in the same Managed Session demonstrably uses first-turn context;
- no Djonik prompt/configuration is duplicated application-side;
- no secret is committed;
- implementation stays thin and Claude-native.

### NEXT — Foundation 3: Telegram conversation adapter

Goal:

`Telegram → existing Djonik Managed Agent Session → Telegram response`

Add only the minimal channel adapter and chat/session mapping needed for one-user real usage.

### THEN — Foundation 4: Durable Claude Memory

Create/attach a Claude Memory Store and validate that Djonik can deliberately persist and later retrieve useful cross-session PM context.

Test with real examples such as stable project/client context and user work preferences. Do not store live task status as memory.

### THEN — Foundation 5: First Skill

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
- do not create a custom DB/memory system without evidence;
- do not turn adapter code into a phrase/intent router;
- keep Skills separate from mutable project data;
- keep external live state fresh through tools;
- verify mutations;
- prefer bounded vertical slices over broad scaffolding.

## Legacy repo

`danielkokr/djonik-manager` may be consulted for product lessons, test scenarios and failure modes.

Do not treat its architecture or open backlog as the roadmap for Djonik 2.0.