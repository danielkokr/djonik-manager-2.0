# 95 — Issue #57: людське підтвердження чекліста без provider-enum

Статус: реалізовано в робочому дереві, **без commit / push / deploy**. Для review Product Lead.
Canonical NOW: #57 (`docs/02`, оновлення 2026-09-29). #57 лишається відкритим.

## 1. Production-симптом

Після успішного, верифікованого запису чекліста Telegram отримав:

> Підтверджено читанням: на картці «Банер» чекліст «Кроки» з трьома пунктами — «Варіанти банера з новими ароматами», «Драфти клієнту на затвердження», «Рендер на ніч». Усі три INCOMPLETE.

Запис і верифікація були правильні. Проблема: у звичайний текст потрапив сирий enum провайдера `INCOMPLETE` і механіка верифікації («Підтверджено читанням»).

## 2. Root cause

Класифікація: **A** (модель повторює enum із tool output), з внеском **C** (Skill це не забороняє). **B** (детермінований код) виключено.

Доказ по коду (main `dffcc37`):

- `grep` по `src/`: жоден runtime-код не форматує `INCOMPLETE`/`COMPLETE` чи поле `state` пункту чекліста (єдиний `INCOMPLETE_…` у `turnCorrelation.ts` — назва константи для незавершеного turn, не текст для користувача).
- Детермінований звіт `describeMutationOutcomes` має інший формат (`✅ Підтверджено читанням чекліста: …`) і на цьому шляху не використовується.
- Для turn, де всі мутації підтверджені й немає due, `finalizeMutationReplyWithMode` повертав `reply` — **власний текст моделі дослівно**.
- `trelloReadChecklist` — MCP-інструмент, що виконується на боці провайдера; його результат (пункти з `state: "INCOMPLETE"`) іде прямо в контекст моделі, runtime його переписати не може.
- `task-management` Skill (рядок 117) каже підтвердити id/текст пункту, але не забороняє переказувати enum; Skill закріплений у r30 за sha (`releaseR30.test.ts`, `e30e8aa1…`), тому зміна Skill = нова release (r31), що заборонено в цьому проході.

## 3. Відповідальний шар

Формулювання належить моделі; інструкцію змінити без релізу неможливо, tool result — теж. Найвужчий шар, що деплоїться в межах цього проходу: **фіналізація відповіді для верифікованих checklist-мутацій** (`finalizeMutationReplyWithMode`) — та сама межа, де #23/#44 вже зробили due-підтвердження code-owned. Загального санітайзера прози немає.

## 4. Чому це UX-полірування, а не надійність

Trello-стан, авторизація, верифікація, nudge і fail-closed були правильними. Змінюється лише текст успішної відповіді.

## 5. Обраний bounded-фікс

Новий модуль `src/checklistConfirmation.ts`:

- `buildChecklistConfirmation(outcomes)` — детермінований рядок лише з **верифікованих** checklist-outcome ledger: назва картки (якщо в цьому turn була успішна пряма читанка картки з назвою), назва чекліста, кількість і точні назви пунктів. Ніколи — стан пункту (ні enum, ні вигаданий переклад), id/ARI, назви інструментів, механіка читання. Групування за чеклістом. Формати:
  - `Готово. На «Банер» додав чекліст «Кроки» з трьома пунктами: «…», «…», «…».`
  - `Готово. На «Банер» додав чекліст «Кроки».` (без пунктів)
  - `Готово. У чекліст «Кроки» додав пункти: «…», «…».` (add_item у наявний чекліст; назва — з верифікуючого `get`)
  - без читанки картки — `Додав чекліст «Кроки» …` (назва картки опускається, id ніколи не підставляється).
  - Числівники 1–10 в орудному відмінку, далі цифрами.
