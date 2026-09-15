import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, loadTelegramConfig, MissingConfigError } from "./config.js";

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

test("loadConfig throws MissingConfigError when DJONIK_MEMORY_STORE_ID is absent", () => {
  assert.throws(
    () =>
      loadConfig({
        ANTHROPIC_API_KEY: "key",
        DJONIK_AGENT_ID: "agent_x",
        DJONIK_ENVIRONMENT_ID: "env_x",
      }),
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
        DJONIK_MEMORY_STORE_ID: "memstore_x",
      }),
    MissingConfigError,
  );
});

test("loadConfig returns all four values when present", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: "key",
    DJONIK_AGENT_ID: "agent_x",
    DJONIK_ENVIRONMENT_ID: "env_x",
    DJONIK_MEMORY_STORE_ID: "memstore_x",
  });
  assert.deepEqual(config, {
    apiKey: "key",
    agentId: "agent_x",
    environmentId: "env_x",
    memoryStoreId: "memstore_x",
  });
});

test("loadTelegramConfig throws MissingConfigError when TELEGRAM_BOT_TOKEN is absent", () => {
  assert.throws(() => loadTelegramConfig({ TELEGRAM_ALLOWED_USER_ID: "12345" }), MissingConfigError);
});

test("loadTelegramConfig throws MissingConfigError when TELEGRAM_ALLOWED_USER_ID is absent", () => {
  assert.throws(() => loadTelegramConfig({ TELEGRAM_BOT_TOKEN: "token" }), MissingConfigError);
});

test("loadTelegramConfig returns both values when present", () => {
  const config = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_USER_ID: "12345",
  });
  assert.deepEqual(config, { botToken: "token", allowedUserId: "12345" });
});
