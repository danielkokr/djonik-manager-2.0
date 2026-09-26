import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  UnprocessableEntityError,
  APIError,
} from "@anthropic-ai/sdk";
import {
  CustomToolResolution,
  CustomToolResolutionError,
  EXECUTOR_EXCEPTION_CONTENT,
  isPermanentSendRejection,
  type CustomToolExecutor,
  type CustomToolResultEvent,
} from "./customToolResolution.js";

// Unit tests for the #40 Session-scoped custom-tool lifecycle (docs/30 §6). Every test asserts the
// executor invocation count equals the number of DISTINCT custom_tool_use_ids expected to execute.

const TOOL = "trello_work_history";

function harness(executorImpl?: CustomToolExecutor, sendErrors: unknown[] = []) {
  const table = new CustomToolResolution([TOOL]);
  const executed: unknown[] = [];
  const attempts: CustomToolResultEvent[][] = [];
  const executor: CustomToolExecutor = async (input, call) => {
    executed.push(input);
    return executorImpl ? executorImpl(input, call) : { isError: false, content: JSON.stringify({ echo: input }) };
  };
  const send = async (events: CustomToolResultEvent[]) => {
    attempts.push(JSON.parse(JSON.stringify(events)) as CustomToolResultEvent[]);
    const error = sendErrors.shift();
    if (error !== undefined) throw error;
  };
  return { table, executed, attempts, executor, send };
}

const headers = () => new Headers();

test("lifecycle: OBSERVED → EXECUTING → RESULT_READY → SUBMITTED → RESOLVED, executing exactly once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness(async () => {
    await gate;
    return { isError: false, content: "RESULT" };
  });
  h.table.observeUse({ id: "A", name: TOOL, input: { q: 1 } });
  assert.equal(h.table.state("A"), "OBSERVED");

  const first = h.table.resolveBlocking(["A"], h.executor, h.send);
  assert.equal(h.table.state("A"), "EXECUTING");
  // A repeated status while the executor is still running: no permission to execute again.
  const repeated = await h.table.resolveBlocking(["A"], h.executor, h.send);
  assert.deepEqual(repeated, { executed: [], submitted: [] });
  release();
  assert.deepEqual(await first, { executed: ["A"], submitted: [{ id: "A", isError: false }] });
  assert.equal(h.table.state("A"), "SUBMITTED");
  assert.deepEqual(h.table.result("A"), { isError: false, content: "RESULT" });

  // Repeated status after submission (the docs/29 case): still a no-op.
  assert.deepEqual(await h.table.resolveBlocking(["A"], h.executor, h.send), { executed: [], submitted: [] });
  h.table.observeResultEcho("A");
  assert.equal(h.table.state("A"), "RESOLVED");

  assert.equal(h.executed.length, 1, "executor invocation count === distinct ids (1)");
  assert.equal(h.attempts.length, 1, "one submission");
  assert.deepEqual(h.attempts[0], [
    { type: "user.custom_tool_result", custom_tool_use_id: "A", is_error: false, content: [{ type: "text", text: "RESULT" }] },
  ]);
});

test("lifecycle: a status naming a RESOLVED id is a visible inconsistency — no execution, no resend", async () => {
  const h = harness();
  h.table.observeUse({ id: "A", name: TOOL, input: {} });
  await h.table.resolveBlocking(["A"], h.executor, h.send);
  h.table.observeResultEcho("A");
  await assert.rejects(h.table.resolveBlocking(["A"], h.executor, h.send), (error: unknown) => {
    assert.ok(error instanceof CustomToolResolutionError);
    assert.match((error as Error).message, /already resolved/);
    return true;
  });
  assert.equal(h.executed.length, 1, "executor invocation count === distinct ids (1)");
  assert.equal(h.attempts.length, 1);

  // An echo for an id that was never executed (answered elsewhere) also forbids execution.
  const other = harness();
  other.table.observeUse({ id: "B", name: TOOL, input: {} });
  other.table.observeResultEcho("B");
  await assert.rejects(other.table.resolveBlocking(["B"], other.executor, other.send), /already resolved/);
  assert.equal(other.executed.length, 0, "executor invocation count === 0");
  assert.equal(other.attempts.length, 0);
});

test("lifecycle: two distinct ids are never merged, even with byte-identical name and input; a same-id replay is ignored", async () => {
  const h = harness();
  h.table.observeUse({ id: "A", name: TOOL, input: { same: true } });
  h.table.observeUse({ id: "B", name: TOOL, input: { same: true } });
  h.table.observeUse({ id: "A", name: TOOL, input: { replayed: "must not replace the first observation" } });
  const resolution = await h.table.resolveBlocking(["A", "B"], h.executor, h.send);
  assert.deepEqual(resolution.executed, ["A", "B"]);
  assert.deepEqual(h.executed, [{ same: true }, { same: true }], "executor invocation count === distinct ids (2)");
  assert.deepEqual(h.attempts[0].map((event) => event.custom_tool_use_id), ["A", "B"]);
});

test("lifecycle: partial blocking lists — only OBSERVED ids execute, each submitted once", async () => {
  const h = harness();
  h.table.observeUse({ id: "A", name: TOOL, input: 1 });
  h.table.observeUse({ id: "B", name: TOOL, input: 2 });
  await h.table.resolveBlocking(["A"], h.executor, h.send);
  const second = await h.table.resolveBlocking(["A", "B"], h.executor, h.send);
  assert.deepEqual(second, { executed: ["B"], submitted: [{ id: "B", isError: false }] });
  assert.deepEqual(await h.table.resolveBlocking(["B"], h.executor, h.send), { executed: [], submitted: [] });
  assert.deepEqual(h.executed, [1, 2], "executor invocation count === distinct ids (2)");
  assert.deepEqual(h.attempts.map((events) => events.map((event) => event.custom_tool_use_id)), [["A"], ["B"]]);
});

