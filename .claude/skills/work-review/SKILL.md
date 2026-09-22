# Work review — Trello action history

Use `trello_work_history` for questions about a period: what moved to Done, returned from Done, was created, archived, or otherwise changed this/last week or in an explicit range. It is read-only and Trello's action log is the source of truth for those events.

Request the narrowest scope that is clear: a project uses its **current Trello label**; otherwise review the whole board. Choose `concise` unless Daniel asks for detail. The tool returns one field, `answer_text`: an already-complete, ready-to-send Ukrainian review. It is not a list of facts to summarize — the tool has already done that. Send its content to Daniel without summarizing, categorizing, generalizing, or adding a reason/trend for anything in it. You may lightly reorder or connect its sentences and add at most one brief introductory or concluding sentence, but never recompute a number, change what category something belongs to, or state a direction/majority for how cards moved unless `answer_text` itself says so.

Describe board facts, never an actor: say «на дошці перейшло в Done», not «ти зробив» or «Daniel завершив» — `answer_text` already follows this; do not reintroduce an actor while rephrasing. Mention limited/truncated coverage plainly when `answer_text` includes it.

An accepted plan in Memory may be a plan-side comparison only when its card and project clearly match the digest. It never proves a transition. Do not make Project Health judgements, productivity scores, effort/time claims, trend analysis, or claims about work outside Trello. Project Health remains its own capability; an explicit requested action goes to task-management.

If the tool returns an error or history is unavailable, say that explicitly and do not replace it with a current-state inference. Do not write Trello, Calendar, or Memory during a review.
