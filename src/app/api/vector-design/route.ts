import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getRequestUser, requireApiAuthOrReject } from '@/lib/api-auth';
import { findProviderById } from '@/lib/server-api-config';
import { getInternalApiUrl } from '@/lib/api-helpers';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import {
  calculateConfiguredCreditCost,
} from '@/lib/credits';
import {
  chargeCloudTaskCredits,
  completeCloudTask,
  getCloudTaskForUser,
  terminateCloudTaskAndRefund,
} from '@/lib/cloud-task-storage';
import { getImageWriteDir } from '@/lib/server-data-root';
import {
  VECTOR_ASPECT_RATIOS,
  applyVectorEditOperation,
  buildVectorPrompt,
  getVectorModelCapabilities,
  isRecraftVectorModel,
  sanitizeEditableSvg,
  type VectorEditOperation,
  type VectorPresetSelection,
} from '@/lib/vector-design';
import {
  buildRecraftGenerationPayload,
  extractRecraftVectorSources,
  validateRecraftVectorSourceCount,
  type RecraftGenerationPayload,
  type RecraftVectorSource,
} from '@/lib/recraft-vector-request';
import { downloadPublicImage } from '@/lib/safe-image-download';
import { resolveManagedMediaPath } from '@/lib/safe-image-input';
import {
  VectorDesignIdempotencyConflictError,
  claimVectorDesignTask,
  createVectorDesignRequestHash,
} from '@/lib/vector-design-idempotency';
import { prepareVectorSvgAsset } from '@/lib/vector-svg-preview';

export const runtime = 'nodejs';
export const maxDuration = 180;

type VectorAction =
  | 'generate'
  | 'vectorize'
  | 'image-to-image'
  | 'explore'
  | 'explore-similar'
  | 'create-style'
  | 'enhance-prompt'
  | 'edit';

type RecraftEndpoint =
  | '/images/generations/vector'
  | '/images/vectorize'
  | '/images/imageToImage'
  | '/images/explore'
  | '/images/explore/similar'
  | '/styles'
  | '/prompts/enhance';

interface VectorDesignRequest {
  action: VectorAction;
  providerId: string;
  model: string;
  prompt?: string;
  templateIds?: string[];
  selection?: VectorPresetSelection;
  size?: string;
  n?: number;
  imageUrl?: string;
  sourceImageId?: string;
  similarity?: number;
  strength?: number;
  style?: string;
  styleId?: string;
  negativePrompt?: string;
  colors?: string[];
  backgroundColor?: string;
  randomSeed?: number;
  noText?: boolean;
  artisticLevel?: number;
  sourceSvg?: string;
  operation?: VectorEditOperation;
  selectedElementId?: string;
  targetBox?: { x: number; y: number; width: number; height: number };
  replacePrompt?: string;
}

interface RecraftAsset {
  svg: string;
  svgUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  pathCount: number;
  sourceImageId?: string;
}

interface VectorResponseAsset extends RecraftAsset {
  model: string;
  providerId: string;
  providerName: string;
  sourceType: VectorAction;
}

interface VectorSuccessResponse {
  success: true;
  assets: VectorResponseAsset[];
  asset: VectorResponseAsset;
}

interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
}

class VectorRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'VectorRequestError';
  }
}

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REMOTE_SVG_BYTES = 12 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCE_PIXELS = 16_000_000;
const MAX_LIVE_VECTOR_TASK_AGE_MS = 5 * 60_000;
const ALLOWED_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_VECTOR_MIME_TYPES = ['image/svg+xml', 'application/xml', 'text/xml'];
const ALLOWED_ASPECTS = new Set(VECTOR_ASPECT_RATIOS.map(option => option.value));
const MODEL_ACTIONS = new Set<VectorAction>([
  'generate',
  'vectorize',
  'image-to-image',
  'explore',
  'explore-similar',
  'create-style',
]);
const TRACKED_PROVIDER_ACTIONS = new Set<VectorAction>([
  ...MODEL_ACTIONS,
  'enhance-prompt',
]);

function buildEndpointCandidates(baseUrl: string, endpoint: RecraftEndpoint): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = /\/v\d+$/i.test(base)
    ? [`${base}${endpoint}`]
    : [`${base}/v1${endpoint}`, `${base}${endpoint}`, `${base}/recraft/v1${endpoint}`];
  return [...new Set(candidates)];
}

