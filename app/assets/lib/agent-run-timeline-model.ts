import type { AgentRunStep } from "./asset-workspace-types";

const STALE_TIMEOUT_ERROR = "Job exceeded its timeout without completing and was marked failed.";
const MAX_TECHNICAL_DETAIL_LENGTH = 160;

function formatDurationLabel(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}秒`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [
    hours ? `${hours}小时` : "",
    minutes ? `${minutes}分` : "",
    rest ? `${rest}秒` : "",
  ].filter(Boolean).join("");
}

export function executionErrorPresentation(message: string): {
  summary: string;
  technicalDetail?: string;
} {
  const normalized = message.trim();
  const summary = normalized === STALE_TIMEOUT_ERROR
    ? "视频工程生成超时，请重试。"
    : "视频工程生成失败，请重试。";
  if (!normalized) return { summary };
  const technicalDetail = normalized.length > MAX_TECHNICAL_DETAIL_LENGTH
    ? `${normalized.slice(0, MAX_TECHNICAL_DETAIL_LENGTH - 1)}…`
    : normalized;
  return { summary, technicalDetail };
}

export type AgentRunExpansionState = {
  expanded: boolean;
  allDone: boolean;
  collapseReady: boolean;
  autoCollapsed: boolean;
  manualExpansionLocked: boolean;
  completionConfirmed: boolean | undefined;
};

export type AgentRunExpansionEvent =
  | {
      type: "sync";
      allDone: boolean;
      completionConfirmed?: boolean;
    }
  | { type: "toggle" };

export function resolveAgentRunExpandedState(
  state: AgentRunExpansionState | undefined,
  event: AgentRunExpansionEvent,
): AgentRunExpansionState {
  if (event.type === "toggle") {
    if (!state) {
      return {
        expanded: true,
        allDone: false,
        collapseReady: false,
        autoCollapsed: false,
        manualExpansionLocked: false,
        completionConfirmed: undefined,
      };
    }
    const expanded = !state.expanded;
    return {
      ...state,
      expanded,
      manualExpansionLocked: state.manualExpansionLocked
        || ((state.autoCollapsed || state.collapseReady) && expanded),
    };
  }

  const collapseReady = event.allDone && event.completionConfirmed !== false;
  if (!state) {
    return {
      expanded: !collapseReady,
      allDone: event.allDone,
      collapseReady,
      autoCollapsed: collapseReady,
      manualExpansionLocked: false,
      completionConfirmed: event.completionConfirmed,
    };
  }

  const becameIncomplete = state.allDone && !event.allDone;
  let expanded = state.expanded;
  let autoCollapsed = becameIncomplete && !state.manualExpansionLocked
    ? false
    : state.autoCollapsed;

  if (becameIncomplete) {
    expanded = true;
  } else if (
    collapseReady
    && !state.collapseReady
    && !autoCollapsed
    && !state.manualExpansionLocked
  ) {
    expanded = false;
    autoCollapsed = true;
  }

  if (
    expanded === state.expanded
    && event.allDone === state.allDone
    && collapseReady === state.collapseReady
    && autoCollapsed === state.autoCollapsed
    && event.completionConfirmed === state.completionConfirmed
  ) {
    return state;
  }

  return {
    ...state,
    expanded,
    allDone: event.allDone,
    collapseReady,
    autoCollapsed,
    completionConfirmed: event.completionConfirmed,
  };
}

export function dispatchAgentRunRetry(
  retryJobId: string | undefined,
  onRetry: ((jobId: string) => void) | undefined,
) {
  if (!retryJobId || !onRetry) return false;
  onRetry(retryJobId);
  return true;
}

export function summarizeAgentRunSteps(steps: AgentRunStep[]) {
  const total = steps.length;
  const doneCount = steps.filter((step) => step.status === "done").length;
  const allDone = total > 0 && doneCount === total;
  const mgStep = steps.find((step) => step.key === "mg_overlay");
  const projectSteps = steps.filter((step) => step.key !== "mg_overlay");
  const projectReady = projectSteps.length > 0
    && projectSteps.every((step) => step.status === "done");
  const mgActive = mgStep?.status === "run" || mgStep?.status === "wait";
  const hasFailure = steps.some((step) => step.status === "fail");
  const seconds = steps.reduce(
    (sum, step) => sum + (typeof step.elapsedSeconds === "number" ? step.elapsedSeconds : 0),
    0,
  );
  const totalElapsedLabel = seconds > 0
    ? formatDurationLabel(seconds)
    : undefined;

  return {
    total,
    doneCount,
    allDone,
    totalElapsedLabel,
    projectReady,
    mgActive,
    hasFailure,
  };
}
