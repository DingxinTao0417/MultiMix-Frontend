// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneratedImageGallery, { GeneratedImageKeyframeGroup } from "../components/generated-image-gallery";
afterEach(cleanup);

describe("generated image gallery", () => {
  it("shows all frames and switches the full-size preview", () => {
    render(<GeneratedImageGallery images={[1, 2, 3, 4, 5].map((n) => ({
      frame_id: `F0${n}`, intent: `镜头${n}`, review_status: "unreviewed",
      storage_ref: `local://content-assets/1/generation-jobs/2/images/${String(n).repeat(64)}.png`,
    }))} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "查看 F05 镜头5" }));
    expect(screen.getByRole("img", { name: "F05 镜头5 大图" }).getAttribute("src")).toContain("555555");
    expect(screen.getAllByText(/待人工检查/).length).toBeGreaterThan(0);
  });
  it("does not render an arbitrary storage path", () => {
    render(<GeneratedImageGallery images={[{ frame_id: "F01", intent: "test", storage_ref: "local://secrets.txt" }]} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("shows a specific failed check without claiming commercial acceptance", () => {
    render(<GeneratedImageGallery images={[{ frame_id: "F01", intent: "展示", review_status: "flagged",
      storage_ref: `local://content-assets/1/generation-jobs/2/images/${"a".repeat(64)}.png`,
      quality_review: { status: "flagged", checks: { quantity: { status: "mismatch", evidence: "多了一个盖子。" } } },
    }]} />);
    expect(screen.getByText("数量：多了一个盖子。")).toBeTruthy();
    expect(screen.getAllByText(/需调整/).length).toBeGreaterThan(0);
    expect(screen.queryByText("商业验收通过")).toBeNull();
  });
  it("uses a controlled selected frame and keeps the review rail visible without findings", () => {
    const onSelectedFrameChange = vi.fn();
    render(<GeneratedImageGallery images={[1, 2].map((n) => ({
      frame_id: `F0${n}`, intent: `镜头${n}`, review_status: "no_issue_detected",
      storage_ref: `local://content-assets/1/generation-jobs/2/images/${String(n).repeat(64)}.png`,
    }))} selectedFrameId="F02" onSelectedFrameChange={onSelectedFrameChange} />);

    expect(screen.getByRole("img", { name: "F02 镜头2 大图" })).toBeTruthy();
    expect(screen.getByLabelText("图片检查结果").textContent).toContain("未发现关键差异");
    fireEvent.click(screen.getByRole("button", { name: "查看 F01 镜头1" }));
    expect(onSelectedFrameChange).toHaveBeenCalledWith("F01");
  });
  it("renders every generated keyframe inside the conversation group", () => {
    const onSelect = vi.fn();
    render(<GeneratedImageKeyframeGroup
      title="产品关键帧"
      images={[1, 2, 3].map((n) => ({
        frame_id: `F0${n}`, intent: `镜头${n}`, review_status: n === 2 ? "flagged" : "no_issue_detected",
        storage_ref: `local://content-assets/1/generation-jobs/2/images/${String(n).repeat(64)}.png`,
      }))}
      selectedFrameId="F02"
      onSelectedFrameChange={onSelect}
    />);

    expect(screen.getByLabelText("产品关键帧关键帧组").textContent).toContain("3 张关键帧");
    expect(screen.getByRole("button", { name: "查看 F03 镜头3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看 F03 镜头3" }));
    expect(onSelect).toHaveBeenCalledWith("F03");
  });
  it("keeps a generated candidate unselected until the user applies it to a scene", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<GeneratedImageGallery
      images={[{ frame_id: "F01", intent: "结构展示", review_status: "unreviewed",
        storage_ref: `local://content-assets/1/generation-jobs/2/images/${"c".repeat(64)}.png`,
      }]}
      candidateAssetId={201}
      candidateSetHash={"d".repeat(64)}
      target={{ kind: "director_scene", assetId: 91, versionId: 22, sceneIds: ["scene-2"] }}
      onApply={onApply}
    />);

    expect(screen.getByText("尚未应用到分镜")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "应用到分镜" }));
    expect(onApply).toHaveBeenCalledWith({
      candidateAssetId: 201,
      candidateSetHash: "d".repeat(64),
      target: { kind: "director_scene", assetId: 91, versionId: 22, sceneIds: ["scene-2"] },
    });
  });
  it("applies a complete keyframe set to its target scenes in order", async () => {
    const onApplySet = vi.fn().mockResolvedValue(undefined);
    render(<GeneratedImageGallery
      images={[1, 2].map((n) => ({
        frame_id: `F0${n}`,
        asset_id: 200 + n,
        intent: `镜头${n}`,
        storage_ref: `local://content-assets/1/generation-jobs/2/images/${String(n).repeat(64)}.png`,
      }))}
      candidateSetHash={"e".repeat(64)}
      target={{ kind: "director_scene", assetId: 91, versionId: 22, sceneIds: ["scene-1", "scene-2"] }}
      onApplySet={onApplySet}
    />);

    fireEvent.click(screen.getByRole("button", { name: "将 2 张分别用于 2 个分镜" }));
    expect(onApplySet).toHaveBeenCalledWith({
      candidateSetHash: "e".repeat(64),
      target: { kind: "director_scene", assetId: 91, versionId: 22, sceneIds: ["scene-1", "scene-2"] },
      assignments: [
        { candidateAssetId: 201, sceneId: "scene-1" },
        { candidateAssetId: 202, sceneId: "scene-2" },
      ],
    });
  });
});
