import { createHash } from "node:crypto";
import { BUILT_IN_TOOL_NAMES, type DjonikRelease } from "./release.js";
import { TRELLO_WORK_HISTORY_TOOL } from "./trelloWorkHistory.js";

/**
 * Startup attestation of the serving release (#33).
 *
 * Two read-backs are compared with the reviewed release (`release.ts`):
 *  1. **preflight** — `agents.retrieve(id, {version})` of the pinned Agent version, before any Session exists
 *     (a mismatch creates no remote resource);
 *  2. **serving evidence** — the created Session's own resolved `agent` snapshot and resources, which is what
 *     the provider will actually run (docs: "Snapshot of the agent at session creation time").
 *
 * Both are normalised to one content-free `ObservedConfig` and compared by the same function. Output is
 * identifiers, versions, booleans and hash prefixes only: never a prompt, Skill body, Memory content, user
 * text or credential.
 */

/** Custom tools this application can execute. An Agent exposing any other custom tool would stall on
 *  `requires_action` (the client settles only these), so attestation requires an exact match. */
export const SUPPORTED_CUSTOM_TOOLS: Readonly<Record<string, { description: string; input_schema: unknown }>> = {
  [TRELLO_WORK_HISTORY_TOOL.name]: TRELLO_WORK_HISTORY_TOOL,
};

