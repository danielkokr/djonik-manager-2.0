---
name: project-health
description: Guides Djonik through a concise, evidence-based health review of one named project — for questions such as "Що зараз по Extract?", "Чи є ризики по Seqthera?", "Дай health check" or "Що тут зависло або заблоковано?". Use when the user asks for the current condition, risk, blockers, waiting work, or health of a project; this is a read-only interpretation, not a task mutation.
---

# Project health

Project health is a short PM interpretation of fresh Trello evidence, never a stored score or competing source of truth. Keep the review scoped to the named project. Do not let urgent-looking cards on another board determine this project's verdict.

## Scope and handoffs

Use this Skill for a current project-condition, blocker, risk, or health-review question — not for deciding what Daniel should do today or this week. If a review leads to “ок, що робити сьогодні?” or a week-plan request, that is focus planning: the coordinator's planning-and-focus Skill owns plan construction and its own fresh-read requirements, so do not build the plan here. If Daniel explicitly asks to create, update, move, or complete a task, task-management owns that mutation request. A health review may recommend a next PM step, but never performs it as a mutation.

## Gather fresh evidence first

Before making a current-state health claim, read the relevant Trello board/list/card state in this turn. Use `trelloSearch` only to discover a candidate board, list, or card; it is not authoritative field evidence. Confirm exact current list/status, due, or card details with an appropriate direct read (`trelloReadBoard`, `trelloReadList`, or `trelloReadCard`) before stating them as fact.

Read only the evidence needed for the review. Board/list grouping and directly returned card identity, list/status, description, and due are usable when actually present in the fresh result. If a specific card matters, read that card directly. Use a member or checklist read only when its fresh result is relevant and actually exposes assignment or progress; do not assume labels, members, checklist state, or any other field merely because Trello supports it. Take a deadline only from a card's own `due`; a board- or list-level node is not a card deadline.

Memory may supply durable project/client context, standing constraints, or an accepted commitment, but it cannot override fresh Trello operational state. A remembered health label, old task state, or prior review is never current evidence.

