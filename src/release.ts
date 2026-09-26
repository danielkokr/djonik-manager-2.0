/**
 * Djonik release definitions (#33).
 *
 * The immutable release unit is the provider's own **Agent version**: a version snapshot fixes model,
 * system prompt, Skill references, tools, custom tools, MCP servers and the specialist roster pin. It is
 * only truly immutable when every Skill reference is an explicit `skver_…` (a `latest` reference keeps
 * resolving to whatever Skill version is newest, and a Session snapshot records the literal "latest").
 *
 * What the Agent version cannot carry — the application revision and the Session resources (environment,
 * vault, Memory store and its access mode) — is bound here, in reviewed application source. The app
 * revision therefore implies exactly one serving release, and startup attestation compares the live Agent
 * version and the created Session snapshot against it (`releaseAttestation.ts`), failing closed on drift.
 *
 * This file holds non-secret resource identifiers only. It is not a second Djonik identity: the Managed
 * Agent stays authoritative; this is the reviewed *expectation* of what the adapter may serve.
 */

export const BUILT_IN_TOOL_NAMES = ["bash", "read", "write", "edit", "glob", "grep", "web_fetch", "web_search"] as const;
export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

/** A coordinator Skill reference. `explicit` is the only immutable form; `latest` is tolerated only for a
 *  release that predates pinning, and only while the Skill's current latest version still equals the
 *  reviewed one (checked at startup, reported as a weaker pin in the serving tuple).
 *
 *  `sessionVersion` is how the provider writes that same pinned version in a **Session's** resolved agent
 *  snapshot. Measured 2026-09-24 (docs/53 §4): an Agent version stores the `skver_…` id, but a Session
 *  created from it reports each explicitly pinned coordinator Skill as an internal numeric version (a
 *  microsecond timestamp the public Skill Version API does not expose). Each value below was read from the
 *  first Session pinned to Agent v26 and matched to its `skver_` by `created_at` (0.4–2.8 s apart; the
 *  nearest other version of the same Skill is ≥ 50 s away). Attestation accepts exactly these two spellings
 *  of the pinned version and nothing else. */
export type ReleaseSkill =
  | { name: string; skillId: string; pin: { kind: "explicit"; version: string; sessionVersion?: string } }
  | { name: string; skillId: string; pin: { kind: "latest"; expectedResolved: string } };

export interface ReleaseMcpToolset {
  server: string;
  defaultEnabled: boolean;
  /** Explicit per-tool overrides exactly as the Agent declares them (tool name → enabled). */
  overrides: Record<string, boolean>;
  /** `default_config.permission_policy` — the policy every tool NOT named in `overrides` inherits (#39
   *  Stage 3A). Absent = `always_allow` (the r25/r26 semantics, unchanged). `always_ask` makes an unknown
   *  future server tool wait for a confirmation that the client never allows (fail closed). */
  defaultPolicy?: "always_allow" | "always_ask";
}

/**
 * Enabled tools whose effective provider `permission_policy` is `always_ask` (#39 Stage 3A): the Session
 * pauses on `requires_action` and the client answers `user.tool_confirmation` (allow for Daniel's turns,
 * deny for autonomous ones). Every other enabled tool is `always_allow`; `auto` is never part of a release.
 * Absent means none — the r25/r26 semantics, unchanged.
 */
export interface ReleaseConfirmationPolicy {
  builtIn: BuiltInToolName[];
  /** MCP server name → tool names (each must be an enabled tool of that toolset). */
  mcp: Record<string, string[]>;
}

