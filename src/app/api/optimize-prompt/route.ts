import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders } from '@/lib/server-api-config';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const DEFAULT_BASE_URL = '';
const DEFAULT_MODEL = 'gemini-3-flash-preview';

const OPTIMIZE_SYSTEM_PROMPT = `You are a professional AI image prompt optimizer. Transform a simple user image description into a high quality generation prompt.

Rules:
1. Preserve the user's original intent.
2. Add concrete visual details: lighting, color, material, composition, camera, atmosphere.
3. Output bilingual keywords: first line in Chinese, second line in English.
4. Do NOT include any thinking process, explanation, reasoning, or analysis.
5. Do NOT include any formatting markers like 【】 or **.
6. Each line should be a comma-separated list of keywords/phrases only.
7. Example output format:
蓝天白云, 金色阳光, 梦幻森林, 精灵少女, 唯美插画
blue sky white clouds, golden sunlight, dreamy forest, elf girl, aesthetic illustration`;

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

export async function POST(request: NextRequest) {
  try {
    const {
      prompt,
      model,
      mode,
      providerId,
      systemPrompt: customSystemPrompt,
      userId: requestUserId,
    } = await request.json();
    const sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

    if (!prompt) {
      return NextResponse.json({ error: '缺少必要参数：prompt' }, { status: 400 });
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    const resolved = splitProviderModel(model, providerId);
    let selectedModel = resolved.model;
    let apiKey = '';
    let baseUrl = DEFAULT_BASE_URL;
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
      // 客户端指定了模型，尝试查找对应 provider
      const provider = await findProviderForModel(selectedModel, 'chat');
      if (provider?.apiKey) {
        resolvedProviderId = provider.id;
        apiKey = provider.apiKey;
        baseUrl = normalizeChatBaseUrl(provider.baseUrl);
      }
    }

    // 如果仍未找到 API key，自动查找第一个可用的 chat 类型 provider
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

    const systemPrompt = customSystemPrompt || OPTIMIZE_SYSTEM_PROMPT;
    const userMessage = `请优化以下图像生成提示词：\n\n${prompt}`;

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
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: mode === 'simplify' ? 0.4 : 0.7,
          max_tokens: 1000,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Optimize prompt API error:', response.status, errorText);
      return NextResponse.json(
        { error: `AI模型请求失败 (${response.status})` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const optimizedText = data.choices?.[0]?.message?.content || '';

    if (!optimizedText.trim()) {
      return NextResponse.json({ error: 'AI模型返回了空结果，请重试' }, { status: 500 });
    }

    await appendUserJsonl(userId, 'chat', {
      type: 'optimize-prompt',
      model: selectedModel,
      providerId: resolvedProviderId,
      mode,
    });

    return NextResponse.json({
      success: true,
      optimized: optimizedText.trim(),
      model: selectedModel,
      providerId: resolvedProviderId,
    });
  } catch (error) {
    console.error('Optimize prompt error:', error);
    return NextResponse.json(
      { error: `优化失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 },
    );
  }
}
