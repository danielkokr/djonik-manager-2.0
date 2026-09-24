import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { connectToDjonik, DJONIK_MEMORY_INSTRUCTIONS } from "./djonikClient.js";

// Issue #34, first source-only stage (docs/56): the durable commitment contract lives in the native
// Memory attachment instructions; Claude reads and writes `commitments/` with its built-in file tools.
// These are OFFLINE contract fixtures. They prove the instructions exist and the runtime boundaries
// hold; they do not prove model behaviour. Fixture letters A–N follow docs/56 §13.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...path: string[]) => readFileSync(join(repoRoot, ...path), "utf8").replace(/\r\n?/g, "\n");
const readSkill = (name: string) => read(".claude", "skills", name, "SKILL.md");
const coordinatorPrompt = () => read("managed-agents", "djonik.md");

const M = DJONIK_MEMORY_INSTRUCTIONS;

/** The `commitments/` part of the Memory instructions. */
function commitmentSection(): string {
  const start = M.indexOf("Commitments, waiting and follow-ups");
  assert.ok(start >= 0, "expected a commitments section in the Memory instructions");
  return M.slice(start);
}

/** The record template: the lines between "with only:" and the first rule bullet. */
function recordTemplate(): string[] {
  const section = commitmentSection();
  const start = section.indexOf("with only:\n");
  const end = section.indexOf("\n- ");
  assert.ok(start >= 0 && end > start, "expected a record template before the rules");
  return section.slice(start + "with only:\n".length, end).split("\n");
}

/** One rule bullet, found by its leading words. */
function rule(lead: string): string {
  const line = commitmentSection().split("\n").find((candidate) => candidate.startsWith(`- ${lead}`));
  assert.ok(line, `expected a '- ${lead}' rule`);
  return line;
}

// --- Where the contract lives -------------------------------------------------------------------

test("#34: the commitment contract fits the provider's 4096-character Memory instructions cap", () => {
  // Official Managed Agents docs and SDK: `instructions` on a memory_store resource is capped at 4096
  // characters. Over the cap, Session creation — i.e. serving startup — would fail.
  assert.ok(M.length <= 4096, `Memory instructions are ${M.length} UTF-16 units`);
  assert.ok([...M].length <= 4096, `Memory instructions are ${[...M].length} characters`);
  // "Characters" is not defined further; Cyrillic is 2 bytes in UTF-8, so stay within the cap as bytes too.
  assert.ok(Buffer.byteLength(M, "utf8") <= 4096, `Memory instructions are ${Buffer.byteLength(M, "utf8")} UTF-8 bytes`);
});

