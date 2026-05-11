import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  };

  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }

    const { apiKey, baseUrl } = await request.json();
    
    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'API Key is required' 
      }, { status: 400 });
    }

    // Normalize base URL: remove trailing /v1 to avoid double /v1/v1/ paths
    let targetBaseUrl = (baseUrl || 'https://api.apimart.ai').replace(/\/+$/, '');
    if (targetBaseUrl.endsWith('/v1')) {
      targetBaseUrl = targetBaseUrl.slice(0, -3);
    }

    console.log('🔍 Testing API connection:', targetBaseUrl, 'credential:', apiKey.substring(0, 8) + '...');

    // Strategy 1: Try /v1/models endpoint (OpenAI-compatible)
    // This works with most OpenAI-compatible APIs
    try {
      const modelsResponse = await fetch(`${targetBaseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000), // 15s timeout (large model lists can be slow)
      });

      console.log('🔍 /v1/models response status:', modelsResponse.status, 'for', targetBaseUrl);

      if (modelsResponse.status === 200) {
        const responseText = await modelsResponse.text();
        let modelsData: { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
        try {
          modelsData = JSON.parse(responseText);
        } catch {
          console.error('❌ Failed to parse /v1/models response as JSON:', responseText.substring(0, 200));
          return NextResponse.json({
            success: false,
            error: '服务器返回了非 JSON 格式的响应',
            step: 'api_response',
          });
        }
        
        // Handle both OpenAI format {data: [...]} and alternative format {models: [...]}
        const modelList = modelsData.data || modelsData.models || [];
        const modelCount = Array.isArray(modelList) ? modelList.length : 0;
        
        // Try to get balance info for apimart.ai
        let balanceInfo = '';
        if (targetBaseUrl.includes('apimart.ai')) {
          try {
            const balanceResponse = await fetch(`${targetBaseUrl}/v1/balance`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              signal: AbortSignal.timeout(5000),
            });
            if (balanceResponse.status === 200) {
              const balanceData = await balanceResponse.json();
              if (balanceData.success) {
                if (balanceData.unlimited_quota) {
                  balanceInfo = ' | 额度：无限';
                } else {
                  balanceInfo = ` | 余额：${balanceData.remain_balance}, 已用：${balanceData.used_balance}`;
                }
              }
            }
          } catch {
            // Balance check is optional
          }
        }

        return NextResponse.json({
          success: true,
          message: `连接成功！可用模型 ${modelCount} 个${balanceInfo}`,
          data: { modelCount, models: modelList.slice(0, 5).map((m: { id: string }) => m.id) },
        });
      } else if (modelsResponse.status === 401 || modelsResponse.status === 403) {
        return NextResponse.json({
          success: false,
          error: 'API Key 无效或已过期',
          step: 'authentication',
          status: modelsResponse.status
        }, { status: 401 });
      } else {
        // Non-200/401/403 status - log and fall through to strategy 2/3
        const errorText = await modelsResponse.text().catch(() => '');
        console.log(`⚠️ /v1/models returned HTTP ${modelsResponse.status}:`, errorText.substring(0, 200));
      }
    } catch (fetchError: unknown) {
      // /v1/models failed (timeout, network error, etc.)
      console.log('⚠️ /v1/models request failed:', getErrorMessage(fetchError));
    }

    // Strategy 2: Try /v1/balance endpoint (apimart specific)
    if (targetBaseUrl.includes('apimart.ai')) {
      try {
        const balanceResponse = await fetch(`${targetBaseUrl}/v1/balance`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (balanceResponse.status === 200) {
          const balanceData = await balanceResponse.json();
          let message = 'API连接成功！';
          if (balanceData.success) {
            if (balanceData.unlimited_quota) {
              message += ' 额度：无限';
            } else {
              message += ` 剩余额度：${balanceData.remain_balance}, 已使用：${balanceData.used_balance}`;
            }
          }
          return NextResponse.json({ success: true, message, data: balanceData });
        } else if (balanceResponse.status === 401) {
          return NextResponse.json({
            success: false,
            error: 'API Key 无效或已过期',
            step: 'authentication',
          }, { status: 401 });
        }
      } catch {
        // Balance check failed too
      }
    }

    // Strategy 3: Simple connectivity check with a lightweight request
    try {
      const healthResponse = await fetch(targetBaseUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return NextResponse.json({
        success: true,
        message: `服务器可达 (HTTP ${healthResponse.status})，但无法验证 API Key 有效性`,
        data: { status: healthResponse.status },
      });
    } catch (fetchError: unknown) {
      return NextResponse.json({
        success: false,
        error: `无法连接到 ${targetBaseUrl}，请检查网络或地址是否正确`,
        step: 'network',
        details: getErrorMessage(fetchError),
      }, { status: 503 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '连接测试失败';
    console.error('❌ Test connection error:', message);
    return NextResponse.json({ 
      success: false, 
      error: message,
    }, { status: 500 });
  }
}
