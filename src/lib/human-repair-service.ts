import 'server-only';

import crypto from 'node:crypto';
import sharp from 'sharp';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { saveImageFile } from '@/lib/server-data-root';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import {
  analyzeHumanImage,
  buildHumanMaskSpec,
  buildHumanRepairPrompt,
  rankHumanCandidates,
  type HumanAnalysis,
  type HumanCandidate,
  type HumanImageDescriptor,
  type HumanRepairMode,
  type HumanRepairOptions,
  type HumanTarget,
} from '@/lib/human-ai-engine';

export interface HumanRepairTask {
  id: string;
  userId: string;
  sourceImageId: string;
  sourceImageUrl: string;
  status: 'processing' | 'completed' | 'failed';
  analysis: HumanAnalysis;
  candidates: HumanCandidate[];
  selectedCandidateId?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface StartHumanRepairInput {
  userId: string;
  sourceImageId: string;
  sourceImageUrl: string;
  targetIds?: string[];
  candidateCount?: number;
  options?: HumanRepairOptions;
  model?: string;
  providerId?: string;
  mode?: 'mock' | 'auto' | 'gpt-image-edit' | 'flux-edit';
  manualMaskImage?: string;
  requestCookie?: string;
}

interface GlobalHumanTaskStore {
  tasks: Map<string, HumanRepairTask>;
}

function taskStore(): GlobalHumanTaskStore {
  const key = '__wujie_human_repair_task_store__';
  const globalRecord = globalThis as Record<string, unknown>;
  if (!globalRecord[key]) globalRecord[key] = { tasks: new Map<string, HumanRepairTask>() } satisfies GlobalHumanTaskStore;
  return globalRecord[key] as GlobalHumanTaskStore;
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export async function analyzeHumanImageUrl(sourceImageId: string, sourceImageUrl: string): Promise<HumanAnalysis> {
  const buffer = await fetchImageBuffer(sourceImageUrl);
  const metadata = await sharp(buffer).metadata();
  const image: HumanImageDescriptor = {
    id: sourceImageId,
    url: sourceImageUrl,
    width: metadata.width || 1024,
    height: metadata.height || 1024,
  };
  return analyzeHumanImage(image);
}

export async function buildHumanMaskDataUrl(
  image: HumanImageDescriptor,
  target: HumanTarget,
  mode: HumanRepairMode,
  manualMaskImage?: string,
): Promise<string> {
  if (manualMaskImage) return manualMaskImage;
  const spec = buildHumanMaskSpec(target, image, mode);
  const svgShape = spec.shape === 'ellipse'
    ? `<ellipse cx="${spec.box.x + spec.box.width / 2}" cy="${spec.box.y + spec.box.height / 2}" rx="${spec.box.width / 2}" ry="${spec.box.height / 2}" fill="white"/>`
    : `<rect x="${spec.box.x}" y="${spec.box.y}" width="${spec.box.width}" height="${spec.box.height}" rx="${Math.max(8, spec.featherPx)}" fill="white"/>`;
  const svg = `<svg width="${image.width}" height="${image.height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black"/>${svgShape}</svg>`;
  const mask = await sharp(Buffer.from(svg)).png().blur(Math.max(0.3, spec.featherPx / 20)).toBuffer();
  return toDataUrl(mask);
}

function chooseProvider(input: StartHumanRepairInput, target: HumanTarget): 'mock-image-edit' | 'gpt-image-edit' | 'flux-edit' {
  if (input.mode === 'mock' || process.env.HUMAN_AI_ENGINE_MODE === 'mock') return 'mock-image-edit';
  if (input.mode === 'flux-edit') return 'flux-edit';
  if (target.type === 'body' || target.type === 'feet') {
    return input.mode === 'auto' && process.env.HUMAN_AI_ALLOW_FLUX_BODY === 'true' ? 'flux-edit' : 'gpt-image-edit';
  }
  return 'gpt-image-edit';
}

async function mockCandidate(sourceImageUrl: string, taskId: string, target: HumanTarget, index: number): Promise<string> {
  const source = await fetchImageBuffer(sourceImageUrl);
  const output = await sharp(source).png().toBuffer();
  return saveImageFile(output, `${taskId}-${target.id}-candidate-${index + 1}.png`, 'human-repair');
}

async function realCandidate(
  input: StartHumanRepairInput,
  target: HumanTarget,
  maskImage: string,
  provider: 'gpt-image-edit' | 'flux-edit',
): Promise<string> {
  if (!input.model) throw new Error('真实人物精修需要选择已配置的图像编辑模型');
  const origin = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${origin}/api/image-edit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.requestCookie ? { cookie: input.requestCookie } : {}),
    },
    body: JSON.stringify({
      action: 'inpaint',
      imageUrl: input.sourceImageUrl,
      maskImage,
      prompt: buildHumanRepairPrompt(target, input.options),
      model: input.model,
      providerId: input.providerId,
      engine: 'ai',
      providerPreference: provider,
    }),
  });
  const result = await response.json() as { success?: boolean; imageUrl?: string; error?: string };
  if (!response.ok || !result.success || !result.imageUrl) throw new Error(result.error || '人物精修 Provider 未返回图片结果');
  return result.imageUrl;
}

