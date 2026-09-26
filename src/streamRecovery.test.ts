import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIError, NotFoundError } from "@anthropic-ai/sdk";
import {
  connectToDjonik,
  DjonikSessionDeadError,
  type DjonikTraceEvent,
  type DjonikTracedSessionHandle,
  type DjonikTurnTelemetry,
  type StreamLifecycleEvent,
} from "./djonikClient.js";
import { classifyPendingMessage, SessionEventFeed, type FeedEvent, type SessionEventApi } from "./sessionEventFeed.js";
import {
  SESSION_LOST_CHECK_TEXT,
  SESSION_LOST_RESEND_TEXT,
  createSessionManager,
  formatUserFacingError,
  runWithSessionRecovery,
  type SessionRecoveryEvent,
} from "./telegramAdapter.js";
import { createSessionTurnRunner } from "./rhythmRuntime.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";
import type { GroupedIntake } from "./messageGrouping.js";
import { AutonomousTurnFailure } from "./rhythmRunner.js";

/**
 * Issue #53 offline regression suite. A fake Managed Agents "server" keeps each Session's persisted event
 * history (what `events.list` returns), delivers new events only to the currently open stream (what
 * `events.stream` does — no replay), and lets a test drop that stream, emit events while nothing is
 * listening, terminate or delete the Session, and fail reconnect steps. Assertions are about behaviour:
 * which reply Daniel gets, what was sent to which Session, how often a tool executed.
 */

type Ev = { type: string; id?: string; [key: string]: unknown };

class FakeStream {
  private readonly queue: Ev[] = [];
  private readonly waiters: Array<{ resolve: (r: IteratorResult<Ev>) => void; reject: (e: unknown) => void }> = [];
  private ended = false;
  private failure: unknown = null;
  readonly controller = { abort: () => this.end() };

  get open(): boolean {
    return !this.ended && this.failure === null;
  }

  push(event: Ev): void {
    if (!this.open) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.queue.push(event);
  }

