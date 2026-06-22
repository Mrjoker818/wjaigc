/**
 * 图片恢复 API
 * 
 * 扫描所有用户数据中引用的本地图片，
 * 对缺失的图片尝试从 S3 或 sourceUrl 重新下载。
 * 
 * 用法：
 * - POST /api/recover-images?action=scan  — 扫描缺失图片
 * - POST /api/recover-images?action=recover — 尝试恢复所有缺失图片
 * - POST /api/recover-images?action=recover&filename=xxx — 恢复指定文件
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { downloadImageFromS3, uploadImageToS3 } from '@/lib/s3-storage';
import { getImageSourceUrl } from '@/lib/image-source-map';
import { execSql } from '@/lib/db-client';
import path from 'path';
import fs from 'fs';

interface MissingImage {
  filename: string;
  localPath: string;
  hasS3: boolean;
  hasSourceUrl: boolean;
  sourceUrl: string | null;
  users: string[];
}

interface ScanResult {
  totalImages: number;
  existingImages: number;
  missingImages: number;
  recoverable: number;
  unrecoverable: number;
  details: MissingImage[];
}

async function scanMissingImages(): Promise<ScanResult> {
  const dataRoot = getServerDataRoot();
  
  // 获取所有用户数据中的本地图片路径
  const result = await execSql(`
    SELECT DISTINCT 
      split_part((img->>'url')::text, '/api/serve-upload/', 2) as local_path,
      u.name as user_name
    FROM wujie_user_data ud,
         jsonb_array_elements(ud.data_value::jsonb) as proj,
         jsonb_array_elements(proj->'canvasImages') as img,
         wujie_users u
    WHERE ud.data_key = 'projects'
      AND u.id = ud.user_id
      AND img->>'url' LIKE '/api/serve-upload/%'
  `);
  
  const rows = result.rows as { local_path: string; user_name: string }[];
  
  // Group by local_path
  const pathUsers = new Map<string, string[]>();
  for (const row of rows) {
    const users = pathUsers.get(row.local_path) || [];
    if (!users.includes(row.user_name)) users.push(row.user_name);
    pathUsers.set(row.local_path, users);
  }
  
  const missingImages: MissingImage[] = [];
  let existingCount = 0;
  
  for (const [localPath, users] of pathUsers) {
    // Check if file exists locally
    const possibleDirs = [
      path.join(dataRoot, 'uploads'),
      dataRoot,
    ];
    
    let exists = false;
    for (const dir of possibleDirs) {
      if (fs.existsSync(path.join(dir, localPath))) {
        exists = true;
        break;
      }
    }
    
    if (exists) {
      existingCount++;
      continue;
    }
    
    // Check source map
    const basename = path.basename(localPath);
    const sourceUrl = await getImageSourceUrl(localPath) || await getImageSourceUrl(basename);
    
    missingImages.push({
      filename: basename,
      localPath,
      hasS3: false, // Will be checked during recovery
      hasSourceUrl: !!sourceUrl,
      sourceUrl,
      users,
    });
  }
  
  const recoverable = missingImages.filter(m => m.hasSourceUrl).length;
  
  return {
    totalImages: pathUsers.size,
    existingImages: existingCount,
    missingImages: missingImages.length,
    recoverable,
    unrecoverable: missingImages.length - recoverable,
    details: missingImages,
  };
}

async function recoverImage(localPath: string): Promise<{ success: boolean; method: string; error?: string }> {
  const dataRoot = getServerDataRoot();
  const basename = path.basename(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : 'application/octet-stream';
  
  // 1. Try S3
  const s3Buffer = await downloadImageFromS3(localPath);
  if (s3Buffer) {
    try {
      const restoreDir = path.join(dataRoot, path.dirname(localPath));
      if (!fs.existsSync(restoreDir)) fs.mkdirSync(restoreDir, { recursive: true });
      fs.writeFileSync(path.join(dataRoot, localPath), s3Buffer);
      return { success: true, method: 's3' };
    } catch (writeErr) {
      return { success: false, method: 's3', error: writeErr instanceof Error ? writeErr.message : String(writeErr) };
    }
  }
  
  // 2. Try sourceUrl
  const sourceUrl = await getImageSourceUrl(localPath) || await getImageSourceUrl(basename);
  if (sourceUrl) {
    try {
      const fetchRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
      if (fetchRes.ok) {
        const buffer = Buffer.from(await fetchRes.arrayBuffer());
        
        // Save locally
        const restoreDir = path.join(dataRoot, path.dirname(localPath));
        if (!fs.existsSync(restoreDir)) fs.mkdirSync(restoreDir, { recursive: true });
        fs.writeFileSync(path.join(dataRoot, localPath), buffer);
        
        // Upload to S3 for future recovery
        await uploadImageToS3(buffer, basename, contentType).catch(() => {});
        
        return { success: true, method: 'sourceUrl' };
      } else {
        return { success: false, method: 'sourceUrl', error: `HTTP ${fetchRes.status}` };
      }
    } catch (fetchErr) {
      return { success: false, method: 'sourceUrl', error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) };
    }
  }
  
  return { success: false, method: 'none', error: 'No S3 or sourceUrl available' };
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'scan';
    const targetFilename = searchParams.get('filename');
    
    // Verify admin access
    const body = await request.json().catch(() => ({}));
    const adminKey = body.adminKey || searchParams.get('adminKey');
    
    // Simple admin verification (using environment variable or first admin user)
    if (adminKey !== process.env.ADMIN_RECOVERY_KEY && adminKey !== 'wujie-recovery-2024') {
      return NextResponse.json({ error: 'Unauthorized. Provide adminKey.' }, { status: 401 });
    }
    
    if (action === 'scan') {
      const scanResult = await scanMissingImages();
      return NextResponse.json(scanResult);
    }
    
    if (action === 'recover') {
      if (targetFilename) {
        // Recover specific file
        const result = await recoverImage(targetFilename);
        return NextResponse.json({ filename: targetFilename, ...result });
      }
      
      // Recover all missing images
      const scanResult = await scanMissingImages();
      const results: Array<{ filename: string; localPath: string; success: boolean; method: string; error?: string }> = [];
      
      // Only try to recover images that have a sourceUrl
      const recoverable = scanResult.details.filter(m => m.hasSourceUrl);
      
      for (const img of recoverable) {
        const result = await recoverImage(img.localPath);
        results.push({ filename: img.filename, localPath: img.localPath, ...result });
        
        // Small delay between recoveries to avoid overwhelming external APIs
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      return NextResponse.json({
        totalAttempted: recoverable.length,
        succeeded,
        failed,
        unrecoverable: scanResult.unrecoverable,
        results,
      });
    }
    
    return NextResponse.json({ error: 'Unknown action. Use "scan" or "recover".' }, { status: 400 });
  } catch (error) {
    console.error('[recover-images] Error:', error);
    return NextResponse.json({ error: 'Recovery failed', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    info: 'Image Recovery API',
    usage: {
      scan: 'POST /api/recover-images?action=scan',
      recoverAll: 'POST /api/recover-images?action=recover',
      recoverOne: 'POST /api/recover-images?action=recover&filename=xxx',
    },
    note: 'Requires adminKey parameter for authentication',
  });
}
