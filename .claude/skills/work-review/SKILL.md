---
name: work-review
description: Guides Djonik through a short, evidence-bounded review of where work stands NOW — what is currently in Done, active, or waiting, and how an explicitly accepted plan compares with the current Trello state — for questions such as "Що зараз у Done / в роботі?", "Дай короткий review по Extract", "Що з плану виконано станом на зараз?", "Що з цих задач уже виглядає завершеним?". Also use when a retrospective question asks for history Trello does not expose ("Що я зробив цього тижня?", "Що завершили за останні дні?", "Що повернулось у роботу?", "Що просунулось цього тижня?", "Коли ця задача перейшла в Done?") so the answer says what current data cannot prove and still gives the useful current state. Read-only; not a health assessment, not a planning request, not a task mutation.
---

# Work review

A work review is a short read of fresh Trello evidence about where work stands now, optionally set beside a plan Daniel explicitly accepted. Trello currently exposes the present state of cards, not the history of how they got there, so the review claims only what the present state proves. It is not a timeline, a score, or a competing source of truth.

## Scope and handoffs

- **Health, risk, blocking, staleness or overload** belong to the Project Health capability and its specialist. Do not judge them here and do not restate, paraphrase or extend a Project Health result; the runtime keeps that result authoritative. When a message is mainly a health question, that path answers it.
- **What to do today or this week** belongs to daily-planning or weekly-planning.
- **An explicit request to create, change, move or complete a task** belongs to task-management, which owns the target, the write and its verification.

## Evidence

