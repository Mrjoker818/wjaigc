import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, normalizeApiBaseUrl, findAllProvidersForType, findProviderById } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';

import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, stripEditsOnlyFields, isEditsEndpointRejected, type ApiCompatProfile } from '@/lib/api-compatibility';

// 直接模式（OpenAI兼容API返回图片需60-120秒）
// 异步模式（返回task_id只需几秒）两者共存，取较大值
export const maxDuration = 600; // 10分钟 - 部分API生图最久可达600s
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// 动态模型配置 - 不再硬编码任何特定提供商的模型信息
// ---------------------------------------------------------------------------

/**
 * 模型能力配置 - 由 API 兼容层和提供商信息动态推断
 * 不再硬编码特定提供商的模型列表，任何管理员添加的 API 都可自动适配
 */
interface ModelConfig {
  name: string;
  modelId: string;
  // 参数类型: resolution=分辨率(1K/2K/4K), quality=质量(auto/low/medium/high), none=不支持
  paramType: 'resolution' | 'quality' | 'none';
  // 该模型支持的尺寸列表（空数组表示支持所有通用尺寸）
  supportedSizes: string[];
  // 是否支持图生图
  supportsImageToImage: boolean;
  // 最大生成数量
  maxN: number;
  // 模型预估生成时间（秒），用于前端轮询策略
  estimatedTime: number;
}

// 通用支持的尺寸列表
const COMMON_SIZES = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];

/**
 * 根据模型ID和兼容性档案动态推断模型配置
 * - 不依赖任何硬编码的模型列表
 * - 根据模型名称关键词智能推断能力
 * - 所有管理员添加的 API 都可自动适配
 */
