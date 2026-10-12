// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import { API_CONNECTION_ERROR } from "../../../lib/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// Three projects: two whose row shows an actionable state, one that does not.
const base = assetWorkspaceAdapter.getNewConversation();
const projects = [
  { ...base, id: "p-review", title: "待确认的项目", projectState: "script_review" as const, detailsLoaded: true, readonly: false },
  { ...base, id: "p-running", title: "生成中的项目", projectState: "generating" as const, detailsLoaded: true, readonly: false },
  { ...base, id: "p-ready", title: "已完成的项目", projectState: "ready" as const, detailsLoaded: true, readonly: false },
];

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/assets?conversation=p-ready");
  Object.defineProperty(window, "matchMedia", { configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "mergeConversationSummaries").mockImplementation((_summary, current) => current.length ? current : projects);
  vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
  vi.spyOn(assetWorkspaceAdapter, "loadCurrentRequirements").mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderWorkspace = () => render(
  <AssetsWorkspaceClient accountEmail="switcher@example.test" token="token" initialConversationId="p-ready" />,
);

it("shows the current project and counts projects that need attention", async () => {
  renderWorkspace();
  const switcher = await screen.findByRole("button", { name: /^切换项目或资源库/ }, { timeout: 5_000 });

  // On a project the header title already names it, so the switcher does not
  // repeat it visually; its accessible name still does.
  expect(switcher).not.toHaveTextContent("已完成的项目");
  expect(document.querySelector(".shadcn-prototype-chat-head > strong")).toHaveTextContent("已完成的项目");
  // Badge matches the rows that show 待确认 / 生成中 / 需处理; "ready" is not counted.
  expect(switcher).toHaveAccessibleName("切换项目或资源库，当前：已完成的项目，2 个项目需要处理");
  expect(switcher).toHaveTextContent("2");
});

it("keeps no persistent sidebar: navigation exists only while the panel is open", async () => {
  renderWorkspace();
  const switcher = await screen.findByRole("button", { name: /^切换项目或资源库/ }, { timeout: 5_000 });
  expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "资源库" })).not.toBeInTheDocument();

  fireEvent.click(switcher);
  const panel = await screen.findByRole("dialog", { name: "工作台导航" });
  expect(within(panel).getByRole("navigation", { name: "资源库" })).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "新建项目" })).toBeInTheDocument();
  expect(switcher).toHaveAttribute("aria-expanded", "true");
});

it.each([
  ["Ctrl+K", { ctrlKey: true }],
  ["⌘K", { metaKey: true }],
])("opens the same panel with %s and returns focus on Escape", async (_label, modifier) => {
  renderWorkspace();
  const switcher = await screen.findByRole("button", { name: /^切换项目或资源库/ }, { timeout: 5_000 });
  switcher.focus();

  fireEvent.keyDown(window, { key: "k", ...modifier });
  const panel = await screen.findByRole("dialog", { name: "工作台导航" });
  await waitFor(() => expect(within(panel).getByRole("searchbox", { name: "搜索项目" })).toHaveFocus());

  fireEvent.keyDown(panel, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument());
  await waitFor(() => expect(switcher).toHaveFocus());
});

it("keeps a project-list load failure visible and recoverable while the panel is closed", async () => {
  // Real list merging and no preselected project, as in the existing
  // runtime-availability recovery test; only the first list load fails.
  vi.mocked(assetWorkspaceAdapter.mergeConversationSummaries).mockRestore();
  const load = vi.mocked(assetWorkspaceAdapter.loadConversationSummaries)
    .mockRejectedValueOnce(new Error(API_CONNECTION_ERROR))
    .mockResolvedValueOnce([]);
  window.history.replaceState(null, "", "/app/assets");
  render(<AssetsWorkspaceClient basePath="/app/assets" accountEmail="switcher@example.test" token="token" />);

  const failure = (await screen.findByText("项目加载失败", {}, { timeout: 5_000 })).closest("[role=alert]") as HTMLElement;
  expect(failure).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument();

  fireEvent.click(within(failure).getByRole("button", { name: "重新加载" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("项目加载失败")).not.toBeInTheDocument());
}, 15_000);
