/**
 * AI PSD 模型路由器
 * 复用管理员系统设定的模型，路由图像生成和LLM调用
 *
 * 对照文档: 阶段4-图像生成层 → 1.实现模型路由器
 */

import 'server-only';
import { findProviderForModel, findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, buildPollUrl, extractImageUrl, adjustRequestForProfile } from '@/lib/api-compatibility';
import type { ApiProvider } from '@/lib/universal-api-types';

/** 图像生成结果 */
export interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  imageUrls?: string[];
  error?: string;
  taskId?: string;
}

/** LLM调用结果 */
export interface LLMCallResult {
  success: boolean;
  content?: string;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * 将完整URL拆分为baseUrl和path供fetchWithV1Retry使用
 * fetchWithV1Retry(baseUrl, path, options) 会自动拼接和重试 /v1
 */
function splitUrl(fullUrl: string): { baseUrl: string; path: string } {
  try {
    const u = new URL(fullUrl);
    return { baseUrl: `${u.protocol}//${u.host}`, path: u.pathname + u.search };
  } catch {
    // 如果URL解析失败，尝试简单的拆分
    const idx = fullUrl.indexOf('/', 8); // skip https://
    if (idx > 0) {
      return { baseUrl: fullUrl.slice(0, idx), path: fullUrl.slice(idx) };
    }
    return { baseUrl: fullUrl, path: '/' };
  }
}

/** 获取图像模型提供商 */
export async function getImageProvider(imageModel?: string): Promise<ApiProvider | null> {
  if (imageModel) {
    const provider = await findProviderForModel(imageModel, 'image');
    if (provider) return provider;
  }
  // 回退到默认图像提供商
  return findProviderForFeature('imageEdit');
}

/** 获取LLM模型提供商 */
export async function getLLMProvider(llmModel?: string): Promise<ApiProvider | null> {
  if (llmModel) {
    const provider = await findProviderForModel(llmModel, 'chat');
    if (provider) return provider;
  }
  // 回退到默认聊天提供商
  return findProviderForFeature('chat');
}

/** 调用LLM生成文本（图层规划等） */
export async function callLLM(
  prompt: string,
  systemPrompt: string,
  llmModel?: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<LLMCallResult> {
  const provider = await getLLMProvider(llmModel);
  if (!provider) {
    return { success: false, error: '未找到可用的LLM模型提供商，请在管理员后台配置' };
  }

  const model = llmModel || provider.selectedModels?.[0] || 'gpt-4o';
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');

  try {
    const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // 如果 /chat/completions 失败，尝试 /responses 端点（OpenAI Responses API 格式）
      if (response.status === 403 || response.status === 404 || response.status === 405) {
        console.log(`[ai-psd-model-router] /chat/completions returned ${response.status}, trying /responses endpoint`);
        try {
          const respResponse = await fetchWithV1Retry(baseUrl, '/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
              ],
              max_output_tokens: options?.maxTokens ?? 4096,
              temperature: options?.temperature ?? 0.7,
            }),
          });
          if (respResponse.ok) {
            const respData = await respResponse.json();
            const content = respData.output_text || respData.output?.[0]?.content?.[0]?.text || '';
            if (content) {
              return { success: true, content };
            }
          }
        } catch {
          // /responses 也失败了，继续返回原始错误
        }
      }
      return { success: false, error: `LLM调用失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    // 处理两种响应格式：JSON 和 SSE (某些API即使未请求stream也返回SSE)
    const contentType = response.headers.get('content-type') || '';
    let content = '';
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    if (contentType.includes('text/event-stream')) {
      // SSE 响应：解析流中的 content
      // 读取流时设置超时，避免无限挂起
      const readController = new AbortController();
      const readTimeout = setTimeout(() => readController.abort(), 120_000);
      let text = '';
      try {
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            // 检查是否已收到 [DONE] 标记
            if (text.includes('[DONE]')) break;
          }
        } else {
          text = await response.text();
        }
      } catch {
        // 读取超时，使用已获取的内容
      } finally {
        clearTimeout(readTimeout);
      }
      const lines = text.split('\n');
      let accumulated = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
            // 从最后一个chunk获取usage
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens || 0,
                completionTokens: chunk.usage.completion_tokens || 0,
                totalTokens: chunk.usage.total_tokens || 0,
              };
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
      content = accumulated;
    } else {
      // 标准JSON响应
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        };
      }
    }

    return { success: true, content, usage };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `LLM调用异常: ${message}` };
  }
}

/** 从任意嵌套数据对象中提取图片 URL（通用兜底） */
function extractImageUrlsFromDataObj(obj: Record<string, unknown>, depth = 0): string[] {
  if (depth > 3 || !obj || typeof obj !== 'object') return [];
  const urls: string[] = [];

  // 1. 直接包含的 URL 字段
  for (const key of ['image_url', 'url', 'image_url_optimized', 'src']) {
    const val = obj[key];
    if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('data:'))) {
      urls.push(val);
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))) urls.push(v);
      }
    }
  }

  // 2. image_urls / image_urls_list 数组
  for (const key of ['image_urls', 'image_urls_list']) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && item.startsWith('http')) urls.push(item);
        else if (item && typeof item === 'object') {
          const u = (item as Record<string, unknown>).url || (item as Record<string, unknown>).image_url;
          if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
        }
      }
    }
  }

  // 3. images / results / output / generated_images 数组
  for (const key of ['images', 'results', 'output', 'generated_images']) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('data:'))) urls.push(item);
        else if (item && typeof item === 'object') {
          const u = (item as Record<string, unknown>).url || (item as Record<string, unknown>).image_url || (item as Record<string, unknown>).b64_json;
          if (typeof u === 'string' && u) {
            urls.push(u.startsWith('data:') ? u : (u.startsWith('http') ? u : `data:image/png;base64,${u}`));
          }
        }
      }
    }
  }

  // 4. 递归检查嵌套的 data 对象
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) && depth < 2) {
    urls.push(...extractImageUrlsFromDataObj(obj.data as Record<string, unknown>, depth + 1));
  }

  // 5. 去重
  return [...new Set(urls)];
}

/** 调用图像模型生成图片 */
export async function generateImage(
  prompt: string,
  imageModel?: string,
  options?: {
    size?: string;
    quality?: string;
    n?: number;
    referenceImageUrl?: string;
    strength?: number;
  }
): Promise<ImageGenerationResult> {
  const provider = await getImageProvider(imageModel);
  if (!provider) {
    return { success: false, error: '未找到可用的图像模型提供商，请在管理员后台配置' };
  }

  const model = imageModel || provider.selectedModels?.[0] || 'dall-e-3';
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);

  try {
    const rawBody: Record<string, unknown> = {
      model,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? '1024x1024',
    };

    if (options?.quality) rawBody.quality = options.quality;
    if (options?.referenceImageUrl) {
      rawBody.image = options.referenceImageUrl;
      rawBody.strength = options.strength ?? 0.7;
    }

    // 使用兼容层调整请求体和端点
    const { body, endpoint } = adjustRequestForProfile(rawBody, profile, {
      hasImage: !!options?.referenceImageUrl,
    });

    const response = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `图像生成失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    const data = await response.json();

    // 解析返回的图片URL
    // 标准格式: { data: [{ url, b64_json }] }
    if (data.data && Array.isArray(data.data)) {
      // 异步提交格式: { data: [{ status: "submitted", task_id: "xxx" }] }
      const firstItem = data.data[0] as Record<string, unknown> | undefined;
      if (firstItem?.task_id) {
        return { success: true, taskId: firstItem.task_id as string };
      }

      const urls = data.data
        .map((item: Record<string, unknown>) => item.url || item.b64_json)
        .filter(Boolean) as string[];
      if (urls.length > 0) {
        return { success: true, imageUrl: urls[0], imageUrls: urls };
      }
    }

    // 异步任务模式: data.data 是对象时的 task_id 提取
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      const dataObj = data.data as Record<string, unknown>;
      if (dataObj.task_id || dataObj.id) {
        return { success: true, taskId: (dataObj.task_id || dataObj.id) as string };
      }
      // data.data 中可能直接包含图片 URL（同步返回）
      const urls = extractImageUrlsFromDataObj(dataObj);
      if (urls.length > 0) {
        return { success: true, imageUrl: urls[0], imageUrls: urls };
      }
    }

    // 异步任务模式 (顶层)
    if (data.task_id || data.id) {
      return { success: true, taskId: data.task_id || data.id };
    }

    // apimart 兼容: data.images 数组
    if (data.images && Array.isArray(data.images)) {
      const urls = data.images.map((img: Record<string, unknown>) => img.url || img).filter(Boolean) as string[];
      if (urls.length > 0) {
        return { success: true, imageUrl: urls[0], imageUrls: urls };
      }
    }

    // 深度兜底：从任意嵌套结构中提取图片 URL
    const deepUrls = extractImageUrlsFromDataObj(data);
    if (deepUrls.length > 0) {
      return { success: true, imageUrl: deepUrls[0], imageUrls: deepUrls };
    }

    console.warn('[ai-psd-model-router] Unexpected image API response:', JSON.stringify(data).slice(0, 500));
    return { success: false, error: '图像生成返回格式异常' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `图像生成异常: ${message}` };
  }
}

