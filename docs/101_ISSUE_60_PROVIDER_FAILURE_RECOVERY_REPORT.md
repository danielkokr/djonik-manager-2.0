# #60: збій провайдера `503 credential validation failed` — розслідування і hardening (source)

Дата: 2026-10-02. Issue: [#60](https://github.com/danielkokr/djonik-manager-2.0/issues/60). База: `main` @ `6f19ed6`.

**Статус: локальні зміни source чекають review.** Commit, push, deploy, рестарт production не робились. Production-логи, ключі й секрети не читались. Agent, Skills, prompt, Memory і Trello не змінювались. Платного inference не було.

## 1. Executive summary

- **Інцидент провайдера** (503 з текстом `credential validation failed`) за наявними доказами — **тимчасовий збій на боці Anthropic API / control plane**. Точну внутрішню причину встановити неможливо. Host-ключ не був невалідним: той самий ключ і та сама конфігурація запрацювали після рестарту.
- **Дефект Djonik** визначається з source повністю:
  1. `formatUserFacingError` для будь-якої «звичайної» помилки показував сирий `error.message`. SDK будує його як `${status} ${body.message}`, тож Daniel бачив `503 credential validation failed`.
  2. Немає класифікації провайдерних збоїв: 503 (тимчасово), 401/403 (конфігурація) і 400 (запит) давали той самий сирий рядок.
  3. 5xx на `events.send` лишав ту саму закешовану Session для наступних ходів.
  4. Збій створення Session (`getSession`) ніяк не позначався, і в журналі не лишалось класифікованого сліду.
- **Hardening (тільки застосунок):**
  - структурна класифікація за класом і статусом SDK, ніколи за текстом;
  - фіксовані українські рядки без тексту провайдера;
  - заміна Session лише після 5xx або обриву з'єднання на `events.send`, без повторного надсилання;
  - content-free подія `serving_turn_failure`;
  - 401 зупиняє процес коректно, і systemd перевіряє ключ знову.
- **Автоматичного повтору того самого ходу після 5xx немає й не буде.** Доказу, що повідомлення не прийнято, немає. Повторне надсилання лишається лише там, де #53 це вже доводить (`canResubmit`).
- **Доповнення (blocker Product Lead):** первинне `user.message` тепер надсилається з `maxRetries: 0` для цього запиту, тобто **не більше ніж однією HTTP-спробою**. Вбудований повтор SDK більше не може тихо повторно надіслати повідомлення, яке провайдер міг уже прийняти. Деталі — §5a.

## 2. Production evidence (що ми ЗНАЄМО)

1. 2026-09-29: скрін + текст. Перша відповідь — `SESSION_LOST_RESEND_TEXT` («⚠️ Не вдалося отримати відповідь — перешли, будь ласка, ще раз.»).
2. Повтор того самого запиту → «⚠️ Джонік не зміг відповісти на це повідомлення: 503 credential validation failed».
3. 17:32 і 17:34 (Київ): plain-text `тест` двічі → той самий 503. **Не залежить від картинки.**
4. Рестарт `djonik-telegram` → `тест` працює. Код і конфігурацію не змінювали.

Host-логів інциденту в цьому розслідуванні немає (production не чіпали).

## 3. Root cause

### 3a. Інцидент провайдера (класифікація)

**Тимчасовий збій перевірки облікових даних на боці провайдера (API/control plane). Точна upstream-причина недоступна.**

Що на це вказує:
- Рядок `503 credential validation failed` збігається з форматом SDK `APIError.makeMessage`: `${status} ${error.message}`. Отже це `InternalServerError` зі статусом 503, а тіло мало верхньорівневе поле `message` (або було plain text). Стандартний конверт Anthropic API (`{"type":"error","error":{…}}`) дав би в повідомленні JSON. **Висновок, а не доказ:** відповідь, імовірно, сформував шар перед API-обробником (gateway / сервіс перевірки облікових даних). Невалідний ключ дав би стандартну 401 `authentication_error`, а не 503.
- SDK (`@anthropic-ai/sdk` 0.125.0, `maxRetries` 2) **уже повторив кожен такий запит двічі з backoff**, перш ніж застосунок побачив 503. Тобто збій тривав щонайменше кілька секунд на кожен виклик, а за доказом §2.3 — щонайменше 2+ хвилини.
- Той самий ключ запрацював після рестарту, отже **постійна помилка конфігурації виключена**.
- Слово «credential» може стосуватися як API-ключа, так і облікових даних vault (`vault_ids`), які перевіряються під час `sessions.create`. Розрізнити це без upstream-даних неможливо. **Невідомо.**

### 3b. Дефект відновлення / UX у Djonik (з source)

| # | Дефект | Де |
|---|---|---|
| D1 | Сирий текст провайдера у відповіді | `formatUserFacingError`, fallback `${error.message}` |
| D2 | Немає класифікації: 503 / 401 / 400 мали однаковий шлях і текст | `telegramAdapter.ts`, `djonikClient.ts` |
| D3 | 5xx на `events.send` → звичайна помилка, та сама Session лишається в кеші | `runTurn` (лише 4xx+terminated ставала `DjonikSessionDeadError`) |
| D4 | Збій `getSession` (створення/attest/stream) мав той самий сирий текст і не лишав класифікованого сліду | `runWithSessionRecovery` |
| D5 | Помилка створення replacement після #53 давала «перешли ще раз» без пояснення, що це провайдер | `runWithSessionRecovery` |

## 4. Етапи збою (за source)

Нижче — найімовірніша реконструкція інциденту. Вона спирається на source; без логів її не доведено.

**Гіпотеза A (найбільше відповідає всім чотирьом спостереженням):**
1. Stream serving Session обірвався. Reconnect (`sessions.retrieve`, `events.stream`, `events.list`) отримував 503, а #53 вважає 5xx retryable. Поза ходом фідер лише `disconnected`.
2. Хід 1 (скрін): `ensureReady` → ще один раунд → 503 → `dead(reconnect_exhausted)` → `not_submitted` → `runWithSessionRecovery` скидає Session і пробує replacement → `sessions.create` повертає 503 → кидається **оригінальна** помилка #53 → `SESSION_LOST_RESEND_TEXT`. ✔ збігається з першою відповіддю.
3. Хід 2 і `тест`×2: закешованої Session **немає** (невдалий connect не кешується). Кожен хід викликає `getSession` → `sessions.create` 503 → сирий текст. ✔ збігається.
4. Рестарт: новий процес → preflight → `sessions.create` проходить. ✔

**Наслідок для гіпотези A:** рестарт зробив те саме, що вже робив кожен хід, — новий `sessions.create`. Тож за A сервіс відновився, бо або **провайдер встиг відновитися** до рестарту, або причина була в стані процесу: HTTP keep-alive пул нового клієнта `Anthropic`, новий preflight. Розрізнити це без логів неможливо.

**Гіпотеза B:** replacement створено, але наступні ходи отримували 503 на `events.send` у закешованій Session. Тоді хід 1 мав би показати сирий 503 (звичайна `retryError`), а не `RESEND`. Це можливо лише якщо replacement одразу «помер» до `send`. Малоймовірно, але не виключено.

**Що розрізнить A і B у логах** (`journalctl -u djonik-telegram`, без секретів):
- `[session] {"type":"session_replaced",…}` і `{"type":"message_resubmitted","outcome":"not_delivered"}`;
- рядок `Djonik replacement Session could not be created:`;
- serving tuple line (`onServing`), що друкується на кожен **успішний** connect.

За A між інцидентом і рестартом нового tuple немає. Після цієї зміни це видно одразу з `serving_turn_failure stage=session_connect`.

### Таблиця етапів

| Етап | 503 можливий? | Повідомлення | Повтор того ж ходу безпечний? | Заміна Session корисна? | Рестарт дає більше? |
|---|---|---|---|---|---|
| A. `sessions.create` / attest (`sessions.retrieve`) / перший stream | так | **точно не надіслане** | так, але SDK уже повторив 2×; ще одна спроба в тому самому ході майже нічого не дає | n/a (кешу немає) | лише новий HTTP-пул/клієнт; Session і так нова на кожен хід |
| B. Початковий stream open | так (частина A) | не надіслане | як A | n/a | як A |
| C. `ensureReady` / reconnect | так (retry → `dead`) | **не надіслане** (#53 `not_submitted`) | так, і #53 це вже робить: нова Session + одне надсилання | так (#53) | ні |
| D. `events.send` user.message | так | 5xx/обрив: **delivery unknown** (немає гарантії провайдера, idempotency-ключа чи event id). 4xx: відмова, не прийнято (припущення #53) | **ні** для 5xx; для 4xx не потрібно | для 5xx — так (зміна #60); для 4xx — ні | ні |
| E. Читання подій після send | 5xx на reconnect → retry; `session.error` — подія | уже надіслане | ні (#53 `classifyPendingMessage`) | лише коли #53 доводить смерть | ні |
| F. Продовження custom-tool / confirmation | так | уже оброблюється | ні; власні lifecycle #40/#39 (`SEND_UNKNOWN`, ≤1 resend тих самих байтів) | **не змінено** (див. §13) | ні |
| G. status/history/retrieve у класифікаторах | так | — | — | помилка читання → консервативно `unknown` | ні |

Картинка змінює лише вміст `user.message`. Шлях ходу (`sendOrdered` → `sendPartsSerial` → `runTurn`) той самий, і тест це підтверджує.

## 5. Безпека доставки

- Офіційне джерело: SDK 0.125.0 (`client.js` `shouldRetry`) повторює **будь-який** запит, включно з `POST /v1/sessions/{id}/events`, на 408/409/429/5xx і обриви з'єднання. Idempotency-ключ не додається (у SDK його немає). Сервер може вимкнути повтор заголовком `x-should-retry: false`. Для первинного `user.message` ці повтори тепер вимкнено (§5a).
- **Гарантії провайдера, що 5xx на `events.send` означає «не прийнято», не знайдено.** Тому 5xx і обрив = `unknown`, повтору не буде.
- Звірка за історією (`events.list`) не дає надійного доказу. Немає event id, а порівняння за текстом заборонене: однакові повідомлення Daniel легітимні. Лишається й ризик eventual consistency. Відхилено.
- Повторне надсилання лишається тільки там, де його доводить #53:
  - `not_submitted` — смерть до send або 4xx від terminated Session;
  - `unprocessed` — Session terminated, і в історії саме це повідомлення з `processed_at: null`.
- Нове: хід, що **стоїть у черзі** на тому самому handle після 5xx give-up, отримує `ensureReady → dead → not_submitted`. Його повідомлення доведено не надіслане, тож воно йде один раз у replacement. Повідомлення, що впало з 5xx, не повторюється.

## 5a. Доповнення: не більше однієї HTTP-спроби для первинного `user.message`

**Знахідка в SDK (`@anthropic-ai/sdk` 0.125.0, встановлений):**
- `resources/beta/sessions/events.d.ts`: `send(sessionID: string, params: EventSendParams, options?: RequestOptions)`. У `events.js` `options` розгортаються в параметри запиту (`{ body, ...options, headers }`).
- `internal/request-options.d.ts`: `RequestOptions.maxRetries?: number` — параметр **для окремого запиту**.
- `client.js` `makeRequest`: `maxRetries = validatePositiveInteger('maxRetries', options.maxRetries ?? this.maxRetries)`. Значення `0` допустиме (відхиляється лише `< 0`).
- Обидві гілки повтору (обрив з'єднання / таймаут і статус 408/409/429/5xx), а також повтор 401 з token cache, спрацьовують лише за `retriesRemaining > 0`.
- Отже override для одного запиту можливий, і глобальну політику клієнта змінювати не треба.

**Зміна коду (`src/djonikClient.ts`, `runTurn`):**

```ts
export const PRIMARY_SEND_OPTIONS = Object.freeze({ maxRetries: 0 });
…
sent = await client.beta.sessions.events.send(session.id, { events }, primary ? PRIMARY_SEND_OPTIONS : undefined);
```

**Чому лише цей виклик:**
- Це перше прийняття повідомлення Daniel (або ритм-промпту), після якого модель може викликати інструменти й робити записи в Trello. Неоднозначний повтор тут дає найдорожчий дубль.
- Решта лишається з дефолтом SDK, бо має власну семантику:
  - GET status / list / retrieve: читання, повтор безпечний;
  - stream reconnect: #53;
  - `user.custom_tool_result`: lifecycle #40, `SEND_UNKNOWN`, ≤1 повтор тих самих байтів;
  - `user.tool_confirmation`: #39;
  - verification nudge (`primary === false`).
- Глобальний `maxRetries` клієнта не змінювався.

**Гарантія доставки до → після:**

| Етап | До | Після |
|---|---|---|
| A. До `events.send` | #53: безпечне відновлення (`not_submitted` → нова Session, ≤1 надсилання) | без змін |
| B. Первинний `events.send` | до **3** HTTP-спроб з тим самим `user.message` (SDK), без idempotency-ключа | **рівно одна** HTTP-спроба від Djonik/SDK |
| C. 5xx / обрив цієї спроби | delivery unknown, але SDK міг уже надіслати 2-3 копії | delivery unknown; 0 повторів SDK; 0 повторів Djonik; Session позначено unhealthy, handle скинуто; наступний хід — нова Session |
| D. Успішна відповідь з id події | нормальна обробка | без змін |

**Що тепер гарантовано:** Djonik/SDK робить **не більше однієї спроби надіслати** первинне `user.message`, коли прийняття неоднозначне.

**Що НЕ гарантовано:**
- **Exactly-once виконання на боці Anthropic не доведено.** Ми не контролюємо, що провайдер зробить з одним прийнятим запитом.
- Чи було повідомлення прийняте після 5xx, лишається невідомим (тому й рядок «перевір Trello»).
- Ціна: короткий одиничний 5xx на цьому виклику тепер не маскується автоматичним повтором SDK. Daniel отримує фіксований рядок і надсилає ще раз сам. Це свідомий обмін на відсутність тихих дублів.

## 6. Обрана архітектура відновлення

Найменша модель, що зберігає контракт #53, — розширити наявний `DjonikSessionDeadError`, а не вводити паралельний тип:

- `FeedDeathReason` += `provider_unavailable`.
- `runTurn`: якщо `events.send` впав і `sessionDisposition(classifyProviderFailure(error), "event_send") === "replace"` (5xx або обрив), то `feed.markDead("provider_unavailable")` і `DjonikSessionDeadError(pending = primary ? "unknown" : "processed", stage = "event_send", providerFailure)`.
- `runWithSessionRecovery` обробляє це вже наявним шляхом:
  - `invalidate(handle)` скидає саме цей handle;
  - `canResubmit("unknown") === false`, тож повтору немає;
  - наступний `getSession` створює й атестує нову Session.
- `DjonikSessionDeadError` тепер несе `stage` і `providerFailure`, лише для content-free телеметрії.
- Новий `DjonikSessionConnectError`: обгортка над будь-яким збоєм `getSession` у `runWithSessionRecovery`, як початковим, так і replacement. Означає «нічого не надіслано».
  - Для replacement: класифікований провайдерний збій → цей тип; некласифікований (наприклад, attestation) → оригінальна помилка, як у #53.

Що лишилось як було:
- reconnect до **тієї самої** Session при обриві stream;
- per-id dedupe;
- `classifyPendingMessage`;
- ≤1 resubmit;
- 4xx від живої Session — звичайна помилка, Session зберігається (наявний тест #53).

## 7. Таксономія помилок і тексти для Daniel

| Клас | Як визначається | Текст |
|---|---|---|
| upstream transient, нічого не надіслано | `DjonikSessionConnectError` із transient; 408/409/429 (4xx = відмова) | `PROVIDER_UNAVAILABLE_TEXT`: «⚠️ Сервіс Claude зараз тимчасово недоступний, тож це повідомлення я не обробив. Спробуй надіслати його ще раз за хвилину.» |
| upstream transient, могло дійти | `DjonikSessionDeadError(reason=provider_unavailable)` або 5xx/обрив без етапу | `PROVIDER_UNAVAILABLE_CHECK_TEXT`: «…тимчасово відповів помилкою, тож відповіді немає. Спробуй ще раз за хвилину; якщо просив зміну в Trello, спершу перевір, чи вона вже є.» |
| постійна auth/config | 401/403 (`AuthenticationError`/`PermissionDeniedError`) | `PROVIDER_CONFIG_TEXT`: «…не може підключитися до Claude. Це проблема налаштувань сервісу, а не твого повідомлення, тож повторне надсилання не допоможе, доки її не виправлено.» |
| запит відхилено | інший 4xx | `PROVIDER_REJECTED_TEXT` |
| Session не відкрилась (не провайдер) | `DjonikSessionConnectError` без класифікації | `SESSION_UNAVAILABLE_TEXT` |
| Session втрачена (#53) | `DjonikSessionDeadError` | без змін: `SESSION_LOST_RESEND_TEXT` / `SESSION_LOST_CHECK_TEXT` |
| unverified mutation (#56) | без змін | `UNVERIFIED_MUTATION_TEXT` |
| звичайна прикладна помилка | не `APIError` | без змін (наявне формулювання) |

Додатково:
- `formatGroupFailureError` делегує провайдерні та Session-помилки до `formatUserFacingError`. Деталі pre-send збоїв вкладень (#25) лишаються як були.
- Класифікація йде лише за класом і статусом SDK. Рядок `credential validation failed` використовується тільки як fixture. Тест доводить, що `new Error("503 credential validation failed")` **не** класифікується як провайдерний збій.

## 8. Інвалідація Session і повтори

`sessionDisposition(failure, stage)` (`src/providerFailure.ts`):
- `replace` — лише transient **5xx/обрив** на `event_send`;
- `keep`:
  - 408/409/429: throttling на рівні акаунта, нова Session не допоможе;
  - 401/403: той самий ключ буде й у новій Session;
  - інший 4xx;
  - будь-яка прикладна чи модельна помилка (наприклад, «no text reply»).

**Постійна помилка облікових даних:**
- **Runtime 401** → `providerFailureStop` → `requestStop("anthropic_auth_rejected", 1)`. Процес коректно drain-иться. systemd (`Restart=on-failure`) перезапускає його через 15 с, і preflight перевіряє ключ знову.
- **Startup 401/403** (preflight або перший `getSession`) → `classifyStartupProviderFailure` → exit **78**. `RestartPreventExitStatus=78` лишає unit зупиненим і видимим оператору, без restart-loop.
- Наслідок: випадковий 401 виправляється одним рестартом. Справді відкликаний ключ закінчується статусом `failed (78)`. До виправлення Telegram тримає непрочитані updates (до 24 год).
- **403 у runtime процес не зупиняє**: це може бути дозвіл на один ресурс.
- Transient-помилки процес не зупиняють ніколи.
- Це сумісно з наявним дизайном (той самий `requestStop`, що й для drift attestation, #33). Unit-файл не змінено.

## 9. Змінені файли

| Файл | Зміна |
|---|---|
| `src/providerFailure.ts` (новий) | `classifyProviderFailure`, `sessionDisposition`, типи `ProviderFailure` і `ServingStage` |
| `src/sessionEventFeed.ts` | `FeedDeathReason` += `provider_unavailable` |
| `src/djonikClient.ts` | `DjonikSessionDeadError.stage/providerFailure`; 5xx/обрив на `events.send` → give-up `provider_unavailable` (`unknown`); **доповнення:** `PRIMARY_SEND_OPTIONS = { maxRetries: 0 }` лише для первинного `user.message` |
| `src/telegramAdapter.ts` | `DjonikSessionConnectError`; нові тексти; `formatUserFacingError` / `formatGroupFailureError` без сирого тексту провайдера; `ServingTurnFailureEvent` + `servingTurnFailureOf`; `runWithSessionRecovery(…, onFailure)` |
| `src/telegramDispatch.ts` | опція `onTurnFailure` |
| `src/rhythmRuntime.ts` | `createSessionTurnRunner(…, onTurnFailure)` |
| `src/servingLifecycle.ts` | `providerFailureStop`, `classifyStartupProviderFailure` |
| `src/telegramCli.ts` | лог `[session] {"type":"serving_turn_failure",…}`; 401 → graceful stop; startup 401/403 → 78 |
| `src/streamRecovery.test.ts` | fake-сервер: `sendFailures` (у т.ч. «прийнято, але 5xx»), `createFailures`; 9 тестів #60. **Доповнення:** fake `send` моделює повтори SDK за кожною HTTP-спробою (`1 + (maxRetries ?? 2)`) і записує `sendOptions`; ще 4 тести, один із них — контракт на реальному встановленому SDK через fake `fetch` |
| `src/providerFailure.test.ts` (новий) | 8 unit-тестів |

## 10. До → після

| Ситуація | До | Після |
|---|---|---|
| 503 на `events.send` | сирий «…: 503 credential validation failed»; Session лишається в кеші | `PROVIDER_UNAVAILABLE_CHECK_TEXT`; Session скинуто; 0 повторів; наступний хід іде в нову Session |
| 503 на `sessions.create` | сирий текст на кожен хід | `PROVIDER_UNAVAILABLE_TEXT` («не обробив»); `stage=session_connect` у журналі |
| Session втрачена + replacement 503 | `SESSION_LOST_RESEND_TEXT` | `PROVIDER_UNAVAILABLE_TEXT` (теж «не оброблено», але з причиною) |
| 401 | сирий текст на кожен хід, процес працює | `PROVIDER_CONFIG_TEXT`; graceful restart → preflight → 78, якщо ключ справді поганий |
| startup 401/403 | exit 1 → до 5 рестартів → StartLimit | exit 78 одразу |
| 429 / 400 на send | сирий текст | фіксований рядок; Session зберігається |
| «no text reply» | без змін | без змін; Session зберігається |

## 11. Тести і перевірки (точні результати)

- **Baseline** (чистий `main` @ `6f19ed6`, до змін): `npm test` → **1482 tests, 1480 pass, 2 fail**:
  - `deploy script survives replacing itself…` (`deployConfig.test.ts`, CRLF у Windows checkout);
  - `a real process that fetched over keep-alive exits…` (`processExit.test.ts`, тайминг у Windows).
- Фокусні набори після змін, ще без нових тестів (`streamRecovery`, `telegramAdapter`, `telegramDispatch`, `djonikClient`, `servingLifecycle`, `rhythmRuntime`, `turnCompletion`, `toolConfirmationClient`, `turnClock`, `commitmentContract`, `forwardedDispatch`, `messageGrouping`, `voiceInput`, `servingRelease`): **502/502 pass**.
- `src/streamRecovery.test.ts`: **31/31** (22 #53 + 9 #60); після доповнення **35/35** (+4).
- `src/providerFailure.test.ts`: **8/8**.
- Повний `npm test`: **1499 tests, 1497 pass, 2 fail**. Падіння ті самі, що в baseline, і з #60 не пов'язані.
- **Доповнення §5a:**
  - Фокусні набори (`streamRecovery`, `providerFailure`, `djonikClient`, `telegramAdapter`, `customToolResolution`, `customToolRouting`, `toolConfirmation`, `toolConfirmationClient`, `telegramDispatch`): **297/297 pass**.
  - Повний `npm test`, перший прогін: **1503 tests, 1500 pass, 3 fail**. Обидва відомі baseline-падіння плюс `reminderDelivery.test.ts` «crash during the Telegram call…». Цей файл не імпортує жодного зміненого модуля й окремо пройшов 3/3 рази: це flaky-тайминг під навантаженням.
  - Повторний повний прогін: **1503 tests, 1501 pass, 2 fail**, лише baseline.
  - `typecheck` і `build` без помилок.
  - **Мутаційна перевірка:** з тимчасово прибраним override (одразу відновлено) тести #60 падають. Отже вони справді охороняють `maxRetries: 0`.
- Нові тести доповнення:
  1. **Контракт SDK** (реальний `Anthropic` + fake `fetch`, 503 з `credential validation failed`): за замовчуванням `events.send` робить **3** POST; з `PRIMARY_SEND_OPTIONS` — **1**; обрив з'єднання з override — теж 1.
  2. **«Прийнято, а потім 503»:** `sendOptions` = `[{ maxRetries: 0 }]`, одна HTTP-спроба, одна копія в історії Session, `unknown`, handle скинуто, наступний хід — нова Session. Негативний контроль: та сама модель за дефолтних повторів зберегла б 3 копії.
  3. Звичайний успішний хід: одна спроба, override присутній, подій збою немає.
  4. Продовження custom-tool: `sendOptions` = `[PRIMARY_SEND_OPTIONS, undefined]`, тобто override стосується лише первинного `user.message`.
- Без змін і зелені: тести #53 щодо повторного надсилання (`not_submitted` / `unprocessed`), lifecycle #40/#39, усі попередні тести #60, включно з тим, що інцидентний текст не потрапляє в Telegram.
- `npm run typecheck`: без помилок. `npm run build`: без помилок.

Що доводять нові тести (нумерація відповідає вимогам):
1. Інцидентний `InternalServerError("503 credential validation failed")` не з'являється у видимому тексті: одиночний хід, груповий шлях, connect, traced.
2. Класифікація йде за класом і статусом. Той самий текст у plain `Error` — не провайдерний збій. Той самий текст із 401 — `auth_config`.
3. 401/403 ≠ 503: інший текст, Session зберігається, `providerFailureStop` спрацьовує лише на 401.
4. Прикладна помилка («no text reply») не скидає Session; наступний хід — у тій самій.
5. 503 на send → саме цей handle скинуто; `getSession` створює `sesn_2`.
6. Після збою два наступні ходи йдуть у `sesn_2`; погана Session більше нічого не отримує.
7. «Прийнято, але 5xx» → рівно одне `user.message` на всі Session. Хід у черзі (доведено не надісланий) → одне надсилання в replacement. Збійне повідомлення не повторюється.
8. Усі 22 тести #53 проходять без змін.
9. Скрін + текст і лише текст → ідентичні видимі рядки й телеметрія.
10. `serving_turn_failure` не містить тексту, id Session/подій, ключів, URL і `credential`.
11. Звичайний і груповий форматери; деталі pre-send збою вкладення збережено.
12. `providerFailureStop` / `classifyStartupProviderFailure`: runtime 401 → exit 1, startup 401/403 → 78, transient → null.

## 12. Спостережуваність

Новий рядок у журналі (завжди увімкнений, той самий префікс `[session]`, що й у #53):

```
[session] {"type":"serving_turn_failure","stage":"event_send","category":"upstream_transient","status":503,"errorClass":"InternalServerError","sessionAction":"replace","delivery":"unknown"}
```

- Без тексту повідомлення, id, request-id, URL і тіла відповіді.
- Наявний `logError("Djonik grouped turn failed:", error)` не змінено. Він, як і раніше, пише в journald повний об'єкт помилки SDK, включно з `request-id` відповіді. Секретів там немає (ключ — заголовок запиту, а не відповіді). Саме `request-id` знадобиться для звернення в підтримку Anthropic щодо upstream-причини.

## 13. Що лишається невідомим / відкладене

- Точна upstream-причина 503 (gateway? сервіс перевірки ключа? облікові дані vault під час `sessions.create`?). Для звернення в підтримку потрібні host-логи з `request-id` за 2026-09-29 ~17:30 Kyiv. Їх не читали.
- Чи відповідає інцидент гіпотезі A чи B (§4). Розрізняють host-логи. Після цієї зміни це видно одразу з `stage`.
- ~~Вбудовані повтори SDK для `events.send`~~ — **закрито доповненням §5a** для первинного `user.message`.
- Відкладено (поза межами #60): SDK, як і раніше, може повторити `user.message` **verification nudge** (`primary === false`), а також continuation-надсилання #40/#39. Для nudge ризик менший: це запит на коректне читання після вже завершеного ходу. Для continuation діють власні per-id lifecycle, а провайдер прив'язує результат до `custom_tool_use_id` / `tool_use_id`. Ідемпотентність цих викликів на боці провайдера офіційно не задокументована.
- Етап F (продовження custom-tool / confirmation): транзієнтний 5xx лишається звичайною помилкою за lifecycle #40/#39 (`SEND_UNKNOWN`), без заміни Session. Тексти цих помилок англомовні, але без тексту провайдера. Змінювати це поза межами #60.
- Явного повтору connect у тому самому ході немає: SDK уже повторив 2×, а ще одна спроба під час багатохвилинного збою провайдера не допомогла б.
- Hosted-перевірка (штучний 503 на production) не виконувалась і без окремої авторизації не планується.

## 14. Реліз / deploy

- **Тільки застосунок.** Agent, Skills, custom-tool surface, Memory і release-конфігурація не змінювались. Кандидата r31 не зачеплено.
- Зміна безпечна для deploy під поточним **r30** як нова app-ревізія (`DJONIK_APP_REVISION`): attestation перевіряє remote-конфігурацію Agent/Session, а не код застосунку.
- Deploy, рестарт і hosted smoke — окремі авторизовані кроки.

## 15. `git diff --check`

Чисто (лише попередження Git про LF→CRLF у трьох файлах, без whitespace-помилок).

## 16. `git status --short`

```
 M src/djonikClient.ts
 M src/rhythmRuntime.ts
 M src/servingLifecycle.ts
 M src/sessionEventFeed.ts
 M src/streamRecovery.test.ts
 M src/telegramAdapter.ts
 M src/telegramCli.ts
 M src/telegramDispatch.ts
?? docs/101_ISSUE_60_PROVIDER_FAILURE_RECOVERY_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/providerFailure.test.ts
?? src/providerFailure.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` уже був untracked до початку роботи й до #60 не належить.
