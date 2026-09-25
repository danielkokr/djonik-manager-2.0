import { confirmationPolicyProblems, RELEASES, resolveCandidateSkills, type CandidateResolution, type DjonikRelease, type DjonikReleaseCandidate } from "./release.js";
import { sha256, SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

/** What an `agents.update` body is derived from: a release's Skills and tool surface (never its Agent version). */
type ReleaseUpdateSource = Pick<DjonikRelease, "skills" | "builtInTools" | "customTools" | "mcpToolsets" | "confirmationRequired">;

/**
 * The exact `agents.update` body that turns the current Agent version into `release` (#33 cutover,
 * docs/52 §4). Derived from the reviewed release, never hand-typed. Only the fields a release may change
 * relative to its predecessor are sent — `skills` and `tools` (both full-replacement lists); model,
 * system, MCP servers and the specialist roster are omitted and therefore preserved. `version` is the
 * optimistic-concurrency precondition: the update fails unless the Agent is still at `fromVersion`.
 *
 * Permission policies (#39 Stage 3A): a tool named in `release.confirmationRequired` gets its own
 * `always_ask` config entry; every other enabled tool is `always_allow`, exactly as before. A release without
 * `confirmationRequired` (r25, r26) produces the same body as before this field existed.
 *
 * Building the body performs no request. Sending it is a production mutation that needs explicit
 * Product Owner authorization.
 */
export function buildAgentUpdateBody(release: ReleaseUpdateSource, fromVersion: number): Record<string, unknown> {
  const problems = confirmationPolicyProblems(release);
  if (problems.length > 0) throw new Error(`Invalid confirmation policy: ${problems.join("; ")}`);
  const allow = { type: "always_allow" };
  const ask = { type: "always_ask" };
  const askBuiltIn = new Set<string>(release.confirmationRequired?.builtIn ?? []);
  const askMcp = (server: string) => new Set(release.confirmationRequired?.mcp[server] ?? []);
  const everyBuiltIn = release.builtInTools.length === 8 && askBuiltIn.size === 0;
  return {
    version: fromVersion,
    skills: release.skills.map((skill) => ({
      type: "custom",
      skill_id: skill.skillId,
      version: skill.pin.kind === "explicit" ? skill.pin.version : "latest",
    })),
    tools: [
      everyBuiltIn
        ? { type: "agent_toolset_20260401", default_config: { enabled: true, permission_policy: allow } }
        : {
            type: "agent_toolset_20260401",
            default_config: { enabled: false, permission_policy: allow },
            configs: release.builtInTools.map((name) => ({ name, enabled: true, permission_policy: askBuiltIn.has(name) ? ask : allow })),
          },
      ...release.customTools.map((name) => ({
        type: "custom",
        name,
        description: SUPPORTED_CUSTOM_TOOLS[name].description,
        input_schema: SUPPORTED_CUSTOM_TOOLS[name].input_schema,
      })),
      ...release.mcpToolsets.map((toolset) => {
        const gated = askMcp(toolset.server);
        return {
          type: "mcp_toolset",
          mcp_server_name: toolset.server,
          default_config: { enabled: toolset.defaultEnabled, permission_policy: toolset.defaultPolicy === "always_ask" ? ask : allow },
          configs: Object.entries(toolset.overrides).map(([name, enabled]) => ({ name, enabled, permission_policy: gated.has(name) ? ask : allow })),
        };
      }),
    ],
  };
}

/**
 * `buildAgentUpdateBody` for a reviewed release, as `release:check --plan` prints it — refused when the release's
 * prompt differs from the reviewed release at `fromVersion` (#42). That body carries Skills and tools only; for a
 * prompt change it would create an Agent with the new Skills and the old prompt (e.g. r28 from v27, or a rollback
 * across a prompt change). Such a transition goes through `buildCandidateUpdateBody` with the reviewed prompt.
 */
export function buildReleaseUpdateBody(release: DjonikRelease, fromVersion: number): Record<string, unknown> {
  const from = Object.values(RELEASES).find((candidate) => candidate.agent.id === release.agent.id && candidate.agent.version === fromVersion);
  if (!from) throw new Error(`No reviewed release for Agent v${fromVersion}; cannot prove the prompt is unchanged.`);
  if (from.systemSha256 !== release.systemSha256) {
    throw new Error(`${release.id} changes the prompt relative to ${from.id}; a Skills/tools-only body would be a partial update.`);
  }
  return buildAgentUpdateBody(release, fromVersion);
}

/**
 * The update body that would create a candidate's Agent version (Stage 3B), from the REAL remote Skill pins.
 * Throws `UnresolvedReleaseCandidateError` while any candidate Skill is unresolved — there is no body with a
 * placeholder id. Performs no request.
 *
 * `skills` and `tools` always travel (full-replacement lists). `system` travels exactly when the candidate's
 * prompt differs from the reviewed release it updates (#41 + #42 → r28): the caller passes the reviewed
 * `managed-agents/djonik.md` body, and it is refused unless it hashes to the candidate's `systemSha256`. A prompt
 * change therefore always ships together with the Skills it refers to, and an unchanged prompt is never re-sent
 * (r27). Model, MCP servers and roster are preserved by omission.
 */
export function buildCandidateUpdateBody(
  candidate: DjonikReleaseCandidate,
  resolution: Pick<CandidateResolution, "skills">,
  system?: string,
): Record<string, unknown> {
  const from = Object.values(RELEASES).find((release) => release.agent.id === candidate.agent.id && release.agent.version === candidate.agent.fromVersion);
  if (!from) throw new Error(`No reviewed release for Agent v${candidate.agent.fromVersion}; the candidate has nothing to update from.`);
  const body = buildAgentUpdateBody({ ...candidate, skills: resolveCandidateSkills(candidate, resolution) }, candidate.agent.fromVersion);
  if (candidate.systemSha256 === from.systemSha256) {
    if (system !== undefined) throw new Error("The candidate keeps the prompt of the version it updates; do not send `system`.");
    return body;
  }
  if (system === undefined) throw new Error("The candidate changes the prompt: pass the reviewed managed-agents/djonik.md body.");
  if (sha256(system) !== candidate.systemSha256) throw new Error("System prompt does not match the candidate's reviewed SHA-256.");
  return { ...body, system };
}
