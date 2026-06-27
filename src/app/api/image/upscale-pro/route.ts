// ============================================================
// POST /api/image/upscale-pro — 无损放大（多策略降级 + AI画质精修）
// 1a. 云端 PearAPI photo-enhancer（Real-ESRGAN/SeedVR2）
// 1b. 云端 fal.ai SeedVR2（高质量扩散超分辨率，$0.001/MP）
// 2. 本地 ONNX Real-ESRGAN（CPU分块处理）
// 2.5 AI画质精修（放大后自动追加，修复模糊/噪点/失真）
// 3. AI重绘兜底（图像生成模型放大）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';

// 允许最长5分钟（ONNX放大+AI精修可能较慢）
export const maxDuration = 300;
import { consumeCredits } from '@/lib/credits';
import { enhanceViaAI } from '@/lib/quality-enhance';
import { UPSCALE_OUTPUT_DIR, UPSCALE_OUTPUT_URL_PREFIX } from '@/lib/image-tools/config';

/** 支持的无损放大模型 */
type UpscaleProModel = 'Real-ESRGAN' | 'SeedVR2-Upscaler';

interface UpscaleProRequest {
  imageUrl: string;
  model?: UpscaleProModel;
  face?: boolean;       // 是否含人脸，增强人脸细节
  scale?: 2 | 4;       // 单次放大倍率（2× 或 4×）
  targetScale?: number; // 用户期望的最终倍率（如8，用于链式放大：先4×再2×）
  fallbackToAi?: boolean; // 云端和本地都失败时是否用AI重绘兜底（默认true）
  enhanceModel?: string;  // 精修使用的图像模型（用户当前在图像生成面板选择的模型）
  skipAiEnhance?: boolean; // 跳过AI画质精修（默认false，ONNX/云端放大结果已足够好时跳过可避免内容变化）
  originalWidth?: number;  // 原图宽度（用于链式放大精确 resize 到目标尺寸）
  originalHeight?: number; // 原图高度（用于链式放大精确 resize 到目标尺寸）
}

/** 从管理员配置查找 PearAPI 提供商的 API Key */
async function findPearApiKey(): Promise<{ apiKey: string; baseUrl: string } | null> {
  try {
    const { getApiProviders } = await import('@/lib/server-api-config');
    const providers = await getApiProviders();
    // 查找 baseUrl 包含 pearapi 的 upscaler 提供商
    const pearProvider = providers.find(
      (p: { baseUrl: string; modelType?: string }) =>
        p.baseUrl.includes('pearapi') && (p.modelType === 'upscaler' || p.modelType === 'image' || !p.modelType)
    );
    if (pearProvider?.apiKey && pearProvider?.baseUrl) {
      return {
        apiKey: pearProvider.apiKey,
        baseUrl: pearProvider.baseUrl,
      };
    }
    // 兜底：查找任意 pearapi 提供商
    const anyPear = providers.find(
      (p: { baseUrl: string }) => p.baseUrl.includes('pearapi')
    );
    if (anyPear?.apiKey && anyPear?.baseUrl) {
      return { apiKey: anyPear.apiKey, baseUrl: anyPear.baseUrl };
    }
  } catch {
    // 忽略，回退到环境变量
  }

  // 环境变量兜底
  const envKey = process.env.PEAR_API_KEY || process.env.PEARAPI_KEY;
  if (envKey) {
    return { apiKey: envKey, baseUrl: 'https://api.pearapi.ai' };
  }
  return null;
}

/** 策略1: 云端 PearAPI photo-enhancer */
async function upscaleViaPearAPI(
  imageUrl: string,
  model: UpscaleProModel,
  face: boolean,
  scale: number | undefined,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  const pearConfig = await findPearApiKey();
  if (!pearConfig) {
    console.log('[upscale-pro] No PearAPI key configured, skipping cloud upscale');
    return null;
  }

  const requestBody: Record<string, unknown> = {
    image: imageUrl,
    face,
    key: pearConfig.apiKey,
    model,
    task_type: 'sync',
  };

  if (scale) {
    requestBody.scale = scale;
  }

  console.log(`[upscale-pro] Strategy 1: PearAPI photo-enhancer (model=${model}, face=${face}, scale=${scale || 'auto'})`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const pearRes = await fetch(`${pearConfig.baseUrl}/api/photo-enhancer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const pearData = await pearRes.json() as Record<string, unknown>;

    if (pearData.code !== 200 || !pearData.data) {
      const errMsg = pearData.msg || pearData.error || `PearAPI code=${pearData.code}`;
      if (pearData.code === 402) {
        console.warn(`[upscale-pro] PearAPI balance insufficient (402). Tip: Add fal.ai provider for SeedVR2 upscale.`);
      } else {
        console.warn(`[upscale-pro] PearAPI failed: ${errMsg}`);
      }
      return null;
    }

    const resultData = pearData.data as Record<string, unknown>;
    const resultImageUrl = resultData.image_url as string;
    if (!resultImageUrl) return null;

    // ★ 精确resize：PearAPI返回的图片尺寸可能不精确匹配目标（如SeedVR2默认1.5×而非用户选的4×）
    let finalUrl = resultImageUrl;
    if (targetWidth && targetHeight && targetWidth > 0 && targetHeight > 0) {
      finalUrl = await resizeToTarget(resultImageUrl, targetWidth, targetHeight);
    }

    // 持久化结果
    const persistedUrl = await persistResult(finalUrl);
    console.log(`[upscale-pro] PearAPI success: ${persistedUrl.slice(0, 80)}`);
    return { url: persistedUrl, model, strategy: model === 'SeedVR2-Upscaler' ? 'cloud-PearAPI-SeedVR2' : 'cloud-PearAPI-Real-ESRGAN' };
  } catch (err) {
    clearTimeout(timeout);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] PearAPI error: ${errMsg}`);
    return null;
  }
}

