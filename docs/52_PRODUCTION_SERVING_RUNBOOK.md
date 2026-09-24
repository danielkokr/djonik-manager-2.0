# Djonik production serving runbook (#33)

Date: 2026-09-24. Status: **§4 Steps 1–2 executed** (Agent v26 created and attested; this revision serves r26) and the serving-boundary smoke passed on a validation Session — [docs/53](53_ISSUE_33_R26_CONTROLLED_CUTOVER.md). **Host setup (§2) and deploy (§3, §4 Step 3) are not executed**: they wait for the one Product Owner action in [docs/54](54_ISSUE_33_ALWAYS_ON_HOST_AND_TELEGRAM_CUTOVER.md) §18 (create the server). §2, §3, §5 and §6 below are updated to the scripts checked in docs/54. Every step marked **[AUTH]** is a live change that needs explicit Product Owner authorization; steps marked **[READ]** are read-only.

Design and rationale: [docs/51](51_ISSUE_33_PRODUCTION_RELEASE_HARDENING.md). Source of truth for what is served: `src/release.ts` (`SERVING_RELEASE`).

## 0. Invariants (never violate during any step below)

1. **One poller per bot token.** Never start a second adapter while another runs — not the laptop, not a second host, not a second unit. Stop the old one first.
2. **Pinned, attested serving.** A process serves only the release compiled into its revision. It pins `{agent id, version}` and refuses to start (exit 78) if the live Agent version or the created Session differs from the release.
3. **No replay.** Rollout, rollback and recovery never resend a user turn. A turn cut off by a stop gets an honest notice; Daniel decides whether to repeat after checking Trello.
4. **Rollback changes future turns only.** It cannot undo a Trello/Memory write that already happened.
5. **No secret in a log, commit, URL or Agent config.** Startup logs are identifiers, versions and hash prefixes only.

## 1. What a healthy start looks like

```text
[release] preflight release=r26 app=<commit> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26
[release] serving release=r26 app=<commit> agent=agent_01WGRHDBjQa3eMhoGJMmQ1dh@26 model=claude-sonnet-5/medium/standard system=3e204453c82c skill_pins=explicit skills=task-management@skver_01CJQk…,…,work-review@skver_015LYz… specialist=agent_01KNiQDzzPjaMU6LLF4mU6uM@4 builtin=edit,glob,grep,read,write custom_tools=trello_work_history#dcf099612535 memory=read_write session=sesn_… trello_history=ok/expires=never
Starting Djonik Telegram adapter (long polling)...
Telegram adapter is running. Press Ctrl+C to stop.
```

The `[release] serving` line is the **serving evidence** #33 asks for: it is written only after the provider's own Session snapshot matched the release. The Session also carries metadata `source=telegram, release=<id>, app_revision=<commit>`, so it is identifiable later in the Console/API.

Exit codes: `78` configuration or release mismatch (do not restart; fix config or revision), `75` another poller holds the bot token, `1` transient failure (supervisor restarts), `0` normal stop, `130` forced stop (second signal).

## 2. Host setup (Hetzner Cloud CX23 + Ubuntu 24.04 LTS + systemd) [AUTH: account creation, secrets upload]

Choice and research: [docs/54](54_ISSUE_33_ALWAYS_ON_HOST_AND_TELEGRAM_CUTOVER.md) §4–§7.

