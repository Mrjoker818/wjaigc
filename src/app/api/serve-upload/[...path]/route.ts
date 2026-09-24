import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { downloadImageFromS3, getS3PresignedUrl, deriveS3Key, readBinaryFromS3Exact, resolveS3Key } from '@/lib/s3-storage';
import { getImageSourceUrl } from '@/lib/image-source-map';
import { isAllowedPublicMediaExtension } from '@/lib/media-validation';
import { readExactRecoveryMedia } from '@/lib/asset-core/recovery-media';
import {
  MAX_ASSET_BINARY_BYTES,
  recoverExportAssetBytes,
  validateExportAssetBytes,
} from '@/lib/asset-core/binary-persistence';
import path from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const filePath = pathParts.join('/');
    
    // 安全检查：防止路径穿越攻击
    if (filePath.includes('..') || filePath.includes('\0') || pathParts.some(p => p === '..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const exportArtifact = exportArtifactDescriptor(pathParts);
    if (!exportArtifact && !isAllowedPublicMediaPath(pathParts)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (exportArtifact) {
      const dataRoot = path.resolve(getServerDataRoot());
      const { readServeUploadExportLocal } = await import('@/lib/serve-upload-local-storage');
      let bytes: Buffer | null;
      try {
        bytes = await readServeUploadExportLocal(dataRoot, exportArtifact.filename, MAX_ASSET_BINARY_BYTES);
        if (bytes) {
          await validateExportAssetBytes({
            bytes,
            filename: exportArtifact.filename,
            mimeType: exportArtifact.contentType,
          });
        }
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      if (!bytes) {
        bytes = await readBinaryFromS3Exact(`exports/${exportArtifact.filename}`);
        if (bytes) {
          try {
            await recoverExportAssetBytes({
              bytes,
              filename: exportArtifact.filename,
              mimeType: exportArtifact.contentType,
            });
          } catch {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
          }
        }
      }
      if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 });
      return exportArtifact.attachment
        ? exportDocumentResponse(new Uint8Array(bytes), exportArtifact.contentType, exportArtifact.filename)
        : publicMediaResponse(new Uint8Array(bytes), exportArtifact.contentType, path.extname(exportArtifact.filename).toLowerCase());
    }

    const isRecoveryPath = filePath.startsWith('recovery/');
    const exactRecovery = await readExactRecoveryMedia(filePath);
    if (exactRecovery) {
      return publicMediaResponse(
        new Uint8Array(exactRecovery.buffer),
        exactRecovery.mimeType,
        path.extname(filePath).toLowerCase(),
      );
    }
    if (isRecoveryPath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const dataRoot = getServerDataRoot();
    const { readServeUploadMediaLocal, cacheServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    
    // 1. 尝试从本地文件系统读取
    let localBytes: Buffer | null;
    try {
      localBytes = await readServeUploadMediaLocal(dataRoot, process.cwd(), filePath);
    } catch (error) {
      if (error instanceof Error && error.message === 'Unsafe local media path') {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      throw error;
    }
    if (localBytes) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getContentType(ext);
      return publicMediaResponse(new Uint8Array(localBytes), contentType, ext);
    }
    
    // 2. 本地文件不存在，尝试从 S3 下载
    const s3Buffer = await downloadImageFromS3(filePath);
    if (s3Buffer && s3Buffer.length > 0) {
      console.log(`[serve-upload] Recovered from S3: ${filePath}`);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getContentType(ext);
      
      // 同时恢复到本地文件系统，下次请求无需再从 S3 下载
      try {
        cacheServeUploadMediaLocal(dataRoot, filePath, s3Buffer);
      } catch (writeErr) {
        console.warn(`[serve-upload] Failed to cache S3 file locally:`, writeErr instanceof Error ? writeErr.message : writeErr);
      }
      
      return publicMediaResponse(new Uint8Array(s3Buffer), contentType, ext);
    }
    
    // 3. S3 也没有，尝试从 sourceUrl（原始外部 URL）重新下载
    // Try multiple key formats for source map lookup:
    // - Full path: "generate/img_xxx.jpg"
    // - Just filename: "img_xxx.jpg"
    // - Without extension variations
    let sourceUrl: string | null = null;
    
    // Try full relative path first
    sourceUrl = await getImageSourceUrl(filePath);
    
    // If not found, try just the filename portion
    if (!sourceUrl) {
      sourceUrl = await getImageSourceUrl(path.basename(filePath));
    }
    
    // If still not found, try filename without extension (some mappings may have been saved differently)
    if (!sourceUrl) {
      const basenameNoExt = path.basename(filePath, path.extname(filePath));
      sourceUrl = await getImageSourceUrl(basenameNoExt);
    }
    
    if (sourceUrl) {
      try {
        const fetchRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
        if (fetchRes.ok) {
          const buffer = Buffer.from(await fetchRes.arrayBuffer());
          const ext = path.extname(filePath).toLowerCase();
          const contentType = getContentType(ext);
          
          // 恢复到本地文件系统 — 保持原始路径结构
          try {
            cacheServeUploadMediaLocal(dataRoot, filePath, buffer);
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
          return publicMediaResponse(buffer, contentType, ext);
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
    : ext === '.gif' ? 'image/gif'
    : ext === '.mp4' ? 'video/mp4'
    : ext === '.webm' ? 'video/webm'
    : ext === '.mov' ? 'video/quicktime'
    : ext === '.m4v' ? 'video/x-m4v'
    : ext === '.avi' ? 'video/x-msvideo'
    : ext === '.mkv' ? 'video/x-matroska'
    : ext === '.glb' ? 'model/gltf-binary'
    : ext === '.gltf' ? 'model/gltf+json'
    : ext === '.obj' ? 'model/obj'
    : ext === '.mtl' ? 'text/plain'
    : 'application/octet-stream';
}

function exportArtifactDescriptor(pathParts: string[]): { filename: string; contentType: string; attachment: boolean } | null {
  if (pathParts.length !== 2 || pathParts[0] !== 'exports') return null;
  const filename = pathParts[1];
  if (!/^[a-f0-9]{16}-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|json|zip)$/u.test(filename)) return null;
  const extension = path.extname(filename).toLowerCase();
  const contentType = extension === '.png' ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
    : extension === '.json' ? 'application/json'
    : 'application/zip';
  return {
    filename,
    contentType,
    attachment: extension === '.json' || extension === '.zip',
  };
}

function exportDocumentResponse(body: BodyInit, contentType: string, filename: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isAllowedPublicMediaPath(pathParts: string[]): boolean {
  if (pathParts.length === 0 || pathParts.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part))) {
    return false;
  }

  const privateRoots = new Set(['system', 'users']);
  if (privateRoots.has(pathParts[0].toLowerCase())) return false;

  return isAllowedPublicMediaExtension(path.extname(pathParts[pathParts.length - 1]));
}

function publicMediaResponse(body: BodyInit, contentType: string, extension: string): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  if (extension === '.svg') headers['Content-Disposition'] = 'attachment';
  return new NextResponse(body, { headers });
}
