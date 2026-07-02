/**
 * 品牌工厂 API
 * POST /api/brand-factory  — 操作(action)
 * GET  /api/brand-factory  — 获取项目列表
 *
 * 支持的 action:
 *   create-project, delete-project, archive-project,
 *   analyze-dna, generate-directions, generate-kv,
 *   batch-generate, consistency-check, save-version,
 *   generate-chinese-title
 */

import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderForFeature, findProviderById } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, extractImageUrl, tryChatCompletionsImageFallback, isChannelUnavailableError, persistResultImage } from '@/lib/api-compatibility';
import type { ApiCompatProfile } from '@/lib/api-compatibility';
import type { ApiProvider } from '@/lib/universal-api-types';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';

// ─── 内存项目存储 ────────────────────────────────────────────────────
const BRAND_PROJECTS_KEY = 'brand_factory_projects';
const MAX_PROJECTS = 500;
const projectsStore = new Map<string, Record<string, unknown>>();

/** 获取所有项目（内存 → 数据库） */
async function loadProjects(): Promise<Record<string, unknown>[]> {
  if (projectsStore.size > 0) {
    return Array.from(projectsStore.values());
  }
  try {
    const data = await dbGetUserData('__system__', BRAND_PROJECTS_KEY);
    if (data && typeof data === 'object') {
      const arr = (data as { projects?: Record<string, unknown>[] }).projects || [];
      for (const p of arr) {
        const id = (p.id as string) || '';
        if (id) projectsStore.set(id, p);
      }
    }
  } catch { /* ignore */ }
  return Array.from(projectsStore.values());
}

/** 持久化所有项目到数据库（LRU淘汰超上限项目） */
async function persistProjects(): Promise<void> {
  try {
    let projects = Array.from(projectsStore.values());
    // LRU淘汰：超过上限时按 updatedAt 排序，移除最老的项目
    if (projects.length > MAX_PROJECTS) {
      projects.sort((a, b) => {
        const ta = (a.updatedAt as number) || (a.createdAt as number) || 0;
        const tb = (b.updatedAt as number) || (b.createdAt as number) || 0;
        return ta - tb;
      });
      const toRemove = projects.slice(0, projects.length - MAX_PROJECTS);
      for (const p of toRemove) {
        const id = (p.id as string) || '';
        if (id) projectsStore.delete(id);
      }
      projects = projects.slice(projects.length - MAX_PROJECTS);
    }
    await dbSetUserData('__system__', BRAND_PROJECTS_KEY, { projects });
  } catch (e) {
    console.error('[brand-factory] persist error:', e);
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 模型调用辅助 ────────────────────────────────────────────────────

async function getImageProvider(imageModel?: string, imageProviderId?: string): Promise<ApiProvider | null> {
  if (imageProviderId) {
    const provider = await findProviderById(imageProviderId);
    if (provider) return provider;
    console.warn(`[brand-factory] imageProviderId="${imageProviderId}" 未找到提供商，回退到模型匹配`);
  }
  if (imageModel) {
    const provider = await findProviderForModel(imageModel, 'image', imageProviderId);
    if (provider) return provider;
  }
  return findProviderForFeature('imageEdit');
}

async function getLLMProvider(llmModel?: string, llmProviderId?: string): Promise<ApiProvider | null> {
  if (llmProviderId) {
    const provider = await findProviderById(llmProviderId);
    if (provider) return provider;
    console.warn(`[brand-factory] llmProviderId="${llmProviderId}" 未找到提供商，回退到模型匹配`);
  }
  if (llmModel) {
    const provider = await findProviderForModel(llmModel, 'chat');
    if (provider) return provider;
  }
  return findProviderForFeature('chat');
}

async function callLLM(
  prompt: string,
  systemPrompt: string,
  llmModel?: string,
  options?: { maxTokens?: number; temperature?: number },
  llmProviderId?: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  const provider = await getLLMProvider(llmModel, llmProviderId);
  if (!provider) {
    return { success: false, error: '未找到可用的LLM模型提供商，请在管理员后台配置' };
  }

  const rawLlmModel = llmModel || provider.selectedModels?.[0] || 'gpt-4o';
  const { apiModelName: model } = normalizeModelForApi(rawLlmModel);
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
        console.log(`[brand-factory] /chat/completions returned ${response.status}, trying /responses endpoint`);
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

    const contentType = response.headers.get('content-type') || '';
    let content = '';

    if (contentType.includes('text/event-stream')) {
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
            if (text.includes('[DONE]')) break;
          }
        } else {
          text = await response.text();
        }
      } catch { /* timeout */ } finally {
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
          } catch { /* skip */ }
        }
      }
      content = accumulated;
    } else {
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
    }

    return { success: true, content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `LLM调用异常: ${message}` };
  }
}

