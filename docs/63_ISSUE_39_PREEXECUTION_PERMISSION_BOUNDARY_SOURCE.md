# #39 — Етап 3A: pre-execution межа дозволів і кандидат r27 (source)

Дата: 2026-09-25. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 64).

**Статус:** звіт про source/offline-реалізацію. **Не** приймання #39 і **не** deployment evidence. Усе uncommitted і чекає review Product Lead. Remote-операцій не було: жодного Agent/Skill/Session, платного inference, Telegram, SSH, мутацій Trello, Memory чи Calendar. Production і далі r26 / Agent v26, Working Rhythm неактивний, serving boundary — `post_hoc_detection_only`.

## 1. Стартовий HEAD

- `main` = `4e2ec69aa434fd1e27a334f48846bb2c7860b4c0` (`feat: wire working rhythm runtime`). До змін `git status --short` був порожній.
- `docs/02`, рядок 64: єдиний NOW — #39; рядок 65: #35 іде після #39.
- GitHub #39: OPEN. Єдиний коментар — промоція 2026-09-24.
- Stage 1 (`5e592e9`) і Stage 2 (`4e2ec69`) закомічені. `SERVING_RELEASE = RELEASE_R26`. `pm-rhythm` є лише в `.claude/skills/pm-rhythm/`. `DJONIK_WORKING_RHYTHM` у юніті нема.

## 2. Що виміряно: Anthropic docs і SDK 0.125.0

Джерела: встановлений `@anthropic-ai/sdk` 0.125.0 (`resources/beta/agents/agents.d.ts`, `resources/beta/sessions/events.d.ts`, `src/lib/tools/SessionToolRunner.ts`) і поточні docs [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies) та [Multiagent orchestration → Tool permissions and custom tools](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration), прочитані 2026-09-25.

| Питання | Виміряно |
|---|---|
| Конфігурація built-in | `agent_toolset_20260401.default_config.permission_policy` і `configs[].{name, enabled, permission_policy}`; політика — `{type: "always_allow" \| "always_ask" \| "auto"}`. За замовчуванням `always_allow`. |
| Конфігурація MCP | `mcp_toolset.default_config` / `configs[]`, та сама форма. **За замовчуванням MCP — `always_ask`**; r26 явно ставить `always_allow`. |
| Коли діє | «Running sessions keep the toolset configuration they were created with. Updates apply to sessions created afterward.» |
| Позначка на події | `agent.tool_use` / `agent.mcp_tool_use` мають `evaluated_permission: "allow" \| "ask" \| "deny"` і `evaluation: {type: "always_allow" \| "always_ask" \| "auto", …}`. Без `evaluation` — або відключений інструмент (`deny`), або давня подія (`ask` читати як `always_ask`). |
| Пауза | `session.status_idle{stop_reason: {type: "requires_action", event_ids: string[]}}`. «The session waits indefinitely for a response.» «Resolving fewer than all re-emits `session.status_idle` with the remainder.» |
| Відповідь | `user.tool_confirmation{tool_use_id, result: "allow" \| "deny", deny_message?}`; `deny_message` дозволено лише для `deny`. Кілька підтверджень можна надіслати одним запитом `events`. |
| Ідентичність | `tool_use_id` = id події `agent.tool_use` / `agent.mcp_tool_use`, тобто той самий id, що в `event_ids`. |
| Після allow / deny | allow → інструмент виконується; deny → не виконується, агент отримує tool result про відмову разом із `deny_message`. |
| Echo / підтвердження прийняття | `BetaManagedAgentsUserToolConfirmationEvent` (з `id`, `processed_at`) входить у `BetaManagedAgentsStreamSessionEvents`. Власний `SessionToolRunner` SDK бере вердикти саме з цих подій стріму. **Echo `user.tool_confirmation` на стрімі — авторитетне підтвердження.** |
| Помилки відправки | Підтвердження для події, чий `evaluated_permission` ≠ `ask` (зокрема server-deny під `auto`), → **400**. Семантики таймауту чи повтору в docs нема; `SessionToolRunner` на транзитних помилках повторює в межах вікна. |
| Субагенти | Запит із треду субагента перепощується на primary stream із `session_thread_id`; у підтвердженні його треба повернути. Під `auto` server-deny не перепощується. |
| `auto` | Сервер може сам дозволити, відмовити або попросити підтвердження; server-deny клієнт не може перевизначити. Тому `auto` **не** є детермінованою межею. |
| Custom tools | Політиками дозволів не керуються. `agent.custom_tool_use` не має `evaluated_permission`. |
| Snapshot | Agent version і Session snapshot несуть той самий масив `tools` з `default_config` / `configs[].permission_policy`. Для r26 це виміряно (docs/53). Для snapshot з `always_ask` форма **виведена**, а не виміряна: її перевірить read-back у Stage 3B. |

