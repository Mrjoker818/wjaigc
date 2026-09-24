import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';
import { saveImageDataMapping } from '@/lib/image-source-map';
import { validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { pathExistsSync } from '@/lib/runtime-path-exists';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50MB — 4K PNG 可能 30MB+

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { imageUrl } = (await request.json()) as { imageUrl?: string };
    // 输入校验
    const _validationError = validateApiInputs({
          imageUrl: imageUrl
    }, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }


    if (!imageUrl) {
      return NextResponse.json({ success: false, error: 'Missing imageUrl' }, { status: 400 });
    }

    if (imageUrl.startsWith('data:')) {
      return NextResponse.json({ success: true, imageUrl });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid imageUrl' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ success: false, error: 'Only http/https image URLs can be cached' }, { status: 400 });
    }

    // SSRF protection: block private/internal network addresses
    const hostname = parsedUrl.hostname.toLowerCase();
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
      return NextResponse.json({ success: false, error: 'Private network URLs are not allowed' }, { status: 403 });
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return NextResponse.json({ success: false, error: 'Localhost URLs are not allowed' }, { status: 403 });
    }
    if (/^(169\.254\.|fe80:)/.test(hostname)) {
      return NextResponse.json({ success: false, error: 'Link-local URLs are not allowed' }, { status: 403 });
    }
    if (/^0\./.test(hostname)) {
      return NextResponse.json({ success: false, error: 'Invalid URL host' }, { status: 403 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 分钟超时，4K 大图下载可能需要较长时间

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WujieAI-Image-Cache/1.0',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      },
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Image fetch failed: ${response.status}` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return NextResponse.json({ success: false, error: 'URL is not an image' }, { status: 415 });
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: 'Image is too large to cache' }, { status: 413 });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: 'Image is too large to cache' }, { status: 413 });
    }

    // ★ 核心优化：不再返回 base64 data URL（4K 图片 base64 会 20-40MB），
    // 而是保存为本地文件，返回可访问的文件 URL
    const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    let uploadDir: string;
    let webPath: string;
    if (isProd) {
      uploadDir = path.join(getServerDataRoot(), 'uploads');
      webPath = '/api/serve-upload';
    } else {
      uploadDir = path.join(process.cwd(), 'public', 'uploads');
      webPath = '/uploads';
    }

    if (!pathExistsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const extFromCt = contentType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const ext = extFromCt || 'png';
    const filename = `cache-${timestamp}-${random}.${ext}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    // 生产环境：创建 public 副本
    if (isProd) {
      try {
        const publicDir = path.join(process.cwd(), 'public', 'uploads');
        if (!pathExistsSync(publicDir)) await mkdir(publicDir, { recursive: true });
        const { copyFile } = await import('fs/promises');
        await copyFile(filePath, path.join(publicDir, filename));
      } catch { /* 生产环境无需 public 副本 */ }
    }

    // S3 备份
    let s3Key: string | null = null;
    if (isS3Available()) {
      try {
        s3Key = await uploadImageToS3(buffer, filename, contentType);
        if (s3Key) console.log(`[cache-image] S3 backup: ${s3Key}`);
      } catch (e) {
        console.warn('[cache-image] S3 upload failed:', e instanceof Error ? e.message : e);
      }
    }

    // 记录 sourceUrl 映射（用于后续恢复）
    await saveImageDataMapping(filename, imageUrl);

    const localUrl = `${webPath}/${filename}`;

    return NextResponse.json({
      success: true,
      imageUrl: localUrl,
      filename,
      size: buffer.length,
      s3Key,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
