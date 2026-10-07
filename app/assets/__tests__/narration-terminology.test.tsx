// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConfirmCard from "../components/confirm-card";
import { sceneImageGenerationUtterance } from "../lib/scene-source-utterance";

describe("unified video terminology", () => {
  it("names source editing by its actual operation without exposing a video type", () => {
    render(<ConfirmCard plan={{ kind: "presenter_cleanup_confirmation", title: "精简原视频",
      status: "pending", fields: [], cleanupItems: [{ id: "item-1", state: "suggested",
        category: "pause", spokenText: "", action: "shorten", reason: "停顿太长",
        estimatedSavingSeconds: 1, sourceRange: { startSeconds: 1, endSeconds: 3 },
        risk: "low", audioRisk: "low", visualJumpRisk: "low",
        selected: false, locked: false, protectionReasons: [] }] }} />);
    expect(screen.getByLabelText("原视频精简项目")).toBeInTheDocument();
    expect(screen.queryByLabelText("口播清理项目")).not.toBeInTheDocument();
  });

  it("uses current labels while preserving the user's source text verbatim", () => {
    const source = "用户原话：这是一段口播";
    const instruction = sceneImageGenerationUtterance({ narration: source }, 2);
    expect(instruction).toContain(`旁白语境：${source}。`);
    expect(instruction).not.toContain("口播语境：");
    expect(instruction).toContain("不自动应用到分镜");
  });
});
