import { test } from "node:test";
import assert from "node:assert/strict";
import { composeVerifiedDueReply, mentionsCalendar, mentionsDueMutationClaim } from "./mutationCommentary.js";
import { buildVerifiedDueConfirmation, computeKyivDueFacts, finalizeMutationReply, finalizeMutationReplyWithMode } from "./djonikClient.js";
import type { MutationOutcome } from "./trelloMutationLedger.js";

// #44 — S11 mixed verified-write blocker. The #23 due confirmation stays code-owned and first; the model's own text may
// follow it verbatim only through one binary gate. These tests pin the gate and every mutation shape it applies to.

const FRI = "2026-10-02T15:00:00.000Z"; // Kyiv: пʼятниця, 2 жовтня 2026, 18:00
const THU = "2026-10-01T15:00:00.000Z"; // Kyiv: четвер, 1 жовтня 2026, 18:00
const confirmed = (id: string, card: string, due?: { intendedDue: string; verifiedDue: string }, label: string | null = null): MutationOutcome => ({
  toolUseId: id,
  status: due && due.intendedDue !== due.verifiedDue ? "due_differs" : "verified",
  targetCardIds: [card],
  label,
  unconfirmedFields: [],
  superseded: false,
  ...(due ? { due } : {}),
});
const FRI_SENTENCE = buildVerifiedDueConfirmation({ intendedDue: FRI, verifiedFacts: computeKyivDueFacts(FRI)! });
const PROJECT_VIEW = "По Seqthera: концепт у роботі, фідбек клієнта в Waiting — це очікування, не блокер. Далі — концепт.";

test("gate lexicon: weekdays, dates, times, relative days and spans are calendar references", () => {
  for (const text of [
    "поставив на пʼятницю", "п'ятниця", "у середу", "в четвер", "до пт", "Friday", "2 жовтня", "02.10", "2.10.2026",
    "2026-10-02", "о 18:00", "сьогодні", "завтра", "післязавтра", "вчора", "наступного тижня", "через 3 дні", "через два тижні",
  ]) assert.equal(mentionsCalendar(text), true, text);
});

test("gate lexicon: an ordinary project view is not a calendar reference (no «серед» / checklist / count false positive)", () => {
  for (const text of [PROJECT_VIEW, "серед карток Seqthera головне — концепт", "чекліст 1/4, лишилось три пункти", "Waiting — не блокер",
    "концепт у роботі, сайт у черзі", "Size: не вказано"]) {
    assert.equal(mentionsCalendar(text), false, text);
  }
});

test("compose: the code block always leads verbatim; commentary is never edited, only appended or withheld whole", () => {
  assert.deepEqual(composeVerifiedDueReply("BLOCK", "", false), { text: "BLOCK", mode: "none" });
  assert.deepEqual(composeVerifiedDueReply("BLOCK", null, false), { text: "BLOCK", mode: "none" });
  assert.deepEqual(composeVerifiedDueReply("BLOCK", "  Далі — концепт.  ", false), { text: "BLOCK\n\nДалі — концепт.", mode: "appended" });
  assert.deepEqual(composeVerifiedDueReply("BLOCK", "Далі — концепт, дедлайн у пт.", false), { text: "BLOCK", mode: "withheld_calendar" });
  assert.deepEqual(composeVerifiedDueReply("BLOCK", "Далі — концепт.", true), { text: "BLOCK", mode: "withheld_mismatch" });
  assert.deepEqual(composeVerifiedDueReply("Готово. Trello підтвердив дедлайн: X.", "Готово!", false), { text: "Готово. Trello підтвердив дедлайн: X.", mode: "redundant" });
});

test("A pure due write: the exact #23 sentence alone — model silence, «Готово.» or a restated date adds nothing", () => {
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  assert.equal(FRI_SENTENCE, "Готово. Trello підтвердив дедлайн: пʼятниця, 2 жовтня 2026, 18:00 за Києвом.");
  for (const [reply, mode] of [["", "none"], ["Готово.", "redundant"], ["Готово, поставив дедлайн на пт 2 жовтня.", "withheld_calendar"],
    ["Поставив на четвер, 2 жовтня.", "withheld_calendar"]] as const) {
    assert.deepEqual(finalizeMutationReplyWithMode(reply, outcomes), { text: FRI_SENTENCE, dueCommentary: mode }, reply);
  }
});

