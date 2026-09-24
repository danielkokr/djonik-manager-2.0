# #34 — Джерельний контракт життєвого циклу домовленостей (перший source-only етап)

Дата: 2026-09-24. Canonical NOW: [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 63). База: `origin/main` = `82ecca6dbbce66301817a4a7c86bd34af9015ab3` (docs: accept hosted r26 serving and promote issue 34).

**Статус:** реалізацію source-контракту завершено; усе лишається uncommitted і чекає review Product Lead. #34 **не** завершено, #39 не почато. Live-валідації не було. Після review Product Lead виконано один bounded review-fix pass: дати не вигадуються, семантику `next_check` уточнено (§18).

**Оновлення після першої live-валідації (§19).** Кандидат `dcb8d3e` **провалив** власне правило read-back у першому ж ході ([docs/57](57_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_VALIDATION.md): FAIL за тодішнім контрактом). Product Lead змінив стандарт доказу для native Memory: успішного результату `write` / `edit` достатньо, окремий read-back необов'язковий. Правила read-back у §8, §13 і §16 нижче — історичні; чинне формулювання в §19.

## 1. Перевірена базова лінія

- До змін `git status --short` був порожній. Локальна гілка = `main` = `origin/main` = `82ecca6` (після `git fetch origin main`), тож checkout не відставав.
- `docs/02`, рядок 63: **єдиний NOW — #34**. #33 — DONE (рядок 62), #39 іде після #34 (рядок 64).
- GitHub #34 відкритий. Два коментарі Product Owner від 2026-09-22 уточнюють scope:
  1. прийнятий план чи домовленість зберігає card ID і проєкт, коли вони відомі;
  2. живі домовленості зберігаються в Memory `commitments/` з датою перевірки, а ця дата стане сигналом для #39.