export class ReleaseAttestationError extends Error {
  constructor(
    readonly phase: "preflight" | "session",
    readonly mismatches: string[],
  ) {
    super(`Djonik release attestation failed (${phase}): ${mismatches.join("; ")}`);
    this.name = "ReleaseAttestationError";
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 of key-sorted JSON. The provider returns JSON Schemas with re-ordered keys, so a raw
 *  `JSON.stringify` hash differs from the source even when the schema is identical (measured 2026-09-24). */
export function canonicalJsonSha256(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

// --- Normalisation ------------------------------------------------------------------------------

export interface ObservedToolset {
  enabled: string[];
  /** Enabled tools whose effective permission policy is not `always_allow`. Before #39 Stage 3A the client
   *  could not answer a confirmation, so any such tool had to be absent; now only the release's reviewed
   *  `confirmationRequired` set may appear here, and only as `always_ask`. */
  needsConfirmation: string[];
  /** Enabled tools whose effective policy is exactly `always_ask` (a subset of `needsConfirmation`;
   *  anything else there — `auto`, an unknown or missing policy — is drift). */
  alwaysAsk: string[];
}

export interface ObservedMcpToolset extends ObservedToolset {
  server: string;
  defaultEnabled: boolean;
  /** `default_config.permission_policy.type` — what every tool not named in `configs` inherits. */
  defaultPolicy: string | null;
  overrides: Record<string, boolean>;
}

export interface ObservedConfig {
  agentId: string | null;
  agentVersion: number | null;
  archived: boolean;
  model: { id: string | null; effort: string | null; speed: string | null };
  systemSha256: string | null;
  skills: Array<{ skillId: string; version: string }>;
  roster: Array<{ id: string; version: number | null; skills: Array<{ skillId: string; version: string }> | null }>;
  builtIn: ObservedToolset | null;
  customTools: Array<{ name: string; schemaSha256: string; descriptionSha256: string }>;
  mcpServers: Array<{ name: string; url: string }>;
  mcpToolsets: ObservedMcpToolset[];
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function policyType(policy: unknown): string | null {
  return isRec(policy) ? str(policy.type) : null;
}

function normalizeSkills(value: unknown): Array<{ skillId: string; version: string }> {
  return arr(value)
    .filter(isRec)
    .map((skill) => ({ skillId: str(skill.skill_id) ?? "?", version: str(skill.version) ?? "latest" }));
}

/** Effective per-tool state of a toolset: `configs` override `default_config` for the named tool. */
function effectiveToolset(
  toolset: Rec,
  knownNames: readonly string[],
): ObservedToolset & { overrides: Record<string, boolean>; defaultEnabled: boolean; defaultPolicy: string | null } {
  const defaults = isRec(toolset.default_config) ? toolset.default_config : {};
  const defaultEnabled = defaults.enabled !== false;
  const defaultPolicy = policyType(defaults.permission_policy);
  const overrides: Record<string, boolean> = {};
  const overridePolicy: Record<string, string | null> = {};
  for (const config of arr(toolset.configs).filter(isRec)) {
    const name = str(config.name);
    if (!name) continue;
    overrides[name] = config.enabled !== false;
    overridePolicy[name] = policyType(config.permission_policy);
  }
  const names = [...new Set([...knownNames, ...Object.keys(overrides)])];
  const enabled = names.filter((name) => overrides[name] ?? defaultEnabled).sort();
  const effectivePolicy = (name: string) => overridePolicy[name] ?? defaultPolicy;
  const needsConfirmation = enabled.filter((name) => effectivePolicy(name) !== "always_allow").sort();
  const alwaysAsk = enabled.filter((name) => effectivePolicy(name) === "always_ask").sort();
  // A default-enabled toolset (MCP) can expose tools not named here; their policy is the default one.
  if (defaultEnabled && defaultPolicy !== "always_allow" && !needsConfirmation.includes("*")) needsConfirmation.push("*");
  return { enabled, needsConfirmation, alwaysAsk, overrides, defaultEnabled, defaultPolicy };
}

/**
 * Normalises either an Agent version (`agents.retrieve`) or a Session's resolved `agent` snapshot. The two
 * differ only in the roster: an Agent lists `{id, version}`, a Session carries each member's full definition.
 */
export function normalizeAgentConfig(agent: unknown): ObservedConfig {
  const a = isRec(agent) ? agent : {};
  const model = isRec(a.model) ? a.model : { id: a.model };
  const effort = isRec(model.effort) ? str(model.effort.type) : str(model.effort);
  const system = str(a.system);
  const tools = arr(a.tools).filter(isRec);

  const builtInRaw = tools.find((tool) => tool.type === "agent_toolset_20260401");
  let builtIn: ObservedToolset | null = null;
  if (builtInRaw) {
    const { enabled, needsConfirmation, alwaysAsk } = effectiveToolset(builtInRaw, BUILT_IN_TOOL_NAMES);
    builtIn = { enabled, needsConfirmation: needsConfirmation.filter((name) => name !== "*"), alwaysAsk };
  }

  const multiagent = isRec(a.multiagent) ? a.multiagent : null;
  const roster = arr(multiagent?.agents)
    .filter(isRec)
    .map((member) => ({
      id: str(member.id) ?? "?",
      version: typeof member.version === "number" ? member.version : null,
      skills: Array.isArray(member.skills) ? normalizeSkills(member.skills) : null,
    }));

  return {
    agentId: str(a.id),
    agentVersion: typeof a.version === "number" ? a.version : null,
    archived: str(a.archived_at) !== null,
    model: { id: str(model.id), effort, speed: str(model.speed) },
    systemSha256: system === null ? null : sha256(system),
    skills: normalizeSkills(a.skills),
    roster,
    builtIn,
    customTools: tools
      .filter((tool) => tool.type === "custom")
      .map((tool) => ({
        name: str(tool.name) ?? "?",
        schemaSha256: canonicalJsonSha256(tool.input_schema ?? null),
        descriptionSha256: sha256(str(tool.description) ?? ""),
      })),
    mcpServers: arr(a.mcp_servers)
      .filter(isRec)
      .map((server) => ({ name: str(server.name) ?? "?", url: str(server.url) ?? "?" })),
    mcpToolsets: tools
      .filter((tool) => tool.type === "mcp_toolset")
      .map((tool) => {
        const { enabled, needsConfirmation, alwaysAsk, overrides, defaultEnabled, defaultPolicy } = effectiveToolset(tool, []);
        return { server: str(tool.mcp_server_name) ?? "?", defaultEnabled, defaultPolicy, overrides, enabled, needsConfirmation, alwaysAsk };
      }),
  };
}

// --- Comparison ---------------------------------------------------------------------------------

const short = (hash: string | null) => (hash === null ? "none" : hash.slice(0, 12));
const sortedJoin = (values: string[]) => [...values].sort().join(",");

function sameRecord(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export interface AttestationOptions {
  /** Current `latest_version_id` of each Skill the release references as `latest` (read at startup). */
  resolvedLatest?: Readonly<Record<string, string>>;
}

/** Every difference between the reviewed release and an observed Agent/Session config, content-free. */
export function compareWithRelease(release: DjonikRelease, observed: ObservedConfig, options: AttestationOptions = {}): string[] {
  const mismatches: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) mismatches.push(message);
  };

  expect(observed.agentId === release.agent.id, `agent id ${observed.agentId} != ${release.agent.id}`);
  expect(observed.agentVersion === release.agent.version, `agent version ${observed.agentVersion} != ${release.agent.version}`);
  expect(!observed.archived, "agent version is archived");
  expect(observed.model.id === release.model.id, `model ${observed.model.id} != ${release.model.id}`);
  expect(observed.model.effort === release.model.effort, `effort ${observed.model.effort} != ${release.model.effort}`);
  expect(observed.model.speed === release.model.speed, `speed ${observed.model.speed} != ${release.model.speed}`);
  expect(observed.systemSha256 === release.systemSha256, `system sha ${short(observed.systemSha256)} != ${short(release.systemSha256)}`);

  // Skills: exact set; each reference must have the reviewed form.
  const observedSkills = new Map(observed.skills.map((skill) => [skill.skillId, skill.version]));
  expect(observed.skills.length === observedSkills.size, "duplicate skill reference");
  for (const skill of release.skills) {
    const version = observedSkills.get(skill.skillId);
    if (version === undefined) {
      mismatches.push(`skill ${skill.name} (${skill.skillId}) missing`);
      continue;
    }
    if (skill.pin.kind === "explicit") {
      // The `skver_` id (Agent version) or the provider's Session-snapshot spelling of that same version.
      const accepted = version === skill.pin.version || (skill.pin.sessionVersion !== undefined && version === skill.pin.sessionVersion);
      expect(accepted, `skill ${skill.name} version ${version} != ${skill.pin.version}`);
    } else {
      expect(version === "latest", `skill ${skill.name} version ${version} != latest`);
      const resolved = options.resolvedLatest?.[skill.skillId];
      expect(
        resolved === skill.pin.expectedResolved,
        `skill ${skill.name} latest resolves to ${resolved ?? "unknown"} != ${skill.pin.expectedResolved}`,
      );
    }
  }
  const expectedSkillIds = new Set<string>(release.skills.map((skill) => skill.skillId));
  for (const skillId of observedSkills.keys()) expect(expectedSkillIds.has(skillId), `unexpected skill ${skillId}`);

  // Specialist roster: exactly one member, the canonical specialist at its pinned version.
  expect(observed.roster.length === 1, `roster has ${observed.roster.length} members, expected 1`);
  const member = observed.roster.find((entry) => entry.id === release.specialist.id);
  if (!member) {
    mismatches.push(`specialist ${release.specialist.id} missing from roster`);
  } else {
    expect(member.version === release.specialist.version, `specialist version ${member.version} != ${release.specialist.version}`);
    if (member.skills !== null) {
      const expected = release.specialist.skills.map((skill) => `${skill.skillId}@${skill.version}`);
      const actual = member.skills.map((skill) => `${skill.skillId}@${skill.version}`);
      expect(sortedJoin(actual) === sortedJoin(expected), `specialist skills ${sortedJoin(actual)} != ${sortedJoin(expected)}`);
    }
  }

  // Built-in toolset: effective enabled set; exactly the reviewed tools wait for a confirmation, and only as
  // `always_ask` (#39 Stage 3A). A release without `confirmationRequired` expects none (r25/r26, unchanged).
  if (!observed.builtIn) {
    mismatches.push("agent_toolset_20260401 missing");
  } else {
    expect(
      sortedJoin(observed.builtIn.enabled) === sortedJoin(release.builtInTools),
      `built-in tools [${sortedJoin(observed.builtIn.enabled)}] != [${sortedJoin(release.builtInTools)}]`,
    );
    const expectedAsk = release.confirmationRequired?.builtIn ?? [];
    expect(
      sortedJoin(observed.builtIn.needsConfirmation) === sortedJoin(expectedAsk),
      `built-in tools need confirmation: [${sortedJoin(observed.builtIn.needsConfirmation)}] != [${sortedJoin(expectedAsk)}]`,
    );
    expect(
      sortedJoin(observed.builtIn.alwaysAsk) === sortedJoin(expectedAsk),
      `built-in always_ask tools [${sortedJoin(observed.builtIn.alwaysAsk)}] != [${sortedJoin(expectedAsk)}]`,
    );
  }

  // Custom tools: exact name set, each byte-identical (canonically) to the tool this revision executes.
  const observedCustom = observed.customTools.map((tool) => tool.name);
  expect(sortedJoin(observedCustom) === sortedJoin(release.customTools), `custom tools [${sortedJoin(observedCustom)}] != [${sortedJoin(release.customTools)}]`);
  for (const tool of observed.customTools) {
    const source = SUPPORTED_CUSTOM_TOOLS[tool.name];
    if (!source) {
      mismatches.push(`custom tool ${tool.name} is not executable by this application`);
      continue;
    }
    const schema = canonicalJsonSha256(source.input_schema);
    expect(tool.schemaSha256 === schema, `custom tool ${tool.name} schema ${short(tool.schemaSha256)} != ${short(schema)}`);
    const description = sha256(source.description);
    expect(tool.descriptionSha256 === description, `custom tool ${tool.name} description ${short(tool.descriptionSha256)} != ${short(description)}`);
  }

  // MCP servers and toolsets: same servers/URLs, same default and per-tool overrides; confirmations exactly
  // as reviewed (none unless `confirmationRequired` names them, always as `always_ask`).
  const servers = (list: Array<{ name: string; url: string }>) => sortedJoin(list.map((server) => `${server.name}=${server.url}`));
  expect(servers(observed.mcpServers) === servers(release.mcpServers), `mcp servers [${servers(observed.mcpServers)}] != [${servers(release.mcpServers)}]`);
  expect(observed.mcpToolsets.length === release.mcpToolsets.length, `mcp toolsets ${observed.mcpToolsets.length} != ${release.mcpToolsets.length}`);
  for (const expected of release.mcpToolsets) {
    const toolset = observed.mcpToolsets.find((entry) => entry.server === expected.server);
    if (!toolset) {
      mismatches.push(`mcp toolset ${expected.server} missing`);
      continue;
    }
    expect(toolset.defaultEnabled === expected.defaultEnabled, `mcp toolset ${expected.server} default enabled ${toolset.defaultEnabled} != ${expected.defaultEnabled}`);
    expect(sameRecord(toolset.overrides, expected.overrides), `mcp toolset ${expected.server} overrides differ`);
    const expectedAsk = release.confirmationRequired?.mcp[expected.server] ?? [];
    // The default policy is what an unnamed (unknown, future) server tool inherits (#39 Stage 3A).
    const expectedDefaultPolicy = expected.defaultPolicy ?? "always_allow";
    expect(
      toolset.defaultPolicy === expectedDefaultPolicy,
      `mcp toolset ${expected.server} default policy ${toolset.defaultPolicy} != ${expectedDefaultPolicy}`,
    );
    // An enabled `always_ask` default gates every unnamed tool, reported as `*`.
    const expectedNeeds = expected.defaultEnabled && expectedDefaultPolicy === "always_ask" ? [...expectedAsk, "*"] : expectedAsk;
    expect(
      sortedJoin(toolset.needsConfirmation) === sortedJoin(expectedNeeds),
      `mcp toolset ${expected.server} needs confirmation: [${sortedJoin(toolset.needsConfirmation)}] != [${sortedJoin(expectedNeeds)}]`,
    );
    expect(
      sortedJoin(toolset.alwaysAsk) === sortedJoin(expectedAsk),
      `mcp toolset ${expected.server} always_ask tools [${sortedJoin(toolset.alwaysAsk)}] != [${sortedJoin(expectedAsk)}]`,
    );
  }

  return mismatches;
}

/** Session-level resources that the Agent version does not carry. */
export function compareSessionResources(release: DjonikRelease, session: unknown): string[] {
  const s = isRec(session) ? session : {};
  const mismatches: string[] = [];
  if (s.environment_id !== release.session.environmentId) mismatches.push(`environment ${str(s.environment_id)} != ${release.session.environmentId}`);
  const vaults = arr(s.vault_ids).map(String);
  if (vaults.length !== 1 || vaults[0] !== release.session.vaultId) mismatches.push(`vaults [${vaults.join(",")}] != [${release.session.vaultId}]`);
  const memory = arr(s.resources).filter(isRec).filter((resource) => resource.type === "memory_store");
  if (memory.length !== 1 || memory[0].memory_store_id !== release.session.memoryStoreId) {
    mismatches.push(`memory stores [${memory.map((m) => str(m.memory_store_id)).join(",")}] != [${release.session.memoryStoreId}]`);
  } else if ((memory[0].access ?? "read_write") !== release.session.memoryAccess) {
    mismatches.push(`memory access ${str(memory[0].access)} != ${release.session.memoryAccess}`);
  }
  return mismatches;
}

/** Throws `ReleaseAttestationError` unless the pinned Agent version matches the release (preflight). */
export function attestAgentVersion(release: DjonikRelease, agent: unknown, options: AttestationOptions = {}): ObservedConfig {
  const observed = normalizeAgentConfig(agent);
  const mismatches = compareWithRelease(release, observed, options);
  if (mismatches.length > 0) throw new ReleaseAttestationError("preflight", mismatches);
  return observed;
}

/** Throws `ReleaseAttestationError` unless the created Session will run exactly the release (serving evidence). */
export function attestServingSession(release: DjonikRelease, session: unknown, options: AttestationOptions = {}): ObservedConfig {
  const agent = isRec(session) ? session.agent : undefined;
  const observed = normalizeAgentConfig(agent);
  const mismatches = [...compareWithRelease(release, observed, options), ...compareSessionResources(release, session)];
  if (mismatches.length > 0) throw new ReleaseAttestationError("session", mismatches);
  return observed;
}

/** Skill ids the release references as `latest` (their current latest version must be read at startup). */
export function latestSkillIds(release: DjonikRelease): string[] {
  return release.skills.filter((skill) => skill.pin.kind === "latest").map((skill) => skill.skillId);
}

// --- Content-free serving tuple ---------------------------------------------------------------

export interface ServingTupleInput {
  release: DjonikRelease;
  appRevision: string;
  sessionId: string;
  observed: ObservedConfig;
  trelloHistory?: string;
}

/**
 * One log line recording what this process serves. Built only from reviewed identifiers and hashes — the
 * release, the attested snapshot and the app revision — so it cannot carry a secret or message content.
 */
export function formatServingTuple(input: ServingTupleInput): string {
  const { release, observed } = input;
  const skillPins = release.skills.some((skill) => skill.pin.kind === "latest") ? "latest-resolved" : "explicit";
  const skills = release.skills
    .map((skill) => `${skill.name}@${skill.pin.kind === "explicit" ? skill.pin.version : `latest->${skill.pin.expectedResolved}`}`)
    .join(",");
  const fields = [
    `release=${release.id}`,
    `app=${input.appRevision}`,
    `agent=${release.agent.id}@${observed.agentVersion}`,
    `model=${observed.model.id}/${observed.model.effort}/${observed.model.speed}`,
    `system=${short(observed.systemSha256)}`,
    `skill_pins=${skillPins}`,
    `skills=${skills}`,
    `specialist=${release.specialist.id}@${release.specialist.version}`,
    `builtin=${sortedJoin(observed.builtIn?.enabled ?? [])}`,
    `custom_tools=${observed.customTools.map((tool) => `${tool.name}#${short(tool.schemaSha256)}`).join(",") || "none"}`,
    `memory=${release.session.memoryAccess}`,
    `session=${input.sessionId}`,
  ];
  // #39 Stage 3A: the attested `always_ask` set, only for a release that declares one (r26's line is unchanged).
  if (release.confirmationRequired) {
    const gated = [
      ...(observed.builtIn?.alwaysAsk ?? []),
      ...observed.mcpToolsets.flatMap((toolset) => toolset.alwaysAsk.map((name) => `${toolset.server}/${name}`)),
    ];
    fields.splice(fields.length - 2, 0, `always_ask=${sortedJoin(gated) || "none"}`);
  }
  if (input.trelloHistory) fields.push(`trello_history=${input.trelloHistory}`);
  return `[release] serving ${fields.join(" ")}`;
}
