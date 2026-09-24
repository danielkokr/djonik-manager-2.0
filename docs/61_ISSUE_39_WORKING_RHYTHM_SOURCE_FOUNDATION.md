# #39 — Робочий ритм: source-фундамент і кнопки Telegram (перший bounded етап)

Дата: 2026-09-24. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 64).

**Статус:** звіт про source/offline-реалізацію, **не** документ приймання. Product Lead прийняв архітектуру і scope на рівні звіту; code-level review ще триває. Після нього виконано один bounded final-review pass (§19). Усе uncommitted і чекає review Product Lead. Production не змінювався, ритм у production **не** активовано, кнопки live **не** тестувались, платного inference не було.

## 1. Репозиторій і HEAD

- Гілка `claude/stoic-wright-0j0djd` = `main` = `origin/main` = `f6e4cde5e0faafac2c429b1d1914e00888ada2e0` (`docs: accept issue 34 and promote issue 39`), перевірено `git fetch origin main`. До змін `git status --short` був порожній.
- `docs/02`, рядок 64: **єдиний NOW — #39**. #34 DONE (рядок 63), #35 іде після #39.
- GitHub #39 відкритий; єдиний коментар (2026-09-24) — про promotion: «scope is unchanged… The first bounded step will be defined in review». Перший bounded етап визначено в завданні Product Owner / Product Lead від 2026-09-24 (цей документ, §3).
- Production за docs/60 (цей етап його не торкався): app `d59a532…`, r26, Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` v26, Sonnet 5 medium/standard, specialist v4, Memory `read_write`, Hetzner + systemd.
- Базовий прогін на незміненому HEAD (лише tracked-тести): **680/680**.

## 2. Що реалізовано

Чистий source-зріз, який робить поведінку #39 представною і перевірюваною офлайн:

1. канонічний формат `/rhythm.md`: детермінований парсер, валідація, безпечні дефолти, forward-compatible невідомі ключі;
2. детермінований розклад ритуалів у Europe/Kyiv (DST-коректний) зі стабільною ідентичністю кожного occurrence;
3. детерміновані сигнали з явним поділом **ritual observation** vs **interrupt candidate**, життєвий цикл сигналу, mutes і ліміти відбору (тиха зона, вихідні, cap 1 / max 2, інтервал 2 год, групування);
4. durable, ідемпотентний стан доставки (один JSON-файл, атомарний запис) з чесними crash-межами;
5. оркестратор tick-у з інжектованими годинником, config source, станом, Djonik-ходом і Telegram-відправкою; детектор автономних записів;
6. inline-кнопки Telegram для проактивних повідомлень і обробник callback, що перетворює клік на звичайну репліку Daniel у тому самому шляху, що й набраний текст;
7. Skill `.claude/skills/pm-rhythm/SKILL.md` (лише source);
8. kill switch: ритм **вимкнено за замовчуванням**, і `telegramCli.ts` цей runtime взагалі не завантажує.

## 3. Рішення Product Owner, представлені в коді / Skill

| Рішення (2026-09-24) | Де представлено |
|---|---|
| Ритуали передбачувані, переривання рідкісні, розмова природна | `rhythmSignals.ts` (SILENT — нормальний результат), Skill «Exceptions» |
| Пн ~09:30: пропозиція плану тижня **замість** брифу; це пропозиція, не прийнятий план | `ritualsForDate` (`monday-plan`), Skill «Monday» |
| Вт–Чт ~09:30: один фокус → 1–2 другорядні → що чекає; 3–8 рядків | `morning`, Skill «Tuesday–Thursday» |
| Пт зранку: легший бриф, не замінюється оглядом | `friday-morning`, незалежний `friday_morning` |
| Пт ~16:30: розмовний огляд, без scores | `friday-review`, Skill «Friday afternoon» |
| Тихий день: ранковий ритуал усе одно пише коротко | ритуал ніколи не SILENT (`empty_reply` → failed), Skill «Quiet day» |
| Виняток лише коли чекання до наступного ритуалу суттєво шкодить | вузький набір interrupt candidates (§7), Skill «Exceptions» |
| ≤ 1 виняток/день зазвичай; другий лише для нової high severity; ніколи > 2; ≥ 2 год; групування | `selectException`, `EXCEPTION_HARD_CEILING = 2` |
| Тиха зона 20:00–09:30; вихідні без проактивності; без «черги-вибуху» о 09:30 | `isQuietTime`, `defer` без черги, `weekend_exceptions: off` |
| Природна мова — основний спосіб керування; YAML — деталь реалізації | Skill «Tuning the rhythm by conversation» |
| «Менше» ≠ «ніколи»: жорстке і тимчасове приглушення — це mute, м'яке побажання — ні | Skill, три категорії (§8); детермінований шар знає лише явні mute |
| Кнопки — ярлики, 2–3, контекстні; не мутують Trello; клік = звичайна репліка | `rhythmActions.ts`, `rhythmTelegram.ts` |
| 18:30 «що переносимо?» — вимкнено за замовчуванням | `evening: null` у дефолтах |
| Автономні ходи лише читають | prompt-правила + детектор `autonomousWriteViolations` (§13) |

## 4. Архітектура

```text
(майбутній таймер в адаптері, вимкнено)
   ↓ tick(now)
