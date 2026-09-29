# 94 — Issue #56: production-фікс хибно-негативної верифікації чекліста

Статус: реалізовано в робочому дереві, **без commit / push / deploy**. Для review Product Lead.
Canonical NOW: #56 (лишається відкритим).

## 1. Production-симптом

Під час ручної валідації r30 у Telegram підтверджений чекліст для картки RDAS фактично записався в Trello, але Джонік повернув помилку `Djonik mutated Trello but did not verify the write with an independent read in this turn.`, показав сирі `ari:cloud:trello…` ідентифікатори, внутрішню діагностику верифікатора і чотири рядки `НЕ підтверджено` для успішно створених пунктів.

## 2. Реальне відтворення

1. Daniel попросив запропонувати чекліст для RDAS.
2. Джонік запропонував 4 пункти (референси концепцій; дизайн сторінки кейсу UI + 3D; показати колегам; відправити на верстку).
3. Daniel відповів `Так` (звичайний `user_message`-turn, не forwarded-proposal кнопка).
4. Модель виконала `trelloWriteChecklist create` + 4 × `add_item` і завершила turn.

## 3. Підтверджений стан Trello

Чекліст `Чекліст` існує на RDAS; усі чотири пункти існують з правильними назвами. Записи виконались.

## 4. Root cause (перевірено по коду main `2c8ee82`)

Діагноз із промпту підтверджено:

