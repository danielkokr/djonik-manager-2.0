# Djonik 2.0 — Target Capability Map

> This is a product capability map, **not execution order**. Current execution order lives only in `02_DEVELOPMENT_ROADMAP.md`.

## 1. Conversational PM core

Djonik should:

- maintain natural multi-turn PM conversation;
- resolve recent referents and corrections;
- switch naturally between clients/projects;
- ask useful clarification only when needed;
- combine multiple tools inside one user request;
- provide PM judgement, not just data lookup.

## 2. Persistent context and memory

Djonik should:

- remember stable user work preferences;
- remember useful client/project context;
- retain important decisions and lessons;
- retrieve context across sessions;
- allow incorrect/stale memory to be reviewed and corrected;
- keep remembered context separate from fresh operational truth.

Default implementation: Claude-native memory primitives first.

## 3. Full task operator

Through bounded tools, Djonik should eventually handle ordinary Trello work:

- search/read tasks;
- create tasks;
- edit title/description;
- set/change/clear due dates;
- move status/list;
- complete/reopen;
- safe archive/delete policy;
- checklist creation and item lifecycle;
- attachments where useful;
- multi-step task operations.

## 4. Studio / multimodal intake

Djonik should understand and combine:

- screenshots;
- client chat screenshots;
- images/references;
- PDFs;
- design/source files where supported;
- multiple related Telegram messages/files.

It should derive useful task structure, context, checklists and missing planning questions.

## 5. Daily and weekly planning

Djonik should:

- propose realistic daily work;
- reason over deadlines and undated work;
- account for capacity and workload;
- make trade-offs explicit;
- support weekly planning;
- distinguish a suggestion from a plan the user explicitly accepted.

## 6. Commitments and waiting states

Djonik should distinguish:

- internal due date;
- real client commitment;
- accepted plan;
- waiting-for-client/other waiting states;
- unresolved follow-up.

It should follow important commitments through to verified outcome instead of sending repetitive reminders.

## 7. Project health

Djonik should form a current PM interpretation from fresh evidence:

- healthy;
- at risk;
- blocked;
- stale;
- waiting;
- overloaded/under-planned where applicable.

Project Health is an interpretation, not a competing source of truth.

## 8. Work history and reviews

Djonik should eventually answer evidence-based questions such as:

- what was actually completed this week;
- what moved/reopened;
- which projects consumed attention;
- what repeatedly slipped;
- plan vs actual once accepted plans exist.

Use the simplest reliable evidence source available rather than creating an event platform prematurely.

## 9. Proactive PM

Djonik should eventually wake for bounded scheduled/triggered reviews and decide whether intervention is useful.

Examples:

- morning PM brief;
- meaningful stale/blocker alert;
- commitment follow-up;
- weekly review.

Proactive behavior should be exception-based and quiet when nothing useful changed.

## 10. Calendar

Later capability:

- read events and availability;
- use calendar context in planning;
- Telegram reminders where useful;
- bounded conversational event creation/update.

No autonomous scheduling of the user's time without explicit product policy.

## 11. Client communication

Later capability:

- understand relevant client communication inputs;
- draft concise follow-ups/updates;
- preserve context about approvals/waiting states;
- initially keep client-facing sending under explicit user control.

## 12. Specialist intelligence

Potential later specialist agents:

- studio intake analyst;
- context/research retriever;
- weekly review analyst.

Only introduce them when one main agent is measurably worse than isolated specialist context.

## 13. Reliability and observability

Across all capabilities:

- zero tolerance for wrong-target writes as normal behavior;
- never claim mutation success without evidence;
- prevent avoidable duplicate side effects;
- preserve a user-visible outcome for accepted turns;
- keep secrets and permissions bounded;
- measure cost/latency when optimization becomes material.

## 14. Product definition of success

Djonik succeeds when the user can treat it as a real PM collaborator:

> tell it what is happening in natural language, let it understand the relevant context, let it operate the connected work systems safely, and rely on it to remember and follow the work over time.