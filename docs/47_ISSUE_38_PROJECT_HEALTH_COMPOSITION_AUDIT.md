# #38 — аудит композиції Project Health

> **Рішення Product Owner / Product Lead (2026-09-23): F1 НЕ прийнято. F3 прийнято до реалізації.**
>
> F1 «coordinator-evidence gate» дозволяв мовчки втратити другу частину змішаного запиту, яка не потребує інструментів. Приклад: «Як там Extract? І що ти думаєш, мені краще робити далі?». Для Djonik мовчазна втрата наміру неприйнятна. Інваріант «змішаний запит не втрачає частину мовчки» **не послаблюється**.
>
> Прийнято F3 — natural withheld cue. Семантика композиції #32 не змінюється. Технічний notice `coordinator_withheld` замінено одним коротким природним реченням. Реалізація: [docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md).
>
> Нижче — аудит без змін, як історичний запис аналізу. Рекомендація F1 у §1, §8–§15 **не є чинною**.

Дата: 2026-09-23. Canonical NOW: #38 ([docs/02](02_DEVELOPMENT_ROADMAP.md)). Тип: **аудит, без реалізації**. Runtime, тести, Agent, Skills, prompt, Sessions і paid inference не змінювались. Ordinary coordinator на Sonnet 5 medium уже прийнятий ([docs/46](46_ISSUE_38_ENRICHED_TRELLO_PLANNING_SMOKE.md)). Це останній обмежений напрям #38.

Джерела: код `src/turnCorrelation.ts`, `src/djonikClient.ts`; тести #28/#32 (`src/turnCorrelation.test.ts`, `src/turnCompletion.test.ts`, `src/djonikClient.test.ts`); [docs/15](15_ISSUE_28_IMPLEMENTATION_REPORT.md) §44–§48, [docs/19](19_ISSUE_32_IMPLEMENTATION_REPORT.md) §12–§13, §23, [docs/36](36_ISSUE_38_LIVE_VOICE_VALIDATION.md), [docs/37](37_ISSUE_38_TARGETED_LIVE_REVALIDATION.md), [docs/39](39_ISSUE_38_SONNET_5_LOW_MODEL_MIGRATION_REPORT.md), [docs/40](40_DJONIK_INSTRUCTION_ARCHITECTURE_AUDIT.md) §9, [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md); SDK `@anthropic-ai/sdk` 0.125 (типи подій і roster); офіційна сторінка [Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration), прочитана 2026-09-23. Файлу `docs/18_ISSUE_28_COMPOSITION_FOLLOWUP_REPORT.md` немає: `docs/18` — це звіт #31. Контракт композиції #32 записаний у docs/19.

## 1. Executive conclusion

1. **Корінь проблеми — транспорт, а не міркування.** Координатор завжди пише власний `agent.message`: переказ результату спеціаліста і/або проміжне повідомлення («Питаю спеціаліста…», «Чекаю актуального статусу.»). Runtime #32 показує текст координатора лише тоді, коли він порожній (`specialist_only`) або побайтно дорівнює результату (`exact`). В усіх 5 зафіксованих live PH-ходах під #32 був `coordinator_withheld` і видимий технічний notice. `specialist_only` live **ніколи** не спостерігався.
2. **Нативного provenance для розрізнення «чистий PH» і «змішаний запит» немає.** `agent.message` містить лише `id`, `content`, `processed_at`. Roster координатора — лише `{type, agents}`, без налаштувань володіння результатом. Офіційні docs описують лише один патерн: координатор синтезує результати дочірніх агентів. Structured / typed child result, передачі результату дочірнього агента прямо користувачу чи придушення генерації координатора немає.
3. **За чинних інваріантів неможливо одночасно мати завжди природний чистий PH і нуль тихих втрат змішаного наміру.** Причина: текст координатора — єдиний носій і переказу, і незалежної «другої частини», а події їх не розділяють.
4. **Найменша детермінована зміна — «coordinator-evidence gate».** Замість питання «що написав координатор» runtime перевіряє, чи **виконав координатор у цьому ході власну роботу**: будь-який власний tool call на primary-потоці. Якщо не виконав, його текст не може нести жодного нового свіжо підтвердженого факту поза результатом спеціаліста. Такий текст замінюється результатом спеціаліста **без notice**. Якщо виконав (план дня, Memory, пошук, запис), діє чинна поведінка #32: withheld + короткий природний cue замість технічного notice.
   - Сигнал — нативні події tool use, а не текст. Parsing, роутера намірів, нового агента, моделі чи prompt-зміни немає.
