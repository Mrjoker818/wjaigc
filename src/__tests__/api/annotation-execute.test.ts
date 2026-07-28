import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import type { CanvasAnnotationV2, EditIntentBundle } from '@/features/annotations/annotation-types';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  dbGetUserData: vi.fn(),
  dbGetUserById: vi.fn(),
  findProviderById: vi.fn(),
  submitAnnotationEdit: vi.fn(),
  dataRoot: `${process.cwd()}/.test-data/annotation-execute`,
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbGetUserById: mocks.dbGetUserById,
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
}));
vi.mock('@/features/annotations/annotation-executor', () => ({
  submitAnnotationEdit: mocks.submitAnnotationEdit,
}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: () => mocks.dataRoot,
}));

import { POST } from '@/app/api/annotations/execute/route';
import { compileAnnotationAssets } from '@/lib/annotation-mask';
import { buildAnnotationProviderRequest } from '@/lib/annotation-provider-adapter';

function annotation(
  id: string,
  geometry: CanvasAnnotationV2['geometry'] = {
    kind: 'region',
    region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
  },
): CanvasAnnotationV2 {
  return {
    id,
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    type: geometry.kind,
    geometry,
    instruction: `instruction for ${id}`,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  };
}

function bundle(annotations: CanvasAnnotationV2[]): EditIntentBundle {
  return {
    id: 'bundle-1',
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    annotationIds: annotations.map((item) => item.id),
    annotations,
    prompt: 'Apply all requested changes',
    modelId: 'gpt-image-1',
    providerId: 'provider-1',
    idempotencyKey: 'idem-1',
    createdAt: 1,
  };
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/annotations/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'req-test-1',
    },
    body: JSON.stringify(body),
  });
}

const SOURCE_FIXTURE = readFileSync(path.resolve(
  process.cwd(),
  'tests/fixtures/annotation-source.png',
));
const SOURCE_DATA_URL = `data:image/png;base64,${SOURCE_FIXTURE.toString('base64')}`;

function sourceDataUrl(): string {
  return SOURCE_DATA_URL;
}

const MANAGED_FIXTURE_DIR = path.join(
  mocks.dataRoot,
  'generate',
);

afterEach(async () => {
  await rm(MANAGED_FIXTURE_DIR, { recursive: true, force: true });
});

describe('annotation asset and provider compilation', () => {
  it('preserves every annotation ID in the numbered instruction list', async () => {
    const annotations = [
      annotation('ann-region'),
      annotation('ann-brush', {
        kind: 'brush',
        points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }],
        width: 0.05,
      }),
      annotation('ann-arrow', {
        kind: 'arrow',
        start: { x: 0.1, y: 0.8 },
        end: { x: 0.8, y: 0.2 },
      }),
      annotation('ann-text', {
        kind: 'text',
        point: { x: 0.7, y: 0.7 },
      }),
    ];
    const assets = await compileAnnotationAssets({
      imageUrl: await sourceDataUrl(),
      annotations,
    });
    const providerRequest = buildAnnotationProviderRequest({
      bundle: bundle(annotations),
      imageUrl: await sourceDataUrl(),
      assets,
      requestId: 'req-1',
    });

    for (const item of annotations) {
      expect(providerRequest.prompt).toContain(item.id);
    }
    expect(providerRequest.mask).toMatch(/^data:image\/png;base64,/);
    expect(providerRequest.referenceImages).toHaveLength(1);
  });

  it('throws when a required annotation asset cannot be created', async () => {
    await expect(compileAnnotationAssets({
      imageUrl: 'data:image/png;base64,not-a-valid-png',
      annotations: [annotation('ann-1')],
    })).rejects.toMatchObject({ code: 'ANNOTATION_ASSET_INVALID' });
  });

  it('blocks spatial annotations for a model without mask capability', async () => {
    const annotations = [annotation('ann-1')];
    const assets = await compileAnnotationAssets({
      imageUrl: await sourceDataUrl(),
      annotations,
    });

    expect(() => buildAnnotationProviderRequest({
      bundle: { ...bundle(annotations), modelId: 'dall-e-3' },
      imageUrl: 'data:image/png;base64,source',
      assets,
      requestId: 'req-1',
    })).toThrowError(expect.objectContaining({
      code: 'ANNOTATION_MODEL_UNSUPPORTED',
    }));
  });
});

