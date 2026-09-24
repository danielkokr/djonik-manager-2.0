import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { RELEASE_R25, RELEASE_R26, type DjonikRelease } from "./release.js";
import { ReleaseAttestationError } from "./releaseAttestation.js";
import {
  checkTrelloHistoryHealth,
  connectServingSession,
  describeTrelloHistoryHealth,
  loadServingConfig,
  preflightRelease,
  resolveAppRevision,
  ServingConfigError,
  type GitProbe,
} from "./servingRelease.js";
import { agentVersionFixture, resolvedLatestFor, servingSessionFixture } from "./releaseFixtures.test-helpers.js";

// #33 serving boundary: host config validation, read-only preflight, and the pinned + attested
// serving Session. Offline only — every provider call is a fake.

const SECRETS = {
  ANTHROPIC_API_KEY: "sk-ant-test-SECRET-anthropic-0000",
  TRELLO_API_KEY: "trellokeySECRET000000000000000000",
  TRELLO_READ_TOKEN: "trellotokenSECRET0000000000000000000000000000000000000000000000",
  TELEGRAM_BOT_TOKEN: "123456789:SECRET-telegram-token-000000000000",
};
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const cleanGit: GitProbe = () => ({ head: HEAD, dirty: false });
const noGit: GitProbe = () => null;

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ServingConfigError);
    return error.problems;
  }
  return [];
}

// --- Config ---------------------------------------------------------------------------------------

test("a complete r26 host config loads; ids come from the reviewed release, not the host", () => {
  const config = loadServingConfig(RELEASE_R26, { ...SECRETS, TRELLO_READ_TOKEN_EXPIRES_AT: "2026-10-22T00:00:00Z" }, cleanGit);
  assert.equal(config.release, RELEASE_R26);
  assert.equal(config.appRevision, HEAD);
  assert.equal(config.drainMs, 120_000);
  assert.deepEqual(config.trello?.expiresAt, new Date("2026-10-22T00:00:00Z"));
});

test("missing secrets are a configuration error, and the error never contains a secret value", () => {
  const problems = problemsOf(() => loadServingConfig(RELEASE_R26, {}, cleanGit));
  assert.deepEqual(problems, ["missing ANTHROPIC_API_KEY", "missing TRELLO_API_KEY", "missing TRELLO_READ_TOKEN"]);
  const drift = problemsOf(() => loadServingConfig(RELEASE_R26, { ...SECRETS, DJONIK_AGENT_ID: "agent_other" }, cleanGit));
  for (const secret of Object.values(SECRETS)) assert.ok(!drift.join(" ").includes(secret));
});

test("Trello credentials are required only when the release exposes the work-history tool", () => {
  const config = loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY }, cleanGit);
  assert.equal(config.trello, null);
});

test("legacy DJONIK_* ids may stay in .env but must not disagree with the release", () => {
  const same = {
    ...SECRETS,
    DJONIK_AGENT_ID: RELEASE_R26.agent.id,
    DJONIK_ENVIRONMENT_ID: RELEASE_R26.session.environmentId,
    DJONIK_MEMORY_STORE_ID: RELEASE_R26.session.memoryStoreId,
    DJONIK_VAULT_ID: RELEASE_R26.session.vaultId,
  };
  assert.doesNotThrow(() => loadServingConfig(RELEASE_R26, same, cleanGit));
  const problems = problemsOf(() => loadServingConfig(RELEASE_R26, { ...same, DJONIK_VAULT_ID: "vlt_other", DJONIK_MEMORY_STORE_ID: "memstore_other" }, cleanGit));
  assert.deepEqual(problems, ["DJONIK_MEMORY_STORE_ID differs from release r26", "DJONIK_VAULT_ID differs from release r26"]);
});

