// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportFinalizeJob } from "../video-export-client";
import EditorView from "../EditorView";

const mocks = vi.hoisted(() => ({
  getCurrent: vi.fn(), wait: vi.fn(), retry: vi.fn(), upload: vi.fn(),
  serialize: vi.fn(), init: vi.fn(), inspect: vi.fn(), render: vi.fn(), listeners: new Set<() => void>(),
}));
vi.mock("@/editor-engine/vendor/bootstrap", () => ({
  disposeEditor: vi.fn(), hydrateAssetFilesForExport: vi.fn(async () => []),
  initEditorWithProject: mocks.init, updateEditorProject: vi.fn(),
}));
vi.mock("@editor/core", () => {
  const subscribe = (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); };
  return { EditorCore: { getInstance: vi.fn(() => ({
    scenes: { subscribe }, project: { subscribe }, media: { subscribe, getAssets: () => [], setAssets: vi.fn() },
    renderer: { setRenderTree: vi.fn(), exportProject: mocks.render },
  })) } };
});
vi.mock("@editor/components/editor/panels/timeline", () => ({ Timeline: () => null }));
vi.mock("@editor/components/editor/panels/preview", () => ({ PreviewPanel: () => null }));
vi.mock("@/editor-engine/vendor/ReplacePanel", () => ({ ReplacePanel: () => null }));
vi.mock("../FilmStrip", () => ({ default: () => null }));
vi.mock("../BgmPanel", () => ({ default: ({ onPrepareChange, onProjectChanged }: {
  onPrepareChange: () => Promise<void>; onProjectChanged: (result: {project: Record<string, unknown>}) => Promise<void>;
}) => <button onClick={async () => {
  await onPrepareChange();
  const project = { tracks: [], metadata: { bgm_choice: { enabled: false } } };
  mocks.serialize.mockReturnValue(project);
  await onProjectChanged({ project });
}}>测试更新配乐</button> }));
vi.mock("@/editor-engine/vendor/api", () => ({ API_BASE: "http://test.invalid" }));
vi.mock("@/editor-engine/vendor/serializeProject", () => ({
  rememberRawProject: vi.fn(), serializeBackendProject: mocks.serialize,
}));
vi.mock("@/editor-engine/vendor/quality/preflight", () => ({ inspectEditorProject: mocks.inspect }));
vi.mock("@editor/lib/export", () => ({ getExportMimeType: vi.fn() }));
vi.mock("@/lib/brand-showcase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/brand-showcase")>(),
  createBrandShowcaseFrameDecorator: () => async () => undefined,
}));
vi.mock("@editor/services/video-cache/service", () => ({ videoCache: {} }));
vi.mock("../video-export-client", () => ({
  getCurrentExportJob: mocks.getCurrent, waitForExportJob: mocks.wait,
  retryExportJob: mocks.retry, uploadExportCandidate: mocks.upload,
  clearLocalExportMarker: vi.fn(), findLocalExportMarker: vi.fn(() => null),
  writeLocalExportMarker: vi.fn(),
}));