async function validateReferenceImage(
  buffer: Buffer,
  expectedMimeType: string,
  allowSvg: boolean,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (buffer.length === 0) throw new VectorRequestError('参考图内容为空');
  if (buffer.length >= MAX_REFERENCE_IMAGE_BYTES) {
    throw new VectorRequestError('参考图必须小于 10MB');
  }
  if (expectedMimeType === 'image/svg+xml') {
    if (!allowSvg) {
      throw new VectorRequestError('位图矢量化仅支持 PNG、JPG、WEBP');
    }
    const svg = sanitizeEditableSvg(buffer.toString('utf8'));
    const svgBuffer = Buffer.from(svg, 'utf8');
    const metadata = await sharp(svgBuffer, {
      density: 72,
      limitInputPixels: MAX_REFERENCE_PIXELS,
      failOn: 'error',
    }).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (width < 256 || height < 256 || width >= 4096 || height >= 4096 || width * height >= MAX_REFERENCE_PIXELS) {
      throw new VectorRequestError('参考图需为 256–4096 像素，且总像素不超过 1600 万');
    }
    return { buffer: svgBuffer, mimeType: expectedMimeType };
  }
  const metadata = await sharp(buffer, {
    limitInputPixels: MAX_REFERENCE_PIXELS,
    failOn: 'error',
  }).metadata();
  const formatMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format || ''}`;
  if (!ALLOWED_REFERENCE_MIME_TYPES.has(formatMime) || formatMime !== expectedMimeType) {
    throw new VectorRequestError('参考图格式与文件内容不一致，仅支持 PNG、JPG、WEBP');
  }
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 256 || height < 256 || width >= 4096 || height >= 4096 || width * height >= MAX_REFERENCE_PIXELS) {
    throw new VectorRequestError('参考图需为 256–4096 像素，且总像素不超过 1600 万');
  }
  return { buffer, mimeType: formatMime };
}

async function readResponseBufferLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) {
    throw new VectorRequestError('远程响应超过允许大小', 502);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new VectorRequestError('远程响应超过允许大小', 502);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchImageBuffer(
  imageUrl: string,
  allowSvg = false,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(
      /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,((?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?)$/i,
    );
    if (!match) throw new VectorRequestError('参考图仅支持 PNG、JPG、WEBP，图生矢量另支持 SVG');
    const mimeType = match[1].toLowerCase();
    if (mimeType === 'image/svg+xml' && !allowSvg) {
      throw new VectorRequestError('位图矢量化不接受 SVG 输入');
    }
    const estimatedBytes = Math.floor((match[2].length * 3) / 4);
    if (estimatedBytes >= MAX_REFERENCE_IMAGE_BYTES + 2) {
      throw new VectorRequestError('参考图必须小于 10MB');
    }
    return validateReferenceImage(Buffer.from(match[2], 'base64'), mimeType, allowSvg);
  }

  if (imageUrl.startsWith('/')) {
    resolveManagedMediaPath(imageUrl);
    const response = await fetch(getInternalApiUrl(imageUrl), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new VectorRequestError(`读取参考图失败：HTTP ${response.status}`, 502);
    }
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType) && !(allowSvg && mimeType === 'image/svg+xml')) {
      throw new VectorRequestError('参考图仅支持 PNG、JPG、WEBP，图生矢量另支持 SVG');
    }
    return validateReferenceImage(
      await readResponseBufferLimited(response, MAX_REFERENCE_IMAGE_BYTES),
      mimeType,
      allowSvg,
    );
  }

  const downloaded = await downloadPublicImage(imageUrl, {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    timeoutMs: 30_000,
    allowedMimeTypes: allowSvg
      ? [...ALLOWED_REFERENCE_MIME_TYPES, 'image/svg+xml']
      : [...ALLOWED_REFERENCE_MIME_TYPES],
  });
  return validateReferenceImage(downloaded.buffer, downloaded.mimeType, allowSvg);
}

async function callRecraftJson(
  provider: ProviderCredentials,
  endpoint: RecraftEndpoint,
  body: BodyInit,
  contentType?: string,
): Promise<Record<string, unknown>> {
  const endpointCandidates = buildEndpointCandidates(provider.baseUrl, endpoint);
  const idempotencyKey = randomUUID();
  for (let index = 0; index < endpointCandidates.length; index += 1) {
    const endpointUrl = endpointCandidates[index];
    try {
      const providerResponse = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Idempotency-Key': idempotencyKey,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(150_000),
      });
      const responseBuffer = await readResponseBufferLimited(
        providerResponse,
        MAX_PROVIDER_RESPONSE_BYTES,
      );
      const responseText = responseBuffer.toString('utf8');
      if (!providerResponse.ok) {
        if (
          [404, 405].includes(providerResponse.status)
          && index < endpointCandidates.length - 1
        ) {
          continue;
        }
        throw new VectorRequestError(
          `Recraft 接口调用失败：${providerResponse.status} ${responseText.slice(0, 300)}`,
          502,
        );
      }
      const responseType = providerResponse.headers.get('content-type') || '';
      if (responseType.includes('svg') || responseType.includes('xml')) {
        return { svg: responseText };
      }
      try {
        return JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        throw new VectorRequestError('Recraft 返回了无效 JSON', 502);
      }
    } catch (error) {
      if (error instanceof VectorRequestError) throw error;
      throw new VectorRequestError(
        `Recraft 接口调用失败：${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
  }
  throw new VectorRequestError('Recraft 接口调用失败：提供商未返回有效结果', 502);
}

