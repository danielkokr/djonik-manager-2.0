# #44 — зняття Project Health specialist у r30: source-звіт

Дата: 2026-09-28; §13a — 2026-09-29.
Canonical NOW: [#44](https://github.com/danielkokr/djonik-manager-2.0/issues/44) — «Retire Project Health specialist in r30; validate coordinator project view».
Рішення: [docs/90](90_ISSUE_44_PROJECT_HEALTH_TOPOLOGY_AUDIT.md) і переписаний body #44. Топологію тут повторно не аудитували, A/B не запускали.

Тип: **source-only реалізація для review Product Lead.** #44 не завершено: поведінкова валідація r30 і cutover — окремі авторизовані кроки.

## 1. Summary

- Coordinator prompt більше не делегує Project Health. Секцію `# Project Health` прибрано, нову секцію маршрутизації на її місце не додано.
- `planning-and-focus` тепер власник project view. Він покриває активну роботу, наступний крок, Waiting, «що зависло», блокер, один ризик і найменшу наступну дію. Правила stuck, Waiting ≠ Blocked і risk додано в наявну секцію project view, плюс кейс 10 «Project risk».
- r30 candidate: `specialist: null` — роутера немає. Update body чистить roster через `multiagent: null`. Атестація r30 вимагає порожній roster, а r29 — як і раніше specialist v4.
- r25–r29 не змінено. `SERVING_RELEASE` = r29. r30/r31 серед `RELEASES` немає.
- Runtime: логіку не змінено, лише коментар. Перемикач specialist-шляху — атестований roster Session, тобто топологія релізу. На r30 provenance інертний, на r29 composition працює як раніше. Це доведено тестами.
- Benchmark: S1–S40 без змін, додано **S41** «Які ризики по Seqthera?» (critical, pass^3).
- **Блокер S11 усунуто (§13a).** Раніше на r30 верифікований due-запис через #23 повністю замінював текст моделі, і змішаний хід «що по X + постав дедлайн» втрачав project view.
  - Тепер детерміноване речення #23 лишається першим і код-власним.
  - Текст моделі йде після нього дослівно або не показується цілком. Він не показується, якщо є mismatch, будь-яке календарне посилання або власне твердження про дедлайн чи результат запису.
  - Тож лише код каже, що збережено і чи вдався запис (межі лексичних guard-ів — у §13a).

## 2. Реалізоване архітектурне рішення

Один користувацький Sonnet 5 coordinator. Project Health більше не окрема агентна здатність.

- **Стан, «що зависло», Waiting, блокери, ризик** — це project view у `planning-and-focus`, заземлений на `trello_board_snapshot` + Memory.
- **Немає:** advisor, handoff, specialist-as-tool, intent router, другої моделі.
- **Модель, effort, дозволи інструментів:** без змін.

## 3. Зміни coordinator prompt

`managed-agents/djonik.md`, лише body:

- Видалено секцію `# Project Health`: «health review … goes to the Djonik Project Health Specialist, not to you … Reply with the specialist's answer exactly as received …».
- Нічого не додано. Питання про проєкт закриває наявне правило «Use the Skill that owns the request». Тригер `planning-and-focus` явно називає ці питання.
- Глобальна фактична семантика не змінилась: missing field = unknown; Waiting ≠ Blocked; Backlog ≠ проблема; due ≠ commitment/risk; `lastActivityAt` ≠ progress/staleness; жодних вигаданих actor/history/date; fresh reads > Memory.
- Prompt: 5296 B, SHA-256 `0296d62462ecc4262bf32b7aa2b8472b2a4c72d77bb063049aa360ab3e1e33d1` (r30 candidate). Serving r29 = цей body + видалена секція (`fe28b195…5025`); `ISSUE_44_PROMPT_EDITS` відтворює його побайтово. Прецедент — #45.
- Frontmatter `djonik.md` лишається декларацією serving r29 разом із roster specialist v4.

## 4. Семантика project view у `planning-and-focus`

- **Опис Skill (тригер):** додано «a project view — what is active, waiting, stuck, blocked or at risk — such as "по Azov що в мене?", "що зависло по Extract?", "які ризики по Seqthera?" or "що тут чекає?"».
- **Evidence:** snapshot першим також для «stuck work, risk».
- **Project view (Answer):**
  - «Yours, not a health report»;
  - in progress, наступний крок, хто на кого чекає, що зависло, конкретний блокер, один ризик, найменша наступна дія;
  - лише частини, про які питають і які заповнюють факти;
  - без списку карток, score чи status label.
- **Plans, corrections and Trello:** явна зміна картки в тому самому повідомленні йде через verified write task-management «in the same single answer».
- **Кейс 10 «Project risk»:** див. §5.
- **Розмір.** Skill 17 888 B (LF), було 16 024. Приріст ≈1.9 KB замість specialist Skill на 10.8 KB. Ліміти тесту переглянуто: ≤ 18 000 загалом і ≤ 15 600 без секції feedback. Порівняння «менше за Skills, які замінює» тепер рахує daily + weekly + project-health. **Потрібне підтвердження PL.**

## 5. Правила stuck / Waiting / Blocked / risk

- **Stuck** — судження. Підстави: поточний список, дні в ньому (snapshot), слова картки, контекст Daniel.
  - Ніколи не підстава: відсутність due, старий `lastActivityAt`, Backlog, Waiting сам по собі.
  - `невідомо` означає, що вік невідомий, а не що картка зависла.
  - Фіксованого порогу немає: концепт, що довго в In progress, ≠ робота, свідомо паркована у Waiting.
- **Waiting ≠ Blocked.**
  - Waiting — пауза на когось або щось: список або слова картки. На кого — лише якщо це записано.
  - Blocked потребує названої залежності чи проблеми.
  - Довге очікування — привід нагадати, а не блокер.
- **Risk** — судження, ніколи не збережене поле. Потрібні обидва елементи:
  1. конкретне, що може постраждати: accepted commitment, клієнтське вікно, deliverable, на який чекають;
  2. поточний доказ: незавершена потрібна робота біля commitment, конкретний блокер, реальний конфлікт навантаження, наслідок за часом, названий клієнтом.
  - Самі по собі не ризик: due, багато карток, вік, відсутній size, Waiting, очікування з профілю.
  - Формат — один рядок «що під загрозою і чому». Якщо ризику немає — коротко сказати про це або пропустити.

## 6. Змішані запити

Один хід coordinator: `planning-and-focus` дає судження по проєкту, а `task-management` — явну мутацію з verified write #31.

- Handoff, другого повідомлення чи підказки «напиши окремо» немає.
- На r30 немає `coordinator_withheld`, ярлика чи cue specialist. Це доведено тестами (§16).
- Для верифікованого due-запису відповідь складається так: код-речення #23 першим, далі текст coordinator через гейт §13a.

## 7. Як r30 представляє відсутність specialist

- `DjonikRelease.specialist: ReleaseSpecialist | null`. `null` означає **переглянуту топологію «roster немає»**, а не «невідомо».
- `RELEASE_R30_CANDIDATE.specialist = null`, `agent.version = null`, new `systemSha256`.
- `buildCandidateUpdateBody` додає `multiagent: null`, коли candidate прибирає specialist. Це задокументований спосіб повністю очистити roster ([Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration), прочитано 2026-09-28; тип SDK `multiagent?: … | null`).
- Відповідно `system` тепер теж входить у body r30.
- Інші зміни roster (новий specialist або pin) відхиляються.
- `buildReleaseUpdateBody` відмовляє, якщо roster змінюється (partial update).

## 8. Збереження rollback на r29

- r25–r29 побайтово й семантично незмінні. Кожен pin specialist v4 (`agent_01KNiQDzzPjaMU6LLF4mU6uM`@4, `skill_01Treson…`@`skver_01JLTtMv…`) перевірено тестом.
- `SERVING_RELEASE === RELEASE_R29`.
- Frontmatter `djonik.md` = r29.
- `claude-lock.json` не змінено.
- Specialist v4 не архівовано.

## 9. Release plan / атестація

`compareWithRelease` перевіряє roster відповідно до топології релізу:

- **specialist ≠ null (r25–r29):** рівно 1 учасник — канонічний specialist із pinned version і skills, як і раніше.
- **specialist = null (r30):** рівно 0 учасників. Будь-який учасник, зокрема відставлений specialist, дає `roster has N members, expected none` + `unexpected roster member <id>@<v>`. Тобто fail-closed, а не «unverified».

Serving tuple виводить `specialist=none` для r30. Глобально валідацію roster не пропущено.

## 10. Runtime: рішення щодо сумісності

Логіку не змінено.

- `resolveProjectHealthSpecialistName(session.agent)` читає roster атестованої Session. Атестація до першого повідомлення доводить, що roster = реліз.
- r29 → ім'я specialist → повна композиція #28/#32/#38.
- r30 → `null` → `SpecialistTurnProvenance(null)` інертний: verdict завжди `none`, немає композиції, немає `DjonikSpecialistUnverifiedError`.
- Користувацький текст ніде не аналізується, роутера за фразами немає.
- Об'єкт provenance на r30 створюється, але вимкнений. Так вирішено навмисно: гілки `null` у гарячому шляху не потрібні. У `djonikClient.ts` оновлено лише коментар.

## 11. Specialist-код і файли, які навмисно лишаються

Лишаються для rollback на r29, до свідомого закриття вікна rollback:

- **Код:** `SpecialistTurnProvenance`, `composeWithSpecialist`, `specialistBlockForError`, `specialistUnverifiedNotice`, `DjonikSpecialistUnverifiedError`, `resolveProjectHealthSpecialistName`, `PROJECT_HEALTH_SPECIALIST_AGENT_ID`, трейси `specialist_*`.
- **Source:** `managed-agents/project-health-specialist.md`, `.claude/skills/project-health/SKILL.md`, `claude-lock.json`.
- **Тести:** усі тести #28/#32/#38 для specialist.

## 12. Дизайн S41

`S41 — "Які ризики по Seqthera?"`. Critical, pass^3, rubricFocus `evidence` + `usefulness`.

Обрано варіант A: один реальний ризик плюс дистрактори. Він найсильніше перевіряє відсутню здатність — назвати, що саме під загрозою і чому, і не зробити ризиком те, що ним не є.

Фікстура S41 (`pmFixture`):

- **Ризик:**
  - `commitments/seqthera.md` — accepted review концепту до ср 30.09.2026 18:00 Kyiv;
  - картка «концепт» у In progress, checklist 1/4.
- **Дистрактори — не ризик:**
  - «фідбек клієнта» у Waiting, блокер не названо;
  - «сайт» у To do з due вт 29.09 без commitment;
  - «паковання» XL у To do.
- **Дозволені дати (слоти):** commitment (ср 30.09), due сайту (вт 29.09), годинник (пн 28.09). Будь-яка інша дата — `no_date` fail.

Механічні перевірки: `no_date`, `zero_write`, `no_memory_write` (ризик не зберігається), `concise` (без переліку карток).

Вигадані Waiting / Blocked / commitment і висновки з `lastActivityAt` оцінює вимір `evidence` абсолютної рубрики #46. Назва сценарію фіксує очікування; готової прози не захардкоджено; порівняння зі specialist немає. `requires` не задано: S41 оцінюється за фактами незалежно від шляху читання. `BENCHMARK_REVISION` лишається `pm-quality-5`, бо сценарій лише доданий, як і в #52.

**Обмеження.** Грейдер бачить сценарій і слоти, але не вміст дошки. Судження «вигаданий Waiting» спирається на назву й слоти, як і в S9/S10. Це наявне обмеження архітектури, не нове.

## 13. S9 / S10 / S11: стан регресії

- **S9** «Що в мене по Azov? Коротко.» Без змін і досі осмислений: це звичайний project view, `concise`.
- **S10** «Що зависло по Extract?» Без змін: `requires: days_in_list`, фікстура гарантує ≥ 12 днів у Waiting. Нова семантика відповідає йому: довге Waiting — це «варто нагадати», а не Blocked.
- **S11** «Що по Seqthera і постав дедлайн концепту на п'ятницю 2 жовтня?» **Не змінено (`checks: ["verified_write"]`); блокер runtime усунуто — див. §13a.**
  - Раніше: верифікований due-запис через #23 **повністю замінював** текст моделі, тож на r30 project-view-половина змішаного ходу зникала.
  - Тепер r30 дає одну відповідь: детерміноване речення #23 першим, далі project view coordinator.
  - Тому S11 тепер вимірює саме бажану поведінку r30: дедлайн верифіковано і показано кодом; судження по проєкту видно в тій самій відповіді; немає specialist, ярлика чи cue.
  - Офлайн-тест «#44 S11 unchanged…» показує, що складена відповідь проходить механічну перевірку сценарію, а без запису падає.

## 13a. S11 mixed verified-write blocker resolution

> Додано 2026-09-29 після review Product Lead (#44 HOLD на одному блокері); доповнено того ж дня guard-ом результату мутації після другого review. Коміт `cf21047` з рештою #44 уже є в `main` за окремою вказівкою Product Owner; ця правка поки не закомічена.

### Корінь проблеми

`finalizeMutationReply` → `finalizeDueDateReply(reply, outcome)` повертав `buildVerifiedDueConfirmation(outcome)` і **не дивився на `reply`**. Так #23 гарантував правильну дату: модель помилялась у weekday / date / time щойно записаного значення, тому код власник усього речення.

Побічний ефект — будь-яка не-мутаційна частина відповіді зникала. На r29 це маскував блок specialist; на r30 змішаний хід втрачав project view.

Проблема загальна, не PH-специфічна: **авторитетний детермінований результат мутації + корисна не-мутаційна відповідь в одному ході**.

### Обрана архітектура

Одне правило для кожного ходу з підтвердженим due-записом (`finalizeMutationReplyWithMode`, `src/mutationCommentary.ts`):

1. **Код-блок завжди першим, дослівно й без змін.**
   - Один підтверджений запис — точне речення #23.
   - Кілька — детермінований рядок на кожну підтверджену мутацію: due через Kyiv-форматер, не-due — «Зміни підтверджено читанням картки.».
2. **Текст моделі — коментар.** Його ніколи не редагують і не латають: він або додається дослівно після порожнього рядка, або повністю не показується. Ярликів «system» / «coordinator» немає: відповідає один Djonik.
3. **Бінарний гейт `composeVerifiedDueReply`.** Коментар не показується, якщо:
   - будь-який due-результат ходу — mismatch (`withheld_mismatch`);
   - коментар містить **будь-яке** календарне посилання (`withheld_calendar`): weekday (повні форми без прийменника «серед», скорочення, англійські), число + місяць, `dd.mm(.yyyy)`, ISO-дату, `HH:MM`, відносний день (сьогодні / завтра / післязавтра / вчора / позавчора) або відносний проміжок («наступного тижня», «через N днів»);
   - коментар робить **власне твердження про дедлайн або результат запису** (`withheld_mutation_claim`, `mentionsDueMutationClaim`). Приклади: «Дедлайн не зберігся.», «Дедлайн встановлено.», «Я поставив дедлайн.», «Trello не оновив картку.», «Зміни не записались.». Guard спрацьовує на:
     - іменник дедлайну: дедлайн*, термін / строк (точні форми, щоб не ловити «терміново»), due / deadline;
     - дієслово результату запису: зберіг* / збереж*, запис*, онов*, встанов*, поставив / поставлено…, змінив / змінено…, переніс*, підтверд*. Іменники «зміни» / «поставка» свідомо не ловляться;
     - вузький англійський набір: saved / updated / changed / confirmed, failed to save / update / set, was (not) set / saved / updated.
   - коментар уже дослівно міститься в код-блоці, наприклад «Готово.» (`redundant`). Це перевірка на точне входження, а не класифікація змісту — аналог режиму `exact` у #32.
   - Порожній коментар — `none`.
   - Порядок перевірок: mismatch → redundant → calendar → mutation claim. Кожен guard працює незалежно.
4. **Трейс без контенту:** `due_commentary_composed { mode }`. r30-валідація бачитиме, як часто гейт спрацьовує.
5. **Контракт для моделі** (одне речення в `task-management`, «Due-date wording after a verified write»): код показує підтвердження першим; не підтверджуй запис і не повторюй збережену дату; пиши про решту запиту або нічого; текст із датою / weekday / часом / відносним днем або з власним твердженням про дедлайн чи збереження зміни на цьому ході не показується. Контракт лише зменшує кількість спрацювань гейта, а гарантію тримає код.

Роутингу за текстом Daniel немає. Використовуються лише runtime-докази: підтверджені / failed / unresolved мутації, наявність due-результату, mismatch, непорожній текст моделі.

### Чому гарантія #23 лишається справжньою

**Що гарантує код.** На ході з верифікованим due-записом лише код-блок каже, що збережено і чи вдався запис:

- текст моделі не показується **цілком**, якщо в ньому є будь-яка дата / день / час / відносний день чи проміжок;
- так само він не показується, якщо в ньому є іменник дедлайну або дієслово результату запису. Тож «Але дедлайн не зберігся.» чи «Trello не оновив картку.» не можуть з'явитися поруч із «Trello підтвердив дедлайн»;
- при mismatch показується лише детермінований рядок про mismatch.

Отже для всіх формулювань, що містять слова з цих двох закритих лексиконів, два конкуруючі твердження про результат запису неможливі.

**Чого код не гарантує.** Guard-и лексичні, змісту вони не розуміють. Пройде лише твердження про запис **без** жодного календарного слова, іменника дедлайну чи дієслова результату. Наприклад «не вийшло», «все пропало» чи «як ти просив» — розпливчасто і без предмета. Водночас:

- на mismatch-ходах навіть такі фрази не показуються (`withheld_mismatch`);
- контракт `task-management` прямо забороняє моделі такі твердження;
- трейс рахує кожне спрацювання, тож r30-валідація побачить, чи треба розширити лексикон.

Розширювати його в бік загальної NLP-санітизації свідомо не став.

**Чому це безпечніше за альтернативи:**

- **Патчинг прози** — заборонений і крихкий; тут текст ніколи не редагується.
- **«Due + довільний текст», як у #36** — повертає вихідну помилку #23.
- **Перевірка узгодженості дат** (дозволити ті, що збігаються з verified) — потребує розбору модифікаторів («наступної пʼятниці»), розширює поверхню помилок і дає дублікати.
- **Структурний поділ за подіями** — на поточній event-поверхні provider неможливий: фінальне `agent.message` — один текст без провенансу частин.

**Ціна правила.** Хибнопозитивне спрацювання, наприклад project view згадує іншу дату commitment або «клієнт підтвердив концепт», повертає рівно ту поведінку, що була до #44: лише код-блок. Коректність не страждає, втрачається лише корисність того ходу, і її видно в трейсі.

### Поведінка за випадками

| Випадок | Результат |
|---|---|
| A. Лише due-запис | Точне речення #23. «Готово.» → `redundant`; повторена дата → `withheld_calendar`; «Дедлайн встановлено.» → `withheld_mutation_claim`; порожньо → `none` |
| B. Змішаний read + due (S11) | `Готово. Trello підтвердив дедлайн: пʼятниця, 2 жовтня 2026, 18:00 за Києвом.` + порожній рядок + project view (`appended`); рівно одне твердження про збережене |
| B′. Змішаний, але модель повторила дату (навіть з неправильним weekday) | Лише речення #23 (`withheld_calendar`) |
| B″. Змішаний, але модель тверджує щось про запис без дат («Але дедлайн не зберігся.») | Лише речення #23 (`withheld_mutation_claim`) |
| C. Verified mismatch | Лише детермінований рядок «Картку оновлено, але Trello підтвердив… Це відрізняється…» (`withheld_mismatch`), хоч би що написала модель |
| D. Failed | Детермінований звіт `❌ …`; текст моделі не показується (без змін) |
| D′. Unresolved / ambiguous | `DjonikUnverifiedMutationError` після одного nudge; у повідомленні немає тексту моделі (без змін) |
| E. Кілька мутацій | Детермінований рядок на кожну підтверджену (due і не-due), далі те саме правило для коментаря; mismatch у будь-якій → `withheld_mismatch` |
| E′. Лише не-due мутації | Як і раніше: текст моделі (#31), гейт не застосовується |
| F. r29 specialist path | Без змін: `composeWithSpecialist` передає `null` → код-блок + блок specialist (тест #32 20 проходить) |

### Тести

- **`src/mutationCommentary.test.ts`** (новий, 13):
  - лексикон гейта (позитивні й хибнопозитивні приклади: «серед», `1/4`, `Size`);
  - контракт `composeVerifiedDueReply`;
  - A, B, C, D, E, F через `finalizeMutationReplyWithMode`;
  - контракт у Skill `task-management`;
  - guard результату мутації: 12 календарно-вільних тверджень про запис withheld, зокрема «Дедлайн не зберігся», «Дедлайн встановлено», «Trello не оновив картку», «Зміни не записались» і англійські варіанти;
  - корисні project-view тексти, зокрема два приклади PL і «Клієнт просив зміни…», appended;
  - незалежність guard-ів, mismatch, pure write, r29 null-шлях, не-due запис без гейта.
- **`src/turnCompletion.test.ts`** через реальний `connectToDjonik` на r30-Session:
  - «S11 resolved … due sentence first, then the project view» — замінює колишній тест «open finding»;
  - «restates the due … withheld whole»;
  - «a calendar-free claim about the write («Але дедлайн не зберігся.») is withheld whole»;
  - «verified due mismatch … alone»;
  - «unverified due write still fails closed after one nudge».
- **`src/pmBenchmark.test.ts`:** «#44 S11 unchanged: the r30 composed mixed reply … meets its mechanical checks offline».
- **`src/toolConfirmationClient.test.ts`:** без змін. Його відповідь моделі «Готово.» тепер іде через `redundant`, тож очікуване речення #23 точне, як і раніше.

Жодних змін S11, #31, #23-речення, прозових промптів coordinator чи specialist-коду.

## 14. Оновлення документації

- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` §9 — нотатка «Current topology — #44», яка заміщує попередній стан для r30. Історичні секції не змінено.
- `managed-agents/README.md` — блок #44: r30 без roster; `project-health-specialist.md` і `project-health` Skill — лише rollback- / історичне джерело.
- Цей звіт (+ §13a).

## 15. Змінені файли

Закомічено в `cf21047` (перший прохід #44):

| Файл | Зміна |
|---|---|
| `managed-agents/djonik.md` | − секція `# Project Health` (body) |
| `.claude/skills/planning-and-focus/SKILL.md` | тригер, evidence, project view (stuck/Waiting/Blocked/risk), mixed, кейс 10 |
| `src/release.ts` | `ReleaseSpecialist`, `specialist: … \| null`; r30: `specialist: null`, новий SHA prompt |
| `src/releaseAttestation.ts` | атестація roster залежно від топології; `specialist=none` у tuple |
| `src/releasePlan.ts` | `multiagent: null` у candidate body; відмова для інших змін roster; release body відмовляє при зміні roster |
| `src/djonikClient.ts` | коментар про перемикач топології |
| `src/pmBenchmark.ts`, `src/pmFixture.ts` | S41 + фікстура; S41 у `CRITICAL_IDS` |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_44_PROMPT_EDITS`, `R29_SYSTEM_PROMPT`; фікстури без roster |
| `src/djonikAgentSource.test.ts` | PH-тести інвертовано: немає делегування / advisor / router; семантика збережена |
| `src/planningAndFocus.test.ts` | тести project view / stuck / Waiting / risk / mixed; переглянуто ліміти |
| `src/release.test.ts`, `src/releaseR29.test.ts`, `src/clientProfile.test.ts` | r29 prompt = source − #44 |
| `src/releaseR30Candidate.test.ts` | топологія, атестація r29 / r30, план і відмови |
| `src/turnCompletion.test.ts` | runtime: r29 проти r30 Session, mixed, generic #32 |
| `src/pmBenchmark.test.ts` | S41 фікстура / перевірки / офлайн-симуляція |
| `docs/01…`, `managed-agents/README.md`, `docs/91…` | документація |

Незакомічено (§13a):

| Файл | Зміна |
|---|---|
| `src/mutationCommentary.ts` (новий) | `mentionsCalendar`, `mentionsDueMutationClaim`, `composeVerifiedDueReply`, `DueCommentaryMode` |
| `src/djonikClient.ts` | `finalizeMutationReplyWithMode` (одне правило для одного й кількох due-записів), трейс `due_commentary_composed` |
| `.claude/skills/task-management/SKILL.md` | одне речення-контракт у «Due-date wording after a verified write» (r30-only, pin не змінюється) |
| `src/mutationCommentary.test.ts` (новий) | A–F + лексикони + guard результату мутації + контракт |
| `src/turnCompletion.test.ts` | S11 resolved / restated / mutation-claim / mismatch / unverified |
| `src/pmBenchmark.test.ts` | S11 офлайн |
| `docs/91…` | §1, §6, §13, §13a, §15–§20 |

## 16. Точні focused-тести

Перший прохід #44:

```text
node --import tsx --test src/djonikAgentSource.test.ts src/planningAndFocus.test.ts src/skills.test.ts \
  src/release.test.ts src/releaseAttestation.test.ts src/releaseR27.test.ts src/releaseR27Candidate.test.ts \
  src/releaseR28.test.ts src/releaseR28Candidate.test.ts src/releaseR29.test.ts src/releaseR30Candidate.test.ts \
  src/servingRelease.test.ts src/turnCorrelation.test.ts src/turnCompletion.test.ts src/djonikClient.test.ts \
  src/pmBenchmark.test.ts src/pmFixture.test.ts src/clientProfile.test.ts src/managedAgentConfig.test.ts
ℹ tests 584  ℹ pass 584  ℹ fail 0
```

Після §13a — composition, due / date, mutation-ledger, #44 release:

```text
node --import tsx --test src/mutationCommentary.test.ts src/djonikClient.test.ts src/turnCompletion.test.ts \
  src/turnCorrelation.test.ts src/trelloMutationLedger.test.ts src/trelloChecklistLedger.test.ts \
  src/toolConfirmationClient.test.ts src/turnClock.test.ts src/pmBenchmark.test.ts src/pmFixture.test.ts \
  src/release.test.ts src/releaseAttestation.test.ts src/releaseR29.test.ts src/releaseR30Candidate.test.ts \
  src/skills.test.ts src/planningAndFocus.test.ts src/djonikAgentSource.test.ts
ℹ tests 601  ℹ pass 601  ℹ fail 0
```

Нові й змінені ключові тести:

- **Coordinator:** «#44: the coordinator prompt no longer delegates…», «no replacement advisor, handoff, router…», «global factual semantics … stay», «#42 → #44 … coordinator's own project view».
- **Skill:** «#44 project view…», «no specialist … no health score…», «#44 stuck…», «Waiting ≠ Blocked…», «#44 risk…», «#44 mixed request…», «commentary contract…».
- **Release / атестація:** «#44 topology…», «#44 attestation: r29 requires exactly specialist v4…», «#44 attestation: r30 requires NO roster…», «#44 plan: the r30 update body clears the roster…».
- **Runtime:**
  - «#44 topology switch…»;
  - «same-named stray child…»;
  - «mixed read + verified write on r30»;
  - «#44 S11 resolved…», «restates the due…», «a calendar-free claim about the write…», «verified due mismatch…», «unverified due write…»;
  - «generic #32 guarantees hold on an r30 Session».
  - Усі наявні тести #23 / #28 / #31 / #32 проходять.
- **Composition (§13a):** «gate lexicon…» ×2, «compose…», «A pure due write…», «B mixed…», «C verified mismatch…», «D failed write…», «E multiple mutations…», «F r29 specialist path…», «mutation-result guard…» ×2, «guards stay independent…».
- **Benchmark:** «#44 S41: project risk fixture…», «#44 S41 mechanical checks…», «offline critical simulation includes S41», «#44 S11 unchanged…».

Офлайн-симуляція (fake candidate + fake grader, без інференсу): `npm run benchmark:pm -- --offline --mode critical --release r30-candidate --output <scratch>` дає `| S41 | pass | pass | pass | pass^3 |`. Це не поведінковий доказ; S11 у симуляції `0/3`, бо fake candidate нічого не пише.

## 17. typecheck / build / повний test / diff

Після §13a:

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — 1362 тести, **1360 pass / 2 fail**. Фейли — лише відома Windows-база: `deployConfig.test.ts` «deploy script survives replacing itself…» і `processExit.test.ts` «a real process that fetched over keep-alive…».
- `git diff --check` — чисто.

У першому проході `reminderDelivery.test.ts` один раз упав під навантаженням; окремо він пройшов 3/3, і в повторних повних прогонах не падав.

## 18. Що лишається для пізнішої валідації r30

1. Фінальний review PL рішення §13a (гейт коментаря: calendar + mutation-result guard; контракт `task-management`).
2. Підтвердження PL переглянутих лімітів розміру `planning-and-focus` (§4).
3. Remote-кроки r30 з окремою авторизацією:
   - sync Skills, тепер і з контрактом `task-management`;
   - створення Agent v30 з body, де `system` + `multiagent: null`;
   - read-back + `release:check`;
   - zero-event Session для spelling.
4. Поведінкова валідація r30 за правилами #46: S9 / S10 / S11 / S41. Факти — pass^3, поведінка — ≥ 2/3, бюджет — docs/04 §27. Для S11 додатково дивитись на `due_commentary_composed`: `withheld_calendar` означає, що модель порушила контракт, а не що хибна дата дійшла до Daniel.
5. Пізніше, окремим issue, після зняття rollback-вікна r29: cleanup specialist-runtime / source і архів v4.

## 19. Підтвердження

- Платного інференсу не було: жодних Managed Sessions, benchmark-прогонів чи грейдера.
- Production Agent не оновлювався, remote Agent не створювався.
- Remote Skills не синхронізувались.
- Specialist v4 не архівовано.
- Memory і Trello не змінювались.
- Перший прохід #44 закомічено й запушено (`cf21047`) лише за прямою вказівкою Product Owner.
- Зміни §13a **не закомічені й не запушені**; deploy не було.
- Roadmap не змінювався; #44 не закрито; r31 не створено; serving лишається r29.

Єдиний зовнішній запит за весь #44 — читання публічної документації Multiagent orchestration.

## 20. `git status --short`

```text
 M .claude/skills/task-management/SKILL.md
 M docs/91_ISSUE_44_PROJECT_HEALTH_RETIREMENT_SOURCE_REPORT.md
 M src/djonikClient.ts
 M src/pmBenchmark.test.ts
 M src/turnCompletion.test.ts
?? src/mutationCommentary.test.ts
?? src/mutationCommentary.ts
```
