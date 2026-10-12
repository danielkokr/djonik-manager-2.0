# #68 — Djonik каже, що нагадувань немає: розслідування і звіт

Дата: 2026-10-12. Issue: [#68](https://github.com/danielkokr/djonik-manager-2.0/issues/68) (canonical NOW за `docs/02`). Статус: **source-only, очікує рев'ю Product Owner**. Без commit / push / deploy. Remote Agent, Skills, Session-конфігурація, Memory, Trello і хост не змінювались. Платного inference не було.

## 1. Симптом у production

2026-10-08 Daniel написав у Telegram:

> нагадай мені завтра заповнити звіт в 10 ранку

Djonik відповів, що окремого інструменту нагадувань у нього немає, і запропонував картку Trello з дедлайном або рядок у ранковому брифі о 09:30. Очікувана поведінка за прийнятим #54 — нагадування на 10:00 і підтвердження з кодовим часом.

## 2. Причина

**Класифікація A — release omission.** Інструмент `reminder` із #54 є в коді застосунку, але його ніколи не було в жодному reviewed release. Agent v31, який обслуговує production, його не оголошує. Модель сказала правду про своє оточення: інструменту в неї не було.

Це не баг реалізації нагадувань, не застаріла Session, не суперечлива інструкція і не помилка маршрутизації.

Докази:

| Що | Факт | Джерело |
|---|---|---|
| #54 прийнято як source-only | «Production release r29 / Agent custom-tool sync / hosted live validation remain separate authorized steps» | closeout #54, `docs/82` §12 |
| r29 свідомо без `reminder` | «the dormant #54 `reminder` tool is not exposed» | `src/release.ts`, `releaseR29.test.ts` |
| r30 і r31 теж | `customTools` без `reminder`; тести прямо перевіряють відсутність («#54 reminder stays dormant») | `releaseR30.test.ts:46`, `releaseR31.test.ts:53`, `docs/92` §255 |
| Remote Agent | v28–v31 прочитано: `reminder` немає в жодній версії | read-only GET, 2026-10-12 |
| Вимикач у застосунку | `remindersEnabled = release.customTools.includes("reminder")` → `false` для r31: store не створюється, таймер доставки не працює | `src/telegramCli.ts:143` |

Окремий активаційний крок для `reminder` після #54 так і не став issue: кожен наступний release (r29, r30, r31) переносив позначку «dormant» далі.

## 3. Source, release, remote Agent і Session

Чотири стани перевірено окремо. Вони збігаються між собою.

| Шар | Стан |
|---|---|
| Source intent | `reminder` виконуваний: є в `SUPPORTED_CUSTOM_TOOLS`, у клієнтському роутері, прив'язаний у `telegramCli.ts` |
| Committed release tuple | `SERVING_RELEASE = RELEASE_R31`, Agent v31. `customTools`: `trello_work_history`, `trello_board_snapshot`, `focus_budget`, `trello_project_time` |
| Remote latest Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, остання версія **31**. Ті самі чотири custom tools |
| `release:check -- r31 --serving` | **OK**. Agent v31 точно відповідає tuple |
| Serving Session | `sesn_01A6mcGJDLhF87safsm8mYPF`, створена 2026-10-09 14:21 UTC, v31, app `91d1410`, ті самі чотири tools |
| Session на 2026-10-08 | Найновіша на той день — `sesn_01GGZWULi7oqXVFY3HYMemn4` (2026-10-02, r31, v31, app `91d1410`), теж без `reminder` |

Відповіді на питання Phase 1:

1. `SERVING_RELEASE` — r31.
2. r31 має показувати Agent v31 з чотирма custom tools, без `reminder`.
3. Remote обслуговує саме v31; новішої версії немає.
4. Remote Agent `reminder` **не оголошує**.
5. Fixture r31 `reminder` **не очікує**, і тест це закріплює.
6. `release:check` та атестація узгоджені з remote.
7. Застарілість Session ні на що не впливає: інструменту не було в жодній версії Agent, тож жодна Session його мати не могла. Перевірено 20 Telegram-Session від r27 до r31.
8. Виконуваний handler зареєстрований; роутер віддає `reminder` у свій executor за точним іменем.
9. Природний запит до інструменту дійти не може, бо модель його не бачить.
10. Заборонної інструкції немає. У prompt координатора і в усіх Skills немає слова «remind». Memory-інструкція каже: «Promise a reminder only after the reminder tool saved it».
11. Відповідь у production повністю пояснюється відсутністю інструменту. Prompt вимагає: «Use only what this environment gives you, and say plainly when something is missing».

Stop-умов не було: remote збігається з tuple, API поводиться як очікує репозиторій. Inspection Session не створювалась — вистачило читання Agent і наявних Session.

## 4. Чи потрібні були зміни коду

**Виконуваний код не змінено.** `reminderTool.ts`, `reminders.ts`, `reminderDelivery.ts`, `reminderTime.ts`, роутер, клієнт, prompt, Skills, `src/release.ts` і fixtures лишились як були.

Додано лише регресійне покриття і документи:

| Файл | Що |
|---|---|
| `src/issue68ReminderRegression.test.ts` (новий) | 6 тестів, див. §6 |
| `docs/107_ISSUE_68_REMINDER_CAPABILITY_REGRESSION_REPORT.md` (новий) | цей звіт |
| `docs/02_DEVELOPMENT_ROADMAP.md` | #67 прийнято, #68 — NOW, залежність для #70 |

Виправити production з source неможливо: потрібна нова версія Agent, а це заборонено в цьому issue.

## 5. Семантика #54 збережена

Нічого не перепроєктовано. Тест із production-фразою підтверджує чинну поведінку:

- дата + час → `timed`-нагадування на 2026-10-09 10:00 Kyiv (`dueAt` 07:00Z), без зсуву quiet hours і без перетворення на ранковий бриф;
- підтвердження — кодовий рядок `🔔 Нагадаю завтра, пт 09.10 о 10:00: заповнити звіт`. Якщо модель його не процитувала, код ставить його першим;
- без сховища модель отримує обмежену помилку `unavailable` («nothing was saved»), підтвердження не складається, Trello не викликається.

Date-only, list, cancel, snooze, durable storage, exactly-once і quiet hours не чіпались; їхні 66 тестів проходять.

## 6. Регресійне покриття і перевірки

Нові тести (`src/issue68ReminderRegression.test.ts`):

1. **Причина як факт:** r31 і всі старші releases без `reminder`; вимикач адаптера залежить саме від `customTools`.
2. **Guard:** release або candidate, побудований після Agent v31, не може мовчки пропустити `reminder`. Candidates знаходяться з експортів `release.ts`, тож майбутній `RELEASE_R32_CANDIDATE` потрапить під перевірку автоматично.
3. **Готовність release-механіки:** r31 + `reminder` дає update body, де інструмент байт-у-байт (канонічно) той, що виконує застосунок. Змін у `releasePlan.ts` для цього не треба.
4. **Інструкції:** prompt і Skills не згадують «remind»; маршрутизацію несе опис інструмента, зокрема приклад «день + час».
5. **Production-фраза через реальний `connectToDjonik` → роутер адаптера → реальний executor:** одне виконання, одне нагадування, кодове підтвердження.
6. **Обмежена відмова** без сховища.

Чого тести **не** доводять: що модель перетворить речення Daniel на цей виклик. Це покаже лише живий хід на версії Agent з інструментом.

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `src/issue68ReminderRegression.test.ts` | 6/6 pass |
| Фокусні: reminder (5 файлів), `customToolRouting`, `customToolResolution`, `release*`, `servingRelease`, `djonikAgentSource`, `commitmentContract` + новий файл | 303/303 pass |
| `npm test` | 1542/1544 pass, 2 fail |
| `npm run release:check -- r31 --serving` | OK (read-only) |
| `git diff --check` | exit 0 |

Два падіння — відомі Windows-середовищні, не пов'язані з #68 (ті самі, що в `docs/82`, `docs/106`):

- `deploy script survives replacing itself…` — CRLF у робочій копії `deploy.sh`;
- `a real process that fetched over keep-alive exits by itself…` — код виходу процесу.

Інтермітентний timing-flake `reminderDelivery` у цих прогонах не відтворився.

## 7. Що треба зробити, щоб production запрацював

Кожен крок потребує окремої авторизації Product Owner:

1. Додати `reminder` у `customTools` наступного release candidate.
2. Створити версію Agent з цим інструментом (опис і схема беруться з `REMINDER_TOOL`), прочитати назад і атестувати.
3. Source cutover `SERVING_RELEASE`, оновити `DJONIK_EXPECTED_RELEASE` на хості, deploy.
4. Перевірити на хості, що `$STATE_DIRECTORY` доступний сервісу: без нього інструмент чесно відповідає `unavailable`.
5. Одна жива перевірка в Telegram: production-фраза → підтвердження з 10:00 → повідомлення о 10:00 з кнопками. Варто також перевірити date-only запит.

Після cutover нагадування вмикаються самі: store, таймер доставки і кнопки залежать лише від `customTools`.

Поруч, поза scope #68: 2026-10-08 Daniel обрав «нагадати в ранковому брифі». На r31 такого механізму з гарантією теж немає — це могла бути лише обіцянка моделі або запис у Memory. Варто мати на увазі до активації інструменту.

## 8. Взаємодія з #70 / r32

Це **ще одна release-surface дельта** для наступної версії Agent:

- #70 у поточному формулюванні дозволяє лише новий `work-review` і нову схему `trello_work_history`, а «other custom tools» мають лишитись без змін. Якщо зібрати r32 так, він знову буде без `reminder`.
- Прийнятий #67 теж чекає на версію Agent (зміни Skills `pm-rhythm` і `planning-and-focus`).
- Отже, r32 може нести три дельти одним оновленням: #66, #67 і `reminder` для #68.

Рішення за Product Owner: розширити #70 на `reminder` чи зробити окремий release. Issue #70 я не редагував і r32 не починав.

Важливо: новий guard-тест (п. 2 у §6) **упаде**, якщо `RELEASE_R32_CANDIDATE` буде без `reminder`. Це навмисно — пропуск більше не може статися мовчки. Якщо Product Owner вирішить випустити r32 без нагадувань, поріг `LAST_AGENT_VERSION_WITHOUT_REMINDER` у тесті треба свідомо підняти до 32.

## 9. Обмеження

- Production не виправлено і не валідовано; #68 лишається відкритим.
- Живу поведінку моделі з інструментом не перевірено (заборонено платний inference).
- Точну Session, яка обслуговувала хід 2026-10-08, не встановлювали за подіями: на висновок це не впливає, бо жодна версія Agent інструменту не мала.

## 10. `git status --short`

```text
 M docs/02_DEVELOPMENT_ROADMAP.md
?? docs/107_ISSUE_68_REMINDER_CAPABILITY_REGRESSION_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
?? src/issue68ReminderRegression.test.ts
```

`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` існував до цієї роботи і не змінювався.
