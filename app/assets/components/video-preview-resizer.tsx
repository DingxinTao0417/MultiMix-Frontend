"use client";

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

export const PREVIEW_MIN_HEIGHT = 220;
export const PREVIEW_DEFAULT_HEIGHT = 360;
const STORYBOARD_RESERVED_HEIGHT = 320;
const PREVIEW_MAX_CAP = 640;
const KEYBOARD_STEP = 24;

export function previewMaxHeight(viewportHeight: number): number {
  return Math.max(
    PREVIEW_MIN_HEIGHT,
    Math.min(PREVIEW_MAX_CAP, viewportHeight - STORYBOARD_RESERVED_HEIGHT),
  );
}

export function clampPreviewHeight(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function VideoPreviewResizer({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (height: number) => void;
}) {
  const [drag, setDrag] = useState<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      onChange(clampPreviewHeight(drag.startHeight + event.clientY - drag.startY, min, max));
    };
    const onPointerUp = () => setDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag, max, min, onChange]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag({ startY: event.clientY, startHeight: value });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowDown"
      ? value + KEYBOARD_STEP
      : event.key === "ArrowUp"
        ? value - KEYBOARD_STEP
        : event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : null;
    if (next == null) return;
    event.preventDefault();
    onChange(clampPreviewHeight(next, min, max));
  };

  return (
    <div
      className={`shadcn-prototype-video-preview-resizer${drag ? " dragging" : ""}`}
      role="separator"
      aria-label="调整视频预览高度"
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