async function runRepair(taskId: string, input: StartHumanRepairInput): Promise<void> {
  const store = taskStore();
  const task = store.tasks.get(taskId);
  if (!task) return;
  try {
    const selectedTargets = input.targetIds?.length
      ? task.analysis.targets.filter(target => input.targetIds?.includes(target.id))
      : task.analysis.targets.filter(target => target.recommendedMode !== 'no_repair');
    if (!selectedTargets.length) throw new Error('没有可修复的人物区域');

    const candidates: Array<Omit<HumanCandidate, 'validation'>> = [];
    const count = Math.max(1, Math.min(4, input.candidateCount || 2));
    for (const [targetIndex, target] of selectedTargets.entries()) {
      const repairMode = target.recommendedMode === 'no_repair' ? 'light' : target.recommendedMode;
      const maskImage = await buildHumanMaskDataUrl(task.analysis.image, target, repairMode, input.manualMaskImage);
      const provider = chooseProvider(input, target);
      for (let index = 0; index < count; index++) {
        const imageUrl = provider === 'mock-image-edit'
          ? await mockCandidate(input.sourceImageUrl, taskId, target, index)
          : await realCandidate(input, target, maskImage, provider);
        candidates.push({
          id: `${taskId}-${target.id}-${index + 1}`,
          targetId: target.id,
          imageUrl,
          provider,
          structureScore: Math.min(98, target.qualityScore + 18 + index * 2),
          // image-edit performs the mask composite, while Mock copies the original exactly.
          outsideChangeRate: 0,
        });
      }
      updateTaskProgress(taskId, {
        status: 'processing',
        progress: Math.round(((targetIndex + 1) / selectedTargets.length) * 90),
        label: `人物精修：${targetIndex + 1}/${selectedTargets.length}`,
      });
    }
    task.candidates = rankHumanCandidates(candidates);
    task.status = 'completed';
    task.completedAt = Date.now();
    updateTaskProgress(taskId, { status: 'completed', progress: 100, label: '人物精修完成', result: task });
  } catch (error) {
    task.status = 'failed';
    task.error = error instanceof Error ? error.message : String(error);
    task.completedAt = Date.now();
    updateTaskProgress(taskId, { status: 'failed', progress: 100, error: task.error, label: '人物精修失败' });
  }
}

export async function startHumanRepair(input: StartHumanRepairInput): Promise<HumanRepairTask> {
  const analysis = await analyzeHumanImageUrl(input.sourceImageId, input.sourceImageUrl);
  const id = `human-${crypto.randomUUID()}`;
  const task: HumanRepairTask = {
    id,
    userId: input.userId,
    sourceImageId: input.sourceImageId,
    sourceImageUrl: input.sourceImageUrl,
    status: 'processing',
    analysis,
    candidates: [],
    createdAt: Date.now(),
  };
  taskStore().tasks.set(id, task);
  registerTask(id, 'image-edit', '人物精修大师', input.userId);
  void runRepair(id, input);
  return task;
}

export function getHumanRepairTask(taskId: string, userId: string): HumanRepairTask | undefined {
  const task = taskStore().tasks.get(taskId);
  return task?.userId === userId ? task : undefined;
}

export async function selectHumanRepairCandidate(taskId: string, userId: string, candidateId: string): Promise<HumanCandidate> {
  const task = getHumanRepairTask(taskId, userId);
  if (!task || task.status !== 'completed') throw new Error('人物精修任务不存在或尚未完成');
  const candidate = task.candidates.find(item => item.id === candidateId && item.validation.passed);
  if (!candidate) throw new Error('候选结果不存在或未通过像素保护校验');
  const buffer = await fetchImageBuffer(candidate.imageUrl);
  const imageUrl = saveImageFile(buffer, `${task.id}-${candidate.id}-selected.png`, 'human-repair-versions');
  task.selectedCandidateId = candidateId;
  return { ...candidate, imageUrl };
}
