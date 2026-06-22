import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

interface BalanceInfo {
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl: string;
  balance: number | null;        // 余额（元）
  currency: string;
  totalQuota: number | null;     // 总额度（毫）
  usedQuota: number | null;      // 已用额度（毫）
  remainingQuota: number | null; // 剩余额度（毫）
  totalUsage: number;            // 总使用量（美分）
  dailyUsage: number;
  lastUpdated: string;
  error?: string;
  endpoint?: string;
}

/**
 * 获取根 URL（去掉 /v1 /v2 等路径后缀）
 */
function getRootUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  url = url.replace(/\/v\d+$/, '');
  return url;
}

/**
 * 尝试多种中转站余额查询端点
 *
 * 关键发现：
 * - /api/user/self 需要「系统访问令牌」，API Key (sk-xxx) 不一定能访问
 * - /v1/dashboard/billing/subscription 和 /v1/dashboard/billing/usage 使用 API Key 即可访问
 * - One API / New API 都支持 /v1/dashboard/billing/* 端点
 */
async function queryBalance(
  baseUrl: string,
  apiKey: string,
): Promise<Partial<BalanceInfo>> {
  const rootUrl = getRootUrl(baseUrl);

  // 端点优先级：根据 One API / New API 文档和实际可用性排列
  // 优先使用 /v1 路径下的端点（API Key 可直接访问）
  const endpoints = [
    // ── One API / New API 标准端点（API Key 可访问） ──
    // 订阅余额信息：返回 { hard_limit_usd, soft_limit_usd, ... }
    { path: '/v1/dashboard/billing/subscription', label: 'Subscription' },
    // 使用量：返回 { total_usage } (单位: 美分)
    { path: '/v1/dashboard/billing/usage', label: 'Usage' },

    // ── One API 管理端点（可能需要系统令牌，但有些中转站也允许 API Key） ──
    // 个人信息：返回 { quota, used_quota, ... }（One API 单位：毫，1元=500000毫）
    { path: '/api/user/self', label: 'User Self' },
    // 仪表盘
    { path: '/api/user/dashboard', label: 'Dashboard' },

    // ── New API 可能需要 new-api-user 头 ──
    { path: '/api/user/self', label: 'New API', headers: { 'new-api-user': '1' } },

    // ── 令牌端点（One API / New API，API Key 可访问） ──
    // 令牌列表含 remain_quota
    { path: '/api/token/', label: 'Token List' },

    // ── 其他常见格式 ──
    // SiliconFlow 格式
    { path: '/v1/user/info', label: 'SiliconFlow' },
    // Kimi/Moonshot 格式
    { path: '/v1/users/me/balance', label: 'Kimi' },
    // 通用余额端点
    { path: '/api/balance', label: 'API Balance' },
    { path: '/balance', label: 'Balance' },
    { path: '/v1/balance', label: 'V1 Balance' },
  ];

  let lastError = '';
  const triedEndpoints: string[] = [];

  // 先收集 subscription 和 usage 的数据（它们通常一起使用）
  let subscriptionData: Record<string, unknown> | null = null;
  let usageData: { total_usage?: number } | null = null;

  for (const endpoint of endpoints) {
    const url = `${rootUrl}${endpoint.path}`;
    triedEndpoints.push(endpoint.label);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(endpoint.headers || {}),
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      });

      // 404 = 端点不存在，继续下一个
      if (response.status === 404) continue;

      // 401/403 = 认证失败，记录但继续尝试其他端点
      if (response.status === 401 || response.status === 403) {
        lastError = `认证失败(${response.status})`;
        continue;
      }

      // 5xx = 服务器错误，继续
      if (response.status >= 500) {
        lastError = `服务器错误(${response.status})`;
        continue;
      }

      // 非 2xx，继续
      if (!response.ok) continue;

      const text = await response.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        continue; // 非 JSON，跳过
      }

      // One API 返回 200 但 success: false 表示认证失败（API Key 无权访问管理端点）
      if (typeof data.success === 'boolean' && !data.success && typeof data.message === 'string') {
        lastError = data.message as string;
        continue; // 认证失败但不是 401，继续尝试其他端点
      }

      // ── /v1/dashboard/billing/subscription ──
      // OpenAI 兼容格式: { hard_limit_usd, soft_limit_usd, system_hard_limit_usd }
      // One API / New API 格式同上
      if (endpoint.label === 'Subscription') {
        subscriptionData = data;
        // 继续尝试 usage 端点，不直接返回
        continue;
      }

      // ── /v1/dashboard/billing/usage ──
      // 返回: { object: "list", total_usage: 1234.56 } (total_usage 单位：美分)
      if (endpoint.label === 'Usage') {
        usageData = data as { total_usage?: number };
        // 如果已有 subscription 数据，合并返回
        if (subscriptionData) {
          const hardLimit = typeof subscriptionData.hard_limit_usd === 'number'
            ? subscriptionData.hard_limit_usd as number : null;
          const totalUsage = typeof usageData.total_usage === 'number'
            ? usageData.total_usage as number : 0;

          // total_usage 单位是美分，转换为美元
          const totalUsageUsd = totalUsage / 100;

          // One API 中转站通常设 hard_limit_usd=100000000 表示无限额度
          const isUnlimited = hardLimit !== null && hardLimit > 100000;

          if (hardLimit !== null) {
            return {
              balance: isUnlimited ? -1 : hardLimit - totalUsageUsd,
              currency: 'USD',
              totalQuota: isUnlimited ? -1 : hardLimit * 500000,
              usedQuota: totalUsageUsd * 500000,
              remainingQuota: isUnlimited ? -1 : (hardLimit - totalUsageUsd) * 500000,
              totalUsage: totalUsage,
              dailyUsage: 0,
              endpoint: 'Subscription+Usage',
            };
          }

          // One API 格式可能有 quota 字段
          const subQuota = typeof (subscriptionData as Record<string, unknown>).quota === 'number'
            ? (subscriptionData as Record<string, unknown>).quota as number : null;
          const subUsedQuota = typeof (subscriptionData as Record<string, unknown>).used_quota === 'number'
            ? (subscriptionData as Record<string, unknown>).used_quota as number : null;

          if (subQuota !== null) {
            return {
              balance: subQuota / 500000,
              currency: 'CNY',
              totalQuota: subQuota,
              usedQuota: subUsedQuota,
              remainingQuota: subUsedQuota !== null ? subQuota - subUsedQuota : null,
              totalUsage: totalUsage,
              dailyUsage: 0,
              endpoint: 'Subscription+Usage',
            };
          }
        }

        // 只有 usage 没有 subscription
        if (typeof usageData.total_usage === 'number') {
          return {
            balance: null, // 不知道总额度
            currency: 'USD',
            totalQuota: null,
            usedQuota: null,
            remainingQuota: null,
            totalUsage: usageData.total_usage,
            dailyUsage: 0,
            endpoint: 'Usage',
          };
        }
        continue;
      }

      // ── One API /api/user/self 格式 ──
      // 返回: { success: true, data: { username, quota, used_quota, ... } }
      const innerData = (data.data && typeof data.data === 'object')
        ? data.data as Record<string, unknown>
        : data;

      const quota = typeof innerData.quota === 'number' ? innerData.quota : null;
      const usedQuota = typeof innerData.used_quota === 'number' ? innerData.used_quota : null;
      const remainQuota = typeof innerData.remain_quota === 'number' ? innerData.remain_quota : null;
      const unlimitedQuota = typeof innerData.unlimited_quota === 'boolean' ? innerData.unlimited_quota : false;

      if (quota !== null || usedQuota !== null || remainQuota !== null) {
        const remaining = remainQuota ?? (quota !== null && usedQuota !== null ? quota - usedQuota : null);
        return {
          balance: unlimitedQuota ? -1 : (quota !== null ? quota / 500000 : null),
          currency: 'CNY',
          totalQuota: quota,
          usedQuota,
          remainingQuota: unlimitedQuota ? -1 : remaining,
          totalUsage: 0,
          dailyUsage: typeof innerData.daily_usage === 'number' ? innerData.daily_usage as number : 0,
          endpoint: endpoint.label,
        };
      }

      // ── /api/token/ 令牌列表格式 ──
      if (Array.isArray(innerData) && innerData.length > 0) {
        const firstToken = innerData[0] as Record<string, unknown>;
        if (typeof firstToken.remain_quota === 'number') {
          const tokenRemain = firstToken.remain_quota as number;
          const tokenUsed = typeof firstToken.used_quota === 'number' ? firstToken.used_quota as number : null;
          const tokenUnlimited = typeof firstToken.unlimited_quota === 'boolean' ? firstToken.unlimited_quota as boolean : false;
          return {
            balance: tokenUnlimited ? -1 : tokenRemain / 500000,
            currency: 'CNY',
            totalQuota: null,
            usedQuota: tokenUsed,
            remainingQuota: tokenUnlimited ? -1 : tokenRemain,
            totalUsage: 0,
            dailyUsage: 0,
            endpoint: endpoint.label,
          };
        }
      }

      // ── /api/user/dashboard 格式 ──
      const dashQuota = typeof innerData.quota === 'number' ? innerData.quota : null;
      const dashUsed = typeof innerData.used_quota === 'number' ? innerData.used_quota : null;
      const dashTotalUsage = typeof innerData.total_usage === 'number' ? innerData.total_usage as number : null;
      const dashDailyUsage = typeof innerData.daily_usage === 'number' ? innerData.daily_usage as number : null;

      if (dashQuota !== null || dashTotalUsage !== null) {
        return {
          balance: dashQuota !== null ? dashQuota / 500000 : null,
          currency: 'CNY',
          totalQuota: dashQuota,
          usedQuota: dashUsed,
          remainingQuota: dashQuota !== null && dashUsed !== null ? dashQuota - dashUsed : null,
          totalUsage: dashTotalUsage ?? 0,
          dailyUsage: dashDailyUsage ?? 0,
          endpoint: endpoint.label,
        };
      }

      // ── SiliconFlow 格式: { totalBalance, availableBalance } ──
      const totalBalance = typeof innerData.totalBalance === 'number' ? innerData.totalBalance
        : typeof innerData.total_balance === 'number' ? innerData.total_balance : null;
      const availableBalance = typeof innerData.availableBalance === 'number' ? innerData.availableBalance
        : typeof innerData.available_balance === 'number' ? innerData.available_balance : null;

      if (totalBalance !== null || availableBalance !== null) {
        return {
          balance: availableBalance ?? totalBalance,
          currency: typeof innerData.currency === 'string' ? innerData.currency as string : 'CNY',
          totalQuota: totalBalance,
          usedQuota: totalBalance !== null && availableBalance !== null ? totalBalance - availableBalance : null,
          remainingQuota: availableBalance,
          totalUsage: 0,
          dailyUsage: 0,
          endpoint: endpoint.label,
        };
      }

      // ── Kimi/Moonshot 格式 ──
      const voucherBalance = typeof innerData.voucher_balance === 'number' ? innerData.voucher_balance : null;
      const cashBalance = typeof innerData.cash_balance === 'number' ? innerData.cash_balance : null;

      if (availableBalance !== null || voucherBalance !== null || cashBalance !== null) {
        const total = voucherBalance !== null && cashBalance !== null ? voucherBalance + cashBalance : null;
        return {
          balance: availableBalance ?? total,
          currency: 'CNY',
          totalQuota: total,
          usedQuota: total !== null && availableBalance !== null ? total - availableBalance : null,
          remainingQuota: availableBalance,
          totalUsage: 0,
          dailyUsage: 0,
          endpoint: endpoint.label,
        };
      }

      // ── 通用余额字段 ──
      const possibleFields = ['balance', 'remain', 'remaining', 'available', 'quota', 'credit', 'credits', 'remain_quota'];
      for (const field of possibleFields) {
        if (typeof innerData[field] === 'number') {
          const val = innerData[field] as number;
          // One API 毫单位检测
          const isHao = Math.abs(val) > 10000 && field.includes('quota');
          return {
            balance: isHao ? val / 500000 : val,
            currency: 'CNY',
            totalQuota: isHao ? val : null,
            usedQuota: null,
            remainingQuota: null,
            totalUsage: 0,
            dailyUsage: 0,
            endpoint: endpoint.label,
          };
        }
      }

    } catch {
      lastError = `${endpoint.label} 连接超时`;
      continue;
    }
  }

  // 如果有部分数据（subscription 或 usage 之一），也返回
  if (subscriptionData || usageData) {
    const hardLimit = subscriptionData && typeof subscriptionData.hard_limit_usd === 'number'
      ? subscriptionData.hard_limit_usd as number : null;
    const totalUsage = usageData && typeof usageData.total_usage === 'number'
      ? usageData.total_usage as number : 0;
    const isUnlimited = hardLimit !== null && hardLimit > 100000;

    if (hardLimit !== null) {
      const totalUsageUsd = totalUsage / 100;
      return {
        balance: isUnlimited ? -1 : hardLimit - totalUsageUsd,
        currency: 'USD',
        totalQuota: isUnlimited ? -1 : hardLimit * 500000,
        usedQuota: totalUsageUsd * 500000,
        remainingQuota: isUnlimited ? -1 : (hardLimit - totalUsageUsd) * 500000,
        totalUsage: totalUsage,
        dailyUsage: 0,
        endpoint: 'Partial Billing',
      };
    }

    if (totalUsage > 0) {
      return {
        balance: null,
        currency: 'USD',
        totalQuota: null,
        usedQuota: null,
        remainingQuota: null,
        totalUsage: totalUsage,
        dailyUsage: 0,
        endpoint: 'Usage Only',
      };
    }
  }

  const errorMsg = lastError
    ? `${lastError}（已尝试: ${triedEndpoints.join('→')}）`
    : `所有余额端点均不可用（已尝试: ${triedEndpoints.join('→')}），请确认中转站支持 API 余额查询，或登录中转站控制台查看`;
  return { error: errorMsg };
}

