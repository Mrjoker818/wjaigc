import 'server-only';

import { nanoid } from 'nanoid';

import type { BrandIpDirection, BrandIpProject } from '@/lib/brand-ip';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getApiProviders } from '@/lib/server-api-config';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import {
  isTaskCancelled,
  registerTask,
  updateTaskProgress,
  waitForQueueSlot,
} from '@/lib/task-registry';
import { saveBrandIpAsset } from '@/lib/brand-ip-storage';

export const BRAND_IP_ASSET_TYPES = ['标准角色图', '单色版', '小尺寸', '表情包'] as const;
export type BrandIpAssetType = (typeof BRAND_IP_ASSET_TYPES)[number];

const ASSET_TYPE_PROMPTS: Record<BrandIpAssetType, string> = {
  '标准角色图': '输出完整标准角色设定图：单一主角、正面全身、清晰轮廓、干净纯色背景，优先展现品牌识别元素与角色比例。',
  '单色版': '输出单色识别版：仅使用单一深色与单一浅色，不使用渐变、纹理或复杂光影，确保轮廓与品牌符号在单色印刷中清晰可辨。',
  '小尺寸': '输出小尺寸适配版：构图简洁、主体占画面大部分、移除细小装饰，确保在 48px 图标尺寸下仍能识别角色轮廓和核心符号。',
  '表情包': '输出表情包资产：方形构图、角色半身或头像、表情与动作鲜明、留出清晰边缘，不包含文字、水印或复杂背景。',
};

function compileAssetPrompt(prompt: string, assetType: BrandIpAssetType): string {
  return `${prompt}\n\n资产交付类型：${assetType}\n${ASSET_TYPE_PROMPTS[assetType]}`;
}

export interface CreateBrandIpGenerationTaskInput {
  userId: string;
  userRole: string;
  project: BrandIpProject;
  direction: BrandIpDirection;
  prompt: string;
  model?: string;
  providerId?: string;
  aspectRatio?: string;
  assetType: BrandIpAssetType;
}

export interface BrandIpGenerationTask {
  taskId: string;
  status: 'pending' | 'queued';
}

// ─── 授权图像模型选择 ──────────────────────────────────────────────────

interface AuthorizedImageModel {
  providerId: string;
  modelId: string;
  provider: ApiProvider;
}

function providerSupportsImage(provider: ApiProvider): boolean {
  const type = provider.modelType ?? provider.type;
  return type === 'image' || type === 'universal' || type === 'general';
}

function providerOwnsModel(provider: ApiProvider, modelId: string): boolean {
  return Boolean(
    provider.selectedModels?.includes(modelId)
    || provider.selectedModel === modelId
    || provider.discoveredModels?.some((model: ModelInfo) => model.id === modelId),
  );
}

function modelAllowedForUser(user: User, providerId: string, modelId: string): boolean {
  if (user.role === 'admin') return true;
  return isModelAssignedToUser(user.imageModels, providerId, modelId);
}

function buildAuthorizedImageModels(user: User, providers: ApiProvider[]): AuthorizedImageModel[] {
  const result: AuthorizedImageModel[] = [];

  for (const provider of providers) {
    if (!provider.isEnabled || !providerSupportsImage(provider)) continue;
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;

    const selectedIds = new Set<string>();
    for (const modelId of provider.selectedModels ?? []) selectedIds.add(modelId);
    if (provider.selectedModel) selectedIds.add(provider.selectedModel);
    for (const model of provider.discoveredModels ?? []) {
      if (provider.selectedModels?.includes(model.id) || provider.selectedModel === model.id) {
        selectedIds.add(model.id);
      }
    }

    for (const modelId of selectedIds) {
      if (!providerOwnsModel(provider, modelId)) continue;
      if (!modelAllowedForUser(user, provider.id, modelId)) continue;
      result.push({ providerId: provider.id, modelId, provider });
    }
  }

  return result;
}

export interface ResolveImageModelResult {
  model: string;
  providerId: string;
}

/**
 * Resolve an authorized image model for the user.
 * Prefers explicit model/providerId from the request; falls back to first authorized.
 */
