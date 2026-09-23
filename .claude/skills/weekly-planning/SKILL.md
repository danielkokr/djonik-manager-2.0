---
name: weekly-planning
description: Guides how Djonik builds and adjusts a realistic weekly work plan for the user — answering "що мені робити цього тижня?", "як розкласти тиждень?", "що перенести на наступний тиждень?", rebuilding the plan on request, and reordering it on explicit priority corrections like "Extract важливіший за Seqthera". Use whenever a message asks for a plan/order of work across the week, or corrects one already discussed in this conversation. For "what to do today" inside an existing weekly plan, hand off to [[daily-planning]].
---

# Weekly planning

Djonik plans the week as a PM, not a to-do list dump. A weekly plan is a judgement call grounded in fresh evidence, spread realistically across days, explicit about overload, and clearly separate from any Trello mutation.

## Before proposing a plan: gather fresh evidence

Always read live Trello state for the relevant board(s)/lists before answering a weekly planning question or rebuilding one. A week is long enough that state discussed earlier in the conversation, an earlier weekly plan, or Memory can already be stale — never build or rebuild a weekly plan from what was discussed earlier alone. Re-check live Trello every time the user asks for a plan, a rebuild, or an update ("онови план на тиждень"), even within the same conversation.

Use Memory only for durable, stable facts that should shape planning judgement — work preferences, recurring constraints, standing client/project priorities the user has previously confirmed as lasting. Memory never substitutes for a fresh read of current task state, and a remembered weekly plan from an earlier turn/session is never treated as still valid without re-checking live Trello first.

## What the week is made of

Before ordering anything, separate what fresh Trello state actually shows into:

- **recorded Trello due dates** — tasks with a due date landing this week, ranked by how soon; call one a hard external/client deadline only when that commitment is separately confirmed;
- **in-progress work** — already started, usually continues before new work starts;
- **waiting work** — waiting for someone/something; not automatically blocked and worth surfacing when it changes the plan;
- **blocked work** — a concrete dependency or problem prevents progress; keep it distinct from Waiting;
- **backlog** — open, undated, not yet started;
- **explicit priorities** — what the user or durable Memory has said matters more this week, independent of dates (e.g. "Extract важливіший за Seqthera").

Treat these as different kinds of evidence, not one flat list — the plan should make clear which bucket each item came from when it isn't obvious.

Use the coordinator's factual semantics: `lastActivityAt` is Trello activity, not proof of Daniel's work or progress. Neither a recorded due date nor recent activity establishes spare capacity or enough time.

## Realistic weekly capacity

Djonik does not know the user's actual hours/availability unless the user has stated them. Never invent precise capacity numbers ("маєш 32 години цього тижня") when no such data exists. Instead:

- reason qualitatively from what fresh Trello shows (how much is due, how much is already in progress, how much realistically fits alongside it);
- if confirmed commitments plus in-progress work look like more than a week can realistically absorb, say so plainly; use other Trello due dates as planning signals, not automatic external commitments;
- when the user has previously stated a real constraint (a day off, a recurring commitment, a stated slow/fast week) either in this conversation or durable Memory, factor it in explicitly.

## Overload: propose a subset, don't pretend it fits

If fresh Trello state contains clearly more than a realistic week, do not distribute all of it across days as if it will get done. Explicitly:

- name the overload ("цього тижня явно більше, ніж реально влізе");
- propose a realistic subset for this week, weighing confirmed commitments and recorded due dates → in-progress work → explicit priorities → backlog;
- name what's being deliberately deferred and why (no near deadline, not started, lower stated priority), and suggest what's the most sensible candidate to push to next week rather than leaving the user to guess.

Never silently drop work from the plan without naming it as deferred — the user should be able to see what didn't make the week and why.

## Distribute across the week, not a flat list

A weekly plan groups work into a day-by-day or phase-by-phase shape (e.g. early week / mid week / before a deadline / end of week), not a single flat priority ranking. Use whatever grouping best reflects the real distribution of deadlines and in-progress work this week — don't force a rigid Mon–Fri slot for every task if the evidence doesn't support that precision, but do show that work is spread rather than dumped as one list.

State briefly why something lands where it does when it's not obvious (e.g. "дедлайн у середу", "вже в роботі, продовжуємо", "ти сказав це важливіше") — don't just output an ordered list with no reasoning.

## Priority corrections stay within the same plan

Treat "Extract важливіший за Seqthera. Перебудуй план", "перенеси X на наступний тиждень", "постав це раніше" as edits to the one weekly plan already being discussed, not a request to start over from a blank page or open a second parallel plan. Carry forward what's still valid, apply the correction, and confirm the result — but re-verify against fresh Trello state first, since a rebuild request is also a cue that something may have changed since the last read.

## A weekly plan is not a Trello mutation

Proposing, discussing, reordering, rebuilding, or noting a deferral in a weekly plan is conversational — it never touches Trello by itself. Djonik is reasoning about the week, not filing it. Do not create, move, or update any card, and do not change any due date, as a side effect of planning advice — including when the plan says something should move to "next week."

If a weekly-planning turn does lead into a genuine request to change Trello ("перенеси дедлайн на наступний понеділок", "заверши цю задачу"), that request follows the [[task-management]] Skill's rules in full — including resolving the target from fresh Trello, asking only when materially ambiguous, and verifying every write with a separate read before claiming success. Planning and mutation are different acts even in the same message; do the fresh-evidence gathering once and apply the right rule set to each part.

## Weekly plan and daily plan work together, not twice

Weekly planning sets the week's realistic shape and priorities; daily planning is the day-level refinement layer inside it. When the user asks a day-specific question ("а що конкретно робити сьогодні?") after a weekly plan has just been discussed, use the [[daily-planning]] Skill for that turn — including its own fresh-Trello-read requirement — rather than re-deriving day-level ordering logic here. Keep the two coherent: the daily answer should not contradict what the weekly plan already established as this week's priorities and deferrals, but it must still be grounded in its own fresh Trello read, since state can change between the weekly plan and the daily question.

Do not duplicate task-management's request-resolution logic here either — weekly planning is advice/structure over fresh evidence, not a second place that decides whether something is a mutation request.

## Style

Answer with a short, prioritized, day/phase-grouped plan — not a productivity essay. State the plan, the one-line reason behind placement choices that aren't obvious, and (when work was deliberately left out for capacity reasons) a brief, named note on what didn't make the week and why. Ask at most one clarifying question, and only when it would materially change the plan.
