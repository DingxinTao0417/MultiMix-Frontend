// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import CreativeProfilePanel, { CreativeProjectUsage } from "../components/creative-profile-panel";
import ConversationStart from "../components/conversation-start";
import * as memoryApi from "../lib/creative-memory-api";
import type { Conversation } from "../lib/asset-workspace-shared";
import { DEFAULT_RUNTIME_WRITE_CAPABILITIES } from "../lib/runtime-write-capabilities";

vi.mock("../lib/creative-memory-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/creative-memory-api")>(),
  getCreativeProjectUsage: vi.fn(),
  setCreativeProjectUsage: vi.fn(),
  getCreativeProfile: vi.fn(),
  getCreativeSuppressions: vi.fn(),
  patchCreativeProfile: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("lets a user explicitly correct an item originally saved from a video", async () => {
  const item = {
    id: "mem_1", kind: "topic" as const, key: null, value: "家庭烘焙",
    source: { type: "confirmed_candidate" as const, reference_id: 7 },
    fingerprint: "sha256:one", updated_at: "2026-09-17T00:00:00Z",
  };
  vi.mocked(memoryApi.getCreativeProfile).mockResolvedValue({
    schema_version: "user_creative_memory:v1", revision: 1, enabled: true,
    candidate_prompt_mode: "normal", profile: { items: [item] }, updated_at: item.updated_at,
  });
  vi.mocked(memoryApi.getCreativeSuppressions).mockResolvedValue([]);
  vi.mocked(memoryApi.patchCreativeProfile).mockResolvedValue({
    schema_version: "user_creative_memory:v1", revision: 2, enabled: true,
    candidate_prompt_mode: "normal", profile: { items: [{
      ...item, value: "自然烘焙", source: { type: "manual", reference_id: null },
    }] }, updated_at: item.updated_at,
  });
  render(<CreativeProfilePanel token="token" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑家庭烘焙" }));
  fireEvent.change(screen.getByLabelText("内容"), { target: { value: "自然烘焙" } });
  fireEvent.click(screen.getByRole("button", { name: "保存到创作档案" }));
  await waitFor(() => expect(memoryApi.patchCreativeProfile).toHaveBeenCalledWith("token", {
    expected_revision: 1,
    upsert_items: [{ id: "mem_1", kind: "topic", key: null, value: "自然烘焙" }],
  }));
});

it("offers the project opt-out before the first video message", () => {
  const onIgnoreProfileChange = vi.fn();
  const onSend = vi.fn();
  render(<ConversationStart
    suggestions={[]}
    conversation={{ id: "new" } as Conversation}
    accountName="测试用户"
    token="token"
    creativeProfileVisible
    onSend={onSend}
    ignoreProfile={false}
    onIgnoreProfileChange={onIgnoreProfileChange}
    writeCapabilities={DEFAULT_RUNTIME_WRITE_CAPABILITIES}
  />);
  fireEvent.click(screen.getByRole("checkbox", { name: "本项目不使用创作档案" }));
  expect(onIgnoreProfileChange).toHaveBeenCalledWith(true);
  expect(onSend).not.toHaveBeenCalled();
});

it("hides the project profile switch outside the visible rollout", () => {
  render(<ConversationStart
    suggestions={[]}
    conversation={{ id: "new" } as Conversation}
    token="token"
    creativeProfileVisible={false}
    ignoreProfile={false}
    onIgnoreProfileChange={vi.fn()}
    writeCapabilities={DEFAULT_RUNTIME_WRITE_CAPABILITIES}
  />);
  expect(screen.queryByRole("checkbox", { name: "本项目不使用创作档案" })).not.toBeInTheDocument();
});

it("shows only the frozen items and makes project opt-out a typed action", async () => {
  const snapshot = {
    schema_version: "project_creative_memory_snapshot:v1" as const,
    memory_revision: 3,
    selected_items: [{ id: "mem_1", kind: "topic" as const, key: null, value: "家庭烘焙" }],
  };
  vi.mocked(memoryApi.getCreativeProjectUsage).mockResolvedValue({ ignoreProfile: false, snapshot });
  vi.mocked(memoryApi.setCreativeProjectUsage).mockResolvedValue({ ignoreProfile: true, snapshot });

  render(<CreativeProjectUsage token="token" conversationId="project-1" product={{ contentType: "video_script", metadata: { creative_brief: { creative_memory_snapshot: snapshot } } }} />);
  expect(await screen.findByText("本次使用创作档案 · 1 项")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "本次使用创作档案 · 1 项" }));
  expect(screen.getByText("家庭烘焙")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "本项目不使用创作档案" }));
  await waitFor(() => expect(memoryApi.setCreativeProjectUsage).toHaveBeenCalledWith("token", "project-1", true));
  expect(screen.getByText(/只影响之后开始的新视频/)).toBeInTheDocument();
  expect(screen.getByText("家庭烘焙")).toBeInTheDocument();
});

it("shows the selected work's own snapshot rather than the conversation's latest snapshot", async () => {
  const latest = {
    schema_version: "project_creative_memory_snapshot:v1" as const,
    memory_revision: 4,
    selected_items: [{ id: "latest", kind: "topic" as const, key: null, value: "最新档案" }],
  };
  const earlier = {
    ...latest,
    memory_revision: 2,
    selected_items: [{ id: "earlier", kind: "topic" as const, key: null, value: "旧版档案" }],
  };
  vi.mocked(memoryApi.getCreativeProjectUsage).mockResolvedValue({ ignoreProfile: false, snapshot: latest });
  const { rerender } = render(<CreativeProjectUsage token="token" conversationId="project-1" product={{ contentType: "video_script", metadata: { creative_brief: { creative_memory_snapshot: earlier } } }} />);
  fireEvent.click(await screen.findByRole("button", { name: "本次使用创作档案 · 1 项" }));
  expect(screen.getByText("旧版档案")).toBeInTheDocument();
  expect(screen.queryByText("最新档案")).not.toBeInTheDocument();

  rerender(<CreativeProjectUsage token="token" conversationId="project-1" product={{ contentType: "video_project", metadata: { video_plan: { material_policy: { creative_brief: { creative_memory_snapshot: latest } } } } }} />);
  expect(screen.getByText("最新档案")).toBeInTheDocument();
  expect(screen.queryByText("旧版档案")).not.toBeInTheDocument();

  rerender(<CreativeProjectUsage token="token" conversationId="project-1" product={{ contentType: "video_script", metadata: {} }} />);
  expect(screen.getByRole("button", { name: "本作品未使用创作档案" })).toBeInTheDocument();
  expect(screen.queryByText("最新档案")).not.toBeInTheDocument();
});

it("distinguishes a frozen empty snapshot from historical work without one", async () => {
  vi.mocked(memoryApi.getCreativeProjectUsage).mockResolvedValue({ ignoreProfile: false, snapshot: null });
  render(<CreativeProjectUsage token="token" conversationId="project-1" product={{ contentType: "video_script", metadata: { creative_brief: { creative_memory_snapshot: { schema_version: "project_creative_memory_snapshot:v1", memory_revision: 1, selected_items: [] } } } }} />);
  expect(await screen.findByRole("button", { name: "本次使用创作档案 · 0 项" })).toBeInTheDocument();
});
