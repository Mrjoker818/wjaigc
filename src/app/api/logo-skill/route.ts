/**
 * Logo Generator Skill API
 *
 * POST /api/logo-skill  — 操作(action)
 * GET  /api/logo-skill  — 获取默认配置
 *
 * 支持的 action:
 *   generate-directions  — 生成 Logo 方向（LLM 调用）
 *   generate-image       — 使用平台 Prompt 生成 Logo 图像
 *   save-asset           — 保存 Logo 到品牌资产
 *   refine-direction     — 基于修订意见重新生成方向
 */

import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderForFeature, findProviderById } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { persistResultImage } from '@/lib/persist-result-image';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';
import type { ApiProvider } from '@/lib/universal-api-types';
import { adaptBrandProjectToSanbaoInput, buildSanbaoInputFromUserInput } from '@/modules/brand-factory/logo-generator-core/sanbaoInputAdapter';
import { buildDirectionSystemPrompt, buildDirectionUserMessage, parseDirectionResponse } from '@/modules/brand-factory/logo-generator-core/sanbaoPromptParser';
import { selectPlatformPrompts, getBestGenerationPrompt } from '@/modules/brand-factory/logo-generator-core/platformPromptSelector';
import type { SanbaoInput } from '@/modules/brand-factory/logo-generator-core/sanbaoInputAdapter';
import type { TargetPlatform, OutputLayout } from '@/modules/brand-factory/logo-generator-core/platformPromptSelector';
import { requireApiAuthOrReject } from '@/lib/api-auth';

// ─── GET: 默认配置 ─────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    logoTypes: [
      { value: 'brand', label: '品牌Logo' },
      { value: 'company', label: '公司Logo' },
      { value: 'product', label: '产品Logo' },
      { value: 'cultural-creative', label: '文创IP Logo' },
      { value: 'campaign', label: '活动/广告Logo' },
      { value: 'event', label: '事件Logo' },
      { value: 'app', label: 'App Logo' },
      { value: 'sub-brand', label: '子品牌Logo' },
      { value: 'personal-brand', label: '个人品牌Logo' },
    ],
    outputLayouts: [
      { value: 'brand-system-board', label: '品牌系统展示板', desc: '完整品牌规范展示（推荐）' },
      { value: 'identity-board', label: '简版身份板', desc: 'Logo + 配色 + 字体' },
      { value: 'standalone-logo', label: '独立Logo', desc: '白底独立Logo' },
      { value: 'square-avatar', label: '方形图标', desc: 'App图标/头像' },
      { value: 'transparent-asset', label: '透明资产', desc: '透明背景Logo素材' },
    ],
    targetPlatforms: [
      { value: 'gpt-image', label: 'GPT Image' },
      { value: 'midjourney', label: 'Midjourney' },
      { value: 'flux', label: 'Flux' },
      { value: 'ideogram', label: 'Ideogram' },
      { value: 'all', label: '全部平台' },
    ],
  });
}

