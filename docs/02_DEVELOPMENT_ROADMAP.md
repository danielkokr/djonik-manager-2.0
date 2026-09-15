# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundations 1–7 are accepted. `Джонік` is the authoritative Claude Managed Agent; Telegram is the thin channel adapter; `Djonik Memory` provides durable cross-session memory; the custom `task-management` Skill is attached; `Djonik Personal` Vault supplies Trello/Google credentials; Trello MCP read/write flows work against live data; and the shared client now enforces same-card verify-after-write for Trello card mutations. The current focus is realistic conversational PM validation across Telegram and Trello before expanding capabilities.

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

### DONE — Foundation 5: First custom Skill — task-management (#5)

Accepted 2026-09-15 at commit `478cd60c604392fdce3ae3b56624fa7c6299f7df`.

Verified foundation:

- one real custom `task-management` Skill exists in the Claude workspace;
- the existing authoritative `Джонік` Managed Agent has it attached;
- a real Managed Session event trace proved the Skill file was loaded/read;
- task request, correction/follow-up, and advice-not-mutation scenarios behaved correctly;
- Skill content remains bounded and contains no mutable/live project data;
- typecheck/tests/`git diff --check` passed.

### DONE — Blocker: Session vault wiring and retryable MCP errors (#6)

Accepted 2026-09-15 at commit `ddbd3dfb117ff4da16f15598619499f686a4b53e`.

Verified foundation:

- `Djonik Personal` Credential Vault is passed to every new Managed Session via `vault_ids`;
- Trello and Google Calendar MCP credentials resolve without missing-auth failures;
- retrying/non-terminal `session.error` events no longer abort otherwise successful turns;
- true terminal failure still surfaces correctly;
- standard Telegram path works again;
- task-management Skill still loads;
- focused tests passed 20/20.

### DONE — Foundation 6: Trello read surface through Claude MCP (#7)

Accepted 2026-09-15.

Verified foundation:

- authenticated Trello MCP works in ordinary Djonik Sessions;
- Foundation 6 used a read-only effective permission set;
- real project/card discovery works against live Trello data;
- card details, checklist state, list context and due-date state were read accurately;
- PM judgement was based on fresh Trello evidence;
- task-management Skill and Memory Store remained functional.

### DONE — Foundation 7: Trello write surface with verified mutations (#8)

Accepted 2026-09-15 at commits `842352a0e90b143f2e5d397e92586ea4673cf696` and `5bec33a53c1e57eed2edb53ad5cceb01d3e77be6`.

Verified foundation:

- `trelloWriteCard` is the bounded enabled Trello mutation tool;
- real create/update/move flows work against the live board;
- target resolution uses fresh Trello reads rather than Memory;
- ambiguous target scenarios do not mutate;
- Telegram end-to-end write succeeded;
- task-management Skill guidance was strengthened for verify-after-write;
- the shared client deterministically requires a later successful `trelloReadCard` for the same `cardId` after `trelloWriteCard`;
- unrelated reads cannot satisfy verification;
- one bounded corrective nudge is allowed, then the turn fails closed;
- focused tests passed 28/28, with typecheck and `git diff --check` clean.

### NOW — Foundation 8: Conversational PM validation across Telegram and Trello (#9)

Goal:

`natural conversation → understand intent/context → fresh Trello evidence when needed → target-safe verified mutations → preserve referents/corrections → concise PM response`

Scope:

- validate realistic multi-turn task creation and follow-ups through Telegram;
- validate referents such as `її`, `цю задачу`, `це`;
- validate project/date corrections without duplicate tasks;
- validate advice-vs-mutation separation;
- validate `що зараз горить?` from fresh Trello state;
- validate ambiguity causes clarification and zero write;
- validate durable Memory across a new Session while fresh Trello state outranks remembered live state;
- fix only bounded issues exposed by these scenarios;
- do not add new product integrations or orchestration layers.

Acceptance evidence:

- Telegram scenarios A–E from Issue #9 behave correctly;
- cross-session Memory scenario F behaves correctly;
- no accidental duplicate tasks or guessed mutations occur;
- advice-only turns produce zero mutation;
- every successful Trello write still satisfies same-card verify-after-write;
- fresh Trello state remains the source of truth for live work;
- task-management Skill continues to load where relevant.

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