export async function resolveImageModel(
  user: User,
  preferredModel?: string,
  preferredProviderId?: string,
): Promise<ResolveImageModelResult | null> {
  const providers = await getApiProviders();
  const authorized = buildAuthorizedImageModels(user, providers);

  if (authorized.length === 0) return null;

  // Try exact match on preferred model + provider
  if (preferredModel && preferredProviderId) {
    const match = authorized.find(
      m => m.modelId === preferredModel && m.providerId === preferredProviderId,
    );
    if (match) return { model: match.modelId, providerId: match.providerId };
  }

  // Try preferred model only
  if (preferredModel) {
    const match = authorized.find(m => m.modelId === preferredModel);
    if (match) return { model: match.modelId, providerId: match.providerId };
  }

  // Fall back to first available
  const first = authorized[0];
  return { model: first.modelId, providerId: first.providerId };
}

// ─── 任务创建 ──────────────────────────────────────────────────────────

export async function createBrandIpGenerationTask(input: CreateBrandIpGenerationTaskInput): Promise<BrandIpGenerationTask> {
  const taskId = `brand-ip-${nanoid(16)}`;
  const task = registerTask(taskId, 'brand-generate', '正在生成品牌 IP 视觉资产', input.userId);
  updateTaskProgress(taskId, {
    status: task.status === 'queued' ? 'queued' : 'pending',
    progress: 0,
    result: {
      projectId: input.project.id,
      directionId: input.direction.id,
      prompt: input.prompt,
      model: input.model,
      providerId: input.providerId,
      assetType: input.assetType,
    },
  });

  return { taskId, status: task.status === 'queued' ? 'queued' : 'pending' };
}

// ─── 异步生成执行 ──────────────────────────────────────────────────────

export interface ExecuteBrandIpGenerationInput {
  taskId: string;
  userId: string;
  userRole: string;
  user: User;
  projectId: string;
  directionId: string;
  prompt: string;
  model?: string;
  providerId?: string;
  aspectRatio?: string;
  assetType: BrandIpAssetType;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

function getServerPort(): string {
  return process.env.DEPLOY_RUN_PORT || '5000';
}

/**
 * Execute the brand IP generation pipeline asynchronously.
 *
 * This function is designed to be called in a fire-and-forget IIFE after the
 * HTTP response has been sent. It:
 * 1. Waits for a queue slot
 * 2. Resolves an authorized image model
 * 3. Submits a generation request via internal API
 * 4. Polls for completion (with cancellation checks)
 * 5. Saves the result as a brand asset
 * 6. Updates the task to a terminal state
 */
export async function executeBrandIpGeneration(input: ExecuteBrandIpGenerationInput): Promise<void> {
  const { taskId } = input;

  try {
    // 1. Wait for queue slot
    const gotSlot = await waitForQueueSlot(taskId);
    if (!gotSlot) {
      if (!isTaskCancelled(taskId)) {
        updateTaskProgress(taskId, {
          status: 'failed',
          progress: 0,
          error: '排队超时，请稍后重试',
        });
      }
      return;
    }

    // 2. Check cancellation
    if (isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'cancelled', progress: 0 });
      return;
    }

    // 3. Resolve authorized image model
    updateTaskProgress(taskId, { status: 'processing', progress: 5, label: '正在选择生成模型...' });

    const resolved = await resolveImageModel(input.user, input.model, input.providerId);
    if (!resolved) {
      updateTaskProgress(taskId, {
        status: 'failed',
        progress: 0,
        error: '没有可用的图像生成模型，请联系管理员配置',
      });
      return;
    }

    // 4. Submit generation request via internal API
    updateTaskProgress(taskId, { progress: 10, label: '正在提交生成请求...' });

    const headers = await getInternalRequestHeaders(input.userId, input.userRole as 'user' | 'admin');
    const port = getServerPort();

    const submitBody: Record<string, unknown> = {
      prompt: compileAssetPrompt(input.prompt, input.assetType),
      model: resolved.model,
      providerId: resolved.providerId,
      submitOnly: true,
    };
    if (input.aspectRatio) {
      submitBody.aspectRatio = input.aspectRatio;
    }

