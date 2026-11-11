import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { resolveProfileForModel, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { buildDisplay3DRenderPrompt } from '@/lib/display3d-prompts';
import { registerTask, waitForQueueSlot, updateTaskProgress, getTaskInfo, isTaskCancelled, registerTaskAbortController, unregisterTaskAbortController, releaseQueueSlot } from '@/lib/task-registry';
import { claimCloudTaskLease, createCloudTask, releaseCloudTaskLease, updateCloudTask,
  type CloudTaskLease, type UpdateCloudTaskInput } from '@/lib/cloud-task-storage';
import { configuredPaidProviderBaseUrl, submitPaidProviderJson } from '@/lib/paid-provider-submit';
import { completeDisplay3DTask, display3DLeaseFence, display3DProviderTerminal, display3DRemoteReceipt, failDisplay3DTask,
  pollDisplay3DTask, DISPLAY3D_IMAGE_PATH, DISPLAY3D_POLL_WINDOW_MS, DISPLAY3D_QUEUE_EXPIRED, DISPLAY3D_QUEUE_WAIT_MS,
  DISPLAY3D_UNCONFIRMED } from '@/lib/display3d-generation-task';
import { getSessionUser } from '@/lib/server-auth';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import { validateApiInputs } from '@/lib/api-validator';
import { getConfiguredModelsForProvider } from '@/lib/model-type-classification';
import { resolveTaskModelFromProviders } from '@/lib/task-core/model-catalog';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';

const SUBMISSION_TIMEOUT_MS = 300_000;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'timeout'];

function recordAcceptedReceipt(taskId: string, update: UpdateCloudTaskInput): Promise<boolean> {
  // A lost storage acknowledgement can be retried under the same lease without another provider request.
  return updateCloudTask(taskId, update).catch(() => updateCloudTask(taskId, update));
}

