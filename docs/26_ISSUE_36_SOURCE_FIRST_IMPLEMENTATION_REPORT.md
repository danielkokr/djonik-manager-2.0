# Issue #36 — source-first implementation report

Date: 2026-09-22  
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36)  
Scope: source-first implementation only; no live Managed Agent validation or production promotion.

## 1. Summary

Implemented the source required for a later isolated candidate to answer weekly-work questions from Trello's authoritative action history. The runtime path is deliberately narrow:

```text
Trello REST action history
  → deterministic read-only digest
  → trello_work_history custom-tool result
  → existing Haiku coordinator narration
```

No Trello mutation, Managed Agent Session, remote Agent/Skill update, commit, push, deploy, or branch creation occurred.

The canonical roadmap still marks #36 as **NOW**. The current GitHub issue body and sole Product Owner comment were read before implementation; the comment confirms that this capability is in v1, required before #35, and must describe board events rather than attribute actions to Daniel.

## 2. Files changed

| File | Change |
|---|---|
| `src/trelloWorkHistory.ts` | New deterministic domain, exported custom-tool schema, GET-only Trello REST client, safe executor, Kyiv formatting and paging. |
| `src/trelloWorkHistory.test.ts` | New anonymised real-shaped fixtures and focused domain/REST safety tests. |
| `src/djonikClient.ts` | Narrow `agent.custom_tool_use` → `user.custom_tool_result` continuation for the one recognised custom tool. |
| `src/turnCompletion.test.ts` | Custom-tool round-trip, exact-ID, partial-text, safe-failure and mutation-regression tests. |
| `.claude/skills/work-review/SKILL.md` | Replaced superseded current-state Skill contract with thin action-history v2. |
| `src/workReviewContract.test.ts` | Replaced obsolete #29 current-state Skill assertions and retained independent historical rubric/helper regression coverage. |
| `.env.example` | Added non-secret placeholders for Trello read credentials. |
| `README.md` | Documented runtime secret placement, read-only use, 30-day rotation and unavailable-history behavior. |

## 3. Final `trello_work_history` input contract

One exported canonical custom-tool definition is provided as `TRELLO_WORK_HISTORY_TOOL`:

```json
{
  "window":
    { "kind": "this_week" }
    | { "kind": "last_week" }
    | { "kind": "explicit", "from": "YYYY-MM-DD or RFC3339", "to": "YYYY-MM-DD or RFC3339" },
  "scope":
    { "kind": "board" }
    | { "kind": "project", "label": "Current Trello label" },
  "response_format": "concise" | "detailed"
}
```

For date-only explicit values, `from` is the start of the Kyiv date and `to` is exclusive. The schema offers no generic HTTP, endpoint, URL, raw board ID, or write capability.

## 4. Final model-facing digest shape

The executor supplies JSON containing only:

- Kyiv-local window labels/timestamps;
- board or current-label project scope;
- coverage: `pagesRead`, `truncated`, `oldestActionReached`;
- deterministic category counts: `reached_done`, `returned_from_done`, `created`, `archived`, `moved`;
- compact named items with local action time, net list transition, repeated-Done occurrence count where applicable, and locally formatted current due date.

Concise mode limits each named category to five items. The result excludes `lastActivityAt`, raw Trello identifiers, empty optional fields, raw action payloads and credentials. A card with Done → reopen → Done can appear in the relevant deterministic categories, while list chatter remains one net transition per card.

## 5. Trello REST paging and authentication

`TrelloWorkHistoryClient` performs GET requests only:

1. `GET /members/me/boards` resolves the board only when exactly one accessible board exists; ambiguity fails explicitly.
2. `GET /boards/{id}/cards/all` loads current card label/due context.
3. `GET /boards/{id}/actions` uses `since`, `before`, and `limit=1000`, repeatedly fetching older pages until a deterministic coverage stop.

Authentication uses Trello's OAuth `Authorization` header. `TRELLO_API_KEY` and `TRELLO_READ_TOKEN` are never placed into URLs, telemetry, errors or test snapshots. Missing credentials, rejected credentials, malformed responses and non-OK responses become safe tool errors. No current-state fallback is attempted when action history is unavailable.

Project scope intentionally means a card's **current** label, as decided by the canonical #36 scope. A card whose label changed historically is not inferred into a historical project membership.

