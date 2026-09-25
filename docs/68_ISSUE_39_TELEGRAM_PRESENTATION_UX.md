# #39 — Telegram presentation UX: rich text замість видимого Markdown

Дата: 2026-09-25. Canonical NOW: [#39](https://github.com/danielkokr/djonik-manager-2.0/issues/39). Базовий `main`: `6e092aaf5df408cc20e37c431f05e0903810d910`. Production: Hetzner, r27 / Agent v27, Working Rhythm OFF.

**Статус:** transport-зміну реалізовано й протестовано локально. Без commit / push / deploy. Remote Agent і Skills не змінювались. Чекає на review Product Lead.

## 1. Проблема

Djonik пише легкий Markdown (`**Що робити в першу чергу**`, `**Спірний момент**`), а всі три шляхи надсилання в Telegram передавали текст без `parse_mode`. Тому Daniel бачив буквальні `**`.

Шляхи, які були до зміни:

| Шлях | Код до зміни |
|---|---|
| звичайна відповідь і помилки turn/group (`telegramDispatch`) | `bot.api.sendMessage(chatId, text)` у `telegramCli.ts` |
| shutdown-повідомлення про перерваний хід (`servingLifecycle.notify`) | `bot.api.sendMessage(chatId, text)` у `telegramCli.ts` |
| proactive-повідомлення Working Rhythm (`createTelegramProactiveSender`) | `api.sendMessage(chatId, text, { reply_markup })` |

## 2. Реалізація: один спільний шлях

Новий модуль `src/telegramFormat.ts`:

- `renderTelegramHtml(text)` — рендерер малого підмножини в Telegram HTML;
- `sendFormattedMessage(api, chatId, text, replyMarkup?)` — єдина функція надсилання: `sendMessage(chatId, rendered, { parse_mode: "HTML", reply_markup? })` + обмежений fallback;
- `createFormattedTextSender(api)` — обгортка `(chatId, text)` для dispatch і shutdown-notice;
- `isEntityParseError(error)` — розпізнає лише відмову Telegram через розбір entities.

Підключення:

- `telegramCli.ts`: один `sendText = createFormattedTextSender(bot.api)` передається і в `createGroupDispatchHandlers({ sendMessage })`, і в `createShutdownCoordinator({ notify })`;
- `rhythmTelegram.ts`: `createTelegramProactiveSender` викликає той самий `sendFormattedMessage`, передаючи `reply_markup` без змін. `TelegramProactiveApi` тепер є аліасом `TelegramTextApi<TelegramInlineKeyboard>`.

Звичайні відповіді, фіксовані повідомлення і proactive-повідомлення йдуть через **один** рендерер. Окремої конкурентної реалізації немає. Нових залежностей теж немає.

## 3. Підтримуваний синтаксис

| Вхід | Telegram HTML | Умова |
|---|---|---|
| `**текст**` | `<b>текст</b>` | в одному рядку; вміст не починається й не закінчується пробілом або `*` |
| `` `текст` `` | `<code>текст</code>` | в одному рядку, непорожній, без backtick усередині |
| `` **див. `x`** `` | `<b>див. <code>x</code></b>` | code всередині bold |
| `` `**x**` `` | `<code>**x**</code>` | bold всередині code не рендериться |

Решта (`#`-заголовки, `__`, `_`, посилання, списки) лишається звичайним текстом. Це не Markdown-парсер. Inline code підтримано тому, що це безпечно й займає один regex. Сам по собі він не потрібен.

## 4. Екранування і безпека

- Спершу **весь** вихідний текст екранується (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`). Потім тільки рендерер додає теги `<b>` і `<code>`.
- Raw HTML від моделі ніколи не стає розміткою. `<b>x</b>` доходить як видимий текст `<b>x</b>`, так само `<a href=…>`.
- `A < B & **важливо**` → `A &lt; B &amp; <b>важливо</b>`.
- Некоректна розмітка лишається буквальним текстом, без спроб її вгадати: `**без кінця`, `кінець без початку**`, `2 ** 3`, `** пробіли **`, `****`, `a * b * c`, `***`. Bold через кілька рядків (`**перший\nдругий**`) теж лишається буквальним. Так незакритий `**` не робить жирним увесь хвіст повідомлення.
- Рендерер не кидає винятків на жодному вході: там лише regex і string replace.

## 5. Fallback

- Fallback спрацьовує **лише** коли Telegram повертає `GrammyError` з кодом 400 і описом `can't parse entities` / `can't find end of the entity`. Тоді виконується **одна** повторна відправка оригінального тексту **без** `parse_mode`, з тим самим `reply_markup`.
- Відмова через parse означає, що повідомлення не доставлено. Тому fallback не може створити дубль.
- Якщо fallback теж падає, помилка йде вище. Третьої спроби немає.
- Мережеві помилки (`HttpError`), 429, 403, інші 400 (наприклад, `message is too long`) і будь-які інші помилки йдуть вище без повторної відправки. Отже, класифікація доставки не змінилась: `classifySendError` для proactive-шляху (`rejected` / `unknown`) і `formatUserFacingError` для dispatch працюють як раніше.
- Для proactive fallback, що пройшов успішно, результат `sent` з `message_id` fallback-повідомлення. Тому кнопки й далі прив'язані до правильного повідомлення.

## 6. Приклад

Відповідь моделі:

```
🎯 **Головне сьогодні**

1. **Extract — крем для рук**
   Дедлайн сьогодні. Illustrator → Cinema 4D → показати клієнту.

⚠️ **Перевірити**
R&D < 2 днів

→ Якщо залишиться час — взяти Invoice.
```

Що йде в Telegram (`parse_mode: "HTML"`):

```
🎯 <b>Головне сьогодні</b>

1. <b>Extract — крем для рук</b>
   Дедлайн сьогодні. Illustrator → Cinema 4D → показати клієнту.

⚠️ <b>Перевірити</b>
R&amp;D &lt; 2 днів

→ Якщо залишиться час — взяти Invoice.
```

Daniel бачить справжній жирний текст без `**`.

## 7. Style-source (`managed-agents/djonik.md`, `pm-rhythm/SKILL.md`) — НЕ змінено

Обидва файли в цьому репозиторії жорстко прив'язані SHA-256 до RELEASE_R27:

- `src/release.test.ts`: `release.systemSha256 === sha(body djonik.md)`;
- `src/releaseR27.test.ts`: закомічений `pm-rhythm/SKILL.md` = SHA, записаний під час sync pin-версії `skver_01Y77TKeXY9suV99XZU3cv5a`.

Перевірено напряму: навіть один доданий байт у кожному з файлів валить **6** release-тестів (declarative source ≠ serving release, attestation v27). Щоб їх полагодити, треба змінити хеші RELEASE_R27 або визначити r28. Обидва варіанти в цьому завданні заборонені. Ці guard-и навмисно не дають source у `main` тихо розійтися з тим, що serve-иться. Тому я відновив файли й не змінював їх. Нижче точний patch для окремого reviewed оновлення Agent/Skill (r28).

**Запропоноване правило для `managed-agents/djonik.md` → `# How you speak`** (нова остання позиція списку):

```
- In Telegram you may use selective `**bold**` for a short label or a key item name, and the functional emoji 🎯 main focus, ⚠️ attention/risk, ⏳ waiting, ✓ done, → next action — only where they help scanning. No decorative emoji, never one on every line, no other Markdown. Often two or three plain sentences are better than sections.
```

**Запропоноване правило для `.claude/skills/pm-rhythm/SKILL.md` → `## What every rhythm message is`** (після пункту «Natural Ukrainian…»):

```
- **Presentation.** Short bold labels and the functional emoji 🎯 ⚠️ ⏳ ✓ → are fine where they help scanning, as in the coordinator prompt; no decorative emoji, no emoji on every line, still no report headings.
```

Жодне з правил не змінює PM-семантику чи фактичні правила.

## 8. Чи вистачить одного transport?

**Для головної видимої проблеми — так.** Модель уже сама пише `**мітка**` (це видно в production). Після deploy ці мітки стануть справжнім bold, і `**` зникнуть. Поточний стиль моделі прийнятний і без нових правил: помірні мітки, спокійний тон. Правила формулювання лише закріплюють restrained-словник емодзі й забороняють декоративні. Це polishing, не передумова. Прихованих per-turn інструкцій і змін повідомлень користувача немає.

Що transport **не** вирішує: `#`-заголовки чи `_курсив_`, якщо модель колись їх напише, лишаться буквальними. У production цього не спостерігали.

## 9. Тести

Новий `src/telegramFormat.test.ts` (16 тестів) покриває: plain text; `**bold**`; кілька spans; українську й функціональні емодзі; екранування `<` `>` `&`; raw HTML від моделі; незакриті та буквальні `*`; багаторядковий текст; inline code; `parse_mode: "HTML"`; рівно один fallback при parse error (з кнопками і без); fallback обмежений однією спробою; успішна відправка без fallback; мережева помилка, 429, 403, 400 `too long` і generic помилка — без дубля; proactive зберігає inline keyboard; proactive fallback лишається `sent` з правильним `message_id`; класифікація proactive-помилок не змінилась; звичайна відповідь і error-notice через реальний `MessageGroupBuffer` + `createGroupDispatchHandlers` + `createFormattedTextSender`.

Оновлено `src/rhythmTelegram.test.ts`: очікуваний `other` тепер містить `parse_mode: "HTML"`. Для повідомлення без кнопок очікується `{ parse_mode: "HTML" }` без `reply_markup`.

| Перевірка | Результат |
|---|---|
| focused: telegramFormat, rhythmTelegram, telegramAdapter, rhythmActions, messageGrouping, telegramDispatch, servingLifecycle, rhythmRuntime | 148 / 148 pass |
| `npm test` | 956 tests, 954 pass, 2 fail |
| той самий `npm test` на чистому HEAD `6e092aa` (тимчасовий worktree) | 940 tests, 938 pass, **ті самі** 2 fail |
| `npm run typecheck` | OK |
| `npm run build` | OK |
| `git diff --check` | OK |

Обидва падіння (`deploy script survives replacing itself…`, `a real process that fetched over keep-alive exits…`) були й до цієї зміни. Це відомі Windows-only падіння, не регресії.

## 10. Що і коли почне діяти

**A. Transport (цей diff).** Почне діяти після deploy нової ревізії застосунку на Hetzner. Remote Agent, Skills, release-ідентифікатори і `RELEASE_R27` не змінюються. Ревізія serve-ить той самий r27 / Agent v27.

**B. Формулювання coordinator / pm-rhythm.** У source не змінені (§7). Щоб вони вплинули на hosted-модель, потрібне окремо reviewed оновлення: нова версія Agent (v28) з оновленим `system`, новий pm-rhythm `skver`, нова release-дефініція r28 з новими SHA і pin-ами, sync і cutover. Для цієї presentation-правки це не обов'язково (§8).

## 11. Змінені файли

- `src/telegramFormat.ts` — новий спільний рендерер і send-шлях;
- `src/telegramFormat.test.ts` — нові тести;
- `src/rhythmTelegram.ts` — proactive sender через `sendFormattedMessage`;
- `src/rhythmTelegram.test.ts` — очікування `parse_mode`;
- `src/telegramCli.ts` — dispatch і shutdown-notice через `createFormattedTextSender`;
- `docs/68_ISSUE_39_TELEGRAM_PRESENTATION_UX.md` — цей звіт.

Trello, Memory, permissions, release-дефініції, scheduler, deploy-скрипти, `managed-agents/djonik.md` і `.claude/skills/pm-rhythm/SKILL.md` не змінювались.

## 12. Наступний крок перед активацією Working Rhythm

1. Review цього diff (Product Lead) і acceptance (Product Owner).
2. Ручний commit/push. Потім deploy цієї ревізії на Hetzner **без зміни** `DJONIK_EXPECTED_RELEASE` (лишається `r27`) і `DJONIK_WORKING_RHYTHM` (лишається unset).
3. Smoke у Telegram: одна звичайна відповідь зі справжнім bold і без видимих `**`. Serving tuple в журналі показує r27 / Agent v27 і нову `app=`-ревізію.
4. Лише після цього окреме рішення щодо активації Working Rhythm. Опціональне оновлення формулювань (B) — окремим r28-кроком, якщо Product Lead вирішить, що воно потрібне.
