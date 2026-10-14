import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';
import { getServerDataRoot } from '@/lib/server-data-root';
import { logOperation, OP_ACTIONS } from '@/lib/op-log';
import path from 'path';
import fs from 'fs';

/**
 * POST /api/admin/restore-user-data
 *
 * 管理员专用：将指定用户在时间窗内已完成生成任务（cloud_tasks）中
 * 不在任何现存画布上的图片，追加恢复为一个新项目。
 *
 * 安全设计：
 * 1. 仅追加新项目（名称默认带"数据恢复"前缀），绝不修改/删除任何现有项目；
 * 2. 幂等：已存在同名恢复项目时跳过，防止重复写入；
 * 3. 图片 id 使用 project_restore_/restore- 前缀 + 当前时间戳，不会命中历史删除墓碑；
 * 4. 全程审计日志。
 *
 * Body:
 * {
 *   userId: string        // 目标用户 ID
 *   startTime: number     // 时间窗起点（ms 时间戳）
 *   endTime: number       // 时间窗终点（ms 时间戳），最大窗口 7 天
 *   projectName?: string  // 恢复项目名（默认 "数据恢复-YYYY-MM-DD"）
 *   dryRun?: boolean      // true = 仅预览恢复清单，不写库
 * }
 */

const MAX_WINDOW_MS = 7 * 24 * 3600 * 1000;
const COLS = 6;
const CELL_W = 400;
const GAP = 40;

interface TaskRow {
  id: string;
  created_at: number | string;
  result: unknown;
}

interface CandidateImage {
  filename: string;
  url: string;
  createdAt: number;
  taskId: string;
  prompt: string;
  model: string;
  quality: string;
  aspectRatio: string;
  size: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  x: number;
  y: number;
  zIndex: number;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function extractCdnUrls(result: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const imageUrls = result.imageUrls;
  if (Array.isArray(imageUrls)) {
    for (const u of imageUrls) {
      if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
    }
  } else if (typeof result.imageUrl === 'string' && result.imageUrl.startsWith('http')) {
    urls.push(result.imageUrl);
  }
  return urls;
}

function parseSizeToWH(size: string): { w: number; h: number } | null {
  const m = size?.match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/** 优先读取服务器本地文件真实尺寸，失败时用任务记录的 size 字段兜底 */
async function probeDimensions(filename: string, fallbackSize: string): Promise<{ w: number; h: number }> {
  try {
    const filePath = path.join(getServerDataRoot(), 'uploads', filename);
    if (fs.existsSync(filePath)) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(filePath).metadata();
      if (meta.width && meta.height) return { w: meta.width, h: meta.height };
    }
  } catch {
    // fallthrough to size-field fallback
  }
  return parseSizeToWH(fallbackSize) || { w: 1024, h: 1024 };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const startTime = toNumber(body.startTime);
    const endTime = toNumber(body.endTime);
    const dryRun = body.dryRun === true;
    const defaultName = `数据恢复-${new Date(Date.now()).toISOString().slice(0, 10)}`;
    const projectName = typeof body.projectName === 'string' && body.projectName.trim()
      ? body.projectName.trim()
      : defaultName;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!startTime || !endTime || endTime <= startTime) {
      return NextResponse.json({ error: 'startTime/endTime invalid' }, { status: 400 });
    }
    if (endTime - startTime > MAX_WINDOW_MS) {
      return NextResponse.json({ error: 'Time window too large (max 7 days)' }, { status: 400 });
    }

