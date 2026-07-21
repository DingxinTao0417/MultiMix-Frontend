import { describe, it, expect, vi } from 'vitest';

// Mock editor type modules — import type is erased at runtime by esbuild, but
// vitest still needs the module paths to be mock-able for the hoisted registry.
vi.mock('@editor/lib/project/types', () => ({}));
vi.mock('@editor/lib/timeline/types', () => ({}));
vi.mock('@editor/lib/media/types', () => ({}));

// Mock ./api — mediaUrl is a value import used at runtime.
vi.mock('./api', () => ({
  mediaUrl: (ref: string) =>
    `https://api.example.com/media?ref=${encodeURIComponent(ref)}`,
}));

import { buildProject, buildMediaAssets } from './buildProject';
import type { BackendProject } from './buildProject';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<BackendProject> = {}): BackendProject {
  return {
    metadata: { title: 'Test Project', duration: 30 },
    settings: { fps: 30, width: 1920, height: 1080 },
    media: [],
    tracks: [],
    ...overrides,
  };
}

function makeMedia(
  overrides: Partial<{
    id: string;
    type: 'video' | 'image' | 'audio';
    file_path: string;
    name: string;
    hasAlpha?: boolean;
  }> = {},
) {
  return {
    id: 'media-1',
    type: 'video' as const,
    file_path: '/test/video.mp4',
    name: 'video.mp4',
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFirstTrackIsMain(result: ReturnType<typeof buildProject>) {
  const track = result.project.scenes[0].tracks[0];
  return (track as Record<string, unknown>).isMain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildProject - overlay/hasAlpha logic', () => {
  it('converts explicitly linear backend gains and fades to editor dB values once', () => {
    const bp = makeProject({
      media: [makeMedia({ id: 'media-bgm', type: 'audio', file_path: 'bgm://bgm-tech-01', name: 'BGM' })],
      tracks: [{
        id: 'track-bgm',
        type: 'audio',
        name: '背景音乐',
        elements: [{
          id: 'bgm-linear',
          type: 'audio',
          startTime: 0,
          duration: 10,
          mediaId: 'media-bgm',
          volume: 0.25,
          volumeUnit: 'linear',
          animations: {
            channels: {
              volume: {
                valueKind: 'number',
                keyframes: [
                  { id: 'silent', time: 0, value: 0, interpolation: 'linear' },
                  { id: 'steady', time: 0.12, value: 0.25, interpolation: 'linear' },
                ],
              },
            },
          },
        }],
      }],
    } as BackendProject);

    const audio = buildProject(bp).project.scenes[0].tracks[0].elements[0] as AudioElement;
    const volumeKeyframes = audio.animations?.channels.volume?.keyframes ?? [];

    expect(audio.volume).toBeCloseTo(-12.0412, 4);
    expect(volumeKeyframes.map((keyframe) => keyframe.value)).toEqual([
      -60,
      expect.closeTo(-12.0412, 4),
    ]);
  });

  it('preserves backend BGM gain and fade keyframes', () => {
    const animations = {
      channels: {
        volume: {
          valueKind: 'number' as const,
          keyframes: [
            { id: 'fade-in', time: 0, value: 0, interpolation: 'linear' as const },
            { id: 'steady', time: 0.12, value: 0.18, interpolation: 'linear' as const },
          ],
        },
      },
    };
    const bp = makeProject({
      media: [makeMedia({ id: 'media-bgm', type: 'audio', file_path: 'bgm://bgm-tech-01', name: 'BGM' })],
      tracks: [{
        id: 'track-bgm',
        type: 'audio',
        name: '背景音乐',
        elements: [{
          id: 'bgm-1',
          type: 'audio',
          startTime: 0,
          duration: 10,
          mediaId: 'media-bgm',
          volume: 0.18,
          animations,
        }],
      }],
    } as BackendProject);

    const audio = buildProject(bp).project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;

    expect(audio.volume).toBe(0.18);
    expect(audio.animations).toEqual(animations);
  });

  it('gives subtitles a contrast-safe background by default', () => {
    const bp = makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-contrast',
          type: 'text',
          content: '白底素材上的字幕仍然清晰',
          startTime: 0,
          duration: 5,
        }],
      }],
    });

    const result = buildProject(bp);
    const element = result.project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    expect(element.background).toMatchObject({
      enabled: true,
      color: '#000000aa',
    });
  });

  it('preserves backend subtitle line boundaries without creating a third line', () => {
    const bp = makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-1',
          type: 'text',
          content: '1234567890\nabcdefghij',
          startTime: 0,
          duration: 5,
          segmentId: 'seg-1',
        }],
      }],
    });

    const result = buildProject(bp);
    const element = result.project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    expect(String(element.content).split('\n')).toHaveLength(2);
    expect(element.content).toBe('1234567890\nabcdefghij');
  });

  describe('overlay → isMain mapping', () => {
    it('BackendTrack.overlay: true → track isMain: false', () => {
      const bp = makeProject({
        tracks: [
          {
            id: 'track-1',
            type: 'video',
            name: 'Overlay Track',
            overlay: true,
            elements: [
              {
                id: 'elem-1',
                type: 'video',
                startTime: 0,
                duration: 10,
                mediaId: 'media-1',
              },
            ],
          },
        ],
      });
      const result = buildProject(bp);
      expect(getFirstTrackIsMain(result)).toBe(false);
    });

    it('BackendTrack.overlay not set → track isMain: true', () => {
      const bp = makeProject({
        tracks: [
          {
            id: 'track-1',
            type: 'video',
            name: 'Main Track',
            elements: [
              {
                id: 'elem-1',
                type: 'video',
                startTime: 0,
                duration: 10,
                mediaId: 'media-1',
              },
            ],
          },
        ],
      });
      const result = buildProject(bp);
      expect(getFirstTrackIsMain(result)).toBe(true);
    });
  });

  describe('hasAlpha pass-through', () => {
    it('BackendMedia.hasAlpha: true → MediaAsset.hasAlpha: true', () => {
      const bp = makeProject({
        media: [makeMedia({ hasAlpha: true })],
      });
      const assets = buildMediaAssets(bp);
      expect(assets[0].hasAlpha).toBe(true);
    });

    it('BackendMedia.hasAlpha not set → MediaAsset.hasAlpha is undefined', () => {
      const bp = makeProject({
        media: [makeMedia()],
      });
      const assets = buildMediaAssets(bp);
      expect(assets[0].hasAlpha).toBeUndefined();
    });
  });

  describe('complete project with overlay track', () => {
    it('overlay track is listed after the main track', () => {
      const bp = makeProject({
        media: [
          makeMedia({ id: 'media-main', file_path: '/test/main.mp4', name: 'main.mp4' }),
          makeMedia({ id: 'media-ol', file_path: '/test/overlay.webm', name: 'overlay.webm', hasAlpha: true }),
        ],
        tracks: [
          {
            id: 'track-main',
            type: 'video',
            name: 'Main',
            elements: [
              {
                id: 'elem-main',
                type: 'video',
                startTime: 0,
                duration: 30,
                mediaId: 'media-main',
              },
            ],
          },
          {
            id: 'track-overlay',
            type: 'video',
            name: 'Motion Graphics',
            overlay: true,
            elements: [
              {
                id: 'elem-ol',
                type: 'video',
                startTime: 5,
                duration: 20,
                mediaId: 'media-ol',
              },
            ],
          },
        ],
      });

      const { project, assets } = buildProject(bp);

      // Two video tracks should be present
      const tracks = project.scenes[0].tracks;
      expect(tracks).toHaveLength(2);

      // First track is main, second is overlay
      expect((tracks[0] as Record<string, unknown>).isMain).toBe(true);
      expect((tracks[1] as Record<string, unknown>).isMain).toBe(false);

      // Overlay track comes after main track in the list
      expect((tracks[0] as Record<string, unknown>).id).toBe('track-main');
      expect((tracks[1] as Record<string, unknown>).id).toBe('track-overlay');

      // The overlay media asset preserves hasAlpha
      const overlayAsset = assets.find((a) => a.id === 'media-ol');
      expect(overlayAsset).toBeDefined();
      expect(overlayAsset!.hasAlpha).toBe(true);
    });

    it('mutes stock video elements so their source audio does not overlap narration', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-clip', file_path: '/test/clip.mp4', name: 'clip.mp4' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              { id: 'vel-0', type: 'video', startTime: 0, duration: 5, mediaId: 'media-clip', muted: true },
              { id: 'vel-1', type: 'video', startTime: 5, duration: 5, mediaId: 'media-clip' },
            ],
          },
        ],
      });
      const { project } = buildProject(bp);
      const elements = project.scenes[0].tracks[0].elements as Array<Record<string, unknown>>;
      // Explicit muted:true is honored, and an unset flag defaults to muted.
      expect(elements[0].muted).toBe(true);
      expect(elements[1].muted).toBe(true);
    });

    it('keeps video audio when the backend explicitly sets muted:false', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-clip', file_path: '/test/clip.mp4', name: 'clip.mp4' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              { id: 'vel-0', type: 'video', startTime: 0, duration: 5, mediaId: 'media-clip', muted: false },
            ],
          },
        ],
      });
      const { project } = buildProject(bp);
      const elements = project.scenes[0].tracks[0].elements as Array<Record<string, unknown>>;
      expect(elements[0].muted).toBe(false);
    });

    it('preserves a shorter overlay inside the matching segment window', () => {
      const bp = makeProject({
        media: [
          makeMedia({ id: 'media-main', file_path: '/test/main.mp4', name: 'main.mp4' }),
          makeMedia({ id: 'media-ol', file_path: '/test/overlay.webm', name: 'overlay.webm', hasAlpha: true }),
        ],
        tracks: [
          {
            id: 'track-main',
            type: 'video',
            name: 'Main',
            elements: [
              {
                id: 'elem-main-1',
                type: 'video',
                startTime: 4,
                duration: 6,
                mediaId: 'media-main',
                segmentId: 'seg-1',
              },
            ],
          },
          {
            id: 'track-overlay',
            type: 'video',
            name: 'Motion Graphics',
            overlay: true,
            elements: [
              {
                id: 'elem-ol-1',
                type: 'video',
                startTime: 4.2,
                duration: 3,
                mediaId: 'media-ol',
                segmentId: 'seg-1',
              },
            ],
          },
        ],
      });

      const { project } = buildProject(bp);
      const overlayTrack = project.scenes[0].tracks.find(
        (track) => (track as Record<string, unknown>).id === 'track-overlay',
      );
      const overlayElement = overlayTrack?.elements[0];

      expect(overlayElement?.startTime).toBe(4.2);
      expect(overlayElement?.duration).toBe(3);
    });

    it('clamps an overlay that spills beyond its matching segment window', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-ol', hasAlpha: true })],
        tracks: [
          {
            id: 'track-main',
            type: 'video',
            name: 'Main',
            elements: [
              { id: 'main', type: 'video', startTime: 4, duration: 6, mediaId: 'main-media', segmentId: 'seg-1' },
            ],
          },
          {
            id: 'track-overlay',
            type: 'video',
            name: 'MG',
            overlay: true,
            elements: [
              { id: 'overlay', type: 'video', startTime: 9, duration: 4, mediaId: 'media-ol', segmentId: 'seg-1' },
            ],
          },
        ],
      });

      const { project } = buildProject(bp);
      const overlay = project.scenes[0].tracks[1].elements[0];
      expect(overlay.startTime).toBe(9);
      expect(overlay.duration).toBe(1);
    });
  });
});
