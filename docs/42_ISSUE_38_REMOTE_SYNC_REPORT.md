# #38 — синхронізація погодженого source з Managed Agents

Дата: 2026-09-23. Canonical NOW: #38 ([docs/02](02_DEVELOPMENT_ROADMAP.md)). Product Owner дозволив тільки такі remote writes: нові версії трьох coordinator Skills, оновлення prompt primary Agent і одну ізольовану Session без inference. Paid inference не запускався. Trello, Memory і Calendar не змінювались. Project Health specialist, його Skill і Telegram serving path теж лишились без змін.

## 1. Preflight (до змін)

| Поле | Значення |
|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh`, **v24**, `archived_at: null`, `updated_at 2026-09-23T10:18:23Z` |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| System | 2572 B, SHA-256 `fa361ed981bc54aa33a3da5603eacb65e487eda6b2ad16c1da75f8c25a76817f` (= source на `8d51b2a~1`) |
| Skills | 4 custom, усі з `version: "latest"` |
| Tools | `agent_toolset_20260401` default-enabled; Trello `mcp_toolset` default-enabled, з `WriteCard` true, а `WriteBoard/Checklist/Inbox/List/Planner` false; Calendar toolset `enabled:false`; усюди `always_allow` |
| MCP | `trello` → `https://mcp.trello.com/v1`, `google-calendar-calendarmcp` → `https://calendarmcp.googleapis.com/mcp/v1` |
| Multiagent | coordinator → `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 |
| Metadata | `{}`; Memory не є полем Agent |

## 2. Skill ID → назва

Відповідність встановлена через `skills.retrieve` (`display_name`) і шлях `name/SKILL.md` у скачаному архіві, а не за порядком.

| Skill | ID | Remote до (latest) | Байти / SHA-256 до | Repo HEAD SHA-256 | Було однаково? |
|---|---|---|---|---|---|
| task-management | `skill_01WS6JtY1GMu3rGZaKCVR9w1` | `skver_012fLb9ZFpL4mjqybAZ7KtmU` (2026-09-18) | 13092 / `46014c4a…df57` | `e994d31a…c99c` | ні |
| daily-planning | `skill_01G9DtQEzPYxgw78riFh8k99` | `skver_01TDfMCnuv5LkQN4WvtwBzXW` | 5159 / `48438fd3…6bb1` | `7fc9ff92…65f0` | ні (= `8d51b2a~1`) |
| weekly-planning | `skill_01PTmbvLHJj1HuUxvDKhpaiE` | `skver_018soRHmcAn6onE8DpHScFbf` | 7870 / `93aa231f…5509` | `0d6cca38…2737` | ні (= `8d51b2a~1`) |
| studio-intake | `skill_015c8dtDnWyDfVLwS6NLS7r6` | `skver_018sJv1GCnzfZRG4NbExbAzj` | 11332 / `e475f8b5…92e5` | `e475f8b5…92e5` | **так** |

**Remote task-management був старший за #37.** Він не дорівнював `8d51b2a~1` і не містив погоджених правил #37 про project label: Board conventions, project label на новій і наявній задачі, `attach/detach_label` у write і verify. Це відповідає docs/34 §13: #37 перевіряли на окремому Skill, а production не промотували. Синхронізація з точним repo source тому вперше приносить у production-Skill і #37-правила, не тільки #38-вирівнювання.

## 3. Чи зачіпає зміна інші ресурси

- **Інші Agents: не зачіпає.** Усі неархівовані candidate Agents посилаються на ці Skill IDs через явні `skver_…`, а не `latest`. `latest` є тільки в primary Agent і в архівованому `agent_01GFCLFYq6uLRHG8vMCrAgeK`. Specialist v4 використовує інший Skill (`skill_01Treson5zdU1TgxXDaREwnY` @ `skver_01JLTtMvUgfEqdcBBGj4WGVm`).
- **Sessions:** Sessions production Agent (v15–v24) зберігають Skills як буквальне `"latest"`. Sessions pinned candidates натомість показують resolved numeric versions. Офіційна документація ([Managed Agents → Skills](https://platform.claude.com/docs/en/managed-agents/skills)) не каже, чи вже створена `latest`-Session перечитує Skill пізніше. Live це не перевірялось. Telegram adapter-процес не був запущений. `telegramCli` щоразу створює нову Session з unpinned `agent` (тобто з останньою версією Agent), тож наступний запуск адаптера отримає v25 так само, як раніше отримував v22–v24. Перемикання serving зафіксованою Session лишається в #33.

Висновок: блокувального ризику немає. Відкриті питання про поведінку старих `latest`-Sessions і про #37 записані нижче як обмеження.

## 4. Синхронізація Skills

Для кожного Skill спершу перевірили, що `display_name` і `latest_version_id` дорівнюють очікуваним значенням. Потім виконали `skills.versions.create` з одним файлом `<name>/SKILL.md`. Байти взято з закомміченого blob (`git show HEAD:…`, LF): робоча копія task-management має змішані CRLF, а git index — LF. Після цього версію скачали назад і порівняли побайтно.

| Skill | До → після | Read-back | Дорівнює repo |
|---|---|---|---|
| task-management | `skver_012fLb9Z…` → **`skver_01CJQkVY1kp1urhBWQgHUYxW`** | 14713 B, `e994d31a2136bfab5f0d1fda4500f70de5f0b65ee1194ca39f99feb4d34bc99c`, один файл | ✅ `Buffer.compare == 0` |
| daily-planning | `skver_01TDfMCn…` → **`skver_01EL7d3fy4WWYBSsD3PmK9LQ`** | 5558 B, `7fc9ff926b913d1cd50f6ff832aeaeb9b3f778ff44e0fc6d9cf7143c650965f0` | ✅ |
| weekly-planning | `skver_018soRHm…` → **`skver_01FdtnnkbePBjNJGTuJyAvhw`** | 8307 B, `0d6cca383f62300ff582e5bc42c0098e7c7d2d55932e3ac107ed0cdf25df2737` | ✅ |
| studio-intake | без змін, `skver_018sJv1GCnzfZRG4NbExbAzj` | — | ✅ (вже дорівнював) |

Після створення кожної версії `latest_version_id` вказує на нову версію. Project Health, work-review і всі інші Skills не змінювались.

## 5. Primary Agent

Як працює прив'язка Skills (перевірено через API): Agent зберігає `version: "latest"` буквально, а Session теж записує `"latest"`. Окреме оновлення Agent для прив'язки нових версій не потрібне. Pin на конкретні `skver` розійшовся б із `managed-agents/djonik.md`, де стоїть `latest`. Тому найменша коректна зміна — лише `system`.

`agents.update(version: 24, system: <body>)`. Body — це тіло `managed-agents/djonik.md` на HEAD без завершального newline; така сама конвенція, як у `djonikAgentSource.test.ts`, і вона відтворює SHA v24 `fa361ed9…` для `8d51b2a~1`.

| | До | Після |
|---|---|---|
| Version | 24 | **25** (`updated_at 2026-09-23T11:53:10Z`) |
| Model | sonnet-5 / medium / standard | sonnet-5 / medium / standard |
| System | 2572 B `fa361ed9…817f` | **3529 B `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6`**, byte-equal repo ✅ |
| Інші поля | — | `NON_SYSTEM_FIELDS_EQUAL_V24 true`: name, description, skills, tools/permissions, MCP, multiagent (specialist v4), metadata і archived однакові |

Версія v24 лишилась доступною: її prompt і далі `fa361ed9…`. Specialist `agent_01KNiQDzzPjaMU6LLF4mU6uM` також не змінився: v4, `updated_at 2026-09-21T08:00:37Z`, system `b4a50439…78a7`.

## 6. Source ↔ remote attestation

| Ресурс | Repo source | Remote до | Remote після | Збіг |
|---|---|---|---|---|
| Coordinator prompt | 3529 B `3e204453…b4b6` | v24 `fa361ed9…817f` | v25 `3e204453…b4b6` | ✅ побайтно |
| task-management | `e994d31a…c99c` | `skver_012fLb9Z…` `46014c4a…` | `skver_01CJQkVY…` `e994d31a…` | ✅ побайтно |
| daily-planning | `7fc9ff92…65f0` | `skver_01TDfMCn…` `48438fd3…` | `skver_01EL7d3f…` `7fc9ff92…` | ✅ побайтно |
| weekly-planning | `0d6cca38…2737` | `skver_018soRHm…` `93aa231f…` | `skver_01FdtnnkbePB…` `0d6cca38…` | ✅ побайтно |
| studio-intake | `e475f8b5…92e5` | `skver_018sJv1G…` `e475f8b5…` | без змін | ✅ побайтно |
| PH specialist pin | `version: 4` | v4 | v4 | ✅ |

## 7. Ізольована Session

`sesn_015pyFLex524B9ASrk8fxHHP`, створена `2026-09-23T11:53:48Z`. Title: «#38 contract-derived smoke — prepared, no events». Metadata: `agent_version: "25"`, `purpose: issue-38-contract-derived-smoke-preparation`.

- `agent: {id: agent_01WGRHDBjQa3eMhoGJMmQ1dh, version: 25}`. Resolved: Sonnet 5 / medium / standard, prompt `3e204453…b4b6`, tools дорівнюють v25, MCP без змін.
- Skills записані як `latest`. На момент створення Session вони resolve так: tm → `skver_01CJQkVY1kp1urhBWQgHUYxW`, dp → `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, wp → `skver_01FdtnnkbePBjNJGTuJyAvhw`, si → `skver_018sJv1GCnzfZRG4NbExbAzj`.
- Roster: specialist v4, system `b4a50439…` (такий самий, як у попередній medium Session).
- Environment `env_01LVWPmvP5F3fLy28EaycVU2` і vault `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4` ті самі, що в `sesn_01VhijwEco5WXFFGc2LK85Yb`.
- Memory `memstore_01WViYK3WQvGEgojB2GiaDFq`, `access: read_only`. Instructions SHA `ae02f429…f662` збігається з `src/djonikClient.ts` і з попередньою medium Session.
- `budget.max_list_cost = {amount: "1", currency: "USD"}` = $0.01.
- `status: idle`, events 0, `input_tokens 0`, `output_tokens 0`, `cache_read 0`, `list_cost 0`, `active_seconds 0`.

