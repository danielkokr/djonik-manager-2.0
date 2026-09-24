# #33 — Production release hardening and serving-boundary preparation

Date: 2026-09-24. Canonical issue: [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33) (NOW per docs/02). Base: `origin/main` = `c50e735` (#38 closeout, #33 promotion).

**Scope of this step:** source and offline changes, plus read-only provider GETs.

**What did not happen:**
- no Agent, Skill, Memory, vault, Session or Trello write;
- no paid inference;
- no deploy;
- no secret change;
- no commit or push.

**Read-only access used:**
- `agents.retrieve` of v25, of the #36 candidate and of the specialist;
- `skills.retrieve` of the six Skills;
- `environments.retrieve`;
- `sessions.retrieve` of the existing smoke Session `sesn_01KBcYnkpka5aP8e9q3WqAWQ`;
- `sessions.list`;
- one Telegram `getMe` with a deliberately fake token, to exercise the startup refusal path.

No Session was created. Re-listing confirmed that the newest Session is still `sesn_01KBcY…` from 2026-09-23.

## 1. Executive result

The source tree now has one explicit release model and a fail-closed serving boundary.

- **Release unit:** the provider's **Agent version**, made immutable by explicit `skver_` pins. It is bound in reviewed app source (`src/release.ts`) to the app revision and the Session resources.
- **Pinned Sessions:** every serving Session is created with `agent: {type: "agent", id, version}`. `latest` is never served by accident.
- **Two-phase attestation, fail-closed (exit 78):**
  - preflight: a GET of the pinned Agent version, before any Session exists;
  - serving evidence: the created Session read back with `sessions.retrieve` (the provider's own persisted snapshot), checked before its event stream opens;
  - then one content-free serving-tuple line.
- **Graceful stop:**
  - polling stops first, which confirms the Telegram offset;
  - accepted fragments are flushed, not dropped;
  - in-flight turns drain with a bound;
  - after a timeout, affected chats get an honest "check before repeating" notice;
  - 409 and 401 lead to a clean exit instead of today's zombie process.
- **Target release r26** is fully specified and tested: `managed-agents/djonik.md` plus `RELEASE_R26`, the exact update body generated from source, and a read-only `release:check`. Creating Agent v26 is the only remote write the cutover needs.
- **Host:** recommendation, systemd unit, deploy script and runbook ([docs/52](52_PRODUCTION_SERVING_RUNBOOK.md)).

Checks:

| Check | Result |
|---|---|
| `npm test` | 631/631 pass (baseline `origin/main`: 557) |
| `npm run typecheck` | clean |
| `npm run build` | compiles to `dist/`, which runs under plain `node` |
| `git diff --check` | clean |

The attestation was also run against **live** read-backs, and every result was as expected:
- r25 vs live v25 → no mismatch;
- r26 vs live v25 → exactly the three intended differences;
- the `read_only` smoke Session → exactly one Memory-access mismatch;
- the #36 candidate's custom tool → canonically identical to source.

**Verdict:** READY FOR CONTROLLED CUTOVER. This is source readiness. The cutover itself needs the Product Owner authorizations in §18.

## 2. Assumptions challenged

| Proposed / assumed | Finding | Decision |
|---|---|---|
| "Create a separate release manifest" | The provider already has an immutable release primitive, the Agent version. A new manifest file format would duplicate the Agent config and drift. What the Agent version cannot hold (app revision, env/vault/Memory mode) must live somewhere reviewed. | No new manifest format. A typed, tested `src/release.ts` holds the *expectation*. `managed-agents/djonik.md` stays the config source, and a test keeps the two in lockstep. |
| "Pin Skills with `agent_with_overrides` and skip v26" | The SDK and docs support per-Session `skills`/`tools` overrides. However, the docs position overrides for "try a different model or grant an extra tool in one session", and a `model` override silently drops `effort`. Serving from overrides would make the Console's Agent differ from what runs, splitting configuration between the Agent and the app. | Rejected. v26 is the Claude-native way. |
| "v26 is obviously required" | Verified, not assumed. A Session snapshot records the literal `"latest"` for such Skills (read-back of `sesn_01KBcY…`), so a v25 Session cannot prove which Skill content it serves. Today all four `latest` refs happen to resolve to the accepted versions. | v26 is required for immutability (§5). Until then, r25 is served honestly as `latest-resolved`: startup proves the resolution and flags the weaker pin. |
| "Session must be persisted and resumed across restarts" | Resuming would re-attach to a Session pinned to a possibly older release. It would also need to rebuild in-process #40/#32 lifecycle state from an unknown mid-turn state, which risks mutation replay. | Rejected. The Session is deliberately process-scoped and continuity comes from Memory (§11). |
| "Single instance needs a lock / leader election" | Telegram itself arbitrates. The hazard is overlap during a deploy: the old instance's last update is re-delivered to the new one if the new one polls before the old one confirms its offset. | No lock. The host must stop before it starts (systemd restart). The code stops polling first and exits cleanly on 409 (§13). |
| "Railway" as the obvious host | Railway starts the new deployment before it sends SIGTERM to the old one, so overlap exists by design. | Recommended: a small VPS with systemd (stop-then-start by construction). Railway is the fallback, with a documented residual risk (§15). |
| "`bash` stays because it was default" | Nothing accepted needs it. It was used once to try to work around a tool boundary (docs/34). Memory and Skills need only file tools. | Dropped in r26 together with `web_fetch`/`web_search` (§8). |
| "Accepted #36 means attach it" | Checked on its merits: the runtime already carries it, it is read-only, the relay is verified with a safe fallback, and it is named in the #33 acceptance smoke. | Include in r26, validated by the one work-review smoke turn (§7). |
| "Local `.env` holds the `DJONIK_*` ids" | Host-configured ids let a typo serve a different Agent or Memory. | Ids come from the reviewed release. Legacy env ids are allowed only if they are equal (drift → exit 78). |
| Deployments API as the release unit | `beta.deployments` are scheduled Session templates (cron + initial events), not an interactive serving primitive. | Not used, consistent with docs/01 §10. |

## 3. Final release model

```text
release (src/release.ts, reviewed, compiled into the app revision)
 ├─ Agent id + exact version      ← provider-immutable snapshot:
 │     model/effort/speed, system, skills (explicit skver_), tools, custom tools,
 │     MCP servers + toolset overrides, specialist roster pin (id+version)
 ├─ Session resources             ← environment, single vault, Memory store + access mode
 └─ expected hashes               ← system SHA-256; custom-tool schema/description (canonical)
app revision (git commit)          ← selects exactly one release (SERVING_RELEASE)
```

- `managed-agents/djonik.md` is the declarative source of the *target* Agent version. `src/release.test.ts` asserts that r26 equals it: prompt SHA, model, Skill pins, roster, MCP, Trello write surface and custom tool.
- `SERVING_RELEASE` is a compile-time constant, not an env var: a host cannot select an unreviewed release. `DJONIK_EXPECTED_RELEASE` lets the host *assert* which release a deployed revision serves.
- Every serving Session is tagged with metadata `{source, release, app_revision}`, which closes the docs/50 §5.B gap ("Telegram-created Sessions cannot be identified").

## 4. Exact tuples

| Field | r25 — current production / rollback | r26 — #33 target |
|---|---|---|
| Agent | `agent_01WGRHDBjQa3eMhoGJMmQ1dh` **v25** | same id, **v26** (not yet created) |
| Model | `claude-sonnet-5`, effort `medium`, speed `standard` | same |
| System | SHA-256 `3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6` (3529 B) | same (prompt unchanged) |
| task-management | `latest` → `skver_01CJQkVY1kp1urhBWQgHUYxW` | `skver_01CJQkVY1kp1urhBWQgHUYxW` |
| daily-planning | `latest` → `skver_01EL7d3fy4WWYBSsD3PmK9LQ` | `skver_01EL7d3fy4WWYBSsD3PmK9LQ` |
| weekly-planning | `latest` → `skver_01FdtnnkbePBjNJGTuJyAvhw` | `skver_01FdtnnkbePBjNJGTuJyAvhw` |
| studio-intake | `latest` → `skver_018sJv1GCnzfZRG4NbExbAzj` | `skver_018sJv1GCnzfZRG4NbExbAzj` |
| work-review | — | `skill_0169h7GYNYUDDDZteDCUV2fE` @ `skver_015LYzVdivGGMsBpuki4kW4S` |
| Specialist | `agent_01KNiQDzzPjaMU6LLF4mU6uM` v4 (Skill `skver_01JLTtMvUgfEqdcBBGj4WGVm`) | same |
| Built-in tools | all eight, default-enabled, `always_allow` | `read, write, edit, glob, grep` (allowlist) |
| Custom tools | none | `trello_work_history` (canonical schema SHA `dcf09961…`, = source) |
| MCP | trello (writes: only `trelloWriteCard`), Calendar default-disabled | same |
| Session | env `env_01LVWPmvP5F3fLy28EaycVU2`, vault `vlt_011Cf5Ju4bN6RhVP7DnA1ZA4`, Memory `memstore_01WViYK3WQvGEgojB2GiaDFq` `read_write` | same |
| App runtime | this revision (#31/#32/#40/#36/#37/#38 + #33) | same revision family, `SERVING_RELEASE = RELEASE_R26` |

Live read-back 2026-09-24: the four `latest` references resolve to exactly the r25 column. v25 has an empty `metadata` and the Calendar toolset disabled. No v26 exists (`release:check r26` → "version 26 does not exist").

## 5. v25 vs v26

**v26 is required.** The reason is not "we planned it" but three measured facts:

1. **Immutability:** v25's `latest` references mean any future Skill upload silently changes what new Sessions load. The Session snapshot cannot prove the served Skill content because it records `"latest"`.
2. **#36:** the accepted capability can reach production only through the Agent's `tools` and `skills`.
3. **Toolset:** narrowing the built-in tools is an Agent-level setting.

The update changes only `skills` and `tools`, both full-replacement lists. `model`, `system`, `mcp_servers` and `multiagent` are omitted and therefore preserved. It carries the concurrency precondition `version: 25`. The body is generated from source (`npm run release:check -- r26 --plan --from 25`), and `release.test.ts` proves that applying it to v25 yields exactly r26.

**Until v26 exists, this revision serves r25.** The Session is pinned to v25, startup proves that each `latest` still resolves to the accepted `skver_`, and the tuple shows `skill_pins=latest-resolved`. The app can therefore run safely today, and the later flip is one reviewed line.

## 6. Skill pinning design

- The type makes the difference explicit: `pin: {kind: "explicit", version}` or `{kind: "latest", expectedResolved}`.
- `explicit` must match the snapshot exactly. `latest` in a snapshot where an explicit pin is expected is rejected.
- `latest` (r25 only) must appear as `latest` **and** its current `latest_version_id`, read at startup, must equal `expectedResolved`. An unknown resolution counts as a mismatch.
- Skill sets are compared exactly, so a missing or unexpected Skill fails.
- The specialist's own Skill pin is checked inside the Session's resolved roster.
- Repo parity: `release.test.ts` checks that the SHA-256 prefixes of `.claude/skills/{task-management,daily-planning,weekly-planning,work-review}/SKILL.md` equal the hashes recorded at sync (docs/42, docs/32). A repo edit without a new Skill version therefore fails the suite.

## 7. #36 decision: INCLUDE IN TARGET RELEASE (r26)

Evidence for including it:
- **Accepted behavior:** the docs/32 live diagnostic passed every #36 and #40 invariant.
- **Runtime already present:** every Session already registers the #40 per-id lifecycle for `trello_work_history`, and the Telegram path already executes it with `executeTrelloWorkHistoryFromEnvironment`.
- **Minimal write surface:** the tool is GET-only, its credentials go only in the Authorization header, and it has no Trello, Memory or Calendar write. Relay is exact only for one verified same-turn result; every other shape falls back to the coordinator's own reply (`unverified`).
- **Roadmap and issue intent:** docs/02 row 7 and the #33 comments say to promote #36, #37 and #38 together. #33 acceptance item 4 already includes one work-review smoke turn.

Evidence of risk, and how it is bounded:
- The combination of Sonnet 5 medium with the v25 prompt, the Skill and the tool is untested live. docs/32 used Haiku. The one smoke turn in §18 is the gate.
- Production would depend on the Trello read token. Missing credentials refuse startup, because that is a deploy error. An expired or revoked token degrades visibly: the per-turn "history unavailable" answer plus a startup warning (§14).

Excluding it would require yet another Agent version later, which means another cutover, for a capability already accepted and already carried by the runtime.

Attestation guarantees consistency both ways:
- r26 requires the tool to be present and canonically identical to `TRELLO_WORK_HISTORY_TOOL`;
- r25 treats its presence as drift;
- any custom tool this app cannot execute is rejected, because it would stall on `requires_action`.

## 8. Built-in toolset: allowlist `read, write, edit, glob, grep`; drop `bash`, `web_fetch`, `web_search`

Dependencies, per the official docs:
- attached Skills are loaded with `read` (a `tools` override that clears tools is rejected when Skills exist, "because skills require the read tool");
- Memory is a mounted directory read and written "with the standard agent toolset" (`read`, `write`, `edit`; `glob`/`grep` for lookup);
- `read_write` Memory stays production mode.

Nothing accepted uses the other three:
- The prompt and Skills never mention shell or web tools (grep of `managed-agents/djonik.md` and `.claude/skills/*`).
- docs/04 records no retained use of `web_fetch`/`web_search`.
- `bash` has one recorded use: the docs/34 attempt to `curl` Trello around the MCP boundary, which the Skill forbids. It was stopped only by the environment's egress allowlist. Live environment: `networking: limited`, `allowed_hosts: []`.
- `web_fetch`/`web_search` run on Anthropic's servers and are *not* limited by that allowlist (docs, Tools page). Under prompt injection from a PDF, a screenshot or Trello text, they are the one open path to send context outward.

This supersedes docs/04's earlier "no built-in tool should be disabled on this evidence". That statement was a token-cost judgment made before the docs/34 evidence and before the Memory/Skill tool dependencies were documented.

Every enabled tool keeps `always_allow`. The client cannot answer a tool confirmation, so attestation rejects any enabled tool whose effective policy is not `always_allow`, including `always_ask` or `auto` on a Trello write.

Residual risk: Memory reads now go through `read`/`glob`/`grep` instead of an occasional `ls` via bash. The §18 smoke checks that no tool error occurs.

## 9. Session pinning (implemented)

- `DjonikSessionOptions.agentVersion` → `sessions.create({agent: {type: "agent", id, version}})` (official form; docs: "pin a session to a specific agent version").
- `metadata` → `{source: "telegram"|"diagnostic", release, app_revision}` (≤16 pairs, values ≤512 chars).
- `attestSession(session)` runs after create and **before** `events.stream`. The serving path reads the Session back with `sessions.retrieve(id)` and attests that persisted snapshot, not the create response. Throwing aborts the connection, so no stream is opened and no message is sent.
- `connectServingSession()` wires these from the release: Agent id and version, environment, vault, Memory store and `read_write` access. The Telegram adapter and the diagnostic CLI both use it. `connectToDjonik` keeps its unpinned string form only for isolated validation scripts.

## 10. Startup attestation

Order in `src/telegramCli.ts`. Nothing is polled until every step passes.

| # | Step | On failure |
|---|---|---|
| 1 | `loadServingConfig`: required secrets present; `DJONIK_*` ids, if set, equal the release; `DJONIK_EXPECTED_RELEASE`, if set, equals it; app revision known (`DJONIK_APP_REVISION` → `RAILWAY_GIT_COMMIT_SHA`/`RENDER_GIT_COMMIT` → `git rev-parse HEAD` + `+dirty`); drain bounds; Trello credentials only if the release exposes the tool | **exit 78**, no remote call |
| 2 | Preflight: `agents.retrieve(id, {version})` plus `skills.retrieve` for each `latest` reference; full comparison | **exit 78**, no Session created |
| 3 | Trello token health: one GET (`/members/me/boards`, header auth) plus recorded expiry | **warn and serve** (degradation, §14) |
| 4 | Telegram `getMe` | 401 → **exit 78** |
| 5 | Eager serving Session: pinned create, `sessions.retrieve`, then attestation of the persisted snapshot and resources | **exit 78**. The idle Session is left untouched and its id is not logged as serving |
| 6 | `[release] serving …` tuple line, then long polling | — |

**What is compared:**
- Agent id, version and archived state;
- model id, effort and speed;
- system SHA-256;
- exact Skill set and pins;
- specialist roster (exactly one member, id and version, and its Skill pin in the Session snapshot);
- effective built-in enabled set;
- no enabled tool that needs confirmation;
- exact custom-tool set, each tool's canonical schema SHA and description SHA;
- MCP server names and URLs, per-toolset default and overrides;
- Session environment, a single vault, the single Memory store and its access mode.

Canonical (key-sorted) JSON hashing is required: the provider returns JSON Schemas with re-ordered keys, which was measured on the #36 candidate.

**Fail-closed vs fail-open:**
- Release, config and Telegram-token mismatches fail closed, because serving an unreviewed tuple is worse than not serving.
- The only fail-open item is Trello history health: one capability degrading must not take down the rest, and it fails visibly per turn.
- A Session re-created mid-life after `DjonikSessionDeadError` is attested too. Drift there stops the process with exit 78 rather than serving the new tuple.

**Content-free logging:** the tuple line holds only ids, versions and 12-hex hash prefixes (no 64-hex values, no prompt text). Mismatch messages never echo prompt text. Tests inject marker secrets and assert that they appear in neither the Session parameters nor the logs.

## 11. Session continuity contract (Djonik v1)

**Decision:** one serving Session per process lifetime. It is created and attested at startup and reused for every turn. It is replaced only when the stream dies (`DjonikSessionDeadError`) or the process restarts or deploys. **Durable continuity is Claude Memory plus fresh Trello. In-Session conversation context survives until the next restart; it is not promised beyond it.**

Why not resume the previous Session after a restart, even though the provider allows re-streaming an idle Session:
1. After a deploy, that Session is pinned to the *previous* release. Resuming it is exactly the "stale serving Session" #33 exists to remove.
2. The #40 custom-tool lifecycle, the #32 echo anchor and specialist-thread provenance, and the #31 mutation ledger live in process memory. After a crash mid-turn the provider may hold a pending `requires_action` or a half-verified write. Reconstructing that safely requires a durable state machine, and guessing risks a mutation replay, which contract §10 forbids.
3. A process-scoped Session needs no disk, database or lookup, and restarts are rare: deploys and crashes.

Consequence Daniel should know: right after a restart, Djonik does not remember the last few messages unless they were saved to Memory. Anything durable (accepted plans, commitments) is written to Memory by the existing Memory rules.

Not built: Session-id persistence, provider-side lookup/recovery, daily rotation. Revisit only if real usage shows that restarts or Session growth hurt (#35 pilot).

## 12. Graceful shutdown (implemented)

`src/servingLifecycle.ts`, wired in `telegramCli.ts`. On SIGTERM or SIGINT:
1. `bot.stop()`: polling stops, and grammY confirms the last update offset to Telegram, so a successor cannot receive it again. Then wait (bounded) for the in-progress update batch.
2. `MessageGroupBuffer.flushAll()`: fragments already acknowledged to Telegram become their turn now. Previously `clearAll()` silently dropped them, which violated contract §10.
3. `whenIdle()` waits for every in-flight turn *including its reply*, bounded by `DJONIK_SHUTDOWN_DRAIN_MS` (default 120 s; turns are about 55 s per docs/49). Rejected turns settle too, so the drain cannot hang.
4. On timeout, each affected chat gets one fixed notice: "Джонік перезапускається і не встиг завершити відповідь… перевір, чи зміна в Trello застосувалась, і лише потім повтори запит." It is honest, never a blind resend, and never a false success.
5. Close the Session stream, log `[shutdown] end drained=… interrupted_chats=… exit=…`, and `process.exit(code)`.

A second signal exits immediately with code 130. Shutdown is single-flight: the first reason and code win.

**Polling failures:**
- Before this change, a 409 or any `bot.start()` rejection set `exitCode=1` but left the process alive: the Session stream kept the event loop running. The result was a zombie that no supervisor would restart.
- Now 409 (`telegram_conflict_another_poller`) → drain, then exit 75. 401 → exit 78. Any other failure → drain, then exit 1.

## 13. Single-instance strategy

- **Arbiter:** Telegram. A second `getUpdates` terminates the first with 409, and grammY treats 409 as fatal. No lock or leader election is added.
- **Real hazard:** overlap during a deploy. Telegram re-delivers unconfirmed updates, so if a new instance polls before the old one confirmed its offset, the last message can be processed twice, which could mean a duplicate write. The mitigations are layered:
  1. The host does stop-then-start: the systemd unit has one plain service and one `ExecStart`, and `systemctl restart`. `src/deployConfig.test.ts` pins this: no template unit, `TimeoutStopSec` ≥ drain + 20 s, no `systemctl start` next to a running unit, and a release check before the restart.
  2. The old process stops polling and confirms its offset as its first shutdown step.
  3. The new process polls only after config, preflight, the Telegram check and Session attestation, a few seconds after start.
  4. If overlap still occurs, the old poller gets 409, drains its in-flight turn and exits 75.
- **Operational rule (runbook §0):** stop the laptop adapter before the hosted one starts.

## 14. Secrets and token rotation

| Secret / config | Where it lives | Needed by | Startup behavior |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | host secret store | adapter | missing → 78; invalid → preflight fails |
| `TELEGRAM_BOT_TOKEN` | host secret store | adapter | missing → 78; rejected → 78 (getMe) |
| `TELEGRAM_ALLOWED_USER_ID` | host config | adapter | missing → 78 |
| `TRELLO_API_KEY`, `TRELLO_READ_TOKEN` | host secret store | adapter (custom tool, r26 only) | missing → 78; rejected, expired or unreachable → warn, degrade |
| `TRELLO_READ_TOKEN_EXPIRES_AT` | host config (ISO date or `never`) | expiry warning | invalid → 78; unrecorded → warning; ≤7 days → warning |
| Trello MCP OAuth credential | **Anthropic vault** `vlt_011Cf5Ju…` | Agent MCP | outside the adapter; token refresh managed by Anthropic |
| Agent, environment, Memory, vault ids | `src/release.ts` (non-secret) | adapter | env copies must match, or 78 |

- The Trello health check is one `GET /members/me/boards` that the tool itself needs. Credentials go only in the `Authorization` header; this is tested with URL capture. Token scope is enforced at issuance (`scope=read`, runbook §5), because checking scope needs the token in a URL path, which the repo forbids.
- **Rotation** (before about 2026-10-22): recommended is a `never`-expiring **read-scope** token, which removes monthly toil and can be revoked in Trello. The alternative is 30-day tokens with a recorded expiry and the startup warning. This is a Product Owner security choice (§18).
- **Rollback of a secret:** keep the previous value until the new start shows `trello_history=ok`; revoke the old token only after that.

## 15. Hosting research and recommendation

Requirements (docs/50 §5.C–F plus this step):
- one always-on Node ≥ 20 process;
- auto-restart;
- **stop-before-start deploys** (§13);
- secrets store;
- journal logs;
- outbound HTTPS only (Telegram, Anthropic, Trello), no inbound port, no disk;
- about 256–512 MB RAM (PDF intake peaks);
- a Europe/Kyiv clock for the #39 in-process scheduler;
- a stop grace period of at least 150 s.

| Option (Sept 2026) | Cost | Always-on / restart | Single instance on deploy | Secrets / logs | Fit |
|---|---|---|---|---|---|
| **Small VPS + systemd** (e.g. Hetzner CX23-class, EU) | about **€5.49/mo** after the 15 June 2026 adjustment ([Hetzner](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [analysis](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)) | systemd `Restart=on-failure` | **structural**: `restart` = stop (drain), then start | root-only EnvironmentFile; journald | Best correctness and cost; #39 scheduler trivially in-process. Cost: OS patching (unattended-upgrades), one-time setup |
| Railway (Hobby) | $5/mo including $5 usage credit; always-on usage metered ([pricing](https://docs.railway.com/pricing/plans)) | restart policy `ON_FAILURE` | new deployment becomes active **before** the old one gets SIGTERM (`overlapSeconds` default 0, `drainingSeconds` configurable) ([config](https://docs.railway.com/config-as-code/reference)) | Variables UI; log UI; `RAILWAY_GIT_COMMIT_SHA` | Simplest operations. Small residual overlap window, mitigated by §13 steps 2–4 |
| Render background worker (Starter) | about $7/mo, 0.5 CPU / 512 MB ([pricing](https://render.com/pricing)) | yes | zero-downtime deploy semantics similar to Railway | yes | Viable, costlier, same caveat |
| Fly.io Machines | about $2/mo for shared-cpu-1x 256 MB; a pricing update takes effect **2026-10-01**, which could not be verified here (fly.io was blocked by egress) | yes | single-Machine replacement semantics not verified here | `fly secrets` | Not recommended until the new pricing is verified; 256 MB is tight for PDF peaks |

**Recommendation:** a small EU VPS with systemd. It is the only option where "never two pollers" and graceful drain are properties of the platform, not timing. It is the cheapest and most predictable, and it hosts #39 without change. The deliverables are ready: `deploy/djonik-telegram.service`, `deploy/deploy.sh` and docs/52 §2–3.

**Fallback:** Railway, configured as in runbook §2, if Daniel prefers zero server maintenance over the small overlap risk.

**Expected cost:** host about €5–6/month plus unchanged per-turn inference. Record this next to the token telemetry.

## 16. Source changes

| File | Change |
|---|---|
| `src/release.ts` (new) | Release types; `RELEASE_R25` (current production, rollback), `RELEASE_R26` (target); `SERVING_RELEASE = RELEASE_R25` |
| `src/releaseAttestation.ts` (new) | Normalization of Agent/Session configs, exact comparison, canonical hashing, `attestAgentVersion`/`attestServingSession`, content-free `formatServingTuple` |
| `src/servingRelease.ts` (new) | `loadServingConfig` (secrets, drift, expected release, app revision, drain), `preflightRelease`, Trello token health, `connectServingSession`; exit codes 78/75 |
| `src/servingLifecycle.ts` (new) | Graceful-stop coordinator, interrupted-turn notice, polling-failure classification |
| `src/releasePlan.ts` (new) | Exact `agents.update` body for a release, generated rather than hand-typed |
| `src/releaseCheck.ts` (new) | `npm run release:check [id]` (read-only preflight) and `--plan --from N` (print update body) |
| `src/djonikClient.ts` | `agentVersion`, `metadata`, `attestSession` Session options; attest before the stream opens |
| `src/messageGrouping.ts` | In-flight tracking; `flushAll()`, `whenIdle()`, `inFlightChatIds()` |
| `src/telegramCli.ts` | Fail-closed startup sequence, eager attested Session, graceful stop, 409/401 handling, explicit exit |
| `src/cli.ts` | Diagnostic CLI uses the same pinned, attested Session (`source=diagnostic`) |
| `managed-agents/djonik.md` | Frontmatter = r26 target: explicit `skver_` pins + work-review, built-in allowlist, `trello_work_history`. Prompt body unchanged (SHA `3e204453…`) |
| `managed-agents/README.md` | #38 closeout current-state fix; r26 target description; `bash` decision |
| `package.json`, `tsconfig.build.json` (new) | `build` → `dist/` (tests excluded), `start` = `node dist/telegramCli.js`, `release:check` |
| `deploy/djonik-telegram.service`, `deploy/deploy.sh` (new) | Recommended host unit and deploy procedure (source only) |
| `.env.example`, `README.md` | New and optional variables; production start and runbook pointer |
| Tests (new) | `release.test.ts`, `releaseAttestation.test.ts`, `servingRelease.test.ts`, `servingLifecycle.test.ts`, `deployConfig.test.ts`, `releaseFixtures.test-helpers.ts` |
| Tests (changed) | `djonikAgentSource.test.ts` (r26 source invariants), `djonikClient.test.ts` (pinning, attest-before-stream), `messageGrouping.test.ts` (flush/drain) |
| Docs | this report, [docs/52](52_PRODUCTION_SERVING_RUNBOOK.md) runbook, docs/02 and docs/01 current-state notes |

## 17. Tests

| Required case | Test |
|---|---|
| Exact release accepted | `releaseAttestation.test.ts` "exact accepted Agent version and Session snapshot attest" (r25 and r26) |
| Wrong Agent version rejected | "a wrong Agent version is rejected"; serving "startup refuses a mismatched serving Session" |
| Wrong Skill version rejected | "r26: a wrong explicit Skill version…", "`latest` … where an explicit pin is required", "r25: `latest` accepted only while it resolves…" |
| Wrong specialist version rejected | "a wrong specialist version is rejected (roster pin)", "extra roster member…" |
| Session create uses explicit version | `servingRelease.test.ts` "created pinned to {id, version}…"; `djonikClient.test.ts` "pins the Session to an exact Agent version" |
| Startup refuses a mismatched tuple | "startup refuses a mismatched serving Session: nothing is streamed or sent"; "preflight mismatch fails closed before any Session exists"; `djonikClient.test.ts` "never streamed or sent to" |
| Secrets never logged | "missing secrets … never contains a secret value", "no secret in Session params or logs", "credentials never in a URL", "serving tuple line is content-free" |
| Graceful shutdown | `servingLifecycle.test.ts` (order, drain, timeout notice, failure tolerance, single-flight, content-free log); `messageGrouping.test.ts` (flush, whenIdle, rejected turn) |
| No duplicate-instance assumption violated | `deployConfig.test.ts` (one plain unit, stop-before-start deploy, timeouts ≥ drain, exit-78 no-restart); "polling failures map to … exit codes" |
| Custom tool config consistent with the #36 decision | `djonikAgentSource.test.ts` "exactly the accepted #36 custom tool, byte-for-byte"; `releaseAttestation.test.ts` custom-tool drift / unsupported / "r25 serves no custom tool"; `release.test.ts` "every custom tool … this application executes" |
| Target source ↔ release ↔ update body | `release.test.ts` "r26 equals djonik.md", "r25 is r26 minus exactly the three changes", "generated v26 update body produces exactly r26" |

Results on this tree:
- `npm test` → **631 pass, 0 fail** (baseline 557);
- `npm run typecheck` → clean;
- `npm run build` → OK, and `node dist/releaseCheck.js r25` → `OK agent=…@25`;
- `git diff --check` → clean.

Real-entrypoint checks without creating a Session:
- empty environment → exit 78 (`missing ANTHROPIC_API_KEY`);
- real key plus a fake Telegram token → live preflight of v25 passes, then `telegram_unauthorized`, exit 78; a Session list afterwards shows no new Session.

## 18. Remaining remote cutover steps (each needs Product Owner authorization)

Full procedure in [docs/52 §4](52_PRODUCTION_SERVING_RUNBOOK.md).

1. **Accept the r26 contents**, which are the configuration decisions made here: #36 included (§7), built-in allowlist without `bash`/`web_*` (§8), explicit pins (§6).
2. **Rotate the Trello read token** (`never`/read-scope recommended, or 30-day) and record its expiry. This is needed before about 2026-10-22 regardless of hosting.
3. **Create Agent v26**: one `agents.update` with the generated body and precondition `version: 25`; zero inference. Then `release:check r26` → OK.
4. **Provision the host** (VPS recommended): account, VM, secrets file, unit. Cost about €5–6/month.
5. **Flip `SERVING_RELEASE` to `RELEASE_R26`**: one reviewed commit and push.
6. **Deploy and cut over**: stop the laptop adapter, run `deploy.sh <sha>`, check the tuple line.
7. **Serving-boundary smoke**, per docs/04 §27. Proposed: **4 Telegram turns**, ceiling **$1.20** list cost. The worst comparable full turn is $0.31 (delegated PH, #29), and the four turns expected: ordinary planning about $0.21 (docs/46), rich intake, one work-review turn through `trello_work_history`, PH plus a separate requested output about $0.24–0.31 (docs/49). Evidence: the tuple line, `[turn]` telemetry, the verified relay for work-review, zero unintended writes, and no built-in tool error. The reversible Trello write is skipped unless the PO asks for it: #31 verification is unchanged and was already proven live (docs/34).

## 19. Rollback plan

- **Primary: app-level only, no Agent write.** Redeploy the last r25 revision, which pins **v25**. v25 stays intact because Agent versions are immutable and new Sessions can pin old versions. The rollback path is itself attested: r25 still checks `latest` resolution. If a Skill was re-versioned in the meantime, r25 correctly refuses, and the fix is to redeploy r26 or add a reviewed r25-pinned variant.
- **Bad v26 before the flip:** nothing serves it. Leave it, or supersede it with v27.
- **Host failure:** disable the unit, then run the laptop adapter from a pinned revision. Never run both.
- **Limits:** rollback starts a new Session (§11) and cannot undo Trello or Memory writes already made.

## 20. What NOT to build

- A Session store, resume or recovery logic, or Session rotation. Not needed (§11).
- Leader election, a distributed lock or a health HTTP endpoint. The platform plus Telegram arbitration suffice; there is no inbound port.
- A second release file format or a YAML parser at runtime. `release.ts` plus the tested lockstep with `djonik.md` is enough.
- `agent_with_overrides`-based serving, or Deployments as a release primitive.
- Webhook mode or serverless. This contradicts in-process lifecycle state (docs/50 §5.C).
- Automated Trello token rotation, Docker or Kubernetes for one process, a metrics stack.
- Any change to prompts, Skills, model or effort. None was made.

## 21. Readiness

**READY FOR CONTROLLED CUTOVER.** The source tree:
- pins and attests what it serves;
- runs safely today on r25;
- has r26 fully specified, with a generated and tested update body;
- stops gracefully and survives supervisor semantics;
- ships a host unit, deploy script and runbook.

The cutover is one controlled operation with two checkpoints (docs/52 §4) and an app-only rollback. It needs only the §18 authorizations; no further source work is expected before it.

Deferred and non-blocking:
- clean-up of the unused #36 candidate `agent_01QpAua2SCbFAHF7h8HQwigT` (archive; a PO decision);
- the Fly.io pricing re-check;
- whether `DJONIK_TURN_TELEMETRY` stays on in production after the smoke.
