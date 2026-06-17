// ============================================================
// POST /api/image/upscale-pro — 无损放大（云端 Real-ESRGAN / SeedVR2）
// 调用 PearAPI /api/photo-enhancer 专用无损放大接口
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
  scale?: 2 | 4;       // 放大倍率（仅 Real-ESRGAN 支持）
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as UpscaleProRequest;
    const { imageUrl, model = 'Real-ESRGAN', face = false, scale } = body;

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

    // 查找 PearAPI Key
    const pearConfig = await findPearApiKey();
    if (!pearConfig) {
      return NextResponse.json(
        { success: false, error: '未配置 PearAPI 密钥，无法使用云端无损放大。请在管理员后台添加 PearAPI 提供商，或设置 PEAR_API_KEY 环境变量。' },
        { status: 400 },
      );
    }

    // 构建请求
    const requestBody: Record<string, unknown> = {
      image: imageUrl,
      face,
      key: pearConfig.apiKey,
      model,
      task_type: 'sync',
    };

    // Real-ESRGAN 可指定放大倍率 (SeedVR2 自动决定)
    if (model === 'Real-ESRGAN' && scale) {
      requestBody.scale = scale;
    }

    console.log(`[upscale-pro] Calling PearAPI photo-enhancer: model=${model}, face=${face}, scale=${scale || 'auto'}`);

    // 调用 PearAPI /api/photo-enhancer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5分钟超时

    let pearRes: Response;
    try {
      pearRes = await fetch(`${pearConfig.baseUrl}/api/photo-enhancer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchErr: unknown) {
      clearTimeout(timeout);
      const err = fetchErr as Error;
      if (err.name === 'AbortError') {
        return NextResponse.json(
          { success: false, error: '云端无损放大超时，请稍后重试' },
          { status: 504 },
        );
      }
      return NextResponse.json(
        { success: false, error: `云端放大请求失败: ${err.message}` },
        { status: 502 },
      );
    }
    clearTimeout(timeout);

    const pearData = await pearRes.json() as Record<string, unknown>;

    // PearAPI 返回格式: { code: 200, msg: "...", data: { image_url: "..." } }
    if (pearData.code !== 200 || !pearData.data) {
      const errMsg = pearData.msg || pearData.error || `PearAPI 返回错误 (code=${pearData.code})`;
      console.error('[upscale-pro] PearAPI error:', pearData);
      return NextResponse.json(
        { success: false, error: `云端无损放大失败: ${errMsg}` },
        { status: 502 },
      );
    }

    const resultData = pearData.data as Record<string, unknown>;
    const resultImageUrl = resultData.image_url as string;

    if (!resultImageUrl) {
      return NextResponse.json(
        { success: false, error: '云端放大未返回结果图片' },
        { status: 502 },
      );
    }

    // 持久化结果图片到本地/S3
    let persistedUrl = resultImageUrl;
    try {
      const baseUrl = process.env.DEPLOY_RUN_PORT
        ? `http://localhost:${process.env.DEPLOY_RUN_PORT}`
        : 'http://localhost:5000';
      const persistResp = await fetch(`${baseUrl}/api/save-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: resultImageUrl,
          prefix: 'upscale-pro',
        }),
      });
      if (persistResp.ok) {
        const persistData = await persistResp.json() as Record<string, unknown>;
        if (persistData.url) {
          persistedUrl = persistData.url as string;
          console.log(`[upscale-pro] Persisted: ${resultImageUrl.slice(0, 60)}... → ${persistedUrl}`);
        }
      }
    } catch (persistErr) {
      console.warn('[upscale-pro] Persist failed, using remote URL:', persistErr);
    }

    console.log(`[upscale-pro] Success: model=${model}, result=${persistedUrl.slice(0, 80)}`);

    return NextResponse.json({
      success: true,
      url: persistedUrl,
      model,
      originalUrl: resultImageUrl,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[upscale-pro] Error:', msg);
    return NextResponse.json(
      { success: false, error: `无损放大失败: ${msg}` },
      { status: 500 },
    );
  }
}
