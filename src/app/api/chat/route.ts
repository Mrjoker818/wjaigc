import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { model, messages, stream = true, providerId, userId: requestUserId } = await request.json();
    const sessionUser = await getSessionUser(request);
    const userId = (sessionUser?.id || "anonymous") || requestUserId;

    if (!model || !messages) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
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
      // 默认使用 APIMart
      const provider = await findProviderForModel(model, 'chat');
      chatApiKey = provider?.apiKey || process.env.APIMART_API_KEY || '';
      if (provider?.baseUrl) {
        chatBaseUrl = provider.baseUrl.replace(/\/+$/, '');
      }
    }

    if (!chatApiKey) {
      return NextResponse.json({ error: '请先在管理员后台配置可用模型' }, { status: 400 });
    }

    const requestBody = {
      model,
      messages,
      stream,
      temperature: 0.7,
    };

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
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Chat API error:', error);
      return NextResponse.json({ error: `API 调用失败: ${response.status}` }, { status: response.status });
    }

    // 如果是流式响应，直接转发
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

    // 非流式响应
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
