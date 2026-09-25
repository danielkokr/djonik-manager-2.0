# #39 — Етап 3B-1: remote sync `pm-rhythm`, Agent v27, read-back і справжній `RELEASE_R27`

Дата: 2026-09-25. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 64). Попередні етапи: [docs/61](61_ISSUE_39_WORKING_RHYTHM_SOURCE_FOUNDATION.md), [docs/62](62_ISSUE_39_RUNTIME_WIRING_SOURCE.md), [docs/63](63_ISSUE_39_PREEXECUTION_PERMISSION_BOUNDARY_SOURCE.md).

**Статус:** звіт про remote-конфігурацію. Це **не** deployment acceptance, **не** cutover і **не** приймання #39. Source-зміни uncommitted і чекають review Product Lead.

**Авторизовано Product Owner для цього етапу:**
- sync Skill `pm-rhythm` і її незмінна версія;
- read-back Skill і версії;
- рівно один update primary Agent v26 → v27;
- read-back v27;
- одна inspection Session без подій і inference.

**Не робилось:**
- deploy, SSH, systemd;
- перемикання `SERVING_RELEASE` чи Telegram serving Session;
- `DJONIK_WORKING_RHYTHM`, `/rhythm.md`;
- prompt / event у будь-яку Session, платний inference;
- мутації Trello, Memory, Calendar;
- зміни інших Skills, specialist, prompt, model;
- видалення чи архівація ресурсів;
- commit, push, закриття #39, зміна NOW.

## 1. Стартовий HEAD

- `main` = `0c817b8b23073c5426a5914d25c7204c250b4195` (`feat: add pre-execution permission boundary`). До змін `git status --short` був порожній.
- `docs/02`, рядок 64: єдиний NOW — #39.
- GitHub #39: OPEN. Єдиний коментар — промоція 2026-09-24.
- Stage 1 (`5e592e9`), Stage 2 (`4e2ec69`) і Stage 3A (`0c817b8`) закомічені.
- У source було:
  - `SERVING_RELEASE = RELEASE_R26`;
  - `SERVING_READ_ONLY_BOUNDARY = post_hoc_detection_only`;
  - `RELEASES = {r25, r26}`;
  - `RELEASE_R27_CANDIDATE` з unresolved `pm-rhythm`.

## 2. Remote preflight v26 (до будь-якого запису)

Read-only: `agents.retrieve` (latest і `{version: 26}`), specialist, `skills.list`, `release:check`.

| Перевірка | Результат |
|---|---|
| Latest версія primary Agent | **26**; `updated_at 2026-09-24T08:17:17.170292Z`; не архівована; latest ≡ v26 (deep-equal) |
| `release:check r26` / `r25` | OK / OK |
| `compareWithRelease(RELEASE_R26, normalize(v26))` | `[]` — дрейфу нема |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| System | SHA-256 `3e204453…b4b6`, 3529 B = `RELEASE_R26.systemSha256` |
| Skills | 5 explicit pins = r26 (task-management, daily-planning, weekly-planning, studio-intake, work-review) |
| Custom tool | `trello_work_history`; canonical schema `dcf09961…`, description `b7622094…` = source |
| Built-in | `read, write, edit, glob, grep`; default disabled; усе `always_allow` |
| Trello MCP | default enabled `always_allow`; лише `trelloWriteCard` з 6 writes enabled |
| Calendar MCP | default disabled |
| Roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`; specialist latest = 4, не архівований, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm` |
| `name` / `description` / `metadata` | `Джонік` / без змін / `{}` |
| Remote `pm-rhythm` | **не існує**: 13 custom Skills, жодної з такою назвою |

Висновок: **PASS**, v27 можна створювати.

## 3. Sync `pm-rhythm`

