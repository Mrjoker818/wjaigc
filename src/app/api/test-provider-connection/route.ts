import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { getApiProviders } from '@/lib/server-api-config';

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

    const { providerId } = await request.json();
    
    if (!providerId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Provider ID is required' 
      }, { status: 400 });
    }

    // Get the provider with full API key (server-side only)
    const providers = await getApiProviders();
    const provider = providers.find(p => p.id === providerId);
    
    if (!provider) {
      return NextResponse.json({ 
        success: false, 
        error: 'Provider not found' 
      }, { status: 404 });
    }

    if (!provider.apiKey) {
      return NextResponse.json({ 
        success: false, 
        error: '该 API 未配置 API Key' 
      }, { status: 400 });
    }

    // Normalize base URL: remove trailing /v1 to avoid double /v1/v1/ paths
    let targetBaseUrl = (provider.baseUrl || 'https://api.apimart.ai').replace(/\/+$/, '');
    if (targetBaseUrl.endsWith('/v1')) {
      targetBaseUrl = targetBaseUrl.slice(0, -3);
    }

    console.log('🔍 Testing API connection:', targetBaseUrl, 'provider:', provider.displayName || provider.name);

    // Strategy 1: Try /v1/models endpoint (OpenAI-compatible)
    try {
      const modelsResponse = await fetch(`${targetBaseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (modelsResponse.status === 200) {
        const modelsData = await modelsResponse.json();
        const modelCount = Array.isArray(modelsData.data) ? modelsData.data.length : 0;
        
        // Try to get balance info for apimart.ai
        let balanceInfo = '';
        if (targetBaseUrl.includes('apimart.ai')) {
          try {
            const balanceResponse = await fetch(`${targetBaseUrl}/v1/balance`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
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
          data: { modelCount, models: modelsData.data?.slice(0, 5).map((m: { id: string }) => m.id) },
        });
      } else if (modelsResponse.status === 401) {
        return NextResponse.json({
          success: false,
          error: 'API Key 无效或已过期',
          step: 'authentication',
          status: modelsResponse.status
        }, { status: 401 });
      } else {
        const errorText = await modelsResponse.text().catch(() => '');
        return NextResponse.json({
          success: false,
          error: `API 返回错误 (HTTP ${modelsResponse.status})${errorText ? ': ' + errorText.slice(0, 100) : ''}`,
          step: 'api_response',
          status: modelsResponse.status
        });
      }
    } catch (fetchError: unknown) {
      // /v1/models failed, try alternative endpoints
      console.log('⚠️ /v1/models failed:', getErrorMessage(fetchError));
    }

    // Strategy 2: Try /v1/balance endpoint (apimart specific)
    if (targetBaseUrl.includes('apimart.ai')) {
      try {
        const balanceResponse = await fetch(`${targetBaseUrl}/v1/balance`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
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

    // Strategy 3: Simple connectivity check
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