export interface DjonikRelease {
  /** Stable release label, recorded on every serving Session's metadata. */
  id: string;
  agent: { id: string; version: number };
  model: { id: string; effort: "low" | "medium" | "high"; speed: "standard" | "fast" };
  /** SHA-256 of the Agent `system` prompt (UTF-8), i.e. of the `managed-agents/djonik.md` body. */
  systemSha256: string;
  skills: ReleaseSkill[];
  specialist: { id: string; version: number; skills: Array<{ skillId: string; version: string }> };
  /** Effective enabled set of `agent_toolset_20260401`, order-insensitive. */
  builtInTools: BuiltInToolName[];
  /** Custom tools the Agent must expose — each must be one this application executes (#36/#40). */
  customTools: string[];
  mcpServers: Array<{ name: string; url: string }>;
  mcpToolsets: ReleaseMcpToolset[];
  /** Tools gated by `always_ask`; absent = none (every enabled tool `always_allow`). */
  confirmationRequired?: ReleaseConfirmationPolicy;
  session: {
    environmentId: string;
    vaultId: string;
    memoryStoreId: string;
    memoryAccess: "read_write" | "read_only";
  };
}

const COORDINATOR_ID = "agent_01WGRHDBjQa3eMhoGJMmQ1dh";
const SPECIALIST = {
  id: "agent_01KNiQDzzPjaMU6LLF4mU6uM",
  version: 4,
  skills: [{ skillId: "skill_01Treson5zdU1TgxXDaREwnY", version: "skver_01JLTtMvUgfEqdcBBGj4WGVm" }],
};
const SESSION = {
  environmentId: "env_01LVWPmvP5F3fLy28EaycVU2",
  vaultId: "vlt_011Cf5Ju4bN6RhVP7DnA1ZA4",
  memoryStoreId: "memstore_01WViYK3WQvGEgojB2GiaDFq",
  memoryAccess: "read_write" as const,
};
const MODEL = { id: "claude-sonnet-5", effort: "medium" as const, speed: "standard" as const };
/** `managed-agents/djonik.md` body, byte-identical to production v25 (docs/42, docs/50). */
const SYSTEM_SHA256 = "3e204453c82c87aa82404f5007f872a93bd2778a22ec97a0b6c0fd1224b5a4b6";
const MCP_SERVERS = [
  { name: "trello", url: "https://mcp.trello.com/v1" },
  { name: "google-calendar-calendarmcp", url: "https://calendarmcp.googleapis.com/mcp/v1" },
];
const MCP_TOOLSETS: ReleaseMcpToolset[] = [
  {
    server: "trello",
    defaultEnabled: true,
    overrides: {
      trelloWriteBoard: false,
      trelloWriteCard: true,
      trelloWriteChecklist: false,
      trelloWriteInbox: false,
      trelloWriteList: false,
      trelloWritePlanner: false,
    },
  },
  { server: "google-calendar-calendarmcp", defaultEnabled: false, overrides: {} },
];

/** Accepted #38 Skill versions, each byte-identical to the repo source (docs/42, docs/50 §2). */
const ACCEPTED_SKILL_VERSIONS = {
  "task-management": { skillId: "skill_01WS6JtY1GMu3rGZaKCVR9w1", version: "skver_01CJQkVY1kp1urhBWQgHUYxW", sessionVersion: "1790164354565465" },
  "daily-planning": { skillId: "skill_01G9DtQEzPYxgw78riFh8k99", version: "skver_01EL7d3fy4WWYBSsD3PmK9LQ", sessionVersion: "1790164356765333" },
  "weekly-planning": { skillId: "skill_01PTmbvLHJj1HuUxvDKhpaiE", version: "skver_01FdtnnkbePBjNJGTuJyAvhw", sessionVersion: "1790164359202020" },
  "studio-intake": { skillId: "skill_015c8dtDnWyDfVLwS6NLS7r6", version: "skver_018sJv1GCnzfZRG4NbExbAzj", sessionVersion: "1789734659839542" },
} as const;
/** Accepted #36 work-review Skill v2 (docs/32), = repo blob `c079d285…e640`. */
const WORK_REVIEW_SKILL = { skillId: "skill_0169h7GYNYUDDDZteDCUV2fE", version: "skver_015LYzVdivGGMsBpuki4kW4S", sessionVersion: "1790083840153637" };

