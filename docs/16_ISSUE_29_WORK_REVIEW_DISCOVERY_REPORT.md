# Звіт по Issue #29 — Wave C2: дискавері доказової бази для work review / retrospective

> **2026-09-21 post-audit qualification:** Sections 26–27 preserve the failed attach and successful resource rollback as historical evidence. The former §27.16 hardening-only next step, §27.17 NOW assertion and §27.15 blanket claims about relay coverage are superseded by [docs/17](17_DJONIK_V1_ARCHITECTURE_AUDIT.md), the revised #29 and [canonical roadmap](02_DEVELOPMENT_ROADMAP.md). The work-review Skill already explicitly prohibited chronology/time conversion; regex source checks do not prove behavior. Offline fixtures expose broader completion/relay risks beyond the single budget-stop sample (#32). Agent v21 equivalence does not attest an already-serving Telegram Session (#33). Implement #31/#32 first, then simplified current-state review and isolated ownership validation; no production reattach merely to run an experiment. No runtime/Skill change is made by this addendum.


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

## 25. Slice 2 — source-only `work-review` Skill

> **Обсяг:** лише source-only Skill і детерміновані source-тести. 0 paid Sessions, 0 inference, 0 викликів Trello/Calendar/Memory, жодної мутації Agent, жодного sync/apply Skill. §1–§24 вище — звіт дискавері (закомічений як `cdb132e`) — не змінювались.

**Pre-flight:** `HEAD` = `origin/main` = `cdb132e1cf08b9f8eeb825675db9dc766c5ab184` («docs: record work review evidence discovery»); робоче дерево чисте; #29 OPEN без коментарів; canonical NOW у `docs/02` (рядок 347) = Wave C2 (#29). `docs/02` у цьому слайсі **не змінювався**.

### 25.1 Прийняте рішення дискавері

**Outcome B:** поточна поверхня підтримує current-state retrospective, але не справжню історію (немає Activity & History у Trello MCP; `lastActivityAt` — не доказ завершення/руху/reopen/прогресу; дата завершення, історія переміщень і reopen недоступні; plan-vs-actual — частково: Memory дає plan-сторону, Trello — лише поточний actual). Реалізовано свідомо обмежений source-only Skill.

### 25.2 Архітектура Skill

Один Skill на рівні Claude-native primitives (Skill, а не код): без runtime-змін, без нового specialist, без БД/snapshot/event store/webhook/scheduler/router. Skill описує *як працювати*, а не змінні факти проєктів (`docs/01` §7). Він не створює конкуруючого Djonik-ідентитету і не дублює Project Health.

### 25.3 Точний source path

`.claude/skills/work-review/SKILL.md` (~11.5 KB, 11 секцій; для порівняння `project-health` ~10.8 KB). Frontmatter: `name: work-review`; `description` покриває (а) current-state review-запити («Що зараз із тим, що ми планували…», «Дай короткий review по Extract», …) і (б) history-limited ретроспективні запити («Що я реально завершив цього тижня?», «Коли ця задача перейшла в Done?», …), з явним «Read-only; не health-оцінка, не planning, не мутація».

Секції: Scope and handoffs · Gather fresh evidence first · What Trello can and cannot prove · `lastActivityAt` · What Done, closed, and dueComplete mean · Accepted plan versus current actual · Project scope · Form the review · Read-only · Memory boundary · Style.

### 25.4 Правила current-state evidence

- Кожне точне current-state твердження (list/status, Done membership, closed/archived, `due`, `dueComplete`) вимагає **свіжого direct read у цьому ході**; `trelloSearch` — лише discovery і не авторитетний для полів (відсутній `due` у search нічого не доводить).
- Fresh Trello outranks Memory, попередню розмову та inference; використовуються лише значення, які свіжий результат **реально** повернув (без припущень про labels/members/чеклісти/дати старту).
- Чесно зафіксовано #18: Skill вимагає fresh read, але не додає middleware/router/custom loop; відповідь із точними claims без свіжих доказів — неприйнятна.
- Для питань про архівне — читати так, щоб `closed`-картки були видимі (типовий список показує лише open) — загальна вказівка без прив'язки до конкретного параметра.

### 25.5 Правила історичного обмеження (hard rule)

З одного лише поточного стану **ніколи** не стверджувати: завершено цього тижня/сьогодні/вчора/у період; переміщено A→B чи коли; reopen чи коли; «повторно зривалось»; «прогресувало в період» чи «проєкт забрав увагу»; хто працював над карткою в період. На такий запит: (1) одне коротке речення, що Trello показує поточний стан, але не історію переходів, потрібну для доказу; (2) все одно дати корисні поточні докази; (3) без вигаданої хронології. Не писати «есе про обмеження» — застереження лише там, де питання справді залежить від історії. Додано: покладатися на те, що свіжий результат реально містить, а не на припущену можливість.

### 25.6 Контракт `lastActivityAt`

