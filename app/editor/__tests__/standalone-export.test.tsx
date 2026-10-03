// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportFinalizeJob } from "../video-export-client";
import { useEffect } from "react";
import EditorView from "../EditorView";

const mocks = vi.hoisted(() => ({
  getCurrent: vi.fn(), wait: vi.fn(), retry: vi.fn(), upload: vi.fn(),
  serialize: vi.fn(), init: vi.fn(), inspect: vi.fn(), render: vi.fn(), flush: vi.fn(), listeners: new Set<() => void>(),
  persist: undefined as (() => Promise<void>) | undefined,
  bgmChange: undefined as ((mutation: () => Promise<unknown>) => Promise<unknown>) | undefined,
  patchBgm: vi.fn(),
}));
vi.mock("@/editor-engine/vendor/bootstrap", () => ({
  disposeEditor: vi.fn(), hydrateAssetFilesForExport: vi.fn(async () => []),
  initEditorWithProject: mocks.init, updateEditorProject: vi.fn(),
  updateEditorBgm: mocks.patchBgm,
}));
vi.mock("@editor/core", () => {
  const subscribe = (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); };
  return { EditorCore: { getInstance: vi.fn(() => ({
    scenes: { subscribe }, project: { subscribe }, media: { subscribe, getAssets: () => [], setAssets: vi.fn() },
    playback: { subscribe, getCurrentTime: () => 0, getIsPlaying: () => false },
    timeline: { getTotalDuration: () => 3 },
    renderer: { setRenderTree: vi.fn(), exportProject: mocks.render },
  })) } };
});
vi.mock("@editor/components/editor/panels/timeline", () => ({ Timeline: () => null }));
vi.mock("@editor/components/editor/panels/preview", () => ({ PreviewPanel: () => null }));
vi.mock("@/editor-engine/vendor/ReplacePanel", () => ({ ReplacePanel: () => null }));
vi.mock("../FilmStrip", () => ({ default: function MockFilmStrip({ onFlushReady, onPersistTimeline }: {
  onFlushReady?: (flush: typeof mocks.flush | null) => void; onPersistTimeline: () => Promise<void>;
}) {
  mocks.persist = onPersistTimeline;
  useEffect(() => { onFlushReady?.(mocks.flush); return () => onFlushReady?.(null); }, [onFlushReady]);
  return null;
} }));
vi.mock("../BgmPanel", () => ({ default: ({ onChange }: {
  onChange: (mutation: () => Promise<unknown>) => Promise<unknown>;
}) => {
  mocks.bgmChange = onChange;
  return <button onClick={() => void onChange(async () => ({
    project: { tracks: [], media: [], metadata: { bgm_choice: { enabled: false } } }, project_fingerprint: testRevision("bgm"),
  }))}>测试更新配乐</button>;
} }));
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

function testRevision(index: number | "bgm") {
  return index === "bgm" ? "b".repeat(64) : index.toString(16).padStart(64, "0");
}

