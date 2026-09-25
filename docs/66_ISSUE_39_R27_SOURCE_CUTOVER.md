# #39 — Етап 3B-3A: source cutover r26 → r27 і підготовка deploy

Дата: 2026-09-25. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39) ([docs/02](02_DEVELOPMENT_ROADMAP.md), рядок 64). Попередні етапи: [docs/61](61_ISSUE_39_WORKING_RHYTHM_SOURCE_FOUNDATION.md)–[docs/65](65_ISSUE_39_V27_PERMISSION_LIVE_VALIDATION.md).

**Статус:** звіт про підготовку source cutover. Це **не** доказ deploy і **не** приймання #39.

У source змінено ціль serving: `SERVING_RELEASE` тепер r27. Хост не чіпали, тож він і далі serve-ить r26 до окремо авторизованого Stage 3B-3B.

**Не робилось:**
- commit, push, deploy, SSH;
- host secrets, `deploy.sh`, встановлення юніта, `daemon-reload`, restart;
- Telegram: ні повідомлень, ні зміни Session;
- `/rhythm.md`, `DJONIK_WORKING_RHYTHM`;
- платний inference;
- зміни Agent v26/v27 і Skills;
- Trello, Memory, Calendar;
- архівація діагностичних Session;
- закриття #39, #35.

## 1. Стартовий HEAD

| Перевірка | Результат |
|---|---|
| `main` | `111a1fbc74af477568655e131f4d547f5bf7029f` (`docs: record r27 permission live validation`), `git status --short` порожній |
| docs/02 | єдиний NOW — #39. #35 іде після #39 (рядок 65) |
| GitHub #39 | OPEN, один коментар (промоція 2026-09-24) |
| `SERVING_RELEASE` | `RELEASE_R26` (`src/release.ts:415`) |
| `readOnlyBoundaryFor(RELEASE_R27)` / `SERVING_READ_ONLY_BOUNDARY` | `pre_execution` / `post_hoc_detection_only` |
| `RELEASE_R27` | у source з реальними ідентифікаторами (docs/64) |

## 2. Remote preflight (лише читання, до змін source)

Лише GET. Session не створювалась, повідомлення не надсилались.

| Команда | Результат |
|---|---|
| `npm run release:check -- r27` | `OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 serving_in_this_revision=false`, exit 0 |
| `npm run release:check -- r26 --serving` | `OK agent=…@26`; hosted `session=sesn_018y1GzDi2zG4uJ5kWwyzKpv OK status=idle created=2026-09-25T06:50:13.282614Z app=d59a53261b813b6476b99173d693783e28e8586e agent=…@26`, exit 0 |
| `npm run release:check -- r27 --serving` | `no Telegram serving Session found`, exit 78. Очікувано: r27 ще ніде не serve-иться |

**Drift:** немає.
- v27 точно дорівнює `RELEASE_R27`: Skills з pm-rhythm, політики дозволів, модель, prompt, specialist, MCP, Session-ресурси.
- Hosted Session та сама, що в docs/64 §13 і docs/65: `sesn_018y1…`, app `d59a532`, @26.
- Source на старті збігався з `111a1fb`.

## 3. Точні зміни source

| Файл | Зміна |
|---|---|
| `src/release.ts` | `SERVING_RELEASE = RELEASE_R27`. Оновлено doc-коментарі `RELEASE_R27` і `SERVING_RELEASE`. Визначення r25/r26/r27 і кандидата **не змінені** |
| `managed-agents/djonik.md` | **лише frontmatter** → декларація r27 (§6). Тіло prompt не змінене |
| `managed-agents/README.md` | один пункт: frontmatter тепер r27. Попередній пункт уточнено як «на той час» |
| `src/rhythmRuntime.ts`, `src/rhythmRunner.ts`, `src/telegramCli.ts` | лише коментарі. Замість «serving r26, межа post-hoc» тепер «межа виводиться з serving release; для r27 вона pre-execution; lock 1 (`DJONIK_WORKING_RHYTHM`) закритий». Код не змінено |
| `src/release.test.ts` | serving = r27 (Agent v27, `confirmationRequired`). Новий структурний тест відповідності frontmatter ↔ serving release. Новий регресійний тест «декларація не може лишитися на r26» (§6) |
| `src/releaseR27.test.ts` | «r27 served»: межа = `readOnlyBoundaryFor(SERVING_RELEASE)` = `pre_execution`. r26 лишається окремим post-hoc rollback-релізом |
| `src/releaseR27Candidate.test.ts` | serving = розв'язаний r27, ніколи не кандидат. Activation gate: rollback на r26 з увімкненим перемикачем лишається `blocked` |
| `src/rhythmRuntime.test.ts` | новий тест для production-форми цієї ревізії: межа r27 + перемикач не заданий → `off`, нуль ефектів. Тест `blocked` тепер явно на межі r25/r26 |
| `src/djonikAgentSource.test.ts` | очікуваний список Skills містить pm-rhythm. Allowlist built-in перевіряє й політики: `write`/`edit` = `always_ask` |

