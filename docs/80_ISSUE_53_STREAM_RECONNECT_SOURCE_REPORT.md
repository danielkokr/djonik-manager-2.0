# #53: reconnect до тієї самої Session, прийняте повідомлення не губиться (source)

Дата: 2026-09-26. Issue: [#53](https://github.com/danielkokr/djonik-manager-2.0/issues/53). База: `main` @ `e133d30`.

**Статус: локальні зміни source чекають review.** Commit, push і deploy не робились. Agent, Skills, prompt і Memory не змінювались. Платного inference і hosted-перевірки не було.

## 1. Підсумок

Обрив event stream тепер означає проблему транспорту, а не втрату розмови.

- Кожна Session має **фідер подій на весь час свого життя** (`src/sessionEventFeed.ts`). Він постійно читає stream у фоні. Якщо stream обривається, фідер одразу підключається знову до **тієї самої** Session з обмеженим backoff. Це відбувається і під час ходу, і в простої, до того як Daniel напише.
- Реконект іде за офіційним рецептом: відкрити новий stream → `events.list` → доставити пропущене → читати live, пропускаючи вже бачені id.
- Кожен id події доставляється **не більше одного разу** за життя Session. Прийняте `user.message` ніколи не надсилається повторно через обрив.
- Session замінюється лише тоді, коли її справді не відновити. Повторне надсилання повідомлення відбувається лише тоді, коли дані провайдера **доводять**, що обробка не починалась. Інакше Daniel отримує один короткий український рядок.
- Однакова модель для Telegram-ходів і ходів Робочого ритму.

## 2. Змінені файли

| Файл | Зміна |
|---|---|
| `src/sessionEventFeed.ts` (новий) | `SessionEventFeed`: фоновий pump, reconnect за рецептом, per-id dedupe, catch-up з історії, стани `live/recovering/disconnected/dead`. `classifyPendingMessage`, `canResubmit`, `isRefusedSend`, `sessionIsGone`. Content-free телеметрія |
| `src/djonikClient.ts` | Замість одного `iterator` — фідер. `runTurn(events, primary)`: перед надсиланням `ensureReady`, класифікація стану повідомлення при відмові від Session. `DjonikSessionDeadError` тепер несе `pendingMessage` і `reason`. Нові опції: `onStreamLifecycle`, `reconnectDelaysMs`, `sleep` |
| `src/telegramAdapter.ts` | `runWithSessionRecovery`: єдиний шлях заміни Session і не більше одного повторного надсилання. `invalidate(handle?)` скидає лише той самий handle. `sessionDeadErrorOf`. Українські `SESSION_LOST_*` у `formatUserFacingError` |
| `src/telegramDispatch.ts` | Звичайний/груповий хід іде через `runWithSessionRecovery`. Нова опція `onSessionRecovery` |
| `src/rhythmRuntime.ts` | `createSessionTurnRunner` іде через той самий `runWithSessionRecovery` |
| `src/servingRelease.ts`, `src/telegramCli.ts` | Проброс `onStreamLifecycle`. Лог `[session] {…}` увімкнений завжди, content-free |
| `src/customToolResolution.ts`, `src/toolConfirmation.ts` | Лише doc-коментарі: застаріле «no reconnect reconciliation» |
| `src/streamRecovery.test.ts` (новий) | 22 регресійні тести #53 на fake-сервері |
| `src/djonikClient.test.ts`, `src/commitmentContract.test.ts`, `src/turnClock.test.ts` | Fake stream після сценарію лишається відкритим, як у production. Три тести старої семантики оновлено (§6) |

## 3. Архітектура й API

**Звірено з поточними джерелами.**
- Офіційна сторінка Managed Agents «Events and streaming» (platform.claude.com):
  - stream не повторює історію;
  - reconnect: відкрити новий stream, потім `list` історії для seen-id, далі пропускати їх у live;
  - id подій стабільні між підключеннями.
- SDK `@anthropic-ai/sdk` 0.125.0:
  - `sessions.events.stream / list / send`, `sessions.retrieve().status ∈ {rescheduling, running, idle, terminated}`;
  - у `user.*` подій `processed_at` може бути `null`, тобто подія в черзі й ще не оброблена;
  - `SessionToolRunner` у SDK робить так само: спершу stream, потім reconcile через `list`, dedupe за id.
- Суперечностей між API і #53 не знайдено.

**Ключові рішення.**
1. **Одна абстракція на весь час життя Session**, без розкиданих catch/retry. Фідер відповідає лише за впорядковану дедупльовану послідовність подій або явну відмову. Семантика ходу не змінилась: #32 anchoring, авторитетний `end_turn`, specialist correlation лишились у `runTurn`.
2. **Один handle = одна Session.** Handle відновлює лише stream. Session замінює лише менеджер (`runWithSessionRecovery`). Тому Session-scoped стан (#40, #39, #32) ніколи не переноситься в нову Session, а `sessionId` у traced-ході завжди вказує на Session, яка дала відповідь.
3. **Повна історія `list` без часового фільтра.** Фільтр `created_at` порівнюється з `processed_at`, а в `user.*` він буває `null`, тож фільтр міг би пропустити подію з черги. Ціна: разовий повний list на кожен reconnect (§7).
4. **Преамбула не доставляється.** Події до першого `user.message` в історії належать до створення Session. Початковий stream їх не бачив, а ходу вони не належать. Інакше стара idle могла б «завершити» перший хід.
5. **Помилки кроків reconnect.**
   - Retry: `APIConnectionError`, 408/409/429/5xx (те саме правило, що в SDK).
   - Невідновна Session: 404 → `session_gone`, `status: terminated` → `session_terminated`.
   - Інша 4xx або не-API помилка → `reconnect_failed`, без нескінченних спроб.
   - Обрив **під час читання** stream (`TypeError: terminated` від undici тощо) завжди вважається обривом.
6. **Backoff:** `[0, 500, 1000, 2000, 4000]` мс, приблизно 7.5 с на раунд. Якщо раунд у простої провалився без доказу смерті, фідер лише `disconnected`: без таймерів і без нескінченного циклу. Перед наступним ходом іде ще один раунд. Якщо раунд провалився під час ходу, Session вважається втраченою.
7. **Процес не змінено.** Session не зберігаються між рестартами (docs/51). Немає transcript DB і сховища розмов.

## 4. Як тепер працюють reconnect і відновлення повідомлення

**Та сама Session (звичайний випадок).**
- *Обрив у простої.* Pump помічає обрив одразу й робить reconnect. Наступне повідомлення йде в ту саму Session.
- *Обрив одразу після `send` або посеред ходу.* `runTurn` чекає на `feed.next()`, поки фідер відновлюється. Catch-up доставляє пропущене в порядку історії: echo, tool events, фінальний `agent.message`, `end_turn`. Хід завершується за звичайною #32-семантикою. Повідомлення не надсилається повторно.
- *Хід завершився під час обриву, а Session потім terminated* (наприклад, закінчився термін простою). Фідер усе одно дочитує історію, і Daniel отримує збережену відповідь. Нова Session потрібна лише для наступного повідомлення.

**Session втрачено.** Handle кидає `DjonikSessionDeadError` зі станом `pendingMessage`:

| Стан | Коли | Дія менеджера |
|---|---|---|
| `not_submitted` | Session мертва **до** надсилання: terminal-подія вже в stream, reconnect провалився, або `send` отримав 4xx від terminated/404 Session | Нова Session, **одне** надсилання |
| `unprocessed` | Session `terminated`, в історії саме це `user.message` з `processed_at: null`, після нього лише `session.error/status_terminated/deleted` | Нова Session, **одне** повторне надсилання |
| `processed` | Під час ходу бачили `agent.*`/`span.*`/`session.thread_*`/`status_running`, або історія показує обробку, або це verification nudge | Без повтору. Daniel отримує рядок «перевір Trello» |
| `unknown` | Session жива, але недосяжна; історія недоступна; 404; немає id; суперечливі дані | Без повтору. Той самий рядок |

- `unprocessed` вимагає `terminated`: жива, але недосяжна Session могла б обробити повідомлення з черги пізніше.
- Повторне надсилання буває не більше одного разу. Якщо помирає й нова Session, її лише скидають.
- Повідомлення, що стояли в черзі за мертвим ходом, у мертву Session не йдуть: `not_submitted` → нова Session.

**Повідомлення для Daniel** (`formatUserFacingError`, без сирого тексту провайдера):
- `not_submitted` / `unprocessed`, якщо відновити не вдалося: «⚠️ Не вдалося отримати відповідь — перешли, будь ласка, ще раз.»
- `processed` / `unknown`: «⚠️ Не вдалося отримати відповідь — зв'язок із сесією обірвався. Перешли, будь ласка, ще раз; якщо просив зміну в Trello, спершу перевір, чи вона вже є.»

Інші помилки ходу (#31-звіт, #32 incomplete тощо) не змінились.

## 5. Як запобігаємо дублям подій і побічних ефектів

- **Рівень 1, фідер.** Set доставлених id на весь час життя Session. Live-дублікати після catch-up і повтор при перекритті `list`/stream пропускаються. Їхня кількість іде в `stream_duplicates_skipped`.
- **Рівень 2, наявні per-id lifecycle.** Кожен гарантує результат сам, навіть без рівня 1:
  - #31 `TrelloMutationLedger`: повторний `recordToolUse`/`recordToolResult` з тим самим id ігнорується, записаний результат не перезаписується;
  - #40 `CustomToolResolution`: одне виконання на id, результат подається з кешу;
  - #39 `ToolConfirmationLifecycle`: рішення незмінне, `SUBMITTED` → no-op;
  - #36: вердикт по одному `custom_tool_use_id`.
- **Proactive delivery ритму.** `runner` отримує рівно один результат ходу (оригінал або єдине повторне надсилання), тож доставка записується один раз.
- **Жодного повтору `user.message`,** якщо Session могла його обробити.

## 6. Перевірки

- `npm run typecheck` (`tsc --noEmit`): **без помилок**.
- `git diff --check`: **чисто**.
- Нові тести #53, `src/streamRecovery.test.ts`: **22/22 pass**. Покривають:
  - обрив у простої: eager reconnect, та сама Session, преамбула не повторюється;
  - обрив одразу після `send`: catch-up, без повтору;
  - обрив посеред ходу: запис #31 перевірено один раз, без nudge;
  - перекриття catch-up і live: кожен id один раз, трасування й телеметрія без дублів;
  - повторені `agent.custom_tool_use` і `requires_action`: одне виконання, одне подання, #36 relay цілий;
  - повторений gated Trello-запис: одне підтвердження (#39), верифікація не повторюється (#31);
  - раунд у простої провалився → `disconnected` → повтор перед ходом → та сама Session;
  - terminated у простої → `not_submitted` → одне надсилання в нову Session;
  - terminated посеред ходу, обробка не почалась → `unprocessed` → один повтор;
  - хід завершився під час обриву, потім terminated → відповідь доставлено, повтору немає;
  - обробка почалась → `processed` → без повтору, український рядок;
  - недосяжна Session → `unknown`; видалена (404) → `unknown`;
  - 4xx від terminated Session → `not_submitted`; 4xx від живої Session → звичайна помилка, Session лишається;
  - нова Session теж померла → лише один повтор;
  - хід ритму: один traced-результат після повтору; `processed` → `AutonomousTurnFailure`, без повтору;
  - повідомлення в черзі за мертвим ходом → кожне по одному в нову Session;
  - Telegram dispatch наскрізно;
  - телеметрія без id і тексту; українські тексти помилок;
  - класифікатор (8 випадків) і unit тест фідера.
- Суміжні набори разом (`streamRecovery`, `djonikClient`, `turnCompletion`, `toolConfirmationClient`, `telegramAdapter`, `telegramDispatch`, `rhythmRuntime`, `turnClock`, `commitmentContract`, `turnTrace`, `servingRelease`, `trelloMutationLedger`, `customToolResolution`): **469/469 pass**.
- Повний `npm test`: **1064 tests, 1062 pass, 2 fail**. Обидва падіння є й на чистому `main` (перевірено через `git stash`) і не повʼязані з #53:
  - `deploy script survives replacing itself…`: Windows-checkout дає CRLF у `deploy/deploy.sh`, а тест чекає LF-regex;
  - `a real process that fetched over keep-alive exits by itself…`: тайминг процесу в цьому Windows-середовищі.
- Свідомо змінено три старі тести: вони закріплювали стару поведінку «stream закінчився = Session мертва, наступний хід іде в мертву Session»:
  - «a terminal session.error…»: тепер нічого не надсилається в Session, яка вже оголосила terminal-помилку;
  - Scenario C і Scenario I: хід, що стоїть у черзі, в мертву Session не йде (`not_submitted`).
- Fake stream у трьох тестових файлах після сценарію тепер лишається відкритим. Раніше кінець скрипту був штучним «обривом».

## 7. Обмеження і відкладене

- **Hosted live-перевірка з #53** (примусово закрити stream на хості, надіслати повідомлення, отримати відповідь у тій самій Session, нуль дубльованих записів) **не виконувалась**. Це окремий авторизований крок після review.
- Повний `events.list` на кожен reconnect. Для довгої Session з картинками/PDF це може бути кілька МБ за раз. Reconnect рідкісний; оптимізацію відкладено, бо фільтр за часом небезпечний (`processed_at: null`).
- Set доставлених id росте разом із Session (O(подій), десятки байт на id). Процес перезапускається з новою Session.
- Неоднозначне надсилання (обрив зʼєднання або 5xx на самому `events.send`, коли id не повернувся) лишається як до #53: помилка ходу без повтору й без заміни Session. Автоматичний повтор тут означав би ризик дубля.
- `unprocessed` можливий лише для `terminated` Session. Якщо Session жива, але недосяжна, повідомлення не повторюється, навіть якщо воно в черзі: гарантувати, що вона його не обробить пізніше, неможливо.
- Під час reconnect Session могла перейти в `requires_action` і чекати на custom tool чи підтвердження, яке прийшло в catch-up. Хід виконує це за тими самими per-id lifecycle, тобто відповідає на запит, а не повторює його.
- Roadmap / docs/02 / docs/30 §5 («reconnect відсутній, прийнятно») не редагувались. Синхронізація документації буде після прийняття.

## 8. `git status --short`

```
 M src/commitmentContract.test.ts
 M src/customToolResolution.ts
 M src/djonikClient.test.ts
 M src/djonikClient.ts
 M src/rhythmRuntime.ts
 M src/servingRelease.ts
 M src/telegramAdapter.ts
 M src/telegramCli.ts
 M src/telegramDispatch.ts
 M src/toolConfirmation.ts
 M src/turnClock.test.ts
?? docs/80_ISSUE_53_STREAM_RECONNECT_SOURCE_REPORT.md
?? src/sessionEventFeed.ts
?? src/streamRecovery.test.ts
```
