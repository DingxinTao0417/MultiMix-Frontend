# 视频预览尺寸拖动与播放控制实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: use executing-plans task-by-task. The workspace forbids Subagent execution unless the user explicitly approves this exact scope.

**Goal:** 在视频工程浏览态中提供保持原始比例的可调预览区、成片播放控制和无成片时的单分镜预览，并让成片时间与分镜高亮双向同步。

**Architecture:** 新建一个无业务依赖的横向分隔条组件和一个复用的轻量视频播放器组件。ProductPreview 继续负责“成片或单分镜”的真实状态选择和分镜同步，StoryboardPreview 只负责当前单个分镜素材，不引入自动串播。所有尺寸只存 React 页面状态，不写 localStorage 或后端。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest 4、Testing Library、现有全局 CSS。

## Global Constraints

- 不启动 Subagent；改变执行方式必须重新取得用户明确批准。
- 不修改 MultiMix-Backend、video_project 数据结构、素材匹配、asset_reference、mg_decision 或数据库。
- 成片地址继续按 video_project.mp4_ref -> mp4_artifact -> video_url / preview_url 解析。
- 分镜继续按 video_project.segments -> video_segments -> video_plan.scenes 解析。
- 有可播放成片时显示完整成片；没有成片但工程已就绪时只显示当前单个分镜。
- 单分镜模式禁止自动串播多个分镜，禁止模拟伪成片。
- 图片分镜静态展示；视频分镜可播放；无素材显示“待补素材”。
- 视频和图片始终按工程比例 contain，不拉伸、不裁切。
- 向下拖动增加预览高度，向上拖动减小；保留播放器和分镜列表最小可用空间。
- 分隔条必须使用 role="separator"、aria-orientation="horizontal" 并支持 ArrowUp、ArrowDown、Home、End。
- 预览尺寸只在当前组件生命周期保存，不使用 localStorage/sessionStorage。
- app/globals.css、product-preview.tsx、product-workspace.tsx 和现有视频测试当前有并行未提交改动。实施每一任务前必须重新读取目标片段并使用定点补丁，禁止整文件覆盖或暂存无关改动。
- 未经用户明确要求不创建 Git commit；每个任务以测试检查点代替提交检查点。
- 本计划不启动后端、不创建 SQLite。若执行时增加浏览器 E2E，必须提前告知临时库路径、独立端口和清理策略。

## File Map

- Create: MultiMix-Frontend/app/assets/components/video-preview-resizer.tsx — 高度 clamp、指针拖动、键盘调整和 separator 无障碍语义。
- Create: MultiMix-Frontend/app/assets/components/video-preview-player.tsx — 播放/暂停、当前时间、总时长、可拖动进度条和加载失败。
- Create: MultiMix-Frontend/app/assets/__tests__/video-preview-resizer.test.tsx — 拖动方向、边界和键盘行为。
- Create: MultiMix-Frontend/app/assets/__tests__/video-preview-player.test.tsx — 播放、暂停、seek、时间格式和失败重试。
- Modify: MultiMix-Frontend/app/assets/components/product-preview.tsx — 自动选择成片/分镜模式、预览高度状态、分镜时间同步。
- Modify: MultiMix-Frontend/app/assets/components/storyboard-preview.tsx — 单分镜标签、视频播放器复用、图片/待补素材真实降级。
- Modify: MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx — 成片/分镜模式、错误降级和同步集成测试。
- Modify: MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts — 静态架构契约更新。
- Modify: MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts — 可调预览与独立分镜滚动契约。
- Modify: MultiMix-Frontend/app/globals.css — 播放器、contain 比例、分隔条和可调布局。
- Reference: docs/specs/ui/video-artifact-browse-and-edit-states.md。

---

### Task 1: 可访问的预览高度分隔条

**Files:**

- Create: MultiMix-Frontend/app/assets/components/video-preview-resizer.tsx
- Create: MultiMix-Frontend/app/assets/__tests__/video-preview-resizer.test.tsx

**Interfaces:**

- Produces: PREVIEW_MIN_HEIGHT = 220
- Produces: PREVIEW_DEFAULT_HEIGHT = 360
- Produces: previewMaxHeight(viewportHeight: number): number
- Produces: clampPreviewHeight(value: number, min: number, max: number): number
- Produces: VideoPreviewResizer({ value, min, max, onChange }): JSX.Element