/** 从管理员配置查找 fal.ai 提供商的 API Key */
async function findFalApiKey(): Promise<{ apiKey: string; baseUrl: string } | null> {
  try {
    const { getApiProviders, findProviderForFeature } = await import('@/lib/server-api-config');
    // 优先查找 upscaler 类型的提供商
    const upscalerProvider = await findProviderForFeature('upscaler');
    if (upscalerProvider?.apiKey && upscalerProvider?.baseUrl) {
      const url = upscalerProvider.baseUrl;
      if (url.includes('fal.ai') || url.includes('fal.run')) {
        return { apiKey: upscalerProvider.apiKey, baseUrl: url };
      }
    }
    // 兜底：查找任意 fal.ai 提供商
    const providers = await getApiProviders();
    const falProvider = providers.find(
      (p: { baseUrl: string }) => p.baseUrl.includes('fal.ai') || p.baseUrl.includes('fal.run'),
    );
    if (falProvider?.apiKey && falProvider?.baseUrl) {
      return {
        apiKey: falProvider.apiKey,
        baseUrl: falProvider.baseUrl,
      };
    }
  } catch {
    // 忽略
  }

  // 环境变量兜底
  const envKey = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (envKey) {
    return { apiKey: envKey, baseUrl: 'https://fal.run' };
  }
  return null;
}

/** 策略1b: 云端 fal.ai SeedVR2（高质量扩散超分辨率）
 *  API 文档: https://fal.ai/models/fal-ai/seedvr/upscale/image
 *  定价: $0.001/MP，支持 factor/target 两种放大模式
 */
