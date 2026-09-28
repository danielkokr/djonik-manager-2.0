/**
 * #49 transcription provider adapter: OpenAI `POST /v1/audio/transcriptions` over plain `fetch` (no SDK).
 * Provider decision and the documentation it rests on: docs/86 §5–§7.
 *
 * - Telegram voice notes (OGG/Opus) are sent as-is: the official SDK's own parameter documentation lists
 *   `ogg` among accepted formats, so there is no server-side conversion.
 * - The request carries only the audio bytes, the model id and a language hint. The response body is parsed
 *   for `text` only and never logged; thrown errors carry a bounded category, never provider text (a provider
 *   error body can echo request content).
 * - At most ONE retry, and only when the provider provably did not produce a transcript (no HTTP response, 429,
 *   5xx). A timeout is never retried: the provider may already have processed (and billed) the audio.
 */

export const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
/** Language hint for `gpt-transcribe` (`languages[]`, "possible languages"): Daniel speaks Ukrainian; clients may use English. */
export const TRANSCRIPTION_LANGUAGES = ["uk", "en"] as const;
/** Per attempt. Worst case download (30 s) + two attempts + 1 s pause = 111 s, inside the default 120 s shutdown drain. */
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 40_000;
export const TRANSCRIPTION_PROVIDER_ID = "openai";

export type TranscriptionFailureCategory =
  | "not_configured"
  | "timeout"
  | "network"
  | "rate_limited"
  | "provider_error"
  | "rejected"
  | "malformed_response"
  | "empty_transcript";

/** Content-free failure: `message` is fixed per category, never the provider's body or the audio/transcript. */
export class TranscriptionError extends Error {
  constructor(
    readonly category: TranscriptionFailureCategory,
    readonly status: number | null = null,
    readonly attempts = 0,
  ) {
    super(`transcription failed: ${category}${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "TranscriptionError";
  }
}

export interface TranscriptionAudio {
  bytes: Uint8Array;
  /** Provider-accepted container, derived from Telegram metadata (see `voiceInput.audioFormatOf`). */
  format: AudioFormat;
}

export type AudioFormat = "ogg" | "mp3" | "m4a" | "mp4" | "wav" | "flac" | "webm";

export interface TranscriptionResult {
  text: string;
  /** Paid provider requests actually sent for this audio (1 or 2). */
  attempts: number;
}

export type Transcriber = (audio: TranscriptionAudio) => Promise<TranscriptionResult>;

export interface OpenAiTranscriberOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Delay before the single retry; test seam. */
  sleep?: (ms: number) => Promise<void>;
}

const CONTENT_TYPES: Record<AudioFormat, string> = {
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  webm: "audio/webm",
};

/** The multipart body, exposed for request-shape tests. Filename extension + content type identify the format. */
export function buildTranscriptionForm(audio: TranscriptionAudio, model: string): FormData {
  const form = new FormData();
  const copy = new Uint8Array(audio.bytes.byteLength);
  copy.set(audio.bytes);
  form.append("file", new Blob([copy], { type: CONTENT_TYPES[audio.format] }), `voice.${audio.format}`);
  form.append("model", model);
  form.append("response_format", "json");
  // `gpt-transcribe` takes `languages[]`; older models take a single `language` ("don't send both").
  if (model === DEFAULT_TRANSCRIPTION_MODEL) for (const language of TRANSCRIPTION_LANGUAGES) form.append("languages[]", language);
  else form.append("language", TRANSCRIPTION_LANGUAGES[0]);
  return form;
}

/** `{ "text": string }` → trimmed text; anything else is malformed. Empty text is its own category. */
export function parseTranscriptionResponse(body: unknown): string {
  if (typeof body !== "object" || body === null || typeof (body as { text?: unknown }).text !== "string") {
    throw new TranscriptionError("malformed_response");
  }
  const text = (body as { text: string }).text.trim();
  if (!text) throw new TranscriptionError("empty_transcript");
  return text;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function createOpenAiTranscriber(options: OpenAiTranscriberOptions): Transcriber {
  const model = options.model ?? DEFAULT_TRANSCRIPTION_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function attempt(audio: TranscriptionAudio, attempts: number): Promise<{ retryable: TranscriptionError } | TranscriptionResult> {
    let response: Response;
    try {
      response = await fetchImpl(OPENAI_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: buildTranscriptionForm(audio, model),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) throw new TranscriptionError("timeout", null, attempts);
      return { retryable: new TranscriptionError("network", null, attempts) };
    }
    if (!response.ok) {
      // Drain without reading into anything we keep or log.
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) return { retryable: new TranscriptionError("rate_limited", 429, attempts) };
      if (response.status >= 500) return { retryable: new TranscriptionError("provider_error", response.status, attempts) };
      throw new TranscriptionError("rejected", response.status, attempts);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (isTimeout(error)) throw new TranscriptionError("timeout", null, attempts);
      throw new TranscriptionError("malformed_response", null, attempts);
    }
    try {
      return { text: parseTranscriptionResponse(body), attempts };
    } catch (error) {
      throw error instanceof TranscriptionError ? new TranscriptionError(error.category, null, attempts) : error;
    }
  }

  return async (audio) => {
    const first = await attempt(audio, 1);
    if (!("retryable" in first)) return first;
    await sleep(1000);
    const second = await attempt(audio, 2);
    if (!("retryable" in second)) return second;
    throw second.retryable;
  };
}

/**
 * The reviewed config contract. A dedicated variable, so an unrelated OpenAI credential on the host is never
 * picked up silently. Missing key → `null`: voice input then fails visibly per message; the process still serves.
 */
export function transcriberFromEnvironment(env: NodeJS.ProcessEnv): { transcriber: Transcriber; model: string } | null {
  const apiKey = env.DJONIK_TRANSCRIPTION_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.DJONIK_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
  return { transcriber: createOpenAiTranscriber({ apiKey, model }), model };
}