**Reproduction case:** 当前视频和分镜之间没有可拖动边界，播放器高度由固定的 min(52vh, 440px) 决定。

- [x] **Step 1: 写失败测试**

~~~tsx
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
~~~

- [x] **Step 2: 运行测试并确认因组件不存在而失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/video-preview-resizer.test.tsx
~~~

Expected: FAIL，无法解析 video-preview-resizer。

- [x] **Step 3: 实现最小分隔条**

~~~tsx
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
      className={"shadcn-prototype-video-preview-resizer" + (drag ? " dragging" : "")}
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
~~~

- [x] **Step 4: 运行组件测试并确认通过**

Run:

~~~powershell
npm test -- app/assets/__tests__/video-preview-resizer.test.tsx
~~~

Expected: 3 tests PASS。

- [x] **Step 5: 检查任务边界**

Run:

~~~powershell
git status --short
git diff -- app/assets/components/video-preview-resizer.tsx app/assets/__tests__/video-preview-resizer.test.tsx
~~~

Expected: 只出现本任务两个新文件；不暂存其他改动。

**Validation cases:**

- [x] 向下拖动增加高度，向上拖动减少高度。
- [x] 高度永远限制在 min/max 内。
- [x] ArrowUp/ArrowDown/Home/End 可用。
- [x] separator 暴露当前、最小和最大值。

---

### Task 2: 可复用的轻量播放器控制

**Files:**

- Create: MultiMix-Frontend/app/assets/components/video-preview-player.tsx
- Create: MultiMix-Frontend/app/assets/__tests__/video-preview-player.test.tsx

**Interfaces:**

- Produces: formatPreviewTime(seconds: number): string
- Produces: VideoPreviewPlayerProps
- Produces: forwardRef<HTMLVideoElement, VideoPreviewPlayerProps>
- Consumes: ratioClassName 为 ratio-landscape 或 ratio-portrait
- Emits: onTimeUpdate(time: number) 与 onError()

**Reproduction case:** 当前成片和分镜视频依赖浏览器原生 controls，外观与当前原型不一致，也无法统一加载失败和时间显示。

- [x] **Step 1: 写播放器失败测试**