test("DJONIK_EXPECTED_RELEASE catches a deploy of the wrong revision", () => {
  assert.deepEqual(problemsOf(() => loadServingConfig(RELEASE_R25, { ...SECRETS, DJONIK_EXPECTED_RELEASE: "r26" }, cleanGit)), [
    "DJONIK_EXPECTED_RELEASE=r26 but this revision serves r25",
  ]);
  assert.doesNotThrow(() => loadServingConfig(RELEASE_R26, { ...SECRETS, DJONIK_EXPECTED_RELEASE: "r26" }, cleanGit));
});

test("the app revision is explicit, host-provided or git HEAD (+dirty); unknown refuses to serve", () => {
  assert.equal(resolveAppRevision({ DJONIK_APP_REVISION: "abc1234" }, noGit), "abc1234");
  assert.equal(resolveAppRevision({ RAILWAY_GIT_COMMIT_SHA: HEAD }, noGit), HEAD);
  assert.equal(resolveAppRevision({}, () => ({ head: HEAD, dirty: true })), `${HEAD}+dirty`);
  assert.equal(resolveAppRevision({ DJONIK_APP_REVISION: "not a revision!" }, noGit), null);
  assert.deepEqual(problemsOf(() => loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x" }, noGit)), [
    "application revision unknown (set DJONIK_APP_REVISION or run from a git checkout)",
  ]);
});

