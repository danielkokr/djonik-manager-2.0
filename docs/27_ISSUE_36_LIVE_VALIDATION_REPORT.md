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

## 10. Second isolated live revalidation — commit `1b2e33a`

Date: 2026-09-22. This is a separately authorised rerun after `1b2e33a` (`fix: disambiguate work history digest totals`). It is independent of the historical first run above: its $0.70 authorization does not subtract the earlier $0.22 spend.

**Rerun result: candidate fails #36 live revalidation.** The original `7` versus `5` ambiguity was structurally removed, and T1 did not repeat that exact claim. However, T2 still treated non-authoritative displayed/selected information as totals: it reported three completions against `reached_done.total: 4` and five created cards against `created.total: 6`, `shown: 5`, `omitted: 1`. This is a critical total-fidelity failure. The run stopped immediately after T2; PH and Sessions 2–4 were not started.

### Preflight and frozen candidate

- Canonical NOW: `docs/02_DEVELOPMENT_ROADMAP.md` still marks #36 NOW. `1b2e33abddf711fd9406cfdea0c848aca2dc59c1` is `HEAD`.
- Plan-vs-actual remains deferred to #34: #34 owns persistent accepted commitment identity/card/project. No Memory fixture was seeded or changed.
- Production read-back before and after the rerun was identical: `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, version 21, `claude-haiku-4-5-20251001` standard, system SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899`, four `latest` coordinator Skills, PH `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4. No production resource was modified.
- New isolated candidate: `agent_01G9i5vhv4oNcp14rXyvTyRc`, version 1, same model/system hash, and pinned coordinator Skills: `task-management` `skver_012fLb9ZFpL4mjqybAZ7KtmU`; `daily-planning` `skver_01TDfMCnuv5LkQN4WvtwBzXW`; `weekly-planning` `skver_018soRHmcAn6onE8DpHScFbf`; `studio-intake` `skver_018sJv1GCnzfZRG4NbExbAzj`; canonical PH v4.
- Candidate work-review Skill: `skill_01YVPQniaz4A7HcV5SMhF4bH` / `skver_01Tv6i31e7JLuH3i63WFGr4t`; committed-source SHA-256 `5f3dd016afa630b347ebe0d609fc261aa63a3570f2d2bf8328fed05a09974e3b`. `trello_work_history` input-schema SHA-256 `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921`.
- The candidate has every listed `trelloWrite*` tool disabled (including `trelloWriteCard`), Calendar disabled, and the Session mounted `memstore_01WViYK3WQvGEgojB2GiaDFq` with `read_only`. Candidate version remained 1 after the first paid turn.
- The old failed candidate was neither reused nor modified: `agent_01EeGJTjuKWZa3LuRaHBjj8k` remains version 1 with its earlier update timestamp.

### Fail-fast Session 1

Session: `sesn_01AM4JKKPCWYA7nZrNCkYCXj`, native `max_list_cost: $0.45`; final authoritative cumulative rerun cost **$0.04**. This is below the new $0.70 cap. Historical first-run cost remains **$0.22**, reported separately above.

#### T1 — original failure reproduction (pass, with a non-critical shape observation)

- Prompt: `Що я реально зробив/завершив цього тижня по Extract? Дай коротко.`
- Custom use `sevt_01DzMYY3YewYmDmZTL9Fbf2m`: `{"scope":{"kind":"project","label":"Extract"},"window":{"kind":"this_week"},"response_format":"concise"}`.
- Correlated result `sevt_01XHgD2fgewJceWeoR7SV781` used exactly that ID as `custom_tool_use_id`, then ended at `sevt_01D4Nbrpp3FjiFqntLdeS4wa` with `end_turn`.
- Model-facing categories: `reached_done { total: 1, total_kind: event_occurrences, shown: 1, omitted: 0, items.length: 1 }`; `created { 3, cards, 3, 0, 3 }`; `moved { 7, cards, 5, 2, 5 }`; one-page complete coverage.
- Answer correctly reported one completion and three creations. It listed representative moves followed by “та інші”; it did **not** claim that five was the moved total. Thus the original `total: 7` / `shown: 5` failure did not recur. The answer was more report-like than the requested short 2–4 sentences, recorded as a non-critical response-shape issue.
- Authoritative list cost after T1: $0.03; $0.67 rerun authorization remained, so T2 was admitted (normal-turn reserve $0.12 satisfied).

#### T2 — same-Session last week (critical failure)

- T2 was sent only after T1's `end_turn` was inspected and graded; T1 ended at `09:57:42Z`, while the T2 user event `sevt_01B3cQ99sbDAkvZoFjCgAXKj` was processed at `09:59:03Z`. No future prompt was pre-enqueued.
- Prompt: `А минулого тижня по Extract? Теж коротко.`
- New custom use `sevt_01RxfEjTLod7TXGVG197gwwK`: `{"scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"},"response_format":"concise"}`. Its correlated result was `sevt_011CaPhisi6QEbhpyfTVFKEP`, using exactly that `custom_tool_use_id`; no stale T1 result was reused.
- Exact relevant model-facing categories: `reached_done { total: 4, total_kind: event_occurrences, shown: 4, omitted: 0, items.length: 4 }`; `returned_from_done { total: 2, event_occurrences, shown: 2, omitted: 0, items.length: 2 }`; `created { total: 6, cards, shown: 5, omitted: 1, items.length: 5 }`; `moved { total: 5, cards, shown: 5, omitted: 0, items.length: 5 }`; coverage remained one-page, non-truncated and oldest reached.
- Visible answer said **“Завершено 3 карти”** and **“Створено 5 нових карт”**. The digest authoritatively says four reached-Done event occurrences and six created cards. The latter exactly repeats the forbidden total/subset conflation (`total: 6`, `shown/items: 5`). The former is also materially wrong and selectively omits a supplied fourth occurrence. **Critical fail: category totals were not treated as authoritative.**
- T2 ended authoritatively at `sevt_01CDt1i3LjpgwtX1xSSmegoS` with `end_turn`. Cumulative Session cost was $0.04; no further turn was admitted despite $0.66 remaining.

### Stop, safety, and remaining scope

No Project Health prompt, whole-board sample, explicit reopen sample, or independent last-week Session was created after T2. Therefore there is no PH acceptance evidence from this rerun. The candidate was not changed after its first paid turn.

Both history turns used only the read-only custom tool. The candidate structurally disabled Trello writes and Calendar; the Memory resource was read-only; no write event occurred. `requires_action` was treated as a pause, settled only through the exact observed custom-tool event ID, and each visible result waited for authoritative `end_turn`.

The structural source fix is present and removes the original competing `counts`/array locations, but this rerun shows that it alone does not make Haiku reliably narrate every category total. Do not promote this candidate. Any remediation or another live attempt needs Product Lead review and separate Product Owner authorization; plan-vs-actual remains #34 work.

**Recommendation: candidate fails #36 live revalidation.**

### Local checks after revalidation

```text
npm test
449 passed, 0 failed, 0 skipped, 0 cancelled

