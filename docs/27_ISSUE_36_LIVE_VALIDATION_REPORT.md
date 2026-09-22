# Issue #36 — isolated live validation report

Date: 2026-09-22  
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36)  
Scope: an isolated Haiku candidate only. No production promotion or operational mutation was performed.

## 1. Executive result

**FAIL — candidate fails revised #36 live gate.**

The candidate selected the correct history path in Session 1 / Turn 1, but its visible answer stated that five cards moved while the deterministic `trello_work_history` digest reported `counts.moved: 7`. The five visible `moved` entries were a concise-format subset, not the count. That is a materially wrong deterministic count, which the gate defines as a critical fail. The candidate was not modified after its first paid turn and no Sessions 2–4 were started.

The original Phase 0 preflight remains valid: the absent accepted plan/card/project fixture is a real current limitation, but the Product Owner's revised decision moves plan-vs-actual to #34. It neither causes this failure nor weakens history correctness.

## 2. Phase 0 — original zero-cost preflight (preserved evidence)

Before the revised decision, a read-only Memory preflight found no current explicit accepted plan that identified both a Trello card and its project. The only Extract plan-like entry was expressly cancelled/superseded. The original gate prohibited seeding Memory or manufacturing a fixture, so the run stopped before paid inference: $0.00, zero paid Sessions and zero Trello GETs.

The current roadmap and #34 issue/comment assign durable accepted commitment/plan identity (including Trello card ID and project) to #34, after #33. The Product Owner therefore deferred Sample 5 to #34. No Memory content was changed and no #34 work was begun.

## 3. Phase 1 — revised gate and scope confirmation

The required repository and governance materials, current GitHub #36/#34 bodies and comments, the work-review Skill, and relevant source were reread. `docs/02_DEVELOPMENT_ROADMAP.md` still marks #36 as canonical **NOW**. `HEAD` was `1500f564811a8d242bfa646603df57c321f7ffa5`; accepted source-first commit `e106a2e` remains an ancestor.

Official Managed Agents documentation and installed `@anthropic-ai/sdk` 0.125 declarations were rechecked. The live runner kept the accepted continuation rule: `requires_action` is non-terminal and only `end_turn` completes a visible turn; a custom-tool result is correlated only by the observed blocking custom-tool event ID / `custom_tool_use_id`, never by informational `session_thread_id`.

Authorization: at most $0.90 total list cost, four paid Sessions, and six visible paid turns. Actual deliberate validation use was one paid Session, three visible paid turns, and **$0.22**, leaving $0.68 unused. The candidate Session had native `max_list_cost: $0.80` as a per-Session backstop; it did not reach that cap.

## 4. Phase 2 — frozen isolated candidate

The following isolated resource was created before the first paid turn and read back afterwards without alteration:

| Item | Frozen value |
|---|---|
| Candidate Agent/version | `agent_01EeGJTjuKWZa3LuRaHBjj8k` / 1 |
| Candidate model | `claude-haiku-4-5-20251001`, `standard` |
| Coordinator system identity | SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` (3,664 chars; same as production read-back) |
| Coordinator Skills | `task-management` `skill_01WS6JtY1GMu3rGZaKCVR9w1` / `skver_012fLb9ZFpL4mjqybAZ7KtmU`; `daily-planning` `skill_01G9DtQEzPYxgw78riFh8k99` / `skver_01TDfMCnuv5LkQN4WvtwBzXW`; `weekly-planning` `skill_01PTmbvLHJj1HuUxvDKhpaiE` / `skver_018soRHmcAn6onE8DpHScFbf`; `studio-intake` `skill_015c8dtDnWyDfVLwS6NLS7r6` / `skver_018sJv1GCnzfZRG4NbExbAzj` |
| Candidate work-review Skill | `skill_01XfmznSqyMA7eYBoyVPiTMb` / `skver_013CWFoDj6vLpNzXsr1czTn4`; source SHA-256 `006e34e2bfc14b875a5832aefc07b9c29f3a16446b479d0ce6b001f82d1358bd` |
| Project Health roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM`, pinned version 4 |
| Custom tool | `trello_work_history`; input-schema SHA-256 `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921` |
| Memory | production Djonik Memory `memstore_01WViYK3WQvGEgojB2GiaDFq`, attached to the validation Session `read_only` |
| Permissions | Trello read surface only; every `trelloWrite*` tool, including `trelloWriteCard`, disabled; Calendar disabled; no Memory write capability |

Production was re-read after the run and remained Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, version 21, model `claude-haiku-4-5-20251001` / standard, with the same system hash. Its four Skills still resolve as `latest`; the candidate pins their then-current immutable versions above. No production Agent, Skill, Session, roster, Memory, Trello, Calendar, or vault configuration was modified.

Before the first paid turn, the local thin client was extended only to express the required read-only Memory mount and Session cost backstop. No candidate configuration change occurred after that turn.

