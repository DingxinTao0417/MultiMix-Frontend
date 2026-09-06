// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneratedImageGallery from "../components/generated-image-gallery";
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
    expect(screen.getByText(/待检查商品细节/)).toBeTruthy();
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
    expect(screen.getAllByText(/发现问题/).length).toBeGreaterThan(0);
    expect(screen.queryByText("商业验收通过")).toBeNull();
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
});
