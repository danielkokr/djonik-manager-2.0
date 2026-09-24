import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import "dotenv/config";
import { SERVING_RELEASE } from "./release.js";
import { ReleaseAttestationError } from "./releaseAttestation.js";
import { connectServingSession, EXIT_CONFIG, loadServingConfig, preflightRelease, ServingConfigError } from "./servingRelease.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadServingConfig(SERVING_RELEASE);
  } catch (error) {
    if (error instanceof ServingConfigError) {
      console.error(error.message);
      process.exitCode = EXIT_CONFIG;
      return;
    }
    throw error;
  }

  const client = new Anthropic({ apiKey: config.apiKey });

  // Same pinned, attested Session as the Telegram path; only the source label differs (#33).
  console.log(`Connecting to the Djonik Managed Agent (release ${config.release.id})...`);
  const trace = process.env.DJONIK_TRACE === "1";
  const turnTelemetry = process.env.DJONIK_TURN_TELEMETRY === "1";
  let djonik;
  try {
    const preflight = await preflightRelease(client, config.release);
    djonik = await connectServingSession(client, config, preflight, {
      turnSource: "diagnostic",
      onTrace: trace ? (event) => console.error("[trace]", JSON.stringify(event)) : undefined,
      onTurnTelemetry: turnTelemetry ? (summary) => console.error("[turn]", JSON.stringify(summary)) : undefined,
      onServing: (line) => console.log(line),
    });
  } catch (error) {
    if (error instanceof ReleaseAttestationError) {
      console.error(error.message);
      process.exitCode = EXIT_CONFIG;
      return;
    }
    throw error;
  }
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