test("lifecycle: malformed, unobserved and unsupported blocking lists fail closed before executing anything", async () => {
  for (const [ids, pattern] of [
    [undefined, /malformed/],
    [[], /malformed/],
    [["A", "A"], /malformed/],
    [["A", 7], /malformed/],
    [["A", "missing"], /unsupported custom tool/],
    [["A", "X"], /unsupported custom tool/],
  ] as const) {
    const h = harness();
    h.table.observeUse({ id: "A", name: TOOL, input: {} });
    h.table.observeUse({ id: "X", name: "not_allowed", input: {} });
    await assert.rejects(h.table.resolveBlocking(ids, h.executor, h.send), pattern, JSON.stringify(ids));
    assert.equal(h.executed.length, 0, `${JSON.stringify(ids)}: executor invocation count === 0`);
    assert.equal(h.attempts.length, 0);
    assert.equal(h.table.state("A"), "OBSERVED", "a rejected list leaves a valid id untouched");
  }
});

test("lifecycle: an executor exception becomes ONE cached is_error result that is submitted, never a stranded Session", async () => {
  const h = harness(async () => {
    throw new Error("boom: internals");
  });
  h.table.observeUse({ id: "A", name: TOOL, input: {} });
  const resolution = await h.table.resolveBlocking(["A"], h.executor, h.send);
  assert.deepEqual(resolution, { executed: ["A"], submitted: [{ id: "A", isError: true }] });
  assert.deepEqual(h.table.result("A"), { isError: true, content: EXECUTOR_EXCEPTION_CONTENT });
  assert.equal(h.attempts[0][0].is_error, true);
  assert.equal(h.attempts[0][0].content[0].text, EXECUTOR_EXCEPTION_CONTENT);
  assert.equal(h.executed.length, 1, "executor invocation count === distinct ids (1)");
  assert.equal(h.table.state("A"), "SUBMITTED");
});

test("lifecycle: an unknown send outcome keeps the cached bytes; any later permitted resend carries exactly those bytes", async () => {
  const h = harness(undefined, [
    new APIConnectionError({ message: "reset" }),
    new APIConnectionTimeoutError({ message: "timeout" }),
  ]);
  h.table.observeUse({ id: "A", name: TOOL, input: { q: 1 } });
  await assert.rejects(h.table.resolveBlocking(["A"], h.executor, h.send), /could not confirm delivery/);
  assert.equal(h.table.state("A"), "SEND_UNKNOWN");
  assert.equal(h.attempts.length, 2, "first send + one bounded resend");
  const cached = h.table.result("A");

  // The provider still names A (it never received the result): only the cached result is resent.
  const later = await h.table.resolveBlocking(["A"], h.executor, h.send);
  assert.deepEqual(later, { executed: [], submitted: [{ id: "A", isError: false }] });
  assert.equal(h.table.state("A"), "SUBMITTED");
  assert.deepEqual(h.table.result("A"), cached);
  assert.equal(h.attempts.length, 3);
  assert.ok(h.attempts.every((attempt) => JSON.stringify(attempt) === JSON.stringify(h.attempts[0])), "byte-identical resends");
  assert.equal(h.executed.length, 1, "executor invocation count === distinct ids (1)");
});

test("lifecycle: a permanent 4xx is SEND_REJECTED — visible failure, no retry, no later resend or re-execution", async () => {
  const h = harness(undefined, [new BadRequestError(400, undefined, "bad", headers())]);
  h.table.observeUse({ id: "A", name: TOOL, input: {} });
  await assert.rejects(h.table.resolveBlocking(["A"], h.executor, h.send), /rejected the custom-tool result/);
  assert.equal(h.table.state("A"), "SEND_REJECTED");
  assert.equal(h.attempts.length, 1);
  await assert.rejects(h.table.resolveBlocking(["A"], h.executor, h.send), /previously rejected/);
  assert.equal(h.attempts.length, 1, "no retry loop");
  assert.equal(h.executed.length, 1, "executor invocation count === distinct ids (1)");
});

test("isPermanentSendRejection: permanent 4xx only; 408/409/429, 5xx, connection and unknown errors stay unknown", () => {
  assert.equal(isPermanentSendRejection(new BadRequestError(400, undefined, "x", headers())), true);
  assert.equal(isPermanentSendRejection(new AuthenticationError(401, undefined, "x", headers())), true);
  assert.equal(isPermanentSendRejection(new NotFoundError(404, undefined, "x", headers())), true);
  assert.equal(isPermanentSendRejection(new UnprocessableEntityError(422, undefined, "x", headers())), true);
  assert.equal(isPermanentSendRejection(new APIError(408, undefined, "x", headers())), false);
  assert.equal(isPermanentSendRejection(new ConflictError(409, undefined, "x", headers())), false);
  assert.equal(isPermanentSendRejection(new RateLimitError(429, undefined, "x", headers())), false);
  assert.equal(isPermanentSendRejection(new InternalServerError(500, undefined, "x", headers())), false);
  assert.equal(isPermanentSendRejection(new APIConnectionError({ message: "x" })), false);
  assert.equal(isPermanentSendRejection(new Error("x")), false);
});

test("lifecycle: an echo for an id this Session never observed changes nothing", () => {
  const table = new CustomToolResolution([TOOL]);
  table.observeResultEcho("ghost");
  assert.equal(table.has("ghost"), false);
  assert.equal(table.state("ghost"), undefined);
});
