// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStableCallback } from "../lib/use-stable-callback";

describe("useStableCallback", () => {
  it("keeps one function identity while invoking the latest closure", () => {
    const first = vi.fn((value: string) => `first:${value}`);
    const second = vi.fn((value: string) => `second:${value}`);
    const { result, rerender } = renderHook(
      ({ callback }) => useStableCallback(callback),
      { initialProps: { callback: first } },
    );
    const initialIdentity = result.current;

    expect(result.current("before")).toBe("first:before");
    rerender({ callback: second });

    expect(result.current).toBe(initialIdentity);
    expect(result.current("after")).toBe("second:after");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