function inferModelConfig(modelId: string, profile: ApiCompatProfile, providerName?: string): ModelConfig {
  const id = (modelId || '').toLowerCase();

  // 根据模型名称关键词推断参数类型
  let paramType: ModelConfig['paramType'] = 'none';
  if (id.includes('gpt-image') || id.includes('dall-e')) {
    paramType = 'quality';
  } else if (id.includes('gemini') || id.includes('seedream') || id.includes('doubao') || id.includes('flux')) {
    paramType = 'resolution';
  }

  // 根据模型名称推断是否支持图生图
  // 大多数现代图像模型都支持图生图，只有极少数纯文生图模型不支持
  const supportsImageToImage = !id.includes('text-only') && !id.includes('txt2img-only');

  // 根据模型名称推断预估时间
  let estimatedTime = 30; // 默认30秒
  if (id.includes('flash')) {
    estimatedTime = 15;
  } else if (id.includes('pro') || id.includes('gpt-image')) {
    estimatedTime = 90;
  } else if (id.includes('flux') && id.includes('schnell')) {
    estimatedTime = 10;
  } else if (id.includes('flux') && id.includes('dev')) {
    estimatedTime = 30;
  } else if (id.includes('dall-e-3') || id.includes('dall-e-4')) {
    estimatedTime = 60;
  }

  // 根据兼容性档案调整
  if (profile.responseMode === 'direct') {
    // 直接返回模式的API通常需要更长的单次请求时间
    estimatedTime = Math.max(estimatedTime, 60);
  }

  return {
    name: providerName || modelId,
    modelId,
    paramType,
    supportedSizes: COMMON_SIZES,
    supportsImageToImage,
    maxN: 4,
    estimatedTime,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { 
      prompt, 
      aspectRatio = '1:1', 
      referenceImages, 
      referenceMode, 
      imageCategory, 
      productCategory, 
      stylePreset, 
      outputCount,
      model: rawModel = 'gemini-2.5-flash-image-preview',
      quality = '1K',
      userId: requestUserId,
      strength,
      providerId,
    } = await request.json();
    // 防御性处理：确保 model 是字符串（前端可能误传对象）
    const model = typeof rawModel === 'string' ? rawModel : (rawModel as Record<string, unknown>)?.model as string || String(rawModel || '');

    const sessionUser = await getSessionUser(request);
    const userId = (sessionUser?.id || "anonymous") || requestUserId;

    // 解析参考图片 URL（转换为 API 可访问的格式）
    // 优化：并行处理所有参考图，加速提交
    const accessibleReferenceImages: string[] = [];
    if (referenceImages && Array.isArray(referenceImages)) {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
      
      const resolveImage = async (rawImg: unknown): Promise<string | null> => {
        const img = typeof rawImg === 'string' ? rawImg : (rawImg as { url?: string })?.url || String(rawImg);
        if (!img || typeof img !== 'string' || !img.trim()) return null;

        // 1. 相对路径 → 公网 URL 或 base64
        if (img.startsWith('/')) {
          if (domain) {
            return `https://${domain}${img}`;
          }
          try {
            const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const port = process.env.DEPLOY_RUN_PORT || 5000;
            const resp = await fetch(`${proto}://localhost:${port}${img}`, { signal: AbortSignal.timeout(5000) });
            const buf = Buffer.from(await resp.arrayBuffer());
            return `data:image/png;base64,${buf.toString('base64')}`;
          } catch { /* fallback below */ }
        }
        
        // 2. data: URL — 小于 2MB 直接传递（避免不必要的 save-image 网络往返）
        //    大于 2MB 才 save-image（防止请求体过大导致 413）
        if (img.startsWith('data:')) {
          if (img.length <= 2_000_000) {
            return img; // 直接传递，速度快
          }
          try {
            const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageData: img }),
            });
            if (saveResp.ok) {
              const saveData = await saveResp.json();
              if (saveData.url) {
                return domain ? `https://${domain}${saveData.url}` : saveData.url;
              }
            }
          } catch { /* S3 not available */ }
        }

        // 3. 外部 URL 直接传递
        if (img.startsWith('http')) return img;

        // 4. 兜底
        return domain ? `${domain}${img}` : img;
      };
      
      // 并行处理所有参考图（而非串行）
      const results = await Promise.all(referenceImages.map((ri: unknown) => resolveImage(ri)));
      for (const url of results) {
        if (url) accessibleReferenceImages.push(url);
      }
    }

    // 获取所有可用的 image 类型 API 提供商和模型
    const allImageProviders = await findAllProvidersForType('image');
    
    // 尝试找到用户指定模型对应的 provider（优先使用 providerId 精确匹配）
    let provider = providerId ? await findProviderById(providerId) : null;
    if (!provider) provider = await findProviderForModel(model, 'image');
    let serverApiKey = provider?.apiKey;
    let apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
    
    // 解析兼容性档案 - 决定 API 调用方式
    const initialProfile = resolveCompatProfile(provider);
    let modelConfig = inferModelConfig(model, initialProfile, provider?.displayName);

    // 构建备选模型列表（排除当前模型，优先管理员配置的模型）
    const candidateModels: { modelId: string; apiKey: string; baseUrl: string; providerId: string; displayName: string; advancedParams?: Record<string, string> }[] = [];
    for (const p of allImageProviders) {
      for (const m of p.models) {
        if (m !== model) {
          candidateModels.push({
            modelId: m,
            apiKey: p.provider.apiKey,
            baseUrl: normalizeApiBaseUrl(p.provider.baseUrl),
            providerId: p.provider.id || 'unknown',
            displayName: p.provider.displayName || m,
            advancedParams: p.provider.advancedParams,
          });
        }
      }
    }

    if (!serverApiKey || !apiBaseUrl) {
      // 没有找到指定模型的凭证，尝试使用第一个可用的备选模型
      if (candidateModels.length > 0) {
        const fallback = candidateModels.shift()!;
        console.log(`指定模型 ${model} 无凭证，自动切换到 ${fallback.modelId}`);
        serverApiKey = fallback.apiKey;
        apiBaseUrl = normalizeApiBaseUrl(fallback.baseUrl);
        const fallbackProfile = resolveCompatProfile({ baseUrl: fallback.baseUrl, advancedParams: fallback.advancedParams });
        modelConfig = inferModelConfig(fallback.modelId, fallbackProfile, fallback.displayName);
        provider = {
          id: fallback.providerId,
          name: fallback.displayName,
          apiKey: fallback.apiKey,
          baseUrl: fallback.baseUrl,
          displayName: fallback.displayName,
          isEnabled: true,
          type: 'image' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      } else {
        return NextResponse.json({
          success: false,
          error: `选择当前模型需要在管理员后台配置可用凭证`,
          requiresApiKey: true,
          modelName: modelConfig.name,
        }, { status: 400 });
      }
    }

    // 构建增强的 prompt
    let enhancedPrompt = prompt;
    
    const categoryHints: Record<string, string> = {
      'general': '通用场景',
      'portrait': '人物肖像，面部细节精细',
      'landscape': '风景摄影，自然光影',
      'architecture': '建筑摄影，透视精准',
      'product': '产品摄影，商业级质感',
      'food': '美食摄影，色彩诱人',
      'fashion': '时尚摄影，杂志质感',
      'animal': '动物摄影，生动自然',
    };
    
    if (imageCategory && categoryHints[imageCategory] && imageCategory !== 'general') {
      enhancedPrompt = `${enhancedPrompt}, ${categoryHints[imageCategory]}`;
    }
    
    if (productCategory && productCategory.trim()) {
      enhancedPrompt = `${enhancedPrompt}, product category: ${productCategory}`;
    }
    
    const styleHints: Record<string, string> = {
      'photography': '摄影质感，专业相机拍摄效果',
      '3d_render': '3D渲染效果，CG质感',
      'anime': '动漫风格，二次元',
      'illustration': '插画风格，手绘质感',
      'watercolor': '水彩画风格，柔和通透',
      'oil_painting': '油画质感，笔触感强',
      'ink_painting': '水墨国风，传统东方美学',
      'cyberpunk': '赛博朋克风格，霓虹科技',
      'minimalist': '极简风格，留白大方',
      'vintage': '复古怀旧，胶片质感',
      'luxury': '高端奢华，金色质感',
      'cartoon': '卡通可爱，萌系风格',
    };
    
    if (stylePreset !== 'auto' && styleHints[stylePreset]) {
      enhancedPrompt = `${enhancedPrompt}，${styleHints[stylePreset]}`;
    }

    // 融合模式增强提示词 - 明确指导模型如何融合参考图
    if (referenceMode === 'fusion' && referenceImages && referenceImages.length > 1) {
      enhancedPrompt = `[FUSION MODE] Combine and merge ${referenceImages.length} reference images into a single cohesive composition. ${enhancedPrompt}. Seamlessly blend all visual elements together, maintaining the key characteristics of each reference while creating a unified, natural result.`;
    }

    // 验证尺寸是否支持
    const requestedSize = aspectRatio || '1:1';
    
    // 设置生成数量 - 不受模型maxN限制，因为我们逐个提交任务(n=1)
    const count = outputCount && outputCount >= 1 ? Math.min(outputCount, 10) : 1;

    // 构建提交单个任务的辅助函数（返回 taskId 或抛出可重试错误）
    const submitSingleTask = async (
      currentModelConfig: ModelConfig,
      currentApiKey: string,
      currentApiBaseUrl: string,
      currentProviderId: string,
      currentProvider?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null,
    ): Promise<{ taskId: string; usedModel: string; usedProviderId: string; directImageUrl?: string }> => {
      // 解析兼容性档案 - 由提供商配置决定 API 调用方式
      const profile: ApiCompatProfile = resolveCompatProfile(currentProvider);

      let effectiveSize = currentModelConfig.supportedSizes.includes(requestedSize) 
        ? requestedSize 
        : currentModelConfig.supportedSizes[0] || '1:1';

      const requestBody: Record<string, unknown> = {
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt,
        size: effectiveSize,
        n: 1,
      };

      // 根据模型参数类型添加质量/分辨率参数
      if (currentModelConfig.paramType === 'resolution' && quality) {
        requestBody.resolution = quality;
      } else if (currentModelConfig.paramType === 'quality' && quality) {
        const qualityMap: Record<string, string> = {
          '1K': 'low', '2K': 'medium', '4K': 'high',
          'standard': 'auto', 'high': 'high', 'auto': 'auto',
          'low': 'low', 'medium': 'medium',
        };
        requestBody.quality = qualityMap[quality] || quality;
      }

      // 添加参考图片
      const hasRefImages = accessibleReferenceImages.length > 0 && currentModelConfig.supportsImageToImage;
      if (hasRefImages) {
        // 始终提供 image_urls（大多数 API 代理支持此字段传递参考图 URL）
        requestBody.image_urls = accessibleReferenceImages;
        // 图生图 strength 参数
        if (typeof strength === 'number' && strength > 0 && strength <= 1) {
          requestBody.strength = strength;
        }
        // 为 /images/edits 端点同时提供 image 字段（base64 格式）
        // /images/edits 将 image 视为必须编辑的源图（AI 无法忽略），而 image_urls 是可选参考
        const firstRefImage = accessibleReferenceImages[0];
        if (firstRefImage) {
          if (firstRefImage.startsWith('data:')) {
            // 已经是 base64 data URL，直接使用
            requestBody.image = firstRefImage;
          } else if (firstRefImage.startsWith('http')) {
            // 外部 URL，需要下载为 base64
            try {
              const imgResp = await fetch(firstRefImage, { signal: AbortSignal.timeout(15000) });
              if (imgResp.ok) {
                const imgBuf = Buffer.from(await imgResp.arrayBuffer());
                const contentType = imgResp.headers.get('content-type') || 'image/png';
                requestBody.image = `data:${contentType};base64,${imgBuf.toString('base64')}`;
              }
            } catch (imgErr) {
              console.warn('Failed to download reference image for edits endpoint:', imgErr);
            }
          }
        }
      }

      // 使用兼容性层自动调整请求（size格式、端点选择等）
      const { body: adjustedBody, endpoint } = adjustRequestForProfile(requestBody, profile, {
        hasImage: hasRefImages,
      });

      console.log('Submitting image task:', {
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt.substring(0, 50) + '...',
        size: adjustedBody.size,
        endpoint,
        profile: profile.id,
        hasRefImages,
        hasImageField: !!adjustedBody.image,
        inputFidelity: adjustedBody.input_fidelity,
        refImageTypes: accessibleReferenceImages.map(u => u.startsWith('data:') ? 'base64' : u.startsWith('http') ? 'url' : 'other'),
        strength: adjustedBody.strength || undefined,
      });

      // 根据兼容性档案确定超时时间
      const isDirectMode = profile.responseMode === 'direct';
      const controller = new AbortController();
      const timeoutMs = isDirectMode ? 600000 : 30000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // 构建提交请求 - 通用策略，适配所有 API 提供商
      const isEditsEndpoint = endpoint === '/images/edits';
      const hasImageField = !!adjustedBody.image;

      // 辅助函数：解析提交响应
      const parseSubmitResponse = async (resp: Response): Promise<{ taskId: string; usedModel: string; usedProviderId: string; directImageUrl?: string }> => {
        if (!resp.ok) {
          const errorText = await resp.text();
          console.error('API submit error:', resp.status, errorText);
          
          let errorMsg = `API 请求失败 (${resp.status})`;
          let errorCode = '';
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              errorMsg = errorJson.error.message;
            }
            if (errorJson.error?.code) {
              errorCode = errorJson.error.code;
            }
          } catch { /* ignore */ }

          // 通用可重试错误检测 - 不针对特定提供商
          if (errorMsg.includes('ratio or price') || errorMsg.includes('not configured') || errorMsg.includes('model_not_found') || errorMsg.includes('model not found') || errorCode === 'model_not_found') {
            const retryErr = new Error(`当前模型暂不可用`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          if (errorMsg.includes('Insufficient balance') || errorMsg.includes('insufficient') || errorMsg.includes('余额')) {
            throw new Error(`API 余额不足，请联系管理员充值`);
          }
          if (errorMsg.includes('Rate limit') || errorMsg.includes('rate_limit') || errorMsg.includes('Too many requests')) {
            throw new Error(`请求过于频繁，请稍后再试`);
          }
          if (errorMsg.includes('Invalid API key') || errorMsg.includes('invalid api_key') || errorMsg.includes('Incorrect API key')) {
            throw new Error(`API 密钥无效，请联系管理员检查配置`);
          }
          
          throw new Error(errorMsg);
        }

        // 解析响应 — 防止 API 返回 HTML 页面（如 404/502 错误页）导致 JSON 解析失败
        const responseText = await resp.text();
        let submitResult: Record<string, unknown>;
        try {
          submitResult = JSON.parse(responseText);
        } catch (parseErr) {
          console.error('[generate] API returned non-JSON response, first 200 chars:', responseText.substring(0, 200));
          throw new Error('API 返回了非 JSON 响应（可能是端点不存在或服务器错误），请检查 API 地址配置');
        }

        // 使用兼容性层解析响应（自动识别直接返回 vs 异步轮询）
        const parsed = parseResponseForProfile(submitResult, profile);

        if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
          console.log('Direct image response (no polling needed), profile:', profile.id);
          return {
            taskId: `direct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            usedModel: currentModelConfig.modelId,
            usedProviderId: currentProviderId,
            directImageUrl: parsed.directImageUrls[0],
          };
        }

        // 异步任务格式
        if (parsed.taskIds.length > 0) {
          const taskId = parsed.taskIds[0];
          console.log('Got task_id:', taskId, 'profile:', profile.id);
          return { taskId, usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
        }

        console.error('No task_id or direct image in response:', submitResult);
        throw new Error('未获取到任务ID或图片数据');
      };

      // 辅助函数：构建 multipart/form-data
      const buildMultipartBody = (): FormData => {
        const formData = new FormData();
        for (const [key, value] of Object.entries(adjustedBody)) {
          if (value === undefined || value === null) continue;
          if (key === 'image') {
            const imgVal = String(value);
            if (imgVal.startsWith('data:')) {
              const match = imgVal.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const binaryData = Buffer.from(base64Data, 'base64');
                const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                const file = new File([binaryData], `image.${ext}`, { type: mimeType });
                formData.append('image', file);
              }
            } else {
              const binaryData = Buffer.from(imgVal, 'base64');
              const file = new File([binaryData], 'image.png', { type: 'image/png' });
              formData.append('image', file);
            }
          } else if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(key, String(item));
            }
          } else {
            formData.append(key, String(value));
          }
        }
        return formData;
      };

      let submitResponse: Response;

      if (isEditsEndpoint && hasImageField) {
        // /images/edits + image 字段：先尝试 JSON（兼容更多代理），失败后降级到 multipart
        submitResponse = await fetchWithV1Retry(
          currentApiBaseUrl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
          }
        );

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();

          // 检查是否是不支持 /images/edits 端点的错误 → 自动回退到 /images/generations
          if (isEditsEndpointRejected(submitResponse.status, errorText)) {
            console.info('[generate] /images/edits rejected by API, auto-falling back to /images/generations with image_urls only...');
            clearTimeout(timeoutId);

            const fallbackController = new AbortController();
            const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), timeoutMs);

            const fallbackBody = stripEditsOnlyFields(adjustedBody);
            submitResponse = await fetchWithV1Retry(
              currentApiBaseUrl,
              '/images/generations',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${currentApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(fallbackBody),
                signal: fallbackController.signal,
              }
            );

            clearTimeout(fallbackTimeoutId);
          } else {
            // 检查是否需要 multipart 编码
            const needsMultipart = errorText.includes('multipart') ||
              errorText.includes('form-data') ||
              errorText.includes('Content-Type') ||
              errorText.includes('expected multipart') ||
              errorText.includes('no file') ||
              errorText.includes('file required') ||
              errorText.includes('Missing image');

            if (needsMultipart) {
              console.info('[generate] JSON failed for edits endpoint, retrying with multipart form data...');
              clearTimeout(timeoutId);

              const multipartController = new AbortController();
              const multipartTimeoutId = setTimeout(() => multipartController.abort(), timeoutMs);

              submitResponse = await fetchWithV1Retry(
                currentApiBaseUrl,
                endpoint,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${currentApiKey}`,
                  },
                  body: buildMultipartBody(),
                  signal: multipartController.signal,
                }
              );

              clearTimeout(multipartTimeoutId);
            } else {
              clearTimeout(timeoutId);
            }
          }
        } else {
          clearTimeout(timeoutId);
        }
      } else {
        // /images/generations 或无 image 字段：标准 JSON 编码
        submitResponse = await fetchWithV1Retry(
          currentApiBaseUrl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);
      }

      return parseSubmitResponse(submitResponse);
    };

    const taskIds: string[] = [];
    const directImageUrls: string[] = [];
    let usedModelName = modelConfig.name;
    let usedModelId = modelConfig.modelId;
    let usedProviderId = provider?.id || 'env';

    // 提交所有生成任务（带自动重试逻辑）
    for (let i = 0; i < count; i++) {
      let submitted = false;
      
      // 先用当前模型尝试
      try {
        const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', provider);
        if (result.directImageUrl) {
          directImageUrls.push(result.directImageUrl);
        } else if (result.taskId) {
          taskIds.push(result.taskId);
        }
        usedModelId = result.usedModel;
        usedProviderId = result.usedProviderId;
        await appendUserJsonl(userId, 'images', {
          type: 'submit',
          providerId: usedProviderId,
          model: usedModelId,
          taskId: result.taskId,
          prompt: enhancedPrompt,
        });
        submitted = true;
      } catch (singleError: unknown) {
        const errMsg = singleError instanceof Error ? singleError.message : String(singleError);
        const isRetryable = singleError instanceof Error && (singleError as Error & { retryable?: boolean }).retryable;
        
        if (isRetryable && candidateModels.length > 0) {
          console.log(`模型 ${modelConfig.modelId} 不可用 (${errMsg})，尝试备选模型...`);
          
          for (let ci = 0; ci < candidateModels.length; ci++) {
            const candidate = candidateModels[ci];
            const candidateProfile = resolveCompatProfile({ baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
            const candidateConfig = inferModelConfig(candidate.modelId, candidateProfile, candidate.displayName);
            
            try {
              console.log(`尝试备选模型 ${candidate.modelId} (${ci + 1}/${candidateModels.length})...`);
              const result = await submitSingleTask(candidateConfig, candidate.apiKey, candidate.baseUrl, candidate.providerId, { baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
              if (result.directImageUrl) {
                directImageUrls.push(result.directImageUrl);
              } else if (result.taskId) {
                taskIds.push(result.taskId);
              }
              usedModelId = result.usedModel;
              usedModelName = candidateConfig.name;
              usedProviderId = result.usedProviderId;
              await appendUserJsonl(userId, 'images', {
                type: 'submit',
                providerId: usedProviderId,
                model: usedModelId,
                taskId: result.taskId || 'direct',
                prompt: enhancedPrompt,
              });
              submitted = true;
              console.log(`备选模型 ${candidate.modelId} 提交成功`);
              break;
            } catch (candidateError: unknown) {
              const cErrMsg = candidateError instanceof Error ? candidateError.message : String(candidateError);
              const cIsRetryable = candidateError instanceof Error && (candidateError as Error & { retryable?: boolean }).retryable;
              console.log(`备选模型 ${candidate.modelId} 也失败: ${cErrMsg}`);
              if (cIsRetryable) {
                continue;
              }
              throw candidateError;
            }
          }
        }
        
        if (!submitted) {
          if (errMsg.includes('abort') || errMsg.includes('timeout')) {
            return NextResponse.json({
              success: false,
              error: '提交任务超时，请检查网络后重试',
              networkError: true,
            }, { status: 504 });
          }
          
          if (i === 0) {
            return NextResponse.json({
              success: false,
              error: `${usedModelName} 提交失败: ${errMsg}`,
              modelName: usedModelName,
            }, { status: 500 });
          }
        }
      }
    }

    if (taskIds.length === 0 && directImageUrls.length === 0) {
      return NextResponse.json({
        success: false,
        error: `所有可用模型均提交失败，请稍后重试或联系管理员配置`,
        modelName: usedModelName,
      }, { status: 500 });
    }

    // 如果有直接返回的图片URL，直接返回结果
    if (directImageUrls.length > 0) {
      return NextResponse.json({
        success: true,
        mode: 'direct',
        imageUrls: directImageUrls,
        model: usedModelId,
        modelName: usedModelName,
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        category: imageCategory,
        style: stylePreset,
        count: directImageUrls.length,
      });
    }

    // 返回task_ids给前端，由前端负责轮询
    return NextResponse.json({
      success: true,
      mode: 'polling',
      taskIds,
      model: usedModelId,
      modelName: usedModelName,
      estimatedTime: modelConfig.estimatedTime,
      prompt: enhancedPrompt,
      originalPrompt: prompt,
      category: imageCategory,
      style: stylePreset,
      count: taskIds.length,
    });

  } catch (apiError: unknown) {
    const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
    console.error('Image generation API error:', errMsg);
    
    if (errMsg.includes('abort') || errMsg.includes('timeout')) {
      return NextResponse.json({
        success: false,
        error: '提交任务超时，请检查网络后重试',
        networkError: true,
      }, { status: 504 });
    }

    if (errMsg.includes('fetch failed') || 
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND')) {
      return NextResponse.json({
        success: false,
        error: '网络连接失败：无法访问图像生成 API。请检查网络连接或管理员配置。',
        networkError: true,
      }, { status: 503 });
    }
    
    if (errMsg.includes('401') || errMsg.includes('Incorrect API key') || errMsg.includes('authentication')) {
      return NextResponse.json({
        success: false,
        error: '管理员后台配置的模型凭证无效或已过期',
      }, { status: 401 });
    }
    
    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate_limit')) {
      return NextResponse.json({
        success: false,
        error: 'API 调用次数已达上限，请稍后再试',
      }, { status: 429 });
    }

    if (errMsg.includes('402') || errMsg.includes('insufficient') || errMsg.includes('余额')) {
      return NextResponse.json({
        success: false,
        error: 'API 账户余额不足，请联系管理员充值',
      }, { status: 402 });
    }

    return NextResponse.json({
      success: false,
      error: `生成失败: ${errMsg}`,
    }, { status: 500 });
  }
}