async function resolveVectorSources(data: Record<string, unknown>): Promise<Array<{
  svg: string;
  sourceImageId?: string;
}>> {
  const sources = extractRecraftVectorSources(data);
  if (sources.length === 0) {
    throw new VectorRequestError('Recraft 返回结果中没有 SVG', 502);
  }
  return Promise.all(sources.map(async (source: RecraftVectorSource) => {
    if (source.inlineSvg) {
      return { svg: source.inlineSvg, sourceImageId: source.sourceImageId };
    }
    if (!source.url) throw new VectorRequestError('Recraft 返回了空的 SVG 地址', 502);
    const downloaded = await downloadPublicImage(source.url, {
      maxBytes: MAX_REMOTE_SVG_BYTES,
      timeoutMs: 30_000,
      allowedMimeTypes: ALLOWED_VECTOR_MIME_TYPES,
    });
    return {
      svg: downloaded.buffer.toString('utf8'),
      sourceImageId: source.sourceImageId,
    };
  }));
}

async function callRecraftVectors(
  provider: ProviderCredentials,
  endpoint: RecraftEndpoint,
  body: BodyInit,
  contentType?: string,
): Promise<Array<{ svg: string; sourceImageId?: string }>> {
  return resolveVectorSources(await callRecraftJson(provider, endpoint, body, contentType));
}

async function persistSvgBatch(
  sources: Array<{ svg: string; sourceImageId?: string }>,
): Promise<RecraftAsset[]> {
  const prepared: Array<Awaited<ReturnType<typeof prepareVectorSvgAsset>> & {
    sourceImageId?: string;
  }> = [];
  for (const source of sources) {
    const asset = await prepareVectorSvgAsset(source.svg);
    prepared.push({
      ...asset,
      sourceImageId: source.sourceImageId,
    });
  }
  const directory = getImageWriteDir('vector-design');
  const writtenPaths: string[] = [];
  const temporaryPaths: string[] = [];

  try {
    const assets: RecraftAsset[] = [];
    for (const item of prepared) {
      const id = `${Date.now()}-${randomUUID()}`;
      const svgFilename = `vector-${id}.svg`;
      const previewFilename = `vector-${id}.png`;
      const svgPath = path.join(directory, svgFilename);
      const previewPath = path.join(directory, previewFilename);
      const svgTemporaryPath = `${svgPath}.tmp`;
      const previewTemporaryPath = `${previewPath}.tmp`;

      temporaryPaths.push(svgTemporaryPath, previewTemporaryPath);
      await Promise.all([
        fs.writeFile(svgTemporaryPath, item.svg, 'utf8'),
        fs.writeFile(previewTemporaryPath, item.previewBuffer),
      ]);
      await fs.rename(svgTemporaryPath, svgPath);
      temporaryPaths.splice(temporaryPaths.indexOf(svgTemporaryPath), 1);
      writtenPaths.push(svgPath);
      await fs.rename(previewTemporaryPath, previewPath);
      temporaryPaths.splice(temporaryPaths.indexOf(previewTemporaryPath), 1);
      writtenPaths.push(previewPath);

      assets.push({
        svg: item.svg,
        svgUrl: `/api/serve-upload/vector-design/${svgFilename}`,
        previewUrl: `/api/serve-upload/vector-design/${previewFilename}`,
        width: item.width,
        height: item.height,
        pathCount: item.pathCount,
        sourceImageId: item.sourceImageId,
      });
    }
    return assets;
  } catch (error) {
    await Promise.allSettled(
      [...temporaryPaths, ...writtenPaths].map(filePath => fs.unlink(filePath)),
    );
    throw error;
  }
}

function getValidatedCount(body: VectorDesignRequest): number {
  if (body.n === undefined) return 1;
  const raw = Number(body.n);
  if (!Number.isInteger(raw) || raw < 1 || raw > 6) {
    throw new VectorRequestError('生成数量必须是 1–6 的整数');
  }
  return raw;
}

function getValidatedAspect(body: VectorDesignRequest): string {
  const size = String(body.size || '1:1');
  if (!ALLOWED_ASPECTS.has(size)) {
    throw new VectorRequestError('所选画面比例不受 Recraft Vector 支持');
  }
  return size;
}

function buildGenerationPayload(
  body: VectorDesignRequest,
  prompt: string,
  count: number,
  size: string,
): RecraftGenerationPayload {
  return buildRecraftGenerationPayload({
    model: body.model,
    prompt,
    size,
    count,
    style: body.style,
    styleId: body.styleId,
    negativePrompt: body.negativePrompt,
    noText: body.noText
      ?? body.selection?.quickIds?.includes('no-text')
      ?? body.templateIds?.includes('no-text'),
    artisticLevel: body.artisticLevel,
    colors: body.colors,
    backgroundColor: body.backgroundColor,
    randomSeed: body.randomSeed,
  });
}

