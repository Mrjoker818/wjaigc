import { CAPABILITY_FIELDS, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { validateTaskModelSelection } from '@/lib/task-core/model-capability-resolution';

export type SketchCreationMode = 'image' | 'code';
export interface SketchImageInput {
  projectId: string; imageDataUrl: string; instruction: string;
  visionProviderId: string; visionModelId: string; imageProviderId: string; imageModelId: string;
  idempotencyKey: string; aspectRatio: string; size?: string; quality?: string;
}
export interface SketchImageAnalysis {
  readonly summary: string; readonly composition: string; readonly prompt: string; readonly negativePrompt: string;
}

const INPUT_FIELDS = ['projectId', 'imageDataUrl', 'instruction', 'visionProviderId', 'visionModelId',
  'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio', 'size', 'quality'] as const;
const ANALYSIS_FIELDS = ['summary', 'composition', 'prompt', 'negativePrompt'] as const;
const MODEL_FIELDS = ['providerId', 'modelId', 'kind', 'sourceType', 'capabilitySources', ...CAPABILITY_FIELDS];
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_ANALYSIS_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const FORBIDDEN_TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SKETCH_IMAGE_OBJECT_INVALID');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('SKETCH_IMAGE_OBJECT_INVALID');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !property || !('value' in property)) {
      throw new Error('SKETCH_IMAGE_OBJECT_INVALID');
    }
    result[key] = property.value as unknown;
  }
  return result;
}
function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error('SKETCH_IMAGE_ARRAY_INVALID');
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('SKETCH_IMAGE_ARRAY_INVALID');
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property)) throw new Error('SKETCH_IMAGE_ARRAY_INVALID');
    result.push(property.value as unknown);
  }
  return result;
}
function identifier(value: unknown, limit = 256): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > limit || /\p{Cc}/u.test(value)) {
    throw new Error('SKETCH_IMAGE_INPUT_INVALID');
  }
  return value;
}
function strings(value: unknown): string[] {
  return denseArray(value).map(item => identifier(item));
}
function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('SKETCH_IMAGE_MODEL_INVALID');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('SKETCH_IMAGE_MODEL_INVALID');
  return value;
}
function readModel(value: unknown): TaskModelDescriptor {
  const raw = record(value, MODEL_FIELDS);
  const sources = record(raw.capabilitySources, CAPABILITY_FIELDS);
  if (Object.values(sources).some(source => typeof source !== 'string' || !['admin', 'adapter', 'discovery', 'fallback'].includes(source))) {
    throw new Error('SKETCH_IMAGE_MODEL_INVALID');
  }
  if (typeof raw.kind !== 'string' || !['image', 'video', 'chat', 'edit', 'upscale', 'layer', '3d'].includes(raw.kind)
    || (raw.executionMode !== 'sync' && raw.executionMode !== 'async')) throw new Error('SKETCH_IMAGE_MODEL_INVALID');
  const model: TaskModelDescriptor = {
    providerId: identifier(raw.providerId), modelId: identifier(raw.modelId),
    kind: raw.kind as TaskModelDescriptor['kind'], sourceType: identifier(raw.sourceType) as TaskModelDescriptor['sourceType'],
    protocol: identifier(raw.protocol), executionMode: raw.executionMode,
    allowedRatios: strings(raw.allowedRatios), allowedSizes: strings(raw.allowedSizes), qualityOptions: strings(raw.qualityOptions),
    maxOutputs: nonnegativeInteger(raw.maxOutputs), supportsReferenceImages: boolean(raw.supportsReferenceImages),
    supportsMask: boolean(raw.supportsMask), outputKinds: strings(raw.outputKinds), capabilitySources: sources as TaskModelDescriptor['capabilitySources'],
  };
  if (raw.supportsVision !== undefined) model.supportsVision = boolean(raw.supportsVision);
  if (raw.maxReferenceImages !== undefined) model.maxReferenceImages = nonnegativeInteger(raw.maxReferenceImages);
  if (raw.supportedOperations !== undefined) {
    const operations = strings(raw.supportedOperations);
    if (operations.some(operation => !['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video',
      'first-last-frame', 'multi-reference', 'video-extend'].includes(operation))) throw new Error('SKETCH_IMAGE_MODEL_INVALID');
    model.supportedOperations = operations as TaskModelDescriptor['supportedOperations'];
  }
  if (raw.allowedDurationsSeconds !== undefined) model.allowedDurationsSeconds = denseArray(raw.allowedDurationsSeconds).map(nonnegativeInteger);
  if (raw.maxDurationSeconds !== undefined) model.maxDurationSeconds = nonnegativeInteger(raw.maxDurationSeconds);
  return model;
}
/** The authoritative catalog declares raster formats; retain the legacy image category. */
export function supportsSketchImageOutput(outputKinds: readonly string[]): boolean {
  return outputKinds.some(kind => ['image', 'png', 'jpeg', 'webp'].includes(kind));
}
function supportsSketchImage(model: TaskModelDescriptor): boolean {
  return model.kind === 'image' && model.supportsReferenceImages === true
    && (model.maxReferenceImages === undefined || model.maxReferenceImages >= 1)
    && (model.supportedOperations === undefined || model.supportedOperations.includes('image-to-image'))
    && supportsSketchImageOutput(model.outputKinds) && model.maxOutputs >= 1;
}
export function sketchImageModels(catalog: readonly TaskModelDescriptor[]): TaskModelDescriptor[] {
  return denseArray(catalog).map(readModel).filter(supportsSketchImage);
}

