# Issue #40 — звіт про реалізацію: ідемпотентне продовження custom tools за event id

Дата: 2026-09-22  
Canonical issue: [#40 — Runtime reliability — idempotent Managed Agents custom-tool continuation by event id](https://github.com/danielkokr/djonik-manager-2.0/issues/40)  
Decision record: [docs/30](30_RUNTIME_EVENT_LOOP_AUDIT.md) (рішення **B**), правило: [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md) §13  
Базовий HEAD: `b78116c`. Це основний (principal) implementation pass за stop rule з #40.

## 1. Підсумок

`session.status_idle{requires_action}` більше не запускає виконання інструмента. Тепер це статус, який клієнт звіряє з Session-scoped lifecycle по кожному `custom_tool_use_id`. Lifecycle живе в новому модулі `src/customToolResolution.ts`.

Кожен окремий id виконується не більше одного разу за Session. Його точний результат кешується. Повторно надіслати можна лише ці кешовані байти, і лише коли подання не було прийняте. Echo `user.custom_tool_result` переводить id у RESOLVED.

Provenance для #36 тепер рахує окремі `custom_tool_use_id` поточного turn з їхнім одним кешованим результатом, а не кількість подань. Обидва суміжні hardening-пункти зроблено:
- specialist thread idle: перемагає останній статус;
- same-id replay у mutation ledger більше нічого не перезаписує.

Точне офлайн-відтворення docs/29 падало до виправлення і проходить після нього.

## 2. Доказ падіння регресії до виправлення

Тест `#40 1 (docs/29 exact reproduction)` у `src/turnCompletion.test.ts` запускався **до будь-якої зміни runtime-коду**:

```text
node --import tsx --test --test-name-pattern="#40 1" src/turnCompletion.test.ts

✖ #40 1 (docs/29 exact reproduction): a re-emitted requires_action for the SAME id never re-executes or re-submits
  AssertionError [ERR_ASSERTION]: executor invocation count === distinct custom_tool_use_ids (1)
  2 !== 1
  actual: 2, expected: 1, operator: 'strictEqual'
ℹ tests 1 / pass 0 / fail 1
```

Решту симптомів до виправлення зафіксовано на тимчасовій копії тесту (її видалено):

```text
PREFIX executor calls: 2 result sends: 2 reply: "Дві картки повернулись з Done — варто перевірити."
traces: [custom_tool_result_sent, custom_tool_result_sent, work_history_relay_skipped]
```

Це дослівно інцидент із docs/29: подвійне виконання, подвійне подання, relay пропущено, назовні пішов сирий текст координатора.

Додатково всі нові фікстури #40 проганялися на старому `djonikClient.ts` (потім його відновили):
- на старому клієнті падають #40 1, 2, 3 (на `3` старий клієнт зависав до timeout), 4, 4b, 5, 6, 8, 9;
- #40 7 проходить і на старому клієнті: він перевіряє, що не змінилася наявна поведінка «два id → ambiguous».

Hardening-тести проганялися на HEAD-версіях `turnCorrelation.ts` і `trelloMutationLedger.ts`. Падають усі три:
- `#40: a replay … preserves the correlated outcome`: `'no_result' !== 'verified'`;
- `SpecialistTurnProvenance (#40): the latest thread idle wins`: `unverified/child_not_completed` замість `verified`;
- інтеграційний `#40 10`.

## 3. Змінені файли

| Файл | Зміна |
|---|---|
| `src/customToolResolution.ts` | **новий**: Session-scoped per-id lifecycle, кеш результатів, класифікація помилок send |
| `src/customToolResolution.test.ts` | **новий**: 10 unit-тестів lifecycle |
| `src/djonikClient.ts` | межа продовження custom tools переведена на lifecycle; per-id provenance #36 |
| `src/turnCorrelation.ts` | `onThreadIdle`: перемагає останній статус |
| `src/trelloMutationLedger.ts` | `recordToolUse`: replay уже записаного id ігнорується |
| `src/turnCompletion.test.ts` | відтворення docs/29 і фікстури #40 2–10 |
| `src/turnCorrelation.test.ts` | unit-тест «перемагає останній idle» |
| `src/trelloMutationLedger.test.ts` | unit-тест replay |
| `docs/31_ISSUE_40_IMPLEMENTATION_REPORT.md` | цей звіт |

## 4. Дизайн lifecycle і переходи станів

API вузький і не привʼязаний до семантики `trello_work_history`:

```ts
new CustomToolResolution(supportedToolNames)
observeUse({ id, name, input })       // agent.custom_tool_use
observeResultEcho(customToolUseId)    // user.custom_tool_result echo → RESOLVED
resolveBlocking(blockingIds, executor, send) → { executed, submitted }
has / name / state / result           // читання для provenance
```

| Стан | Вхід | Повторний `requires_action` з цим id |
|---|---|---|
| OBSERVED | `observeUse` (name/input збережено; replay того самого id зберігає перше спостереження) | запускає виконання, **один раз** |
| EXECUTING | початок виконання; promise зберігається в записі | no-op |
| RESULT_READY | executor завершився; результат кешовано. Throw → один кешований `is_error` з фіксованим `EXECUTOR_EXCEPTION_CONTENT`, без внутрішніх деталей | подати кеш (якщо ще не подано) |
| SUBMITTED | `events.send` успішний | no-op (випадок docs/29) |
| SEND_UNKNOWN | send кинув помилку з невідомим результатом | повторно подати **ті самі кешовані байти**, без re-execute |
| SEND_REJECTED | постійна 4xx | видима помилка, без resend |
| RESOLVED | echo `user.custom_tool_result` | видима помилка неузгодженості, без re-execute і resend |

**Загальні правила:**
- **Валідація всього списку до будь-якої дії.** Спершу перевіряється весь blocking-список. Якщо в ньому є malformed, неспостережений або непідтримуваний id, RESOLVED чи SEND_REJECTED — нічого не виконується і не подається.
- **Окремі id — окремі виклики.** Два різні id ніколи не зливаються, навіть з ідентичними name/input.
- **Класифікація помилок send.** Постійною вважається 4xx, окрім 408/409/429. Це те саме правило, що `isFatal4xx` у SDK `SessionToolRunner`. Усе інше вважається невідомим результатом: connection error, timeout, 408/409/429, 5xx, помилка не від API.
- **Межа повторів.** За один крок розвʼязання — максимум 2 спроби: перше подання плюс один resend тих самих байтів. Якщо результат і далі невідомий, id лишається SEND_UNKNOWN з цілим кешем, а turn падає видимо. Backoff, циклів і reconnect немає.
- **Стан.** Живе в памʼяті процесу на весь час Managed Session. Персистентності немає.

**Додатковий стан SEND_REJECTED.** Це єдине відхилення від канонічного списку станів. Це термінальний стан для постійної 4xx: він потрібен, щоб «permanent 4xx → без циклу повторів» трималося і на пізнішому idle.

## 5. Інтеграція в djonikClient

- `customTools` створюється один раз у `connectToDjonik`, тобто на Session. Per-turn `customToolCallsById.clear()` прибрано.
- `agent.custom_tool_use` → `observeUse` і запис id у `turnCustomToolUseIds`. Цей список скидається раз на видимий turn у `sendPartsSerial`, а не в `runTurn`, тож verification-nudge rerun не губить виклик.
- `user.custom_tool_result` → `observeResultEcho`. Echo — факт рівня Session, тому фіксується навіть до anchor і на reply не впливає.
- `requires_action`:
  - якщо цей turn не спостерігав жодного custom use і жоден blocking id не відомий lifecycle → як і раніше, incomplete (#32);
  - інакше → `resolveBlocking`;
  - `reply = ""` лише при реальному новому виконанні;
  - trace `custom_tool_result_sent` емітиться один раз на id, чиє подання прийнято.
- **Не змінено:** один persistent stream, open-before-send, FIFO `enqueue`, anchoring через echo `user.message`, завершення лише через `end_turn`, #31 ledger і nudge, #32 correlation, fail-closed для непідтримуваних і змішаних станів. Тексти помилок malformed/unsupported збережено.

## 6. Per-id provenance для #36

`workHistoryResults: string[]` і `workHistoryHadUnusableResult` видалено. Тепер `workHistoryVerdict()` бере окремі id `trello_work_history` з `turnCustomToolUseIds`:

| Випадок | Вердикт |
|---|---|
| 0 id | `none` |
| більше 1 окремого id, навіть з ідентичним input/output | `unverified` |
| 1 id: кешований результат є, не `is_error`, стан SUBMITTED або RESOLVED, `answer_text` придатний | `verified` |
| 1 id з будь-якою іншою формою | `unverified` |

Повторні idle чи спроби send для того самого id лишаються одним викликом. Id з попереднього видимого turn не потрапляє в `turnCustomToolUseIds` поточного, тому не може стати його provenance. Це перевіряє фікстура #40 9c.

Не змінювалися renderer Variant-B, Skill `work-review`, prompts, `composeWorkHistoryReply`, separator і володіння фактами та коментарем.

## 7. Hardening specialist idle

`SpecialistTurnProvenance.onThreadIdle`: `thread.incomplete = classifyStopReason(...) !== "end_turn"`, тобто перемагає останній статус.
- `requires_action → end_turn` → verified;
- `end_turn → budget_reached` → як і раніше, `child_not_completed`.

Інша логіка кореляції не змінювалася.

## 8. Hardening replay у mutation ledger

`TrelloMutationLedger.recordToolUse` ігнорує id, який уже записаний. Порядок (`useSeq`), корельований результат і outcome зберігаються: verified лишається verified, failed лишається failed зі своїм `errorText`. Інша семантика #31 без змін.

## 9. Тести і перевірки

Покриття acceptance-пунктів #40:

| # | Тест | Виконань executor |
|---|---|---|
| 1 | `#40 1` точне відтворення docs/29 | 1; send 1; relay `with_commentary`; `end_turn` |
| 2 | `#40 2` дубль idle до settle executor-а + unit «EXECUTING → no-op» (справжня конкурентність) | 1 |
| 3 | `#40 3` + unit: idle після RESOLVED → видима помилка | 1; resend 0 |
| 4 | `#40 4` transient → один resend байт-ідентичний, relay verified; `#40 4b` двічі невідомо → видима помилка; unit: пізніший resend тих самих байтів | 1 |
| 5 | `#40 5` + unit: 400 → видима помилка; спроб 1; пізніший idle → помилка без resend | 1 |
| 6 | `#40 6` + unit: throw → один `is_error`, без зависання, relay skipped | 1 |
| 7 | `#40 7` (один idle `[A,B]` і послідовні idle): два окремі id, ambiguous | 2 |
| 8 | `#40 8a` `[A,B]` плюс повторний залишок `[B]`; `#40 8b` `[A]`, потім `[A,B]` | 2 (по одному на id) |
| 9 | `#40 9a` nudge rerun; `9b` межа turn зі strict anchoring (карантин); `9c` межа turn без anchoring (no-op, без stale provenance) | 1 у кожному |
| 10 | `#40 10` (інтеграція) + unit у `turnCorrelation.test.ts` | — |
| 11 | unit у `trelloMutationLedger.test.ts` | — |
| 12 | повні наявні сюїти #31, #32, #36 | зелені |

У кожній custom-tool фікстурі є явний assertion `executor invocation count === distinct custom_tool_use_ids`.

Фінальні перевірки:

```text
npm test
ℹ tests 495 · pass 495 · fail 0 · cancelled 0 · skipped 0 · todo 0

npm run typecheck
> tsc --noEmit        (без помилок)

git diff --check
(чисто)
```

Фокусні прогони: `turnCompletion.test.ts` — 66/66; `customToolResolution` + `turnCorrelation` + `trelloMutationLedger` — 65/65.

## 10. Обмеження і відкриті питання

- **Resend при невідомому результаті.** Відбувається один раз одразу, без backoff. SDK уже сам повторює 408/409/429/5xx і connection errors на рівні HTTP, тому це лише один додатковий крок поверх нього. Якщо перша спроба насправді дійшла, resend — дубль для того самого id. docs/30 фіксує, що провайдер тихо відкидав такий дубль (2xx), але це не задокументовано. Якщо провайдер відповість на такий дубль 4xx, turn впаде видимо (fail-closed).
- **Відтворення на провайдері не робилося.** Реальний провайдерський smoke — це окремо авторизована #36-діагностика після прийняття.
- **Персистентності, reconnect і reconcile немає.** Обрив stream і далі означає `DjonikSessionDeadError`. Після рестарту процесу lifecycle порожній. Для read-only `trello_work_history` це прийнятно. Side-effecting custom tool і далі заборонений без idempotency key або durable intent плюс #31-верифікації (docs/01 §13).
- **Pre-anchor `agent.custom_tool_use`.** Як і раніше, карантинується і не спостерігається. Idle, що назве такий id, впаде fail-closed як unsupported.
- **Документація.** `docs/01` §13 і roadmap досі кажуть «not yet implemented». Їх синхронізують після прийняття Product Owner, за робочим процесом.
- **Розбіжностей з офіційним API чи SDK не знайдено.** Тип `user.custom_tool_result` входить у union stream-подій SDK 0.125.0. Класифікацію 4xx узято із семантики SDK `SessionToolRunner`.

## 11. `git diff --stat`

```text
 src/djonikClient.ts              | 112 ++++++-------
 src/trelloMutationLedger.test.ts |  30 ++++
 src/trelloMutationLedger.ts      |   4 +-
 src/turnCompletion.test.ts       | 336 +++++++++++++++++++++++++++++++++++++++
 src/turnCorrelation.test.ts      |  18 +++
 src/turnCorrelation.ts           |   4 +-
 6 files changed, 446 insertions(+), 58 deletions(-)
```

Плюс нові untracked-файли: `src/customToolResolution.ts`, `src/customToolResolution.test.ts` і цей звіт.

## 12. `git status --short`

```text
 M src/djonikClient.ts
 M src/trelloMutationLedger.test.ts
 M src/trelloMutationLedger.ts
 M src/turnCompletion.test.ts
 M src/turnCorrelation.test.ts
 M src/turnCorrelation.ts
?? docs/31_ISSUE_40_IMPLEMENTATION_REPORT.md
?? src/customToolResolution.test.ts
?? src/customToolResolution.ts
```

## Підтвердження

Не було: commit, push, deploy, змін production чи конфігурації Agent/Skill/Memory, створення Agent або Session, платного inference, змін поведінки work-review, renderer чи prompts. #36 live validation не продовжувалася.
