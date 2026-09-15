import Anthropic from "@anthropic-ai/sdk";

export interface DjonikSessionHandle {
  sessionId: string;
  send(text: string): Promise<string>;
  /** Aborts the session's open event stream so the process can exit cleanly. */
  close(): void;
}

/**
 * Session-specific guidance shown to the agent alongside the memory store's
 * name/description (see the store's own `description` for what it is).
 * Memory stores attach only at session creation time, so this text travels
 * with every new Djonik session rather than living in agent configuration.
 */
const DJONIK_MEMORY_INSTRUCTIONS =
  "Persistent PM memory across sessions. Write only durable, useful context: " +
  "stable work preferences, client/project facts, important decisions, recurring " +
  "patterns, PM lessons. Do not store live Trello/task state, transient chat, or " +
  "anything trivial. Fresh external tool reads always outrank what is remembered here.";

/**
 * Connects to the already-existing Djonik Managed Agent (Claude Console is
 * the authoritative runtime/configuration for the agent itself) by starting
 * one Managed Agent Session against `agentId` + `environmentId`, then opens
 * that session's event stream once. `send()` reuses the same session/stream
 * for every turn, so conversational continuity is the official Managed
 * Agents Session primitive — this client never builds or replays its own
 * message history.
 *
 * The Djonik Memory Store is attached as a `memory_store` session resource
 * with `read_write` access, since memory stores can only be attached at
 * session creation time (not added to a running session).
 */
export async function connectToDjonik(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  memoryStoreId: string,
): Promise<DjonikSessionHandle> {
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    resources: [
      {
        type: "memory_store",
        memory_store_id: memoryStoreId,
        access: "read_write",
        instructions: DJONIK_MEMORY_INSTRUCTIONS,
      },
    ],
  });

  const stream = await client.beta.sessions.events.stream(session.id);
  const iterator = stream[Symbol.asyncIterator]();

  async function send(text: string): Promise<string> {
    await client.beta.sessions.events.send(session.id, {
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    });

    let reply = "";

    for (;;) {
      const { value: event, done } = await iterator.next();
      if (done) {
        throw new Error("Djonik session event stream ended unexpectedly.");
      }

      switch (event.type) {
        case "agent.message":
          reply = event.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("");
          break;
        case "session.error":
          throw new Error(`Djonik session error: ${event.error.message}`);
        case "session.status_terminated":
          throw new Error("Djonik session terminated unexpectedly.");
        case "session.status_idle":
          if (!reply) {
            throw new Error("Djonik produced no text reply for this turn.");
          }
          return reply;
        default:
          break;
      }
    }
  }

  function close(): void {
    stream.controller.abort();
  }

  return { sessionId: session.id, send, close };
}