npm run typecheck
passed

git diff --check
passed (only non-fatal CRLF/global-ignore warnings)

git status --short
 M docs/27_ISSUE_36_LIVE_VALIDATION_REPORT.md
```

## 11. Second source-only remediation — deterministic fact-skeleton fallback (docs/21 §10)

Date: 2026-09-22. This is a **source-only** iteration after the second live revalidation above. No Managed Agent inference, candidate creation, Trello request, remote configuration change, commit, push, deploy, or issue close was performed.

### Measured root cause

Both live failures used a frozen candidate with the corrected §9 category-local `{total, total_kind, shown, omitted, items}` contract, which already removed the original competing global `counts` object. The second failure (§10 T2) nonetheless answered "3 completed" against `reached_done.total: 4` and "5 created" against `created.total: 6` (`shown: 5`, `omitted: 1`). This proves the remaining defect is not JSON ambiguity: Haiku is rewriting an authoritative numeric field while narrating it, sometimes substituting a displayed/selected subset (`shown`/`items.length`) for `total`, and sometimes producing a number that matches neither.

### Why another Skill/prompt-hardening iteration was rejected

Prompt-only correctness has already failed twice on this exact defect class (§9, §10), and docs/17 §2 records the same pattern for `work-review` generally: added prohibitions did not change behavior in three prior rounds. Canonical docs/21 §10 anticipates exactly this outcome and names the fallback: **a deterministic fact skeleton, where the tool itself renders every quantitative claim into text, and Haiku adds at most a small conversational layer.** That is implemented here instead of a fourth wording iteration.

### New deterministic fact-skeleton contract

`trelloWorkHistory.ts` keeps its existing action-history extraction, Kyiv week/DST arithmetic, and per-card net-transition collapsing unchanged. What changed is the **model-facing return shape**:

```ts
export interface WorkHistoryFactSkeleton {
  window: { from: string; to: string; label: string };
  scope: { kind: "board" } | { kind: "project"; label: string };
  coverage: HistoryCoverage;
  fact_lines: string[];
}
```

`fact_lines` is a flat array of already-rendered Ukrainian sentences. There is no parallel numeric field (no `total`, `shown`, `omitted`, or `items` reaching the model) for a count to conflict with — the exact defect class in both live failures. The former per-category `{total, total_kind, shown, omitted, items}` shape (`WorkHistoryCategory`/`WorkHistoryCategories`) is retained **internally only**, exported solely for tests/debugging (`buildWorkHistoryCategories`), and is never sent to the model. The illustrative contract in the governing instructions also sketched a separate `examples` array; that field was deliberately dropped in favor of folding every named example into `fact_lines` as its own sentence, per the same instructions' fallback license ("if exposing both structured categories and fact_lines would again invite conflicting interpretation, prefer sending only the minimum fact skeleton required for narration") — a second numeric-bearing array is exactly the risk being removed.

Per category, code renders:
- one **total sentence** stating the authoritative count with correct Ukrainian one/few/many agreement (e.g. `"У Done перейшло 4 події."`, `"Створено 6 карток."`);
- one **named-example sentence** per shown item, with Kyiv date/time, a repeated-occurrence suffix when `occurrences > 1`, and the card's current due date when present;
- when `omitted > 0`, one **overflow sentence** stating the omitted amount as its own fact (e.g. `"Ще 2 переміщення не перелічені в короткому огляді."`), never left for the model to compute as `total − items.length`.

Event-vs-card semantics are encoded in the sentence's noun, not a side channel: `reached_done`/`returned_from_done` use "подія/події/подій" (event occurrences), `created`/`archived`/`moved` use "картка/картки/карток" (cards). An incomplete-coverage caveat is appended as its own sentence only when `coverage.truncated` or `!coverage.oldestActionReached`; complete coverage adds nothing. If a scope has no activity and coverage is complete, the skeleton falls back to one sentence, `"За цей період суттєвих змін не зафіксовано."`, so the model is never handed an empty array.

### Example output for both observed live failures

**Fixture A (first failure — `docs/27` §5, `moved.total: 7`, `shown: 5`):**

```text
"Між іншими списками переміщено 7 карток."
"«Рух 1» перейшла Backlog → This week — пн 23.03, 03:00."
"«Рух 2» перейшла Backlog → This week — пн 23.03, 04:00."
"«Рух 3» перейшла Backlog → This week — пн 23.03, 05:00."
"«Рух 4» перейшла Backlog → This week — пн 23.03, 06:00."
"«Рух 5» перейшла Backlog → This week — пн 23.03, 07:00."
"Ще 2 переміщення не перелічені в короткому огляді."
```

**Fixture B (second failure — `docs/27` §10 T2, `reached_done.total: 4`, `created.total: 6`/`shown: 5`/`omitted: 1`):**

```text
"У Done перейшло 4 події."
"У Done перейшла «Завершення 1» — ..."
"У Done перейшла «Завершення 2» — ..."
"У Done перейшла «Завершення 3» — ..."
"У Done перейшла «Завершення 4» — ..."
"Створено 6 карток."
"Створено «Нова картка 1» — ..."
"Створено «Нова картка 2» — ..."
"Створено «Нова картка 3» — ..."
"Створено «Нова картка 4» — ..."
"Створено «Нова картка 5» — ..."
"Ще 1 картка не перелічена в короткому огляді."
```

In both fixtures, the number Haiku must narrate for "how many" is already written into a complete sentence; there is no `items.length` or `shown` value beside it to substitute.

### What remains Claude-owned vs deterministic

Deterministic (code): action extraction, net-transition collapse, Kyiv week/DST boundaries, per-card due formatting, category totals, named-example selection and its concise/detailed cutoff, the omitted-example sentence, the incomplete-coverage sentence, the zero-activity fallback sentence, and all Ukrainian number agreement.

Claude-owned: deciding to call `trello_work_history` and with which window/scope/`response_format`; ordering and lightly connecting the given `fact_lines` into 2–4 Ukrainian sentences; adding at most one brief introductory or concluding sentence; combining the answer with an accepted Memory plan (plan-side comparison only, per the existing Skill boundary); routing Project Health/task-management questions elsewhere; and reporting a tool error or unavailable history honestly.

### Concise / detailed behavior

Concise (default): each category is capped at 5 named examples; a non-zero remainder produces exactly one deterministic overflow sentence per category, never per item. Detailed: every item is named (`shown === total`, `omitted === 0` internally), so no category emits an overflow sentence.

### Coverage wording

One deterministic sentence, `"Історія за цей період може бути неповною: частину дій не вдалося прочитати повністю."`, is appended only when the internal `coverage.truncated` is true or `coverage.oldestActionReached` is false. Complete coverage adds no sentence, matching the "omit zero/irrelevant categories" requirement.

### Reopen / re-Done handling

Unchanged in substance from §7/§9: a card that left and re-reached Done within the window still contributes to both `reached_done` and `returned_from_done`, and a repeated reached-Done/returned-from-Done event on the same card renders as one named sentence with an `(N разів)`-style occurrence suffix rather than duplicate lines.

### Skill v2 update

`.claude/skills/work-review/SKILL.md` replaced its `total`/`total_kind`/`shown`/`omitted`/`items.length` language with: treat `fact_lines` as authoritative, preserve their content, reorder or lightly connect them, add at most one brief sentence, but never recompute, rephrase into a different number, or drop a quantitative claim; don't infer a total from how many named examples appear. The file stays thin at 2,087 bytes (limit 3,072), with no added list of prohibitions beyond the one existing paragraph.

### Files changed

| File | Change |
|---|---|
| `src/trelloWorkHistory.ts` | Model-facing return shape is now `WorkHistoryFactSkeleton` (`window`/`scope`/`coverage`/`fact_lines`); added `buildWorkHistoryCategories` (internal/debug), `renderCategoryFactLines`, Ukrainian one/few/many pluralization, and `buildWorkHistoryFactSkeleton` (renamed from `buildWorkHistoryDigest`). `TrelloWorkHistoryClient.execute` returns the fact skeleton. |
| `src/trelloWorkHistory.test.ts` | Replaced category-shape assertions with fact-line assertions; added the two required failure-reproduction fixtures, a zero-activity fallback test, and a detailed-mode/no-overflow test. Existing window/paging/credential tests are unchanged. |
| `.claude/skills/work-review/SKILL.md` | Points the coordinator at `fact_lines` as the authoritative narration source instead of `total`/`total_kind`/`shown`/`omitted`. |
| `src/workReviewContract.test.ts` | Added one assertion that the Skill references `fact_lines`/"authoritative" and forbids recomputing a different number; existing assertions are unchanged and still pass. |
| `src/djonikClient.ts`, `src/djonikClient.test.ts`, `src/turnCompletion.test.ts` | Not changed. The Session client only forwards `JSON.stringify(await client.execute(...))` as an opaque string; it has no dependency on the digest's internal field names. |

### Focused test results

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/workReviewContract.test.ts
18 passed, 0 failed

node --import tsx --test src/djonikClient.test.ts src/turnCompletion.test.ts
174 passed, 0 failed
```