test("B mixed read + due write: the verified due sentence, then the project view — one reply, one due statement", () => {
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  const result = finalizeMutationReplyWithMode(PROJECT_VIEW, outcomes);
  assert.equal(result.text, `${FRI_SENTENCE}\n\n${PROJECT_VIEW}`);
  assert.equal(result.dueCommentary, "appended");
  assert.equal(result.text.split("Trello підтвердив дедлайн").length - 1, 1, "exactly one statement of what Trello saved");
  // If the same view also restates the date (right or wrong), the whole commentary is withheld: never two due statements.
  assert.equal(finalizeMutationReply(`${PROJECT_VIEW} Дедлайн — чт 1.10.`, outcomes), FRI_SENTENCE);
});

test("C verified mismatch: the deterministic mismatch sentence stands alone; commentary can neither hide nor soften it", () => {
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: THU }, "Концепт")];
  const expected = "Картку оновлено, але Trello підтвердив дедлайн: четвер, 1 жовтня 2026, 18:00 за Києвом. Це відрізняється від значення, яке було відправлено.";
  for (const reply of ["Все як просив, готово.", PROJECT_VIEW, "Поставив на пʼятницю 2 жовтня."]) {
    assert.deepEqual(finalizeMutationReplyWithMode(reply, outcomes), { text: expected, dueCommentary: "withheld_mismatch" }, reply);
  }
});

test("D failed write: the tool error report is authoritative; model success prose is never shown", () => {
  const failed: MutationOutcome = { toolUseId: "w", status: "failed", targetCardIds: ["card_seq"], label: "Концепт", unconfirmedFields: [], superseded: false, errorText: "invalid due" };
  const result = finalizeMutationReplyWithMode(`Готово! ${PROJECT_VIEW}`, [failed]);
  assert.match(result.text, /^❌ Не виконано \(помилка інструмента\)/);
  assert.ok(!result.text.includes("Готово") && !result.text.includes("По Seqthera"));
  assert.equal(result.dueCommentary, null);
});

test("E multiple mutations: every confirmed mutation keeps its deterministic line; the same gate governs commentary", () => {
  const twoDues = [confirmed("w1", "card_a", { intendedDue: FRI, verifiedDue: FRI }, "Концепт"), confirmed("w2", "card_b", { intendedDue: THU, verifiedDue: THU }, "Сайт")];
  const block = finalizeMutationReply("", twoDues);
  assert.equal(block.split("\n").length, 2);
  assert.match(block, /Концепт.*пʼятниця, 2 жовтня 2026, 18:00/);
  assert.match(block, /Сайт.*четвер, 1 жовтня 2026, 18:00/);
  assert.equal(finalizeMutationReply(PROJECT_VIEW, twoDues), `${block}\n\n${PROJECT_VIEW}`);
  assert.equal(finalizeMutationReply("Обидва дедлайни на цьому тижні: пт і чт.", twoDues), block, "a date restatement is withheld");

  const dueAndRename = [confirmed("w1", "card_a", { intendedDue: FRI, verifiedDue: FRI }, "Концепт"), confirmed("w2", "card_b", undefined, "Сайт")];
  const mixedBlock = finalizeMutationReply("", dueAndRename);
  assert.match(mixedBlock, /Сайт.*Зміни підтверджено читанням картки\./);
  assert.equal(finalizeMutationReply(PROJECT_VIEW, dueAndRename), `${mixedBlock}\n\n${PROJECT_VIEW}`);

  const oneMismatch = [confirmed("w1", "card_a", { intendedDue: FRI, verifiedDue: THU }, "Концепт"), confirmed("w2", "card_b", undefined, "Сайт")];
  assert.deepEqual(finalizeMutationReplyWithMode(PROJECT_VIEW, oneMismatch).dueCommentary, "withheld_mismatch");

  // A non-due write keeps the model's reply exactly as before (#31 unchanged): no code block, no gate.
  assert.deepEqual(finalizeMutationReplyWithMode("Перейменував сайт у пт.", [confirmed("w", "card_b", undefined, "Сайт")]),
    { text: "Перейменував сайт у пт.", dueCommentary: null });
});

test("F r29 specialist path: a turn holding a verified specialist result passes no model text, so the due block stays alone", () => {
  // `composeWithSpecialist` calls finalizeMutationReply(null, …): unchanged #32/#23 behaviour on the rollback path.
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  assert.deepEqual(finalizeMutationReplyWithMode(null, outcomes), { text: FRI_SENTENCE, dueCommentary: "none" });
});

