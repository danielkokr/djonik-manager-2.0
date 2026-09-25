import { test } from "node:test";
import assert from "node:assert/strict";
import { APIConnectionTimeoutError, BadRequestError, InternalServerError } from "@anthropic-ai/sdk";
import {
  decideConfirmation,
  DENY_MESSAGES,
  REVIEWED_CONFIRMATION_TOOLS,
  ToolConfirmationError,
  ToolConfirmationLifecycle,
  type ConfirmationRequest,
  type ToolConfirmationEvent,
} from "./toolConfirmation.js";
import { mutationAuthorityFor, type TurnOrigin } from "./turnAuthority.js";

// #39 Stage 3A — unit tests of the deterministic confirmation policy and the Session-scoped lifecycle.
// Offline; provider shapes from SDK 0.125.0 (`user.tool_confirmation`, `evaluation`, `session_thread_id`).

const headers = () => new Headers();
const trelloWrite = (id = "sevt_w"): ConfirmationRequest => ({ id, kind: "mcp", name: "trelloWriteCard", serverName: "trello", evaluationType: "always_ask" });
const memoryWrite = (id = "sevt_m", name = "write"): ConfirmationRequest => ({ id, kind: "builtin", name, evaluationType: "always_ask" });

function sender(errors: unknown[] = []) {
  const sent: ToolConfirmationEvent[][] = [];
  return {
    sent,
    send: async (events: ToolConfirmationEvent[]) => {
      sent.push(events);
      const error = errors.shift();
      if (error !== undefined) throw error;
      return { data: events.map((_, index) => ({ id: `sevt_echo_${index}` })) };
    },
  };
}

test("turn authority: only Daniel's two origins are human; rhythm origins and anything unknown are read-only", () => {
  assert.equal(mutationAuthorityFor("user_message"), "human");
  assert.equal(mutationAuthorityFor("button_callback"), "human");
  assert.equal(mutationAuthorityFor("rhythm_ritual"), "autonomous_read_only");
  assert.equal(mutationAuthorityFor("rhythm_exception"), "autonomous_read_only");
  assert.equal(mutationAuthorityFor("something_else" as TurnOrigin), "autonomous_read_only", "fail closed");
});

test("policy: human + reviewed mutating tool on the primary thread under always_ask → allow", () => {
  for (const request of [trelloWrite(), memoryWrite(), memoryWrite("e", "edit")]) {
    assert.deepEqual(decideConfirmation(request, "human"), { decision: "allow", reason: "human_authority" });
  }
  // Docs: `evaluation` is absent on events recorded before it existed — read as always_ask.
  assert.equal(decideConfirmation({ ...trelloWrite(), evaluationType: undefined }, "human").decision, "allow");
  assert.equal(decideConfirmation({ ...trelloWrite(), evaluationType: null }, "human").decision, "allow");
});

test("policy: autonomous turns deny every gated tool — no exception for 'small' writes, input never consulted", () => {
  for (const request of [trelloWrite(), memoryWrite(), memoryWrite("e", "edit")]) {
    assert.deepEqual(decideConfirmation(request, "autonomous_read_only"), { decision: "deny", reason: "autonomous_read_only" });
  }
});

test("policy: anything outside the reviewed surface is denied even for Daniel (fail closed)", () => {
  const cases: Array<[ConfirmationRequest, string]> = [
    [{ id: "a", kind: "mcp", name: "trelloReadCard", serverName: "trello" }, "unreviewed_tool"],
    [{ id: "b", kind: "mcp", name: "trelloWriteList", serverName: "trello" }, "unreviewed_tool"],
    [{ id: "c", kind: "mcp", name: "create_event", serverName: "google-calendar-calendarmcp" }, "unreviewed_tool"],
    [{ id: "d", kind: "mcp", name: "trelloWriteCard", serverName: "evil" }, "unreviewed_tool"],
    [{ id: "e", kind: "mcp", name: "trelloWriteCard" }, "unreviewed_tool"],
    [{ id: "f", kind: "builtin", name: "bash" }, "unreviewed_tool"],
    [{ ...trelloWrite(), threadId: "sth_specialist" }, "subagent_thread"],
    [{ ...trelloWrite(), evaluationType: "auto" }, "unexpected_evaluation"],
    [{ ...trelloWrite(), evaluationType: "always_allow" }, "unexpected_evaluation"],
  ];
  for (const [request, reason] of cases) assert.deepEqual(decideConfirmation(request, "human"), { decision: "deny", reason }, request.name);
});