function appendImageToImageFields(
  form: FormData,
  payload: RecraftGenerationPayload,
  strength: number,
): void {
  form.append('prompt', payload.prompt);
  form.append('model', payload.model);
  form.append('n', String(payload.n));
  form.append('strength', String(strength));
  form.append('response_format', payload.response_format);
  if (payload.style) form.append('style', payload.style);
  if (payload.style_id) form.append('style_id', payload.style_id);
  if (payload.negative_prompt) form.append('negative_prompt', payload.negative_prompt);
  if (payload.random_seed !== undefined) form.append('random_seed', String(payload.random_seed));
  if (payload.controls) form.append('controls', JSON.stringify(payload.controls));
}

function buildValidatedPrompt(
  body: VectorDesignRequest,
  rawPrompt = String(body.prompt || ''),
): string {
  const prompt = buildVectorPrompt({
    prompt: rawPrompt,
    templateIds: body.templateIds,
    selection: body.selection,
  });
  const limit = getVectorModelCapabilities(body.model).promptLimit;
  if (prompt.length > limit) {
    throw new VectorRequestError(`组合预设后的最终提示词不能超过 ${limit} 个字符`);
  }
  return prompt;
}

async function generateReplacementVector(
  provider: ProviderCredentials,
  body: VectorDesignRequest,
): Promise<string> {
  if (!body.sourceSvg || !body.selectedElementId || !body.replacePrompt?.trim()) {
    throw new VectorRequestError('局部替换需要 SVG、选中元素和替换描述');
  }
  const prompt = buildValidatedPrompt(
    body,
    `${body.replacePrompt}。生成单个独立矢量元素，用于替换现有设计中的局部，保持构图简洁且无背景`,
  );
  const results = await callRecraftVectors(
    provider,
    '/images/generations/vector',
    JSON.stringify(buildGenerationPayload(body, prompt, 1, '1:1')),
    'application/json',
  );
  return applyVectorEditOperation(sanitizeEditableSvg(body.sourceSvg), {
    type: 'replace',
    elementId: body.selectedElementId,
    replacementSvg: results[0].svg,
    targetBox: body.targetBox,
  });
}

