import { confirmationPolicyProblems, resolveCandidateSkills, type CandidateResolution, type DjonikRelease, type DjonikReleaseCandidate } from "./release.js";
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
 * The update body that would create a candidate's Agent version (Stage 3B), from the REAL remote Skill pins.
 * Throws `UnresolvedReleaseCandidateError` while any candidate Skill is unresolved — there is no body with a
 * placeholder id. Performs no request.
 */
export function buildCandidateUpdateBody(
  candidate: DjonikReleaseCandidate,
  resolution: Pick<CandidateResolution, "skills">,
): Record<string, unknown> {
  return buildAgentUpdateBody({ ...candidate, skills: resolveCandidateSkills(candidate, resolution) }, candidate.agent.fromVersion);
}

/**
 * The `agents.update` body for a candidate whose only change is the coordinator prompt (#41 → r28): the
 * optimistic-concurrency `version` precondition and `system`, nothing else — Skills, tools, model, MCP servers
 * and roster are preserved by omission (the docs/42 v24 → v25 precedent). `system` is the reviewed
 * `managed-agents/djonik.md` body; it is refused unless it hashes to the candidate's `systemSha256`, so a
 * wrong or edited prompt can never be sent. Performs no request; sending it needs Product Owner authorization.
 */
export function buildSystemUpdateBody(
  candidate: Pick<DjonikReleaseCandidate, "systemSha256" | "agent">,
  system: string,
): { version: number; system: string } {
  if (sha256(system) !== candidate.systemSha256) throw new Error("System prompt does not match the candidate's reviewed SHA-256.");
  return { version: candidate.agent.fromVersion, system };
}
