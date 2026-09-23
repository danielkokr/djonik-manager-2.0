# #38 — contract-derived live smoke (B / C1+C2 / D)

Дата: 2026-09-23. Canonical NOW: #38 ([docs/02](02_DEVELOPMENT_ROADMAP.md)). Критерії оцінки: [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md). Remote-конфігурація: [docs/42](42_ISSUE_38_REMOTE_SYNC_REPORT.md). Product Owner дозволив один обмежений paid smoke на **$1.20 сумарно**. Модель, prompt, Skills і runtime не змінювались. Project Health у цей smoke не входив.

## 0. Висновок

**Overall: HARD FAIL (вузький, один пункт) → PRODUCT OWNER REVIEW REQUIRED.**

- B, C1, C2: hard failures немає; є soft-зауваження.
- D: один hard failure за factual semantics. Про картки без due модель сказала «чекає без ризику», тобто вивела відсутність ризику з відсутності дати. Daily-planning Skill, прочитаний у цьому ж ході, прямо це забороняє.
- Усі 4 ходи завершились авторитетним `end_turn`. Зовнішніх записів **0**. Вартість **31¢**.
- Чотири попередні семантичні помилки docs/39 у заявленій формі не повторились. Waiting=Blocked не перевірено: D не згадував Waiting. Due-семантика повторилась у дзеркальній полярності (див. §9).

За правилом рішення PO: ordinary coordinator **не прийнято**. Prompt не редагувався, effort не підвищувався, повторів не було.

## 1. Frozen candidate (read-back перед inference)

| Поле | Значення |
|---|---|
| Primary Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v25** (`updated_at 2026-09-23T11:53:10Z`), після smoke без змін |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| Coordinator prompt | 3529 B, SHA-256 `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6` (у кожній Session) |
| Skills (`latest` → resolved; перевірено перед Session і перед кожним ходом) | task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`; daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`; weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`; studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj` |
| Specialist roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4**, system `b4a50439…78a7`, після smoke без змін |
| Environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`**, mount `/mnt/memory/djonik-memory`, instructions SHA `ae02f429…f662` |
| Tools / MCP | як v25, без змін (sha tools/MCP однакові в B, C, D) |

## 2. Sessions

| Сценарій | Session | Походження | `max_list_cost` | Події до ходу |
|---|---|---|---:|---|
| B | `sesn_015pyFLex524B9ASrk8fxHHP` | підготовлена в docs/42; budget `"1"` → `"30"` | 30¢ | 1 (`session.updated` від зміни budget), 0 розмовних |
| C | `sesn_01AdHUP9u2gCjH5r9NU1MGkb` | нова, `agent {id, version: 25}` | 55¢ | 0 |
| D | `sesn_01PbKLQFE5xYpSmsS5R62LLH` | нова, `agent {id, version: 25}` | 35¢ | 0 |

Сума backstops дорівнює $1.20. C і D створено з тими самими environment, vault, Memory resource (`read_only`, ті самі instructions), prompt, Skills, tools, MCP і roster, що й B: програмне порівняння `identicalToB: C true, D true`. Між B, C і D історія не передавалась. Історичні low/medium Sessions не використовувались.

## 3. Admission (docs/04 §27)

Найгірший порівнянний повний хід (docs/39, ordinary coordinator без delegation) коштував 12¢, резерв 10¢. Отже для кожного ходу треба було **22¢** вільного залишку і в Session, і глобально зі $1.20. Перед кожним send читались `sessions.retrieve().usage.list_cost` усіх трьох Sessions, а також `latest_version_id` чотирьох Skills і стан Agent v25/idle.

| Хід | Глобально витрачено / залишок | Session витрачено / залишок | Потрібно | Допущено |
|---|---:|---:|---:|---|
| B | 0 / 120¢ | 0 / 30¢ | 22¢ | так |
| C1 | 14 / 106¢ | 0 / 55¢ | 22¢ | так |
| C2 | 15 / 105¢ | 1 / 54¢ | 22¢ | так |
| D | 17 / 103¢ | 0 / 35¢ | 22¢ | так |

## 4. Метрики

Для всіх ходів: Agent v25, `claude-sonnet-5` / medium / standard, prompt `3e204453…b4b6`, Skills як у §1, completion `session.status_idle{stop_reason: end_turn}`. Custom tools 0, threads 0, external writes 0.

| Хід | List cost Δ / Session cum. / smoke cum. | Input / cache-create / cache-read / output | modelIterations | MCP calls | Built-in calls | Skill read | active s (usage / stats) | Wall s |
|---|---:|---:|---:|---|---|---|---:|---:|
| B | 14¢ / 14¢ / 14¢ | 16 / 34 512 / 198 996 / 1 301 | 8 | `trelloSearch` ×3, `trelloReadCard` ×1 | `bash` ×3 (read-only `rg`/`grep` по `/mnt/memory`), `read` ×1 | task-management | 27.586 / 26.704 | 28.163 |
| C1 | 1¢ / 1¢ / 15¢ | 2 / 147 / 25 363 / 483 | 1 | 0 | 0 | — | 12.818 / 12.201 | 13.336 |
| C2 | 2¢ / 3¢ / 17¢ | 2 / 500 / 25 510 / 838 | 1 | 0 | 0 | — | 18.911 / 18.260 | 19.446 |
| D | 14¢ / 14¢ / **31¢** | 16 / 27 691 / 225 250 / 2 298 | 8 | `trelloReadMember`, `trelloReadWorkspace`, `trelloReadBoard` ×2, `trelloReadCard` (`list_by_board`) ×1 | `read` ×1, `bash` ×2 (read-only `rg -il`, `cat priorities.md`) | daily-planning | 39.630 / 38.888 | 40.214 |

Фінальний read-back: B 14¢, C 3¢, D 14¢, разом **31¢ = $0.31** з дозволених $1.20. Перевищення backstop немає. Вартість — це `usage.list_cost` Session у USD minor units, округлений до центів.

## 5. B — task ambiguity / lookup

**Prompt:** `Що там з роликом?`

**Visible final output** (останній `agent.message`; саме його доставляє runtime, R #32 final-only):

```text
Знайшов єдину картку, що підходить під "ролик" — **«Білі аромати 3D відео»** (проєкт Extract).

