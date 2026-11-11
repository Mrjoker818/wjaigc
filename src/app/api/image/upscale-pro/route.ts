// ============================================================
// POST /api/image/upscale-pro — 无损放大（多策略降级 + AI画质精修）
// 1a. 云端放大API（PearAPI Real-ESRGAN/SeedVR2，标准 /v1/images/edits 端点）
// 1b. 云端 fal.ai SeedVR2（高质量扩散超分辨率，$0.001/MP）
// 2. 本地 ONNX Real-ESRGAN（CPU分块处理）
// 2.5 AI画质精修（放大后自动追加，修复模糊/噪点/失真）
// 3. AI重绘兜底（图像生成模型放大）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestHeaders, requireApiAuthOrReject } from '@/lib/api-auth';

// 允许最长5分钟（ONNX放大+AI精修可能较慢）
export const maxDuration = 300;
import { enhanceViaAI } from '@/lib/quality-enhance';
import { isOnnxConfigured, ONNX_MODEL, ONNX_WORKER, ONNX_WORKER_ENV, runLocalPython } from '@/lib/image-tools/config';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { saveImageFile } from '@/lib/server-data-root';
import { validateApiInputs } from '@/lib/api-validator';
import { resolveOnnxReportedOutput } from '@/lib/image-tools/onnx-output-boundary';

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
  providerId?: string;    // 精修模型的提供商ID（优先于 enhanceModel 中的 :: 前缀）
  skipAiEnhance?: boolean; // 跳过AI画质精修（默认false，ONNX/云端放大结果已足够好时跳过可避免内容变化）
  originalWidth?: number;  // 原图宽度（用于链式放大精确 resize 到目标尺寸）
  originalHeight?: number; // 原图高度（用于链式放大精确 resize 到目标尺寸）
  projectId?: string;
  assetParentVersionIds?: string[];
  upscaleModel?: string;
}

/** 从管理员配置查找 upscaler 提供商的 API Key 和配置 */
async function findUpscaleProvider(): Promise<{ apiKey: string; baseUrl: string; providerId: string } | null> {
  try {
    const { getApiProviders } = await import('@/lib/server-api-config');
    const providers = await getApiProviders();
    console.log(`[upscale-pro] findUpscaleProvider: ${providers.length} providers, modelTypes: [${providers.map((p: { modelType?: string; name?: string }) => `${p.name}(${p.modelType})`).join(', ')}]`);
    // 优先查找 modelType === 'upscaler' 的提供商（管理员后台专门配置的放大API）
    const upscalerProvider = providers.find(
      (p: { baseUrl?: string; modelType?: string; isEnabled?: boolean }) =>
        p.modelType === 'upscaler' && p.isEnabled !== false
    );
    if (upscalerProvider?.apiKey && upscalerProvider?.baseUrl) {
      return {
        apiKey: upscalerProvider.apiKey,
        baseUrl: upscalerProvider.baseUrl,
        providerId: upscalerProvider.id || '',
      };
    }
    // 兜底：查找包含 pearapi 的 upscaler/image 提供商
    const pearProvider = providers.find(
      (p: { baseUrl?: string; modelType?: string }) =>
        (p.baseUrl || '').includes('pearapi') && (p.modelType === 'upscaler' || p.modelType === 'image' || !p.modelType)
    );
    if (pearProvider?.apiKey && pearProvider?.baseUrl) {
      return {
        apiKey: pearProvider.apiKey,
        baseUrl: pearProvider.baseUrl,
        providerId: pearProvider.id || '',
      };
    }
    // 兜底：查找任意 pearapi 提供商
    const anyPear = providers.find(
      (p: { baseUrl?: string }) => (p.baseUrl || '').includes('pearapi')
    );
    if (anyPear?.apiKey && anyPear?.baseUrl) {
      return { apiKey: anyPear.apiKey, baseUrl: anyPear.baseUrl, providerId: anyPear.id || '' };
    }
  } catch {
    // 忽略，回退到环境变量
  }

  // 环境变量兜底
  const envKey = process.env.PEAR_API_KEY || process.env.PEARAPI_KEY;
  if (envKey) {
    return { apiKey: envKey, baseUrl: 'https://api.pearapi.ai', providerId: '' };
  }
  return null;
}