    // 0. 目标用户必须存在
    const userCheck = await execSql('SELECT id, name FROM wujie_users WHERE id = $1 LIMIT 1', [userId]);
    if (userCheck.rows.length === 0) {
      return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });
    }
    const targetUserName = (userCheck.rows[0] as { id: string; name?: string }).name || userId;

    // 1. 时间窗内已完成的生成任务（cloud_tasks 主键列为 id）
    const taskRes = await execSql(
      `SELECT id, created_at, result FROM cloud_tasks
       WHERE user_id = $1 AND status = 'completed' AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at ASC`,
      [userId, startTime, endTime],
    );
    const taskRows = taskRes.rows as unknown as TaskRow[];

    // 2. 展开 CDN URL → 保存任务元数据
    const cdnEntries: Array<{ cdnUrl: string; task: TaskRow }> = [];
    for (const row of taskRows) {
      const result = (row.result && typeof row.result === 'object' ? row.result : {}) as Record<string, unknown>;
      for (const cdnUrl of extractCdnUrls(result)) {
        cdnEntries.push({ cdnUrl, task: row });
      }
    }
    if (cdnEntries.length === 0) {
      return NextResponse.json({
        success: true, restored: 0, skippedExisting: 0, dryRun,
        message: '时间窗内没有已完成且带图片结果的生成任务',
        tasksScanned: taskRows.length,
      });
    }

    // 3. CDN URL → 持久化文件名（source_map 映射，gen- 优先）
    const uniqueUrls = Array.from(new Set(cdnEntries.map(e => e.cdnUrl)));
    const mapRes = await execSql(
      'SELECT source_url, filename FROM wujie_image_source_map WHERE source_url = ANY($1::text[])',
      [uniqueUrls],
    );
    const filesByCdn = new Map<string, string[]>();
    for (const row of mapRes.rows as unknown as Array<{ source_url: string; filename: string }>) {
      const list = filesByCdn.get(row.source_url) || [];
      list.push(row.filename);
      filesByCdn.set(row.source_url, list);
    }

    const pickBestFile = (filenames: string[]): string | null => {
      const gen = filenames.filter(f => f.startsWith('gen-')).sort();
      if (gen.length > 0) return gen[0];
      const others = filenames.filter(f => f.startsWith('img_') || f.startsWith('upload-')).sort();
      return others.length > 0 ? others[0] : null;
    };

    // 4. 现有画布已含图片（按文件名判断），避免重复恢复
    const existingProjectsRaw = await dbGetUserData(userId, 'projects');
    let existingProjects: Array<Record<string, unknown>> = [];
    if (typeof existingProjectsRaw === 'string') {
      try { existingProjects = JSON.parse(existingProjectsRaw); } catch { existingProjects = []; }
    } else if (Array.isArray(existingProjectsRaw)) {
      existingProjects = existingProjectsRaw as Array<Record<string, unknown>>;
    }
    const existingFilenames = new Set<string>();
    for (const project of existingProjects) {
      const canvasImages = project.canvasImages;
      if (!Array.isArray(canvasImages)) continue;
      for (const img of canvasImages) {
        const url = (img as Record<string, unknown>).url;
        if (typeof url === 'string') existingFilenames.add(url);
      }
    }

    // 5. 组装候选图（同 CDN 多记录/重复转存去重；已在画布的跳过）
    const seenCdn = new Set<string>();
    const candidates: CandidateImage[] = [];
    let skippedExisting = 0;
    for (const { cdnUrl, task } of cdnEntries) {
      if (seenCdn.has(cdnUrl)) continue;
      seenCdn.add(cdnUrl);
      const filenames = filesByCdn.get(cdnUrl);
      if (!filenames || filenames.length === 0) continue;
      const filename = pickBestFile(filenames);
      if (!filename) continue;
      const url = `/api/serve-upload/uploads/${filename}`;
      if (existingFilenames.has(url)) { skippedExisting++; continue; }
      const result = (task.result && typeof task.result === 'object' ? task.result : {}) as Record<string, unknown>;
      const dims = await probeDimensions(filename, typeof result.size === 'string' ? result.size : '');
      candidates.push({
        filename,
        url,
        createdAt: toNumber(task.created_at),
        taskId: task.id,
        prompt: typeof result.prompt === 'string' ? result.prompt : '',
        model: typeof result.model === 'string' ? result.model : '',
        quality: typeof result.quality === 'string' ? result.quality : '',
        aspectRatio: typeof result.aspectRatio === 'string' ? result.aspectRatio : '',
        size: typeof result.size === 'string' ? result.size : `${dims.w}x${dims.h}`,
        width: CELL_W,
        height: Math.max(1, Math.round((CELL_W * dims.h) / dims.w)),
        originalWidth: dims.w,
        originalHeight: dims.h,
        x: 0, y: 0, zIndex: 0,
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true, restored: 0, skippedExisting, dryRun,
        message: '所有生成图片都已存在于当前画布项目中，无需恢复',
        tasksScanned: taskRows.length,
      });
    }

    // 6. 网格排布（按生成时间升序）
    candidates.sort((a, b) => a.createdAt - b.createdAt);
    let col = 0;
    let x = 0;
    let y = 0;
    let rowMaxH = 0;
    candidates.forEach((img, index) => {
      if (col === COLS) { col = 0; x = 0; y += rowMaxH + GAP; rowMaxH = 0; }
      img.x = x;
      img.y = y;
      img.zIndex = index + 1;
      x += CELL_W + GAP;
      rowMaxH = Math.max(rowMaxH, img.height);
      col++;
    });

    const now = Date.now();
    const restoreProjectId = `project_restore_${now}`;
    const restoreProject = {
      id: restoreProjectId,
      name: projectName,
      description: `数据恢复项目：${candidates.length} 张图片（${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}）`,
      canvasImages: candidates.map(img => ({
        id: `restore-${img.createdAt}-${img.filename.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`,
        url: img.url,
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        originalWidth: img.originalWidth,
        originalHeight: img.originalHeight,
        zIndex: img.zIndex,
        createdAt: img.createdAt,
        mediaType: 'image',
        prompt: img.prompt || undefined,
        model: img.model || undefined,
        modelName: img.model || undefined,
        quality: img.quality || undefined,
        aspectRatio: img.aspectRatio || undefined,
        size: img.size,
        name: img.prompt ? img.prompt.slice(0, 30) : img.filename,
        visible: true,
        locked: false,
      })),
      createdAt: now,
      updatedAt: now,
    };

    // 7. 幂等保护：同名恢复项目已存在则跳过
    if (existingProjects.some(p => (p as { name?: unknown }).name === projectName)) {
      return NextResponse.json({
        success: true, skipped: true, restored: 0, skippedExisting, dryRun,
        message: `已存在同名恢复项目「${projectName}」，跳过（如需重新恢复请更换项目名）`,
        tasksScanned: taskRows.length,
      });
    }

    // 8. dryRun 预览
    if (dryRun) {
      return NextResponse.json({
        success: true, dryRun: true,
        restored: candidates.length, skippedExisting,
        projectName, tasksScanned: taskRows.length,
        preview: candidates.map(img => ({
          filename: img.filename, createdAt: img.createdAt, model: img.model,
          size: img.size, prompt: img.prompt.slice(0, 80),
        })),
      });
    }

    // 9. 只追加写回（绝不改动现有项目）
    const writeOk = await dbSetUserData(userId, 'projects', [...existingProjects, restoreProject]);
    if (!writeOk) {
      return NextResponse.json({ error: 'Failed to write restored project' }, { status: 500 });
    }

    logOperation({
      userId: admin.id,
      userName: admin.name,
      action: OP_ACTIONS.ADMIN_SETTINGS,
      targetType: 'user_data_restore',
      targetId: userId,
      detail: `恢复用户 ${targetUserName}(${userId}) ${candidates.length} 张生成图到新项目「${projectName}」（${restoreProjectId}），时间窗 ${startTime}~${endTime}，跳过已在画布 ${skippedExisting} 张`,
    });

    return NextResponse.json({
      success: true, dryRun: false,
      restored: candidates.length, skippedExisting,
      projectName, projectId: restoreProjectId,
      targetUser: { id: userId, name: targetUserName },
      tasksScanned: taskRows.length,
      durationMs: Date.now() - startedAt,
      images: candidates.map(img => ({ filename: img.filename, createdAt: img.createdAt, model: img.model, prompt: img.prompt.slice(0, 80) })),
    });
  } catch (error) {
    console.error('[admin/restore-user-data] Error:', error);
    return NextResponse.json(
      { error: 'Restore failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