## 5. Phase 3 — actual live samples

### Session 1

Session: `sesn_01CtxKs9qwv7hX6RHTQwND4Y`. It ended idle with an authoritative `end_turn` for each visible turn. All custom-tool continuation events used the exact observed `agent.custom_tool_use` event ID as `user.custom_tool_result.custom_tool_use_id`; no result carried or used `session_thread_id`.

| Admission / usage checkpoint | Cumulative list cost | Decision |
|---|---:|---|
| Before T1 | $0.00 remaining $0.90 | admitted; >= $0.12 coordinator reserve |
| T1 authoritative end | $0.03 | remaining $0.87 |
| Before T2 | $0.03 remaining $0.87 | admitted; >= $0.12 coordinator reserve |
| T2 authoritative end | $0.04 | remaining $0.86 |
| Before Project Health | $0.04 remaining $0.86 | admitted; >= $0.40 PH reserve |
| PH authoritative end | $0.22 | remaining $0.68 |

#### Turn 1 — this week / Extract (critical failure)

- Prompt: `Що я реально зробив/завершив цього тижня по Extract? Дай коротко.`
- Blocking tool event: `sevt_0191Jj9EWnixbguMqjiw3jPp`; tool `trello_work_history`; input `{"scope":{"kind":"project","label":"Extract"},"window":{"kind":"this_week"},"response_format":"concise"}`.
- Correlated result: `sevt_01CvgTw7TaCoLxvTkZuatCSy`, `custom_tool_use_id: sevt_0191Jj9EWnixbguMqjiw3jPp`, `is_error: false`.
- Deterministic digest: Kyiv window `пн 21.09, 00:00`–`вт 22.09, 12:21`; complete one-page coverage; counts `reached_done: 1`, `returned_from_done: 0`, `created: 2`, `archived: 0`, `moved: 7`. It named `Коментарі по пінкам` reaching Done at `пн 21.09, 10:09`, and exposed five representative `moved` entries because `response_format` was concise.
- Visible answer: `По Extract цей тиждень завершено 1 задачу... Також створено 2 нові карти... Інші 5 карт переміщено між списками...` The Done and created statements, project scope, board-event wording, coverage behavior, no actor attribution, and `end_turn` were correct. However, “5 cards moved” conflicts with the authoritative count of **7**; it converted the five-item concise subset into a total. **Critical fail: materially wrong deterministic count.**
- Authoritative completion: `sevt_01LL44173GaY2K3jzEdW6VKe` with `stop_reason: end_turn`.

#### Turn 2 — same-Session last week (captured but non-admissible after T1 fail)

- Prompt: `А минулого тижня по Extract? Теж коротко.`
- New blocking tool event: `sevt_01RNonNGfJinjrKHiU6RhyhH`; input `{"scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"},"response_format":"concise"}`.
- Correlated result: `sevt_013hVaeJMbvjWHTLv4St2YEy`, exactly correlated by that event ID, `is_error: false`.
- Deterministic digest: Kyiv window `пн 14.09, 00:00`–`пн 21.09, 00:00`; complete one-page coverage; counts `reached_done: 4`, `returned_from_done: 2`, `created: 6`, `archived: 0`, `moved: 5`. It includes the two returned-from-Done events and the four reached-Done items as defined by the digest.
- Visible answer: reports four completed items, six created cards, and two returns from Done. It is concise and has no actor claim, but this turn is not used to cure or override the T1 critical failure.
- Authoritative completion: `sevt_01NDRAx8yBJca9RUy3b2FSPX` with `stop_reason: end_turn`.

#### Turn 3 — Project Health boundary (captured but non-admissible after T1 fail)

- Prompt: `А як зараз виглядає здоровʼя Extract?`
- No `trello_work_history` call was reused. Native Project Health delegation created child thread `sthr_019kBTS4rrBSfCcXkschiW2r` (`sevt_013o48UkKJpmSueiPiUtmo8Y`) for `Djonik Project Health Specialist`.
- Coordinator sent the health question through `sevt_018rLNzpTF6pcwyVBzeTxBEG`; the specialist response arrived through `sevt_01CfpEjRgxW9FVsfWx3DScfA` and was surfaced unchanged. This is the expected ownership/correlation boundary; no work-history digest was repurposed as a health judgement.
- Authoritative completion: `sevt_016ev5vujjB9VnREWT8Bw6en` with `stop_reason: end_turn`.

### Sessions 2–4

**Not run.** T1's critical failure stops the gate. No whole-board, explicit-reopen, or independent last-week Session was created, so no further list cost, Trello GET, or model inference was incurred.

## 6. Zero-write and routing evidence

