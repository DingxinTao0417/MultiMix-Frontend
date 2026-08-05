import { afterEach, describe, expect, it, vi } from 'vitest';

const editorMock = vi.hoisted(() => ({
  project: {
    getActive: vi.fn(),
    setActiveProject: vi.fn(),
  },
  timeline: {
    getTracks: vi.fn(),
  },
  media: {
    getAssets: vi.fn(),
    setAssets: vi.fn(),
  },
  scenes: {
    initializeScenes: vi.fn(),
  },
}));

vi.mock('@editor/core', () => ({
  EditorCore: {
    reset: vi.fn(),
    getInstance: vi.fn(() => editorMock),
  },
}));
vi.mock('@editor/lib/project/types', () => ({}));
vi.mock('@editor/lib/timeline/types', () => ({}));
vi.mock('@editor/lib/media/types', () => ({}));
vi.mock('./api', () => ({
  mediaUrl: (ref: string) => `https://api.example.com/media?ref=${encodeURIComponent(ref)}`,
}));

import { buildProject, type BackendProject } from './buildProject';
import { initEditorWithProject } from './bootstrap';
import { rememberRawProject, serializeBackendProject } from './serializeProject';

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

function makeBgmProject(): BackendProject {
  return {
    metadata: { title: 'BGM Project', duration: 10 },
    settings: { fps: 30, width: 1920, height: 1080 },
    media: [{
      id: 'media-bgm',
      type: 'audio',
      file_path: 'bgm://bgm-tech-01',
      playback_url: 'https://signed.example.test/bgm-tech-01',
      name: 'BGM',
    }],
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
  } as BackendProject;
}

function makeTransitionProject(): BackendProject {
  return {
    metadata: { title: 'Transition Project', duration: 8 },
    settings: { fps: 30, width: 1920, height: 1080 },
    media: [
      {
        id: 'media-a',
        type: 'image',
        file_path: 'local://transition/a.png',
        name: 'a.png',
      },
      {
        id: 'media-b',
        type: 'image',
        file_path: 'local://transition/b.png',
        name: 'b.png',
      },
    ],
    tracks: [{
      id: 'track-video',
      type: 'video',
      name: '素材',
      elements: [
        {
          id: 'scene-a',
          type: 'image',
          startTime: 0,
          duration: 4,
          mediaId: 'media-a',
          editDecision: { transition: 'cut' },
        },
        {
          id: 'scene-b',
          type: 'image',
          startTime: 4,
          duration: 4,
          mediaId: 'media-b',
          editDecision: { transition: 'dissolve' },
        },
      ],
    }],
  };
}

