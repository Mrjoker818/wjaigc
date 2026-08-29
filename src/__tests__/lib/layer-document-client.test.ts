import { describe, expect, it, vi } from 'vitest';

import type { DesignLayer } from '@/lib/psd-export';
import {
  createLayerDocument,
  LayerDocumentClientError,
  layerDocumentContentFromDesignLayers,
  layerDocumentScene,
  loadLayerDocument,
  saveLayerDocument,
} from '@/lib/layer-documents/client';

const source = {
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'version-1',
  imageUrl: '/api/serve-upload/source.png',
  taskId: 'task-1',
};

const content = {
  schemaVersion: 1 as const,
  title: '分层文档',
  width: 800,
  height: 600,
  exportMode: 'pro' as const,
  layers: [{
    id: 'layer-1', name: '主体', role: 'subject',
    imageUrl: '/api/serve-upload/layers/subject.png',
    width: 400, height: 300, offsetX: 20, offsetY: 30,
    opacity: 0.8, blendMode: 'normal', visible: true, locked: true,
    order: 0, source: 'pear-psd' as const,
  }],
};

const document = {
  id: 'doc-1', userId: 'user-1', projectId: source.projectId,
  sourceImageId: source.sourceImageId, sourceVersionId: source.sourceVersionId,
  taskId: 'task-1', engine: 'pear' as const, schemaVersion: 1 as const,
  revision: 2, content, createdAt: 100, updatedAt: 200,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('layer document browser client', () => {
  it('loads by exact source identity without sending the image URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      document,
    }));
    await expect(loadLayerDocument(source, { fetcher })).resolves.toEqual(document);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/layer-documents?projectId=project-1&sourceImageId=image-1&sourceVersionId=version-1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('treats a stable not-found response as an empty document', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      code: 'LAYER_DOCUMENT_NOT_FOUND',
      message: 'not found',
      retryable: false,
    }, 404));
    await expect(loadLayerDocument(source, { fetcher })).resolves.toBeNull();
  });

  it('creates with the completed task and saves with revision plus keepalive', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, document }, 201))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        document: { ...document, revision: 3 },
      }));

    await createLayerDocument(source, 'task-1', content, { fetcher });
    await saveLayerDocument(document, content, { fetcher });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      source: {
        projectId: source.projectId,
        sourceImageId: source.sourceImageId,
        sourceVersionId: source.sourceVersionId,
        imageUrl: source.imageUrl,
      },
      taskId: 'task-1',
      content,
    });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      keepalive: true,
    });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      keepalive: true,
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      documentId: 'doc-1',
      expectedRevision: 2,
      content,
    });
  });

  it('preserves the stable conflict code and retryability', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      code: 'LAYER_DOCUMENT_REVISION_CONFLICT',
      message: 'conflict',
      retryable: false,
    }, 409));
    await expect(saveLayerDocument(document, content, { fetcher })).rejects.toEqual(
      expect.objectContaining<Partial<LayerDocumentClientError>>({
        code: 'LAYER_DOCUMENT_REVISION_CONFLICT',
        status: 409,
        retryable: false,
      }),
    );
  });

  it('round-trips editable layer state without copying image bytes', () => {
    const layers = [{
      id: 'layer-1',
      role: 'subject',
      name: '主体',
      visible: true,
      locked: true,
      opacity: 0.8,
      blendMode: 'normal',
      offsetX: 20,
      offsetY: 30,
      sourceWidth: 400,
      sourceHeight: 300,
      imageDataUrl: '/api/serve-upload/layers/subject.png',
      boundingBox: { x: 20, y: 30, width: 400, height: 300 },
      maskScore: 0.9,
      edgeScore: 0.9,
      warnings: [],
      reconstructMode: 'raster-safe',
      source: 'pear-psd',
    }] as DesignLayer[];
    const serialized = layerDocumentContentFromDesignLayers(
      layers,
      800,
      600,
      '分层文档',
      'pro',
    );
    expect(serialized).toEqual(content);

    const scene = layerDocumentScene(content);
    expect(scene.width).toBe(800);
    expect(scene.layers[0]).toMatchObject({
      id: 'layer-1',
      locked: true,
      offsetX: 20,
      offsetY: 30,
      imageDataUrl: '/api/serve-upload/layers/subject.png',
    });
    expect(JSON.stringify(serialized)).not.toContain('data:image');
  });
});
