# 105 — Issue #66: source closeout і передача governance на #67

**Статус:** лише документація, очікує review. Без commit, push, deploy, змін `SERVING_RELEASE`, віддаленого Agent/Skills, Trello, Memory і без платної/live перевірки.
**Дата:** 2026-10-12. **HEAD:** `867298ddf0eac7a70eb3185d7ab4131b157034f1` (після нього комітів немає).

## 1. Вердикт

Source на `867298d` відповідає прийнятому звіту [docs/104](104_ISSUE_66_CONCISE_WORK_HISTORY_REPORT.md). Розбіжностей, які зупиняли б closeout, не знайдено. Код #66 я не змінював.

| Що перевірено | Де в source | Результат |
|---|---|---|
| Стислий вивід за замовчуванням | `buildWorkHistoryAnswer`: `detailed` без дозволу клієнта дає стислий текст і `detail_note` лише для моделі | так |
| Хронологія лише на прямий запит | `asksForDetailedHistory` + `turnDetailRequested` у `sendPartsSerial`; дозвіл фіксується за id виклику й діє один хід | так |
| П'ятничний/автоматичний хід не відкриває хронологію | `turnDetailRequested` вимагає `turnAuthority === "human"`; `mutationAuthorityFor` дає `human` лише для `user_message` і `button_callback` | так |
| Вузькі питання про закрите/створене | `focus` → `buildFocusAnswerText`: один дедуплікований список, кількість унікальних карток, без часу й `due` | так |
| Факти й числа рахує код | категорії, дедуплікація й попередження про покриття лишились у коді; exact relay не змінено | так |
| Next-контракт із `focus` | `TRELLO_WORK_HISTORY_TOOL_NEXT`; чинне `TRELLO_WORK_HISTORY_TOOL` не змінено | так |
| Регресійні тести | 9 у `trelloWorkHistory.test.ts`, 4 межові в `turnCompletion.test.ts`, по одному в `customToolRouting` і `workReviewContract` | є |
| #67 і #69 не підмішано | коміт не чіпає `pm-rhythm`, `managed-agents/`, `src/release.ts`, Telegram-рендер; «Перейшло в Done: N» в огляді досі рахує події | так |

## 2. Чому #66 лишається відкритим

Виправлення є тільки в source. Production обслуговує r31 на попередній ревізії застосунку. До закриття лишається:

1. #70 — зібрати й атестувати r32 (нова версія Skill `work-review` і Agent v32 з `TRELLO_WORK_HISTORY_TOOL_NEXT`, разом в одній версії Agent);
2. окремо авторизований source cutover і deploy на Hetzner;
3. перевірка Daniel у Telegram за списком docs/104 §8.

Сам деплой застосунку на r31 уже прибрав би дамп подій, але його теж не було. Точний зріз за `focus` модель зможе запросити лише на r32.

## 3. Змінені файли

| Файл | Зміна |
|---|---|
| `docs/02_DEVELOPMENT_ROADMAP.md` | один update-абзац від 2026-10-12; рядок #66 → «source accepted, issue open»; нові рядки #67 (NOW), #68–#71 (queued) |
| `docs/104_ISSUE_66_CONCISE_WORK_HISTORY_REPORT.md` | рядок статусу: прийнято на `867298d`; попередній стан збережено як історичний |
| `docs/105_ISSUE_66_SOURCE_CLOSEOUT_REPORT.md` | цей звіт |

Абзац roadmap від 2026-10-09 лишився без змін як історичний запис; новий абзац явно його заміщує.

## 4. Стан governance після зміни

- **NOW:** #67 (єдиний рядок із позначкою NOW).
- **Source accepted, issue open:** #66.
- **Queued, у такому порядку:** #68 → #69 → #70 → #71. Кожен стає NOW лише окремим оновленням roadmap.
- **Паралельно:** #35, пілот реального використання.

## 5. Перевірки

| Перевірка | Результат |
|---|---|
| `git diff --stat 867298d HEAD` | порожньо: HEAD і є прийнятий коміт |
| `npx tsc --noEmit` | без помилок |
| `node --import tsx --test` для `trelloWorkHistory`, `turnCompletion`, `customToolRouting`, `workReviewContract`, `releaseR31` | 128 тестів: 128 pass, 0 fail |
| `SERVING_RELEASE` у `src/release.ts` | `RELEASE_R31`, не змінено |
| `git diff --check` | чисто (exit 0) |
| `git diff` | лише два файли в `docs/` |

Повний `npm test` не запускав: source не змінювався. Платного inference, Telegram і звернень до віддаленого Agent не було.

## 6. Зауваги й ризики

- **Дефолт політики у двох місцях різний.** `executeTrelloWorkHistory` закритий за замовчуванням (`detailRequested: false`), і production та benchmark CLI йдуть тільки через нього. Але `buildWorkHistoryAnswer` і `TrelloWorkHistoryClient.execute` при прямому виклику без політики мають `detailRequested: true`. Зараз таких викликів поза тестами немає, тож це не регресія; новий прямий виклик обійшов би шлюз. Варто врахувати в #70, коли зачіпатиметься цей модуль.
- **`button_callback` має авторитет `human`.** Якщо текст ходу від кнопки колись міститиме слово на кшталт «детально», він дасть дозвіл на хронологію. Зараз таких кнопок немає.
- **Залежність від #69** зі звіту docs/104 чинна: огляд і зріз `completed` можуть показати різні числа за один тиждень (події проти унікальних карток).
- **Два падіння в повному наборі** з docs/104 (`deploy script survives replacing itself…`, `processExit.test.ts`) я не перевіряв повторно.
- У roadmap #70 стоїть після #69 за рішенням Product Owner, тож production-виправлення #66 чекає на #67–#69.

## 7. `git diff --stat`

```
 docs/02_DEVELOPMENT_ROADMAP.md                   | 9 ++++++++-
 docs/104_ISSUE_66_CONCISE_WORK_HISTORY_REPORT.md | 3 ++-
 2 files changed, 10 insertions(+), 2 deletions(-)
```

## 8. `git status --short`

```
 M docs/02_DEVELOPMENT_ROADMAP.md
 M docs/104_ISSUE_66_CONCISE_WORK_HISTORY_REPORT.md
?? docs/105_ISSUE_66_SOURCE_CLOSEOUT_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` був неверсіонованим до початку роботи; я його не змінював.