/** 策略1: 云端放大API（PearAPI /v1/images/generations + /v1/images/edits）
 *  PearAPI 的 Real-ESRGAN 和 SeedVR2-Upscaler 模型使用标准 OpenAI 兼容端点：
 *  - POST /v1/images/generations （带 image 参数作为参考图）
 *  - POST /v1/images/edits （带 image 参数）
 *  认证方式：Authorization: Bearer <apiKey>
 */
async function upscaleViaPearAPI(
  imageUrl: string,
  model: UpscaleProModel,
  face: boolean,
  scale: number | undefined,
  targetWidth?: number,
  targetHeight?: number,
): Promise<{ url: string; model: string; strategy: string } | null> {
  const providerConfig = await findUpscaleProvider();
  if (!providerConfig) {
    console.log('[upscale-pro] No upscale API provider configured, skipping cloud upscale');
    return null;
  }

  // 提供商需要外部可访问的图片URL；转换相对路径为绝对URL
  let accessibleImageUrl = imageUrl;
  if (imageUrl.startsWith('/')) {
    const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    if (domain) {
      const domainBase = domain.startsWith('http') ? domain.replace(/\/+$/, '') : `https://${domain.replace(/\/+$/, '')}`;
      accessibleImageUrl = `${domainBase}${imageUrl}`;
    } else {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      accessibleImageUrl = `http://localhost:${port}${imageUrl}`;
    }
  }

  // PearAPI 放大模型调用说明：
  // - Real-ESRGAN: 使用 /v1/images/edits + multipart form-data 上传图片，不支持自定义 size 参数（auto size）
  // - SeedVR2-Upscaler: PearAPI 当前不支持通过标准端点调用此模型（返回"仅支持图生视频"错误），
  //   需要等待 PearAPI 修复或提供正确的调用方式
  const prompt = model === 'SeedVR2-Upscaler'
    ? 'Upscale and enhance this image to higher resolution. Restore details, reduce noise and blur, improve clarity while maintaining the original composition and content exactly.'
    : 'Enhance and upscale this image. Improve details and sharpness while preserving the original content and composition.';

  // SeedVR2-Upscaler 在 PearAPI 上当前不可用，直接跳过云端路径
  if (model === 'SeedVR2-Upscaler') {
    console.log('[upscale-pro] SeedVR2-Upscaler is not supported via PearAPI standard endpoints yet, skipping cloud upscale');
    return null;
  }

  // Real-ESRGAN 不需要传 size 参数，PearAPI 会根据输入图片自动计算输出尺寸
  // 传 size 参数会导致 "Invalid size" 错误

  console.log(`[upscale-pro] Strategy 1: Cloud upscale API (model=${model}, auto-size)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const baseUrl = providerConfig.baseUrl.replace(/\/+$/, '');
    let resultImageUrl: string | null = null;

    // 下载原始图片到 Buffer，用于 multipart 上传
    console.log(`[upscale-pro] Downloading image for multipart upload: ${accessibleImageUrl.slice(0, 100)}`);
    const imgResponse = await fetchWithRetry(accessibleImageUrl, { signal: controller.signal });
    if (!imgResponse.ok) {
      throw new Error(`Failed to download image for upload: ${imgResponse.status}`);
    }
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const imgContentType = imgResponse.headers.get('content-type') || 'image/png';
    const imgExt = imgContentType.includes('jpeg') || imgContentType.includes('jpg') ? 'jpg' : 'png';
    const imgFilename = `image.${imgExt}`;

    // 尝试 1: /v1/images/edits 端点 (multipart form-data, 标准图片编辑端点)
    // 注意：不传 size 参数，让 PearAPI 根据输入图片自动计算输出尺寸（传 size 会导致 Invalid size 错误）
    const editsUrl = `${baseUrl}/v1/images/edits`;
    const editsForm = new FormData();
    editsForm.append('model', model);
    editsForm.append('prompt', prompt);
    editsForm.append('image', new Blob([imgBuffer], { type: imgContentType }), imgFilename);

    console.log(`[upscale-pro] Trying /v1/images/edits with multipart form-data`);
    const editsRes = await fetchWithRetry(editsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerConfig.apiKey}`,
      },
      body: editsForm,
      signal: controller.signal,
    });

    if (editsRes.ok) {
      const editsData = await editsRes.json() as Record<string, unknown>;
      resultImageUrl = extractImageUrlFromResponse(editsData);
      if (!resultImageUrl && editsData.task_id) {
        resultImageUrl = await pollForImageUrl(baseUrl, editsData.task_id as string, providerConfig.apiKey, controller.signal);
      }
    } else {
      const editsErrText = await editsRes.text().catch(() => '');
      const editsRejected = isEditsEndpointRejected(editsRes.status, editsErrText);
      console.warn(`[upscale-pro] /v1/images/edits failed (${editsRes.status}): ${editsErrText.slice(0, 300)}`);

      // 尝试 2: /v1/images/generations 端点 (multipart form-data, 部分 API 支持)
      if (editsRejected) {
        const genUrl = `${baseUrl}/v1/images/generations`;
        const genForm = new FormData();
        genForm.append('model', model);
        genForm.append('prompt', prompt);
        genForm.append('image', new Blob([imgBuffer], { type: imgContentType }), imgFilename);

        console.log(`[upscale-pro] Trying /v1/images/generations with multipart form-data`);
        const genRes = await fetchWithRetry(genUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${providerConfig.apiKey}`,
          },
          body: genForm,
          signal: controller.signal,
        });

        if (genRes.ok) {
          const genData = await genRes.json() as Record<string, unknown>;
          resultImageUrl = extractImageUrlFromResponse(genData);
          if (!resultImageUrl && genData.task_id) {
            resultImageUrl = await pollForImageUrl(baseUrl, genData.task_id as string, providerConfig.apiKey, controller.signal);
          }
        } else {
          const genErrText = await genRes.text().catch(() => '');
          console.warn(`[upscale-pro] /v1/images/generations failed (${genRes.status}): ${genErrText.slice(0, 300)}`);
        }
      }
    }

    clearTimeout(timeout);

    if (!resultImageUrl) {
      console.warn('[upscale-pro] Cloud upscale API: no image URL in response');
      return null;
    }

    // ★ 精确resize：云端API返回的图片尺寸可能不精确匹配目标
    let finalUrl = resultImageUrl;
    if (targetWidth && targetHeight && targetWidth > 0 && targetHeight > 0) {
      finalUrl = await resizeToTarget(resultImageUrl, targetWidth, targetHeight);
    }

    // 持久化结果
    const persistedUrl = await persistResult(finalUrl);
    console.log(`[upscale-pro] Cloud upscale API success: ${persistedUrl.slice(0, 80)}`);
    return { url: persistedUrl, model, strategy: 'cloud-Real-ESRGAN' };
  } catch (err) {
    clearTimeout(timeout);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[upscale-pro] Cloud upscale API error: ${errMsg}`);
    return null;
  }
}

