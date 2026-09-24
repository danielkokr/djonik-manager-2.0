# #33 — Always-on хост і Telegram cutover: підготовка, фікси, межа дії Product Owner

Дата: 2026-09-24. Canonical NOW: [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33) ([docs/02](02_DEVELOPMENT_ROADMAP.md)). База: `origin/main` = `cf131f9996575b44ec4d864ac56ac9f2f743f83e` (r26). Попередній етап: [docs/53](53_ISSUE_33_R26_CONTROLLED_CUTOVER.md). Runbook: [docs/52](52_PRODUCTION_SERVING_RUNBOOK.md).

**Авторизовано цим етапом:** read-only GitHub і Managed Agents, зміни source, тести, дослідження хостингу, підготовка деплою; restart і Telegram-smoke — лише на вже авторизованому хості.

**Не робилось (межа авторизації):**
- покупка хостингу, створення платного сервера, прийняття billing-умов;
- ротація чи відкликання токенів;
- будь-які зміни Agent v26, specialist, Skills, model/prompt;
- видалення Agents/Sessions/Skills;
- Trello-, Memory- чи Calendar-записи;
- платний inference: жодного повідомлення в Session, $0;
- закриття #33, просування #34.

## 1. Вердикт

**READY FOR FINAL HOST ACTION.** #33 **не** можна закривати. Ніде немає авторизованого always-on хоста, а його створення — платна дія акаунта, яку може зробити лише Product Owner. Cloud-контейнер цієї сесії ефемерний: його прибирають після простою, тож хостом він бути не може. Запускати з нього Telegram-poller не можна: це був би другий poller без гарантії життя.

Усе, що можна було зробити без цієї дії, зроблено й перевірено:
1. **Windows-баг `release:check`** знайдено й виправлено (§3).
2. **Хост обрано** за свіжим дослідженням (§4–§6): Hetzner Cloud CX23 + Ubuntu 24.04 LTS + systemd. Fallback змінено з Railway на **Fly.io** (один Machine).
3. **Пастку rollback знайдено й виправлено в `deploy.sh`** (§16). Раніше rollback на r25 за штатним runbook **зупинив би** Djonik.
4. **Підготовку хоста автоматизовано:** `deploy/bootstrap-host.sh` і `deploy/set-secrets.sh`. Обидва скрипти прогнано в Ubuntu 24.04, лише крок NodeSource заблоковано egress цієї пісочниці (§10).
5. **Додано read-only доказ serving з боку провайдера:** `release:check -- r26 --serving` (§12).
6. **Перевірено fail-open Trello-токена** на справжньому production entrypoint (§9).
7. **Rollback-drill проведено офлайн:** ревізію `15ca0c7` зібрано; вона обслуговує r25, `release:check` OK (§16).

Лишилась **одна дія Product Owner** (§18): створити сервер і виконати 4 команди. Після цього — Telegram-smoke, restart-тест і закриття #33.

## 2. Поточний стан GitHub і релізу (read-only, 2026-09-24)

| Перевірка | Результат |
|---|---|
| `origin/main` | `cf131f9996575b44ec4d864ac56ac9f2f743f83e` (= очікуваний) |
| Робоче дерево до змін | чисте, гілка `claude/magical-bardeen-yuxrmt` = `cf131f9` |
| `npm test` / `typecheck` / `build` / `git diff --check` | 635/635 / clean / OK / clean |
| `release:check r26` | `r26 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26 serving_in_this_revision=true`, exit 0 |
| `release:check r25` | `r25 OK agent=…@25 serving_in_this_revision=false`, exit 0 (rollback-ціль жива) |
| Agent latest | **26** (`updated_at 2026-09-24T08:17:17Z`), не архівований |
| Specialist latest | **4** (`updated_at 2026-09-21`), не архівований |
| Нові Sessions після docs/53 | немає; останні дві — diagnostic-Sessions docs/53 |
| Telegram-Session з `source=telegram, release=r26` | **немає**: `release:check -- r26 --serving` → «not found» |
| Telegram webhook | не встановлено (`getWebhookInfo`: url порожній, pending 0). Long polling не впреться в 409 від webhook |

Висновок: source і remote — точно r26. Жоден r26-адаптер ще ніде не обслуговував Telegram.

