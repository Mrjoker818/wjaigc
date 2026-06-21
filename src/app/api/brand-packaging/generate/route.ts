import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, findAllProvidersForType } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { buildPackagingRenderPrompt } from '@/lib/packaging-prompts';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
    } = body;

    if (!brandName && !productName) {
      return NextResponse.json({ error: '请提供品牌名或产品名称' }, { status: 400 });
    }

    // Build the prompt (use client-built prompt if provided, otherwise build server-side)
    const prompt = clientPrompt || buildPackagingRenderPrompt({
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

    // Find an image model provider (try multiple strategies for robustness)
    let provider = providerId
      ? await findProviderById(providerId)
      : null;
    if (!provider && model) {
      provider = await findProviderForModel(model, 'image');
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
    const selectedModel = model || provider.selectedModels?.find(m => m) || 'gpt-image-2';

    // Build request body
    const rawBody: Record<string, unknown> = {
      model: selectedModel,
      prompt,
      n: 1,
      size: '1024x1024',
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
    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'packaging', `品牌包装: ${brandName || productName}`, sessionUser?.id);

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
            for (const tryModel of modelsToTry) {
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