- Список: **Done**, позначена як завершена (dueComplete: true)
- Дедлайн був на 14.09
- Опис — лише посилання на технічне завдання, коментарів немає

Якщо мав на увазі не цю картку — уточни, яка саме.
```

**Interim `agent.message`** у primary stream. Final-only adapter його не доставляє, але в подіях він є:

```text
Треба знайти картку по "ролик" на Trello — пошук по ключовому слову.
```

**Tool evidence:**

- Memory (read-only): `rg -i "ролик" /mnt/memory/` дав лише список файлів; `grep` по `seqthera.md` і `rg -C3` по всій пам'яті повернули `(no output)`.
- `trelloSearch {"action":"search_cards","partial":true,"query":"ролик"}` → `totalCount 0`.
- `trelloSearch … "відео"` → 3 картки. Релевантна одна: `Білі аромати 3D відео`, list `Done`, `labels: []`, `due: null`, `dueComplete: null`, `lastActivityAt 2026-09-15T12:06:21.949Z`. Інші дві — `Чорні аромати 100 ML` і `Білі аромати 50 ML`. Search URL містить `is:open`.
- `trelloSearch … "video"` → `totalCount 0`.
- **Direct read**: `trelloReadCard {"action":"get","cardIdOrUrl":"…/6aa12fd66c0f2e4e24b458d1"}` → `name "Білі аромати 3D відео"`, `list.name "Done"`, `labels [{name "Extract"}]`, `due "2026-09-14T15:00:00.000Z"`, `dueComplete true`, `complete true`, `lastActivityAt "2026-09-15T12:06:21.949Z"`, `comments []`, desc = посилання «Технічне завдання».

**Grading (docs/41):**

| Критерій | Owner / правило | Доказ | Verdict | Cause |
|---|---|---|---|---|
| Current external facts | C «Search discovers… direct reads establish»; T direct-read | Done, завершена, Extract, due, опис і відсутність коментарів взято з **direct read** | PASS | — |
| Completion date з `lastActivityAt`/`dueComplete` | C factual semantics; T рядок 99 (прочитаний у ході) | Дати завершення немає. `dueComplete: true` названо як стан, не як час | PASS (docs/39 failure виправлено) | — |
| Activity = work | C | `lastActivityAt` не використано | PASS | — |
| Дата `14.09` | C «derive… local time only from… formatter» | `2026-09-14T15:00Z` = 18:00 Kyiv, та сама дата. Weekday і відносного часу немає | PASS | — |
| Extract candidate | docs/41 §5.2 | Підтверджено fresh search + direct read (label) | PASS | — |
| Clarification | C «one question, one sentence» | Одне умовне уточнення, не блокує відповідь, не просить обрати tool/board | PASS | — |
| Process narration | C «Never narrate your process» | Фінальний текст починається з «Знайшов…»: це результат, не хід процесу, але читається як search-opener. Interim-повідомлення «Треба знайти… пошук по ключовому слову» — справжня process narration, проте не доставляється | SOFT | explicit model noncompliance (interim); R захищає доставку |
| Technical noise | C «do not name tools» | `(dueComplete: true)` — сире ім'я поля в Telegram-тексті | SOFT | explicit model noncompliance (мінор) |
| «єдину картку» | discovery scope | Search шукає лише `is:open`; для відкритих карток твердження підтверджене | SOFT | — |
| Voice / Ukrainian | C | Природна, 5 рядків | PASS | — |
| Writes / end_turn | T, R | 0 writes, `end_turn` | PASS | — |

**B: PASS** (hard failures немає).

## 6. C — voice + continuity (одна Session)

**C1 prompt:** `Як краще організувати роботу, якщо я весь день скачу між клієнтами? Коротко.`

```text
Кілька принципів, які реально працюють при постійному перемиканні між клієнтами:

- Тайм-блоки під клієнта, а не список задач — виділяєш вікно (наприклад 45-90 хв) і в ньому працюєш тільки з одним контекстом, без стрибків.
- Буфер 10-15 хв між блоками — на перемикання голови й фіксацію, що зробив/що далі, інакше контекст губиться і ти повертаєшся туди ж по колу.
- Один "вхідний" список на все — усе, що прилітає під час дня (питання, ідеї, дрібні правки), кидаєш туди одразу, не обробляючи — розбираєш у виділений час, а не в моменті.
- В кінці кожного блоку — одна фраза для себе: що зроблено, що наступний крок. Це економить час на "згадати, де я зупинився" завтра.
- Найважче/найважливіше клієнтське завдання дня — в перший блок, поки є фокус, а не в кінці, коли вже "розмазаний" між усіма.

Якщо хочеш, можу розкласти конкретно твій сьогоднішній день по клієнтах з Trello — просто скажи.
```

**C2 prompt:** `Розпиши детальніше, чому саме так.`

```text
Ок, по пунктах — чому саме так, а не інакше.

**Тайм-блоки під клієнта.** Проблема мультиклієнтської роботи — не brak часу, а вартість перемикання контексту. Кожен раз, коли ти зіскакуєш з клієнта А на клієнта Б, мозку треба заново "завантажити" — хто це, на чому зупинились, які деталі важливі. Дослідження з context-switching стабільно показують: чим частіше перемикання, тим більше часу йде не на роботу, а на відновлення фокусу. Блок фіксованої довжини — це спосіб штучно обмежити кількість таких перемикань за день.

**Буфер між блоками.** Якщо стрибати з дзвінка одразу в дзвінок, мозок фізично не встигає "закрити" попередній контекст — і ти тягнеш шлейф думок про клієнта А в розмову з клієнтом Б. Буфер — це не відпочинок, це навмисна пауза на дозавантаження: записав підсумок, видихнув, відкрив наступний контекст свідомо, а не на автопілоті.

**Один вхідний список.** Без нього кожне дрібне прохання під час дня забирає рішення "робити зараз чи потім" — а це саме по собі перемикання контексту, навіть якщо задача займає 2 хвилини. Скинув у список — рішення відкладено на потім, увага лишається на поточному клієнті.

