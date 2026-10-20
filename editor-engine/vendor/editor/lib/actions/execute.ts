import { EditorCore } from "@editor/core";
import { cancelInteraction } from "@editor/lib/cancel-interaction";
import { useTimelineStore } from "@editor/stores/timeline-store";
import type { TAction, TActionArgsMap, TActionWithArgs, TActionWithOptionalArgs, TArgOfAction, TInvocationTrigger } from "./types";

type InvokeAction = {
  (action: TActionWithOptionalArgs, args?: undefined, trigger?: TInvocationTrigger): void;
  <A extends TActionWithArgs>(action: A, args: TActionArgsMap[A], trigger?: TInvocationTrigger): void;
};

// UI actions share the current editor's command history, never a second registry.
export const invokeAction: InvokeAction = <A extends TAction>(action: A, args?: TArgOfAction<A>) => {
  const editor = EditorCore.getInstance();
  const project = editor.project.getActive();
  if (!project || !editor.scenes.getActiveScene()) return;
  const timeline = editor.timeline;
  const selection = editor.selection;
  const selected = timeline.getElementsWithTracks({ elements: selection.getSelectedElements() });
  const elements = selected.map(({ track, element }) => ({ trackId: track.id, elementId: element.id }));
  const time = editor.playback.getCurrentTime();
  const store = useTimelineStore.getState();
  const seek = (next: number) => editor.playback.seek({ time: Math.max(0, Math.min(next, timeline.getLastSeekableTime())) });
  switch (action) {
    case "toggle-play": editor.playback.toggle(); break;
    case "stop-playback": editor.playback.pause(); break;
    case "seek-forward": case "jump-forward": case "seek-backward": case "jump-backward": {
      const seconds = (args as { seconds?: number } | undefined)?.seconds ?? (action.startsWith("jump") ? 5 : 1);
      if (Number.isFinite(seconds) && seconds >= 0) seek(time + (action.endsWith("backward") ? -seconds : seconds));
      break;
    }
    case "frame-step-forward": case "frame-step-backward":
      editor.playback.pause(); seek(time + (action.endsWith("backward") ? -1 : 1) / project.settings.fps); break;
    case "goto-start": seek(0); break;
    case "goto-end": seek(timeline.getLastSeekableTime()); break;
    case "split": case "split-left": case "split-right": {
      const splittable = selected.filter(({ element }) => time > element.startTime && time < element.startTime + element.duration)
        .map(({ track, element }) => ({ trackId: track.id, elementId: element.id }));
      if (splittable.length) timeline.splitElements({ elements: splittable, splitTime: time,
        retainSide: action === "split-left" ? "right" : action === "split-right" ? "left" : "both",
        rippleEnabled: store.rippleEditingEnabled });
      break;
    }
    case "delete-selected":
      if (elements.length) { timeline.deleteElements({ elements, rippleEnabled: store.rippleEditingEnabled }); selection.clearSelection(); }
      break;
    case "copy-selected":
      if (elements.length) store.setClipboard({ items: structuredClone(selected.map(({ track, element }) => ({ trackId: track.id, trackType: track.type, element }))) });
      break;
    case "paste-copied":
      if (store.clipboard?.items.length) selection.setSelectedElements({ elements: timeline.pasteAtTime({ time, clipboardItems: store.clipboard.items }) });
      break;
    case "duplicate-selected":
      if (elements.length) selection.setSelectedElements({ elements: timeline.duplicateElements({ elements }) });
      break;
    case "toggle-elements-muted-selected":
      if (selected.some(({ element }) => element.type === "video" || element.type === "audio")) timeline.toggleElementsMuted({ elements });
      break;
    case "toggle-elements-visibility-selected": if (elements.length) timeline.toggleElementsVisibility({ elements }); break;
    case "toggle-snapping": store.toggleSnapping(); break;
    case "toggle-ripple-editing": store.toggleRippleEditing(); break;
    case "select-all": selection.setSelectedElements({ elements: timeline.getTracks().flatMap((track) => track.elements.map((element) => ({ trackId: track.id, elementId: element.id }))) }); break;
    case "cancel-interaction": if (!cancelInteraction()) selection.clearSelection(); break;
    case "deselect-all": selection.clearSelection(); break;
    case "undo": editor.command.undo(); break;
    case "redo": editor.command.redo(); break;
    case "toggle-bookmark": void editor.scenes.toggleBookmark({ time }); break;
    case "remove-media-asset": {
      const value = args as TActionArgsMap["remove-media-asset"];
      if (value?.projectId === project.metadata.id && value.assetId) editor.media.removeMediaAsset({ projectId: value.projectId, id: value.assetId });
      break;
    }
    case "remove-media-assets": {
      const value = args as TActionArgsMap["remove-media-assets"];
      if (value?.projectId === project.metadata.id && Array.isArray(value.assetIds) && value.assetIds.length) editor.media.removeMediaAssets({ projectId: value.projectId, ids: value.assetIds });
      break;
    }
    default: { const exhaustive: never = action; return exhaustive; }
  }
};