// ─── POST: 操作处理 ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'generate-directions':
        return handleGenerateDirections(body);
      case 'generate-image':
        return handleGenerateImage(body);
      case 'save-asset':
        return handleSaveAsset(body);
      case 'refine-direction':
        return handleRefineDirection(body);
      default:
        return NextResponse.json({ error: `不支持的操作: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[logo-skill] POST error:', message);
    return NextResponse.json({ error: `服务器错误: ${message}` }, { status: 500 });
  }
}

// ─── 生成 Logo 方向 ─────────────────────────────────────────────────

async function handleGenerateDirections(body: Record<string, unknown>) {
  const sanbaoInput = resolveSanbaoInput(body);
  if (!sanbaoInput) {
    return NextResponse.json({ error: '缺少必填参数: brandName + brief' }, { status: 400 });
  }

  const llmModel = body.llmModel as string | undefined;
  const llmProviderId = body.llmProviderId as string | undefined;

  // 1. 调用 LLM 生成方向
  const systemPrompt = buildDirectionSystemPrompt(sanbaoInput);
  const userMessage = buildDirectionUserMessage(sanbaoInput);

  const llmResult = await callLLM(userMessage, systemPrompt, llmModel, { maxTokens: 4096, temperature: 0.8 }, llmProviderId);
  if (!llmResult.success || !llmResult.content) {
    return NextResponse.json({ error: llmResult.error || 'LLM调用失败' }, { status: 500 });
  }

  // 2. 解析 LLM 响应为结构化数据
  const directionResult = parseDirectionResponse(llmResult.content);

  // 3. 生成多平台 Prompt
  const secondaryName = (body.englishName || body.chineseName) as string | undefined;
  const platformPrompts = selectPlatformPrompts({
    brandName: sanbaoInput.brand_name,
    direction: directionResult.direction,
    symbol: directionResult.symbol,
    visualNotes: directionResult.visualNotes,
    targetPlatform: (sanbaoInput.target_platform || 'all') as TargetPlatform,
    outputLayout: (sanbaoInput.output_layout || 'brand-system-board') as OutputLayout,
    includeEnglishName: !!secondaryName,
    englishName: secondaryName,
    includeChineseName: !!secondaryName, // 向后兼容
    chineseName: secondaryName, // 向后兼容
  });

  return NextResponse.json({
    success: true,
    direction: directionResult.direction,
    symbol: directionResult.symbol,
    visualNotes: directionResult.visualNotes,
    boardLayout: directionResult.boardLayout,
    platformPrompts,
    rawResponse: directionResult.rawResponse,
  });
}

// ─── 生成 Logo 图像 ─────────────────────────────────────────────────

async function handleGenerateImage(body: Record<string, unknown>) {
  const prompt = body.prompt as string;
  if (!prompt) {
    return NextResponse.json({ error: '缺少 prompt 参数' }, { status: 400 });
  }

  const imageModel = body.imageModel as string | undefined;
  const imageProviderId = body.imageProviderId as string | undefined;
  const quality = body.quality as string | undefined;
  const aspectRatio = (body.aspectRatio as string) || '1:1';
  const effectiveQuality = quality || '1K';
  const size = (body.size as string) || calculateActualPixelsFromRatio(aspectRatio, effectiveQuality, imageModel) || '1024x1024';
  const n = (body.n as number) || 1;

  const provider = await getImageProvider(imageModel, imageProviderId);
  if (!provider) {
    return NextResponse.json({ error: '未找到可用的图像模型提供商，请在管理员后台配置' }, { status: 400 });
  }

  const rawModel = imageModel || provider.selectedModels?.[0] || 'dall-e-3';
  const { apiModelName: model } = normalizeModelForApi(rawModel);
  if (model !== rawModel) {
    console.log(`[logo-skill] Model normalized: ${rawModel} → ${model}`);
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);

  // ★ 多提供商轮询：渠道耗尽时自动切换其他图像提供商
  const triedProviderIds = new Set<string>();
  if (provider.id) triedProviderIds.add(provider.id);

  const attemptGenerate = async (prov: ApiProvider, rawMdl: string): Promise<NextResponse> => {
    const { apiModelName: mdl } = normalizeModelForApi(rawMdl);
    const baseUrl = prov.baseUrl.replace(/\/+$/, '');
    const profile = resolveCompatProfile(prov);

    const rawBody: Record<string, unknown> = { model: mdl, prompt, n, size };
    if (quality) rawBody.quality = quality;
    const { body: reqBody, endpoint } = adjustRequestForProfile(rawBody, profile, {});

    const response = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${prov.apiKey}`,
      },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');

      if (isChannelUnavailableError(`${errText} ${response.status}`)) {
        console.info(`[logo-skill] Channel error with provider ${prov.name || prov.id}, trying /chat/completions fallback...`);
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl, apiKey: prov.apiKey, model: mdl, prompt, size,
            originalError: errText, requestIdPrefix: 'logo-skill', skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
            return NextResponse.json({ success: true, imageUrls: persistedUrls, imageModel: mdl });
          }
        } catch (chatErr) {
          console.warn('[logo-skill] /chat/completions fallback error:', chatErr);
        }

        // ★ 此提供商渠道不可用，抛出特定错误让外层尝试下一个提供商
        throw Object.assign(new Error(`CHANNEL_EXHAUSTED:${prov.id}`), { status: response.status, errText });
      }

      return NextResponse.json({ error: `图像生成失败(${response.status}): ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await response.json();
    const imageUrls = extractImageUrls(data);
    if (imageUrls.length === 0) {
      const taskId = extractTaskId(data);
      if (taskId) {
        return NextResponse.json({
          success: true, taskId, status: 'processing', imageModel: mdl,
          apiBaseUrl: baseUrl, apiKey: prov.apiKey,
        });
      }
      return NextResponse.json({ error: '图像生成返回格式异常，未找到图片URL' }, { status: 500 });
    }

    return NextResponse.json({ success: true, imageUrls, imageModel: mdl });
  };

  try {
    // 第一次尝试：使用选定的提供商
    return await attemptGenerate(provider, model);
  } catch (firstErr: unknown) {
    // 如果不是渠道耗尽错误，直接返回
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (!errMsg.startsWith('CHANNEL_EXHAUSTED')) {
      const isTimeout = firstErr instanceof Error && (firstErr.name === 'AbortError' || /timeout|aborted/i.test(firstErr.message));
      if (isTimeout) {
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl: provider.baseUrl.replace(/\/+$/, ''), apiKey: provider.apiKey, model, prompt, size,
            originalError: 'timeout', requestIdPrefix: 'logo-skill-timeout', skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
            return NextResponse.json({ success: true, imageUrls: persistedUrls, imageModel: model });
          }
        } catch (chatErr) {
          console.warn('[logo-skill] /chat/completions timeout fallback error:', chatErr);
        }
      }
      const message = firstErr instanceof Error ? firstErr.message : String(firstErr);
      return NextResponse.json({ error: `图像生成异常: ${message}` }, { status: 500 });
    }

    // 渠道耗尽 → 尝试其他提供商
    console.info('[logo-skill] Primary provider channel exhausted, trying alternative providers...');
    const { findAllProvidersForType } = await import('@/lib/server-api-config');
    const allProviderEntries = await findAllProvidersForType('image');
    const alternatives = allProviderEntries
      .filter((entry) => !triedProviderIds.has(entry.provider.id) && entry.models.length > 0)
      .map((entry) => ({ provider: entry.provider, model: entry.models[0] }));

    for (const { provider: altProvider, model: altModel } of alternatives) {
      console.info(`[logo-skill] Trying alternative provider: ${altProvider.name} (${altModel})`);
      try {
        const result = await attemptGenerate(altProvider, altModel);
        return result;
      } catch (altErr: unknown) {
        const altErrMsg = altErr instanceof Error ? altErr.message : String(altErr);
        if (altErrMsg.startsWith('CHANNEL_EXHAUSTED')) {
          triedProviderIds.add(altProvider.id || '');
          continue;
        }
        console.warn(`[logo-skill] Alternative provider ${altProvider.name} failed:`, altErrMsg);
        continue;
      }
    }

    return NextResponse.json({
      error: '所有图像提供商渠道均不可用，请稍后重试或在管理员后台添加新的API提供商',
    }, { status: 503 });
  }
}

// ─── 保存 Logo 资产 ─────────────────────────────────────────────────

async function handleSaveAsset(body: Record<string, unknown>) {
  // 保存到品牌工厂项目的品牌资产
  const projectId = body.projectId as string;
  const logoUrl = body.logoUrl as string;
  const directionData = body.directionData as Record<string, unknown>;

  if (!projectId || !logoUrl) {
    return NextResponse.json({ error: '缺少 projectId 或 logoUrl' }, { status: 400 });
  }

  // 返回保存结果（实际持久化由前端 localStorage + 品牌工厂处理）
  return NextResponse.json({
    success: true,
    asset: {
      id: `logo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      type: 'logo',
      url: logoUrl,
      directionData,
      createdAt: new Date().toISOString(),
    },
  });
}

