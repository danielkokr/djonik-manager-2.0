# Managed Agent definitions

Reviewed, repo-side **source** for Managed Agents that are separate from the primary Djonik agent. The live Claude Managed Agent resource stays authoritative; a file here is not applied automatically, is not read by any runtime code, and does not create a second Djonik identity.

Each file uses the official declarative `ant apply` format: YAML frontmatter is the agent configuration, the body is the `system` prompt.

## Conventions

- One file per agent. Keep it minimal, and do not duplicate Skill contents in the system prompt.
- Pin Skills and referenced agents to explicit versions. Nothing is inherited from the coordinator, so declare every capability the agent needs.
- Enable tools by allowlist: `default_config: {enabled: false}`, then list what is needed.
- Applying a file (`ant apply` or `agents.create`) is a live change and needs explicit Product Owner authorization.
- Apply one named file from the repository root (`ant apply managed-agents/<file>.md`), never `ant apply .`. The file sits outside the conventional `agents/` directory, so `ant apply` only treats it as an agent because it is named explicitly. `claude-lock.json` at the repository root records which live resource each file created; do not edit it by hand.

## Files

- `project-health-specialist.md`: read-only Sonnet Project Health specialist (issue #28, Wave C1). **Exists as a live standalone agent** (`agent_01KNiQDzzPjaMU6LLF4mU6uM`, version 1, recorded in `claude-lock.json`). It is **not yet attached** to the production Djonik coordinator: no roster references it, no Session has used it, and nothing can reach it until the coordinator's `multiagent` roster is updated in a later reviewed slice.
