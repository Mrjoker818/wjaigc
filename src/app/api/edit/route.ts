import { NextRequest, NextResponse, after } from 'next/server';
import sharp from 'sharp';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl, getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import type { ApiProvider } from '@/lib/universal-api-types';
import { getEditTask, deleteEditTask, setEditTask, updateTaskStage, failEditTask } from '@/lib/edit-task-store';
import type { EditTask } from '@/lib/edit-task-store';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { translateApiError } from '@/lib/api-error-translate';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, isEditsEndpointRejected, stripEditsOnlyFields, extractImageUrl } from '@/lib/api-compatibility';

// 允许大请求体（base64图片可能很大，50MB限制）
export const runtime = 'nodejs';
export const maxDuration = 600;

// ============================================================
// 本地任务存储已迁移到 @/lib/edit-task-store（避免 HMR 隔离）
// ============================================================
interface EditTaskResult {
  success: boolean;
  image?: { url: string; revisedPrompt?: string };
  images?: Array<{ url: string; revisedPrompt?: string }>;
  model?: string;
  provider?: string;
  llmInstruction?: string;
  editRegions?: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }>;
  autoMaskGenerated?: boolean;
  error?: string;
  networkError?: boolean;
  requiresApiKey?: boolean;
  status?: number;
}

// 重新导出供 poll-task 使用（保持兼容）
export { getEditTask, deleteEditTask };

/** 本地便捷：失败任务 */
function failTask(taskId: string, error: string, networkError = false) {
  failEditTask(taskId, error, networkError);
  // ★ 同步更新任务注册中心
  updateTaskProgress(taskId, { status: 'failed', error });
}

// 支持编辑的模型列表（用于降级静态列表）
export const EDITABLE_MODELS = [
  'gpt-image-2',
  'dall-e-3',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
];

/** 将图片 URL/data 转换为 Buffer + mimeType */
async function resolveImageToBuffer(imageSrc: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageSrc.startsWith('data:')) {
    const commaIndex = imageSrc.indexOf(',');
    const header = imageSrc.substring(0, commaIndex);
    const base64Data = imageSrc.substring(commaIndex + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    return { buffer: Buffer.from(base64Data, 'base64'), mimeType: mimeMatch?.[1] || 'image/png' };
  } else if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
    const response = await fetch(imageSrc, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type');
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType || 'image/png' };
  } else if (imageSrc.startsWith('/')) {
    const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const domainBase = domain.replace(/\/+$/, '');
    const base = domainBase.startsWith('http') ? domainBase : (domainBase ? `https://${domainBase}` : '');
    const fullUrl = base ? `${base}${imageSrc}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageSrc}`;
    const response = await fetch(fullUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type');
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType || 'image/png' };
  } else {
    return { buffer: Buffer.from(imageSrc, 'base64'), mimeType: 'image/png' };
  }
}

/**
 * 判断模型是否为图像生成/编辑类模型（非纯聊天模型）
 * 第三方代理上同一个模型可能有不同命名，需要宽松匹配
 */
function isImageEditModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('image') ||
    id.includes('dall-e') ||
    id.includes('gpt-image') ||
    id === 'gpt-image-2'
  );
}

/**
 * 解析 SSE 流式响应，拼接所有 delta content 为完整 JSON 结构
 * 兼容第三方代理忽略 stream:false 强制流式返回的情况
 */
function parseSSEToJSON(sseText: string): Record<string, unknown> {
  const lines = sseText.split('\n');
  let fullContent = '';
  let lastChunk: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;

    try {
      const chunk = JSON.parse(trimmed.slice(6));
      lastChunk = chunk;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content && typeof delta.content === 'string') {
        fullContent += delta.content;
      }
      // 检查多模态内容（部分代理直接在 delta 中返回图片）
      if (delta?.content && Array.isArray(delta.content)) {
        for (const part of delta.content) {
          if (typeof part === 'string') fullContent += part;
          else if (typeof part === 'object' && part !== null) fullContent += JSON.stringify(part);
        }
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  // 构建与标准 chat/completions 非流式响应一致的 JSON 结构
  if (lastChunk) {
    return {
      ...lastChunk,
      choices: [{
        ...((lastChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>)?.[0],
        message: { role: 'assistant', content: fullContent || '' },
        finish_reason: 'stop',
      }],
    };
  }

  return { choices: [{ message: { role: 'assistant', content: fullContent } }] };
}

/**
 * 从第三方 API 响应中提取图片 URL/base64
 * 支持多种返回格式，确保兼容各种代理
 */
function extractImageFromResponse(responseData: Record<string, unknown>): string {
  // 格式1: OpenAI images 标准格式 { data: [{ url, b64_json }] }
  const data = responseData.data as Array<Record<string, unknown>> | undefined;
  if (data && Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first?.b64_json) {
      return `data:image/png;base64,${first.b64_json}`;
    }
    if (first?.url) {
      return first.url as string;
    }
  }

  // 格式2: chat/completions 多模态响应 - content 是数组
  const choices = responseData.choices as Array<Record<string, unknown>> | undefined;
  if (choices && Array.isArray(choices) && choices.length > 0) {
    const message = choices[0].message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content;

      // content 是数组（多模态响应）
      if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'object' && part !== null) {
            // { type: 'image_url', image_url: { url: 'data:...' } }
            if (part.type === 'image_url' && (part as Record<string, unknown>).image_url) {
              const imageUrl = (part as Record<string, Record<string, string>>).image_url;
              if (imageUrl?.url) return imageUrl.url;
            }
            // { type: 'image', source: { data: '...' } } (Anthropic 风格)
            if (part.type === 'image' && (part as Record<string, unknown>).source) {
              const source = (part as Record<string, Record<string, string>>).source;
              if (source?.data) return `data:${source.media_type || 'image/png'};base64,${source.data}`;
            }
            // inline_data 格式
            if ((part as Record<string, unknown>).inline_data) {
              const inlineData = (part as Record<string, Record<string, string>>).inline_data;
              if (inlineData?.data) return `data:${inlineData.mime_type || 'image/png'};base64,${inlineData.data}`;
            }
          }
        }
      }

      // content 是字符串
      if (typeof content === 'string') {
        // 包含 data:image base64
        const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
        if (base64Match) return base64Match[0];

        // 包含 markdown 图片链接
        const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        if (mdMatch) return mdMatch[1];

        // 包含纯 URL
        const urlMatch = content.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)[^\s"'<>]*)/i);
        if (urlMatch) return urlMatch[1];
      }
    }
  }

  // 格式3: 直接返回 url 字段
  if (responseData.url && typeof responseData.url === 'string') {
    return responseData.url;
  }

  // 格式4: 直接返回 b64_json 字段
  if (responseData.b64_json && typeof responseData.b64_json === 'string') {
    return `data:image/png;base64,${responseData.b64_json}`;
  }

  return '';
}

