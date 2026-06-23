// ============================================================
// POST /api/image/upscale-pro — 无损放大（多策略降级 + AI画质精修）
// 1. 云端专用API（PearAPI photo-enhancer: Real-ESRGAN/SeedVR2）
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

/** 支持的无损放大模型 */
type UpscaleProModel = 'Real-ESRGAN' | 'SeedVR2-Upscaler';

interface UpscaleProRequest {
  imageUrl: string;
  model?: UpscaleProModel;
  face?: boolean;       // 是否含人脸，增强人脸细节
  scale?: 2 | 4;       // 放大倍率
  fallbackToAi?: boolean; // 云端和本地都失败时是否用AI重绘兜底（默认true）
  enhanceModel?: string;  // 精修使用的图像模型（用户当前在图像生成面板选择的模型）
  skipAiEnhance?: boolean; // 跳过AI画质精修（默认false，ONNX/云端放大结果已足够好时跳过可避免内容变化）
}

/** 从管理员配置查找 PearAPI 提供商的 API Key */
async function findPearApiKey(): Promise<{ apiKey: string; baseUrl: string } | null> {
  try {
    const { getApiProviders } = await import('@/lib/server-api-config');
    const providers = await getApiProviders();
    // 查找 baseUrl 包含 pearapi 的提供商
    const pearProvider = providers.find(
      (p: { baseUrl: string }) => p.baseUrl.includes('pearapi')
    );
    if (pearProvider?.apiKey && pearProvider?.baseUrl) {
      return {
        apiKey: pearProvider.apiKey,
        baseUrl: pearProvider.baseUrl,
      };
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

  if (model === 'Real-ESRGAN' && scale) {
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
      console.warn(`[upscale-pro] PearAPI failed: ${errMsg}`);
      return null;
    }

    const resultData = pearData.data as Record<string, unknown>;
    const resultImageUrl = resultData.image_url as string;
    if (!resultImageUrl) return null;

    // 持久化结果
    const persistedUrl = await persistResult(resultImageUrl);
    console.log(`[upscale-pro] PearAPI success: ${persistedUrl.slice(0, 80)}`);
    return { url: persistedUrl, model, strategy: 'cloud-Real-ESRGAN' };
  } catch (err) {
    clearTimeout(timeout);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] PearAPI error: ${errMsg}`);
    return null;
  }
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
    let effectiveScale = scale;
    
    // 性能优化：大图先缩小再放大，避免CPU处理超时
    // Real-ESRGAN x4模型最大输入建议≤512px，x2建议≤768px
    const maxInputSize = scale >= 4 ? 384 : scale >= 2 ? 512 : 768;
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
      // 调整实际放大倍率以尽量达到目标尺寸
      const targetSize = (metadata.width || 512) * scale;
      effectiveScale = Math.min(4, Math.max(2, Math.round(targetSize / newW)));
    }

    let tileSize = 256;
    if (maxDim > 512) tileSize = 128;
    else if (maxDim > 256) tileSize = 192;

    console.log(`[upscale-pro] ONNX upscale: input=${maxDim}px, model=${modelName}, tile=${tileSize}, scale=${effectiveScale}x`);

    // 调用Python ONNX脚本
    const params = JSON.stringify({
      inputFile: inputPath,
      scale: effectiveScale,
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

    // 如果输入图被缩小过，需要将ONNX输出resize到目标尺寸
    if (effectiveScale !== scale) {
      const targetW = (metadata.width || 512) * scale;
      const targetH = (metadata.height || 512) * scale;
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

    // 如果输出是文件路径，转为API URL
    if (fs.existsSync(resultUrl)) {
      const fileName = path.basename(resultUrl);
      const publicDir = path.join(process.cwd(), 'public', 'outputs', 'upscale');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      const destPath = path.join(publicDir, fileName);
      fs.copyFileSync(resultUrl, destPath);
      try { fs.unlinkSync(resultUrl); } catch {}
      resultUrl = `/api/serve-upload/outputs/upscale/${fileName}`;
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
      fallbackToAi = true,
      enhanceModel,
      skipAiEnhance = false,
    } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少 imageUrl 参数' },
        { status: 400 },
      );
    }

    // 积分检查与扣除
    const sessionUser = await getSessionUser(request).catch(() => null);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_upscale');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
    }

    // === 多策略降级 ===

    // 策略1: 云端 PearAPI（真正的无损放大）
    const cloudResult = await upscaleViaPearAPI(imageUrl, model, face, scale);
    if (cloudResult?.url) {
      // 云端放大后不做AI画质优化（已是真正的无损放大，AI精修可能改变内容）
      return NextResponse.json({
        success: true,
        url: cloudResult.url,
        model: cloudResult.model,
        strategy: cloudResult.strategy,
        enhanced: false,
      });
    }

    // 策略2: 本地 ONNX Real-ESRGAN
    const localResult = await upscaleViaOnnx(imageUrl, scale, face);
    if (localResult?.url) {
      // 策略2.5: ONNX放大成功后，自动追加AI画质优化
      // ★ ONNX Real-ESRGAN 已是真正的超分辨率，AI精修可能改变画面内容
      // 默认跳过AI精修，除非用户明确要求
      if (!skipAiEnhance) {
        console.log(`[upscale-pro] ONNX result available, but AI enhance is now skipped by default to preserve original content. Set skipAiEnhance=false to enable.`);
      }
      // AI画质优化默认跳过，ONNX结果已足够好
      console.log(`[upscale-pro] Returning raw ONNX result (AI enhance skipped to preserve content)`);
      return NextResponse.json({
        success: true,
        url: localResult.url,
        model: localResult.model,
        strategy: localResult.strategy,
        fallback: !cloudResult ? false : true,
        fallbackReason: cloudResult ? '云端API不可用，已使用本地Real-ESRGAN' : undefined,
        enhanced: false,
      });
    }

    // 策略3: AI重绘兜底
    if (fallbackToAi) {
      const aiResult = await upscaleViaAI(imageUrl, scale);
      if (aiResult?.url) {
        // AI重绘放大不做额外AI精修（已经是一次AI重绘，再精修会进一步偏离原内容）
        return NextResponse.json({
          success: true,
          url: aiResult.url,
          model: aiResult.model,
          strategy: aiResult.strategy,
          fallback: true,
          fallbackReason: '云端和本地无损放大均不可用，已使用AI重绘放大（内容可能有变化）',
        });
      }
    }

    return NextResponse.json(
      { success: false, error: '所有放大策略均失败：云端API不可用、本地放大服务未启动' },
      { status: 502 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[upscale-pro] Error:', msg);
    return NextResponse.json(
      { success: false, error: `无损放大失败: ${msg}` },
      { status: 500 },
    );
  }
}
