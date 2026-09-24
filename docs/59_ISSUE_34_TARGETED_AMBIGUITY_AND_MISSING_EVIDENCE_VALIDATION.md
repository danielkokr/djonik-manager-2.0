# #34 — Цільова live-перевірка: неоднозначність між проєктами і відсутні докази

Дата: 2026-09-24. Issue: [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34). Кандидат: `main` = `2e838b5c2dd52b3a32652d73a4a97632193cd0d2`.

Це вузький follow-up до [docs/58](58_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_REVALIDATION.md). Він закриває два чисті сценарії, яких бракувало: S5 (замість S4.2 без confound) і S6 (замість S4.3). docs/58 не змінювався.

## Вердикт

**INCONCLUSIVE — S6 не отримав авторитетного `end_turn` (`budget_reached`).**

- **S5 (чиста неоднозначність між проєктами) — PASS.** Перший хід нової Session. Модель знайшла обидва відкриті записи, відкинула скасований і поставила одне коротке уточнення. Мутацій і Trello-викликів немає, `end_turn`.
- **S6 (відсутні докази: Марія / Limen) — INCONCLUSIVE.** Хід зупинився на backstop Session `max_list_cost` = 12¢ (фінально 13¢) зі `stop_reason: budget_reached`. Клієнт штатно відкинув частковий текст, тож видимої відповіді моделі немає.
  - Контракт не порушено: вигадок немає, домовленості не створено, Memory-мутацій 0, Trello-записів 0.
  - Але хід **не відповідає очікуванню «Trello за замовчуванням нуль»**: було 6 Trello-читань без незалежної причини.
  - Обидва пошуки в Memory були синтаксично хибні, тож відсутність запису модель валідно не встановила (§14).
- Статусу «PASS — #34 behavioral acceptance evidence complete» цей прогін **не дає**. Авторизацію вичерпано (2 Session / 2 ходи). Без повторів.
- Витрачено **22¢** з 25¢. Memory writes 0, Trello writes 0, production Memory 0.

## 1. Базова лінія

- `git fetch origin main` → `origin/main` = `2e838b5c2dd52b3a32652d73a4a97632193cd0d2`; `HEAD` той самий (гілка `claude/modest-carson-72trf4`).
- Початковий `git status --short`: лише `?? docs/58_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_REVALIDATION.md`. Це незакомічений звіт попереднього етапу, збережено без змін. Tracked-змін немає.
- Canonical NOW: **#34** ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 63). GitHub #34 відкритий; нових коментарів після двох коментарів Product Owner від 2026-09-22 немає.
- Прочитано: `docs/56` (§19), `docs/57`, `docs/58`, #34 з коментарями, поточний `DJONIK_MEMORY_INSTRUCTIONS`.

## 2. Рішення Product Lead щодо confound у docs/58

- docs/58 прийнято як валідний доказ. Його вердикт за rubric лишається історичним: FAIL за заздалегідь оголошеним rubric, з документованим confound.
- **S4.2 не є доказом, що source-контракт хибний.** Попередній хід у тій самій Session був про Extract, тож активним референтом розмови був Extract. Архітектура дозволяє Session володіти активними референтами. Модель не злила записи, нічого не змінила і не вигадала проєкт.
- Для прийняття #34 бракувало чистого доказу неоднозначності без активного референта (S5) і сценарію S4.3 (S6). Source не змінювався.

## 3. Замороджений кандидат

| Поле | Значення |
|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26** (read-only `preflightRelease(r26)`: OK) |
| Модель | `claude-sonnet-5` / medium / standard |
| System | SHA-256 `3e204453c82c…` |
| Skills / specialist / tools | як у docs/58 §2: 5 explicit pins r26, specialist v4, built-in `edit,glob,grep,read,write`, custom `trello_work_history`, Trello MCP (write лише `trelloWriteCard`), Calendar вимкнено |
| App | `2e838b5`, незмінені `connectServingSession()` → `connectToDjonik()`, `turnSource: "diagnostic"` |
| Memory instructions | 3949 символів / 4048 B UTF-8, SHA-256 `f8a241f5d27e96173b578529057ecccb5657fbb3c7cb997daf7f5a9631b88292`. Echo ресурсу обох Session **байт-у-байт** ідентичне |

Обидві Session атестовано `attestServingSession` проти r26. Змінено лише Session-ресурс Memory: id → temp store, `access` → **`read_only`** (авторизовано як read-only повторне використання). Tuple кожної Session: `… memory=read_only`.

## 4. Повторно використаний temp store

