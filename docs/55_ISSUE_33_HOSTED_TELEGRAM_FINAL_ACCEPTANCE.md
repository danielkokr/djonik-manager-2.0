# #33 — Фінальне прийняття: hosted Telegram serving r26

Дата: 2026-09-24. Issue: [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33). GitHub `main` = `a6a627d48353cc768a39e7a5a94c5f7c68154aa9`. Цей документ знімає статус «pending» з [docs/54](54_ISSUE_33_ALWAYS_ON_HOST_AND_TELEGRAM_CUTOVER.md); docs/54 лишається історичним звітом підготовки.

**Джерела доказів:**
- **Оператор (Product Owner):** хост, деплой, логи `journalctl`, restart, Windows-перевірка.
- **Провайдер (перевірено інженером read-only):**
  - Sessions, події, usage;
  - `release:check r26 / r26 --serving / r25`;
  - статус старого Trello-токена.

Нових платних повідомлень і жодних записів не було.

## 1. Вердикт

**#33 ACCEPTED** (інженерний вердикт; закриття issue — за Product Owner після рев'ю Product Lead).
- Реліз r26 обслуговується з always-on хоста.
- Hosted Session закріплена на Agent v26 і атестована з боку провайдера.
- Два реальні Telegram-ходи завершились `end_turn`, 0 записів, $0.08.
- Restart пройшов stop-before-start, без переривання й без другого poller-а.

Відкритих блокерів немає. Лишилась одна дрібна ручна дія з безпеки: відкликати старий Trello-токен (§13).

## 2. Прийнятий production tuple

| Поле | Значення |
|---|---|
| App | `a6a627d48353cc768a39e7a5a94c5f7c68154aa9` (`SERVING_RELEASE = RELEASE_R26`) |
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26**; `claude-sonnet-5` / medium / standard; system SHA-256 `3e204453…b4b6` |
| Skills (explicit) | task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`, daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`, studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj`, work-review `skver_015LYzVdivGGMsBpuki4kW4S` |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 (`skver_01JLTtMvUgfEqdcBBGj4WGVm`) |
| Tools | built-in `read, write, edit, glob, grep`; custom `trello_work_history#dcf099612535`; MCP trello (write лише `trelloWriteCard`), calendar disabled |
| Session | env `env_01LVWPmvP5F3fLy28EaycVU2`, vault `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4`, Memory `memstore_01WViYK3WQvGEgojB2GiaDFq` `read_write` |

`release:check r26` → `OK …@26 serving_in_this_revision=true` (exit 0). Agent latest = 26, specialist latest = 4.

## 3. Хост

- **Сервер:** Hetzner Cloud **CX23**, Falkenstein, Ubuntu **24.04.4 LTS**, Node **v24.21.0**.
- **Процес:** один systemd unit `djonik-telegram` від користувача `djonik`.
- **Доступ і дані:** SSH за ключем; без backups і volumes.
- **Підготовка:** `bootstrap-host.sh` відпрацював. До деплою unit був `disabled/inactive`, checkout = `a6a627d`.

## 4. Вартість хоста (checkout)

**$6.49/міс (сервер) + $0.60/міс (IPv4) = $7.09/міс без VAT.**
- Це вище за оцінку docs/54 (≈ €5.49): Hetzner показав ціну в USD і окремо IPv4.
- Inference, як і раніше, оплачується за хід.

## 5. Деплой

- **Секрети:** `set-secrets.sh` записав 7 значень у `/etc/djonik/djonik.env` (root, 0600), серед них новий Trello read token (`never`) і `DJONIK_EXPECTED_RELEASE=r26`.
- **Cutover:** laptop-poller зупинено до деплою, потім `deploy/deploy.sh a6a627d…` → успіх.
- **Serving tuple (оператор):**
  - `release=r26 app=a6a627d… agent=…@26`;
  - `model=claude-sonnet-5/medium/standard`, accepted system SHA;
  - `skill_pins=explicit`, specialist `@4`;
  - `builtin=edit,glob,grep,read,write`, `custom_tools=trello_work_history#…`;
  - `memory=read_write`, `trello_history=ok/expires=never`.

