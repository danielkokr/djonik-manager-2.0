# #33 — Контрольований cutover на r26: Agent v26, serving-boundary smoke, готовність хоста

Дата: 2026-09-24. Canonical NOW: [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33) ([docs/02](02_DEVELOPMENT_ROADMAP.md)). База: `origin/main` = `15ca0c7` (feat: harden production release serving). Дизайн релізу: [docs/51](51_ISSUE_33_PRODUCTION_RELEASE_HARDENING.md). Runbook: [docs/52](52_PRODUCTION_SERVING_RUNBOOK.md).

**Авторизовано Product Owner для цього етапу:**
- рівно один `agents.update` production-агента (v25 → v26) з precondition `version: 25`;
- одна свіжа serving-validation Session;
- платний smoke до **$1.20** list cost сумарно;
- один коміт і push тільки cloud-гілки.

**Не робилось:**
- другий Agent;
- зміни specialist, Skills, prompt, model/effort/speed;
- Memory-, Trello- чи Calendar-записи;
- Telegram-деплой, VPS, ротація токенів;
- архівація v25 чи інших ресурсів.

## 1. Вердикт

**R26 ACCEPTED** (інженерний вердикт; остаточне прийняття — за Product Owner). Остаточне прийняття варто робити з урахуванням двох UX-спостережень у §12. Жодне з них не є дефектом релізу чи serving boundary: обидва — вже відома поведінка, прийнята раніше.

- Agent v26 існує, є незмінним і **точно** відповідає r26:
  - `release:check r26` → OK;
  - порівняння v25 → v26 по всіх полях: змінились лише `skills`, `tools`, `version` і `updated_at`.
- Кожна pinned Skill-версія (5 coordinator + specialist) **побайтово ідентична** `.claude/skills/*/SKILL.md` у репо.
- Код переключено на r26 (`SERVING_RELEASE = RELEASE_R26`).
- Одна свіжа Session закріплена на v26 і атестована з provider snapshot, тим самим `connectServingSession`, що й Telegram.
- Усі 4 smoke-ходи завершились авторитетним `end_turn`.
- Записів: **0**. Вартість: **$0.33** з $1.20.
- #36 уперше пройшов live на Sonnet 5 medium у production-релізі.
- **Змінене припущення:** Session snapshot подає pinned coordinator Skills не як `skver_…`. Перша атестація через це **fail-closed відмовила** (Session створено, повідомлень не надсилалось, $0). Атестацію точково виправлено (§4), після чого вона пройшла.
- Готовність хоста: **READY FOR HOST DEPLOYMENT** (§13). Попутно виправлено два реальні edge case у `deploy/deploy.sh`.

## 2. Стан до cutover (read-only)

