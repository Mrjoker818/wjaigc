import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, tryChatCompletionsImageFallback, isChannelUnavailableError, persistResultImage } from '@/lib/api-compatibility';
import { registerTask, updateTaskProgress, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { buildJimengPrompt, buildBlackOnWhitePrompt, buildTransparentLogoPrompt, FONT_STYLE_CATEGORIES, SCENE_MAP, STROKE_MAP, GRAPHIC_MAP, MATERIAL_MAP } from '../plan/route';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';

// ★ 字境大师任务结果独立存储（防HMR丢失task-registry状态）
const fontDesignResults = new Map<string, {
  status: 'completed' | 'failed';
  result?: any;
  error?: string;
  updatedAt: number;
}>();

// 10分钟自动清理
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of fontDesignResults) {
    if (now - val.updatedAt > 10 * 60 * 1000) fontDesignResults.delete(key);
  }
}, 60 * 1000);

/** Get font-design task result from local cache (used by poll-task) */
export function getFontDesignResult(taskId: string) {
  return fontDesignResults.get(taskId) || null;
}

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

/**
 * Resolve a style name (e.g. "竹节笔意") to its visual description prompt from FONT_STYLE_CATEGORIES.
 * Also resolves category IDs (e.g. "oriental") to their category name.
 */
function resolveStyleVisualDesc(styleName: string): string {
  if (!styleName || styleName === '智能推荐') return '';
  // Search through all categories and subStyles
  for (const cat of FONT_STYLE_CATEGORIES) {
    // Match category ID
    if (cat.id === styleName) return cat.name;
    // Match subStyle name
    for (const sub of cat.subStyles) {
      if (sub.name === styleName) return sub.prompt;
      if (sub.id === styleName) return sub.prompt;
    }
  }
  return styleName;
}

/**
 * Build a user-settings enforcement suffix that forces key visual parameters
 * into the prompt even when a prompt override is provided.
 */
function buildUserSettingsSuffix(params: {
  style: string; scene: string; color: string; background: string;
  material: string; strokeOptions: string[]; graphicElements: string[];
}): string {
  const parts: string[] = [];

  // Style: expand from name to visual description
  const styleVisual = resolveStyleVisualDesc(params.style);
  if (styleVisual && params.style !== '智能推荐') {
    parts.push(`【必须严格遵循的字体风格】${params.style}：${styleVisual}，所有文字的笔画、结构和造型必须体现这一风格的核心视觉特征`);
  }

  // Scene
  const sceneDesc = SCENE_MAP[params.scene] || '';
  if (sceneDesc) {
    parts.push(`【使用场景】${params.scene}：${sceneDesc}`);
  }

  // Stroke options
  if (params.strokeOptions.length > 0) {
    const strokeDesc = params.strokeOptions.map(s => STROKE_MAP[s] || s).join('、');
    parts.push(`【笔画处理】${strokeDesc}`);
  }

  // Graphic elements
  if (params.graphicElements.length > 0) {
    const graphicDesc = params.graphicElements.map(g => GRAPHIC_MAP[g] || g).join('、');
    parts.push(`【图形融合】${graphicDesc}，图形元素必须自然融入笔画`);
  }

  // Color & Material
  if (params.color && params.color !== '白色') {
    const matDesc = MATERIAL_MAP[params.material] || params.material;
    parts.push(`【色彩材质】字体颜色${params.color}，质感${matDesc}`);
  } else if (params.material && params.material !== '平面矢量') {
    const matDesc = MATERIAL_MAP[params.material] || params.material;
    parts.push(`【质感】${matDesc}`);
  }

  // Background
  if (params.background && params.background !== '高级留白' && params.background !== '纯色背景') {
    parts.push(`【背景】${params.background}`);
  }

  return parts.length > 0 ? '\n\n' + parts.join('\n') : '';
}

