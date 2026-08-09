import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';
import { logOperation, OP_ACTIONS } from '@/lib/op-log';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

const PROMPT_REVIEW_SYSTEM = `You are a professional AI image generation director. Analyze the user's request and produce a structured prompt review.

You MUST respond with valid JSON only (no markdown, no code fences, no explanation outside JSON).

JSON schema:
{
  "summary": "一句话概括即将生成的内容（中文，≤30字）",
  "enhancedPrompt": "优化后的专业提示词，双语：第一行中文关键词，第二行英文关键词",
  "suggestedRatio": "推荐画面比例，必须是以下之一: 1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3",
  "suggestedQuality": "推荐质量级别: standard 或 hd",
  "analysis": "简要分析（中文，≤50字），说明为什么这样优化"
}

Rules:
1. Preserve the user's original intent — do not change what they want to create
2. Add concrete visual details: lighting, color, material, composition, camera, atmosphere
3. Choose the most appropriate aspect ratio based on the content (portrait→3:4/9:16, landscape→16:9/4:3, square→1:1)
4. For complex/detailed scenes, recommend "hd" quality; for simple icons/quick drafts, recommend "standard"
5. The enhancedPrompt should be richer than the original but not overly long (≤200 chars per language)
6. Output JSON only, no other text`;

interface PromptReviewResult {
  summary: string;
  enhancedPrompt: string;
  suggestedRatio: string;
  suggestedQuality: string;
  analysis: string;
}

function splitProviderModel(model?: string, providerId?: string) {
  if (model && model.includes('::')) {
    const [derivedProviderId, ...rest] = model.split('::');
    return {
      providerId: providerId || derivedProviderId,
      model: rest.join('::') || DEFAULT_MODEL,
    };
  }
  return { providerId, model: model || DEFAULT_MODEL };
}

function normalizeChatBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function parsePromptReviewResponse(content: string): PromptReviewResult | null {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(content);
    if (parsed.enhancedPrompt && parsed.suggestedRatio) {
      return parsed;
    }
  } catch {
    // Not pure JSON, try to extract from markdown code block
  }

  // Extract from ```json ... ``` block (with closing ```)
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.enhancedPrompt && parsed.suggestedRatio) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  // Extract from ```json ... (without closing ``` — LLM may have been cut off)
  const openBlockMatch = content.match(/```(?:json)?\s*([\s\S]+)/);
  if (openBlockMatch) {
    const blockContent = openBlockMatch[1].trim();
    // Try to find the JSON object within the block
    const objInBlock = blockContent.match(/\{[\s\S]*\}/);
    if (objInBlock) {
      try {
        const parsed = JSON.parse(objInBlock[0]);
        if (parsed.enhancedPrompt && parsed.suggestedRatio) {
          return parsed;
        }
      } catch {
        // Try to fix common JSON issues: trailing comma, unescaped newlines
        try {
          const fixed = objInBlock[0]
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');
          const parsed = JSON.parse(fixed);
          if (parsed.enhancedPrompt && parsed.suggestedRatio) {
            return parsed;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Try to find JSON object in raw text
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.enhancedPrompt && parsed.suggestedRatio) {
        return parsed;
      }
    } catch {
      // Try to fix common JSON issues
      try {
        const fixed = objectMatch[0]
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        const parsed = JSON.parse(fixed);
        if (parsed.enhancedPrompt && parsed.suggestedRatio) {
          return parsed;
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  let deductedCredits = 0;
  let sessionUser: import('@/lib/user-types').User | null = null;
  const startTime = Date.now();

  try {
    const {
      prompt,
      model,
      providerId,
      userId: requestUserId,
    } = await request.json();

    const _validationError = validateApiInputs({ prompt }, { prompt: 'prompt' });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id || 'anonymous';

    if (!prompt) {
      return NextResponse.json({ error: '缺少必要参数：prompt' }, { status: 400 });
    }

    // Content safety
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    // Credits
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'chat', undefined, undefined, model);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // Resolve provider
    const resolved = splitProviderModel(model, providerId);
    let selectedModel = resolved.model;
    let apiKey = '';
    let baseUrl = '';
    let resolvedProviderId = resolved.providerId;

    if (resolvedProviderId) {
      const provider = (await getApiProviders()).find(item => item.id === resolvedProviderId && item.isEnabled);
      if (!provider) {
        return NextResponse.json({ error: '未找到可用的后台模型提供商配置' }, { status: 400 });
      }
      apiKey = provider.apiKey;
      baseUrl = normalizeChatBaseUrl(provider.baseUrl);
      selectedModel = selectedModel || provider.selectedModels?.[0] || DEFAULT_MODEL;
    } else if (selectedModel && selectedModel !== DEFAULT_MODEL) {
      const provider = await findProviderForModel(selectedModel, 'chat');
      if (provider?.apiKey) {
        resolvedProviderId = provider.id;
        apiKey = provider.apiKey;
        baseUrl = normalizeChatBaseUrl(provider.baseUrl);
      }
    }

    if (!apiKey) {
      const allProviders = await getApiProviders();
      const chatProvider = allProviders.find(p =>
        p.isEnabled && (p.type === 'chat' || p.modelType === 'chat') && p.apiKey
      );
      if (chatProvider) {
        resolvedProviderId = chatProvider.id;
        apiKey = chatProvider.apiKey;
        baseUrl = normalizeChatBaseUrl(chatProvider.baseUrl);
        selectedModel = chatProvider.selectedModels?.[0] || chatProvider.selectedModel || DEFAULT_MODEL;
      }
    }

    if (!apiKey) {
      return NextResponse.json({ error: '请先在管理员后台配置可用的 LLM 模型 API' }, { status: 400 });
    }

    const { apiModelName: normalizedModel } = normalizeModelForApi(selectedModel);

    const userMessage = `请分析以下图像生成请求，并生成提示词确认方案：\n\n${prompt}`;

    const response = await fetchWithV1Retry(
      baseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: normalizedModel,
          messages: [
            { role: 'system', content: PROMPT_REVIEW_SYSTEM },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.6,
          max_tokens: 1200,
          stream: false,
        }),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[prompt-review] API error:', response.status, errorText);
      // Refund on failure
      if (deductedCredits > 0 && sessionUser) {
        await refundCredits(sessionUser.id, deductedCredits, '提示词确认失败退款', undefined);
      }
      return NextResponse.json(
        { error: `AI模型请求失败 (${response.status})` },
        { status: response.status },
      );
    }

    let data = await response.json();
    // Unwrap APImart style response
    if (data.code === 200 && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      data = data.data;
    }

    const content = data.choices?.[0]?.message?.content || '';

    const reviewResult = parsePromptReviewResponse(content);

    if (!reviewResult) {
      console.warn('[prompt-review] Failed to parse LLM response (length=' + content.length + '):', content.slice(0, 500));
      // Refund on parse failure
      if (deductedCredits > 0 && sessionUser) {
        await refundCredits(sessionUser.id, deductedCredits, '提示词确认解析失败退款', undefined);
      }
      return NextResponse.json({
        success: false,
        error: 'AI模型返回格式异常，请重试',
      }, { status: 502 });
    }

    // Validate ratio
    const validRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3'];
    if (!validRatios.includes(reviewResult.suggestedRatio)) {
      reviewResult.suggestedRatio = '1:1';
    }
    if (!['standard', 'hd'].includes(reviewResult.suggestedQuality)) {
      reviewResult.suggestedQuality = 'standard';
    }

    void logOperation({
      action: OP_ACTIONS.PROMPT_REVIEW,
      userId,
      level: 'info',
      durationMs: Date.now() - startTime,
      model: normalizedModel,
      providerId: resolvedProviderId,
    });

    return NextResponse.json({
      success: true,
      ...reviewResult,
      originalPrompt: prompt,
    });

  } catch (error) {
    console.error('[prompt-review] Error:', error);
    if (deductedCredits > 0 && sessionUser) {
      await refundCredits(sessionUser.id, deductedCredits, '提示词确认异常退款', undefined);
    }
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
