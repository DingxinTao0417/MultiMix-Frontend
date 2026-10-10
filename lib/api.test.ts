// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  api,
  apiBlob,
  API_AUTH_EXPIRED_EVENT,
  API_CONNECTION_ERROR,
  apiForm,
  formatComposerError,
  addProjectSource,
  getContentAssetVersionPreview,
  getAssetGenerationJob,
  getCurrentUserPrivileges,
  getConversationAgentAction,
  getProjectResources,
  removeProjectSource,
} from "./api";

describe("shared API base address", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("normalizes deployment whitespace and trailing slashes for workspace and editor", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", " https://api.example.test///\r\n");
    vi.resetModules();
    const client = await import("./api");
    const editor = await import("../editor-engine/vendor/api");
    expect(client.API_BASE).toBe("https://api.example.test");
    expect(client.isApiConfigured).toBe(true);
    expect(editor.API_BASE).toBe(client.API_BASE);
    expect(editor.mediaUrl("supabase://bucket/source")).toBe(
      "https://api.example.test/v1/video/media?ref=supabase%3A%2F%2Fbucket%2Fsource",
    );
  });

  it("treats whitespace-only configuration as disconnected", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", " \r\n");
    vi.resetModules();
    const client = await import("./api");
    expect(client.isApiConfigured).toBe(false);
    expect(client.API_BASE).toBe("http://127.0.0.1:8199");
  });
});

describe("api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the backend database outage contract to a reconcilable connection error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        detail: "数据库暂时不可用，请稍后重试。",
        code: "database_temporarily_unavailable",
        request_id: "request-1",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      })
    ));

    await expect(api("/assets/conversations/messages", "token", {
      method: "POST",
      body: JSON.stringify({ instruction: "确认" }),
    })).rejects.toThrow(API_CONNECTION_ERROR);
  });

  it.each(["json", "blob", "form"])("notifies the auth shell on a %s request 401", async (kind) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "登录已过期" }), { status: 401 }),
    ));
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const request = kind === "blob"
      ? apiBlob("/assets/1/download", "expired-token")
      : kind === "form"
        ? apiForm("/assets/upload", "expired-token", new FormData(), "upload-key")
        : api("/assets/1", "expired-token");

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(dispatch.mock.calls.filter(([event]) => event.type === API_AUTH_EXPIRED_EVENT)).toHaveLength(1);
  });

  it("keeps presenter delivery conflicts as a user-visible validation error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        detail: {
          code: "presenter_delivery_contract_conflict",
          message: "当前方案的交付参数不一致，请刷新方案后重新确认。",
        },
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    ));

    const error = await api("/assets/conversations/messages", "token", {
      method: "POST",
      body: JSON.stringify({ instruction: "确认" }),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "当前方案的交付参数不一致，请刷新方案后重新确认。",
      retryable: false,
      status: 409,
    });
    expect((error as Error).message).not.toBe(API_CONNECTION_ERROR);
  });

  it("never exposes an English provider read timeout", () => {
    expect(formatComposerError(
      new Error("AI generation service failed: The read operation timed out"),
    )).toBe("内容生成超时，本轮没有创建产物，可以直接重试。");
  });

  it("maps mixed-language provider timeouts before returning raw detail", () => {
    expect(formatComposerError(
      new Error("生成失败: The read operation timed out"),
    )).toBe("内容生成超时，本轮没有创建产物，可以直接重试。");
  });

  it("bypasses caches for generation and agent action polling", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "action-1", status: "queued" })));
    vi.stubGlobal("fetch", fetchMock);

    await getAssetGenerationJob("token", "job-1");
    await getConversationAgentAction("token", "conversation-1", "action-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/assets/generation-jobs/job-1"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/agent-actions/action-1"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads diagnostics eligibility from the backend user role", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ is_admin: false, is_pilot: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentUserPrivileges("token")).resolves.toEqual({ is_admin: false, is_pilot: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses explicit project resource targets for reads and membership writes", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 20 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation_id: "project-1", asset_id: 42, state: "active" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation_id: "project-1", asset_id: 42, state: "removed" })));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectResources("token", "project-1", "source", "history", 20, 20);
    await addProjectSource("token", "project-1", 42);
    await removeProjectSource("token", "project-1", 42);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/assets/conversations/project-1/resources?kind=source&scope=history&offset=20&limit=20"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/assets/conversations/project-1/sources/42"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/assets/conversations/project-1/sources/42"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("loads a historical version as a read-only preview", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, title: "历史版本" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getContentAssetVersionPreview("token", 42, 7);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/assets/42/versions/7/preview"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});

describe("apiForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries one transient database outage before returning the upload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Database is not reachable." }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, status: "ready" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = apiForm<{ id: number; status: string }>("/assets/upload", "token", new FormData(), "stable-upload-key");
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({ id: 42, status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, request] of fetchMock.mock.calls) {
      expect((request?.headers as Record<string, string>)?.["Idempotency-Key"]).toBe("stable-upload-key");
    }
  });

  it("does not retry a transient response when no idempotency key was supplied", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Gateway failure" }), { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiForm("/assets/upload", "token", new FormData())).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry validation failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Unsupported upload library." }), {
        status: 422,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiForm("/assets/upload", "token", new FormData())).rejects.toThrow(
      "Unsupported upload library."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
