# #38 — planning smoke на збагачених Trello-даних

Дата: 2026-09-23. Canonical NOW: #38 ([docs/02](02_DEVELOPMENT_ROADMAP.md)). Базовий rubric: [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md). Попередній D: [docs/43](43_ISSUE_38_CONTRACT_DERIVED_LIVE_SMOKE.md) §7. Design evidence: [docs/45](45_TRELLO_AI_PROJECT_MANAGEMENT_AUDIT.md). docs/45 — це аудит, а не deployed instruction: жодна його рекомендація моделі не передавалась.

## Рішення Product Owner (фінальна класифікація, 2026-09-23)

**PASS WITH SOFT OBSERVATION.** Product Owner і Product Lead прийняли цей smoke.

- Збагачені описи суттєво покращили міркування.
- Career Page UI вибрано за явними фактами з опису задачі.
- activity-as-work не повторився; Waiting оброблено правильно.
- Формулювання «можуть почекати день без наслідків» лишається надто сильним. PO трактує його як надто впевнене PM-формулювання, а не як блокер для приймання ordinary coordinator.

**Ordinary daily-planning на Sonnet 5 medium прийнято на достатньо описаних реальних Trello-даних.** Не всі проблеми планування розв'язані.

Model, effort, prompt і Skills не змінюються. Повторного planning smoke немає; prompt і Skills під це формулювання не посилюються. Ескалація моделі закрита. Наступний і останній обмежений напрям #38 — **Project Health composition** ([docs/47](47_ISSUE_38_PROJECT_HEALTH_COMPOSITION_AUDIT.md)).

Нижче без змін зберігаються сирі докази та **первинна оцінка агента-ревʼюера** (§0, §9, §13). Первинний verdict HARD FAIL — історичний запис оцінки, а не чинне рішення.

## 0. Висновок (первинна оцінка агента-ревʼюера, до рішення PO)

**HARD FAIL (вузький, межовий) → PRODUCT OWNER REVIEW REQUIRED.** *Замінено рішенням PO вище: PASS WITH SOFT OBSERVATION.*

- Збагачені описи **суттєво** змінили міркування. Головну задачу дня модель вибрала за фактами з опису: оцінка, фокус, термін показу. Це вже не здогадка з назви картки, як у docs/43.
- Помилка класу «немає дедлайну → немає ризику» **звузилась, але не зникла**. Модель написала: «Крем для рук, Чорні/Білі аромати, UI Fixs — … без жорсткого дедлайна на сьогодні, можуть почекати день без наслідків». Проте опис `Крем для рук` прямо фіксує показ клієнту 24.09 або 25.09 зранку, а до того ще пів дня дизайну й рендер у Cinema 4D. «Без наслідків» не підтверджено доказами і суперечить прочитаному опису.
- **Checklists моделі не потрапили.** `list_by_board` повернув `checklists: []` для всіх карток. Read-only REST-перевірка показала, що checklists у Trello є: UI Fixs 7/9, Чорні аромати 3/5, Білі аромати 3/5, Підтримка UI 3/6. Тому checklist-вимір — **NOT EXERCISED (tool did not expose)**, а не помилка моделі.
- Custom Field `Size` заповнений на всіх 15 активних картках, але в MCP-payload його немає. Модель на нього не посилалась.
- `end_turn`, **0 записів**, **$0.21** із дозволених $0.30. Повторів не було.

## 1. Мета

Перевірити, чи Sonnet 5 medium дає нормальний PM-результат, коли має достатньо реального контексту задач. Змінна — якість Trello task data. Model, effort, prompt, Skills і runtime заморожені.

## 2. Frozen candidate (read-back перед inference)

