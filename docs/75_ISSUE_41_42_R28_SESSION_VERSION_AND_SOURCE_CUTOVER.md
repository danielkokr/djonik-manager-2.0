# #41 + #42 — `sessionVersion` для `planning-and-focus` і source cutover на r28

Дата: 2026-09-25. Попередній етап: [docs/74](74_ISSUE_41_42_R28_REMOTE_RESOLUTION.md) (Skill sync, Agent v28, атестація). Процедура inspection Session та сама, що в [docs/64](64_ISSUE_39_R27_REMOTE_CONFIGURATION.md) §8–11.

**Статус:** звіт про завершення `RELEASE_R28` і **source** cutover. Це **не** deploy і **не** live-приймання #41/#42. Production і далі serve-ить r27. Зміни uncommitted і чекають review Product Lead.

**Авторизовано Product Owner:**
- одна inspection Session на v28;
- Memory `read_only`;
- нуль подій;
- читання snapshot;
- завершення `RELEASE_R28`;
- `SERVING_RELEASE = RELEASE_R28` у source.

**Не робилось:**
- жодного user/model ходу, inference, tool call;
- Trello, запис у Memory, Telegram;
- deploy, restart, `DJONIK_EXPECTED_RELEASE`, Working Rhythm;
- нових версій Agent чи Skill;
- commit, push, GitHub issues, `docs/02` NOW.

## 1. Стартовий стан

| Перевірка | Результат |
|---|---|
| `HEAD` / `origin/main` | обидва `0a4799b8d74fa549d36901a9fb6b72dc5010f17d` |
| Робоче дерево | незакомічені зміни docs/74 на місці (7 змінених файлів + `docs/74`, `src/releaseR28.test.ts`) |
| `release:check -- r28` | OK @28 |
| v28 перед створенням Session | latest = 28; `agents.retrieve(…, {version: 28})` deep-equal read-back з docs/74 — дрейфу нема |

Примітка: в інструкції етапу Skill id записано як `skill_01PxXTvHbZ…` (велика `H`). Провайдер повертає **`skill_01PxXTvhbZSrbxqi7gmDs6KW`** (мала `h`). Використано значення провайдера.

## 2. Inspection Session

Перша спроба `sessions.create` отримала **400** на етапі розбору тіла: `budget.max_list_cost.amount` має бути рядком. Запит відхилено до створення ресурсу. Далі:
- скрипт додатково перевірив, що серед 20 найновіших Session нема жодної з `metadata.release = r28-inspection`;
- потім створив **одну** Session.

| Поле | Значення |
|---|---|
| id | **`sesn_016UCPyKFRwMTXzLxC4xdLoE`** |
| `created_at` | `2026-09-25T13:12:20.626145Z` |
| agent | `{type: agent, id: agent_01WGRHDBjQa3eMhoGJMmQ1dh, version: 28}` |
| environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` (ті самі, що в release) |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`** |
| budget | `max_list_cost = "1"` ¢ USD (backstop) |
| metadata | `{source: diagnostic, release: r28-inspection, app_revision: 0a4799b…, purpose: …}` |

Мітка `release` навмисно не `r28`, тож `release:check -- r28 --serving` її не сплутає із serving Session. Session створено прямим `sessions.create`, stream не відкривався. Session лишено idle; її не архівовано й не видалено.

**Нуль подій і inference** (повторний read-back після всіх перевірок):
- `status: idle`, `archived_at: null`;
- `events.list` → **0 подій**;
- `usage`: `input_tokens 0`, `output_tokens 0`, `cache_read 0`, `cache_creation 0/0`, **`list_cost $0`**, `web_* 0`;
- `stats.active_seconds 0`; `usage.active_seconds 1.052` — це провізія Session, не inference.

## 3. Snapshot v28 у Session

- `agent.model`, `system`, `tools`, `mcp_servers`, `name`, `description` — **deep-equal** Agent v28;
- roster: `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm`.

| Skill | Pin (Agent) | Snapshot Session | Відповідність |
|---|---|---|---|
| task-management | `skver_01CJQkVY1kp1urhBWQgHUYxW` | `1790164354565465` | = записаний `sessionVersion` |
| **planning-and-focus** | `skver_01RzxVaCr47k6R11pHLWr62e` | **`1790341201541171`** | **нове**, −0.41 с до `created_at` pin; єдина версія Skill |
| studio-intake | `skver_018sJv1GCnzfZRG4NbExbAzj` | `1789734659839542` | = записаний |
| work-review | `skver_015LYzVdivGGMsBpuki4kW4S` | `1790083840153637` | = записаний |
| pm-rhythm | `skver_01Y77TKeXY9suV99XZU3cv5a` | `1790320523604075` | = записаний |

