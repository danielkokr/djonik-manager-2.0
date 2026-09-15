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

**Foundation 1:** create the real Djonik Managed Agent, Environment and first multi-turn Session in Claude Console.

Application code begins only after that real Claude resource works. The next slice will be a thin repository client that talks to the existing `agent_id` / `environment_id`; it will not recreate Djonik locally.

## Working model

- Daniel — Product Owner / strategist
- ChatGPT — Product Lead + technical reviewer
- Claude Code / Codex — Implementation Engineer

Workflow:

`bounded issue → implementation without commit/push/deploy → report → review → acceptance → manual commit/push`

## Legacy

The previous repository `danielkokr/djonik-manager` is a source of product lessons, scenarios and failure modes only. Its runtime architecture is not the architecture of Djonik 2.0.