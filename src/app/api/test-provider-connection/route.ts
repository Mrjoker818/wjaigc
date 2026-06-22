import { NextRequest, NextResponse } from 'next/server';
import { getApiProvider } from '@/lib/server-api-config';
import { fetchWithV1Retry, shouldSkipV1Retry } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { baseUrl, apiKey, requestStyle, advancedParams } = body;

    // Support providerId lookup — if providerId is given, load from server config
    if (body.providerId && !baseUrl) {
      const provider = await getApiProvider(body.providerId);
      if (!provider) {
        return NextResponse.json({ success: false, error: '未找到该 API 配置' }, { status: 404 });
      }
      baseUrl = provider.baseUrl;
      apiKey = provider.apiKey;
      requestStyle = provider.requestStyle;
      advancedParams = provider.advancedParams;
    }

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
    let testUrl: string | undefined;

    if (style === 'chat-completions') {
      const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        // Use fetchWithV1Retry to handle APIs that need /v1 prefix
        const response = await fetchWithV1Retry(cleanBaseUrl, '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'test',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
            stream: false,
          }),
          signal: controller.signal,
          skipV1Retry: shouldSkipV1Retry(cleanBaseUrl),
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

        // 200: OK
        // 400 (model not found / bad request): connection works
        // 422 (validation error): connection works
        // 429 (rate limit): connection works, just throttled
        // 500+ (server error but responded): API reachable, connection works
        // Only 401/403 (auth failure) and 404 (wrong endpoint) mean connection is bad
        const data = await response.json().catch(() => null);
        const isConnectionOk = response.ok || [400, 422, 429].includes(response.status) || response.status >= 500;
        return NextResponse.json({
          success: isConnectionOk,
          status: response.status,
          error: response.ok ? undefined : (data?.error?.message || data?.message || `HTTP ${response.status}`),
          info: response.ok ? '连接成功' : (isConnectionOk ? 'API 可达，但请求有误（模型不存在/限流/服务暂时不可用），连接本身正常' : undefined),
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
      // Use fetchWithV1Retry to handle APIs like 302.ai that need /v1 prefix
      const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetchWithV1Retry(cleanBaseUrl, '/models', {
          method: 'GET',
          headers,
          signal: controller.signal,
          skipV1Retry: shouldSkipV1Retry(cleanBaseUrl),
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
          const genController = new AbortController();
          const genTimeout = setTimeout(() => genController.abort(), 15000);

          try {
            const genResponse = await fetchWithV1Retry(cleanBaseUrl, '/images/generations', {
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
              success: genResponse.ok || [400, 422, 429].includes(genResponse.status) || genResponse.status >= 500,
              status: genResponse.status,
              info: 'API 可达（/models 不可用，但生成端点可达）',
            });
          } catch {
            return NextResponse.json({ success: false, error: '连接失败：/models 和生成端点均不可达' });
          }
        }

        const data = await response.json().catch(() => null);

        // If response is not JSON (e.g. HTML error page), API endpoint is wrong
        if (data === null) {
          return NextResponse.json({
            success: false,
            error: 'API 返回了非 JSON 响应，请检查 Base URL 是否正确',
          });
        }

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