rhythmRunner.createRhythmScheduler ─┬─ RhythmActivation   (env kill switch, default OFF)
                                    ├─ RhythmConfigSource (/rhythm.md — межа, не підключено; §17)
                                    ├─ rhythmConfig.parse  (чисто)
                                    ├─ rhythmSchedule      (чисто, Europe/Kyiv)
                                    ├─ collectFacts?       (межа, не підключено; §17)
                                    ├─ rhythmSignals       (чисто: detect → classify → lifecycle → limits)
                                    ├─ RhythmStateStore    (JSON-файл, атомарний, серіалізований update)
                                    ├─ runTurn             (межа → той самий serving Session, FIFO)
                                    └─ send                (rhythmTelegram: текст + опційна клавіатура)

Telegram callback_query → rhythmTelegram.createRhythmCallbackHandler
   → перевірки (ref, Session, TTL, одноразовість) → utterance
   → MessageGroupBuffer.addFragment (той самий вхід, що й message:text)
   → createGroupDispatchHandlers → session.sendOrdered (FIFO single-flight, #31/#32/#40)
```

- Нові модулі: `rhythmConfig.ts`, `rhythmSchedule.ts`, `rhythmSignals.ts`, `rhythmActions.ts`, `rhythmState.ts`, `rhythmRunner.ts`, `rhythmTelegram.ts`. Продуктова логіка відокремлена від транспорту; `telegramAdapter.ts` не став PM-рушієм і не змінювався.
- Жодної БД, event store, event bus, intent router, другого агента чи другої Memory. Жодної нової залежності.
- Rhythm-модулі не імпортують `djonikClient`, `trelloMutationLedger`, `trelloWorkHistory`, не викликають `fetch` і Memory API — це перевіряє тест.
- Розділено чотири походження ходу (`TurnOrigin`): `user_message`, `button_callback` (обидва — Daniel, спільний шлях), `rhythm_ritual`, `rhythm_exception` (автономні, read-only).

## 5. Формат `/rhythm.md` і дефолти

Один `key: value` на рядок; якщо є блок ` ```rhythm `, парситься лише він, інакше весь файл. Проза, заголовки, `#`-коментарі та `<!-- -->` ігноруються; CRLF = LF; `- ` на початку рядка дозволено.

| Ключ | Дефолт | Значення / валідація |
|---|---|---|
| `enabled` | `on` | `on/off` (також `так/ні`, `yes/no`) |
| `timezone` | `Europe/Kyiv` | інваріант: інша зона ігнорується з попередженням |
| `workdays` | `mon-fri` | список або діапазон; `пн-пт` теж |
| `morning` | `09:30` | `HH:MM` у межах 06:00–21:59, або `off` |
| `monday_plan` | `on` (= час `morning`) | `on/off/HH:MM`; `off` → звичайний бриф у понеділок |
| `friday_morning` | `on` | `on/off/HH:MM`; `off` → у пт зранку нічого |
| `friday_review` | `16:30` | `on/off/HH:MM` |
| `evening` | `off` | `on` = 18:30 або `HH:MM` |
| `quiet_hours` | `20:00-09:30` | `HH:MM-HH:MM`, може переходити через північ; нульова довжина — невалідна |
| `exceptions` | `on` | `on/off` |
| `exceptions_per_day` | `1` | ціле; > 2 обрізається до 2 |
| `exceptions_max_per_day` | `2` | ціле; > 2 обрізається до 2; preferred ≤ max |
| `exception_spacing` | `2h` | `2h`/`90m`/`120`, межі 60–480 хв |
| `weekend_exceptions` | `off` | `on` = лише high severity |
| `due_soon_workdays` | `2` | 1–10 |
| `waiting_days` | `5` | 1–60 |
| `stale_project_days` | `10` | 2–90 |
| `in_progress_max` | `3` | 1–20 |
| `mute` | — | повторюваний: `mute: <ціль> [until YYYY-MM-DD]` |

- **Файлу нема** → дефолти (`source: "default"`), без попереджень.
- **Невалідне значення** → дефолт саме цього поля + попередження (зміст-вільне). Парсер ніколи не кидає.
- **Невідомий ключ** → `unknownKeys`, без помилки (forward-compatible).
- **Повтор ключа** → останній виграє + попередження; `mute` повторюється законно.
- Пороги — дефолти конфігурації, не універсальні PM-істини.

## 6. Ритуали

- `monday-plan` (пн) замінює бриф; `morning` (вт–чт та інші не-пн/не-пт робочі дні); `friday-morning` і `friday-review` (пт) — незалежні; `evening` — лише якщо ввімкнено. Неробочий день → нічого.
- Ідентичність occurrence: `<kind>:<Kyiv-дата>` (`monday-plan:2026-09-28`, `morning:2026-09-29`, `friday-review:2026-10-02`); не залежить від процесу чи часу tick-у.
- Статус на `now`: `not_yet` / `due` / `expired`. Grace: 150 хв для ранкових, 120 для огляду, 60 для вечора. Пізній tick у межах grace надсилає **один раз**; після grace — нічого (не надсилаємо «вчорашній» бриф о 14:00). Пізній ритуал не переходить у тиху зону.
- Europe/Kyiv через `Intl` з явною зоною: тести проходять і під `TZ=America/Los_Angeles`; перевірено обидва переходи DST (2026-10-25, 2027-03-28).
- Ритуали — явний розклад Daniel: тиха зона їх не блокує (вона стосується винятків).
- Тихий день: ритуал завжди говорить. Порожня або `SILENT`-відповідь ритуалу — це збій ходу (`failed`), а не мовчазний успіх.

## 7. Сигнали: ritual observation vs interrupt candidate

Ієрархія: **detect → classify → lifecycle / mutes → limits → лише тоді модель**. Детекція ≠ дозвіл писати.

| Сигнал (`kind`) | Канал | Severity |
|---|---|---|
| `due_soon`: due ≤ 2 робочі дні, ще не в роботі | ritual | medium |
| `overdue`: прострочено > 24 год, або картка в Waiting | ritual | medium |
| `waiting_long`: у Waiting ≥ 5 днів (waiting ≠ blocked) | ritual | medium |
| `stale_project`: проєкт high/medium без руху ≥ 10 днів | ritual (огляд) | medium |
| `in_progress_over`: In progress > 3 | ritual | medium |
| `follow_up_due`: прийнята дата перевірки настала | ritual (бриф) | medium |
| `reopened_from_done`: повернено з Done за 7 днів | ritual (огляд) | low |
| `deadline_collision` далі ніж наступний робочий день | ritual | medium |
| `due_tomorrow_not_started`: due на наступний робочий день, картка не почата | **interrupt** | medium |
| `newly_overdue`: due минув < 24 год тому, відкрита, не Waiting | **interrupt** | high |
| `deadline_collision` сьогодні / наступного робочого дня (≥ 2 відкриті не-Waiting картки) | **interrupt** | high / medium |

- «Завтра» = наступний робочий день (у пт це пн).
- `due ≠` автоматично жорстке зобов'язання: interrupt лише для вузьких часових випадків; усе інше — матеріал ритуалу.
- Дата перевірки з #34 (лише дата) **ніколи** не є interrupt — вона для ранкового брифу.
- Факт, уперше побачений **до** сьогоднішнього ритуалу, належав тому ритуалу й interrupt не створює.

## 8. Шум, життєвий цикл, suppression

- Стабільний ключ (`overdue:<card>`, `waiting:<card>`, `collision:<date>`) + fingerprint матеріального факту (due, момент входу в Waiting, набір карток колізії).
- Статуси: `open` → `notified` (виняток доставлено) / `evaluated` (модель сказала SILENT) → `resolved` (факт зник). Незмінний fingerprint → **ні повторної відправки, ні навіть повторного виклику моделі**. Змінений fingerprint або повернення після `resolved` → новий `open` (старий стан не перевикористовується). `resolved` чиститься через 14 днів.
- **Suppression не зберігається як статус** — вона щоразу виводиться з `mute:` у `/rhythm.md`, тож застаріла suppression не може пережити mute, що її спричинив. Цілі mute:
  - точний occurrence `<key>@<fingerprint>` («не нагадуй про це»; змінений факт уже не покритий);
  - ключ (усі майбутні стани);
  - `project:<slug>` («не пінгуй про Limen»);
  - `kind:<kind>` («не пиши мені про waiting»);
  - `until YYYY-MM-DD` — тимчасово, включно.
- **Три різні наміри (рішення Product Owner, final-review pass):**
  1. *жорстке приглушення* — «не нагадуй про це», «про це більше не нагадуй», «не пиши мені про waiting», «не пінгуй про Limen» → відповідний `mute:`;
  2. *тимчасове приглушення* — «пізніше», «до понеділка не нагадуй» → `mute: … until <дата>`, лише з датою, яку Daniel назвав або прийняв (без дати — одне коротке питання з пропозицією);
  3. *м'яке побажання* — «менше пиши про waiting», «менше про Limen», «не треба так часто про це» → **ніколи не `mute:`**. Claude згадує тему рідше (коли щось змінилось або стало суттєвим); стале побажання зберігається як звичайне побажання за Memory-інструкціями. Якщо незрозуміло, чи це «ніколи», — одне коротке питання.
- Детермінований шар підтримує **лише явні mute** і не має ваг / ранжування для «менше» — свідомо, щоб «менше» не перетворилось на «ніколи».
- Сигнали з жорстким або тимчасовим mute прибрано і з підказок для брифу.
- Ліміти (`selectException`): вимкнено / max 0 / виняток у польоті → `none`; жодного кандидата → `none` **без виклику моделі**; досягнуто max → `none`; після preferred-cap — лише **новий** high; неробочий день → `defer` (з `weekend_exceptions: on` — лише high); тиха зона → `defer`; < 2 год від попереднього → `defer`. `defer` не ставить у чергу: факт просто лишається `open` і потрапляє в наступний ритуал. До 3 сигналів групуються в **одне** повідомлення.
- Невизначена (ambiguous) відправка винятку рахується в cap як доставлена.

## 9. Inline-кнопки Telegram

| Повідомлення | Кнопки |
|---|---|
| План тижня (пн) | `✅ Приймаю` · `✏️ Змінити` · `📋 Детальніше` |
| Ранковий бриф | `✅ Ок` · `🔄 Переставити` · `📋 Детальніше` |
| Пт зранку | `✅ Ок` · `🔄 Переставити` |
| Огляд тижня | `✅ Перенести` · `✏️ Змінити` · `⏭ Не зараз` |
| Вечір (вимкнено) | `✅ Перенести` · `⏭ Не зараз` |
| Виняток | `⬆️ Підняти` · `⏰ Пізніше` · `🔕 Не нагадувати` |
| Повідомлення детектора автономного запису | без кнопок |

- Один ряд, ≤ 3 кнопки; набір виводиться з типу повідомлення, **не** з тексту моделі. Claude не може згенерувати callback id.
- Транспорт-нейтральна форма `OutboundMessage { text, actions }`; розмітку Telegram будує лише `toTelegramReplyMarkup`.
- `callback_data` = `rh1:<code>:<ref>` (версіонований; `ref` — 12 hex, випадковий, не з контенту); максимум 25 байт при ліміті 64 — перевірено тестом для всіх дій і найдовшого ref.
- Клік → одна фіксована українська репліка з прив'язкою до повідомлення, напр. `Так, приймаю цей план (план тижня від пн 28.09).`, `Не нагадуй мені більше про це (твоє повідомлення від вт 29.09, 14:10).` Це транспортний UI, а не intent router: далі Claude розмірковує як над набраним текстом.
- Текст проактивного повідомлення обмежено 4096 символами (одне повідомлення, одна клавіатура, один запис доставки).

## 10. Безпека callback

- Лише `TELEGRAM_ALLOWED_USER_ID`; чужий клік ігнорується без жодного ефекту.
- Відхиляються м'яко (alert «Ця кнопка вже неактуальна. Напиши, будь ласка, текстом — так надійніше.»), без ходу і без запису:
  - невідомий префікс / версія / дія, поламаний `ref`, > 64 байт;
  - невідомий `ref` (стан втрачено);
  - запис не в статусі `sent` (напр. ambiguous);
  - `message_id` не збігається;
  - дія, якої не було під цим повідомленням;
  - **інша serving Session** (після рестарту контекст повідомлення втрачено — не вгадуємо);
  - старше 48 год.
- Порядок: клік несе id старішого повідомлення бота, тож усередині вікна групування він відсортувався б **перед** щойно набраним текстом. `enqueueClickAfterPendingText(buffer)` спершу закриває незавершену групу тексту (`flushAll`), тож текст — один хід, клік — наступний, обидва через той самий buffer і FIFO (виправлено у final-review pass; тест падає без виправлення).
- Кнопки одноразові: перевірка і позначка `answered` — в одному серіалізованому `update`, тож подвійний клік не створює двох ходів (другий отримує «Відповідь на це повідомлення вже прийнята…»). Після кліку клавіатура прибирається (best-effort).
- Обробник не має залежностей Trello / Memory / Session: єдиний ефект — `enqueueUserText` у той самий `MessageGroupBuffer`, що й `message:text`. Інтеграційний тест: набраний текст і клік проходять один buffer і FIFO, `maxInFlight = 1`, до Session іде лише text-part, відповіді — лише фінальні.
- Отже клік не обходить #31 (верифікація мутацій), #32 (`end_turn`), #40 (lifecycle custom tool) і звичайне міркування Claude.

## 11. Проактивна доставка та ідемпотентність

Стан — один host-side JSON (`RhythmStateStore`): лише ключі occurrence, статуси, Telegram message id, `ref`, `sessionId`, lifecycle сигналів. **Жодного тексту повідомлень.** Запис: тимчасовий файл поруч → `fsync` → `rename` (атомарно), права 0600. `update(mutate)` серіалізований, тож scheduler і callback не перезаписують зміни одне одного (тест із 10 паралельними оновленнями).

```text
claimed ──відповідь моделі──▶ sending ──Telegram ok──▶ sent
   │                             ├─ відмова API (GrammyError) ─▶ failed, retryable (≤ 2 спроби)
   │                             └─ мережа / невідомо / throw ─▶ ambiguous (термінально, без повтору)
   ├─ помилка ходу ─▶ failed (термінально: хід не перезапускається наосліп)
   ├─ SILENT (лише винятки) ─▶ silent
   └─ автономний запис ─▶ фіксоване повідомлення ─▶ blocked
```

Crash-межі (чесно):
- intent (`claimed`) пишеться **до** виклику моделі; `sending` — **до** виклику Telegram;
- crash між `claimed` і `sending`: нічого видимого не сталося → ритуал повторюється один раз (якщо ще в grace), виняток відкидається (`failed`), бо його факти підуть у наступний ритуал;
- crash після `sending`: повідомлення могло дійти → `ambiguous`, **ніколи** не надсилається повторно;
- пошкоджений або невідомий файл стану → tick нічого не надсилає (втрата стану не перетворюється на дублікати).
- Ідентичність винятку: `exception:<дата>:<sha256 від відсортованих handles>[:12]` — той самий згрупований набір не може бути надісланий двічі.
- Single-flight: tick, що перекривається з іншим, повертає `busy`.
- Tick ніколи не кидає виняток у таймер: неочікувана помилка (напр. збій запису стану посеред спроби) → `error`, без відправки; на диску лишається `claimed` (нічого не надіслано) або `sending` (ніколи не повторюється).
- Для cap і «факт до ритуалу» час доставки = `sentAt`, або `sendStartedAt` для ambiguous, або `createdAt` — **ніколи** `updatedAt`, який переписує recovery (виправлено у final-review pass: раніше ambiguous-виняток учорашнього дня після рестарту рахувався в сьогоднішній cap).
- «Виняток у польоті» враховує лише сьогоднішні записи: запис, що завис учора, не блокує винятки назавжди (виправлено у final-review pass).

Залишковий ризик: вікно між фактичною доставкою Telegram і записом `sent` — у разі crash саме там запис стане `ambiguous` (не дубль, але кнопки такого повідомлення відхилятимуться як неактуальні; текстова відповідь працює).

## 12. Межа feature-off

- `resolveRhythmActivation(env)`: увімкнено **лише** при `DJONIK_WORKING_RHYTHM=on` (точно). Відсутнє, порожнє, `1`, `true`, `ON` → вимкнено.
- Вимкнено → tick не читає config, не пише стан, не викликає модель, не надсилає (тест).
- Додатково: `src/telegramCli.ts` **не змінено** і не імпортує жодного rhythm-модуля; systemd unit не змінено — обидва факти закріплено тестом. Навіть випадковий deploy цієї ревізії не надішле Daniel жодного проактивного повідомлення і не змінить поведінку адаптера (callback-обробник не зареєстровано, `callback_query` поводиться як раніше).
- Вимкнення на рівні Daniel: `enabled: off` у `/rhythm.md` → `config_disabled`, без моделі.
- **Другий, незалежний замок — межа read-only (додано у final-review pass).** `RhythmTickDeps.readOnlyBoundary` обов'язковий: `"pre_execution"` або `"post_hoc_detection_only"`. З будь-яким значенням, крім `pre_execution`, scheduler навіть з `DJONIK_WORKING_RHYTHM=on` не читає config, не пише стан, не викликає модель і нічого не надсилає (`read_only_boundary_missing`). Тест гарантує, що жоден не-тестовий source не декларує `pre_execution`: такого runner-а ще не існує.
- **Інваріант:** Working Rhythm **не можна** активувати в production, доки пізніший bounded етап не встановить справжню pre-execution межу read-only для автономних ходів ритуалів і винятків. Цей інваріант записано в `rhythmConfig.ts` (коментар kill switch), у `rhythmRunner.ts` (`AutonomousReadOnlyBoundary`) і перевіряється тестами.

## 13. Автономна межа read-only

- Prompt кожного автономного ходу (код формує лише інструкцію ходу, не системний prompt): «Хід лише для читання… Не змінюй Trello, Memory чи Calendar, не пиши клієнтам і не приймай нічого за Daniel — будь-яку зміну лише запропонуй». Те саме — у Skill.
- Детермінований детектор `autonomousWriteViolations` над tool uses ходу: будь-який `trelloWrite*`, MCP-інструмент із мутуючим дієсловом (Calendar `create_event` тощо), built-in `write`/`edit` (Memory), будь-який custom tool, крім read-only `trello_work_history`. Порушення → текст моделі **не** доставляється; Daniel отримує фіксоване чесне повідомлення без кнопок; запис `blocked`.
- **Чесне обмеження:** MCP-виклики виконуються на боці провайдера, тож код не може *запобігти* запису до його виконання — лише виявити й не доставити результат. Детекції після факту **недостатньо** як запобігання; саме тому діє замок `readOnlyBoundary` з §12. Справжнє запобігання потребує зміни Agent (напр. `permission_policy: always_ask` для `trelloWriteCard` з відмовою для автономних ходів) — це нова версія Agent / release, поза цим етапом (§17).
- Кнопки не мають детермінованого шляху до Trello; прийняття плану Daniel-кнопкою — це звичайна репліка, і запис у Memory / Trello робить Claude за звичайними правилами.

## 14. Змінені файли

Нові (усі позначено intent-to-add через `git add -N`, тож видимі в звичайному `git diff`; вміст **не** staged, коміту нема):
- `src/rhythmConfig.ts` — формат, парсер, дефолти, `RhythmConfigSource`, activation gate;
- `src/rhythmSchedule.ts` — Kyiv-час, ритуали, grace, тиха зона;
- `src/rhythmSignals.ts` — детекція, класифікація, lifecycle, mutes, ліміти;
- `src/rhythmActions.ts` — дії, набори кнопок, `callback_data`, utterances, розмітка, 4096;
- `src/rhythmState.ts` — durable стан, атомарний серіалізований `update`, recovery;
- `src/rhythmRunner.ts` — tick, prompts, детектор автономних записів, `TurnOrigin`;
- `src/rhythmTelegram.ts` — відправка з клавіатурою, класифікація помилок, callback handler;
- `.claude/skills/pm-rhythm/SKILL.md` — Skill (лише source);
- тести: `src/rhythmConfig.test.ts`, `src/rhythmSchedule.test.ts`, `src/rhythmSignals.test.ts`, `src/rhythmActions.test.ts`, `src/rhythmState.test.ts`, `src/rhythmRunner.test.ts`, `src/rhythmTelegram.test.ts`, `src/pmRhythmSkill.test.ts`;
- цей документ.

Змінені існуючі файли: **жодного**. `docs/02` (NOW), `docs/01`, `managed-agents/*`, `DJONIK_MEMORY_INSTRUCTIONS`, `src/release.ts`, `src/telegramCli.ts`, `src/telegramAdapter.ts`, `src/telegramDispatch.ts`, `src/djonikClient.ts`, `deploy/*` — без змін.

## 15. Тести і точні результати

Node v22.22.2 (локальне середовище реалізатора; production — Node 24).

| Перевірка | Результат |
|---|---|
| Нові focused-тести (8 файлів) | **133/133** pass |
| — `rhythmConfig` / `rhythmSchedule` / `rhythmSignals` | 17 / 14 / 31 |
| — `rhythmActions` / `rhythmState` / `rhythmRunner` | 10 / 8 / 32 |
| — `rhythmTelegram` / `pmRhythmSkill` | 11 / 10 |
| `rhythmSchedule.test.ts` під `TZ=America/Los_Angeles` | 14/14 pass |
| `telegramAdapter` + `telegramDispatch` | **48/48** pass |
| `djonikClient` | **142/142** pass |
| `commitmentContract` | **35/35** pass |
| `release` + `servingRelease` + `releaseAttestation` + `servingLifecycle` | **67/67** pass |
| Лише tracked (наявні до етапу) тести | **680/680** pass (= базова лінія) |
| Повний `npm test` | **813/813** pass |
| `npm run typecheck` | pass |
| `npm run build` | pass (`dist/` у `.gitignore`) |
| `git diff --check` | pass (порожній вивід) |

Покриття вимог завдання: config (відсутній файл, власний час, невалідний час, робочі дні, on/off ритуалів, незалежні пт-ранок і огляд, тиха зона, caps, екстремальні значення, невідомі ключі, інваріант зони); ритуали (пн замість брифу, вт/ср/чт, пт ранок + огляд, вечір вимкнено, вихідні, ідемпотентність occurrence, пізній tick без дублів, DST); сигнали (усі з §7, без повтору, resolved, suppression, групування, cap 1, max 2, другий лише новий high, 2 год, тиха зона, вихідні); кнопки (набори, ≤ 3, ≤ 64 байт, unknown / stale, клік → репліка, нуль Trello, набраний текст без змін, FIFO / single-flight, final-only); доставка (без дублів, success, ambiguous, restart, feature off → ні моделі, ні відправки, адаптер без змін); автономна безпека (детектор, blocked, статична відсутність шляхів до Trello / Session / Memory API).

## 16. Регресії, які перевірено

#31 верифікація мутацій, #32 `end_turn` і provenance specialist, #36 work-history і exact relay, #37 labels / Memory hygiene, #38 final-only і голос, #40 continuation, #34 контракт домовленостей (включно з тестом «runtime не викликає Memory API» — він проходить і для нових файлів), r26 pinning / attestation, FIFO / single-flight, групування, поточний текстовий UX Telegram — усе через незмінні наявні тести (680/680). Жоден наявний файл не змінено, тож семантика r26 / app `d59a532` не зачеплена.

## 17. Обмеження і свідомо відкладене

1. **Читання `/rhythm.md` адаптером — межа, не підключено.** SDK має `client.beta.memoryStores.memories.list/retrieve`, але прийнятий #34 тест прямо забороняє runtime-виклики Memory API (`src/commitmentContract.test.ts`: «the application never reads, writes, parses or caches Memory content itself»). Новий provider-шлях без review я не додавав. Є інтерфейс `RhythmConfigSource.read()`; локальна копія `/rhythm.md` як «канонічна» **не** створювалась. Потрібне рішення Product Lead: (a) дозволити вузький read-only виняток для одного шляху `/rhythm.md` (з read-only доступом і тестом, що інших шляхів нема), або (b) інша межа.
2. **Факти для винятків (`collectFacts`) — межа, не підключено.** Потрібен read-only збирач поточного стану карток і історії Waiting / Done / руху проєкту з Trello REST (можна перевикористати клієнт `trello_work_history` і read-токен) плюс мапінг назв списків у `ListRole` і пріоритети проєктів. Дати перевірки з #34 живуть у Memory; вони за дизайном лише для брифу, тож детермінований шар без них обходиться — бриф читає Memory сам.
3. **Wiring у `telegramCli.ts` відсутній:** таймер tick-у, `runTurn` поверх `session.sendOrdered` з tool uses ходу (зараз `DjonikTurnTelemetry.toolNames` містить лише MCP-назви; для детектора Memory `write`/`edit` потрібен built-in / custom список — мала зміна `djonikClient`, свідомо не зроблена), реєстрація `callback_query:data`, chat id = `TELEGRAM_ALLOWED_USER_ID`.
4. **Шлях до файлу стану і systemd:** unit має `ProtectSystem=strict` («no disk writes»). Для активації потрібен `StateDirectory=` (напр. `/var/lib/djonik`) і змінна шляху; unit не змінено.
5. **Запобігання автономним записам — лише детекція** (§13). Справжня превенція — зміна Agent / release; до неї scheduler заблоковано замком `readOnlyBoundary` (§12), і активація в production заборонена.
6. **Skill `pm-rhythm` не синхронізовано** і не прикріплено до Agent; `/rhythm.md` у production не створювався. Для роботи природного налаштування потрібні sync Skill + нова версія Agent / release (r27).
7. Поведінку моделі source-тести не доводять: якість брифу / огляду / рішень SILENT перевіряє лише авторизована live-валідація і пілот #35.
8. Кнопки live не тестувались (не авторизовано).

## 18. Рекомендований наступний bounded етап #39

**Етап 2 — runtime wiring за kill switch, усе ще без активації в production** (source / offline + один мінімальний review рішення):
1. рішення Product Lead щодо читання `/rhythm.md` (§17.1) і його вузька реалізація `RhythmConfigSource` з тестами;
2. read-only `collectFacts` поверх Trello REST (перевикористання `trello_work_history`-клієнта) з fixture-тестами на реальній формі дошки;
3. `runTurn` поверх serving Session + повний список tool uses ходу (мала, окремо протестована зміна `djonikClient`);
4. wiring у `telegramCli.ts`: таймер (напр. 60 с), `callback_query:data`, graceful shutdown зупиняє таймер; усе за `DJONIK_WORKING_RHYTHM=on`, дефолт вимкнено;
5. systemd `StateDirectory` у source unit;
6. окремо (Етап 3, з авторизацією): **спершу справжня pre-execution межа read-only** для автономних ходів (напр. Agent v27 / r27 з `always_ask` на інструментах запису і відмовою для автономних ходів) — без неї активація в production заборонена (§12); далі sync Skill `pm-rhythm`, створення `/rhythm.md`, одна bounded live-перевірка ритуалу й кнопки, потім пілот #35.

## 19. Final-review pass (після review Product Lead)

Bounded pass: без Stage 2, без розширення scope, лише конкретні дефекти Stage 1.

**1. «Менше» ≠ mute — дефект був.** Skill зіставляв «менше пиши про waiting» з `mute: kind:waiting_long`, а цей звіт (§8) і назва одного тесту повторювали це. Код детермінованого шару «менше» ніяк не кодував (він знає лише явні `mute:`), тож дефект був у Skill і документації. Виправлено:
- Skill: три категорії — жорстке, тимчасове (лише з прийнятою датою), м'яке побажання (**ніколи** не `mute:`);
- `pmRhythmSkill.test.ts`: новий тест на розмежування і на те, що жоден рядок з «менше» не веде до `mute:`;
- `rhythmSignals.test.ts`: тест перейменовано на жорсткий приклад «не пиши мені про waiting»;
- §3 і §8 цього звіту.

**2. Інші конкретні дефекти з self-review (кожен покрито тестом, що падає без виправлення, де це стосується поведінки):**
- *Порядок callback:* клік усередині вікна групування сортувався перед щойно набраним текстом → `enqueueClickAfterPendingText` (§10).
- *Cap після рестарту:* recovery переписує `updatedAt`, а cap брав `sentAt ?? updatedAt` → ambiguous-виняток учорашнього дня рахувався в сьогоднішній cap. Тепер `sendStartedAt` + `deliveredAt()` (§11).
- *«Виняток у польоті» без меж дня:* завислий учорашній запис блокував би всі винятки до рестарту → лише сьогоднішні (§11).
- *Tick міг кинути виняток* при збої запису стану посеред спроби → тепер `error`, fail-closed, без відправки (§11).
- *Необмежений цикл:* `workdaysBetween` ішов по днях до будь-якої дати due (рік 9999 → мільйони ітерацій на tick) → календарна межа `7 × N` перед підрахунком.
- *Межа read-only як замок:* новий обов'язковий `readOnlyBoundary`; без `pre_execution` scheduler нічого не робить. Інваріант активації записано в source і тестах (§12–§13).

**3. Перевірено й залишено без змін:** дубльованої архітектури нема (нема другого агента, Memory, роутера, БД); прихованих записів у Trello / Memory / Calendar нема (rhythm-модулі не імпортують клієнтів Trello / Session, не викликають `fetch` і Memory API, таймерів чи читання env, крім аргументу kill switch, нема); `telegramCli.ts`, адаптер, dispatch, `djonikClient` і `deploy/` не посилаються на rhythm; callback id не контролюється моделлю; `callback_data` ≤ 25 байт; stale / restart callback відхиляються; пошкоджений стан → fail-closed; час — лише через `Intl` з явною Europe/Kyiv, DST покрито тестами.

**4. Артефакт review:** `issue-39-stage1-review.patch` у корені робочого дерева — повний diff Stage 1 (`git diff` після `git add -N`). Він **не** доданий у git / index і не є частиною змін.

## Стан робочого дерева

```text
 A .claude/skills/pm-rhythm/SKILL.md
 A docs/61_ISSUE_39_WORKING_RHYTHM_SOURCE_FOUNDATION.md
 A src/pmRhythmSkill.test.ts
 A src/rhythmActions.test.ts
 A src/rhythmActions.ts
 A src/rhythmConfig.test.ts
 A src/rhythmConfig.ts
 A src/rhythmRunner.test.ts
 A src/rhythmRunner.ts
 A src/rhythmSchedule.test.ts
 A src/rhythmSchedule.ts
 A src/rhythmSignals.test.ts
 A src/rhythmSignals.ts
 A src/rhythmState.test.ts
 A src/rhythmState.ts
 A src/rhythmTelegram.test.ts
 A src/rhythmTelegram.ts
?? issue-39-stage1-review.patch
```

` A` = intent-to-add (`git add -N`): файл видно в `git diff`, але його вміст не staged і не закомічений.

Не зроблено (за інструкцією): commit, push, deploy, SSH, systemd, cron, Scheduled Deployments, `/rhythm.md` у production, sync Skill, оновлення Agent / v27, зміни r26, моделі чи specialist, мутації Trello / Calendar, live Telegram-хід, платний inference, зміна NOW у `docs/02`, закриття #39, нові issue, початок Stage 2.
