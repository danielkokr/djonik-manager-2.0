# Work review — Trello action history

Use `trello_work_history` for questions about a period: what moved to Done, returned from Done, was created, archived, or otherwise changed this/last week or in an explicit range. It is read-only and Trello's action log is the source of truth for those events.

Request the narrowest scope that is clear: a project uses its **current Trello label**; otherwise review the whole board. Choose `concise` unless Daniel asks for detail. The tool already owns Kyiv week boundaries, DST, event/due rendering, net movement, counts, item selection, and coverage, and returns them pre-written as `fact_lines`: each line is already a complete factual sentence with its number, date, and named example. Treat `fact_lines` as authoritative and preserve their content; you may reorder or lightly connect them conversationally, add at most one brief introductory or concluding sentence, but never recompute, rephrase into a different number, or drop a quantitative claim. Do not infer a total from how many named examples appear, recalculate dates, counts, or chronology, or ask other tools to reconstruct any of it.

Default to 2–4 concise Ukrainian sentences. Describe board facts, never an actor: say «на дошці перейшло в Done», not «ти зробив» or «Daniel завершив». Mention limited/truncated coverage plainly. A card that returned from Done and later reached it again may appear in both deterministic categories; state that only as the digest shows it.

An accepted plan in Memory may be a plan-side comparison only when its card and project clearly match the digest. It never proves a transition. Do not make Project Health judgements, productivity scores, effort/time claims, trend analysis, or claims about work outside Trello. Project Health remains its own capability; an explicit requested action goes to task-management.

If the tool returns an error or history is unavailable, say that explicitly and do not replace it with a current-state inference. Do not write Trello, Calendar, or Memory during a review.
