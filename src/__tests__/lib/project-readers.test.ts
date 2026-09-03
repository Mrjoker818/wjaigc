import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareLegacyAndAssetProjection,
  readProjectSnapshot,
} from '@/lib/asset-core/project-readers';

const fixturesDirectory = resolve(process.cwd(), 'tests/fixtures/projects');

function loadFixture(name: string): { bytes: Buffer; value: unknown } {
  const bytes = readFileSync(resolve(fixturesDirectory, name));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) as unknown };
}

function deepFreeze(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

describe('readProjectSnapshot', () => {
  it('reads absent schemaVersion as v1, aliases images, and does not mutate JSON bytes', () => {
    const fixture = loadFixture('v1-images-alias.json');
    const input = deepFreeze(fixture.value);
    const before = Buffer.from(JSON.stringify(input));

    const result = readProjectSnapshot(input);

    expect(result.sourceSchemaVersion).toBe(1);
    expect(result.writeTargetVersion).toBe(3);
    expect(result.project?.canvasImages).toHaveLength(1);
    expect(result.project?.canvasImages[0]?.url).toBe('/api/serve-upload/uploads/alias.png');
    expect((input as { canvasImages?: unknown }).canvasImages).toBeUndefined();
    expect(Buffer.from(JSON.stringify(input))).toEqual(before);
    expect(fixture.bytes.equals(readFileSync(resolve(fixturesDirectory, 'v1-images-alias.json')))).toBe(true);
  });

  it('uses explicit transitional and unified readers for v2 and v3', () => {
    const base = loadFixture('v1-images-alias.json').value as Record<string, unknown>;
    const images = base.images;
    const v2 = readProjectSnapshot(deepFreeze({ ...base, schemaVersion: 2 }));
    const v3 = readProjectSnapshot(deepFreeze({
      ...base,
      schemaVersion: 3,
      canvasImages: images,
      images: undefined,
    }));

    expect(v2.sourceSchemaVersion).toBe(2);
    expect(v2.warnings.map((warning) => warning.code)).toContain('PROJECT_V2_TRANSITIONAL');
    expect(v2.project?.canvasImages).toHaveLength(1);
    expect(v3.sourceSchemaVersion).toBe(3);
    expect(v3.warnings).toEqual([]);
    expect(v3.project?.canvasImages).toHaveLength(1);
  });

  it('quarantines corrupt input instead of replacing it with an empty canvas', () => {
    const { value } = loadFixture('v1-corrupt-project.json');
    const result = readProjectSnapshot(deepFreeze(value));

    expect(result.project).toBeNull();
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROJECT_QUARANTINED', severity: 'error' }),
    ]));
    expect(JSON.stringify(result)).not.toContain('"canvasImages":[]');
  });

  it('classifies data URLs as pending-persist without dropping their placement', () => {
    const result = readProjectSnapshot(deepFreeze(loadFixture('v1-data-url.json').value));

    expect(result.project?.canvasImages).toHaveLength(1);
    expect(result.project?.canvasImages[0]).toMatchObject({
      id: 'legacy-data-image',
      mediaAvailability: 'pending-persist',
      _pendingPersist: true,
    });
    expect(result.unresolvedMedia).toEqual([
      expect.objectContaining({ imageId: 'legacy-data-image', availability: 'pending-persist' }),
    ]);
  });

  it('classifies expired blob URLs as missing without dropping their placement', () => {
    const result = readProjectSnapshot(deepFreeze(loadFixture('v1-blob-url.json').value));

    expect(result.project?.canvasImages).toHaveLength(1);
    expect(result.project?.canvasImages[0]).toMatchObject({
      id: 'legacy-blob-image',
      url: 'blob:https://app.example.invalid/expired',
      mediaAvailability: 'missing',
    });
    expect(result.unresolvedMedia).toEqual([
      expect.objectContaining({ imageId: 'legacy-blob-image', availability: 'missing' }),
    ]);
  });

  it('preserves sourceUrl as a recovery source when the primary URL is absent', () => {
    const result = readProjectSnapshot(deepFreeze(loadFixture('v1-source-url-recovery.json').value));
    const image = result.project?.canvasImages[0];

    expect(image?.url).toBe('');
    expect(image?.sourceUrl).toBe('https://media.example.invalid/original.png');
    expect(image?.mediaAvailability).toBe('missing');
    expect(result.unresolvedMedia[0]).toMatchObject({
      recoverySourceUrl: 'https://media.example.invalid/original.png',
    });
  });

  it('preserves video, 3D, SVG, and PSD fields while normalizing legacy local URLs', () => {
    const result = readProjectSnapshot(deepFreeze(loadFixture('v1-video-3d-svg.json').value));
    const image = result.project?.canvasImages[0] as Record<string, unknown> | undefined;

    expect(image).toMatchObject({
      sourceUrl: 'https://media.example.invalid/preview.png',
      mediaType: 'video',
      videoUrl: '/api/serve-upload/uploads/clip.mp4',
      threeDModelUrl: '/api/serve-upload/uploads/model.glb',
      svgDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      svgUrl: '/api/serve-upload/uploads/vector.svg',
      psdUrl: '/api/serve-upload/uploads/layers.psd',
    });
    expect(image?.threeDTextureUrls).toEqual([
      { diffuse: '/api/serve-upload/uploads/diffuse.png' },
    ]);
  });

  it('sanitizes and freezes source trace while reading persisted projects', () => {
    const validTrace = {
      source: 'canvas-skill', runId: 'run-1', skillId: 'skill-000000000000000000000001',
      skillVersion: 1, sourceVersionIds: ['version-a'], createdAt: '2026-09-02T00:00:00.000Z',
    } as const;
    const baseImage = (loadFixture('v1-images-alias.json').value as {
      images: Record<string, unknown>[];
    }).images[0]!;
    const valid = readProjectSnapshot(deepFreeze({
      id: 'project-valid-trace', schemaVersion: 3, settings: {},
      canvasImages: [{ ...baseImage, sourceTrace: validTrace }],
    }));
    const invalid = readProjectSnapshot(deepFreeze({
      id: 'project-invalid-trace', schemaVersion: 3, settings: {},
      canvasImages: [{ ...baseImage, sourceTrace: { ...validTrace, runId: 'bad run id' } }],
    }));

    const restored = valid.project?.canvasImages[0]?.sourceTrace;
    expect(restored).toEqual(validTrace);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.source === 'canvas-skill' ? restored.sourceVersionIds : [])).toBe(true);
    expect(invalid.project?.canvasImages[0]).not.toHaveProperty('sourceTrace');
  });

  it('keeps a video placement ready when it has a video URL but no poster image', () => {
    const result = readProjectSnapshot(deepFreeze({
      id: 'video-without-poster',
      schemaVersion: 3,
      settings: {},
      canvasImages: [{
        id: 'video-1',
        url: '',
        videoUrl: '/api/serve-upload/video/task-1/result.mp4',
        mediaType: 'video',
        x: 0,
        y: 0,
        width: 400,
        height: 225,
        originalWidth: 1920,
        originalHeight: 1080,
        createdAt: 1,
      }],
    }));

    expect(result.project?.canvasImages[0]).toMatchObject({
      mediaType: 'video',
      videoUrl: '/api/serve-upload/video/task-1/result.mp4',
      mediaAvailability: 'ready',
    });
    expect(result.unresolvedMedia).toEqual([]);
  });

  it('infers a legacy video from videoUrl before the first Asset V3 migration', () => {
    const result = readProjectSnapshot(deepFreeze({
      id: 'legacy-video-without-media-type',
      name: 'Legacy video',
      canvasImages: [{
        id: 'legacy-video-1',
        url: '',
        videoUrl: '/api/serve-upload/video/task-legacy/result.mp4',
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        originalWidth: 1920,
        originalHeight: 1080,
        rotation: 0,
        zIndex: 1,
        createdAt: 1,
      }],
      settings: {},
    }));

    expect(result.unresolvedMedia).toEqual([]);
    expect(result.project?.canvasImages[0]).toMatchObject({
      mediaType: 'video',
      mediaAvailability: 'ready',
      videoUrl: '/api/serve-upload/video/task-legacy/result.mp4',
    });
  });

  it('normalizes only known media URL fields and preserves upload-like text', () => {
    const fixture = loadFixture('v1-video-3d-svg.json').value as Record<string, unknown>;
    const canvasImages = fixture.canvasImages as Record<string, unknown>[];
    const raw = {
      ...fixture,
      description: '/uploads/not-a-url-note',
      canvasImages: [{
        ...canvasImages[0],
        prompt: '/uploads/not-a-url-note',
        unknownMetadata: { note: '/uploads/not-a-url-note' },
      }],
      metadata: {
        groups: [{
          id: 'text-group',
          name: '/uploads/not-a-url-note',
          note: '/uploads/not-a-url-note',
          imageIds: ['legacy-rich-media'],
        }],
        annotationsV2: [{
          id: 'text-annotation',
          text: '/uploads/not-a-url-note',
        }],
        unknown: '/uploads/not-a-url-note',
      },
    };

    const result = readProjectSnapshot(deepFreeze(raw));
    const project = result.project as unknown as Record<string, unknown>;
    const image = result.project?.canvasImages[0] as unknown as Record<string, unknown>;
    const metadata = project.metadata as Record<string, unknown>;

    expect(project.description).toBe('/uploads/not-a-url-note');
    expect(image.prompt).toBe('/uploads/not-a-url-note');
    expect(image.unknownMetadata).toEqual({ note: '/uploads/not-a-url-note' });
    expect(metadata.unknown).toBe('/uploads/not-a-url-note');
    expect(metadata.groups).toEqual([
      expect.objectContaining({
        name: '/uploads/not-a-url-note',
        note: '/uploads/not-a-url-note',
      }),
    ]);
    expect(metadata.annotationsV2).toEqual([
      expect.objectContaining({ text: '/uploads/not-a-url-note' }),
    ]);
    expect(image.url).toBe('/api/serve-upload/uploads/preview.png');
    expect(image.videoUrl).toBe('/api/serve-upload/uploads/clip.mp4');
    expect(image.threeDModelUrls).toEqual({
      glb: '/api/serve-upload/uploads/model.glb',
    });
  });

  it('preserves processing placeholders, annotations, and group metadata', () => {
    const processing = readProjectSnapshot(deepFreeze(loadFixture('v1-processing-matrix.json').value));
    const shared = readProjectSnapshot(deepFreeze(loadFixture('v1-shared-placement.json').value));

    expect(processing.project?.canvasImages).toHaveLength(2);
    expect(processing.project?.canvasImages[0]?.processing).toMatchObject({
      status: 'processing',
      progress: 42,
      taskId: 'fixture-task-active',
    });
    expect(processing.project?.canvasImages[1]?.processing).toMatchObject({
      status: 'failed',
      retryable: true,
    });
    expect(shared.project?.metadata?.groups).toEqual([
      expect.objectContaining({ id: 'fixture-group', collapsed: true }),
    ]);
    expect(shared.project?.metadata?.annotationsV2).toEqual([
      expect.objectContaining({ id: 'fixture-annotation', sourceImageId: 'legacy-shared-a' }),
    ]);
  });

  it('keeps separate placements when two legacy IDs share one URL', () => {
    const result = readProjectSnapshot(deepFreeze(loadFixture('v1-shared-placement.json').value));

    expect(result.project?.canvasImages.map((image) => image.id)).toEqual([
      'legacy-shared-a',
      'legacy-shared-b',
    ]);
    expect(new Set(result.project?.canvasImages.map((image) => image.url))).toEqual(
      new Set(['https://media.example.invalid/shared.png']),
    );
  });

  it('compares lossless legacy and asset projections without mutating either side', () => {
    const legacy = deepFreeze(loadFixture('v1-shared-placement.json').value);
    const projected = readProjectSnapshot(legacy).project;

    const comparison = compareLegacyAndAssetProjection({ legacy, assetProjection: projected });

    expect(comparison).toEqual({ matches: true, differences: [] });
  });

  it('compares semantically identical projections independent of object key order', () => {
    const legacy = {
      id: 'key-order-project',
      userId: 'key-order-owner',
      name: 'Key order',
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      settings: { model: 'fixture-model', quality: 'high' },
      metadata: { nested: { alpha: 1, beta: { first: true, second: false } } },
      canvasImages: [{
        id: 'key-order-image',
        url: 'https://media.example.invalid/key-order.png',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        originalWidth: 5,
        originalHeight: 6,
        rotation: 0,
        zIndex: 1,
        createdAt: 1700000000000,
      }],
    };
    const reordered = {
      schemaVersion: 3,
      canvasImages: [{
        createdAt: 1700000000000,
        zIndex: 1,
        rotation: 0,
        originalHeight: 6,
        originalWidth: 5,
        height: 4,
        width: 3,
        y: 2,
        x: 1,
        url: 'https://media.example.invalid/key-order.png',
        id: 'key-order-image',
      }],
      metadata: { nested: { beta: { second: false, first: true }, alpha: 1 } },
      settings: { quality: 'high', model: 'fixture-model' },
      updatedAt: 1700000001000,
      createdAt: 1700000000000,
      name: 'Key order',
      userId: 'key-order-owner',
      id: 'key-order-project',
    };

    expect(compareLegacyAndAssetProjection({
      legacy: deepFreeze(legacy),
      assetProjection: deepFreeze(reordered),
    })).toEqual({ matches: true, differences: [] });
  });
});
