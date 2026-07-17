// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BgmPanel from "../BgmPanel";

const catalog = {
  catalog_version: "v1",
  current_choice: {
    enabled: true,
    catalog_id: "bgm-tech-01",
    alternate_ids: ["bgm-fun-01"],
    selection_reason: "科技感与产品演示节奏匹配。",
    alternate_reasons: { "bgm-fun-01": "更轻松的备选。" },
    catalog_version: "v1",
    selected_by: "auto",
    locked_by_user: false,
  },
  recommended_ids: ["bgm-tech-01", "bgm-fun-01"],
  tracks: [
    {
      id: "bgm-tech-01",
      title: "科技脉冲",
      artist: "MultiMix",
      provider: "CC0",
      category: "科技现代",
      mood_tags: ["现代", "清晰"],
      duration_seconds: 32,
      preview_url: "https://preview.test/tech",
      match_reason: "科技感与产品演示节奏匹配。",
    },
    {
      id: "bgm-fun-01",
      title: "轻松一步",
      artist: "MultiMix",
      provider: "Mixkit",
      category: "轻松趣味",
      mood_tags: ["轻松"],
      duration_seconds: 18,
      preview_url: "https://preview.test/fun",
      match_reason: "更轻松的备选。",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return jsonResponse({
        catalog_version: "v1",
        choice: { ...catalog.current_choice, catalog_id: "bgm-fun-01", locked_by_user: true },
        project: { metadata: { title: "Updated", duration: 30 }, settings: {}, media: [], tracks: [] },
      });
    }
    return jsonResponse(catalog);
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BgmPanel", () => {
  it("shows the current AI choice and all six music categories", async () => {
    render(
      <BgmPanel
        assetId="12"
        token="token"
        onPrepareChange={vi.fn()}
        onProjectChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("背景音乐")).toBeInTheDocument();
    for (const label of [
      "AI 推荐",
      "全部音乐",
      "商务稳重",
      "轻快活力",
      "温暖生活",
      "科技现代",
      "情绪叙事",
      "轻松趣味",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("科技脉冲")).toHaveAttribute("data-current", "true");
    expect(screen.getByText("科技感与产品演示节奏匹配。")).toBeInTheDocument();
    expect(screen.getByText(/CC0/)).toBeInTheDocument();
  });

  it("saves the current timeline before switching and keeps the editor unchanged on failure", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const changed = vi.fn();
    vi.mocked(fetch).mockImplementation(async (_input, init) => (
      init?.method === "PUT"
        ? jsonResponse({ detail: "failed" }, 500)
        : jsonResponse(catalog)
    ));
    render(
      <BgmPanel
        assetId="12"
        token="token"
        onPrepareChange={prepare}
        onProjectChanged={changed}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "选择 轻松一步" }));

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(changed).not.toHaveBeenCalled();
    expect(await screen.findByText(/更换失败/)).toBeInTheDocument();
    expect(screen.getByText("科技脉冲")).toHaveAttribute("data-current", "true");
  });

  it("supports no music and restoring the automatic recommendation", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const changed = vi.fn().mockResolvedValue(undefined);
    render(
      <BgmPanel
        assetId="12"
        token="token"
        onPrepareChange={prepare}
        onProjectChanged={changed}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "无配乐" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/bgm"),
      expect.objectContaining({ method: "PUT", body: expect.stringContaining('"action":"disable"') }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "恢复 AI 推荐" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/bgm"),
      expect.objectContaining({ method: "PUT", body: expect.stringContaining('"action":"restore_auto"') }),
    ));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("plays only one signed preview at a time and exposes no download link", async () => {
    const instances: Array<{ pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }> = [];
    class PreviewAudio {
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      constructor(_url: string) {
        void _url;
        instances.push(this);
      }
      addEventListener() {}
    }
    vi.stubGlobal("Audio", PreviewAudio);
    render(
      <BgmPanel
        assetId="12"
        token="token"
        onPrepareChange={vi.fn()}
        onProjectChanged={vi.fn()}
      />,
    );

    const firstCard = (await screen.findByText("科技脉冲")).closest("article");
    const secondCard = screen.getByText("轻松一步").closest("article");
    fireEvent.click(within(firstCard!).getByRole("button", { name: "试听" }));
    fireEvent.click(within(secondCard!).getByRole("button", { name: "试听" }));

    expect(instances).toHaveLength(2);
    expect(instances[0].pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
