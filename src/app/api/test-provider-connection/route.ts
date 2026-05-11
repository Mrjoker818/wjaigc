import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, requestStyle, advancedParams } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ success: false, error: '缺少 Base URL 或 API Key' }, { status: 400 });
    }

    // Build headers from base + advanced params
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Apply advanced params as headers
    if (Array.isArray(advancedParams)) {
      for (const param of advancedParams) {
        if (param.key && param.key.trim() && param.value !== undefined) {
          headers[param.key.trim()] = String(param.value);
        }
      }
    }

    // Determine the test endpoint based on requestStyle
    const style = requestStyle || 'images-generations';
    let testUrl: string;

    if (style === 'chat-completions') {
      testUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      // Send a minimal chat request
      const testBody = {
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(testUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(testBody),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // Even if the model doesn't exist, a valid API will return a structured error
        // Only connection failures or auth failures mean the connection is bad
        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({
            success: false,
            error: `认证失败 (${response.status})：API Key 无效或无权限`,
            status: response.status,
          });
        }

        if (response.status === 404) {
          return NextResponse.json({
            success: false,
            error: `端点不存在 (${response.status})：请检查 Base URL 是否正确`,
            status: response.status,
          });
        }

        // 200, 400 (model not found), 422 (validation) all indicate the connection works
        const data = await response.json().catch(() => null);
        return NextResponse.json({
          success: response.ok || [400, 422].includes(response.status),
          status: response.status,
          error: response.ok ? undefined : (data?.error?.message || data?.message || `HTTP ${response.status}`),
          info: response.ok ? '连接成功' : 'API 可达，但请求有误（模型不存在或参数错误），连接本身正常',
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const msg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        if (msg.includes('abort')) {
          return NextResponse.json({ success: false, error: '连接超时（10秒），请检查 Base URL 是否正确' });
        }
        return NextResponse.json({ success: false, error: `连接失败：${msg}` });
      }
    } else {
      // For images-generations or auto, try the models list endpoint first
      testUrl = `${baseUrl.replace(/\/+$/, '')}/models`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(testUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({
            success: false,
            error: `认证失败 (${response.status})：API Key 无效或无权限`,
            status: response.status,
          });
        }

        if (response.status === 404) {
          // /models not found, try a direct generate endpoint
          const generateUrl = `${baseUrl.replace(/\/+$/, '')}/images/generations`;
          const genController = new AbortController();
          const genTimeout = setTimeout(() => genController.abort(), 10000);

          try {
            const genResponse = await fetch(generateUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model: 'test', prompt: 'test', n: 1, size: '256x256' }),
              signal: genController.signal,
            });
            clearTimeout(genTimeout);

            if (genResponse.status === 401 || genResponse.status === 403) {
              return NextResponse.json({
                success: false,
                error: `认证失败 (${genResponse.status})：API Key 无效或无权限`,
                status: genResponse.status,
              });
            }

            return NextResponse.json({
              success: genResponse.ok || [400, 422].includes(genResponse.status),
              status: genResponse.status,
              info: 'API 可达（/models 不可用，但生成端点可达）',
            });
          } catch {
            return NextResponse.json({ success: false, error: '连接失败：/models 和生成端点均不可达' });
          }
        }

        const data = await response.json().catch(() => null);
        const modelCount = Array.isArray(data?.data) ? data.data.length : undefined;

        return NextResponse.json({
          success: true,
          status: response.status,
          modelCount,
          info: modelCount !== undefined ? `连接成功，发现 ${modelCount} 个模型` : '连接成功',
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const msg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        if (msg.includes('abort')) {
          return NextResponse.json({ success: false, error: '连接超时（10秒），请检查 Base URL 是否正确' });
        }
        return NextResponse.json({ success: false, error: `连接失败：${msg}` });
      }
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Test connection failed',
    }, { status: 500 });
  }
}