### Full test result

```text
npm test
453 passed, 0 failed, 0 skipped, 0 cancelled
```

### Typecheck and diff check

```text
npm run typecheck
passed

git diff --check
passed (only non-fatal CRLF warnings, same as every prior report in this file)

git status --short
 M .claude/skills/work-review/SKILL.md
 M src/trelloWorkHistory.test.ts
 M src/trelloWorkHistory.ts
 M src/workReviewContract.test.ts
```

### Remaining next step

No paid inference occurred in this iteration; both prior live candidates (§9 first failure, §10 second failure) remain failed historical evidence and are not superseded by this source-only change. The next step is a **new isolated live candidate**, built from this fact-skeleton source, **only after Product Lead acceptance** of this remediation and separate Product Owner authorization of the paid run under docs/04 §27 (declared ceiling, session count, expected evidence, stop condition before the first Session is created). No production promotion, roadmap update, issue closure, commit, or push occurred in this iteration.

## 12. Fact-skeleton fail-fast diagnostic

Date: 2026-09-22. Single fail-fast diagnostic against the deterministic fact-skeleton commit under a fresh, separately declared authorization: **max $0.12 total list cost, 1 paid Managed Session, 1 visible paid user turn.** This is explicitly not the full #36 live gate; it answers only whether the fact-skeleton shape (§11) fixes the count-narration defect that failed both prior candidates.

### 1. Commit under test

`744be2283580a257319004311e890e85c410859c` — *fix: render work history facts deterministically*. Confirmed as `HEAD` and as an ancestor of `HEAD` before any paid call; working tree was clean.

### 2. New candidate identity/config (frozen before the paid turn, read back unmodified after)

| Item | Frozen value |
|---|---|
| Candidate Agent / version | `agent_01QiZTseJY6HnixDsBhRgwTU` / 1 |
| Candidate model | `claude-haiku-4-5-20251001`, `standard` |
| Coordinator system identity | SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` — byte-identical to production's current system prompt |
| Coordinator Skills (pinned, not `latest`) | `task-management` `skill_01WS6JtY1GMu3rGZaKCVR9w1` / `skver_012fLb9ZFpL4mjqybAZ7KtmU`; `daily-planning` `skill_01G9DtQEzPYxgw78riFh8k99` / `skver_01TDfMCnuv5LkQN4WvtwBzXW`; `weekly-planning` `skill_01PTmbvLHJj1HuUxvDKhpaiE` / `skver_018soRHmcAn6onE8DpHScFbf`; `studio-intake` `skill_015c8dtDnWyDfVLwS6NLS7r6` / `skver_018sJv1GCnzfZRG4NbExbAzj` — the same four skill IDs/versions production currently resolves to |
| Candidate work-review Skill (new, isolated) | `skill_01TLh4QoBJ3sBUkxZqxRwas6` / `skver_01VfBuhWijBmExjzDqhiz2w9`; committed-body SHA-256 `67056dce7ff544424276ba674ce192f7c82d6d253492c172fc9823cb49248083` (2,087 bytes) — matches the exact `.claude/skills/work-review/SKILL.md` body at `744be22`. A minimal `---`-fenced YAML frontmatter (`name`/`description` only, taken from this Skill's own already-known one-line description) was prepended **only in the uploaded artifact**, because the Skill upload API requires frontmatter that this repo file (unlike its four siblings) does not carry in-repo; the hashed/measured body is the unmodified committed text |
| Project Health roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM`, pinned version 4 — identical to production's roster |
| Custom tool | `trello_work_history`; input-schema SHA-256 `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921` — identical to both prior candidates' schema hash (§4, §10), confirming only the tool's *return shape*, not its input contract, changed at `744be22` |
| Memory | production `Djonik Memory`, attached `read_only` |
| Permissions | Trello read surface only; **every** `trelloWrite*` tool, including `trelloWriteCard`, explicitly `enabled:false`; Calendar toolset `enabled:false` (unchanged from production, which already excludes it) |

The candidate was created via the official `client.beta.agents.create()` API from a full read-back copy of production's `tools`/`mcp_servers`/`system`/`model`/`multiagent`, with only the two declared changes (five Trello writes → six, including `trelloWriteCard`, forced to `enabled:false`; one custom tool and one additional Skill appended). No source file was edited to run this diagnostic.

### 3. Proof the previous candidates remain untouched

Read directly from the API immediately before candidate creation:

| Candidate | id | version | `updated_at` |
|---|---|---|---|
| First failed candidate (§4–§9) | `agent_01EeGJTjuKWZa3LuRaHBjj8k` | 1 (unchanged) | `2026-09-22T09:17:17.156563Z` |
| Second failed candidate (§10) | `agent_01G9i5vhv4oNcp14rXyvTyRc` | 1 (unchanged) | `2026-09-22T09:56:40.493927Z` |

Neither was retrieved for any purpose beyond this read-only check; neither was updated, reused, or referenced by the new candidate.

### 4. Proof production is unchanged

`client.beta.agents.retrieve()` on `agent_01WGRHDBjQa3eMhoGJMmQ1dh` immediately before candidate creation returned **version 21**, model `claude-haiku-4-5-20251001` / `standard`, and system SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` — identical to every prior report in this file. No Agent, Skill, Session, Memory, Trello, Calendar, or vault configuration was modified before, during, or after this diagnostic.

### 5. Exact user prompt

```
А минулого тижня по Extract? Теж коротко.
```

Sent exactly once, as the single `user.message` of Session `sesn_01Jpx15JmdZQc1RaoHB1nkUt`.

### 6. Exact custom-tool input

Blocking event `sevt_011qppB4yy3v6DG25Q53puhQ` (`agent.custom_tool_use`, tool `trello_work_history`):

```json
{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"}}
```

Correct project (Extract), correct window (last week, matching "минулого тижня"), correct format.

### 7. Exact `fact_lines` (verbatim, from the real `TrelloWorkHistoryClient.execute()` result — live Trello REST GETs, zero mutation)

```json
{
  "window": {"from": "пн 14.09, 00:00", "to": "пн 21.09, 00:00", "label": "Минулий тиждень"},
  "scope": {"kind": "project", "label": "Extract"},
  "coverage": {"pagesRead": 1, "truncated": false, "oldestActionReached": true},
  "fact_lines": [
    "У Done перейшло 4 події.",
    "У Done перейшла «Кохаю пінка» — пн 14.09, 09:57, due пн 14.09, 13:00.",
    "У Done перейшла «Білі аромати 3D відео» — вт 15.09, 15:06, due пн 14.09, 18:00.",
    "У Done перейшла «Автоматизація рендеру» — ср 16.09, 16:08, due пт 18.09, 20:00.",
    "У Done перейшла «Коментарі по пінкам» — пт 18.09, 16:23.",
    "Із Done повернулося 2 події.",
    "Із Done повернулася «Білі аромати 3D відео» — пн 14.09, 10:00, due пн 14.09, 18:00.",
    "Із Done повернулася «Коментарі по пінкам» — сб 19.09, 08:31.",
    "Створено 6 карток.",
    "Створено «Білі аромати 50 ML» — вт 15.09, 15:06.",
    "Створено «Автоматизація рендеру» — вт 15.09, 17:46, due пт 18.09, 20:00.",
    "Створено «Чорні аромати 100 ML» — пт 18.09, 10:31.",
    "Створено «Флакони 7.5 ML» — пт 18.09, 10:33.",
    "Створено «Флакони 1.5 ML» — пт 18.09, 10:35.",
    "Ще 1 картка не перелічена в короткому огляді.",
    "Між іншими списками переміщено 5 карток.",
    "«Міні-парфуми адаптація» перейшла This week → This week — пт 18.09, 10:25.",
    "«Білі аромати 50 ML» перейшла Backlog → Backlog — ср 16.09, 16:08.",
    "«Брендбук» перейшла This week → Backlog — ср 16.09, 11:50, due пт 25.09, 18:00.",
    "«Чорні аромати 100 ML» перейшла Backlog → In progress — сб 19.09, 08:31.",
    "«Флакони 1.5 ML» перейшла Backlog → This week — пт 18.09, 14:46."
  ]
}
```

Not summarized before grading; reproduced verbatim above from the exact `user.custom_tool_result` content sent back.

### 8. Exact final visible answer

```
**Extract минулий тиждень:**

- **Done:** 4 картки (включно «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру», «Коментарі по пінкам»)
- **Повернулося з Done:** 2 («Білі аромати 3D відео» та «Коментарі по пінкам» — потребували правок)
- **Нові:** 6 карток (флакони, чорні/білі аромати, адаптація)
- **Рухи:** 5 карток по списках (більшість — із Backlog у This week чи In progress)

Тиждень був активний: формально замкнули 4 завдання, але двох довелося повернути на доробку. Добавили ресурсів на наступні елементи.
```

### 9. Side-by-side factual grading

| Fact-line claim | Visible answer | Verdict |
|---|---|---|
| 4 reached-Done events, 4 named cards | "Done: 4 картки", same 4 names | **Pass** — count preserved, no substitution of a subset for a total |
| 2 returned-from-Done events, 2 named cards | "Повернулося з Done: 2", same 2 names | **Pass** on the number and names, but adds an unsupported reason: **"потребували правок" ("needed corrections")**. No `fact_lines` entry states why a card left Done. This is an invented causal claim, not a quantitative one, but it does add a factual-sounding claim the digest never made |
| 6 created cards, 5 shown + 1 explicitly omitted | "Нові: 6 карток (флакони, чорні/білі аромати, адаптація)" | **Count pass**, but **critical content fail**: "адаптація" matches no created-card name in `fact_lines`. The only card in the entire digest containing "адаптація" is **«Міні-парфуми адаптація»**, which appears exclusively in the **moved** category (`This week → This week`). The answer misattributes a moved card's name fragment into the created-cards description — an invented/changed transition, not merely a paraphrase |
| 5 moved cards, all 5 named, no omission line | "Рухи: 5 карток по списках (більшість — із Backlog у This week чи In progress)" | **Count pass**, but **critical directional fail**: of the 5 named moves, only 2 (`Чорні аромати 100 ML`: Backlog→In progress; `Флакони 1.5 ML`: Backlog→This week) match "Backlog → This week/In progress". The other 3 do not (`This week→This week`, `Backlog→Backlog`, and **«Брендбук»: This week → Backlog — the reverse direction**). Calling 2-of-5 a "majority" and folding in a card that moved backward as if it supported the same forward trend is an invented characterization not derivable from, and partly contradicted by, the fact lines |
| (no such claim in `fact_lines`) | "Тиждень був активний... Добавили ресурсів на наступні елементи" | Vague, unsupported productivity-style framing; not a quantitative error but the kind of interpretive filler `work-review` v2 asks Djonik not to add |

No date/time was altered, no count was recomputed to a wrong number, and no actor attribution to Daniel occurred — the three defect classes from the two prior live failures (§9, §10) did **not** recur. But two independent fact-content errors did occur: a card's true category was swapped (moved → misdescribed as created), and a real transition's direction was effectively reversed inside an invented "majority" generalization.

### 10. `agent.custom_tool_use` / `user.custom_tool_result` correlation

- Blocking use: `sevt_011qppB4yy3v6DG25Q53puhQ` (`agent.custom_tool_use`, `trello_work_history`), `session_thread_id: null`.
- `session.status_idle` → `stop_reason: {"type":"requires_action","event_ids":["sevt_011qppB4yy3v6DG25Q53puhQ"]}`.
- Result submitted as `user.custom_tool_result` with `custom_tool_use_id: "sevt_011qppB4yy3v6DG25Q53puhQ"` (exact match, never `session_thread_id`); provider-assigned id of that submission: `sevt_015rQWhLAiGiU6F9twnjm7kE`.
- Final visible message: `sevt_019RBpypdnLW4CdiS8zRdwAY` (`agent.message`).

### 11. `end_turn` evidence

`session.status_idle` → `stop_reason: {"type":"end_turn"}` immediately after the final `agent.message`. Exactly one `requires_action` pause occurred, resolved by exactly one correlated result; no retry, no second tool call, no budget pause.

### 12. Zero-write evidence

The candidate's `trelloWriteCard` and every other `trelloWrite*` tool were `enabled:false` at the tool-configuration level (not merely denied by permission policy), Calendar was `enabled:false`, and Memory was mounted `read_only`. The full event log contains exactly one tool interaction: the single `trello_work_history` custom-tool round trip. No MCP tool-use event, no write, and no Memory-write event occurred.

### 13. Deliberate cost

Authoritative cumulative Session usage after `end_turn` (`client.beta.sessions.retrieve()`): `input_tokens: 15`, `cache_creation.ephemeral_5m_input_tokens: 18,840`, `cache_read_input_tokens: 17,711`, `output_tokens: 597`, **`list_cost: $0.03`**. This is the total deliberate spend for this diagnostic — within the declared $0.12 ceiling, using 1 of 1 authorized paid Session and 1 of 1 authorized visible paid turn.

### 14. Result

**FAIL — fact-skeleton diagnostic.**

The deterministic fact-skeleton (`744be22`) fixed the specific defect class that failed both prior candidates: every quantitative total (4 reached-Done, 2 returned-from-Done, 6 created, 5 moved) was narrated correctly, with no total/subset conflation and no invented count. That is real, measured progress. However, this run surfaces a **new** defect class the fact-skeleton does not address: Haiku's own conversational compression can still swap a card between categories (moved → misdescribed as created) and construct an unsupported directional generalization ("majority… Backlog → This week/In progress") that a named transition (`Брендбук`, moving the opposite way) contradicts, plus an invented reason for a Done-return. Per the acceptance criteria's critical-fail list ("a transition is invented or changed"; "no new quantitative claim may be invented"; "Haiku must not alter the literal factual meaning"), this is a critical fail, not a cosmetic one.

### 15. No second paid turn

Exactly one visible paid turn was sent in exactly one paid Session, as authorized. No second prompt, no retry, no follow-up question, and no additional Session were sent or created. The run stopped after grading this single turn, per the fail-fast design of this diagnostic.

### Local checks

```text
npm test
453 passed, 0 failed, 0 skipped, 0 cancelled

npm run typecheck
passed

git diff --check
passed

git status --short
(clean before this report's own edit)
```

No source change was made or is proposed by this diagnostic. No commit, push, deploy, production configuration change, roadmap update, or issue close occurred.

## 13. Semantic-compression remediation — deterministic `answer_text` (source-only)

Date: 2026-09-22. This is a **source-only** iteration after candidate #3's FAIL (§12). No Managed Agent inference, candidate creation, Trello request, remote configuration change, commit, push, deploy, or issue close was performed. Candidate #3's FAIL verdict in §12 is **not rewritten or reopened** — it stands as historical evidence, same as candidates #1 (§4–§9) and #2 (§10).

### What candidate #3 proved

The deterministic fact skeleton (`744be22`) fixed the exact numeric defect that failed candidates #1 and #2: every authoritative total (4 reached-Done, 2 returned-from-Done, 6 created, 5 moved) was narrated correctly, with no total/subset conflation. That confirms the count-narration fix works.

### What candidate #3 exposed

Candidate #3 also proved that fixing the *numbers* was not sufficient. Its `fact_lines` contract still handed Claude 15–25 already-correct-but-separate sentences (one total line, several named-Done lines, several named-returned lines, several named-created lines, several named-moved lines, overflow lines) for a question the user asked "коротко" (briefly). Producing a short answer from that still required Claude to perform **factual compression** — deciding what to keep, what to drop, and how to connect it — and that compression step, not arithmetic, is where it invented new claims:

- misdescribing the moved card «Міні-парфуми адаптація» as created;
- generalizing an unsupported "majority Backlog → This week/In progress" direction that «Брендбук» (This week → Backlog) contradicts;
- inventing "потребували правок" as a reason for the Done-returns;
- adding unsupported productivity/trend framing.

None of these were numeric errors, so the fact-skeleton's own fix (rendering every count into text) could not and did not prevent them. The measured root cause is that **concise summarization/compression, not arithmetic, was still Claude's job**, and asking Claude to compress correct facts is exactly where it started fabricating.

### New model-facing contract

`WorkHistoryFactSkeleton` (`window`/`scope`/`coverage`/`fact_lines: string[]`) is replaced by `WorkHistoryAnswer`:

```ts
export interface WorkHistoryAnswer {
  window: { from: string; to: string; label: string };
  scope: { kind: "board" } | { kind: "project"; label: string };
  coverage: HistoryCoverage;
  answer_text: string;
}
```

`answer_text` is not a list of facts — it is the **already-complete, ready-to-send Ukrainian review**. There is no parallel category array, total/shown/omitted field, named-example array, or flat fact-line list in the model-facing result for either `concise` or `detailed` mode. `buildWorkHistoryCategories` and `renderCategoryFactLines` remain as internal, exported-for-tests helpers (per docs/28's own precedent), but neither reaches `TrelloWorkHistoryClient.execute()`'s return value; `answer_text` is built from them entirely inside `src/trelloWorkHistory.ts` before the custom-tool result is ever serialized.

### Exact example `answer_text` for the docs/27 §12 live fixture

Reconstructing the exact facts behind §12 (`reached_done`: 4 events/4 cards; `returned_from_done`: 2 events/2 cards; `created`: 6 cards; `moved`: 5 cards, including one card moving This week → Backlog) through the new renderer produces (see the regression fixture in §5 below for the exact reproduction, built from a synthetic action history matching these totals):

```
За період <window> по Extract на дошці в Done перейшло 4 події, 2 події повернулося з Done, створено 6 карток та ще 5 карток перемістилися між іншими списками. У Done перейшли «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам». Із Done повернулися «Білі аромати 3D відео» та «Коментарі по пінкам». У короткому огляді перелічено не всі створені картки.
```

Four sentences. Every stated number is authoritative. No moved card is named (so «Міні-парфуми адаптація» cannot be misdescribed as created — it structurally never appears). No direction/majority is stated for `moved` (so «Брендбук»'s real backward move cannot be contradicted — it is never mentioned). No reason is given for the Done-returns. No productivity/trend language is added.

### Concise rendering rules (deterministic, in `src/trelloWorkHistory.ts`)

1. **One opening sentence** states every non-empty category's authoritative total, combined with commas and a final "та" — never one standalone sentence per category, so a busy week cannot by itself inflate the sentence count.
2. **One sentence names `reached_done` cards** (if any), and **one sentence names `returned_from_done` cards** (if any) — using the same already-capped (≤5) `items` list `buildWorkHistoryCategories` already produces for concise mode; correct singular/plural verb selection is based on how many cards are actually named, and any `omitted` count is folded into the same sentence as `(ще N)` rather than a new sentence.
3. **`created` and `archived` cards are never individually named** in a concise answer. If either has a non-zero total, **one shared caveat sentence** says their cards were not listed by name (`"У короткому огляді перелічено не всі {створені|архівовані|створені та архівовані} картки."`).
4. **`moved` cards are never individually named and never given a caveat.** Only their total is stated, in the opening sentence. No direction, trend, or majority claim is computed or rendered for `moved`, anywhere — because no such fact exists in the deterministic data (docs/29's explicit non-goal), so there is nothing for Claude to see and no invented generalization is even representable in the output.
5. The existing incomplete-coverage sentence and the zero-activity fallback sentence are appended exactly as before (§11), after the above.
6. Typical output is 1–4 sentences (2–4 in a normal active week; 1 for a quiet week; the coverage caveat can occasionally add a 5th when history genuinely was incomplete, which is treated as more important than strict length).

### Detailed rendering rules

`response_format: "detailed"` still returns a deterministic `answer_text`, reusing the existing `renderCategoryFactLines` computation unchanged: every category's total plus every named item (with Kyiv date/time, occurrence and due suffixes), joined into one string. No item is omitted and no overflow sentence is ever needed in detailed mode, matching prior (§9/§11) behavior. The only change from the prior fact-skeleton shape is that this text is now the single `answer_text` field rather than a `fact_lines` array.

### Named-example selection rule

Deterministic code chooses which cards are named, in which order, for every mode — Claude is never handed a list to pick from. Concise mode reuses the same ≤5-item, first-N-in-history-order selection `buildWorkHistoryCategories` already applied; detailed mode names every item. This is unchanged from docs/28's existing policy — only where that selection is turned into prose (inside the tool, once, instead of per-line for Claude to re-assemble) has changed.

### What Claude still owns

- deciding whether to call `trello_work_history` at all;
- choosing `window` (this/last/explicit) and `scope` (board/project label);
- choosing `concise` vs `detailed`;
- ordinary conversational framing around the call (e.g. acknowledging the question);
- handling a tool error or unavailable-history result honestly;
- routing Project Health or an explicit task action to their own existing paths instead of treating a work-review answer as either.

### What deterministic code now owns

Everything that is a factual claim about Trello history: category totals, event-vs-card semantics, category assignment (so a moved card cannot be relabeled as created), named-example selection and ordering, the omitted-count wording, the unnamed-category caveat, movement (net transition per card, never a direction/trend summary), reopen/re-Done event counting, Kyiv date/time formatting, the incomplete-coverage caveat, the zero-activity fallback, and all Ukrainian grammar/pluralization needed to render any of the above. For a successful call, **Claude performs no factual summarization, categorization, or generalization arithmetic on work-history content** — it relays `answer_text`.

### Files changed

| File | Change |
|---|---|
| `src/trelloWorkHistory.ts` | Replaced the model-facing `WorkHistoryFactSkeleton`/`fact_lines` contract with `WorkHistoryAnswer`/`answer_text`. Added `joinUkrainianList`, `TOTAL_CLAUSE`, `temporalPhrase`, `scopePhrase`, `buildOpeningSentence`, `NAMED_SENTENCE`, `buildNamedSentence`, `UNNAMED_CAVEAT_LABEL`, `buildUnnamedCaveatSentence`, `buildConciseAnswerText`, and `buildDetailedAnswerText`. Renamed `buildWorkHistoryFactSkeleton` to `buildWorkHistoryAnswer`; `TrelloWorkHistoryClient.execute()` now returns `WorkHistoryAnswer`. `buildWorkHistoryCategories` and `renderCategoryFactLines` are unchanged and remain exported for tests/debugging only. |
| `src/trelloWorkHistory.test.ts` | Replaced `fact_lines`-shaped assertions with `answer_text`-shaped assertions; added a fixture reproducing the exact docs/27 §12 live-failure facts (adaptation-card misattribution, backward-moving `Брендбук`, invented reasons, productivity framing) and asserting none of it can appear. Existing window/paging/credential/DST/noise-suppression tests are unchanged in intent, updated only to the new contract's shape. |
| `.claude/skills/work-review/SKILL.md` | Points the coordinator at `answer_text` as an already-complete answer to relay, not a list to summarize/categorize/generalize/reason about. No new prohibition list; the Skill stays one short paragraph longer than before, still well under the 3 KB budget. |
| `src/workReviewContract.test.ts` | Replaced the `fact_lines`-authoritative assertion with an `answer_text`-already-complete assertion; historical rubric/helper tests are unchanged. |
| `src/djonikClient.ts` | **Not changed**, per this iteration's explicit boundary. It only forwards `JSON.stringify(await client.execute(...))` as an opaque string and has no dependency on the digest's internal field names, so no client change was needed or made. |

### Focused test results

```text
node --import tsx --test src/trelloWorkHistory.test.ts src/workReviewContract.test.ts
19 passed, 0 failed

node --import tsx --test src/djonikClient.test.ts src/turnCompletion.test.ts
174 passed, 0 failed
```

### Full test result

```text
npm test
454 passed, 0 failed, 0 skipped, 0 cancelled
```

### Typecheck and diff check

```text
npm run typecheck
passed

git diff --check
passed (only non-fatal CRLF warnings)

git status --short
 M .claude/skills/work-review/SKILL.md
 M src/trelloWorkHistory.test.ts
 M src/trelloWorkHistory.ts
 M src/workReviewContract.test.ts
```

### Explicit next step

No paid inference occurred in this iteration. The next step is **one isolated Haiku diagnostic** against this deterministic-`answer_text` source, built as a fresh, separately frozen candidate (not a reuse or modification of candidates #1, #2, or #3) — **only after Product Lead acceptance of this remediation and separate Product Owner authorization** of the paid run under docs/04 §27 (declared cost ceiling, session count, expected evidence, and stop condition, all declared before the first Session is created). No candidate was created, no production configuration was changed, and no commit, push, or issue close occurred in this iteration.

## 14. Final current-strategy diagnostic — commit cee0e2c

Date: 2026-09-22. **This is the declared final fail-fast diagnostic of the current #36 strategy**, run under an explicit Product-Lead stop rule: if this candidate produces any substantive factual/semantic failure that would require another Skill rule, result-shape change, deterministic rendering layer, client guard, or similar local remediation, #36 implementation work stops and a fundamental architecture audit is required instead of a fourth local fix.

### 1. Stop-rule context (declared before the paid turn)

Per the Product Lead's instruction for this iteration: a substantive failure here is not to be met with another Skill edit, another `trelloWorkHistory.ts` change, a `djonikClient.ts` guard, exact-deterministic-relay design, or a fourth candidate. It is to be recorded as exhaustion of the current local-remediation strategy, with the next step being an independent architecture audit — not performed in this iteration.

### 2. Commit under test

`cee0e2ca05f4f97ca3384da7dbf2d7d012640dcd` — *fix: render concise work review answer deterministically*. Confirmed as `HEAD` before any paid call; working tree was clean; `npm test` (454/454), `npm run typecheck`, and `git diff --check` all passed pre-diagnostic.

### 3. New candidate identity/config (frozen before the paid turn, read back unmodified after)

| Item | Frozen value |
|---|---|
| Candidate Agent / version | `agent_01KSpwh2WJyKQEMcMXAmxtMm` / 1 |
| Candidate model | `claude-haiku-4-5-20251001`, `standard` |
| Coordinator system identity | SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` — byte-identical to production's current system prompt |
| Coordinator Skills (pinned, not `latest`) | `task-management` `skill_01WS6JtY1GMu3rGZaKCVR9w1` / `skver_012fLb9ZFpL4mjqybAZ7KtmU`; `daily-planning` `skill_01G9DtQEzPYxgw78riFh8k99` / `skver_01TDfMCnuv5LkQN4WvtwBzXW`; `weekly-planning` `skill_01PTmbvLHJj1HuUxvDKhpaiE` / `skver_018soRHmcAn6onE8DpHScFbf`; `studio-intake` `skill_015c8dtDnWyDfVLwS6NLS7r6` / `skver_018sJv1GCnzfZRG4NbExbAzj` — the same four skill IDs/versions production currently resolves to |
| Candidate work-review Skill (new, isolated) | `skill_01NtqV4kfsZsCeBEDPJ45JxE` / `skver_01Rin3rEGhMKzbkRwMbLWLhK`; committed-body SHA-256 `e00863e3d6e99f749dfef04362f8138a6eaeef41648ba23d50f5d874da8f588e` (1,908 bytes) — matches the exact `.claude/skills/work-review/SKILL.md` body at `cee0e2c` |
| Project Health roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM`, pinned version 4 — identical to production's roster |
| Custom tool | `trello_work_history`; input-schema SHA-256 `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921` — identical to candidates #1–#3, confirming only the tool's return shape changed at `cee0e2c`, not its input contract |
| Memory | production `Djonik Memory`, attached `read_only` |
| Permissions | Trello read surface only; **every** `trelloWrite*` tool, including `trelloWriteCard`, explicitly `enabled:false`; Calendar toolset `enabled:false` |

Created via `client.beta.agents.create()` from a fresh read-back of production's `tools`/`mcp_servers`/`system`/`model`/`multiagent`, with the same two declared changes as prior candidates (six Trello writes forced `enabled:false`; one custom tool and one new isolated Skill appended). No source file was edited to run this diagnostic.

### 4. Proof the three previous candidates remain untouched

Read directly from the API immediately before this candidate's creation:

| Candidate | id | version | `updated_at` |
|---|---|---|---|
| #1 (§4–§9) | `agent_01EeGJTjuKWZa3LuRaHBjj8k` | 1 (unchanged) | `2026-09-22T09:17:17.156563Z` |
| #2 (§10) | `agent_01G9i5vhv4oNcp14rXyvTyRc` | 1 (unchanged) | `2026-09-22T09:56:40.493927Z` |
| #3 (§12) | `agent_01QiZTseJY6HnixDsBhRgwTU` | 1 (unchanged) | `2026-09-22T10:32:02.945050Z` |

None was retrieved for any purpose beyond this read-only check; none was updated, reused, or referenced by the new candidate.

### 5. Proof production is unchanged

`client.beta.agents.retrieve()` on `agent_01WGRHDBjQa3eMhoGJMmQ1dh` immediately before candidate creation returned **version 21**, model `claude-haiku-4-5-20251001` / `standard`, and system SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` — identical to every prior report in this file. No Agent, Skill, Session, Memory, Trello, Calendar, or vault configuration was modified before, during, or after this diagnostic. The official Managed Agents SDK/API (`@anthropic-ai/sdk` 0.125, beta `managed-agents-2026-04-01`) resolved every call normally; no incompatibility was encountered.

### 6. Exact user prompt

```
А минулого тижня по Extract? Теж коротко.
```

Sent exactly once, as the single `user.message` of Session `sesn_01Kb2RGMiMXsG8a3b4CBwDmY`.

### 7. Exact custom-tool input

Blocking event `sevt_01DYc6LjYstNHAAQx3h9BDEw` (`agent.custom_tool_use`, tool `trello_work_history`):

```json
{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"}}
```

Correct project, correct window, correct format.

### 8. Exact deterministic `answer_text` (verbatim, from the real live Trello REST GETs, zero mutation)

```json
{
  "window": {"from": "пн 14.09, 00:00", "to": "пн 21.09, 00:00", "label": "Минулий тиждень"},
  "scope": {"kind": "project", "label": "Extract"},
  "coverage": {"pagesRead": 1, "truncated": false, "oldestActionReached": true},
  "answer_text": "Минулого тижня по Extract на дошці в Done перейшло 4 події, 2 події повернулося з Done, створено 6 карток та ще 5 карток перемістилися між іншими списками. У Done перейшли «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам». Із Done повернулися «Білі аромати 3D відео» та «Коментарі по пінкам». У короткому огляді перелічено не всі створені картки."
}
```

### 9. Exact visible answer (verbatim)

```
Минулого тижня по Extract:
- **Завершено** 4 карти (Кохаю пінка, Білі аромати 3D відео, Автоматизація рендеру, Коментарі по пінкам)
- **Повернулось з Done** 2 карти (Білі аромати 3D і Коментарі по пінкам)
- **Створено** 6 нових карток
- Ще 5 карток перемістилися між списками

Був рух туди-назад по двох картах на відеозйомці та коментарях.
```

### 10. Claim-by-claim comparison

| `answer_text` claim | Visible answer | Verdict |
|---|---|---|
| "в Done перейшло 4 події" + 4 named cards | "Завершено 4 карти" + same 4 names, same order | **Pass on substance.** Unit noun shifted from "події" (events) to "карти" (cards) and the verb from neutral "перейшло" to interpretive "Завершено" ("completed"), but the number and every name are unchanged and no actor is named. Borderline paraphrase, not a factual error. |
| "2 події повернулося з Done" + 2 named cards | "Повернулось з Done 2 карти" + same 2 names (one truncated: "Білі аромати 3D" drops "відео") | **Pass on substance.** Same count, same two cards recognizably named; the dropped word is a trivial truncation, not a different or invented card. |
| "створено 6 карток" | "Створено 6 нових карток" | **Pass.** Same number; "нових" adds no new claim. |
| "ще 5 карток перемістилися між іншими списками" | "Ще 5 карток перемістилися між списками" | **Pass.** Same number and verb; "іншими" dropped without changing meaning. |
| "У короткому огляді перелічено не всі створені картки." (coverage-honesty caveat) | *(absent — no equivalent sentence anywhere)* | **Fail.** The one sentence disclosing that created cards were not individually listed was dropped entirely, not merely reworded. |
| *(no such claim anywhere in `answer_text` — movement direction/pattern is deliberately never computed or stated)* | **"Був рух туди-назад по двох картах на відеозйомці та коментарях."** — an entirely new closing sentence characterizing the two returned-from-Done cards as exhibiting "back-and-forth movement" | **Critical fail.** This is new, unsupported interpretive content with no counterpart in `answer_text`: it reinterprets the two named return-from-Done facts into a pattern/characterization ("рух туди-назад") that the deterministic renderer deliberately never states, for exactly the reason this whole remediation line was built — to prevent Haiku from adding its own gloss on *why* or *how* something moved. It is not a "trivial punctuation/formatting change" and not the one permitted "brief non-factual conversational wrapper" (that allowance requires "no new factual interpretation"); it is a factual-sounding interpretive addition placed at the end of the answer, in the same rhetorical position as candidate #3's "потребували правок" and "тиждень був активний". |

All four required counts (reached-Done, returned, created, moved) were preserved correctly, project/window were correct, and no actor attribution, invented transition, wrong category, or wrong direction occurred. But this run reproduces the **same underlying defect class as candidate #3** — Haiku adding unsupported interpretive/causal framing beyond the deterministic content — through a new concrete instance ("рух туди-назад…") despite `answer_text` now being the complete, ready-to-send answer with nothing left for Haiku to summarize. It also dropped one factual-coverage sentence outright.

### 11. `agent.custom_tool_use` / `user.custom_tool_result` correlation

- Blocking use: `sevt_01DYc6LjYstNHAAQx3h9BDEw` (`agent.custom_tool_use`, `trello_work_history`), `session_thread_id: null`.
- `session.status_idle` → `stop_reason: {"type":"requires_action","event_ids":["sevt_01DYc6LjYstNHAAQx3h9BDEw"]}`.
- Result submitted as `user.custom_tool_result` with `custom_tool_use_id: "sevt_01DYc6LjYstNHAAQx3h9BDEw"` (exact match, never `session_thread_id`); provider-assigned id of that submission: `sevt_01CPSt6N2JziwEx2NgSy6RBm`.
- Final visible message: `sevt_01DZxETGLQRqrrwL9zMzAw3e` (`agent.message`).

### 12. `end_turn` evidence

`session.status_idle` → `stop_reason: {"type":"end_turn"}` immediately after the final `agent.message`. Exactly one `requires_action` pause occurred, resolved by exactly one correlated result; no retry, no second tool call, no budget pause.

### 13. Zero-write evidence

The candidate's `trelloWriteCard` and every other `trelloWrite*` tool were `enabled:false` at the tool-configuration level, Calendar was `enabled:false`, and Memory was mounted `read_only`. The full event log contains exactly one tool interaction: the single `trello_work_history` custom-tool round trip. No MCP tool-use event, no write, and no Memory-write event occurred.

### 14. Deliberate cost

Authoritative cumulative Session usage after `end_turn` (`client.beta.sessions.retrieve()`): `input_tokens: 15`, `cache_creation.ephemeral_5m_input_tokens: 18,365`, `cache_read_input_tokens: 17,711`, `output_tokens: 554`, **`list_cost: $0.03`**. Within the declared $0.12 ceiling, using 1 of 1 authorized paid Session and 1 of 1 authorized visible paid turn.

### 15. Result

**FAIL — current #36 strategy exhausted; fundamental audit required.**

### 16. No second paid turn

Exactly one visible paid turn was sent in exactly one paid Session, as authorized. No second prompt, no retry, no follow-up question, and no additional Session were sent or created.

---

## CURRENT #36 STRATEGY EXHAUSTED — FUNDAMENTAL ARCHITECTURE AUDIT REQUIRED

Per this iteration's explicit Product-Lead stop rule, no further local remediation is proposed or attempted. Recorded for the record:

1. #29 consumed many iterations without delivering reliable work-review.
2. #36 then moved through, in order: authoritative Trello history (spike, GO) → a structured digest with category totals/items → category-local authoritative totals (`total`/`shown`/`omitted`) → deterministic `fact_lines` (every quantitative claim pre-rendered as text) → a fully deterministic, ready-to-send `answer_text` (this commit, `cee0e2c`).
3. Despite progressively removing model reasoning responsibility at every step — arithmetic, then category/total narration, then sentence composition itself — the current Haiku coordinator path still fails the behavioral requirement: this final diagnostic's Haiku candidate appended an unsupported interpretive sentence ("Був рух туди-назад…") not present anywhere in the already-complete deterministic answer, and separately dropped a factual coverage-honesty sentence, even though it had nothing left to compute, summarize, or narrate.
4. Local remediation has reached the agreed stopping point for this iteration. No further Skill rule, JSON/result-shape change, deterministic rendering layer, client guard, post-processing rule, model switch, or new candidate is proposed here.
5. **Next action:** an independent, fundamental architecture audit by a stronger model, covering the full #29 → #36 history, is required before further #36 implementation work continues. That audit is explicitly out of scope for this iteration and was not performed here. It should be free to question, among other things: Haiku coordinator ownership of this capability; whether Managed Agents is the right execution boundary for it; whether custom-tool → model narration is the appropriate pattern even with a fully pre-rendered answer; whether exact deterministic relay (bypassing model narration entirely for this one tool) is actually simpler and more correct; whether Sonnet or another model should own this capability instead; whether work-review belongs in the coordinator at all; whether the current acceptance criteria reflect actual product value; and whether the #29/#36 pattern indicates a broader architecture problem in Djonik beyond this one capability.

### Local checks

```text
npm test
454 passed, 0 failed, 0 skipped, 0 cancelled

npm run typecheck
passed

git diff --check
passed (only non-fatal CRLF warnings)

git status --short
(clean before this report's own edit)
```

No source change was made or is proposed by this diagnostic. No commit, push, deploy, production configuration change, roadmap update, or issue close occurred.