**Фіксація "де зупинився".** Це страховка від найдорожчого виду перемикання — коли завтра ти повертаєшся до задачі і 10 хвилин згадуєш, що взагалі робив. Одне речення зараз коштує дешевше, ніж реконструкція контексту завтра.

**Важке — в перший блок.** Фокус і робоча пам'ять — вичерпний ресурс за день, і кожне перемикання між клієнтами його підточує. До вечора, після кількох стрибків, ти вже не в найкращій формі для складного рішення — тому найважче ставиш туди, де фокус ще цілий.

Суть спільна: кожне перемикання коштує реальний час і увагу, тому мета — не усунути перемикання (це неможливо з кількома клієнтами), а зробити кожне з них максимально дешевим і усвідомленим.
```

Tool evidence: жодних tool calls і Skill reads в обох ходах. Про поточний стан Trello відповіді нічого не стверджують.

| Хід | Критерій | Доказ | Verdict | Cause |
|---|---|---|---|---|
| C1 | `Коротко` (C: 6–8 рядків за замовчуванням; docs/41 без прихованого ≤3) | 8 рядків, 5 пунктів без есею. Проте стиснення помітно не видно: кожен пункт має пояснювальний хвіст («інакше контекст губиться…», «Це економить час…»), який можна прибрати. Відповідь не ігнорує запит, але й не скорочена | SOFT | legitimate latitude / model style |
| C1 | Conclusion first | Відкриття «Кілька принципів, які реально працюють…» — рамка, а не висновок | SOFT | — |
| C1 | Clarification | Питання немає; наприкінці пропозиція-наступний крок, відповідь не блокується | PASS | — |
| C1 | Числа | «наприклад 45-90 хв», «Буфер 10-15 хв» — рекомендації (docs/41 §4 дозволяє) | PASS | legitimate PM judgement |
| C1 | Мова / narration | Природна; «розмазаний» у лапках — розмовний регістр; malformed-слова (docs/39 «цьотижневий») немає | PASS | — |
| C2 | Continuity | Розгортає ті самі 5 пунктів C1 у тому ж порядку | PASS | — |
| C2 | Довжина | Довша відповідь, як і просили | PASS | — |
| C2 | Псевдонаукова **числова** певність | Твердження «1-2 години» з docs/39 зникло. «2 хвилини», «10 хвилин» — ілюстрації в гіпотетичних сценаріях | PASS | — |
| C2 | Непідтверджені загальні claims | «Дослідження з context-switching стабільно показують…» — посилання на дослідження без джерела, подане як встановлений факт; напрям узгоджується з поширеною switch-cost літературою. Також «мозок фізично не встигає…», «Фокус і робоча пам'ять — вичерпний ресурс за день» — спірна теза, подана як факт | SOFT (**межовий, на розгляд PO**) | explicit model noncompliance with C fact/judgement boundary; docs/41 hard gate сформульовано для *числових* claims |
| C2 | Mixed-language | `brak` (латиницею) і `context-switching` — порушення C «no… mixed-language phrasing». Розуміння не погіршують | SOFT | explicit model failure (мінор) |
| C2 | Зовнішні факти | Жодних | PASS | — |
| Обидва | end_turn / writes | `end_turn`, 0 | PASS | — |

**C1: PASS (soft). C2: PASS (soft, межовий пункт позначено).**

## 7. D — daily PM plan

**Prompt:** `У мене сьогодні мало ресурсу. Як би ти звузив день? Коротко.`

```text
Звужую до двох задач — решта чекає до кращого дня.

- **UI Fixs** (Cossack Labs) — вже в роботі, дрібні фікси не вимагають великого фокусу.
- **Підготувати Invoice** (Extract) — адмінка, підходить під низький ресурс.

Що свідомо відкладаю:
- **Career Page UI** — важча дизайн-задача, краще на день з більшим фокусом.
- **Брендбук** (due 25.09) — теж важка, але дедлайн близько, тому раджу хоч 20-30 хв сьогодні виділити, інакше завтра тисне сильніше.

