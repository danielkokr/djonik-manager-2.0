# Djonik 2.0

Djonik 2.0 is a greenfield rebuild of a personal conversational AI Project Manager for freelance and studio work.

The product is intentionally **Claude-native**: the authoritative Djonik runtime is a Claude Managed Agent created and managed through Claude Console / the Managed Agents API. The repository holds reviewed product/architecture decisions plus the thin integration code that connects that agent to Telegram and external tools.

## Target architecture

```text
Claude Console
  └── Djonik Managed Agent
      ├── System prompt
      ├── Skills
      ├── Tools / MCP
      ├── Sessions
      └── Memory Stores

                ↑↓ Anthropic SDK/API

Telegram → thin Djonik adapter

External systems → bounded tools / MCP
```

The project deliberately avoids recreating a second local agent runtime, custom Messages tool loop, custom conversation-history engine or custom memory database unless later evidence proves one is necessary.

## Canonical docs

Read in this order:

1. `docs/00_DJONIK_PRODUCT_CONTRACT.md`
2. `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`
3. `docs/02_DEVELOPMENT_ROADMAP.md`
4. `docs/03_TARGET_CAPABILITIES.md`
5. `CLAUDE.md`
6. `AGENTS.md`

`docs/02_DEVELOPMENT_ROADMAP.md` is the only canonical source for NOW.

## Current phase

Canonical NOW is in `docs/02_DEVELOPMENT_ROADMAP.md` (currently #33: pinned release, always-on host and serving Session).

**Local run.**
1. Copy `.env.example` to `.env`.
2. Set `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID` (your own Telegram numeric user id: the single-user allowlist).
3. Run:

```bash
npm run telegram
```

The Agent version, environment, Memory store and vault come from the reviewed release in `src/release.ts`, not from `.env`. At startup the adapter:
- checks the pinned Agent version;
- creates one Session pinned to it;
- attests the provider's snapshot;
- logs a content-free `[release] serving …` line before it polls Telegram.

A mismatch refuses to start (exit 78). Only messages from `TELEGRAM_ALLOWED_USER_ID` reach Djonik. Every message during the running process reuses the same Managed Session. Ctrl+C stops polling and drains in-flight turns; a second Ctrl+C exits at once.

Run only **one** adapter per bot token at a time. A console-only client remains available via `npm run dev`. `npm run release:check [release]` is a read-only check of a release against the live Agent version.

**Production** (`npm run build`, then `npm start`, under systemd on a small VPS): host setup `deploy/bootstrap-host.sh`, secrets `deploy/set-secrets.sh`, deploy `deploy/deploy.sh <sha>`; see [docs/52](docs/52_PRODUCTION_SERVING_RUNBOOK.md) and [docs/54](docs/54_ISSUE_33_ALWAYS_ON_HOST_AND_TELEGRAM_CUTOVER.md). Read-only serving evidence: `npm run release:check -- r26 --serving`.

## Trello work-history credentials

The `trello_work_history` custom tool reads Trello REST action history with `TRELLO_API_KEY` and `TRELLO_READ_TOKEN`.
- **Storage:** production keeps them in the Telegram process's runtime secret store, never in a Managed Agent, Skill, repository or URL. They are required only when the serving release exposes the tool (r26).
- **Scope and expiry:** the token must be issued with read-only scope. Record its expiry in `TRELLO_READ_TOKEN_EXPIRES_AT` (a date or `never`) so startup can warn 7 days ahead. Rotation: docs/52 §5.
- **Failures:** missing credentials refuse startup. Rejected credentials degrade visibly: a startup warning plus a per-turn "history is unavailable" result. The client never falls back to current-state inference.
- **Requests:** the tool uses GET requests only and sends the credentials in Trello's `Authorization` header.

## Working model

- Daniel — Product Owner / strategist
- ChatGPT — Product Lead + technical reviewer
- Claude Code / Codex — Implementation Engineer

Workflow:

`bounded issue → implementation without commit/push/deploy → report → review → acceptance → manual commit/push`

## Legacy

The previous repository `danielkokr/djonik-manager` is a source of product lessons, scenarios and failure modes only. Its runtime architecture is not the architecture of Djonik 2.0.