`memstore_01CE5zkftLikxG2Rxz1q533c` («Djonik #34 revalidation», не архівований, metadata `issue=34, purpose=isolated-revalidation, candidate=2e838b5`). Монтувався **`read_only`** у `/mnt/memory/djonik-34-revalidation`. Новий store не створювався.

## 5. Production та історичний store не зачіпались

- Production `memstore_01WViYK3WQvGEgojB2GiaDFq`: **0 read / 0 write**.
- Store docs/57 `memstore_01APQhKFwa5SXoemgCz4MLQ8`: **0 звернень**.
- Harness відмовляє обом id (і `DJONIK_MEMORY_STORE_ID`).
- Після створення кожної Session harness перевіряв `sessions.retrieve`: рівно один `memory_store`, id = temp store, `access = read_only`, instructions ідентичні. Інакше — вихід без жодного ходу.

## 6. Стан фікстур перед S5 (точний)

Memory API (`memories.list` + `retrieve`, `memoryVersions.list`) — 3 файли, 6 версій. SHA збігаються з docs/58 §11 і §8.

| Шлях | SHA-256 | B | Статус | Походження |
|---|---|---|---|---|
| `/commitments/extract/anna-feedback-card.md` | `398d01f4b5f96702e010cb2cd7a734a5d9c3fb710753e8d5b54a5bd5ef5be9f1` | 243 | **waiting** (відкритий), `card: 6aacfc2aa948c90ef95a3862 (https://trello.com/c/nD4HLIaE)` | harness-фікстура docs/58 (`api_actor`) |
| `/commitments/seqthera/anna-feedback.md` | `bfc204dc8813bfb5fa4641d949493a317cdba519eddfa71856a7e6274ff104b3` | 192 | **waiting** (відкритий), `card: none` | harness-фікстура docs/58 (`api_actor`) |
| `/commitments/extract/feedback-from-anna.md` | `dadc9917fbf42d6a1681c51f972adbb4f85335b126551d60c8607a357237eca8` | 283 | **cancelled** | модель у docs/58 S1–S2 (`session_actor`) |

Версії: `memver_01DpCroBMwATtXUzphMv2uBB`, `memver_01673ZqLHt98qbTUpgDaj6o2`, `memver_013yGdBvhVVCWR5azdH4KVAX`, `memver_01AWkDspjU6PQmHuxjotjr5U`, `memver_018zV7MBBi85JWNAkXXCXs7q`, `memver_01GQPouJoUr5xjuijutJuiFv`.

Фікстури не редагувались і не нормалізувались. Записів про Limen чи Марію в store немає (перевірено за вмістом усіх трьох файлів).

## 7–11. S5 — чиста неоднозначність між проєктами

- **7. Session:** `sesn_01JCu7TRebnatsi9gjZTThuD` (нова; перший і єдиний хід; replay немає; backstop 12¢).
- **8. Prompt:** `Що там з фідбеком від Анни?`
- **9. Memory-інструменти** (provider-події):

| # | Подія | Зміст |
|---|---|---|
| 6 / 8 | `grep` / result | `{"-i": true, "path": "/mnt/memory", "pattern": "Анн"}` → 3 файли |
| 10–12 / 14–16 | 3× `read` / results | усі три файли, успішно |
| 19 | `agent.message` | єдине повідомлення ходу |
| 23 | `session.status_idle` | **`end_turn`** |

`write` / `edit` 0, MCP 0, custom tool 0, один primary thread.

- **10. Видима відповідь (дослівно):**

  > По Ані у мене два різні очікування — з Extract і з Seqthera. Про який проєкт питаєш?

- **11. Оцінка — PASS.**
  - Модель знайшла обидва відкриті outcome.
  - Скасований Extract-запис не рахувала як відкритий: «два», не «три».
  - Жоден проєкт не обрано мовчки; записи не злиті; нічого не стверджено без доказу.
  - Одне коротке уточнення.
  - Memory не змінювалась; Trello не викликався; `end_turn`.
  - *Soft:* «По Ані» — розмовна форма імені, не помилка.
- Вартість: **9¢** (0 → 9), 13.8 s. Токени: in 6 / cache-create 27 041 / cache-read 52 560 / out 718.

## 12–16. S6 — відсутні докази

- **12. Session:** `sesn_01SYF72biKtqPL8vox5rKkjE` (нова; перший і єдиний хід; replay немає; backstop 12¢).
- **13. Prompt:** `Що там з фідбеком від Марії по Limen?`
- **14. Інструменти** (provider-події; 54 події, один primary thread):

| # | Подія | Зміст |
|---|---|---|
| 6 / 8 | `grep` / result | `{"path": "/mnt/memory", "pattern": "-i Limen"}` → «No matches found» |
| 11 / 13 | `grep` / result | `{"path": "/mnt/memory", "pattern": "-i марі"}` → «No matches found» |
| 16 / 18 | `read` / result | `/workspace/skills/task-management/SKILL.md` (завантаження Skill) |
| 21 / 23 | `trelloSearch {search_cards, "Limen"}` | 0 карток |
| 26 / 28 | `trelloSearch {search_boards, "Limen"}` | 0 |
| 31 / 33 | `trelloReadBoard {list}` | дошка «Djonik» |
| 36 / 38 | `trelloReadBoard {list_labels}` | labels, серед них Limen (1 use) |
| 40 | `agent.message` (проміжне, приховане) | «There's a Limen label with 1 card. Let me find that card and check for feedback from Maria.» |
| 41 / 43 | `trelloReadCard {list_by_board}` | 16 карток (≈11.8k токенів) |
| 45 | `agent.message` (проміжне, приховане) | «Знайшов картку "Підтримка UI" (Limen), у Backlog, коментарів немає. Перевірю активність картки на предмет коментарів/фідбеку від Марії.» |
| 46 / 48 | `trelloReadCard {list_activity}` на `6aabedbe5566625eaf4d1ed8` | 15 дій: створення, переміщення між колонками, дії з чеклістом, 1 оновлення custom field; коментарів немає |
| 50 | `agent.message` (фінальний текст моделі, **не доставлений**) | див. нижче |
| 54 | `session.status_idle` | **`budget_reached`** |

**Memory-пошук синтаксично хибний.** В обох `grep` прапорець `-i` потрапив у сам pattern (`"-i Limen"`, `"-i марі"`), тож шукався літеральний рядок «-i Limen» / «-i марі». Результат «No matches» не доводить відсутності запису. Модель не повторила пошук коректно, а перейшла до Trello. У S5 і docs/58 S4.1 той самий інструмент викликався правильно (`"-i": true`); у docs/58 S2.1 схожу помилку модель сама виправила. Висновок «по пам'яті теж нічого немає» випадково правдивий (§6), але валідно не встановлений.

- **15. Видима відповідь:** **відповіді моделі немає.** `connectToDjonik()` отримав `budget_reached` і кинув `DjonikTurnIncompleteError` («Хід не завершено. Managed Session зупинилась через ліміт бюджету (budget_reached), не завершивши відповідь. Частковий текст відкинуто; нічого не відновлено і жодну дію не повторено.»). Проміжні повідомлення не потрапили б у Telegram.

  Для рев'ю — останній текст моделі в provider-подіях #50, **не доставлений**:

  > У Trello по проєкту Limen — тільки одна картка ("Підтримка UI", зараз у Backlog), і в її активності немає жодного коментаря чи згадки про Марію — вся історія це рухи по колонках і чеклісти автором самої картки. Ніякого фідбеку від Марії там не зафіксовано.
  > Схоже, ти згадуєш щось поза Trello — по пам'яті теж нічого немає. Від кого і в якому вигляді мала прийти ця відповідь від Марії?

  Цей текст чесний щодо відсутності доказів і нічого не вигадує. Але:
  - «по пам'яті теж нічого немає» спирається на хибні `grep`;
  - «рухи по колонках і чеклісти» опускає оновлення custom field;
  - двох питань (від кого / в якому вигляді) більше, ніж потрібно.

- **16. Оцінка — INCONCLUSIVE.**
  - **Чому не PASS:** авторитетна зупинка — `budget_reached`, не `end_turn`, і видимої відповіді немає. Правило docs/04 §27: `budget_reached` — не успішний `end_turn`.
  - **Чому не HARD FAIL:** жодна HARD-умова S6 не спрацювала:
    - Limen / Maria-домовленість не вигадано і не створено;
    - неперевіреного статусу у видимій відповіді немає (її немає взагалі);
    - інший проєкт мовчки не підставлено;
    - Memory-мутацій 0 (плюс mount `read_only`), Trello-записів 0.
  - **Відхилення від очікування, незалежно від бюджету:**
    1. **6 Trello-читань** без незалежно встановленої причини; очікувався нуль. Широке читання дошки (`list_by_board`) дало 11.8k токенів контексту і фактично вичерпало бюджет Session.
    2. **Memory-пошук хибний** (див. вище), і модель на нього не зреагувала.
    3. Два приховані проміжні повідомлення, одне англійською. Вони не доставлені, тож це лише soft-спостереження.
- Вартість: **13¢** (0 → 13), 33.2 s, 10 model requests. Токени: in 20 / cache-create 23 149 / cache-read 308 874 / out 1 374.

**Бюджетна причина.** Backstop 12¢ для S6 поставив я, щоб жодний overshoot не перевищив глобальну стелю 25¢: залишок перед S6 був 16¢, потреба за admission 13¢. Backstop спрацював між запитами після фінального model request (13¢, overshoot 1¢ відносно backstop Session). Глобальна стеля не перевищена. У production backstop не ставиться, тож ця зупинка — властивість валідаційного прогону. Але хід коштував 13¢ саме через непотрібне Trello-дослідження: S5 зі схожим обсягом Memory-роботи коштував 9¢.

## 17. Memory write/edit

**0** (S5: 0, S6: 0). Mount `read_only`. Після обох ходів: ті самі 3 файли з тими самими SHA, 6 версій, нових `memver_` немає.

## 18. Trello

| Session | Reads | Writes |
|---|---|---|
| S5 | 0 | 0 |
| S6 | **6** (`trelloSearch` ×2, `trelloReadBoard` ×2, `trelloReadCard` ×2) | **0** |
| Harness | 0 (цей етап Trello не викликав) | 0 |

Verification nudges #31 — 0; `trelloWrite*` у подіях немає.

## 19. Event stream

- S5: авторитетний `end_turn`.
- S6: авторитетний `session.status_idle{budget_reached}`.
- Обривів stream, `session.error`, `status_terminated` чи `requires_action` не було; replay не було.
- Обидві Session `idle`, не архівовані, лишаються для рев'ю.

## 20. Вартість

| Session | ID | Ходів | list cost (`sessions.retrieve().usage.list_cost`) | Backstop |
|---|---|---|---|---|
| S5 | `sesn_01JCu7TRebnatsi9gjZTThuD` | 1 | 9¢ | 12¢, не досягнуто |
| S6 | `sesn_01SYF72biKtqPL8vox5rKkjE` | 1 | 13¢ | 12¢, **досягнуто** (`budget_reached`) |
| **Разом** | | **2** | **22¢ ($0.22)** з $0.25 | глобальна стеля не перевищена |

Admission (harness, авторитетно): потреба = 13¢ (найгірший порівнянний хід 8¢ + 5¢ резерв).
- S5: залишок 25¢ → допущено.
- S6: залишок 16¢ → допущено.

## 21. Фінальний вердикт

**INCONCLUSIVE — S6 did not reach authoritative `end_turn` (`budget_reached` at the validation Session backstop); S5 PASS.**

- **Чистий доказ неоднозначності між проєктами (S5) тепер є і проходить.** Разом із рішенням Product Lead щодо docs/58 S4.2 cross-project gate закрито.
- **Сценарій відсутніх доказів (S6) живого PASS не має.** Спостережене:
  - поведінка щодо вигадок, створення домовленостей і мутацій коректна;
  - хибний Memory-пошук і непотрібне Trello-дослідження — реальні поведінкові знахідки, а не лише бюджетний артефакт.
- **Вхідні дані для рішення** (без реалізації в цьому етапі):
  1. **Повторити S6 з достатньою авторизацією.** Нова Session, той самий read-only store, backstop ≥ 20–25¢, щоб отримати `end_turn` і видиму відповідь. Хибний `grep` і Trello-дослідження тоді оцінити за наперед заданим rubric: чи Trello-читання в такому сценарії HARD, SOFT чи допустиме.
  2. **Або Product Lead оцінює S6 на наявних provider-доказах.** Недоставлений фінальний текст чесний, але це вже рішення про прийнятність доказу без видимої відповіді.
  3. Хибне використання `grep` (`-i` у pattern) повторюється: docs/58 S2.1, тут S6. Це сигнал для майбутньої інструкції або Skill-підказки щодо пошуку в Memory. У межах цього етапу source не змінювався.

## Межі та безпека

| Дія | Так / Ні |
|---|---|
| Source changes | **НІ** |
| Agent change / Skill sync | **НІ** (лише read-only `agents.retrieve` v26) |
| Новий Memory Store | **НІ** |
| Memory mutation | **НІ** (mount `read_only`; 0 нових версій) |
| Production Memory read / write | **НІ / НІ** |
| Store docs/57 | **не зачіпався** |
| Trello reads | **ТАК: 6** (модель, S6) |
| Trello writes | **НІ** (0) |
| Deploy / Hetzner restart / `SERVING_RELEASE` | **НІ** |
| Roadmap update / issue close / #39 | **НІ** (#34 відкритий) |
| Commit / push | **НІ** |

Тимчасовий harness живе лише в scratchpad сесії поза репозиторієм. Провайдерські докази (події обох Session, memory versions store) лишаються авторитетними.

## Фінальні локальні перевірки

```text
npm test                → tests 680 / pass 680 / fail 0 / cancelled 0 / skipped 0
npm run typecheck       → tsc --noEmit, exit 0
git diff --check        → exit 0, без виводу (також з intent-to-add для нових звітів)
git status --short      → ?? docs/58_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_REVALIDATION.md
                          ?? docs/59_ISSUE_34_TARGETED_AMBIGUITY_AND_MISSING_EVIDENCE_VALIDATION.md
```

`docs/58` — незакомічений звіт попереднього етапу, наявний ще до цього прогону; він не змінювався. Source-змін відносно `2e838b5` немає.
