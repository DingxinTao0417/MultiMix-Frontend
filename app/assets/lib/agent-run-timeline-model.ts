import type { AgentRunStep } from "./asset-workspace-types";

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
    ? `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`
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