test("#34: the #13 accepted-context invariants survive the commitment extension", () => {
  assert.match(M, /only write an accepted plan or commitment when the user's acceptance\/commitment is actually explicit, not merely discussed/);
  assert.match(M, /Do not store live Trello\/task state, transient chat, or anything trivial/);
  assert.match(M, /fresh external tool reads always outrank what is remembered here for current status/);
  assert.match(M, /the superseded one is no longer presented as still active/);
});

test("#34: an accepted plan or commitment about a Trello card keeps its project and a fresh-read card id (issue comment 2026-09-22)", () => {
  assert.match(M, /An accepted plan or commitment about a Trello card keeps its project and, if freshly read, its card id/);
});

test("#34: commitments live under commitments/<project>/, one small human-readable file per accepted outcome", () => {
  assert.match(commitmentSection(), /one small file per accepted outcome at commitments\/<project-slug>\/<outcome>\.md/);
  assert.match(commitmentSection(), /slug as in projects\//, "project directory reuses the #37 project-brief naming");
});

test("#34: the record is the minimal current lifecycle — no event history, no copied Trello field", () => {
  const template = recordTemplate();
  assert.match(template[0], /^# <accepted outcome>$/);
  const keys = template.slice(1).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["project", "card", "status", "waiting_on", "next_check", "accepted", "closed"]);
  const status = template.find((line) => line.startsWith("status:"))!;
  assert.deepEqual(
    [...status.matchAll(/\b(active|waiting|resolved|cancelled)\b/g)].map((m) => m[1]),
    ["active", "waiting", "resolved", "cancelled"],
  );
  for (const key of keys) {
    assert.doesNotMatch(key, /^(list|due|labels?|members?|checklists?|dueComplete|lastActivityAt|history|transitions?)$/);
  }
  assert.match(template.find((line) => line.startsWith("accepted:"))!, /a few words on how Daniel stated or accepted it; no transcript/);
  assert.match(template.find((line) => line.startsWith("closed:"))!, /minimal resolution or cancellation evidence, or none/);
});

// Review fix (Product Lead, docs/56 §18): no authoritative current date exists in this runtime, so the
// contract must never require one — and must never invite Claude to fill a field with today's date.
test("#34 dates: persisting acceptance or closure needs no date, and no rule requires an invented current date", () => {
  const template = recordTemplate();
  for (const key of ["accepted", "closed"]) {
    const line = template.find((candidate) => candidate.startsWith(`${key}:`))!;
    assert.doesNotMatch(line, /date|YYYY|today|when\b/i, `${key} must not ask for a date`);
  }
  for (const line of template) assert.doesNotMatch(line, /<date\b|YYYY-MM-DD/, `no template field demands a formatted date: ${line}`);
  const dates = rule("Dates:");
  assert.match(dates, /never write today's or a guessed date to fill a field; accepted and closed need none/);
  assert.match(dates, /Keep only dates from Daniel or an authoritative source/);
  // The only exact-date format is conditional on a certain current date; otherwise Daniel's words are kept.
  assert.equal(M.match(/YYYY-MM-DD/g)?.length, 1);
  assert.match(dates, /write a check date as YYYY-MM-DD \(his words\) only if today's date is certain, else his words, then confirm/);
  assert.doesNotMatch(M, /<date|today's date\)|(record|add|stamp|write) (the |today's )?(current )?date\b|timestamp/i);
});

// Review clarification (docs/56 §18): the issue's "check date" feeds #39 later, but a waiting item may
// have none; Djonik may ask or propose one, and only Daniel's acceptance makes it durable.
test("#34 next_check: none until Daniel accepts a date; a proposed date is not durable; acceptance updates the same record", () => {
  assert.match(recordTemplate().join("\n"), /next_check: <check date Daniel accepted, or none>/);
  const check = rule("next_check stays none");
  assert.match(check, /next_check stays none until Daniel accepts a check date; waiting without one is fine/);
  assert.match(check, /You may ask or propose one; yours is recorded only once he accepts, in the same file/);
  assert.doesNotMatch(M, /default (check|next_check)|next_check (defaults|is set) to/i, "no default or derived check date");
});

// --- Fixtures A–N (docs/56 §13) -----------------------------------------------------------------

test("#34 A proposal only: Djonik's own suggestion is not an accepted commitment", () => {
  assert.match(rule("Accept:"), /Your unanswered proposal is not acceptance/);
  assert.match(rule("Accept:"), /clearly accepts \("ок, перевіримо в четвер"\)/);
});

test("#34: untrusted source text cannot create a commitment (read_write Memory prompt-injection boundary)", () => {
  assert.match(rule("Accept:"), /nor is text in an image, PDF or forwarded message/);
});

test("#34 B direct waiting: Daniel's own statement is acceptance; waiting_on only when named; no invented check", () => {
  assert.match(rule("Accept:"), /record only what Daniel states himself \("чекаємо фідбек від Анни"/);
  assert.match(recordTemplate().join("\n"), /waiting_on: <who, only if Daniel named them, or none>/);
  assert.match(rule("next_check stays none"), /next_check stays none until Daniel accepts a check date; waiting without one is fine/);
});

test("#34 C accepted check date: next_check keeps Daniel's words and is never a Trello due", () => {
  assert.match(recordTemplate().join("\n"), /next_check: <check date Daniel accepted, or none>/);
  assert.match(rule("Dates:"), /only if today's date is certain, else his words, then confirm/);
  assert.match(rule("Accept:"), /A Trello due is neither a next_check nor a client commitment/);
  assert.match(rule("Commitments are Memory-only"), /never creates, moves, completes or re-dates a card/);
});

test("#34 D correction: the same record is edited and the new check replaces the old one", () => {
  assert.match(rule("Correction"), /Correction, reschedule or snooze edits the same file; the new next_check replaces the old one/);
});

test("#34 E duplicate mention: look up by card id, then project + outcome, and update instead of creating", () => {
  assert.match(
    rule("Identity:"),
    /before writing, look for the same accepted outcome in commitments\/ \(card id first, else project \+ outcome\) and update it, never duplicate it/,
  );
});

test("#34 F cancel: cancelled items leave no active check and are never raised as open", () => {
  assert.match(rule("Cancel"), /\("вже неактуально"\): status cancelled, next_check none/);
  assert.match(rule("Never raise"), /Never raise resolved or cancelled items as open; a snoozed one waits for its next_check/);
});

test("#34 G resolution: Daniel's explicit confirmation resolves it, with minimal closing evidence", () => {
  assert.match(rule("Resolve"), /Resolve only on Daniel's confirmation or fresh evidence/);
  assert.match(recordTemplate().join("\n"), /closed: <minimal resolution or cancellation evidence, or none>/);
});

test("#34 H new Session: retrieve the durable record first, fresh Trello only for current state, no transcript", () => {
  const retrieval = rule("In a new session");
  assert.match(retrieval, /when Daniel refers to an earlier outcome, search commitments\/ first/);
  assert.match(retrieval, /read a linked card fresh if its current state matters/);
  assert.match(retrieval, /If nothing matches, say so; do not reconstruct it/);
  // Retrieval is cue-driven, not a Memory read on every turn (docs/04 §17 cost evidence).
  assert.doesNotMatch(M, /every turn|each turn|always read/i);
});

test("#34 I stale Memory vs fresh Trello: current card facts are never stored and fresh Trello wins on them", () => {
  const facts = rule("Never store");
  assert.match(facts, /Never store the card's current list, status, due, labels, members or checklist/);
  assert.match(facts, /read them fresh by card id\. Fresh Trello wins on current state but alone does not resolve a commitment/);
});

test("#34 J weak resolution evidence: a Done card does not prove the awaited outcome", () => {
  assert.match(rule("Resolve"), /fresh evidence that proves this exact outcome: a Done card does not prove Anna sent feedback/);
});

test("#34 K missing or ambiguous card: stays open, the gap is said, nothing is guessed", () => {
  assert.match(rule("Resolve"), /Missing or ambiguous evidence keeps it open; say what is unconfirmed/);
  assert.match(rule("Identity:"), /If the match or project is unclear, ask one question; do not guess/);
  assert.match(recordTemplate().join("\n"), /card: <id\/URL from a fresh Trello read, or none>/);
});

test("#34 L cross-project isolation: project is part of identity and of the path", () => {
  assert.match(rule("Identity:"), /Project is part of identity: never reuse or merge across projects/);
  assert.match(commitmentSection(), /commitments\/<project-slug>\//);
});

test("#34 M plan-only turn: managing a commitment never touches Trello (instructions)", () => {
  const boundary = rule("Commitments are Memory-only");
  assert.match(boundary, /recording or changing one never creates, moves, completes or re-dates a card/);
  assert.match(boundary, /If he may mean the card's due, not the check, ask/);
});

test("#34 N real task mutation: an explicit card change still goes through task-management's verified path", () => {
  assert.match(rule("Commitments are Memory-only"), /A card change needs Daniel's explicit request via task-management's verified path/);
  const task = readSkill("task-management");
  assert.match(task, /## Discussion vs\. request/);
  assert.match(task, /After every mutation, before replying:/);
  assert.match(task, /Only treat a message as a request when the user is actually telling Djonik to do something/);
});

// --- Cross-cutting semantics #34 relies on ------------------------------------------------------

test("#34: waiting is not blocked — in the commitment contract, the coordinator and both planning Skills", () => {
  assert.match(rule("Never raise"), /Waiting is not blocked/);
  assert.match(coordinatorPrompt(), /Waiting alone does not prove that/);
  assert.match(readSkill("weekly-planning"), /waiting work.*not automatically blocked/is);
  assert.match(readSkill("daily-planning"), /Waiting card is not automatically Blocked/);
});

test("#34: a Trello due is not a client commitment — in the contract, the coordinator and weekly planning", () => {
  assert.match(rule("Accept:"), /A Trello due is neither a next_check nor a client commitment/);
  assert.match(coordinatorPrompt(), /A Trello `due` is a recorded date, not by itself a client commitment/);
  assert.match(readSkill("weekly-planning"), /hard external\/client deadline only when that commitment is separately confirmed/);
});

// Product Lead decision after the first live validation (docs/57, docs/56 §19): for NATIVE Memory files the
// successful built-in write/edit tool result is the persistence evidence. The claim may not precede it, a
// failed or unclear result is never "saved", and a separate read-back is optional rather than mandatory.
test("#34 native Memory: 'saved' only after a successful write/edit result, never before it", () => {
  assert.match(rule("Say saved"), /Say saved only after a successful write\/edit result, never before/);
});

test("#34 native Memory: an errored or unclear write/edit result is not reported as saved", () => {
  assert.match(rule("Say saved"), /error\/unclear: not saved/);
});

test("#34 native Memory: a read-back is optional, not a mandatory step after every write/edit", () => {
  assert.match(rule("Say saved"), /Read-back optional/);
  // The superseded dcb8d3e rule (docs/57 S1.1) must not come back in any form.
  assert.doesNotMatch(M, /read the file back|saved only if the read|after (a|every) (write|edit)[^.\n]*read/i);
  assert.doesNotMatch(M, /(must|always) read (it|the file)? ?back/i);
});

test("#34 Trello: a write result alone is still not verification — #31 direct read stays mandatory", () => {
  // The native-Memory evidence standard is scoped to Memory files; card changes keep the verified path.
  assert.match(rule("Commitments are Memory-only"), /A card change needs Daniel's explicit request via task-management's verified path/);
  const task = readSkill("task-management");
  assert.match(task, /never treat the write call's return value as the read-back/);
  assert.match(task, /Never report a mutation as done without having made that separate verifying read call in this turn/);
});

test("#34: a next check is not a promise of proactive delivery (#39 owns the rhythm)", () => {
  assert.match(rule("A next_check never"), /A next_check never means you will message first; do not promise reminders/);
  assert.match(coordinatorPrompt(), /You do not message him first, run a schedule or track his commitments automatically — never promise that/);
});

// --- Runtime boundaries (deterministic, offline) --------------------------------------------------

const COMMITMENT_PATH = "/mnt/memory/djonik-memory/commitments/extract/anna-feedback.md";
const IDLE = { type: "session.status_idle", stop_reason: { type: "end_turn" } };

function fakeClient(events: unknown[]): { client: Anthropic; sendCalls: unknown[] } {
  const sendCalls: unknown[] = [];
  const stream = {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () => (index < events.length ? { value: events[index++], done: false } : { value: undefined, done: true }),
      };
    },
  };
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "session_commitments" }),
        events: { stream: async () => stream, send: async (_id: string, params: unknown) => { sendCalls.push(params); } },
      },
    },
  } as unknown as Anthropic;
  return { client, sendCalls };
}

const builtIn = (id: string, name: string, input: Record<string, unknown>) => ({ type: "agent.tool_use", id, name, input });
const builtInResult = (id: string, isError = false) => ({ type: "agent.tool_result", id: `${id}_result`, tool_use_id: id, is_error: isError, content: [] });
const reply = (text: string) => ({ type: "agent.message", content: [{ type: "text", text }] });

test("#34 M runtime: a Memory-only commitment turn needs no Trello verification and adds nothing to the reply", async () => {
  const { client, sendCalls } = fakeClient([
    builtIn("w1", "write", { file_path: COMMITMENT_PATH, content: "# Фідбек Анни по пакуванню\nstatus: waiting\n" }),
    builtInResult("w1"),
    builtIn("r1", "read", { file_path: COMMITMENT_PATH }),
    builtInResult("r1"),
    reply("Записав: по Extract чекаємо фідбек від Анни."),
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  assert.equal(await session.send("По Extract чекаємо фідбек від Анни."), "Записав: по Extract чекаємо фідбек від Анни.");
  assert.equal(sendCalls.length, 1, "no corrective Trello nudge for a Memory-only turn");
  session.close();
});

test("#34 native Memory runtime: a successful write with no read-back (the docs/57 S1.1 shape) completes as is", async () => {
  const { client, sendCalls } = fakeClient([
    builtIn("g1", "grep", { path: "/mnt/memory/djonik-memory", pattern: "Extract" }),
    builtInResult("g1"),
    builtIn("w1", "write", { file_path: COMMITMENT_PATH, content: "# Фідбек від Анни\nstatus: waiting\n" }),
    builtInResult("w1"),
    reply("Записав: по Extract чекаємо фідбек від Анни."),
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  assert.equal(await session.send("По Extract чекаємо фідбек від Анни."), "Записав: по Extract чекаємо фідбек від Анни.");
  assert.equal(sendCalls.length, 1, "no nudge: a native Memory write needs no extra read");
  session.close();
});

test("#34 scope runtime: no Memory ledger — the client neither nudges nor rewrites after a failed Memory write", async () => {
  // Whether a Memory write succeeded is Claude's judgement from its own tool result (instruction above);
  // the application deliberately adds no Memory-result inspection.
  const { client, sendCalls } = fakeClient([
    builtIn("w1", "write", { file_path: COMMITMENT_PATH, content: "# Фідбек від Анни\nstatus: waiting\n" }),
    builtInResult("w1", true),
    reply("Не вдалося зберегти домовленість — запис у Memory повернув помилку."),
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  assert.equal(await session.send("По Extract чекаємо фідбек від Анни."), "Не вдалося зберегти домовленість — запис у Memory повернув помилку.");
  assert.equal(sendCalls.length, 1);
  session.close();
});

test("#34 Trello runtime: a successful Trello write result alone is still unverified, even beside a successful Memory write (#31)", async () => {
  const { client, sendCalls } = fakeClient([
    { type: "agent.mcp_tool_use", id: "t1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "update", cardId: "card_A", due: "2026-10-05T09:00:00.000Z" } },
    { type: "agent.mcp_tool_result", id: "t1_result", mcp_tool_use_id: "t1", is_error: false },
    builtIn("w1", "write", { file_path: COMMITMENT_PATH, content: "# Фідбек від Анни\nstatus: waiting\n" }),
    builtInResult("w1"),
    reply("Готово, дедлайн перенесено і домовленість записано."),
    IDLE,
    // After the one corrective nudge the model again touches only Memory.
    builtIn("w2", "edit", { file_path: COMMITMENT_PATH, old_string: "waiting", new_string: "waiting" }),
    builtInResult("w2"),
    reply("Готово."),
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  await assert.rejects(() => session.send("Перенеси дедлайн картки на понеділок і запиши, що чекаємо Анну."), /did not verify the write/);
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge, then fail closed");
  session.close();
});

test("#34 N runtime: a Memory read-back never counts as verification of a Trello write (#31 unchanged)", async () => {
  const { client, sendCalls } = fakeClient([
    { type: "agent.mcp_tool_use", id: "t1", name: "trelloWriteCard", mcp_server_name: "trello", input: { action: "update", cardId: "card_A", due: "2026-10-05T09:00:00.000Z" } },
    { type: "agent.mcp_tool_result", id: "t1_result", mcp_tool_use_id: "t1", is_error: false },
    builtIn("r1", "read", { file_path: COMMITMENT_PATH }),
    builtInResult("r1"),
    reply("Готово, дедлайн перенесено."),
    IDLE,
    // After the one corrective nudge the model again reads only Memory.
    builtIn("r2", "read", { file_path: COMMITMENT_PATH }),
    builtInResult("r2"),
    reply("Готово."),
    IDLE,
  ]);
  const session = await connectToDjonik(client, "agent_x", "env_x", "memstore_x", "vlt_x");
  await assert.rejects(() => session.send("Перенеси дедлайн картки на понеділок."), /did not verify the write/);
  assert.equal(sendCalls.length, 2, "exactly one corrective nudge, then fail closed");
  session.close();
});

test("#34 scope: the application never reads, writes, parses or caches Memory content itself", () => {
  const runtimeFiles = readdirSync(join(repoRoot, "src")).filter((name) => name.endsWith(".ts") && !name.includes(".test"));
  for (const name of runtimeFiles) {
    const source = read("src", name);
    assert.doesNotMatch(source, /memoryStores|\.memories\.|memoryVersions|memory_versions/, `${name} must not call the Memory API`);
    if (name !== "djonikClient.ts") assert.doesNotMatch(source, /commitments\//, `${name} must not handle commitment records`);
  }
});
