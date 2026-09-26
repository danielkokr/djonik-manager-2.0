import { createHash } from "node:crypto";
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
/** The reviewed source prompt: the `managed-agents/djonik.md` body, as an Agent would store it (docs/42). */
export const SOURCE_SYSTEM_PROMPT = /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/.exec(djonikSource)![1].replace(/\n$/, "");

/** The #45 coordinator-prompt edits (factual grounding), exact text before → after, applied on top of r28. Not synced:
 *  the served r28 prompt is the source minus these. */
export const ISSUE_45_PROMPT_EDITS: ReadonlyArray<{ before: string; after: string }> = [
  {
    // Fit is the time Daniel states, not a capacity Djonik estimates.
    before: "and what realistically fits his time.",
    after: "and what fits the time he says he has.",
  },
  {
    // A plain sourced reason is complete. The dropped "ask only if…" line repeats "How you speak".
    before: "details when he asks. Ask only if the answer could change the main thing; otherwise state your assumption and go on.",
    after:
      "details when he asks. A plain sourced reason (\"вже в роботі й найближче до здачі\") is complete; never invent a date, " +
      "event or effort to strengthen it.",
  },
  {
    // One source principle replaces the field blacklist; the field rules stay as its short examples.
    before:
      "\n# Factual semantics\n\n" +
      "Search discovers candidates; direct card/list/board reads establish current fields. `lastActivityAt` means only that Trello " +
      "activity happened: it proves neither Daniel worked, progress, completion, completion time, nor staleness or its absence. " +
      "`Done`/`dueComplete` can show current completed state, not when completion happened; only action-history evidence can date a " +
      "transition.\n\n" +
      "`Waiting` means waiting. Call work `Blocked` only when a concrete dependency or problem prevents progress; Waiting alone does not " +
      "prove that. `Backlog` is a queue: not started is not Waiting, Blocked or at risk. A Trello `due` is a recorded date, not by " +
      "itself a client commitment, available capacity, low urgency, risk, or enough time (\"не горить\", \"часу достатньо\").\n\n" +
      "Keep evidence-backed external facts separate from your PM judgement or recommendation; never present a judgement as an " +
      "established external fact. Do not infer an actor or work history from raw metadata. Derive relative timing, weekday or local " +
      "time only from accepted authoritative evidence or a formatter, never your own arithmetic or a guess; for today and the next 14 " +
      "days, that is the \"[Годинник адаптера …]\" line opening Daniel's messages — system context, not his words or intake source.\n",
    after: /\n# Where facts come from\n[\s\S]*?\n(?=\n# Project Health\n)/.exec(SOURCE_SYSTEM_PROMPT)?.[0] ?? "<missing #45 facts section>",
  },
];

/** `prompt` with each edit reverted; every `after` must occur exactly once. */
function revertEdits(prompt: string, edits: ReadonlyArray<{ before: string; after: string }>, issue: string): string {
  return edits.reduce((text, edit) => {
    const count = text.split(edit.after).length - 1;
    if (count !== 1) throw new Error(`${issue} prompt edit found ${count} times in managed-agents/djonik.md`);
    return text.replace(edit.after, () => edit.before);
  }, prompt);
}

/** The prompt served r28 (Agent v28) stores: the source minus the unsynced #45 edits. */
export const R28_SYSTEM_PROMPT = revertEdits(SOURCE_SYSTEM_PROMPT, ISSUE_45_PROMPT_EDITS, "#45");

/** The two #41 coordinator-prompt edits (r27 → r28 candidate), exact text before → after. */
export const ISSUE_41_PROMPT_EDITS: ReadonlyArray<{ before: string; after: string }> = [
  {
    before:
      "You answer when Daniel writes to you. You do not message him first, run a schedule or track his commitments automatically — never promise that.",
    after:
      "You answer when Daniel writes, run his Working Rhythm and remember commitments he explicitly accepts. Autonomous rhythm turns only " +
      "read and propose; external changes happen only in his own turn, on his instruction or confirmation.",
  },
  {
    before: "never your own arithmetic.",
    after:
      "never your own arithmetic or a guess; for today and the next 14 days, that is the \"[Годинник адаптера …]\" line opening " +
      "Daniel's messages — system context, not his words or intake source.",
  },
];

