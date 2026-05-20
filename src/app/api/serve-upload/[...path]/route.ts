import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { downloadImageFromS3, getS3PresignedUrl, deriveS3Key, resolveS3Key } from '@/lib/s3-storage';
import { getImageSourceUrl } from '@/lib/image-source-map';
import path from 'path';
import fs from 'fs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const filePath = pathParts.join('/');
    
    const dataRoot = getServerDataRoot();
    const possibleDirs = [
      path.join(dataRoot, 'uploads'),
      dataRoot, // root level for subdirs like outpaint/, upscale/
    ];
    
    // 1. 尝试从本地文件系统读取
    for (const dir of possibleDirs) {
      const fullPath = path.join(dir, filePath);
      if (fs.existsSync(fullPath)) {
        const buffer = await fs.promises.readFile(fullPath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = getContentType(ext);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    }
    
    // 2. 本地文件不存在，尝试从 S3 下载
    const s3Buffer = await downloadImageFromS3(filePath);
    if (s3Buffer) {
      console.log(`[serve-upload] Recovered from S3: ${filePath}`);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getContentType(ext);
      
      // 同时恢复到本地文件系统，下次请求无需再从 S3 下载
      try {
        const restoreDir = path.join(dataRoot, 'uploads');
        if (!fs.existsSync(restoreDir)) fs.mkdirSync(restoreDir, { recursive: true });
        fs.writeFileSync(path.join(restoreDir, path.basename(filePath)), s3Buffer);
      } catch (writeErr) {
        console.warn(`[serve-upload] Failed to cache S3 file locally:`, writeErr instanceof Error ? writeErr.message : writeErr);
      }
      
      return new NextResponse(new Uint8Array(s3Buffer), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }
    
    // 3. S3 也没有，尝试从 sourceUrl（原始外部 URL）重新下载
    const sourceUrl = await getImageSourceUrl(path.basename(filePath));
    if (sourceUrl) {
      try {
        const fetchRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
        if (fetchRes.ok) {
          const buffer = Buffer.from(await fetchRes.arrayBuffer());
          const ext = path.extname(filePath).toLowerCase();
          const contentType = getContentType(ext);
          
          // 恢复到本地文件系统
          try {
            const restoreDir = path.join(dataRoot, 'uploads');
            if (!fs.existsSync(restoreDir)) fs.mkdirSync(restoreDir, { recursive: true });
            fs.writeFileSync(path.join(restoreDir, path.basename(filePath)), buffer);
          } catch (writeErr) {
            // 忽略
          }
          
          // 同时上传到 S3 备份
          try {
            const { uploadImageToS3 } = await import('@/lib/s3-storage');
            await uploadImageToS3(buffer, path.basename(filePath), contentType);
          } catch (s3Err) {
            // 忽略
          }
          
          console.log(`[serve-upload] Recovered from sourceUrl: ${filePath} → ${sourceUrl}`);
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400',
            },
          });
        }
      } catch (fetchErr) {
        console.warn(`[serve-upload] Failed to download from sourceUrl: ${sourceUrl}`, fetchErr instanceof Error ? fetchErr.message : fetchErr);
      }
    }
    
    // 4. 最后尝试生成 S3 presigned URL 重定向
    const s3Key = deriveS3Key(filePath);
    const resolvedKey = await resolveS3Key(s3Key);
    if (resolvedKey) {
      const presignedUrl = await getS3PresignedUrl(resolvedKey);
      if (presignedUrl) {
        return NextResponse.redirect(presignedUrl);
      }
    }
    
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  } catch (error) {
    console.error('serve-upload error:', error);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}

function getContentType(ext: string): string {
  return ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.svg' ? 'image/svg+xml'
    : 'application/octet-stream';
}