| Перевірка | Результат |
|---|---|
| Git | HEAD = `origin/main` = `15ca0c711d9bef9873dd688121dfcce483641204`, дерево чисте |
| `npm test` / `typecheck` / `build` / `git diff --check` | 631/631 / clean / OK / clean |
| `release:check r25` | `OK agent=…@25` |
| `release:check r26` | `version 26 does not exist` (exit 78) — очікувано |
| Latest версія Agent | **25** (`updated_at 2026-09-23T11:53:10Z`); історія версій 1…25, v26 немає |
| Pinned Skill-версії r26 | усі 5 існують; для кожної `latest_version_id` = pinned |
| Specialist | v4, не архівований, Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm` |
| Sessions | остання активність 2026-09-23 14:41 UTC (smoke-Session); Session активного Telegram-адаптера немає |
| Trello read token | `resolveSingleBoard` OK |

Live v25 (сирий read-back):
- model `claude-sonnet-5`, effort `medium`, speed `standard`;
- system SHA-256 `3e204453…b4b6` (3529 B);
- 4 Skills з `version: "latest"`;
- roster `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`;
- `agent_toolset_20260401`: default-enabled, `always_allow`, `configs: []`;
- trello toolset: write-overrides як у r25;
- calendar toolset: default-disabled;
- `metadata: {}`.

## 3. План r26 і перевірка кожного поля

Тіло update згенеровано з source (`buildAgentUpdateBody(RELEASE_R26, 25)` ≡ `npm run release:check -- r26 --plan --from 25`), не зібрано вручну.

Ключі тіла: `skills`, `tools`, `version: 25`. Потім план застосовано до **сирого live v25**, а не до фікстури, і порівняно кожне поле.

| Поле | v25 → план |
|---|---|
| model / effort / speed | без змін (не надсилається) |
| system | без змін (не надсилається) |
| mcp_servers | без змін (не надсилається) |
| multiagent (roster v4) | без змін (не надсилається) |
| name / description / metadata | без змін |
| skills | 4× `latest` → 4× ті самі accepted `skver_` + `work-review` `skver_015LYzVdivGGMsBpuki4kW4S` |
| tools: built-in | default-enabled → allowlist `read, write, edit, glob, grep` (`always_allow`) |
| tools: custom | + `trello_work_history` (description і schema = `TRELLO_WORK_HISTORY_TOOL`) |
| tools: trello MCP | **ідентично** (write лише `trelloWriteCard`) |
| tools: calendar MCP | **ідентично** (default-disabled) |

Жодних неочікуваних семантичних змін.

## 4. Перевірка припущень

| # | Питання | Відповідь і доказ |
|---|---|---|
| 1 | Чи explicit Skill pins незмінні? | **Так, щодо вмісту.** Skill Version API має `create/retrieve/list/delete/download` і не має update, тож вміст `skver_` змінити не можна. Версію можна **видалити**; тоді pinned Agent не зможе завантажити Skill, і це видимий збій, а не тиха підміна. Download усіх 6 pinned версій = репо побайтово: `e994d31a`, `7fc9ff92`, `0d6cca38`, `e475f8b5`, `c079d285`, specialist `c64318f4`. |
| 2 | Update створює нову версію, а не змінює v25? | **Так.** Офіційні docs: «each update creates a new immutable version… append-only». Після update: latest = 26, а `release:check r25` досі OK, тобто v25 незмінна. |
| 3 | Чи працює Session pin `{type, id, version}`? | **Так.** Snapshot Session: `agent.version = 26`. |
| 4 | Чи правильно включати #36? | **Так** (docs/51 §7). Live-доказ: S3. |
| 5 | Чи безпечно прибрати `bash`/`web_*`? | **Так.** Офіційні docs: Memory mount читається й пишеться «standard file tools» (`read/write/edit/glob/grep` достатньо); Skills потребують `read`. У prompt і Skills немає згадок shell/web. Memory-гігієна (#37) — це оновлення файлу через `edit`, видалення не потрібне. Live: Skills читались через `read` без помилок (S2, S3, specialist). Specialist має власний toolset і змінами не зачеплений. |
| 6 | `trello_work_history` лише читає? | **Так.** Єдиний `fetch` — `method: "GET"`, credentials лише в заголовку `Authorization`. Live: 0 записів. |
| 7 | Чи схема tool у v26 = source? | **Так.** Canonical schema SHA `dcf09961…` і description SHA збігаються (`release:check r26` OK). |
| 8 | Чи specialist v4 pinned явно? | **Так.** Roster `{id, version: 4}` не змінювався. |
| 9 | *(нове)* Як Session snapshot подає explicit Skill pin? | **Не як `skver_`.** Див. нижче. |

**Змінене припущення (п. 9).** docs/51 і тестові фікстури вважали, що Session snapshot покаже explicit pin як `skver_…`. Live перевіряли лише r25-Session, а там snapshot показує `"latest"`.

Фактична поведінка провайдера:
- Agent v26 зберігає `skver_…`;
- Session, створена з v26, показує кожну pinned **coordinator** Skill як внутрішню числову версію — мікросекундний timestamp, якого публічний Skill Version API не повертає;
- roster-member (specialist) у тому самому snapshot лишається з `skver_…`.

| Skill | Pin (`skver_`) | Snapshot Session | Δ до `created_at` pin | Найближча інша версія тієї ж Skill |
|---|---|---|---|---|
| task-management | `skver_01CJQkVY1kp1urhBWQgHUYxW` | `1790164354565465` | 0.53 с | ≈436 000 с |
| daily-planning | `skver_01EL7d3fy4WWYBSsD3PmK9LQ` | `1790164356765333` | 0.41 с | ≈622 000 с |
| weekly-planning | `skver_01FdtnnkbePBjNJGTuJyAvhw` | `1790164359202020` | 0.39 с | ≈621 000 с |
| studio-intake | `skver_018sJv1GCnzfZRG4NbExbAzj` | `1789734659839542` | 2.76 с | ≈3 600 с |
| work-review | `skver_015LYzVdivGGMsBpuki4kW4S` | `1790083840153637` | 0.41 с | 50 с |

Відповідність однозначна. Перша атестація (`sesn_015bsecRNvZqnUicSR6LZqXd`) через це правильно **відмовила fail-closed**:
- 5 mismatch;
- жодного повідомлення, stream не відкривався;
- list cost $0, `active_seconds 1.27`;
- Session лишено idle, без змін.

**Виправлення (обмежене).**
- `ReleaseSkill` explicit pin отримав поле `sessionVersion`: це виміряне snapshot-написання *тієї самої* версії.
- Атестація приймає рівно два написання, `skver_` або `sessionVersion`; будь-яке інше значення, зокрема число іншої Skill чи старшої версії, — mismatch.
- Фікстура Session тепер відтворює реальну форму провайдера.
- Додано тест.
- Перевірено офлайн на сирому snapshot відхиленої Session: атестація OK, ресурси OK.

Чому не послаблювали до «будь-що, крім `latest`»:
- точний збіг ловить помилку resolution провайдера;
- якщо провайдер змінить формат, сервіс відмовить видимо (exit 78) і не буде обслуговувати неперевірене.

## 5. Точний remote update

- `2026-09-24T08:17:16.869Z`: `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)`.
- Перед ним — повторний GET: latest = 25.
- Тіло = згенерований план (§3).
- Відповідь: `version: 26`, `updated_at 2026-09-24T08:17:17.170292Z`.
- Один виклик, без повторів.

## 6. Read-back v26

- `release:check r26` → `[release-check] r26 OK agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26` (exit 0).
- `release:check r25` → OK: v25 незмінна, rollback-ціль жива.
- Порівняння всіх полів сирого v25 і v26: різняться лише `skills`, `tools`, `updated_at`, `version`.
- Нормалізований v26:
  - model `claude-sonnet-5/medium/standard`;
  - system `3e204453…`;
  - 5 explicit `skver_`;
  - roster `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`;
  - built-in `edit, glob, grep, read, write`, без confirmation;
  - custom `trello_work_history#dcf099612535`;
  - MCP trello (enabled write лише `trelloWriteCard`) і calendar (disabled);
  - URL серверів без змін.

