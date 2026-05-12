import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import sharp from 'sharp';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

const SUPPORTED_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

function findClosestAspectRatio(aspectRatio: string): string {
  if (SUPPORTED_RATIOS.includes(aspectRatio)) return aspectRatio;
  const parts = aspectRatio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const targetRatio = parts[0] / parts[1];
    let best = SUPPORTED_RATIOS[0];
    let bestDiff = Infinity;
    for (const sr of SUPPORTED_RATIOS) {
      const [sw, sh] = sr.split(':').map(Number);
      const diff = Math.abs(targetRatio - sw / sh);
      if (diff < bestDiff) { bestDiff = diff; best = sr; }
    }
    return best;
  }
  return '1:1';
}

// Greatest common divisor
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// Parse ratio string like "16:9" to get width/height proportions
function parseRatio(ratio: string): [number, number] {
  const parts = ratio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    return [parts[0], parts[1]];
  }
  return [1, 1];
}

// 图像编辑 API - 支持放大、擦除、蒙版修复、扩图、移除背景
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type EditAction = 'inpaint' | 'outpaint' | 'remove_background' | 'upscale' | 'multi_angle';

interface EditRequest {
  action: EditAction;
  imageUrl: string;
  maskImage?: string; // base64 encoded mask
  prompt?: string;
  expandRatio?: string;
  expandScale?: number;
  targetWidth?: number;
  targetHeight?: number;
  aspectRatio?: string; // e.g. "4:3" - used to preserve original image ratio
  angleMode?: 'image' | 'camera';
  rotation?: number;
  tilt?: number;
  zoom?: number;
  model?: string;
  providerId?: string;
}

