# #50 — Фокус із Trello, таймбокс, живе перепланування і тижневий час по проєктах: source і offline-перевірка

2026-09-28. Implementation Engineer. База: `main` @ `0902005`. **Source-only кандидат для review Product Lead.**

Що НЕ робилось:
- commit, branch, push, deploy;
- зміни Agent / Skill sync / Session;
- запис у production Trello чи Memory;
- платна інференція чи benchmark.

Canonical NOW лишається #50. **#50 не завершено.**

---

## 1. Підсумок

Трекінг фокусу працює без моделі. Кожен збір фактів ритму (GET-only, ~15 хв) бачить картки в **In progress** з авторитетної історії списків Trello і оновлює стан фокусу в наявному `rhythm-state.json`. Модель для цього не викликається.

Таймбокс працює лише для явного бюджету, який Daniel назвав сам («беру Azov на 2 години»):
- бюджет записує вузький side-effecting інструмент `focus_budget`;
- елапс рахується тільки в робочих годинах (`work_hours`);
- далі кандидат іде **наявним** шляхом винятків ритму: quiet hours, caps, spacing, mute, `SILENT`.

У п'ятницю код рахує тижневий блок «⏱ Час по проєктах ≈ за переміщеннями в Trello»:
- з того самого action-log, що й `trello_work_history`;
- код ставить блок одразу після фактів історії, перед текстом Claude (exact relay).

Також зроблено:
- понеділкове повідомлення тепер відповідає на питання «що має бути правдою до п'ятниці»;
- «зупинився на X» записує один канонічний рядок у картку через наявний verified write;
- знайдений розрив маршрутизації custom-tools у `telegramCli` виправлено.

## 2. Змінені файли

**Нові модулі:**

| Файл | Що |
|---|---|
| `src/workingTime.ts` | Вікна робочого часу, елапс і дедлайн бюджету (Kyiv, DST) |
| `src/rhythmFocus.ts` | Ledger фокусу, `advanceFocus`, `currentFocus`, `detectTimeboxSignals` |
| `src/weeklyTime.ts` | Інтервали In progress, розподіл, cap, рендер, reporter, композиція exact relay |
| `src/focusBudgetTool.ts` | Custom tool `focus_budget` (docs/01 §13) |

**Змінені модулі:**

| Файл | Що змінилось |
|---|---|
| `src/rhythmConfig.ts` | Ключі `work_hours`, `daily_time_cap`; рядок у `describeRhythmConfig` |
| `src/rhythmState.ts` | Опційне поле `focus`, валідація, `focusOf` / `withFocus` |
| `src/rhythmSignals.ts` | Вид `timebox_elapsed`; правило злиття з ритуалом |
| `src/rhythmFacts.ts` | Читання останнього входу для In-progress карток; експорт `listEntry` |
| `src/rhythmRunner.ts` | Просування фокусу і таймбокс-сигнали в одному атомарному записі; п'ятничний блок; промпти |
| `src/rhythmRuntime.ts` | Проводка weekly reporter |
| `src/rhythmActions.ts` | Кнопка `▶️ Почав` |
| `src/djonikClient.ts` | `createCustomToolRouter`, `workHistoryAnswerText` у traced turn, підтвердження `focus_budget` |
| `src/telegramCli.ts` | Роутер замість fallback; executor `focus_budget`; weekly reporter |
| `src/trelloWorkHistory.ts` | Експорт `kyivLocalInstant`; `listId` у `readCardState` |
| `src/release.ts` | `RELEASE_R30_CANDIDATE` + `focus_budget` |
| `src/releaseAttestation.ts` | `focus_budget` у `SUPPORTED_CUSTOM_TOOLS` |
| `src/pmBenchmark.ts`, `src/pmFixture.ts` | S22–S25 |

**Skills:**
- `.claude/skills/pm-rhythm/SKILL.md`
- `.claude/skills/planning-and-focus/SKILL.md`
- `.claude/skills/task-management/SKILL.md`

**Документи:**
- `docs/77_DJONIK_MESSAGE_TEMPLATES_APPROVED.md`: §4.3, §4.5, §4.6;
- цей звіт.