/** 从原始API响应中提取图片URL（兜底，兼容多种响应格式） */
function extractImageUrlsFromRaw(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // 1. data.data[].url / data.data[].b64_json（标准 OpenAI 格式）
  const dataArr = data.data;
  if (Array.isArray(dataArr)) {
    for (const item of dataArr) {
      if (typeof item === 'object' && item !== null) {
        const url = (item as Record<string, unknown>).url;
        const b64 = (item as Record<string, unknown>).b64_json;
        if (typeof url === 'string') urls.push(url);
        if (typeof b64 === 'string') urls.push(`data:image/png;base64,${b64}`);
      } else if (typeof item === 'string') {
        urls.push(item);
      }
    }
  }

  // 2. data.images[].url
  const images = data.images || (typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data) ? (data.data as Record<string, unknown>).images : null);
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === 'object' && img !== null) {
        const url = (img as Record<string, unknown>).url || (img as Record<string, unknown>).b64_json;
        if (typeof url === 'string') urls.push(url.startsWith('data:') ? url : (url.match(/^data:image/) ? url : url));
      } else if (typeof img === 'string') {
        urls.push(img);
      }
    }
  }

  // 3. data.output.image_urls[] / data.data.output.image_urls[]
  const output = data.output || (typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data) ? (data.data as Record<string, unknown>).output : null);
  if (typeof output === 'object' && output !== null) {
    const imageUrls = (output as Record<string, unknown>).image_urls || (output as Record<string, unknown>).images;
    if (Array.isArray(imageUrls)) {
      for (const u of imageUrls) {
        if (typeof u === 'string') urls.push(u);
        else if (typeof u === 'object' && u !== null) {
          const url = (u as Record<string, unknown>).url;
          if (typeof url === 'string') urls.push(url);
        }
      }
    }
    // 单个 url 字段
    const singleUrl = (output as Record<string, unknown>).url;
    if (typeof singleUrl === 'string' && !urls.includes(singleUrl)) urls.push(singleUrl);
  }

  // 4. data.data.image_urls[]（APImart 格式）
  if (typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data)) {
    const dataObj = data.data as Record<string, unknown>;
    const imageUrls = dataObj.image_urls;
    if (Array.isArray(imageUrls)) {
      for (const u of imageUrls) { if (typeof u === 'string') urls.push(u); }
    }
    // 单个 url 字段
    const singleUrl = dataObj.url;
    if (typeof singleUrl === 'string' && !urls.includes(singleUrl)) urls.push(singleUrl);
    // data.data.image_url（单数字段）
    const imageUrl = dataObj.image_url;
    if (typeof imageUrl === 'string' && !urls.includes(imageUrl)) urls.push(imageUrl);
  }

  // 5. 顶层 url / image_url
  const topUrl = data.url || data.image_url;
  if (typeof topUrl === 'string' && !urls.includes(topUrl)) urls.push(topUrl);

  // 6. data.result.url / data.result.image_url（某些代理格式）
  const result = data.result;
  if (typeof result === 'object' && result !== null) {
    const resultUrl = (result as Record<string, unknown>).url || (result as Record<string, unknown>).image_url;
    if (typeof resultUrl === 'string' && !urls.includes(resultUrl)) urls.push(resultUrl);
  }

  return urls;
}

/** 深度提取响应中所有以 http 开头的图片URL（最终兜底） */
function deepExtractImageUrls(obj: unknown, depth = 0): string[] {
  if (depth > 5) return []; // 防止无限递归
  const urls: string[] = [];
  if (typeof obj === 'string') {
    // 匹配 http/https 开头、常见图片后缀或包含 /image/ 的 URL
    if (/^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|bmp|svg)/i.test(obj) ||
        /^https?:\/\/.*\/image\//i.test(obj) ||
        /^https?:\/\/.*\.(com|cn|io|net)\/.+\.(png|jpg|jpeg|webp)/i.test(obj)) {
      urls.push(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      urls.push(...deepExtractImageUrls(item, depth + 1));
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      urls.push(...deepExtractImageUrls(value, depth + 1));
    }
  }
  return urls;
}

