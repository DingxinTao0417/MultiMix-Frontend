// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampPreviewHeight,
  previewMaxHeight,
  VideoPreviewResizer,
} from "../components/video-preview-resizer";

afterEach(cleanup);

describe("video preview resizer", () => {
  it("clamps preview height while reserving storyboard space", () => {
    expect(previewMaxHeight(900)).toBe(580);
    expect(previewMaxHeight(500)).toBe(220);
    expect(clampPreviewHeight(180, 220, 580)).toBe(220);
    expect(clampPreviewHeight(700, 220, 580)).toBe(580);
  });

  it("grows downward and shrinks upward", () => {
    const onChange = vi.fn();
    render(<VideoPreviewResizer value={320} min={220} max={580} onChange={onChange} />);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 260 });
    expect(onChange).toHaveBeenLastCalledWith(380);

    fireEvent.pointerMove(window, { clientY: 140 });
    expect(onChange).toHaveBeenLastCalledWith(260);
    fireEvent.pointerUp(window);
  });

  it("supports keyboard adjustment and boundaries", () => {
    const onChange = vi.fn();
    render(<VideoPreviewResizer value={320} min={220} max={580} onChange={onChange} />);
    const separator = screen.getByRole("separator");

    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(344);
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(296);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(220);
    fireEvent.keyDown(separator, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(580);
  });
});