async function upscaleViaFalSeedVR2(
  imageUrl: string,
  scale: number,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  const falConfig = await findFalApiKey();
  if (!falConfig) {
    console.log('[upscale-pro] No fal.ai key configured, skipping SeedVR2 cloud upscale');
    return null;
  }

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    image_url: imageUrl,
    output_format: 'png',
  };

  // 如果有精确目标尺寸，使用 target 模式；否则用 factor 模式
  if (targetWidth && targetHeight && targetWidth > 0 && targetHeight > 0) {
    // 根据 targetWidth 选择最接近的 target_resolution
    const maxDim = Math.max(targetWidth, targetHeight);
    if (maxDim >= 2160) {
      requestBody.target_resolution = '2160p';
    } else if (maxDim >= 1440) {
      requestBody.target_resolution = '1440p';
    } else if (maxDim >= 1080) {
      requestBody.target_resolution = '1080p';
    } else {
      requestBody.target_resolution = '720p';
    }
    requestBody.upscale_mode = 'target';
    // fal.ai target 模式下会自动计算倍率，但我们仍需确保结果尺寸精确
    // 使用 factor 模式 + 精确 resize 更可控
    requestBody.upscale_mode = 'factor';
    requestBody.upscale_factor = Math.min(Math.max(scale, 1), 10);
  } else {
    requestBody.upscale_mode = 'factor';
    requestBody.upscale_factor = Math.min(Math.max(scale, 1), 10);
  }

  console.log(`[upscale-pro] Strategy 1b: fal.ai SeedVR2 (mode=${requestBody.upscale_mode}, factor=${requestBody.upscale_factor})`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    // 尝试同步模式（sync_mode=true 直接返回图片）
    const syncBody = { ...requestBody, sync_mode: true };

    const falRes = await fetch('https://fal.run/fal-ai/seedvr/upscale/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falConfig.apiKey}`,
      },
      body: JSON.stringify(syncBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!falRes.ok) {
      const errText = await falRes.text().catch(() => '');
      console.warn(`[upscale-pro] fal.ai SeedVR2 HTTP ${falRes.status}: ${errText.slice(0, 300)}`);

      // 422 = 参数错误，429 = 限流，401/403 = 鉴权失败 — 不再重试
      if (falRes.status === 401 || falRes.status === 403 || falRes.status === 422) {
        return null;
      }

      // 同步失败，尝试异步模式
      return await upscaleViaFalSeedVR2Async(imageUrl, requestBody, falConfig.apiKey);
    }

    const falData = await falRes.json() as Record<string, unknown>;

    // 异步模式返回 request_id（需要轮询）
    if (falData.request_id && !falData.image) {
      return await pollFalSeedVR2Result(falData.request_id as string, falConfig.apiKey, targetWidth, targetHeight);
    }

    // 同步模式直接返回 image
    const imageObj = falData.image as Record<string, unknown> | undefined;
    const resultImageUrl = imageObj?.url as string;
    if (!resultImageUrl) {
      console.warn('[upscale-pro] fal.ai SeedVR2: no image URL in response');
      return null;
    }

    // 精确 resize 到目标尺寸
    let finalUrl = resultImageUrl;
    if (targetWidth && targetHeight && targetWidth > 0 && targetHeight > 0) {
      finalUrl = await resizeToTarget(resultImageUrl, targetWidth, targetHeight);
    }

    // 持久化结果
    const persistedUrl = await persistResult(finalUrl);
    console.log(`[upscale-pro] fal.ai SeedVR2 success: ${persistedUrl.slice(0, 80)}`);
    return { url: persistedUrl, model: 'SeedVR2-Upscaler', strategy: 'cloud-fal-SeedVR2' };
  } catch (err) {
    clearTimeout(timeout);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] fal.ai SeedVR2 error: ${errMsg}`);
    return null;
  }
}

/** fal.ai SeedVR2 异步提交 + 轮询 */
async function upscaleViaFalSeedVR2Async(
  imageUrl: string,
  requestBody: Record<string, unknown>,
  apiKey: string,
): Promise<{ url: string; model: string; strategy: string } | null> {
  console.log('[upscale-pro] fal.ai SeedVR2: trying async queue mode...');

  try {
    // 提交异步请求
    const submitRes = await fetch('https://queue.fal.run/fal-ai/seedvr/upscale/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => '');
      console.warn(`[upscale-pro] fal.ai async submit HTTP ${submitRes.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const submitData = await submitRes.json() as Record<string, unknown>;
    const requestId = submitData.request_id as string;
    if (!requestId) {
      console.warn('[upscale-pro] fal.ai async: no request_id in response');
      return null;
    }

    return await pollFalSeedVR2Result(requestId, apiKey);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] fal.ai SeedVR2 async error: ${errMsg}`);
    return null;
  }
}

/** 轮询 fal.ai 异步任务结果 */
async function pollFalSeedVR2Result(
  requestId: string,
  apiKey: string,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  const maxAttempts = 120; // 最多轮询120次
  const intervalMs = 3000; // 每3秒一次

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));

    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/seedvr/upscale/image/requests/${requestId}/status`,
      { headers: { 'Authorization': `Key ${apiKey}` } },
    );

    if (!statusRes.ok) {
      console.warn(`[upscale-pro] fal.ai poll status HTTP ${statusRes.status}`);
      continue;
    }

    const statusData = await statusRes.json() as Record<string, unknown>;
    const status = statusData.status as string;

    if (status === 'COMPLETED') {
      // 获取结果
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/seedvr/upscale/image/requests/${requestId}`,
        { headers: { 'Authorization': `Key ${apiKey}` } },
      );
      if (!resultRes.ok) {
        console.warn(`[upscale-pro] fal.ai get result HTTP ${resultRes.status}`);
        return null;
      }
      const resultData = await resultRes.json() as Record<string, unknown>;
      const imageObj = resultData.image as Record<string, unknown> | undefined;
      const resultImageUrl = imageObj?.url as string;
      if (!resultImageUrl) {
        console.warn('[upscale-pro] fal.ai async: no image URL in result');
        return null;
      }

      let finalUrl = resultImageUrl;
      if (targetWidth && targetHeight && targetWidth > 0 && targetHeight > 0) {
        finalUrl = await resizeToTarget(resultImageUrl, targetWidth, targetHeight);
      }

      const persistedUrl = await persistResult(finalUrl);
      console.log(`[upscale-pro] fal.ai SeedVR2 async success: ${persistedUrl.slice(0, 80)}`);
      return { url: persistedUrl, model: 'SeedVR2-Upscaler', strategy: 'cloud-fal-SeedVR2' };
    }

    if (status === 'FAILED') {
      const error = statusData.error as string || 'Unknown error';
      console.warn(`[upscale-pro] fal.ai async task failed: ${error}`);
      return null;
    }

    // IN_PROGRESS or IN_QUEUE — continue polling
    if (i % 10 === 0) {
      console.log(`[upscale-pro] fal.ai SeedVR2 polling... status=${status}, attempt=${i + 1}/${maxAttempts}`);
    }
  }

  console.warn('[upscale-pro] fal.ai SeedVR2 async: polling timeout');
  return null;
}

/** 精确 resize 到目标尺寸（共享工具函数） */
async function resizeToTarget(
  imageUrl: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  try {
    const sharp = await import('sharp');
    const path = await import('path');
    const fs = await import('fs');
    const resp = await fetch(imageUrl);
    if (!resp.ok) return imageUrl;
    const buf = Buffer.from(await resp.arrayBuffer());
    const meta = await sharp.default(buf).metadata();
    const curW = meta.width || 0;
    const curH = meta.height || 0;
    if (curW > 0 && curH > 0 && (curW !== targetWidth || curH !== targetHeight)) {
      console.log(`[upscale-pro] resizeToTarget: ${curW}x${curH} -> ${targetWidth}x${targetHeight}`);
      const resizedBuf = await sharp.default(buf)
        .resize(targetWidth, targetHeight, { kernel: 'lanczos3' })
        .png({ quality: 95 })
        .toBuffer();
      const outDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'data', 'uploads', 'upscale');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `fal-resize-${Date.now()}.png`);
      fs.writeFileSync(outFile, resizedBuf);
      return `/api/serve-upload/uploads/upscale/fal-resize-${Date.now()}.png`;
    }
  } catch (resizeErr) {
    console.warn('[upscale-pro] resizeToTarget failed:', resizeErr instanceof Error ? resizeErr.message : String(resizeErr));
  }
  return imageUrl;
}

/** 策略2: 本地 Python ONNX Real-ESRGAN（纯CPU，无需GPU） */
async function upscaleViaOnnx(
  imageUrl: string,
  scale: number,
  face: boolean,
): Promise<{ url: string; model: string; strategy: string } | null> {
  console.log(`[upscale-pro] Strategy 2: Local ONNX Real-ESRGAN (scale=${scale}x, face=${face})`);

  try {
    const { execFile } = await import('child_process');
    const path = await import('path');
    const fs = await import('fs');

    // 检查脚本和模型文件是否存在
    const scriptPath = path.join(process.cwd(), 'scripts', 'upscale_onnx.py');
    const modelDir = path.join(process.cwd(), 'onnx-models');

    if (!fs.existsSync(scriptPath)) {
      console.warn('[upscale-pro] ONNX upscale script not found:', scriptPath);
      return null;
    }

    // 列出可用模型
    const availableModels = fs.readdirSync(modelDir)
      .filter(f => f.endsWith('.onnx'))
      .map(f => f.replace('.onnx', ''));
    if (availableModels.length === 0) {
      console.warn('[upscale-pro] No ONNX models found in', modelDir);
      return null;
    }

    // 选择模型：根据scale选择合适的模型
    let modelName = 'realesrgan-x4plus-fp16'; // 默认使用x4plus fp16模型（体积小速度快）
    if (!availableModels.includes(modelName)) {
      const alternatives = ['realesrgan-x4plus', 'RealESRGAN_x4plus', 'realesrgan-x2plus'];
      modelName = alternatives.find(m => availableModels.includes(m)) || availableModels[0];
    }

    // 先将图片下载/保存到临时文件
    let inputPath: string;
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        console.warn('[upscale-pro] Invalid data URL format');
        return null;
      }
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      inputPath = path.join('/tmp', `upscale-input-${Date.now()}.${ext}`);
      fs.writeFileSync(inputPath, buffer);
    } else if (imageUrl.startsWith('/') || imageUrl.startsWith('/api/')) {
      const baseUrl = process.env.DEPLOY_RUN_PORT
        ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
        : 'http://localhost:5000';
      inputPath = path.join('/tmp', `upscale-input-${Date.now()}.png`);
      const resp = await fetch(`${baseUrl}${imageUrl}`);
      if (!resp.ok) {
        console.warn(`[upscale-pro] Failed to download local image: ${resp.status}`);
        return null;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(inputPath, buf);
    } else {
      inputPath = path.join('/tmp', `upscale-input-${Date.now()}.png`);
      const resp = await fetch(imageUrl);
      if (!resp.ok) {
        console.warn(`[upscale-pro] Failed to download remote image: ${resp.status}`);
        return null;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(inputPath, buf);
    }

    // 计算tile大小：根据图片尺寸动态调整，避免OOM
    const sharp = await import('sharp');
    const metadata = await sharp.default(inputPath).metadata();
    let maxDim = Math.max(metadata.width || 512, metadata.height || 512);
    // ONNX Real-ESRGAN x4模型固定4×放大
    // 策略：先让模型4×放大，再精确resize到目标尺寸(origW*scale × origH*scale)
    // 对于2×：可先用sharp缩小到一半再4×放大(2×效果)，或直接4×再缩小
    // 直接4×再缩小更简单且质量更好（模型4×输出包含更多细节，缩小不会丢失）
    // 对于超大图(>1024px)先缩小输入避免CPU超时，缩小后4×放大+resize补偿
    const maxInputSize = 1024;
    if (maxDim > maxInputSize) {
      const ratio = maxInputSize / maxDim;
      const newW = Math.round((metadata.width || 512) * ratio);
      const newH = Math.round((metadata.height || 512) * ratio);
      const resizedBuf = await sharp.default(inputPath)
        .resize(newW, newH, { kernel: 'lanczos3' })
        .png()
        .toBuffer();
      const resizedPath = inputPath.replace(/(\.\w+)$/, '-resized$1');
      fs.writeFileSync(resizedPath, resizedBuf);
      inputPath = resizedPath;
      maxDim = Math.max(newW, newH);
      // 注意：不修改effectiveScale，保持用户选择的倍率
      // 后续会精确resize到目标尺寸 origW*scale × origH*scale
    }

    let tileSize = 256;
    if (maxDim > 512) tileSize = 128;
    else if (maxDim > 256) tileSize = 192;

    console.log(`[upscale-pro] ONNX upscale: input=${maxDim}px, model=${modelName}, tile=${tileSize}, target=${scale}x (model=4x then resize)`);

    // 调用Python ONNX脚本
    const params = JSON.stringify({
      inputFile: inputPath,
      scale: 4,  // ONNX Real-ESRGAN 模型固定4×放大，后续用sharp精确resize到目标尺寸
      tileSize,
      model: modelName,
    });

    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = execFile(
        'python3',
        [scriptPath],
        { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
      proc.stdin?.write(params);
      proc.stdin?.end();
    });

    // 清理输入临时文件
    try { fs.unlinkSync(inputPath); } catch {}

    // 解析输出 — Python脚本返回 outputFile（文件路径）或 image（base64编码的图片数据）
    const output = JSON.parse(result.stdout.trim());
    if (!output.success) {
      console.warn(`[upscale-pro] ONNX upscale failed: ${output.error || result.stderr.slice(0, 200)}`);
      return null;
    }

    // 优先使用文件路径（大图模式），否则使用base64（小图模式）
    let resultUrl: string = output.outputFile || '';
    if (!resultUrl && output.image) {
      // Python脚本返回的image字段是纯base64，需转为data URL
      resultUrl = `data:image/png;base64,${output.image}`;
    }
    if (!resultUrl) {
      console.warn('[upscale-pro] ONNX upscale: no output in response');
      return null;
    }

    // 精确resize到目标尺寸：ONNX模型固定4×放大，但用户可能选2×/4×/8×
    // 始终检查并精确调整到 origW*scale × origH*scale
    const originalWidth = metadata.width || 512;
    const originalHeight = metadata.height || 512;
    const targetW = originalWidth * scale;
    const targetH = originalHeight * scale;
    // 需要resize的情况：输入被缩小过、scale≠4、或tile对齐偏差
    // 始终精确调整到 origW*scale × origH*scale
    {
      if (fs.existsSync(resultUrl)) {
        const resizedBuf = await sharp.default(resultUrl)
          .resize(targetW, targetH, { kernel: 'lanczos3' })
          .png()
          .toBuffer();
        fs.writeFileSync(resultUrl, resizedBuf);
        console.log(`[upscale-pro] ONNX output resized to ${targetW}x${targetH}`);
      } else if (resultUrl.startsWith('data:')) {
        // base64 data URL — decode, resize, re-encode
        const base64Match = resultUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
        if (base64Match) {
          const imgBuf = Buffer.from(base64Match[2], 'base64');
          const resizedBuf = await sharp.default(imgBuf)
            .resize(targetW, targetH, { kernel: 'lanczos3' })
            .png()
            .toBuffer();
          resultUrl = `data:image/png;base64,${resizedBuf.toString('base64')}`;
          console.log(`[upscale-pro] ONNX base64 output resized to ${targetW}x${targetH}`);
        }
      }
    }

    // 如果输出是文件路径，保存到持久化目录
    if (fs.existsSync(resultUrl)) {
      const fileName = path.basename(resultUrl);
      const outputDir = UPSCALE_OUTPUT_DIR;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const destPath = path.join(outputDir, fileName);
      fs.copyFileSync(resultUrl, destPath);
      try { fs.unlinkSync(resultUrl); } catch {}
      resultUrl = `${UPSCALE_OUTPUT_URL_PREFIX}${fileName}`;
    } else if (resultUrl.startsWith('data:')) {
      const persistedUrl = await persistResult(resultUrl);
      resultUrl = persistedUrl;
    }

    console.log(`[upscale-pro] ONNX Real-ESRGAN success: ${resultUrl.slice(0, 80)}`);
    return { url: resultUrl, model: `ONNX-${modelName}`, strategy: 'local-Real-ESRGAN' };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] ONNX Real-ESRGAN error: ${errMsg}`);
    return null;
  }
}

