import type Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import {
  connectToDjonik,
  type DjonikTracedSessionHandle,
  type DjonikTraceEvent,
  type DjonikTurnSource,
  type DjonikTurnTelemetry,
} from "./djonikClient.js";
import type { DjonikRelease } from "./release.js";
import {
  attestAgentVersion,
  attestServingSession,
  formatServingTuple,
  latestSkillIds,
  ReleaseAttestationError,
  type ObservedConfig,
} from "./releaseAttestation.js";
import { TrelloWorkHistoryClient, TrelloWorkHistoryError } from "./trelloWorkHistory.js";

/**
 * The serving boundary of #33: validated host configuration, the pinned-release preflight, and the
 * attested serving Session factory. Everything logged from here is content-free (identifiers, versions,
 * hash prefixes, counts); secrets are read once and never formatted.
 */

/** sysexits-style codes, so a supervisor can tell a configuration error (do not restart-loop) from a
 *  transient one (`RestartPreventExitStatus=78` in the systemd unit). */
export const EXIT_CONFIG = 78;
export const EXIT_TEMPFAIL = 75;

export class ServingConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Djonik serving configuration is invalid: ${problems.join("; ")}`);
    this.name = "ServingConfigError";
  }
}

export interface ServingConfig {
  release: DjonikRelease;
  apiKey: string;
  appRevision: string;
  drainMs: number;
  trello: { apiKey: string; readToken: string; expiresAt: Date | "never" | null } | null;
}

const DEFAULT_DRAIN_MS = 120_000;
const MIN_DRAIN_MS = 5_000;
const MAX_DRAIN_MS = 600_000;

/** Git probe, injectable for tests. Returns null when this is not a git checkout or git is absent. */
export type GitProbe = () => { head: string; dirty: boolean } | null;

export const defaultGitProbe: GitProbe = () => {
  try {
    // Read-only probe: no optional index lock, so it also works on a read-only deploy directory.
    const options = { encoding: "utf8" as const, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } };
    const head = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], options);
    return /^[0-9a-f]{40}$/.test(head) ? { head, dirty: status.trim().length > 0 } : null;
  } catch {
    return null;
  }
};

/**
 * The application revision recorded with every serving Session: an explicit `DJONIK_APP_REVISION` (set by
 * the deploy step), a host-provided commit variable, or the local git HEAD (`+dirty` when tracked files
 * differ from it). Null means the revision is unknowable, which the serving path refuses.
 */
export function resolveAppRevision(env: NodeJS.ProcessEnv, git: GitProbe = defaultGitProbe): string | null {
  for (const key of ["DJONIK_APP_REVISION", "RAILWAY_GIT_COMMIT_SHA", "RENDER_GIT_COMMIT"]) {
    const value = env[key]?.trim();
    if (value && /^[0-9a-zA-Z._+-]{7,64}$/.test(value)) return value;
  }
  const probe = git();
  return probe ? `${probe.head}${probe.dirty ? "+dirty" : ""}` : null;
}

function parseExpiry(value: string | undefined, problems: string[]): Date | "never" | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "never") return "never";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    problems.push("TRELLO_READ_TOKEN_EXPIRES_AT must be an ISO date or 'never'");
    return null;
  }
  return date;
}

/**
 * Validates the host configuration for serving `release`. Missing secrets, drifted resource ids and an
 * unknowable app revision are configuration errors: the adapter must not start serving on them.
 */
export function loadServingConfig(release: DjonikRelease, env: NodeJS.ProcessEnv = process.env, git: GitProbe = defaultGitProbe): ServingConfig {
  const problems: string[] = [];
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) problems.push(`missing ${key}`);
    return value ?? "";
  };

  const apiKey = required("ANTHROPIC_API_KEY");

  // Host assertion that the deployed revision serves the release the operator expects.
  const expected = env.DJONIK_EXPECTED_RELEASE?.trim();
  if (expected && expected !== release.id) problems.push(`DJONIK_EXPECTED_RELEASE=${expected} but this revision serves ${release.id}`);

  // Legacy per-host resource ids are optional now; when present they must not disagree with the release.
  const drift: Array<[string, string]> = [
    ["DJONIK_AGENT_ID", release.agent.id],
    ["DJONIK_ENVIRONMENT_ID", release.session.environmentId],
    ["DJONIK_MEMORY_STORE_ID", release.session.memoryStoreId],
    ["DJONIK_VAULT_ID", release.session.vaultId],
  ];
  for (const [key, value] of drift) {
    const configured = env[key]?.trim();
    if (configured && configured !== value) problems.push(`${key} differs from release ${release.id}`);
  }

  const appRevision = resolveAppRevision(env, git);
  if (!appRevision) problems.push("application revision unknown (set DJONIK_APP_REVISION or run from a git checkout)");

  let drainMs = DEFAULT_DRAIN_MS;
  const drainRaw = env.DJONIK_SHUTDOWN_DRAIN_MS?.trim();
  if (drainRaw) {
    const parsed = Number(drainRaw);
    if (!Number.isInteger(parsed) || parsed < MIN_DRAIN_MS || parsed > MAX_DRAIN_MS) {
      problems.push(`DJONIK_SHUTDOWN_DRAIN_MS must be an integer between ${MIN_DRAIN_MS} and ${MAX_DRAIN_MS}`);
    } else {
      drainMs = parsed;
    }
  }

  // The work-history custom tool needs adapter-side Trello credentials — only when the release exposes it.
  let trello: ServingConfig["trello"] = null;
  if (release.customTools.includes("trello_work_history")) {
    const trelloKey = required("TRELLO_API_KEY");
    const readToken = required("TRELLO_READ_TOKEN");
    trello = { apiKey: trelloKey, readToken, expiresAt: parseExpiry(env.TRELLO_READ_TOKEN_EXPIRES_AT, problems) };
  }

  if (problems.length > 0) throw new ServingConfigError(problems);
  return { release, apiKey, appRevision: appRevision!, drainMs, trello };
}

// --- Preflight ----------------------------------------------------------------------------------

export interface ReleasePreflight {
  observed: ObservedConfig;
  resolvedLatest: Record<string, string>;
}

/**
 * Read-only preflight: the pinned Agent version and the current latest version of any `latest`-referenced
 * Skill. Creates nothing; throws `ReleaseAttestationError` on any difference from the release.
 */
export async function preflightRelease(client: Anthropic, release: DjonikRelease): Promise<ReleasePreflight> {
  const agent = await client.beta.agents.retrieve(release.agent.id, { version: release.agent.version });
  const resolvedLatest: Record<string, string> = {};
  for (const skillId of latestSkillIds(release)) {
    resolvedLatest[skillId] = (await client.beta.skills.retrieve(skillId)).latest_version_id;
  }
  return { observed: attestAgentVersion(release, agent, { resolvedLatest }), resolvedLatest };
}

// --- Trello read-token health ------------------------------------------------------------------

export type TrelloHistoryHealth =
  | { status: "not_required" }
  | { status: "ok" | "unauthorized" | "unreachable" | "ambiguous_board"; expiresInDays: number | "never" | null };

const DAY_MS = 86_400_000;

/**
 * Checks that the read-only token still works (one GET the tool itself needs: resolving the single board)
 * and how many days are left before its recorded expiry. Degradation, not a startup failure: an expired
 * token already fails visibly per turn ("history is unavailable"), while every other capability still works.
 */
export async function checkTrelloHistoryHealth(
  trello: ServingConfig["trello"],
  now: Date = new Date(),
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<TrelloHistoryHealth> {
  if (!trello) return { status: "not_required" };
  const expiresInDays =
    trello.expiresAt === "never" ? "never" : trello.expiresAt === null ? null : Math.floor((trello.expiresAt.getTime() - now.getTime()) / DAY_MS);
  try {
    await new TrelloWorkHistoryClient({ apiKey: trello.apiKey, readToken: trello.readToken, fetch: fetcher }).resolveSingleBoard();
    return { status: "ok", expiresInDays };
  } catch (error) {
    const code = error instanceof TrelloWorkHistoryError ? error.code : "request_failed";
    const status = code === "unauthorized" ? "unauthorized" : code === "ambiguous_board" ? "ambiguous_board" : "unreachable";
    return { status, expiresInDays };
  }
}

/** Content-free description of the Trello token health, plus whether an operator warning is due. */
export function describeTrelloHistoryHealth(health: TrelloHistoryHealth, warnWithinDays = 7): { field: string; warning: string | null } {
  if (health.status === "not_required") return { field: "not_required", warning: null };
  const days = health.expiresInDays;
  const expiry = days === "never" ? "never" : days === null ? "unrecorded" : `${days}d`;
  const field = `${health.status}/expires=${expiry}`;
  let warning: string | null = null;
  if (health.status !== "ok") warning = `Trello work history is ${health.status}; weekly-review turns will report history as unavailable. Rotate or fix the read-only token (docs/52 §5).`;
  else if (days === null) warning = "TRELLO_READ_TOKEN_EXPIRES_AT is not recorded; token expiry cannot be warned about (docs/52 §5).";
  else if (typeof days === "number" && days <= warnWithinDays) warning = `Trello read token expires in ${days} day(s); rotate it (docs/52 §5).`;
  return { field, warning };
}

// --- Serving Session ------------------------------------------------------------------------------

export interface ServingSessionHooks {
  turnSource: DjonikTurnSource;
  onTrace?: (event: DjonikTraceEvent) => void;
  onTurnTelemetry?: (telemetry: DjonikTurnTelemetry) => void;
  /** Receives the content-free serving tuple line after each attested Session creation. */
  onServing?: (line: string) => void;
  trelloHistoryField?: string;
  /** Optional provider-enforced Session list-cost cap in USD cents (`budget.max_list_cost`). Bounded
   *  validation Sessions use it as a hard spend backstop; the Telegram serving Session sets none. */
  maxListCostUsdCents?: string;
}

/**
 * Creates one Session pinned to the release's exact Agent version, tags it with content-free metadata, reads
 * it back, and attests the provider's resolved snapshot and resources against the release before the event
 * stream opens.
 * A mismatch throws `ReleaseAttestationError`; no message is ever sent to an unattested Session.
 */
export async function connectServingSession(
  client: Anthropic,
  config: ServingConfig,
  preflight: ReleasePreflight,
  hooks: ServingSessionHooks,
): Promise<DjonikTracedSessionHandle> {
  const { release } = config;
  const attested: { observed?: ObservedConfig } = {};
  const handle = await connectToDjonik(
    client,
    release.agent.id,
    release.session.environmentId,
    release.session.memoryStoreId,
    release.session.vaultId,
    hooks.onTrace,
    hooks.onTurnTelemetry,
    hooks.turnSource,
    undefined,
    {
      agentVersion: release.agent.version,
      memoryAccess: release.session.memoryAccess,
      metadata: { source: hooks.turnSource, release: release.id, app_revision: config.appRevision.slice(0, 64) },
      maxListCostUsdCents: hooks.maxListCostUsdCents,
      // Attest the persisted Session as the provider reports it on retrieval (the #33 "supported serving-
      // Session retrieval"), not just the create response: that is the configuration turns will run on.
      attestSession: async (session) => {
        const id = (session as { id?: unknown } | null)?.id;
        if (typeof id !== "string") throw new ReleaseAttestationError("session", ["created session has no id"]);
        const persisted = await client.beta.sessions.retrieve(id);
        attested.observed = attestServingSession(release, persisted, { resolvedLatest: preflight.resolvedLatest });
      },
    },
  );
  const observed = attested.observed;
  if (!observed) {
    handle.close();
    throw new ReleaseAttestationError("session", ["session was not attested"]);
  }
  hooks.onServing?.(
    formatServingTuple({ release, appRevision: config.appRevision, sessionId: handle.sessionId, observed, trelloHistory: hooks.trelloHistoryField }),
  );
  return handle;
}

// --- Serving-Session read-back ----------------------------------------------------------------------

export interface ServingSessionReadback {
  sessionId: string;
  status: string;
  createdAt: string;
  appRevision: string;
  observed: ObservedConfig;
}

/**
 * Read-only provider-side evidence of what the hosted adapter serves (#33 acceptance 2, docs/54 §12): the
 * newest Session tagged `source=<source>, release=<id>`, re-read and attested against `release` exactly
 * as at startup. Independent of host logs. Returns null when no such Session is among the newest `limit`;
 * a mismatch throws `ReleaseAttestationError`. Creates, sends and writes nothing.
 */
export async function readBackServingSession(
  client: Anthropic,
  release: DjonikRelease,
  preflight: ReleasePreflight,
  options: { source?: DjonikTurnSource; limit?: number } = {},
): Promise<ServingSessionReadback | null> {
  const source = options.source ?? "telegram";
  const page = (await client.beta.sessions.list({ limit: options.limit ?? 50 })) as unknown as { data?: unknown[] };
  const candidate = (page.data ?? []).find((session) => {
    const metadata = (session as { metadata?: Record<string, unknown> } | null)?.metadata;
    return metadata?.source === source && metadata?.release === release.id;
  }) as { id: string } | undefined;
  if (!candidate) return null;
  const persisted = (await client.beta.sessions.retrieve(candidate.id)) as unknown as {
    status?: unknown;
    created_at?: unknown;
    metadata?: Record<string, unknown>;
  };
  const observed = attestServingSession(release, persisted, { resolvedLatest: preflight.resolvedLatest });
  return {
    sessionId: candidate.id,
    status: String(persisted.status ?? "unknown"),
    createdAt: String(persisted.created_at ?? "unknown"),
    appRevision: String(persisted.metadata?.app_revision ?? "unknown"),
    observed,
  };
}