The only observed coordinator local tool call was a read of the attached candidate Skill. Both work-review turns invoked only the candidate's read-only custom tool. Candidate permissions made Trello mutation impossible, Calendar disabled, and Memory read-only; no event indicates an unauthorized write. The Project Health turn followed the pinned native specialist path and emitted no operational write event.

For both work-review calls, the result was sent only as `user.custom_tool_result` with the exact blocking event ID in `custom_tool_use_id`. No original user text was replayed. Each `requires_action` checkpoint was followed by the correlated result and a final `end_turn`; it was never treated as completed output.

## 7. Grading and limitations

| Dimension | T1 result |
|---|---|
| Work-review selection, scope, window, tool correlation | pass |
| Project isolation, non-actor wording, no fabricated history | pass |
| Coverage honesty and authoritative end-turn | pass |
| Transition/count fidelity | **critical fail** — digest `moved: 7`, visible answer says 5 |
| Writes | pass — zero observed/available operational mutations |

Protocol limitation: the single continuation runner sent T2 and the PH prompt after it had received T1's `end_turn`, before a human/operator could grade T1. This did not create another Session, alter the candidate, exceed any authorization or reserve, or perform a write, but it did not honor the intended human fail-fast checkpoint. Their events are retained as evidence only; they are not accepted as continuation validation. Sessions 2–4 were correctly not begun after the discrepancy was confirmed.

The report does not diagnose or change the source/Skill after the live run. Any remediation needs a separate authorized source-review/fix decision and a new isolated validation gate. Plan-vs-actual remains explicitly deferred to #34.

**Recommendation: candidate fails revised #36 live gate.**

No production promotion, roadmap update, issue closure, commit, push, or deployment was performed.

## 8. Final local checks

```text
npm test
447 passed, 0 failed, 0 skipped, 0 cancelled

npm run typecheck
passed

git diff --check
passed (Git printed only non-fatal CRLF/global-ignore warnings)

git status --short
 M src/djonikClient.test.ts
 M src/djonikClient.ts
?? docs/27_ISSUE_36_LIVE_VALIDATION_REPORT.md
```

## 9. Source-only remediation after the failed gate

This section records a later **source-only** remediation; it does not revise the failed candidate result above. No Managed Agent inference, candidate creation, Trello request, remote configuration change, or paid rerun was performed.

### Root cause and fix

The model-facing concise payload had two competing locations for a category's size: global `counts.moved: 7` and a separately truncated `moved: [five items]`. Haiku treated the array length as the total. The action-history calculation, scope, Kyiv rendering and coverage were not changed.

The payload now has one local category contract and no global `counts` object. Each non-empty category (`reached_done`, `returned_from_done`, `created`, `archived`, `moved`) is:

```json
{
  "total": 7,
  "total_kind": "cards",
  "shown": 5,
  "omitted": 2,
  "items": ["up to five named items"]
}
```

`total` is the only authoritative category count. `shown` counts the units represented in `items`, and `omitted` is `total - shown`; therefore an item-array length cannot be mistaken for a total. For `created`, `archived`, and net `moved`, `total_kind` is `cards`. For `reached_done` and `returned_from_done`, it is `event_occurrences`: one net card item may carry `occurrences > 1`, while `total`, `shown`, and `omitted` count those occurrences. Detailed mode returns every item with `shown === total` and `omitted === 0`; concise mode limits named items to five. Empty categories remain absent, and neither raw IDs nor `lastActivityAt` are introduced.

The thin work-review Skill gained one matching sentence: `total`/`total_kind` are authoritative, while `items` are examples and `shown`/`omitted` declare their coverage. It does not add a large prompt-policing rule.

### Regression evidence and validation harness disposition

`src/trelloWorkHistory.test.ts` now reproduces the live shape with Extract project scope, seven qualifying net moved cards, concise output, and exactly five named items. It asserts `total: 7`, `shown: 5`, `omitted: 2`, `items.length: 5`, card-count semantics, absence of empty category noise, and absence of raw IDs/`lastActivityAt`. Existing tests now also assert detailed-mode behavior and repeated reached-Done/reopen event-occurrence semantics.

The local `connectToDjonik()` changes were inspected separately. The retained `memoryAccess` and `maxListCostUsdCents` options are bounded, generic Session-creation capabilities: their defaults preserve production's `read_write` Memory and no budget field, while a future isolated #36 candidate can use `read_only` Memory and a native cost backstop. The prior `title` and `metadata` options were validation-only labeling scaffolding and were removed. The retained option test proves both the validation override and unchanged omitted fields.

The frozen candidate and its failure/cost evidence remain intact. A new isolated live revalidation requires Product Lead acceptance and separate authorization.

### Source-only remediation checks

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/workReviewContract.test.ts src/djonikClient.test.ts
148 passed, 0 failed

npm test
449 passed, 0 failed, 0 skipped, 0 cancelled

npm run typecheck
passed

git diff --check
passed (only non-fatal CRLF/global-ignore warnings)
```
