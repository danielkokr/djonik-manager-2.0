# Звіт по Issue #29 — Wave C2: дискавері доказової бази для work review / retrospective

> **Обсяг:** лише перший bounded-слайс Issue #29 — (A) синхронізація governance (#28 → #29) і (B) **дискавері**: що поточна поверхня Djonik + Trello реально здатна довести про історію роботи. Жодного paid Managed Session, жодного model inference, жодної мутації Trello/Calendar/Memory/Agent/Skill, жодного runtime-коду, жодного commit/push/deploy.

## 0. Короткий підсумок (TL;DR)

| Питання | Висновок |
|---|---|
| Чи можна довести **що зараз** зроблено/закрито/в роботі? | **Так** — для поточного стану (список, `closed`, `dueComplete`, `labels`, `due`). |
| Чи можна довести **коли** щось завершено / переміщено / повернуто в роботу? | **Ні.** Жодного примітива історії/дій/переходів у поточній поверхні немає. Офіційний Trello MCP README прямо вказує «Activity & History» як *coming soon*. |
| Що таке `lastActivityAt`? | Знак «Trello зафіксував якусь активність на картці в цей момент». **Не** доказ завершення, переміщення, reopen, прогресу чи виконавця. |
| «Що я реально зробив цього тижня?» | **PARTIAL (B):** можна чесно показати поточний стан (що зараз у Done/закрито/в роботі) і процитувати `lastActivityAt` як «Trello recorded activity at <ISO>»; хронологію тижня довести **не можна**. |
| Plan vs actual | **Частково:** plan-сторона доступна (Memory), actual-сторона — лише поточний стан; порівняння «виконано *протягом* періоду» **заблоковане** відсутністю історії. |
| Архітектурний висновок | **Outcome B:** поверхня підтримує лише current-state retrospective. Рекомендація — **невеликий, свідомо обмежений source-only Skill `work-review`** (наступний слайс). **Не** D: history-tool не «є, але вимкнений» — його немає в провайдера. |
| Інфраструктура | **Не обґрунтована:** БД, event store, snapshot/mirror, webhook, scheduler, новий specialist. |
| Головна прогалина цього слайсу | **Свіжого live-семплу немає** (див. §6): прямий MCP-виклик потребує OAuth-токена з vault, а масове читання записаних Session-подій заблоковане класифікатором PII. Кілька полів залишаються *не спостереженими* (§7, §22). |

## 1. Scope

- Issue: **#29** «Wave C2 — Evidence-based work review / retrospective» (OPEN, коментарів немає).
- Частина A: governance sync у `docs/02_DEVELOPMENT_ROADMAP.md`.
- Частина B: дискавері доказової бази (без реалізації capability).
- Поза scope (і не чіпалось): production v19, Project Health specialist v4, детермінований PH reply-finalizer, `task-management`, planning Skills, `studio-intake`, Telegram adapter, due-date safeguard, write verification.

## 2. Accepted base SHA

- `HEAD` = `origin/main` = **`017c826c56a803e2c1d3b5693e0264ed751fc36e`** («docs: close out project health wave c1») — перевірено після `git fetch origin`.
- GitHub: **#28 — CLOSED / COMPLETED** (closedAt 2026-09-21T09:42:56Z); **#29 — OPEN**.
- Відхилення від pre-flight: робоче дерево на старті цього слайсу **не було чистим**. Єдина зміна — `docs/02_DEVELOPMENT_ROADMAP.md` з попереднього кроку (Частина A вже була внесена і не закомічена). Жодних інших змін не було; я не робив reset/stash, а довів Частину A до потрібної редакції (§3).

## 3. Governance sync #28 → #29

Змінено лише `docs/02_DEVELOPMENT_ROADMAP.md`:

- Wave C1 (#28): `NOW` → **`DONE`**. Збережено accepted outcome і стисло зафіксовано: production **v19 / Haiku**; Project Health specialist **v4 / Sonnet**; native delegation **accepted**; deterministic PH reply safeguard **accepted**; final live acceptance **PASS** (§48, $0.21, 0 writes); validation coordinator **archived** (§49); **#18 — accepted platform limitation**. Closeout commit `017c826…`.
- Додано **`NOW — Wave C2: Evidence-based work review / retrospective (#29)`** із bounded-ціллю (за буквою issue #29, без розширення) та вказівкою на цей звіт як перший слайс.
- «Current state» тепер каже: canonical NOW = Wave C2 (#29). Застарілий абзац про «наступний C1-слайс» замінено коротким підсумком.
- Списки Wave C / Wave F: Project Health позначено accepted; work review — NOW.
- **Жодне пізніше issue не просунуто.**

Після цієї правки #29 є canonical NOW: у roadmap рівно один заголовок `### NOW —` (Wave C2).

## 4. Поточна production / Trello read-поверхня

Read-only `agents.retrieve` (без Session, без inference), 2026-09-21:

**Production `Джонік` (`agent_01WGRHDBjQa3eMhoGJMmQ1dh`), v19**

- модель `claude-haiku-4-5-20251001` (standard); `multiagent.type = coordinator`, roster → `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4**;
- 4 custom Skills (`version: latest`);
- built-in `agent_toolset_20260401`: усе ввімкнено;
- Trello `mcp_toolset` (`https://mcp.trello.com/v1`): `default_config.enabled = true`; явні overrides: `trelloWriteBoard/Checklist/Inbox/List/Planner` = `enabled:false`, `trelloWriteCard` = `enabled:true`. Отже **всі read-інструменти сервера ввімкнені** — за інвентарем `docs/04` §17: `trelloSearch`, `trelloReadBoard`, `trelloReadCard`, `trelloReadChecklist`, `trelloReadInbox`, `trelloReadList`, `trelloReadMember`, `trelloReadPlanner`, `trelloReadWorkspace` (конфіг зберігає лише overrides, імена читаються з docs/04);
- Google Calendar `mcp_toolset`: `default_config.enabled = false`.

**Specialist `agent_01KNiQDzzPjaMU6LLF4mU6uM`, v4 (Sonnet 5)** — `multiagent: null`; built-in лише `read`; Trello лише `trelloSearch`, `trelloReadBoard`, `trelloReadList`, `trelloReadCard` (default disabled). Збігається з `claude-lock.json` (`version 4`) і `managed-agents/project-health-specialist.md`.

**Висновок:** «вимкнених, але наявних» read-/history-інструментів немає — вимкнені лише п'ять write-інструментів.

## 5. Які схеми реально оглянуто (і що ні)

**Сирі MCP `input_schema` недоступні** (як і раніше зафіксовано в `docs/04` §17 та `docs/15` §25.4): `agents.retrieve` повертає конфіг, а не схеми; Console їх не показує; сервер `mcp.trello.com/v1` без OAuth-токена відповідає `401 invalid_token` (неавтентифікована проба, без облікових даних). Тому нижче — три рівні джерел, усі позначені провенансом:

**D — документація провайдера (публічна, свіжо прочитана):**
- `atlassian/trello-mcp-server` README: таблиця можливостей — Member, Workspaces, Boards (+labels), Lists, Cards (view/create/update/move/archive/**mark done**), Checklists, Search, Planner, Inbox. **«More capabilities coming soon»: `Activity & History — View action history for cards, lists, and boards`; `Comments — View, add, and edit comments`.** Тобто history/comments read-примітивів **не випущено**.
- `skills/trello-use/SKILL.md` провайдера: інструменти action-dispatched (`action: "..."`), сувора валідація, id — ARI, дати — UTC ISO 8601, курсорна пагінація (`hasNextPage`). Про поля історії — нічого.
- OAuth protected-resource metadata (`/.well-known/oauth-protected-resource/v1`): `scopes_supported` = `read/write:board`, `read/write:organization`, `read:member`, `read/write:member.inbox`, `read/write:member.planner`, `read:me`, `read:account` — **жодного scope для activity/history**.

**R — записані форми викликів і payload'ів (live-Session'и #28, `docs/15` §34.8, §44.15, §46.17, §25.4; 2026-09-18…21):**

| Інструмент | Спостережені `action` та параметри |
|---|---|
| `trelloSearch` | `search_boards`, `search_cards` (`query`, `limit`) → форма `{"cards":{"nodes":[],"totalCount":N}}` |
| `trelloReadBoard` | `list` (`limit`), `get`, `list_labels` (`boardId`,`limit`), `list_by_workspace` (`workspaceId`) |
| `trelloReadCard` | `list_by_board` (`boardIdOrUrl`, `filter: "open"|"all"`, `limit`), `get` (`cardIdOrUrl`) |
| `trelloReadList` | `list_by_board` (`boardId`, `limit`) |
| `trelloReadMember` | `get_me` (за документацією провайдера; використовувався в planning-трейсах `docs/04`) |

Поля вузла картки у відповіді `trelloReadCard list_by_board` (R): `list{id,name}`, `board{id,name}`, `labels`, `due`, `dueComplete`, `desc`, `lastActivityAt`, `members`, `startedAt`, `closed`, `complete`; обгортка `nodes[]`, `totalCount`, `hasNextPage`.

**N — не спостережено ніде:** повний список полів `trelloReadCard get`; вміст `trelloReadChecklist`, `trelloReadList` (поля списку), `trelloReadMember` (окрім `prefs.timezone` за документацією), `trelloReadWorkspace`; будь-які поля дій/коментарів; вхідна схема `trelloWriteCard` для «mark done» (що саме вона змінює — не збережено в репозиторії).

## 6. Live-семпл у цьому слайсі — чесний статус

Дозволялося: read-only Agent/config retrieval і прямі read-only Trello MCP виклики без paid Session.

- **Виконано (read-only, без inference):** `agents.retrieve` ×2 (production, specialist); `sessions.list` (метадані перших 150 Session'ів, Agent v8–v19 + валідаційні координатори); `sessions.events.list` для **одного** запису — лише підрахунок *типів* подій, без вмісту; публічні GitHub-читання (README, `trello-use` skill, дерево репо); неавтентифікована HTTP-проба `mcp.trello.com` (401) і публічні OAuth-метадані.
- **Не виконано — пряме читання Trello MCP:** потребує OAuth-токена, який живе у vault (`DJONIK_VAULT_ID`) і не в `.env`. Витягати/використовувати облікові дані я не буду.
- **Не виконано — масове читання записаних Session-подій** (структура payload'ів усіх минулих Trello-викликів): класифікатор auto-режиму відхилив дію як «PII Data Handling» (payload'и містять реальний вміст карток Daniel). Я **не** повторював її в обхідний спосіб.
- **Наслідок:** матриця нижче спирається на (D) документацію провайдера та (R) **вже записані в репозиторії** спостереження live-Session'ів #28 (структурні факти без особистого вмісту). Це **не** свіжий семпл станом на сьогодні і **не** product acceptance. Поля, яких немає в (D)/(R), позначено *unproven → трактувати як недоступні*.

## 7. Матриця доказів (поле за полем)

Легенда провенансу: **R** — записано в live-Session'ах #28; **D** — документація провайдера; **N** — не спостережено.

| Питання / твердження | Наявний доказ | Надійно? | Точне обмеження |
|---|---|---|---|
| поточний list/status | `list{id,name}` на вузлі картки (R) | **Так** | Це стан у момент читання. «Done» — це *назва списку* на дошці Daniel (конвенція), а не провайдерна семантика. Для точних тверджень — direct read, не `trelloSearch`. |
| зараз closed/archived | `closed` (bool); потрібен `filter:"all"` — типове `open` архівні не повертає (R: 34 open проти 53 all — у різних Session'ах) | **Так** (як поточний стан) | Немає часу архівації. Archived ≠ completed: спостережено архівні картки з `complete:false`, `dueComplete:false`. |
| задача завершена | Членство у списку `Done`; `dueComplete:true` (спостережено на трьох Done-картках, `docs/15` §36/§44); `complete` (R) | **Частково** | Немає єдиного провайдерного сигналу. `dueComplete` — bool без часу і має сенс лише з `due`. Семантика `complete` не задокументована (спостережено лише `false`). Що саме встановлює write «mark done» — не спостережено. Це **стан**, не подія. |
| дата завершення | — | **Ні** | Жодного `completedAt`/події. `lastActivityAt` її не замінює (§8). |
| переміщено між списками | лише поточний `list` (R) | **Ні** | Переходів A→B немає; порівняння двох знімків у різний час — не історія і потребує збереженого знімка. |
| дата переміщення | — | **Ні** | Ані події, ані часу. |
| reopen | — | **Ні** | Відсутній і сам write-примітив reopen (`task-management`: «є лише mark done»). Поточний стан «не Done» не відрізняє «ніколи не був Done» від «повернули». |
| дата reopen | — | **Ні** | — |
| started | `startedAt` присутнє у вузлі, але **null у всіх спостережених картках** (34/34 у записаному семплі `docs/15` §25.4; підтверджено й на Extract-картках у §46.20) (R) | **Ні** | Поле існує, проте не заповнюється в реальних даних; не сигнал. |
| дата старту | `startedAt` = null скрізь | **Ні** | Використовувати можна було б лише непорожнє значення — жодного не спостережено. |
| нещодавно змінено | `lastActivityAt` — по кожній картці, ISO UTC, non-null (R, 34/34) | **Частково** | Лише «Trello зафіксував якусь активність у цей момент». Не каже яку. Не задокументовано в MCP; бампається переміщенням/перевпорядкуванням (R); може не бампатись усіма діями (аналог REST, `docs/15` §25.4). |
| хто змінив | `members` (R) | **Ні** | `members` — учасники картки (виконавці), порожнє в усіх спостережених; це не автор дії. Actor-поля немає. |
| прогрес чеклиста | Немає у спостережених payload'ах; `trelloReadChecklist` увімкнений, але payload'ів не збережено | **Не доведено (N)** | Трактувати як недоступне, доки не буде семплу. Skill'и вже кажуть «лише якщо fresh result реально це віддає». |
| історична зміна чеклиста | — | **Ні** | Немає history-примітива; у D — лише «Activity & History: coming soon». |
| *(дод.)* час створення | Окремого поля не спостережено. Кандидат: 24-hex id містить час створення — для двох карток #26 він збігся до секунди з `lastActivityAt` у `docs/15` §25.4 (10:31:07 / 10:31:24) | **Ні (кандидат)** | Не задокументовано для цього MCP (id в ARI-обгортці); лише 2 точки збігу. Не використовувати без окремої live-перевірки; до питання завершення/руху не стосується. |
| *(дод.)* час оновлення | Окремого `updatedAt` не спостережено; лише `lastActivityAt` | **Ні** | Див. рядок «нещодавно змінено». |
| *(дод.)* project scoping | `labels` на картці; `board{id,name}`; `trelloReadBoard list_labels` (R). Проєкт = label на спільній дошці | **Так** (для поточного зрізу) | `uses` у label рахує й архівні картки (Extract: 18 = 10 open + 8 archived). Хронологічні обмеження ті самі. |
| *(дод.)* коментарі | — | **Ні** | D: «Comments — coming soon». |
| *(дод.)* історія дій card/list/board | — | **Ні** | D: «Activity & History — coming soon». |

## 8. Безпечне значення `lastActivityAt`

**Що воно встановлює (R):** per-card ISO-UTC мітка «остання зафіксована Trello активність». Присутнє на кожному вузлі `list_by_board` (34/34). Немає на вузлах `list`/`get` дошки. Семантика в MCP **не задокументована**.

**Докази слабкості:**
1. Переміщення й перевпорядкування карток бампають його без роботи (`docs/15` §26–§27).
2. Створення теж його задає: у двох карток #26 `lastActivityAt` = час створення (§7, рядок «час створення») — тобто *«створено»* і *«над цим працювали»* не розрізняються.
3. Аналог REST `dateLastActivity` має власне застереження: деякі дії його оновлюють без запису дії, а деякі дії — ні (`docs/15` §25.4).
4. Спостережена помилка моделі (`docs/15` §26/§28/§36) — «нещодавно закриті», «остання дія 2 дні тому», «живий робочий процес» з `lastActivityAt`. Навіть пояснення в самому #28 (`docs/15` §46.20: «картка перейшла In progress → This week о ~07:48») було висновком із порівняння двох *знімків* + `lastActivityAt`, а не доведеною подією.

**Безпечні використання:**
- процитувати дослівно: «Trello recorded activity at <ISO>» (без дня тижня, локального часу, «N днів тому»);
- сказати, що *якась* активність зафіксована в цей момент;
- як грубий фільтр «які картки варто розглянути уважніше» — лише як підказку для читання, ніколи не як твердження.

**Небезпечні використання (заборонено):** доказ завершення; доказ переміщення; доказ reopen; доказ прогресу/«живої» роботи; доказ, що працювала конкретна особа; момент, коли картка «застоялась»; арифметика віку/вікна («цього тижня», «N днів тому») — модельна арифметика дат уже помилялась на верифікованих даних.

**Застереження для вікон часу:** твердження «жодної активності у вікні» — теж лише факт про поле («остання зафіксована активність раніше X»), не «нічого не відбувалось». Порівняння дати з вікном потребує календарної арифметики моделі — окремий ризик (див. §22).

## 9. Completed-work feasibility

**Питання:** «Що я реально завершив цього тижня?» → **Результат B — PARTIAL.**

- Поточний стан «завершено» **розрізнити можна** (список `Done`, `dueComplete`, `closed`) → це не результат C.
- Хронології завершення **немає** → це не результат A. B **не піднімається до A.**

Що Djonik може чесно сказати зараз: «Зараз у Done такі картки … (за списком/`dueComplete`); коли саме вони завершені — Trello не віддає; для частини з них Trello зафіксував активність у ISO …, але це не доказ завершення в цей період». Не можна: «цього тижня ти завершив X».

## 10. Completion-date feasibility

**Не підтримується.** Немає `completedAt`, події завершення, чи дії. `lastActivityAt` не є заміною (§8); `dueComplete` — bool без часу.

## 11. Movement-history feasibility

**Не підтримується.** Доступний лише поточний `list`. Ні факт переходу A→B, ні його час недоступні. Порівняння знімків потребує збереженого попереднього стану (= history/snapshot store — поза scope, §18). Усередині *однієї* Managed Session раніше отримані tool-результати лишаються в контексті, тож порівняння «з тим, що я читав раніше в цій розмові» технічно можливе, але це не історія за період.

## 12. Reopen-history feasibility

**Не підтримується.** Ні події reopen, ні часу; write-поверхня взагалі не має reopen (лише mark done). Поточний «не-Done» не відрізняє «не завершували» від «повернули».

## 13. Project-scoped review feasibility

**Так — для поточного зрізу.** «Проєкт» = label на спільній дошці Djonik (підтверджено #28): `list_by_board` + фільтр за `labels`; `filter:"all"` додає архівні картки (`closed:true`). Ізоляція від інших проєктів структурно можлива (як у #28). Хронологічні обмеження §7–§12 діють без змін.

Спостереження: `filter:"all"` повернув 53 картки при `limit:50` і `hasNextPage:false` (семантика `limit` неясна, не кап на рівні дошки). Архівні картки накопичуються → payload ретроспективи зростає з часом; вартісний ризик, не блокер.

## 14. Plan-vs-actual feasibility

**Plan-сторона:** явно прийняті плани/зобов'язання **вже можуть бути** у durable Memory. `DJONIK_MEMORY_INSTRUCTIONS` (`src/djonikClient.ts:330`) велить записувати прийняті плани та явні зобов'язання й називає їх «historical/decision context, not live task state»; Foundation 12 (#13) валідував персистентність у нових Session'ах. Вміст Memory для цього дискавері **не читався** (потрібен архітектурний висновок, а не аналіз історії користувача). Обмеження: план — вільний текст без структурного зв'язку з id карток → зіставлення по назві через свіже читання, з ризиком неоднозначності.

**Actual-сторона:** свіжий Trello дає лише **поточний** стан (Done/closed/`dueComplete`/список). «Виконано *в межах періоду плану*» довести неможливо — не відрізнити картку, що стала Done до плану чи після.

**Класифікація: PARTIALLY SUPPORTED** — підтримується «чи виглядає пункт плану виконаним *зараз*»; **заблоковано відсутністю actual-history** твердження «виконано за планом / у строк / цього тижня». Не будувати нічого; при нестачі доказів казати про обмеження явно.

## 15. Memory boundary

- Memory може бути **plan-стороною** (прийняті плани/зобов'язання) і стабільним контекстом проєкту.
- Memory **ніколи** не доказ того, що робота завершена/переміщена/повернута (#29, `docs/00` §5, §6).
- Транзієнтні висновки ретроспективи («Extract просів цього тижня», «Daniel був перевантажений») **не** записуються автоматично.
- У цьому слайсі **0 записів у Memory**.

## 16. Mutation boundary

Ретроспектива — read-only. Zero Trello writes за замовчуванням. Якщо Daniel окремо попросить діяти за рекомендацією — мутацію, target-resolution і same-card verification повністю веде `task-management` (`trelloWriteCard`; reopen не підтримується). Дискавері не змінило жодного write-шляху.

## 17. Architecture recommendation

Порядок рішень із issue #29: (1) існуюча поведінка Agent/Session → (2) існуюча Trello read-поверхня → (3) Memory лише для стабільного контексту → (4) один bounded Skill, *якщо* дискавері виправдовує → (5) мінімальний детермінований safeguard, лише за виміряної прогалини.

**Вердикт: Outcome B** — поверхня підтримує **current-state retrospective**, але не справжню історію.

- Не **A** (надійної хронології немає).
- Не **C** («жодного Skill»): підтримувана частина (поточний стан, ізоляція проєкту, чесні межі) реальна, а **режим збою повторюваний і виміряний** у #28 — модель вигадує хронологію з `lastActivityAt` («нещодавно», «остання дія N днів тому»). Багаторазова guardrail-настанова обґрунтована.
- Не **D**: history/action-інструмент **не існує** в провайдера (README: coming soon); «присутнього, але вимкненого» read-інструмента немає — вимкнені лише п'ять write-інструментів.

Рекомендація: **обмежений source-only Skill `work-review`** — «що відомо / що невідомо», без ін'єкцій чужої логіки:
- ведення відповіді від того, що *доведено зараз* (Done/закрито/в роботі за свіжим читанням), окремо «що Trello не віддає» (коли завершено/переміщено/повернуто);
- жорсткі заборони з §8; цитування лише «Trello recorded activity at <ISO>»;
- plan-vs-actual лише як «чи виглядає виконаним зараз», плюс явне обмеження;
- один ретроспективний висновок / наступний PM-крок; без скорингу і без фейкової хронології;
- write/target/verify — виключно `task-management`; Project Health — вже прийнятий шлях (не змінювати).

**Хто володіє:** починати на координаторі (Haiku), **не** розширювати specialist v4 (це змінило б прийнятий #28-шлях; новий specialist потребує окремого виміряного обґрунтування — Wave F).

**Upstream-watch:** якщо провайдер випустить «Activity & History» — це буде новий інструмент; окремий дискавері-слайс має перевірити його реальний вихід, перш ніж будь-що змінювати.

## 18. Явно НЕ обґрунтована інфраструктура

Не обґрунтовано (окреме виміряне рішення потрібне для кожного):
- БД / event store / persistent activity log / analytics-сервіс;
- Trello mirror або збережені знімки (snapshot diff як «історія»);
- Trello webhook ingestion (поза scope #29; лише кандидат на майбутнє окреме рішення, якщо провайдер лишиться без history-примітива);
- scheduler/cron, проактивні сповіщення;
- новий specialist agent, Advisor;
- vector DB / RAG, кастомний Messages loop, phrase/intent router;
- детермінований date-window helper (розглядати лише якщо live-валідація виміряє помилки арифметики вікон);
- увімкнення будь-чого (Calendar, вимкнені write-інструменти).

## 19. Наступний bounded implementation-слайс (рекомендація)

**#29 / слайс 2 — source-only Skill `work-review` + детерміновані source-тести. Без paid Session.**

1. Написати `.claude/skills/work-review/SKILL.md` за §17 (за зразком `project-health`: fresh-read, заборони `lastActivityAt`, чесні межі, Memory/mutation boundary). Поля, яких немає в (D)/(R) (чеклісти, `get`-поля), — «лише якщо fresh result реально їх віддає».
2. Розширити `src/skills.test.ts` (за наявним патерном) джерельними перевірками: обов'язкові заборони, відсутність тверджень про хронологію, cross-references на `task-management`/`daily-planning`/`weekly-planning`, узгодженість із `project-health`.
3. Не змінювати: production Agent, specialist, Skills, runtime.
4. Звіт для Product Lead review.

**Потім (окремий, дозволений PO слайс 3):** синхронізація/attach Skill до production Agent (це мутація Agent → потребує явного дозволу) і bounded live-acceptance за guardrail #29: ≤ $0.30 / ≤ 2 paid Session / 0 Trello-мутацій; сценарії A–F з issue #29.

**Опціонально перед/паралельно слайсу 2 — закрити прогалини спостереження** одним авторизованим, structure-only live-семплом (див. §22): повний список полів `trelloReadCard get`, вихід `trelloReadChecklist`/`trelloReadList`. Слайс 2 від цього **не залежить** (Skill формулюється умовно).

## 20. Files changed

- `M docs/02_DEVELOPMENT_ROADMAP.md` — governance sync (Частина A) + вказівка на цей звіт.
- `?? docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md` — цей звіт.

Без змін: runtime-код, Skills, Agent-конфіг, `claude-lock.json`, `managed-agents/`.

## 21. Checks

| Перевірка | Результат |
|---|---|
| `npm run typecheck` | пройшло, без помилок (`tsc --noEmit`) |
| `npm test` | **302 tests, 302 pass, 0 fail, 0 cancelled, 0 skipped** (baseline 302/302 збережено) |
| `git diff --check` | чисто, exit 0 |
| `git status --short` | див. §24 |

## 22. Limitations

1. **Немає свіжого live-семплу сьогодні.** Матриця = документація провайдера (D) + записані спостереження #28 (R). Прямий MCP-виклик недоступний без OAuth-токена з vault; масове читання записаних Session-подій відхилено класифікатором PII і не повторювалось.
2. **Не спостережено (N):** повні поля `trelloReadCard get`; вихід `trelloReadChecklist`, `trelloReadList`, `trelloReadWorkspace`; структура «mark done» у write-схемі; чи є приховане поле часу/дії. Ці пункти трактуються як **недоступні**, доки не буде семплу.
3. **Сирі MCP-схеми не оглянуто** (недоступні через Agent-retrieve/Console/без OAuth).
4. Семантика `complete` і зв'язок `dueComplete` ↔ «Done» для карток без `due` не встановлені.
5. ID-декодування часу створення — лише кандидат (2 точки).
6. Арифметика «цього тижня» моделлю ненадійна (уроки #28) — ризик для майбутніх live-сценаріїв; окремий safeguard не обґрунтований без виміру.
7. Розмір payload'у зростає з архівними картками (`filter:"all"`).

**Варіанти закрити прогалину (рішення за Product Owner, я їх не виконував):** (а) дозволити один цільовий structure-only перегляд *одного* вже задокументованого запису Session (лише ключі/типи, без значень) — потребує явного дозволу в налаштуваннях; (б) один мінімальний paid-Session проб із запитом виклику `trelloReadCard get`/`trelloReadChecklist` (бюджет за guardrail #21); (в) Daniel вставляє/експортує один зразок `get`.

## 23. Явне підтвердження меж

- **0 paid Managed Sessions**, **$0 inference**, 0 `user.message`.
- **0 Trello writes**, 0 Calendar-викликів, **0 Memory writes**.
- **0 Agent mutation** (лише `agents.retrieve`), **0 Skill mutation**, 0 змін specialist/`claude-lock.json`.
- Read-only викликів API: `agents.retrieve` ×2, `sessions.list`, `sessions.events.list` ×1 (лише типи подій). Публічні читання GitHub; 1 неавтентифікована HTTP-проба + публічні OAuth-метадані `mcp.trello.com`.
- **Без** commit / push / deploy / нової гілки / змін GitHub issues.

## 24. `git status --short`

```
 M docs/02_DEVELOPMENT_ROADMAP.md
?? docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md
```
