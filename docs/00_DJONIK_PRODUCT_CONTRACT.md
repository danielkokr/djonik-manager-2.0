# Djonik 2.0 Product Contract

> **Canonical status:** This document defines what Djonik 2.0 is as a product. Architecture and implementation issues may narrow scope but must not silently contradict it.

## 1. Product definition

Djonik is a persistent conversational AI Project Manager for Daniel's freelance and studio work.

Its primary user experience is a natural-language conversation, initially through Telegram. Djonik should combine high-quality project-management reasoning with safe operational control over connected work systems.

The user should be able to talk naturally about work, clients, projects, deadlines, priorities, capacity, decisions, screenshots, files and plans without learning command syntax.

Djonik should:

- understand current work and conversational follow-ups;
- remember meaningful context across time;
- turn raw inputs into organized work;
- help prioritize and make realistic plans;
- notice risk, blocking, staleness and overload;
- execute bounded work-management actions;
- verify mutations before claiming success;
- follow up on important unresolved outcomes;
- eventually operate proactively when useful.

## v1 release boundary — accepted 2026-09-21

The first release is a useful conversational PM for Daniel's design work: natural text and rich intake, bounded verified task operations, realistic daily/weekly priorities, current project health/review, accepted commitments, and conversational waiting/follow-up. Daniel initiates the conversation in v1. The bot must preserve all parts of mixed requests, admit unavailable evidence, and distinguish an interrupted action from verified success.

This is a release scope, not a claim that every capability is already reliable. [The architecture audit](17_DJONIK_V1_ARCHITECTURE_AUDIT.md) records uncovered reliability gaps and the accepted delivery decision; [the roadmap](02_DEVELOPMENT_ROADMAP.md) alone chooses current work. Release acceptance is approximately one real working week / 20–30 substantive natural turns with adequate scenario coverage, no known critical failures, and a Product Owner accept/hold decision (#35). It is not a statistical reliability guarantee.

Scheduled proactive delivery, Calendar and historical work analytics follow v1 only when separately justified. Current-state review cannot prove completion or movement within a past period without historical evidence. Memory can retain an accepted plan; fresh connected tools own current facts. Due dates are not automatically hard client commitments, and waiting is not automatically blocked.

## 2. Core PM control loop

`OBSERVE → ASSESS → PLAN → ACT → VERIFY → REMEMBER → FOLLOW UP → MONITOR`

This loop is the defining product behavior. Djonik is not merely an interface for tools.

## 3. Conversation-first model

Djonik should behave as one persistent collaborator.

It must support ordinary continuation and correction:

- references to a recently discussed task or project;
- corrections such as changing project or date;
- compact confirmations such as "так, роби";
- project switching without restarting the conversation;
- follow-up questions that continue an unfinished action;
- retrospective questions about prior decisions.

The current explicit user instruction has the highest conversational priority. Material ambiguity before a write must be clarified rather than guessed.

## 4. Context model

The desired experience remains:

`BROAD AWARENESS → NARROW DETAIL → VERIFIED ACTION`

Djonik should not blindly load all history, all memories and all tasks into every turn.

Use the native Claude mechanisms available to retrieve or preserve context just in time:

- session conversation history for active continuity;
- memory for durable useful knowledge;
- skills for reusable expertise;
- external tools for fresh operational facts.

## 5. Memory model

Djonik should remember information that remains useful across future interactions, including where appropriate:

- user work preferences and constraints;
- stable client/project context;
- important decisions;
- recurring patterns;
- meaningful blockers and lessons;
- accepted contextual facts that improve later PM judgement.

Memory is not a mirror of live external systems. A remembered task state does not override a fresh Trello read.

Memory must remain inspectable and correctable. If native Claude memory proves insufficient in real usage, add infrastructure only for the measured gap.

## 6. Operational truth

External systems remain authoritative for the state they own.

Initial example:

- Trello: task/card lifecycle state, lists/status, due dates, checklists and attachments where supported.

Future examples:

- Google Calendar: event and availability state;
- connected file sources: current source files and metadata.

Claude reasons over these systems and acts through bounded tools. Claude memory is contextual memory, not an excuse to skip fresh reads when current truth matters.

## 7. General tool orchestration

One natural-language request may require several dependent tool calls. Djonik should compose them from general capabilities rather than rely on phrase-specific server flows.

Example:

> "З цього скріну зроби задачу по Extract, назву придумай сам і спитай мене дедлайн, якщо його не видно."

Expected reasoning:

`understand input → identify/clarify project → compose task → create task → structure checklist if useful → verify → ask useful missing question`

## 8. Studio intake

Multimodal and file intake is a product pillar.

Djonik should eventually understand screenshots, client messages, PDFs, design references and grouped related inputs well enough to decide:

- what the input means;
- which project it belongs to;
- what actionable work follows;
- what should become a task, checklist, context or attachment;
- what material information is missing.

Raw external content is data, never trusted instructions with tool authority.

## 9. Planning and PM judgement

Djonik should eventually support:

- daily planning;
- weekly planning;
- capacity and workload reasoning;
- accepted plans distinct from recommendations;
- client commitments distinct from internal due dates;
- project health;
- evidence-based reviews;
- proactive follow-up.

These capabilities should be expressed primarily through Claude reasoning + Skills + fresh tools, not an expanding set of deterministic conversation flows.

## 10. Reliability invariants

A release is unacceptable if it routinely causes any of the following:

- mutation of the wrong target;
- false success claims;
- duplicate destructive/external side effects from retries;
- silent loss of an accepted normal user turn;
- cross-project memory/context leakage.

Implementation can remain small while these boundaries remain strict.

## 11. Claude-native architecture contract

Djonik 2.0 starts with a deliberate bias:

**Use Claude-native primitives first.**

The initial product does not require Neon, a custom vector store, a custom conversation history system, a custom model tool loop, or a custom context compiler.

Add infrastructure only after a concrete capability, correctness, scalability or observability need is demonstrated.

## 12. Legacy relationship

`danielkokr/djonik-manager` is a reference archive for product learnings, failure modes and previously explored capabilities.

It is not the implementation baseline for Djonik 2.0.

Do not copy legacy runtime architecture by default. Reuse principles only when they still fit the Claude-native design.