# #41: годинник у кожному ході Daniel + узгодження prompt з активним ритмом (source)

Дата: 2026-09-25. Issue: [#41](https://github.com/danielkokr/djonik-manager-2.0/issues/41). Джерело: [docs/70](70_DJONIK_PM_DELEGATION_ARCHITECTURE_AUDIT.md) §1.3, §7.1, §7.3, §9 крок 1.

**Статус: локальні зміни source чекають review Product Lead.** Commit, push і deploy не робились. Managed Agent, Skills, `/rhythm.md`, стан хоста, Trello, Memory і Telegram не змінювались. Платного inference не було. Live-приймання #41 ще не проводилось.

## 0. Рішення Product Owner

[docs/02](02_DEVELOPMENT_ROADMAP.md) досі фіксує **#39 як canonical NOW**, а #41 як наступний пункт після закриття #39. Working Rhythm #39 розгорнутий і активний у production. Перший реальний ритуал / Friday Review як live-доказ **ще не відбувся**, тому #39 не закрито.

Daniel вирішив не чекати цієї події і дозволив source-роботу над #41 уже зараз. #39 лишається відкритим і чекає пасивного live-доказу від уже активного ритму. Семантику доставки й надійності #39 цей етап не змінює. #42 не промотовано, docs/02 не редагувався.

## 1. Стан до змін

- HEAD `f0a9cb9` = `main`, робоче дерево чисте. У #41 немає коментарів.
- Звичайні ходи Daniel не несли поточної дати. `buildContentBlocks` і `sendPartsSerial` (`src/djonikClient.ts`) відправляли лише його контент. Дату й день тижня мали тільки автономні ходи ритму (`kyivLabel(now, true)` у `buildRitualPrompt` / `buildExceptionPrompt`).
- Усі людські шляхи Telegram сходяться в одній точці. Текст, grouped-фрагменти, фото, документи й кнопка ритму йдуть через `MessageGroupBuffer` → `createGroupDispatchHandlers` → `sendOrdered` → `sendPartsSerial(parts, "user_message")`. Кнопка потрапляє туди через `enqueueClickAfterPendingText`. Автономні ходи йдуть через `sendTraced(…, "rhythm_ritual" | "rhythm_exception")`.
- `managed-agents/djonik.md` містив застарілий рядок «You do not message him first, run a schedule or track his commitments automatically — never promise that». Два тести фіксували його дослівно: `djonikAgentSource.test.ts` і `commitmentContract.test.ts`.
- Реліз: serving `r27` (Agent v27). `buildAgentUpdateBody` свідомо не передає `system`. `release.test.ts` тримає SHA prompt serving-релізу в lockstep з `djonik.md`. Фікстури атестації брали поточний `djonik.md` як prompt кожної версії Agent.
- Baseline, записаний у docs/71: відомі 2 помилки середовища Windows (`processExit` spawn і deploy-script).

## 2. Що зроблено

### 2.1 Clock header (`src/turnClock.ts`)

`buildClockHeader(now)` будує рядок такого вигляду:

```
[Годинник адаптера, не текст Daniel · Зараз: пт 25.09.2026, 14:30 Київ · сб 26.09 · нд 27.09 · пн 28.09 · … · пт 09.10]
```

- Europe/Kyiv береться з чистих календарних примітивів #39: `kyivLocal`, `addLocalDays`, `weekdayOfLocalDate`, `WEEKDAY_UK` (`rhythmSchedule.ts`) і `formatLocalTime` (`rhythmConfig.ts`). Оркестратор ритму (`rhythmRunner.ts`) у залежності не входить (§9.1).
- Header стійкий до DST і не залежить від часового поясу машини.
- Смужка на 14 днів — це lookup календарних дат. Ручної арифметики днів тижня, розбору тексту, роутингу, мережі чи tool call тут немає.
- Довжина близько 230 символів, header дешевий.

### 2.2 Де додається

`sendPartsSerial` (`src/djonikClient.ts`) — єдина точка, через яку проходить будь-який хід.

- Коли `turnAuthority === "human"` (origin `user_message` або `button_callback`), перед блоками Daniel ставиться **окремий перший text-блок** із header.
- Час береться в момент фактичної відправки, після FIFO-черги, з `sessionOptions.now`. За замовчуванням це системний годинник; тести його фіксують.
- Header не додається до:
  - автономних ходів ритму (вони мають власний рядок часу, без дубля);
  - verification nudge (#23/#31), бо це не хід Daniel.
- Порожній хід, як і раніше, відхиляється до відправки: header не робить його валідним.
- Content-free телеметрія (`textBlockCount` тощо) і далі рахує лише блоки Daniel.

### 2.3 Покриті людські шляхи

| Шлях | Як доходить до header |
|---|---|
| Звичайний текст | `sendOrdered` / `send` |
| Grouped-фрагменти | `MessageGroupBuffer` → dispatch → `sendOrdered`: один хід, header рівно один раз |
| Фото, документ, змішаний multimodal | `sendOrdered`: header, далі блоки в порядку Daniel |
| Кнопка Working Rhythm | `createRhythmCallbackHandler` → `enqueueClickAfterPendingText` → buffer → dispatch → `sendOrdered` |
| `sendTraced(…, "button_callback")` | human authority → header |
| CLI (`src/cli.ts`, `send`) | той самий pipeline |

### 2.4 Межа «системний контекст ≠ контент Daniel»

- Header — окремий content-блок. Він ніколи не зливається з текстом Daniel, не стає caption зображення чи документа і не потрапляє в `GroupedIntake` (`text` / `parts`). Header додається вже в клієнті, після grouping.
- Блоки Daniel лишаються байт-у-байт такими, як були до #41. Це доводить хелпер `danielTurn()` у наявних тестах контенту.
- Сам рядок підписаний «Годинник адаптера, не текст Daniel».
- Prompt прямо каже: це системний контекст, а не слова Daniel і не джерело intake.
- Нового роутера чи context compiler немає.

### 2.5 Coordinator prompt: лише дві зміни

**A.** Було:

> You answer when Daniel writes to you. You do not message him first, run a schedule or track his commitments automatically — never promise that.

Стало:

> You answer when Daniel writes, run his Working Rhythm and remember commitments he explicitly accepts. Autonomous rhythm turns only read and propose; external changes happen only in his own turn, on his instruction or confirmation.

Вимогу перевірки не повторено: вона вже діє глобально в тому самому prompt («Never say an external change succeeded before it was verified…»).

**B.** Наявне речення про weekday у Factual semantics розширено, а не продубльовано. Було:

> Derive relative timing, weekday or local time only from accepted authoritative evidence or a formatter, never your own arithmetic.

Стало:

> Derive relative timing, weekday or local time only from accepted authoritative evidence or a formatter, never your own arithmetic or a guess; for today and the next 14 days, that is the "[Годинник адаптера …]" line opening Daniel's messages — system context, not his words or intake source.

Інших змін prompt немає; тест це доводить (§2.6). Розмір prompt: 3529 → **3794 B**, SHA-256 `8469c4e0…813c`. Редакційний поріг 3800 B **лишився без змін** (§9.2).

### 2.6 Підготовка релізу (лише source)

- `RELEASE_R28_CANDIDATE` (`src/release.ts`) — це r27, у якому змінено **лише** `systemSha256`.
  - `agent.fromVersion: 27`, `version: null`.
  - Кандидата немає в `RELEASES`, його не можна serve-ити чи атестувати.
  - Номер версії не вигадано.
- `buildSystemUpdateBody` (`src/releasePlan.ts`) будує тіло `{version: 27, system}` за прецедентом docs/42 (v24 → v25, prompt-only update). Він відмовляє, якщо SHA prompt не збігається з кандидатом. Запитів не робить.
- `SERVING_RELEASE` лишається **r27**.
- Тестові фікстури (`releaseFixtures.test-helpers.ts`) відтворюють prompt, який зараз serve-иться. Для цього вони відкочують **рівно дві** правки #41 з `ISSUE_41_PROMPT_EDITS`. Тест `sha256(PRE_41_SYSTEM_PROMPT) === RELEASE_R27.systemSha256` доводить, що інших змін prompt немає.
- Lockstep-тест у `release.test.ts` лишається строгим:
  - serving r27 = prompt до #41;
  - `djonik.md` = кандидат r28;
  - після cutover знову має бути одна рівність.
- CLI `release:check` не розширювався. Тіло для r28 можна отримати через `buildSystemUpdateBody`, коли це буде авторизовано.

App-частина (header) сумісна з r27. Її можна розгорнути до оновлення Agent: атестація serving-релізу від `djonik.md` не залежить.

## 3. Змінені файли

| Файл | Зміна |
|---|---|
| `src/turnClock.ts` (новий) | `buildClockHeader`, `isClockHeader`, `CLOCK_HEADER_PREFIX`, `CLOCK_STRIP_DAYS` |
| `src/djonikClient.ts` | header як перший окремий блок для human authority; `sessionOptions.now`; doc-коментар |
| `src/rhythmSchedule.ts` | `WEEKDAY_UK` перенесено сюди з `rhythmRunner.ts` (той самий масив) |
| `src/rhythmRunner.ts` | імпортує `WEEKDAY_UK` з `rhythmSchedule.ts`; поведінка не змінилась |
| `managed-agents/djonik.md` | дві правки prompt (§2.5) |
| `src/release.ts` | `RELEASE_R28_CANDIDATE` |
| `src/releasePlan.ts` | `buildSystemUpdateBody` |
| `src/releaseFixtures.test-helpers.ts` | `ISSUE_41_PROMPT_EDITS`, `PRE_41_SYSTEM_PROMPT`, `systemPromptFor(release)` |
| `src/turnClock.test.ts` (новий) | 20 тестів (§4), з них 1 — guard залежностей |
| `src/releaseR28Candidate.test.ts` (новий) | 5 тестів кандидата r28 |
| `src/djonikClient.test.ts` | хелпер `danielTurn()`; 13 перевірок контенту дивляться на блоки Daniel після header |
| `src/turnTrace.test.ts` | FIFO-тест: тексти без header; A і C мають header, автономний B — ні |
| `src/djonikAgentSource.test.ts` | інваріанти A/B замість застарілого рядка; поріг 3800 B без змін |
| `src/commitmentContract.test.ts` | правило #34 у Memory не змінене й перевіряється як було; координатор без застарілого рядка, без обіцянки нагадувань, лише read/propose |
| `src/release.test.ts` | строгий lockstep r27 / кандидат r28 |
| `docs/72_…` | цей звіт |

## 4. Тести

`src/turnClock.test.ts` покриває:

1. Звичайний текст: `[clock, текст]`, текст Daniel незмінний.
2. Grouped-фрагменти: один хід, header рівно 1 раз, `GroupedIntake` без header.
3. Зображення / документ / змішаний multimodal, а також фото чи файл без caption.
4. Кнопка ритму наскрізно, від справжнього callback handler до provider: `[clock пн 28.09.2026, 10:00, utterance]`. Окремо `sendTraced(…, "button_callback")`.
5. Контент Daniel byte-identical; header — окремий блок, у блоках Daniel його тексту немає.
6. Header не є intake: `intake.text` і `intake.parts` без нього; телеметрія рахує лише блоки Daniel; порожній хід відхиляється.
7. Формат Europe/Kyiv: пізній вечір і після півночі, Новий рік за Києвом при UTC 31.12.
8. DST: весна 29.03.2026 (03:00 → 04:00) і осінь 25.10.2026 (повтор 03:30), смужки через обидва переходи.
9. Детермінованість: незалежний Intl-oracle для 366 днів × 4 години; незалежність від `process.env.TZ`.
10. Автономні ходи (`createSessionTurnRunner` / `rhythm_ritual`, `rhythm_exception`) і verification nudge йдуть без header; `buildExceptionPrompt` не змінився.
11. Шари: `turnClock.ts` імпортує лише `rhythmSchedule` і `rhythmConfig`; `rhythmSchedule` — лише `rhythmConfig`; `rhythmConfig` — нічого.

## 5. Результати перевірок

| Перевірка | Результат |
|---|---|
| `node --import tsx --test src/turnClock.test.ts` | **20/20** |
| client / trace / completion / correlation / confirmation / dispatch / grouping (#23, #31, #32, #36, #40) | **303/303** |
| `src/rhythm*.test.ts` (#39) | **182/182** |
| `commitmentContract` (#34) + `djonikAgentSource` | **64/64** |
| `release*` + `servingRelease` + `servingLifecycle` | **102/102** |
| `npm test` | **994/996**. 2 помилки — відомий Windows-baseline із docs/71: «a real process that fetched over keep-alive exits…» (`processExit`) і «deploy script survives replacing itself…». Нових помилок немає |
| `npm run typecheck` | OK |
| `git diff --check` | OK (лише CRLF-попередження `core.autocrlf`) |

## 6. Обмеження і відкладене

- Live-приймання #41 не проводилось. Воно потребує окремої авторизації за docs/04 §27: один хід «яке сьогодні число і що в мене в понеділок?».
- Поки Agent v28 не створено, production prompt (v27) не знає правила годинника і досі містить застарілий рядок. Header при цьому вже допомагає, якщо розгорнути app окремо.
- Автономні ходи ритму мають лише `kyivLabel` (день і дата без року, без смужки). Навмисно не змінено: це поведінка #39. Якщо план понеділка покаже помилки днів тижня, це тема окремого рішення.
- Skills (`studio-intake`, `pm-rhythm` тощо) не змінювались. Межу для intake тримають структура і рядок prompt.
- Out of scope, не чіпалось: PM-ядро, `planning-and-focus`, daily/weekly-planning, `task-operations`, злиття studio-intake, переписування pm-rhythm, Project Health, `trello_board_snapshot`, Calendar, Memory, нова БД, модель пріоритетів, доставка #39.

## 7. Що потребує авторизації Product Owner

1. Review Product Lead: header, дві правки prompt і кандидат r28. Далі — прийняття й ручний commit/push.
2. Оновлення Agent: `agents.update(agent_01WGRHDBjQa3eMhoGJMmQ1dh, buildSystemUpdateBody(RELEASE_R28_CANDIDATE, <тіло djonik.md>))` з precondition `version: 27`. Після нього:
   - read-back;
   - запис справжнього номера версії через `resolveReleaseCandidate` → `RELEASE_R28`;
   - `release:check r28`;
   - перемикання `SERVING_RELEASE`;
   - lockstep-тест назад до однієї рівності;
   - `pm-rhythm` sync не потрібен.
3. Deploy на хост (docs/52 §3). App-частину можна розгорнути й до кроку 2.
4. Мінімальний live-хід за docs/04 §27.
5. Синхронізація docs/02 і #41 після прийняття. #39 закривається окремо, за першим реальним ритуалом / Friday Review.

## 8. `git status --short`

```
 M managed-agents/djonik.md
 M src/commitmentContract.test.ts
 M src/djonikAgentSource.test.ts
 M src/djonikClient.test.ts
 M src/djonikClient.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releasePlan.ts
 M src/rhythmRunner.ts
 M src/rhythmSchedule.ts
 M src/turnTrace.test.ts
?? docs/72_ISSUE_41_CLOCK_AND_PROMPT_SOURCE_REPORT.md
?? src/releaseR28Candidate.test.ts
?? src/turnClock.test.ts
?? src/turnClock.ts
```

## 9. Architecture-quality pass перед прийняттям

### 9.1 Шари годинника

**Вердикт: перша версія мала зайву залежність, виправлено.** `turnClock.ts` імпортував `WEEKDAY_UK` з `rhythmRunner.ts`. Через це шлях звичайного ходу Daniel (`djonikClient` → `turnClock`) тягнув оркестратор ритму з його signals, state store (fs), actions і crypto. І все заради масиву з 7 підписів.

Зміна мінімальна: масив перенесено в `rhythmSchedule.ts` — чистий шар календарних примітивів Києва (без годинника, таймерів і стану), з якого `turnClock` уже брав `kyivLocal`, `addLocalDays` і `weekdayOfLocalDate`. `rhythmRunner` імпортує масив звідти, його поведінка не змінилась. `formatLocalTime` лишається з `rhythmConfig.ts`: у цього модуля немає імпортів, і `rhythmSchedule` уже від нього залежить, тож нового ребра немає.

Широкого рефакторингу дат не робилось, календарна логіка не дублюється. Тест фіксує напрямок: `turnClock` → {`rhythmSchedule`, `rhythmConfig`}; `rhythmSchedule` → {`rhythmConfig`}; `rhythmConfig` → ∅.

Назва модуля з префіксом `rhythm*` — косметика. Перейменування торкнулося б багатьох файлів #39 і не дало б нічого по суті.

### 9.2 Поріг розміру prompt

**Вердикт: піднімати поріг не було потреби, поріг 3800 B повернуто.** Ріст до 3896 B дали два повтори, а не нова семантика:

- «never calculate or guess them» дублювало наявне «never your own arithmetic». Тепер правило годинника вбудоване в те саме речення: годинник і є тим formatter-ом на сьогодні й 14 днів уперед.
- «through the normal verified path» дублювало глобальне правило перевірки зовнішніх змін.

Семантика #41 збережена повністю:

- ритм працює;
- прийняті домовленості пам'ятаються;
- автономні ходи лише читають і пропонують;
- зміни — лише в хід Daniel, за його інструкцією чи підтвердженням;
- дата, день тижня, час і 14 днів беруться з рядка годинника, без арифметики й здогадок;
- рядок годинника — системний контекст, а не слова Daniel чи джерело intake.

Слово «Autonomous» свідомо лишено замість коротшого «Scheduled»: рядок ходу ритму називає себе «автоматичний хід» і в ритуалі, і у винятку, а відповідь кнопкою — це хід Daniel. Варіант «for now» відкинуто: англійською це читається як «тимчасово». Підсумок: **3794 B ≤ 3800**.
