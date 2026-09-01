// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CreativeDirectionSelector from "../components/creative-direction-selector";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fingerprint = `sha256:${"a".repeat(64)}`;
const creativeDirection = {
  schema_version: "creative_direction:v1",
  fingerprint,
  candidate_count_reason: "两个方向足以形成真实差异。",
  candidates: [
    {
      id: "direction-a",
      angle: "结果先行",
      hook: "先看结果",
      narrative_structure: ["结果", "过程", "行动"],
      visual_language: "结果对比与产品过程",
      asset_strategy: "优先使用已保存素材",
      audio_direction: "紧凑可信",
      evidence_strategy: "展示可核验流程",
      difference_axes: ["hook"],
    },
    {
      id: "direction-b",
      angle: "问题推进",
      hook: "先说问题",
      narrative_structure: ["问题", "方法", "结果"],
      visual_language: "问题场景与步骤演示",
      asset_strategy: "优先使用已保存素材",
      audio_direction: "渐进有推动感",
      evidence_strategy: "展示步骤与结果",
      difference_axes: ["narrative_structure"],
    },
  ],
  recommended_id: "direction-a",
  selected_id: "direction-a",
  selection_reason: "结果先行更匹配当前目标。",
  selection_source: "model_recommended",
  locked_by_user: false,
};

describe("creative direction candidate choice", () => {
  it("keeps a single strong direction without a fake more-directions action", () => {
    render(<CreativeDirectionSelector direction={{
      ...creativeDirection,
      candidate_count_reason: "当前输入只有一个足够明确且可执行的方向。",
      candidates: [creativeDirection.candidates[0]],
    }} />);

    expect(screen.getByText("结果先行")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看其他方向" })).not.toBeInTheDocument();
  });

  it("shows only the applied direction until the user actively asks for more", () => {
    const onApply = vi.fn(async () => undefined);
    render(<CreativeDirectionSelector direction={creativeDirection} onApply={onApply} />);

    expect(screen.getByText("结果先行")).toBeInTheDocument();
    expect(screen.queryByText("问题推进")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看其他方向" }));

    expect(screen.getByText("问题推进")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("submits only after the user explicitly applies a different direction", async () => {
    let resolveApply: (() => void) | undefined;
    const onApply = vi.fn(() => new Promise<void>((resolve) => {
      resolveApply = resolve;
    }));
    render(<CreativeDirectionSelector direction={creativeDirection} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "查看其他方向" }));
    fireEvent.click(screen.getByRole("button", { name: "应用“问题推进”方向" }));

    expect(onApply).toHaveBeenCalledWith({
      candidateId: "direction-b",
      creativeDirectionFingerprint: fingerprint,
    });
    expect(screen.getByRole("button", { name: "正在应用“问题推进”方向" })).toBeDisabled();

    resolveApply?.();
    await waitFor(() => expect(screen.getByText("已提交，正在重排编导稿。")).toBeInTheDocument());
  });

  it("keeps the existing direction on failure and resets local state when the server selection changes", async () => {
    const onApply = vi.fn(async () => {
      throw new Error("创意方向已更新，请刷新后重新选择。");
    });
    const { rerender } = render(
      <CreativeDirectionSelector direction={creativeDirection} onApply={onApply} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看其他方向" }));
    fireEvent.click(screen.getByRole("button", { name: "应用“问题推进”方向" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("创意方向已更新");
    expect(screen.getByText("结果先行")).toBeInTheDocument();

    rerender(<CreativeDirectionSelector direction={{
      ...creativeDirection,
      selected_id: "direction-b",
      selection_source: "user",
      locked_by_user: true,
    }} onApply={onApply} />);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("问题推进")).toBeInTheDocument();
    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(screen.getByText(/当前已应用你选择的方向/)).toBeInTheDocument();
    expect(screen.getByText(/原推荐理由/)).toBeInTheDocument();
    expect(screen.queryByText("结果先行")).not.toBeInTheDocument();
  });

  it("renders the selector above a generic director draft but not for presenter", () => {
    const base = displayProducts["case-01-director-draft"];
    const genericProduct = {
      ...base,
      mode: "copy" as const,
      contentType: "video_script",
      markdownBody: "# 编导稿\n\n连续正文",
      metadata: {
        ...base.metadata,
        video_plan: {
          ...((base.metadata?.video_plan as Record<string, unknown>) ?? {}),
          video_type: "explainer",
          creative_direction: creativeDirection,
        },
      },
    };
    const { rerender } = render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onApplyCreativeDirection={vi.fn(async () => undefined)}
        product={genericProduct}
        selectedConversation={conversationForDisplayProduct(genericProduct)}
      />,
    );

    const directionRegion = screen.getByRole("region", { name: "创意方向" });
    const directorBody = screen.getByText("连续正文");
    expect(directionRegion).toBeInTheDocument();
    expect(directionRegion.compareDocumentPosition(directorBody) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const presenterProduct = {
      ...genericProduct,
      metadata: {
        ...genericProduct.metadata,
        video_plan: {
          ...((genericProduct.metadata?.video_plan as Record<string, unknown>) ?? {}),
          video_type: "presenter",
        },
      },
    };
    rerender(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onApplyCreativeDirection={vi.fn(async () => undefined)}
        product={presenterProduct}
        selectedConversation={conversationForDisplayProduct(presenterProduct)}
      />,
    );

    expect(screen.queryByRole("region", { name: "创意方向" })).not.toBeInTheDocument();
  });
});