    const submitResponse = await fetch(`http://localhost:${port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.json().catch(() => ({}));
      const errorMsg = (errorData as Record<string, unknown>)?.error as string || `生成请求失败: ${submitResponse.status}`;
      updateTaskProgress(taskId, { status: 'failed', progress: 0, error: errorMsg });
      return;
    }

    const submitData = await submitResponse.json();
    const providerTaskIds: string[] = submitData.taskIds || submitData.taskId ? [submitData.taskId] : [];
    if (providerTaskIds.length === 0) {
      // Synchronous completion — image URL may be in the response
      const directImageUrl = submitData.imageUrl || submitData.result?.imageUrl;
      if (directImageUrl) {
        await completeGeneration(input, resolved, directImageUrl);
        return;
      }
      updateTaskProgress(taskId, {
        status: 'failed',
        progress: 0,
        error: '生成请求未返回任务ID或图片',
      });
      return;
    }

    // 5. Poll for result
    updateTaskProgress(taskId, { progress: 30, label: '正在生成品牌资产...' });

    const providerTaskId = providerTaskIds[0];
    let imageUrl: string | null = null;
    let pollAttempts = 0;

    while (pollAttempts < MAX_POLL_ATTEMPTS) {
      // Check cancellation
      if (isTaskCancelled(taskId)) {
        // Cancel the provider task
        await fetch(`http://localhost:${port}/api/cancel-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ taskId: providerTaskId }),
        }).catch(() => {});
        updateTaskProgress(taskId, { status: 'cancelled', progress: 0 });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      pollAttempts++;

      let pollData: Record<string, unknown>;
      try {
        const pollResponse = await fetch(`http://localhost:${port}/api/poll-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ taskId: providerTaskId, model: resolved.model }),
        });

        if (!pollResponse.ok) continue;
        pollData = await pollResponse.json() as Record<string, unknown>;
      } catch {
        continue;
      }

      const pollStatus = pollData.status as string;

      if (pollStatus === 'completed') {
        imageUrl = (pollData.imageUrl as string) || (pollData.result as Record<string, unknown>)?.imageUrl as string || null;
        break;
      }

      if (pollStatus === 'failed') {
        const errorMsg = (pollData.error as string) || '生成失败';
        updateTaskProgress(taskId, { status: 'failed', progress: 0, error: errorMsg });
        return;
      }

      if (pollStatus === 'cancelled') {
        updateTaskProgress(taskId, { status: 'cancelled', progress: 0 });
        return;
      }

      // Update progress based on poll progress
      const pollProgress = typeof pollData.progress === 'number' ? pollData.progress : 0;
      const mappedProgress = Math.min(90, 30 + (pollProgress / 100) * 60);
      const pollLabel = (pollData.label as string) || '正在生成...';
      updateTaskProgress(taskId, { progress: mappedProgress, label: pollLabel });
    }

    if (!imageUrl) {
      updateTaskProgress(taskId, {
        status: 'failed',
        progress: 0,
        error: '生成超时，请稍后重试',
      });
      return;
    }

    // 6. Save asset and complete
    await completeGeneration(input, resolved, imageUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '品牌资产生成失败';
    if (!isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'failed', progress: 0, error: errorMessage });
    }
  }
}

async function completeGeneration(
  input: ExecuteBrandIpGenerationInput,
  resolved: ResolveImageModelResult,
  imageUrl: string,
): Promise<void> {
  updateTaskProgress(input.taskId, { progress: 95, label: '正在保存品牌资产...' });

  const asset = await saveBrandIpAsset({
    projectId: input.projectId,
    userId: input.userId,
    taskId: input.taskId,
    imageUrl,
    prompt: input.prompt,
    model: resolved.model,
    providerId: resolved.providerId,
    directionId: input.directionId,
    metadata: {
      aspectRatio: input.aspectRatio ?? null,
      assetType: input.assetType,
    },
  });

  updateTaskProgress(input.taskId, {
    status: 'completed',
    progress: 100,
    label: '品牌资产生成完成',
    result: {
      imageUrl,
      assetId: asset.id,
      assetVersion: asset.version,
      model: resolved.model,
      providerId: resolved.providerId,
    },
  });
}
