import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { connectToDjonik, type DjonikCustomToolExecutor, type DjonikTurnTelemetry } from "./djonikClient.js";
import { executeTrelloBoardSnapshot } from "./trelloBoardSnapshot.js";
import { executeTrelloWorkHistory, TrelloWorkHistoryClient } from "./trelloWorkHistory.js";
import { EVAL_BOARD_NAME, memoriesForScenario, resetEvalFixture, resetEvalMemory } from "./pmFixture.js";
import { createProjectTimeExecutor } from "./projectTimeTool.js";
import { parseRhythmConfig } from "./rhythmConfig.js";
import { TrelloEvalBoardDriver } from "./pmTrelloFixture.js";
import { makeReport, renderSummary, renderTable, runBenchmark, type BenchmarkMode, type CandidateFactory } from "./pmBenchmark.js";
import { fakeGrader } from "./pmGrader.js";
import { GRADER_INSTRUCTIONS, graderPayload, parseGraderResult } from "./pmGrader.js";

function option(args: string[], key: string): string | undefined { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; }
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is required`); return value; }
function positive(value: string | undefined, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

/** Provision is a separate, explicit future operation. Reset never silently creates remote resources. */
export async function provisionEvalResources(input: { client: Anthropic; key: string; token: string; fetcher?: typeof fetch }): Promise<{ boardId: string; memoryStoreId: string }> {
  const url = new URL("https://api.trello.com/1/boards/");
  for (const [key, value] of Object.entries({ name: EVAL_BOARD_NAME, defaultLists: "false", key: input.key, token: input.token })) url.searchParams.set(key, value);
  const response = await (input.fetcher ?? fetch)(url, { method: "POST" });
  if (!response.ok) throw new Error(`Eval board creation returned HTTP ${response.status}`);
  const board = await response.json() as { id?: string };
  if (!board.id) throw new Error("Eval board creation returned no id");
  const store = await input.client.beta.memoryStores.create({ name: EVAL_BOARD_NAME, description: "Dedicated Djonik PM benchmark facts; never production context.", metadata: { purpose: "djonik-eval" } });
  return { boardId: board.id, memoryStoreId: store.id };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--provision")) {
    if (!args.includes("--allow-fixture-writes")) throw new Error("Provision requires --allow-fixture-writes after authorization");
    const ids = await provisionEvalResources({ client: new Anthropic(),
      key: required(process.env.TRELLO_EVAL_KEY, "TRELLO_EVAL_KEY"), token: required(process.env.TRELLO_EVAL_TOKEN, "TRELLO_EVAL_TOKEN") });
    console.log(JSON.stringify(ids));
    return;
  }
  const mode = (option(args, "--mode") ?? "critical") as BenchmarkMode;
  const release = required(option(args, "--release"), "--release");
  const output = required(option(args, "--output"), "--output");
  if (args.includes("--offline")) {
    const report = makeReport(release, await runBenchmark({
      mode, release, fixture: { async reset() { return { evidenceAvailable: true }; } },
      candidate: { async open() { return { async send() { return { reply: "SILENT", trace: {
        sessionTurnIndex: 1, toolNames: [], skillPaths: [], memoryPathsRead: [], memoryPathsWritten: [], cardIdsRead: [], cardIdsWritten: [], mutations: [], unsupportedConcrete: [],
      } }; }, close() {} }; } }, grader: fakeGrader(),
    }));
    await writeFile(output, JSON.stringify({ ...report, simulation: true }, null, 2));
    console.log("SIMULATION ONLY — fake candidate and fake grader; no behavioral evidence.");
    console.log(renderTable(report));
    console.log(renderSummary(report));
    return;
  }
  if (!args.includes("--allow-fixture-writes") || !args.includes("--allow-paid-run")) {
    throw new Error("Live benchmark requires both --allow-fixture-writes and --allow-paid-run after separate authorization");
  }
  const maxSessions = positive(option(args, "--max-sessions"), "--max-sessions");
  const totalCents = positive(option(args, "--total-cents"), "--total-cents");
  const admissionCents = positive(option(args, "--admission-cents"), "--admission-cents");
  const reserveCents = positive(option(args, "--reserve-cents"), "--reserve-cents");
  const graderBudgetCents = positive(option(args, "--grader-budget-cents"), "--grader-budget-cents");
  const graderInputRate = positive(option(args, "--grader-input-usd-per-million"), "--grader-input-usd-per-million");
  const graderOutputRate = positive(option(args, "--grader-output-usd-per-million"), "--grader-output-usd-per-million");
  const graderModel = required(option(args, "--grader-model"), "--grader-model");
  const agentVersion = positive(process.env.DJONIK_EVAL_AGENT_VERSION, "DJONIK_EVAL_AGENT_VERSION");
  const agentId = required(process.env.DJONIK_EVAL_AGENT_ID, "DJONIK_EVAL_AGENT_ID");
  const environmentId = required(process.env.DJONIK_EVAL_ENVIRONMENT_ID, "DJONIK_EVAL_ENVIRONMENT_ID");
  const vaultId = required(process.env.DJONIK_EVAL_VAULT_ID, "DJONIK_EVAL_VAULT_ID");
  const client = new Anthropic();
  const pinnedAgent = await client.beta.agents.retrieve(agentId, { version: agentVersion });
  const snapshotAvailable = pinnedAgent.tools.some((tool) => tool.type === "custom" && tool.name === "trello_board_snapshot");
  const evalBoardId = required(process.env.TRELLO_EVAL_BOARD_ID, "TRELLO_EVAL_BOARD_ID");
  const evalKey = required(process.env.TRELLO_EVAL_KEY, "TRELLO_EVAL_KEY");
  const board = new TrelloEvalBoardDriver({ boardId: evalBoardId,
    apiKey: evalKey, token: required(process.env.TRELLO_EVAL_TOKEN, "TRELLO_EVAL_TOKEN") });
  const evalReader = new TrelloWorkHistoryClient({ boardId: evalBoardId, apiKey: evalKey,
    readToken: required(process.env.TRELLO_EVAL_READ_TOKEN, "TRELLO_EVAL_READ_TOKEN") });
  const memoryStore = required(process.env.DJONIK_EVAL_MEMORY_STORE_ID, "DJONIK_EVAL_MEMORY_STORE_ID");
  let spent = 0;
  let graderSpent = 0;
  let sessions = 0;
  let budgetUnknown = false;
  const candidate: CandidateFactory = { async open({ scenario, repetition, fixedClock }) {
    if (budgetUnknown || sessions >= maxSessions || spent * 100 + admissionCents + reserveCents > totalCents) throw new Error("benchmark admission budget exhausted or usage unknown");
    sessions += 1;
    // #52 approval scenarios must be able to write the dedicated, verified eval store;
    // earlier read-only scenarios keep their original fixture semantics.
    const memoryAccess = Number(scenario.id.slice(1)) >= 31 ? "read_write" : "read_only";
    let telemetry: DjonikTurnTelemetry | undefined;
    // #62: the eval executor reads the scenario's /rhythm.md from the same fixture text the eval Memory store was reset to
    // (no second Memory API path), and the dedicated eval board through the GET-only reader.
    const projectTime = createProjectTimeExecutor({ reader: evalReader, now: () => new Date(fixedClock),
      readConfig: async () => parseRhythmConfig(memoriesForScenario(scenario)["/rhythm.md"] ?? null).config });
    const evalCustomTools: DjonikCustomToolExecutor = async (toolInput, context) =>
      context.name === "trello_board_snapshot" ? executeTrelloBoardSnapshot(toolInput, evalReader, new Date(fixedClock))
        : context.name === "trello_work_history" ? executeTrelloWorkHistory(toolInput, evalReader, new Date(fixedClock))
          : context.name === "trello_project_time" ? projectTime(toolInput)
            : { isError: true, content: JSON.stringify({ error: { message: "This custom tool is unavailable in the eval Session." } }) };
    const connection = await connectToDjonik(client,
      agentId, environmentId, memoryStore, vaultId,
      undefined, (record) => {
        telemetry = record;
        const amount = record.usage?.listCostAmount;
        if (record.usage?.listCostCurrency !== "USD" || !amount || !/^\d+$/.test(amount)) budgetUnknown = true;
        else spent += Number(amount) / 100;
      },
      "diagnostic", evalCustomTools, { agentVersion, memoryAccess, now: () => new Date(fixedClock),
        maxListCostUsdCents: String(admissionCents), metadata: { source: "pm-benchmark", release, scenario: scenario.id, repetition: String(repetition) },
        attestSession: async (created) => {
          const id = (created as { id?: unknown } | null)?.id;
          if (typeof id !== "string") throw new Error("Eval Session create returned no id");
          const persisted = await client.beta.sessions.retrieve(id);
          if (persisted.agent.id !== agentId || persisted.agent.version !== agentVersion ||
            persisted.environment_id !== environmentId || !persisted.vault_ids.includes(vaultId) ||
            !persisted.resources.some((resource) => resource.type === "memory_store" && resource.memory_store_id === memoryStore && resource.access === memoryAccess)) {
            throw new Error("Eval Session snapshot does not match the pinned benchmark tuple");
          }
        } });
    return {
      async send(prompt: string, origin) {
        telemetry = undefined;
        const reply = origin
          ? (await connection.sendTraced([{ type: "text", text: prompt }], origin)).reply
          : await connection.send(prompt);
        const current = telemetry as DjonikTurnTelemetry | undefined;
        if (!current?.decisionTrace) throw new Error("turn decision trace unavailable");
        if (budgetUnknown) throw new Error("candidate usage unavailable; stop before another paid turn");
        return { reply, trace: current.decisionTrace, usageCostUsd: Number(current.usage?.listCostAmount) / 100 };
      },
      close() { connection.close(); },
    };
  } };
  const runs = await runBenchmark({ mode, release, candidate,
    fixture: { async reset({ scenario }) { await resetEvalMemory(client, memoryStore, scenario); return resetEvalFixture(board, scenario); } },
    evidenceAvailable: (scenario) => !scenario.requires || snapshotAvailable,
    grader: { async grade(input) {
      const payload = graderPayload(input);
      const maxOutputTokens = 500;
      // UTF-8 bytes upper-bound tokenizer input count conservatively; output has a hard token cap.
      const reserved = ((Buffer.byteLength(GRADER_INSTRUCTIONS + payload) * graderInputRate + maxOutputTokens * graderOutputRate) / 1_000_000) * 100;
      if (graderSpent * 100 + reserved > graderBudgetCents) throw new Error("grader admission budget exhausted");
      const result = await client.messages.create({ model: graderModel, max_tokens: maxOutputTokens,
        system: GRADER_INSTRUCTIONS, messages: [{ role: "user", content: payload }] });
      const inputTokens = result.usage.input_tokens;
      const outputTokens = result.usage.output_tokens;
      const estimatedCostUsd = (inputTokens * graderInputRate + outputTokens * graderOutputRate) / 1_000_000;
      graderSpent += estimatedCostUsd;
      const body = result.content.filter((block) => block.type === "text").map((block) => block.text).join("");
      const parsed = parseGraderResult(JSON.parse(body) as unknown, input.scenario.rubricFocus);
      return { ...parsed, usage: { inputTokens, outputTokens, estimatedCostUsd } };
    } },
  });
  const report = makeReport(release, runs);
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(renderTable(report));
  console.log(renderSummary(report));
  console.log(`Measured candidate list cost: $${spent.toFixed(2)} across ${sessions} Sessions; grader estimated cost: $${graderSpent.toFixed(2)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
