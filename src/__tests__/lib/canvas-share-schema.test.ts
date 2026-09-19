import { describe, expect, it } from 'vitest';

import {
  canvasSharePolicyPatchSchema,
  canvasSharePublicDocumentSchema,
  canvasSharePublicItemSchema,
  canvasShareStatusSchema,
} from '@/lib/canvas-share/schema';

const validPublicItem = {
  itemRef: 'item-1',
  entityType: 'canvas-image',
  assetKind: 'image',
  transform: {
    x: 12,
    y: 24,
    width: 640,
    height: 480,
    rotation: 0,
    zIndex: 2,
  },
  display: {
    label: '主视觉',
    altText: '一张安全预览图片',
  },
  mimeType: 'image/png',
  width: 640,
  height: 480,
  mediaPath: '/api/public/canvas-shares/share-token/media/item-1',
} as const;

const validPublicDocument = {
  title: '只读画布',
  revisionLabel: '修订 7',
  createdAt: '2026-09-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
  items: [validPublicItem],
} as const;

describe('canvas share runtime schemas', () => {
  it('accepts only active, revoked, and expired statuses', () => {
    for (const status of ['active', 'revoked', 'expired']) {
      expect(canvasShareStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of ['pending', 'disabled', 'deleted', '', null]) {
      expect(canvasShareStatusSchema.safeParse(status).success).toBe(false);
    }
  });

  it('allows policy patches to change only expiry and download permission', () => {
    expect(canvasSharePolicyPatchSchema.safeParse({
      expiresAt: '2026-10-19T00:00:00.000Z',
      allowDownload: true,
    }).success).toBe(true);
    expect(canvasSharePolicyPatchSchema.safeParse({ expiresAt: null }).success).toBe(true);

    for (const forbiddenPatch of [
      {},
      { status: 'active' },
      { viewport: { offsetX: 0, offsetY: 0, zoom: 1 } },
      { projectRevision: 8 },
      { snapshotDigest: 'b'.repeat(64) },
      { items: [] },
      { allowDownload: true, projectId: 'project-1' },
    ]) {
      expect(canvasSharePolicyPatchSchema.safeParse(forbiddenPatch).success).toBe(false);
    }
  });

  it('accepts only controlled relative media and download paths', () => {
    expect(canvasSharePublicItemSchema.safeParse(validPublicItem).success).toBe(true);
    expect(canvasSharePublicItemSchema.safeParse({
      ...validPublicItem,
      downloadPath: '/api/public/canvas-shares/share-token/media/item-1/download',
    }).success).toBe(true);

    for (const path of [
      'https://provider.example/private.png',
      '//provider.example/private.png',
      'data:image/png;base64,private',
      'blob:https://example.test/private',
      '/api/public/../private.png',
    ]) {
      expect(canvasSharePublicItemSchema.safeParse({
        ...validPublicItem,
        mediaPath: path,
      }).success).toBe(false);
    }
  });

  it('rejects mutable project JSON and private identity/provider fields from public documents', () => {
    expect(canvasSharePublicDocumentSchema.safeParse(validPublicDocument).success).toBe(true);

    const forbiddenDocumentFields = [
      'ownerId',
      'userId',
      'projectId',
      'projectJson',
      'projectData',
      'canvasImages',
      'taskId',
      'providerId',
      'modelId',
      'prompt',
      'apiKey',
      'billing',
      'storageKey',
      'url',
      'rawUrl',
    ] as const;
    for (const field of forbiddenDocumentFields) {
      expect(canvasSharePublicDocumentSchema.safeParse({
        ...validPublicDocument,
        [field]: 'private-value',
      }).success, field).toBe(false);
    }

    const forbiddenItemFields = [
      'ownerId',
      'userId',
      'projectId',
      'placementId',
      'assetId',
      'assetVersionId',
      'versionId',
      'taskId',
      'providerId',
      'modelId',
      'prompt',
      'apiKey',
      'billing',
      'storageKey',
      'url',
      'rawUrl',
    ] as const;
    for (const field of forbiddenItemFields) {
      expect(canvasSharePublicItemSchema.safeParse({
        ...validPublicItem,
        [field]: 'private-value',
      }).success, field).toBe(false);
    }
  });
});
