/**
 * 任务阶段标签 — 为 task-registry 的 label 字段提供语义化中文阶段标签
 *
 * 设计原则：
 * - 标签随任务进展逐步细化，让用户感知 AI 正在做什么
 * - 标签简短（≤12字），适合在进度条旁显示
 * - 各任务类型有独立的阶段序列，互不干扰
 */

// ─── 图像生成阶段 ────────────────────────────────────────────────────

export const GENERATE_STAGES = {
  INIT: '初始化生成任务',
  SUBMITTING: '提交生成请求',
  COMPILING_PROMPT: '编译提示词中',
  CALLING_API: '正在调用AI模型',
  GENERATING: 'AI模型生成图像中',
  DOWNLOADING: '下载生成结果中',
  SAVING: '保存图片中',
  COMPLETED: (count: number) => `生成完成 (${count}张)`,
  FAILED: '生成失败',
  TIMEOUT: '生成超时',
} as const;

// ─── 视频生成阶段 ────────────────────────────────────────────────────

export const VIDEO_STAGES = {
  INIT: '初始化视频任务',
  SUBMITTING: '提交视频生成请求',
  QUEUEING: '视频任务排队中',
  GENERATING: 'AI模型生成视频中',
  PROCESSING: '视频后期处理中',
  DOWNLOADING: '下载视频结果中',
  SAVING: '保存视频中',
  COMPLETED: '视频生成完成',
  FAILED: '视频生成失败',
} as const;

// ─── 图片编辑阶段 (擦除/蒙版/放大/扩展/去背景) ──────────────────────

export const EDIT_STAGES = {
  INIT: '初始化编辑任务',
  ANALYZING: '分析图片中',
  PROCESSING: 'AI处理图片中',
  COMPOSITING: '合成结果中',
  SAVING: '保存结果中',
  COMPLETED: '编辑完成',
  FAILED: '编辑失败',
} as const;

// ─── 3D 模型生成阶段 ────────────────────────────────────────────────

export const MODEL_3D_STAGES = {
  INIT: '初始化3D任务',
  SUBMITTING: '提交3D生成请求',
  GENERATING: 'AI模型生成3D中',
  DOWNLOADING: '下载3D模型中',
  SAVING: '保存3D模型中',
  COMPLETED: '3D模型生成完成',
  FAILED: '3D生成失败',
} as const;

// ─── 根据进度推断阶段标签 ────────────────────────────────────────────

/**
 * 根据进度百分比推断图像生成阶段标签
 * 用于 poll-task 轮询时，当远端 API 不返回状态文本时的兜底
 */
export function inferGenerateStageLabel(progress: number, elapsedMs?: number): string {
  if (progress >= 100) return GENERATE_STAGES.COMPLETED(1);
  if (progress >= 90) return GENERATE_STAGES.SAVING;
  if (progress >= 70) return GENERATE_STAGES.DOWNLOADING;
  if (progress >= 20) return GENERATE_STAGES.GENERATING;
  if (progress >= 5) return GENERATE_STAGES.CALLING_API;
  // 基于时间的兜底
  if (elapsedMs !== undefined) {
    if (elapsedMs < 3000) return GENERATE_STAGES.INIT;
    if (elapsedMs < 8000) return GENERATE_STAGES.COMPILING_PROMPT;
  }
  return GENERATE_STAGES.CALLING_API;
}

/**
 * 根据进度百分比推断视频生成阶段标签
 */
export function inferVideoStageLabel(progress: number, elapsedMs?: number): string {
  if (progress >= 100) return VIDEO_STAGES.COMPLETED;
  if (progress >= 90) return VIDEO_STAGES.SAVING;
  if (progress >= 75) return VIDEO_STAGES.DOWNLOADING;
  if (progress >= 40) return VIDEO_STAGES.GENERATING;
  if (progress >= 10) return VIDEO_STAGES.QUEUEING;
  if (elapsedMs !== undefined && elapsedMs < 3000) return VIDEO_STAGES.INIT;
  return VIDEO_STAGES.GENERATING;
}

/**
 * 根据进度百分比推断图片编辑阶段标签
 */
export function inferEditStageLabel(progress: number): string {
  if (progress >= 100) return EDIT_STAGES.COMPLETED;
  if (progress >= 85) return EDIT_STAGES.SAVING;
  if (progress >= 60) return EDIT_STAGES.COMPOSITING;
  if (progress >= 20) return EDIT_STAGES.PROCESSING;
  if (progress >= 5) return EDIT_STAGES.ANALYZING;
  return EDIT_STAGES.INIT;
}

/**
 * 根据任务类型和进度推断阶段标签
 */
export function inferStageLabel(
  taskType: string,
  progress: number,
  elapsedMs?: number
): string {
  if (taskType === 'video' || taskType === 'video-extend') {
    return inferVideoStageLabel(progress, elapsedMs);
  }
  if (taskType === '3d' || taskType === '3d-auto-multi-view' || taskType === '3d-retexture' || taskType === '3d-remesh') {
    if (progress >= 100) return MODEL_3D_STAGES.COMPLETED;
    if (progress >= 80) return MODEL_3D_STAGES.SAVING;
    if (progress >= 50) return MODEL_3D_STAGES.DOWNLOADING;
    if (progress >= 10) return MODEL_3D_STAGES.GENERATING;
    return MODEL_3D_STAGES.SUBMITTING;
  }
  if (['erase', 'mask', 'upscale', 'removebg', 'extend', 'outpaint'].includes(taskType)) {
    return inferEditStageLabel(progress);
  }
  // 默认：图像生成
  return inferGenerateStageLabel(progress, elapsedMs);
}