5. **Цей gate послаблює один інваріант.** Змішаний запит, **друга частина якого не потребує жодного інструмента**, може бути прихована мовчки. Приклади: загальна порада, відповідь з історії розмови. Для всього, що вимагає свіжих даних, Skill або запису, втрата лишається видимою.

**Verdict: NEEDS PRODUCT OWNER DECISION** — одне обмежене рішення (§8.4). Після нього — READY FOR PH IMPLEMENTATION.

## 2. Поточна машина станів делегованого PH-ходу (код і тести)

**Setup.** При створенні Session `resolveProjectHealthSpecialistName(session.agent)` ([djonikClient.ts:611](../src/djonikClient.ts)) повертає callable name канонічного спеціаліста. Умови:
- рівно один запис roster `type:"agent"` з id `agent_01KNiQDzzPjaMU6LLF4mU6uM`;
- непорожнє ім'я, яке не має жоден інший запис.

Інакше `null`, і safeguard вимкнено.

**Хід** (`sendPartsSerial` → `runTurn`, [djonikClient.ts:905–1095, 1146–1300](../src/djonikClient.ts)):

| # | Подія (primary stream) | Обробка |
|---|---|---|
| 0 | `send(user.message)` | `specialist.beginTurn()` скидає per-turn стан; ledger #31 новий |
| 1 | `user.message` echo | anchor: події до власного echo — у карантині (`preAnchorEventsQuarantined`); `thread_created` до anchor дає лише identity (`onThreadCreated(…, false)`) |
| 2 | `session.thread_created {agent_name, session_thread_id}` | канонічне ім'я → thread у `known` + **engaged цього ходу** |
| 2′ | `agent.thread_message_sent {to_agent_name, to_session_thread_id}` | повторне використання persistent thread → engaged |
| 3 | `agent.thread_message_received {from_agent_name, from_session_thread_id, content}` | обидві половини identity збіглись → текст дописується в `results` цього thread. Одна половина збіглась → `unrecognized++`. Thread не engaged у цьому ході → `lateResults++` (карантин) |
| 3′ | `session.thread_status_idle` (child) | latest wins: `incomplete = stop_reason ≠ end_turn` (#40) |
| 4 | `agent.message` (будь-який, будь-коли після anchor) | `reply` = текст **останнього** повідомлення. Попередні, зокрема проміжні, перезаписуються ([:961](../src/djonikClient.ts)) |
| 4′ | `agent.mcp_tool_use` / `agent.tool_use` / `agent.custom_tool_use` | ledger #31, телеметрія, custom lifecycle #40. **Для композиції PH не використовуються** |
| 5 | `session.status_idle` | лише `end_turn` завершує хід. `requires_action` (не custom) / `budget_reached` / `retries_exhausted` / unknown → `completed:false`. Порожній `reply` дозволений лише коли verdict `verified` і записів немає, або verdict `unverified`, або є verified work history. Інакше «no text reply» ([:1081–1091](../src/djonikClient.ts)) |
| 6 | (nudge) | лише для завершеного ходу з неверифікованим записом, максимум 1 (#31) |
| 7 | класифікація | `specialist.verdict()` ([turnCorrelation.ts:216](../src/turnCorrelation.ts)) |
| 8 | вибір видимої відповіді | див. таблицю нижче ([djonikClient.ts:1199–1280](../src/djonikClient.ts)) |

**Вихідні стани (точні умови):**

| Стан | Умова | Видимо |
|---|---|---|
| incomplete | stop ≠ `end_turn` | `DjonikTurnIncompleteError` (+ звіт мутацій з tool events); S і C не показуються |
| unresolved write | ledger має неверифікований запис після nudge | `DjonikUnverifiedMutationError` + блок S (якщо verified) або notice unverified |
| `unverified` | engaged, але: `unrecognized_result` / `multiple_threads` / `missing_result` / `duplicate_results` / `not_exact_text` / `child_not_completed` | `DjonikSpecialistUnverifiedError`; C не показується; звіт мутацій, якщо були |
| `none` | канонічного engagement у ході немає | звичайна відповідь C (з логікою #31/#23 для записів) |
| **`specialist_only`** | verified S, `C === ""` | S; із записами — `M + блок S` |
| **`exact`** | verified S, `C === S` | S; із записами — `M + блок S` |
| **`coordinator_withheld`** | verified S, будь-який інший C, зокрема C, що містить S | S + `———` + фіксований notice; із записами — `M + блок S + notice` |
| + work history | verified `trello_work_history` | `answer_text` першим, усе вище — після `PM-висновок:` |

M — системний звіт про мутації (`finalizeMutationReply(null, …)`), ніколи не текст моделі.

## 3. Чому виникає `coordinator_withheld`

- Prompt v25 наказує: «Reply with the specialist's answer exactly as received: add, remove, reword, reformat or acknowledge nothing» ([djonik.md:115](../managed-agents/djonik.md)). Отже, модель має відтворити згенерований текст побайтно, і саме це вона стабільно не робить.
- Live-вибірка під композицією #32:

  | Документ | Coordinator | Режим |
  |---|---|---|
  | docs/36 B, C | Haiku | withheld (обидва) |
  | docs/37 A | Haiku | withheld |
  | docs/39 A | Sonnet 5 low | withheld |
  | docs/39 A | Sonnet 5 medium | withheld |

  **5/5 withheld, 0 specialist_only, 0 exact.**
- Прихований текст координатора містив переказ, а інколи й **невиправдані факти**: власну арифметику дат «через 2 дні» (docs/37 A), «За два дні…» (docs/36 C), «дедлайн наближається» (docs/39). Тобто runtime **правильно** не показав його. Факти спеціаліста в усіх 5 випадках доставлені побайтно.
- Навіть мовчазний після результату координатор не дав би `specialist_only`: live він пише проміжні `agent.message` («Питаю спеціаліста. Відповідь буде через хвилю.», «Чекаю актуального статусу.»), а `reply` зберігає останнє з них.
- `exact` live спостерігався лише до #32, під фіналізатором #28 (§48, `replacedCoordinatorReply:false`).

## 4. Гарантії `specialist_only`

- **Звідки.** Фіналізатор #28 §47 замінював **будь-яку** відповідь координатора на рядок спеціаліста. Прийнятий live у §48. По суті це був дизайн B без notice. `specialist_only` — вироджений випадок цього правила: хід, у якому координатор не написав нічого, мав завершитись, а не впасти на «no text reply» (тест #28 6b). #32 (раунд 2, docs/19 §23) звузив заміну до `""`/`exact` і додав notice. Причина: мовчазна заміна приховувала б незалежний вивід змішаного запиту (#32 16b).
- **Що гарантує вже зараз.** Діє, лише коли verdict `verified`:
  - канонічна identity через roster, name і thread;
  - engagement у цьому ході;
  - рівно один thread і рівно один простий текстовий результат;
  - жодного `unrecognized`;
  - child завершився `end_turn`;
  - хід завершився авторитетним `end_turn`.

  Тоді S повертається без trim чи нормалізації (#28 3). Порожній C дозволений `runTurn` лише за verified без записів; із записами відповідь веде M.
- **Provenance належності до ходу** — anchor на власний `user.message` echo, engagement у поточному ході, карантин пізніх результатів (#32 7–9b, 10b, 20c).
- **Готовність до Telegram.** Specialist v4 пише user-facing текст: одна відповідь, без технічних нотаток, без лічильників, одна наступна дія (docs/15 §45). Live-блоки спеціаліста в docs/36/37/39 — природна українська. Готовий до прямої доставки.
- **Live.** Не тестувався жодного разу (§3). Юніт-тести: #32 15 (silent), #28 6b.

## 5. Чистий PH і змішаний намір

| Запит | Що робить нативний потік | Що бачить runtime |
|---|---|---|
| «Як там Extract?» / «Який стан Cossack Labs?» / «Де найбільший ризик по Seqthera?» | делегування → S → координатор пише переказ (live: **0 власних tool calls** на primary, docs/15 §44.14, docs/39 A ×2) | verified S + C ≠ S |
| «Який стан Extract і що мені сьогодні робити?» | делегування + власне планування: daily-planning вимагає fresh Trello і читання Skill | verified S + C ≠ S (+ власні tool calls) |
| «Перевір Cossack Labs і перенеси Career Page у Waiting.» | делегування + `trelloWriteCard` + read | verified S + записи в ledger |
| «Що горить по Seqthera і склади план на завтра.» | делегування + власне читання Trello і Skill | verified S + C ≠ S (+ власні tool calls) |

**Чи може runtime розрізнити чистий і змішаний запит без parsing і роутера? НІ.**
- Жодна подія не каже, що C — це переказ S, або що C — незалежний вивід.
- Нативні поля: `agent.message {id, content, processed_at}`; thread-події; tool-події.
- Порядок подій, довжина, збіг підрядка чи слова — евристики над прозою. #32 їх відкинув (docs/19 §23.2).

**Що runtime *може* довести** (сигнал доказовості, а не наміру): чи виконав **сам координатор** будь-яку власну роботу в цьому ході. Це in-turn `agent.tool_use`, `agent.mcp_tool_use` або `agent.custom_tool_use` без `session_thread_id`.
- Порожній `session_thread_id` означає власну подію primary-thread. Заповнений — cross-post від дочірнього агента (SDK: «When set, this event was cross-posted from a subagent's thread»). Cross-post буває лише для блокуючих дій.
- Власні події дочірнього агента живуть лише в його thread (docs/15 §34).
- Делегування саме по собі не створює `agent.tool_use` на primary (docs/15 §44.14: «The primary thread made zero tool calls of any kind»).

Якщо координатор нічого не читав і не записував, будь-яке твердження в його тексті про поточний стан — або переказ S, або непідтверджене; Skill-керовані дії (plan, task, write) у такому ході неможливі. Але tool-free друга частина можлива: загальна порада, відповідь з контексту розмови. Її втрата лишається ризиком.

## 6. Порівняння кандидатів

| | Факт. безпека | Ризик втрати змішаного наміру | Безпека запису | Детермінізм | Telegram UX чистого PH | Розмір | Нативність | Регресії | Parsing тексту |
|---|---|---|---|---|---|---|---|---|---|
| **A** як зараз | так | видима (notice) | так | так | **погано:** notice у 5/5 | 0 | так | 0 | ні |
| **B** завжди S, ігнор C | так | **тиха, для будь-якої другої частини** | так (M веде) | так | добре | ~5 рядків | так | ламає #32 16b/17 інваріант | ні |
| **C** S + C послідовно | **ні**: переказ з невиправданими фактами (§3) видно поруч; порушує #28 R4 | немає | так | так | погано: дубль | малий | так | ламає #32 16/17 | ні |
| **D** нативні структуровані сегменти | — | — | — | — | — | — | **не існує** (§7) | — | — |
| **E** prompt «мовчи після делегування» | так | видима | так | **ні** (модель; live 5/5 не виконує echo, проміжні повідомлення) | ймовірнісно | prompt | так | низький | ні |
| **F1** evidence gate (рекомендовано) | так: C не показується ніколи | видима, якщо друга частина потребує інструмента/Skill/запису; **тиха лише для tool-free частини** | так (записи = власна робота → M веде) | так | добре, коли координатор нічого не читав (live 3/3 записаних) | ~20 рядків + тести | так (tool-події) | змінює очікування #32 16/16b/17, #28 2 | ні |
| F2 custom tool `reply_extra` для другої частини | так | залежить від моделі | так | ні (модель вирішує, що класти) | ймовірнісно | новий tool + prompt | частково | середній | ні |
| F3 лише UX: коротший природний cue замість technical notice | так | видима | так | так | краще, але cue завжди | 1 константа | так | тести regex | ні |

## 7. Нативні можливості Managed Agents (перевірено)

| Потреба | Є? | Доказ |
|---|---|---|
| Володіння фінальним результатом дочірнього агента | **ні** | roster: `{type:"coordinator", agents:[…]}` (1–20 записів), інших полів немає (SDK `BetaManagedAgentsMultiagentCoordinatorParams`) |
| Структурна parent/child композиція | **ні** | docs: координатор «synthesize the results»; child → coordinator — це `agent.thread_message_received {from_session_thread_id, from_agent_name, content}` |
| Придушення генерації координатора після результату | **ні** | немає параметра; є лише `user.interrupt` (зупиняє, не композиція) |
| Повернення результату дочірнього агента напряму | **ні** | primary thread — «condensed view»; видимий user-facing текст — лише `agent.message` координатора |
| Metadata / тег на результаті | лише identity | `from_agent_name`, `from_session_thread_id` (уже використовуються) |
| Typed subagent result blocks | **ні** | `content`: text / image / document / redacted |
| Provenance `agent.message` | **ні** | `{id, content, processed_at}` |
| Інше нове з часів #32 | не релевантне | `advisor` (порада всередині ходу, не результат для користувача), `user.define_outcome` (rubric-оцінювання), `system.message`, `event_deltas` preview |

Висновок: провайдер не дає нативного механізму. Композиція лишається обов'язком тонкого клієнта на наявному provenance.

## 8. Рекомендована найменша архітектура — F1 «coordinator-evidence gate»

### 8.1 Правило

Для завершеного (`end_turn`) ходу з verified S:

1. **Записи були** (ledger має outcomes) → як зараз: `M + блок S` (+ cue, якщо C ∉ {"", S}).
2. **Записів немає, координатор не мав власних tool calls у ході** → видимо **лише S**, без notice. Новий content-free режим `coordinator_superseded`; `specialist_only` і `exact` лишаються як є.
3. **Записів немає, координатор мав власні tool calls, C ∉ {"", S}** → `coordinator_withheld`, але з **коротким природним cue** замість технічного notice. Наприклад: «Тут — лише висновок по стану проєкту. Якщо в запиті було ще щось, напиши це окремим повідомленням.» Фінальне формулювання погоджує PO.

«Власний tool call» — будь-яка подія `agent.tool_use`, `agent.mcp_tool_use` або `agent.custom_tool_use` **після anchor цього ходу** з порожнім або відсутнім `session_thread_id`.

### 8.2 Чому це не роутер і не parsing

Рішення бере лише наявність нативних tool-подій і їхнє поле thread. Текст користувача, координатора й спеціаліста не аналізується. Рядкова операція лишається одна — `===` для `exact`. Делегування вирішує Claude.

### 8.3 Що змінюється в безпеці

- Жоден рядок координатора не стає видимим поруч із S — ні в пункті 2, ні в пункті 3. R4 #28 збережено повністю.
- Факти, шлях запису, provenance, `end_turn`, FIFO і карантин не змінюються.

### 8.4 Рішення для PO (єдине)

Прийняти, що в ході з verified PH і **без власної роботи координатора** tool-free друга частина запиту може бути мовчки прихована. Приклади:
- «Як там Extract? І дай загальну пораду, як не вигорати»;
- «…і нагадай, що ми вирішили вище в цій розмові».

Усе, що потребує свіжих даних, Memory, Skill чи запису, лишається видимо захищеним: план, задачі, мутації, weekly.

- **Альтернатива без послаблення — F3** (лише коротший cue). Тоді чистий PH природним **не стане**: cue буде в кожній PH-відповіді, бо координатор завжди пише текст.
- **Третього шляху** без нативного provenance немає (§1.3).

## 9. Інваріанти #32 і як F1 їх зберігає

| Інваріант | Як збережено |
|---|---|
| Нативне рішення Claude про делегування | runtime не вирішує, чи делегувати; gate діє лише після verified результату |
| Жодного application-level роутера намірів | сигнал — tool-події, не текст |
| Канонічна identity / версія спеціаліста | `resolveProjectHealthSpecialistName` + `SpecialistTurnProvenance` без змін |
| Рівно один валідний результат спеціаліста в поточному ході | `verdict()` без змін; F1 застосовується лише до `verified` |
| Авторитетний `end_turn` | `runTurn` без змін; incomplete → помилка до композиції |
| Жодного витоку пізнього результату дочірнього агента | anchor + engagement + карантин без змін; лічильник власних tool calls скидається в `beginTurn` / `sendPartsSerial` і рахує лише події після anchor |
| FIFO / кореляція ходу | черга `enqueue` без змін; новий стан — per-turn, як ledger |
| Детерміноване збереження фактів спеціаліста | S завжди без змін, першим або після M |
| Невизначений provenance → видима помилка | `DjonikSpecialistUnverifiedError` без змін |
| Хід із записом захищений, верифікація мутацій не обходиться | outcomes → шлях M (#31/#23); nudge/unresolved без змін; запис — це власний tool call, тож F1 п.2 для нього недосяжний |
| Жодної тихої втрати змішаного наміру | **збережено для будь-якої частини, що потребує інструмента, Memory, Skill чи запису** (видимий cue). **Послаблено** для tool-free частини — рішення PO §8.4 |
| Видимий текст координатора не суперечить S | C ніколи не показується поруч із S |

## 10. Поведінка за сценаріями (F1)

| Сценарій | Видимо |
|---|---|
| Чистий PH, координатор без власних tool calls (live-норма) | **лише S**, природно (`coordinator_superseded` / `specialist_only` / `exact`) |
| Чистий PH, але координатор щось читав (наприклад, Memory перед делегуванням) | S + короткий cue (UX-шум, безпечно) |
| Змішаний read-only PH + план / інша робота з інструментами | S + cue «напиши окремо»; план не показано, втрату видно |
| Змішаний read-only PH + tool-free друга частина | **лише S**; друга частина мовчки прихована (рішення PO) |
| PH + запис | `M` (детермінований звіт #31/#23) + `Висновок Project Health (без змін):` S + cue за C ∉ {"", S}; неверифікований запис → помилка з блоком S |
| Результату спеціаліста немає | `DjonikSpecialistUnverifiedError(missing_result)`, C не показано |
| Кілька результатів / thread-ів | `DjonikSpecialistUnverifiedError(duplicate_results / multiple_threads)` |
| Координатор пише щось, що розходиться з S | ніколи не показується; п.2 → лише S, п.3 → S + cue |
| Делегування немає | verdict `none` → звичайна відповідь координатора, без змін |
| Хід не завершено (budget / requires_action / …) | `DjonikTurnIncompleteError`, без змін |

## 11. Файли, які зміняться під час реалізації

- `src/turnCorrelation.ts`:
  - `composeWithSpecialist(coordinatorReply, specialist, systemReply, coordinatorActed: boolean)`;
  - новий режим `coordinator_superseded`;
  - короткий cue замість `COORDINATOR_WITHHELD_NOTICE`;
  - оновлений doc-коментар.
- `src/djonikClient.ts`:
  - per-turn `coordinatorOwnToolCalls` (скидається в `sendPartsSerial`, рахується в `runTurn` для трьох tool-подій після anchor з порожнім `session_thread_id`);
  - передача в `composeWithSpecialist`;
  - режим у content-free trace;
  - оновлений коментар #28/#32.
- Тести: `src/turnCorrelation.test.ts`, `src/turnCompletion.test.ts`, `src/djonikClient.test.ts`.
- Документи після реалізації:
  - звіт реалізації;
  - [docs/41](41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md) (PH gate: notice лише для змішаного запиту з власною роботою координатора);
  - [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) (короткий запис контракту композиції).

**Без змін:** `managed-agents/*.md`, Skills, specialist, Agent, Memory, адаптер Telegram. Рядок prompt «Reply … exactly as received» стає зайвим, але безпечним. Його прибирання — окреме рішення поза цим кроком: не змінюємо дві змінні одночасно.

## 12. Потрібні тести

1. Чистий PH: C ≠ S, **без** власних tool calls → рівно S, без cue, trace `coordinator_superseded` (переписати #32 16, #28 2).
2. Суперечливий переказ («КРИТИЧНИЙ… 2 дні») без tool calls → ніколи не видно (#32 16, посилено).
3. Проміжне повідомлення + переказ без tool calls → лише S.
4. Змішаний: C ≠ S + власний `agent.mcp_tool_use` (read) → S + cue, C не видно (#32 16b з tool events).
5. Змішаний: власний `agent.tool_use read` Skill або Memory → S + cue.
6. **Задокументований залишковий ризик:** C з tool-free «другою частиною» без tool calls → лише S (явний тест прийнятого рішення PO).
7. C, що містить S, з власним tool call → cue; без нього → superseded (#32 17 розділити).
8. Cross-posted подія дочірнього агента (`session_thread_id` заповнений) **не** рахується як власна робота координатора.
9. Tool-подія до anchor (пізній хвіст попереднього ходу) не рахується; лічильник не переходить у наступний хід (як #32 22).
10. `exact` і `specialist_only` без змін (#32 15, #28 6b).
11. PH + verified / failed / unresolved запис, due #23, nudge — без змін (#32 18–20c, #28 7/7c).
12. Unverified-гілки (missing, duplicate, threads, unrecognized, not_exact_text, child_not_completed) без змін (#32 10–14).
13. Work history + PH (#36 relay 8/8b) — порядок і вміст без змін.
14. Mutation-«зубатість»: вимкнення gate (завжди superseded) ламає тести 4, 5, 7; показ C поруч із S ламає 1–3; врахування cross-post ламає 8.
15. `npm run typecheck`, `npm test`, `git diff --check`.

## 13. Чи потрібен paid live smoke після реалізації

**Для безпеки — ні.** Зміна детермінована. Входи — тип події і `session_thread_id` — зафіксовані в SDK і в live-записах. Офлайн-тести на відтворених формах подій достатні.

**Для закриття #38 як UX — один обмежений pure-PH хід рекомендовано.** Причина: у v25 Sonnet 5 medium координатор у docs/46 читав Memory перед плануванням. Чи робить він так перед делегуванням PH, **не виміряно**: docs/43 PH не запускав. Якщо робить, F1 дає п.3 (cue), і чистий PH природним не стане.
- Рекомендовано 1 Session, 1 хід через реальний `connectToDjonik()`, Memory `read_only`.
- Бюджет за docs/04 §27: найгірший порівнянний PH-хід 32¢ (docs/39 A medium) + резерв ≈ **$0.45**.
- Окремий дозвіл PO.
- Змішаний live-хід не потрібен: його поведінка повністю визначена тестами.

## 14. Чи достатньо цього для закриття #38 після PASS

**Так, за умови рішення PO §8.4.** Ordinary coordinator прийнятий (docs/46). Єдиний відкритий гейт #38 — видимий technical notice у чистому PH, і F1 його усуває. Змішаний запит лишається прозорим через cue для будь-якої частини з власною роботою.

Цей результат відповідає формулюванню PO в Audit 6: «Стан проєкту перевірив. Другу частину запиту краще виконати окремим ходом».

Щодо контракту docs/00 («preserves every part of mixed requests»): для tool-free частини діє прийняте послаблення. Його треба записати в рішенні PO. Якщо PO не приймає послаблення, #38 можна закрити лише з F3 (cue в кожному PH) як свідомо прийнятим UX.

## 15. Найменший наступний обмежений крок

Після рішення PO §8.4 — **source-only implementation F1**:
- два runtime-файли (§11) і тести (§12);
- без Agent, Skill, prompt чи Session;
- звіт реалізації.

Потім — review і окремий дозвіл на один pure-PH live-хід (§13). Після PASS — закриття #38 і перехід roadmap до #33.

Commit, push, deploy, закриття issue і промоція #33 — лише за окремою авторизацією.
