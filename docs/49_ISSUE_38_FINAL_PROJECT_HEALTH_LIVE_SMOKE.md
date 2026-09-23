# #38 — фінальний live smoke Project Health (природний cue)

Дата: 2026-09-23. Canonical NOW: #38 ([docs/02](02_DEVELOPMENT_ROADMAP.md)).
- Контракт композиції: [docs/47](47_ISSUE_38_PROJECT_HEALTH_COMPOSITION_AUDIT.md) (рішення PO), [docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md) (F3).
- Rubric: [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md).
- Код під тестом: commit `1014c057c1c17ada35711c7cad23a6f00fa56c44` (`fix: make Project Health composition user-facing`). Local `HEAD == origin/main`, робоче дерево перед запуском чисте.

## 0. Висновок

**PASS.** Один pure-PH хід пройшов через реальний `connectToDjonik()` → `sendOrdered()`, тобто той самий шлях, що в Telegram-адаптері. Результат:
- нативне делегування канонічному спеціалісту v4;
- рівно один результат спеціаліста в цьому ж ході; дочірній і батьківський потоки завершились `end_turn`;
- текст координатора відрізнявся від результату спеціаліста, тому режим `coordinator_withheld`;
- видимо рівно `S + "\n\n———\n" + cue`: байти спеціаліста без змін, текст координатора не видно, старого технічного notice немає.

**$0.24**, 0 записів.

## 1. Мета

Перевірити лише межу runtime-композиції (F3) на live-потоці:
- делегування;
- provenance результату;
- точні байти S;
- приховання тексту координатора;
- відсутність старого notice і наявність нового cue;
- `end_turn`;
- нуль записів.

Планування, змішаний намір, записи, якість моделі та prompt не тестувались.

## 2. Frozen configuration (read-back до inference)

| Поле | Значення |
|---|---|
| Primary Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v25** (`updated_at 2026-09-23T11:53:10Z`), `name "Джонік"` |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| Prompt | 3529 B, SHA-256 `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6` (snapshot Session) |
| Skills (`latest` → resolved) | task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`; daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`; weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`; studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj` |
| Specialist (roster) | `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4**, `Djonik Project Health Specialist`, Sonnet 5 effort high, system `b4a50439…78a7` |
| Tools | SHA `9995f382…291c` (як у docs/43, docs/46) |
| Environment / vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| Memory | `memstore_01WViYK3WQvGEgojB2GiaDFq`, **`read_only`** (`sessionOptions.memoryAccess`) |
| Budget | `max_list_cost {amount "45", currency "USD"}` (`sessionOptions.maxListCostUsdCents`) |

**Session:** `sesn_01KBcYnkpka5aP8e9q3WqAWQ`. Нова, створена самим `connectToDjonik()`. Як і в Telegram, передано agent id рядком, тобто latest. Read-back підтвердив, що latest = v25.

Read-back gate до send: `idle`, **0 events**, 0 tokens, `list_cost 0`, v25, Sonnet 5 medium/standard, prompt SHA, roster = одна v4, Memory `read_only`, budget 45. Gate був кодовою умовою: при будь-якій розбіжності send не виконувався б.

Старі Sessions (docs/43, docs/46, probe, high, Telegram serving) не використовувались.

**Admission (docs/04 §27):** найгірший порівнянний PH-хід — 32¢ (docs/39 A, medium). Резерв 10¢, разом 42¢ ≤ 45¢ вільного залишку. Допущено. Повторів не було.

## 3. Prompt

```text
Як там Extract?
```

Передано як `sendOrdered([{ type: "text", text: "Як там Extract?" }])`.

## 4. Результат спеціаліста S (дослівно)

`agent.thread_message_received` на primary. 664 символи, SHA-256 `d49776b45f39b467c83d07f1b56f7e4ef8284a7ee1d67a41e40d0e3844b935d5`:

```text
По Extract зараз усе в нормальному робочому ритмі: три задачі стоять у списку «Цього тижня» — чорні аромати 100 мл, білі аромати 50 мл і крем для рук, — тобто робота по проєкту триває, явних блокерів чи задач, що когось чекають, я не бачу. У беклозі ще лежать банер і підготовка інвойсу — це звичайна черга, а не проблема. Єдине, що варто перевірити: картка «Брендбук» досі в беклозі, але має дедлайн у Trello, хоча в самому описі ти написав, що вона не в фокусі і береться в роботу тільки після завершення всіх задач по Extract — статус і дедлайн тут явно розходяться. Я б звірив, чи цей дедлайн ще актуальний, і якщо ні — прибрав його, щоб він не вводив в оману.
```

## 5. Текст координатора

**Проміжне** `agent.message` (14:40:37, до результату спеціаліста):

```text
Питаю в спеціаліста, зараз повернуся з відповіддю.
```

**Фінальний C** (14:41:26, SHA-256 `9420a88c…1183`, `C === S` → **false**):

```text
По Extract усе в робочому ритмі: три задачі активні в «Цього тижня» — чорні аромати 100 мл, білі аромати 50 мл, крем для рук. Блокерів немає.

