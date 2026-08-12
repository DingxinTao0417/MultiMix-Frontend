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

import {
  buildProject,
  buildMediaAssets,
  displayTextByElementId,
  editDecisionByElementId,
  layoutCaption,
  subtitlePositionOffset,
  subtitleTypographyForCanvas,
  supportCardPanelGeometry,
} from './buildProject';
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
  it('preserves backend-authored video retime for generated primary-scene alignment', () => {
    const { project } = buildProject(makeProject({
      media: [makeMedia({ id: 'generated-scene' })],
      tracks: [{
        id: 'track-video',
        type: 'video',
        name: '素材',
        elements: [{
          id: 'generated-scene-element',
          type: 'video',
          startTime: 0,
          duration: 3.072,
          mediaId: 'generated-scene',
          retime: { rate: 0.9375 },
        }],
      }],
    } as BackendProject));

    const element = project.scenes[0].tracks[0].elements[0] as {
      retime?: { rate: number };
    };
    expect(element.retime).toEqual({ rate: 0.9375 });
  });

  it('preserves pitch-safe narration retime on audio elements', () => {
    const { project } = buildProject(makeProject({
      media: [makeMedia({ id: 'narration', type: 'audio' })],
      tracks: [{
        id: 'track-audio',
        type: 'audio',
        name: '配音',
        elements: [{
          id: 'narration-element',
          type: 'audio',
          startTime: 0,
          duration: 30,
          mediaId: 'narration',
          retime: { rate: 0.833333, maintainPitch: true },
        }],
      }],
    } as BackendProject));

    const element = project.scenes[0].tracks[0].elements[0] as {
      retime?: { rate: number; maintainPitch?: boolean };
    };
    expect(element.retime).toEqual({ rate: 0.833333, maintainPitch: true });
  });

  it.each([
    ['pan', 'transform.position'],
    ['slow_push', 'transform.scaleX'],
    ['zoom', 'transform.scaleX'],
  ])('turns backend %s motion into executable editor animation', (motion, channel) => {
    const { project } = buildProject(makeProject({
      media: [makeMedia({ id: 'static-scene', type: 'image' })],
      tracks: [{
        id: 'track-video',
        type: 'video',
        name: '素材',
        elements: [{
          id: 'static-scene-element',
          type: 'image',
          startTime: 0,
          duration: 4,
          mediaId: 'static-scene',
          editDecision: { motion },
        }],
      }],
    } as BackendProject));

    const element = project.scenes[0].tracks[0].elements[0] as {
      animations?: { channels: Record<string, { keyframes: unknown[] } | undefined> };
    };
    expect(element.animations?.channels[channel]?.keyframes).toHaveLength(2);
  });

  it.each(['none', 'freeze', 'speed_ramp', 'unknown_motion'])(
    'does not invent static-image animation for %s',
    (motion) => {
      const { project } = buildProject(makeProject({
        media: [makeMedia({ id: 'static-scene', type: 'image' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'static-scene-element',
            type: 'image',
            startTime: 0,
            duration: 4,
            mediaId: 'static-scene',
            editDecision: { motion },
          }],
        }],
      } as BackendProject));

      const element = project.scenes[0].tracks[0].elements[0] as {
        animations?: unknown;
      };
      expect(element.animations).toBeUndefined();
    },
  );

  it('renders controlled brand CTA above the subtitle lane as its own text treatment', () => {
    const { project } = buildProject(makeProject({
      tracks: [{
        id: 'track-brand-cta',
        type: 'text',
        name: '品牌引导',
        elements: [{
          id: 'brand-cta-0',
          type: 'text',
          content: '立即咨询\n获得适合你的方案',
          startTime: 0,
          duration: 5,
          segmentId: 'scene-cta',
          textRole: 'brand_cta' as never,
          safeRegion: { x: 0.14, y: 0.18, width: 0.72, height: 0.30 },
        }],
      }],
    }));

    const element = project.scenes[0].tracks[0].elements[0] as {
      textRole?: string;
      background: { enabled: boolean };
      transform: { position: { y: number } };
    };
    expect(element.textRole).toBe('brand_cta');
    expect(element.background.enabled).toBe(true);
    expect(element.transform.position.y).toBeLessThan(0);
  });

  it('keeps a subtitle on one line when the rendered glyph width fits', () => {
    const result = layoutCaption('上传资料，自动生成可编辑视频', {
      availableWidth: 900,
      preferredFontPx: 50,
      minimumFontPx: 36,
      measureText: (text, fontPx) => text.length * fontPx,
    });

    expect(result.text).toBe('上传资料，自动生成可编辑视频');
    expect(result.lines).toBe(1);
    expect(result.fontPx).toBe(50);
  });

  it('shrinks a fitting subtitle before introducing a second line', () => {
    const result = layoutCaption('一行刚好可以缩小显示', {
      availableWidth: 400,
      preferredFontPx: 50,
      minimumFontPx: 36,
      measureText: (text, fontPx) => text.length * fontPx,
    });

    expect(result.text).not.toContain('\n');
    expect(result.lines).toBe(1);
    expect(result.fontPx).toBeGreaterThanOrEqual(36);
    expect(result.fontPx).toBeLessThan(50);
  });

  it('uses at most two measured lines when shrinking cannot fit one line', () => {
    const result = layoutCaption('上传资料理解内容生成脚本编辑导出', {
      availableWidth: 360,
      preferredFontPx: 50,
      minimumFontPx: 36,
      measureText: (text, fontPx) => text.length * fontPx,
    });

    expect(result.text.split('\n')).toHaveLength(2);
    expect(result.lines).toBe(2);
    expect(result.fontPx).toBeGreaterThanOrEqual(36);
  });

  it('converts backend BGM fades and ducking keyframes to editor dB once', () => {
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
          volume: 0.18,
          volumeUnit: 'linear',
          animations: {
            channels: {
              volume: {
                valueKind: 'number',
                keyframes: [
                  { id: 'silent', time: 0, value: 0, interpolation: 'linear' },
                  { id: 'steady', time: 1.2, value: 0.18, interpolation: 'linear' },
                  { id: 'duck', time: 5, value: 0.18 * (10 ** (-6 / 20)), interpolation: 'linear' },
                  { id: 'hold', time: 8, value: 0.18 * (10 ** (-6 / 20)), interpolation: 'linear' },
                  { id: 'recover', time: 8.5, value: 0.18, interpolation: 'linear' },
                ],
              },
            },
          },
        }],
      }],
    } as BackendProject);

    const audio = buildProject(bp).project.scenes[0].tracks[0].elements[0] as AudioElement;
    const volumeKeyframes = audio.animations?.channels.volume?.keyframes ?? [];

    expect(audio.volume).toBeCloseTo(-14.8945, 4);
    expect(volumeKeyframes.map((keyframe) => keyframe.time)).toEqual([0, 1.2, 5, 8, 8.5]);
    expect(volumeKeyframes.map((keyframe) => keyframe.value)).toEqual([
      -60,
      expect.closeTo(-14.8945, 4),
      expect.closeTo(-20.8945, 4),
      expect.closeTo(-20.8945, 4),
      expect.closeTo(-14.8945, 4),
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

  it('defaults subtitles to no background while preserving readable text styling', () => {
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
    expect(element.background).toEqual({
      enabled: false,
      color: '#000000',
    });
  });

  it('preserves backend word-highlight tokens for the subtitle renderer', () => {
    const result = buildProject(makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-word-highlight',
          type: 'text',
          content: '上传资料',
          startTime: 0,
          duration: 2,
          textRole: 'subtitle',
          subtitlePresentation: 'word_highlight',
          subtitleTokens: [
            { text: '上传', startOffset: 0, endOffset: 0.8 },
            { text: '资料', startOffset: 0.8, endOffset: 2 },
          ],
        }],
      }],
    } as BackendProject));

    const element = result.project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    expect(element.subtitlePresentation).toEqual({
      mode: 'word_highlight',
      tokens: [
        { text: '上传', startOffset: 0, endOffset: 0.8 },
        { text: '资料', startOffset: 0.8, endOffset: 2 },
      ],
    });
  });

  it('uses a persisted user subtitle background instead of the default', () => {
    const result = buildProject(makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        elements: [{
          id: 'subtitle-background',
          type: 'text',
          content: '用户明确要求背景',
          startTime: 0,
          duration: 2,
          textRole: 'subtitle',
          subtitlePresentation: 'static_phrase',
          subtitleBackground: { enabled: true, color: '#123456aa' },
        }],
      }],
    } as BackendProject));

    const element = result.project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    expect(element.background).toMatchObject({ enabled: true, color: '#123456aa' });
  });

  it('uses a persisted brand profile for a portrait subtitle without adding a background', () => {
    const result = buildProject(makeProject({
      settings: { fps: 30, width: 1080, height: 1920 },
      tracks: [{
        id: 'track-text',
        type: 'text',
        elements: [{
          id: 'premium-subtitle',
          type: 'text',
          content: '全片字幕保持一致的品牌感',
          startTime: 0,
          duration: 2,
          textRole: 'subtitle',
          subtitlePresentation: 'karaoke',
          subtitleStyle: {
            fontFamily: 'Inter, sans-serif',
            color: '#F9FAFB',
            accentColor: '#2563EB',
            fontWeight: 'bold',
            maxLineChars: 14,
            sizeScale: 0.8,
            karaokeScale: 1.04,
          },
        }],
      }],
    } as BackendProject));

    const element = result.project.scenes[0].tracks[0].elements[0] as Record<string, any>;
    expect(element.fontFamily).toBe('Inter, sans-serif');
    expect(element.color).toBe('#F9FAFB');
    expect(element.background).toEqual({ enabled: false, color: '#000000' });
    expect(element.subtitlePresentation).toMatchObject({
      accentColor: '#2563EB',
      karaokeScale: 1.04,
    });
  });

  it('uses a profile line budget before shrinking a portrait subtitle to one long line', () => {
    const result = layoutCaption('上传资料自动生成可编辑视频工程', {
      availableWidth: 1200,
      preferredFontPx: 40,
      minimumFontPx: 32,
      maxLineChars: 10,
      measureText: (text, fontPx) => text.length * fontPx,
    });

    expect(result.text).toContain('\n');
    expect(result.lines).toBe(2);
  });

  it('keeps default 1080p subtitles within a professional lower-third size', () => {
    const bp = makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-size',
          type: 'text',
          content: '上传实拍，选方向，自动编导',
          startTime: 0,
          duration: 5,
        }],
      }],
    });

    const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    const renderedFontSize = Number(element.fontSize) * (bp.settings.height / 90);
    expect(renderedFontSize).toBeGreaterThanOrEqual(34);
    expect(renderedFontSize).toBeLessThanOrEqual(38);
    expect(element.content).toBe('上传实拍，选方向，自动编导');
    expect(element.transform).toMatchObject({
      position: { x: 0, y: Math.round(bp.settings.height * 0.35) },
    });
  });

  it('uses ratio-aware compact subtitle typography', () => {
    const landscape = subtitleTypographyForCanvas(1920, 1080, 0.7);
    const portrait = subtitleTypographyForCanvas(1080, 1920, 0.7);

    expect(landscape.preferredFontPx).toBeGreaterThanOrEqual(32);
    expect(landscape.preferredFontPx).toBeLessThanOrEqual(38);
    expect(portrait.preferredFontPx).toBeGreaterThanOrEqual(34);
    expect(portrait.preferredFontPx).toBeLessThanOrEqual(40);
  });

  it('centres subtitles in the backend safe region and clamps manual movement', () => {
    const landscapeRegion = { x: 0.08, y: 0.76, width: 0.84, height: 0.18 };
    const portraitRegion = { x: 0.08, y: 0.74, width: 0.84, height: 0.22 };

    expect(subtitlePositionOffset(1080, landscapeRegion, 0.35)).toBe(378);
    expect(subtitlePositionOffset(1920, portraitRegion, 0.35)).toBe(672);
    expect(subtitlePositionOffset(1080, landscapeRegion, 0)).toBe(281);
    expect(subtitlePositionOffset(1080, landscapeRegion, 0.42)).toBe(454);
  });

  it('keeps portrait subtitles compact and inside their lower safe region', () => {
    const bp = makeProject({
      settings: { fps: 30, width: 1080, height: 1920 },
      tracks: [{
        id: 'track-text-portrait',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-portrait',
          type: 'text',
          content: '上传实拍，选方向，自动编导',
          startTime: 0,
          duration: 5,
          textRole: 'subtitle',
          safeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.22 },
        }],
      }],
    });

    const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as Record<string, any>;
    const renderedFontSize = Number(element.fontSize) * (bp.settings.height / 90);
    expect(renderedFontSize).toBeGreaterThanOrEqual(34);
    expect(renderedFontSize).toBeLessThanOrEqual(40);
    expect(element.transform.position.y).toBe(672);
    expect(element.textRole).toBe('subtitle');
  });

  it('never splits an English product token across subtitle lines', () => {
    const bp = makeProject({
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'tel-product-name',
          type: 'text',
          content: '1234567890MultiMix',
          startTime: 0,
          duration: 5,
        }],
      }],
    });

    const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    expect(element.content).toBe('1234567890MultiMix');
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

  describe('split support presentation', () => {
    it('applies one deterministic split and preserves every support-card line', () => {
      const support = {
        headline: '从对话直接进入分镜编辑',
        items: ['保留可编辑结构', '同步视频预览', '按分镜继续调整'],
      };
      const bp = makeProject({
        media: [makeMedia({ id: 'media-ui', type: 'image', file_path: '/test/ui.png', name: 'ui.png' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              {
                id: 'ui-main',
                type: 'image',
                startTime: 0,
                duration: 5,
                mediaId: 'media-ui',
                segmentId: 'scene-1',
                editDecision: { layout: 'split', presentation_support: support },
              },
            ],
          },
          {
            id: 'track-support',
            type: 'text',
            name: '支撑信息',
            elements: [
              {
                id: 'support-1',
                type: 'text',
                content: '从对话直接进入分镜编辑\n• 保留可编辑结构\n• 同步视频预览\n• 按分镜继续调整',
                startTime: 0,
                duration: 5,
                segmentId: 'scene-1',
                textRole: 'presentation_support',
              },
            ],
          },
        ],
      });

      const { project } = buildProject(bp);
      const video = project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
      const card = project.scenes[0].tracks[1].elements[0] as Record<string, unknown>;

      expect(video.transform).toEqual({
        scaleX: 0.62,
        scaleY: 0.62,
        position: { x: -346, y: 0 },
        rotate: 0,
      });
      expect(editDecisionByElementId['ui-main']).toEqual({
        layout: 'split',
        presentation_support: support,
      });
      expect(String(card.content).split('\n')).toHaveLength(4);
      expect(card.textAlign).toBe('left');
      expect(card.background).toMatchObject({
        enabled: true,
        color: '#171b26',
        paddingX: 29,
        paddingY: 86,
      });
      expect(card.transform).toMatchObject({ position: { x: 326, y: 0 } });
    });

    it('keeps a split-native canvas at full size and wraps every support line inside the right panel', () => {
      const support = {
        headline: '从对话直接进入分镜编辑',
        items: [
          '完整保留工作台上下文并继续生成可以逐镜修改的视频工程',
          '同步视频预览',
        ],
      };
      const decision = {
        layout: 'split',
        presentation_support: support,
        presentation_canvas_version: 'split_native_v1',
      };
      const originalText = [
        support.headline,
        ...support.items.map((item) => `• ${item}`),
      ].join('\n');
      const bp = makeProject({
        media: [makeMedia({ id: 'media-ui', type: 'image' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              {
                id: 'ui-native',
                type: 'image',
                startTime: 0,
                duration: 5,
                mediaId: 'media-ui',
                editDecision: decision,
              },
            ],
          },
          {
            id: 'track-support',
            type: 'text',
            name: '支撑信息',
            elements: [
              {
                id: 'support-native',
                type: 'text',
                content: originalText,
                displayText: originalText,
                startTime: 0,
                duration: 5,
                textRole: 'presentation_support',
                editDecision: decision,
              },
            ],
          },
        ],
      });

      const { project } = buildProject(bp);
      const video = project.scenes[0].tracks[0].elements[0] as Record<string, any>;
      const card = project.scenes[0].tracks[1].elements[0] as Record<string, any>;
      const visualLines = String(card.content).split('\n');

      expect(video.transform).toEqual({
        scaleX: 1,
        scaleY: 1,
        position: { x: 0, y: 0 },
        rotate: 0,
      });
      expect(visualLines.length).toBeGreaterThan(3);
      expect(visualLines.every((line) => Array.from(line).length <= 18)).toBe(true);
      expect(visualLines.join('')).toBe(originalText.replace(/\n/g, ''));
      expect(displayTextByElementId['support-native']).toBe(originalText);
      expect(card.transform).toMatchObject({ position: { x: 288, y: 0 } });
    });

    it('keeps v1 side support and v2 lower support fully inside their safe panels', () => {
      const settings = { fps: 30, width: 1920, height: 1080 };
      const side = supportCardPanelGeometry(settings, 'split_native_v1');
      const lower = supportCardPanelGeometry(settings, 'split_native_v2');

      expect(side.position).toEqual({ x: 288, y: 0 });
      expect(lower.position).toEqual({ x: -768, y: 205 });
      expect(lower.availableWidth).toBe(1574);
      expect(lower.availableHeight).toBe(194);

      for (const geometry of [side, lower]) {
        const contentLeft = settings.width / 2 + geometry.position.x;
        const backgroundLeft = contentLeft - geometry.paddingX;
        const backgroundRight = contentLeft + geometry.availableWidth + geometry.paddingX;
        expect(backgroundLeft).toBeGreaterThanOrEqual(settings.width * 0.04);
        expect(backgroundRight).toBeLessThanOrEqual(settings.width * 0.96);
      }
    });

    it('separates v2 lower support from its subtitle without moving ordinary subtitles', () => {
      const support = {
        headline: '从对话直接进入分镜编辑',
        items: ['保留可编辑结构', '同步视频预览'],
      };
      const splitDecision = {
        layout: 'split',
        presentation_support: support,
        presentation_canvas_version: 'split_native_v2',
      };
      const bp = makeProject({
        media: [makeMedia({ id: 'media-ui', type: 'image' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              {
                id: 'ui-native-v2',
                type: 'image',
                startTime: 0,
                duration: 5,
                mediaId: 'media-ui',
                segmentId: 'scene-split',
                editDecision: splitDecision,
              },
            ],
          },
          {
            id: 'track-support',
            type: 'text',
            name: '支撑信息',
            elements: [
              {
                id: 'support-native-v2',
                type: 'text',
                content: '从对话直接进入分镜编辑\n• 保留可编辑结构\n• 同步视频预览',
                startTime: 0,
                duration: 5,
                segmentId: 'scene-split',
                textRole: 'presentation_support',
                editDecision: splitDecision,
              },
            ],
          },
          {
            id: 'track-subtitle',
            type: 'text',
            name: '字幕',
            elements: [
              {
                id: 'subtitle-split',
                type: 'text',
                content: '在工作台里直接完成。',
                startTime: 0,
                duration: 5,
                segmentId: 'scene-split',
                textRole: 'subtitle',
              },
              {
                id: 'subtitle-ordinary',
                type: 'text',
                content: '普通分镜字幕。',
                startTime: 5,
                duration: 5,
                segmentId: 'scene-ordinary',
                textRole: 'subtitle',
              },
            ],
          },
        ],
      });

      const { project } = buildProject(bp);
      const supportCard = project.scenes[0].tracks[1].elements[0] as {
        transform: { position: { y: number } };
      };
      const subtitles = project.scenes[0].tracks[2].elements as Array<{
        transform: { position: { y: number } };
      }>;

      expect(supportCard.transform.position.y).toBe(205);
      expect(subtitles[0].transform.position.y).toBe(378);
      expect(subtitles[1].transform.position.y).toBe(378);
    });

    it('keeps portrait v2 support and subtitle lanes proportional and separated', () => {
      const portrait = { fps: 30, width: 1080, height: 1920 };
      const supportGeometry = supportCardPanelGeometry(portrait, 'split_native_v2');

      expect(supportGeometry.position).toEqual({ x: -421, y: 365 });
      expect(Math.round(portrait.height * 0.35) - supportGeometry.position.y)
        .toBeGreaterThanOrEqual(Math.round(portrait.height * 0.15));
    });

    it('does not create an empty split when validated support is absent', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-ui', type: 'image' })],
        tracks: [
          {
            id: 'track-video',
            type: 'video',
            name: '素材',
            elements: [
              {
                id: 'ui-main',
                type: 'image',
                startTime: 0,
                duration: 5,
                mediaId: 'media-ui',
                editDecision: { layout: 'split' },
              },
            ],
          },
        ],
      });

      const video = buildProject(bp).project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
      expect(video.transform).toEqual({
        scaleX: 1,
        scaleY: 1,
        position: { x: 0, y: 0 },
        rotate: 0,
      });
    });
  });

  describe('semantic scene transitions', () => {
    it.each([
      ['cut', undefined],
      ['dissolve', { type: 'dissolve', duration: 0.5 }],
      ['push', { type: 'slide_right', duration: 0.5 }],
      ['wipe', { type: 'wipe_left', duration: 0.5 }],
    ])('maps backend %s decisions onto visual elements', (semantic, expected) => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-transition', type: 'image' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: `scene-${semantic}`,
            type: 'image',
            startTime: 0,
            duration: 4,
            mediaId: 'media-transition',
            editDecision: { transition: semantic },
          }],
        }],
      });

      const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as {
        transition?: { type: string; duration: number };
      };

      expect(element.transition).toEqual(expected);
    });

    it('clamps an automatic transition to half of a short scene', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-short', type: 'video' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'scene-short',
            type: 'video',
            startTime: 0,
            duration: 0.6,
            mediaId: 'media-short',
            editDecision: { transition: 'dissolve' },
          }],
        }],
      });

      const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as {
        transition?: { type: string; duration: number };
      };

      expect(element.transition).toEqual({ type: 'dissolve', duration: 0.3 });
    });

    it('fails closed when a persisted decision contains an unknown transition', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-unknown', type: 'image' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'scene-unknown',
            type: 'image',
            startTime: 0,
            duration: 4,
            mediaId: 'media-unknown',
            editDecision: { transition: 'spin_away' },
          }],
        }],
      });

      const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as {
        transition?: { type: string; duration: number };
      };

      expect(element.transition).toBeUndefined();
    });

    it('prefers a valid saved editor transition over the original semantic decision', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-saved', type: 'image' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'scene-saved',
            type: 'image',
            startTime: 0,
            duration: 4,
            mediaId: 'media-saved',
            transition: { type: 'slide_left', duration: 0.25 },
            editDecision: { transition: 'dissolve' },
          }],
        }],
      } as BackendProject);

      const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as {
        transition?: { type: string; duration: number };
      };

      expect(element.transition).toEqual({ type: 'slide_left', duration: 0.25 });
    });

    it('fails closed instead of reviving the semantic decision behind an invalid saved transition', () => {
      const bp = makeProject({
        media: [makeMedia({ id: 'media-invalid-saved', type: 'video' })],
        tracks: [{
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'scene-invalid-saved',
            type: 'video',
            startTime: 0,
            duration: 4,
            mediaId: 'media-invalid-saved',
            transition: { type: 'spin_away', duration: 0.5 },
            editDecision: { transition: 'dissolve' },
          }],
        }],
      } as BackendProject);

      const element = buildProject(bp).project.scenes[0].tracks[0].elements[0] as {
        transition?: { type: string; duration: number };
      };

      expect(element.transition).toBeUndefined();
    });
  });
});
