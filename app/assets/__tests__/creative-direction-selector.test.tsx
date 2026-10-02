// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CreativeDirectionSelector from "../components/creative-direction-selector";
import ConversationStudio from "../components/conversation-studio";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fingerprint = `sha256:${"a".repeat(64)}`;
const globalsCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const genericCreativeProfile = {
  schema_version: "video_creative_profile:v1",
  task_mode: "create",
  content_goal: "explain",
  style_profile: "editorial_clean",
  production_mode: "hybrid",
  anchor_source: "uploaded_assets",
  preserve_source_audio: false,
  cost_priority: "balanced",
  latency_priority: "standard",
};
const presenterCreativeProfile = {
  ...genericCreativeProfile,
  task_mode: "repurpose",
  production_mode: "source_led",
  anchor_source: "presenter_video",
  preserve_source_audio: true,
};
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
  it("keeps the current draft's direction choice in its conversation product turn", async () => {
    const base = displayProducts["case-01-director-draft"];
    const product = {
      ...base,
      mode: "copy" as const,
      contentType: "video_script",
      metadata: {
        ...base.metadata,
        video_plan: {
          ...((base.metadata?.video_plan as Record<string, unknown>) ?? {}),
          creative_profile: genericCreativeProfile,
          creative_direction: creativeDirection,
        },
      },
    };
    const conversation = {
      ...conversationForDisplayProduct(product),
      detailsLoaded: true,
      messages: [{ role: "assistant" as const, text: "编导稿已生成。", assetId: product.backendAssetId }],
    };
    const onApply = vi.fn(async () => undefined);
    render(<ConversationStudio
      basePath="/app/assets"
      selectedConversation={conversation}
      selectedProduct={product}
      onSelectProduct={vi.fn()}
      onApplyCreativeDirection={onApply}
    />);

    const chat = screen.getByRole("region", { name: "Content generation conversation" });
    expect(chat.querySelector('[aria-label="创意方向"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看其他方向" }));
    fireEvent.click(screen.getByRole("button", { name: "应用“问题推进”方向" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      candidateId: "direction-b",
      creativeDirectionFingerprint: fingerprint,
    }));
  });
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

  it("keeps the draft body in the product pane and excludes presenter-source drafts from direction choices", () => {
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
          creative_profile: genericCreativeProfile,
          creative_direction: creativeDirection,
        },
      },
    };
    const { rerender } = render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={genericProduct}
        selectedConversation={conversationForDisplayProduct(genericProduct)}
      />,
    );

    const directorBody = screen.getByText("连续正文");
    expect(directorBody).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "创意方向" })).not.toBeInTheDocument();

    const presenterProduct = {
      ...genericProduct,
      metadata: {
        ...genericProduct.metadata,
        video_plan: {
          ...((genericProduct.metadata?.video_plan as Record<string, unknown>) ?? {}),
          creative_profile: presenterCreativeProfile,
        },
      },
    };
    rerender(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={presenterProduct}
        selectedConversation={conversationForDisplayProduct(presenterProduct)}
      />,
    );

    expect(screen.queryByRole("region", { name: "创意方向" })).not.toBeInTheDocument();
  });

  it("styles the direction panel as conversation content without a product row", () => {
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
          creative_profile: genericCreativeProfile,
          creative_direction: creativeDirection,
        },
      },
    };

    const conversation = {
      ...conversationForDisplayProduct(genericProduct),
      detailsLoaded: true,
      messages: [{ role: "assistant" as const, text: "编导稿已生成。", assetId: genericProduct.backendAssetId }],
    };
    render(<ConversationStudio
      basePath="/app/assets"
      selectedConversation={conversation}
      selectedProduct={genericProduct}
      onSelectProduct={vi.fn()}
    />);

    const directionRegion = screen.getByRole("region", { name: "创意方向" });
    expect(directionRegion).toHaveClass("shadcn-prototype-creative-direction");
    expect(directionRegion.closest(".shadcn-prototype-thread")).toBeInTheDocument();
    expect(globalsCss).toMatch(
      /\.shadcn-prototype-thread \.shadcn-prototype-creative-direction\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s,
    );
    expect(globalsCss).not.toContain(".shadcn-prototype-product.has-creative-direction");
  });
});