~~~tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VideoPreviewPlayer, { formatPreviewTime } from "../components/video-preview-player";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("video preview player", () => {
  it("formats player time", () => {
    expect(formatPreviewTime(0)).toBe("00:00");
    expect(formatPreviewTime(65.8)).toBe("01:05");
  });

  it("plays, pauses, and seeks from the shared controls", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const onTimeUpdate = vi.fn();
    const { container } = render(
      <VideoPreviewPlayer
        src="/demo.mp4"
        label="成片预览"
        ratioClassName="ratio-landscape"
        onTimeUpdate={onTimeUpdate}
      />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole("button", { name: "点击画面播放视频" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "暂停视频" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), { target: { value: "12" } });
    expect(video.currentTime).toBe(12);
    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12);

    fireEvent.click(screen.getByRole("button", { name: "暂停视频" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("shows a recoverable error instead of an unexplained black screen", () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPreviewPlayer
        src="/broken.mp4"
        label="成片预览"
        ratioClassName="ratio-landscape"
        onError={onError}
      />,
    );
    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent("视频暂时无法加载");
    expect(screen.getByRole("button", { name: "重新加载视频" })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });
});
~~~

- [x] **Step 2: 运行测试并确认失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/video-preview-player.test.tsx
~~~

Expected: FAIL，无法解析 video-preview-player。

- [x] **Step 3: 实现播放器**

实现文件必须包含以下完整行为；图标使用 lucide-react 的 Play 与 Pause，不创建第二套图标资源：

~~~tsx
"use client";

import { Pause, Play } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

export type VideoPreviewPlayerProps = {
  src: string;
  label: string;
  ratioClassName: string;
  initialTime?: number;
  onTimeUpdate?: (time: number) => void;
  onError?: () => void;
};

export function formatPreviewTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return minutes + ":" + remainder;
}

const VideoPreviewPlayer = forwardRef<HTMLVideoElement, VideoPreviewPlayerProps>(
  function VideoPreviewPlayer({
    src,
    label,
    ratioClassName,
    initialTime = 0,
    onTimeUpdate,
    onError,
  }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement | null>(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadRevision, setReloadRevision] = useState(0);

    const assignRef = useCallback((node: HTMLVideoElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);

    useEffect(() => {
      setDuration(0);
      setCurrentTime(0);
      setPlaying(false);
      setFailed(false);
    }, [src, reloadRevision]);

    const togglePlayback = () => {
      const video = localRef.current;
      if (!video) return;
      if (playing) video.pause();
      else void video.play().catch(() => setFailed(true));
    };

    const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.currentTarget.value);
      if (!localRef.current || !Number.isFinite(next)) return;
      localRef.current.currentTime = next;
      setCurrentTime(next);
      onTimeUpdate?.(next);
    };

    if (failed) {
      return (
        <div className={"shadcn-prototype-preview-player " + ratioClassName} aria-label={label}>
          <div className="shadcn-prototype-preview-player-error" role="alert">
            <strong>视频暂时无法加载</strong>
            <button type="button" onClick={() => {
              setFailed(false);
              setReloadRevision((value) => value + 1);
            }}>
              重新加载视频
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={"shadcn-prototype-preview-player " + ratioClassName} aria-label={label}>
        <button
          type="button"
          className="shadcn-prototype-preview-player-screen"
          aria-label={playing ? "点击画面暂停视频" : "点击画面播放视频"}
          onClick={togglePlayback}
        >
          <video
            key={src + "::" + reloadRevision}
            ref={assignRef}
            src={src}
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              if (initialTime > 0 && initialTime < video.duration) {
                video.currentTime = initialTime;
                setCurrentTime(initialTime);
              }
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setCurrentTime(time);
              onTimeUpdate?.(time);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
              onError?.();
            }}
          />
          {!playing ? <Play size={28} fill="currentColor" aria-hidden="true" /> : null}
        </button>
        <div className="shadcn-prototype-project-preview-controls">
          <button type="button" aria-label={playing ? "暂停视频" : "播放视频"} onClick={togglePlayback}>
            {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
          </button>
          <span>{formatPreviewTime(currentTime)}</span>
          <input
            type="range"
            aria-label="播放进度"
            min="0"
            max={duration || 0}
            step="0.01"
            value={Math.min(currentTime, duration || currentTime)}
            disabled={!duration}
            onChange={handleSeek}
          />
          <span>{formatPreviewTime(duration)}</span>
        </div>
      </div>
    );
  },
);

export default VideoPreviewPlayer;
~~~

- [x] **Step 4: 运行播放器测试**

Run:

~~~powershell
npm test -- app/assets/__tests__/video-preview-player.test.tsx
~~~

Expected: 3 tests PASS。

- [x] **Step 5: 检查任务边界**

Run:

~~~powershell
git diff -- app/assets/components/video-preview-player.tsx app/assets/__tests__/video-preview-player.test.tsx
~~~

Expected: 只包含播放器和测试，不修改业务状态判断。

**Validation cases:**

- [x] 点击画面和控制按钮都能播放/暂停。
- [x] 当前时间和总时长使用 mm:ss。
- [x] range 可以 seek。
- [x] 加载失败显示明确错误和重试。
- [x] 播放器不使用原生 controls。

---

### Task 3: 接入成片模式与单分镜模式

**Files:**

- Modify: MultiMix-Frontend/app/assets/components/product-preview.tsx:1-13, 293-358
- Modify: MultiMix-Frontend/app/assets/components/storyboard-preview.tsx
- Modify: MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx
- Modify: MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts

**Interfaces:**

- Consumes: VideoPreviewPlayer from Task 2
- Consumes: VideoPreviewResizer, PREVIEW_MIN_HEIGHT, PREVIEW_DEFAULT_HEIGHT, previewMaxHeight, clampPreviewHeight from Task 1
- Preserves: playableVideoUrl、activeSegmentAtTime、videoPlaybackPositions、SegmentCards、onReplaceMaterial
- Produces: full-video mode when exportedVideoUrl is usable; single-segment mode otherwise
- Produces: visible labels “成片预览” and “分镜预览 · #N”

**Reproduction case:** 当前外层始终 aria-label="成片预览"；无 MP4 时虽然使用 StoryboardPreview，但缺少明确模式标签和可调高度；播放器仍使用原生 controls。

- [x] **Step 1: 写模式与联动失败测试**

在 display-area-cases.test.tsx 中增加 fireEvent，并把现有两条模式测试扩展为：

~~~tsx
it("labels the no-MP4 project as a single storyboard preview", () => {
  render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
  expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
  expect(screen.getByText("分镜预览 · #1")).toBeInTheDocument();
  expect(screen.queryByLabelText("成片预览")).not.toBeInTheDocument();
});

it("uses the shared player for a playable finished video", () => {
  render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
  expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "播放视频" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "调整视频预览高度" })).toBeInTheDocument();
});

