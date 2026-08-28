import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { LayerClientError, runLayerDecomposition } = vi.hoisted(() => ({
  LayerClientError: class extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable = false) {
      super(message);
      this.retryable = retryable;
    }
  },
  runLayerDecomposition: vi.fn(),
}));

vi.mock('@/lib/layer-decomposition-client', () => ({
  LayerClientError,
  runLayerDecomposition,
}));

import * as psdExport from '@/lib/psd-export';

describe('PSD Pro layer decomposition client', () => {
  beforeEach(() => {
    runLayerDecomposition.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the durable async layer client instead of a bare billable POST', async () => {
    runLayerDecomposition.mockResolvedValue({
      width: 640,
      height: 480,
      engine: 'pear',
      psdUrl: '/api/serve-upload/layers/result.psd',
      quality: { status: 'pass', score: 96, warnings: [] },
      layers: [{
        id: 'subject-1',
        name: 'subject/01/main_subject',
        role: 'subject',
        imageUrl: '/api/serve-upload/layers/subject-1.png',
        width: 240,
        height: 180,
        offsetX: 120,
        offsetY: 90,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        source: 'pear-psd',
      }],
    });

    const progress = vi.fn();
    const requestExternalPsdScene = (
      psdExport as typeof psdExport & {
        requestExternalPsdScene?: (
          imageUrl: string,
          onProgress?: (stage: string, progress: number) => void,
          loadLayerCanvas?: (
            imageUrl: string,
            width: number,
            height: number,
          ) => Promise<HTMLCanvasElement>,
        ) => Promise<psdExport.SceneBuildResult>;
      }
    ).requestExternalPsdScene;

    expect(requestExternalPsdScene).toBeTypeOf('function');
    const layerCanvas = { width: 240, height: 180 } as HTMLCanvasElement;
    const loadLayerCanvas = vi.fn().mockResolvedValue(layerCanvas);
    const scene = await requestExternalPsdScene!(
      '/api/serve-upload/uploads/source.png',
      progress,
      loadLayerCanvas,
    );

    expect(runLayerDecomposition).toHaveBeenCalledTimes(1);
    expect(runLayerDecomposition).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: '/api/serve-upload/uploads/source.png',
      engine: 'smart',
      onProgress: expect.any(Function),
    }));
    expect(scene).toMatchObject({
      width: 640,
      height: 480,
      layers: [{
        id: 'subject-1',
        source: 'pear-psd',
        canvas: layerCanvas,
        offsetX: 120,
        offsetY: 90,
        boundingBox: { x: 120, y: 90, width: 240, height: 180 },
      }],
    });
    expect(loadLayerCanvas).toHaveBeenCalledWith(
      '/api/serve-upload/layers/subject-1.png',
      240,
      180,
    );

    const options = runLayerDecomposition.mock.calls[0]?.[0];
    options.onProgress(
      { phase: 'waiting-for-pear', progress: 41 },
      { label: 'Pear 正在生成 PSD', progress: 41 },
    );
    expect(progress).toHaveBeenCalledWith('waiting-for-pear', 41);
  });

  it('does not wrap the durable layer task in the legacy 15 second timeout', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('../../lib/psd-export.ts', import.meta.url),
      'utf8',
    ));

    expect(source).not.toMatch(/withTimeout\(\s*tryExternalLayerSplit/);
    expect(source).not.toContain("fetch('/api/layered-decompose'");
    expect(source).not.toContain("fetch('/api/design/layer-split'");
  });

  it('writes cropped provider layers at their PSD offsets', async () => {
    const {
      Canvas,
      Image,
      ImageData,
      createCanvas,
    } = await import('@napi-rs/canvas');
    const { initializeCanvas, readPsd } = await import('ag-psd');
    initializeCanvas(
      (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
      (width, height) => new ImageData(width, height) as unknown as globalThis.ImageData,
    );
    vi.stubGlobal('Image', Image);
    vi.stubGlobal('ImageData', ImageData);
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        return new Canvas(1, 1);
      },
    });

    const source = createCanvas(640, 480);
    source.getContext('2d').fillRect(0, 0, 640, 480);
    const cropped = createCanvas(240, 180);
    cropped.getContext('2d').fillRect(0, 0, 240, 180);
    runLayerDecomposition.mockResolvedValue({
      width: 640,
      height: 480,
      engine: 'pear',
      psdUrl: '/api/serve-upload/layers/result.psd',
      quality: { status: 'pass', score: 96, warnings: [] },
      layers: [{
        id: 'subject-offset',
        name: 'subject/01/offset_subject',
        role: 'subject',
        imageUrl: cropped.toDataURL('image/png'),
        width: 240,
        height: 180,
        offsetX: 120,
        offsetY: 90,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        source: 'pear-psd',
      }],
    });

    const result = await psdExport.exportAsPSD(
      source.toDataURL('image/png'),
      'offset-regression',
      { mode: 'pro' },
    );
    const parsed = readPsd(Buffer.from(await result.blob.arrayBuffer()), {
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const flattened = (parsed.children || []).flatMap((layer) => (
      layer.children ? layer.children : [layer]
    ));
    const subject = flattened.find((layer) => layer.name === 'subject/01/offset_subject');

    expect(subject).toMatchObject({
      left: 120,
      top: 90,
      right: 360,
      bottom: 270,
    });
  });

  it('reuses one persisted idempotency key after an ambiguous submit response', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockResolvedValueOnce({
        width: 640,
        height: 480,
        engine: 'local',
        quality: { status: 'pass', score: 82, warnings: [] },
        layers: [],
      });

    await expect(psdExport.requestExternalPsdScene(
      '/api/serve-upload/uploads/retry-source.png',
    )).rejects.toThrow('network response lost');
    await psdExport.requestExternalPsdScene(
      '/api/serve-upload/uploads/retry-source.png',
    );

    const firstKey = runLayerDecomposition.mock.calls[0]?.[0]?.idempotencyKey;
    const retryKey = runLayerDecomposition.mock.calls[1]?.[0]?.idempotencyKey;
    expect(firstKey).toMatch(/^psd-layer-[A-Za-z0-9_-]{8,118}$/);
    expect(retryKey).toBe(firstKey);
    expect(values.size).toBe(1);
  });

  it('derives the same idempotency key across isolated page modules before either stores a task', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition.mockRejectedValue(new TypeError('submit response lost'));
    const source = 'data:image/png;base64,Y3Jvc3MtdGFiLWlkZW1wb3RlbmN5';

    await expect(psdExport.requestExternalPsdScene(source)).rejects.toThrow('submit response lost');
    const firstKey = runLayerDecomposition.mock.calls[0]?.[0]?.idempotencyKey;

    values.clear();
    vi.resetModules();
    const isolatedPageModule = await import('@/lib/psd-export');
    await expect(isolatedPageModule.requestExternalPsdScene(source)).rejects.toThrow('submit response lost');
    const secondKey = runLayerDecomposition.mock.calls[1]?.[0]?.idempotencyKey;

    expect(firstKey).toMatch(/^psd-layer-[a-f0-9]{64}-0$/);
    expect(secondKey).toBe(firstKey);
  });

  it('does not submit a billable remote task when WebCrypto is unavailable', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('crypto', undefined);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    await expect(psdExport.requestExternalPsdScene(
      'data:image/png;base64,bm8td2ViLWNyeXB0bw==',
    )).rejects.toThrow('WebCrypto');

    expect(runLayerDecomposition).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it('advances the operation generation after success instead of permanently reusing an old task', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition.mockResolvedValue({
      width: 640,
      height: 480,
      engine: 'local',
      quality: { status: 'pass', score: 82, warnings: [] },
      layers: [],
    });
    const source = '/api/serve-upload/uploads/new-operation-after-success.png';

    await psdExport.requestExternalPsdScene(source);
    await psdExport.requestExternalPsdScene(source);

    const firstKey = runLayerDecomposition.mock.calls[0]?.[0]?.idempotencyKey;
    const secondKey = runLayerDecomposition.mock.calls[1]?.[0]?.idempotencyKey;
    expect(firstKey).toMatch(/-0$/);
    expect(secondKey).toMatch(/-1$/);
    expect(secondKey).not.toBe(firstKey);
  });

  it('does not let a late older generation erase a newer accepted task', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    const completed = {
      width: 640,
      height: 480,
      engine: 'local',
      quality: { status: 'pass', score: 82, warnings: [] },
      layers: [],
    };
    runLayerDecomposition
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second)
      .mockImplementationOnce(async (options) => {
        await options.onTaskId?.('newer-generation-task');
        throw new TypeError('newer generation poll lost');
      })
      .mockResolvedValueOnce(completed);
    const source = '/api/serve-upload/uploads/generation-race.png';

    const firstRun = psdExport.requestExternalPsdScene(source);
    const lateOldRun = psdExport.requestExternalPsdScene(source);
    await vi.waitFor(() => expect(runLayerDecomposition).toHaveBeenCalledTimes(2));
    resolveFirst(completed);
    await firstRun;
    await expect(psdExport.requestExternalPsdScene(source)).rejects.toThrow('newer generation poll lost');
    expect([...values.values()].join('\n')).toContain('newer-generation-task');
    resolveSecond(completed);
    await lateOldRun;
    expect([...values.values()].join('\n')).toContain('newer-generation-task');

    vi.resetModules();
    const reloaded = await import('@/lib/psd-export');
    await reloaded.requestExternalPsdScene(source);

    expect(runLayerDecomposition.mock.calls[3]?.[0]).toMatchObject({
      resumeTaskId: 'newer-generation-task',
    });
  });

  it('persists the resolved provider and model before an ambiguous submit can be retried', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        await options.onResolvedTarget?.({
          providerId: 'provider-before-reload',
          modelId: 'Image-Layered',
        });
        throw new TypeError('submit response lost');
      })
      .mockResolvedValueOnce({
        width: 640,
        height: 480,
        engine: 'local',
        quality: { status: 'pass', score: 82, warnings: [] },
        layers: [],
      });
    const source = '/api/serve-upload/uploads/provider-retry.png';

    await expect(psdExport.requestExternalPsdScene(source)).rejects.toThrow('submit response lost');
    vi.resetModules();
    const reloaded = await import('@/lib/psd-export');
    await reloaded.requestExternalPsdScene(source);

    expect(runLayerDecomposition.mock.calls[1]?.[0]).toMatchObject({
      providerId: 'provider-before-reload',
      modelId: 'Image-Layered',
    });
  });

  it('freezes the first provider and model for one generation across tabs', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    let authoritativeTarget: { providerId: string; modelId: string } | undefined;
    runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        await options.onResolvedTarget?.({ providerId: 'provider-a', modelId: 'Image-Layered-A' });
        throw new TypeError('first submit response lost');
      })
      .mockImplementationOnce(async (options) => {
        authoritativeTarget = await options.onResolvedTarget?.({
          providerId: 'provider-b',
          modelId: 'Image-Layered-B',
        });
        throw new TypeError('second submit response lost');
      });
    const source = '/api/serve-upload/uploads/frozen-provider.png';

    await expect(psdExport.requestExternalPsdScene(source)).rejects.toThrow('first submit response lost');
    vi.resetModules();
    const secondTab = await import('@/lib/psd-export');
    await expect(secondTab.requestExternalPsdScene(source)).rejects.toThrow('second submit response lost');

    expect(authoritativeTarget).toEqual({
      providerId: 'provider-a',
      modelId: 'Image-Layered-A',
    });
  });

  it('stores independent recovery records for different source images', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition.mockRejectedValue(new TypeError('poll response lost'));

    await expect(psdExport.requestExternalPsdScene(
      '/api/serve-upload/uploads/source-a.png',
    )).rejects.toThrow('poll response lost');
    await expect(psdExport.requestExternalPsdScene(
      '/api/serve-upload/uploads/source-b.png',
    )).rejects.toThrow('poll response lost');

    expect(values.size).toBe(2);
    expect([...values.keys()].every((key) => key.startsWith('wujie:psd-layer-resume:v3:'))).toBe(true);
  });

  it('fails closed before a billable request when browser recovery storage is unavailable', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage disabled');
      },
    });

    await expect(psdExport.requestExternalPsdScene(
      '/api/serve-upload/uploads/storage-required.png',
    )).rejects.toThrow('recovery storage');

    expect(runLayerDecomposition).not.toHaveBeenCalled();
  });

  it('keeps edited cropped layers at one absolute offset', async () => {
    const { Canvas, ImageData, createCanvas } = await import('@napi-rs/canvas');
    const { initializeCanvas, readPsd } = await import('ag-psd');
    initializeCanvas(
      (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
      (width, height) => new ImageData(width, height) as unknown as globalThis.ImageData,
    );
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        return new Canvas(1, 1);
      },
    });
    const cropped = createCanvas(240, 180);
    cropped.getContext('2d').fillRect(0, 0, 240, 180);

    const result = await psdExport.exportEditedLayersAsPSD([{
      id: 'edited-offset',
      role: 'subject',
      name: 'subject/01/edited_offset',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      offsetX: 120,
      offsetY: 90,
      canvas: cropped as unknown as HTMLCanvasElement,
      boundingBox: { x: 120, y: 90, width: 240, height: 180 },
      bbox: [120, 90, 360, 270],
      maskScore: 1,
      edgeScore: 1,
      warnings: [],
      reconstructMode: 'raster-safe',
      source: 'pear-psd',
    }], 640, 480, 'edited-offset', 'pro');
    const parsed = readPsd(Buffer.from(await result.blob.arrayBuffer()), {
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const subject = (parsed.children || [])
      .flatMap((layer) => layer.children || [layer])
      .find((layer) => layer.name === 'subject/01/edited_offset');

    expect(subject).toMatchObject({ left: 120, top: 90, right: 360, bottom: 270 });
  });

  it('resumes a persisted accepted task after the PSD module reloads', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        options.onTaskId?.('persisted-layer-task');
        throw new TypeError('poll response lost');
      })
      .mockResolvedValueOnce({
        width: 640,
        height: 480,
        engine: 'local',
        quality: { status: 'pass', score: 82, warnings: [] },
        layers: [],
      });

    await expect(psdExport.requestExternalPsdScene(
      'data:image/png;base64,cGVyc2lzdGVkLXJlc3VtZQ==',
    )).rejects.toThrow('poll response lost');
    vi.resetModules();
    const reloaded = await import('@/lib/psd-export');
    await reloaded.requestExternalPsdScene(
      'data:image/png;base64,cGVyc2lzdGVkLXJlc3VtZQ==',
    );

    expect(runLayerDecomposition.mock.calls[1]?.[0]).toMatchObject({
      resumeTaskId: 'persisted-layer-task',
    });
    expect(values.size).toBe(1);
  });

  it('keeps Studio-specific shadow processing after remote decomposition succeeds', async () => {
    const { Canvas, Image, ImageData, createCanvas } = await import('@napi-rs/canvas');
    const { initializeCanvas, readPsd } = await import('ag-psd');
    initializeCanvas(
      (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
      (width, height) => new ImageData(width, height) as unknown as globalThis.ImageData,
    );
    vi.stubGlobal('Image', Image);
    vi.stubGlobal('ImageData', ImageData);
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        return new Canvas(1, 1);
      },
    });
    const source = createCanvas(640, 480);
    source.getContext('2d').fillRect(0, 0, 640, 480);
    const subject = createCanvas(240, 180);
    subject.getContext('2d').fillRect(0, 0, 240, 180);
    runLayerDecomposition.mockResolvedValue({
      width: 640,
      height: 480,
      engine: 'pear',
      psdUrl: '/api/serve-upload/layers/result.psd',
      quality: { status: 'pass', score: 96, warnings: [] },
      layers: [{
        id: 'studio-subject',
        name: 'subject/01/studio_subject',
        role: 'subject',
        imageUrl: subject.toDataURL('image/png'),
        width: 240,
        height: 180,
        offsetX: 120,
        offsetY: 90,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        source: 'pear-psd',
      }],
    });

    const result = await psdExport.exportAsPSD(
      source.toDataURL('image/png'),
      'studio-regression',
      { mode: 'studio' },
    );
    const parsed = readPsd(Buffer.from(await result.blob.arrayBuffer()), {
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const names = (parsed.children || []).flatMap((layer) => (
      layer.children ? layer.children.map((child) => child.name) : [layer.name]
    ));

    expect(names).toEqual(expect.arrayContaining([
      expect.stringMatching(/^fx\/shadow\//),
    ]));
  });
});
