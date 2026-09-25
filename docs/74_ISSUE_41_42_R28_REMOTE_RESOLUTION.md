# #41 + #42 — remote sync `planning-and-focus`, Agent v28, read-back і справжній `RELEASE_R28`

Дата: 2026-09-25. Попередні звіти: [docs/72](72_ISSUE_41_CLOCK_AND_PROMPT_SOURCE_REPORT.md) (#41), [docs/73](73_ISSUE_42_PM_JUDGEMENT_CORE_SOURCE_REPORT.md) (#42). Процедура та сама, що в [docs/64](64_ISSUE_39_R27_REMOTE_CONFIGURATION.md) (r27).

**Доповнення:** §9 і кроки 1–2 з §12 виконано в [docs/75](75_ISSUE_41_42_R28_SESSION_VERSION_AND_SOURCE_CUTOVER.md). Там описано inspection Session на v28 з нулем подій, `sessionVersion` для `planning-and-focus` і `SERVING_RELEASE = RELEASE_R28` у source.

**Статус:** звіт про remote-розв'язання r28. Це **не** deploy, **не** production cutover і **не** приймання #41/#42. Source-зміни uncommitted і чекають review Product Lead.

**Авторизовано Product Owner:**
- створення й byte-перевірка remote Skill `planning-and-focus`;
- рівно один update coordinator Agent з v27 тілом, згенерованим з `RELEASE_R28_CANDIDATE`;
- read-back / атестація нової версії;
- розв'язання `RELEASE_R28` у source з реальними ідентифікаторами.

**Не робилось:**
- deploy на Hetzner, restart, зміна `DJONIK_EXPECTED_RELEASE`;
- зміна Working Rhythm, перемикання serving Session;
- жодної Session (навіть inspection), жодного prompt/event, платного inference;
- мутації Trello, Memory, Calendar;
- зміни інших Skills, specialist, model, MCP;
- GitHub issues (не закривались і не коментувались), `docs/02` NOW;
- commit, push.

## 1. Стартовий стан

| Перевірка | Результат |
|---|---|
| `git status --short` | порожній |
| `HEAD` / `origin/main` | обидва `0a4799b8d74fa549d36901a9fb6b72dc5010f17d` |
| GitHub #41 / #42 | OPEN, 0 коментарів |
| Source | `SERVING_RELEASE = RELEASE_R27`; `RELEASES = {r25, r26, r27}`; `RELEASE_R28_CANDIDATE` з unresolved `planning-and-focus` |

## 2. Remote preflight v27 (лише читання, до будь-якого запису)

| Перевірка | Результат |
|---|---|
| Latest coordinator | **27**, `updated_at 2026-09-25T07:16:58.186522Z`, не архівований; latest ≡ v27 (deep-equal) |
| `compareWithRelease(RELEASE_R27, normalize(v27))` | `[]` — дрейфу нема |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| System | SHA-256 `3e204453…b4b6`, 3529 B = r27 |
| Skills | 6 explicit pins = r27 (task-management, daily-planning, weekly-planning, studio-intake, work-review, pm-rhythm) |
| Built-in | `read, write, edit, glob, grep`; `always_ask` = `edit, write` |
| Trello MCP | default enabled / `always_ask`; 9 reads явно `always_allow`; `trelloWriteCard` `always_ask`; 5 writes вимкнені |
| Calendar MCP | default disabled |
| Custom tool | `trello_work_history#dcf099612535` / опис `b76220945702` = source |
| Roster | `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`; specialist latest = 4, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm` |
| `name` / `metadata` | `Джонік` / `{}` |
| Remote `planning-and-focus` | **не існує** (14 custom Skills; «planning» лише daily/weekly) |
| `release:check -- r27` / `r27 --serving` | OK / OK: `sesn_01XZxfa1skBSuLBdMhMNBnin`, idle, app `f0a9cb9d…`, @27 |

Висновок: **PASS**.

## 3. Stage A — sync `planning-and-focus`

Механізм той самий, що в docs/42 і docs/64:
- `client.beta.skills.create({ files: [toFile(bytes, "planning-and-focus/SKILL.md")] })`, `display_name` виведено з frontmatter;
- байти — `git show HEAD:.claude/skills/planning-and-focus/SKILL.md` (LF, 0 CR), 7577 B, SHA-256 **`0efaf7d29ae9f1cb6bf54518b796dd806b031bc789ef44af720a6b278043b628`** (= docs/73);
- перед create скрипт перевірив SHA і що Skill з такою назвою ще нема; `maxRetries: 0`.

| Поле | Значення |
|---|---|
| Skill id | **`skill_01PxXTvhbZSrbxqi7gmDs6KW`** |
| Version id | **`skver_01RzxVaCr47k6R11pHLWr62e`** — єдина версія, = `latest_version_id` |
| `display_name` / version `name` | `planning-and-focus` / `planning-and-focus` |
| `created_at` | `2026-09-25T13:00:01.954376Z` |
| `sessionVersion` | **не виміряно** (див. §9) |

**Byte-gate.** `versions.download` → zip 3545 B з **одним** файлом `planning-and-focus/SKILL.md`, 7577 B, SHA-256 `0efaf7d2…b628`. `cmp` з `git show HEAD:…` — **побайтово ідентичний**. Custom Skills тепер 15 (+1), інші не змінені.

## 4. Stage B — згенероване тіло і семантична дельта

`buildCandidateUpdateBody(RELEASE_R28_CANDIDATE, {skills: {"planning-and-focus": {skillId, version}}}, system)`, де `system` — тіло закоміченого `managed-agents/djonik.md` (5499 B, SHA `c85e7e62…e7da` = `candidate.systemSha256`).

- Ключі: `version: 27` (precondition), `skills`, `system`, `tools`. `model`, `mcp_servers`, `multiagent`, `name`, `description`, `metadata` відсутні → збережені.
- SHA-256 `JSON.stringify(body)` = **`4c59a49cdd619cc63efe21b7dc0d21dc4e71bf266e4b76ca1a9ccc8854d774e6`**.
- `confirmationPolicyProblems` = `[]`.
- Тіло програмно застосовано до сирого live v27: змінюються лише `systemSha256` і `skills`; `tools` канонічно ідентичні v27. `compareWithRelease(r28, applied)` = `[]`.
- `release:check -- r28 --plan --from 27` **відмовляє** (partial-update guard: Skills/tools без prompt) — очікувано, guard не обходився.

| Поле | v27 | v28 (тіло) |
|---|---|---|
| system | `3e204453…` | **`c85e7e62…`** (#41 + #42) |
| skills | task-management, **daily-planning**, **weekly-planning**, studio-intake, work-review, pm-rhythm | task-management, **planning-and-focus** `skill_01PxXTvhbZSrbxqi7gmDs6KW@skver_01RzxVaCr47k6R11pHLWr62e`, studio-intake, work-review, pm-rhythm |
| tools / permission policies | r27 | без змін |
| model / MCP / roster | r27 | без змін (не надсилались) |

## 5. Stage C — один update

- Безпосередньо перед update: повторний GET, latest = 27 і deep-equal preflight-snapshot; SHA тіла перевірено.
- `2026-09-25T13:01:20Z`: `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)`, `maxRetries: 0`.
- Відповідь: **`version: 28`**, `updated_at 2026-09-25T13:01:25.445834Z`. Один виклик, без повторів.

## 6. Stage D — read-back v28

| Перевірка | Результат |
|---|---|
| latest | 28, latest ≡ v28, не архівований |
| v27 після update | deep-equal preflight — незмінний, лишається rollback-ціллю |
| Сирі поля v27 → v28 | змінились **лише** `skills`, `system`, `updated_at`, `version` |
| system | `=== body.system`, SHA `c85e7e62…` |
| model | `claude-sonnet-5` / `medium` / `standard` |
| skills | рівно 5: task-management, planning-and-focus (`skver_01RzxVaCr47k6R11pHLWr62e`), studio-intake, work-review, pm-rhythm; daily/weekly відсутні |
| tools (сирі) | deep-equal v27: built-in `always_ask` = `edit, write`; Trello default `always_ask`, `trelloWriteCard` `always_ask`, 9 reads `always_allow`, 5 writes вимкнені; Calendar вимкнений; `trello_work_history#dcf099612535` |
| mcp_servers / roster | deep-equal v27; specialist `@4` |
| `attestAgentVersion(RELEASE_R28, v28)` | **PASS**, `[]` |
| `compareWithRelease(RELEASE_R27, v27)` | `[]` |