/**
 * r25 — the accepted #38 production baseline as it exists today (Agent v25). Its four Skills are
 * `latest` references, so it is served only as a **latest-resolved** release: startup proves each
 * `latest` still resolves to the accepted version, and the tuple line reports the weaker pin. It is no
 * longer served (docs/53) and stays only as the app-level rollback target of r26: v25 is immutable.
 */
export const RELEASE_R25: DjonikRelease = {
  id: "r25",
  agent: { id: COORDINATOR_ID, version: 25 },
  model: MODEL,
  systemSha256: SYSTEM_SHA256,
  skills: Object.entries(ACCEPTED_SKILL_VERSIONS).map(([name, pin]) => ({
    name,
    skillId: pin.skillId,
    pin: { kind: "latest" as const, expectedResolved: pin.version },
  })),
  specialist: SPECIALIST,
  builtInTools: [...BUILT_IN_TOOL_NAMES],
  customTools: [],
  mcpServers: MCP_SERVERS,
  mcpToolsets: MCP_TOOLSETS,
  session: SESSION,
};

/**
 * r26 — the #33 production release (Agent v26, created 2026-09-24 from v25 with the generated update body
 * and read back exactly; docs/53). Relative to r25 it
 * changes exactly three things: explicit Skill pins (same accepted content), the accepted #36
 * capability (`work-review` Skill v2 + `trello_work_history` custom tool), and a built-in allowlist that
 * drops `bash`, `web_fetch` and `web_search` (docs/51 §8). Model, prompt, MCP, Trello write surface,
 * disabled Calendar, specialist v4 and Session resources are unchanged. Its source is
 * `managed-agents/djonik.md`; `src/release.test.ts` keeps the two in lockstep.
 */
export const RELEASE_R26: DjonikRelease = {
  id: "r26",
  agent: { id: COORDINATOR_ID, version: 26 },
  model: MODEL,
  systemSha256: SYSTEM_SHA256,
  skills: [
    ...Object.entries(ACCEPTED_SKILL_VERSIONS).map(([name, pin]) => ({
      name,
      skillId: pin.skillId,
      pin: { kind: "explicit" as const, version: pin.version, sessionVersion: pin.sessionVersion },
    })),
    {
      name: "work-review",
      skillId: WORK_REVIEW_SKILL.skillId,
      pin: { kind: "explicit" as const, version: WORK_REVIEW_SKILL.version, sessionVersion: WORK_REVIEW_SKILL.sessionVersion },
    },
  ],
  specialist: SPECIALIST,
  builtInTools: ["read", "write", "edit", "glob", "grep"],
  customTools: ["trello_work_history"],
  mcpServers: MCP_SERVERS,
  mcpToolsets: MCP_TOOLSETS,
  session: SESSION,
};

/** A gated tool must be an enabled tool that the body names explicitly: an enabled built-in, or an MCP tool
 *  with an explicit `enabled: true` override (a default-enabled but unnamed tool would silently stay
 *  `always_allow`). */
export function confirmationPolicyProblems(release: Pick<DjonikRelease, "builtInTools" | "mcpToolsets" | "confirmationRequired">): string[] {
  const policy = release.confirmationRequired;
  if (!policy) return [];
  const problems: string[] = [];
  for (const name of policy.builtIn) if (!release.builtInTools.includes(name)) problems.push(`built-in ${name} is not enabled`);
  for (const [server, names] of Object.entries(policy.mcp)) {
    const toolset = release.mcpToolsets.find((entry) => entry.server === server);
    if (!toolset) {
      problems.push(`mcp toolset ${server} missing`);
      continue;
    }
    for (const name of names) if (toolset.overrides[name] !== true) problems.push(`mcp ${server}/${name} is not an explicitly enabled tool`);
  }
  return problems;
}

// --- r27 candidate (#39 Stage 3A, source only) -----------------------------------------------------------

/** The Skill of a release candidate that has no remote Skill/version yet. Deliberately not a `ReleaseSkill`:
 *  it has no `skill_…` id and no `skver_…` pin, so it cannot be served, attested or sent to the provider. */
