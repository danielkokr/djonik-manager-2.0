import Anthropic from "@anthropic-ai/sdk";
import { Bot, type Context } from "grammy";
import { loadConfig, loadTelegramConfig, MissingConfigError, type DjonikClientConfig, type TelegramAdapterConfig } from "./config.js";
import { connectToDjonik } from "./djonikClient.js";
import {
  createSessionManager,
  downloadTelegramDocument,
  downloadTelegramImage,
  exceedsDocumentSizeEstimate,
  formatUserFacingError,
  handleSessionError,
  isAllowedUser,
  resolveDocumentFileAttachment,
  resolveDocumentImageAttachment,
  resolvePhotoAttachment,
} from "./telegramAdapter.js";

async function main(): Promise<void> {
  let djonikConfig: DjonikClientConfig;
  let telegramConfig: TelegramAdapterConfig;
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

  /**
   * Downloads one Telegram image attachment and sends it (plus any caption)
   * as a single Djonik turn. Shared by the photo and image-document handlers
   * below. A download/size failure produces a visible user-facing error and
   * never reaches `session.send`, so a broken image can never trigger a
   * Trello mutation.
   */
  async function handleImageTurn(ctx: Context, fileId: string, mimeType: string, caption: string): Promise<void> {
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Telegram did not return a file path for this image.");
      }
      const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
      const image = await downloadTelegramImage(fileUrl, mimeType);

      const session = await djonikSession.getSession();
      const reply = await session.send(caption, image);
      await ctx.reply(reply);
    } catch (error) {
      console.error("Djonik image turn failed:", error);
      handleSessionError(djonikSession, error);
      await ctx.reply(formatUserFacingError(error));
    }
  }

  /**
   * Downloads one Telegram PDF/file attachment and sends it (plus any
   * caption) as a single Djonik turn (#24). A download/size failure produces
   * a visible user-facing error and never reaches `session.send`, so a
   * broken file can never trigger a Trello mutation.
   */
  async function handleDocumentFileTurn(
    ctx: Context,
    fileId: string,
    mimeType: string,
    filename: string | undefined,
    caption: string,
  ): Promise<void> {
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Telegram did not return a file path for this document.");
      }
      const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
      const document = await downloadTelegramDocument(fileUrl, mimeType, filename);

      const session = await djonikSession.getSession();
      const reply = await session.send(caption, undefined, document);
      await ctx.reply(reply);
    } catch (error) {
      console.error("Djonik document turn failed:", error);
      handleSessionError(djonikSession, error);
      await ctx.reply(formatUserFacingError(error));
    }
  }

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

  // Telegram photos: always re-encoded to JPEG by Telegram itself. The
  // caption (if any) travels with the image in the same visible turn.
  bot.on("message:photo", async (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram photo from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }
    const attachment = resolvePhotoAttachment(ctx.message.photo);
    if (!attachment) return;
    await handleImageTurn(ctx, attachment.fileId, attachment.mimeType, ctx.message.caption ?? "");
  });

  // Documents: an image-shaped document (e.g. an uncompressed screenshot sent
  // as a file, #22) takes priority; anything else is now file/PDF intake
  // (#24). A supported file (PDF) reaches Djonik as document content; an
  // unsupported type gets a concise visible rejection rather than being
  // silently dropped, per the issue's explicit "unsupported type -> visible
  // error, zero mutation" requirement.
  bot.on("message:document", async (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram document from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }
    const imageAttachment = resolveDocumentImageAttachment(ctx.message.document);
    if (imageAttachment !== null) {
      if (!imageAttachment.supported) {
        await ctx.reply(
          `⚠️ Джонік поки не підтримує цей формат зображення (${imageAttachment.mimeType}). Підтримуються: JPEG, PNG, GIF, WebP.`,
        );
        return;
      }
      await handleImageTurn(ctx, imageAttachment.fileId, imageAttachment.mimeType, ctx.message.caption ?? "");
      return;
    }

    const fileAttachment = resolveDocumentFileAttachment(ctx.message.document);
    if (fileAttachment === null) return;
    if (!fileAttachment.supported) {
      await ctx.reply(
        `⚠️ Джонік поки не підтримує цей тип файлу (${fileAttachment.mimeType}). Підтримується: PDF.`,
      );
      return;
    }
    // Optimistic early rejection from Telegram's self-reported file_size, skipping a
    // wasted download for an obviously oversized PDF. Not authoritative: downloadTelegramDocument
    // still enforces the real ceiling against the actual encoded payload either way.
    if (exceedsDocumentSizeEstimate(fileAttachment.fileSize)) {
      const megabytes = ((fileAttachment.fileSize ?? 0) / (1024 * 1024)).toFixed(1);
      await ctx.reply(`⚠️ Файл завеликий (${megabytes} MB). Джонік поки підтримує файли до ~15 MB.`);
      return;
    }
    await handleDocumentFileTurn(ctx, fileAttachment.fileId, fileAttachment.mimeType, fileAttachment.filename, ctx.message.caption ?? "");
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
