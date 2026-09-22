# #29 supersession: чернетки для GitHub і звіт про оновлення документів

Дата: 2026-09-22. Підстава: [docs/21](21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md). Рішення Product Owner: закрити #29 і замінити його новим вузьким issue.

> **Опубліковано 2026-09-22 за авторизацією PO.** Spike (§2) виконано без окремого issue й завершено з GO ([docs/23](23_WORK_HISTORY_SPIKE_REPORT.md)); замість нього створено [#36](https://github.com/danielkokr/djonik-manager-2.0/issues/36) — інструмент `trello_work_history` + огляд. #29 закрито з коментарем §1 (посилання оновлено на #36); коментарі §3 додано до #33/#34/#35.

---

## 1. Коментар для закриття #29 (close as `not planned`)

```markdown
Closing as superseded — Product Owner decision 2026-09-22.

**Why.** This issue's revised contract asked a current-state-only review to answer "what did I do this week", which the connected Trello MCP cannot evidence. Three live runs measured this:
- v20 attach: FAIL (docs/16 §26), rolled back to v21 (§27);
- isolated Haiku diagnostic #1: INCONCLUSIVE (§29/§30);
- production-like Haiku diagnostic #2: FAIL (§31) — R04 due-time rendering, R09 near-full dump, R14 vague actor claim, after correct discovery and zero mutation.

The remaining failures are mostly computation, formatting and selection over data that cannot answer the question. More prompt hardening or a model swap would not fix this.

**Key finding (docs/21).** The history is missing only from the official Trello MCP, where "View action history" is still listed as coming. Trello itself records an authoritative action log: REST `GET /1/boards/{id}/actions` with `filter`, `since`/`before`, `limit` ≤ 1000 and `page`; `updateCard` carries list moves, `closed` and `dueComplete` with time and actor. Comparable products (Jira Rovo changelog, ClickUp AI StandUp, Asana summaries, Linear updates, Todoist activity log) answer "what happened this week" from the app's own history, not from agent memory or a custom event store.

**Preserved.** Discovery (docs/16 §0–§19), source contract and rubric (docs/20, `src/workReviewRubric.ts`), and all live evidence remain the historical record. Production stays v21 without `work-review`; PH specialist v4 is unchanged. The remote `work-review` Skill stays unattached; the temporary candidate `agent_0124tMaz4XRhq9cLNVp1iBuz` v2 stays isolated (archiving is a separate authorized action).

**Replaced by:** #36 — weekly work review from Trello's action history (`trello_work_history` tool). A zero-inference spike already returned GO (docs/23). Roadmap: docs/02 (NOW updated); decision record: docs/21; closeout note: docs/16 §32.
```

---

## 2. Нове issue — тіло

**Title:** `Wave C2 — Spike: Trello work-history evidence for a weekly review (replaces #29)`

```markdown
## Outcome

Decide, with **zero model inference and zero mutation**, whether Trello's own action history can answer "what changed on project X this week" reliably and usefully enough for Daniel. Result: GO / NO-GO, recorded in a docs report.

Replaces #29 (superseded). Decision record: docs/21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md. Canonical NOW: docs/02.

## Background

- The official Trello MCP exposes current card state only; "View action history for cards, lists, and boards" is listed as coming.
- Trello REST exposes board actions: `GET /1/boards/{boardId}/actions` with `filter` (action types), `since`/`before` (ISO date or id), `limit` 0–1000 and `page`.
- `updateCard` records list moves (`listBefore`/`listAfter`, `data.old.idList`), `closed` and `dueComplete`. Label add/remove actions are webhook-only and are not returned in nested actions.
- Known facts to verify against (docs/16 §26/§31): four Extract cards currently in Done (`Коментарі по пінкам`, `Кохаю пінка`, `Білі аромати 3D відео`, `Автоматизація рендеру`); `Брендбук` in This week with due `2026-09-25T15:00:00.000Z`.

## Work

1. Use a **read-only** Trello token, authorized separately by the PO. Keep it only in local environment; never commit, log or paste it into reports.
2. Read Djonik board actions for the current and previous Kyiv weeks (`filter=updateCard,createCard,commentCard`, `since`/`before`), paging until exhausted.
3. Record, for the known Extract cards: whether list-move, `closed` and `dueComplete` actions exist, with time and actor.
4. Measure:
   - how far back actions are available (retention depth);
   - actions per week, payload size and pagination behaviour;
   - latency;
   - whether filtering by the **current** Extract label is sufficient.
5. Build an **offline deterministic digest** in scratch, not in the repo. Rules:
   - Europe/Kyiv week window;
   - transitions grouped as moved to Done / returned from Done / archived / created / commented;
   - Kyiv-local time and weekday;
   - coverage flags (pages read, truncated, label history unavailable);
   - no `lastActivityAt`.
6. Show the digest to Daniel and record his answer to: "Does this answer 'what did I do this week on Extract'?"

## GO / NO-GO

- **GO** if all of the following hold:
  - Done transitions with time exist for all four known Extract cards;
  - retention is at least 2 weeks;
  - Daniel judges the digest useful.

  Then open, one at a time:
  - (a) a read-only custom tool `trello_work_history` + deterministic digest + client handling of custom tool calls, consistent with #32;
  - (b) a thin `work-review` Skill v2 over that tool, one isolated Haiku diagnostic, then the docs/04 §27 five-plus-one gate.

  Inclusion in v1 needs a separate PO decision in docs/00.
- **NO-GO:** v1 ships without a work-review capability. Current state stays with Project Health / task-management, and the existing `work-review` Skill is not attached.

## Boundaries

- No paid Session or Managed Agent/Skill/Memory change.
- No Trello mutation and no MCP configuration change.
- No event store, webhooks, snapshot store, episodic journal, scheduler or Calendar.
- No commit, push, deploy or issue closure without explicit authorization.
- Raw action payloads stay in temporary scratch and are summarized in the report without secrets.

## Report

Docs report with:
- exact endpoints and parameters;
- per-known-card evidence table;
- retention, pagination, size and latency;
- the offline digest shown to Daniel and his verdict;
- GO/NO-GO with rationale;
- limitations (label history, work outside Trello);
- `git status --short`.
```

---

## 3. Коментарі до пов'язаних issue

**#33:**

```markdown
Roadmap update 2026-09-22 (docs/02, docs/21): #29 is superseded. #33 no longer waits for a #29 candidate — promotion can target the accepted tuple (Agent v21 / PH specialist v4 / four coordinator Skills). The `trello_work_history` custom tool (#36, spike GO in docs/23) will be a separate later promotion and will need serving-client handling of custom tool calls.
```

**#34:**

```markdown
Roadmap update 2026-09-22 (docs/21): when an accepted plan/commitment refers to a Trello task, keep the card ID and project with it when known. This is the plan side of a deterministic plan-vs-actual (#36) against Trello's action history; no other scope change.
```

**#35:**

```markdown
Roadmap update 2026-09-22 (docs/21): #29 is superseded; the Trello work-history spike returned GO (docs/23) and implementation is #36. If the PO includes the weekly transitions review in v1, acceptance checks it against Trello's action log on real examples. Otherwise the existing criterion stands: unavailable history stays explicit. During the pilot, note questions about work done outside Trello — they inform whether an explicit-entry journal in Memory is ever needed.
```

---

## 4. Звіт про оновлення документів

**Що зроблено:** локальні правки документації під рішення «закрити й замінити #29». Коду, Skill, Agent, Memory, Trello і GitHub не торкались.

| Файл | Зміна |
|---|---|
| `docs/02_DEVELOPMENT_ROADMAP.md` | Блок «Update 2026-09-22»; у черзі #29 закреслено, **NOW = spike історії дій Trello**; #33 більше не чекає на #29; #34 зберігає card ID у прийнятих планах; нова секція NOW із GO/NO-GO; стара секція #29 → SUPERSEDED (збережена) + запис §31 FAIL; довгострокова карта Wave C |
| `docs/00_DJONIK_PRODUCT_CONTRACT.md` | v1 boundary: історія є в журналі Trello; включення тижневого огляду в v1 — окреме рішення PO після GO; аналітика трендів, облік часу й робота поза Trello — після v1 |
| `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` | Абзац про #29 замінено: історію читаємо з системи-власника через один read-only інструмент; без event store/webhooks/snapshots/журналу |
| `docs/03_TARGET_CAPABILITIES.md` | §8: порядок джерел доказів; детерміновані вікна, дати, лічильники; Djonik не веде власний журнал подій |
| `docs/16_ISSUE_29_…_REPORT.md` | Додано §32 «Закриття напряму #29» (§1–§31 без змін) |
| `docs/17_DJONIK_V1_ARCHITECTURE_AUDIT.md` | Позначки «superseded/amended» у §4, §5 і таблиці §6; історичний текст збережено |
| `docs/20_…_RUBRIC.md` | Статус: рубрик — історична база й джерело регресій |
| `docs/21_…_AUDIT.md` | Статус прийняття рішення й посилання на цей файл |
| `AGENTS.md`, `CLAUDE.md` | У списку обов'язкового читання поруч із docs/17 додано docs/21 |
| `docs/22_…_DRAFTS.md` | Цей файл: чернетки для GitHub + звіт |

**Навмисно не змінено:**
- `.claude/skills/work-review/SKILL.md` — лишається як історичне джерело; не приєднаний;
- `src/workReviewRubric.ts` і тести;
- `docs/04` §27 — політика витрат діє без змін.

**Перевірки:** `npm test` → 472 tests, 472 pass, 0 fail (включно з тестами, що читають docs/16 §30 і docs/20); `git diff --check` → exit 0 (лише стандартні попередження LF→CRLF).

`git status --short`:

```text
 M AGENTS.md
 M CLAUDE.md
 M docs/00_DJONIK_PRODUCT_CONTRACT.md
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M docs/02_DEVELOPMENT_ROADMAP.md
 M docs/03_TARGET_CAPABILITIES.md
 M docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md
 M docs/17_DJONIK_V1_ARCHITECTURE_AUDIT.md
 M docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md
?? docs/21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md
?? docs/22_ISSUE_29_SUPERSESSION_DRAFTS.md
```

**Потрібні твої рішення / дії:**
1. «Так» на публікацію в GitHub: закрити #29 з коментарем §1, створити issue §2, додати коментарі §3. Після створення я впишу реальний номер нового issue в docs/02, docs/16 §32 і docs/22.
2. Read-only Trello токен для spike (лише локально).
3. Commit цих змін — за твоєю командою.
