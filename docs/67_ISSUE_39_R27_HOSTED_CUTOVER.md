# #39 — Етап 3B-3B: hosted cutover r26 → r27 (виконано вручну Daniel-ом)

Дата: 2026-09-25. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39). Попередній етап: [docs/66](66_ISSUE_39_R27_SOURCE_CUTOVER.md). Наступний: [docs/69](69_ISSUE_39_WORKING_RHYTHM_ACTIVATION.md).

**Підсумковий статус: cutover виконано.** Автоматична спроба Claude Code зупинилась перед кроком 6: permission-класифікатор відхилив `set-secrets.sh` + `deploy.sh` (`[Production Deploy]`), і команда не виконалась (§7–§8). Після цього Daniel як Product Owner сам виконав авторизований deploy на хості (варіант (а) з §11). Production тепер serve-ить **r27 / Agent v27**. Пізніше на хості розгорнули ревізію `b33e877` (docs/68, лише transport). Підсумкові докази — у §12. Розділи 1–11 описують автоматичну спробу так, як вона відбулася, і не переписувались.

**Історичний статус автоматичної спроби: cutover НЕ виконано.** Кроки 1–5 пройшли. Крок 6 (`set-secrets.sh DJONIK_EXPECTED_RELEASE` → `r27`) разом із кроком 7 (`deploy.sh 6e092aa…`) відхилив permission-класифікатор Claude Code (auto mode, причина `[Production Deploy]`). Команда **не виконалася**: ні значення, ні checkout на хості не змінились. Після цього класифікатор блокує й read-only SSH. Тому стан хоста після відмови підтверджено лише з боку провайдера (§8).

На той момент production і далі serve-ив **r26 / Agent v26 / `d59a532`**. Rollback не знадобився, бо cutover не почався.

## 1. Стартовий стан репозиторію

| Перевірка | Результат |
|---|---|
| `HEAD` = `origin/main` | `6e092aaf5df408cc20e37c431f05e0903810d910` (після `git fetch`) |
| `git status --short` | порожній |
| `SERVING_RELEASE` | `RELEASE_R27` (`src/release.ts:417`) |
| `npm run build` | OK |

## 2. Preflight з боку провайдера (лише читання)

| Команда | Результат |
|---|---|
| `npm run release:check -- r27` | `r27 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 serving_in_this_revision=true`, exit 0. Drift немає: pm-rhythm pin і політики дозволів збігаються |
| `npm run release:check -- r26 --serving` | `r26 OK …@26`; hosted `session=sesn_018y1GzDi2zG4uJ5kWwyzKpv OK status=idle created=2026-09-25T06:50:13.282614Z app=d59a53261b813b6476b99173d693783e28e8586e agent=…@26` |

## 3. Попередній hosted r26 і перевірка «один poller»

- **Хост** `2.28.140.157` (hostname `Daniel-PC`): unit `active`, `MainPID=17543`, `NRestarts=0`, active з `2026-09-25 06:50:11 UTC`. Checkout `d59a53261b813b6476b99173d693783e28e8586e`, чисте дерево.
- **Журнал:** `[release] serving release=r26 app=d59a532… agent=…@26 … session=sesn_018y1GzDi2zG4uJ5kWwyzKpv trello_history=ok/expires=never`. За 12 год немає 409 і exit 78.
- **Один poller на хості:** `pgrep -af telegramCli` показує лише `17543 /usr/bin/node dist/telegramCli.js`.
- **Ноутбук:** серед локальних `node.exe` немає `telegramCli` чи `npm run telegram`. Є лише MCP-сервери (desktop-commander, server-github, chrome-devtools) і процеси Adobe.

## 4. Fetch цільового коміту на хості

`sudo -u djonik git fetch --quiet origin` → `cat-file -e 6e092aa…^{commit}` → **присутній**. Checkout не виконувався.

## 5. Юніт systemd: diff, install, daemon-reload (ВИКОНАНО)

Юніт узято з цільового коміту (`git show 6e092aa…:deploy/djonik-telegram.service`). Diff із встановленим — лише очікуваний блок:

```diff
-# The adapter needs outbound HTTPS only: no inbound port, no disk writes.
+# Working Rhythm delivery state (#39): /var/lib/djonik, created by systemd, owned by djonik, mode 0700,
+# … (DJONIK_WORKING_RHYTHM is deliberately NOT set here; activation is a separate, authorized stage).
+StateDirectory=djonik
+StateDirectoryMode=0700
+
+# The adapter needs outbound HTTPS only: no inbound port; the only disk write is the state directory above.
```

Інших змін сервісу чи безпеки немає. `DJONIK_WORKING_RHYTHM` у юніті не з'явився.

Після `install -m 0644 … /etc/systemd/system/djonik-telegram.service` і `systemctl daemon-reload`:

| Перевірка | Результат |
|---|---|
| MainPID до / після | `17543` / `17543`: процес r26 не перезапускався |
| `is-active` | `active` |
| `NRestarts` | `0` |
| `NeedDaemonReload` | `no` |
| `StateDirectory` / `StateDirectoryMode` | `djonik` / `0700` (набудуть чинності при наступному старті) |
| sha256 встановленого = `.new` | `c0dedbd5c6fbad54…` = `c0dedbd5c6fbad54…` |
| `/var/lib/djonik` | ще не існує: systemd створить його при старті |