**Розбіжність із припущеннями репо не знайдено.** Рішення Stage 2 (нова версія Agent з `always_ask` плюс детермінована клієнтська політика) відповідає протоколу провайдера.

## 3. Протокол, який використано

1. На `agent.tool_use` / `agent.mcp_tool_use` з `evaluated_permission === "ask"` (primary stream, після anchor #32) клієнт **одразу приймає рішення** за повноваженням поточного ходу. Рішення незмінне.
2. На `requires_action` клієнт ділить `event_ids` на відомі confirmation-id та інші id (§11).
3. Одним `events.send` надсилаються `user.tool_confirmation{tool_use_id, result, deny_message?, session_thread_id?}` для всіх id у стані `DECIDED`.
4. `user.tool_confirmation` на стрімі (також до anchor, як session-level факт) переводить id у стан `RESOLVED`. Якщо в echo інший результат, стан стає `CONTRADICTED` і хід видимо падає.
5. Далі звичайний потік: після allow — `agent.mcp_tool_result` / `agent.tool_result`, #31 і `end_turn` (#32); після deny — tool result про відмову, модель продовжує.

## 4. Життєвий цикл підтвердження (`src/toolConfirmation.ts`)

Він прив'язаний до Session і не скидається між ходами (як #40):

```
DECIDED ──send ok──▶ SUBMITTED ──echo=рішення──▶ RESOLVED
   │                     └──echo≠рішення──▶ CONTRADICTED (throw)
   ├──send 4xx (не 408/409/429)──▶ SEND_REJECTED (throw, без повтору)
   └──send невідомо (мережа, таймаут, 5xx, 408/409/429)──▶ SEND_UNKNOWN (throw, без повтору; пізніший echo → RESOLVED)
```

- Повторний `requires_action` для `SUBMITTED` нічого не робить і нічого не надсилає.
- Для `RESOLVED`, `CONTRADICTED`, `SEND_REJECTED` чи `SEND_UNKNOWN` — fail closed, повторної відправки нема.
- Невідомий id → throw, нічого не надсилається.
- **Після неоднозначної відправки нічого не надсилається повторно.** Навіть пізніший `requires_action` з тим самим id не вважається дозволом, бо idle може бути застарілим. Якщо рішення було allow, користувач бачить «зміна могла бути або не бути виконана — не перевірено».
- Бази даних і персистентності нема: гарантія діє в межах процесу. Session continuity і так process-scoped (docs/51).

## 5. Модель повноважень ходу (`src/turnAuthority.ts`)

- `TurnOrigin` тепер визначено **один раз** тут; `rhythmRunner.ts` лише ре-експортує його, тож дублікату Stage 1 нема.
- `mutationAuthorityFor`:
  - `user_message` / `button_callback` → `human`;
  - `rhythm_ritual`, `rhythm_exception` і будь-яке невідоме значення → `autonomous_read_only` (fail closed).
- Повноваження задає довірений шлях виклику, **не текст**:
  - `send` / `sendOrdered` — шлях Daniel (Telegram-текст або кнопка, перетворена на його звичайне повідомлення) → `user_message`;
  - `sendTraced(parts, origin)` — `origin` **обов'язковий аргумент**. Runtime передає `request.origin` планувальника; тести й діагностики обирають його явно.
- Роутера намірів нема, фраз і вмісту Telegram код не розбирає.

## 6. Human ALLOW

Allow дається лише коли одночасно виконано все:
- хід Daniel;
- інструмент з рецензованого набору `REVIEWED_CONFIRMATION_TOOLS` = built-in `write` / `edit` + Trello `trelloWriteCard`;
- primary thread (без `session_thread_id`);
- `evaluation` = `always_ask` або відсутній.

**Allow — це дозвіл на спробу, а не перевірка.** Тест «ALLOWED but never verified» це доводить: allow + результат запису без читання картки → nudge #31 → `DjonikUnverifiedMutationError`.

## 7. Autonomous DENY

- У ході `rhythm_*` **кожен** запит на підтвердження отримує deny з фіксованим `deny_message`, ще до виконання. Модель не судить, input не розбирається, винятків для «дрібних» записів нема.
- Відмовлений запит записується в `DjonikTracedTurn.confirmations` і ставить `autonomousMutationAttempt: true`; те саме в `DjonikTracedTurnError`.
- Runner (Stage 1) трактує це як `blocked`: надсилається фіксоване `AUTONOMOUS_WRITE_NOTICE`, текст моделі ніколи. Ритуал того дня більше не перезапускається, тож циклу алертів нема (тест).
- Autonomous-ходи й далі можуть читати Memory (`read`/`glob`/`grep`), Trello (`always_allow` reads) і `trello_work_history`.

## 8. Взаємодія з #31

- Дозволений (allow) виклик потрапляє в `TrelloMutationLedger` так само, як раніше `always_allow`: кореляція target/result, verify-after-write, due-safeguard, nudge.
- **Відмовлений (deny) виклик у ledger не потрапляє.** Він не виконувався, тож не може бути «неперевіреним записом», і хибного `DjonikUnverifiedMutationError` для autonomous-ходу нема (тест).

## 9. Взаємодія з #32

- Лише `end_turn` завершує хід.
- Текст перед паузою на підтвердження тимчасовий (`reply = ""` після відправки, як у #40).
- Непідтримуваний `requires_action` → `DjonikTurnIncompleteError`.
- Echo обробляється до anchor як session-level факт. Gated tool-use з чужого (quarantined) ходу не спостерігається, тож його id пізніше невідомий → fail closed.

## 10. Взаємодія з #40

`CustomToolResolution` не змінено. Лише custom-tool паузи обробляються рівно як раніше. Id підтверджень і custom-tool id мають окремі реєстри: confirmation-id ніколи не йде в `user.custom_tool_result`, custom-id — в `user.tool_confirmation` (тест).

## 11. Правила змішаного `requires_action`

Якщо idle називає хоча б один **відомий** confirmation-id:
- список має бути коректним (непорожні рядки, без дублікатів), а кожен інший id — **спостереженим** custom-tool id цієї Session. Інакше хід `incomplete` і нічого не надсилається й не виконується;
- спершу надсилаються підтвердження, потім custom-tool lifecycle #40 для решти;
- mixed-стан допускає контракт провайдера («blocking user-input events (tool confirmation, custom tool result, etc.)»). Кожен lifecycle має власний ключ id, тому його безпечно розв'язувати.

Якщо відомих confirmation-id нема — поведінка до Stage 3A без змін.

Id, що належить **не** `ask`-події (наприклад `always_allow` read), ніколи не підтверджується.

## 12. Trace і телеметрія

- Нова trace-подія: `{type: "tool_confirmation_sent", toolName, decision, reason}`.
- `DjonikTracedTurn` / `DjonikTracedTurnError` отримали `confirmations: {kind, name, decision, reason}[]` і `autonomousMutationAttempt`.
- Скрізь без вмісту: жодного input, Memory, тексту повідомлень чи payload Trello (тест `doesNotMatch`).
- `DjonikTurnTelemetry` **не змінено**.
- Serving tuple додає `always_ask=…` **лише** для релізу, що його декларує; рядок r26 байт-у-байт той самий.

## 13. Зміни схеми релізу

- `DjonikRelease.confirmationRequired?: {builtIn: BuiltInToolName[], mcp: Record<server, string[]>}` — enabled-інструменти з політикою рівно `always_ask`. Якщо поля нема, gated-інструментів нема (семантика r25/r26).
- **Атестація.** `ObservedToolset.alwaysAsk` — нове поле. Для built-in і кожного MCP toolset `needsConfirmation` **і** `alwaysAsk` мають дорівнювати очікуваному набору, порівняння без урахування порядку. Тому:
  - `auto` — drift;
  - зайвий gate — drift;
  - відсутній gate — drift;
  - default MCP, що відрізняється від задекларованого, — drift.
- `ReleaseMcpToolset.defaultPolicy?: "always_allow" | "always_ask"` — `default_config.permission_policy`, тобто політика, яку успадковує кожен інструмент, **не** названий у `overrides`. Без поля діє `always_allow` (семантика r25/r26).
  - Атестація порівнює `ObservedMcpToolset.defaultPolicy` з очікуваним.
  - Для enabled-toolset з default `always_ask` очікуваний `needsConfirmation` включає `*` (усі неназвані інструменти).
- **Update body.** `buildAgentUpdateBody` ставить `always_ask` у власний config кожного інструмента з `confirmationRequired`, а default toolset бере з `defaultPolicy`. Решта лишається `always_allow`.
- `confirmationPolicyProblems` відхиляє gate на вимкнений built-in або на MCP-інструмент без явного `enabled: true` override: такий gate тихо лишився б без дії.

## 14. Сумісність з r26

- Тіла update для r25/r26 не містять `always_ask` / `auto` (тест).
- Тіла update для r25/r26 **байт-у-байт ідентичні** тим, що генерувалися на чистому `4e2ec69`. SHA-256 закріплено в тесті:
  - r26 з v25 = `8883b7e1…5ef2` (тіло, яким створено v26);
  - r25 з v26 = `72d60982…7688`.
- Атестація r26 (Agent version і Session) проходить.
- Snapshot r26 не проходить як r27, і навпаки (тест із точними mismatch).
- Єдина зміна для наявного тесту: текст mismatch «needs confirmation» тепер у форматі `[observed] != [expected]`.

## 15. Кандидат r27 (`RELEASE_R27_CANDIDATE`)

- Тип `DjonikReleaseCandidate`, а **не** `DjonikRelease`: нема `id`, `agent.version: null`, `fromVersion: 26`. У `RELEASES` його нема.
- Дельта від r26 (тест перевіряє, що інших змін нема):
  1. `pm-rhythm` із `skillId: null`, `pin: {kind: "unresolved"}`;
  2. `confirmationRequired = {builtIn: [write, edit], mcp: {trello: [trelloWriteCard]}}`;
  3. Trello toolset **fail closed для нерецензованих інструментів**: `defaultPolicy: "always_ask"` плюс 9 рецензованих reads (`REVIEWED_TRELLO_READ_TOOLS`) явно `enabled: true`, `always_allow`. Ефективна поверхня читання й запису та сама, що в r26.
- Решта як у r26: той самий Agent, Sonnet 5 medium/standard, prompt SHA, specialist v4, прийняті Skills з pin, `trello_work_history`, MCP-сервери, вимкнений Calendar, вимкнені 5 записів Trello, Memory / environment / vault.

**Фінальна матриця дозволів Trello в r27:**

| Інструмент | enabled | permission_policy | Human-хід | Autonomous-хід |
|---|---|---|---|---|
| **default** (кожен неназваний, зокрема майбутній) | true | `always_ask` | DENY (`unreviewed_tool`) | DENY |
| `trelloReadBoard`, `trelloReadCard`, `trelloReadChecklist`, `trelloReadInbox`, `trelloReadList`, `trelloReadMember`, `trelloReadPlanner`, `trelloReadWorkspace`, `trelloSearch` | true (явно) | `always_allow` | виконується | виконується |
| `trelloWriteCard` | true | `always_ask` | ALLOW → #31 перевірка | DENY (`autonomous_read_only`) |
| `trelloWriteBoard`, `trelloWriteChecklist`, `trelloWriteInbox`, `trelloWriteList`, `trelloWritePlanner` | false | (`always_allow`, недосяжно) | вимкнено провайдером | вимкнено провайдером |

**Звідки перелік reads.** Інвентар docs/04 §17: 15 інструментів офіційного Trello MCP — ці 9 reads і 6 `trelloWrite*`. У production вони ввімкнені з #19 (docs/16 §2). r26 вмикає reads неявно через default `always_allow`.

**Майбутній інструмент** успадковує `always_ask`. Клієнт автоматично дозволяє лише `REVIEWED_CONFIRMATION_TOOLS`, тож такий виклик отримує deny навіть у ході Daniel. Wildcard-allow логіки нема.
- `buildCandidateUpdateBody(candidate, {skills})` і `resolveReleaseCandidate(candidate, {skills, agentVersion})` кидають `UnresolvedReleaseCandidateError`, поки не передано справжні `skill_…` / `skver_…` і версію Agent > 26. Placeholder-ідентифікатори з'являються лише в тестах і позначені `TESTONLY`.
- **Змін prompt не потрібно.** Відмова приходить моделі як tool result із `deny_message`; наявний `READ_ONLY_RULES` у промпті ритму лишається.

## 16. Чому `SERVING_RELEASE` лишається r26

Agent v27 не існує, а `pm-rhythm` не синхронізовано. Незмінний r27 чесно визначити не можна: його pin і Session-spelling (`sessionVersion`, docs/53 §4) з'являться лише після sync і першої Session. Тест `SERVING_RELEASE === RELEASE_R26`, `RELEASES = {r25, r26}`.

## 17. Чому serving boundary лишається post-hoc

`SERVING_READ_ONLY_BOUNDARY = readOnlyBoundaryFor(SERVING_RELEASE)`, тобто вона **виводиться** з релізу, а не декларується вручну. `pre_execution` можливий, лише коли виконано все:
- реліз gate-ить рівно рецензований набір (з урахуванням того, що ввімкнено);
- інші enabled built-in — лише `read` / `glob` / `grep` (тож `bash` блокує);
- MCP поза набором (Calendar) повністю вимкнено;
- рецензований MCP-сервер (Trello) з enabled default має `defaultPolicy: "always_ask"`, тож невідомі інструменти не виконуються без підтвердження;
- кожен рецензований read названо явно `enabled: true` і не gated;
- кожен інший явно enabled інструмент — рецензована мутація, що є в `confirmationRequired`.

Будь-яке відхилення дає `post_hoc_detection_only`:
- default Trello повернуто в `always_allow` або поле прибрано;
- прибрано явний read;
- увімкнено невідомий інструмент;
- read поставлено під gate;
- Calendar увімкнено;
- увімкнено інший `trelloWrite*`;
- увімкнено `bash`.

На кожен випадок є тест.

Далі startup-атестація доводить це на Agent version і Session snapshot. Три рівні:

1. **Можливість source / клієнта є:** deny до виконання реалізовано й покрито тестами.
2. **Кандидат / гіпотетичний r27 задовольняє контракт:** `readOnlyBoundaryFor(candidate) = pre_execution`. Із таким релізом наявний runner проходить gate (`running`, хід виконано) — тест.
3. **Serving r26 — ні:** `post_hoc_detection_only`, `startWorkingRhythm` → `blocked` (тест). Тест Stage 1 «жоден source не декларує `readOnlyBoundary: "pre_execution"`» лишився зеленим. Тест на `telegramCli` тепер перевіряє саме виведення з `SERVING_RELEASE`.

## 18. Змінені файли

**Нові:**
- `src/turnAuthority.ts`
- `src/toolConfirmation.ts`
- `src/toolConfirmation.test.ts`
- `src/toolConfirmationClient.test.ts`
- `src/releaseR27Candidate.test.ts`
- цей документ

**Змінені:**
- `src/djonikClient.ts` — gating, confirmation lifecycle, `sendTraced(parts, origin)`, трасування;
- `src/release.ts` — `confirmationRequired`, `ReleaseMcpToolset.defaultPolicy`, `REVIEWED_TRELLO_READ_TOOLS`, `confirmationPolicyProblems`, кандидат r27 і його розв'язання;
- `src/releasePlan.ts` — політики в update body, `buildCandidateUpdateBody`;
- `src/releaseAttestation.ts` — `alwaysAsk`, `defaultPolicy` MCP, точне порівняння, поле tuple;
- `src/rhythmRunner.ts` — `TurnOrigin` з одного джерела, `autonomousMutationAttempt` → `blocked`, коментарі;
- `src/rhythmRuntime.ts` — `readOnlyBoundaryFor` (з fail-closed умовою Trello), виведений `SERVING_READ_ONLY_BOUNDARY`, передача origin.

**Тести:** `releaseAttestation.test.ts` (текст mismatch), `releaseFixtures.test-helpers.ts` (політики у fixtures), `rhythmRunner.test.ts` (allowlist імпортів, виведений boundary, 2 нові кейси), `rhythmRuntime.test.ts` (origin, 1 новий кейс), `turnTrace.test.ts` (origin, нові поля).

**Не змінено:**
- `managed-agents/*`, `.claude/skills/*`;
- `DJONIK_MEMORY_INSTRUCTIONS`, `customToolResolution.ts`, `trelloMutationLedger.ts`, `telegramCli.ts`;
- `deploy/*`, `docs/02`;
- UX ритму, пороги, кнопки, формат `/rhythm.md`.

## 19. Тести (Node v24.16.0, Windows)

| Набір | Результат |
|---|---|
| Нові: `toolConfirmation` + `toolConfirmationClient` | **38/38** |
| Новий: `releaseR27Candidate` | **18/18** |
| `djonikClient` | **142/142** |
| `customToolResolution` + `turnCompletion` + `trelloMutationLedger` | **137/137** |
| `commitmentContract` | **36/36** |
| `rhythmRunner` + `rhythmRuntime` + `rhythmTelegram` | **64/64** |
| `telegramAdapter` + `telegramDispatch` + `messageGrouping` | **89/89** |
| `trelloWorkHistory` | **14/14** |
| `release` + `servingRelease` + `releaseAttestation` + `servingLifecycle` | **68/68** |
| `turnTrace` | **7/7** |
| Повний `npm test` | **926/928** |
| `npm run typecheck` / `npm run build` / `git diff --check` | pass / pass / pass |

Два збої ті самі, що в docs/62, і **відтворюються на чистому `4e2ec69`** (перевірено через `git stash -u`, потім дерево відновлено):
- `processExit.test.ts` «a real process that fetched over keep-alive exits…»;
- `deployConfig.test.ts` «deploy script survives replacing itself…».

Обидва залежать від середовища Windows.

**Покрито провайдероподібними послідовностями:**
- human Trello write: allow → виконання → #31 → read → `end_turn` → перевірена відповідь;
- allow без перевірки → #31 fail;
- human Memory write/edit;
- тимчасовий текст перед паузою;
- rhythm → `trelloWriteCard` deny (без ledger, attempt записано, трасування без вмісту);
- rhythm → `write` / `edit` deny;
- read-only rhythm (reads, custom tool, `end_turn`);
- невдалий autonomous-хід із deny;
- повторний idle до і після echo;
- два id в одному запиті;
- невідомий id, змішаний із відомим;
- некоректні списки;
- невідомий id окремо (поведінка до Stage 3A);
- нерецензований інструмент;
- субагент;
- `auto`;
- id події не-`ask`;
- постійна відмова та неоднозначна відправка (без дубліката);
- суперечливий echo;
- застарілий запит між ходами (deny незмінний);
- змішаний confirmation + custom у human- і autonomous-ходах;
- непоміченний custom-id;
- невідомий майбутній Trello-інструмент (успадкований `always_ask`) → deny і в human-, і в autonomous-ході.

**Покрито для політики Trello в r27** (`releaseR27Candidate.test.ts`):
- default `always_ask`;
- кожен рецензований read явно `always_allow`;
- `trelloWriteCard` під `always_ask`;
- 5 записів вимкнено;
- невідомий інструмент успадковує `ask` (`*`);
- drift, які ламає атестація: прибраний read, default `always_allow`, read під gate;
- втрата `pre_execution` при поверненні default в allow, прибраному read, невідомому enabled-інструменті;
- r26: тіло байт-у-байт, атестація зелена.

## 20. Обмеження

1. **Форма snapshot з `always_ask`** (Agent version і Session) виведена з SDK-типів і форми r26, а не виміряна. Перевірити її має read-back Stage 3B.
2. **Реальна поведінка Session не виміряна:** echo `user.tool_confirmation`, tool result про відмову, повторні idle. Потрібна одна bounded live-перевірка (docs/04 §27).
3. **Після неоднозначної відправки підтвердження** Session може лишитися в `requires_action`: провайдер чекає безстроково, а клієнт свідомо не повторює. Наступні ходи будуть `incomplete`, доки перезапуск процесу не створить нову Session. Це рідкісний, зате безпечний випадок.
4. **Новий read-інструмент Trello MCP** (якщо сервер колись його додасть) успадкує `always_ask` і отримає deny, доки його не рецензують і не додадуть до `REVIEWED_TRELLO_READ_TOOLS` новим релізом. Це свідома fail-closed ціна, а не прогалина безпеки.

   Загрозу «майбутній Trello-інструмент виконається без авторизації» (у попередній версії звіту — пункт 4) для кандидата r27 **закрито**: default `always_ask`, явні reads, атестація default-політики, умова `pre_execution`; матриця — §15. r25/r26 свідомо не змінено: serving r26 і далі `post_hoc_detection_only`.
5. **Human-ходи отримують confirmation-roundtrip** на кожен `write` / `edit` / `trelloWriteCard`. Потрібні live-регресії #31 і #34.

## 21. Точний gate Stage 3B

Кожен пункт — окрема авторизація Product Owner:

1. **Sync `pm-rhythm`:** створити remote Skill і версію з `.claude/skills/pm-rhythm/`, записати справжні `skill_…` і `skver_…`.
2. **Згенерувати тіло:** `buildCandidateUpdateBody(RELEASE_R27_CANDIDATE, {skills: {"pm-rhythm": {skillId, version}}})`. Review тіла.
3. **Оновити Agent** з preconditions `version: 26` → **v27**. Read-back через `normalizeAgentConfig`, очікування:
   - `alwaysAsk` = `[edit, write]` і `trello/[trelloWriteCard]`;
   - Trello `defaultPolicy = always_ask`;
   - 9 reads явно `always_allow`;
   - 5 записів вимкнено.
4. **Визначити `RELEASE_R27`** через `resolveReleaseCandidate(…, {skills, agentVersion: 27})`, додати в `RELEASES`, виміряти `sessionVersion` pm-rhythm на першій Session (як docs/53 §4). `npm run release:check r27`.
5. **Bounded live-перевірка** (docs/04 §27):
   - human Trello write і Memory write через allow (регресії #31 і #34);
   - один rhythm-хід, що просить запис → deny до виконання;
   - вимірювання echo і tool result про відмову.
6. **Cutover:** `SERVING_RELEASE = RELEASE_R27` → `SERVING_READ_ONLY_BOUNDARY` автоматично стає `pre_execution`. Deploy, install юніта (`StateDirectory`) + `daemon-reload`, restart, attestation.
7. **Лише після цього:** `/rhythm.md` (або свідомі дефолти), `DJONIK_WORKING_RHYTHM=on`, одна bounded перевірка ритуалу й кнопки, потім #35.

## Стан робочого дерева

```text
 M src/djonikClient.ts
 M src/release.ts
 M src/releaseAttestation.test.ts
 M src/releaseAttestation.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releasePlan.ts
 M src/rhythmRunner.test.ts
 M src/rhythmRunner.ts
 M src/rhythmRuntime.test.ts
 M src/rhythmRuntime.ts
 M src/turnTrace.test.ts
?? docs/63_ISSUE_39_PREEXECUTION_PERMISSION_BOUNDARY_SOURCE.md
?? src/releaseR27Candidate.test.ts
?? src/toolConfirmation.test.ts
?? src/toolConfirmation.ts
?? src/toolConfirmationClient.test.ts
?? src/turnAuthority.ts
```

Не зроблено (за інструкцією): commit, push, deploy, sync Skill, оновлення Agent, v27 / r27 з вигаданими id, зміна `SERVING_RELEASE`, SSH / systemd, `/rhythm.md`, `DJONIK_WORKING_RHYTHM=on`, Session, платний inference, Telegram, мутації Trello / Calendar, закриття #39, промоція #35, зміна NOW.
