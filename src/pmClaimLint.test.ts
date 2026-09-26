import { test } from "node:test";
import assert from "node:assert/strict";
import { lintConcreteClaims } from "./pmClaimLint.js";

const empty = { slots: [], dueKnown: false } as const;
test("unsupported weekday/date and duration are normalized without reply text", () => {
  const findings = lintConcreteClaims("Показ клієнту в понеділок 05.10, це займе 15 хвилин.", { slots: [], dueKnown: false });
  assert.deepEqual(findings.map((f) => `${f.type}:${f.value}`), ["weekday:пн", "date:05.10", "duration:15хв", "client_expectation:показклієнт"]);
  assert.doesNotMatch(JSON.stringify(findings), /Показ|клієнту|займе/);
});
test("clock/evidence supports concrete slots; Daniel's available time is not task duration", () => {
  assert.deepEqual(lintConcreteClaims("Сьогодні пн 28.09. У мене є 2 години.", {
    slots: [{ type: "weekday", value: "пн", source: "clock" }, { type: "date", value: "28.09", source: "clock" }],
    availableMinutes: 120,
  }), []);
  assert.deepEqual(lintConcreteClaims("Задача займе 2 години.", { slots: [], availableMinutes: 120 }).map((f) => f.type), ["duration"]);
});
test("supported client expectation and missing due remain distinct", () => {
  assert.deepEqual(lintConcreteClaims("Клієнт чекає. Без due можна почекати.", {
    slots: [{ type: "client_expectation", value: "Клієнт чекає", source: "memory" }], dueKnown: false,
  }).map((f) => f.type), ["missing_due_inference"]);
  assert.deepEqual(lintConcreteClaims("Немає due, тому не терміново.", empty).map((f) => f.type), ["missing_due_inference"]);
});