- `composeChecklistReply` — текст моделі **ніколи не редагується**; він іде після блоку дослівно, або відкидається цілком (як #44):
  - `withheld_provider_state` — містить `COMPLETE`/`INCOMPLETE` (будь-який регістр; MCP і REST-варіант);
  - `withheld_restatement` — коли всі підтверджені мутації turn-у є checklist-мутаціями, а текст згадує чекліст/пункт або назву чекліста/пункту (блок уже це каже);
  - `redundant` — дослівно міститься в блоці (`Готово.`);
  - інакше `appended` (корисний коментар на кшталт «Раджу почати з …» лишається).
  - Якщо в turn є підтверджена мутація картки, відкидається лише текст з provider-лексикою (модель може звітувати про ту зміну).
- **Змішаний turn (PL review blocker, виправлено):** якщо в turn, крім checklist, є підтверджені НЕ-checklist мутації (поля картки, label проєкту; без due) і текст моделі НЕ показано (`withheld_*`, `redundant`, порожній текст або verified-specialist turn з `reply === null`), після checklist-блоку додається один детермінований рядок `otherVerifiedWritesLine`:
  - `Зміни картки «Банер v2» також підтверджені.` — назва береться лише з уже підтверджених outcome (підтверджена назва самого запису або назва картки, яку назвав verified checklist create); кілька карток — `Зміни карток «A», «B» також підтверджені.`;
  - якщо хоч одна з таких мутацій не має відомої назви — `Інші зміни в Trello також підтверджені.`;
  - ніколи id/ARI, назв інструментів, enum чи механіки; `describeMutationOutcomes` тут не використовується; текст моделі не парситься і не редагується.
  - Якщо текст моделі показано (`appended`), рядок не додається — поведінка як і раніше.
- Супутній display-фікс (#37): `withBorrowedCardName` давав label-запису «позичити» назву картки з будь-якого outcome тієї ж картки — зокрема з checklist-outcome, чий `label` = назва чекліста (тест label + checklist це виявив: «Зміни картки «Кроки»»). Тепер назва позичається лише з card-запису. Тільки відображення; статус/ідентичність без змін.
- Ledger (`trelloMutationLedger.ts`): до `outcome.checklist` додано **display-only** поля `cardName` (create) і `checklistName`; жодного впливу на статус, ідентичність чи порядок. `cardDisplayName` бере назву з уже наявних `validDirectReads`.
- `djonikClient.ts`: `finalizeMutationReplyWithMode` викликає це тільки коли є верифікований checklist-запис. Поруч із due-записом: спершу #23 due-блок (без змін), потім checklist-рядок (без другого «Готово.»); текст моделі мусить пройти обидва gate. Для verified-specialist turn (`reply === null`) замість id-звіту — checklist-блок. Новий content-free trace `checklist_confirmation_composed { mode }`. Поле `checklistCommentary` у поверненні присутнє лише на checklist-turn, тож існуючі due-тести (#44) пройшли **без змін**.

## 6. До / після

До (production):

> Підтверджено читанням: на картці «Банер» чекліст «Кроки» з трьома пунктами — «Варіанти банера з новими ароматами», «Драфти клієнту на затвердження», «Рендер на ніч». Усі три INCOMPLETE.

Після (той самий event-потік, тест):

> Готово. На «Банер» додав чекліст «Кроки» з трьома пунктами: «Варіанти банера з новими ароматами», «Драфти клієнту на затвердження», «Рендер на ніч».

Стан пунктів опущено навмисно (Daniel просив створити чекліст).

## 7. Архітектура запису/верифікації не змінена

- `trelloWriteChecklist` контракт, авторизація, proposal → confirmation, forwarded authority — не торкались.
- Checklist verification (`evaluateChecklistWrite`) — лише два `return`, що тепер додають display-поля до вже verified outcome; умови verified/unverified ідентичні.
- #56 nudge, dedup, `MAX_VERIFICATION_NUDGES = 1`, `buildVerificationNudgeText` — без змін (тест: nudge-шлях закінчується людським підтвердженням, `readKinds` ті самі).
- Unresolved → `DjonikUnverifiedMutationError` раніше, ніж фіналізація; блок будується лише з `isConfirmed` outcome.
- `failed` → авторитетний per-mutation звіт, як і раніше.
- Card/due/label — без змін; turn без checklist-запису повертає рівно те саме, що до фіксу (тест `deepEqual`).

## 8. Focused тести

Нові:

- `src/checklistConfirmation.test.ts` (11): create без пунктів; без читанки картки; add_item у наявний чекліст (1 і кілька пунктів, `COMPLETE` у read); стан ніколи не рендериться і не вигадується; числівники; неверифіковані → без блоку і fail-closed; усі режими gate; due + checklist; specialist-шлях; failed-звіт без змін; turn без чекліста byte-for-byte.
- `src/checklistVerificationNudge.test.ts` (+6, розділ #57): точний production-кейс через реальний `connectToDjonik`; той самий кейс через реальний Telegram dispatch; provider-лексика відкидається; корисний коментар лишається; #56 nudge-шлях → людське підтвердження; card-only відповідь без змін.
- `src/checklistConfirmation.test.ts` (+9, розділ «mixed», PL blocker): (1) checklist-only + enum → лише чистий блок; (2) card-only → відповідь моделі без змін (`deepEqual`); (3) card + checklist, чистий коментар → блок + коментар, без додаткового рядка; (4) card + checklist, коментар з `INCOMPLETE` (а також порожній і «Готово.») → коментар відкинуто, блок + «Зміни картки «Банер v2» також підтверджені.»; (5) label + checklist, відкинутий коментар → блок + рядок з назвою картки, без id; мутація без відомої назви → узагальнений рядок без id; specialist-шлях → блок + рядок; (6) due + checklist → #23 due-блок + checklist-рядок без змін; (7) failed/unresolved без змін.
- Оновлено 4 очікування в #56-тестах: відповідь тепер code-owned блок замість тексту моделі (nudge-асерти не змінювались).

Покриття пунктів 1–9 промпту: 1–4 — вище; 5 — #56 nudge-тести + новий; 6 — `checklistConfirmation` «only VERIFIED…» + #56 I/I'; 7 — `trelloMutationLedger`, `turnCompletion`, card-only тест; 8 — `mutationCommentary` (#44) без змін + due+checklist; 9 — `forwardedDispatch`, `forwardedSource`, `proposalConfirmation`.

```
node --import tsx --test checklistConfirmation checklistVerificationNudge trelloChecklistLedger trelloMutationLedger
  mutationCommentary turnCompletion djonikClient forwardedDispatch forwardedSource proposalConfirmation
  telegramAdapter decisionTrace turnCorrelation releaseR30 skills
ℹ tests 512  ℹ pass 512  ℹ fail 0
```

## 9. typecheck / build / full

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — `tests 1419, pass 1417, fail 2`: лише відомий Windows baseline (`deployConfig.test.ts` «deploy script survives replacing itself…», `processExit.test.ts` «a real process that fetched over keep-alive…»).

## 10. `git diff --check`

Чисто (exit 0).

## 11. Змінені файли

| Файл | Зміна |
|---|---|
| `src/checklistConfirmation.ts` (новий) | code-owned checklist-підтвердження, gate тексту моделі, `otherVerifiedWritesLine` |
| `src/djonikClient.ts` | інтеграція у `finalizeMutationReplyWithMode`, trace `checklist_confirmation_composed` |
| `src/trelloMutationLedger.ts` | display-only `cardName` / `checklistName` на verified checklist-outcome; `withBorrowedCardName` не позичає назву з checklist-outcome |
| `src/checklistConfirmation.test.ts` (новий) | unit-тести |
| `src/checklistVerificationNudge.test.ts` | e2e-тести #57; оновлені очікування відповіді #56 |
| `docs/95_…` | цей звіт |

## 12. `git status --short`

```
 M src/checklistVerificationNudge.test.ts
 M src/djonikClient.ts
 M src/trelloMutationLedger.ts
?? docs/95_ISSUE_57_HUMAN_CHECKLIST_CONFIRMATION_REPORT.md
?? src/checklistConfirmation.test.ts
?? src/checklistConfirmation.ts
```

## Обмеження / відкладене

1. Корінь у Skill (модель не знає, що не треба переказувати enum і механіку перевірки) лишається; для наступного релізу варто додати рядок у `task-management` (checklist-підтвердження code-owned, не повторювати його). Зараз це заборонено (sha-pin r30).
2. Змішаний turn: коли текст моделі відкинуто, про НЕ-checklist зміни каже лише узагальнений рядок («Зміни картки «X» також підтверджені.»), без деталізації полів. Це свідомо мінімальний детермінований fallback, а не новий UX мутацій.
3. Gate лексичний і консервативний (як #44): хибне спрацювання лише повертає чистий code-блок без коментаря моделі.
4. Id-звіт `describeMutationOutcomes` на шляхах помилок (`failed`, turn incomplete, specialist unverified) не змінювався — поза межами #57 (див. docs/94).

## Явно

- no commit; no push; no deploy;
- no Agent/Skill remote mutation; no Skill source change;
- no release change (r30 tuple, `SERVING_RELEASE` без змін);
- no production Trello mutation; no host config change; Working Rhythm config не торкався;
- `docs/02` не редагувався; #57 лишається відкритим.