it("switches a failed full video to a recoverable storyboard preview", () => {
  const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
  fireEvent.error(container.querySelector("video")!);
  expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("成片加载失败");
  fireEvent.click(screen.getByRole("button", { name: "重试成片" }));
  expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
});
~~~

更新现有无 MP4 workspace 测试：将 getByLabelText("成片预览") 改为 getByLabelText("分镜预览")。

在 video-browse-contract.test.ts 中要求：

~~~ts
expect(preview).toContain("<VideoPreviewPlayer");
expect(preview).toContain("<VideoPreviewResizer");
expect(preview).toContain('exportedVideoUrl && !fullVideoFailed');
expect(preview).toContain('hint={showFullVideo');
expect(storyboardPreview).toContain("分镜预览 · #");
expect(storyboardPreview).not.toContain("controls");
~~~

- [x] **Step 2: 运行集成测试并确认旧实现失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/display-area-cases.test.tsx app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/product-workspace-video-actions.test.tsx
~~~

Expected: FAIL；旧实现没有共享播放器、分隔条和正确模式标签。

- [x] **Step 3: 在 StoryboardPreview 接入单分镜播放器**

- 保留 findMediaForSegment 和 mediaUrlForRef。
- 导入 VideoPreviewPlayer。
- 视频素材替换为 VideoPreviewPlayer，不使用原生 controls。
- 图片继续使用 img，但 alt 保持分镜语义。
- 在预览顶部渲染可见标签：

~~~tsx
<span className="shadcn-prototype-preview-mode-label">
  分镜预览 · #{segment?.index ?? 1}
</span>
~~~

- 视频素材：

~~~tsx
<VideoPreviewPlayer
  key={currentSegmentMedia.src}
  src={currentSegmentMedia.src}
  label={"分镜 #" + (segment?.index ?? 1) + " 视频"}
  ratioClassName={getProductRatioClass(product.ratio)}
  onError={() => setFailed(true)}
/>
~~~

- 图片或待补素材继续放在 shadcn-prototype-project-preview-screen 内。
- 无素材占位文案固定为“待补素材”，副文案使用 segment.line 或“该分镜暂无可预览素材”。
- 将图片 CSS 目标从 object-fit: cover 改为 object-fit: contain；不得改 asset_reference 或素材选择。

- [x] **Step 4: 在 ProductPreview 接入模式和高度**

导入 useEffect、VideoPreviewPlayer 和 VideoPreviewResizer API。新增状态：

~~~tsx
const [previewHeight, setPreviewHeight] = useState(PREVIEW_DEFAULT_HEIGHT);
const [previewMax, setPreviewMax] = useState(() => (
  typeof window === "undefined" ? 640 : previewMaxHeight(window.innerHeight)
));
const [fullVideoFailed, setFullVideoFailed] = useState(false);

useEffect(() => {
  const updateBounds = () => {
    const nextMax = previewMaxHeight(window.innerHeight);
    setPreviewMax(nextMax);
    setPreviewHeight((current) => clampPreviewHeight(current, PREVIEW_MIN_HEIGHT, nextMax));
  };
  window.addEventListener("resize", updateBounds);
  return () => window.removeEventListener("resize", updateBounds);
}, []);

useEffect(() => setFullVideoFailed(false), [exportedVideoUrl]);

const showFullVideo = Boolean(exportedVideoUrl && !fullVideoFailed);
~~~

把 browse 外层 aria-label 改为：

~~~tsx
aria-label={showFullVideo ? "成片预览" : "分镜预览"}
~~~

预览容器使用当前页面高度状态：

~~~tsx
<div
  className="shadcn-prototype-product-video"
  style={{ height: previewHeight }}
