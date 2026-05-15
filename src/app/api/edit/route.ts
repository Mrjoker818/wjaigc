import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { findProviderForModel } from '@/lib/server-api-config';

// Gemini 模型映射（用于图片编辑）
const GEMINI_EDIT_MODELS: Record<string, {
  name: string;
  modelId: string;
  description: string;
}> = {
  'gemini-2.5-flash-image': {
    name: 'Nano Banana',
    modelId: 'gemini-2.0-flash-preview-05-20',
    description: '快速修图，适合日常使用',
  },
  'gemini-3-pro-image-preview': {
    name: 'Nano Banana Pro',
    modelId: 'gemini-3-pro-preview',
    description: '旗舰模型，高质量图片编辑',
  },
  'gemini-3.1-flash-image-preview': {
    name: 'Nano Banana 2',
    modelId: 'gemini-2.5-flash-preview-06-06',
    description: '平衡速度与质量',
  },
};

// 支持编辑的模型列表（包含 OpenAI 和 Gemini 模型）
export const EDITABLE_MODELS = [
  'gpt-image-2',
  'dall-e-3',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
];

/** 将图片 URL/data 转换为 Buffer + mimeType，供 inlineData 使用 */
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

export async function POST(request: NextRequest) {
  try {
    const { 
      image,        // base64 data URL 或 URL
      prompt,       // 编辑指令（自然语言）
      mask,         // 可选，mask图片 base64（仅 OpenAI 模型使用）
      size = '1:1',  // 画面比例或像素尺寸
      quality = 'high',
      apiKey,       // 可选，用户提供的 API Key
      model = 'gpt-image-2',
      providerId,   // 可选，管理员系统提供商ID
      count = 1,    // 生图数量
      llmModelId,   // 可选，LLM辅助模型ID（预留）
      llmProviderId, // 可选，LLM辅助模型提供商ID（预留）
      referenceImages, // 可选，参考图URL数组（多图模式）
    } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 获取 API Key：优先用户提供的，其次从服务器管理配置中查找
    let effectiveApiKey = apiKey;

    if (!effectiveApiKey && providerId) {
      // 通过 providerId 从服务器配置中获取
      try {
        const { getApiProviders } = await import('@/lib/server-api-config');
        const providers = await getApiProviders();
        const provider = providers.find((p: { id: string }) => p.id === providerId);
        if (provider?.apiKey) {
          effectiveApiKey = provider.apiKey;
        }
      } catch {
        // 忽略，降级到用户提供的 key
      }
    }

    if (!effectiveApiKey && !providerId) {
      // 尝试通过模型名称查找服务器管理的 API Key
      try {
        const provider = await findProviderForModel(model);
        if (provider?.apiKey) {
          effectiveApiKey = provider.apiKey;
        }
      } catch {
        // 忽略
      }
    }

    if (!effectiveApiKey) {
      return NextResponse.json({
        success: false,
        error: '需要在管理员系统中配置 API Key，或手动输入 API Key',
        requiresApiKey: true,
      }, { status: 400 });
    }

    // 判断是否为 Gemini 模型
    const isGeminiModel = model.startsWith('gemini-');
    
    // 处理原图
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

    // ========== Gemini 模型处理 ==========
    if (isGeminiModel) {
      const geminiConfig = GEMINI_EDIT_MODELS[model];
      
      if (!geminiConfig) {
        return NextResponse.json({
          success: false,
          error: `不支持的 Gemini 模型: ${model}`,
        }, { status: 400 });
      }

      try {
        const genAI = new GoogleGenerativeAI(effectiveApiKey);
        const geminiModel = genAI.getGenerativeModel({
          model: geminiConfig.modelId,
        });

        const editPrompt = `Edit this image according to the following instruction: ${prompt}. Maintain the overall composition and style while making the requested changes.`;

        // 构建 parts：主图 + 参考图 + 文本指令
        const parts: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }> = [
          {
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: mimeType,
            },
          },
        ];

        // ★ 添加参考图（多图模式）
        if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
          for (const refUrl of referenceImages) {
            try {
              const ref = await resolveImageToBuffer(refUrl);
              parts.push({
                inlineData: {
                  data: ref.buffer.toString('base64'),
                  mimeType: ref.mimeType,
                },
              });
            } catch (refErr) {
              console.warn('Failed to load reference image, skipping:', refErr);
            }
          }
          // 参考图存在时，补充说明
          parts.push({ text: `[System: There are ${referenceImages.length} reference image(s) above. Use them as style/composition/subject references when editing the main image.]` });
        }

        parts.push({ text: editPrompt });

        const result = await geminiModel.generateContent({
          contents: [{
            role: 'user',
            parts: parts,
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'] as unknown as string[],
          } as any,
        });

        const response = result.response;

        let resultImageBase64: string = '';
        let resultMimeType = 'image/png';
        
        for (const candidate of response.candidates || []) {
          for (const part of candidate.content.parts || []) {
            if (part.inlineData) {
              resultImageBase64 = part.inlineData.data || '';
              resultMimeType = part.inlineData.mimeType || 'image/png';
              break;
            }
          }
          if (resultImageBase64) break;
        }

        if (!resultImageBase64) {
          return NextResponse.json({
            success: false,
            error: 'Gemini 模型编辑失败，未返回有效结果',
          }, { status: 500 });
        }

        const imageDataUrl = `data:${resultMimeType};base64,${resultImageBase64}`;

        // 支持多张结果
        const images = count > 1 
          ? Array.from({ length: count }, (_, i) => ({ url: imageDataUrl, revisedPrompt: prompt }))
          : [{ url: imageDataUrl, revisedPrompt: prompt }];

        return NextResponse.json({
          success: true,
          image: images[0],
          images,
          model: model,
          provider: 'google',
        });

      } catch (geminiError: unknown) {
        const errMsg = geminiError instanceof Error ? geminiError.message : 'Unknown error';
        console.error('Gemini API error:', geminiError);
        
        if (errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND') || errMsg.includes('network')) {
          return NextResponse.json({
            success: false,
            error: `网络连接失败：无法访问 Google Gemini API`,
            networkError: true,
          }, { status: 503 });
        }
        
        if (errMsg.includes('API_KEY') || errMsg.includes('invalid API key')) {
          return NextResponse.json({ success: false, error: 'Google API Key 无效或已过期' }, { status: 401 });
        }
        
        if (errMsg.includes('quota') || errMsg.includes('limit') || errMsg.includes('429')) {
          return NextResponse.json({ success: false, error: 'API 调用次数已达上限，请稍后再试' }, { status: 429 });
        }

        if (errMsg.includes('PERMISSION_DENIED') || errMsg.includes('permission') || errMsg.includes('403')) {
          return NextResponse.json({ success: false, error: 'API Key 权限不足' }, { status: 403 });
        }

        return NextResponse.json({ success: false, error: errMsg || 'Gemini API 调用失败' }, { status: 500 });
      }
    }

    // ========== OpenAI 模型处理 ==========
    
    // 处理mask
    let maskBuffer: Buffer | undefined;
    if (mask) {
      if (mask.startsWith('data:')) {
        const base64Data = mask.split(',')[1];
        maskBuffer = Buffer.from(base64Data, 'base64');
      } else if (mask.startsWith('http://') || mask.startsWith('https://')) {
        try {
          const response = await fetch(mask);
          if (!response.ok) throw new Error(`Failed to fetch mask: ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          maskBuffer = Buffer.from(arrayBuffer);
        } catch (fetchError: unknown) {
          const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
          return NextResponse.json({ success: false, error: `无法下载mask: ${errMsg}` }, { status: 400 });
        }
      } else {
        maskBuffer = Buffer.from(mask, 'base64');
      }
    }

    // 获取 provider 的 base_url（如果通过服务器管理）
    let baseUrl: string | undefined;
    if (providerId) {
      try {
        const { getApiProviders } = await import('@/lib/server-api-config');
        const providers = await getApiProviders();
        const provider = providers.find((p: { id: string }) => p.id === providerId);
        if (provider?.baseUrl) baseUrl = provider.baseUrl;
      } catch {
        // 忽略
      }
    }

    const openai = new OpenAI({
      apiKey: effectiveApiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    const imageModel = model === 'gpt-image-2' ? 'gpt-image-2' : 'dall-e-3';

    // 比例到像素尺寸映射
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '4:3': '1024x768',
      '3:4': '768x1024',
      '2:3': '768x1024',
      '3:2': '1024x768',
      '1:2': '512x1024',
      '2:1': '1024x512',
      '1024': '1024x1024',
      '1536': '1536x1536',
      '2048': '2048x2048',
    };

    let outputSize = size;
    if (sizeMap[size]) {
      outputSize = sizeMap[size];
    } else if (!size.includes('x')) {
      outputSize = `${size}x${size}`;
    }

    // 构建API调用参数
    // ★ OpenAI images.edit 不支持多图输入，参考图信息融入 prompt
    let effectivePrompt = prompt;
    if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
      // 使用 LLM 模型对参考图进行理解（如果配置了 LLM），否则直接描述参考图数量
      let refDescription = '';
      if (llmModelId && llmProviderId) {
        try {
          // 查找 LLM 提供商配置
          const { getApiProviders: getProviders } = await import('@/lib/server-api-config');
          const providers = await getProviders();
          const llmProvider = providers.find((p: { id: string }) => p.id === llmProviderId);
          if (llmProvider?.apiKey && llmProvider?.baseUrl) {
            // 构建参考图理解请求
            const refParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
              { type: 'text', text: '请简要描述以下参考图片的风格、构图和主体特征，用于指导图片编辑。用中文回答，不超过100字：' },
            ];
            for (const refUrl of referenceImages.slice(0, 4)) { // 最多4张参考图
              let imageUrl = refUrl;
              if (refUrl.startsWith('/')) {
                const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
                imageUrl = domain ? `https://${domain}${refUrl}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${refUrl}`;
              }
              refParts.push({ type: 'image_url', image_url: { url: imageUrl } });
            }
            const llmResponse = await fetch(`${llmProvider.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmProvider.apiKey}`,
              },
              body: JSON.stringify({
                model: llmModelId,
                messages: [{ role: 'user', content: refParts }],
                max_tokens: 300,
              }),
            });
            if (llmResponse.ok) {
              const llmData = await llmResponse.json();
              const llmText = llmData.choices?.[0]?.message?.content;
              if (llmText) refDescription = llmText;
            }
          }
        } catch (llmErr) {
          console.warn('LLM reference image analysis failed:', llmErr);
        }
      }
      const refContext = refDescription
        ? `参考图特征：${refDescription}。`
        : `有${referenceImages.length}张参考图。`;
      effectivePrompt = `${refContext}${prompt}`;
    }

    const editParams: Record<string, unknown> = {
      model: imageModel,
      image: imageBuffer,
      prompt: effectivePrompt,
    };

    if (maskBuffer) {
      editParams.mask = maskBuffer;
    }

    if (imageModel === 'gpt-image-2') {
      editParams.size = outputSize;
      editParams.quality = quality;
      editParams.background = 'opaque';
      editParams.output_format = 'png';
      editParams.n = Math.min(count, 4);
    } else {
      editParams.size = outputSize;
      editParams.quality = quality === 'high' ? 'hd' : 'standard';
      editParams.n = 1;
    }

    const response = await openai.images.edit(editParams as any);

    // 提取结果图片
    const resp = response as any;
    const images: { url: string; revisedPrompt: string }[] = [];

    if (resp.data && Array.isArray(resp.data)) {
      for (const img of resp.data) {
        const url = img.b64_json ? `data:image/png;base64,${img.b64_json}` : (img.url || '');
        if (url) {
          images.push({ url, revisedPrompt: img.revised_prompt || prompt });
        }
      }
    }

    if (images.length === 0) {
      return NextResponse.json({
        success: false,
        error: '图片编辑失败，未返回有效结果',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      image: images[0],
      images,
      model: imageModel,
      provider: 'openai',
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as { status?: number })?.status;
    console.error('Image edit error:', error);
    
    if (statusCode === 401) {
      return NextResponse.json({
        success: false,
        error: 'API Key 无效或已过期，请检查配置',
        requiresApiKey: true,
      }, { status: 401 });
    }
    
    if (statusCode === 429) {
      return NextResponse.json({ success: false, error: '请求频率超限，请稍后再试' }, { status: 429 });
    }

    return NextResponse.json({ success: false, error: errMsg || '图片编辑失败，请重试' }, { status: 500 });
  }
}

// 获取支持的编辑模型列表（从管理员系统获取）
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
        
        const isGemini = id.includes('gemini');
        editModels.push({
          id: modelId,
          name: modelId,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          supportsMask: !isGemini,
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
        supportsMask: !model.startsWith('gemini-'),
      })),
    });
  }
}
