# Issue #37 — source-first реалізація і пропозиція очищення Memory

Дата: 2026-09-22  
Canonical issue: [#37 — Tasks belong to their project: project label on create + Memory hygiene](https://github.com/danielkokr/djonik-manager-2.0/issues/37)  
Базовий HEAD: `5dc1d59` (`docs: accept issue 36 and promote issue 37`). Перший principal source-first pass.

> **Статус 2026-09-23:** пропозицію §10 **затверджено** Product Owner із двома уточненнями, і міграцію Memory **виконано**. Див. §15 — там зафіксовано рішення, перевірку передумов, виконані операції й фінальний стан. Розділи §1–§14 лишаються записом principal pass станом на 2026-09-22 (тоді Memory ще не змінювалась).

---

## 1. Підсумок

- **Skill `task-management`:** знято загальну заборону labels. Додано три короткі розділи: конвенції дошки (label = лише проєкт; нова задача → Inbox), label проєкту для нової задачі (свіже читання labels → один точний збіг → create → окремий `attach_label` → пряме читання картки), label існуючої картки (лише на явний запит Daniel, без bulk).
- **Реальний контракт Trello MCP встановлено з записаних подій Session, без inference** (§3). Label ставиться окремою мутацією `trelloWriteCard` `action: "attach_label"` з `cardId` і `labelId` (ARI). Жоден записаний create не передає label.
- **Критична знахідка (§3.3):** живі результати `trelloWriteCard` і `trelloReadCard get` мають обгортку `{"cards":{"nodes":[card],"totalCount":1}}`. Ledger #31 її не приймав. Отже на живих даних **жодна** мутація (не лише label) не могла б отримати статус verified: все закривалося б як «НЕ підтверджено». Цей ризик #31 сам зафіксував як неперевірений (docs/18 §135). Без цього label-перевірка #37 неможлива, тому я додав вузьке прийняття саме цієї форми з одним вузлом. **Це рішення винесено окремо на review Product Lead (§11, пункт 1).**
- **Ledger #31 розширено полем `label`:** attach підтверджується лише прямим читанням ТІЄЇ Ж картки, що почалося після запису, і лише якщо id label є у власному `labels` картки. Порівняння йде за provider id, не за назвою.
- **Часткова успішність:** «картку створено, але label не підтверджено» тепер окремий детермінований рядок. Картка не зникає зі звіту, але не видається за частину проєкту.
- **Memory прочитано лише read-only** (8 файлів, 23 версії, останній запис 2026-09-17). Підготовлено точний diff у §10: 5 перейменувань без зміни байтів, 1 перейменування з точною вставкою, 1 редагування, 1 видалення з поточного вигляду. Два пункти потребують рішення Daniel.
- Тести: **527/527** (було 495, +32). Typecheck і `git diff --check` чисті. Нові live-shape регресії **падають на старому ledger (4/4) і проходять на новому**.

## 2. Canonical NOW

На старті локальний checkout був на `3312706`, де `docs/02` ще позначав NOW = #36. `git fetch` показав, що `origin/main` на 1 коміт попереду: `5dc1d59 docs: accept issue 36 and promote issue 37`. Робоче дерево було чисте, тож я зробив `git merge --ff-only origin/main`. Це fast-forward до governance-коміту, як вимагають CLAUDE.md і AGENTS.md; комітів чи push не було.

Після цього `docs/02`, рядок 60: `| 5 | **NOW — [#37 — Project label on create + Memory hygiene]…** | Source-first; Memory content diff requires Daniel's explicit approval before any Memory write |`. Це єдиний пункт NOW; #36 — DONE. Issue #37 відкритий; останній коментар PO підтверджує межі: source-first, Memory лише після затвердження diff.

## 3. Фактичний контракт Trello MCP для labels

### 3.1 Як отримано (без Session і без inference)

| Джерело | Результат |
|---|---|
| Репозиторій (docs/04 §17, docs/16 §5) | Сирих `input_schema` Trello MCP у репозиторії немає; `agents.retrieve` повертає конфіг, не схеми. **Недостатньо.** |
| `agents.retrieve` production (read-only) | v21, `claude-haiku-4-5-20251001`; Trello toolset `default enabled`, `trelloWriteCard` `enabled:true`; `trelloWriteBoard/Checklist/Inbox/List/Planner` `enabled:false`; Calendar `enabled:false`. Схем немає (SDK 0.125: `input_schema` лише для custom tools). |
| Публічний провайдер `atlassian/trello-mcp-server` (README, `skills/trello-use/SKILL.md`) | Cards: «attach and detach labels»; `labelId` — ARI (`ari:cloud:trello::label/workspace/<ws>/<label>`); write-інструменти приймають лише ARI; сувора валідація («a field not used by the chosen action is rejected»). Назв actions немає. |
| **Записані події Session** (`sessions.list` + `sessions.events.list`, 197 Session, read-only) | Витягнуто **лише структуру**: імена інструментів, `action`, набори ключів input, типи значень, ключі результатів і форма `labels`. Назви карток, описи та id не виводились. |

### 3.2 Спостережений контракт

| Питання | Відповідь (доказ) |
|---|---|
| Яка дія ставить існуючий label | `trelloWriteCard` `action: "attach_label"`; 7 успішних викликів, 2026-09-15…17 |
| Поле картки | `cardId`: ARI картки (`ari(card)`) |
| Поле label | `labelId`: ARI label (`ari(label)`) |
| Знімання | `action: "detach_label"`, та сама форма `{action, cardId, labelId}` (1 виклик) |
| Label у самому create? | **Не доведено.** 20 записаних create мали лише `{action, listId, name, desc?, due?}`. Схеми немає, а сувора валідація відхиляє зайві поля. Тому label — **друга, окрема мутація**. |
| Форма результату `attach_label` (і create/update/move) | `{"cards":{"nodes":[<card>],"totalCount":1}}`; у 7/7 випадків `input.cardId === node.id`, а `labelId` присутній у `node.labels` |
| Що повертає `trelloReadCard get` для labels | Той самий одновузловий connection (93/93). Вузол: `id` (ARI), `name`, `desc`, `due`, `list{id,name}`, `board{id,name}`, **`labels: [{color, id: ari(label), name}]`**, **`labelsHasMore: boolean`**, `closed`, `complete`, `members`, `checklists`, `comments`, … |
| `trelloReadBoard list_labels` | input `{action, boardId: ari(board), limit?}`; результат `{labels:[{color, id: ari(label), name, objectId, uses}], hasMore, nextCursor}` |
| Кореляція для перевірки | attach: ціль = input `cardId`. Постумова = пряме `get` цієї картки після результату attach, у власному `labels` є елемент з тим самим id (ARI ↔ ARI або bare objectId: порівнюється останній 24-hex токен) |

Обмеження доказу: усі записані виклики мутацій датовані **2026-09-15…18**, тобто до #31 (21.09). Свіжої live-перевірки сьогодні немає, бо Session і запис заборонені. Перший авторизований live smoke #37 має підтвердити, що форма не змінилась.

### 3.3 Розбіжність із припущенням #31 і що зроблено

`extractCardObject` (#31) приймав лише голий об'єкт картки або `{card:{…}}`. Реальна форма `{cards:{nodes:[…]}}` давала `null`, тому:
- create → `target_unknown`;
- `get` → невалідне читання;
- update/move → вічне `awaiting_read`.

Для живих даних це означає нудж і закриття ходу з «НЕ підтверджено» навіть для правильного запису. #23 due-підтвердження також не спрацювало б. docs/18 §135 прямо назвав цей ризик і відклав його до live smoke.

Чому не STOP: чисту перевірку в стилі #31 можна зробити без редизайну. Додано одну суворо обмежену форму: **рівно** ключ `cards`, у ньому лише `nodes` / `totalCount` / `hasNextPage`, `nodes.length === 1`, `totalCount ∈ {відсутній, 1}`, `hasNextPage ∈ {відсутній, false}`. Нуль або кілька вузлів, наступна сторінка, сторонні ключі, голий `{nodes}` → `null`, як і раніше. Ідентичність, порядок і правила «читання після запису» не змінено.

Це зачіпає всі поля, не лише label, тому я не ховаю зміну в #37: див. §11, пункт 1 (прийняти в #37 чи винести в окреме reliability-issue за AGENTS.md).

## 4. Змінені файли

| Файл | Зміна |
|---|---|
| `.claude/skills/task-management/SKILL.md` | +3 розділи (конвенції дошки; label нової задачі; label існуючої картки); оновлено опис write-інструмента, крок перевірки і межу write-scope |
| `src/trelloMutationLedger.ts` | live одновузловий connection; поле `label` (attach/detach) з перевіркою за id; власність поля лише для того самого label; `projectLabel` / `isCreate` в outcome; `cardLabelState`; звітні рядки для label і рядок часткового призначення; display-only `cardId` для `no_result` |
| ~~`src/projectLabel.ts`~~ | Чистий helper резолюції label. **Вилучено у follow-up §15** за рішенням Product Lead (не використовувався в runtime) |
| ~~`src/projectLabel.test.ts`~~ | **Вилучено у follow-up §15**; ledger-регресії #37 перенесено в `src/trelloMutationLedger.test.ts` |
| `src/djonikClient.test.ts` | +4 наскрізні тести через `connectToDjonik` |
| `src/skills.test.ts` | 2 закріплені формулювання write-scope оновлено свідомо; +7 семантичних тестів #37 |
| `src/trelloMutationLedger.test.ts` | Уточнено назву одного тесту (без зміни перевірок) |
| `docs/33_ISSUE_37_SOURCE_AND_MEMORY_PROPOSAL.md` (новий) | Цей звіт |

Не змінено: work-review / #36, Variant-B renderer, lifecycle #40, Project Health, daily/weekly-planning, studio-intake (вона вже віддає project resolution у task-management), system prompt, Telegram, Memory-інфраструктура, scheduler, #34, production-конфіг, `claude-lock.json`.

## 5. Зміни в `task-management`

Збережено без змін: обговорення vs запит; якорі проєкту для нової задачі (разом із прикладами «3D-рендер» / «кавовий автомат» → питання, нуль запису); одне уточнення; перевірка після запису; виправлення в тій самій розмові; усі правила due/#23.

Додано (коротко, без фразового роутингу):
- **Board conventions:** проєкт = label на єдиній дошці; label означає лише проєкт, не тип / пріоритет / статус / тег; нова задача → **Inbox**, якщо Daniel явно не назвав інший список.
- **Project label on a new task:** 7 кроків:
  1. свіжий `list_labels` з пагінацією; label і його id ніколи не беруться з Memory, попереднього ходу чи пошуку;
  2. рівно один існуючий label з назвою проєкту (регістр і пробіли не враховуються); псевдонім лише коли однозначний, ніколи «приблизно схожий»;
  3. create, потім окремий `attach_label` з `cardId` з власного результату create;
  4. label немає → не створювати й не підміняти; одне питання (створити без label чи дочекатися, поки Daniel додасть label); нуль запису;
  5. кілька кандидатів → уточнити; нуль запису;
  6. пряме `get` картки після label-запису; повідомляти успіх лише після нього;
  7. label не підтверджено → «картка є, але проєкт не підтверджено»; без дубля, без видалення.
- **Project label on an existing card:** ніколи самостійно; лише явний запит чи виправлення (`attach` правильного + `detach` хибного на тій самій картці, перевірка прямим читанням); без bulk.
- Write-scope: «…mark done, and attaching/detaching an existing project label…». Поза scope: створення / перейменування labels, labels не для проєкту, bulk relabeling.

## 6. Поведінка резолюції label

> **Оновлено у §15:** helper `src/projectLabel.ts` вилучено за рішенням Product Lead. Резолюцію проєкту повністю тримає Claude + Skill `task-management`, а список доступних labels дає свіжий `list_labels`. Нижче — опис helper'а станом на principal pass.

Резолюція проєкту — міркування Claude у Skill. Код не читає текст користувача. `src/projectLabel.ts` фіксує детермінований контракт збігу і тестує його:
- ключ = NFC + trim + схлопнуті пробіли + case-fold; **лише рівність** (без підрядка, префікса, fuzzy);
- 0 збігів → `none`; label не створюється і не підміняється;
- ≥2 → `ambiguous` з усіма кандидатами; вибору немає;
- `hasMore: true` або нерозбірний результат → `unavailable` (ні збіг, ні доведена відсутність);
- label без назви ніколи не є проєктом.

Цей helper **не підключено** до runtime-ходу: code не вирішує проєкт. Його роль — однозначно зафіксувати правило. Якщо Product Lead вважає окремий модуль зайвим, його можна прибрати без впливу на межу перевірки. Межа перевірки живе в ledger.

## 7. Дизайн label-перевірки #31

- `attach_label` / `detach_label` → requested field `label` `{action, labelId}`. Ціль мутації = input `cardId`. Якщо результат називає іншу картку, ціль невідома, мутація ніколи не verified (існуюче правило #31).
- Постумова перевіряється лише на **reference read**: останньому валідному прямому `trelloReadCard get` цієї картки, що **почався після результату** цього запису. Також зберігаються існуючі правила: помилкові, пошукові та board/list читання, читання іншої картки, «попросили X, отримали Y» — не рахуються.
- `cardLabelState(card, labelId)`:
  - `present` — у власному `labels` є валідний елемент з тим самим id;
  - `absent` — **лише** якщо масив повний і повністю розбірний (`labelsHasMore !== true`, без зіпсованих елементів);
  - інакше `unavailable`.
- attach: `present` → match; `absent` → `field_mismatch`; `unavailable` або відсутній `labelId` → `field_unconfirmed`. detach — дзеркально.
- Власність поля (sequential writes): пізніший запис володіє полем `label` лише для **того самого** label на тій самій картці. Attach іншого label, або того самого на іншій картці, не задовольняє і не перекриває очікування.
- Власний echo `labels` у результаті write-інструмента ніколи не є перевіркою.
- #40: повтор того самого tool-use id / result після результату ігнорується, outcome не змінюється (тест).
- Правила name/desc/list/due не змінено. Усі 43 тести ledger і 134 попередні тести клієнта проходять без змін перевірок.

## 8. Часткова успішність

Create і attach — **дві чесні, окремо корельовані мутації**. Звіт детермінований, з подій інструментів, а не з тексту моделі:

| Ситуація | Результат для користувача |
|---|---|
| create ✅ + label ✅ | Повний успіх; відповідь моделі проходить (нуджу немає) |
| create ✅ + `attach_label` помилка | `failed`-шлях: `✅ …«Hero банер»` + `❌ Не виконано (помилка інструмента): label проєкту на картці …` + `⚠️ Картку створено, але належність до проєкту (label) НЕ підтверджено — поки що вона без проєкту.` Текст моделі про «успіх» не показується, retry не нуджиться |
| create ✅ + label відсутній на читанні | Один корекційний read-нудж; далі `DjonikUnverifiedMutationError` з ✅ create, ⚠️ label і тим самим рядком часткового призначення |
| create ✅ + attach без результату | `no_result` → нерозв'язано + рядок часткового призначення (картка показана за display-only `cardId`, без прив'язки до перевірки) |

Rollback не виконується: картка лишається, її існування не стирається. Рядок часткового призначення з'являється **лише** для підтвердженого create. Для attach на існуючій картці чи для невдалого create його немає.

Обмеження: якщо модель узагалі не викличе `attach_label` для прив'язаного проєкту, код цього не бачить, бо намір не парситься. Це відповідальність Skill, і її має перевірити live smoke.

## 9. Тести і точні результати

Нові регресії за вимогами §7 промпта:

| # | Вимога | Тест(и) |
|---|---|---|
| 1 | один збіг → label обрано | `#37 (1)` |
| 2 | немає збігу → немає створення / підміни | `#37 (2)` ×2 (включно з `trelloWriteBoard create_label` → `target_unknown`) |
| 3 | неоднозначність → без вибору | `#37 (3)` ×2 (включно з `hasMore` / нерозбірним) |
| 4 | читання з label → verified | `#37 (4)`, id-порівняння, клієнтський full-success |
| 5 | валідне читання без label → не verified | `#37 (5)`, клієнтський нудж → fail closed |
| 6 | label відсутні / нерозбірні / paged → не verified | `#37 (6)`, `cardLabelState` |
| 7 | інша картка з label → ні | `#37 (7)` (включно з «попросили X, отримали Y») |
| 8 | читання до запису → ні | `#37 (8)` (включно з читанням, що почалося до результату), echo write ≠ перевірка |
| 9 | name/desc/list/due без змін | 43/43 ledger + 134/134 попередні тести клієнта; live-shape #23 due end-to-end |
| 10 | ідентичність create з власного результату | `#37 (10)` (input `cardId` на create ігнорується; 2 вузли → `target_unknown`) |
| 11 | create ✅ + label ✗ → часткове | `#37 (11)` ×2, клієнтський `failed`-звіт, «тільки для create» |
| 12 | same-id replay (#40) | `#37 (12)` |
| 13 | #31/#32/#23/#36/#40 | повний набір зелений |

Доказ падіння до виправлення: 4 нові наскрізні тести на ledger з `HEAD`, потім відновлено:

```text
✖ #37: create + attach_label + direct read showing the label is full success on live result shapes (no nudge)
✖ #37: create verified + attach_label tool error → deterministic partial report, never the model's full-success text
✖ #37: create verified + label absent on the direct read → one read nudge, then fail closed as a partial project assignment
✖ #37: the live {cards:{nodes}} read shape now carries the #23 verified-due confirmation end to end
ℹ pass 134 / ℹ fail 4
```

Після виправлення:

```text
node --import tsx --test src/projectLabel.test.ts src/trelloMutationLedger.test.ts   → tests 64 / pass 64 / fail 0
node --import tsx --test src/djonikClient.test.ts                                   → tests 138 / pass 138 / fail 0
node --import tsx --test src/skills.test.ts                                         → tests 92 / pass 92 / fail 0
npm test                                                                            → tests 527 / pass 527 / fail 0
npm run typecheck                                                                   → tsc --noEmit, без помилок
git diff --check                                                                    → чисто (exit 0)
```

Поведінку Skill без inference не тестовано. Skill-тести — семантичні перевірки наявності правил. Жорстку межу тестує код.

## 10. Memory: інвентар і точний запропонований diff

**Публічність.** Репозиторій `danielkokr/djonik-manager-2.0` **PUBLIC**. Брифи проєктів у Memory містять імена контактів клієнтів, ставки й особисті плани. Щоб не публікувати їх, файли, що переносяться **байт-у-байт**, закріплено за `memory id` + `version` + повним SHA-256. Текст, який буде записано, однозначний, і Daniel бачить його в Console → Memory. Повний текст наведено для всього, що **змінюється**.

Джерело: `memoryStores.retrieve`, `memories.list(view=full)` і `memoryVersions.list`, лише читання. Store «Djonik Memory», створено 2026-09-15, не архівовано. 8 memory, 23 версії. **Жодного запису після 2026-09-17.**

### A. Поточний інвентар

| Шлях | id / поточна версія | Байт / SHA-256 | Призначення | Пропозиція | Причина |
|---|---|---|---|---|---|
| `/work-priorities.md` | `mem_01A4dWFeSAFdZDoWCJQ26sdU` / `memver_01AcxG1j2m9Rz2LjyQ2UXdoH` | 2955 / `bafabfc0434622148bb0d34f9730cdb1805780a26b6937892ae4fdeafdb1450f` | Стабільна рамка пріоритетів | **MOVE** → `/priorities.md`, байт-у-байт (+ опційно пункт D-6) | Цільова структура; зміст стабільний і корисний |
| `/preferences.md` | `mem_01RovqJjmWtQh7aWiXMdfGv7` / `memver_011WwpbRBNyK46bMSoa57SXN` | 2457 / `a2dbab9548dfda35ba4f75d8dbc8e5754c0f0a93d363a0150abc52c230be7a58` | Стиль, межі + змішаний шум | **EDIT** (той самий шлях) | Тестове сміття, застарілі плани дня, живий стан Trello, проєктний факт не на місці |
| `/cossack-labs.md` | `mem_014FHKgbxX5PfDXXH12F2XLU` / `memver_01HNpbt81ZPt7TKjBDMoQedy` | 1715 / `c6fe9b51b8796ea2eca57388df4f77c1012a373fa6a908af65e8b90759200ccd` | Бриф проєкту | **MOVE** → `/projects/cossack-labs.md`, байт-у-байт | Стабільний бриф |
| `/extract.md` | `mem_0144nAARk796FA7VmjJns1Bg` / `memver_019bQAPjo5NpSoBM74x6XPBz` | 1626 / `e4c2579d16b1cc3efee0574c243bdc1cbafa56bee9e5a9de29bff0d12fc398ed` | Бриф проєкту | **MOVE + EDIT** → `/projects/extract.md` (вставка тону) | Стабільний бриф; сюди переходить вимога тону з preferences |
| `/seqthera.md` | `mem_01BPsjzcZm1AStq9Y1ex8pBh` / `memver_01YAu121gDKi1yKmHVXTtqqi` | 2158 / `987de32e12f850fa1032c7a6b65f6e85dd9674f7760007137b85a03e7b1692d9` | Бриф проєкту | **MOVE** → `/projects/seqthera.md`, байт-у-байт | Стабільний бриф |
| `/azov-a1.md` | `mem_012TQKL78n1D8gKtV6CoKgG9` / `memver_01XYgvArjxDiSZfrWtAAe4aV` | 1507 / `64a34f7a6e8af3d495bfcd4b9f006f5eb6470370b38ccee399e9ba2a7ccc07ce` | Бриф проєкту | **MOVE** → `/projects/azov-a1.md`, байт-у-байт | Стабільний бриф (див. D-7) |
| `/limen.md` | `mem_01UQ3fh8tVmECQc9EF3oMC7X` / `memver_01GggBj13Z5on74TzktP8t1a` | 1946 / `81555a54e99ebeccf8eb485dc2beaddbaa8486bdbb0ec7599bd7d62b52a8fe12` | Бриф власного проєкту | **MOVE** → `/projects/limen.md`, байт-у-байт | Стабільний бриф; застарілого «label not yet created» тут немає |
| `/trello-conventions.md` | `mem_015Apm68UgAqMH4Q5Fv1Lojo` / `memver_01SasCG9PQiby65nbuKDM68m` | 923 / `fa847ddbe26e48872215a8b2b05cce6d5110d69bd6230a7e158787c6c63609b1` | Конвенції дошки | **REMOVE FROM CURRENT VIEW** (delete memory; історія версій лишається) | Конвенції тепер канонічно в Skill; решта — стан дошки або застаріле |

Поточний текст `/trello-conventions.md` (без чутливих даних), дослівно:

```text
## Board structure (keywords: Trello, дошка, лейбл, проєкт, label, project)

- Daniel has one Trello board: "Djonik" (workspace: Робоча область Trello).
- Projects/clients are NOT separate boards — they are represented as **labels** on the Djonik board (e.g. Extract, Cossack Labs, A1, Seqthera).
- Lists on the Djonik board: Inbox, Backlog, This week, In progress, Waiting, Done.
- When user names a "project" (e.g. "по Extract", "для A1"), resolve it to a label on the Djonik board, attach that label to the card — do not search for a separate board.
- New tasks without an explicit list specified default to Inbox.
- "Limen" — Daniel's own internal project (not a client). To be added as a label on the Djonik board (label not yet created as of 2026-09-17; Djonik AI has no tool to create labels — Daniel must create it manually in Trello UI, then it can be attached to cards).
```

Поточний текст `/preferences.md` наведено як «−» рядки в diff у §10.C.

Брифи проєктів (структура без чутливих значень): Type, Aliases, Daniel's role, Recurring scope, Strategic context, Working model / sync cadence, Decision-makers, Commercial model, Recurring friction, Planning guidance, «Do not store as durable truth». Жоден бриф не містить живого стану Trello.

### B. Точне запропоноване дерево

```text
/priorities.md                 (mem_01A4dWFeSAFdZDoWCJQ26sdU, перейменовано з /work-priorities.md)
/preferences.md                (mem_01RovqJjmWtQh7aWiXMdfGv7, відредаговано)
/projects/azov-a1.md           (mem_012TQKL78n1D8gKtV6CoKgG9, перейменовано)
/projects/cossack-labs.md      (mem_014FHKgbxX5PfDXXH12F2XLU, перейменовано)
/projects/extract.md           (mem_0144nAARk796FA7VmjJns1Bg, перейменовано + вставка)
/projects/limen.md             (mem_01UQ3fh8tVmECQc9EF3oMC7X, перейменовано)
/projects/seqthera.md          (mem_01BPsjzcZm1AStq9Y1ex8pBh, перейменовано)
/commitments/                  ЗАРЕЗЕРВОВАНО для #34 — не створюється; жодного запису
```

Спосіб запису (для наступного, окремо авторизованого кроку):
- перенесення робити через `memories.update(id, { path })`: `id` і вся історія версій зберігаються;
- кожен запис робити з `precondition: { type: "content_sha256", content_sha256: <поточний SHA з §A> }`, щоб не перезаписати зміни, що з'явилися після цього звіту;
- `/trello-conventions.md` видаляти через `memories.delete`: з'явиться версія `deleted`, попередні версії лишаються;
- store не видаляється.

`/commitments/` не створюється. У Memory префікс існує лише разом із файлом, а вигадувати чи переносити туди поточні задачі заборонено (#34).

### C. Точний запропонований вміст

**`/priorities.md`**: байт-у-байт поточний `/work-priorities.md` (2955 байт, SHA-256 `bafabfc0434622148bb0d34f9730cdb1805780a26b6937892ae4fdeafdb1450f`). Якщо Daniel обере варіант A у D-6, змінюється рівно один рядок (результат: 2913 байт, SHA-256 `101762a73c572f49d7cab54bd2980c8b625b03f6031f9a2493069b4e5d1d9c9e`):

```diff
 Conflict guidance:
 - Cossack Labs hard deadline vs Limen without external deadline → Cossack Labs normally first.
 - Genuine urgent A1 fundraising/military deadline → may temporarily outrank normal commercial work despite lower pay.
-- Extract vs Seqthera, both non-urgent → choose the most strategically useful bounded outcome, portfolio value, and which project has been neglected longer.
+- Extract vs Seqthera competing for the same day → Extract first (Daniel's standing tie-break, stated 2026-09-16).
 - Limen repeatedly deferred for several weeks → surface this explicitly and propose a protected bounded block instead of silently deferring it again.
```

**`/preferences.md`**: повний новий текст (399 байт, SHA-256 `ae67779bcab5f51b406b3c98a2f8dff7b03f6fdf72c411fb35f1eba4b7b3dc40`, закінчується одним `\n`):

```text
# Daniel's Personal Preferences (keywords: preferences, personal)

## Communication style (keywords: PM update, short, concise, daily updates)
- Prefers short, concise daily PM-update responses without unnecessary detail.

## Working hours / contact boundaries (keywords: after 20:00, evening, do not disturb, urgent only)
- Does not want to be disturbed about work after 20:00, unless it's urgent.
```

Повний diff відносно поточного:

```diff
-# Daniel's Personal Preferences (keywords: preferences, personal, snack)
-
-- Favorite debugging snack: dried mango.
+# Daniel's Personal Preferences (keywords: preferences, personal)
 
 ## Communication style (keywords: PM update, short, concise, daily updates)
 - Prefers short, concise daily PM-update responses without unnecessary detail.
 
 ## Working hours / contact boundaries (keywords: after 20:00, evening, do not disturb, urgent only)
 - Does not want to be disturbed about work after 20:00, unless it's urgent.
-
-## Standing project priorities (keywords: Extract, Seqthera, priority, client priority)
-- Extract project work ranks higher priority than Seqthera when both compete for the day (stated 2026-09-16). Use this to break ties in planning/prioritization between these two clients.
-
-## Extract project — tone requirement (keywords: Extract, tone, style, напівофіційний, стриманий, semi-formal, reserved, copywriting)
-- Client on Extract wants a semi-formal, reserved tone in texts (напівофіційний, стриманий), NOT informal/conversational. This is a standing requirement (corrected 2026-09-16 — earlier note saying "informal" was wrong and is superseded). Apply when reviewing/writing/editing Extract copy.
-
-## Extract — Брендбук deadline (keywords: Брендбук, Extract, deadline, due date, пʼятниця)
-- SUPERSEDED: the 2026-09-16 personal-only commitment ("до пʼятниці", no Trello due date) is no longer current.
-- On 2026-09-17 Daniel explicitly set an actual Trello due date on the Брендбук card: 2026-09-25 (the following Friday, one week later than originally planned), confirmed via direct card read. Treat this as the real, authoritative due date going forward (though always re-verify via a fresh card read before stating it, per standard practice).
-
-## Extract — daily plan for 2026-09-17 CANCELLED, then day became active again (keywords: Extract, план на завтра, 2026-09-17, скасовано, rest day superseded)
-- The 2026-09-16 accepted plan for 2026-09-17 (focus on "Міні-парфуми адаптація" and "Автоматизація рендеру") was cancelled by Daniel on 2026-09-16. At that point 2026-09-17 was treated as a rest/quiet day.
-- SUPERSEDED on 2026-09-17: Daniel actively planned real work for that same day in conversation (finishing "Laba x A1" today, starting "Resources"). The "rest day" note no longer reflects reality — do not resurface it as still active.
```

**`/projects/extract.md`**: поточний `/extract.md` байт-у-байт плюс одна вставка перед рядком «Do not store as durable truth: …» (1913 байт, SHA-256 `1112605bc94124e5b2884fb67102ce595321e5164dfd7b4a0157a31adb59e60d`):

```diff
@@ -36,4 +36,8 @@
 - remember that packaging is the most recurring deliverable;
 - when interpreting "що по Extract?", associate the project primarily with perfumes, cosmetics, packaging, and visual concept development.
 
+Client tone requirement (standing; corrected 2026-09-16 — an earlier "informal" note was wrong):
+- Extract texts use a semi-formal, reserved tone (напівофіційний, стриманий), not informal/conversational.
+- Apply when reviewing, writing or editing Extract copy.
+
 Do not store as durable truth: current Trello status, current deadlines, current blockers, temporary priorities, one-off client feedback, current sprint contents.
```

**`/projects/cossack-labs.md`, `/projects/seqthera.md`, `/projects/azov-a1.md`, `/projects/limen.md`**: байт-у-байт поточні файли (SHA-256 з §A). Лише перейменування.

### D. Карта міграції

| # | Джерело → блок | Дія | Куди | Причина |
|---|---|---|---|---|
| 1 | `/work-priorities.md` (увесь) | **MOVE** | `/priorities.md` | Стабільна рамка пріоритетів |
| 2 | `/cossack-labs.md`, `/extract.md`, `/seqthera.md`, `/azov-a1.md`, `/limen.md` | **MOVE** | `/projects/<те саме ім'я>` | Стабільні брифи |
| 3 | `/preferences.md` — Communication style, Working hours | **KEEP** | `/preferences.md` | Стабільний стиль і межі |
| 4 | `/preferences.md` — «Favorite debugging snack: dried mango» (+ `snack` у ключових словах заголовка) | **DROP AS TEST** | — | Тестовий шум валідації Memory |
| 5 | `/preferences.md` — Extract tone requirement | **MOVE + EDIT** (скорочено, зміст той самий) | `/projects/extract.md` | Проєктний факт, не особиста вподобайка |
| 6 | `/preferences.md` — «Extract ranks higher than Seqthera» (2026-09-16) | **NEEDS PO DECISION** | A: замінює рядок Extract vs Seqthera у `/priorities.md` (diff §C); B: відкинути, лишити рядок рамки | Суперечить пізнішому `/work-priorities.md` (17.09), який цю тай-брейк-норму не переніс. Я не вибираю за Daniel |
| 7 | `/azov-a1.md` — «intends to leave this project before the new year» | **KEEP, позначено для перевірки** | `/projects/azov-a1.md` | Факт із терміном дії; безпечно перевірити не можу, тому не виправляю |
| 8 | `/preferences.md` — Брендбук deadline (+ superseded commitment) | **DROP AS TRANSIENT** | — | Due картки — живий стан Trello (spike docs/23: пт 25.09 18:00 за Києвом). Не переноситься в `commitments/` (#34) |
| 9 | `/preferences.md` — план дня 2026-09-17 (скасований / відновлений) | **DROP AS TRANSIENT** | — | Одноразовий план дня, уже superseded; порушує правило «не зберігати план дня» |
| 10 | `/trello-conventions.md` — проєкт = label, attach label, нова задача → Inbox | **DROP (дубль)** | Skill `task-management` | Тепер канонічно в Skill, а не лише в Memory |
| 11 | `/trello-conventions.md` — «Limen label not yet created (2026-09-17)…» | **DROP AS STALE** | — | Label Limen існує: `GET /boards/{id}/labels` у spike docs/23 (2026-09-22) і `list_labels` у docs/15 |
| 12 | `/trello-conventions.md` — одна дошка «Djonik», workspace, перелік списків | **DROP** | — | Структура дошки — живий стан; Djonik читає її свіжо. Правило «одна дошка, проєкт = label» є в Skill |
| 13 | `commitments/` | **RESERVED** | — | #34; нічого не вигадується і не переноситься |

### E. Явна НЕ-дія

**MEMORY WRITE NOT PERFORMED.**  
**AWAITING PRODUCT OWNER APPROVAL OF THIS EXACT DIFF.**

Пропозиція не прийнята. У цьому проході виконувалися лише `retrieve` / `list` / `memoryVersions.list`.

## 11. Рішення, потрібні від Daniel / Product Lead

1. **Live-форма `{cards:{nodes}}` у ledger (§3.3).** Прийняти як частину #37 (без неї label-перевірка на живих даних неможлива) чи винести в окреме bounded reliability-issue згідно з AGENTS.md «do not hide generic runtime fixes»? Зміна вже зроблена й покрита тестами. Якщо рішення — «окремо», її можна перенести без змін у коді #37.
2. **Memory D-6:** tie-break «Extract вище за Seqthera» — варіант A (замінити рядок у `/priorities.md`) чи B (відкинути)?
3. **Memory D-7:** «вийти з A1 до нового року» — досі актуально?
4. **Затвердження точного diff §10** (B + C + D) перед будь-яким записом у Memory.
5. **Live smoke #37** (окремий дозвіл, docs/04 §27): один create з якорем проєкту, один без. Перевірити, що live-форми з §3.2 не змінились, модель справді викликає `attach_label`, і картка має правильний label за прямим читанням. Тестову картку Daniel архівує вручну.
6. **Sync Skill** `task-management` в Anthropic workspace і оновлення Agent — окремим авторизованим кроком (не виконано).

## 12. Явні підтвердження

- Memory write: **ні** (лише читання)
- Trello mutation: **ні** (Trello REST/MCP не викликався взагалі; використано записані події Session і публічні документи провайдера)
- Paid inference: **ні**
- Managed Session: **жодної не створено** (лише `sessions.list` / `events.list` існуючих)
- Agent update: **ні** (лише `agents.retrieve`)
- Skill sync / upload: **ні**
- Commit / push / deploy: **ні** (лише `git fetch` + `git merge --ff-only` до вже опублікованого `origin/main`)
- Issue close / коментар: **ні**
- Roadmap update: **ні**
- Calendar: **ні**

## 13. Відкладене / ручне

- Живий smoke #37 (§11.5) і вся live-валідація форм.
- Sync Skill / оновлення Agent (#33 promotion).
- Опційно, вручну Daniel: архівувати шаблонні картки онбордингу; поставити labels на сім історичних карток без label. Djonik цього не робить.
- Мутації з порожнім набором перевірених полів (наприклад, невідома `action` без полів) і далі trivially verified будь-яким валідним читанням картки. Це було так і до #37, у цьому проході не змінювалось; кандидат на окреме reliability-питання.
- Label у самому create не використовується, доки провайдер його явно не задокументує.
- Коли з'явиться `/rhythm.md` (docs/01 §10, #39) — не в цьому issue.

## 14. `git diff --stat` і `git status --short`

```text
 .claude/skills/task-management/SKILL.md |  28 ++++-
 src/djonikClient.test.ts                | 110 +++++++++++++++++++
 src/skills.test.ts                      |  75 +++++++++++--
 src/trelloMutationLedger.test.ts        |   3 +-
 src/trelloMutationLedger.ts             | 180 +++++++++++++++++++++++++++++---
 5 files changed, 373 insertions(+), 23 deletions(-)
```

```text
 M .claude/skills/task-management/SKILL.md
 M src/djonikClient.test.ts
 M src/skills.test.ts
 M src/trelloMutationLedger.test.ts
 M src/trelloMutationLedger.ts
?? docs/33_ISSUE_37_SOURCE_AND_MEMORY_PROPOSAL.md
?? src/projectLabel.test.ts
?? src/projectLabel.ts
```

---

## 15. Follow-up — Product Owner approval and Memory migration

Дата: 2026-09-23. Базовий HEAD незмінний: `5dc1d59`. Canonical NOW у `docs/02` (рядок 60) і далі **#37**, єдиний пункт.

### 15.1 Рішення Product Lead

1. **Підтримку живої форми `{"cards":{"nodes":[card],"totalCount":1}}` залишено всередині #37.** Це вузька сумісність із реальним провайдером, без якої перевірка #31 на живих даних неможлива. Сувора fail-closed логіка і регресії збережені без змін: нуль або кілька вузлів, наступна сторінка, сторонні ключі, голий `{nodes}` → не картка.
2. **Невикористаний helper резолюції проєкту вилучено:** видалено `src/projectLabel.ts` і `src/projectLabel.test.ts`. Причина: runtime його не викликав, а він дублював у коді міркування Claude. Djonik лишається Claude-native: проєкт визначає Claude + Skill `task-management`, доступні labels дає свіжий `list_labels`, а код тримає лише жорстку постумову запису. Заміни (роутера, парсера, regex, intent-шару) не додано.

Регресії #37, що жили у видаленому тестовому файлі, **перенесено** у `src/trelloMutationLedger.test.ts` (17 тестів: жива форма результату, label-постумова, порівняння за provider id, create + attach як дві мутації, часткова успішність, same-id replay). Разом із resolution-helper'ом прибрано лише 4 тести, що перевіряли саме його (`resolveProjectLabel` / `extractBoardLabels`). Семантичні Skill-тести залишено повністю.

### 15.2 Рішення Product Owner (коментар в #37 від 2026-09-23)

1. **Extract vs Seqthera** — гнучкий дефолт / тай-брейк, а не абсолютне правило.
2. **A1** — намір вийти з проєкту до нового року лишається актуальним *описовим* контекстом, але не є дедлайном, зобов'язанням чи правилом пріоритизації.
3. **Міграцію Memory затверджено** з цими двома уточненнями, з обов'язковими preconditions за хешами.

### 15.3 Перевірка передумов (до будь-якого запису)

Прочитано production Memory read-only і звірено **всі 8** об'єктів із §10.A за `memory id`, шляхом, поточною версією, розміром і SHA-256 (хеш також перераховано локально з вмісту):

```text
MATCH /work-priorities.md /preferences.md /cossack-labs.md /extract.md
MATCH /seqthera.md /azov-a1.md /limen.md /trello-conventions.md
PRECONDITIONS_OK        (8/8, дрейфу немає; store «Djonik Memory», не архівовано)
```

Дрейфу не було, тож затвердження лишалося чинним. Крім того, кожна операція запису надсилалась із `precondition: { type: "content_sha256" }` на поточному хеші, тож паралельна зміна дала б 409, а не перезапис.

### 15.4 Виконані операції Memory

Усі — через production Memory API, без Managed Session і без inference. Перейменування зроблені через `memories.update({ path })`, тому `memory id` та історія версій збереглися.

| # | Операція | Об'єкт | Зміна вмісту |
|---|---|---|---|
| 1 | `update(path + content)` | `/work-priorities.md` → `/priorities.md` | лише рядок Extract vs Seqthera (§15.5) |
| 2 | `update(content)` | `/preferences.md` (шлях той самий) | заміна на затверджений текст §10.C |
| 3 | `update(path + content)` | `/extract.md` → `/projects/extract.md` | вставка блоку вимоги тону §10.C |
| 4 | `update(path + content)` | `/azov-a1.md` → `/projects/azov-a1.md` | лише два рядки про вихід з проєкту (§15.6) |
| 5 | `update(path)` | `/cossack-labs.md` → `/projects/cossack-labs.md` | **байт-у-байт**, SHA не змінився |
| 6 | `update(path)` | `/seqthera.md` → `/projects/seqthera.md` | **байт-у-байт**, SHA не змінився |
| 7 | `update(path)` | `/limen.md` → `/projects/limen.md` | **байт-у-байт**, SHA не змінився |
| 8 | `delete` | `/trello-conventions.md` | прибрано з поточного вигляду; у історії з'явилась версія `deleted` |

`/commitments/` **не створено** — лишається зарезервованим для #34. Memory Store не видалявся і не архівувався.

### 15.5 Підтвердження гнучкого правила Extract / Seqthera

У `/priorities.md` змінено рівно один рядок у «Conflict guidance»; решта документа не змінена:

```diff
-- Extract vs Seqthera, both non-urgent → choose the most strategically useful bounded outcome, portfolio value, and which project has been neglected longer.
+- Extract vs Seqthera competing for the same working block → normally lean toward Extract as the default tie-break, but keep this flexible: current deadlines, urgency, strategic value, neglected work, or an explicit current priority may justify Seqthera first.
```

Абсолютного формулювання «Extract ranks higher priority than Seqthera» у Memory більше немає (перевірено окремою перевіркою).

### 15.6 Підтвердження описового статусу A1

У `/projects/azov-a1.md` змінено два рядки, що стосувались виходу з проєкту. Другий рядок (у «Planning guidance») довелось уточнити теж: у попередній редакції він був планувальним правилом («avoid treating it as a long-term strategic growth project»), що суперечило б рішенню §2.2. Решта брифу — роль, scope, робоча модель, синк, контакти, комерційна модель, keywords — не змінена:

```diff
 Strategic context:
-- Daniel intends to leave this project before the new year, so treat it as a temporary medium-term commitment rather than a long-term permanent client.
+- Daniel has said he currently expects to leave this project before the new year. Treat this as descriptive project context, not a hard planning rule, deadline, or commitment; do not let it automatically drive prioritization.

 Planning guidance:
-- remember that Daniel plans to leave the project before the new year, so avoid treating it as a long-term strategic growth project.
+- keep the expected exit before the new year in mind as background context only; by itself it is neither a deadline nor a reason to deprioritize the project.
```

### 15.7 Фінальне дерево Memory і хеші

Прочитано після всіх записів:

```text
/preferences.md
/priorities.md
/projects/azov-a1.md
/projects/cossack-labs.md
/projects/extract.md
/projects/limen.md
/projects/seqthera.md
```

| Шлях | memory id | Поточна версія | Байт | SHA-256 |
|---|---|---|---|---|
| `/priorities.md` | `mem_01A4dWFeSAFdZDoWCJQ26sdU` | `memver_01Khb6bWULuDiV5LKVxR8CCp` | 3059 | `6a899889787c1d8a28d7164c3912f4176ecd9a18fe46510b30dd0c7c59ad3a5d` |
| `/preferences.md` | `mem_01RovqJjmWtQh7aWiXMdfGv7` | `memver_0187swtygnr6xMF8iYaFxVKj` | 399 | `ae67779bcab5f51b406b3c98a2f8dff7b03f6fdf72c411fb35f1eba4b7b3dc40` |
| `/projects/extract.md` | `mem_0144nAARk796FA7VmjJns1Bg` | `memver_01MZDWSUY7BEaEm5byhZUrou` | 1913 | `1112605bc94124e5b2884fb67102ce595321e5164dfd7b4a0157a31adb59e60d` |
| `/projects/azov-a1.md` | `mem_012TQKL78n1D8gKtV6CoKgG9` | `memver_01ANx1aoWuX8Kxip1mZwS8oJ` | 1606 | `cb613f6c5abb51c328ed8607fedb99f674c6f97d5ead50f3af2a39fb7596ae20` |
| `/projects/cossack-labs.md` | `mem_014FHKgbxX5PfDXXH12F2XLU` | `memver_011EETpaj79Ny4cvrqoFYYfs` | 1715 | `c6fe9b51b8796ea2eca57388df4f77c1012a373fa6a908af65e8b90759200ccd` (без змін) |
| `/projects/seqthera.md` | `mem_01BPsjzcZm1AStq9Y1ex8pBh` | `memver_01BhiniFS8vhNYE4bGsqHvuY` | 2158 | `987de32e12f850fa1032c7a6b65f6e85dd9674f7760007137b85a03e7b1692d9` (без змін) |
| `/projects/limen.md` | `mem_01UQ3fh8tVmECQc9EF3oMC7X` | `memver_013YAyctqr4fkTvsDc5y4giH` | 1946 | `81555a54e99ebeccf8eb485dc2beaddbaa8486bdbb0ec7599bd7d62b52a8fe12` (без змін) |

Усі сім `memory id` — ті самі, що до міграції. Три брифи мають ідентичні SHA до і після, тобто перенесені без жодної зміни тексту.

### 15.8 Детермінована перевірка після запису

31 перевірка, усі PASS (`pass: 31, fail: 0`):

- `/work-priorities.md` більше немає в поточному вигляді; `/priorities.md` є і зберіг свій `memory id`;
- у `/priorities.md` тай-брейк гнучкий, абсолютного формулювання немає, інші правила конфліктів на місці;
- `/preferences.md` містить лише дві затверджені преференції; прибрано snack, плани дня, дедлайн Trello, тон Extract і абсолютний пріоритет;
- усі п'ять брифів існують під `/projects/*`;
- вимога тону є в `/projects/extract.md`, бриф збережено, живий стан Trello не додано;
- формулювання A1 описове, не керує пріоритизацією, залишків жорсткого правила немає, решта брифу збережена;
- `/trello-conventions.md` немає в поточному вигляді;
- жодного вигаданого файлу в `/commitments/`;
- у поточному вигляді рівно 7 memory; усі SHA перераховуються з вмісту;
- Memory Store існує і не архівований; історія версій доступна: **23 → 31 версія** (7 оновлень + 1 `deleted` для `trello-conventions.md`).

### 15.9 Нічого незатвердженого не додано

У Memory не з'явилось жодного нового факту поза затвердженим diff: тексти або перенесені байт-у-байт, або змінені рівно в межах §10.C і уточнень §2.1/§2.2. Живий стан Trello, дати, задачі, плани й зобов'язання не записувались. `/commitments/` не створено.

### 15.10 Тести й перевірки після прибирання helper'а

```text
node --import tsx --test src/trelloMutationLedger.test.ts   → tests 60 / pass 60 / fail 0
npm test                                                     → tests 523 / pass 523 / fail 0
npm run typecheck                                            → tsc --noEmit, без помилок
git diff --check                                             → чисто (exit 0)
```

523 замість 527: прибрано 4 тести, що перевіряли лише видалений helper. Решту 17 тестів #37 перенесено, а не видалено.

### 15.11 Що ще лишається для приймання #37

- **Skill sync / upload — НЕ зроблено.** `task-management` у workspace Anthropic досі стара версія.
- **Agent не оновлювався** (production і далі v21).
- **Trello не мутувався** — жодного запису, жодного relabel, onboarding-картки й сім карток без label не чіпались (лишаються ручною опцією Daniel).
- **Ізольований live smoke #37 не виконувався** (окремий дозвіл і бюджет за docs/04 §27): один create з якорем проєкту, один без; перевірити, що живі форми з §3.2 не змінились і що модель справді викликає `attach_label`.
- Roadmap / issue не оновлювались і не закривались; комітів, push і deploy немає.