>
  {showFullVideo ? (
    <VideoPreviewPlayer
      ref={browsePlayerRef}
      src={exportedVideoUrl}
      label="成片播放器"
      ratioClassName={getProductRatioClass(product.ratio)}
      initialTime={videoPlaybackPositions.get(exportedVideoUrl) ?? 0}
      onTimeUpdate={(time) => {
        videoPlaybackPositions.set(exportedVideoUrl, time);
        setActiveSegmentId(activeSegmentAtTime(product.segments, time));
      }}
      onError={() => setFullVideoFailed(true)}
    />
  ) : (
    <StoryboardPreview
      product={product}
      activeSegmentId={activeSegmentId ?? product.segments?.[0]?.id ?? null}
    />
  )}
</div>
~~~

在预览与 SegmentCards 之间加入：

~~~tsx
<VideoPreviewResizer
  value={previewHeight}
  min={PREVIEW_MIN_HEIGHT}
  max={previewMax}
  onChange={setPreviewHeight}
/>
~~~

完整成片失败后、分隔条之前显示：

~~~tsx
{fullVideoFailed ? (
  <p className="shadcn-prototype-video-preview-error" role="alert">
    成片加载失败，已切换到分镜预览。
    <button type="button" onClick={() => setFullVideoFailed(false)}>重试成片</button>
  </p>
) : null}
~~~

SegmentCards 的 hint 改为：

~~~tsx
hint={showFullVideo ? "点击任意分镜可跳转成片" : "点击任意分镜可切换预览"}
~~~

onSelect 保持 setActiveSegmentId；只有 showFullVideo 且 player 存在时才设置 currentTime 并调用 play。单分镜模式只切换当前分镜，禁止计时器自动切换下一个分镜。

- [x] **Step 5: 运行模式与联动测试**

Run:

~~~powershell
npm test -- app/assets/__tests__/display-area-cases.test.tsx app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/product-workspace-video-actions.test.tsx app/assets/__tests__/video-preview-player.test.tsx app/assets/__tests__/video-preview-resizer.test.tsx
~~~

Expected: 全部 PASS。

- [x] **Step 6: 检查 diff**

Run:

~~~powershell
git diff -- app/assets/components/product-preview.tsx app/assets/components/storyboard-preview.tsx app/assets/__tests__/display-area-cases.test.tsx app/assets/__tests__/video-browse-contract.test.ts
~~~

Expected: 不修改 product-workspace 的素材替换、导出桥或编辑态逻辑。

**Validation cases:**

- [x] 有 MP4 显示成片播放器。
- [x] 无 MP4 显示默认第一镜的单分镜预览。
- [x] 单分镜视频使用共享播放器，图片静态展示，缺素材显示待补素材。
- [x] 成片播放时间更新分镜高亮。
- [x] 成片模式点击分镜 seek 并播放；分镜模式只切换分镜。
- [x] 成片加载失败可退到分镜并重试。
- [x] 单分镜模式没有自动串播逻辑。

---

### Task 4: 可调布局、原始比例和视觉契约

**Files:**

- Modify: MultiMix-Frontend/app/globals.css:2683-2904, 7165-7209
- Modify: MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts
- Modify: MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts

**Interfaces:**

- Consumes Task 1/2/3 class names。
- Produces .shadcn-prototype-preview-player、.shadcn-prototype-video-preview-resizer、.shadcn-prototype-preview-mode-label。
- Preserves .shadcn-prototype-stage-scroll-surface as the single outer display scroll contract。

**Reproduction case:** 当前预览使用固定高度；分镜图片和视频 object-fit: cover 会裁切；现有 product-stage-style-contract 仍断言旧的三元源码结构。

- [x] **Step 1: 先更新失败的样式契约**

在 product-stage-style-contract.test.ts 中：

