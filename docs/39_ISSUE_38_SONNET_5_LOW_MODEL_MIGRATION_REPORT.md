# #38 — Sonnet 5 low coordinator model migration

Date: 2026-09-23. Canonical NOW: #38 (`docs/02_DEVELOPMENT_ROADMAP.md`). Product Owner authorized this model-only production change in the request for this step. No live acceptance inference was run here.

Migration status was posted to [issue #38](https://github.com/danielkokr/djonik-manager-2.0/issues/38#issuecomment-5792625788) and read back. The issue remains open.

## Summary

The primary production Managed Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` was updated once, from v21 Haiku 4.5 to v22 Sonnet 5, effort low, speed standard. The Project Health specialist remains `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4, Sonnet 5. #38 remains open; #33 is not promoted.

## Exact configuration read-back

| Field | Before | After |
|---|---|---|
| Primary Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` v21 | same ID, v22 |
| `updated_at` | `2026-09-21T10:51:30.448788Z` | `2026-09-23T09:44:37.408199Z` |
| `model.id` | `claude-haiku-4-5-20251001` | `claude-sonnet-5` |
| `model.effort` | absent / not applicable | `{ "type": "low" }` |
| `model.speed` | `standard` | `standard` |
| System prompt | 3686 UTF-8 bytes; SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` | byte-identical |
| Skills | four coordinator Skills, all `latest` | unchanged |
| Multiagent roster | one Project Health specialist, ID above, pinned v4 | unchanged |
| MCP/tool configuration | Trello and disabled Calendar; only `trelloWriteCard` enabled among Trello write tools | unchanged |
| Other Agent fields | name, description, metadata, created/archived state | unchanged |
| Specialist Agent | v4, `claude-sonnet-5`, effort high | full retrieved object unchanged |

Preflight verified the production ID, unarchived v21, exact prior model, exact system hash, four Skills, canonical v4 roster, and v4 specialist. The single `beta.agents.update` request contained exactly `version: 21` and `model: { id: "claude-sonnet-5", effort: "low", speed: "standard" }`. The version precondition provided optimistic concurrency. Fresh `beta.agents.retrieve` calls then verified v22, the requested model, every unchanged field listed above, and an unchanged specialist object.

## Source and serving distinction

`managed-agents/djonik.md` now records Sonnet 5 low/standard in its frontmatter. Its accepted prompt body from `2c6006bd` was not edited: 2572 UTF-8 bytes; SHA-256 `fa361ed981bc54aa33a3da5603eacb65e487eda6b2ad16c1da75f8c25a76817f`.

**The reviewed source prompt is not yet the production Agent prompt.** Production v22 retains the older v21 prompt because the authorized migration expressly forbade a simultaneous system-prompt change. The next live smoke against a fresh production-v22 Session would therefore test Sonnet 5 low with that older prompt. Testing Sonnet 5 low with the accepted `2c6006bd` prompt would require a separately specified candidate Session/Agent or a later prompt update. Do not attribute either configuration's result to the other.

Official Managed Agents Session semantics fix model, system and Skills when a Session is created. Updating the Agent did not change an existing Telegram serving Session. #33 must identify and transition the actual serving Session; this step did not create, archive or alter Sessions. See [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions), [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations), and [Agent update semantics](https://platform.claude.com/docs/en/managed-agents/agent-setup).

## Repo changes and checks

Changed `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`, `docs/02_DEVELOPMENT_ROADMAP.md`, `managed-agents/djonik.md`, `managed-agents/README.md`, and `src/djonikAgentSource.test.ts`; added this report. Historical Haiku evidence remains historical. The pre-existing untracked `docs/38_DJONIK_COORDINATOR_MODEL_ARCHITECTURE_AUDIT.md` was not modified. No code runtime, Skill, Memory, Trello, Calendar, Telegram adapter or specialist change was made.

- Focused source tests: 24/24 passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Live acceptance smoke: not run in this migration step; no paid inference or external work-system write.

## Remaining gate

Run the small #38 Sonnet 5 low smoke on a newly created Session, recording resolved model/effort, exact Project Health composition mode, ambiguity, ordinary Ukrainian continuity, direct PM answer, list cost split, latency/active time, model iterations and tool calls. Keep external writes at zero. Close #38 and promote #33 only after PASS and report synchronization.

## Addendum — accepted prompt synchronization, 2026-09-23

The Product Owner subsequently authorized applying the exact current `managed-agents/djonik.md` prompt before the smoke. This addendum supersedes the report's earlier **current** prompt-mismatch and no-Session statements; those statements remain accurate for the preceding v21 → v22 model-only step.

The read-back immediately before the second update showed production Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v22**, `updated_at` `2026-09-23T09:44:37.408199Z`, model `{id: "claude-sonnet-5", effort: {type: "low"}, speed: "standard"}`, and system SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` (3686 UTF-8 bytes). The current repo prompt body was independently read at 2572 bytes, SHA-256 `fa361ed981bc54aa33a3da5603eacb65e487eda6b2ad16c1da75f8c25a76817f`.

One `beta.agents.update` request sent exactly `version: 22` and `system: <the unedited repo prompt body>`; no model, Skills, tools, MCP, roster or other fields were sent. The fresh read-back showed **v23**, `updated_at` `2026-09-23T09:51:11.870751Z`, the same Sonnet 5 / low / standard model, and system SHA-256 `fa361ed981bc54aa33a3da5603eacb65e487eda6b2ad16c1da75f8c25a76817f`. UTF-8 buffer comparison of production system against repo source returned zero: **byte-identical**. Full equality checks passed for ID, type, name, description, model, Skills, multiagent roster, MCP servers, tools/permissions, metadata, archived state and creation time. The separately retrieved Project Health specialist object remained unchanged at canonical v4. Memory Store is a Session resource and was not modified by the Agent update.

An isolated Session `sesn_01VxJ9PYf26ch4kH237fcazD` was created at `2026-09-23T09:53:06.158661Z` with an explicit **v23 Agent pin**, the existing environment and vault, and the existing production Memory Store mounted `read_only` with the same attachment instructions as `src/djonikClient.ts`. It has no `initial_events`. A 1-cent native `max_list_cost` backstop was set solely to prevent accidental spend before the separately authorized smoke; any future paid run needs its own approved budget plan and cap update. Fresh Session read-back: `idle`, resolved Sonnet 5 / low / standard, prompt SHA matching source, roster → specialist v4, Memory `read_only`, `input_tokens: 0`, `output_tokens: 0`, `active_seconds: 0`, `list_cost: 0`. The Telegram serving Session was not switched or updated. No inference, external work-system mutation or smoke turn occurred.

Focused source tests passed **24/24**; full `npm test` passed **552/552**; `npm run typecheck` passed. Temporary API helper scripts were removed from the working tree after verification. No commit, push or deploy was performed.
