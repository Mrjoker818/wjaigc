import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

interface BalanceInfo {
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl: string;
  balance: number | null;
  currency: string;
  totalQuota: number | null;    // 总额度（毫）
  usedQuota: number | null;     // 已用额度（毫）
  remainingQuota: number | null;// 剩余额度（毫）
  totalUsage: number;
  dailyUsage: number;
  lastUpdated: string;
  error?: string;
  endpoint?: string; // 实际命中的端点
}

/**
 * 尝试多种中转站余额查询端点
 * One API 系列中转站通用格式
 */
async function queryBalance(
  baseUrl: string,
  apiKey: string,
): Promise<Partial<BalanceInfo>> {
  // 去除 baseUrl 末尾的 /v1 等路径，获取根地址
  let rootUrl = baseUrl.replace(/\/+$/, '');
  // 如果 baseUrl 以 /v1 /v2 等结尾，去掉版本前缀
  rootUrl = rootUrl.replace(/\/v\d+$/, '');

  // 按优先级尝试多个端点
  const endpoints = [
    // One API / New API 标准格式
    { path: '/api/user/self', label: 'One API' },
    // SiliconFlow 格式
    { path: '/v1/user/info', label: 'SiliconFlow' },
    // 通用 /balance 端点
    { path: '/balance', label: 'Balance' },
    // 带 /v1 前缀的余额端点
    { path: '/v1/balance', label: 'V1 Balance' },
    // One API 变体
    { path: '/api/balance', label: 'One API Balance' },
    // Dashboard API
    { path: '/api/dashboard/balance', label: 'Dashboard' },
  ];

  for (const endpoint of endpoints) {
    const url = `${rootUrl}${endpoint.path}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.status === 404) continue; // 端点不存在，尝试下一个
      if (response.status === 401 || response.status === 403) {
        // 认证失败，这个端点可能存在但 key 不对
        return { error: `认证失败 (${response.status})`, endpoint: endpoint.label };
      }

      if (!response.ok) continue; // 其他错误，尝试下一个

      const text = await response.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        continue; // 非 JSON 响应，跳过
      }

      // 解析 One API 格式: { success: true, data: { username, quota, used_quota } }
      const innerData = (data.data && typeof data.data === 'object') ? data.data as Record<string, unknown> : data;

      const quota = typeof innerData.quota === 'number' ? innerData.quota : null;
      const usedQuota = typeof innerData.used_quota === 'number' ? innerData.used_quota : null;
      const balance = typeof innerData.balance === 'number' ? innerData.balance : null;
      const totalUsage = typeof innerData.total_usage === 'number' ? innerData.total_usage : null;
      const dailyUsage = typeof innerData.daily_usage === 'number' ? innerData.daily_usage : null;
      const currency = typeof innerData.currency === 'string' ? innerData.currency : 'USD';
      const totalBalance = typeof innerData.total_balance === 'number' ? innerData.total_balance : null;
      const availableBalance = typeof innerData.available_balance === 'number' ? innerData.available_balance : null;

      // 有有效数据就返回
      if (quota !== null || balance !== null || availableBalance !== null || totalBalance !== null) {
        const remaining = quota !== null && usedQuota !== null
          ? quota - usedQuota
          : availableBalance ?? null;

        return {
          balance: balance ?? availableBalance ?? totalBalance ?? (quota !== null ? quota / 500000 : null),
          currency,
          totalQuota: quota ?? totalBalance ?? null,
          usedQuota: usedQuota ?? null,
          remainingQuota: remaining,
          totalUsage: totalUsage ?? 0,
          dailyUsage: dailyUsage ?? 0,
          endpoint: endpoint.label,
        };
      }

      // SiliconFlow 格式: { totalBalance, availableBalance }
      if (totalBalance !== null || availableBalance !== null) {
        return {
          balance: availableBalance ?? totalBalance,
          currency,
          totalQuota: totalBalance,
          usedQuota: totalBalance !== null && availableBalance !== null ? totalBalance - availableBalance : null,
          remainingQuota: availableBalance,
          totalUsage: 0,
          dailyUsage: 0,
          endpoint: endpoint.label,
        };
      }
    } catch {
      continue; // 网络错误，尝试下一个端点
    }
  }

  return { error: '所有余额端点均不可用，请登录中转站控制台查看' };
}

/**
 * 格式化额度显示（One API 单位：毫，1元 = 500000毫）
 */
function formatQuota(quota: number | null): string {
  if (quota === null) return '-';
  // One API 额度单位通常是毫
  if (Math.abs(quota) > 10000) {
    return `¥${(quota / 500000).toFixed(2)}`;
  }
  return `$${quota.toFixed(2)}`;
}

/**
 * 获取 API 提供商的余额和使用量信息
 * 同一 baseUrl 的多个模型类型共享同一余额数据
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
        baseUrl,
        balance: null,
        currency: 'USD',
        totalQuota: null,
        usedQuota: null,
        remainingQuota: null,
        totalUsage: 0,
        dailyUsage: 0,
        lastUpdated: new Date().toISOString(),
      };

      const result = await queryBalance(baseUrl, firstProvider.apiKey);
      Object.assign(balanceInfo, result);
      balanceInfos.push(balanceInfo);
    }

    return NextResponse.json({
      success: true,
      balances: balanceInfos,
      formatQuota, // 前端可用的格式化函数说明
    });
  } catch (error) {
    console.error('API balance error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取余额失败',
    }, { status: 500 });
  }
}