Старі low/medium Sessions не використовувались і не змінювались.

## 8. Файли

- `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`: абзац «#38 remote synchronization».
- `docs/02_DEVELOPMENT_ROADMAP.md`: рядок NOW #38 і датований абзац.
- `docs/42_ISSUE_38_REMOTE_SYNC_REPORT.md`: цей звіт.

Історичні FAIL-записи і docs/39 не змінено. Тимчасові скрипти видалено.

## 9. Перевірки

- Focused (`djonikAgentSource`, `skills`, `managedAgentConfig`): **146/146 pass**.
- `npm test`: **556/556 pass**.
- `npm run typecheck`: без помилок.
- `git diff --check`: OK. Було лише попередження LF→CRLF від autocrlf для docs/02.

## 10. Обмеження

- #37 label-правила тепер у production task-management. Погоджене #37 не промотувалось раніше, бо це мало робитись у #33; тепер воно діє для нових Sessions v25.
- Невідомо, чи старі production Sessions з `latest` (v15–v24, включно з будь-якою колишньою Telegram-Session) побачать нові Skill-версії, якщо їх продовжити.
- `managed-agents/README.md` досі описує v24 / `fa361ed9…` як поточний стан. Він не входив у дозволений перелік docs; синхронізувати його окремо за рішенням PL.
- GitHub-коментар у #38 не публікувався: GitHub не входив у дозволені writes. Проєкт наведено нижче.

