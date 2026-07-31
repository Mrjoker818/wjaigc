import { after, NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { findProviderForModel } from '@/lib/server-api-config';
import { getRequestUser } from '@/lib/api-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import {
  buildAspectRecomposePrompt,
  isAspectRecomposeRatio,
  validateAspectRatioDimensions,
  type AspectRecomposeAnalysis,
  type AspectRecomposeRatio,
} from '@/lib/aspect-recompose';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const maxRetries = 1;

function makeTaskId(): string {
  return `aspect-recompose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asAnalysis(value: unknown): AspectRecomposeAnalysis {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const arrayOfStrings = (key: string): string[] => Array.isArray(item[key]) ? item[key].filter((x): x is string => typeof x === 'string') : [];
  return {
    summary: typeof item.summary === 'string' ? item.summary : '',
    protectedText: arrayOfStrings('protectedText'),
    protectedElements: arrayOfStrings('protectedElements'),
    layout: typeof item.layout === 'string' ? item.layout : '',
  };
}

async function analyzeImage(baseUrl: string, imageUrl: string, model?: string, providerId?: string): Promise<AspectRecomposeAnalysis> {
  const response = await fetch(`${baseUrl}/api/vision-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, model, providerId }),
    signal: AbortSignal.timeout(100_000),
  }).catch(() => null);
  if (!response?.ok) {
    return { summary: '保留参考图中可见的全部主体、文字和设计信息', protectedText: [], protectedElements: [], layout: '' };
  }
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  const vision = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
  const json = (vision.zh_json && typeof vision.zh_json === 'object' ? vision.zh_json : {}) as Record<string, unknown>;
  return asAnalysis({
    summary: vision.zh && typeof vision.zh === 'object' ? (vision.zh as Record<string, unknown>).analysis : vision.analysis,
    protectedText: [json['文字内容'], json['文字'], vision.text].filter((x): x is string => typeof x === 'string'),
    protectedElements: [json['主体'], json['细节外观'], json['环境背景']].filter((x): x is string => typeof x === 'string'),
    layout: [json['构图'], json['环境背景']].filter((x): x is string => typeof x === 'string').join('；'),
  });
}

async function pollGeneratedImage(baseUrl: string, generatedTaskId: string, model: string, providerId?: string): Promise<string> {
  const deadline = Date.now() + 9 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/poll-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: generatedTaskId, model, providerId }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (data.status === 'completed') {
      const nested = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {};
      const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : typeof nested.imageUrl === 'string' ? nested.imageUrl : '';
      if (imageUrl) return imageUrl;
      throw new Error('图像模型已完成，但没有返回结果图片');
    }
    if (data.status === 'failed' || data.status === 'cancelled' || data.success === false) {
      throw new Error(typeof data.error === 'string' ? data.error : '图像模型重组失败');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('图像重组超时，请稍后重试');
}

async function generateRecomposedImage(baseUrl: string, sourceUrl: string, targetRatio: AspectRecomposeRatio, prompt: string, model?: string, providerId?: string): Promise<{ imageUrl: string; validation: ReturnType<typeof validateAspectRatioDimensions> }> {
  const provider = model ? await findProviderForModel(model, 'image') : null;
  const resolvedModel = model || provider?.selectedModels?.[0];
  if (!resolvedModel) throw new Error('未找到可用的图像模型，请先在管理员面板配置');

  const response = await fetchWithV1Retry(baseUrl, '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      aspectRatio: targetRatio,
      model: resolvedModel,
      providerId: providerId || provider?.id,
      referenceImages: [sourceUrl],
      referenceMode: 'reference',
      outputCount: 1,
      quality: '1K',
      strength: 85,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`图像重组提交失败：${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  let imageUrl = Array.isArray(data.imageUrls) && typeof data.imageUrls[0] === 'string' ? data.imageUrls[0] as string : typeof data.imageUrl === 'string' ? data.imageUrl : '';
  if (!imageUrl) {
    const generatedTaskId = Array.isArray(data.taskIds) && typeof data.taskIds[0] === 'string' ? data.taskIds[0] as string : typeof data.taskId === 'string' ? data.taskId : '';
    if (!generatedTaskId) throw new Error('图像模型不支持可识别的图生图返回协议');
    imageUrl = await pollGeneratedImage(baseUrl, generatedTaskId, resolvedModel, providerId || provider?.id);
  }
  const buffer = await fetchImageBuffer(imageUrl);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('重组结果无法读取像素尺寸');
  const validation = validateAspectRatioDimensions(metadata.width, metadata.height, targetRatio);
  return { imageUrl, validation };
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const targetRatio = typeof body.targetRatio === 'string' ? body.targetRatio : '';
  if (!imageUrl) return NextResponse.json({ success: false, error: '缺少原图地址' }, { status: 400 });
  if (!isAspectRecomposeRatio(targetRatio)) return NextResponse.json({ success: false, error: '目标比例无效，请手动选择支持的比例' }, { status: 400 });

  const taskId = makeTaskId();
  const baseUrl = request.nextUrl.origin;
  registerTask(taskId, 'aspect-recompose', '横竖智能重组', user?.user.id);
  updateTaskProgress(taskId, { status: 'processing', progress: 5, label: '正在分析原图结构...' });

  after(async () => {
    try {
      const model = typeof body.model === 'string' ? body.model : undefined;
      const providerId = typeof body.providerId === 'string' ? body.providerId : undefined;
      const analysis = await analyzeImage(baseUrl, imageUrl, model, providerId);
      updateTaskProgress(taskId, { progress: 25, label: '正在重组元素与版式...' });
      const firstPrompt = buildAspectRecomposePrompt({ targetRatio, analysis });
      let generated = await generateRecomposedImage(baseUrl, imageUrl, targetRatio, firstPrompt, model, providerId);
      let retryCount = 0;
      if (!generated.validation.valid) {
        retryCount = maxRetries;
        updateTaskProgress(taskId, { progress: 70, label: '比例校验未通过，正在修正重组...' });
        const retryPrompt = buildAspectRecomposePrompt({
          targetRatio,
          analysis,
          retryFeedback: `上次输出比例误差为 ${(generated.validation.error * 100).toFixed(2)}%，必须严格输出 ${targetRatio}`,
        });
        generated = await generateRecomposedImage(baseUrl, imageUrl, targetRatio, retryPrompt, model, providerId);
      }
      if (!generated.validation.valid) throw new Error(`重组结果未达到 ${targetRatio} 比例要求`);
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        result: {
          imageUrl: generated.imageUrl,
          targetRatio,
          analysis,
          validation: generated.validation,
          retryCount,
          requiresManualReview: analysis.protectedText.length > 0,
        },
      });
    } catch (error) {
      updateTaskProgress(taskId, { status: 'failed', progress: 0, error: error instanceof Error ? error.message : String(error) });
    }
  });

  return NextResponse.json({ success: true, taskId, status: 'processing', targetRatio, maxRetries });
}