/** The four #42 coordinator-prompt edits (PM core), exact text before → after, applied on top of #41. */
export const ISSUE_42_PROMPT_EDITS: ReadonlyArray<{ before: string; after: string }> = [
  {
    // Who Daniel is and what he delegates.
    before: "You are Djonik, Daniel's project manager and chief of staff — a colleague, not a command bot.",
    after:
      "You are Djonik, Daniel's project manager and chief of staff — a colleague, not a command bot. Daniel is a designer " +
      "running several client projects; he delegates the PM work to you so his attention stays on design.",
  },
  {
    // The PM core: a new section right before Factual semantics.
    before: "\n# Factual semantics\n",
    after: `\n${/\n# Deciding what matters\n[\s\S]*?\n(?=\n# Factual semantics\n)/.exec(R28_SYSTEM_PROMPT)?.[0].slice(1) ?? "<missing PM core>"}\n# Factual semantics\n`,
  },
  {
    // Backlog semantics moved up next to Waiting/Blocked.
    before: "Waiting alone does not prove that.",
    after: "Waiting alone does not prove that. `Backlog` is a queue: not started is not Waiting, Blocked or at risk.",
  },
  {
    // Project Health keeps health reviews; "по X що в мене?" is focus planning.
    before: "A question about a project's current condition, risk or blockers goes to the Djonik Project Health Specialist, not to you.",
    after:
      "A health review of a project — its current condition, risks, blockers, what is stuck — goes to the Djonik Project Health " +
      "Specialist, not to you; what Daniel has to do on a project (\"по X що в мене?\") is focus planning, yours.",
  },
];

/** The #41-only prompt (the superseded prompt-only r28 candidate, SHA `8469c4e0…`): the r28 prompt minus #42. */
export const PRE_42_SYSTEM_PROMPT = revertEdits(R28_SYSTEM_PROMPT, ISSUE_42_PROMPT_EDITS, "#42");

/** The prompt Agent versions v25–v27 carry: the r28 prompt minus #42, then minus #41. */
export const PRE_41_SYSTEM_PROMPT = revertEdits(PRE_42_SYSTEM_PROMPT, ISSUE_41_PROMPT_EDITS, "#41");

/** The prompt text whose SHA-256 a release pins: the r28 prompt (v28) or the pre-#41 prompt v25–v27 carry. */
export function systemPromptFor(release: Pick<DjonikRelease, "systemSha256">): string {
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const match = [R28_SYSTEM_PROMPT, PRE_41_SYSTEM_PROMPT].find((prompt) => sha(prompt) === release.systemSha256);
  if (match === undefined) throw new Error(`no fixture prompt for system ${release.systemSha256.slice(0, 12)}`);
  return match;
}

const allow = { type: "always_allow" };
const ask = { type: "always_ask" };

/** Policy of one named tool, from the release's `confirmationRequired` (#39 Stage 3A). */
const builtInPolicy = (release: DjonikRelease, name: string) => (release.confirmationRequired?.builtIn.includes(name as never) ? ask : allow);
const mcpPolicy = (release: DjonikRelease, server: string, name: string) => (release.confirmationRequired?.mcp[server]?.includes(name) ? ask : allow);

function builtInToolset(release: DjonikRelease): Record<string, unknown> {
  if (release.builtInTools.length === 8 && !release.confirmationRequired?.builtIn.length) {
    return { type: "agent_toolset_20260401", default_config: { enabled: true, permission_policy: allow }, configs: [] };
  }
  return {
    type: "agent_toolset_20260401",
    default_config: { enabled: false, permission_policy: allow },
    configs: release.builtInTools.map((name) => ({ name, enabled: true, permission_policy: builtInPolicy(release, name) })),
  };
}

function tools(release: DjonikRelease): unknown[] {
  return [
    builtInToolset(release),
    ...release.customTools.map((name) => ({ type: "custom", name, ...SUPPORTED_CUSTOM_TOOLS[name] })),
    ...release.mcpToolsets.map((toolset) => ({
      type: "mcp_toolset",
      mcp_server_name: toolset.server,
      default_config: { enabled: toolset.defaultEnabled, permission_policy: toolset.defaultPolicy === "always_ask" ? ask : allow },
      configs: Object.entries(toolset.overrides).map(([name, enabled]) => ({ name, enabled, permission_policy: mcpPolicy(release, toolset.server, name) })),
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
    system: systemPromptFor(release),
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