/** PNG container/canonical encoding and budgets only. Task8 MUST still call
 * inspectBinaryImage on the backend to decode compressed pixels with CPU limits. */
function validatePng(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)
    || value.length > PNG_PREFIX.length + Math.ceil(MAX_PNG_BYTES / 3) * 4) throw new Error('SKETCH_IMAGE_PNG_INVALID');
  const encoded = value.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('SKETCH_IMAGE_PNG_INVALID');
  let bytes: string;
  try { bytes = atob(encoded); } catch { throw new Error('SKETCH_IMAGE_PNG_INVALID'); }
  if (bytes.length > MAX_PNG_BYTES || btoa(bytes) !== encoded || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n') {
    throw new Error('SKETCH_IMAGE_PNG_INVALID');
  }
  const byte = (offset: number): number => bytes.charCodeAt(offset);
  const uint32 = (offset: number): number => ((byte(offset) << 24) | (byte(offset + 1) << 16)
    | (byte(offset + 2) << 8) | byte(offset + 3)) >>> 0;
  let offset = 8, color = -1, depth = 0, palette = false, sawData = false, dataBytes = 0, previous = '', zlibHeader = '';
  while (offset + 12 <= bytes.length) {
    const length = uint32(offset), type = bytes.slice(offset + 4, offset + 8), end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error('SKETCH_IMAGE_PNG_INVALID');
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index++) {
      crc ^= byte(index);
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== uint32(end - 4)) throw new Error('SKETCH_IMAGE_PNG_INVALID');
    const data = offset + 8;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('SKETCH_IMAGE_PNG_INVALID');
      const width = uint32(data), height = uint32(data + 4);
      depth = byte(data + 8); color = byte(data + 9);
      const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (width < 1 || height < 1 || width > 2048 || height > 2048 || !depths[color]?.includes(depth)
        || byte(data + 10) !== 0 || byte(data + 11) !== 0 || byte(data + 12) > 1) throw new Error('SKETCH_IMAGE_PNG_INVALID');
    } else if (type === 'IHDR') {
      throw new Error('SKETCH_IMAGE_PNG_INVALID');
    } else if (type === 'PLTE') {
      if (palette || sawData || color === 0 || color === 4 || length === 0 || length % 3 !== 0
        || length > 768 || (color === 3 && length / 3 > 2 ** depth)) throw new Error('SKETCH_IMAGE_PNG_INVALID');
      palette = true;
    } else if (type === 'IDAT') {
      if ((sawData && previous !== 'IDAT') || (color === 3 && !palette)) throw new Error('SKETCH_IMAGE_PNG_INVALID');
      sawData = true;
      if (zlibHeader.length < 2) zlibHeader += bytes.slice(data, data + Math.min(length, 2 - zlibHeader.length));
      dataBytes += length;
    } else if (type === 'IEND') {
      const cmf = zlibHeader.charCodeAt(0), flg = zlibHeader.charCodeAt(1);
      // Only the zlib envelope is inspected, never DEFLATE pixels or scanlines.
      if (length !== 0 || dataBytes < 6 || end !== bytes.length || (cmf & 15) !== 8 || (cmf >>> 4) > 7
        || (flg & 32) !== 0 || (cmf * 256 + flg) % 31 !== 0) throw new Error('SKETCH_IMAGE_PNG_INVALID');
      return value;
    } else if (type[0] === type[0].toUpperCase()) {
      throw new Error('SKETCH_IMAGE_PNG_INVALID');
    }
    previous = type; offset = end;
  }
  throw new Error('SKETCH_IMAGE_PNG_INVALID');
}
function readInput(value: unknown): Readonly<SketchImageInput> {
  const raw = record(value, INPUT_FIELDS);
  if (typeof raw.instruction !== 'string' || raw.instruction.length > 4096
    || FORBIDDEN_TEXT_CONTROLS.test(raw.instruction)) throw new Error('SKETCH_IMAGE_INPUT_INVALID');
  return Object.freeze({ projectId: identifier(raw.projectId), imageDataUrl: validatePng(raw.imageDataUrl), instruction: raw.instruction,
    visionProviderId: identifier(raw.visionProviderId), visionModelId: identifier(raw.visionModelId),
    imageProviderId: identifier(raw.imageProviderId), imageModelId: identifier(raw.imageModelId),
    idempotencyKey: identifier(raw.idempotencyKey), aspectRatio: identifier(raw.aspectRatio),
    ...(Object.hasOwn(raw, 'size') ? { size: identifier(raw.size) } : {}),
    ...(Object.hasOwn(raw, 'quality') ? { quality: identifier(raw.quality) } : {}) });
}
/** Private task restoration validates source data only, not current model or project permission. */
export function parseStoredSketchImageInput(value: unknown): Readonly<SketchImageInput> { return readInput(value); }
export function freezeSketchImageInput(value: unknown, vision: TaskModelDescriptor, image: TaskModelDescriptor): Readonly<SketchImageInput> {
  const input = readInput(value), llm = readModel(vision), generator = readModel(image);
  if (llm.providerId !== input.visionProviderId || llm.modelId !== input.visionModelId
    || llm.kind !== 'chat' || llm.supportsVision !== true || llm.protocol !== 'chat-completions' || llm.executionMode !== 'sync'
    || generator.providerId !== input.imageProviderId || generator.modelId !== input.imageModelId || !supportsSketchImage(generator)) {
    throw new Error('SKETCH_IMAGE_MODEL_UNAVAILABLE');
  }
  const validation = validateTaskModelSelection(generator, { aspectRatio: input.aspectRatio, size: input.size, quality: input.quality,
    outputCount: 1, referenceImageCount: 1,
    ...(generator.supportedOperations === undefined ? {} : { operation: 'image-to-image' as const }) });
  if (!validation.ok) throw new Error(`SKETCH_IMAGE_CAPABILITY_MISMATCH:${validation.error.field}`);
  return input;
}
export function parseSketchImageAnalysis(value: unknown): SketchImageAnalysis {
  const encoder = new TextEncoder();
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_BYTES || encoder.encode(value).length > MAX_JSON_BYTES) throw new Error('SKETCH_IMAGE_ANALYSIS_LIMIT');
    try { value = JSON.parse(value) as unknown; } catch { throw new Error('SKETCH_IMAGE_ANALYSIS_INVALID'); }
  }
  const raw = record(value, ANALYSIS_FIELDS);
  let bytes = 0;
  const text = (field: typeof ANALYSIS_FIELDS[number]): string => {
    const candidate = raw[field];
    if (typeof candidate !== 'string' || candidate.length > MAX_ANALYSIS_BYTES
      || FORBIDDEN_TEXT_CONTROLS.test(candidate)
      || (field !== 'negativePrompt' && !candidate.trim())) throw new Error('SKETCH_IMAGE_ANALYSIS_INVALID');
    bytes += encoder.encode(candidate).length;
    if (bytes > MAX_ANALYSIS_BYTES) throw new Error('SKETCH_IMAGE_ANALYSIS_LIMIT');
    return candidate;
  };
  return Object.freeze({ summary: text('summary'), composition: text('composition'), prompt: text('prompt'), negativePrompt: text('negativePrompt') });
}
interface SketchImageGenerationBody {
  projectId: string; model: string; providerId: string; prompt: string; negativePrompt: string;
  referenceImages: string[]; imageUrl: string; referenceDescriptions: string[];
  aspectRatio: string; size?: string; quality?: string; outputCount: 1; submitOnly: true;
}
export function buildSketchImageGenerationBody(input: Readonly<SketchImageInput>, analysis: SketchImageAnalysis): SketchImageGenerationBody {
  const frozen = readInput(input), parsed = parseSketchImageAnalysis(analysis);
  return { projectId: frozen.projectId, model: frozen.imageModelId, providerId: frozen.imageProviderId,
    prompt: `用户原关键词：${frozen.instruction}\n构图：${parsed.composition}\n生成提示词：${parsed.prompt}`,
    negativePrompt: parsed.negativePrompt, referenceImages: [frozen.imageDataUrl], imageUrl: frozen.imageDataUrl,
    referenceDescriptions: [parsed.summary], aspectRatio: frozen.aspectRatio,
    ...(frozen.size === undefined ? {} : { size: frozen.size }), ...(frozen.quality === undefined ? {} : { quality: frozen.quality }),
    outputCount: 1, submitOnly: true };
}