/** 从 API 响应中提取所有图片（支持 images/edits 返回多张） */
function extractAllImagesFromResponse(responseData: Record<string, unknown>, fallbackPrompt: string): Array<{ url: string; revisedPrompt: string }> {
  const images: Array<{ url: string; revisedPrompt: string }> = [];

  // 格式1: OpenAI images/edits 标准响应 { data: [{ url, b64_json, revised_prompt }] }
  if (responseData.data && Array.isArray(responseData.data)) {
    for (const item of responseData.data as Array<Record<string, unknown>>) {
      const url = item.url as string || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
      if (url) {
        images.push({ url, revisedPrompt: (item.revised_prompt as string) || fallbackPrompt });
      }
    }
  }

  // 格式2: 单张图片响应
  if (images.length === 0) {
    const singleUrl = extractImageFromResponse(responseData);
    if (singleUrl) {
      images.push({ url: singleUrl, revisedPrompt: fallbackPrompt });
    }
  }

  return images;
}

// ============================================================
// POST: 执行语言修图
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const {
      image,         // base64 data URL（客户端已转换）
      prompt,        // 编辑指令（自然语言）
      mask,          // 可选，mask图片 base64（涂抹区域，所有模型均支持，AI理解蒙版语义）
      size = '1:1',  // 画面比例或像素尺寸
      quality = 'high',
      apiKey,        // 可选，用户提供的 API Key
      model = 'gpt-image-2',
      providerId,    // 管理员系统提供商ID
      count = 1,     // 生图数量
      llmModelId,    // 可选，LLM辅助模型ID
      llmProviderId, // 可选，LLM辅助模型提供商ID
      referenceImages, // 可选，参考图URL数组（多图模式）
    } = await request.json();

    if (!image) {
      return NextResponse.json({ success: false, error: '请先添加图片' }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ success: false, error: '请输入编辑指令' }, { status: 400 });
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    // ========== 1. 获取 API 凭证（与 /api/generate 一致） ==========
    let effectiveApiKey = apiKey || '';
    let effectiveBaseUrl = '';
    let imageProvider: ApiProvider | null = null; // 保留 provider 对象用于 API 兼容层

    if (!effectiveApiKey && providerId) {
      try {
        imageProvider = await findProviderById(providerId);
        if (imageProvider?.apiKey) {
          effectiveApiKey = imageProvider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(imageProvider.baseUrl || '');
        }
      } catch { /* 忽略 */ }
    }

    if (!effectiveApiKey) {
      try {
        imageProvider = await findProviderForModel(model);
        if (imageProvider?.apiKey) {
          effectiveApiKey = imageProvider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(imageProvider.baseUrl || '');
        }
      } catch { /* 忽略 */ }
    }

    if (!effectiveApiKey) {
      return NextResponse.json({
        success: false,
        error: '需要在管理员系统中配置 API Key',
        requiresApiKey: true,
      }, { status: 400 });
    }

    // ========== 1.5 创建异步任务（提交+轮询模式，避免CDN/FaaS代理超时） ==========
    const taskId = `edit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    setEditTask(taskId, { id: taskId, status: 'processing', progress: 0, stage: '初始化', createdAt: Date.now() });
    // ★ 注册到统一任务中心（SSE推送 + 取消支持）
    registerTask(taskId, 'edit', '语言修图');
    console.info(`[edit] ★ taskId=${taskId} 创建成功, model=${model}, providerId=${providerId || 'auto'}`);

    // 后台异步执行编辑流程（5分钟全局超时兜底）
    // ★ 使用 after() 确保 Next.js 不会在响应返回后终止 IIFE
    const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
    after(async () => {
      // 全局超时：确保 IIFE 不会无限运行
      const timeoutId = setTimeout(() => {
        const task = getEditTask(taskId);
        if (task && task.status === 'processing') {
          failTask(taskId, '编辑超时，请稍后重试');
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      try {
        // ★ 检查任务是否已被取消
        if (isTaskCancelled(taskId)) {
          failTask(taskId, '任务已被取消');
          return;
        }
        // ========== 2. 解析原图为 Buffer ==========
        let imageBuffer: Buffer;
        let mimeType = 'image/png';

    if (image.startsWith('data:')) {
      const commaIndex = image.indexOf(',');
      const header = image.substring(0, commaIndex);
      const base64Data = image.substring(commaIndex + 1);
      const mimeMatch = header.match(/data:([^;]+)/);
      if (mimeMatch) mimeType = mimeMatch[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (image.startsWith('http://') || image.startsWith('https://')) {
      try {
        const response = await fetch(image);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type');
        if (contentType) mimeType = contentType;
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        failTask(taskId, `无法下载图片: ${errMsg}`);
        return;
      }
    } else if (image.startsWith('/')) {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      const domainBase = domain.replace(/\/+$/, '');
      const base = domainBase.startsWith('http') ? domainBase : (domainBase ? `https://${domainBase}` : '');
      const fullUrl = base ? `${base}${image}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${image}`;
      try {
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type');
        if (contentType) mimeType = contentType;
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        failTask(taskId, `无法下载图片: ${errMsg}`);
        return;
      }
    } else {
      imageBuffer = Buffer.from(image, 'base64');
    }

    // ========== 3. 解析 mask ==========
    let maskBuffer: Buffer | undefined;
    if (mask) {
      if (mask.startsWith('data:')) {
        maskBuffer = Buffer.from(mask.split(',')[1], 'base64');
      } else if (mask.startsWith('http://') || mask.startsWith('https://')) {
        try {
          const response = await fetch(mask);
          if (!response.ok) throw new Error(`Failed to fetch mask: ${response.status}`);
          maskBuffer = Buffer.from(await response.arrayBuffer());
        } catch (fetchError: unknown) {
          const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
          failTask(taskId, `无法下载mask: ${errMsg}`);
          return;
        }
      } else {
        maskBuffer = Buffer.from(mask, 'base64');
      }
    }

    // ========== 3.5 画面比例拓展提示 ==========
    // 语言修图：不裁切原图、不加黑边，而是通过提示词引导 AI 在原图基础上自然拓展画面，
    // 生成与原图风格和内容连贯的新区域
    let aspectRatioExtendHint = '';
    if (size && size !== '1:1') {
      try {
        const sharpImg = sharp(imageBuffer);
        const meta = await sharpImg.metadata();
        const origW = meta.width || 1;
        const origH = meta.height || 1;
        const origRatio = origW / origH;

        // 解析目标比例
        const parts = size.split(':').map(Number);
        const targetRatio = parts.length === 2 && parts[0] > 0 && parts[1] > 0
          ? parts[0] / parts[1] : origRatio;

        // 比例差异超过 5% 时，需要拓展画面
        if (Math.abs(origRatio - targetRatio) / Math.max(origRatio, targetRatio) > 0.05) {
          if (origRatio > targetRatio) {
            // 原图更宽 → 目标更高，AI 需要在上下拓展画面
            aspectRatioExtendHint = 'The output aspect ratio is taller than the original image. Naturally extend the scene by adding content above and below, maintaining the original image content in the center and generating coherent new content for the extended areas that matches the original style, lighting, and scene.';
          } else {
            // 原图更高 → 目标更宽，AI 需要在左右拓展画面
            aspectRatioExtendHint = 'The output aspect ratio is wider than the original image. Naturally extend the scene by adding content to the left and right, maintaining the original image content in the center and generating coherent new content for the extended areas that matches the original style, lighting, and scene.';
          }
          console.log(`[edit] Aspect ratio change detected: orig=${origRatio.toFixed(2)} target=${targetRatio.toFixed(2)}, will prompt AI to extend scene`);
        }
      } catch (ratioErr) {
        // 比例检测失败不影响后续流程
        console.warn('[edit] Failed to detect aspect ratio change, skipping extend hint:', ratioErr);
      }
    }

    // ========== 4. 判断调用路径 ==========
    // ★ 不针对特定模型/供应商判断路径，统一优先尝试 images.edit
    // 如果提供商不支持 images.edit，请求会失败并自动 fallback 到其他路径

    // ========== 5. LLM 协作：分析原图 + 优化 prompt + 蒙版语义 ==========
    // 核心思路：LLM 是"大脑"理解意图，图像模型是"手"执行修改
    // 协作流程：LLM 分析原图内容 → 理解用户意图 → 结合蒙版区域 → 生成精准编辑指令
    // ★ 优化：如果 prompt 已经足够详细（>40字符），跳过 LLM 协作以节省时间
    let effectivePrompt = prompt;
    let llmInstruction = prompt; // LLM 生成的精准指令，无 LLM 参与时等于原始 prompt
    let llmEditRegions: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }> = []; // LLM 识别的编辑区域
    const llmStartTime = Date.now();

    // ★ 预处理：将前端黑白mask转换为API所需格式（必须在 LLM 协作之前，因为 LLM 也需要看蒙版）
    // 前端发送通用黑白格式（白色=编辑, 黑色=保留）
    // 关键：mask 必须与 image 尺寸完全一致，否则 API 无法正确对齐编辑区域
    let openaiMaskBuffer: Buffer | null = null;
    let maskImageUrl: string | null = null; // 用于非 images.edit 路径的视觉参考
    if (maskBuffer) {
      try {
        // 先获取原图尺寸
        const imageMeta = await sharp(imageBuffer).metadata();
        const imgW = imageMeta.width || 1;
        const imgH = imageMeta.height || 1;

        // ★ 将 mask resize 到与 image 完全一致的尺寸
        const resizedMaskBuffer = await sharp(maskBuffer)
          .resize(imgW, imgH, { fit: 'fill', kernel: 'nearest' })
          .ensureAlpha()
          .raw()
          .toBuffer();

        // 转换为 OpenAI 格式：白色(luminance>128)→透明=编辑, 黑色→不透明=保留
        const converted = Buffer.alloc(imgW * imgH * 4);
        for (let i = 0; i < imgW * imgH; i++) {
          const r = resizedMaskBuffer[i * 4], g = resizedMaskBuffer[i * 4 + 1], b = resizedMaskBuffer[i * 4 + 2];
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luminance > 128) {
            // 白色→透明（编辑区域）
            converted[i * 4] = 0; converted[i * 4 + 1] = 0; converted[i * 4 + 2] = 0; converted[i * 4 + 3] = 0;
          } else {
            // 黑色→不透明（保留区域）
            converted[i * 4] = 255; converted[i * 4 + 1] = 255; converted[i * 4 + 2] = 255; converted[i * 4 + 3] = 255;
          }
        }
        openaiMaskBuffer = await sharp(converted, { raw: { width: imgW, height: imgH, channels: 4 } }).png().toBuffer();
        console.info(`[edit] taskId=${taskId} mask已转换, 尺寸=${imgW}x${imgH}(与原图一致), OpenAI格式=透明编辑`);

        // 同时生成一个带标注的蒙版参考图（红色高亮编辑区域），用于 LLM 协作和非 images.edit 路径的视觉参考
        const annotatedMask = await sharp(maskBuffer)
          .resize(imgW, imgH, { fit: 'fill', kernel: 'nearest' })
          .ensureAlpha()
          .raw()
          .toBuffer();
        // 在蒙版上叠加红色高亮编辑区域，使AI更容易理解
        const highlightedMask = Buffer.alloc(imgW * imgH * 4);
        for (let i = 0; i < imgW * imgH; i++) {
          const r = annotatedMask[i * 4], g = annotatedMask[i * 4 + 1], b = annotatedMask[i * 4 + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 128) {
            // 编辑区域：红色高亮
            highlightedMask[i * 4] = 255; highlightedMask[i * 4 + 1] = 60; highlightedMask[i * 4 + 2] = 60; highlightedMask[i * 4 + 3] = 255;
          } else {
            // 保留区域：深灰
            highlightedMask[i * 4] = 40; highlightedMask[i * 4 + 1] = 40; highlightedMask[i * 4 + 2] = 40; highlightedMask[i * 4 + 3] = 255;
          }
        }
        const highlightedMaskBuf = await sharp(highlightedMask, { raw: { width: imgW, height: imgH, channels: 4 } }).png().toBuffer();
        maskImageUrl = `data:image/png;base64,${highlightedMaskBuf.toString('base64')}`;
      } catch (maskConvErr) {
        console.warn('[edit] mask格式转换失败:', maskConvErr instanceof Error ? maskConvErr.message : maskConvErr);
      }
    }

    // ★ 跳过 LLM 协作的条件：prompt 足够详细（用户自己写了好的 prompt）
    // 短 prompt（如"把背景换成蓝色"）由 LLM 扩展成详细指令价值更大
    // 长 prompt（如详细描述）跳过 LLM 可节省 5-20 秒
    const shouldSkipLlmCollaboration = prompt.length > 80;

    if (shouldSkipLlmCollaboration) {
      console.info(`[edit] taskId=${taskId} 跳过LLM协作 (prompt长度=${prompt.length} > 80), 节省 ${Date.now() - llmStartTime}ms`);
    }

    // ===== 单次 LLM 协作：合并分析+指令生成为1次调用 =====
    if (!shouldSkipLlmCollaboration) {
    try {
      // ★ 检查任务是否已被取消
      if (isTaskCancelled(taskId)) {
        failTask(taskId, '任务已被取消');
        return;
      }
      updateTaskStage(taskId, '分析中');
      console.info(`[edit] taskId=${taskId} 开始LLM协作, prompt="${prompt.substring(0, 60)}..."`);
      // 查找 LLM 提供商：优先使用 llmProviderId，否则查找 chat 类型提供商
      let llmProvider: Awaited<ReturnType<typeof findProviderById>> = null;
      if (llmModelId && llmProviderId) {
        llmProvider = await findProviderById(llmProviderId);
      }
      if (!llmProvider) {
        // fallback: 查找有 chat 能力的提供商
        const allProviders = await getApiProviders();
        const chatProvider = allProviders.find((p: ApiProvider) =>
          p.modelType === 'chat' || (p.selectedModels as string[])?.some((m: string) => m.includes('gemini') || m.includes('gpt'))
        );
        if (chatProvider) llmProvider = chatProvider;
      }
      if (llmProvider) {
        const llmBaseUrl = normalizeApiBaseUrl(llmProvider.baseUrl);
        const llmHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmProvider.apiKey}`,
        };
        const llmModel = (llmProvider.selectedModels as string[])?.[0] || llmProvider.selectedModel || '';

        const collaborationMessages: Array<Record<string, unknown>> = [];
        const contentParts: Array<Record<string, unknown>> = [];

        // 构建多模态消息（原图 + 蒙版参考图 + 参考图）
        const promptText = `You are an expert image editing assistant. Analyze the provided image(s) and generate optimal editing instructions.

TASK: User wants to "${prompt}" the image.
${maskBuffer ? '\nMASK INFO: The user has painted a mask on the image to indicate the SPECIFIC REGION they want to modify. The red-highlighted area in the mask reference image shows where changes should be applied. You MUST focus your editInstruction on modifying ONLY the masked region, keeping everything else unchanged.' : ''}

INSTRUCTIONS:
1. Analyze the original image: describe its content, composition, style, colors, and key elements
2. ${maskBuffer ? 'Analyze the mask: identify what is in the red-highlighted (masked) region that needs to be modified. Describe what content is currently there and what should replace it.' : 'No mask provided - the edit applies to the entire image or the AI should determine the best region.'}
3. ${referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0 ? 'Analyze the reference image(s): describe how they relate to the editing goal and what aspects should be referenced (style, composition, character, etc.)' : 'No reference image provided.'}
4. Generate a detailed editing instruction that will produce the best result for the user's request

OUTPUT FORMAT (respond with ONLY a JSON object, no markdown):
{
  "originalAnalysis": "Brief description of the original image",
  "maskAnalysis": ${maskBuffer ? '"What is in the masked region and what should change there"' : 'null'},
  "referenceAnalysis": ${referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0 ? '"Brief description of reference image aspects to apply"' : 'null'},
  "editInstruction": "Detailed editing instruction optimized for image generation AI${maskBuffer ? ', explicitly describing what to change in the masked region only' : ''}",
  "suggestedRegions": ["optional: regions that should be modified"],
  "autoMaskPrompt": "optional: description of regions to mask for precise editing"
}

Make the editInstruction specific, detailed, and optimized for AI image editing. Include style, composition, and quality guidance.`;

        contentParts.push({ type: 'text', text: promptText });

        // 添加原图到消息
        if (imageBuffer) {
          const imageBase64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
          contentParts.push({
            type: 'image_url',
            image_url: { url: imageBase64, detail: 'high' }
          });
        }

        // ★ 添加蒙版参考图到消息（红色高亮编辑区域，让LLM理解蒙版位置）
        if (maskImageUrl) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: maskImageUrl, detail: 'high' }
          });
        }

        // 添加参考图到消息
        if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
          for (const refImg of referenceImages.slice(0, 3)) {
            try {
              let refBase64: string;
              const refImgUrl = typeof refImg === 'string' ? refImg : refImg?.url || '';
              if (!refImgUrl) continue;
              if (refImgUrl.startsWith('data:')) {
                refBase64 = refImgUrl;
              } else {
                const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
                const refDomainBase = domain.replace(/\/+$/, '');
                const refFullUrl = refImgUrl.startsWith('/')
                  ? `${refDomainBase.startsWith('http') ? refDomainBase : 'https://' + refDomainBase}${refImgUrl}`
                  : refImgUrl;
                const refImgResp = await fetch(refFullUrl);
                const refImgBuf = Buffer.from(await refImgResp.arrayBuffer());
                refBase64 = `data:image/jpeg;base64,${refImgBuf.toString('base64')}`;
              }
              contentParts.push({
                type: 'image_url',
                image_url: { url: refBase64, detail: 'high' }
              });
            } catch (refErr) {
              console.warn('[edit] Failed to load reference image for collaboration:', refErr);
            }
          }
        }

        collaborationMessages.push({ role: 'user', content: contentParts });

        const collabResp = await fetchWithV1Retry(llmBaseUrl, '/chat/completions', {
          method: 'POST',
          headers: llmHeaders,
          body: JSON.stringify({
            model: llmModel,
            messages: collaborationMessages,
            max_tokens: 2000,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(20000),
        });

        // ★ 403 时自动降级到 /responses 端点（部分提供商仅支持 Responses API）
        let actualCollabResp = collabResp;
        if (collabResp.status === 403) {
          const errBody = await collabResp.text().catch(() => '');
          if (errBody.includes('/responses')) {
            console.info(`[edit] LLM协作 /chat/completions 403, 降级到 /responses`);
            const respBody = {
              model: llmModel,
              input: collaborationMessages.map((m: Record<string, unknown>) => ({
                role: (m.role as string) || 'user',
                content: m.content,
              })),
              stream: false,
            };
            actualCollabResp = await fetchWithV1Retry(llmBaseUrl, '/responses', {
              method: 'POST',
              headers: llmHeaders,
              body: JSON.stringify(respBody),
              signal: AbortSignal.timeout(20000),
            });
          }
        }

        if (actualCollabResp.ok) {
          // 兼容 SSE 和非 SSE 响应格式
          const collabText = await actualCollabResp.text();
          let collabData: Record<string, unknown>;
          if (collabText.trimStart().startsWith('data:')) {
            collabData = parseSSEToJSON(collabText);
          } else {
            try {
              collabData = JSON.parse(collabText);
            } catch {
              console.warn('[edit] LLM collaboration response parse failed, skipping LLM enhancement');
              collabData = {};
            }
          }
          const llmResponse = (collabData.choices as Array<Record<string, unknown>>)?.[0]?.message
            ? ((collabData.choices as Array<Record<string, unknown>>)[0].message as Record<string, unknown>).content as string
            : // ★ 兼容 Responses API 格式: output[0].content[0].text
              (collabData.output as Array<Record<string, unknown>>)?.[0]?.content
                ? (((collabData.output as Array<Record<string, unknown>>)[0].content as Array<Record<string, unknown>>)?.[0]?.text as string) || ''
                : '';
          updateTaskStage(taskId, '优化指令中');

          // 尝试解析 JSON 响应
          let parsed: Record<string, unknown> | null = null;
          try {
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          } catch {}

          if (parsed?.editInstruction) {
            effectivePrompt = parsed.editInstruction;
            llmInstruction = parsed.editInstruction;
            if (parsed?.suggestedRegions && Array.isArray(parsed.suggestedRegions)) {
              llmEditRegions = parsed.suggestedRegions.map((r: string) => ({
                label: r,
                bounds: { x: 0, y: 0, width: 100, height: 100 }
              }));
            }
            console.log('[edit] LLM generated edit instruction:', effectivePrompt.substring(0, 100));
          } else {
            // 如果 JSON 解析失败，尝试使用 LLM 原始响应
            const cleanedResponse = llmResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/^[\s\S]*?\{/m, '{').replace(/\}[\s\S]*$/m, '}');
            if (cleanedResponse.length > 20) {
              try {
                const retryParsed = JSON.parse(cleanedResponse);
                if (retryParsed?.editInstruction) {
                  effectivePrompt = retryParsed.editInstruction;
                  llmInstruction = retryParsed.editInstruction;
                }
              } catch {
                if (llmResponse.length > prompt.length) {
                  effectivePrompt = llmResponse.substring(0, 1000);
                  llmInstruction = effectivePrompt;
                }
              }
            } else if (llmResponse.length > prompt.length) {
              effectivePrompt = llmResponse.substring(0, 1000);
              llmInstruction = effectivePrompt;
            }
          }
        } else {
          console.warn('[edit] LLM collaboration request failed:', collabResp.status);
        }
      }
    } catch (llmErr) {
      console.warn('LLM collaboration failed, using original prompt:', llmErr);
    }
    } // end of if (!shouldSkipLlmCollaboration)

    console.info(`[edit] taskId=${taskId} LLM协作阶段耗时=${Date.now() - llmStartTime}ms, effectivePrompt长度=${effectivePrompt.length}`);

    let editInstruction = `Edit this image according to the following instruction: ${effectivePrompt}. Maintain the overall composition and style while making the requested changes.${aspectRatioExtendHint ? ` ${aspectRatioExtendHint}` : ''}${size ? ` Output image size: ${size}.` : ''}${quality ? ` Output quality: ${quality}.` : ''}`;
    // 蒙版语义增强：所有路径统一添加蒙版描述
    if (maskBuffer) {
      editInstruction += ' IMPORTANT: A mask image is provided that indicates the specific area to edit. The mask highlights the region where changes should be applied. You MUST focus your edits on the masked area and keep everything outside the mask unchanged.';
    }

    // ========== 6. 调用 API（全兼容模式） ==========
    // ★ 检查任务是否已被取消
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }
    updateTaskStage(taskId, '编辑中');
    const editStartTime = Date.now();

    // ★ mask 预处理已在 LLM 协作之前完成（openaiMaskBuffer / maskImageUrl 已就绪）

    console.info(`[edit] taskId=${taskId} 开始图像编辑, model=${model}, hasMask=${!!maskBuffer}, count=${count}`);

    // 路径选择策略（通用，不针对任何模型或供应商）：
    // - 有mask时：直接走images/generations（mask作为视觉参考图+prompt语义描述），
    //   因为第三方代理可能不正确转发images.edit的mask参数
    // - 无mask时：优先images.edit → fallback images/generations → chat/completions
    // - 所有路径都在 prompt 中描述蒙版语义（通用增强）
    const skipImagesEdit = !!maskBuffer; // 有mask时跳过images.edit，走视觉参考路径

    // ★ 路径A: images/edits 端点（仅无mask时尝试）
    if (!skipImagesEdit) {
    try {
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('model', model);
        form.append('image', imageBuffer, { filename: 'image.png', contentType: mimeType });
        form.append('prompt', editInstruction);

        // 比例到像素尺寸映射
        const sizeMap: Record<string, string> = {
          '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
          '4:3': '1024x768', '3:4': '768x1024', '2:3': '768x1024', '3:2': '1024x768',
          '1:2': '512x1024', '2:1': '1024x512',
          '1024': '1024x1024', '1536': '1536x1536', '2048': '2048x2048',
        };
        let outputSize = size;
        if (sizeMap[size]) outputSize = sizeMap[size];
        else if (!size.includes('x')) outputSize = `${size}x${size}`;

        form.append('size', outputSize);
        form.append('quality', quality);
        form.append('n', String(Math.min(count, 4)));

        // Node.js 原生 fetch 不能正确流式传输 form-data，
        // 需要将 form 转为 Buffer 发送，确保 boundary 完整传输
        const formBuffer = form.getBuffer();
        const formHeaders = form.getHeaders();

        const editResponse = await fetchWithV1Retry(
          effectiveBaseUrl,
          '/images/edits',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveApiKey}`,
              ...formHeaders,
              'Content-Length': String(formBuffer.length),
            },
            body: formBuffer as unknown as BodyInit,
            signal: AbortSignal.timeout(120000), // ★ 120秒超时（图像编辑耗时长）
          },
        );

        console.info(`[edit] taskId=${taskId} images.edit响应, 状态=${editResponse.status}, 耗时=${Date.now() - editStartTime}ms`);

        if (!editResponse.ok) {
          const errText = await editResponse.text().catch(() => '');
          console.warn(`images.edit failed (${editResponse.status}), falling back to chat/completions: ${errText.substring(0, 200)}`);
        } else {
          const editData = await editResponse.json();
          const images = extractAllImagesFromResponse(editData, effectivePrompt);
          if (images.length > 0) {
            // ★ count > 1 时，如果 API 返回的图片不够，额外并行生成
            if (count > 1 && images.length < count) {
              console.info(`[edit] taskId=${taskId} images.edit返回${images.length}张, 需要额外生成${count - images.length}张`);
              const extraPromises = Array.from({ length: count - images.length }, () => {
                const extraForm = new FormData();
                extraForm.append('model', model);
                extraForm.append('image', imageBuffer, { filename: 'image.png', contentType: mimeType });
                extraForm.append('prompt', editInstruction);
                if (openaiMaskBuffer) {
                  extraForm.append('mask', openaiMaskBuffer, { filename: 'mask.png', contentType: 'image/png' });
                }
                extraForm.append('size', outputSize);
                extraForm.append('quality', quality);
                const extraFormBuffer = extraForm.getBuffer();
                const extraFormHeaders = extraForm.getHeaders();
                return fetchWithV1Retry(effectiveBaseUrl, '/images/edits', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    ...extraFormHeaders,
                    'Content-Length': String(extraFormBuffer.length),
                  },
                  body: extraFormBuffer as unknown as BodyInit,
                  signal: AbortSignal.timeout(120000),
                })
                .then(async r => {
                  if (!r.ok) return null;
                  const d = await r.json();
                  const extra = extractAllImagesFromResponse(d, effectivePrompt);
                  return extra[0] || null;
                })
                .catch(() => null);
              });
              const extraResults = await Promise.all(extraPromises);
              for (const r of extraResults) { if (r) images.push(r); }
            }
            // ★ 更新任务注册中心
            updateTaskProgress(taskId, { status: 'completed', progress: 100 });
            setEditTask(taskId, {
              id: taskId,
              status: 'completed',
              progress: 100,
              stage: '完成',
              result: {
                success: true,
                image: images[0],
                images,
                model,
                provider: 'openai-images-edit',
                llmInstruction,
                editRegions: llmEditRegions,
                autoMaskGenerated: llmEditRegions.length > 0,
              },
              createdAt: getEditTask(taskId)?.createdAt || Date.now(),
              completedAt: Date.now(),
            });
            return;
          }
          }
      } catch (editErr) {
        console.warn('images.edit error, falling back to images/generations:', editErr instanceof Error ? editErr.message : editErr);
      }
    } // end if (!skipImagesEdit)

    // ★ 检查任务是否已被取消（images.edit 之后）
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }

    // 路径B: images/generations 端点
    // - 有mask时：直接走此路径（mask作为视觉参考图+prompt语义描述，通用不针对供应商）
    // - 无mask时：images/edit 失败后 fallback 到此路径
    const compatProfile = resolveCompatProfile(imageProvider);
    // ★ 有mask时强制走images/generations路径，或editEndpoint=/images/generations时走此路径
    const useGenerationsPath = skipImagesEdit || compatProfile.editEndpoint === '/images/generations';
    if (useGenerationsPath) {
      try {
        console.info(`[edit] taskId=${taskId} 使用images/generations路径, 原因: ${skipImagesEdit ? '有mask走视觉参考' : 'editEndpoint=/images/generations'}, model=${model}`);

        // 先将原图保存为可访问的 URL（images/generations 需要 URL，不支持 base64）
        let imageUrlForApi = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        // 如果原图太大，先压缩
        if (imageBuffer.length > 4 * 1024 * 1024) {
          try {
            const compressed = await sharp(imageBuffer)
              .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            imageUrlForApi = `data:image/jpeg;base64,${compressed.toString('base64')}`;
          } catch { /* 压缩失败就用原图 */ }
        }

        // 构建 images/generations 请求体
        const genRequestBody: Record<string, unknown> = {
          model,
          prompt: editInstruction,
          size: size || '1024x1024',
          quality: quality || 'standard',
          n: Math.min(count, 4),
        };

        // 使用 adjustRequestForProfile 自动调整请求体（size格式转换等）
        const { body: adjustedBody, endpoint: resolvedEndpoint } = adjustRequestForProfile(genRequestBody, compatProfile, {
          hasImage: true,
          isEditEndpoint: true,
        });

        // 添加参考图：原图 + 蒙版参考图（如有）+ 用户参考图都作为 image_urls
        const imageUrls: string[] = [imageUrlForApi];
        // ★ 蒙版参考图：红色高亮标注编辑区域，让AI理解蒙版位置
        if (maskImageUrl) {
          imageUrls.push(maskImageUrl);
          console.info(`[edit] taskId=${taskId} images/generations: 蒙版参考图已添加到image_urls`);
        }
        if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
          for (const refUrl of referenceImages) {
            try {
              const ref = await resolveImageToBuffer(refUrl);
              let refDataUrl = `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}`;
              if (ref.buffer.length > 4 * 1024 * 1024) {
                try {
                  const compressed = await sharp(ref.buffer)
                    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                  refDataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
                } catch { /* 压缩失败就用原图 */ }
              }
              imageUrls.push(refDataUrl);
            } catch { /* 参考图获取失败，跳过 */ }
          }
        }
        // ★ 蒙版作为视觉参考图发送（黑白格式：白色=编辑区域, 黑色=保留区域）
        if (maskBuffer) {
          imageUrls.push(`data:image/png;base64,${maskBuffer.toString('base64')}`);
        }
        adjustedBody.image_urls = imageUrls;

        // 增强 prompt：确保 AI 将参考图作为编辑基础
        if (imageUrls.length > 0) {
          let promptPrefix = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for editing. Do NOT generate from scratch. `;
          if (maskBuffer) {
            promptPrefix += `The LAST image is a mask overlay: WHITE areas indicate regions to modify/edit, BLACK areas must remain unchanged. Only apply changes within the white mask regions. Preserve all details outside the mask precisely. `;
          }
          adjustedBody.prompt = `${promptPrefix}${String(adjustedBody.prompt || '')}`;
        }

        const genResponse = await fetchWithV1Retry(
          effectiveBaseUrl,
          resolvedEndpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: AbortSignal.timeout(120000), // ★ 120秒超时（图像编辑耗时长）
          },
        );

        if (genResponse.ok) {
          const responseText = await genResponse.text();
          let responseData: Record<string, unknown>;

          // 处理 SSE 流式响应
          if (responseText.trimStart().startsWith('data:')) {
            responseData = parseSSEToJSON(responseText);
          } else {
            try { responseData = JSON.parse(responseText); } catch {
              throw new Error('API 响应解析失败');
            }
          }

          // 使用 parseResponseForProfile 解析响应
          const parsed = parseResponseForProfile(responseData, compatProfile);

          if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
            // 直接返回图片 URL
            const images: Array<{ url: string; revisedPrompt: string }> = parsed.directImageUrls.map(url => ({
              url,
              revisedPrompt: effectivePrompt,
            }));

            // count > 1 时额外并行生成
            if (count > 1) {
              const extraPromises = Array.from({ length: count - 1 }, () =>
                fetchWithV1Retry(effectiveBaseUrl, resolvedEndpoint, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ ...adjustedBody, n: 1 }),
                  signal: AbortSignal.timeout(120000), // ★ 120秒超时（图像编辑耗时长）
                })
                .then(async r => {
                  if (!r.ok) return null;
                  const t = await r.text();
                  let d: Record<string, unknown>;
                  if (t.trimStart().startsWith('data:')) d = parseSSEToJSON(t);
                  else try { d = JSON.parse(t); } catch { return null; }
                  const p = parseResponseForProfile(d, compatProfile);
                  return p.mode === 'direct' && p.directImageUrls[0]
                    ? { url: p.directImageUrls[0], revisedPrompt: effectivePrompt }
                    : null;
                })
                .catch(() => null)
              );
              const extraResults = await Promise.all(extraPromises);
              for (const r of extraResults) { if (r) images.push(r); }
            }

            updateTaskProgress(taskId, { status: 'completed', progress: 100 });
            setEditTask(taskId, {
              id: taskId,
              status: 'completed',
              progress: 100,
              stage: '完成',
              result: {
                success: true,
                image: images[0],
                images,
                model,
                provider: effectiveBaseUrl || 'unknown',
                llmInstruction,
                editRegions: llmEditRegions,
                autoMaskGenerated: llmEditRegions.length > 0,
              },
              createdAt: getEditTask(taskId)?.createdAt || Date.now(),
              completedAt: Date.now(),
            });
            return; // 成功，退出
          }

          if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
            // 异步轮询模式：将 taskIds 存储到任务中，由 poll-task 路由处理
            const remoteTaskId = parsed.taskIds[0];
            console.info(`[edit] images/generations returned task_id: ${remoteTaskId}, delegating to poll-task`);

            // 将远程 taskId 写入 editTask，让 /api/poll-task 的远程轮询逻辑接管
            updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '已提交，等待生成' });
            // ★ 关键修复: 如果API返回了task_id（异步模式），但compatProfile是pollMode:'none'，
            // 说明该提供商实际上支持异步轮询，需要升级compatProfile以确保poll-task能正确轮询
            let effectiveCompatProfile = compatProfile;
            if (compatProfile && compatProfile.pollMode === 'none' && parsed.taskIds?.length) {
              effectiveCompatProfile = { ...compatProfile, pollMode: 'path', pollPathTemplate: '/tasks/{taskId}' };
              console.info(`[edit] Upgrading compatProfile from pollMode:'none' to 'path' (API returned task_id=${remoteTaskId})`);
            }

            setEditTask(taskId, {
              id: taskId,
              status: 'processing',
              progress: 10,
              stage: '已提交',
              result: undefined,
              createdAt: getEditTask(taskId)?.createdAt || Date.now(),
              // 附加远程轮询信息
              remotePollInfo: {
                taskId: remoteTaskId,
                apiBaseUrl: effectiveBaseUrl,
                apiKey: effectiveApiKey,
                model,
                prompt: effectivePrompt,
                allTaskIds: parsed.taskIds,
                compatProfile: effectiveCompatProfile,
              },
            } as EditTask);
            return; // 轮询将由前端驱动
          }

          // 响应中既没有图片也没有 task_id
          console.warn('[edit] images/generations response has no images or task_ids, falling back to chat/completions');
        } else {
          // images/generations 失败，记录日志后回退到 chat/completions
          const errText = await genResponse.text().catch(() => '');
          console.warn(`[edit] images/generations failed (${genResponse.status}): ${errText.substring(0, 200)}, falling back to chat/completions`);
        }
      } catch (genErr) {
        console.warn('[edit] images/generations error, falling back to chat/completions:', genErr instanceof Error ? genErr.message : genErr);
      }
    }

    // ★ 检查任务是否已被取消（images/generations 之后）
    if (isTaskCancelled(taskId)) {
      failTask(taskId, '任务已被取消');
      return;
    }

    // 路径B: chat/completions 多模态端点（兜底，适用于支持图片输出的 LLM）
    // 仅在 images/generations 不可用或失败时使用
    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    // 主图
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
    });

    // 参考图
    if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
      for (const refUrl of referenceImages) {
        try {
          const ref = await resolveImageToBuffer(refUrl);
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}` },
          });
        } catch (refErr) {
          console.warn('Failed to load reference image, skipping:', refErr);
        }
      }
      contentParts.push({
        type: 'text',
        text: `[System: There are ${referenceImages.length} reference image(s) above. Use them as style/composition/subject references when editing the main image.]`,
      });
    }

    // ★ 蒙版参考图
    if (maskImageUrl) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: maskImageUrl },
      });
      contentParts.push({
        type: 'text',
        text: '[System: The image above is a MASK overlay. The RED-highlighted area indicates the region you MUST modify. Only change content within the red/masked region, keep everything else identical.]',
      });
    }

    // 蒙版参考图（将蒙版作为参考图发送给AI）
    if (maskBuffer) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${maskBuffer.toString('base64')}` },
      });
      contentParts.push({
        type: 'text',
        text: `[System: The last image is a mask overlay. The WHITE areas indicate the regions you should modify/edit. The BLACK areas must remain unchanged. Only apply changes within the white mask regions. Preserve all details outside the mask precisely.]`,
      });
    }

    // 编辑指令
    contentParts.push({ type: 'text', text: editInstruction });

    // 比例到像素尺寸映射（与 /images/edits 和 /images/generations 路径一致）
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
      '4:3': '1024x768', '3:4': '768x1024', '2:3': '768x1024', '3:2': '1024x768',
      '1:2': '512x1024', '2:1': '1024x512',
      '1024': '1024x1024', '1536': '1536x1536', '2048': '2048x2048',
    };
    let outputSize = size;
    if (sizeMap[size]) outputSize = sizeMap[size];
    else if (size && !size.includes('x')) outputSize = `${size}x${size}`;

    // 构建 chat/completions 请求体
    const chatRequestBody: Record<string, unknown> = {
      model,
      messages: [{
        role: 'user',
        content: contentParts,
      }],
      max_tokens: 4096,
      stream: false,
    };

    // ★ 将 size、quality、n 参数传递给 chat/completions（兼容提供商如 apimart 等会使用这些参数）
    if (outputSize) chatRequestBody.size = outputSize;
    if (quality) chatRequestBody.quality = quality;
    if (count > 1) chatRequestBody.n = count;

    const chatResponse = await fetchWithV1Retry(
      effectiveBaseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatRequestBody),
        signal: AbortSignal.timeout(120000), // ★ 120秒超时（图像编辑耗时长）
      },
    );

    console.info(`[edit] taskId=${taskId} chat/completions响应, 状态=${chatResponse.status}, 耗时=${Date.now() - editStartTime}ms`);

    if (!chatResponse.ok) {
      const errText = await chatResponse.text().catch(() => '');
      let errorMsg = `API 调用失败 (${chatResponse.status})`;

      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        } else if (errJson.message) {
          errorMsg = errJson.message;
        }
      } catch {
        if (errText) errorMsg += `: ${errText.substring(0, 200)}`;
      }

      // ★ 清理常见 API 错误信息，提供更友好的中文提示
      const translatedMsg = translateApiError(errorMsg);
      if (chatResponse.status === 401 || chatResponse.status === 403) {
        failTask(taskId, `API Key 无效或权限不足: ${translatedMsg}`);
        return;
      }
      if (chatResponse.status === 429) {
        failTask(taskId, '请求频率超限，请稍后再试');
        return;
      }
      if (chatResponse.status === 404) {
        failTask(taskId, `模型 ${model} 在当前 API 端点不可用，请检查模型名称或更换 API 提供商`);
        return;
      }
      if (chatResponse.status === 400) {
        // 400 可能是模型不支持图片输入，尝试降级到 /images/generations
        if (isImageEditModel(model)) {
          try {
            const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, 1);
            if (genUrl) {
              const images: Array<{ url: string; revisedPrompt: string }> = [{ url: genUrl, revisedPrompt: effectivePrompt }];
              // count > 1 时额外并行生成
              if (count > 1) {
                const extraPromises = Array.from({ length: count - 1 }, () =>
                  tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, 1)
                    .then(url => url ? { url, revisedPrompt: effectivePrompt } : null)
                    .catch(() => null)
                );
                const extraResults = await Promise.all(extraPromises);
                for (const r of extraResults) { if (r) images.push(r); }
              }
              // ★ 更新任务注册中心
              updateTaskProgress(taskId, { status: 'completed', progress: 100 });
              setEditTask(taskId, {
                id: taskId,
                status: 'completed',
                progress: 100,
                stage: '完成',
                result: {
                  success: true,
                  image: images[0],
                  images,
                  model,
                  provider: 'images-generations-fallback',
                  llmInstruction,
                  editRegions: llmEditRegions,
                  autoMaskGenerated: false,
                },
                createdAt: getEditTask(taskId)?.createdAt || Date.now(),
                completedAt: Date.now(),
              });
              return;
            }
          } catch { /* 忽略 */ }
        }
        failTask(taskId, `请求参数错误: ${translatedMsg}`);
        return;
      }

      failTask(taskId, translatedMsg);
      return;
    }

    // 解析响应（兼容流式和非流式）
    const chatText = await chatResponse.text();
    let chatData: Record<string, unknown>;

    if (chatText.trimStart().startsWith('data:')) {
      console.info('[edit] API returned SSE stream despite stream:false, parsing SSE events');
      chatData = parseSSEToJSON(chatText);
    } else {
      try {
        chatData = JSON.parse(chatText);
      } catch {
        failTask(taskId, `API 响应解析失败: ${chatText.substring(0, 200)}`);
        return;
      }
    }

    let resultImageUrl = extractImageFromResponse(chatData);
    console.info(`[edit] taskId=${taskId} chat/completions图片提取: ${resultImageUrl ? '成功' : '未找到'}, 耗时=${Date.now() - editStartTime}ms`);

    // chat/completions 未提取到图片，尝试降级到 images/generations（★ 限时30秒，避免长时间等待）
    if (!resultImageUrl && isImageEditModel(model)) {
      try {
        console.info(`[edit] taskId=${taskId} chat/completions未返回图片, 尝试images/generations降级`);
        const fallbackStart = Date.now();
        const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, 1);
        if (genUrl) resultImageUrl = genUrl;
        console.info(`[edit] taskId=${taskId} images/generations降级: ${genUrl ? '成功' : '失败'}, 耗时=${Date.now() - fallbackStart}ms`);
      } catch { /* 忽略 */ }
    }

    if (!resultImageUrl) {
      const chatChoices = (chatData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
      const textContent = chatChoices?.[0]?.message
        ? ((chatChoices[0].message as Record<string, unknown>).content as string)
        : undefined;
      if (typeof textContent === 'string' && textContent.length > 0 && !textContent.includes('data:image')) {
        failTask(taskId, '模型未返回编辑后的图片，仅返回了文本描述。请尝试更换模型或 API 提供商');
        return;
      }

      failTask(taskId, '图片编辑失败，未返回有效结果');
      return;
    }

    // ★ count > 1 时，多次图像生成（并行调用，节省LLM开销）
    const images: Array<{ url: string; revisedPrompt: string }> = [{ url: resultImageUrl, revisedPrompt: effectivePrompt }];
    if (count > 1) {
      // 对于 Gemini 模型，重复调用 chat/completions（无需 LLM 协作，直接使用优化后的 prompt）
      // 对于 OpenAI 模型，使用 images/generations
      const extraCount = count - 1;
      const extraPromises = Array.from({ length: extraCount }, async () => {
        try {
          if (isImageEditModel(model)) {
            // Gemini 模型：再次调用 chat/completions（不带 LLM 协作）
            const extraResp = await fetchWithV1Retry(effectiveBaseUrl, '/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: contentParts }],
                max_tokens: 4096,
                stream: false,
                ...(outputSize ? { size: outputSize } : {}),
                ...(quality ? { quality } : {}),
              }),
              signal: AbortSignal.timeout(60000), // ★ 60秒超时
            });
            if (extraResp.ok) {
              const extraText = await extraResp.text();
              let extraData: Record<string, unknown>;
              if (extraText.trimStart().startsWith('data:')) {
                extraData = parseSSEToJSON(extraText);
              } else {
                try { extraData = JSON.parse(extraText); } catch { return null; }
              }
              const extraUrl = extractImageFromResponse(extraData);
              return extraUrl ? { url: extraUrl, revisedPrompt: effectivePrompt } : null;
            }
            return null;
          } else {
            // OpenAI 模型：使用 images/generations
            const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, 1);
            return genUrl ? { url: genUrl, revisedPrompt: effectivePrompt } : null;
          }
        } catch { return null; }
      });
      const extraResults = await Promise.all(extraPromises);
      for (const r of extraResults) {
        if (r) images.push(r);
      }
    }

    // 存储成功结果到任务
    // ★ 更新任务注册中心
    const elapsedSec = Math.round((Date.now() - (getEditTask(taskId)?.createdAt || Date.now())) / 1000);
    console.info(`[edit] taskId=${taskId} 编辑完成, 耗时=${elapsedSec}s, images=${images.length}`);
    updateTaskProgress(taskId, { status: 'completed', progress: 100 });
    setEditTask(taskId, {
      id: taskId,
      status: 'completed',
      progress: 100,
      stage: '完成',
      result: {
        success: true,
        image: images[0],
        images,
        model,
        provider: effectiveBaseUrl || 'unknown',
        llmInstruction,
        editRegions: llmEditRegions,
        autoMaskGenerated: llmEditRegions.length > 0,
      },
      createdAt: getEditTask(taskId)?.createdAt || Date.now(),
      completedAt: Date.now(),
    });
    console.info(`[edit] ★ taskId=${taskId} 结果已存储到 edit-task-store, image[0]=${images[0]?.url?.substring(0, 80)}`);

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[edit] ★ taskId=${taskId} IIFE异常: ${errMsg}`, error);
      const stack = error instanceof Error ? error.stack : '';
      if (stack) console.error(`[edit] Stack: ${stack}`);

      const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND');
      failTask(taskId, isNetworkError ? '网络连接失败：无法访问 API 服务' : (errMsg || '图片编辑失败'), isNetworkError);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  // ========== 立即返回 taskId（提交+轮询模式） ==========
  return NextResponse.json({
    success: true,
    mode: 'polling',
    taskId,
    estimatedTime: 30,
  });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[edit] Task creation error: ${message}`);
    return NextResponse.json({ success: false, error: `任务创建失败: ${message}` }, { status: 500 });
  }
} // end POST

/**
 * 降级：尝试 /images/generations 端点
 * 部分 OpenAI 兼容代理不支持 chat/completions 图片编辑，但支持 images/generations
 */
async function tryImagesGenerations(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  count: number,
): Promise<string | null> {
  const sizeMap: Record<string, string> = {
    '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
    '4:3': '1024x768', '3:4': '768x1024', '2:3': '768x1024', '3:2': '1024x768',
    '1:2': '512x1024', '2:1': '1024x512',
    '1024': '1024x1024', '1536': '1536x1536', '2048': '2048x2048',
  };
  let outputSize = size;
  if (sizeMap[size]) outputSize = sizeMap[size];
  else if (!size.includes('x')) outputSize = `${size}x${size}`;

  const genResponse = await fetchWithV1Retry(
    baseUrl,
    '/images/generations',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        size: outputSize,
        quality,
        n: Math.min(count, 4),
        response_format: 'url',
      }),
      signal: AbortSignal.timeout(60000), // ★ 60秒超时，避免无限等待
    },
  );

  if (!genResponse.ok) return null;

  const genData = await genResponse.json();
  return extractImageFromResponse(genData) || null;
}

// ============================================================
// GET: 获取支持的编辑模型列表（从管理员系统获取）
// ============================================================
export async function GET() {
  try {
    const { getApiProviders } = await import('@/lib/server-api-config');
    const providers = await getApiProviders();

    const editModels: { id: string; name: string; providerId: string; providerName: string; supportsMask: boolean }[] = [];

    for (const provider of providers) {
      // 仅获取图像类型的提供商
      if (provider.modelType && provider.modelType !== 'image') continue;

      const models = provider.selectedModels || (provider.discoveredModels || []).map((m: { id: string }) => m.id);
      for (const rawModelId of models) {
        const modelId: string = typeof rawModelId === 'string' ? rawModelId : (rawModelId as { id: string }).id;
        const id = (modelId || '').toLowerCase();
        // 排除不支持编辑的模型类型
        if (id.includes('3d') || id.includes('vectoriz') || id.includes('layer') || id.includes('segment')) continue;

        // 涂抹支持判断（通用，不针对特定供应商）：
        // 后端统一使用 images/generations + 视觉参考蒙版路径，不依赖 images.edit 原生 mask 参数
        // - 绝大多数图像模型：支持涂抹（蒙版作为视觉参考图 + prompt 语义描述，通用方案）
        // - Gemini 系列：不支持涂抹（AI 无法可靠理解蒙版参考图语义，仅文字修图）
        let supportsMask = true; // ★ 默认支持（通用视觉参考蒙版方案）
        if (id.includes('gemini')) {
          supportsMask = false; // Gemini 系列无法可靠理解蒙版语义
        }

        editModels.push({
          id: modelId,
          name: modelId,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          supportsMask,
        });
      }
    }

    return NextResponse.json({
      supportedModels: editModels.map(m => m.id),
      models: editModels,
    });
  } catch {
    // 降级：返回静态列表
    return NextResponse.json({
      supportedModels: EDITABLE_MODELS,
      models: EDITABLE_MODELS.map(model => ({
        id: model,
        name: model,
        providerId: '',
        providerName: '',
        supportsMask: !model.toLowerCase().includes('gemini'),
      })),
    });
  }
}
