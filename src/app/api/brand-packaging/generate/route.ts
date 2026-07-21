import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, findAllProvidersForType } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { buildPackagingRenderPrompt } from '@/lib/packaging-prompts';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      brandName = '',
      productName = '',
      category = 'beauty',
      structure = {},
      materialCraft = {},
      extendScenes = [],
      outputModes = ['package_render'],
      advancedOptions = {},
      uploads = [],
      model,
      providerId,
      chatModel,
      chatProviderId,
      prompt: clientPrompt,
      quality = '2K',
      aspectRatio = '1:1',
      showcaseSpec = 'standard',
    } = body;

    if (!brandName && !productName) {
      return NextResponse.json({ error: '请提供品牌名或产品名称' }, { status: 400 });
    }

    // Build the prompt (use client-built prompt if provided, otherwise build server-side)
    let prompt = clientPrompt || buildPackagingRenderPrompt({
      brandName,
      productName,
      category,
      structure,
      materialCraft,
      extendScenes,
      outputModes,
      advancedOptions,
      uploads,
    } as Parameters<typeof buildPackagingRenderPrompt>[0]);

    // === 升级：packaging-showcase-series-skill 整合 ===
    // 当输出模式包含 series_family 时，注入对应镜头节奏说明
    if (outputModes.includes('series_family') && showcaseSpec) {
      const SHOWCASE_SHOTS: Record<string, { label: string; shots: string[] }> = {
        compact: {
          label: '精简6张',
          shots: ['纯色背景正面主图', '环境氛围陈列图', '材质特写图', '成分/功能卖点图', '使用场景图', '系列全家福图'],
        },
        standard: {
          label: '标准10张',
          shots: ['纯色背景正面主图', '背景正面+45°斜角图', '环境氛围陈列图', '材质/工艺特写图', '开盖/开启细节图', '成分/卖点信息图', '场景生活感图', '侧面/背面全视角图', '俯视平铺图', '系列全家福图'],
        },
        full: {
          label: '完整14张',
          shots: ['纯色背景正面主图', '背景正面+45°斜角图', '背景正面+俯视角', '环境氛围陈列图A', '环境氛围陈列图B', '材质/工艺特写图', '开盖/开启细节图', '成分/卖点信息图', '场景生活感图A', '场景生活感图B', '侧面/背面全视角图', '俯视平铺图', '礼盒/组合套装展示图', '系列全家福图'],
        },
      };
      const spec = SHOWCASE_SHOTS[showcaseSpec] || SHOWCASE_SHOTS.standard;
      const shotListText = spec.shots.map((s, i) => `${i + 1}. ${s}`).join('；');
      prompt = `${prompt}\n\n【系列图组镜头节奏（${spec.label}）】请严格按照以下 ${spec.shots.length} 个镜头职能依次生成：${shotListText}。确保每张图片在品牌视觉语言、道具和布景调性上保持高度一致性，整组图片形成完整连贯的品牌叙事。`;
    }

    // Find an image model provider (try multiple strategies for robustness)
    let provider = providerId
      ? await findProviderById(providerId)
      : null;
    if (!provider && model) {
      provider = await findProviderForModel(model, 'image', providerId);
    }
    if (!provider) {
      // Fallback: find any available image provider
      provider = await findProviderForModel('', 'image');
    }
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的图像模型，请在管理员后台配置图像模型提供商' }, { status: 400 });
    }

    const profile = resolveCompatProfile(provider);
    // Use user-selected model first, then provider's configured models, then sensible defaults
    const rawSelectedModel = model || provider.selectedModels?.find(m => m) || 'gpt-image-2';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawSelectedModel);
    if (selectedModel !== rawSelectedModel) {
      console.log(`[brand-packaging] Model normalized: ${rawSelectedModel} → ${selectedModel}`);
    }

    // Build request body
    const effectiveSize = calculateActualPixelsFromRatio(aspectRatio, quality, selectedModel) || '2048x2048';
    const rawBody: Record<string, unknown> = {
      model: selectedModel,
      prompt,
      n: 1,
      size: effectiveSize,
      quality,
      aspectRatio,
    };

    // Add reference images if uploaded
    if (Array.isArray(uploads) && uploads.length > 0) {
      const imageUrls = uploads.filter((u: { url?: string }) => u.url).map((u: { url: string }) => u.url);
      if (imageUrls.length > 0) {
        rawBody.image = imageUrls[0];
        rawBody.image_urls = imageUrls;
      }
    }

    const { body: adjustedBody } = adjustRequestForProfile(rawBody, profile);

    // Register task
    const taskId = `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'packaging', `品牌包装: ${brandName || productName}`, authResult.userId);

    // Start async generation with provider fallback
    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在生成包装方案...' });

        // Try current provider first, then fallback to others
        const providers = [provider!];
        // Auto-find additional providers as fallbacks
        try {
          const allImageProviders = await findAllProvidersForType('image');
          for (const p of allImageProviders) {
            if (p.provider.id !== provider!.id && p.models && p.models.length > 0) {
              providers.push(p.provider);
            }
          }
        } catch (_e) { /* ignore fallback lookup errors */ }

        let lastError = '';
        let success = false;

        for (const currentProvider of providers) {
          try {
            const currentProfile = resolveCompatProfile(currentProvider);
            // Model selection: user-specified > provider selected models (try all) > default
            const providerModels = currentProvider.selectedModels?.filter(m => m) || [];
            const modelsToTry = model ? [model] : (providerModels.length > 0 ? providerModels : ['gpt-image-2']);

            let providerSuccess = false;
            for (const rawTryModel of modelsToTry) {
              const { apiModelName: tryModel } = normalizeModelForApi(rawTryModel);
              const currentBody = { ...adjustedBody, model: tryModel };
              const { body: reAdjustedBody } = adjustRequestForProfile(currentBody, currentProfile);

              let apiBase = currentProvider.baseUrl.replace(/\/+$/, '');
              const apiPath = '/images/generations';
              if (apiBase.endsWith('/v1')) {
                apiBase = apiBase.slice(0, -3);
              }

              updateTaskProgress(taskId, { progress: 20, label: `正在使用 ${tryModel} 生成...` });

              const response = await fetchWithV1Retry(apiBase, apiPath, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${currentProvider.apiKey}`,
                },
                body: JSON.stringify(reAdjustedBody),
              });

              if (!response.ok) {
                const errorText = await response.text();
                lastError = `API错误(${response.status}): ${errorText}`;
                console.warn(`[brand-packaging] Provider ${currentProvider.name} model ${tryModel} failed: ${lastError}`);
                continue; // Try next model
              }

              const apiResponse = await response.json();
              const parsed = parseResponseForProfile(apiResponse, currentProfile);

              if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
                updateTaskProgress(taskId, {
                  status: 'completed',
                  progress: 100,
                  result: {
                    imageUrls: parsed.directImageUrls,
                    prompt,
                    type: 'packaging',
                  },
                });
                success = true;
                providerSuccess = true;
                break;
              } else if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
                // Poll for async results
                const pollTaskId = parsed.taskIds[0];
                let pollCount = 0;
                const maxPolls = 60;
                await new Promise<void>((resolve, reject) => {
                  const pollInterval = setInterval(async () => {
                    pollCount++;
                    if (pollCount > maxPolls) {
                      clearInterval(pollInterval);
                      reject(new Error('生成超时'));
                      return;
                    }
                    try {
                      const pollRes = await fetchWithV1Retry(apiBase, `/tasks/${pollTaskId}`, {
                        headers: { 'Authorization': `Bearer ${currentProvider.apiKey}` },
                      });
                      if (!pollRes.ok) return;
                      const pollData = await pollRes.json();
                      const pollParsed = parseResponseForProfile(pollData, currentProfile);
                      if (pollParsed.mode === 'direct' && pollParsed.directImageUrls.length > 0) {
                        clearInterval(pollInterval);
                        updateTaskProgress(taskId, {
                          status: 'completed',
                          progress: 100,
                          result: {
                            imageUrls: pollParsed.directImageUrls,
                            prompt,
                            type: 'packaging',
                          },
                        });
                        success = true;
                        providerSuccess = true;
                        resolve();
                      }
                    } catch {
                      // continue polling
                    }
                  }, 5000);
                });
                if (success) { providerSuccess = true; break; }
              } else {
                lastError = '无法解析API响应';
              }
            } // end modelsToTry loop

            if (providerSuccess) break;
          } catch (providerErr) {
            lastError = providerErr instanceof Error ? providerErr.message : '提供商调用失败';
            console.warn(`[brand-packaging] Provider error:`, lastError);
          }
        }

        if (!success) {
          updateTaskProgress(taskId, { status: 'failed', error: lastError || '所有模型提供商均不可用，请在管理员后台检查配置' });
        }
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '生成失败',
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 }
    );
  }
}
