# #34 прийнято; canonical NOW — #39

Дата: 2026-09-24. Issue: [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34) → закрито. Наступне: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39).

Цей документ фіксує **нове рішення Product Owner**, яке накладається поверх звітів про валідацію. Історичні вердикти [docs/57](57_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_VALIDATION.md), [docs/58](58_ISSUE_34_COMMITMENT_LIFECYCLE_LIVE_REVALIDATION.md) і [docs/59](59_ISSUE_34_TARGETED_AMBIGUITY_AND_MISSING_EVIDENCE_VALIDATION.md) не переписуються і не перекваліфіковуються.

## 1. Рішення

**#34 ACCEPTED** Product Owner 2026-09-24, із залишковими спостереженнями (§5). Додаткова синтетична валідація #34 **не потрібна**.

- **Прийняте джерело:** `2e838b5` (source-контракт [docs/56](56_ISSUE_34_COMMITMENT_LIFECYCLE_SOURCE_CONTRACT.md) §1–§19).
- **Коміт із доказами:** `d59a53261b813b6476b99173d693783e28e8586e` (docs/58, docs/59; лише документація).

## 2. Прийнята поведінка

- Прийняті домовленості живуть у native Claude Memory: один файл на outcome, `commitments/<project>/<outcome>.md`.
- Стан waiting, `next_check`, корекція / перенесення — у тому самому файлі.
- Дедуплікація; продовження в новій Session через пошук у Memory.
- Скасування; скасоване не піднімається як відкрите.
- Пропозиція ≠ прийняття; plan-only ≠ мутація Trello.
- Свіжий стан Trello авторитетний для фактів задачі. Done ≠ доказ прийнятого outcome.
- Неоднозначність між проєктами → уточнення, а не злиття.
- Під час валідації не було жодного неавторизованого запису в Trello.

## 3. Стандарт доказу збереження

- Успішного результату native Memory `write` / `edit` достатньо, щоб сказати «збережено». Заява не може йти раніше за цей результат. Помилковий чи неясний результат — не «збережено».
- Обов'язковий додатковий read-back не потрібен (docs/56 §19).
- Верифікація запису в Trello за #31 **не змінюється**.

## 4. Історичні докази (як є)

| Звіт | Кандидат | Історичний вердикт | Суть |
|---|---|---|---|
| docs/57 | `dcb8d3e` | **FAIL** | Коректний запис, але порушено тодішнє обов'язкове правило read-back. Його потім свідомо змінили |
| docs/58 | `2e838b5` | **FAIL** за rubric | 10/11 ходів PASS: створення, `next_check`, корекція, дедуплікація, нова Session, скасування, пропозиція, межа plan-only / Trello, Done ≠ фідбек. S4.2 оцінено як HARD FAIL |
| docs/59 | `2e838b5` | **INCONCLUSIVE** | S5 (чиста неоднозначність між проєктами) — **PASS**. S6 (відсутні докази) — `budget_reached` на backstop валідації |

**Рішення Product Lead щодо docs/58 S4.2.** Хід був методологічно змішаним: попередній хід у тій самій Session зробив Extract активним референтом розмови, а Session за архітектурою володіє такими референтами. Модель не злила записи, нічого не змінила і не вигадала проєкт. Тож S4.2 **не** є доказом, що source-контракт хибний. Чистий доказ дав docs/59 S5.

## 5. Залишкові спостереження (не блокують)

- `grep` у Memory кілька разів мав хибний синтаксис: `-i` потрапляв у сам pattern (docs/58 S2.1, docs/59 S6).
- S6 зайво читав Trello: 6 читань без незалежної причини.
- S6 не дійшов до `end_turn` через backstop валідаційного бюджету.
- Небезпечних мутацій чи вигаданих домовленостей не було: Memory writes 0, Trello writes 0.
- Практичне використання і пілот #35 покажуть, чи варто це окремої обмеженої роботи.

## 6. Production rollout

| Поле | Значення |
|---|---|
| Задеплоєна app-ревізія | `d59a53261b813b6476b99173d693783e28e8586e` (Product Owner, `deploy/deploy.sh`, docs/52 §3) |
| Release / Agent | **r26** / `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26**, без змін |
| Модель | Claude Sonnet 5 / medium / standard, без змін |
| Skills / specialist | 5 explicit pins r26 / `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4, без змін |
| Memory | production store `memstore_01WViYK3WQvGEgojB2GiaDFq`, `read_write`, без змін |
| systemd | `djonik-telegram` active (running) (хост, Product Owner) |
| Serving tuple при старті | `release=r26 app=d59a532… agent=…@26 memory=read_write` (хост, Product Owner) |
| Атестація провайдера | `release:check -- r26 --serving` → OK: на хості (Product Owner) і незалежно з середовища реалізатора, read-only: `session=sesn_01K212iG8e91BCQtp5fHM4rM OK status=idle created=2026-09-24T12:38:52Z app=d59a53261b813b6476b99173d693783e28e8586e agent=…@26` |
| Синтетичний хід після деплою | **немає** |

- Memory-інструкції #34 тепер доходять до нових hosted Session через цю app-ревізію. Це рівень app, а не версії Agent: Memory-інструкції передаються при створенні Session і не атестуються як частина r26.
- Попередня ревізія `a6a627d` більше не обслуговує трафік.
- Production Memory лишається як була: жодних тестових фікстур туди не копіювали.
- Тимчасові валідаційні store (`memstore_01APQhKFwa5SXoemgCz4MLQ8`, `memstore_01CE5zkftLikxG2Rxz1q533c`) і їхні Session лишаються провайдерськими доказами, у production не монтуються. Прибирання — окрема дія пізніше.
- Коміт закриття лише документаційний, тож хост свідомо лишається на `d59a532`. Redeploy не потрібен.

## 7. Далі

- **Canonical NOW — #39 (Working rhythm).** Його реалізацію цим документом не почато.
- #35 (пілот) іде після #39.
