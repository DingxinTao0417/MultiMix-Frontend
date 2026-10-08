// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProductPreview from "../components/product-preview";
import { displayProducts } from "./fixtures/display-products";

afterEach(cleanup);

function draft(status?: string, candidate?: Record<string, unknown>) {
  const base = displayProducts["case-01-director-draft"];
  return {
    ...base,
    metadata: {
      ...base.metadata,
      video_plan: {
        summary: { topic: "早餐" },
        scenes: [{ id: "scene-1", title: "早餐过渡", narration: "新的一天从早餐开始。", asset_reference: { status: "no_asset_hit" } }],
        public_stock_suggestions: [{ scene_id: "scene-1", role: "过渡", visual_target: "早餐桌氛围", reason: "不涉及真实商品" }],
        scene_source_decisions: status ? [{ scene_id: "scene-1", status, action: "search_public" }] : [],
      },
      scene_source_candidates: candidate ? { "scene-1": candidate } : {},
    },
  };
}

it("shows scene source choices on the saved editable director document", () => {
  const onSceneSourceAction = vi.fn();
  const product = {
    ...draft(),
    mode: "copy" as const,
    contentType: "video_script",
    markdownBody: "# 早餐编导稿",
    metadata: { ...draft().metadata, director_draft_phase: "editable_reviewed" },
  };
  render(<ProductPreview product={product} onSceneSourceAction={onSceneSourceAction} />);
  expect(screen.getByText("早餐编导稿")).toBeInTheDocument();
  fireEvent.click(screen.getByText("查看逐镜来源与分镜详情"));
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  for (const [label, kind] of [
    ["选择项目图片", "choose_asset"],
    ["生成图片", "generate_image"],
    ["上传素材", "upload_asset"],
    ["修改本镜画面", "revise_scene"],
  ] as const) {
    fireEvent.click(within(scene).getByRole("button", { name: label }));
    expect(onSceneSourceAction).toHaveBeenCalledWith({ kind, sceneId: "scene-1" });
  }
  expect(within(scene).queryByRole("button", { name: /公共素材/ })).not.toBeInTheDocument();
});

it("shows a scene upload version conflict on the editable director document", () => {
  const product = {
    ...draft(), mode: "copy" as const, contentType: "video_script",
    markdownBody: "# 早餐编导稿",
  };
  render(<ProductPreview product={product} onSceneSourceAction={vi.fn()}
    sceneSourceProgress={{ sceneId: "scene-1", stage: "分镜已更新",
      error: "图片已保存到项目，但编导稿版本已变化；请重新选择。" }} />);
  fireEvent.click(screen.getByText("查看逐镜来源与分镜详情"));
  expect(within(screen.getByRole("listitem", { name: /早餐过渡/ }))
    .getByRole("alert")).toHaveTextContent("编导稿版本已变化");
});

it("lets the user request a search without adopting stock", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft()} onSceneSourceAction={onSceneSourceAction} />);
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  expect(within(scene).getByText(/可考虑公共素材/)).toBeInTheDocument();
  expect(within(scene).getByRole("button", { name: "选择项目图片" }).compareDocumentPosition(
    within(scene).getByText(/可考虑公共素材/),
  ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(scene).getByRole("button", { name: "尝试搜索公共素材" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "search", sceneId: "scene-1" });
  expect(within(scene).queryByRole("button", { name: /确认采用/ })).not.toBeInTheDocument();
});

it("shows scene source actions on a real director draft that already has mapped segments", () => {
  const onSceneSourceAction = vi.fn();
  const product = {
    ...draft(),
    contentType: "video_script",
    segments: [{ id: "scene-1", index: 1, title: "早餐过渡", isFallback: false }],
  };
  render(<ProductPreview product={product} onSceneSourceAction={onSceneSourceAction} />);
  expect(screen.getByRole("button", { name: "尝试搜索公共素材" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "尝试搜索公共素材" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "search", sceneId: "scene-1" });
});

it("shows verified candidate separately from the request and binds selection to its opaque ID", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft("awaiting_candidate_selection", {
    candidate_id: "safe-id", title: "早餐街景", preview_url: "https://example.com/preview.jpg",
    provider: "Pexels", license: "Pexels License", attribution_url: "https://example.com/source",
  })} onSceneSourceAction={onSceneSourceAction} />);
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  expect(within(scene).getByText(/候选待确认/)).toBeInTheDocument();
  expect(within(scene).getByText(/Pexels License/)).toBeInTheDocument();
  fireEvent.click(within(scene).getByRole("button", { name: "确认采用这项素材" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "select", sceneId: "scene-1", candidateId: "safe-id" });
});

it("keeps the original scene on a declined recommendation", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft("declined")} onSceneSourceAction={onSceneSourceAction} />);
  expect(screen.getByText("已保留原方案")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认采用这项素材" })).not.toBeInTheDocument();
});

it("offers scene-bound alternatives after a completed search found no candidate", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft("no_candidate")} onSceneSourceAction={onSceneSourceAction} />);
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  expect(within(scene).getByText(/本次搜索无合格公共素材/)).toBeInTheDocument();
  expect(within(scene).queryByRole("button", { name: /继续搜索公共素材/ })).not.toBeInTheDocument();
  for (const [label, kind] of [
    ["生成图片", "generate_image"],
    ["上传素材", "upload_asset"],
    ["选择项目图片", "choose_asset"],
    ["修改本镜画面", "revise_scene"],
  ] as const) {
    fireEvent.click(within(scene).getByRole("button", { name: label }));
    expect(onSceneSourceAction).toHaveBeenCalledWith({ kind, sceneId: "scene-1" });
  }
  fireEvent.click(within(scene).getByRole("button", { name: "保留当前方案" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "keep", sceneId: "scene-1" });
});

it("lets the user choose their own image before any public search", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft()} onSceneSourceAction={onSceneSourceAction} />);
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  fireEvent.click(within(scene).getByRole("button", { name: "选择项目图片" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "choose_asset", sceneId: "scene-1" });
});

it("keeps local image replacement available after a source was already chosen", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview product={draft("alternative_applied")} onSceneSourceAction={onSceneSourceAction} />);
  const scene = screen.getByRole("listitem", { name: /早餐过渡/ });
  expect(within(scene).getByText(/已采用所选图片/)).toBeInTheDocument();
  fireEvent.click(within(scene).getByRole("button", { name: "选择项目图片" }));
  expect(onSceneSourceAction).toHaveBeenCalledWith({ kind: "choose_asset", sceneId: "scene-1" });
});

it("shows the exact running stage and leaves adoption unavailable while search is pending", () => {
  const onSceneSourceAction = vi.fn();
  render(<ProductPreview
    product={draft("search_requested")}
    onSceneSourceAction={onSceneSourceAction}
    sceneSourceProgress={{ sceneId: "scene-1", stage: "正在规划搜索词并核验素材候选，已等待 15 秒" }}
  />);
  expect(screen.getByRole("status")).toHaveTextContent("已等待 15 秒");
  expect(screen.getByRole("button", { name: "继续搜索公共素材" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "确认采用这项素材" })).not.toBeInTheDocument();
});
