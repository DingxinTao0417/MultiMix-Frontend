// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectTargetPicker from "../components/project-target-picker";

afterEach(cleanup);

describe("ProjectTargetPicker", () => {
  it("requires the user to choose an explicit target project", () => {
    const onSelect = vi.fn();
    render(
      <ProjectTargetPicker
        open
        projects={[
          { id: "project-1", title: "门店讲解", stateLabel: "编导稿待确认", updatedAt: "刚刚" },
          { id: "project-2", title: "产品口播", stateLabel: "可继续编辑", updatedAt: "昨天" },
        ]}
        onSelect={onSelect}
        onClose={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /产品口播/ }));
    expect(onSelect).toHaveBeenCalledWith("project-2");
  });

  it("shows a new-project action instead of silently creating an empty project", () => {
    const onCreateProject = vi.fn();
    render(
      <ProjectTargetPicker
        open
        projects={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateProject={onCreateProject}
      />,
    );

    expect(screen.getByText("还没有可以加入的项目")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(onCreateProject).toHaveBeenCalledOnce();
  });
});
