/**
 * AI PSD 生成器 — 创建任务 API
 * POST /api/ai-psd/create
 *
 * 对应文档：第4节 API接口 — POST /api/skills/ai-psd/create
 */

import { NextRequest, NextResponse } from 'next/server';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { dbCreateTask } from '@/lib/ai-psd/storage';
import type { AiPsdTask, GenerationMode, SceneType, StyleTag, ColorTone, LayerComplexity, OutputQuality, TextRenderMode } from '@/lib/ai-psd/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ─── 参数校验 ────────────────────────────────────────
    const {
      generationMode = 'text_to_psd',
      prompt,
      title,
      subtitle,
      bodyText,
      ratio = '16:9',
      customWidth,
      customHeight,
      sceneType = 'poster',
      style = [],
      colorTone = 'auto',
      primaryColor,
      secondaryColor,
      accentColor,
      layerComplexity = 'standard',
      outputQuality = 'standard',
      textRenderMode = 'editable_text',
      imageModel,
      llmModel,
      referenceImageUrls = [],
      productImageUrls = [],
      logoImageUrls = [],
      brandName,
      brandSlogan,
      brandColors,
      materialType,
    } = body;

    if (!prompt && generationMode === 'text_to_psd') {
      return NextResponse.json({ error: '文本生成模式需要提供创意描述' }, { status: 400 });
    }

    // ─── 构建任务 ────────────────────────────────────────
    const taskId = `ai-psd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const task: AiPsdTask = {
      id: taskId,
      generationMode: generationMode as GenerationMode,
      prompt: prompt || '',
      title: title || undefined,
      subtitle: subtitle || undefined,
      bodyText: bodyText || undefined,
      ratio,
      customWidth: customWidth || undefined,
      customHeight: customHeight || undefined,
      sceneType: sceneType as SceneType,
      style: style as StyleTag[],
      colorTone: (colorTone || 'auto') as ColorTone,
      primaryColor: primaryColor || undefined,
      secondaryColor: secondaryColor || undefined,
      accentColor: accentColor || undefined,
      layerComplexity: (layerComplexity || 'standard') as LayerComplexity,
      outputQuality: (outputQuality || 'standard') as OutputQuality,
      textRenderMode: (textRenderMode || 'editable_text') as TextRenderMode,
      status: 'queued',
      progress: 0,
      referenceImageUrls,
      productImageUrls,
      logoImageUrls,
      imageModel: imageModel || undefined,
      llmModel: llmModel || undefined,
      brandName: brandName || undefined,
      brandSlogan: brandSlogan || undefined,
      brandColors: brandColors || undefined,
      materialType: materialType || undefined,
      createdAt: now,
      updatedAt: now,
    };

    // ─── 持久化 + 注册 ──────────────────────────────────
    await dbCreateTask(task);
    registerTask(taskId, 'ai-psd', 'AI PSD生成');

    // ─── 异步启动任务Worker（不await，让API立即返回）──────
    import('@/lib/ai-psd/task-worker').then(({ runAiPsdTask }) => {
      runAiPsdTask(taskId).catch((err: Error) => {
        console.error(`[ai-psd] Task ${taskId} failed:`, err);
        updateTaskProgress(taskId, {
          status: 'failed',
          progress: 0,
          label: `任务失败: ${err.message}`,
          error: err.message,
        });
      });
    }).catch(() => {
      // task-worker 模块加载失败时静默处理（模块尚未完成开发时）
      console.warn(`[ai-psd] Task worker module not available for task ${taskId}`);
    });

    return NextResponse.json({
      success: true,
      taskId,
      message: '任务已创建',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-psd/create] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