- `TrelloMutationLedger.evaluateChecklistWrite` (#48) вимагає для `create` пізнішого `trelloReadChecklist list_by_card(cardId)`, для `add_item` — пізнішого `trelloReadChecklist get(checklistId)`; сам результат запису — лише ідентифікатор.
- `isNudgeable` мав `!outcome.checklist && …` — checklist-outcome **ніколи** не запускав корективний nudge.
- `buildVerificationNudgeText(cardIds)` умів просити лише `trelloReadCard get`.
- Тож якщо модель після checklist-записів не зробила read-back сама, runtime не мав жодного механізму це виправити → `outcomes.some(isUnresolved)` → `DjonikUnverifiedMutationError`.
- `formatUserFacingError` повертав `⚠️ Джонік не зміг відповісти…: ${error.message}`, а `message` цієї помилки — внутрішній звіт `describeMutationOutcomes` з ARI (через `DjonikTracedTurnError` повідомлення копіюється 1:1).

Уточнення: за описом симптому (4 рядки `НЕ підтверджено`, create не серед них) create, імовірно, модель перечитала сама (`list_by_card`), а `get` чекліста — ні. Причина рядків (`після запису не було успішного читання потрібного чекліста` = `awaiting_read` vs `пряме читання не підтвердило значення` = `field_unconfirmed`) у звіті не зафіксована; див. §14/обмеження.

## 5. Чому safety спрацював правильно

Ledger не вважає результат запису postcondition-ом і не маркує запис підтвердженим без авторитетного читання після запису. Turn fail-closed, модельний текст «Готово» не показано як успіх.

## 6. Чому UX все одно був неправильний

(a) нормальний підтверджений checklist-сценарій не мав шляху до відновлення верифікації — хоча для карток такий шлях (#8/#31) давно є; (b) Telegram отримав внутрішній текст exception з ARI та технічними деталями.

## 7. Архітектура bounded-фіксу

Жодної нової архітектури: той самий ledger по event-stream, той самий `MAX_VERIFICATION_NUDGES = 1`, той самий цикл у `sendPartsSerial`.

```
write(s) → end_turn → ledger.outcomes() → є nudgeable?
  → verificationReadsFor(outcomes)  (з provenance ledger, не з тексту Daniel)
  → ОДИН user.message nudge з лише цими читаннями
  → rerun → ledger переоцінює → success АБО DjonikUnverifiedMutationError
```

## 8. Представлення запиту на верифікацію

`src/trelloMutationLedger.ts`:

```ts
type VerificationRead =
  | { kind: "card"; cardId }             // trelloReadCard get
  | { kind: "checklist_list"; cardId }   // trelloReadChecklist list_by_card
  | { kind: "checklist_get"; checklistId } // trelloReadChecklist get
```

- `verificationReadOf(outcome)` — одне читання, яке може закрити конкретний outcome (card → `card`; checklist create → `checklist_list` по картці; add_item → `checklist_get` по чеклісту).
- `isNudgeable` = nudgeable-статус (`awaiting_read` / `field_mismatch` / `field_unconfirmed`, без змін) **і** існує `verificationReadOf`. Виключення checklist знято.
- `verificationReadsFor(outcomes)` — дедуплікація за (kind, target через `identifiersMatch`), порядок першої появи.
- `nudgeTargetIds` лишився як card-проєкція (`kind === "card"`), поведінка для карток та сама.

Запит на читання нічого не верифікує сам по собі — верифікує лише ledger за незмінним контрактом.

## 9. Checklist create

Nudge просить `trelloReadChecklist (action list_by_card, cardId <card>)`. Ledger приймає лише успішне, парсабельне читання тієї ж картки, що стартувало після результату create, з тим самим checklist id і назвою.

## 10. Checklist add_item

Nudge просить `trelloReadChecklist (action get, checklistId <checklist>)`. Ledger приймає лише успішне читання цього чекліста після результату конкретного add_item, чий результат — той самий checklist id і містить item id з тією ж назвою.

## 11. Dedup для кількох пунктів

4 × add_item в один чекліст → **один** `checklist_get`. create + 4 × add_item → рівно `list_by_card` + `get`. Якщо модель уже зробила `list_by_card` у своєму turn — nudge просить тільки `get` (тест). Одне пізніше читання `get` підтверджує всі чотири пункти (кожен outcome оцінюється окремо проти того самого читання; ordering per-write збережено — `get`, що стартував до результату пізнішого add_item, його не підтверджує, тест G').

## 12. Доказ відсутності replay запису

- Runtime ніколи не викликає Trello сам; єдине, що він надсилає, — один `user.message` з текстом (тест перевіряє: одна подія, тип `user.message`, один text-блок).
- Текст checklist-nudge: «НЕ повторюй жоден запис: не створюй чекліст, пункт чи картку ще раз і нічого не змінюй» і перелік **лише** read-інструментів; тест перевіряє відсутність `trelloWrite` у тексті.
- `failed` / `target_unknown` / `no_result` не nudgeable (тест для failed checklist write та `update_item`).

## 13. One-nudge-max

`MAX_VERIFICATION_NUDGES = 1` не змінено. Тести I / I': після nudge-rerun без достатніх читань — рівно 2 `send` (turn + 1 nudge), один `verification_nudge_sent`, один `write_unverified_failure`, `DjonikUnverifiedMutationError`; другого nudge немає.

## 14. Справжній unresolved-випадок

Fail-closed як і раніше: `DjonikUnverifiedMutationError` з повним `outcomes` і внутрішнім звітом; модельний текст не показується.

## 15. Санітизація Telegram

`src/telegramAdapter.ts`:

- `UNVERIFIED_MUTATION_TEXT = "⚠️ Зміна в Trello могла виконатися, але я не зміг надійно підтвердити результат. Перевір картку в Trello перед повторною спробою."`
- `formatUserFacingError` явно розпізнає `DjonikUnverifiedMutationError` (прямо або всередині `DjonikTracedTurnError`) і повертає лише цей рядок. Не каже «не виконано», не каже «успіх», без назв інструментів, Agent/Session id, ARI, id карток/чеклістів, назви класу, provider-тексту.
- Єдине, що дописується після рядка, — вже user-safe верифікований блок Project Health (#32), якщо він був у тому ж turn (`error.specialistSection`, нове readonly-поле); раніше він теж ішов у Telegram через `message`.
- Інші помилки — без змін (тест на точний текст звичайної помилки).

## 16. Внутрішня діагностика збережена

`DjonikUnverifiedMutationError.message` (з ARI і per-mutation звітом) і `.outcomes` не змінені; `telegramDispatch` як і раніше передає повну помилку в `logError` (тест перевіряє, що лог містить `Djonik mutated Trello`). Trace: `verification_nudge_sent` отримав content-free поле `readKinds: ("card" | "checklist_list" | "checklist_get")[]` — без id і без контенту; `write_unverified_failure` без змін.

## 17. Регресії card / due

- Card-only nudge має **точно** той самий текст #31 (тест на повний рядок + end-to-end тест card-write nudge).
- Префікс `Системна перевірка: у цьому turn є Trello-запис`, за яким `decisionTrace.explainRecordedTurn` розпізнає nudge, збережено в обох варіантах тексту.
- Ledger для `trelloWriteCard` (same-card direct read, sequential writes, label #37, due #23, `due_differs`, failed/unverified) не змінено. Усі існуючі тести `trelloMutationLedger`, `turnCompletion` (#23, #44 S11, #40), `mutationCommentary`, `djonikClient` проходять.

## 18. Forwarded-source регресія

Proposal binding, семантика підтвердження, forwarded authority і keyboard не змінювались (фікс починається після вже авторизованого запису). `forwardedDispatch`, `forwardedSource`, `proposalConfirmation` — зелені.

## 19. Змінені файли

| Файл | Зміна |
|---|---|
| `src/trelloMutationLedger.ts` | `VerificationRead`, `verificationReadsFor`, checklist nudgeable, `nudgeTargetIds` як card-проєкція |
| `src/djonikClient.ts` | `buildVerificationNudgeText(reads)` (card-only — старий текст), nudge-цикл через `verificationReadsFor`, trace `readKinds`, `DjonikUnverifiedMutationError.specialistSection` |
| `src/telegramAdapter.ts` | `UNVERIFIED_MUTATION_TEXT`, явна обробка unverified-помилки у `formatUserFacingError` |
| `src/trelloChecklistLedger.test.ts` | тести A–H, G', dedup, failed/unsupported, змішаний card+checklist |
| `src/checklistVerificationNudge.test.ts` (новий) | production-кейс через реальний `connectToDjonik` і реальний Telegram dispatch; I, I', J, санітизація |
| `src/telegramAdapter.test.ts` | тести `formatUserFacingError` |
| `docs/94_…` | цей звіт |

Skill, Agent, release tuple, `SERVING_RELEASE`, host config — не змінювались.

## 20. Focused тести

```
node --import tsx --test telegramAdapter checklistVerificationNudge trelloChecklistLedger trelloMutationLedger
  turnCompletion djonikClient forwardedDispatch forwardedSource proposalConfirmation mutationCommentary
  decisionTrace turnTrace toolConfirmationClient streamRecovery turnCorrelation
ℹ tests 437  ℹ pass 437  ℹ fail 0
```

Контроль: нові тест-файли на оригінальному коді (stash) падають.

## 21. typecheck / build / full / diff

- `npm run typecheck` — чисто.
- `npm run build` — чисто.
- `npm test` — `tests 1393, pass 1391, fail 2` (двічі поспіль): лише відомий Windows baseline — `deployConfig.test.ts` («deploy script survives replacing itself…») і `processExit.test.ts` («a real process that fetched over keep-alive…»). Baseline без моїх змін: `1371 / 1369 / 2`, ті самі два.
- Примітка чесно: в одному першому прогоні повного suite додатково впав `reminderDelivery.test.ts` («crash during the Telegram call…»). Файл не зачеплено; окремо 3/3 прогони 21/21, два наступні повні прогони — без нього. Трактую як timing-flake під навантаженням, не як регресію.
- `git diff --check` — чисто.

## 22. Production без змін

r30 / Agent v30 / revision `2c8ee827ac0283eec571337cc71371d3b5a5494a`, Working Rhythm OFF, r29 як rollback — не торкався.

## 23. `git status --short`

```
 M src/djonikClient.ts
 M src/telegramAdapter.test.ts
 M src/telegramAdapter.ts
 M src/trelloChecklistLedger.test.ts
 M src/trelloMutationLedger.ts
?? docs/94_ISSUE_56_CHECKLIST_VERIFICATION_PRODUCTION_FIX.md
?? src/checklistVerificationNudge.test.ts
```

## Обмеження / відкладене

1. **Live-форма відповіді `trelloReadChecklist` досі не виміряна** (так само зазначено в docs/85). Фікс виправляє випадок «модель не зробила read-back». Якщо ж у production модель `get` робила, але ledger не розпарсив відповідь (інша форма, напр. connection `checkItems: { nodes: [...] }`), або пункти прийшли з `field_unconfirmed`, — nudge не допоможе, turn знову fail-closed (тепер уже з безпечним текстом). Рекомендація перед acceptance: подивитися в production-логах рядок причини для чотирьох пунктів або прогнати `npm run turn:explain` по тій Session (read-only). Парсинг я не розширював навмання, щоб не ослабити контракт без доказу.
2. `update` / `update_item` не мають контракту верифікації (дозволені в toolConfirmation лише `create`/`add_item`): лишаються `target_unknown`, не nudgeable, fail-closed — як і до фіксу.
3. Інші шляхи, де `describeMutationOutcomes` з id може дійти до Telegram (`DjonikTurnIncompleteError`, `DjonikSpecialistUnverifiedError`, фінальна відповідь при `failed`-записі), не змінювались — поза межами цього bounded-фіксу; кандидат на окреме issue.

## Явно

- no commit; no push; no deploy;
- no host restart; no host config change;
- no Agent/Skill mutation; no Memory mutation;
- no production Trello test write;
- `docs/02` roadmap не редагувався; #56 лишається відкритим.