const running: ExportFinalizeJob = {
  id: "brand-job", assetId: 42, status: "running", stage: "verifying",
  retryable: false, errorMessage: null, qualityReport: null, mp4Ref: null,
  exportVariant: "brand_showcase", brandSpecVersion: "multimix-brand-showcase:v1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listeners.clear();
  mocks.persist = undefined;
  mocks.bgmChange = undefined;
  mocks.patchBgm.mockImplementation(async (project) => {
    mocks.serialize.mockReturnValue({ ...mocks.serialize(), media: mocks.serialize().media ?? [], metadata: project.metadata });
  });
  mocks.init.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue({ status: "saved" });
  mocks.getCurrent.mockImplementation(async ({ exportVariant }) => exportVariant === "original" ? null : running);
  mocks.serialize.mockReturnValue({ tracks: [] });
  mocks.inspect.mockReturnValue({ stage: "export_preflight", status: "blocked", warnings: [],
    blockers: [{ code: "test-blocker", message: "当前编辑内容需要检查" }] });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:verified"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), {
    headers: { "Content-Type": "application/json" },
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function chooseExport(label: "原始成片" | "品牌展示版") {
  fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("embedded export live content guard", () => {
  it("announces readiness after the current message bridge and save coordinator are installed", async () => {
    const parent = { postMessage: vi.fn((payload: { type?: string }) => {
      if (payload.type === "multimix-editor-ready") {
        expect(mocks.persist).toBeDefined();
        window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
          data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "first-ready" } }));
      }
    }) };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    mocks.flush.mockResolvedValue({ status: "error", message: "保存失败，请先重试" });
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "multimix-editor-export-error", requestId: "first-ready", message: "保存失败，请先重试",
    }), window.location.origin));
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("waits for pending music before acknowledging an otherwise clean finish", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    let finish!: (result: unknown) => void;
    const mutation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const bgm = mocks.bgmChange!(mutation);
    await waitFor(() => expect(mutation).toHaveBeenCalled());
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-flush", requestId: "music-finish" } })));
    await act(async () => { await Promise.resolve(); });
    expect(parent.postMessage.mock.calls.some(([payload]) => payload.type === "multimix-editor-flush-result")).toBe(false);
    await act(async () => {
      finish({ project: { tracks: [], media: [], metadata: { bgm_choice: { enabled: false } } }, project_fingerprint: testRevision("bgm") });
      await bgm;
    });
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "multimix-editor-flush-result", requestId: "music-finish", status: "saved",
    }), window.location.origin));
  });

  it.each(["unmount", "pagehide"])("does not apply a late BGM response or queued save after %s", async (exit) => {
    const { unmount } = render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    let finish!: (result: unknown) => void;
    const mutation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const bgm = mocks.bgmChange!(mutation);
    await waitFor(() => expect(mutation).toHaveBeenCalled());
    const queuedSave = mocks.persist!();
    if (exit === "unmount") unmount();
    else act(() => window.dispatchEvent(new Event("pagehide")));
    finish({ project: { tracks: [], media: [], metadata: { bgm_choice: { enabled: false } } }, project_fingerprint: testRevision("bgm") });
    await expect(bgm).rejects.toMatchObject({ name: "AbortError" });
    await expect(queuedSave).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.patchBgm).not.toHaveBeenCalled();
  });

  it("releases the write lane after a failed BGM request without applying it", async () => {
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    await expect(mocks.bgmChange!(async () => { throw new Error("music unavailable"); })).rejects.toThrow("music unavailable");
    expect(mocks.patchBgm).not.toHaveBeenCalled();
    await mocks.persist!();
    const put = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT").at(-1)![1]!;
    expect(new Headers(put.headers).get("If-Match")).toBe(JSON.stringify(testRevision(0)));
  });
  it("queues a save behind BGM and preserves the edit made while its response is pending", async () => {
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    expect(mocks.bgmChange).toBeTypeOf("function");
    let finish!: (result: unknown) => void;
    const response = new Promise((resolve) => { finish = resolve; });
    const mutation = vi.fn(() => response);
    const bgm = mocks.bgmChange!(mutation);
    await waitFor(() => expect(mutation).toHaveBeenCalled());
    const prepares = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT").length;
    const edited = { tracks: [{ id: "main", elements: [{ id: "split-new" }] }] };
    mocks.serialize.mockReturnValue(edited);
    const save = mocks.persist!();
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(prepares);
    await act(async () => {
      finish({ project: { tracks: [], media: [], metadata: { bgm_choice: { enabled: false } } }, project_fingerprint: testRevision("bgm") });
      await bgm;
    });
    await save;
    expect(mocks.serialize().tracks).toEqual(edited.tracks);
    const put = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT").at(-1)![1]!;
    expect(new Headers(put.headers).get("If-Match")).toBe(JSON.stringify(testRevision("bgm")));
    expect(JSON.parse(String(put.body)).tracks).toEqual(edited.tracks);
  });
  it("serializes export preparation and a newer timeline save with acknowledged revisions", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    mocks.inspect.mockReturnValue({ stage: "export_preflight", status: "pass", blockers: [], warnings: [] });
    const before = { tracks: [{ id: "main", elements: [{ id: "before" }] }] };
    const after = { tracks: [{ id: "main", elements: [{ id: "new-edit" }] }] };
    mocks.serialize.mockReturnValue(before);
    let serverProject = before;
    let finish!: () => void;
    const first = new Promise<void>((resolve) => { finish = resolve; });
    const saves: RequestInit[] = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        saves.push(init);
        const index = saves.length;
        if (index === 1) await first;
        serverProject = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ status: "saved", project_fingerprint: testRevision(index) }));
      }
      return new Response(JSON.stringify({ status: "completed", project_fingerprint: testRevision(0), project: before }));
    });
    mocks.flush.mockImplementation(async () => { await mocks.persist!(); return { status: "saved" }; });
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "ordered-export" } })));
    await waitFor(() => expect(saves).toHaveLength(1));
    mocks.serialize.mockReturnValue(after);
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    const nextSave = mocks.persist!();
    await act(async () => { await Promise.resolve(); });
    expect(saves).toHaveLength(1);
    await act(async () => { finish(); await first; await nextSave; });
    expect(saves).toHaveLength(2);
    expect(new Headers(saves[0].headers).get("If-Match")).toBe(JSON.stringify(testRevision(0)));
    expect(new Headers(saves[1].headers).get("If-Match")).toBe(JSON.stringify(testRevision(1)));
    expect(serverProject).toEqual(after);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not blindly refresh the base or overwrite after a server version conflict", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(mocks.persist).toBeDefined());
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ detail: {
      code: "project_version_conflict", message: "工程已有新的修改，当前编辑未覆盖它。",
    } }), { status: 412 }));
    await expect(mocks.persist!()).rejects.toThrow("工程已有新的修改");
    await expect(mocks.persist!()).rejects.toThrow("工程已有新的修改");
    expect(vi.mocked(fetch).mock.calls.slice(-2).every(([, init]) => new Headers(init?.headers).get("If-Match") === JSON.stringify(testRevision(0)))).toBe(true);
  });

  it("exports from the read-only preview without a filmstrip save coordinator", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    const report = { stage: "export_file", status: "pass", blockers: [], warnings: [] };
    mocks.inspect.mockReturnValue({ ...report, stage: "export_preflight" });
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/quality?")
      ? { ...report, stage: "export_preflight" }
      : { status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
    mocks.render.mockImplementation(async ({ onProgress }) => {
      onProgress({ progress: 1, completedFrames: 1, totalFrames: 1 });
      return { success: true, buffer: new ArrayBuffer(3), format: "mp4" };
    });
    mocks.upload.mockResolvedValue({ ...running, exportVariant: "original" });
    mocks.wait.mockResolvedValue({ ...running, exportVariant: "original", status: "completed", stage: "done", mp4Ref: "new.mp4", qualityReport: report });
    render(<EditorView assetId="42" jobId={null} token="token" embed mode="preview" />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-ready" }), window.location.origin));
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "preview-export" } })));
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-export-success", requestId: "preview-export" }), window.location.origin));
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  it("does not render or upload when pending timeline save fails", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    mocks.flush.mockResolvedValue({ status: "error", message: "保存失败，请先重试" });
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-ready" }), window.location.origin));
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "request-save-failure" } })));
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-export-error", message: "保存失败，请先重试" }), window.location.origin));
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("aborts verification and discards a late result even if content is reverted", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    const report = { stage: "export_file", status: "pass", blockers: [], warnings: [] };
    mocks.inspect.mockReturnValue({ ...report, stage: "export_preflight" });
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/quality?")
      ? { ...report, stage: "export_preflight" }
      : { status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
    mocks.render.mockImplementation(async ({ onProgress }) => {
      onProgress({ progress: 1, completedFrames: 1, totalFrames: 1 });
      return { success: true, buffer: new ArrayBuffer(3), format: "mp4" };
    });
    mocks.upload.mockResolvedValue({ ...running, exportVariant: "original" });
    let finish!: (job: ExportFinalizeJob) => void;
    const pending = new Promise<ExportFinalizeJob>((resolve) => { finish = resolve; });
    mocks.wait.mockReturnValue(pending);
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-ready" }), window.location.origin));
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "old-verification" } })));
    await waitFor(() => expect(mocks.wait).toHaveBeenCalledOnce());
    const reads = vi.mocked(fetch).mock.calls.length;
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-content-changed" }), expect.anything());
    mocks.serialize.mockReturnValue({ tracks: [{ id: "edited-then-undone", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    expect(mocks.upload.mock.calls[0][0].signal.aborted).toBe(true);
    mocks.serialize.mockReturnValue({ tracks: [] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    await act(async () => { finish({ ...running, status: "completed", stage: "done", qualityReport: report, mp4Ref: "old.mp4" }); await pending; });
    expect(fetch).toHaveBeenCalledTimes(reads);
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-export-success" }), expect.anything());
  });

  it.each(["original", "brand_showcase"])("does not upload %s after content changes during rendering", async (exportVariant) => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    mocks.inspect.mockReturnValue({ stage: "export_preflight", status: "pass", blockers: [], warnings: [] });
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/quality?")
      ? { stage: "export_preflight", status: "pass", blockers: [], warnings: [] }
      : { status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
    let finish!: (result: { success: boolean; buffer: ArrayBuffer }) => void;
    const pending = new Promise<{ success: boolean; buffer: ArrayBuffer }>((resolve) => { finish = resolve; });
    mocks.render.mockImplementation(({ onProgress }) => {
      onProgress({ progress: 1, completedFrames: 1, totalFrames: 1 });
      return pending;
    });
    render(<EditorView assetId="42" jobId={null} token="token" embed />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-ready" }), window.location.origin));
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin,
      data: { source: "multimix-workspace", type: "multimix-editor-export", requestId: "request-render", exportVariant } })));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    mocks.serialize.mockReturnValue({ tracks: [{ id: "edited-during-render", elements: [] }] });
    act(() => { mocks.listeners.forEach((listener) => listener()); });
    await act(async () => { finish({ success: true, buffer: new ArrayBuffer(3) }); await pending; });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "multimix-editor-export-success" }), expect.anything());
  });
});

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
      : new Response(JSON.stringify({ status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
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
      : { status: "completed", project_fingerprint: testRevision(0), project: { tracks: [] } }), { headers: { "Content-Type": "application/json" } }));
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
      ? { ...report, stage: "export_preflight" } : { status: "completed", project_fingerprint: testRevision(0), project: edited }), { headers: { "Content-Type": "application/json" } }));
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
