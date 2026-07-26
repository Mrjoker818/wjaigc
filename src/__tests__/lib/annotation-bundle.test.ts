import { describe, expect, it } from 'vitest';

import {
  buildEditIntentBundle,
  migrateLegacyAnnotation,
  validateEditIntentBundle,
} from '@/features/annotations/annotation-bundle';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

function makeRegionAnnotation(
  id: string,
  overrides: Partial<CanvasAnnotationV2> = {},
): CanvasAnnotationV2 {
  return {
    id,
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    type: 'region',
    geometry: {
      kind: 'region',
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    },
    instruction: '修改这个区域',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('annotation edit intent bundle', () => {
  it('requires at least one annotation', () => {
    expect(() => buildEditIntentBundle([])).toThrow('至少需要 1 条批注');
  });

  it('limits one edit request to ten annotations', () => {
    const annotations = Array.from({ length: 11 }, (_, index) =>
      makeRegionAnnotation(`annotation-${index}`),
    );

    expect(() => buildEditIntentBundle(annotations)).toThrow('最多支持 10 条批注');
  });

  it('rejects annotations from different source versions', () => {
    const annotations = [
      makeRegionAnnotation('annotation-1'),
      makeRegionAnnotation('annotation-2', { sourceVersionId: 'version-2' }),
    ];

    expect(() => buildEditIntentBundle(annotations)).toThrow('批注来源版本不一致');
  });

  it('keeps every annotation instead of reducing the bundle to the first mask', () => {
    const annotations = [
      makeRegionAnnotation('annotation-1'),
      makeRegionAnnotation('annotation-2'),
      makeRegionAnnotation('annotation-3'),
    ];

    const bundle = buildEditIntentBundle(annotations, {
      prompt: '统一调整三个区域',
      modelId: 'gpt-image-2',
      providerId: 'provider-1',
    });

    expect(bundle.annotationIds).toEqual([
      'annotation-1',
      'annotation-2',
      'annotation-3',
    ]);
    expect(bundle.annotations).toHaveLength(3);
  });

  it('rejects a brush annotation with no drawable path', () => {
    const invalidBrush = makeRegionAnnotation('annotation-1', {
      type: 'brush',
      geometry: {
        kind: 'brush',
        points: [],
        width: 0.02,
      },
    });

    const result = validateEditIntentBundle({
      ...buildEditIntentBundle([invalidBrush], { skipGeometryValidation: true }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ANNOTATION_GEOMETRY_INVALID');
    }
  });

  it('marks legacy canvas coordinates stale when source image bounds are unavailable', () => {
    const migrated = migrateLegacyAnnotation({
      id: 'legacy-1',
      x: 0.5,
      y: 0.5,
      text: 'change this point',
      targetImageId: 'image-1',
      status: 'pending',
      createdAt: 1,
    }, {
      projectId: 'project-1',
      sourceVersionId: 'version-1',
      now: 2,
    });

    expect(migrated.status).toBe('stale');
    expect(migrated.geometry.kind).toBe('text');
    if (migrated.geometry.kind === 'text') {
      expect(
        migrated.geometry.point.x >= 0
        && migrated.geometry.point.x <= 1
        && migrated.geometry.point.y >= 0
        && migrated.geometry.point.y <= 1,
      ).toBe(false);
    }
  });

  it('normalizes legacy canvas coordinates only with source image bounds', () => {
    const migrated = migrateLegacyAnnotation({
      id: 'legacy-1',
      x: 250,
      y: 150,
      text: 'change this point',
      targetImageId: 'image-1',
      status: 'pending',
      createdAt: 1,
    }, {
      projectId: 'project-1',
      sourceVersionId: 'version-1',
      sourceImageBounds: { x: 100, y: 50, width: 300, height: 200 },
      now: 2,
    });

    expect(migrated.status).toBe('ready');
    expect(migrated.geometry).toEqual({
      kind: 'text',
      point: { x: 0.5, y: 0.5 },
    });
  });

  it('never fabricates a drawable brush path from a legacy mask data URL', () => {
    const migrated = migrateLegacyAnnotation({
      id: 'legacy-brush',
      x: 250,
      y: 150,
      text: 'change the brushed area',
      targetImageId: 'image-1',
      brushMaskDataUrl: 'data:image/png;base64,legacy-mask',
      status: 'pending',
      createdAt: 1,
    }, {
      projectId: 'project-1',
      sourceVersionId: 'version-1',
      sourceImageBounds: { x: 100, y: 50, width: 300, height: 200 },
      now: 2,
    });

    expect(migrated.status).toBe('stale');
    expect(migrated.geometry.kind).toBe('brush');
    if (migrated.geometry.kind === 'brush') {
      expect(migrated.geometry.points).toEqual([]);
    }
  });

  it('rejects an out-of-bounds region instead of clamping it during validation', () => {
    const invalidRegion = makeRegionAnnotation('annotation-1', {
      geometry: {
        kind: 'region',
        region: { x: 0.9, y: 0.1, w: 0.2, h: 0.2 },
      },
    });

    const result = validateEditIntentBundle(
      buildEditIntentBundle([invalidRegion], { skipGeometryValidation: true }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ANNOTATION_GEOMETRY_INVALID');
    }
  });

  it.each(['projectId', 'sourceImageId', 'sourceVersionId'] as const)(
    'rejects an empty %s across bundle and annotations',
    (field) => {
      const bundle = buildEditIntentBundle([makeRegionAnnotation('annotation-1')]);
      const invalidBundle = {
        ...bundle,
        [field]: ' ',
        annotations: bundle.annotations.map((annotation) => ({
          ...annotation,
          [field]: ' ',
        })),
      };

      const result = validateEditIntentBundle(invalidBundle);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('ANNOTATION_SOURCE_MISMATCH');
      }
    },
  );

  it('requires annotationIds to exactly match annotation order', () => {
    const bundle = buildEditIntentBundle([
      makeRegionAnnotation('annotation-1'),
      makeRegionAnnotation('annotation-2'),
    ]);

    const result = validateEditIntentBundle({
      ...bundle,
      annotationIds: ['annotation-2', 'annotation-1'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate IDs even when annotationIds match annotations', () => {
    const bundle = buildEditIntentBundle([
      makeRegionAnnotation('annotation-1'),
      makeRegionAnnotation('annotation-2'),
    ]);

    const result = validateEditIntentBundle({
      ...bundle,
      annotationIds: ['annotation-1', 'annotation-1'],
      annotations: bundle.annotations.map((annotation) => ({
        ...annotation,
        id: 'annotation-1',
      })),
    });

    expect(result.success).toBe(false);
  });

  it('requires annotation type to match its geometry kind', () => {
    const mismatched = makeRegionAnnotation('annotation-1', {
      type: 'text',
    });

    const result = validateEditIntentBundle(
      buildEditIntentBundle([mismatched], { skipGeometryValidation: true }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ANNOTATION_GEOMETRY_INVALID');
    }
  });

  it('rejects non-finite region geometry', () => {
    const nonFiniteRegion = makeRegionAnnotation('annotation-1', {
      geometry: {
        kind: 'region',
        region: { x: Number.NaN, y: 0.1, w: 0.2, h: 0.2 },
      },
    });

    const result = validateEditIntentBundle(
      buildEditIntentBundle([nonFiniteRegion], { skipGeometryValidation: true }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects non-finite brush paths', () => {
    const nonFiniteBrush = makeRegionAnnotation('annotation-1', {
      type: 'brush',
      geometry: {
        kind: 'brush',
        points: [
          { x: 0.1, y: 0.1 },
          { x: Number.POSITIVE_INFINITY, y: 0.2 },
        ],
        width: 0.02,
      },
    });

    const result = validateEditIntentBundle(
      buildEditIntentBundle([nonFiniteBrush], { skipGeometryValidation: true }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects oversized prompt and instruction text', () => {
    const bundle = buildEditIntentBundle([
      makeRegionAnnotation('annotation-1', {
        instruction: 'x'.repeat(2001),
      }),
    ], {
      prompt: 'p'.repeat(4001),
      skipGeometryValidation: true,
    });

    const result = validateEditIntentBundle(bundle);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ANNOTATION_COMPLEXITY_INVALID');
    }
  });

  it('rejects oversized brush and semantic polygon geometry', () => {
    const brush = makeRegionAnnotation('annotation-brush', {
      type: 'brush',
      geometry: {
        kind: 'brush',
        points: Array.from({ length: 2049 }, () => ({ x: 0.5, y: 0.5 })),
        width: 0.02,
      },
    });
    const polygon = makeRegionAnnotation('annotation-polygon', {
      type: 'semantic-object',
      geometry: {
        kind: 'semantic-object',
        region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        polygon: Array.from({ length: 1025 }, () => ({ x: 0.5, y: 0.5 })),
      },
    });

    for (const annotation of [brush, polygon]) {
      const result = validateEditIntentBundle(
        buildEditIntentBundle([annotation], { skipGeometryValidation: true }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('ANNOTATION_COMPLEXITY_INVALID');
      }
    }
  });

  it('rejects oversized identifiers and idempotency keys', () => {
    const bundle = buildEditIntentBundle([makeRegionAnnotation('annotation-1')], {
      idempotencyKey: `annotation_request_${'x'.repeat(129)}`,
    });

    const result = validateEditIntentBundle({
      ...bundle,
      modelId: 'm'.repeat(257),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ANNOTATION_COMPLEXITY_INVALID');
    }
  });
});