/** 策略3: AI重绘放大 */
async function upscaleViaAI(
  imageUrl: string,
  scale: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  console.log(`[upscale-pro] Strategy 3: AI redraw upscale (scale=${scale}x)`);

  try {
    const baseUrl = process.env.DEPLOY_RUN_PORT
      ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
      : 'http://localhost:5000';

    const aiRes = await fetch(`${baseUrl}/api/image-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upscale',
        imageUrl,
        scale,
        upscaleMode: 'ai', // AI重绘模式，不走CPU放大链路
      }),
    });

    if (!aiRes.ok) {
      console.warn(`[upscale-pro] AI upscale returned ${aiRes.status}`);
      return null;
    }

    const aiData = await aiRes.json() as Record<string, unknown>;
    // image-edit 返回可能是 taskId（异步）或直接 url
    if (aiData.taskId) {
      console.log(`[upscale-pro] AI upscale submitted as async task: ${aiData.taskId}`);
      // 异步任务：upscale-pro 是同步 API，不支持轮询，直接返回 null 让调用方处理
      console.warn('[upscale-pro] AI upscale returned async taskId, cannot wait in sync context');
      return null;
    }

    if (aiData.success && aiData.url) {
      console.log(`[upscale-pro] AI upscale success: ${(aiData.url as string).slice(0, 80)}`);
      return { url: aiData.url as string, model: 'AI-redraw', strategy: 'ai-redraw' };
    }

    // 检查AI重绘返回的imageUrl (可能是http URL或data: URL)
    const aiImageUrl = (aiData.imageUrl as string) || (aiData.resultUrl as string) || '';
    if (aiImageUrl) {
      const persistedUrl = await persistResult(aiImageUrl);
      return { url: persistedUrl, model: 'AI-redraw', strategy: 'ai-redraw' };
    }

    console.warn(`[upscale-pro] AI upscale unexpected response:`, JSON.stringify(aiData).slice(0, 200));
    return null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] AI upscale error: ${errMsg}`);
    return null;
  }
}

