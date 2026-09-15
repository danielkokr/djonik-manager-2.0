# Djonik 2.0 — Development Roadmap

> **Canonical NOW source.** Do not infer current work from issue number, date or another chat. The item explicitly marked **NOW** here is authoritative.

## Goal

Build Djonik as a Claude-native conversational PM, adding one working capability at a time while avoiding custom infrastructure unless real usage demonstrates a need.

## Current state

Foundations 1–6 are accepted. `Джонік` exists as the authoritative Claude Managed Agent, Telegram works as a thin channel adapter, `Djonik Memory` provides durable Claude-native memory across distinct Managed Sessions, the custom `task-management` Skill is attached and verified, the `Djonik Personal` Credential Vault is wired into all new Sessions, and Trello MCP read access is authenticated and verified against real data. Foundation 6 hard-disabled Trello mutation tools and proved fresh read-only PM awareness. The current focus is safe, verified Trello mutation behavior.

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
- no Trello mutation behavior was introduced;
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
- all 6 Trello mutation tools are hard-disabled at the Managed Agent config level;
- 9 read tools plus search remain available;
- real project/card discovery works against the live `Djonik` Trello board;
- card details, checklist state, list context and due-date state were read accurately without inventing missing fields;
- PM judgement was based on fresh Trello evidence;
- tool traces showed only read operations and zero mutation calls;
- task-management Skill and Memory Store remain functional;
- Telegram adapter starts cleanly;
- repo remained clean because this foundation required only live agent permission config.

### NOW — Foundation 7: Trello write surface with verified mutations (#8)

Goal:

`natural-language task request → task-management Skill → exact Trello target → mutation → fresh verification read → concise confirmation`

Scope:

- inspect actual operations inside the disabled Trello write tools;
- re-enable only the smallest useful mutation set;
- create cards/tasks;
- update title/description/due date;
- move cards when target list is clear;
- support complete/reopen where current Trello MCP semantics safely allow it;
- use fresh Trello reads to resolve targets;
- ask one concise clarification when material ambiguity remains;
- verify every claimed mutation by re-reading the affected Trello object;
- preserve Skill, Memory Store, Vault, Telegram and the existing Trello read surface;
- run at least one real Trello write flow through Telegram.

Acceptance evidence:

- only intended Trello mutation tools are enabled;
- real create/update/move flows succeed;
- each successful write is followed by an independent fresh Trello read confirming the intended state;
- ambiguous targets cause clarification instead of guessed mutation;
- conversational corrections update the intended existing task rather than create duplicates;
- at least one write succeeds end-to-end through Telegram;
- no unverified success claim or unintended mutation occurs.

### NEXT — Conversational PM validation

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