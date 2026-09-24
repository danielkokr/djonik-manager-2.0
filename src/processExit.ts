/**
 * Natural exit for one-shot CLIs that finish after network requests (#33, docs/54 §3).
 *
 * Calling `process.exit()` right after a `fetch()` (the Anthropic SDK and the Trello client both use it)
 * races libuv handle teardown on Windows (nodejs/node#56645, fixed upstream in nodejs/node#61999): the
 * process prints its result and then aborts with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 * file src\win\async.c`, so the caller sees a crash code instead of the real result. Setting
 * `process.exitCode` and letting the event loop drain avoids the forced teardown on every platform.
 *
 * The watchdog is unref'd, so it never delays a clean exit; it only forces one if some handle keeps the
 * loop alive, so a check can never hang a deploy.
 */

export interface ProcessExitDeps {
  setExitCode: (code: number) => void;
  forceExit: (code: number) => void;
  logError: (message: string) => void;
  /** Schedules the unref'd watchdog; returns nothing observable. */
  schedule: (fn: () => void, ms: number) => void;
  watchdogMs: number;
}

export const DEFAULT_EXIT_WATCHDOG_MS = 10_000;

const realDeps: ProcessExitDeps = {
  setExitCode: (code) => {
    process.exitCode = code;
  },
  forceExit: (code) => process.exit(code),
  logError: (message) => console.error(message),
  schedule: (fn, ms) => setTimeout(fn, ms).unref(),
  watchdogMs: DEFAULT_EXIT_WATCHDOG_MS,
};

/** Sets the exit code from `result` (a rejection is exit 1 with its message) and lets the process end. */
export async function exitNaturally(result: Promise<number>, deps: ProcessExitDeps = realDeps): Promise<number> {
  let code: number;
  try {
    code = await result;
  } catch (error) {
    deps.logError(error instanceof Error ? error.message : String(error));
    code = 1;
  }
  deps.setExitCode(code);
  deps.schedule(() => deps.forceExit(code), deps.watchdogMs);
  return code;
}
