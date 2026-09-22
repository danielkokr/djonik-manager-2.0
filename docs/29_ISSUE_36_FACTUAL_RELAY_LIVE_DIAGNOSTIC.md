# Issue #36 — factual-relay live diagnostic

Date: 2026-09-22  
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36)  
Commit under test: `d9b349632938bc2475ad9f768a49e7175add90bd`

## 1. Result

**INCONCLUSIVE — additional spend requires Product Owner approval.**

This result was reached before any Managed Agent Session or visible user turn. Therefore the deliberate list cost is **$0.00**; it does not consume the separately authorized maximum of $0.12.

## 2. Preflight

- `docs/02_DEVELOPMENT_ROADMAP.md` still marks #36 as the sole canonical **NOW** item.
- `d9b3496` is `HEAD`; the checkout was clean before this report.
- The GitHub #36 body and its latest Product Owner comment were read. The issue is open; the comment confirms that board events, rather than an actor, must be reported.
- Production was retrieved read-only before any attempted candidate creation: `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, version 21; model `claude-haiku-4-5-20251001` / standard; SHA-256 of the system text `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899`; four accepted coordinator Skills; Project Health `agent_01KNiQDzzPjaMU6LLF4mU6uM` pinned to v4.
- This production retrieval made no change. No candidate from docs/27 was retrieved, modified, or reused.
- The current official Managed Agents documentation was checked. It still specifies the client’s continuation protocol: `agent.custom_tool_use` pauses the Session at `requires_action`; the result is sent by `custom_tool_use_id`; only `end_turn` is an authoritative completion.

## 3. Blocking official-API discrepancy

The frozen-candidate instruction requires the **current committed** `.claude/skills/work-review/SKILL.md` capability. Its committed source begins with a Markdown heading and has no YAML frontmatter.

The current official Skills API rejected the upload before resource creation:

```text
400 invalid_request_error:
`SKILL.md` must be UTF-8 text opening with a `---`-fenced YAML frontmatter mapping
```

An earlier upload attempt also failed before creation because the SDK supplied `SKILL.md` outside the required top-level skill directory. Packaging it as a standard zip bundle resolved the directory shape but exposed the frontmatter requirement above.

This is material: adding frontmatter would change the committed artifact under test; attaching a historical remote work-review Skill would not freeze the current committed #36 capability. The repository agreement requires stopping rather than silently redesigning around a material current official-API discrepancy.

## 4. Candidate / Session / turn evidence

No candidate Agent was created. No new Skill was created. No Session was created. No `user.message`, `agent.custom_tool_use`, `user.custom_tool_result`, `agent.message`, `end_turn`, or user-visible response exists.

Consequently, the exact authorized prompt was **not sent**:

```text
А минулого тижня по Extract? Теж коротко.
```

There is no tool input, deterministic `answer_text`, raw coordinator message, final client-visible response, factual-prefix comparison, separator result, PM-conclusion grade, correlation, or end-turn evidence to grade.

## 5. Production and zero-write evidence

Production remained the read-back configuration stated in §2. Candidate construction never reached the Agent-create request.

No Trello, Calendar, Memory, vault, Agent, Skill, Session, production, deployment, GitHub, or source mutation occurred. The failed API calls were validation-time upload requests rejected before a Skill resource existed.

## 6. Cost and recommendation

Deliberate Managed Agent list cost: **$0.00**.  
Managed Sessions: **0 of 1**.  
Visible paid turns: **0 of 1**.

**Recommendation: inconclusive; return to the Product Lead / Product Owner for an explicit source-only decision on adding the official required Skill frontmatter, followed by a fresh frozen-candidate authorization.** Do not reuse the original authorization to run a different artifact.

## 7. Local checks

```text
git diff --check
passed

git status --short
?? docs/29_ISSUE_36_FACTUAL_RELAY_LIVE_DIAGNOSTIC.md
```

No source file changed. No commit, push, deploy, production promotion, roadmap update, or issue close occurred.

## 8. Source-only API-compatibility remediation

Date: 2026-09-22. This follow-up preserves the **INCONCLUSIVE** preflight result above: no candidate, Session, paid inference, production change, or external Skill upload occurred.

Current official Managed Agents Skill documentation requires a custom Skill to contain a `SKILL.md` with YAML frontmatter. The repository's `work-review` Skill lacked that required metadata, which caused the preflight upload rejection. The source now adds only the required `name: work-review` and descriptive `description` frontmatter; the existing #36 body, factual-output ownership, one-short-PM-commentary rule, and read-only boundaries are unchanged.

The architecture remains untested live. After this source change is committed, the next step remains a **newly authorized** isolated diagnostic using a fresh frozen candidate; the earlier authorization is not reused.

Other repository Skills (`daily-planning`, `project-health`, `studio-intake`, `task-management`, and `weekly-planning`) already have valid YAML frontmatter. They were not changed.

## Live diagnostic after Skill metadata fix

### 1. Result

**FAIL — new factual-output boundary diagnostic.**

The factual prefix happened to equal the deterministic `answer_text` byte-for-byte, but it was not delivered by the intended provenance-based client relay. The provider emitted the same `requires_action` twice for one `agent.custom_tool_use` ID. The current client executed and submitted the same custom-tool result twice, then treated the work-history result as unusable. It returned the raw Haiku message, which combined the factual report and PM commentary without the mandatory separator. This fails the output-ownership/composition boundary.

Exactly **one** paid Session and **one** visible user turn were used. There was no retry, second prompt, or second Session.

### 2. Commits and resolved metadata blocker

- Metadata-fix commit under test: `3e180aed0bf1e21d2552a69944745673a587fcf2`.
- Factual-relay implementation commit: `d9b349632938bc2475ad9f768a49e7175add90bd`.
- Both commits were verified in `HEAD` ancestry before the run.
- The current `work-review` Skill uploaded successfully as `skill_01Qitsv3QzBmuze2m6dphBLx` / `skver_01QTLq6SKMg2EBZnio8KmDjP`, proving the YAML-frontmatter blocker was resolved. Its committed-source SHA-256 was `05805af601c941b54fde83381d73f4a32ae50a76b4fef15cdc77d5b1d05d9b10`.

### 3. Frozen candidate and unchanged production

| Item | Value |
|---|---|
| Candidate | `agent_01JmHhgSkzCQLnax6YkejJkF` / v1 |
| Model | `claude-haiku-4-5-20251001`, standard |
| System SHA-256 | `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` |
| Accepted coordinator Skills | task-management `skver_012fLb9ZFpL4mjqybAZ7KtmU`; daily-planning `skver_01TDfMCnuv5LkQN4WvtwBzXW`; weekly-planning `skver_018soRHmcAn6onE8DpHScFbf`; studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj` |
| Project Health roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM` / v4 |
| Custom schema SHA-256 | `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, `read_only` |
| Permissions | all `trelloWrite*` disabled; Calendar disabled; Trello reads retained |