Решта з "This week" (аромати, банери, мудборд) без дедлайну — чекає без ризику.

Це влаштовує, чи Брендбук теж прибрати на сьогодні?
```

**Tool evidence (fresh, у цьому ході):**

- `read /workspace/skills/daily-planning/SKILL.md`. У прочитаному тексті є рядки 27 («a Waiting card is not automatically Blocked, `lastActivityAt` does not show Daniel worked… a due date alone says nothing about spare capacity…») і 33 («**Do not equate no due date with low urgency.**»).
- Memory (read-only): `rg -il 'board|trello|project'` і `cat priorities.md`. Там довготривалі пріоритети: Cossack Labs high by default, Extract medium; «Current deadlines… always come from fresh Trello».
- `trelloReadMember get_me` (timezone `Europe/Kiev`), `trelloReadBoard list`, `trelloReadWorkspace list`, `trelloReadBoard list_by_workspace`.
- **Direct board read** `trelloReadCard {"action":"list_by_board", board Djonik}`. Картки, релевантні відповіді:

| Картка | list | label | due | lastActivityAt | desc |
|---|---|---|---|---|---|
| UI Fixs | In progress | Cossack Labs | null | 2026-09-23T11:12:36Z | порожній |
| Career Page UI | In progress | Cossack Labs | null | 2026-09-23T09:43:04Z | порожній |
| Підготувати Invoice | This week | Extract | null | 2026-09-21T13:17:18Z | порожній |
| Брендбук | This week | Extract | `2026-09-25T15:00:00.000Z` | 2026-09-21T13:16:14Z | порожній |
| Банер | This week | Extract | **null** | 2026-09-22T13:22:18Z | «Даня, нам треба ще один банер для ще однієї виставки😅 Це виставка у Львові, стенд буде такий самий, як був у Києві…» + ТЗ розмірів |
| Чорні аромати 100 ML, Білі аромати 50 ML, Крем для рук | This week | Extract | null | — | — |
| Мудборд, Футболка, RDAS, Хайлайт проджект відкрита | This week | Cossack Labs | null | — | — |
| Підтримка UI | This week | Limen | null | — | — |
| Діадіа; Зробити головну сторінку | Waiting | A1; Seqthera | null | — | — |

Стан дошки відрізняється від docs/39: наприклад, `Банер струм музей` тепер у Done. Тому D порівнюваний із docs/39 лише семантично, а не за вибором задач.

**Grading (docs/41):**

| Критерій | Owner / правило | Доказ | Verdict | Cause |
|---|---|---|---|---|
| Fresh evidence | D «Always read live Trello» | Board list + card list у ході | PASS | — |
| Activity = work/progress | C; D рядок 27 | `lastActivityAt` у відповіді не використано. «вже в роботі» спирається на list `In progress` | PASS (docs/39 failure виправлено) | — |
| Waiting ≠ Blocked | C; D рядок 27 | Waiting-картки не згадано, слово Blocked не вжито | NOT EXERCISED | — |
| Due present ≠ capacity / «не горить» | C «due is… not… enough time»; D рядок 27 | Брендбук: «дедлайн близько… раджу хоч 20-30 хв». «Запас є / не горить» (docs/39) немає. Due використано як сигнал терміновості, що D дозволяє («due dates and how soon they are»). «20-30 хв» подано як пораду | PASS | legitimate PM judgement |
| Дата `25.09` / «близько» | C derived-date rule | `15:00Z` = 18:00 Kyiv, та сама дата. «близько» — якісна оцінка без weekday і відносної дати | PASS | — |
| **No due → «чекає без ризику»** | **D рядок 33 «Do not equate no due date with low urgency» (прочитано в ході)**; C «never present a judgement as an established external fact»; docs/41 §3 Field semantics | «Решта з "This week" (аромати, банери, мудборд) без дедлайну — чекає без ризику.» Відсутність ризику виведена лише з `due: null` і подана як факт. При цьому fresh `Банер` desc містить клієнтський запит на банер для ще однієї виставки у Львові, тобто зовнішню, прив'язану до події потребу без дати в Trello | **HARD FAIL** | **explicit-instruction model failure** (+ true factual-grounding error). Не missing contract: правило було в Skill, прочитаному в ході |
| Client commitment | C «due… not… client commitment» | Due не названо зобов'язанням перед клієнтом | PASS | — |
| Fact vs judgement | C | «вже в роботі», «due 25.09», «без дедлайну» — факти з read. «дрібні фікси не вимагають великого фокусу», «важча дизайн-задача», «теж важка» — припущення з назв карток (desc порожні), подані без маркера припущення | SOFT | model style / evidence proportionality |
| Вибір підмножини | D «realistic subset» | 2 задачі + явне «що відкладаю і чому». Відкладення In-progress Career Page UI (Cossack Labs high by default) — PM-судження, обґрунтоване | PASS | legitimate PM judgement |
| `Коротко` | C, docs/41 §4 | ~9 рядків, без інвентаря дошки | PASS | — |
| Питання | C «ask only when it would change…»; D «only when it would materially change the plan» | «Це влаштовує, чи Брендбук теж прибрати на сьогодні?» — одне, не блокує, але не обов'язкове | SOFT | — |
| Мова | C | Природна. `due` англійською, «банери» у множині (відкритий один `Банер`) — мінор | SOFT | — |
| end_turn / writes | R, D «plan is not a mutation» | `end_turn`, 0 writes | PASS | — |

**D: HARD FAIL** (один пункт).

## 8. Zero-write evidence

- MCP calls (усі Sessions): `trelloSearch` ×3, `trelloReadCard` ×2, `trelloReadMember` ×1, `trelloReadBoard` ×2, `trelloReadWorkspace` ×1. `trelloWrite*` — **0**. Calendar toolset — **0** викликів (disabled).
- Built-in: `read` ×2 (лише `/workspace/skills/*/SKILL.md`), `bash` ×5 (`rg`, `grep`, `cat` по `/mnt/memory/djonik-memory`, read-only; mount `read_only`). `write`/`edit` — **0**. Memory writes — **0**.
- `agent.custom_tool_use` — **0**. `session.thread_created` — **0** (specialist не викликався). `user.interrupt` не знадобився.
- Agent v25, specialist v4 і всі чотири `latest_version_id` після smoke без змін. Serving/Telegram Session не зачіпались.

**External writes: 0.**

## 9. Порівняння з clean medium docs/39 (лише пряме)

| Сценарій | docs/39 (v24, prompt `fa361ed9…`) | Тепер (v25, prompt `3e204453…`) |
|---|---|---|
| B | «виконали 15-го» — completion date з `lastActivityAt`/`dueComplete`; «Знайшов…» | Дати завершення немає; поля з direct read; «Знайшов…» лишився як soft; нове технічне `dueComplete: true` |
| C1 | 5 пунктів + питання; `цьотижневий` | Та сама форма (5 пунктів), замість питання пропозиція; malformed-слова немає. Під docs/41 — soft |
| C2 | «деградує різко в перші 1-2 години» | Числового псевдонаукового claim немає; натомість нецитоване «Дослідження… стабільно показують» + `brak`, `context-switching` |
| D | «сьогодні вже торкався» (activity = work); «Waiting — блоковане»; «запас є, не горить» | Activity не використано; Waiting не згадано; due-картка трактується як близький дедлайн; **нове: no-due → «чекає без ризику»** |

**Чотири попередні семантичні помилки:**

1. Completion timestamp з activity — **виправлено** (B).
2. Activity = work/progress — **виправлено** (D, а також B).
3. Waiting = Blocked — **NOT EXERCISED**: D не згадав Waiting-картки. Регресії немає, але й підтвердження виправлення немає.
4. Due = spare capacity — **частково**. Полярність due-present виправлена: «запас є / не горить» немає. Та сама семантична родина повторилась дзеркально: «без дедлайну → без ризику». Це hard failure цього smoke.

## 10. Класифікація hard failure (для рішення PO)

- **Що:** D, одне речення: «Решта з "This week" (аромати, банери, мудборд) без дедлайну — чекає без ризику.»
- **Порушене правило:** `daily-planning` `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, рядок 33: «Do not equate no due date with low urgency». Модель прочитала цей Skill у тому ж ході (`read /workspace/skills/daily-planning/SKILL.md`). Додатково порушено C: «never present a judgement as an established external fact».
- **Категорія:** **(a) explicit-instruction model failure** плюс true factual-grounding error: картка `Банер` має fresh evidence про клієнтську виставку.
- **Не (b):** правило існує й було активне. Спостереження для PO: глобальний C-блок формулює due-семантику лише для присутньої дати (`A Trello due is… not… low urgency, risk…`). Полярність «немає due» живе тільки в D-Skill. Це асиметрія контракту, але не відсутність інструкції в цьому ході.
- **Не (c):** Project Health, composition і runtime не залучені.
- **Межовий пункт C2** (§6) — нецитоване загальне наукове твердження. Hard gate docs/41 прямо стосується *числових* claims. Якщо PO трактує «general claim» ширше, C2 стане другим hard-пунктом тієї ж категорії (a).

## 11. Soft observations (не блокують самі по собі)

- B: interim `agent.message` з process narration (не доставляється final-only adapter, але є в подіях); «Знайшов…» як opener; сире `dueComplete: true` у тексті.
- C1: помітного стиснення під «Коротко» немає; відкриття не є висновком.
- C2: `brak` (латиниця), `context-switching`; «фізично», «вичерпний ресурс» як факти; нецитоване «Дослідження…».
- D: припущення про розмір задач із назв без маркера; необов'язкове фінальне питання; `due` англійською; «банери» при одному відкритому `Банер`.
- Mixed-language/технічні токени трапились у 3 з 4 ходів (B `dueComplete`, C2 `brak`/`context-switching`, D `due`). Це повторюваний патерн проти явного C-правила, хоча кожен окремий випадок мінорний.

## 12. Наступний bounded step

**PRODUCT OWNER REVIEW REQUIRED** щодо класифікованого hard failure D (§10) і межового пункту C2. Автоматично нічого не робилось: prompt/Skill не редагувались, effort не підвищувався, повторів не було, Sonnet high не тестувався. Project Health composition / `specialist_only` лишається окремим невирішеним кроком #38 і в цьому smoke не розглядався. #38 не закрито, #33 не промотовано. Commit, push, deploy і GitHub comment не виконувались.

## 13. Проєкт коментаря для #38

> **#38 — contract-derived live smoke (2026-09-23): HARD FAIL (narrow), PO review required.** Frozen v25 (Sonnet 5 medium/standard, prompt `3e204453…b4b6`, Skills tm `skver_01CJQkVY…` / dp `skver_01EL7d3f…` / wp `skver_01Fdtnnk…` / si `skver_018sJv1G…`, specialist v4). Три незалежні Sessions з read-only Memory: B `sesn_015pyFLex524B9ASrk8fxHHP`, C `sesn_01AdHUP9u2gCjH5r9NU1MGkb`, D `sesn_01PbKLQFE5xYpSmsS5R62LLH`. Чотири ходи, усі `end_turn`, 0 writes, **$0.31** з $1.20. Оцінка за docs/41 ([docs/43](../docs/43_ISSUE_38_CONTRACT_DERIVED_LIVE_SMOKE.md)): B PASS (дати завершення з activity немає, поля з direct read), C1 PASS/soft, C2 PASS/soft (claim «1-2 години» зник; межове нецитоване «дослідження показують» + `brak`/`context-switching`), **D HARD FAIL**: «без дедлайну — чекає без ризику» порушує daily-planning «Do not equate no due date with low urgency», прочитаний у ході (explicit model failure; при цьому fresh `Банер` desc містить клієнтський запит під виставку). Activity-as-work і completion-date виправлені; Waiting=Blocked не перевірено; due-семантика повторилась у дзеркальній полярності. Prompt, Skills і effort не змінювались, повторів не було. #38 лишається NOW; PH composition — окремий крок; #33 не промотовано.
