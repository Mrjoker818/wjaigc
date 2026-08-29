import { resolveManagedMediaPath, SafeImageInputError } from '@/lib/safe-image-input';
import {
  LAYER_DOCUMENT_SCHEMA_VERSION,
  type LayerDocumentContent,
  type LayerDocumentLayer,
} from './types';

// Fetch keepalive payloads are capped at roughly 64 KiB across browsers.
const MAX_BODY_BYTES = 60 * 1024;
const MAX_LAYERS = 64;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 128;
const MAX_BLEND_MODE_LENGTH = 64;
const MAX_DIMENSION = 32_768;
const MAX_COORDINATE = 1_000_000;
const ALLOWED_ROLES = new Set([
  'background',
  'subject',
  'text',
  'deco',
  'decoration',
  'shadow',
  'original',
  'reconstruction-correction',
  'reconstruction-reference',
  'unknown',
]);

export class LayerDocumentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LayerDocumentError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LayerDocumentError('LAYER_DOCUMENT_INVALID', '图层文档格式无效');
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new LayerDocumentError('LAYER_DOCUMENT_STRING_REQUIRED', `${label}不能为空`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new LayerDocumentError('LAYER_DOCUMENT_STRING_TOO_LONG', `${label}超过长度限制`);
  }
  return normalized;
}

function finiteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < min
    || value > max
    || (integer && !Number.isInteger(value))
  ) {
    throw new LayerDocumentError('LAYER_DOCUMENT_NUMBER_INVALID', `${label}超出安全范围`);
  }
  return value;
}

function managedMediaUrl(value: unknown): string {
  const imageUrl = boundedString(value, '图层媒体地址', MAX_ID_LENGTH);
  try {
    const managed = resolveManagedMediaPath(imageUrl);
    if (managed.relativePath.toLowerCase().startsWith('users/')) {
      throw new SafeImageInputError('Private media path is not allowed');
    }
  } catch {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_MEDIA_UNSAFE',
      '图层媒体必须使用受管上传地址',
    );
  }
  return imageUrl;
}

function readLayer(value: unknown): LayerDocumentLayer {
  const input = record(value);
  const role = boundedString(input.role, '图层角色', MAX_NAME_LENGTH);
  if (!ALLOWED_ROLES.has(role)) {
    throw new LayerDocumentError('LAYER_DOCUMENT_ROLE_INVALID', '图层角色不受支持');
  }
  const source = input.source;
  if (source !== 'pear-psd' && source !== 'local-enhanced') {
    throw new LayerDocumentError('LAYER_DOCUMENT_SOURCE_INVALID', '图层来源不受支持');
  }
  if (typeof input.visible !== 'boolean' || typeof input.locked !== 'boolean') {
    throw new LayerDocumentError('LAYER_DOCUMENT_BOOLEAN_INVALID', '图层开关状态无效');
  }
  return {
    id: boundedString(input.id, '图层 ID', MAX_ID_LENGTH),
    name: boundedString(input.name, '图层名称', MAX_NAME_LENGTH),
    role,
    imageUrl: managedMediaUrl(input.imageUrl),
    width: finiteNumber(input.width, '图层宽度', 1, MAX_DIMENSION, true),
    height: finiteNumber(input.height, '图层高度', 1, MAX_DIMENSION, true),
    offsetX: finiteNumber(input.offsetX, '图层横坐标', -MAX_COORDINATE, MAX_COORDINATE),
    offsetY: finiteNumber(input.offsetY, '图层纵坐标', -MAX_COORDINATE, MAX_COORDINATE),
    opacity: finiteNumber(input.opacity, '图层不透明度', 0, 1),
    blendMode: boundedString(input.blendMode, '图层混合模式', MAX_BLEND_MODE_LENGTH),
    visible: input.visible,
    locked: input.locked,
    order: finiteNumber(input.order, '图层顺序', 0, MAX_LAYERS - 1, true),
    source,
  };
}

export function validateLayerDocumentRequestSize(rawBody: string): void {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_BODY_TOO_LARGE',
      '图层文档请求体超过 60 KiB',
      413,
    );
  }
}

export function readLayerDocumentContent(value: unknown): LayerDocumentContent {
  const input = record(value);
  if (input.schemaVersion !== LAYER_DOCUMENT_SCHEMA_VERSION) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_SCHEMA_UNSUPPORTED',
      '图层文档版本不受支持',
    );
  }
  if (!Array.isArray(input.layers)) {
    throw new LayerDocumentError('LAYER_DOCUMENT_LAYERS_REQUIRED', '图层列表不能为空');
  }
  if (input.layers.length > MAX_LAYERS) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_TOO_MANY_LAYERS',
      `图层数量不能超过 ${MAX_LAYERS}`,
    );
  }
  const exportMode = input.exportMode;
  if (exportMode !== 'basic' && exportMode !== 'pro' && exportMode !== 'studio') {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_EXPORT_MODE_INVALID',
      'PSD 导出模式无效',
    );
  }
  const layers = input.layers.map(readLayer);
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const layer of layers) {
    if (ids.has(layer.id)) {
      throw new LayerDocumentError('LAYER_DOCUMENT_DUPLICATE_LAYER', '图层 ID 不能重复');
    }
    if (orders.has(layer.order)) {
      throw new LayerDocumentError('LAYER_DOCUMENT_DUPLICATE_ORDER', '图层顺序不能重复');
    }
    ids.add(layer.id);
    orders.add(layer.order);
  }
  return {
    schemaVersion: LAYER_DOCUMENT_SCHEMA_VERSION,
    title: boundedString(input.title, '文档标题', MAX_NAME_LENGTH),
    width: finiteNumber(input.width, '画布宽度', 1, MAX_DIMENSION, true),
    height: finiteNumber(input.height, '画布高度', 1, MAX_DIMENSION, true),
    exportMode,
    layers,
  };
}