Вузько: «Trello зафіксував якусь активність на картці в цей raw-момент». Допускається лише як слабка підказка, які картки прочитати уважніше; **не** доказ завершення, переміщення, reopen, прогресу, «активної» роботи, конкретного виконавця, staleness чи належності до періоду (заборонено рішення «картка входить/не входить у період»). Цитувати лише як «Trello recorded activity at <ISO>»; не виводити weekday, локальну дату/час, «N днів тому», сьогодні/вчора/завтра, «this week» membership — доки майбутня детермінована date-boundary явно не візьме ці обчислення. **Розширення поза буквою завдання (свідоме, мале):** та сама стриманість застосована до `due` (цитувати ISO як записано, без самостійно обчислених weekday/локального часу/countdown; точне формулювання дедлайну після запису лишається за `task-management`), бо модельна арифметика дат уже помилялась на верифікованих даних (#28).

### 25.7 Семантика Done / closed / dueComplete

- Картка у списку `Done` = workflow-свідчення, що дошка Daniel зараз трактує її як Done → «зараз у Done», **не** «Daniel завершив її DATE».
- `closed` = зараз архівована/закрита, не обов'язково завершена.
- `dueComplete` = поточний boolean без часової мітки завершення.
- Універсальної провайдерної події завершення немає; відсутність у Done зараз не каже, чи картка коли-небудь була Done або повернута.
- Якщо сигнали суперечать — сказати, що докази змішані, а не «узгоджувати» здогадом.

### 25.8 Контракт plan-vs-actual

Memory (або явно прийнятий у цій розмові план) дає **лише** plan/context-сторону; свіжий Trello — **лише** поточний actual. Дозволено: «У плані було A, B, C; зараз A у Done, B в In progress, C у Backlog.» Заборонено без історії: «A виконано цього тижня», «B зірвали вчора», «C повернули назад», «вчасно/із запізненням», обчислення lateness/countdown. Обговорена, але не прийнята пропозиція — не план; Trello-список на кшталт «This week» — не прийнятий план, якщо Daniel так не сказав; за відсутності прийнятого плану — сказати про це і дати current-state review. Неоднозначне зіставлення пункту плану з карткою → одне коротке уточнення або назвати непіддані зіставленню пункти; не вгадувати. Memory ніколи не доводить завершення/рух/reopen.

### 25.9 Memory boundary

Транзієнтні ретроспективні висновки («проєкт відставав», «Daniel був перевантажений», «забрав найбільше уваги», «тиждень (не)продуктивний») автоматично в durable Memory **не** пишуться; review перераховується зі свіжого Trello щоразу. Стабільні прийняті уроки/рішення — під наявною Memory policy.

### 25.10 Mutation boundary

Read-only: нуль Trello-мутацій, без залежності від Calendar; review-рекомендація ніколи не міняє картку. Явне прохання діяти → `task-management` (mutation intent, target resolution, bounded write, окрема verification); логіка не дублюється. У Skill немає жодної назви `trelloWrite*`.

### 25.11 Project Health boundary

Skill **не** замінює і **не** дублює прийнятий Project Health: поточну health/risk/waiting/blocking-інтерпретацію веде існуюча Project Health-можливість; для змішаного запиту тут відповідається частина про outcomes, health-вердикт не видається. Blocker називається лише якщо власний доказ картки називає конкретний; інтерпретація health — за Project Health. Daily/weekly-плани — за `daily-planning`/`weekly-planning`. Не змінено: `project-health` Skill, specialist v4, детермінований PH relay finalizer, `task-management`, planning Skills, `studio-intake`, Telegram adapter, due-date safeguard, write verification, `claude-lock.json`, `managed-agents/`.

### 25.12 Додані тести

`src/skills.test.ts`: **+28 source-тестів** (семантичні regex-перевірки суті, без exact-answer snapshot'ів і без жорсткої україномовної фрази), що покриває всі 16 обов'язкових пунктів: (1) fresh Trello для точних current-state claims; (2) без вигаданої історії; (3) без виведення дати завершення; (4) без виведення руху/reopen; (5) вузька семантика `lastActivityAt`; (6) `lastActivityAt` ≠ прогрес/staleness/завершення; (7) без relative/weekday/date-window із `lastActivityAt`; (8) Memory = лише plan/context; (9) Trello = поточний actual; (10) неоднозначне зіставлення → уточнення; (11) ізоляція проєкту; (12) read-only; (13) явна дія → `task-management`; (14) Project Health ownership не дублюється; (15) стисло й evidence-first; (16) без productivity-скорингу. Додатково: валідний frontmatter і покриття trigger-фраз без претензії на health/planning/mutation; відсутність числових вікових порогів; відсутність `trelloWrite*`; чесність щодо #18; Done/closed/`dueComplete`; відсутність гарного «This week»-як-плану; збереження Memory-boundary; **регресійний тест ізоляції** — жоден з існуючих Skills (`daily-planning`, `weekly-planning`, `task-management`, `studio-intake`, `project-health`) не посилається на `work-review`, а сам `work-review` не переповторює health-стани Project Health. Усі існуючі тести збережено. Валідність тестів перевірено: після видалення ключового правила з копії Skill відповідні regex перестають співпадати.

### 25.13 Files changed

- `?? .claude/skills/work-review/SKILL.md`
- `M src/skills.test.ts` (+246 рядків)
- `M docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md` (лише додано цей §25)

Без змін: `docs/02`, runtime-код, Agent-конфіг, `claude-lock.json`, `managed-agents/`, інші Skills.

### 25.14 Checks

| Перевірка | Результат |
|---|---|
| `npm run typecheck` | пройшло, без помилок |
| `npm test` | **330 tests, 330 pass, 0 fail, 0 cancelled, 0 skipped** (302 baseline + 28 нових) |
| `git diff --check` | чисто, exit 0 |
| `git status --short` | див. §25.18 |

### 25.15 Limitations

1. Це **лише source**: Skill не завантажений у Claude-workspace і не приєднаний до production Agent, тому на live-поведінку Djonik **не впливає**. Тести доводять наявність правил у тексті, а не те, що модель їх виконує.
2. Виконання Haiku-координатором **не виміряне**. Досвід #28: навіть спрощені Skill-настанови Haiku виконував нестабільно (відхилення в точності, relative-датах, `lastActivityAt`-як-прогрес). Ризик, що «чесна відповідь про обмеження» дрейфує, лишається невимірним до live-acceptance.
3. **Маршрутизація:** межа «review» vs «health» (наприклад «Що зараз по Extract?» vs «Дай review по Extract») семантична; ризик неправильного вибору Skill/шляху між `work-review`, `task-management` і Project Health виміряється лише live.
4. Спостережні прогалини дискавері (§22) лишаються: повні поля `trelloReadCard get`, вихід `trelloReadChecklist`/`trelloReadList` — тому Skill формулює їх умовно («лише якщо свіжий результат їх віддає»).
5. Календарна арифметика «цього тижня» навмисно **не** делегована моделі й не реалізована детерміновано; питання «за період» отримують лише чесне обмеження + поточний стан. Окрема date-boundary не обґрунтована без виміру.
6. Плани, прийняті у ході live-валідації, за політикою Memory можуть бути записані агентом у Memory — це треба врахувати в guardrail «0 Memory writes» майбутнього слайсу.

### 25.16 Рекомендація наступного live/config-слайсу

**#29 / слайс 3 (потрібна явна авторизація Product Owner — це мутація Agent і платні Session'и):**

1. Завантажити `work-review` як custom Skill у Claude workspace і приєднати до **координатора** (Haiku) — нова версія production Agent (v20); специфікатор v4, Project Health Skill, roster і finalizer **не чіпати**.
2. Перед inference задекларувати guardrail за #21/#29: **≤ $0.30 list cost, ≤ 2 paid Managed Sessions, 0 Trello-мутацій**; більше — лише з approval PO.
3. Сценарії з issue #29: A (completed work — має чесно дати поточний Done без дат завершення), B (moved/reopened — явне обмеження, без виведення з `lastActivityAt`), C (project-scoped — ізоляція), D (plan-vs-actual — Memory лише як plan; за потреби плануйте без нового Memory write), E (0 мутацій/0 Calendar), F (регресія: task-management, planning, studio-intake, Project Health delegation + relay finalizer, same-card verification, due-date safeguard). Кілька ходів в одній Session, щоб вкластися у 2 Session'и.
4. Окремо виміряти маршрутизацію review↔health і чи дотримується Haiku заборон (без «нещодавно», «N днів тому», «цього тижня ти завершив»).
5. За потреби (і лише за окремого рішення PO) закрити спостережні прогалини §22 одним авторизованим structure-only семплом.

### 25.17 Явне підтвердження меж

- **0 paid Managed Sessions**, **$0 inference**, 0 `user.message`.
- **0 викликів Trello**, **0 Calendar**, **0 Memory** (жодних читань чи записів).
- **0 Agent mutation** (навіть `agents.retrieve` у цьому слайсі не виконувався), **0 Skill mutation / live sync/apply**.
- Локально: створено один source-файл Skill, додано тести, оновлено цей звіт. Жодного runtime-коду, БД/snapshot/event store, webhook, scheduler, router, нового specialist.
- **Без** commit / push / deploy / нової гілки / змін GitHub issues.

### 25.18 `git status --short`

```
 M docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md
 M src/skills.test.ts
?? .claude/skills/work-review/
```

(`git status` згортає нову директорію до одного рядка; єдиний файл усередині — `SKILL.md`. `git diff --check` — exit 0; одноразове git-попередження про LF→CRLF для цього `.md` — стандартна поведінка `core.autocrlf` на Windows, не whitespace-помилка.)

## 26. Slice 3 — production `work-review` attach and bounded live acceptance

> **Загальний вердикт: FAIL (live acceptance не прийнято).** Конфігураційна частина — **PASS** (Skill синхронізовано байт-в-байт, production v19 → v20 зі зміною лише `skills`, специфікатор v4 не чіпано). Живі ходи: **Turn 1 — FAIL** за критеріями (працював Skill і свіжий Trello, чесно названо обмеження історії, але додано непідтверджену хронологію з `lastActivityAt` і фактичні помилки); **Turn 2 — маршрутизація PASS, relay-межа НЕ перевірена** (Session упирається в budget cap). **Safety:** 0 Trello-записів / 0 Calendar / 0 Memory-записів — PASS. **Вартість: $0.32 > $0.30 — ПЕРЕВИЩЕННЯ на $0.02 (FAIL критерію 20), спричинене моїм рішенням про Turn 2.** Без retry, без збільшення бюджету, без відкату.

### 26.1 Авторизація Product Owner

Явно дозволено: (1) sync/upload reviewed source-only Skill `work-review`; (2) attach до production координатора, очікувано v19 → v20; (3) bounded платна live-валідація: ≤ 2 paid Sessions, **жорсткий загальний ceiling $0.30**, бажано одна multi-turn Session, 0 Trello-записів / 0 Calendar / 0 Memory-записів; без додаткових витрат понад $0.30 без нового approval.

### 26.2 Accepted base SHA

`51c0b719e0bc98c7f84e0948f4337755161da176` («feat: add bounded work review skill»). Pre-flight: чисте дерево, `HEAD` = `origin/main`; #29 OPEN, коментарів немає; canonical NOW у `docs/02` = Wave C2 (#29).

### 26.3 Метод sync Skill

**Офіційна Skills API через встановлений SDK** (`@anthropic-ai/sdk` 0.125.0): `client.beta.skills.create({ files: [toFile(bytes, "work-review/SKILL.md")] })` — той самий механізм, що вже використовувався в цьому проєкті для `studio-intake`/`task-management` (`docs/13` §23, `docs/14`). Актуальні офіційні доки (Managed Agents → Skills, перевірено 2026-09-21) описують також `ant apply <skill-dir>` (пише `claude-lock.json`), але `ant` у середовищі не встановлено, а завантаження бінарника потребувало б окремого approval; я його не завантажував. **Dry-run:** Skills API його не має; замість нього виконано (а) `skills.list({source:"custom"})` — 5 наявних custom Skills, жодного `work-review` (перевірено двічі: перед create і безпосередньо в create-скрипті); (б) для завантаження використано байти закоміченого blob'а (`git show HEAD:…`, sha256 `63864a4d…2783`, 11 515 байт; збігається з working copy і blob `4f028c49…`); (в) після create — read-back і `versions.download`. Операція торкнулась **лише** `work-review`; `claude-lock.json` цей маршрут **не змінює** (файл не модифіковано).

### 26.4 Skill id / version / read-back

- Skill id: **`skill_01RMRGWbrjW9EHSieymZ2NDV`**; `display_name`/`name`: `work-review`; `source: custom`; версія: **`skver_01JCf5J73Sik966ZR31u6Rhr`** (єдина; `latest`); `created_at` 2026-09-21T10:24:09.416406Z.
- `versions.retrieve`: `name = work-review`, `skill_id` збігається; `description` (820 симв.) збігається з frontmatter джерела.
- `versions.download` → zip (4 937 байт) із єдиним файлом `work-review/SKILL.md`, 11 515 байт; SHA-256 **`63864A4D…692783` — ідентичний** закоміченому джерелу та working copy (**byte-identical**).
- Інші п'ять custom Skills не змінились (ті самі `latest_version_id` і `updated_at`).

### 26.5 Production v19 pre-flight

`agents.retrieve` (read-only) `agent_01WGRHDBjQa3eMhoGJMmQ1dh` та специфікатора; усі перевірки PASS: v19, `updated_at 2026-09-21T08:01:32.367348Z`; `claude-haiku-4-5-20251001`/standard; `system` довжина 3 664 (sha256-префікс `03b33a909123bb40`); рівно чотири координаторські Skills (`task-management`, `daily-planning`, `weekly-planning`, `studio-intake`, усі `latest`), `project-health` відсутній; Trello toolset `default enabled`, лише `trelloWriteCard` enabled, п'ять інших writes `enabled:false`; Calendar приєднано, `default enabled:false`, без overrides; `multiagent` = `coordinator` з рівно одним записом `{agent_01KNiQDzzPjaMU6LLF4mU6uM, v4, type agent}` (без Advisor/self). Specialist: v4, `updated_at 2026-09-21T08:00:37.180815Z`, Sonnet 5 / effort high, Skill pinned `skver_01JLTtMvUgfEqdcBBGj4WGVm`, рівно `trelloSearch`/`trelloReadBoard`/`trelloReadList`/`trelloReadCard`, `multiagent null`, `system` = тіло `managed-agents/project-health-specialist.md`; `claude-lock.json` → v4. **Дрейфу немає.**

### 26.6 Точний production update request

Безпосередньо перед update production v19 знову отримано і перевірено як deep-equal до збереженого snapshot (true). `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)` з тілом **лише** `version` + `skills` (усі інші поля опущені — за офіційною семантикою `agents.update` пропущені поля зберігаються, `skills` замінюється цілком):

```json
{
  "version": 19,
  "skills": [
    { "skill_id": "skill_01WS6JtY1GMu3rGZaKCVR9w1", "type": "custom", "version": "latest" },
    { "skill_id": "skill_01G9DtQEzPYxgw78riFh8k99", "type": "custom", "version": "latest" },
    { "skill_id": "skill_01PTmbvLHJj1HuUxvDKhpaiE", "type": "custom", "version": "latest" },
    { "skill_id": "skill_015c8dtDnWyDfVLwS6NLS7r6", "type": "custom", "version": "latest" },
    { "type": "custom", "skill_id": "skill_01RMRGWbrjW9EHSieymZ2NDV", "version": "latest" }
  ]
}
```

Чотири наявні записи передано без змін і в тому ж порядку; п'ятий — `work-review`, `version: latest` (узгоджено з іншими координаторськими Skills). Без 409.

### 26.7 Production v19 → v20

Відповідь: `version 20`, `updated_at 2026-09-21T10:25:00.306931Z`. `agents.retrieve(…, {version: 19})` після оновлення все ще дорівнює pre-update snapshot.

### 26.8 Повний diff v19 → v20

Порівняно всі поля (canonical deep-equal): змінились **рівно** `version`, `updated_at`, `skills`. Перші чотири Skills deep-identical і в тому ж порядку; п'ятий = `work-review`, рівно один раз; `project-health` відсутній у координатора; `system`, `model` (Haiku), `tools`, `mcp_servers`, Calendar (attached, disabled), `multiagent` (рівно specialist v4, без Advisor/self), `name`/`description`/`metadata` — ідентичні. **PASS.**

### 26.9 Specialist v4 unchanged

Після attach і ще раз після live-run: `agents.retrieve(agent_01KNiQDzzPjaMU6LLF4mU6uM)` = v4, `updated_at 2026-09-21T08:00:37.180815Z`, deep-equal до snapshot. **PASS.**

### 26.10 Session

**`sesn_01QS3gZyCGyrSZKVNSU6F7pR`**, створена 2026-09-21T10:29:18.193654Z; одна Session, два ходи (Turn 1, Turn 2). Primary thread `sthr_01UHjLC7tHqUcpDTVh2HTTne`; child thread `sthr_01GzvVfmc74yhEa1W7sP17RB` (Turn 2).

### 26.11 Safety override (scratch-only)

Реальна `connectToDjonik()` з репозиторію (`src/djonikClient.ts`, HEAD `51c0b71`; жодного репо-коду не змінено, жодного скрипта в репо). Scratch `Proxy` навколо SDK перехоплює **лише** `beta.sessions.create` і: (1) `agent` → `{type: "agent_with_overrides", id: агент, version: 20, tools: <повні tools production v20, де кожен `trelloWrite*` = enabled:false>}`; (2) memory `access` `read_write` → **`read_only`** (та сама `memory_store_id` і `instructions`); (3) `budget: {type: "limit", max_list_cost: {amount: "30", currency: "USD"}}`. Не перевизначалися `model`, `system`, Skills, MCP, `multiagent`; `metadata` не додавалась. Перед `sessions.create` proxy перевірив, що запит репозиторію — це саме production-запит (ключі `agent/environment_id/vault_ids/resources`, bare agent id, `read_write`), і що production/specialist deep-equal snapshot'ам; після create — 17 gate-перевірок через `sessions.retrieve` (v20, Haiku, п'ять Skills із `work-review` рівно раз, roster = specialist v4, шість `trelloWrite*` disabled, Trello reads intact, Calendar disabled, budget 30, Memory `read_only`, usage 0) — **усі PASS до `user.message`**.

### 26.12 Turn 1 — точний prompt

> Що я реально завершив цього тижня по Extract? Дай короткий підсумок.

`user.message` `sevt_01LLM6ExUiev85777XA3aJAn` (2026-09-21T10:29:21.616374Z). Без підказок.

### 26.13 Proof: `work-review` Skill прочитано

Перший tool call primary-thread: `read {"file_path":"/workspace/skills/work-review/SKILL.md"}` (10:29:24.159, `is_error:false`); telemetry `skillRead: true`. Жодного читання `project-health` Skill; жодного child thread.

### 26.14 Точна послідовність свіжих Trello-читань (primary, усі `is_error:false`)

1. `trelloSearch {"action":"search_boards","query":"Extract"}`
2. `trelloSearch {"action":"search_cards","query":"Extract"}`
3. `trelloReadBoard {"action":"list"}`
4. `trelloReadCard {"action":"list_by_board","boardIdOrUrl":"https://trello.com/b/…/djonik"}` (типовий фільтр, 28 open-карток, `hasNextPage:false`)

Свіжі, до точних тверджень; 0 записів. Memory не читалась.

### 26.15 Точна відповідь Turn 1 (verbatim; фінальне `agent.message` `sevt_014PCMdSQhCoACHLgwZTqhbD`, 741 символ = `runtimeReturnedReply`)

```text
Готово. Зараз у Done стоять три карти Extract:

1. **Коментарі по пінкам** — зараз у Done, Trello записав активність 21 вересня о 07:09
2. **Автоматизація рендеру** — зараз у Done, мала дедлайн 18 вересня
3. **Білі аромати 3D відео** — зараз у Done, мала дедлайн 14 вересня
4. **Кохаю пінка** — зараз у Done, мала дедлайн 14 вересня

Щодо того, коли саме вони туди потрапили — Trello показує поточний стан, але не історію переходів, тож підтвердити «за цей тиждень» я не можу.

У **This week** наразі 5 карт Extract, які ще не у Done:
- Брендбук (дедлайн 25 вересня)
- Флакони 1.5 ML
- Білі аромати 50 ML
- Чорні аромати 100 ML
- Флакони 7.5 ML

На фоні — невеликий процес. Коментарі по пінкам було останньою замкненою задачею з Extract.
```

(До нього було ще чотири проміжні `agent.message` — «Пошукаю…» — під час tool-calls; клієнт повертає останнє. Verbatim, крім двох кінцевих пробілів у рядках 2 і «Білі аромати 50 ML», прибраних заради `git diff --check`.)

### 26.16 Вердикт чесності щодо історії — **частково PASS**

✅ Одне коротке речення: «Trello показує поточний стан, але не історію переходів, тож підтвердити "за цей тиждень" я не можу» — саме те, що потрібно; не «есе про обмеження». ✅ Не стверджено «ти завершив X цього тижня», «завершено вчора», «N днів тому», рух/reopen. ❌ **Але** остання фраза «Коментарі по пінкам було **останньою замкненою** задачею з Extract» — це непідтверджена хронологія завершення (порядок завершення), і вона суперечить власному застереженню відповіді.

### 26.17 Вердикт `lastActivityAt` — **FAIL**

Звірка із сирим payload'ом (той самий `list_by_board`): «Коментарі по пінкам» має `lastActivityAt 2026-09-21T07:09:13.924Z`, і лише вона з Done має активність саме цього дня; інші Done — 2026-09-16, 09-15, 09-14. Модель використала `lastActivityAt` як **доказ порядку/часу завершення** («остання замкнена»), а також переписала його словами «21 вересня о 07:09» замість цитати `Trello recorded activity at <ISO>` — час 07:09 є **UTC**, поданий без зони (для Києва це 10:09), тобто фактично оманливий локальний час. Порушено правила Skill: не доказ завершення; лише сирий ISO; без похідних дати/часу.

### 26.18 Інші фактичні перевірки Turn 1 за сирим payload'ом (10 Extract-карток, `filter` за замовчуванням)

- «**три** карти Extract» у Done, але перелічено чотири — **чотири** й є в Done (`Коментарі по пінкам`, `Автоматизація рендеру`, `Білі аромати 3D відео`, `Кохаю пінка`; усі `dueComplete: true`, `complete: true`) → лічильник неправильний.
- «У This week **5** карт» — фактично **шість** (немає «Міні-парфуми адаптація») → пропуск/лічильник.
- Дедлайни (Автоматизація рендеру 2026-09-18T17:00Z, Білі аромати 3D відео 09-14T15:00Z, Кохаю пінка 09-14T10:00Z, Брендбук 09-25T15:00Z) правильні за датою, але подані як «18 вересня» тощо замість цитати ISO (без weekday/countdown — м'яке порушення).
- «На фоні — невеликий процес.» — беззмістовне/непідтверджене речення.
- Ізоляція проєкту дотримана (жодної картки іншого проєкту). Нульова мутація.

### 26.19 Turn 1 — оцінка за критеріями

1 ✅ координатор сам відповів; 2 ✅ Skill прочитано; 3 ✅ свіжий Trello; 4 ✅ без PH child thread; 5 ❌ (є хронологічне «остання замкнена»); 6 ✅ коротке чесне обмеження; 7 ✅ є поточні докази; 8 ❌ по суті сирий перелік 9 карток; 9 ⚠️ «невеликий процес» — розмита/непідтверджена оцінка прогресу; 10 ❌ немає чіткого одного висновку, натомість непідтверджений; 11 ✅ нуль записів. `lastActivityAt` — ❌. **Turn 1: FAIL.**

### 26.20 Рішення щодо Turn 2 і його prompt

Відправлено **за заздалегідь заданим правилом**: після Turn 1 накопичено 6¢ з cap 30¢, залишок 24¢ ≥ поріг 22¢ (моя оцінка вартості delegated Project Health-ходу за #28: 17–21¢). **Це рішення було помилковим:** у #28 було й спостереження $0.31 (§46), яке я мав би взяти як worst-case; фактична вартість Turn 2 — 26¢. Prompt (точно):

> А що зараз по Extract загалом: чи є реальні ризики або блокери і що мені варто зробити далі?

`user.message` `sevt_01QeF2paGkrtJBDuFwC9DtfH` (2026-09-21T10:29:49.968243Z).

### 26.21 Turn 2 — PH delegation proof

Primary thread: 2 model requests, **0 tool calls**, 0 `agent.message`; `session.thread_created` `sevt_01ET4LGJmRWHPDToaLaN97Nx` (agent_name «Djonik Project Health Specialist», thread `sthr_01GzvVfmc74yhEa1W7sP17RB`) → `agent.thread_message_sent` `sevt_01TAy2LZ8Y9BWcXvVpREq26B`. `work-review` Skill у Turn 2 **не** читався — здоров'я не «проковтнув» (критерій 14 ✅). Native delegation ✅; рівно один child thread ✅.

### 26.22 Specialist v4 proof + свіжі Trello-читання

`threads.list`: child = `agent_01KNiQDzzPjaMU6LLF4mU6uM` **v4**, `claude-sonnet-5`, parent = primary. Child читав власний Skill `read /workspace/skills/project-health/SKILL.md` ✅; одне невдале читання Memory (`/mnt/memory/djonik-memory`, `is_error:true`, без запису); Trello (усі `is_error:false`): `trelloSearch search_boards "Extract"` ∥ `trelloReadBoard list` → `trelloReadBoard get` ∥ `list_labels` → `trelloReadCard list_by_board (filter:"all")`. Рівно **одне** child→coordinator повідомлення `sevt_015gCFLfc9VmJN7p1ZQX8Yxp` (specialist final; не оцінювався як redesign):

```text
По Extract (лейбл на дошці Djonik) явних блокерів чи підвислих задач я не бачу — усе активне зараз лежить у списку «This week»: підготовка брендбука та кілька великих виробничих завдань з рендерів флаконів і ароматів (1.5 мл, 7.5 мл, білі 50 мл, чорні 100 мл, міні-парфуми адаптація). З конкретним дедлайном у Trello там лише одна картка — «Брендбук» (2026-09-25T15:00:00Z), решта — це queued задачі-специфікації без дедлайну. Жодна з цих «This week» карток ще не перейшла в список «In progress», тож із самої дошки не видно, що фактична робота по них уже стартувала. У списку Waiting зараз лежать картки інших проєктів (A1, Cossack Labs, Seqthera), по Extract туди нічого не потрапило — залежностей чи чекання по цьому лейблу не видно. Я б перевірив статус саме цих «This week» карток (особливо чи рухається Брендбук із дедлайном 25.09), перш ніж туди додавати нові задачі.
```

### 26.23 PH relay-finalizer — **НЕ перевірено (критерії 6/15 не доведені)**

`agent.thread_message_received` `sevt_01WEbbKfK4LyofUEvs53tCAj` (processed 10:31:42.380) зʼявився в списку подій **після** `session.status_idle`; причина: specialist thread завершився зі `stop_reason: budget_reached` (10:31:42.601), потім primary-thread також `budget_reached` (10:31:43.306) — координатор **не зміг зробити relay-запит**. Тому клієнт побачив `session.status_idle` без coordinator-повідомлення і без ще доставленого specialist-повідомлення → `finalizeProjectHealthReply` не спрацював (`project_health_reply_finalized` у trace відсутній) і `handle.send()` кинув «Djonik produced no text reply for this turn.». Це артефакт budget cap harness'у, а не змін v20: специфікатор і роутинг працювали. **Спостереження (не виправлялося):** finalizer залежить від порядку доставки `agent.thread_message_received` перед `session.status_idle`; за нормального завершення (як у #28 §48) цей порядок дотримується, але при `budget_reached` — ні; у production без cap це не виникає.

### 26.24 Нуль записів / Calendar / Memory

- `trelloWrite*` викликів: **0** (обидва ходи; усі шість write-tools були disabled на рівні Session); специфікатор без write-інструментів.
- Calendar: **0** викликів (toolset disabled; специфікатор без Calendar).
- Memory: mount `read_only`; `memoryVersions.list(session_id=…)` → **0** версій, загальна кількість версій до/після = 23/23; жодного `bash`/`write`/`edit` по `/mnt/memory`.
- Жодних `session.error`. **PASS.**

### 26.25 Авторитетні final idle

- **Turn 1:** `session.status_idle` `sevt_01Rs836CgMaUonyXVhjcWRFr`, `processed_at 2026-09-21T10:29:43.111842Z`, `stop_reason: end_turn` (персистована подія, не лише `sessions.retrieve().status`).
- **Turn 2:** `session.status_idle` `sevt_011d42MjNBuz9XAvdyt425Xi`, `processed_at 2026-09-21T10:31:43.306886Z`, **`stop_reason: budget_reached`** — хід **не** завершився нормально.

### 26.26 Вартість (platform `list_cost`, у центах)

| Показник | Turn 1 | Turn 2 | Разом |
|---|---|---|---|
| Session `list_cost` (кумулятивно) | 6¢ | 32¢ | **32¢ (cap 30¢; перевищення 2¢)** |
| Primary Haiku | 6¢ (6 model requests; in 36 / out 937; cache-create 36 864; cache-read 102 535) | +3¢ (2 requests; in +15 / out +439; cache-create +19 872; cache-read +55 005) | 9¢ |
| Specialist Sonnet (v4) | — | 22¢ (6 model requests; in 12 / out 7 918; cache-create 51 116; cache-read 84 389) | 22¢ |
| Trello-читань | 4 | 5 (child) | 9 |
| Skill-читань | 1 (`work-review`) | 1 (child, `project-health`) | 2 |

(9 + 22 = 31¢ за потоками; Session-total 32¢ через округлення на рівні потоків.) Turn 2 коштував ~26¢. Cap `max_list_cost=30` зупиняє лише **нові** запити — запит, що вже виконувався, може виходити за межу; так і сталось. **Жорсткий ceiling $0.30 порушено на $0.02.** Бюджет не збільшувався, жодного retry, жодної третьої репліки.

### 26.27 Post-run resources

Production `agent_01WGRHDBjQa3eMhoGJMmQ1dh`: **v20**, `updated_at 2026-09-21T10:25:00.306931Z`, deep-equal до post-attach snapshot; `work-review` присутній рівно раз; roster = specialist v4. Specialist: v4, без змін. Custom Skills: шість (п'ять колишніх без змін + `work-review`). Session `sesn_01QS3gZyCGyrSZKVNSU6F7pR` — `idle`, cap досягнуто (не архівувалась). `claude-lock.json`, `managed-agents/` (окрім README, §26.29), runtime, Skill-джерела — без змін.

### 26.28 Загальна класифікація

| # | Критерій | Результат |
|---|---|---|
| 1–5 | CONFIG: Skill синхронізовано; v19→v20; рівно один доданий Skill; решта полів без змін; specialist v4 без змін | **PASS** |
| 6–7 | Turn 1: Skill використано; свіжий Trello | **PASS** |
| 8 | Turn 1: чесне історичне обмеження | **PASS** (коротко й точно) |
| 9 | Turn 1: без вигаданої хронології | **FAIL** («остання замкнена») |
| 10 | Turn 1: без зловживання `lastActivityAt` | **FAIL** |
| 11 | Turn 1: корисний і стислий current-state review | **FAIL** (лічильники, інвентар, розмите речення) |
| 12 | Turn 1: нуль мутацій | **PASS** |
| 13 | Turn 2: health → specialist v4 | **PASS** |
| 14 | work-review не «проковтнув» health | **PASS** |
| 15 | PH relay-межа працює | **НЕ перевірено** (budget_reached) |
| 16 | Turn 2: нуль мутацій | **PASS** |
| 17–19 | 0 Trello writes / 0 Calendar / 0 Memory writes | **PASS** |
| 20 | Загальна вартість ≤ $0.30 | **FAIL** ($0.32) |

**Overall: FAIL.**

### 26.29 Нове evidence-поле, виявлене під час run (уточнення дискавері §7/§22)

У сирому `trelloReadCard list_by_board` (28 open-карток) вузол картки має ключі: `id, name, desc, webUrl, url, list, board, labels, labelsHasMore, due, dueComplete, lastActivityAt, startedAt, closed, complete, members, comments, commentsHasMore, checklists, checklistsHasMore`. Тобто **`comments` і `checklists` присутні в payload'і** (у цьому зрізі всі порожні масиви, `*HasMore:false`; форму елементів не спостережено), `startedAt` = `null` і `members` порожні на всіх 10 переглянутих Extract-картках (на інших 18 картках ці два поля не перевірялись). **Усі чотири Done-картки мають `dueComplete: true` і `complete: true` — зокрема «Коментарі по пінкам» без `due`**, тож `complete`/`dueComplete` у цьому семплі узгоджені зі списком `Done` навіть без дедлайну (все ще без часової мітки). Часові мітки в `comments`/`checklists` — потенційне майбутнє джерело прогрес-сигналу, але поки нічого не доведено.

Також оновлено один застарілий факт у `managed-agents/README.md` («production Djonik is now v19» → «was v19 at C1 acceptance and is now v20»).

### 26.30 Залишковий gap

1. Production **v20 живий із Skill, який не пройшов acceptance**: він спрацьовує на ретроспективні запити і, як показав Turn 1, Haiku може додати хронологію з `lastActivityAt`. Ризик обмежений ретроспективними запитами (Skill не приєднано до PH-шляху), але він реальний для Telegram-трафіку.
2. Relay-межа PH з v20 не перевірена наживо (потрібен ход без budget cap; Turn 2 можна повторити лише за новим бюджетом).
3. Поведінка Skill при порівнянні «review vs health» перевірена лише в один бік (health → specialist, PASS); зворотний бік («review» → не в specialist) — PASS у Turn 1.
4. Причина провалу Turn 1 не ізольована: це може бути слабке слідування Haiku (як у #28), недостатньо жорсткий текст Skill (немає прямої заборони порядкових/суперлативних тверджень на кшталт «остання/перша/нещодавно закрита», ні заборони переписувати `lastActivityAt` у природній мові, ні заборони підрахунків/інвентаря), або обидва.

### 26.31 Явні підтвердження меж

- **Без збільшення бюджету**; **без retry**; третій хід не відправлявся; друга Session не створювалась.
- **Жодної несуміжної мутації Agent/Skill:** єдині живі зміни — створення Skill `work-review` і оновлення `skills` production Agent (v19 → v20); specialist, `project-health`, чотири інші Skills, system, model, tools, MCP, roster — не чіпались; жодного нового specialist/Advisor/router/історичної БД/snapshot/webhook.
- **Жодної зміни runtime-коду**, жодного редагування джерела `work-review`, `claude-lock.json` не змінювався.
- **Без commit / push / deploy / нової гілки.** **#29 лишається відкритим і canonical NOW.** **#18 без змін.**

## 27. Recovery — rollback unaccepted production work-review attach

> **Вердикт: рівно один bounded живий Agent-update виконано й підтверджено — production відкочено v20 → v21; v21 семантично тотожний прийнятій v19 (відрізняються лише `version` і `updated_at`); `work-review` більше не приєднано до production.** 0 Sessions, $0 inference, 0 `user.message`, 0 Trello/Calendar/Memory. Віддалений Skill `work-review` збережено без змін. Specialist v4 не чіпано. §26 вище збережено без змін по суті.

### 27.1 Причина відкоту

Live acceptance Slice 3 (§26) **не пройдено**, тож production v20 працював із Skill, який не прийнято: Haiku вигадав порядок завершення («остання замкнена»), використав `lastActivityAt` як доказ завершення/порядку, переписав UTC-мітку у «локально виглядаючий» час («21 вересня о 07:09»), припустився помилок у підрахунках/інвентарі; PH-relay не було перевірено (`budget_reached`, $0.32 проти $0.30). Product Owner явно авторизував **один** відкат: production v20 → новий v21, що прибирає **лише** `work-review`, без Sessions/inference/Trello/Calendar/Memory, без видалення/архівації віддаленого Skill і без змін specialist.

### 27.2 Repository reconciliation

- Локальний Slice 3 стартував від `51c0b719e0bc98c7f84e0948f4337755161da176`, а `origin/main` уже просунувся до **`1edecaa4b32acbc8b42ff737edeef2b07c37e4d4`** («docs: sync wave c2 roadmap progress»), який змінив лише `docs/02_DEVELOPMENT_ROADMAP.md` (переписав блок Wave C2: +22/−18) — той самий файл, що я редагував локально.
- Локальний незакомічений diff: `docs/01`, `docs/02`, `docs/16`, `managed-agents/README.md` (+231/−3), нічого untracked. Стан збігся з очікуваним, тож зупинки не було.
- **Збереження перед reconcile:** `git diff` → `%TEMP%\djonik-issue29-slice3-before-reconcile.patch` (48 759 байт) плюс повні копії чотирьох файлів у `%TEMP%\djonik-issue29-safety\` (поза репозиторієм).
- **Метод:** `git stash push --include-untracked -m "issue29-slice3-reconcile"` → `git merge --ff-only origin/main` (fast-forward до `1edecaa`) → `git stash pop`. Без гілки, без commit, без `reset --hard` (після pop виконано лише `git reset -q` — mixed, щоб зняти автоматичне staging; робоче дерево не чіпалось).
- **Конфлікт:** лише `docs/02`, один hunk (переписаний upstream абзац «Boundaries remain…» проти мого абзацу «Slice status»). Вирішено без вибору «ours/theirs» wholesale: спершу прибрано лише маркери (збережено обидві сторони), потім блок Wave C2 приведено до фактичного стану — **збережено** всю прийняту синхронізацію `1edecaa` (Slice 1, `lastActivityAt`, plan-vs-actual, Slice 2, weekly-journal-застереження, #18, «no later issue», Boundaries), **замінено** три застарілі пункти («production has not changed yet», «NEXT — Slice 3», «Slice 3 must verify…») фактичним результатом Slice 3, відкатом і наступним кроком, а мій абзац «Slice status» вилучено, бо його зміст перенесено в ті ж пункти. Файли `docs/01`, `docs/16`, `managed-agents/README.md` застосувалися чисто.
- **Результат:** `HEAD` = `origin/main` = `1edecaa4b32acbc8b42ff737edeef2b07c37e4d4`; вся робота Slice 3 (включно з §26) лишилась як незакомічені зміни. Запис `stash@{0}` git залишив після конфліктного pop — це додаткова страховка, я його не видаляв.

### 27.3 Pre-flight production v20 (read-only; усі перевірки PASS)

`agents.retrieve(agent_01WGRHDBjQa3eMhoGJMmQ1dh)`: **version 20**, `updated_at 2026-09-21T10:25:00.306931Z`, deep-equal до збереженого post-attach snapshot; Haiku `claude-haiku-4-5-20251001`/standard; `system` довжина 3 664 (sha256-префікс `03b33a909123bb40`), ідентичний v19; Skills = чотири прийняті (`task-management`, `daily-planning`, `weekly-planning`, `studio-intake`, усі `latest`) **+ `work-review` рівно раз** (п'ята позиція); `project-health` відсутній; `tools`/`mcp_servers` ідентичні v19; Calendar attached, `default enabled:false`; `multiagent` = coordinator, рівно `{agent_01KNiQDzzPjaMU6LLF4mU6uM, v4, type agent}`, без Advisor/self. **Історичну v19 отримано через API** (`agents.retrieve(…, {version: 19})`, `updated_at 2026-09-21T08:01:32.367348Z`) — deep-equal до моєї pre-attach v19-копії; використано як авторитетну базу. Diff v19→v20: лише `skills`, `updated_at`, `version`.

### 27.4 Pre-flight specialist v4

`agent_01KNiQDzzPjaMU6LLF4mU6uM`: v4, `updated_at 2026-09-21T08:00:37.180815Z`, deep-equal до прийнятого snapshot. Також підтверджено, що віддалений Skill `work-review` існує (`skill_01RMRGWbrjW9EHSieymZ2NDV`, latest `skver_01JCf5J73Sik966ZR31u6Rhr`, `updated_at 2026-09-21T10:24:09.416406Z`).

### 27.5 Точний rollback request

Безпосередньо перед update production v20 і baseline v19 знову перевірені як deep-equal до збережених snapshot'ів (дрейфу немає). `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)` з тілом **лише** `version` + `skills` (усі інші поля опущено; чотири Skill-записи взято дослівно з API-версії v19):

```json
{
  "version": 20,
  "skills": [
    { "skill_id": "skill_01WS6JtY1GMu3rGZaKCVR9w1", "type": "custom", "version": "latest" },
    { "skill_id": "skill_01G9DtQEzPYxgw78riFh8k99", "type": "custom", "version": "latest" },
    { "skill_id": "skill_01PTmbvLHJj1HuUxvDKhpaiE", "type": "custom", "version": "latest" },
    { "skill_id": "skill_015c8dtDnWyDfVLwS6NLS7r6", "type": "custom", "version": "latest" }
  ]
}
```

### 27.6 Production v20 → v21

Відповідь: **`version 21`**, `updated_at 2026-09-21T10:51:30.448788Z`. Без 409, без retry. Останній (`latest`) retrieve збігається з `retrieve(…, {version: 21})`.

### 27.7 v19 ↔ v21 — доказ семантичної еквівалентності

Canonical deep-equal усіх полів: відрізняються **лише** `version` і `updated_at`. Skills — рівно чотири, ті самі записи в тому ж порядку; **`work-review` не приєднано; `project-health` не приєднано**. `system`, `model` (Haiku), `tools`, `mcp_servers`, Calendar (attached, disabled), `multiagent` (coordinator → specialist v4, один запис, без Advisor/self), `name`, `description`, `metadata`, `created_at` — ідентичні v19. **PASS.**

### 27.8 v20 ↔ v21 — точний семантичний diff

Відрізняються рівно `version`, `updated_at`, `skills`; дельта `skills`: **`− work-review` (`skill_01RMRGWbrjW9EHSieymZ2NDV`), нічого не додано**. Версія v20 (за `version` param) досі дорівнює збереженому post-attach snapshot (історія цілa).

### 27.9 Віддалений Skill `work-review` збережено

Не видалявся й не архівувався. Після відкату deep-equal до стану до відкату: id `skill_01RMRGWbrjW9EHSieymZ2NDV`, `latest_version_id skver_01JCf5J73Sik966ZR31u6Rhr` (єдина версія), `updated_at 2026-09-21T10:24:09.416406Z`. Нової версії Skill не створювалось. Інші п'ять custom Skills без змін (`project-health@skver_01JLTt…`, `studio-intake@skver_018sJv…`, `weekly-planning@skver_018soR…`, `daily-planning@skver_01TDfM…`, `task-management@skver_012fLb…`).

### 27.10 Specialist v4 unchanged

Після відкату: v4, `updated_at 2026-09-21T08:00:37.180815Z`, deep-equal до pre-flight snapshot. `claude-lock.json` (specialist v4) не змінювався.

### 27.11 Sessions / inference

**0 Sessions, $0 inference, 0 `user.message`.** Жодного платного виклику. Єдина живa мутація — один `agents.update` (v20 → v21); решта — read-only (`agents.retrieve` ×кілька, `skills.retrieve/list`, `skills.versions.list`).

### 27.12 Нуль Trello / Calendar / Memory

Оскільки жодної Session не створювалось, **0 Trello-викликів, 0 Calendar, 0 Memory** (у цьому слайсі не викликався навіть Memory-API).

### 27.13 Docs changed

- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` — production тепер v21, rollback-еквівалент v19; `work-review` існує віддалено, але не приєднаний і не прийнятий; Slice 3 FAILED; specialist v4; #18 без змін.
- `docs/02_DEVELOPMENT_ROADMAP.md` — збережено синхронізацію `1edecaa`; NOW лишається Wave C2 (#29); Slice 1 DONE, Slice 2 DONE, Slice 3 FAILED live acceptance (вимірені збої), відкат, наступний source-only крок.
- `docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md` — додано цей §27 (§26 без змін).
- `managed-agents/README.md` — застаріле «is now v20» → v21 після відкату; specialist v4; `work-review` не в production; #28 acceptance без змін.

Не змінювалось: runtime-код, джерело `work-review`, `src/skills.test.ts`, `claude-lock.json`, інші Skills.

### 27.14 Локальні перевірки

`npm run typecheck` — пройшло, без помилок · `npm test` — **330 tests, 330 pass, 0 fail, 0 cancelled, 0 skipped** · `git diff --check` — exit 0 (лише стандартне LF→CRLF-попередження) · `git rev-parse HEAD` = `git rev-parse origin/main` = `1edecaa4b32acbc8b42ff737edeef2b07c37e4d4`.

### 27.15 Залишковий вимірений gap

1. **Turn 1 провал не усунуто:** вигадування порядку завершення, `lastActivityAt` як доказ завершення/порядку, «натуралізація» UTC-мітки в локально виглядаючий час, помилки підрахунку й майже повний дамп карток, розмита фраза про прогрес. Поточний Skill (`51c0b71`) забороняє це лише загалом і не називає ці шаблони прямо.
2. **PH-relay на v20 не переперевірено** (`budget_reached`). Оскільки v21 ≡ v19, прийняте в #28 §48 лишається чинним; окремої нової перевірки relay-межі не потрібно, доки production не зміниться.
3. **Причина не ізольована:** слабке слідування Haiku vs. недостатня жорсткість тексту Skill; один зразок.
4. **Бюджетна дисципліна:** необов'язковий другий платний хід під жорстким ceiling треба гейтити за **найгіршою** спостереженою вартістю ($0.31 у #28 §46), а не за типовою — `max_list_cost` зупиняє лише нові запити.
5. Спостереження (не виправлялось): finalizer залежить від порядку `agent.thread_message_received` перед `session.status_idle`; порушується лише при `budget_reached`.

### 27.16 Точна рекомендація наступного bounded source-only hardening

**#29 / наступний слайс — source-only hardening `work-review`. Без платної Session, без мутації production Agent, без sync Skill.** Лише репо: `.claude/skills/work-review/SKILL.md` і `src/skills.test.ts`. Додати прямі правила й семантичні тести (без exact-answer snapshot'ів і без жорсткої фрази):

1. **Жодного порядкового/відносного порядку завершення** — «остання завершена», «перша завершена», «найсвіжіше завершена», «нещодавно закрита», «остання замкнена» — ні зі стану, ні з `lastActivityAt`; допустимо лише «зараз у Done» без порядку/часу.
2. **`lastActivityAt` — лише сирий доказ:** або цитата `Trello recorded activity at <ISO>` дослівно, або взагалі не згадувати за замовчуванням; ніколи не переписувати в «21 вересня о 07:09» чи інший локально виглядаючий формат (те саме для `due` — сирий ISO або без часу).
3. **Не наводити підрахунки**, доки вони не потрібні й механічно не збігаються з перерахованим набором (заборонити «три…» перед списком із чотирьох); за замовчуванням не вказувати кількість.
4. **Дефолтний review — кілька найсильніших фактів**, а не майже всі картки; повний перелік лише на явне прохання.
5. **Жодних невизначених суджень про прогрес** («невеликий процес», «йде повільно»); лише те, що виводиться зі списку/`dueComplete`.
6. **Один корисний PM-висновок лише якщо його підтримують докази**; інакше — без висновку.

Додатково в тестах: явна заборона перелічених фраз (regex на заборонені формулювання в *правилах* Skill, а не на відповіді), відсутність гарантії «хронологія допустима», збереження існуючих 28 тестів. **Після цього** (окреме рішення PO, новий бюджет): новий Skill version → повторне приєднання → нова bounded live acceptance з гейтом наступного ходу за найгіршою вартістю. До цього production лишається на v21.

### 27.17 Явні підтвердження

- **Жодної платної Session; $0 inference; жодного retry.**
- **Жодного видалення/архівації Skill**; жодної нової версії Skill; **жодної мутації specialist**; жодних змін system/model/tools/MCP/roster.
- **Без commit / push / deploy / нової гілки / `reset --hard`.**
- **#29 лишається відкритим і canonical NOW.** **#18 без змін.**

## 28. Revised #29 — перший source-only слайс: простий current-state review-контракт і поведінковий рубрик

> **Обсяг:** лише source. 0 paid Sessions, 0 inference, 0 викликів Trello/Calendar/Memory, жодної мутації Agent/Skill у workspace, жодної зміни production. §1–§27 (дискавері, невдалий live-attach, rollback) збережено без змін як історичні докази. Цей розділ виконує revised #29 (issue body 2026-09-21) за канонічним NOW у `docs/02`. Попереднє «hardening-only» продовження (§27.16) і план «$0.30 / 2 Session» **замінені** (docs/17 §4, docs/04 §27).

**Pre-flight:** прочитано в наказаному порядку AGENTS.md, CLAUDE.md, docs/00–04 (docs/04 §27), docs/16, 17, 18, 19, issue #29 (тіло revised; коментарів немає), поточний `SKILL.md`, тести навколо Skills. `HEAD` = `83e739b` («docs: promote issue 29 to NOW»); робоче дерево було чисте; baseline `npm test` = 459/459.

### 28.1 Переглянутий контракт current-state review

Review — це коротке читання **свіжого** Trello про те, де робота стоїть *зараз*, за потреби поруч із явно прийнятим планом. Це не хронологія, не скор і не конкуруючий source of truth. Контракт тепер позитивний і коротший: що є валідним доказом, яка форма відповіді, коли казати про невизначеність, де зупинитись перед історичним твердженням. Жорсткі заборони лишилися лише там, де вони відповідають виміряним збоям §26 (порядок завершення, `lastActivityAt` як доказ, натуралізований UTC-час, неузгоджені лічильники, майже повний дамп, розмите «невеликий процес»).

### 28.2 Що поточний доказ може підтримати

Тотожність картки, дошка/проєкт, поточний список, поточні `closed`, `due`, `dueComplete`, `labels` (де свіже пряме читання їх повертає). Формулювання — у поточному часі: «зараз у Done», «лежить у Waiting», «архівована». `trelloSearch` лише знаходить кандидатів; для точних полів потрібне свіже пряме читання цього ходу (accepted #18 лишається обмеженням і названо в Skill).

### 28.3 Які історичні твердження лишаються непідтриманими

Коли картку завершено; яка завершена першою/останньою; чи переміщено; чи reopen; хто працював; чи активність = реальний прогрес; чи картка належить минулому періоду. Skill прямо забороняє також **упорядкування карток у часі** («остання закрита», «перша завершена», «нещодавно закрита», «свіжо завершена»).

Історично сформульований запит («Що я зробив цього тижня?», «що завершили за останні дні?», «що повернулось у роботу?», «що просунулось цього тижня?») → (1) одне коротке речення, що поточні дані не доводять потрібне за період; (2) корисний поточний зріз («зараз»); (3) жодних дат, порядку, руху, reopen чи причин; поточні Done-картки не видаються за «роботу цього тижня». Історичної інфраструктури не створено.

### 28.4 Точне поводження з `lastActivityAt`

Лише «Trello зафіксував якусь активність на картці в цей raw-момент». За замовчуванням **не згадувати**. Ніколи не використовувати як доказ завершення, порядку, руху, reopen, прогресу, виконавця, застою, належності до періоду й для вибору карток. Ніколи не переписувати його в локальну дату/час, день тижня чи відносну форму і не подавати як момент події; якщо показ необхідний — дослівний ISO як «Trello recorded activity at <ISO>». Виміряний збій «21 вересня о 07:09» названо в Skill прямо.

**`due` (уточнено в §28.23):** це чинне поточне поле-дедлайн, а не `lastActivityAt`. Його правильне людинозрозуміле подання допустиме й не вимагає сирого ISO; за невпевненості в конвертації чи дні тижня — процитувати записаний ISO; відлік/«прострочено» не виводити; фактична правильність `due` оцінюється в R04, а не R03. Детермінованого date-middleware не додано.

### 28.5 Спрощення форми відповіді

Прибрано з обов'язкового: хронологію, підсумки/лічильники, обов'язковий PM-висновок, повний інвентар, рядок на кожну картку, примусову оцінку «прогресу». Замість цього: кілька найсильніших підтриманих фактів, стисла українська, спочатку висновок; що зараз Done / активне / очікує (лише як прямий факт), суттєва невизначеність або конфлікт; **одна** наступна дія лише коли її прямо підтримує власний доказ картки, інакше — зупинитись на фактах. Повний перелік — лише на явне прохання списку/таблиці. Заборонено розмиті висновки («невеликий процес», «продуктивний тиждень») і причини, яких не видно.

### 28.6 Семантика конфліктних сигналів

Три сигнали стану завершення подаються **окремо**: Done-список = дошка зараз трактує як Done; `closed` = зараз архівована (не значить виконана); `dueComplete` = поточний boolean без часу. При суттєвій розбіжності між ними (архівована поза Done; у Done з `dueComplete:false`; `dueComplete:true` в активному списку) — сказати, що кожен показує, і що вони різняться; не обирати «переможця» і не вигадувати перехід для узгодження. **`due` не є сигналом стану завершення** (уточнено в §28.23): дедлайн не доводить ані виконання, ані невиконання; це незалежний поточний факт (записаний дедлайн, не клієнтське зобов'язання), що оцінюється в R04, а «due минув, картка не в Done» — не конфлікт сигналів.

### 28.7 Правила часткового покриття

Перед агрегатним твердженням з'ясувати, що реально прочитано: обсяг (дошка/label), чи включені closed, чи результат обрізано (`hasNextPage`, досягнутий `limit`, лише частина списків, лише search). Якщо покриття часткове/неясне — сказати про це першим і говорити лише про прочитане («серед прочитаних карток…»). Не казати «усі завершені», «це все, що активно», «всього N», «жодної», якщо покриття цього не доводить.

### 28.8 Правила підрахунків

За замовчуванням без лічильників. Якщо число просять: назвати множину (обсяг; open+closed чи лише open), порахувати повернуті картки одну за одною, число має дорівнювати реально перерахованому; якщо названі картки — число збігається з показаними іменами; при частковому покритті сказати, що це число прочитаного.

### 28.9 Правила plan-vs-current

Memory або явно прийнятий у розмові план дає лише plan-сторону; свіжий Trello — лише current-сторону. Порівняння лише коли обидві надійні й картка чітко та сама задача в тому самому проєкті. Дозволено: «У прийнятому плані була X; зараз у Trello вона в Done.» Немає прийнятого плану / скасований / замінений / неясний період → не вигадувати план, дати current-state review. Кілька можливих карток або єдиний збіг в іншому проєкті → без порівняння: одне коротке уточнення чи назвати незіставлений пункт. Заборонено «виконано за планом цього тижня», «зірвали», «повернули», «вчасно/із запізненням». Обговорена, але не прийнята пропозиція і Trello-список «This week» — не план.

### 28.10 Ізоляція проєкту

Single-project review лишається всередині проєкту (спершу дошка, інакше єдиний збіг label на спільній дошці — з поясненням, який label). Картки інших проєктів **не називаються, не рахуються, не позначаються**, навіть термінові; без «а ще в іншому проєкті…». Неоднозначність або відсутність збігу → одне коротке уточнення. Без жорстко закодованих імен проєктів; багатопроєктний запит тримає факти окремо. Прийняті правила ідентичності `task-management`/Project Health не змінено.

### 28.11 Межа Project Health

Health, ризик, blocking, staleness, overload лишаються за прийнятим шляхом Project Health (specialist v4). Work-review описує лише прямі поточні факти; «Waiting» — лише як прямий факт (картка в списку/власний текст), без інтерпретації. Skill не переказує, не виправляє й не розширює PH-результат; runtime (#32) лишає верифікований PH-результат авторитетним і видимо ховає інший текст цього ходу. Змішаний вивід **не** розв'язується роутером чи парсером. Не змінено: `project-health` Skill, specialist, PH relay-safeguard, `src/djonikClient.ts`, `src/turnCorrelation.ts`.

### 28.12 Зміни в Skill (`.claude/skills/work-review/SKILL.md`)

Переписано з нуля коротше: 11 515 → 10 536 байт (після §28.23; первісно 10 008), 11 → 9 секцій (`Scope and handoffs`, `Evidence`, `History is not available`, `Signals stay distinct`, `Coverage and counts`, `Accepted plan and current state`, `Project scope`, `Shape of the answer`, `Read-only and Memory`). Видалено: обов'язковий «ретроспективний інсайт/наступний PM-крок», порядок «PM-читання → докази → обмеження → інсайт», окремі довгі блоки про заборони (згорнуто у позитивні правила). Додано: покриття/лічильники, явні конфліктні сигнали, явні приклади заборонених порядкових фраз, пряма згадка виміряного «о 07:09», ізоляція без «а ще в іншому проєкті». Frontmatter покриває нові історичні формулювання. Це джерельна зміна: **віддалений Skill `skill_01RMRGWbrjW9EHSieymZ2NDV` / `skver_01JCf5J73Sik966ZR31u6Rhr` більше не байт-ідентичний джерелу** і не оновлювався; він і далі не приєднаний до production та не прийнятий.

### 28.13 Поведінковий рубрик

`docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md` (процедура) і `src/workReviewRubric.ts` (машинозчитні виміри + опційний lint-pre-screen, нічого з runtime його не імпортує). 15 вимірів R01–R15, кожен із `critical`/`major`: R01 unsupported chronology · R02 `lastActivityAt` misuse · R03 `lastActivityAt` converted into local-time/relative/history meaning (без `due`, див. §28.23) · R04 current-state factual correctness · R05 project isolation · R06 conflicting-state handling · R07 partial-coverage honesty · R08 count consistency · R09 concision/no dump · R10 plan-vs-current · R11 zero mutation · R12 Project Health boundary · R13 honest answer to unanswerable history question · R14 no vague interpretation · R15 no transient judgement persisted. Ті самі виміри застосовуються до Haiku і до будь-якого заздалегідь оголошеного кандидата; модель — не вхід оцінки; переможця, порогів і ранжування немає. Оцінка — за сирим tool-payload'ом; `critical FAIL` → зупинка за docs/04 §27. Lint підсвічує лише R01/R02/R03/R14 (R02/R03 — тільки в реченнях про активність Trello; людинозрозуміле подання `due` він не перевіряє й не позначає), а R08 та інші явно позначені нелінтованими; порожній lint нічого не доводить.

### 28.14 Files changed

- `M .claude/skills/work-review/SKILL.md` — спрощений контракт (§28.12)
- `M src/skills.test.ts` — видалено 28 застарілих slice-2 wording-тестів (вони перевіряли формулювання, яких більше немає); лишено коментар-вказівку на новий файл
- `?? src/workReviewContract.test.ts` — фікстури A–K + перевірки форми Skill + узгодженість рубрика + lint-зразки
- `?? src/workReviewRubric.ts` — виміри R01–R15 і lint-pre-screen
- `?? docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md` — рубрик
- `M docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md` — цей §28

Без змін: `docs/02`, runtime-код, Agent-конфіг, `claude-lock.json`, `managed-agents/`, інші Skills, `src/djonikClient.ts`, тести #31/#32.

### 28.15 Тести додані / змінені

`src/workReviewContract.test.ts` (**23 тести** у першому проході; після follow-up §28.23 — **27**): 11 фікстур A–K (кожна — реалістичний prompt, синтетичний опис свіжого доказу, очікуваний контракт, прив'язка до вимірів R01–R15 і 3–7 регекс-тверджень про **конкретну секцію** Skill): A історичний запит · B Done/active/waiting без дампу · C `lastActivityAt` · D конфлікт Done/closed/dueComplete · E часткове читання · F явний лічильник · G план + збіг картки · H план відсутній/неоднозначний/чужий проєкт · I ізоляція проєкту · J межа PH · K read-only/Memory. Далі: повне покриття A–K рівно раз і кожного виміру рубрика ≥1 фікстурою; валідний frontmatter і нові історичні тригер-фрази; Skill коротший за попередній і має очікувані секції; відсутність вимог хронології/лічильників/обов'язкового висновку; заборона порядкових фраз; відсутність `trelloWrite*`, числових порогів віку, «router/parser/middleware»; незалежність інших Skills від work-review; відповідність docs/20 ↔ модуль (id, severity, таблиця A–K); модельна нейтральність рубрика; три lint-тести — **дослівна виміряна невдала відповідь Haiku (§26.15) підсвічена R01/R02/R03/R14**, контракт-відповіді та дослівний ISO не підсвічуються (включно з «серед прочитаних…»), а вигаданий «Усього 7 задач у Done» проходить lint — свідомо, як доказ, що lint не є вердиктом.

**Перевірка «зубатості»:** 10 мутацій копії Skill (видалення по одному ключовому правилу для A, C, D, E, F, G, H, I, J, K) — **усі 10 виявлені**; після §28.23 ще 6 мутацій нових правил (`due` як поточне поле, «невпевнений → ISO», `due` не сигнал завершення, повернення старого правила «(or `due`)» сирого-ISO, заборона подавати `lastActivityAt` як момент події, рамка «три сигнали») — **усі 6 виявлені**; файл Skill щоразу відновлено побайтно (`cmp` без відмінностей).

**Чого тести НЕ доводять:** source-тести доводять, що правила присутні в тексті Skill та що рубрик/фікстури узгоджені. Вони **не** доводять, що будь-яка модель (Haiku чи Sonnet) їх виконує; попередній live-збій стався попри явні заборони в тексті.

### 28.16 Точний результат сфокусованих тестів

Після §28.23: `node --import tsx --test src/workReviewContract.test.ts` → **27 tests, 27 pass, 0 fail, 0 cancelled, 0 skipped.**
`node --import tsx --test src/workReviewContract.test.ts src/skills.test.ts` → **112 tests, 112 pass, 0 fail, 0 cancelled, 0 skipped.**
(Перший прохід: 23/23 і 108/108.)

### 28.17 `npm run typecheck`

Пройшло, без помилок (`tsc --noEmit`, exit 0).

### 28.18 `npm test`

Після §28.23: **458 tests, 458 pass, 0 fail, 0 cancelled, 0 skipped** (baseline 459 − 28 застарілих work-review wording-тестів + 27 нових; у першому проході було 454/454). Усі прийняті #31/#32 регресійні файли (`trelloMutationLedger.test.ts`, `turnCorrelation.test.ts`, `turnCompletion.test.ts`, `djonikClient.test.ts`) не змінювались і проходять.

### 28.19 `git diff --check`

Exit 0. Єдине попередження — стандартне git LF→CRLF для `SKILL.md` (`core.autocrlf` на Windows), не whitespace-помилка.

### 28.20 `git status --short`

```
 M .claude/skills/work-review/SKILL.md
 M docs/16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md
 M src/skills.test.ts
?? docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md
?? src/workReviewContract.test.ts
?? src/workReviewRubric.ts
```

### 28.21 Залишкові обмеження

1. **Поведінка моделі не виміряна.** Новий Skill не завантажений і не приєднаний; жодна модель його не виконувала. Ризик, що Haiku знову порушить правила попри текст, не знятий — це предмет майбутнього експерименту.
2. **Рубрик — процедура, не автоматичний грейдер.** Лише R01/R02/R03/R14 мають попередній lint на регексах (UA/EN-фрази з виміряних збоїв); хибні спрацювання (напр. легітимне «сьогодні» поза контекстом) і пропуски можливі. R04–R13, R15 потребують людини/грейдера із сирим payload'ом і журналом викликів.
3. **Змішаний запит PH + review** лишається обмежений контрактом #32 (специфікатор авторитетний, інший текст ходу приховується з повідомленням). Skill цього не «лікує» і не повинен.
4. **Питання власника не вирішене:** Haiku vs обмежене розширення наявної Sonnet-ролі (чи жоден) — не визначено; переможця заздалегідь немає.
5. **Спостережні прогалини §22** (повні поля `trelloReadCard get`, `trelloReadChecklist`, семантика `complete`) не закривались; Skill формулює їх умовно.
6. **#18** без змін: свіжість читання в цьому ході — вимога Skill, не гарантія.
7. Віддалений Skill розійшовся з джерелом (§28.12); нову синхронізацію можна робити лише за окремою авторизацією і лише для ізольованого кандидата, не для production-attach.
8. Roadmap (`docs/02`) не змінювався; синхронізація статусу слайсу лишається за Product Owner.

### 28.22 Явне підтвердження меж

- **0 paid Managed Sessions, $0 inference, 0 `user.message`.** Замінений план «$0.30 / 2 Session» не використовувався; жодного нового бюджету не заявлено й не витрачено. Майбутня платна перевірка потребує **нового** явного бюджету й плану кандидата за docs/04 §27 (загальний ceiling, Session/ходи, заморожені конфігурації, розподіл вимірів, нуль мутацій, допуск кожного ходу за найгіршою спостереженою вартістю повного comparable-ходу ≈ $0.31 для делегованого PH-ходу плюс резерв).
- **Production не змінювався:** Agent v21 / specialist v4 не чіпано, `work-review` не приєднано, `agents.update`/`skills` не викликались; жодного тимчасового validation-координатора, другого специфікатора чи порівняння Haiku↔Sonnet.
- **0 Trello-записів / мутацій, 0 Calendar-викликів, 0 Memory-записів** (жодного Trello/Calendar/Memory виклику взагалі).
- **Без** commit / push / deploy / нової гілки / змін чи закриття GitHub issues; #33 не розпочато. Читались лише issue #29 (`gh issue view`, read-only) і локальні файли.

### 28.23 Follow-up review — уточнення R03 і R06 (без зміни іншої прийнятої source-поведінки)

Product Lead review виявив дві надто широкі семантики рубрика, які тепер виправлено до будь-якого платного експерименту:

1. **R03 був занадто широким.** Він трактував будь-яке людинозрозуміле/локальне/відносне подання і `lastActivityAt`, і `due` як critical FAIL. Виміряний збій та вимога #29 стосуються лише `lastActivityAt`, перетвореного на непідтриманий історичний/локальний-часовий зміст. Тепер R03 = «`lastActivityAt` converted into local-time, relative-date or history meaning»: будь-яке таке перетворення `lastActivityAt` лишається FAIL (і хибне, і «арифметично правильне», бо воно робить слабку мітку активності доказом події). `due` — чинне поле-дедлайн: правильне людинозрозуміле подання не є FAIL і не вимагає сирого ISO; хибне значення/зона/день тижня — FAIL **R04**. Детермінованого date-middleware не додано.
2. **R06 не мав трактувати звичайний `due` як сигнал завершення.** Тепер R06 = Done/список · `closed`/архів · `dueComplete`: сигнали окремі, суттєві розбіжності названі, історія для узгодження не вигадується. `due` оцінюється незалежно як поточний факт у R04; «due минув, а картка не в Done» — не конфлікт R06. Фікстура D тепер також покриває R04.

**Той самий надто широкий `due`-припис існував у Skill** («Never rewrite it (or `due`)…», «дедлайн у Trello: <ISO>» як єдина форма), тож секцію `Signals stay distinct` виправлено: сирий-ISO/не-переписувати лишається лише для `lastActivityAt`; `due` — окремий абзац (поточний дедлайн; допустиме правильне подання; за невпевненості в конвертації чи дні тижня — записаний ISO; не виводити відлік/«прострочено»; після запису лишається за task-management); три сигнали стану завершення названо явно, а `due` прямо виключено з них. Розмір Skill 10 536 байт (< 11 515).

**Lint** (`src/workReviewRubric.ts`) звужено відповідно: R02/R03 шукаються лише в реченнях про активність Trello; R01 додатково ловить похідний час при дієслові завершення/переміщення поза реченнями про дедлайн; людинозрозуміле подання `due` (навіть хибне) lint не позначає — це R04 і потребує сирого payload'у.

**Тести (+4, 23 → 27):** три нові тести семантики (Skill: `due` — поточне поле, без raw-ISO-only, без middleware/відліку; R03 обмежений `lastActivityAt` і відсилає `due` до R04; R06 = три сигнали, `due` окремо) та тест, що lint не позначає жодного людинозрозумілого `due`; змінено фікстури C (правило лише про `lastActivityAt`) і D (+R04, +три нові твердження), lint-тест «relative/naturalized» перебудовано під активність. Перевірка «зубатості» — 6/6 мутацій виявлено (§28.15).

**Файли (follow-up):** `.claude/skills/work-review/SKILL.md`, `src/workReviewRubric.ts`, `src/workReviewContract.test.ts`, `docs/20_ISSUE_29_WORK_REVIEW_BEHAVIORAL_RUBRIC.md`, цей §28. Без змін: `docs/02`, `src/djonikClient.ts`, `src/turnCorrelation.ts`, #31/#32-код і тести, інші Skills, Agent/remote Skill.

**Підтвердження меж (follow-up):** 0 paid Session / $0 inference; віддалений Skill не синхронізовано (розходження з джерелом лишається, §28.12); production, Agent v21 і specialist v4 не змінено; 0 Trello/Calendar/Memory викликів і мутацій; без commit / push / deploy / нової гілки / змін issues.