// ─── 修订方向 ─────────────────────────────────────────────────────

async function handleRefineDirection(body: Record<string, unknown>) {
  const revisionNotes = body.revisionNotes as string;
  if (!revisionNotes) {
    return NextResponse.json({ error: '缺少 revisionNotes 参数' }, { status: 400 });
  }

  // 带修订意见的重新生成
  const modifiedBody = { ...body, revisionNotes };
  return handleGenerateDirections(modifiedBody);
}

// ─── 辅助函数 ─────────────────────────────────────────────────

function resolveSanbaoInput(body: Record<string, unknown>): SanbaoInput | null {
  // 方式1：从 BrandProject 适配
  if (body.brandProject) {
    return adaptBrandProjectToSanbaoInput(
      body.brandProject as Parameters<typeof adaptBrandProjectToSanbaoInput>[0],
      {
        outputLayout: (body.outputLayout as OutputLayout) || 'brand-system-board',
        targetPlatform: (body.targetPlatform as TargetPlatform) || 'all',
        revisionNotes: body.revisionNotes as string | undefined,
        renderImage: body.renderImage as boolean | undefined,
      }
    );
  }

  // 方式2：直接输入参数
  const brandName = body.brandName as string;
  const brief = body.brief as string;
  if (!brandName || !brief) return null;

  return buildSanbaoInputFromUserInput({
    brandName,
    brief,
    logoType: body.logoType as string | undefined,
    audience: body.audience as string | undefined,
    preferredStyle: body.preferredStyle as string | undefined,
    referenceStyle: body.referenceStyle as string | undefined,
    outputLayout: (body.outputLayout as OutputLayout) || 'brand-system-board',
    targetPlatform: (body.targetPlatform as TargetPlatform) || 'all',
    renderImage: body.renderImage as boolean | undefined,
    revisionNotes: body.revisionNotes as string | undefined,
  });
}

