import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, copyFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';
import { saveImageDataMapping, getImageSourceUrl } from '@/lib/image-source-map';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';
import sharp from 'sharp';
import { validateApiInputs } from '@/lib/api-validator';

/**
 * 将 base64 data URL 或远程图片 URL 保存到持久化目录，
 * 返回可持久化的本地 URL 路径，避免 data:/blob: URL 丢失。
 * 
 * 生产环境: 保存到 /space/wujie-data/uploads/ (S3持久卷)
 * 开发环境: 保存到 public/uploads/ (开发时HMR可访问)
 * 
 * 同时在 public/uploads/ 创建副本或符号链接以供 Next.js 静态服务
 */
export async function POST(request: NextRequest) {
  try {
    // 认证检查：只有登录用户才能保存图片
    // 服务端内部调用（来自 localhost 的请求）自动放行
    const isInternalCall = request.headers.get('x-internal-call') === 'true' 
      || request.headers.get('host')?.startsWith('localhost')
      || request.headers.get('host')?.startsWith('127.0.0.1');
    if (!isInternalCall) {
      const user = await getAuthUser(request);
      if (!user) {
        return NextResponse.json(
          { success: false, error: '未登录，请先登录' },
          { status: 401 }
        );
      }
    }

    const contentType = request.headers.get('content-type') || '';

    // 支持 multipart/form-data 文件上传
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const imageUrl = formData.get('imageUrl') as string | null;

      if (file) {
        // 文件上传模式：统一保存到 getServerDataRoot()/uploads
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const uploadDir = path.join(getServerDataRoot(), 'uploads');
        const webPath = '/api/serve-upload/uploads';
        const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';

        if (!existsSync(uploadDir)) {
          await mkdir(uploadDir, { recursive: true });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > 20 * 1024 * 1024) {
          return NextResponse.json({ error: 'Image too large (max 20MB)' }, { status: 400 });
        }

        const originalName = file.name || 'upload.png';
        const ext = originalName.split('.').pop()?.toLowerCase() || 'png';
        const filename = `upload-${timestamp}-${random}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);

        // 开发环境额外在 public/uploads 创建副本
        if (isDev) {
          try {
            const publicDir = path.join(process.cwd(), 'public', 'uploads');
            if (!existsSync(publicDir)) await mkdir(publicDir, { recursive: true });
            await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename));
          } catch { /* best effort */ }
        }

        // S3 backup
        let s3Key: string | null = null;
        if (isS3Available()) {
          const fileContentType = file.type || 'image/png';
          s3Key = await uploadImageToS3(buffer, filename, fileContentType);
          if (s3Key) console.log(`[save-image] S3 backup: ${s3Key}`);
        }

        return NextResponse.json({
          success: true,
          url: `${webPath}/${filename}`,
          filename,
          size: buffer.length,
          s3Key,
        });
      }

      // formData 中没有文件但有 imageUrl
      if (imageUrl) {
        // 走下面的 JSON 逻辑
      } else {
        return NextResponse.json({ error: 'No file or imageUrl provided' }, { status: 400 });
      }
    }

    // 解析 JSON body，同时支持 mediaType 字段（视频/图片）
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType : undefined;
    const compress = body.compress === true;

    if (!imageUrl) {
      return NextResponse.json({ error: 'No imageUrl provided' }, { status: 400 });
    }

    // ★ 是否启用后端压缩（默认不压缩，前端压缩优先；视频永远不压缩）
    const isVideo = mediaType === 'video'
      || /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i.test(imageUrl);
    const shouldCompress = compress && !isVideo;

    const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    // 确定上传目录：统一保存到 getServerDataRoot()/uploads（开发+生产一致）
    // URL 格式统一为 /api/serve-upload/uploads/filename，确保跨环境兼容
    const uploadDir = path.join(getServerDataRoot(), 'uploads');
    const webPath = '/api/serve-upload/uploads';
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    // 开发环境额外在 public/uploads 创建副本，确保 Next.js 静态服务也能访问
    if (isDev) {
      try {
        const publicDir = path.join(process.cwd(), 'public', 'uploads');
        if (!existsSync(publicDir)) await mkdir(publicDir, { recursive: true });
      } catch { /* best effort */ }
    }

    // data:image/png;base64,... 格式
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
      if (!match) {
        return NextResponse.json({ error: 'Invalid data URL format' }, { status: 400 });
      }

      const mimeType = match[1].replace('+xml', ''); // svg+xml -> svg
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      // 限制大小 (max 20MB)
      if (buffer.length > 20 * 1024 * 1024) {
        return NextResponse.json({ error: 'Image too large (max 20MB)' }, { status: 400 });
      }

      // ★ 后端压缩：大图自动缩放 + 智能格式选择（保留透明通道）
      let finalBuffer: Buffer = buffer;
      let finalMimeType = mimeType;
      if (shouldCompress && mimeType !== 'svg') {
        try {
          const metadata = await sharp(buffer).metadata();
          // 检测是否真正有透明像素（而非仅 channels===4 或 hasAlpha 标记）
          // RGBA 图片若所有像素 alpha=255（全不透明）→ 无需保留 PNG，可安全转 JPEG
          let reallyHasTransparency = false;
          if (metadata.channels === 4 || metadata.hasAlpha === true) {
            try {
              const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
              const pixelCount = info.width * info.height;
              const channels = info.channels;
              for (let i = 0; i < pixelCount; i++) {
                if (data[i * channels + channels - 1] < 255) {
                  reallyHasTransparency = true;
                  break;
                }
              }
            } catch {
              // 检测失败时保守保留 PNG
              reallyHasTransparency = true;
            }
          }

          const maxEdge = 8192; // 保留最高8K分辨率，不缩小
          if ((metadata.width || 0) > maxEdge || (metadata.height || 0) > maxEdge) {
            const resizePipeline = sharp(buffer)
              .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true });
            if (reallyHasTransparency) {
              // 有真正透明像素 — 必须保留 PNG 格式
              finalBuffer = await resizePipeline.png({ quality: 90, compressionLevel: 6 }).toBuffer();
              finalMimeType = 'png';
            } else {
              finalBuffer = await resizePipeline.jpeg({ quality: 85 }).toBuffer();
              finalMimeType = 'jpeg';
            }
          } else if (buffer.length > 1024 * 1024) {
            // 不超尺寸但超1MB，也压缩
            const pipeline = sharp(buffer);
            if (reallyHasTransparency) {
              // 有真正透明像素 — 必须保留 PNG 格式
              finalBuffer = await pipeline.png({ quality: 90, compressionLevel: 6 }).toBuffer();
              finalMimeType = 'png';
            } else {
              finalBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
              finalMimeType = 'jpeg';
            }
          }
        } catch (compressErr) {
          console.warn('[save-image] Sharp compress failed, using original:', compressErr);
          finalBuffer = buffer;
        }
      }

      const ext = finalMimeType === 'jpeg' ? 'jpg' : finalMimeType === 'svg' ? 'svg' : finalMimeType;
      const filename = `gen-${timestamp}-${random}.${ext}`;
      const filePath = path.join(uploadDir, filename);
      await writeFile(filePath, finalBuffer);
      // 开发环境额外在 public/uploads 创建副本，确保 Next.js 静态服务也能访问
      if (isDev) {
        try {
          await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename));
        } catch { /* best effort */ }
      }

      // 上传到 S3 对象存储（持久化，重部署不丢失）
      let s3Key: string | null = null;
      if (isS3Available()) {
        s3Key = await uploadImageToS3(finalBuffer, filename, `image/${finalMimeType}`);
        if (s3Key) {
          console.log(`[save-image] S3 backup: ${s3Key}`);
        }
      }

      return NextResponse.json({
        success: true,
        url: `${webPath}/${filename}`,
        filename,
        size: finalBuffer.length,
        s3Key,
      });
    }

    // blob: URL — 前端应先转成 data URL 再发过来，这里做兜底
    if (imageUrl.startsWith('blob:')) {
      return NextResponse.json({ error: 'blob: URL cannot be saved server-side. Convert to data URL first.' }, { status: 400 });
    }

    // 本地 /api/serve-upload/ 路径 — 通过 localhost fetch 获取后保存
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/')) {
      try {
        const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
        const baseUrl = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
        // 确保 baseUrl 和 imageUrl 之间只有一个斜杠
        const normalizedPath = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
        const fullUrl = `${baseUrl}${normalizedPath}`;
        const response = await fetch(fullUrl, { signal: AbortSignal.timeout(120000) }); // 2min for 4K images
        if (!response.ok) {
          return NextResponse.json({ error: `Failed to fetch local image: ${response.status}` }, { status: 400 });
        }
        const contentType = response.headers.get('content-type') || 'image/png';
        let buffer: Buffer = Buffer.from(await response.arrayBuffer());
        const isLocalVideo = contentType.startsWith('video/') || isVideo;
        if (buffer.length > (isLocalVideo ? 200 : 80) * 1024 * 1024) {
          return NextResponse.json({ error: `${isLocalVideo ? 'Video' : 'Image'} too large (max ${isLocalVideo ? '200MB' : '80MB'})` }, { status: 400 });
        }

        // ★ 本地视频直接原样保存
        if (isLocalVideo) {
          const ctExt = contentType.split('/')[1]?.split(';')[0]?.trim().replace('quicktime', 'mov').replace('jpeg', 'jpg') || 'mp4';
          const finalExt = ctExt === 'octet-stream' ? 'mp4' : ctExt;
          const filename = `video-${timestamp}-${random}.${finalExt}`;
          const filePath = path.join(uploadDir, filename);
          await writeFile(filePath, buffer);
          if (isDev) {
            try { await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename)); } catch {}
          }
          let s3Key: string | null = null;
          if (isS3Available()) {
            try { s3Key = await uploadImageToS3(buffer, filename, contentType); } catch {}
          }
          return NextResponse.json({
            success: true,
            url: `${webPath}/${filename}`,
            filename,
            size: buffer.length,
            s3Key,
            mediaType: 'video',
          });
        }

        // ★ 自动压缩：大图（>1MB）无透明像素的 PNG 自动转 JPEG，保留透明通道的用 PNG
        let finalExt = contentType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
        if (shouldCompress && buffer.length > 1024 * 1024 && !finalExt.includes('svg') && !finalExt.includes('gif')) {
          try {
            const metadata = await sharp(buffer).metadata();
            let reallyHasTransparency = false;
            if (metadata.channels === 4 || metadata.hasAlpha === true) {
              try {
                const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
                const pixelCount = info.width * info.height;
                const channels = info.channels;
                for (let i = 0; i < pixelCount; i++) {
                  if (data[i * channels + channels - 1] < 255) {
                    reallyHasTransparency = true;
                    break;
                  }
                }
              } catch {
                reallyHasTransparency = true;
              }
            }

            if (reallyHasTransparency) {
              // 有真正透明像素 — 必须保留 PNG 格式，仅做 PNG 优化压缩
              buffer = await sharp(buffer).png({ quality: 90, compressionLevel: 6 }).toBuffer();
              finalExt = 'png';
            } else {
              // 无透明像素 — 转为 JPEG 大幅缩小体积
              const quality = buffer.length > 5 * 1024 * 1024 ? 85 : 90;
              buffer = await sharp(buffer).jpeg({ quality }).toBuffer();
              finalExt = 'jpg';
            }
          } catch (compressErr) {
            console.warn('[save-image] Sharp compress failed for local path, using original:', compressErr);
          }
        }

        const filename = `gen-${timestamp}-${random}.${finalExt}`;
        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);
        // 开发环境额外在 public/uploads 创建副本
        if (isDev) {
          try {
            await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename));
          } catch { /* best effort */ }
        }
        // S3 backup
        let s3Key: string | null = null;
        if (isS3Available()) {
          const s3ContentType = finalExt === 'jpg' ? 'image/jpeg' : finalExt === 'svg' ? 'image/svg+xml' : `image/${finalExt}`;
          s3Key = await uploadImageToS3(buffer, filename, s3ContentType);
          if (s3Key) console.log(`[save-image] S3 backup: ${s3Key}`);
        }
        return NextResponse.json({
          success: true,
          url: `${webPath}/${filename}`,
          filename,
          size: buffer.length,
          s3Key,
        });
      } catch (fetchError) {
        return NextResponse.json({ error: 'Failed to fetch local image path' }, { status: 400 });
      }
    }

    // 远程 HTTP(S) URL — 下载后保存（视频原样保存；图片自动压缩）
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const controller = new AbortController();
      // 视频文件较大，放宽超时到10分钟；图片保持2分钟
      const fetchTimeout = isVideo ? 600000 : 120000;
      const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

      try {
        const response = await fetch(imageUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return NextResponse.json({ error: `Failed to download ${isVideo ? 'video' : 'image'}: ${response.status}` }, { status: 400 });
        }

        const rawContentType = response.headers.get('content-type') || (isVideo ? 'video/mp4' : 'image/png');
        const contentType = isVideo && !rawContentType.startsWith('video/')
          ? 'video/mp4'
          : rawContentType;
        let buffer: Buffer = Buffer.from(await response.arrayBuffer());

        // ★ 大小限制：视频 200MB / 图片 50MB
        const MAX_BYTES = isVideo ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
        if (buffer.length > MAX_BYTES) {
          return NextResponse.json({ error: `${isVideo ? 'Video' : 'Image'} too large (max ${isVideo ? '200MB' : '50MB'})` }, { status: 400 });
        }

        // ★ 扩展名推断：视频优先
        let finalExt: string;
        if (isVideo || contentType.startsWith('video/')) {
          const ctExt = contentType.split('/')[1]?.split(';')[0]?.trim();
          if (ctExt === 'quicktime') finalExt = 'mov';
          else if (ctExt === 'x-m4v' || ctExt === 'm4v') finalExt = 'm4v';
          else finalExt = ctExt || 'mp4';
        } else {
          finalExt = contentType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
        }

        // ★ 视频直接原样保存，不经过 sharp 压缩（sharp 不支持视频）
        if (isVideo || contentType.startsWith('video/')) {
          const filename = `video-${timestamp}-${random}.${finalExt}`;
          const filePath = path.join(uploadDir, filename);
          await writeFile(filePath, buffer);
          // 开发环境额外在 public/uploads 创建副本
          if (isDev) {
            try {
              await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename));
            } catch { /* best effort */ }
          }

          // S3 backup（视频上传到S3）
          let s3Key: string | null = null;
          if (isS3Available()) {
            try {
              s3Key = await uploadImageToS3(buffer, filename, contentType);
              if (s3Key) console.log(`[save-image] S3 backup video: ${s3Key} (${Math.round(buffer.length/1024/1024)}MB)`);
            } catch (s3Err) {
              console.warn('[save-image] S3 video backup failed:', s3Err);
            }
          }

          await saveImageDataMapping(filename, imageUrl);

          return NextResponse.json({
            success: true,
            url: `${webPath}/${filename}`,
            sourceUrl: imageUrl,
            filename,
            size: buffer.length,
            s3Key,
            mediaType: 'video',
          });
        }

        // ---- 以下是图片的压缩逻辑 ----
        if (buffer.length > 50 * 1024 * 1024) {
          return NextResponse.json({ error: 'Image too large (max 50MB)' }, { status: 400 });
        }

        // ★ 自动压缩：仅压缩超大图（>15MB），4K图片（通常5-12MB PNG）保持原始质量
        if (buffer.length > 15 * 1024 * 1024 && !finalExt.includes('svg') && !finalExt.includes('gif')) {
          try {
            const metadata = await sharp(buffer).metadata();
            // 检测是否真正有透明像素（而非仅 channels===4 或 hasAlpha 标记）
            let reallyHasTransparency = false;
            if (metadata.channels === 4 || metadata.hasAlpha === true) {
              try {
                const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
                const pixelCount = info.width * info.height;
                const channels = info.channels;
                for (let i = 0; i < pixelCount; i++) {
                  if (data[i * channels + channels - 1] < 255) {
                    reallyHasTransparency = true;
                    break;
                  }
                }
              } catch {
                // 检测失败时保守保留 PNG
                reallyHasTransparency = true;
              }
            }
            const maxEdge = 8192; // 保留最高8K分辨率，不缩小
            const needsResize = (metadata.width || 0) > maxEdge || (metadata.height || 0) > maxEdge;

            if (needsResize) {
              const pipeline = sharp(buffer).resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true });
              if (reallyHasTransparency) {
                // 有真正透明像素 — 必须保留 PNG 格式
                buffer = await pipeline.png({ quality: 92, compressionLevel: 6 }).toBuffer();
                finalExt = 'png';
              } else {
                buffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
                finalExt = 'jpg';
              }
            } else if (!reallyHasTransparency && finalExt === 'png' && buffer.length > 3 * 1024 * 1024) {
              // 无真正透明通道的大 PNG 转 JPEG 减小体积
              buffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
              finalExt = 'jpg';
            }
          } catch (compressErr) {
            console.warn('[save-image] Auto-compress failed, using original:', compressErr);
          }
        }

        const filename = `gen-${timestamp}-${random}.${finalExt}`;
        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);
        // 开发环境额外在 public/uploads 创建副本
        if (isDev) {
          try {
            await copyFile(filePath, path.join(process.cwd(), 'public', 'uploads', filename));
          } catch { /* best effort */ }
        }

        // 上传到 S3 对象存储（持久化，重部署不丢失）
        let s3Key: string | null = null;
        if (isS3Available()) {
          s3Key = await uploadImageToS3(buffer, filename, contentType);
          if (s3Key) {
            console.log(`[save-image] S3 backup: ${s3Key}`);
          }
        }

        // 记录 sourceUrl 映射（用于本地+S3 都丢失时重新下载）
        await saveImageDataMapping(filename, imageUrl);

        return NextResponse.json({
          success: true,
          url: `${webPath}/${filename}`,
          sourceUrl: imageUrl,
          filename,
          size: buffer.length,
          s3Key,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // 下载远程图片失败，返回失败状态，让前端尝试兜底方案
        console.warn(`[save-image] Failed to download remote URL: ${imageUrl}`, fetchError instanceof Error ? fetchError.message : String(fetchError));
        return NextResponse.json({
          success: false,
          error: 'Failed to download remote image',
          url: imageUrl,
          filename: null,
          size: 0,
        });
      }
    }

    return NextResponse.json({ error: 'Unsupported URL format' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Save image failed';
    console.error('Save image error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
