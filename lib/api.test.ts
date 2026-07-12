import { afterEach, describe, expect, it, vi } from "vitest";

import { apiForm } from "./api";

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

    const resultPromise = apiForm<{ id: number; status: string }>("/assets/upload", "token", new FormData());
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({ id: 42, status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
