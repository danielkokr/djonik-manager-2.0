import type { RhythmConfig } from "./rhythmConfig.js";
import { resolveHistoryWindow, type CustomToolExecutionResult } from "./trelloWorkHistory.js";
import {
  computeProjectTime,
  projectLabelExists,
  projectTimeUnavailable,
  type ProjectTimeOutcome,
  type WeeklyTimeReader,
} from "./weeklyTime.js";

/**
 * #62: the read-only custom tool that makes the #50 weekly-time calculation reachable from an ordinary turn
 * ("скільки часу цього тижня я витратив на <проєкт>?"). Claude decides semantically that Daniel asks about time and
 * resolves his word to the canonical current Trello label through the project brief (#59); this tool receives only
 * that label. Code owns everything after it: the `/rhythm.md` work hours (the SAME config source the reminder and
 * focus-budget executors read), the fresh GET-only Trello read, the one allocation (`computeProjectTime` →
 * `allocateWeeklyTime`) and the visible `answer_text`, which the client relays verbatim (`djonikClient.ts`).
 *
 * This week only (Monday 00:00 Kyiv → now): interval reconstruction replays backwards from each card's CURRENT state,
 * which is the state at the window end only when the window ends now. A past week would need the later moves undone
 * too, so it is deliberately not offered.
 *
 * No write anywhere: no Trello write, no Memory access beyond the existing `/rhythm.md` reader, no state store. The
 * #40 per-id lifecycle already runs it at most once per `custom_tool_use_id`.
 */
export const PROJECT_TIME_TOOL_NAME = "trello_project_time";

export const TRELLO_PROJECT_TIME_TOOL = {
  type: "custom" as const,
  name: PROJECT_TIME_TOOL_NAME,
  description:
    "Approximate time Daniel spent on ONE project this week (Monday 00:00 Kyiv → now), with a per-card breakdown, computed by code from Trello In-progress list moves inside his /rhythm.md work_hours (overlaps split equally, daily cap). " +
    "Use it whenever Daniel asks how much time or how many hours went into a project; pass the project's current Trello label after resolving his word through the project brief. " +
    "The client shows `answer_text` to Daniel verbatim: never repeat, recompute, round or restate its hours; add nothing, or at most one short line without numbers. " +
    "An `unavailable` result (no work_hours, incomplete history, label not found) is the final answer: never estimate time from trello_work_history, card or action counts, and never narrate raw moves instead. " +
    "Read-only; this week only; not billing-grade.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["project_label"],
    properties: { project_label: { type: "string", minLength: 1, maxLength: 120 } },
  },
};

export interface ProjectTimeInput {
  projectLabel: string;
}

export function parseProjectTimeInput(value: unknown): ProjectTimeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool input.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "project_label")) throw new Error("Invalid tool input.");
  const label = typeof record.project_label === "string" ? record.project_label.trim() : "";
  if (label.length === 0 || label.length > 120) throw new Error("Invalid tool input.");
  return { projectLabel: label };
}

const INVALID_INPUT = JSON.stringify({
  error: { message: "Project time request is invalid: pass one current Trello project label as project_label. Nothing was counted." },
});

/** The model-facing result: the outcome and the ready answer only — no hours as numbers, no card ids, no raw moves. */
function resultOf(outcome: ProjectTimeOutcome): CustomToolExecutionResult {
  return {
    isError: false,
    content: JSON.stringify({
      status: outcome.status,
      project_label: outcome.project,
      ...(outcome.status === "unavailable" ? { reason: outcome.reason } : {}),
      week: "this_week",
      answer_text: outcome.answerText,
    }),
  };
}

export type ProjectTimeExecutor = (input: unknown) => Promise<CustomToolExecutionResult>;

/**
 * Order matches the Friday reporter: no work hours → unavailable before any Trello read; an unknown label →
 * unavailable before the action log is read; any read failure → unavailable, never partial hours.
 */
export function createProjectTimeExecutor(options: {
  reader: WeeklyTimeReader | null;
  readConfig: () => Promise<Pick<RhythmConfig, "workHours" | "workdays" | "dailyTimeCapMinutes">>;
  now?: () => Date;
  log?: (line: string) => void;
}): ProjectTimeExecutor {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  return async (input) => {
    let request: ProjectTimeInput;
    try {
      request = parseProjectTimeInput(input);
    } catch {
      return { isError: true, content: INVALID_INPUT };
    }
    const project = request.projectLabel;
    const outcome = await (async (): Promise<ProjectTimeOutcome> => {
      let config: Pick<RhythmConfig, "workHours" | "workdays" | "dailyTimeCapMinutes">;
      try {
        config = await options.readConfig();
      } catch {
        return projectTimeUnavailable(project, "config_unavailable");
      }
      if (config.workHours === null) return projectTimeUnavailable(project, "work_hours_missing");
      const reader = options.reader;
      if (reader === null) return projectTimeUnavailable(project, "history_unavailable");
      try {
        const window = resolveHistoryWindow({ kind: "this_week" }, now());
        const board = await reader.resolveSingleBoard();
        const [cards, lists] = await Promise.all([reader.readCards(board.id), reader.readLists(board.id)]);
        if (!projectLabelExists(cards, project)) return projectTimeUnavailable(project, "project_not_found");
        const { actions, coverage } = await reader.readActions(board.id, { ...window, label: "project-time" });
        return computeProjectTime({ project, cards, lists, actions, coverage, window, config });
      } catch {
        return projectTimeUnavailable(project, "history_unavailable");
      }
    })();
    // Content-free: neither the label nor any card name or number.
    log(`[project_time] ${outcome.status}${outcome.status === "unavailable" ? ` reason=${outcome.reason}` : ` cards=${outcome.cards.length}`}`);
    return resultOf(outcome);
  };
}
