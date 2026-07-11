import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as timelineModel from "../lib/agent-run-timeline-model";
import type { AgentRunStep } from "../lib/asset-workspace-types";

type TimelineProps = {
  steps: AgentRunStep[];
  errorMessage?: string | null;
  onRetry?: (jobId: string) => void;
  completionConfirmed?: boolean;
};

let AgentRunTimeline: ComponentType<TimelineProps>;

beforeAll(() => {
  const nativeRequire = createRequire(import.meta.url);
  const ts = nativeRequire("typescript") as typeof import("typescript");
  const componentPath = path.join(
    process.cwd(),
    "app/assets/components/agent-run-timeline.tsx",
  );
  const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentPath,
  }).outputText;
  const componentModule = {
    exports: {} as { default?: ComponentType<TimelineProps> },
  };
  const localRequire = (specifier: string) => specifier === "../lib/agent-run-timeline-model"
    ? timelineModel
    : nativeRequire(specifier);
  const executeModule = new Function("require", "module", "exports", compiled);

  executeModule(localRequire, componentModule, componentModule.exports);
  if (!componentModule.exports.default) throw new Error("AgentRunTimeline default export missing");
  AgentRunTimeline = componentModule.exports.default;
});

const {
  dispatchAgentRunRetry,
  resolveAgentRunExpandedState,
} = timelineModel;

function renderTimeline({
  steps,
  errorMessage,
  onRetry,
  completionConfirmed,
}: TimelineProps) {
  return renderToStaticMarkup(createElement(AgentRunTimeline, {
    steps,
    errorMessage,
    onRetry,
    completionConfirmed,
  }));
}

describe("AgentRunTimeline summary", () => {
  it("summarizes completed steps using real elapsed seconds", () => {
    expect(timelineModel.summarizeAgentRunSteps([
      { key: "create_job", label: "创建任务", status: "done" },
      { key: "prepare_scenes", label: "准备分镜", status: "done", elapsedSeconds: 1.25 },
      { key: "build_project", label: "组装工程", status: "done", elapsedSeconds: 2.75 },
    ])).toMatchObject({
      allDone: true,
      doneCount: 3,
      total: 3,
      totalElapsedLabel: "4秒",
    });
  });

  it("reports an empty run without claiming completion or readiness", () => {
    expect(timelineModel.summarizeAgentRunSteps([])).toEqual({
      total: 0,
      doneCount: 0,
      allDone: false,
      totalElapsedLabel: undefined,
      projectReady: false,
      mgActive: false,
      hasFailure: false,
    });
  });

  it("omits total elapsed copy when real durations are missing", () => {
    expect(timelineModel.summarizeAgentRunSteps([
      { key: "create_job", label: "创建任务", status: "done" },
      { key: "build_project", label: "组装工程", status: "done" },
    ])).toMatchObject({ allDone: true, totalElapsedLabel: undefined });
  });

  it("keeps failed runs incomplete", () => {
    const summary = timelineModel.summarizeAgentRunSteps([
      { key: "create_job", label: "创建任务", status: "done" },
      { key: "prepare_scenes", label: "准备分镜", status: "fail" },
    ]);

    expect(summary.allDone).toBe(false);
    expect(summary.hasFailure).toBe(true);
  });

  it("separates editor readiness from a waiting MG tail", () => {
    expect(timelineModel.summarizeAgentRunSteps([
      { key: "create_job", label: "创建任务", status: "done" },
      { key: "build_project", label: "组装工程", status: "done" },
      { key: "mg_overlay", label: "补充 MG 动效（1/2）", status: "wait" },
    ])).toMatchObject({ projectReady: true, mgActive: true, allDone: false });
  });
});