/** 从标准 OpenAI 图像 API 响应中提取图片 URL */
function extractImageUrlFromResponse(data: Record<string, unknown>): string | null {
  // 标准格式: { data: [{ url: "..." }] } 或 { data: [{ b64_json: "..." }] }
  const dataArray = data.data as Array<Record<string, unknown>> | undefined;
  if (dataArray && Array.isArray(dataArray) && dataArray.length > 0) {
    const firstItem = dataArray[0];
    if (firstItem.url && typeof firstItem.url === 'string') {
      return firstItem.url;
    }
    if (firstItem.b64_json && typeof firstItem.b64_json === 'string') {
      return `data:image/png;base64,${firstItem.b64_json}`;
    }
  }
  // PearAPI 特殊格式: { image_url: "..." }
  if (data.image_url && typeof data.image_url === 'string') {
    return data.image_url;
  }
  // 旧 PearAPI 格式: { code: 200, data: { image_url: "..." } }
  if (data.code === 200 && data.data) {
    const innerData = data.data as Record<string, unknown>;
    if (innerData.image_url && typeof innerData.image_url === 'string') {
      return innerData.image_url;
    }
  }
  // output 字段
  if (data.output && typeof data.output === 'string') {
    return data.output;
  }
  return null;
}

/** 检测 /images/edits 端点是否被拒绝（404/405/422 等） */
function isEditsEndpointRejected(status: number, body: string): boolean {
  if (status === 404 || status === 405) return true;
  if (status === 422 || status === 400) {
    const lower = body.toLowerCase();
    return lower.includes('not found') || lower.includes('not supported') ||
           lower.includes('does not support') || lower.includes('unsupported') ||
           lower.includes('invalid endpoint') || lower.includes('no route');
  }
  // PearAPI 返回 500 + "该模型仅支持图生视频"时，说明 /images/edits 不支持 JSON 方式传图
  if (status === 500) {
    const lower = body.toLowerCase();
    return lower.includes('图生视频') || lower.includes('图生图') ||
           lower.includes('请上传参考图') || lower.includes('upload') ||
           lower.includes('reference image');
  }
  return false;
}

