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

- `project-health-specialist.md`: read-only Sonnet Project Health specialist (issue #28, Wave C1). **Exists as a live standalone agent** (`agent_01KNiQDzzPjaMU6LLF4mU6uM`); the live version is now **v3** (natural-PM response-shape hardening, recorded in `claude-lock.json`). v2 was live-validated (§38): it passed factual correctness, relay and runtime boundaries but failed the natural-PM-voice and concision target, which v3 addresses. It is **not attached to the production Djonik coordinator**: production (`agent_01WGRHDBjQa3eMhoGJMmQ1dh`) has no roster. Only the temporary, non-production validation coordinator (`agent_01GFCLFYq6uLRHG8vMCrAgeK`, now v4) pins specialist v3, for validation only. **Specialist v3 has not been live-validated yet.** A coordinator roster pins a specialist version, so any later specialist change also needs a separate roster update.