test("reviewed surface is exactly built-in write/edit + Trello trelloWriteCard (Calendar and other Trello writes excluded)", () => {
  assert.deepEqual(REVIEWED_CONFIRMATION_TOOLS, { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard"] } });
});

test("lifecycle: decision is made once at observation and is immutable — a replay under another authority keeps it", () => {
  const lifecycle = new ToolConfirmationLifecycle();
  assert.equal(lifecycle.observeRequest(trelloWrite("x"), "autonomous_read_only").decision, "deny");
  assert.equal(lifecycle.observeRequest(trelloWrite("x"), "human").decision, "deny", "never allow after deny");
  const other = new ToolConfirmationLifecycle();
  assert.equal(other.observeRequest(trelloWrite("y"), "human").decision, "allow");
  assert.equal(other.observeRequest(trelloWrite("y"), "autonomous_read_only").decision, "allow", "never deny after allow");
});

test("lifecycle: submit once; a repeated requires_action for a SUBMITTED id sends nothing; the echo resolves it", async () => {
  const lifecycle = new ToolConfirmationLifecycle();
  lifecycle.observeRequest(trelloWrite("w"), "human");
  const s = sender();
  const first = await lifecycle.resolveBlocking(["w"], s.send);
  assert.deepEqual(first.submitted.map((entry) => entry.record.decision), ["allow"]);
  assert.deepEqual(s.sent, [[{ type: "user.tool_confirmation", tool_use_id: "w", result: "allow" }]], "allow carries no deny_message");
  assert.equal(lifecycle.state("w"), "SUBMITTED");
  assert.deepEqual((await lifecycle.resolveBlocking(["w"], s.send)).submitted, []);
  assert.equal(s.sent.length, 1, "level-triggered status is not a new command");
  lifecycle.observeEcho("w", "allow");
  assert.equal(lifecycle.state("w"), "RESOLVED");
  await assert.rejects(lifecycle.resolveBlocking(["w"], s.send), ToolConfirmationError, "a request after the provider's own acknowledgement fails closed");
  assert.equal(s.sent.length, 1);
});

test("lifecycle: deny carries the fixed deny_message; several ids go in one request", async () => {
  const lifecycle = new ToolConfirmationLifecycle();
  lifecycle.observeRequest(trelloWrite("a"), "autonomous_read_only");
  lifecycle.observeRequest(memoryWrite("b"), "autonomous_read_only");
  const s = sender();
  await lifecycle.resolveBlocking(["a", "b"], s.send);
  assert.deepEqual(s.sent, [
    [
      { type: "user.tool_confirmation", tool_use_id: "a", result: "deny", deny_message: DENY_MESSAGES.autonomous_read_only },
      { type: "user.tool_confirmation", tool_use_id: "b", result: "deny", deny_message: DENY_MESSAGES.autonomous_read_only },
    ],
  ]);
});

test("lifecycle: a subagent-thread request is denied and routed back with its session_thread_id", async () => {
  const lifecycle = new ToolConfirmationLifecycle();
  lifecycle.observeRequest({ ...trelloWrite("t"), threadId: "sth_1" }, "human");
  const s = sender();
  await lifecycle.resolveBlocking(["t"], s.send);
  assert.deepEqual(s.sent[0], [{ type: "user.tool_confirmation", tool_use_id: "t", result: "deny", deny_message: DENY_MESSAGES.subagent_thread, session_thread_id: "sth_1" }]);
});

test("lifecycle: an unknown id fails closed without sending anything", async () => {
  const lifecycle = new ToolConfirmationLifecycle();
  const s = sender();
  await assert.rejects(lifecycle.resolveBlocking(["never_seen"], s.send), ToolConfirmationError);
  assert.equal(s.sent.length, 0);
});

test("lifecycle: permanent rejection → SEND_REJECTED, visible failure, never resent", async () => {
  const lifecycle = new ToolConfirmationLifecycle();
  lifecycle.observeRequest(trelloWrite("r"), "human");
  const s = sender([new BadRequestError(400, undefined, "x", headers())]);
  await assert.rejects(lifecycle.resolveBlocking(["r"], s.send), ToolConfirmationError);
  assert.equal(lifecycle.state("r"), "SEND_REJECTED");
  await assert.rejects(lifecycle.resolveBlocking(["r"], s.send), ToolConfirmationError);
  assert.equal(s.sent.length, 1);
});

test("lifecycle: ambiguous send → SEND_UNKNOWN, visible failure, NOT resent automatically — later echo still resolves it", async () => {
  for (const error of [new APIConnectionTimeoutError(), new InternalServerError(500, undefined, "x", headers()), new Error("socket")]) {
    const lifecycle = new ToolConfirmationLifecycle();
    lifecycle.observeRequest(trelloWrite("u"), "human");
    const s = sender([error]);
    await assert.rejects(lifecycle.resolveBlocking(["u"], s.send), /may or may not have been applied/);
    assert.equal(lifecycle.state("u"), "SEND_UNKNOWN");
    await assert.rejects(lifecycle.resolveBlocking(["u"], s.send), /does not resend/);
    assert.equal(s.sent.length, 1, "no duplicate confirmation after an ambiguous send");
    lifecycle.observeEcho("u", "allow");
    assert.equal(lifecycle.state("u"), "RESOLVED", "the provider's echo is authoritative");
  }
});

test("lifecycle: an echo with a different result than decided fails visibly (CONTRADICTED); foreign echoes carry no state", () => {
  const lifecycle = new ToolConfirmationLifecycle();
  lifecycle.observeRequest(trelloWrite("c"), "autonomous_read_only");
  assert.throws(() => lifecycle.observeEcho("c", "allow"), ToolConfirmationError);
  assert.equal(lifecycle.state("c"), "CONTRADICTED");
  lifecycle.observeEcho("foreign", "allow");
  assert.equal(lifecycle.has("foreign"), false);
});
