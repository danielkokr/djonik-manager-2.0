import assert from "node:assert/strict";
import test from "node:test";
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { DjonikSessionDeadError, DjonikTracedTurnError } from "./djonikClient.js";
import { classifyProviderFailure, sessionDisposition, type ServingStage } from "./providerFailure.js";
import { classifyStartupProviderFailure, providerFailureStop } from "./servingLifecycle.js";
import {
  DjonikSessionConnectError,
  formatGroupFailureError,
  formatUserFacingError,
  PROVIDER_CONFIG_TEXT,
  PROVIDER_REJECTED_TEXT,
  PROVIDER_UNAVAILABLE_CHECK_TEXT,
  PROVIDER_UNAVAILABLE_TEXT,
  SESSION_LOST_CHECK_TEXT,
  SESSION_LOST_RESEND_TEXT,
  SESSION_UNAVAILABLE_TEXT,
  servingTurnFailureOf,
} from "./telegramAdapter.js";
import { TelegramImageTooLargeError } from "./telegramAdapter.js";

/** Issue #60 unit coverage: structured provider-failure classification, user-facing wording and serving policy. */

const apiError = (status: number, message = "x") => APIError.generate(status, { message }, undefined, new Headers());
const incident = () => apiError(503, "credential validation failed");

test("#60 the incident error is the SDK's InternalServerError whose message carries the provider text verbatim", () => {
  const error = incident();
  assert.equal(error.constructor.name, "InternalServerError");
  assert.equal(error.message, "503 credential validation failed", "the exact string Daniel saw in Telegram");
});

test("#60 classification uses the SDK class/status, never the message text", () => {
  assert.deepEqual(classifyProviderFailure(incident()), { category: "upstream_transient", status: 503, errorClass: "InternalServerError" });
  assert.deepEqual(classifyProviderFailure(apiError(503, "anything else")), classifyProviderFailure(incident()));
  assert.equal(classifyProviderFailure(new Error("503 credential validation failed")), null, "a plain error with the same text is not a provider failure");
  assert.equal(classifyProviderFailure(apiError(401, "credential validation failed"))?.category, "auth_config", "same text, different status");
});

test("#60 classification table", () => {
  for (const status of [500, 502, 503, 504, 529, 408, 409, 429]) assert.equal(classifyProviderFailure(apiError(status))?.category, "upstream_transient", String(status));
  for (const status of [401, 403]) assert.equal(classifyProviderFailure(apiError(status))?.category, "auth_config", String(status));
  for (const status of [400, 404, 413, 422]) assert.equal(classifyProviderFailure(apiError(status))?.category, "request_rejected", String(status));
  assert.deepEqual(classifyProviderFailure(new APIConnectionError({ message: "reset" })), { category: "upstream_transient", status: null, errorClass: "APIConnectionError" });
  assert.equal(classifyProviderFailure(new APIConnectionTimeoutError())?.category, "upstream_transient");
  assert.equal(classifyProviderFailure(new APIUserAbortError()), null, "our own abort is not a provider failure");
  assert.equal(classifyProviderFailure("boom"), null);
  const traced = new DjonikTracedTurnError(incident(), "sesn_1", [], [], false);
  assert.equal(classifyProviderFailure(traced)?.status, 503, "a traced (#39) turn is unwrapped");
});

test("#60 session disposition: only a 5xx/connection failure of the Session-scoped send replaces the Session", () => {
  const stages: ServingStage[] = ["session_connect", "pre_send", "event_send", "turn_stream", "turn"];
  for (const stage of stages) {
    assert.equal(sessionDisposition(classifyProviderFailure(incident()), stage), stage === "event_send" ? "replace" : "keep", stage);
  }
  assert.equal(sessionDisposition(classifyProviderFailure(new APIConnectionError({ message: "x" })), "event_send"), "replace");
  for (const status of [400, 401, 403, 404, 408, 409, 429]) {
    assert.equal(sessionDisposition(classifyProviderFailure(apiError(status)), "event_send"), "keep", String(status));
  }
  assert.equal(sessionDisposition(null, "event_send"), "keep", "a domain/model failure never replaces a Session");
});