/** AI画质精修已提取到共享模块 src/lib/quality-enhance.ts */

/** 持久化远程URL到本地/S3 */
async function persistResult(remoteUrl: string): Promise<string> {
  try {
    const baseUrl = process.env.DEPLOY_RUN_PORT
      ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
      : 'http://localhost:5000';
    const persistResp = await fetch(`${baseUrl}/api/save-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: remoteUrl, prefix: 'upscale-pro' }),
    });
    if (persistResp.ok) {
      const persistData = await persistResp.json() as Record<string, unknown>;
      if (persistData.url) {
        return persistData.url as string;
      }
    }
  } catch {
    // 持久化失败，返回原始URL
  }
  return remoteUrl;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as UpscaleProRequest;
    const {
      imageUrl,
      model = 'Real-ESRGAN',
      face = false,
      scale = 2,
      targetScale,
      fallbackToAi = true,
      enhanceModel,
      skipAiEnhance = false,
      originalWidth,
      originalHeight,
    } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    // ★ 8× 链式放大：先 4× 再 2×（因为 Real-ESRGAN/ONNX 单次最大 4×）
    // targetScale > 4 时执行两步放大，最终尺寸 = 原图 × targetScale
    if (targetScale && targetScale > scale) {
      console.log(`[upscale-pro] Chain upscale: target ${targetScale}×, first pass ${scale}×...`);
      // 第一步：使用当前 scale（通常 4×）
      const firstPassResult = await performUpscaleChain(imageUrl, model, face, scale, fallbackToAi, skipAiEnhance,
        originalWidth ? originalWidth * scale : undefined, originalHeight ? originalHeight * scale : undefined);
      if (!firstPassResult.success || !firstPassResult.url) {
        return NextResponse.json(firstPassResult, { status: firstPassResult.success ? 200 : 502 });
      }
      // 第二步：对第一步结果再做 (targetScale/scale)× 放大
      const secondScale = targetScale / scale; // 如 8/4=2
      console.log(`[upscale-pro] Chain upscale: second pass ${secondScale}× on first result...`);
      const secondPassResult = await performUpscaleChain(
        firstPassResult.url as string, model, face, Math.min(4, Math.max(2, Math.round(secondScale))), fallbackToAi, skipAiEnhance,
        originalWidth ? Math.round(originalWidth * targetScale) : undefined, originalHeight ? Math.round(originalHeight * targetScale) : undefined,
      );
      if (secondPassResult.success && secondPassResult.url) {
        // 标记链式放大
        (secondPassResult as Record<string, unknown>).chainUpscale = true;
        (secondPassResult as Record<string, unknown>).totalScale = targetScale;
        (secondPassResult as Record<string, unknown>).strategy = `chain-${firstPassResult.strategy || 'unknown'}+${secondPassResult.strategy || 'unknown'}`;

        // ★ 精确 resize 到用户期望的目标尺寸
        // 链式放大可能因为 ONNX 分块/缩放策略导致尺寸偏差，最终统一 resize
        if (originalWidth && originalHeight && targetScale) {
          const exactW = originalWidth * targetScale;
          const exactH = originalHeight * targetScale;
          try {
            const sharp = (await import('sharp')).default;
            const resultUrl = secondPassResult.url as string;
            let imgBuf: Buffer;
            if (resultUrl.startsWith('data:')) {
              const b64match = resultUrl.match(/^data:image\/\w+;base64,(.+)$/);
              imgBuf = b64match ? Buffer.from(b64match[1], 'base64') : Buffer.from([]);
            } else if (resultUrl.startsWith('/')) {
              // 本地路径，通过HTTP获取
              const baseUrl = process.env.DEPLOY_RUN_PORT
                ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
                : 'http://localhost:5000';
              const resp = await fetch(`${baseUrl}${resultUrl}`);
              imgBuf = Buffer.from(await resp.arrayBuffer());
            } else {
              const resp = await fetch(resultUrl);
              imgBuf = Buffer.from(await resp.arrayBuffer());
            }
            const meta = await sharp(imgBuf).metadata();
            if (meta.width !== exactW || meta.height !== exactH) {
              console.log(`[upscale-pro] Chain upscale: resizing ${meta.width}x${meta.height} → exact ${exactW}x${exactH}`);
              const resizedBuf = await sharp(imgBuf)
                .resize(exactW, exactH, { kernel: 'lanczos3' })
                .png({ quality: 95 })
                .toBuffer();
              // 持久化精确调整后的结果
              const persistedUrl = await persistResult(`data:image/png;base64,${resizedBuf.toString('base64')}`);
              secondPassResult.url = persistedUrl;
              (secondPassResult as Record<string, unknown>).outputWidth = exactW;
              (secondPassResult as Record<string, unknown>).outputHeight = exactH;
            }
          } catch (resizeErr) {
            console.warn('[upscale-pro] Chain upscale exact resize failed:', resizeErr instanceof Error ? resizeErr.message : resizeErr);
          }
        }
      }
      return NextResponse.json(secondPassResult, { status: secondPassResult.success ? 200 : 502 });
    }

    // ★ 常规 2× / 4× 放大
    const result = await performUpscaleChain(imageUrl, model, face, scale, fallbackToAi, skipAiEnhance,
      originalWidth ? originalWidth * scale : undefined, originalHeight ? originalHeight * scale : undefined);

    // ★ 最终精确尺寸校验：确保输出图片尺寸 = 原图 × scale
    if (result.success && result.url && originalWidth && originalHeight) {
      const exactW = originalWidth * scale;
      const exactH = originalHeight * scale;
      try {
        const sharp = (await import('sharp')).default;
        const resultUrl = result.url as string;
        let imgBuf: Buffer;
        if (resultUrl.startsWith('data:')) {
          const b64match = resultUrl.match(/^data:image\/\w+;base64,(.+)$/);
          imgBuf = b64match ? Buffer.from(b64match[1], 'base64') : Buffer.from([]);
        } else if (resultUrl.startsWith('/')) {
          const baseUrl = process.env.DEPLOY_RUN_PORT ? `http://localhost:${process.env.DEPLOY_RUN_PORT}` : 'http://localhost:5000';
          const resp = await fetch(`${baseUrl}${resultUrl}`);
          imgBuf = Buffer.from(await resp.arrayBuffer());
        } else {
          const resp = await fetch(resultUrl);
          imgBuf = Buffer.from(await resp.arrayBuffer());
        }
        const meta = await sharp(imgBuf).metadata();
        if (meta.width !== exactW || meta.height !== exactH) {
          console.log(`[upscale-pro] Final resize: ${meta.width}x${meta.height} → ${exactW}x${exactH}`);
          const resizedBuf = await sharp(imgBuf)
            .resize(exactW, exactH, { kernel: 'lanczos3' })
            .png({ quality: 95 })
            .toBuffer();
          const persistedUrl = await persistResult(`data:image/png;base64,${resizedBuf.toString('base64')}`);
          result.url = persistedUrl;
          result.outputWidth = exactW;
          result.outputHeight = exactH;
        }
      } catch (finalResizeErr) {
        console.warn('[upscale-pro] Final exact resize failed:', finalResizeErr instanceof Error ? finalResizeErr.message : finalResizeErr);
      }
    }

    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[upscale-pro] Error:', msg);
    return NextResponse.json(
      { success: false, error: `无损放大失败: ${msg}` },
      { status: 500 },
    );
  }
}

