# #39 — Етап 2: runtime wiring робочого ритму за жорсткими замками (source)

Дата: 2026-09-24. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 64).

**Статус:** звіт про source/offline-реалізацію другого bounded етапу. **Не** документ приймання і **не** deployment. Усе uncommitted, чекає review Product Lead. Production не змінювався; Working Rhythm у production **не можна активувати**: serving runner чесно декларує `post_hoc_detection_only`. Платного inference, live Telegram, SSH, systemd reload не було.

## 1. HEAD і вихідні умови

- `main` = `origin/main` = `5e592e90ac6d0412c0e2b1d232d377b992ed1570` (`feat: add working rhythm source foundation (issue 39 stage 1)`), перевірено `git fetch origin`. До змін `git status --short` був порожній.
- `docs/02`, рядок 64: єдиний NOW — #39. GitHub #39: відкритий, єдиний коментар — промоція 2026-09-24 («scope is unchanged»).
- Прочитано й перевірено: docs/61 (Stage 1) і весь Stage 1 source/тести; `djonikClient`, `telegramCli`, `telegramAdapter`, `telegramDispatch`, `messageGrouping`, `trelloWorkHistory`, `release`, `servingRelease`, `servingLifecycle`, `deploy/djonik-telegram.service`, #34-інваріант у `commitmentContract.test.ts`; docs/45 (назви списків дошки, label = проєкт). Решту документів зі списку завдання я використовував вибірково, повністю не перечитував.
- Production за docs/60 не зачеплено: app `d59a532…`, r26, Agent v26, specialist v4, Memory `read_write`.

## 2. Що зроблено (коротко)

1. **Вузьке джерело `/rhythm.md`** з production Memory Store — єдиний дозволений прямий Memory API read (§3).
2. **Read-only збирач фактів** поверх прийнятого GET-only Trello-клієнта #36 (§5).
3. **Traced turn** у тому самому Session / FIFO / pipeline: фінальна відповідь, Session id, що її дав, і content-free перелік інструментів (§6).
4. **Callback wiring** `callback_query:data` у grammY + виправлення порядку для альбому (§7).
5. **Таймер** у serving-процесі за двома замками, graceful shutdown (§8).
6. **`StateDirectory`** у source-юніті, детермінований шлях стану (§9).
7. **Примітка про невалідний `/rhythm.md`** — один раз, усередині наступного ритуалу (§10).
8. **Дослідження pre-execution read-only** — межа **не встановлена**, runtime лишається `post_hoc_detection_only` (§4).

## 3. Джерело конфігу `/rhythm.md` (`src/rhythmMemoryConfig.ts`)

**Виміряно (SDK 0.125.0 + поточні Memory docs):** memory читається за `mem_…` id (`memories.retrieve(id, {memory_store_id, view})`); пошуку за точним шляхом нема, є лише `memories.list(store, {path_prefix, depth, view})`, де `path_prefix` має закінчуватися на `/`. SDK сам ставить beta-заголовок `agent-memory-2026-07-22`.

Дизайн (дві read-операції, нічого більше):

1. `memories.list(<production store>, { path_prefix: "/", depth: 1, view: "basic" })`: лише корінь, лише шляхи (без контенту). Будь-яка підтека, зокрема записи #34, приходить як голий маркер `memory_prefix` і пропускається, **ніколи не відкривається**.
2. Береться id рівно `/rhythm.md` (`type: "memory"`, точний шлях, з урахуванням регістру), далі `memories.retrieve(id, { memory_store_id, view: "full" })`.
3. Відповідь перевіряється: той самий id, шлях `/rhythm.md`, той самий store, `content` — рядок. Інакше `RhythmConfigReadError`.

Store id береться з `release.session.memoryStoreId` (r26), і прив'язує його лише `telegramCli.ts`. Кількість переглянутих кореневих записів обмежено (1000).

| Ситуація | Результат |
|---|---|
| файлу нема | `null` → дефолти Stage 1, без попереджень |
| збій провайдера (list або retrieve), чужий store чи шлях, без контенту | throw → tick `config_unavailable`, нічого не надсилається |
| поламаний текст | повертається як є → парсер Stage 1 (ніколи не кидає) |