function continueDisplay3DPolling(taskId: string, userId: string): void {
  const controller = new AbortController();
  let inFlight = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    clearTimeout(deadline);
    unregisterTaskAbortController(taskId, controller);
    releaseQueueSlot(taskId);
  };
  const deadline = setTimeout(() => {
    controller.abort();
    updateTaskProgress(taskId, { status: 'processing', label: DISPLAY3D_UNCONFIRMED, result: { display3dOutcomeUnconfirmed: true } });
  }, DISPLAY3D_POLL_WINDOW_MS);
  const interval = setInterval(async () => {
    const local = getTaskInfo(taskId);
    if (isTaskCancelled(taskId) || !local || TERMINAL_STATUSES.includes(local.status)) {
      controller.abort();
      return;
    }
    if (inFlight) return;
    inFlight = true;
    try {
      const task = await pollDisplay3DTask(taskId, userId, controller.signal);
      if (!task || TERMINAL_STATUSES.includes(task.status)) stop();
    } catch { /* An interrupted status read leaves the receipt available for recovery. */ }
    finally { inFlight = false; }
  }, 5_000);
  controller.signal.addEventListener('abort', stop, { once: true });
  registerTaskAbortController(taskId, controller);
}

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
    if (adjustedBody.model !== selectedModel || endpoint !== DISPLAY3D_IMAGE_PATH) {
      return NextResponse.json({ error: '所选模型与当前展陈生成接口不兼容，请检查模型配置' }, { status: 400 });
    }

    const apiBase = configuredPaidProviderBaseUrl(provider.baseUrl);
    const taskId = `d3d_${randomUUID()}`;
    const userId = sessionUser.id;
    const label = `3D展陈: ${brandName}`;
    const now = Date.now();
    const created = await createCloudTask({
      id: taskId, userId, type: 'display3d', status: 'queued', providerId: provider.id, model: selectedModel,
      creditStatus: 'not-applicable', creditCost: 0, progress: 0, label, createdAt: now, updatedAt: now,
      result: { display3dReceipt: { state: 'queued' } },
    }).catch(() => false);
    if (!created) {
      return NextResponse.json({ error: '任务记录暂不可用，本次展陈生成未提交' }, { status: 503 });
    }
    registerTask(taskId, 'display3d', label, userId, 'durable');

    // Start async generation
    (async () => {
      let submissionController: AbortController | undefined;
      let lease: CloudTaskLease | null = null;
      let dispatched = false;
      let polling = false;
      try {
        const acquired = await waitForQueueSlot(taskId, DISPLAY3D_QUEUE_WAIT_MS);
        const queuedTask = getTaskInfo(taskId);
        const cancelled = isTaskCancelled(taskId);
        const terminal = !queuedTask || TERMINAL_STATUSES.includes(queuedTask.status);
        if (!acquired || cancelled || terminal) {
          if (!acquired && !cancelled && !terminal) {
            if (await updateCloudTask(taskId, { status: 'failed', expectedStatuses: ['queued'], error: DISPLAY3D_QUEUE_EXPIRED })) {
              updateTaskProgress(taskId, { status: 'failed', error: DISPLAY3D_QUEUE_EXPIRED });
            }
          }
          return;
        }
        submissionController = new AbortController();
        registerTaskAbortController(taskId, submissionController);
        lease = await claimCloudTaskLease(taskId, `display3d-submit-${randomUUID()}`, SUBMISSION_TIMEOUT_MS + 30_000);
        if (!lease || submissionController.signal.aborted || isTaskCancelled(taskId)) return;
        const fence = display3DLeaseFence(lease);
        const started = await updateCloudTask(taskId, {
          ...fence, expectedStatuses: ['queued'], status: 'processing', progress: 10, label: '正在生成展陈方案...',
          result: { display3dReceipt: { state: 'started' } }, mergeResult: true,
        });
        if (!started || submissionController.signal.aborted || isTaskCancelled(taskId)) return;
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在生成展陈方案...' });

        const remainingLeaseMs = lease.expiresAt - Date.now();
        if (remainingLeaseMs <= 0) return;
        dispatched = true;
        const receipt = await submitPaidProviderJson({
          baseUrl: apiBase, path: DISPLAY3D_IMAGE_PATH, apiKey: provider.apiKey, body: adjustedBody,
          signal: AbortSignal.any([submissionController.signal, AbortSignal.timeout(Math.min(remainingLeaseMs, SUBMISSION_TIMEOUT_MS))]),
        });
        if (submissionController.signal.aborted || isTaskCancelled(taskId)) return;
        if (receipt.kind === 'rejected') {
          await failDisplay3DTask(taskId, lease, 'failed', `供应商拒绝展陈生成请求（HTTP ${receipt.status}）`);
          return;
        }
        if (receipt.kind === 'received') {
          const terminal = display3DProviderTerminal(receipt.data);
          if (terminal) {
            await failDisplay3DTask(taskId, lease, terminal);
            return;
          }
          const parsed = parseResponseForProfile(receipt.data, profile);
          if (parsed.directImageUrls.length) {
            const saved = await recordAcceptedReceipt(taskId, {
              ...fence, expectedStatuses: ['processing'], mergeResult: true,
              result: { display3dReceipt: { state: 'direct' }, imageUrls: parsed.directImageUrls, prompt },
            });
            if (saved && !submissionController.signal.aborted && !isTaskCancelled(taskId)) {
              await completeDisplay3DTask(taskId, lease, parsed.directImageUrls, prompt);
            }
            return;
          }
          const remoteTaskId = parsed.taskIds[0];
          const remote = remoteTaskId && display3DRemoteReceipt(apiBase, receipt.responseUrl, remoteTaskId, profile);
          if (remote) {
            const saved = await recordAcceptedReceipt(taskId, {
              ...fence, expectedStatuses: ['processing'], remoteTaskId, progress: 15, mergeResult: true,
              result: { display3dReceipt: remote, prompt },
            });
            if (saved && !submissionController.signal.aborted && !isTaskCancelled(taskId)) polling = true;
            if (saved) return;
          }
        }
        updateTaskProgress(taskId, { status: 'processing', label: DISPLAY3D_UNCONFIRMED, result: { display3dOutcomeUnconfirmed: true } });
      } catch {
        if (submissionController?.signal.aborted || isTaskCancelled(taskId)) return;
        if (dispatched) {
          updateTaskProgress(taskId, { status: 'processing', label: DISPLAY3D_UNCONFIRMED, result: { display3dOutcomeUnconfirmed: true } });
        } else {
          const error = '任务记录未能准备，本次展陈生成未提交';
          await updateCloudTask(taskId, { status: 'failed', expectedStatuses: ['queued', 'processing'], error,
            ...(lease ? display3DLeaseFence(lease) : {}) }).catch(() => false);
          updateTaskProgress(taskId, { status: 'failed', error });
        }
      } finally {
        if (submissionController) unregisterTaskAbortController(taskId, submissionController);
        if (lease) await releaseCloudTaskLease(taskId, lease.owner).catch(() => false);
        if (polling && !submissionController?.signal.aborted && !isTaskCancelled(taskId)) continueDisplay3DPolling(taskId, userId);
        else releaseQueueSlot(taskId);
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
