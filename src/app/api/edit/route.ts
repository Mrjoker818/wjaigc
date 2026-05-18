import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl, getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import type { ApiProvider } from '@/lib/universal-api-types';
import { getEditTask, deleteEditTask, setEditTask, updateTaskStage, failEditTask } from '@/lib/edit-task-store';
import type { EditTask } from '@/lib/edit-task-store';

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
    const response = await fetch(imageSrc);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type');
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType || 'image/png' };
  } else if (imageSrc.startsWith('/')) {
    const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const domainBase = domain.replace(/\/+$/, '');
    const base = domainBase.startsWith('http') ? domainBase : (domainBase ? `https://${domainBase}` : '');
    const fullUrl = base ? `${base}${imageSrc}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageSrc}`;
    const response = await fetch(fullUrl);
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
 * 判断模型是否支持原生蒙版涂抹（OpenAI images.edit 端点的 mask 参数）
 * 注意：即使不支持原生 mask，也可以通过 chat/completions 将蒙版作为参考图发送
 * 所以所有模型在 UI 层面都"支持涂抹"，这里仅决定是否走 images.edit 路径
 */
function modelSupportsNativeMask(modelId: string, providerBaseUrl: string): boolean {
  const id = modelId.toLowerCase();
  // 仅 OpenAI 官方端点支持 images.edit 的 mask 参数
  if (id.includes('gpt-image') || id.includes('dall-e')) {
    if (providerBaseUrl && !providerBaseUrl.includes('api.openai.com')) {
      return false;
    }
    return true;
  }
  return false;
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

    // ========== 1. 获取 API 凭证（与 /api/generate 一致） ==========
    let effectiveApiKey = apiKey || '';
    let effectiveBaseUrl = '';

    if (!effectiveApiKey && providerId) {
      try {
        const provider = await findProviderById(providerId);
        if (provider?.apiKey) {
          effectiveApiKey = provider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(provider.baseUrl || '');
        }
      } catch { /* 忽略 */ }
    }

    if (!effectiveApiKey) {
      try {
        const provider = await findProviderForModel(model);
        if (provider?.apiKey) {
          effectiveApiKey = provider.apiKey;
          effectiveBaseUrl = normalizeApiBaseUrl(provider.baseUrl || '');
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

    // 后台异步执行编辑流程（5分钟全局超时兜底）
    const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
    (async () => {
      // 全局超时：确保 IIFE 不会无限运行
      const timeoutId = setTimeout(() => {
        const task = getEditTask(taskId);
        if (task && task.status === 'processing') {
          failTask(taskId, '编辑超时，请稍后重试');
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      try {
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

    // ========== 4. 判断调用路径 ==========
    const id = model.toLowerCase();
    const isOpenaiImageModel = id.includes('gpt-image') || id.includes('dall-e');
    const supportsNativeMask = modelSupportsNativeMask(model, effectiveBaseUrl);

    // ========== 5. LLM 协作：分析原图 + 优化 prompt + 蒙版语义 ==========
    // 核心思路：LLM 是"大脑"理解意图，图像模型是"手"执行修改
    // 协作流程：LLM 分析原图内容 → 理解用户意图 → 结合蒙版区域 → 生成精准编辑指令
    let effectivePrompt = prompt;
    let llmInstruction = prompt; // LLM 生成的精准指令，无 LLM 参与时等于原始 prompt
    let llmEditRegions: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }> = []; // LLM 识别的编辑区域

    // ===== 单次 LLM 协作：合并分析+指令生成为1次调用 =====
    try {
      updateTaskStage(taskId, '分析中');
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

        // 构建多模态消息（原图 + 参考图）
        const promptText = `You are an expert image editing assistant. Analyze the provided image(s) and generate optimal editing instructions.

TASK: User wants to "${prompt}" the image.

INSTRUCTIONS:
1. Analyze the original image: describe its content, composition, style, colors, and key elements
2. ${referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0 ? 'Analyze the reference image(s): describe how they relate to the editing goal and what aspects should be referenced (style, composition, character, etc.)' : 'No reference image provided.'}
3. Generate a detailed editing instruction that will produce the best result for the user's request

OUTPUT FORMAT (respond with ONLY a JSON object, no markdown):
{
  "originalAnalysis": "Brief description of the original image",
  "referenceAnalysis": ${referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0 ? '"Brief description of reference image aspects to apply"' : 'null'},
  "editInstruction": "Detailed editing instruction optimized for image generation AI",
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
          signal: AbortSignal.timeout(60000),
        });

        if (collabResp.ok) {
          // 兼容 SSE 和非 SSE 响应格式
          const collabText = await collabResp.text();
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

    const editInstruction = `Edit this image according to the following instruction: ${effectivePrompt}. Maintain the overall composition and style while making the requested changes.`;

    // ========== 6. 调用 API（全兼容模式） ==========
    updateTaskStage(taskId, '编辑中');

    // 路径A: OpenAI images.edit 端点（仅 OpenAI 官方 + 支持 mask 的场景）
    // 第三方代理即使模型名是 gpt-image-2，也不走 images.edit（因为代理通常不支持）
    if (isOpenaiImageModel && supportsNativeMask && maskBuffer) {
      try {
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('model', model);
        form.append('image', imageBuffer, { filename: 'image.png', contentType: mimeType });
        form.append('prompt', editInstruction);
        if (maskBuffer) {
          form.append('mask', maskBuffer, { filename: 'mask.png', contentType: 'image/png' });
        }

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
        if (model === 'gpt-image-2') {
          form.append('n', String(Math.min(count, 4)));
        }

        const editResponse = await fetchWithV1Retry(
          effectiveBaseUrl,
          '/images/edits',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveApiKey}`,
              ...form.getHeaders(),
            },
            body: form as unknown as BodyInit,
            signal: AbortSignal.timeout(120000),
          },
        );

        if (!editResponse.ok) {
          const errText = await editResponse.text().catch(() => '');
          console.warn(`images.edit failed (${editResponse.status}), falling back to chat/completions: ${errText.substring(0, 200)}`);
        } else {
          const editData = await editResponse.json();
          const images = extractAllImagesFromResponse(editData, effectivePrompt);
          if (images.length > 0) {
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
          console.warn('images/edit response parsed but no image found, falling back to chat/completions');
        }
      } catch (editErr) {
        console.warn('images.edit error, falling back to chat/completions:', editErr instanceof Error ? editErr.message : editErr);
      }
    }

    // 路径B: chat/completions 多模态端点（全兼容，适用于所有第三方代理）
    // 所有模型（Gemini/OpenAI/其他）通过第三方代理时，统一走此路径
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
        signal: AbortSignal.timeout(120000),
      },
    );

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

      if (chatResponse.status === 401 || chatResponse.status === 403) {
        failTask(taskId, `API Key 无效或权限不足: ${errorMsg}`);
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
        if (isOpenaiImageModel || isImageEditModel(model)) {
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
        failTask(taskId, `请求参数错误: ${errorMsg}`);
        return;
      }

      failTask(taskId, errorMsg);
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

    // chat/completions 未提取到图片，尝试降级到 images/generations
    if (!resultImageUrl && (isOpenaiImageModel || isImageEditModel(model))) {
      try {
        const genUrl = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, 1);
        if (genUrl) resultImageUrl = genUrl;
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
          if (isImageEditModel(model) && !isOpenaiImageModel) {
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
              }),
              signal: AbortSignal.timeout(120000),
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

      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Image edit error:', error);

        const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND');
        failTask(taskId, isNetworkError ? '网络连接失败：无法访问 API 服务' : (errMsg || '图片编辑失败'), isNetworkError);
      } finally {
        clearTimeout(timeoutId);
      }
    })();

  // ========== 立即返回 taskId（提交+轮询模式） ==========
  return NextResponse.json({
    success: true,
    mode: 'polling',
    taskId,
    estimatedTime: 60,
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

        // 全兼容模式：所有图像模型都支持编辑（通过 chat/completions 多模态）
        // 所有模型都支持涂抹（蒙版作为参考图发送，AI 理解白色区域为编辑范围）
        editModels.push({
          id: modelId,
          name: modelId,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          supportsMask: true,
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
        supportsMask: true,
      })),
    });
  }
}