## 3. Windows `release:check`: корінь і фікс

**Симптом (Daniel, Windows):** `[release-check] r26 OK …`, потім `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`. Процес падає з crash-кодом замість 0.

**Корінь (підтверджено, не припущення):**
- Відомий баг Node на Windows — [nodejs/node#56645](https://github.com/nodejs/node/issues/56645): `process.exit()` одразу після завершеного `fetch()` гониться з teardown libuv async-handle.
- Мінімальне відтворення в issue — рівно `await fetch(url); process.exit()`.
- Upstream-фікс — nodejs/node#61999, є в Node **v24.20.0+**. Той самий збій бачили інші CLI: [firebase-tools#11099](https://github.com/firebase/firebase-tools/issues/11099) на Node 24.18, [pi#5805](https://github.com/earendil-works/pi/issues/5805).
- `src/releaseCheck.ts` робив саме це: Anthropic SDK ходить через глобальний `fetch`, після чого `main().then((code) => process.exit(code))`.
- На Linux і macOS баг не проявляється. Сам r26 від нього не залежить.

**Фікс (мінімальний):**
- новий `src/processExit.ts` → `exitNaturally(result)`;
- він ставить `process.exitCode = code` і дає event loop завершитись самому;
- помилка лишається exit 1 з повідомленням; 78 і 2 зберігаються;
- unref'd watchdog на 10 с примусово завершує процес **з тим самим кодом**, лише якщо якийсь handle тримає loop. Отже, ні зависання, ні підміни результату;
- `src/releaseCheck.ts` тепер закінчується `void exitNaturally(main())`.

**Регресійні тести (`src/processExit.test.ts`, +5):**
- коди 0/2/78 ставляться без forced exit;
- rejection → 1 + повідомлення;
- watchdog зберігає код;
- `releaseCheck.ts` не містить `process.exit(`;
- **реальний дочірній процес** робить `fetch` через keep-alive і завершується сам з кодом 78 за ≈0.3 с.

**Перевірено на Linux (Node 22.22.2 і Node 24.21.0):**

| Команда | Результат |
|---|---|
| `tsx src/releaseCheck.ts r26` | OK, exit 0, 1.1 с |
| `node dist/releaseCheck.js` (r26) | OK, exit 0, 0.33 с (Node 24: 0.38 с) |
| `node dist/releaseCheck.js r25` | OK, exit 0 |
| без ключа / невідомий реліз / невалідний ключ (401) | 78 / 2 / 1 — реальні збої не приховано |

**Windows не перевірено:** у цьому середовищі немає Windows. Перед закриттям #33 потрібна **одна локальна команда Daniel** (§18, п. 0). Незалежно від фіксу, оновлення локального Node до ≥ 24.20 (або лишитись на 22.x) прибирає корінь.

**Свідомо не змінено:** `telegramCli.ts` досі завершується через `process.exit(code)` після власного graceful shutdown.
- На Linux-хості бага немає.
- Зміна exit-шляху serving-процесу додала б затримку до `TimeoutStopSec`.
- На Windows-ноутбуці (лише аварійний fallback) після Ctrl+C можливий той самий assert, але вже *після* drain і закриття Session. Це косметика; вона зникає з Node ≥ 24.20.

## 4. Дослідження хостингу (свіже, вересень 2026)

Вимоги: один довгоживучий Node ≥ 20 процес; лише вихідний HTTPS; без inbound; restart; **stop-before-start** (ніколи двох poller-ів); grace ≥ 150 с; секрети; низька ціна; без щоденного DevOps; той самий процес пізніше хостить scheduler #39.

| Варіант | Ціна | Деплой: overlap? | Restart / grace | Оцінка |
|---|---|---|---|---|
| **Hetzner Cloud CX23 + systemd** | **€5.49/міс** (2 vCPU, 4 GB, 40 GB, 20 TB трафіку) після підвищень квітня/червня 2026; погодинна оплата ([whtop](https://www.whtop.com/plans/hetzner.com/144086), [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [analysis](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)) | **Ні, структурно:** `systemctl restart` = stop (drain), потім start | `Restart=on-failure`, `TimeoutStopSec=150` | **Обрано** |
| Fly.io, один Machine | ≈ $4/міс (shared-cpu-1x, 512 MB). **З 2026-10-01 пам'ять Machines дорожчає до $6/GB·міс**, CPU без змін ([Fly pricing update](https://fly.io/pricing-update/), [Layerbase](https://layerbase.com/blog/fly-io-memory-price-increase)) | **Ні:** для одного Machine rolling-деплой знищує старий *до* старту нового ([Fly docs](https://fly.io/docs/blueprints/seamless-deployments/)) | `kill_timeout` до 300 с | **Новий fallback** |
| Railway Hobby | $5/міс, включно з $5 usage ([Railway](https://docs.railway.com/pricing/plans)) | **Так:** новий деплой стає активним до SIGTERM старому | restart policy | Понижено: overlap = 409 на кожному деплої |
| Render worker Starter | $7/міс, 0.5 CPU / 512 MB ([Render](https://render.com/pricing)) | zero-downtime → overlap | так | Дорожче, той самий overlap |
| Serverless / webhook | — | — | — | Відкинуто: суперечить in-process FIFO / continuation / drain #32/#40 |
| Managed Agents Deployments | — | — | — | Це cron-Sessions, не Telegram-poller (docs/51 §2) |
| Цей cloud-контейнер | $0 | — | ефемерний | Не хост: його прибирають після простою |

**Змінене припущення:** fallback — **Fly.io, а не Railway**. Раніше (docs/51 §15) Fly не вдалось перевірити. Тепер підтверджено, що один Machine має ту саму властивість, що й systemd: stop-before-start. Railway і Render мають overlap за дизайном. Ціни Fly змінюються **1 жовтня**, тож перераховувати їх — у момент, коли fallback справді знадобиться.

## 5. Фінальний вибір хоста

**NOW: Hetzner Cloud CX23, Ubuntu 24.04 LTS, systemd, один unit.** Чому не простіше:
- тільки тут «ніколи два poller-и» і graceful drain — властивості платформи, а не таймінгу;
- найдешевше;
- один процес без Docker;
- #39 scheduler без змін;
- щоденної роботи немає: security-оновлення ставляться самі, деплой — одна команда.

Цей варіант пройшов перевірку, а не взятий за замовчуванням: перевірено Fly, Railway, Render, serverless і сам контейнер.

**Fallback: Fly.io, один Machine** (якщо Daniel вирішить не мати сервера взагалі). Конфіг, коли знадобиться:
- `fly launch --ha=false` (за замовчуванням Fly створює **2** Machines — це два poller-и);
- без `[http_service]`;
- `kill_timeout = 150`;
- `auto_stop_machines = "off"`;
- restart `on-failure`;
- секрети через `fly secrets set`.

Dockerfile і `fly.toml` навмисно **не** додано: Docker не потрібен для обраного хоста (правило «не додавай Docker без потреби»).

## 6. Специфікація хоста

| Параметр | Значення |
|---|---|
| Провайдер / тип | Hetzner Cloud, **CX23** (x86, 2 vCPU shared, 4 GB RAM, 40 GB) |
| Локація | EU: `fsn1` (Falkenstein); якщо CX23 там недоступний — `nbg1` або `hel1` |
| Образ | **Ubuntu 24.04 LTS** (найкраще перевірена з NodeSource; ця пісочниця — теж 24.04) |
| Мережа | публічна IPv4 + IPv6. IPv4 потрібна: github.com не має IPv6 |
| Доступ | SSH-ключ Daniel, доданий при створенні сервера |
| Backups / volumes | не потрібні: хост без стану, відтворюється `bootstrap-host.sh` + `set-secrets.sh` + `deploy.sh` |
| Node | **24.x LTS** з NodeSource → `/usr/bin/node` (= `ExecStart` unit-а). Повний тест-набір пройдено на Node 24.21.0: 640/640 до двох read-back-тестів |
| Часовий пояс ОС | UTC. Київський час задає код явно (`Europe/Kyiv` у `trelloWorkHistory.ts`/`djonikClient.ts`); для #39 те саме |

## 7. Security baseline

`deploy/bootstrap-host.sh` (root, один раз, повторний запуск безпечний):
- `apt` security-оновлення автоматично (`unattended-upgrades`, явно ввімкнено); Node оновлюється в межах 24.x;
- користувач **`djonik`**: system, shell `/usr/sbin/nologin`, home `/opt/djonik`. Процес ніколи не працює від root (`User=djonik` у unit);
- checkout `/opt/djonik/app` належить `djonik`. Процес бачить його read-only (`ProtectSystem=strict`, `ProtectHome=true`, `NoNewPrivileges=true`);
- `/etc/djonik` — root, `0700`;
- unit встановлюється, але **не** вмикається й не стартує: перший старт робить лише `deploy.sh`, після зупинки ноутбука;
- `ufw`: deny incoming, allow outgoing, allow лише OpenSSH. Порт застосунку не потрібен;
- SSH: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`. Застосовується **лише** якщо в root є authorized key, щоб не заблокувати себе. Перед reload — `sshd -t`.

Немає Docker, Nginx, БД, Redis чи Kubernetes: розгортаємо один Node-процес.

## 8. Розкладка секретів

`/etc/djonik/djonik.env` — root, `0600`. Пише лише `deploy/set-secrets.sh`:
- значення вводяться з клавіатури; секретні не показуються на екрані (`read -s`);
- вони не потрапляють у shell history чи командний рядок;
- дозволені лише символи `[A-Za-z0-9:_.+-]`, бо файл читають і systemd, і `.` у `deploy.sh`;
- файл замінюється атомарно (`mktemp` → `chmod 0600` → `mv`);
- для ротації передаються лише потрібні ключі, решта лишається.

| Ключ | Секрет? | Звідки вимога в коді |
|---|---|---|
| `ANTHROPIC_API_KEY` | так | `loadServingConfig` (required), `releaseCheck` |
| `TELEGRAM_BOT_TOKEN` | так | `loadTelegramConfig` |
| `TELEGRAM_ALLOWED_USER_ID` | ні | `loadTelegramConfig` (allowlist одного користувача) |
| `TRELLO_API_KEY`, `TRELLO_READ_TOKEN` | так | required, бо r26 має `trello_work_history` |
| `TRELLO_READ_TOKEN_EXPIRES_AT` | ні | `never` або ISO-дата; без неї немає попередження |
| `DJONIK_EXPECTED_RELEASE` | ні | `r26`: асерція хоста; тепер перевіряється і в `deploy.sh` до restart |
| `DJONIK_APP_REVISION` | ні | **не** в цьому файлі: `deploy.sh` пише `/etc/djonik/revision.env` (0644) з точним SHA |

**Не на хості:** `DJONIK_AGENT_ID`, `…_ENVIRONMENT_ID`, `…_MEMORY_STORE_ID`, `…_VAULT_ID` — вони приходять із рев'юйованого `src/release.ts`; тест це закріплює. Trello MCP OAuth лишається у vault Anthropic.

Після налаштування хоста **жоден секрет не потрібен на ноутбуці** для роботи Djonik.

## 9. Стратегія Trello read token

**Факт (read-only `GET /1/tokens/{token}`, без виводу секрету):**
- поточний токен: `permissions` = Board `*` read, Organization `*` read, **write=false**;
- `dateCreated 2026-09-22T07:44Z`, **`dateExpires 2026-10-22T07:44Z`**.

**Порівняння:**

| | A. read-only, `expiration=never` + відкликання вручну | B. 30-денний + регулярна ротація |
|---|---|---|
| Наслідок витоку | читання всіх дошок до відкликання | читання всіх дошок ≤ 30 днів |
| Реальний вектор витоку | компрометація хоста. Але там же лежать `ANTHROPIC_API_KEY` і Telegram-токен — **теж безстрокові й цінніші** | той самий |
| Операційний ризик | ≈ 0 | 12 ручних ротацій на рік; пропуск = work history недоступна |
| Експозиція при роботі з секретом | 1 раз | 12 разів на рік вставляти секрет через SSH |

**Рішення: A — read-only токен без строку дії.** Короткий строк тут майже не зменшує ризик: на тому самому хості вже лежать безстрокові секрети більшої цінності. Натомість він додає регулярну ручну роботу й регулярну точку відмови. Компенсуючі заходи:
- scope лише `read` — перевіряється read-only запитом вище;
- токен лише в root-файлі `0600`;
- відкликання за хвилину (Trello → Account → Applications);
- щорічний перегляд.

Ротація — **дія Product Owner**; автоматично не виконувалась. Термін: **до 2026-10-22 07:44 UTC**, найкраще — під час налаштування хоста (§18). Процедура: docs/52 §5 + `set-secrets.sh TRELLO_READ_TOKEN TRELLO_READ_TOKEN_EXPIRES_AT`.

**Fail-open перевірено на реальному entrypoint.** `node dist/telegramCli.js` із навмисно невалідним `TRELLO_READ_TOKEN` і фейковим Telegram-токеном:
```text
[release] preflight release=r26 app=cf131f9…+dirty agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26
[release] warning Trello work history is unauthorized; weekly-review turns will report history as unavailable. Rotate or fix the read-only token (docs/52 §5).
[release] Telegram bot check failed: telegram_unauthorized
```
- Невалідний токен **не** зупинив старт: процес дійшов до перевірки Telegram, а exit 78 спричинив саме фейковий Telegram-токен.
- Під час ходу tool повертає «Trello history is unavailable because the read-only credentials were rejected.» (`TrelloWorkHistoryError`, покрито тестами). Решта Djonik працює.

## 10. Кроки деплою: що виконано насправді

На реальному хості — **нічого**: хоста немає (§1). Виконано механічну перевірку тих самих скриптів у пісочниці Ubuntu 24.04.

**`bootstrap-host.sh`** (з заглушками `ufw`/`sshd`/`systemctl`, бо в контейнері їх немає):
- створено користувача `djonik` (`/usr/sbin/nologin`, home `/opt/djonik`);
- зроблено clone публічного репо, HEAD = `cf131f9`;
- `/etc/djonik` = root 0700, unit = root 0644;
- `ufw`: deny incoming / allow OpenSSH;
- SSH-hardening правильно **пропущено** з попередженням (у root немає ключа);
- exit 0.
- Крок NodeSource тут не пройшов: `deb.nodesource.com` заблоковано egress-проксі пісочниці (403). На хості це звичайний HTTPS.

**`set-secrets.sh`** (фіктивні значення):
- 7 ключів → root 0600;
- ротація 2 ключів лишає 7 рядків, решта незмінна;
- значення з `$(…)` відхилено (exit 1, файл не змінено);
- невідомий ключ → exit 2;
- тимчасових файлів не лишилось.

**`deploy.sh`** — справжні `git`/`npm ci`/`build`/`release:check` проти живого API; `systemctl`/`journalctl` — заглушки:

| Сценарій | Результат | Виклики systemctl |
|---|---|---|
| `EXPECTED=r26`, деплой `cf131f9` | `r26 OK`, tuple `app=cf131f9…`, exit 0 | `enable`, `restart` |
| `EXPECTED=r26`, rollback `15ca0c7` | **відмова до restart**, exit 1 | **жодного** |
| `EXPECTED=r25`, rollback `15ca0c7` | `r25 OK`, tuple `release=r25 app=15ca0c7…`, exit 0 | `enable`, `restart` |

Після перевірки всі артефакти (`/opt/djonik`, `/etc/djonik`, користувач, unit, worktree) видалено.

**Зміни `deploy.sh`:**
1. **Guard `DJONIK_EXPECTED_RELEASE` до restart** (§16).
2. `systemctl enable --quiet` перед restart. Unit переживає reboot, а перший деплой більше не вимагає окремого `enable --now`. `enable` нічого не стартує; єдиний старт — той самий `restart`.

**Процедура для хоста** — точні команди в §18. Порядок збігається з місією:
- host → clone → точний коміт → Node ≥ 20 → `npm ci` → build → unit → секрети;
- **стоп ноутбука** → жодного іншого poller-а → restart;
- чекати `[release] serving release=r26 … app=<sha>`;
- unit active, без 409, без секретів чи контенту в логах.

## 11. Hosted serving tuple

**Ще не отримано: хоста немає.** Очікуваний рядок (формат перевірено live у docs/53 §8; `deploy.sh` чекає саме його):
```text
[release] serving release=r26 app=<deployed sha> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26 model=claude-sonnet-5/medium/standard system=3e204453c82c skill_pins=explicit skills=task-management@skver_01CJQkVY1kp1urhBWQgHUYxW,daily-planning@skver_01EL7d3fy4WWYBSsD3PmK9LQ,weekly-planning@skver_01FdtnnkbePBjNJGTuJyAvhw,studio-intake@skver_018sJv1GCnzfZRG4NbExbAzj,work-review@skver_015LYzVdivGGMsBpuki4kW4S specialist=agent_01KNiQDzzPjaMU6LLF4mU6uM@4 builtin=edit,glob,grep,read,write custom_tools=trello_work_history#dcf099612535 memory=read_write session=sesn_… trello_history=ok/expires=never
```

## 12. Hosted Session ID і атестація

**Ще немає.** Щоб отримати доказ без доступу до логів хоста, додано read-only режим:
```text
npm run release:check -- r26 --serving
```
- Знаходить найновішу Session з metadata `source=telegram, release=r26`.
- Перечитує її (`sessions.retrieve`) і атестує тим самим `attestServingSession`, що й старт.
- Друкує `session=… status=… created=… app=… agent=…@26`.
- Нічого не створює й не надсилає.
- Сьогодні: `no Telegram serving Session found` (exit 78). Це правильно і є додатковим доказом, що жоден r26-адаптер ще не обслуговував Telegram.
- Позитивний шлях перевірено live на існуючій r26-Session docs/53 (`sesn_01UMLG3o…`, source=diagnostic): атестація OK, `agentVersion 26`.
- Тести: +2 (вибір найновішої Telegram-Session; `null`, якщо її немає; fail-closed на дрейфі).

## 13. Telegram smoke

**Не виконувався: хоста немає. Платного inference не було ($0).** Підготовлено (≤ $0.40 list; орієнтир: звичайний хід 2–7¢, work-review 3–15¢ за docs/53):

1. **Звичайний:** «Привіт, ти на зв'язку? Відповідай коротко.»
2. **Capability, read-only:** «Що по Extract зрушилось цього тижня? Коротко.»

Що перевірити після кожного ходу:
- у `journalctl` є лише `[turn]`/`[group]` (з `DJONIK_TURN_TELEMETRY=1` на час smoke), без тексту;
- у Telegram — лише фінальна відповідь, без технічного тексту;
- за Session (`release:check -- r26 --serving` → id): `end_turn`, для ходу 2 — `trello_work_history` ×1, `trelloWrite*` = 0, Memory `write/edit` = 0;
- вартість — з `session.usage`.

Мутацій не використовуємо.

## 14. Restart / supervision

**Не виконувався: хоста немає.** Процедура після smoke, коли немає активного ходу:
1. `systemctl restart djonik-telegram`.
2. Перевірити в `journalctl -u djonik-telegram --since -5min -o cat`:
   - `[shutdown] begin reason=SIGTERM` → `[shutdown] end drained=true interrupted_chats=0 exit=0` (stop-before-start);
   - **потім** новий `[release] preflight` → `[release] serving … session=<новий sesn_>`;
   - немає `telegram_conflict_another_poller`;
   - `systemctl is-active` = active.
3. `release:check -- r26 --serving` показує **нову** Session.

Уже закріплено тестами source:
- один `ExecStart`, не template;
- `TimeoutStopSec` ≥ drain + 20;
- `Restart=on-failure`, `RestartPreventExitStatus=78`, `StartLimitBurst=5`;
- 409 → drain → exit 75.

## 15. Висновок щодо Session continuity

Прийнято (docs/51 §11): **одна serving-Session на процес**, без resume між рестартами.

Для v1 це прийнятно:
- рестарти рідкісні: деплой, reboot після оновлення ядра, креш;
- Memory — довготривалий шар; Trello читається свіжим щоразу;
- persistence Session повернула б ризики, які закривали #31/#32/#40: відновлення незавершеного ходу, повторна continuation, неатестований конфіг старої Session.

**Що бачить Daniel:** після рестарту Djonik не пам'ятає розмову *до* рестарту (наприклад, «а що з тим, про що ми щойно говорили?»). Факти з Memory, Trello і календаря доступні.
- Якщо рестарт стався посеред ходу, Daniel отримає чесне повідомлення «Джонік перезапускається…» з порадою перевірити Trello перед повтором.
- Ротація секрету (`set-secrets.sh` + restart) теж починає нову Session.

Переглянути варто лише тоді, коли реальне використання покаже біль (наприклад, часті рестарти). Це не #33.

## 16. Готовність rollback

**Знайдено й виправлено пастку.** За runbook docs/52 §6 rollback — це `deploy/deploy.sh 15ca0c7…`. Але на хості стоїть `DJONIK_EXPECTED_RELEASE=r26`. Раніше `deploy.sh`:
- пройшов би `release:check` (перевіряє реліз ревізії, тобто r25);
- **зупинив би робочий r26-процес**;
- запустив би новий, який одразу виходить з 78 (`DJONIK_EXPECTED_RELEASE=r26 but this revision serves r25` — відтворено на реальному збірнику `15ca0c7`). Unit не перезапускається на 78.

Тобто rollback **поклав би Djonik**. Тепер `deploy.sh` до restart читає `SERVING_RELEASE.id` зібраної ревізії і відмовляє з підказкою «спершу встанови `DJONIK_EXPECTED_RELEASE=r25`». Робочий процес не зачеплено. Guard діє під час rollback, бо bash розбирає `main` зі *стартової* версії скрипта ще до checkout. Тест: `src/deployConfig.test.ts`.

**Drill (офлайн, без production-churn):**
- `git show 15ca0c7:src/release.ts` → `SERVING_RELEASE = RELEASE_R25`;
- worktree `15ca0c7` → `npm ci` + build → `node dist/releaseCheck.js` → `r25 OK …@25 serving_in_this_revision=true`, exit 0;
- `latest`-Skills r25 досі резолвляться в accepted версії;
- Agent v25 існує й незмінний;
- `deploy.sh` на `15ca0c7` з `EXPECTED=r25` — успіх, tuple `release=r25` (§10).

**Rollback-процедура (docs/52 §6, оновлено):**
1. `deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE` → `r25`.
2. `deploy/deploy.sh 15ca0c711d9bef9873dd688121dfcce483641204`.

Записів в Agent немає. Уже зроблені записи в Trello/Memory не відкочуються.

## 17. Місячна вартість

| Стаття | Сума |
|---|---|
| Hetzner CX23 | **≈ €5.49/міс** (оплата погодинна, скасувати можна будь-коли). Окремий ~€0.50 за IPv4 з'являється лише в частині джерел — перевірити на checkout |
| Backups | €0: не потрібні, хост без стану |
| Inference | як і раніше, за хід: 2–21¢ (docs/53); idle-Session нічого не коштує |
| Цей етап | **$0** inference, €0 хостинг |

Разом за хост **≈ €5.5–6/міс** — записати поруч із токен-телеметрією (docs/05).

## 18. Що лишилось Product Owner (мінімально)

**0. Windows (1 команда, ноутбук, після fast-forward):**
```powershell
npm run release:check -- r26; echo "exit=$LASTEXITCODE"
```
Очікувано: `r26 OK …`, `exit=0`, без `Assertion failed`, без зависання.

**1. Прийняти цей звіт і fast-forward `main`** (команди — у фінальному звіті сесії). Деплоїти **новий** коміт: у ньому guard rollback, bootstrap і `--serving`.

**2. Hetzner (єдина платна дія):**
- акаунт → Cloud → New Server;
- **CX23, `fsn1`, Ubuntu 24.04**, IPv4+IPv6;
- додати свій **SSH public key**; backups — ні.

**3. На сервері (як root, по SSH):**
```bash
curl -fsSL https://raw.githubusercontent.com/danielkokr/djonik-manager-2.0/main/deploy/bootstrap-host.sh -o /root/bootstrap-host.sh
bash /root/bootstrap-host.sh
bash /opt/djonik/app/deploy/set-secrets.sh
```
У `set-secrets.sh` ввести:
- ключі з поточного локального `.env`;
- **новий** Trello read token (docs/52 §5, `expiration=never&scope=read`), `TRELLO_READ_TOKEN_EXPIRES_AT=never`;
- `DJONIK_EXPECTED_RELEASE=r26`.

Старий токен відкликати після успішного старту.

**4. Cutover (single poller):**
- **зупинити локальний `npm run telegram` на ноутбуці** (Ctrl+C, дочекатись виходу);
- потім:
```bash
/opt/djonik/app/deploy/deploy.sh <SHA нового main>
```
Очікувано: рядок `[release] serving release=r26 … app=<SHA> … trello_history=ok/expires=never`, exit 0.

**5. Доказ і smoke** (можна в новій сесії Claude — це read-only + 2 повідомлення):
- `npm run release:check -- r26 --serving` → hosted Session ID;
- два повідомлення з §13 у Telegram;
- restart-тест з §14.

**6. Опційно:**
- залишати чи ні `DJONIK_TURN_TELEMETRY=1`;
- прибрати idle validation-Sessions docs/53 (архівація — рішення PO).

## 19. Чи виконано acceptance #33

| Умова | Стан |
|---|---|
| r26 існує і прийнятий | так (docs/53, `release:check r26` OK) |
| GitHub/source = r26 | так (`cf131f9`; цей коміт не змінює реліз) |
| always-on хост існує | **ні — потрібна дія PO (§18.2)** |
| hosted-процес працює | **ні** |
| рівно один Telegram poller | передумови перевірено (webhook немає, r26-Telegram-Session немає); сам cutover — §18.4 |
| хост створює pinned/attested r26 Session | **ні** (механізм перевірено live у docs/53; read-back готовий) |
| реальний Telegram-хід успішний | **ні** |
| секрети не залежать від ноутбука | розкладку й інструменти готово; застосування — §18.3 |
| restart/supervision | unit і тести готові; live — §14 після хоста |
| rollback задокументовано | так, і виправлено пастку (§16) |
| ротацію токена задокументовано | так (§9, docs/52 §5) |
| немає невирішених блокерів | один: хост (дія PO) |

**#33 acceptance не виконано.** Статус: **READY FOR FINAL HOST ACTION**.

## 20. Наступний крок roadmap (якщо прийнято)

1. PO виконує §18.0–§18.4.
2. Одна bounded сесія (read-only + ≤ $0.40): §18.5 → hosted Session ID, 2 Telegram-ходи, restart-тест → docs/55 → закриття #33 рішенням PO.
3. Лише після цього docs/02 просуває наступний пункт ([#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34)). **#34 цим етапом не просувається.**

**Продуктові спостереження docs/53** не змішано з хостингом, лишаються окремими кандидатами після #33:
1. work-review дублює факти в PM-секції;
2. F3 не показує tool-free другу частину;
3. дрібна мовна шліфовка.

Жодне з них не блокує деплой.

## Змінені файли

| Файл | Зміна |
|---|---|
| `src/processExit.ts` (новий) | `exitNaturally`: `process.exitCode` + unref'd watchdog замість `process.exit()` |
| `src/processExit.test.ts` (новий) | 5 тестів, зокрема реальний child-процес після keep-alive `fetch` |
| `src/releaseCheck.ts` | natural exit; режим `--serving` (read-only read-back hosted Session) |
| `src/servingRelease.ts` | `readBackServingSession` (list → retrieve → `attestServingSession`) |
| `src/servingRelease.test.ts` | +2 тести read-back |
| `deploy/deploy.sh` | guard `DJONIK_EXPECTED_RELEASE` ↔ реліз ревізії **до** restart; `systemctl enable` перед restart |
| `deploy/bootstrap-host.sh` (новий) | одноразова підготовка Ubuntu 24.04: Node 24, `djonik`, clone, `/etc/djonik`, unit (не стартує), ufw, SSH key-only |
| `deploy/set-secrets.sh` (новий) | приховане введення, валідація, root 0600, атомарна заміна, часткова ротація |
| `src/deployConfig.test.ts` | +3 тести інваріантів (guard до restart, bootstrap не стартує poller, секрети) |
| `docs/54` (цей), `docs/52`, `docs/02`, `docs/01`, `README.md` | поточний стан, хост, rollback-крок, fallback |

Перевірки: `npm test` **645/645** (635 + 10), `typecheck` clean, `build` OK, `git diff --check` clean; `release:check r26` OK (exit 0, природний вихід).
