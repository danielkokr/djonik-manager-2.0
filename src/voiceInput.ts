import {
  TRANSCRIPTION_PROVIDER_ID,
  TranscriptionError,
  type AudioFormat,
  type Transcriber,
  type TranscriptionFailureCategory,
} from "./openAiTranscription.js";

/**
 * #49 Telegram voice/audio input: bounded download → transcription → one transcript that joins the EXISTING
 * ordered grouping pipeline as text. No PM logic, no second transport, no persistence: audio bytes live only in
 * memory for the duration of one request; the transcript lives only in the resolved promise and the Session turn.
 *
 * Authority is not decided here. A voice fragment carries the same Telegram forward metadata as any other
 * fragment (`telegramCli.baseFragment`), so a forwarded voice is `forwarded_source` and Daniel's own voice is an
 * ordinary `user_message` — never because of anything the transcript says.
 */

/** Telegram voice note or audio file. */
export type VoiceKind = "voice" | "audio";

/** Longest accepted recording, by Telegram's `duration`. Voice notes to a PM are short; this bounds paid minutes. */
export const MAX_VOICE_DURATION_SECONDS = 5 * 60;
/**
 * Largest accepted file. Well under the Bot API's 20 MB `getFile` limit and the provider's 25 MB limit; 5 minutes of
 * Telegram Opus is ~1–2 MB and of a 256 kbps MP3 ~10 MB.
 */
export const MAX_VOICE_BYTES = 10 * 1024 * 1024;

export type VoiceFailureReason =
  | "invalid_metadata"
  | "too_long"
  | "too_large"
  | "unsupported_format"
  | "download_failed"
  | "not_configured"
  | TranscriptionFailureCategory;

export const VOICE_FAILED_TEXT = "⚠️ Не зміг розшифрувати голосове. Надішли ще раз або текстом.";
export const VOICE_NOT_CONFIGURED_TEXT = "⚠️ Розшифровка голосових ще не налаштована. Напиши, будь ласка, текстом.";
export const VOICE_TOO_LONG_TEXT = `⚠️ Голосове задовге — розшифровую до ${MAX_VOICE_DURATION_SECONDS / 60} хв. Надішли коротше або текстом.`;
export const VOICE_TOO_LARGE_TEXT = `⚠️ Аудіофайл завеликий — розшифровую до ${MAX_VOICE_BYTES / (1024 * 1024)} MB. Надішли коротше або текстом.`;
export const VOICE_UNSUPPORTED_TEXT = "⚠️ Не можу розшифрувати цей аудіоформат. Надішли голосовим або текстом.";
/** Appended when the failed voice was grouped with other fragments: they were not processed either (#25 fail-closed). */
export const VOICE_GROUP_SUFFIX = " Повідомлення, надіслані разом із ним, я теж не обробив — надішли їх ще раз.";

/** A voice/audio input that did not produce a usable transcript. Its message is the fixed user-facing line. */
export class VoiceInputError extends Error {
  constructor(readonly reason: VoiceFailureReason) {
    super(
      reason === "not_configured" ? VOICE_NOT_CONFIGURED_TEXT
        : reason === "too_long" ? VOICE_TOO_LONG_TEXT
        : reason === "too_large" ? VOICE_TOO_LARGE_TEXT
        : reason === "unsupported_format" ? VOICE_UNSUPPORTED_TEXT
        : VOICE_FAILED_TEXT,
    );
    this.name = "VoiceInputError";
  }
}

/** The one user-visible line for a failed voice input; `fragmentCount > 1` says the rest of the group was dropped too. */
export function formatVoiceFailure(error: VoiceInputError, fragmentCount: number): string {
  return fragmentCount > 1 ? error.message + VOICE_GROUP_SUFFIX : error.message;
}

interface MinimalVoice {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface VoiceAttachment {
  kind: VoiceKind;
  fileId: string;
  durationSeconds: number;
  /** Telegram-reported size, when present (pre-download estimate only; the download re-checks). */
  fileSize: number | null;
  mimeType: string | null;
}

/**
 * Validates Telegram metadata BEFORE any download or paid call. Telegram always sends `duration` for voice/audio;
 * if it is missing or not a sane number we fail rather than guess the length of what we would pay to transcribe.
 */
export function resolveVoiceAttachment(kind: VoiceKind, media: MinimalVoice | undefined): VoiceAttachment {
  if (!media || typeof media.file_id !== "string" || !media.file_id) throw new VoiceInputError("invalid_metadata");
  const duration = media.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) throw new VoiceInputError("invalid_metadata");
  if (duration > MAX_VOICE_DURATION_SECONDS) throw new VoiceInputError("too_long");
  const fileSize = typeof media.file_size === "number" && Number.isFinite(media.file_size) ? media.file_size : null;
  if (fileSize !== null && fileSize > MAX_VOICE_BYTES) throw new VoiceInputError("too_large");
  return { kind, fileId: media.file_id, durationSeconds: duration, fileSize, mimeType: media.mime_type ?? null };
}

const MIME_FORMATS: Record<string, AudioFormat> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/x-opus+ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
};

const EXTENSION_FORMATS: Record<string, AudioFormat> = {
  ogg: "ogg", oga: "ogg", opus: "ogg", mp3: "mp3", m4a: "m4a", mp4: "mp4", wav: "wav", flac: "flac", webm: "webm",
};

/**
 * The provider container, from Telegram's `mime_type` or, when absent, the extension of Telegram's own `file_path`.
 * No sniffing and no conversion: an unknown/unsupported type fails visibly.
 */
