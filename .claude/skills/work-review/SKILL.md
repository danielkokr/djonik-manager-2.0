---
name: work-review
description: Review Trello action history for a project or board over this week, last week, or an explicit date range, then provide one short PM conclusion after the client-delivered factual report.
---

# Work review — Trello action history

Use `trello_work_history` for questions about a period: what moved to Done, returned from Done, was created, archived, or otherwise changed this/last week or in an explicit range. It is read-only and Trello's action log is the source of truth for those events.

How much time or how many hours went into a project is not a review: call `trello_project_time` with the project's current label instead. Its result is final, `unavailable` included — never use this tool's moves to estimate effort.

Request the narrowest scope that is clear: a project uses its **current Trello label**; otherwise review the whole board.

Answer the question Daniel asked, with one call. A week or project review uses the default `focus: overview`. A question about one kind of change — «які задачі закрито по CL?», «що створили цього тижня?» — uses that `focus` (`completed`, `returned`, `created`, `archived`, `moved`): the block is then only that deduplicated card list. `response_format: detailed` is the event-by-event chronology, only when Daniel's own message asks for it («детально», «повна історія», «всі переміщення»); never request it to gather material for your own summary — code shows it only on such a request. A follow-up about a review you just delivered («тобто тиждень успішний?») needs no second call and no repeated facts: answer it in a sentence or two.

`answer_text` is the complete, already-correct factual report (any coverage caveat is already included in it). Djonik's client delivers it to Daniel verbatim on its own — do not repeat, rewrite, reformat, or summarize it in your reply. After a successful call, add only ONE short PM-level conclusion, recommendation, observation, or useful next question. Phrase an inference as judgement ("схоже", "варто перевірити", "я б звернув увагу...") and never invent an event, date, or entity beyond what the tool returned.

Describe board facts, never an actor: say «на дошці перейшло в Done», not «ти зробив» or «Daniel завершив».

If the tool errors or history is unavailable, say that plainly — do not substitute a current-state guess. Do not make Project Health judgements, productivity scores, effort/time claims, trend analysis, or claims about work outside Trello. An accepted plan in Memory may be a plan-side comparison only when its card and project clearly match; it never proves a transition. Project Health remains its own capability; an explicit requested action goes to task-management.

Do not write Trello, Calendar, or Memory during a review.
