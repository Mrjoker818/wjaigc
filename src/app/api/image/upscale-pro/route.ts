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

/** 支持的无损放大模型 */
type UpscaleProModel = 'Real-ESRGAN' | 'SeedVR2-Upscaler';

interface UpscaleProRequest {
  imageUrl: string;
  model?: UpscaleProModel;
  face?: boolean;       // 是否含人脸，增强人脸细节
  scale?: 2 | 4;       // 放大倍率
  fallbackToAi?: boolean; // 云端和本地都失败时是否用AI重绘兜底（默认true）
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
      // 返回 taskId，前端需要轮询
      return { url: '', model: 'AI-redraw', strategy: 'ai-async' };
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

/** 画质优化提示词：放大后AI精修，仅做画质修复不做内容改动 */
const QUALITY_ENHANCE_PROMPT = `修复这张放大后的图片，使画面变得锐利高清、写实质感。严格遵循以下要求：

【核心修复目标】将模糊低清图片修复为锐利、高清、写实质感画面，完整保留原图人物/景物/动物的五官、神态、动作、构图、拍摄角度、服饰、背景、光影氛围等全部原始内容。

【画质优化要求】
1. 提升分辨率，补齐画面细节，强化纹理质感；
2. 消除压缩噪点、像素模糊、画面发灰发白、过软发虚等瑕疵；
3. 还原自然真实色彩，明暗对比柔和自然，避免过度锐化、磨皮、失真；
4. 真实还原皮肤肌理、毛发、眼睛、布料、背景景物细节，不改动原图轮廓与内容。

【画面限制规范】禁止过度修图、平滑磨皮、美颜滤镜；禁止生成不存在的画面元素；杜绝人工虚假锐化、画面失真怪异问题，确保修复效果自然真实。

【画面干净度要求】clean illustration, smooth shading, soft lighting, controlled details, minimal texture, high clarity, refined edges, smooth gradients -- no noise, grain, artifacts, high frequency detail, dirty texture, oversharpen, blotchy, chaotic details`;

/** 最大公约数（用于计算画面比例） */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** 策略2.5: AI画质优化（ONNX/云端放大后精修） */
async function enhanceViaAI(
  imageUrl: string,
): Promise<{ url: string; model: string } | null> {
  console.log(`[upscale-pro] Post-enhance: AI quality refinement`);
  const enhanceStart = Date.now();

  try {
    const baseUrl = process.env.DEPLOY_RUN_PORT
      ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
      : 'http://localhost:5000';

    // 读取放大后图片的尺寸，计算正确的画面比例
    let aspectRatio = '1:1';
    try {
      const sharp = await import('sharp');
      const imgResp = await fetch(imageUrl.startsWith('/') ? `${baseUrl}${imageUrl}` : imageUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (imgResp.ok) {
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const metadata = await sharp.default(imgBuf).metadata();
        if (metadata.width && metadata.height) {
          const g = gcd(metadata.width, metadata.height);
          aspectRatio = `${metadata.width / g}:${metadata.height / g}`;
          console.log(`[upscale-pro] AI enhance: image ${metadata.width}x${metadata.height}, ratio=${aspectRatio}`);
        }
      }
    } catch {
      // 尺寸检测失败，使用默认1:1
    }

    // 使用 /api/generate 以参考图模式调用，确保只做画质修复不做内容改动
    // referenceMode: 'reference' → 路由到 /images/generations 端点，只参考不编辑
    // referenceCategories + referenceStrengths → 指导AI保留所有维度
    const enhanceRes = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: QUALITY_ENHANCE_PROMPT,
        referenceImages: [imageUrl],
        referenceMode: 'reference',
        referenceCategories: { '0': ['style', 'composition', 'scene', 'color', 'subject', 'detail'] },
        referenceStrengths: [90], // 高强度：尽可能保留原图内容，仅修复画质
        n: 1,
        quality: 'high',
        aspectRatio,
      }),
      signal: AbortSignal.timeout(180_000), // 3分钟超时
    });

    if (!enhanceRes.ok) {
      console.warn(`[upscale-pro] AI enhance returned ${enhanceRes.status}`);
      return null;
    }

    const enhanceData = await enhanceRes.json() as Record<string, unknown>;

    // 异步任务（generate返回taskIds）
    const taskIds = enhanceData.taskIds as string[] | undefined;
    if (taskIds && taskIds.length > 0) {
      const taskId = taskIds[0];
      console.log(`[upscale-pro] AI enhance submitted as async: ${taskId}, polling...`);
      const maxPollTime = 150_000; // 最多等2.5分钟
      const pollStart = Date.now();
      while (Date.now() - pollStart < maxPollTime) {
        await new Promise(r => setTimeout(r, 3000)); // 每3秒查一次
        const pollRes = await fetch(`${baseUrl}/api/poll-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        if (pollRes.ok) {
          const pollData = await pollRes.json() as Record<string, unknown>;
          if (pollData.status === 'completed' && pollData.imageUrl) {
            const persistedUrl = await persistResult(pollData.imageUrl as string);
            const elapsed = ((Date.now() - enhanceStart) / 1000).toFixed(1);
            console.log(`[upscale-pro] AI enhance success (${elapsed}s): ${persistedUrl.slice(0, 80)}`);
            return { url: persistedUrl, model: 'AI-enhance' };
          }
          if (pollData.status === 'failed' || pollData.status === 'cancelled') {
            console.warn(`[upscale-pro] AI enhance task ${pollData.status}`);
            return null;
          }
        }
      }
      console.warn(`[upscale-pro] AI enhance polling timeout`);
      return null;
    }

    // 同步返回结果
    const resultUrl = (enhanceData.url as string) || (enhanceData.imageUrl as string) || '';
    if (resultUrl && (resultUrl.startsWith('http') || resultUrl.startsWith('/') || resultUrl.startsWith('data:'))) {
      const persistedUrl = await persistResult(resultUrl);
      const elapsed = ((Date.now() - enhanceStart) / 1000).toFixed(1);
      console.log(`[upscale-pro] AI enhance success (${elapsed}s): ${persistedUrl.slice(0, 80)}`);
      return { url: persistedUrl, model: 'AI-enhance' };
    }

    console.warn(`[upscale-pro] AI enhance unexpected response:`, JSON.stringify(enhanceData).slice(0, 200));
    return null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] AI enhance error: ${errMsg}`);
    return null;
  }
}

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
      // 云端放大后也做AI画质优化
      const enhanceResult = await enhanceViaAI(cloudResult.url);
      if (enhanceResult?.url) {
        return NextResponse.json({
          success: true,
          url: enhanceResult.url,
          model: `${cloudResult.model}+${enhanceResult.model}`,
          strategy: 'cloud+ai-enhance',
          enhanced: true,
        });
      }
      // AI优化失败，回退到云端原始结果
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
      const enhanceResult = await enhanceViaAI(localResult.url);
      if (enhanceResult?.url) {
        return NextResponse.json({
          success: true,
          url: enhanceResult.url,
          model: `${localResult.model}+${enhanceResult.model}`,
          strategy: 'onnx+ai-enhance',
          fallback: !cloudResult ? false : true,
          fallbackReason: cloudResult ? '云端API不可用，已使用本地Real-ESRGAN+AI精修' : undefined,
          enhanced: true,
        });
      }
      // AI画质优化失败，回退到未优化的ONNX结果
      console.log(`[upscale-pro] AI enhance skipped/failed, returning raw ONNX result`);
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
        // AI放大后画质也较差，同样追加AI精修
        const enhancedResult = await enhanceViaAI(aiResult.url);
        if (enhancedResult?.url) {
          return NextResponse.json({
            success: true,
            url: enhancedResult.url,
            model: `${aiResult.model}+${enhancedResult.model}`,
            strategy: 'ai-redraw+ai-enhance',
            enhanced: true,
            fallback: true,
            fallbackReason: '已使用AI重绘放大并精修画质',
          });
        }
        // 精修失败，返回AI重绘结果
        return NextResponse.json({
          success: true,
          url: aiResult.url,
          model: aiResult.model,
          strategy: aiResult.strategy,
          fallback: true,
          fallbackReason: '云端和本地无损放大均不可用，已使用AI重绘放大（内容可能有变化）',
        });
      }
      // AI返回了taskId（异步任务）
      if (aiResult?.strategy === 'ai-async') {
        return NextResponse.json({
          success: true,
          requiresPolling: true,
          model: aiResult.model,
          strategy: aiResult.strategy,
          fallback: true,
          fallbackReason: '云端和本地无损放大均不可用，已提交AI重绘放大（内容可能有变化）',
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
