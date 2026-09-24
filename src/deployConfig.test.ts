import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServingConfig } from "./servingRelease.js";
import { RELEASE_R25 } from "./release.js";

// #33 host invariants for the reviewed systemd unit and deploy script. They pin the properties the
// single-poller / graceful-drain design depends on, not the file's prose.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const unit = readFileSync(join(repoRoot, "deploy", "djonik-telegram.service"), "utf8");
const deployScript = readFileSync(join(repoRoot, "deploy", "deploy.sh"), "utf8");
const setting = (key: string) => [...unit.matchAll(new RegExp(`^${key}=(.*)$`, "gm"))].map((m) => m[1].trim());

test("exactly one long-polling process per unit: a plain (non-template) service with one ExecStart", () => {
  assert.deepEqual(setting("Type"), ["simple"]);
  assert.deepEqual(setting("ExecStart"), ["/usr/bin/node dist/telegramCli.js"]);
  assert.doesNotMatch(unit, /%i|@\.service/, "a template unit could run several pollers for one bot token");
});

test("stop drains before SIGKILL: the stop timeout exceeds the default drain plus step margins", () => {
  assert.deepEqual(setting("KillSignal"), ["SIGTERM"]);
  const [timeout] = setting("TimeoutStopSec").map(Number);
  const drainSeconds = loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x", DJONIK_APP_REVISION: "abc1234" }).drainMs / 1000;
  assert.ok(timeout >= drainSeconds + 20, `TimeoutStopSec=${timeout} must cover drain ${drainSeconds}s + polling/notify steps`);
});

test("configuration errors do not restart-loop; transient failures restart with a bounded burst", () => {
  assert.deepEqual(setting("Restart"), ["on-failure"]);
  assert.deepEqual(setting("RestartPreventExitStatus"), ["78"]);
  assert.ok(Number(setting("RestartSec")[0]) >= 10);
  assert.ok(Number(setting("StartLimitBurst")[0]) <= 10);
});

test("secrets come from a root-owned environment file, never from the unit itself", () => {
  assert.ok(setting("EnvironmentFile").includes("/etc/djonik/djonik.env"));
  assert.doesNotMatch(unit, /^Environment=.*(KEY|TOKEN)/m);
});

test("deploy script: release check before restart, one restart (stop then start), explicit app revision", () => {
  const check = deployScript.indexOf("node dist/releaseCheck.js");
  const restart = deployScript.indexOf("systemctl restart djonik-telegram");
  assert.ok(check > 0 && restart > check, "the new revision's release must attest before the running process is touched");
  assert.doesNotMatch(deployScript, /systemctl start /, "never start a second instance next to the running one");
  assert.match(deployScript, /DJONIK_APP_REVISION=\$REV/);
  assert.match(deployScript, /git status --porcelain/, "a dirty checkout is never deployed");
  assert.match(deployScript, /^set -euo pipefail$/m);
});
