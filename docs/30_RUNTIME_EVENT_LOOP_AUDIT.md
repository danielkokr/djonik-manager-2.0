# Незалежний аудит runtime event-loop Managed Agents (#36: повторний `requires_action`)

Дата: 2026-09-22  
Canonical issue: [#36 — Weekly work review from Trello action history](https://github.com/danielkokr/djonik-manager-2.0/issues/36)  
HEAD під час аудиту: `7323dee` (source: `d9b3496`, `3e180ae`)  
SDK: `@anthropic-ai/sdk` 0.125.0

## 0. Межі аудиту

Код, issues, Agents і production не змінювалися. Sessions не створювалися, платний inference не запускався, commit/push/deploy не було.

Єдині зовнішні виклики: два безкоштовні read-only `events.list` (GET) для діагностичної Session `sesn_01SpGKMBQ25a6f7UG4Tttqy8`. Виводилися лише id, типи, `processed_at`, імена інструментів і `stop_reason`, без контенту.

## 1. Діагноз

Провайдер не помилився. Помилився клієнт у тому, як він трактує сигнал провайдера.

В одній model response Haiku зробила два паралельні виклики:
- built-in `read` файлу `/workspace/skills/work-review/SKILL.md`;
- custom tool `trello_work_history`.

Сервер сам обслужив `read`: перейшов idle → running → idle приблизно через секунду. Друге `session.status_idle` — це **нова окрема подія** з іншим id. Вона повторно назвала той самий ще не розвʼязаний custom-tool id у `requires_action` і з'явилася **до того**, як клієнт надіслав будь-який результат.

Клієнт трактує кожну idle-подію як команду «виконай інструмент зараз». Тому `trello_work_history` виконався двічі, і результат було надіслано двічі. Per-turn tracker рахує подання, а не id інструмента. Він побачив два результати, визнав provenance неоднозначним і пропустив relay. Назовні пішов сирий текст Haiku.

Сервер зберіг лише **один** `user.custom_tool_result`. Друге надсилання повернуло 2xx і було тихо відкинуте. Ця поведінка не задокументована, покладатися на неї не можна.

Суть помилки: клієнт трактує `session.status_idle` як одноразову команду (edge-triggered). Для провайдера це статус (level-triggered), який він може надсилати повторно щоразу, коли Session знову стає idle.

## 2. Офіційний контракт API

### Що задокументовано / гарантовано

Джерела: сторінка документації `managed-agents/events-and-streaming` і типи SDK 0.125.0.

- **Потік custom tool:** `agent.custom_tool_use` → `session.status_idle{requires_action, event_ids}` → `user.custom_tool_result` з `custom_tool_use_id` → «Once all blocking events are resolved, the session transitions back to `running`.»
- **Повторна емісія idle.** Тип SDK `BetaManagedAgentsSessionRequiresAction.event_ids` каже: «Resolving fewer than all re-emits `session.status_idle` with the remainder.» Отже, повторна емісія idle для ще не розвʼязаних id є частиною дизайну, щонайменше при частковому розвʼязанні.
- **Idle як поточний стан.** Опис `custom_tool_use_id` посилається на «the last `session.status_idle`», тобто на поточний стан, а не на одноразову команду.
- **Stream.** Він доставляє лише події, emitted після відкриття, тому stream треба відкривати до `send`.
- **Reconnect.** Документований рецепт: відкрити новий stream → list повної історії → seed множини seen event IDs → tail stream, пропускаючи вже бачене. Тобто від клієнта очікується дедуплікація за event id.
- **SDK `SessionToolRunner`** (`lib/tools/SessionToolRunner.js`) — захищена референс-реалізація Anthropic саме цього циклу. Він:
  - dispatch-ить з `agent.custom_tool_use`, а не з idle;
  - тримає множини `seen` і `answered` на весь час Session;
  - позначає id як `answered` після успішного send **або** після echo `user.custom_tool_result` у stream;
  - містить коментар: «Mark the event seen so a replay on the live stream is not dispatched twice»;
  - повторює send результату з backoff, reconnect-ить stream і звіряється з `events.list`.

### Чого документація НЕ визначає

Кожен пункт перевірено: на сторінці документації відповідної теми немає.

- частота і тригери повторної емісії idle (зокрема при паралельних built-in + custom викликах);
- гарантії доставки (at-least-once, exactly-once), гарантії порядку;
- поведінка при повторному `user.custom_tool_result` або при result для вже розвʼязаного id;
- ідемпотентність `events.send`.

Офіційний TypeScript-приклад у документації dispatch-ить з idle без дедуплікації, тобто має **той самий дефект**, що й наш клієнт. Наш клієнт відтворив документований патерн, а сам патерн наївний.

## 3. Точна послідовність подій

Персистентний event list сесії `sesn_01SpGKMBQ25a6f7UG4Tttqy8`, content-free. Час — секунди після 12:23 UTC, 2026-09-22.

| # | Час | Подія провайдера | Дія клієнта | Очікувано (модель клієнта) | Фактично |
|---|---|---|---|---|---|
| 2 | 40.438 | `user.message` `sevt_01VhEU…` | anchor | початок turn | ✓ |
| 5 | 44.702 | `agent.tool_use` **read** SKILL.md (`perm=allow`) | лише телеметрія | — | паралельно з custom tool |
| 6 | 44.702 | `agent.custom_tool_use` `sevt_019H1H…` | запис у map | observed | ✓ |
| 8 | 44.848 | `session.thread_status_idle` requires_action:[019H1H] (primary thread) | ігнорується (не canonical specialist) | — | ✓ |
| 10 | 44.848 | `session.status_idle` `sevt_0134Hf…` requires_action:[019H1H] | **execute №1** (~3 с), потім send | єдина пауза | ✓ |
| 11–12 | 44.989 | `status_running` + thread running | (клієнт виконує; події буферизуються) | — | сервер обслуговує `read` |
| 13 | 46.025 | `session.thread_status_idle` requires_action:[019H1H] | ігнорується | — | — |
| 15 | 46.025 | `session.status_idle` **`sevt_0175kB…`** (інший id) requires_action:[019H1H] | прочитано з буфера після send №1 → **execute №2** | не мало б існувати | повторний статус; на момент емісії id ще був нерозвʼязаний |
| 16 | 47.943 | `user.custom_tool_result` `sevt_01CP2j…` для 019H1H | echo ігнорується | — | send №1 персистовано |
| 17 | 48.012 | `status_running` | — | — | розвʼязання прийнято |
| 19 | 48.055 | `agent.tool_result` для `read` | — | — | результат read дописано |
| 21 | 49.767 | `agent.message` `sevt_01MKXA…` | reply збережено | — | сирий текст Haiku |
| 25 | 50.046 | `session.status_idle` end_turn `sevt_01NCrc…` | (клієнт ще в execute №2; send №2 після цього) | завершення | ✓; send №2 пішов на вже розвʼязаний id → 2xx, **не персистовано** |

Після execute №2 tracker мав два результати. Результат: `work_history_relay_skipped` і сирий reply. Це збігається з docs/29: два `custom_tool_result_sent`, потім relay skipped.

## 4. Першопричина

Клієнт виконує і надсилає результат один раз на кожну idle-подію `requires_action`, а не один раз на кожен `custom_tool_use_id`. Повторну idle-подію (A) провайдер емітив легітимно. Вона виявила, що в клієнта немає стану по кожному id (D). Друга idle була буферизована у stream, поки клієнт виконував інструмент, тож клієнт прочитав її вже після того, як його власний send розвʼязав виклик.

| Гіпотеза | Вердикт | Доказ |
|---|---|---|
| A. Провайдер легітимно повторно емітить idle для того самого blocking id | **SUPPORTED** | Два різні idle id (`0134Hf`, `0175kB`). Між ними running без жодного вводу клієнта. Узгоджується з формулюванням SDK «re-emits `session.status_idle`». Тригер — майже напевно паралельний built-in `read`; це висновок, не задокументований факт. |
| B. Stream повторює вже бачену idle після `events.send` | **CONTRADICTED** | Id різні; обидві idle передують result (46.025 < 47.943). |
| C. Застаріла idle через хибну anchor-логіку | **CONTRADICTED** | Обидві idle — після echo власного `user.message` цього turn; попереднього turn не було. |
| D. Клієнт не розрізняє «tool use observed» і «result submitted» | **SUPPORTED** | У `djonikClient.ts:1033-1073` немає стану по id. Echo `user.custom_tool_result` потрапляє в `default: break`. |
| E. Розвʼязання має бути ідемпотентним за event id | **SUPPORTED** (як виправлення) | `seen`/`answered` у SDK runner; дедуплікація в документованому reconnect-рецепті. |
| F. Перший send насправді не розвʼязав blocking | **CONTRADICTED** | Персистований result о 47.943, одразу після нього `status_running` о 48.012. |
| G. Змішування подій між `runTurn`/`sendPartsSerial` | **CONTRADICTED** | Один turn, без nudge, усе після anchor. |
| H. Persistent stream як такий непридатний | **UNLIKELY** | Документація вимагає відкривати stream до send; SDK runner теж використовує довгоживучий stream. |
| I. Потрібен інший документований патерн продовження | **POSSIBLE / частково SUPPORTED** | Захищений патерн — семантика SDK `SessionToolRunner`. Приклад у документації — ні. |
| J. Інше: недокументоване прийняття дубльованого result | **SUPPORTED, вторинне** | Send №2 повернув 2xx без персистування. Нам пощастило: 4xx зламав би turn, а персистований дублікат міг би знову розбудити агента. |

Доказів достатньо. Невідомими лишаються точний серверний тригер повторної емісії і те, чи дубльований result завжди тихо відкидається. Виправлення від цього не залежить.

## 5. Аудит коректності клієнта

**Коректно:**
- persistent single iterator;
- строга FIFO-черга `enqueue`;
- open-before-send;
- anchoring через echo `user.message` (#32). Тут він спрацював правильно і є належним захистом від застарілих подій попереднього turn.

**Некоректно — обробка `requires_action`** (`djonikClient.ts:1036-1073`):
- dispatch запускається idle-подією;
- немає lifecycle по кожному id;
- echo розвʼязання ігнорується;
- результати потрапляють у `workHistoryResults` у момент виконання, а не по id;
- `Promise.all` по executor не захищений від throw: якщо executor кине виняток, Session лишиться заблокованою без result. Нинішній `executeTrelloWorkHistoryFromEnvironment` сам ловить помилки, але майбутні executors можуть цього не робити;
- `reply = ""` на кожній requires_action idle тут нешкідливе, але спирається на те саме хибне припущення «idle = одноразова подія».

**Тести.** Усі fixtures у `turnCompletion.test.ts:251-310` і `:965-1097` пушать рівно одну idle на один custom tool use. Fake stream закодовує хибне припущення, тому жоден тест не міг цього спіймати.

**Відсутнє, але не причетне до інциденту:** reconnect/reconcile stream. Зараз обрив stream = `DjonikSessionDeadError`. Це fail-closed і прийнятно.

## 6. Модель ідемпотентності

Розвʼязання пари `(session_id, custom_tool_use_id)` має бути **ідемпотентним переходом стану**, зі станом по кожному id на весь час життя Session. Простого Set недостатньо: виконання і подання результату потребують окремих станів.

| Стан | Коли входимо | Якщо той самий id зʼявився знову (повторна idle з ним) |
|---|---|---|
| OBSERVED | `agent.custom_tool_use` (зберегти name, input, `session_thread_id`) | — |
| EXECUTING | перша idle `requires_action`, що називає OBSERVED id з дозволеним іменем. Виконання одне, його promise зберігається. | no-op, продовжити читання. Ніколи не запускати друге виконання. |
| RESULT_READY | executor settled, результат кешовано по id. Throw executor-а → кешований `is_error` result, щоб Session ніколи не лишалася заблокованою. | no-op |
| SUBMITTED | `events.send` повернув 2xx | no-op. Спостережений випадок саме такий: idle, емітована до подання, але прочитана після нього. |
| SEND_UNKNOWN | send кинув network error / timeout | Повторити **кешований** result (ніколи не re-execute) з обмеженим backoff. Після reconnect спершу перевірити в `events.list`, чи result уже існує. Постійна 4xx → видима помилка turn. |
| RESOLVED | echo `user.custom_tool_result` для цього id у stream (авторитетно) | idle з RESOLVED id суперечить власному стану провайдера → видима помилка turn, без re-execute і resend. |

**Загальні правила:**
- id не OBSERVED або з недозволеним іменем → fail-closed, як зараз;
- змішані blocking-списки (custom + confirmation) → incomplete / fail-closed, як зараз;
- idle `requires_action`, у якій **усі** id вже в стані EXECUTING або далі → no-op.

## 7. Побічні ефекти майбутніх custom tools

- Lifecycle із §6 уже унеможливлює друге виконання в межах одного процесу. Це необхідно, але недостатньо.
- **Дедуплікувати виконання і подання окремо.** Виконання — не більше одного разу на id. Подання можна повторювати, але лише з кешованими байтами.
- **Кешувати результати по `custom_tool_use_id` на весь час Session**, а не на turn. Повторна idle теоретично може потрапити в наступний turn: strict anchoring її карантинить, але стан не має на це покладатися. Памʼять O(кількість викликів), як у SDK runner.
- **Crash/restart між side-effecting записом і його поданням** не покривається ні in-memory станом, ні `events.list`: list доводить лише факт подання result, а не те, відбувся запис чи ні.

**Правило допуску:** жоден side-effecting custom tool не додається, доки його executor не:
- отримує `custom_tool_use_id` як idempotency key, який або enforce-ить цільова система, або фіксує durable intent record до запису;
- не верифікується так само, як #31 верифікує MCP-записи.

`trello_work_history` — read-only, тому під це правило не підпадає.

## 8. Модель provenance

Provenance рахує **унікальні `custom_tool_use_id`, що досягли SUBMITTED/RESOLVED**, кожен з рівно одним кешованим результатом — тими байтами, які бачила модель. Не подання, не idle-події, не виконання.

- Один id, повторений транспортом, — це **одне** авторитетне джерело.
- Два різні id — два виклики. Зберегти нинішнє консервативне правило: ambiguous, навіть якщо input/output ідентичні. Семантичної дедуплікації не додавати.
- `workHistoryResults: string[]` замінити на per-id результати з lifecycle-таблиці, відфільтровані до id поточного turn.

## 9. Ширший ризик

Це один **клас** помилки («idle як одноразова подія»), а не крихкість усього runtime-шару.

- **Specialist correlation (#32).** У `SpecialistTurnProvenance.onThreadIdle` (`turnCorrelation.ts:200-204`) прапорець `incomplete` **липкий**. Thread, що один раз став idle з `requires_action`, а потім завершився `end_turn`, лишається «incomplete». Це та сама хибна семантика. Зараз не спрацьовує; спрацює з першим майбутнім specialist із tools (#34/#39).
- **Mutation verification (#31).** `TrelloMutationLedger.recordToolUse` (`trelloMutationLedger.ts:344-348`) при повторному id `agent.mcp_tool_use` перезаписує запис і втрачає вже отриманий result. Доказів same-id replay в одному stream зараз немає, але проблема стане реальною, щойно зʼявиться reconnect/reconcile. Напрям відмови безпечний: хибна «unverified» помилка.
- **Tool confirmations.** Клієнт їх зараз не розвʼязує, тому не зачеплено. Майбутня підтримка має використати той самий lifecycle.
- **Не зачеплено:** anchoring, late events, verification nudges, multi-turn continuity, Project Health relay.
- **Частота.** Djonik завантажує Skills через built-in `read`, тож «Skill read паралельно з будь-яким custom tool» — **типовий** шлях, а не рідкісний edge case.

## 10. Мінімальна архітектурна корекція (без коду)

1. **Новий модуль** `src/customToolResolution.ts`: Session-scoped таблиця розвʼязання custom tools з lifecycle і кешем результатів із §6.
2. **`djonikClient.ts`, `runTurn`:**
   - `agent.custom_tool_use` → OBSERVED;
   - idle `requires_action` → діяти лише на id без стану;
   - обробляти echo `user.custom_tool_result` → RESOLVED;
   - throw executor-а → `is_error` result;
   - скидати `reply = ""` лише при реальному новому виконанні.
3. **`djonikClient.ts`, per-turn стан:** замінити `workHistoryResults` / `workHistoryHadUnusableResult` на per-id verdict (§8). Семантику `workHistoryVerdict` в іншому не змінювати.
4. **Hardening у тій самій зміні:**
   - `turnCorrelation.ts` `onThreadIdle` → останній стан перемагає (last-wins), а не липкий;
   - `trelloMutationLedger.ts` `recordToolUse` → ігнорувати повторний id.
5. **Правило в `docs/01` / `AGENTS.md`:** custom tools допускаються лише як ідемпотентні або з idempotency key.

Використовувати SDK `SessionToolRunner` безпосередньо не рекомендовано: він веде власний stream і не знає про turn anchoring чи composition reply. **Переймати його семантику, а не компонент.**

## 11. Тести, обовʼязкові перед наступним live-запуском

Усі тести офлайн, на наявному fake stream у `turnCompletion.test.ts`.

1. **Точне відтворення docs/29:** use → idle(A) → running → idle(A) з *іншим idle id* → echo → running → message → end_turn. Очікування: executor викликано 1 раз, 1 send, relay composed із separator, mode `with_commentary`. **Має падати на поточному HEAD.**
2. Те саме, але друга idle приходить *до* settle executor-а (deferred promise). Очікування: 1 виконання, 1 send.
3. Повторна idle після echo (RESOLVED). Очікування: видима помилка, без re-execute і resend.
4. Перший send кидає transient error. Очікування: повтор кешованого result, executor як і раніше 1 раз, relay verified.
5. Перший send отримує постійну 4xx. Очікування: видима помилка, без циклу повторів.
6. Executor кидає виняток. Очікування: надіслано один `is_error` result, relay skipped, без зависання.
7. Два різні id з однаковим input. Очікування: ambiguous, relay skipped (поведінка без змін).
8. Часткове розвʼязання: idle [A,B] → обидва розвʼязано → повторна idle [B] до її echo. Очікування: no-op для B, кожен id виконано рівно 1 раз.
9. Повторна idle через межу nudge rerun і в наступному turn при strict anchoring. Очікування: карантин, без re-execute.
10. Specialist thread: idle з requires_action, потім end_turn. Очікування: не позначається як incomplete.
11. Replay `agent.mcp_tool_use` з тим самим id після його result. Очікування: outcome у ledger не змінюється.
12. Наявні сюїти #32/#36 лишаються зеленими; у кожному custom-tool тесті є assertion «одне виконання на id».

## 12. Чи потрібне відтворення на рівні провайдера

**НІ — не до початку кодування.** Безкоштовний event list уже довів послідовність. Корекція має витримувати повторну емісію незалежно від тригера і не покладається на серверну обробку дубльованого result.

**Опційне підтвердження після виправлення** (незалежне від продуктової логіки Djonik):
- одна тимчасова Session на тривіальному агенті з одним no-op custom tool;
- prompt, що змушує паралельний built-in `read` + custom виклик;
- записати idle id і після розвʼязання зробити один навмисний дубльований send.

Орієнтовна вартість — один короткий Haiku turn, ~$0.01. Потрібна окрема авторизація Product Owner. Також дає чистий звіт для Anthropic про відсутні гарантії в документації і наївний приклад.

## 13. Рішення

**B. REFACTOR CUSTOM-TOOL CONTINUATION ABSTRACTION**

Шар Session stream / anchoring / FIFO — коректний. Простого Set недостатньо: потрібні per-id lifecycle, розвʼязання через echo, кеш результатів, обробка відмов executor-а, per-id provenance і правило допуску side-effecting tools.

Наступні дії:

1. Product Owner приймає цей аудит.
2. Спершу написати офлайн-тести з §11. Тест 1 має падати на поточному HEAD.
3. Реалізувати корекцію з §10 (таблиця розвʼязання, переробка `runTurn`, per-id provenance, hardening thread idle і ledger). Жодних інших змін #36.
4. Лише після review і прийняття — авторизувати одну нову ізольовану #36-діагностику (опційно разом із провайдерським відтворенням із §12).

## 14. Перевірки

- Команди: `events.list` × 2 (read-only, content-free). Вартість $0.00.
- Змінено файли: лише цей звіт.