1. **[PO, paid]** Create one Hetzner Cloud server: type **CX23**, location `fsn1` (else `nbg1`/`hel1`), image **Ubuntu 24.04**, public IPv4 + IPv6, your SSH public key, no backups/volumes.
2. As root on the server:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/danielkokr/djonik-manager-2.0/main/deploy/bootstrap-host.sh -o /root/bootstrap-host.sh
   bash /root/bootstrap-host.sh
   ```
   It installs Node 24 LTS (NodeSource, `/usr/bin/node`) and git, enables unattended security upgrades, creates the system user `djonik` (no login shell), clones the public repository to `/opt/djonik/app`, creates `/etc/djonik` (root, 0700), installs the unit **without enabling or starting it**, allows only SSH inbound (`ufw`), and makes SSH key-only (only if root has an authorized key). Re-running is safe.
3. `bash /opt/djonik/app/deploy/set-secrets.sh` writes `/etc/djonik/djonik.env` (root, `0600`). Values are typed, secret ones hidden, never in shell history:
   ```text
   ANTHROPIC_API_KEY  TELEGRAM_BOT_TOKEN  TELEGRAM_ALLOWED_USER_ID  TRELLO_API_KEY
   TRELLO_READ_TOKEN  TRELLO_READ_TOKEN_EXPIRES_AT (never)  DJONIK_EXPECTED_RELEASE (r26)
   ```
   Do not put `DJONIK_AGENT_ID`/`…_ID` here: ids come from the reviewed release.

Fallback host (**Fly.io, one Machine**; changed from Railway in docs/54 §4, because a single Fly Machine is replaced stop-before-start, while Railway and Render start the new deployment before stopping the old one): `fly launch --ha=false` (the default creates two Machines, i.e. two pollers), no `[http_service]`, `kill_timeout = 150`, `auto_stop_machines = "off"`, restart policy `on-failure`, the same variables via `fly secrets set`, and `DJONIK_APP_REVISION` set explicitly. A Dockerfile/`fly.toml` is added only if this fallback is chosen; re-check Fly prices then (memory price changes on 2026-10-01).

## 3. Deploy a revision [AUTH]

`deploy/deploy.sh <full-commit-sha>` performs, in order:
1. fetch;
2. detached checkout of exactly that commit;
3. refuse a dirty tree;
4. `npm ci`;
5. `npm run build`;
6. **`node dist/releaseCheck.js`** — read-only; aborts the deploy on mismatch, so the running process is untouched;
7. **the host's `DJONIK_EXPECTED_RELEASE` must equal the release this revision serves** — otherwise it aborts with the fix to apply, and the running process is untouched (docs/54 §16);
8. record `DJONIK_APP_REVISION`;
9. `systemctl enable` (reboot survival; starts nothing), then `systemctl restart` — graceful stop of the old process, then start;
10. **wait for the new process's own `[release] serving … app=<sha>` line**, for up to 90 s while the unit stays active. Otherwise it exits 1 with the relevant `[release]`/`[shutdown]` lines.

The script body is one function, so replacing `deploy.sh` during the checkout cannot corrupt the running script (docs/53 §13).

The first deploy on a new host is the same command: it enables and starts the unit. **Before it, stop the laptop adapter** (invariant 1).

Provider-side evidence, independent of host logs (read-only): `npm run release:check -- r26 --serving` re-reads the newest `source=telegram, release=r26` Session and attests it like startup does (docs/54 §12).

## 4. The #33 cutover — one controlled operation with two checkpoints

> **Done 2026-09-24 ([docs/53](53_ISSUE_33_R26_CONTROLLED_CUTOVER.md)):** Step 1 (v26 created from v25 with the generated body; `release:check r26` OK; v25 unchanged) and Step 2 (`SERVING_RELEASE = RELEASE_R26`). The Agent's latest version is now **26**. What remains is Step 3 (host deploy) and Checkpoint A, which provides the real Telegram serving evidence. Provider fact learned at the first attestation: a Session snapshot reports each explicitly pinned coordinator Skill as an internal numeric version, not its `skver_` id. The release records that spelling per pin (`sessionVersion`), and attestation accepts exactly the two spellings of the pinned version (docs/53 §4).
>
> **Hazard since v26 exists:** an adapter from a revision before `15ca0c7` creates Sessions from the unpinned agent id, so it would now serve v26 unattested. Never start such an old revision.

**Preconditions [READ]:**
- `npm run release:check -- r25` → `OK` (production is still exactly v25).
- The Agent's current latest version is **25** (`agents.retrieve` without version). If anything else created a v26, stop and re-plan: the version number in `RELEASE_R26` must match what the update produces.
- No adapter is running anywhere (laptop included). Check: no `node … telegramCli` process and no recent `[release] serving` line.
- The Trello read token was rotated per §5, and its expiry is recorded.
- The serving-boundary smoke budget (docs/51 §18) is authorized.

**Step 1 — create Agent v26 [AUTH, remote write, zero inference]**
1. `npm run release:check -- r26 --plan --from 25 > v26-update.json`. This prints the exact body; no request is made. It contains `version: 25` (concurrency precondition), the five pinned Skills, and the full `tools` list: the built-in allowlist, `trello_work_history`, and the unchanged Trello and Calendar toolsets. Model, system, MCP servers and the specialist roster are omitted, which preserves them.
2. Send it as `client.beta.agents.update("agent_01WGRHDBjQa3eMhoGJMmQ1dh", body)`.
3. `npm run release:check -- r26` → must print `OK agent=…@26`. On mismatch, do not continue. v26 is unused by every pinned process (they serve v25), so a bad v26 harms nothing. Fix it by a further update (v27) and update `RELEASE_R26.agent.version` in review.

Why this is safe to do before the app flip: every process on this revision pins v25. Only an old, unpinned adapter build would pick up v26, which is why the "no adapter running" precondition matters.

**Step 2 — flip the release in source [AUTH: commit/push]**
One reviewed commit: `export const SERVING_RELEASE = RELEASE_R26;` in `src/release.ts`, plus the roadmap/architecture current-state notes. Run `npm test`, `npm run typecheck` and `git diff --check`.

**Step 3 — deploy [AUTH]**
Stop the laptop adapter, then `deploy/deploy.sh <commit-sha>` on the host; the first run also enables and starts the unit (docs/54 §10). Confirm that the `[release] serving release=r26 … skill_pins=explicit … trello_history=ok/…` line appears.

**Checkpoint A — host serving, no traffic yet.** If the line is missing or the process exited 78, go to §6 (rollback). Nothing was served.

**Step 4 — serving-boundary smoke [AUTH, paid, budget in docs/51 §18]**
Daniel sends the planned messages through Telegram. Run with `DJONIK_TURN_TELEMETRY=1` for this window (a content-free `[turn]` line per turn), then remove it.

**Checkpoint B — accept or roll back.**

## 5. Trello read-token rotation [AUTH]

The current token expires around **2026-10-22**. Recommended replacement: a read-only token without expiry, revocable at any time.

1. As Daniel, open `https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&name=Djonik%20work%20history&key=<TRELLO_API_KEY>` and approve. The page shows the token once.
2. On the host: `deploy/set-secrets.sh TRELLO_READ_TOKEN TRELLO_READ_TOKEN_EXPIRES_AT` (token hidden; expiry `never`); the other values are kept. Restart the adapter with `systemctl restart djonik-telegram` (this starts a new Session). The next start shows `trello_history=ok/expires=never`.
3. Revoke the old token in Trello → Account → Applications.

Decision rationale (never vs 30-day) and the current token's measured scope (read-only) and expiry (2026-10-22 07:44 UTC): docs/54 §9. Alternative if the PO prefers expiring tokens: `expiration=30days`, record the date in `TRELLO_READ_TOKEN_EXPIRES_AT`, and add a calendar reminder 7 days ahead. Startup warns once within 7 days of expiry.

**If the token fails** (expired, revoked or rejected): Djonik keeps serving. Weekly-review turns answer that the history is unavailable, and the next start logs `[release] warning Trello work history is unauthorized`. Fix it by rotating the token. No redeploy is needed, only a restart.

## 6. Rollback [AUTH]

| Situation | Action | Agent write? |
|---|---|---|
| r26 misbehaves after the flip | First `deploy/set-secrets.sh DJONIK_EXPECTED_RELEASE` → `r25`, then `deploy/deploy.sh 15ca0c711d9bef9873dd688121dfcce483641204` (the last r25 revision). That revision pins **v25**, which still exists unchanged. Without the first step `deploy.sh` refuses before touching the running process (docs/54 §16) | No |
| v26 read-back mismatch (Step 1) | Do not flip. Leave v26 unused, or supersede it with v27 | Optional |
| Host broken | Stop the host unit (`systemctl disable --now djonik-telegram`), then start the laptop adapter from a pinned revision. Never run both | No |
| Bad release on the laptop, before hosting | Check out the previous revision and run `npm run telegram` | No |

A rollback starts a new Session. Conversation context from the rolled-back Session is not carried over; Memory persists (docs/51 §11).

## 7. Routine operations

- **Restart:** `systemctl restart djonik-telegram`. The old process stops polling, drains in-flight turns for up to 120 s, and only then does the new one start.
- **Stop:** `systemctl stop djonik-telegram`. A second Ctrl+C or signal skips the drain.
- **Logs:** `journalctl -u djonik-telegram`. Lines contain `[release]`, `[shutdown]`, `[group]`/`[turn]` (opt-in telemetry). They never contain message text.
- **Status:** `systemctl status djonik-telegram`. After 5 restarts in 10 minutes systemd gives up. Run `journalctl` to see why.
- **409 conflict in the log** (`telegram_conflict_another_poller`): another adapter is polling this bot token. Find and stop it. This process has already drained and exited 75.
- **Serving evidence:** `npm run release:check -- r26 --serving` (read-only) prints the hosted Session id and attests it.
- **Cost note:** host ≈ €5.5–6/month (Hetzner CX23, docs/54 §17), recorded next to token telemetry. Inference is billed per turn as before; an idle serving Session is not `running` (its `stats.active_seconds` does not grow while idle).
