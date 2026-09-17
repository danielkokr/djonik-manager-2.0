import Anthropic from "@anthropic-ai/sdk";
import { Bot, type Context } from "grammy";
import { loadConfig, loadTelegramConfig, MissingConfigError, type DjonikClientConfig, type TelegramAdapterConfig } from "./config.js";
import { connectToDjonik, type DjonikDocumentInput, type DjonikImageInput } from "./djonikClient.js";
import {
  createSessionManager,
  downloadTelegramDocument,
  downloadTelegramImage,
  exceedsDocumentSizeEstimate,
  isAllowedUser,
  resolveDocumentFileAttachment,
  resolveDocumentImageAttachment,
  resolvePhotoAttachment,
} from "./telegramAdapter.js";
import { MessageGroupBuffer, type IncomingFragment } from "./messageGrouping.js";
import { createGroupDispatchHandlers } from "./telegramDispatch.js";

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
   * Downloads one Telegram image attachment, reusing the exact #22 transport
   * (`ctx.api.getFile` + `downloadTelegramImage`) — no second parallel image
   * implementation. Returns a promise the grouping buffer awaits at dispatch
   * time; the download itself starts immediately (before this promise is
   * ever awaited), so buffering time and download time overlap.
   */
  async function resolveImageMedia(ctx: Context, fileId: string, mimeType: string): Promise<DjonikImageInput> {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not return a file path for this image.");
    }
    const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
    return downloadTelegramImage(fileUrl, mimeType);
  }

  /**
   * Downloads one Telegram PDF/file attachment, reusing the exact #24
   * transport (`ctx.api.getFile` + `downloadTelegramDocument`) — no second
   * parallel document implementation. Same overlap-with-buffering shape as
   * `resolveImageMedia` above.
   */
  async function resolveDocumentMedia(
    ctx: Context,
    fileId: string,
    mimeType: string,
    filename: string | undefined,
  ): Promise<DjonikDocumentInput> {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not return a file path for this document.");
    }
    const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
    return downloadTelegramDocument(fileUrl, mimeType, filename);
  }

  /**
   * Grouped-intake buffer (#25): a thin, deterministic, in-memory layer
   * between Telegram updates and the one Djonik turn they collectively
   * produce. `onDispatch`/`onFailure` (from `createGroupDispatchHandlers`,
   * `src/telegramDispatch.ts`) are the ONLY place a grouped/single intake
   * reaches `session.send` — see `MessageGroupBuffer` for why this
   * guarantees no duplicate Managed Agent invocation per settled group, and
   * `src/telegramDispatch.test.ts` for integration-level proof of exactly
   * one Managed Agent call per grouped intake.
   */
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession,
    sendMessage: (chatId, text) => bot.api.sendMessage(chatId, text),
    onGroupTelemetry: turnTelemetry ? (telemetry) => console.error("[group]", JSON.stringify(telemetry)) : undefined,
  });
  const groupBuffer = new MessageGroupBuffer({ onDispatch, onFailure });

  function baseFragment(ctx: Context, text: string): Pick<IncomingFragment, "chatId" | "userId" | "messageId" | "mediaGroupId" | "text"> {
    return {
      chatId: ctx.chat!.id,
      userId: ctx.from!.id,
      messageId: ctx.message!.message_id,
      mediaGroupId: ctx.message!.media_group_id,
      text,
    };
  }

  // Text-only: this is a thin channel adapter, not an intent router. The
  // raw text goes to Djonik unmodified; Djonik decides what it means.
  // Fragments are pushed into the grouping buffer rather than sent
  // immediately, so an adjacent follow-up (screenshot, PDF, another short
  // message) can still join this one intake (#25).
  bot.on("message:text", (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram message from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }
    groupBuffer.addFragment(baseFragment(ctx, ctx.message.text));
  });

  // Telegram photos: always re-encoded to JPEG by Telegram itself. The
  // caption (if any) travels with the image as this fragment's text.
  bot.on("message:photo", (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram photo from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }
    const attachment = resolvePhotoAttachment(ctx.message.photo);
    if (!attachment) return;
    groupBuffer.addFragment({
      ...baseFragment(ctx, ctx.message.caption ?? ""),
      media: { kind: "image", promise: resolveImageMedia(ctx, attachment.fileId, attachment.mimeType) },
    });
  });

  // Documents: an image-shaped document (e.g. an uncompressed screenshot sent
  // as a file, #22) takes priority; anything else is file/PDF intake (#24).
  // A supported file (PDF) reaches Djonik as document content; an
  // unsupported type or an oversized file fails visibly rather than being
  // silently dropped — routed through the grouping buffer's own promise
  // rejection path (rather than an early `ctx.reply`) so a failure here
  // correctly fails the *whole* grouped intake if this fragment already
  // joined one, per the issue's pre-send-failure requirement.
  bot.on("message:document", (ctx) => {
    if (!isAllowedUser(ctx.from?.id, telegramConfig.allowedUserId)) {
      console.warn(`Ignored Telegram document from unauthorized user id ${ctx.from?.id ?? "unknown"}.`);
      return;
    }

    const imageAttachment = resolveDocumentImageAttachment(ctx.message.document);
    if (imageAttachment !== null) {
      const promise = imageAttachment.supported
        ? resolveImageMedia(ctx, imageAttachment.fileId, imageAttachment.mimeType)
        : Promise.reject(
            new Error(
              `Джонік поки не підтримує цей формат зображення (${imageAttachment.mimeType}). Підтримуються: JPEG, PNG, GIF, WebP.`,
            ),
          );
      groupBuffer.addFragment({
        ...baseFragment(ctx, ctx.message.caption ?? ""),
        media: { kind: "image", promise },
      });
      return;
    }

    const fileAttachment = resolveDocumentFileAttachment(ctx.message.document);
    if (fileAttachment === null) return;

    let promise: Promise<DjonikDocumentInput>;
    if (!fileAttachment.supported) {
      promise = Promise.reject(
        new Error(`Джонік поки не підтримує цей тип файлу (${fileAttachment.mimeType}). Підтримується: PDF.`),
      );
    } else if (exceedsDocumentSizeEstimate(fileAttachment.fileSize)) {
      const megabytes = ((fileAttachment.fileSize ?? 0) / (1024 * 1024)).toFixed(1);
      promise = Promise.reject(new Error(`Файл завеликий (${megabytes} MB). Джонік поки підтримує файли до ~15 MB.`));
    } else {
      promise = resolveDocumentMedia(ctx, fileAttachment.fileId, fileAttachment.mimeType, fileAttachment.filename);
    }

    groupBuffer.addFragment({
      ...baseFragment(ctx, ctx.message.caption ?? ""),
      media: { kind: "document", promise },
    });
  });

  bot.catch((error) => {
    console.error("Unhandled Telegram bot error:", error.message);
  });

  function shutdown(): void {
    console.log("\nShutting down Djonik Telegram adapter...");
    groupBuffer.clearAll();
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
