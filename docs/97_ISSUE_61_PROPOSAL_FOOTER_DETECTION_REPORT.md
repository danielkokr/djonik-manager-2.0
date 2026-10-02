# 97 — #61: Telegram-кнопки пропозиції губляться через дрейф форматування футера

Статус: реалізовано в source, **без commit / push / deploy**, #61 не закрито. Платного inference, Trello/Memory-дій чи remote Agent/Skill sync не було.

## 1. Підсумок

`isProposalReply()` тепер розпізнає фінальний рядок дій із нешкідливими відмінностями типографіки (`✅Внести · ✏️Змінити`, `✅ Внести · ✏️ Змінити`), але й далі вимагає, щоб **останній рядок відповіді складався лише з двох міток дій**. Довільна проза, текст після міток або відсутність однієї з дій клавіатуру не створюють.

## 2. Корінь проблеми (підтверджено з поточного коду)

- `src/proposalConfirmation.ts`: старий regex `/(?:^|\n)\s*✅\s*Внести\s+✏️\s*Змінити\s*$/u` вимагав хоча б один пробіл між `Внести` і `✏️` і не допускав жодного роздільника.
- Продакшн-футер `✅Внести · ✏️Змінити` містить `·` → `isProposalReply` = false.
- `src/telegramDispatch.ts` (`createGroupDispatchHandlers`) викликає `sendProposal(..., proposalKeyboard(ref))` лише коли `isProposalReply(reply)`; інакше — звичайний `sendMessage`. `src/telegramCli.ts:234` підтверджує, що лише `sendProposal` прикріплює inline keyboard.
- Розбіжностей з описом issue немає.

## 3. Змінені файли

- `src/proposalConfirmation.ts` — новий `PROPOSAL_FOOTER_RE`, той самий ліміт 3500 символів.
- `src/proposalConfirmation.test.ts` — unit-тест варіантів футера (+ негативні кейси).
- `src/telegramDispatch.test.ts` — інтеграційні тести dispatch для продакшн- і канонічного футера та для непропозиції.

## 4. Архітектурні / API рішення

- Вузький детермінований regex, без протокольного маркера: структурованого сигналу пропозиції в поточній архітектурі немає, а введення його — це вже redesign протоколу (поза #61).
- Новий regex: `/(?:^|\n)\s*✅\s*Внести\s*(?:[·•|]\s*)?✏️?\s*Змінити\s*$/u`
  - якорі: початок рядка й кінець тексту (лише фінальний рядок);
  - обидві точні мітки обов'язкові, у фіксованому порядку;
  - допускаються: пробіли (зокрема їх відсутність), **щонайбільше один** роздільник з `·`, `•`, `|`, необов'язковий variation selector U+FE0F на `✏`.
- `sendProposal` / `proposalKeyboard` / `ProposalConfirmations` / callback-формат `fp1:*` не змінювались. Видимий текст пропозиції не змінюється й не обрізається.

## 5. Поведінка до / після

| Фінальний рядок | До | Після |
|---|---|---|
| `✅ Внести  ✏️ Змінити` | кнопки | кнопки |
| `✅Внести · ✏️Змінити` (продакшн) | plain text | кнопки |
| `✅ Внести · ✏️ Змінити` | plain text | кнопки |
| `✅ Внести \| ✏️ Змінити`, `✅ Внести · ✏ Змінити` | plain text | кнопки |
| `У джерелі сказано ✅ Внести і ✏️ Змінити, але …` | plain text | plain text |
| мітки + ще текст після них | plain text | plain text |
| лише одна з міток / `· ·` / `і` між мітками / мітки без емодзі | plain text | plain text |
| > 3500 символів | plain text | plain text |

## 6. Тести та перевірки

- Фокусні: `node --import tsx --test src/proposalConfirmation.test.ts src/telegramDispatch.test.ts src/forwardedDispatch.test.ts src/voiceInput.test.ts` → **tests 61, pass 61, fail 0**.
- Контрольна перевірка: зі старим regex (stash лише `proposalConfirmation.ts`) нові тести #61 падають (unit + dispatch для продакшн-футера: **pass 15, fail 2**); з виправленням — проходять.
- `npm test` → **tests 1432, pass 1430, fail 2**. Два падіння — `deployConfig.test.ts` («deploy script survives replacing itself…») та `processExit.test.ts` («a real process that fetched over keep-alive…») — **вже існують на чистому baseline** (перевірено зі stash усіх змін у `src/`: pass 12, fail 2) і не пов'язані з #61 (Windows-середовище).
- `npm run build` → exit 0.
- `npm run typecheck` → exit 0.
- `git diff --check` → без зауважень.

## 7. Регресії / безпека

- Dispatch-тест для продакшн-футера: `sendProposal` рівно один раз, `sendMessage` — нуль разів, клавіатура — дві кнопки `✅ Внести`/`✏️ Змінити` з одним `ref`; пропозиція зареєстрована, прив'язана до `message_id` (клік по іншому id → stale), apply спрацьовує один раз, повтор → stale.
- Непропозиція зі згадкою міток іде через `sendMessage`, нічого не реєструє.
- Stale / TTL / modify / apply, #48 forwarded-флоу, #49 голосова безпека — існуючі тести зелені.
- Ризик розширення мінімальний: допуск лише в межах фінального рядка, лише пробіли/один роздільник; `register()` використовує ту саму функцію, тож другого реєстру чи механізму не з'явилось.

## 8. Обмеження / відкладене

- Інші дрейфи (markdown-жирний `**✅ Внести**`, інший порядок міток, інші роздільники на кшталт `—`/`/`, переклад міток) свідомо **не** підтримуються — додавати лише за реальними доказами.
- Структурований маркер пропозиції (замість regex по прозі) — можливий окремий issue, не #61.
- Живу перевірку в Telegram виконує Daniel після авторизованого deploy.

## 9. `git diff --check`

Без виводу (exit 0).

## 10. `git status --short`

```
 M src/proposalConfirmation.test.ts
 M src/proposalConfirmation.ts
 M src/telegramDispatch.test.ts
?? docs/97_ISSUE_61_PROPOSAL_FOOTER_DETECTION_REPORT.md
?? docs/DJONIK_POST_MVP_INTELLIGENCE_AND_WORKFLOW_AUDIT.md
```