Read the relevant board, list or card state in this turn (`trelloReadBoard`, `trelloReadList`, `trelloReadCard`) before any exact current-state claim. `trelloSearch` only discovers candidates; it is not authoritative field evidence. A default listing may hide closed cards, so read so that closed cards are included when archived work matters. Use only values the fresh result actually returned; if a field you would like is absent, say so briefly instead of filling the gap. Fresh Trello outranks Memory, earlier conversation and your own inference. Managed Agents cannot force this fresh read on every turn (#18); this Skill requires it, and an answer with exact Trello claims and no fresh read is not acceptable.

The present state supports these facts: which card, which board or project, its current list, current `closed`, `due`, `dueComplete`, and labels when returned. Say them in current-state words: «зараз у Done», «зараз у In progress», «лежить у Waiting», «архівована».

## History is not available

Current data cannot show when a card was completed, which card finished first or last, that a card moved lists, that it was reopened, who worked on it, whether activity meant real progress, or whether it belonged to a past period. Do not reconstruct any of that. This includes ordering the cards against each other in time: name Done cards as a set, never as «остання закрита», «перша завершена», «нещодавно закрита» or «свіжо завершена».

For a question that depends on such history («Що я зробив цього тижня?», «що завершили за останні дні?», «що повернулось у роботу?», «що просунулось цього тижня?»):

1. Say in one short sentence that the connected current-state data cannot prove what was completed, moved or reopened in that period.
2. Give the useful current state that is supported: a few strongest facts, phrased as «зараз».
3. Add no dates, order, movement, reopen events or causes. Do not present current Done cards as «this week's» work.

If the question is answerable from current state, answer it and skip the caveat.

## Signals stay distinct

`lastActivityAt` only means Trello recorded some activity on the card at that raw timestamp; moving, reordering or creating a card can set it. By default do not mention it. Never use it as evidence of completion, order, movement, reopening, progress, an actor, staleness, or membership in a period, and never to choose which cards to include. Never rewrite it as a local date or time, a weekday, or relative wording, and never present it as when something happened. If it must appear, copy the raw ISO string verbatim as «Trello recorded activity at <ISO>». A raw UTC time re-written as «21 вересня о 07:09» is a measured failure.

`due` is a different kind of field: a current deadline, recorded on the card. It may be shown in a correct human-readable form, and needs no raw ISO when the wording is exactly right for the recorded value. If you are unsure of a conversion or a weekday, quote the recorded ISO instead. Do not derive a countdown or lateness from it. It is a recorded deadline, not a client commitment. Exact due wording after a write stays with task-management.

Three signals speak to completion state. Report each for what it is and keep them apart:

- a card in a list named Done: the board currently treats it as Done;
- `closed`: the card is archived now, which does not mean the work was finished;
- `dueComplete`: a current boolean with no completion time.

Do not promote any of them into «завершено в такий-то момент». When they disagree (for example archived but not in Done, in Done but `dueComplete` false, or `dueComplete` true in an active list) and it matters, state what each shows and that they differ. Do not pick a winner or invent a transition that would reconcile them. `due` is not one of these signals: a deadline is not proof that work is or is not finished, so report it as a current fact on its own and not as a completion-state conflict.

## Coverage and counts

Before a summary or aggregate claim, know what was actually read: which board or label scope, whether closed cards were included, and whether the result was cut off (`hasNextPage`, a reached `limit`, only some lists read, or discovery by search only). If coverage is partial or unclear, say so first, and speak only about what was retrieved («серед прочитаних карток…»). Do not say «усі завершені», «це все, що активно», «всього N» or «жодної» unless coverage proves it.

Give no counts by default. If Daniel asks for a count, name the set it covers (scope, open and closed or open only), tally the returned cards one by one, and write a number that equals the cards you actually enumerate. If you also name cards, the number must match the names shown. With partial coverage, say the count is of what was read.

## Accepted plan and current state

Durable Memory, or a plan Daniel explicitly accepted earlier in this conversation, may supply only the plan side. A suggestion that was only discussed is not a plan, and a Trello list such as «This week» is not an accepted plan unless Daniel says so. Fresh Trello supplies only the current side. Compare them only when both are reliable and the card is clearly the same task in the same project.

Allowed: «У прийнятому плані була X; зараз у Trello вона в Done.»

If no accepted plan is available, or it looks cancelled, superseded or of unclear period, say so and give the current-state review instead of inventing a plan. If a plan item could match more than one card, or the only match is in another project, do not compare: ask one short question or name the item you could not match. Never write «виконано за планом цього тижня», «зірвали», «повернули», or «вчасно» or «із запізненням» from current state. Memory never proves that work was completed, moved or reopened.

## Project scope

Keep a single-project review inside that project. Look for a board first; if none matches, read the shared board's labels and cards and, if exactly one label matches, scope to cards carrying it and say which label you used. Cards of other projects are not named, counted or flagged, even when urgent-looking; do not add «а ще в іншому проєкті…». If more than one board or label plausibly matches, or none does, ask one short clarification. Do not hard-code project names. If Daniel asks across several projects, keep each project's facts separate. A label's use count can include archived cards.

## Shape of the answer

Give a few of the strongest supported facts, in concise ordinary Ukrainian, conclusion first: what is currently Done, what is active, what is waiting (only as the direct fact that the card sits in that list or says so itself), and any material uncertainty or conflict. Add one next action only when a card's own evidence directly supports it; otherwise stop with the facts. No chronology, totals, score, percentage or productivity verdict, no line for every card, no opening inventory. Name only the few cards that carry the point. Do not add vague interpretation such as «невеликий процес» or «тиждень був продуктивним», and do not offer causes you cannot see. List everything only when Daniel explicitly asks for a list or table, and then still state current facts only.

Tone, not a template. Good: «Зараз у Done стоять A і B; C ще в In progress. Коли A і B туди потрапили, Trello не показує, тож «за тиждень» підтвердити не можу.» Bad: «Цього тижня ти завершив A і B, остання закрита — A.»

## Read-only and Memory

A review performs zero Trello writes and has no Calendar dependency; never change a card because a review recommends an action. If Daniel then explicitly asks to act, hand it to task-management. Do not write transient retrospective conclusions to durable Memory («проєкт відставав», «Daniel був перевантажений», «тиждень був продуктивним»); recompute from fresh Trello each time. Stable accepted lessons stay under the existing Memory policy.
