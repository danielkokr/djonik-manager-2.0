import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { RELEASES, SERVING_RELEASE } from "./release.js";
import { ReleaseAttestationError } from "./releaseAttestation.js";
import { buildAgentUpdateBody } from "./releasePlan.js";
import { EXIT_CONFIG, preflightRelease } from "./servingRelease.js";

/**
 * `npm run release:check [release-id]` — read-only cutover/rollback check (#33, docs/52).
 *
 * GETs the release's pinned Agent version (and the current latest of any `latest`-referenced Skill) and
 * compares it with the reviewed release. Creates no Session, sends no message, writes nothing. Exit 0 =
 * the remote Agent version is exactly the release; 78 = mismatch (listed, content-free).
 *
 * `npm run release:check -- <release-id> --plan --from <version>` instead prints, without any request, the
 * exact `agents.update` body that would create the release's Agent version from `<version>` (docs/52 §4).
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const id = args.find((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg)) ?? SERVING_RELEASE.id;
  const release = RELEASES[id];
  if (!release) {
    console.error(`Unknown release "${id}". Known: ${Object.keys(RELEASES).join(", ")}`);
    return 2;
  }
  if (args.includes("--plan")) {
    const from = Number(args[args.indexOf("--from") + 1]);
    if (!args.includes("--from") || !Number.isInteger(from) || from < 1) {
      console.error("--plan needs --from <current Agent version>");
      return 2;
    }
    console.log(JSON.stringify(buildAgentUpdateBody(release, from), null, 2));
    return 0;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("missing ANTHROPIC_API_KEY");
    return EXIT_CONFIG;
  }
  try {
    const { observed } = await preflightRelease(new Anthropic({ apiKey }), release);
    console.log(
      `[release-check] ${release.id} OK agent=${release.agent.id}@${observed.agentVersion} ` +
        `serving_in_this_revision=${release.id === SERVING_RELEASE.id}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ReleaseAttestationError) {
      console.error(`[release-check] ${release.id} MISMATCH`);
      for (const mismatch of error.mismatches) console.error(`  - ${mismatch}`);
      return EXIT_CONFIG;
    }
    if ((error as { status?: unknown }).status === 404) {
      console.error(`[release-check] ${release.id}: agent ${release.agent.id} version ${release.agent.version} does not exist`);
      return EXIT_CONFIG;
    }
    throw error;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
