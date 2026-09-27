import { describe, expect, it } from 'vitest';

import {
  canUseLegacyCanvasPersistence,
  commitAcceptedCanvasImageChange,
  commitCanvasImageRefChange,
  collectCanvasDocumentPatches,
  projectCanvasDocumentMetadata,
  projectDocumentPlacementsOntoImages,
  routeCanvasWorkspaceChange,
  shouldKeepDirtyCanvasAnnotations,
  toCanvasDocumentAnnotationRecords,
  toCanvasDocumentGroupRecords,
} from '@/lib/collaboration/canvas-document-image-bridge';
import type { CanvasDocumentProjection, CanvasPlacement } from '@/lib/collaboration/canvas-document';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import type { CanvasImage } from '@/lib/user-types';

function image(id: string, placementId: string, x: number): CanvasImage {
  return {
    id, placementId, assetId: `asset-${id}`, assetVersionId: `version-${id}`,
    url: `/api/serve-upload/${id}.png`, x, y: 20, width: 80, height: 60,
    originalWidth: 80, originalHeight: 60, rotation: 0, zIndex: 1,
    createdAt: 1,
  };
}

function placement(id: string, x: number): CanvasPlacement {
  return {
    assetVersionId: `version-${id}`, x, y: 20, width: 80, height: 60,
    rotation: 0, zIndex: 1,
  };
}