## 7. Точний release tuple r26

| Поле | Значення |
|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v26** |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` |
| System | SHA-256 `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6` |
| Skills | task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`, daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`, studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj`, work-review `skver_015LYzVdivGGMsBpuki4kW4S` |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 (Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm`) |
| Built-in | `read, write, edit, glob, grep` (`always_allow`) |
| Custom | `trello_work_history` (schema `dcf09961…`) |
| MCP | trello (write: лише `trelloWriteCard`), google-calendar (default-disabled) |
| Session | env `env_01LVWPmvP5F3fLy28EaycVU2`, vault `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4`, Memory `memstore_01WViYK3WQvGEgojB2GiaDFq` `read_write` |
| App | коміт цього cutover (`SERVING_RELEASE = RELEASE_R26`) |

## 8. Атестація serving-Session

`sesn_01UMLG3oqYCTNAbzdBXnR9iv` створено тим самим шляхом, що й у Telegram-процесі:
- `loadServingConfig(SERVING_RELEASE)`;
- `preflightRelease`;
- `checkTrelloHistoryHealth`;
- `connectServingSession`;
- надсилання через `sendOrdered([{type:"text"}])`, як у `telegramDispatch`.

Відмінність від Telegram лише в мітці `source=diagnostic` і в Session budget `max_list_cost = 120¢`.

Read-back перед першим повідомленням: `idle`, **0 events**, 0 tokens, list cost 0. Перевірено:

| Що | Результат |
|---|---|
| Pin | `agent.version = 26` |
| Skills | 5 explicit версій (у snapshot — числове написання, §4) |
| Specialist | roster = одна v4 зі Skill `skver_01JLTtMv…` |
| Custom tool | `trello_work_history` присутній, schema і description = source |
| Built-in | рівно `read, write, edit, glob, grep` |
| MCP | trello (write лише `trelloWriteCard`), calendar disabled |
| Memory | одна `memstore_01WViYK3…`, `read_write`, mount `/mnt/memory/djonik-memory` |
| Vault / env | один `vlt_011Cf5Ju…` / `env_01LVWPmv…` |
| Зайві ресурси | немає |
| Metadata | `{source: diagnostic, release: r26, app_revision: 15ca0c7…+dirty}` (`+dirty` — чесно: переключення ще не закомічене) |

Serving tuple (content-free):

```text
[release] serving release=r26 app=15ca0c711d9bef9873dd688121dfcce483641204+dirty agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26 model=claude-sonnet-5/medium/standard system=3e204453c82c skill_pins=explicit skills=task-management@skver_01CJQkVY1kp1urhBWQgHUYxW,daily-planning@skver_01EL7d3fy4WWYBSsD3PmK9LQ,weekly-planning@skver_01FdtnnkbePBjNJGTuJyAvhw,studio-intake@skver_018sJv1GCnzfZRG4NbExbAzj,work-review@skver_015LYzVdivGGMsBpuki4kW4S specialist=agent_01KNiQDzzPjaMU6LLF4mU6uM@4 builtin=edit,glob,grep,read,write custom_tools=trello_work_history#dcf099612535 memory=read_write session=sesn_01UMLG3oqYCTNAbzdBXnR9iv trello_history=ok/expires=27d
```

Додатково перевірено реальний production entrypoint (`node dist/telegramCli.js`) з фейковим Telegram-токеном:
- live preflight r26 проходить;
- далі `telegram_unauthorized` → exit 78, Session не створюється;
- `DJONIK_EXPECTED_RELEASE=r25` на цій ревізії → exit 78 ще до мережевих викликів.

## 9. Live smoke (одна Session, 4 ходи)

**Admission (docs/04 §27):**
- стеля — 120¢, резерв — 5¢;
- найгірший порівнянний хід: ordinary і intake по 21¢ (docs/46), work-review 15¢ (консервативно; Haiku у docs/32 — 3¢), PH 32¢ (docs/39);
- хід допускається, лише коли залишок ≥ worst + 5;
- додатково стоїть платформний Session budget 120¢;
- stop-умови: будь-який `trelloWrite*`, незавершений хід або помилка.

Усі 4 ходи допущено, stop-умов не було.

| Хід | Session | Model iter. (coord.) | Tools / MCP / custom | Specialist | Tokens (create / read / out) | Cost | Latency | Кінець |
|---|---|---|---|---|---|---|---|---|
| S1 voice | `sesn_01UMLG3o…` | 1 | — | — | 25 144 / 0 / 433 | 7¢ | 12.4 с | `end_turn` |
| S2 intake | ″ | 2 | `read` studio-intake/SKILL.md | — | 4 287 / 50 804 / 323 | 2¢ | 10.1 с | `end_turn` |
| S3 work-review | ″ | 3 | `read` work-review/SKILL.md; custom `trello_work_history` ×1 | — | 1 323 / 89 522 / 361 | 3¢ | 10.8 с | `end_turn` |
| S4 PH + друга частина | ″ | 3 (+8 у specialist) | coordinator: 0; specialist: `read` project-health/SKILL.md, MCP `trelloSearch` ×3, `trelloReadBoard` ×2, `trelloReadCard` ×1 | `sthr_011pDJrjDy9T4GNR9fu8rprF` (v4) | 51 098 / 249 967 / 3 661 | 21¢ (coord ≈2, specialist 19) | 57.9 с | `end_turn` |

### S1 — звичайна мова. **PASS** (soft)

Prompt: «Привіт! Коротко: як краще сказати клієнту, що нове коло правок після затвердження — це вже окремий етап з окремою оплатою?»

Відповідь (дослівно):

> Привіт! Коротко і без вибачень — головне чітко розділити "затверджено" і "нові правки":
>
> **Суть меседжу:** "Дизайн/етап затверджений [дата] — це фіксує обсяг роботи. Те, що ти пропонуєш зараз — це вже зміни поза затвердженим обсягом, тому оформляємо як новий етап з окремою оплатою."
>
> Кілька принципів, які роблять це менш конфліктним:
> - Не виправдовуйся і не пояснюй "чому так прийнято" — просто констатуй факт про затвердження.
> - Запропонуй одразу наступний крок: "Скинь список правок — оцінимо обсяг і погодимо вартість/строки окремо."
> - Якщо клієнт не погоджувався формально (усно кинув "ок"), краще уникати жорсткого "ви затвердили" — сказати м'якше: "ми перейшли до наступного етапу на основі цієї версії, тому доопрацювання рахуються окремо."
>
> Хочеш, я підготую конкретний текст повідомлення під твій кейс — з якою саме формулювання етапу /суми йдеться?

Оцінка:
- Природно, українською, по суті, спокійна пряма позиція без виправдань.
- Final-only: без технічного тексту й без narration.
- Soft: для «Коротко» трохи довго (меседж + 3 пункти + пропозиція).
- Soft: мовна помилка «з якою саме формулювання».
- Регресу #38 немає: той самий prompt, модель і effort.

### S2 — studio / task intake. **PASS** (soft)

Prompt: «Покажи, як би ти оформив задачу — поки нічого не створюй. Для Seqthera треба підготувати три варіанти упаковки для пробника, Анастасія хоче побачити до середи, але референсів від клієнта ще нема.»

> Ось як я б оформив — без чеклісту, бо кроки тут не розпадаються на окремі етапи виконання:
>
> **Назва:** Seqthera — 3 варіанти упаковки пробника
>
> **Контекст:** Підготувати три варіанти упаковки для пробника. Референси від клієнта поки відсутні — працюємо без них. Анастасія хоче побачити результат до середи.
>
> **Відсутня інформація:** референси від клієнта — не критично блокує старт (можна запропонувати власні напрямки), але варто уточнити, чи чекати на них, чи рухатись без.
>
> Створювати картку не буду, поки не скажеш.

Оцінка:
- Studio-intake Skill завантажено через `read`: allowlist працює.
- Структура, а не переказ; дедлайн не вигаданий.
- Одне природне уточнення.
- 0 записів, «не створюю, поки не скажеш».
- Soft: префікс «Seqthera —» у назві. Skill радить не додавати проєкт без потреби: проєкт — це label.
- Soft: «працюємо без них» — легке припущення.
- Label-запис не перевірявся: це був non-mutating сценарій. Accepted task-management Skill побайтово той самий, що в #37 (§4).

### S3 — work review / #36. **PASS** (відоме UX-спостереження)

Prompt: «Давай коротко підсумуємо тиждень: що по Extract за цей тиждень зрушилось?»

Хід:
- Координатор прочитав work-review Skill.
- Викликав `trello_work_history` рівно один раз з `{"response_format":"concise","scope":{"kind":"project","label":"Extract"},"window":{"kind":"this_week"}}`.
- Lifecycle #40 для `sevt_01KoPHeQQeQxK813Xpa48R6Z`:
  - одна idle `requires_action`, що його називала;
  - один виклик executor;
  - один `user.custom_tool_result` (`is_error:false`);
  - потім `end_turn`;
  - дублікатів continuation немає.
- Trace: `custom_tool_result_sent` ×1, `work_history_relay_composed` (`with_commentary`).
- Свіжість: `window` = «пн 21.09, 00:00 – чт 24.09, 11:25» (Kyiv; час ходу), `coverage: {pagesRead 1, truncated false, oldestActionReached true}`.
- Видима відповідь **починається побайтово** з `answer_text` tool-результату (перевірено).

> Цього тижня по Extract:
>
> - **Перейшло в Done:** 4 — «Міні-парфуми адаптація», «Коментарі по пінкам», «Флакони 7.5 ML» та «Флакони 1.5 ML»
> - **Створено:** 3 картки
> - **Інші переміщення:** 6 карток
>
> ---
> PM-висновок:
> Цього тижня по Extract:
>
> - **Перейшло в Done:** 4 — «Міні-парфуми адаптація», «Коментарі по пінкам», «Флакони 7.5 ML», «Флакони 1.5 ML»
> - **Створено:** 3 картки
> - **Інші переміщення:** 6
>
> Непоганий темп на Done — я б звернув увагу, чи ті 6 інших переміщень не зависли між списками, варто глянути детальніше при потребі.

Оцінка:
- Фактичний блок детермінований і точний.
- Висновок корисний і сформульований як судження.
- Записів 0.
- **Спостереження:** модель повторює фактичний звіт під «PM-висновок», хоча Skill це прямо забороняє. Це та сама поведінка, яку docs/32 зафіксував на Haiku, а прийняття #36 (docs/02) класифікувало як non-hard UX і відклало на реальне спостереження. Тепер вона **відтворилась на Sonnet 5 medium**, тобто це системна поведінка, а не особливість Haiku. Див. §12.

### S4 — Project Health + окремий запит. **PASS** (прийнята F3-семантика)

Prompt: «Як там Seqthera? І окремо: підкажи одним реченням, як попросити в Анастасії референси, щоб не звучало як тиск.»

Хід:
- Нативне делегування. `agent.thread_message_sent` → «Djonik Project Health Specialist»: «Daniel's question about project health, verbatim: "Як там Seqthera?"». Координатор нічого не додав від себе.
- Specialist v4 (`sthr_011pDJrjD…`) прочитав свій Skill і зробив 6 read-only MCP-викликів.
- Видима відповідь = **дослівний** результат specialist + F3-підказка (`specialist_reply_composed: coordinator_withheld`).
- Фактів від координатора у видимій відповіді немає.
- Старого технічного notice немає.

> По Seqthera зараз фактично один живий пункт — картка «UI Design» з прототипом сайту (bionova-cyan.vercel.app). Формально вона лежить у списку Backlog, але в описі сказано, що робота над сторінками відновилась і вже є конкретний план на наступний етап (орієнтовно 1,5 дні), тобто по суті це не «непочате», а поточна робота — просто вона ще не перенесена у відповідний список на дошці. Дедлайну в Trello на цій картці не встановлено. Другий пункт з лейблом Seqthera — підготовка сторіс — вже позначений як виконаний, тож він не впливає на поточну картину. Явних блокерів чи ризиків не видно; я б перенести «UI Design» з Backlog у список, що відповідає активній роботі, щоб статус у Trello збігався з тим, що там насправді відбувається.
>
> ———
> Якщо в цьому ж запиті було ще щось — напиши це окремим повідомленням.

Що runtime утримав (з подій):
- **До** результату specialist координатор написав проміжне повідомлення з відповіддю на другу частину: «Анастасіє, якщо є будь-які референси… скинь, будь ласка, коли зручно…».
- **Після** результату — переказ фактів specialist, посилений («Явних блокерів немає» замість «не видно»).

Правило #32/F3 показує лише verified specialist + підказку. Саме цей сценарій (tool-free друга частина в проміжному повідомленні + переказ) покрито прийнятим тестом docs/48 («видимо рівно S + cue»). Поведінка відповідає прийнятому контракту, але живий «кошт» F3 тут видно: корисну відповідь згенеровано і не показано. Див. §12.

Specialist soft: «я б перенести» (мовна помилка).

## 10. Вартість і latency

| | list cost |
|---|---|
| Відхилена атестацією Session `sesn_015bsec…` | 0¢ |
| S1 / S2 / S3 / S4 | 7 / 2 / 3 / 21 ¢ |
| **Разом** | **33¢ ($0.33) з $1.20** |

- За thread: coordinator 14¢, specialist 19¢.
- Session `active_seconds` 88.6; вартість runtime ($0.08/год) входить у list cost.
- Latency: 12.4 / 10.1 / 10.8 / 57.9 с. Найдовший хід (PH) — 58 с, що вкладається в drain 120 с із запасом ≈2×.

## 11. Нуль записів — докази

Аудит `events.list` Session і `threads.events.list` кожного thread:
- `agent.tool_use` `write`/`edit`: **0** (отже, 0 записів у Memory);
- MCP `trelloWrite*`: **0**; Calendar-викликів: **0**;
- помилок tool, MCP чи session: **0**;
- `web_search`/`web_fetch`: 0 (вони й недоступні);
- Memory в цих ходах не читалась — вона не знадобилась.

Після smoke (read-only):
- latest Agent = 26 (`updated_at` = мить update);
- specialist latest = 4 (`updated_at` 2026-09-21);
- усі 6 Skills: `latest_version_id` без змін;
- `release:check r26` і `r25` → OK.

## 12. Регреси та спостереження

Регресів відносно прийнятих #37/#38/#36/#32/#40 **немає**. Для Product Owner:

1. **S3: дублювання фактичного звіту в PM-секції.** Раніше це було спостереження на Haiku, тепер воно підтверджене на production-моделі. Функціонально коректно, але Daniel бачить факти двічі.
   - Причина: поведінка моделі. Інструкцію Skill не виконано, а код тексту координатора не змінює (свідоме рішення #36: не шліфувати renderer).
   - Рекомендація: окремий обмежений follow-up перед або в перші дні 24/7. Два варіанти для вибору PO:
     - **(a)** детермінований relay показує `answer_text` + лише останній абзац координатора;
     - **(b)** нова версія Skill `work-review` з іншою формою виводу (наприклад, лише одне речення без заголовка).
   - Жоден варіант не потрібен для коректності релізу.
2. **S4: прийнятий кошт F3 проявився live.** Відповідь на tool-free другу частину існувала в проміжному повідомленні *до* результату specialist, але не показана; Daniel бачить підказку повторити.
   - Спостереження для майбутнього #32/F3-перегляду (не #33): текст координатора, надісланий **до** `agent.thread_message_received`, за порядком подій не може бути переписуванням результату specialist. Це детермінований сигнал provenance, якого не мала F1.
   - Ризик: такий текст може містити власні факти координатора про проєкт. Рішення — за Product Lead / PO.
3. Soft-мова: S1 «з якою саме формулювання», specialist «я б перенести». S1 трохи довгий для «Коротко». S2 — проєкт у назві.
4. `late_events_quarantined {preAnchorEvents: 2}` у S2–S4 — це хвости попереднього ходу (`session.usage` тощо) у межах штатного #32-механізму; на відповідь не вплинули.

## 13. Готовність хоста

**Рекомендація без змін: невеликий EU VPS + systemd.** Переоцінено з урахуванням вимог (docs/51 §15). Вирішальна властивість — структурне «stop-before-start» (`systemctl restart`): два poller-и не можуть перекритися за побудовою, а не за таймінгом.

Простіших альтернатив не з'явилось:
- Managed Agents Deployments — це cron-Sessions, не Telegram poller;
- serverless/webhook суперечить in-process стану #32/#40;
- laptop не always-on.

Ціни з дослідження docs/51 (2026-09-24, сьогодні не перезапитувались): ≈ **€5.49/міс** (Hetzner CX23-клас). Fallback — Railway, з відомим ризиком overlap.

| Вимога | Стан |
|---|---|
| Один процес / один poller | один plain unit, один `ExecStart` (тест); Telegram 409 → drain → exit 75 |
| Restart policy | `Restart=on-failure`, `RestartSec=15`, `StartLimitBurst=5/600s`, `RestartPreventExitStatus=78` |
| Graceful shutdown | стоп polling → flush фрагментів → drain in-flight → чесна підказка при timeout → close; другий сигнал → exit 130 |
| Drain | **120 с лишається правильним**: найдовший live-хід 58 с (S4), історично ~55 с (docs/49); `TimeoutStopSec=150` ≥ drain + 20 (тест) |
| Секрети | `/etc/djonik/djonik.env` (root, 0600): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TRELLO_API_KEY`, `TRELLO_READ_TOKEN`, `TRELLO_READ_TOKEN_EXPIRES_AT`, `DJONIK_EXPECTED_RELEASE=r26`. Trello MCP OAuth — у vault Anthropic. Ids — з `src/release.ts`. Жодних `DJONIK_*_ID` на хості |
| Startup attestation | preflight v26 → Trello health → getMe → pinned Session → retrieve → attest → tuple → polling. Перевірено live (§8), зокрема fail-closed відмову |
| App revision | `DJONIK_APP_REVISION=<sha>` з `deploy.sh` → metadata Session + tuple |
| Без повідомлень і секретів у логах | tuple і `[shutdown]`/`[turn]` content-free (тести з marker-секретами) |
| Rollback | `deploy/deploy.sh <sha ревізії r25>`, наприклад `15ca0c711d9bef9873dd688121dfcce483641204` (pin v25, `latest-resolved`); v25 незмінна |
| Ротація Trello token | docs/52 §5. Поточний токен спливає ≈ **2026-10-22** (startup: `expires=27d`). Рекомендовано read-scope `never` у момент налаштування хоста |
| Розмір | 1 vCPU, 1–2 GB RAM, Node ≥ 20, без inbound-порту й диска |
| Вартість | хост ≈ €5–6/міс + inference за хід (S1–S4: 2–21¢) |

**Виправлено в `deploy/deploy.sh`** (обидва дефекти реальні й дрібні):
1. `git checkout` підміняв сам скрипт, поки bash його виконував (bash читає скрипт інкрементно). Тепер усе тіло — функція `main`, яка повністю розбирається до запуску.
2. Фінальна перевірка приймала **будь-який** рядок `[shutdown]` старого процесу за останні 2 хв. Тож деплой міг «пройти», коли новий процес вийшов з 78. Тепер успіх — лише рядок `[release] serving … app=$REV` з моменту restart, поки unit активний; інакше exit 1 з підказкою про rollback. Нові інваріанти закріплено в `src/deployConfig.test.ts`.

## 14. Rollback

| Ситуація | Дія | Запис в Agent? |
|---|---|---|
| r26 поводиться погано після деплою | `deploy/deploy.sh 15ca0c711d9bef9873dd688121dfcce483641204` (serves r25 → v25) | Ні |
| Хост зламався | `systemctl disable --now djonik-telegram`, потім laptop-адаптер з pinned ревізії; ніколи обидва одночасно | Ні |
| Потрібна нова конфігурація | v27 через згенероване тіло + `RELEASE_*` у рев'ю | Так (з авторизацією) |

Нагадування:
- v25 **не архівувати**: це rollback-ціль. `release:check r25` досі OK.
- Rollback не відміняє вже зроблених записів у Trello чи Memory і стартує нову Session (docs/51 §11).
- **Нове після v26:** будь-який *непінований* старий адаптер (ревізія до `15ca0c7`, `agent: "<id>"` рядком) при створенні нової Session тепер отримає **v26 без атестації**. Тому до хост-деплою ніде не запускати старі ревізії адаптера.

## 15. Що лишилось Product Owner

1. Переглянути цей звіт і прийняти (або ні) r26 з урахуванням §12.1–§12.2.
2. Fast-forward `main` до cloud-коміту (команди — у фінальному звіті).
3. Ротація Trello read token (read-scope, `never`) — до 2026-10-22, найкраще під час налаштування хоста.
4. Авторизувати й створити VPS: акаунт, VM, Node ≥ 20, користувач `djonik`, clone, `/etc/djonik/djonik.env`, unit (docs/52 §2).
5. Зупинити будь-який laptop-адаптер, потім `deploy/deploy.sh <sha>` → Checkpoint A: рядок `[release] serving release=r26 … app=<sha>` (Session metadata `source=telegram`) — це і є реальний Telegram serving-доказ, якого #33 вимагає (acceptance п. 2).
6. Один-два реальні повідомлення Daniel у Telegram як фінальне підтвердження serving (дешево: 2–7¢ за звичайний хід).
7. Рішення щодо §12.1 (follow-up для відповіді work-review) і §12.2 (перегляд F3).
8. Чи лишати `DJONIK_TURN_TELEMETRY=1` у production.
9. Опційно: прибрати idle-Sessions валідації (`sesn_015bsec…`, `sesn_01UMLG3o…`) і кандидата #36 `agent_01QpAua2SCbFAHF7h8HQwigT` (архівація — рішення PO).

## 16. Рекомендація

**READY FOR HOST DEPLOYMENT.** Реліз r26 створено, атестовано і перевірено live на serving boundary, зокрема #36 на Sonnet 5 medium; 0 записів, $0.33. Лишились механічні кроки хосту (§15.3–§15.6) і два продуктові рішення, які не блокують деплой (§12). #33 не закривається до реального Telegram serving-доказу з хоста. #34 не починається.

## Змінені файли

| Файл | Зміна |
|---|---|
| `src/release.ts` | `SERVING_RELEASE = RELEASE_R26`; `sessionVersion` для explicit pins (виміряне snapshot-написання); коментарі стану |
| `src/releaseAttestation.ts` | explicit pin приймає `skver_` **або** рівно свій `sessionVersion` |
| `src/servingRelease.ts` | опційний `maxListCostUsdCents` у `ServingSessionHooks` (Session budget для обмежених валідацій; Telegram його не задає) |
| `src/releaseFixtures.test-helpers.ts` | Session-фікстура відтворює реальну форму провайдера |
| `src/release.test.ts`, `src/releaseAttestation.test.ts`, `src/servingRelease.test.ts`, `src/deployConfig.test.ts` | тести: ревізія серверить r26 без `latest`; числове написання приймається лише для своєї версії; budget-шлях; інваріанти deploy-скрипта |
| `deploy/deploy.sh` | функція `main` (безпечна самопідміна); перевірка успіху за tuple нової ревізії |
| `docs/53` (цей файл), `docs/52`, `docs/02`, `docs/01`, `managed-agents/README.md` | поточний стан |

Перевірки: `npm test` 635/635, `typecheck` clean, `build` OK, `git diff --check` clean.
