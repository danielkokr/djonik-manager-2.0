# #42: PM-ядро координатора + `planning-and-focus` (source)

Дата: 2026-09-25. Issue: [#42](https://github.com/danielkokr/djonik-manager-2.0/issues/42). Архітектурний намір: [docs/70](70_DJONIK_PM_DELEGATION_ARCHITECTURE_AUDIT.md) §3, §4, §7. База: #41 ([docs/72](72_ISSUE_41_CLOCK_AND_PROMPT_SOURCE_REPORT.md)), commit `5384395`.

**Статус: локальні зміни source чекають review Product Lead.** Commit, push, deploy не робились. Agent, Skills, Memory, Trello, хост і Telegram не змінювались. Платного inference не було.

## 0. Рішення Product Owner і governance

- #41 прийнято й закомічено, але не розгорнуто. Daniel вирішив зробити **один спільний cutover #41 + #42**. Окремого релізу лише для #41 не буде.
- [docs/02](02_DEVELOPMENT_ROADMAP.md) досі фіксує #39 як canonical NOW. Ні #41, ні #42 там не промотовано. Цю роботу прямо доручив Product Owner. docs/02 я не редагував: синхронізація roadmap іде після прийняття.
- У #42 немає коментарів.

## 1. Яку архітектуру я знайшов

- **Координатор** (3794 B після #41): голос, factual semantics, clock-правило, транспорт PH. **Моделі пріоритету немає.**
- **Судження розмазане** по `daily-planning` (5.6 KB), `weekly-planning` (8.3 KB), `pm-rhythm` і PH. Там є дві явні причини поганої поведінки:
  - due-first драбина: «due dates and how soon» першим пунктом; `recorded due dates → in-progress → explicit priorities → backlog`;
  - «Never silently drop… name it as deferred» і «note on what didn't make today», тобто прямий шлях до board dump.
- **Memory-інструкції** (4048/4096 B UTF-8) уже мають загальне правило «прийнятий план» без фіксованого місця. `pm-rhythm` пише прийнятий план понеділка «following the Memory instructions for accepted plans». Отже, місце плану має визначати саме Memory-контракт.
- **Реліз:** serving r27. `RELEASE_R28_CANDIDATE` був r27 + лише prompt (#41). До нього був prompt-only `buildSystemUpdateBody`.
- **Frontmatter `djonik.md`** декларує Skills serving-релізу (r27), а body — prompt кандидата. Прецедент #41.
- **Project Health specialist** (v4) має власний закріплений `project-health` Skill. У ньому досі є «hand off to daily-planning or weekly-planning».

## 2. Рішення і що я змінив відносно пропозиції

| Пропозиція docs/70 / #42 | Що зроблено | Чому |
|---|---|---|
| Ядро в координаторі, ціль «~4 KB разом» | Ядро в координаторі, **5499 B** | 4 KB недосяжні: після #41 prompt уже 3794 B. Ядро — ~1.65 KB, але воно потрібне в **кожному** ході, включно з ходами ритму. У Skill, який модель може не завантажити, воно не працює. Редакційний поріг тесту піднято 3800 → 5500 з обґрунтуванням |
| 2–3 приклади відповідей у координаторі | **Не додано.** Приклади — у Skill | Приклад відповіді в system prompt Sonnet 5 копіює як шаблон, а робить це в кожному ході. У Skill приклади вантажаться лише тоді, коли потрібне саме це рішення |
| `planning-and-focus` + окремий `examples.md` | **Один файл** `SKILL.md` з 7 кейсами | Кейси — це і є навчання судженню. Окремий файл означав би ще одне рішення «чи читати», яке модель може пропустити, а також multi-file sync. Файл 7.6 KB проти 13.9 KB у двох старих |
| Кейси «ситуація → відповідь» | **«Ситуація → рішення (чому)», без готових реплік** | Кейси вчать рішення, а не фрази. Тест забороняє в кейсі цитовану відповідь-шаблон |
| Waiting / Blocked / Backlog підняти в координатор | Waiting/Blocked там уже були. Додано **одне речення про Backlog** | Єдине значення для всіх Skills і ритму. Процедура планування навколо backlog лишилась у Skill |
| `/working-style.md`, `/plans/current-week.md` | Обидва, **у Memory-інструкціях**, а не в Skill чи prompt | Memory-контракт уже володіє розкладкою (`commitments/`). `pm-rhythm` без змін посилається саме на нього. Отже, прийняття плану понеділка кнопкою автоматично пише у фіксоване місце без правки #39 |
| «По X що в мене?» → planning | Так. У рядок PH координатора додано явну межу | Інакше фраза має двох власників. Межа: health review (стан, ризики, блокери, що зависло) → specialist; «що мені робити по проєкту» → planning. Саму відставку specialist вирішує #44 |
| r28 = r27 + prompt (#41) | r28 = r27 + prompt (#41 + #42) + **заміна Skills** | Одна спільна cutover-зміна за рішенням PO |

## 3. PM-ядро координатора

Новий розділ `# Deciding what matters` між «How you act» і «Factual semantics», плюс три точкові правки. Усього чотири зміни, перелічені дослівно в `ISSUE_42_PROMPT_EDITS`:

1. **Хто Daniel.** «Daniel is a designer running several client projects at once; he delegates the PM work to you so his attention stays on design.»
2. **Ядро (позитивне, з «чому»):**
   - коли Daniel питає «що далі / сьогодні / тиждень» або ритму потрібен фокус — **обирай за нього**;
   - Trello дає факти, пріоритет — твоє судження; добра відповідь дозволяє більшій частині дошки зникнути з його уваги;
   - сигнали зважуються разом, **без score і без фіксованого порядку**:
     - його слова на зараз переважають будь-який виведений план; лише реальне зобов'язання, яке ламається сьогодні, їх перекриває, і тоді конфлікт називається одним рядком;
     - прийняті зобов'язання й реальні зовнішні обов'язки; `due` — це evidence, часто його власна мітка, а не терміновість;
     - фініш перед стартом, особливо біля «показати / відправити / передати»; кожен зайвий відкритий проєкт — це перемикання контексту;
     - «передати м'яч»: відправити на фідбек, одне питання клієнту;
     - прийнятий план тижня і пріоритети проєктів у Memory; реалістичне «влазить».
   - **Форма:** 1 головне з причиною → до 2 другорядних → одне речення «решта почекає» → максимум один ризик; деталі на запит. Питати, лише якщо відповідь змінить головне, інакше назвати припущення.
3. **Backlog:** «`Backlog` is a queue: not started is not Waiting, Blocked or at risk.»
4. **Межа PH:** health review → specialist; «по X що в мене?» → focus planning.

Правила verified write (#31), commitments (#34), clock (#41), voice (#38) і exact relay PH не змінено. Жоден наявний тест інваріантів не послаблено, крім двох свідомих змін: дозволено `Backlog` у глобальній семантиці і піднято поріг розміру.

## 4. Структура `planning-and-focus`

`.claude/skills/planning-and-focus/SKILL.md` — 7577 B, SHA-256 `0efaf7d2…b628` (робоча копія, LF).

- **description (trigger):** «що далі?», «з чого почати?», «що мені сьогодні робити?», «що цього тижня?», «як розкласти тиждень?», «що горить?», «що можна перенести?», «3 години тільки Seqthera», «сьогодні Extract не чіпаю», «по Azov що в мене?», корекції плану. Горизонт — «година, день або тиждень». Прямо сказано: рекомендація фокусу не змінює Trello.
- **Evidence:**
  - свіжий Trello перед кожним планом, rebuild чи корекцією;
  - з Memory — лише рамка: `plans/current-week.md` (план іншого тижня — минулий контекст), `priorities.md`, `working-style.md`, бриф проєкту / `commitments/`, коли вони в грі;
  - дата й день тижня — з рядка годинника #41;
  - Trello, Memory і судження розрізняються.
- **Decide:** ті самі сигнали, що в ядрі, з деталізацією:
  - фокус-блок і виключений проєкт;
  - commitment ≠ due, з правилом «назви припущення, питай лише коли помилка дорога»;
  - «in progress» = список або картка, а не `lastActivityAt`;
  - soft WIP 2–3, 1–2 проєкти на день;
  - pass the ball;
  - рамка тижня;
  - fit: один глибокий блок, адмін пачкою, без вигаданих годин;
  - Waiting / Backlog.
- **Answer:**
  - форма 1 / ≤2 / «решта почекає» / ≤1 ризик;
  - **не перелічувати відкладене** — називати його лише тоді, коли Daniel очікував би цю річ саме зараз;
  - «що горить?» — лише справжнє, або «нічого»;
  - тиждень — до 3 результатів, без сітки по днях;
  - project view: в роботі / наступний крок / чекає / один ризик; повний health review — specialist.
- **Plans, corrections and Trello:**
  - план ≠ мутація;
  - явна зміна картки → task-management і verified write;
  - корекція редагує той самий план;
  - прийнятий план тижня пишеться лише після явного прийняття; фокус дня не зберігається.
- **Cases (7):**
  1. внутрішній due проти реального зобов'язання;
  2. майже готове проти нового проєкту;
  3. «передати м'яч»;
  4. фокус-блок;
  5. виключений проєкт із реальним конфліктом;
  6. перевантажений тиждень;
  7. project view.

## 5. Що сталося з daily/weekly

- `.claude/skills/daily-planning/` і `.claude/skills/weekly-planning/` **видалено з репо** (git history зберігає текст).
- Їхні віддалені версії (`skver_01EL7d3f…`, `skver_01Fdtnnk…`) лишаються незмінними на провайдері для serving r27 і його rollback.
- Тест hash-lockstep для них замінено перевіркою: у r27 вони закріплені явно, а їхнього source у репо немає. Отже, жоден файл не може тихо розійтися з закріпленою версією чи бути помилково пересинхронізований як старий Skill.
- Корисні гарантії не загубились:

| Стара гарантія | Нове місце |
|---|---|
| свіжий Trello перед планом / rebuild | Skill «Evidence» |
| план ≠ мутація Trello, «постав нижче» / «не сьогодні» | Skill «Plans…» |
| корекції в тому самому плані | Skill «Plans…» |
| Waiting ≠ Blocked, activity ≠ робота, due ≠ commitment / capacity | координатор (глобально) + Skill (in progress ≠ `lastActivityAt`, commitment ≠ due) |
| не вигадувати години / capacity | Skill «Fit» |
| перевантаження → запропонувати підмножину | Skill «Week» + кейс 6 |

Прибрано свідомо: due-first ранжування, обов'язковий перелік відкладеного, розкладку по днях за замовчуванням.

## 6. Memory-контракт

`DJONIK_MEMORY_INSTRUCTIONS`: **4017 B UTF-8 / 3964 символи** (див. §14) (ліміт 4096; було 4048 B).

Новий абзац перед `commitments/`:

> Fixed places: working-style.md is how Daniel works, only as he states or accepts it, never inferred. plans/current-week.md is the one accepted week plan: week: <its Monday, from the clock line>, up to 3 outcomes with project and why, what he chose to drop. A newly accepted week plan replaces it; an accepted change edits it. No day plans, no card state. Another week's plan is not this week's frame.

**Життєвий цикл плану тижня:**
- пишеться лише при явному прийнятті: кнопка «✅ Приймаю» плану понеділка або «так, працюємо так» у розмові;
- наступне прийняття **перезаписує** файл;
- прийнята зміна посеред тижня **редагує** його;
- маркер `week:` робить план іншого тижня явно застарілим;
- жодних полів картки.

**Місце для байтів.** Щоб його звільнити, стиснуто лише перший (#13) абзац. Кожне речення, яке пінять тести #13/#34, збережено дослівно. Прибрано:
- дві ілюстративні кириличні цитати (приклади прийняття лишились у правилі `Accept:` #34);
- повтор «Do not write every suggestion…».

Секцію `commitments/` (#34) не змінено жодним байтом.

**Запас 79 B UTF-8 / 132 символи** (після §14; перший варіант мав лише 5 B).

**Не зроблено:** жодного запису в Memory (файли `working-style.md` і `plans/current-week.md` з'являться природно, коли Daniel прийме план або назве патерн), жодної БД чи стану в коді.

## 7. Інтеграція з #41

- Рядок годинника — єдине джерело дати в Skill («come from the clock line; do not compute them»). Тест забороняє в Skill дату-арифметику.
- Маркер тижня в Memory береться «from the clock line». Прийняття плану — завжди хід Daniel (кнопка = human authority), тож header у ньому є.
- `ISSUE_41_PROMPT_EDITS` не змінено. Тест доводить: SHA(prompt − #42) = `8469c4e0…813c`, тобто рівно прийнятий #41-кандидат; SHA(prompt − #42 − #41) = r27. Отже, #41 не послаблено і не продубльовано.
- `turnClock.ts`, `djonikClient` header path і тести #41 не змінювались. 20/20 у `turnClock.test.ts`.

## 8. Стратегія release-кандидата

`RELEASE_R28_CANDIDATE` = r27 + рівно дві зміни:

1. `systemSha256` = `c85e7e621af71f78890ddfe7c270ce737ce83d58e58d5543d1ea7be17964e7da` (#41 + #42);
2. Skills: `task-management`, **`planning-and-focus` (unresolved)**, `studio-intake`, `work-review`, `pm-rhythm`. `planning-and-focus` стоїть на місці `daily-planning`; `RETIRED_BY_R28 = ["daily-planning", "weekly-planning"]`.

Модель, specialist v4, tools, permission policies, MCP і Session resources — як у r27. `version: null`; кандидата немає в `RELEASES`, і його не можна serve-ити.

**Тіло оновлення.** `buildSystemUpdateBody` (prompt-only) **видалено**: з новим кандидатом він дозволив би надіслати prompt, який посилається на Skill, якого в Agent немає. Натомість `buildCandidateUpdateBody(candidate, resolution, system?)`:
- завжди шле `skills` і `tools`;
- шле `system` **тоді й лише тоді**, коли prompt кандидата відрізняється від prompt версії, з якої йде оновлення;
- відмовляє, якщо prompt не передано, передано зайвий або його SHA не збігається;
- відмовляє при unresolved Skill.

Для r27 поведінка не змінилась: `releaseR27*.test.ts` проходять.

Frontmatter `djonik.md` свідомо лишається r27: у `planning-and-focus` ще немає remote id. Після cutover lockstep повертається до однієї рівності.

## 9. Змінені файли

| Файл | Зміна |
|---|---|
| `.claude/skills/planning-and-focus/SKILL.md` (новий) | єдиний власник планування / фокусу |
| `.claude/skills/daily-planning/SKILL.md` | видалено |
| `.claude/skills/weekly-planning/SKILL.md` | видалено |
| `managed-agents/djonik.md` | 4 правки prompt (§3); frontmatter без змін |
| `src/djonikClient.ts` | `DJONIK_MEMORY_INSTRUCTIONS`: fixed places + стиснутий #13-абзац; doc-коментар |
| `src/release.ts` | `RETIRED_BY_R28`; `RELEASE_R28_CANDIDATE` = #41 + #42 |
| `src/releasePlan.ts` | `buildCandidateUpdateBody(…, system?)`; `buildSystemUpdateBody` видалено |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_42_PROMPT_EDITS`, `PRE_42_SYSTEM_PROMPT`, спільний `revertEdits` |
| `src/releaseR28Candidate.test.ts` | переписано під спільний кандидат (7 тестів) |
| `src/release.test.ts` | hash-тест для retired Skills; коментар lockstep |
| `src/djonikAgentSource.test.ts` | список Skills; Backlog; поріг 5500; 7 тестів PM-ядра й межі PH |
| `src/commitmentContract.test.ts` | дві cross-cutting перевірки переведено на `planning-and-focus` |
| `src/skills.test.ts` | прибрано тести daily/weekly; коментар про незмінний Skill specialist |
| `src/planningAndFocus.test.ts` (новий) | 26 тестів Skill і Memory-контракту |
| `docs/73_…` | цей звіт |

## 10. Тести і результати

Що доводять нові й змінені тести:

- **daily / weekly поза наступним релізом:** їх немає в r28 ні за іменем, ні за skill id; немає в тілі оновлення; немає в репо; r27 їх досі закріплює.
- **`planning-and-focus` — єдиний власник:** рівно один запис у кандидаті. Жоден інший Skill координатора не претендує на фрази планування й не посилається на retired Skills.
- **due-first прибрано:** перший сигнал — слова Daniel, а не due. Регулярки забороняють `due → / due first / how soon` у prompt і Skill. **Негативна перевірка:** ці самі регулярки спрацьовують на старих daily / weekly з git.
- **Концепти ядра:** делегування, факти ≠ судження, слова зараз, commitment ≠ due, фініш, перемикання контексту, «м'яч», рамка тижня, fit, форма відповіді, «питати лише якщо змінює головне», ритм.
- **Без формули:** немає score / weights / points / відсотків, є явне «no score or fixed order».
- **Board dump прибрано:** немає «Never silently drop / name it as deferred / what didn't make», немає сітки по днях.
- **Memory:** фіксовані місця; життєвий цикл; «No day plans, no card state»; fresh reads переважають; дати за правилами #34; Skill, Memory і незмінний `pm-rhythm` вказують на те саме місце; координатор не дублює розкладку.
- **#41:** точний реверс prompt до SHA #41-кандидата і r27; Skill без дата-арифметики.
- **Lockstep:** кандидат = r27 плюс рівно дві зміни; тіло не можна зібрати наполовину; атестація r27 ↔ r28 не взаємозамінна.

| Перевірка | Результат |
|---|---|
| `planningAndFocus` + `skills` + `djonikAgentSource` + `commitmentContract` + `release*` + `servingRelease` + `servingLifecycle` + `turnClock` + `pmRhythmSkill` + `workReviewContract` + `managedAgentConfig` | **358/358** |
| runtime: `djonikClient`, `turnTrace`, `turnCompletion`, `turnCorrelation`, `toolConfirmation*`, `telegramDispatch`, `messageGrouping`, `customToolResolution`, `trelloMutationLedger`, `trelloWorkHistory` (#23, #31, #32, #36, #40) | **400/400** |
| `src/rhythm*.test.ts` (#39) | **182/182** |
| `npm test` | **1030/1032** (після §14). 2 помилки — відомий Windows-baseline з docs/71 і docs/72: «deploy script survives replacing itself…» і «a real process that fetched over keep-alive exits…». Ці файли не змінювались |
| `npm run typecheck` | OK |
| `git diff --check` | OK (лише CRLF-попередження `core.autocrlf`) |

Source-тести не доводять поведінку моделі.

## 11. Обмеження і що свідомо відкладено

**#43:**
- `task-management` у description досі має тригер «prioritizing, or discussing a task». На «що далі?» можуть завантажитись обидва Skills. Логічного конфлікту немає (TM каже «порада ≠ мутація»), але це зайві токени. Звуження trigger — у rewrite `task-operations`.
- `pm-rhythm` Monday: «each with the one reason it is there (deadline, accepted commitment, priority)» — залишковий due-ухил у форматі ритуалу. Ядро координатора вже діє і в ходах ритму. Полегшення `pm-rhythm` («судження → planning-and-focus») — у #43.
- Статус-звіти («я доробив Barbers») → дія: план каже «що далі», але саму зміну картки не пропонує автоматично.

**#44:**
- Закріплений `project-health` Skill specialist v4 досі пише «hand off to daily-planning or weekly-planning». Specialist не вантажить Skills координатора, тож це мертвий текст, а не маршрут. Правка потребує нової версії specialist і roster, тобто рішення #44.
- Межа PH: «що по X / чи є ризики / що зависло» → specialist; «по X що в мене?» → planning. A/B і відставка specialist — у #44.

**Інше:**
- Memory-інструкції мають запас 79 B (§14).
- Автономні ходи ритму несуть `kyivLabel` без року; маркер тижня пишеться в хід Daniel (з header), тому це не заважає.
- `managed-agents/README.md`, docs/01 §7 (приклад дерева Skills) і docs/02 не оновлювались. Це синхронізація після прийняття.

## 12. Що потребує авторизації Product Owner

1. Review Product Lead → прийняття → ручний commit/push.
2. **Sync Skill:** `skills.create` для `planning-and-focus` з закоміченого blob (`git show HEAD:…`, LF). Потім download і побайтне порівняння (прецедент docs/42, docs/64). Далі записати реальні `skill_…` / `skver_…` / `sessionVersion`.
3. **Agent v28:** `agents.update(agent_01WGRHDBjQa3eMhoGJMmQ1dh, buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, {skills: {"planning-and-focus": …}}, <тіло djonik.md>))` з precondition `version: 27`. Потім:
   - read-back;
   - `resolveReleaseCandidate` → `RELEASE_R28`;
   - frontmatter `djonik.md` → r28;
   - `release:check r28`;
   - `SERVING_RELEASE = RELEASE_R28`;
   - lockstep назад до однієї рівності.
4. Deploy на хост (docs/52 §3). Memory-інструкції й clock header їдуть з app.
5. Live-перевірка за docs/04 §27: одна обмежена Session, 6 фраз з docs/70 §7.4 + запит дати (#41). Критерії PASS з #42:
   - головне не обрано лише за due;
   - ≤ ~6 рядків;
   - без інвентаризації;
   - ≤ 1 питання;
   - нуль записів;
   - без factual slip.
6. Синхронізація docs/02, #41, #42 після прийняття.

## 13. `git status --short` (після §14)

```
 D .claude/skills/daily-planning/SKILL.md
 D .claude/skills/weekly-planning/SKILL.md
 M managed-agents/djonik.md
 M src/commitmentContract.test.ts
 M src/djonikAgentSource.test.ts
 M src/djonikClient.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseCheck.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releasePlan.ts
 M src/releaseR28Candidate.test.ts
 M src/skills.test.ts
?? .claude/skills/planning-and-focus/
?? docs/73_ISSUE_42_PM_JUDGEMENT_CORE_SOURCE_REPORT.md
?? src/planningAndFocus.test.ts
```

## 14. Фінальний correctness pass (зауваження Product Lead)

### 14.1 Явна інструкція Daniel проти PM-судження

**Вердикт: у координаторі був дефект, виправлено.** Було: «only a real obligation that breaks today **overrides them**». Це дозволяло Djonik підмінити «сьогодні Extract не чіпаю» власним планом. Контракт (docs/00 §3) каже, що поточна явна інструкція має найвищий пріоритет.

Стало:

> His words for now (…) outrank any inferred plan and your own preference. If they break a real obligation, still follow them and name the concrete consequence in one line, so skipping it is his conscious choice.

У Skill цю межу вже тримало формулювання «a conflict for him to decide». Тепер вона явна:
- «The plan still follows his words; changing them is his call, however strongly you recommend it.»
- Кейс 5 — «Extract stays out of the plan… Daniel decides».

Рекомендувати й попереджати сильно — можна. Мовчки переграти Daniel — ні.

Тести (обидва файли) перевіряють, що:
- слова Daniel — перший сигнал;
- конфлікт подається як наслідок;
- рішення лишається за ним;
- ніде немає «override(s) them / his words» чи «ignore / disregard his instruction».

Стару формулу тест ловить.

«Week frame … override them» у Skill стосується лише плану тижня, не слів Daniel. Лишено.

### 14.2 Запас Memory-інструкцій

**Мірило.** SDK: «Max 4096 chars» без уточнення одиниці. Контракт репо (docs/56) тому перевіряє всі три мірки: UTF-16, code points і UTF-8 байти. Обмежує UTF-8, бо кирилиця займає 2 B. 5 B запасу — це одне українське слово до падіння створення Session на старті serving. **Надто крихко.**

**Стиснуто лише #13-абзац** (commitments #34 і #42-абзац не змінено):
- прибрано «Persistent PM memory across sessions.» — це вже каже опис store;
- прибрано повтор «explicitly» (наступне речення вимагає явного прийняття);
- «Accepted plans and commitments are decision context» → «Memory is decision context». Формулювання ширше, не слабше.

**Підсумок:** 4091 → **4017 B UTF-8 / 3964 символи**. Запас 79 B / 132 символи, більший, ніж при прийнятті #34 (48 B). Семантика #13, #34 і #42 незмінна; їхні тести проходять.

### 14.3 Інші знахідки

1. **Часткове застосування релізу через CLI — виправлено.** `release:check -- <id> --plan --from <v>` друкував тіло лише зі Skills і tools. Для resolved r28 з v27 це створило б Agent з новими Skills і старим prompt. Атестація відмовила б, але хибна версія Agent уже існувала б.

   Тепер `buildReleaseUpdateBody` відмовляє, коли prompt релізу відрізняється від prompt версії `--from`, і відсилає до `buildCandidateUpdateBody` з `system`. CLI друкує зрозумілу помилку. Переходи з тим самим prompt (r26 ← 25, r27 ← 26, rollback r25 ← 26) працюють як раніше.

2. **Крихкі тести — виправлено.** Мої тести PM-ядра і Skill пінили цілі речення, хоча `djonikAgentSource.test.ts` прямо обіцяє «not snapshot prose». Їх переписано на концепти й межі: знайти bullet за поняттям і перевірити, що в ньому є потрібні ідеї. Структурні guard-и лишились: due-first, board dump, формула, ownership, lockstep. Буквальні лишились лише там, де текст і є контрактом: тригер-фрази, пінені речення #13/#34.

3. **Розмір prompt.** Щоб не піднімати евристику, скорочено рядок «who»: «…client projects at once» → «…client projects». Підсумок 5499 B ≤ 5500 — впритул. Це редакційна евристика, а не ліміт провайдера. Наступна правка prompt свідомо викличе review.

4. **Інших матеріальних проблем не знайдено.** Перевірено:
   - координатор і Skill не суперечать один одному (форма, due, Waiting / Backlog, межа PH);
   - межа з PH до #44 однакова в обох;
   - #31, #34, #36, #39 і #41 не послаблено (їхні тести проходять; реверс prompt дає рівно SHA #41-кандидата);
   - кандидат r28 не можна застосувати частково ні через `buildCandidateUpdateBody`, ні через CLI.

### 14.4 Змінені в цьому проході файли

- `managed-agents/djonik.md` — precedence, коротший рядок «who»;
- `.claude/skills/planning-and-focus/SKILL.md` — precedence і кейс 5;
- `src/djonikClient.ts` — Memory;
- `src/release.ts` — SHA кандидата `c85e7e62…`;
- `src/releasePlan.ts` і `src/releaseCheck.ts` — guard `--plan`;
- `src/releaseFixtures.test-helpers.ts` — рядок «who»;
- тести: `djonikAgentSource`, `planningAndFocus`, `releaseR28Candidate` (+1 тест).

### 14.5 Перевірки

| Перевірка | Результат |
|---|---|
| `planningAndFocus` + `djonikAgentSource` + `commitmentContract` + `skills` + `release*` | OK (28/28 Skill і Memory; 8/8 r28) |
| `npm test` | **1030/1032**. Ті самі 2 Windows-baseline помилки (`deployConfig`, `processExit`), файли не змінювались |
| `npm run typecheck` | OK |
| `git diff --check` | OK (лише CRLF-попередження) |

**Готовність:** source #42 готовий до прийняття Product Lead.
