# #56 — Stage A: source cutover на r30 і handoff для deploy

Дата: 2026-09-29. Issue: [#56](https://github.com/danielkokr/djonik-manager-2.0/issues/56). Статус: **готово до review Product Lead**. Без commit / push / deploy.

## 1. Підсумок / вердикт

**PASS (Stage A).**

- Source тепер обслуговує `RELEASE_R30`: `SERVING_RELEASE = RELEASE_R30`.
- Прийнятий у #55 tuple r30 не змінено. Це доведено хешами всіх релізів до і після (§6).
- `RELEASE_R29` не змінено; r29 лишається робочим rollback (§7).
- Декларація `managed-agents/djonik.md` = `SERVING_RELEASE` = `RELEASE_R30`. Перехідний стан #55 завершено (§8).
- Pre-deploy `release:check` поводиться так, як очікувалось (§10).
- Тести проходять, крім двох незмінних Windows-baseline (§17–§18).
- Deploy, restart, зміни секретів, Telegram і inference не виконувались.

## 2. Рішення Product Owner

Daniel вирішив (issue #56 і коментар; docs/02, оновлення 2026-09-29):

- окремий платний benchmark S9 / S10 / S11 / S41 **більше не є pre-deploy gate**;
- шлях такий: reviewed source cutover → стандартний контрольований deploy на Hetzner → ручна перевірка в реальному Telegram;
- сценарії benchmark лишаються чекліст-довідкою. Будь-який пізніший платний прогін потребує окремої авторизації docs/04 §27;
- r29 — негайний rollback.

## 3. Стартовий стан

| Перевірка | Результат |
|---|---|
| `HEAD` == `origin/main` | так, обидва `868007d2e34065f3d0b133e68ce9870772b39f46` (після `git fetch`) |
| Робоче дерево | чисте |
| Canonical NOW | #56 (docs/02, рядок таблиці 11 і оновлення 2026-09-29) |
| `RELEASE_R30` у source | є; `RELEASES` = r25…r30 |
| `SERVING_RELEASE` | `RELEASE_R29` |

## 4. Remote/source preflight r30 (лише читання, до редагування)

| Команда | Вихід | exit |
|---|---|---|
| `release:check -- r30` | `r30 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@30 serving_in_this_revision=false` | 0 |
| `release:check -- r29` | `r29 OK agent=…@29 serving_in_this_revision=true` | 0 |
| `release:check` (типово) | `r29 OK …@29 serving_in_this_revision=true` | 0 |
| `release:check -- r30 --serving` | `r30 OK …@30`, далі `r30 no Telegram serving Session found among the newest Sessions` | 78 |
| `release:check -- r29 --serving` | `serving session=sesn_01HPLE78Kxi3LVxQW2je3z29 OK status=idle created=2026-09-28T09:04:46Z app=4e46aba5481a2c874767095186087badb2e58ed5 agent=…@29` | 0 |

Зміст r30 перевірено тестами `releaseR30.test.ts` і `release.test.ts` та самим source:

- Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh@30`;
- system SHA-256 `0296d624…33d1` = тіло `djonik.md`;
- п'ять явних Skill-пінів з виміряними `sessionVersion`:
  - task-management `1790666094447918`;
  - planning-and-focus `1790666103656343`;
  - studio-intake `1790666109304881`;
  - work-review `1790083840153637` (пін r29);
  - pm-rhythm `1790666114030041`;
- `specialist: null`;
- MCP лише `trello` (Calendar немає);
- custom tools: `trello_work_history`, `trello_board_snapshot`, `focus_budget`;
- `trelloWriteChecklist` увімкнено і `always_ask` (разом із `trelloWriteCard`).

Дрейфу remote/source не виявлено, тож cutover виконано.

## 5. Точний source cutover

`src/release.ts` — єдина продуктова зміна:

```diff
-export const SERVING_RELEASE: DjonikRelease = RELEASE_R29;
+export const SERVING_RELEASE: DjonikRelease = RELEASE_R30;
```

Крім цього, у файлі оновлено лише два doc-коментарі (над `RELEASE_R30` і над `SERVING_RELEASE`). Вони тепер описують поточний стан: source обслуговує r30, хост — r29 до deploy, r29 — rollback. Історичні речення коментаря збережено.

Не змінено:
- `RELEASE_R25`…`RELEASE_R30`;
- `RELEASE_R30_CANDIDATE`;
- `RELEASES`;
- `releasePlan.ts`, `releaseAttestation.ts`, `releaseCheck.ts`, `servingRelease.ts`;
- runtime-код;
- `deploy/*`.

r31 не створено.

## 6. Доказ, що `RELEASE_R30` не змінено

SHA-256 від `JSON.stringify` кожного релізу. Перші 16 hex-символів; `HEAD` — з `git show HEAD:src/release.ts`, `WORK` — робоча копія:

| Реліз | HEAD | WORK |
|---|---|---|
| r25 | `9e55742b48a13e56` | `9e55742b48a13e56` |
| r26 | `b3369749f63efa12` | `b3369749f63efa12` |
| r27 | `bd6ecb976c08f350` | `bd6ecb976c08f350` |
| r28 | `cd99b80a8d869092` | `cd99b80a8d869092` |
| r29 | `fb9b5edb602d00d6` | `fb9b5edb602d00d6` |
| **r30** | `2f1523ea2837717f` | `2f1523ea2837717f` |
| r30-candidate | `f2811d630cdbe612` | `f2811d630cdbe612` |
| `SERVING_RELEASE.id` | `r29` | **`r30`** |

Крім того, `releaseR30.test.ts` і далі доводить:
- r30 = кандидат, розв'язаний реальними пінами;
- тіло v29→v30 `718770ea…` відтворюється;
- SHA джерел Skill відповідають пінам;
- кожен неправильний / `latest` / невиміряний `sessionVersion` fail-closed.

## 7. Доказ, що rollback `RELEASE_R29` не змінено

- Хеш r29 до і після однаковий (§6).
- `release:check -- r29` після cutover: `OK …@29 serving_in_this_revision=false` (exit 0).
- `releaseR29.test.ts`:
  - r29 = r28 + prompt #45 + три піни;
  - specialist v4;
  - `customTools = ["trello_work_history"]`;
  - атестація Agent v29 і snapshot.
- `releaseR30Candidate.test.ts`: r25–r29 пінять specialist v4 (`agent_01KNiQDzzPjaMU6LLF4mU6uM`, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm`). Порожній або чужий roster в r29 fail-closed.
- Не торкався:
  - Agent v29;
  - specialist v4;
  - `project-health-specialist.md`;
  - `.claude/skills/project-health`;
  - `claude-lock.json`;
  - rollback-runtime specialist у `djonikClient.ts`;
  - історичних спелінгів Session r29.

## 8. Lockstep декларації managed-agents

- `managed-agents/djonik.md` не змінено (як і після #55).
- Тест `release.test.ts` «the serving release r30 (Agent v30) equals the declarative coordinator source…» тепер спершу стверджує `SERVING_RELEASE === RELEASE_R30`. Далі він звіряє саме `SERVING_RELEASE` з тілом (SHA), model, `multiagent: null`, `mcp_servers`, Skills і всіма tools / policies frontmatter. Інваріант **декларація == `SERVING_RELEASE` == `RELEASE_R30`** знову прямий.
- `djonikAgentSource.test.ts` без змін у перевірках: roster `null`, Card + Checklist `always_ask`, три custom tools, без Calendar. Змінено лише коментар.

## 9. Змінені тести

| Файл | Зміна |
|---|---|
| `src/release.test.ts` | «this revision serves r29» → **serves r30**: v30, `specialist null`, три custom tools, лише Trello MCP, Card + Checklist gated. Тест lockstep декларації — через `SERVING_RELEASE`. Тимчасовий тест #55 «declaration r30 / serving r29» **замінено** тестом «r29 rollback відрізняється від served-декларації рівно на переходи r30». Усі перевірки дельти збережено; змінна `served` → `rollback`. |
| `src/releaseR29.test.ts` | r29 — reviewed rollback: `SERVING_RELEASE !== RELEASE_R29`, specialist v4. Решта перевірок без змін. |
| `src/releaseR30.test.ts` | r30 — serving release (#56); `RELEASES[SERVING_RELEASE.id] === RELEASE_R30`, тобто типовий `release:check` перевіряє r30; r29 є в `RELEASES`. Решту 7 тестів не змінено. |
| `src/releaseR30Candidate.test.ts` | serving = r30, а не кандидат. `focus_budget`: r25–r29 не мають, served r30 має. Topology: served `specialist null`. |
| `src/releaseR28Candidate.test.ts`, `src/clientProfile.test.ts`, `src/workingStyle.test.ts` | очікуваний serving id → r30 |
| `src/releaseR27.test.ts`, `src/djonikAgentSource.test.ts`, `src/mutationCommentary.test.ts`, `src/releaseFixtures.test-helpers.ts` | лише текст повідомлень / коментарів (serving r29 → rollback r29 / serving r30). Перевірки не змінено. |

Глобальні перевірки коректності релізів не послаблено. Жодну перевірку дельти r29↔r30 не видалено.

## 10. `release:check` після cutover, до deploy (лише читання)

| Команда | Вихід | exit | Очікування |
|---|---|---|---|
| `release:check -- r30` | `r30 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@30 serving_in_this_revision=true` | 0 | PASS ✔ |
| `release:check` (типово) | `r30 OK …@30 serving_in_this_revision=true` | 0 | тепер r30 ✔ |
| `release:check -- r30 --serving` | `r30 OK …@30 serving_in_this_revision=true`, далі `r30 no Telegram serving Session found among the newest Sessions` | 78 | очікувана відмова ✔ |
| `release:check -- r29` | `r29 OK …@29 serving_in_this_revision=false` | 0 | PASS ✔ |
| `release:check -- r29 --serving` | `serving session=sesn_01HPLE78Kxi3LVxQW2je3z29 OK status=idle app=4e46aba5481a2c874767095186087badb2e58ed5 agent=…@29` | 0 | хост ще r29 ✔ |

Додатково: зібраний `dist/release.js` дає `SERVING_RELEASE.id = r30`, `agent.version = 30`, `specialist = null`. Саме це значення `deploy.sh` порівнює з `DJONIK_EXPECTED_RELEASE`.

## 11. Чому `r30 --serving` до deploy не має Session

`--serving` перечитує найновішу Session з метаданими `source=telegram, release=r30`. Таку Session створює лише процес Telegram-адаптера, що стартував з ревізії, яка обслуговує r30 (docs/52 §1, docs/54 §12). Такої ревізії на хості ще немає. #55 створив лише inspection Session `sesn_017J9XJD…`: без `source=telegram`, 0 подій. Тому exit 78 — правильна межа. Serving Session не підроблялась.

## 12. Хост досі на r29

| Шар | Стан |
|---|---|
| **Source revision** (ця робоча копія, після commit) | обслуговує **r30** |
| **Поточний хост** (Hetzner, `djonik-telegram`) | обслуговує **r29**, app `4e46aba5481a2c874767095186087badb2e58ed5`, Agent v29, specialist v4, Session `sesn_01HPLE78…`. Так буде до окремо авторизованого deploy. |

Хост, `/etc/djonik/djonik.env`, `DJONIK_EXPECTED_RELEASE` і systemd не змінювались.

## 13. Handoff для deploy (docs/52 §3 / §6) — лише підготовка, НЕ виконано

Передумови:
- Product Lead прийняв Stage A;
- Daniel вручну зробив commit / push;
- жоден інший адаптер (ноутбук) не запущений — інваріант 1 docs/52.

1. **Зафіксувати повний SHA** опублікованого main:
   ```bash
   git rev-parse origin/main
   ```
   Далі `<FULL_SHA>` — це значення.
2. **[READ] З committed main** (локально):
   ```bash
   npm run release:check -- r30
   ```
   Очікування: `r30 OK …@30 serving_in_this_revision=true`.
3. **[AUTH] На Hetzner, як root, безпосередньо перед deploy** — змінити очікуваний реліз через наявний скрипт (синтаксис docs/52 §5 / §6):
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
   Ввести `r30`. Решта значень зберігається.
   Примітка: процес r29, що працює, env не перечитує. Але якщо він сам перезапуститься між цим кроком і кроком 4, він вийде з кодом 78 (невідповідність). Тому кроки 3 і 4 виконуються одразу один за одним.
4. **[AUTH] Deploy** (docs/52 §3):
   ```bash
   /opt/djonik/app/deploy/deploy.sh <FULL_SHA>
   ```
   Скрипт по черзі:
   - робить fetch і detached checkout рівно `<FULL_SHA>`;
   - відмовляє на брудному дереві;
   - виконує `npm ci`, `npm run build`;
   - запускає `node dist/releaseCheck.js` — типовий реліз тепер r30, read-only;
   - перевіряє `DJONIK_EXPECTED_RELEASE == r30`.

   Усе це відбувається **до** restart. Будь-яка відмова лишає процес r29 недоторканим. Далі — один `systemctl restart`: graceful drain до 120 с, потім старт. Потім скрипт до 90 с чекає рядок нового процесу `[release] serving … app=<FULL_SHA>`.
5. **Підтвердити serving-рядок** (формат docs/52 §1 / `formatServingTuple`; порядок полів — release, app, agent):
   ```text
   [release] serving release=r30 app=<FULL_SHA> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@30 model=claude-sonnet-5/medium/standard system=0296d62462ec skill_pins=explicit skills=task-management@skver_01KzWwpv88cC2K2nncoTdkt2,planning-and-focus@skver_01L9cL8yv244qmpXSyqvmqzJ,studio-intake@skver_01SYUXncujJcAWuXz1wbD69U,work-review@skver_…,pm-rhythm@skver_01BetXsjNcGqmaHY9MpNQgns specialist=none builtin=edit,glob,grep,read,write custom_tools=trello_work_history#…,trello_board_snapshot#…,focus_budget#… memory=read_write session=sesn_… always_ask=edit,trello/trelloWriteCard,trello/trelloWriteChecklist,write …
   ```
6. **[READ] Provider-side доказ:**
   ```bash
   npm run release:check -- r30 --serving
   ```
   Очікування: `r30 serving session=sesn_… OK … app=<FULL_SHA> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@30`.
7. **Підтвердити hosted Telegram Session:** release `r30`, Agent `@30`, `app_revision` = `<FULL_SHA>`. Усі три значення є в рядку з кроку 6.
8. **Daniel виконує ручний чекліст** (§15).
9. **Критичний дефект** (§16) → rollback (§14).

Інваріанти docs/52 §0, які зберігає handoff:
- один poller;
- стандартний graceful restart;
- preflight і перевірка expected release до restart;
- без replay перерваних ходів: перерваний хід отримує чесне повідомлення, і Daniel сам вирішує, чи повторити;
- без секретів у логах.

**Якщо `deploy.sh` зупинився до restart:** процес r29 далі обслуговує. Але `DJONIK_EXPECTED_RELEASE` уже `r30`, тож повернути значення:
```bash
bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
```
Ввести `r29`. Інакше будь-який майбутній перезапуск процесу r29 завершиться exit 78.

Що змінює deploy, крім Agent / Skills:
- app-сторона #50–#52 (focus / timebox, client profiles, working-style) і Memory-інструкції #51 / #52 у ресурсі Session;
- вміст Memory не мігрується.

Working Rhythm лишається вимкненим: `DJONIK_WORKING_RHYTHM` не заданий. Нових секретів r30 не потребує:
- `trello_board_snapshot` і `focus_budget` використовують наявні `TRELLO_*`;
- стан живе в systemd `StateDirectory=djonik`.

## 14. Handoff для rollback (docs/52 §6) — НЕ виконано

**Остання відома добра r29-ревізія застосунку: `4e46aba5481a2c874767095186087badb2e58ed5`.** Це «feat: add Telegram voice input», 2026-09-28; її зараз обслуговує хост, і вона атестована `r29 --serving`.

Main після неї (`0902005…868007d`) у source ще обслуговував r29. Але він містить app-код #50–#52, який залежить від Skills лише для r30 (коментар `RELEASE_R30_CANDIDATE` у `release.ts`). Тому **ці ревізії не є rollback-ціллю**.

1. **[AUTH]** Повернути очікуваний реліз:
   ```bash
   bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
   ```
   Ввести `r29`.
2. **[AUTH]** Розгорнути r29-ревізію:
   ```bash
   /opt/djonik/app/deploy/deploy.sh 4e46aba5481a2c874767095186087badb2e58ed5
   ```
   `deploy/` не змінювався з `4e46aba` (`git diff 4e46aba HEAD -- deploy/` порожній). Ця ревізія пінить Agent **v29** + specialist v4, які існують без змін. Запису в Agent немає.
3. **[READ]** Перевірити:
   ```bash
   npm run release:check -- r29 --serving
   ```
   Очікування: `app=4e46aba…`, `…@29`.

Межі:
- rollback змінює лише майбутні ходи;
- записи в Trello / Memory не відкочуються;
- починається нова Session, контекст розмови не переноситься, Memory лишається;
- стан focus-бюджетів r30 у `StateDirectory` r29-застосунок ігнорує.

## 15. Чекліст ручної перевірки в Telegram (для Daniel, після deploy)

Точна проза не є критерієм. Оцінюється поведінка.

| # | Що зробити | Очікувано (концептуально) |
|---|---|---|
| 1 | Огляд проєкту: «Що в мене по Azov? Коротко.» | Короткий корисний огляд на свіжих даних Trello. Жодної мітки specialist чи делегування. |
| 2 | Застряглі / Waiting: «Що зависло по Extract?» | Реальний поточний список і вік у ньому (`daysInList`) та контекст. Waiting ≠ Blocked. «Зависло» не виводиться лише з `lastActivityAt` чи due. |
| 3 | Ризики: «Які ризики по Seqthera?» | Конкретний обґрунтований ризик — або чесне «суттєвого ризику немає». Без вигаданих дедлайнів чи зобов'язань. |
| 4 | Змішаний read + write: природне питання про статус проєкту плюс явна зміна due на картці, яку Daniel справді хоче змінити | Детермінований перевірений результат мутації Trello і корисний коментар щодо проєкту в одній відповіді. Без суперечливих формулювань due. Без specialist. |
| 5 | Переслати реальне повідомлення клієнта | Переслане — це джерело чи контекст, а не автоматично команда Daniel. Пропозиція або уточнення за #48; запис — лише після підтвердження. |
| 6 | Фокус: «На чому я зараз сфокусований?» | Поточний фокус, виведений з Trello. Коротко. Без вигаданої тривалості. |
| 7 | Питання, де допомагає відомий контекст клієнта / контакту | Профіль — контекст і tie-breaker. Поточне повідомлення клієнта має пріоритет. Без вигаданої терміновості чи дедлайну. |
| 8 | Корекція стилю: «Пиши коротше, без зайвого пояснення.» | Негайна адаптація. Без автоматичного довготривалого запису в Memory — лише через явний шлях «запам'ятати» з підтвердженням. |

Рекомендовано після чекліста проглянути `journalctl -u djonik-telegram` на `[release] warning` і на `[shutdown]` у неочікуваних місцях.

## 16. Що вважати критичним дефектом (тригер rollback)

Rollback на r29 (§14), якщо:

1. **Неперевірений або хибний запис:** заявлено успіх запису в Trello / Memory без підтвердження, запис не в ту картку, або запис без явного запиту чи підтвердження. Сюди входить переслане повідомлення, виконане як команда.
2. **Фактична вигадка у ключових відповідях,** що може ввести Daniel в оману: неіснуючі картки, дедлайни, зобов'язання, стан «Blocked» без доказів. Це систематично, не одиничне формулювання.
3. **Процес не обслуговує стабільно:** рестарти через exit 78 / 1, втрата ходів, повторні виконання tool, другий poller (409).
4. **Регрес базового сценарію r29,** який раніше працював: створення / зміна / завершення картки, огляд проєкту, голос, нагадування.
5. **Витік** секрету чи технічного тексту (ids, внутрішні примітки) у відповідь Telegram.

**Не** критичні: стилістичні недоліки, зайва довжина, одиничне неоптимальне формулювання. Їх фіксують як issue для наступного bounded-фіксу без rollback.

## 17. Сфокусовані тести

```bash
node --import tsx --test src/release.test.ts src/releaseR29.test.ts src/releaseR30.test.ts src/releaseR30Candidate.test.ts src/releaseAttestation.test.ts src/servingRelease.test.ts src/djonikAgentSource.test.ts src/deployConfig.test.ts
```

Результат: **130 тестів, 129 pass, 1 fail**. Fail — лише baseline `deployConfig.test.ts`.

Розширений набір (плюс r27 / r28 / кандидати, `servingLifecycle`, `clientProfile`, `workingStyle`, `mutationCommentary`, `rhythmRuntime`, `rhythmRunner`): **284 тести, 283 pass, 1 fail** — той самий baseline.

## 18. typecheck / build / повний тест / diff

| Перевірка | Результат |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | **1371 тест, 1369 pass, 2 fail** |
| `git diff --check` | exit 0 (лише CRLF-попередження git) |

Два збої — ті самі Windows-baseline, що й до змін. Перевірено на чистому `HEAD` через `git stash`: ті самі 2 fail.
- `deployConfig.test.ts` «deploy script survives replacing itself…». Причина: CRLF-checkout `deploy.sh` на Windows, регулярний вираз `^main "\$@"\nexit$`.
- `processExit.test.ts` «a real process that fetched over keep-alive exits…».

Проміжний прогін одразу після зміни `SERVING_RELEASE`, до оновлення тестів: 12 fail = 10 очікуваних перевірок «serving r29» + 2 baseline. Нових збоїв немає.

## 19. Змінені файли

- `src/release.ts` — `SERVING_RELEASE = RELEASE_R30`, два коментарі.
- `src/release.test.ts`
- `src/releaseR29.test.ts`
- `src/releaseR30.test.ts`
- `src/releaseR30Candidate.test.ts`
- `src/releaseR28Candidate.test.ts`
- `src/releaseR27.test.ts` — повідомлення.
- `src/clientProfile.test.ts`
- `src/workingStyle.test.ts`
- `src/djonikAgentSource.test.ts` — коментар.
- `src/mutationCommentary.test.ts` — коментар.
- `src/releaseFixtures.test-helpers.ts` — коментарі.
- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`:
  - новий датований абзац «Serving release — #56 source cutover»;
  - update-рядок у §9.

  Історичні абзаци не переписано.
- `managed-agents/README.md` — розділ #56; абзац #55 позначено як superseded.
- `docs/93_ISSUE_56_R30_SOURCE_CUTOVER_AND_DEPLOY_HANDOFF.md` — цей звіт.

Не змінено:
- `docs/02` (roadmap, зона Product Lead);
- `deploy/*`;
- `managed-agents/djonik.md`, `project-health-specialist.md`;
- Skills;
- `claude-lock.json`;
- runtime-код.

## 20. Явне підтвердження

- ❌ commit — не виконано;
- ❌ push — не виконано;
- ❌ deploy на Hetzner — не виконано;
- ❌ зміна секретів хоста / `DJONIK_EXPECTED_RELEASE` — не виконано;
- ❌ restart systemd — не виконано;
- ❌ Telegram-хід — не виконано;
- ❌ платний benchmark / inference / діагностична Session — не виконано. Лише read-only GET у `release:check`, без створення Session;
- ❌ нова версія Agent / Skill, update Agent, sync Skill — не виконано;
- ❌ мутації Trello / Memory — не виконано;
- ❌ архівування specialist, прибирання rollback-runtime — не виконано;
- ❌ закриття #56 і редагування roadmap — не виконано.

## 21. `git status --short`

```text
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M managed-agents/README.md
 M src/clientProfile.test.ts
 M src/djonikAgentSource.test.ts
 M src/mutationCommentary.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseFixtures.test-helpers.ts
 M src/releaseR27.test.ts
 M src/releaseR28Candidate.test.ts
 M src/releaseR29.test.ts
 M src/releaseR30.test.ts
 M src/releaseR30Candidate.test.ts
 M src/workingStyle.test.ts
?? docs/93_ISSUE_56_R30_SOURCE_CUTOVER_AND_DEPLOY_HANDOFF.md
```
