import { describe, expect, it } from 'vitest';
import { restoreAnnotations, serializeAnnotations } from '@/features/annotations/annotation-persistence';
import type { CanvasAnnotationV2, NormalizedAnnotationGeometry } from '@/features/annotations/annotation-types';

const source = { imageId: 'image', versionId: 'v1', url: '/uploads/image.png' };
const options = { projectId: 'project', sources: [source] };
function record(type: string, geometry: unknown): Record<string, unknown> {
  return { id: 'bad', projectId: 'project', sourceImageId: 'image', sourceVersionId: 'v1',
    type, geometry, status: 'ready', createdAt: 1, updatedAt: 2 };
}

describe('unknown persisted annotation geometry', () => {
  it('preserves unresolved legacy text placeholders across migration, save and restoration', () => {
    const legacy = { id: 'legacy', x: 90, y: 80, text: 'Keep this note', targetImageId: 'image', createdAt: 1 };
    const migrated = restoreAnnotations([legacy], options);
    expect(migrated[0]).toMatchObject({ status: 'stale', geometry: { kind: 'text', point: { x: -1, y: -1 } } });
    expect(restoreAnnotations(serializeAnnotations(migrated), options)).toEqual(migrated);
  });

  it('does not allow a ready text annotation to use the unresolved legacy placeholder', () => {
    expect(restoreAnnotations([record('text', { kind: 'text', point: { x: -1, y: -1 } })], options)).toEqual([]);
  });
  it.each([
    ['brush', { kind: 'brush', width: 0.1 }],
    ['brush', { kind: 'brush', width: 0.1, points: {} }],
    ['brush', { kind: 'brush', width: 0.1, points: [null] }],
    ['brush', { kind: 'brush', width: Number.NaN, points: [{ x: 0.1, y: 0.2 }] }],
    ['arrow', { kind: 'arrow', start: { x: 0.1, y: 0.2 } }],
    ['text', { kind: 'text', point: { x: Number.POSITIVE_INFINITY, y: 0.2 } }],
    ['region', { kind: 'region', region: { x: 0.9, y: 0.2, w: 0.3, h: 0.2 } }],
    ['semantic-object', { kind: 'semantic-object', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, polygon: 'invalid' }],
    ['text', { kind: 'unknown', point: { x: 0.1, y: 0.2 } }],
    ['text', { kind: 'arrow', start: { x: 0.1, y: 0.2 }, end: { x: 0.5, y: 0.6 } }],
  ])('skips malformed %s geometry without aborting restoration of adjacent valid records: %j', (type, geometry) => {
    const valid = { ...record('text', { kind: 'text', point: { x: 0.1, y: 0.2 } }), id: 'good' };
    expect(restoreAnnotations([record(type, geometry), valid], options)).toEqual([valid]);
  });

  it.each<NormalizedAnnotationGeometry>([
    { kind: 'brush', width: 0.1, points: [{ x: 0.1, y: 0.2 }] },
    { kind: 'arrow', start: { x: 0.1, y: 0.2 }, end: { x: 0.5, y: 0.6 } },
    { kind: 'text', point: { x: 0.1, y: 0.2 } },
    { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 } },
    { kind: 'semantic-object', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, polygon: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.4 }] },
  ])('preserves and independently clones valid $kind geometry, including a one-point draft brush', geometry => {
    const valid = { ...record(geometry.kind, geometry), status: 'draft' } as unknown as CanvasAnnotationV2;
    const restored = restoreAnnotations([valid], options);
    expect(restored).toEqual([valid]);
    expect(restored[0]).not.toBe(valid);
    expect(restored[0].geometry).not.toBe(geometry);
  });
});
