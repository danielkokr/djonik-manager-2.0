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

export const RELEASES: Readonly<Record<string, DjonikRelease>> = { r25: RELEASE_R25, r26: RELEASE_R26 };

/**
 * The one release this application revision serves. Changing it is the application half of a cutover
 * (docs/52): it was flipped to `r26` after Agent v26 existed and its read-back attested (docs/53); flip it
 * back (or redeploy the last r25 revision) for rollback. It is deliberately not an environment variable:
 * the reviewed revision, not host configuration, decides what is served.
 */
export const SERVING_RELEASE: DjonikRelease = RELEASE_R26;
