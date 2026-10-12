# 111 — source cutover на r32 (без hosted deploy)

**Статус:** source cutover виконано, очікує review Product Owner. Без commit, push, deploy, перезапуску Hetzner, зміни hosted `DJONIK_EXPECTED_RELEASE`, без remote-записів, нових Session, Telegram і платного inference.
**Дата:** 2026-10-12.

## 1. Підсумок / вердикт

- `SERVING_RELEASE`: **`RELEASE_R31` → `RELEASE_R32`**. Це єдина зміна коду.
- Tuple `RELEASE_R32`, Agent v32, Skills і визначення tools не змінювались.
- **Source** тепер очікує й обслуговує r32 / Agent v32.
- **Хост (Hetzner) не розгортався** і фізично досі працює на r31: app `91d14107…`, Agent v31.
- r31 — негайний rollback.

## 2. HEAD / база

| Перевірка | Результат |
|---|---|
| HEAD | `c3b7c704e9dce5d89a6c2f013c7a56d059babf63` («Construct and attest r32 release», прийнятий #70) |
| `main` проти `origin/main` | рівні (після `git fetch`) |
| Робоче дерево на старті | лише відомий невідстежуваний `docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` |
| `SERVING_RELEASE` на старті | `RELEASE_R31` |

## 3. Preflight: production r31 (лише читання, до редагування)

| Команда / перевірка | Результат |
|---|---|
| `release:check -- r31 --serving` | **OK**: `sesn_01A6mcGJDLhF87safsm8mYPF`, idle, created `2026-10-09T14:21:31Z`, app `91d14107ce9d8898ea39a86bbb4ad055bba619eb`, Agent @31 |
| `compareWithRelease(r31, v31)` | `[]`; `updated_at 2026-10-02T09:43:37.580503Z` — той самий, що до #70 |

## 4. Preflight: атестація r32 (лише читання)

| Перевірка | Результат |
|---|---|
| `release:check -- r32` | **OK** `…@32` |
| remote latest | **32**, `updated_at 2026-10-12T08:31:10.115121Z`, `archived_at null` |
| latest ≡ `retrieve(version: 32)` | deep-equal |
| v33 | відсутня (404) |
| `compareWithRelease(r32, latest)` | `[]` |

Усі вісім передумов виконано.

## 5. Точна зміна source

`src/release.ts`:

```diff
-export const SERVING_RELEASE: DjonikRelease = RELEASE_R31;
+export const SERVING_RELEASE: DjonikRelease = RELEASE_R32;
```

Крім цього, оновлено два doc-коментарі в тому ж файлі:

- над `RELEASE_R32`: #70 побудував без cutover, цей крок робить його serving; хост на r31 до deploy;
- над `SERVING_RELEASE`: додано речення про цей cutover. Історичні речення збережено.

Не змінено (`git diff --stat` для них порожній):

- `RELEASE_R25`…`RELEASE_R32`, обидва кандидати, `RELEASES`;
- `src/releaseAttestation.ts`, `src/releasePlan.ts`, `src/trelloWorkHistory.ts`, `src/reminderTool.ts`;
- `managed-agents/djonik.md`, `.claude/skills/`, `claude-lock.json`;
- `deploy/*` і весь runtime-код #66–#71.

SHA-256 від `JSON.stringify` кожного tuple (перші 16 hex), до і після:

| Реліз | До | Після |
|---|---|---|
| r25 | `9e55742b48a13e56` | те саме |
| r26 | `b3369749f63efa12` | те саме |
| r27 | `bd6ecb976c08f350` | те саме |
| r28 | `cd99b80a8d869092` | те саме |
| r29 | `fb9b5edb602d00d6` | те саме |
| r30 | `2f1523ea2837717f` | те саме |
| **r31** | `8442ffab1e5f6eb4` | те саме |
| **r32** | `ecb32da070a20406` | те саме |
| r31-candidate | `9f6c3cdaa615ad90` | те саме |
| r32-candidate | `166d61338da80e6d` | те саме |
| `SERVING_RELEASE` | `r31` / v31, 4 custom tools | **`r32` / v32, 5 custom tools** |

Хеші r25–r31 ті самі, що в docs/103 §6.

## 6. Стани після cutover

| Шар | До | Після |
|---|---|---|
| Декларація `managed-agents/djonik.md` | v32 | v32 |
| Reviewed releases | r25…r32 | r25…r32 |
| `SERVING_RELEASE` (source) | r31 | **r32** |
| Rollback | r30 | **r31** (r30 лишається reviewed) |
| Hosted production | r31, app `91d1410`, Agent v31 | **досі r31** — до окремого deploy |

Що змінює сам cutover у поведінці застосунку, коли ця ревізія запуститься:

- процес створює Session на Agent v32 і атестує її проти r32;
- `release.customTools` містить `reminder`, тож вмикаються виконавець нагадувань, їхня доставка й кнопки (це і є виправлення #68);
- код #66, #67, #69, #71 уже в цій ревізії і починає працювати з тим самим deploy.

## 7. Зміни тестів

Одразу після зміни `SERVING_RELEASE`, до правок тестів: `npm test` → 17 fail = **14 очікуваних перехідних перевірок «serving r31»** + 2 Windows-baseline + 1 відомий timing-flake (`reminderDelivery` «crash during the Telegram call…», див. docs/102, docs/109; у наступних прогонах проходить).

| Файл | Зміна |
|---|---|
| `src/release.test.ts` | «serves r31» → **serves r32**: v32, п'ять custom tools, `customToolRevisions`. Тест декларації знову через `SERVING_RELEASE` (декларація == serving == r32). Перехідний тест #70 перетворено на «r31 rollback differs from the served declaration (r32) by exactly #66 + #67 + #68 + #69»: усі перевірки дельти збережено, додано `served == declared` і `RELEASES.r31 === RELEASE_R31`. Тест r30↔r31 збережено повністю, без прив'язки до serving. |
| `src/releaseR32.test.ts` | r32 — serving; типовий `release:check` перевіряє r32; r31 — reviewed rollback. Решта 10 тестів без змін. |
| `src/releaseR31.test.ts` | r31 — attestable і immediate rollback; `SERVING_RELEASE !== RELEASE_R31`. Решта без змін. |
| `src/issue68ReminderRegression.test.ts` | перший тест: релізи до r31 без `reminder`, **serving r32 його має**, r31-rollback — ні. Поріг guard (`31`) і решта тестів без змін. |
| `src/projectTimeContract.test.ts` | served r32 зберігає `trello_project_time`; r31 теж; r30 — ні. |
| `src/releaseR30.test.ts`, `releaseR30Candidate.test.ts`, `releaseR28Candidate.test.ts`, `clientProfile.test.ts`, `workingStyle.test.ts` | очікуваний serving id → r32. |
| `src/releaseR27.test.ts`, `releaseR29.test.ts` | лише тексти повідомлень. |

Жодну перевірку дельти r31↔r32 чи r30↔r31 не видалено. Тести тепер розрізняють: serving у source = r32; r31 = rollback.

## 8. Перевірки

| Перевірка | Результат |
|---|---|
| `npx tsc --noEmit` | чисто |
| `npm run build` | pass; `dist/release.js`: `SERVING_RELEASE` = `r32`, v32, 5 custom tools (саме це значення `deploy.sh` порівнює з `DJONIK_EXPECTED_RELEASE`) |
| Сфокусовані: усі `release*`, `servingRelease`, #68 guard, custom tools, agent source, project time, client profile, working style, deploy config | 261 / 262 (єдиний збій — Windows-baseline `deploy script survives replacing itself…`) |
| `npm test` | **1605 тестів, 1603 pass, 2 fail** |
| `git diff --check` | чисто |

Baseline-збої, ті самі до і після, не стосуються cutover:

- `deployConfig.test.ts` — «deploy script survives replacing itself…»;
- `processExit.test.ts` — «a real process that fetched over keep-alive exits…» (`1 !== 78`).

`release:check` після cutover (лише читання):

| Команда | Вихід | exit |
|---|---|---|
| `release:check` (типово) | `r32 OK …@32 serving_in_this_revision=true` | 0 |
| `release:check -- r32` | `r32 OK …@32 serving_in_this_revision=true` | 0 |
| `release:check -- r31` | `r31 OK …@31 serving_in_this_revision=false` | 0 |
| `release:check -- r31 --serving` | та сама production-Session `sesn_01A6mcGJ…`, app `91d14107…`, @31 | 0 |

`release:check -- r32 --serving` свідомо **не запускався як доказ**: Telegram-Session r32 не існує, доки немає deploy. До deploy він має повертати `no Telegram serving Session found`, exit 78.

## 9. Хост НЕ розгорнуто. Передача на наступний, окремо авторизований крок

Hetzner, `/etc/djonik/djonik.env`, `DJONIK_EXPECTED_RELEASE`, `revision.env` і systemd не змінювались. До хоста не підключались.

### Що розгорне deploy

Уся різниця `91d1410..<новий SHA>`:

- #66 стисла історія роботи (`867298d`, `783341a`);
- #67 читабельність Working Rhythm (`0feb7a6`);
- #68 guard нагадувань (`34ff4a4`);
- #69 судження про тиждень (`3647a9d`);
- #71 fail-closed без свіжого Trello (`e174f5b`);
- #70 конкретний r32 і release-інфраструктура (`c3b7c70`);
- цей cutover (після commit).

Нових змінних середовища від `91d1410` немає. `deploy/` від `91d1410` не змінювався. Нагадування зберігаються в тому самому файлі стану (`StateDirectory=djonik`), нових секретів не потрібно.

### Передумови

- Product Owner прийняв цей cutover;
- Daniel вручну зробив commit і push;
- жоден інший адаптер (ноутбук) не запущений.

### Кроки

1. Зафіксувати SHA (локально, після push). Далі `<FULL_SHA>` — це значення.
   ```bash
   git rev-parse origin/main
   ```
2. Локально з committed main, лише читання. Очікування: `r32 OK …@32 serving_in_this_revision=true`.
   ```bash
   npm run release:check -- r32
   ```
3. На Hetzner, як root, безпосередньо перед deploy. Ввести `r32`; решта значень зберігається.
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
4. Одразу після кроку 3 — deploy.
   ```bash
   /opt/djonik/app/deploy/deploy.sh <FULL_SHA>
   ```

Кроки 3 і 4 йдуть один за одним: процес r31, що працює, env не перечитує, але якщо він сам перезапуститься між ними, вийде з кодом 78.

`deploy.sh` до restart робить: fetch → detached checkout → відмова на брудному дереві → `npm ci` → `npm run build` → `node dist/releaseCheck.js` (типовий реліз тепер r32) → перевірка `DJONIK_EXPECTED_RELEASE == r32` → запис `revision.env`. Будь-яка відмова тут лишає процес r31 недоторканим. Далі один `systemctl restart djonik-telegram` і до 90 с очікування рядка `[release] serving … app=<FULL_SHA>`.

**Якщо `deploy.sh` зупинився до restart:** процес r31 далі обслуговує, але `DJONIK_EXPECTED_RELEASE` уже `r32`. Повернути тією самою командою кроку 3, ввівши `r31`; інакше наступний перезапуск процесу r31 завершиться exit 78.

`DJONIK_WORKING_RHYTHM` цим кроком не змінюється.

### Перевірка після deploy

1. Serving-рядок нового процесу (`journalctl -u djonik-telegram -n 50`):
   ```text
   [release] serving release=r32 app=<FULL_SHA> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@32 … custom_tools=trello_work_history#32042ea1ce27,…,trello_project_time#92a7f5b4492a,reminder#1ad79abe2cae …
   ```
   Поруч мають з'явитись `[reminder] running` і, якщо ритм увімкнено, `[rhythm] running`.
2. Provider-side доказ, лише читання. Очікування: `r32 serving session=sesn_… OK … app=<FULL_SHA> …@32`, exit 0.
   ```bash
   npm run release:check -- r32 --serving
   ```
3. Журнал без `[release] warning`, без неочікуваних `[shutdown]`, без `[rhythm] fact_reader_unavailable`.
4. Ручна перевірка в Telegram (Daniel, окремо):
   - #66: вузьке питання («які задачі закрито по CL?») дає короткий список, без хронології; «детально» дає хронологію;
   - #67: план тижня згрупований по проєктах, без слова «due»;
   - #68: «нагадай завтра о 10 заповнити звіт» → підтвердження від коду, нагадування приходить, кнопки ✅ / ⏰ працюють;
   - #69: огляд показує «N карток (M переходів)»; відповідь на «тиждень успішний?» спирається на результати, а не на кількість подій;
   - #71: наживо перевірити складно без збою Trello; достатньо звичайного ранкового ходу без `facts_unavailable` у журналі;
   - регрес r31: огляд проєкту, картка з підтвердженням, checklist, час по проєкту.

### Rollback (НЕ виконано)

Ціль: **`91d14107ce9d8898ea39a86bbb4ad055bba619eb`** — ревізія, яку хост обслуговує зараз, атестована `r31 --serving`. У ній `SERVING_RELEASE = RELEASE_R31`.

1. Ввести `r31`:
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
2. Розгорнути попередню ревізію. Вона пінить Agent v31, який існує без змін; запису в Agent немає.
   ```bash
   /opt/djonik/app/deploy/deploy.sh 91d14107ce9d8898ea39a86bbb4ad055bba619eb
   ```
3. Перевірити, лише читання:
   ```bash
   npm run release:check -- r31 --serving
   ```

Межі rollback:

- він змінює лише майбутні ходи; записи в Trello і Memory не відкочуються; починається нова Session;
- **нагадування, створені під r32, під r31 не доставляються**: r31 не має tool `reminder`, тому доставка нагадувань у тій ревізії не запускається. Записи лишаються у файлі стану й будуть доставлені після повернення на r32 (прострочені — з приміткою про запізнення). Якщо rollback потрібен, варто сказати про це Daniel;
- поле `deferredRituals` (#71) ревізія `91d1410` не знає і не чіпає.

Альтернатива, не перевірена на хості: `c3b7c70` — теж serve-ить r31, але вже з app-кодом #66–#71.

## 10. Явне підтвердження

Не було: deploy чи restart Hetzner, зміни hosted `DJONIK_EXPECTED_RELEASE`, remote-записів у Agent або Skills, Agent v33, нових версій Skill, нових Session, модельного inference, Telegram-повідомлень, нагадувань, змін Trello чи Memory, commit, push, закриття issues.

## 11. `git diff --stat`

```
 docs/01_CLAUDE_NATIVE_ARCHITECTURE.md |  6 +++++
 docs/02_DEVELOPMENT_ROADMAP.md        |  7 ++++--
 managed-agents/README.md              |  9 +++++--
 src/clientProfile.test.ts             |  4 ++--
 src/issue68ReminderRegression.test.ts | 10 +++++---
 src/projectTimeContract.test.ts       | 11 +++++----
 src/release.test.ts                   | 44 +++++++++++++++++++----------------
 src/release.ts                        | 14 ++++++-----
 src/releaseR27.test.ts                |  2 +-
 src/releaseR28Candidate.test.ts       |  2 +-
 src/releaseR29.test.ts                |  2 +-
 src/releaseR30.test.ts                |  6 ++---
 src/releaseR30Candidate.test.ts       | 12 +++++-----
 src/releaseR31.test.ts                | 13 ++++++-----
 src/releaseR32.test.ts                | 11 +++++----
 src/workingStyle.test.ts              |  6 ++---
 16 files changed, 93 insertions(+), 66 deletions(-)
```

(Новий невідстежуваний звіт у `--stat` не входить.)

## 12. `git status --short`

```
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M docs/02_DEVELOPMENT_ROADMAP.md
 M managed-agents/README.md
 M src/clientProfile.test.ts
 M src/issue68ReminderRegression.test.ts
 M src/projectTimeContract.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR27.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR29.test.ts
 M src/releaseR30.test.ts
 M src/releaseR30Candidate.test.ts
 M src/releaseR31.test.ts
 M src/releaseR32.test.ts
 M src/workingStyle.test.ts
?? docs/111_R32_SOURCE_CUTOVER.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` був невідстежуваним до початку роботи; я його не чіпав.
