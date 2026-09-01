import { NextRequest, NextResponse, after } from 'next/server';
import { createHash } from 'node:crypto';
import { normalizeModelForApi, filterRequestForModel } from '@/lib/model-capabilities';
import { normalizeProviderModelSelection } from '@/lib/task-core/exact-model-selection';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { persistResultImage } from '@/lib/persist-result-image';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { buildJimengPrompt, buildBlackOnWhitePrompt, buildTransparentLogoPrompt, FONT_STYLE_CATEGORIES, SCENE_MAP, STROKE_MAP, GRAPHIC_MAP, MATERIAL_MAP } from '../plan/constants';
import { getSessionUser } from '@/lib/server-auth';
import { calculateConfiguredCreditCost, InsufficientCreditsError } from '@/lib/credits';
import { createBillableTask, settleFailedTask } from '@/lib/task-core/billing-service';
import { completeCloudTask, updateCloudTask } from '@/lib/cloud-task-storage';
import {
  IdempotencyConflictError,
  isIdempotencyValidationError,
  validateIdempotencyIdentity,
} from '@/lib/task-core/idempotency';
import { validateApiInputs } from '@/lib/api-validator';
import { logError, OP_ACTIONS } from '@/lib/op-log';
import { setFontDesignResult } from '@/lib/font-design-task-store';

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
  const startTime = Date.now();
  let durableTaskId: string | undefined;
  let sessionUser: import('@/lib/user-types').User | null = null;
  const selectedModel = '';
  const providerIdUsed = '';
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
    const embeddedProviderId = modelStr.includes('::') ? modelStr.split('::')[0] : '';
    const pureModelStr = modelStr.includes('::') ? modelStr.split('::').pop()! : modelStr;
    const effectiveProviderId = String(providerId || embeddedProviderId || '');
    if (providerId && embeddedProviderId && providerId !== embeddedProviderId) {
      return NextResponse.json({
        success: false,
        code: 'MODEL_PROVIDER_MISMATCH',
        error: '模型所属供应商与当前选择的供应商不一致，请刷新模型列表后重新选择',
        retryable: false,
        providerId,
        model: pureModelStr,
      }, { status: 400 });
    }
    const numCount = Math.min(Number(count) || 1, 4);
    const isJimeng = jimengEnhanced !== false;
    const strokes: string[] = Array.isArray(strokeOptions) ? strokeOptions.map(String) : [];
    const graphics: string[] = Array.isArray(graphicElements) ? graphicElements.map(String) : [];

    // Build user-settings suffix for enforcement
    const userSettingsSuffix = buildUserSettingsSuffix({
      style: styleStr, scene: sceneStr, color: colorStr, background: bgStr,
      material: matStr, strokeOptions: strokes, graphicElements: graphics,
    });

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

    // 显式 providerId 是冻结路由；仅未指定供应商时允许自动发现和切换。
    let providerCandidates: typeof enabledImageProviders = [];
    let exactModelId = '';
    if (effectiveProviderId) {
      const preferred = enabledImageProviders.find(p => p.id === effectiveProviderId);
      const providerDefaultModel = preferred?.selectedModels?.[0] || preferred?.discoveredModels?.[0]?.id || '';
      const selection = normalizeProviderModelSelection({
        requestedModelId: pureModelStr || providerDefaultModel,
        selectedModels: preferred?.selectedModels,
        discoveredModels: preferred?.discoveredModels,
      });
      if (!preferred || !selection.matched) {
        return NextResponse.json({
          success: false,
          code: 'MODEL_PROVIDER_MISMATCH',
          error: '所选模型已不在当前供应商的可用列表中，请刷新模型列表后重新选择',
          retryable: false,
          providerId: effectiveProviderId,
          model: pureModelStr,
        }, { status: 400 });
      }
      providerCandidates = [preferred];
      exactModelId = selection.modelId;
    }
    if (!effectiveProviderId && providerCandidates.length === 0 && modelStr) {
      const modelProviders = enabledImageProviders.filter(p =>
        (p.selectedModels || []).some(m => m === pureModelStr || m === modelStr)
      );
      providerCandidates = modelProviders;
    }
    if (!effectiveProviderId && providerCandidates.length === 0) {
      providerCandidates = enabledImageProviders;
    }
    if (providerCandidates.length === 0) {
      return NextResponse.json({ error: '未找到可用的图像生成模型，请在管理员后台配置' }, { status: 400 });
    }

    console.log(`[font-design/generate-image] ${providerCandidates.length} 个候选提供商: [${providerCandidates.map(p => `"${p.displayName || p.name}"`).join(', ')}]`);

    const usedModelRaw = exactModelId || pureModelStr || (providerCandidates[0]?.selectedModels?.[0] || '');
    // ★ 规范化模型名（如 gpt-image-2-2k → gpt-image-2）
    const usedModelNorm = normalizeModelForApi(usedModelRaw);
    const usedModel = usedModelNorm.wasNormalized ? usedModelNorm.apiModelName : usedModelRaw;
    if (usedModelNorm.wasNormalized) {
      console.log(`[font-design/generate-image] Normalized model alias: "${usedModelRaw}" → "${usedModel}"`);
    }

    // 提示词与候选供应商预检通过后，以同一数据库事务创建任务并扣费。
    sessionUser = await getSessionUser(request).catch(() => null);
    if (!sessionUser) return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });

    const candidateTaskId = `font-design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = request.headers.get('idempotency-key')?.trim()
      || request.headers.get('x-idempotency-key')?.trim()
      || candidateTaskId;
    const pricingModel = modelStr || usedModelRaw;
    const requestDigest = createHash('sha256').update(JSON.stringify({
      prompt: finalPrompt,
      model: pricingModel,
      providerId: providerCandidates[0]?.id,
      ratio: ratioStr,
      count: numCount,
    })).digest('hex');
    const billableIdentity = validateIdempotencyIdentity({
      userId: sessionUser.id,
      idempotencyKey,
      requestDigest,
    });
    const creditCost = await calculateConfiguredCreditCost('image_generate', pricingModel, {
      providerId: providerCandidates[0]?.id,
    });
    const label = `字体设计: ${textStr || '生成图片'}`;
    const admission = await createBillableTask({
      ...billableIdentity,
      creditCost,
      task: {
        id: candidateTaskId,
        type: 'font-design',
        status: 'processing',
        progress: 0,
        providerId: providerCandidates[0]?.id,
        model: usedModel,
        label,
        result: {
          submissionPayload: {
            workerMode: 'local',
            taskKind: 'font-design',
          },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    const taskId = admission.task.id;
    durableTaskId = taskId;
    if (admission.reused) {
      return NextResponse.json({
        taskId,
        prompt: finalPrompt,
        model: admission.task.model || usedModel,
        providerId: admission.task.providerId || providerCandidates[0]?.id,
        reused: true,
        status: admission.task.status,
      });
    }
    registerTask(taskId, 'font-design', label, sessionUser.id, 'durable');
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
      const failTask = async (
        status: 'failed' | 'cancelled' | 'timeout',
        code: string,
        message: string,
      ): Promise<void> => {
        const settled = await settleFailedTask({ taskId, status, error: { code, message } });
        if (settled.transitioned) {
          setFontDesignResult(taskId, { status: 'failed', error: message, updatedAt: Date.now() });
        }
      };
      const completeTask = async (
        completedResult: Record<string, unknown>,
        completedProvider: (typeof providerCandidates)[number],
      ): Promise<boolean> => {
        const imageUrls = Array.isArray(completedResult.directImageUrls)
          ? completedResult.directImageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
          : [];
        const durableResult = {
          ...completedResult,
          imageUrl: imageUrls[0] || '',
          imageUrls,
          providerId: completedProvider.id,
          providerName: completedProvider.displayName || completedProvider.name,
          usedModel: completedResult.model || usedModel,
          modelName: completedResult.model || usedModel,
        };
        const committed = await completeCloudTask(taskId, durableResult);
        if (!committed) return false;
        updateTaskProgress(taskId, { status: 'completed', progress: 100, result: durableResult });
        setFontDesignResult(taskId, { status: 'completed', result: durableResult, updatedAt: Date.now() });
        return true;
      };

      for (let pi = 0; pi < MAX_PROVIDERS_TO_TRY; pi++) {
        const provider = providerCandidates[pi];
        const pBaseUrl = provider.baseUrl || '';
        const pApiKey = provider.apiKey || '';
        const pCompatProfile = resolveCompatProfile(provider);
        const pProviderName = provider.displayName || provider.name;

        // 每个提供商可能支持不同的模型名，重新计算
        const pModelRaw = exactModelId || pureModelStr || (provider.selectedModels?.includes(usedModel) ? usedModel : provider.selectedModels?.[0]) || usedModel;
        const pModelNorm = normalizeModelForApi(pModelRaw);
        const pModel = pModelNorm.wasNormalized ? pModelNorm.apiModelName : pModelRaw;

        if (pi > 0) {
          console.log(`[font-design/generate-image] 切换到第 ${pi + 1} 个提供商: ${pProviderName} (model=${pModel})`);
          updateTaskProgress(taskId, { progress: 10 + pi * 10, label: `尝试提供商 ${pProviderName}...` });
        }

        try {
          if (isTaskCancelled(taskId)) {
            await failTask('cancelled', 'USER_CANCELLED', '用户已取消字体设计生成任务');
            return;
          }

          const requestBody: Record<string, unknown> = {
            model: pModel,
            prompt: finalPrompt,
            n: numCount,
            size: ratioStr,
            aspectRatio: ratioStr,
            quality: '2K',
          };

          // 按模型能力过滤请求参数（如 gpt-image-2 不支持 2K，自动移除 quality）
          const filteredRequest = filterRequestForModel(pModel, requestBody);
          const requestBodyFinal = filteredRequest as Record<string, unknown>;

          const adjustedRequest = adjustRequestForProfile(requestBodyFinal, pCompatProfile);
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
                  await completeTask(completedResult, provider);
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
            await failTask('failed', 'ALL_PROVIDERS_FAILED', lastError);
            return;
          }

          const data = await response.json();
          const parsed = parseResponseForProfile(data, pCompatProfile);

          if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
            // 持久化图片到本地
            const persistedUrls = await Promise.all(parsed.directImageUrls.map(persistResultImage));
            const completedResult = { directImageUrls: persistedUrls, prompt: finalPrompt, model: pModel };
            await completeTask(completedResult, provider);
          } else if (parsed.taskIds && parsed.taskIds.length > 0) {
            const durableAsyncResult = {
              remoteTaskId: parsed.taskIds[0],
              usedModel: pModel,
              modelName: pModel,
              providerId: provider.id,
              providerName: pProviderName,
              prompt: finalPrompt,
            };
            updateTaskProgress(taskId, {
              status: 'processing', progress: 30,
              label: '图片生成中，等待远程API返回...',
              result: durableAsyncResult,
            });
            await updateCloudTask(taskId, {
              remoteTaskId: parsed.taskIds[0],
              progress: 30,
              label: '图片生成中，等待远程API返回...',
              result: durableAsyncResult,
              mergeResult: true,
              expectedStatuses: ['processing'],
            });
          } else {
            // API返回200但无有效结果，尝试下一个提供商
            lastError = 'API未返回有效结果';
            if (pi < MAX_PROVIDERS_TO_TRY - 1) {
              console.warn(`[font-design/generate-image] 提供商 ${pProviderName} 返回空结果，尝试下一个`);
              continue;
            }
            await failTask('failed', 'EMPTY_PROVIDER_RESULT', lastError);
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
            await failTask('timeout', 'MODEL_TIMEOUT', '所有提供商均超时不可达');
            return;
          }

          // 超时或网络错误，尝试下一个提供商
          if (pi < MAX_PROVIDERS_TO_TRY - 1) {
            console.warn(`[font-design/generate-image] 提供商 ${pProviderName} 错误: ${lastError}，尝试下一个`);
            continue;
          }

          if (!isTaskCancelled(taskId)) {
            const failErr = `所有提供商均失败，最后错误: ${lastError}`;
            await failTask('failed', 'ALL_PROVIDERS_FAILED', failErr);
          }
        }
      }

      // 所有提供商都尝试过了
      if (!isTaskCancelled(taskId)) {
        const failErr = `所有 ${MAX_PROVIDERS_TO_TRY} 个提供商均失败: ${lastError}`;
        await failTask('failed', 'ALL_PROVIDERS_FAILED', failErr);
      }
    });

    return NextResponse.json({ taskId, prompt: finalPrompt, model: usedModel, providerId: providerCandidates[0]?.id });
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    console.error('[font-design/generate-image] Error:', error);
    logError(OP_ACTIONS.FONT_DESIGN_GENERATE, error, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedModel,
      providerId: providerIdUsed,
      durationMs,
      detail: `字体设计图片生成失败`,
    });
    if (durableTaskId) {
      try {
        await settleFailedTask({
          taskId: durableTaskId,
          status: 'failed',
          error: { code: 'REQUEST_SETUP_FAILED', message: error instanceof Error ? error.message : '生成图片失败' },
        });
      } catch (settlementError) { console.error('[font-design/generate-image] Durable settlement failed:', settlementError); }
    }
    if (isIdempotencyValidationError(error)) {
      return NextResponse.json({ success: false, code: 'INVALID_IDEMPOTENCY_KEY', error: error.message }, { status: 400 });
    }
    if (error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成图片失败' }, { status: 500 });
  }
}
