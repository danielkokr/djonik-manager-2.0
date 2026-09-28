# #51 — Профілі клієнтів як збагачення брифів #17: source і офлайн-валідація

2026-09-28. Implementation Engineer. Canonical NOW: [#51 — Client profiles: expectations, approvals, contacts](https://github.com/danielkokr/djonik-manager-2.0/issues/51) (коментарів немає). **Source-only кандидат на review Product Lead. #51 не завершено.**

Не було: commit, branch, push, deploy, закриття issue, редагування roadmap, запису в production Memory, змін production Trello, sync Skills, нової версії Agent, створення Session, платного inference чи benchmark.

## 1. Підсумок

- #51 **не створює другої системи профілів**. Профіль клієнта — це робоча частина вже наявного брифу проєкту з #17, який з #37 лежить у `projects/<slug>.md`. Нових файлів, папок, CRM, кешу чи таблиці контактів немає.
- **Memory instructions** (єдиний наявний власник Memory) отримали лише межу зберігання: один бриф на проєкт, розширювати його, факти профілю — лише зі слів Daniel або його «так», за правилами `planning-and-focus`. Щоб це вмістилось, прибрано чотири повтори правил, які в тому ж тексті вже є. Підсумок: **4088 → 4079 байт UTF-8** (4035 → 4026 символів). Текст не виріс.
- **`planning-and-focus`** — семантичний власник (схема, одне питання-інтерв'ю, provenance, виправлення, заборона оцінок особистості). Тай-брейк вбудовано в наявний пункт **Week frame**, окремого механізму немає.
- **`studio-intake`** — декодер контактів для пересланих повідомлень поверх межі #48 (sender з Telegram лишається незмінним).
- **`pm-rhythm`** — у п'ятничному огляді не більше однієї пропозиції оновити профіль. Автоматичний хід нічого не записує.
- Benchmark: додано **S26–S30**, S1–S25 не змінено. Фікстури побудовано на затверджених даних #17. Офлайн-інструмент `clientProfileLint.ts` перевіряє збагачення брифу і дає оракул для декодера.
- Реліз: розширено **той самий** невирішений `RELEASE_R30_CANDIDATE`. r29 і далі serving; r25–r29 не змінені.
- Тести: **1322, з них 1320 passed, 2 failed**. Падають лише два відомі Windows-базові тести, їхні файли не змінювались.

## 2. Що вже існувало з #17 (discovery)

- Issue #17, коментар PO від 2026-09-17, — канонічний payload із шести файлів: `extract.md`, `cossack-labs.md`, `azov-a1.md`, `seqthera.md`, `limen.md`, `work-priorities.md`.
- docs/08: #17 записав їх **у корінь** Memory Store через Memory API (`/extract.md` …) і перевірив recall, ізоляцію між проєктами та те, що виправлення замінює старий факт.
- docs/33 §15 (#37, затверджено PO 2026-09-23): брифи **перенесено** через `memories.update({ path })` (id і історія версій збереглися) до `/projects/<slug>.md`, `/work-priorities.md` → `/priorities.md`. До `/projects/extract.md` додано вимогу тону, у `/projects/azov-a1.md` уточнено два рядки про вихід із проєкту. Фінальне дерево на 2026-09-23: `/preferences.md`, `/priorities.md`, `/projects/{azov-a1,cossack-labs,extract,limen,seqthera}.md`.
- Пізніші джерела вже спираються на `projects/`: Memory instructions (`commitments/<project-slug>/…` «slug as in projects/»), `planning-and-focus` («a project brief … when that project … is in play»), тест #34 («project directory reuses the #37 project-brief naming»).
- Ownership: окремого Memory-Skill немає. Memory-контракт живе в `DJONIK_MEMORY_INSTRUCTIONS` (`src/djonikClient.ts`), які передаються у Session як `instructions` ресурсу `memory_store`. `/rhythm.md` — Skill `pm-rhythm`. Картки — `task-management`.

## 3. Рішення щодо канонічного шляху брифу

**Канонічний шлях — `projects/<slug>.md`** (#37, docs/33 §15.7): `projects/extract.md`, `projects/cossack-labs.md`, `projects/seqthera.md`, `projects/azov-a1.md`, `projects/limen.md`. Назви `extract.md` з #17 історичні, `projects/<client>.md` у тексті #51 з ними узгоджується.

Застереження: поточний production-стан доведено лише документами на 2026-09-23. Після цього з source видно лише записи моделі в `commitments/`, `plans/`, `working-style.md`, `rhythm.md`. Production Memory в цьому проході **не читалась**. Тому контракт сформульовано як «один наявний бриф проєкту» з цим шляхом, і нічого не мігрується.

## 4. Які наявні дані #51 використовує

Змісту #17 не викинуто, інтерв'ю «з нуля» немає. Питання ставиться лише тоді, коли в брифі бракує факту, від якого залежить рішення. Факти #17, на які спирається профіль:

| Проєкт | Уже є в брифі (#17) |
|---|---|
| Extract | Anna — важлива людина, що ухвалює рішення; асинхронна комунікація; довгі погодження; неоднозначний фідбек; основне — паковання |
| Cossack Labs | Ivan, Zhenya; найвища фінансова вага; синки вт/чт; неоднозначний фідбек; перфекціонізм затверджувача |
| Seqthera | Anastasia — посередниця; три рішення-приймачі на боці клієнта; непрямий фідбек |
| Азов / A1 | Ганнуся, Коля; хаотичні задачі; терміновість повторюється; синк у ср |

Факти #17 лишаються як наявний канонічний контекст. **Provenance-дати до них не додаються**: дата їхнього походження в межах #51 не встановлена, тому lint ловить таку «backdated» дату як помилку.

## 5. Фінальна схема профілю

Нових файлів немає. Усередині того самого брифу, лише там, де факт відомий:

- **Contacts** — ім'я / аліас → роль (декодер для пересланих повідомлень);
- **Expectations** — як швидко чекають відповідь, як сприймають перенесення;
- **Approval** — хто затверджує;
- **Typical edits / friction** — повторювані конкретні правки, тертя в процесі.

Разом із наявними розділами #17 (ідентичність і аліаси, роль і scope, стратегічний контекст, робоча модель, planning guidance) це й дає цільову форму з issue. Правила: кожен факт в одному місці; наявний рядок зберігає свої слова, заголовок #17 можна нормалізувати (наприклад, `Recurring friction:` → `Typical edits / friction:`). Жоден розділ не обов'язковий.

Приклад збагачення (eval-фікстура, `EVAL_PROFILE_BRIEFS.extract`):

```text
Contacts:
- Decision-maker: Anna is an important client-side decision-maker.        ← #17, без змін і без дати
- Anna (Анна, Аня) — фінальне затвердження паковання (сказав Daniel, 28.09.2026)   ← #51
Typical edits / friction:
- ambiguous or noncommittal client feedback is a recurring friction point.  ← #17, перенесено під розділ
```

## 6. Інтерв'ю

`planning-and-focus` → «Missing fact»: якщо в проєкті, що зараз у грі, бракує **одного** факту, який змінив би це рішення (хто затверджує, хто ця людина, швидкість відповіді, перенесення, повторювана правка), Djonik питає саме його і лише раз. Анкети немає, про те, що вже є в брифі, не питає. «Не знаю» чи «пропусти» лишають факт невідомим: вгадувати його не можна. Це узгоджено з глобальним правилом «одне питання в одному реченні» (coordinator prompt) і з рядком `<одне легке питання>` у формі відповіді.

## 7. Provenance, оновлення, виправлення

- Хто може записати: відповідь Daniel, «запиши це про X» або його «так» на пропозицію. Не можуть: текст клієнта, Trello, помічений моделлю патерн, автоматичний хід.
- Формат: `Анна — фінальне затвердження (сказав Daniel, 28.09.2026)`. Дата береться з рядка годинника адаптера; без нього дати немає, лишається `(сказав Daniel)`. Правило «Dates» з #34 не порушено: жодної вгаданої дати, `YYYY-MM-DD` у тексті інструкцій і далі з'являється один раз.
- Виправлення замінює застарілий рядок, суперечності не накопичуються. Це те саме правило, що вже є в першому абзаці Memory instructions («the superseded one is no longer presented as still active»).
- Лише робочі звички. Мітки на кшталт «складний», «емоційний», «токсичний» заборонені. Стану карток у брифі немає.
- «Saved» можна казати лише після успішного результату `write`/`edit` (правило #34, без змін).

## 8. Декодер контактів

`studio-intake` → «Known contacts»: Djonik шукає Telegram-sender у `Contacts` брифів. Якщо точне ім'я чи записаний аліас є лише в одному брифі, це визначає проєкт для пропозиції; картку й далі визначає `task-management` зі свіжого Trello. Sender лишається рівно таким, як його передав Telegram. Неоднозначно (і тоді Djonik питає), якщо ім'я є у двох брифах, збіг лише приблизний або ім'я трапляється тільки в тексті повідомлення. Прихований sender нічого не визначає (правило #48 «`невідомо`, never infer a person from wording» не змінено). Нового sender не зберігають, і пересланий текст ніколи не редагує бриф.

Оракул `resolveContact(sender, briefs)` для benchmark має лише два параметри (текст повідомлення туди не передається). Він повертає `unique | ambiguous | unmatched | unknown` і враховує наявний рядок #17 `Decision-makers / important contacts: Ivan, Zhenya.`.

## 9. Пересланні повідомлення

Потік: переслане джерело → атрибуція з Telegram → (за потреби) контакт і проєкт з брифу → одна пропозиція → «✅ Внести» від Daniel → перевірені записи. Межі #48 не послаблено: хід `forwarded_source` детерміновано read-only (`decideConfirmation` відхиляє `write`/`edit`, тест §17), пропозиція одна, підтвердження явне, перевірка Trello за #31, цитата й sender для обіцянки — лише після прийняття.

## 10. Тай-брейк у плануванні

`planning-and-focus` → **Week frame** (наявний пункт, який вже вирішував «close calls»): «The accepted week plan, `priorities.md` and a recorded client expectation decide close calls; today's words, the client's words in a specific message and real commitments override them. A client profile never creates urgency or a deadline.» Шкали балів чи детермінованого ранжування немає. Окремий кейс №10 спершу був у Skill, але його прибрано, щоб дотримати бюджет байтів. Цю поведінку перевіряє S26.

## 11. Конкретне повідомлення важливіше за профіль

Порядок доказів: (1) слова Daniel зараз; (2) слова клієнта в конкретному поточному повідомленні; (3) прийняте зобов'язання; (4) свіжий Trello; (5) профіль як контекст і тай-брейк. Це записано в Week frame і в «Known contacts» (`не терміново` важливіше за «usually same-day»; бриф не додає дедлайну чи терміновості, яких немає в джерелі). Перевіряє S27 (`no_fire`, `no_date`, zero-write).

## 12. П'ятничне уточнення

`pm-rhythm` → Friday review: **не більше однієї** пропозиції і лише тоді, коли факти, прочитані в цьому ході (прийняті `commitments/` з `source_sender` або `trello_work_history`), показують той самий конкретний патерн для одного проєкту, а бриф його ще не містить. Форма з плейсхолдерами: «💭 <хто> уже <скільки прочитав> рази <що саме> (<джерело>). Записати для <проєкт>, що <звичай>?». Кількість — лише прочитана, без слабких вражень, без міток особистості і не для того, щоб заповнити рядок. Сам хід нічого не пише: #39 read-only, деталі в §17. Пізніше «так» або переформульований рядок Daniel записується за правилами `planning-and-focus`; «ні» не записує нічого.

## 13. Ownership Memory і Skills

| Власник | Що належить |
|---|---|
| Memory instructions | Місце (`projects/<slug>.md`, один бриф, розширювати) і межа авторитету (лише слова або «так» Daniel) + вказівник на семантичного власника |
| `planning-and-focus` | Схема, інтерв'ю, provenance, виправлення, заборона оцінок особистості, тай-брейк (Week frame); description отримав тригер «запиши про Extract, що Анна затверджує фінал» |
| `studio-intake` | Декодер контактів і пріоритет джерела над профілем для пересланого |
| `pm-rhythm` | Одна п'ятнична пропозиція, нуль записів |
| `task-management`, coordinator prompt | Без змін |

Чому не новий Skill. Власник Memory (instructions) обмежений 4096 символами, і місця на повну схему там немає. Семантика профілю — це «хто може почекати», тобто планування, яке вже належить `planning-and-focus`. Для Memory-контрактів уже є прецедент вказівника (`task-management's verified path`). Схема записана один раз (тест: список розділів і приклад provenance є лише в `planning-and-focus`).

Розміри Skills (LF, байти): `planning-and-focus` 12 627 → 13 798 (редакційний ліміт тесту піднято 12 750 → 13 800 на review; інваріант #42 «менше за два замінені Skills» < 13 865 дотримано), `studio-intake` 12 572 → 13 362, `pm-rhythm` 16 467 → 17 155, `task-management` без змін.

## 14. Ліміт 4096: вимірювання і рішення

- Об'єкт ліміту: поле `instructions` ресурсу `memory_store` у Session. SDK, `resources/beta/sessions/sessions.d.ts`: «Per-attachment guidance … Max 4096 chars». Текст живе в `DJONIK_MEMORY_INSTRUCTIONS` і передається з кожною новою Session. **Файли Memory цим лімітом не обмежені**: їхній `content` має ліміт 100 kB (`memories.d.ts`), а брифи займають близько 1,5–2,2 KB. Тест репозиторію додатково тримає розмір у 4096 **байтах** UTF-8 про запас; це правило не послаблювалось.
- До: **4035 символів / 4088 байт** (8 байт запасу). Після: **4026 / 4079**.
- Додано (≈180 байт): `projects/<slug>.md is the one brief per project: extend it, never a second file; client-profile facts only from Daniel's words or yes, as planning-and-focus says.`
- Прибрано чотири повтори, канонічне правило кожного лишилось:
  1. `no card state` (Fixed places) → канонічне «Do not store live Trello/task state» (перший абзац);
  2. `(on someone else)` у `status:` → канонічні `waiting_on:` і «Waiting is not blocked»;
  3. `yours is recorded only once he accepts, in the same file` (next_check) → канонічні «next_check stays none until Daniel accepts», «Your unanswered proposal is not acceptance» (Accept) і «edits the same file» (Correction);
  4. `Fresh Trello wins on current state but` і `read a linked card fresh if its current state matters` → канонічні «fresh external tool reads always outrank …» і «read them fresh by card id» (Never store).
- Відповідні пини тестів #34/#42 переписано на канонічні рядки, семантику збережено (`commitmentContract.test.ts`, `planningAndFocus.test.ts`). Факти #17 у Memory не зачеплено: це вихідний код, не контент Memory.

## 15. Benchmark

`BENCHMARK_REVISION` `pm-quality-3` → `pm-quality-4`. S1–S25 і їхні фікстури не змінено (тест перевіряє, що в S1–S25 немає рядків «сказав Daniel», а `/projects/extract.md` лишився таким, як був). Нові сценарії додано в критичний набір:

| ID | Що перевіряє | Механічні перевірки | Ціль |
|---|---|---|---|
| S26 | Профіль вирішує справжню нічию: сайти Cossack Labs і Seqthera обидва в To do, без due, Size і обіцянок; різняться лише записані очікування щодо перенесень | `one_main`, `no_date`, `no_duration`, `zero_write`, `no_memory_write`, `no_fire` | ≥2/3 |
| S27 | Переслане від Ганнусі «Не терміново…» проти профілю «зазвичай чекає того ж дня» | `zero_write`, `no_memory_write`, `non_silent`, `no_fire`, `no_date` | pass^3 |
| S28 | Переслане від «Коля» (оракул: лише Azov); текст не називає проєкт | `expected_project` (Azov/Азов/A1), zero-write ×2, `no_date` | ≥2/3 |
| S29 | «Аня» — аліас і Anna (Extract), і Anastasia (Seqthera) | `asks_question`, zero-write ×2 | pass^3 |
| S30 | П'ятничний огляд із трьома resolved-обіцянками Azov, де `source_sender: Ганнуся` і запити термінові | `non_silent`, zero-write ×2, `no_hours_restated` | ≥2/3 |

Нові механічні перевірки: `no_memory_write` (порожній `trace.memoryPathsWritten`), `asks_question`, `no_fire`, `expected_project`. Прозу не захардкоджено: «не більше однієї пропозиції» та «не вгадувати проєкт» оцінює rubric. Source-aware claim-lint, zero-write, авторитет `forwarded_source` і decision trace не змінено. Офлайн-симуляція (`npm run benchmark:pm -- --offline --mode critical`) проходить по S26–S30 з fake-кандидатом. **Це не поведінковий доказ**, платного прогону не було, pass^3 не заявляю.

Фікстури (`src/pmFixture.ts`, лише eval): `ISSUE_17_BRIEF_EXCERPTS` — стислі витяги затверджених брифів #17 **без ставок і комерційних деталей** (Extract/Anna, Cossack Labs/Ivan+Zhenya, Seqthera/Anastasia, Азов/Ганнуся+Коля); `EVAL_PROFILE_BRIEFS` — ті самі брифи після eval-відповідей на інтерв'ю. `lintProfileBrief(before, after)` для кожного проєкту повертає `[]`.

## 16. Межа релізу і незмінність r29

- `SERVING_RELEASE === RELEASE_R29`; `RELEASES.r30` і `r31` не існують; `RELEASE_R30_CANDIDATE.agent.version === null`.
- #51 змінює лише `planning-and-focus`, `studio-intake`, `pm-rhythm`. Усі три вже `unresolved` у r30-кандидаті (#47/#48/#50). Змінено тільки текст причини (`#47/#48/#50/#51 …`) і коментар. Нових інструментів, дозволів, pin'ів і Skill id немає; `systemSha256` кандидата і далі дорівнює r29 (coordinator prompt не змінено).
- Memory instructions не входять до release-кортежу, вони постачаються разом із деплоєм застосунку (як і зміни #34/#42/#48). **Важливо для cutover:** новий вказівник посилається на правила `planning-and-focus`, яких у r29-версії Skill немає. Тому ця ревізія застосунку має деплоїтись разом із r30, а не окремо під r29 (той самий зв'язок уже існує для #48 `source_sender`).
- r25–r29 не змінені: тести `release*.test.ts` проходять.

## 17. Тести й результати

Нові офлайн-тести `src/clientProfile.test.ts` (22), зокрема:
- бриф #17 + нові поля → один канонічний бриф; усі рядки #17 збережено; дублікат ловиться (`duplicate_fact`);
- виправлення замінює (з `superseded` → `[]`; якщо лишити обидва рядки → `same_subject_twice`);
- новий факт має provenance (`missing_provenance`; без рядка годинника `(сказав Daniel)` без дати допустимий); фальшива дата на рядку #17 → `backdated_provenance`;
- мітка особистості або стан Trello → `personality_label` / `live_state`;
- `forwarded_source`, `rhythm_ritual`, `rhythm_exception` → `write`/`edit` **deny** (`autonomous_read_only`); `user_message`/`button_callback` → allow (звичайний шлях Memory);
- унікальний контакт визначає проєкт, неоднозначний — ні, прихований sender → `unknown`, новий → `unmatched`;
- конкретне джерело важливіше за профіль і профіль не створює терміновості (контракт Skill + S27);
- п'ятниця — максимум одна пропозиція, «ні» не записує нічого, автоматичний хід не пише;
- межа Trello/live-state не змінилась; r29 serving; лише невирішений r30.

| Перевірка | Результат |
|---|---|
| Фокусні (`clientProfile`, `pmBenchmark`, `pmFixture`, `planningAndFocus`) | 69/69 passed |
| Memory/Skill-контракти (`commitmentContract`, `planningAndFocus`, `djonikClient`) | 214/214 passed |
| Skills (`pmRhythmSkill`, `skills`, `djonikAgentSource`, `planningAndFocus`, `commitmentContract`) | 231/231 passed |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npm test` | **1322 tests, 1320 passed, 2 failed** (до #51: 1300 / 1298 / 2) |
| `git diff --check` | passed (exit 0) |

Обидва падіння — відомі Windows-базові, без змін: `src/deployConfig.test.ts` (CRLF у `deploy/deploy.sh`, `expected /^main "\$@"\nexit$/m`) і `src/processExit.test.ts` (`actual: 1, expected: 78`). Ці файли й `deploy/` не змінювались.

## 18. Обмеження і що потребує live-валідації

- **Production Memory не записувалась і не читалась.** Реальні `/projects/*.md` не мають розділів #51 і не мігруються. Наповнення відбуватиметься природно, через інтерв'ю після деплою, або окремим авторизованим кроком (затверджений diff, Memory API з `content_sha256` precondition, як у #37).
- Поведінка моделі (чи ставить одне питання, чи дотримується формату provenance, чи не виводить мітки, чи не вгадує контакт, чи пропонує в п'ятницю не більше одного оновлення) — це Skill і модель. Статичні тести доводять лише розміщення правил і детерміновані межі. Потрібен авторизований платний прогін S26–S30 (×3) на eval-сховищі.
- Чи підвантажує модель `planning-and-focus` за вказівником з Memory instructions на ad hoc «запиши про X» поза контекстом планування — не виміряно.
- `lintProfileBrief` — евристичний скринінг (мітки й live-state за словником, `same_subject_twice` за ключем «розділ + суб'єкт»), а не семантичний суддя. Він придатний для порівняння до/після при майбутньому авторизованому read-back брифу.
- Декодер не використовує fuzzy-збіги: «Анна К.» ≠ «Анна». Це свідомо, у такому разі Djonik питає.
- Прив'язка деплою: Memory instructions #51 мають виходити разом із r30 (§16).
- Публічність репозиторію: фікстури містять лише імена контактів, уже опубліковані в issue #17; ставок і комерційних умов у них немає.

## 19. `git status --short`

```text
 M .claude/skills/planning-and-focus/SKILL.md
 M .claude/skills/pm-rhythm/SKILL.md
 M .claude/skills/studio-intake/SKILL.md
 M src/commitmentContract.test.ts
 M src/djonikClient.ts
 M src/planningAndFocus.test.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmFixture.ts
 M src/release.ts
?? docs/88_ISSUE_51_CLIENT_PROFILE_ENRICHMENT_SOURCE_REPORT.md
?? src/clientProfile.test.ts
?? src/clientProfileLint.ts
```