describe('POST /api/annotations/execute', () => {
  beforeEach(async () => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock !== 'string') mock.mockReset();
    });
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
    });
    mocks.dbGetUserData.mockResolvedValue([
      {
        id: 'project-1',
        userId: 'user-1',
        canvasImages: [{
          id: 'image-1',
          url: await sourceDataUrl(),
          annotationVersionId: 'version-1',
        }],
      },
    ]);
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      image_models: ['provider-1::gpt-image-1'],
    });
    mocks.findProviderById.mockResolvedValue({
      id: 'provider-1',
      name: 'Provider One',
      isEnabled: true,
      modelType: 'image',
      apiKey: 'server-secret',
      selectedModels: ['gpt-image-1'],
    });
    mocks.submitAnnotationEdit.mockResolvedValue({
      taskId: 'edit-task-1',
      mode: 'polling',
    });
  });

  it('rejects unauthenticated callers before reading the project or image', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await POST(request({ bundle: bundle([annotation('ann-1')]) }));

    expect(response.status).toBe(401);
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it.each([
    { count: 0, status: 400 },
    { count: 11, status: 400 },
  ])('rejects $count annotations', async ({ count, status }) => {
    const annotations = Array.from({ length: count }, (_, index) => annotation(`ann-${index}`));
    const response = await POST(request({
      bundle: bundle(annotations),
      imageUrl: await sourceDataUrl(),
    }));

    expect(response.status).toBe(status);
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('returns 409 for mixed source versions', async () => {
    const annotations = [
      annotation('ann-1'),
      { ...annotation('ann-2'), sourceVersionId: 'version-2' },
    ];
    const response = await POST(request({
      bundle: bundle(annotations),
      imageUrl: await sourceDataUrl(),
    }));

    expect(response.status).toBe(409);
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('returns 422 for missing brush geometry', async () => {
    const invalid = annotation('ann-brush', {
      kind: 'brush',
      points: [],
      width: 0.05,
    });
    const response = await POST(request({
      bundle: bundle([invalid]),
      imageUrl: await sourceDataUrl(),
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.code).toBe('ANNOTATION_GEOMETRY_INVALID');
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('does not disclose or execute a project the caller does not own', async () => {
    mocks.dbGetUserData.mockResolvedValue([]);
    const response = await POST(request({
      bundle: bundle([annotation('ann-1')]),
      imageUrl: await sourceDataUrl(),
    }));

    expect(response.status).toBe(404);
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('does not execute an image that is absent from the owned project', async () => {
    const foreign = {
      ...annotation('ann-1'),
      sourceImageId: 'foreign-image',
    };
    const response = await POST(request({
      bundle: {
        ...bundle([foreign]),
        sourceImageId: 'foreign-image',
      },
      imageUrl: await sourceDataUrl(),
    }));

    expect(response.status).toBe(404);
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('rejects stale source versions before compiling assets', async () => {
    const stale = {
      ...annotation('ann-1'),
      sourceVersionId: 'stale-version',
    };
    const response = await POST(request({
      bundle: {
        ...bundle([stale]),
        sourceVersionId: 'stale-version',
      },
      imageUrl: await sourceDataUrl(),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('ANNOTATION_SOURCE_STALE');
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('rejects a model that is not configured on the selected provider', async () => {
    mocks.findProviderById.mockResolvedValue({
      id: 'provider-1',
      name: 'Provider One',
      isEnabled: true,
      modelType: 'image',
      apiKey: 'server-secret',
      selectedModels: ['other-model'],
    });
    const response = await POST(request({
      bundle: bundle([annotation('ann-1')]),
      imageUrl: await sourceDataUrl(),
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.code).toBe('ANNOTATION_MODEL_UNSUPPORTED');
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('rejects a configured provider model not assigned to the current user', async () => {
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      image_models: ['provider-1::other-model'],
    });

    const response = await POST(request({
      bundle: bundle([annotation('ann-1')]),
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe('ANNOTATION_MODEL_FORBIDDEN');
    expect(mocks.submitAnnotationEdit).not.toHaveBeenCalled();
  });

  it('submits one authenticated edit task and forwards request and idempotency IDs', async () => {
    const annotations = [annotation('ann-1'), annotation('ann-2')];
    const response = await POST(request({
      bundle: bundle(annotations),
      imageUrl: await sourceDataUrl(),
    }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      success: true,
      taskId: 'edit-task-1',
      requestId: 'req-test-1',
    });
    expect(mocks.submitAnnotationEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        signal: expect.any(AbortSignal),
        request: expect.objectContaining({
          idempotencyKey: 'idem-1',
          requestId: 'req-test-1',
          annotationIds: ['ann-1', 'ann-2'],
        }),
      }),
    );
  });

  it('executes an absolute same-origin managed source through the local media path', async () => {
    await mkdir(MANAGED_FIXTURE_DIR, { recursive: true });
    const source = Buffer.from(
      (await sourceDataUrl()).split(',')[1],
      'base64',
    );
    await writeFile(path.join(MANAGED_FIXTURE_DIR, 'source.png'), source);
    mocks.dbGetUserData.mockResolvedValue([{
      id: 'project-1',
      userId: 'user-1',
      canvasImages: [{
        id: 'image-1',
        url: 'http://localhost/api/serve-upload/generate/source.png',
        annotationVersionId: 'version-1',
      }],
    }]);

    const response = await POST(request({
      bundle: bundle([annotation('ann-1')]),
    }));

    expect(response.status).toBe(202);
    expect(mocks.submitAnnotationEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          image: '/api/serve-upload/generate/source.png',
        }),
      }),
    );
  });
});