У беклозі ще банер і підготовка інвойсу — звичайна черга, не проблема.

Є нестиковка: картка «Брендбук» у беклозі має дедлайн у Trello, хоча в описі сам написав, що вона не в фокусі і береться в роботу тільки після завершення всіх задач по Extract. Варто звірити, чи дедлайн ще актуальний — прибрати, якщо ні.
```

Переказ посилив твердження: «три задачі **активні**», «Блокерів немає» замість «явних блокерів… я не бачу». Runtime його не показав.

## 6. Режим композиції

Trace: `[{"type":"specialist_reply_composed","mode":"coordinator_withheld"}]`.

Жодних `specialist_result_unverified`, `late_events_quarantined`, `turn_incomplete` чи `write_unverified_failure`.

## 7. Видимий результат `connectToDjonik()` (дослівно)

SHA-256 `bc9e7029…fcd3`:

```text
По Extract зараз усе в нормальному робочому ритмі: три задачі стоять у списку «Цього тижня» — чорні аромати 100 мл, білі аромати 50 мл і крем для рук, — тобто робота по проєкту триває, явних блокерів чи задач, що когось чекають, я не бачу. У беклозі ще лежать банер і підготовка інвойсу — це звичайна черга, а не проблема. Єдине, що варто перевірити: картка «Брендбук» досі в беклозі, але має дедлайн у Trello, хоча в самому описі ти написав, що вона не в фокусі і береться в роботу тільки після завершення всіх задач по Extract — статус і дедлайн тут явно розходяться. Я б звірив, чи цей дедлайн ще актуальний, і якщо ні — прибрав його, щоб він не вводив в оману.