- 删除对旧源码字符串 “!showEditorEmbed && previewShowsBrowse ? (” 的断言，替换为当前浏览面存在检查，不顺手修改 product-workspace。
- 将“视频预览在上、分镜独立滚动”测试扩展为：

~~~ts
expect(css).toMatch(/\.shadcn-prototype-video-browse\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
expect(css).toMatch(/\.shadcn-prototype-video-preview-resizer\s*\{[^}]*cursor:\s*row-resize;/s);
expect(css).toMatch(/\.shadcn-prototype-video-browse\s*>\s*\.shadcn-prototype-segment-cards\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;/s);
expect(css).toMatch(/\.shadcn-prototype-project-preview-screen\s*>\s*:is\(img, video\)\s*\{[^}]*object-fit:\s*contain;/s);
expect(preview).toContain("<VideoPreviewResizer");
~~~

在 video-browse-contract.test.ts 中继续要求 16:9 和 9:16 ratio class，不再要求固定 min(52vh, 440px)。

- [x] **Step 2: 运行契约测试并确认失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/product-stage-style-contract.test.ts app/assets/__tests__/video-browse-contract.test.ts
~~~

Expected: FAIL；新分隔条和 contain 样式尚未存在。

- [x] **Step 3: 定点加入布局样式**

在现有视频浏览样式附近加入：

~~~css
.shadcn-prototype-video-browse > .shadcn-prototype-product-video {
  position: relative;
  display: grid;
  min-height: 0;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
}

.shadcn-prototype-preview-player {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  place-items: stretch;
}

.shadcn-prototype-preview-player-screen {
  position: relative;
  display: grid;
  min-height: 0;
  place-items: center;
  overflow: hidden;
  border: 0;
  border-radius: 14px;
  background: #101514;
  color: #ffffff;
  padding: 0;
}

.shadcn-prototype-preview-player-screen video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.shadcn-prototype-preview-player-screen > svg {
  position: absolute;
  pointer-events: none;
}

.shadcn-prototype-preview-player.ratio-landscape .shadcn-prototype-preview-player-screen {
  aspect-ratio: 16 / 9;
  width: min(100%, 720px);
  justify-self: center;
}

.shadcn-prototype-preview-player.ratio-portrait .shadcn-prototype-preview-player-screen {
  aspect-ratio: 9 / 16;
  width: auto;
  max-width: 100%;
  justify-self: center;
}

.shadcn-prototype-preview-mode-label {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  border-radius: 999px;
  background: rgba(32, 31, 30, 0.72);
  color: #ffffff;
  padding: 4px 9px;
  font-size: 11px;
  font-weight: 650;
}

.shadcn-prototype-video-preview-resizer {
  display: grid;
  flex: 0 0 14px;
  place-items: center;
  cursor: row-resize;
  touch-action: none;
  outline: none;
}

.shadcn-prototype-video-preview-resizer > span {
  width: 44px;
  height: 4px;
  border-radius: 999px;
  background: var(--sp-border-strong);
  transition: width 150ms ease, background 150ms ease;
}

.shadcn-prototype-video-preview-resizer:hover > span,
.shadcn-prototype-video-preview-resizer:focus-visible > span,
.shadcn-prototype-video-preview-resizer.dragging > span {
  width: 58px;
  background: var(--sp-accent);
}

.shadcn-prototype-video-preview-error {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sp-danger);
  font-size: 12px;
}

.shadcn-prototype-video-preview-error button {
  border: 0;
  background: transparent;
  color: var(--sp-accent);
  font-weight: 650;
}

.shadcn-prototype-project-preview-screen > :is(img, video) {
  object-fit: contain;
}
~~~

用以下规则替换现有 project-preview 的固定 220px 主尺寸；保留现有 project-preview-controls 的四列结构，供共享播放器复用：

~~~css
.shadcn-prototype-project-preview {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  place-items: center;
  overflow: hidden;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.shadcn-prototype-project-preview-screen {
  position: relative;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--sp-border);
  border-radius: 14px;
  background: #101514;
}

.shadcn-prototype-project-preview.ratio-landscape .shadcn-prototype-project-preview-screen {
  aspect-ratio: 16 / 9;
  width: min(100%, 720px);
  height: auto;
}

.shadcn-prototype-project-preview.ratio-portrait .shadcn-prototype-project-preview-screen {
  aspect-ratio: 9 / 16;
  width: auto;
  height: 100%;
}
~~~

在 prefers-reduced-motion: reduce 中禁用分隔条 transition。

- [x] **Step 4: 运行样式契约和组件测试**

Run:

~~~powershell
npm test -- app/assets/__tests__/product-stage-style-contract.test.ts app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/video-preview-player.test.tsx app/assets/__tests__/video-preview-resizer.test.tsx
~~~

Expected: 全部 PASS。

- [x] **Step 5: 检查 globals.css 目标和既有改动边界**

Run:

~~~powershell
git diff -- app/globals.css
git diff --check
~~~

Expected: 新规则位于视频浏览/分镜预览区域；不覆盖素材选择器、胶片条和其他并行 CSS 变更。

**Validation cases:**

- [x] 16:9 和 9:16 都保持原始比例。
- [x] 图片和视频使用 contain，不裁切。
- [x] 分隔条 hover/focus/drag 可识别。
- [x] 预览高度变化时分镜列表仍独立滚动。
- [x] reduced-motion 下没有多余过渡动画。

---

### Task 5: 完整回归、文档勾选和计划归档

**Files:**

- Verify: Tasks 1–4 所有前端文件。
- Modify after successful verification: docs/specs/ui/video-artifact-browse-and-edit-states.md。
- Move after all required checks pass: 本计划从 docs/plans/active/ 移到 docs/archive/plans/。

- [x] **Step 1: 运行聚焦测试**

~~~powershell
npm test -- app/assets/__tests__/video-preview-resizer.test.tsx app/assets/__tests__/video-preview-player.test.tsx app/assets/__tests__/display-area-cases.test.tsx app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/product-workspace-video-actions.test.tsx app/assets/__tests__/product-stage-style-contract.test.ts
~~~

Expected: 全部 PASS。

- [x] **Step 2: 运行完整前端测试**

~~~powershell
npm test
~~~

Expected: Vitest 退出码 0。若并行工作仍产生无关失败，记录准确文件和错误，保持计划 active，不修改无关链路。

- [x] **Step 3: 按顺序运行生产构建和类型检查**

Run first:

~~~powershell
npm run build
~~~

After build completes, run:

~~~powershell
npm run typecheck
~~~

Expected: 两条命令退出码均为 0。禁止并行运行 build 和 typecheck，以免 .next-build/types 发生竞态。

- [x] **Step 4: 运行文档检查**

~~~powershell
npm --prefix MultiMix-Frontend run docs:check
~~~

Expected: Docs check passed.

- [x] **Step 5: 做源码验收**

~~~powershell
rg -n "成片预览|分镜预览|VideoPreviewPlayer|VideoPreviewResizer|role=\"separator\"|object-fit: contain|localStorage|sessionStorage" app/assets app/globals.css
~~~

Expected:

- 两种模式标签、播放器和分隔条存在于目标组件/测试。
- contain 规则存在。
- 新组件不命中 localStorage 或 sessionStorage。

- [x] **Step 6: 做最终工作区边界检查**

~~~powershell
git status --short
git diff --check
git diff -- app/assets/components/video-preview-resizer.tsx app/assets/components/video-preview-player.tsx app/assets/components/product-preview.tsx app/assets/components/storyboard-preview.tsx app/assets/__tests__/video-preview-resizer.test.tsx app/assets/__tests__/video-preview-player.test.tsx app/assets/__tests__/display-area-cases.test.tsx app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/product-stage-style-contract.test.ts app/globals.css
~~~

Expected: 最终汇报单列本任务文件和进入任务前已有的并行改动；不暂存、不提交用户改动。

- [x] **Step 7: 勾选规格验证案例**

只在对应自动化测试或明确源码证据通过后，将 docs/specs/ui/video-artifact-browse-and-edit-states.md 中本功能的验证项从 [ ] 改为 [x]。不得勾选未验证的浏览器视觉结果。

- [x] **Step 8: 所有必需检查通过后归档计划**

Move:

~~~text
docs/plans/active/2026-07-12-video-preview-resize-playback-implementation.md
-> docs/archive/plans/2026-07-12-video-preview-resize-playback-implementation.md
~~~

Run:

~~~powershell
npm --prefix MultiMix-Frontend run docs:check
~~~

Expected: Docs check passed；归档计划保留完整勾选项和验证结果。

**Final acceptance:**

- [x] 成片与单分镜模式按真实可播放地址自动选择。
- [x] 单分镜模式只显示当前分镜，不自动串播。
- [x] 播放、暂停、seek、时间显示和分镜高亮可用。
- [x] 向下拖动放大、向上拖动缩小，键盘也可调整。
- [x] 所有视频和图片保持原始比例，不拉伸、不裁切。
- [x] 视频加载失败不长期停留在无说明黑屏。
- [x] 分镜列表保持独立滚动和可操作空间。
- [x] 聚焦测试、完整测试、build、typecheck 和 docs:check 都有明确结果。