**Тести:**
- нові: `workingTime`, `rhythmFocus`, `weeklyTime`, `focusBudgetTool`, `rhythmFocusRunner`, `customToolRouting`;
- розширені: `rhythmFacts`, `rhythmRunner`, `rhythmActions`, `reminderDelivery`, `trelloMutationLedger`, `releaseR30Candidate`, `pmBenchmark`, `pmRhythmSkill`, `skills`, `planningAndFocus`.

## 3. Фінальна архітектура

```text
rhythm tick (наявний, 1 хв; факти ≤ 1 раз / 15 хв у вікні винятків)
  └─ collectFacts (GET-only; + latest list entry для In-progress карток, ≤ 10)
       └─ ОДИН store.update:
            advanceFocus(focus, facts)                       ← код, 0 викликів моделі
            detectSignals + detectTimeboxSignals(focus)      ← лише явний бюджет + work_hours
            advanceSignalLedger                              ← наявний lifecycle
  └─ selectException (наявні quiet hours / caps / spacing / mute / ritual merge)
       └─ одна автономна read-only турa → SEND або SILENT
  └─ friday-review: weeklyTime(now, config) ДО тури → блок у промпті
       └─ відповідь → composeWeeklyTimeReply: [історія #36][⏱ блок][текст Claude]

Daniel: «беру X на 2 години» / «▶️ Почав» → task-management:
  verified move → In progress; focus_budget set (лише його хвилини)
```

Чого немає:
- другого планувальника, демона чи JSON-файлу;
- другого Trello-клієнта історії;
- бази даних, webhook-ів, стороннього трекера;
- копії фокусу в Memory.

## 4. Детекція фокусу з дій Trello

**Джерело — лише авторитетні дії Trello:**
- `updateCard` зі зміною `listBefore → listAfter`;
- `createCard`, `copyCard`, `moveCardToBoard` зі списком;
- той самий `listEntry`, що вже використовує Working Rhythm.

Час входу в In progress — це `CardFact.enteredListAt`:
- з вікна історії дошки (≈ 11 днів);
- або з окремого `readLatestListEntry` для кожної In-progress картки (новий, до 10 читань).

Не використовуються: `lastActivityAt`, `dateLastActivity`, опис, розмова, модель.

**Що доводить Trello, а що ні:**
- **Авторитетно:** картка перебувала у списку In progress з моменту T.
- **Не доводиться:** що Daniel безперервно над нею працював.

## 5. Модель стану фокусу і рестарт

`RhythmState.focus` (опційне, `version: 1`) містить:
- `active` — картки в In progress: `{cardId, project slug, enteredAt | null, observedAt}`;
- `ended` — до 20 останніх завершених відрізків, 14 днів: `{…, nextListEnteredAt, to: роль списку | gone | unknown}`;
- `budgets` — `{cardId, enteredAt, minutes, setAt, toolUseId}`;
- `toolCalls` — записи ідемпотентності `focus_budget`, 14 днів.

Назв карток, описів, тексту повідомлень чи транскриптів у стані немає.

**Як стан відповідає на питання issue:**
- активна картка / проєкт → `currentFocus`;
- початок відрізка → `enteredAt`;
- перекриття → `parallel`;
- бюджет → `budgets`;
- як відрізок закінчився → `ended.to` та `nextListEnteredAt` (верхня межа моменту виходу).

**Рестарт і rollback:**
- Файл пишеться лише через наявний `RhythmStateStore.update`: атомарно, з fsync і rename.
- Порожній ledger у стан без `focus` не записується, тож rhythm-only файл не змінюється.
- Старіша ревізія приймає файл: її `isState` не відкидає зайвих полів, а всі її writers роблять spread стану.
- Тести доводять, що невідоме майбутнє поле переживає recover і update, а стан до #50 читається без змін.
- Пошкоджене поле `focus` → `RhythmStateError` → нічого не надсилається (fail closed, як і для reminders).
- Нової версії стану немає.

## 6. Рішення щодо кількох карток в In progress

