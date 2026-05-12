import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, normalizeApiBaseUrl, findAllProvidersForType } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';

// 只需要短超时用于提交任务，轮询由前端负责
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// APIMart 模型配置 - 所有模型已通过实际API验证测试
// 测试日期: 2026-04-30
// 所有模型均使用统一端点: POST /images/generations (baseUrl由用户提供，如包含/v1则为 /v1/images/generations)
// 轮询由前端通过 /api/poll-task 完成，避免服务器超时
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

const APIMART_MODEL_CONFIG: Record<string, ModelConfig> = {
  // === Gemini 系列 (Google) ===
  'gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash',
    modelId: 'gemini-2.5-flash-image-preview',
    paramType: 'resolution',
    supportedSizes: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsImageToImage: true,
    maxN: 4,
    estimatedTime: 15, // Flash模型最快，通常10-20秒
  },
  'gemini-3-pro-image-preview': {
    name: 'Gemini 3 Pro',
    modelId: 'gemini-3-pro-image-preview',
    paramType: 'resolution',
    supportedSizes: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsImageToImage: true,
    maxN: 4,
    estimatedTime: 90, // Pro模型较慢，4K可达90秒
  },
  'gemini-3.1-flash-image-preview': {
    name: 'Gemini 3.1 Flash',
    modelId: 'gemini-3.1-flash-image-preview',
    paramType: 'resolution',
    supportedSizes: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsImageToImage: true,
    maxN: 4,
    estimatedTime: 65, // 3.1 Flash中等速度，4K约60秒
  },

  // === Seedream (豆包/字节) ===
  'doubao-seedance-4-5': {
    name: 'Seedream 4.5',
    modelId: 'doubao-seedance-4-5',
    paramType: 'resolution',
    supportedSizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
    supportsImageToImage: true,
    maxN: 1,
    estimatedTime: 20, // 豆包较快，通常15-25秒
  },

  // === GPT-Image (OpenAI) ===
  'gpt-image-2-official': {
    name: 'GPT-Image 2',
    modelId: 'gpt-image-2-official',
    paramType: 'quality',
    supportedSizes: ['1:1', '3:2', '2:3'],
    supportsImageToImage: true,
    maxN: 4,
    estimatedTime: 120, // GPT-Image 2 high质量极慢，可达180+秒
  },
};

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
      model = 'gemini-2.5-flash-image-preview',
      quality = '1K',
      userId: requestUserId,
      strength,
    } = await request.json();
    const sessionUser = await getSessionUser(request);
    const userId = (sessionUser?.id || "anonymous") || requestUserId;

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 转换参考图片 URL 为公网可访问格式（APImart 无法访问本地路径）
    let accessibleReferenceImages: string[] = [];
    if (referenceImages && referenceImages.length > 0) {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
      for (const img of referenceImages) {
        if (img.startsWith('/')) {
          // 相对路径 → 公网完整 URL 或 base64
          if (domain) {
            accessibleReferenceImages.push(`${domain}${img}`);
          } else {
            try {
              const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
              const port = process.env.DEPLOY_RUN_PORT || 5000;
              const resp = await fetch(`${proto}://localhost:${port}${img}`, { signal: AbortSignal.timeout(5000) });
              const buf = Buffer.from(await resp.arrayBuffer());
              accessibleReferenceImages.push(`data:image/png;base64,${buf.toString('base64')}`);
            } catch {
              accessibleReferenceImages.push(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${img}`);
            }
          }
        } else {
          accessibleReferenceImages.push(img);
        }
      }
    }

    // 获取所有可用的 image 类型 API 提供商和模型
    const allImageProviders = await findAllProvidersForType('image');
    
    // 尝试找到用户指定模型对应的 provider
    let provider = await findProviderForModel(model, 'image');
    let serverApiKey = provider?.apiKey || process.env.APIMART_API_KEY;
    let apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || process.env.APIMART_BASE_URL || 'https://api.apimart.ai');
    let modelConfig = APIMART_MODEL_CONFIG[model] || {
      name: provider?.displayName || model,
      modelId: model,
      paramType: 'none' as const,
      supportedSizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
      supportsImageToImage: true,
      maxN: 4,
      estimatedTime: 30,
    };

    // 构建备选模型列表（排除当前模型，优先管理员配置的模型）
    const candidateModels: { modelId: string; apiKey: string; baseUrl: string; providerId: string; displayName: string }[] = [];
    for (const p of allImageProviders) {
      for (const m of p.models) {
        if (m !== model) {
          candidateModels.push({
            modelId: m,
            apiKey: p.provider.apiKey,
            baseUrl: normalizeApiBaseUrl(p.provider.baseUrl),
            providerId: p.provider.id || 'unknown',
            displayName: p.provider.displayName || m,
          });
        }
      }
    }

    if (!serverApiKey) {
      // 没有找到指定模型的凭证，尝试使用第一个可用的备选模型
      if (candidateModels.length > 0) {
        const fallback = candidateModels.shift()!;
        console.log(`指定模型 ${model} 无凭证，自动切换到 ${fallback.modelId}`);
        serverApiKey = fallback.apiKey;
        apiBaseUrl = normalizeApiBaseUrl(fallback.baseUrl);
        modelConfig = APIMART_MODEL_CONFIG[fallback.modelId] || {
          name: fallback.displayName || fallback.modelId,
          modelId: fallback.modelId,
          paramType: 'none' as const,
          supportedSizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
          supportsImageToImage: true,
          maxN: 4,
          estimatedTime: 30,
        };
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
          docsUrl: 'https://docs.apimart.ai/cn',
        }, { status: 400 });
      }
    }

    // 构建增强的 prompt
    let enhancedPrompt = prompt;
    
    const categoryHints: Record<string, string> = {
      'poster': '海报风格，高对比度，视觉冲击力强',
      'logo': 'Logo设计，简洁有力，易于识别',
      'detail_page': '电商详情页，清晰展示产品细节',
      'ip_character': 'IP形象，活泼可爱，辨识度高',
      'display': '展陈设计，空间感强，氛围营造',
      'social': '社交媒体配图，适合传播分享',
      'ui': 'UI界面设计，现代简洁',
      'comic': '插画风格，叙事性强',
      'infographic': '信息图表，数据可视化',
      'menu': '菜单设计，排版美观',
      'packaging': '包装设计，立体感强',
      'photo': '写实摄影，质感真实',
      'banner': 'Banner广告，简洁醒目',
    };
    
    if (categoryHints[imageCategory]) {
      enhancedPrompt = `${categoryHints[imageCategory]}，${enhancedPrompt}`;
    }

    const productKeywords: Record<string, string[]> = {
      'baijiu': ['白酒', '中国白酒', '传统酿造', '金色', '红色', '大气'],
      'beer': ['啤酒', '精酿啤酒', '清爽', '泡沫', '年轻活力'],
      'foreign_wine': ['红酒', '葡萄酒', '浪漫', '优雅', '紫红色'],
      'liquor': ['威士忌', '烈酒', '成熟', '琥珀色', '绅士'],
      'cocktail': ['鸡尾酒', '调酒', '缤纷色彩', '时尚', '派对'],
      'tea': ['茶', '茶叶', '禅意', '清新', '传统文化'],
      'coffee': ['咖啡', '精品咖啡', '温暖', '小资', '文艺'],
      'food': ['美食', '佳肴', '食欲', '精致摆盘', '热气腾腾'],
      'cosmetics': ['化妆品', '美妆', '精致', '优雅', '粉色'],
      'electronics': ['电子产品', '科技', '智能', '未来', '质感'],
      'fashion': ['时尚', '服装', '潮流', '个性', '高级'],
    };
    
    if (productCategory !== 'none' && productKeywords[productCategory]) {
      const keywords = productKeywords[productCategory].join('，');
      enhancedPrompt = `${enhancedPrompt}，${keywords}`;
    }

    const styleHints: Record<string, string> = {
      'realistic': '写实风格，照片级逼真',
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
    const apimartSize = aspectRatio || '1:1';
    
    // 设置生成数量 - 不受模型maxN限制，因为我们逐个提交任务(n=1)
    const count = outputCount && outputCount >= 1 ? Math.min(outputCount, 10) : 1;

    // 构建提交单个任务的辅助函数（返回 taskId 或抛出可重试错误）
    const submitSingleTask = async (
      currentModelConfig: ModelConfig,
      currentApiKey: string,
      currentApiBaseUrl: string,
      currentProviderId: string,
    ): Promise<{ taskId: string; usedModel: string; usedProviderId: string }> => {
      const effectiveSize = currentModelConfig.supportedSizes.includes(apimartSize) 
        ? apimartSize 
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

      // 添加参考图片（使用已转换为公网可访问的 URL）
      if (accessibleReferenceImages.length > 0 && currentModelConfig.supportsImageToImage) {
        requestBody.image_urls = accessibleReferenceImages;
        // 图生图 strength 参数：控制输出与参考图的偏离程度（0=完全保留原图，1=完全自由生成）
        if (typeof strength === 'number' && strength > 0 && strength <= 1) {
          requestBody.strength = strength;
        }
      }

      console.log('Submitting to APIMart:', {
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt.substring(0, 50) + '...',
        size: effectiveSize,
        paramType: currentModelConfig.paramType,
        hasRefImages: accessibleReferenceImages.length > 0,
        refImageTypes: accessibleReferenceImages.map(u => u.startsWith('data:') ? 'base64' : u.startsWith('http') ? 'url' : 'other'),
        strength: requestBody.strength || undefined,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const submitResponse = await fetchWithV1Retry(
        currentApiBaseUrl,
        '/images/generations',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error('APIMart submit error:', submitResponse.status, errorText);
        
        let errorMsg = `API 请求失败 (${submitResponse.status})`;
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

        // "ratio or price is not configured" → 标记为可重试错误，由外层自动切换模型
        if (errorMsg.includes('ratio or price is not configured') || errorMsg.includes('ratio or price')) {
          const retryErr = new Error(`当前模型暂不可用`);
          (retryErr as Error & { retryable?: boolean }).retryable = true;
          throw retryErr;
        }
        if (errorMsg.includes('model not found') || errorMsg.includes('Model not found') || errorCode === 'model_not_found') {
          const retryErr = new Error(`模型不存在或已下线`);
          (retryErr as Error & { retryable?: boolean }).retryable = true;
          throw retryErr;
        }
        if (errorMsg.includes('Insufficient balance') || errorMsg.includes('insufficient')) {
          throw new Error(`API 余额不足，请联系管理员充值`);
        }
        if (errorMsg.includes('Rate limit') || errorMsg.includes('rate_limit') || errorMsg.includes('Too many requests')) {
          throw new Error(`请求过于频繁，请稍后再试`);
        }
        if (errorMsg.includes('Invalid API key') || errorMsg.includes('invalid api_key')) {
          throw new Error(`API 密钥无效，请联系管理员检查配置`);
        }
        
        throw new Error(errorMsg);
      }

      const submitResult = await submitResponse.json();
      console.log('Submit result:', submitResult);

      const taskId = submitResult.data?.[0]?.task_id;
      if (!taskId) {
        console.error('No task_id in response:', submitResult);
        throw new Error('未获取到任务ID');
      }

      console.log('Got task_id:', taskId);
      return { taskId, usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
    }

    const taskIds: string[] = [];
    let usedModelName = modelConfig.name;
    let usedModelId = modelConfig.modelId;
    let usedProviderId = provider?.id || 'env';

    // 提交所有生成任务（带自动重试逻辑）
    for (let i = 0; i < count; i++) {
      let submitted = false;
      
      // 先用当前模型尝试
      try {
        const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env');
        taskIds.push(result.taskId);
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
          // 当前模型不可用，尝试备选模型
          console.log(`模型 ${modelConfig.modelId} 不可用 (${errMsg})，尝试备选模型...`);
          
          for (let ci = 0; ci < candidateModels.length; ci++) {
            const candidate = candidateModels[ci];
            const candidateConfig = APIMART_MODEL_CONFIG[candidate.modelId] || {
              name: candidate.displayName || candidate.modelId,
              modelId: candidate.modelId,
              paramType: 'none' as const,
              supportedSizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
              supportsImageToImage: true,
              maxN: 4,
              estimatedTime: 30,
            };
            
            try {
              console.log(`尝试备选模型 ${candidate.modelId} (${ci + 1}/${candidateModels.length})...`);
              const result = await submitSingleTask(candidateConfig, candidate.apiKey, candidate.baseUrl, candidate.providerId);
              taskIds.push(result.taskId);
              usedModelId = result.usedModel;
              usedModelName = candidateConfig.name;
              usedProviderId = result.usedProviderId;
              await appendUserJsonl(userId, 'images', {
                type: 'submit',
                providerId: usedProviderId,
                model: usedModelId,
                taskId: result.taskId,
                prompt: enhancedPrompt,
              });
              submitted = true;
              console.log(`备选模型 ${candidate.modelId} 提交成功`);
              break; // 成功，跳出备选模型循环
            } catch (candidateError: unknown) {
              const cErrMsg = candidateError instanceof Error ? candidateError.message : String(candidateError);
              const cIsRetryable = candidateError instanceof Error && (candidateError as Error & { retryable?: boolean }).retryable;
              console.log(`备选模型 ${candidate.modelId} 也失败: ${cErrMsg}`);
              if (cIsRetryable) {
                continue; // 继续尝试下一个备选模型
              }
              // 非可重试错误（余额不足、频率限制等），直接抛出
              throw candidateError;
            }
          }
        }
        
        if (!submitted) {
          // 网络超时错误
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

    if (taskIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: `所有可用模型均提交失败，请稍后重试或联系管理员配置`,
        modelName: usedModelName,
      }, { status: 500 });
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

  } catch (apimartError: unknown) {
    const errMsg = apimartError instanceof Error ? apimartError.message : String(apimartError);
    console.error('APIMart API error:', errMsg);
    
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
        error: '网络连接失败：无法访问 APIMart API。请检查网络连接。',
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
        error: 'APIMart 账户余额不足，请充值后再试',
      }, { status: 402 });
    }

    return NextResponse.json({
      success: false,
      error: `生成失败: ${errMsg}`,
    }, { status: 500 });
  }
}
