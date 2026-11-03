import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { resolveProfileForModel, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { buildDisplay3DRenderPrompt } from '@/lib/display3d-prompts';
import { registerTask, waitForQueueSlot, updateTaskProgress, getTaskInfo, isTaskCancelled, registerTaskAbortController, unregisterTaskAbortController, releaseQueueSlot } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import { validateApiInputs } from '@/lib/api-validator';
import { getConfiguredModelsForProvider } from '@/lib/model-type-classification';
import { resolveTaskModelFromProviders } from '@/lib/task-core/model-catalog';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'optionalImageUrl',
        prompt: 'optionalPrompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      brandName = '',
      productName = '',
      sceneType = 'pop_up_store',
      environment = 'mall_atrium',
      dimensions = { length: 9000, width: 6000, height: 4500, unit: 'mm' },
      imageUsageMode = 'texture_mapping',
      materialStyle = '',
      lightingStyle = '',
      brandColor = '',
      focusProduct = '',
      crowdStyle = '',
      budget,
      viewOptions = ['angle_45', 'front'],
      renderStyle = '',
      outputResolution,
      outputFormat,
      outputQuality,
      assets = [],
      model,
      providerId,
      prompt: clientPrompt,
      quality,
      aspectRatio,
    } = body;
    const renderMode = renderStyle || (body as Record<string, unknown>).renderMode as string || '';

    if (!brandName) {
      return NextResponse.json({ error: '请提供品牌名称' }, { status: 400 });
    }

    // Build the prompt (use client-built prompt if provided, otherwise build server-side)
    const prompt = clientPrompt || buildDisplay3DRenderPrompt({
      brandName,
      productName,
      brandColor,
      focusProduct,
      sceneType,
      environment,
      dimensions,
      imageUsageMode,
      materialStyle,
      lightingStyle,
      crowdStyle,
      budget,
      viewOptions,
      renderStyle: renderMode, // renderMode is derived from renderStyle field
      outputResolution,
      outputFormat,
      outputQuality,
    });

    if ((providerId !== undefined && typeof providerId !== 'string') || (model !== undefined && typeof model !== 'string')) {
      return NextResponse.json({ error: '供应商或模型参数无效' }, { status: 400 });
    }
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return NextResponse.json({ error: '请登录后再生成展陈方案' }, { status: 401 });
    const providers = await getApiProviders();
    const requestedProviderId = typeof providerId === 'string' ? providerId.trim() : '';
    const requestedModel = typeof model === 'string' ? model.trim() : '';
    const availableProviders = providers.filter(p => p.isEnabled && p.baseUrl && p.apiKey && (p.modelType === 'image' || p.modelType === 'universal' || p.modelType === 'general'));
    const provider = requestedProviderId
      ? availableProviders.find(p => p.id === requestedProviderId)
      : requestedModel
        ? availableProviders.find(p => p.selectedModels?.includes(requestedModel))
          || availableProviders.find(p => getConfiguredModelsForProvider(p).some(item => item.id === requestedModel))
        : availableProviders.find(p => p.isDefault) || availableProviders[0];
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的图像模型，请在管理员后台配置' }, { status: 400 });
    }

    const candidateModel = requestedModel || provider.selectedModels?.[0] || 'gpt-image-2';
    let selectedModel: string;
    try {
      const descriptor = resolveTaskModelFromProviders(providers, provider.id, candidateModel, sessionUser);
      if (descriptor.kind !== 'image') return NextResponse.json({ error: '所选模型不支持图像生成' }, { status: 403 });
      selectedModel = descriptor.modelId;
    } catch (error) {
      if (error instanceof ModelCapabilityError) return NextResponse.json({ error: '所选模型不可用或未获得授权' }, { status: 403 });
      throw error;
    }
    const profile = resolveProfileForModel(selectedModel, provider);

    // Build request body
    const effectiveQuality = quality || '1K';
    const effectiveAspectRatio = aspectRatio || '1:1';
    const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, selectedModel) || '1024x1024';
    const rawBody: Record<string, unknown> = {
      model: selectedModel,
      prompt,
      n: 1,
      size: dynamicSize,
      quality: effectiveQuality,
    };

    // Add reference images
    if (Array.isArray(assets) && assets.length > 0) {
      const imageUrls = assets.filter((a: { url?: string }) => a.url).map((a: { url: string }) => a.url);
      if (imageUrls.length > 0) {
        rawBody.image = imageUrls[0];
        rawBody.image_urls = imageUrls;
      }
    }

    const { body: adjustedBody, endpoint } = adjustRequestForProfile(rawBody, profile);
    if (adjustedBody.model !== selectedModel || endpoint !== '/images/generations') {
      return NextResponse.json({ error: '所选模型与当前展陈生成接口不兼容，请检查模型配置' }, { status: 400 });
    }

    // Register task
    const taskId = `d3d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'display3d', `3D展陈: ${brandName}`, sessionUser?.id);

    // Start async generation
    (async () => {
      let submissionController: AbortController | undefined;
      try {
        const acquired = await waitForQueueSlot(taskId);
        const queuedTask = getTaskInfo(taskId);
        const cancelled = isTaskCancelled(taskId);
        const terminal = !queuedTask || ['completed', 'failed', 'cancelled', 'timeout'].includes(queuedTask.status);
        if (!acquired || cancelled || terminal) {
          if (cancelled) releaseQueueSlot(taskId);
          if (!acquired && !cancelled && !terminal) {
            updateTaskProgress(taskId, { status: 'failed', error: '等待执行名额超时，任务未向供应商提交' });
          }
          return;
        }
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在生成展陈方案...' });

        // The configured base is authoritative for a billable submission.
        const apiBase = provider.baseUrl.replace(/\/+$/, '');
        const apiPath = '/images/generations';
        submissionController = new AbortController();
        registerTaskAbortController(taskId, submissionController);

        const response = await fetchWithV1Retry(apiBase, apiPath, {
          method: 'POST',
          skipV1Retry: true,
          redirect: 'manual',
          signal: AbortSignal.any([submissionController.signal, AbortSignal.timeout(300_000)]),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(adjustedBody),
        });

        if (submissionController.signal.aborted || isTaskCancelled(taskId)) return;

        if (!response.ok) {
          updateTaskProgress(taskId, { status: 'failed', error: `API错误: ${response.status}` });
          return;
        }

        const apiResponse = await response.json();
        if (submissionController.signal.aborted || isTaskCancelled(taskId)) return;
        unregisterTaskAbortController(taskId, submissionController);
        submissionController = undefined;
        const parsed = parseResponseForProfile(apiResponse, profile);

        if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            result: {
              imageUrls: parsed.directImageUrls,
              prompt,
              type: 'display3d',
            },
          });
        } else if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
          // Poll for async results
          const pollTaskId = parsed.taskIds[0];
          if (pollTaskId === '.' || pollTaskId === '..') {
            updateTaskProgress(taskId, { status: 'processing', label: '上游任务已提交，但查询标识异常，请核实任务状态', result: { display3dOutcomeUnconfirmed: true } });
            releaseQueueSlot(taskId);
            return;
          }
          const encodedPollTaskId = encodeURIComponent(pollTaskId);
          let pollBase = apiBase;
          try {
            const submittedUrl = new URL(response.url);
            const providerUrl = new URL(provider.baseUrl);
            if (submittedUrl.origin === providerUrl.origin && !submittedUrl.search && !submittedUrl.hash && submittedUrl.pathname.endsWith(apiPath)) {
              pollBase = `${submittedUrl.origin}${submittedUrl.pathname.slice(0, -apiPath.length)}`.replace(/\/+$/, '');
            }
          } catch {
            // Some transports cannot report the final URL; retain the existing fallback.
          }
          const pollPath = profile.pollPathTemplate?.startsWith('/') && profile.pollPathTemplate.includes('{taskId}')
            ? profile.pollPathTemplate.replace('{taskId}', encodedPollTaskId)
            : `/tasks/${encodedPollTaskId}`;
          let pollCount = 0;
          const maxPolls = 60;
          const controller = new AbortController();
          let inFlight = false;
          let pollInterval: ReturnType<typeof setInterval> | undefined;
          let pollDeadline: ReturnType<typeof setTimeout> | undefined;
          const stop = (): void => {
            if (pollInterval !== undefined) clearInterval(pollInterval);
            if (pollDeadline !== undefined) clearTimeout(pollDeadline);
            pollInterval = undefined;
            pollDeadline = undefined;
            unregisterTaskAbortController(taskId, controller);
          };
          const isStopped = (): boolean => {
            const task = getTaskInfo(taskId);
            return controller.signal.aborted || isTaskCancelled(taskId) || !task
              || ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status);
          };
          controller.signal.addEventListener('abort', stop, { once: true });
          registerTaskAbortController(taskId, controller);
          if (isStopped()) { stop(); return; }
          pollDeadline = setTimeout(() => {
            if (isStopped()) { stop(); return; }
            stop();
            controller.abort();
            updateTaskProgress(taskId, { status: 'processing', label: '远端任务查询超时，结果待核，请保留任务编号核实', result: { display3dOutcomeUnconfirmed: true } });
            releaseQueueSlot(taskId);
          }, 305_000);
          pollInterval = setInterval(async () => {
            if (isStopped()) { stop(); return; }
            if (inFlight) return;
            pollCount++;
            if (pollCount > maxPolls) {
              stop();
              updateTaskProgress(taskId, { status: 'processing', label: '远端任务查询超时，结果待核，请保留任务编号核实', result: { display3dOutcomeUnconfirmed: true } });
              releaseQueueSlot(taskId);
              return;
            }
            inFlight = true;
            try {
              const pollRes = await fetchWithV1Retry(pollBase, pollPath, {
                signal: controller.signal,
                headers: { 'Authorization': `Bearer ${provider.apiKey}` },
              });
              if (isStopped()) { stop(); return; }
              if (!pollRes.ok) return;
              const pollData = await pollRes.json();
              if (isStopped()) { stop(); return; }
              const pollParsed = parseResponseForProfile(pollData, profile);
              if (pollParsed.mode === 'direct' && pollParsed.directImageUrls.length > 0) {
                stop();
                updateTaskProgress(taskId, {
                  status: 'completed',
                  progress: 100,
                  result: {
                    imageUrls: pollParsed.directImageUrls,
                    prompt,
                    type: 'display3d',
                  },
                });
              }
            } catch {
              // continue polling
            } finally {
              inFlight = false;
            }
          }, 5000);
        } else {
          updateTaskProgress(taskId, { status: 'failed', error: '无法解析API响应' });
        }
      } catch {
        if (submissionController?.signal.aborted || isTaskCancelled(taskId)) return;
        updateTaskProgress(taskId, {
          status: 'failed',
          error: '展陈生成请求失败，请核实任务状态',
        });
      } finally {
        if (submissionController) unregisterTaskAbortController(taskId, submissionController);
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch {
    return NextResponse.json(
      { error: '展陈生成服务暂不可用，请稍后核实任务状态' },
      { status: 500 }
    );
  }
}