`deploy/djonik-telegram.service`, `deploy/deploy.sh` і `deploy/set-secrets.sh` не змінені (§9).

## 4. `SERVING_RELEASE` r26 → r27

```ts
export const SERVING_RELEASE: DjonikRelease = RELEASE_R27;   // src/release.ts:417
```

`RELEASES` = `{ r25, r26, r27 }` без змін. `RELEASE_R25` і `RELEASE_R26` не змінені: тести підтверджують, що r26 не має `confirmationRequired` і що його `agent.version` дорівнює 26. `npm run release:check` без аргументу тепер перевіряє r27.

## 5. `SERVING_READ_ONLY_BOUNDARY`

```ts
export const SERVING_READ_ONLY_BOUNDARY = readOnlyBoundaryFor(SERVING_RELEASE); // src/rhythmRuntime.ts, без змін
```

Після перемикання значення виводиться як **`pre_execution`**. Воно не захардкоджене. Тест перевіряє `SERVING_READ_ONLY_BOUNDARY === readOnlyBoundaryFor(SERVING_RELEASE)` і лише потім значення. Статичний інваріант `rhythmRunner.test.ts` і далі забороняє літерал `pre_execution` у `telegramCli.ts` і вимагає саме цього виразу в `rhythmRuntime.ts`.

Зібраний `dist` дає `r27 27 pre_execution`.

## 6. Декларація managed-agent

Frontmatter `managed-agents/djonik.md` описував r26. Змінено лише release/configuration-частину, рівно до стану v27, як його прочитано в docs/64:
- `skills` += `skill_01GzpQX3bVuWNk5bhbGcbzku@skver_01Y77TKeXY9suV99XZU3cv5a` (pm-rhythm);
- built-in `write`, `edit` → `always_ask`;
- Trello `default_config.permission_policy` → `always_ask`;
- дев'ять reviewed reads явно `enabled: true` / `always_allow`;
- `trelloWriteCard` → `always_ask`. П'ять вимкнених writes, Calendar, custom tool, MCP servers, roster specialist v4 і модель не змінені.

**Тіло prompt не змінене.** Diff зачіпає лише рядки 24–121 frontmatter. SHA тіла = `3e204453…4b6` = `RELEASE_R27.systemSha256`, це перевіряє тест.

**Регресійний захист:**
- `the serving release equals the declarative coordinator source`: frontmatter розбирається структурно (невеликий YAML-subset parser у тесті). `skills` і `tools`, включно з enabled і політиками кожного tool, мають збігатися з `buildAgentUpdateBody(SERVING_RELEASE)`. Модель, roster і MCP servers — з релізом.
- `the declaration cannot silently stay on r26 while r27 is served`: декларація ≠ поверхня r26. Trello default = `always_ask`. `always_ask` рівно `[write, edit, trelloWriteCard]`. pm-rhythm задекларовано.

Декларацію r26 можна відтворити з `RELEASE_R26` (`release:check -- r26 --plan --from 25`) і з історії git (`111a1fb`).

## 7. r27 і далі збігається з remote Agent v27 (після змін)