Юніт зі `StateDirectory` нешкідливий і для r26 (docs/66 §10). Rollback юніта не потрібен.

## 6. Working Rhythm відсутній (перед кроком 6)

- `/etc/djonik/djonik.env`: ключі `ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_ID TRELLO_API_KEY TRELLO_READ_TOKEN TRELLO_READ_TOKEN_EXPIRES_AT DJONIK_EXPECTED_RELEASE`. Значення не друкувались, крім `DJONIK_EXPECTED_RELEASE=r26`. Рядків `DJONIK_WORKING_RHYTHM`: `0`.
- `/etc/djonik/revision.env`: лише `DJONIK_APP_REVISION`.
- `grep -rl DJONIK_WORKING_RHYTHM /etc/systemd/system/ /etc/djonik/` нічого не знайшов. Drop-in каталогу `djonik-telegram.service.d` немає. `Environment=NODE_ENV=production`.
- `/rhythm.md`: цей етап не робив жодного виклику Memory і нічого не створював.

## 7. Кроки 6–7: expected release → r27 і deploy (ЗАБЛОКОВАНО)

Спроба (одна SSH-команда, щоб не лишати перехідне вікно):

```bash
printf "r27\n" | bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE && … && bash /opt/djonik/app/deploy/deploy.sh 6e092aaf5df408cc20e37c431f05e0903810d910
```

Результат: **відхилено permission-класифікатором до виконання** (`[Production Deploy]`). Класифікатор прямо забороняє обходити відмову: частинами, іншим інструментом чи хостом. Тому кроки 6–11 не виконувались. Незважаючи на авторизацію Product Owner у промпті, потрібен дозвіл на рівні налаштувань Claude Code, або Daniel виконує ці дві команди сам.

## 8. Стан після відмови (з боку провайдера, лише читання)

Read-only SSH теж заблоковано. Стан підтверджено з локального середовища:

| Команда | Результат |
|---|---|
| `npm run release:check -- r26 --serving` | `OK`; hosted `sesn_018y1GzDi2zG4uJ5kWwyzKpv`, `app=d59a532…`, `@26`. Та сама Session, отже restart не було |
| `npm run release:check -- r27 --serving` | `r27 OK …@27`; `no Telegram serving Session found` — очікувано, cutover не відбувся |

**Висновок:** production — r26 / v26 / `d59a532` / `sesn_018y1…`. Юніт уже новий (зі `StateDirectory`), `DJONIK_EXPECTED_RELEASE=r26`. Цей стан узгоджений: випадковий restart підніме r26 нормально (StateDirectory лише створить порожній `/var/lib/djonik`).

## 9. Пункти звіту, що лишилися невиконаними

Не виконано, бо блокує §7: нова hosted Session, рядок `[release] serving release=r27`, `[rhythm] off`, власник і режим `/var/lib/djonik`, відсутність `rhythm-state.json`, `release:check -- r27 --serving` PASS, health журналу після cutover.

`release:check -- r26` (rollback-ціль) — PASS (§8).

Rollback не потрібен.

## 10. Не робилось

Telegram-повідомлення, платний inference, `DJONIK_WORKING_RHYTHM`, `/rhythm.md`, стан ритму, Trello, Memory, Calendar, зміни Agent/Skills/source, commit, push, закриття #39, промоція #35.

## 11. Наступний bounded крок

Спершу — продовжити цей самий етап 3B-3B з кроку 6. Є два варіанти:

- **(а)** Daniel сам виконує на хості (root) дві команди поспіль:
  ```bash
  bash /opt/djonik/app/deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE
  ```
  (ввести `r27`), одразу потім:
  ```bash
  bash /opt/djonik/app/deploy/deploy.sh 6e092aaf5df408cc20e37c431f05e0903810d910
  ```
  Після цього Claude Code виконує read-only верифікацію кроків 8–11 (потрібен дозвіл на read-only SSH).
- **(б)** Daniel додає в налаштування Claude Code дозвіл на ці SSH-команди, і етап продовжується тут.

Після PASS: hosted Telegram smoke r27 і підготовка активації Working Rhythm (окремі авторизовані етапи). #39 не DONE.

## 12. Підсумок: ручний cutover (дописано 2026-09-25)

- Кроки 6–7 (`DJONIK_EXPECTED_RELEASE=r27`, `deploy.sh`) Daniel виконав на хості вручну за варіантом (а). Claude Code їх не виконував, і host-журнал того запуску тут не відтворено.
- Перевірка з боку провайдера, лише читання (2026-09-25, під час етапу docs/69):
  ```text
  [release-check] r27 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27 serving_in_this_revision=true
  [release-check] r27 serving session=sesn_01KEfjL12VW2VCMwkMtqizDF OK status=idle created=2026-09-25T09:33:55.897395Z app=b33e877b334832bdbb08c629cb64fdc447397029 agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27
  ```
- Отже, serving = r27 / Agent v27 / `app=b33e877…`. Session r26 `sesn_018y1…` більше не serving.
- На момент cutover Working Rhythm лишався OFF. Його активація — окремий етап ([docs/69](69_ISSUE_39_WORKING_RHYTHM_ACTIVATION.md)).

## Стан робочого дерева (на момент автоматичної спроби)

```text
?? docs/67_ISSUE_39_R27_HOSTED_CUTOVER.md
```
