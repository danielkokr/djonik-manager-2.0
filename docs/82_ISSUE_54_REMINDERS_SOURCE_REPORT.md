# #54 — Нагадування, які зберігає і доставляє код: звіт source-реалізації

Дата: 2026-09-26. Issue: [#54](https://github.com/danielkokr/djonik-manager-2.0/issues/54) (canonical NOW за `docs/02`). Статус: **source-only, без commit / push / deploy / sync**. Remote Agent, Skills, Memory, хост і платний inference не чіпались.

## 1. Підсумок

Djonik розуміє нагадування в розмові, але саме нагадування тепер належить коду:

- **Модель** передає слова Daniel як структуру (`{day:"tomorrow"}`, `{day:"weekday",weekday:"mon"}`, `{time:"15:00"}`, `{in_minutes:60}`). Дати вона не рахує.
- **Код** визначає дату й момент за Europe/Kyiv, зберігає нагадування в стійкому стані хоста (атомарна заміна файла) і повертає готовий рядок підтвердження.
- **Доставка** не залежить від моделі, Session, Memory чи Trello:
  - нагадування з часом приходить окремим коротким повідомленням з кнопками `✅ Зроблено` / `⏰ Завтра`;
  - нагадування без часу код ставить першими рядками ранкового ритуалу того дня;
  - якщо ритуалу немає або він не спрацював, нагадування приходить окремим повідомленням.
- Кожен крок має exactly-once і crash-safe життєвий цикл за тим самим принципом, що й доставка #39.

Критерій «після підтвердження Daniel може забути» забезпечено кодом, а не інструкцією:

- рядок підтвердження з кодовою датою гарантовано потрапляє у відповідь;
- доставку не можна пропустити;
- рестарт не дублює доставку і не губить нагадування.

## 2. Змінені файли

| Файл | Що |
|---|---|
| `src/reminderTime.ts` (новий) | Дата/час: `when` → Kyiv-дата + instant; DST, quiet hours, минулий час, мітки |
| `src/reminders.ts` (новий) | Доменна модель, ledger, життєвий цикл, recovery, валідація, тексти |
| `src/reminderTool.ts` (новий) | Custom tool `reminder`: схема, парсинг, executor (authority, ідемпотентність за `custom_tool_use_id`, postcondition) |
| `src/reminderDelivery.ts` (новий) | Пряма доставка (scheduler), кнопки `rm1:`, Trello-контекст картки |
| `src/rhythmState.ts` | Необов'язкове поле `reminders` (свій версійований ledger), валідація при load, recovery |
| `src/rhythmRunner.ts` | Ранковий ритуал claim-ить нагадування дня атомарно зі своїм записом; код ставить 🔔-рядки першими; `readOnly` для `reminder list`; `ritualConfig()`; `recoverOnFirstTick` |
| `src/rhythmRuntime.ts` | Один таймер: одна recovery → rhythm tick → reminder tick; маршрутизація кнопок `rm1:`/`rh1:`; нагадування працюють і з вимкненим ритмом; `runNow`/`tickNow` для тестів |
| `src/djonikClient.ts` | Executor отримує `{toolUseId, name, authority}`; authority фіксується при першому спостереженні; `reminder` у підтримуваних; code-owned relay підтвердження; межа Memory-інструкцій |
| `src/customToolResolution.ts` | Executor отримує `{id, name}` виклику (#40-lifecycle без змін) |
| `src/releaseAttestation.ts` | `reminder` у `SUPPORTED_CUSTOM_TOOLS` (виконуваний цією ревізією; жоден reviewed release його ще не містить) |
| `src/servingRelease.ts` | Hook `customToolExecutor` |
| `src/telegramCli.ts` | Один спільний state store; роутер custom tools; нагадування вмикаються лише коли served release містить `reminder` |
| `src/trelloWorkHistory.ts` | `readCardState(cardId)` — GET-only читання однієї картки |
| `src/rhythmActions.ts`, `src/rhythmTelegram.ts` | `OutboundMessage.keyboard` — кодова клавіатура нагадування |
| Тести: `reminderTime` (15), `reminders` (7), `reminderTool` (14), `reminderDelivery` (21), `reminderClient` (9) — нові; `commitmentContract`, `rhythmRunner`, `customToolResolution`, `turnCompletion` — точкові правки | див. §11 |

## 3. Доменна модель і життєвий цикл

Нагадування (`reminders.ts`) зберігає лише payload і факти доставки:

- id;
- короткий текст Daniel;
- `project?` і `card?{id,name}`;
- `schedule`;
- `status`;
- `seq` (покоління доставки);
- `attempts`;
- `createdBy` (`custom_tool_use_id`);
- факти доставки.

Контексту розмови там немає.

```text
scheduled ──due (direct)──▶ sending ──Telegram ok──▶ delivered ──✅──▶ done
   │  ▲                         ├──definite refusal──▶ scheduled (retry) … ▶ failed (після 3)
   │  │                         └──unknown / crash──▶ ambiguous (ніколи не повторюється)
   │  └──snooze (seq+1) з scheduled / delivered / ambiguous / failed
   ├──ritual claim ──ritual sending──▶ sending (via ritual) ──▶ як вище
   │     └──ритуал не надіслав / crash──▶ claim знято → пряма доставка
   └──cancel──▶ cancelled
```

- **Snooze змінює те саме нагадування**, а не створює друге. `seq`+1 робить усі старі кнопки неактуальними.
- **Ідентичність для cancel/snooze консервативна:**
  - точний `id`;
  - або `match` — слово, яке входить рівно в одне придатне нагадування;
  - кілька збігів → `several_match` з кандидатами, нічого не змінено, модель ставить одне питання.
- **Дублікат:** той самий нормалізований текст на той самий момент → `duplicate`, нового не створено. Це захищає від повторного запиту в новій Session.
- **`list`:**
  - за замовчуванням лише активні (scheduled / sending / not_delivered), компактно, з кодовими мітками («сьогодні, сб 26.09 о 15:00»);
  - історія (delivered / done / cancelled за 14 днів, до 10) — лише з `include_history`.

## 4. Семантика дати й часу (`reminderTime.ts`)

Усе рахується за Europe/Kyiv на примітивах #39/#41 (`Intl`, не залежить від TZ машини):

| Запит | Правило |
|---|---|
| `today` / `tomorrow` / `day_after_tomorrow` | Календарні дні Києва (о 00:10 за Києвом «завтра» — вже від нової дати) |
| `weekday` («в понеділок») | Найближчий такий день **строго після** сьогодні. У понеділок «в понеділок» = наступний понеділок |
| `weekday` + `next_week` | Цей день у наступному ISO-тижні |
| `date` | `DD.MM` (найближча така дата від сьогодні, інакше наступний рік), `DD.MM.YYYY`, `YYYY-MM-DD`; неіснуюча дата → `invalid_date` |
| Лише `time` («о 15») | Сьогодні; якщо час минув — завтра, з `rolled_to_tomorrow` (підтвердження показує справжній день) |
| День + час у минулому, дата в минулому | `in_past` → одне коротке питання, нічого не збережено |
| День без часу | **Ранкове** нагадування: час ритуалу цього дня (з `/rhythm.md`), інакше `morning` / 09:30, ніколи не в quiet hours. Сьогодні після ранку → `needs_time` |
| `in_minutes` | now + N хв; не поєднується з днем/часом |
| Quiet hours (за замовчуванням 20:00–09:30) | Момент усередині → на **кінець** quiet hours: вечірній — наступного ранку, ранній — того ж ранку. Зберігаються і `requested`, і фактичний момент |
| DST | Зміщення Києва на цю дату. Неіснуючий час (весняний «розрив») зсувається вперед на розрив; подвійний (осінній) — перший |
| Горизонт | ≤ 366 днів |

Результат tool містить `confirmation`, напр.:

- `🔔 Нагадаю післязавтра, пн 28.09 зранку, у плані тижня: банер Azov`;
- `🔔 21:00 — це тихі години, тож нагадаю …`.

**Code-owned relay** (`composeReminderConfirmations`, за зразком #23 / #36):

- якщо відповідь моделі не містить цей рядок дослівно, код ставить його першим;
- якщо модель процитувала рядок, нічого не змінюється;
- успішна зміна без тексту моделі — теж повна відповідь.

## 5. Персистентність і crash-safety

- **Сховище.** Ledger `reminders: {version:1, items, toolCalls}` живе **в тому ж файлі**, що й стан ритму (`rhythm-state.json`, `$STATE_DIRECTORY`). Запис — атомарна заміна (temp + fsync + rename). Ранковий ритуал claim-ить нагадування **тим самим атомарним записом**, що й свій delivery record. Друге сховище не потрібне.
- **Сумісність.**
  - Поле необов'язкове і з'являється лише з першим нагадуванням, тож rhythm-only файл не змінюється.
  - Старша ревізія зберігає поле при записі: усі writer-и роблять spread поточного стану. Rollback не втрачає нагадувань.
- **Валідація.** Кожне нагадування і `toolCalls` перевіряються при load. Невідома форма → `RhythmStateError` → нічого не надсилається, tool відповідає `unavailable` («не збережено»). Втрачений стан ніколи не перетворюється на дубль.
- **Спершу persist, потім send.**
  - `sending` пишеться до виклику Telegram.
  - Crash → на старті `ambiguous`, без повторної відправки.
  - Невідомий результат Telegram → `ambiguous`.
  - Визначена відмова → до 3 спроб, далі `failed`; `list` показує його як `not_delivered`.
- **Recovery** виконується один раз на старті, **до** будь-якого claim:
  - `sending` → `ambiguous`;
  - ritual claim, що лишився після crash, знімається;
  - закриті нагадування старші за 30 днів і `toolCalls` старші за 14 днів чистяться;
  - відкриті нагадування не чистяться ніколи.
- **Застряглий claim.** Якщо запис ритуалу впав посередині без рестарту, claim має TTL 20 хв і нагадування не застрягає.

## 6. Виконання custom tool та ідемпотентність

`reminder` — перший custom tool з побічним ефектом. Він виконує admission rule `docs/01` §13 сам, не покладаючись на allowlist:

1. **Authority.** Клієнт фіксує `MutationAuthority` кожного `custom_tool_use_id` у момент **першого спостереження** (з trusted origin ходу, ніколи з тексту). Replay не може її підвищити.
   - create/cancel/snooze при `autonomous_read_only` executor відхиляє **до будь-якого доступу до стану**;
   - `list` дозволено всюди.
   - Автономний хід ритму, що спробував мутацію, `autonomousWriteViolations` бачить як порушення: текст ходу не доставляється. `list` клієнт позначає `readOnly` лише коли його власний input це доводить.
2. **In-process** (#40, без змін): одне виконання на id; повторний `requires_action` нічого не робить; кешований результат при невідомому send відправляється повторно тими самими байтами, без повторного виконання.
3. **Durable.** Результат мутації записується в `toolCalls[custom_tool_use_id]` **тим самим атомарним записом**, що й сама мутація. Той самий id (reconnect #53, новий процес, новий store на тому ж файлі) повертає записаний результат байт-у-байт і нічого не застосовує вдруге.
4. **Postcondition.** Успіх повертається лише після свіжого читання стану, яке показує очікуваний результат. Інакше `not_verified` і жодного рядка підтвердження.
5. **Без сховища** (шлях невідомий або release без `reminder`) → `unavailable`. Нагадування ніколи не обіцяється без стійкого місця.

## 7. Scheduler і доставка

- **Один lifecycle, без гонок.** Один таймер на процес виконує tick так:
  1. одноразова recovery спільного файла;
  2. **rhythm tick** — ранковий ритуал claim-ить нагадування дня;
  3. **reminder tick** — усе інше, що настало.

  Кроки ніколи не паралельні. Store — **один екземпляр** на процес, спільний з executor-ом (одна серіалізована черга записів).
- **Пряма доставка — без моделі.** Детермінований текст `🔔 Ти просив нагадати: <text>` + `Проєкт: …` / `Картка: «…»` + кнопки. Тому нагадування доходить навіть з вимкненим ритмом, після заміни Session чи при недоступному Trello.
- **Нагадування незалежні від ритму.** Вони працюють, щойно served release містить `tool reminder` і відомий `$STATE_DIRECTORY`. Read-only boundary для них не потрібна: ходу моделі немає.
- **Запізнення.** Якщо процес лежав у потрібний момент, нагадування чекає кінця quiet hours (за вікном, збереженим при створенні) і пише «⏱ Мало прийти … — надсилаю із запізненням».
- **Картка.** За наявності свіжого read (GET-only, ліміт 3 с) код каже лише те, що важливо: «картка «…» уже в Done». Помилка чи повільний Trello → нагадування без контексту.

## 8. Інтеграція з Working Rhythm

- **Ранкові ритуали** (план понеділка, бриф вт–чт, п'ятничний ранок) перед своїм ходом claim-ять ранкові нагадування цього дня. Далі:
  - prompt ритуалу називає їх і каже не повторювати, не створювати, не скасовувати і не переносити їх у цьому ході;
  - при `sending` ті, що досі claimed, стають `sending` у тому самому записі, а код ставить їхні рядки **першими** в повідомленні ритуалу. Модель їх не може пропустити;
  - так само рядки ставляться перед блокувальним повідомленням `AUTONOMOUS_WRITE_NOTICE`.
- **Fallback на пряму доставку:**
  - ритму немає;
  - вихідний без ритуалу;
  - `/rhythm.md` вимкнено;
  - config не прочитано;
  - хід моделі впав або відповідь порожня (claim знято, пряма доставка в тому ж tick);
  - ритуал не забрав нагадування за 30 хв після свого часу.
- **Статус нагадування йде за ритуалом:**
  - невідомий результат ритуального повідомлення → нагадування `ambiguous`;
  - визначена відмова → назад на пряму доставку.
- **Нагадування — не exception signals.** Їх немає в `deliveries`, тож вони не рахуються в cap, spacing чи «останній ритуал». Їх також не можна придушити іншими proactive-повідомленнями (тест: два нагадування доходять після вичерпаного cap).
- **Кнопки ритуального повідомлення** — лише кнопки ритуалу (≤ 3, docs/77). Дії з таким нагадуванням — текстом.

## 9. Telegram і кнопки

- `callback_data` = `rm1:<d|t>:<id>:<seq>` (без контенту, ≤ 64 B). Маршрутизація `rm1:` → обробник нагадувань, `rh1:` → ритм; обидва через той самий listener і перевірку allowed user.
- **`✅ Зроблено`** закриває **нагадування**, а не картку Trello. Ходу моделі немає, тож жоден Trello-tool не може спрацювати.
- **`⏰ Завтра`** переносить **те саме** нагадування через ту саму дату-логіку: timed → завтра о тій самій годині; ранкове → завтрашній ранок. `seq`+1.
- **Односторазовість.** Валідація і мутація — одне серіалізоване оновлення; подвійне натискання спрацьовує один раз; старий `seq` → «вже змінилось»; кнопка під `ambiguous` приймається (клік доводить доставку); клавіатура знімається.
- **Текст — повноправний шлях.** «Перенеси на завтра», «скасуй» йдуть через звичайну розмову → `reminder` tool. Кнопки — лише shortcut до тих самих доменних операцій.

## 10. Prompt / Memory-instructions

- **`DJONIK_MEMORY_INSTRUCTIONS`, останнє правило:**
  - було: «A next_check never means you will message first; do not promise reminders»;
  - стало: «A next_check never means you will message first and is not a reminder. Promise a reminder only after the reminder tool saved it.»
  - Розмір — 4071 B з 4096. Commitment ≠ reminder: жоден не випливає з іншого мовчки.
- **Інструкції використання — в описі tool** (ship-иться з Agent release): слова → структура, ніколи не обчислена дата; `confirmation` дослівно; «saved» лише при ok; одне питання при `ask` / `several_match`; не Trello і не commitment.
- `managed-agents/djonik.md` і Skills **не змінювались**. Тест #34 «coordinator не згадує remind» лишається чинним.

## 11. Перевірки

| Команда | Результат |
|---|---|
| `npm run typecheck` | **exit 0** |
| Нові: `reminderTime`, `reminders`, `reminderTool`, `reminderDelivery`, `reminderClient` | **66/66 pass** |
| Регресія #31/#36/#39/#40/#41/#45/#53 + release/serving/commitments: `trelloMutationLedger`, `trelloWorkHistory`, `workReviewContract`, `rhythm*`, `customToolResolution`, `turnCompletion`, `turnClock`, `djonikAgentSource`, `skills`, `pmRhythmSkill`, `planningAndFocus`, `streamRecovery`, `commitmentContract`, `release*`, `servingRelease`, `toolConfirmation*`, `djonikClient`, `telegramDispatch` | **903/903 pass** |
| `npm test` | **1149/1151 pass, 2 fail** |
| `git diff --check` | **exit 0** (лише попередження autocrlf) |

Два падіння — відомі Windows-середовищні, ті самі, що в docs/81:

- `deploy script survives replacing itself…` — CRLF-checkout `deploy.sh`;
- `a real process that fetched over keep-alive exits…` — код виходу 1 замість 78.

Їхні файли й предмет (`deployConfig.test.ts`, `processExit*.ts`, `deploy/`) ідентичні `HEAD`.

Покриття acceptance:

- **Дата:**
  - завтра за Києвом (зокрема після опівночі);
  - weekday і `next_week`;
  - DST кінець (пн 10:00 = 08:00Z), розрив/дубль;
  - явний час, минулий час (roll vs `in_past`), date-only vs timed;
  - незалежність від `TZ`.
- **Стан:**
  - reload / рестарт;
  - cancel, snooze того самого (`seq`);
  - два різні нагадування;
  - дублікат;
  - corrupt → fail closed (tool і rhythm tick);
  - recovery.
- **Ідемпотентність:**
  - replay `agent.custom_tool_use`;
  - повторний `requires_action`;
  - resend кешу без виконання;
  - той самий id після «рестарту» (новий store на тому ж файлі);
  - autonomous origin без доступу до стану;
  - `list` read-only.
- **Доставка:**
  - один раз;
  - рестарт до / після;
  - crash під час send → `ambiguous`;
  - unknown не повторюється;
  - відмова → 3 спроби → `failed`;
  - quiet-hours для запізнілого;
  - ritual inclusion рівно раз (бриф, план пн);
  - fallback: ритм вимкнено, вихідний, хід упав;
  - unknown ритуалу → `ambiguous`;
  - cancel під час ходу ритуалу;
  - не cap;
  - картка Done / Trello впав / повільний.
- **Кнопки:**
  - Done раз;
  - Завтра раз, старі кнопки stale, повторна доставка з `seq` 2;
  - чужий, malformed, unknown, недоставлене, не те повідомлення;
  - `rh1:` далі йде в ритм.
- **Текстовий шлях:** create → snooze (match) → cancel → list через звичайні ходи.
- **Межа модулів:** reminder-код без Trello-write, Session-клієнта, #40-lifecycle, мережі.

## 12. Обмеження і відкладене

- **Live і production не перевірялись.** Потрібен окремо авторизований крок:
  - **release r29**: Agent-версія з custom tool `reminder`. Опис і схема беруться з `SUPPORTED_CUSTOM_TOOLS` через `buildAgentUpdateBody`, атестація перевіряє їхні хеші;
  - cutover `SERVING_RELEASE`;
  - deploy.

  До цього в production **нічого не змінюється**: served r28 не має `reminder`, тож нагадування вимкнені, і state-файл, таймер чи Memory не чіпаються, якщо ритм вимкнений.
- **Потрібен `$STATE_DIRECTORY`** (systemd unit уже його має). Без нього tool чесно відповідає «не збережено».
- Не реалізовано (non-goals): повторювані нагадування, Calendar, нагадування іншим людям.
- **`in_minutes`** додано для «через годину», щоб модель не рахувала час сама. Відносні вирази на кшталт «через тиждень у середу» модель передає як `date` / `weekday`.
- **Нагадування в ритуальному повідомленні не мають власних кнопок** — свідомо (≤ 3 кнопки, одна легка дія, docs/77). Дії — текстом.
- **Повідомлення рендериться через спільний HTML-шлях**, тому `**…**` у тексті Daniel стане жирним.
- **Behavioral benchmark / live** (issue): «нагадай завтра про банер Azov» → підтвердження з кодовою датою → рядок у наступному брифі; timed-нагадування приходить один раз. Потрібні окремий бюджет і авторизація (docs/04 §27).
- **Governance:** оновлення `docs/01` (§10 / §13) і roadmap після приймання — за Product Owner.

## 13. `git status --short`

```text
 M src/commitmentContract.test.ts
 M src/customToolResolution.test.ts
 M src/customToolResolution.ts
 M src/djonikClient.ts
 M src/releaseAttestation.ts
 M src/rhythmActions.ts
 M src/rhythmRunner.test.ts
 M src/rhythmRunner.ts
 M src/rhythmRuntime.ts
 M src/rhythmState.ts
 M src/rhythmTelegram.ts
 M src/servingRelease.ts
 M src/telegramCli.ts
 M src/trelloWorkHistory.ts
 M src/turnCompletion.test.ts
?? docs/82_ISSUE_54_REMINDERS_SOURCE_REPORT.md
?? src/reminderClient.test.ts
?? src/reminderDelivery.test.ts
?? src/reminderDelivery.ts
?? src/reminderTime.test.ts
?? src/reminderTime.ts
?? src/reminderTool.test.ts
?? src/reminderTool.ts
?? src/reminders.test.ts
?? src/reminders.ts
```