/**
 * 获取 API 提供商的余额和使用量信息
 */
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser || sessionUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
    }

    const providers = await getApiProviders();
    const balanceInfos: BalanceInfo[] = [];

    // 按 rootUrl 分组（同一来源的 API 共享余额，忽略 /v1 等路径差异）
    const baseUrlGroups = new Map<string, ApiProvider[]>();
    for (const provider of providers) {
      const groupKey = getRootUrl(normalizeApiBaseUrl(provider.baseUrl));
      if (!baseUrlGroups.has(groupKey)) {
        baseUrlGroups.set(groupKey, []);
      }
      baseUrlGroups.get(groupKey)!.push(provider);
    }

    // 并行查询所有来源的余额
    const processedUrls = new Set<string>();
    const balancePromises: Promise<BalanceInfo>[] = [];

    for (const [baseUrl, groupProviders] of baseUrlGroups) {
      if (processedUrls.has(baseUrl)) continue;
      processedUrls.add(baseUrl);

      const firstProvider = groupProviders[0];

      balancePromises.push((async () => {
        const info: BalanceInfo = {
          providerId: firstProvider.id,
          providerName: firstProvider.name,
          providerType: groupProviders.map(p => p.type).join(' + '),
          baseUrl,
          balance: null,
          currency: 'CNY',
          totalQuota: null,
          usedQuota: null,
          remainingQuota: null,
          totalUsage: 0,
          dailyUsage: 0,
          lastUpdated: new Date().toISOString(),
        };

        const result = await queryBalance(baseUrl, firstProvider.apiKey);
        Object.assign(info, result);
        return info;
      })());
    }

    const results = await Promise.allSettled(balancePromises);
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue;

      const groupProviders = Array.from(baseUrlGroups.values())[i];
      const baseInfo = result.value;

      // 为组内每个提供商创建余额记录（同一来源共享余额数据）
      for (const provider of groupProviders) {
        balanceInfos.push({
          ...baseInfo,
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
        });
      }
    }

    return NextResponse.json({
      success: true,
      balances: balanceInfos,
    });
  } catch (error) {
    console.error('API balance error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '获取余额失败',
    }, { status: 500 });
  }
}
