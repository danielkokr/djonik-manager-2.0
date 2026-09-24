# #38 closeout and #33 promotion

Date: 2026-09-24. Governance and scope synchronization only.

Evidence HEAD: `210a26d655571861af52899a8cdae88547acf0a4` (= `origin/main` before this change).

No Agent, Skill, prompt, Session, Trello, Memory or Calendar change was made. No paid inference, deployment or secret change was made either. The only live access was a read-only GET of the production Agent and the Session list (§5.B).

## 1. #38 acceptance

| Area | Evidence | Verdict |
|---|---|---|
| A. Ordinary coordinator | Agent v25 runs Claude Sonnet 5 medium/standard. The enriched-Trello planning smoke ([docs/46](46_ISSUE_38_ENRICHED_TRELLO_PLANNING_SMOKE.md), $0.21, zero writes) was graded **PASS WITH SOFT OBSERVATION** by the PO and Product Lead. Model escalation is closed. | Accepted |
| B. Voice / Telegram delivery | The contract-derived smoke ([docs/43](43_ISSUE_38_CONTRACT_DERIVED_LIVE_SMOKE.md)) had no hard voice failure in B/C1/C2; its only hard failure, D, was superseded by docs/46. The adapter delivers only the final `sendOrdered()` result: regressions at `bb755be` cover nine interim messages and incomplete turns. Live in docs/49, the interim `agent.message` did not reach the reply. | Accepted |
| C. Project Health composition | F3 was implemented at `1014c057` ([docs/48](48_ISSUE_38_PROJECT_HEALTH_NATURAL_CUE_IMPLEMENTATION.md)). The final live smoke through `connectToDjonik()` passed ([docs/49](49_ISSUE_38_FINAL_PROJECT_HEALTH_LIVE_SMOKE.md), $0.24): native delegation to canonical specialist v4; one verified same-turn result; exact specialist bytes; divergent coordinator prose withheld; the old notice absent; the new cue exactly once; child and parent `end_turn`; zero Trello/Memory/Calendar writes. | Accepted |
| D. Open blockers | None. The one-sentence cue on every divergent PH reply is the PO-accepted UX trade-off (docs/48 §7). | None |

## 2. Accepted tuple entering #33

