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

test("deploy script survives replacing itself and only reports success for the new revision's serving tuple", () => {
  // The checkout rewrites deploy.sh mid-run; a function body is parsed completely before it executes.
  assert.match(deployScript, /^main\(\) \{$/m);
  assert.match(deployScript, /^main "\$@"\nexit$/m);
  assert.ok(deployScript.indexOf("git checkout") > deployScript.indexOf("main() {"), "the checkout runs inside the pre-parsed function");
  // Success is the new process's attested tuple for exactly $REV, never an old process's [shutdown] line.
  assert.match(deployScript, /--since "@\$since"/);
  assert.match(deployScript, /\\\[release\\\] serving \.\* app=\$REV /);
  assert.match(deployScript, /systemctl is-active --quiet djonik-telegram/);
});

test("deploy script refuses a host/revision release mismatch BEFORE stopping the running process (docs/54 §16)", () => {
  // Rolling back to an r25 revision with DJONIK_EXPECTED_RELEASE=r26 still on the host would otherwise stop
  // the serving process and leave a new one that exits 78.
  const guard = deployScript.indexOf('"$DJONIK_EXPECTED_RELEASE" != "$serves"');
  const restart = deployScript.indexOf("systemctl restart djonik-telegram");
  assert.ok(guard > 0 && restart > guard, "the expected-release guard must run before the restart");
  assert.match(deployScript, /SERVING_RELEASE\.id/);
  // Enabling only survives reboots; the single restart is still the only thing that starts the unit.
  assert.ok(deployScript.indexOf("systemctl enable --quiet djonik-telegram") < restart);
  assert.doesNotMatch(deployScript, /enable --now/);
});

const bootstrap = readFileSync(join(repoRoot, "deploy", "bootstrap-host.sh"), "utf8");
const setSecrets = readFileSync(join(repoRoot, "deploy", "set-secrets.sh"), "utf8");

test("host bootstrap installs the one unit but never starts a poller, and exposes no inbound port but SSH", () => {
  assert.match(bootstrap, /install -m 0644 \/opt\/djonik\/app\/deploy\/djonik-telegram\.service \/etc\/systemd\/system\/djonik-telegram\.service/);
  assert.doesNotMatch(bootstrap, /systemctl (start|restart|enable)[^\n]*djonik/, "the first start belongs to deploy.sh, after the laptop adapter is stopped");
  assert.match(bootstrap, /ufw default deny incoming/);
  assert.match(bootstrap, /ufw allow OpenSSH/);
  assert.match(bootstrap, /useradd --system .*--shell \/usr\/sbin\/nologin djonik/);
  assert.match(bootstrap, /install -d -m 0700 -o root -g root \/etc\/djonik/);
  assert.match(bootstrap, /PasswordAuthentication no/);
  assert.match(bootstrap, /-s \/root\/\.ssh\/authorized_keys/, "key-only SSH is applied only when a key exists (no lock-out)");
  assert.doesNotMatch(bootstrap, /(KEY|TOKEN)=/, "the bootstrap writes no secret");
});

test("secrets are entered hidden, validated as plain tokens and written root-only 0600 in one atomic move", () => {
  assert.match(setSecrets, /read -rsp/);
  assert.match(setSecrets, /umask 077/);
  assert.match(setSecrets, /chmod 0600 "\$tmp"/);
  assert.match(setSecrets, /mv -f "\$tmp" "\$FILE"/);
  assert.match(setSecrets, /\^\[A-Za-z0-9:_\.\+-\]\+\$/, "only shell-inert characters, since deploy.sh sources the file");
  for (const key of ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "TRELLO_API_KEY", "TRELLO_READ_TOKEN"]) {
    assert.match(setSecrets, new RegExp(`SECRET=".* ${key} `), `${key} is never echoed`);
  }
  assert.doesNotMatch(setSecrets, /DJONIK_(AGENT|ENVIRONMENT|MEMORY_STORE|VAULT)_ID/, "resource ids come from the reviewed release, not the host");
});
