import { NextRequest, NextResponse } from 'next/server';
import { getApiProvider, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { resolveCompatProfile, type ApiCompatProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/verify-protocol
 * API 协议一键验证 — 检测 API 端点的请求格式、响应模式、支持的功能
 *
 * Body: { providerId?: string, baseUrl?: string, apiKey?: string, advancedParams?: Record<string, string> }
 * Response: { success, profile, features, tests }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { baseUrl, apiKey, advancedParams } = body;

    let requestStyle: string | undefined;

    // 支持 providerId 查找
    if (body.providerId && !baseUrl) {
      const provider = await getApiProvider(body.providerId);
      if (!provider) {
        return NextResponse.json({ success: false, error: '未找到该 API 配置' }, { status: 404 });
      }
      baseUrl = provider.baseUrl;
      apiKey = provider.apiKey;
      requestStyle = provider.requestStyle;
      advancedParams = provider.advancedParams;
    } else {
      requestStyle = body.requestStyle;
    }

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ success: false, error: '缺少 Base URL 或 API Key' }, { status: 400 });
    }

    const cleanBaseUrl = normalizeApiBaseUrl(baseUrl);
    const profile: ApiCompatProfile = resolveCompatProfile({ baseUrl: cleanBaseUrl, requestStyle, advancedParams });

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Apply advanced params as headers
    if (Array.isArray(advancedParams)) {
      for (const param of advancedParams) {
        if (param.key?.trim() && param.value !== undefined) {
          headers[param.key.trim()] = String(param.value);
        }
      }
    } else if (advancedParams && typeof advancedParams === 'object') {
      for (const [key, value] of Object.entries(advancedParams)) {
        if (key.trim()) headers[key.trim()] = String(value);
      }
    }

    const tests: Array<{
      name: string;
      endpoint: string;
      status: 'pass' | 'fail' | 'warn';
      detail: string;
      latencyMs?: number;
    }> = [];

    // ─── Test 1: Models 列表 ────────────────────────────────────
    {
      const start = Date.now();
      try {
        const resp = await fetchWithV1Retry(cleanBaseUrl, '/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        const latencyMs = Date.now() - start;
        if (resp.ok) {
          const data = await resp.json();
          const modelCount = Array.isArray(data.data) ? data.data.length : 0;
          tests.push({
            name: '模型列表',
            endpoint: '/models',
            status: 'pass',
            detail: `发现 ${modelCount} 个模型`,
            latencyMs,
          });
        } else if (resp.status === 401 || resp.status === 403) {
          tests.push({
            name: '模型列表',
            endpoint: '/models',
            status: 'fail',
            detail: `认证失败 (${resp.status})`,
            latencyMs,
          });
        } else {
          tests.push({
            name: '模型列表',
            endpoint: '/models',
            status: 'warn',
            detail: `返回 ${resp.status}，可能不支持模型列表`,
            latencyMs,
          });
        }
      } catch (err) {
        tests.push({
          name: '模型列表',
          endpoint: '/models',
          status: 'warn',
          detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}`,
        });
      }
    }

    // ─── Test 2: 图片生成端点 ──────────────────────────────────
    {
      const start = Date.now();
      try {
        const endpoint = profile.defaultEndpoint === '/images/edits' ? '/images/edits' : '/images/generations';
        const resp = await fetchWithV1Retry(cleanBaseUrl, endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'test-verify',
            prompt: 'test',
            n: 1,
            size: '1024x1024',
          }),
          signal: AbortSignal.timeout(15000),
        });
        const latencyMs = Date.now() - start;

        if (resp.status === 401 || resp.status === 403) {
          tests.push({
            name: '图片生成',
            endpoint,
            status: 'fail',
            detail: `认证失败 (${resp.status})`,
            latencyMs,
          });
        } else if (resp.status === 404) {
          // 端点不存在，尝试另一个
          const altEndpoint = profile.defaultEndpoint === '/images/edits' ? '/images/generations' : '/images/edits';
          tests.push({
            name: '图片生成',
            endpoint,
            status: 'warn',
            detail: `${endpoint} 不存在 (404)，可尝试 ${altEndpoint}`,
            latencyMs,
          });
        } else if (resp.status === 400 || resp.status === 422) {
          // 模型不存在但端点可达 = API可用
          tests.push({
            name: '图片生成',
            endpoint,
            status: 'pass',
            detail: `端点可达 (${resp.status})，需配置正确模型名`,
            latencyMs,
          });
        } else if (resp.status === 429) {
          tests.push({
            name: '图片生成',
            endpoint,
            status: 'pass',
            detail: '端点可达，但触发限流（429）',
            latencyMs,
          });
        } else if (resp.ok) {
          // 可能直接返回了结果
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.includes('event-stream') || contentType.includes('text/')) {
            tests.push({
              name: '图片生成',
              endpoint,
              status: 'pass',
              detail: '端点可达，返回流式响应（异步模式）',
              latencyMs,
            });
          } else {
            try {
              const data = await resp.json();
              const hasTaskId = !!(data as Record<string, unknown>).task_id || !!((data as Record<string, unknown>).data as Record<string, unknown>)?.task_id;
              tests.push({
                name: '图片生成',
                endpoint,
                status: 'pass',
                detail: hasTaskId ? '端点可达，异步模式（返回 task_id）' : '端点可达，直接模式（返回图片）',
                latencyMs,
              });
            } catch {
              tests.push({
                name: '图片生成',
                endpoint,
                status: 'pass',
                detail: '端点可达',
                latencyMs,
              });
            }
          }
        } else {
          tests.push({
            name: '图片生成',
            endpoint,
            status: 'warn',
            detail: `返回 ${resp.status}`,
            latencyMs,
          });
        }
      } catch (err) {
        tests.push({
          name: '图片生成',
          endpoint: '/images/generations',
          status: 'fail',
          detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}`,
        });
      }
    }

    // ─── Test 3: Chat 端点 ─────────────────────────────────────
    {
      const start = Date.now();
      try {
        const resp = await fetchWithV1Retry(cleanBaseUrl, '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'test-verify',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
            stream: false,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const latencyMs = Date.now() - start;

        if (resp.status === 401 || resp.status === 403) {
          tests.push({ name: '对话模型', endpoint: '/chat/completions', status: 'fail', detail: `认证失败 (${resp.status})`, latencyMs });
        } else if (resp.status === 404) {
          tests.push({ name: '对话模型', endpoint: '/chat/completions', status: 'warn', detail: '端点不存在 (404)', latencyMs });
        } else {
          tests.push({ name: '对话模型', endpoint: '/chat/completions', status: 'pass', detail: `端点可达 (${resp.status})`, latencyMs });
        }
      } catch (err) {
        tests.push({ name: '对话模型', endpoint: '/chat/completions', status: 'warn', detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}` });
      }
    }

    // ─── 汇总 ──────────────────────────────────────────────────
    const passCount = tests.filter(t => t.status === 'pass').length;
    const failCount = tests.filter(t => t.status === 'fail').length;
    const warnCount = tests.filter(t => t.status === 'warn').length;

    return NextResponse.json({
      success: failCount === 0,
      profile: {
        id: profile.id,
        defaultEndpoint: profile.defaultEndpoint,
        responseMode: profile.responseMode,
      },
      tests,
      summary: `${passCount} 通过, ${warnCount} 警告, ${failCount} 失败`,
    });
  } catch (err) {
    console.error('[verify-protocol] Error:', err);
    return NextResponse.json(
      { success: false, error: '验证失败: ' + (err instanceof Error ? err.message : '未知错误') },
      { status: 500 }
    );
  }
}