  /** The connection closes cleanly; already-buffered events are still read first. */
  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  /** The connection breaks; buffered, unread events are lost with it. */
  fail(error: unknown = new TypeError("terminated")): void {
    this.failure = error;
    this.queue.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<Ev> {
    return {
      next: () => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.failure !== null) return Promise.reject(this.failure);
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

class FakeSession {
  readonly history: Ev[] = [];
  private seq = 0;
  status = "idle";
  gone = false;
  current: FakeStream | null = null;
  streamsOpened = 0;
  /** Every `events.send` batch, in order. */
  readonly sent: Ev[][] = [];
  retrieveFailures = 0;
  streamOpenFailures = 0;
  listFailures = 0;
  /** A send answered with an HTTP 400 (not accepted). */
  refuseSends = false;
  /** A new stream first re-delivers the whole history (overlap between list and live stream). */
  replayOnOpen = false;
  onUserMessage?: (session: FakeSession, message: Ev) => void;
  onCustomToolResult?: (session: FakeSession, id: string) => void;
  onConfirmation?: (session: FakeSession, toolUseId: string) => void;

  constructor(readonly id: string) {}

  emit(event: Ev): Ev {
    const persisted = { ...event, id: event.id ?? `evt_${this.id}_${++this.seq}` };
    this.history.push(persisted);
    this.current?.push(persisted);
    return persisted;
  }

  drop(how: "end" | "error" = "error"): void {
    if (how === "end") this.current?.end();
    else this.current?.fail();
    this.current = null;
  }

  terminate(): void {
    this.status = "terminated";
    this.emit({ type: "session.status_terminated" });
  }

  userMessages(): number {
    return this.sent.flat().filter((event) => event.type === "user.message").length;
  }

  sentOfType(type: string): Ev[] {
    return this.sent.flat().filter((event) => event.type === type);
  }

  async retrieve(): Promise<{ id: string; status: string }> {
    if (this.gone) throw new NotFoundError(404, {}, "not found", new Headers());
    if (this.retrieveFailures > 0) {
      this.retrieveFailures -= 1;
      throw new APIConnectionError({ message: "connection reset" });
    }
    return { id: this.id, status: this.status };
  }

  async openStream(): Promise<FakeStream> {
    if (this.gone) throw new NotFoundError(404, {}, "not found", new Headers());
    if (this.streamOpenFailures > 0) {
      this.streamOpenFailures -= 1;
      throw new APIConnectionError({ message: "connection reset" });
    }
    const stream = new FakeStream();
    this.current = stream;
    this.streamsOpened += 1;
    if (this.replayOnOpen) for (const event of this.history) stream.push(event);
    return stream;
  }

  async *list(): AsyncGenerator<Ev> {
    if (this.gone) throw new NotFoundError(404, {}, "not found", new Headers());
    if (this.listFailures > 0) {
      this.listFailures -= 1;
      throw new APIConnectionError({ message: "connection reset" });
    }
    for (const event of [...this.history]) yield event;
  }

  async send(params: { events: Ev[] }): Promise<{ data: Ev[] }> {
    this.sent.push(params.events);
    if (this.refuseSends || this.status === "terminated") throw APIError.generate(400, {}, "session is not accepting events", new Headers());
    const data: Ev[] = [];
    for (const event of params.events) {
      if (event.type === "user.message") {
        const echo = this.emit({ type: "user.message", content: event.content, processed_at: null });
        data.push(echo);
        setImmediate(() => this.onUserMessage?.(this, echo));
      } else if (event.type === "user.custom_tool_result") {
        const id = event.custom_tool_use_id as string;
        data.push(this.emit({ type: "user.custom_tool_result", custom_tool_use_id: id }));
        setImmediate(() => this.onCustomToolResult?.(this, id));
      } else if (event.type === "user.tool_confirmation") {
        const id = event.tool_use_id as string;
        data.push(this.emit({ type: "user.tool_confirmation", tool_use_id: id, result: event.result }));
        setImmediate(() => this.onConfirmation?.(this, id));
      }
    }
    return { data };
  }
}

function createWorld(configure: (session: FakeSession, index: number) => void = () => {}) {
  const sessions: FakeSession[] = [];
  const byId = (id: string) => {
    const found = sessions.find((session) => session.id === id);
    if (!found) throw new Error(`unknown session ${id}`);
    return found;
  };
  const client = {
    beta: {
      sessions: {
        create: async () => {
          const session = new FakeSession(`sesn_${sessions.length + 1}`);
          sessions.push(session);
          configure(session, sessions.length - 1);
          return { id: session.id };
        },
        retrieve: (id: string) => byId(id).retrieve(),
        events: {
          stream: (id: string) => byId(id).openStream(),
          list: (id: string) => byId(id).list(),
          send: (id: string, params: { events: Ev[] }) => byId(id).send(params),
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sessions };
}

interface Probe {
  lifecycle: StreamLifecycleEvent[];
  traces: DjonikTraceEvent[];
  telemetry: DjonikTurnTelemetry[];
  executions: number;
}

function newProbe(): Probe {
  return { lifecycle: [], traces: [], telemetry: [], executions: 0 };
}

const RECONNECT_DELAYS = [0, 0, 0];

function connect(client: Anthropic, probe: Probe = newProbe()): Promise<DjonikTracedSessionHandle> {
  return connectToDjonik(
    client,
    "agent_x",
    "env_x",
    "memstore_x",
    "vlt_x",
    (event) => probe.traces.push(event),
    (summary) => probe.telemetry.push(summary),
    "telegram",
    async () => {
      probe.executions += 1;
      return { isError: false, content: JSON.stringify({ answer_text: "Факт за тиждень." }) };
    },
    { onStreamLifecycle: (event) => probe.lifecycle.push(event), reconnectDelaysMs: RECONNECT_DELAYS, sleep: async () => {} },
  );
}

/** Lets background pumps and reconnect rounds run to quiescence. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function reply(text: string): Ev {
  return { type: "agent.message", content: [{ type: "text", text }] };
}
const END_TURN: Ev = { type: "session.status_idle", stop_reason: { type: "end_turn" } };

function answerWith(text: string): (session: FakeSession) => void {
  return (session) => {
    session.emit({ type: "session.status_running" });
    session.emit(reply(text));
    session.emit(END_TURN);
  };
}

function cardJson(card: Record<string, unknown>) {
  return [{ type: "text", text: JSON.stringify(card) }];
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => assert.fail("expected a rejection"), (error: unknown) => error);
}

// --- Same-Session recovery ------------------------------------------------------------------------------

test("#53 drop while idle: reconnected eagerly (before Daniel writes); the next turn runs in the SAME Session and preamble history is never replayed", async () => {
  const { client, sessions } = createWorld((session) => {
    // Creation-time event persisted before the first stream opened: belongs to no turn.
    session.emit({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
    session.onUserMessage = answerWith("Відповідь у тій самій сесії.");
  });
  const probe = newProbe();
  const handle = await connect(client, probe);
  const [server] = sessions;

  server.drop("end");
  await settle();
  assert.equal(server.streamsOpened, 2, "reconnected without waiting for a message");
  assert.deepEqual(probe.lifecycle, [{ type: "stream_reconnect", cause: "ended", attempts: 1, catchUpEvents: 0, inTurn: false }]);

  assert.equal(await handle.send("Привіт"), "Відповідь у тій самій сесії.");
  assert.equal(sessions.length, 1, "no replacement Session");
  assert.equal(server.userMessages(), 1);
  handle.close();
});

test("#53 drop right after the user.message was accepted: the missed turn is caught up from history; the message is never re-sent", async () => {
  const { client, sessions } = createWorld((session) => {
    session.onUserMessage = (s) => {
      s.drop("error"); // unread echo is lost with the connection
      answerWith("Відповідь після обриву.")(s); // produced while nothing listens
    };
  });
  const probe = newProbe();
  const handle = await connect(client, probe);

  assert.equal(await handle.send("такий самий сет для Європи"), "Відповідь після обриву.");
  const [server] = sessions;
  assert.equal(server.userMessages(), 1, "never re-sent");
  assert.equal(sessions.length, 1);
  const reconnect = probe.lifecycle.find((event) => event.type === "stream_reconnect");
  assert.ok(reconnect && reconnect.type === "stream_reconnect" && reconnect.inTurn && reconnect.catchUpEvents >= 3);
  handle.close();
});

test("#53 drop mid-turn: live half + caught-up half form one turn; the Trello write is verified once, with no nudge", async () => {
  const { client, sessions } = createWorld((session) => {
    session.onUserMessage = (s) => {
      s.emit({ type: "agent.mcp_tool_use", id: "w1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "create", name: "Card A" } });
      s.emit({ type: "agent.mcp_tool_result", id: "w1_r", mcp_tool_use_id: "w1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
      setImmediate(() => {
        s.drop("end");
        s.emit({ type: "agent.mcp_tool_use", id: "r1", name: "trelloReadCard", mcp_server_name: "trello", input: { cardIdOrUrl: "card_A" } });
        s.emit({ type: "agent.mcp_tool_result", id: "r1_r", mcp_tool_use_id: "r1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
        s.emit(reply("Створив картку Card A."));
        s.emit(END_TURN);
      });
    };
  });
  const probe = newProbe();
  const handle = await connect(client, probe);

  assert.equal(await handle.send("створи картку Card A"), "Створив картку Card A.");
  const [server] = sessions;
  assert.equal(server.userMessages(), 1, "no verification nudge, no resend");
  assert.equal(probe.traces.filter((t) => t.type === "mcp_tool_use").length, 2, "write and read each observed once");
  assert.equal(probe.telemetry.at(-1)?.toolCalls, 2);
  handle.close();
});

test("#53 catch-up overlapping the live stream: every event id is handled once — no duplicate tool effects, traces or telemetry", async () => {
  const { client, sessions } = createWorld((session) => {
    session.replayOnOpen = true; // the new stream re-delivers events the history list also returns
    session.onUserMessage = (s) => {
      s.emit({ type: "agent.mcp_tool_use", id: "w1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "create", name: "Card A" } });
      s.emit({ type: "agent.mcp_tool_result", id: "w1_r", mcp_tool_use_id: "w1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
      setImmediate(() => {
        s.drop("error");
        s.emit({ type: "agent.mcp_tool_use", id: "r1", name: "trelloReadCard", mcp_server_name: "trello", input: { cardIdOrUrl: "card_A" } });
        s.emit({ type: "agent.mcp_tool_result", id: "r1_r", mcp_tool_use_id: "r1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
        s.emit(reply("Готово."));
        s.emit(END_TURN);
      });
    };
  });
  const probe = newProbe();
  const handle = await connect(client, probe);

  assert.equal(await handle.send("створи картку"), "Готово.");
  assert.equal(sessions[0].userMessages(), 1);
  assert.equal(probe.traces.filter((t) => t.type === "mcp_tool_use").length, 2);
  assert.equal(probe.traces.filter((t) => t.type === "mcp_tool_result").length, 2);
  const turn = probe.telemetry.at(-1)!;
  assert.equal(turn.toolCalls, 2);
  assert.equal(turn.mcpResults, 2);
  const skipped = probe.lifecycle.find((event) => event.type === "stream_duplicates_skipped");
  assert.ok(skipped && skipped.type === "stream_duplicates_skipped" && skipped.count > 0, "live duplicates were skipped by id");
  handle.close();
});

test("#53 a replayed custom tool use (and its re-emitted requires_action) never executes or submits twice (#40 per id)", async () => {
  const { client, sessions } = createWorld((session) => {
    session.replayOnOpen = true;
    session.onUserMessage = (s) => {
      s.emit({ type: "agent.custom_tool_use", id: "ctu_1", name: "trello_work_history", input: { period: "this_week" } });
      s.emit({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ["ctu_1"] } });
      // Level-triggered status re-emitted (a different idle event naming the same blocking id).
      s.emit({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ["ctu_1"] } });
    };
    session.onCustomToolResult = (s) => {
      s.drop("error");
      s.emit({ type: "session.status_running" });
      s.emit(reply("Тиждень рівний."));
      s.emit(END_TURN);
    };
  });
  const probe = newProbe();
  const handle = await connect(client, probe);

  const answer = await handle.send("що було цього тижня?");
  assert.equal(answer, "Факт за тиждень.\n\n---\nPM-висновок:\nТиждень рівний.", "exact relay (#36) intact");
  assert.equal(probe.executions, 1, "executed once");
  assert.equal(sessions[0].sentOfType("user.custom_tool_result").length, 1, "result submitted once");
  handle.close();
});

test("#53 a replayed gated Trello write is confirmed once (#39) and its verification is not repeated (#31)", async () => {
  const ask = { evaluated_permission: "ask", evaluation: { type: "always_ask" } };
  const { client, sessions } = createWorld((session) => {
    session.replayOnOpen = true;
    session.onUserMessage = (s) => {
      s.emit({ type: "agent.mcp_tool_use", id: "w1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "create", name: "Card A" }, ...ask });
      s.emit({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ["w1"] } });
    };
    session.onConfirmation = (s) => {
      s.drop("end");
      s.emit({ type: "agent.mcp_tool_result", id: "w1_r", mcp_tool_use_id: "w1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
      s.emit({ type: "agent.mcp_tool_use", id: "r1", name: "trelloReadCard", mcp_server_name: "trello", input: { cardIdOrUrl: "card_A" } });
      s.emit({ type: "agent.mcp_tool_result", id: "r1_r", mcp_tool_use_id: "r1", is_error: false, content: cardJson({ id: "card_A", name: "Card A" }) });
      s.emit(reply("Створив."));
      s.emit(END_TURN);
    };
  });
  const probe = newProbe();
  const handle = await connect(client, probe);

  assert.equal(await handle.send("створи картку Card A"), "Створив.");
  const [server] = sessions;
  assert.equal(server.sentOfType("user.tool_confirmation").length, 1, "one confirmation");
  assert.equal(server.userMessages(), 1, "no nudge: the write stayed verified");
  assert.equal(probe.traces.filter((t) => t.type === "tool_confirmation_sent").length, 1);
  handle.close();
});

test("#53 idle reconnect that keeps failing only disconnects; it is retried before the next turn and the SAME Session answers", async () => {
  const { client, sessions } = createWorld((session) => {
    session.onUserMessage = answerWith("Знову на звʼязку.");
  });
  const probe = newProbe();
  const handle = await connect(client, probe);
  const [server] = sessions;

  server.retrieveFailures = RECONNECT_DELAYS.length; // the whole idle round fails transiently
  server.drop("error");
  await settle();
  assert.deepEqual(probe.lifecycle.at(-1), {
    type: "stream_reconnect_failed",
    cause: "error",
    attempts: RECONNECT_DELAYS.length,
    outcome: "disconnected",
    reason: "reconnect_exhausted",
    inTurn: false,
  });

  assert.equal(await handle.send("Привіт"), "Знову на звʼязку.");
  assert.equal(sessions.length, 1);
  assert.equal(server.userMessages(), 1);
  assert.ok(probe.lifecycle.some((event) => event.type === "stream_reconnect" && event.cause === "resume_before_turn"));
  handle.close();
});

// --- Session given up: replacement and conservative resubmission ---------------------------------------

function managedWorld(configure: (session: FakeSession, index: number) => void) {
  const world = createWorld(configure);
  const probe = newProbe();
  const recovery: SessionRecoveryEvent[] = [];
  const manager = createSessionManager(() => connect(world.client, probe));
  const run = (text: string) => runWithSessionRecovery(manager, (session) => session.send(text), (event) => recovery.push(event), () => {});
  return { ...world, probe, recovery, manager, run };
}

test("#53 dead before the turn (terminated while idle): nothing goes to the old Session; the message is submitted once to a replacement", async () => {
  const w = managedWorld((session, index) => {
    session.onUserMessage = answerWith(`Відповідь з сесії ${index + 1}.`);
  });
  await w.manager.getSession();
  const [old] = w.sessions;
  old.terminate();
  old.drop("end");
  await settle();

  assert.equal(await w.run("Привіт"), "Відповідь з сесії 2.");
  assert.equal(old.userMessages(), 0, "never sent to the dead Session");
  assert.equal(w.sessions[1].userMessages(), 1, "submitted exactly once");
  assert.deepEqual(w.recovery, [
    { type: "session_replaced", pendingMessage: "not_submitted", resubmit: true },
    { type: "message_resubmitted", outcome: "completed" },
  ]);
  assert.equal(w.manager.currentSessionId(), "sesn_2");
});

test("#53 dead mid-turn with the message provably unprocessed (terminated, never started): resubmitted exactly once", async () => {
  const w = managedWorld((session, index) => {
    session.onUserMessage =
      index === 0
        ? (s) => {
            s.drop("error");
            s.terminate(); // persisted while disconnected; the message never started processing
          }
        : answerWith("Відповідь з нової сесії.");
  });
  assert.equal(await w.run("такий самий сет для Європи"), "Відповідь з нової сесії.");
  assert.equal(w.sessions[0].userMessages(), 1);
  assert.equal(w.sessions[1].userMessages(), 1);
  assert.deepEqual(w.recovery[0], { type: "session_replaced", pendingMessage: "unprocessed", resubmit: true });
});

test("#53 a turn that completed while disconnected is still delivered even if the Session then terminated; only the NEXT message gets a new Session", async () => {
  const w = managedWorld((session, index) => {
    session.onUserMessage =
      index === 0
        ? (s) => {
            s.drop("error");
            answerWith("Відповідь, збережена в історії.")(s);
            s.terminate(); // e.g. expired right after answering
          }
        : answerWith("Нова сесія.");
  });
  assert.equal(await w.run("Привіт"), "Відповідь, збережена в історії.");
  assert.equal(w.sessions.length, 1, "no replacement and no resubmission for a delivered answer");
  assert.deepEqual(w.recovery, []);

  assert.equal(await w.run("Друге"), "Нова сесія.");
  assert.equal(w.sessions[0].userMessages(), 1);
  assert.deepEqual(w.recovery[0], { type: "session_replaced", pendingMessage: "not_submitted", resubmit: true });
});

test("#53 dead mid-turn after processing started: never resubmitted; Daniel gets the short Ukrainian check line", async () => {
  const w = managedWorld((session) => {
    session.onUserMessage = (s) => {
      s.drop("error");
      s.emit({ type: "session.status_running" });
      s.emit({ type: "agent.mcp_tool_use", id: "w1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "create", name: "X" } });
      s.terminate();
    };
  });
  const error = await rejection(w.run("створи X"));
  assert.ok(error instanceof DjonikSessionDeadError);
  assert.equal(error.pendingMessage, "processed");
  assert.equal(formatUserFacingError(error), SESSION_LOST_CHECK_TEXT);
  assert.equal(w.sessions.length, 1, "no replacement turn was run");
  assert.equal(w.manager.currentSessionId(), null, "the dead Session is discarded; the next message gets a new one");
  assert.deepEqual(w.recovery, [{ type: "session_replaced", pendingMessage: "processed", resubmit: false }]);
});

test("#53 genuinely ambiguous (Session unreachable, history unreadable): unknown, never resubmitted", async () => {
  const w = managedWorld((session) => {
    session.onUserMessage = (s) => {
      s.retrieveFailures = Number.POSITIVE_INFINITY;
      s.drop("error");
    };
  });
  const error = await rejection(w.run("Привіт"));
  assert.ok(error instanceof DjonikSessionDeadError);
  assert.equal(error.pendingMessage, "unknown");
  assert.equal(error.reason, "reconnect_exhausted");
  assert.equal(formatUserFacingError(error), SESSION_LOST_CHECK_TEXT);
  assert.equal(w.sessions.length, 1);
  assert.equal(w.sessions[0].userMessages(), 1);
  assert.ok(
    w.probe.lifecycle.some((e) => e.type === "stream_reconnect_failed" && e.outcome === "dead" && e.inTurn),
    "in-turn exhaustion gives the Session up",
  );
});

test("#53 a deleted Session (404) mid-turn is given up as unknown: its history cannot prove anything", async () => {
  const w = managedWorld((session) => {
    session.onUserMessage = (s) => {
      s.gone = true;
      s.drop("end");
    };
  });
  const error = await rejection(w.run("Привіт"));
  assert.ok(error instanceof DjonikSessionDeadError);
  assert.equal(error.reason, "session_gone");
  assert.equal(error.pendingMessage, "unknown");
  assert.equal(w.sessions.length, 1);
});

test("#53 a send refused by a terminated Session is not_submitted and goes to a replacement; a refusal by a live Session stays an ordinary error", async () => {
  const w = managedWorld((session, index) => {
    session.onUserMessage = answerWith(`Сесія ${index + 1}.`);
  });
  await w.manager.getSession();
  w.sessions[0].status = "terminated"; // silently, with no event and a still-open stream
  assert.equal(await w.run("Привіт"), "Сесія 2.");
  assert.deepEqual(w.recovery[0], { type: "session_replaced", pendingMessage: "not_submitted", resubmit: true });

  w.sessions[1].refuseSends = true; // e.g. an oversized attachment
  const error = await rejection(w.run("Привіт"));
  assert.ok(error instanceof APIError && !(error instanceof DjonikSessionDeadError));
  assert.equal(w.manager.currentSessionId(), "sesn_2", "a live Session is kept");
  assert.equal(w.sessions.length, 2);
});

test("#53 a replacement that also dies is not resubmitted a second time", async () => {
  const w = managedWorld((session) => {
    session.onUserMessage = (s) => {
      s.drop("error");
      s.terminate();
    };
  });
  const error = await rejection(w.run("Привіт"));
  assert.ok(error instanceof DjonikSessionDeadError);
  assert.equal(w.sessions.length, 2, "one replacement only");
  assert.equal(w.sessions[0].userMessages() + w.sessions[1].userMessages(), 2, "original + exactly one resubmission");
  assert.equal(w.manager.currentSessionId(), null);
});

test("#53 Working Rhythm turns use the same recovery: one traced result after resubmission; a processed prompt fails without a second attempt", async () => {
  const request = { origin: "rhythm_ritual" as const, occurrenceKey: "morning:2026-09-28", kind: "morning" as const, prompt: "[Робочий ритм · автоматичний хід]" };

  const unprocessed = createWorld((session, index) => {
    session.onUserMessage =
      index === 0
        ? (s) => {
            s.drop("error");
            s.terminate();
          }
        : answerWith("Бриф.");
  });
  const recovery: SessionRecoveryEvent[] = [];
  const runner = createSessionTurnRunner(createSessionManager(() => connect(unprocessed.client)), (event) => recovery.push(event));
  const result = await runner(request);
  assert.equal(result.reply, "Бриф.");
  assert.equal(result.sessionId, "sesn_2", "the result names the Session that produced it");
  assert.equal(unprocessed.sessions[1].userMessages(), 1);
  assert.deepEqual(recovery.map((event) => event.type), ["session_replaced", "message_resubmitted"]);

  const processed = createWorld((session) => {
    session.onUserMessage = (s) => {
      s.drop("error");
      s.emit(reply("half"));
      s.terminate();
    };
  });
  const failing = createSessionTurnRunner(createSessionManager(() => connect(processed.client)));
  const failure = await rejection(failing(request));
  assert.ok(failure instanceof AutonomousTurnFailure);
  assert.equal(failure.sessionId, "sesn_1");
  assert.equal(processed.sessions.length, 1, "no resubmission of a possibly processed rhythm prompt");
});

test("#53 queued messages behind a dead turn are never sent to the dead Session; each is resubmitted once to the replacement", async () => {
  const w = managedWorld((session, index) => {
    session.onUserMessage =
      index === 0
        ? (s) => {
            s.drop("error");
            s.terminate();
          }
        : (s, message) => answerWith(`re:${JSON.stringify((message.content as Array<{ text?: string }>).at(-1)?.text)}`)(s);
  });
  const [first, second] = await Promise.all([w.run("перше"), w.run("друге")]);
  assert.equal(first, 're:"перше"');
  assert.equal(second, 're:"друге"');
  assert.equal(w.sessions[0].userMessages(), 1, "only the in-flight message reached the dead Session");
  assert.equal(w.sessions[1].userMessages(), 2);
});

// --- Telemetry and user-facing text ------------------------------------------------------------------------

test("#53 lifecycle and recovery telemetry is content-free (no ids, no message text)", async () => {
  const w = managedWorld((session, index) => {
    session.replayOnOpen = true;
    session.onUserMessage =
      index === 0
        ? (s) => {
            s.drop("error");
            s.terminate();
          }
        : answerWith("Секретна відповідь клієнту.");
  });
  await w.run("Секретний текст Daniel");
  const serialized = JSON.stringify([...w.probe.lifecycle, ...w.recovery]);
  assert.ok(w.probe.lifecycle.length > 0 && w.recovery.length > 0);
  for (const forbidden of ["Секрет", "evt_", "sesn_", "content"]) assert.ok(!serialized.includes(forbidden), forbidden);
});

test("#53 user-facing text for a lost Session is one short Ukrainian line, never provider text", () => {
  assert.equal(formatUserFacingError(new DjonikSessionDeadError("Djonik session error: upstream 529", "not_submitted")), SESSION_LOST_RESEND_TEXT);
  assert.equal(formatUserFacingError(new DjonikSessionDeadError("x", "unprocessed")), SESSION_LOST_RESEND_TEXT);
  for (const state of ["processed", "unknown"] as const) {
    assert.equal(formatUserFacingError(new DjonikSessionDeadError("Djonik session error: upstream 529", state)), SESSION_LOST_CHECK_TEXT);
  }
  assert.ok(!SESSION_LOST_CHECK_TEXT.includes("529"));
});

// --- Classifier and feed units -------------------------------------------------------------------------------

function api(status: string | Error, history: Ev[] | Error): SessionEventApi<FeedEvent> {
  return {
    openStream: async () => {
      throw new Error("unused");
    },
    listHistory: async function* () {
      if (history instanceof Error) throw history;
      yield* history;
    },
    retrieveStatus: async () => {
      if (status instanceof Error) throw status;
      return status;
    },
  };
}

test("#53 classifier: only a terminated Session whose history holds the exact message, untouched, is 'unprocessed'", async () => {
  const user = { type: "user.message", id: "u1", processed_at: null };
  const terminated = { type: "session.status_terminated", id: "t1" };
  assert.equal(await classifyPendingMessage(api("terminated", [user, terminated]), "u1"), "unprocessed");
  assert.equal(await classifyPendingMessage(api("terminated", [{ ...user, processed_at: "2026-09-26T10:00:00Z" }, terminated]), "u1"), "processed");
  assert.equal(await classifyPendingMessage(api("terminated", [user, { type: "span.model_request_start", id: "s" }, terminated]), "u1"), "processed");
  assert.equal(await classifyPendingMessage(api("idle", [user]), "u1"), "unknown", "an alive Session could still process it later");
  assert.equal(await classifyPendingMessage(api("terminated", [terminated]), "u1"), "unknown", "absent despite an accepted id: inconsistent");
  assert.equal(await classifyPendingMessage(api("terminated", new APIConnectionError({ message: "x" })), "u1"), "unknown");
  assert.equal(await classifyPendingMessage(api(new APIConnectionError({ message: "x" }), [user]), "u1"), "unknown");
  assert.equal(await classifyPendingMessage(api("terminated", [user, terminated]), null), "unknown", "no id, no correlation");
});

test("#53 feed: an event id is delivered at most once across live stream and catch-up, in order", async () => {
  const session = new FakeSession("sesn_unit");
  session.replayOnOpen = true;
  const feedApi: SessionEventApi<Ev> = {
    openStream: async () => {
      const stream = await session.openStream();
      return { events: stream, abort: () => stream.controller.abort() };
    },
    listHistory: () => session.list(),
    retrieveStatus: async () => (await session.retrieve()).status,
  };
  const feed = await SessionEventFeed.open(feedApi, { reconnectDelaysMs: [0], sleep: async () => {} });
  session.emit({ type: "user.message", id: "u1" });
  session.emit({ type: "agent.message", id: "a1" });
  session.drop("error"); // a1 may be lost unread
  session.emit({ type: "agent.message", id: "a2" });
  session.emit({ type: "session.status_idle", id: "i1" });
  await settle();
  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) seen.push((await feed.next()).id as string);
  assert.deepEqual(seen, ["u1", "a1", "a2", "i1"]);
  session.emit({ type: "agent.message", id: "a3" });
  assert.equal((await feed.next()).id, "a3", "live tail continues after catch-up, duplicates skipped");
  feed.close();
});

test("#53 Telegram dispatch: an unprocessed intake is answered from the replacement Session; a possibly processed one gets the Ukrainian line", async () => {
  const intake = (text: string) =>
    ({ text, images: [], documents: [], parts: [{ type: "text", text }], fragmentCount: 1, textCount: 1, imageCount: 0, documentCount: 0, groupingReason: "single", groupingWaitMs: 0 }) as unknown as GroupedIntake;

  for (const [lastWords, expected] of [
    [(s: FakeSession) => s.terminate(), "Відповідь з нової сесії."],
    [(s: FakeSession) => (s.emit({ type: "agent.tool_use", name: "read", input: {} }), s.terminate()), SESSION_LOST_CHECK_TEXT],
  ] as const) {
    const world = createWorld((session, index) => {
      session.onUserMessage =
        index === 0
          ? (s) => {
              s.drop("error");
              lastWords(s);
            }
          : answerWith("Відповідь з нової сесії.");
    });
    const recovery: SessionRecoveryEvent[] = [];
    const sent: string[] = [];
    const { onDispatch } = createGroupDispatchHandlers({
      djonikSession: createSessionManager(() => connect(world.client)),
      sendMessage: async (_chatId, text) => void sent.push(text),
      logError: () => {},
      onSessionRecovery: (event) => recovery.push(event),
    });
    await onDispatch(1, 100, intake("такий самий сет для Європи"));
    assert.deepEqual(sent, [expected]);
    assert.equal(world.sessions.reduce((sum, s) => sum + s.userMessages(), 0), expected === SESSION_LOST_CHECK_TEXT ? 1 : 2);
  }
});
