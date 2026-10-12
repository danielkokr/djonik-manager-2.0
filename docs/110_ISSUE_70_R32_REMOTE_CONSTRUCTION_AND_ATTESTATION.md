# 110 — Issue #70: remote-побудова й атестація r32 без cutover

**Статус:** r32 побудовано й атестовано, очікує review Product Owner. Без commit, push, deploy, зміни `SERVING_RELEASE` / `DJONIK_EXPECTED_RELEASE`, без Telegram і без платної перевірки.
**Дата:** 2026-10-12. **Обсяг:** за рішенням Product Owner r32 несе всю прийняту Agent-поверхню #66–#69 (а не лише #66, як у початковому тексті issue). #71 — лише код застосунку.

## 1. Підсумок / вердикт

- Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v31 → v32** одним `agents.update` (precondition `version: 31`, `maxRetries: 0`). Read-back точний.
- Три нові immutable-версії Skill на наявних ідентичностях, побайтово рівні закоміченому HEAD.
- `trello_work_history` у v32 має визначення `v2` (з `focus`); `reminder` додано рівно один раз.
- `RELEASE_R32` записано в source з реальних виміряних ідентифікаторів; `release:check -- r32` OK.
- **`SERVING_RELEASE` лишається `RELEASE_R31`.** Production на r31; v31 не змінився; `release:check -- r31 --serving` OK до і після.
- Модельних ходів не було: $0.

## 2. HEAD і стартовий стан source

| Перевірка | Результат |
|---|---|
| HEAD | `e174f5bb8cfaaa51fc62f83996ee60659b8c4b07` (`main` = `origin/main`) |
| Робоче дерево на старті | лише відомий невідстежуваний `docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` |
| У `main` є | #66 `867298d` + `783341a`, #67 `0feb7a6`, #68 `34ff4a4`, #69 `3647a9d`, #71 `e174f5b` |
| `SERVING_RELEASE` | `RELEASE_R31` |
| `release:check -- r31 --serving` до записів | OK: `sesn_01A6mcGJDLhF87safsm8mYPF`, idle, app `91d14107…`, @31 |

Байти Skill для завантаження бралися з `git show HEAD:…`, а не з робочої копії. Визначення `reminder` і `trello_work_history` — з файлів, у яких відносно HEAD змінено лише один коментар (`src/trelloWorkHistory.ts`); `src/reminderTool.ts` не змінювався.

## 3. Remote preflight v31 (лише читання)

| Поле | Значення | = r31 |
|---|---|---|
| latest | **31**, `archived_at null`, `updated_at 2026-10-02T09:43:37.580503Z` | так |
| latest ≡ `retrieve(version: 31)` | deep-equal | так |
| v32 | відсутня (404) | — |
| model | `claude-sonnet-5` / medium / standard | так |
| system | 5797 B, `569999b5da22d075940af44d8acbabb397c1567e418348a98194fced0a3e8859` | так |
| Skills | 5 пінів r31 у тому ж порядку | так |
| custom tools | 4: `trello_work_history`, `trello_board_snapshot`, `focus_budget`, `trello_project_time` | так |
| MCP | лише `trello=https://mcp.trello.com/v1` | так |
| `multiagent` | `null` | так |
| `compareWithRelease(r31, latest)` | `[]` | так |
| Custom Skills у workspace | 15 | — |

## 4. Зміна release-інфраструктури

Проблема: реліз називав custom tools лише іменами, а визначення бралось з одного глобального `SUPPORTED_CUSTOM_TOOLS`. Тож r31 і r32 не могли мати різні визначення того самого `trello_work_history`.

Найменша зміна:

- `DjonikRelease.customToolRevisions?: Record<name, revision>` (`src/release.ts`). Відсутнє = оригінальне визначення. Жоден реліз r25–r31 поля не має, тож їхня атестація не змінилась.
- `CUSTOM_TOOL_REVISIONS` і `customToolDefinition(release, name)` (`src/releaseAttestation.ts`). Наразі одна ревізія: `trello_work_history` → `v2` = `TRELLO_WORK_HISTORY_TOOL_NEXT`.
- `compareWithRelease`, `buildAgentUpdateBody` і тестові fixtures беруть визначення через цей resolver.
- Fail closed: невідома ревізія або ревізія для tool, якого реліз не має, дає розбіжність атестації; тіло update з нею не будується.

