/**
 * AI PSD 生成器 — 获取任务结果 API
 * GET /api/ai-psd/result?taskId=xxx
 *
 * 对应文档：第4节 API接口 — GET /api/skills/ai-psd/result/:taskId
 */

import { NextRequest, NextResponse } from 'next/server';
import { dbGetTask, dbGetFilesByTask } from '@/lib/ai-psd/storage';

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

    if (task.status !== 'success') {
      return NextResponse.json({
        error: '任务尚未完成',
        status: task.status,
        progress: task.progress,
      }, { status: 400 });
    }

    // 获取所有文件记录
    const files = await dbGetFilesByTask(taskId);

    return NextResponse.json({
      success: true,
      result: {
        taskId: task.id,
        status: task.status,
        layerPlan: task.layerPlan,
        previewUrl: task.previewUrl,
        psdUrl: task.psdUrl,
        zipUrl: task.zipUrl,
        jsonUrl: task.jsonUrl,
        reportUrl: task.reportUrl,
        files,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-psd/result] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
