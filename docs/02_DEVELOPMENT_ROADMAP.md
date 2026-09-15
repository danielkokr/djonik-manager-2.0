# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding legacy infrastructure unless real usage demonstrates a need.

## Current state

Greenfield repository. Product contract and Claude-native architecture are defined. No runtime implementation exists yet.

## Execution order

### NOW — Foundation 1: First real Djonik Claude session

Goal:

`local user input → Djonik Claude agent → natural-language response → second input continues the same session`

Scope:

- initialize a minimal TypeScript/Node project;
- use the current official Anthropic SDK / Claude Managed Agents primitives;
- define/apply a minimal Djonik agent configuration from repo-owned instructions;
- start a session;
- send one user message and obtain a final natural-language response;
- send a second message to the same session and prove conversational continuity;
- provide a simple local CLI/dev entry point;
- keep secrets in `.env` / environment only;
- add focused automated tests where deterministic behavior can be tested;
- document exact local run steps.

Explicitly out of scope:

- Telegram;
- Trello;
- Memory Store integration beyond whatever is strictly required to create the first session;
- Skills;
- subagents;
- proactive scheduler;
- database;
- legacy runtime migration;
- production deployment.

Acceptance evidence:

- clean install works;
- `npm run dev` (or one clearly documented equivalent) starts the local interaction;
- first turn returns a Djonik response;
- second turn in the same session demonstrably remembers/uses first-turn context;
- no API key or secret is committed;
- implementation remains small and Claude-native.

### NEXT — Foundation 2: Telegram conversation adapter

Goal:

`Telegram → Djonik Claude session → Telegram response`

Add only the minimal channel adapter and chat/session mapping needed for one-user real usage.

### THEN — Foundation 3: Durable Claude Memory

Attach a Claude Memory Store and validate that Djonik can deliberately persist and later retrieve useful cross-session PM context.

Test with real examples such as stable project/client context and user work preferences. Do not store live task status as memory.

### THEN — Foundation 4: First Skill

Add `task-management` as the first custom Skill and validate progressive, task-relevant behavior without bloating the core system prompt.

### THEN — Foundation 5: Trello read surface

Give Djonik bounded read-only task/project awareness.

Initial target:

- find/search cards;
- read task details;
- answer natural PM questions from fresh Trello state.

### THEN — Foundation 6: Trello write surface

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

- Claude reasoning stays primary;
- do not rebuild a custom Messages tool loop;
- do not create a custom DB/memory system without evidence;
- do not turn server code into a phrase/intent router;
- keep Skills separate from mutable project data;
- keep external live state fresh through tools;
- verify mutations;
- prefer bounded vertical slices over broad scaffolding.

## Legacy repo

`danielkokr/djonik-manager` may be consulted for product lessons, test scenarios and failure modes.

Do not treat its architecture or open backlog as the roadmap for Djonik 2.0.