## 6. Serving-Session з боку провайдера

| Session | Створено (UTC) | Metadata | Стан |
|---|---|---|---|
| `sesn_01THkPzigtHy3fE8TAXDrRrk` (pre-restart) | 09:52:54 | `source=telegram, release=r26, app_revision=a6a627d…` | idle, v26, 32 події |
| `sesn_0114LVK44drqNW2N6ocob68S` (post-restart) | 10:02:56 | те саме | idle, v26, 0 подій, $0 |

- `release:check -- r26 --serving` → `serving session=sesn_0114LVK44drqNW2N6ocob68S OK status=idle … app=a6a627d… agent=…@26`. Атестація snapshot тим самим `attestServingSession`, що й при старті.
- **Розбіжність у написанні ID (виправлено за провайдером):**
  - в операторському записі pre-restart ID був `sesn_01THkPzigthy3fE8TAXDrRk` (28 символів); справжній — `sesn_01THkPzigtHy3fE8TAXDrRrk` (`H` і пропущене `r`);
  - post-restart у записі — `…drQNW…`, справжній — `…drqNW…`;
  - обидві збігаються з провайдером однозначно: це єдині Telegram-Sessions r26, і час збігається.
- **Single poller:** за весь час є рівно дві Telegram-Sessions, по одній на процес, і вони послідовні. Після 09:52 немає жодної іншої Session, зокрема untagged від старих ревізій. Оператор підтверджує: 409 немає.

## 7. Telegram smoke (події провайдера)

| Хід | Запит | Події | Кінець | list cost |
|---|---|---|---|---|
| 1 | «Привіт, ти на зв'язку? Відповідай коротко.» | 1 model request, без tools; відповідь «Привіт, на зв'язку. Що потрібно?» (2.0 с) | `end_turn` | 6¢ |
| 2 | «Що по Extract зрушилось цього тижня? Коротко.» | `read` work-review/SKILL.md → `trello_work_history` ×1 → відповідь (≈ 9.7 с) | `end_turn` | 2¢ |

Разом **$0.08** (Session `list_cost` 8 USD minor units; `active_seconds` 10.9). Стеля $0.40.

Видима відповідь ходу 2:
- детермінований блок: Done 4 — «Міні-парфуми адаптація», «Коментарі по пінкам», «Флакони 7.5 ML», «Флакони 1.5 ML»; створено 3; інші переміщення 6;
- PM-висновок координатора.

## 8. Custom tool і мутації

- **Lifecycle #40 для `sevt_01Ltv7ipfaGr92SgT7KvPqLq`:**
  - одна `session.status_idle{requires_action, event_ids:[…]}`;
  - рівно один `user.custom_tool_result` (`is_error:false`, через 2.3 с);
  - далі `running` → `end_turn`;
  - дублікатів немає, незакритих `requires_action`/`budget_reached` немає.
- **Input:** `{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"this_week"}}`.
- **Записів 0:**
  - MCP-викликів 0, отже і `trelloWrite*` = 0;
  - Calendar 0;
  - built-in `write`/`edit` 0 (єдиний `agent.tool_use` — `read`), отже Memory-записів 0;
  - thread-подій specialist немає.

## 9. Restart і supervision

Оператор виконав `systemctl restart djonik-telegram`:
- `[shutdown] begin reason=SIGTERM drain_ms=120000` → `[shutdown] end drained=true interrupted_chats=0 exit=0`;
- **потім** `[release] preflight` → `[release] serving release=r26 app=a6a627d…`;
- `is-active` = `active`; `telegram_conflict_another_poller` немає.

Провайдер це підтверджує:
- pre-restart Session востаннє оновлена о 09:56:10 (`end_turn`), тобто активного ходу під час restart не було;
- нова Session створена о 10:02:56, це process-scoped continuity за контрактом docs/51 §11.

## 10. Rollback

- `release:check r25` → OK (v25 незмінна).
- Rollback-ревізія `15ca0c7…`: `set-secrets.sh DJONIK_EXPECTED_RELEASE` → `r25`, потім `deploy.sh 15ca0c7…` (docs/52 §6).
- Guard у `deploy.sh` не дасть зупинити процес при невідповідності (перевірено в docs/54 §10, §16).
- На production rollback не виконувався, бо в цьому не було потреби.