async function generateImage(
  prompt: string,
  imageModel?: string,
  options?: { size?: string; quality?: string; n?: number },
  imageProviderId?: string
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; taskId?: string; error?: string }> {
  const provider = await getImageProvider(imageModel, imageProviderId);
  if (!provider) {
    return { success: false, error: '未找到可用的图像模型提供商，请在管理员后台配置' };
  }

  const rawModel = imageModel || provider.selectedModels?.[0] || 'dall-e-3';
  const { apiModelName: model } = normalizeModelForApi(rawModel);
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);

  if (model !== rawModel) {
    console.log(`[brand-factory] Model normalized: ${rawModel} → ${model}`);
  }

  try {
    const rawBody: Record<string, unknown> = {
      model,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? '2048x2048',
    };
    if (options?.quality) rawBody.quality = options.quality;

    const { body, endpoint } = adjustRequestForProfile(rawBody, profile, {});

    const response = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');

      // ★ Try /chat/completions fallback for channel errors
      if (isChannelUnavailableError(`${errText} ${response.status}`)) {
        console.info('[brand-factory] Channel error, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl,
            apiKey: provider.apiKey,
            model,
            prompt: rawBody.prompt as string,
            size: rawBody.size as string | undefined,
            originalError: errText,
            requestIdPrefix: 'brand-factory',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[brand-factory] /chat/completions fallback succeeded, got', chatImageUrls.length, 'images');
            const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
            return { success: true, imageUrl: persistedUrls[0], imageUrls: persistedUrls };
          }
        } catch (chatErr) {
          console.warn('[brand-factory] /chat/completions fallback error:', chatErr);
        }
      }

      return { success: false, error: `图像生成失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    const data = await response.json();
    // ★ 调试日志：记录生成响应结构
    console.info(`[brand-factory] generateImage response keys=${Object.keys(data).join(',')}, dataIsArray=${Array.isArray(data.data)}`);

    if (data.data && Array.isArray(data.data)) {
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

    // ★ data.data 是对象（非数组）时，可能是 APImart 等格式
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      const dataObj = data.data as Record<string, unknown>;
      // 检查 task_id
      if (dataObj.task_id) {
        return { success: true, taskId: dataObj.task_id as string };
      }
      if (dataObj.id && !dataObj.task_id) {
        return { success: true, taskId: dataObj.id as string };
      }
    }

    if (data.task_id || data.id) {
      return { success: true, taskId: (data.task_id || data.id) as string };
    }

    // ★ 使用增强版 extractImageUrlsFromRaw 兜底提取URL
    const rawUrls = extractImageUrlsFromRaw(data);
    if (rawUrls.length > 0) {
      return { success: true, imageUrl: rawUrls[0], imageUrls: rawUrls };
    }

    // ★ 最终兜底：使用复用 poll-task 逻辑的深度提取
    const deepUrls = extractImageUrlsFromPollData(data, provider.baseUrl.replace(/\/+$/, ''));
    if (deepUrls.length > 0) {
      return { success: true, imageUrl: deepUrls[0], imageUrls: deepUrls };
    }

    console.warn(`[brand-factory] generateImage: 所有提取方式均未找到图片URL, data=${JSON.stringify(data).substring(0, 500)}`);
    return { success: false, error: '图像生成返回格式异常' };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
    if (isTimeout) {
      console.info('[brand-factory] Timed out, trying /chat/completions fallback...');
      try {
        const chatImageUrls = await tryChatCompletionsImageFallback({
          baseUrl,
          apiKey: provider.apiKey,
          model,
          prompt,
          size: options?.size,
          originalError: 'timeout',
          requestIdPrefix: 'brand-factory-timeout',
          skipChannelCheck: true,
        });
        if (chatImageUrls && chatImageUrls.length > 0) {
          console.log('[brand-factory] /chat/completions fallback succeeded after timeout, got', chatImageUrls.length, 'images');
          const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
          return { success: true, imageUrl: persistedUrls[0], imageUrls: persistedUrls };
        }
      } catch (chatErr) {
        console.warn('[brand-factory] /chat/completions timeout fallback error:', chatErr);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `图像生成异常: ${message}` };
  }
}

/** 轮询异步任务结果（最多60秒） */
/**
 * 从 API 响应中提取图片 URL（复用 /api/poll-task 已验证的多路径解析逻辑）
 * 覆盖 APImart、OpenAI、各种第三方代理的响应格式
 */
function extractImageUrlsFromPollData(
  pollData: Record<string, unknown>,
  apiBaseUrl: string
): string[] {
  const urls: string[] = [];

  // 1) 递归解包嵌套的 data 字段（APImart 多层嵌套: {code, data: {code, data: {status, images}}}）
  let taskData: Record<string, unknown> = pollData;
  let unwrapDepth = 0;
  while (taskData.data && typeof taskData.data === 'object' && !Array.isArray(taskData.data) && unwrapDepth < 3) {
    const innerData = taskData.data as Record<string, unknown>;
    if (innerData.status || innerData.images || innerData.results || innerData.output || innerData.image_urls || innerData.image_urls_list || innerData.generated_images || innerData.url || innerData.image_url) {
      taskData = innerData;
      unwrapDepth++;
    } else if (innerData.data && typeof innerData.data === 'object') {
      taskData = innerData;
      unwrapDepth++;
    } else {
      break;
    }
  }

  // 2) 从解包后的 taskData 提取图片列表
  const dataItems = taskData.images || taskData.results || taskData.output || taskData.image_urls || taskData.image_urls_list || taskData.generated_images;
  if (Array.isArray(dataItems)) {
    for (const item of dataItems) {
      const url = (item as Record<string, unknown>)?.url || (item as Record<string, unknown>)?.image_url || (item as Record<string, unknown>)?.image_url_optimized || item;
      if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
        urls.push(url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
      }
    }
  }

  // 3) 单个图片字段
  if (urls.length === 0) {
    const resultObj = taskData.result as Record<string, unknown> | undefined;
    const singleUrl = taskData.image_url || taskData.url || taskData.image_url_optimized
      || resultObj?.url || resultObj?.image_url;
    if (typeof singleUrl === 'string' && (singleUrl.startsWith('http') || singleUrl.startsWith('/'))) {
      urls.push(singleUrl.startsWith('/') ? `${apiBaseUrl}${singleUrl}` : singleUrl);
    }
  }

  // 4) 从 result 对象中提取图片数组
  if (urls.length === 0 && taskData.result && typeof taskData.result === 'object') {
    const resultObj = taskData.result as Record<string, unknown>;
    const resultImages = resultObj.images || resultObj.results || resultObj.output || resultObj.image_urls || resultObj.generated_images;
    if (Array.isArray(resultImages)) {
      for (const item of resultImages) {
        const url = (item as Record<string, unknown>)?.url || (item as Record<string, unknown>)?.image_url || (item as Record<string, unknown>)?.image_url_optimized || item;
        if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
          urls.push(url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
        }
      }
    }
  }

  // 5) 从嵌套的 data.data 提取
  if (urls.length === 0 && taskData.data && typeof taskData.data === 'object') {
    const innerData = taskData.data as Record<string, unknown>;
    const innerImages = innerData.images || innerData.results || innerData.output || innerData.image_urls || innerData.generated_images;
    if (Array.isArray(innerImages)) {
      for (const item of innerImages) {
        const url = (item as Record<string, unknown>)?.url || (item as Record<string, unknown>)?.image_url || (item as Record<string, unknown>)?.image_url_optimized || item;
        if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
          urls.push(url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
        }
      }
    }
    if (urls.length === 0) {
      const innerSingleUrl = innerData.image_url || innerData.url || innerData.image_url_optimized;
      if (typeof innerSingleUrl === 'string' && (innerSingleUrl.startsWith('http') || innerSingleUrl.startsWith('/'))) {
        urls.push(innerSingleUrl.startsWith('/') ? `${apiBaseUrl}${innerSingleUrl}` : innerSingleUrl);
      }
    }
  }

  // 6) 从顶层 pollData.images 提取
  if (urls.length === 0 && pollData.images && Array.isArray(pollData.images)) {
    for (const item of pollData.images) {
      const url = (item as Record<string, unknown>)?.url || (item as Record<string, unknown>)?.image_url || item;
      if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))) {
        urls.push(url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
      }
    }
  }

  // 7) 从顶层 pollData.output（字符串 URL）
  if (urls.length === 0 && pollData.output && typeof pollData.output === 'string' && pollData.output.startsWith('http')) {
    urls.push(pollData.output);
  }

  // 8) data 数组格式 (OpenAI: data[{url: "..."}])
  if (urls.length === 0 && pollData.data && Array.isArray(pollData.data)) {
    for (const item of pollData.data) {
      const url = (item as Record<string, unknown>)?.url || (item as Record<string, unknown>)?.b64_json || (item as Record<string, unknown>)?.image_url;
      if (typeof url === 'string') {
        if (url.startsWith('http') || url.startsWith('/')) {
          urls.push(url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
        } else if (url.startsWith('data:')) {
          urls.push(url);
        } else {
          urls.push(`data:image/png;base64,${url}`);
        }
      }
    }
  }

  // 9) 最终兜底: 深度搜索整个响应中所有以 http 开头且包含图片扩展名的 URL
  if (urls.length === 0) {
    const fullJson = JSON.stringify(pollData);
    const urlMatches = fullJson.match(/https?:\/\/[^\s"\\]+\.(png|jpg|jpeg|webp|gif)/gi);
    if (urlMatches && urlMatches.length > 0) {
      for (const url of urlMatches.slice(0, 4)) {
        urls.push(url.replace(/[^a-zA-Z0-9+/.:_@&?=-]$/, ''));
      }
    }
  }

  return urls;
}

async function pollTaskResult(
  taskId: string,
  providerInfo: { baseUrl: string; apiKey: string; profile: ApiCompatProfile },
  maxMs = 120000
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; error?: string }> {
  const pollUrl = buildPollUrl(providerInfo.baseUrl, taskId, providerInfo.profile);
  if (!pollUrl) {
    return { success: false, error: '无法构建轮询URL，该提供商不支持异步轮询' };
  }
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      // 从完整 pollUrl 中提取路径部分，使用 fetchWithV1Retry 支持 /v1 重试
      let pollPath = pollUrl;
      try {
        const urlObj = new URL(pollUrl);
        pollPath = urlObj.pathname + urlObj.search;
      } catch {
        // pollUrl 可能已经是相对路径
        pollPath = pollUrl.replace(/^https?:\/\/[^/]+/, '');
      }
      const resp = await fetchWithV1Retry(providerInfo.baseUrl, pollPath, {
        headers: { 'Authorization': `Bearer ${providerInfo.apiKey}` },
      }, false);
      if (!resp.ok) continue;
      const pollData = await resp.json() as Record<string, unknown>;
      // ★ 调试日志：记录轮询响应结构
      console.info(`[brand-factory] pollTaskResult response keys=${Object.keys(pollData).join(',')}, status=${pollData.status}`);

      // 使用与 /api/poll-task 相同的递归解包逻辑检查任务状态
      let taskData: Record<string, unknown> = pollData;
      let unwrapDepth = 0;
      while (taskData.data && typeof taskData.data === 'object' && !Array.isArray(taskData.data) && unwrapDepth < 3) {
        const innerData = taskData.data as Record<string, unknown>;
        if (innerData.status || innerData.images || innerData.results || innerData.output || innerData.image_urls || innerData.image_urls_list || innerData.generated_images || innerData.url || innerData.image_url) {
          taskData = innerData;
          unwrapDepth++;
        } else if (innerData.data && typeof innerData.data === 'object') {
          taskData = innerData;
          unwrapDepth++;
        } else {
          break;
        }
      }
      const taskStatus = String(taskData.status || '').toLowerCase();

      if (taskStatus === 'completed' || taskStatus === 'success' || taskStatus === 'succeeded') {
        // ★ 复用 /api/poll-task 已验证的完整 URL 提取逻辑
        const extractedUrls = extractImageUrlsFromPollData(pollData, providerInfo.baseUrl.replace(/\/+$/, ''));
        if (extractedUrls.length > 0) {
          console.info(`[brand-factory] pollTaskResult: extracted ${extractedUrls.length} URLs, first=${extractedUrls[0].substring(0, 80)}`);
          return { success: true, imageUrl: extractedUrls[0], imageUrls: extractedUrls };
        }

        // 额外兜底：parseResponseForProfile + extractImageUrlsFromRaw
        const parsed = parseResponseForProfile(pollData, providerInfo.profile);
        if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
          return { success: true, imageUrl: parsed.directImageUrls[0], imageUrls: parsed.directImageUrls };
        }
        const rawUrls = extractImageUrlsFromRaw(pollData);
        if (rawUrls.length > 0) {
          return { success: true, imageUrl: rawUrls[0], imageUrls: rawUrls };
        }

        console.warn(`[brand-factory] pollTaskResult: 任务完成但所有提取方式均未找到图片URL, pollData=${JSON.stringify(pollData).substring(0, 500)}`);
        return { success: false, error: '任务完成但未返回图片URL' };
      }
      if (taskStatus === 'failed') {
        return { success: false, error: '异步任务失败' };
      }
    } catch { /* continue polling */ }
  }
  return { success: false, error: '轮询超时，请稍后查看结果' };
}

/** 生成图片（自动轮询异步任务） */
async function generateImageWithPoll(
  prompt: string,
  imageModel?: string,
  options?: { size?: string; quality?: string; n?: number },
  imageProviderId?: string
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; error?: string }> {
  const result = await generateImage(prompt, imageModel, options, imageProviderId);
  if (!result.success) return result;
  // 如果同步返回了图片URL，直接返回
  if (result.imageUrl || result.imageUrls) return result;
  // 异步任务，需要轮询
  if (result.taskId) {
    const provider = await getImageProvider(imageModel, imageProviderId);
    if (!provider) return { success: false, error: '未找到提供商' };
    const profile = resolveCompatProfile(provider);
    return pollTaskResult(result.taskId, {
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      apiKey: provider.apiKey,
      profile,
    });
  }
  return result;
}

// ─── Prompt 构建 ─────────────────────────────────────────────────────

function buildAnalyzeDNAPrompt(body: Record<string, unknown>): { system: string; user: string } {
  const brandName = body.brandName as string || '';
  const industry = body.industry as string || '';
  const tone = body.tone as string || '';
  const keywords = body.keywords as string[] || [];
  const hasLogo = !!(body.logoUrl as string);
  const hasProduct = !!(body.productUrl as string);
  const hasIP = !!(body.ipUrl as string);

  return {
    system: `You are a senior brand strategy consultant. Analyze the brand information and output a BrandDNA JSON object. Output ONLY valid JSON, no markdown, no explanation.`,
    user: `Analyze this brand and generate a BrandDNA:
Brand: ${brandName}
Industry: ${industry}
Tone: ${tone}
Keywords: ${keywords.join(', ')}
Has Logo: ${hasLogo}, Has Product: ${hasProduct}, Has IP: ${hasIP}

Output JSON schema:
{
  "brandKeywords": ["keyword1", "keyword2", ...], (5-8 brand-defining keywords)
  "mainColors": ["#hex1", "#hex2"], (2-3 primary brand colors)
  "secondaryColors": ["#hex3", "#hex4"], (2-3 secondary/auxiliary colors)
  "fontStyle": "description of typography style",
  "visualTone": "description of overall visual direction",
  "logoRules": ["rule1", "rule2"], (3-5 logo usage guidelines)
  "productRules": ["rule1", "rule2"], (3-5 product photography/display rules)
  "ipRules": ["rule1", "rule2"], (3-5 IP character usage rules, if applicable)
  "forbiddenRules": ["rule1", "rule2"], (3-5 things to avoid)
  "recommendedMaterials": ["material1", "material2"] (5-8 recommended material types)
}`,
  };
}

function buildGenerateDirectionsPrompt(brandDna: Record<string, unknown>, count: number): { system: string; user: string } {
  return {
    system: `You are a creative director specializing in brand campaigns. Based on the BrandDNA, generate creative directions. Output ONLY valid JSON array, no markdown, no explanation.`,
    user: `Based on this BrandDNA, generate ${count} creative directions:
${JSON.stringify(brandDna, null, 2)}

Output JSON array schema:
[
  {
    "id": "dir_1",
    "name": "方向名称",
    "concept": "核心理念描述(50字以内)",
    "slogan": "广告语/口号",
    "visualKeywords": ["关键词1", "关键词2", "关键词3"],
    "colorPlan": ["#hex1", "#hex2", "#hex3"],
    "fontPlan": "字体方案描述",
    "prompt": "A detailed English image generation prompt for this creative direction, suitable for AI image generation",
    "previewImages": []
  }
]`,
  };
}

function buildKVImagePrompt(
  brandDna: Record<string, unknown> | null,
  body: Record<string, unknown>
): string {
  const theme = body.theme as string || '';
  const slogan = body.slogan as string || '';
  const ratio = body.ratio as string || '16:9';
  const direction = body.direction as string || '';

  const dnaContext = brandDna
    ? `Brand DNA: keywords=${(brandDna.brandKeywords as string[] || []).join(',')}, colors=${(brandDna.mainColors as string[] || []).join(',')}, tone=${brandDna.visualTone || ''}`
    : '';

  return `Professional brand Key Visual (KV) design, ${dnaContext}, theme: ${theme}, slogan: "${slogan}", creative direction: ${direction}, ratio: ${ratio}, high-end commercial quality, clean composition, premium visual impact`;
}

function buildBatchMaterialPrompt(
  brandDna: Record<string, unknown> | null,
  materialType: string,
  item: string
): string {
  const dnaContext = brandDna
    ? `Brand colors: ${(brandDna.mainColors as string[] || []).join(',')}, style: ${brandDna.visualTone || ''}`
    : '';
  return `Professional ${materialType} material design: ${item}, ${dnaContext}, high-quality commercial design, clean and professional`;
}

function buildConsistencyCheckPrompt(
  brandName: string,
  brandDna: Record<string, unknown>,
  materials: unknown[]
): { system: string; user: string } {
  return {
    system: `You are a brand consistency auditor. Evaluate how well the generated materials match the brand DNA. Output ONLY valid JSON, no markdown.`,
    user: `Brand: ${brandName}
BrandDNA: ${JSON.stringify(brandDna, null, 2)}
Materials to evaluate (${materials.length} items): ${JSON.stringify(materials).slice(0, 2000)}

Evaluate consistency and output:
{
  "overallScore": 0-100,
  "colorConsistency": 0-100,
  "styleConsistency": 0-100,
  "toneConsistency": 0-100,
  "suggestions": ["improvement suggestion 1", "suggestion 2"]
}`,
  };
}

function buildChineseTitlePrompt(
  text: string,
  scene: string,
  style: string,
  brandDna: Record<string, unknown> | null
): string {
  const dnaContext = brandDna
    ? `Brand style: ${brandDna.visualTone || ''}, colors: ${(brandDna.mainColors as string[] || []).join(',')}`
    : '';
  return `Chinese typography design, text "${text}", scene: ${scene}, style: ${style}, ${dnaContext}, artistic Chinese character rendering, professional commercial design quality`;
}

// ─── GET: 获取项目列表 ────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    const projects = await loadProjects();
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-factory] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST: 操作 ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult) return authResult;
  try {
    const body = await request.json();
    const action = body.action as string;
    const imageModel = body.imageModel as string | undefined;
    const llmModel = body.llmModel as string | undefined;
    const imageProviderId = body.imageProviderId as string | undefined;
    const llmProviderId = body.llmProviderId as string | undefined;
    const quality = (body.quality as string) || '2K';
    const aspectRatio = (body.aspectRatio as string) || '1:1';

    switch (action) {
      // ─── 项目管理 ─────────────────────────────────────
      case 'create-project': {
        const id = genId('bf');
        const now = new Date().toISOString();
        const project: Record<string, unknown> = {
          id,
          project_name: body.projectName || body.brandName || '',
          brand_name: body.brandName || '',
          industry: body.industry || '',
          project_type: body.projectType || '',
          tone: body.tone || '',
          keywords: JSON.stringify(body.keywords || []),
          target_audience: body.targetAudience || '',
          description: body.description || '',
          logo_url: '',
          product_url: '',
          ip_url: '',
          reference_urls: JSON.stringify([]),
          brand_dna: null,
          creative_directions: null,
          kv_image_url: '',
          batch_results: null,
          consistency_scores: null,
          status: 'draft',
          is_archived: false,
          created_at: now,
          updated_at: now,
        };
        projectsStore.set(id, project);
        await persistProjects();
        return NextResponse.json({ success: true, project });
      }

      case 'update-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        await loadProjects(); // 确保从数据库加载最新数据
        const proj = projectsStore.get(id);
        if (!proj) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        // camelCase → snake_case 字段映射（前端发送camelCase，存储用snake_case）
        const fieldMap: Record<string, string> = {
          brandName: 'brand_name',
          projectName: 'project_name',
          projectType: 'project_type',
          targetAudience: 'target_audience',
          logoUrl: 'logo_url',
          productUrl: 'product_url',
          ipUrl: 'ip_url',
          referenceUrls: 'reference_urls',
          brandDna: 'brand_dna',
          creativeDirections: 'creative_directions',
          generatedMaterials: 'generated_materials',
          isArchived: 'is_archived',
          kvImageUrl: 'kv_image_url',
          batchResults: 'batch_results',
          consistencyScores: 'consistency_scores',
        };
        const updatableFields = [
          'brand_name', 'industry', 'project_type', 'tone', 'keywords',
          'target_audience', 'description', 'logo_url', 'product_url',
          'ip_url', 'reference_urls', 'brand_dna', 'creative_directions',
          'status', 'generated_materials', 'versions', 'project_name', 'is_archived',
          'kv_image_url', 'batch_results', 'consistency_scores',
        ];
        for (const field of updatableFields) {
          // 支持前端发送的 camelCase 和存储用的 snake_case
          const camelKey = Object.entries(fieldMap).find(([, v]) => v === field)?.[0];
          const value = body[field] ?? (camelKey ? body[camelKey] : undefined);
          if (value !== undefined) {
            (proj as Record<string, unknown>)[field] = typeof value === 'object' ? JSON.stringify(value) : value;
          }
        }
        proj.updated_at = new Date().toISOString();
        projectsStore.set(id, proj);
        await persistProjects();
        return NextResponse.json({ success: true, project: proj });
      }

      case 'delete-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        projectsStore.delete(id);
        await persistProjects();
        return NextResponse.json({ success: true });
      }

      case 'archive-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        const proj = projectsStore.get(id);
        if (proj) {
          proj.is_archived = true;
          proj.updated_at = new Date().toISOString();
          projectsStore.set(id, proj);
          await persistProjects();
        }
        return NextResponse.json({ success: true });
      }

      // ─── 品牌DNA分析 ───────────────────────────────────
      case 'analyze-dna': {
        const projectId = body.projectId as string;
        if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

        const { system, user } = buildAnalyzeDNAPrompt(body);
        const result = await callLLM(user, system, llmModel, { maxTokens: 4096, temperature: 0.7 }, llmProviderId);

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '品牌DNA分析失败' }, { status: 500 });
        }

        // 解析LLM返回的JSON
        let brandDna: Record<string, unknown> | null = null;
        try {
          // 尝试从返回内容中提取JSON
          const content = result.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            brandDna = JSON.parse(jsonMatch[0]);
          }
        } catch {
          // JSON解析失败，返回原始内容作为参考
          brandDna = {
            brandKeywords: [],
            mainColors: [],
            secondaryColors: [],
            fontStyle: '',
            visualTone: result.content.slice(0, 200),
            logoRules: [],
            productRules: [],
            ipRules: [],
            forbiddenRules: [],
            recommendedMaterials: [],
            _rawContent: result.content,
          };
        }

        // 更新项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          proj.brand_dna = JSON.stringify(brandDna);
          proj.status = 'active';
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true, brandDna });
      }

      // ─── 生成创意方向 ───────────────────────────────────
      case 'generate-directions': {
        const projectId = body.projectId as string;
        const brandDnaRaw = body.brandDna as Record<string, unknown> | undefined;
        const count = (body.count as number) || 3;

        if (!projectId || !brandDnaRaw) {
          return NextResponse.json({ error: '缺少项目ID或品牌DNA' }, { status: 400 });
        }

        const { system, user } = buildGenerateDirectionsPrompt(brandDnaRaw, count);
        const result = await callLLM(user, system, llmModel, { maxTokens: 4096, temperature: 0.8 }, llmProviderId);

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '创意方向生成失败' }, { status: 500 });
        }

        let directions: Record<string, unknown>[] = [];
        try {
          const content = result.content;
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            directions = JSON.parse(jsonMatch[0]);
            // 确保每个方向都有id
            directions = directions.map((d, i) => ({
              id: d.id || `dir_${i + 1}`,
              previewImages: [],
              ...d,
            }));
          }
        } catch {
          directions = [{
            id: 'dir_1',
            name: '创意方向',
            concept: result.content.slice(0, 50),
            slogan: '',
            visualKeywords: [],
            colorPlan: [],
            fontPlan: '',
            prompt: result.content,
            previewImages: [],
          }];
        }

        // 更新项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          proj.creative_directions = JSON.stringify(directions);
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true, directions });
      }

      // ─── 生成KV图 ──────────────────────────────────────
      case 'generate-kv': {
        const kvProjectId = body.projectId as string | undefined;
        const brandDna = body.brandDna as Record<string, unknown> | null;
        const prompt = buildKVImagePrompt(brandDna, body);

        const result = await generateImageWithPoll(prompt, imageModel, {
          size: calculateActualPixelsFromRatio(body.ratio as string || aspectRatio, quality, imageModel) || calculateActualPixelsFromRatio('3:4', '2K', imageModel) || '2048x3072',
          quality,
        }, imageProviderId);

        if (!result.success) {
          return NextResponse.json({ error: result.error || 'KV图生成失败' }, { status: 500 });
        }

        // 保存KV图URL到项目
        if (kvProjectId && result.imageUrl) {
          const proj = projectsStore.get(kvProjectId);
          if (proj) {
            proj.kv_image_url = result.imageUrl;
            proj.updated_at = new Date().toISOString();
            await persistProjects();
          }
        }

        return NextResponse.json({
          success: true,
          imageUrl: result.imageUrl,
          imageUrls: result.imageUrls,
        });
      }

      // ─── 批量生成素材 ──────────────────────────────────
      case 'batch-generate': {
        const projectId = body.projectId as string;
        const materialType = body.materialType as string || '通用';
        const items = body.items as string[] || [];
        const brandDna = body.brandDna as Record<string, unknown> | null;

        if (!items.length) {
          return NextResponse.json({ error: '请选择至少一个素材类型' }, { status: 400 });
        }

        // 逐个生成（简化版，实际可并行）
        const results: { item: string; imageUrl?: string; error?: string }[] = [];
        for (const item of items) {
          const prompt = buildBatchMaterialPrompt(brandDna, materialType, item);
          const result = await generateImageWithPoll(prompt, imageModel, { size: calculateActualPixelsFromRatio(aspectRatio, quality, imageModel) || '2048x2048', quality }, imageProviderId);
          results.push({
            item,
            imageUrl: result.imageUrl,
            error: result.success ? undefined : (result.error || '生成失败'),
          });
        }

        // 保存到项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          const existingMaterials = (proj.generated_materials as string) || '[]';
          let materials: Record<string, unknown>[] = [];
          try { materials = JSON.parse(existingMaterials); } catch { /* ignore */ }
          for (const r of results) {
            if (r.imageUrl) {
              materials.push({
                id: genId('mat'),
                projectId,
                directionId: '',
                type: materialType,
                title: r.item,
                ratio: '1:1',
                imageUrl: r.imageUrl,
                prompt: buildBatchMaterialPrompt(brandDna, materialType, r.item),
                score: 0,
                status: 'draft',
                createdAt: new Date().toISOString(),
              });
            }
          }
          proj.batch_results = JSON.stringify(results.filter(r => r.imageUrl).map(r => ({
            item: r.item,
            imageUrl: r.imageUrl,
          })));
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({
          success: true,
          results,
          materials: results.filter(r => r.imageUrl).map(r => ({
            id: genId('mat'),
            projectId,
            type: materialType,
            title: r.item,
            imageUrl: r.imageUrl,
          })),
        });
      }

      // ─── 一致性检查 ────────────────────────────────────
      case 'consistency-check': {
        const brandName = body.brandName as string || '';
        const brandDna = body.brandDna as Record<string, unknown>;
        const materials = body.materials as unknown[] || [];

        if (!brandDna) {
          return NextResponse.json({ error: '请先分析品牌DNA' }, { status: 400 });
        }

        const { system, user } = buildConsistencyCheckPrompt(brandName, brandDna, materials);
        const result = await callLLM(user, system, llmModel, { maxTokens: 2048, temperature: 0.3 }, llmProviderId);

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '一致性检查失败' }, { status: 500 });
        }

        let scores: Record<string, unknown> = {};
        try {
          const content = result.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            scores = JSON.parse(jsonMatch[0]);
          }
        } catch {
          scores = { overallScore: 0, error: '解析失败', rawContent: result.content };
        }

        return NextResponse.json({ success: true, scores });
      }

      // ─── 保存版本 ──────────────────────────────────────
      case 'save-version': {
        const projectId = body.projectId as string;
        if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

        // 版本记录保存到项目数据中
        const proj = projectsStore.get(projectId);
        if (proj) {
          const existingVersions = (proj.versions as string) || '[]';
          let versions: Record<string, unknown>[] = [];
          try { versions = JSON.parse(existingVersions); } catch { /* ignore */ }
          versions.push({
            id: genId('ver'),
            projectId,
            targetType: body.targetType || 'proposal',
            targetId: body.targetId || projectId,
            versionName: body.versionName || 'V1',
            note: body.note || '',
            snapshot: body.snapshot || {},
            createdBy: 'user',
            createdAt: new Date().toISOString(),
          });
          proj.versions = JSON.stringify(versions);
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true });
      }

      // ─── 生成中文标题 ──────────────────────────────────
      case 'generate-chinese-title': {
        const text = body.text as string;
        const scene = body.scene as string || '海报';
        const style = body.style as string || '现代';
        const brandDna = body.brandDna as Record<string, unknown> | null;

        if (!text) return NextResponse.json({ error: '请输入标题文字' }, { status: 400 });

        const prompt = buildChineseTitlePrompt(text, scene, style, brandDna);
        const result = await generateImageWithPoll(prompt, imageModel, { size: calculateActualPixelsFromRatio('3:2', quality, imageModel) || '1536x1024', quality }, imageProviderId);

        if (!result.success) {
          return NextResponse.json({ error: result.error || '标题图生成失败' }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          result: {
            imageUrl: result.imageUrl,
            text,
            scene,
            style,
          },
        });
      }

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-factory] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
