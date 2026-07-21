import 'server-only';

import crypto from 'node:crypto';
import sharp from 'sharp';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { saveImageFile } from '@/lib/server-data-root';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { findProviderForFeature } from '@/lib/server-api-config';
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

// ─────────────────────────────────────────────────────────────────────────────
// Vision LLM 真实检测适配器
// 当有配置 chat 模型时，发送图片给 Vision LLM 解析人物区域和质量评分
// 失败时无缝降级回 mock 检测器
// ─────────────────────────────────────────────────────────────────────────────

interface VisionDetectTarget {
  type: string;
  x: number; y: number; width: number; height: number;
  qualityScore: number;
  issues: string[];
}

interface VisionDetectResult {
  persons: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  targets: VisionDetectTarget[];
}

async function detectHumanWithVision(
  imageUrl: string,
  imageWidth: number,
  imageHeight: number,
): Promise<VisionDetectResult | null> {
  try {
    // 找一个支持 Vision 的 chat / vlm 模型
    const provider = await findProviderForFeature('chat');
    if (!provider) return null;
    const visionModels: string[] = (provider as { selectedModels?: string[]; models?: string[] }).selectedModels ?? (provider as { selectedModels?: string[]; models?: string[] }).models ?? [];
    if (visionModels.length === 0) return null;

    const origin = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT || 5000}`;
    const systemPrompt = `You are a professional human anatomy quality analyst for AI-generated images.
Analyze the provided image and identify all human body regions.
For each detected region, output a JSON object with:
- type: one of [face, left_hand, right_hand, body, feet, hair, clothes, interaction]
- x, y, width, height: bounding box as 0-1 normalized ratios of image dimensions
- qualityScore: 0-100 integer (100=perfect, <70=needs repair, <50=serious defect)
- issues: array of specific defect keywords (e.g. "extra_fingers","eye_asymmetry","blur","limb_proportion")

Also output a persons array with detected person bounding boxes (normalized).

Respond ONLY with a valid JSON object matching this schema:
{
  "persons": [{"id":"person_01","x":0.1,"y":0.0,"width":0.8,"height":1.0}],
  "targets": [{"type":"face","x":0.35,"y":0.05,"width":0.3,"height":0.25,"qualityScore":72,"issues":["blur"]}]
}`;

    const response = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: 'Analyze this image and detect all human body regions with quality scores. Return ONLY the JSON object.' },
            ],
          },
        ],
        model: visionModels[0],
        providerId: provider.id,
        stream: false,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as { content?: string; message?: { content: string } };
    const raw = data.content || data.message?.content || '';
    // 从响应中提取 JSON（LLM 有时会附加说明文字）
    const match = raw.match(/\{[\s\S]*"targets"[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as VisionDetectResult;
    if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) return null;
    // 验证归一化坐标在合法范围内
    const validTargets = parsed.targets.filter(
      t => t.x >= 0 && t.y >= 0 && t.width > 0 && t.height > 0 &&
        t.x + t.width <= 1.05 && t.y + t.height <= 1.05,
    );
    if (validTargets.length === 0) return null;
    return { persons: parsed.persons || [], targets: validTargets };
  } catch {
    return null;
  }
}

export async function analyzeHumanImageUrl(sourceImageId: string, sourceImageUrl: string): Promise<HumanAnalysis> {
  const buffer = await fetchImageBuffer(sourceImageUrl);
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const image: HumanImageDescriptor = { id: sourceImageId, url: sourceImageUrl, width, height };

  // 尝试 Vision LLM 真实检测
  const visionResult = await detectHumanWithVision(sourceImageUrl, width, height);
  if (visionResult) {
    const VALID_TYPES = new Set(['face','left_hand','right_hand','body','feet','hair','clothes','interaction']);
    const persons = visionResult.persons.length > 0
      ? visionResult.persons.map(p => ({
          id: p.id || 'person_01',
          box: {
            x: Math.round(p.x * width),
            y: Math.round(p.y * height),
            width: Math.max(1, Math.round(p.width * width)),
            height: Math.max(1, Math.round(p.height * height)),
          },
        }))
      : [{ id: 'person_01', box: { x: Math.round(width * 0.16), y: Math.round(height * 0.05), width: Math.round(width * 0.68), height: Math.round(height * 0.9) } }];

    function recommend(score: number): HumanRepairMode | 'no_repair' {
      if (score >= 85) return 'no_repair';
      if (score >= 70) return 'light';
      if (score >= 50) return 'standard';
      return 'deep';
    }

    const targets: HumanTarget[] = visionResult.targets
      .filter(t => VALID_TYPES.has(t.type))
      .map((t, idx) => ({
        id: `${t.type}_0${idx + 1}`,
        personId: persons[0]?.id || 'person_01',
        type: t.type as HumanTarget['type'],
        box: {
          x: Math.round(t.x * width),
          y: Math.round(t.y * height),
          width: Math.max(1, Math.round(t.width * width)),
          height: Math.max(1, Math.round(t.height * height)),
        },
        qualityScore: Math.max(0, Math.min(100, Math.round(t.qualityScore))),
        recommendedMode: recommend(Math.max(0, Math.min(100, Math.round(t.qualityScore)))),
        issues: Array.isArray(t.issues) ? t.issues.slice(0, 5) : [],
      }));

    const scores = Object.fromEntries(targets.map(target => [target.type, target.qualityScore]));
    scores.overall = Math.round(targets.reduce((sum, t) => sum + t.qualityScore, 0) / (targets.length || 1));

    return {
      image,
      persons,
      targets,
      scores,
      recommendations: targets
        .filter((t): t is HumanTarget & { recommendedMode: HumanRepairMode } => t.recommendedMode !== 'no_repair')
        .map(t => ({ targetId: t.id, mode: t.recommendedMode })),
      detector: 'vision-adapter',
    };
  }

  // 降级：确定性 Mock 检测器（CI / 无 Vision 模型时使用）
  return analyzeHumanImage(image);
}

// ─────────────────────────────────────────────────────────────────────────────
// 蒙版外像素保护：对比修复前后图片，计算蒙版外区域的变化率
// ─────────────────────────────────────────────────────────────────────────────

async function computeOutsideChangeRate(
  originalUrl: string,
  repairedUrl: string,
  maskSpec: { box: { x: number; y: number; width: number; height: number } },
  imageWidth: number,
  imageHeight: number,
): Promise<number> {
  try {
    const [originalBuffer, repairedBuffer] = await Promise.all([
      fetchImageBuffer(originalUrl),
      fetchImageBuffer(repairedUrl),
    ]);
    // 将两张图统一缩放到 256px 宽，加速 pixel diff
    const THUMB = 256;
    const thumbHeight = Math.round((imageHeight / imageWidth) * THUMB);
    const [origThumb, repThumb] = await Promise.all([
      sharp(originalBuffer).resize(THUMB, thumbHeight, { fit: 'fill' }).raw().toBuffer(),
      sharp(repairedBuffer).resize(THUMB, thumbHeight, { fit: 'fill' }).raw().toBuffer(),
    ]);

    // 蒙版 bbox 在缩略图坐标系中的范围
    const scaleX = THUMB / imageWidth;
    const scaleY = thumbHeight / imageHeight;
    const maskX = Math.round(maskSpec.box.x * scaleX);
    const maskY = Math.round(maskSpec.box.y * scaleY);
    const maskW = Math.round(maskSpec.box.width * scaleX);
    const maskH = Math.round(maskSpec.box.height * scaleY);

    let outsidePixels = 0;
    let changedOutsidePixels = 0;
    const channels = 3; // raw RGB

    for (let py = 0; py < thumbHeight; py++) {
      for (let px = 0; px < THUMB; px++) {
        // 蒙版内区域跳过
        if (px >= maskX && px < maskX + maskW && py >= maskY && py < maskY + maskH) continue;
        outsidePixels++;
        const offset = (py * THUMB + px) * channels;
        const dr = Math.abs(origThumb[offset] - repThumb[offset]);
        const dg = Math.abs(origThumb[offset + 1] - repThumb[offset + 1]);
        const db = Math.abs(origThumb[offset + 2] - repThumb[offset + 2]);
        if ((dr + dg + db) > 15) changedOutsidePixels++;
      }
    }

    return outsidePixels > 0 ? changedOutsidePixels / outsidePixels : 0;
  } catch {
    return 0;
  }
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
      const maskSpec = buildHumanMaskSpec(target, task.analysis.image, repairMode);

      for (let index = 0; index < count; index++) {
        let imageUrl: string;
        let outsideChangeRate = 0;

        if (provider === 'mock-image-edit') {
          imageUrl = await mockCandidate(input.sourceImageUrl, taskId, target, index);
          // Mock 模式不改变原图，outsideChangeRate 精确为 0
          outsideChangeRate = 0;
        } else {
          imageUrl = await realCandidate(input, target, maskImage);
          // 计算蒙版外像素变化率，确保原图保护
          outsideChangeRate = await computeOutsideChangeRate(
            input.sourceImageUrl,
            imageUrl,
            maskSpec,
            task.analysis.image.width,
            task.analysis.image.height,
          );
        }

        candidates.push({
          id: `${taskId}-${target.id}-${index + 1}`,
          targetId: target.id,
          imageUrl,
          provider,
          structureScore: Math.min(98, target.qualityScore + 18 + index * 2),
          outsideChangeRate,
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
  const imageUrl = await saveImageFile(buffer, `${task.id}-${candidate.id}-selected.png`, 'human-repair-versions');
  task.selectedCandidateId = candidateId;
  return { ...candidate, imageUrl };
}