test("drain timeout is bounded and validated", () => {
  assert.equal(loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x", DJONIK_SHUTDOWN_DRAIN_MS: "90000" }, cleanGit).drainMs, 90_000);
  assert.equal(problemsOf(() => loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x", DJONIK_SHUTDOWN_DRAIN_MS: "1000" }, cleanGit)).length, 1);
  assert.equal(problemsOf(() => loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x", DJONIK_SHUTDOWN_DRAIN_MS: "abc" }, cleanGit)).length, 1);
});

test("the Trello expiry must be a date or 'never'", () => {
  assert.equal(loadServingConfig(RELEASE_R26, { ...SECRETS, TRELLO_READ_TOKEN_EXPIRES_AT: "never" }, cleanGit).trello?.expiresAt, "never");
  assert.equal(problemsOf(() => loadServingConfig(RELEASE_R26, { ...SECRETS, TRELLO_READ_TOKEN_EXPIRES_AT: "soon" }, cleanGit)).length, 1);
});

// --- Trello token health --------------------------------------------------------------------------

function trelloConfig(expiresAt: Date | "never" | null = null) {
  return { apiKey: SECRETS.TRELLO_API_KEY, readToken: SECRETS.TRELLO_READ_TOKEN, expiresAt };
}

test("token health: ok / unauthorized / unreachable / ambiguous, credentials only in the header", async () => {
  const urls: string[] = [];
  const respond = (status: number, body: unknown) => async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  const now = new Date("2026-09-24T00:00:00Z");
  assert.deepEqual(await checkTrelloHistoryHealth(trelloConfig(new Date("2026-10-22T00:00:00Z")), now, respond(200, [{ id: "b1", name: "Board" }])), {
    status: "ok",
    expiresInDays: 28,
  });
  assert.equal((await checkTrelloHistoryHealth(trelloConfig(), now, respond(401, {}))).status, "unauthorized");
  assert.equal((await checkTrelloHistoryHealth(trelloConfig(), now, respond(200, [{ id: "a", name: "A" }, { id: "b", name: "B" }]))).status, "ambiguous_board");
  assert.equal(
    (
      await checkTrelloHistoryHealth(trelloConfig(), now, async () => {
        throw new Error("ECONNRESET");
      })
    ).status,
    "unreachable",
  );
  assert.deepEqual(await checkTrelloHistoryHealth(null), { status: "not_required" });
  for (const url of urls) {
    assert.ok(!url.includes(SECRETS.TRELLO_READ_TOKEN) && !url.includes(SECRETS.TRELLO_API_KEY), "credentials never in a URL");
  }
});

test("token health description: warns before expiry, on rejection and when expiry is unrecorded", () => {
  assert.deepEqual(describeTrelloHistoryHealth({ status: "ok", expiresInDays: "never" }), { field: "ok/expires=never", warning: null });
  assert.equal(describeTrelloHistoryHealth({ status: "ok", expiresInDays: 30 }).warning, null);
  assert.match(describeTrelloHistoryHealth({ status: "ok", expiresInDays: 5 }).warning!, /expires in 5 day/);
  assert.match(describeTrelloHistoryHealth({ status: "ok", expiresInDays: null }).warning!, /not recorded/);
  assert.match(describeTrelloHistoryHealth({ status: "unauthorized", expiresInDays: -2 }).warning!, /unauthorized/);
  assert.equal(describeTrelloHistoryHealth({ status: "not_required" }).field, "not_required");
});

// --- Preflight and serving Session ------------------------------------------------------------------

interface FakeProvider {
  client: Anthropic;
  retrieveCalls: unknown[];
  skillCalls: string[];
  createCalls: Array<Record<string, any>>;
  streamOpened: string[];
  sendCalls: unknown[];
  retrievedSessions: string[];
}

function fakeProvider(release: DjonikRelease, sessionOverride?: (session: Record<string, any>) => void): FakeProvider {
  const provider: Omit<FakeProvider, "client"> = { retrieveCalls: [], skillCalls: [], createCalls: [], streamOpened: [], sendCalls: [], retrievedSessions: [] };
  const client = {
    beta: {
      agents: {
        retrieve: async (id: string, params: unknown) => {
          provider.retrieveCalls.push({ id, params });
          return agentVersionFixture(release);
        },
      },
      skills: {
        retrieve: async (id: string) => {
          provider.skillCalls.push(id);
          return { id, latest_version_id: resolvedLatestFor(release)[id] };
        },
      },
      sessions: {
        create: async (params: Record<string, any>) => {
          provider.createCalls.push(params);
          // The create response is deliberately minimal: attestation must rely on the retrieved Session.
          return { id: "sesn_serving_1", type: "session" };
        },
        retrieve: async (id: string) => {
          provider.retrievedSessions.push(id);
          const session = servingSessionFixture(release, id);
          sessionOverride?.(session);
          return session;
        },
        events: {
          stream: async (id: string) => {
            provider.streamOpened.push(id);
            return { controller: { abort: () => {} }, [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
          },
          send: async (_id: string, params: unknown) => provider.sendCalls.push(params),
        },
      },
    },
  } as unknown as Anthropic;
  return { client, ...provider };
}

test("preflight GETs exactly the pinned Agent version and resolves only `latest` Skills", async () => {
  const r25 = fakeProvider(RELEASE_R25);
  await preflightRelease(r25.client, RELEASE_R25);
  assert.deepEqual(r25.retrieveCalls, [{ id: RELEASE_R25.agent.id, params: { version: 25 } }]);
  assert.equal(r25.skillCalls.length, 4);
  const r26 = fakeProvider(RELEASE_R26);
  await preflightRelease(r26.client, RELEASE_R26);
  assert.deepEqual(r26.retrieveCalls, [{ id: RELEASE_R26.agent.id, params: { version: 26 } }]);
  assert.equal(r26.skillCalls.length, 0, "an explicitly pinned release needs no Skill lookup");
  assert.equal(r26.createCalls.length, 0, "preflight creates nothing");
});

test("preflight mismatch fails closed before any Session exists", async () => {
  const provider = fakeProvider(RELEASE_R25);
  await assert.rejects(preflightRelease(provider.client, RELEASE_R26), ReleaseAttestationError);
  assert.equal(provider.createCalls.length, 0);
});

test("the serving Session is created pinned to {id, version} with content-free metadata and production Memory", async () => {
  const provider = fakeProvider(RELEASE_R26);
  const config = loadServingConfig(RELEASE_R26, SECRETS, cleanGit);
  const preflight = await preflightRelease(provider.client, RELEASE_R26);
  const lines: string[] = [];
  const handle = await connectServingSession(provider.client, config, preflight, { turnSource: "telegram", onServing: (line) => lines.push(line), trelloHistoryField: "ok/expires=never" });
  assert.equal(handle.sessionId, "sesn_serving_1");
  assert.deepEqual(provider.retrievedSessions, ["sesn_serving_1"], "the persisted Session is read back and attested");
  const [params] = provider.createCalls;
  assert.deepEqual(params.agent, { type: "agent", id: RELEASE_R26.agent.id, version: 26 });
  assert.equal(params.environment_id, RELEASE_R26.session.environmentId);
  assert.deepEqual(params.vault_ids, [RELEASE_R26.session.vaultId]);
  assert.equal(params.resources[0].memory_store_id, RELEASE_R26.session.memoryStoreId);
  assert.equal(params.resources[0].access, "read_write");
  assert.deepEqual(params.metadata, { source: "telegram", release: "r26", app_revision: HEAD });
  assert.equal(params.budget, undefined, "the Telegram serving Session carries no spend cap");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[release\] serving release=r26 app=0123456789abcdef/);
  const everything = JSON.stringify(provider.createCalls) + lines.join("\n");
  for (const secret of Object.values(SECRETS)) assert.ok(!everything.includes(secret), "no secret in Session params or logs");
  handle.close();
});

test("startup refuses a mismatched serving Session: nothing is streamed or sent to it", async () => {
  const provider = fakeProvider(RELEASE_R26, (session) => {
    session.agent.version = 25; // e.g. provider resolved a different version than pinned
  });
  const config = loadServingConfig(RELEASE_R26, SECRETS, cleanGit);
  const preflight = await preflightRelease(fakeProvider(RELEASE_R26).client, RELEASE_R26);
  const lines: string[] = [];
  await assert.rejects(
    connectServingSession(provider.client, config, preflight, { turnSource: "telegram", onServing: (line) => lines.push(line) }),
    (error: unknown) => error instanceof ReleaseAttestationError && error.phase === "session" && error.mismatches.includes("agent version 25 != 26"),
  );
  assert.deepEqual(provider.streamOpened, [], "the event stream of an unattested Session is never opened");
  assert.deepEqual(provider.sendCalls, []);
  assert.deepEqual(lines, [], "no serving tuple is claimed");
});

test("a Session mounted with read-only Memory is not a production serving Session", async () => {
  const provider = fakeProvider(RELEASE_R25, (session) => {
    session.resources[0].access = "read_only";
  });
  const config = loadServingConfig(RELEASE_R25, { ANTHROPIC_API_KEY: "x" }, cleanGit);
  const preflight = await preflightRelease(fakeProvider(RELEASE_R25).client, RELEASE_R25);
  await assert.rejects(connectServingSession(provider.client, config, preflight, { turnSource: "telegram" }), ReleaseAttestationError);
});

test("a bounded validation Session can carry a provider-enforced list-cost cap on the same serving path", async () => {
  const provider = fakeProvider(RELEASE_R26);
  const config = loadServingConfig(RELEASE_R26, SECRETS, cleanGit);
  const preflight = await preflightRelease(provider.client, RELEASE_R26);
  const handle = await connectServingSession(provider.client, config, preflight, { turnSource: "diagnostic", maxListCostUsdCents: "120" });
  const [params] = provider.createCalls;
  assert.deepEqual(params.budget, { type: "limit", max_list_cost: { amount: "120", currency: "USD" } });
  assert.deepEqual(params.agent, { type: "agent", id: RELEASE_R26.agent.id, version: 26 }, "same pinned Agent version");
  assert.equal(params.resources[0].access, "read_write", "same production Memory mode");
  assert.deepEqual(provider.retrievedSessions, ["sesn_serving_1"], "attested the same way");
  handle.close();
});
