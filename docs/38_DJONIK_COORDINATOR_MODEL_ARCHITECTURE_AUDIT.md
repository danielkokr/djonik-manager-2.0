# Djonik 2.0 — аудит моделі coordinator і модельної архітектури

Дата: 2026-09-23
Тип: **дослідження / architecture audit, decision-support**. Без змін production, Skills, source, без Sessions і платного інференсу.
Canonical NOW: [#38 — Voice and Telegram UX](https://github.com/danielkokr/djonik-manager-2.0/issues/38) (`docs/02`, рядок 61, єдиний NOW — підтверджено).
Останній коментар Product Lead у #38: зупинити prompt-only hardening на Haiku; наступний обмежений експеримент — той самий prompt/runtime/Skills, лише модель coordinator Haiku 4.5 → `claude-sonnet-5`, вимірювання якості й вартості, без зміни production. Цей аудит перевіряє, чи це правильний експеримент і як його зробити найменшим і найпереконливішим.

Позначки доказів:
- **[OUR]** — наші live-звіти в `docs/`;
- **[OFFICIAL]** — документація / engineering-пости Anthropic (для OpenAI — офіційні документи OpenAI);
- **[PROD]** — engineering-блог компанії про власний production;
- **[REPO]** — публічний репозиторій / документація open-source проєкту;
- **[COMMUNITY]** — анекдотичні спільнотні дописи;
- **[INF]** — мій висновок з наведених доказів.

---

## 1. Executive summary

**Що відбувається з Haiku.** Runtime Djonik здоровий і сам гарантує правильність: `end_turn`, provenance спеціаліста, verify-after-write, нуль небажаних записів. Провалюється саме **роль, яку виконує Haiku 4.5 як user-facing coordinator**. Це не одна помилка, а стійкий патерн у кількох issue [OUR]:
- **Точна ретрансляція спеціаліста.** 2 з 7 live-семплів передано точно. Під промптами #38 — 0 з 3, навіть після явного «exactly as received».
- **Дисципліна уточнень.** Непотрібне уточнення, 3 питання, 2 питання — попри «exactly one question».
- **Українська.** Русизми, неіснуючі слова, перехід на «ви». Проблема в 5 з 7 звичайних семплів #38 і посилилась після рядка «clean natural Ukrainian».
- **Негативні обмеження Skill.** «Не повторюй», «не рахуй дати», «не використовуй `lastActivityAt`» Haiku ігнорував і раніше: #28, #29, #36.

Prompt-ремедіація у docs/37 **не змінила жодного з трьох вимірів**. Це вичерпує дешевий prompt-важіль.

**Чи виправдано тестувати зміну моделі — так.** Внутрішні дані це підтримують:
- Той самий Sonnet 5 у ролі спеціаліста в тих самих Sessions писав чисту українську в 3 з 3 семплів.
- Hardening спеціаліста v3 → v4 спрацював з першої ітерації.

Зовнішні дані теж:
- Anthropic, Cognition і OpenClaw віддають планування, неоднозначність і розмову сильнішій моделі, а дешевшу ставлять на обмежені підзадачі.
- Anthropic прямо пише, що Haiku 4.5 підходить для «high-volume work with checkable outputs, not long agentic loops».

**Хто заслуговує live-бенчмарку:** лише **Sonnet 5 як coordinator на effort `low`**. Порівнювати з уже зібраними результатами Haiku з docs/36/37, без повторного прогону Haiku. Решта:
- **Sonnet 4.6** — не бенчмаркати. Він дорожчий за токен ($3/$15 проти $2/$10), старший, і Anthropic позиціонує Sonnet 5 як drop-in заміну.
- **Opus** — не зараз. Лише як умовний другий крок, якщо Sonnet 5 провалить саме мовну якість або судження.
- **Динамічний routing** — не будувати.
- **Project Health specialist** — залишити незалежно від моделі coordinator.

**Вартість.** Типовий день із Sonnet 5 coordinator орієнтовно у **~1.6–2.2 раза** дорожчий за Haiku, а не в 2.6–3.3 раза, як дає номінальна ставка. Причина — спеціаліст Project Health уже є Sonnet і його вартість не змінюється. Приблизно **+$8–15 на місяць** за теплого кешу. Якщо реальна Telegram Session здебільшого холодна (паузи > 5 хв), різниця може сягати **+$35/міс.** Це головна невизначеність вартості.

---

## 2. Поточна архітектура Djonik

```text
Telegram
 → thin Session client (src/telegramCli.ts → connectToDjonik() → sendOrdered())
 → Claude Managed Agent «Джонік» (production v21, claude-haiku-4-5-20251001, effort n/a, speed standard)
     ├─ Skills: task-management, daily-planning, weekly-planning, studio-intake (latest)
     ├─ Memory Store (durable context), Trello MCP (read + trelloWriteCard), Calendar disabled,
     │  agent_toolset_20260401 default-enabled
     └─ native multiagent roster → «Djonik Project Health Specialist» v4
          (claude-sonnet-5, effort high, Trello read-only + read, project-health Skill)
 → deterministic runtime:
     #31 mutation ledger + verify-after-write, #32 turn completion + composeWithSpecialist,
     #40 idempotent custom-tool continuation, #36 deterministic work-history block
 → один фінальний Telegram-рядок на завершений хід (#38 delivery boundary)
```

Джерела: `managed-agents/djonik.md`, `managed-agents/project-health-specialist.md`, docs/36 §6, docs/37 §7, `src/turnCorrelation.ts:280-323`.

Історія моделі coordinator [OUR]:
- До v14 production coordinator був **`claude-sonnet-5`, effort `low`** (docs/04 рядки 413, 559).
- v14 → v15: Product Owner навмисно перевів його на Haiku 4.5 (docs/13 §22). Обмежений regression gate: PASS, 3 Sessions, $0.16. Він **не** перевіряв голос, уточнення чи мовну якість.
- Причину переходу в репозиторії не записано. **[INF]** Найімовірніше — вартість: перехід стався одразу після cost-аудиту #16.
- **#28:** Project Health винесено в Sonnet-спеціаліста, бо Haiku стабільно помилявся в PM-судженнях (docs/01 §9).

Важливе уточнення для cost-моделі: базові вартості в docs/04 §3/§16/§21/§24 ($0.01–0.13 за хід) виміряно на **Sonnet 5 low**, а не на Haiku. Це найкращий доказ вартості Sonnet-coordinator у Djonik, який уже є.

---

## 3. Що доводить наш власний live-доказ

### 3.1 Runtime vs модель (жорстке розмежування)

| Гарантія | Хто її дає | Доказ |
|---|---|---|
| Авторитетний `end_turn`, без часткових відповідей | runtime #32 | docs/36 6/6, docs/37 4/4 [OUR] |
| Побайтна відповідь спеціаліста, приховування переказу coordinator | runtime #32 `composeWithSpecialist` | docs/36 B/C, docs/37 A [OUR] |
| Жодного успіху без прямого читання після запису | runtime #31/#37 ledger | docs/34 A: обидві мутації `verified` [OUR] |
| Одне виконання custom tool на id | runtime #40 | docs/32 [OUR] |
| Фактичний тижневий звіт побайтно | детермінований код #36 | docs/32 [OUR] |
| Лише фінальний рядок іде в Telegram | adapter #38 | docs/35/36 [OUR] |

**Не приписувати моделі** ці гарантії. **Не звинувачувати модель** у notice `coordinator_withheld`: notice — коректна поведінка runtime. Модель винна лише в тому, що notice спрацьовує, бо вона переказує замість повернути рядок.

### 3.2 Сильні сторони Haiku coordinator — FACT

| Що вдалося | Доказ |
|---|---|
| Нативне делегування Project Health канонічному спеціалісту: кожен PH-промпт у live-прогонах | docs/15 §42–48; docs/16 §26 (routing працював); docs/36 B, C; docs/37 A [OUR] |
| Вибір і коректний виклик custom tool `trello_work_history` (Extract, `last_week`, concise) | docs/32, $0.03 [OUR] |
| Повний цикл запису: labels → create → attach_label → пряме читання → успіх лише після перевірки | docs/34 A, $0.08 [OUR] |
| Жодного запису без якоря проєкту, одне уточнення | docs/34 B, $0.01 [OUR] |
| Базовий PM-regression gate (порада без запису, свіже читання, план дня/тижня, verified write, Memory recall) | docs/13 §22, $0.16 [OUR] |
| Немає процес-наративу у фінальній відповіді, філеру, обіцянок проактивності; сама модель не вигадувала факти в #38 | docs/36 §19.4, docs/37 §17 [OUR] |
| Адаптація довжини «коротко → розпиши» і безперервність у двох ходах | docs/36 E1/E2, docs/37 D1/D2 [OUR] |
| Пряма відповідь без зайвого уточнення (один семпл) | docs/37 D1 [OUR] |
| Дешеві звичайні ходи: $0.00–0.03 | docs/36/37 [OUR] |

### 3.3 Провали Haiku coordinator — FACT

**A. Точна ретрансляція спеціаліста (Project Health)**

| Семпл | Промпт coordinator | Результат |
|---|---|---|
| docs/15 §42 | v19, «output exactly» | точно (exact) |
| docs/15 §44 | v18 | не точно: пропущено абзац |
| docs/15 §46 | v19 | не точно: переписано в список, з відліком днів, вигаданим ризиком і зайвими кроками |
| docs/15 §48 | v19 | точно (exact) |
| docs/36 B | #38 `bb755be` | `coordinator_withheld` |
| docs/36 C | #38 `bb755be` | `coordinator_withheld` |
| docs/37 A | #38 `2c6006b`, «exactly as received: add, remove, reword… nothing» | `coordinator_withheld` |

- **Разом: 2/7 точно; 0/3 на промптах #38.**
- Незалежних Sessions: 7.
- Посилення промпту **не змінило поведінку**, що підтверджує docs/37 §24.
- У прихованому переказі Haiku щоразу є **власна арифметика дат**: «це через 2 дні», «За два дні». Цю помилку #28 якраз і прибрав з відповідальності coordinator.

**B. Дисципліна уточнень**

| Семпл | Результат |
|---|---|
| docs/36 A «як би ти звузив день?» | непотрібне уточнення замість відповіді, до того ж про дошку, яка одна |
| docs/36 D «Що там з роликом?» | 3 питання, одне з них Djonik міг перевірити сам |
| docs/37 C (той самий промпт, «exactly one question») | 2 питання, одне граматично зламане |
| docs/34 B | 1 уточнення (PASS) |
| docs/37 D1 | пряма відповідь (PASS) |
| docs/15 §26 | попросив Daniel замість того, щоб знайти label |
| docs/13 #26 E | створив картку не в тому проєкті (неоднозначність) |

Прямий повтор того самого промпту до і після ремедіації: 3 → 2 питання. Нижче порогу.

**C. Мовна якість (українська)**

| Семпл | Приклади |
|---|---|
| docs/36 D | «Не мам», «рольк» |
| docs/36 E1 | SOFT: «майлю», «скаканні» |
| docs/36 E2 | «большие», «один из них», «теряєш», «беручий», «устатковується», обірване речення |
| docs/37 C | «яким роликом ти маєш на увазі», «проект» |
| docs/37 D1 | «запихаютьсявас у екстрені», «непечені справи», «не мідаючи», перехід на «ви» |
| docs/37 D2 | «мозг», «скончив», «помилюєшся», «маються проблеми», «скаканння» |
| docs/32 | «Мінулого» замість «Минулого» |

- Звичайних семплів #38 на Haiku — 7 (36 A, D, E1, E2; 37 C, D1, D2). Матеріальні мовні вади — у 5 з 7, ще один SOFT.
- Після рядка промпту «Clean, natural Ukrainian… no Russianisms» стало **гірше**: 3/3 семпли docs/37.
- **Внутрішній контроль [OUR]:** у тих самих Sessions Sonnet-спеціаліст (docs/36 B, C; docs/37 A) дав природну українську в **3/3** семплах. Мовна вада належить моделі coordinator, а не Memory, Skills чи мовному контексту Sessions.

**D. Негативні обмеження Skills і PM-судження (поза #38)**

| Issue | Провал Haiku |
|---|---|
| #28 (docs/15 §26/§28) | Waiting без доказу, «через 6 днів» / «в пʼятницю», `lastActivityAt` як прогрес, «критичний дедлайн» → рішення винести PH у Sonnet |
| #29 (docs/16 §26/§31) | вигадана хронологія «остання замкнена», UTC подано як місцевий час, помилки підрахунку, 12 карток у відповідь на «коротко» → Haiku не прийнято |
| #36 (docs/32) | повторив детермінований звіт, хоча Skill прямо забороняє |
| #27 | пропустив явно запитаний рядок provenance |

### 3.4 Скільки незалежних семплів і чи міняв промпт поведінку

| Вимір | Незалежних семплів на промптах #38 | Змінився після `2c6006b`? |
|---|---|---|
| Точна ретрансляція | 3 (плюс 4 історичні на v18/v19) | ні |
| Одне питання | 2 прямих (36 D, 37 C) + 1 дотичний (36 A) | ні (3 → 2 питання) |
| Українська | 7 звичайних | ні, погіршилось |

**Висновок [INF]:** n на вимір мале (2–7), але напрямок узгоджений у трьох незалежних вимірах, двох промптах і кількох issue. Контроль «Sonnet у тій самій Session» відділяє модель від середовища. Цього достатньо, щоб **обґрунтувати тест моделі**. Цього недостатньо, щоб **без тесту змінювати production**.

### 3.5 Що Sonnet 5 уже показав у Djonik (FACT, обидва боки)

| Роль | Добре | Погано |
|---|---|---|
| Coordinator (production до v15, effort low; docs/04) | стабільні factual lookups, правильна дата в Kyiv-часі (§21) | вартість $0.01–0.13 за хід; голос не валідувався |
| Coordinator-діагностика #28 (docs/15 §29/§30, effort за замовчуванням, тобто high) | не повторив жодної домінантної помилки Haiku: дати, Waiting, `lastActivityAt`, ризик | вигадав людину «Анна», перелічував картки, одного разу не зробив свіжого читання (#18 — обмеження платформи); 3.3× вартості Haiku в тому самому сценарії |
| PH-спеціаліст v3 → v4 (docs/15 §44–48) | після одного раунду hardening — точна форма, без нотаток, одна наступна дія, чиста українська (docs/36/37 3/3) | v3 додавав технічну нотатку для coordinator, помилку підрахунку і вигаданого виконавця |

**[INF]** Sonnet 5 — не «безпомилкова» модель. Але його хиби **виправлялись промптом**, а хиби Haiku в цій ролі — ні. Саме цю властивість має перевірити бенчмарк.

---

## 4. Поточний ландшафт моделей Claude (перевірено 2026-09-23)

Джерела: [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model), [What's new in Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5), [Sonnet 5 announcement](https://www.anthropic.com/news/claude-sonnet-5), [Haiku 4.5 announcement](https://www.anthropic.com/news/claude-haiku-4-5) [OFFICIAL].

| Модель | ID | Статус | Input / Output $/MTok | 5m write / 1h write / cache read | Контекст / max out | Токенайзер | Примітки |
|---|---|---|---|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` (`-20251001`) | Active | $1 / $5 | $1.25 / $2 / $0.10 | 200K / 64K | старий | найшвидша; `effort` не підтримується; thinking лише через `budget_tokens` |
| Sonnet 4.6 | `claude-sonnet-4-6` | Active (попереднє покоління) | $3 / $15 | $3.75 / $6 / $0.30 | 1M / 128K | старий | adaptive thinking вимкнено за замовчуванням |
| **Sonnet 5** | `claude-sonnet-5` | Active, реліз 2026-06-30 | **$2 / $10** (стандарт; скасоване підвищення до $3/$15 з 1 вересня) | $2.50 / $4 / $0.20 | 1M / 128K | новий, ~30 % більше токенів | adaptive thinking on за замовчуванням; effort low…max, default high; без Priority Tier |
| Opus 5.5 | `claude-opus-5-5` | Active; docs: «Most workloads start with Claude Opus 5.5» | $4 / $20 | $5 / $8 / **$0.20** (0.05×) | 1M / 128K | новий | thinking вимкнути неможливо; effort default `medium`; forced `tool_choice` → 400 |
| Opus 5 | `claude-opus-5` | Active | $5 / $25 | $6.25 / $10 / $0.50 | 1M / 128K | новий | thinking on за замовчуванням |
| Fable 5.1 | `claude-fable-5-1` | Active, найпотужніша | $10 / $50 | $12.50 / $20 / $0.25 | 1M / 128K | новий | поза межами Djonik |

Managed Agents [OFFICIAL]:
- Токени тарифікуються за ставкою моделі кожного thread. Session runtime коштує $0.08 за session-hour у статусі `running` — для Djonik це частки цента за хід.
- `model` задається на Agent. Об'єкт `{id, effort, speed, inference_geo}` підтримує «All Claude 4.5+ models».
- **`effort` у session override не застосовується.** Щоб змінити effort, потрібен окремий Agent (bundled `claude-api` skill, `managed-agents-core.md` § Effort). Це прямо впливає на дизайн бенчмарку (§20).
- Session override моделі діє на coordinator і його `self`-копії, **але не на roster-агентів**. Спеціаліст v4 лишається Sonnet 5 / high незалежно від override.
- Модель і system фіксуються на час створення Session (docs/17, посилання на Session operations).

Орієнтири швидкості [OFFICIAL]:
- Haiku 4.5 «4-5 times faster than Sonnet 4.5» — дані жовтня 2025.
- Прямого офіційного порівняння швидкості Sonnet 5 і Haiku 4.5 я не знайшов. **Для Djonik це невідомо, латентність треба виміряти.**

Позиціонування [OFFICIAL]:
- Матриця вибору: Sonnet 5 — «everyday coding, agent, and enterprise workloads… agentic tool use».
- Haiku 4.5 — «Real-time applications, high-volume intelligent processing… sub-agent tasks».
- Посібник з вартості в bundled `claude-api` skill про Haiku 4.5: «fits high-volume work with checkable outputs, not long agentic loops».

---

## 5. Патерни coordinator vs worker

| Патерн | Хто сильніший | Коли підходить (за джерелами) |
|---|---|---|
| **A. Дешевий router → сильні worker'и** | worker | класифікація/triage з однозначними класами. OpenAI Agents SDK: «a smaller, faster model for triage, while using a larger, more capable model for complex tasks» [OFFICIAL]. Anthropic «Building effective agents»: routing easy→Haiku, hard→Sonnet [OFFICIAL] |
| **B. Сильний coordinator → дешевші/вузькі worker'и** | coordinator | планування, неоднозначність, синтез, фінальне рішення. Anthropic Research (Opus lead), Cognition Fusion (frontier «keeps ownership of planning, ambiguity, and final review»), Claude Code `opusplan`, Managed Agents docs [OFFICIAL/PROD] |
| **C. Executor + advisor** | advisor (консультує) | серійна робота з рідкими «важкими місцями»; не окупається, коли advisor потрібен майже щоразу [OFFICIAL] |
| **D. Один агент (single-threaded)** | — | залежний ланцюг, одна спільна історія. Cognition «Don't build multi-agents» [PROD]; Anthropic: «When the work is one dependent chain… the coordinator's model alone at lower effort came out ahead» [OFFICIAL] |
| **E. Спеціаліст-межа (не заради вартості)** | за потребою ролі | ізоляція контексту, окремі права інструментів, provenance. Так побудований Djonik PH: це не fan-out і не економія, а межа коректності й авторитету |

**[INF]** Патерн A у джерелах — це **класифікатор**, який не говорить з людиною. Coordinator Djonik не такий: він сам говорить з Daniel, володіє голосом, уточненнями, судженням і безперервністю. Ролі Djonik відповідає патерн B/E, а не A.

---

## 6. Як Anthropic будує власні multi-agent системи

| Система | Lead / coordinator | Worker'и | Чому / що виміряно | Джерело |
|---|---|---|---|---|
| Research (Claude.ai) | Opus 4 | Sonnet 4 subagents | +90.2 % проти single-agent Opus 4; токени пояснюють 80 % дисперсії (BrowseComp); «upgrading to Claude Sonnet 4 is a larger performance gain than doubling the token budget on Claude Sonnet 3.7»; multi-agent ≈ 15× токенів чату; погано підходить для задач зі спільним контекстом і багатьма залежностями | [Engineering, 2025-06-13](https://www.anthropic.com/engineering/multi-agent-research-system) [OFFICIAL] |
| Managed Agents — канонічні приклади | Opus 5 lead | Haiku 4.5 для читання/пошуку або Sonnet 5, «when the worker needs more judgment» | «The large model spends its tokens on planning, checking, and synthesis; the small model does the bulk reading» | bundled `claude-api` skill → `managed-agents-multiagent.md`; [платформна сторінка](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) [OFFICIAL] |
| Advisor у Managed Agents | Sonnet 5 executor | Opus 5 advisor | консультації лише з primary thread | там само [OFFICIAL] |
| Виміряні multi-model стратегії | Fable 5.1 coordinator | 25 × Sonnet 5 | −47–55 % вартості, −10–12 п. точності, 2.3 год замість 15–20 год; на повному BrowseComp економіка розвернулась; «Sweep effort on your current model first… most workloads end there» | [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) [OFFICIAL] |
| Claude Code `opusplan` | Opus у plan mode | Sonnet на виконанні | «Opus for plans and Sonnet for everything else» | [Model configuration](https://code.claude.com/docs/en/model-config) [OFFICIAL] |
| Claude Code subagents | головна розмова | `model:` sonnet/opus/haiku/inherit. Built-in **Explore більше не на Haiku**: «As of v2.1.198, Explore inherits the main conversation's model instead of always running on Haiku» | [Subagents](https://code.claude.com/docs/en/sub-agents) [OFFICIAL] |
| Haiku 4.5 launch | Sonnet 4.5 | команда Haiku 4.5 | «Sonnet 4.5 can break down a complex problem into multi-step plans, then orchestrate a team of multiple Haiku 4.5s» | [News, 2025-10-15](https://www.anthropic.com/news/claude-haiku-4-5) [OFFICIAL] |

Спільне у власних системах Anthropic:
- **Жодна з них не ставить Haiku головною розмовною або плануючою моделлою.**
- Haiku — лише worker на читанні / паралельних підзадачах.
- Найсвіжіший сигнал навіть звужує роль Haiku: Explore у Claude Code перевели з Haiku на модель головної розмови.

---

## 7. Публічні реальні приклади

| # | Приклад | Coordinator / primary | Worker'и | Патерн | Чому (задокументовано) | Якість джерела |
|---|---|---|---|---|---|---|
| 1 | Anthropic Research, [2025-06-13](https://www.anthropic.com/engineering/multi-agent-research-system) | Opus 4 | Sonnet 4 | B | lead планує й синтезує, subagents паралельно шукають | Official |
| 2 | Claude Code `opusplan`, [docs](https://code.claude.com/docs/en/model-config) | Opus (план) | Sonnet (виконання) | B / фазовий | якість плану від Opus, вартість виконання Sonnet | Official |
| 3 | Claude Code subagents / Explore, [docs](https://code.claude.com/docs/en/sub-agents) | модель головної розмови | Explore: раніше Haiku, тепер inherit (cap Opus) | B → «same model» | причину зміни не розкрито; напрям — від дешевого worker'а | Official |
| 4 | Anthropic, measured multi-model, [docs](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) | Fable 5.1 / Opus 5 | Sonnet 5 / advisor Fable 5.1 | B і C | orchestrator окупається лише на fan-out понад одне context window; advisor — лише за рідких консультацій | Official (виміряно) |
| 5 | Cognition Devin Fusion, [2026-06-29](https://cognition.com/blog/devin-fusion) | frontier (Fable 5 / Opus 5 / GPT-5.6) | менший «sidekick» | B + динамічне перемикання на compaction | frontier володіє «planning, ambiguity, and final review»; звичайний router «over-fit», погано бачить складність з промпту і втрачає кеш | Production blog |
| 6 | Cognition «Multi-Agents: What's Actually Working», [2026-04-22](https://cognition.com/blog/multi-agents-working) | SWE-1.5/1.6 (швидкий слабший primary) | Sonnet 4.5 «smart friend» | C | **слабший primary не знає, коли ескалувати**: «The gap… was too wide in exactly the places that mattered… knowing when to escalate, knowing what to ask» | Production blog |
| 7 | Cognition «Don't Build Multi-Agents», [2025-06-12](https://cognition.com/blog/dont-build-multi-agents) | один агент | (опційно мала модель для стиснення історії) | D | спільний контекст; дії несуть неявні рішення | Production blog |
| 8 | OpenClaw — персональний асистент у Telegram/WhatsApp, [docs](https://docs.openclaw.ai/concepts/models) | «the strongest latest-generation model available to you» | `utilityModel` (Haiku 4.5 для Anthropic) на заголовки, narration, recaps | B | дешева модель лише на службові тексти, не на розмову | Public repo / docs |
| 9 | Aider architect mode, [docs](https://aider.chat/docs/usage/modes.html) | architect (o1 тощо) | editor (GPT-4o / Sonnet) | B / фазовий | «certain LLMs aren't able to propose coding solutions and specify detailed file edits all in one go» | Public repo |
| 10 | Shuttle.dev, [2025-10-23](https://www.shuttle.dev/blog/2025/10/23/using-haiku-4.5-agents) | Sonnet 4.5 (план, уточнення в користувача) | 3 × Haiku 4.5 (паралельні правки) | B | «Sonnet excels at figuring out what needs to be done» | Community (dev write-up) |
| 11 | OpenAI Agents SDK, [Models](https://openai.github.io/openai-agents-python/models/) | менша модель для triage | більша для складних задач | A | triage як класифікація | Official (інший вендор) |
| 12 | OpenAI «A practical guide to building agents», [guide](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) | — | — | методика | «build your agent prototype with the most capable model for every task to establish a performance baseline… then try swapping in smaller models» | Official (інший вендор) |
| 13 | LangGraph supervisor, [repo](https://github.com/langchain-ai/langgraph-supervisor-py) | not disclosed (фреймворк дозволяє будь-яку) | not disclosed | B (структурно) | спільнотні гайди радять frontier supervisor + дешевші worker'и ([приклад](https://www.buildmvpfast.com/blog/langgraph-supervisor-deep-agents-multi-agent-patterns-2026)) | Repo (модель не розкрита) + Community |

Що з цього випливає [INF]:
1. У задокументованих production-системах модель, що **володіє розмовою / неоднозначністю / фінальним рішенням**, стабільно сильніша за worker'ів. Протилежний патерн (A) описано лише для **triage-класифікаторів**.
2. Найближчий до Djonik публічний аналог — OpenClaw, персональний асистент у месенджері. Він ставить на розмову найсильнішу доступну модель, а Haiku — лише на службові тексти.
3. Cognition прямо описує провал нашого типу: слабший primary не знає, коли питати і що питати. Це збігається з провалами уточнень у docs/36/37.
4. Модельний склад комерційних продуктів (Cursor, Copilot, Notion AI тощо) публічно не розкрито. Я його **не домислюю**.

---

## 8. Дешевий vs сильний coordinator — для ролі Djonik

| Відповідальність coordinator Djonik | Потрібно | Haiku (наш доказ) |
|---|---|---|
| Розмова з Daniel, голос, природна українська | висока мовна якість | ❌ 5/7 |
| Інтерпретація неоднозначної мови, рішення «питати чи ні», одне питання | судження | ❌ 3 з 4 семплів #38 |
| Вибір Skill / делегування | маршрутизація | ✅ стабільно |
| Точна ретрансляція результату | буквальне виконання | ❌ 2/7 |
| PM-судження в звичайних відповідях | судження | ⚠️ PH уже винесено; поради загалом ок, але псевдоточні числа (docs/37 D2) |
| Безперервність | контекст | ✅ |
| Інструменти / verify-after-write | виконання | ✅ (runtime підстраховує) |

**Висновок [INF]:** Djonik-coordinator — не router. Він виконує частину роботи, для якої модель найважливіша: мова, уточнення, синтез. Haiku впевнено справляється з тим, що дешевий router має робити (вибір Skill / delegation), і провалюється на тому, що є «голосом» продукту. **Патерн B**: coordinator має бути достатньо сильним, а не обов'язково найсильнішим.

---

## 9. Sonnet 4.6 vs Sonnet 5

| Питання | Відповідь | Джерело |
|---|---|---|
| Чи Sonnet 4.6 ще розумний вибір для нового production? | Ні. Статус Active, але це попереднє покоління; Anthropic подає Sonnet 5 як «drop-in upgrade for Claude Sonnet 4.6» | [What's new in Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5) [OFFICIAL] |
| Дешевший чи дорожчий? | **Дорожчий за токен:** $3/$15 проти $2/$10. Sonnet 5 дає ~30 % більше токенів на той самий текст, тож реальна перевага менша, але за оцінкою Sonnet 5 все одно на ~13 % дешевший за вхід ($2 × 1.3 = $2.6 проти $3) і так само за вихід. Точна різниця залежить від навантаження | [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) [OFFICIAL], [INF] |
| Чи Anthropic рекомендує Sonnet 5 як наступника? | Так: «capability upgrade over Claude Sonnet 4.6 at a lower price»; менше галюцинацій і підлабузництва | [OFFICIAL] |
| Поведінкові причини обрати 4.6? | Sonnet 5 «interprets instructions more literally» і «more agentic by default… reaches for tools and self-verification loops more readily». Друге може додати викликів інструментів і вартості; перше, імовірно, **допомагає** точній ретрансляції. Adaptive thinking у 5 увімкнено за замовчуванням, у 4.6 — ні | bundled `claude-api` skill, migration guide [OFFICIAL] |
| Сумісність з Managed Agents? | Обидві підтримуються («All Claude 4.5+ models»); різниці в multiagent/roster не знайшов | [OFFICIAL] |
| Чи варто Djonik бенчмаркати 4.6? | **Ні.** 4.6 дорожчий, старший і з поточним Djonik ніколи не валідувався. Sonnet 5 уже працює в Djonik як спеціаліст і колишній coordinator. Бенчмарк 4.6 додав би вартість і змінну без правдоподібного виграшу | [INF] |

**Рішення:** Sonnet 4.6 домінований → Architecture D з бенчмарку прибрати.

---

## 10. Чи має Sonnet 5 обслуговувати і coordinator, і PH-спеціаліста?

«Одна модель двічі» ≠ надлишковість. Спеціаліст дає цінність не через модель:

| Цінність спеціаліста | Залежить від моделі coordinator? |
|---|---|
| Окремий, свіжий контекст (не тягне довгу Telegram-історію; промпт: попередні ходи — не доказ) | ні |
| Лише Trello read + `read`, жодних записів | ні |
| Власний прийнятий Skill `project-health` (v4, прийнятий у #28) | ні |
| Межа provenance: `thread_message_sent` == `received` → #32 показує рядок побайтно | ні |
| Незалежна версіонованість і pin у roster | ні |

| Варіант | Коректність | Вартість PH-ходу | Складність / аудит | Оцінка |
|---|---|---|---|---|
| **1. Sonnet 5 coordinator + Sonnet 5 PH (v4)** | прийнятий #28/#32 шлях без змін; coordinator лише ретранслює | ≈ поточна + $0.01–0.05 на coordinator | без змін | **рекомендовано** |
| 2. Sonnet 5 coordinator сам робить PH | потрібна повторна валідація #28; втрачається provenance, #32 стає нерелевантним; Sonnet-coordinator у #28 вигадав «Анну» і перелічував картки | ~ та сама або менша (без handoff) | знімає прийняту межу; треба повністю перевалідувати | не зараз |
| 3. Sonnet 5 coordinator + дешевший PH worker (Haiku) | **спростовано #28**: Haiku стабільно помилявся в PH-судженнях | −$0.10–0.15 на PH-хід | — | відхилено |

---

## 11. Чи потрібен PH-спеціаліст, якщо coordinator — Sonnet? (Architecture F)

**Так, наразі потрібен.** Причини [OUR]/[INF]:
- Спеціаліст вводився через слабкість Haiku, але прийнятий як межа коректності й authority (#28 §47/§48, #32). Ці властивості не залежать від моделі.
- Офіційне «orchestrator pays for a plan, a handoff, and a merge that a single model gets for free» стосується **економіки**, а PH-межа — не про економію. Можлива економія F — ~$0.01–0.05 на PH-хід (ретрансляція coordinator), приблизно $0.3–1 на місяць. Ризик — повторне приймання #28 і вищий ризик вигаданих сутностей у довгому контексті.
- Питання F варто переглянути лише **після** даних бенчмарку, і лише якщо з'явиться вимірюваний біль (латентність PH-ходу, подвійна вартість).

Окремо, не модельне і не для реалізації тут:
- Навіть сильніша модель, від якої вимагають «повернути рядок побайтно», лишається LLM-ехо.
- Якщо Sonnet 5 теж переказуватиме, дешевша за модельну зміну альтернатива — щоб coordinator після делегування **не писав нічого**. Тоді спрацьовує режим `specialist_only` у `composeWithSpecialist`, без notice.
- Це рішення Product Lead поза межами цього аудиту.

---

## 12. Можлива майбутня роль Haiku 4.5

Офіційні підходящі ролі:
- sub-agent задачі;
- high-volume / real-time;
- «checkable outputs»;
- у OpenClaw — `utilityModel` для службових текстів.

У поточному roadmap Djonik (#33 → #34 → #39 → #35) **немає задачі, що зараз потребує Haiku**:
- #36 зробив тижневу історію детермінованою;
- #39 має знаходити винятки детермінованим кодом (docs/25 §5);
- масового паралельного читання в Djonik немає.

Потенційні майбутні ролі — лише при вимірюваній потребі:
- обмежена екстракція / класифікація з перевірним результатом, наприклад «чи варто турбувати» над детермінованими сигналами #39 — і лише якщо Sonnet там виявиться зайвим за вартістю;
- дешевий background-triage.

**Не вигадувати архітектуру, щоб зберегти Haiku.** Якщо бенчмарк підтвердить Sonnet 5, Haiku просто не використовується, доки не з'явиться вимірювана потреба.

---

## 13. Opus як coordinator?

| Питання | Оцінка |
|---|---|
| Чи Opus суттєво покращить Djonik порівняно з Sonnet 5? | Невідомо; для щоденного PM-чату з короткими ходами — **навряд чи пропорційно** [INF]. Sonnet 5 «approaches Opus 4.8» [OFFICIAL] |
| Вартість | Opus 5.5: $4/$20, cache write $5, cache read $0.20 (як у Sonnet 5). Холодні чат-ходи — **~2× Sonnet 5**, теплі read-heavy — ~1.3–1.8× [INF з прайсу]. Opus 5: ~2–2.5× Sonnet 5 |
| Латентність | thinking на Opus 5.5 вимкнути неможливо, effort default medium; для Telegram-чату, імовірно, повільніше за Sonnet 5 low. Не виміряно |
| Публічні приклади Opus lead + Sonnet workers | так: Anthropic Research, `opusplan`, Managed Agents docs. Але це **fan-out / планування**, не розмовний асистент |
| Як дивитись на Opus | 1) **умовний другий крок бенчмарку**, лише якщо Sonnet 5 провалить мовну якість або уточнення; 2) можливий advisor (Sonnet 5 + Opus advisor) для рідкісних складних PM-рішень — поки немає виміряної потреби; 3) **не** основний production coordinator без даних |

---

## 14. Динамічний routing

| Варіант | Складність | Вигода для Djonik | Оцінка |
|---|---|---|---|
| A. Фіксований Sonnet coordinator | мінімальна | закриває виміряні провали, якщо бенчмарк підтвердить | **кандидат №1** |
| B. Фіксований Haiku + ескалація | висока: хто вирішує ескалацію? Cognition показав, що слабкий primary не знає, коли ескалувати | провал голосу у звичайних ходах лишається | відхилити |
| C. Sonnet + рідкісна Opus-ескалація (advisor roster) | низька-середня (нативний advisor) | немає виміряної потреби; advisor не окупається, коли потрібен майже щоразу | відкласти |
| D. Модель на рівні Skill / subagent | уже є (PH = Sonnet v4) | лише для нових спеціалістів з доведеною користю | зберегти принцип |
| E. Runtime model router | висока; порушує продуктову філософію (no intent router); модель фіксується на Session → перемикання = нова Session, втрата контексту й кешу; Cognition: routers «over-fit», погано бачать складність з промпту, втрачають кеш | немає | **відхилити** |

Офіційна порада збігається: «If you are unsure, don't build anything yet: Sweep effort on your current model first» [OFFICIAL].

---

## 15. Українська мова

| Що відомо | Сила доказу |
|---|---|
| Наш live-доказ: Haiku coordinator — матеріальні мовні вади в 5/7 звичайних семплів #38; Sonnet 5 (спеціаліст) — 3/3 чисто в тих самих Sessions | **сильний, але малий n**; головний доказ [OUR] |
| Anthropic Multilingual: таблиця для Sonnet 4.5 / Haiku 4.5 (MMLU, перекладений людьми). **Української в таблиці немає** | [OFFICIAL], непрямий |
| У тій таблиці розрив Haiku і Sonnet зростає зі зменшенням ресурсності мови: французька 95.7 проти 97.5, бенгальська 90.4 проти 95.4, суахілі 78.3 проти 91.1 | [OFFICIAL]; для української — лише **[INF]**: напрям узгоджується з нашими даними |
| Для Sonnet 5 публікують SWE-bench Multilingual (мови програмування) — до розмовної української не стосується | нерелевантно |
| Українські бенчмарки: ZNO-Eval (2025; Claude 3 Opus), [lang-uk leaderboard](https://github.com/lang-uk/ukrainian-llm-leaderboard) (Claude не включено), [ukrainian-llm-eval](https://github.com/learn-ukrainian/ukrainian-llm-eval) (у розробці). **Поточних даних про Claude 4.5/5 немає**; MMLU-подібні тести не вимірюють русизми чи природність розмови | **слабкий / відсутній** [REPO] |

**Висновок:** зовнішній доказ про розмовну українську поточних моделей **слабкий**. Рішення має спиратися на наш бенчмарк. Мовну якість має оцінювати **Daniel як носій мови**: LLM-оцінювач тут ненадійний [INF].

---

## 16. Порівняння архітектур для Djonik

Шкала: ✅ сильна, ⚠️ невідомо / змішано, ❌ виміряна слабкість. «Виміряно» = [OUR], інше — [INF].

| Вимір | A: Haiku + S5 PH (поточна) | B: S5 + S5 PH | C: S5 + дешевші subagents + S5 PH | D: S4.6 + S5 PH | E: Opus + S5 PH | F: один S5 без PH |
|---|---|---|---|---|---|---|
| 1. Природна українська | ❌ виміряно | ⚠️ очікувано ✅ (S5 3/3 як спеціаліст) | як B | ⚠️ не валідувався | ⚠️ очікувано ✅ | як B |
| 2. Виконання інструкцій | ❌ виміряно | ⚠️ гіпотеза ✅ (v3→v4 спрацював) | як B | ⚠️ | ⚠️ | як B |
| 3. Дисципліна уточнень | ❌ виміряно | ⚠️ тестувати | як B | ⚠️ | ⚠️ | як B |
| 4. PM-судження | ⚠️ (PH винесено через ❌) | ⚠️ очікувано краще (#28 A/B) | як B | ⚠️ | ⚠️ найвище | ⚠️ ризик «Анни» |
| 5. Безперервність | ✅ | ✅ очікувано | ✅ | ✅ | ✅ | ✅ |
| 6. Інструменти / оркестрація | ✅ | ✅ (прод до v15) | ✅ | ✅ | ✅ | ✅ |
| 7. Дисципліна делегування | ✅ виміряно | ⚠️ тестувати | ⚠️ більше рішень | ⚠️ | ⚠️ | n/a |
| 8. Точна ретрансляція | ❌ 2/7 | ⚠️ **ключовий тест** | як B | ⚠️ | ⚠️ | n/a (немає relay) |
| 9. Фактична надійність | ✅ (runtime) | ✅ (runtime) | ✅ | ✅ | ✅ | ⚠️ без межі #32 |
| 10. Латентність | ✅ найшвидша | ⚠️ повільніша, виміряти | ⚠️ | ⚠️ | ❌ імовірно найповільніша | ✅ менше handoff |
| 11. Вартість успішного ходу | ⚠️ дешево за хід, дорого за успіх | ⚠️ ×1.6–2.2 день / краща за успіх — гіпотеза | ≈ B | ❌ дорожче за B | ❌ ×2–3 від B | ≈ B трохи дешевше |
| 12. Кеш / економіка | ✅ | ⚠️ холодний кеш ×2.6 | ❌ більше кеш-namespace | ⚠️ | ❌ | ✅ |
| 13. Складність архітектури | ✅ без змін | ✅ одна змінна (модель) | ❌ нові агенти без потреби | ✅ | ✅ | ❌ ламає #28/#32 |
| 14. Запас на майбутнє | ❌ (~59 KB Skills переважно обходять слабкості моделі, docs/25) | ✅ | ✅ | ⚠️ стара модель | ✅ | ⚠️ |

- **C** не має зараз жодної підзадачі, яка виправдала б дешевший subagent (§12). Це архітектура «на виріст», яка суперечить правилу «не створювати Skills/subagents наперед».
- **D** домінований (§9).
- **E** — верхня межа, не наступний крок.
- **F** — відкласти (§11).

---

## 17. Модель вартості

### 17.1 Спостережувані вартості ходів [OUR]

| Тип ходу | Модель coordinator | Спостережено | Coordinator / specialist | Джерело |
|---|---|---|---|---|
| Простий, без інструментів | Haiku | $0.00–0.01 (37 C, D1, D2; 36 D, E1, E2; 34 B) | весь coordinator | docs/36 §24, docs/37 §21 |
| Простий, холодний кеш (18.8k write) | Haiku | $0.03 (36 A) | coordinator | docs/36 §24 |
| Read-heavy / запис + перевірка | Haiku | $0.03 (#36), $0.07 (#28 A), $0.08 (#37 A) | coordinator | docs/32, docs/15 §29.6, docs/34 |
| Project Health | Haiku | $0.21, $0.22, $0.21; найгірший $0.31 (§46) | coordinator $0.01–0.03 / specialist $0.18–0.21 | docs/36, docs/37, docs/15 §46 |
| Багатоходовий (2 ходи) | Haiku | $0.01–0.02 за Session | coordinator | docs/36 E, docs/37 D |
| Викид | Haiku + PH | $0.32 за два ходи, `budget_reached` | — | docs/16 §26 |
| Привітання, тепле / холодне (пауза 8 хв 49 с) | **Sonnet 5 low** | $0.01 / $0.08–0.09 | coordinator | docs/04 §16 |
| Factual lookup (дедлайн) | **Sonnet 5 low** | $0.02, $0.07–0.11 | coordinator | docs/04 §3, §21 |
| Daily planning | **Sonnet 5 low** | $0.09–0.13 | coordinator | docs/04 §3, §24 |
| PH-сценарій як coordinator зі Skill (full-board read) | **Sonnet 5, effort за замовчуванням** | $0.23 проти Haiku $0.07 (3.3×); холодний хід $0.17 без інструментів | coordinator | docs/15 §29/§30 |

Примітка: вимірювання Sonnet-епохи в docs/04 зроблено на більшій поверхні інструментів. Відтоді вимкнено Calendar (−28 % префікса) і три Trello-читання (−9 %), а промпт скорочено з 3.7 KB до 2.6 KB. Тож теперішній Sonnet-хід, імовірно, трохи дешевший [INF].

### 17.2 Номінальне співвідношення [OFFICIAL → INF]

Той самий текст, та сама кількість кроків:
- Sonnet 5 ≈ 2× ставка × ~1.3 токенайзер ≈ **2.6× Haiku**.
- Adaptive thinking на Sonnet 5 додає вихідні токени. На `low` effort — мало, на `high` — помітно: у #28 вийшло 3.3×.
- Opus 5.5 ≈ 2× Sonnet 5 на холодних / вихідних токенах і ~1× на cache read.

### 17.3 Оцінка вартості ходу для моделі (діапазони)

| Тип ходу | Haiku | Sonnet 5 (low) | Opus 5.5 (medium) |
|---|---|---|---|
| Звичайний (O), точкова / діапазон | $0.015 / $0.005–0.03 | $0.04 / $0.01–0.09 | $0.07 / $0.02–0.16 |
| Read-heavy (R) | $0.08 / $0.03–0.14 | $0.12 / $0.07–0.23 | $0.20 / $0.10–0.35 |
| Project Health (PH) = coordinator + specialist $0.18–0.28 | $0.23 / $0.21–0.31 | $0.27 / $0.22–0.36 | $0.30 / $0.23–0.40 |

### 17.4 Денні та місячні сценарії (22 робочі дні), RAW token cost

| Сценарій | Склад | Haiku / день | Sonnet 5 / день | Opus 5.5 / день | Haiku / міс. | Sonnet 5 / міс. | Opus 5.5 / міс. |
|---|---|---|---|---|---|---|---|
| Light | 10 O | $0.15 (0.05–0.30) | $0.40 (0.10–0.90) | $0.70 (0.20–1.60) | ~$3 (1–7) | ~$9 (2–20) | ~$15 (4–35) |
| Typical | 15 O + 2 R + 1 PH | $0.61 (0.35–1.04) | $1.11 (0.51–2.17) | $1.75 (0.73–3.50) | ~$13 (8–23) | ~$24 (11–48) | ~$39 (16–77) |
| Heavy | 30 O + 5 R + 3 PH | $1.54 (0.93–2.53) | $2.61 (1.31–4.93) | $4.00 (1.79–7.75) | ~$34 (20–56) | ~$57 (29–108) | ~$88 (39–171) |

Співвідношення в типовий день: Sonnet ≈ **1.8× Haiku**, а не 2.6–3.3×. Причина — PH-спеціаліст уже Sonnet і становить ~38 % вартості дня на Haiku.

**Чутливість — холодна довга Telegram Session.** Якщо майже кожен звичайний хід переписує в кеш 40–70k контексту (паузи > 5 хв; docs/04 §16, docs/15 §30.5):
- звичайний хід коштує ~$0.04–0.08 на Haiku, ~$0.10–0.20 на Sonnet 5, ~$0.20–0.40 на Opus 5.5;
- типовий місяць тоді ≈ **$25–30 (Haiku) / $55–70 (Sonnet 5) / $110–130 (Opus 5.5)**.

Це головна невідома. Розмір реальної serving Session і частку холодних ходів поки не виміряно (#33 ще не розгорнутий). Для Managed Agents я не знайшов задокументованого способу вибрати 1-годинний TTL кешу — це **не перевірено**.

### 17.5 Вартість УСПІШНОГО ходу

Позначимо p — частку ходів без жорсткої / матеріальної вади голосу.

- Звичайні ходи Haiku (#38, n = 7): лише 36 E1 чистий (SOFT), тобто **p ≈ 0.14** за суворої оцінки. Навіть поблажливо (без мови) — ~0.4.
- Sonnet 5 coordinator буде дешевшим за успішний хід, якщо `p_S > (c_S / c_H) × p_H ≈ 2.7 × p_H`:

| p_H (Haiku) | потрібна p_S для паритету |
|---|---|
| 0.14 (сувора, виміряна) | > 0.38 |
| 0.30 | > 0.80 |
| 0.40 (поблажлива) | > 1.0 — паритет за токенами недосяжний |

- **Приховані витрати провалу**, яких немає в таблиці:
  - Daniel перепитує: +1 хід, $0.015–0.05;
  - уточнювальні цикли;
  - notice у кожній PH-відповіді;
  - витрачена валідація — docs/36 + docs/37 разом коштували $0.71 і не дали прийняття;
  - головне — довіра до «колеги». У Telegram-асистента один незрозумілий абзац коштує більше, ніж кілька центів.
- **Висновок [INF]:** за наявних даних Sonnet 5 не обов'язково дешевший за успішний хід. Але різниця в абсолютних грошах — **~$0.5 на день** — дрібна порівняно з вартістю провалу голосу. Питання вирішує якість, яку треба виміряти.

---

## 18. Ризики / невизначеності

1. **Мале n.** Бенчмарк на 1 семплі на сценарій дає напрям, а не гарантію. Провал Haiku був систематичним, тож 2/2 PH і 4/4 звичайні без вад на Sonnet — сильний сигнал для наступного кроку (довший shadow / пілот), але не доказ для production.
2. **Точна ретрансляція може не пройти навіть на Sonnet.** Це LLM-ехо. Тоді проблема частково архітектурна (§11), а не модельна.
3. **Sonnet 5 «more agentic by default»** — може робити більше викликів інструментів (Memory `bash`, Skill reads), тобто вища вартість і латентність. Інструментарій coordinator `agent_toolset_20260401` default-enabled — окреме відкрите питання (docs/36 §27).
4. **Вигадані сутності.** Sonnet-coordinator у #28 вигадав «Анну». Рубрика бенчмарку має це ловити.
5. **Латентність Sonnet 5 у Telegram** не виміряна.
6. **Економіка холодного кешу** реальної serving Session (§17.4) — головна невідома вартості.
7. **Effort.** `low` відтворює колишній production (відома вартість), але може погіршити судження щодо уточнень. `medium` — дорожче. Session override effort не застосовується, тож потрібні окремі candidate Agents.
8. **Зовнішній доказ про українську слабкий** (§15).
9. **Ціни й доступність моделей можуть змінитися.** Сторінка pricing уже раз змінила план щодо Sonnet 5: підвищення 1 вересня скасовано.
10. **Контекст 200K у Haiku проти 1M у Sonnet 5.** Для довгої Telegram Session це запас на користь Sonnet, але поки не вимірювалось [INF].

---

## 19. Рекомендація

**Для наступного експерименту (не production):**

1. **Бенчмаркати рівно одну змінну: coordinator Haiku 4.5 → `claude-sonnet-5`, effort `low`.** Усе інше заморожено як у docs/37. Контроль — уже зібрані результати Haiku (docs/36/37) на тих самих промптах; Haiku повторно не запускати.
2. **Не бенчмаркати Sonnet 4.6** — домінований Sonnet 5 за ціною, поколінням і позиціонуванням Anthropic.
3. **Не бенчмаркати Opus зараз.** Opus 5.5 — лише умовний другий крок, окремою авторизацією, якщо Sonnet 5 провалить саме мовну якість або уточнення (а не точну ретрансляцію).
4. **Не будувати routing, ескалацію чи advisor.** Не додавати дешевших subagents.
5. **Залишити PH-спеціаліст v4 / Sonnet 5 без змін** за будь-якого результату coordinator.
6. **Haiku** — жодної ролі зараз; повернутись лише за вимірюваної потреби (§12).

Для рішення про production після бенчмарку:
- **PASS** → окрема авторизована промоція в межах #33 (pinned release) з вимірюванням реальної serving Session і частки холодних ходів.
- **FAIL на ретрансляції, PASS на мові / уточненнях** → Product Lead розглядає «coordinator мовчить після делегування» (`specialist_only`) як не модельну зміну.
- **FAIL на мові / уточненнях** → Opus 5.5 як другий arm, або переосмислення вимог.

---

## 20. Мінімальний live-бенчмарк (дизайн; НЕ виконувався)

### 20.1 Candidate і контроль

| Пункт | Значення |
|---|---|
| Candidate | **новий** тимчасовий Agent (не production, не `agents.update`), бо session override не застосовує `effort` |
| model | `{id: "claude-sonnet-5", effort: "low", speed: "standard"}` — відтворює production до v15 (docs/04) |
| system | committed тіло `managed-agents/djonik.md` @ `2c6006b`: **2572 B, SHA-256 `fa361ed9…817f`**, з перевіркою read-back байт-у-байт |
| Skills | 4 закріплені версії з docs/37 §10 |
| multiagent | coordinator → `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4** (= production) |
| MCP / tools | = candidate docs/37: усі шість `trelloWrite*` `enabled:false`, Calendar вимкнено; `agent_toolset_20260401` як у production (не змінювати — одна змінна) |
| Memory | production Store, `read_only` |
| Шлях | реальний `connectToDjonik()` → `sendOrdered()`, source `diagnostic`, нативний `max_list_cost` на Session |
| Контроль | docs/36 (`bb755be`) і docs/37 (`2c6006b`) — Haiku, ті самі промпти; для голосу головний контроль — docs/37 (той самий промпт) |

### 20.2 Сценарії (дослівно ті самі промпти)

Порядок fail-fast:

| # | Session | Промпт | Порівняння | Що вирішує |
|---|---|---|---|---|
| S1 | PH-1 | `Що зараз по Брендбуку Extract? Коротко.` | 37 A, 36 B | точна ретрансляція |
| S2 | Ambiguity | `Що там з роликом?` | 37 C, 36 D | рівно одне питання + мова |
| S3 | Voice, 2 ходи | `Як краще організувати роботу, якщо я весь день скачу між клієнтами? Коротко.` → `Розпиши детальніше, чому саме так.` | 37 D1/D2, 36 E1/E2 | мова, довжина, безперервність |
| S4 | PH-2 | `По Extract зараз є реальний ризик або блокер? Дай коротко, тільки головне.` | 36 C | друга незалежна ретрансляція |
| S5 | Direct answer | `У мене сьогодні мало ресурсу. Як би ти звузив день? Коротко.` | 36 A | непотрібне уточнення проти відповіді |

Максимум: **5 Sessions, 6 видимих ходів, 1 candidate Agent.**

### 20.3 Рубрика

- Використати V1–V12 з docs/36 §12 без змін.
- Жорсткі критерії PASS:
  1. S1 і S4: режим composition `exact` або `specialist_only`, **без notice**.
  2. S2: **рівно одне** питання, одним реченням, без питання про інструмент / джерело.
  3. S2, S3 (обидва ходи), S5: **нуль** неіснуючих слів, русизмів чи переходів на «ви». **Оцінює Daniel** як носій мови; валідатор лише фіксує цитати.
  4. S5: пряма PM-відповідь без непотрібного уточнення.
  5. Жодних вигаданих людей / сутностей / дат (урок «Анни»); кожен поточний факт підтверджено свіжим читанням у тому самому ході.
  6. Безпека: 0 записів у Trello / Memory / Calendar, авторитетний `end_turn` на кожному ході, production незмінний (нормалізований JSON `9fc062d1…bec1`).
- Метрики на кожен хід:
  - `list_cost`, розділений на coordinator / specialist (per-thread);
  - токени (input / cache create / cache read / output);
  - `modelIterations`;
  - кількість викликів інструментів (особливо built-in `bash`);
  - `active_seconds` і wall-clock від `sendOrdered()` до фінального рядка (латентність).

### 20.4 Бюджет і правила допуску (за docs/04 §27 і правилом worst-case)

| Хід | Компаратор (найгірший спостережений + Sonnet-надбавка coordinator) | Резерв | Потрібно до допуску |
|---|---|---|---|
| PH (S1, S4) | $0.31 + $0.05 = **$0.36** | $0.12 | $0.48 |
| Звичайний (S2, S3a, S3b) | $0.09 (Sonnet-low, холодний, docs/04 §16) | $0.08 | $0.17 |
| S5 (може читати Skill / Trello) | $0.13 (Sonnet-low daily planning, docs/04 §24) | $0.08 | $0.21 |

- Очікувана сума: ~$0.60–0.75.
- Найгірша сума: 2 × $0.36 + 3 × $0.09 + $0.13 ≈ **$1.12**.
- **Рекомендована стеля: $1.50** list cost. Backstop на Session: PH 45¢, звичайні 20¢, S3 кумулятивно 30¢.

### 20.5 Правила зупинки

1. Будь-який запис, помилка безпеки / цілі, `budget_reached` чи зміна production → **STOP** негайно.
2. Не допускати хід, якщо залишок < «потрібно» з §20.4. Результат тоді — **PARTIAL**, стелю не піднімати.
3. Якщо S1 дає `coordinator_withheld`, **продовжити** S2/S3 (незалежні виміри, дешеві). S4 запускати, щоб встановити частоту (1/2 чи 2/2): на відміну від docs/37, тут це нова модель, і частота змінює архітектурне рішення (§19).
4. Якщо S2 і S3 обидва провалюють мову → решту звичайних ходів можна пропустити (доказ достатній). Рекомендувати Opus 5.5 arm лише окремою авторизацією.
5. Повторів / retry немає. Другого candidate немає. Effort `medium` — лише окремою авторизацією.
6. Будь-яке «inconclusive» записувати як `inconclusive — additional spend requires Product Owner approval`.

### 20.6 Очікувані артефакти

- Звіт `docs/39_…` у стилі docs/36/37 (порівняльна таблиця Haiku ↔ Sonnet по кожному промпту).
- Candidate і Sessions не архівувати без авторизації.

---

## 21. Джерела

### Офіційні (Anthropic)

- Pricing — https://platform.claude.com/docs/en/about-claude/pricing (прочитано 2026-09-23: Sonnet 5 $2/$10 стандарт, підвищення до $3/$15 скасовано; ~30 % більше токенів на новому токенайзері; Managed Agents $0.08 / session-hour)
- Choosing the right model — https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Optimizing for cost and intelligence — https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- What's new in Claude Sonnet 5 — https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5
- Introducing Claude Sonnet 5 (2026-06-30) — https://www.anthropic.com/news/claude-sonnet-5
- Introducing Claude Haiku 4.5 (2025-10-15) — https://www.anthropic.com/news/claude-haiku-4-5
- How we built our multi-agent research system (2025-06-13) — https://www.anthropic.com/engineering/multi-agent-research-system
- Building effective agents (2024-12-19) — https://www.anthropic.com/engineering/building-effective-agents
- Multilingual support — https://platform.claude.com/docs/en/build-with-claude/multilingual-support
- Managed Agents multiagent orchestration — https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration (зміст звірено через bundled `claude-api` skill: `managed-agents-multiagent.md`, `managed-agents-core.md`, `models.md`, `cost-optimization.md`, `prompt-caching.md`)
- Claude Code subagents — https://code.claude.com/docs/en/sub-agents
- Claude Code model configuration (`opusplan`) — https://code.claude.com/docs/en/model-config

### Офіційні (інший вендор, лише як патерн)

- OpenAI, A practical guide to building agents — https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- OpenAI Agents SDK, Models — https://openai.github.io/openai-agents-python/models/

### Production engineering

- Cognition, Devin Fusion (2026-06-29) — https://cognition.com/blog/devin-fusion
- Cognition, Multi-Agents: What's Actually Working (2026-04-22) — https://cognition.com/blog/multi-agents-working
- Cognition, Don't Build Multi-Agents (2025-06-12) — https://cognition.com/blog/dont-build-multi-agents

### Публічні репозиторії / документація

- OpenClaw models — https://docs.openclaw.ai/concepts/models
- Aider chat modes / architect — https://aider.chat/docs/usage/modes.html
- LangGraph supervisor — https://github.com/langchain-ai/langgraph-supervisor-py
- lang-uk Ukrainian LLM leaderboard — https://github.com/lang-uk/ukrainian-llm-leaderboard
- ukrainian-llm-eval — https://github.com/learn-ukrainian/ukrainian-llm-eval
- ZNO-Eval — https://arxiv.org/abs/2501.06715

### Спільнота (анекдотично)

- Shuttle.dev, Launching an Army of Haiku 4.5 Agents (2025-10-23) — https://www.shuttle.dev/blog/2025/10/23/using-haiku-4.5-agents
- LangGraph Supervisor production guide (спільнотний) — https://www.buildmvpfast.com/blog/langgraph-supervisor-deep-agents-multi-agent-patterns-2026

### Наші докази

docs/01 §9, docs/02 (NOW, #28, #29, #36, #37), docs/04 §3/§16/§21/§24/§27, docs/13 §22, docs/15 §29/§30/§42–48, docs/16 §26/§31 (через docs/02), docs/17, docs/25, docs/32, docs/34, docs/35, docs/36, docs/37, `managed-agents/*.md`, `src/turnCorrelation.ts`, коментарі issue #38.

---

## Явні підтвердження

- Оновлення production Agent: **НІ**
- Оновлення production Skill: **НІ**
- Створення candidate Agent: **НІ**
- Створення Managed Session: **НІ**
- Платний поведінковий інференс: **НІ**
- Мутації Trello: **НІ**
- Мутації Memory: **НІ**
- Дії в Calendar: **НІ**
- Зміни source-реалізації: **НІ**
- Коміт: **НІ**
- Push: **НІ**
- Деплой: **НІ**
- Закриття issue: **НІ**
- Оновлення roadmap: **НІ**

## `git status --short`

```text
?? docs/38_DJONIK_COORDINATOR_MODEL_ARCHITECTURE_AUDIT.md
```
