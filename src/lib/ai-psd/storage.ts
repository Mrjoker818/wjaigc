/**
 * AI PSD 生成器 — 数据库存储
 *
 * 表：ai_psd_tasks（任务主表）
 * 表：ai_psd_files（生成文件记录）
 *
 * 读取策略：先DB，DB不可用时返回null
 * 写入策略：直接写DB
 */

import { execSql } from '../db-client';
import type { AiPsdTask, AiPsdTaskStatus, StyleTag } from './types';

// ─── 建表 ────────────────────────────────────────────────────────────

let tableEnsured = false;

export async function ensureAiPsdTables(): Promise<void> {
  if (tableEnsured) return;
  try {
    await execSql(`
      CREATE TABLE IF NOT EXISTS ai_psd_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        generation_mode TEXT NOT NULL DEFAULT 'text_to_psd',
        prompt TEXT NOT NULL DEFAULT '',
        title TEXT DEFAULT '',
        subtitle TEXT DEFAULT '',
        body_text TEXT DEFAULT '',
        ratio TEXT NOT NULL DEFAULT '16:9',
        custom_width INTEGER DEFAULT 0,
        custom_height INTEGER DEFAULT 0,
        scene_type TEXT NOT NULL DEFAULT 'poster',
        style TEXT[] DEFAULT '{}',
        color_tone TEXT DEFAULT 'auto',
        primary_color TEXT DEFAULT '',
        secondary_color TEXT DEFAULT '',
        accent_color TEXT DEFAULT '',
        layer_complexity TEXT NOT NULL DEFAULT 'standard',
        output_quality TEXT NOT NULL DEFAULT 'standard',
        text_render_mode TEXT NOT NULL DEFAULT 'editable_text',
        status TEXT NOT NULL DEFAULT 'idle',
        progress INTEGER NOT NULL DEFAULT 0,
        current_step TEXT DEFAULT '',
        current_layer_name TEXT DEFAULT '',
        preview_url TEXT DEFAULT '',
        psd_url TEXT DEFAULT '',
        zip_url TEXT DEFAULT '',
        json_url TEXT DEFAULT '',
        report_url TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        layer_plan JSONB DEFAULT NULL,
        reference_image_urls TEXT[] DEFAULT '{}',
        product_image_urls TEXT[] DEFAULT '{}',
        logo_image_urls TEXT[] DEFAULT '{}',
        brand_name TEXT DEFAULT '',
        brand_slogan TEXT DEFAULT '',
        brand_colors TEXT DEFAULT '',
        material_type TEXT DEFAULT '',
        image_model TEXT DEFAULT '',
        llm_model TEXT DEFAULT '',
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0
      )
    `);

    await execSql(`
      CREATE TABLE IF NOT EXISTS ai_psd_files (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES ai_psd_tasks(id) ON DELETE CASCADE,
        layer_id TEXT DEFAULT '',
        file_type TEXT NOT NULL DEFAULT 'layer_png',
        file_name TEXT NOT NULL DEFAULT '',
        file_url TEXT NOT NULL DEFAULT '',
        file_size INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at BIGINT NOT NULL DEFAULT 0
      )
    `);

    await execSql(`
      CREATE INDEX IF NOT EXISTS idx_ai_psd_files_task ON ai_psd_files(task_id)
    `);

    await execSql(`
      CREATE INDEX IF NOT EXISTS idx_ai_psd_tasks_user ON ai_psd_tasks(user_id)
    `);

    // 迁移：添加新列（brand_psd 模式所需）
    const newCols = [
      ['brand_name', 'TEXT DEFAULT \'\''],
      ['brand_slogan', 'TEXT DEFAULT \'\''],
      ['brand_colors', 'TEXT DEFAULT \'\''],
      ['material_type', 'TEXT DEFAULT \'\''],
    ] as const;
    for (const [col, type] of newCols) {
      try {
        await execSql(`ALTER TABLE ai_psd_tasks ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      } catch { /* column already exists, ignore */ }
    }

    tableEnsured = true;
    console.log('[ai-psd-storage] Tables ensured');
  } catch (e) {
    console.error('[ai-psd-storage] ensureAiPsdTables error:', e);
  }
}

// ─── 任务 CRUD ───────────────────────────────────────────────────────

export async function dbCreateTask(task: AiPsdTask): Promise<boolean> {
  await ensureAiPsdTables();
  try {
    await execSql(`
      INSERT INTO ai_psd_tasks (
        id, user_id, generation_mode, prompt, title, subtitle, body_text,
        ratio, custom_width, custom_height, scene_type, style, color_tone,
        primary_color, secondary_color, accent_color, layer_complexity,
        output_quality, text_render_mode, status, progress, current_step,
        current_layer_name, preview_url, psd_url, zip_url, json_url,
        report_url, error_message, layer_plan, reference_image_urls,
        product_image_urls, logo_image_urls, brand_name, brand_slogan,
        brand_colors, material_type, image_model, llm_model,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
        $33,$34,$35,$36,$37,$38,$39,$40,$41
      )
    `, [
      task.id, task.userId || null, task.generationMode, task.prompt,
      task.title || '', task.subtitle || '', task.bodyText || '',
      task.ratio, task.customWidth || 0, task.customHeight || 0,
      task.sceneType, task.style || [], task.colorTone,
      task.primaryColor || '', task.secondaryColor || '', task.accentColor || '',
      task.layerComplexity, task.outputQuality, task.textRenderMode,
      task.status, task.progress, task.currentStep || '',
      task.currentLayerName || '', task.previewUrl || '',
      task.psdUrl || '', task.zipUrl || '', task.jsonUrl || '',
      task.reportUrl || '', task.errorMessage || '',
      task.layerPlan ? JSON.stringify(task.layerPlan) : null,
      task.referenceImageUrls || [], task.productImageUrls || [],
      task.logoImageUrls || [], task.brandName || '', task.brandSlogan || '',
      Array.isArray(task.brandColors) ? JSON.stringify(task.brandColors) : (task.brandColors || ''),
      task.materialType || '',
      task.imageModel || '', task.llmModel || '',
      task.createdAt, task.updatedAt,
    ]);
    return true;
  } catch (e) {
    console.error('[ai-psd-storage] dbCreateTask error:', e);
    return false;
  }
}

export async function dbGetTask(taskId: string): Promise<AiPsdTask | null> {
  await ensureAiPsdTables();
  try {
    const result = await execSql('SELECT * FROM ai_psd_tasks WHERE id = $1', [taskId]);
    if (result.rows.length === 0) return null;
    return rowToTask(result.rows[0]);
  } catch (e) {
    console.error('[ai-psd-storage] dbGetTask error:', e);
    return null;
  }
}

export async function dbUpdateTaskStatus(
  taskId: string,
  status: AiPsdTaskStatus,
  progress: number,
  extra?: Partial<Pick<AiPsdTask, 'currentStep' | 'currentLayerName' | 'previewUrl' | 'psdUrl' | 'zipUrl' | 'jsonUrl' | 'reportUrl' | 'errorMessage' | 'layerPlan'>>
): Promise<boolean> {
  try {
    const sets: string[] = ['status = $2', 'progress = $3', 'updated_at = $4'];
    const params: unknown[] = [taskId, status, progress, Date.now()];
    let idx = 5;

    if (extra?.currentStep !== undefined) { sets.push(`current_step = $${idx}`); params.push(extra.currentStep); idx++; }
    if (extra?.currentLayerName !== undefined) { sets.push(`current_layer_name = $${idx}`); params.push(extra.currentLayerName); idx++; }
    if (extra?.previewUrl !== undefined) { sets.push(`preview_url = $${idx}`); params.push(extra.previewUrl); idx++; }
    if (extra?.psdUrl !== undefined) { sets.push(`psd_url = $${idx}`); params.push(extra.psdUrl); idx++; }
    if (extra?.zipUrl !== undefined) { sets.push(`zip_url = $${idx}`); params.push(extra.zipUrl); idx++; }
    if (extra?.jsonUrl !== undefined) { sets.push(`json_url = $${idx}`); params.push(extra.jsonUrl); idx++; }
    if (extra?.reportUrl !== undefined) { sets.push(`report_url = $${idx}`); params.push(extra.reportUrl); idx++; }
    if (extra?.errorMessage !== undefined) { sets.push(`error_message = $${idx}`); params.push(extra.errorMessage); idx++; }
    if (extra?.layerPlan !== undefined) { sets.push(`layer_plan = $${idx}`); params.push(JSON.stringify(extra.layerPlan)); idx++; }

    await execSql(`UPDATE ai_psd_tasks SET ${sets.join(', ')} WHERE id = $1`, params);
    return true;
  } catch (e) {
    console.error('[ai-psd-storage] dbUpdateTaskStatus error:', e);
    return false;
  }
}

export async function dbDeleteTask(taskId: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM ai_psd_tasks WHERE id = $1', [taskId]);
    return true;
  } catch (e) {
    console.error('[ai-psd-storage] dbDeleteTask error:', e);
    return false;
  }
}

export async function dbListTasksByUser(userId: string, limit: number = 20): Promise<AiPsdTask[]> {
  await ensureAiPsdTables();
  try {
    const result = await execSql(
      'SELECT * FROM ai_psd_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows.map(rowToTask);
  } catch (e) {
    console.error('[ai-psd-storage] dbListTasksByUser error:', e);
    return [];
  }
}

// ─── 文件记录 CRUD ───────────────────────────────────────────────────

export async function dbAddFile(
  id: string, taskId: string, layerId: string,
  fileType: string, fileName: string, fileUrl: string,
  fileSize: number, metadata?: Record<string, unknown>
): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO ai_psd_files (id, task_id, layer_id, file_type, file_name, file_url, file_size, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, taskId, layerId, fileType, fileName, fileUrl, fileSize, JSON.stringify(metadata || {}), Date.now()]);
    return true;
  } catch (e) {
    console.error('[ai-psd-storage] dbAddFile error:', e);
    return false;
  }
}

export async function dbGetFilesByTask(taskId: string): Promise<Array<{ id: string; layerId: string; fileType: string; fileName: string; fileUrl: string; fileSize: number; metadata: Record<string, unknown> }>> {
  try {
    const result = await execSql('SELECT * FROM ai_psd_files WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
    return result.rows.map(r => ({
      id: r.id as string,
      layerId: (r.layer_id as string) || '',
      fileType: r.file_type as string,
      fileName: r.file_name as string,
      fileUrl: r.file_url as string,
      fileSize: (r.file_size as number) || 0,
      metadata: (r.metadata as Record<string, unknown>) || {},
    }));
  } catch (e) {
    console.error('[ai-psd-storage] dbGetFilesByTask error:', e);
    return [];
  }
}

// ─── 行→对象映射 ────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): AiPsdTask {
  return {
    id: row.id as string,
    userId: (row.user_id as string) || undefined,
    generationMode: (row.generation_mode as AiPsdTask['generationMode']) || 'text_to_psd',
    prompt: (row.prompt as string) || '',
    title: (row.title as string) || undefined,
    subtitle: (row.subtitle as string) || undefined,
    bodyText: (row.body_text as string) || undefined,
    ratio: (row.ratio as string) || '16:9',
    customWidth: (row.custom_width as number) || undefined,
    customHeight: (row.custom_height as number) || undefined,
    sceneType: (row.scene_type as AiPsdTask['sceneType']) || 'poster',
    colorTone: (row.color_tone as AiPsdTask['colorTone']) || 'auto',
    primaryColor: (row.primary_color as string) || undefined,
    secondaryColor: (row.secondary_color as string) || undefined,
    accentColor: (row.accent_color as string) || undefined,
    layerComplexity: (row.layer_complexity as AiPsdTask['layerComplexity']) || 'standard',
    outputQuality: (row.output_quality as AiPsdTask['outputQuality']) || 'standard',
    textRenderMode: (row.text_render_mode as AiPsdTask['textRenderMode']) || 'editable_text',
    status: (row.status as AiPsdTaskStatus) || 'idle',
    progress: (row.progress as number) || 0,
    currentStep: (row.current_step as string) || undefined,
    currentLayerName: (row.current_layer_name as string) || undefined,
    previewUrl: (row.preview_url as string) || undefined,
    psdUrl: (row.psd_url as string) || undefined,
    zipUrl: (row.zip_url as string) || undefined,
    jsonUrl: (row.json_url as string) || undefined,
    reportUrl: (row.report_url as string) || undefined,
    errorMessage: (row.error_message as string) || undefined,
    layerPlan: row.layer_plan
      ? (typeof row.layer_plan === 'string'
          ? JSON.parse(row.layer_plan)
          : row.layer_plan) as AiPsdTask['layerPlan']
      : undefined,
    style: Array.isArray(row.style) ? row.style as StyleTag[]
      : typeof row.style === 'string' ? JSON.parse(row.style as string) as StyleTag[]
      : [],
    referenceImageUrls: Array.isArray(row.reference_image_urls) ? row.reference_image_urls as string[]
      : typeof row.reference_image_urls === 'string' ? JSON.parse(row.reference_image_urls as string) as string[]
      : undefined,
    productImageUrls: Array.isArray(row.product_image_urls) ? row.product_image_urls as string[]
      : typeof row.product_image_urls === 'string' ? JSON.parse(row.product_image_urls as string) as string[]
      : undefined,
    logoImageUrls: Array.isArray(row.logo_image_urls) ? row.logo_image_urls as string[]
      : typeof row.logo_image_urls === 'string' ? JSON.parse(row.logo_image_urls as string) as string[]
      : undefined,
    imageModel: (row.image_model as string) || undefined,
    llmModel: (row.llm_model as string) || undefined,
    brandName: (row.brand_name as string) || undefined,
    brandSlogan: (row.brand_slogan as string) || undefined,
    brandColors: Array.isArray(row.brand_colors) ? row.brand_colors as string[]
      : typeof row.brand_colors === 'string' && row.brand_colors ? JSON.parse(row.brand_colors as string) as string[]
      : undefined,
    materialType: (row.material_type as string) || undefined,
    createdAt: (row.created_at as number) || 0,
    updatedAt: (row.updated_at as number) || 0,
  };
}

/**
 * P0-3: 清理过期的 AI PSD 任务数据
 * 删除超过 maxAgeMs 的已完成/失败任务，释放数据库和磁盘空间
 * @param maxAgeMs 最大保留时间，默认 7 天
 * @returns 删除的任务数量
 */
export async function cleanupExpiredTasks(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const cutoffTime = Date.now() - maxAgeMs;

  try {
    // 先查询将要删除的任务的文件路径（用于清理文件）
    const { rows } = await execSql(
      `SELECT id, preview_url, psd_url, zip_url, json_url, report_url
       FROM ai_psd_tasks
       WHERE status IN ('completed', 'failed', 'cancelled')
         AND created_at < $1`,
      [cutoffTime]
    );

    if (rows.length === 0) return 0;

    // 删除数据库记录
    const result = await execSql(
      `DELETE FROM ai_psd_tasks
       WHERE status IN ('completed', 'failed', 'cancelled')
         AND created_at < $1`,
      [cutoffTime]
    );

    // 清理磁盘文件（异步，不阻塞）
    const fs = await import('fs/promises');
    const path = await import('path');
    const projectRoot = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

    for (const row of rows) {
      const taskDir = path.join(projectRoot, 'public', 'ai-psd', row.id as string);
      try {
        await fs.rm(taskDir, { recursive: true, force: true });
      } catch {
        // 目录可能已不存在，忽略
      }
    }

    console.log(`[ai-psd-storage] Cleaned up ${result.rowCount} expired tasks (older than ${Math.round(maxAgeMs / 86400000)} days)`);
    return result.rowCount;
  } catch (error) {
    console.error('[ai-psd-storage] Cleanup failed:', error);
    return 0;
  }
}