async function getImageProvider(imageModel?: string, imageProviderId?: string): Promise<ApiProvider | null> {
  if (imageProviderId) {
    const provider = await findProviderById(imageProviderId);
    if (provider) return provider;
  }
  if (imageModel) {
    const provider = await findProviderForModel(imageModel, 'image');
    if (provider) return provider;
  }
  return findProviderForFeature('imageEdit');
}

async function getLLMProvider(llmModel?: string, llmProviderId?: string): Promise<ApiProvider | null> {
  if (llmProviderId) {
    const provider = await findProviderById(llmProviderId);
    if (provider) return provider;
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
      // 尝试 /responses 端点
      if (response.status === 403 || response.status === 404 || response.status === 405) {
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
            if (content) return { success: true, content };
          }
        } catch { /* fallback */ }
      }
      return { success: false, error: `LLM调用失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    const contentType = response.headers.get('content-type') || '';
    let content = '';

    if (contentType.includes('text/event-stream')) {
      let text = '';
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        const readTimeout = setTimeout(() => reader.cancel(), 120_000);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.includes('[DONE]')) break;
          }
        } catch { /* timeout */ } finally {
          clearTimeout(readTimeout);
        }
      } else {
        text = await response.text();
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

function extractImageUrls(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // data.data[].url / b64_json
  const dataArr = data.data;
  if (Array.isArray(dataArr)) {
    for (const item of dataArr) {
      if (typeof item === 'object' && item !== null) {
        const url = (item as Record<string, unknown>).url;
        const b64 = (item as Record<string, unknown>).b64_json;
        if (typeof url === 'string') urls.push(url);
        if (typeof b64 === 'string') urls.push(`data:image/png;base64,${b64}`);
      }
    }
  }

  // data.output.image_urls[]
  const output = data.output;
  if (typeof output === 'object' && output !== null) {
    const imageUrls = (output as Record<string, unknown>).image_urls;
    if (Array.isArray(imageUrls)) {
      for (const u of imageUrls) {
        if (typeof u === 'string') urls.push(u);
      }
    }
  }

  return urls;
}

function extractTaskId(data: Record<string, unknown>): string | null {
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const dataObj = data.data as Record<string, unknown>;
    if (dataObj.task_id) return dataObj.task_id as string;
    if (dataObj.id && !dataObj.task_id) return dataObj.id as string;
  }
  if (data.task_id) return data.task_id as string;
  if (data.id) return data.id as string;
  return null;
}
