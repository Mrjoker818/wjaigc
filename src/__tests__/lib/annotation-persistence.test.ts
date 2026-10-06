import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  markStaleAnnotations,
  restoreAnnotations,
  serializeAnnotations,
} from '@/features/annotations/annotation-persistence';
import type {
  CanvasAnnotationV2,
  LegacyCanvasAnnotation,
} from '@/features/annotations/annotation-types';
import { validateCanvasDocumentProjection } from '@/lib/collaboration/canvas-document';
import { toCanvasDocumentAnnotationRecords } from '@/lib/collaboration/canvas-document-image-bridge';
import { beginAnnotationGesture, commitAnnotationGesture,
  createInitialAnnotationControllerState } from '@/features/annotations/use-annotation-controller';

function makeAnnotation(
  overrides: Partial<CanvasAnnotationV2> = {},
): CanvasAnnotationV2 {
  return {
    id: 'annotation-1',
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    type: 'region',
    geometry: {
      kind: 'region',
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    },
    status: 'ready',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('annotation persistence', () => {
  function readDocument(annotations: CanvasAnnotationV2[]): void {
    validateCanvasDocumentProjection({
      placements: { placement: { assetVersionId: 'version-1', x: 0, y: 0,
        width: 200, height: 200, rotation: 0, zIndex: 1 } },
      annotationRecords: toCanvasDocumentAnnotationRecords(serializeAnnotations(annotations),
        [{ id: 'image-1', placementId: 'placement', url: '/api/serve-upload/source.png',
          x: 0, y: 0, width: 200, height: 200 }]),
    });
  }

  it('serializes a real arrow without a prompt into the strict document contract', () => {
    const initial = { ...createInitialAnnotationControllerState(), tool: 'arrow' as const };
    const begun = beginAnnotationGesture(initial, {
      projectId: 'project-1', imageId: 'image-1', versionId: 'version-1',
      imageRect: { x: 0, y: 0, width: 200, height: 200 },
    }, { x: 20, y: 40 });
    const committed = commitAnnotationGesture(begun, { x: 140, y: 160 }, 'arrow-1', 3);
    expect(committed.annotations).toHaveLength(1);
    expect(() => readDocument(committed.annotations)).not.toThrow();
    const serialized = serializeAnnotations(committed.annotations);
    expect(Object.hasOwn(serialized[0], 'instruction')).toBe(false);
    expect(serialized[0].geometry).toEqual({ kind: 'arrow',
      start: { x: 0.1, y: 0.2 }, end: { x: 0.7, y: 0.8 } });
  });

  it.each(['label', 'instruction', 'confidence', 'maskAssetId', 'overlayAssetId'] as const)(
    'omits absent optional %s before Yjs validation without mutating the source', field => {
      const record = makeAnnotation({ [field]: undefined });
      expect(() => readDocument([record])).not.toThrow();
      expect(Object.hasOwn(serializeAnnotations([record])[0], field)).toBe(false);
      expect(Object.hasOwn(record, field)).toBe(true);
    },
  );

  it('preserves a valid frozen order key distinct from the restored record identity', () => {
    const record = makeAnnotation({ id: 'restored-record', orderKey: 'original-creation', instruction: undefined });
    expect(() => readDocument([record])).not.toThrow();
    const serialized = serializeAnnotations([record]);
    expect(serialized[0].id).toBe('restored-record');
    expect(serialized[0].orderKey).toBe('original-creation');
    expect(record.orderKey).toBe('original-creation');
  });

  it.each([
    { instruction: null }, { instruction: 7 }, { instruction: 'x'.repeat(1001) },
    { orderKey: undefined }, { orderKey: null }, { orderKey: 'https://invalid.example' },
  ])('does not hide invalid defined metadata or an invalid frozen order identity: %j', invalid => {
    const record = makeAnnotation(invalid as unknown as Partial<CanvasAnnotationV2>);
    expect(() => readDocument([record])).toThrow();
  });

  it('removes inline and blob asset URLs during serialization', () => {
    const serialized = serializeAnnotations([
      makeAnnotation({
        maskAssetId: 'data:image/png;base64,unsafe',
        overlayAssetId: 'blob:http://localhost/temporary',
      }),
    ]);

    expect(serialized).toHaveLength(1);
    expect(serialized[0].maskAssetId).toBeUndefined();
    expect(serialized[0].overlayAssetId).toBeUndefined();
  });

  it('preserves managed asset references during serialization', () => {
    const serialized = serializeAnnotations([
      makeAnnotation({
        maskAssetId: '/api/serve-upload/mask.png',
        overlayAssetId: '/uploads/annotation.png',
      }),
    ]);

    expect(serialized[0].maskAssetId).toBe('/api/serve-upload/mask.png');
    expect(serialized[0].overlayAssetId).toBe('/uploads/annotation.png');
  });

  it('restores valid V2 annotations and migrates legacy records', () => {
    const legacy: LegacyCanvasAnnotation = {
      id: 'legacy-1',
      x: 50,
      y: 50,
      text: '修改这里',
      targetImageId: 'image-1',
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      createdAt: 1,
    };

    const restored = restoreAnnotations(
      [makeAnnotation(), legacy],
      {
        projectId: 'project-1',
        sources: [
          {
            imageId: 'image-1',
            versionId: 'version-1',
            url: '/uploads/source.png',
          },
        ],
        now: 10,
      },
    );

    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({
      id: 'annotation-1',
      status: 'ready',
    });
    expect(restored[1]).toMatchObject({
      id: 'legacy-1',
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      status: 'ready',
    });
  });

  it('drops annotations whose source image was deleted', () => {
    const restored = restoreAnnotations(
      [makeAnnotation()],
      { projectId: 'project-1', sources: [] },
    );

    expect(restored).toEqual([]);
  });

  it('marks spatial annotations stale when the source version changes', () => {
    const annotations = [
      makeAnnotation(),
      makeAnnotation({
        id: 'text-1',
        type: 'text',
        geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } },
      }),
    ];

    const result = markStaleAnnotations(annotations, [
      {
        imageId: 'image-1',
        versionId: 'version-2',
        url: '/uploads/replaced.png',
      },
    ]);

    expect(result[0].status).toBe('stale');
    expect(result[1].status).toBe('ready');
  });

  it('does not mutate the input annotations', () => {
    const annotation = makeAnnotation();
    const serialized = serializeAnnotations([annotation]);

    expect(serialized[0]).not.toBe(annotation);
    expect(serialized[0].geometry).not.toBe(annotation.geometry);
  });
});

describe('annotation project persistence wiring', () => {
  it('includes annotation records in autosave, unload save, and canvas restoration', () => {
    const workspaceSource = readFileSync(
      resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
      'utf8',
    );

    expect(workspaceSource).toContain('annotationsV2: annotationRecordsRef.current');
    expect(workspaceSource).toContain('initialAnnotations={initialCanvasAnnotations}');
    expect(workspaceSource).toContain('onAnnotationsChange={handleAnnotationsChange}');
    const autosaveStart = workspaceSource.indexOf(
      'const immediateSaveGuard = consumeCanvasHydrationGuardQueue(',
    );
    const autosaveEnd = workspaceSource.indexOf('// 页面关闭/刷新前同步保存', autosaveStart);
    const autosaveSource = workspaceSource.slice(autosaveStart, autosaveEnd);
    expect(autosaveSource).toContain('buildCanvasPersistenceSnapshot(images, currentProject)');
    expect(autosaveSource).toContain('annotationRevision,');
    expect(autosaveSource).toContain('serverSyncMergeRevision,');
  });
});
