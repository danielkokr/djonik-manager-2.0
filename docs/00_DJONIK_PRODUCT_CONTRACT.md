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

## Working PM baseline — Product Owner decision 2026-09-22 (replaces the 2026-09-21 "v1 release boundary")

There is no "v1 release" milestone. The goal is a normal, useful PM agent for Daniel's daily work, built capability by capability. Behaviour, proactivity and voice are defined by [the PM-agent audit](25_PM_AGENT_BEHAVIOR_AUDIT.md).

**Baseline Djonik must provide:**
- natural text and rich intake that become tasks in the right project;
- bounded, verified task operations;
- realistic daily and weekly priorities;
- project health;
- a short weekly work review from Trello's action history (#36);
- accepted commitments, waiting and follow-up (#34);
- **a working rhythm (#39):**
  - a short morning brief on work days;
  - a Monday week plan;
  - a Friday review;
  - at most a couple of well-timed exception messages.

Djonik speaks as a concise PM colleague (#38). It preserves every part of mixed requests, admits unavailable evidence and distinguishes an interrupted action from verified success.

**Proactivity rules:**
- predictable rhythm over spontaneous pings;
- quiet hours (default 20:00–09:30 Europe/Kyiv, per Daniel's preference);
- a small daily limit on unsolicited messages;
- no repeats of unchanged facts;
- "не нагадуй" is respected;
- every proactive message ends with one easy action;
- autonomous turns never change Trello — they propose, and Daniel confirms.

**Success is judged by use, not by a release:** a pilot of about two working weeks with the rhythm on (#35). The brief and review are useful, no commitment is lost, project labels are right, noise stays low and cost is known. Daniel decides whether it works and what to change next. It is not a statistical reliability guarantee.

**Still out of scope until a measured need appears:**
- Calendar integration (Cossack Labs Tue/Thu syncs come from Memory for now);
- automatic client contact;
- trend analytics and effort/time accounting;
- work outside Trello.

History comes from Trello's own action log ([docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md), [docs/23](23_WORK_HISTORY_SPIKE_REPORT.md)) and reports board events, not who performed them. Memory retains stable context and accepted plans; fresh connected tools own current facts. Due dates are not automatically hard client commitments, and waiting is not automatically blocked.

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