// ============================================================
// POST /api/image/upscale-pro — 无损放大（多策略降级）
// 1. 云端专用API（PearAPI photo-enhancer: Real-ESRGAN/SeedVR2）
// 2. 本地 upscayl-node（Real-ESRGAN ONNX）
// 3. AI重绘兜底（图像生成模型放大）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
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

/** 策略2: 本地 upscayl-node */
async function upscaleViaLocal(
  imageUrl: string,
  scale: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  console.log(`[upscale-pro] Strategy 2: Local upscayl-node (scale=${scale}x)`);

  try {
    const baseUrl = process.env.DEPLOY_RUN_PORT
      ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
      : 'http://localhost:5000';

    const localRes = await fetch(`${baseUrl}/api/image/upscale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl,
        model: 'realesrgan-x4plus',
        scale,
        outputFormat: 'png',
      }),
    });

    if (!localRes.ok) {
      console.warn(`[upscale-pro] Local upscale returned ${localRes.status}`);
      return null;
    }

    const localData = await localRes.json() as Record<string, unknown>;
    if (!localData.success || !localData.url) {
      console.warn(`[upscale-pro] Local upscale failed: ${localData.error || 'no url'}`);
      return null;
    }

    console.log(`[upscale-pro] Local upscayl success: ${(localData.url as string).slice(0, 80)}`);
    return { url: localData.url as string, model: 'upscayl-Real-ESRGAN', strategy: 'local-upscayl' };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] Local upscayl error: ${errMsg}`);
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
      return NextResponse.json({
        success: true,
        url: cloudResult.url,
        model: cloudResult.model,
        strategy: cloudResult.strategy,
      });
    }

    // 策略2: 本地 upscayl-node
    const localResult = await upscaleViaLocal(imageUrl, scale);
    if (localResult?.url) {
      return NextResponse.json({
        success: true,
        url: localResult.url,
        model: localResult.model,
        strategy: localResult.strategy,
        fallback: true,
        fallbackReason: '云端API不可用，已使用本地Real-ESRGAN',
      });
    }

    // 策略3: AI重绘兜底
    if (fallbackToAi) {
      const aiResult = await upscaleViaAI(imageUrl, scale);
      if (aiResult?.url) {
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
