// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import CreativeMemoryPrompt from "../components/creative-memory-prompt";
import * as memoryApi from "../lib/creative-memory-api";

vi.mock("../lib/creative-memory-api", () => ({
  getCreativeCandidates: vi.fn(),
  getCreativeProfile: vi.fn(),
  resolveCreativeCandidates: vi.fn(),
  patchCreativeProfile: vi.fn(),
}));

const candidates = [
  { id: 11, kind: "audience" as const, value: "附近喜欢烘焙的人", source_event_refs: [4], expires_at: "2026-10-01" },
  { id: 12, kind: "avoid" as const, value: "夸张标题", source_event_refs: [5], expires_at: "2026-10-01" },
];

const profile = {
  schema_version: "user_creative_memory:v1" as const,
  revision: 0, enabled: true, candidate_prompt_mode: "normal" as const,
  dismissal_streak: 0, profile: { items: [] }, updated_at: null,
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("does not query candidates before the video is publicly completed", () => {
  render(<CreativeMemoryPrompt token="token" assetId={7} completed={false} />);
  expect(memoryApi.getCreativeCandidates).not.toHaveBeenCalled();
  expect(screen.queryByText("保存到创作档案")).not.toBeInTheDocument();
});

it("saves only selected candidates and dismisses the rest with their IDs", async () => {
  vi.mocked(memoryApi.getCreativeCandidates).mockResolvedValue({ status: "ready", batch_id: 3, candidates });
  vi.mocked(memoryApi.getCreativeProfile).mockResolvedValue(profile);
  vi.mocked(memoryApi.resolveCreativeCandidates).mockResolvedValue({ ...profile, revision: 1 });

  render(<CreativeMemoryPrompt token="token" assetId={7} completed />);
  expect(await screen.findByText("附近喜欢烘焙的人")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "保存附近喜欢烘焙的人" }));
  fireEvent.click(screen.getByRole("button", { name: "保存 1 项" }));

  await waitFor(() => expect(memoryApi.resolveCreativeCandidates).toHaveBeenCalledWith(
    "token",
    expect.objectContaining({
      expected_revision: 0,
      decisions: [
        { candidate_id: 11, action: "accepted" },
        { candidate_id: 12, action: "dismissed" },
      ],
    }),
  ));
  expect(screen.queryByText("附近喜欢烘焙的人")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("已保存到创作档案 · 1 项");
});

it("offers an explicit frequency choice after the second dismissal", async () => {
  vi.mocked(memoryApi.getCreativeCandidates).mockResolvedValue({ status: "ready", batch_id: 3, candidates });
  vi.mocked(memoryApi.getCreativeProfile).mockResolvedValue({ ...profile, revision: 1, dismissal_streak: 1 });
  vi.mocked(memoryApi.resolveCreativeCandidates).mockResolvedValue({ ...profile, revision: 2, dismissal_streak: 2 });
  vi.mocked(memoryApi.patchCreativeProfile).mockResolvedValue({
    ...profile, revision: 3, candidate_prompt_mode: "reduced", dismissal_streak: 2,
  });

  render(<CreativeMemoryPrompt token="token" assetId={7} completed />);
  fireEvent.click(await screen.findByRole("button", { name: "这次先不处理" }));
  expect(await screen.findByText("想减少这类提醒吗？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "降低提醒频率" }));
  await waitFor(() => expect(memoryApi.patchCreativeProfile).toHaveBeenCalledWith(
    "token", { expected_revision: 2, candidate_prompt_mode: "reduced" },
  ));
});

it("stays silent for no-candidate and failed terminal batches", async () => {
  vi.mocked(memoryApi.getCreativeCandidates).mockResolvedValue({
    status: "no_candidates", batch_id: 3, candidates: [],
  });
  render(<CreativeMemoryPrompt token="token" assetId={7} completed />);
  await waitFor(() => expect(memoryApi.getCreativeCandidates).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("region", { name: "保存创作偏好" })).not.toBeInTheDocument();
});

it("bounds queued polling and never creates an empty confirmation", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(memoryApi.getCreativeCandidates).mockResolvedValue({
      status: "queued", batch_id: 3, candidates: [],
    });
    render(<CreativeMemoryPrompt token="token" assetId={7} completed />);
    await act(async () => { await Promise.resolve(); });
    for (let step = 0; step < 8; step += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    }
    expect(memoryApi.getCreativeCandidates).toHaveBeenCalledTimes(6);
    expect(screen.queryByRole("region", { name: "保存创作偏好" })).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("reloads the profile revision after a structured conflict", async () => {
  vi.mocked(memoryApi.getCreativeCandidates).mockResolvedValue({ status: "ready", batch_id: 3, candidates });
  vi.mocked(memoryApi.getCreativeProfile)
    .mockResolvedValueOnce(profile)
    .mockResolvedValue({ ...profile, revision: 1 });
  vi.mocked(memoryApi.resolveCreativeCandidates)
    .mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }))
    .mockResolvedValue({ ...profile, revision: 2 });

  render(<CreativeMemoryPrompt token="token" assetId={7} completed />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "保存附近喜欢烘焙的人" }));
  fireEvent.click(screen.getByRole("button", { name: "保存 1 项" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("档案有更新");
  fireEvent.click(screen.getByRole("button", { name: "保存 1 项" }));
  await waitFor(() => expect(memoryApi.resolveCreativeCandidates).toHaveBeenLastCalledWith(
    "token", expect.objectContaining({ expected_revision: 1 }),
  ));
});
