import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPollingFailure, createShutdownCoordinator, INTERRUPTED_TURN_NOTICE, type ShutdownDeps } from "./servingLifecycle.js";

// #33 graceful stop: stop polling → flush accepted fragments → drain in-flight turns (bounded) → honest
// notice on timeout → close. Deterministic: sleeps are driven by the test, not the wall clock.

function harness(overrides: Partial<ShutdownDeps> & { turn?: Promise<void> } = {}) {
  const steps: string[] = [];
  const notices: Array<{ chatId: number; text: string }> = [];
  const timers: Array<() => void> = [];
  const deps: ShutdownDeps = {
    stopPolling: async () => steps.push("stopPolling"),
    pollingDone: async () => steps.push("pollingDone"),
    flushIntake: () => steps.push("flushIntake"),
    intakeIdle: async () => {
      steps.push("intakeIdle");
      await (overrides.turn ?? Promise.resolve());
    },
    inFlightChatIds: () => [42],
    notify: async (chatId, text) => notices.push({ chatId, text }),
    closeSession: () => steps.push("closeSession"),
    log: (line) => steps.push(`log:${line.split(" ")[0]} ${line.split(" ")[1]}`),
    drainMs: 120_000,
    sleep: () => new Promise<void>((resolve) => timers.push(resolve)),
    ...overrides,
  };
  return { deps, steps, notices, fireTimers: () => timers.splice(0).forEach((fire) => fire()) };
}

test("graceful stop runs in order and does not notify when every turn finished", async () => {
  const { deps, steps, notices } = harness();
  const result = await createShutdownCoordinator(deps).shutdown("SIGTERM", 0);
  assert.deepEqual(result, { exitCode: 0, drained: true, interruptedChats: 0 });
  assert.deepEqual(steps.filter((s) => !s.startsWith("log:")), ["stopPolling", "pollingDone", "flushIntake", "intakeIdle", "closeSession"]);
  assert.deepEqual(notices, []);
});

test("polling stops before the buffer is flushed, and the Session closes only after the drain", async () => {
  let finishTurn: () => void = () => {};
  const turn = new Promise<void>((resolve) => (finishTurn = resolve));
  const { deps, steps } = harness({ turn });
  const done = createShutdownCoordinator(deps).shutdown("SIGTERM", 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(steps.indexOf("stopPolling") < steps.indexOf("flushIntake"));
  assert.ok(!steps.includes("closeSession"), "the in-flight turn still needs its stream");
  finishTurn();
  assert.equal((await done).drained, true);
  assert.equal(steps.at(-2), "closeSession");
});

test("drain timeout: each in-flight chat gets one honest notice (check before repeating), then close", async () => {
  const { deps, notices, steps, fireTimers } = harness({ turn: new Promise(() => {}), inFlightChatIds: () => [42, 43] });
  const done = createShutdownCoordinator(deps).shutdown("SIGTERM", 0);
  // Resolve every bounded wait: step waits for polling finish on their own; the drain waits for a timer.
  for (let i = 0; i < 5 && notices.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    fireTimers();
  }
  const result = await done;
  assert.deepEqual(result, { exitCode: 0, drained: false, interruptedChats: 2 });
  assert.deepEqual(notices.map((n) => n.chatId), [42, 43]);
  assert.equal(notices[0].text, INTERRUPTED_TURN_NOTICE);
  assert.match(INTERRUPTED_TURN_NOTICE, /перевір/, "the notice asks to verify, never invites a blind resend");
  assert.ok(steps.includes("closeSession"));
});

test("a failing stopPolling or notify never prevents the rest of the shutdown", async () => {
  const { deps, steps } = harness({
    stopPolling: async () => {
      throw new Error("network");
    },
  });
  const result = await createShutdownCoordinator(deps).shutdown("SIGTERM", 0);
  assert.equal(result.drained, true);
  assert.ok(steps.includes("closeSession"));
});

test("shutdown is single-flight: a second trigger joins the first and keeps its reason/exit code", async () => {
  const { deps, steps } = harness();
  const coordinator = createShutdownCoordinator(deps);
  assert.equal(coordinator.stopping, false);
  const first = coordinator.shutdown("telegram_conflict_another_poller", 75);
  const second = coordinator.shutdown("SIGTERM", 0);
  assert.equal(coordinator.stopping, true);
  assert.equal(first, second);
  assert.equal((await second).exitCode, 75);
  assert.equal(steps.filter((s) => s === "closeSession").length, 1);
});

test("the shutdown log is content-free", async () => {
  const lines: string[] = [];
  const { deps } = harness({ log: (line) => lines.push(line) });
  await createShutdownCoordinator(deps).shutdown("SIGTERM", 0);
  assert.deepEqual(lines, ["[shutdown] begin reason=SIGTERM drain_ms=120000", "[shutdown] end drained=true interrupted_chats=0 exit=0"]);
});

test("polling failures map to supervisor-meaningful exit codes (409 = another poller, never serve twice)", () => {
  assert.deepEqual(classifyPollingFailure({ error_code: 409 }), { reason: "telegram_conflict_another_poller", exitCode: 75 });
  assert.deepEqual(classifyPollingFailure({ error_code: 401 }), { reason: "telegram_unauthorized", exitCode: 78 });
  assert.deepEqual(classifyPollingFailure(new Error("x")), { reason: "polling_failed", exitCode: 1 });
});
