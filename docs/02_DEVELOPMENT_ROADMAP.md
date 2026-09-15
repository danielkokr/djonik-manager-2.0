# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Greenfield repository. Product contract and Claude-native architecture are defined. Djonik is being created as a real Claude Managed Agent in Claude Console. No application runtime implementation has been accepted yet.

## Execution order

### NOW — Foundation 1: Real Djonik Managed Agent + first Console Session

Goal:

`Djonik Managed Agent in Claude Console → Environment → multi-turn Session`

Scope:

- create the real `Djonik` Managed Agent in Claude Console;
- configure its name, model, description and minimal PM system prompt;
- keep default/built-in tools only for this foundation unless Console requires a narrower safe choice;
- do not add MCP, custom tools, Skills, subagents or Memory Store yet;
- create the smallest suitable Environment required by a Session;
- start a real Session in Claude Console;
- send one user message and obtain a natural-language Djonik response;
- send a second message in the same Session and prove conversational continuity;
- record only the non-secret resource identifiers/observations needed for the next integration slice.

Explicitly out of scope:

- local duplicate Djonik agent implementation;
- custom Agent SDK / Messages tool loop;
- local CLI conversation runtime;
- Telegram;
- Trello;
- Memory Store;
- Skills;
- subagents;
- proactive scheduler;
- database;
- legacy runtime migration;
- production deployment.

Acceptance evidence:

- a real Managed Agent named `Djonik` exists in Claude Console;
- a usable Environment exists;
- a real Session references Djonik + that Environment;
- first turn returns a response consistent with Djonik's PM identity;
- second turn in the same Session demonstrably uses first-turn context;
- no application-side duplicate agent/session implementation is introduced.

### NEXT — Foundation 2: Thin repo client for the existing Managed Agent

Goal:

`local test input → existing Djonik agent_id + environment_id → Managed Agent Session → response`

Scope only the smallest TypeScript/Node client needed to call the already-created Djonik resource through the current official Anthropic SDK/API. Store identifiers/secrets only in local environment configuration. Do not duplicate the Djonik system prompt in application code.

### THEN — Foundation 3: Telegram conversation adapter

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