Напруга з issue вирішена двома правилами:

1. **Поточний фокус** — відрізок з **найпізнішим** авторитетним входом у In progress. Невідомий час входу ніколи не переважає відомий.
   - Друга картка, що входить у In progress, стає поточним фокусом.
   - Перша картка **не завершується**: вона лишається активною, доки не вийде зі списку.
2. **Облік часу** зберігає всі перекриття і ділить кожен спільний відрізок **порівну** (§13).

Чому так:
- Trello дозволяє кілька карток In progress;
- Daniel «переходить» на нову картку, але стару не завжди прибирає;
- завершувати стару штучно означало б вигадувати подію, якої в Trello немає.

Для таймбоксу бюджет належить конкретній картці, а не «поточному фокусу». Тому перекриття не губить таймер.

## 7. Бюджет і Size

- **Size (S/M/L/XL) ніколи не є тривалістю.**
  - `CardFact` взагалі не містить Size.
  - Схема `focus_budget` не має поля size.
  - Опис інструмента це прямо забороняє; тест перевіряє, що `size: "M"` дає `invalid_input`.
- Бюджет — лише хвилини, які назвав сам Daniel: 15–720, ціле число.
- Бюджет прив'язаний до `enteredAt` поточного відрізка. Вийшов із In progress або повернувся → бюджет зникає.
- Рішення #48 не змінено: Size як Custom Field не пишеться. Псевдополя в описі немає.

## 8. Рішення щодо робочих годин

**Ключ `work_hours: HH:MM-HH:MM`:**
- діє лише в `workdays`, Europe/Kyiv, у межах однієї доби;
- мінімальна тривалість 30 хв;
- `off` прибирає ключ;
- **дефолту немає**;
- невалідне значення → попередження, ключ лишається незаданим.

Без `work_hours` таймбокс і тижневий звіт вимкнені та чесно кажуть «недоступний». Робочі години не виводяться з quiet hours чи часу ритуалів — тест це перевіряє.

**Ключ `daily_time_cap`:**
- приймає `8h`, `7.5h`, `7,5 год`, `450m`, `450`;
- діапазон 1–16 год, дефолт 8 год.

Обидва ключі невідомі старішій ревізії: вона зберігає їх як `unknownKeys`, без помилки.