const running: ExportFinalizeJob = {
  id: "brand-job", assetId: 42, status: "running", stage: "verifying",
  retryable: false, errorMessage: null, qualityReport: null, mp4Ref: null,
  exportVariant: "brand_showcase", brandSpecVersion: "multimix-brand-showcase:v1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listeners.clear();
  mocks.init.mockResolvedValue(undefined);
  mocks.getCurrent.mockImplementation(async ({ exportVariant }) => exportVariant === "original" ? null : running);
  mocks.serialize.mockReturnValue({ tracks: [] });
  mocks.inspect.mockReturnValue({ stage: "export_preflight", status: "blocked", warnings: [],
    blockers: [{ code: "test-blocker", message: "当前编辑内容需要检查" }] });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:verified"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ status: "completed", project: { tracks: [] } }), {
    headers: { "Content-Type": "application/json" },
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function chooseExport(label: "原始成片" | "品牌展示版") {
  fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("standalone branded export recovery", () => {
  it("does not restart recovery for unsaved content when the auth callback changes", async () => {
    mocks.getCurrent.mockResolvedValue(null);
    const view = render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "导出视频" });
    await waitFor(() => expect(mocks.getCurrent).toHaveBeenCalledOnce());
    mocks.serialize.mockReturnValue({ tracks: [{ id: "unsaved", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    view.rerender(<EditorView assetId="42" jobId={null} token="token" refreshAccessToken={async () => "refreshed"} />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getCurrent).toHaveBeenCalledOnce();
  });

  it("does not let a late original recovery overwrite a completed branded operation", async () => {
    let finishOriginal!: (job: ExportFinalizeJob) => void;
    const original = new Promise<ExportFinalizeJob>((resolve) => { finishOriginal = resolve; });
    mocks.getCurrent.mockImplementation(async ({ exportVariant }) => exportVariant === "original" ? original
      : { ...running, status: "completed", stage: "done", mp4Ref: "brand.mp4" });
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "导出视频" });
    chooseExport("品牌展示版");
    await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
    await act(async () => {
      finishOriginal({ ...running, exportVariant: "original", status: "failed", stage: "failed", errorMessage: "迟到的原始版失败" });
      await original;
    });
    expect(screen.queryByText(/导出失败/)).not.toBeInTheDocument();
  });

  it.each([false, true])("stops at failed terminal state and waits for an explicit retry (retryable=%s)", async (retryable) => {
    const failed: ExportFinalizeJob = {
      ...running, status: "failed", stage: "failed", retryable,
      errorMessage: "file_quality_blocked",
      qualityReport: { stage: "export_file", status: "blocked", warnings: [], blockers: [{
        code: "decode_failed", message: "成片无法解码", suggested_actions: ["重新导出"],
      }] },
    };
    mocks.wait.mockResolvedValue(failed);
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "导出视频" });
    chooseExport("品牌展示版");
    expect(await screen.findByText(/品牌展示版导出失败/)).toHaveTextContent("成片未通过质量检查，请查看具体问题后重新导出。");
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();

    if (retryable) {
      mocks.retry.mockResolvedValue({ ...running, status: "queued", stage: "uploaded" });
      mocks.wait.mockResolvedValue({ ...running, status: "completed", stage: "done", mp4Ref: "brand.mp4" });
      chooseExport("品牌展示版");
      await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
      expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ jobId: failed.id }));
      expect(screen.queryByText(/导出失败/)).not.toBeInTheDocument();
      expect(mocks.inspect).not.toHaveBeenCalled();
    }
  });

  it("clears the previous brand error when downloading a cached original through the real button", async () => {
    mocks.getCurrent.mockImplementation(async ({ exportVariant }) => exportVariant === "original"
      ? { ...running, status: "completed", stage: "done", exportVariant: "original", mp4Ref: "original.mp4" }
      : running);
    mocks.wait.mockResolvedValue({ ...running, status: "failed", stage: "failed", errorMessage: "品牌检查失败" });
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
    chooseExport("品牌展示版");
    await screen.findByText(/品牌展示版导出失败/);
    const readsBeforeDownload = mocks.getCurrent.mock.calls.length;
    // Playback/selection notifications with identical serialized content keep the cache.
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    chooseExport("原始成片");
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(screen.queryByText(/导出失败/)).not.toBeInTheDocument();
    expect(mocks.getCurrent).toHaveBeenCalledTimes(readsBeforeDownload);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each(["原始成片", "品牌展示版"] as const)("does not reuse a cached %s after an unsaved timeline edit", async (label) => {
    mocks.getCurrent.mockImplementation(async ({ exportVariant }) => ({ ...running, status: "completed", stage: "done",
      exportVariant, mp4Ref: `${exportVariant}-old.mp4` }));
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    if (label === "品牌展示版") {
      chooseExport(label);
      await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
    }
    mocks.serialize.mockReturnValue({ tracks: [{ id: "edited", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    chooseExport(label);
    await screen.findByText(/当前编辑内容需要检查/);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(mocks.inspect).toHaveBeenCalled();
  });

  it.each(["原始成片", "品牌展示版"] as const)("discards a late %s file download after an edit", async (label) => {
    mocks.getCurrent.mockImplementation(async ({ exportVariant }) => exportVariant === "original" && label === "品牌展示版"
      ? null : { ...running, status: "completed", stage: "done", exportVariant, mp4Ref: "old.mp4" });
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.mocked(fetch).mockImplementation(async (input) => String(input).includes("ref=old.mp4") ? pending
      : new Response(JSON.stringify({ status: "completed", project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "导出视频" });
    if (label === "品牌展示版") chooseExport(label);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("ref=old.mp4"), expect.anything()));
    mocks.serialize.mockReturnValue({ tracks: [{ id: "edited-during-download", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    await act(async () => { finish(new Response(new Blob(["old-video"]))); await pending; });
    await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
    chooseExport(label);
    await screen.findByText(/当前编辑内容需要检查/);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("does not refill the original cache with a late recovery after saving", async () => {
    let finishOriginal!: (job: ExportFinalizeJob) => void;
    const original = new Promise<ExportFinalizeJob>((resolve) => { finishOriginal = resolve; });
    mocks.getCurrent.mockReturnValue(original);
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "保存项目" });
    mocks.serialize.mockReturnValue({ tracks: [{ id: "new-saved", elements: [] }] });
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
    await screen.findByRole("button", { name: "已保存" });
    await act(async () => { finishOriginal({ ...running, status: "completed", stage: "done", exportVariant: "original", mp4Ref: "old.mp4" }); await original; });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("old.mp4"), expect.anything());
    chooseExport("原始成片");
    await screen.findByText(/当前编辑内容需要检查/);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("discards a late recovery after changing BGM", async () => {
    let finish!: (job: ExportFinalizeJob) => void;
    const pending = new Promise<ExportFinalizeJob>((resolve) => { finish = resolve; });
    mocks.getCurrent.mockReturnValue(pending);
    render(<EditorView assetId="42" jobId={null} token="token" />);
    fireEvent.click(await screen.findByRole("button", { name: "测试更新配乐" }));
    await waitFor(() => expect(mocks.serialize()).toEqual(expect.objectContaining({ metadata: { bgm_choice: { enabled: false } } })));
    await act(async () => { finish({ ...running, status: "completed", stage: "done", exportVariant: "original", mp4Ref: "old-bgm.mp4" }); await pending; });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("old-bgm.mp4"), expect.anything());
    chooseExport("原始成片");
    await screen.findByText(/当前编辑内容需要检查/);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("does not upload a render completed after the timeline changed", async () => {
    mocks.getCurrent.mockResolvedValue(null);
    mocks.inspect.mockReturnValue({ stage: "export_preflight", status: "pass", blockers: [], warnings: [] });
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/quality?")
      ? { stage: "export_preflight", status: "pass", blockers: [], warnings: [] }
      : { status: "completed", project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
    let finish!: (result: {success: boolean; buffer: ArrayBuffer}) => void;
    const pending = new Promise<{success: boolean; buffer: ArrayBuffer}>((resolve) => { finish = resolve; });
    mocks.render.mockReturnValue(pending);
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await screen.findByRole("button", { name: "导出视频" });
    chooseExport("原始成片");
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    mocks.serialize.mockReturnValue({ tracks: [{ id: "changed-during-render", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    await act(async () => { finish({ success: true, buffer: new ArrayBuffer(3) }); await pending; });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  });

  it.each(["原始成片", "品牌展示版"] as const)("renders and verifies the edited %s instead of downloading the old version", async (label) => {
    mocks.getCurrent.mockImplementation(async ({ exportVariant }) => ({ ...running, status: "completed", stage: "done",
      exportVariant, mp4Ref: "old.mp4" }));
    render(<EditorView assetId="42" jobId={null} token="token" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const edited = { tracks: [{ id: "new-timeline", elements: [] }] };
    mocks.serialize.mockReturnValue(edited);
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    const report = { stage: "export_file", status: "pass", blockers: [], warnings: [] };
    mocks.inspect.mockReturnValue({ ...report, stage: "export_preflight" });
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/quality?")
      ? { ...report, stage: "export_preflight" } : { status: "completed", project: edited }), { headers: { "Content-Type": "application/json" } }));
    mocks.render.mockImplementation(async ({ onProgress }) => {
      onProgress({ progress: 1, completedFrames: 1, totalFrames: 1 });
      return { success: true, buffer: new ArrayBuffer(3), format: "mp4" };
    });
    const variant = label === "品牌展示版" ? "brand_showcase" : "original";
    mocks.upload.mockResolvedValue({ ...running, exportVariant: variant });
    mocks.wait.mockResolvedValue({ ...running, exportVariant: variant, status: "completed", stage: "done", mp4Ref: "new.mp4", qualityReport: report });
    const reads = mocks.getCurrent.mock.calls.length;
    chooseExport(label);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
    expect(mocks.getCurrent).toHaveBeenCalledTimes(reads);
    expect(mocks.render).toHaveBeenCalledOnce();
    chooseExport(label);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
});
