/**
 * AI PSD 生成器 — 任务Worker（Stub）
 *
 * 完整流程：planning → preview_generating → layer_generating → text_building → psd_exporting → packaging → success
 * 当前为占位实现，后续阶段逐步补全
 */

import { dbUpdateTaskStatus, dbGetTask } from './storage';
import type { AiPsdTaskStatus } from './types';

/**
 * 运行 AI PSD 生成任务
 * 当前为 stub 实现，仅模拟流程状态推进
 */
export async function runAiPsdTask(taskId: string): Promise<void> {
  console.log(`[ai-psd-worker] Starting task ${taskId}`);

  const task = await dbGetTask(taskId);
  if (!task) {
    console.error(`[ai-psd-worker] Task ${taskId} not found`);
    return;
  }

  // 更新任务状态的辅助函数
  const setStep = async (status: AiPsdTaskStatus, progress: number, step?: string, layerName?: string) => {
    await dbUpdateTaskStatus(taskId, status, progress, {
      currentStep: step,
      currentLayerName: layerName,
    });
  };

  try {
    // Step 1: 图层规划
    await setStep('planning', 10, '正在规划PSD图层...');
    // TODO: 调用 plan-prompt.ts + LLM 生成 LayerPlan
    // const plan = await generateLayerPlan(task);

    // Step 2: 整图预览
    await setStep('preview_generating', 25, '正在生成整图预览...');
    // TODO: 调用图像模型生成预览图

    // Step 3: 逐层生成
    await setStep('layer_generating', 45, '正在生成分层PNG...');
    // TODO: 根据 LayerPlan 逐层生成 PNG

    // Step 4: 文字层构建
    await setStep('text_building', 65, '正在生成可编辑文字层...');
    // TODO: 构建 PSD 可编辑文字层

    // Step 5: PSD合成
    await setStep('psd_exporting', 80, '正在合成PSD文件...');
    // TODO: 调用 ag-psd 合成 PSD

    // Step 6: 打包
    await setStep('packaging', 92, '正在打包结果文件...');
    // TODO: ZIP/JSON/MD 打包

    // 完成
    await setStep('success', 100, '生成完成');
    console.log(`[ai-psd-worker] Task ${taskId} completed (stub)`);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ai-psd-worker] Task ${taskId} failed:`, message);
    await dbUpdateTaskStatus(taskId, 'failed', 0, { errorMessage: message });
  }
}
