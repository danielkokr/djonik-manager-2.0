/**
 * Graceful stop of the Telegram serving process (#33).
 *
 * Order, each step bounded:
 *  1. stop long polling (grammY confirms the last received update offset to Telegram, so a successor
 *     instance does not receive it again) and wait for the in-progress update batch to finish;
 *  2. flush the grouping buffer — fragments already acknowledged to Telegram become their turn now;
 *  3. drain: wait for every in-flight turn (and its reply) up to `drainMs`;
 *  4. on drain timeout, tell each affected chat once that its reply was interrupted and to check before
 *     repeating (never a blind resend: a turn cut off mid-way may already have written to Trello);
 *  5. close the Session event stream and return the exit code.
 *
 * No step replays or resends a turn, and nothing here touches the Managed Session state.
 */

export const INTERRUPTED_TURN_NOTICE =
  "Джонік перезапускається і не встиг завершити відповідь на твоє останнє повідомлення. " +
  "Якщо там була зміна в Trello, спершу перевір, чи вона застосувалась, і лише потім повтори запит.";

export interface ShutdownDeps {
  stopPolling: () => Promise<unknown>;
  /** Settles when the polling loop (and the update batch it was handling) has finished. */
  pollingDone: () => Promise<unknown>;
  flushIntake: () => void;
  intakeIdle: () => Promise<void>;
  inFlightChatIds: () => number[];
  notify: (chatId: number, text: string) => Promise<unknown>;
  closeSession: () => void;
  log: (line: string) => void;
  drainMs: number;
  /** Bound for steps that should be near-instant (stopping polling, notifying). */
  stepTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ShutdownResult {
  exitCode: number;
  drained: boolean;
  interruptedChats: number;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/** Resolves `true` if `work` settles within `ms`, `false` on timeout; never rejects. */
async function within(work: Promise<unknown>, ms: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  let finished = false;
  const settled = work.then(
    () => (finished = true),
    () => (finished = true),
  );
  await Promise.race([settled, sleep(ms)]);
  return finished;
}

export interface ShutdownCoordinator {
  /** Starts (or joins) the one graceful stop; the first caller's reason and exit code win. */
  shutdown(reason: string, exitCode: number): Promise<ShutdownResult>;
  readonly stopping: boolean;
}

export function createShutdownCoordinator(deps: ShutdownDeps): ShutdownCoordinator {
  const sleep = deps.sleep ?? realSleep;
  const stepMs = deps.stepTimeoutMs ?? 10_000;
  let running: Promise<ShutdownResult> | null = null;

  async function run(reason: string, exitCode: number): Promise<ShutdownResult> {
    deps.log(`[shutdown] begin reason=${reason} drain_ms=${deps.drainMs}`);
    await within(Promise.resolve().then(deps.stopPolling), stepMs, sleep);
    await within(Promise.resolve().then(deps.pollingDone), stepMs, sleep);
    deps.flushIntake();
    const drained = await within(deps.intakeIdle(), deps.drainMs, sleep);
    let interruptedChats = 0;
    if (!drained) {
      const chats = deps.inFlightChatIds();
      interruptedChats = chats.length;
      await within(Promise.all(chats.map((chatId) => deps.notify(chatId, INTERRUPTED_TURN_NOTICE).catch(() => undefined))), stepMs, sleep);
    }
    deps.closeSession();
    deps.log(`[shutdown] end drained=${drained} interrupted_chats=${interruptedChats} exit=${exitCode}`);
    return { exitCode, drained, interruptedChats };
  }

  return {
    shutdown(reason, exitCode) {
      running ??= run(reason, exitCode);
      return running;
    },
    get stopping() {
      return running !== null;
    },
  };
}

/** Maps a polling failure to an exit code: 409 = another poller holds this bot token; 401 = bad token. */
export function classifyPollingFailure(error: unknown): { reason: string; exitCode: number } {
  const code = (error as { error_code?: unknown } | null)?.error_code;
  if (code === 409) return { reason: "telegram_conflict_another_poller", exitCode: 75 };
  if (code === 401) return { reason: "telegram_unauthorized", exitCode: 78 };
  return { reason: "polling_failed", exitCode: 1 };
}
