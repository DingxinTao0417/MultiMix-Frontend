import { describe, expect, it, vi } from "vitest";

import { TimelineSaveCoordinator } from "../timeline-save-coordinator";

describe("TimelineSaveCoordinator", () => {
  it("saves the latest dirty version after a queued obsolete snapshot is skipped", async () => {
    let rejectFirst!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const save = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
    const states: string[] = [];
    const coordinator = new TimelineSaveCoordinator({ save, onStateChange: (state) => states.push(state) });
    coordinator.markDirty();
    const flush = coordinator.flush();
    coordinator.markDirty();
    rejectFirst(new DOMException("Save superseded", "AbortError"));
    await expect(flush).resolves.toEqual({ status: "saved" });
    expect(save).toHaveBeenCalledTimes(2);
    expect(states).not.toContain("error");
    coordinator.dispose();
  });

  it("surfaces a structured version conflict without replacing it with a network hint", async () => {
    const save = vi.fn(async () => { throw new Error("version-conflict"); });
    const coordinator = new TimelineSaveCoordinator({ save, onStateChange: vi.fn(),
      formatError: () => "工程已有新的修改，当前编辑未覆盖它。" });
    coordinator.markDirty();
    await expect(coordinator.flush()).resolves.toEqual({ status: "error", message: "工程已有新的修改，当前编辑未覆盖它。" });
    coordinator.dispose();
  });

  it("flushes a queued debounce immediately without waiting or duplicating the PUT", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const coordinator = new TimelineSaveCoordinator({ save, onStateChange: vi.fn() });

    coordinator.markDirty();
    await coordinator.flush();
    await vi.advanceTimersByTimeAsync(800);

    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("serializes an edit made during an in-flight request and shares duplicate flushes", async () => {
    let finishFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);
    const coordinator = new TimelineSaveCoordinator({ save, onStateChange: vi.fn() });

    coordinator.markDirty();
    const firstFlush = coordinator.flush();
    const duplicateFlush = coordinator.flush();
    coordinator.markDirty();
    finishFirst();

    await expect(firstFlush).resolves.toEqual({ status: "saved" });
    await expect(duplicateFlush).resolves.toEqual({ status: "saved" });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps the dirty version after a failed request and lets a later flush retry it", async () => {
    const states: string[] = [];
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce(undefined);
    const coordinator = new TimelineSaveCoordinator({
      save,
      onStateChange: (status) => states.push(status),
    });

    coordinator.markDirty();
    await expect(coordinator.flush()).resolves.toEqual({
      status: "error",
      message: "保存失败，请检查网络后重试。",
    });
    await expect(coordinator.flush()).resolves.toEqual({ status: "saved" });

    expect(save).toHaveBeenCalledTimes(2);
    expect(states).toContain("error");
    expect(states.at(-1)).toBe("saved");
  });
});
