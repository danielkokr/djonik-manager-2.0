import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DjonikRelease } from "./release.js";
import { SUPPORTED_CUSTOM_TOOLS } from "./releaseAttestation.js";

/**
 * Provider-shaped fixtures for release attestation tests (#33). Shapes mirror the live read-backs of
 * 2026-09-24 (docs/51 §10): `agents.retrieve` (roster as `{id, version}`, effort as `{type}`) and a
 * Session's resolved `agent` snapshot (roster members as full definitions). Test-only; not a test file.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const djonikSource = readFileSync(join(repoRoot, "managed-agents", "djonik.md"), "utf8").replace(/\r\n/g, "\n");
/** The coordinator prompt exactly as the Agent stores it (docs/42: byte-identical to the file body). */
export const SYSTEM_PROMPT = /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/.exec(djonikSource)![1].replace(/\n$/, "");

const allow = { type: "always_allow" };

function builtInToolset(release: DjonikRelease): Record<string, unknown> {
  if (release.builtInTools.length === 8) {
    return { type: "agent_toolset_20260401", default_config: { enabled: true, permission_policy: allow }, configs: [] };
  }
  return {
    type: "agent_toolset_20260401",
    default_config: { enabled: false, permission_policy: allow },
    configs: release.builtInTools.map((name) => ({ name, enabled: true, permission_policy: allow })),
  };
}

function tools(release: DjonikRelease): unknown[] {
  return [
    builtInToolset(release),
    ...release.customTools.map((name) => ({ type: "custom", name, ...SUPPORTED_CUSTOM_TOOLS[name] })),
    ...release.mcpToolsets.map((toolset) => ({
      type: "mcp_toolset",
      mcp_server_name: toolset.server,
      default_config: { enabled: toolset.defaultEnabled, permission_policy: allow },
      configs: Object.entries(toolset.overrides).map(([name, enabled]) => ({ name, enabled, permission_policy: allow })),
    })),
  ];
}

function skills(release: DjonikRelease): unknown[] {
  return release.skills.map((skill) => ({
    type: "custom",
    skill_id: skill.skillId,
    version: skill.pin.kind === "explicit" ? skill.pin.version : "latest",
  }));
}

/** An `agents.retrieve(id, {version})` result that exactly matches `release`. */
export function agentVersionFixture(release: DjonikRelease): Record<string, unknown> {
  return {
    id: release.agent.id,
    version: release.agent.version,
    archived_at: null,
    name: "Джонік",
    model: { id: release.model.id, effort: { type: release.model.effort }, speed: release.model.speed },
    system: SYSTEM_PROMPT,
    skills: skills(release),
    tools: tools(release),
    mcp_servers: release.mcpServers.map((server) => ({ type: "url", ...server })),
    multiagent: { type: "coordinator", agents: [{ type: "agent", id: release.specialist.id, version: release.specialist.version }] },
  };
}

/** A created Session whose resolved snapshot and resources exactly match `release`. */
export function servingSessionFixture(release: DjonikRelease, id = "sesn_test_serving"): Record<string, unknown> {
  const agent = agentVersionFixture(release);
  return {
    id,
    type: "session",
    status: "idle",
    environment_id: release.session.environmentId,
    vault_ids: [release.session.vaultId],
    metadata: {},
    resources: [{ type: "memory_store", memory_store_id: release.session.memoryStoreId, access: release.session.memoryAccess }],
    agent: {
      ...agent,
      archived_at: undefined,
      // As measured on the first v26 Session (docs/53 §4): explicit coordinator pins appear in the Session
      // snapshot as the provider's internal numeric version, while the roster keeps the `skver_` id.
      skills: release.skills.map((skill) => ({
        type: "custom",
        skill_id: skill.skillId,
        version: skill.pin.kind === "explicit" ? (skill.pin.sessionVersion ?? skill.pin.version) : "latest",
      })),
      multiagent: {
        type: "coordinator",
        agents: [
          {
            type: "agent",
            id: release.specialist.id,
            version: release.specialist.version,
            name: "Djonik Project Health Specialist",
            skills: release.specialist.skills.map((skill) => ({ type: "custom", skill_id: skill.skillId, version: skill.version })),
          },
        ],
      },
    },
  };
}

/** Current `latest_version_id` of each `latest`-referenced Skill, as the accepted versions resolve today. */
export function resolvedLatestFor(release: DjonikRelease): Record<string, string> {
  return Object.fromEntries(
    release.skills.flatMap((skill) => (skill.pin.kind === "latest" ? [[skill.skillId, skill.pin.expectedResolved]] : [])),
  );
}
