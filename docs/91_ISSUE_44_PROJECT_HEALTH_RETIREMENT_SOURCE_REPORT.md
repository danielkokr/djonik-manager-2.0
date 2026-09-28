# #44 — зняття Project Health specialist у r30: source-звіт

Дата: 2026-09-28.
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
- **Знахідка для S11 (§13).** На r30 верифікований запис due-дати через #23-фіналізатор повністю замінює текст моделі. Тож у змішаному ході «що по X + постав дедлайн» project-view-половина не показується. На r29 це маскував блок specialist. Не виправлено в #44, потребує рішення PL.

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
- Обмеження для due-запису — у §13.

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
- **S11** «Що по Seqthera і постав дедлайн концепту на п'ятницю 2 жовтня?» **Не змінено, але виявлено структурний ризик.**
  - `finalizeMutationReply` → `finalizeDueDateReply` для верифікованого due-запису **повністю замінює** текст моделі детермінованим реченням #23.
  - На r29 поруч їхав блок specialist. На r30 project-view-половина змішаного ходу не показується. Це підтверджує тест «#44 mixed read + due write on r30».
  - `verified_write` пройде, але рубрика `usefulness` / `decision` ймовірно впаде.
  - Причина — поведінка runtime #23, а не фікстура. Тому я її не змінював (AGENTS.md: generic runtime fix не ховати в product issue).
  - **Рекомендація PL:** до валідації r30 визначити bounded-фікс. Наприклад, детерміноване речення due першим, потім коментар coordinator за фіксованим роздільником, як у relay #36. Або прийняти це як відоме обмеження.

## 14. Оновлення документації

- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` §9 — нотатка «Current topology — #44», яка заміщує попередній стан для r30. Історичні секції не змінено.
- `managed-agents/README.md` — блок #44: r30 без roster; `project-health-specialist.md` і `project-health` Skill — лише rollback- / історичне джерело.
- Цей звіт.

## 15. Змінені файли

| Файл | Зміна |
|---|---|
| `managed-agents/djonik.md` | − секція `# Project Health` (body) |
| `.claude/skills/planning-and-focus/SKILL.md` | тригер, evidence, project view (stuck/Waiting/Blocked/risk), mixed, кейс 10 |
| `src/release.ts` | `ReleaseSpecialist`, `specialist: … \| null`; r30: `specialist: null`, новий SHA prompt |
| `src/releaseAttestation.ts` | атестація roster залежно від топології; `specialist=none` у tuple |
| `src/releasePlan.ts` | `multiagent: null` у candidate body; відмова для інших змін roster; release body відмовляє при зміні roster |
| `src/djonikClient.ts` | лише коментар про перемикач топології |
| `src/pmBenchmark.ts`, `src/pmFixture.ts` | S41 + фікстура; S41 у `CRITICAL_IDS` |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_44_PROMPT_EDITS`, `R29_SYSTEM_PROMPT`; фікстури без roster |
| `src/djonikAgentSource.test.ts` | PH-тести інвертовано: немає делегування / advisor / router; семантика збережена |
| `src/planningAndFocus.test.ts` | тести project view / stuck / Waiting / risk / mixed; переглянуто ліміти |
| `src/release.test.ts`, `src/releaseR29.test.ts`, `src/clientProfile.test.ts` | r29 prompt = source − #44 |
| `src/releaseR30Candidate.test.ts` | топологія, атестація r29 / r30, план і відмови |
| `src/turnCompletion.test.ts` | runtime: r29 проти r30 Session, mixed, generic #32 |
| `src/pmBenchmark.test.ts` | S41 фікстура / перевірки / офлайн-симуляція |
| `docs/01…`, `managed-agents/README.md`, `docs/91…` | документація |

## 16. Точні focused-тести

```text
node --import tsx --test src/djonikAgentSource.test.ts src/planningAndFocus.test.ts src/skills.test.ts \
  src/release.test.ts src/releaseAttestation.test.ts src/releaseR27.test.ts src/releaseR27Candidate.test.ts \
  src/releaseR28.test.ts src/releaseR28Candidate.test.ts src/releaseR29.test.ts src/releaseR30Candidate.test.ts \
  src/servingRelease.test.ts src/turnCorrelation.test.ts src/turnCompletion.test.ts src/djonikClient.test.ts \
  src/pmBenchmark.test.ts src/pmFixture.test.ts src/clientProfile.test.ts src/managedAgentConfig.test.ts