| Команда | Результат |
|---|---|
| `npm run release:check -- r27` | `OK agent=…@27 serving_in_this_revision=true`, exit 0 |
| `npm run release:check` (дефолт = serving) | `r27 OK agent=…@27 serving_in_this_revision=true`, exit 0 |
| `npm run release:check -- r26 --serving` | `r26 OK agent=…@26 serving_in_this_revision=false`; hosted `sesn_018y1GzDi2zG4uJ5kWwyzKpv OK … app=d59a532… agent=…@26`, exit 0 |
| `npm run release:check -- r27 --serving` | `r27 OK …@27`, потім `no Telegram serving Session found`, exit 78 — **очікувано** (§9) |

Байтовий регресійний тест update body v26 → v27 (`5371b2ec…`) проходить без змін. Отже визначення r27 не зсунулось.

## 8. Тести

| Набір | Результат |
|---|---|
| Фокусні: `release`, `releaseR27`, `releaseR27Candidate`, `servingRelease`, `releaseAttestation`, `releasePlan`, `djonikAgentSource`, `rhythmRuntime`, `rhythmRunner` (статичні інваріанти активації `telegramCli`), `deployConfig` | 178 тестів: 177 pass, 1 fail (`deployConfig`: «deploy script survives replacing itself…», лише Windows, див. нижче) |
| Регресії: `toolConfirmation`, `toolConfirmationClient`, `djonikClient`, `commitmentContract`, `customToolResolution`, `turnCompletion`, `trelloMutationLedger`, `rhythmRunner`, `rhythmRuntime`, `rhythmTelegram`, `telegramAdapter`, `telegramDispatch`, `messageGrouping`, `trelloWorkHistory`, `servingLifecycle` | 529/529 pass |
| Повний `npm test` | 940 тестів: 938 pass, 2 fail |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `git diff --check` | pass |

**Два падіння наявні й до цієї зміни і стосуються лише Windows.** Їх перевірено на чистому `111a1fb` в окремому scratch worktree (його потім видалено):
- `processExit`: «a real process that fetched over keep-alive exits by itself…»;
- `deployConfig`: «deploy script survives replacing itself…».

На `111a1fb` повний прогін дав 938 тестів: 936 pass і ті самі 2 fail. Отже приріст — рівно +2 нові тести, нових падінь немає. Безпеку підтвердження r27 не зачеплено: `toolConfirmation*` і `djonikClient` проходять повністю.

## 9. Очікування щодо deploy

- **Source хоче r27.** Процес із цієї ревізії атестує лише Agent v27 і Session snapshot r27, з pm-rhythm pin і набором `always_ask`. Інакше він завершується з кодом 78.
- **Хост serve-ить r26, доки не пройде Stage 3B-3B.** Там app `d59a532`, Agent v26, `sesn_018y1…`.
- **Розбіжність source ↔ хост очікувана.** Вона тимчасова і виникає між цим source і deploy. Це **не** production drift і не потребує виправлення в цьому етапі. Тому `release:check -- r27 --serving` зараз повертає 78, а `release:check -- r26 --serving` — OK.
- **Юніт systemd:** у source вже є `StateDirectory=djonik` і `StateDirectoryMode=0700`. Це єдиний шлях, куди можна писати при `ProtectSystem=strict`. Інших шляхів на запис не додано, `DJONIK_WORKING_RHYTHM` в юніті немає. Змін не потрібно.
  - Від hosted `d59a532` юніт відрізняється лише цим блоком (`4e2ec69`).
  - `deploy.sh` юніт не встановлює, тому для Stage 3B-3B це окремий крок (§11).
- **Host env:** за docs/52 §2 на хості `DJONIK_EXPECTED_RELEASE=r26` (з хоста в цьому етапі не перевірялося). Процес r27 з таким значенням відмовить (exit 78), а `deploy.sh` зупиниться **до** restart. Тому спершу треба змінити це значення.

## 10. Точна rollback-ціль

| Елемент | Значення | Джерело |
|---|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26**, не змінений; `release:check -- r26` OK | §2, §7 |
| Release | `RELEASE_R26` (є в `RELEASES`, не змінений) | `src/release.ts` |
| App-ревізія | **`d59a53261b813b6476b99173d693783e28e8586e`**: остання задеплоєна й прийнята r26-ревізія (docs/60), атестується просто зараз | docs/60, §2 |
| Маршрут | 1) `deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE` → ввести `r26`; 2) `deploy/deploy.sh d59a53261b813b6476b99173d693783e28e8586e` | docs/52 §6 (той самий шаблон, що r26 → r25) |