Tool не дубльовано під іншим іменем. `SUPPORTED_CUSTOM_TOOLS` (що застосунок уміє виконувати) не змінено. `TRELLO_WORK_HISTORY_TOOL_NEXT` не перейменовано, оновлено лише коментар.

## 5. Точна семантична дельта r32 відносно r31

| Поле | r31 | r32 |
|---|---|---|
| Agent version | 31 | **32** |
| `planning-and-focus` | `skver_01L9cL8yv244qmpXSyqvmqzJ` | **`skver_01JkUyb6btqQcLJVfq4cz9kp`** (#67) |
| `work-review` | `skver_0155j1qEvdXYq286L8x6vBFF` | **`skver_01J39PC8Fvw5UEhsC6ZufHBr`** (#66, #69) |
| `pm-rhythm` | `skver_01BetXsjNcGqmaHY9MpNQgns` | **`skver_01QhCPnJ128imU5h4Hhfgi2e`** (#67, #69) |
| `trello_work_history` | оригінал | **`v2`**: `focus`, призначення `detailed`, «N карток» / «переходів» (#66, #69) |
| `reminder` | немає | **додано** (#54, #68) |
| `task-management`, `studio-intake` | — | піни r31 без змін |
| system prompt, model/effort/speed, built-in, інші 3 custom tools, Trello MCP і політики, confirmation policy, roster (`null`), Session resources | — | без змін |

#71 у tuple не додає нічого: ні Skill, ні tool, ні поля конфігурації.

## 6. Три Skill: версії та byte-перевірка

Аудит перед створенням: `versions.list` + `download` кожної наявної версії, `Buffer.equals` з HEAD. Ідентичної не знайшлось у жодного з трьох, тому створено по одній новій. Перед кожним create перевірено, що в HEAD-блобі немає CR і що `latest_version_id` = пін r31. Кожен create — один виклик `versions.create(skillId, {files: [toFile(HEAD bytes, "<name>/SKILL.md")]}, {maxRetries: 0})`, захищений marker-файлом.

| Skill | Skill id | Пін r31 (SHA) | Нова версія | `created_at` | HEAD bytes / SHA-256 | Завантажено = HEAD |
|---|---|---|---|---|---|---|
| planning-and-focus | `skill_01PxXTvhbZSrbxqi7gmDs6KW` | `skver_01L9cL8y…` (`a1f743f6…`) | **`skver_01JkUyb6btqQcLJVfq4cz9kp`** | `2026-10-12T08:29:59.294725Z` | 17899 / `6da1cf10e92aa5fbe71c0543df3f5823471f1cceab07f2b69bb4a04f42edcb0c` | **так** |
| work-review | `skill_0169h7GYNYUDDDZteDCUV2fE` | `skver_0155j1qE…` (`d1b2a223…`) | **`skver_01J39PC8Fvw5UEhsC6ZufHBr`** | `2026-10-12T08:30:03.252851Z` | 4036 / `b52f1b2df4f70b02426a54d19c86fa53fdba483041d17c2b6c686c73681bffc9` | **так** |
| pm-rhythm | `skill_01GzpQX3bVuWNk5bhbGcbzku` | `skver_01BetXsj…` (`f3592baa…`) | **`skver_01QhCPnJ128imU5h4Hhfgi2e`** | `2026-10-12T08:30:08.546603Z` | 20378 / `82d3dd97417d349a0944a1f42acfc8ba144d1a2f862d33c4ead92da5fbefb46e` | **так** |

Версій у кожного: 3 → 4. Custom Skills у workspace: 15 → 15, нових ідентичностей немає. `task-management` і `studio-intake` не синхронізувались.

## 7. Тіло update і межа запиту

```
buildCandidateUpdateBody(RELEASE_R32_CANDIDATE, { skills: <три реальні піни> })
```

- Ключі: `version: 31` (precondition), `skills`, `tools`. Більше нічого.
- `system`, `model`, `name`, `description`, `metadata`, `mcp_servers`, `multiagent` не надсилались, тобто збережені.
- SHA-256 `JSON.stringify(body)` = **`8fe8d89baac77aa5c28361c049ccbcf7e2fc0a1a1d89d6106e008b737f92f997`**.
- Тіло вручну не складалось. `release:check -- r32 --plan --from 31` відтворює його з тим самим SHA.

Перед відправкою тіло застосовано програмно до сирого live v31: `compareWithRelease(r32, applied)` = `[]`.

Порівняння tools тіла із сирим v31:

| Tool | Результат |
|---|---|
| `agent_toolset_20260401` | семантично без змін (сира різниця лише в тому, що провайдер повторює `type` у config; відомо з r27–r31) |
| `trello_work_history` | **змінено** |
| `trello_board_snapshot`, `focus_budget`, `trello_project_time` | канонічно ідентичні |
| `trello` (MCP toolset) | канонічно ідентичний |
| `reminder` | **додано** |

## 8. Єдиний update Agent

Остання перевірка в тому ж процесі, `2026-10-12T08:31:08.126Z`: latest = 31 ≡ знімок preflight; v32 відсутня; r31 атестується; тіло, згенероване заново, побайтово ≡ оглянутому.

```
client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body /* version: 31 */, { maxRetries: 0 })
```

Відправлено `08:31:08.127Z`: один виклик, без повторів, marker-файл блокував повторний запуск. Відповідь: `version: 32`, `updated_at 2026-10-12T08:31:10.115121Z`, `archived_at null`. Другого update не було.

## 9. Read-back v32 і diff проти v31

| Перевірка | Результат |
|---|---|
| Версії / latest | 32, 31, 30, …; latest = 32; latest ≡ v32; відповідь update ≡ v32 |
| Сирі поля v31 → v32 | змінились **лише** `skills`, `tools`, `updated_at`, `version` |
| system | `===` v31, `569999b5…8859` |
| model / name / description / metadata / `mcp_servers` / `multiagent` | ≡ v31; `multiagent: null` |
| skills | ≡ тілу (5 пінів, той самий порядок) |
| сирий diff tools | `trello_work_history` змінено, `reminder` додано; решта п'ять записів **сиро ідентичні** |
| built-in | enabled `edit, glob, grep, read, write`; `always_ask` = `edit, write` |
| Trello toolset | default enabled / `always_ask`; `always_ask` = `trelloWriteCard`, `trelloWriteChecklist` |
| `compareWithRelease(r32, v32)` | **`[]`** |
| v32 як r31 | 7 розбіжностей (version, 3 Skills, перелік tools, schema й опис work-history), як і очікувалось |

### Точний список custom tools v32

| # | Tool | canonical schema SHA-256 | description SHA-256 |
|---|---|---|---|
| 1 | `trello_work_history` | `32042ea1ce27e6034dcbb912147b55c903972bc78d962249fdd5d0be1bb2bc87` | `58cb3e65d3495988de3b182c1a62b28a12b6c369b38de0a0b7665a6b415eb6fe` |
| 2 | `trello_board_snapshot` | `05e4f791…50b3f9` | `53ab0fd2…2a4d83` |
| 3 | `focus_budget` | `06d1e26b…fb9414` | `b2018ed5…306beb` |
| 4 | `trello_project_time` | `92a7f5b4…183818` | `dc5d6038…d09d2e` |
| 5 | `reminder` | `1ad79abe2cae7a0bc4e3c06570a06999c3e264098c04a8f1993d9d347ab1e797` | `4220682332e5e40c001aaf655ee46d5ffb651d4c50fdbdcd3a094a31669996fe` |

Рівно п'ять; №2–4 мають ті самі хеші, що у v31.

### `reminder` активний у v32

- Присутній рівно один раз.
- `description === REMINDER_TOOL.description`; schema канонічно рівна `REMINDER_TOOL.input_schema`. Це той самий об'єкт, який виконує router застосунку.
- У v31 його немає.

Що це **не** доводить: що модель викличе tool на фразу Daniel. Це покаже лише live-хід після deploy.

### Оновлений `trello_work_history` активний у v32

- `input_schema.properties.focus` = `{"enum":["overview","completed","returned","created","archived","moved"]}`.
- Опис і schema рівні фінальному `TRELLO_WORK_HISTORY_TOOL_NEXT` (після #69, з рядком про «N карток» і «переходів»).
- У v31 `focus` немає; хеші v31 лишились `dcf09961…` / `b7622094…`.

## 10. Доказ, що r31 придатний для rollback

- `retrieve(version: 31)` після update deep-equal знімку preflight, включно з `updated_at`. Перевірено двічі (одразу і о `08:37Z`).
- `compareWithRelease(RELEASE_R31, v31)` = `[]`.
- `release:check -- r31 --serving` OK після всіх змін: та сама production-Session `sesn_01A6mcGJDLhF87safsm8mYPF`, @31.
- У source r31 не має `customToolRevisions`, тому атестується проти оригінального визначення.

## 11. Inspection Session (нуль inference)

Перед створенням: серед 50 найновіших Session немає `metadata.release = r32-inspection`. Один `sessions.create` (`maxRetries: 0`, marker). Stream не відкривався, повідомлень не було.

| Поле | Значення |
|---|---|
| id | **`sesn_01T19sr3fCmXmTDSQ9wcHZrm`** |
| created_at | `2026-10-12T08:31:42.140569Z` |
| agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **version 32** |
| environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`**, instructions = `DJONIK_MEMORY_INSTRUCTIONS` |
| budget | `limit`, `max_list_cost = "1"` USD |
| metadata | `source: diagnostic`, `release: r32-inspection`, `app_revision: e174f5bb…` |

Snapshot `session.agent` проти v32: `model`, `system`, `tools`, `mcp_servers`, `name`, `description`, `multiagent`, `id`, `version` — усе deep-equal.

Read-back о `08:37Z`: `status idle`, `archived_at null`, **0 подій**, input/output/cache tokens 0, `list_cost $0`, `stats.active_seconds 0`. `usage.active_seconds 1.14` — провізія Session, не inference (у #64 було 1.06). Session лишено idle, не архівовано, як у #64.

### Виміряні `sessionVersion`

Прочитано зі snapshot, не виведено. Δ лише підтверджує відоме правило (мікросекундне число мінус `created_at` версії).

| Skill | `skver_` (Agent) | Snapshot Session | Джерело | Δ |
|---|---|---|---|---|
| task-management | `skver_017sbYxMKd3NoUytYFwadrgD` | `1790934141493830` | = r31 | — |
| planning-and-focus | `skver_01JkUyb6btqQcLJVfq4cz9kp` | **`1791793798537727`** | виміряно в #70 | −0.756 с |
| studio-intake | `skver_01SYUXncujJcAWuXz1wbD69U` | `1790666109304881` | = r31 | — |
| work-review | `skver_01J39PC8Fvw5UEhsC6ZufHBr` | **`1791793802823947`** | виміряно в #70 | −0.428 с |
| pm-rhythm | `skver_01QhCPnJ128imU5h4Hhfgi2e` | **`1791793807571556`** | виміряно в #70 | −0.974 с |

Атестація реального snapshot конкретним `RELEASE_R32`: `compareWithRelease` = `[]`; `attestServingSession` відмовляє **лише** через `memory access read_only != read_write` (навмисна різниця inspection); `latest` замість числа → drift.

## 12. Конкретний `RELEASE_R32` у source

`src/release.ts`: `RELEASE_R32_CANDIDATE` (unresolved provenance), `RELEASE_R32` (виписаний явно), `RELEASES += r32`, рядок коментаря до `SERVING_RELEASE`.

| Поле | Значення |
|---|---|
| id / agent | `r32` / `agent_01WGRHDBjQa3eMhoGJMmQ1dh@32` |
| model | `claude-sonnet-5` / medium / standard |
| system | `569999b5…8859` (= r31) |
| skills | §11: три нові піни з `sessionVersion`, два — об'єкти r31 |
| custom tools | `trello_work_history`, `trello_board_snapshot`, `focus_budget`, `trello_project_time`, `reminder` |
| `customToolRevisions` | `{ trello_work_history: "v2" }` |
| specialist / built-in / MCP / toolsets / `confirmationRequired` / session | r31 |

`releaseR32.test.ts` доводить: `RELEASE_R32 ≡ resolveReleaseCandidate(RELEASE_R32_CANDIDATE, реальні піни + sessionVersion, 32)`.

**`SERVING_RELEASE` = `RELEASE_R31`** (рядок `export const SERVING_RELEASE: DjonikRelease = RELEASE_R31;` не змінено).

## 13. `managed-agents/djonik.md`

Усталений процес (#55, #64) оновлює frontmatter під щойно побудовану версію ще до cutover, тому файл змінено:

- **тіло (prompt) не змінене**: system `569999b5…` = v31 = v32;
- frontmatter тепер = **Agent v32**: три нові піни, визначення `trello_work_history` v2, блок `reminder` після `trello_project_time`. Більше нічого;
- `src/release.test.ts` доводить, що декларація ≡ r32, а served r31 відрізняється від неї рівно переходом r32;
- `managed-agents/README.md`: новий розділ #70;
- `claude-lock.json` не змінювався (прямий `agents.update`, як v25–v31).

## 14. Атестація / `release:check`

| Команда | Результат |
|---|---|
| `release:check -- r31 --serving` (до записів і після) | **OK**: `sesn_01A6mcGJDLhF87safsm8mYPF`, idle, app `91d14107…`, @31 |
| `release:check -- r32` | **`r32 OK …@32 serving_in_this_revision=false`**, exit 0 |
| `release:check` (за замовчуванням) | r31 OK, `serving_in_this_revision=true` |
| `release:check -- r30` | r30 OK |
| `release:check -- r32 --serving` | `no Telegram serving Session found` — очікувано: r32 ніде не serve-иться |
| `release:check -- r32 --plan --from 31` | тіло з SHA `8fe8d89b…` |

## 15. Тести і перевірки (Node v24.16.0, Windows)

| Перевірка | Результат |
|---|---|
| Локальні докази кандидата ДО remote-записів (release*, #68 guard, custom tools, agent source, serving release, work history) | 236 / 236 |
| Сфокусовані після побудови (усі `release*`, `releaseR32` новий 11, `releaseR32Candidate` новий 9, #68 guard, custom tool routing/resolution, agent source, serving release, work-history contract, Skill fixtures, project time, commitments, working style, reminder tool/client, readability) | **447 / 447** |
| `npx tsc --noEmit` | чисто |
| `git diff --check` | чисто |
| `npm test` | **1605 тестів, 1603 pass, 2 fail** |

#68 guard проходить **без** зсуву порога: `LAST_AGENT_VERSION_WITHOUT_REMINDER` лишився 31, а r32 і його кандидат містять `reminder`.

### Відомі baseline-збої (не стосуються #70)

Ті самі два тести падали на чистому HEAD до будь-яких змін:

- `deployConfig.test.ts` — «deploy script survives replacing itself…»;
- `processExit.test.ts` — «a real process that fetched over keep-alive exits…» (`1 !== 78` на цій Windows-машині).

Інтермітентний `reminderDelivery` «crash during the Telegram call…» (описаний у docs/102 і docs/109) у цих прогонах не спрацював.

### Тести, які довелось оновити

Декларація у `managed-agents/djonik.md` перейшла на r32, а serving лишився r31 — так само, як у #64. Через це:

- `release.test.ts`: декларація ≡ r32; served r31 відрізняється рівно переходом r32; rollback r30 порівнюється із served r31, а не з декларацією;
- `djonikAgentSource.test.ts`: п'ять custom tools, кожен звіряється з визначенням, яке несе r32;
- `commitmentContract.test.ts`: helper `coordinatorPrompt()` тепер бере тіло prompt без frontmatter. Перевірка «prompt не обіцяє нагадувань» лишилась; раніше вона випадково читала й frontmatter, де тепер законно є tool `reminder`;
- `projectTimeContract`, `workingStyle`, `releaseR27/R28/R30Candidate`: список релізів і тих, що мають `trello_project_time`, доповнено r32.

## 16. Стан production після #70

- Hetzner serve-ить r31 / Agent v31, ревізія застосунку `91d14107…`. Нічого не перезапускалось.
- Remote latest тепер v32. Кожен serving-шлях пінить версію явно, тому production не зачеплено. Console Session без піну версії отримає v32.
- #66–#71 лишаються відкритими і не виправленими в production.
- **Не було:** deploy, Telegram-повідомлень, платного inference, реального нагадування, змін Trello чи Memory, нової ідентичності Agent або Skill, другого update Agent.

## 17. Обмеження

- Поведінка моделі на v32 не перевірялась: атестовано конфігурацію, а не відповіді.
- Remote-побудова виконана з робочого дерева з незакоміченими змінами release-інфраструктури (це сам результат #70). Байти Skill узято з HEAD; визначення tools — з файлів без змін коду відносно HEAD.
- Три нові версії Skill тепер `latest` на своїх ідентичностях. Це не впливає на r31 (явні піни), але якщо #70 не буде прийнято, версії та v32 лишаться на провайдері як невикористані.
- Скрипти побудови лежали поза репозиторієм (тимчасова тека), як і в #64; у репозиторій вони не додані.

## 18. Наступний крок (окрема авторизація)

Один обмежений крок після прийняття #70:

1. source cutover `SERVING_RELEASE` → `RELEASE_R32`;
2. deploy на Hetzner ревізії застосунку з #66–#71;
3. одна спільна Telegram-валідація #66 / #67 / #68 / #69 / #71.

r31 лишається негайним rollback.

## 19. `git diff --stat`

```
 docs/02_DEVELOPMENT_ROADMAP.md      |  7 +++-
 managed-agents/README.md            |  8 ++++
 managed-agents/djonik.md            | 14 ++++---
 src/commitmentContract.test.ts      |  4 +-
 src/djonikAgentSource.test.ts       | 15 ++++---
 src/projectTimeContract.test.ts     |  2 +-
 src/release.test.ts                 | 76 ++++++++++++++++++++++-----------
 src/release.ts                      | 83 ++++++++++++++++++++++++++++++++++++-
 src/releaseAttestation.ts           | 47 +++++++++++++++++----
 src/releaseFixtures.test-helpers.ts | 19 +++++----
 src/releasePlan.ts                  | 15 +++++--
 src/releaseR27Candidate.test.ts     |  2 +-
 src/releaseR28Candidate.test.ts     |  2 +-
 src/releaseR30Candidate.test.ts     |  2 +-
 src/trelloWorkHistory.ts            |  8 ++--
 src/workingStyle.test.ts            |  2 +-
 16 files changed, 236 insertions(+), 70 deletions(-)
```

(Нові невідстежувані файли в `--stat` не входять.)

## 20. `git status --short`

```
 M docs/02_DEVELOPMENT_ROADMAP.md
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/commitmentContract.test.ts
 M src/djonikAgentSource.test.ts
 M src/projectTimeContract.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseAttestation.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releasePlan.ts
 M src/releaseR27Candidate.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR30Candidate.test.ts
 M src/trelloWorkHistory.ts
 M src/workingStyle.test.ts
?? docs/110_ISSUE_70_R32_REMOTE_CONSTRUCTION_AND_ATTESTATION.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/releaseR32.test.ts
?? src/releaseR32Candidate.test.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` був невідстежуваним до початку роботи; я його не чіпав.
