// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";

const frames = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../lib/video-thumbnail", () => ({ readVideoThumbnail: frames.read }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); frames.read.mockReset(); });

function asset(id: number, status?: string) {
  return { id, user_id: 1, title: `视频${id}`, body: "", asset_kind: "video", library_kind: "video",
    content_type: status ? "video_project" : "uploaded_video", source_type: "conversation",
    status: status === "failed" ? "failed" : "ready", product_status: status,
    metadata: {}, versions: [], source_mapping: [], created_at: "2026-10-09", updated_at: "2026-10-09" };
}
function response(payload: unknown) { return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }); }

describe("library video eligibility", () => {
  it("lists only completed projects while keeping uploaded video even if understanding failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([
      asset(1, "failed"), asset(2, "generating"), asset(3, "completed"),
      { ...asset(4), status: "failed", metadata: { understanding: { status: "failed" } } },
      { ...asset(5), content_type: "video_script" },
    ])));
    const page = await assetWorkspaceAdapter.listLibrary("eligibility", "video");
    expect(page.rows.map((r) => r.assetId)).toEqual([3, 4]);
  });
  it("applies the same boundary to keyword and semantic search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response([
      { asset: asset(1, "failed"), score: 10, matched_fields: ["title"] },
      { asset: asset(2, "generating"), score: 9, matched_fields: ["title"] },
      { asset: asset(3, "completed"), score: 8, matched_fields: ["title"] },
    ])));
    const page = await assetWorkspaceAdapter.listLibrary("search-eligibility", "video", "视频");
    expect(page.rows.map((r) => r.assetId)).toEqual([3]);
  });
  it("skips excluded pages without losing the original pagination offset", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response([
      asset(1, "failed"), asset(2, "generating"), asset(3, "completed"),
    ])).mockResolvedValueOnce(response([asset(3, "completed"), asset(4, "completed"), asset(5)]));
    vi.stubGlobal("fetch", fetchMock);
    const page = await assetWorkspaceAdapter.listLibrary("page-eligibility", "video", "", { limit: 2 });
    expect(page.rows.map((r) => r.assetId)).toEqual([3, 4]);
    expect(page.nextOffset).toBe(4);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("offset")).toBe("2");
  });
  it.each([
    { poster_ref: "supabase://media/poster.jpg" },
    { video_project: { poster_ref: "supabase://media/poster.jpg" } },
  ])("reads an existing poster reference without a video request", async (metadata) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ ...asset(1), metadata }])));
    const page = await assetWorkspaceAdapter.listLibrary("poster", "video");
    expect(page.rows[0]?.thumbnailUrl).toContain("ref=supabase%3A%2F%2Fmedia%2Fposter.jpg");
  });
});

describe("public video media addresses", () => {
  async function row(overrides: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ ...asset(901), content_type: "public_video",
      source_type: "public_source", original_ref: "supabase://assets/imported.mp4",
      metadata: { workflow: "public_material_import", preview_url: "https://media.example/poster.jpg",
        download_url: "https://media.example/download.mp4" }, ...overrides }])));
    return (await assetWorkspaceAdapter.listLibrary("public-video-addresses", "video")).rows[0]!;
  }
  it("plays the saved public video and reads its provider preview as a poster", async () => {
    const result = await row({});
    expect(result.previewUrl).toContain("ref=supabase%3A%2F%2Fassets%2Fimported.mp4");
    expect(result.thumbnailUrl).toBe("https://media.example/poster.jpg");
  });
  it("uses the direct video address when no saved original exists", async () => {
    expect((await row({ original_ref: null })).previewUrl).toBe("https://media.example/download.mp4");
  });
  it("does not treat a poster or landing page as a video when no video exists", async () => {
    const result = await row({ original_ref: null, metadata: { workflow: "public_material_import",
      preview_url: "https://media.example/poster.jpg", source_url: "https://provider.example/video/901" } });
    expect(result.previewUrl).toBeUndefined();
    expect(result.thumbnailUrl).toBe("https://media.example/poster.jpg");
  });
  it("preserves explicit posters, uploaded playback and completed project playback", async () => {
    expect((await row({ metadata: { workflow: "public_material_import", poster_ref: "supabase://assets/poster.jpg",
      preview_url: "https://media.example/provider.jpg", download_url: "https://media.example/download.mp4" } })).thumbnailUrl)
      .toContain("ref=supabase%3A%2F%2Fassets%2Fposter.jpg");
    expect((await row({ content_type: "uploaded_video", source_type: "upload", metadata: { preview_url: "https://media.example/upload.mp4" } })).previewUrl)
      .toBe("https://media.example/upload.mp4");
    expect((await row({ content_type: "video_project", product_status: "completed", metadata: { video_project: { mp4_ref: "supabase://assets/rendered.mp4" } } })).previewUrl)
      .toContain("ref=supabase%3A%2F%2Fassets%2Frendered.mp4");
  });
});

