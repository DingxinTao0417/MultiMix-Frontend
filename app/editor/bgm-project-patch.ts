import type { BackendProject } from "@/editor-engine/vendor/buildProject";

// Mirror the server's structural BGM identity; never infer roles from names.
export function isBgmTrack(track: { id: string; bgm?: boolean }): boolean {
  return track.id === "track-bgm" || track.bgm === true;
}

export function isBgmMedia(media: { id: string; file_path: string; metadata?: { media_role?: string } }): boolean {
  return media.id.startsWith("media-bgm-") || media.file_path.startsWith("bgm://") || media.metadata?.media_role === "bgm";
}

export function mergeBgmProjectPatch(current: BackendProject, response: BackendProject): BackendProject {
  return {
    ...current,
    metadata: {
      ...current.metadata,
      bgm_choice: response.metadata.bgm_choice,
      ...(response.metadata.audio_mix !== undefined ? { audio_mix: response.metadata.audio_mix } : {}),
    },
    tracks: [...current.tracks.filter((track) => !isBgmTrack(track)), ...response.tracks.filter(isBgmTrack)],
    media: [...current.media.filter((media) => !isBgmMedia(media)), ...response.media.filter(isBgmMedia)],
  };
}
