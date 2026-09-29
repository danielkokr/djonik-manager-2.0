# #55 — remote-побудова й атестація r30 без cutover

Дата: 2026-09-29. Canonical NOW: [#55](https://github.com/danielkokr/djonik-manager-2.0/issues/55) — «Construct and attest r30 candidate without cutover». Процедура та сама, що в [docs/74](74_ISSUE_41_42_R28_REMOTE_RESOLUTION.md) / [docs/75](75_ISSUE_41_42_R28_SESSION_VERSION_AND_SOURCE_CUTOVER.md) (r28) і [docs/83](83_R29_PM_BEHAVIOUR_RELEASE_CANDIDATE.md) (r29), **без** кроку source cutover.

## 1. Підсумок / вердикт

**PASS — r30 побудовано remote і атестовано; production і source далі serve-ять r29.**

- Створено рівно чотири нові immutable версії Skills. Кожну завантажено назад, байти ідентичні закоміченому `main`.
- Рівно один `agents.update`: v29 → **v30**. Read-back точний, roster порожній (`multiagent: null`).
- Рівно одна inspection Session: нуль подій, нуль токенів, $0. Session-написання всіх п'яти пінів виміряно.
- У source записано `RELEASE_R30` лише з виміряними ідентифікаторами; `RELEASES += r30`; `SERVING_RELEASE = RELEASE_R29` без змін.
- `release:check -- r30` → OK. `r29` і `r29 --serving` → OK, production-Session @29.

Жодного deploy, cutover, Telegram/user-ходу, поведінкового inference, запису в Trello/Memory, архівації specialist, commit або push.

## 2. Межа авторизації Product Owner

Авторизовано (коментар PO у #55, 2026-09-29T07:03Z, і інструкція етапу):
- sync/створення r30 Skill-версій;
- одне оновлення coordinator v29 → v30;
- read-back;
- одна zero-event inspection Session;
- атестація.

Не авторизовано і **не робилось**:
- deploy, restart хоста, зміна `SERVING_RELEASE` / `DJONIK_EXPECTED_RELEASE`;
- Telegram smoke, S9/S10/S11/S41, платний inference;
- мутації Trello/Memory, міграція `preferences.md` / `working-style.md` / client-profile;
- архівація/видалення specialist, sync `project-health`, очистка rollback-runtime;
- нові фічі, commit, push, зміни issue/roadmap.

## 3. Стартовий стан Git / source

| Перевірка | Результат |
|---|---|
| `HEAD` = `origin/main` | `8517c246b143d61fb9f0624dd40f016a1857ad4a` (після `git fetch`) |
| Робоче дерево | чисте |
| `SERVING_RELEASE` | `RELEASE_R29` |
| `RELEASES` | `r25, r26, r27, r28, r29` |
| r29 tuple | `agent_01WGRHDBjQa3eMhoGJMmQ1dh@29`, system `fe28b195…5025`, 5 explicit pins (див. §6), specialist `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`, custom `trello_work_history`, MCP trello + Calendar (вимкнений) |
| System SHA-256 тіла `managed-agents/djonik.md` (HEAD) | `0296d62462ecc4262bf32b7aa2b8472b2a4c72d77bb063049aa360ab3e1e33d1`, 5296 B = `RELEASE_R30_CANDIDATE.systemSha256` |
| Baseline `npm test` на чистому `8517c24` | **1360/1362**; збої лише `deployConfig.test.ts` і `processExit.test.ts` (Windows baseline) |

Байти Skills брались із `git show HEAD:.claude/skills/<name>/SKILL.md`. Там LF, 0 CR. Робоча копія на Windows має CRLF (autocrlf), тому її не використовували.

## 4. Remote preflight v29 (лише читання, до будь-якого запису)

| Перевірка | Результат |
|---|---|
| Latest coordinator | **29**, `updated_at 2026-09-26T09:04:32.955946Z`, не архівований |
| latest ≡ `retrieve(…, {version: 29})` | deep-equal |
| Версії | 29, 28, 27, …; **v30 не існує** |
| `compareWithRelease(RELEASE_R29, v29)` / `attestAgentVersion` | `[]` / PASS |
| model | `claude-sonnet-5` / `medium` / `standard` |
| name / description / metadata | `Джонік` / (без змін) / `{}` |
| roster | `coordinator` → `agent_01KNiQDzzPjaMU6LLF4mU6uM@4` |
| Specialist | latest v4, `archived_at null`, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm` |
| Custom Skills у workspace | 15 |
| `release:check` r29 / r28 / r27 / r26 | OK / OK / OK / OK |
| `release:check -- r29 --serving` | OK: `sesn_01HPLE78Kxi3LVxQW2je3z29`, idle, created `2026-09-28T09:04:46Z`, app `4e46aba5…`, **@29** |
| `release:check -- r25` | MISMATCH ще **до** #55: `task-management latest → skver_01H9ZM… != skver_01CJQk…` (див. §24) |

Висновок preflight: **PASS**. Production serve-ить r29, а жодна зміна source у цьому issue не перемикає serving.

## 5. Точний unresolved r30 source intent

`RELEASE_R30_CANDIDATE` (без змін у #55; лишається provenance):
- від `agent_01WGRHDBjQa3eMhoGJMmQ1dh` v29, `version: null`;
- model = r29; system `0296d624…33d1` (#44);
- unresolved: task-management, planning-and-focus, studio-intake, pm-rhythm; `work-review` = пін r29;
- `specialist: null`;
- built-in = r29;
- custom tools: `trello_work_history`, `trello_board_snapshot`, `focus_budget`;
- MCP: лише `trello` (Calendar прибрано);
- Trello: `trelloWriteChecklist: true`;
- `confirmationRequired`: `write`, `edit`, `trello/trelloWriteCard`, `trello/trelloWriteChecklist`;
- session = r29.

## 6. SHA-256 джерел по Skill

| Skill | Skill id (r29) | HEAD bytes | HEAD SHA-256 | Пін r29 (SHA завантаження) |
|---|---|---|---|---|
| task-management | `skill_01WS6JtY1GMu3rGZaKCVR9w1` | 19750 | `e30e8aa1d86bc8ce9a04a822bc27106edc8609583cc771eb39366cd6010180d5` | `skver_01H9ZMhZKJv7Ryi3tdKiS4Ni` (`aec09d5a…`) |
| planning-and-focus | `skill_01PxXTvhbZSrbxqi7gmDs6KW` | 17888 | `a1f743f67de58ef0aa99cb4ca941789f8b976fb4ce1cead8059f81f2461c9f08` | `skver_01ELK2Ap5N8oYTQxYtNpGptG` (`02097376…`) |
| studio-intake | `skill_015c8dtDnWyDfVLwS6NLS7r6` | 13362 | `e96b38c0e2606b1eb8488e93347f9a09f8e25b2611bf749e1a06c543f0bdc0d0` | `skver_018sJv1GCnzfZRG4NbExbAzj` (`e475f8b5…`) |
| pm-rhythm | `skill_01GzpQX3bVuWNk5bhbGcbzku` | 17805 | `f3592baa50fe4708805e3717d07a1efee2c48ada392ed811d5124d31f23a7d0f` | `skver_011MPsX8NEXALfqBKMRzGVz8` (`91ed0962…`) |
| work-review | `skill_0169h7GYNYUDDDZteDCUV2fE` | 1930 | `c079d285bc71f2147c4ea897565b0869cb906a6f0658cdf85dd7374fa94ee640` | `skver_015LYzVdivGGMsBpuki4kW4S` (`c079d285…` = HEAD) |

## 7. Наявні remote-версії

Для кожного Skill: `versions.list` і `download` **кожної** версії, SHA єдиного `SKILL.md` звірено з HEAD.

| Skill | Версій до | Ідентична HEAD | Інші Skills з тим самим `display_name` |
|---|---|---|---|
| task-management | 11 | немає | немає |
| planning-and-focus | 2 | немає | немає |
| studio-intake | 3 | немає | немає |
| pm-rhythm | 2 | немає | немає |
| work-review | 2 | **`skver_015LYzVdivGGMsBpuki4kW4S`** | `skill_01RMRGWbrjW9EHSieymZ2NDV` («work-review», інший, непінений Skill; не використовувався) |
| project-health | 3 | — (не синхронізується) | немає |

Ідентичність Skill визначалась за `skill_id` пінів r29, а не за назвою.

Спостереження поза скоупом: репо-джерело `project-health/SKILL.md` (`b54c4936…`) не дорівнює запіненій версії specialist v4 (`skver_01JLTt…`, `c64318f4…`). Це старий стан rollback-джерела r29; #55 його не чіпав.

## 8. Перевикористані й нові версії

Механізм як у docs/83: `client.beta.skills.versions.create(skillId, {files: [toFile(bytes, "<name>/SKILL.md")]}, {maxRetries: 0})` на **наявній** ідентичності Skill.

Перед кожним create скрипт:
- перевіряв SHA HEAD і `display_name`;
- повторно шукав ідентичну версію, щоб не створити дублікат;
- переконувався, що `latest` = пін r29 (інакше STOP).

| Skill | Рішення | Нова версія | `created_at` | Версій після |
|---|---|---|---|---|
| task-management | **нова** | `skver_01KzWwpv88cC2K2nncoTdkt2` | `2026-09-29T07:14:56.126338Z` | 12 |
| planning-and-focus | **нова** | `skver_01L9cL8yv244qmpXSyqvmqzJ` | `2026-09-29T07:15:04.561752Z` | 3 |
| studio-intake | **нова** | `skver_01SYUXncujJcAWuXz1wbD69U` | `2026-09-29T07:15:09.815420Z` | 4 |
| pm-rhythm | **нова** | `skver_01BetXsjNcGqmaHY9MpNQgns` | `2026-09-29T07:15:14.623453Z` | 3 |
| work-review | **перевикористано** пін r29 | `skver_015LYzVdivGGMsBpuki4kW4S` | — | 2 (без змін) |

Кожен create — один виклик без повторів. Кількість custom Skills: 15 → 15. Нових Skill-ідентичностей нема, `project-health` не змінено.

## 9. Byte-перевірка завантаженням

`versions.download` одразу після create. Zip містить **один** файл `<name>/SKILL.md`, і його байти `Buffer.equals` байтам HEAD.

| Skill | Zip | Файл | SHA завантаження | = HEAD |
|---|---|---|---|---|
| task-management | 7985 B | `task-management/SKILL.md` 19750 B | `e30e8aa1…80d5` | **так** |
| planning-and-focus | 7623 B | `planning-and-focus/SKILL.md` 17888 B | `a1f743f6…9f08` | **так** |
| studio-intake | 5629 B | `studio-intake/SKILL.md` 13362 B | `e96b38c0…c0d0` | **так** |
| pm-rhythm | 7762 B | `pm-rhythm/SKILL.md` 17805 B | `f3592baa…7d0f` | **так** |
| work-review | 1223 B | `work-review/SKILL.md` 1930 B | `c079d285…e640` | **так** (preflight) |

## 10. Розв'язання кандидата

Розв'язання — реальні пари `skill_id` / `skver_` з §8, звірені зі збереженою відповіддю провайдера:

```
task-management    skill_01WS6JtY1GMu3rGZaKCVR9w1 @ skver_01KzWwpv88cC2K2nncoTdkt2
planning-and-focus skill_01PxXTvhbZSrbxqi7gmDs6KW @ skver_01L9cL8yv244qmpXSyqvmqzJ
studio-intake      skill_015c8dtDnWyDfVLwS6NLS7r6 @ skver_01SYUXncujJcAWuXz1wbD69U
pm-rhythm          skill_01GzpQX3bVuWNk5bhbGcbzku @ skver_01BetXsjNcGqmaHY9MpNQgns
```

Тіло згенеровано наявним builder'ом:

```
buildCandidateUpdateBody(RELEASE_R30_CANDIDATE, {skills}, system)
```

Тут `system` — тіло `managed-agents/djonik.md` з HEAD (SHA `0296d624…` = кандидат). Тіло вручну не складалось.

- Ключі: `version: 29` (precondition), `skills`, `system`, `tools`, `mcp_servers`, `multiagent: null`. `model`, `name`, `description`, `metadata` відсутні, тобто збережені.
- SHA-256 `JSON.stringify(body)` = **`718770ea25098f79cf251605b945f7231f944509582c3ee3541dee6f78127da4`**.
- `confirmationPolicyProblems(r30)` = `[]`.

## 11. Семантична дельта тіла відносно сирого live v29

Тіло програмно застосовано до сирого v29 з preflight:
- `compareWithRelease(r30, applied)` = `[]`;
- `attestAgentVersion(r30, applied)` = PASS.

| Поле | v29 | v30 (тіло) | Очікувано |
|---|---|---|---|
| system | `fe28b195…` 5763 B | `0296d624…` 5296 B | так (#44) |
| task-management | `skver_01H9ZM…` | `skver_01KzWw…` | так |
| planning-and-focus | `skver_01ELK2…` | `skver_01L9cL…` | так |
| studio-intake | `skver_018sJv…` | `skver_01SYUX…` | так (#51) |
| work-review | `skver_015LYz…` | без змін | так |
| pm-rhythm | `skver_011MPs…` | `skver_01BetX…` | так |
| roster | specialist v4 | `multiagent: null` | так (#44) |
| mcp_servers | trello, Calendar | trello | так (#47) |
| built-in toolset | read/glob/grep allow, write/edit ask | семантично без змін | так |
| `trello_work_history` | — | без змін (schema `dcf09961…`, опис `b7622094…`) | так |
| `trello_board_snapshot` | — | **додано** | так (#47) |
| `focus_budget` | — | **додано** | так (#50) |
| Trello toolset | — | лише `trelloWriteChecklist: false/always_allow → true/always_ask`; default `always_ask`, 9 reads, інші 4 writes без змін | так (#48) |
| Calendar toolset | вимкнений | **прибрано** | так (#47) |
| model / effort / speed | `claude-sonnet-5` / medium / standard | не надсилались | без змін |
| name / description / metadata | — | не надсилались | без змін |
| environment / vault / Memory store | — | не є полями Agent; `r30.session` = `r29.session` | без змін |

Сирий built-in toolset відрізняється лише тим, що провайдер у read-back повторює поле `type` у кожному config. Тіло його не надсилає. Прапори й політики ідентичні; те саме спостерігалось для r27–r29. Інших відмінностей нема.

## 12. Остання перевірка v29 перед записом

`2026-09-29T07:17:53.413Z`, у тому ж процесі безпосередньо перед update:
- latest = 29;
- latest ≡ preflight-snapshot (deep-equal);
- v29 ≡ preflight;
- v30 відсутня;
- тіло, згенероване заново, ≡ тіло плану (SHA `718770ea…`);
- `version: 29`, `multiagent: null` на місці.

Скрипт відмовлявся запускатись удруге, якщо спроба update вже була.

## 13. Єдиний update Agent

```
client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body /* version: 29 */, { maxRetries: 0 })
```

Відправлено `2026-09-29T07:17:53.416Z`. Один виклик, без повторів.

## 14. Відповідь провайдера

`id agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **`version: 30`**, `updated_at 2026-09-29T07:18:00.292098Z`, `archived_at null`. Відповідь deep-equal подальшому `retrieve(…, {version: 30})`.

## 15. Повний read-back v30

| Перевірка | Результат |
|---|---|
| Версії / latest | 30, 29, 28…; latest = 30, latest ≡ v30 |
| Сирі поля v29 → v30 | змінились **лише** `mcp_servers`, `multiagent`, `skills`, `system`, `tools`, `updated_at`, `version` |
| system | `=== body.system`, SHA `0296d62462ec…`, 5296 B |
| model / name / description / metadata | ≡ v29 |
| skills | ≡ тілу: 5 explicit пінів із §10 + work-review |
| built-in | enabled `edit, glob, grep, read, write`; `always_ask` = `edit, write` |
| custom tools | `trello_work_history` `dcf09961…` / `b7622094…`; `trello_board_snapshot` `05e4f791…` / `53ab0fd2…`; `focus_budget` `06d1e26b…` / `b2018ed5…`. Schema й опис = `SUPPORTED_CUSTOM_TOOLS` (канонічний SHA) |
| MCP servers | лише `trello=https://mcp.trello.com/v1` |
| Trello toolset | default enabled / `always_ask`; 9 reads `always_allow`; `trelloWriteCard` і `trelloWriteChecklist` enabled `always_ask`; Board/Inbox/List/Planner writes вимкнені |
| Calendar | відсутній |
| tools | ≡ тілу з точністю до повтору `type` провайдером |
| `attestAgentVersion(RELEASE_R30, v30)` | **PASS**, `compareWithRelease` = `[]` |

## 16. Доказ, що v29 не змінився

- `retrieve(…, {version: 29})` після update deep-equal preflight-знімку, включно з `updated_at`.
- `compareWithRelease(RELEASE_R29, v29)` = `[]`; `release:check -- r29` OK.
- Specialist `agent_01KNiQDzzPjaMU6LLF4mU6uM`: v4, не архівований, deep-equal preflight.

## 17. Доказ порожнього roster

- Сирий v30: **`multiagent: null`**; нормалізований `roster` = `[]`.
- Snapshot inspection Session: `agent.multiagent: null`.
- Атестація r30 вимагає 0 учасників. Specialist v4 у roster дає `unexpected roster member agent_01KNiQDzzPjaMU6LLF4mU6uM@4` (тест).
- Advisor та інших агентів нема.

## 18. Точний tuple r30

`RELEASE_R30` у `src/release.ts` виписано явно, не виводиться при імпорті. Тест доводить `RELEASE_R30 ≡ resolveReleaseCandidate(RELEASE_R30_CANDIDATE, реальні піни + sessionVersion, 30)`.

| Поле | Значення |
|---|---|
| id / agent | `r30` / `agent_01WGRHDBjQa3eMhoGJMmQ1dh@30` |
| model | `claude-sonnet-5` / `medium` / `standard` |
| system | `0296d62462ecc4262bf32b7aa2b8472b2a4c72d77bb063049aa360ab3e1e33d1` |
| skills | див. §22 |
| specialist | `null` |
| built-in | `read, write, edit, glob, grep` |
| custom tools | `trello_work_history, trello_board_snapshot, focus_budget` (`reminder` відсутній) |
| MCP | `trello=https://mcp.trello.com/v1` |
| Trello toolset | default enabled, `always_ask`; 9 reads true; `trelloWriteCard` true; `trelloWriteChecklist` true; Board/Inbox/List/Planner false |
| confirmationRequired | built-in `write, edit`; trello `trelloWriteCard, trelloWriteChecklist` |
| read-only boundary | `readOnlyBoundaryFor(r30)` = `pre_execution` |
| session | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` / `memstore_01WViYK3WQvGEgojB2GiaDFq`, `read_write` (= r29) |

`RELEASE_R30_CANDIDATE` лишився unresolved provenance. `RELEASES = {r25…r30}`.

## 19. Стан `managed-agents/djonik.md`

- Тіло не змінене (SHA `0296d624…` = v30 `system`).
- Frontmatter тепер = **Agent v30**:
  - нові піни чотирьох Skills;
  - явний `multiagent: null`, а не пропуск ключа: пропуск можна прочитати як «зберегти roster r29»;
  - Calendar прибрано з `mcp_servers` і `tools`;
  - `trello_board_snapshot` і `focus_budget` додано;
  - `trelloWriteChecklist` enabled/`always_ask`.
- Frontmatter згенеровано рендерером із тіла, що створило v30. Перед записом рендерер відтворив закомічений r29-frontmatter **побайтово**.
- Тести розрізняють стани:
  - `release.test.ts`: декларація ≡ r30;
  - окремий перехідний тест: serving r29 відрізняється від декларації **рівно** переходом r30 (prompt, roster, Calendar, 4 піни, `+2` custom, checklist);
  - `djonikAgentSource.test.ts`: v30-топологія.
- `claude-lock.json` **не змінювався**. v30 створено прямим `agents.update`, а не `ant apply`, як і v25–v29. Lock фіксує лише specialist.

## 20. Inspection Session

Перед створенням скрипт перевірив, що серед 50 найновіших Session нема жодної з `metadata.release = r30-inspection`. Потім одним `sessions.create` (`maxRetries: 0`, stream не відкривався, `connectToDjonik` не використовувався) створив Session. Перша спроба пройшла валідацію, повторів не було.

| Поле | Значення |
|---|---|
| id | **`sesn_017J9XJDeTKVngGTZ5hq49dH`** |
| created_at | `2026-09-29T07:20:52.987627Z` |
| agent | `{type: agent, id: agent_01WGRHDBjQa3eMhoGJMmQ1dh, version: 30}` |
| environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`** (instructions = `DJONIK_MEMORY_INSTRUCTIONS` HEAD) |
| budget | `limit`, `max_list_cost = "1"` USD-цент |
| metadata | `source: diagnostic`, `release: r30-inspection`, `app_revision: 8517c246…`, purpose |

Мітка `r30-inspection`, а не `r30`, і source `diagnostic`, а не `telegram`. Тому `release:check -- r30 --serving` не приймає її за serving Session (§24). Session лишено idle, не архівовано.

## 21. Нуль подій і нуль inference

Фінальний read-back о `07:27:15Z`:
- `status idle`, `archived_at null`;
- `events.list` → **0**;
- `usage`: `input_tokens 0`, `output_tokens 0`, `cache_read 0`, `cache_creation 0/0`, `list_cost $0`, `web_* 0`;
- `stats.active_seconds 0`.

`usage.active_seconds 1.175` — це провізія Session, не inference (у docs/75 те саме значення було 1.052).

Серед Session, створених 2026-09-29, є **лише** ця одна.

## 22. Виміряні `sessionVersion`

Значення прочитано зі snapshot `session.agent.skills`, а не виведено. Колонка «Δ» лише підтверджує зв'язок: мікросекундне число мінус `created_at` версії, як у docs/53 §4.

| Skill | `skver_` (Agent) | Snapshot Session | Джерело значення | Δ |
|---|---|---|---|---|
| task-management | `skver_01KzWwpv88cC2K2nncoTdkt2` | **`1790666094447918`** | виміряно в #55 | −1.678 с |
| planning-and-focus | `skver_01L9cL8yv244qmpXSyqvmqzJ` | **`1790666103656343`** | виміряно в #55 | −0.905 с |
| studio-intake | `skver_01SYUXncujJcAWuXz1wbD69U` | **`1790666109304881`** | виміряно в #55 | −0.510 с |
| work-review | `skver_015LYzVdivGGMsBpuki4kW4S` | `1790083840153637` | той самий `skver_`, що в r26–r29; snapshot підтвердив записане | — |
| pm-rhythm | `skver_01BetXsjNcGqmaHY9MpNQgns` | **`1790666114030041`** | виміряно в #55 | −0.593 с |

## 23. Атестація snapshot Session

| Перевірка | Результат |
|---|---|
| `agent.version` | 30 |
| `session.agent` vs v30: model, system, tools, mcp_servers, name, description, multiagent, id, version | усе **deep-equal** |
| `compareWithRelease(RELEASE_R30, session.agent)` | **`[]`** |
| `compareSessionResources` | лише `memory access read_only != read_write` — навмисна різниця inspection |
| `attestServingSession(RELEASE_R30, session)` | відмова **лише** через `read_only` Memory |
| Negative: `latest` замість числа / число +1 | обидва дають drift (fail closed) |
| `compareWithRelease(RELEASE_R29, session.agent)` | 15 розбіжностей — очікувано |

Атестацію не послаблювали, представлення провайдера не змінилось.

## 24. `release:check`

| Команда | Результат |
|---|---|
| `release:check -- r30` | **`r30 OK agent=…@30 serving_in_this_revision=false`**, exit 0 |
| `release:check -- r30 --serving` | `no Telegram serving Session found`, **exit 78** — очікувано: r30 ніде не serve-иться, inspection Session навмисно не маркована як serving |
| `release:check -- r29` | `r29 OK …@29 serving_in_this_revision=true`, exit 0 |
| `release:check -- r29 --serving` | **OK**: `sesn_01HPLE78Kxi3LVxQW2je3z29`, idle, created `2026-09-28T09:04:46Z`, app `4e46aba5…`, **@29**; та сама Session, що в preflight |
| `release:check` (за замовчуванням) | r29 OK |
| r28 / r27 / r26 | OK / OK / OK |
| r25 | MISMATCH (exit 78) — див. нижче |

**r25** — історичний latest-resolved реліз. Він не serve-иться з r26 і не є rollback-ціллю: для r30 rollback — r29, далі r28. Його атестація вимагає, щоб `latest` кожного Skill дорівнював версії з #38.
- Ще до #55 вона падала на `task-management`: latest зсунув sync r29 2026-09-26.
- #55 за визначенням зсунув `latest` чотирьох Skills. Тепер r25 показує `task-management → skver_01KzWw…` і `studio-intake → skver_01SYUX…`.
- `planning-and-focus` і `pm-rhythm` r25 не посилає (r25 мав daily/weekly).

Це очікуваний наслідок immutable-версіонування, не drift r26–r30. Explicit-pinned r26–r30 не зачеплені.

## 25. `SERVING_RELEASE` лишається r29

- `src/release.ts`: `export const SERVING_RELEASE: DjonikRelease = RELEASE_R29;` — значення не змінено, додано лише коментар.
- Тести це фіксують:
  - `release.test.ts` (перехідний стан);
  - `releaseR29.test.ts`;
  - `releaseR30.test.ts` («NOT the serving release»);
  - `releaseR30Candidate.test.ts`.
- `release:check` без аргументу перевіряє r29.
- Cutover-крок із docs/75 **не** виконувався.

## 26. Production / хост

- Хост, deploy, `DJONIK_EXPECTED_RELEASE`, Working Rhythm не змінювались.
- Serving Session r29 `sesn_01HPLE78…` атестується @29 до і після #55.
- Latest coordinator тепер **v30**. Production не зачеплено: serving-шлях пінить `agent.version = SERVING_RELEASE.agent.version = 29` і атестує Session.
- Session без version pin (наприклад, з Console) отримала б v30 — операційний факт, як у docs/74 §12.
- Rollback-стан:
  - Agent v29 незмінний;
  - specialist v4 живий, не архівований;
  - `project-health` Skill не змінено (3 версії, latest `skver_01JLTt…`);
  - `RELEASE_R29` у source незмінний;
  - rollback-runtime (safeguard specialist у `djonikClient.ts`) на місці.

## 27. Точні зміни source

| Файл | Зміна |
|---|---|
| `src/release.ts` | `RELEASE_R30` (виміряний tuple), `RELEASES += r30`, коментар `SERVING_RELEASE` (значення r29) |
| `managed-agents/djonik.md` | лише frontmatter → Agent v30 (§19); тіло без змін |
| `managed-agents/README.md` | розділ #55; примітка #44 оновлена (frontmatter більше не r29) |
| `src/releaseR30.test.ts` | **новий**: 8 тестів — r30 не serving, tuple ≡ розв'язаний кандидат, піни + SHA джерел, тіло `718770ea…`, атестація v30 / roster / Calendar, виміряний snapshot, fail-closed спелінги, tuple-рядок |
| `src/release.test.ts` | lockstep декларації → r30; новий перехідний тест r29 ↔ декларація; r27 vs r29 tools; політики з checklist; specialist-тест із r30 = null; парсер YAML `null` |
| `src/djonikAgentSource.test.ts` | roster → `multiagent: null`; writes Card + Checklist `always_ask`; 3 custom tools; Calendar відсутній |
| `src/releaseR30Candidate.test.ts` | `RELEASES.r30 = RELEASE_R30`, кандидат поза `RELEASES`, ключі з r30 |
| `src/releaseR27Candidate.test.ts`, `src/releaseR28Candidate.test.ts`, `src/workingStyle.test.ts`, `src/clientProfile.test.ts` | очікуваний набір `RELEASES` включає r30 |
| цей документ | звіт |

Не змінено:
- `RELEASE_R25`…`RELEASE_R29`;
- `RELEASE_R30_CANDIDATE`;
- `releasePlan.ts`, `releaseAttestation.ts`, runtime-код;
- Skill-джерела;
- `claude-lock.json`, `project-health-specialist.md`.

## 28. Тести і перевірки (Node v24.16.0, Windows)

| Перевірка | Результат |
|---|---|
| Сфокусовані: `releaseR30`, `releaseR30Candidate`, `release`, `releaseR29`, `releaseR28`, `releaseR28Candidate`, `releaseR27`, `releaseR27Candidate`, `releaseAttestation`, `servingRelease`, `djonikAgentSource`, `clientProfile`, `workingStyle` | **191/191** |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` | **1369/1371** (baseline на чистому `8517c24`: 1360/1362; +9 нових тестів) |
| `git diff --check` | exit 0, лише CRLF-попередження git |

Два збої — ті самі Windows baseline, що й до змін:
- `deployConfig.test.ts` «deploy script survives replacing itself…»;
- `processExit.test.ts` «a real process that fetched over keep-alive exits…» (`1 !== 78`).

## 29. Що лишилось (кожен пункт — окрема авторизація)

1. **Поведінкова валідація r30** на v30 за бюджетом docs/04 §27: S9 / S10 / S11 / S41 (PH-питання через coordinator, змішаний due-запис + project view, ризики), плюс валідація #47/#48/#50/#51/#52.
2. **Рішення щодо production Memory:** міграція `preferences.md` → `working-style.md` і client-profile (#51/#52).
3. **Source cutover:** `SERVING_RELEASE = RELEASE_R30` (усі `sessionVersion` уже виміряні); перехідний тест у `release.test.ts` згортається в одну рівність. Потім review → commit / push.
4. **Deploy:** `DJONIK_EXPECTED_RELEASE=r30` + `deploy.sh <SHA>`; `release:check -- r30 --serving` на hosted Session. Rollback — r29-ревізія / Agent v29.
5. **Пізніше:** архівація specialist v4 і `project-health`, прибирання rollback-runtime — після закриття rollback-вікна r29.
6. **За рішенням PO:** архівація inspection Session `sesn_017J9XJD…`.

## 30. `git status --short`

```text
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/clientProfile.test.ts
 M src/djonikAgentSource.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR27Candidate.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR30Candidate.test.ts
 M src/workingStyle.test.ts
?? docs/92_ISSUE_55_R30_REMOTE_CONSTRUCTION_AND_ATTESTATION.md
?? src/releaseR30.test.ts
```

**Явно:**
- без deploy;
- без cutover;
- без Telegram/user-ходу;
- без поведінкового inference;
- без мутацій Trello/Memory;
- без архівації specialist;
- без commit і push.

Єдині remote-мутації:
- 4 нові Skill-версії;
- 1 update Agent (v30);
- 1 zero-event inspection Session.
