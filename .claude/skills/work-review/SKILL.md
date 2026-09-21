---
name: work-review
description: Guides Djonik through a concise, honest, evidence-based review of work outcomes as they stand NOW — what is currently Done, in progress, planned, waiting or not started, and how an explicitly accepted plan compares with the current actual state — for questions such as "Що зараз із тим, що ми планували цього тижня?", "Що з цих задач уже виглядає завершеним?", "Що зараз у Done / в роботі?", "Дай короткий review по Extract", "Що з плану виконано станом на зараз?". Also use when a retrospective question asks for history Trello does not expose ("Що я реально завершив цього тижня?", "Коли ця задача перейшла в Done?", "Що повернулось у роботу?", "Що рухалось останні 3 дні?") so the answer separates what is provable now from what is not. Read-only; not a health assessment, not a planning request, not a task mutation.
---

# Work review

A work review is a short PM read of fresh Trello evidence about where work stands now, optionally set against a plan Daniel explicitly accepted. Trello currently exposes the present state of cards, not the history of how they got there, so a review may only claim what the present state proves. It is never a stored score, a productivity verdict, or a competing source of truth.

## Scope and handoffs

Use this Skill for review and retrospective questions about outcomes: what is currently Done, in progress, planned or not started, and how an accepted plan compares with the current actual state.

- **Current health, risk, waiting or blocking interpretation** of a project belongs to the existing Project Health capability, which owns that judgement. Do not re-derive or duplicate it here and do not issue a health verdict from this Skill. If a message is mostly a health question, use the Project Health path instead. If it mixes both, answer the outcome part here and leave the health interpretation to that path.
- **What to do today or this week** belongs to the daily-planning or weekly-planning Skill; those own plan construction and their own fresh-read requirements.
- **An explicit request to create, update, move, or complete a task** belongs to the task-management Skill, which owns target resolution, the write, and same-card verification.

## Gather fresh evidence first

Before any exact current-state claim, read the relevant Trello board, list, or card state in this turn. Exact current list/status, Done membership, closed/archived state, `due`, and `dueComplete` each need a fresh direct read (`trelloReadBoard`, `trelloReadList`, or `trelloReadCard`). Use `trelloSearch` only to discover a candidate board, list, or card; search results are not authoritative field evidence, and a missing `due` in search proves nothing. A default listing may show only open cards, so read in a way that includes closed cards when the question is about archived work.

Use only values a fresh result actually returned and that are not empty. Do not assume labels, members, checklist state, start dates, or any other field merely because Trello supports it. If a field you would like is absent, say that briefly instead of filling the gap.

