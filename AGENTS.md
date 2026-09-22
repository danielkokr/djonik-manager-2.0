# Agent Working Agreement — Djonik 2.0

This repository is a greenfield Claude-native rebuild of Djonik.

## Required reading

Before implementation:

1. `docs/00_DJONIK_PRODUCT_CONTRACT.md`
2. `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`
3. `docs/02_DEVELOPMENT_ROADMAP.md`
4. `docs/03_TARGET_CAPABILITIES.md`
5. `CLAUDE.md`
6. `docs/17_DJONIK_V1_ARCHITECTURE_AUDIT.md` (accepted decisions, evidence and handoff), `docs/21_ISSUE_29_WORK_HISTORY_ARCHITECTURE_AUDIT.md` (#29 supersession, work-history evidence decision) and `docs/30_RUNTIME_EVENT_LOOP_AUDIT.md` (custom-tool continuation runtime decision, #40)
7. `docs/04_MANAGED_AGENT_TOKEN_COST_AUDIT.md` §27 (current validation policy)
8. the GitHub issue that roadmap marks as canonical NOW and its latest comments.

Distinguish proposed fixes, historical acceptance, current recorded Agent configuration and the actual serving Session. A fresh checkout with an older roadmap must obtain the governance documentation change before implementing new issues; issue numbering is not a substitute for canonical scope.

Do not determine NOW from issue number, date, memory or another conversation.

## Architecture rules

- The authoritative Djonik runtime is the Claude Managed Agent resource configured through Claude Console / Managed Agents API.
- Do not create a duplicate local Djonik agent or duplicate system prompt in application code unless an explicit canonical decision changes this.
- Prefer Managed Agent configuration, Sessions, Memory Stores, Skills and bounded tools/MCP before adding custom infrastructure.
- Do not implement a custom Messages API tool loop.
- Do not implement a custom transcript/conversation-history system in the foundation.
- Do not add Neon, vector DB or custom RAG/memory without a measured need and an explicit roadmap decision.
- Keep channel/integration code thin and deterministic only where hard boundaries need it.
- Claude owns normal conversational reasoning and tool sequencing.
- External writes must be bounded and verified.
- Do not expose unrestricted low-level APIs where a semantic tool can be used.
- Do not prebuild speculative Skills, subagents or integrations.

## Runtime reliability — custom tools

Canonical rule: `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md` §13 (evidence: `docs/30`).

- A repeated `session.status_idle{requires_action}` is never permission to execute the same `custom_tool_use_id` again; custom-tool lifecycle is tracked per provider event id.
- Test duplicate/repeated status delivery offline before any live validation.
- Do not add a side-effecting custom tool without an idempotency strategy (target-enforced key or durable intent) and postcondition verification.
- Do not hide generic runtime fixes inside a product capability issue. When a measured failure moves below the product layer, create or promote a bounded reliability issue instead of endlessly hardening prompts or renderers.

## Scope discipline

Work only inside the canonical bounded issue.

If current official Anthropic APIs differ from repo assumptions, stop and report the discrepancy before silently redesigning the architecture.

Do not resurrect legacy `djonik-manager` architecture just because code already exists there.

## Git discipline

Unless the Product Owner explicitly authorizes it:

- no commit;
- no push;
- no deploy;
- no branch creation;
- no issue close;
- no unrelated cleanup.

Before handoff run the relevant focused checks plus:

- `git diff --check`
- `git status --short`

Preserve unrelated pre-existing user changes.

## Secrets

- Never commit API keys, bot tokens, credentials or Console secrets.
- Use environment/runtime secret mechanisms only where integration code actually needs them.
- Non-secret Managed Agent resource IDs may be configured through environment/config when their integration slice arrives.

## Report format

Return:

1. Summary
2. Files changed
3. Architecture/API decisions
4. Tests/checks and exact results
5. Manual smoke evidence when required
6. Limitations / explicitly deferred work
7. `git status --short`

If the issue requires an external manual Console action that you cannot perform, say exactly what is blocked and do not replace it with a different architecture.