import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

interface BalanceInfo {
  providerId: string;
  providerName: string;
  providerType: string;
  balance: number | null;
  currency: string;
  totalUsage: number;
  dailyUsage: number;
  lastUpdated: string;
  error?: string;
}

/**
 * 获取 API 提供商的余额和使用量信息
 * 同一来源(如 APImart)的多个模型类型共享同一余额数据
 */
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser || sessionUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
    }

    const providers = await getApiProviders();
    const balanceInfos: BalanceInfo[] = [];

    // 按 baseUrl 分组，同一来源的 API 共享余额
    const baseUrlGroups = new Map<string, ApiProvider[]>();
    for (const provider of providers) {
      const normalizedUrl = normalizeApiBaseUrl(provider.baseUrl.replace(/\/+$/, ''));
      if (!baseUrlGroups.has(normalizedUrl)) {
        baseUrlGroups.set(normalizedUrl, []);
      }
      baseUrlGroups.get(normalizedUrl)!.push(provider);
    }

    // 对每个来源查询余额
    const processedUrls = new Set<string>();
    for (const [baseUrl, groupProviders] of baseUrlGroups) {
      if (processedUrls.has(baseUrl)) continue;
      processedUrls.add(baseUrl);

      const firstProvider = groupProviders[0];
      const balanceInfo: BalanceInfo = {
        providerId: firstProvider.id,
        providerName: firstProvider.name,
        providerType: groupProviders.map(p => p.type).join(' + '),
        balance: null,
        currency: 'USD',
        totalUsage: 0,
        dailyUsage: 0,
        lastUpdated: new Date().toISOString(),
      };

      try {
        // 尝试调用 APImart 风格的余额 API
        const balanceUrl = `${baseUrl}/balance`;
        const response = await fetch(balanceUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${firstProvider.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json();
          balanceInfo.balance = data.balance ?? data.data?.balance ?? data.credit_balance ?? null;
          balanceInfo.currency = data.currency ?? data.data?.currency ?? 'USD';
          balanceInfo.totalUsage = data.total_usage ?? data.data?.total_usage ?? 0;
          balanceInfo.dailyUsage = data.daily_usage ?? data.data?.daily_usage ?? 0;
        } else {
          balanceInfo.error = `API 返回 ${response.status}`;
        }
      } catch (err) {
        balanceInfo.error = err instanceof Error ? err.message : '余额查询失败';
      }

      balanceInfos.push(balanceInfo);
    }

    return NextResponse.json({ success: true, balances: balanceInfos });
  } catch (error) {
    console.error('API balance error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取余额失败',
    }, { status: 500 });
  }
}
