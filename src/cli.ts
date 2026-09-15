import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { loadConfig, MissingConfigError } from "./config.js";
import { connectToDjonik } from "./djonikClient.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const client = new Anthropic({ apiKey: config.apiKey });

  console.log("Connecting to the existing Djonik Managed Agent...");
  const djonik = await connectToDjonik(
    client,
    config.agentId,
    config.environmentId,
    config.memoryStoreId,
    config.vaultId,
  );
  console.log(`Connected (session ${djonik.sessionId}). Type a message, or "exit" to quit.\n`);

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Iterate the readline interface itself (not repeated rl.question() calls):
  // question() only listens for a "line" event while it is pending, so any
  // line that arrives while we're awaiting a Djonik reply is silently lost.
  // The async iterator queues lines instead, so piped/batched input and
  // interactive typing both work.
  try {
    stdout.write("You: ");
    for await (const rawLine of rl) {
      const input = rawLine.trim();
      if (!input) {
        stdout.write("You: ");
        continue;
      }
      if (input === "exit" || input === "quit") break;

      const reply = await djonik.send(input);
      console.log(`Djonik: ${reply}\n`);
      stdout.write("You: ");
    }
  } finally {
    rl.close();
    djonik.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
