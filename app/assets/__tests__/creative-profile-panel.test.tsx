// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreativeProfilePanel from "../components/creative-profile-panel";
import * as profileApi from "../lib/creative-memory-api";

vi.mock("../lib/creative-memory-api", () => ({
  getCreativeProfile: vi.fn(),
  patchCreativeProfile: vi.fn(),
  deleteCreativeProfileItem: vi.fn(),
  clearCreativeProfile: vi.fn(),
  getCreativeSuppressions: vi.fn(),
  restoreCreativeSuppression: vi.fn(),
}));

const empty = {
  schema_version: "user_creative_memory:v1" as const,
  revision: 0,
  enabled: true,
  candidate_prompt_mode: "normal" as const,
  profile: { items: [] },
  updated_at: null,
};
const item = {
  id: "mem_1",
  kind: "avoid" as const,
  key: null,
  value: "夸张标题",
  source: { type: "manual" as const, reference_id: null },
  fingerprint: "sha256:one",
  updated_at: "2026-09-17T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(profileApi.getCreativeProfile).mockResolvedValue(empty);
  vi.mocked(profileApi.getCreativeSuppressions).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("CreativeProfilePanel", () => {
  it("explains the empty state and saves only after a typed manual action", async () => {
    vi.mocked(profileApi.patchCreativeProfile).mockResolvedValue({
      ...empty,
      revision: 1,
      profile: { items: [item] },
    });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    expect(await screen.findByText(/完成视频后，MultiMix 会把可能长期有用的偏好交给你确认/)).toBeInTheDocument();
    expect(profileApi.patchCreativeProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "手动添加" }));
    fireEvent.change(screen.getByLabelText("类别"), { target: { value: "avoid" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "夸张标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到创作档案" }));

    await waitFor(() => expect(profileApi.patchCreativeProfile).toHaveBeenCalledWith("test-token", {
      expected_revision: 0,
      upsert_items: [{ kind: "avoid", key: null, value: "夸张标题" }],
    }));
    expect(await screen.findByText("夸张标题")).toBeInTheDocument();
  });

  it("keeps ordinary deletion distinct from do-not-suggest and supports restore", async () => {
    vi.mocked(profileApi.getCreativeProfile).mockResolvedValue({
      ...empty, revision: 1, profile: { items: [item] },
    });
    vi.mocked(profileApi.deleteCreativeProfileItem).mockResolvedValue({
      ...empty, revision: 2,
    });
    vi.mocked(profileApi.getCreativeSuppressions).mockResolvedValue([
      { id: 7, kind: "avoid", value: "夸张标题", fingerprint: item.fingerprint, created_at: item.updated_at },
    ]);
    vi.mocked(profileApi.restoreCreativeSuppression).mockResolvedValue({ ...empty, revision: 3 });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除夸张标题" }));
    fireEvent.click(screen.getByRole("button", { name: "仅删除" }));
    await waitFor(() => expect(profileApi.deleteCreativeProfileItem).toHaveBeenCalledWith(
      "test-token", "mem_1", { expected_revision: 1, suppress_future_suggestions: false },
    ));
    fireEvent.click(screen.getByRole("button", { name: "已忽略建议" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复夸张标题" }));
    await waitFor(() => expect(profileApi.restoreCreativeSuppression).toHaveBeenCalledWith(
      "test-token", 7, { expected_revision: 2 },
    ));
  });

  it("edits a saved video candidate by stable item ID", async () => {
    const candidateItem = {
      ...item,
      source: { type: "confirmed_candidate" as const, reference_id: 7 },
    };
    vi.mocked(profileApi.getCreativeProfile).mockResolvedValue({
      ...empty, revision: 2, profile: { items: [candidateItem] },
    });
    vi.mocked(profileApi.patchCreativeProfile).mockResolvedValue({
      ...empty, revision: 3, profile: { items: [{ ...candidateItem, value: "避免耸动标题" }] },
    });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑夸张标题" }));
    expect(screen.getByText("编辑条目")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "避免耸动标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到创作档案" }));

    await waitFor(() => expect(profileApi.patchCreativeProfile).toHaveBeenCalledWith("test-token", {
      expected_revision: 2,
      upsert_items: [{ id: "mem_1", kind: "avoid", key: null, value: "避免耸动标题" }],
    }));
    expect(await screen.findByText("避免耸动标题")).toBeInTheDocument();
  });

  it("keeps disabling future use separate from saved entries", async () => {
    vi.mocked(profileApi.getCreativeProfile).mockResolvedValue({
      ...empty, revision: 1, profile: { items: [item] },
    });
    vi.mocked(profileApi.patchCreativeProfile).mockResolvedValue({
      ...empty, revision: 2, enabled: false, profile: { items: [item] },
    });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "在新视频中使用创作档案" }));
    await waitFor(() => expect(profileApi.patchCreativeProfile).toHaveBeenCalledWith("test-token", {
      expected_revision: 1,
      enabled: false,
    }));
    expect(screen.getByText("夸张标题")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "在新视频中使用创作档案" })).not.toBeChecked();
  });

  it("requires explicit confirmation for suppression and full clear", async () => {
    vi.mocked(profileApi.getCreativeProfile).mockResolvedValue({
      ...empty, revision: 1, profile: { items: [item] },
    });
    vi.mocked(profileApi.deleteCreativeProfileItem).mockResolvedValue({
      ...empty, revision: 2, profile: { items: [item] },
    });
    vi.mocked(profileApi.clearCreativeProfile).mockResolvedValue({
      ...empty, revision: 3,
    });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除夸张标题" }));
    expect(profileApi.deleteCreativeProfileItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除且不再建议" }));
    await waitFor(() => expect(profileApi.deleteCreativeProfileItem).toHaveBeenCalledWith(
      "test-token", "mem_1", { expected_revision: 1, suppress_future_suggestions: true },
    ));
    fireEvent.click(screen.getByRole("button", { name: "清空档案" }));
    expect(profileApi.clearCreativeProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "删除且不再建议这些内容" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(profileApi.clearCreativeProfile).toHaveBeenCalledWith("test-token", {
      expected_revision: 2,
      suppress_future_suggestions: true,
    }));
  });

  it("reloads after revision conflict without claiming an item was saved", async () => {
    vi.mocked(profileApi.patchCreativeProfile).mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动添加" }));
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "家庭烘焙" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到创作档案" }));

    expect(await screen.findByText("档案已在别处更新，请检查后重试。")).toBeInTheDocument();
    expect(profileApi.getCreativeProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("家庭烘焙")).toBeInTheDocument();
  });

  it("keeps reminder preference separate from deleting saved items", async () => {
    vi.mocked(profileApi.getCreativeProfile).mockResolvedValue({
      ...empty, revision: 1, profile: { items: [item] },
    });
    vi.mocked(profileApi.patchCreativeProfile).mockResolvedValue({
      ...empty, revision: 2, candidate_prompt_mode: "off", profile: { items: [item] },
    });
    render(<CreativeProfilePanel token="test-token" onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("完成后提醒频率"), { target: { value: "off" } });
    await waitFor(() => expect(profileApi.patchCreativeProfile).toHaveBeenCalledWith("test-token", {
      expected_revision: 1,
      candidate_prompt_mode: "off",
    }));
    expect(screen.getByText("夸张标题")).toBeInTheDocument();
  });

  it("returns focus to the dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<CreativeProfilePanel token="test-token" onClose={onClose} />);

    expect(await screen.findByRole("button", { name: "关闭创作档案" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