/** 轮询异步图像任务结果 — 使用 api-compatibility 的 buildPollUrl + extractImageUrl */
export async function pollImageTask(
  taskId: string,
  imageModel?: string,
  maxAttempts: number = 60,
  intervalMs: number = 5000
): Promise<ImageGenerationResult> {
  const provider = await getImageProvider(imageModel);
  if (!provider) {
    return { success: false, error: '未找到可用的图像模型提供商' };
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    try {
      // 1. 尝试使用 api-compatibility 的 buildPollUrl 构建正确的轮询路径
      const pollUrl = buildPollUrl(baseUrl, taskId, profile);

      // 2. 回退路径列表
      const pathsToTry: string[] = [];
      if (pollUrl) {
        // buildPollUrl 返回完整 URL，需要提取 path 部分
        try {
          const urlObj = new URL(pollUrl);
          pathsToTry.push(urlObj.pathname);
        } catch {
          pathsToTry.push(pollUrl.replace(/^https?:\/\/[^/]+/, ''));
        }
      }
      // 添加通用回退路径
      pathsToTry.push(`/images/tasks/${taskId}`, `/tasks/${taskId}`);

      let response: Response | null = null;
      let triedPath = '';

      for (const path of pathsToTry) {
        try {
          triedPath = path;
          response = await fetchWithV1Retry(baseUrl, path, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}` },
          }, false); // 不做 /v1 重试，baseUrl 已含 /v1
          if (response.ok) break;
          console.log(`[ai-psd-poll] Path ${path} returned ${response.status}, trying next...`);
          response = null;
        } catch (e) {
          console.log(`[ai-psd-poll] Path ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
          /* try next path */ 
        }
      }

      if (!response || !response.ok) {
        console.log(`[ai-psd-poll] All paths failed for taskId=${taskId}, attempt ${attempt + 1}/${maxAttempts}`);
        continue;
      }

      let data: Record<string, unknown>;
      try {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          // SSE 响应格式
          console.log(`[ai-psd-poll] Non-JSON response for taskId=${taskId}, content-type: ${response.headers.get('content-type')}`);
          continue;
        }
      } catch (e) {
        console.log(`[ai-psd-poll] Failed to read response: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const innerData = (data.data && typeof data.data === 'object') ? data.data as Record<string, unknown> : {};
      const innerStatus = innerData.status || innerData.state || data.status || data.state || 'unknown';
      console.log(`[ai-psd-poll] taskId=${taskId} path=${triedPath} innerStatus=${innerStatus} progress=${innerData.progress} result_keys=${innerData.result ? Object.keys(innerData.result as object).join(',') : 'none'} innerError=${JSON.stringify(innerData.error || '').slice(0, 200)}`);
      const imageUrl = extractImageUrl(data) || extractImageUrl(innerData);
      console.log(`[ai-psd-poll] extractImageUrl: dataUrl=${!!extractImageUrl(data)} innerUrl=${!!extractImageUrl(innerData)} finalUrl=${imageUrl ? imageUrl.slice(0, 80) : 'none'}`);
      if (imageUrl) {
        return { success: true, imageUrl, imageUrls: [imageUrl] };
      }
      // 兜底：使用深度 URL 提取函数
      const deepUrls = extractImageUrlsFromDataObj(data);
      if (deepUrls.length > 0) {
        console.log(`[ai-psd-poll] Deep extract found ${deepUrls.length} URL(s): ${deepUrls[0].slice(0, 80)}`);
        return { success: true, imageUrl: deepUrls[0], imageUrls: deepUrls };
      }
      // Completed but no URL extracted — try to get from innerData.result directly
      if (innerStatus === 'completed' && innerData.result) {
        const result = innerData.result as Record<string, unknown>;
        const resultType = typeof result;
        const isArray = Array.isArray(result);
        console.log(`[ai-psd-poll] Direct extract: result type=${resultType} isArray=${isArray} keys=${Object.keys(result).join(',')}`);
        const rawImages = result.images;
        console.log(`[ai-psd-poll] rawImages type=${typeof rawImages} isArray=${Array.isArray(rawImages)} val=${JSON.stringify(rawImages).slice(0, 300)}`);
        const imgs = rawImages as Array<Record<string, unknown>> | undefined;
        if (imgs?.length) {
          const firstImg = imgs[0];
          console.log(`[ai-psd-poll] First image keys: ${Object.keys(firstImg).join(',')}`);
          // url can be string or string[] (e.g. apimart returns url as array)
          const rawUrl = firstImg?.url || firstImg?.image_url || firstImg?.src;
          let directUrl: string | undefined;
          if (typeof rawUrl === 'string' && rawUrl) {
            directUrl = rawUrl;
          } else if (Array.isArray(rawUrl) && rawUrl.length > 0 && typeof rawUrl[0] === 'string') {
            directUrl = rawUrl[0];
          }
          if (directUrl) {
            console.log(`[ai-psd-poll] Extracted URL directly from result.images: ${directUrl.slice(0, 80)}`);
            return { success: true, imageUrl: directUrl, imageUrls: [directUrl] };
          }
        } else {
          console.log(`[ai-psd-poll] No images array in result`);
        }
      }

      // 检查任务失败 — 支持多种响应格式
      // 格式1: { status: 'failed' }
      // 格式2: { code: 200, data: { error: { code, message } } }  (apimart)
      // 格式3: { error: { message } }
      const status = (data.status || data.state || innerData.status || innerData.state || '') as string;
      const errorObj = (data.error || innerData.error) as Record<string, unknown> | undefined;
      const isCompleted = innerData.completed || data.completed || status === 'succeeded';
      const hasImageUrls = (innerData.image_urls || innerData.output || innerData.images);
      if (status === 'failed' || status === 'error' || (errorObj && !hasImageUrls)) {
        const errorMsg = (errorObj?.message as string) || (errorObj?.code as string) || (data.error as string) || (data.message as string) || '未知错误';
        console.log(`[ai-psd-poll] Task failed: status=${status}, error=${errorMsg}`);
        return { success: false, error: `图像生成任务失败: ${errorMsg}` };
      }
      // 其他状态（pending/processing/running）继续轮询
    } catch {
      continue;
    }
  }

  return { success: false, error: `图像生成任务超时(${maxAttempts * intervalMs / 1000}s)` };
}
