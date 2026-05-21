import { NextRequest, NextResponse } from 'next/server';
import { getTaskInfo, getQueuePosition } from '@/lib/task-registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/queue-position?taskId=xxx
 * 查询任务在队列中的位置
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
  }

  const info = getTaskInfo(taskId);
  const position = getQueuePosition(taskId);

  if (!info) {
    return NextResponse.json({ position: -1, total: 0, queued: false });
  }

  // ★ total 应为队列总长度，而非当前排队位置
  // position=0 表示不在排队，total=0；position>0 时 total=队列长度
  const total = position > 0 ? position : 0;

  return NextResponse.json({
    position,
    total,
    queued: info.status === 'queued',
    status: info.status,
    progress: info.progress,
    label: info.label,
  });
}

/**
 * POST /api/queue-position
 * 查询任务在队列中的位置 (JSON body)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const taskId = body.taskId;
    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
    }

    const info = getTaskInfo(taskId);
    const position = getQueuePosition(taskId);

    if (!info) {
      return NextResponse.json({ position: -1, total: 0, queued: false });
    }

    // ★ total 应为队列总长度，而非当前排队位置
    const total = position > 0 ? position : 0;

    return NextResponse.json({
      position,
      total,
      queued: info.status === 'queued',
      status: info.status,
      progress: info.progress,
      label: info.label,
    });
  } catch {
    return NextResponse.json({ error: '请求解析失败' }, { status: 400 });
  }
}