ℹ tests 584  ℹ pass 584  ℹ fail 0
```

Нові й змінені ключові тести:

- **Coordinator:** «#44: the coordinator prompt no longer delegates…», «no replacement advisor, handoff, router…», «global factual semantics … stay», «#42 → #44 … coordinator's own project view».
- **Skill:** «#44 project view…», «no specialist … no health score…», «#44 stuck…», «Waiting ≠ Blocked…», «#44 risk…», «#44 mixed request…».
- **Release / атестація:** «#44 topology…», «#44 attestation: r29 requires exactly specialist v4…», «#44 attestation: r30 requires NO roster…», «#44 plan: the r30 update body clears the roster…».
- **Runtime:**
  - «#44 topology switch: the same child events compose on an r29 Session and are inert on an r30 Session»;
  - «same-named stray child can never fail a turn»;
  - «mixed read + verified write on r30»;
  - «mixed read + due write on r30 … (open finding)»;
  - «generic #32 guarantees hold on an r30 Session».
  - Усі наявні тести #28/#32 для r29 проходять.
- **Benchmark:**
  - «#44 S41: project risk fixture…»;
  - «#44 S41 mechanical checks…»;
  - «offline critical simulation includes S41».

Офлайн-симуляція (fake candidate + fake grader, без інференсу): `npm run benchmark:pm -- --offline --mode critical --release r30-candidate --output <scratch>` дає `| S41 | pass | pass | pass | pass^3 |`. Це не поведінковий доказ. S11 у симуляції `0/3`, бо fake candidate нічого не пише.

## 17. typecheck / build / повний test / diff

- `npm run typecheck` — OK.
- `npm run build` — OK.
- `npm test`:
  - **1-й прогін:** 1344 тести, 1341 pass, 3 fail. Фейли: `deployConfig.test.ts` і `processExit.test.ts` (відома Windows-база) та `reminderDelivery.test.ts` «crash during the Telegram call…». Останній окремо пройшов 3/3, файлів reminder я не чіпав — схоже на flake під навантаженням.
  - **2-й прогін:** 1344 / **1342 pass / 2 fail**, лише відома Windows-база.
- `git diff --check` — чисто. Є лише попередження autocrlf LF→CRLF.

## 18. Що лишається для пізнішої валідації r30

1. Рішення PL щодо S11 / due-фіналізатора (§13).
2. Підтвердження PL переглянутих лімітів розміру `planning-and-focus` (§4).
3. Remote-кроки r30 з окремою авторизацією:
   - sync Skills;
   - створення Agent v30 з body, де `system` + `multiagent: null`;
   - read-back + `release:check`;
   - zero-event Session для spelling.
4. Поведінкова валідація r30 за правилами #46: S9 / S10 / S11 / S41. Факти — pass^3, поведінка — ≥ 2/3, бюджет — docs/04 §27.
5. Пізніше, окремим issue, після зняття rollback-вікна r29: cleanup specialist-runtime / source і архів v4.

## 19. Підтвердження

- Платного інференсу не було: жодних Managed Sessions, benchmark-прогонів чи грейдера.
- Production Agent не оновлювався, remote Agent не створювався.
- Remote Skills не синхронізувались.
- Specialist v4 не архівовано.
- Memory і Trello не змінювались.
- Commit, push і deploy не робились; roadmap не змінювався; #44 не закрито; r31 не створено; serving лишається r29.

Єдиний зовнішній запит — читання публічної документації Multiagent orchestration.

## 20. `git status --short`

```text
 M .claude/skills/planning-and-focus/SKILL.md
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/clientProfile.test.ts
 M src/djonikAgentSource.test.ts
 M src/djonikClient.ts
 M src/planningAndFocus.test.ts
 M src/pmBenchmark.test.ts
 M src/pmBenchmark.ts
 M src/pmFixture.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseAttestation.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releasePlan.ts
 M src/releaseR29.test.ts
 M src/releaseR30Candidate.test.ts
 M src/turnCompletion.test.ts
?? docs/91_ISSUE_44_PROJECT_HEALTH_RETIREMENT_SOURCE_REPORT.md
```