function validateActionRequest(
  body: VectorDesignRequest,
  capabilities: ReturnType<typeof getVectorModelCapabilities>,
): void {
  const prompt = body.prompt?.trim() || '';
  if (['generate', 'image-to-image', 'explore', 'enhance-prompt'].includes(body.action) && !prompt) {
    throw new VectorRequestError('请输入矢量图需求');
  }
  if (prompt.length > capabilities.promptLimit && body.action !== 'enhance-prompt') {
    throw new VectorRequestError(`当前模型提示词不能超过 ${capabilities.promptLimit} 个字符`);
  }
  if (body.action === 'enhance-prompt' && prompt.length > 2000) {
    throw new VectorRequestError('待增强提示词不能超过 2000 个字符');
  }
  if (['vectorize', 'image-to-image', 'create-style'].includes(body.action) && !body.imageUrl) {
    throw new VectorRequestError('请选择参考图片');
  }
  if (body.action === 'image-to-image' && !capabilities.supportsImageToImage) {
    throw new VectorRequestError('当前模型不支持图生矢量，请选择 Recraft V3/V4/V4.1 Vector');
  }
  if (['explore', 'explore-similar'].includes(body.action) && !capabilities.supportsExplore) {
    throw new VectorRequestError('灵感探索仅支持 Recraft V4/V4.1 Vector');
  }
  if (body.action === 'explore-similar') {
    if (
      typeof body.sourceImageId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sourceImageId)
    ) {
      throw new VectorRequestError('相似探索需要有效的 Explore 来源图片 ID');
    }
    if (!Number.isInteger(body.similarity) || body.similarity! < 1 || body.similarity! > 5) {
      throw new VectorRequestError('相似度必须是 1–5 的整数');
    }
  }
  if (body.action === 'create-style' && !capabilities.supportsCustomStyles) {
    throw new VectorRequestError('API 自定义风格仅支持 Recraft V3 Vector');
  }
  if (!capabilities.supportsStyles && (body.style || body.styleId)) {
    throw new VectorRequestError('当前模型不支持 Recraft 原生风格参数');
  }
  if (!capabilities.supportsNegativePrompt && body.negativePrompt) {
    throw new VectorRequestError('当前模型不支持负向提示词');
  }
  if (!capabilities.supportsNoTextControl && body.noText !== undefined) {
    throw new VectorRequestError('当前模型不支持原生无文字控制');
  }
  if (capabilities.family !== 'v3' && body.artisticLevel !== undefined) {
    throw new VectorRequestError('艺术强度仅支持 Recraft V3');
  }

  const boundedText: Array<[unknown, string, number]> = [
    [body.negativePrompt, '负向提示词', 1000],
    [body.style, '原生风格', 128],
    [body.styleId, '自定义风格 ID', 128],
    [body.selectedElementId, '元素 ID', 128],
    [body.replacePrompt, '替换描述', 1000],
  ];
  for (const [value, label, limit] of boundedText) {
    if (value !== undefined && (typeof value !== 'string' || value.length > limit)) {
      throw new VectorRequestError(`${label}格式无效或超过 ${limit} 个字符`);
    }
  }
  if (body.sourceSvg !== undefined && (typeof body.sourceSvg !== 'string' || body.sourceSvg.length > 12 * 1024 * 1024)) {
    throw new VectorRequestError('源 SVG 超过 12MB');
  }
  if (body.imageUrl !== undefined && (typeof body.imageUrl !== 'string' || body.imageUrl.length > 14 * 1024 * 1024)) {
    throw new VectorRequestError('参考图地址或 data URL 过长');
  }
  if (body.templateIds !== undefined && (
    !Array.isArray(body.templateIds)
    || body.templateIds.length > 32
    || body.templateIds.some(id => typeof id !== 'string' || id.length > 64)
  )) {
    throw new VectorRequestError('快捷预设参数无效');
  }
  if (body.selection !== undefined) {
    if (
      !Array.isArray(body.selection.quickIds)
      || body.selection.quickIds.length > 16
      || body.selection.quickIds.some(
      id => typeof id !== 'string' || id.length > 64,
      )
      || [body.selection.categoryId, body.selection.designId, body.selection.styleId].some(
        id => id !== undefined && (typeof id !== 'string' || id.length > 64),
      )
    ) {
      throw new VectorRequestError('预设选择参数无效');
    }
  }
  if (body.colors !== undefined && (
    !Array.isArray(body.colors)
    || body.colors.length > 8
    || body.colors.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
  )) {
    throw new VectorRequestError('偏好色最多 8 个，且必须使用 #RRGGBB 格式');
  }
  if (
    body.backgroundColor !== undefined
    && (typeof body.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.backgroundColor))
  ) {
    throw new VectorRequestError('背景色必须使用 #RRGGBB 格式');
  }
  if (
    body.randomSeed !== undefined
    && (!Number.isInteger(body.randomSeed) || body.randomSeed < 0 || body.randomSeed > 4_294_967_295)
  ) {
    throw new VectorRequestError('随机种子必须是 0–4294967295 的整数');
  }
  if (
    body.strength !== undefined
    && (!Number.isFinite(body.strength) || body.strength < 0 || body.strength > 1)
  ) {
    throw new VectorRequestError('参考强度必须在 0–1 之间');
  }
  if (
    body.artisticLevel !== undefined
    && (!Number.isInteger(body.artisticLevel) || body.artisticLevel < 0 || body.artisticLevel > 5)
  ) {
    throw new VectorRequestError('艺术强度必须是 0–5 的整数');
  }
  if (body.noText !== undefined && typeof body.noText !== 'boolean') {
    throw new VectorRequestError('无文字控制必须是布尔值');
  }
  if (body.style && body.styleId) {
    throw new VectorRequestError('原生风格与自定义风格不能同时使用');
  }
  if (
    body.backgroundColor
    && (
      body.selection?.quickIds?.includes('transparent')
      || body.templateIds?.includes('transparent')
    )
  ) {
    throw new VectorRequestError('透明背景与背景色不能同时使用');
  }
  if (body.operation !== undefined) {
    if (!body.operation || typeof body.operation !== 'object') {
      throw new VectorRequestError('SVG 编辑操作无效');
    }
    const operation = body.operation;
    const allowedTypes = new Set(['delete', 'recolor', 'transform', 'expand', 'replace', 'append']);
    if (!allowedTypes.has(operation.type)) throw new VectorRequestError('SVG 编辑操作无效');
    if ('elementId' in operation && (
      typeof operation.elementId !== 'string'
      || operation.elementId.length === 0
      || operation.elementId.length > 128
    )) {
      throw new VectorRequestError('SVG 元素 ID 无效');
    }
    if (operation.type === 'recolor' && !/^#[0-9a-f]{6}$/i.test(operation.color)) {
      throw new VectorRequestError('SVG 颜色必须使用 #RRGGBB 格式');
    }
    if (
      operation.type === 'transform'
      && (
        operation.transform.length > 256
        || !/^[a-z0-9(),.\s+-]+$/i.test(operation.transform)
      )
    ) {
      throw new VectorRequestError('SVG 变换参数无效');
    }
    if (
      operation.type === 'expand'
      && (!Number.isFinite(operation.percent) || operation.percent < 0 || operation.percent > 200)
    ) {
      throw new VectorRequestError('SVG 扩展比例必须在 0–200 之间');
    }
    if (
      (operation.type === 'replace' || operation.type === 'append')
      && (
        typeof operation.replacementSvg !== 'string'
        || operation.replacementSvg.length > 12 * 1024 * 1024
      )
    ) {
      throw new VectorRequestError('替换 SVG 超过安全上限');
    }
  }
  if (body.targetBox !== undefined) {
    const values = [
      body.targetBox.x,
      body.targetBox.y,
      body.targetBox.width,
      body.targetBox.height,
    ];
    if (
      values.some(value => !Number.isFinite(value) || Math.abs(value) > 10_000_000)
      || body.targetBox.width <= 0
      || body.targetBox.height <= 0
    ) {
      throw new VectorRequestError('目标区域参数无效');
    }
  }
}

