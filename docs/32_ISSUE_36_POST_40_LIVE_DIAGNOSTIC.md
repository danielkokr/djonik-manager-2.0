# Issue #36 — live-діагностика після #40

Дата: 2026-09-22  
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36) (NOW)  
Runtime-залежність: [#40](https://github.com/danielkokr/djonik-manager-2.0/issues/40), прийнято на `e5b0df2` ([docs/31](31_ISSUE_40_IMPLEMENTATION_REPORT.md))

## 1. Загальний результат

**PASS.** Усі 9 жорстких інваріантів #36 виконано, разом із runtime-інваріантом #40.

Провайдер **повторив** послідовність із docs/29: дві різні події `session.status_idle{requires_action}` назвали той самий `custom_tool_use_id`. Новий runtime виконав інструмент **один раз** і подав результат **один раз**. Relay зібрано: фактичний блок стоїть першим, байт-у-байт.

**Нежорстке спостереження, яке Product Lead має оцінити явно (див. §12).** Haiku не виконала інструкцію Skill «do not repeat … it in your reply». Її текст у секції `PM-висновок` спершу **повністю переказує фактичний звіт**, з одною літерною відмінністю в першому слові («Мінулого» замість «Минулого»), і лише потім дає один висновок. Через це видима відповідь містить факти двічі.

Код-власний фактичний префікс при цьому не змінено. Переказ нічому не суперечить, не вигадує сутностей і не приписує дій людині. За жорсткими правилами цього діагностичного прогону це **не** hard failure. Я не пропоную нового prompt- чи renderer-hardening.

## 2. Commit / checkout під тестом

- Прийнята реалізація #40: `e5b0df2d8eb520c139a2c6f41bc0b95e726cb352`, предок HEAD (перевірено `git merge-base --is-ancestor`).
- **Локальний fast-forward.** Локальний `main` відставав від `origin/main` на два docs-only governance-коміти: `8faf0af` (acceptance #40) і `55361fd` (NOW → #36). Checkout було доведено до них командою `git merge --ff-only origin/main`. Без commit, без push; дерево було чисте.
- **HEAD під тестом:** `55361fd`. Source-код ідентичний `e5b0df2`.
- **docs/02** на цьому HEAD підтверджує:
  - #40 — DONE, прийнято на `e5b0df2`;
  - #36 — єдиний NOW;
  - ця одна діагностика — наступна авторизована дія.
- **Sanity-перевірки до платних дій:** `npm test` — 495/495 pass; `npm run typecheck` — чисто; `git diff --check` — чисто; `git status --short` — порожньо.
- **Шлях виконання.** Прогін ішов через реальний `connectToDjonik()` із цього checkout і production-executor `executeTrelloWorkHistoryFromEnvironment`.
  - Інструментування було лише пасивним: tee-обгортка над `events.stream`/`events.send` клієнта SDK і лічильник над executor. Логіку runtime воно не змінювало.
  - Скрипти лежали в scratchpad. На час запуску їх тимчасово копіювали в `src/`, щоб працювали імпорти, і одразу видаляли. У репозиторії не лишилося змін, окрім цього звіту.

## 3. Авторизація і задекларовані ліміти

| Ліміт | Авторизовано | Використано |
|---|---|---|
| Стеля list cost | $0.12 | **$0.03** |
| Нові candidate Agents | 1 | 1 (`agent_01QpAua2SCbFAHF7h8HQwigT`) |
| Managed Sessions | 1 | 1 (`sesn_01JFiTkvaMn7UpmBnNsjHB5d`) |
| Видимі платні turns | 1 | 1 |
| Trello mutations / Calendar / Memory writes | 0 | 0 |
| Зміни production / promotion | 0 | 0 |
| Retry / другий prompt | не авторизовано | не було |

**Admission.** Найгірший порівнянний повний turn (docs/29) коштував $0.03. Стеля $0.12 лишає резерв, тож turn допущено. Native backstop: `budget.max_list_cost = 12` USD cents на Session.

## 4. Заморожена конфігурація candidate

Candidate побудовано з read-back production. Змінено лише задекларовані пункти ізоляції.

| Пункт | Значення |
|---|---|
| Candidate | `agent_01QpAua2SCbFAHF7h8HQwigT`, **version 2** (див. примітку) |
| Model | `claude-haiku-4-5-20251001`, standard |
| System | SHA-256 `03b33a909123bb40d56415fee7b4a4b95071e5e6a4a31a70b16c3f6d6a283899` (ідентичний production) |
| Coordinator Skills (закріплено на поточні `latest` production) | task-management `skver_012fLb9ZFpL4mjqybAZ7KtmU`; daily-planning `skver_01TDfMCnuv5LkQN4WvtwBzXW`; weekly-planning `skver_018soRHmcAn6onE8DpHScFbf`; studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj` |
| work-review Skill (новий, ізольований) | `skill_0169h7GYNYUDDDZteDCUV2fE` / **`skver_015LYzVdivGGMsBpuki4kW4S`**; байти = committed blob `HEAD:.claude/skills/work-review/SKILL.md` (1930 B, SHA-256 `c079d285bc71f2147c4ea897565b0869cb906a6f0658cdf85dd7374fa94ee640`, з YAML frontmatter з `3e180ae`) |
| Project Health roster | coordinator → `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 (як у production) |
| MCP | `trello` (read-поверхня); **усі шість** `trelloWrite*` (включно з `trelloWriteCard`) мають `enabled:false`; `google-calendar-calendarmcp` має `enabled:false` |
| Custom tool | `trello_work_history`; SHA-256 input-schema `ff820032911734a0fc63bdf2d2e941994d28241614cca812fbd353b4bc1a7921` (ідентичний docs/27–29) |
| Memory | production Memory Store `read_only` (Session resource: `memory_store` / `read_only`) |
| Production attach / version update | ні |

**Примітка про version 2.** Перше завантаження Skill (`skver_01Cmt2BQQYe5BxatqQhj2b1s`) взяло файл із робочої копії. Через `core.autocrlf=true` він мав CRLF-закінчення рядків: 1942 B, SHA `3aabf4a3…`, тобто не байт-у-байт committed-артефакт.

**До створення будь-якої Session** я:
- завантажив нову версію того самого ізольованого Skill з точним committed blob (LF, SHA `c079d285…`);
- перепрошив **той самий** candidate на цю версію (v1 → v2).

Це не новий candidate і не зміна тексту Skill. Прогін використав лише v2.

## 5. Production до і після

`client.beta.agents.retrieve(agent_01WGRHDBjQa3eMhoGJMmQ1dh)` до створення candidate і після прогону:

- version **21**, `updated_at` `2026-09-21T10:51:30.448788Z`, Haiku standard, system SHA `03b33a90…`;
- чотири coordinator Skills (`latest`), PH roster v4;
- `trelloWriteCard` увімкнено лише в production — candidate його вимикає;
- Calendar вимкнено.

**Повний JSON до і після побайтно ідентичний** (`prod before===after: true`). Production не змінювався.

## 6. Точна послідовність подій

Persistent `events.list` Session `sesn_01JFiTkvaMn7UpmBnNsjHB5d`. Час — серверний `processed_at`, 13:31 UTC. Останній стовпець — момент, коли клієнт прочитав подію зі stream (годинник клієнта).

| # | Час (s) | Подія | id | Деталі | Клієнт прочитав |
|---|---|---|---|---|---|
| 3 | 45.823 | `user.message` | `sevt_01YUSLZKHqeKaqu7F1We3Qp8` | anchor turn | 48.402 |
| 6 | 50.119 | `agent.tool_use` `read` | `sevt_01KJfPU4uvz6KPvj4WWcHtpb` | `/workspace/skills/work-review/SKILL.md` | — |
| 7 | 50.119 | `agent.custom_tool_use` | `sevt_01SQFGackmy84UsAJr5gLDRk` | `trello_work_history`, `session_thread_id` відсутній | 52.712 |
| 9 | 50.252 | `session.thread_status_idle` | `sevt_011LgKdiH6D1SQpceJoUhCXn` | requires_action `[sevt_01SQFGack…]` (primary thread) | 52.829 |
| 11 | 50.252 | `session.status_idle` | **`sevt_015pS2CqwxqVGHThYk87mD4c`** | requires_action `[sevt_01SQFGack…]` → **executor стартував 52.831** | 52.830 |
| 12–13 | 50.372 | `status_running` / `thread_status_running` | | сервер обслуговує `read` | |
| 14 | 51.232 | `session.thread_status_idle` | `sevt_01SjQMvuhToSPqb1wVDfQ8B7` | requires_action `[sevt_01SQFGack…]` | 55.291 |
| 16 | 51.232 | `session.status_idle` | **`sevt_01Hfq5Q9SJGPkjcRTHkH9Tu4`** | requires_action `[sevt_01SQFGack…]` — **повторна емісія, інший idle id** | 55.291 → стан SUBMITTED → **no-op** |
| 17 | 52.733 | `user.custom_tool_result` (echo) | `sevt_0188XB8kuU4NmritwNdU9DdX` | `custom_tool_use_id = sevt_01SQFGack…`, `is_error:false` | 55.307 → **RESOLVED** |
| 18–19 | 52.803 | `status_running` / thread running | | | |
| 20 | 52.853 | `agent.tool_result` | `sevt_01MKRU9HLRPMqp7P2jCARBQB` | результат `read` | |
| 22 | 54.647 | `agent.message` | `sevt_01PfdKJf1rYf3hoPwM1hsfAC` | див. §9 | 57.216 |
| 24 | 54.772 | `session.thread_status_idle` | `sevt_01XYeBbz4QVeojERsiVW35ub` | `end_turn` | 57.346 |
| 26 | 54.772 | `session.status_idle` | **`sevt_0186bPxxq1UvCuNM9NA4hnzD`** | **`end_turn`** | 57.351 |

Усього persisted-подій 26; stream доставив ті самі 26 у тому самому порядку.

Друга idle (51.232) була емітована до того, як результат персистовано (52.733). Тобто вона повторно назвала ще нерозвʼязаний id, поки працював executor: паралельний built-in `read` знову перевів Session у running → idle. Клієнт прочитав її лише після завершення подання (send завершився о 55.291 за годинником клієнта). Lifecycle уже мав стан SUBMITTED, тому це no-op.

Це саме той клас подій, який описано в docs/30 §1 і §6 (відтворення з тестів #40 1 і 2). **Нової runtime-семантики не виявлено.**

## 7. Custom-tool lifecycle по `custom_tool_use_id`

| `custom_tool_use_id` | idle, що його називали | Виклики executor | Спроби send результату | Echo результату | Фінальний стан | Provenance #36 |
|---|---|---|---|---|---|---|
| `sevt_01SQFGackmy84UsAJr5gLDRk` | 2 (`sevt_015pS2Cq…`, `sevt_01Hfq5Q9…`) | **1** | **1** (успішно) | **1** (`sevt_0188XB8k…`) | RESOLVED | **verified**: один окремий id, одна кешована відповідь |

- Окремих `custom_tool_use_id`: **1**.
- Trace клієнта: рівно один `custom_tool_result_sent` (`isError:false`) і один `work_history_relay_composed` (`mode: with_commentary`). `work_history_relay_skipped` немає.
- Байти echo `user.custom_tool_result` дорівнюють байтам виходу executor (`echoBytesEqualExecutorOutput: true`).

## 8. Детермінований `answer_text`

Вхід інструмента (точно):

```json
{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"last_week"}}
```

Структурований результат:
- `window`: `пн 14.09, 00:00` – `пн 21.09, 00:00`, «Минулий тиждень»;
- `scope`: project `Extract`;
- `coverage`: `pagesRead 1`, `truncated false`, `oldestActionReached true`.

```text
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток
```

**Фактична коректність.** Оцінювався структурований результат, а не формулювання Haiku:
- **Вікно.** Kyiv-тиждень пн–пн, минулий відносно вівторка 22.09.
- **Покриття.** Повне: `truncated:false`, `oldestActionReached:true`.
- **Узгодженість.** Кількості відповідають переліченим назвам (4/4 і 2/2). Обидві картки, що повернулися з Done, також є серед тих, що перейшли в Done. Це збережена семантика reopen/re-Done.
- **Відповідність docs/29.** Для **того самого закритого вікна** `answer_text` байт-у-байт збігається з результатом docs/29, отриманим незалежним прогоном раніше сьогодні. Там H1–H4 і H6 оцінено як PASS.
- **Формат.** Текст описує події дошки, а не дії людей. Сирих id, часів і `lastActivityAt` немає.

Окремої незалежної реконструкції з сирих Trello actions поза інструментом не робилося.

## 9. Сирий `agent.message` координатора

```text
Мінулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток

**Висновок:** потрібно перевірити, чому дві карти («Білі аромати 3D відео» та «Коментарі по пінкам») повернулись — це блокер чи вимога змін, щоб не повторилось?
```

## 10. Фінальна видима відповідь клієнта

```text
Минулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток

---
PM-висновок:
Мінулого тижня по Extract:

- **Перейшло в Done:** 4 — «Кохаю пінка», «Білі аромати 3D відео», «Автоматизація рендеру» та «Коментарі по пінкам»
- **Повернулось з Done:** 2 — «Білі аромати 3D відео» та «Коментарі по пінкам»
- **Створено:** 6 карток
- **Інші переміщення:** 5 карток

**Висновок:** потрібно перевірити, чому дві карти («Білі аромати 3D відео» та «Коментарі по пінкам») повернулись — це блокер чи вимога змін, щоб не повторилось?
```

## 11. Перевірка точного префікса

| Перевірка | Результат |
|---|---|
| `finalVisible.startsWith(answer_text)` | **true** |
| `finalVisible.slice(0, answer_text.length) === answer_text` | **true** (байт-у-байт) |
| `finalVisible === answer_text + "\n\n---\nPM-висновок:\n" + rawAgentMessage` | **true** (точна прийнята композиція) |
| `rawAgentMessage.startsWith(answer_text)` | false (перше слово моделі «Мінулого» ≠ «Минулого») |

Останній рядок показує, що без client relay (як у docs/29) назовні пішов би текст моделі з відмінністю в першому слові. Детермінований блок захистив саме client relay.

## 12. Оцінка PM-коментаря

Жорсткі перевірки:
- **Пряма суперечність детермінованому звіту:** немає. Переказ має ті самі числа, назви і категорії; висновок посилається на дві картки, що справді повернулися з Done.
- **Вигадана конкретна сутність, дата чи подія:** немає. «блокер чи вимога змін» сформульовано як питання, а не як факт.
- **Хибне приписування подій дошки людині чи Daniel:** немає.

**Жорсткий результат: PASS.**

**Нежорстке спостереження (для явного рішення Product Lead, не для нового hardening-циклу):**
- **Порушено інструкцію Skill.** Committed Skill прямо каже: «do not repeat, rewrite, reformat, or summarize it in your reply… add only ONE short PM-level conclusion». Haiku повторила весь звіт у своєму тексті.
- **Наслідок для відповіді.** Видима відповідь містить факти двічі: код-власний блок, а під `PM-висновок:` — переказ моделі з однією зміненою літерою («Мінулого»). Переказ лежить поза фактичним блоком і нічому не суперечить. Проте він подовжує відповідь і змішує модельну копію фактів із секцією висновку.
- **Не нове.** Та сама поведінка була в docs/29: сирий текст моделі там теж починався з повного звіту.

Згідно з правилами цього прогону, це не hard failure і не привід для prompt- чи renderer-hardening у межах #36. Рішення, чи приймати таку форму відповіді для v1 (або спостерігати в #35 pilot), — за Product Lead / Product Owner.

## 13. Докази нульових записів

- Persisted-подій `agent.mcp_tool_use` / `agent.mcp_tool_result`: **0**. Жодного Trello MCP-виклику, ні читання, ні запису.
- Built-in `agent.tool_use`: рівно 1, `read` файлу Skill. Подій запису в Memory немає; `memoryRead: false` у telemetry.
- Конфігурація candidate: `trelloWrite*` ×6 `enabled:false`, Calendar `enabled:false`, Memory `read_only`.
- `trello_work_history` read-only: Trello REST GET з read-only токеном; виконано 1 раз.
- Production Agent: без змін (§5). Mutation ledger turn порожній; `DjonikUnverifiedMutationError` немає.

## 14. Докази `end_turn` і кореляції

- `session.status_idle` `sevt_0186bPxxq1UvCuNM9NA4hnzD` зі `stop_reason: end_turn`. `session.send` повернув відповідь без помилки (`turnError: null`).
- **Anchor.** Echo `user.message` `sevt_01YUSLZKHqeKaqu7F1We3Qp8` — перший і єдиний `user.message` нової Session. Попередніх turns не було, тож stale-результат з іншого turn неможливий.
- **Provenance.** Єдиний id поточного turn — `sevt_01SQFGack…`; persisted `user.custom_tool_result` корелює саме з ним.
- **Telemetry turn:** `modelIterations 2`, `verificationNudges 0`, `skillRead true`.

## 15. Авторитетна кумулятивна вартість (list cost)

`client.beta.sessions.retrieve(sesn_01JFiTkvaMn7UpmBnNsjHB5d)` після `end_turn`:
- `usage.list_cost = { amount: "3", currency: "USD" }` (центи), тобто **$0.03** зі стелі $0.12;
- токени: input 17, cache creation (5m) 19 084, cache read 17 954, output 560;
- `active_seconds` 11.397; стан Session `idle`.

Використано 1 Session, 1 видимий turn. Другого prompt, retry чи іншої платної дії не було.

## 16. Фінальна оцінка за 9 жорсткими інваріантами #36

| # | Інваріант | Результат | Доказ |
|---|---|---|---|
| 1 | Правильний виклик `trello_work_history` / Extract / `last_week` (concise) | **PASS** | §8, вхід точно `project Extract`, `last_week`, `concise` |
| 2 | Одне виконання на окремий `custom_tool_use_id` | **PASS** | §7: 1 id, 2 idle → executor 1, send 1, echo 1 |
| 3 | Детермінований Variant-B `answer_text` фактично коректний | **PASS** | §8 (повне покриття, внутрішня узгодженість, ідентичність docs/29 для закритого вікна) |
| 4 | Видима відповідь починається з точного `answer_text` | **PASS** | §11 `startsWith` true, байт-у-байт |
| 5 | Проза моделі не може змінити фактичний блок | **PASS** | §11: префікс незмінний; змінена копія моделі — лише поза ним |
| 6 | PM-секцію чітко відокремлено; немає суперечності чи вигаданої сутності | **PASS** (з нежорстким спостереженням §12) | §10, §12 |
| 7 | Нуль записів у Trello, Calendar і Memory | **PASS** | §13 |
| 8 | Авторитетний `end_turn` | **PASS** | §14 |
| 9 | Немає stale-результату з іншого turn | **PASS** | §14 (нова Session, перший turn, один id) |

**Окрема оцінка #40.**
- **Розрахунок:** 1 окремий id, виклики executor 1, подання 1, echo 1; provenance `verified`.
- **Відтворення провайдером:** провайдер повторно емітував `requires_action` для того самого id. Кешований результат лишився єдиним результатом цього id. **#40: PASS на реальному провайдері.**

## 17. Рекомендація

**PASS → звіт готовий до розгляду Product Lead для прийняття #36.** Під час прийняття Product Lead має явно оцінити нежорстке спостереження §12: модель повторює фактичний звіт у PM-секції. Прийняти це для v1 чи віднести до спостереження в #35 pilot — рішення Product Lead / Product Owner. У межах цієї діагностики нового prompt- чи renderer-hardening не пропоновано.

Нової runtime-семантики поза docs/30 не виявлено. Архітектурний review не потрібен.

Ізольовані артефакти прогону лишилися як історичний запис і не використовуються production:
- candidate `agent_01QpAua2SCbFAHF7h8HQwigT`;
- Skill `skill_0169h7GYNYUDDDZteDCUV2fE`;
- Session `sesn_01JFiTkvaMn7UpmBnNsjHB5d` (idle).

Нічого не видалялося і не архівувалося.

## 18. `git diff --check`

```text
(чисто — без виводу)
```

## 19. `git status --short`

```text
?? docs/32_ISSUE_36_POST_40_LIVE_DIAGNOSTIC.md
```

Commit, push і deploy не виконувалися. #36 не закрито, roadmap не оновлено, #37 не розпочато, друга Session не запускалася.