function prepareEditorRoundTrip(backend: BackendProject) {
  const { project, assets } = buildProject(backend);
  rememberRawProject(backend as unknown as Record<string, unknown>);
  editorMock.project.getActive.mockReturnValue(project);
  editorMock.timeline.getTracks.mockReturnValue(project.scenes[0].tracks);
  editorMock.media.getAssets.mockReturnValue(assets);
  return project;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BGM editor round-trip', () => {
  it('serializes volume and animations while keeping the canonical BGM ref', () => {
    const backend = makeBgmProject();
    const { project, assets } = buildProject(backend);
    rememberRawProject(backend as unknown as Record<string, unknown>);
    editorMock.project.getActive.mockReturnValue(project);
    editorMock.timeline.getTracks.mockReturnValue(project.scenes[0].tracks);
    editorMock.media.getAssets.mockReturnValue(assets);

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    const element = serialized.tracks[0].elements[0];

    expect(element.volume).toBe(0.18);
    expect(element.animations).toEqual(animations);
    expect(serialized.media[0].file_path).toBe('bgm://bgm-tech-01');
    expect(serialized.media[0]).not.toHaveProperty('playback_url');
  });

  it('hydrates from playback_url instead of trying to fetch the canonical BGM ref', async () => {
    const backend = makeBgmProject();
    const fetchMock = vi.fn(async () => new Response(
      new Blob(['audio'], { type: 'audio/mp4' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hydrated-bgm');

    await initEditorWithProject(backend);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://signed.example.test/bgm-tech-01',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(editorMock.media.setAssets).toHaveBeenCalled();
  });

  it('preserves subtitle size and lower-safe-area position across save and reload', () => {
    const backend: BackendProject = {
      metadata: { title: 'Subtitle round trip', duration: 5 },
      settings: { fps: 30, width: 1080, height: 1920 },
      media: [],
      tracks: [{
        id: 'track-subtitle',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'subtitle-1',
          type: 'text',
          content: '字幕应留在画面下方安全区',
          startTime: 0,
          duration: 5,
          textRole: 'subtitle',
          safeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.22 },
        }],
      }],
    };
    const { project, assets } = buildProject(backend);
    const original = project.scenes[0].tracks[0].elements[0] as Record<string, any>;
    rememberRawProject(backend as unknown as Record<string, unknown>);
    editorMock.project.getActive.mockReturnValue(project);
    editorMock.timeline.getTracks.mockReturnValue(project.scenes[0].tracks);
    editorMock.media.getAssets.mockReturnValue(assets);

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    const saved = serialized.tracks[0].elements[0] as Record<string, any>;
    expect(saved.fontSize).toBe(original.fontSize);
    expect(saved.transform).toEqual(original.transform);
    expect(saved.safeRegion).toEqual({ x: 0.08, y: 0.74, width: 0.84, height: 0.22 });

    const rebuilt = buildProject(serialized).project.scenes[0].tracks[0].elements[0] as Record<string, any>;
    expect(rebuilt.fontSize).toBe(original.fontSize);
    expect(rebuilt.transform).toEqual(original.transform);
  });

  it('serializes the role of a caption created inside the editor', () => {
    const backend: BackendProject = {
      metadata: { title: 'Generated caption', duration: 5 },
      settings: { fps: 30, width: 1080, height: 1920 },
      media: [],
      tracks: [{
        id: 'track-text',
        type: 'text',
        name: '字幕',
        elements: [{
          id: 'caption-template',
          type: 'text',
          content: '新识别字幕',
          startTime: 0,
          duration: 5,
        }],
      }],
    };
    const { project, assets } = buildProject(backend);
    const liveCaption = project.scenes[0].tracks[0].elements[0] as Record<string, unknown>;
    liveCaption.id = 'caption-created-in-editor';
    liveCaption.textRole = 'subtitle';
    rememberRawProject(backend as unknown as Record<string, unknown>);
    editorMock.project.getActive.mockReturnValue(project);
    editorMock.timeline.getTracks.mockReturnValue(project.scenes[0].tracks);
    editorMock.media.getAssets.mockReturnValue(assets);

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;

    expect(serialized.tracks[0].elements[0].textRole).toBe('subtitle');
  });

  it('preserves split decisions and support text roles across save and reload', () => {
    const support = {
      headline: '从对话直接进入分镜编辑',
      items: ['保留可编辑结构', '同步视频预览'],
    };
    const backend: BackendProject = {
      metadata: { title: 'Product split', duration: 5 },
      settings: { fps: 30, width: 1920, height: 1080 },
      media: [{
        id: 'media-ui',
        type: 'image',
        file_path: 'local://product/ui.png',
        name: 'ui.png',
      }],
      tracks: [
        {
          id: 'track-video',
          type: 'video',
          name: '素材',
          elements: [{
            id: 'ui-main',
            type: 'image',
            startTime: 0,
            duration: 5,
            mediaId: 'media-ui',
            segmentId: 'scene-1',
            editDecision: { layout: 'split', presentation_support: support },
          }],
        },
        {
          id: 'track-support',
          type: 'text',
          name: '支撑信息',
          elements: [{
            id: 'support-1',
            type: 'text',
            content: '从对话直接进入分镜编辑\n• 保留可编辑结构\n• 同步视频预览',
            startTime: 0,
            duration: 5,
            segmentId: 'scene-1',
            textRole: 'presentation_support',
          }],
        },
      ],
    };
    const { project, assets } = buildProject(backend);
    rememberRawProject(backend as unknown as Record<string, unknown>);
    editorMock.project.getActive.mockReturnValue(project);
    editorMock.timeline.getTracks.mockReturnValue(project.scenes[0].tracks);
    editorMock.media.getAssets.mockReturnValue(assets);

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    expect(serialized.tracks[0].elements[0].editDecision).toEqual({
      layout: 'split',
      presentation_support: support,
    });
    expect(serialized.tracks[1].elements[0].textRole).toBe('presentation_support');

    const rebuilt = buildProject(serialized).project;
    expect(rebuilt.scenes[0].tracks[0].elements[0].transform).toMatchObject({
      scaleX: 0.62,
      scaleY: 0.62,
    });
    expect(rebuilt.scenes[0].tracks[1].elements[0]).toMatchObject({
      background: { enabled: true, color: '#171b26' },
      textAlign: 'left',
    });
  });
});

describe('scene transition editor round-trip', () => {
  it('persists an automatic dissolve as both exact editor state and semantic intent', () => {
    const backend = makeTransitionProject();
    prepareEditorRoundTrip(backend);

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    const transitionElement = serialized.tracks[0].elements[1];

    expect(transitionElement.transition).toEqual({ type: 'dissolve', duration: 0.5 });
    expect(transitionElement.editDecision?.transition).toBe('dissolve');
    expect(buildProject(serialized).project.scenes[0].tracks[0].elements[1])
      .toMatchObject({ transition: { type: 'dissolve', duration: 0.5 } });
  });

  it('keeps a manual wipe override exact and updates the semantic decision', () => {
    const backend = makeTransitionProject();
    const project = prepareEditorRoundTrip(backend);
    const transitionElement = project.scenes[0].tracks[0].elements[1] as {
      transition?: { type: string; duration: number };
    };
    transitionElement.transition = { type: 'wipe_left', duration: 0.4 };

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    const saved = serialized.tracks[0].elements[1];

    expect(saved.transition).toEqual({ type: 'wipe_left', duration: 0.4 });
    expect(saved.editDecision?.transition).toBe('wipe');
    expect(buildProject(serialized).project.scenes[0].tracks[0].elements[1])
      .toMatchObject({ transition: { type: 'wipe_left', duration: 0.4 } });
  });

  it('persists removal as cut so the old automatic decision does not revive', () => {
    const backend = makeTransitionProject();
    const project = prepareEditorRoundTrip(backend);
    const transitionElement = project.scenes[0].tracks[0].elements[1] as {
      transition?: { type: string; duration: number };
    };
    delete transitionElement.transition;

    const serialized = serializeBackendProject(editorMock as never) as unknown as BackendProject;
    const saved = serialized.tracks[0].elements[1];

    expect(saved).not.toHaveProperty('transition');
    expect(saved.editDecision?.transition).toBe('cut');
    expect(buildProject(serialized).project.scenes[0].tracks[0].elements[1])
      .not.toHaveProperty('transition');
  });
});
