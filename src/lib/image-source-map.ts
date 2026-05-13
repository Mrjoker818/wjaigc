/**
 * 图片 sourceUrl 映射
 * 
 * 当 save-image 将外部图片下载保存到本地时，
 * 记录 filename → sourceUrl 的映射到数据库。
 * 
 * 当本地文件和 S3 都找不到图片时，
 * 可以从 sourceUrl 重新下载。
 */

import { execSql } from './db-client';

/**
 * 保存 filename → sourceUrl 映射
 */
export async function saveImageDataMapping(filename: string, sourceUrl: string): Promise<void> {
  try {
    if (!sourceUrl.startsWith('http')) return; // 只记录外部 URL
    await execSql(
      `INSERT INTO wujie_image_source_map (filename, source_url, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (filename) DO UPDATE SET source_url = $2`,
      [filename, sourceUrl]
    );
  } catch (error) {
    // 映射记录失败不影响主流程
    console.warn(`[image-source-map] Failed to save mapping for ${filename}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * 根据 filename 查找 sourceUrl
 */
export async function getImageSourceUrl(filename: string): Promise<string | null> {
  try {
    const result = await execSql(
      `SELECT source_url FROM wujie_image_source_map WHERE filename = $1`,
      [filename]
    );
    if (result.rows.length > 0) {
      return result.rows[0].source_url as string;
    }
  } catch (error) {
    console.warn(`[image-source-map] Failed to lookup mapping for ${filename}:`, error instanceof Error ? error.message : error);
  }
  return null;
}

/**
 * 确保映射表存在
 */
export async function ensureImageSourceMapTable(): Promise<void> {
  try {
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_image_source_map (
        filename VARCHAR(255) PRIMARY KEY,
        source_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (error) {
    console.warn('[image-source-map] Failed to create table:', error instanceof Error ? error.message : error);
  }
}