/** 带重试的 fetch（3次重试，指数退避） */
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        console.log(`[upscale-pro] Fetch retry ${i + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error('Fetch failed after retries');
}

/** 轮询异步任务直到获取图片URL */
async function pollForImageUrl(
  baseUrl: string,
  taskId: string,
  apiKey: string,
  signal: AbortSignal,
  maxPolls = 60,
): Promise<string | null> {
  const pollUrl = `${baseUrl}/v1/tasks/${taskId}`;
  for (let i = 0; i < maxPolls; i++) {
    if (signal.aborted) return null;
    await new Promise(r => setTimeout(r, 3000)); // 3秒轮询间隔
    try {
      const res = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal,
      });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const imageUrl = extractImageUrlFromResponse(data);
        if (imageUrl) return imageUrl;
        // 检查任务状态
        const status = data.status as string;
        if (status === 'failed' || status === 'error') {
          console.warn(`[upscale-pro] Poll task ${taskId} failed: ${data.error || data.message || 'unknown'}`);
          return null;
        }
        // status === 'processing' | 'pending' | 'queued' → continue polling
      }
    } catch {
      // 网络错误，继续轮询
    }
  }
  console.warn(`[upscale-pro] Poll task ${taskId} timed out after ${maxPolls} attempts`);
  return null;
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
): Promise<{ url: string; model: string; strategy: string } | null> {
  if (!Number.isInteger(scale) || scale < 2 || scale > 4 || !await isOnnxConfigured()) return null;

  let workDir: string | undefined;
  try {
    const { lstat, mkdtemp, readFile, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { randomUUID } = await import('node:crypto');
    const { default: path } = await import('node:path');
    const { default: sharp } = await import('sharp');
    const buffer = await fetchImageBuffer(imageUrl, { maxBytes: 20 * 1024 * 1024 });
    const source = sharp(buffer, { limitInputPixels: 64 * 1024 * 1024 });
    const { width, height } = await source.metadata();
    if (!width || !height || width * height * scale ** 2 > 64 * 1024 * 1024) return null;

    workDir = await mkdtemp(path.join(tmpdir(), 'wujie-upscale-'));
    const inputFile = path.join(workDir, 'input.png');
    const outputFile = path.join(workDir, 'output.png');
    const prepared = await source.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    await writeFile(inputFile, prepared.data);
    const output = JSON.parse(await runLocalPython([ONNX_WORKER], {
      timeout: 120_000,
      input: JSON.stringify({ inputFile, outputFile, scale: 4, model: ONNX_MODEL }),
      env: ONNX_WORKER_ENV,
    }));
    const reported = output?.success === true && output.model === ONNX_MODEL
      ? resolveOnnxReportedOutput(output, outputFile) : null;
    if (reported?.kind !== 'file') return null;
    const file = await lstat(reported.path);
    if (!file.isFile() || file.size > 64 * 1024 * 1024) return null;
    const result = sharp(await readFile(reported.path), { limitInputPixels: 4096 ** 2 });
    const metadata = await result.metadata();
    if (metadata.format !== 'png' || metadata.width !== prepared.info.width * 4
      || metadata.height !== prepared.info.height * 4) return null;
    const resized = await result.resize(width * scale, height * scale, { fit: 'fill' }).png().toBuffer();
    const url = saveImageFile(resized, `upscale-onnx-${randomUUID()}.png`, 'uploads/upscale');
    return { url, model: `ONNX-${ONNX_MODEL}`, strategy: 'local-Real-ESRGAN' };
  } catch {
    console.warn('[upscale-pro] Local ONNX fallback failed or was busy');
    return null;
  } finally {
    if (workDir) {
      const { rm } = await import('node:fs/promises');
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** 策略3: AI重绘放大 */
async function upscaleViaAI(
  request: NextRequest,
  originalBody: UpscaleProRequest,
  imageUrl: string,
  scale: number,
): Promise<{ url: string; model: string; strategy: string; taskId?: string; enhanced?: boolean } | { response: NextResponse } | null> {
  console.log(`[upscale-pro] Strategy 3: AI redraw upscale (scale=${scale}x)`);

  try {
    const { POST: imageEditPost } = await import('@/app/api/image-edit/route');
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const aiRes = await imageEditPost(new NextRequest(new URL('/api/image-edit', request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'upscale',
        imageUrl,
        scale,
        upscaleMode: 'ai',
        engine: 'ai',
        projectId: originalBody.projectId,
        assetParentVersionIds: originalBody.assetParentVersionIds,
        upscaleModel: originalBody.upscaleModel,
        enableQualityEnhance: !originalBody.skipAiEnhance,
        enhanceModel: originalBody.enhanceModel,
        enhanceProviderId: originalBody.providerId,
      }),
    }));

    if (aiRes.status === 202 || !aiRes.ok) {
      return { response: aiRes };
    }

    const aiData = await aiRes.json() as Record<string, unknown>;
    if (aiData.success === true && typeof aiData.taskId === 'string'
      && !aiData.url && !aiData.imageUrl && !aiData.resultUrl
      && !['completed', 'failed', 'cancelled', 'timeout'].includes(String(aiData.status || ''))) {
      // image-edit 的幂等重放可用 HTTP 200 返回仍在处理的持久任务。
      return { response: NextResponse.json(aiData, { status: 202 }) };
    }
    if (aiData.success && aiData.url) {
      console.log(`[upscale-pro] AI upscale success: ${(aiData.url as string).slice(0, 80)}`);
      return { url: aiData.url as string, model: 'AI-redraw', strategy: 'ai-redraw',
        taskId: typeof aiData.taskId === 'string' ? aiData.taskId : undefined,
        enhanced: aiData.enhanced === true };
    }

    // 检查AI重绘返回的imageUrl (可能是http URL或data: URL)
    const aiImageUrl = (aiData.imageUrl as string) || (aiData.resultUrl as string) || '';
    if (aiImageUrl) {
      return { url: aiImageUrl, model: 'AI-redraw', strategy: 'ai-redraw',
        taskId: typeof aiData.taskId === 'string' ? aiData.taskId : undefined,
        enhanced: aiData.enhanced === true };
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
      headers: { 'Content-Type': 'application/json', ...(await getInternalRequestHeaders('system-save-image', 'admin')) },
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
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json() as UpscaleProRequest;
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      imageUrl,
      model = 'Real-ESRGAN',
      face = false,
      scale = 2,
      targetScale,
      fallbackToAi = true,
      enhanceModel,
      providerId,
      skipAiEnhance = false,
      originalWidth,
      originalHeight,
    } = body;

    // 从 enhanceModel 中提取 providerId（如果 enhanceModel 含 ::）
    const extractedEnhanceProviderId = enhanceModel?.includes('::') ? enhanceModel.split('::')[0] : undefined;
    const effectiveProviderId = providerId || extractedEnhanceProviderId || undefined;

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
      // 链式放大当前没有持久化的异步第二步编排；不能先收费提交 AI 任务再丢弃首步 taskId。
      const chainFailure = (failed: Record<string, unknown>): NextResponse => NextResponse.json(
        fallbackToAi ? { ...failed, code: 'UPSCALE_CHAIN_ASYNC_FALLBACK_UNAVAILABLE',
          error: '链式放大需要异步续接，当前云端和本地策略未能完成；AI 兜底未提交任务或扣费' } : failed,
        { status: 502 },
      );
      // 第一步：使用当前 scale（通常 4×）
      const firstPassResult = await performUpscaleChain(imageUrl, model, face, scale, false, skipAiEnhance,
        originalWidth ? originalWidth * scale : undefined, originalHeight ? originalHeight * scale : undefined,
        enhanceModel, effectiveProviderId, request, body);
      if (!firstPassResult.success || !firstPassResult.url) {
        return chainFailure(firstPassResult);
      }
      // 第二步：对第一步结果再做 (targetScale/scale)× 放大
      const secondScale = targetScale / scale; // 如 8/4=2
      console.log(`[upscale-pro] Chain upscale: second pass ${secondScale}× on first result...`);
      const secondPassResult = await performUpscaleChain(
        firstPassResult.url as string, model, face, Math.min(4, Math.max(2, Math.round(secondScale))), false, skipAiEnhance,
        originalWidth ? Math.round(originalWidth * targetScale) : undefined, originalHeight ? Math.round(originalHeight * targetScale) : undefined,
        enhanceModel, effectiveProviderId, request, body,
      );
      if (!secondPassResult.success || !secondPassResult.url) {
        return chainFailure(secondPassResult);
      }
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
      originalWidth ? originalWidth * scale : undefined, originalHeight ? originalHeight * scale : undefined,
      enhanceModel, effectiveProviderId, request, body,
    );
    if (result.response instanceof NextResponse) return result.response;

    // ★ 最终精确尺寸校验：确保输出图片尺寸 = 原图 × scale
    // A delegated image-edit task already owns its final, size-normalized artifact.
    // Resizing it here would make the HTTP response diverge from the durable task result.
    if (result.success && result.url && !result.taskId && originalWidth && originalHeight) {
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
  enhanceModel?: string,
  enhanceProviderId?: string,
  request?: NextRequest,
  originalBody?: UpscaleProRequest,
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
  const localResult = await upscaleViaOnnx(imageUrl, scale);
  if (localResult?.url) {
    // 策略2.5: ONNX放大后追加AI画质精修（带关键词约束，仅修复画质不改变内容）
    let enhancedUrl = localResult.url;
    let didEnhance = false;
    if (!skipAiEnhance) {
      try {
        const enhanceResult = await enhanceViaAI(localResult.url, enhanceModel, enhanceProviderId);
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
  if (fallbackToAi && request && originalBody) {
    const aiResult = await upscaleViaAI(request, originalBody, imageUrl, scale);
    if (aiResult && 'response' in aiResult) return { response: aiResult.response };
    if (aiResult?.url) {
      return {
        success: true,
        url: aiResult.url,
        model: aiResult.model,
        taskId: aiResult.taskId,
        strategy: aiResult.strategy,
        fallback: true,
        fallbackReason: '云端和本地无损放大均不可用，已使用AI重绘放大',
        enhanced: aiResult.enhanced === true,
      };
    }
  }

  return { success: false, error: '云端放大与已配置的本地 ONNX 策略均未完成放大' };
}