// Helper: find upscayl binary
function findUpscaylBin(): string | null {
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
  const candidates = [
    path.join(workspacePath, 'bin', 'upscayl-bin'),
    path.join(workspacePath, 'node_modules/.pnpm/upscayl-node@3.1.1/node_modules/upscayl-node/dist/upscaler/sub-classes/driver/command-upscayl/resources/linux/bin/upscayl-bin'),
    '/usr/local/bin/upscayl-bin',
  ];
  for (const p of candidates) {
    try {
      fsSync.accessSync(p, fsSync.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

// Helper: find upscayl models directory
function findUpscaylModels(): string | null {
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
  const candidates = [
    path.join(workspacePath, 'upscayl-models'),
    path.join(workspacePath, 'node_modules/.pnpm/upscayl-node@3.1.1/node_modules/upscayl-node/dist/upscaler/sub-classes/model-manager/models'),
  ];
  for (const p of candidates) {
    try {
      if (fsSync.existsSync(p) && fsSync.readdirSync(p).some(f => f.endsWith('.param'))) {
        return p;
      }
    } catch {}
  }
  return null;
}

// Helper: fetch image as Buffer (supports external URLs, data URLs, and local paths)
async function fetchImageBuffer(url: string): Promise<Buffer> {
  // data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) return Buffer.from(matches[2], 'base64');
    throw new Error('Invalid data URL format');
  }
  // blob URL - cannot be resolved server-side
  if (url.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side');
  }
  // local path
  if (url.startsWith('/')) {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const localPath = path.join(workspacePath, 'public', url);
    if (fsSync.existsSync(localPath)) return fsSync.readFileSync(localPath);
    // Try localhost fetch
    const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${url}`;
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    throw new Error(`Cannot access local image: ${url}`);
  }
  // external URL
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Helper: submit a task to the images/generations API and return taskId or directUrl
async function submitImageTask(
  apiBaseUrl: string,
  apiKey: string,
  requestBody: Record<string, unknown>
): Promise<{ taskId?: string; directUrl?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  const submitResponse = await fetchWithV1Retry(
    apiBaseUrl,
    '/images/generations',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }
  );

  clearTimeout(timeoutId);

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('Image task submit error:', submitResponse.status, errorText);
    let errorMsg = `API 请求失败 (${submitResponse.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) errorMsg = errorJson.error.message;
    } catch { /* ignore */ }

    // 清理常见 API 错误信息，提供更友好的中文提示
    if (errorMsg.includes('ratio or price') || errorMsg.includes('not configured')) {
      throw new Error(`当前模型不支持此操作，请切换支持图像编辑的模型（如 DALL-E、Flux 等）或联系管理员配置`);
    }
    if (errorMsg.includes('image_urls') || errorMsg.includes('mask_image') || errorMsg.includes('image editing')) {
      throw new Error(`当前模型不支持图像编辑功能，请切换支持图生图/扩展的模型`);
    }
    if (errorMsg.includes('must be an URL') || errorMsg.includes('Invalid URL') || errorMsg.includes('data:')) {
      throw new Error(`当前模型不支持 Base64 图片输入，请切换支持图像编辑的模型`);
    }
    if (errorMsg.includes('Insufficient balance') || errorMsg.includes('insufficient')) {
      throw new Error(`API 余额不足，请联系管理员充值`);
    }
    if (errorMsg.includes('Rate limit') || errorMsg.includes('rate_limit') || errorMsg.includes('Too many requests')) {
      throw new Error(`请求过于频繁，请稍后再试`);
    }
    if (errorMsg.includes('model not found') || errorMsg.includes('Model not found')) {
      throw new Error(`模型不存在或已下线，请切换其他模型`);
    }
    if (errorMsg.includes('Invalid API key') || errorMsg.includes('invalid api_key')) {
      throw new Error(`API 密钥无效，请联系管理员检查配置`);
    }

    throw new Error(errorMsg);
  }

  const submitResult = await submitResponse.json();
  const taskId = submitResult.data?.[0]?.task_id;

  if (!taskId) {
    const directUrl = submitResult.data?.[0]?.url;
    if (directUrl) {
      return { directUrl };
    }
    throw new Error('未获取到任务ID');
  }

  return { taskId };
}

export async function POST(request: NextRequest) {
  try {
    const body: EditRequest = await request.json();
    const sessionUser = await getSessionUser(request);
    const {
      action,
      imageUrl,
      maskImage,
      prompt,
      expandRatio,
      expandScale = 1,
      targetWidth,
      targetHeight,
      aspectRatio,
      angleMode = 'image',
      rotation = 0,
      tilt = 0,
      zoom = 1,
      model = 'gemini-2.5-flash-image-preview',
    } = body;

    const provider = await findProviderForModel(model, 'imageEdit')
      || await findProviderForModel(model, 'image')
      || await findProviderForModel(model, 'universal');
    const apiKey = provider?.apiKey || process.env.APIMART_API_KEY || '';
    const apiBaseUrl = normalizeApiBaseUrl(provider?.baseUrl || process.env.APIMART_BASE_URL || 'https://api.apimart.ai');

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: '请先在管理员系统配置可用的图像编辑模型',
      }, { status: 400 });
    }

    if (action === 'multi_angle') {
      const yawText = rotation > 0 ? `${Math.abs(rotation)} degrees to the right` : rotation < 0 ? `${Math.abs(rotation)} degrees to the left` : 'front view';
      const pitchText = tilt > 0 ? `${Math.abs(tilt)} degrees high angle looking down` : tilt < 0 ? `${Math.abs(tilt)} degrees low angle looking up` : 'level camera height';
      const dollyText = zoom > 1.08 ? 'closer camera, tighter framing' : zoom < 0.92 ? 'pulled back camera, wider framing' : 'medium framing';
      const multiAnglePrompt = prompt || (angleMode === 'image'
        ? `Pseudo-3D AI photography studio. Reconstruct the reference image as a coherent three-dimensional object/subject and generate a new rendered view with the subject itself rotated ${yawText}. Preserve the same identity, design, materials, labels, colors, proportions, outfit/product details and lighting style. Infer plausible hidden sides instead of warping the flat image. Keep a clean professional studio background, realistic perspective, depth, occlusion, shadows, reflections, and high quality product/character photography. Camera pitch: ${pitchText}. Framing: ${dollyText}. Do not output a flat 2D rotated canvas, do not stretch or skew the original image.`
        : `Pseudo-3D AI photography studio. Keep the subject/object fixed as a real three-dimensional scene and move a virtual camera around it: yaw ${yawText}, pitch ${pitchText}, ${dollyText}. Preserve the same identity, design, materials, labels, colors, proportions and environment mood from the reference. Generate a new photographic view with real perspective, depth, occlusion, shadows, reflections, and inferred unseen geometry. Do not rotate the flat source image; re-render the scene from the requested camera angle.`);

      const requestBody: Record<string, unknown> = {
        model,
        prompt: multiAnglePrompt,
        size: '1:1',
        n: 1,
        image_urls: [imageUrl],
      };

      const result = await submitImageTask(apiBaseUrl, apiKey, requestBody);
      if (result.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action });
      }
      return NextResponse.json({ success: true, taskId: result.taskId, action, prompt: multiAnglePrompt });
    }

    if (action === 'upscale') {
      // 图像放大 - 优先使用本地 Upscayl NCNN (Real-ESRGAN)，回退到 AI API
      const tw = targetWidth || 2048;
      const th = targetHeight || 2048;

      // 尝试使用本地 Upscayl NCNN 放大（Real-ESRGAN 真正无损超分辨率）
      try {
        const upscaylBinPath = findUpscaylBin();
        const upscaylModelsPath = findUpscaylModels();
        if (upscaylBinPath && upscaylModelsPath) {
          console.log('[image-edit] Using local Upscayl NCNN for upscale');
          const os = await import('os');
          const fsModule = await import('fs');
          const pathModule = await import('path');
          const { execFileSync } = await import('child_process');

          const tmpDir = fsModule.mkdtempSync(pathModule.join(os.tmpdir(), 'upscayl-edit-'));
          const inputPath = pathModule.join(tmpDir, 'input.png');
          const outputPath = pathModule.join(tmpDir, 'output.png');

          try {
            // 下载图片
            const imgBuf = await fetchImageBuffer(imageUrl);
            fsModule.writeFileSync(inputPath, imgBuf);

            // 确定放大倍数
            const imgMeta = await sharp(imgBuf).metadata();
            const origW = imgMeta.width || 512;
            const model = 'realesrgan-x4fast';
            const scaleVal = (tw >= origW * 4) ? 4 : (tw >= origW * 2) ? 2 : 2;

            // 如果图片太大，先缩小
            let processInput = inputPath;
            const MAX_DIM = 2048;
            if (origW > MAX_DIM || (imgMeta.height || 0) > MAX_DIM) {
              const ratio = Math.min(MAX_DIM / origW, MAX_DIM / (imgMeta.height || 1));
              const resPath = pathModule.join(tmpDir, 'input_resized.png');
              await sharp(imgBuf).resize(Math.round(origW * ratio), Math.round((imgMeta.height || 1) * ratio)).png().toFile(resPath);
              processInput = resPath;
            }

            // 执行 upscayl
            const args = [
              '-i', processInput,
              '-o', outputPath,
              '-m', upscaylModelsPath,
              '-n', model,
              '-s', scaleVal.toString(),
              '-f', 'png',
              '-c', '90',
            ];
            execFileSync(upscaylBinPath, args, { timeout: 300000 });

            if (fsModule.existsSync(outputPath)) {
              const resultBuf = fsModule.readFileSync(outputPath);
              const resultMeta = await sharp(resultBuf).metadata();

              // 保存到 public 目录
              const uploadsDir = pathModule.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'upscayl');
              if (!fsModule.existsSync(uploadsDir)) {
                fsModule.mkdirSync(uploadsDir, { recursive: true });
              }
              const outFilename = `upscayl_${Date.now()}_${model}_${scaleVal}x.png`;
              fsModule.writeFileSync(pathModule.join(uploadsDir, outFilename), resultBuf);

              const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
              const resultUrl = baseUrl ? `${baseUrl}/upscayl/${outFilename}` : `/upscayl/${outFilename}`;

              try { fsModule.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

              return NextResponse.json({
                success: true,
                imageUrl: resultUrl,
                action,
                engine: 'upscayl-ncnn',
                originalSize: { width: origW, height: imgMeta.height },
                upscaledSize: { width: resultMeta.width, height: resultMeta.height },
                model,
                scale: scaleVal,
              });
            }
          } catch (upscaylErr) {
            console.warn('[image-edit] Upscayl NCNN failed, falling back to API:', upscaylErr);
            try { fsModule.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          }
        }
      } catch (checkErr) {
        console.warn('[image-edit] Upscayl check failed, falling back to API:', checkErr);
      }

      // 回退：AI API 超分辨率放大
      const upscalePrompt = prompt || (
        `Ultra-high quality image upscaling. Enhance this image to higher resolution while: ` +
        `1) Adding fine details and textures that are implied but not visible at current resolution; ` +
        `2) Sharpening edges and improving clarity; ` +
        `3) Preserving the original composition, colors, style, and content exactly; ` +
        `4) Making the image look like it was originally created at this higher resolution, not simply resized. ` +
        `Do not change the subject, layout, or artistic style. The result should be a natural-looking, detailed version of the original.`
      );

      const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b);
      const gcd = g(tw, th);
      const supportedRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
      let bestRatio = supportedRatios[0];
      let bestDiff = Infinity;
      const [rw, rh] = [tw / gcd, th / gcd];
      for (const sr of supportedRatios) {
        const [sw, sh] = sr.split(':').map(Number);
        const diff = Math.abs(rw / rh - sw / sh);
        if (diff < bestDiff) { bestDiff = diff; bestRatio = sr; }
      }
      const effectiveSize = bestRatio;

      const requestBody: Record<string, unknown> = {
        model,
        prompt: upscalePrompt,
        size: effectiveSize,
        n: 1,
        image_urls: [imageUrl],
      };

      const result = await submitImageTask(apiBaseUrl, apiKey, requestBody);
      if (result.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action, engine: 'ai-api' });
      }
      return NextResponse.json({ success: true, taskId: result.taskId, action, engine: 'ai-api' });
    }

    if (action === 'remove_background') {
      const bgSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : '1:1';
      const requestBody: Record<string, unknown> = {
        model,
        prompt: 'Remove the background from this image, keep only the main subject with transparent background. Output PNG format.',
        size: bgSize,
        n: 1,
        image_urls: [imageUrl],
      };

      const result = await submitImageTask(apiBaseUrl, apiKey, requestBody);
      if (result.directUrl) {
        return NextResponse.json({ success: true, imageUrl: result.directUrl, action });
      }
      return NextResponse.json({ success: true, taskId: result.taskId, action });
    }

    if (action === 'inpaint') {
      // ============================================================
      // 蒙版修复/擦除 - AI 智能修复策略
      // 将原图 + 蒙版 + 提示词发送给 AI 模型生成新内容，
      // 然后将生成结果与原图按蒙版合成，确保非蒙版区域像素级保留。
      // ============================================================
      if (!maskImage) {
        return NextResponse.json({ success: false, error: '需要提供蒙版图像' }, { status: 400 });
      }

      // 1. 获取原始图片
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchImageBuffer(imageUrl);
      } catch (e) {
        console.error('[inpaint] Failed to fetch source image:', e);
        return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
      }

      const origMeta = await sharp(imageBuffer).metadata();
      const origW = origMeta.width || 512;
      const origH = origMeta.height || 512;

      // 2. 解码蒙版并确保与原图尺寸一致
      let maskBuffer: Buffer;
      try {
        if (maskImage.startsWith('data:')) {
          const base64Data = maskImage.replace(/^data:image\/\w+;base64,/, '');
          maskBuffer = Buffer.from(base64Data, 'base64');
        } else {
          maskBuffer = await fetchImageBuffer(maskImage);
        }
        const maskMeta = await sharp(maskBuffer).metadata();
        if (maskMeta.width !== origW || maskMeta.height !== origH) {
          console.log(`[inpaint] Resizing mask from ${maskMeta.width}x${maskMeta.height} to ${origW}x${origH}`);
          maskBuffer = await sharp(maskBuffer)
            .resize(origW, origH, { fit: 'fill', kernel: 'nearest' })
            .png()
            .toBuffer();
        }
      } catch (e) {
        console.error('[inpaint] Failed to process mask:', e);
        return NextResponse.json({ success: false, error: '蒙版处理失败' }, { status: 500 });
      }

      // 3. 检测蒙版是否为空
      // 前端 renderMaskFromStrokes 生成黑色背景+白色笔触的 PNG，alpha 通道全为 255，
      // 因此不能以 alpha > 127 判断蒙版区域，只能以 RGB 亮度判断（白色=蒙版区域）。
      const maskRawData = await sharp(maskBuffer).ensureAlpha().raw().toBuffer();
      let maskPixelCount = 0;
      let minX = origW, minY = origH, maxX = 0, maxY = 0;
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const idx = (y * origW + x) * 4;
          const brightness = (maskRawData[idx] + maskRawData[idx + 1] + maskRawData[idx + 2]) / 3;
          if (brightness > 127) {
            maskPixelCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maskPixelCount === 0) {
        return NextResponse.json({ success: false, error: '蒙版区域为空，请重新绘制' }, { status: 400 });
      }

      const isErase = !prompt || !prompt.trim();
      const totalPixels = origW * origH;
      const maskRatio = (maskPixelCount / totalPixels * 100).toFixed(1);
      console.log(`[inpaint] ${isErase ? 'ERASE' : 'MASK'} mode, image ${origW}x${origH}, mask pixels ${maskPixelCount}/${totalPixels} (${maskRatio}%)`);

      // 4. 生成标准黑白蒙版（白色=需要修复区域，黑色=保留区域）
      const binaryMaskPixels = Buffer.alloc(maskRawData.length);
      for (let i = 0; i < maskRawData.length; i += 4) {
        const brightness = (maskRawData[i] + maskRawData[i + 1] + maskRawData[i + 2]) / 3;
        const isMasked = brightness > 127;
        const val = isMasked ? 255 : 0;
        binaryMaskPixels[i] = val;
        binaryMaskPixels[i + 1] = val;
        binaryMaskPixels[i + 2] = val;
        binaryMaskPixels[i + 3] = 255;
      }
      const binaryMaskBuffer = await sharp(binaryMaskPixels, { raw: { width: origW, height: origH, channels: 4 } })
        .png()
        .toBuffer();

      // 5. 构建提示词
      let inpaintPrompt: string;
      if (isErase) {
        inpaintPrompt = (
          `Seamlessly erase the object in the masked area and fill it with content that naturally ` +
          `continues the surrounding scene. Match the same style, colors, lighting, perspective, ` +
          `and texture of the adjacent areas. The result should look as if the erased content ` +
          `never existed. Do not add any new objects, people, or text.`
        );
      } else {
        inpaintPrompt = prompt!.trim();
      }

      // 6. 确保 imageUrl 是 API 可访问的完整 URL
      let accessibleImageUrl = imageUrl;
      if (imageUrl.startsWith('/')) {
        const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
        if (domain) {
          accessibleImageUrl = `${domain}${imageUrl}`;
        } else {
          // 无公网域名时，将本地图片转为 base64 数据 URL
          try {
            const imgBuffer = await fetchImageBuffer(imageUrl);
            const imgBase64 = `data:image/png;base64,${imgBuffer.toString('base64')}`;
            accessibleImageUrl = imgBase64;
          } catch {
            accessibleImageUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
          }
        }
      }

      // 7. 计算宽高比
      const effectiveSize = aspectRatio ? findClosestAspectRatio(aspectRatio) : '1:1';

      // 8. 构建蒙版 data URL（标准黑白图，白色=修复区域）
      const maskDataUrl = `data:image/png;base64,${binaryMaskBuffer.toString('base64')}`;

      // 9. 发送 AI 生成请求
      const requestBody: Record<string, unknown> = {
        model,
        prompt: inpaintPrompt,
        negative_prompt: isErase
          ? 'text, watermark, logo, signature, new objects, new people, new animals, low quality, blurry, distorted, deformed'
          : 'low quality, blurry, distorted, deformed, watermark, text, signature',
        size: effectiveSize,
        n: 1,
        image_urls: [accessibleImageUrl],
        mask_image: maskDataUrl,
        strength: isErase ? 0.85 : 0.8,
      };

      console.log(`[inpaint] AI API request: model=${model}, size=${effectiveSize}, strength=${isErase ? 0.85 : 0.8}`);

      const result = await submitImageTask(apiBaseUrl, apiKey, requestBody);

      // 10. 处理结果
      if (result.directUrl) {
        try {
          // 下载 AI 生成的结果
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const resultMeta = await sharp(resultBuffer).metadata();

          // 确保 AI 结果尺寸与原图一致
          const resizedResult = (resultMeta.width !== origW || resultMeta.height !== origH)
            ? await sharp(resultBuffer).resize(origW, origH, { fit: 'fill' }).png().toBuffer()
            : resultBuffer;

          // 创建渐变融合蒙版：在蒙版边界做柔和过渡，避免硬边
          const blendMask = await sharp(binaryMaskBuffer)
            .threshold(127)
            .blur(8)  // 边界柔化 8px
            .png()
            .toBuffer();

          // 用蒙版合成：AI结果在白色区域(蒙版区域)，原图在黑色区域(保留区域)
          // 步骤：1) 给AI结果加上蒙版alpha 2) 叠加到原图上
          const resultWithAlpha = await sharp(resizedResult)
            .composite([{ input: blendMask, blend: 'dest-in' }])
            .png()
            .toBuffer();

          const compositeResult = await sharp(imageBuffer)
            .composite([{ input: resultWithAlpha, blend: 'over' }])
            .png()
            .toBuffer();

          // 保存合成结果
          const publicDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'inpaint');
          await fs.mkdir(publicDir, { recursive: true });
          const resultFileName = `inpaint_${Date.now()}.png`;
          const resultPath = path.join(publicDir, resultFileName);
          await fs.writeFile(resultPath, compositeResult);

          const compositeUrl = `/inpaint/${resultFileName}`;
          console.log(`[inpaint] AI composite result saved: ${resultFileName}`);

          return NextResponse.json({ success: true, imageUrl: compositeUrl, action, engine: 'ai-composite' });
        } catch (compositeErr) {
          console.error('[inpaint] Composite failed, returning raw AI result:', compositeErr);
          // 合成失败时直接返回 AI 结果
          return NextResponse.json({ success: true, imageUrl: result.directUrl, action, engine: 'ai-raw' });
        }
      }

      // 异步结果 - 返回 taskId 给前端轮询，前端做蒙版合成
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        cropInfo: { cropX: 0, cropY: 0, cropW: origW, cropH: origH, origW, origH },
        engine: 'ai-api',
      });
    }

    if (action === 'outpaint') {
      // ============================================================
      // 扩图 - 向外扩展画面
      // 策略：合成扩展画布(原图居中+灰色填充) + mask → API → 合成原图到结果中心
      // 核心改进：不依赖 API 的 mask_image 支持，而是在结果上合成原图确保像素级保留
      // ============================================================
      const ratio = expandRatio || '1:1';
      const scale = expandScale || 1;

      // 获取原始图片
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchImageBuffer(imageUrl);
      } catch (e) {
        console.error('Failed to fetch source image for outpaint:', e);
        return NextResponse.json({ success: false, error: '无法获取原始图片' }, { status: 500 });
      }

      // 获取原图尺寸
      const origMeta = await sharp(imageBuffer).metadata();
      const origW = origMeta.width || 512;
      const origH = origMeta.height || 512;

      // 计算目标扩展尺寸
      // 原则：倍数和比例是先后叠加融合关系
      //   Step1: 根据比例计算目标画布（原图完整放入，不足方向扩展）
      //   Step2: 在比例扩展基础上再应用倍数放大
      let targetW: number, targetH: number;

      if (ratio === '原始比例') {
        // 原始比例 + scale：等比放大
        targetW = Math.round(origW * scale);
        targetH = Math.round(origH * scale);
      } else {
        // 指定比例：原图完整放入目标画布，不足方向扩展
        const [rw, rh] = parseRatio(ratio);
        const targetRatio = rw / rh;
        const origRatio = origW / origH;

        if (origRatio >= targetRatio) {
          // 原图更宽或等宽：以原图宽度为基准，高度按目标比例扩展
          targetW = origW;
          targetH = Math.round(origW / targetRatio);
        } else {
          // 原图更高：以原图高度为基准，宽度按目标比例扩展
          targetH = origH;
          targetW = Math.round(origH * targetRatio);
        }

        // 应用 scale 倍数（在比例扩展基础上再放大）
        if (scale > 1) {
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        }
      }

      // 确保尺寸不小于原图
      targetW = Math.max(origW, targetW);
      targetH = Math.max(origH, targetH);
      // 对齐到8的倍数（API要求）
      targetW = Math.ceil(targetW / 8) * 8;
      targetH = Math.ceil(targetH / 8) * 8;

      // 原图在目标画布中的位置（居中放置，保持原始像素大小）
      const srcW = origW;
      const srcH = origH;
      const offsetX = Math.round((targetW - srcW) / 2);
      const offsetY = Math.round((targetH - srcH) / 2);

      console.log(`[outpaint] orig ${origW}x${origH} → target ${targetW}x${targetH}, offset (${offsetX},${offsetY}), ratio=${ratio}, scale=${scale}`);

      // 使用 sharp 合成扩展画布
      // 1. 创建背景画布（灰色填充表示需要扩展的区域）
      // 2. 将原图贴到 offsetX, offsetY 位置
      const resizedOriginal = await sharp(imageBuffer)
        .resize(srcW, srcH, { fit: 'fill' })
        .toBuffer();

      // 创建灰色背景
      const backgroundBuffer = await sharp({
        create: {
          width: targetW,
          height: targetH,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      }).png().toBuffer();

      // 合成：原图覆盖在灰色背景上
      const compositeImage = await sharp(backgroundBuffer)
        .composite([{
          input: resizedOriginal,
          left: offsetX,
          top: offsetY,
        }])
        .png()
        .toBuffer();

      // 创建蒙版：原图区域=黑(保留)，扩展区域=白(需要AI生成)
      const maskFullWhite = await sharp({
        create: {
          width: targetW,
          height: targetH,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      }).png().toBuffer();

      const maskBlackSrc = await sharp({
        create: {
          width: srcW,
          height: srcH,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      }).png().toBuffer();

      const finalMask = await sharp(maskFullWhite)
        .composite([{
          input: maskBlackSrc,
          left: offsetX,
          top: offsetY,
        }])
        .blur(8) // IOPaint sd_mask_blur 风格，确保衔接处无痕迹
        .png()
        .toBuffer();

      // 保存合成图和蒙版到临时文件（避免 base64 过大导致 API 请求失败）
      const publicDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'outpaint');
      await fs.mkdir(publicDir, { recursive: true });
      const timestamp = Date.now();
      const compositeFileName = `composite_${timestamp}.png`;
      const maskFileName = `mask_${timestamp}.png`;
      const compositePath = path.join(publicDir, compositeFileName);
      const maskPath = path.join(publicDir, maskFileName);
      await fs.writeFile(compositePath, compositeImage);
      await fs.writeFile(maskPath, finalMask);

      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      // 优先使用 base64 数据 URL 发送图片（避免外部 API 无法访问 localhost）
      const compositeBase64 = `data:image/png;base64,${compositeImage.toString('base64')}`;
      const compositeUrl = domain ? `${domain}/outpaint/${compositeFileName}` : compositeBase64;
      const maskFileBase64 = `data:image/png;base64,${finalMask.toString('base64')}`;

      // 构建扩图方向的提示词
      const directionHints: string[] = [];
      if (offsetY > 0) directionHints.push('above');
      if (offsetY + srcH < targetH) directionHints.push('below');
      if (offsetX > 0) directionHints.push('to the left');
      if (offsetX + srcW < targetW) directionHints.push('to the right');

      const directionText = directionHints.length > 0
        ? `Extend the scene ${directionHints.join(' and ')} of the original content.`
        : 'Extend the scene outward in all directions.';

      const outpaintPrompt = prompt || (
        `Image outpainting / expansion. ${directionText} ` +
        `The provided image has the original content in the center surrounded by a gray placeholder area. ` +
        `Keep the center original content exactly as-is and only generate new content in the gray border areas. ` +
        `The new content should seamlessly connect with the original scene, matching its style, lighting, colors, and perspective. ` +
        `Do not modify, crop, or alter the original center content in any way.`
      );

      // 计算目标比例字符串用于API
      const targetRatioStr = `${targetW}:${targetH}`;
      const targetSize = findClosestAspectRatio(targetRatioStr);

      // 使用 base64 数据 URL 发送图片（确保外部 API 可访问）+ mask_image
      const requestBody: Record<string, unknown> = {
        model,
        prompt: outpaintPrompt,
        size: targetSize,
        n: 1,
        image_urls: [compositeBase64],
        mask_image: maskFileBase64,
      };

      console.log(`[outpaint] Submitting task: ${targetSize}, composite ${compositeUrl.substring(0, 80)}...`);

      const result = await submitImageTask(apiBaseUrl, apiKey, requestBody);

      // 清理临时文件（延迟清理，异步任务需要文件存在）
      const cleanupFiles = async () => {
        try { await fs.unlink(compositePath); } catch (_) { /* ignore */ }
        try { await fs.unlink(maskPath); } catch (_) { /* ignore */ }
      };

      // 辅助函数：将原图合成到结果中心，确保像素级保留
      const compositeOriginalOnResult = async (resultBuffer: Buffer): Promise<Buffer> => {
        const resultMeta = await sharp(resultBuffer).metadata();
        const resultW = resultMeta.width || targetW;
        const resultH = resultMeta.height || targetH;

        // 将结果 resize 到目标尺寸（API 可能返回不同尺寸）
        let resizedResult = resultBuffer;
        if (resultW !== targetW || resultH !== targetH) {
          resizedResult = await sharp(resultBuffer)
            .resize(targetW, targetH, { fit: 'fill' })
            .png()
            .toBuffer();
        }

        // 创建渐变蒙版：原图区域=黑(使用生成结果)，边缘过渡=灰(混合)
        // 但为了确保原图内容完全保留，我们直接将原图叠在结果上
        // 先创建一个带羽化边缘的蒙版
        const featherSize = 10; // 羽化像素数
        const blendMask = await sharp({
          create: {
            width: srcW,
            height: srcH,
            channels: 3,
            background: { r: 255, g: 255, b: 255 }, // 白色=保留原图
          },
        })
          .blur(featherSize) // 边缘羽化
          .png()
          .toBuffer();

        // 将原图 resize 到 srcW x srcH
        const originalForComposite = await sharp(imageBuffer)
          .resize(srcW, srcH, { fit: 'fill' })
          .png()
          .toBuffer();

        // 在原图上应用 alpha 通道（蒙版控制透明度）
        const originalWithAlpha = await sharp(originalForComposite)
          .composite([{
            input: blendMask,
            blend: 'dest-in', // 使用蒙版作为 alpha
          }])
          .png()
          .toBuffer();

        // 将带 alpha 的原图合成到结果中心
        const finalComposite = await sharp(resizedResult)
          .composite([{
            input: originalWithAlpha,
            left: offsetX,
            top: offsetY,
            blend: 'over',
          }])
          .png()
          .toBuffer();

        return finalComposite;
      };

      if (result.directUrl) {
        // 同步结果 - 合成原图到中心
        try {
          const resultBuffer = await fetchImageBuffer(result.directUrl);
          const finalBuffer = await compositeOriginalOnResult(resultBuffer);

          const resultFileName = `outpaint_${timestamp}.png`;
          const resultPath = path.join(publicDir, resultFileName);
          await fs.writeFile(resultPath, finalBuffer);

          const compositeResultUrl = `${domain}/outpaint/${resultFileName}`;
          console.log(`[outpaint] Sync result composited: ${resultFileName}`);

          // 清理临时文件
          await cleanupFiles();

          return NextResponse.json({ success: true, imageUrl: compositeResultUrl, action, targetWidth: targetW, targetHeight: targetH });
        } catch (compositeErr) {
          console.error('[outpaint] Composite failed, using raw result:', compositeErr);
          await cleanupFiles();
          return NextResponse.json({ success: true, imageUrl: result.directUrl, action, targetWidth: targetW, targetHeight: targetH });
        }
      }

      // 异步结果 - 返回 taskId + 合成信息，前端轮询后需后端合成
      // 为了简化，异步结果也返回 cropInfo 供前端合成
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        action,
        targetWidth: targetW,
        targetHeight: targetH,
        outpaintInfo: { offsetX, offsetY, srcW, srcH, targetW, targetH, origW, origH, featherSize: 10 },
      });
    }

    return NextResponse.json({ success: false, error: `不支持的操作: ${action}` }, { status: 400 });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Image edit error:', errMsg);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
