import { randomUUID } from 'node:crypto';

import { findOwnedAnnotationSource } from '@/lib/annotation-project-source';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import {
  createLayerDocument,
  findLatestLayerDocument,
  updateLayerDocument,
} from './storage';
import type {
  LayerDocumentContent,
  LayerDocumentRecord,
  LayerDocumentSource,
} from './types';
import { LayerDocumentError, readLayerDocumentContent } from './validation';

type JsonRecord = Record<string, unknown>;

interface TaskLayerIdentity {
  engine: 'pear' | 'local';
  layers: Array<{ id: string; imageUrl: string }>;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function taskLayerIdentity(task: CloudTask, source: LayerDocumentSource): TaskLayerIdentity {
  if (task.type !== 'layer-decomposition' && task.type !== 'element-decompose-parent') {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_INVALID',
      '该任务不是可编辑的图片分层任务',
      422,
    );
  }
  if (task.status !== 'completed') {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_NOT_COMPLETED',
      '图片分层任务尚未完成',
      409,
      true,
    );
  }
  const result = record(task.result);
  if (!result) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_INVALID',
      '图片分层任务结果缺失',
      422,
    );
  }

  let decomposition: JsonRecord | null = null;
  if (task.type === 'layer-decomposition') {
    const request = record(result.request);
    if (!request || request.imageUrl !== source.imageUrl) {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_TASK_SOURCE_MISMATCH',
        '图片分层任务与当前源图不匹配',
        409,
      );
    }
    decomposition = record(result.decomposition);
  } else {
    const request = record(result.request);
    const frozenSource = record(result.source);
    const branches = record(result.branches);
    const layerBranch = record(branches?.layers);
    if (
      request?.projectId !== source.projectId
      || frozenSource?.sourceImageId !== source.sourceImageId
      || frozenSource?.sourceVersionId !== source.sourceVersionId
    ) {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_TASK_SOURCE_MISMATCH',
        '元素拆解任务与当前源图版本不匹配',
        409,
      );
    }
    if (layerBranch?.status !== 'completed') {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_TASK_NOT_COMPLETED',
        '元素拆解的图层分支尚未完成',
        409,
        true,
      );
    }
    decomposition = record(layerBranch.result);
  }

  const engine = decomposition?.engine;
  const rawLayers = decomposition?.layers;
  if ((engine !== 'pear' && engine !== 'local') || !Array.isArray(rawLayers)) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_INVALID',
      '图片分层任务没有可恢复的图层结果',
      422,
    );
  }
  const layers = rawLayers.map((value) => {
    const layer = record(value);
    if (!layer || typeof layer.id !== 'string' || typeof layer.imageUrl !== 'string') {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_TASK_INVALID',
        '图片分层任务包含无效图层',
        422,
      );
    }
    return { id: layer.id, imageUrl: layer.imageUrl };
  });
  return { engine, layers };
}

async function verifyOwnedSource(
  userId: string,
  source: Pick<
    LayerDocumentSource,
    'projectId' | 'sourceImageId' | 'sourceVersionId'
  > & { imageUrl?: string },
): Promise<void> {
  const owned = await findOwnedAnnotationSource(
    userId,
    source.projectId,
    source.sourceImageId,
  );
  if (!owned) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_SOURCE_NOT_FOUND',
      '项目或来源图片不存在',
      404,
    );
  }
  if (owned.versionId !== source.sourceVersionId) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_SOURCE_STALE',
      '来源图片版本已变化，请重新执行分层',
      409,
    );
  }
  if (source.imageUrl !== undefined && owned.imageUrl !== source.imageUrl) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_SOURCE_MISMATCH',
      '来源图片地址与项目记录不一致',
      409,
    );
  }
}

function verifyTaskContent(
  content: LayerDocumentContent,
  task: TaskLayerIdentity,
): void {
  if (content.layers.length !== task.layers.length) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_CONTENT_MISMATCH',
      '图层文档与分层任务结果不一致',
      422,
    );
  }
  const assets = new Map(task.layers.map(layer => [layer.id, layer.imageUrl]));
  for (const layer of content.layers) {
    if (assets.get(layer.id) !== layer.imageUrl) {
      throw new LayerDocumentError(
        'LAYER_DOCUMENT_TASK_CONTENT_MISMATCH',
        '图层文档包含不属于该任务的媒体',
        422,
      );
    }
  }
}

export async function getLayerDocumentForSource(input: {
  userId: string;
  source: Pick<
    LayerDocumentSource,
    'projectId' | 'sourceImageId' | 'sourceVersionId'
  >;
}): Promise<LayerDocumentRecord> {
  await verifyOwnedSource(input.userId, input.source);
  const document = await findLatestLayerDocument({
    userId: input.userId,
    projectId: input.source.projectId,
    sourceImageId: input.source.sourceImageId,
    sourceVersionId: input.source.sourceVersionId,
  });
  if (!document) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_NOT_FOUND',
      '当前源图版本还没有保存图层文档',
      404,
    );
  }
  return document;
}

export async function createLayerDocumentForSource(input: {
  userId: string;
  source: LayerDocumentSource;
  taskId: string;
  content: LayerDocumentContent;
}): Promise<LayerDocumentRecord> {
  await verifyOwnedSource(input.userId, input.source);
  const task = await getCloudTaskForUser(input.taskId, input.userId);
  if (!task) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TASK_NOT_FOUND',
      '图片分层任务不存在或不属于当前用户',
      404,
    );
  }
  const normalizedContent = readLayerDocumentContent(input.content);
  const identity = taskLayerIdentity(task, input.source);
  verifyTaskContent(normalizedContent, identity);
  return createLayerDocument({
    id: `layer_document_${randomUUID()}`,
    userId: input.userId,
    projectId: input.source.projectId,
    sourceImageId: input.source.sourceImageId,
    sourceVersionId: input.source.sourceVersionId,
    taskId: input.taskId,
    engine: identity.engine,
    content: normalizedContent,
  });
}

export async function saveLayerDocument(input: {
  userId: string;
  documentId: string;
  expectedRevision: number;
  content: LayerDocumentContent;
}): Promise<LayerDocumentRecord> {
  return updateLayerDocument({
    documentId: input.documentId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    content: readLayerDocumentContent(input.content),
  });
}
