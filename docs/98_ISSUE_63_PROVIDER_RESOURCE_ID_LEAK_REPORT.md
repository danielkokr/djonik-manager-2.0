# #63 — Витік внутрішніх Trello-ідентифікаторів (ARI) у Telegram: звіт реалізації

Issue: [danielkokr/djonik-manager-2.0#63](https://github.com/danielkokr/djonik-manager-2.0/issues/63). Статус: реалізовано в робочому дереві, **без commit/push/deploy**, #63 не закрито. Без paid inference, без запису в Trello/Memory, без remote sync Agent/Skill.

## 1. Підсумок

Причину знайдено: це **код, а не модель** (варіант D). Детермінований звіт про мутації в `trelloMutationLedger.ts` (`describeCard`/`describeTarget`) рендерив ціль як `«Назва» (ari:cloud:trello::card/…)` або `картка ari:cloud:trello::card/…`. Цей текст стає видимою відповіддю в кількох шляхах `djonikClient.ts`, зокрема в блоці підтвердження дедлайну для ходу з кількома підтвердженими записами — саме такий хід був у production (create + update дедлайну/опису однієї картки).

Виправлення:

1. **Основне — межа серіалізації (ієрархія п. 2).** Звіт про мутації має аудиторію: `user` (типово, без id, тільки людські назви) та `diagnostic` (з id, лише для внутрішнього `DjonikUnverifiedMutationError.message` → логи/трейси). Id лишаються в `MutationOutcome.targetCardIds` та ін. для кореляції й верифікації.
2. **Додатково — вузький guard на межі доставки в Telegram (ієрархія п. 3)** — тільки для prose моделі, яка надходить як звичайний текст (варіант C): `stripProviderResourceIds` у `sendFormattedMessage` прибирає лише синтаксис ARI `ari:cloud:<product>:<cloud-id>:<type>/<id>`. URL і звичайні дужки не чіпаються.

## 2. Корінна причина

`describeCard` (до виправлення):

```ts
if (outcome.label !== null) return id ? `«${outcome.label}» (${id})` : `«${outcome.label}»`;
return id ? `картка ${id}` : "картка без відомого ID";
```

Для Trello MCP `id` — це ARI. Функція призначалась для «honest reporting», але той самий текст використовувався і як внутрішня діагностика, і як видима відповідь. Тести навіть закріплювали витік як очікувану поведінку (напр. `«Hero банер» (${L37_CARD})` у відповіді `session.send`).

Перевірені й відкинуті джерела:

- **A (структуровані citation/resource-блоки):** SDK `BetaManagedAgentsAgentMessageEvent.content` — лише `BetaManagedAgentsTextBlock { text, type }` або `RedactedBlock`; поля `citations` немає. Клієнт бере тільки `type === "text"`. Не джерело.
- **B (метадані MCP tool result):** `agent.mcp_tool_result` лише парситься (`extractCardObject`, ledger) і ніколи не конкатенується у `reply`. Не джерело.
- **C (текст моделі):** можливий (модель бачить ARI у результатах інструментів), структурної межі немає → закрито вузьким guard на доставці.
- **D (код-owned композиція):** **підтверджене джерело** (див. відтворення нижче).
- **E (Telegram formatting):** `renderTelegramHtml` лише екранує й рендерить `**`/`` ` ``; id не додає.

## 3. Точна перша точка появи ARI у видимому шляху

Production-шлях:

```
agent.mcp_tool_result (trelloWriteCard create → JSON з id = ari:cloud:trello::card/workspace/<ws>/<card>)
→ TrelloMutationLedger.targetIdsOf → MutationOutcome.targetCardIds = [ARI]       (внутрішнє, коректно)
→ finalizeMutationReplyWithMode: effective.length > 1 (create + update due/desc)
→ describeMutationTarget(outcome) → describeTarget → describeCard
     ← ТУТ ARI ВПЕРШЕ потрапляє у текст: `«${label}» (${id})` / `картка ${id}`
→ `${target}: ${line}` → composeVerifiedDueReply → reply
→ telegramDispatch.onDispatch → sendMessage → sendFormattedMessage → Telegram
```

Перша точка: `src/trelloMutationLedger.ts`, `describeCard` (інтерполяція `(${id})` / `картка ${id}`), викликана з `djonikClient.ts` `finalizeMutationReplyWithMode` (рядок блоку `${describeMutationTarget(outcome)}: ${line}`).

Відтворення на коді до виправлення (новий тест з `src` у stash) дав рівно production-симптом:

```
«Мерч Азов: лонгслів + свічка» (ari:cloud:trello::card/workspace/5f1a…/6aad…): Зміни підтверджено читанням картки.
картка ari:cloud:trello::card/workspace/5f1a…/6aad…: Готово. Trello підтвердив дедлайн: понеділок, 5 жовтня 2026, 18:00 за Києвом.
```

Ті самі id-рядки потрапляли до користувача й іншими шляхами `describeMutationOutcomes`: звіт про failed-запис (`❌ …`), #32 verified-specialist хід без тексту моделі, а також `DjonikTurnIncompleteError` / `DjonikSpecialistUnverifiedError`, чий `message` показує `formatUserFacingError`. `DjonikUnverifiedMutationError` уже з #56 показувався користувачу фіксованим рядком — його повідомлення лишається внутрішнім і зберігає id.

## 4. Змінені файли

- `src/trelloMutationLedger.ts` — `MutationReportAudience = "user" | "diagnostic"`; `describeMutationOutcomes(outcomes, describeDue, audience = "user")`; `describeMutationTarget(outcome, all)` завжди `user`; `knownCardName` — display-only запозичення назви тієї ж картки з інших outcomes ходу (назва з create-запису або `cardName` з перевіреного checklist create). Чекліст у `user`: `у картці «Назва»` / `у чеклісті «Назва»` (з #57 display-полів) або без id.
- `src/djonikClient.ts` — 2 рядки: `DjonikUnverifiedMutationError` бере `"diagnostic"`; багаторядковий due-блок передає `outcomes` у `describeMutationTarget`.
- `src/telegramFormat.ts` — `stripProviderResourceIds` + застосування в `sendFormattedMessage` (обидва надсилання, включно з parse-error fallback).
- `src/trelloMutationLedger.test.ts`, `src/djonikClient.test.ts` — оновлені очікування, які закріплювали витік; нові #63 тести.
- `src/telegramFormat.test.ts` — нові #63 тести (unit + доставка).
- `docs/98_ISSUE_63_PROVIDER_RESOURCE_ID_LEAK_REPORT.md` — цей звіт.

## 5. Архітектура / API рішення

- Корінь виправлено на межі серіалізації: **типова** аудиторія звіту — `user`, тож будь-який новий виклик за замовчуванням безпечний; id потребує явного `"diagnostic"`.
- Ledger, статуси, верифікація, `targetCardIds`, nudge-читання (`verificationReadsFor`) не змінені — id і далі використовуються для кореляції.
- Guard у `sendFormattedMessage` — єдиний Telegram presentation path (звичайні відповіді, помилки, proposals, Working Rhythm). Matching: ARI має починати токен (початок/пробіл/`(`/`[`/`«`/лапки/бектик), тож `ari:cloud:` усередині URL не чіпається; тіло id не з'їдає завершальну `.`/`,`. Обгортка `( … )`, `[ … ]`, `` ` … ` ``, що містить лише ARI, видаляється разом із пробілом перед нею. Інші дужки, URL і prose незмінні.
- Proposal: `proposals.register` зберігає оригінальний текст (внутрішньо); користувач бачить текст без ARI; логіка клавіатури/детекції не змінена.
- Промпт Agent/Skill не змінювався.

## 6. До → після

| Ситуація | До | Після |
|---|---|---|
| create + due update (production) | `«Мерч Азов…» (ari:…): Зміни підтверджено…` / `картка ari:…: Готово. Trello підтвердив дедлайн…` | `«Мерч Азов…»: Зміни підтверджено читанням картки.` / `«Мерч Азов…»: Готово. Trello підтвердив дедлайн: понеділок, 5 жовтня 2026, 18:00 за Києвом.` |
| failed write без назви | `❌ … картка card_A — …` | `❌ … картка — …` |
| label на створеній картці | `label проєкту на картці «Hero банер» (ari:…)` | `label проєкту на картці «Hero банер»` |
| текст моделі `«X» (ari:…).` | доставлявся як є | `«X».` |
| `https://trello.com/c/…`, Google Docs/Drive/Figma | без змін | без змін |
| внутрішній diagnostic unverified-мутації | з id | з id (без змін) |

## 7. Тести та перевірки (точні результати)

Нові #63 тести:

- `djonikClient.test.ts`: «#63: verified create + due update on live ARI shapes → code-owned block names the card, never its ARI» (точна рівність блоку; без ARI і без голих 24-hex; без nudge). Без виправлення — **падає** з production-формою (див. §3).
- `djonikClient.test.ts`: «#63: the unverified-mutation diagnostic still carries provider ids internally; outcomes keep them for correlation».
- `trelloMutationLedger.test.ts`: «#63: the user report names cards/checklists by name only; ids stay on the outcomes and in the diagnostic» — регресія на межі серіалізації (п. 9 вимог).
- `telegramFormat.test.ts`: #63 (1) production-форма; (2) кілька посилань (дужки, голі, бектики, квадратні, список через кому); (3) Google Docs / Drive / Figma / `trello.com/c/…` / URL з ARI у query — без змін; (4) звичайні дужки й prose без змін; (5) due-підтвердження ідентичне, окрім id; (10) доставка через `createGroupDispatchHandlers` + `createFormattedTextSender` + `sendFormattedMessage` для `sendProposal` (як у `telegramCli.ts`), включно з parse-error fallback: жоден виклик `sendMessage` не містить ARI, proposal-клавіатура додана й proposal зв'язаний.

Сфокусовані набори (`node --import tsx --test src/<f>.test.ts`):

```
djonikClient: pass 144 fail 0
trelloMutationLedger: pass 63 fail 0
telegramFormat: pass 22 fail 0
telegramDispatch: pass 13 fail 0
telegramAdapter: pass 42 fail 0
checklistConfirmation: pass 20 fail 0
checklistVerificationNudge: pass 15 fail 0
trelloChecklistLedger: pass 13 fail 0
mutationCommentary: pass 13 fail 0
proposalConfirmation: pass 4 fail 0
forwardedDispatch: pass 12 fail 0
trelloWorkHistory: pass 14 fail 0
turnCorrelation: pass 12 fail 0
rhythmTelegram: pass 12 fail 0
```

Повний набір: `npm test` → `tests 1441, pass 1439, fail 2`. Дві помилки:
- `deploy script survives replacing itself and only reports success for the new revision's serving tuple` (`deployConfig.test.ts`);
- `a real process that fetched over keep-alive exits by itself, promptly, with its code` (`processExit.test.ts`).

Перевірено, що вони відтворюються **без диффу #63** (`git stash push -- src`, запуск двох файлів → `tests 14, pass 12, fail 2`, ті самі два тести; потім `stash pop`). Це відомий environment-specific baseline.

- `npm run build` → OK (без помилок).
- `npm run typecheck` → OK (без помилок).
- `git diff --check` → без виводу, exit 0 (лише попередження LF→CRLF від git).

## 8. Регресії / безпека

- Верифікація запису/readback не змінена: ledger-статуси, `isConfirmed`/`isUnresolved`, nudge-цілі ті самі; тест production-форми підтверджує 1 виклик без nudge.
- Due-композиція (#23/#44): факти й формулювання ідентичні; змінився лише префікс цілі в багаторядковому блоці (без `(id)`). Одиночний due-запис і раніше не мав цілі.
- Checklist (#56/#57): `buildChecklistConfirmation` / `otherVerifiedWritesLine` уже були id-free і не змінені; всі checklist-тести проходять.
- Exact relay work-history / reminders: не зачеплені; `trelloWorkHistory` проходить. Guard змінює текст лише за наявності `ari:cloud:` (швидкий early return), а work-history ARI не містить.
- Proposal: детекція (`isProposalReply`) і реєстрація працюють на оригінальному тексті — поведінка не змінена.
- Display-запозичення назви не впливає на статус/ідентичність; якщо назви немає — нейтральне «картка», без id.
- Дві різні картки з однаковою назвою в одному звіті тепер не відрізнити за id — свідомий компроміс: id для користувача однаково непрозорі.

## 9. Обмеження / відкладене

- Не перевірено на живому production-ході (без paid inference і без запису в Trello за умовою). Потрібна ручна перевірка в Telegram після окремо авторизованого деплою.
- Багаторядковий блок для двох записів однієї картки повторює назву двічі (`«X»: Зміни…` / `«X»: Готово…`). Злиття в один рядок — окрема UX-зміна, поза scope #63.
- Guard прибирає лише ARI-синтаксис. Голі 24-hex Trello ObjectId у тексті моделі не прибираються (не спостерігались у production і неможливо відрізнити від легітимного тексту без ризику).
- Голий ARI на початку рядка залишає пунктуацію після нього (напр. `: …`); на практиці модель ставить ARI після назви, що повністю покрито.
- `DjonikTurnIncompleteError`/`DjonikSpecialistUnverifiedError` тепер несуть id-free звіт і в логах; id цих ходів доступні в трейсах/decision trace (`cardIdsWritten`).

## 10. git diff --check

Без виводу, exit 0.

## 11. git status --short

```
 M src/djonikClient.test.ts
 M src/djonikClient.ts
 M src/telegramFormat.test.ts
 M src/telegramFormat.ts
 M src/trelloMutationLedger.test.ts
 M src/trelloMutationLedger.ts
?? docs/98_ISSUE_63_PROVIDER_RESOURCE_ID_LEAK_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
```

(`docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md` був невідстежуваним до початку роботи й не змінювався.)
