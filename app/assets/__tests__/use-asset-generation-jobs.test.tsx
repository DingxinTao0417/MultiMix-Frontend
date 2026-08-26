// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { Conversation } from "../lib/asset-workspace-shared";
import { useAssetGenerationJobs } from "../lib/use-asset-generation-jobs";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function generationJob(
  overrides: Partial<AssetGenerationJobResponse> = {},
): AssetGenerationJobResponse {
  return {
    id: "asset-generation-job-1",
    status: "queued",
    result_asset_id: null,
    error_message: null,
    created_at: "2026-07-30T09:00:00Z",
    updated_at: "2026-07-30T09:00:00Z",
    ...overrides,
  };
}

function conversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-1",
    title: "素材生成对话",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useAssetGenerationJobs", () => {
  it("registers a generation job for its conversation", () => {
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    const job = generationJob();

    act(() => {
      result.current.registerJob("conversation-1", job);
    });

    expect(result.current.jobsByConversation["conversation-1"]).toEqual({
      conversationId: "conversation-1",
      job,
      run: 0,
    });
  });

  it("restores a failed generation job from persisted conversation metadata", async () => {
    const persisted = conversation({
      messages: [{
        role: "assistant",
        text: "生成失败，可以重试。",
        metadata: {
          asset_generation_job_id: "asset-generation-job-persisted",
          asset_generation_status: "failed",
          asset_generation_stage: "failed",
          asset_generation_attempts: 2,
          asset_generation_error_code: "provider_timeout",
        },
      }],
    });

    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [persisted],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));

    await waitFor(() => {
      expect(result.current.jobsByConversation["conversation-1"]?.job).toMatchObject({
        id: "asset-generation-job-persisted",
        status: "failed",
        error_message: "生成失败，可以重试。",
      });
      expect(result.current.jobsByConversation["conversation-1"]?.job).not.toHaveProperty("attempts");
      expect(result.current.jobsByConversation["conversation-1"]?.job).not.toHaveProperty("error_code");
    });
  });

  it("keeps multiple generation jobs addressable in the same conversation", () => {
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    const first = generationJob({ id: "asset-generation-job-1" });
    const second = generationJob({
      id: "asset-generation-job-2",
      updated_at: "2026-07-30T09:01:00Z",
    });

    act(() => {
      result.current.registerJob("conversation-1", first);
      result.current.registerJob("conversation-1", second);
    });

    expect(result.current.jobsForConversation("conversation-1").map(({ job }) => job.id)).toEqual([
      "asset-generation-job-1",
      "asset-generation-job-2",
    ]);
  });

  it("retries a failed job during the live-registry restore window with its current conversation", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(false);
    const retriedJob = generationJob({
      id: "asset-generation-job-persisted",
      status: "queued",
      updated_at: "2026-08-23T13:00:00Z",
    });
    const retryGenerationJob = vi.spyOn(assetWorkspaceAdapter, "retryGenerationJob")
      .mockResolvedValue(retriedJob);
    const { result } = renderHook(
      ({ conversations }) => useAssetGenerationJobs({
        token: "token-1",
        conversations,
        onConversationRefreshed: vi.fn(),
        onConversationRefreshError: vi.fn(),
      }),
      { initialProps: { conversations: [] as Conversation[] } },
    );

    await act(async () => {
      await result.current.retryJob("asset-generation-job-persisted", "conversation-1");
    });

    expect(retryGenerationJob).toHaveBeenCalledWith(
      "token-1",
      "asset-generation-job-persisted",
    );
    expect(result.current.jobsByConversation["conversation-1"]).toEqual({
      conversationId: "conversation-1",
      job: retriedJob,
      run: 1,
    });
  });

  it("starts polling after 200ms and repeats a running job after 2.5s", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockResolvedValueOnce(generationJob({ status: "running" }))
      .mockResolvedValueOnce(generationJob({
        status: "failed",
        error_message: "生成超时，可以重试。",
      }));
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));

    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(getGenerationJob).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2499);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(2);
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("failed");
  });

  it("does not let stale persisted queued metadata overwrite a polled running job", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockResolvedValue(generationJob({ status: "running" }));
    const persistedQueued = conversation({
      messages: [{
        role: "assistant",
        text: "内容生成任务已进入队列。",
        metadata: {
          asset_generation_job_id: "asset-generation-job-1",
          asset_generation_status: "queued",
        },
      }],
    });
    const { result, rerender } = renderHook(
      ({ conversations }) => useAssetGenerationJobs({
        token: "token-1",
        conversations,
        onConversationRefreshed: vi.fn(),
        onConversationRefreshError: vi.fn(),
      }),
      { initialProps: { conversations: [] as Conversation[] } },
    );

    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("running");

    rerender({ conversations: [persistedQueued] });

    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("running");
  });

  it("refreshes the conversation once and removes a completed job", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockResolvedValue(generationJob({
        status: "completed",
        result_asset_id: 42,
      }));
    const refreshedConversation = conversation({ title: "已完成的素材" });
    const loadConversationDetail = vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail")
      .mockResolvedValue(refreshedConversation);
    const onConversationRefreshed = vi.fn();
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed,
      onConversationRefreshError: vi.fn(),
    }));

    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(getGenerationJob).toHaveBeenCalledTimes(1);
    expect(loadConversationDetail).toHaveBeenCalledWith("token-1", "conversation-1");
    expect(onConversationRefreshed).toHaveBeenCalledOnce();
    expect(onConversationRefreshed).toHaveBeenCalledWith(refreshedConversation);
    expect(result.current.jobsByConversation["conversation-1"]).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);
    expect(loadConversationDetail).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed job visible when conversation refresh fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "getGenerationJob").mockResolvedValue(
      generationJob({
        status: "completed",
        result_asset_id: 42,
      }),
    );
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail")
      .mockRejectedValue(new Error("refresh unavailable"));
    const onConversationRefreshError = vi.fn();
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError,
    }));

    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onConversationRefreshError).toHaveBeenCalledOnce();
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("completed");
  });

  it("retries a transient polling error after 4s without failing the job", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(generationJob({
        status: "failed",
        error_message: "生成超时，可以重试。",
      }));
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));

    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(2);
    expect(result.current.jobsByConversation["conversation-1"]?.job.status).toBe("failed");
  });

  it("retries a failed job as a new run", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(false);
    const retriedJob = generationJob({
      status: "queued",
      updated_at: "2026-07-30T09:05:00Z",
    });
    const retryGenerationJob = vi.spyOn(assetWorkspaceAdapter, "retryGenerationJob")
      .mockResolvedValue(retriedJob);
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    act(() => {
      result.current.registerJob("conversation-1", generationJob({
        status: "failed",
        error_message: "生成超时，可以重试。",
      }));
    });

    await act(async () => {
      await result.current.retryJob("asset-generation-job-1");
    });

    expect(retryGenerationJob).toHaveBeenCalledWith(
      "token-1",
      "asset-generation-job-1",
    );
    expect(result.current.jobsByConversation["conversation-1"]).toEqual({
      conversationId: "conversation-1",
      job: retriedJob,
      run: 1,
    });
  });

  it("cancels an active job and stops treating it as pollable", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(false);
    const cancelledJob = generationJob({
      status: "cancelled",
      updated_at: "2026-07-30T09:05:00Z",
    });
    const cancelGenerationJob = vi.spyOn(assetWorkspaceAdapter, "cancelGenerationJob")
      .mockResolvedValue(cancelledJob);
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    act(() => {
      result.current.registerJob("conversation-1", generationJob({
        status: "running",
      }));
    });

    await act(async () => {
      await result.current.cancelJob("asset-generation-job-1");
    });

    expect(cancelGenerationJob).toHaveBeenCalledWith(
      "token-1",
      "asset-generation-job-1",
    );
    expect(result.current.jobsByConversation["conversation-1"]?.job).toEqual(cancelledJob);
  });

  it("does not let an older poll overwrite a retried run", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const olderPoll = deferred<AssetGenerationJobResponse>();
    vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockReturnValue(olderPoll.promise);
    vi.spyOn(assetWorkspaceAdapter, "retryGenerationJob").mockResolvedValue(
      generationJob({
        status: "queued",
        updated_at: "2026-07-30T09:05:00Z",
      }),
    );
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await act(async () => {
      await result.current.retryJob("asset-generation-job-1");
    });
    expect(result.current.jobsByConversation["conversation-1"]?.run).toBe(1);

    await act(async () => {
      olderPoll.resolve(generationJob({
        status: "failed",
        error_message: "旧请求失败",
      }));
      await olderPoll.promise;
    });

    expect(result.current.jobsByConversation["conversation-1"]).toMatchObject({
      run: 1,
      job: {
        status: "queued",
        updated_at: "2026-07-30T09:05:00Z",
      },
    });
  });

  it("does not let an older poll overwrite a newly registered job", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const olderPoll = deferred<AssetGenerationJobResponse>();
    vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockReturnValue(olderPoll.promise);
    const { result } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const newerJob = generationJob({
      id: "asset-generation-job-2",
      updated_at: "2026-07-30T09:10:00Z",
    });
    await act(async () => {
      result.current.registerJob("conversation-1", newerJob);
      olderPoll.resolve(generationJob({
        status: "failed",
        error_message: "旧请求失败",
      }));
      await olderPoll.promise;
    });

    expect(result.current.jobsByConversation["conversation-1"]).toEqual({
      conversationId: "conversation-1",
      job: newerJob,
      run: 0,
    });
  });

  it("keeps only one request in flight for the same job run", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const pendingPoll = deferred<AssetGenerationJobResponse>();
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockReturnValue(pendingPoll.promise);
    const { result, rerender } = renderHook(
      ({ token }) => useAssetGenerationJobs({
        token,
        conversations: [],
        onConversationRefreshed: vi.fn(),
        onConversationRefreshError: vi.fn(),
      }),
      { initialProps: { token: "token-1" } },
    );
    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);

    rerender({ token: "token-2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(getGenerationJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingPoll.resolve(generationJob({ status: "running" }));
      await pendingPoll.promise;
    });
  });

  it("cancels scheduled polling when the hook unmounts", async () => {
    vi.useFakeTimers();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockResolvedValue(generationJob({ status: "failed" }));
    const { result, unmount } = renderHook(() => useAssetGenerationJobs({
      token: "token-1",
      conversations: [],
      onConversationRefreshed: vi.fn(),
      onConversationRefreshError: vi.fn(),
    }));
    act(() => {
      result.current.registerJob("conversation-1", generationJob());
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(getGenerationJob).not.toHaveBeenCalled();
  });
});