## 6. Europe/Kyiv and DST design

Week boundaries and human-facing action/due times are derived through `Intl.DateTimeFormat` with IANA `Europe/Kyiv`, not a hard-coded offset. Kyiv local calendar values are converted back to UTC with an iterative offset calculation. Tests cover the March 2026 DST transition: Monday 30 March begins at `2026-03-29T21:00:00Z`, whereas the prior week began at `22:00Z`.

## 7. Custom-tool continuation

The thin Session client keeps custom-tool uses by provider event ID. On `session.status_idle` with `requires_action`:

1. It verifies every blocking ID corresponds exactly to an observed `agent.custom_tool_use` for `trello_work_history`.
2. It executes only that bounded read-only executor.
3. It submits `user.custom_tool_result` correlated **only** by `custom_tool_use_id`; an incoming `session_thread_id` is never copied into the result.
4. It continues the same stream and accepts a visible reply only after `end_turn`.

Pre-tool model text is cleared at the custom-tool pause, so it cannot become a success reply. Unknown, malformed or mismatched custom-tool states fail visibly rather than being guessed. Existing non-custom `requires_action` pauses remain incomplete under #32 semantics.

## 8. #31 mutation-verification preservation

The work-history custom tool is not an MCP Trello mutation and does not enter `TrelloMutationLedger`. A test covers a verified `trelloWriteCard` plus history-tool continuation: same-card verification still governs the write, and no custom-tool result can satisfy a missing mutation verification requirement.

## 9. #32 specialist/correlation preservation

The existing per-turn anchor, FIFO, incomplete-turn behavior and Project Health provenance path are unchanged. Only the recognised custom-tool pause is resolved; no original `user.message` is replayed, no second Messages loop is created, and no user-text routing is added. Existing specialist and normal-turn regressions continue to pass.

## 10. Skill v2

The new `work-review` source is 1.5 KB (below the approximately 3 KB target). It instructs the coordinator to:

- call the history tool for period-based questions;
- narrate its deterministic digest in roughly 2–4 Ukrainian sentences;
- say «на дошці перейшло в Done», not «ти зробив» or «Daniel завершив»;
- keep accepted Memory plans to an unambiguous plan-side comparison only;
- leave Project Health to its existing ownership path;
- make no writes or productivity/trend/effort claims;
- explicitly report unavailable history rather than fabricate current-state history.

The old `lastActivityAt` policing text was removed because that field is absent from the history-tool result. Historical #29 rubric/source evidence remains in the repository; only obsolete assertions about the superseded Skill contract were replaced.

## 11. Tests added

Focused tests cover:

- this-week, last-week, explicit-window and DST-sensitive Kyiv boundaries;
- paging with `since`/`before` and coverage flags;
- net list-transition collapse and rapid moves;
- Done → reopen → Done and returned-from-Done facts;
- creation, archive, and create+archive noise suppression;
- current-label project isolation and whole-board scope;
- Kyiv action/due rendering, concise limits, and absence of raw IDs/`lastActivityAt`;
- missing key/token, unauthorized token and credential non-leakage;
- exact custom-tool correlation (including a cross-posted use carrying informational `session_thread_id`), same-session continuation, provisional-text suppression, unknown/mismatched tool failure, and mutation-verification preservation;
- v2 Skill contract and bounded schema.

The source-review correction also retains four independent historical #29 helper checks: rubric metadata, chronology/due lint behavior, fresh-evidence trace extraction, and fresh-evidence grading. These do not restore the superseded Skill wording.

## 12. Exact focused-test result

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/turnCompletion.test.ts src/workReviewContract.test.ts
52 passed, 0 failed
```

## 13. Exact full test result

```text
npm test
446 passed, 0 failed, 0 skipped, 0 cancelled
```

## 14. Typecheck and diff check

```text
npm run typecheck
passed