Значення прочитано зі snapshot, а не виведено з `skver_`. Зв'язок із часом (мікросекундний timestamp у межах секунди від `created_at`) лише підтверджує відповідність, як у docs/53 §4 і docs/64 §11.

Атестація snapshot:
- `compareWithRelease(RELEASE_R28 з цим sessionVersion, session.agent)` = **`[]`**;
- `attestServingSession` → лише `memory access read_only != read_write`, навмисно: це inspection, не serving;
- `compareWithRelease(RELEASE_R27, session.agent)` → очікувані відмінності: версія, system, daily/weekly, planning-and-focus.

## 4. Остаточний `RELEASE_R28`

`src/release.ts`: `PLANNING_AND_FOCUS_SKILL` отримав `sessionVersion: "1790341201541171"`, а pin r28 його несе. Тест доводить `RELEASE_R28 ≡ resolveReleaseCandidate(RELEASE_R28_CANDIDATE, {planning-and-focus: {skillId, version, sessionVersion}}, 28)`.

| Поле | Значення |
|---|---|
| `id` / agent | `r28` / `agent_01WGRHDBjQa3eMhoGJMmQ1dh@28` |
| model | `claude-sonnet-5` / `medium` / `standard` (= r27) |
| system | `c85e7e621af71f78890ddfe7c270ce737ce83d58e58d5543d1ea7be17964e7da` (#41 + #42) |
| skills | task-management `skver_01CJQk…`/`1790164354565465`; **planning-and-focus `skill_01PxXTvhbZSrbxqi7gmDs6KW` `skver_01RzxVaCr47k6R11pHLWr62e`/`1790341201541171`**; studio-intake `skver_018sJv…`/`1789734659839542`; work-review `skver_015LYz…`/`1790083840153637`; pm-rhythm `skver_01Y77T…`/`1790320523604075` |
| daily/weekly-planning | відсутні (лишаються лише в r27) |
| specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM@4` |
| built-in / custom / MCP / policies | = r27: `read, write, edit, glob, grep`, `always_ask` = `write, edit, trello/trelloWriteCard`; Trello default `always_ask`; `trello_work_history`; Calendar вимкнений |
| session | env / vault / Memory store r27, `read_write` |

## 5. `managed-agents/djonik.md`

- Frontmatter уже в docs/74 декларував r28: planning-and-focus на місці daily/weekly, решта без змін. У цьому етапі файл **не змінювався**.
- Тіло — прийнятий prompt #41 + #42 (SHA `c85e7e62…`), без правок.
- `src/release.test.ts` повернуто до **однієї рівності** між `SERVING_RELEASE` і `djonik.md`: prompt SHA, model, roster, MCP, Skills з пінами, tools з політиками.
- Тимчасовий тест «served r27 differs from the declaration…» з docs/74 видалено: він був потрібен лише на перехідний стан.

## 6. Source cutover

`SERVING_RELEASE = RELEASE_R28`. Наслідки:
- `SERVING_READ_ONLY_BOUNDARY = readOnlyBoundaryFor(r28)` = `pre_execution` (межа #39 без змін);
- `release:check` без аргументу перевіряє r28;
- наступна задеплоєна ревізія на старті атестує Agent v28 і свою serving Session проти r28 (усі Session-написання тепер відомі);
- `deploy/deploy.sh` відмовить, доки на хості `DJONIK_EXPECTED_RELEASE ≠ r28`, і процес r27 при цьому не зачепить.

**Production цим не змінено:** хост далі serve-ить r27 (§7).

Тести тепер розрізняють три речі:
- **r28** — serving-реліз цієї ревізії (`release.test`, `releaseR28.test`);
- **r27** — reviewed-реліз: production до deploy, потім rollback (`releaseR27.test`, `release.test`);
- **serving Session для r28 ще нема:** `release:check -- r28 --serving` → exit 78.

## 7. Provider-перевірки (лише читання)

| Команда | Результат |
|---|---|
| `release:check -- r28` | **`r28 OK agent=…@28 serving_in_this_revision=true`**, exit 0 |
| `release:check -- r28 --serving` | `no Telegram serving Session found`, exit 78 — **очікувано**: r28 ще не задеплоєно |
| `release:check -- r27` | `r27 OK agent=…@27 serving_in_this_revision=false`, exit 0 |
| `release:check -- r27 --serving` | **OK**: `sesn_01XZxfa1skBSuLBdMhMNBnin`, idle, `created 2026-09-25T11:34:37Z`, app `f0a9cb9d…`, **@27** — production serve-ить r27, та сама Session, що до етапу |
| `release:check` (за замовчуванням) | r28 OK |

## 8. Тести (Node v24, Windows)

| Набір | Результат |
|---|---|
| Сфокусовані: `releaseR28`, `releaseR28Candidate`, `release`, `releaseR27`, `releaseR27Candidate`, `releaseAttestation`, `servingRelease`, `djonikAgentSource`, `planningAndFocus`, `turnClock`, `skills`, `pmRhythmSkill`, `rhythmRuntime`, `rhythmRunner`, `toolConfirmation`, `toolConfirmationClient`, `deployConfig` | **401/402** |
| Повний `npm test` | **1040/1042** |
| `npm run typecheck` / `npm run build` / `git diff --check` | pass / pass / pass (лише CRLF-попередження git) |

Нові й змінені перевірки `releaseR28.test.ts`:
- r28 serve-иться; r27 — reviewed rollback;
- pin `planning-and-focus` з виміряним `sessionVersion`;
- виміряний snapshot inspection Session атестується як r28;
- інше число або `latest` для `planning-and-focus` — це drift;
- inspection Session відрізняється лише `read_only` Memory;
- чотири збережені Skills ідентичні пінам r27.

Збої (обидва Windows-only, ті самі, що на чистому `0a4799b` у docs/74 §10):
- `processExit.test.ts` «a real process that fetched over keep-alive exits…»;
- `deployConfig.test.ts` «deploy script survives replacing itself…».

## 9. Змінені файли (цей етап)

- `src/release.ts`: `sessionVersion` для `planning-and-focus`; `SERVING_RELEASE = RELEASE_R28`; коментарі.
- `src/releaseR28.test.ts`: serving r28; виміряний snapshot; тест inspection Session.
- `src/release.test.ts`: serving = r28; lockstep однією рівністю; тимчасовий тест прибрано; r27 як rollback.
- `src/releaseR27.test.ts`, `src/releaseR27Candidate.test.ts`, `src/releaseR28Candidate.test.ts`: очікування serving.
- `managed-agents/README.md`: рядок про r28.
- `docs/74`: доповнення-посилання.
- Цей документ.

Разом із docs/74 незакомічене дерево — у розділі «Стан робочого дерева».

## 10. Обмеження

- Поведінка r28 (prompt #41/#42 + `planning-and-focus`) live не перевірялась. Live-приймання #41/#42 не заявляється.
- Inspection Session `sesn_016UCPyKFRwMTXzLxC4xdLoE` лишається idle: Memory `read_only`, budget 1¢. Архівація — окремим рішенням.
- Latest coordinator = v28. Production-шлях пінить версію з `SERVING_RELEASE` задеплоєної ревізії, тобто зараз 27.

## 11. Наступний крок: production deploy (окрема авторизація; не виконувалось)

1. Review Product Lead → commit + push цих змін (Daniel). Далі `<SHA>` — повний SHA нового коміту на `main`.
2. На хості, за шаблоном docs/67 §11 (`set-secrets.sh` читає значення зі stdin):
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
   Ввести `r28`. Одразу потім:
   ```bash
   bash /opt/djonik/app/deploy/deploy.sh <SHA>
   ```
   `deploy.sh` перевіряє `release:check` (v28) і відповідність `DJONIK_EXPECTED_RELEASE` **до** restart. Restart один. Working Rhythm (`DJONIK_WORKING_RHYTHM`, стан у `/var/lib/djonik`) лишається як є.
3. Локально, лише читання:
   ```bash
   npm run release:check -- r28 --serving
   ```
   Очікується нова hosted Session, `app=<SHA>`, `@28`, з `created` пізніше за r27 Session `sesn_01XZxfa1…` (11:34:37Z). `release:check -- r27 --serving` і далі знаходитиме стару r27 Session, бо вона не архівується. Тому доказом cutover є новіша r28 Session, а не зникнення r27.
4. Rollback за потреби: `DJONIK_EXPECTED_RELEASE=r27` + `deploy.sh f0a9cb9d3a457f5ea2f0830182a331d51f64b6e2` (Agent v27 незмінний).
5. Після цього, окремо: bounded hosted-перевірка поведінки #41/#42 → приймання → синхронізація issues і roadmap.

## Стан робочого дерева

```text
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/djonikAgentSource.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR27.test.ts
 M src/releaseR27Candidate.test.ts
 M src/releaseR28Candidate.test.ts
?? docs/74_ISSUE_41_42_R28_REMOTE_RESOLUTION.md
?? docs/75_ISSUE_41_42_R28_SESSION_VERSION_AND_SOURCE_CUTOVER.md
?? src/releaseR28.test.ts
```
