import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { model, messages, stream = true, providerId, userId: requestUserId } = await request.json();
    const sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

    if (!model || !messages) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // Content safety check on the latest user message
    const lastUserMsg = messages.filter((m: { role: string }) => m.role === 'user').pop();
    if (lastUserMsg) {
      const promptText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
      const safetyResult = checkPromptSafety(promptText);
      if (safetyResult.level === 'block') {
        return NextResponse.json({ error: safetyResult.reason }, { status: 400 });
      }
      if (safetyResult.level === 'warning') {
        logSafetyWarning(promptText, safetyResult);
      }
    }

    // 检查是否是第三方模型
    let chatApiKey = '';
    let chatBaseUrl = 'https://api.apimart.ai/v1';

    if (providerId) {
      // 第三方模型 - 从 UniversalApiManager 获取配置
      // 第三方模型 - 从服务端配置获取
      const provider = (await getApiProviders()).find(item => item.id === providerId);
      if (provider) {
        chatApiKey = provider.apiKey;
        chatBaseUrl = normalizeApiBaseUrl(provider.baseUrl);
      } else {
        return NextResponse.json({ error: '未找到对应的模型提供商' }, { status: 400 });
      }
    } else {
      // 默认查找管理员配置的提供商
      const provider = await findProviderForModel(model, 'chat');
      chatApiKey = provider?.apiKey || '';
      if (provider?.baseUrl) {
        chatBaseUrl = provider.baseUrl.replace(/\/+$/, '');
      }
    }

    if (!chatApiKey) {
      return NextResponse.json({ error: '请先在管理员后台配置可用模型' }, { status: 400 });
    }

    // Detect thinking mode: model name ends with -thinking
    const isThinkingModel = model.endsWith('-thinking');
    const baseModel = isThinkingModel ? model.replace(/-thinking$/, '') : model;

    // Use base model name for the API call (most providers don't support -thinking suffix)
    // but send thinking-related parameters if the provider supports it
    const requestModel = baseModel;

    const requestBody: Record<string, unknown> = {
      model: requestModel,
      messages,
      stream,
      temperature: 0.7,
    };

    // For thinking mode, add reasoning parameters for compatible providers
    if (isThinkingModel) {
      // OpenAI-compatible: reasoning_effort
      // Some providers support this, others ignore it
      requestBody.reasoning_effort = 'medium';
    }

    const response = await fetchWithV1Retry(
      chatBaseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${chatApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      }
    );

    // If API call fails with the base model and thinking params, try the -thinking model name as fallback
    if (!response.ok && isThinkingModel) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[chat] Base model ${requestModel} with thinking params failed (${response.status}), trying ${model}...`);
      
      const retryBody = { model, messages, stream, temperature: 0.7 };
      const retryResponse = await fetchWithV1Retry(
        chatBaseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${chatApiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal: AbortSignal.timeout(120000),
        }
      );
      
      if (!retryResponse.ok) {
        const retryError = await retryResponse.text().catch(() => '');
        console.error('Chat API error (both attempts):', errorText, retryError);
        return NextResponse.json({ error: `API 调用失败: ${retryResponse.status}` }, { status: retryResponse.status });
      }
      
      // Use retry response for streaming/non-streaming
      if (stream && retryResponse.body) {
        await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
        return new NextResponse(retryResponse.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
      const retryData = await retryResponse.json();
      await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
      return NextResponse.json(retryData);
    }

    // Primary response (non-thinking or thinking with base model succeeded)

    // If response error
    if (!response.ok) {
      const error = await response.text().catch(() => '');
      console.error('Chat API error:', error);
      return NextResponse.json({ error: `API 调用失败: ${response.status}` }, { status: response.status });
    }

    // Stream response: forward directly
    if (stream && response.body) {
      await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-stream response
    const data = await response.json();
    await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
    return NextResponse.json(data);

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: `服务器错误: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
