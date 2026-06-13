import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { optionalApiAuth } from '@/lib/api-auth';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { consumeCredits } from '@/lib/credits';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    await optionalApiAuth(request);
    const { model, messages, stream = true, providerId, userId: requestUserId } = await request.json();
    const sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";

    // 积分扣除（登录用户才扣积分）
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'chat');
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
    }

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

    // Convert relative image URLs to absolute URLs so upstream API can fetch them
    const origin = request.headers.get('origin') || process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const fixedMessages = messages.map((msg: { role: string; content: unknown }) => {
      if (Array.isArray(msg.content)) {
        const fixedContent = msg.content.map((part: { type?: string; image_url?: { url?: string } }) => {
          if (part.type === 'image_url' && part.image_url?.url && part.image_url.url.startsWith('/')) {
            return { ...part, image_url: { ...part.image_url, url: `${origin}${part.image_url.url}` } };
          }
          return part;
        });
        return { ...msg, content: fixedContent };
      }
      return msg;
    });

    const requestBody: Record<string, unknown> = {
      model: requestModel,
      messages: fixedMessages,
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
      
      const retryBody = { model, messages: fixedMessages, stream, temperature: 0.7 };
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
        // Try to extract meaningful error message from 4sapi/distributor responses
        let apiErrMsg = `API 调用失败: ${retryResponse.status}`;
        try {
          const ej = JSON.parse(retryError);
          apiErrMsg = ej.error?.message || ej.message || ej.msg || apiErrMsg;
        } catch { /* not JSON, use default */ }
        if (/no\s+available\s+channel/i.test(retryError)) {
          apiErrMsg = '当前模型渠道暂不可用，请稍后重试或更换模型';
        }
        return NextResponse.json({ error: apiErrMsg }, { status: retryResponse.status });
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

      // Fallback: if /chat/completions returns 403 and error mentions /responses,
      // retry with OpenAI Responses API format
      if (response.status === 403 && error.includes('/responses')) {
        console.info('[chat] /chat/completions not allowed, retrying with /responses endpoint...');
        try {
          const responsesBody: Record<string, unknown> = {
            model: requestModel,
            input: fixedMessages,
            stream,
          };

          const responsesRes = await fetchWithV1Retry(
            chatBaseUrl,
            '/responses',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${chatApiKey}`,
              },
              body: JSON.stringify(responsesBody),
              signal: AbortSignal.timeout(120000),
            }
          );

          if (!responsesRes.ok) {
            const retryErr = await responsesRes.text().catch(() => '');
            console.error('Chat API /responses fallback error:', retryErr);
            return NextResponse.json({ error: `API 调用失败: ${responsesRes.status}` }, { status: responsesRes.status });
          }

          // Stream response from /responses
          if (stream && responsesRes.body) {
            await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
            return new NextResponse(responsesRes.body, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              },
            });
          }

          // Non-stream: convert Responses API output to chat/completions format
          const respData = await responsesRes.json();
          const outputText = Array.isArray(respData.output)
            ? respData.output
                .filter((o: { type: string }) => o.type === 'message')
                .flatMap((o: { content: Array<{ text: string }> }) => o.content?.map((c: { text: string }) => c.text) || [])
                .join('')
            : respData.output_text || JSON.stringify(respData.output || '');

          await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
          return NextResponse.json({
            id: respData.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: requestModel,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: outputText },
              finish_reason: 'stop',
            }],
            usage: respData.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        } catch (fallbackErr) {
          console.error('Chat API /responses fallback exception:', fallbackErr);
          return NextResponse.json({ error: `API 调用失败: ${response.status}` }, { status: response.status });
        }
      }

      // ★ 渠道不可用 / 模型未找到 — 提供更明确提示
      if (error.includes('No available channel') || error.includes('model_not_found') || error.includes('not configured')) {
        return NextResponse.json({ error: `模型 ${model || requestModel} 在当前渠道暂不可用，请稍后重试或更换模型` }, { status: 503 });
      }

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