Production was read before and after the run and remained `agent_01WGRHDBjQa3eMhoGJMmQ1dh` / v21, Haiku standard, with unchanged `updated_at` `2026-09-21T10:51:30.448788Z`. The four historical candidates (`agent_01EeGJTjuKWZa3LuRaHBjj8k`, `agent_01G9i5vhv4oNcp14rXyvTyRc`, `agent_01KSpwh2WJyKQEMcMXAmxtMm`, and `agent_01QiZTseJY6HnixDsBhRgwTU`) were read before candidate creation; each remains v1 with its historical timestamp. None was reused or modified.

### 4. Exact turn evidence

Session: `sesn_01SpGKMBQ25a6f7UG4Tttqy8`.

Exact user prompt:

```text
А минулого тижня по Extract? Теж коротко.
```

Observed `agent.custom_tool_use`: `sevt_019H1HuBDqxuih32H3HQtsYQ`, name `trello_work_history`, with exact input:

```json
{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"}}
```

The deterministic custom-tool result was successful and contained:

```text
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток
```

Its coverage was one page, `truncated: false`, `oldestActionReached: true`; scope was Extract and the Kyiv window was `пн 14.09, 00:00`–`пн 21.09, 00:00`.

The one persisted correlated `user.custom_tool_result`, `sevt_01CP2jpyxWNduttXppDYU3k9`, correctly named `custom_tool_use_id: sevt_019H1HuBDqxuih32H3HQtsYQ`. Both the use and result had `session_thread_id: null`.

Raw coordinator `agent.message` (`sevt_01MKXAGSDDEx2feriG8PmK6k`):

```text
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток

Дві карти вернулись з Done — це варто перевірити: чи йде мова про уточнення/доробку, чи про змінені вимоги?
```

The exact final client-visible response was the same raw coordinator message above.

### 5. Relay, composition, and provenance grading

- **Prefix check:** `finalVisible.startsWith(answer_text) === true`; extracting that prefix also equalled `answer_text` byte-for-byte.
- **Relay activation:** **FAIL.** The Session emitted two `session.status_idle` events with `requires_action` and the same sole blocking ID `sevt_019H1HuBDqxuih32H3HQtsYQ`. The client trace therefore recorded two `custom_tool_result_sent` entries, followed by `work_history_relay_skipped`; its per-turn provenance verdict was no longer verified.
- **Composition/separator:** **FAIL.** The required `\n\n---\nPM-висновок:\n` separator is absent. The final response was the raw model message instead of `answer_text + separator + commentary`.
- **End turn:** `session.status_idle` `sevt_01NCrczcttSdEyWBffaQJHxq` reached authoritative `end_turn` after the two repeated `requires_action` pauses.
- **Current-turn/stale-data boundary:** the blocking ID and the single persisted tool-result correlation match this turn; there is no evidence of a prior-turn result. The failure is duplicate handling of the same current-turn action, not stale data.

### 6. Deterministic and PM grading

The deterministic report itself passes H1–H4 and H6: it is a Variant-B Extract/last-week report, category counts are self-consistent, it contains no dates/times outside its deterministic Kyiv window, and complete coverage is honestly represented. H7 passes: there were no MCP tool calls at all, and candidate configuration made Trello writes/Calendar unavailable; Memory was read-only.

H5 and the required client-owned composition fail as described in §5. This is sufficient to fail the diagnostic.

The PM sentence is a short, useful recommendation based on the two deterministic Done returns. It does not contradict the report, invent a specific card/date/event, or attribute board actions to Daniel. **PM quality: acceptable; no PM hard failure.** It cannot cure the failed client composition boundary.

### 7. Cost, limitation, and recommendation

Authoritative cumulative Session usage after `end_turn`: `list_cost.amount: "3"`, USD — **$0.03** under the authorized $0.12 ceiling. One Session and one visible turn were used.

Limitation: this single fail-fast sample proves the present client does not safely deduplicate repeated `requires_action` pauses for the same custom-tool event. It does not establish a general frequency for this provider sequence.

**Recommendation: return to Product Lead for a bounded source review/fix of duplicate custom-tool `requires_action` handling. Do not run another paid turn under this authorization.**