Межа #39 (pre-execution) збережена: `readOnlyBoundaryFor(RELEASE_R28) = pre_execution`.

## 7. Stage E — `RELEASE_R28` у source

`src/release.ts`:
- `PLANNING_AND_FOCUS_SKILL = {skillId: skill_01PxXTvhbZSrbxqi7gmDs6KW, version: skver_01RzxVaCr47k6R11pHLWr62e}` — без `sessionVersion`;
- **`RELEASE_R28`** записано явно: `r28`, `agent_01WGRHDBjQa3eMhoGJMmQ1dh@28`, system `c85e7e62…`, 5 explicit pins, решта — r27. Тест доводить `RELEASE_R28 ≡ resolveReleaseCandidate(RELEASE_R28_CANDIDATE, реальні id, 28)`;
- `RELEASES = {r25, r26, r27, r28}`;
- **`SERVING_RELEASE = RELEASE_R27` — без змін** (обґрунтування — §9);
- `RELEASE_R28_CANDIDATE` лишився unresolved вхідним наміром; `RELEASE_R27` не змінено (daily/weekly — лише в r27 як rollback-піни).

`managed-agents/djonik.md`: у frontmatter daily/weekly замінено на `planning-and-focus` (та сама позиція); тіло побайтово те саме (SHA тіла до/після однаковий). Тепер файл цілком (тіло + frontmatter) = r28.

## 8. Stage F — provider-side атестація