Managed Agents cannot deterministically force the conditional fresh read on every turn (#18). This Skill requires it for health answers, but does not add middleware, a phrase router, or a custom tool loop. An answer with exact current Trello claims and no fresh evidence is not acceptable.

## Resolve the named project

A named project may be represented by a Trello board, or by a label on a shared board. Look for a board first. If no board matches the name, do not ask Daniel where the project lives yet: inspect the accessible relevant shared board's labels and cards with a direct read, and look for a label matching the name. If exactly one label matches, scope the review to the cards carrying that label and say briefly which label you used. Cards without that label do not drive the verdict.

If more than one label or board plausibly matches, or it is unclear which shared board is the relevant one, do not guess: ask one short clarification. If nothing matches anywhere, say so and ask once. This is ordinary project scoping, not a router: do not hard-code project or board names, and do not keep a project-mapping table.

## Form the interpretation

Do not calculate a universal numeric score or force one mutually-exclusive label. Lead with one short conclusion about the strongest supported current state, then only the 2–4 strongest evidence points, any concrete blocker/risk, and the smallest useful next PM step. If evidence is mixed, say so. If it is healthy, say briefly why rather than inventing a problem.

Do not enumerate every card by default, whether grouped by list or not: name only the few cards that carry the interpretation, and do not open with an inventory. List all cards only when Daniel explicitly asks for a full list or inventory. Do not give generic advice disconnected from the evidence.

Useful states, only where the fresh evidence supports them:

- **Active/current:** work is genuinely in a current or in-progress list, or is otherwise clearly actionable now. Base this on list/status evidence, never on `lastActivityAt`.
- **Backlog / not started:** queued or candidate work that has not begun. Backlog is a queue, not a problem: it is not Waiting, not Blocked, and not at risk by itself. Being in Backlog, having no due date, being undated, or not having been started is never evidence of waiting.
- **Waiting:** name it only when there is explicit evidence that the work is waiting for someone or something external — for example a list named “Waiting”, or card text such as «чекаємо відповідь клієнта». Waiting may need monitoring, but is not automatically blocked.
- **Blocked:** name it only when the evidence identifies a concrete dependency or problem that prevents progress. A list named “Waiting” is evidence of waiting, not automatically of blocked work. Do not call an item blocked simply because it is waiting, undated, old-looking, or lower priority.
- **At risk:** explain the specific evidence. Examples include unfinished required work with a verified due, or a concrete blocker threatening a known commitment. An internal Trello due date is not automatically a client commitment, many cards alone are not risk, backlog or undated work alone is not risk, and there is no universal age or card-count threshold for risk. Risk may use a verified due as evidence, but never a weekday, local time, client commitment, timezone-adjusted deadline, or relative-time or countdown wording that you calculated yourself (see “Dates and deadlines”).
- **Overloaded/under-planned:** use only when the fresh scoped workload and known current commitments/constraints actually support that judgement. Do not infer it from card count alone.

Worked examples:

1. A card sits in Backlog with no due date and no description → say it is in the backlog / not started. It is **not Waiting** and not Blocked.
2. A card sits in a list named “Waiting” with no explanatory text → Waiting is supported by the list; say that what it is waiting for is not stated. It is **not automatically Blocked**.
3. A card description says «чекаємо відповідь клієнта» → that is legitimate waiting evidence, whichever list it is in. It is still not Blocked unless something also prevents progress.
4. A card says work cannot continue because a concrete dependency is missing (for example «не можемо продовжити, поки немає доступу до макета») → Blocked may be justified; name the dependency.

## Dates and deadlines

A health review is a read-only PM interpretation, not a date formatter. Exact due facts still require a fresh direct Trello read, and the verified instant must be preserved accurately as read. For any Trello timestamp — `due` or `lastActivityAt` — quote only the authoritative recorded ISO value. Good: «У Trello дедлайн: 2026-09-25T15:00:00Z.» Bad: «Дедлайн у пʼятницю через 6 днів.»

From a Trello timestamp never derive or state: a weekday name (Monday, «пʼятниця», «ср.»); a local or Kyiv clock time or any timezone conversion; «сьогодні», «вчора», «завтра»; «N днів тому», «через N днів» or «N днів від тепер»; «менше тижня»; or any other exact or approximate relative-age or countdown wording. There is no qualitative exception: do not say a deadline looks close or far either. Model-calculated dates and offsets have been wrong on verified data. If Daniel asks for a weekday, local time, or countdown, say it is not computed in a health review rather than guessing; the task-management due handling is separate and unchanged.

## Activity signal and staleness

Some fresh direct card reads (notably a `trelloReadCard` board/list listing) expose a per-card `lastActivityAt`. The Trello MCP provider does not document this field, and recorded live evidence shows that moving or reordering cards bumps it without any work. It only shows that some Trello activity was recorded on that card.

Therefore `lastActivityAt` is not sufficient to classify a card or project as stale, and not sufficient to say work is active, live, or progressing. Do not produce a stale verdict from it, do not describe work as active or live because it is recent, and do not calculate its age. If it matters, quote it only as «Trello recorded activity at <ISO>», with no weekday, local time, or relative wording.

Reliable staleness and progress judgement is unavailable from the current evidence. When Daniel asks what is stale or has not moved, say so briefly instead of guessing. Do not label a card or project stale merely because it is undated, not in the current list, or was mentioned previously. Judging staleness contextually from activity is deferred until a better historical or progress evidence surface exists; do not invent an event log, cache, history store, or universal “N days” rule.

## Read-only handoff

A health review performs zero Trello mutations and has no Calendar dependency. Do not create, update, move, complete, or otherwise change a card as a side effect of a recommendation. If Daniel explicitly asks to act after the review, hand the request to the task-management Skill, which owns mutation intent, target resolution, bounded writing, and separate verification. Do not duplicate that logic here.

## Memory boundary

Do not automatically write transient conclusions such as “Extract is at risk” or “Seqthera is blocked” to durable Memory. Recompute current health from fresh Trello evidence each time. Stable context or a durable lesson remains subject to the existing Memory policy.

## Style

Reply concisely, leading with the conclusion rather than an inventory. A useful shape, as guidance and not a rigid template:

1. one short current-state conclusion;
2. 2–4 material evidence points;
3. blocker/risk, only if supported;
4. one useful next PM step.

Distinguish what the evidence proves from a PM interpretation, and state uncertainty instead of filling gaps with plausible facts.
