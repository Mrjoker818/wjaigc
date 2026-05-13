import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { downloadImageFromS3, isS3Available } from '@/lib/s3-storage';

/**
 * 提供上传文件的静态服务（生产环境使用）
 * 开发环境直接通过 /uploads/ 由 Next.js 静态服务
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // 防止路径遍历攻击
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    // 查找文件：先查持久卷，再查 public/uploads
    const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
    const searchDirs = isProd
      ? [path.join(getServerDataRoot(), 'uploads'), path.join(process.cwd(), 'public', 'uploads')]
      : [path.join(process.cwd(), 'public', 'uploads')];

    for (const dir of searchDirs) {
      const filePath = path.join(dir, filename);
      if (existsSync(filePath)) {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;

        const buffer = await readFile(filePath);

        // 根据 extension 确定内容类型
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.bmp': 'image/bmp',
          '.ico': 'image/x-icon',
        };

        const contentType = contentTypes[ext] || 'application/octet-stream';

        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': buffer.length.toString(),
          },
        });
      }
    }

    // 3. S3 对象存储回退（文件系统找不到时，从 S3 下载）
    if (isS3Available()) {
      const s3Key = `uploads/${filename}`;
      const s3Buffer = await downloadImageFromS3(s3Key);
      if (s3Buffer) {
        console.log(`[serve-upload] S3 fallback: ${s3Key} (${(s3Buffer.length / 1024).toFixed(0)}KB)`);

        // 回写本地缓存（异步，不阻塞响应）
        const localDir = process.env.COZE_PROJECT_ENV === 'PROD'
          ? path.join(getServerDataRoot(), 'uploads')
          : path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'uploads');
        const localPath = path.join(localDir, filename);
        readFile(localPath).catch(() => {}).then(async (existing) => {
          if (!existing) {
            try { await import('fs/promises').then(f => f.writeFile(localPath, s3Buffer)); } catch { /* ignore */ }
          }
        });

        const contentType = filename.endsWith('.png') ? 'image/png'
          : filename.endsWith('.webp') ? 'image/webp'
          : filename.endsWith('.gif') ? 'image/gif'
          : 'image/jpeg';

        return new NextResponse(new Uint8Array(s3Buffer), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': s3Buffer.length.toString(),
          },
        });
      }
    }

    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Serve file failed';
    console.error('Serve upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
