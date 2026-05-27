/**
 * AI PSD 生成器 — 任务状态查询 API
 * GET /api/ai-psd/status?taskId=xxx
 *
 * 对应文档：第4节 API接口 — GET /api/skills/ai-psd/status/:taskId
 */

import { NextRequest, NextResponse } from 'next/server';
import { dbGetTask } from '@/lib/ai-psd/storage';

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId 参数' }, { status: 400 });
    }

    const task = await dbGetTask(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      task: {
        taskId: task.id,
        status: task.status,
        progress: task.progress,
        currentStep: task.currentStep,
        currentLayerName: task.currentLayerName,
        layerPlan: task.layerPlan,
        previewUrl: task.previewUrl,
        psdUrl: task.psdUrl,
        zipUrl: task.zipUrl,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-psd/status] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
