import Anthropic from "@anthropic-ai/sdk";
import { Bot, type Context } from "grammy";
import { loadTelegramConfig, MissingConfigError, type TelegramAdapterConfig } from "./config.js";
import { type DjonikDocumentInput, type DjonikImageInput } from "./djonikClient.js";
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
import { SERVING_RELEASE } from "./release.js";
import { ReleaseAttestationError } from "./releaseAttestation.js";
import {
  checkTrelloHistoryHealth,
  connectServingSession,
  describeTrelloHistoryHealth,
  EXIT_CONFIG,
  loadServingConfig,
  preflightRelease,
  ServingConfigError,
  type ServingConfig,
} from "./servingRelease.js";
import { classifyPollingFailure, createShutdownCoordinator } from "./servingLifecycle.js";
import { createRhythmFactCollector } from "./rhythmFacts.js";
import { createMemoryRhythmConfigSource, sdkRhythmMemoryReader } from "./rhythmMemoryConfig.js";
import {
  createCallbackListener,
  createSessionTurnRunner,
  SERVING_READ_ONLY_BOUNDARY,
  startWorkingRhythm,
} from "./rhythmRuntime.js";
import { createFileRhythmStateStore } from "./rhythmState.js";
import { createTelegramProactiveSender, enqueueClickAfterPendingText } from "./rhythmTelegram.js";
import { createFormattedTextSender } from "./telegramFormat.js";
import { TrelloWorkHistoryClient } from "./trelloWorkHistory.js";

/**
 * The one Telegram serving process (#33). Startup order, fail-closed before any update is polled:
 * validated host config → read-only release preflight (pinned Agent version) → Trello token health
 * (degrades, never blocks) → Telegram token check → one Session pinned to the release version, attested
 * from the provider's own snapshot → the content-free serving tuple line → long polling.
 * Resolves to the process exit code.
 */