| Поле | Значення |
|---|---|
| Primary Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v25** (`updated_at 2026-09-23T11:53:10Z`); після ходу без змін |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| Prompt | 3529 B, SHA-256 `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6` (Agent і snapshot Session збігаються) |
| Skills (`latest` → resolved, до і після ходу) | task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`; daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`; weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`; studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj` |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4**, system `b4a50439…78a7`; після ходу без змін |
| Tools / MCP | tools SHA `9995f382…291c`; MCP `trello`, `google-calendar-calendarmcp` (Calendar toolset disabled) |
| Environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`**, `/mnt/memory/djonik-memory`, instructions SHA `ae02f429…f662` (ті самі, що в docs/43) |

**Session:** `sesn_0179PBufPGSoW3y3mWub8ocX`, нова, створена як `agent {id, version: 25}`, `max_list_cost {amount "30", currency "USD"}`. Read-back перед send: `idle`, **0 events**, 0 input/output/cache tokens, `list_cost 0`. Старі Sessions docs/43, custom-field probe, перервана high-Session і Telegram serving Session не використовувались.

## 3. Admission (docs/04 §27)

Найгірший порівнянний повний хід — docs/43 D: **14¢**. Резерв — **10¢**. Отже, потрібно **24¢**. Вільний залишок Session дорівнював **30¢**, тож хід допущено. Бюджет не піднімався. Фактичний хід коштував 21¢, backstop не перевищено.

## 4. Що змінилось порівняно з docs/43 D

- **Намірена зміна:** Daniel вручну переписав описи активних карток природною мовою. Тепер там є результат, обсяг або час, наступний крок, контекст, очікування і терміни.
- **Інші зміни стану дошки, які також вплинули на дані:**
  - розташування карток у списках змінилось. UI Fixs перейшла з In progress у This week. Invoice, Банер, Брендбук, Мудборд, Футболка, RDAS, Хайлайт і Підтримка UI тепер у Backlog.
  - додано checklists, але MCP їх не віддав (§7);
  - заповнено Custom Field `Size`, невидимий через MCP.

  Тому порівняння з docs/43 D **семантичне**, а не за вибором задач.
- Configuration (Agent, model, prompt, Skills, Memory, runtime) — ідентична docs/43.

## 5. Prompt

```text
У мене сьогодні мало ресурсу. Як би ти звузив день? Коротко.
```

## 6. Видима відповідь

Фінальний `agent.message`. Runtime final-only доставляє саме його:

```text
Головне сьогодні — Career Page UI: вона вже в роботі і має реальний дедлайн завтра, 24.09, до обіду. Оцінка ~2–3 год, фокус середній — це те, що точно не можна зсунути.

Все інше залишаю поза сьогоднішнім планом:
- Крем для рук, Чорні/Білі аромати, UI Fixs — задачі This week, але без жорсткого дедлайна на сьогодні, можуть почекати день без наслідків.
- RDAS, Хайлайт, Брендбук, Мудборд, Футболка — Backlog, не термінові.
- Діадіа, Головна сторінка (Bionova) — Waiting, від тебе зараз нічого не залежить.

