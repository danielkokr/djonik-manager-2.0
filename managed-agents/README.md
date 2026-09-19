# Managed Agent definitions

Reviewed, repo-side **source** for Managed Agents that are separate from the primary Djonik agent. The live Claude Managed Agent resource stays authoritative; a file here is not applied automatically, is not read by any runtime code, and does not create a second Djonik identity.

Each file uses the official declarative `ant apply` format: YAML frontmatter is the agent configuration, the body is the `system` prompt.

## Conventions

- One file per agent. Keep it minimal, and do not duplicate Skill contents in the system prompt.
- Pin Skills and referenced agents to explicit versions. Nothing is inherited from the coordinator, so declare every capability the agent needs.
- Enable tools by allowlist: `default_config: {enabled: false}`, then list what is needed.
- Applying a file (`ant apply` or `agents.create`) is a live change and needs explicit Product Owner authorization.

## Files

- `project-health-specialist.md`: read-only Sonnet Project Health specialist (issue #28, Wave C1). Not yet created as a live agent, and not yet in any coordinator roster.
