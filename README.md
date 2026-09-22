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

**Foundation 3:** a thin local Telegram adapter in front of the existing Djonik Managed Agent client.

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`, `DJONIK_AGENT_ID`, `DJONIK_ENVIRONMENT_ID`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID` (your own Telegram numeric user id — the single-user allowlist for this dev bot). Then run:

```bash
npm run telegram
```

Only messages from `TELEGRAM_ALLOWED_USER_ID` reach Djonik; every Telegram text message from that user during the running process reuses the same Djonik Managed Session, so conversational continuity works exactly like the console/CLI client. Stop the adapter with Ctrl+C.

A console-only client (no Telegram) remains available via `npm run dev`.

## Trello work-history credentials

The source-only `trello_work_history` custom tool reads Trello REST action history with `TRELLO_API_KEY` and `TRELLO_READ_TOKEN`. In production they belong in the Telegram process's runtime secret store, not a Managed Agent, Skill, repository, or URL. The token must have read-only scope and is currently rotated every 30 days. Missing or rejected credentials produce a safe “history is unavailable” tool result; the client never falls back to current-state inference. The tool uses GET requests only and sends the credentials in Trello's `Authorization` header.

## Working model

- Daniel — Product Owner / strategist
- ChatGPT — Product Lead + technical reviewer
- Claude Code / Codex — Implementation Engineer

Workflow:

`bounded issue → implementation without commit/push/deploy → report → review → acceptance → manual commit/push`

## Legacy

The previous repository `danielkokr/djonik-manager` is a source of product lessons, scenarios and failure modes only. Its runtime architecture is not the architecture of Djonik 2.0.