See [docs/01](01_CLAUDE_NATIVE_ARCHITECTURE.md), "Current accepted state". In short:
- Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh` v25: Sonnet 5, medium/standard, prompt SHA-256 `3e204453…b4b6`.
- Coordinator Skills: task-management `skver_01CJQkVY1kp1urhBWQgHUYxW`, daily-planning `skver_01EL7d3fy4WWYBSsD3PmK9LQ`, weekly-planning `skver_01FdtnnkbePBjNJGTuJyAvhw`, studio-intake `skver_018sJv1GCnzfZRG4NbExbAzj`.
- Specialist v4.
- Runtime at `210a26d` (#31/#32/#40/#36/#37/#38).

## 3. Deferred, non-blocking observations

- Trello MCP does not expose Custom Fields (e.g. `Size`). This is a tool limitation.
- Bulk `list_by_board` returns `checklists: []` for cards that have checklists. This is a tool limitation; direct per-card reads were not measured.
- Enriched board payloads cost more (43 KB; 14¢ → 21¢ in docs/46).
- Minor PM wording: “можуть почекати день без наслідків” (docs/46), “робота триває” inferred from This week (docs/49).
- Coordinator built-in toolset is default-enabled, including `bash` (docs/34 curl attempt). This is a configuration question, decided in #33 §5.A, not a #38 defect.

## 4. Canonical NOW

**#33 — Pinned release, always-on host, serving Session.** #34 and later items are not promoted.

## 5. #33 actual scope (re-derived from the issue, its comments and the repo)

### A. Release pinning

- Live read-back 2026-09-24: v25 references all four coordinator Skills as **`latest`**. The #33 invariant "no accidental `latest`" is therefore unmet. `managed-agents/djonik.md` also declares `version: latest`.
- **#36 is not in production.** The `trello_work_history` custom tool (input-schema SHA `ff820032…7921`) and `work-review` Skill v2 (`skill_0169h7GYNYUDDDZteDCUV2fE` / `skver_015LYzVdivGGMsBpuki4kW4S`, = repo blob `c079d285…e640`) exist only on the isolated candidate from docs/32. That candidate used the old Haiku coordinator and old prompt. The combination with v25 (Sonnet 5 medium plus the new prompt) is untested live.
- **A new Agent version (v26) is required:**
  - pin four explicit `skver_` versions;
  - add the custom tool and the pinned `work-review` Skill;
  - keep the specialist v4 roster.

  The PO must also decide explicitly whether v26 keeps or narrows the default-enabled built-in toolset (`bash`). #33 freezes "expected tool permissions", and that setting must not change silently.
- **The adapter does not pin the Agent version.** `connectToDjonik()` creates Sessions with `agent: <id string>`, which resolves to the latest version. Any future Agent update therefore silently changes the next serving Session. The application revision is not reported anywhere at startup.

### B. Serving Session

- There is no persisted serving Session. `createSessionManager` creates a new Session lazily on the first message of each process, and again after `DjonikSessionDeadError`. No Session id is stored or resumed.
- No adapter process is running on Daniel's machine (checked 2026-09-24). The 20 most recent Sessions in the workspace are identified validation or smoke Sessions (v23–v25 and candidates). Sessions carry no source marker, so the last Telegram-created Session cannot be identified from the API. It is **unattested**. Any such Session predates v25 (≤ v24) and is **stale**, but the adapter would never reuse it.
- Transition consequence: the next start creates a Session on v25 with `latest` Skills. That is the accepted #38 configuration, but unpinned and without #36. Staleness is resolved by a restart; attestation and pinning are not.
- Every restart or deploy starts a new Session. In-Session conversation history is lost; Memory persists. That is today's behavior. #33 must accept it explicitly or decide otherwise; no migration is designed here.
- Shutdown does not drain an in-flight turn, and `clearAll()` drops buffered fragments. A restart mid-turn can therefore lose an accepted user turn (contract §10). This is relevant to the "completed-turn boundary" invariant.

### C. Adapter / host

- `npm run telegram` runs one Node process: grammY long polling → grouping buffer → `connectToDjonik()`.
- In-process state:
  - Session handle and persistent event stream;
  - FIFO turn queue;
  - Session-scoped #40 custom-tool lifecycle;
  - per-turn #31 mutation ledger and #32 specialist provenance;
  - grouping timers;
  - in-memory media (≤ 20 MB base64 per document).
- The custom tool executes in-process with Trello REST credentials.
- Turns take about 55 s (docs/49).
- Telegram allows one `getUpdates` consumer per token. A second poller gets 409 Conflict.
- No inbound port is needed.
- **Serverless is unsuitable.** The design relies on in-process lifecycle state, a long-lived event stream, multi-minute turns and long polling. Webhook-plus-functions would require externalizing Session, queue and lifecycle state, which contradicts the #33 invariants.

### D. Secrets and config

| Variable | Kind |
|---|---|
| `ANTHROPIC_API_KEY` | secret |
| `TELEGRAM_BOT_TOKEN` | secret |
| `TRELLO_API_KEY` | secret |
| `TRELLO_READ_TOKEN` | secret |
| `TELEGRAM_ALLOWED_USER_ID` | config |
| `DJONIK_AGENT_ID` | non-secret id |
| `DJONIK_ENVIRONMENT_ID` | non-secret id |
| `DJONIK_MEMORY_STORE_ID` | non-secret id |
| `DJONIK_VAULT_ID` | non-secret id |
| `DJONIK_TRACE`, `DJONIK_TURN_TELEMETRY` | optional flags |

- Today all of these live only in the local `.env`.
- Cloud-side and unaffected by hosting: the Agent, the Memory Store, the environment, and the Trello MCP credential in vault `vlt_011Cf5Ju…`.
- The Trello read token expires around **2026-10-22** (28 days from now). Missing or rejected credentials already return a model-facing `is_error` ("Trello history is unavailable…"). Whether Daniel sees this visibly is a #33 acceptance item.

### E. Operations

| Area | Current state | #33 needs |
|---|---|---|
| Single instance | None enforced | Stop local before hosted; avoid 409 restart flapping |
| Restart | None | Supervisor auto-restart |
| Startup check | Logs "Starting…" only | Content-free serving-tuple read-back: app revision, Agent id/version, resolved Skills, roster, Memory mode |
| Logs | Opt-in content-free telemetry | Host log retention |
| Rollback | Undocumented | Repin previous Agent version + previous app revision; cannot undo writes |

### F. Hosting requirements (no provider chosen)

- One always-on Node ≥ 20 process with auto-restart.
- About 256–512 MB RAM (PDF intake peaks) and a fractional vCPU.
- Outbound HTTPS only: Telegram, Anthropic, Trello. No inbound port and no persistent disk today.
- Secret store.
- Must also host the #39 scheduler (Europe/Kyiv clock, same process).
- Likely cost class: a small VPS or container, roughly **$5–10 per month**. This is an estimate, not a quote.

## 6. First bounded #33 step (recommended)

**#33.1 — Release manifest and pinned, attested Session creation (source-only, offline).**

1. Add a reviewed release manifest listing the exact target tuple: Agent id and version, four coordinator `skver_`, `work-review` `skver_`, custom tool schema SHA, specialist v4, expected tool permissions and Memory mode.
2. The adapter creates Sessions pinned to `{id, version}` from config instead of `latest`.
3. At startup, before accepting Telegram updates, the adapter reads back the created Session (agent version, resolved Skills, roster) and compares it to the manifest. It logs a content-free tuple line and fails closed on mismatch.
4. Add a serving-transition runbook: stop local, verify idle, start, check the tuple line, rollback.
5. Offline tests only.

This step changes one variable: application source. It makes every later remote change, such as Agent v26, safe to promote and verify. It needs no paid inference and no remote write.

## 7. Explicitly not done now (later #33 steps, each separately authorized)

1. PO decision on v26 contents (#36 attach; built-in `bash`), then the Agent v26 update with read-back and no inference.
2. Serving-boundary smoke on v26 through the adapter: ordinary text, rich intake, one work-review turn, PH plus a separate output, and a reversible write only if needed. It needs a declared docs/04 §27 budget.
3. Graceful shutdown and completed-turn drain; decision on Session continuity across restarts.
4. Host selection and deployment, host secrets, single-instance cutover, supervision.
5. Trello read-token rotation or a longer-lived read-only token (before about 2026-10-22).
6. Exercising the rollback runbook and recording the hosting cost note.