| Команда | Результат |
|---|---|
| `release:check -- r28` | **`r28 OK agent=…@28 serving_in_this_revision=false`**, exit 0 |
| `release:check -- r28 --serving` | `no Telegram serving Session found`, exit 78 — очікувано, r28 ніде не serve-иться |
| `release:check -- r27` / `r27 --serving` | OK / OK: `sesn_01XZxfa1skBSuLBdMhMNBnin`, idle, app `f0a9cb9d…`, **@27** — production не зачеплено |
| `release:check -- r26` / `r25` | OK / OK |

Отже: **«r28 Agent/release атестується» — так; «r28 serve-ить production» — ні.** Production-шлях завжди пінить `agent.version = SERVING_RELEASE.agent.version = 27`, тож latest = 28 його не зачіпає.

## 9. Чому `SERVING_RELEASE` лишається r27

1. **`sessionVersion` для `planning-and-focus` невідомий.** Session snapshot подає pinned Skills як числове мікросекундне написання, яке публічний API не віддає (docs/53 §4). Виміряти його можна лише з Session на v28 — у цьому етапі не авторизовано. Без нього `attestServingSession` на старті відмовить закрито (тест `releaseR28.test.ts` це фіксує). Вгадувати значення заборонено.
2. **Прецедент:** для r27 remote-розв'язання (docs/64) і source cutover (docs/66) були окремими етапами.

Перемкнути `SERVING_RELEASE` зараз означало б, що наступний deploy впаде на атестації.

## 10. Тести (Node v24, Windows)

| Набір | Результат |
|---|---|
| **Новий** `releaseR28` (визначення, провенанс, дифф до r27, SHA Skill, тіло `4c59a49c…`, атестація, fail-closed без `sessionVersion`, tuple) | 8/8 |
| `releaseR28Candidate` (оновлено: `RELEASES` += r28) / `releaseR27Candidate` / `releaseR27` | pass |
| `release` (lockstep: djonik.md = r28; served r27 відрізняється рівно переходом r28) | pass |
| `releaseAttestation`, `servingRelease` | pass |
| Release-набори разом | **106/106** |
| `djonikAgentSource` (#41 clock, #42 PM core, frontmatter-піни r28) | pass |
| `planningAndFocus`, `pmRhythmSkill`, `skills`, `turnClock`, `toolConfirmation*`, `rhythm*` | pass (у повному прогоні) |
| Повний `npm test` | **1039/1041** |
| `npm run typecheck` / `npm run build` / `git diff --check` | pass / pass / pass (лише CRLF-попередження git) |

Два збої ті самі, що в docs/62–66, і відтворюються на чистому `0a4799b` (1030/1032, перевірено через `git stash -u`):
- `processExit.test.ts` «a real process that fetched over keep-alive exits…»;
- `deployConfig.test.ts` «deploy script survives replacing itself…».

## 11. Змінені файли

- `src/release.ts` — `PLANNING_AND_FOCUS_SKILL`, `RELEASE_R28`, `RELEASES += r28`, коментарі кандидата і `SERVING_RELEASE` (значення не змінено).
- `managed-agents/djonik.md` — лише frontmatter Skills.
- `managed-agents/README.md` — рядок про r28.
- `src/releaseR28.test.ts` — новий.
- `src/release.test.ts` — lockstep djonik.md ↔ r28; окремий тест served r27 ↔ declaration.
- `src/releaseR28Candidate.test.ts`, `src/releaseR27Candidate.test.ts` — очікуваний набір `RELEASES`.
- `src/djonikAgentSource.test.ts` — очікувані піни frontmatter.
- Цей документ.

## 12. Обмеження і точний наступний крок (production cutover)

Обмеження:
- Latest coordinator тепер **v28**. Інструмент поза репо, що створює Session без version pin (Console), отримає r28-поведінку.
- Поведінка r28 (prompt #41/#42 + `planning-and-focus`) live не перевірялась; live acceptance не заявляється.

Наступний крок, кожен пункт — окрема авторизація Product Owner:
1. **Одна inspection Session на v28** без подій (Memory `read_only`, budget-backstop, `metadata.release = r28-inspection`): зчитати `sessionVersion` для `planning-and-focus`, `compareWithRelease(RELEASE_R28, session.agent) = []`.
2. **Source cutover:** `sessionVersion` → `PLANNING_AND_FOCUS_SKILL`; `SERVING_RELEASE = RELEASE_R28`; прибрати тест «served r27 differs…» (lockstep повертається до однієї рівності); review + commit/push.
3. **Deploy (docs/52):** нова app-ревізія (разом з #42 Memory instructions у source), `DJONIK_EXPECTED_RELEASE=r28`, restart; `release:check -- r28 --serving` на hosted Session. Rollback — попередня r27-ревізія / v27 (незмінна).
4. За потреби — bounded live-перевірка поведінки #41/#42 за окремим бюджетом.

## Стан робочого дерева

```text
 M managed-agents/README.md
 M managed-agents/djonik.md
 M src/djonikAgentSource.test.ts
 M src/release.test.ts
 M src/release.ts
 M src/releaseR27Candidate.test.ts
 M src/releaseR28Candidate.test.ts
?? docs/74_ISSUE_41_42_R28_REMOTE_RESOLUTION.md
?? src/releaseR28.test.ts
```