test("#60 user-facing text: no raw provider text for any class, for single and grouped turns", () => {
  const cases: Array<[unknown, string]> = [
    [incident(), PROVIDER_UNAVAILABLE_CHECK_TEXT],
    [new APIConnectionError({ message: "connect ECONNREFUSED https://api.anthropic.com" }), PROVIDER_UNAVAILABLE_CHECK_TEXT],
    [apiError(429), PROVIDER_UNAVAILABLE_TEXT],
    [apiError(401, "invalid x-api-key"), PROVIDER_CONFIG_TEXT],
    [apiError(403, "permission"), PROVIDER_CONFIG_TEXT],
    [apiError(400, "messages.0.content.1.image: invalid base64"), PROVIDER_REJECTED_TEXT],
    [new DjonikSessionConnectError(incident()), PROVIDER_UNAVAILABLE_TEXT],
    [new DjonikSessionConnectError(apiError(401)), PROVIDER_CONFIG_TEXT],
    [new DjonikSessionConnectError(new Error("release drift at https://x")), SESSION_UNAVAILABLE_TEXT],
    [new DjonikSessionDeadError("Djonik session is unavailable (provider_unavailable).", "unknown", "provider_unavailable"), PROVIDER_UNAVAILABLE_CHECK_TEXT],
    [new DjonikSessionDeadError("x", "processed", "provider_unavailable"), PROVIDER_UNAVAILABLE_CHECK_TEXT],
    [new DjonikSessionDeadError("x", "not_submitted", "provider_unavailable"), SESSION_LOST_RESEND_TEXT],
    [new DjonikSessionDeadError("x", "unknown", "reconnect_exhausted"), SESSION_LOST_CHECK_TEXT],
    [new DjonikTracedTurnError(incident(), "sesn_1", [], [], false), PROVIDER_UNAVAILABLE_CHECK_TEXT],
  ];
  for (const [error, expected] of cases) {
    assert.equal(formatUserFacingError(error), expected);
    assert.equal(formatGroupFailureError(error), expected, "the grouped path never shows provider text either");
    for (const leak of ["credential", "503", "x-api-key", "https://", "base64", "sesn_", "release drift"]) {
      assert.ok(!formatUserFacingError(error).includes(leak), leak);
    }
  }
});

test("#60 non-provider failures keep their existing wording (single and grouped)", () => {
  assert.equal(formatUserFacingError(new Error("stream ended unexpectedly")), "⚠️ Джонік не зміг відповісти на це повідомлення: stream ended unexpectedly");
  const tooLarge = new TelegramImageTooLargeError("Image is too large (12.0 MB).");
  assert.equal(formatGroupFailureError(tooLarge), "⚠️ Джонік не зміг обробити цю групу повідомлень: Image is too large (12.0 MB).");
});

test("#60 failure telemetry is content-free and carries stage/category/status/session action/delivery", () => {
  const connect = servingTurnFailureOf(new DjonikSessionConnectError(incident()));
  assert.deepEqual(connect, {
    type: "serving_turn_failure", stage: "session_connect", category: "upstream_transient", status: 503,
    errorClass: "InternalServerError", sessionAction: "none", delivery: "not_submitted",
  });
  const dead = servingTurnFailureOf(new DjonikSessionDeadError("x", "unknown", "provider_unavailable", { stage: "event_send", providerFailure: classifyProviderFailure(incident()) }));
  assert.deepEqual(dead, {
    type: "serving_turn_failure", stage: "event_send", category: "upstream_transient", status: 503,
    errorClass: "InternalServerError", sessionAction: "replace", delivery: "unknown",
  });
  const lost = servingTurnFailureOf(new DjonikSessionDeadError("Djonik session error: secret detail", "not_submitted", "session_terminated", { stage: "pre_send" }));
  assert.equal(lost.category, "session_dead");
  assert.equal(lost.errorClass, "DjonikSessionDeadError:session_terminated");
  const app = servingTurnFailureOf(new Error("Секретний текст Daniel"));
  assert.deepEqual(app, { type: "serving_turn_failure", stage: "turn", category: "application", status: null, errorClass: "Error", sessionAction: "keep", delivery: "unknown" });
  const serialized = JSON.stringify([connect, dead, lost, app, servingTurnFailureOf(apiError(401, "invalid x-api-key sk-ant-123"))]);
  for (const forbidden of ["credential", "Секрет", "secret", "sk-ant", "x-api-key", "http"]) assert.ok(!serialized.includes(forbidden), forbidden);
});

test("#60 serving policy: a runtime 401 restarts (exit 1) for re-validation; startup 401/403 exits 78; transient never stops", () => {
  assert.deepEqual(providerFailureStop({ category: "auth_config", status: 401 }), { reason: "anthropic_auth_rejected", exitCode: 1 });
  assert.equal(providerFailureStop({ category: "auth_config", status: 403 }), null, "a resource permission is not a dead credential");
  assert.equal(providerFailureStop({ category: "upstream_transient", status: 503 }), null);
  assert.equal(providerFailureStop({ category: "session_dead", status: null }), null);
  assert.deepEqual(classifyStartupProviderFailure(apiError(401)), { reason: "anthropic_auth_rejected status=401", exitCode: 78 });
  assert.equal(classifyStartupProviderFailure(apiError(403))?.exitCode, 78);
  assert.equal(classifyStartupProviderFailure(incident()), null, "a transient startup failure keeps exit 1 + systemd restart");
  assert.equal(classifyStartupProviderFailure(new Error("x")), null);
});