## 11. Windows `release:check`

- **Оператор:** Product Owner виконав перевірку на Windows після fast-forward; результат прийнято Product Lead.
- **Інженер:** незалежно на Windows **не** відтворював, бо цей cloud-сеанс працює на Linux.
- **Linux, та сама ревізія:** `r26 OK`, exit 0, природний вихід за 1.5–3.3 с; `r25` OK; `--serving` OK.

## 12. Soft observations (не блокують #33)

1. **Work-review:** координатор повторює детермінований фактичний блок у PM-висновку. Той самий текст підтверджено в події `agent.message`. Відомо з docs/32 і docs/53; окремий follow-up.
2. **F3** не показує tool-free другу частину змішаного запиту (docs/53 §12.2).
3. Дрібна мовна шліфовка (docs/53 §12.3).
4. Ціна хоста вища за оцінку: $7.09 проти ≈ €5.5.

## 13. Операційно опційне / ручне

- **Відкликати старий 30-денний Trello read token.** Read-only перевірка сьогодні: він **досі дійсний** (HTTP 200, `dateExpires 2026-10-22T07:44Z`). Trello → Account → Applications. Не блокує: новий токен працює, старий і так спливе 2026-10-22.
- Вирішити, чи лишати `DJONIK_TURN_TELEMETRY=1`.
- Прибрати idle validation-Sessions з docs/53 (архівація — рішення PO).
- Зберігати локальний `.env` лише для аварійного laptop-fallback. Ніколи не запускати його паралельно з хостом (docs/52 §6).

## 14. Матриця acceptance #33

| Критерій (issue #33) | Стан | Доказ |
|---|---|---|
| 1. Pinned tuple: коміт, Agent/model/system, Skill-версії, specialist, custom tool, permissions, Memory mode | VERIFIED COMPLETE | §2; `release:check r26` |
| 2. Serving evidence з реальної Telegram-Session, не diagnostic | VERIFIED COMPLETE | §6: `source=telegram`, атестовано провайдером |
| 3. Source: stale Session/config, completed-turn switch, no replay, регреси #31/#32/#36/#40 | VERIFIED COMPLETE | 645/645 на `a6a627d`; docs/51 |
| 4a. Smoke: ordinary text (hosted) | VERIFIED COMPLETE | §7 хід 1 |
| 4b. Smoke: work-review через #40/#36 (hosted) | ACCEPTED WITH SOFT OBSERVATION | §7–§8; повтор фактів (§12.1) |
| 4c. Smoke: rich intake, PH + окремий вивід | ACCEPTED (перевикористано) | docs/53 S2/S4 на тому ж v26 і тому ж `connectServingSession`; issue дозволяє перевикористання |
| 4d. Авторизований зворотний Trello-запис | не потрібен | serving доведено без мутацій; 0 записів |
| 5a. Restart | VERIFIED COMPLETE | §9 |
| 5b. Single instance | VERIFIED COMPLETE | §6 + відсутність 409 |
| 5c. Trello token відсутній/прострочений → видимо | VERIFIED COMPLETE | docs/54 §9: реальний entrypoint, warning, fail-open |
| 5d. Stop/rollback runbook | VERIFIED COMPLETE | docs/52 §6–§7; §10 |
| 5e. Content-free diagnostics | VERIFIED COMPLETE | tuple і `[shutdown]` без контенту й секретів; тести з marker-секретами |
| Host: always-on, supervision, host-side secrets | VERIFIED COMPLETE (оператор) | §3, §5, §9 |
| Rotation Trello token задокументовано | VERIFIED COMPLETE | docs/52 §5, docs/54 §9; новий `never` активний |
| Cost note | VERIFIED COMPLETE | §4: $7.09/міс без VAT |
| Windows `release:check` fix | ACCEPTED (оператор) | §11; інженер перевірив лише Linux |
| Відкликання старого токена | ручна дія, не блокер | §13 |

**Блокерів немає. #33 — ACCEPTED.** Наступний canonical NOW — [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34) (docs/02). Його реалізація цим документом не починається.