**DST.** Межі вікна — це локальні хвилини, перетворені в instant для кожної дати (`kyivLocalInstant`, наявний ітеративний алгоритм #36). Тести покривають обидва переходи:
- весняний «з'їдений» годинник;
- осінній «подвоєний» годинник.

**Навчання Claude.** `pm-rhythm` вчить записувати `work_hours` лише зі слів Daniel.

## 9. Поведінка таймбоксу в планувальнику

**Коли з'являється кандидат `timebox:<cardId>`:**
- відрізок активний;
- бюджет прив'язаний до цього відрізка;
- `workingDeadline(max(enteredAt, setAt), minutes)` ≤ now.

Параметри сигналу:
- fingerprint = `enteredAt|setAt|minutes`;
- `severity: medium`, `channel: interrupt`.

**Далі все наявне, без змін:**
- mute (`kind:timebox_elapsed` або конкретний id);
- quiet hours, вихідні;
- `preferredPerDay` / `maxPerDay`, spacing;
- статус `evaluated` / `notified` → повтору немає.

**Одна свідома відмінність.** Звичайний medium-факт чекає ритуалу, що ще буде сьогодні. Таймбокс чекає лише ритуалу в межах spacing, як high. Причина: п'ятничний огляд о 16:30 не відповість на питання «перемикатись о 12:00».

**Промпт для ⏱ каже:**
- питання — «чи змінити дію», а не «чи минув таймер»;
- спершу свіжий `trello_board_snapshot` і `commitments/`;
- бюджет ≠ «зупинись»;
- якщо поточна робота найкраща → `SILENT`;
- писати лише тоді, коли інша записана обіцянка під ризиком.

**Затримка.** Детекція можлива лише під час збору фактів, тобто щонайбільше раз на 15 хв у відкритому вікні винятків.

## 10. Перепланування на події

Нової шини подій немає. `planning-and-focus` отримав одне правило: на «доробив», «клієнт переніс», прийнятий новий дедлайн чи перевірений перехід у Waiting/Done Djonik перечитує Trello і каже **лише** що змінюється на сьогодні, не повторюючи весь план.

Проактивних переривань на кожне клієнтське повідомлення немає: переслане джерело лишається read-only (#48). Сценарій S24 перевіряє «лише дельту».

## 11. Збереження наступного кроку

Правило в `task-management`, наявний verified-шлях:
1. Точна картка; неоднозначно → одне питання, нуль записів.
2. Прочитати опис.
3. Записати його з **рівно одним** рядком `▶️ Наступний крок: <X>`: замінити наявний рядок або додати в кінець. Решта байтів без змін.
4. Перевірити повний опис читанням тієї ж картки.

Ledger #31 вимагає збігу **всього** опису. Тести доводять:
- заміна маркера → `verified`;
- втрата решти опису → `field_mismatch`;
- другий дописаний маркер → `field_mismatch`.

При поверненні до проєкту крок береться з картки (`planning-and-focus`, project view). Копії в Memory немає.

Обмеження: правильну заміну рядка формує модель. Код гарантує лише, що перевірено саме запитаний повний опис, а не що модель його правильно склала (§19).

## 12. Алгоритм тижневого часу

**Вікно:** `resolveHistoryWindow({kind:"this_week"})`, тобто пн 00:00 Kyiv → зараз (момент п'ятничного огляду).

**Читання:** наявний `TrelloWorkHistoryClient`, GET-only — `resolveSingleBoard`, `readCards` (`cards/all`, з архівними), `readLists`, `readActions` (той самий фільтр і пагінація, що й `trello_work_history`). Нічого не зберігається.

**Кроки:**
1. **Reverse replay для кожної картки.**
   - Стан «зараз»: список і `closed`; картки немає серед карток → «не існує».
   - Скасувати події у вікні від найновіших: переміщення → `listBefore`; архів/розархів → `old.closed`; створення → не існувала; видалення / `moveCardFromBoard` → існувала в `data.list`.
   - Так виходить стан на початок вікна; далі прямий прохід формує інтервали In progress.
   - Відкритий інтервал закривається на cutoff.
   - Роль списку визначається за назвою через `listRoleFor`, так само як у ритмі.
2. **Відсікання робочими годинами.** Беруться лише вікна `work_hours` у `workdays` (§8).
3. **Порівну.** Точки перелому всередині дня: межі вікна та межі інтервалів. Кожен елементарний відрізок ділиться порівну між активними картками.
4. **Cap** — див. §13.
5. **Агрегація за поточною міткою (правило #36):**
   - одна мітка → назва мітки;
   - немає → `без проєкту`;
   - кілька → `кілька міток`.
   - «Без мітки» і «кілька міток» ідуть в кінці.
6. **Рендер:** округлення до 0,5 год, десяткова кома; менше 15 хв → `< 0,5 год`.

**Недоступно:**
- немає `work_hours`;
- історія обрізана (`truncated` або не досягнуто найстарішої дії);
- будь-яка помилка читання.

У кожному з цих випадків є фіксований рядок «недоступний … Годин не оцінюю.» і жодних часткових цифр.

## 13. Розподіл паралельних карток і денний cap

- **Порівну.** Дві картки 2 робочі години разом → по 1 год. Ексклюзивний час лишається за своєю карткою.
- **Позначка «грубо»** (`rough`): частка паралельного часу ≥ 25 % обліченого (`ROUGH_PARALLEL_SHARE`). Блок тоді додає один рядок: «…поділено порівну, тож цифри грубі».
- **Денний cap — пропорційний.** Якщо об'єднаний час дня U > cap C, частка кожної картки цього дня множиться на C/U.
  - Вибрано пропорційний, а не хронологічний («перші 8 год»), щоб не віддавати перевагу ранковим карткам.
  - Блок завжди каже, скільки днів урізано, тож вплив cap не прихований.
  - Приклад з тестів: вікно 09–19, дві картки весь день → 10 год → 8 год → по 4 год. Cap 6h → 3+3; 12h → 5+5.

Жодних productivity score, utilisation, оцінок чи білінгу.

## 14. Композиція п'ятничного exact relay

1. Для ритуалу `friday-review` код **до** тури рахує блок (або «недоступний»). Промпт показує блок і забороняє повторювати, перераховувати, округлювати чи переказувати години; дозволено щонайбільше один 💭.
2. `DjonikTracedTurn` тепер має `workHistoryAnswerText`: точний `answer_text` #36, яким клієнт почав відповідь через exact relay. Його ставить лише наявна гілка `workHistory.status === "verified"`.
3. `composeWeeklyTimeReply`:
   - якщо відповідь **починається** з цього тексту → `історія` + `\n\n⏱ блок` + решта (сепаратор «PM-висновок» і коментар Claude);
   - інакше блок іде першим, далі текст Claude без змін.
4. Заблокована автономна тура (спроба запису) надсилає лише фіксоване повідомлення, без блоку.

Гарантія: блок з'являється байт-у-байт і стоїть перед текстом моделі. Модель не може змінити цифри блоку. Якщо модель порушить Skill і згадає інші години у своєму коментарі, це видно (S25 `no_hours_restated`), але код коментар не цензурує.

## 15. Ставки тижня

- `pm-rhythm`, розділ Monday: питання «**what must be true by Friday?**»;
- до трьох ставок, без розкладу по днях;
- день тижня біля результату — лише з записаної обіцянки;
- шаблон `🎯 1. <що має бути правдою до кінця тижня>`;
- 📌 / ⏳ / ➡️ / 💭 і прийняття в Memory без змін;
- `planning-and-focus` (Week) — те саме одним реченням;
- docs/77 §4.3 оновлено з позначкою #50.

## 16. Інтеграція з benchmark

`BENCHMARK_REVISION` → `pm-quality-3`. S1–S21 не змінювались. Додано S22–S25; усі в critical-наборі.

| ID | Сценарій | Перевірки |
|---|---|---|
| S22 | Бюджет минув, нічого терміновішого (у `cl-deck` прибрано due) | `silent_or_short` (SILENT або ≤ 4 рядки), `zero_write` |
| S23 | Бюджет минув + записана обіцянка Cossack Labs на вт 29.09 | `non_silent`, `zero_write`, rubric «decision» (перемкнутись) |
| S24 | Переслане «друкарня чекає файли Extract сьогодні до 17:00» | `zero_write`, `non_silent`, `delta` (≤ 8 рядків) |
| S25 | П'ятничний промпт з детермінованим блоком | `non_silent`, `no_hours_restated`, `zero_write` |

Промпти будують ті самі функції runtime (`buildExceptionPrompt`, `buildRitualPrompt`).

S25 використовує власну п'ятничну мітку годинника в промпті. `FIXED_CLOCK` (пн) стосується лише людських тур.

Платного прогону не було. **`pass^3` не заявляю.** Offline-симуляція лише доводить, що runner і таблиця обробляють нові id. Її fake-вердикти не є поведінковим доказом.

## 17. Межа релізу та незмінність r29

- `SERVING_RELEASE` = r29.
- r25–r29 не змінено; тести lockstep для r29 проходять, новий тест перевіряє, що жоден r25–r29 не має `focus_budget`.
- `RELEASE_R30_CANDIDATE` (unresolved) додає лише `focus_budget` до custom tools.
- Змінені Skills (`planning-and-focus`, `pm-rhythm`, `task-management`) уже unresolved з #47/#48.
- `agent.version: null`. Жодних вигаданих `skill_` / `skver_` / Session id. Тіло оновлення генерує схему з `SUPPORTED_CUSTOM_TOOLS`.
- `reminder` лишається dormant.

**Виправлений розрив маршрутизації.** `telegramCli` раніше відправляв будь-який custom tool, крім reminder, у `executeTrelloWorkHistoryFromEnvironment`. Тож `trello_board_snapshot` на r30 виконав би не той інструмент.

Тепер один `createCustomToolRouter`:
- маршрут за точною назвою;
- side-effecting інструмент без executor → «unavailable»;
- невідома назва → `unknown_tool`, fail closed.

Той самий роутер є дефолтним executor клієнта. Регресійні тести перевіряють кожен маршрут і відмову для невідомої назви.

**`focus_budget` і docs/01 §13:**
- лише human authority; автономна тура отримує відмову ще до будь-якого читання Trello чи стану;
- до того ж автономний виклик блокує повідомлення (`autonomousWriteViolations`);
- ідемпотентність за `custom_tool_use_id` в одному атомарному записі; replay (включно з новим процесом) повертає записаний результат без повторної мутації і без нового читання Trello;
- ціль доведена свіжим GET: картка відкрита, в In progress, авторитетний вхід саме цієї картки в поточний список;
- успіх лише після перевірки свіжим читанням стану.

**`▶️ Почав`:**
- ранковий бриф має кнопки `✅ Ок · ▶️ Почав · 📋 Детальніше` (замість `🔄 Переставити`);
- клік дорівнює набраному «беру <🎯>»;
- кнопка не дає більше прав, ніж текст;
- це зміна UI, яку має побачити PO (§19).

## 18. Тести і точні результати

| Перевірка | Результат |
|---|---|
| Фокусні набори (17 файлів: нові + зачеплені rhythm / focus / weekly / release / benchmark / skills / ledger / reminder) | **384/384 passed** |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npm test`, фінальний повний прогін | **1300 tests, 1298 passed, 2 failed** |
| `npm run benchmark:pm -- --offline --mode critical …` | симуляція працює (файл у scratchpad, не в repo) |
| `git diff --check` | passed |

Базовий рівень до змін: 1233 / 1231.

Два падіння фінального прогону — ті самі Windows-базові:
- `deployConfig.test.ts` (CRLF);
- `processExit.test.ts` (exit code).

Ці файли й `deploy/` без diff.

В одному проміжному повному прогоні ще раз упав `reminderDelivery` «crash during the Telegram call»:
- тест має фіксоване очікування 20 мс на реальний файловий I/O;
- окремо файл проходив 3/3;
- наступний повний прогін чистий;
- docs/84 уже фіксував такий флейк під навантаженням.

**Що покрито:**
- **Фокус:** вхід і вихід; наступна картка; перекриття; невідомий вхід; вихід і повторний вхід між тіками; `gone`; бюджет живе лише в межах свого відрізка; нуль викликів моделі; рестарт через файл.
- **Час:**
  - відсікання до і після робочих годин, вихідні, власні `workdays`;
  - DST весна й осінь;
  - відкритий інтервал; reverse replay (архів, створення, «вже був у In progress»);
  - «порівну» 2×2 год → 1+1;
  - часткове перекриття і поріг `rough`;
  - агрегація, «без проєкту», cap 8 / 6 / 12 год, рендер;
  - «недоступний» у трьох варіантах; вікно reporter.
- **Таймбокс:**
  - без бюджету таймера немає; Size не є тривалістю; явні 2 год; вечір і переніс на наступний день;
  - quiet hours; cap / spacing; mute;
  - дубль тіку; `SILENT` → `evaluated` без повтору; зміна дії → одна відправка;
  - таймбокс не відкладається до п'ятничного огляду;
  - автономний `focus_budget` → блок.
- **`focus_budget`:** схема; authority; ідемпотентність і replay після рестарту; доказ цілі (5 відмов); невалідний ввід; без `work_hours`; clear; postcondition.
- **Next step:** заміна, втрата опису, дубль маркера; контракт Skill.
- **П'ятниця:** порядок блоків; модель не змінює тоталі; «недоступний» при відсутньому reporter і при помилці; блок при заблокованому записі не додається; інші ритуали без блоку.
- **Конфіг:** парсер, невалідні значення, `off`, невідомі ключі, quiet hours ≠ робочі години.
- **Реліз і маршрутизація:** незмінність r25–r29; `focus_budget` лише в кандидаті; кожен маршрут; невідомий інструмент.

## 19. Відомі обмеження / що потребує live-перевірки

**Авторитетне, наближене, невідоме:**
- **Авторитетно (Trello):** картка була в In progress з T до T′; поточна мітка; список.
- **Наближено (код):** години по проєктах — лише час у робочих годинах, поділений порівну, з cap. Це не обсяг роботи.
- **Невідомо:** чи Daniel реально працював, паузи всередині дня, робота поза Trello.

**Хто що вирішує:**
- **Код:** факти фокусу, дедлайн бюджету, чи можна перервати (ліміти), цифри тижневого блоку, їх позиція.
- **Claude:** чи варто змінити дію (або `SILENT`), формулювання, один 💭, поведінка на «беру X» і «зупинився на X».

**Технічні обмеження:**
- Детекція фокусу й таймбоксу оновлюється лише під час збору фактів: щонайбільше раз на 15 хв і лише у відкритому вікні винятків. Для обліку це не важить, бо тижневий звіт рахується з історії.
- Затримка таймбоксу до ~15 хв.
- `ended.nextListEnteredAt` — верхня межа моменту виходу, а не точний час.
- Картки, видалені з дошки, рахуються як «без проєкту» (міток немає).
- Мітка — поточна, як у #36.

**Не перевірено (потрібен live або PO):**
- Реальна форма `readLatestListEntry` / `cards/all` для архівних карток на production-дошці.
- Поведінка моделі в S22–S25 та в «беру X» / «зупинився на X»: чи вона коректно замінює маркер, не повторює години, пише `SILENT`.
- Реальна форма провайдера для нового custom tool: схему й дубль-статуси покрито офлайн, live-тури не було.
- Сама активація: Working Rhythm на хості вимкнений ключем `DJONIK_WORKING_RHYTHM`. r30 не створено. Таймбокс і п'ятничний блок у production не діють.

**Рішення для PO / PL:**
- кнопки ранкового брифу (`▶️ Почав` замість `🔄 Переставити`);
- «беру X» як прямий verified move без окремого підтвердження;
- поріг `rough` 25 %;
- пропорційний cap;
- ліміт розміру `planning-and-focus` піднято з 12 500 до 12 750 байт: зростання +301 B після нормалізації LF, 12 326 → 12 627;
- `pm-rhythm` 14 241 → 16 467 B; `task-management` 17 779 → 19 379 B (LF).

## 20. `git status --short`

```text
 M .claude/skills/planning-and-focus/SKILL.md
 M .claude/skills/pm-rhythm/SKILL.md
 M .claude/skills/task-management/SKILL.md
 M docs/77_DJONIK_MESSAGE_TEMPLATES_APPROVED.md
 M src/djonikClient.ts
 M src/planningAndFocus.test.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmFixture.ts
 M src/pmRhythmSkill.test.ts
 M src/release.ts
 M src/releaseAttestation.ts
 M src/releaseR30Candidate.test.ts
 M src/reminderDelivery.test.ts
 M src/rhythmActions.test.ts
 M src/rhythmActions.ts
 M src/rhythmConfig.ts
 M src/rhythmFacts.test.ts
 M src/rhythmFacts.ts
 M src/rhythmRunner.test.ts
 M src/rhythmRunner.ts
 M src/rhythmRuntime.ts
 M src/rhythmSignals.ts
 M src/rhythmState.ts
 M src/skills.test.ts
 M src/telegramCli.ts
 M src/trelloMutationLedger.test.ts
 M src/trelloWorkHistory.ts
?? docs/87_ISSUE_50_FOCUS_TIMEBOX_WEEKLY_TIME_SOURCE_REPORT.md
?? src/customToolRouting.test.ts
?? src/focusBudgetTool.test.ts
?? src/focusBudgetTool.ts
?? src/rhythmFocus.test.ts
?? src/rhythmFocus.ts
?? src/rhythmFocusRunner.test.ts
?? src/weeklyTime.test.ts
?? src/weeklyTime.ts
?? src/workingTime.test.ts
?? src/workingTime.ts
```
