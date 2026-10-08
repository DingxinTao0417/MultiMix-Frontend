// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ActiveVideoIntervals, observeDirectorActivity, observeVideoActivity } from "../product-activity";

describe("observed video interaction intervals", () => {
  it.each([observeVideoActivity, observeDirectorActivity])("ignores synthetic actions and removes observers", (observe) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const stop = observe("token", 42, true);
    try {
      document.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(5000);
      stop();
      document.dispatchEvent(new Event("keydown", { bubbles: true }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
      focus.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
  it("does not watch a director without an editable owned asset scope", () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      for (const [token, id, enabled] of [[null, 42, true], ["token", null, true],
        ["token", 42, false], ["token", -1, true]] as const) {
        observeDirectorActivity(token, id, enabled)();
      }
      expect(vi.getTimerCount()).toBe(before);
    } finally { vi.useRealTimers(); }
  });
  it("does not count mounting or passive background waiting", () => {
    const intervals: number[][] = [];
    const recorder = new ActiveVideoIntervals((start, end) => intervals.push([start, end]));
    recorder.tick(1000);
    recorder.tick(20000);
    recorder.suspend(22000);
    expect(intervals).toEqual([]);
  });

  it("cuts off idle time and immediately stops for blur, hidden or disabled scope", () => {
    const intervals: number[][] = [];
    const recorder = new ActiveVideoIntervals((start, end) => intervals.push([start, end]));
    recorder.interact(1000);
    recorder.tick(10000);
    recorder.tick(20000);
    recorder.interact(30000);
    recorder.suspend(32000);
    recorder.tick(45000);
    expect(intervals).toEqual([[1000, 16000], [30000, 32000]]);
  });

  it("emits bounded intervals during continued work", () => {
    const intervals: number[][] = [];
    const recorder = new ActiveVideoIntervals((start, end) => intervals.push([start, end]));
    recorder.interact(0);
    for (let time = 1000; time <= 35000; time += 1000) recorder.interact(time);
    recorder.suspend(36000);
    expect(intervals).toEqual([[0, 30000], [30000, 36000]]);
  });

  it("does not invent time across a suspended clock or clock reversal", () => {
    const intervals: number[][] = [];
    const recorder = new ActiveVideoIntervals((start, end) => intervals.push([start, end]));
    recorder.interact(1000);
    recorder.tick(100000);
    recorder.interact(101000);
    recorder.tick(100000);
    recorder.suspend(102000);
    expect(intervals).toEqual([]);
  });

  it("keeps each report bounded when the browser timer is delayed", () => {
    const intervals: number[][] = [];
    const recorder = new ActiveVideoIntervals((start, end) => intervals.push([start, end]));
    for (const time of [0, 10000, 20000, 29000, 32000]) recorder.interact(time);
    recorder.suspend(33000);
    expect(intervals).toEqual([[0, 30000], [30000, 33000]]);
  });
});
