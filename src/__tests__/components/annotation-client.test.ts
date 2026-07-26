import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditIntentBundle } from '@/features/annotations/annotation-types';

import {
  executeAnnotationBundle,
  resolveSemanticAnnotation,
} from '@/features/annotations/annotation-client';

const bundle: EditIntentBundle = {
  id: 'bundle-1',
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'version-1',
  annotationIds: ['ann-1'],
  annotations: [{
    id: 'ann-1',
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    type: 'region',
    geometry: {
      kind: 'region',
      region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    },
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }],
  prompt: 'change it',
  modelId: 'gpt-image-1',
  providerId: 'provider-1',
  idempotencyKey: 'idem-1',
  createdAt: 1,
};

describe('annotation browser client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a normalized semantic target and confirmation flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      target: {
        label: 'cup',
        confidence: 0.71,
        region: { x: 0.2, y: 0.2, w: 0.3, h: 0.4 },
      },
      requiresConfirmation: true,
      requestId: 'req-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(resolveSemanticAnnotation({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.3, y: 0.4 },
    })).resolves.toMatchObject({
      target: { label: 'cup', confidence: 0.71 },
      requiresConfirmation: true,
    });
  });

  it('surfaces structured API failures instead of creating an empty annotation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      code: 'ANNOTATION_TARGET_NOT_FOUND',
      message: '改用框选',
      retryable: true,
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(resolveSemanticAnnotation({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.3, y: 0.4 },
    })).rejects.toMatchObject({
      code: 'ANNOTATION_TARGET_NOT_FOUND',
      retryable: true,
    });
  });

  it('returns the asynchronous edit task identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      taskId: 'edit-1',
      mode: 'polling',
      requestId: 'req-2',
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(executeAnnotationBundle({
      bundle,
    })).resolves.toEqual({
      taskId: 'edit-1',
      mode: 'polling',
      requestId: 'req-2',
    });
  });
});