Механізм той самий, що для `studio-intake`, `work-review` і #38 (docs/13 §23, docs/16 §26.3, docs/42):
- `client.beta.skills.create({ files: [toFile(bytes, "pm-rhythm/SKILL.md")] })`;
- `display_name` не передавався: провайдер вивів його з frontmatter `name`;
- байти — із закоміченого blob (`git show HEAD:.claude/skills/pm-rhythm/SKILL.md`, LF). Робоча копія має CRLF, git index — LF, як і в docs/42;
- перед create скрипт перевіряв, що SHA джерела = `8617fd5c…` і що Skill `pm-rhythm` ще нема.

| Поле | Значення |
|---|---|
| Skill id | **`skill_01GzpQX3bVuWNk5bhbGcbzku`** |
| Version id | **`skver_01Y77TKeXY9suV99XZU3cv5a`** — єдина версія Skill, = `latest_version_id` |
| `display_name` / version `name` | `pm-rhythm` / `pm-rhythm` |
| `source` | `custom` |
| `created_at` (Skill і версія) | `2026-09-25T07:15:23.986014Z` |
| `description` версії | 548 символів, = frontmatter `description` джерела |

**Еквівалентність джерелу.** `versions.download` повернув zip з **одним** файлом `pm-rhythm/SKILL.md`:
- 10 706 B;
- SHA-256 `8617fd5c7e4d536a8b5a2d3a3e8e2efec41d22c9a5c41db853ddf6f760c984f9`;
- `cmp` з `git show HEAD:…` — **побайтово ідентичний**. Це й SHA робочої копії після CRLF→LF.

Інші 13 custom Skills не змінились (ті самі `latest_version_id` і `updated_at`). Нових ресурсів, крім `pm-rhythm`, нема.

## 4. Семантична дельта v26 → v27

Тіло згенеровано з source: `buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, {skills: {"pm-rhythm": {skillId, version}}})`.
- Ключі тіла: `version: 26` (precondition), `skills`, `tools`.
- SHA-256 `JSON.stringify(body)` = **`5371b2ec9ecd20c84d701124c7ec18d887bc3ef9d9eebb8180e63b768073f70e`**. `npm run release:check -- r27 --plan --from 26` дає той самий хеш.
- `confirmationPolicyProblems` = `[]`.
- Тіло програмно застосовано до **сирого live v26**, результат нормалізовано й порівняно:
  - з r27 → `[]`;
  - з r26 → рівно очікувані відмінності.

Дельта сирих tool-configs:

| Шлях | v26 | v27 |
|---|---|---|
| skills | 5 pins | ті самі 5 pins **+ `skill_01GzpQX3bVuWNk5bhbGcbzku@skver_01Y77TKeXY9suV99XZU3cv5a`** |
| built-in `write` | enabled / `always_allow` | enabled / **`always_ask`** |
| built-in `edit` | enabled / `always_allow` | enabled / **`always_ask`** |
| trello default | enabled / `always_allow` | enabled / **`always_ask`** |
| trello `trelloReadBoard`, `trelloReadCard`, `trelloReadChecklist`, `trelloReadInbox`, `trelloReadList`, `trelloReadMember`, `trelloReadPlanner`, `trelloReadWorkspace`, `trelloSearch` | (неявно через default) | **явно** enabled / `always_allow` |
| trello `trelloWriteCard` | enabled / `always_allow` | enabled / **`always_ask`** |

**Без змін:**
- model, effort, speed;
- system;
- MCP servers;
- roster (specialist v4);
- built-in `read` / `glob` / `grep` (`always_allow`);
- 5 disabled Trello writes;
- Calendar (disabled);
- custom tool.

Custom tool: сирий `JSON.stringify` відрізняється лише порядком ключів провайдера (відомо з docs/53). Canonical SHA схеми й опису ті самі.

Неочікуваних змін нема.

## 5. Створення Agent v27

- Безпосередньо перед update: повторний GET, latest = 26 і deep-equal preflight-snapshot. SHA тіла перевірено.
- `2026-09-25T07:16:53Z`: `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)` з `version: 26`, `maxRetries: 0`.
- Відповідь: **`version: 27`**, `updated_at 2026-09-25T07:16:58.186522Z`.
- Один виклик, без повторів.

