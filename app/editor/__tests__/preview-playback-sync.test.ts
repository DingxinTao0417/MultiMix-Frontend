// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribePreviewPlaybackUpdates } from "../preview-playback-sync";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preview playback state synchronization", () => {
  it("publishes advancing playback time at a bounded frequency", () => {
    const publish = vi.fn();
    let now = 1_000;
    const unsubscribe = subscribePreviewPlaybackUpdates({
      publish,
      minIntervalMs: 100,
      now: () => now,
    });

    window.dispatchEvent(new CustomEvent("playback-update", { detail: { time: 1 } }));
    now += 50;
    window.dispatchEvent(new CustomEvent("playback-update", { detail: { time: 1.05 } }));
    now += 50;
    window.dispatchEvent(new CustomEvent("playback-update", { detail: { time: 1.1 } }));

    expect(publish).toHaveBeenCalledTimes(2);

    unsubscribe();
    now += 100;
    window.dispatchEvent(new CustomEvent("playback-update", { detail: { time: 1.2 } }));
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