———
Якщо в цьому ж запиті було ще щось — напиши це окремим повідомленням.
```

## 8–11. Програмні перевірки видимого результату

| Перевірка | Результат |
|---|---|
| `reply === S + "\n\n———\n" + cue` | **true** |
| `reply.startsWith(S)` (точні байти S) | **true** |
| child `thread_message_sent` === primary `thread_message_received` | **true** |
| фінальний C у reply | **false** (не витік) |
| проміжне повідомлення у reply | **false** |
| фрагменти старого notice (`ℹ️`, «Джонік також сформував», «з подій не можна довести», «приховано») | **відсутні** |
| технічна лексика (`координатор`, `спеціаліст`, `coordinator`, `specialist`, `withheld`, `runtime`, `sthr_`, `sevt_`) | **відсутня** |
| cue рівно один раз, дослівно | **true** (1) |

## 12. Provenance спеціаліста

- Primary: `session.thread_created {agent_name "Djonik Project Health Specialist", session_thread_id sthr_01C9JT26xY7vxutPC22JDPaG}` о 14:40:35.094857, **після** anchor `user.message sevt_01MmbMvEj83PhPsiYydUaiha` (14:40:31). Одразу за ним `agent.thread_message_sent` на той самий thread.
- `threads.list`: рівно 2 thread-и:
  - primary `sthr_01Av2tcPFxAFMEyc2MT177Kg` → агент v25;
  - child `sthr_01C9JT26xY7vxutPC22JDPaG` (parent — primary) → `agent_01KNiQDzzPjaMU6LLF4mU6uM` **version 4**, Sonnet 5 high.

  Advisor або другого child-а немає.
- Рівно один `agent.thread_message_received` від канонічного імені й thread-а. Plain text, байт-у-байт дорівнює child `agent.thread_message_sent` (SHA `d49776b4…`).
- Задача делегування: «Daniel's question, as he asked it: "Як там Extract?" (How is Extract doing?) Please provide a project health review for the "Extract" project. Report back your findings/answer as given, based on evidence from Trello (or whatever sources you use).» Додана англійська обгортка, але фактичних припущень про Extract немає.
- Child thread (34 події):
  - `read` Skill `project-health/SKILL.md`;
  - спроба `read /mnt/memory/djonik-memory` (директорія → `is_error: true`);
  - `trelloSearch` ×2 (`search_boards`, `search_cards`), `trelloReadBoard list_labels`, `trelloReadCard list_by_board` (open, 50);
  - одне фінальне `agent.message` → `thread_message_sent` до primary.
- Доказовість S (свіжий `list_by_board` дочірнього агента, картки з label Extract, крім Done):
  - This week: Чорні аромати 100 ML, Білі аромати 50 ML, Крем для рук;
  - Backlog: Підготувати Invoice, Банер, Брендбук (`due 2026-09-25T15:00:00.000Z`, опис «Я з нею не спішу, вона не в фокусі. Як закінчимо всі задачі по Extract, можна буде брати цю в роботу»);
  - Waiting / In progress для Extract немає.

  Твердження S узгоджуються з цими даними.
- Soft (стиль спеціаліста, поза критеріями): «тобто робота по проєкту триває» виведено зі списку «This week», а не «In progress», тобто сформульовано трохи сильніше за докази.

## 13. `end_turn`

- Child: `session.thread_status_idle {agent_name "Djonik Project Health Specialist", stop_reason end_turn}` о 14:41:21.999.
- Primary thread після проміжного повідомлення тимчасово став idle (`thread_status_idle Джонік end_turn`, 14:40:37). **Session-level** `session.status_idle` тоді не було, бо child ще працював, і runtime правильно чекав.
- Parent: `session.status_idle {stop_reason end_turn}` о 14:41:26.275951. Це єдиний авторитетний кінець ходу; `sendOrdered` повернувся без помилки.

## 14. Zero-write evidence

- Tool uses (primary + child, за id): `read` ×2, `trelloSearch` ×2, `trelloReadBoard` ×1, `trelloReadCard` ×1.
  - `trelloWrite*` — **0**;
  - Calendar — **0** (toolset disabled);
  - built-in `write` / `edit` / `bash` — **0**;
  - `agent.custom_tool_use` — **0**.
- Memory mount `read_only`; Memory writes — **0**.
- Coordinator на primary: **0 tool calls** (telemetry `toolCalls 0`, `toolNames []`).
- Після ходу: Agent v25 (`updated_at` без змін), prompt SHA, tools SHA, specialist v4 (`b4a50439…`) і чотири `latest_version` без змін. Serving / Telegram Session не зачіпалась.

**External writes: 0.**

## 15. Вартість, латентність, виклики

| Метрика | Значення |
|---|---|
| List cost (Session, авторитетно) | **24¢ ($0.24)** з 45¢. Округлено по thread-ах: coordinator 8¢, specialist 15¢ |
| Input / cache-create / cache-read / output (Session) | 18 / 69 576 / 136 666 / 3 357 |
| Coordinator thread | 6 / 26 158 / 51 272 / 428; active 9.738 s |
| Specialist thread | 12 / 43 418 / 85 394 / 2 929; active 46.274 s |
| Model iterations | coordinator 3 (telemetry), specialist 6 |
| Active seconds (usage / stats) | 56.883 / 56.012 |
| Wall latency (`sendOrdered` → return) | **55.65 s** |
| MCP calls | 4 (усі в child): `trelloSearch` ×2, `trelloReadBoard` ×1, `trelloReadCard` ×1 |
| Built-in calls | 2 `read` (child) |
| Primary events | 23 |
| Child events | 34 |

## 16. Оцінка за критеріями PO

| # | Критерій | Результат |
|---|---|---|
| A | Нативне делегування канонічному спеціалісту v4 | PASS |
| B | Рівно один валідний результат у цьому ж ході | PASS |
| C | Результат доказовий і user-facing | PASS (soft: «робота триває» з This week) |
| D | Child завершився авторитетно | PASS |
| E | Parent завершився авторитетно | PASS |
| F | C ≠ S: прозу приховано, старого notice немає, cue дослівний | PASS |
| G / H | C == S / C == "" | не застосовно (C ≠ S) |
| I | Точні байти S | PASS |
| J / K / L | 0 записів у Trello / Memory / Calendar | PASS |
| M | Без змін Agent / Skill / prompt / model | PASS |

Hard fails не виявлено.

## 17. Готовність #38 до closeout

Останній гейт #38 — pure PH user-facing composition — пройдено live. Ordinary coordinator прийнято раніше (docs/46). **#38 технічно готовий до closeout**, після review Product Lead і рішення PO.

Закриття #38, промоція #33, commit, push і deploy **не виконувались**.