async function readRequestJson(request: NextRequest): Promise<VectorDesignRequest> {
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_REQUEST_BODY_BYTES) {
    throw new VectorRequestError('请求体超过 16MB', 413);
  }
  if (!request.body) throw new VectorRequestError('请求体为空');
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      throw new VectorRequestError('请求体超过 16MB', 413);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as VectorDesignRequest;
  } catch {
    throw new VectorRequestError('请求体不是有效 JSON');
  }
}

function validateIdempotencyKey(request: NextRequest): string {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  if (key.length < 8 || key.length > 128 || !/^[a-z0-9._:-]+$/i.test(key)) {
    throw new VectorRequestError('计费操作需要 8–128 位有效幂等键');
  }
  return key;
}

function createStoredResponse(response: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(response.assets)) return response;
  const assets = response.assets.map(value => {
    if (!value || typeof value !== 'object') {
      throw new VectorRequestError('矢量结果格式无效', 500);
    }
    const asset = { ...(value as VectorResponseAsset) } as Partial<VectorResponseAsset>;
    delete asset.svg;
    return asset;
  });
  return { ...response, assets, asset: assets[0] };
}

async function hydrateStoredResponse(
  response: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(response.assets)) return response;
  const directory = getImageWriteDir('vector-design');
  const assets = [];
  for (const value of response.assets) {
    if (!value || typeof value !== 'object') {
      throw new VectorRequestError('已完成任务的矢量结果无效', 500);
    }
    const asset = value as Record<string, unknown>;
    const svgUrl = typeof asset.svgUrl === 'string' ? asset.svgUrl : '';
    const match = svgUrl.match(
      /^\/api\/serve-upload\/vector-design\/(vector-[0-9a-z-]+\.svg)$/i,
    );
    if (!match || path.basename(match[1]) !== match[1]) {
      throw new VectorRequestError('已完成任务的矢量文件路径无效', 500);
    }
    const svg = sanitizeEditableSvg(
      await fs.readFile(path.join(directory, match[1]), 'utf8'),
    );
    assets.push({ ...asset, svg });
  }
  return { ...response, assets, asset: assets[0] };
}

async function replayClaimedTask(
  taskId: string,
  userId: string,
  requestHash: string,
): Promise<NextResponse> {
  const task = await getCloudTaskForUser(taskId, userId);
  if (!task || task.result?.requestHash !== requestHash) {
    throw new VectorRequestError('无法读取幂等任务状态', 409);
  }
  if (task.status === 'completed') {
    const storedResponse = task.result.response;
    if (!storedResponse || typeof storedResponse !== 'object' || Array.isArray(storedResponse)) {
      throw new VectorRequestError('已完成任务缺少可回放结果', 500);
    }
    return NextResponse.json(
      await hydrateStoredResponse(storedResponse as Record<string, unknown>),
    );
  }
  if (['queued', 'pending', 'processing'].includes(task.status)) {
    if (
      Number.isFinite(task.updatedAt)
      && task.updatedAt < Date.now() - MAX_LIVE_VECTOR_TASK_AGE_MS
    ) {
      try {
        const termination = await terminateCloudTaskAndRefund(
          taskId,
          'timeout',
          'AI 矢量设计任务超过 5 分钟未完成，已超时终止',
        );
        if (task.creditStatus === 'pending' && !termination.refunded) {
          const settledTask = await getCloudTaskForUser(taskId, userId);
          if (settledTask?.creditStatus !== 'refunded') {
            throw new Error('数据库未确认超时任务积分退款');
          }
        }
        return NextResponse.json({
          success: false,
          taskId,
          error: '相同请求已超时终止，积分已按任务状态结算，请重新发起',
        }, { status: 504 });
      } catch (settlementError) {
        console.error('[vector-design] stale task settlement failed', {
          taskId,
          error: settlementError instanceof Error
            ? settlementError.message
            : String(settlementError),
        });
        return NextResponse.json({
          success: false,
          taskId,
          error: '超时任务的积分结算状态未确认，请联系管理员',
        }, { status: 503 });
      }
    }
    return NextResponse.json({
      success: false,
      inProgress: true,
      taskId,
      error: '相同请求正在处理中，请稍后重试',
    }, { status: 202 });
  }
  return NextResponse.json({
    success: false,
    taskId,
    error: task.error || '相同请求此前未成功完成',
  }, { status: 409 });
}

