import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, MissingConfigError } from "./config.js";

test("loadConfig throws MissingConfigError when ANTHROPIC_API_KEY is absent", () => {
  assert.throws(
    () => loadConfig({ DJONIK_AGENT_ID: "agent_x", DJONIK_ENVIRONMENT_ID: "env_x" }),
    MissingConfigError,
  );
});

test("loadConfig throws MissingConfigError when DJONIK_AGENT_ID is absent", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: "key", DJONIK_ENVIRONMENT_ID: "env_x" }),
    MissingConfigError,
  );
});

test("loadConfig throws MissingConfigError when DJONIK_ENVIRONMENT_ID is absent", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: "key", DJONIK_AGENT_ID: "agent_x" }),
    MissingConfigError,
  );
});

test("loadConfig throws MissingConfigError when a value is blank", () => {
  assert.throws(
    () =>
      loadConfig({
        ANTHROPIC_API_KEY: "key",
        DJONIK_AGENT_ID: "   ",
        DJONIK_ENVIRONMENT_ID: "env_x",
      }),
    MissingConfigError,
  );
});

test("loadConfig returns all three values when present", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: "key",
    DJONIK_AGENT_ID: "agent_x",
    DJONIK_ENVIRONMENT_ID: "env_x",
  });
  assert.deepEqual(config, { apiKey: "key", agentId: "agent_x", environmentId: "env_x" });
});
