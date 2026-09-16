import Anthropic from "@anthropic-ai/sdk";
import { Bot } from "grammy";
import { loadConfig, loadTelegramConfig, MissingConfigError } from "./config.js";
import { connectToDjonik } from "./djonikClient.js";
import { createSessionManager, formatUserFacingError, handleSessionError, isAllowedUser } from "./telegramAdapter.js";

async function main(): Promise<void> {
  let djonikConfig;
  let telegramConfig;
  try {
    djonikConfig = loadConfig();
    telegramConfig = loadTelegramConfig();
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const anthropic = new Anthropic({ apiKey: djonikConfig.apiKey });
  const trace = process.env.DJONIK_TRACE === "1";
  const turnTelemetry = process.env.DJONIK_TURN_TELEMETRY === "1";
  const djonikSession = createSessionManager(() =>
    connectToDjonik(
      anthropic,
      djonikConfig.agentId,
      djonikConfig.environmentId,
      djonikConfig.memoryStoreId,
      djonikConfig.vaultId,
      trace ? (event) => console.error("[trace]", JSON.stringify(event)) : undefined,
      turnTelemetry ? (summary) => console.error("[turn]", JSON.stringify(summary)) : undefined,
      "telegram",
    ),
  );

  const bot = new Bot(telegramConfig.botToken);

  // Text-only: this is a thin channel adapter, not an intent router. The
  // raw text goes to Djonik unmodified; Djonik decides what it means.
  bot.on("message:text", async (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram message from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }

    try {
      const session = await djonikSession.getSession();
      const reply = await session.send(ctx.message.text);
      await ctx.reply(reply);
    } catch (error) {
      console.error("Djonik turn failed:", error);
      handleSessionError(djonikSession, error);
      await ctx.reply(formatUserFacingError(error));
    }
  });

  bot.catch((error) => {
    console.error("Unhandled Telegram bot error:", error.message);
  });

  function shutdown(): void {
    console.log("\nShutting down Djonik Telegram adapter...");
    djonikSession.closeIfOpen();
    void bot.stop();
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("Starting Djonik Telegram adapter (long polling)...");
  await bot.start({
    onStart: () => console.log("Telegram adapter is running. Press Ctrl+C to stop."),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