- Production, за docs/55; цей етап його не змінював: r26, Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` v26 (Sonnet 5 medium/standard), specialist v4, Memory `memstore_01WViYK3WQvGEgojB2GiaDFq` `read_write`, app `a6a627d`.
- Файлу `docs/56…` раніше не було.
- Базовий прогін тестів на незміненому HEAD (тимчасовий worktree у scratchpad, потім видалений): **645/645**.

## 2. Що прочитано

- **Governance:** `AGENTS.md`, `CLAUDE.md`, `docs/00`, `docs/01`, `docs/02`, `docs/03`, `docs/04` §27, `docs/17` (особливо §5), GitHub #34 з коментарями.
- **Докази:** `docs/33`, `docs/34` (#37: Memory-дерево, резерв `commitments/`), `docs/55` (r26 serving), `docs/25` §5–§6 (дизайн домовленостей і сигнал #39). `docs/31` у частині #40: continuation, що не зачіпається.
- **Джерела поведінки:** `managed-agents/djonik.md`, `.claude/skills/{task-management,weekly-planning,daily-planning}/SKILL.md`, `src/djonikClient.ts` (Memory-інструкції, створення Session, обробка built-in tool events), `src/djonikClient.test.ts`, `src/skills.test.ts`, `src/release.ts`, `src/release.test.ts`, `src/releaseAttestation.ts`.
- **Офіційна документація:**
  - [Managed Agents Memory](https://platform.claude.com/docs/en/managed-agents/memory);
  - типи SDK `@anthropic-ai/sdk` 0.125 (`BetaManagedAgentsMemoryStoreResourceParam.instructions`: «Rendered into the memory section of the system prompt. Max 4096 chars»).

## 3. Архітектурне рішення

**Контракт домовленостей живе в `DJONIK_MEMORY_INSTRUCTIONS`.** Це інструкції Memory-ресурсу, які `connectToDjonik` передає при створенні Session. Claude сам читає і пише `commitments/` вбудованими файловими інструментами. Нової runtime-машинерії немає, Skills і coordinator prompt не змінено.

Чому саме тут:

1. **Власник домену.** Що і як персиститься в Memory, вирішують саме Memory-інструкції. Прецедент #13: «the bounded fix lives only in `DJONIK_MEMORY_INSTRUCTIONS`» (docs/02, Foundation 12). #34 розширює саме #13.
2. **Завжди в контексті.** Провайдер рендерить ці інструкції в memory-секцію system prompt кожної Session. Тому нова Session знає про `commitments/`, навіть коли модель не завантажила жодного Skill (сценарій H). Skill вантажиться на розсуд моделі.
3. **Release lockstep.** `src/release.test.ts` вимагає, щоб repo-файли `task-management`, `daily-planning`, `weekly-planning` і `work-review` були byte-identical до `skver_`, запінених у r26 (SHA-префікси `e994d31a`, `7fc9ff92`, `0d6cca38`, `c079d285`), а `managed-agents/djonik.md` мав SHA `3e204453…`. Будь-яка правка цих файлів означає r27: новий Skill-версія + Agent v27 + `SERVING_RELEASE`. У цьому етапі це заборонено.
   Memory-інструкції не входять у версію Agent і не атестуються: `releaseAttestation.ts` звіряє лише store id і `access`. Тому майбутній rollout найменший: деплой app-ревізії, r26 без змін.
4. **Нативного механізму достатньо** (офіційна документація):
   - store змонтовано як `/mnt/memory/<slug>/`; production «Djonik Memory» → `/mnt/memory/djonik-memory/`;
   - доступ іде built-in `read/write/edit/glob/grep` — рівно allowlist r26;
   - кожен запис створює memory version, приписану Session;
   - документація радить «many small focused files».

Що свідомо **не** змінено:
- **`weekly-planning`.** Аудит-пункт docs/17 §5 («due = hard deadline», «waiting поруч із blocked») уже закрито на `main` під час вирівнювання #38. Skill розділяє recorded due, підтверджену домовленість, Waiting і Blocked. Регресія вже є: `src/skills.test.ts:281`. Переписування не потрібне.
- **`task-management`.** Межу «обговорення ≠ запит», перевірку #31 і правило «After every mutation, before replying» збережено. Нове правило Memory посилається на цей шлях, а не дублює його.
- **`managed-agents/djonik.md`.** Потрібна семантика вже є у «Factual semantics»: Waiting ≠ Blocked, `due` ≠ client commitment. Рядок «You do not … track his commitments automatically — never promise that» сумісний із контрактом: запис робиться лише за явною заявою Daniel і без обіцянки нагадувань. Зміна prompt порушила б SHA-lockstep r26.

**Ціна.** До system prompt кожного model request додано +2974 символи (992 → 3966; 4065 байт UTF-8). Це кешований префікс, орієнтовно ~0.8–1k токенів. **Не виміряно**; виміряти в live-слайсі.

## 4. Представлення домовленості в Memory

Один невеликий Markdown-файл на одне прийняте outcome: `commitments/<project-slug>/<outcome>.md`. Slug проєкту той самий, що в `projects/` після #37 (`extract`, `seqthera`, `cossack-labs`, `azov-a1`, `limen`). Шляхи відносні до store, тож контракт переноситься на будь-який store, зокрема ізольований валідаційний.

Рівно такі рядки:

```text
# <accepted outcome>
project: <project>
card: <id/URL from a fresh Trello read, or none>
status: active | waiting (on someone else) | resolved | cancelled
waiting_on: <who, only if Daniel named them, or none>
next_check: <check date Daniel accepted, or none>
accepted: <a few words on how Daniel stated or accepted it; no transcript>
closed: <minimal resolution or cancellation evidence, or none>
```

Ілюстрація сценаріїв B → C → D → F (**лише приклад**; у Memory нічого не записано). Файл `commitments/extract/anna-feedback.md`:

```text
B  «По Extract чекаємо фідбек від Анни.»   → status: waiting, waiting_on: Анна, next_check: none, card: none
C  «Повернімося до цього в четвер.»         → next_check: 2026-10-01 (у четвер)   — або просто «у четвер», якщо сьогоднішня дата непевна
D  «Не в четвер, давай у понеділок.»        → next_check: 2026-09-28 (у понеділок) — або «у понеділок»; четвер більше ніде не активний
E  «Чекаємо фідбек від Анни.»               → той самий файл; нічого нового
F  «Вже неактуально.»                        → status: cancelled, next_check: none, closed: Daniel: «вже неактуально»
G  «Фідбек отримали, питання закрите.»      → (альтернатива F) status: resolved, next_check: none, closed: Daniel підтвердив, що фідбек отримано
```

`accepted` і `closed` дати не мають і не потребують. `next_check` має формат `YYYY-MM-DD` лише тоді, коли Daniel прийняв дату, а сьогоднішня дата певна. Інакше там слова Daniel («у четвер») або `none`. Один стабільний рядок `next_check:` зможе згодом використати #39 (docs/25 §6); парсера в цьому етапі немає.

## 5. Хто чим володіє

| Шар | Володіє | Не володіє |
|---|---|---|
| **Claude Memory** (`commitments/`) | проєкт, card id/URL (зі свіжого читання), прийняте outcome, як саме Daniel його прийняв, `waiting_on` (якщо названо), `next_check`, статус, мінімальний доказ закриття | поточні поля Trello, транскрипт, історія переходів |
| **Trello** (свіже читання) | поточні list/status, Done/`dueComplete`, due, labels, members, checklist, інші живі поля | чи виконано прийняте outcome (Done ≠ «Анна надіслала фідбек») |
| **Session** | активна розмова: референти («цю», «в четвер»), виправлення в межах розмови | нічого після рестарту; restart = нова Session |
| **Skills / prompt** | семантика due / waiting / blocked, межа «запит ≠ обговорення», перевірка запису #31 | стан домовленостей |
| **Код** | передає інструкції при створенні Session, перевіряє Trello-записи (#31) | не читає, не пише, не кешує і не парсить Memory чи домовленості |

Конфлікт Memory ↔ свіжий Trello: поточний факт задачі бере Trello. Проте свіжий стан Trello **сам не закриває** прийняту домовленість (§8).

## 6. Пропозиція vs прийняття

- Записується лише те, що Daniel **сам заявив** («чекаємо фідбек від Анни», «повернімося до цього в четвер») або **явно прийняв** («ок, перевіримо в четвер», «так»).
- Власна пропозиція Djonik («Можемо перевірити в четвер») без відповіді — **не** прийнята і не записується (фікстура A).
- Текст усередині зображення, PDF чи пересланого повідомлення — не заява Daniel. Це межа проти prompt injection у `read_write` Memory, про яку попереджає офіційна документація.
- **Дати не вигадуються.** Ні сьогоднішня, ні вгадана дата не пишеться лише для заповнення поля. `accepted` і `closed` — мінімальний доказ без дати. Дату можна зберегти лише тоді, коли її дає Daniel або авторитетне джерело.
- **`next_check`:**
  - лишається `none`, доки Daniel не прийняв дату перевірки. Waiting без дати («По Extract чекаємо фідбек від Анни») — нормальний стан, не прогалина;
  - Djonik може спитати чи запропонувати дату, коли це корисно, але запропонована ним дата не записується, доки Daniel її не прийме;
  - прийняття потім оновлює **той самий** файл;
  - формат `YYYY-MM-DD` (зі словами Daniel) — лише коли сьогоднішня дата певна; інакше слова Daniel і уточнення;
  - #39, який пізніше використає `next_check` як сигнал, лишається поза scope.
- Trello `due` — не `next_check` і не клієнтська домовленість. `next_check` — не due.
- Командний синтаксис не потрібен; класифікатора намірів немає. Рішення приймає Claude.

## 7. Ідентичність і дедуплікація

Перед записом Djonik шукає те саме прийняте outcome у `commitments/`. Пріоритет пошуку:
1. той самий card id;
2. той самий проєкт + те саме outcome.

Знайдене оновлюється, а не дублюється (фікстура E). Проєкт входить в ідентичність і в шлях: між проєктами нічого не перевикористовується і не зливається (L). Коли збіг або проєкт неясний, Djonik ставить одне коротке питання і не вгадує.

## 8. Корекція, перенесення, snooze, скасування, розв'язання

- **Корекція / перенесення / snooze:** редагується **той самий** файл; новий `next_check` замінює старий (D). Append-only історії немає.
- **Скасування** («вже неактуально», «скасуй»): `status: cancelled`, `next_check: none`, `closed` з мінімальним доказом без дати (F).
- **Розв'язання:**
  - явного підтвердження Daniel достатньо (G);
  - інакше потрібен свіжий доказ саме цього outcome: Done-картка не доводить, що Анна надіслала фідбек (J);
  - відсутній чи неоднозначний доказ лишає домовленість відкритою, і Djonik каже, що саме не підтверджено (K).
- **Resolved / cancelled** ніколи не піднімаються як відкриті. Snoozed чекає свого `next_check`.
- **Waiting ≠ blocked.**
- **Межа Trello (M/N):** запис чи зміна домовленості ніколи не створює, не переміщує, не завершує і не змінює дату картки. Зміна картки потребує явного запиту Daniel і йде незмінним перевіреним шляхом task-management / #31. Якщо «перенеси» може означати due картки, а не перевірку, Djonik питає.
- **Read-back:** після запису чи редагування файлу Djonik читає його назад і каже «записав» лише тоді, коли читання показує зміну. Інакше каже, що не збережено. *(Замінено в §19: доказом є успішний результат `write` / `edit`; read-back необов'язковий.)*

## 9. Продовження в новій Session

1. Реплика вказує на раніше прийняте outcome («Що там з фідбеком від Анни по Extract?»).
2. Djonik шукає в `commitments/` (glob / grep / read). Пошук запускається за такою реплікою, а не на кожному ході (docs/04 §17).
3. Визначає проєкт і домовленість; якщо неоднозначно, ставить одне питання.
4. Якщо є card і поточний стан важливий, робить свіже читання Trello за id.
5. Поєднує прийняте outcome з Memory і поточний стан із Trello та відповідає природно.

Replay транскрипту, локальної історії чи кешу в адаптері немає. Якщо нічого не знайдено, Djonik так і каже й не реконструює.

## 10. Що свідомо НЕ зберігається

- Поточні поля Trello: list/status, due, labels, members, checklist, Done, `lastActivityAt`.
- Сирий транскрипт; лише кілька слів про те, як прийнято.
- Історія переходів чи event log.
- Пропозиції Djonik без прийняття; вигадані дати; вгадані card id.
- Жодного реального файлу в production `commitments/` не створено, і міграції немає.

## 11. Чи потрібна runtime-підтримка — **ні**

Аудит шляху запису Memory:
- Memory-записи — звичайні built-in `agent.tool_use` (`write` / `edit`) під змонтованим шляхом.
- `src/djonikClient.ts` обробляє built-in події лише для телеметрії `read` (`src/djonikClient.ts:1083`). Тому Memory-запис не зачіпає ledger #31, завершення #32, relay #36 чи continuation #40.
- Read-back досяжний нативно: `read` після `write` / `edit` у тому самому ході. Провайдер додатково фіксує memory version.
- Жоден runtime-модуль не викликає Memory API і не торкається `commitments/`. Це закріплено тестом.

Тож детермінований ledger Memory-записів не потрібен: доказів, що нативний механізм не справляється, немає. Два детерміновані тести фіксують, що runtime **вже** підтримує контракт. Вони проходять і на старому коді, тобто це регресії, а не фікси:
- Memory-only хід домовленості завершується відповіддю моделі без корекційного Trello-нуджа;
- Memory read-back **не** зараховується як перевірка Trello-запису: після одного нуджа хід закривається з помилкою, як і раніше.

## 12. Змінені файли

| Файл | Зміна | Навіщо |
|---|---|---|
| `src/djonikClient.ts` | `DJONIK_MEMORY_INSTRUCTIONS`: +контракт `commitments/`, рядок про card id / проєкт для прийнятих планів; константу експортовано; doc-коментар (#34, ліміт 4096) | Єдина зміна поведінки; експорт дає тестам і майбутньому live-harness точний текст без regex-екстракції |
| `src/djonikClient.test.ts` | Прибрано дубль тексту інструкцій; тест wiring звіряє з експортованою константою | Текст тепер закріплено семантично, а не копією абзацу |
| `src/commitmentContract.test.ts` (новий) | 29 офлайн-тестів: фікстури A–N, дати, `next_check`, семантика, ліміт, runtime-межі, scope | Фокусне покриття #34 |
| `docs/56_ISSUE_34_COMMITMENT_LIFECYCLE_SOURCE_CONTRACT.md` (новий) | Цей звіт | — |

**Не змінено:**
- Skills і `managed-agents/djonik.md` (SHA-lockstep r26 проходить);
- `src/release.ts` / `SERVING_RELEASE`;
- Telegram, lifecycle Session, #40, ledger #31, Project Health, `trello_work_history`;
- `claude-lock.json`, `deploy/`, roadmap, issue.

## 13. Фокусні тести (`src/commitmentContract.test.ts`)

| Фікстура | Що закріплено |
|---|---|
| — | Текст ≤ 4096 символів і ≤ 4096 байт UTF-8 (інакше впало б створення Session); інваріанти #13 збережено; card id + проєкт для прийнятих планів |
| — | Шлях `commitments/<project-slug>/…`, один файл на outcome; шаблон рівно з 7 ключів; 4 статуси; жодного поля Trello чи історії; «no transcript» |
| A | Пропозиція ≠ прийняття |
| — | Текст із зображення / PDF / пересланого повідомлення не створює домовленість |
| B | Пряма заява = прийняття; `waiting_on` лише якщо названо; `next_check` лишається `none` без прийнятої дати |
| — | **Дати:** `accepted` / `closed` без дати; жодне поле шаблону не вимагає дати; «never write today's or a guessed date to fill a field»; єдиний `YYYY-MM-DD` — умовний, лише за певної сьогоднішньої дати; жодного правила на кшталт «record / stamp today's date» |
| — | **`next_check`:** `none`, доки Daniel не прийняв дату; waiting без дати — норма; Djonik може спитати чи запропонувати, але його дата не записується до прийняття; прийняття оновлює той самий файл; жодної дефолтної чи похідної дати |
| C | `next_check` — дата, яку Daniel прийняв; непевна сьогоднішня дата → його слова й уточнення; due ≠ next_check ≠ commitment; дата картки не змінюється |
| D | Той самий файл; нова перевірка замінює стару |
| E | Пошук за card id, потім проєкт + outcome; оновлення, не дубль |
| F | cancelled + `next_check: none`; закрите не піднімається |
| G | Підтвердження Daniel розв'язує; `closed` — мінімальний доказ, без дати |
| H | Пошук у `commitments/` у новій Session; свіжий Trello лише для поточного стану; «нічого немає → так і сказати»; без Memory-читання на кожному ході |
| I | Поточні поля картки не зберігаються; Trello перемагає на поточному стані, але не закриває домовленість |
| J | Done ≠ фідбек Анни |
| K | Відсутній чи неоднозначний доказ → відкрито, сказати прогалину; неясний збіг → одне питання |
| L | Проєкт в ідентичності і в шляху; без злиття між проєктами |
| M | Лише Memory, нуль Trello (інструкція + runtime-тест) |
| N | Явна зміна картки → task-management / #31 (інструкція + Skill + runtime-тест: Memory read ≠ Trello verify) |
| — | Waiting ≠ Blocked і due ≠ commitment у контракті, prompt, weekly і daily; read-back перед «записав» *(замінено в §19)*; жодних обіцянок нагадувань; scope: код не торкається Memory |

**Доказ, що тести ловлять регресію.** Прогін тих самих 29 тестів проти старого тексту інструкцій (HEAD + лише `export`): **24 fail / 5 pass**. Проходять ліміт, інваріанти #13, два runtime-тести і scope-тест — тобто те, що вже було правдою до #34. Після відновлення кандидата: **29/29**.

## 14. Регресія (точні результати)

```text
node --import tsx --test src/commitmentContract.test.ts → tests 29  / pass 29  / fail 0
node --import tsx --test src/djonikClient.test.ts       → tests 142 / pass 142 / fail 0
node --import tsx --test src/skills.test.ts             → tests 95  / pass 95  / fail 0
node --import tsx --test src/release.test.ts            → tests 11  / pass 11  / fail 0   (Skill/prompt lockstep r26 цілий)
npm test                                                → tests 674 / pass 674 / fail 0 / cancelled 0 / skipped 0   (база 645 + 29)
npm run typecheck                                       → tsc --noEmit, exit 0
git diff --check                                        → exit 0, без виводу
```

Жоден тест не звертається до Claude, Trello, Calendar чи іншого live-сервісу: фейкові клієнти в пам'яті плюс читання файлів репозиторію.

## 15. Обмеження

- **Source-тести не доводять поведінку моделі.** Вони доводять лише, що інструкції є і runtime-межі тримаються. Чи Claude справді шукає перед записом, читає назад, не вигадує дат і не мутує Trello, покаже тільки live-валідація.
- **Дата «сьогодні».** Адаптер не передає поточну дату; чи має Session надійне «сьогодні», не перевірено. Резолюція «в четвер» → `YYYY-MM-DD` — арифметика моделі, а #38 уже бачив помилки з днями тижня.
  - Після review-fix (§18) жодне поле не вимагає сьогоднішньої дати: `accepted` і `closed` без дат, `next_check` — `none` або прийнята дата. За непевної дати зберігаються слова Daniel з уточненням.
  - **Не** класти дату в Memory-інструкції: Session живе з процесом днями, і дата застаріє.
  - Якщо live покаже розрив, вузький фікс (наприклад, дата Києва в повідомленні від адаптера) — окреме виміряне рішення.
- **Немає детермінованого захисту** від дубля файлу, від пропущеного пошуку при підказці в новій Session (той самий клас, що #18) чи від запису без read-back. Memory лишається інспектованою і виправною через Console, історія версій зберігається.
- **Особиста обіцянка з датою** («зроблю X до пʼятниці»): дата живе в рядку outcome, а `next_check` лишається `none`, поки Daniel не прийме перевірку. Перевірити live, що модель не підставляє дату сама.
- **Рядок prompt** «never promise … track his commitments automatically»: стежити, щоб модель не відмовлялась записувати заявлене.
- **Токени:** +2974 символи в кешованому префіксі; не виміряно.
- **Production:** зміна дійде до Telegram лише після окремо авторизованого деплою app-ревізії. До того production працює на старих інструкціях `a6a627d`.

## 16. Пропозиція наступного live-слайсу (лише сценарії; **не виконувалось**)

Потребує окремого дозволу за docs/04 §27. Це пропозиція для рішення Product Owner:

- **Кандидат:** Agent r26 / v26 без змін + app-кандидат цього diff через `connectToDjonik` з ізольованою Session.
- **Memory:** окремий тимчасовий валідаційний store (`read_write`), **не** production. Seed — лише мінімальний бриф проєкту для J і K. Контракт відносний до store, тож працює там без змін.
- **Мутації Trello:** 0. Для J — читання вже існуючої Done-картки; N не повторювати live: шлях #31 / #37 уже прийнятий (docs/34), плюс офлайн-тест.
- **Сесії й ходи:** до 4 Session, до 12 видимих ходів:
  - S1: B → C → D → E → F (або G);
  - S2 (нова Session): H + I + J;
  - S3: A + M;
  - S4: L + K.
- **Докази по кожному ходу:** події `write` / `edit` / `read` під `commitments/`, вміст файлу після ходу (Memory API read), нуль `trelloWrite*`, свіжий `trelloReadCard` там, де потрібен поточний стан, `end_turn`, вартість і токени (зокрема ціна довших інструкцій).
- **Стоп-умови:** будь-яка Trello-мутація; дубль файлу для того самого outcome; прийнята пропозиція без згоди Daniel; вигаданий чи хибний `next_check`; вигадана дата в `accepted` / `closed`; злиття між проєктами; закриття з Done-картки; заява «записав» без read-back *(для наступного кандидата — заява «записав» до успішного результату `write` / `edit` чи після помилкового або неясного результату; §19)*; вичерпання бюджету.
- **Орієнтир бюджету:** стеля ≈ $1.50 list cost. Спостережено $0.04–0.10 за звичайний хід Sonnet 5 medium (docs/55, docs/53) і до $0.21 для важкого читання Trello (docs/46).

Після PASS: окремо авторизований деплой app-ревізії (r26 без змін) → hosted-перевірка. Споживання `next_check` для п'ятничного «це ще актуально?» і нагадувань — це #39, не #34.

## 17. Явні підтвердження

- Paid inference: **НІ**
- Managed Session для валідації: **НІ**
- Production Agent змінено: **НІ**
- Production Skill змінено / синхронізовано: **НІ**
- Production Memory змінено: **НІ** (не читалась і не писалась; жодного файлу `commitments/`)
- Trello-мутації: **НІ** (Trello не викликався)
- Deploy / restart / Hetzner / secrets / systemd: **НІ**
- `SERVING_RELEASE`, r27, release ID, payload оновлення Agent: **НІ**
- Commit: **НІ**. Push: **НІ**. Гілку не створювалось. Issue / roadmap не змінювались.

Мережеві дії цього етапу: `git fetch origin main`, читання GitHub #34 (read-only), `npm ci` з lockfile, читання офіційної документації Memory.

## 18. Review-fix pass (Product Lead, 2026-09-24)

Product Lead прийняв архітектуру і повернув один блокер та одне уточнення. Scope не розширено.

**1. Блокер — durable-дати не вигадуються.** Шаблон вимагав `accepted: <date — …>` і `closed: <date — …>`. При цьому надійної сьогоднішньої дати в runtime немає (§15), тож Claude довелося б її вигадати. Виправлено:
- `accepted: <a few words on how Daniel stated or accepted it; no transcript>`;
- `closed: <minimal resolution or cancellation evidence, or none>`;
- нове правило `Dates`: «never write today's or a guessed date to fill a field; accepted and closed need none. Keep only dates from Daniel or an authoritative source; write a check date as YYYY-MM-DD (his words) only if today's date is certain, else his words, then confirm.»

Сервісу дати, ін'єкції в адаптері, форматера, бази даних чи іншої інфраструктури не додано.

**2. Уточнення — `next_check`.** Шаблон: `next_check: <check date Daniel accepted, or none>`. Нове правило: «next_check stays none until Daniel accepts a check date; waiting without one is fine. You may ask or propose one; yours is recorded only once he accepts, in the same file.» #39 лишається поза scope.

**Ліміт.** Нові правила додали текст. Щоб лишитись у межах, скорочено формулювання лише в #34-частині; абзац #13 не змінено. Прибрано дублі прикладів («повернімося до цього в четвер», «скасуй», «фідбек отримали» — ці правила вже покриті іншими прикладами й формулюваннями), `<short-outcome>` → `<outcome>`. Семантика інших правил не змінилась.

Документація провайдера каже «4,096 characters», не уточнюючи одиницю, а кирилиця в UTF-8 займає 2 байти. Тому тест тепер перевіряє і UTF-8 розмір. Підсумок: **3966 символів / 4065 байт UTF-8** (до правки: 3911 / 4059).

**Тести.**
- Два нові тести: «#34 dates…» і «#34 next_check…» (таблиця §13). Вони явно відкидають будь-яке правило, що вимагає вигаданої сьогоднішньої дати.
- Решту регулярних виразів оновлено під нові формулювання.
- Обидва нові тести **падають на кандидаті до правки** (2 fail / 0 pass) і проходять після неї.

**Точні результати після правки:**

```text
node --import tsx --test src/commitmentContract.test.ts → tests 29  / pass 29  / fail 0
node --import tsx --test src/djonikClient.test.ts       → tests 142 / pass 142 / fail 0
node --import tsx --test src/skills.test.ts             → tests 95  / pass 95  / fail 0
node --import tsx --test src/release.test.ts            → tests 11  / pass 11  / fail 0
npm test                                                → tests 674 / pass 674 / fail 0 / cancelled 0 / skipped 0
npm run typecheck                                       → exit 0
git diff --check                                        → exit 0, без виводу
```

**Підтвердження для цього проходу:**
- без commit, push, deploy;
- без paid inference і без Managed Session;
- без доступу до production Memory;
- без Trello;
- без sync Agent чи Skill;
- #34 не закрито, #39 не почато.

## 19. Follow-up після першої live-валідації: стандарт доказу для native Memory (Product Lead, 2026-09-24)

### Live-доказ ([docs/57](57_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_VALIDATION.md))

Кандидат `dcb8d3e` перевірено на Agent v26 з ізольованим тимчасовим store. Один хід S1.1 («По Extract чекаємо фідбек від Анни.»), $0.09.

Що модель зробила правильно:
- створила один файл `commitments/extract/feedback-from-anna.md` з правильним шляхом і рівно сімома ключами шаблону;
- `status: waiting`, `waiting_on: Анна`, `next_check: none`, `card: none`, `closed: none`;
- жодної вигаданої дати, картку не вгадано;
- перед записом двічі шукала дубль (`grep`);
- built-in `write` повернув успіх, провайдер створив незмінну memory version, приписану цій Session (`session_actor`);
- хід завершився `end_turn`, Trello-викликів 0.

Що модель порушила: **власне правило read-back цього кандидата.**
- Після `write` не було `read`, а відповідь була «Ок, зафіксував».
- Проміжне «Записав» з'явилось у тій самій model-відповіді, що й виклик `write`, тобто ще до його результату. У видиму відповідь воно не потрапило: клієнт показує лише фінальне повідомлення.

За тодішнім контрактом це **FAIL**, і docs/57 фіксує його саме так. Цей розділ не перекваліфіковує той прогін.

### Рішення Product Lead

Провал спричинило надмірно суворе правило контракту, а не хибний запис. Для **native Managed Agents Memory**:
- успішного результату built-in `write` / `edit` достатньо, щоб Djonik сказав, що зміну збережено;
- не можна заявляти про збереження до того, як існує результат відповідного `write` / `edit`;
- помилковий або неясний результат — не «збережено»;
- окремий read-back **необов'язковий**: лише коли для подальших міркувань потрібен точний збережений текст. Обов'язкового read після кожної Memory-мутації немає;
- memory versions провайдера лишаються незалежним аудитом. Djonik не звертається до Memory API після кожної розмовної мутації.

**Межа рішення:** лише файли native Memory. **Trello #31 не змінюється:** зовнішній запис у картку, як і раніше, потребує окремого прямого читання після запису.

### Зміна джерела (наступний кандидат)

`src/djonikClient.ts`, `DJONIK_MEMORY_INSTRUCTIONS`, одне правило #34 (формулювання після мікро-cleanup розміру, див. нижче):

```text
було:  - After a write or edit, read the file back; say it is saved only if the read shows the change, otherwise say it is not.
стало: - Say saved only after a successful write/edit result, never before; error/unclear: not saved. Read-back optional.
```

- **Мікро-cleanup розміру (Product Lead).** Перша редакція правила («Say it is saved only after its write/edit result shows success, never before; an error or unclear result means not saved. Read-back is optional.») давала 3992 символи / **4091 B**, лише 5 B до захисного ліміту. Семантику не змінено, скорочено лише формулювання:
  - правило збереження: 146 → 114 B;
  - #34-речення в першому абзаці: «if known from a fresh read, its card id» → «if freshly read, its card id» (−11 B).
- Розмір: 3966 → **3949** символів, 4065 → **4048** B UTF-8. Запас до 4096 — 147 символів / 48 B.
- До цілі ≤ 4000 B не скорочено: для цього довелося б переписувати інші рев'юйовані правила #34 (Accept / Dates / Identity), які тести фіксують дослівно.
- SHA-256 тексту: `332dc04a…8544` → `f8a241f5…8292` (проміжна редакція `ed1f2877…86db` не публікувалась).
- До doc-коментаря константи додано рядок про стандарт доказу і межу з #31.
- Решту контракту, абзац #13 (крім стиснення #34-речення про card id), Skills, prompt, release, рантайм і `SERVING_RELEASE` не змінено. SHA-lockstep r26 цілий.

### Чому без runtime-ledger для Memory

- Рішення Product Lead прямо його виключає.
- Результат `write` / `edit` — це нативний результат built-in інструмента в тому самому контексті моделі. Судити про нього може сама модель, а провайдер незалежно фіксує memory version.
- Memory-запис внутрішній для store, версійований, інспектований і виправний. Це інший клас ризику, ніж зовнішня Trello-мутація з ризиком не тієї цілі, заради якої існує #31.
- Виміряний провал був у надмірній вимозі контракту, а не в ненадійному збереженні. Детермінованого розриву, який мав би закривати код, не виявлено.

Тому код і далі не читає, не парсить і не перевіряє результати Memory-інструментів. Це закріплено тестом.

### Тести (`src/commitmentContract.test.ts`, 29 → 35)

**Замінено 1 тест** («Memory write is read back…») на **4 семантичні**:
- native Memory: «збережено» лише після успішного результату `write` / `edit`, ніколи до нього;
- native Memory: помилковий чи неясний результат — не «збережено»;
- native Memory: read-back необов'язковий. Правило `dcb8d3e` не повертається в жодній формі (`read the file back`, `saved only if the read`, обов'язковий read після запису);
- Trello: результат запису сам не є перевіркою. Контракт веде на перевірений шлях task-management; Skill і далі каже «never treat the write call's return value as the read-back».

**Додано 3 runtime-тести** (фейковий клієнт, офлайн):
- форма S1.1 (`grep` → успішний `write` → відповідь, без `read`) завершується відповіддю моделі без нуджа;
- немає Memory-ledger: після помилкового Memory-запису клієнт не нуджить і не переписує відповідь моделі;
- успішний `trelloWriteCard` поруч з успішним Memory-записом **лишається неперевіреним**: один корекційний нудж, далі fail closed (#31).

Існуючий тест «Memory read-back ніколи не зараховується як перевірка Trello-запису» збережено.

**Доказ, що тести ловлять регресію:** ті самі 35 тестів проти старого тексту інструкцій (`dcb8d3e`) дають **4 fail / 31 pass**. Падають три нові семантичні тести native Memory і тест card id #3. Останній — лише через нову дослівну прив'язку до стисненого формулювання «if freshly read»; до мікро-cleanup було 3 / 32. Runtime-тести проходять і на старому коді: це регресії поведінки рантайму, яка не змінювалась.

### Точні результати

```text
node --import tsx --test src/commitmentContract.test.ts → tests 35  / pass 35  / fail 0
node --import tsx --test src/djonikClient.test.ts       → tests 142 / pass 142 / fail 0
node --import tsx --test src/skills.test.ts             → tests 95  / pass 95  / fail 0
node --import tsx --test src/release.test.ts            → tests 11  / pass 11  / fail 0   (Skill/prompt lockstep r26 цілий)
npm test                                                → tests 680 / pass 680 / fail 0 / cancelled 0 / skipped 0   (674 + 6)
npm run typecheck                                       → exit 0
```

### Що далі і обмеження

- Новий кандидат — `dcb8d3e` плюс цей uncommitted diff. Live він **не** перевірявся. Сценарії S1.2–S4.3 з docs/57 (корекція, дедуплікація, нова Session, скасування, пропозиція, Done ≠ фідбек, ізоляція, відсутні докази, межа plan-only ↔ Trello) досі без live-доказів.
- Наступний live-прогін потребує окремого дозволу за docs/04 §27.
- Пограничний випадок: якщо модель напише заяву в тій самій відповіді, що й виклик `write`, і не дасть фінального тексту після результату, видимою лишиться ця передчасна заява. Правило «never before» це забороняє. Детермінованого захисту немає: це свідоме рішення «без ledger».
- Production не змінено: там інструкції `a6a627d`.

### Підтвердження для цього проходу

- без paid inference і без Managed Session;
- без production Memory і без мутацій тимчасового store;
- без Trello;
- без sync Agent чи Skill, без r27, `SERVING_RELEASE` не змінено;
- без deploy / restart;
- без commit і push;
- roadmap не оновлено; #34 не закрито; #39 не почато.
