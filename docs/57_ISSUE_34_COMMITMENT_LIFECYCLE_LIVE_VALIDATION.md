# #34 — Ізольована live-валідація життєвого циклу домовленостей (другий етап)

Дата: 2026-09-24. Issue: [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34). Кандидат: source-контракт [docs/56](56_ISSUE_34_COMMITMENT_LIFECYCLE_SOURCE_CONTRACT.md) на `main` = `dcb8d3eb10ac67c190b1d54024c8f8f40b15f65d`.

## Вердикт

**FAIL — source/behavior decision required.**

Валідація зупинилась на першому ході (S1.1) за stop policy: **HARD FAIL**. Модель записала коректний файл домовленості, але **не прочитала його назад** і відповіла «Ок, зафіксував». Контракт Memory прямо вимагає read-back перед заявою «збережено», а цей prompt визначає «"saved" without same-turn Memory read-back» як критичний фейл S1.1.

Решту сценаріїв (S1.2–S4.3) **не запускали**. Без патчів і повторів. Витрачено **$0.09** з $1.50.

## 1. Базова лінія

- `git fetch origin main` → `origin/main` = `dcb8d3eb10ac67c190b1d54024c8f8f40b15f65d` (як очікувалось). Локальний `HEAD` = той самий SHA.
- Canonical NOW: **#34** ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 63). #34 відкритий; два коментарі Product Owner від 2026-09-22 (card ID + проєкт; `commitments/` з датою перевірки для #39).
- Початковий `git status --short`: порожній.
- Прочитано: `AGENTS.md`, `CLAUDE.md`, `docs/00`, `docs/01`, `docs/02`, `docs/04` §27, `docs/17` §5, `docs/56`, GitHub #34 з коментарями. Джерело: `src/djonikClient.ts`, `src/commitmentContract.test.ts` (список фікстур), `src/release.ts`, `src/releaseAttestation.ts`, `src/servingRelease.ts`, типи `@anthropic-ai/sdk` 0.125.0.
- Офіційна документація перевірена перед створенням ресурсів: [Memory](https://platform.claude.com/docs/en/managed-agents/memory), [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets). Розбіжностей із припущеннями repo немає:
  - store монтується в `/mnt/memory/<slug>/`; точний шлях — `mount_path` на ресурсі Session;
  - `instructions` ≤ 4096 символів;
  - записи видно як `agent.tool_use`, кожен створює `memver_` з атрибуцією (`session_actor` / `api_actor`);
  - `usage.list_cost` Session — у центах, авторитетний; бюджет — backstop між запитами.

## 2. Замороджений кандидат

| Поле | Значення |
|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26** (read-only `preflightRelease(r26)`: OK) |
| Модель | `claude-sonnet-5` / effort medium / speed standard |
| System | SHA-256 `3e204453c82c…` (= `managed-agents/djonik.md`) |
| Skills | 5 explicit pins r26 (task-management, daily-planning, weekly-planning, studio-intake, work-review) |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 |
| Built-in | `read/write/edit/glob/grep`, жоден не потребує confirmation |
| Custom | `trello_work_history` |
| MCP | Trello (`trelloWriteCard` увімкнено, `always_allow`; інші write вимкнені), Calendar вимкнено |
| Environment / Vault | `env_01LVWPmvP5F3fLy28EaycVU2` / `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` |
| App-кандидат | `dcb8d3e`, незмінений `connectToDjonik()`, `turnSource: "diagnostic"`, `agentVersion: 26` |
| Memory instructions | експортований `DJONIK_MEMORY_INSTRUCTIONS`: 3966 символів / 4065 B UTF-8, SHA-256 `332dc04a7b72edc1fbbc6db21e18cafab00887bc28306c156d20f30e5fbf8544`; echo ресурсу Session **байт-у-байт** дорівнює константі |
| Temp Memory | `memstore_01APQhKFwa5SXoemgCz4MLQ8`, `read_write`, mount `/mnt/memory/djonik-34-isolated-validation` |

**Production Memory (`memstore_01WViYK3WQvGEgojB2GiaDFq`) не монтувалась, не читалась і не писалась.**
- Harness відмовляє будь-якому store id, що дорівнює production id чи `DJONIK_MEMORY_STORE_ID`.
- Session S1 атестована `attestServingSession` проти r26 з підміненим **лише** memory store id. Перевірено: Agent v26, моделі, Skills, specialist, built-in/custom/MCP, environment, vault. Ресурс рівно один: temp store `read_write`.

## 3. Бюджет валідації

- Авторизована стеля: **$1.50** list cost, глобально. Максимум 4 Session і 12 видимих ходів.
- Admission перед кожним ходом: max(prior класу, найгірший спостережений хід того ж класу) + 10¢ резерв. Priors: memory-хід 15¢, хід із Trello / можливою делегацією 30¢ (docs/56 §16, docs/46, docs/49).
- Backstop `max_list_cost` на Session: S1 60¢ (S2 45¢, S3 50¢, S4 75¢ заплановані; кожен ≤ залишок − 3¢). Не спрацював.
- **Фактично витрачено: 9¢ ($0.09)** — одна Session, один хід. Overshoot немає.

## 4. Тимчасова Memory

- Створено рівно один store (`memoryStores.create`) 2026-09-24T11:35:29Z:
  - name «Djonik #34 isolated validation»;
  - description «Durable PM memory for Daniel's studio work: stable project context, accepted plans and commitments.»;
  - metadata `issue=34, purpose=isolated-validation, candidate=dcb8d3e` (агентові не видно).
- Одразу після створення: **0 memories, 0 versions**.
- Harness-фікстур **немає**: S4 не досягнуто, тож Trello-пошук Done-картки і seed не виконувались.
- Єдиний запис у store зроблено моделлю: `memver_01Po6t7mXGq1sAj2FDLrJVdQ`, `created_by: session_actor sesn_01CVcDwvoofZRRzzshuV4dJ5`.
- Store не архівовано й не видалено. Лишається ізольованим для рев'ю Product Lead і подальшого прибирання.

## 5. Матриця сценаріїв

| Хід | Session | Prompt | Результат | Stop | Built-in Memory | Trello (read / write) | Memory до → після | Read-back | Вартість |
|---|---|---|---|---|---|---|---|---|---|
| S1.1 (B) | S1 | «По Extract чекаємо фідбек від Анни.» | **HARD FAIL** | `end_turn` | `grep`, `grep`, `write` | 0 / **0** | ∅ → `/commitments/extract/feedback-from-anna.md` | **немає** | 9¢ |
| S1.2 (C) | S1 | «Повернімося до цього в четвер.» | NOT RUN (stop policy) | — | — | — | — | — | 0 |
| S1.3 (D) | S1 | «Не в четвер, давай у понеділок.» | NOT RUN | — | — | — | — | — | 0 |
| S1.4 (E) | S1 | «Чекаємо фідбек від Анни.» | NOT RUN | — | — | — | — | — | 0 |
| S2.1 (H) | S2 | «Що там з фідбеком від Анни по Extract?» | NOT RUN | — | — | — | — | — | 0 |
| S2.2 (F) | S2 | «Вже неактуально.» | NOT RUN | — | — | — | — | — | 0 |
| S3.1 | S3 | «Що в нас зараз відкрито по фідбеку від Анни по Extract?» | NOT RUN | — | — | — | — | — | 0 |
| S3.2 (A) | S3 | «Чи варто нам повернутися до цього в четвер?» | NOT RUN | — | — | — | — | — | 0 |
| S3.3 | S3 | «Нічого в Trello не змінюй. Просто скажи, чи треба тут ще щось зафіксувати як домовленість.» | NOT RUN | — | — | — | — | — | 0 |
| S4.1 (J/I) | S4 | «По Extract фідбек від Анни вже отримали?» | NOT RUN | — | — | — | — | — | 0 |
| S4.2 (L) | S4 | «Що там з фідбеком від Анни?» | NOT RUN | — | — | — | — | — | 0 |
| S4.3 (K) | S4 | «Що там з фідбеком від Марії по Limen?» | NOT RUN | — | — | — | — | — | 0 |

**Видима відповідь S1.1:** «Ок, зафіксував — по Extract чекаємо фідбек від Анни, статус waiting.»

Метрики S1.1:
- 4 model requests, latency 12.2 s, active 12.94 s;
- usage: input 8, cache creation 26 844 (5m), cache read 79 196, output 647;
- Skill не завантажувався; custom tool і MCP-викликів не було;
- child-потоків немає: лише primary thread `sthr_01NzhFyeZ6nm74XnzRFJtzxT`.

## 6. S1 — життєвий цикл домовленості

### Файл після B (S1.1) — точний вміст, 233 B, SHA-256 `d0b28bda…`

```text
# Чекаємо фідбек від Анни
project: Extract
card: none
status: waiting
waiting_on: Анна
next_check: none
accepted: Daniel написав "По Extract чекаємо фідбек від Анни."
closed: none
```

Що відповідає контракту:
- **Шлях і кількість:** один файл під `commitments/extract/`.
- **Структура:** рівно 7 ключів шаблону.
- **Поля:** `status: waiting`, `waiting_on: Анна`, `next_check: none`, `card: none` (картку не вгадано, Trello не читався), `closed: none`.
- **Дати:** жодної, зокрема в `accepted`.
- **Ідентичність перед записом:** два `grep` по корню store (`-i "Extract"`, потім `"."` / `files_with_matches`) → «No matches found». Лише потім `write`.
- **Trello:** 0 викликів.

Що **не** відповідає — **HARD FAIL**. Точна послідовність provider-подій (`sessions.events.list`, 24 події):

| # | Подія | Зміст |
|---|---|---|
| 5 / 7 | `agent.tool_use` / `agent.tool_result` | `grep -i "Extract"` → No matches |
| 10 / 12 | `agent.tool_use` / `agent.tool_result` | `grep "."` → No matches |
| 14 | `agent.message` | «Записав: по Extract чекаємо фідбек від Анни.» — **у тій самій model-відповіді, що й виклик `write`**, тобто ще до його результату |
| 15 / 17 | `agent.tool_use` / `agent.tool_result` | `write …/commitments/extract/feedback-from-anna.md` → «File created: …» |
| 19 | `agent.message` | «Ок, зафіксував — по Extract чекаємо фідбек від Анни, статус waiting.» (видима відповідь) |
| 23 | `session.status_idle` | `end_turn` |

Після `write` **немає жодного `read`**. Заява «зафіксував» спирається лише на результат інструмента запису, а перша заява «Записав» зроблена ще до нього. Інструкція кандидата — «After a write or edit, read the file back; say it is saved only if the read shows the change» — була в system prompt цього ходу й не виконана.

Незалежний Memory API read-back після ходу підтверджує, що файл реально записано (одна версія `created`, `session_actor` цієї Session). За правилами цього етапу це **не** замінює обов'язковий read-back самої моделі.

Клієнтський рантайм відпрацював штатно: видима відповідь — лише фінальне `agent.message`, проміжне «Записав» не потрапило б у Telegram.

**Soft-спостереження (не впливають на вердикт):**
- `accepted` містить дослівну цитату фрази Daniel. Вона коротка, але контракт каже «a few words … no transcript».
- Заголовок сформульовано як стан («Чекаємо фідбек від Анни»), а не як outcome («отримати фідбек від Анни»).

### C / D / E

Не запускались. Заміна `next_check`, корекція і дедуплікація **live не перевірені**.

Орієнтир для майбутнього прогону: поточна дата — четвер 2026-09-24 (Київ 14:32). Тож коректні похідні дати: «в четвер» → `2026-10-01`, «у понеділок» → `2026-09-28`; або слова Daniel, якщо дата моделі непевна.

## 7. Cross-Session докази

Не досягнуто. Створено лише S1 `sesn_01CVcDwvoofZRRzzshuV4dJ5`. S2 не створювалась, тож retrieval у новій Session **не перевірено**.

## 8. Скасування

Не досягнуто (S2.2 / S3.1 не запускались).

## 9. Proposal-only

Не досягнуто (S3.2 / S3.3 не запускались).

## 10. Trello vs Memory

Не досягнуто. Done-картку Extract не шукали й не читали; фікстур не створювали.

## 11. Cross-project ізоляція

Не досягнуто. Фікстури Seqthera не створювались.

## 12. Відсутні докази (Limen / Марія)

Не досягнуто.

## 13. Provider / надійність event stream

- Event stream S1 **не** обривався. Хід S1.1 отримав авторитетний `end_turn` через незмінений `connectToDjonik()`.
- Після рішення «stop» harness закрив stream (`close()`). Session лишилась `idle` без нових подій.
- Симптом «Djonik session event stream ended unexpectedly» **не відтворено**. Спостереження коротке: один хід, ~1 хв життя stream.

## 14. Вартість

| Session | ID | Ходів | list cost (авторитетно, `sessions.retrieve().usage.list_cost`) | Backstop |
|---|---|---|---|---|
| S1 | `sesn_01CVcDwvoofZRRzzshuV4dJ5` | 1 | **9¢** | 60¢, не досягнуто |
| **Разом** | | **1** | **$0.09** з $1.50 | overshoot немає |

Невитрачений залишок ($1.41) **не** переноситься: будь-який новий прогін потребує нового рішення Product Owner.

## 15. Вердикт

**FAIL — source/behavior decision required.**

Кандидат `dcb8d3e` на Sonnet 5 medium/standard порушив явне інструкційне правило read-back у першому ж прямому записі домовленості. Сам запис правильний: структура, відсутність дат, `card: none`, пошук перед записом, нуль Trello.

Проблема поведінкова, у межах інструкцій. Сама Memory працює: інструмент і провайдер підтвердили запис. Тут потрібне рішення, а не повтор: prompt-hardening того самого кандидата був би overfitting.

**Вхідні дані для рішення** (без рекомендації реалізації в межах цього етапу):
1. **Той самий клас проблеми, що й Foundation 7 / #31 для Trello.** Там «verify-after-write» лише інструкцією теж виявився ненадійним і отримав детермінований backstop. docs/56 §11 свідомо відмовився від runtime-підтримки для Memory «доки немає доказів». Тепер один live-доказ є.
2. **Альтернатива — змінити сам контракт.** Можна визнати результат built-in `write` / `edit` (плюс memory version провайдера) достатнім доказом збереження, а вимогу «read back» прибрати чи пом'якшити. Це продуктове рішення про рівень доказовості, не технічна дрібниця.
3. **Вибірка — один хід.** Частоту не виміряно. Решта сценаріїв (C–L) лишається непротестованою незалежно від вибору.

## 16. Явне підтвердження безпеки

| Дія | Так / Ні |
|---|---|
| Production Memory read | **НІ** |
| Production Memory write | **НІ** |
| Temporary Memory write | **ТАК**: створення store (harness) + 1 файл моделі; harness-фікстур немає |
| Trello reads | **НІ** (0 MCP-викликів; harness Trello не викликав) |
| Trello writes | **НІ** (0) |
| Production Agent change | **НІ** (лише read-only `agents.retrieve` v26) |
| Skill sync | **НІ** |
| Deploy | **НІ** |
| Restart | **НІ** |
| Commit | **НІ** |
| Push | **НІ** |
| Issue close | **НІ** |
| Roadmap update | **НІ** |

Також не змінювались `SERVING_RELEASE`, r26, systemd, секрети, Telegram serving і Calendar. Паралельної роботи над #39 не було.

Source кандидата заморожений: жоден tracked-файл, крім цього звіту, не змінено. Тимчасовий harness жив лише в scratchpad поза репозиторієм і після звіту видалений. Провайдерські докази лишаються: події Session і memory versions store.

## 17. Обмеження

- Це обмежений поведінковий доказ з одного ходу, а не статистика надійності. PASS інших сценаріїв не доведено, FAIL інших — теж.
- **Не перевірено live:**
  - заміна `next_check`, корекція, дедуплікація;
  - retrieval у новій Session;
  - скасування;
  - proposal ≠ acceptance;
  - Done ≠ фідбек;
  - cross-project ізоляція;
  - відсутні докази;
  - межа plan-only ↔ Trello.
- **Відмінність від production:** у system prompt temp store мав іншу назву/опис, ніж production «Djonik Memory». Директорії `projects/` не було: production Memory свідомо не читали.
- Вартість довших Memory-інструкцій (+2974 символи) окремо не виміряна. Хід кешував 26 844 токени префікса разом із рештою system prompt.
- Proactive delivery і споживання `next_check` — це #39; не зачіпалось.
- Production hosted serving не змінювалось: там досі інструкції `a6a627d` без #34.
- Прибирання: temp store `memstore_01APQhKFwa5SXoemgCz4MLQ8` і idle Session `sesn_01CVcDwvoofZRRzzshuV4dJ5` лишаються для рев'ю. Архівація чи видалення — окремою дією після рішення Product Lead.

## Фінальні локальні перевірки

```text
npm test                → tests 674 / pass 674 / fail 0 / cancelled 0 / skipped 0
npm run typecheck       → tsc --noEmit, exit 0
git diff --check        → exit 0, без виводу (також з intent-to-add для цього звіту)
git status --short      → ?? docs/57_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_VALIDATION.md
```

Source-змін відносно `dcb8d3e` немає. `node_modules/` (з `npm ci` за lockfile) ігнорується git.

## Рішення Product Lead після рев'ю (2026-09-24, додано пізніше)

*Цей розділ дописано після рев'ю. Факти S1.1, вердикт і розділи 1–17 вище не змінювались.*

- **Прогін визнано валідним доказом.** Вердикт лишається історичним: **FAIL за тодішнім контрактом** `dcb8d3e`. Кандидат не пройшов, і цей звіт не перекваліфіковується.
- **Причина провалу — надмірно суворе правило контракту.** Мається на увазі обов'язковий read-back після кожного `write` / `edit`, а не хибний запис: файл, схема, семантика waiting, відсутність дат, пошук дубля, успішний `write`, memory version провайдера, `end_turn` і нуль Trello були коректні.
- **Для наступного кандидата стандарт доказу native Memory змінено** ([docs/56](56_ISSUE_34_COMMITMENT_LIFECYCLE_SOURCE_CONTRACT.md) §19):
  - успішного результату `write` / `edit` достатньо, щоб сказати «збережено»;
  - заява не може передувати цьому результату;
  - помилковий чи неясний результат — не «збережено»;
  - read-back необов'язковий.
- **Runtime-ledger для Memory не додається.**
- **Trello #31 без змін.** Зовнішній запис у картку, як і раніше, перевіряється окремим прямим читанням.
- **Що лишається неперевіреним:** S1.2–S4.3. Новий кандидат потребує окремо авторизованого live-прогону; цей follow-up його не виконував.