## 6. Read-back v27

- `agents.retrieve(…, {version: 27})`: latest = 27, latest ≡ v27.
- v26 після update побайтово той самий, що в preflight: незмінний і лишається rollback-ціллю.
- Сирі поля v26 → v27: змінились **лише** `skills`, `tools`, `version`, `updated_at`.
- `compareWithRelease(r27, normalizeAgentConfig(v27))` = **`[]`**. Це r27, розв'язаний через `resolveReleaseCandidate(RELEASE_R27_CANDIDATE, {skills, agentVersion: 27})`.
- `compareWithRelease(RELEASE_R26, normalize(v26))` = `[]`.
- `confirmationPolicyProblems(RELEASE_R27)` = `[]`.
- Нормалізований v27:
  - model `claude-sonnet-5/medium/standard`;
  - system `3e204453…`;
  - roster `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`;
  - custom `trello_work_history#dcf099612535`;
  - built-in enabled `edit, glob, grep, read, write`, `alwaysAsk = [edit, write]`;
  - trello: `defaultPolicy always_ask`, `alwaysAsk = [trelloWriteCard]`, `needsConfirmation = [trelloWriteCard, *]`;
  - calendar: default disabled.
- `npm run release:check -- r27` → `[release-check] r27 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 serving_in_this_revision=false` (exit 0).

## 7. Матриця дозволів v27 (виміряно на read-back)