const video: LibraryRow = { assetId: 1, title: "原视频", kind: "video", meta: "", note: "",
  previewUrl: "https://media.example/clip.mp4", mediaAvailability: "available" };

describe("real video thumbnails", () => {
  function setup(row: LibraryRow) {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [row], nextOffset: null });
    return render(<LibraryWorkshop view="video" token={`thumb-${Math.random()}`} />);
  }
  it("reads a real frame for a legacy video without a stored poster", async () => {
    frames.read.mockResolvedValue("data:image/jpeg;base64,real-frame");
    setup(video);
    const grid = await screen.findByLabelText("视频库列表");
    await waitFor(() => expect(grid.querySelector("img")).toHaveAttribute("src", "data:image/jpeg;base64,real-frame"));
    expect(frames.read).toHaveBeenCalledWith(video.previewUrl, expect.any(AbortSignal));
    expect(grid.querySelector("video")).toBeNull();
  });
  it("uses a stored poster without decoding the video", async () => {
    setup({ ...video, thumbnailUrl: "https://media.example/poster.jpg" });
    const grid = await screen.findByLabelText("视频库列表");
    expect(grid.querySelector("img")).toHaveAttribute("src", "https://media.example/poster.jpg");
    expect(frames.read).not.toHaveBeenCalled();
  });
  it("defers decoding until visible and cancels it on unmount", async () => {
    let visible!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { visible = callback; }
      observe() {}
      disconnect() {}
    });
    frames.read.mockReturnValue(new Promise(() => {}));
    const mounted = setup(video);
    await screen.findByLabelText("视频库列表");
    expect(frames.read).not.toHaveBeenCalled();
    act(() => visible([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.read).toHaveBeenCalledTimes(1);
    const signal = frames.read.mock.calls[0][1] as AbortSignal;
    mounted.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("replaces an expired poster with a frame from the same video", async () => {
    frames.read.mockResolvedValue("data:image/jpeg;base64,recovered");
    setup({ ...video, thumbnailUrl: "https://media.example/expired.jpg" });
    const grid = await screen.findByLabelText("视频库列表");
    fireEvent.error(grid.querySelector("img")!);
    await waitFor(() => expect(grid.querySelector("img")).toHaveAttribute("src", "data:image/jpeg;base64,recovered"));
  });
  it("shows an honest unavailable label if decoding fails", async () => {
    frames.read.mockRejectedValue(new Error("Cannot decode"));
    setup(video);
    await screen.findByLabelText("视频库列表");
    expect(await screen.findByText("封面暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("视频预览")).not.toBeInTheDocument();
  });
});

it("keeps square image frames independent of intrinsic image size and row stretching", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  expect(css).toMatch(/\.shadcn-prototype-library-grid\s*\{[^}]*align-items:\s*start;/s);
  expect(css).toMatch(/\.shadcn-prototype-library-media-card\.with-image-media \.shadcn-prototype-library-media-frame\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1;/s);
  expect(css).toMatch(/\.shadcn-prototype-library-media-thumb img,[^}]*\{[^}]*position:\s*absolute;/s);
});
