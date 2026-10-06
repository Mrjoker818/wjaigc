import { fetchWithV1Retry as fetchProviderRequest } from '@/lib/api-helpers';
import { identifyImageSubject } from '@/lib/identify-subject';
import { translateApiError } from '@/lib/api-error-translate';
import { streamResponsesApiSSE, buildResponsesApiPayload, extractImageUrlFromMarkdown, type ResponsesApiSSEEvent } from '@/lib/responses-api-sse';
import { filterRequestForModel, shouldUseResponsesAPIForProvider } from '@/lib/model-capabilities';
import { resolveProfileForModel, adjustRequestForProfile, parseResponseForProfile, stripEditsOnlyFields, isEditsEndpointRejected, buildGeminiChatImageRequest, parseGeminiChatImageResponse, tryChatCompletionsImageFallback as chatFallback, isChannelUnavailableError, buildPollUrl, type ApiCompatProfile } from '@/lib/api-compatibility';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import { applyDescriptorApprovedImageFields, buildDescriptorImageRequestFields } from './descriptor-image-request-fields';
import { alignReferenceDescriptions, compileReferenceConstraints } from '@/lib/reference-constraint-compiler';
import { updateTaskProgress } from '@/lib/task-registry';
import { normalizeImageEditLocalReference, readImageToolsLocalFile } from '@/lib/image-tools/local-image-reader';
import type { ModelConfig } from './ordinary-generation-request';
import { verifyGeneratedImageAlphaSet } from '@/lib/generated-image-alpha';

/** Only this deployment's managed-media URLs may be resolved from local storage. */
export function ordinaryManagedLocalPath(imgUrl: string): string | null {
  const rawDomain = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').replace(/\/+$/, '');
  const domainBase = rawDomain ? (rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`) : '';
  const port = process.env.DEPLOY_RUN_PORT || '5000';
  const localOrigins = [domainBase, `http://localhost:${port}`, `https://localhost:${port}`,
    `http://127.0.0.1:${port}`, `https://127.0.0.1:${port}`].filter(Boolean);
  const matchingOrigin = localOrigins.find(origin => imgUrl.startsWith(`${origin}/api/serve-upload/`)
    || imgUrl.startsWith(`${origin}/uploads/`));
  const isOwnManagedUrl = imgUrl.startsWith('/api/serve-upload/') || imgUrl.startsWith('/uploads/')
    || Boolean(matchingOrigin);
  if (!isOwnManagedUrl) return null;
  const localPath = normalizeImageEditLocalReference(imgUrl, matchingOrigin || domainBase);
  if (!localPath) throw new Error('Unsafe local media path');
  return localPath;
}

