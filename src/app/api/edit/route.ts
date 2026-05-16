import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

// 允许大请求体（base64图片可能很大，50MB限制）
export const runtime = 'nodejs';
export const maxDuration = 120;

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
    const fullUrl = domain ? `https://${domain}${imageSrc}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageSrc}`;
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
      editHistory = [], // 可选，多轮编辑历史 [{userPrompt, llmInstruction}]
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
    let effectiveProviderId = providerId || '';

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
          effectiveProviderId = provider.id;
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
        return NextResponse.json({ success: false, error: `无法下载图片: ${errMsg}` }, { status: 400 });
      }
    } else if (image.startsWith('/')) {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      const fullUrl = domain ? `https://${domain}${image}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${image}`;
      try {
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type');
        if (contentType) mimeType = contentType;
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        return NextResponse.json({ success: false, error: `无法下载图片: ${errMsg}` }, { status: 400 });
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
          return NextResponse.json({ success: false, error: `无法下载mask: ${errMsg}` }, { status: 400 });
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

    if (llmModelId && llmProviderId) {
      try {
        const llmProvider = await findProviderById(llmProviderId);
        if (llmProvider?.apiKey && llmProvider?.baseUrl) {
          const llmBaseUrl = normalizeApiBaseUrl(llmProvider.baseUrl);
          const llmHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llmProvider.apiKey}`,
          };

          // ===== 阶段1: LLM 分析原图内容 =====
          let imageDescription = '';
          const analyzeParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            { type: 'text', text: '请仔细观察这张图片，简要描述图片中的：1.主要主体 2.背景环境 3.色彩风格 4.构图特征。用中文回答，不超过80字：' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } },
          ];

          try {
            const analyzeResponse = await fetchWithV1Retry(llmBaseUrl, '/chat/completions', {
              method: 'POST',
              headers: llmHeaders,
              body: JSON.stringify({
                model: llmModelId,
                messages: [{ role: 'user', content: analyzeParts }],
                max_tokens: 200,
                stream: false,
              }),
            });
            if (analyzeResponse.ok) {
              const analyzeText = await analyzeResponse.text();
              let analyzeData: Record<string, unknown>;
              if (analyzeText.trimStart().startsWith('data:')) {
                analyzeData = parseSSEToJSON(analyzeText);
              } else {
                try { analyzeData = JSON.parse(analyzeText); } catch { analyzeData = {}; }
              }
              const analyzeChoices = (analyzeData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
              const analyzeContent = analyzeChoices?.[0]?.message
                ? ((analyzeChoices[0].message as Record<string, unknown>).content)
                : undefined;
              if (analyzeContent) imageDescription = String(analyzeContent);
            }
          } catch (analyzeErr) {
            console.warn('LLM image analysis failed:', analyzeErr);
          }

          // ===== 阶段2: LLM 分析参考图（如有） =====
          let refDescription = '';
          if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
            const refParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
              { type: 'text', text: '请简要描述以下参考图片的风格、构图和主体特征，用于指导图片编辑。用中文回答，不超过80字：' },
            ];
            for (const refUrl of referenceImages.slice(0, 4)) {
              try {
                const ref = await resolveImageToBuffer(refUrl);
                refParts.push({ type: 'image_url', image_url: { url: `data:${ref.mimeType};base64,${ref.buffer.toString('base64')}` } });
              } catch { /* 跳过失败的参考图 */ }
            }
            try {
              const refResponse = await fetchWithV1Retry(llmBaseUrl, '/chat/completions', {
                method: 'POST',
                headers: llmHeaders,
                body: JSON.stringify({
                  model: llmModelId,
                  messages: [{ role: 'user', content: refParts }],
                  max_tokens: 200,
                  stream: false,
                }),
              });
              if (refResponse.ok) {
                const refText = await refResponse.text();
                let refData: Record<string, unknown>;
                if (refText.trimStart().startsWith('data:')) {
                  refData = parseSSEToJSON(refText);
                } else {
                  try { refData = JSON.parse(refText); } catch { refData = {}; }
                }
                const refChoices = (refData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
                const refContent = refChoices?.[0]?.message
                  ? ((refChoices[0].message as Record<string, unknown>).content)
                  : undefined;
                if (refContent) refDescription = String(refContent);
              }
            } catch (refErr) {
              console.warn('LLM reference image analysis failed:', refErr);
            }
          }

          // ===== 阶段3: LLM 生成精准编辑指令 =====
          // 将原图分析 + 参考图分析 + 用户意图 + 蒙版语义 + 编辑历史 → 组合成精准编辑指令
          let maskContext = '';
          if (maskBuffer) {
            maskContext = '\n\n[蒙版信息：用户用画笔标记了需要修改的区域（蒙版白色区域），请重点关注标记区域进行修改，未标记区域尽量保持原样。]';
          }

          // 构建历史编辑记录（最近5轮）
          let historyContext = '';
          if (Array.isArray(editHistory) && editHistory.length > 0) {
            const recentHistory = editHistory.slice(-5);
            const historyLines = recentHistory.map((h: { userPrompt?: string; llmInstruction?: string }) =>
              `用户指令: ${h.userPrompt || ''} → AI优化指令: ${h.llmInstruction || ''}`
            ).join('\n');
            historyContext = `\n## 历史编辑记录（供上下文参考，避免与之前操作矛盾）\n${historyLines}\n`;
          }

          const optimizeParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            {
              type: 'text',
              text: `你是一个专业的AI图片编辑指令优化师。请根据以下信息，生成一条精准的英文图片编辑指令。
${historyContext}
## 原图内容分析
${imageDescription || '（未能分析原图）'}

## 参考图特征
${refDescription || '（无参考图）'}
${maskContext}
## 用户的编辑意图
${prompt}

## 要求
1. 将用户的中文意图翻译为精准的英文编辑指令
2. 结合原图内容分析，明确指出需要修改和保持的部分
3. 如果有参考图特征，融入参考图的风格/构图/主体元素
4. 如果有蒙版信息，强调只在标记区域修改
5. 如果有历史编辑记录，保持与之前修改的一致性和连贯性
6. 指令要具体、可执行，包含视觉细节（颜色、纹理、光影等）
7. 只输出编辑指令本身，不要任何解释或前缀

请直接输出英文编辑指令：`,
            },
          ];
          // 让LLM也看到原图，辅助理解
          if (imageDescription) {
            optimizeParts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } });
          }

          try {
            const optimizeResponse = await fetchWithV1Retry(llmBaseUrl, '/chat/completions', {
              method: 'POST',
              headers: llmHeaders,
              body: JSON.stringify({
                model: llmModelId,
                messages: [{ role: 'user', content: optimizeParts }],
                max_tokens: 500,
                stream: false,
              }),
            });
            if (optimizeResponse.ok) {
              const optimizeText = await optimizeResponse.text();
              let optimizeData: Record<string, unknown>;
              if (optimizeText.trimStart().startsWith('data:')) {
                optimizeData = parseSSEToJSON(optimizeText);
              } else {
                try { optimizeData = JSON.parse(optimizeText); } catch { optimizeData = {}; }
              }
              const optimizeChoices = (optimizeData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
              const optimizeContent = optimizeChoices?.[0]?.message
                ? ((optimizeChoices[0].message as Record<string, unknown>).content)
                : undefined;
              if (optimizeContent && String(optimizeContent).trim()) {
                effectivePrompt = String(optimizeContent).trim();
                llmInstruction = effectivePrompt; // 记录 LLM 生成的精准指令
                console.log(`[LLM协作] 原始prompt: "${prompt}" → 优化后: "${effectivePrompt.substring(0, 100)}..."`);
              }
            }
          } catch (optimizeErr) {
            console.warn('LLM prompt optimization failed, using original prompt:', optimizeErr);
          }
        }
      } catch (llmErr) {
        console.warn('LLM collaboration failed, using original prompt:', llmErr);
      }
    } else {
      // 没有配置LLM模型时，仅做简单处理
      if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
        effectivePrompt = `有${referenceImages.length}张参考图作为风格/构图参考。${prompt}`;
      }
      if (maskBuffer) {
        effectivePrompt = `${prompt}（仅修改涂抹标记的区域，其他区域保持不变）`;
      }
    }

    const editInstruction = `Edit this image according to the following instruction: ${effectivePrompt}. Maintain the overall composition and style while making the requested changes.`;

    // ========== 6. 调用 API（全兼容模式） ==========

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
          },
        );

        if (!editResponse.ok) {
          const errText = await editResponse.text().catch(() => '');
          // images.edit 失败，降级到 chat/completions 路径
          console.warn(`images.edit failed (${editResponse.status}), falling back to chat/completions: ${errText.substring(0, 200)}`);
          // 不 return，继续走下面的 chat/completions 路径
        } else {
          const editData = await editResponse.json();
          const resultUrl = extractImageFromResponse(editData);
          if (resultUrl) {
            return NextResponse.json({
              success: true,
              image: { url: resultUrl, revisedPrompt: effectivePrompt },
              images: [{ url: resultUrl, revisedPrompt: effectivePrompt }],
              model,
              provider: 'openai-images-edit',
              llmInstruction,
            });
          }
          // 提取失败，降级到 chat/completions
          console.warn('images/edit response parsed but no image found, falling back to chat/completions');
        }
      } catch (editErr) {
        console.warn('images.edit error, falling back to chat/completions:', editErr instanceof Error ? editErr.message : editErr);
        // 降级到 chat/completions
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
    // 白色区域=需要修改的区域，黑色区域=保持不变的区域
    // 无论是否支持原生mask，都通过chat/completions参考图模式发送蒙版
    // （如果路径A成功则不会走到这里，路径A失败降级时也能正确处理）
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

    // 构建 chat/completions 请求体（必须 stream:false，第三方代理默认可能流式返回）
    const chatRequestBody: Record<string, unknown> = {
      model,
      messages: [{
        role: 'user',
        content: contentParts,
      }],
      max_tokens: 4096,
      stream: false,
    };

    // 对于图像生成类模型，添加响应格式提示（部分代理支持）
    if (isOpenaiImageModel || isImageEditModel(model)) {
      // 部分代理/模型需要通过特定参数要求返回图片
      // 不影响不支持此参数的代理（会被忽略）
    }

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
      },
    );

    if (!chatResponse.ok) {
      const errText = await chatResponse.text().catch(() => '');
      let errorMsg = `API 调用失败 (${chatResponse.status})`;
      
      // 尝试解析错误信息
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

      // 特定错误码处理
      if (chatResponse.status === 401 || chatResponse.status === 403) {
        return NextResponse.json({
          success: false,
          error: `API Key 无效或权限不足: ${errorMsg}`,
          requiresApiKey: true,
        }, { status: chatResponse.status });
      }
      if (chatResponse.status === 429) {
        return NextResponse.json({ success: false, error: '请求频率超限，请稍后再试' }, { status: 429 });
      }
      if (chatResponse.status === 404) {
        return NextResponse.json({
          success: false,
          error: `模型 ${model} 在当前 API 端点不可用，请检查模型名称或更换 API 提供商`,
        }, { status: 404 });
      }
      if (chatResponse.status === 400) {
        // 400 可能是模型不支持图片输入，尝试降级到 /images/edits
        if (isOpenaiImageModel && !supportsNativeMask) {
          // 尝试 images/generations 端点
          try {
            const genResult = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, count);
            if (genResult) return genResult;
          } catch { /* 忽略 */ }
        }
        return NextResponse.json({
          success: false,
          error: `请求参数错误: ${errorMsg}`,
        }, { status: 400 });
      }

      return NextResponse.json({ success: false, error: errorMsg }, { status: chatResponse.status });
    }

    // 解析响应（兼容流式和非流式，部分代理忽略 stream:false 强制流式返回）
    const chatText = await chatResponse.text();
    let chatData: Record<string, unknown>;

    if (chatText.trimStart().startsWith('data:')) {
      // SSE 流式响应 — 拼接所有 delta content
      console.info('[edit] API returned SSE stream despite stream:false, parsing SSE events');
      chatData = parseSSEToJSON(chatText);
    } else {
      try {
        chatData = JSON.parse(chatText);
      } catch {
        return NextResponse.json({
          success: false,
          error: `API 响应解析失败: ${chatText.substring(0, 200)}`,
        }, { status: 502 });
      }
    }

    let resultImageUrl = extractImageFromResponse(chatData);

    // chat/completions 未提取到图片，尝试降级到 images/generations
    if (!resultImageUrl && isOpenaiImageModel) {
      try {
        const genResult = await tryImagesGenerations(effectiveBaseUrl, effectiveApiKey, model, effectivePrompt, size, quality, count);
        if (genResult) return genResult;
      } catch { /* 忽略 */ }
    }

    if (!resultImageUrl) {
      // 最后的降级：检查响应中是否有文本内容，可能模型只返回了文字描述
      const chatChoices = (chatData as Record<string, unknown>).choices as Array<Record<string, unknown>> | undefined;
      const textContent = chatChoices?.[0]?.message
        ? ((chatChoices[0].message as Record<string, unknown>).content as string)
        : undefined;
      if (typeof textContent === 'string' && textContent.length > 0 && !textContent.includes('data:image')) {
        return NextResponse.json({
          success: false,
          error: '模型未返回编辑后的图片，仅返回了文本描述。请尝试更换模型或 API 提供商',
          textResponse: textContent.substring(0, 500),
        }, { status: 500 });
      }

      return NextResponse.json({
        success: false,
        error: '图片编辑失败，未返回有效结果',
      }, { status: 500 });
    }

    const images = count > 1
      ? Array.from({ length: count }, () => ({ url: resultImageUrl, revisedPrompt: effectivePrompt }))
      : [{ url: resultImageUrl, revisedPrompt: effectivePrompt }];

    return NextResponse.json({
      success: true,
      image: images[0],
      images,
      model,
      provider: effectiveBaseUrl || 'unknown',
      llmInstruction,
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Image edit error:', error);

    if (errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND')) {
      return NextResponse.json({
        success: false,
        error: `网络连接失败：无法访问 API 服务`,
        networkError: true,
      }, { status: 503 });
    }

    return NextResponse.json({ success: false, error: errMsg || '图片编辑失败' }, { status: 500 });
  }
}

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
): Promise<NextResponse | null> {
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
        response_format: 'b64_json',
      }),
    },
  );

  if (!genResponse.ok) return null;

  const genData = await genResponse.json();
  const resultUrl = extractImageFromResponse(genData);
  if (!resultUrl) return null;

  const images = [{ url: resultUrl, revisedPrompt: prompt }];
  return NextResponse.json({
    success: true,
    image: images[0],
    images,
    model,
    provider: 'images-generations-fallback',
    llmInstruction: prompt,
  });
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