## 11. Проєкт коментаря для #38

> **#38 — remote sync of accepted instruction alignment (2026-09-23).** Погоджене вирівнювання інструкцій ([docs/40](../docs/40_DJONIK_INSTRUCTION_ARCHITECTURE_AUDIT.md)) синхронізовано з Managed Agents. Три coordinator Skills отримали нові версії, побайтно рівні repo: task-management `skver_01CJQkVY1kp1urhBWQgHUYxW` (разом із раніше не промотованими правилами #37), daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`. studio-intake не змінювався. Primary Agent v24 → **v25** змінив тільки prompt: SHA `3e204453…b4b6` дорівнює `managed-agents/djonik.md`. Модель без змін: Sonnet 5 medium/standard. PH specialist v4 без змін. Ізольована Session `sesn_015pyFLex524B9ASrk8fxHHP` підготовлена: v25, Memory read_only, 0 events/tokens/cost, backstop 1¢. Paid validation не запускалась. Наступний gate — contract-derived smoke за [docs/41](../docs/41_ISSUE_38_CONTRACT_DERIVED_RUBRIC.md), для нього потрібні окремий дозвіл і бюджет. #38 лишається NOW; #33 не промотовано.

## 12. git status --short

```
 M docs/01_CLAUDE_NATIVE_ARCHITECTURE.md
 M docs/02_DEVELOPMENT_ROADMAP.md
?? docs/42_ISSUE_38_REMOTE_SYNC_REPORT.md
```

**Готовність:** система **ГОТОВА до contract-derived live smoke**, окремо дозволеного Product Owner. Перед smoke треба підняти `max_list_cost` відповідно до затвердженого бюджету (docs/04 §27).
