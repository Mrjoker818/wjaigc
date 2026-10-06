import { createImageEditProviderCall, type ImageEditProviderCallOptions } from '@/lib/image-edit-provider-boundary';
import { parse302UpscaleProviderError } from '@/lib/upscale-provider-error';

/**
 * 302.AI 超级放大 API 适配器
 * 端点: /302/submit/super-upscale-v2
 * 文档: https://302ai.apifox.cn/205808838e0
 */
export async function submit302aiUpscaleTask(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  scale: number = 3,
  creativity: number = 0.2,
  detail: number = 2,
  shapePreservation: number = 0.1,
  promptSuffix: string = ' high quality, highly detailed, high resolution, sharp',
  negativePrompt: string = 'blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisey, grainy',
  options?: ImageEditProviderCallOptions,
): Promise<{ directUrl?: string; width?: number; height?: number; usedModel?: string }> {
  const call = createImageEditProviderCall(options, '302-super-upscale-v2', 'upscale');
  const endpoint = '/302/submit/super-upscale-v2';
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;

  const requestBody = {
    model_type: 'SDXL',
    image_url: imageUrl,
    scale,
    creativity,
    detail,
    shape_preservation: shapePreservation,
    prompt_suffix: promptSuffix,
    negative_prompt: negativePrompt,
    guidance_scale: 7.5,
    num_inference_steps: 20,
    override_size_limits: true,
  };

  console.debug(`[image-edit] 302.AI upscale: POST ${url}, scale=${scale}`);

  const response = await call.transport(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw parse302UpscaleProviderError(response.status, errorText);
  }

  const responseText = await response.text();
  const imageResult = call.parse(() => {
    const result = JSON.parse(responseText);
    console.debug(`[image-edit] 302.AI upscale response keys:`, Object.keys(result));

    // 响应格式: { image: { url, content_type, file_size, width, height }, seed }
    // Fallback: some 302.AI endpoints return { output: "url" } instead
    const directUrl = result.image?.url || (typeof result.output === 'string' ? result.output : undefined);
    if (directUrl) {
      return {
        directUrl,
        width: result.image?.width,
        height: result.image?.height,
        usedModel: '302-super-upscale-v2',
      };
    }

    throw new Error('302.AI upscale response missing image.url or output');
  });
  return await call.acceptImage(imageResult);
}

/**
 * 302.AI Upscale-V6 普通放大 API 适配器
 * 端点: /302/submit/upscale-v6
 * 文档: https://302ai.apifox.cn/373009524e0
 * 特点: 普通放大，无AI想象，价格更便宜（0.05 PTC/次）
 */
export async function submit302aiUpscaleV6Task(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  upscaleFactor: number = 4, // 1-4
  options?: ImageEditProviderCallOptions,
): Promise<{ directUrl?: string; width?: number; height?: number; usedModel?: string }> {
  const call = createImageEditProviderCall(options, '302-upscale-v6', 'upscale');
  const endpoint = '/302/submit/upscale-v6';
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;

  // upscale_factor 范围: 1-4
  const factor = Math.min(4, Math.max(1, upscaleFactor));

  const requestBody = {
    image_url: imageUrl,
    upscale_factor: factor,
  };

  console.debug(`[image-edit] 302.AI upscale-v6: POST ${url}, factor=${factor}`);

  const response = await call.transport(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw parse302UpscaleProviderError(response.status, errorText);
  }

  const responseText = await response.text();
  const imageResult = call.parse(() => {
    const result = JSON.parse(responseText);
    console.debug(`[image-edit] 302.AI upscale-v6 response keys:`, Object.keys(result));

    // 响应格式: { image: { url, content_type, file_size, width, height }, seed }
    // Fallback: some 302.AI endpoints return { output: "url" } instead
    const directUrl = result.image?.url || (typeof result.output === 'string' ? result.output : undefined);
    if (directUrl) {
      return {
        directUrl,
        width: result.image?.width,
        height: result.image?.height,
        usedModel: '302-upscale-v6',
      };
    }

    throw new Error('302.AI upscale-v6 response missing image.url or output');
  });
  return await call.acceptImage(imageResult);
}

/**
 * 302.AI Image Upscale 基础放大 API 适配器
 * 端点: /302/submit/image-upscale
 * 特点: 基础放大，速度快，适合日常使用
 */
export async function submit302aiImageUpscaleTask(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  scale: number = 2,
  options?: ImageEditProviderCallOptions,
): Promise<{ directUrl?: string; width?: number; height?: number; usedModel?: string }> {
  const call = createImageEditProviderCall(options, '302-image-upscale', 'upscale');
  const endpoint = '/302/submit/image-upscale';
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;
  const factor = Math.min(4, Math.max(1, Math.round(scale)));

  const requestBody = {
    image_url: imageUrl,
    upscale_factor: factor,
  };

  console.debug(`[image-edit] 302.AI image-upscale: POST ${url}, factor=${factor}`);

  const response = await call.transport(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw parse302UpscaleProviderError(response.status, errorText);
  }

  const responseText = await response.text();
  const imageResult = call.parse(() => {
    const result = JSON.parse(responseText);
    console.debug(`[image-edit] 302.AI image-upscale response keys:`, Object.keys(result));

    // 响应格式: { image: { url, ... } } or { output: "url" }
    const directUrl = result.image?.url || (typeof result.output === 'string' ? result.output : undefined);
    if (directUrl) {
      return {
        directUrl,
        width: result.image?.width,
        height: result.image?.height,
        usedModel: '302-image-upscale',
      };
    }

    throw new Error('302.AI image-upscale response missing image.url or output');
  });
  return await call.acceptImage(imageResult);
}

/**
 * 302.AI ESRGAN 高清放大 API 适配器
 * 端点: /302/submit/esrgan
 * 特点: ESRGAN高清放大，增强细节和纹理
 */
export async function submit302aiEsrganTask(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  scale: number = 4,
  options?: ImageEditProviderCallOptions,
): Promise<{ directUrl?: string; width?: number; height?: number; usedModel?: string }> {
  const call = createImageEditProviderCall(options, '302-esrgan', 'upscale');
  const endpoint = '/302/submit/esrgan';
  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;
  const factor = Math.min(4, Math.max(2, Math.round(scale)));

  const requestBody = {
    image_url: imageUrl,
    upscale_factor: factor,
  };

  console.debug(`[image-edit] 302.AI esrgan: POST ${url}, factor=${factor}`);

  const response = await call.transport(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw parse302UpscaleProviderError(response.status, errorText);
  }

  const responseText = await response.text();
  const imageResult = call.parse(() => {
    const result = JSON.parse(responseText);
    console.debug(`[image-edit] 302.AI esrgan response keys:`, Object.keys(result));

    // 响应格式: { image: { url, ... } } or { output: "url" }
    const directUrl = result.image?.url || (typeof result.output === 'string' ? result.output : undefined);
    if (directUrl) {
      return {
        directUrl,
        width: result.image?.width,
        height: result.image?.height,
        usedModel: '302-esrgan',
      };
    }

    throw new Error('302.AI esrgan response missing image.url or output');
  });
  return await call.acceptImage(imageResult);
}