Якщо після Career Page UI лишиться сила — наступний за пріоритетом легкий шматок це одна з двох підзадач UI Fixs (~2 год, там просто треба згенерувати Hero Image в midjourney). Решту чесно переносимо на завтра.
```

Interim `agent.message` на 10.6 с у подіях є, але final-only adapter його не доставляє:

```text
Треба глянути свіжий стан Trello, щоб звузити план по фактах, а не пам'яті.
```

## 7. Tool trace і Trello evidence

**Послідовність (усе в цьому ході):**
1. `read /workspace/skills/daily-planning/SKILL.md`. Прочитаний текст містить «Do not equate no due date with low urgency» і правило про due та spare capacity.
2. `bash rg -il '.' /mnt/memory/djonik-memory/`: лише список файлів.
3. `read priorities.md`, `read preferences.md`. Там Cossack Labs high by default з Tue/Thu sync cadence, Extract medium, і правило «Current deadlines… always come from fresh Trello». У preferences — «short, concise».
4. `trelloReadMember get_me` (timezone `Europe/Kiev`), `trelloReadBoard list`, `trelloReadWorkspace list`, `trelloReadBoard list_by_workspace`.
5. **`trelloReadCard {"action":"list_by_board", board Djonik}`**: 43 219 B, `totalCount 35` (15 активних + 20 Done), `hasNextPage false`.

**Що `list_by_board` віддав на кожну картку.** Поля: `name, desc, list, labels, due, dueComplete, lastActivityAt, startedAt, closed, complete, members, comments, checklists, checklistsHasMore`.

| Сигнал | У payload? |
|---|---|
| list / status | так |
| project label | так |
| due | так (`null` скрізь, крім Брендбук `2026-09-25T15:00:00.000Z`) |
| description | **так, повністю** |
| checklists / items | **ні:** `checklists: []`, `checklistsHasMore: false` на **всіх** картках |
| Custom Field `Size` | **ні:** поля немає, слова `custom` у payload немає |
| time/size у тексті опису | так, де Daniel його написав |

**Read-only REST-перевірка.** Після ходу, наявним `TRELLO_READ_TOKEN`, лише GET. Виведено тільки лічильники, без змісту:

| Картка | list | checklists (REST) | Size CF (REST) | У MCP |
|---|---|---|---|---|
| Career Page UI | In progress | — | M | desc |
| UI Fixs | This week | **7/9** | M | desc, `checklists: []` |
| Чорні аромати 100 ML | This week | **3/5** | M | desc, `checklists: []` |
| Білі аромати 50 ML | This week | **3/5** | L | desc, `checklists: []` |
| Крем для рук | This week | — | M | desc |
| Підтримка UI | Backlog | **3/6** | XXL | desc, `checklists: []` |
| інші активні | Backlog / Waiting | — | S…XXL | desc |

Висновок: **поточний bulk-шлях MCP не експонує checklists**. Нуль при `checklistsHasMore: false` виглядає як «чеклістів немає», а не як «не завантажено». Чи віддає їх прямий `trelloReadCard get` або окремий checklist-read, у цьому ході не вимірювалось.

**Сирі фрагменти для вибраних задач.**

- `Career Page UI` — In progress, `Cossack Labs`, `due: null`:
  > «Результат: Маю додати один блок до цієї сторінки. / Оцінка: ~2–3 год / Фокус: середній / Контекст: маю доробити і повідомити Івана та Ольгу. / Наступний крок: чекати затвердження і віддати на верстку. / Термін : потрібно показати в четвер 24.09 до обіду»
- `UI Fixs` — This week, `Cossack Labs`, `due: null`, checklist у MCP `[]` (REST 7/9):
  > «Залишилось дві підзадачі : Hero Images до статей і описати задачу Артему - верстальщику. Hero Image - треба згенерувати в midjourney варіанти до статей. … Дві задачі приблизно по 2 години.»

**Сирі фрагменти для відкладених карток, на яких тримається grading.**

- `Крем для рук` — This week, `Extract`, `due: null`:
  > «Орієнтовно мені піде пів дня на цю задачу. Потім потрібно чекати коментарів і затвердження. По хорошому мені потрібно зробити дизайн і в п'ятницю 24.09 показати або в суботу зранку 25.09 . Бо це буде спочатку дизайн в Illustrator потім потрібно зрендерити це все в Cinema 4D, показати клієнтові…»

  У самих даних є неузгодженість: 24.09.2026 — четвер, 25.09 — п'ятниця.
- `Білі аромати 50 ML` — This week, `Extract`, `due: null`: «…Оформити сцени в Cinema 4D. Потім поставити на ніч рендеритись. Обсяг: L. Наступний крок: … додати ці сцени на Google Drive і повідомити про це клієнта.»
- `Брендбук` — Backlog, `due 2026-09-25T15:00Z`: «…Я десь виконав 30%. Я з нею не спішу, вона не в фокусі.»
- `Діадіа` — Waiting: «Чекаю затвердження від клієнта.Пауза.» `Зробити головну сторінку` — Waiting, `Seqthera`: «Зараз проект на паузі, нічого не робимо. Прототип сайту… bionova-cyan.vercel.app».
- `lastActivityAt` усіх 15 активних карток — 2026-09-23. Це наслідок ручного редагування описів сьогодні, тобто пастка activity=work.

## 8. Аналіз використання description / checklist / size

| Сигнал | Використано? | Доказ |
|---|---|---|
| Опис як джерело терміну | **так** | «реальний дедлайн завтра, 24.09, до обіду» — з «Термін: … четвер 24.09 до обіду». Trello `due` у картки `null` |
| Опис як оцінка часу | **так** | «Оцінка ~2–3 год» (Career Page), «~2 год» (UI Fixs) — дослівно з описів |
| Опис як тип роботи / наступний крок | **так** | «згенерувати Hero Image в midjourney», «фокус середній» |
| Опис проти Trello due | **так, коректно** | Брендбук має due 25.09, але названий «не терміновий». Це узгоджується з «я з нею не спішу, вона не в фокусі» |
| Опис для Waiting | **так** | «від тебе зараз нічого не залежить» узгоджується з «чекаю затвердження», «на паузі» |
| Опис Крем для рук (термін показу, пів дня + рендер) | **ні** | Показ 24/25.09 не згаданий; картку віднесено до «без наслідків» |
| Size bucket з опису (`Обсяг: M/L`) | ні, прямо | Модель використала години, а не bucket. Це прийнятно |
| Custom Field Size | недоступний | Модель його не вигадувала |
| Checklist | **недоступний** | Tool не віддав; прогресу з checklist модель не заявляла |

## 9. Grading

| # | Питання / критерій | Доказ | Verdict | Cause |
|---|---|---|---|---|
| A | Чи збагачені описи суттєво вплинули на міркування | Головна задача обрана за терміном, оцінкою й фокусом з опису. У docs/43 Career Page відкладено як «важча дизайн-задача» за назвою при порожньому описі | **PASS** | — |
| B | Size/time з опису | «~2–3 год», «~2 год» | **PASS** | — |
| C | Checklist state доречно | Checklists не було в payload | **NOT EXERCISED** | tool did not expose |
| D | Checklist % ≠ effort % | Checklists відсутні в payload; жодного % немає | **NOT EXERCISED** | tool did not expose |
| E | Уникнути no due → no risk | «без жорсткого дедлайна на сьогодні, можуть почекати день без наслідків», зокрема про Крем для рук, чий опис фіксує показ клієнту 24.09 / 25.09 зранку після пів дня дизайну і рендеру. Відсутність жорсткої дати перетворено на відсутність наслідків і подано як факт | **HARD FAIL (вузький, межовий)** | **model ignored explicit available evidence** + та сама семантична родина, що в docs/43. Внесок даних: неузгодженість «п'ятниця 24.09 / субота 25.09» |
| F | Уникнути no due → low priority | «Backlog, не термінові». Для RDAS, Мудборд і Брендбук це підтримано описом. Для Хайлайт і Футболка — судження зі статусу Backlog без маркера «я б». Брендбук з due названо нетерміновим саме за описом, тобто висновок не виведений із відсутності due | **SOFT** | evidence proportionality |
| G | Уникнути activity → work | `lastActivityAt` (усі сьогодні) не використано. «вже в роботі» спирається на list `In progress` | **PASS** | — |
| H | Waiting ≠ executable, ≠ Blocked | Waiting-картки винесено з плану з причиною з опису; слова Blocked немає | **PASS** | — |
| I | Справді коротко | ~9 рядків. Проте блок «поза планом» перелічує 11 карток — майже повний інвентар активної дошки | **SOFT** | — |
| J | Корисність | Одна зрозуміла дія (Career Page, 2–3 год, показ завтра до обіду) + опційний малий шматок (~2 год). Цим можна користуватись. Але прихований термін Крем для рук може коштувати Daniel клієнтського показу | **PASS з застереженням** | — |
| — | Відносна дата «завтра» | Фактично правильно: 23.09 — середа, 24.09 — четвер, і опис сам називає «четвер». Джерела «сьогодні» (formatter / авторитетна дата) у trace немає | **SOFT** (спостереження) | provenance not visible |
| — | Вигадані зобов'язання | «реальний дедлайн … до обіду» — прямо з опису Daniel; клієнтських зобов'язань не вигадано | **PASS** | — |
| — | Process narration | Interim «Треба глянути свіжий стан Trello…» у подіях, не доставляється | **SOFT** | як docs/43 B |
| — | Дрібниці | «Головна сторінка (Bionova)» — назва з URL в описі, а не label `Seqthera`. «Решту чесно переносимо на завтра» суперечить «Backlog, не термінові». Invoice, Банер і Підтримка UI пропущені мовчки (це допустимо) | **SOFT** | — |
| — | Writes / end_turn | 0 writes, `session.status_idle{end_turn}` | **PASS** | — |

**Чому E — hard, а не soft.** Вибір не робити Крем для рук сьогодні — легітимне PM-судження для дня з малим ресурсом, і воно не оцінюється. Помилка в іншому: твердження «можуть почекати день **без наслідків**» подане як факт. Воно покриває картку, в описі якої є найближчий клієнтський показ після Career Page і довгий lead time (пів дня + рендер). Це прямо той hard-приклад, який заздалегідь задав PO: «no-due → safe/low-risk inference». Модель у цьому ж ході прочитала daily-planning («Do not equate no due date with low urgency»), а coordinator prompt каже, що дата не означає «enough time». Отже, це не відсутність інструкції.

**Чому «межовий».** Дані неузгоджені. Якщо Daniel мав на увазі дні тижня (п'ятниця 25.09 / субота 26.09), відкладення на день справді менш критичне, хоча й з'їдає буфер. Thinking у trace не видно, тож чи врахувала модель цю дату, встановити неможливо. Якщо PO трактує цей рядок як допустиме PM-судження з невдалим формулюванням, verdict E стає SOFT, а загальний — **PASS**.

## 10. Порівняння з docs/43 D

| | docs/43 D | Тепер |
|---|---|---|
| Базис вибору | Назви карток при порожніх описах («дрібні фікси», «важча дизайн-задача») | Термін, оцінка й фокус з описів |
| Career Page UI | Відкладено як «важчу» | Обрано головною: показ 24.09 до обіду |
| No-due семантика | «без дедлайну — чекає без ризику» (відкритий строк, група карток) | «без жорсткого дедлайна на сьогодні, можуть почекати день без наслідків» (один день, група карток, одна з них з явним близьким терміном в описі) |
| Activity=work | не використано | не використано; пастка сильніша — усі `lastActivityAt` сьогодні |
| Waiting | не згадано | згадано коректно, з причиною з опису |
| Припущення з назв без маркера | SOFT | майже зникли: розмір і тип роботи взято з описів |
| Вартість | 14¢, 8 iterations | 21¢, 9 iterations (payload 43 KB) |

1. **Чи зник клас помилки?** Ні, він звузився. Замість «немає дедлайну → немає ризику» тепер «немає жорсткого дедлайну сьогодні → день відкладення без наслідків».
2. **Чи зменшили описи вгадування?** Так, суттєво. Головний вибір і оцінки часу тепер спираються на факти. Здогадки з назв майже зникли.
3. **Природа залишкової слабкості:**
   - **model reasoning:** надмірно впевнене «без наслідків» при доступному протилежному сигналі;
   - **task data:** неузгоджений weekday/date у Крем для рук;
   - **tool exposure:** checklists не віддаються bulk-читанням, CF Size невидимий.

   **Instruction gap — ні:** правило було прочитане в ході. Інші відмінності від вибору ревʼюера — **subjective PM judgement**, не model weakness: наприклад, Invoice як «легка» задача на день з малим ресурсом.

## 11. Вартість, латентність, виклики

| Метрика | Значення |
|---|---|
| List cost | **21¢** ($0.21) з 30¢ backstop; перевищення немає |
| Input / cache-create / cache-read / output | 18 / 54 575 (5m) / 230 107 / 2 312 |
| Model iterations (`span.model_request_start`) | 9 |
| Active seconds (usage / stats) | 48.568 / 46.652 |
| Wall latency (send → `status_idle`) | 47.9 s; фінальне повідомлення на 47.7 s |
| MCP calls | 5: `trelloReadMember` ×1, `trelloReadBoard` ×2, `trelloReadWorkspace` ×1, `trelloReadCard` (`list_by_board`) ×1 |
| Built-in calls | `read` ×3 (daily-planning SKILL.md, `priorities.md`, `preferences.md`), `bash` ×1 (`rg -il` по Memory) |
| Skill read | daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ` |
| Custom tools / threads | 0 / 0 (specialist не викликався) |
| Stop | `session.status_idle{stop_reason: end_turn}` |

