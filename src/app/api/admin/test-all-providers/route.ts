import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { getApiProviders } from '@/lib/server-api-config';
import { resolveCompatProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface TestResult {
  providerId: string;
  providerName: string;
  modelType: string;
  baseUrl: string;
  tests: Array<{
    name: string;
    endpoint: string;
    status: 'pass' | 'fail' | 'warn';
    detail: string;
    latencyMs?: number;
    totalTimeMs?: number;
    error?: string;
  }>;
  overall: 'pass' | 'warn' | 'fail';
}

async function testProvider(
  provider: { id: string; name: string; displayName?: string; baseUrl: string; apiKey: string; modelType: string; selectedModels?: string[]; advancedParams?: any; requestStyle?: string }
): Promise<TestResult> {
  const { id, name, baseUrl, apiKey, modelType, selectedModels = [], advancedParams, requestStyle } = provider;
  const displayName = provider.displayName || name;
  const tests: TestResult['tests'] = [];

  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  let profile: ReturnType<typeof resolveCompatProfile> | null = null;
  try {
    profile = resolveCompatProfile({ baseUrl: cleanBaseUrl, requestStyle, advancedParams });
  } catch { /* ignore */ }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (Array.isArray(advancedParams)) {
    for (const param of advancedParams) {
      if (param.key?.trim() && param.value !== undefined && param.key.trim() !== 'compatProfile') {
        headers[param.key.trim()] = String(param.value);
      }
    }
  } else if (advancedParams && typeof advancedParams === 'object') {
    for (const [key, value] of Object.entries(advancedParams)) {
      if (key.trim() && key.trim() !== 'compatProfile') headers[key.trim()] = String(value);
    }
  }

  // Test 1: Models list
  const modelStart = Date.now();
  let modelCount = 0;
  try {
    const resp = await fetchWithV1Retry(cleanBaseUrl, '/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - modelStart;
    if (resp.ok) {
      const data = await resp.json();
      modelCount = Array.isArray(data.data) ? data.data.length : 0;
      tests.push({
        name: '模型列表',
        endpoint: '/models',
        status: 'pass',
        detail: `发现 ${modelCount} 个模型`,
        latencyMs,
      });
    } else if (resp.status === 401 || resp.status === 403) {
      tests.push({ name: '模型列表', endpoint: '/models', status: 'fail', detail: `认证失败 (${resp.status})`, latencyMs });
    } else {
      tests.push({ name: '模型列表', endpoint: '/models', status: 'warn', detail: `返回 ${resp.status}`, latencyMs });
    }
  } catch (err) {
    tests.push({ name: '模型列表', endpoint: '/models', status: 'fail', detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}` });
  }

  // Pick a test model: first selected model, or default
  const testModel = selectedModels.length > 0 ? selectedModels[0] :
    modelType === 'chat' ? 'gpt-4o-mini' :
    modelType === 'image' ? 'dall-e-3' :
    modelType === 'video' ? 'kling-v1-6' :
    modelType === 'vlm' ? 'gpt-4o' :
    modelType === 'vectorize' ? 'gpt-4o' :
    modelType === 'upscaler' ? null :
    modelType === '3d' ? null : 'test';

  // Test 2: Real generation/chat test
  if (modelType === 'chat' || modelType === 'vlm' || modelType === 'vectorize') {
    if (testModel) {
      const genStart = Date.now();
      try {
        const resp = await fetchWithV1Retry(cleanBaseUrl, '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: 'user', content: 'Reply with exactly "OK" if you can read this.' }],
            max_tokens: 10,
            stream: false,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const totalTimeMs = Date.now() - genStart;
        if (resp.ok) {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || '';
          tests.push({
            name: '聊天测试',
            endpoint: '/chat/completions',
            status: 'pass',
            detail: `模型 ${testModel} 响应正常${content ? `: "${String(content).slice(0, 50)}"` : ''}`,
            totalTimeMs,
          });
        } else if (resp.status === 401 || resp.status === 403) {
          tests.push({ name: '聊天测试', endpoint: '/chat/completions', status: 'fail', detail: `认证失败 (${resp.status})`, totalTimeMs });
        } else {
          let errMsg = `HTTP ${resp.status}`;
          try { const errData = await resp.text(); errMsg += `: ${errData.slice(0, 200)}`; } catch {}
          tests.push({ name: '聊天测试', endpoint: '/chat/completions', status: resp.status >= 500 ? 'warn' : 'fail', detail: errMsg, totalTimeMs });
        }
      } catch (err) {
        tests.push({ name: '聊天测试', endpoint: '/chat/completions', status: 'fail', detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}`, totalTimeMs: Date.now() - genStart });
      }
    }
  } else if (modelType === 'image') {
    if (testModel) {
      const genStart = Date.now();
      try {
        const endpoint = profile?.defaultEndpoint === '/images/edits' ? '/images/edits' : '/images/generations';
        const resp = await fetchWithV1Retry(cleanBaseUrl, endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            prompt: 'a simple red apple on white background',
            n: 1,
            size: '1024x1024',
          }),
          signal: AbortSignal.timeout(60000),
        });
        const totalTimeMs = Date.now() - genStart;
        if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          let detail = `模型 ${testModel} 生成成功`;
          if (contentType.includes('json')) {
            try {
              const data = await resp.json();
              const hasUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.task_id;
              detail += hasUrl ? '，返回图片数据' : '，返回数据';
            } catch {}
          }
          tests.push({ name: '图像生成测试', endpoint, status: 'pass', detail, totalTimeMs });
        } else if (resp.status === 401 || resp.status === 403) {
          tests.push({ name: '图像生成测试', endpoint, status: 'fail', detail: `认证失败 (${resp.status})`, totalTimeMs });
        } else if (resp.status === 400 || resp.status === 422) {
          // Model validation error = endpoint works but model name wrong
          let errMsg = `端点可达但返回 ${resp.status}`;
          try { const errData = await resp.json(); errMsg += `: ${(errData.error?.message || JSON.stringify(errData)).slice(0, 150)}`; } catch { try { errMsg += `: ${(await resp.text()).slice(0, 150)}`; } catch {} }
          tests.push({ name: '图像生成测试', endpoint, status: 'warn', detail: errMsg, totalTimeMs });
        } else if (resp.status === 429) {
          tests.push({ name: '图像生成测试', endpoint, status: 'pass', detail: '端点可达，触发限流（429），额度可能不足', totalTimeMs });
        } else {
          let errMsg = `HTTP ${resp.status}`;
          try { errMsg += `: ${(await resp.text()).slice(0, 200)}`; } catch {}
          tests.push({ name: '图像生成测试', endpoint, status: resp.status >= 500 ? 'warn' : 'fail', detail: errMsg, totalTimeMs });
        }
      } catch (err) {
        tests.push({ name: '图像生成测试', endpoint: '/images/generations', status: 'fail', detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}`, totalTimeMs: Date.now() - genStart });
      }
    }
  } else if (modelType === 'video') {
    // Video: submit task (no wait for completion)
    if (testModel) {
      const genStart = Date.now();
      try {
        const resp = await fetchWithV1Retry(cleanBaseUrl, '/videos/generations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            prompt: 'a cat walking on grass',
            n: 1,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const totalTimeMs = Date.now() - genStart;
        if (resp.ok) {
          tests.push({ name: '视频提交测试', endpoint: '/videos/generations', status: 'pass', detail: `模型 ${testModel} 提交成功`, totalTimeMs });
        } else if (resp.status === 401 || resp.status === 403) {
          tests.push({ name: '视频提交测试', endpoint: '/videos/generations', status: 'fail', detail: `认证失败 (${resp.status})`, totalTimeMs });
        } else if (resp.status === 400 || resp.status === 422) {
          tests.push({ name: '视频提交测试', endpoint: '/videos/generations', status: 'warn', detail: `端点返回 ${resp.status}（可能参数/模型名问题）`, totalTimeMs });
        } else {
          let errMsg = `HTTP ${resp.status}`;
          try { errMsg += `: ${(await resp.text()).slice(0, 200)}`; } catch {}
          tests.push({ name: '视频提交测试', endpoint: '/videos/generations', status: 'warn', detail: errMsg, totalTimeMs });
        }
      } catch (err) {
        tests.push({ name: '视频提交测试', endpoint: '/videos/generations', status: 'fail', detail: `请求失败: ${err instanceof Error ? err.message : '未知错误'}`, totalTimeMs: Date.now() - genStart });
      }
    }
  } else {
    // 3d / upscaler / vectorize: just test models endpoint reachability
    tests.push({
      name: '连通性测试',
      endpoint: '/',
      status: modelCount > 0 ? 'pass' : 'warn',
      detail: modelCount > 0 ? '基础连通正常' : '模型列表不可用，功能可能受限',
    });
  }

  const hasFail = tests.some(t => t.status === 'fail');
  const hasWarn = tests.some(t => t.status === 'warn');
  const overall: 'pass' | 'warn' | 'fail' = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  return { providerId: id, providerName: displayName, modelType, baseUrl: cleanBaseUrl, tests, overall };
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const providers = await getApiProviders();
    const enabledProviders = providers.filter(p => p.isEnabled !== false);

    const results: TestResult[] = [];
    for (const p of enabledProviders) {
      try {
        const result = await testProvider(p);
        results.push(result);
      } catch (err) {
        results.push({
          providerId: p.id,
          providerName: p.displayName || p.name,
          modelType: p.modelType,
          baseUrl: p.baseUrl,
          tests: [{ name: '测试执行', endpoint: '', status: 'fail', detail: `测试脚本异常: ${err instanceof Error ? err.message : String(err)}` }],
          overall: 'fail',
        });
      }
    }

    const summary = {
      total: results.length,
      pass: results.filter(r => r.overall === 'pass').length,
      warn: results.filter(r => r.overall === 'warn').length,
      fail: results.filter(r => r.overall === 'fail').length,
    };

    return NextResponse.json({ success: true, summary, results, testedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[test-all-providers] Error:', error);
    return NextResponse.json({ success: false, error: '测试失败: ' + (error instanceof Error ? error.message : String(error)) }, { status: 500 });
  }
}
