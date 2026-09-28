# #44 — аудит топології Project Health: чи потрібен платний A/B

Дата: 2026-09-28.
Canonical NOW: [#44](https://github.com/danielkokr/djonik-manager-2.0/issues/44) ([docs/02](02_DEVELOPMENT_ROADMAP.md)).

Тип: **аудит / дослідження, без реалізації**. Source, Skills, Agent, Memory, Trello, roadmap, issues і host не змінювались. Платних Session, benchmark, commit і push не було.

Мітки джерел:

- **[REPO]** — прочитано в репозиторії.
- **[LIVE]** — виміряно в попередніх авторизованих прогонах.
- **[EXT]** — офіційна документація, прочитана в цьому проході.
- **[EXT-70]** — джерело, прочитане в docs/70 / docs/79 (2026-09-25). Повторно не відкривалось.
- **[EXT-nv]** — публічна документація, у цьому проході не перевірена.
- **[INF]** — висновок.

**Обмеження проходу.** Класифікатор auto-mode неодноразово не давав вердикту для вебзапитів, браузера, `gh` і GitHub MCP.

- Свіжо прочитано лише [Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) і cookbook [Consult an advisor](https://platform.claude.com/cookbook/managed-agents-cma-consult-an-advisor).
- Текст і коментарі #44 напряму не прочитано. Дизайн A/B узято з його джерела: docs/70 §7.2 і рядок roadmap. Це 3 промпти з критерієм «жодної фактичної помилки Waiting / Blocked / date і не довше».
- Рішення спирається лише на [REPO] і [LIVE].

## 1. Executive conclusion

1. **Specialist не має жодної унікальної здатності і бачить менше, ніж coordinator.**
   - Модель та сама: Sonnet 5.
   - Інструменти: 4 Trello-читання, які є і в coordinator.
   - Немає годинника адаптера, `trello_board_snapshot`, `trello_work_history`, focus, commitments, профілів і working style.
   - Його Skill забороняє будь-які relative-дати. Це спадок лікування Haiku.
   - Реальних відмінностей дві. Перша — effort `high` проти `medium` [LIVE docs/49]. Друга — окремий контекст, але при snapshot ~6 KB він нічого не рятує.

2. **У r30 ключові PH-питання структурно краще закриває coordinator.**
   - «Що зависло» потребує `daysInList`, а його дає лише snapshot.
   - «Ризик» потребує знати, що саме під загрозою. Commitments лежать у Memory, яку читає coordinator.

3. **Ціна specialist — в UX і складності, не в токенах.**
   - Live 7 з 7 PH-ходів дали `coordinator_withheld` [LIVE docs/47, 49, 53]. Daniel щоразу бачить службову підказку «напиши окремим повідомленням», навіть на чистому питанні.
   - Змішаний хід показує ярлик «Висновок Project Health (без змін):».
   - Корисну другу відповідь було згенеровано, але приховано (docs/53 S4).
   - PH-хід триває 56–58 с, звичайний — 10–12 с.
   - Навколо specialist ~22 файли provenance-, relay- і attestation-коду та тестів.

4. **Змішаний намір лагодиться лише відсутністю шва.** Agent-as-tool і handoff шов переносять, coordinator-only його прибирає.

5. **Рішення можна ухвалити без платного A/B.** Запропонований A/B слабкий:
   - n = 3 × 1 прогін;
   - змішану гілку визначає код;
   - базова лінія r29 не має snapshot;
   - критерій «не довше» зашумлений службовою підказкою.

6. **Рекомендація.**
   - Прибрати specialist у складі r30.
   - «Проєктний вигляд + що зависло + ризик» віддати coordinator: `planning-and-focus` + snapshot.
   - Advisor не додавати.
   - Переписати #44.
   - Перевіряти звичайною валідацією r30: S9 / S10 / S11 + промпт про ризики.
   - Runtime-код specialist лишити, доки r29 є ціллю rollback.

## 2. Поточна топологія

```text
Telegram / Scheduler ──► адаптер: clock-header (#41), voice (#49), forwarded read-only (#48), reminders (#54), focus (#50)
Coordinator «Джонік» — Sonnet 5 medium [REPO managed-agents/djonik.md]
  prompt: голос, PM-ядро (#42), factual semantics (#45), Waiting/Blocked/Backlog глобально,
          «# Project Health» = транспорт до specialist
  Skills r29: task-management, planning-and-focus, studio-intake, work-review, pm-rhythm
  Tools r29: Trello MCP reads + trelloWriteCard (always_ask), trello_work_history, read/write/edit/glob/grep
  r30 candidate: + trello_board_snapshot, focus_budget, trelloWriteChecklist; − Calendar [REPO release.ts:523]
  Memory: priorities, working-style, projects/<slug>, commitments/, plans/current-week, rhythm
      │ native roster
Project Health Specialist v4 — Sonnet 5 (effort high у live) [REPO, LIVE docs/49]
  Skill project-health (старий skver); tools: read + trelloSearch/ReadBoard/ReadList/ReadCard
  НЕМАЄ: clock, snapshot, work_history, focus, Memory-інструкцій, commitments, профілів, запису
      │ один plain-text результат
Thin client: SpecialistTurnProvenance → composeWithSpecialist
  specialist_only | exact | coordinator_withheld (+ підказка) [REPO turnCorrelation.ts:280–323]
```

- **Serving:** r29. У r30 candidate roster specialist не змінено (`release.ts:532`).
- **Суперечність у r30.** `planning-and-focus` будує project view зі snapshot, але «повний health review» віддає specialist (рядок 61). Prompt так само віддає specialist «risks, blockers, what is stuck». Тобто «що зависло?» йде агентові, який не має даних про дні в списку.
- **Decision trace #46 не записує делегування.** Grep `specialist` / `thread` у `decisionTrace` / `turnTrace` / `pmBenchmark*` нічого не знаходить.

## 3. Чому specialist з'явився

У #28 (docs/01 §9) coordinator працював на **Haiku** і системно помилявся в PH:

- вигадував Waiting;
- рахував weekday / relative-дати;
- сприймав `lastActivityAt` як прогрес;
- перебільшував ризик.

На тому самому Skill Sonnet цих помилок не робив. Specialist дав PH сильнішу модель без переведення на неї всього coordinator.

Далі relay-проблеми породили ланцюжок: exact relay → детермінована межа відповіді → provenance #32 → F3 cue #38.

**Це була ескалація моделі, а не спеціалізація.**

## 4. Що змінилося

| Зміна | Коли | Наслідок |
|---|---|---|
| Haiku → Sonnet 5 medium | #38 | Причина ескалації зникла |
| Factual semantics глобально | #38 / #45 | PH-правила вже в coordinator |
| Clock у кожному ході | #41 | Coordinator безпечно працює з датами; specialist — ні |
| PM-ядро + project view | #42 | «По X що в мене?» уже в coordinator |
| `trello_board_snapshot` | #47 (r30) | «Що зависло» можливе лише в coordinator |
| work_history, focus, профілі, working style, commitments | #36, #50–#52, #34 | Лише в coordinator |

[INF] Розрив з кожним релізом росте на користь coordinator. Виміри часів Haiku не доводять потреби у specialist сьогодні.

## 5. Унікальна здатність specialist

| Вимір | Coordinator (r30) | Specialist v4 | Унікальне? |
|---|---|---|---|
| Модель | Sonnet 5 medium | Sonnet 5 high | **Лише effort** |
| Інструкції | ядро + semantics + Skills | prompt 7.6 KB + Skill 10.8 KB | Ні: дублікат плюс заборони дат часів Haiku |
| Інструменти | надмножина | 4 reads + `read` | Ні |
| Дозволи | read + verified write на запит | read-only | Ні: `always_ask` + #31 |
| Контекст | розмова + Memory + clock | лише делеговане питання | «Чистий», але даних менше |
| Дати | clock + Kyiv due | усе relative заборонено | Мінус |
| Commitments / профілі | так | ні (live Memory не читав) | Мінус |
| Паралелізм / довге розслідування | — | ні (6–8 ітерацій на 1 проєкт) | Ні |

**Спеціалізованих знань немає.** Є дубльовані інструкції в іншому контекстному вікні і вищий effort.

Чистий контекст корисний, коли основний контекст шумний або величезний. Тут snapshot займає ~6.4 KB [docs/84], сесія — ~40–50 K токенів [LIVE #20].

Якщо вищий effort колись знадобиться, дешевше дати effort override на рідкісних ходах або advisor (§7), ніж тримати постійного агента.

## 6. Зовнішнє дослідження

### Anthropic

**Managed Agents multiagent [EXT]:**

- кожен агент працює у своєму thread;
- «Tools, MCP servers, and context are not shared»; спільні лише sandbox, ФС і vault;
- три патерни: parallelization, specialization («domain-focused system prompts and tools»), escalation («more capable agent or model»);
- делегування лише на один рівень;
- документація посилається на «when to use multiagent (and when not to)».

**When to use multi-agent [EXT-70]:**

- multi-agent виправданий для захисту контексту, паралелізму або спеціалізації інструментів;
- коштує 3–10× токенів;
- антипатерн — поділ «за типом роботи»;
- покращений промпт одного агента давав рівний результат.

**Research system [EXT-70].** Orchestrator-worker виграє на широких паралельних дослідженнях і програє на тісно пов'язаних кроках.

**Context engineering / Skills [EXT-70].** Just-in-time контекст, high-signal відповіді інструментів, progressive disclosure без окремого циклу інференсу.

**Advisor [EXT]:**

- один запис у roster, без інструментів;
- **читає всю розмову до виклику**;
- кличе лише primary thread;
- тарифікується за тарифом advisor-моделі; модель має бути не слабшою за основну;
- провал консультації не валить хід;
- політику визначає prompt. У прикладі advisor кличуть лише перед рішеннями, «expensive to reverse».

### OpenAI [EXT-nv]

Agents SDK розрізняє два патерни:

- **agents-as-tools** — manager лишається власником відповіді;
- **handoffs** — відповідає інший агент.

Практичний гайд радить спершу вичерпати можливості одного агента з інструментами.

Для Djonik:

- handoff зробив би власником змішаної відповіді агента, який не може писати. Це гірше, ніж зараз.
- agents-as-tools означає, що синтезує coordinator. Саме ця синтеза live переписувала факти specialist (docs/47 §3). А якщо coordinator синтезує, він може й сам прочитати.

### Приклади

- **Claude Code subagents [EXT-nv].** Subagents — для великого пошуку. Щоденна робота йде в одному агенті.
- **Anthropic Research [EXT-70].** Multi-agent — лише для breadth-first дослідження.
- **Огляд chief-of-staff [EXT-70].** Детерміноване відокремлене від судження. Сильний бриф дає фільтрація, а не флотилія агентів.

| Патерн | Проблема | Чи є в PH Djonik |
|---|---|---|
| Parallelization | багато незалежних джерел | Ні |
| Specialization (tools) | різні інструменти / дозволи | Ні |
| Escalation | сильніша модель | Колись так; зараз ні |
| Context isolation | величезний контекст | Ні |
| Handoff | різні «відділи» | Ні |
| Advisor | рідкісне дороге рішення | Можливо колись; не для PH |
| Evaluator / critic | системні помилки | Не доведено |
| Deterministic tools | факти, які модель погано рахує | **Так — уже зроблено** |

## 7. Advisor

**Кейси:** конфлікт клієнтів, «брати проєкт?», перевантаження, оскарження плану, незворотні рішення.

[INF]

- Ці питання впираються в дані: commitments, weekly time, профілі. Advisor без інструментів бачить лише розмову.
- Вартість росте з довжиною багатоденної Telegram-сесії.
- Для Sonnet 5 advisor має бути класу Opus. Redaction ускладнює аудит.
- Жодного виміряного випадку слабкого стратегічного судження немає.

| | Specialist | Рідкісний advisor | Без другої моделі |
|---|---|---|---|
| Власник відповіді | specialist (шов) | coordinator | coordinator |
| Дані | менше, ніж у coordinator | уся розмова, без інструментів | усі |
| Ризик | шов, затримка | вартість, redaction, зайві виклики | стеля на рідкісних рішеннях |

**Рішення:** зараз без другої моделі. Поріг входу — у §20.

## 8. Skills vs agents vs tools

| Чи потрібні PH… | Відповідь |
|---|---|
| окремі інструменти | ні |
| окремі дозволи | ні |
| паралелізм | ні |
| незалежний контекст | ні |
| інша модель | ні (effort — параметр) |
| великі спеціалізовані знання | ні (~10 правил, уже глобальні) |
| довге розслідування | ні |

Другий агент дає лише окреме контекстне вікно і вищий effort. Натомість додає шов, затримку і код.

Правильні носії:

- **Skill** — розширений project view у `planning-and-focus`;
- **tool** — snapshot;
- **prompt** — глобальна семантика.

## 9. Context engineering

- **Шум створює саме делегування.** Coordinator пише проміжне повідомлення, переказ і власні необґрунтовані факти («через 2 дні», «дедлайн наближається», docs/47 §3). Runtime мусить усе це приховувати.
- **Делегування відрізає корисний контекст:** розмову («Limen для мене важливий»), commitments, годинник, focus.
- **Для «що зависло» snapshot робить specialist повністю зайвим.**
- **PH-відповідь для Daniel — це той самий project view** з акцентом на «що зависло / де ризик». Формат «health report» соло-дизайнеру не потрібен [INF].

## 10. Вартість, затримка, складність

| Вимір | Факт | Оцінка |
|---|---|---|
| $ | Чистий PH: $0.24 (coord 8¢ + spec 15¢; 3 + 6 ітерацій) [docs/49]. PH + друга частина: $0.21 (spec 19¢; 3 + 8 ітерацій) [docs/53]. Coordinator-only на важкому board: $0.21 [docs/46]. Прості ходи: 2–7¢ | Помірно; coordinator + snapshot не виміряно |
| Затримка | 55.7–57.9 с проти 10–12 с | Великий мінус для UX |
| Relay | 7/7 withheld + підказка; `specialist_only` жодного разу | Високий мінус для UX |
| Змішаний намір | ярлик + прихована друга відповідь | Високо |
| Розбіжність | coordinator посилював факти («не видно» → «немає») | Середньо |
| Код | provenance, compose, unverified-помилки, атестація roster; ~22 файли `src/` | Високо |
| Пінування | окремий агент v4 + skver + pin у кожному релізі; Skill уже розійшовся з репо (docs/76) | Середньо |
| PM-цінність | фактично коректно, але довгі абзаци і без дат | Нижча, ніж у coordinator зі snapshot [INF] |

## 11. Змішані наміри — ключовий критерій

**Запит:** «Що по Seqthera і постав дедлайн концепту на понеділок?»

- **Зараз** (`turnCorrelation.ts:313–322`) Daniel отримує `systemReply` + `———` + «Висновок Project Health (без змін):» + текст specialist + `———` + підказку. Природна відповідь coordinator не показується ніколи. Замість одного колеги — три блоки різних «авторів».
- **Змішаний хід без запису** (docs/53 S4). Друга відповідь існує, але прихована, і треба перепитувати. F3 прийнято як менше зло, але корінь проблеми — шов.
- **Agent-as-tool.** Синтезує coordinator, отже підстава для specialist зникає.
- **Handoff.** Власник відповіді не може виконати запис.
- **Coordinator-only.** Один хід, одна відповідь: «Переніс дедлайн концепту на пн, перевірив у Trello. По Seqthera: …». #31 не змінюється.

Specialist ніколи не має відповідати Daniel напряму.

## 12. Benchmark #46 без платних прогонів

| Сценарій | Що вже відомо |
|---|---|
| S4 «Що по концепту Seqthera?» | нейтрально; specialist дат не каже взагалі |
| S9 «Що в мене по Azov?» | уже належить coordinator (#42); specialist не бере участі |
| S10 «Що зависло по Extract?» | `requires: days_in_list` — оцінюваний лише зі snapshot, тобто лише в coordinator |
| S11 змішаний + write | форму відповіді specialist-гілки визначає код |

**Невідомо:** як саме coordinator r30 сформулює S10 / S11 і наскільки відповіді розкидані між прогонами.

**Прогалина:** trace не записує делегування. Без specialist вона зникне сама.

## 13. Критика A/B з #44

1. **n = 3 × 1 прогін.** Сам benchmark вимагає ≥ 2/3 на поведінкові сценарії і pass^3 на фактичні. При n = 3 домінує дисперсія.
2. **Змішану гілку визначає код.**
3. **Критерій «не довше» зашумлений.** Specialist завжди отримує службову підказку і пише абзацами.
4. **Неправильна базова лінія.** «r29 specialist vs r29 coordinator» порівнює конфігурацію, яка не піде в прод. «r29 specialist vs r30 coordinator» змішує архітектуру зі snapshot, focus і Skills.
5. **Вибірка не відповідає питанню.** «По Azov що в мене?» — уже не PH. Промпта про ризики немає.
6. **Хибний висновок можливий в обидва боки.**
7. **Наслідки несиметричні.** Одна перемога specialist не виправдає постійного шва: механізму переваги немає.

## 14. Матриця рішень

| Критерій | 1. Specialist | 2. Coordinator-only | **3. Coordinator + P&F / snapshot** | 4. + рідкісний advisor | 5. Specialist як tool |
|---|---|---|---|---|---|
| PM-якість | середня | добра | **висока** | висока + стеля | середня |
| Заземленість | добра, без дат / commitments | добра | **найкраща** | як 3 | як 1 |
| Змішаний намір | **шов** | без шва | **без шва** | без шва | шов |
| Затримка | ~56–58 с | ~10–20 с [INF] | ~10–20 с [INF] | + рідко | ≈ 1 |
| Токени | вищі | нижчі | нижчі | + рідко дорого | ≈ 1 |
| Ізоляція контексту | є (не потрібна) | — | — | advisor бачить усе | є |
| Реалізація | 0 | мала | **мала** | мала + політика | середня |
| Підтримка / тести | високі | низькі | **низькі** | середні | високі |
| Режими збою | withheld, unverified, пізні / дублікати | «забув про ризик» | те саме, лікується кейсом | зайві виклики, вартість | 1 + синтез |
| Для Daniel | погано | добре | **найкраще** | добре, зараз зайве | погано |

## 15. Цільова топологія

```text
Coordinator «Джонік» (Sonnet 5 medium) — один власник відповіді
  prompt без «# Project Health»
  Skills: task-management · planning-and-focus (project view = стан + що зависло + ризик) · studio-intake · work-review · pm-rhythm
  Tools: trello_board_snapshot · trello_work_history · focus_budget · Trello reads · verified trelloWriteCard
  multiagent: немає · advisor: немає (умови входу — §20)
```

| Намір | Власник | Дані |
|---|---|---|
| «по Azov що в мене?» / «що тут чекає?» | P&F project view | snapshot |
| «що зависло по Extract?» | те саме | snapshot `daysInList` + докази Waiting |
| «які ризики по Seqthera?» | те саме | snapshot + commitments + профіль |
| «що важливіше / що посунути?» | P&F ядро | snapshot + Memory |
| змішаний + дедлайн | один хід: P&F + task-management | snapshot + verified write |
| «кому приділити увагу?» | P&F тиждень | commitments + weekly time |
| «брати ще проєкт?» | coordinator, судження з даних | commitments + weekly time + профілі; advisor — лише за §20 |

## 16. Чи потрібен платний A/B

**Ні.**

- Механізму, через який specialist міркував би краще, немає.
- Змішаний хід визначає код.
- «Чи впорається coordinator» — питання реалізації. Його перевіряє звичайна валідація r30.

## 17. Найменший експеримент (частина валідації r30)

**U1:** чи називає coordinator r30 без specialist ризики і те, що зависло, без вигаданих дат / Waiting / Blocked?

- **Сценарії:** S9, S10, S11 + новий S41 «Які ризики по Seqthera?».
- **Прогони:** за правилами benchmark — факти pass^3, поведінка ≥ 2/3.
- **Бюджет:** docs/04 §27, у межах валідації r30.
- **Оцінка:** абсолютна рубрика #46, без порівняння зі specialist.
- **Якщо провал:**
  - спершу правка `planning-and-focus`;
  - specialist — лише при системному провалі, що вказує на контекст або effort;
  - навіть тоді спершу effort override.

## 18. Source-only план (переписаний #44), у складі r30 candidate

1. **Prompt.** Прибрати `# Project Health`. Додати одне речення: питання про стан, ризики, «що зависло» чи «що чекає» — твої, у формі project view.

2. **`planning-and-focus`.**
   - «Зависло» = `daysInList` + явні докази Waiting. `невідомо` означає невідомо.
   - «Ризик» — лише разом із тим, що саме під загрозою. Due сам по собі ризиком не є.
   - Кілька рядків, без переліку карток.
   - Додати кейс: приклади 1–4 Waiting / Blocked із `project-health`, без заборони дат.
   - Прибрати посилання на specialist.

3. **Release.**
   - r30 roster порожній (`multiagent: null`).
   - `DjonikRelease.specialist` стає nullable.
   - `releasePlan` / `releaseAttestation` атестують відсутність roster.
   - r25–r29 не чіпати.

4. **Runtime — поки не видаляти.**
   - App має вміти обслужити r29 при rollback.
   - Без roster `resolveProjectHealthSpecialistName` повертає `null`, і safeguard вимикається сам (`djonikClient.ts:1155`).
   - Cleanup — окремим issue після зняття rollback-вікна r29.

5. **Тести.**
   - Інвертувати PH-перевірки в `djonikAgentSource.test.ts` (рядки 49–56, 380–408, 497–499).
   - Додати кейс у тести Skills.
   - Додати перевірку, що r30 без roster.

6. **Benchmark.** Додати S41 offline.

7. **Docs.** docs/01 §9 (retired), `managed-agents/README.md`.

8. **Remote — пізніше, з окремою авторизацією.** Не архівувати specialist v4 і не чіпати `project-health` у workspace до зняття rollback-вікна r29.

**Поза скоупом:** advisor, reviewer, нові Skills, зміна моделі / effort, видалення runtime-коду.

## 19. Ризики і rollback

| Ризик | Ймовірність | Пом'якшення |
|---|---|---|
| Пропуск ризику / «що зависло» | низька–середня | кейс у Skill; S10 / S41 |
| Повернення помилок з датами | низька: clock, Kyiv due, #45 | pass^3 |
| Перебільшення ризику | середня | правило «що саме під загрозою» + кейс |
| Регрес губиться серед змін r30 | середня | PH-специфічні сценарії атрибутують регрес |
| Rollback | — | r29 зі specialist v4 і runtime без змін |

## 20. Чого НЕ будувати

- **Advisor «про всяк випадок».** Поріг входу: ≥ 3 стратегічні запити за 2 тижні пілоту, Daniel оцінює відповіді як слабкі, і причина не в даних. Навіть тоді спершу effort override.
- Specialist-as-tool, handoffs, маршрутизатори намірів.
- Critic / reviewer, поки benchmark не покаже системної помилки.
- Health score, health-звіт, health-стан у Memory.
- Нові specialists для intake чи review.
- Research-subagents у щоденному PM. Кандидатом вони стануть лише тоді, коли знадобиться читати великі ТЗ.
- Видалення runtime-коду до зняття rollback-вікна r29.

Решта топології правильна:

- детерміновані інструменти (snapshot, work_history, focus_budget, clock, reminders) лишаються;
- Skills нарізані за діями Daniel;
- один агент — правильна відповідь сьогодні.

## 21. Джерела

**Репозиторій:**

- `managed-agents/djonik.md`, `project-health-specialist.md`, `README.md`;
- Skills `project-health`, `planning-and-focus` (+ grep по всіх);
- `src/release.ts`, `turnCorrelation.ts`, `pmBenchmark.ts`;
- grep: `djonikClient.ts`, `decisionTrace.ts`, `djonikAgentSource.test.ts`;
- docs/01 §9, 02, 47, 49, 53, 70, 76, 79, 83, 84.

Окремо не перечитувались: `AGENTS.md`, docs/00, 03, 17, 21, 04 §27, 85–89. Їхні рішення відображені в docs/02 і r30-джерелі.

**Зовнішні:**

- [EXT 2026-09-28] <https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration>
- [EXT 2026-09-28] <https://platform.claude.com/cookbook/managed-agents-cma-consult-an-advisor>
- [EXT-70] <https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them>
- [EXT-70] <https://www.anthropic.com/engineering/multi-agent-research-system>
- [EXT-70] <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- [EXT-70] <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>
- [EXT-70] <https://zachpan.substack.com/p/after-reviewing-five-agentic-chief>
- [EXT-nv] <https://www.anthropic.com/engineering/building-effective-agents>
- [EXT-nv] <https://openai.github.io/openai-agents-python/multi_agent/>
- [EXT-nv] <https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/>
- [EXT-nv] <https://docs.claude.com/en/docs/claude-code/sub-agents>

[EXT-nv] наведено лише як незалежне порівняння. Перечитати перед фіналізацією #44.

## Handoff

1. **Рекомендація.** Прибрати Project Health specialist у складі r30. Його питання віддати coordinator через розширений project view у `planning-and-focus` + `trello_board_snapshot`. Advisor і інших агентів не додавати.
2. **Впевненість.** Висока щодо топології: унікальної здатності немає, даних менше, шов і затримку виміряно live. Середня щодо якості формулювань ризику в r30 — це перевірить валідація.
3. **Платний A/B: NO.** LATER — S9 / S10 / S11 / S41 у звичайній валідації r30.
4. **Невизначеність:** U1 (§17), абсолютна рубрика #46.
5. **Скоуп #44:** §18. Runtime-код і remote v4 лишаються до зняття rollback-вікна r29.
6. **Переписати #44: так.** Нове формулювання: «Retire the Project Health specialist in r30; validate via the r30 benchmark subset». Звірити з коментарями #44.
7. **Звіт:** `docs/90_ISSUE_44_PROJECT_HEALTH_TOPOLOGY_AUDIT.md`.

## Змінені файли

- `docs/90_ISSUE_44_PROJECT_HEALTH_TOPOLOGY_AUDIT.md` — новий (untracked).
