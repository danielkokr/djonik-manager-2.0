# Djonik 2.0 — Implementation Agent Rules

## Roles

- Daniel — Product Owner / strategist.
- ChatGPT — Product Lead + technical reviewer.
- Claude Code / Codex — Implementation Engineer.

## Before implementation

Read in this order:

1. `docs/00_DJONIK_PRODUCT_CONTRACT.md`
2. `docs/01_CLAUDE_NATIVE_ARCHITECTURE.md`
3. `docs/02_DEVELOPMENT_ROADMAP.md`
4. `CLAUDE.md`
5. this file
6. the canonical NOW GitHub issue from the roadmap
7. the latest issue comments
8. only then any relevant existing implementation/docs.

Do not choose work from issue number, age, memory, or the legacy repo.

## Working model

One bounded issue at a time.

Normal loop:

1. Read canonical context and NOW issue.
2. Inspect the current repository state.
3. Implement only the bounded scope.
4. Run focused verification.
5. Report what changed, what was tested, and any remaining risk.
6. Stop for review.
7. Daniel performs commit/push unless explicitly instructed otherwise.

## Git policy

During implementation work unless the user explicitly changes the rule:

- do not create branches;
- do not commit;
- do not push;
- do not deploy;
- do not close GitHub issues;
- do not silently rewrite canonical roadmap/product docs.

Before reporting completion, run the relevant checks plus:

- `git diff --check`
- `git status --short`

## Architecture policy

This is a Claude-native greenfield rebuild.

Do not import legacy runtime code or architecture merely because it already exists.

Prefer, in order:

- agent configuration;
- sessions;
- Claude Memory / Memory Stores;
- Skills;
- built-in tools;
- bounded custom tools / MCP;
- simple adapters/scheduling;
- specialist agents only when justified;
- custom infrastructure only after a demonstrated gap.

Never implement a second conversational reasoning engine in server code.

## Scope discipline

If an issue asks for the first local Claude session, do not add Telegram, Trello, memory architecture, Skills or deployment "while here".

Small clean vertical slices are preferred to speculative scaffolding.

## Safety / correctness

- Never commit secrets.
- External mutations must be bounded and later verified once mutation tools exist.
- Do not hide ambiguity behind fuzzy guessing.
- Do not claim tests passed unless they were actually run.
- If current official Claude APIs differ from repository assumptions, use current official Anthropic documentation and report the discrepancy rather than building against stale examples.

## Completion report

Every implementation report should contain:

- summary;
- files changed;
- behavior implemented;
- tests/checks run and their results;
- exact manual verification steps if needed;
- known limitations / out-of-scope items;
- `git status --short`.