export interface UnresolvedCandidateSkill {
  name: string;
  skillId: null;
  pin: { kind: "unresolved"; reason: string };
}

/**
 * A release that is not yet a release: what r27 must contain, with the remote identifiers that do not exist
 * yet left visibly unresolved. It is not a `DjonikRelease` (no Agent version, unresolved Skill), is not in
 * `RELEASES`, and can be neither served nor attested. `resolveReleaseCandidate` turns it into a release only
 * when every real remote identifier is supplied (Stage 3B).
 */
export interface DjonikReleaseCandidate extends Omit<DjonikRelease, "id" | "agent" | "skills"> {
  candidateId: string;
  /** The release id it becomes once resolved. */
  becomes: string;
  agent: { id: string; fromVersion: number; version: null };
  skills: Array<ReleaseSkill | UnresolvedCandidateSkill>;
  confirmationRequired: ReleaseConfirmationPolicy;
}

/**
 * The current Trello MCP read inventory — every non-write tool of the official server as measured in the
 * docs/04 §17 inventory (15 tools: these 9 reads + 6 `trelloWrite*`) and enabled in production since #19
 * (docs/16 §2). r26 enables them implicitly through its `always_allow` default; the r27 candidate names each
 * one explicitly because its default is `always_ask`.
 */
export const REVIEWED_TRELLO_READ_TOOLS = [
  "trelloReadBoard",
  "trelloReadCard",
  "trelloReadChecklist",
  "trelloReadInbox",
  "trelloReadList",
  "trelloReadMember",
  "trelloReadPlanner",
  "trelloReadWorkspace",
  "trelloSearch",
] as const;

/**
 * r27 candidate — the reviewed Stage 3A *intent*, kept as the input that `RELEASE_R27` was resolved from
 * (Stage 3B-1, docs/64); it stays unresolved by design and is never served. r26 plus exactly three changes:
 *  1. the `pm-rhythm` Skill (repo `.claude/skills/pm-rhythm/SKILL.md`, #39 Stage 1), not yet synced — its
 *     remote Skill id and `skver_` pin are UNRESOLVED;
 *  2. every reachable mutating tool is `always_ask`: built-in `write`/`edit` (incl. native Memory writes)
 *     and Trello `trelloWriteCard` (the one enabled Trello write). The five disabled Trello writes stay
 *     disabled; Calendar stays disabled; `trello_work_history` is a read-only custom tool (not governed by
 *     permission policies) and stays client-executed under #40;
 *  3. the Trello toolset fails closed for unreviewed tools: default `always_ask`, every reviewed read
 *     (`REVIEWED_TRELLO_READ_TOOLS`) explicitly enabled `always_allow`. Same effective read/write surface.
 * Same Agent identity, model, prompt, specialist v4, accepted Skills, custom tool, MCP servers and Session
 * resources as r26.
 */