**Примітки:**
- `d59a532` — предок `main`. Його `SERVING_RELEASE = RELEASE_R26`, а ідентифікатори v26 явно закріплені, тож це не той небезпечний «unpinned» старий білд (docs/52 §4).
- `111a1fb` теж serve-ить r26, але на хості не запускався. Тому rollback-ціль — `d59a532`.
- Новий юніт зі `StateDirectory` для `d59a532` нешкідливий: він лише створює порожній `/var/lib/djonik`.
- Rollback не редагує v26/v27 і стартує нову Session. Memory зберігається.

## 11. Stage 3B-3B: очікувані команди (кожна — лише з авторизації Product Owner)

**Передумови [READ]:**
1. Цей source закомічено й запушено. `<SHA>` — повний SHA цього коміту.
2. `npm run release:check -- r27`: OK. `npm run release:check -- r26 --serving`: OK. Drift немає.
3. Ноутбучний адаптер не запущений (один poller).

**На хості (root):**
```bash
cd /opt/djonik/app && sudo -u djonik git fetch --quiet origin
```
```bash
sudo -u djonik git -C /opt/djonik/app show <SHA>:deploy/djonik-telegram.service > /root/djonik-telegram.service.new
```
```bash
install -m 0644 /root/djonik-telegram.service.new /etc/systemd/system/djonik-telegram.service && systemctl daemon-reload
```
(`daemon-reload` не перезапускає процес r26, що працює. Новий юніт набуде чинності при єдиному restart у `deploy.sh`. Альтернатива з docs/65 §19: спершу `deploy.sh`, потім install і restart — це дасть дві Session.)
```bash
bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
```
(ввести `r27`; одразу після цього виконати наступну команду — у цьому вікні аварійний restart r26 завершився б із кодом 78)
```bash
bash /opt/djonik/app/deploy/deploy.sh <SHA>
```

**Очікуване після deploy [READ]:**
- `deploy.sh` друкує `[release] serving release=r27 … agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 … pm-rhythm@skver_01Y77TKeXY9suV99XZU3cv5a … skill_pins=explicit … always_ask=edit,trello/trelloWriteCard,write memory=read_write session=sesn_…`;
- у журналі `[rhythm] off reason=DJONIK_WORKING_RHYTHM not set`;
- `systemctl show djonik-telegram -p StateDirectory` → `djonik`; `/var/lib/djonik` належить `djonik`, режим 0700, `rhythm-state.json` **немає**;
- з середовища реалізатора: `npm run release:check -- r27 --serving` → OK на новій hosted Session, `app=<SHA>`, @27;
- `npm run release:check -- r26` → OK (v26 не змінений, rollback живий).

**Checkpoint:** якщо рядка `[release] serving … app=<SHA>` немає або процес завершився з кодом 78, виконати rollback за §10. Telegram-smoke r27 (звичайний хід + підтверджена запис-дія) — окремий, платний, авторизований крок.

## 12. Working Rhythm лишається вимкненим

- `DJONIK_WORKING_RHYTHM` у source не встановлюється: ні в юніті, ні в коді, ні в `set-secrets.sh`. На хості його теж не задано.
- Serving r27 відкриває лише lock 2 (межа `pre_execution`). Lock 1 закритий, тож `startWorkingRhythm` повертає `off` без жодних ефектів: без читання Memory config, state-файлу, фактів Trello, виклику моделі й таймера. Це закріплює новий тест у `rhythmRuntime.test.ts`.
- `/rhythm.md` не створено. Активація, bounded перевірка ритуалу й кнопки, а потім #35 — окремі пізніші етапи (docs/65 §19 п. 4).

## Стан робочого дерева

```text
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/djonikAgentSource.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR27.test.ts
 M src/releaseR27Candidate.test.ts
 M src/rhythmRunner.ts
 M src/rhythmRuntime.test.ts
 M src/rhythmRuntime.ts
 M src/telegramCli.ts
?? docs/66_ISSUE_39_R27_SOURCE_CUTOVER.md
```