describe('canvas document image bridge', () => {
  it('keeps the accepted image ref unchanged when the parent rejects a drag', () => {
    const before = [image('a', 'p1', 10)];
    const after = [{ ...before[0], x: 66 }];
    const rejected = commitAcceptedCanvasImageChange(before, after, () => false);
    expect(rejected).toEqual({ accepted: false, images: before });
    expect(commitAcceptedCanvasImageChange(before, after, () => true))
      .toEqual({ accepted: true, images: after });
  });

  it('starts a later child operation from accepted state after an async completion is rejected', () => {
    const original = image('a', 'p1', 10);
    const ref = { current: [original] };
    const completion = [{ ...original, url: '/api/serve-upload/not-adopted.png' }];
    expect(commitCanvasImageRefChange(ref, completion, () => false)).toBe(false);
    expect(ref.current).toEqual([original]);
    const laterMove = ref.current.map(item => ({ ...item, x: item.x + 5 }));
    expect(commitCanvasImageRefChange(ref, laterMove, () => true)).toBe(true);
    expect(ref.current).toEqual([{ ...original, x: 15 }]);
  });

  it('retains dirty legacy annotations but accepts document authority and project changes', () => {
    expect(shouldKeepDirtyCanvasAnnotations({
      projectChanged: false, documentMode: false, dirty: true,
    })).toBe(true);
    expect(shouldKeepDirtyCanvasAnnotations({
      projectChanged: false, documentMode: true, dirty: true,
    })).toBe(false);
    expect(shouldKeepDirtyCanvasAnnotations({
      projectChanged: true, documentMode: false, dirty: true,
    })).toBe(false);
  });

  it('emits only the changed managed placement transform, never task-only changes', () => {
    const before = [image('a', 'p1', 10), image('b', 'p2', 20)];
    const after = [
      { ...before[0], x: 100 },
      { ...before[1], isPlaying: true },
    ];
    expect(collectCanvasDocumentPatches(before, after, {
      p1: placement('a', 10), p2: placement('b', 20),
    })).toEqual([{
      placementId: 'p1', x: 100, y: 20, width: 80, height: 60,
      rotation: 0, zIndex: 1,
    }]);
  });

  it('refuses a media addition or version replacement that needs the project-scoped command', () => {
    const before = [image('a', 'p1', 10)];
    const placements = { p1: placement('a', 10) };
    expect(() => collectCanvasDocumentPatches(before, [
      ...before, image('b', 'p2', 20),
    ], placements)).toThrow('协作媒体命令');
    expect(() => collectCanvasDocumentPatches(before, [
      { ...before[0], assetVersionId: 'version-other' },
    ], placements)).toThrow('协作媒体命令');
  });

  it('projects remote geometry onto the existing media and flags unresolved versions', () => {
    const original = image('a', 'p1', 10);
    const projected = projectDocumentPlacementsOntoImages([original], {
      p1: { ...placement('a', 300), y: 40, groupId: 'group-1' },
    });
    expect(projected).toEqual({
      images: [{ ...original, x: 300, y: 40, groupId: 'group-1' }],
      unresolvedPlacementIds: [],
    });
    expect(projectDocumentPlacementsOntoImages([original], {
      p1: placement('a', 10), p2: placement('b', 20),
    }).unresolvedPlacementIds).toEqual(['p2']);
  });

  it('hides a deleted placement without treating its tombstone as missing media', () => {
    const original = image('a', 'p1', 10);
    expect(projectDocumentPlacementsOntoImages([original], {
      p1: { ...placement('a', 10), deleted: true },
      p2: { ...placement('b', 20), deleted: true },
    })).toEqual({ images: [], unresolvedPlacementIds: [] });
  });

  it('routes a managed drag to Yjs and never to the legacy scheduler', () => {
    const before = [image('a', 'p1', 10)];
    const state = {
      projectId: 'project-a', authority: 'document' as const,
      status: 'saved', images: { p1: placement('a', 10) },
    };
    expect(routeCanvasWorkspaceChange('project-a', state, before, [
      { ...before[0], x: 90 },
    ])).toEqual({
      kind: 'document', patches: [{
        placementId: 'p1', x: 90, y: 20, width: 80, height: 60,
        rotation: 0, zIndex: 1,
      }],
    });
    expect(canUseLegacyCanvasPersistence('project-a', state)).toBe(false);
  });

  it('keeps the old scheduler for a matching legacy project but blocks unresolved authority', () => {
    const before = [image('a', 'p1', 10)];
    const legacy = {
      projectId: 'project-a', authority: 'legacy' as const,
      status: 'disabled', images: {},
    };
    expect(routeCanvasWorkspaceChange('project-a', legacy, before, [
      { ...before[0], x: 90 },
    ])).toEqual({ kind: 'legacy' });
    expect(canUseLegacyCanvasPersistence('project-a', legacy)).toBe(true);
    expect(canUseLegacyCanvasPersistence('project-b', legacy)).toBe(false);
    expect(routeCanvasWorkspaceChange('project-b', legacy, before, before).kind).toBe('blocked');
    expect(routeCanvasWorkspaceChange('project-a', {
      projectId: 'project-a', authority: 'unknown', status: 'checking', images: {},
    }, before, before).kind).toBe('blocked');
  });

  it('does not accept local mutations when document is read-only or needs a media command', () => {
    const before = [image('a', 'p1', 10)];
    const document = {
      projectId: 'project-a', authority: 'document' as const,
      status: 'read-only', images: { p1: placement('a', 10) },
    };
    expect(routeCanvasWorkspaceChange('project-a', document, before, [
      { ...before[0], x: 90 },
    ]).kind).toBe('blocked');
    expect(routeCanvasWorkspaceChange('project-a', {
      ...document, status: 'pending',
    }, before, [...before, image('b', 'p2', 20)]).kind).toBe('blocked');
  });

  it('blocks a media URL-only change instead of showing an unsaved local result', () => {
    const before = [image('a', 'p1', 10)];
    const state = {
      projectId: 'project-a', authority: 'document' as const,
      status: 'saved', images: { p1: placement('a', 10) },
    };
    expect(routeCanvasWorkspaceChange('project-a', state, before, [
      { ...before[0], url: '/api/serve-upload/replacement.png' },
    ])).toMatchObject({ kind: 'blocked' });
  });

  it('blocks an entire move when its media URL also changes', () => {
    const before = [image('a', 'p1', 10)];
    const state = {
      projectId: 'project-a', authority: 'document' as const,
      status: 'saved', images: { p1: placement('a', 10) },
    };
    expect(routeCanvasWorkspaceChange('project-a', state, before, [
      { ...before[0], x: 90, url: '/api/serve-upload/replacement.png' },
    ])).toMatchObject({ kind: 'blocked' });
  });

  it('does not let late legacy hydration replace an already resolved document', () => {
    const before = [image('a', 'p1', 10)];
    const document = {
      projectId: 'project-a', authority: 'document' as const,
      status: 'saved', images: { p1: placement('a', 10) },
    };
    expect(routeCanvasWorkspaceChange('project-a', document, before, [
      { ...before[0], x: 1 },
    ], 'hydration').kind).toBe('blocked');
    expect(routeCanvasWorkspaceChange('project-b', document, before, before, 'hydration').kind)
      .toBe('legacy');
  });

  it('maps complete group and annotation records between image IDs and placement IDs', () => {
    const media = [image('a', 'p1', 10)];
    const groups = [{
      id: 'group-a', name: 'Reference', note: 'keep together', imageIds: ['a'],
      x: 12, y: 22, collapsed: false,
    }];
    const annotations: CanvasAnnotationV2[] = [{
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'a',
      sourceVersionId: 'version-a', type: 'region',
      geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready', createdAt: 1, updatedAt: 2,
    }];
    const projection: CanvasDocumentProjection = {
      placements: { p1: placement('a', 10) },
      groupDefinitions: toCanvasDocumentGroupRecords(groups, media),
      annotationRecords: toCanvasDocumentAnnotationRecords(annotations, media),
    };
    expect(projection.groupDefinitions?.['group-a'].imageIds).toEqual(['p1']);
    expect(projection.annotationRecords?.['annotation-a'].sourceImageId).toBe('p1');
    expect(projectCanvasDocumentMetadata(projection, media)).toEqual({ groups, annotations });
  });

  it('never shows tombstoned records or silently drops an unknown image reference', () => {
    const media = [image('a', 'p1', 10)];
    expect(() => toCanvasDocumentGroupRecords([{
      id: 'group-a', name: 'Broken', note: '', imageIds: ['unknown'],
    }], media)).toThrow('协作素材');
    expect(() => toCanvasDocumentAnnotationRecords([{
      id: 'annotation-a', projectId: 'project-a', sourceImageId: 'unknown',
      sourceVersionId: 'version-a', type: 'region',
      geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
      status: 'ready', createdAt: 1, updatedAt: 1,
    }], media)).toThrow('协作素材');
    expect(projectCanvasDocumentMetadata({
      placements: { p1: placement('a', 10) },
      groupDefinitions: {
        'group-a': { id: 'group-a', name: 'Deleted', note: '', imageIds: ['p1'] },
      },
      groupTombstones: { 'group-a': true },
    }, media).groups).toEqual([]);
  });
});
