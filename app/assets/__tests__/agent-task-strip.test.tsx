// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentTaskStrip from "../components/agent-task-strip";

afterEach(cleanup);

describe("AgentTaskStrip", () => {
  it("shows the active task and a user-facing return action", () => {
    const onResume = vi.fn();
    render(
      <AgentTaskStrip
        tasks={{
          active: {
            id: "task-copy",
            goal: "优化新品标题",
            status: "active",
          },
          paused: [
            {
              id: "task-video",
              goal: "修改产品视频",
              status: "paused",
              assetId: 42,
              versionId: 9,
              sceneId: "scene-2",
            },
          ],
        }}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("当前：优化新品标题")).toBeInTheDocument();
    expect(screen.getByText("1 个任务已暂停")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回 修改产品视频" }));
    expect(onResume).toHaveBeenCalledWith("修改产品视频");
    expect(screen.queryByText("task-video")).not.toBeInTheDocument();
  });

  it("renders nothing when the conversation has no Agent task", () => {
    const { container } = render(
      <AgentTaskStrip tasks={{ paused: [] }} onResume={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
