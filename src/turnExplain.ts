import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import { explainRecordedTurn, type DecisionTrace } from "./decisionTrace.js";

export function renderExplanation(trace: DecisionTrace | null, sessionId: string, turnIndex: number): string {
  const shown = (items: readonly string[]) => items.length ? items.join(", ") : "unknown";
  const mutations = trace?.mutations.length ? trace.mutations.map((item) => `${shown(item.cardIds)}: ${item.status}`).join(", ") : "unknown";
  return [
    `Session ${sessionId}, turn ${turnIndex}`,
    `Clock: ${trace?.clockHeader ?? "unknown"}`,
    `Skills: ${shown(trace?.skillPaths ?? [])}`,
    `Memory read: ${shown(trace?.memoryPathsRead ?? [])}`,
    `Memory written: ${shown(trace?.memoryPathsWritten ?? [])}`,
    `Tools: ${shown(trace?.toolNames ?? [])}`,
    `Trello cards read: ${shown(trace?.cardIdsRead ?? [])}`,
    `Trello cards written: ${shown(trace?.cardIdsWritten ?? [])}`,
    `Mutation verification: ${mutations}`,
    `Unsupported concrete: ${trace?.unsupportedConcrete === undefined ? "unknown" : trace.unsupportedConcrete.length
      ? trace.unsupportedConcrete.map((item) => `${item.type}:${item.value}`).join(", ") : "none"}`,
    "Observable event path only; no private reasoning is exposed.",
  ].join("\n");
}

async function main(): Promise<void> {
  const [sessionId, indexText] = process.argv.slice(2).filter((arg) => arg !== "--");
  const turnIndex = Number(indexText);
  if (!/^sesn_[\w-]+$/.test(sessionId ?? "") || !Number.isInteger(turnIndex) || turnIndex < 1) {
    throw new Error("Usage: npm run turn:explain -- <sessionId> <turnIndex>");
  }
  const client = new Anthropic();
  const events: Record<string, unknown>[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, { limit: 1000 })) {
    events.push(event as unknown as Record<string, unknown>);
  }
  console.log(renderExplanation(explainRecordedTurn(events, turnIndex), sessionId, turnIndex));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
