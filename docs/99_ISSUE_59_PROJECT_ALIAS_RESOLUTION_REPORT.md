# #59 — Резолюція аліасу проєкту («Азов» → A1): звіт Implementation Engineer

2026-10-02. Issue: [#59 — Project alias resolution fails across Trello reads/writes](https://github.com/danielkokr/djonik-manager-2.0/issues/59) (коментарів немає). Canonical NOW **не змінюється**: [#35](https://github.com/danielkokr/djonik-manager-2.0/issues/35), пілот робочого ритму. #59 — обмежене виправлення серйозного дефекту, знайденого під час цього пілоту.

**Це source-only кандидат на review.** #59 не закрито. Не було: commit, push, deploy, branch, sync Agent/Skills, нової версії Agent, створення Session, платного inference, запису в production Memory чи Trello, змін roadmap.

## 1. Підсумок

- Аліас уже записаний у канонічному брифі: `projects/azov-a1.md` має заголовок `# Азов / A1` і рядок `Aliases: Азов, A1.` (payload #17 від PO, перенесений #37 байт-у-байт). **Дані є. Бракувало контракту**, який вимагає застосувати їх до будь-якого використання Trello.
- Канонічне правило тепер у **coordinator prompt** (`managed-agents/djonik.md`, «How you act»). Воно присутнє в кожному ході, незалежно від того, який Skill завантажено. Назви проєкту — це заголовок і `Aliases:` брифу. Перед будь-яким читанням Trello, запитом історії чи записом слово Daniel (у будь-якій граматичній формі, без огляду на регістр) резолвиться через ці назви **без питання**. Далі береться **одна свіжа** мітка дошки, що дорівнює одній із цих назв. Невідоме слово лишається невідомим. Слово, що веде до двох проєктів, або дві мітки, що підходять: одне питання і нуль записів.
- `task-management`, крок 2 мітки, більше не містить розмитого правила «alias only counts when it plainly names that same project», яке й дало відмову в production. Тепер мітка має дорівнювати слову Daniel або назві, записаній у брифі. Записаний аліас не потребує підтвердження. Часткова, незаписана чи «схожа» назва не рахується ніколи.
- `trello_work_history`, `work-review`, Memory instructions, рантайм-код читання Memory: **без змін**. Інструмент і далі приймає канонічну поточну мітку буквально.
- Вимірювання: decision trace тепер записує scope `trello_work_history` як SHA-256 мітки (без тексту). Benchmark отримав S42–S47 і дві механічні перевірки: `history_scope`, `no_alias_question`. Окремий eval-only оракул `resolveProjectName` будує очікування з тексту брифів.
- Тести: **1455, з них 1453 passed, 2 failed**. Падають лише два відомі baseline-тести, і на чистій копії `HEAD` вони відтворюються так само. Build і typecheck чисті.

## 2. Першопричина

1. **Дані.** Бриф `projects/azov-a1.md` (#17, docs/33 §15.7) містить `# Азов / A1` і `Aliases: Азов, A1.`. Кожен бриф #17 має рядок `Aliases:`.
2. **Жоден контракт не вимагав читати їх перед Trello.**
   - Coordinator: «Memory holds … project briefs», але без правила про ідентичність проєкту.
   - `task-management` крок 2 порівнював мітку з «the anchored project's name» і дозволяв аліас, лише якщо той «plainly names that same project». Звідки брати аліас, не сказано. Модель шукала буквальну мітку «Азов», побачила A1 і пішла в крок 4 («немає мітки — створити без мітки?»). Це і є production-збій запису.
   - `work-review`: «a project uses its current Trello label». Правильно для **входу** інструмента, але кроку резолюції перед ним немає. Модель або передала «Азов», або перепитала «A1?». Це production-збій історії 2026-10-02.
   - `trello_work_history` перевіряє `label` буквально (`label.name?.trim() === projectLabel`, `src/trelloWorkHistory.ts`) і на «Азов» повертає `project_not_found`. Це правильна детермінована межа, не дефект.
3. Історичний прецедент: docs/08 §13 і docs/09 §16 вже фіксували, що модель не зверталась до аліасу «Extract» у Memory без підказки. Тоді це вважали поведінкою моделі поза scope, а контракту так і не додали.

## 3. Поточний потік ідентичності проєкту

До #59:

```
слово Daniel («азову») ──► буквальний пошук мітки в Trello ──► немає ──► питання / project_not_found
                         (бриф з Aliases ніхто не зобов'язаний читати)
```

Після #59:

```
слово Daniel («азову»)
  → Memory: бриф, чий заголовок/Aliases записує це слово (projects/azov-a1.md: Азов, A1)  — «який проєкт?»
  → свіжий Trello: list_labels / snapshot / cards → одна мітка, що дорівнює одній із назв брифу (A1) — «яка зараз мітка?»
  → операція з канонічною міткою: trello_work_history{scope:{kind:"project",label:"A1"}}, attach_label(labelId із свіжого читання),
    project view за A1-картками, майбутній #62.
```

## 4. Обрана архітектура і чому

Варіанти з issue:

| Варіант | Рішення |
|---|---|
| A. Явні аліаси в брифі | **Вже існує** (`Aliases:` з #17). Нового представлення не треба |
| B. Вивести з шляху / slug | Відхилено: `azov-a1` — slug, а не назва. Заголовок і `Aliases:` уже явні |
| C. Детермінований helper у рантаймі | Відхилено: потребує прямого читання project-Memory адаптером (див. нижче) |
| **D. Claude резолвить з Memory за контрактом, у Trello-інструменти передає канонічну мітку** | **Обрано** |
| E. Fuzzy у `trello_work_history` | Відхилено: це межа «канонічна мітка». Fuzzy там допоміг би лише історії, не записам, project view чи #62 |

Чому правило в coordinator prompt, а не в Skill чи Memory instructions:

- Резолюція потрібна **до** project view (`planning-and-focus`), історії (`work-review`), пошуку картки і запису (`task-management`), ритму (`pm-rhythm`) і майбутнього #62. Лише coordinator prompt присутній у кожному ході. Розкласти правило по Skills означало б мати чотири копії і пропустити якийсь потік.
- Memory instructions (`DJONIK_MEMORY_INSTRUCTIONS`) були б найшвидшим шляхом (код, без sync), але: (а) займають 4065/4096 байт, і майже кожне речення закріплене тестами #34/#42/#51/#52; (б) прецедент docs/88 §13: Memory instructions тримають лише межу зберігання, семантика живе в Skills/prompt. Розширювати їх за рахунок чужих прийнятих контрактів я не став.
- Прямий Memory-reader у застосунку не потрібен: бриф і так читається нативними інструментами Memory, як у #51. Розширювати володіння адаптера Memory без виміряної причини не можна. Адаптер і далі читає напряму лише `/rhythm.md` (тест це перевіряє).
- `trello_work_history` лишається буквальним. Тест доводить: «Азов» → `project_not_found`, «A1» → відповідь. Нечітке зіставлення не додано.

Розмір coordinator prompt: 5298 → **5797 байт** (редакційна межа тесту 5800). Абзац навмисно стислий. Наступне зростання prompt потребує нового review цієї межі.

## 5. Змінені файли

| Файл | Зміна |
|---|---|
| `managed-agents/djonik.md` | +1 абзац «A project's names …» у «How you act» |
| `.claude/skills/task-management/SKILL.md` | крок 2 «Project label on a new task»: імена брифу, без підтвердження записаного аліасу, без часткових чи незаписаних назв |
| `src/decisionTrace.ts` | `historyScopes?` (`board` / `project:<sha256>`), `historyScopeDigest()`, `custom(name, input?)`; replay передає `input` |
| `src/djonikClient.ts` | `decisionTrace?.custom(event.name, event.input)` (1 рядок, лише trace) |
| `src/projectIdentityOracle.ts` (новий) | eval-only оракул: `briefNames`, `resolveProjectName` |
| `src/pmBenchmark.ts` | перевірки `history_scope`, `no_alias_question`; поле `expectedHistoryLabel`; S42–S47; CRITICAL_IDS |
| `src/pmFixture.ts` | `PROJECT_ALIAS_SCENARIOS`, `labelsForScenario` (мітка A1 замість Azov), A1-картки, брифи #17, другий «Азов»-бриф для S47 |
| `src/projectIdentity.test.ts` (новий) | 14 регресійних тестів #59 |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_59_PROMPT_EDITS`, `R30_SYSTEM_PROMPT`, `ISSUE_59_SKILL_EDITS`, `r30SkillSource()`; r29 = r30 − #44 |
| `src/release.test.ts`, `src/releaseR30.test.ts`, `src/releaseR30Candidate.test.ts` | r30 pin = source мінус несинхронізоване #59-редагування (патерн #44/#45) |
| `src/skills.test.ts` | пін «never a partial, unrecorded or "close enough" name» |
| `src/pmBenchmark.test.ts` | структура S42–S47, full = 47 |
| `docs/99_…` | цей звіт |

## 6. Поведінка до → після

| Потік | До | Після (контракт; live не перевірено) |
|---|---|---|
| Поточний стан: «що зараз по Азову?» | Snapshot показує `project: A1`, модель не знає, що A1 = Азов → «такого проєкту немає» або вгадування | Бриф → A1 → A1-картки в snapshot і є цей проєкт. S43 |
| Історія: «які задачі за цей тиждень були по азову?» | «Азов» не знайдено → «ти мав на увазі A1?» | `trello_work_history` з `label: "A1"`, без питання. S42, trace `history_scope` |
| Канонічна назва «A1» | працює | працює так само. S45 |
| Створення: «створи задачу по Азову…» | «немає мітки Азов — створити без мітки?» | свіжий `list_labels` → A1 → create → `attach_label` (id зі свіжого читання) → пряма верифікація #31/#37. S44 |
| Пошук і запис існуючої картки | проєкт за буквальною назвою | проєкт резолвиться за брифом. Картку, як і раніше, визначає лише свіже читання. Дві кандидатури → питання |
| Невідоме «Аз», «A-one-ish» | — | невідоме, одне питання, нуль записів. S46 |
| Неоднозначне (слово у двох брифах) | — | одне питання, нуль записів. S47 |

## 7. Memory проти свіжого Trello

- **Memory (бриф) відповідає лише на «який проєкт?»**: заголовок і `Aliases:`. Бриф не містить і не повинен містити мітки, id мітки, id картки, списку, статусу чи due (Memory instructions: «Never store … labels»; тест #59 це перевіряє).
- **Свіжий Trello відповідає на все живе**: існування й назву мітки, її id (`task-management` крок 1: «Never take a label or its id from Memory»), картки, список, стан. Якщо бриф є, а мітки на дошці немає, резолюція дає `no_label`. Мітку не беруть із Memory і не створюють.
- Якщо мітку перейменують (наприклад, A1 → Азов), правило працює й далі, поки нова назва є серед назв брифу. Нову назву додає Daniel через звичайний шлях оновлення брифу (#51: лише його слова або «так»).

## 8. Перевірки і точні результати

| Команда | Результат |
|---|---|
| `npx tsx --test src/projectIdentity.test.ts` | 14 / 14 pass |
| Сфокусовані: projectIdentity, pmBenchmark, clientProfile, decisionTrace, skills, djonikAgentSource, release*, workReviewContract, planningAndFocus, commitmentContract, trelloWorkHistory, turnTrace | 407 tests, 406 pass. Єдиний fail (власний тест на імпорт оракула ловив згадку в коментарі) виправлено → 14/14 |
| `npm run benchmark:pm -- --offline --mode critical …` | SIMULATION ONLY: S42–S47 виконуються без infra_error. Fake-кандидат «SILENT» на них очікувано fail, крім S43. Це не поведінковий доказ |
| `npm test` (1-й прогін) | 1455 tests, 1452 pass, 3 fail: `deployConfig`, `processExit`, `messageGrouping` «synchronously-known-bad attachment … fails fast» |
| `messageGrouping.test.ts` окремо | 3 прогони × 40/40 pass. На чистій копії HEAD теж pass → timing-flake під навантаженням повного прогону, файл не змінювався |
| Чиста копія `HEAD` (`git archive`): deployConfig + processExit + messageGrouping | 54 tests, 52 pass, 2 fail: ті самі `deployConfig` і `processExit` → baseline, не пов'язані з #59 |
| `npm test` (2-й прогін) | **1455 tests, 1453 pass, 2 fail** (лише два відомі baseline) |
| `npm run typecheck` | чисто |
| `npm run build` | чисто |
| `git diff --check` | без зауважень (exit 0; лише попередження Git про LF→CRLF) |

Що покривають тести #59 (`src/projectIdentity.test.ts`):

- відомий аліас → канонічний проєкт → мітка A1; канонічна назва → сама в себе; регістр і пробіли нормалізуються; часткова, транслітерована чи схожа назва (`Аз`, `A-one-ish`, `Azov`, `Азовсталь`) → unknown;
- слово, що саме є міткою, без брифу → мітка; бриф без живої мітки → `no_label` (Memory не підставляє мітку);
- неоднозначність: два брифи, дві мітки, чужа мітка;
- дані з брифу, а не hardcode: зміна брифу змінює результат; у коді оракула, prompt і Skill немає «Азов» чи «A1»;
- оракул eval-only; прямий Memory API адаптера лишається рівно `pmFixture.ts` + `rhythmMemoryConfig.ts`;
- coordinator: резолюція стоїть перед зіставленням мітки, «без питання», невідоме не вгадується, неоднозначне → одне питання і нуль записів;
- task-management: свіжий `list_labels` іде першим, id не з Memory, старе розмите правило прибрано, кроки «немає мітки» і «кілька збігів» збережено;
- `work-review` і Memory instructions без змін, обидва в межах обмежень;
- `trello_work_history`: «A1» → відповідь, «Азов» → `project_not_found` (fuzzy немає);
- trace: scope як digest, без тексту мітки; replay теж;
- benchmark: production-відповіді 2026-10-02 («…Ти мав на увазі A1?» без виклику історії, «створити без мітки проєкту?») **падають**; виклик із «Азов» чи board-scope падає; правильний A1 проходить; S46/S47 падають при записі чи відсутності питання.

## 9. Регресії і безпека

- Записи: межі #31/#37 не змінено. Мітка й далі береться зі свіжого читання, і після `attach_label` потрібна пряма верифікація. Нового шляху запису немає.
- Невідомі назви не вгадуються. Слово, що саме є міткою, працює як раніше, тож проєкти без брифу (наприклад, Limen) не ламаються.
- Неоднозначні випадки отримують одне питання і нуль записів. Захисти «два кандидати → питання» (S19, S21, S29, тести #37/#48) пройшли без змін.
- Ризик, що модель трактує граматичну форму надто широко: формулювання «in any grammatical form, case aside» плюс «never guess from a similar name». Перевіряє S46 («Аз»).
- Ризик релізу: репо-source r30 тепер відрізняється від запіненого Agent v30 / Skill рівно на #59-редагування. Тести відтворюють r30 як «source мінус #59» (як для #44/#45), тож дрейф видно й контрольовано. `release:check -- r30 --serving` порівнює **remote** з записаним SHA і від source не залежить, тож поточний deploy-шлях r30 не ламається.
- Розмір prompt впритул до редакційної межі: 5797/5800.

## 10. Обмеження і відкладене

- **Production Memory у цьому проході не читалась.** Read-only спробу прочитати `/projects/*.md` (лише заголовок і `Aliases:`) заблокував класифікатор дозволів середовища. Доказ наявності аліасу документальний: канонічний payload #17 (`Aliases: Азов, A1.`) і docs/33 §15.7 (перенесення байт-у-байт, змінено лише два рядки про вихід із проєкту; версія `memver_01ANx1…`, підтверджена ще в docs/65). Якщо рядок `Aliases:` у production з того часу змінили, правило не спрацює, доки бриф не назве A1. Рекомендована перевірка (Daniel або з дозволом): read-only `memories.retrieve` для `/projects/azov-a1.md` і порівняння SHA з `cb613f6c…`.
- **Production ще не має цієї поведінки.** Prompt і `task-management` — це source. Потрібен рев'юйований реліз r31: нова версія Skill `task-management`, Agent v31 з новим `system`, attestation, cutover, deploy. Цей прохід цього не робить.
- Статичні тести доводять **контракт і інструменти вимірювання, а не те, що модель його виконує**. Потрібно: (1) платний прогін S42–S47 (окремий дозвіл і бюджет); (2) live Telegram-перевірка трьох фраз: «які в мене задачі за цей тиждень були по азову?», «що зараз по Азову?», «створи задачу по Азову: …» (+ контроль «A1»).
- Benchmark S44 перевіряє verified write і відсутність «A1?», але не те, що прикріплено саме мітку A1: trace не зберігає id міток. Це оцінює rubric.
- На eval-дошці може лишитися стара невикористана мітка «Azov». Вона не є назвою з брифу, тож контракт її не обирає (корисний відволікач).
- #60, #62, #63 не чіпав. #62 використає це правило без змін: будь-який майбутній інструмент тижневого часу з параметром проєкту отримає вже канонічну мітку від coordinator.

## 11. `git diff --check`

Без зауважень (exit 0).

## 12. `git status --short`

```
 M .claude/skills/task-management/SKILL.md
 M managed-agents/djonik.md
 M src/decisionTrace.ts
 M src/djonikClient.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmFixture.ts
 M src/release.test.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releaseR30.test.ts
 M src/releaseR30Candidate.test.ts
 M src/skills.test.ts
?? docs/99_ISSUE_59_PROJECT_ALIAS_RESOLUTION_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/projectIdentity.test.ts
?? src/projectIdentityOracle.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` існував до цієї роботи. Він не чіпався.