describe("AgentRunTimeline expansion transitions", () => {
  type ExpansionState = {
    expanded: boolean;
    allDone: boolean;
    collapseReady: boolean;
    autoCollapsed: boolean;
    manualExpansionLocked: boolean;
    completionConfirmed: boolean | undefined;
  };
  type ExpansionEvent =
    | { type: "sync"; allDone: boolean; completionConfirmed?: boolean }
    | { type: "toggle" };
  const reduceExpansion = resolveAgentRunExpandedState as unknown as (
    state: ExpansionState | undefined,
    event: ExpansionEvent,
  ) => ExpansionState;

  it("waits for confirmed terminal, collapses once, then preserves manual expansion", () => {
    let state = reduceExpansion(undefined, {
      type: "sync",
      allDone: true,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: false,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: true,
    });
    expect(state.expanded).toBe(false);
    expect(state.autoCollapsed).toBe(true);

    state = reduceExpansion(state, { type: "toggle" });
    expect(state.expanded).toBe(true);
    expect(state.manualExpansionLocked).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: true,
    });
    expect(state.expanded).toBe(true);
  });

  it("keeps static completed cards backward compatible when no live confirmation gate exists", () => {
    const state = reduceExpansion(undefined, {
      type: "sync",
      allDone: true,
    });

    expect(state.expanded).toBe(false);
    expect(state.autoCollapsed).toBe(true);
  });

  it("preserves a persisted completed card collapse through terminal reconciliation", () => {
    let state = reduceExpansion(undefined, {
      type: "sync",
      allDone: true,
    });
    expect(state.expanded).toBe(false);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(false);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: true,
    });
    expect(state.expanded).toBe(false);
  });

  it("expands persisted completion for real late work and collapses the confirmed final state", () => {
    let state = reduceExpansion(undefined, {
      type: "sync",
      allDone: true,
    });
    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(false);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: false,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: true,
    });
    expect(state.expanded).toBe(false);
  });

  it("preserves manual expansion made during persisted terminal reconciliation", () => {
    let state = reduceExpansion(undefined, {
      type: "sync",
      allDone: true,
    });
    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(false);

    state = reduceExpansion(state, { type: "toggle" });
    expect(state.expanded).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: false,
      completionConfirmed: false,
    });
    expect(state.expanded).toBe(true);

    state = reduceExpansion(state, {
      type: "sync",
      allDone: true,
      completionConfirmed: true,
    });
    expect(state.expanded).toBe(true);
  });
});

describe("AgentRunTimeline retry dispatch", () => {
  it("dispatches the exact persisted retry job ID", () => {
    const onRetry = vi.fn();

    expect(dispatchAgentRunRetry("job-failed-exact", onRetry)).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("job-failed-exact");
  });

  it("does not dispatch without both an ID and callback", () => {
    const onRetry = vi.fn();

    expect(dispatchAgentRunRetry(undefined, onRetry)).toBe(false);
    expect(dispatchAgentRunRetry("job-failed-exact", undefined)).toBe(false);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("AgentRunTimeline rendered branches", () => {
  it("renders an initially completed run collapsed", () => {
    const html = renderTimeline({
      steps: [
        { key: "create_job", label: "创建任务", status: "done" },
        { key: "build_project", label: "组装工程", status: "done", elapsedSeconds: 4 },
      ],
    });

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<ol");
    expect(html).toContain("共 2 步 · 4秒");
  });

  it("keeps an all-done live run expanded until polling confirms the terminal state", () => {
    const html = renderTimeline({
      steps: [
        { key: "create_job", label: "创建任务", status: "done" },
        { key: "build_project", label: "组装工程", status: "done" },
      ],
      completionConfirmed: false,
    });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<ol");
  });

  it("renders failures expanded with truncated copy and an exact retry control", () => {
    const errorMessage = "渲染服务暂时不可用".repeat(30);
    const truncatedError = `${errorMessage.slice(0, 159)}…`;
    const html = renderTimeline({
      steps: [{
        key: "build_project",
        label: "组装工程",
        status: "fail",
        retryJobId: "job-failed-exact",
      }],
      errorMessage,
      onRetry: vi.fn(),
    });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<ol");
    expect(html).toContain(truncatedError);
    expect(html).not.toContain(errorMessage);
    expect(html).toContain("重试失败步骤");
  });

  it("does not render retry without both the exact ID and callback", () => {
    const withoutCallback = renderTimeline({
      steps: [{
        key: "build_project",
        label: "组装工程",
        status: "fail",
        retryJobId: "job-failed-exact",
      }],
      errorMessage: "任务失败",
    });
    const withoutId = renderTimeline({
      steps: [{ key: "build_project", label: "组装工程", status: "fail" }],
      errorMessage: "任务失败",
      onRetry: vi.fn(),
    });

    expect(withoutCallback).not.toContain("重试失败步骤");
    expect(withoutId).not.toContain("重试失败步骤");
  });

  it("renders project-ready copy while an MG step waits", () => {
    const html = renderTimeline({
      steps: [
        { key: "create_job", label: "创建任务", status: "done" },
        { key: "build_project", label: "组装工程", status: "done" },
        { key: "mg_overlay", label: "补充 MG 动效（1/2）", status: "wait" },
      ],
    });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("视频工程已就绪 · MG 动效处理中");
    expect(html).toContain("<ol");
  });
});