async function cleanupPersistedAssets(assets: VectorResponseAsset[]): Promise<void> {
  const directory = getImageWriteDir('vector-design');
  const filenames = assets.flatMap(asset => [asset.svgUrl, asset.previewUrl])
    .map(url => url.match(/^\/api\/serve-upload\/vector-design\/([0-9a-z.-]+)$/i)?.[1])
    .filter((filename): filename is string => Boolean(filename))
    .filter(filename => path.basename(filename) === filename);
  await Promise.allSettled(
    filenames.map(filename => fs.unlink(path.join(directory, filename))),
  );
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  const authenticatedRequest = await getRequestUser(request);
  if (!authenticatedRequest) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const sessionUser = authenticatedRequest.user;

  const userId = sessionUser.id;
  let taskId = '';
  let requestHash = '';
  let chargedCredits = 0;
  let persistedResponseAssets: VectorResponseAsset[] = [];
  try {
    const body = await readRequestJson(request);
    const action = body.action;
    const providerId = String(body.providerId || '');
    const model = String(body.model || '');
    const allowedActions: VectorAction[] = [
      'generate',
      'vectorize',
      'image-to-image',
      'explore',
      'explore-similar',
      'create-style',
      'enhance-prompt',
      'edit',
    ];
    if (!allowedActions.includes(action)) {
      throw new VectorRequestError('不支持的矢量操作');
    }

    const provider = await findProviderById(providerId);
    if (!provider) {
      throw new VectorRequestError('矢量模型提供商未启用或不存在', 403);
    }
    const selectedModels = provider.selectedModels || [];
    if (!selectedModels.includes(model)) {
      throw new VectorRequestError('所选模型未被该提供商精确授权', 403);
    }
    if (!isRecraftVectorModel(model)) {
      throw new VectorRequestError('请选择 Recraft Vector 模型');
    }
    if (sessionUser.apiPermissions?.vectorize === false) {
      throw new VectorRequestError('当前用户未获得矢量设计权限', 403);
    }
    if (
      sessionUser.role !== 'admin'
      && !isModelAssignedToUser(sessionUser.imageModels, providerId, model)
    ) {
      throw new VectorRequestError('当前用户未获得该矢量模型授权', 403);
    }

    const capabilities = getVectorModelCapabilities(model);
    validateActionRequest(body, capabilities);
    const count = getValidatedCount(body);
    const size = getValidatedAspect(body);
    const providerCredentials: ProviderCredentials = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    };

    const requiresModelCall = TRACKED_PROVIDER_ACTIONS.has(action)
      || Boolean(body.replacePrompt?.trim());
    if (requiresModelCall) {
      const idempotencyKey = validateIdempotencyKey(request);
      requestHash = createVectorDesignRequestHash(body);
      const claim = await claimVectorDesignTask({
        userId,
        idempotencyKey,
        requestHash,
        providerId,
        model,
      });
      taskId = claim.taskId;
      if (!claim.owner) {
        return replayClaimedTask(taskId, userId, requestHash);
      }

      const billableCount = action === 'explore' || action === 'explore-similar'
        ? 8
        : action === 'generate' || action === 'image-to-image'
          ? count
          : 1;
      const isFreePromptEnhancement = action === 'enhance-prompt';
      const unitCost = isFreePromptEnhancement
        ? 0
        : await calculateConfiguredCreditCost(
            'vectorize',
            model,
            { providerId },
          );
      const credit = await chargeCloudTaskCredits(
        taskId,
        userId,
        unitCost * billableCount,
        isFreePromptEnhancement
          ? 'AI 矢量提示词优化'
          : `AI 矢量设计 × ${billableCount}`,
      );
      if (!credit.charged) {
        await terminateCloudTaskAndRefund(
          taskId,
          'failed',
          '积分不足或任务已被其他请求处理',
        );
        return NextResponse.json(
          { success: false, taskId, error: '积分不足' },
          { status: 402 },
        );
      }
      chargedCredits = credit.creditCost;
    }

    const finalizeResponse = async (
      response: Record<string, unknown>,
    ): Promise<NextResponse> => {
      if (taskId) {
        const completed = await completeCloudTask(taskId, {
          requestHash,
          response: createStoredResponse(response),
        });
        if (!completed) {
          throw new VectorRequestError('任务状态已改变，不能提交完成结果', 409);
        }
      }
      return NextResponse.json(response);
    };

    if (action === 'enhance-prompt') {
      const enhanced = await callRecraftJson(
        providerCredentials,
        '/prompts/enhance',
        JSON.stringify({ prompt: body.prompt!.trim() }),
        'application/json',
      );
      const enhancedPrompt = String(enhanced.enhanced_prompt || '').trim();
      if (!enhancedPrompt) throw new VectorRequestError('Recraft 未返回增强后的提示词', 502);
      return finalizeResponse({ success: true, enhancedPrompt });
    }

    if (action === 'create-style') {
      const image = await fetchImageBuffer(body.imageUrl!, false);
      if (image.buffer.length >= 5 * 1024 * 1024) {
        throw new VectorRequestError('自定义风格参考图总大小必须小于 5MB');
      }
      const form = new FormData();
      form.append(
        'file1',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
        `style-reference.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1]}`,
      );
      form.append('style', 'vector_illustration');
      form.append('model', model);
      if (body.prompt?.trim()) form.append('prompt', body.prompt.trim());
      const styleResult = await callRecraftJson(providerCredentials, '/styles', form);
      const styleId = typeof styleResult.id === 'string' ? styleResult.id.trim() : '';
      if (!styleId || styleId.length > 128) {
        throw new VectorRequestError('Recraft 未返回有效的自定义风格 ID', 502);
      }
      return finalizeResponse({ success: true, styleId });
    }

    let vectorSources: Array<{ svg: string; sourceImageId?: string }>;
    if (action === 'generate') {
      const prompt = buildValidatedPrompt(body);
      vectorSources = await callRecraftVectors(
        providerCredentials,
        '/images/generations/vector',
        JSON.stringify(buildGenerationPayload(body, prompt, count, size)),
        'application/json',
      );
    } else if (action === 'vectorize') {
      const image = await fetchImageBuffer(body.imageUrl!, false);
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
        `reference.${image.mimeType.split('/')[1]}`,
      );
      form.append('response_format', 'b64_json');
      vectorSources = await callRecraftVectors(
        providerCredentials,
        '/images/vectorize',
        form,
      );
    } else if (action === 'image-to-image') {
      const image = await fetchImageBuffer(body.imageUrl!, true);
      const prompt = buildValidatedPrompt(body);
      const payload = buildGenerationPayload(body, prompt, count, size);
      const form = new FormData();
      form.append(
        'image',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
        `reference.${image.mimeType.split('/')[1]}`,
      );
      appendImageToImageFields(form, payload, Number(body.strength ?? 0.35));
      vectorSources = await callRecraftVectors(
        providerCredentials,
        '/images/imageToImage',
        form,
      );
    } else if (action === 'explore') {
      const prompt = buildValidatedPrompt(body);
      const explorePayload: Record<string, unknown> = {
        prompt,
        model,
        size,
        response_format: 'b64_json',
      };
      vectorSources = await callRecraftVectors(
        providerCredentials,
        '/images/explore',
        JSON.stringify(explorePayload),
        'application/json',
      );
    } else if (action === 'explore-similar') {
      vectorSources = await callRecraftVectors(
        providerCredentials,
        '/images/explore/similar',
        JSON.stringify({
          source_image_id: body.sourceImageId,
          similarity: body.similarity,
          response_format: 'b64_json',
        }),
        'application/json',
      );
    } else if (body.operation && body.sourceSvg) {
      vectorSources = [{
        svg: applyVectorEditOperation(sanitizeEditableSvg(body.sourceSvg), body.operation),
      }];
    } else if (body.sourceSvg && !body.replacePrompt) {
      vectorSources = [{ svg: sanitizeEditableSvg(body.sourceSvg) }];
    } else {
      vectorSources = [{ svg: await generateReplacementVector(providerCredentials, body) }];
    }

    const expectedSourceCount = action === 'explore' || action === 'explore-similar'
      ? 8
      : action === 'generate' || action === 'image-to-image'
        ? count
        : 1;
    try {
      validateRecraftVectorSourceCount(vectorSources, expectedSourceCount);
    } catch (countError) {
      throw new VectorRequestError(
        countError instanceof Error ? countError.message : 'Recraft 返回数量不一致',
        502,
      );
    }
    const persistedAssets = await persistSvgBatch(vectorSources);
    const assets: VectorResponseAsset[] = persistedAssets.map(asset => ({
      ...asset,
      model,
      providerId,
      providerName: provider.displayName || provider.name,
      sourceType: action,
    }));
    persistedResponseAssets = assets;
    const response: VectorSuccessResponse = {
      success: true,
      assets,
      asset: assets[0],
    };
    return finalizeResponse(response as unknown as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (persistedResponseAssets.length > 0) {
      await cleanupPersistedAssets(persistedResponseAssets);
    }
    if (taskId) {
      try {
        const termination = await terminateCloudTaskAndRefund(
          taskId,
          'failed',
          `AI 矢量设计失败：${message}`,
        );
        if (chargedCredits > 0 && !termination.refunded) {
          const persistedTask = await getCloudTaskForUser(taskId, userId);
          if (persistedTask?.creditStatus !== 'refunded') {
            throw new Error('数据库未确认积分退款');
          }
        }
      } catch (settlementError) {
        console.error('[vector-design] task settlement failed', {
          taskId,
          error: settlementError instanceof Error
            ? settlementError.message
            : String(settlementError),
        });
        return NextResponse.json({
          success: false,
          taskId,
          error: '任务失败且积分结算状态未确认，请联系管理员',
        }, { status: 503 });
      }
    }
    const status = error instanceof VectorDesignIdempotencyConflictError
      ? 409
      : error instanceof VectorRequestError
        ? error.status
        : 500;
    return NextResponse.json(
      { success: false, taskId: taskId || undefined, error: message || 'AI 矢量设计失败' },
      { status },
    );
  }
}
