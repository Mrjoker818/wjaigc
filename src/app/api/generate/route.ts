import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, normalizeApiBaseUrl, findAllProvidersForType, findProviderById } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { identifyImageSubject } from '@/lib/identify-subject';
import { optionalApiAuth } from '@/lib/api-auth';
import { translateApiError } from '@/lib/api-error-translate';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { consumeCredits } from '@/lib/credits';

import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, stripEditsOnlyFields, isEditsEndpointRejected, type ApiCompatProfile, resolveProfileForModel, isGeminiImageModel, isNanoBananaModel, buildGeminiChatImageRequest, parseGeminiChatImageResponse, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { persistRemoteImage } from '@/lib/s3-storage';

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
  } else if (id.includes('nano-banana') || id.includes('nanobanana')) {
    // PearAPI nano-banana 系列：基于 Gemini 的图像模型，使用分辨率参数
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
  await optionalApiAuth(request);
  try {
    const {
      prompt,
      aspectRatio = '1:1',
      referenceImages,
      referenceMode,
      referenceCategories,
      referenceStrengths,
      referenceDescriptions,
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

    // Content safety check
    const safetyResult = checkPromptSafety(prompt || '');
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    const sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

    // 解析参考图片 URL（转换为 API 可访问的格式）
    // 优化：并行处理所有参考图，加速提交
    const accessibleReferenceImages: string[] = [];
    if (referenceImages && Array.isArray(referenceImages)) {
      // 确保域名不重复包含协议：COZE_PROJECT_DOMAIN_DEFAULT 可能已含 https://
      const rawDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      const domainBase = rawDomain.replace(/\/+$/, ''); // 去掉尾部斜杠

      const resolveImage = async (rawImg: unknown): Promise<string | null> => {
        const img = typeof rawImg === 'string' ? rawImg : (rawImg as { url?: string })?.url || String(rawImg);
        if (!img || typeof img !== 'string' || !img.trim()) return null;

        // 1. 相对路径 → 公网 URL 或 base64
        if (img.startsWith('/')) {
          if (domainBase) {
            // 确保不重复添加协议
            const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
            return `${base}${img}`;
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
                if (domainBase) {
                  const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
                  return `${base}${saveData.url}`;
                }
                return saveData.url;
              }
            }
          } catch { /* S3 not available */ }
        }

        // 3. 外部 URL 直接传递
        if (img.startsWith('http')) return img;

        // 4. 兜底 — 确保 URL 有协议前缀且不重复
        if (domainBase) {
          const base = domainBase.startsWith('http') ? domainBase : `https://${domainBase}`;
          const path = img.startsWith('/') ? img : `/${img}`;
          return `${base}${path}`;
        }
        return img;
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
    if (provider && !(provider.selectedModels || []).includes(model)) {
      console.warn(`[generate] ⚠️ providerId="${providerId}" 找到提供商 "${provider.displayName || provider.name}"，但该提供商的 selectedModels 不包含 "${model}"，仍使用此提供商`);
    }
    if (!provider) {
      console.warn(`[generate] ⚠️ providerId="${providerId}" 未匹配到提供商，回退到 findProviderForModel(model="${model}")`);
      provider = await findProviderForModel(model, 'image');
    }
    let serverApiKey = provider?.apiKey;
    let apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || '');
    
    // ★ 关键日志：记录实际使用的提供商信息，便于追踪
    console.log(`[generate] 提供商选择: model="${model}", requestedProviderId="${providerId}", matched="${provider?.displayName || provider?.name || 'none'}", matchedId="${provider?.id || 'none'}", baseUrl="${apiBaseUrl}", hasApiKey=${!!serverApiKey}`);
    
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

    // 积分扣除（移到凭证验证之后，避免凭证无效时误扣积分）
    if (sessionUser) {
      const modelId = model || '';
      const creditResult = await consumeCredits(sessionUser.id, 'image_generate', undefined, undefined, modelId, { quality });
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
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

    // ── Auto-identify reference image subjects via AI vision ──
    // When referenceImages exist but lack descriptions, use AI vision to identify
    // what's in the image, preventing subject misidentification (e.g. medicine→cosmetics)
    const refDescArr: string[] = Array.isArray(referenceDescriptions)
      ? referenceDescriptions.filter((d: string) => d && typeof d === 'string' && d.trim())
      : [];

    if (referenceImages && referenceImages.length > 0) {
      // Identify any reference images that don't have descriptions
      const imagesNeedingId = referenceImages.filter((_: string, i: number) => !refDescArr[i] || !refDescArr[i].trim());
      if (imagesNeedingId.length > 0) {
        console.info(`[generate] Auto-identifying ${imagesNeedingId.length} reference image(s) via AI vision`);
        try {
          // Identify images in parallel (with concurrency limit of 2)
          const identifyPromises = imagesNeedingId.map(async (imgUrl: string, idx: number) => {
            try {
              const result = await identifyImageSubject(imgUrl, 10000);
              return result ? result.en : null;
            } catch (err) {
              console.warn(`[generate] Vision identification failed for image ${idx}:`, err);
              return null;
            }
          });
          const identifiedResults = await Promise.all(identifyPromises);

          // Fill in identified descriptions for images that lacked them
          let identifiedIdx = 0;
          for (let i = 0; i < referenceImages.length; i++) {
            if (!refDescArr[i] || !refDescArr[i].trim()) {
              const identified = identifiedResults[identifiedIdx++];
              if (identified) {
                refDescArr[i] = identified;
              }
            }
          }
          console.info(`[generate] Identified subjects: ${refDescArr.filter(Boolean).join('; ')}`);
        } catch (err) {
          console.warn('[generate] Batch vision identification failed (non-critical):', err);
        }
      }
    }
    const refDescText = refDescArr.filter(Boolean).join('; ');

    // 融合模式增强提示词 - 明确指导模型如何融合参考图
    if (referenceMode === 'fusion' && referenceImages && referenceImages.length > 1) {
      const fusionDescHint = refDescText ? ` The reference images depict: "${refDescText}".` : '';
      enhancedPrompt = `[FUSION MODE] Combine and merge ${referenceImages.length} reference images into a single cohesive composition.${fusionDescHint} ${enhancedPrompt}. Seamlessly blend all visual elements together, maintaining the key characteristics of each reference while creating a unified, natural result.`;
    }

    // 无分类但有参考图描述时的增强（前端图生图面板路径，不传 referenceCategories）
    if (referenceImages && referenceImages.length > 0 && !referenceCategories) {
      if (refDescText) {
        enhancedPrompt = `[REFERENCE MODE] The reference image depicts: "${refDescText}". You MUST preserve the main subject identity — do NOT replace it with a different object. ${enhancedPrompt}`;
      }
    }

    // 参考图分类增强 - 基于前端传递的分类和强度，增强提示词让AI正确理解参考意图
    if (referenceImages && referenceImages.length > 0 && referenceCategories) {
      // 规范化分类键：中文→英文
      const normalizeCategory = (key: string): string => {
        const cnToEn: Record<string, string> = {
          '风格': 'style', '构图': 'composition', '场景': 'scene',
          '色彩': 'color', '主体': 'subject', '细节': 'detail',
        };
        return cnToEn[key] || key;
      };

      // 英文分类描述
      const categoryDescMap: Record<string, string> = {
        'style': 'artistic style and visual aesthetics',
        'composition': 'composition and layout structure',
        'scene': 'scene and environment setting',
        'color': 'color palette and tone',
        'subject': 'main subject and focal point',
        'detail': 'fine details and textures',
      };

      // 收集所有激活的规范分类及其最大强度
      const activeCatStrengths: Record<string, number> = {};
      const strengths = referenceStrengths as number[] | undefined;

      for (const [imgIdx, cats] of Object.entries(referenceCategories as Record<string, string[]>)) {
        if (Array.isArray(cats)) {
          const imgStrength = strengths?.[Number(imgIdx)] ?? 0;
          for (const cat of cats) {
            if (imgStrength <= 0) continue; // 0% strength = not active, skip
            const normKey = normalizeCategory(cat);
            activeCatStrengths[normKey] = Math.max(activeCatStrengths[normKey] || 0, imgStrength);
          }
        }
      }

      const activeKeys = Object.keys(activeCatStrengths);
      if (activeKeys.length > 0) {
        // 构建保留方面的指令
        const preserveParts: string[] = [];
        const freeParts: string[] = [];

        for (const [catKey, catDesc] of Object.entries(categoryDescMap)) {
          if (activeCatStrengths[catKey] !== undefined) {
            const s = activeCatStrengths[catKey];
            if (s >= 80) preserveParts.push(`strictly preserve the ${catDesc} of the reference image`);
            else if (s >= 50) preserveParts.push(`maintain the ${catDesc} of the reference image`);
            else if (s >= 20) preserveParts.push(`subtly reference the ${catDesc} of the reference image`);
            else preserveParts.push(`lightly hint at the ${catDesc} of the reference image`);
          } else {
            freeParts.push(catDesc);
          }
        }

        // 判断是否包含"主体"保留
        const hasSubjectPreserve = activeCatStrengths['subject'] !== undefined;
        // 主体描述锚定：使用AI视觉识别+前端描述的合并结果，防止主体被替换
        const subjectAnchor = refDescText ? ` The reference image depicts: "${refDescText}".` : '';
        const subjectPrefix = hasSubjectPreserve
          ? `CRITICAL: The main subject (product/object/person) must remain EXACTLY the same as in the reference image — it is "${refDescText || 'the depicted item'}", same identity, same appearance. Do NOT replace or change the subject to a different object.${subjectAnchor} `
          : (refDescText ? `The reference image depicts: "${refDescText}". ` : '');

        let categoryEnhancement = '';
        if (preserveParts.length > 0) {
          categoryEnhancement += `${subjectPrefix}You MUST use the provided reference image(s) as the mandatory source. ${preserveParts.join('. ')}.`;
        }
        if (freeParts.length > 0) {
          categoryEnhancement += ` You may reimagine the ${freeParts.join(', ')}.`;
        }

        if (categoryEnhancement) {
          enhancedPrompt = `[REFERENCE MODE] ${categoryEnhancement} ${enhancedPrompt}`;
        }
      }
    }

    // 验证尺寸是否支持
    const requestedSize = aspectRatio || '1:1';
    
    // 设置生成数量 - 不受模型maxN限制，因为我们逐个提交任务(n=1)
    const totalCount = outputCount && outputCount >= 1 ? Math.min(outputCount, 10) : 1;

    // 构建提交任务的辅助函数 — 单次提交可能返回多张图片/多个taskId
    const submitSingleTask = async (
      currentModelConfig: ModelConfig,
      currentApiKey: string,
      currentApiBaseUrl: string,
      currentProviderId: string,
      requestN: number,
      currentProvider?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null,
    ): Promise<{ taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string }> => {
      // 解析兼容性档案 - 由提供商配置和模型类型共同决定 API 调用方式
      // 关键改进：对于 Gemini 图像模型，如果提供商不支持 /images/generations，
      // 自动切换到 gemini-image profile（通过 /chat/completions 生图）
      const profile: ApiCompatProfile = resolveProfileForModel(
        currentModelConfig.modelId,
        currentProvider,
      );
      const isGeminiImageRoute = profile.id === 'gemini-image';

      const effectiveSize = currentModelConfig.supportedSizes.includes(requestedSize) 
        ? requestedSize 
        : currentModelConfig.supportedSizes[0] || '1:1';

      const requestBody: Record<string, unknown> = {
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt,
        size: effectiveSize,
        n: requestN,
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
      // ★ 参考图组(reference/fusion) vs 图片编辑(erase/mask/outpaint) 的关键区别：
      // - 参考图组：用户希望按设定的尺寸生成新图，参考图仅作为风格/构图参考 → 不设置 image 字段，
      //   使用 /images/generations 端点，确保 API 遵守 size 参数
      // - 图片编辑：用户要求在原图基础上修改（擦除/蒙版/扩展）→ 必须设置 image 字段，
      //   使用 /images/edits 端点，强制 AI 处理源图
      const isReferenceOnly = referenceMode === 'reference' || referenceMode === 'fusion';
      if (hasRefImages) {
        // 始终提供 image_urls（大多数 API 代理支持此字段传递参考图 URL）
        requestBody.image_urls = accessibleReferenceImages;
        // 图生图 strength 参数
        if (typeof strength === 'number' && strength > 0 && strength <= 1) {
          requestBody.strength = strength;
        }
        // ★ 只有非参考图模式（即图片编辑模式）才设置 image 字段
        // 参考图组模式下，不设置 image 字段，让 API 使用 /images/generations 端点并遵守 size 参数
        // 否则 /images/edits 会忽略 size，以原图尺寸生成结果
        if (!isReferenceOnly) {
          const firstRefImage = accessibleReferenceImages[0];
          if (firstRefImage) {
            if (firstRefImage.startsWith('data:')) {
              requestBody.image = firstRefImage;
            } else if (firstRefImage.startsWith('/api/serve-upload/') || firstRefImage.startsWith('/uploads/')) {
              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
                const publicDir = path.join(workspacePath, 'public');
                let filePath = '';
                if (firstRefImage.startsWith('/api/serve-upload/')) {
                  // serve-upload 路径：从数据目录读取，而非 public
                  const relativePath = firstRefImage.replace('/api/serve-upload/', '');
                  try {
                    const { getServerDataRoot } = await import('@/lib/server-data-root');
                    const dataRoot = getServerDataRoot();
                    const path1 = path.join(dataRoot, 'uploads', relativePath);
                    const path2 = path.join(dataRoot, relativePath);
                    try { await fs.access(path1); filePath = path1; } catch {
                      try { await fs.access(path2); filePath = path2; } catch {
                        filePath = path.join(publicDir, relativePath);
                      }
                    }
                  } catch {
                    filePath = path.join(publicDir, relativePath);
                  }
                } else {
                  // 直接路径如 /uploads/xxx.jpg：先尝试 publicDir，再尝试 dataRoot
                  const relativePath = firstRefImage.replace(/^\//, '');
                  filePath = path.join(publicDir, relativePath);
                  try { await fs.access(filePath); } catch {
                    try {
                      const { getServerDataRoot } = await import('@/lib/server-data-root');
                      const dataRoot = getServerDataRoot();
                      const altPath = path.join(dataRoot, relativePath);
                      await fs.access(altPath);
                      filePath = altPath;
                    } catch {
                      // 保持 publicDir 路径，后续安全校验会处理
                    }
                  }
                }
                const resolved = path.resolve(filePath);
                // 安全校验：允许 publicDir 和 dataRoot 两个合法目录
                const { getServerDataRoot } = await import('@/lib/server-data-root');
                const dataRoot = getServerDataRoot();
                if (resolved.startsWith(publicDir) || resolved.startsWith(dataRoot)) {
                  const imgBuf = await fs.readFile(resolved);
                  const ext = path.extname(resolved).toLowerCase();
                  const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
                  const mime = mimeMap[ext] || 'image/png';
                  requestBody.image = `data:${mime};base64,${imgBuf.toString('base64')}`;
                }
              } catch (localErr) {
                console.warn('Failed to read local reference image:', localErr);
              }
            } else if (firstRefImage.startsWith('http')) {
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
          // 压缩参考图：大于1MB的base64图片用sharp压缩到最大1536px + JPEG q90
          const requestImageStr = requestBody.image as string | undefined;
          if (requestImageStr && requestImageStr.startsWith('data:') && requestImageStr.length > 1_000_000) {
            try {
              const sharp = (await import('sharp')).default;
              const base64Data = requestImageStr.split(',')[1];
              const imgBuf = Buffer.from(base64Data, 'base64');
              const compressed = await sharp(imgBuf)
                .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 90 })
                .toBuffer();
              requestBody.image = `data:image/jpeg;base64,${compressed.toString('base64')}`;
            } catch (compressErr) {
              console.warn('Reference image compression failed:', compressErr);
            }
          }
        }
      }

      // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
      // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点，
      // 不支持 /images/generations。此路由将请求转换为 chat 格式，
      // 然后从响应的 content 中提取 base64 图片数据。
      if (isGeminiImageRoute) {
        const chatRequestBody = buildGeminiChatImageRequest(requestBody);
        console.log('Gemini image route: using /chat/completions for model', currentModelConfig.modelId, 'size:', requestBody.size, 'quality:', requestBody.quality || requestBody.resolution);
        const msgs = chatRequestBody.messages as Array<Record<string, unknown>> | undefined;
        console.log('Gemini chatRequestBody messages[0]:', JSON.stringify(msgs?.[0]?.content || '').substring(0, 200));
        console.log('Gemini chatRequestBody generationConfig:', JSON.stringify(chatRequestBody.generationConfig));

        const geminiController = new AbortController();
        const geminiTimeoutId = setTimeout(() => geminiController.abort(), 600000); // 10分钟超时（Gemini生图可能很慢）

        try {
          const chatResponse = await fetchWithV1Retry(
            currentApiBaseUrl,
            '/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${currentApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(chatRequestBody),
              signal: geminiController.signal,
            }
          );

          clearTimeout(geminiTimeoutId);

          if (!chatResponse.ok) {
            const errorText = await chatResponse.text();
            console.error('Gemini chat/completions error:', chatResponse.status, errorText);
            let errorMsg = `Gemini API 请求失败 (${chatResponse.status})`;
            try {
              const errorJson = JSON.parse(errorText);
              // 兼容多种 API 错误格式：{error:{message:...}}, {message:...}, {msg:...}
              if (errorJson.error?.message) errorMsg = errorJson.error.message;
              else if (errorJson.message) errorMsg = errorJson.message;
              else if (errorJson.msg) errorMsg = errorJson.msg;
            } catch { /* ignore */ }
            // 合并 errorMsg + errorText 做可重试检测，兼容各种 API 错误格式
            const combinedErrorText = `${errorMsg} ${errorText}`;
            // ★ 可重试错误检测 — 渠道不可用/模型未找到/超时/上游认证等错误标记为可重试，触发候选模型回退
            const translatedMsg = translateApiError(errorMsg);
            const isRetryableError =
              combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel') ||
              combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') ||
              combinedErrorText.includes('bad_response_status_code') ||
              (chatResponse.status >= 500 && chatResponse.status !== 501) ||
              chatResponse.status === 401;
            if (isRetryableError) {
              console.warn('[generate] Gemini image route retryable error, will try fallback models:', errorMsg);
              const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
              (retryErr as Error & { retryable?: boolean }).retryable = true;
              throw retryErr;
            }
            throw new Error(translatedMsg);
          }

          const chatResponseText = await chatResponse.text();
          let chatResult: Record<string, unknown>;
          try {
            chatResult = JSON.parse(chatResponseText);
          } catch {
            console.error('[generate] Gemini chat returned non-JSON response, first 200 chars:', chatResponseText.substring(0, 200));
            throw new Error('Gemini API 返回了非 JSON 响应');
          }

          // 从 chat/completions 响应中提取图片
          const extractedImageUrls = parseGeminiChatImageResponse(chatResult);

          if (extractedImageUrls.length > 0) {
            console.log('Gemini image route: extracted', extractedImageUrls.length, 'images from chat response');
            return {
              taskIds: [],
              directImageUrls: extractedImageUrls,
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }

          // 如果是流式响应，chatResult 可能包含未完成的 SSE 数据
          // 检查是否有 choices 但 content 中没有图片
          const choices = chatResult.choices as Array<Record<string, unknown>> | undefined;
          if (choices && choices.length > 0) {
            const content = (choices[0].message as Record<string, unknown>)?.content;
            console.error('[generate] Gemini chat response has choices but no extractable image. Content type:', typeof content, 'Content preview:', typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200));
          }

          throw new Error('Gemini 图像模型未返回图片数据，请检查模型是否支持图像生成');
        } finally {
          clearTimeout(geminiTimeoutId);
        }
      }

      // 使用兼容性层自动调整请求（size格式、端点选择等）
      // ★ 关键修复：参考图组模式(reference/fusion)不应使用 editEndpoint(/images/edits)
      // 因为 /images/edits 会被 image 字段强制以原图尺寸生成，忽略 size 参数
      // 参考图组模式：hasImage=false → 使用 defaultEndpoint(/images/generations)，遵守 size
      // 图片编辑模式(erase/mask/outpaint)：hasImage=true → 使用 editEndpoint(/images/edits)
      const hasImageFlag = !!(requestBody.image || (requestBody.image_urls && !isReferenceOnly) || (accessibleReferenceImages.length > 0 && !isReferenceOnly));
      const { body: adjustedBody, endpoint } = adjustRequestForProfile(requestBody, profile, {
        hasImage: hasImageFlag,
      });

      console.log('Submitting image task:', {
        model: currentModelConfig.modelId,
        providerId: currentProviderId,
        providerName: provider?.displayName || provider?.name || 'unknown',
        apiBaseUrl: currentApiBaseUrl,
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
      // ★ 异步模式提交请求也需要足够时间（部分API提交本身可能耗时长）
      const isDirectMode = profile.responseMode === 'direct';
      const controller = new AbortController();
      const timeoutMs = isDirectMode ? 600000 : 300000; // 直接模式10分钟，异步提交5分钟
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let timeoutCleared = false;
      const clearTimeoutSafely = () => {
        if (!timeoutCleared) { clearTimeout(timeoutId); timeoutCleared = true; }
      };

      // 构建提交请求 - 通用策略，适配所有 API 提供商
      const isEditsEndpoint = endpoint === '/images/edits';
      const hasImageField = !!adjustedBody.image;

      // 辅助函数：解析提交响应
      const parseSubmitResponse = async (resp: Response): Promise<{ taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string }> => {
        if (!resp.ok) {
          const errorText = await resp.text();
          console.error('API submit error:', resp.status, errorText);
          
          let errorMsg = `API 请求失败 (${resp.status})`;
          let errorCode = '';
          try {
            const errorJson = JSON.parse(errorText);
            // 兼容多种 API 错误格式：{error:{message:...}}, {message:...}, {msg:...}
            if (errorJson.error?.message) {
              errorMsg = errorJson.error.message;
            } else if (errorJson.message) {
              errorMsg = errorJson.message;
            } else if (errorJson.msg) {
              errorMsg = errorJson.msg;
            }
            if (errorJson.error?.code) {
              errorCode = errorJson.error.code;
            }
          } catch { /* ignore */ }

          // 5xx 服务器错误（如 Cloudflare 524 超时）→ 可重试
          if (resp.status >= 502 && resp.status <= 599) {
            const retryErr = new Error(`API 服务器错误 (${resp.status})，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }

          // 合并 errorMsg + errorText 做可重试检测，兼容各种 API 错误格式
          const combinedErrorText = `${errorMsg} ${errorText}`;

          // ★ 5xx 渠道不可用 → 先尝试 /chat/completions 兜底
          // 某些 API 代理（如 AI link）仅通过 /chat/completions 支持 gpt-image-2 等模型
          // /images/edits 和 /images/generations 端点均可能返回 500/502/503 "渠道不可用"
          if (resp.status >= 500 && resp.status !== 501 && isChannelUnavailableError(combinedErrorText)) {
            console.info('[generate] 500 channel error detected, trying /chat/completions fallback...');
            try {
              const chatImageUrls = await tryChatCompletionsImageFallback({
                baseUrl: currentApiBaseUrl,
                apiKey: currentApiKey,
                model: currentModelConfig.modelId,
                prompt: enhancedPrompt,
                imageBase64: (adjustedBody.image as string) || undefined,
                imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                size: adjustedBody.size as string | undefined,
                originalError: combinedErrorText,
                requestIdPrefix: 'generate',
                skipChannelCheck: true,
              });
              if (chatImageUrls && chatImageUrls.length > 0) {
                console.log('[generate] /chat/completions fallback succeeded, got', chatImageUrls.length, 'images');
                return {
                  taskIds: [],
                  directImageUrls: chatImageUrls,
                  usedModel: currentModelConfig.modelId,
                  usedProviderId: currentProviderId,
                };
              }
            } catch (chatErr) {
              console.warn('[generate] /chat/completions fallback error:', chatErr);
            }
            // chat fallback also failed → mark as retryable for candidate model fallback
            const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }

          // 通用可重试错误检测 - 不针对特定提供商
          if (combinedErrorText.includes('ratio or price') || combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') || errorCode === 'model_not_found' || combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel')) {
            const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          if (combinedErrorText.includes('Insufficient balance') || combinedErrorText.includes('insufficient') || combinedErrorText.includes('余额')) {
            throw new Error(`API 余额不足，请联系管理员充值`);
          }
          if (combinedErrorText.includes('Rate limit') || combinedErrorText.includes('rate_limit') || combinedErrorText.includes('Too many requests') || combinedErrorText.includes('请稍等') || combinedErrorText.includes('稍后再试') || combinedErrorText.includes('请求过于频繁')) {
            throw new Error(`请求过于频繁，请稍后再试`);
          }
          if (combinedErrorText.includes('Invalid API key') || combinedErrorText.includes('invalid api_key') || combinedErrorText.includes('Incorrect API key')) {
            throw new Error(`API 密钥无效，请联系管理员检查配置`);
          }
          // 中转服务 401 + bad_response_status_code → 上游错误，可重试
          if (resp.status === 401 && combinedErrorText.includes('bad_response_status_code')) {
            const retryErr = new Error(`API 上游服务认证异常，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          
          // ★ 翻译英文错误信息为中文
          throw new Error(translateApiError(errorMsg));

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
          console.log('Direct image response (no polling needed), profile:', profile.id, 'images:', parsed.directImageUrls.length);
          return {
            taskIds: [],
            directImageUrls: parsed.directImageUrls,
            usedModel: currentModelConfig.modelId,
            usedProviderId: currentProviderId,
          };
        }

        // 异步任务格式 — 返回所有 taskIds
        if (parsed.taskIds.length > 0) {
          console.log('Got task_ids:', parsed.taskIds, 'profile:', profile.id);
          return {
            taskIds: parsed.taskIds,
            directImageUrls: [],
            usedModel: currentModelConfig.modelId,
            usedProviderId: currentProviderId,
          };
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
            clearTimeoutSafely();

            // ★ Use shorter timeout (30s) for /images/generations when /images/edits already failed with channel error
            const fallbackTimeoutMs = isChannelUnavailableError(errorText) ? 30000 : timeoutMs;
            const fallbackController = new AbortController();
            const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), fallbackTimeoutMs);

            const fallbackBody = stripEditsOnlyFields(adjustedBody);

            // 增强 prompt：/images/generations 仅将 image_urls 视为可选参考，
            // 必须在 prompt 中明确指示 AI 使用参考图作为基础，否则 AI 可能忽略参考图
            if (fallbackBody.image_urls && Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0) {
              const refCount = (fallbackBody.image_urls as string[]).length;
              const hasImg2ImgHint = String(fallbackBody.prompt || '').includes('[img2img]');
              if (hasImg2ImgHint) {
                // 图生图场景：更强的约束，确保 AI 基于 reference image 生成
                fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '').replace('[img2img]', '')}`;
              } else {
                // 参考图场景：指示 AI 参考这些图片
                fallbackBody.prompt = `[REFERENCE IMAGE] Use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as visual reference for generation. ${String(fallbackBody.prompt || '')}`;
              }
            }

            try {
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
            } catch (fallbackFetchErr: unknown) {
              // /images/generations timed out → try /chat/completions immediately
              const isTimeout = fallbackFetchErr instanceof Error && (fallbackFetchErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackFetchErr.message));
              if (isTimeout) {
                console.info('[generate] /images/generations timed out, trying /chat/completions fallback...');
                try {
                  const chatImageUrls = await tryChatCompletionsImageFallback({
                    baseUrl: currentApiBaseUrl,
                    apiKey: currentApiKey,
                    model: currentModelConfig.modelId,
                    prompt: String(fallbackBody.prompt || enhancedPrompt),
                    imageBase64: (adjustedBody.image as string) || undefined,
                    imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                    size: adjustedBody.size as string | undefined,
                    originalError: 'images/generations timeout',
                    requestIdPrefix: 'generate',
                    skipChannelCheck: true,
                  });
                  if (chatImageUrls && chatImageUrls.length > 0) {
                    console.log('[generate] /chat/completions fallback succeeded (after generations timeout), got', chatImageUrls.length, 'images');
                    return {
                      taskIds: [],
                      directImageUrls: chatImageUrls,
                      usedModel: currentModelConfig.modelId,
                      usedProviderId: currentProviderId,
                    };
                  }
                } catch (chatErr) {
                  console.warn('[generate] /chat/completions fallback error (after generations timeout):', chatErr);
                }
                const retryErr = new Error(`生成请求超时，请稍后重试或更换模型`);
                (retryErr as Error & { retryable?: boolean }).retryable = true;
                throw retryErr;
              }
              throw fallbackFetchErr;
            }

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
              clearTimeoutSafely();

              const multipartController = new AbortController();
              const multipartTimeoutId = setTimeout(() => multipartController.abort(), timeoutMs);

              // 使用 form-data npm 包替代浏览器 FormData，确保 boundary 正确传输
              try {
                const FD = (await import('form-data')).default;
                const fd = new FD();
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
                        fd.append('image', binaryData, { filename: `image.${ext}`, contentType: mimeType });
                      }
                    } else {
                      const binaryData = Buffer.from(imgVal, 'base64');
                      fd.append('image', binaryData, { filename: 'image.png', contentType: 'image/png' });
                    }
                  } else if (Array.isArray(value)) {
                    for (const item of value) {
                      fd.append(key, String(item));
                    }
                  } else {
                    fd.append(key, String(value));
                  }
                }
                // form-data 包需转为 Buffer 发送，Node.js fetch 不能正确流式传输
                const fdBuffer = fd.getBuffer();
                submitResponse = await fetchWithV1Retry(
                  currentApiBaseUrl,
                  endpoint,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${currentApiKey}`,
                      ...fd.getHeaders(),
                      'Content-Length': String(fdBuffer.length),
                    },
                    body: fdBuffer as unknown as BodyInit,
                    signal: multipartController.signal,
                  }
                );
              } catch {
                // form-data 包不可用时，回退到浏览器 FormData
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
              }

              clearTimeout(multipartTimeoutId);
            } else {
              clearTimeoutSafely();
              // 重建 Response，因为 body 已在第594行被 .text() 读取
              submitResponse = new Response(errorText, {
                status: submitResponse.status,
                headers: submitResponse.headers,
              });
            }
          }
        } else {
          clearTimeout(timeoutId);
        }
      } else {
        // /images/generations 或无 image 字段：标准 JSON 编码
        // 当 /images/generations 携带 image_urls 时，增强 prompt 以确保 AI 使用参考图
        if (endpoint === '/images/generations' && hasRefImages && adjustedBody.image_urls) {
          const p = String(adjustedBody.prompt || '');
          const hasImg2ImgHint = p.includes('[img2img]');
          if (hasImg2ImgHint) {
            // 前端已有图生图指令，只移除标记前缀，保留原始指令
            adjustedBody.prompt = p.replace('[img2img]', '').trim();
          } else if (!p.includes('[IMAGE-TO-IMAGE MODE]') && !p.includes('[REFERENCE IMAGE]')) {
            // 无任何参考图指令时追加简洁一致性指令
            adjustedBody.prompt = `[img2img] Preserve the structure, style and key elements of the reference image. ${p}`;
          }
        }
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

        clearTimeoutSafely();
      }

      try {
        return parseSubmitResponse(submitResponse);
      } finally {
        clearTimeoutSafely();
      }
    };

    const taskIds: string[] = [];
    const directImageUrls: string[] = [];
    let usedModelName = modelConfig.modelId; // 使用模型ID而非config.name（config.name可能被providerName覆盖）
    let usedModelId = modelConfig.modelId;
    let usedProviderId = provider?.id || 'env';
    let usedProviderName = provider?.displayName || provider?.name || '';
    let usedApiBaseUrl = apiBaseUrl || '';

    // 提交所有生成任务（带自动重试逻辑）
    for (let i = 0; i < totalCount; i++) {
      let submitted = false;
      
      // 先用当前模型尝试
      try {
        const result = await submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || 'env', 1, provider);
        if (result.directImageUrls && result.directImageUrls.length > 0) {
          directImageUrls.push(...result.directImageUrls);
        }
        if (result.taskIds && result.taskIds.length > 0) {
          taskIds.push(...result.taskIds);
        }
        usedModelId = result.usedModel;
        usedProviderId = result.usedProviderId;
        try {
          await appendUserJsonl(userId, 'images', {
            type: 'submit',
            providerId: usedProviderId,
            model: usedModelId,
            taskId: result.taskIds?.[0] || 'direct',
            prompt: enhancedPrompt,
          });
        } catch (logErr) {
          console.warn('[generate] 日志写入失败', logErr);
        }
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
              const result = await submitSingleTask(candidateConfig, candidate.apiKey, candidate.baseUrl, candidate.providerId, 1, { baseUrl: candidate.baseUrl, advancedParams: candidate.advancedParams });
              if (result.directImageUrls && result.directImageUrls.length > 0) {
                directImageUrls.push(...result.directImageUrls);
              }
              if (result.taskIds && result.taskIds.length > 0) {
                taskIds.push(...result.taskIds);
              }
              usedModelId = result.usedModel;
              usedModelName = result.usedModel || candidate.modelId; // 使用实际使用的模型ID
              usedProviderId = result.usedProviderId;
              usedProviderName = candidate.displayName || candidate.modelId;
              usedApiBaseUrl = candidate.baseUrl;
              try {
                await appendUserJsonl(userId, 'images', {
                  type: 'submit',
                  providerId: usedProviderId,
                  model: usedModelId,
                  taskId: result.taskIds?.[0] || 'direct',
                  prompt: enhancedPrompt,
                });
              } catch (logErr) {
                console.warn('[generate] 日志写入失败(fallback)', logErr);
              }
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

    // ★ 统一使用 polling 模式返回，避免直接模式导致前端 fetch 长时间等待超时
    // 即使是直接返回的图片 URL，也注册到 task-registry 并返回 taskIds，
    // 让前端通过 poll-task 获取结果，确保请求快速响应
    if (directImageUrls.length > 0) {
      const persistedUrls: string[] = [];
      for (const rawUrl of directImageUrls) {
        try {
          const persisted = await persistRemoteImage(rawUrl);
          persistedUrls.push(persisted || rawUrl);
        } catch (e) {
          console.warn('[generate] 持久化直接图片失败，使用原始URL:', e);
          persistedUrls.push(rawUrl);
        }
      }
      // 为每个直接返回的图片创建一个 taskId 并注册到 task-registry
      for (let i = 0; i < persistedUrls.length; i++) {
        const directTid = `direct-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        taskIds.push(directTid);
        registerTask(directTid, 'generate', '生成图片');
        // 直接标记为已完成，结果存储在 task-registry 中
        updateTaskProgress(directTid, {
          status: 'completed',
          progress: 100,
          result: {
            imageUrl: persistedUrls[i],
            usedModel: usedModelId,
            modelName: usedModelName,
            providerName: usedProviderName,
            apiBaseUrl: usedApiBaseUrl,
            apiKey: provider?.apiKey || serverApiKey,
            providerId: usedProviderId,
            advancedParams: provider?.advancedParams,
          }
        });
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
    // ★ 注册异步任务到统一注册中心（SSE推送 + 取消支持 + 存储提供商信息供 poll-task 使用）
    for (const tid of taskIds) {
      // 跳过已经注册的直接模式任务（上面已注册并标记完成）
      const existingTask = getTaskInfo(tid);
      if (existingTask) continue;
      registerTask(tid, 'generate', '生成图片');
      // ★ 关键修复：存储提供商信息到 task-registry，确保 poll-task 能直接使用正确的提供商
      // 而不需要通过 findProviderForModel 重新查找（可能找不到或找到错误的提供商）
      updateTaskProgress(tid, {
        status: 'processing',
        progress: 5,
        result: {
          usedModel: usedModelId,
          modelName: usedModelName,
          providerName: usedProviderName,
          apiBaseUrl: usedApiBaseUrl,
          apiKey: provider?.apiKey || serverApiKey,
          providerId: usedProviderId,
          advancedParams: provider?.advancedParams,
        }
      });
    }
    return NextResponse.json({
      success: true,
      mode: 'polling',
      taskIds,
      model: usedModelId,
      modelName: usedModelName,
      providerName: usedProviderName,
      providerId: usedProviderId,
      apiBaseUrl: usedApiBaseUrl,
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