export const RELEASE_R27_CANDIDATE: DjonikReleaseCandidate = {
  candidateId: "r27-candidate",
  becomes: "r27",
  agent: { id: COORDINATOR_ID, fromVersion: 26, version: null },
  model: RELEASE_R26.model,
  systemSha256: RELEASE_R26.systemSha256,
  skills: [
    ...RELEASE_R26.skills,
    { name: "pm-rhythm", skillId: null, pin: { kind: "unresolved", reason: "pm-rhythm not yet synced to Managed Agents (Stage 3B)" } },
  ],
  specialist: RELEASE_R26.specialist,
  builtInTools: RELEASE_R26.builtInTools,
  customTools: RELEASE_R26.customTools,
  mcpServers: RELEASE_R26.mcpServers,
  mcpToolsets: MCP_TOOLSETS.map((toolset) =>
    toolset.server === "trello"
      ? {
          server: "trello",
          defaultEnabled: true,
          // Fail closed for tools this release has not reviewed: an unknown future Trello tool inherits
          // `always_ask`, and the client allows only `REVIEWED_CONFIRMATION_TOOLS` — so it is denied.
          defaultPolicy: "always_ask",
          // Every reviewed read, explicitly enabled (and `always_allow`: not in `confirmationRequired`), plus
          // r26's exact write overrides (trelloWriteCard enabled and gated, the other five disabled).
          overrides: { ...Object.fromEntries(REVIEWED_TRELLO_READ_TOOLS.map((name) => [name, true])), ...toolset.overrides },
        }
      : toolset,
  ),
  confirmationRequired: { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard"] } },
  session: RELEASE_R26.session,
};

/** The real remote identifiers Stage 3B obtains. Nothing here may be invented. */
export interface CandidateResolution {
  /** Remote Skill id and immutable `skver_` pin for each unresolved candidate Skill, by name. */
  skills: Record<string, { skillId: string; version: string; sessionVersion?: string }>;
  /** The Agent version the provider created from `agent.fromVersion` with the candidate's update body. */
  agentVersion?: number;
}

export class UnresolvedReleaseCandidateError extends Error {
  constructor(readonly unresolved: string[]) {
    super(`Release candidate is not fully resolved: ${unresolved.join("; ")}`);
    this.name = "UnresolvedReleaseCandidateError";
  }
}

/** The candidate's Skills with every unresolved one pinned from `resolution`; throws if any stays open. */
export function resolveCandidateSkills(candidate: DjonikReleaseCandidate, resolution: Pick<CandidateResolution, "skills">): ReleaseSkill[] {
  const missing: string[] = [];
  const skills = candidate.skills.map((skill): ReleaseSkill => {
    if (skill.pin.kind !== "unresolved") return skill as ReleaseSkill;
    const pin = resolution.skills[skill.name];
    if (!pin || !/^skill_\w+$/.test(pin.skillId) || !/^skver_\w+$/.test(pin.version)) {
      missing.push(`skill ${skill.name}`);
      return skill as unknown as ReleaseSkill;
    }
    return {
      name: skill.name,
      skillId: pin.skillId,
      pin: { kind: "explicit", version: pin.version, ...(pin.sessionVersion === undefined ? {} : { sessionVersion: pin.sessionVersion }) },
    };
  });
  if (missing.length > 0) throw new UnresolvedReleaseCandidateError(missing);
  return skills;
}

/** The candidate as a real release, once every remote identifier exists (Stage 3B). */
export function resolveReleaseCandidate(candidate: DjonikReleaseCandidate, resolution: CandidateResolution): DjonikRelease {
  const skills = resolveCandidateSkills(candidate, resolution);
  const version = resolution.agentVersion;
  if (version === undefined || !Number.isInteger(version) || version <= candidate.agent.fromVersion) {
    throw new UnresolvedReleaseCandidateError([`agent version (created from v${candidate.agent.fromVersion})`]);
  }
  const { candidateId: _candidateId, becomes, agent, skills: _skills, ...rest } = candidate;
  return { ...rest, id: becomes, agent: { id: agent.id, version }, skills };
}

// --- r27 (#39 Stage 3B-1) -----------------------------------------------------------------------------------

/** `pm-rhythm` as synced 2026-09-25 (docs/64 §3): the only version of its Skill, byte-identical to the
 *  committed `.claude/skills/pm-rhythm/SKILL.md` (SHA-256 `8617fd5c…84f9`). `sessionVersion` was read from
 *  the zero-event inspection Session pinned to v27 (`sesn_01MN2WHdhwexuwxhu8sLB91G`): 0.38 s before the
 *  `skver_`'s `created_at`, the same spelling rule as docs/53 §4. */
const PM_RHYTHM_SKILL = { skillId: "skill_01GzpQX3bVuWNk5bhbGcbzku", version: "skver_01Y77TKeXY9suV99XZU3cv5a", sessionVersion: "1790320523604075" };

/**
 * r27 — the #39 release (Agent v27, created 2026-09-25 from v26 with the generated candidate body under a
 * `version: 26` precondition and read back exactly; docs/64). It is `RELEASE_R27_CANDIDATE` with its real
 * identifiers: r26 + the `pm-rhythm` Skill (explicit pin) + the pre-execution permission policies (built-in
 * `write`/`edit` and Trello `trelloWriteCard` `always_ask`; Trello default `always_ask`; the nine reviewed
 * reads explicitly `always_allow`). Model, prompt, specialist v4, accepted Skill pins, custom tool, MCP
 * servers, disabled writes/Calendar and Session resources are r26's. Written out, not derived at import, so
 * the release cannot change if the candidate is edited; `releaseR27.test.ts` proves the two are equal.
 *
 * The serving release of this revision since the #39 Stage 3B-3A source cutover (docs/66). Its source is
 * `managed-agents/djonik.md`; `src/release.test.ts` keeps the two in lockstep. Serving r27 does not activate
 * Working Rhythm: that stays behind `DJONIK_WORKING_RHYTHM`, which the host does not set.
 */
export const RELEASE_R27: DjonikRelease = {
  id: "r27",
  agent: { id: COORDINATOR_ID, version: 27 },
  model: MODEL,
  systemSha256: SYSTEM_SHA256,
  skills: [
    ...RELEASE_R26.skills,
    {
      name: "pm-rhythm",
      skillId: PM_RHYTHM_SKILL.skillId,
      pin: { kind: "explicit", version: PM_RHYTHM_SKILL.version, sessionVersion: PM_RHYTHM_SKILL.sessionVersion },
    },
  ],
  specialist: SPECIALIST,
  builtInTools: ["read", "write", "edit", "glob", "grep"],
  customTools: ["trello_work_history"],
  mcpServers: MCP_SERVERS,
  mcpToolsets: [
    {
      server: "trello",
      defaultEnabled: true,
      defaultPolicy: "always_ask",
      overrides: {
        trelloReadBoard: true,
        trelloReadCard: true,
        trelloReadChecklist: true,
        trelloReadInbox: true,
        trelloReadList: true,
        trelloReadMember: true,
        trelloReadPlanner: true,
        trelloReadWorkspace: true,
        trelloSearch: true,
        trelloWriteBoard: false,
        trelloWriteCard: true,
        trelloWriteChecklist: false,
        trelloWriteInbox: false,
        trelloWriteList: false,
        trelloWritePlanner: false,
      },
    },
    { server: "google-calendar-calendarmcp", defaultEnabled: false, overrides: {} },
  ],
  confirmationRequired: { builtIn: ["write", "edit"], mcp: { trello: ["trelloWriteCard"] } },
  session: SESSION,
};

// --- r28 candidate (#41 + #42, source only) -------------------------------------------------------------------

/** The r27 Skills that #42 folds into `planning-and-focus`: the day and the week are one decision (docs/70 §3). */
export const RETIRED_BY_R28 = ["daily-planning", "weekly-planning"] as const;

/**
 * r28 candidate — the one combined cutover the Product Owner chose for #41 and #42: r27 with exactly two changes.
 *  1. The coordinator prompt `managed-agents/djonik.md`: the two #41 edits (active Working Rhythm/commitments line,
 *     clock-line rule) and the #42 PM core (who Daniel is, "Deciding what matters", Backlog semantics, and the
 *     health-review vs project-view boundary of the Project Health line).
 *  2. Skills: `daily-planning` and `weekly-planning` are removed and replaced, in the same position, by
 *     `planning-and-focus` (repo `.claude/skills/planning-and-focus/SKILL.md`), not yet synced — its remote Skill id
 *     and `skver_` pin are UNRESOLVED. The other four pins are r27's.
 * Same Agent identity, model, specialist v4, tools and permission policies, MCP servers and Session resources as
 * r27. The Memory instructions (#42 fixed places) live in application source and ship with the app deploy.
 *
 * Kept as the reviewed input that `RELEASE_R28` was resolved from (docs/74); it stays unresolved by design and is
 * never served. Its Agent version was created by one authorized update from v27 whose body `buildCandidateUpdateBody`
 * derived from the real `planning-and-focus` pin and the reviewed prompt (Skills, tools and `system` together — never
 * the prompt alone, which would reference a Skill the Agent lacks). `releaseR28Candidate.test.ts` proves both diffs
 * are exactly these.
 */
export const RELEASE_R28_CANDIDATE: DjonikReleaseCandidate = {
  candidateId: "r28-candidate",
  becomes: "r28",
  agent: { id: COORDINATOR_ID, fromVersion: 27, version: null },
  model: RELEASE_R27.model,
  systemSha256: "c85e7e621af71f78890ddfe7c270ce737ce83d58e58d5543d1ea7be17964e7da",
  skills: RELEASE_R27.skills.flatMap((skill): Array<ReleaseSkill | UnresolvedCandidateSkill> => {
    if (skill.name === "daily-planning") {
      return [{ name: "planning-and-focus", skillId: null, pin: { kind: "unresolved", reason: "planning-and-focus not yet synced to Managed Agents (#42)" } }];
    }
    return (RETIRED_BY_R28 as readonly string[]).includes(skill.name) ? [] : [skill];
  }),
  specialist: RELEASE_R27.specialist,
  builtInTools: RELEASE_R27.builtInTools,
  customTools: RELEASE_R27.customTools,
  mcpServers: RELEASE_R27.mcpServers,
  mcpToolsets: RELEASE_R27.mcpToolsets,
  confirmationRequired: RELEASE_R27.confirmationRequired!,
  session: RELEASE_R27.session,
};

// --- r28 (#41 + #42) ---------------------------------------------------------------------------------------------

/** `planning-and-focus` as synced 2026-09-25 (docs/74 §3): the only version of its Skill, byte-identical to the
 *  committed `.claude/skills/planning-and-focus/SKILL.md` (SHA-256 `0efaf7d2…b628`). `sessionVersion` was read from
 *  the zero-event inspection Session pinned to v28 (`sesn_016UCPyKFRwMTXzLxC4xdLoE`, docs/75): 0.41 s before the
 *  `skver_`'s `created_at`, the same spelling rule as docs/53 §4; the Skill has only this one version. */
const PLANNING_AND_FOCUS_SKILL = { skillId: "skill_01PxXTvhbZSrbxqi7gmDs6KW", version: "skver_01RzxVaCr47k6R11pHLWr62e", sessionVersion: "1790341201541171" };

/**
 * r28 — the combined #41 + #42 release (Agent v28, created 2026-09-25 from v27 with the generated candidate body under a
 * `version: 27` precondition and read back exactly; docs/74). It is `RELEASE_R28_CANDIDATE` with its real identifiers:
 * r27 with the #41 + #42 coordinator prompt and `daily-planning` + `weekly-planning` replaced, in the same position, by
 * `planning-and-focus` (explicit pin). Model, specialist v4, the other four Skill pins, tools and permission policies,
 * custom tool, MCP servers and Session resources are r27's. Written out, not derived at import, so the release cannot
 * change if the candidate is edited; `releaseR28.test.ts` proves the two are equal.
 *
 * The serving release of this revision since the #41 + #42 source cutover (docs/75); production keeps serving r27 until
 * this revision is deployed, and r27 stays the rollback. Its source is `managed-agents/djonik.md` (body and
 * frontmatter); `src/release.test.ts` keeps the two in lockstep.
 */
export const RELEASE_R28: DjonikRelease = {
  id: "r28",
  agent: { id: COORDINATOR_ID, version: 28 },
  model: MODEL,
  systemSha256: "c85e7e621af71f78890ddfe7c270ce737ce83d58e58d5543d1ea7be17964e7da",
  skills: [
    RELEASE_R27.skills.find((skill) => skill.name === "task-management")!,
    { name: "planning-and-focus", skillId: PLANNING_AND_FOCUS_SKILL.skillId, pin: { kind: "explicit", version: PLANNING_AND_FOCUS_SKILL.version, sessionVersion: PLANNING_AND_FOCUS_SKILL.sessionVersion } },
    ...RELEASE_R27.skills.filter((skill) => ["studio-intake", "work-review", "pm-rhythm"].includes(skill.name)),
  ],
  specialist: SPECIALIST,
  builtInTools: RELEASE_R27.builtInTools,
  customTools: RELEASE_R27.customTools,
  mcpServers: MCP_SERVERS,
  mcpToolsets: RELEASE_R27.mcpToolsets,
  confirmationRequired: RELEASE_R27.confirmationRequired,
  session: SESSION,
};

/** r29 (#45 PM factual grounding): Agent v29 read back after one v28-preconditioned update. The prompt and these
 * three existing coordinator Skills are the only semantic changes from r28. New Skill bytes were downloaded and
 * SHA-256 verified against committed main; Session spellings were measured in zero-event read-only inspection
 * Session sesn_01FiuPDV5Sto6wJqpg9XexX2. Studio intake, work review, specialist v4 and all tool/Session
 * boundaries stay pinned to r28. In particular, the dormant #54 `reminder` tool is not exposed. */
export const RELEASE_R29: DjonikRelease = {
  id: "r29",
  agent: { id: COORDINATOR_ID, version: 29 },
  model: RELEASE_R28.model,
  systemSha256: "fe28b19599d3c4334e68fb8c819063457f3634c9af96995cb9db4cc4db375025",
  skills: [
    { name: "task-management", skillId: "skill_01WS6JtY1GMu3rGZaKCVR9w1", pin: { kind: "explicit", version: "skver_01H9ZMhZKJv7Ryi3tdKiS4Ni", sessionVersion: "1790413381043587" } },
    { name: "planning-and-focus", skillId: "skill_01PxXTvhbZSrbxqi7gmDs6KW", pin: { kind: "explicit", version: "skver_01ELK2Ap5N8oYTQxYtNpGptG", sessionVersion: "1790413383331016" } },
    RELEASE_R28.skills.find((skill) => skill.name === "studio-intake")!,
    RELEASE_R28.skills.find((skill) => skill.name === "work-review")!,
    { name: "pm-rhythm", skillId: "skill_01GzpQX3bVuWNk5bhbGcbzku", pin: { kind: "explicit", version: "skver_011MPsX8NEXALfqBKMRzGVz8", sessionVersion: "1790413385648302" } },
  ],
  specialist: RELEASE_R28.specialist,
  builtInTools: RELEASE_R28.builtInTools,
  customTools: RELEASE_R28.customTools,
  mcpServers: RELEASE_R28.mcpServers,
  mcpToolsets: RELEASE_R28.mcpToolsets,
  confirmationRequired: RELEASE_R28.confirmationRequired,
  session: RELEASE_R28.session,
};

export const RELEASES: Readonly<Record<string, DjonikRelease>> = { r25: RELEASE_R25, r26: RELEASE_R26, r27: RELEASE_R27, r28: RELEASE_R28, r29: RELEASE_R29 };

/**
 * The one release this application revision serves. Changing it is the application half of a cutover
 * (docs/52): it was flipped to `r26` after Agent v26 existed and its read-back attested (docs/53), and to
 * `r27` after Agent v27 attested and its permission policies passed live validation (docs/64, docs/65,
 * docs/66), to `r28` after Agent v28 attested and a zero-event inspection Session measured its last Skill spelling
 * (docs/74, docs/75), and to `r29` after the #45 prompt and three Skill versions attested on v29 with another
 * zero-event inspection Session. Production serves its currently deployed revision until r29 is deployed.
 * This is deliberately not an environment variable:
 * the reviewed revision, not host configuration, decides what is served.
 */
export const SERVING_RELEASE: DjonikRelease = RELEASE_R29;