test("commentary contract: task-management tells the model what the gate enforces (r30-only Skill source, no new pin)", async () => {
  const { readFileSync } = await import("node:fs");
  const { RELEASE_R30_CANDIDATE } = await import("./release.js");
  const skill = readFileSync(new URL("../.claude/skills/task-management/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const section = skill.split("## Due-date wording after a verified write\n")[1]?.split("\n## ")[0] ?? "";
  assert.match(section, /runtime puts that confirmation first/i);
  assert.match(section, /do not confirm the write or restate the saved date yourself/i);
  assert.match(section, /rest of Daniel's request \(a project view, the next step\) or add nothing/i);
  assert.match(section, /shown only if it names no date, weekday, time or relative day/i);
  assert.match(section, /no claim of its own about the deadline or whether the change was saved/i);
  // task-management is already an unresolved r30 Skill; serving r29 keeps its pinned version.
  assert.ok(RELEASE_R30_CANDIDATE.skills.some((entry) => entry.name === "task-management" && entry.pin.kind === "unresolved"));
});

// --- #44 PL review: the mutation-result guard (no calendar words, still a competing claim) ----------------------------

test("mutation-result guard: the model's own claims about the due or a write's result are withheld, with no calendar word", () => {
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  for (const reply of [
    "Дедлайн не зберігся.", "Дедлайн встановлено.", "Я поставив дедлайн.", "Trello не оновив картку.", "Зміни не записались.",
    "Але дедлайн не зберігся.", "Картку змінено, все ок.", "Переніс, як просив.", "Підтверджую, готово з карткою.",
    "The deadline was not saved.", "Due date updated.", "I failed to update the card.",
  ]) {
    assert.equal(mentionsCalendar(reply), false, `calendar-free: ${reply}`);
    assert.equal(mentionsDueMutationClaim(reply), true, reply);
    assert.deepEqual(finalizeMutationReplyWithMode(reply, outcomes), { text: FRI_SENTENCE, dueCommentary: "withheld_mutation_claim" }, reply);
  }
});

test("mutation-result guard: useful project commentary with no due/write claim is still appended", () => {
  const outcomes = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  for (const view of [
    "По Seqthera концепт у роботі, наступний крок — доробити варіант упаковки.",
    "По проєкту є один ризик: клієнтський review залежить від незавершеного концепту.",
    PROJECT_VIEW,
    "Клієнт просив зміни у фоні — це в картці концепту.",
  ]) {
    assert.equal(mentionsDueMutationClaim(view), false, view);
    assert.deepEqual(finalizeMutationReplyWithMode(view, outcomes), { text: `${FRI_SENTENCE}\n\n${view}`, dueCommentary: "appended" }, view);
  }
});

test("guards stay independent: calendar first, then mutation claim; a mismatch still withholds everything", () => {
  const ok = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: FRI }, "Концепт")];
  assert.equal(finalizeMutationReplyWithMode("По Seqthera: огляд у пт.", ok).dueCommentary, "withheld_calendar", "calendar guard alone");
  assert.equal(finalizeMutationReplyWithMode("Дедлайн поставив на пт.", ok).dueCommentary, "withheld_calendar");
  const mismatch = [confirmed("w", "card_seq", { intendedDue: FRI, verifiedDue: THU }, "Концепт")];
  for (const reply of ["Дедлайн встановлено.", "По Seqthera концепт у роботі, наступний крок — доробити варіант упаковки."]) {
    assert.equal(finalizeMutationReplyWithMode(reply, mismatch).dueCommentary, "withheld_mismatch", reply);
  }
  // Pure due write stays the exact #23 sentence; the r29 specialist path (null text) is untouched.
  assert.equal(finalizeMutationReply("Дедлайн встановлено, готово.", ok), FRI_SENTENCE);
  assert.deepEqual(finalizeMutationReplyWithMode(null, ok), { text: FRI_SENTENCE, dueCommentary: "none" });
  // A non-due write keeps #31 behaviour: no gate at all.
  assert.equal(finalizeMutationReply("Перейменував і оновив картку.", [confirmed("w", "card_b", undefined, "Сайт")]), "Перейменував і оновив картку.");
});
