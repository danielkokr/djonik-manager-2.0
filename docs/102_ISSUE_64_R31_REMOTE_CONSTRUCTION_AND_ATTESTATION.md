# #64 — remote-побудова й атестація r31 без cutover

Дата: 2026-10-02. Issue: [#64](https://github.com/danielkokr/djonik-manager-2.0/issues/64) — «Construct and attest r31 candidate without production cutover». Canonical NOW лишається #35; #64 — обмежений крок побудови релізу. Процедура та сама, що в [docs/92](92_ISSUE_55_R30_REMOTE_CONSTRUCTION_AND_ATTESTATION.md) (r30), **без** кроку source cutover.

## 1. Підсумок / вердикт

**PASS — r31 побудовано remote і атестовано. Production і source далі serve-ять r30.**

- Створено рівно дві нові immutable версії Skills: `task-management` і `work-review`. Обидві завантажено назад, байти ідентичні закоміченому `HEAD`. Ідентичної версії раніше не існувало.
- Рівно один `agents.update`: v30 → **v31**. Read-back точний. Дельта відносно v30: лише prompt (#59), два піни Skills і `+ trello_project_time` (#62).
- Рівно одна inspection Session: нуль подій, нуль токенів, $0. `sessionVersion` обох нових пінів виміряно зі snapshot.
- У source записано `RELEASE_R31` лише з виміряними ідентифікаторами; `RELEASES += r31`. `SERVING_RELEASE = RELEASE_R30` не змінено.
- `release:check -- r31` → OK. `r30` і `r30 --serving` → OK; production-Session @30.

Не робилось: deploy, cutover, Telegram, поведінковий inference, мутації Trello/Memory, нові Skill-ідентичності, commit, push, закриття #64.

## 2. Стартовий стан Git / source

| Перевірка | Результат |
|---|---|
| `git fetch origin`; `HEAD` = `origin/main` | `a4b885d4de8803927476faf3024b49a998806086` |
| Tracked-файли | чисті (`git status --porcelain --untracked-files=no` порожній) |
| Untracked | `docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` — існував до сесії, з релізом не пов'язаний. PO підтвердив продовження (2026-10-02). Файл не чіпався. |
| #58–#63 у `HEAD` | так: `8fc4ec5` (#58), `b4d1953` (#61), `78c09bf` (#63), `1445572` (#59), `6f19ed6` (#62), `a4b885d` (#60) |
| `SERVING_RELEASE` | `RELEASE_R30` |
| `RELEASES` | `r25 … r30` |
| Baseline `npm test` на чистому `a4b885d` | **1501/1503**. Збої лише `deployConfig.test.ts` і `processExit.test.ts` (Windows baseline) |

Усі байти (Skills, system) брались із `git show HEAD:…`. Там LF, 0 CR; Windows-копія — CRLF, її не використовували.

## 3. Remote preflight v30 (лише читання)

`2026-10-02T09:33:13Z`, до будь-якого запису.

| Перевірка | Результат |
|---|---|
| Latest coordinator | **30**, `updated_at 2026-09-29T07:18:00.292098Z`, не архівований |
| latest ≡ `retrieve(…, {version: 30})` | deep-equal |
| Версії | 30, 29, 28, …; **v31: 404** |
| `compareWithRelease(RELEASE_R30, v30)` | `[]` |
| `attestAgentVersion(RELEASE_R30, v30)` | PASS |
| v30: model / name / metadata / roster | `claude-sonnet-5`/medium/standard / `Джонік` / `{}` / `multiagent: null` |
| v30 system | `0296d624…33d1`, 5296 B |
| `release:check -- r30` | `r30 OK …@30 serving_in_this_revision=true`, exit 0 |
| `release:check -- r30 --serving` | OK: `sesn_01JzzDyA2UTPsqTDzEbavBrY`, idle, created `2026-10-02T06:57:28Z`, app `7876f3dc…`, **@30** |

Знімок v30 збережено для порівняння на етапах 5 і 7.

## 4. Точний source intent r31 (Stage 1)

`RELEASE_R31_CANDIDATE` у `HEAD` (у #64 не змінювався):

| Поле | Значення | = r30 |
|---|---|---|
| `fromVersion` / `becomes` / `version` | 30 / `r31` / `null` | — |
| `systemSha256` | `569999b5da22d075940af44d8acbabb397c1567e418348a98194fced0a3e8859` = SHA тіла `managed-agents/djonik.md` з `HEAD` (5797 B) | ні (#59) |
| unresolved Skills | лише `task-management`, `work-review` | — |
| інші три Skills | ≡ пінам r30 | так |
| custom tools | r30 + `trello_project_time` | +1 |
| specialist | `null` | так |
| model, built-in, MCP servers, MCP toolsets, `confirmationRequired`, session | ідентичні r30 | так |
| `confirmationPolicyProblems` | `[]` | — |

Application-only #58/#60/#61/#63 у tuple не потрапили.

## 5. SHA-256 / байти Skills з HEAD

| Skill | Skill id (пін r30) | HEAD bytes | HEAD SHA-256 | Пін r30 |
|---|---|---|---|---|
| task-management | `skill_01WS6JtY1GMu3rGZaKCVR9w1` | 19790 | `fce799a31abd44267678d350bf1aa311d4e3cbf205161dd74bad2629d83beac2` | `skver_01KzWwpv88cC2K2nncoTdkt2` (`e30e8aa1…`) |
| work-review | `skill_0169h7GYNYUDDDZteDCUV2fE` | 2165 | `d1b2a22360bad6a00fd94a1d32b36af9e15fefa0f9f5b4527db7d74026523b27` | `skver_015LYzVdivGGMsBpuki4kW4S` (`c079d285…`) |
| planning-and-focus | — | 17888 | `a1f743f6…9f08` = пін r30 | без змін |
| studio-intake | — | 13362 | `e96b38c0…c0d0` = пін r30 | без змін |
| pm-rhythm | — | 17805 | `f3592baa…7d0f` = пін r30 | без змін |

## 6. Аудит наявних remote-версій

Для кожного Skill: `versions.list` і `download` **кожної** версії, порівняння `Buffer.equals` з HEAD.

| Skill | Версій до | Ідентична HEAD |
|---|---|---|
| task-management | 12 (`skver_01QRF2…` … `skver_01KzWw…`) | немає |
| work-review | 2 (`skver_01Cmt2…` `3aabf4a3…`, `skver_015LYz…` `c079d285…`) | немає |

Ідентичність — лише за `skill_id` пінів r30. **Пастка з назвою:**
- пінений work-review `skill_0169h7…` має `display_name` «work-review (#36 post-#40 diagnostic candidate)»;
- інший Skill `skill_01RMRGWbrjW9EHSieymZ2NDV` має `display_name` рівно «work-review», але не пінений.

Його не використовували і не змінювали. Custom Skills у workspace: 15.

## 7. Створені / перевикористані версії

Механізм як у docs/92: `client.beta.skills.versions.create(skillId, {files: [toFile(HEAD bytes, "<name>/SKILL.md")]}, {maxRetries: 0})` на наявній ідентичності.

Перед кожним create скрипт:
- перевіряв, що в HEAD нема CR;
- перевіряв, що `latest_version_id` = пін r30 (інакше STOP);
- ще раз шукав ідентичну версію.

Повторний запуск блокував marker-файл.

| Skill | Рішення | Нова версія | `created_at` | Версій після | latest після |
|---|---|---|---|---|---|
| task-management | **створено** | `skver_017sbYxMKd3NoUytYFwadrgD` | `2026-10-02T09:42:21.898039Z` | 13 | нова |
| work-review | **створено** | `skver_0155j1qEvdXYq286L8x6vBFF` | `2026-10-02T09:42:26.862110Z` | 3 | нова |

Кожен create — один виклик без повторів. Custom Skills: 15 → 15. Нових ідентичностей нема. Інші Skills не синхронізувались.

## 8. Byte-перевірка завантаженням

| Skill | Zip | Файл у zip | SHA завантаження | = HEAD |
|---|---|---|---|---|
| task-management | 8003 B | `task-management/SKILL.md` 19790 B | `fce799a3…beac2` | **так** (`Buffer.equals`) |
| work-review | 1323 B | `work-review/SKILL.md` 2165 B | `d1b2a223…3b27` | **так** (`Buffer.equals`) |

## 9. Розв'язані піни кандидата

```
task-management  skill_01WS6JtY1GMu3rGZaKCVR9w1 @ skver_017sbYxMKd3NoUytYFwadrgD
work-review      skill_0169h7GYNYUDDDZteDCUV2fE @ skver_0155j1qEvdXYq286L8x6vBFF
```

Інші три — піни r30 без змін.

## 10. Згенероване тіло update і семантична дельта

```
buildCandidateUpdateBody(RELEASE_R31_CANDIDATE, {skills}, <тіло managed-agents/djonik.md з HEAD>)
```

Тіло вручну не складалось.

- Ключі: `version: 30` (precondition), `skills`, `system`, `tools`.
  - `model`, `name`, `description`, `metadata` відсутні, тобто збережені.
  - `mcp_servers` і `multiagent` відсутні, тобто збережені: список і roster не змінюються.
- SHA-256 `JSON.stringify(body)` = **`316f8a0a319ae65309ab07dd2b39c7cdf44a98f5d1acbc3b17980deb9547986c`**.
- `system` = 5797 B, SHA `569999b5…8859`.
- `trello_project_time` у тілі = `TRELLO_PROJECT_TIME_TOOL` з `src/projectTimeTool.ts` (через `SUPPORTED_CUSTOM_TOOLS`):
  - `name`, `description` і `input_schema` рівні (`JSON.stringify` і канонічно);
  - schema `92a7f5b4…3818`, опис `dc5d6038…d2e`;
  - схема руками не копіювалась.

Тіло програмно застосовано до сирого live v30 (`version: 31`):
- `compareWithRelease(r31, applied)` = `[]`;
- `attestAgentVersion` = PASS.

| Поле | v30 | v31 (тіло) | Очікувано |
|---|---|---|---|
| system | `0296d624…` 5296 B | `569999b5…` 5797 B | так (#59) |
| task-management | `skver_01KzWw…` | `skver_017sbY…` | так (#59) |
| work-review | `skver_015LYz…` | `skver_0155j1…` | так (#62) |
| planning-and-focus / studio-intake / pm-rhythm | — | без змін | так |
| custom tools | 3 | + `trello_project_time` | так (#62) |
| built-in toolset | read/glob/grep allow, write/edit ask | семантично без змін | так |
| Trello toolset / політики | — | семантично і сиро без змін | так |
| roster / MCP / model / name / description / metadata | — | не надсилались | без змін |

Сирий built-in toolset відрізняється лише тим, що провайдер повторює `type` у config. Те саме відомо з r27–r30.

## 11. Остання перевірка v30 перед записом

`2026-10-02T09:43:29.203Z`, у тому ж процесі безпосередньо перед update:
- latest = 30;
- latest ≡ знімок preflight;
- v30 ≡ знімок preflight;
- v31 відсутня (404);
- тіло, згенероване заново, побайтово ≡ тілу плану (SHA `316f8a0a…`);
- `version: 30`;
- `compareWithRelease(R30, v30)` = `[]`.

## 12. Єдиний update Agent

```
client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body /* version: 30 */, { maxRetries: 0 })
```

Відправлено `2026-10-02T09:43:29.208Z`: один виклик, без повторів. Marker-файл блокував повторний запуск.

Відповідь: `version: 31`, `updated_at 2026-10-02T09:43:37.580503Z`, `archived_at null`. Неоднозначного результату не було.

## 13. Повний read-back v31

| Перевірка | Результат |
|---|---|
| Версії / latest | 31, 30, 29, …; latest = 31; latest ≡ v31; відповідь update ≡ v31 |
| Сирі поля v30 → v31 | змінились **лише** `skills`, `system`, `tools`, `updated_at`, `version` |
| system | `=== body.system`, SHA `569999b5…` |
| model / name / description / metadata | ≡ v30 |
| `multiagent` | `null` |
| `mcp_servers` | лише `trello=https://mcp.trello.com/v1` |
| skills | ≡ тілу (5 пінів, той самий порядок) |
| built-in | enabled `edit, glob, grep, read, write`; `always_ask` = `edit, write` |
| custom tools (canonical schema / опис) | `trello_work_history` `dcf09961…`/`b7622094…`; `trello_board_snapshot` `05e4f791…`/`53ab0fd2…`; `focus_budget` `06d1e26b…`/`b2018ed5…`; **`trello_project_time` `92a7f5b4…`/`dc5d6038…`** |
| сирий diff tools v30 → v31 | лише `trello_project_time`, доданий |
| Trello toolset | default enabled / `always_ask`; 9 reads `always_allow`; `trelloWriteCard` і `trelloWriteChecklist` `always_ask`; інші 4 writes вимкнені |
| `compareWithRelease(r31, v31)` / `attestAgentVersion` | **`[]` / PASS** |
| `attestAgentVersion(RELEASE_R30, v31)` | 5 розбіжностей (version, system, 2 Skills, custom tools), як і очікувалось |

Зайвих tools нема, жоден tool r30 не зник.

## 14. Доказ, що v30 не змінився

- `retrieve(…, {version: 30})` після update deep-equal знімку preflight, включно з `updated_at`. Перевірено двічі: одразу після update і о `09:49:01Z`.
- `compareWithRelease(RELEASE_R30, v30)` = `[]`.
- `release:check -- r30` і `r30 --serving` OK (§19).

## 15. Inspection Session

Перед створенням перевірено: серед 50 найновіших Session нема `metadata.release = r31-inspection`. Далі один `sessions.create` (`maxRetries: 0`, marker). Stream не відкривався, `connectToDjonik` не використовувався, повідомлень не було.

| Поле | Значення |
|---|---|
| id | **`sesn_01KBpyKTVamwzvTwtJTUk3HX`** |
| created_at | `2026-10-02T09:44:00.047095Z` |
| agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **version 31** |
| environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`**; instructions = `DJONIK_MEMORY_INSTRUCTIONS` з HEAD |
| budget | `limit`, `max_list_cost = "1"` USD |
| metadata | `source: diagnostic`, `release: r31-inspection`, `app_revision: a4b885d4…`, purpose |

Snapshot `session.agent` проти v31: `model`, `system`, `tools`, `mcp_servers`, `name`, `description`, `multiagent` (`null`), `id`, `version` — усе **deep-equal**.

Фінальний read-back о `09:49:01Z`:
- `status idle`, `archived_at null`;
- `events.list` → **0**;
- `input/output/cache tokens 0`, `list_cost $0`, `web_* 0`;
- `stats.active_seconds 0`;
- `usage.active_seconds 1.06` — провізія Session, не inference (docs/92: 1.175).

Сесії, створені 2026-10-02, — лише ця inspection і production-Session r30 (`sesn_01JzzDy…`, 06:57, до #64).

Мітка `r31-inspection` / `diagnostic`, тому `release:check -- r31 --serving` її не приймає (§19). Session лишено idle, не архівовано (за PO).

## 16. Виміряні `sessionVersion`

Значення прочитано зі snapshot `session.agent.skills`, а не виведено. «Δ» лише підтверджує правило docs/53 §4: мікросекундне число мінус `created_at` версії.

| Skill | `skver_` (Agent) | Snapshot Session | Джерело | Δ |
|---|---|---|---|---|
| task-management | `skver_017sbYxMKd3NoUytYFwadrgD` | **`1790934141493830`** | виміряно в #64 | −0.404 с |
| planning-and-focus | `skver_01L9cL8yv244qmpXSyqvmqzJ` | `1790666103656343` | = r30 | — |
| studio-intake | `skver_01SYUXncujJcAWuXz1wbD69U` | `1790666109304881` | = r30 | — |
| work-review | `skver_0155j1qEvdXYq286L8x6vBFF` | **`1790934146362297`** | виміряно в #64 | −0.500 с |
| pm-rhythm | `skver_01BetXsjNcGqmaHY9MpNQgns` | `1790666114030041` | = r30 | — |

Атестація реального snapshot конкретним `RELEASE_R31`:
- `compareWithRelease` = **`[]`**;
- `attestServingSession` відмовляє **лише** через `memory access read_only != read_write` — навмисна різниця inspection;
- negative: `latest` замість числа → drift (fail closed).

## 17. Зміни source: `RELEASE_R31`

`src/release.ts`:
- новий `RELEASE_R31`, виписаний явно, не виводиться при імпорті;
- `RELEASES += r31`;
- рядок коментаря до `SERVING_RELEASE`, значення лишилось `RELEASE_R30`;
- `RELEASE_R31_CANDIDATE` без змін, лишається unresolved provenance.

| Поле | Значення |
|---|---|
| id / agent | `r31` / `agent_01WGRHDBjQa3eMhoGJMmQ1dh@31` |
| model | `claude-sonnet-5` / medium / standard (= r30) |
| system | `569999b5da22d075940af44d8acbabb397c1567e418348a98194fced0a3e8859` |
| skills | §16: два нові піни з `sessionVersion`, три — об'єкти r30 |
| specialist | `null` |
| built-in / MCP / toolsets / `confirmationRequired` / session | посилання на r30 (ідентичні) |
| custom tools | `trello_work_history, trello_board_snapshot, focus_budget, trello_project_time` |

`releaseR31.test.ts` доводить: `RELEASE_R31 ≡ resolveReleaseCandidate(RELEASE_R31_CANDIDATE, реальні піни + sessionVersion, 31)`.

## 18. Стан `managed-agents/djonik.md`

- **Тіло не змінене:**
  - SHA тіла файла `ccccd1ba…` у HEAD = у робочій копії;
  - витягнутий system `569999b5…` = v31 `system`.
- Frontmatter тепер = **Agent v31**:
  - два нові піни;
  - блок `trello_project_time` після `focus_budget`;
  - більше нічого.
- Frontmatter згенеровано рендерером із тіла, що створило v31. Перед записом той самий рендерер відтворив закомічений r30-frontmatter **побайтово** з тіла r30 (SHA `718770ea…` — той самий, що в docs/92).
- CRLF робочої копії збережено.
- `claude-lock.json` не змінювався: v31 створено прямим `agents.update`, як v25–v30.
- `managed-agents/README.md`: новий розділ #64; примітка до розділу #56.

## 19. Атестація / `release:check`

| Команда | Результат |
|---|---|
| `release:check -- r31` | **`r31 OK …@31 serving_in_this_revision=false`**, exit 0 |
| `release:check -- r30` | `r30 OK …@30 serving_in_this_revision=true`, exit 0 |
| `release:check -- r30 --serving` | **OK**: `sesn_01JzzDyA2UTPsqTDzEbavBrY`, idle, created `2026-10-02T06:57:28Z`, app `7876f3dc…`, **@30**. Та сама Session, що в preflight. |
| `release:check -- r31 --serving` | `no Telegram serving Session found`, **exit 78** — очікувано: r31 ніде не serve-иться |
| `release:check` (за замовчуванням) | r30 OK |

## 20. Тести, build, typecheck (Node v24.16.0, Windows)

| Перевірка | Результат |
|---|---|
| Сфокусовані: `releaseR31` (новий, 10), `releaseR30`, `releaseR30Candidate`, `release`, `releaseR29`, `releaseR28`, `releaseR28Candidate`, `releaseR27`, `releaseR27Candidate`, `releaseAttestation`, `servingRelease`, `djonikAgentSource`, `projectTimeContract`, `projectTime`, `projectTimeClient`, `clientProfile`, `workingStyle` | **228/228** |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` | **1511/1514** (baseline 1501/1503; +10 нових тестів, +1 інтермітентний збій, див. нижче) |

Збої `npm test`:
- `deployConfig.test.ts` «deploy script survives replacing itself…» — Windows baseline;
- `processExit.test.ts` «a real process that fetched over keep-alive exits…» (`1 !== 78`) — Windows baseline;
- `reminderDelivery.test.ts` «crash during the Telegram call…» (`'scheduled' !== 'sending'`, рядок 198) — **інтермітентний timing-flake, не наслідок #64**.

Доказ для `reminderDelivery`:
- тест чекає запис файла фіксованим `setTimeout(20 мс)`;
- окремо — 5/5 pass;
- чистий `HEAD` у тимчасовому detached worktree — 3/3 pass;
- той самий код, різні прогони — то fail, то pass: лише tracked-diff (A1 fail, A2 pass); точне дерево #64 (B1, B2 pass).

Код reminders #64 не змінював. Окремо його не виправляли: це поза scope.

Змінені тести:
- `release.test.ts`:
  - lockstep декларації → r31;
  - новий перехідний тест: served r30 відрізняється від декларації **рівно** #59 + #62 (prompt, 2 піни, `+trello_project_time`);
  - тест rollback r29 тепер порівнює з r30;
  - specialist-тест: `null` у r30 і r31.
- `projectTimeContract.test.ts`: tool лише в r31; `RELEASES.r31 = RELEASE_R31`; декларація містить tool.
- `djonikAgentSource.test.ts`: 4 custom tools байт-у-байт.
- `releaseR27Candidate`, `releaseR28Candidate`, `releaseR30Candidate`, `workingStyle`, `clientProfile`: набір `RELEASES` містить r31.
- `releaseFixtures.test-helpers.ts`: лише коментарі (#59/#62 синхронізовані в r31).

## 21. `SERVING_RELEASE` лишається r30

- `src/release.ts`: `export const SERVING_RELEASE: DjonikRelease = RELEASE_R30;` — значення не змінене.
- Тести це фіксують:
  - `release.test.ts` (×3);
  - `releaseR30.test.ts`;
  - `releaseR31.test.ts` («NOT the serving release»);
  - `projectTimeContract.test.ts`;
  - `releaseR30Candidate.test.ts`.
- `release:check` без аргументу перевіряє r30.
- `DJONIK_EXPECTED_RELEASE`, хост і deploy не змінювались.

## 22. Що відкладено (кожен пункт — окрема авторизація)

1. **Source cutover:** `SERVING_RELEASE = RELEASE_R31` (усі `sessionVersion` уже виміряні). Перехідний тест у `release.test.ts` згортається в одну рівність. Потім review → commit/push.
2. **Deploy** накопичених app-фіксів #58/#60/#61/#63 разом із r31: `DJONIK_EXPECTED_RELEASE=r31` + `deploy.sh <SHA>`; `release:check -- r31 --serving` на hosted Session. Rollback — r30-ревізія / Agent v30.
3. **Ручна Telegram-валідація** #59 (alias → label) і #62 (час по проєкту) після deploy.
4. **Операційний факт:** latest coordinator тепер **v31**. Serving-шлях пінить `agent.version = 30`, тож production не зачеплено. Session без version pin (наприклад, з Console) отримала б v31.
5. **За рішенням PO:** архівація inspection Session `sesn_01KBpyKT…`; виправлення timing-flake `reminderDelivery.test.ts` окремим issue.
6. Спостереження поза scope: Skill `skill_01RMRGWbrjW9EHSieymZ2NDV` має `display_name` «work-review», але не пінений жодним релізом. Пінений work-review має іншу назву. Пошук за назвою дав би не ту ідентичність.

## 23. `git diff --check`

Exit 0. Лише CRLF-попередження git для `projectTimeContract.test.ts`, `release.test.ts`, `releaseR30Candidate.test.ts`.

## 24. `git status --short`

```text
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/clientProfile.test.ts
 M src/djonikAgentSource.test.ts
 M src/projectTimeContract.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releaseR27Candidate.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR30Candidate.test.ts
 M src/workingStyle.test.ts
?? docs/102_ISSUE_64_R31_REMOTE_CONSTRUCTION_AND_ATTESTATION.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/releaseR31.test.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` існував до #64 і не змінювався.

Єдині remote-мутації:
- 2 нові Skill-версії: `skver_017sbYxMKd3NoUytYFwadrgD`, `skver_0155j1qEvdXYq286L8x6vBFF`;
- 1 update Agent: v31;
- 1 zero-event inspection Session: `sesn_01KBpyKTVamwzvTwtJTUk3HX`.

Без deploy, cutover, Telegram, inference, мутацій Trello/Memory, commit і push. #64 не закрито.
