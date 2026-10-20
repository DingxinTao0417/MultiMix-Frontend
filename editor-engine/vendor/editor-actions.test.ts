// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorCore } from "./editor/core";
import { TimelineManager } from "./editor/core/managers/timeline-manager";
import { SelectionManager } from "./editor/core/managers/selection-manager";
import { CommandManager } from "./editor/core/managers/commands";
import type { TimelineTrack } from "./editor/lib/timeline";
import { useTimelineStore } from "./editor/stores/timeline-store";
import { invokeAction } from "./editor/lib/actions";

const active = vi.hoisted(() => ({ editor: null as unknown }));
vi.mock("@editor/lib/effects/definitions", () => ({ registerDefaultEffects: vi.fn() }));
vi.mock("@editor/core", () => ({ EditorCore: { getInstance: () => active.editor } }));

function fixture() {
  let tracks = [{ id: "main", name: "素材", type: "video", isMain: true, hidden: false, muted: false,
    elements: [{ id: "a", type: "image", name: "A", mediaId: "media-a", startTime: 0,
      duration: 4, trimStart: 0, trimEnd: 0, opacity: 1,
      transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 } }],
  }] as TimelineTrack[];
  let time = 1;
  const editor = {
    scenes: { getActiveScene: () => ({ tracks }), updateSceneTracks: (next: { tracks: TimelineTrack[] }) => { tracks = next.tracks; } },
    project: { getActive: () => ({ settings: { fps: 30 } }) },
    playback: { getCurrentTime: () => time, seek: ({ time: value }: { time: number }) => { time = value; },
      toggle: vi.fn(), pause: vi.fn() },
    command: new CommandManager(),
  } as unknown as EditorCore;
  Object.assign(editor, { timeline: new TimelineManager(editor), selection: new SelectionManager(editor) });
  active.editor = editor;
  editor.selection.setSelectedElements({ elements: [{ trackId: "main", elementId: "a" }] });
  return editor;
}
function elements(editor: EditorCore) { return editor.timeline.getTracks().flatMap((track) => track.elements); }

beforeEach(() => useTimelineStore.setState({ clipboard: null, rippleEditingEnabled: false, snappingEnabled: true }));

describe("visible editor actions use real timeline commands", () => {
  it("splits the selected clip at the actual playhead and supports undo/redo", () => {
    const editor = fixture();
    invokeAction("split");
    expect(elements(editor).map((clip) => clip.duration)).toEqual([1, 3]);
    invokeAction("undo");
    expect(elements(editor).map((clip) => clip.duration)).toEqual([4]);
    invokeAction("redo");
    expect(elements(editor).map((clip) => clip.duration)).toEqual([1, 3]);
  });
  it("deletes selected clips with history instead of silently doing nothing", () => {
    const editor = fixture();
    invokeAction("delete-selected");
    expect(elements(editor)).toHaveLength(0);
    invokeAction("undo");
    expect(elements(editor)).toHaveLength(1);
    invokeAction("redo");
    expect(elements(editor)).toHaveLength(0);
  });
  it("copies a snapshot, pastes at the playhead, and keeps source identity", () => {
    const editor = fixture();
    invokeAction("copy-selected");
    editor.playback.seek({ time: 4 });
    invokeAction("paste-copied");
    expect(elements(editor)).toHaveLength(2);
    expect(elements(editor).map((clip) => clip.startTime).sort((a, b) => a - b)).toEqual([0, 4]);
    expect(elements(editor).every((clip) => "mediaId" in clip && clip.mediaId === "media-a")).toBe(true);
    expect(new Set(elements(editor).map((clip) => clip.id)).size).toBe(2);
    invokeAction("undo");
    expect(elements(editor)).toHaveLength(1);
  });
  it.each([["split-left", 3, 1], ["split-right", 1, 0]] as const)("%s removes the named side", (action, duration, startTime) => {
    const editor = fixture();
    invokeAction(action);
    expect(elements(editor)).toHaveLength(1);
    expect(elements(editor)[0]).toMatchObject({ duration, startTime });
  });
  it("does not create empty history for empty or stale selection", () => {
    const editor = fixture();
    editor.selection.clearSelection();
    invokeAction("split"); invokeAction("delete-selected"); invokeAction("duplicate-selected");
    expect(editor.command.canUndo()).toBe(false);
    editor.selection.setSelectedElements({ elements: [{ trackId: "main", elementId: "missing" }] });
    invokeAction("delete-selected");
    expect(editor.command.canUndo()).toBe(false);
    expect(elements(editor)).toHaveLength(1);
  });
  it("duplicates and toggles only selected elements through reversible commands", () => {
    const editor = fixture();
    invokeAction("duplicate-selected");
    expect(elements(editor)).toHaveLength(2);
    invokeAction("undo");
    expect(elements(editor)).toHaveLength(1);
    editor.selection.setSelectedElements({ elements: [{ trackId: "main", elementId: "a" }] });
    invokeAction("toggle-elements-visibility-selected");
    expect(elements(editor)[0]).toHaveProperty("hidden", true);
    invokeAction("undo");
    expect(elements(editor)[0].hidden).toBeFalsy();
  });
});