git diff --check
passed
```

Git produced only existing Windows LF→CRLF warnings and a non-fatal warning that the global Git ignore file was inaccessible.

## 15. Manual smoke evidence

Not run by design. This source-first slice made no live Trello request, Managed Agent Session request, paid inference, Agent configuration update, remote Skill upload, or production promotion.

## 16. Limitations and deferred work

- Live isolated Haiku validation remains separately authorised work under `docs/04` §27.
- The exported tool definition is source for a future isolated candidate; it is not attached to production or automatically injected into existing production Sessions.
- Production promotion remains #33 work after candidate acceptance.
- Trello retention beyond the measured spike remains an operational limitation.
- Work outside Trello, trend analytics, effort/time accounting, Calendar, schedules, webhooks, snapshots, event stores and RAG remain out of scope.

## 17. Official API check

Current official Anthropic Managed Agents documentation confirms that `agent.custom_tool_use.session_thread_id` can be present for a cross-posted subagent use but is informational only; the server routes a result by `custom_tool_use_id`, so clients must not send the thread ID back. The installed `@anthropic-ai/sdk` 0.125 declaration still permits the optional outbound field and has an older contradictory comment suggesting an echo. The source therefore follows the current official API contract and omits it.

Both sources describe the same core continuation flow:

- custom tools emit `agent.custom_tool_use`;
- a Session pauses at `session.status_idle` with `requires_action` and its blocking `event_ids`;
- the application responds using `user.custom_tool_result.custom_tool_use_id`;
- resolving all blockers resumes the same Session.

Sources: [Session event API reference](https://platform.claude.com/docs/en/api/beta/sessions/events/list) and [Session event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming).

## 18. Test-count accounting

The canonical pre-#36 `npm test` result was 472. The initially reported 442 was exactly `472 - 41 + 11`: 41 runtime cases disappeared from the former `workReviewContract.test.ts`, while #36 had added 6 work-history tests, 3 continuation tests, and 2 v2 contract tests.

That file's 41 former cases consisted of 11 current-state fixtures (A–K), 7 old Trello-MCP discovery fixtures (PR-A–PR-G), and 23 static current-state/rubric assertions. The current-state wording, `lastActivityAt`, current-card completeness/counting, old R16 Trello-MCP discovery flow, and the old Skill/document layout were intentionally superseded. Useful boundaries were retained or adapted: current-label project isolation is covered by the work-history tests; Project Health and read-only separation by v2 Skill assertions and existing specialist coverage; #31/#32 were unchanged; and four independent rubric/helper cases were restored in this review.

Removed verbatim fixture categories were:

- A–K: **Historical-looking question**; **Project review with Done / active / waiting cards**; **lastActivityAt**; **Conflicting Done / closed / dueComplete state**; **Partial retrieval**; **Explicit count request**; **Accepted plan and a matching current card**; **Accepted plan missing, ambiguous or in the wrong project**; **Single-project isolation**; **Project Health ownership boundary**; **Review-only scenario stays read-only**.
- PR-A–PR-G: **Named project with a discoverable exact board**; **Named project with exactly one matching label**; **Several plausible matches after discovery**; **Zero matches after discovery**; **Zero Trello calls, then an immediate clarification**; **Missing Memory context alone does not justify skipping Trello discovery**; **Exact board identity supplied by the user**.
- Static old-contract assertions: Skill frontmatter/sections/chronology/ordering/no-write/due-field wording; R03/R06 and full rubric-document checks; R16 fixture/trace/grading/Memory/Skill-order checks; and six lint/rubric checks.

The independent historical helper mechanics were not discarded: this review added adapted tests titled **historical work-review rubric keeps all named dimensions and model-neutral severity metadata**, **historical lint helper flags unsupported chronology but leaves a human-readable due date to factual review**, **historical fresh-evidence trace counts only Trello discovery before the final message**, and **historical fresh-evidence grader rejects a premature clarification and accepts a discovered ambiguity**.

The final total is `472 - 41 + 15 = 446`, where the 15 current #36 cases are the 11 original additions plus the 4 restored helper regressions. No other test file was deleted; `npm test` discovers `src/**/*.test.ts` and now includes 13 test files.

## 19. Git status

```text
 M .claude/skills/work-review/SKILL.md
 M .env.example
 M README.md
 M src/djonikClient.ts
 M src/turnCompletion.test.ts
 M src/workReviewContract.test.ts
?? docs/25_PM_AGENT_BEHAVIOR_AUDIT.md
?? docs/26_ISSUE_36_SOURCE_FIRST_IMPLEMENTATION_REPORT.md
?? src/trelloWorkHistory.test.ts
?? src/trelloWorkHistory.ts
```

`docs/25_PM_AGENT_BEHAVIOR_AUDIT.md` was already untracked before this implementation and was not changed.
