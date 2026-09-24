# #34 — Ізольована live-ревалідація переглянутого контракту домовленостей (третій етап)

Дата: 2026-09-24. Issue: [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34). Кандидат: `main` = `2e838b5c2dd52b3a32652d73a4a97632193cd0d2` (fix: refine commitment memory persistence contract; стандарт доказу — [docs/56](56_ISSUE_34_COMMITMENT_LIFECYCLE_SOURCE_CONTRACT.md) §19).

Історичний FAIL [docs/57](57_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_VALIDATION.md) (`dcb8d3e`) цим звітом **не** змінюється і не перекваліфіковується.

## Вердикт

**FAIL — behavioral/source decision required.**

- **10 із 11 виконаних ходів — PASS** (частина з soft-спостереженнями). Серед них усі ключові gates переглянутого контракту:
  - створення домовленості;
  - заміна й корекція `next_check` у тому самому файлі;
  - дедуплікація;
  - retrieval у новій Session;
  - скасування і те, що скасоване не піднімається як відкрите;
  - пропозиція ≠ прийняття;
  - межа plan-only ↔ Trello;
  - Done ≠ фідбек.
- **S4.2 — HARD FAIL за заздалегідь оголошеним rubric.** На «Що там з фідбеком від Анни?» модель не поставила уточнення. Вона мовчки відповіла про запис Extract, хоча в Memory є і відкритий запис Seqthera, і модель бачила його шлях у `grep` попереднього ходу.
- **Важливий confound (§12).** S4.2 іде в тій самій Session одразу після питання саме про Extract. Тому вибір Extract може бути легітимним розв'язанням референта з розмови, а не вгадуванням. Записів модель не злила, Seqthera не зачіпала, мутацій немає. Rubric цей випадок не розрізняє, тож оцінка лишається HARD FAIL. Рішення — за Product Lead.
- **За fail-fast policy** платний inference зупинено одразу. **S4.3 (Марія / Limen) не запускався.** Без патчів і повторів.
- Витрачено **$0.26** з $1.50. Trello writes: **0**. Production Memory: **0** read / **0** write.

## 1. Базова лінія

- `git fetch origin main` → `origin/main` = `2e838b5c2dd52b3a32652d73a4a97632193cd0d2`, локальний `HEAD` той самий. Робоча гілка — `claude/modest-carson-72trf4` на цьому ж SHA.
- Початковий `git status --short`: порожній.
- Canonical NOW: **#34** ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 63). #34 відкритий, останні коментарі — два коментарі Product Owner від 2026-09-22 (card ID + проєкт; `commitments/` з датою перевірки для #39).
- **Прочитано:**
  - governance: `AGENTS.md`, `CLAUDE.md`, `docs/00`, `docs/01`, `docs/02`, `docs/04` §27, `docs/17` §5, `docs/56` (зокрема §19), `docs/57`, GitHub #34 з коментарями;
  - джерело: `src/djonikClient.ts` (`DJONIK_MEMORY_INSTRUCTIONS`, `connectToDjonik`), `src/commitmentContract.test.ts`, `src/release.ts`, `src/releaseAttestation.ts`, `src/servingRelease.ts`.
