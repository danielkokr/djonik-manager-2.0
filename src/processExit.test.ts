import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitNaturally, type ProcessExitDeps } from "./processExit.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function fakeDeps() {
  const calls = { exitCode: [] as number[], forced: [] as number[], errors: [] as string[], scheduled: [] as Array<{ fn: () => void; ms: number }> };
  const deps: ProcessExitDeps = {
    setExitCode: (code) => calls.exitCode.push(code),
    forceExit: (code) => calls.forced.push(code),
    logError: (message) => calls.errors.push(message),
    schedule: (fn, ms) => calls.scheduled.push({ fn, ms }),
    watchdogMs: 10_000,
  };
  return { deps, calls };
}

test("exitNaturally sets the exit code instead of forcing an exit", async () => {
  for (const code of [0, 2, 78]) {
    const { deps, calls } = fakeDeps();
    assert.equal(await exitNaturally(Promise.resolve(code), deps), code);
    assert.deepEqual(calls.exitCode, [code]);
    assert.deepEqual(calls.forced, [], "no forced exit while the loop can drain");
  }
});

test("a failure still exits non-zero: a rejection becomes exit 1 with its message", async () => {
  const { deps, calls } = fakeDeps();
  assert.equal(await exitNaturally(Promise.reject(new Error("network down")), deps), 1);
  assert.deepEqual(calls.exitCode, [1]);
  assert.deepEqual(calls.errors, ["network down"]);
});

test("the watchdog forces the same code only if the loop never drains", async () => {
  const { deps, calls } = fakeDeps();
  await exitNaturally(Promise.resolve(78), deps);
  assert.equal(calls.scheduled.length, 1);
  assert.equal(calls.scheduled[0].ms, 10_000);
  calls.scheduled[0].fn();
  assert.deepEqual(calls.forced, [78], "a hang can never mask or change the check result");
});

test("release:check never calls process.exit() (Windows libuv abort after fetch, docs/54 §3)", () => {
  const source = readFileSync(join(repoRoot, "src", "releaseCheck.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /process\.exit\(/);
  assert.match(source, /exitNaturally\(main\(\)\)/);
});

test("a real process that fetched over keep-alive exits by itself, promptly, with its code", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const script = [
    `import { exitNaturally } from ${JSON.stringify(join(repoRoot, "src", "processExit.ts"))};`,
    `const main = async () => { const r = await fetch("http://127.0.0.1:${port}/"); await r.text(); return 78; };`,
    `void exitNaturally(main());`,
  ].join("\n");
  const started = Date.now();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: repoRoot, stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (exitCode) => resolve(exitCode));
    });
    assert.equal(code, 78);
    // Well under the 10 s watchdog: the loop drained naturally rather than being forced.
    assert.ok(Date.now() - started < 8_000, `exit took ${Date.now() - started} ms`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
