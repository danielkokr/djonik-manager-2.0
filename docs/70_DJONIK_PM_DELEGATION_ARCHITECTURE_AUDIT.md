# Djonik — аудит архітектури делегування PM-рутини

> **Статус 2026-09-25:** на запит Product Owner створено issues [#41](https://github.com/danielkokr/djonik-manager-2.0/issues/41) (годинник + prompt), [#42](https://github.com/danielkokr/djonik-manager-2.0/issues/42) (PM-ядро + `planning-and-focus`), [#43](https://github.com/danielkokr/djonik-manager-2.0/issues/43) (`task-operations`, метадані картки, легший `pm-rhythm`) і [#44](https://github.com/danielkokr/djonik-manager-2.0/issues/44) (A/B і retire Project Health specialist). Порядок зафіксовано в docs/02; #39 лишається NOW. Крок §9.5 (`trello_board_snapshot`) — кандидат без issue.

Дата: 2026-09-25 (пт). Тип: **незалежний Product/Agent Architecture audit, без реалізації**. Не змінено Agent, Skills, Memory, Trello, Hetzner, release чи roadmap. Не робилось платних Session, commit і push.

Мітки: **[REPO]** — прочитано в репозиторії, **[EXT]** — зовнішнє джерело (§8), **[INF]** — мій висновок.

Прочитано повністю: `managed-agents/djonik.md`, `managed-agents/project-health-specialist.md`, `managed-agents/README.md`, усі 7 `.claude/skills/*/SKILL.md`, `DJONIK_MEMORY_INSTRUCTIONS` і побудову user-turn у `src/djonikClient.ts`, prompt-и ритму в `src/rhythmRunner.ts`, docs/00, 03, 25, AGENTS.md. Вибірково: docs/01 §6–§10, 02 (NOW і рішення #38), 33 (Memory-дерево), 40, 45 §1 і §10–§12, 56 §3–§11, 69.

Не прочитано: живий вміст Memory store. Production-читання заблоковане класифікатором (docs/69 §1). Про вміст `/priorities.md` і `/projects/*` сужу за docs/25 і docs/33.

---

# 1. Executive conclusion

1. **Головна проблема не в кількості Skills, а в тому, що в Djonik немає власної моделі PM-судження.** Приблизно 11 300 слів активних інструкцій (prompt, specialist, 7 Skills) майже цілком описують, **чого не робити з фактами і записами**: ~320 заперечень «never / do not / not». Модель пріоритету займає ~6 рядків у `daily-planning`, і першим пунктом там стоїть `due dates and how soon they are`. У `weekly-planning` порядок прямо записаний як `recorded due dates → in-progress → explicit priorities → backlog` [REPO]. Тому due-bias — це не «помилка моделі», а виконання інструкції.
2. **Verbosity і board dump теж частково закладені в інструкціях.** «Never silently drop work from the plan without naming it as deferred», «a brief note on what didn't make today and why», «important waiting items, named» змушують Sonnet 5, який виконує інструкції буквально [EXT], перелічувати відкладене. Звідси «8 фактів з дошки» замість «головне / друге / решту ігноруй».
3. **Factual slips мають конкретну архітектурну причину.** У звичайний хід Daniel **не передається поточна дата**: адаптер шле лише текст (`buildContentBlocks`, `send`), а дату й день тижня отримують тільки ходи ритму (`kyivLabel`) [REPO]. Prompt забороняє рахувати weekday самому, але для звичайного ходу форматера немає. Модель лишається без джерела і вгадує. Помилка «25.09.2026 — субота» — очікуваний наслідок.
4. **Архітектура нарізана за горизонтом часу (день / тиждень / ритм / health / review), а не за рішенням.** Одне й те саме PM-судження («що зараз важливо») живе в чотирьох місцях зі своїми правилами, що розходяться. Реальні фрази Daniel («що далі?», «я доробив Barbers», «що горить?», «3 години тільки Seqthera») не мають Skill-власника. Coordinator відповідає на них без моделі пріоритету або вантажить `task-management` (14.8 KB правил запису), і це тягне в обережність.
5. **Coordinator prompt застарів і суперечить продукту.** Там досі написано «You do not message him first, run a schedule or track his commitments automatically», хоча Working Rhythm і commitments уже активні [REPO]. Третина prompt — транспорт Project Health.
6. **Project Health specialist більше не має виміряного обґрунтування.** Його ввели, бо Haiku-coordinator помилявся (docs/01 §9). Тепер coordinator — той самий Sonnet 5. Specialist коштує окремого контексту, relay-машинерії (`composeWithSpecialist`, `coordinator_withheld`) і ламає змішані запити та природне «по Azov що в мене?».
7. **Цільова архітектура:** один сильний coordinator із явним PM-ядром — пріоритет, фокус, фініш перед стартом, commitment ≠ due, «мовчати — нормально». Далі **4 Skills замість 6+1**, без specialist; детермінований «годинник» у кожному ході; пізніше — компактний read-tool дошки з готовими датами. Trello дає факти, Memory — прийняті рішення, Djonik — судження.
8. **Robustness-частину не чіпати:** verified writes (#31), labels (#37), permission boundary (#39), exact relay work-history (#36), commitments у Memory (#34), ритм і його ліміти. Це зроблено добре; проблема лежить вище, у шарі судження.

---

# 2. Current architecture diagnosis

```text
Telegram (Daniel)                       Scheduler (Hetzner, Europe/Kyiv)
   │ текст/скрін — БЕЗ поточної дати ✗     │ ритуал/виняток + дата ✓ + hints ✓
   ▼                                        ▼
┌──────────────────── Coordinator (Sonnet 5 medium) ─────────────────────┐
│ prompt 3.5 KB: голос ✓, factual semantics ✓,                           │
│   «не пишеш першим / не трекаєш» ✗ (застаріло), PH-транспорт (зайве)    │
│   PM-судження / модель пріоритету: НЕМАЄ ✗                              │
│ + Memory instructions 4 KB (завжди в контексті): commitments ✓          │
├───────────── Skills (вантажаться на розсуд моделі) ────────────────────┤
│ task-management 14.8 KB — запис, labels, дати ✓; trigger «prioritizing»,│
│                 але пріоритизації всередині нема ✗                      │
│ studio-intake 11.3 KB — структура задачі ✓; жорстко відрізаний від TM ~ │
│ daily-planning 5.6 KB ┐ одне судження в двох місцях, due-first ✗,       │
│ weekly-planning 8.3 KB┘ «назви все відкладене» ✗                        │
│ pm-rhythm 10.8 KB — формати ритуалів ✓ + ще одна копія судження ~       │
│ work-review 1.9 KB — exact relay ✓                                       │
├─────────────────────── Specialist (Sonnet 5) ──────────────────────────┤
│ Project Health + skill 10.8 KB + prompt 7.6 KB — той самий model tier ✗ │
│   → окремий контекст, relay-код, «coordinator_withheld» на змішаних     │
└──────────────────────────────────────────────────────────────────────────┘
   │ fresh reads                         │ durable
   ▼                                     ▼
Trello (факти): list, due, label, desc   Memory: priorities, preferences,
  — немає next action / commitment /       projects/*, commitments/*, rhythm.md
    size у картці ✗ (docs/45 не впроваджено) — немає «прийнятий план тижня» як
  — даты UTC, weekday рахує модель ✗         стабільного файлу ~
```

| Межа відповідальності | Оцінка | Чому |
|---|---|---|
| Trello = поточний стан, Memory = прийняті рішення | ✅ правильно | Ядро docs/00 §5–6, #34 зроблено акуратно |
| Код = межі (verify, permissions, relay, ліміти ритму) | ✅ правильно | Кожен детермінований шар має виміряну причину |
| Хто володіє **PM-судженням** | ❌ ніхто | Розмазано по daily / weekly / rhythm / PH, у coordinator його немає |
| Хто володіє **«зараз»** (дата, день тижня) | ❌ ніхто для звичайних ходів | Заборона рахувати є, джерела немає |
| Project Health як окремий агент | ❌ більше не виправдано | Причина була в Haiku; зараз лишилась лише ціна |
| Intake ↔ task-management | ⚠️ штучний шов | Одна дія «з цього зроби задачу» розбита на два Skills, які весь час посилаються один на одного |
| Ритм ↔ планування | ⚠️ дублювання | pm-rhythm має власну модель «що важливо» |

---

# 3. Skill audit

| Skill | Current role | Problem | Рішення | Why |
|---|---|---|---|---|
| **task-management** (14.8 KB) | Запит vs обговорення; ціль / проєкт / label; verified write; дати після запису | ~80% тексту — безпека запису і обмеження провайдера. Trigger охоплює «prioritizing / discussing a task», але пріоритизації всередині немає, тож Skill вантажиться на «що далі?» і тягне в обережність. «Advice is not mutation» без протилежного правила: «я доробив Barbers» — це **звіт про факт, що очікує дії**. Style: «what you understood, any assumption» — зайвий ехо-переказ | **Rewrite** → `task-operations` | Лишити всі межі запису (#31, #37, due). Звузити trigger до створення / зміни / завершення / фактів картки. Додати «статус-звіт Daniel → запропонуй або виконай очевидну зміну + скажи, що далі». Прибрати дублі з coordinator (search ≠ direct read уже глобально) |
| **studio-intake** (11.3 KB) | Джерело → назва / контекст / чеклист / чого бракує | Якісний зміст. Проблема — шов: «цей Skill не вирішує, не пише, не резолвить — див. TM». Два Skills мусять завантажитися разом; пів тексту — межі між ними | **Merge** у `task-operations` як reference-файл `intake.md` | Одна дія Daniel = один Skill. Progressive disclosure [EXT]: SKILL.md вантажить `intake.md`, лише коли є скрін / PDF / пачка повідомлень |
| **daily-planning** (5.6 KB) | План дня, корекції плану | Due-first ранжування. «Brief note on what didn't make today» → переліки. Немає «що далі після завершення», «фініш перед стартом», «фокус-блок на проєкт», енергії чи масштабу | **Merge** з weekly у `planning-and-focus` | Одне судження — одне місце. День — це проєкція тижня, а не окрема логіка |
| **weekly-planning** (8.3 KB) | План тижня, перевантаження, перенесення | Явний порядок `due → in-progress → priorities`; «Never silently drop… name it as deferred» — пряме джерело board dump; розподіл по днях — зайва точність для дизайнера | **Merge** у `planning-and-focus` | Те саме + прибрати обов'язкове перелічення відкладеного |
| **pm-rhythm** (10.8 KB) | Автоматичні ходи (формати ритуалів), кнопки, `/rhythm.md`, mute / snooze | Формати і тюнінг хороші. Дублює evidence-правила і має власну модель «що головне». Трохи шаблонний | **Keep, rewrite lighter** | Унікальний trigger (маркер автоматичного ходу) і унікальний домен (налаштування). Судження брати з `planning-and-focus`, тут лишити лише «формат + read-only + коли мовчати» |
| **work-review** (1.9 KB) | Тижневий огляд з action history, exact relay | Коротко й правильно | **Keep** | Детермінований факт-блок має виміряну причину (#36). Не чіпати |
| **project-health** (10.8 KB) + **specialist** (7.6 KB) | Стан / ризики одного проєкту | ~63 заперечення; заборона будь-яких дат і відносного часу зроблена через Haiku; окремий агент дає relay-складність і `coordinator_withheld` на змішаних запитах | **Remove specialist** (після малого A/B); семантику Waiting / Blocked / Backlog підняти глобально; «вигляд проєкту» → розділ `planning-and-focus` | Coordinator тепер той самий Sonnet 5. Anthropic: multi-agent дає 3–10× токенів і має сенс для паралелізму, захисту контексту чи спеціалізації інструментів [EXT]. Тут немає жодного з трьох |
| *(немає)* **prioritization** як окремий Skill | — | — | **Не створювати окремо** | Пріоритет потрібен майже в кожному ході. Skill, який модель може не завантажити, — погане місце для ядра. Принципи — у coordinator, рубрика й приклади — у `planning-and-focus` |

**Instruction overload [INF, REPO].** На «що мені сьогодні робити?» модель потенційно вантажить prompt (3.5 KB), Memory-інструкції (4 KB), `daily-planning` (5.6 KB) і часто `task-management` (14.8 KB): разом ~28 KB. PM-судження з цього — ~1 KB. Sonnet 5 «interprets prompts literally» і найкраще реагує на позитивні приклади, а не на заборони [EXT]. Наші тексти побудовані навпаки.

**Правила, що прямо спричиняють проблеми:**

| Симптом | Правило-джерело |
|---|---|
| Due-bias | daily-planning `What ranks work` (due першим); weekly-planning `recorded due dates → in-progress → explicit priorities`; pm-rhythm Monday «reason: deadline…» |
| Board dump | weekly «Never silently drop… name it as deferred»; daily «note on what didn't make today»; rhythm «Important waiting items, named»; TM style «what you understood» |
| Надмірна обережність | TM ~59 заперечень у Skill, що вантажиться на будь-яку згадку задачі; PH «no qualitative exception: do not say a deadline looks close» |
| Непотрібні уточнення | Правило «ask exactly one question» є, але немає правила «коли краще взагалі не питати» (у ритуалах, при низькій ціні помилки) |
| Weekday / date slips | Немає поточної дати у звичайному ході; `due` — UTC; рахувати заборонено, а форматера немає |
| «Я не пишу першим» | Застарілий рядок coordinator prompt |

---

# 4. Prioritization diagnosis

## 4.1 Чому Djonik сьогодні вибирає неправильно

1. **Інструкції задають пріоритет за полями Trello**: due → list → waiting. Поля, які реально визначають пріоритет дизайнера (що почато, що показувати клієнту, що розблокує, що влазить сьогодні), в інструкціях або відсутні, або стоять у кінці.
2. **У картках немає носіїв цих факторів.** docs/45 рекомендував рядки `Зобов'язання:`, `Наступний крок:`, `Обсяг:`, `Чекаю:` в описі. Grep по Skills: **жоден Skill їх не згадує**, отже не пише й не читає [REPO]. Djonik не може відрізнити «клієнт чекає в пт» від «я колись поставив due».
3. **Немає поняття «ставки на тиждень / фокус».** Прийнятий план тижня пишеться в Memory без фіксованого місця. Денний план не бачить «що ми вирішили в понеділок» як явну рамку.
4. **Немає «фініш перед стартом» і WIP.** Ніде не сказано: поки є майже завершена задача, нову не пропонують.
5. **Немає вартості перемикання.** План може розкидати день по 4 проєктах.
6. **Немає моделі Daniel як дизайнера:** глибока творча робота vs адмін, енергія, «сьогодні Extract не чіпаю».
7. **Немає «now».** Без дати «due today» і «до пт» — вгадування.

## 4.2 Target decision model (якісна, без формули)

Скоринг-формула тут шкодить: вона знову робить поля Trello суддею. Потрібна **драбина рішень**, яку Claude застосовує як судження, та 5–6 канонічних прикладів.

**Крок 0 — що Daniel сказав сьогодні.** «Сьогодні Extract не чіпаю», «3 години тільки Seqthera», «я розбитий» — це рамка дня. Її перекриває лише реальне зовнішнє зобов'язання, яке ламається сьогодні, і тоді Djonik каже про конфлікт одним рядком.

**Крок 1 — жорсткі зовнішні зобов'язання.** Обіцяно людині (клієнту, команді), є строк і наслідок. Джерела: `commitments/` у Memory, рядок `Зобов'язання:` у картці, слова Daniel. **Trello `due` сам по собі сюди не потрапляє.** Due без підтвердженого зобов'язання — «внутрішня мітка», перевіряється одним питанням раз, а не виконується.

**Крок 2 — дотиснути почате (finishing bias).** Що вже In progress і найближче до client-facing кроку (показати, відправити, здати). Правило: **не пропонувати нову велику задачу, поки активна майже закрита**. Soft WIP ≈ 2–3 [EXT, personal kanban].

**Крок 3 — передати м'яч (unblock value).** Дії, які переводять роботу в Waiting на чужій стороні: відправити на фідбек, поставити питання клієнту, віддати файл. Короткі, але вивільняють календар інших, тому йдуть раніше за глибоку роботу, якщо займають хвилини.

**Крок 4 — ставки тижня і пріоритети проєктів.** Прийнятий план тижня, `priorities.md` (Cossack Labs, Limen «не зникає» тощо).

**Крок 5 — реалістичність.** Що реально влазить: масштаб, наявний час, **один глибокий творчий блок на ранок / день, адмін пачкою**, не більше двох проєктів за день без причини.

**Виключити з плану (але не з уваги):** Waiting без `next_check` на сьогодні; Inbox без розбору; backlog без причини; due, який виглядає неактуальним (раз запитати «це ще в силі?», не тягнути щодня).

**Форма відповіді:** **1 головне → до 2 другорядних → «решта може чекати»** одним реченням. Максимум один ризик. Деталі — на «розпиши».

**Коли питати, а коли ні.** Питати, лише якщо відповідь змінює **головне** на сьогодні і ціна помилки висока (наприклад, due завтра, зобов'язання невідоме). В інших випадках брати розумне припущення і називати його («вважаю, дедлайн по Barbers внутрішній — якщо ні, скажи»).

**Як модель вчиться без анкет.** Коли Daniel відповідає на таке уточнення («так, клієнт чекає в пт»), Djonik пропонує записати `Зобов'язання:` у картку або commitment у Memory (з одним «так»). Дошка поступово збагачується з розмови; саме це задумувала прогресивна модель docs/45 §12.

---

# 5. Proposed target architecture

```text
Telegram / Scheduler
  │  + детермінований clock-header у КОЖНОМУ ході:
  │    [Зараз: пт 25.09.2026, 13:10 Київ · сб 26.09 · нд 27.09 · пн 28.09 · … +14 днів]
  ▼
Coordinator «Джонік» (Sonnet 5 medium) — prompt ~4 KB
  • хто ти / для кого (дизайнер, не PM; мета — зняти з нього рутину)
  • PM-ядро: драбина пріоритету (§4.2) у 8–10 рядках
  • голос: висновок → 1–3 факти → одна дія; 2–3 позитивні приклади
  • factual semantics (коротко; + Waiting/Blocked/Backlog з PH)
  • ритм: «ти ведеш ритм і домовленості; автоматичні ходи — лише читання»
  • питати / не питати
Skills (4):
  1. task-operations      — створити / змінити / завершити / факт картки, verified write, labels
                             └ intake.md (скрін / PDF / пачка → структура)
                             └ card-metadata.md (Зобов'язання / Наступний крок / Обсяг / Чекаю)
  2. planning-and-focus   — «що далі / сьогодні / тиждень / горить / перенести / по X що в мене»
                             └ examples.md (6–8 канонічних відповідей)
  3. pm-rhythm            — формат автоматичних ходів + /rhythm.md; судження → planning-and-focus
  4. work-review          — без змін
Specialists: немає (PH specialist → retire після A/B)
Memory:
  /preferences.md, /priorities.md, /projects/*.md       (як зараз)
  /working-style.md  NEW  — як Daniel працює: глибока робота зранку, WIP, типові розміри задач
  /plans/current-week.md NEW — прийнятий план тижня (перезаписується в пн після «✅»)
  /commitments/**         (як зараз, #34)
  /rhythm.md              (як зараз)
Tools:
  Trello MCP (як зараз) + trello_work_history (як зараз)
  NEXT: trello_board_snapshot (read-only custom) — компактний стан відкритих карток
        з Kyiv-датою і днем тижня, header-рядками опису, «днів у поточному списку» з action log
```

**Чому саме так [INF + EXT]:**

- **Ядро судження — в coordinator, бо воно потрібне майже в кожному ході.** Skills — progressive disclosure для доменної деталі; їх вантаження залежить від рішення моделі [EXT]. Модель пріоритету, яка «може не завантажитися», — архітектурний дефект.
- **Skills нарізані за дією Daniel, а не за горизонтом часу.** «Змінити роботу» (task-operations) проти «вирішити, що робити» (planning-and-focus) — це реальна межа контексту. «День / тиждень» — ні. Anthropic прямо застерігає від поділу «за типом роботи» (telephone game) [EXT].
- **Жодного specialist.** Немає паралелізму і немає контексту, який треба ізолювати: board payload ≈ 20–40 KB вміщається в контекст. Специфічних інструментів теж немає. Повернутися до specialist варто лише за виміряного провалу (див. §7).
- **Clock-header — детермінований, тонкий, без роутингу.** Та сама ідея, що вже працює в ритмі (`kyivLabel`). Смужка на 14 днів дає lookup замість арифметики.
- **`trello_board_snapshot`** — «high-signal tool response» [EXT]: знімає одразу weekday-арифметику, плутанину з `lastActivityAt`, втрачені checklists у `list_by_board` (docs/02) і 43 KB payload (docs/46). Використовує патерн #36 (REST read у адаптері). Це NEXT, не NOW.
- **Модель / effort:** лишити Sonnet 5 medium для розмови. Для 1–2 ритуальних ходів на день можна спробувати `high` через session-override, **лише** якщо пілот покаже слабке судження в брифах. Документація радить піднімати effort, а не «промптити навколо» [EXT].

---

# 6. What should Djonik own for Daniel

## NOW (можна вже з поточними інструментами після кроків §9.1–9.3)

- **«Що далі?» / «що зараз робити?»** — одне головне + до двох другорядних, з пам'яттю про ставки тижня.
- **Звіт про завершення** («я доробив Barbers») → знайти картку, запропонувати або виконати Done, за потреби запропонувати «відправити клієнту → Waiting», одразу сказати наступне.
- **Перенесення** («клієнт переніс на понеділок») → змінити due картки (verified) **і** оновити commitment, якщо він є; одним повідомленням.
- **Intake** (скрін / повідомлення клієнта → задача в потрібному проєкті з label, коротка структура, одне питання лише про справді відсутнє).
- **Waiting-гігієна:** не планувати Waiting, повертати його в ранковий бриф у день `next_check`, у п'ятницю одним рядком «що досі чекаємо».
- **Фокус-запити:** «3 години тільки Seqthera» → вибрати 1–2 задачі Seqthera, що влазять і дають видимий результат, решту приглушити.
- **Ранковий бриф, план понеділка, п'ятничний огляд** (вже є; підключити до нового ядра судження).
- **«Що горить?»** — лише справжні: зобов'язання під загрозою, прострочене з реальним наслідком. Якщо нічого немає, так і сказати.

## NEXT (після `trello_board_snapshot` / метаданих картки)

- **Commitment ≠ due на рівні дошки:** Djonik пропонує рядок `Зобов'язання:` зі слів Daniel і з часом знає, які due «справжні».
- **Backlog hygiene в п'ятничному огляді (макс. 2–3 пункти на тиждень):** дублікати, картки без руху в Backlog N тижнів, due у минулому без наслідків, задачі XL без наступного кроку. Лише **пропозиції**; «архівувати» виконує Daniel, бо archive поза write-scope.
- **Наступний крок для In progress:** коли Daniel каже «зупинився на X», Djonik пропонує записати `Наступний крок:` у картку. Уранці «з чого почати» стає точним.
- **Відчуття перевантаження:** «на цей тиждень 3 зобов'язання + 4 задачі в роботі — щось одне я б відпустив».
- **Plan vs actual у п'ятницю:** прийнятий `current-week.md` проти `trello_work_history`.

## NOT WORTH AUTOMATING YET

- Автономне перепланування чи зміни Trello без «так» (анти-урок Motion, docs/25 §3).
- Автоматичне архівування, розбиття задач, масовий relabel.
- Числові оцінки пріоритету, energy-поля на картках, productivity score.
- Листи / повідомлення клієнтам (лише чернетки, пізніше).
- Calendar-інтеграція, поки синки вт/чт тримаються в Memory.
- Трекінг часу / effort accounting.
- Окремий «backlog-cleaner» agent чи щоденні hygiene-пінги.

---

# 7. Concrete instruction changes

## 7.1 Coordinator (`managed-agents/djonik.md`)

- **Remove:** «You do not message him first, run a schedule or track his commitments automatically — never promise that». **Replace:** «Ти ведеш робочий ритм (бриф, план понеділка, п'ятничний огляд) і пам'ятаєш прийняті домовленості. Автоматичні ходи лише читають; будь-яку зміну пропонуєш, а робиш після відповіді Daniel.»
- **Remove:** розділ «Project Health» (транспорт), якщо specialist знято. Якщо ні — залишити одним реченням.
- **Add розділ «Хто Daniel і що тобі делеговано»** (3–4 рядки): дизайнер (branding, packaging, 3D, motion, UI), кілька клієнтів паралельно; мета — щоб він не адмініструвати систему, а робив дизайн; ти береш рутину: що зараз, що чекає, що кому відправити, що перенести.
- **Add «PM-ядро»** — драбина з §4.2 у 8–10 рядках, з мотивацією («due у Trello часто ставиться для себе; реальний пріоритет — зобов'язання, почате і те, що рухає клієнтський крок»). Документація Anthropic: пояснення «чому» покращує виконання [EXT].
- **Add «Trello — це факти, судження — твоє»:** «Не переказуй дошку. Обери. Кажи, що можна ігнорувати.»
- **Add «коли не питати»:** низька ціна помилки → припущення вголос; у ритуалах — максимум одне питання, лише якщо воно змінює головне.
- **Add 2–3 позитивні приклади** відповідей (з §7.4) замість частини заборон.
- **Move in:** семантику Waiting / Blocked / Backlog із project-health (4 рядки), бо вона потрібна всім.
- **Keep:** голос, factual semantics, verified writes, мовні вимоги.

## 7.2 Skills

- **Merge** `daily-planning` + `weekly-planning` → **create `planning-and-focus`** (≈ 4–5 KB):
  - trigger (description): «що далі», «що сьогодні / цього тижня», «з чого почати», «що горить», «що перенести», «по <проєкт> що в мене», «хочу N годин на X», «сьогодні X не чіпаю», звіт про завершення як привід сказати наступне;
  - **remove** порядок «due → in-progress → priorities»; **replace** драбиною §4.2 (посиланням на ядро + деталізацією);
  - **remove** «Never silently drop… name it as deferred» і обов'язковий перелік відкладеного; **replace:** «Назви до двох речей, які свідомо відпускаєш, лише якщо Daniel міг би очікувати їх сьогодні; решту — одним реченням "решту можна не чіпати"»;
  - **add** «фініш перед стартом», WIP 2–3, один глибокий блок + адмін пачкою, ≤ 2 проєкти на день без причини;
  - **add** «проєкт-вигляд»: «по X що в мене?» = що в роботі, що наступне, що чекає, один ризик; це заміна PH для звичайних питань;
  - **add** «прийнятий план тижня»: читати `/plans/current-week.md` як рамку, свіжий Trello як стан;
  - **add** `examples.md` — 6–8 пар «ситуація → відповідь» (§7.4).
- **Rewrite** `task-management` → **`task-operations`**:
  - звузити description: створити / змінити / перенести / завершити / факт одного поля картки; **прибрати** «prioritizing, discussing»;
  - **add:** «Статус-звіт ("доробив X", "клієнт переніс на пн", "відправив на фідбек") — це запит на очевидне оновлення. Якщо ціль однозначна і дія зворотна (move, due), зроби її з перевіркою і скажи одним рядком; якщо ні — запропонуй одним питанням. Після цього — одне речення, що далі (за planning-and-focus).»
  - **merge** studio-intake як `intake.md`; **remove** секції «Division of responsibility» з обох боків;
  - **add** `card-metadata.md`: словник `Зобов'язання / Наступний крок / Обсяг / Чекаю / Блокер` (docs/45 §11.2); писати лише зі слів Daniel і після «так»; читати як сильніший сигнал, ніж `due`;
  - **remove** дублікати coordinator-семантики (`lastActivityAt`, search vs direct read в загальному вигляді); залишити лише те, що специфічне для запису;
  - **remove** style «what you understood, any assumption» → «результат одним рядком + що далі».
- **Rewrite lighter** `pm-rhythm`:
  - **remove** секцію «Evidence rules» (дубль coordinator);
  - **replace** власні критерії «що головне» посиланням: «Що головне — за planning-and-focus; тут лише формат, межа read-only і коли мовчати»;
  - **keep** формати, кнопки, `/rhythm.md`, mute / snooze / «менше»;
  - **add** до Friday review: «до 2 пропозицій гігієни backlog (дубль, давно без руху, неактуальний due)» — лише коли вони є.
- **Keep** `work-review` без змін.
- **Remove** `project-health` Skill разом зі specialist **лише після** A/B: 3 реальні питання («по Azov що в мене?», «що зависло по Extract?», змішане «що по Seqthera і постав дедлайн на пн») на coordinator з `planning-and-focus` проти поточного PH. Критерій: жодної фактичної помилки Waiting / Blocked / date і не довше. **Specialist повернути лише тоді**, коли coordinator системно гірший на тому самому тесті.

## 7.3 Runtime / Memory

- **Add clock-header** у кожен user-turn (адаптер, детерміновано, як `kyivLabel`): поточні дата, день тижня, час Київ і 14-денна смужка «дата → день тижня». У prompt: «Дату й день тижня бери зі смужки, не рахуй».
- **Memory:** додати `/working-style.md` (заповнюється з розмови: «зранку концепти, після обіду правки»), `/plans/current-week.md` (одне фіксоване місце для прийнятого плану). Решта без змін.
- **NEXT:** `trello_board_snapshot` (read-only custom tool) — див. §5.

## 7.4 Як мав би відповідати новий Djonik (тон, не шаблон)

**«я доробив Barbers, що далі?»**
> Закрив «Barbers — фінальні макети» в Done, перевірив. Якщо ти ще не відправив клієнту — зроби це зараз, це 5 хвилин, і м'яч у них.
> Далі я б взяв Seqthera — концепт упаковки вже в роботі й найближчий до показу. Extract сьогодні можна не чіпати.

**«що мені сьогодні робити?»** (пт 25.09)
> Сьогодні головне — дотиснути концепт Seqthera: він у роботі, і в пн його показувати.
> Між справами — відправити Азову правки по банеру, це розблокує їхній фідбек.
> Решту сьогодні можна не рухати. Брендбук Extract має due сьогодні, але я не бачу, що клієнт чекає саме сьогодні — це реальний дедлайн чи наш внутрішній?

**«по Azov що в мене?»**
> По Азову зараз одна задача в роботі — банер, і одна чекає фідбеку клієнта. Термінового нема.
> Наступний крок у тебе — правки банера; фідбек поки не підганяв би.

**«клієнт переніс це на понеділок»** (після розмови про Extract Брендбук)
> Переніс due «Брендбук» на пн 28.09, перевірив у Trello. Домовленість по Extract теж посунув на понеділок.
> Отже, сьогодні Брендбук з плану випадає — вивільняється час на Seqthera.

**«сьогодні хочу 3 години займатись тільки Seqthera»**
> Ок, за 3 години реально закрити концепт упаковки і, якщо лишиться час, підготувати його до показу. Інше по Seqthera — у понеділок.
> Решту проєктів сьогодні приглушу; скажу лише, якщо щось справді загориться.

**«що в мене горить?»** (коли нічого)
> Нічого не горить. Найближче зобов'язання — показ Seqthera в пн, і він у роботі. Можеш спокійно працювати за планом.

---

# 8. External research findings

## Directly useful

- **Anthropic, Skill authoring best practices:** «Claude is already very smart» — додавати лише те, чого модель не знає; ступінь свободи підбирати за крихкістю задачі: високий для судження, низький для крихких операцій. Для Djonik: запис — low freedom (так і є), планування — high freedom з прикладами (зараз навпаки: планування задано полями). Evaluation-first: 3 сценарії до написання тексту. <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>
- **Anthropic, Prompting Claude Sonnet 5:** модель «interprets prompts literally»; для стислості «positive examples… tend to be more effective than negative examples»; при слабкому міркуванні — піднімати effort, а не промптити навколо. Пояснює, чому «never silently drop» дає переліки. <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5>
- **Anthropic, Prompting best practices:** давати мотивацію / «чому» до інструкцій; прибрати агресивну мову («CRITICAL / MUST»), яка дає overtriggering на нових моделях. <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- **Anthropic, Effective context engineering:** «right altitude» між «brittle if-else» і розмитими промптами; «diverse, canonical examples»; just-in-time контекст. Прямо підтримує «ядро + приклади» замість десятків правил. <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- **Anthropic, When to use multi-agent systems:** три випадки (захист контексту, паралелізм, спеціалізація); anti-pattern — поділ «за типом роботи»; 3–10× токенів; «improved prompting on a single agent achieved equivalent results». Аргумент прибрати PH specialist і не нарізати Skills за горизонтом. <https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them>, <https://www.anthropic.com/engineering/multi-agent-research-system>
- **Managed Agents multiagent docs:** «Tools, MCP servers, and context are not shared» між агентами; рекомендовані патерни — паралелізація, спеціалізація, ескалація. PH не підпадає під жоден із них при однаковій моделі. <https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration>
- **Managed Agents memory docs:** «many small focused files»; `instructions` до 4 096 символів (наші Memory-інструкції вже близько до ліміту, тому нові правила туди не додавати); застереження про prompt injection у `read_write`. <https://platform.claude.com/docs/en/managed-agents/memory>
- **Anthropic, Writing effective tools for agents:** консолідовані high-signal відповіді замість сирих API. Обґрунтування `trello_board_snapshot`. <https://modelcontextprotocol.info/docs/tutorials/writing-effective-tools/> (переказ оригінальної статті Anthropic)
- **Personal Kanban / WIP:** «stop starting, start finishing», ціна перемикання, WIP 2–3 для однієї людини. Пряма основа «фініш перед стартом». <https://www.atlassian.com/agile/kanban/wip-limits>, <https://taskcoach.ai/blog/kanban-wip-limits-littles-law/>
- **Огляд agentic chief-of-staff систем:** надійні системи розділяють детерміноване (скрипти) і судження (LLM); сильний бриф — наслідок **безжального фільтрування** в одну чергу рішень. <https://zachpan.substack.com/p/after-reviewing-five-agentic-chief>

## Interesting but unnecessary

- Orchestrator-worker / флотилії агентів для CoS («The AI Chief of Staff Is a Fleet»). Для одного дизайнера з однією дошкою це overhead без виграшу. <https://dev.to/amitrix/the-ai-chief-of-staff-is-a-fleet-not-an-agent-1i>
- Open-source «AI chief of staff OS» з inbox triage і relationship-менеджментом. Добрий словник рівнів автономії (L0 read-only → L1 draft & propose → L2 auto low-risk); Djonik правильно стоїть на L1/L2. <https://github.com/willLin-creator/ai-chief-of-staff>
- «Dreaming» / консолідація Memory. Знадобиться, коли Memory виросте; зараз 7–10 файлів.
- Effort `high` для ритуальних ходів — лише після вимірювання в пілоті.

## Not applicable

- Motion-подібне автономне перепланування календаря (анти-урок, docs/25).
- Числові скорингові матриці (RICE / WSJF) для соло-дизайнера: дані заповнюються гірше, ніж судження.
- Vector DB / RAG для пам'яті: обсяг мізерний, native Memory достатньо (docs/00 §11).
- Code-review-specific поради Sonnet 5 про recall.

(Зовнішні продукти-аналоги — Pulse, Sunsama, Planner Agent, Linear, Rovo — уже розібрані в docs/25 §3. Їхні уроки (ритм, ліміт уваги, «пропонуй, не дій») архітектура вже врахувала; тут не повторюю.)

---

# 9. Recommended implementation order

1. **Clock-header у кожен хід + виправлення застарілого рядка prompt.** Найменше, дешеве, прибирає клас weekday-помилок і суперечність з ритмом. Source + app deploy, без нових Skills.
2. **PM-ядро в coordinator + `planning-and-focus` (merge daily/weekly) з прикладами.** Головний крок для пріоритету й стислості. Перевірка — 6 реальних фраз Daniel з §7.4 проти старої версії, одна дешева сесія.
3. **`task-operations` (rewrite TM + merge intake + статус-звіти + card-metadata) і полегшений `pm-rhythm`.** Після цього «я доробив Barbers» і «клієнт переніс» стають одноходовими.
4. **A/B і retire Project Health specialist.** Прибирає relay-складність і змішані-запит провали. Робити лише після кроку 2, бо «проєкт-вигляд» живе там.
5. **`trello_board_snapshot` + backlog-hygiene в п'ятничному огляді.** Лише якщо пілот після кроків 1–4 ще показує date / payload / «давно без руху» проблеми.

Пілот #35 варто вести **паралельно з кроками 1–3**: ритм уже працює, і кожен бриф — безкоштовний тест нового ядра.

---

# 10. What NOT to change

- **Verified write path** (#31 ledger, read-after-write, due-формат після запису #23) — працює і має виміряну причину.
- **Labels як проєкт** (#37) і «нова задача → Inbox».
- **Permission boundary** (#39: `always_ask` + deny в автономних ходах) і read-only ритм.
- **Exact relay work-history** (#36) і `work-review`.
- **Commitments у Memory** (#34) — модель файлів правильна; лише додати одне фіксоване місце для плану тижня поруч.
- **Ліміти ритму** (quiet hours, cap, spacing, SILENT, mute / snooze / «менше»).
- **Trello як субстрат,** одна дошка, список = стадія (docs/45 KEEP).
- **Sonnet 5 medium** як coordinator (не повертати Haiku; не піднімати effort без виміру).
- **Final-only Telegram delivery** і rich-text рендер (#38 / #39).
- **Жодного custom tool loop, роутера намірів чи власної БД** — ні одна з рекомендацій їх не потребує.

---

## Обмеження аудиту

- Живий вміст Memory store не читався; висновки про `priorities.md` / `projects/*` спираються на docs/25 і docs/33.
- Реальні Telegram-транскрипти пілоту не аналізувались, крім прикладу з weekday у docs/69 §6. Твердження «Djonik пише зайве» взято з брифу Product Owner; причини виведені з інструкцій, а не зі статистики розмов.
- Живих прогонів не було. Приклади §7.4 — цільовий тон, не виміряна поведінка. Назви карток у прикладах ілюстративні.
- Кількість заперечень — груба лексична метрика (`never / do not / don't / not`), використана лише як індикатор балансу «заборони vs судження».

## Follow-up 2026-09-25: issues і порядок виконання

На запит Product Owner створено GitHub issues (GitHub — єдина зовнішня дія; Agent, Skills, Memory, Trello, host не змінювались):

| Порядок | Issue | Що | Залежить від |
|---|---|---|---|
| 0 | [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) (NOW) | Дозавершити активацію ритму і перший Friday Review | — |
| 1 | [#41](https://github.com/danielkokr/djonik-manager-2.0/issues/41) | Годинник у кожному ході + виправлення застарілого рядка prompt | #39 closeout |
| 2 | [#42](https://github.com/danielkokr/djonik-manager-2.0/issues/42) | PM-ядро + `planning-and-focus` (merge daily + weekly) + місце для плану тижня в Memory | #41 |
| 3 | [#43](https://github.com/danielkokr/djonik-manager-2.0/issues/43) | `task-operations` (статус-звіти → дії, merge intake, метадані картки), легший `pm-rhythm` | #42 |
| 4 | [#44](https://github.com/danielkokr/djonik-manager-2.0/issues/44) | A/B, потім retire Project Health specialist (або залишити з виміряною причиною) | #42 |
| — | без issue | `trello_board_snapshot` + backlog hygiene | лише якщо пілот після #41–#44 покаже потребу |

Пілот [#35](https://github.com/danielkokr/djonik-manager-2.0/issues/35) іде паралельно як реальне використання. Він не є source-роботою і служить доказом для #41–#43.

## Змінені файли

- `docs/70_DJONIK_PM_DELEGATION_ARCHITECTURE_AUDIT.md` — цей звіт (новий, untracked).
- `docs/02_DEVELOPMENT_ROADMAP.md` — рядки 11–14 і кандидат у черзі, абзац «Update 2026-09-25»; #39 лишається NOW.

## `git status --short`

```text
 M docs/02_DEVELOPMENT_ROADMAP.md
?? docs/67_ISSUE_39_R27_HOSTED_CUTOVER.md
?? docs/69_ISSUE_39_WORKING_RHYTHM_ACTIVATION.md
?? docs/70_DJONIK_PM_DELEGATION_ARCHITECTURE_AUDIT.md
```
