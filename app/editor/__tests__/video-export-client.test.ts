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

type ResumableOptions = {
  endpoint: string;
  fingerprint: () => Promise<string>;
  chunkSize: number;
  retryDelays: number[];
  headers: Record<string, string>;
  metadata: Record<string, string>;
  onSuccess: () => void;
  onError: (error: Error) => void;
};

function successfulResumableUploadFactory() {
  const start = vi.fn();
  const factory = vi.fn((_blob: Blob, options: ResumableOptions) => {
    start.mockImplementation(() => options.onSuccess());
    return {
      abort: vi.fn().mockResolvedValue(undefined),
      findPreviousUploads: vi.fn().mockResolvedValue([]),
      resumeFromPreviousUpload: vi.fn(),
      start,
    };
  });
  return { factory, start };
}

describe("video export finalization client", () => {
  it("uses the multipart compatibility endpoint when direct storage is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        mode: "multipart",
        upload_url: "/v1/video/projects/1121/exports",
        upload_method: "POST",
        project_fingerprint: "a".repeat(64),
      }, 201))
      .mockResolvedValueOnce(response(wire(), 202));
    const blob = new Blob(["mp4"], { type: "video/mp4" });

    const job = await uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob,
      fetchImpl,
    });

    expect(job).toEqual(queuedJob);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/v1/video/projects/1121/exports/uploads",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/v1/video/projects/1121/exports",
      expect.objectContaining({ method: "POST" }),
    );
    const uploaded = (fetchImpl.mock.calls[1]?.[1]?.body as FormData).get("file") as File;
    expect(uploaded.size).toBe(blob.size);
    expect(uploaded.type).toBe("video/mp4");
  });

  it("uses signed resumable upload for a direct storage session", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        mode: "direct",
        candidate_ref: "supabase://multimix-artifacts/video-orchestration/7/export-candidates/candidate.mp4",
        upload_url: "https://project.supabase.co/storage/v1/object/upload/sign/multimix-artifacts/video-orchestration/7/export-candidates/candidate.mp4?token=short",
        upload_method: "PUT",
        project_fingerprint: "a".repeat(64),
      }, 201))
      .mockResolvedValueOnce(response(wire(), 202));
    const blob = new Blob(["mp4"], { type: "video/mp4" });
    const { factory: resumableUploadFactory, start } = successfulResumableUploadFactory();

    await expect(uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob,
      fetchImpl,
      resumableUploadFactory,
    })).resolves.toEqual(queuedJob);

    expect(resumableUploadFactory).toHaveBeenCalledWith(
      blob,
      expect.objectContaining({
        endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable/sign",
        fingerprint: expect.any(Function),
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
        headers: { "x-signature": "short", "x-upsert": "true" },
        metadata: {
          bucketName: "multimix-artifacts",
          objectName: "video-orchestration/7/export-candidates/candidate.mp4",
          contentType: "video/mp4",
          cacheControl: "3600",
        },
      }),
    );
    const resumableOptions = resumableUploadFactory.mock.calls[0]?.[1];
    await expect(resumableOptions?.fingerprint()).resolves.toBe(
      "multimix-video-export:multimix-artifacts:video-orchestration/7/"
        + "export-candidates/candidate.mp4:"
        + "862c4ec62defaadafbf7638961214d286015c38ed4ccc7b10d52bdf434e5bee1",
    );
    expect(start).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.example.test/v1/video/projects/1121/exports/register",
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toEqual(expect.any(String));
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      project_fingerprint: "a".repeat(64),
    }));
  });

  it("resumes a matching interrupted direct upload before starting", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        mode: "direct",
        upload_url: "https://project.supabase.co/storage/v1/object/upload/sign/bucket/candidate.mp4?token=short",
        upload_method: "PUT",
        project_fingerprint: "a".repeat(64),
      }, 201))
      .mockResolvedValueOnce(response(wire(), 202));
    const previousUpload = {
      size: 3,
      metadata: {},
      creationTime: "yesterday",
      urlStorageKey: "upload-key",
      uploadUrl: "https://project.storage.supabase.co/upload/previous",
      parallelUploadUrls: null,
    };
    const resumeFromPreviousUpload = vi.fn();
    const factory = vi.fn((_blob: Blob, options: ResumableOptions) => ({
      abort: vi.fn().mockResolvedValue(undefined),
      findPreviousUploads: vi.fn().mockResolvedValue([previousUpload]),
      resumeFromPreviousUpload,
      start: vi.fn(() => options.onSuccess()),
    }));

    await uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      fetchImpl,
      resumableUploadFactory: factory,
    });

    expect(resumeFromPreviousUpload).toHaveBeenCalledWith(previousUpload);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries registration without uploading the candidate again", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        mode: "direct",
        upload_url: "https://project.supabase.co/storage/v1/object/upload/sign/bucket/candidate.mp4?token=short",
        upload_method: "PUT",
        project_fingerprint: "a".repeat(64),
      }, 201))
      .mockResolvedValueOnce(response({ detail: "temporary" }, 503))
      .mockResolvedValueOnce(response(wire(), 202));
    const { factory, start } = successfulResumableUploadFactory();

    await uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      fetchImpl,
      resumableUploadFactory: factory,
    });

    expect(start).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/exports/register")))
      .toHaveLength(2);
  });

  it("aborts an active resumable upload when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      mode: "direct",
      upload_url: "https://project.supabase.co/storage/v1/object/upload/sign/bucket/candidate.mp4?token=short",
      upload_method: "PUT",
      project_fingerprint: "a".repeat(64),
    }, 201));
    const abort = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(() => ({
      abort,
      findPreviousUploads: vi.fn().mockResolvedValue([]),
      resumeFromPreviousUpload: vi.fn(),
      start: vi.fn(() => controller.abort()),
    }));

    await expect(uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      fetchImpl,
      signal: controller.signal,
      resumableUploadFactory: factory,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a malformed direct upload URL before registering a candidate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      mode: "direct",
      upload_url: "https://storage.example.test/upload?token=short",
      upload_method: "PUT",
      project_fingerprint: "a".repeat(64),
    }, 201));

    await expect(uploadExportCandidate({
      apiBase: "https://api.example.test",
      assetId: "1121",
      token: "token",
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      fetchImpl,
    })).rejects.toThrow("成片上传会话未返回有效的大文件上传地址");
    expect(fetchImpl).toHaveBeenCalledOnce();
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
