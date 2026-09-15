# Djonik 2.0

Djonik is a personal conversational AI Project Manager for freelance and studio work.

This repository is a clean rebuild of Djonik around Claude-native agent primitives. It intentionally does **not** migrate the legacy runtime architecture from `danielkokr/djonik-manager`.

## Product direction

Djonik should behave like a persistent PM / chief of staff, not a command bot or CRUD wrapper. Natural language is the interface.

Core PM loop:

`OBSERVE → ASSESS → PLAN → ACT → VERIFY → REMEMBER → FOLLOW UP → MONITOR`

The target architecture prefers Claude-native capabilities first:

- Claude agent configuration for identity and behavior;
- Sessions for conversational continuity;
- Claude Memory / Memory Stores for durable agent memory;
- Skills for reusable PM expertise;
- bounded custom tools / MCP for external actions;
- hooks / event stream / permissions for safety and observability;
- subagents only where isolated specialist context has a measured benefit.

External systems remain authoritative for the operational state they own. For example, Trello remains the source of truth for Trello task lifecycle state.

## Canonical reading order

Before substantial product or implementation work, read:

1. `docs/00_DJONIK_PRODUCT_CONTRACT.md`
2. `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`
3. `docs/02_DEVELOPMENT_ROADMAP.md`
4. `AGENTS.md`
5. the GitHub issue marked as canonical **NOW** in the roadmap
6. the latest comments on that issue

Do not determine the current task from issue number, date, or memory from another chat.

## Repository status

Greenfield. No legacy runtime code is being migrated by default.

The first milestone is deliberately small:

`local input → Claude agent session → natural-language Djonik response → second turn continues the same session`

Telegram, Memory, Skills and Trello are added only after that foundation works.