/** 执行一次放大（多策略降级） */
async function performUpscaleChain(
  imageUrl: string,
  model: UpscaleProModel,
  face: boolean,
  scale: number,
  fallbackToAi: boolean,
  skipAiEnhance: boolean,
  targetWidth?: number,
  targetHeight?: number,
): Promise<Record<string, unknown>> {
  // === 多策略降级 ===

  // 策略1a: 云端 PearAPI（Real-ESRGAN / SeedVR2）— 不需要AI精修
  const cloudResult = await upscaleViaPearAPI(imageUrl, model, face, scale, targetWidth, targetHeight);
  if (cloudResult?.url) {
    return {
      success: true,
      url: cloudResult.url,
      model: cloudResult.model,
      strategy: cloudResult.strategy,
      enhanced: false,
    };
  }

  // 策略1b: 云端 fal.ai SeedVR2（高质量扩散超分辨率）— 不需要AI精修
  // 仅在用户选择 SeedVR2 模型时尝试（fal.ai 仅支持 SeedVR2，不支持 Real-ESRGAN）
  if (model === 'SeedVR2-Upscaler') {
    const falResult = await upscaleViaFalSeedVR2(imageUrl, scale, targetWidth, targetHeight);
    if (falResult?.url) {
      return {
        success: true,
        url: falResult.url,
        model: falResult.model,
        strategy: falResult.strategy,
        enhanced: false,
      };
    }
  }

  // 策略2: 本地 ONNX Real-ESRGAN
  const localResult = await upscaleViaOnnx(imageUrl, scale, face);
  if (localResult?.url) {
    // 策略2.5: ONNX放大后追加AI画质精修（带关键词约束，仅修复画质不改变内容）
    let enhancedUrl = localResult.url;
    let didEnhance = false;
    if (!skipAiEnhance) {
      try {
        const enhanceResult = await enhanceViaAI(localResult.url);
        if (enhanceResult.enhanced && enhanceResult.url) {
          enhancedUrl = enhanceResult.url;
          didEnhance = true;
          console.log(`[upscale-pro] AI quality enhance applied after ONNX upscale`);
        } else {
          console.log(`[upscale-pro] AI enhance skipped/failed, using raw ONNX result`);
        }
      } catch (enhanceErr) {
        console.warn('[upscale-pro] AI enhance error:', enhanceErr instanceof Error ? enhanceErr.message : enhanceErr);
      }
    } else {
      console.log(`[upscale-pro] AI enhance skipped by user request`);
    }
    return {
      success: true,
      url: enhancedUrl,
      model: localResult.model,
      strategy: localResult.strategy,
      fallback: !cloudResult ? false : true,
      fallbackReason: cloudResult ? '云端API不可用，已使用本地Real-ESRGAN' : undefined,
      enhanced: didEnhance,
    };
  }

  // 策略3: AI重绘兜底
  if (fallbackToAi) {
    const aiResult = await upscaleViaAI(imageUrl, scale);
    if (aiResult?.url) {
      // AI重绘放大后追加AI画质精修（带关键词约束，修复AI重绘产生的模糊/噪点）
      let enhancedUrl = aiResult.url;
      let didEnhance = false;
      if (!skipAiEnhance) {
        try {
          const enhanceResult = await enhanceViaAI(aiResult.url);
          if (enhanceResult.enhanced && enhanceResult.url) {
            enhancedUrl = enhanceResult.url;
            didEnhance = true;
            console.log(`[upscale-pro] AI quality enhance applied after AI redraw upscale`);
          }
        } catch (enhanceErr) {
          console.warn('[upscale-pro] AI enhance error (strategy 3):', enhanceErr instanceof Error ? enhanceErr.message : enhanceErr);
        }
      }
      return {
        success: true,
        url: enhancedUrl,
        model: aiResult.model,
        strategy: aiResult.strategy,
        fallback: true,
        fallbackReason: '云端和本地无损放大均不可用，已使用AI重绘放大',
        enhanced: didEnhance,
      };
    }
  }

  return { success: false, error: '所有放大策略均失败：云端API(PearAPI/fal.ai)不可用、本地放大服务未启动' };
}