Ріст вартості проти docs/43 D (14¢ → 21¢) пояснюється майже подвоєним cache-create: 27 691 → 54 575. Причини — більший `list_by_board` (43 KB із повними описами, з них ~20 Done-карток) і два Memory-читання замість одного.

## 12. Zero-write evidence

- `trelloWrite*` — **0**. Calendar — **0** (toolset disabled).
- Built-in `write` / `edit` — **0**. Memory mount `read_only`, Memory writes — **0**.
- `agent.custom_tool_use` — 0, `session.thread_created` — 0.
- Після ходу: Agent v25 (`updated_at` без змін), prompt SHA збігається, specialist v4 (`b4a50439…`), усі чотири `latest_version` без змін. Serving / Telegram Session не зачіпалась.
- REST-перевірка з §7 — лише GET.

**External writes: 0.**

## 13. Висновок

**Фінальне рішення PO: PASS WITH SOFT OBSERVATION** (див. початок документа). Спостереження «без наслідків» (E) лишається зафіксованим як soft: це надто впевнене PM-формулювання. Наступний крок #38 — Project Health composition.

Первинна оцінка агента-ревʼюера, збережена як історичний запис: **HARD FAIL (вузький, межовий) → PRODUCT OWNER REVIEW REQUIRED.** Повторів, змін prompt/Skills/effort/model не було.

Класифікація за правилом рішення PO:
- **model ignored explicit available evidence** (основне). Опис Крем для рук з терміном показу й lead time був у payload, але відповідь назвала відкладення «без наслідків».
- **tool did not expose necessary data** (окремо, для checklist-виміру). `list_by_board` повертає `checklists: []` при наявних checklists. Твердження «checklists доступні через поточний Trello MCP» для bulk-шляху не підтвердилось.
- **necessary data was still absent / ambiguous** (внесок). Weekday і дата в Крем для рук не узгоджені.
- **instruction conflict** — ні. **validation mistake** — ні; вимір E зафіксовано заздалегідь.

Позитивний результат, окремо від verdict: достатньо описані картки помітно покращують денне планування Sonnet 5 medium. Головний вибір, оцінки часу, Waiting і due-проти-опису (Брендбук) відпрацьовані за фактами.

Якщо PO перекласифікує E як SOFT, запис має бути таким: «Sonnet 5 medium ordinary daily-planning behavior is acceptable on sufficiently described real Trello data», а наступний крок #38 — **Project Health composition / `specialist_only` decision**.

Не виконано: commit, push, deploy, GitHub comment, закриття #38, промоція #33, зміни docs/02, docs/43 і docs/45.