**Інваріант #34 звужено точково** (`commitmentContract.test.ts`): для всіх runtime-файлів, крім `rhythmMemoryConfig.ts`, заборона Memory API лишилась без змін, як і заборона працювати з `commitments/` (крім `djonikClient.ts`). Новий тест доводить вузькість винятку: у файлі є лише `memories.list` і `memories.retrieve`; нема `create/update/delete/memoryVersions/redact/archive`; шлях `"/rhythm.md"`; лише кореневий `depth: 1, view: "basic"`; слово `commitments` не зустрічається; єдиний споживач — `telegramCli.ts` з `release.session.memoryStoreId`.

## 4. Pre-execution read-only: дослідження і висновок

**Виміряно в SDK 0.125.0 (`resources/beta/agents`, `sessions`, `sessions/events`) і поточних docs:**

- `permission_policy` = `always_allow | always_ask | auto` існує лише в конфігурації **інструментів Agent** (`agent_toolset` і MCP toolset, `default_config` / `configs[]`). Docs: «Running sessions keep the toolset configuration they were created with».
- `always_ask` → `session.status_idle{requires_action, event_ids}`; клієнт відповідає `user.tool_confirmation { result: "deny", deny_message }`. Отже програмна відмова можлива. Custom tools політиками не керуються (їх виконує клієнт).
- `auto` — судження сервера на кожен виклик, клієнт не може перевизначити `deny`. Не є детермінованою межею read-only.
- Є два Session-рівневі механізми: `agent: { type: "agent_with_overrides", tools: [...] }` при створенні Session і `sessions.update(id, { agent: { tools } })` посеред сесії (beta `mid-conversation-tool-changes-2026-07-01`). Обидва — **повна заміна** масиву tools. Перемикача «на один хід» нема.
- Події `agent.tool_use` / `agent.mcp_tool_use` мають `evaluated_permission` і `evaluation`. Memory-записи — це звичайні built-in `write` / `edit` на змонтованому шляху.

**Висновок: чистого per-turn механізму без зміни v26/r26 нема.**

- Session override / update змінив би tool-конфіг serving Session, яку атестує r26 (drift від прийнятого релізу).
- Код мусив би дублювати повний масив tools Agent (заборона CLAUDE.md щодо дублювання конфігурації Agent).
- Перемикання посеред сесії між ходами Daniel і ритму — це нова кастомна інфраструктура з crash-вікном: процес, що впав між «обмежити» й «відновити», залишив би звичайні записи Daniel у `requires_action`.
- Поведінка mid-session update щодо наступного ходу не виміряна (платний inference не авторизовано).

Тож workaround не реалізовано. `SERVING_READ_ONLY_BOUNDARY = "post_hoc_detection_only"` (`src/rhythmRuntime.ts`) — **pre_execution не встановлено і не заявлено**. Тест Stage 1 «жоден не-тестовий source не декларує `readOnlyBoundary: "pre_execution"`» лишився зеленим.

Що лишилось **виведеним**, а не виміряним: точна семантика `sessions.update` для вже запланованого ходу; чи cross-posted permission request субагента (specialist v4) прийде на primary stream у нашій конфігурації.

## 5. Збирач фактів (`src/rhythmFacts.ts`)

Джерела — лише свіжий Trello через прийнятий `TrelloWorkHistoryClient` (GET, read-token в `Authorization`). Додано три GET-методи, наявні не змінювались:

| Метод | Запит | Для чого |
|---|---|---|
| `readOpenCards` | `GET /boards/{id}/cards?filter=open&fields=id,name,idList,closed,due,dueComplete,labels` | поточні картки (без `dateLastActivity`) |
| `readLists` | `GET /boards/{id}/lists?filter=all&fields=id,name` | id → назва → роль |
| `readLatestListEntry` | `GET /cards/{id}/actions?filter=updateCard:idList,createCard,copyCard,moveCardToBoard&limit=1` | останній вхід картки в список, **будь-якої давності**; лише для карток у Waiting, максимум 20 |
| (наявний) `readActions` | board actions за вікно `max(stale_project_days, 7) + 1` днів | повернення з Done, рух проєкту |

**Мапінг списків** (явний, docs/45; точні назви без урахування регістру й пробілів): `Inbox`→backlog, `Backlog`→backlog, `This week`→todo, `In progress`→in_progress, `Waiting`→waiting, `Done`→done, будь-що інше → `other`.

