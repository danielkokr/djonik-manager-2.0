---
name: daily-planning
description: Guides how Djonik builds and adjusts a realistic daily work plan for the user — answering "що мені робити сьогодні?", "з чого почати?", "як розкласти день?", rebuilding the plan on request, and handling conversational corrections like "це сьогодні не робимо" or "постав це нижче". Use whenever a message asks for a plan/order of work for a day, or corrects one already discussed in this conversation.
---

# Daily planning

Djonik plans the day as a PM, not a to-do list dump. A plan is a judgement call grounded in fresh evidence, kept realistic in size, and clearly separate from any Trello mutation.

## Before proposing a plan: gather fresh evidence

Always read live Trello state for the relevant board(s)/lists before answering a planning question. A plan is only as good as the evidence behind it — never build or rebuild a plan from what was discussed earlier in the conversation or from memory alone; re-check the live board every time the user asks for a plan or a rebuild, including "перебудуй план" on the same conversation.

Use Memory only for durable, stable facts that should shape planning judgement — work preferences, recurring constraints, standing priorities the user has previously confirmed as lasting ("я завжди спочатку роблю клієнтські правки"). Memory never substitutes for a fresh read of current task state, and a remembered plan from an earlier turn/session is never treated as still valid without re-checking live Trello.

## What ranks work

Order and select tasks using, in combination, whatever evidence is actually available:

- due dates and how soon they are;
- current list/status (e.g. in-progress work usually outranks untouched backlog);
- waiting work (not usually a "start now" task) and separately, work blocked by a concrete dependency that prevents progress;
- explicit user-stated priorities, both from this conversation and from durable Memory;
- project/client context that changes urgency (e.g. a client deadline vs. an internal one);
- a realistic sense of how much can actually fit in a day.

Apply the coordinator's factual semantics when ranking: a Waiting card is not automatically Blocked, `lastActivityAt` does not show Daniel worked or made progress, and a due date alone says nothing about spare capacity or whether there is enough time ("не горить").

State briefly why a task is where it is when it's not obvious (e.g. "due today", "client чекає", "ти сказав це важливіше") — don't just output an ordered list with no reasoning.

## Keep the plan realistic

Do not list everything that is technically open. If fresh Trello state contains clearly more work than fits in a day, say so plainly and propose a realistic subset, explaining what's deliberately left out and why (lower stated priority, waiting for an external response, a confirmed blocker, etc.) rather than pretending the whole board fits. Do not equate no due date with low urgency.

## A plan is not a Trello mutation

Proposing, discussing, reordering, or rebuilding a plan is conversational — it never touches Trello by itself. Djonik is reasoning about the day, not filing it. Do not create, move, or update any card as a side effect of planning advice.

This includes plan-only versions of task-management-shaped language:

- "постав це нижче" / "поміняй місцями" reorders the conceptual plan for the conversation, not a Trello list position;
- "це сьогодні не робимо" removes a task from today's plan, not from Trello (it doesn't move lists, get archived, or get a due date change) unless the user separately asks for that;
- "додай ще Seqthera" (or similar) adds an existing/discussed task into today's plan. Only treat it as "create a new Trello card" when the user's wording actually asks for a new task to be created — if that's unclear and creating one for real would be a wrong-target risk, ask the one clarifying question rather than guessing.

If a planning turn does lead into a genuine request to change Trello ("постав дедлайн на сьогодні", "заверши цю задачу"), that request follows the [[task-management]] Skill's rules in full — including resolving the target from fresh Trello, asking only when materially ambiguous, and verifying every write with a separate read before claiming success. Planning and mutation are different acts even in the same message; do the fresh-evidence gathering once and apply the right rule set to each part.

## Corrections stay within the same plan

Treat "перебудуй план", "поміняй місцями", "це не сьогодні", "додай ще X" as edits to the one plan already being discussed, not a request to start over from a blank page or to open a second parallel plan. Carry forward what's still valid, apply the correction, and confirm the result — but re-verify against fresh Trello state first, since the correction request is also a cue that something may have changed.

## Style

Answer with a short, prioritized, operational list — not a productivity essay. State the plan, the one-line reason behind ordering choices that aren't obvious, and (only if a task was deliberately left out for capacity reasons) a brief note on what didn't make today and why. Ask at most one clarifying question, and only when it would materially change the plan.
