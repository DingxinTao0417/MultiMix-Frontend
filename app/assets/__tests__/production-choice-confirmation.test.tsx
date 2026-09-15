// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmCard from "../components/confirm-card";
import type { AssetMessagePlan } from "../lib/asset-workspace-types";
afterEach(cleanup);

function plan(): AssetMessagePlan {
  return { kind: "video_parameter_confirmation", title: "确认视频参数", status: "pending", fields: [],
    confirmLabel: "确认参数并生成编导稿", ratioDefault: "16:9", durationSeconds: 30,
    productionSelectionRequired: true, productionRecommendedId: "graphics",
    productionOptions: [
      { id: "public_stock", label: "公开素材", effect: "通用场景画面", requiredInputs: "主题和受众", costNote: "制作费用以方案为准" },
      { id: "graphics", label: "图形动画", effect: "文字与图形动画", requiredInputs: "表达重点", costNote: "涉及图形渲染费用" },
    ] };
}

describe("production method in the existing video confirmation", () => {
  it("does not treat a recommendation as the user's choice", () => {
    const onConfirm = vi.fn();
    render(<ConfirmCard plan={plan()} onConfirm={onConfirm} />);
    const submit = screen.getByRole("button", { name: "确认参数并生成编导稿" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("radio", { name: "图形动画（推荐）" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "图形动画（推荐）" }));
    expect(screen.getByText("涉及图形渲染费用")).toBeVisible();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ productionChoiceId: "graphics" }));
  });

  it("restores a saved explicit choice and its strict restriction", () => {
    render(<ConfirmCard plan={{ ...plan(), productionChoiceId: "graphics", productionSelectionRequired: false,
      productionRestriction: "only" }} onConfirm={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "图形动画（推荐）" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("只使用所选制作方式")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认参数并生成编导稿" })).toBeEnabled();
  });

  it("blocks generation when the server reports no executable method", () => {
    render(<ConfirmCard plan={{ ...plan(), productionOptions: [], productionBlockedReason: "当前没有可执行的制作方式" }} onConfirm={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("当前没有可执行的制作方式");
    expect(screen.getByRole("button", { name: "确认参数并生成编导稿" })).toBeDisabled();
  });

  it("allows an explicit replacement for a previously unavailable choice", () => {
    const onConfirm = vi.fn();
    render(<ConfirmCard plan={{ ...plan(), productionChoiceId: "ai_visual", productionSelectionRequired: false,
      productionBlockedReason: "AI 画面需要参考图" }} onConfirm={onConfirm} />);
    const submit = screen.getByRole("button", { name: "确认参数并生成编导稿" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "图形动画（推荐）" }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ productionChoiceId: "graphics" }));
  });
});
