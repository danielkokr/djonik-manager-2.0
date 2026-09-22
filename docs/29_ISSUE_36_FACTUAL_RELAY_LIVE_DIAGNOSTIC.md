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