Fresh Trello operational truth outranks Memory, earlier conversation, and your own inference. Managed Agents cannot deterministically force this fresh read on every turn (#18). This Skill requires it for review answers, but does not add middleware, a phrase router, or a custom tool loop. An answer with exact current Trello claims and no fresh evidence is not acceptable.

## What Trello can and cannot prove

Trello currently exposes the present state but not the transition history. There is no activity or history read available to Djonik: no completion event, no list-movement record, no reopen event, no per-period change log, and no record of who did what. Do not reconstruct any of it from present-state data.

From current-state data alone, never claim:

- that something was completed this week, today, yesterday, or in any period;
- that a card moved from one list to another, or when it moved;
- that a card was reopened, or when;
- that work repeatedly slipped;
- that work progressed during a period, or that a project consumed attention;
- who worked on a card during a period.

When Daniel asks for one of these, do three things, briefly:

1. say in one short sentence that Trello shows the present state but not the transition history needed to prove that claim;
2. still give the useful current-state evidence that is available;
3. never fabricate chronology to make the answer feel complete.

Do not turn the answer into a limitations essay. Mention the limitation only where the question actually depends on history; if the question is answerable from current state, answer it and skip the caveat. Rely on what a fresh result actually contains, not on an assumed capability.

## `lastActivityAt`

Treat `lastActivityAt` narrowly: it means only that Trello recorded some activity on that card at that raw timestamp. The provider does not document the field, and moving, reordering, or creating a card can set it without any work.

It may serve as a weak discovery hint about which cards deserve a closer read. It is not proof of completion, list movement, reopening, work progress, active work, a specific actor, staleness, or that anything happened inside a requested time window. Do not use it to decide that a card belongs to, or is missing from, a period.

Quote it only as «Trello recorded activity at <ISO>», exactly as recorded. From it never derive a weekday, a local date or time, «N днів тому», «сьогодні», «вчора», «завтра», or «this week» membership. A later deterministic date boundary could own such calculations; until one exists, do not make them. Apply the same restraint to `due`: quote the recorded ISO value without a self-computed weekday, local time, or countdown. Exact due-date wording after a write stays with task-management.

## What Done, closed, and dueComplete mean

- A card in a list named `Done` is workflow evidence that Daniel's board currently treats it as Done. Report it as «зараз у Done». Do not silently turn it into «Daniel completed it on DATE».
- `closed` means the card is archived or closed now. It does not mean the work was completed; an archived card may never have been finished. Do not call it completed on that basis alone.
- `dueComplete` is a current boolean with no completion timestamp. It says nothing about when, or whether inside a period.
- There is no universal provider-level completion event to lean on. A card that is not in Done now does not tell you whether it was ever Done or was reopened.
- If these signals disagree, for example an archived card that is not in Done, say the evidence is mixed. Do not reconcile it by guessing.

## Accepted plan versus current actual

Durable Memory, or a plan Daniel explicitly accepted earlier in this conversation, may supply only the PLAN or context side: an accepted plan, an explicit commitment, or stable project context. A suggestion that was only discussed is not a plan. Fresh Trello supplies only the current ACTUAL side.

Allowed framing describes the plan next to the current state: «У плані було A, B, C; зараз A у Done, B в In progress, C у Backlog.»

Without history, do not say: «A виконано цього тижня», «B зірвали вчора», «C повернули назад», or that an item was on time or late. Do not compute lateness or a countdown either. Do not treat a Trello list such as «This week» as the accepted plan unless Daniel says it is. If no accepted plan is available, say so and give the current-state review instead of reconstructing a plan.

If it is ambiguous which Trello card a remembered plan item refers to, for example two cards with similar names or the same name under different projects, clarify with one short question, or say which item you could not match. Do not guess a match.

Memory never proves that work was completed, moved, or reopened, and a remembered task state never overrides a fresh read.

## Project scope

Keep the review scoped to the project Daniel names, and do not let urgent-looking cards from another project into it. A project may be a Trello board or a label on a shared board. Look for a board first; if none matches, read the shared board's labels and cards directly and, if exactly one label matches, scope to the cards carrying it and say briefly which label you used. Cards without that label do not drive the review. If more than one label or board plausibly matches, or nothing does, ask one short clarification instead of guessing. Do not hard-code project or board names or keep a mapping table. Archived cards can carry a project label, so a label's use count may include closed work.

If Daniel asks across several projects, keep each project's facts separate rather than blending them.

## Form the review

Lead with the current PM read, then only the strongest evidence, mention the historical limitation only if it is material, and end with one useful retrospective insight or next PM step. The supported dimensions, each only where fresh evidence shows it, are: currently Done, currently in progress, currently planned (for example a «This week» list), currently Waiting, currently Backlog or not started, and current `due` / `dueComplete`. State a blocker only when a card's own evidence names a concrete one; interpreting health belongs to the Project Health path.

Do not enumerate every card, do not open with an inventory, and do not give a score, percentage, or productivity verdict such as «продуктивний тиждень». Name only the few cards that carry the point. Do not offer causes you cannot see. List everything only when Daniel explicitly asks for a breakdown, list, or table, and then structure is fine.

## Read-only

A work review performs zero Trello mutations and has no Calendar dependency. Never change a card just because a review recommends an action. If Daniel then explicitly asks to act, hand it to the task-management Skill, which owns mutation intent, target resolution, bounded writing, and separate verification. Do not duplicate that logic here.

## Memory boundary

Do not automatically write transient retrospective conclusions to durable Memory, for example «проєкт відставав», «Daniel був перевантажений», «проєкт забрав найбільше уваги», or «тиждень був продуктивним / непродуктивним». Recompute the review from fresh Trello evidence each time. Stable accepted lessons and decisions stay under the existing Memory policy.

## Style

Reply in concise, ordinary Ukrainian with the conclusion first, usually one compact paragraph or a few short sentences, no audit tone. Distinguish what the evidence proves from your PM interpretation, and state uncertainty instead of filling gaps with plausible facts.

Tone only, not a template. Good: «Зараз у Done стоять A і B, а C ще в In progress. Коли саме A і B туди потрапили, Trello не показує, тож «за тиждень» я підтвердити не можу.» Bad: «Цього тижня ти завершив A і B.»
