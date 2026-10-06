import { NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile } from '@/lib/api-compatibility';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';
import { UnsupportedTransparentBackgroundError } from '@/lib/image-generation-output';
import { adjustRequestForProfile, parseResponseForProfile, type ApiCompatProfile } from '@/lib/api-compatibility';
import { verifyGeneratedImageAlphaSet } from '@/lib/generated-image-alpha';
import { normalizeImageOutputRequestBody } from '@/lib/image-generation-output';
import { setTimeout as delay } from 'node:timers/promises';

export interface UniversalImage { id: string; url: string; prompt: string; originalPrompt: string; model: string }

export interface UniversalGenerateRequest {
  [key: string]: unknown;
  prompt: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  quality?: string;
  aspectRatio?: string;
  n?: number;
  referenceImageUrl?: string;
  userId?: string;
  projectId?: unknown;
  providerId?: string;
  background?: string;
  backgroundMode?: string;
  output_format?: string;
  outputFormat?: string;
}

/** Original non-document transport and response contract. */
export async function executePrivateUniversalGeneration(body: UniversalGenerateRequest): Promise<NextResponse> {
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      prompt,
      model,
      quality = 'standard',
      aspectRatio = '1:1',
      n = 1,
      referenceImageUrl,
      providerId,
    } = body;

    // Content safety check
    const safetyResult = checkPromptSafety(prompt || '');
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    const rawResolvedModel = model.includes('::') ? model.split('::').slice(1).join('::') : model;
    const { apiModelName: resolvedModel } = normalizeModelForApi(rawResolvedModel);
    if (resolvedModel !== rawResolvedModel) {
      console.log(`[universal-generate] Model normalized: ${rawResolvedModel} → ${resolvedModel}`);
    }
    let normalizedBody: Record<string, unknown>;
    try {
      normalizedBody = normalizeImageOutputRequestBody(
        body as unknown as Record<string, unknown>,
        resolvedModel,
      );
    } catch (error) {
      if (error instanceof UnsupportedTransparentBackgroundError) {
        return NextResponse.json({
          success: false,
          code: 'TRANSPARENT_BACKGROUND_UNSUPPORTED',
          error: error.message,
          retryable: false,
        }, { status: 400 });
      }
      throw error;
    }
    // 优先使用 providerId 精确匹配提供商
    let provider = providerId ? await findProviderById(providerId) : null;
    if (!provider) {
      provider = await findProviderForModel(resolvedModel, 'image');
    }
    const apiKey = provider?.apiKey;
    const baseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');

    if (!prompt || !resolvedModel || !apiKey || !baseUrl) {
      return NextResponse.json({
        success: false,
        error: '缺少可用的后台图像模型配置',
      }, { status: 400 });
    }

    // 解析兼容性配置
    const profile = resolveCompatProfile(provider);

    // 构建请求体 - 先构建原始请求，再用兼容性层调整
    const rawBody: Record<string, unknown> = {
      model: resolvedModel,
      prompt,
      size: aspectRatio,
      n,
      background: normalizedBody.background,
      output_format: normalizedBody.output_format,
    };
    if (quality && quality !== 'standard') {
      rawBody.quality = quality;
    }
    if (referenceImageUrl) {
      rawBody.image_urls = [referenceImageUrl];
    }

    const { body: requestBody, endpoint } = adjustRequestForProfile(rawBody, profile, {
      hasImage: !!referenceImageUrl,
    });

    console.log(`[Universal API] 请求: model=${resolvedModel}, baseUrl=${baseUrl}, endpoint=${endpoint}, profile=${profile.id}`);

    // 1. 提交生成任务
    const submitResponse = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const submitData = await submitResponse.json();

    // 检查提交是否成功
    if (submitData.error) {
      const rawMsg = submitData.error.message || JSON.stringify(submitData.error);
      // 清理常见 API 错误
      let cleanMsg = rawMsg;
      if (rawMsg.includes('ratio or price') || rawMsg.includes('not configured')) {
        cleanMsg = '当前模型暂不可用，请切换其他模型或联系管理员配置';
      } else if (rawMsg.includes('Insufficient balance') || rawMsg.includes('insufficient')) {
        cleanMsg = 'API 余额不足，请联系管理员充值';
      } else if (rawMsg.includes('Rate limit') || rawMsg.includes('rate_limit') || rawMsg.includes('Too many requests')) {
        cleanMsg = '请求过于频繁，请稍后再试';
      }
      return NextResponse.json({
        success: false,
        error: cleanMsg,
      }, { status: 400 });
    }

    // 使用兼容性层解析响应
    const parsed = parseResponseForProfile(submitData as Record<string, unknown>, profile);

    if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
      // 直接模式：API 返回了图片数据
      const images = buildUniversalImages(parsed.directImageUrls, { model: resolvedModel, prompt, n }, `${resolvedModel}-${Date.now()}`);
      const transparentResult = await getTransparentResultMetadata(
        parsed.directImageUrls,
        normalizedBody.background,
      );
      return NextResponse.json({ success: true, images, ...transparentResult });
    }

    // 异步任务模式
    const taskId = parsed.taskIds.length > 0 ? parsed.taskIds[0] : undefined;

    if (!taskId) {
      return NextResponse.json({
        success: false,
        error: '未能获取任务ID或图片数据',
        rawResponse: JSON.stringify(submitData).slice(0, 500),
      }, { status: 400 });
    }

    // 2. 异步轮询任务状态
    console.log(`[Universal API] 任务已提交: ${taskId}`);

    const maxPolls = 200; // 兼容需要2分钟以上的慢速API
    for (let i = 0; i < maxPolls; i++) {
      const interval = i <= 2 ? 800 : i <= 5 ? 1000 : i < 10 ? 1500 : 2000;
      await new Promise(resolve => setTimeout(resolve, interval));

      try {
        const statusResponse = await fetch(
          `${baseUrl}/tasks/${taskId}?language=zh`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        const statusData = await statusResponse.json();

        const taskInfo = statusData.data || statusData;
        const status = taskInfo.status;

        if (status === 'completed') {
          const result = taskInfo.result || taskInfo;
          const imagesList = result.images || [];

          const imageUrls = imagesList.map((img: Record<string, unknown>): string => {
            let url = '';
            if (Array.isArray(img.url)) {
              url = img.url[0] || '';
            } else if (typeof img.url === 'string') {
              url = img.url;
            } else if (img.b64_json) {
              url = `data:image/png;base64,${img.b64_json}`;
            }

            return url;
          }).filter((url: string) => url);
          const images = buildUniversalImages(imageUrls, { model: resolvedModel, prompt, n }, `${resolvedModel}-${Date.now()}`);

          if (images.length > 0) {
            console.log(`[Universal API] 任务完成: ${taskId}, 图片数: ${images.length}`);
            const transparentResult = await getTransparentResultMetadata(
              images.map((image: { url: string }) => image.url),
              normalizedBody.background,
            );
            return NextResponse.json({ success: true, images, ...transparentResult });
          }

          return NextResponse.json({
            success: false,
            error: '任务完成但未获取到图片URL',
          }, { status: 500 });
        }

        if (status === 'failed') {
          const rawMsg = taskInfo.error?.message || '任务执行失败';
          // 清理常见 API 错误
          let cleanMsg = rawMsg;
          if (rawMsg.includes('ratio or price') || rawMsg.includes('not configured')) {
            cleanMsg = '当前模型暂不可用，请切换其他模型或联系管理员配置';
          } else if (rawMsg.includes('Insufficient balance') || rawMsg.includes('insufficient')) {
            cleanMsg = 'API 余额不足，请联系管理员充值';
          }
          return NextResponse.json({
            success: false,
            error: cleanMsg,
          }, { status: 500 });
        }

        // submitted/processing - 继续轮询
        if (i % 5 === 0) {
          console.log(`[Universal API] 轮询 #${i}: status=${status}`);
        }
      } catch (pollError) {
        console.error(`[Universal API] 轮询错误:`, pollError);
      }
    }

    return NextResponse.json({
      success: false,
      error: `${resolvedModel} 生成超时，请稍后重试`,
    }, { status: 408 });

}
export interface UniversalProviderRequest {
  model: string; prompt: string; n: number; quality?: string; aspectRatio?: string;
  background?: unknown; output_format?: unknown; referenceImageUrl?: string;
}
export interface UniversalProviderTarget { baseUrl: string; profile: ApiCompatProfile }
export type UniversalCheckpoint = { kind: 'direct'; urls: string[] } | { kind: 'remote'; taskIds: string[]; outputs: string[][] };
export class UniversalProviderFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code === 'UNIVERSAL_PROVIDER_REJECTED' ? '供应商明确拒绝生成请求' : '供应商任务执行失败'); }
}
export class UniversalSubmissionUncertain extends Error {
  constructor() { super('供应商提交结果尚未确认，请核对原任务或取消，勿重复生成'); }
}
export async function getTransparentResultMetadata(imageUrls: string[], background: unknown, imageInputs?: Array<Buffer | string>): Promise<Record<string, unknown>> {
  if (background !== 'transparent') return {};
  const alphaVerification = await verifyGeneratedImageAlphaSet(imageInputs || imageUrls);
  alphaVerification.items = alphaVerification.items.map((item, index) => ({ ...item, imageUrl: imageUrls[index] }));
  if (!['opaque', 'invalid'].includes(alphaVerification.status)) return { alphaVerification };
  return { alphaVerification,
    warning: { code: 'TRANSPARENT_RESULT_NOT_ALPHA', message: '模型未返回真实透明背景，原始结果已保留。可在图片工具栏中主动选择“移除背景”。' },
    nextAction: { type: 'remove-background', requiresConfirmation: true, separatelyBilled: true } };
}
export function buildUniversalImages(urls: string[], request: UniversalProviderRequest, identity: string): UniversalImage[] {
  return urls.map((url, index) => ({ id: `${identity}-${index}`, url, prompt: request.prompt, originalPrompt: request.prompt, model: request.model }));
}
export async function submitUniversalGeneration(input: {
  request: UniversalProviderRequest; target: UniversalProviderTarget; apiKey: string; signal: AbortSignal;
  idempotencyKey: string; beforeIO: () => Promise<void>;
}): Promise<UniversalCheckpoint> {
  const normalizedBody = normalizeImageOutputRequestBody({ ...input.request }, input.request.model);
  const rawBody: Record<string, unknown> = { model: input.request.model, prompt: input.request.prompt,
    n: input.request.n, size: input.request.aspectRatio || '1:1',
    background: normalizedBody.background, output_format: normalizedBody.output_format };
  if (input.request.quality && input.request.quality !== 'standard') rawBody.quality = input.request.quality;
  if (input.request.referenceImageUrl) rawBody.image_urls = [input.request.referenceImageUrl];
  const { body, endpoint } = adjustRequestForProfile(rawBody, input.target.profile, { hasImage: !!input.request.referenceImageUrl });
  const init: RequestInit = { method: 'POST', headers: { Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(body), signal: input.signal };
  await input.beforeIO();
  let response = await fetch(`${input.target.baseUrl}${endpoint}`, init);
  if ([404, 405].includes(response.status) && !input.target.baseUrl.endsWith('/v1')) {
    await response.body?.cancel();
    await input.beforeIO();
    response = await fetch(`${input.target.baseUrl}/v1${endpoint}`, init);
  }
  if (response.status >= 400 && response.status < 500) throw new UniversalProviderFailure(400, 'UNIVERSAL_PROVIDER_REJECTED');
  if (!response.ok) throw new UniversalSubmissionUncertain();
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UniversalSubmissionUncertain();
  if ((data as Record<string, unknown>).error) throw new UniversalProviderFailure(400, 'UNIVERSAL_PROVIDER_REJECTED');
  const parsed = parseResponseForProfile(data as Record<string, unknown>, input.target.profile);
  if (parsed.directImageUrls.length) return { kind: 'direct', urls: parsed.directImageUrls };
  if (parsed.taskIds.length) return { kind: 'remote', taskIds: parsed.taskIds, outputs: [] };
  throw new UniversalSubmissionUncertain();
}

export async function pollUniversalGeneration(input: {
  checkpoint: Extract<UniversalCheckpoint, { kind: 'remote' }>; target: UniversalProviderTarget; apiKey: string;
  signal: AbortSignal; beforeIO: () => Promise<void>;
  onCheckpoint: (checkpoint: UniversalCheckpoint) => Promise<void>;
}): Promise<string[]> {
  const checkpoint = structuredClone(input.checkpoint);
  for (let index = checkpoint.outputs.length; index < checkpoint.taskIds.length; index++) {
    for (let poll = 0; poll < 200; poll++) {
      if (poll) await delay(poll <= 2 ? 800 : poll <= 5 ? 1000 : poll < 10 ? 1500 : 2000, undefined, { signal: input.signal });
      await input.beforeIO();
      const response = await fetch(`${input.target.baseUrl}/tasks/${encodeURIComponent(checkpoint.taskIds[index])}?language=zh`,
        { headers: { Authorization: `Bearer ${input.apiKey}` }, signal: input.signal });
      if (!response.ok) continue;
      const data = await response.json() as Record<string, unknown>;
      const info = (data.data || data) as Record<string, unknown>;
      if (info.status === 'failed') throw new UniversalProviderFailure(500, 'UNIVERSAL_REMOTE_FAILED');
      if (info.status !== 'completed') continue;
      const result = (info.result || info) as Record<string, unknown>;
      const urls = (Array.isArray(result.images) ? result.images : []).flatMap((image: unknown): string[] => {
        if (!image || typeof image !== 'object') return [];
        const item = image as Record<string, unknown>;
        const url = Array.isArray(item.url) ? item.url[0] : item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
        return typeof url === 'string' && url ? [url] : [];
      });
      if (!urls.length) throw new UniversalProviderFailure(500, 'UNIVERSAL_REMOTE_EMPTY');
      checkpoint.outputs.push(urls);
      await input.onCheckpoint(checkpoint);
      break;
    }
    if (checkpoint.outputs.length !== index + 1) throw new UniversalProviderFailure(408, 'UNIVERSAL_REMOTE_TIMEOUT');
  }
  return checkpoint.outputs.flat();
}