**Проєкт** — рівно один непорожній label → slug (`Cossack Labs` → `cossack-labs`); нуль або кілька → `null`, без здогадок.

**Історія:**
- вхід у поточний список = останній доведений вхід (move або створення в списку) **саме в поточний** список; якщо історія суперечить поточному списку → `null`;
- повернення з Done = move із Done в не-Done;
- рух проєкту = останній move або створення картки проєкту (проєкт за **поточним** label, правило #36).

**Не використовується:** `lastActivityAt` / `dateLastActivity`, час модифікації картки, актор (`memberCreator` ігнорується).

**Пріоритет проєктів:** прийнятого source нема → `projects: []` → `stale_project` детерміновано вимкнено. Для майбутнього reviewed-джерела є параметр `projectPriorities`.

**`followUps` порожні.** `next_check` живе в Memory, а Memory-парсер заборонений (#34). Ранковий хід читає прийняті дати перевірки сам; Stage 1 і так тримає їх лише для ритуалу.

**Деградація:**
- збій board / cards / lists → throw → `facts_unavailable`: ритуали йдуть без підказок, винятків нема;
- збій історії → історичні поля `null`;
- збій per-card read → `null` для цієї картки.

`null` сам по собі ніколи не створює сигнал.

**Каденс (новий, у runner):** факти збираються, коли настав ритуал, або у вікні винятків (увімкнено, не тиха зона, робочий день чи weekend-винятки) не частіше ніж раз на `factsIntervalMs` (15 хв). Уночі й у вихідні без ритуалу Trello не читається.

## 6. Traced turn і Session provenance

- `DjonikTracedSessionHandle.sendTraced(parts)` у `connectToDjonik` — той самий `enqueue` і той самий `sendPartsSerial`. Поверх нього лише інша форма відповіді: `{ reply, sessionId: session.id, toolUses }`. Другого транспорту, другого циклу чи другого `sendPartsSerial` нема. Тому #31 (ledger і nudge), #32 (`end_turn`, anchor / quarantine), #36 (relay `answer_text`), #40 (lifecycle custom tool), Project Health і final-only діють без змін.
- `toolUses` — лише `{kind, name}`: `agent.mcp_tool_use` → `mcp`, `agent.tool_use` → `builtin` (read / write / edit, зокрема Memory), `agent.custom_tool_use` → `custom`. Скидаються раз на видимий хід, тому rerun після nudge теж входить. Quarantined «хвіст» попереднього ходу не входить.
- Невдалий хід → `DjonikTracedTurnError { error, sessionId, toolUses }`. Runtime робить із нього `AutonomousTurnFailure`, а runner застосовує детектор запису і до невдалого ходу: спроба запису → фіксоване повідомлення (`blocked`), інакше тихий `failed` без повторного запуску.
- `DjonikSessionHandle` (`send` / `sendOrdered`) не змінено. Наявні фейки й тести не чіпались.
- **Provenance:** runner більше не читає `currentSessionId()`. `claimed` пишеться з `sessionId: null`, а перед Telegram-відправкою — рівно `result.sessionId`, id Session, яка дала відповідь. Callback порівнює його з `djonikSession.currentSessionId()` (новий метод `createSessionManager`; після `invalidate` повертає `null`), тож кнопки після зміни Session стають неактуальними.

## 7. Callbacks і групування

- `telegramCli.ts`: `bot.on("callback_query:data", createCallbackListener(rhythm, …))`. Клік не від Daniel ігнорується без відповіді, як і `message:text`.
- Замки закриті (production) → `handleCallback` лише відповідає «кнопка неактуальна», **без доступу до стану**.
- Замки відкриті → Stage 1 handler без змін у перевірках: ref, `sent`, `message_id`, дія, одноразовість, Session, 48 год. `answer` тепер отримує `query` (per-query `answerCallbackQuery`). `enqueueUserText` викликається **до** підтвердження, тож порядок фіксується синхронно.
- **Виправлення порядку (review Product Lead):** `flushAll()` більше не використовується. Новий `MessageGroupBuffer.enqueueAfterPending(fragment)` робить таке:
  - активна текстова (не-альбомна) група цього chat/user закривається як є — наступне повідомлення належить після кліку;
  - **активний альбом не розрізається**: він «запечатується», досяжний лише для власного `media_group_id` і осідає за своїм вікном;
  - клік — окремий intake, ні з чим не зливається;
  - інші chat/user не зачіпаються.
- **Порядок передачі (новий, загальний для одного chat/user):** intake передається в `onDispatch` лише після передачі попереднього intake того самого chat/user, навіть якщо той ще докачує вкладення. Далі `onDispatch` синхронно стає в чергу Session (перший `await` — спільний `getSession()`), тож FIFO-порядок = порядок надходження. Групування #25/#27 не змінено. Єдина зміна поведінки: пізніша група того самого chat/user чекає на завантаження вкладень попередньої, а не випереджає її.

## 8. Таймер і життєвий цикл (`src/rhythmRuntime.ts`, `telegramCli.ts`)

- `startWorkingRhythm` викликається **після** `await djonikSession.getSession()` (атестація) і **до** `bot.start()` (тест перевіряє порядок у source).
- Перевірки й наслідки:

| Стан | Що відбувається |
|---|---|
| `DJONIK_WORKING_RHYTHM` ≠ рівно `on` | `off`: жодна фабрика не викликається — ні Memory, ні state store, ні Trello, ні модель, ні таймер |
| `on`, але boundary ≠ `pre_execution` | `blocked` з тими самими нульовими ефектами. **Це production-стан при ввімкненні.** |
| `on` + `pre_execution`, але шлях стану невідомий | `blocked` |
| усі замки відкриті (у репо лише в тестах) | `running`: одне `setInterval` на 60 с (`unref`) |

- Tick single-flight на двох рівнях (таймер пропускає постріл, поки попередній триває; scheduler повертає `busy`). Виняток у tick логується (`tick_threw`) і не валить процес.
- Graceful shutdown: новий необов'язковий крок `stopBackground` у `createShutdownCoordinator` виконується **першим** (жодного нового tick). Хід, що вже йде, дренується разом з intake в межах `drainMs`; Session закривається після цього.
- Long polling, `message:*` обробники й bot token check не змінені.

## 9. Стан і systemd (лише source)

- `deploy/djonik-telegram.service`: `StateDirectory=djonik`, `StateDirectoryMode=0700`. systemd створює `/var/lib/djonik`, власник `djonik:djonik`, і експортує `$STATE_DIRECTORY`. Під `ProtectSystem=strict` це єдиний шлях запису. Інша hardening не змінювалась. `DJONIK_WORKING_RHYTHM` у юніті **нема** (тест).
- Шлях: `DJONIK_RHYTHM_STATE_PATH` (абсолютний) або `$STATE_DIRECTORY/rhythm-state.json` (POSIX, хост Linux); інакше `null` → rhythm не стартує.
- Стан Stage 1: без секретів і тексту повідомлень, файл 0600, атомарний запис; пошкоджений чи нечитабельний стан → fail-closed. Нове поле — лише `configNotice: { digest, notedAt }` (§10).
- `bootstrap-host.sh` встановлює юніт лише під час bootstrap. Оновлений юніт на хості потребує окремого авторизованого `install` + `daemon-reload` (Stage 3).

## 10. Примітка про невалідний `/rhythm.md`

Мінімально й без спаму:

- попередження парсера (content-free) отримують digest;
- якщо digest відрізняється від `state.configNotice.digest`, у prompt **наступного ритуалу** додається рядок: сказати про це Daniel одним реченням і запропонувати виправити словами (сам `/rhythm.md` не змінювати);
- після `sent` / `ambiguous` digest зберігається, і незмінні попередження більше не згадуються;
- виправлений конфіг очищає digest, тож нова проблема буде згадана знову;
- окремого повідомлення, черги чи notification engine нема; у стані лише digest.

## 11. Незмінна безпека Stage 1

Усі 140 Stage 1 тестів зелені, змінено лише harness: `sessionId` у результаті ходу; `factsIntervalMs: 0` для тестів із довільними миттєвостями; `answer(query, alert)`. Незмінні:

- пн-план замість брифу, вт–чт бриф, легший пт, огляд пт 16:30, тихий день, вечір вимкнено;
- observation vs interrupt, caps 1 / 2, інтервал 2 год, тиха зона, вихідні, без повтору незмінного факту;
- hard / temporary mute vs м'яке побажання;
- кнопки 2–3, ambiguous ніколи не повторюється;
- OFF за замовчуванням.

## 12. Змінені файли

**Нові:**
- `src/rhythmMemoryConfig.ts`, `src/rhythmFacts.ts`, `src/rhythmRuntime.ts`;
- тести: `src/rhythmMemoryConfig.test.ts`, `src/rhythmFacts.test.ts`, `src/rhythmRuntime.test.ts`, `src/turnTrace.test.ts`;
- цей документ.

**Змінені:**
- `src/djonikClient.ts` — `sendTraced`, `DjonikTracedSessionHandle`, `DjonikTracedTurnError`, `DjonikToolUse`;
- `src/servingRelease.ts` — тип повернення;
- `src/telegramAdapter.ts` — generic `createSessionManager` + `currentSessionId`;
- `src/messageGrouping.ts` — `enqueueAfterPending`, sealed albums, порядок передачі;
- `src/rhythmRunner.ts` — provenance, `AutonomousTurnFailure`, каденс фактів, примітка конфігу;
- `src/rhythmState.ts` — `configNotice`;
- `src/rhythmTelegram.ts` — `answer(query, …)`, enqueue до ack, `enqueueAfterPending`;
- `src/rhythmConfig.ts` — лише коментарі;
- `src/servingLifecycle.ts` — `stopBackground`;
- `src/telegramCli.ts` — wiring;
- `src/trelloWorkHistory.ts` — три GET-методи й типи;
- `deploy/djonik-telegram.service` — `StateDirectory`;
- тести: `commitmentContract`, `rhythmRunner`, `rhythmTelegram`, `messageGrouping`, `servingLifecycle`, `telegramAdapter`.

**Не змінено:** `managed-agents/*`, `release.ts` (r26), `DJONIK_MEMORY_INSTRUCTIONS`, `.claude/skills/*`, `docs/02`, `deploy/*.sh`.

## 13. Тести (Node v24.16.0, Windows)

| Перевірка | Результат |
|---|---|
| Нові: `rhythmMemoryConfig` / `rhythmFacts` / `rhythmRuntime` / `turnTrace` | 9 / 14 / 11 / 7 — **41/41** |
| Rhythm Stage 1 (8 файлів, з новими Stage 2 кейсами) | **140/140** |
| `telegramAdapter` + `telegramDispatch` + `messageGrouping` | **89/89** |
| `djonikClient` | **142/142** |
| `commitmentContract` | **36/36** |
| `trelloWorkHistory` | **14/14** |
| `release` + `servingRelease` + `releaseAttestation` + `servingLifecycle` | **68/68** |
| `trelloMutationLedger` + `turnCompletion` + `customToolResolution` | **137/137** |
| `rhythmSchedule` + `rhythmRunner` + `rhythmFacts` під `TZ=America/Los_Angeles` | **66/66** |
| Повний `npm test` | **867/869**; 2 збої **наявні вже на незміненому HEAD** (див. нижче) |
| `npm run typecheck` / `npm run build` / `git diff --check` | pass / pass / pass |

Два збої відтворюються на чистому `5e592e9` (перевірено через `git stash`), вони не від цього етапу:
- `deployConfig.test.ts` «deploy script survives replacing itself…» — CRLF-checkout `deploy.sh` на Windows ламає regex `^main "\$@"\nexit$`;
- `processExit.test.ts` «a real process that fetched over keep-alive exits…» — дочірній процес на цьому хості завершується з 1 замість 78.

Stage 1 фіксував 813/813 на Node 22; обидва тести залежні від середовища.

**Покриття вимог J:**
- **Memory config:** лише `/rhythm.md`; commitments не чіпаються; відсутній файл; збій провайдера; поламаний текст; SDK-binding.
- **Collector:** real-shaped fixtures; мапінг списків; labels; `due` / `dueComplete`; вхід у Waiting з історії, включно зі старшими за вікно; повернення з Done; рух проєкту; без `lastActivityAt`; деградація; реальний GET-клієнт.
- **Trace:** Session id; MCP / built-in / custom content-free; nudge; помилки #31 / #32; FIFO разом із `send` / `sendOrdered`; quarantine.
- **Callbacks:** справжній grammY `handleUpdate`; allowed user; stale Session; поламаний payload; подвійний клік; клік після тексту; клік під час альбому; FIFO.
- **Scheduler:** feature off; post-hoc; start / stop таймера; shutdown; single-flight; помилки.
- **State / systemd:** шлях; `StateDirectory`; відсутність env активації.

## 14. Обмеження

1. **Активація неможлива** до Stage 3 (§4) — свідомо.
2. `stale_project` не спрацьовує: нема прийнятого джерела пріоритетів. `followUps` порожні (Memory не парситься).
3. Per-card читання Waiting обмежено 20 картками; решта → `null` + лог.
4. Порядок передачі гарантує, що клік не випередить раніший intake, але пізніша група того самого chat/user тепер чекає на завантаження вкладень попередньої. Для «зависання» завантаження окремого timeout на рівні буфера нема (як і раніше).
5. Порядок входу в чергу Session спирається на семантику microtask спільного `getSession()`. Тест доводить його для реальних dispatch-хендлерів, але це властивість runtime JS, а не явний ticket у `djonikClient`.
6. Traced list бачить лише primary stream. Власні tool uses треду specialist v4 (read-only Project Health) не видно; cross-posted permission requests видно.
7. Живої перевірки нема: поведінку моделі, реальні кнопки й реальний Memory read цей етап не доводить.

## 15. Точний gate Stage 3

До будь-якої активації (кожен пункт — окрема авторизація Product Owner):

1. **Справжня pre-execution межа** для автономних ходів. Рекомендовано: нова версія Agent (v27) і реліз r27, де всі мутуючі інструменти — Trello `trelloWriteCard` (і будь-який увімкнений write), `agent_toolset` `write` / `edit` (Memory), Calendar-мутатори, якщо колись увімкнуться, — мають `permission_policy: always_ask`. Клієнт детерміновано відповідає `user.tool_confirmation`:
   - `allow` — для ходів Daniel (`user_message` / `button_callback`); поведінка записів #31 зберігається, але з'являється confirmation-roundtrip, тому потрібні live-регресії #31 / #34;
   - `deny` — для `rhythm_ritual` / `rhythm_exception`.

   Потрібні: #40-подібний per-id lifecycle для confirmations, атестація r27 і тести, що `requires_action` з tool confirmation більше не є `incomplete` лише для відомих інструментів. Лише тоді serving runner може декларувати `pre_execution`. Альтернатива `sessions.update` посеред сесії відхилена (§4).
2. Встановлення оновленого юніта (`StateDirectory`) + `daemon-reload` на хості.
3. Sync Skill `pm-rhythm`, прив'язаний до Agent v27; створення `/rhythm.md` (або свідомі дефолти).
4. Лише після цього `DJONIK_WORKING_RHYTHM=on`, одна bounded live-перевірка ритуалу та кнопки за docs/04 §27, потім пілот #35.

## Стан робочого дерева

```text
 M deploy/djonik-telegram.service
 M src/commitmentContract.test.ts
 M src/djonikClient.ts
 M src/messageGrouping.test.ts
 M src/messageGrouping.ts
 M src/rhythmConfig.ts
 M src/rhythmRunner.test.ts
 M src/rhythmRunner.ts
 M src/rhythmState.ts
 M src/rhythmTelegram.test.ts
 M src/rhythmTelegram.ts
 M src/servingLifecycle.test.ts
 M src/servingLifecycle.ts
 M src/servingRelease.ts
 M src/telegramAdapter.test.ts
 M src/telegramAdapter.ts
 M src/telegramCli.ts
 M src/trelloWorkHistory.ts
?? docs/62_ISSUE_39_RUNTIME_WIRING_SOURCE.md
?? src/rhythmFacts.test.ts
?? src/rhythmFacts.ts
?? src/rhythmMemoryConfig.test.ts
?? src/rhythmMemoryConfig.ts
?? src/rhythmRuntime.test.ts
?? src/rhythmRuntime.ts
?? src/turnTrace.test.ts
```

Не зроблено (за інструкцією): commit, push, deploy, SSH, systemd reload, `DJONIK_WORKING_RHYTHM=on`, production state, `/rhythm.md` у production, sync `pm-rhythm`, оновлення Agent, v27 / r27, зміна моделі / effort / specialist, платний inference, live Telegram, мутації Trello / Calendar, закриття #39, промоція #35, зміна NOW, пілот.
