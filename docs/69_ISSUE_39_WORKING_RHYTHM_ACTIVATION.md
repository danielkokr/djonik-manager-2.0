# #39: активація Working Rhythm у production (ЗАБЛОКОВАНО, runbook для Daniel)

Дата: 2026-09-25, ~12:45 Europe/Kyiv, п'ятниця. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39). Попередній етап: [docs/67](67_ISSUE_39_R27_HOSTED_CUTOVER.md) §12.

> **Примітка (пізніше того ж дня):** source-review [docs/71](71_ISSUE_39_SOURCE_REVIEW_AND_MERGE_RULE.md) додав локально, без commit, правило «найближчого ритуалу» і ще два дрібні виправлення. Runbook нижче описує розгорнуту ревізію `b33e877`. Нову поведінку дасть лише окремий авторизований deploy. Release r27, Agent і Skills не змінюються.

**Статус: активацію НЕ виконано.** Перший крок, read-only SSH-перевірку стартового стану хоста, відхилив permission-класифікатор Claude Code (`[Production Reads]`). Тому `DJONIK_WORKING_RHYTHM` не змінювався, restart не виконувався, і на хості нічого не змінено. Обхід заборонено, як і в docs/67 §7. Далі потрібна дія Daniel (§4).

## 1. Що перевірено

| Перевірка | Результат |
|---|---|
| `origin/main` містить `b33e877b334832bdbb08c629cb64fdc447397029` | так (HEAD = `b33e877`) |
| `npm run release:check -- r27 --serving` (провайдер, лише читання) | `r27 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@27`; serving `sesn_01KEfjL12VW2VCMwkMtqizDF` `status=idle` `app=b33e877…` `@27`: drift немає |
| Host: unit, NRestarts, один poller, `DJONIK_WORKING_RHYTHM` відсутній, `/var/lib/djonik`, журнал `[rhythm] off` | **не перевірено**, SSH заблоковано |
| `/rhythm.md` | не створювався; Memory цей етап не читав і не змінював |

## 2. Конфігурація пілоту

`/rhythm.md` свідомо відсутній, тож діють дефолти з source: enabled; Mon plan 09:30; Tue–Thu brief 09:30; Fri morning 09:30; Fri review 16:30; quiet 20:00–09:30; exceptions увімкнені (preferred 1/день, hard 2/день лише для нових high, spacing 120 хв, вихідні вимкнені).

Маршрут налаштування: `deploy/set-secrets.sh` **не приймає** `DJONIK_WORKING_RHYTHM` (`Unknown key`: ключа немає в `ALL`). Змінювати source заборонено, тому прийнятий шлях — рядок у `/etc/djonik/djonik.env` (`EnvironmentFile` юніта, root, 0600).

## 3. Очікувана поведінка після restart (з коду, не спостережено)

- Журнал: `[release] serving release=r27 … app=b33e877…`, потім `[rhythm] running`. Причина активації дорівнює `DJONIK_WORKING_RHYTHM=on`, межа `pre_execution`. Tick кожні 60 с: `[rhythm] tick …`.
- Перший tick створює `/var/lib/djonik/rhythm-state.json` (`version: 1`) через recovery-запис. Friday morning 09:30 уже поза grace, тому його **не надіслано** і в `deliveries` немає `sent`.
- **Ризик першого tick (не баг scheduler-а):** о ~12:45 п'ятниці вікно exceptions відкрите. Тому перший tick читає Trello (лише читання, раз на 15 хв) і наповнює `signals`. Якщо зараз є відкритий interrupt-сигнал severity ≥ medium, дефолти дозволяють **один exception-хід** (модель може лишитись silent). Це штатна поведінка прийнятих дефолтів. Catch-up ранкового брифу вона не означає.
- Якщо одразу надійшов саме **Friday morning** — це баг планування: STOP і rollback (§4.3).

## 4. Runbook для Daniel (root на хості)

**4.1 Стартовий стан** (очікувано: active, один `telegramCli`, `0`, немає `/var/lib/djonik/rhythm-state.json`):
```bash
systemctl show djonik-telegram -p ActiveState -p SubState -p MainPID -p NRestarts -p StateDirectory; pgrep -af telegramCli; grep -c '^DJONIK_WORKING_RHYTHM=' /etc/djonik/djonik.env; grep '^DJONIK_EXPECTED_RELEASE=' /etc/djonik/djonik.env; cat /etc/djonik/revision.env; ls -la /var/lib/djonik
```

**4.2 Активація** (лише якщо 4.1 як очікувано):
```bash
printf 'DJONIK_WORKING_RHYTHM=on\n' >> /etc/djonik/djonik.env && systemctl restart djonik-telegram
```

**4.3 Перевірка через ~2 хв:**
```bash
systemctl show djonik-telegram -p ActiveState -p SubState -p MainPID -p NRestarts; pgrep -af telegramCli; journalctl -u djonik-telegram --since "-5min" --no-pager | grep -E '\[release\]|\[rhythm\]|409|status=78'
```
```bash
node -e 'const s=JSON.parse(require("fs").readFileSync("/var/lib/djonik/rhythm-state.json","utf8"));console.log(JSON.stringify({version:s.version,deliveries:Object.entries(s.deliveries).map(([k,v])=>[k,v.status]),signals:Object.keys(s.signals).length}))'
```
Очікувано: active/running, один poller, `[rhythm] running`, без 409 та exit 78, жодного `…friday_morning` зі статусом `sent`.

**Rollback** (лише якщо процес нездоровий): видалити рядок і перезапустити. r27 не відкочувати.
```bash
sed -i '/^DJONIK_WORKING_RHYTHM=/d' /etc/djonik/djonik.env && systemctl restart djonik-telegram
```

Інший варіант: Daniel дозволяє в налаштуваннях Claude Code read-only SSH і ці команди, і етап продовжується тут.

## 5. Перша природна подія

**Friday Review, 2026-09-25, 16:30 Europe/Kyiv.** Відбудеться, лише якщо активацію виконано до цього часу. Очікування: свіжий Trello, work history, Memory лише на читання, `autonomous_read_only`, одне коротке повідомлення зі звичайними rhythm-кнопками, запис доставки у state, без мутацій.

## 6. Спостереження для пілоту (#35, не виправляти зараз)

У звичайній розмові в Telegram перед активацією Djonik назвав 2026-09-25 «суботою». Насправді це п'ятниця. Схожу помилку з днем тижня вже бачили в docs/39. Scheduler рахує календар детерміновано в Europe/Kyiv. Friday Review покаже, чи відтворюється помилка в тексті ритуалу.

## 7. Наступний крок

1. Daniel виконує §4 (або дає дозвіл, і це робить Claude Code).
2. Спостерігає реальний Friday Review у Telegram о 16:30.
3. Якщо доставка й кнопки прийнятні — пілот #35. #39 поки не закривати.

Не робилось: зміни source/Agent/Skills/RELEASE_R27, `/rhythm.md`, розклад, примусовий ритуал, платний inference, Telegram, Trello, Memory, Calendar, commit, push.