function ordinaryResponsesItemUrls(item: Record<string, unknown>): string[] {
  if (item.type === 'image_generation_call' && typeof item.result === 'string' && item.result)
    return [item.result.startsWith('data:') || /^https?:\/\//.test(item.result) ? item.result : `data:image/png;base64,${item.result}`];
  if (item.type !== 'message' || !Array.isArray(item.content)) return [];
  return item.content.flatMap((part: { type?: string; text?: unknown }): string[] => {
    if (part?.type !== 'output_text' || typeof part.text !== 'string') return [];
    const images = [...part.text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].map(match => match[1]);
    const single = images.length ? null : extractImageUrlFromMarkdown(part.text);
    return images.length ? images : single ? [single] : [];
  });
}

/** Controlled Responses JSON/SSE snapshots retain item order, including identical bytes. */
export function parseOrdinaryResponsesOutputs(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const response = value as Record<string, unknown>;
  if ((response.status !== undefined && response.status !== 'completed') || !Array.isArray(response.output)) return [];
  if (response.output.some(item => item && typeof item === 'object' && 'status' in item && item.status !== 'completed')) return [];
  return response.output.flatMap(item => item && typeof item === 'object' ? ordinaryResponsesItemUrls(item) : []);
}

export async function ordinaryTransparencyMetadata(urls: string[], buffers: Buffer[]): Promise<Record<string, unknown>> {
  const alphaVerification = await verifyGeneratedImageAlphaSet(buffers);
  alphaVerification.items = alphaVerification.items.map((item, index) => ({ ...item, imageUrl: urls[index] }));
  return { alphaVerification, ...(['opaque', 'invalid'].includes(alphaVerification.status) ? {
    warning: { code: 'TRANSPARENT_RESULT_NOT_ALPHA', message: '模型未返回真实透明背景，原始结果已保留。可主动选择移除背景。' },
    nextAction: { type: 'remove-background', requiresConfirmation: true, separatelyBilled: true },
  } : {}) };
}

export interface OrdinaryPromptInput {
  prompt: string; imageCategory?: string; productCategory?: string; stylePreset?: string;
  referenceImages?: string[]; referenceDescriptions?: string[]; referenceMode?: string;
  referenceCategories?: Record<string, string[]> | string[][];
  referenceStrengths?: number[]; referenceCategoryStrengths?: Record<string, Record<string, unknown>>;
  accessibleReferenceImages: string[]; effectiveProviderId: string;
  provider?: { displayName?: string; name?: string } | null; modelConfig: ModelConfig;
  identify?: typeof identifyImageSubject;
  propagateIdentificationErrors?: boolean;
}
export async function enhanceOrdinaryPrompt(input: OrdinaryPromptInput): Promise<{ enhancedPrompt: string; compiledReferenceConstraints: ReturnType<typeof compileReferenceConstraints> | null }> {
  const { prompt, imageCategory, productCategory, stylePreset = 'auto', referenceImages, referenceDescriptions,
    referenceMode, referenceCategories, referenceStrengths, referenceCategoryStrengths, accessibleReferenceImages,
    effectiveProviderId, provider, modelConfig } = input;
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
    
    if (productCategory && productCategory.trim() && productCategory.trim().toLowerCase() !== 'none') {
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
    const refDescArr = alignReferenceDescriptions(
      Array.isArray(referenceImages) ? referenceImages : [],
      referenceDescriptions,
    );

    if (accessibleReferenceImages.length > 0) {
      const missingDescriptionIndexes = accessibleReferenceImages.flatMap((_: string, index: number) => (
        refDescArr[index] ? [] : [index]
      ));
      if (missingDescriptionIndexes.length > 0) {
        console.info(`[generate] Auto-identifying ${missingDescriptionIndexes.length} reference image(s) via AI vision`);
        try {
          const identifyPromises = missingDescriptionIndexes.map(async (index: number) => {
            try {
              const result = await (input.identify || identifyImageSubject)(accessibleReferenceImages[index], 8000);
              return result ? result.en : null;
            } catch (err) {
              if (input.propagateIdentificationErrors) throw err;
              console.warn(`[generate] Vision identification failed for image ${index}:`, err);
              return null;
            }
          });
          const identifiedResults = await Promise.all(identifyPromises);

          missingDescriptionIndexes.forEach((referenceIndex: number, resultIndex: number) => {
            const identified = identifiedResults[resultIndex];
            if (identified) {
              refDescArr[referenceIndex] = identified;
            }
          });
          console.info(`[generate] Identified subjects: ${refDescArr.filter(Boolean).join('; ')}`);
        } catch (err) {
          if (input.propagateIdentificationErrors) throw err;
          console.warn('[generate] Batch vision identification failed (non-critical):', err);
        }
      }
    }
    const refDescText = refDescArr.filter(Boolean).join('; ');

    // 融合模式增强提示词 - 明确指导模型如何融合参考图
    if (referenceMode === 'fusion' && accessibleReferenceImages.length > 1) {
      const fusionDescHint = refDescText ? ` The reference images depict: "${refDescText}".` : '';
      enhancedPrompt = `[FUSION MODE] Combine and merge ${accessibleReferenceImages.length} reference images into a single cohesive composition.${fusionDescHint} ${enhancedPrompt}. Seamlessly blend all visual elements together, maintaining the key characteristics of each reference while creating a unified, natural result.`;
    }

    // 参考图增强：无分类或空分类时，使用描述文本增强；有分类时使用分类增强
    const hasCategories = referenceCategories && (
      (Array.isArray(referenceCategories) && referenceCategories.length > 0) ||
      (!Array.isArray(referenceCategories) && Object.keys(referenceCategories as Record<string, unknown>).length > 0)
    );
    const compiledReferenceConstraints = accessibleReferenceImages.length > 0 && hasCategories
      ? compileReferenceConstraints({
          providerId: effectiveProviderId,
          providerName: provider?.displayName || provider?.name,
          modelId: modelConfig.modelId,
          referenceImages: accessibleReferenceImages,
          referenceDescriptions: refDescArr,
          referenceCategories: referenceCategories as Record<string, string[]> | string[][],
          referenceStrengths,
          referenceCategoryStrengths,
        })
      : null;

    if (compiledReferenceConstraints?.hasActiveConstraints) {
      enhancedPrompt = `[REFERENCE MODE] ${compiledReferenceConstraints.prompt} ${enhancedPrompt}`;
    }

    if (accessibleReferenceImages.length > 0 && !hasCategories && !compiledReferenceConstraints?.hasActiveConstraints) {
      // 无分类模式：使用参考图描述增强提示词
      if (refDescText) {
        enhancedPrompt = `[REFERENCE MODE] The reference image depicts: "${refDescText}". You MUST preserve the main subject identity — do NOT replace it with a different object. ${enhancedPrompt}`;
      } else {
        // 即使没有描述，也必须添加基本参考指令，确保API理解参考意图
        enhancedPrompt = `[REFERENCE MODE] CRITICAL INSTRUCTION — Reference image(s) are provided as the PRIMARY source of truth. You MUST: (1) Identify and preserve the EXACT main subject from the reference — do NOT substitute a different object, person, or scene. (2) Maintain the overall composition and framing. (3) Apply the user's prompt as a MODIFICATION to the reference, not as a replacement. If the prompt is vague, lean toward minimal changes from the reference. ${enhancedPrompt}`;
      }
    }

    // 参考图分类增强 - 基于前端传递的分类和强度，增强提示词让AI正确理解参考意图
    if (accessibleReferenceImages.length > 0 && hasCategories && !compiledReferenceConstraints?.hasActiveConstraints) {
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
      const categoryStrengthsByImage = referenceCategoryStrengths
        && typeof referenceCategoryStrengths === 'object'
        && !Array.isArray(referenceCategoryStrengths)
        ? referenceCategoryStrengths as Record<string, Record<string, unknown>>
        : undefined;

      for (const [imgIdx, cats] of Object.entries(referenceCategories as Record<string, string[]>)) {
        if (Array.isArray(cats)) {
          for (const cat of cats) {
            const normKey = normalizeCategory(cat);
            const perCategoryStrength = categoryStrengthsByImage?.[imgIdx]?.[cat]
              ?? categoryStrengthsByImage?.[imgIdx]?.[normKey];
            const rawStrength = typeof perCategoryStrength === 'number'
              ? perCategoryStrength
              : strengths?.[Number(imgIdx)] ?? 0;
            const imgStrength = Math.max(0, Math.min(100, rawStrength));
            if (imgStrength <= 0) continue; // 0% strength = not active, skip
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
      } else {
        // 有分类但所有强度为0或分类为空对象 — 使用描述兜底
        if (refDescText) {
          enhancedPrompt = `[REFERENCE MODE] The reference image depicts: "${refDescText}". You MUST preserve the main subject identity — do NOT replace it with a different object. ${enhancedPrompt}`;
        } else {
          enhancedPrompt = `[REFERENCE MODE] Use the provided reference image(s) as the primary guide. Preserve the main subject, style, and composition from the reference. ${enhancedPrompt}`;
        }
      }
    }


  return { enhancedPrompt, compiledReferenceConstraints };
}
export interface OrdinarySubmission { taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string }
export interface OrdinaryQueryInput {
  baseUrl: string; profile: ApiCompatProfile; remoteId: string; apiKey: string;
  transport: typeof fetch; signal: AbortSignal;
}
export interface OrdinaryQueryResult { status: 'pending' | 'failed' | 'completed'; imageUrls: string[] }
/** One query only. Task-owned transport supplies authority checks; this boundary never touches storage. */
export async function queryOrdinaryGeneration(input: OrdinaryQueryInput): Promise<OrdinaryQueryResult> {
  const response = await input.transport(buildPollUrl(input.baseUrl, encodeURIComponent(input.remoteId), input.profile)
    || `${input.baseUrl}/tasks/${encodeURIComponent(input.remoteId)}?language=zh`, {
    headers: { Authorization: `Bearer ${input.apiKey}` }, signal: input.signal,
  });
  if (!response.ok) return { status: 'pending', imageUrls: [] };
  const data = await response.json() as Record<string, unknown>;
  const info = (data.data && !Array.isArray(data.data) ? data.data : data) as Record<string, unknown>;
  if (['failed', 'cancelled'].includes(String(info.status))) return { status: 'failed', imageUrls: [] };
  if (!['completed', 'succeeded', 'success'].includes(String(info.status))) return { status: 'pending', imageUrls: [] };
  const parsed = parseResponseForProfile({ data: info }, input.profile);
  return { status: parsed.directImageUrls.length ? 'completed' : 'pending', imageUrls: parsed.directImageUrls };
}
export interface OrdinaryProviderOptions {
  requestedSize: string; normalizedRequestedPixelSize?: string; quality?: string; resolutionTier?: string;
  enhancedPrompt: string; agentProviderIdempotencyKey: string; accessibleReferenceImages: string[];
  referenceMode?: string; referenceStrengths?: number[]; strength?: number; aspectRatio: string;
  strictAgentRouting: boolean; provider?: { displayName?: string; name?: string } | null;
  downloadAndSaveImage: (url: string) => Promise<string | null>;
  isPrivateIp: (url: string) => boolean; providerFetch?: typeof fetchProviderRequest;
  transport?: typeof fetch; controlled?: boolean; profile?: ApiCompatProfile;
  outputFields?: Record<string, unknown>;
  responsesApiEnabled?: boolean;
}
export function createOrdinaryProvider(options: OrdinaryProviderOptions): (
  currentModelConfig: ModelConfig, currentApiKey: string, currentApiBaseUrl: string,
  currentProviderId: string, requestN: number,
  currentProvider?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string> } | null,
) => Promise<OrdinarySubmission> {
  const { requestedSize, normalizedRequestedPixelSize, quality, resolutionTier, enhancedPrompt, agentProviderIdempotencyKey,
    accessibleReferenceImages, referenceMode, referenceStrengths, strength, aspectRatio, strictAgentRouting, provider,
    downloadAndSaveImage, isPrivateIp } = options;
  const fetch = options.transport || globalThis.fetch;
  const fetchWithV1Retry = options.providerFetch || fetchProviderRequest;
  const tryChatCompletionsImageFallback: typeof chatFallback = params => chatFallback({
    ...params, ...(options.controlled ? { transport: fetch, propagateErrors: true } : {}),
  });
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
      const profile: ApiCompatProfile = options.profile ?? resolveProfileForModel(
        currentModelConfig.modelId,
        currentProvider,
      );
      const isGeminiImageRoute = profile.id === 'gemini-image';

      const descriptorRequestFields = buildDescriptorImageRequestFields({
        aspectRatio: requestedSize,
        requestedPixelSize: normalizedRequestedPixelSize,
        quality,
        resolution: resolutionTier,
        sizeFormat: profile.sizeFormat,
      });
      const effectiveSize = descriptorRequestFields.size;
      const calculatedPixelSize = normalizedRequestedPixelSize
        ? undefined
        : calculateActualPixelsFromRatio(effectiveSize, quality || '', currentModelConfig.modelId);
      const pixelSize = descriptorRequestFields.sizePx || normalizedRequestedPixelSize || calculatedPixelSize;
      const finalSize = descriptorRequestFields.size;

      const requestBody: Record<string, unknown> = {
        ...options.outputFields,
        model: currentModelConfig.modelId,
        prompt: enhancedPrompt,
        n: requestN,
        size: finalSize,
        ...(agentProviderIdempotencyKey
          ? { idempotency_key: agentProviderIdempotencyKey }
          : {}),
      };

      // 像素辅助字段（仅当有像素尺寸时添加）
      if (pixelSize && /^\d+x\d+$/.test(pixelSize)) {
        requestBody.width = parseInt(pixelSize.split('x')[0]);
        requestBody.height = parseInt(pixelSize.split('x')[1]);
        requestBody.size_px = pixelSize;
      }

      if (quality !== undefined) requestBody.quality = quality;
      if (resolutionTier !== undefined) requestBody.resolution = resolutionTier;

      // ★ 诊断日志：记录发送给 API 的关键分辨率参数，便于排查“用户设置4K但实际生成1K”问题
      console.log(`[generate] Resolution params → model: ${currentModelConfig.modelId}, paramType: ${currentModelConfig.paramType}, quality: ${quality}, effectiveSize: ${effectiveSize}, pixelSize: ${pixelSize || 'null'}, finalSize: ${finalSize}, profile.sizeFormat: ${profile.sizeFormat}, requestBody.size: ${requestBody.size}, requestBody.resolution: ${requestBody.resolution || 'N/A'}, requestBody.width: ${requestBody.width || 'N/A'}, requestBody.height: ${requestBody.height || 'N/A'}`);

      // 添加参考图片
      const hasRefImages = accessibleReferenceImages.length > 0 && currentModelConfig.supportsImageToImage;
      // ★ 参考图模式 vs 图片编辑模式的关键区别：
      // - 参考图模式(reference/fusion/style/blend/content)：用户希望基于参考图生成新图，需要设置 image 字段
      //   使用 /images/edits 端点，确保 API 能看到并处理参考图
      // - 图片编辑模式(erase/mask/outpaint)：用户要求在原图基础上修改，必须设置 image 字段
      //   使用 /images/edits 端点，强制 AI 处理源图
      // ★ 重要：之前的实现中参考图模式不设置 image 字段，走 /images/generations 端点，
      //   但该端点不支持图片输入（忽略 image_urls/images[]），导致参考图完全丢失！
      const isReferenceOnly = !referenceMode || ['reference', 'fusion', 'style', 'blend', 'content'].includes(referenceMode);

      // ★ 辅助函数：将图片 URL 转为 base64 data URL（确保第三方 API 一定能收到图片内容）
      // 第三方 API 可能无法访问 coze.site 域名的 URL，转 base64 是最可靠的方式
      const resolveImageToBase64 = async (imgUrl: string): Promise<string | null> => {
        if (imgUrl.startsWith('data:')) return imgUrl;
        const rawDomain = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').replace(/\/+$/, '');
        const domainBase = rawDomain ? (rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`) : '';
        try {
          const localPath = ordinaryManagedLocalPath(imgUrl);
          if (localPath) {
            const path = await import('node:path');
            const { getServerDataRoot } = await import('@/lib/server-data-root');
            const dataRoot = getServerDataRoot();
            const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
            const publicDir = path.join(workspacePath, 'public');
            const imgBuf = await readImageToolsLocalFile(dataRoot, publicDir, localPath,
              20 * 1024 * 1024, 'ordinary');
            if (imgBuf) {
              const ext = path.extname(localPath).toLowerCase();
              const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
              const mime = mimeMap[ext] || 'image/png';
              console.log('[generate] Resolved managed reference locally:', localPath, 'size:', imgBuf.length);
              return `data:${mime};base64,${imgBuf.toString('base64')}`;
            }
            // Managed uploads may be archived to object storage; preserve HTTP recovery.
            if (localPath.startsWith('/api/serve-upload/')) {
              const port = process.env.DEPLOY_RUN_PORT || 5000;
              const query = imgUrl.match(/\?[^#]*/)?.[0] || '';
              try {
                const localUrl = `http://localhost:${port}${localPath}${query}`;
                const localResp = await fetch(localUrl, { signal: AbortSignal.timeout(8000) });
                if (localResp.ok) {
                  const recovered = Buffer.from(await localResp.arrayBuffer());
                  const contentType = localResp.headers.get('content-type') || 'image/png';
                  console.log('[generate] Resolved serve-upload image via localhost:', localPath, 'size:', recovered.length);
                  return `data:${contentType};base64,${recovered.toString('base64')}`;
                }
              } catch (error) {
                console.warn('[generate] localhost fetch failed for', localPath, (error as Error).message);
              }
            }
            return null;
          }
          if (imgUrl.startsWith('http')) {
            // ★ 关键修复：如果是我们自己的域名（COZE_PROJECT_DOMAIN_DEFAULT），用localhost代替避免公网回环失败
            let fetchUrl = imgUrl;
            if (domainBase && imgUrl.startsWith(`${domainBase}/`)) {
              const proto = process.env.NODE_ENV === 'production' ? 'http' : 'http';
              const port = process.env.DEPLOY_RUN_PORT || 5000;
              const urlPath = new URL(imgUrl).pathname + new URL(imgUrl).search;
              fetchUrl = `${proto}://localhost:${port}${urlPath}`;
              console.log('[generate] Rewriting self-domain URL to localhost:', imgUrl, '→', fetchUrl);
            }
            const imgResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
            if (imgResp.ok) {
              const imgBuf = Buffer.from(await imgResp.arrayBuffer());
              const contentType = imgResp.headers.get('content-type') || 'image/png';
              console.log('[generate] Resolved http image to base64, size:', imgBuf.length, 'from:', fetchUrl.substring(0, 100));
              return `data:${contentType};base64,${imgBuf.toString('base64')}`;
            } else {
              console.warn('[generate] HTTP fetch failed for image:', fetchUrl, 'status:', imgResp.status);
            }
          }
        } catch (err) {
          if (err instanceof Error && /Unsafe local media path|Invalid local image file/.test(err.message)) throw err;
          console.warn('[generate] Failed to resolve image to base64:', imgUrl, err);
        }
        return null;
      };

      if (hasRefImages) {
        // ★ 将所有参考图 URL 转为 base64，确保第三方 API 一定能下载到图片
        // 这是最关键的修复：第三方 API 可能无法访问 coze.site 域名的图片 URL
        const base64RefImages: string[] = [];
        for (const refUrl of accessibleReferenceImages) {
          const base64 = await resolveImageToBase64(refUrl);
          base64RefImages.push(base64 || refUrl); // 转换失败时保留原始 URL
        }
        // 始终提供 image_urls（使用 base64 版本，确保 API 可访问）
        requestBody.image_urls = base64RefImages;

        // 图生图 strength 参数
        if (typeof strength === 'number' && strength > 0 && strength <= 1) {
          requestBody.strength = strength;
        } else if (referenceStrengths && Array.isArray(referenceStrengths) && referenceStrengths.length > 0) {
          const maxStrength = Math.max(...referenceStrengths.filter(s => typeof s === 'number' && s > 0));
          if (maxStrength > 0) {
            requestBody.strength = Math.min(maxStrength / 100, 1);
          }
        }
        // ★ 参考图模式下如果没有显式 strength 也没有 referenceStrengths，设置默认值
        if (!requestBody.strength && isReferenceOnly && accessibleReferenceImages.length > 0) {
          requestBody.strength = 0.65;
        }

        // ★ 参考图 + 图生图模式：同时设置 image 和 image_urls
        // image 字段：确保 /images/edits 端点可用（部分 API 代理仅支持此端点处理参考图）
        // image_urls 字段：在 adjustRequestForProfile 中转为 images[] 格式（OpenAI 官方规范）
        // 两者同时存在 → images[] 合并包含所有参考图，最大化兼容性
        if (!requestBody.image) {
          const firstRefBase64 = base64RefImages[0];
          if (firstRefBase64) {
            requestBody.image = firstRefBase64;
          }
        }
      }

      // 压缩参考图：大于800KB的base64图片用sharp压缩到最大1280px + JPEG q85（避免base64过大导致第三方API超时）
      const requestImageStr = requestBody.image as string | undefined;
      if (requestImageStr && requestImageStr.startsWith('data:') && requestImageStr.length > 800_000) {
        try {
          const sharp = (await import('sharp')).default;
          const base64Data = requestImageStr.split(',')[1];
          const imgBuf = Buffer.from(base64Data, 'base64');
          const compressed = await sharp(imgBuf)
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          requestBody.image = `data:image/jpeg;base64,${compressed.toString('base64')}`;
        } catch (compressErr) {
          console.warn('Reference image compression failed:', compressErr);
        }
      }
      // 同步压缩image_urls数组中的其他参考图
      if (Array.isArray(requestBody.image_urls) && requestBody.image_urls.length > 1) {
        for (let i = 1; i < requestBody.image_urls.length; i++) {
          const urlItem = requestBody.image_urls[i];
          const urlStr = typeof urlItem === 'string' ? urlItem : (urlItem as { url?: string })?.url;
          if (urlStr && urlStr.startsWith('data:') && urlStr.length > 800_000) {
            try {
              const sharp = (await import('sharp')).default;
              const base64Data = urlStr.split(',')[1];
              const imgBuf = Buffer.from(base64Data, 'base64');
              const compressed = await sharp(imgBuf)
                .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
              const newUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
              if (typeof urlItem === 'string') {
                requestBody.image_urls[i] = newUrl;
              } else {
                (urlItem as { url: string }).url = newUrl;
              }
            } catch {}
          }
        }
      }

      // Filter only after reference inputs are present. The filtered object is the
      // exact payload passed to the provider compatibility layer.
      const filteredBody = applyDescriptorApprovedImageFields(
        filterRequestForModel(currentModelConfig.modelId, requestBody),
        descriptorRequestFields,
      );

      // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
      // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点，
      // 不支持 /images/generations。此路由将请求转换为 chat 格式，
      // 然后从响应的 content 中提取 base64 图片数据。
      if (isGeminiImageRoute) {
        const chatRequestBody = buildGeminiChatImageRequest(filteredBody);
        if (agentProviderIdempotencyKey) chatRequestBody.idempotency_key = agentProviderIdempotencyKey;
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
                ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
              },
              body: JSON.stringify(chatRequestBody),
              signal: geminiController.signal,
              skipV1Retry: strictAgentRouting,
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
            // ★ 可重试错误检测 — 渠道不可用/模型未找到/上游认证等错误标记为可重试，触发候选模型回退
            // 注意：纯 401 认证失败不应重试（Key 无效换模型也没用），仅 401+bad_response_status_code（上游中转异常）可重试
            const translatedMsg = translateApiError(errorMsg);
            const isRetryableError =
              combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel') ||
              combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') ||
              combinedErrorText.includes('bad_response_status_code') ||
              (chatResponse.status >= 500 && chatResponse.status !== 501) ||
              (chatResponse.status === 401 && combinedErrorText.includes('bad_response_status_code'));
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
      // ★ 参考图模式：同时设置 image + image_urls，hasImageFlag=true → 先尝试 /images/edits
      //   /images/edits 支持更多第三方 API 代理（它们可能不支持 /images/generations 的 images[] 格式）
      //   如果 /images/edits 被拒绝 → 自动回退到 /images/generations + images[] 格式
      // ★ 图片编辑模式(erase/mask/outpaint)：hasImage=true → 使用 editEndpoint(/images/edits)
      const hasImageFlag = !!requestBody.image;
      const hasRefImagesFlag = accessibleReferenceImages.length > 0;
      const { body: adjustedBody, endpoint } = adjustRequestForProfile(filteredBody, profile, {
        hasImage: hasImageFlag,
        hasReferenceImages: hasRefImagesFlag,
      });
      if (agentProviderIdempotencyKey) adjustedBody.idempotency_key = agentProviderIdempotencyKey;

      console.log('Submitting image task:', {
        model: currentModelConfig.modelId,
        providerId: currentProviderId,
        providerName: provider?.displayName || provider?.name || 'unknown',
        apiBaseUrl: currentApiBaseUrl,
        prompt: enhancedPrompt.substring(0, 50) + '...',
        size: adjustedBody.size,
        resolution: adjustedBody.resolution || undefined,
        quality: adjustedBody.quality || undefined,
        width: adjustedBody.width || undefined,
        height: adjustedBody.height || undefined,
        size_px: adjustedBody.size_px || undefined,
        aspectRatio,
        requestedPixelSize: normalizedRequestedPixelSize,
        paramType: currentModelConfig.paramType,
        endpoint,
        profile: profile.id,
        hasRefImages,
        hasRefImagesFlag,
        hasImageFlag,
        hasImageField: !!adjustedBody.image,
        image_urls_count: Array.isArray(adjustedBody.image_urls) ? adjustedBody.image_urls.length : (adjustedBody.image_urls ? 1 : 0),
        images_count: Array.isArray(adjustedBody.images) ? adjustedBody.images.length : 0,
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

      try {
      // ★ Responses API SSE 流式保活路径 — 对支持 Responses API 的模型启用
      // 通过 Cloudflare 代理的中转站长时间推理容易 524/504 断连，
      // /v1/responses + SSE 心跳保活可避免此问题
      // 模型支持列表由 model-capabilities 注册表统一管理
      const responsesApiEnabled = options.responsesApiEnabled ?? shouldUseResponsesAPIForProvider(currentModelConfig.modelId, currentApiBaseUrl);


      if (responsesApiEnabled) {
        let responsesAccepted = false;
        try {

          // Build Responses API payload
          const payload = buildResponsesApiPayload(
            String(adjustedBody.prompt || enhancedPrompt),
            currentModelConfig.modelId,
            currentModelConfig.modelId, // textModel: use image model as text model for /v1/responses
            {
              size: adjustedBody.size as string | undefined,
              quality: adjustedBody.quality as string | undefined,
              outputFormat: adjustedBody.output_format as string | undefined,
              background: adjustedBody.background as string | undefined,
              negativePrompt: adjustedBody.negative_prompt as string | undefined,
              seed: adjustedBody.seed as number | undefined,
              imageUrls: (adjustedBody.image_urls as string[]) || (adjustedBody.image ? [adjustedBody.image as string] : undefined),
              maskB64: (adjustedBody.mask as string) || undefined,
              noPromptRevision: true,
            },
          );
          if (agentProviderIdempotencyKey) payload.idempotency_key = agentProviderIdempotencyKey;

          // ★ FHL等中转站流式返回私有IP URL，非流式返回外部URL
          // 直接使用非流式请求避免4层降级的60秒延迟
          if (currentApiBaseUrl.includes('fhl.mom') || currentApiBaseUrl.includes('funai.works')) {
            payload.stream = false;
            console.log('[generate] Using non-stream mode for FHL-like provider to avoid private IP URL');
          }

          const respRes = await fetchWithV1Retry(
            currentApiBaseUrl,
            '/v1/responses',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`,
                ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
              skipV1Retry: true, // path已包含/v1，避免重试时出现/v1/v1/双重路径
            },
          );

          if (!respRes.ok) {
            throw new Error(`Responses API HTTP ${respRes.status}`);
          }
          responsesAccepted = true;

          if (!respRes.body) {
            throw new Error('Responses API returned no body');
          }
          if (options.controlled && !respRes.headers.get('content-type')?.includes('text/event-stream')) {
            const urls = parseOrdinaryResponsesOutputs(await respRes.json());
            if (!urls.length) throw new Error('Responses JSON did not confirm complete image outputs');
            clearTimeoutSafely();
            return { taskIds: [], directImageUrls: urls, usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
          }

          let completedOutputs: string[] | undefined;
          let completed = false;
          let streamFailed = false;
          let streamError: { message: string; code?: string } | undefined;
          const itemOutputs = new Map<string, { index: number; urls: string[] }>();
          const sseResult = await streamResponsesApiSSE(
            respRes.body.getReader(),
            (event: ResponsesApiSSEEvent) => {
              if (options.controlled) {
                if (event.error) {
                  streamFailed = true;
                  const response = event.raw.response as Record<string, unknown> | undefined;
                  const rawError = (event.raw.error || response?.error) as Record<string, unknown> | undefined;
                  streamError = { message: event.error,
                    ...(typeof rawError?.code === 'string' || typeof rawError?.code === 'number' ? { code: String(rawError.code) } : {}) };
                }
                if (event.type === 'response.output_item.done' && event.raw.item && typeof event.raw.item === 'object') {
                  const item = event.raw.item as Record<string, unknown>;
                  const index = typeof event.raw.output_index === 'number' ? event.raw.output_index : itemOutputs.size;
                  itemOutputs.set(typeof item.id === 'string' ? item.id : `index:${index}`, { index, urls: ordinaryResponsesItemUrls(item) });
                }
                if (event.type === 'response.completed') {
                  completed = true;
                  const response = event.raw.response as { output?: unknown } | undefined;
                  // The final snapshot owns ordering and identity. Do not append
                  // repeated item events or deduplicate different items by bytes.
                  if (Array.isArray(response?.output)) completedOutputs = parseOrdinaryResponsesOutputs(response);
                }
                if (event.type === 'image_generation.completed') {
                  completed = true;
                  const url = event.finalImageB64 ? `data:image/png;base64,${event.finalImageB64}` : event.finalImageUrl;
                  if (url) {
                    const rawIndex = event.raw.output_index ?? event.raw.index;
                    const identity = event.raw.item_id ?? event.raw.output_id ?? event.raw.id;
                    const explicitIndex = typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : undefined;
                    const key = typeof identity === 'string' && identity ? identity : `index:${explicitIndex ?? 0}`;
                    const index = explicitIndex ?? itemOutputs.get(key)?.index ?? itemOutputs.size;
                    itemOutputs.set(key, { index, urls: [url] });
                  }
                  // Item events never append to or override response.output, even
                  // when a replay arrives after that authoritative final snapshot.
                }
              }
              try { updateTaskProgress(`resp-progress`, { progress: 50, label: event.type }); } catch {}
            },
            controller.signal,
          );

          if (options.controlled) {
            const urls = completedOutputs ?? [...itemOutputs.values()].sort((a, b) => a.index - b.index).flatMap(item => item.urls);
            if (!completed || streamFailed || !sseResult.success || sseResult.isPartial || !urls.length)
              throw Object.assign(new Error(streamError?.message || sseResult.error || 'Responses stream did not confirm complete image outputs'),
                { status: respRes.status, providerCode: streamError?.code });
            clearTimeoutSafely();
            return { taskIds: [], directImageUrls: urls, usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
          }

          if (sseResult.imageB64) {

            return {
              taskIds: [],
              directImageUrls: [`data:image/png;base64,${sseResult.imageB64}`],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          // SSE returned URL (部分中转站返回 URL 而非 base64)
          if (sseResult.imageUrl && options.controlled) {
            return { taskIds: [], directImageUrls: [sseResult.imageUrl], usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
          }
          if (sseResult.imageUrl) {
            let imageUrl = sseResult.imageUrl;
            let isUrlAccessible = true;
            // 修复私有 IP URL: 部分中转站 (如 FHL) 返回内部 IP 图片 URL
            // 策略: 用提供商域名替换私有 IP → 服务器端代理下载 → /chat/completions 重试获取外部 URL
            const privateIpMatch = imageUrl.match(/^(https?:\/\/)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?\/(.+)$/);
            if (privateIpMatch) {
              isUrlAccessible = false;
              const [, proto, , port, pathRest] = privateIpMatch;
              const providerDomain = currentApiBaseUrl.replace(/^https?:\/\//, '');
              const fixedUrl = `${proto}${providerDomain}${port || ''}/${pathRest}`;
              console.log(`[generate] Private IP image URL detected: ${imageUrl}`);
              // 尝试1: 用提供商域名替换私有 IP
              try {
                const probeResp = await fetch(fixedUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
                const ct = probeResp.headers.get('content-type') || '';
                if (probeResp.ok && (ct.startsWith('image/') || ct.includes('png') || ct.includes('jpeg') || ct.includes('webp'))) {
                  imageUrl = fixedUrl;
                  isUrlAccessible = true;
                  console.log('[generate] Provider domain fix succeeded (image content-type)');
                }
              } catch {
                console.log('[generate] Provider domain fix failed (unreachable)');
              }
              // 尝试2: 服务器端代理下载
              if (!strictAgentRouting && !isUrlAccessible) {
                const downloadedUrl = await downloadAndSaveImage(imageUrl);
                if (downloadedUrl) {
                  imageUrl = downloadedUrl;
                  isUrlAccessible = true;
                  console.log('[generate] Server-side proxy download succeeded');
                }
              }
              // 尝试3: 如果私有 IP URL 不可达，用 /chat/completions 获取外部 URL
              // ★ 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions
              const baseUrlLower = currentApiBaseUrl.toLowerCase();
              const providersDisablingChatRetry = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
              const shouldSkipChatRetry = providersDisablingChatRetry.some(p => baseUrlLower.includes(p));
              if (!strictAgentRouting && !isUrlAccessible && !shouldSkipChatRetry) {
                console.log('[generate] Private IP URL not accessible, retrying via /chat/completions for external URL...');
                try {
                  const chatResult = await tryChatCompletionsImageFallback({
                    baseUrl: currentApiBaseUrl,
                    apiKey: currentApiKey,
                    model: currentModelConfig.modelId,
                    prompt: String(requestBody.prompt || ''),
                    size: String(requestBody.size || '1024x1024'),
                    originalError: 'Private IP image URL not accessible',
                    skipChannelCheck: true,
                  });
                  if (chatResult && chatResult.length > 0) {
                    imageUrl = chatResult[0];
                    isUrlAccessible = true;
                    console.log('[generate] /chat/completions retry succeeded, got external URL:', imageUrl.substring(0, 100));
                  }
                } catch (chatErr) {
                  console.log('[generate] /chat/completions retry failed:', (chatErr as Error).message?.substring(0, 100));
                }
              } else if (!isUrlAccessible && shouldSkipChatRetry) {
                console.log(`[generate] Provider "${baseUrlLower}" disables /chat/completions, skipping chat retry for private IP URL`);
              }
              // 尝试4: 非流式 Responses API 重试 (部分中转站 stream:true 返回私有 IP，stream:false 返回外部 URL)
              if (!strictAgentRouting && !isUrlAccessible) {
                console.log('[generate] Trying non-stream /v1/responses for external image URL...');
                try {
                  const nsPayload = buildResponsesApiPayload(
                    String(requestBody.prompt || ''),
                    currentModelConfig.modelId,
                    currentModelConfig.modelId,
                    { size: String(requestBody.size || '1024x1024'), quality: requestBody.quality as string | undefined, outputFormat: requestBody.output_format as string | undefined }
                  );
                  nsPayload.stream = false;
                  if (agentProviderIdempotencyKey) nsPayload.idempotency_key = agentProviderIdempotencyKey;
                  const nsResp = await fetchWithV1Retry(currentApiBaseUrl, '/v1/responses', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${currentApiKey}`,
                      ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
                    },
                    body: JSON.stringify(nsPayload),
                    signal: AbortSignal.timeout(120000),
                  }, true);
                  if (nsResp.ok) {
                    const nsData = await nsResp.json() as { output?: Array<{ type?: string; result?: string; content?: Array<{ type?: string; text?: string }> }> };
                    if (nsData.output && Array.isArray(nsData.output)) {
                      for (const item of nsData.output) {
                        if (item.result && item.type === 'image_generation_call') {
                          // base64 result
                          const b64Data = item.result;
                          const savedUrl = await downloadAndSaveImage(`data:image/png;base64,${b64Data}`);
                          if (savedUrl) {
                            imageUrl = savedUrl;
                            isUrlAccessible = true;
                            console.log('[generate] Non-stream Responses API got base64, saved as:', savedUrl.substring(0, 80));
                            break;
                          }
                        }
                        if (item.type === 'message' && item.content) {
                          const mdUrl = extractImageUrlFromMarkdown(item.content.map((c: { text?: string }) => c.text || '').join(' '));
                          if (mdUrl && !isPrivateIp(mdUrl)) {
                            imageUrl = mdUrl;
                            isUrlAccessible = true;
                            console.log('[generate] Non-stream Responses API got external URL:', imageUrl.substring(0, 100));
                            break;
                          }
                        }
                      }
                    }
                  }
                } catch (nsErr) {
                  console.log('[generate] Non-stream Responses API retry failed:', (nsErr as Error).message?.substring(0, 100));
                }
              }
              // 所有方法都失败，保留原始 URL (前端可能无法访问)
              if (!isUrlAccessible) {
                console.log('[generate] All URL fix attempts failed, keeping original private IP URL (may not be accessible)');
              }
            }
            console.log('[generate] Responses API SSE succeeded, got image URL:', imageUrl.substring(0, 100));
            return {
              taskIds: [],
              directImageUrls: [imageUrl],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          // SSE returned partial image as fallback
          if (sseResult.partialImageB64) {
            console.log('[generate] Responses API SSE got partial image (stream interrupted)');
            return {
              taskIds: [],
              directImageUrls: [`data:image/png;base64,${sseResult.partialImageB64}`],
              usedModel: currentModelConfig.modelId,
              usedProviderId: currentProviderId,
            };
          }
          console.warn('[generate] Responses API SSE returned no image, falling back to standard path');
        } catch (sseErr) {
          if (options.controlled && responsesAccepted) { clearTimeoutSafely(); throw sseErr; }
          console.warn('[generate] Responses API SSE failed, falling back to standard path:', sseErr instanceof Error ? sseErr.message : sseErr);
          // 不抛出错误，降级到标准路径
        }
      }

      // 构建提交请求 - 通用策略，适配所有 API 提供商
      const isEditsEndpoint = endpoint === '/images/edits';
      const hasImageField = !!(adjustedBody.image || (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0));

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

          if (strictAgentRouting && resp.status === 400) {
            throw Object.assign(new Error(errorCode === 'invalid_quality'
              ? '所选模型不支持当前图片质量参数，请检查质量设置'
              : '模型提供商拒绝了当前生成参数，请检查模型支持范围'), {
              status: 400,
              providerCode: errorCode === 'invalid_quality' ? 'invalid_quality' : 'request_rejected',
              retryable: false,
            });
          }

          // 5xx 服务器错误处理
          // ★ 重要：对 5xx 错误先尝试 /chat/completions 兜底，再决定是否回退候选模型
          // 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions，仅使用 /images/generations 和 /images/edits
          if (resp.status >= 500 && resp.status !== 501) {
            const combinedForCheck = `${errorMsg} ${errorText}`;
            const isChannelError = isChannelUnavailableError(combinedForCheck);
            // Cloudflare/CDN 纯 HTML 错误页（如 "error code: 502"）— 模型上游持续不可用
            const isCloudflareDown = /error code:\s*50[23]/i.test(errorText.substring(0, 500));
            // "No available compatible accounts" — 中转服务渠道完全不可用
            const isNoCompatibleAccount = combinedForCheck.includes('no available compatible account') || combinedForCheck.includes('No available compatible');

            // ★ 检查是否是明确禁用 chat/completions 的提供商（FHL、AI link、虚宝）
            const currentBaseUrlLower = currentApiBaseUrl.toLowerCase();
            const providersDisablingChatFallback = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
            const isProviderDisablingChatFallback = providersDisablingChatFallback.some(p => currentBaseUrlLower.includes(p));

            const shouldTryChatFallback = !strictAgentRouting
              && !isProviderDisablingChatFallback
              && (isChannelError || isCloudflareDown || isNoCompatibleAccount || resp.status >= 502);

            // ★ 先尝试 /chat/completions 兜底生图（排除禁用的提供商）
            if (shouldTryChatFallback) {
              console.info(`[generate] ${resp.status} error detected (${isChannelError ? 'channel' : isCloudflareDown ? 'cloudflare' : isNoCompatibleAccount ? 'no-compatible-account' : '5xx'}), trying /chat/completions fallback for model "${currentModelConfig.modelId}"...`);
              try {
                const chatImageUrls = await tryChatCompletionsImageFallback({
                  baseUrl: currentApiBaseUrl,
                  apiKey: currentApiKey,
                  model: currentModelConfig.modelId,
                  prompt: enhancedPrompt,
                  imageBase64: (adjustedBody.image as string) || undefined,
                  imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                  size: adjustedBody.size as string | undefined,
                  originalError: combinedForCheck,
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
            } else if (isProviderDisablingChatFallback) {
              console.info(`[generate] Provider "${currentBaseUrlLower}" disables /chat/completions fallback, skipping for ${resp.status} error`);
            }

            // /chat/completions 兜底也失败 → 标记为可重试（触发候选模型回退）
            const isRetryable = isChannelError || isCloudflareDown || isNoCompatibleAccount;
            const retryErr = new Error(
              isRetryable
                ? `当前模型渠道不可用，已尝试其他模型`
                : `API 服务器错误 (${resp.status})，请稍后重试`
            );
            (retryErr as Error & { retryable?: boolean }).retryable = isRetryable;
            throw retryErr;
          }

          // 通用可重试错误检测 - 不针对特定提供商
          const combinedErrorText = `${errorMsg} ${errorText}`;
          if (combinedErrorText.includes('ratio or price') || combinedErrorText.includes('not configured') || combinedErrorText.includes('model_not_found') || combinedErrorText.includes('model not found') || errorCode === 'model_not_found' || combinedErrorText.includes('No available channel') || combinedErrorText.includes('no available channel')) {
            const retryErr = new Error(`当前模型暂不可用，请稍后重试或更换模型`);
            (retryErr as Error & { retryable?: boolean }).retryable = true;
            throw retryErr;
          }
          // ★ 模型名称建议自动重试：某些中转服务（如 FHL）拒绝带后缀的模型名（如 gpt-image-2-4k），
          // 但错误信息中会建议使用正确的模型名（如 "Use gpt-image-2"），自动提取并重试
          const modelSuggestionMatch = combinedErrorText.match(/use\s+([a-z][\w.-]*[a-z0-9])/i);
          if (!options.controlled && !strictAgentRouting && modelSuggestionMatch && modelSuggestionMatch[1] && modelSuggestionMatch[1] !== currentModelConfig.modelId) {
            const suggestedModel = modelSuggestionMatch[1];
            console.log(`[generate] Model "${currentModelConfig.modelId}" not supported, provider suggests "${suggestedModel}", auto-retrying...`);
            try {
              const suggestedConfig = { ...currentModelConfig, modelId: suggestedModel };
              const result = await submitSingleTask(suggestedConfig, currentApiKey, currentApiBaseUrl, currentProviderId, 1, currentProvider);
              return result; // success with suggested model name
            } catch (suggestedErr) {
              console.warn(`[generate] Retry with suggested model "${suggestedModel}" also failed:`, suggestedErr instanceof Error ? suggestedErr.message : suggestedErr);
              // Fall through to other error handling
            }
          }

          // "No available compatible accounts" - 中转服务的渠道完全不可用
          if (combinedErrorText.includes('no available compatible account') || combinedErrorText.includes('No available compatible')) {
            const retryErr = new Error(`当前模型渠道暂不可用，请稍后重试或更换模型`);
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
        } catch {
          console.error('[generate] API returned non-JSON response, first 200 chars:', responseText.substring(0, 200));
          throw new Error('API 返回了非 JSON 响应（可能是端点不存在或服务器错误），请检查 API 地址配置');
        }

        // 使用兼容性层解析响应（自动识别直接返回 vs 异步轮询）
        console.log('[generate] API response for model', currentModelConfig.modelId, ':', JSON.stringify(submitResult).substring(0, 500));
        const parsed = parseResponseForProfile(submitResult, profile, { responseUrl: resp.url });
        console.log('[generate] parsed mode:', parsed.mode, 'taskIds:', parsed.taskIds.length, 'directUrls:', parsed.directImageUrls.length);

        if (options.controlled && (parsed.directImageUrls.length || parsed.taskIds.length)) {
          return { taskIds: parsed.taskIds, directImageUrls: parsed.directImageUrls, usedModel: currentModelConfig.modelId, usedProviderId: currentProviderId };
        }
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
              ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
            skipV1Retry: strictAgentRouting,
          }
        );

        if (!strictAgentRouting && !submitResponse.ok) {
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

            // ★ 回退到 /images/generations 时的图片字段转换
            // 情况1：旧格式 images[] → 提取为 image_urls（兼容某些 API 代理）
            // 情况2：新格式 image_urls（从 /images/edits 保留）→ 转为 images[] 格式
            //        （OpenAI GPT Image 等模型在 /images/generations 上要求 images[] 格式）
            if (Array.isArray(fallbackBody.images) && !fallbackBody.image_urls) {
              // 旧格式：images[] → image_urls
              fallbackBody.image_urls = (fallbackBody.images as Array<{ image_url: { url: string } }>).map(
                (img) => img.image_url?.url || ''
              ).filter(Boolean);
            }
            delete fallbackBody.images;

            // ★ OpenAI 兼容 API (/images/generations) 需要 images[] 格式而非 image_urls
            // 当有 image_urls 且 profile 是 openai/auto/pearapi 时，转换为 images[]
            if (Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0 &&
                (profile.id === 'openai' || profile.id === 'auto' || profile.id === 'pearapi')) {
              const imagesArray: Array<{ image_url: { url: string } }> = (fallbackBody.image_urls as string[])
                .filter((url: string) => typeof url === 'string' && url.length > 0)
                .map((url: string) => ({ image_url: { url } }));
              if (imagesArray.length > 0) {
                fallbackBody.images = imagesArray;
                delete fallbackBody.image_urls;
              }
            }

            // 增强 prompt：/images/generations 仅将 images[]/image_urls 视为可选参考，
            // 必须在 prompt 中明确指示 AI 使用参考图作为基础，否则 AI 可能忽略参考图
            const fallbackRefImages = fallbackBody.images || fallbackBody.image_urls;
            if (fallbackRefImages && Array.isArray(fallbackRefImages) && fallbackRefImages.length > 0) {
              const refCount = fallbackRefImages.length;
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
                      ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
                    },
                    body: JSON.stringify(fallbackBody),
                    signal: fallbackController.signal,
                    skipV1Retry: strictAgentRouting,
                }
              );
            } catch (fallbackFetchErr: unknown) {
              // /images/generations timed out → try /chat/completions immediately
              // ★ 注意：FHL、AI link、虚宝三个提供商明确不使用 /chat/completions
              const isTimeout = fallbackFetchErr instanceof Error && (fallbackFetchErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackFetchErr.message));
              const baseUrlLower = currentApiBaseUrl.toLowerCase();
              const providersDisablingChatTimeoutFallback = ['fhl.mom', 'ai-link.shop', 'rust.cat'];
              const shouldSkipChatTimeoutFallback = providersDisablingChatTimeoutFallback.some(p => baseUrlLower.includes(p));
              if (isTimeout && !shouldSkipChatTimeoutFallback) {
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
              } else if (isTimeout && shouldSkipChatTimeoutFallback) {
                console.info(`[generate] Provider "${baseUrlLower}" disables /chat/completions, skipping chat fallback after timeout`);
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
              errorText.includes('Missing image') ||
              errorText.includes('image is required');

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
                      ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
                    },
                    body: fdBuffer as unknown as BodyInit,
                    signal: multipartController.signal,
                    skipV1Retry: strictAgentRouting,
                  }
                );
              } catch (multipartError) {
                if (strictAgentRouting) throw multipartError;
                // form-data 包不可用时，回退到浏览器 FormData
                submitResponse = await fetchWithV1Retry(
                  currentApiBaseUrl,
                  endpoint,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${currentApiKey}`,
                      ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
                    },
                    body: buildMultipartBody(),
                    signal: multipartController.signal,
                    skipV1Retry: strictAgentRouting,
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
        // 当 /images/generations 携带参考图时（image_urls 或 images[]），增强 prompt 以确保 AI 使用参考图
        const hasRefImagesInBody = (Array.isArray(adjustedBody.image_urls) && adjustedBody.image_urls.length > 0) ||
                                    (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0);
        if (endpoint === '/images/generations' && hasRefImages && hasRefImagesInBody) {
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
              ...(agentProviderIdempotencyKey ? { 'Idempotency-Key': agentProviderIdempotencyKey } : {}),
            },
            body: JSON.stringify(adjustedBody),
            signal: controller.signal,
            skipV1Retry: strictAgentRouting,
          }
        );

        // ★ Fallback: if /images/generations with images[] nested format fails with
        // "请上传参考图" or "reference #" error, retry with image_urls (flat string array) format.
        // Some providers (e.g. AI Link) don't support the nested images[] format on
        // /images/generations and require the flat image_urls field instead.
        if (!strictAgentRouting && !submitResponse.ok && Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0) {
          const refErrorText = await submitResponse.text();
          if (isEditsEndpointRejected(submitResponse.status, refErrorText)) {
            console.info('[generate] /images/generations with images[] format rejected, retrying with image_urls flat format...');
            const flatUrls = (adjustedBody.images as Array<{ image_url: { url: string } }>)
              .map((img) => img.image_url?.url || '')
              .filter(Boolean);
            delete adjustedBody.images;
            adjustedBody.image_urls = flatUrls;

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
          } else {
            // Reconstruct response for parseSubmitResponse (body was consumed by .text())
            submitResponse = new Response(refErrorText, {
              status: submitResponse.status,
              headers: submitResponse.headers,
            });
          }
        }

        clearTimeoutSafely();
      }

      try {
        return parseSubmitResponse(submitResponse);
      } finally {
        clearTimeoutSafely();
      }
      } finally {
        if (options.controlled) clearTimeoutSafely();
      }
    };

  return submitSingleTask;
}