export async function POST(request: NextRequest) {
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      prompt, model, ratio = '16:9', count = 1,
      text, scene, primaryStyleCategory, secondaryStyle,
      color, background, strokeOptions, graphicElements, material,
      jimengEnhanced = true, mode = 'full', providerId,
    } = body as Record<string, unknown>;

    const textStr = String(text || '');
    const sceneStr = String(scene || 'KV主标题');
    const styleStr = String(secondaryStyle || primaryStyleCategory || '智能推荐');
    const modeStr = String(mode || 'full');
    const colorStr = String(color || '白色');
    const bgStr = String(background || '高级留白');
    const matStr = String(material || '平面矢量');
    const ratioStr = String(ratio || '横版16:9');
    const modelStr = model ? String(model) : '';
    // ★ 去除 providerId:: 前缀
    const pureModelStr = modelStr.includes('::') ? modelStr.split('::').pop()! : modelStr;
    const numCount = Math.min(Number(count) || 1, 4);
    const isJimeng = jimengEnhanced !== false;
    const strokes: string[] = Array.isArray(strokeOptions) ? strokeOptions.map(String) : [];
    const graphics: string[] = Array.isArray(graphicElements) ? graphicElements.map(String) : [];

    // Build user-settings suffix for enforcement
    const userSettingsSuffix = buildUserSettingsSuffix({
      style: styleStr, scene: sceneStr, color: colorStr, background: bgStr,
      material: matStr, strokeOptions: strokes, graphicElements: graphics,
    });

    // 积分检查与扣除
    deductedCredits = 0;
    sessionUser = await getSessionUser(request).catch(() => null);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_generate', undefined, undefined, modelStr);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    let finalPrompt = '';
    if (prompt) {
      // When prompt is provided as override, still enforce user settings
      finalPrompt = String(prompt) + userSettingsSuffix;
    } else if (textStr) {
      if (modeStr === 'black-on-white') {
        finalPrompt = buildBlackOnWhitePrompt(textStr) + userSettingsSuffix;
      } else if (modeStr === 'transparent-logo') {
        finalPrompt = buildTransparentLogoPrompt(textStr) + userSettingsSuffix;
      } else {
        finalPrompt = buildJimengPrompt({
          text: textStr, scene: sceneStr, style: styleStr,
          strokeOptions: strokes, graphicElements: graphics,
          color: colorStr, background: bgStr, material: matStr,
          ratio: ratioStr, jimengEnhanced: isJimeng,
        });
      }
    }

    if (!finalPrompt) {
      return NextResponse.json({ error: '缺少提示词或文字输入' }, { status: 400 });
    }

    // ★ 收集所有可用的提供商（支持多提供商自动切换，解决单提供商429/限流问题）
    const { getApiProviders } = await import('@/lib/server-api-config');
    const allProviders = await getApiProviders();
    const enabledImageProviders = allProviders.filter(p => {
      if (!p.isEnabled || !p.baseUrl || !p.apiKey) return false;
      const mt = p.modelType || '';
      return mt === 'image' || mt === 'universal' || mt === 'general';
    });

    // 按 providerId 精确匹配优先 → 包含目标模型的提供商 → 任意 image 提供商
    let providerCandidates: typeof enabledImageProviders = [];
    if (providerId) {
      const preferred = enabledImageProviders.find(p => p.id === providerId);
      if (preferred) {
        providerCandidates = [preferred, ...enabledImageProviders.filter(p => p.id !== providerId)];
      } else {
        console.warn(`[font-design/generate-image] providerId="${providerId}" 未找到匹配提供商`);
      }
    }
    if (providerCandidates.length === 0 && modelStr) {
      const modelProviders = enabledImageProviders.filter(p =>
        (p.selectedModels || []).some(m => m === pureModelStr || m === modelStr)
      );
      // preferredProviderId（非精确id格式）优先
      if (providerId && typeof providerId === 'string' && !providerId.startsWith('api_')) {
        const prefMatch = modelProviders.find(p => p.id === providerId);
        if (prefMatch) {
          providerCandidates = [prefMatch, ...modelProviders.filter(p => p.id !== providerId)];
        } else {
          providerCandidates = modelProviders;
        }
      } else {
        providerCandidates = modelProviders;
      }
    }
    if (providerCandidates.length === 0) {
      providerCandidates = enabledImageProviders;
    }
    if (providerCandidates.length === 0) {
      return NextResponse.json({ error: '未找到可用的图像生成模型，请在管理员后台配置' }, { status: 400 });
    }

    console.log(`[font-design/generate-image] ${providerCandidates.length} 个候选提供商: [${providerCandidates.map(p => `"${p.displayName || p.name}"`).join(', ')}]`);

    const usedModelRaw = pureModelStr || (providerCandidates[0]?.selectedModels?.[0] || '');
    // ★ 规范化模型名（如 gpt-image-2-2k → gpt-image-2）
    const usedModelNorm = normalizeModelForApi(usedModelRaw);
    const usedModel = usedModelNorm.wasNormalized ? usedModelNorm.apiModelName : usedModelRaw;
    if (usedModelNorm.wasNormalized) {
      console.log(`[font-design/generate-image] Normalized model alias: "${usedModelRaw}" → "${usedModel}"`);
    }

    const taskId = `font-design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'font-design', `字体设计: ${textStr || '生成图片'}`, sessionUser?.id);
    updateTaskProgress(taskId, { status: 'processing', progress: 0, label: '正在生成字体设计图片...' });

    // ★ 判断是否为可重试错误（429限流/502网关/503服务不可用）
    const isRetryableError = (status: number, errText: string): boolean => {
      if (status === 429) return true; // 限流
      if (status === 402) return true; // 余额不足，切换到其他提供商
      if (status === 502 || status === 503) return true; // 网关/服务不可用
      if (/rate.?limit|quota|weekly.?limit|usage.?limit|insufficient.*balance|余额不足/i.test(errText)) return true;
      if (/no available compatible account/i.test(errText)) return true;
      return false;
    };

    // 使用 after() 确保响应返回后 IIFE 仍可运行
    after(async () => {
      const MAX_PROVIDERS_TO_TRY = Math.min(providerCandidates.length, 6); // 最多尝试6个提供商
      let lastError = '';

      for (let pi = 0; pi < MAX_PROVIDERS_TO_TRY; pi++) {
        const provider = providerCandidates[pi];
        const pBaseUrl = provider.baseUrl || '';
        const pApiKey = provider.apiKey || '';
        const pCompatProfile = resolveCompatProfile(provider);
        const pProviderName = provider.displayName || provider.name;

        // 每个提供商可能支持不同的模型名，重新计算
        const pModelRaw = pureModelStr || (provider.selectedModels?.includes(usedModel) ? usedModel : provider.selectedModels?.[0]) || usedModel;
        const pModelNorm = normalizeModelForApi(pModelRaw);
        const pModel = pModelNorm.wasNormalized ? pModelNorm.apiModelName : pModelRaw;

        if (pi > 0) {
          console.log(`[font-design/generate-image] 切换到第 ${pi + 1} 个提供商: ${pProviderName} (model=${pModel})`);
          updateTaskProgress(taskId, { progress: 10 + pi * 10, label: `尝试提供商 ${pProviderName}...` });
        }

        try {
          if (isTaskCancelled(taskId)) { updateTaskProgress(taskId, { status: 'cancelled' }); return; }

          const requestBody: Record<string, unknown> = {
            model: pModel,
            prompt: finalPrompt,
            n: numCount,
            size: ratioStr,
            aspectRatio: ratioStr,
            quality: '2K',
          };

          const adjustedRequest = adjustRequestForProfile(requestBody, pCompatProfile);
          const endpoint = adjustedRequest.endpoint || '/images/generations';

          const response = await fetchWithV1Retry(pBaseUrl, endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${pApiKey}`,
            },
            body: JSON.stringify(adjustedRequest.body || requestBody),
            signal: AbortSignal.timeout(15000),
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            lastError = `API错误 ${response.status}: ${errText.slice(0, 200)}`;

            // ★ 可重试错误 → 切换到下一个提供商
            if (isRetryableError(response.status, errText) && pi < MAX_PROVIDERS_TO_TRY - 1) {
              console.warn(`[font-design/generate-image] 提供商 ${pProviderName} 返回 ${response.status}，尝试下一个提供商`);
              continue;
            }

            // ★ Try /chat/completions fallback for 429/channel errors (在非最后一个提供商时也尝试，因为fallback可能走不同端点)
            if (isChannelUnavailableError(`${errText} ${response.status}`) || response.status === 429) {
              console.info(`[font-design] ${pProviderName} ${response.status === 429 ? 'rate limited' : 'channel error'}, trying /chat/completions fallback...`);
              try {
                const chatImageUrls = await tryChatCompletionsImageFallback({
                  baseUrl: pBaseUrl,
                  apiKey: pApiKey,
                  model: pModel,
                  prompt: finalPrompt,
                  size: ratioStr,
                  originalError: errText,
                  requestIdPrefix: 'font-design',
                  skipChannelCheck: true,
                });
                if (chatImageUrls && chatImageUrls.length > 0) {
                  console.log(`[font-design] /chat/completions fallback succeeded via ${pProviderName}, got`, chatImageUrls.length, 'images');
                  const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
                  const completedResult = { directImageUrls: persistedUrls, prompt: finalPrompt, model: pModel };
                  updateTaskProgress(taskId, {
                    status: 'completed', progress: 100,
                    result: completedResult,
                  });
                  fontDesignResults.set(taskId, { status: 'completed', result: completedResult, updatedAt: Date.now() });
                  return;
                }
              } catch (chatErr) {
                console.warn(`[font-design] /chat/completions fallback error via ${pProviderName}:`, chatErr);
              }
            }

            // 非最后一个提供商，继续尝试下一个
            if (pi < MAX_PROVIDERS_TO_TRY - 1) {
              console.info(`[font-design] Provider ${pProviderName} failed, trying next... (${pi+1}/${MAX_PROVIDERS_TO_TRY})`);
              continue;
            }
            // 所有提供商都失败了
            console.error(`[font-design] All ${MAX_PROVIDERS_TO_TRY} providers failed. Last error:`, lastError);
            updateTaskProgress(taskId, { status: 'failed', error: lastError });
            return;
          }

          const data = await response.json();
          const parsed = parseResponseForProfile(data, pCompatProfile);

          if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
            // 持久化图片到本地
            const persistedUrls = await Promise.all(parsed.directImageUrls.map(persistResultImage));
            const completedResult = { directImageUrls: persistedUrls, prompt: finalPrompt, model: pModel };
            updateTaskProgress(taskId, {
              status: 'completed', progress: 100,
              result: completedResult,
            });
            fontDesignResults.set(taskId, { status: 'completed', result: completedResult, updatedAt: Date.now() });
          } else if (parsed.taskIds && parsed.taskIds.length > 0) {
            const asyncResult = {
              remoteTaskId: parsed.taskIds[0],
              apiBaseUrl: pBaseUrl, apiKey: pApiKey, usedModel: pModel, compatProfile: pCompatProfile, prompt: finalPrompt,
            };
            updateTaskProgress(taskId, {
              status: 'processing', progress: 30,
              label: '图片生成中，等待远程API返回...',
              result: asyncResult,
            });
            fontDesignResults.set(taskId, { status: 'completed' as const, result: asyncResult, updatedAt: Date.now() });
          } else {
            // API返回200但无有效结果，尝试下一个提供商
            lastError = 'API未返回有效结果';
            if (pi < MAX_PROVIDERS_TO_TRY - 1) {
              console.warn(`[font-design/generate-image] 提供商 ${pProviderName} 返回空结果，尝试下一个`);
              continue;
            }
            updateTaskProgress(taskId, { status: 'failed', error: lastError });
          }
          return; // 成功或最终失败，退出循环
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
          lastError = err instanceof Error ? err.message : '生成失败';

          if (isTimeout) {
            // 超时说明该提供商网络不可达，跳过chat/completions fallback，直接尝试下一个提供商
            console.info(`[font-design] ${pProviderName} timed out (network unreachable), skipping to next provider`);
            lastError = `${pProviderName} 超时（网络不可达）`;
            if (pi < MAX_PROVIDERS_TO_TRY - 1) {
              continue; // 直接尝试下一个提供商
            }
            // 最后一个提供商也超时，整体失败
            updateTaskProgress(taskId, { status: 'failed', error: '所有提供商均超时不可达' });
            fontDesignResults.set(taskId, { status: 'failed' as const, error: '所有提供商均超时不可达', updatedAt: Date.now() });
            return;
          }

          // 超时或网络错误，尝试下一个提供商
          if (pi < MAX_PROVIDERS_TO_TRY - 1) {
            console.warn(`[font-design/generate-image] 提供商 ${pProviderName} 错误: ${lastError}，尝试下一个`);
            continue;
          }

          if (!isTaskCancelled(taskId)) {
            const failErr = `所有提供商均失败，最后错误: ${lastError}`;
            updateTaskProgress(taskId, { status: 'failed', error: failErr });
            fontDesignResults.set(taskId, { status: 'failed' as const, error: failErr, updatedAt: Date.now() });
          }
        }
      }

      // 所有提供商都尝试过了
      if (!isTaskCancelled(taskId)) {
        const failErr = `所有 ${MAX_PROVIDERS_TO_TRY} 个提供商均失败: ${lastError}`;
        updateTaskProgress(taskId, { status: 'failed', error: failErr });
        fontDesignResults.set(taskId, { status: 'failed' as const, error: failErr, updatedAt: Date.now() });
      }
    });

    return NextResponse.json({ taskId, prompt: finalPrompt, model: usedModel });
  } catch (error: unknown) {
    console.error('[font-design/generate-image] Error:', error);
    // 退款：字体设计图片生成失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `字体设计生成失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[font-design/generate-image] Refund failed:', refundErr); }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成图片失败' }, { status: 500 });
  }
}
