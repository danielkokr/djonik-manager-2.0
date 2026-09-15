import "dotenv/config";

export interface DjonikClientConfig {
  apiKey: string;
  agentId: string;
  environmentId: string;
}

export class MissingConfigError extends Error {
  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}. Copy .env.example to .env and fill it in.`);
    this.name = "MissingConfigError";
  }
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new MissingConfigError(key);
  }
  return value;
}

/**
 * Loads the resource identifiers needed to reach the already-existing Djonik
 * Managed Agent. This client never creates or configures the agent itself —
 * it only references it.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DjonikClientConfig {
  return {
    apiKey: requireEnv(env, "ANTHROPIC_API_KEY"),
    agentId: requireEnv(env, "DJONIK_AGENT_ID"),
    environmentId: requireEnv(env, "DJONIK_ENVIRONMENT_ID"),
  };
}
