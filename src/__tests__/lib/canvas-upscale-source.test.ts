import { describe, expect, it } from 'vitest';
import { resolveCanvasUpscaleSource } from '@/lib/canvas-upscale-source';

describe('canvas upscale source context', () => {
  it('binds a versioned document image to its project and exact parent version', () => {
    expect(resolveCanvasUpscaleSource({ projectId: 'project-a', documentMetadataMode: true,
      assetVersionId: 'version-a' })).toEqual({ kind: 'ready', fields: {
      projectId: 'project-a', assetParentVersionIds: ['version-a'],
    } });
  });

  it('requires import before a document image without a version can be upscaled', () => {
    expect(resolveCanvasUpscaleSource({ projectId: 'project-a', documentMetadataMode: true })).toEqual({ kind: 'import-required' });
    expect(resolveCanvasUpscaleSource({ projectId: 'project-a', documentMetadataMode: true,
      assetVersionId: '  ' })).toEqual({ kind: 'import-required' });
    expect(resolveCanvasUpscaleSource({ projectId: 'project-a', documentMetadataMode: true,
      assetVersionId: ' version-a ' })).toEqual({ kind: 'invalid-source' });
  });

  it('does not invent a project identity when document context is missing', () => {
    expect(resolveCanvasUpscaleSource({ documentMetadataMode: true,
      assetVersionId: 'version-a' })).toEqual({ kind: 'project-required' });
    expect(resolveCanvasUpscaleSource({ projectId: ' project-a ', documentMetadataMode: true,
      assetVersionId: 'version-a' })).toEqual({ kind: 'project-required' });
  });

  it('preserves personal and unscoped legacy image paths without inventing a version', () => {
    expect(resolveCanvasUpscaleSource({ projectId: 'personal-a', documentMetadataMode: false })).toEqual({
      kind: 'ready', fields: { projectId: 'personal-a' },
    });
    expect(resolveCanvasUpscaleSource({ projectId: ' personal-a ', documentMetadataMode: false })).toEqual({
      kind: 'ready', fields: { projectId: 'personal-a' },
    });
    expect(resolveCanvasUpscaleSource({ projectId: '  ', documentMetadataMode: false })).toEqual({
      kind: 'ready', fields: {},
    });
    expect(resolveCanvasUpscaleSource({ documentMetadataMode: false })).toEqual({ kind: 'ready', fields: {} });
  });
});