| Інструмент | enabled | `permission_policy` | Human-хід (клієнт Stage 3A) | Autonomous-хід |
|---|---|---|---|---|
| built-in `read`, `glob`, `grep` | true | `always_allow` | виконується | виконується |
| built-in `write`, `edit` | true | **`always_ask`** | ALLOW | DENY до виконання |
| built-in `bash`, `web_fetch`, `web_search` | false (default disabled) | — | недоступно | недоступно |
| `trello_work_history` (custom) | — | не керується політиками | клієнт (#40), read-only | клієнт (#40), read-only |
| Trello **default** (неназваний / майбутній) | true | **`always_ask`** | DENY (`unreviewed_tool`) | DENY |
| 9 рецензованих Trello reads | true (явно) | `always_allow` | виконується | виконується |
| `trelloWriteCard` | true | **`always_ask`** | ALLOW → перевірка #31 | DENY до виконання |
| `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, `trelloWritePlanner` | false | `always_allow` (недосяжно) | вимкнено провайдером | вимкнено провайдером |
| Calendar MCP | default false | `always_allow` (недосяжно) | вимкнено | вимкнено |

Клієнтська поведінка — з docs/63; тут вона не вимірювалась live (див. §16).

## 8. Inspection Session

Створено **одну** Session: **`sesn_01MN2WHdhwexuwxhu8sLB91G`**, `created_at 2026-09-25T07:17:53.691662Z`.

- `agent: {type: "agent", id: "agent_01WGRHDBjQa3eMhoGJMmQ1dh", version: 27}`;
- environment, vault і Memory store — ті самі, що в release;
- Memory `access: "read_only"`;
- Session budget `max_list_cost = 1¢` як backstop;
- `metadata: {source: "diagnostic", release: "r27-inspection", app_revision: 0c817b8…, purpose: …}`.

Мітка `release` навмисно не `r27`, тож `release:check --serving` її не сплутає із serving Session.

Створено прямим `sessions.create` без `connectToDjonik`, тож stream не відкривався. Session лишено idle. Її не архівовано й не видалено: accepted workflow цього не вимагає (docs/42, docs/53).

## 9. Нуль подій і inference

Повторний read-back після всіх перевірок:
- `status: idle`, `archived_at: null`;
- `events.list` → **0 подій**;
- `usage`: `input_tokens 0`, `output_tokens 0`, `cache_read 0`, `cache_creation 0/0`, **`list_cost $0`**, `web_* 0`;
- `active_seconds 1.015` — провізія Session, не inference.

Жодного `user.message`, жодного tool call. Мутацій Trello, Memory чи Calendar не було: Memory змонтовано read-only.

## 10. Виміряна форма snapshot v27 у Session

Перше live-вимірювання для обмеження docs/63 §20 п. 1.

- `agent.version = 27`.
- `agent.tools` **deep-equal** `tools` Agent v27. Так само `model`, `system`, `mcp_servers`, `name`, `description` і roster `{id, version}`.
- Отже Session snapshot несе `always_ask` рівно у формі, яку припускав Stage 3A:
  - `agent_toolset_20260401.configs[{name, enabled, permission_policy: {type: "always_ask"}, type}]` для `write` / `edit`;
  - `mcp_toolset(trello).default_config.permission_policy = {type: "always_ask"}`;
  - `configs[trelloWriteCard].permission_policy = {type: "always_ask"}`;
  - явні reads — `{type: "always_allow"}`.
- Єдина відмінність від SDK-фікстури: провайдер додає `type` до кожного built-in config. Нормалізація його ігнорує, це відомо з v26.
- `compareWithRelease(RELEASE_R27, normalize(session.agent))` = **`[]`**.
- `attestServingSession(RELEASE_R27, session)` → рівно одна невідповідність: `memory access read_only != read_write`. Вона очікувана й навмисна: це inspection Session, не serving.
- Coordinator Skills — числові Session-написання. Для п'яти прийнятих Skills вони **ідентичні** записаним у r26 (`1790164354565465`, `1790164356765333`, `1790164359202020`, `1789734659839542`, `1790083840153637`). Roster-specialist лишається з `skver_01JLTtMvUgfEqdcBBGj4WGVm`.

## 11. `sessionVersion` для `pm-rhythm`

| Skill | Pin | Snapshot Session | Δ до `created_at` pin | Інші версії Skill |
|---|---|---|---|---|
| pm-rhythm | `skver_01Y77TKeXY9suV99XZU3cv5a` | **`1790320523604075`** | −0.38 с | нема (одна версія) |

Правило таке саме, як у docs/53 §4: мікросекундний timestamp у межах секунди від `created_at`. У Skill лише одна версія, тож відповідність однозначна.

## 12. Source-визначення `RELEASE_R27`

`src/release.ts`:
- `PM_RHYTHM_SKILL = {skillId: skill_01GzpQX3bVuWNk5bhbGcbzku, version: skver_01Y77TKeXY9suV99XZU3cv5a, sessionVersion: "1790320523604075"}`.
- **`RELEASE_R27`** записано явно, а не виведено під час import. Тому реліз не зміниться, якщо колись відредагують кандидата.

| Поле | Значення |
|---|---|
| `id` | `r27` |
| `agent` | `agent_01WGRHDBjQa3eMhoGJMmQ1dh@27` |
| model / system | як r26 (`claude-sonnet-5/medium/standard`, `3e204453…`) |
| skills | 5 pins r26 без змін + `pm-rhythm` explicit (`skver_…` + `sessionVersion`) |
| specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm` |
| builtInTools / customTools / mcpServers | як r26 |
| mcpToolsets | trello: `defaultPolicy: "always_ask"`, 9 reads `true` + 6 writes r26; calendar як r26 |
| `confirmationRequired` | `{builtIn: [write, edit], mcp: {trello: [trelloWriteCard]}}` |
| session | environment, vault і Memory store r26, `read_write` |

- `RELEASES = {r25, r26, r27}`.
- **`SERVING_RELEASE = RELEASE_R26` — без змін.**
- `SERVING_READ_ONLY_BOUNDARY = readOnlyBoundaryFor(SERVING_RELEASE)` = **`post_hoc_detection_only`**.
- `readOnlyBoundaryFor(RELEASE_R27)` = **`pre_execution`**.
- `RELEASE_R27_CANDIDATE` лишився як вхід Stage 3A. Він і далі unresolved і не servable. Тест доводить `resolveReleaseCandidate(candidate, справжні id, 27)` ≡ `RELEASE_R27`.

Інших source-змін нема:
- `djonikClient`, `releasePlan`, `releaseAttestation`, `rhythmRuntime` не змінено;
- `managed-agents/*`, `.claude/skills/*`, `deploy/*` не змінено.

## 13. Attestation / release-check

| Перевірка | Результат |
|---|---|
| `npm run release:check -- r27` (live Agent v27 ↔ source `RELEASE_R27`) | **OK**, exit 0, `serving_in_this_revision=false` |
| `npm run release:check -- r27 --plan --from 26` | SHA тіла `5371b2ec…` = тіло, яким створено v27 |
| Inspection Session ↔ source `RELEASE_R27` (агентна частина) | `[]` |
| Inspection Session ↔ `RELEASE_R27` (повна) | лише `memory access read_only != read_write` (навмисно) |
| `npm run release:check -- r26` | OK, `serving_in_this_revision=true` |
| `npm run release:check -- r26 --serving` | OK: hosted Session `sesn_018y1GzDi2zG4uJ5kWwyzKpv`, idle, `created 2026-09-25T06:50:13Z`, app `d59a53261b81…`, **agent @26** |
| `npm run release:check -- r25` | OK: rollback-ціль жива |

Hosted serving Session новіша за `sesn_01K212…` з docs/60. Її створено о 06:50 UTC, **до** першого remote-виклику цього етапу (≈07:14 UTC). Отже це власний перезапуск production-процесу, а не наслідок цього етапу. Вона атестується як r26 / v26 на app `d59a532`.

Обидві точки входу (`cli.ts`, `telegramCli.ts`) створюють Session лише через `connectServingSession` із явним `agent.version = SERVING_RELEASE.agent.version = 26`. Тому те, що latest Agent тепер 27, production **не зачіпає**, зокрема й після перезапуску.

## 14. `SERVING_RELEASE` лишається r26

Це підтверджують тести (`releaseR27.test.ts`, `releaseR27Candidate.test.ts`, `release.test.ts`) і live `release:check r26 --serving`. Production обслуговує r26 / Agent v26 весь час.

## 15. Working Rhythm у production неактивний

- `SERVING_READ_ONLY_BOUNDARY = post_hoc_detection_only`, тож `startWorkingRhythm` → `blocked` (тест Stage 3A лишився зеленим).
- На хості нічого не змінювалось: `DJONIK_WORKING_RHYTHM` не вмикався, `/rhythm.md` не створювався.
- Deploy не було: production app лишається `d59a532`, що передує навіть Stage 1.

## 16. Тести і перевірки (Node v24, Windows)

| Набір | Результат |
|---|---|
| **Новий** `releaseR27` (визначення, провенанс, тіло, виміряні форми Agent і Session, sessionVersion, tuple, boundary r26/r27) | **10/10** |
| `releaseR27Candidate` (оновлено: `RELEASES` = r25/r26/r27) | **18/18** |
| `release` / `servingRelease` / `releaseAttestation` / `servingLifecycle` | 11/11 / 18/18 / 31/31 / 8/8 |
| `toolConfirmation` / `toolConfirmationClient` | 13/13 / 25/25 |
| `djonikClient` | 142/142 |
| `customToolResolution` / `turnCompletion` / `trelloMutationLedger` | 10/10 / 67/67 / 60/60 |
| `commitmentContract` | 36/36 |
| `rhythmRunner` / `rhythmRuntime` / `rhythmTelegram` | 40/40 / 12/12 / 12/12 |
| `telegramAdapter` / `telegramDispatch` / `messageGrouping` | 39/39 / 10/10 / 40/40 |
| `trelloWorkHistory` | 14/14 |
| Повний `npm test` | **936/938** |
| `npm run typecheck` / `npm run build` / `git diff --check` | pass / pass / pass |

Два збої ті самі, що в docs/62–63, і **відтворюються на чистому `0c817b8`** (перевірено через `git stash -u`, потім дерево відновлено):
- `processExit.test.ts` «a real process that fetched over keep-alive exits…»;
- `deployConfig.test.ts` «deploy script survives replacing itself…».

Обидва залежать від середовища Windows.

## 17. Змінені файли

- `src/release.ts` — `PM_RHYTHM_SKILL`, `RELEASE_R27`, `RELEASES += r27`, коментарі кандидата і `SERVING_RELEASE`. Значення `SERVING_RELEASE` не змінено.
- `src/releaseR27Candidate.test.ts` — очікування `RELEASES` = `[r25, r26, r27]`; serving і далі r26.
- `src/releaseR27.test.ts` — новий.
- Цей документ.

## 18. Обмеження / відкладено

1. **Реальна поведінка confirmation-протоколу досі не виміряна.** Виміряно лише статичну форму: Agent version і Session snapshot. Echo `user.tool_confirmation`, tool result про відмову, повторні idle, allow-шлях #31/#34 — це Stage 3B-2.
2. **`managed-agents/djonik.md` (frontmatter) описує r26**, тобто serving release, а не latest Agent v27. Тест «r26 equals the declarative source» лишився без змін. Frontmatter оновлюється разом із cutover.
3. **Latest Agent = v27.** Кожен інструмент поза цим репо, що створює Session **без** version pin (наприклад Console), отримає v27 з `always_ask`. Клієнт цього репо завжди пінить версію.
4. Inspection Session `sesn_01MN2WHdhwexuwxhu8sLB91G` лишається idle з read-only Memory і budget 1¢. Її можна використати як evidence чи архівувати за окремим рішенням.
5. Імена 9 Trello reads провайдер прийняв і зберіг (read-back). Що вони відповідають живому інвентарю MCP-сервера, підтверджує лише docs/04 §17; live-виклик кожного — у Stage 3B-2.

## 19. Точний gate Stage 3B-2

Кожен пункт — окрема авторизація Product Owner з бюджетом за docs/04 §27:

1. **Bounded live-перевірка на ізольованих Session, pinned до v27.** Використовується наявний `connectToDjonik`, `release: r27`, окремий budget і `source=diagnostic`:
   - human Trello write через allow → виконання → перевірка #31 → `end_turn` (регресія #31);
   - human Memory write/edit через allow → успішний native результат (регресія #34). Потрібен свідомий вибір: `read_write` на production-store з мінімальним тестовим записом або окремий store;
   - один autonomous `rhythm_*` хід, що просить запис → **deny до виконання**, нуль записів, `autonomousMutationAttempt: true`, фіксований notice;
   - вимірювання echo `user.tool_confirmation`, форми tool result про відмову і повторних `requires_action`;
   - контроль: жодної зайвої мутації Trello чи Memory; вартість у межах бюджету.
2. **Review результатів.** Якщо PASS:
   - **cutover source:** `SERVING_RELEASE = RELEASE_R27`, тож `SERVING_READ_ONLY_BOUNDARY` автоматично стає `pre_execution`;
   - оновлення frontmatter `managed-agents/djonik.md` до r27 і тесту декларативного джерела;
   - review + commit.
3. **Deploy (docs/52):**
   - install юніта (`StateDirectory`) + `daemon-reload`, restart;
   - `release:check -- r27 --serving` на hosted Session;
   - rollback-ціль — r26 / v26 (незмінна).
4. **Лише після цього:**
   - `/rhythm.md` (або свідомі дефолти);
   - `DJONIK_WORKING_RHYTHM=on`;
   - одна bounded перевірка ритуалу й кнопки;
   - потім #35.

## Стан робочого дерева

```text
 M src/release.ts
 M src/releaseR27Candidate.test.ts
?? docs/64_ISSUE_39_R27_REMOTE_CONFIGURATION.md
?? src/releaseR27.test.ts
```
