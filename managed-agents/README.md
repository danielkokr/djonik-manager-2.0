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

- `project-health-specialist.md`: read-only Sonnet Project Health specialist (issue #28, Wave C1). **Exists as a live standalone agent** (`agent_01KNiQDzzPjaMU6LLF4mU6uM`); the live version is **v3** (natural-PM response-shape hardening, recorded in `claude-lock.json`), config/lockfile unchanged since. **Specialist v3 passed delegated live validation** ("Scenario A", `docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §42): native delegation, factual correctness, natural-PM voice/shape, and exactly-one-final-child-result all passed against fresh Trello evidence. **Production Djonik (`agent_01WGRHDBjQa3eMhoGJMmQ1dh`) is now v18** and pins specialist v3 through its own native roster (`docs/15_ISSUE_28_IMPLEMENTATION_REPORT.md` §43); the production coordinator no longer owns the `project-health` Skill directly — the specialist exclusively owns it. The temporary, non-production validation coordinator (`agent_01GFCLFYq6uLRHG8vMCrAgeK`, v5) remains live and unarchived until production smoke/acceptance completes; archiving it is a separate later action. A coordinator roster pins a specialist version, so any later specialist change also needs a separate roster update (on both the validation coordinator and production).