export function audioFormatOf(mimeType: string | null, filePath: string | undefined): AudioFormat | null {
  const mime = mimeType?.split(";")[0].trim().toLowerCase();
  if (mime) return MIME_FORMATS[mime] ?? null;
  const extension = filePath?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return extension ? EXTENSION_FORMATS[extension] ?? null : null;
}

/** Downloads at most `maxBytes`; aborts as soon as the declared or streamed size exceeds it. Never logs bytes or URL. */
export async function downloadTelegramAudio(fileUrl: string, maxBytes: number = MAX_VOICE_BYTES, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(fileUrl, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new VoiceInputError("download_failed");
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new VoiceInputError("download_failed");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new VoiceInputError("too_large");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new VoiceInputError("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof VoiceInputError) throw error;
    throw new VoiceInputError("download_failed");
  }
  if (total === 0) throw new VoiceInputError("download_failed");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A transcript ready to become one text part in the grouped intake. */
export interface VoiceTranscript {
  kind: VoiceKind;
  text: string;
}

const MARKERS: Record<VoiceKind, { own: string; forwarded: string }> = {
  voice: { own: "Голосове повідомлення Daniel", forwarded: "Голосове повідомлення" },
  audio: { own: "Аудіофайл від Daniel", forwarded: "Аудіофайл" },
};

/**
 * Deterministic transcript marker. The words are the provider's, unedited. It does not claim accuracy. A forwarded
 * transcript is additionally wrapped by `forwardedSource.sourceText` (client data, not Daniel's command).
 */
export function transcriptText(transcript: VoiceTranscript, forwarded: boolean): string {
  const marker = forwarded ? MARKERS[transcript.kind].forwarded : MARKERS[transcript.kind].own;
  return `[${marker} · автоматична транскрипція, можливі помилки розпізнавання]\n${transcript.text}`;
}

/** Content-free per-input telemetry: never the audio, transcript, file id, URL or provider body. */
export interface VoiceTelemetry {
  kind: VoiceKind;
  forwarded: boolean;
  durationSeconds: number | null;
  bytes: number | null;
  provider: string;
  model: string | null;
  outcome: "transcribed" | "failed" | "duplicate_ignored";
  reason?: VoiceFailureReason;
  httpStatus?: number;
  attempts: number;
  transcriptChars?: number;
  latencyMs: number;
}

/**
 * Process-local guard against transcribing the same Telegram message twice (a redelivered update). Long polling
 * already confirms offsets, so this only bounds cost if that ever fails. Bounded: oldest keys are evicted.
 */
export class VoiceAdmission {
  private readonly seen = new Set<string>();
  constructor(private readonly capacity = 512) {}

  /** True the first time a chat/message pair is seen; false for a duplicate. */
  admit(chatId: number, messageId: number): boolean {
    const key = `${chatId}:${messageId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.capacity) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
}

export interface VoiceTranscriptionDeps {
  /** `null` when no transcription credential is configured. */
  transcriber: Transcriber | null;
  model: string | null;
  /** Resolves Telegram's `file_path` for a file id (`ctx.api.getFile`). */
  getFilePath: (fileId: string) => Promise<string | undefined>;
  /** Downloads the file at a Telegram `file_path` (bounded). */
  download: (filePath: string) => Promise<Uint8Array>;
  onTelemetry?: (telemetry: VoiceTelemetry) => void;
  now?: () => number;
}

/**
 * One voice/audio input → transcript, or a `VoiceInputError`. Metadata was validated before this is called; the
 * size is checked again against Telegram's `file_size`-less reality by the bounded download.
 */
export async function transcribeVoice(
  attachment: VoiceAttachment,
  forwarded: boolean,
  deps: VoiceTranscriptionDeps,
): Promise<VoiceTranscript> {
  const now = deps.now ?? Date.now;
  const started = now();
  let bytes: number | null = attachment.fileSize;
  let attempts = 0;
  const emit = (outcome: VoiceTelemetry["outcome"], extra: Partial<VoiceTelemetry> = {}) =>
    deps.onTelemetry?.({
      kind: attachment.kind,
      forwarded,
      durationSeconds: attachment.durationSeconds,
      bytes,
      provider: TRANSCRIPTION_PROVIDER_ID,
      model: deps.model,
      outcome,
      attempts,
      latencyMs: now() - started,
      ...extra,
    });

  try {
    if (!deps.transcriber) throw new VoiceInputError("not_configured");
    let filePath: string | undefined;
    try {
      filePath = await deps.getFilePath(attachment.fileId);
    } catch {
      throw new VoiceInputError("download_failed");
    }
    if (!filePath) throw new VoiceInputError("download_failed");
    const format = audioFormatOf(attachment.mimeType, filePath);
    if (!format) throw new VoiceInputError("unsupported_format");
    const audio = await deps.download(filePath);
    bytes = audio.byteLength;
    const result = await deps.transcriber({ bytes: audio, format });
    attempts = result.attempts;
    const text = result.text.trim();
    if (!text) throw new VoiceInputError("empty_transcript");
    emit("transcribed", { transcriptChars: text.length });
    return { kind: attachment.kind, text };
  } catch (error) {
    let failure: VoiceInputError;
    let httpStatus: number | null = null;
    if (error instanceof VoiceInputError) failure = error;
    else if (error instanceof TranscriptionError) {
      failure = new VoiceInputError(error.category);
      attempts = error.attempts;
      httpStatus = error.status;
    } else failure = new VoiceInputError("provider_error");
    emit("failed", { reason: failure.reason, ...(httpStatus === null ? {} : { httpStatus }) });
    throw failure;
  }
}
