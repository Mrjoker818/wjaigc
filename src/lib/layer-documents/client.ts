import type {
  DesignLayer,
  PSDExportMode,
  SceneBuildResult,
} from '@/lib/psd-export';
import type {
  LayerDocumentContent,
  LayerDocumentRecord,
  LayerDocumentSource,
} from './types';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ClientOptions {
  fetcher?: FetchLike;
  signal?: AbortSignal;
}

interface SaveOptions extends ClientOptions {
  keepalive?: boolean;
}

export class LayerDocumentClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LayerDocumentClientError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = record(await response.json());
    if (!body) throw new Error('response is not an object');
    return body;
  } catch {
    throw new LayerDocumentClientError(
      'LAYER_DOCUMENT_RESPONSE_INVALID',
      '图层文档服务返回了无效响应',
      response.status,
      response.status >= 500,
    );
  }
}

function documentFromBody(
  response: Response,
  body: Record<string, unknown>,
): LayerDocumentRecord {
  if (!response.ok || body.success === false) {
    throw new LayerDocumentClientError(
      typeof body.code === 'string' ? body.code : 'LAYER_DOCUMENT_REQUEST_FAILED',
      typeof body.message === 'string' ? body.message : '图层文档请求失败',
      response.status,
      body.retryable === true,
    );
  }
  const document = record(body.document);
  if (!document || typeof document.id !== 'string') {
    throw new LayerDocumentClientError(
      'LAYER_DOCUMENT_RESPONSE_INVALID',
      '图层文档响应缺少文档内容',
      response.status,
      false,
    );
  }
  return document as unknown as LayerDocumentRecord;
}

export async function loadLayerDocument(
  source: LayerDocumentSource,
  options: ClientOptions = {},
): Promise<LayerDocumentRecord | null> {
  const query = new URLSearchParams({
    projectId: source.projectId,
    sourceImageId: source.sourceImageId,
    sourceVersionId: source.sourceVersionId,
  });
  const response = await (options.fetcher || fetch)(
    `/api/layer-documents?${query.toString()}`,
    { method: 'GET', cache: 'no-store', signal: options.signal },
  );
  const body = await responseBody(response);
  if (response.status === 404 && body.code === 'LAYER_DOCUMENT_NOT_FOUND') return null;
  return documentFromBody(response, body);
}

export async function createLayerDocument(
  source: LayerDocumentSource,
  taskId: string,
  content: LayerDocumentContent,
  options: SaveOptions = {},
): Promise<LayerDocumentRecord> {
  const response = await (options.fetcher || fetch)('/api/layer-documents', {
    method: 'POST',
    signal: options.signal,
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: {
        projectId: source.projectId,
        sourceImageId: source.sourceImageId,
        sourceVersionId: source.sourceVersionId,
        imageUrl: source.imageUrl,
      },
      taskId,
      content,
    }),
  });
  return documentFromBody(response, await responseBody(response));
}

export async function saveLayerDocument(
  document: LayerDocumentRecord,
  content: LayerDocumentContent,
  options: SaveOptions = {},
): Promise<LayerDocumentRecord> {
  const response = await (options.fetcher || fetch)('/api/layer-documents', {
    method: 'PATCH',
    signal: options.signal,
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documentId: document.id,
      expectedRevision: document.revision,
      content,
    }),
  });
  return documentFromBody(response, await responseBody(response));
}

function documentRole(role: DesignLayer['role']): string {
  return role;
}

function designRole(role: string): DesignLayer['role'] {
  if (
    role === 'background'
    || role === 'subject'
    || role === 'text'
    || role === 'deco'
    || role === 'shadow'
    || role === 'original'
  ) {
    return role;
  }
  return 'deco';
}

export function layerDocumentContentFromDesignLayers(
  layers: DesignLayer[],
  width: number,
  height: number,
  title: string,
  exportMode: PSDExportMode,
): LayerDocumentContent {
  return {
    schemaVersion: 1,
    title,
    width,
    height,
    exportMode,
    layers: layers.map((layer, order) => ({
      id: layer.id,
      name: layer.name,
      role: documentRole(layer.role),
      imageUrl: layer.imageDataUrl || '',
      width: layer.sourceWidth || layer.boundingBox?.width || 1,
      height: layer.sourceHeight || layer.boundingBox?.height || 1,
      offsetX: layer.offsetX ?? layer.boundingBox?.x ?? 0,
      offsetY: layer.offsetY ?? layer.boundingBox?.y ?? 0,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      visible: layer.visible,
      locked: layer.locked === true,
      order,
      source: layer.source === 'local-enhanced' ? 'local-enhanced' : 'pear-psd',
    })),
  };
}

export function layerDocumentScene(content: LayerDocumentContent): SceneBuildResult {
  const layers: DesignLayer[] = [...content.layers]
    .sort((left, right) => left.order - right.order)
    .map(layer => ({
      id: layer.id,
      role: designRole(layer.role),
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      sourceWidth: layer.width,
      sourceHeight: layer.height,
      imageDataUrl: layer.imageUrl,
      boundingBox: {
        x: layer.offsetX,
        y: layer.offsetY,
        width: layer.width,
        height: layer.height,
      },
      bbox: [
        layer.offsetX,
        layer.offsetY,
        layer.offsetX + layer.width,
        layer.offsetY + layer.height,
      ],
      maskScore: layer.source === 'pear-psd' ? 0.95 : 0.75,
      edgeScore: layer.source === 'pear-psd' ? 0.9 : 0.7,
      warnings: [],
      reconstructMode: 'raster-safe',
      source: layer.source,
    }));
  const grouped = new Map<string, string[]>();
  for (const layer of layers) {
    const ids = grouped.get(layer.role) || [];
    ids.push(layer.id);
    grouped.set(layer.role, ids);
  }
  return {
    width: content.width,
    height: content.height,
    layers,
    groups: Array.from(grouped.entries()).map(([role, layerIds]) => ({
      id: `group-${role}`,
      name: `group/${role}`,
      role,
      layerIds,
      visible: true,
    })),
    fallbacks: [],
    qualityMetrics: {
      maskBoundary: 1,
      ocr: 1,
      fontMatch: 1,
      inpaint: 1,
      layerConsistency: 1,
      openability: 1,
    },
    exportNotes: [],
  };
}