async function main(): Promise<number> {
  let config: ServingConfig;
  let telegramConfig: TelegramAdapterConfig;
  try {
    config = loadServingConfig(SERVING_RELEASE);
    telegramConfig = loadTelegramConfig();
  } catch (error) {
    if (error instanceof ServingConfigError || error instanceof MissingConfigError) {
      console.error(error.message);
      return EXIT_CONFIG;
    }
    throw error;
  }

  const { release } = config;
  console.log(`[release] preflight release=${release.id} app=${config.appRevision} agent=${release.agent.id}@${release.agent.version}`);
  const anthropic = new Anthropic({ apiKey: config.apiKey });
  let preflight;
  try {
    preflight = await preflightRelease(anthropic, release);
  } catch (error) {
    if (error instanceof ReleaseAttestationError) {
      console.error(error.message);
      return EXIT_CONFIG;
    }
    throw error;
  }

  const trello = describeTrelloHistoryHealth(await checkTrelloHistoryHealth(config.trello));
  if (trello.warning) console.warn(`[release] warning ${trello.warning}`);

  const bot = new Bot(telegramConfig.botToken);
  try {
    await bot.init();
  } catch (error) {
    const { reason, exitCode } = classifyPollingFailure(error);
    console.error(`[release] Telegram bot check failed: ${reason}`);
    return exitCode;
  }

  const trace = process.env.DJONIK_TRACE === "1";
  /** #53 Session lifecycle evidence (reconnects, replacement, resubmission): content-free, always logged. */
  const logSessionLifecycle = (event: { type: string }) => console.log("[session]", JSON.stringify(event));
  const turnTelemetry = process.env.DJONIK_TURN_TELEMETRY === "1";
  let polling: Promise<unknown> = Promise.resolve();
  /** Set once serving has started; before that a failure simply ends `main` with its exit code. */
  let requestStop: ((reason: string, code: number) => void) | null = null;
  const djonikSession = createSessionManager(async () => {
    try {
      return await connectServingSession(anthropic, config, preflight, {
        turnSource: "telegram",
        onTrace: trace ? (event) => console.error("[trace]", JSON.stringify(event)) : undefined,
        onTurnTelemetry: turnTelemetry ? (summary) => console.error("[turn]", JSON.stringify(summary)) : undefined,
        onServing: (line) => console.log(line),
        // #53: content-free stream reconnect evidence, always on (counts/causes only, never content or ids).
        onStreamLifecycle: logSessionLifecycle,
        trelloHistoryField: trello.field,
      });
    } catch (error) {
      // A Session re-created after a dead stream must attest too; drift there means the remote release
      // changed under a running process — stop serving rather than answer from an unreviewed tuple.
      if (error instanceof ReleaseAttestationError) {
        console.error(error.message);
        requestStop?.("release_attestation_failed", EXIT_CONFIG);
      }
      throw error;
    }
  });

  // Serving evidence before the first update is polled: the attested tuple line is logged here.
  try {
    await djonikSession.getSession();
  } catch (error) {
    if (error instanceof ReleaseAttestationError) return EXIT_CONFIG;
    throw error;
  }


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
  // Every user-visible reply and notice renders through the one shared Telegram HTML path (telegramFormat.ts).
  const sendText = createFormattedTextSender(bot.api);
  const { onDispatch, onFailure } = createGroupDispatchHandlers({
    djonikSession,
    sendMessage: sendText,
    onGroupTelemetry: turnTelemetry ? (telemetry) => console.error("[group]", JSON.stringify(telemetry)) : undefined,
    onSessionRecovery: logSessionLifecycle,
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

  /**
   * Working Rhythm (#39), after the serving Session is attested and before polling starts. Two locks:
   * `DJONIK_WORKING_RHYTHM` (unset in production, so closed) and the serving turn runner's read-only
   * boundary, derived from the serving release (open for r27). With either closed nothing is constructed
   * or read (no Memory config read, no state file, no Trello facts, no model call, no timer); an allowed
   * user's old button gets the stale-button answer. Buttons are only shortcuts to ordinary conversation: a valid click
   * becomes a typed-equivalent turn through the same grouping buffer and FIFO Session.
   */
  const rhythm = startWorkingRhythm({
    env: process.env,
    readOnlyBoundary: SERVING_READ_ONLY_BOUNDARY,
    allowedUserId: telegramConfig.allowedUserId,
    createConfigSource: () =>
      createMemoryRhythmConfigSource({ reader: sdkRhythmMemoryReader(anthropic), memoryStoreId: release.session.memoryStoreId }),
    createStateStore: createFileRhythmStateStore,
    createFactCollector: config.trello
      ? () =>
          createRhythmFactCollector({
            reader: new TrelloWorkHistoryClient({ apiKey: config.trello!.apiKey, readToken: config.trello!.readToken }),
            log: (line) => console.log(line),
          })
      : undefined,
    runTurn: createSessionTurnRunner(djonikSession, logSessionLifecycle),
    send: createTelegramProactiveSender(bot.api, Number(telegramConfig.allowedUserId)),
    currentSessionId: () => djonikSession.currentSessionId(),
    answer: (query, alert) =>
      query.id === undefined ? Promise.resolve() : bot.api.answerCallbackQuery(query.id, alert ? { text: alert, show_alert: true } : undefined),
    clearButtons: (chatId, messageId) => bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } }),
    enqueueUserText: enqueueClickAfterPendingText(groupBuffer),
    log: (line) => console.log(line),
  });
  bot.on("callback_query:data", createCallbackListener(rhythm, { allowedUserId: telegramConfig.allowedUserId, log: (line) => console.warn(line) }));

  bot.catch((error) => {
    console.error("Unhandled Telegram bot error:", error.message);
  });

  const coordinator = createShutdownCoordinator({
    stopBackground: () => rhythm.stop(),
    stopPolling: () => bot.stop(),
    pollingDone: () => polling,
    flushIntake: () => groupBuffer.flushAll(),
    intakeIdle: () => groupBuffer.whenIdle(),
    inFlightChatIds: () => groupBuffer.inFlightChatIds(),
    notify: sendText,
    closeSession: () => djonikSession.closeIfOpen(),
    log: (line) => console.log(line),
    drainMs: config.drainMs,
  });
  let resolveExit: (code: number) => void = () => {};
  const exitCode = new Promise<number>((resolve) => (resolveExit = resolve));
  function stop(reason: string, code: number): Promise<void> {
    return coordinator.shutdown(reason, code).then((result) => resolveExit(result.exitCode));
  }
  requestStop = (reason, code) => void stop(reason, code);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (coordinator.stopping) {
        // A second signal skips the drain: the operator explicitly wants the process gone now.
        console.log(`[shutdown] second ${signal}: exiting without drain`);
        process.exit(130);
      }
      void stop(signal, 0);
    });
  }

  console.log("Starting Djonik Telegram adapter (long polling)...");
  polling = bot.start({
    onStart: () => console.log("Telegram adapter is running. Press Ctrl+C to stop."),
  });
  polling.then(
    () => {
      if (!coordinator.stopping) void stop("polling_stopped", 1);
    },
    (error: unknown) => {
      // 409: another poller took over this bot token (never serve from two instances); 401: bad token.
      const { reason, exitCode } = classifyPollingFailure(error);
      console.error(`[shutdown] polling failed: ${reason}`);
      void stop(reason, exitCode);
    },
  );

  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
