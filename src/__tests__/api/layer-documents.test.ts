import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  findOwnedAnnotationSource: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  createLayerDocument: vi.fn(),
  findLatestLayerDocument: vi.fn(),
  updateLayerDocument: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/annotation-project-source', () => ({
  findOwnedAnnotationSource: mocks.findOwnedAnnotationSource,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
}));
vi.mock('@/lib/layer-documents/storage', () => ({
  createLayerDocument: mocks.createLayerDocument,
  findLatestLayerDocument: mocks.findLatestLayerDocument,
  updateLayerDocument: mocks.updateLayerDocument,
}));

const source = {
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'image-1:1:source',
  imageUrl: '/api/serve-upload/source.png',
};

const content = {
  schemaVersion: 1 as const,
  title: '分层文档',
  width: 1280,
  height: 1280,
  exportMode: 'pro' as const,
  layers: [{
    id: 'layer-1',
    name: '背景',
    role: 'background',
    imageUrl: '/api/serve-upload/layers/background.png',
    width: 1280,
    height: 1280,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    order: 0,
    source: 'pear-psd' as const,
  }],
};

const document = {
  id: 'doc-1',
  userId: 'user-1',
  ...source,
  taskId: 'task-1',
  engine: 'pear' as const,
  schemaVersion: 1 as const,
  revision: 0,
  content,
  createdAt: 100,
  updatedAt: 100,
};

function completedLayerTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId: 'user-1',
    type: 'layer-decomposition',
    status: 'completed',
    progress: 100,
    creditStatus: 'charged',
    createdAt: 100,
    updatedAt: 200,
    result: {
      request: { imageUrl: source.imageUrl, engine: 'cloud' },
      decomposition: {
        width: 1280,
        height: 1280,
        engine: 'pear',
        layers: [{ id: 'layer-1', imageUrl: content.layers[0].imageUrl }],
      },
    },
    ...overrides,
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/layer-documents', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('/api/layer-documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'admin',
    });
    mocks.findOwnedAnnotationSource.mockResolvedValue({
      projectId: source.projectId,
      imageId: source.sourceImageId,
      imageUrl: source.imageUrl,
      versionId: source.sourceVersionId,
    });
    mocks.getCloudTaskForUser.mockResolvedValue(completedLayerTask());
    mocks.createLayerDocument.mockResolvedValue(document);
    mocks.findLatestLayerDocument.mockResolvedValue(document);
    mocks.updateLayerDocument.mockResolvedValue({ ...document, revision: 1 });
  });

  it('returns the unified error shape for unauthenticated users', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );
    const { GET } = await import('@/app/api/layer-documents/route');
    const response = await GET(new NextRequest(
      `http://localhost/api/layer-documents?projectId=${source.projectId}`
      + `&sourceImageId=${source.sourceImageId}&sourceVersionId=${source.sourceVersionId}`,
    ));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'AUTH_REQUIRED',
      requestId: expect.any(String),
      retryable: false,
    });
  });

  it('gets only the authenticated user latest exact source version', async () => {
    const { GET } = await import('@/app/api/layer-documents/route');
    const response = await GET(new NextRequest(
      `http://localhost/api/layer-documents?projectId=${source.projectId}`
      + `&sourceImageId=${source.sourceImageId}&sourceVersionId=${source.sourceVersionId}`,
    ));
    expect(response.status).toBe(200);
    expect(mocks.findLatestLayerDocument).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: source.projectId,
      sourceImageId: source.sourceImageId,
      sourceVersionId: source.sourceVersionId,
    });
  });

  it('rejects stale source versions before reading a document', async () => {
    mocks.findOwnedAnnotationSource.mockResolvedValue({
      projectId: source.projectId,
      imageId: source.sourceImageId,
      imageUrl: source.imageUrl,
      versionId: 'new-version',
    });
    const { GET } = await import('@/app/api/layer-documents/route');
    const response = await GET(new NextRequest(
      `http://localhost/api/layer-documents?projectId=${source.projectId}`
      + `&sourceImageId=${source.sourceImageId}&sourceVersionId=${source.sourceVersionId}`,
    ));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_SOURCE_STALE',
    });
    expect(mocks.findLatestLayerDocument).not.toHaveBeenCalled();
  });

  it('returns a stable 404 when the source has no saved document', async () => {
    mocks.findLatestLayerDocument.mockResolvedValue(null);
    const { GET } = await import('@/app/api/layer-documents/route');
    const response = await GET(new NextRequest(
      `http://localhost/api/layer-documents?projectId=${source.projectId}`
      + `&sourceImageId=${source.sourceImageId}&sourceVersionId=${source.sourceVersionId}`,
    ));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_NOT_FOUND',
      retryable: false,
    });
  });

  it('creates a document only from an owned completed layer task', async () => {
    const { POST } = await import('@/app/api/layer-documents/route');
    const response = await POST(postRequest({ source, taskId: 'task-1', content }));
    expect(response.status).toBe(201);
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('task-1', 'user-1');
    expect(mocks.createLayerDocument).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: source.projectId,
      taskId: 'task-1',
      engine: 'pear',
    }));
  });

  it('rejects a task that belongs to another user', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/layer-documents/route');
    const response = await POST(postRequest({ source, taskId: 'task-1', content }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_TASK_NOT_FOUND',
    });
    expect(mocks.createLayerDocument).not.toHaveBeenCalled();
  });

  it('rejects non-completed and forged task types', async () => {
    const { POST } = await import('@/app/api/layer-documents/route');
    mocks.getCloudTaskForUser.mockResolvedValue(completedLayerTask({ status: 'processing' }));
    const active = await POST(postRequest({ source, taskId: 'task-1', content }));
    expect(active.status).toBe(409);
    await expect(active.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_TASK_NOT_COMPLETED',
    });

    mocks.getCloudTaskForUser.mockResolvedValue(completedLayerTask({ type: 'generate' }));
    const forged = await POST(postRequest({ source, taskId: 'task-1', content }));
    expect(forged.status).toBe(422);
    await expect(forged.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_TASK_INVALID',
    });
  });

  it('rejects a source URL mismatch and forged layer assets', async () => {
    const { POST } = await import('@/app/api/layer-documents/route');
    const mismatchedSource = await POST(postRequest({
      source: { ...source, imageUrl: '/api/serve-upload/other.png' },
      taskId: 'task-1',
      content,
    }));
    expect(mismatchedSource.status).toBe(409);
    await expect(mismatchedSource.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_SOURCE_MISMATCH',
    });

    const forgedLayer = await POST(postRequest({
      source,
      taskId: 'task-1',
      content: {
        ...content,
        layers: [{ ...content.layers[0], imageUrl: '/api/serve-upload/layers/forged.png' }],
      },
    }));
    expect(forgedLayer.status).toBe(422);
    await expect(forgedLayer.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_TASK_CONTENT_MISMATCH',
    });
  });

  it('preserves an optimistic revision conflict as 409', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      code: 'LAYER_DOCUMENT_REVISION_CONFLICT',
      status: 409,
      retryable: false,
    });
    mocks.updateLayerDocument.mockRejectedValue(conflict);
    const { PATCH } = await import('@/app/api/layer-documents/route');
    const response = await PATCH(new NextRequest('http://localhost/api/layer-documents', {
      method: 'PATCH',
      body: JSON.stringify({ documentId: 'doc-1', expectedRevision: 0, content }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_REVISION_CONFLICT',
      retryable: false,
    });
  });

  it('rejects malformed and oversized JSON before storage', async () => {
    const { POST } = await import('@/app/api/layer-documents/route');
    const malformed = await POST(postRequest('{broken'));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_JSON_INVALID',
    });

    const oversized = await POST(postRequest({
      source,
      taskId: 'task-1',
      content,
      padding: 'x'.repeat(256 * 1024),
    }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_BODY_TOO_LARGE',
    });
    expect(mocks.createLayerDocument).not.toHaveBeenCalled();
  });

  it('reports database failure without pretending the save succeeded', async () => {
    mocks.createLayerDocument.mockRejectedValue(new Error('database offline'));
    const { POST } = await import('@/app/api/layer-documents/route');
    const response = await POST(postRequest({ source, taskId: 'task-1', content }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAYER_DOCUMENT_PERSISTENCE_UNAVAILABLE',
      retryable: true,
    });
  });
});
