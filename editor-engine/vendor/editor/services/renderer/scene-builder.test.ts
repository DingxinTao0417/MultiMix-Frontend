import { describe, expect, it, vi } from 'vitest';
const captured = vi.hoisted(() => [] as Array<{ fitMode?: 'cover' | 'contain' }>);
vi.mock('./nodes/video-node', () => ({ VideoNode: class { constructor(params: { fitMode?: 'cover' | 'contain' }) { captured.push(params); } } }));
vi.mock('./nodes/image-node', () => ({ ImageNode: class { constructor(params: { fitMode?: 'cover' | 'contain' }) { captured.push(params); } } }));
vi.mock('./nodes/text-node', () => ({ TextNode: class {} }));
vi.mock('./nodes/sticker-node', () => ({ StickerNode: class {} }));
vi.mock('./nodes/graphic-node', () => ({ GraphicNode: class {} }));
vi.mock('./nodes/blur-background-node', () => ({ BlurBackgroundNode: class {} }));
vi.mock('./nodes/effect-layer-node', () => ({ EffectLayerNode: class {} }));
vi.mock('./nodes/color-node', () => ({ ColorNode: class {} }));
vi.mock('@editor/lib/timeline', () => ({ isMainTrack: (track: { type: string; isMain?: boolean }) => track.type === 'video' && track.isMain }));
import { buildScene } from './scene-builder';
import { computeFitScale } from './nodes/fit-scale';
import type { TimelineTrack } from '@editor/lib/timeline/types';
import type { MediaAsset } from '@editor/lib/media/types';

describe('ratio revision fit in preview and export', () => {
  it.each([true, false])('uses contain in preview=%s and preserves legacy cover', (isPreview) => {
    captured.length = 0;
    const base = { name: 'clip', type: 'video', mediaId: 'a', duration: 10, trimStart: 0, trimEnd: 0,
      transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: 1 };
    const tracks = [{ id: 'video', name: '主画面', type: 'video', isMain: true, elements: [
      { ...base, id: 'revised', startTime: 0, fitMode: 'contain' }, { ...base, id: 'legacy', startTime: 10 },
    ] }] as TimelineTrack[];
    buildScene({ canvasSize: { width: 1080, height: 1920 }, tracks, duration: 20,
      mediaAssets: [{ id: 'a', type: 'video', url: 'blob:test', file: {} } as MediaAsset],
      background: { type: 'color', color: 'transparent' }, isPreview });
    expect(captured.map(item => item.fitMode)).toEqual(['contain', 'cover']);
    const scale = computeFitScale(1080, 1920, 1920, 1080, captured[0].fitMode);
    expect(1920 * scale).toBeLessThanOrEqual(1080);
    expect(1080 * scale).toBeLessThanOrEqual(1920);
  });
});
