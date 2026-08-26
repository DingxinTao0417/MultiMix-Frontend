import { describe, expect, it, vi } from "vitest";

import { JobPollingTimeoutError, waitForJobTerminal } from "../job-poller";

describe("waitForJobTerminal", () => {
  it("returns a completed job", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "completed", id: "job-1" });

    const result = await waitForJobTerminal(load, { intervalMs: 0, timeoutMs: 100 });

    expect(result).toEqual({ status: "completed", id: "job-1" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops at the timeout instead of polling forever", async () => {
    const load = vi.fn().mockResolvedValue({ status: "running" });

    await expect(
      waitForJobTerminal(load, { intervalMs: 0, timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(JobPollingTimeoutError);
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForJobTerminal(() => Promise.resolve({ status: "running" }), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