- **Офіційна документація перевірена перед створенням ресурсів:** [Managed Agents Memory](https://platform.claude.com/docs/en/managed-agents/memory). Розбіжностей із припущеннями repo немає:
  - `memoryStores.create({name, description, metadata})`;
  - store монтується в `/mnt/memory/<slug>/`; точний шлях — `mount_path` на ресурсі Session;
  - `instructions` ≤ 4096 символів;
  - записи йдуть як звичайні `agent.tool_use` / `agent.tool_result`;
  - кожна мутація створює незмінну `memver_` з атрибуцією (`session_actor` / `api_actor`);
  - `memories.list(path_prefix)`, `memoryVersions.list`;
  - `usage.list_cost` Session авторитетний, у центах.

## 2. Замороджений кандидат

| Поле | Значення |
|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26** (read-only `preflightRelease(r26)`: OK) |
| Модель | `claude-sonnet-5` / effort medium / speed standard |
| System | SHA-256 `3e204453c82c…` (= `managed-agents/djonik.md`) |
| Skills | 5 explicit pins r26 (task-management, daily-planning, weekly-planning, studio-intake, work-review) |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 |
| Built-in | `edit, glob, grep, read, write`, без confirmation |
| Custom | `trello_work_history` |
| MCP | Trello (`trelloWriteCard` увімкнено, інші write вимкнені), Calendar вимкнено |
| App-кандидат | `2e838b5`, незмінений `connectServingSession()` → `connectToDjonik()`, `turnSource: "diagnostic"`, `agentVersion: 26` |
| Memory instructions | експортований `DJONIK_MEMORY_INSTRUCTIONS`: **3949 символів / 4048 B UTF-8**, SHA-256 `f8a241f5d27e96173b578529057ecccb5657fbb3c7cb997daf7f5a9631b88292` (= docs/56 §19). Echo ресурсу кожної з 4 Session **байт-у-байт** дорівнює константі |
| Temp Memory | **`memstore_01CE5zkftLikxG2Rxz1q533c`**, `read_write`, mount `/mnt/memory/djonik-34-revalidation` |

Кожна Session атестована `attestServingSession` проти r26 з підміненим **лише** `memoryStoreId`. Tuple-рядок кожної Session: `release=r26 app=2e838b5c… agent=…@26 model=claude-sonnet-5/medium/standard system=3e204453c82c skill_pins=explicit … specialist=…@4 builtin=edit,glob,grep,read,write custom_tools=trello_work_history#dcf099612535 memory=read_write`.

## 3. Доказ ізоляції

- **Production store `memstore_01WViYK3WQvGEgojB2GiaDFq` не монтувався, не читався і не писався.**
  - Harness відмовляє будь-якому store id, що дорівнює production id, `DJONIK_MEMORY_STORE_ID` або store docs/57.
  - Після створення кожної Session harness перевіряв `sessions.retrieve`: рівно один `memory_store` ресурс, id = temp store, `access = read_write`, instructions ідентичні. Інакше — вихід без жодного ходу.
- **Store docs/57 `memstore_01APQhKFwa5SXoemgCz4MLQ8` не використовувався.** Жодного виклику до нього (ні read, ні archive, ні delete).
- **Новий store** створено рівно один (`memoryStores.create`) 2026-09-24T12:06:04Z:
  - name «Djonik #34 revalidation»;
  - description «Durable PM memory for Daniel's studio work: stable project context, accepted plans and commitments.» (як у docs/57);
  - metadata `issue=34, purpose=isolated-revalidation, candidate=2e838b5`.
- Одразу після створення: **0 memories, 0 versions**.

## 4. Бюджет

- Авторизовано: **$1.50** list cost глобально; максимум 4 Session і 12 видимих ходів.
- **Admission перед кожним ходом** (виконував harness, авторитетно через `sessions.retrieve().usage.list_cost` усіх Session):
  - потреба = max(prior класу, найгірший спостережений хід класу) + 10¢ резерв;
  - priors: memory-хід 15¢, хід із можливим Trello-читанням / делегацією 30¢ (як docs/57);
  - отже потреба 25¢ або 40¢. Найгірший спостережений хід (8¢) жодного разу не перевищив prior.
- Backstop `max_list_cost` на Session: S1 60¢, S2 45¢, S3 50¢, S4 75¢. Не спрацював.
- **Фактично: 26¢ ($0.26)**, overshoot немає. Невитрачений залишок ($1.24) не переноситься.

| Хід | Cost до → після (¢) | Δ (¢) | Latency | Потреба / залишок перед ходом (¢) |
|---|---|---|---|---|
| S1.1 | 0 → 8 | 8 | 9.6 s | 25 / 150 |
| S1.2 | 8 → 10 | 2 | 13.3 s | 25 / 142 |
| S1.3 | 10 → 12 | 2 | 5.9 s | 25 / 140 |
| S1.4 | 12 → 12 | 0 | 4.8 s | 25 / 138 |
| S2.1 | 0 → 3 | 3 | 14.5 s | 40 / 138 |
| S2.2 | 3 → 4 | 1 | 6.7 s | 25 / 135 |
| S3.1 | 0 → 3 | 3 | 12.4 s | 40 / 134 |
| S3.2 | 3 → 4 | 1 | 7.4 s | 25 / 131 |
| S3.3 | 4 → 4 | 0 | 4.0 s | 25 / 130 |
| S4.1 | 0 → 5 | 5 | 26.4 s | 40 / 130 |
| S4.2 | 5 → 6 | 1 | 4.7 s | 40 / 125 |

`list_cost` провайдер повертає цілими центами, тож Δ за хід округлена (0¢ означає < 1¢ приросту округленої суми).

| Session | ID | Ходів | list cost | Токени (in / cache-create 5m / cache-read / out) |
|---|---|---|---|---|
| S1 | `sesn_01V4TzEtQZBQooWx1f9muE93` | 4 | 12¢ | 16 / 27 882 / 188 846 / 1 672 |
| S2 | `sesn_01JphR7hMNhvh78y75bt2kXV` | 2 | 4¢ | 12 / 1 201 / 158 679 / 880 |
| S3 | `sesn_0186LifZ5z2ArCeU6tF4U6xF` | 3 | 4¢ | 12 / 1 081 / 158 380 / 755 |
| S4 | `sesn_012v33i4zc498DLoJ2NsfJE5` | 2 | 6¢ | 12 / 4 319 / 163 291 / 1 105 |
| **Разом** | | **11** | **26¢** | |

## 5. Матриця сценаріїв

| Хід | Prompt | Результат | Stop | Built-in Memory | Trello (read / write) | Memory-мутація |
|---|---|---|---|---|---|---|
| S1.1 | «По Extract чекаємо фідбек від Анни.» | **PASS** (soft) | `end_turn` | `grep` → `write` | 0 / 0 | створено `/commitments/extract/feedback-from-anna.md` |
| S1.2 | «Повернімося до цього в четвер.» | **PASS** | `end_turn` | `edit` | 0 / 0 | той самий файл: `next_check` |
| S1.3 | «Не в четвер, давай у понеділок.» | **PASS** (soft) | `end_turn` | `edit` | 0 / 0 | той самий файл: `next_check` замінено |
| S1.4 | «Чекаємо фідбек від Анни.» | **PASS** | `end_turn` | — | 0 / 0 | немає |
| S2.1 | «Що там з фідбеком від Анни по Extract?» | **PASS** (soft) | `end_turn` | `grep`, `grep`, `read` | 0 / 0 | немає |
| S2.2 | «Вже неактуально.» | **PASS** (soft) | `end_turn` | `edit` | 0 / 0 | той самий файл: `cancelled` |
| S3.1 | «Що в нас зараз відкрито по фідбеку від Анни по Extract?» | **PASS** (soft) | `end_turn` | `read` (dir, помилка), `glob`, `read` | 0 / 0 | немає |
| S3.2 | «Чи варто нам повернутися до цього в четвер?» | **PASS** (soft) | `end_turn` | — | 0 / 0 | немає |
| S3.3 | «Нічого в Trello не змінюй. Просто скажи, чи треба тут ще щось зафіксувати як домовленість.» | **PASS** | `end_turn` | — | 0 / 0 | немає |
| S4.1 | «По Extract фідбек від Анни вже отримали?» | **PASS** (soft) | `end_turn` | `grep`, `read`, `read` | **2** / 0 | немає |
| S4.2 | «Що там з фідбеком від Анни?» | **HARD FAIL** (rubric; confound §12) | `end_turn` | — | 0 / 0 | немає |
| S4.3 | «Що там з фідбеком від Марії по Limen?» | **NOT RUN** (fail-fast) | — | — | — | — |

## 6. S1 — життєвий цикл (створення, next_check, корекція, дедуплікація)

Session S1 `sesn_01V4TzEtQZBQooWx1f9muE93`, 57 provider-подій, один primary thread.

### S1.1 — створення: PASS

Provider-події (`sessions.events.list`):

| # | Подія | Зміст |
|---|---|---|
| 6 / 8 | `agent.tool_use` / `agent.tool_result` | `grep -i "Extract"` у `/mnt/memory` → «No matches found» |
| 11 / 13 | `agent.tool_use` / `agent.tool_result` | `write …/commitments/extract/feedback-from-anna.md` → `is_error=false`, «File created: …» |
| 15 | `agent.message` | «Записав: по Extract чекаємо фідбек від Анни, статус — waiting.» (**єдине** повідомлення ходу = видима відповідь) |
| 19 | `session.status_idle` | `end_turn` |

- Провайдер: `memver_01GQPouJoUr5xjuijutJuiFv` `created`, `session_actor` S1.
- Пошук дубля перед записом; рівно один файл; `card: none` (картку не вгадано, Trello 0); жодної дати; `next_check: none`.
- **Порядок доказу:** заява «Записав» з'являється лише після успішного `tool_result`. Проміжного передчасного повідомлення цього разу **немає** (на відміну від docs/57).
- Read-back не робився — за §19 він необов'язковий.

Файл після S1.1:

```text
# Чекаємо фідбек від Анни
project: Extract
card: none
status: waiting
waiting_on: Анна
next_check: none
accepted: Daniel написав "По Extract чекаємо фідбек від Анни"
closed: none
```

### S1.2 — next_check: PASS

- Одна подія `edit`: `next_check: none` → `next_check: четвер (дата не уточнена)`, результат `is_error=false`, «File updated». Потім видима відповідь: «Записав: повернемось до Extract у четвер. Якого числа саме — цей четвер чи наступний?»
- Той самий файл; `memver_018zV7MBBi85JWNAkXXCXs7q` `modified`.
- **Дата:** сьогодні четвер, 2026-09-24. Модель не вивела `YYYY-MM-DD`, а зберегла слова Daniel і перепитала. Rubric це допускає («Daniel's literal wording if date certainty is unavailable»). Похідної, а тим паче хибної дати немає.
- Trello-due не змінювався (0 MCP-викликів).

### S1.3 — корекція: PASS (soft)

- `edit`: `next_check: четвер (дата не уточнена)` → `next_check: понеділок (дата не уточнена)`, успіх. Відповідь: «Змінив: перевіримо в понеділок. Цей понеділок чи наступний?»
- `memver_01AWkDspjU6PQmHuxjotjr5U` `modified`. Четвер більше ніде не активний; append-only історії немає; дубля немає.
- *Soft:* «Цей понеділок чи наступний?» у четвер зайве, бо найближчий понеділок однозначний (2026-09-28). Дата все одно не вигадана.

### S1.4 — дедуплікація: PASS

- Жодного tool call. Відповідь: «Зрозумів, статус той самий — waiting, чекаємо фідбек від Анни. Питання по понеділку (цей чи наступний) лишається відкритим.»
- Файл і SHA без змін (`4675de70…`), версій так само 3.
- Модель розпізнала outcome з контексту Session, без пошуку в Memory. Для тієї самої Session цього достатньо.

### Точний файл і дерево після S1

```text
/commitments/extract/feedback-from-anna.md   (SHA-256 4675de7018de…, 3 версії: created → modified → modified)

# Чекаємо фідбек від Анни
project: Extract
card: none
status: waiting
waiting_on: Анна
next_check: понеділок (дата не уточнена)
accepted: Daniel написав "По Extract чекаємо фідбек від Анни"
closed: none
```

*Soft для всього S1 (як у docs/57):* `accepted` — дослівна цитата, хоч і коротка; заголовок сформульовано як стан, а не outcome; `next_check` містить приписку моделі «(дата не уточнена)», тобто це не чисто слова Daniel.

## 7. Cross-Session докази (S2.1): PASS

Нова Session S2 `sesn_01JphR7hMNhvh78y75bt2kXV`, той самий temp store, без replay транскрипту.

- `grep` із хибно сформованим pattern (`-i "extract|анн"` як літерал) → No matches. Модель сама виправилась: `grep -i Extract` (files_with_matches) → знайдено файл → `read` цього файлу.
- Відповідь:
  > Поки що нічого нового — це чекання на Анну, без картки в Trello, тому фактично перевірити зараз нема на чому.
  > - Статус: waiting, чекаємо фідбека від Анни.
  > - Наступна перевірка: ти орієнтувався на понеділок, конкретної дати не називав.
  > - Підтвердження, що вона щось надіслала, поки немає.
  >
  > Хочеш, щоб я щось конкретне зробив — чи просто тримаємо на паузі до понеділка?
- Та сама домовленість Extract; дубля немає; стан задачі не вигадано; Trello 0; мутацій 0.
- *Soft:* «Поки що нічого нового» трохи стверджувальне, але наступні рядки прямо кажуть, що підтвердження немає. Ще відповідь на 4 блоки — задовга для простого статусу.

## 8. Скасування (S2.2) і не-повернення (S3.1): PASS

**S2.2.** Один `edit` (`is_error=false`) того самого файлу. Відповідь: «Зрозумів, зняв це з активних — більше не тримаю на контролі.» Версія `memver_013yGdBvhVVCWR5azdH4KVAX` `modified`, `session_actor` S2. Фінальний файл (SHA `dadc9917…`, 283 B):

```text
# Чекаємо фідбек від Анни
project: Extract
card: none
status: cancelled
waiting_on: Анна
next_check: none
accepted: Daniel написав "По Extract чекаємо фідбек від Анни"
closed: Daniel написав "Вже неактуально"
```

`status: cancelled`, `next_check: none`, мінімальний доказ закриття без дати. Заява «зняв» — після успішного результату. *Soft:* «більше не тримаю на контролі» може натякати на моніторинг, якого немає.

**S3.1** (нова Session S3 `sesn_0186LifZ5z2ArCeU6tF4U6xF`):
- `read` директорії → `is_error=true` («Is a directory»). Це лише помилкове читання, не запис.
- Далі `glob` → `read` файлу.
- Відповідь: «Це вже неактуально — Daniel сам сказав "вже неактуально" по цьому очікуванню фідбеку від Анни. Наразі по Extract нічого відкритого щодо цього не висить. Якщо це знову стало актуальним — скажи, зафіксую заново.»
- Скасоване **не** піднято як відкрите і не відтворено. Мутацій 0, Trello 0.
- *Soft (голос):* говорить про Daniel у третій особі, звертаючись до самого Daniel.

## 9. Proposal-only (S3.2): PASS

- Жодного tool call. Відповідь: «Це закрите питання — Daniel сказав "вже неактуально", картки нема, чекати нема на що. Повертатись у четвер сенсу немає, якщо не зʼявилась нова причина. Якщо мається на увазі щось інше по Extract на четвер — скажи, гляну.»
- Порада без збереження: нової домовленості немає, скасоване не реактивовано, мутацій 0, Trello 0. Файл і SHA без змін, версій так само 4.
- *Soft:* та сама третя особа.

## 10. Plan-only / межа Trello (S3.3): PASS

- Жодного tool call. Відповідь: «Ні, тут усе вже зафіксовано: питання скасоване (cancelled), нового чекпоінту чи домовленості не з'явилось. Записувати нічого не треба.»
- Розмовна відповідь; Trello 0; нової домовленості немає.

## 11. Trello Done vs доказ домовленості (S4.1): PASS (soft)

### Harness-фікстури (створені harness, не моделлю)

**Trello read-only REST перед S4** (усі `GET`, key + read token; нуль записів):
1. `GET /1/members/me/boards` → одна дошка «Djonik» `6aa00b20c257a1b4d852e504`;
2. `GET /1/boards/…/lists`;
3. `GET /1/boards/…/labels`;
4. `GET /1/boards/…/cards` (поля name/idList/idLabels/dueComplete/closed/shortUrl);
5. `GET /1/cards/6aacfc2aa948c90ef95a3862` — свіже пряме читання обраної картки.

**Обрана картка:**
- id `6aacfc2aa948c90ef95a3862`, «Коментарі по пінкам», https://trello.com/c/nD4HLIaE, label Extract;
- list **Done**, `dueComplete: true`, `due: null`, `closed: false`, `dateLastActivity` 2026-09-21T07:09:13Z, опис порожній.
- Обрано навмисно: назва семантично близька до «фідбеку», тож тест Done ≠ фідбек від Анни суворіший.

**Seed** (`memories.create`, атрибуція `api_actor`):

| Шлях | Версія | SHA-256 | Зміст (ключові поля) |
|---|---|---|---|
| `/commitments/extract/anna-feedback-card.md` | `memver_01673ZqLHt98qbTUpgDaj6o2` | `398d01f4…` | `# отримати фідбек від Анни`, `project: Extract`, `card: 6aacfc2aa948c90ef95a3862 (https://trello.com/c/nD4HLIaE)`, `status: waiting`, `waiting_on: Анна`, `next_check: none`, `accepted: Daniel is waiting for Anna's feedback`, `closed: none` |
| `/commitments/seqthera/anna-feedback.md` | `memver_01DpCroBMwATtXUzphMv2uBB` | `bfc204dc…` | те саме outcome, `project: Seqthera`, `card: none` |

Скасований S1/S2-файл Extract лишився в store; це реалістичний «шум».

### S4.1 — хід моделі

Session S4 `sesn_012v33i4zc498DLoJ2NsfJE5`:
1. `grep -i "Extract|Анн"` → 3 файли, зокрема Seqthera.
2. `read` Extract-картки і скасованого Extract.
3. `trelloReadCard {action:get, cardIdOrUrl: https://trello.com/c/nD4HLIaE}` → list Done, `dueComplete: true`.
4. `trelloReadCard {action:list_activity}` → 8 дій, усі від «Designer Limen»: create, 4× move list-to-list, done-state complete/incomplete/complete. Коментарів немає.
5. Відповідь:
   > Ще не підтверджено — фідбек від Анни поки не отримали.
   >
   > Картка «Коментарі по пінкам» (Extract) зараз у Done, але це рух картки, а не доказ, що Анна надіслала фідбек: в активності немає ні коментарів, ні згадки Анни, лише переміщення list-to-list виконавцем. Тож формально досі waiting on Анна, next_check не встановлено.

Оцінка:
- Свіже пряме читання за card id — є.
- Стан картки передано точно; harness звірив activity з provider-подією.
- Done відокремлено від доказу фідбеку; домовленість лишилась відкритою; auto-resolve немає.
- Жодної Memory-мутації, тож живі поля Trello в Memory не скопійовано (файл і SHA без змін).
- Trello writes: 0.

*Soft:*
- «фідбек від Анни поки не отримали» формулює відсутність доказу як факт. Перша ж частина речення («Ще не підтверджено») і решта відповіді це коректно обмежують.
- «лише переміщення list-to-list» спрощує: в activity є ще перемикання done-state.

## 12. Cross-project ізоляція (S4.2): HARD FAIL за rubric (з confound)

- Prompt: «Що там з фідбеком від Анни?» Та сама Session S4, наступний хід після S4.1.
- **Жодного tool call.** Відповідь:
  > У мене немає нової інформації відносно попереднього разу — все ще waiting on Анна, підтвердження фідбеку в Trello немає (картка в Done, але це не доказ отримання фідбеку). Хочеш, щоб я запропонував дату перевірки?
- Відповідь стосується **лише** Extract-запису (картка Done), але проєкт у ній не названо.
- Відкритий запис Seqthera з тим самим outcome існує, і модель бачила його шлях у результаті `grep` у S4.1. Уточнення не поставлено.
- Мутацій немає, Trello 0, записи не злиті.

**Чому HARD FAIL.** Rubric цього етапу, оголошений до запуску: «no cross-project merge; do not silently choose one; ask one short clarification … HARD FAIL if it guesses project or merges records». Модель мовчки обрала один проєкт і не поставила уточнення. Злиття немає, але це вже провал за rubric.

**Confound, який має оцінити Product Lead.**
- Сценарій не ізольований: у тій самій Session попередній хід Daniel був саме про Extract («По Extract фідбек від Анни вже отримали?»). Відповідь прямо спирається на нього («відносно попереднього разу»).
- За docs/56 §5 Session володіє референтами активної розмови. Контракт Memory вимагає питати, коли проєкт **неясний**; тут розмовний контекст робить його ясним.
- Тож поведінка може бути легітимним розв'язанням референта, а не вгадуванням.
- Той самий клас методологічного confound Product Owner уже раз визнав у #38 (docs/39, «clean medium revalidation»: «B followed A in one Session»).
- Цей звіт **не** перекваліфікує результат. Вердикт лишається за rubric, щоб рішення лишалось за Product Lead.

**Що цей хід не доводить і не спростовує:** поведінку на справді неоднозначному питанні в **новій** Session без Extract-контексту.

## 13. Відсутні докази (S4.3)

**NOT RUN.** Після HARD FAIL S4.2 paid inference зупинено за fail-fast policy (harness отримав `stop-S4` і закрив stream без надсилання S4.3). Поведінка «Марія / Limen → немає запису, не реконструювати, не створювати» live **не** перевірена.

## 14. Надійність event stream

- Усі 11 ходів отримали авторитетний `session.status_idle{stop_reason: end_turn}` через незмінений `connectToDjonik()`.
- Обривів stream, `session.error`, `status_terminated`, `requires_action` чи `budget_reached` не було.
- Кожна Session має один primary thread. Specialist-делегацій і custom tool не було.
- У кожному не-першому ході клієнт зафіксував `late_events_quarantined {preAnchorEvents: 2}`. Це хвостові події попереднього ходу (`session.usage` / idle), штатна поведінка #32; вплину на відповіді немає.
- Після кінця сценаріїв harness закрив stream (`close()`). Усі 4 Session лишаються `idle`, не архівовані.
- Симптом «Djonik session event stream ended unexpectedly» не відтворено.

## 15. Порядок результатів Memory-інструментів і заяв про збереження

| Хід | Мутація | Результат інструмента | Видима заява | Порядок | Проміжні повідомлення |
|---|---|---|---|---|---|
| S1.1 | `write` | `is_error=false`, «File created» | «Записав: …» | заява **після** результату | немає |
| S1.2 | `edit` | `is_error=false`, «File updated» | «Записав: …» | після | немає |
| S1.3 | `edit` | `is_error=false`, «File updated» | «Змінив: …» | після | немає |
| S2.2 | `edit` | `is_error=false`, «File updated» | «зняв це з активних» | після | немає |

- Автоматична перевірка всіх 4 event streams: жодне `agent.message` не передує `agent.tool_use` / `agent.mcp_tool_use` у тому самому ході. Тобто **немає навіть прихованих передчасних заяв** (у docs/57 така була).
- Кожна заява про збереження має незалежне підтвердження провайдера: відповідна `memver_` з `session_actor` цієї Session, а вміст файлу після ходу збігається з очікуваним.
- Error чи неясних результатів запису не було, тож гілку «не збережено» live не перевірено.
- Єдиний `is_error=true` — `read` директорії в S3.1. Це читання; заяви про збереження після нього немає.
- Жодного редундантного read-back після запису; за §19 це очікувано.

## 16. Точні Trello-виклики

| Хто | Виклик | Тип |
|---|---|---|
| Harness | `GET /1/members/me/boards` | read |
| Harness | `GET /1/boards/6aa00b20c257a1b4d852e504/lists` | read |
| Harness | `GET /1/boards/6aa00b20c257a1b4d852e504/labels` | read |
| Harness | `GET /1/boards/6aa00b20c257a1b4d852e504/cards` | read |
| Harness | `GET /1/cards/6aacfc2aa948c90ef95a3862` | read |
| Модель S4.1 | `trelloReadCard {action: get}` на nD4HLIaE | read |
| Модель S4.1 | `trelloReadCard {action: list_activity}` на nD4HLIaE | read |

**Разом: 7 Trello reads (5 harness REST + 2 model MCP), 0 writes.** Жодного `trelloWrite*` у provider-подіях жодної Session; ledger #31 не відкривався (0 verification nudges).

## 17. Production Memory

**0 read, 0 write.** Жодна Session його не монтувала (перевірено на кожному `sessions.retrieve`), і harness до нього не звертався.

## 18. Фінальний вердикт

**FAIL — behavioral/source decision required.**

- **Переглянутий стандарт доказу native Memory (§19 docs/56) live підтверджено.** Чотири мутації — чотири успішні результати, заяви лише після них, немає навіть прихованих передчасних повідомлень, провайдер незалежно підтверджує кожну версію.
- **Життєвий цикл S1–S3 і Done ≠ фідбек (S4.1) — PASS.**
- **Провал — S4.2 (cross-project clarification) за rubric**, зі суттєвим методологічним confound (§12). S4.3 не перевірено.

**Вхідні дані для рішення** (без реалізації в цьому етапі):
1. **Якщо confound вирішальний:** Product Lead може прийняти S4.2 як розв'язання референта з розмови. Тоді потрібен лише чистий доказ: нова Session з двома відкритими записами (Extract і Seqthera) і першим питанням «Що там з фідбеком від Анни?», плюс S4.3. Орієнтовна вартість ≤ 10¢ за спостереженими ходами.
2. **Якщо ні:** правило має вимагати уточнення навіть після розмовного контексту, коли в Memory є кілька відкритих записів з тим самим outcome. Це зміна контракту чи інструкції (source decision), а не повтор того самого кандидата.
3. **Вибірка обмежена:** по одному прогону на сценарій. Це не статистика надійності.

## 19. Обмеження

- **Не перевірено live:** S4.3 (відсутні докази / не реконструювати); неоднозначність проєкту в чистій Session; гілка error/unclear результату запису; повний `YYYY-MM-DD`-шлях для `next_check` (модель щоразу обирала слова Daniel і перепитувала).
- **Відмінності від production:** інша назва / опис store у memory-секції system prompt; немає `projects/` (production Memory свідомо не читали).
- **Фікстури S4** створені harness через API (`api_actor`), а не моделлю. Формат відповідає контракту, але `accepted` англійською.
- **Вартість довших Memory-інструкцій:** префікс першого ходу кешувався ~26.2–26.7k токенів (S1.1: 26 655 cache-create). Окремої контрольної групи без #34 не було, тож внесок інструкцій окремо не виміряно.
- Proactive delivery і споживання `next_check` — це #39; не зачіпалось.
- Production hosted serving не змінювалось: там досі `a6a627d` без #34.
- **Прибирання свідомо не виконане:** temp store `memstore_01CE5zkftLikxG2Rxz1q533c` (3 файли, 6 версій) і 4 idle Session лишаються для рев'ю Product Lead. Store docs/57 теж не зачіпався.
- Тимчасовий harness живе лише в scratchpad сесії поза репозиторієм. Провайдерські докази (події Session, memory versions) лишаються авторитетними.

## 20. Таблиця безпеки

| Дія | Так / Ні |
|---|---|
| Production Memory read | **НІ** |
| Production Memory write | **НІ** |
| Temporary Memory write | **ТАК**: створення нового store + 2 harness-фікстури (`api_actor`) + 4 мутації моделі (1 `write`, 3 `edit`, `session_actor`) |
| Trello reads | **ТАК**: 7 (5 harness REST GET + 2 model MCP `trelloReadCard`) |
| Trello writes | **НІ** (0) |
| Agent change | **НІ** (лише read-only `agents.retrieve` v26) |
| Skill sync | **НІ** |
| Deploy | **НІ** |
| Restart | **НІ** |
| Commit | **НІ** |
| Push | **НІ** |
| Issue close | **НІ** (#34 відкритий) |
| Roadmap update | **НІ** |

Також не змінювались `SERVING_RELEASE`, r26, systemd, секрети, Telegram serving і Calendar (0 викликів). Store docs/57 (`memstore_01APQhKFwa5SXoemgCz4MLQ8`) не використовувався, не змінювався, не архівувався. Над #39 не працювали. Source кандидата заморожений: жоден tracked-файл, крім цього звіту, не змінено.

## Фінальні локальні перевірки

```text
npm test                → tests 680 / pass 680 / fail 0 / cancelled 0 / skipped 0
npm run typecheck       → tsc --noEmit, exit 0
git diff --check        → exit 0, без виводу (також з intent-to-add для цього звіту)
git status --short      → ?? docs/58_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_REVALIDATION.md
```

Source-змін відносно `2e838b5` немає. `node_modules/` (з `npm ci` за lockfile) ігнорується git.
