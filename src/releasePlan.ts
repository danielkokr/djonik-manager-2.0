import type { DjonikRelease } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

/**
 * The exact `agents.update` body that turns the current Agent version into `release` (#33 cutover,
 * docs/52 §4). Derived from the reviewed release, never hand-typed. Only the fields a release may change
 * relative to its predecessor are sent — `skills` and `tools` (both full-replacement lists); model,
 * system, MCP servers and the specialist roster are omitted and therefore preserved. `version` is the
 * optimistic-concurrency precondition: the update fails unless the Agent is still at `fromVersion`.
 *
 * Building the body performs no request. Sending it is a production mutation that needs explicit
 * Product Owner authorization.
 */
export function buildAgentUpdateBody(release: DjonikRelease, fromVersion: number): Record<string, unknown> {
  const allow = { type: "always_allow" };
  const everyBuiltIn = release.builtInTools.length === 8;
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
            configs: release.builtInTools.map((name) => ({ name, enabled: true, permission_policy: allow })),
          },
      ...release.customTools.map((name) => ({
        type: "custom",
        name,
        description: SUPPORTED_CUSTOM_TOOLS[name].description,
        input_schema: SUPPORTED_CUSTOM_TOOLS[name].input_schema,
      })),
      ...release.mcpToolsets.map((toolset) => ({
        type: "mcp_toolset",
        mcp_server_name: toolset.server,
        default_config: { enabled: toolset.defaultEnabled, permission_policy: allow },
        configs: Object.entries(toolset.overrides).map(([name, enabled]) => ({ name, enabled, permission_policy: allow })),
      })),
    ],
  };
}
