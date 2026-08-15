import { describe, expect, it, vi } from "vitest";

import {
  getCurrentExportJob,
  retryExportJob,
  uploadExportCandidate,
  waitForExportJob,
  type ExportFinalizeJob,
} from "../video-export-client";

const queuedJob: ExportFinalizeJob = {
  id: "video-export-1",
  assetId: 1121,
  status: "queued",
  stage: "uploaded",
  retryable: false,
  errorMessage: null,
  qualityReport: null,
  mp4Ref: null,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wire(job: Partial<ExportFinalizeJob> = {}): Record<string, unknown> {
  const value = { ...queuedJob, ...job };
  return {
    job_id: value.id,
    asset_id: value.assetId,
    status: value.status,
    stage: value.stage,
    retryable: value.retryable,
    error_message: value.errorMessage,
    quality_report: value.qualityReport,
    mp4_ref: value.mp4Ref,
  };
}

describe("video export finalization client", () => {
  it("uploads one candidate to the durable export endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(wire(), 202));
    const blob = new Blob(["mp4"], { type: "video/mp4" });

    const job = await uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob,
      fetchImpl,
    });

    expect(job).toEqual(queuedJob);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/video/projects/1121/exports",
      expect.objectContaining({ method: "POST" }),
    );
    const uploaded = (fetchImpl.mock.calls[0]?.[1]?.body as FormData).get("file") as File;
    expect(uploaded.size).toBe(blob.size);
    expect(uploaded.type).toBe("video/mp4");
  });

  it("treats a missing current job as no recovery work", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: "missing" }, 404));

    await expect(getCurrentExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      fetchImpl,
    })).resolves.toBeNull();
  });

  it("polls a running job until the worker publishes it", async () => {
    const running = { ...queuedJob, status: "running" as const, stage: "verifying" as const };
    const completed = {
      ...queuedJob,
      status: "completed" as const,
      stage: "done" as const,
      mp4Ref: "supabase://exports/final.mp4",
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(wire(running)))
      .mockResolvedValueOnce(response(wire(completed)));

    const result = await waitForExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      initialJob: queuedJob,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result).toEqual(completed);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the task id across a transient network interruption", async () => {
    const completed = { ...queuedJob, status: "completed" as const, stage: "done" as const };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(response(wire(completed)));

    await expect(waitForExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      initialJob: queuedJob,
      fetchImpl,
      sleep: async () => undefined,
    })).resolves.toEqual(completed);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/exports/video-export-1");
  });

  it("returns a structured failed terminal job", async () => {
    const failed = {
      ...queuedJob,
      status: "failed" as const,
      stage: "failed" as const,
      retryable: true,
      errorMessage: "检查服务暂时不可用",
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(wire(failed)));

    await expect(waitForExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      initialJob: queuedJob,
      fetchImpl,
      sleep: async () => undefined,
    })).resolves.toEqual(failed);
  });

  it("retries a persisted candidate without uploading or rendering it again", async () => {
    const running = { ...queuedJob, status: "running" as const, stage: "verifying" as const };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: queuedJob.id }, 202))
      .mockResolvedValueOnce(response(wire(running)));

    await expect(retryExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      jobId: queuedJob.id,
      token: "token",
      fetchImpl,
    })).resolves.toEqual(running);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/video/jobs/video-export-1/retry",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/exports/video-export-1");
  });

  it("stops polling when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForExportJob({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      initialJob: queuedJob,
      signal: controller.signal,
      fetchImpl: vi.fn<typeof fetch>(),
      sleep: async () => undefined,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
