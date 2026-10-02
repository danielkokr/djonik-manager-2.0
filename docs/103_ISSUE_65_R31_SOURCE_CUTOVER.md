# #65 — source cutover на r31 (без hosted deploy)

Дата: 2026-10-02. Issue: [#65](https://github.com/danielkokr/djonik-manager-2.0/issues/65) — «Prepare r31 source cutover while keeping production on r30». Статус: **готово до review Product Lead**. Без commit / push / deploy.

> **ЛИШЕ SOURCE CUTOVER. HOSTED DEPLOY ЩЕ НЕ ВИКОНУВАВСЯ.**
> Source цієї ревізії обслуговує r31. Hetzner-хост і далі обслуговує задеплоєну r30-ревізію `7876f3dc…` (Agent v30), доки не буде окремо авторизованого deploy.

Canonical NOW лишається [#35](https://github.com/danielkokr/djonik-manager-2.0/issues/35). #65 — обмежений крок релізу, не NOW. `docs/02` не змінювався.

## 1. Підсумок / вердикт

**PASS (source cutover).**

- Єдина продуктова зміна: `SERVING_RELEASE = RELEASE_R31` (§4).
- Tuple r31 з #64 не змінено, як і всі інші релізи. Доказ — хеші до і після (§6).
- `RELEASE_R30` не змінено; r30 — повноцінний reviewed rollback (§7).
- Декларація `managed-agents/djonik.md` = `SERVING_RELEASE` = `RELEASE_R31`. Перехідний стан #64 завершено (§5).
- `release:check -- r31` → OK, `serving_in_this_revision=true`; `r30` → OK; `r30 --serving` → production Session @30 (§8).
- `npm test` 1512/1514: лише два Windows-baseline (§13). typecheck і build проходять.
- Remote-записів, deploy, Telegram, inference не було.

## 2. Стартовий стан Git

| Перевірка | Результат |
|---|---|
| `git fetch origin`; `HEAD` = `origin/main` | так, обидва `b6f4a706414b9a3503165ea8484c915fe5b5dc0b` («release: construct and attest r31») |
| Tracked-файли | чисті (`git diff --stat` порожній) |
| Untracked | лише `docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` — відомий, не пов'язаний із задачею, не чіпався |
| #58–#64 у `HEAD` | `8fc4ec5` (#58), `b4d1953` (#61), `78c09bf` (#63), `1445572` (#59), `6f19ed6` (#62), `a4b885d` (#60), `b6f4a70` (#64) |

## 3. Стартовий стан remote / source (лише читання, до редагування)

Source (`HEAD`):

| Перевірка | Результат |
|---|---|
| `RELEASE_R30` | є, `agent_01WGRHDBjQa3eMhoGJMmQ1dh@30`, custom tools `trello_work_history, trello_board_snapshot, focus_budget` (без `trello_project_time`) |
| `RELEASE_R31` | є, `…@31`, system `569999b5…8859` = тіло `djonik.md`; custom tools r30 + `trello_project_time`. Збігається з docs/102 §17 |
| `RELEASES` | `r25 … r31`; `RELEASES.r31 === RELEASE_R31`, `RELEASES.r30 === RELEASE_R30` |
| `SERVING_RELEASE` | `RELEASE_R30` |
| `managed-agents/djonik.md` | frontmatter = Agent v31 (lockstep-тест `release.test.ts` у `HEAD` проходив) |

Remote (read-only `release:check`, жодного запису й жодної Session):

| Команда | Вихід | exit |
|---|---|---|
| `release:check -- r31` | `r31 OK agent=…@31 serving_in_this_revision=false` | 0 |
| `release:check -- r30` | `r30 OK agent=…@30 serving_in_this_revision=true` | 0 |
| `release:check -- r30 --serving` | `serving session=sesn_01JzzDyA2UTPsqTDzEbavBrY OK status=idle created=2026-10-02T06:57:28.735443Z app=7876f3dc9ecc9d5bbd8aed41668c81ac2fcf01c3 agent=…@30` | 0 |
| `release:check -- r31 --serving` | `r31 no Telegram serving Session found among the newest Sessions` | 78 |

Висновок: Agent v31 і v30 атестуються; production обслуговує r30. Розбіжностей немає, cutover виконано.

## 4. Точна зміна source

`src/release.ts`:

```diff
-export const SERVING_RELEASE: DjonikRelease = RELEASE_R30;
+export const SERVING_RELEASE: DjonikRelease = RELEASE_R31;
```

Крім цього, оновлено лише два doc-коментарі:
- над `RELEASE_R31`: «Constructed WITHOUT a cutover…» → #64 побудував без cutover, #65 робить його serving; r30 — rollback;
- над `SERVING_RELEASE`: додано речення про #65 (лише source cutover, хост на r30 до deploy). Історичні речення збережено.

Не змінено:
- `RELEASE_R25`…`RELEASE_R31`, `RELEASE_R30_CANDIDATE`, `RELEASE_R31_CANDIDATE`, `RELEASES`;
- версії Agent, піни Skills, system prompt;
- схеми й описи custom tools (`releaseAttestation.ts`, `projectTimeTool.ts`);
- MCP, confirmation policies, Memory / Session resources;
- `managed-agents/djonik.md`, `project-health-specialist.md`, `.claude/skills/`, `claude-lock.json`;
- `deploy/*`, runtime-код, `releaseCheck.ts`, `servingRelease.ts`.

`git diff --stat -- managed-agents/djonik.md managed-agents/project-health-specialist.md .claude/ claude-lock.json deploy/ docs/02_DEVELOPMENT_ROADMAP.md` — порожній.

## 5. Зміни тестів

Одразу після зміни `SERVING_RELEASE`, до правок тестів: `npm test` → 15 fail = **13 очікуваних перехідних перевірок «serving r30»** + 2 Windows-baseline. Інших збоїв не було.

| Файл | Зміна |
|---|---|
| `src/release.test.ts` | «this revision serves r30 (#56)» → **serves r31 (#65)**: v31, `specialist null`, чотири custom tools, лише Trello MCP, Card + Checklist gated. Тест декларації знову через `SERVING_RELEASE` (декларація == serving == r31). Перехідний тест #64 «served r30 differs from declaration r31» **перетворено** на «r30 rollback differs from the served declaration (r31) by exactly #59 + #62»: усі перевірки дельти збережено (prompt, рівно два піни, єдиний змінений tool `trello_project_time` = виконуване визначення), додано `served == declared` і `RELEASES.r30 === RELEASE_R30`. Тест r29↔r30 збережено повністю, без прив'язки до serving. |
| `src/releaseR31.test.ts` | r31 — serving (#65); типовий `release:check` перевіряє r31; r30 — reviewed rollback. Решта тестів (resolved-candidate, дельта, піни, атестація) без змін. |
| `src/releaseR30.test.ts` | r30 — attestable і immediate rollback; `SERVING_RELEASE !== RELEASE_R30`, `SERVING_RELEASE.id === "r31"`. Решта 7 тестів без змін. |
| `src/projectTimeContract.test.ts` | served r31 має `trello_project_time`; r30 (rollback) — ні; tool лише в r31. |
| `src/releaseR30Candidate.test.ts` | serving = r31, не кандидат; `focus_budget` є в r30 і в served r31; topology served `specialist null`. |
| `src/releaseR28Candidate.test.ts`, `src/clientProfile.test.ts`, `src/workingStyle.test.ts` | очікуваний serving id → r31 (clientProfile і далі доводить: не-#59/#62 піни r31 = r30) |
| `src/releaseR29.test.ts`, `src/releaseR27.test.ts`, `src/mutationCommentary.test.ts`, `src/releaseFixtures.test-helpers.ts` | лише тексти повідомлень / коментарів. Перевірки не змінено. |

Жодну перевірку дельти r30↔r31 чи r29↔r30 не видалено. Глобальні перевірки коректності релізів не послаблено.

Покриття 11 вимог issue:

| # | Вимога | Де доведено |
|---|---|---|
| 1 | `SERVING_RELEASE === RELEASE_R31` | `release.test.ts`, `releaseR31.test.ts`, `projectTimeContract.test.ts` |
| 2 | `RELEASES.r31 === RELEASE_R31` | `releaseR31.test.ts`, `release.test.ts`, `projectTimeContract.test.ts` |
| 3 | r31 = розв'язаний `RELEASE_R31_CANDIDATE` | `releaseR31.test.ts` «exactly the candidate resolved…» |
| 4 | декларація = r31 | `release.test.ts` lockstep (тіло SHA, model, roster, MCP, Skills, усі tools/policies) |
| 5 | r30 присутній і незмінний | хеш §6; `releaseR30.test.ts` (resolved candidate, prompt SHA, піни) |
| 6 | r30 — валідний rollback | `release.test.ts` (дельта рівно #59 + #62), `releaseR30.test.ts`, `release:check -- r30` OK |
| 7 | r31 має `trello_project_time` | `release.test.ts`, `projectTimeContract.test.ts`, `releaseR31.test.ts` |
| 8 | r30 не має | `projectTimeContract.test.ts`, `release.test.ts` (`before.trello_project_time === undefined`) |
| 9 | атестація приймає r30 і r31 окремо | `releaseR31.test.ts` «Agent v31 attests as r31 and never as r30…», `releaseR30.test.ts`, `releaseAttestation.test.ts` |
| 10 | схеми/описи custom tools не змінено | `djonikAgentSource.test.ts` (4 tools байт-у-байт з декларацією), lockstep `release.test.ts`; файли tools не в diff |
| 11 | джерела Agent/Skill не змінено | `git diff --stat` порожній (§4); `releaseR31.test.ts` звіряє SHA джерел Skills із пінами |

## 6. Семантика релізів: до → після

SHA-256 від `JSON.stringify` кожного релізу (перші 16 hex), до і після редагування:

| Реліз | До (`HEAD`) | Після |
|---|---|---|
| r25 | `9e55742b48a13e56` | `9e55742b48a13e56` |
| r26 | `b3369749f63efa12` | `b3369749f63efa12` |
| r27 | `bd6ecb976c08f350` | `bd6ecb976c08f350` |
| r28 | `cd99b80a8d869092` | `cd99b80a8d869092` |
| r29 | `fb9b5edb602d00d6` | `fb9b5edb602d00d6` |
| **r30** | `2f1523ea2837717f` | `2f1523ea2837717f` |
| r30-candidate | `f2811d630cdbe612` | `f2811d630cdbe612` |
| **r31** | `8442ffab1e5f6eb4` | `8442ffab1e5f6eb4` |
| r31-candidate | `9f6c3cdaa615ad90` | `9f6c3cdaa615ad90` |
| `SERVING_RELEASE` | `r30` / v30 | **`r31` / v31** |

Хеш r30 `2f1523ea…` той самий, що в docs/93 §6: r30 не змінювався від #55.

| Шар | До #65 | Після #65 |
|---|---|---|
| Декларація `managed-agents/djonik.md` | v31 | v31 |
| Reviewed release | r31 (і r30) | r31 (і r30) |
| `SERVING_RELEASE` (source) | **r30** | **r31** |
| Rollback | r29 | **r30** (r29 лишається reviewed) |
| Remote production | r30 | **досі r30** — до окремого deploy |

## 7. Доказ, що rollback r30 цілий

- Хеш `RELEASE_R30` до і після однаковий (§6); Agent v30 не змінювався, remote-записів не було.
- `release:check -- r30` після cutover: `r30 OK …@30 serving_in_this_revision=false`, exit 0.
- `release:check -- r30 --serving` після cutover: та сама production Session `sesn_01JzzDyA…`, app `7876f3dc…`, @30, exit 0.
- `release.test.ts`: r30 відрізняється від served-декларації рівно на #59 + #62.
- `releaseR30.test.ts`: r30 = розв'язаний `RELEASE_R30_CANDIDATE`, prompt SHA, піни, fail-closed на неправильні `sessionVersion`.
- Rollback-ревізія застосунку `7876f3dc…` існує в main, і в ній `SERVING_RELEASE = RELEASE_R30`. `git diff --stat 7876f3dc HEAD -- deploy/` — порожній.

## 8. Локальні `release:check` після cutover (лише читання)

| Команда | Вихід | exit | Очікування |
|---|---|---|---|
| `release:check` (типово) | `r31 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@31 serving_in_this_revision=true` | 0 | тепер r31 ✔ |
| `release:check -- r31` | `r31 OK …@31 serving_in_this_revision=true` | 0 | PASS ✔ |
| `release:check -- r30` | `r30 OK …@30 serving_in_this_revision=false` | 0 | PASS, rollback ✔ |
| `release:check -- r30 --serving` | `r30 OK …@30 serving_in_this_revision=false`, далі `serving session=sesn_01JzzDyA2UTPsqTDzEbavBrY OK status=idle created=2026-10-02T06:57:28.735443Z app=7876f3dc9ecc9d5bbd8aed41668c81ac2fcf01c3 agent=…@30` | 0 | хост ще r30 ✔ |
| `release:check -- r31 --serving` | `r31 OK …@31 serving_in_this_revision=true`, далі `r31 no Telegram serving Session found among the newest Sessions` | 78 | очікувана відмова ✔ |

Семантика `--serving` (з `src/releaseCheck.ts`): вона прив'язана до **названого релізу**, а не до локального `SERVING_RELEASE`. Команда перечитує найновішу Session з `source=telegram, release=<id>` і атестує її. Від `SERVING_RELEASE` залежить лише мітка `serving_in_this_revision` і типовий реліз без аргументу. Тому `r30 --serving` і далі проходить на старій hosted Session, хоча локальний source уже serve-ить r31. Інструменти не змінювалися.

Зібраний `dist/release.js`: `SERVING_RELEASE.id = r31`, `agent.version = 31`, custom tools `trello_work_history, trello_board_snapshot, focus_budget, trello_project_time`. Саме це значення `deploy.sh` порівнює з `DJONIK_EXPECTED_RELEASE`.

## 9. Hosted-стан, що лишається незмінним

| Шар | Стан |
|---|---|
| **Source revision** (ця робоча копія, після commit) | обслуговує **r31** |
| **Поточний хост** (Hetzner, `djonik-telegram`) | обслуговує **r30**: app `7876f3dc9ecc9d5bbd8aed41668c81ac2fcf01c3`, Agent v30, Session `sesn_01JzzDyA2UTPsqTDzEbavBrY` |

Хост, `/etc/djonik/djonik.env`, `DJONIK_EXPECTED_RELEASE`, `revision.env` і systemd не змінювались. До Hetzner не підключались.

## 10. Процедура deploy — підготовлено, НЕ виконано

Точка входу: `deploy/deploy.sh <full-commit-sha>` (docs/52 §3), як root на хості.

Що розгорне deploy (уся різниця `7876f3d..<новий SHA>`):
- #58 mixed forwarded authority (`8fc4ec5`);
- #61 proposal footer / кнопки (`b4d1953`);
- #63 ARI leak fix (`78c09bf`);
- #59 project alias resolution (`1445572`);
- #62 interactive project time (`6f19ed6`);
- #60 provider failure hardening (`a4b885d`);
- #64 concrete r31 (`b6f4a70`);
- #65 `SERVING_RELEASE` cutover (цей diff, після commit).

Як передається ревізія застосунку: аргумент `deploy.sh` → detached checkout рівно цього SHA → `DJONIK_APP_REVISION=<SHA>` у `/etc/djonik/revision.env` → процес тегує Session `app_revision` і логує `[release] serving … app=<SHA>`.

`DJONIK_EXPECTED_RELEASE` **мусить змінитися на `r31`**. `deploy.sh` (крок 7 docs/52 §3) порівнює його з `SERVING_RELEASE.id` зібраної ревізії й відмовляє до restart, якщо вони різні. Під час старту це ж перевіряє `servingRelease.ts` (exit 78). Нових секретів r31 не потребує: від `7876f3d` не додано жодної нової змінної середовища; `trello_project_time` використовує наявні `TRELLO_*`.

Передумови:
- Product Lead прийняв #65;
- Daniel вручну зробив commit / push;
- жоден інший адаптер (ноутбук) не запущений (інваріант 1 docs/52).

Кроки:
1. **Зафіксувати SHA:**
   ```bash
   git rev-parse origin/main
   ```
   Далі `<FULL_SHA>` — це значення.
2. **[READ] Локально з committed main:**
   ```bash
   npm run release:check -- r31
   ```
   Очікування: `r31 OK …@31 serving_in_this_revision=true`.
3. **[AUTH] На Hetzner, як root, безпосередньо перед deploy:**
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
   Ввести `r31`. Решта значень зберігається. Процес r30, що працює, env не перечитує, але якщо він сам перезапуститься між кроками 3 і 4, вийде з кодом 78. Тому кроки 3 і 4 — одразу один за одним.
4. **[AUTH] Deploy:**
   ```bash
   /opt/djonik/app/deploy/deploy.sh <FULL_SHA>
   ```
   Скрипт: fetch → detached checkout `<FULL_SHA>` → відмова на брудному дереві → `npm ci` → `npm run build` → `node dist/releaseCheck.js` (типовий реліз тепер r31, read-only) → перевірка `DJONIK_EXPECTED_RELEASE == r31` → запис `revision.env`. Усе це **до** restart: будь-яка відмова лишає процес r30 недоторканим. Далі `systemctl enable` + один `systemctl restart djonik-telegram` (graceful drain), потім до 90 с очікування рядка нового процесу `[release] serving … app=<FULL_SHA>`.

**Якщо `deploy.sh` зупинився до restart:** процес r30 далі обслуговує, але `DJONIK_EXPECTED_RELEASE` уже `r31`. Повернути:
```bash
bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
```
Ввести `r30`. Інакше будь-який майбутній перезапуск процесу r30 завершиться exit 78.

Working Rhythm лишається у поточному стані: `DJONIK_WORKING_RHYTHM` не змінюється.

## 11. Перевірка після deploy

1. **Serving-рядок нового процесу** (`deploy.sh` друкує його сам; або `journalctl -u djonik-telegram -n 50`):
   ```text
   [release] serving release=r31 app=<FULL_SHA> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@31 … specialist=none … custom_tools=trello_work_history#…,trello_board_snapshot#…,focus_budget#…,trello_project_time#… … always_ask=edit,trello/trelloWriteCard,trello/trelloWriteChecklist,write …
   ```
2. **[READ] Provider-side доказ:**
   ```bash
   npm run release:check -- r31 --serving
   ```
   Очікування: `r31 serving session=sesn_… OK … app=<FULL_SHA> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@31`, exit 0.
3. **Hosted Session:** release `r31`, Agent `@31`, `app_revision` = `<FULL_SHA>` — усі три в рядку кроку 2.
4. `journalctl -u djonik-telegram` — без `[release] warning` і без неочікуваних `[shutdown]`.
5. **Ручна перевірка в Telegram (Daniel, окремо):**
   - #59: назва / alias проєкту («по Azov…», скорочена назва) розв'язується в правильну мітку до роботи з Trello;
   - #62: «Скільки часу пішло на <проєкт> цього тижня?» — детермінована код-відповідь, без вигаданих годин;
   - регрес r30: огляд проєкту, створення / зміна картки з підтвердженням, checklist;
   - #58 / #61 / #63 / #60: переслане повідомлення клієнта не виконується як команда; кнопки пропозиції працюють; у відповідях немає ids Trello; збій провайдера дає чесне повідомлення без дубля відправки.

Тригери rollback — як у docs/93 §16: неперевірений / хибний запис, систематична фактична вигадка, нестабільне обслуговування (exit 78/1, 409, повторні tool), регрес базового сценарію r30, витік секрету / технічного тексту.

## 12. План rollback — НЕ виконано

**Ціль rollback: `7876f3dc9ecc9d5bbd8aed41668c81ac2fcf01c3`.** Це ревізія, яку хост обслуговує зараз; атестована `r30 --serving` (Session `sesn_01JzzDyA…`). У ній `SERVING_RELEASE = RELEASE_R30`; `deploy/` з того часу не змінювався.

1. **[AUTH]**
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
   Ввести `r30`.
2. **[AUTH]**
   ```bash
   /opt/djonik/app/deploy/deploy.sh 7876f3dc9ecc9d5bbd8aed41668c81ac2fcf01c3
   ```
   Ревізія пінить Agent **v30**, який існує без змін. Запису в Agent немає.
3. **[READ]**
   ```bash
   npm run release:check -- r30 --serving
   ```
   Очікування: нова Session, `app=7876f3dc…`, `…@30`.

Альтернатива (не перевірена в production): `b6f4a70` — теж serve-ить r30, але вже містить app-фікси #58–#63. Її можна обрати, якщо дефект саме в r31 (prompt / Skills), а не в app-коді. Типовою ціллю лишається `7876f3dc`, бо лише вона доведено працювала на хості.

Межі:
- rollback змінює лише майбутні ходи;
- записи в Trello / Memory не відкочуються;
- починається нова Session, Memory лишається.

## 13. Тести / build / typecheck (Node v24.16.0, Windows)

Сфокусовані:

```bash
node --import tsx --test src/release.test.ts src/releaseR29.test.ts src/releaseR30.test.ts src/releaseR31.test.ts src/releaseR30Candidate.test.ts src/releaseR28Candidate.test.ts src/releaseR27.test.ts src/releaseR27Candidate.test.ts src/releaseAttestation.test.ts src/servingRelease.test.ts src/djonikAgentSource.test.ts src/projectTimeContract.test.ts src/clientProfile.test.ts src/workingStyle.test.ts src/mutationCommentary.test.ts src/deployConfig.test.ts
```

Результат: **222 тести, 221 pass, 1 fail**. Fail — лише baseline `deployConfig.test.ts`.

| Перевірка | Результат |
|---|---|
| `npm test` | **1514 тестів, 1512 pass, 2 fail** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |

Два збої — ті самі Windows-baseline:
- `deployConfig.test.ts` «deploy script survives replacing itself…» — CRLF-checkout `deploy.sh`;
- `processExit.test.ts` «a real process that fetched over keep-alive exits…».

`reminderDelivery.test.ts` у цих прогонах пройшов; інтермітентний timing-flake із docs/102 §20 не відтворився і не стосується #65.

## 14. `git diff --check`

Exit 0. Лише CRLF-попередження git (LF у робочій копії відредагованих тестів; git нормалізує).

## 15. Змінені файли

- `src/release.ts` — `SERVING_RELEASE = RELEASE_R31`, два коментарі.
- `src/release.test.ts`
- `src/releaseR31.test.ts`
- `src/releaseR30.test.ts`
- `src/releaseR30Candidate.test.ts`
- `src/releaseR28Candidate.test.ts`
- `src/releaseR29.test.ts` — назва / повідомлення.
- `src/releaseR27.test.ts` — повідомлення.
- `src/projectTimeContract.test.ts`
- `src/clientProfile.test.ts`
- `src/workingStyle.test.ts`
- `src/mutationCommentary.test.ts` — коментар.
- `src/releaseFixtures.test-helpers.ts` — коментарі.
- `managed-agents/README.md` — розділ #65; розділи #64 і #56 позначено як superseded.
- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` — новий датований абзац «Serving release — #65 source cutover». Абзац #56 не переписано.
- `docs/103_ISSUE_65_R31_SOURCE_CUTOVER.md` — цей звіт.

## 16. Явне підтвердження

- ❌ commit / push — не виконано;
- ❌ deploy, restart, доступ до Hetzner — не виконано;
- ❌ зміна `DJONIK_EXPECTED_RELEASE` / секретів хоста — не виконано;
- ❌ Agent v32, sync / створення Skills, будь-яка remote-мутація — не виконано. Лише read-only GET у `release:check`, без створення Session;
- ❌ Telegram-повідомлення, live-валідація, платний inference — не виконано;
- ❌ мутації Trello / Memory, зміна `/rhythm.md` — не виконано;
- ❌ виправлення flake reminders, feature-робота — не виконано;
- ❌ `docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` — не чіпався;
- ❌ закриття #65, зміна canonical NOW / `docs/02` — не виконано.

## 17. `git status --short`

```text
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M managed-agents/README.md
 M src/clientProfile.test.ts
 M src/mutationCommentary.test.ts
 M src/projectTimeContract.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releaseR27.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR29.test.ts
 M src/releaseR30.test.ts
 M src/releaseR30Candidate.test.ts
 M src/releaseR31.test.ts
 M src/workingStyle.test.ts
?? docs/103_ISSUE_65_R31_SOURCE_CUTOVER.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
```
