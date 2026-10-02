# #62 — Час по проєкту в звичайній розмові («скільки часу на Азов?»): звіт Implementation Engineer

2026-10-02. Issue: [#62 — Ad-hoc project time query bypasses deterministic weekly-time logic and dumps raw Trello history](https://github.com/danielkokr/djonik-manager-2.0/issues/62) (коментарів немає). Canonical NOW **не змінюється**: [#35](https://github.com/danielkokr/djonik-manager-2.0/issues/35), пілот робочого ритму. #62 — обмежене виправлення дефекту, знайденого під час пілоту (той самий шлях, що #58/#59/#61/#63).

**Це source-only кандидат на review.** #62 не закрито. Не було: commit, push, deploy, branch, sync Agent/Skills, нової версії Agent, створення Session, платного inference, запису в production Memory чи Trello, змін roadmap.

## 1. Підсумок

- Додано **один вузький read-only custom tool `trello_project_time`** з входом `{ project_label }`, лише **цей тиждень**. Він викликає **той самий** розрахунок #50 (`inProgressIntervals` → `allocateWeeklyTime`) і повертає готовий код-власний `answer_text`.
- `allocateWeeklyTime` тепер за **один прохід** рахує частку **кожної картки**. Підсумок проєкту є сумою його карток. Другого алгоритму немає.
- Клієнт показує `answer_text` **байт-у-байт**. Це вузьке розширення exact relay #36 саме на цей інструмент, а не загальне правило «кожен результат = відповідь». Якщо в тексті моделі з'являється власна цифра годин, цей текст не показується.
- Якщо немає `work_hours`, інструмент одразу повертає коротку відповідь «не можу оцінити…». Trello при цьому взагалі не читається, як і в п'ятничному репортері.
- `work-review` отримав одне речення: питання про час іде до `trello_project_time`, а не до `trello_work_history`. Coordinator prompt не змінено.
- П'ятничний блок не змінився. Існуючі тести п'ятниці проходять без змін в очікуваннях.
- Додано S48/S49 (offline benchmark) і непов'язаний з виробництвом кандидат **r31** (#59 + #62), повністю unresolved.
- Тести: **1482, з них 1480 passed, 2 failed**. Падають лише два відомі baseline-тести. На чистій копії `HEAD` вони відтворюються так само. Typecheck і build чисті.

## 2. Першопричина

1. **Недосяжність.** Детермінований розрахунок #50 існував лише як `WeeklyTimeReporter` для п'ятничного автоматичного ходу (`rhythmRuntime` → `rhythmRunner`). У звичайному ході Claude не мав інструмента, що повертає час. Єдиним «часовим» джерелом виглядав `trello_work_history`, тож модель взяла історію, переказала сирі переходи і зрештою сказала, що `work_hours` немає.
2. **Форма результату.** `WeeklyTimeAllocation` агрегував лише по проєктах. Розбивки по картках не було, хоча `InProgressInterval` уже містив `cardId`.
3. **Немає фінального «недоступно».** Причина `work_hours_missing` жила лише в п'ятничному блоці. У звичайному ході не існувало коду, який сказав би «це кінцева відповідь, не рахуй сам».

## 3. Обрана інтерактивна архітектура і чому

| Варіант | Рішення |
|---|---|
| Розширити `trello_work_history` (новий `response_format` чи поле часу) | Відхилено. Змінило б attested-опис/схему r30 і змішало «що змінилось» з «скільки часу». Опис цього інструмента вже каже «do not use it for … effort» |
| Адаптер розпізнає «скільки часу» і підставляє звіт | Відхилено: адаптер став би intent-router'ом (заборонено) |
| Правило в Skill/prompt «порахуй сам з історії» | Відхилено: друга копія алгоритму і арифметика моделі |
| **Вузький read-only custom tool + exact relay його `answer_text`** | **Обрано** |

Чому так:
- **Claude** семантично вирішує, що питання про час, і (#59) резолвить «Азов» → `A1` через бриф.
- **Код** володіє рештою: конфігурацією `/rhythm.md`, свіжим GET-читанням Trello, одним розподілом і видимим текстом.
- Це найменша Claude-native форма (рівень «custom tool» у порядку docs/01), без нової інфраструктури. Life-cycle #40 уже гарантує одне виконання на `custom_tool_use_id`.

**Конфігурація.** Executor отримує `readConfig: reminderConfigReader(rhythmConfigSource)`. Це **той самий** екземпляр `createMemoryRhythmConfigSource`, який у `telegramCli` вже читають reminder, focus budget і ритм. Другого сховища немає. `work_hours` не кешуються: кожен виклик читає `/rhythm.md` заново. Пряме використання Memory API не розширилось: тести #34/#39/#59 це підтверджують.

**Чому лише цей тиждень.** `inProgressIntervals` реконструює інтервали, відмотуючи назад від **поточного** стану картки. Це коректно, лише якщо вікно закінчується «зараз». Для минулого тижня довелося б відмотувати й пізніші переміщення. Тобто `last_week` **не** «безкоштовний», і його не додано.

## 4. Як ОДИН розподіл дає підсумок проєкту і картки

`allocateWeeklyTime` (`src/weeklyTime.ts`):
1. Для кожного робочого дня точки інтервалів ділять день на елементарні сегменти. Кожен сегмент ділиться **порівну** між активними інтервалами (як і раніше).
2. Денний `factor` = `cap / union` (якщо union > cap), інакше 1 (як і раніше).
3. **Нове:** `share × factor` накопичується **по `cardId`** (`CardTime { cardId, project, ms }`). Проєкт картки визначається один раз, з її поточних міток (`projectLabelOf`).
4. **Підсумок проєкту** = сума `ms` його карток **у порядку масиву `cards`**. Тобто `totals[P].ms` — це буквально ті самі додавання, які зробить читач `cards`.

Інваріант `Σ cards(P).ms === totals(P).ms` виконується **точно** (без епсилону), до округлення. Тести 1–3 перевіряють це через `assert.equal` для кількох карток, перекриття і денного ліміту.

`computeProjectTime` лише **вибирає** мітку з цього розподілу. Імена беруться за `cardId` з того самого свіжого `readCards`. Id ніколи не потрапляють ні в `answer_text`, ні в JSON для моделі.

**Округлення.** Розрахунки ведуться в мс. Кожен рядок округлюється окремо до пів години через наявний `formatReportHours`. Сума показаних рядків може відрізнятися від показаного підсумку лише на це округлення. Футер це прямо каже: «з точністю до пів години». Округлені значення ніде не «підганяються».

**Картки з кількома мітками.** Семантику п'ятниці не змінено: картка з `A1` **і** іншою міткою потрапляє в кошик «кілька міток» і не входить у суму `A1`. Щоб час не зникав мовчки, відповідь додає один рядок: «Окремо ≈ N год — задачі з A1 і ще іншою міткою; у суму не входять».

## 5. Змінені файли

| Файл | Зміна |
|---|---|
| `src/weeklyTime.ts` | `CardTime`, `allocation.cards`; підсумки проєктів із карток; `computeProjectTime`, `renderProjectTimeAnswer`, `renderProjectTimeUnavailable`, `projectLabelExists` |
| `src/projectTimeTool.ts` (новий) | `TRELLO_PROJECT_TIME_TOOL`, `parseProjectTimeInput`, `createProjectTimeExecutor` |
| `src/djonikClient.ts` | реєстр клієнта; маршрут `projectTime` (без env-default, без fallback на історію); `readOnly` у `toolUses`; `exactRelayVerdict(tool)`; `composeProjectTimeReply`; trace `project_time_relay_composed/skipped`; дозвіл порожнього тексту моделі після verified-результату |
| `src/telegramCli.ts` | executor прив'язано до того самого `rhythmConfigSource` і GET-only `trelloReader` |
| `src/releaseAttestation.ts` | `SUPPORTED_CUSTOM_TOOLS` + `trello_project_time` |
| `src/rhythmRunner.ts` | `READ_ONLY_CUSTOM_TOOLS` + `trello_project_time` |
| `src/release.ts` | `RELEASE_R31_CANDIDATE` (unresolved; не в `RELEASES`) |
| `src/decisionTrace.ts` | `projectTimeScopes` (SHA-256 мітки, як `historyScopes` #59) |
| `.claude/skills/work-review/SKILL.md` | +1 абзац: час → `trello_project_time`, `unavailable` є фінальною відповіддю |
| `src/pmBenchmark.ts`, `src/pmFixture.ts`, `src/pmBenchmarkCli.ts` | перевірки `time_scope`, `no_history_effort`, `time_relay`; S48/S49; `/rhythm.md` для S49; eval-executor читає конфіг із тексту фікстури (без нового Memory API) |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_62_SKILL_EDITS`; `r30SkillSource` віднімає #62 і #59 |
| Тести | нові: `projectTime.test.ts` (14), `projectTimeClient.test.ts` (6), `projectTimeContract.test.ts` (7); оновлені: `customToolRouting.test.ts` (5), `pmBenchmark.test.ts`, `release.test.ts`, `releaseR30.test.ts`, `weeklyTime.test.ts`, `rhythmFocusRunner.test.ts` (поле `cards` у фікстурах) |
| `docs/100_…` | цей звіт |

## 6. Custom tool і exact relay

**Інструмент.** `trello_project_time`, вхід `{ "project_label": string(1..120) }`, `additionalProperties: false`. Опис прямо каже:
- використовувати на будь-яке «скільки часу / годин на проєкт»;
- передавати поточну мітку після резолюції через бриф;
- `answer_text` клієнт показує дослівно;
- `unavailable` є фінальною відповіддю: ніколи не оцінювати з `trello_work_history`, з кількості карток чи дій, не переказувати сирі переходи;
- read-only, цей тиждень, не billing-grade.

**Порядок виконання** (як у п'ятничного репортера):
1. невалідний вхід → `isError`, нічого не рахується;
2. читання `/rhythm.md`. Помилка → `config_unavailable`, Trello не читається;
3. `work_hours` немає → `work_hours_missing`, Trello не читається;
4. board, cards, lists. Мітки на жодній картці немає → `project_not_found`, action log не читається;
5. action log цього тижня. Неповний → `history_incomplete`. Будь-яка помилка читання → `history_unavailable`;
6. `computeProjectTime` → `ok`.

**Результат для моделі:** `{ status, project_label, reason?, week: "this_week", answer_text }`. Годин як чисел, id карток і переходів у ньому немає, тож перераховувати нема з чого.

**Exact relay.** `exactRelayVerdict(PROJECT_TIME_TOOL_NAME)` застосовує правило #36 §A6 per-id. Relay відбувається лише якщо одночасно:
- у ході рівно **один** `custom_tool_use_id` цього інструмента;
- результат прийнято провайдером (`SUBMITTED`/`RESOLVED`);
- результат не є помилкою;
- `answer_text` валідний.

Два виклики, помилка чи зіпсований payload → `project_time_relay_skipped`, і лишається текст координатора. `trello_board_snapshot` і `focus_budget` не зачеплено.

Композиція: спершу `answer_text`, далі можливий текст моделі.
- Якщо текст моделі **лише її власний** (немає verified-запису, reminder- чи focus-підтвердження, specialist) і містить кількість годин, він приховується (`commentary_withheld`).
- Код-власний текст ніколи не приховується.
- Якщо в ході є і verified-історія, порядок такий: історія → час → «PM-висновок».

## 7. Поведінка

| Випадок | Видима відповідь (код) |
|---|---|
| `work_hours` є | `A1 — ≈ 7,5 год цього тижня` / порожній рядок / `По задачах:` / `• Пін Азов — ≈ 3 год` … / порожній рядок / `≈ за переміщеннями в Trello, з точністю до пів години (робочі години 10:00–18:00)`. За потреби додаються рядки про кілька міток, грубість через паралельність і денний ліміт. Понад 12 карток згортаються в «• ще N задач — ≈ X год». Нуль часу: «A1 — цього тижня в робочі години в In progress нічого не було.» |
| `work_hours` немає | `Час по A1 цього тижня не можу оцінити: у /rhythm.md не задані work_hours.` / `Якщо хочеш — задамо робочі години.` Trello не читається. Наступний крок («я працюю з 10 до 19» → `work_hours`) уже веде `pm-rhythm` |
| Неповна чи недоступна історія | `Час по A1 цього тижня не можу оцінити: історію Trello за тиждень не вдалося прочитати повністю. Годин не вгадую.` (або «історія Trello зараз недоступна»). Часткових годин немає |
| Невідома мітка | `Мітки «Азов» на дошці Trello не знайшов, тож час не рахую.` Точний збіг (як у #36), без підстановки, без читання action log |

## 8. Регресія п'ятничного огляду

- `renderWeeklyTimeBlock`, `renderWeeklyTimeUnavailable`, `composeWeeklyTimeReply`, `createWeeklyTimeReporter` **не змінені**. Блок і далі показує лише проєкти.
- Змінилось одне: **порядок додавання** у підсумку проєкту (тепер через картки). Математично результат той самий. Різниця можлива лише на рівні кількох одиниць останнього біта float. Округлення до пів години могло б «перевернутись» тільки на точній межі чверті години з таким шумом. Усі 11 тестів `weeklyTime.test.ts` і тести п'ятниці в `rhythmFocusRunner`/`rhythmRunner` проходять без змін в очікуваннях. Тест 11 додатково фіксує байти блоку на фікстурі #62 і рівність підсумку A1 між п'ятницею і інструментом.

## 9. Сумісність із #59

- #62 **не** містить резолвера: у `projectTimeTool.ts` немає читання брифів, `Aliases`, нормалізації регістру чи fuzzy-збігу (тест). Мітка порівнюється точно, як у `trello_work_history`. «Азов» → `project_not_found`.
- Ланцюжок «Азов» → бриф → `A1` належить coordinator prompt #59. Опис інструмента лише нагадує передати мітку «after resolving his word through the project brief».
- Вимірювання: trace записує `projectTimeScopes` як digest мітки. S48/S49 очікують `A1`, а оракул #59 (`resolveProjectName("Азов", брифи фікстури)`) дає той самий `A1` (тест). Виклик з «Азов» провалює `time_scope`.

## 10. Перевірки і точні результати

| Команда | Результат |
|---|---|
| `npx tsx --test src/weeklyTime.test.ts src/projectTime.test.ts` | 25 / 25 pass |
| `npx tsx --test src/customToolRouting.test.ts src/customToolResolution.test.ts` | 16 / 16 pass |
| `npx tsx --test src/projectTimeClient.test.ts src/djonikClient.test.ts src/reminderClient.test.ts src/turnTrace.test.ts` | 168 / 168 pass |
| Ритм / п'ятниця: `rhythmRunner`, `rhythmFocusRunner`, `rhythmRuntime`, `pmRhythmSkill` | 100 / 100 pass |
| Реліз / attestation: `release`, `releaseAttestation`, `releaseR27*`, `releaseR28*`, `releaseR29`, `releaseR30*`, `djonikAgentSource` | 148 / 148 pass |
| Контракти / benchmark: `projectTimeContract`, `pmBenchmark`, `projectIdentity`, `decisionTrace`, `workReviewContract`, `skills`, `commitmentContract`, `clientProfile` | 203 / 203 pass |
| `npm run benchmark:pm -- --offline --mode S48` / `S49` | SIMULATION ONLY. Виконуються без infra_error; fake-кандидат `SILENT` очікувано fail 0/3. Це не поведінковий доказ |
| `npm test` | **1482 tests, 1480 pass, 2 fail**: `processExit` («a real process that fetched over keep-alive exits…») і `deployConfig` («deploy script survives replacing itself…») |
| Чиста копія `HEAD` (`git archive`, junction на `node_modules`): `deployConfig` + `processExit` | 14 tests, 12 pass, 2 fail: ті самі два → baseline, не пов'язані з #62 |
| `npm run typecheck` | чисто |
| `npm run build` | чисто |

Покриття вимог промпту: 1–11 і 15 — `projectTime.test.ts`; 12–13 — `projectTimeClient.test.ts` і `customToolRouting.test.ts`; 14, S48/S49, реліз — `projectTimeContract.test.ts`. Серед іншого:
- production-відповідь 2026-10-01 (довгий список переходів через `trello_work_history` + «не можу порахувати») **провалює** S48: `time_scope`, `no_history_effort`, `time_relay`, `concise`;
- вигадана цифра після правильного інструмента провалює `no_hours_restated`.

## 11. Наслідки для релізу і відкладене

- **Production цієї поведінки ще не має.** Serving r30 (Agent v30) не має інструмента. `managed-agents/djonik.md` і `SERVING_RELEASE` не змінено.
- У source є `RELEASE_R31_CANDIDATE`: з v30; prompt = source з #59 (`569999b5…`); `task-management` (#59) і `work-review` (#62) unresolved; custom tools r30 + `trello_project_time`. Решта як у r30. Remote id і пінів не вигадано: `buildCandidateUpdateBody` відмовляє без реальних пінів.
- Порядок для реліза (окремий дозвіл): нові версії Skill `task-management` і `work-review` → Agent v31 (prompt #59 + tools) → attestation → оновлення `djonik.md`/`SERVING_RELEASE` → deploy застосунку. Застосунок цієї ревізії **сумісний з r30**: executor прив'язаний, але r30 його ніколи не викличе.
- Відкладено:
  - live-перевірка в Telegram: «скільки часу цього тижня я витратив на Азов?» з `work_hours` і без них, плюс контроль «A1»;
  - платний прогін S48/S49;
  - read-only перевірка, що production `/rhythm.md` справді не має `work_hours`. Зараз це лише зі слів issue: production Memory не читалась.
- Межі: це не billing; минулий тиждень не підтримується (див. §3); картки з кількома мітками в суму не входять (семантика п'ятниці); статичні тести доводять контракт, а не те, що модель обере інструмент.

## 12. `git diff --check`

Без зауважень (exit 0; лише попередження Git про LF→CRLF).

## 13. `git status --short`

```
 M .claude/skills/work-review/SKILL.md
 M src/customToolRouting.test.ts
 M src/decisionTrace.ts
 M src/djonikClient.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmBenchmarkCli.ts
 M src/pmFixture.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseAttestation.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releaseR30.test.ts
 M src/rhythmFocusRunner.test.ts
 M src/rhythmRunner.ts
 M src/telegramCli.ts
 M src/weeklyTime.test.ts
 M src/weeklyTime.ts
?? docs/100_ISSUE_62_INTERACTIVE_PROJECT_TIME_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/projectTime.test.ts
?? src/projectTimeClient.test.ts
?? src/projectTimeContract.test.ts
?? src/projectTimeTool.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` існував до цієї роботи. Його не чіпали.
