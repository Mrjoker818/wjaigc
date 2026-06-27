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
  platform?: string;             // 检测到的平台类型
  loginRequired?: boolean;       // 是否需要登录凭据
}

/**
 * 获取根 URL（去掉 /v1 /v2 等路径后缀）
 */
function getRootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v\d+\/?$/, '').replace(/\/+$/, '');
}

/**
 * 毫单位转元（One API 额度单位：1元 = 500000毫）
 */
function quotaToYuan(quota: number | null): number | null {
  if (quota === null || quota === undefined) return null;
  return Math.round(quota / 500000 * 10000) / 10000; // 保留4位小数
}

/**
 * 检测平台类型
 */
function detectPlatform(baseUrl: string): 'one-api' | 'new-api' | 'pearapi' | '302ai' | 'openai' | 'siliconflow' | 'unknown' {
  const root = getRootUrl(baseUrl).toLowerCase();
  if (root.includes('pearapi')) return 'pearapi';
  if (root.includes('302ai')) return '302ai';
  if (root.includes('siliconflow') || root.includes('silicon')) return 'siliconflow';
  if (root.includes('openai.com')) return 'openai';
  // 大多数中转站使用 One API 或 New API
  return 'new-api'; // 默认按 New API 处理（覆盖面最广）
}

/**
 * Strategy 1: One API / New API — 登录获取 session token，再查余额
 */
async function queryOneApiBalance(baseUrl: string, username: string, password: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  const root = getRootUrl(baseUrl);
  
  try {
    // Step 1: 登录获取 session token
    const loginRes = await fetch(`${root}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15000),
    });
    
    if (!loginRes.ok) {
      const text = await loginRes.text().catch(() => '');
      return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `登录失败 (HTTP ${loginRes.ok}): ${text.slice(0, 100)}`, endpoint: '/api/user/login', platform: 'one-api', loginRequired: true };
    }
    
    const loginData = await loginRes.json();
    if (!loginData.success && !loginData.data) {
      return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `登录失败: ${loginData.message || '未知错误'}`, endpoint: '/api/user/login', platform: 'one-api', loginRequired: true };
    }
    
    const sessionToken = loginData.data;
    if (!sessionToken || typeof sessionToken !== 'string') {
      return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: '登录成功但未获取到会话令牌', endpoint: '/api/user/login', platform: 'one-api', loginRequired: true };
    }
    
    // Step 2: 获取用户信息（含额度）
    const selfRes = await fetch(`${root}/api/user/self`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(10000),
    });
    
    let balance: number | null = null;
    let totalQuota: number | null = null;
    let usedQuota: number | null = null;
    let remainingQuota: number | null = null;
    
    if (selfRes.ok) {
      const selfData = await selfRes.json();
      if (selfData.success && selfData.data) {
        const user = selfData.data;
        totalQuota = user.quota ?? user.total_quota ?? null;
        usedQuota = user.used_quota ?? null;
        remainingQuota = user.quota ?? null;
        balance = quotaToYuan(remainingQuota);
      }
    }
    
    // Step 3: 尝试获取 dashboard 用量统计
    let totalUsage = 0;
    let dailyUsage = 0;
    try {
      const dashRes = await fetch(`${root}/api/user/dashboard`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (dashRes.ok) {
        const dashData = await dashRes.json();
        if (dashData.success && dashData.data) {
          totalUsage = dashData.data.total_usage ?? dashData.data.totalUsage ?? 0;
          dailyUsage = dashData.data.today_usage ?? dashData.data.dailyUsage ?? 0;
        }
      }
    } catch {}
    
    return {
      balance,
      currency: 'CNY',
      totalQuota,
      usedQuota,
      remainingQuota,
      totalUsage,
      dailyUsage,
      lastUpdated: new Date().toISOString(),
      endpoint: '/api/user/self',
      platform: 'one-api',
      loginRequired: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `查询失败: ${msg}`, platform: 'one-api', loginRequired: true };
  }
}

/**
 * Strategy 2: 302.ai — 使用 API Key 直接查询
 */
async function query302AiBalance(apiKey: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  try {
    const res = await fetch('https://api.302ai.cn/v1/dashboard/billing/credit_grants', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    
    if (data.error) {
      return { balance: null, currency: 'USD', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: data.error.message || '查询失败', platform: '302ai' };
    }
    
    return {
      balance: data.total_available ?? data.balance ?? null,
      currency: 'USD',
      totalQuota: data.total_granted ? Math.round(data.total_granted * 500000) : null,
      usedQuota: data.total_used ? Math.round(data.total_used * 500000) : null,
      remainingQuota: data.total_available ? Math.round(data.total_available * 500000) : null,
      totalUsage: Math.round((data.total_used ?? 0) * 100),
      dailyUsage: 0,
      lastUpdated: new Date().toISOString(),
      endpoint: '/v1/dashboard/billing/credit_grants',
      platform: '302ai',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { balance: null, currency: 'USD', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `查询失败: ${msg}`, platform: '302ai' };
  }
}

/**
 * Strategy 3: OpenAI — 标准 billing API
 */
async function queryOpenAIBalance(apiKey: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  try {
    // 获取订阅信息
    const subRes = await fetch('https://api.openai.com/v1/dashboard/billing/subscription', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    
    let hardLimit = 0;
    let softLimit = 0;
    if (subRes.ok) {
      const subData = await subRes.json();
      hardLimit = subData.hard_limit_usd ?? subData.system_hard_limit_usd ?? 0;
      softLimit = subData.soft_limit_usd ?? 0;
    }
    
    // 获取用量信息
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];
    
    const usageRes = await fetch(
      `https://api.openai.com/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) }
    );
    
    let totalUsage = 0;
    if (usageRes.ok) {
      const usageData = await usageRes.json();
      totalUsage = usageData.total_usage ?? 0; // 美分
    }
    
    const balance = hardLimit > 0 ? Math.round((hardLimit - totalUsage / 100) * 10000) / 10000 : null;
    
    return {
      balance,
      currency: 'USD',
      totalQuota: hardLimit > 0 ? Math.round(hardLimit * 500000) : null,
      usedQuota: totalUsage > 0 ? Math.round(totalUsage / 100 * 500000) : null,
      remainingQuota: balance !== null ? Math.round(balance * 500000) : null,
      totalUsage: Math.round(totalUsage),
      dailyUsage: 0,
      lastUpdated: new Date().toISOString(),
      endpoint: '/v1/dashboard/billing/subscription',
      platform: 'openai',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { balance: null, currency: 'USD', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `查询失败: ${msg}`, platform: 'openai' };
  }
}

/**
 * Strategy 4: SiliconFlow
 */
async function querySiliconFlowBalance(apiKey: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/user/info', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    
    if (data.code || data.error) {
      return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: data.message || data.error?.message || '查询失败', platform: 'siliconflow' };
    }
    
    return {
      balance: data.balance ?? data.totalBalance ?? null,
      currency: 'CNY',
      totalQuota: data.totalBalance ? Math.round(data.totalBalance * 500000) : null,
      usedQuota: data.usage ? Math.round(data.usage * 500000) : null,
      remainingQuota: data.balance ? Math.round(data.balance * 500000) : null,
      totalUsage: 0,
      dailyUsage: 0,
      lastUpdated: new Date().toISOString(),
      endpoint: '/v1/user/info',
      platform: 'siliconflow',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: `查询失败: ${msg}`, platform: 'siliconflow' };
  }
}

/**
 * Strategy 5: PearAPI — 使用 API Key 的 photo-enhancer 风格
 */
async function queryPearApiBalance(apiKey: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  // PearAPI 没有公开的余额查询 API，尝试多种端点
  const endpoints = [
    { url: 'https://api.pearapi.ai/api/user/self', method: 'GET', auth: 'Bearer' },
    { url: 'https://api.pearapi.ai/api/user/balance', method: 'GET', auth: 'Bearer' },
  ];
  
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: { 'Authorization': `${ep.auth} ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const balance = data.data?.balance ?? data.data?.quota ?? data.balance ?? data.quota ?? null;
        if (balance !== null) {
          return {
            balance: typeof balance === 'number' ? quotaToYuan(balance) ?? balance : balance,
            currency: 'CNY',
            totalQuota: data.data?.total_quota ?? data.data?.totalQuota ?? null,
            usedQuota: data.data?.used_quota ?? data.data?.usedQuota ?? null,
            remainingQuota: data.data?.quota ?? data.data?.remainingQuota ?? null,
            totalUsage: 0, dailyUsage: 0,
            lastUpdated: new Date().toISOString(),
            endpoint: ep.url.replace('https://api.pearapi.ai', ''),
            platform: 'pearapi',
          };
        }
      }
    } catch {}
  }
  
  return { balance: null, currency: 'CNY', totalQuota: null, usedQuota: null, remainingQuota: null, totalUsage: 0, dailyUsage: 0, lastUpdated: new Date().toISOString(), error: 'PearAPI 暂不支持余额查询 API，请登录控制台查看', platform: 'pearapi', loginRequired: false };
}

/**
 * Strategy 6: 通用 OpenAI 兼容 — 尝试 billing 端点
 */
async function queryGenericBalance(baseUrl: string, apiKey: string): Promise<Omit<BalanceInfo, 'providerId' | 'providerName' | 'providerType' | 'baseUrl'> | null> {
  const root = getRootUrl(baseUrl);
  const endpoints = [
    `${root}/v1/dashboard/billing/credit_grants`,
    `${root}/v1/dashboard/billing/subscription`,
    `${root}/api/balance`,
    `${root}/v1/balance`,
    `${root}/balance`,
  ];
  
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const balance = data.total_available ?? data.balance ?? data.data?.balance ?? data.remaining ?? null;
        if (balance !== null && balance !== undefined) {
          const totalQuota = data.total_granted ?? data.data?.total_quota ?? data.totalQuota ?? null;
          const usedQuota = data.total_used ?? data.data?.used_quota ?? data.usedQuota ?? null;
          return {
            balance: typeof balance === 'number' ? balance : null,
            currency: 'USD',
            totalQuota: totalQuota !== null ? Math.round(totalQuota * 500000) : null,
            usedQuota: usedQuota !== null ? Math.round(usedQuota * 500000) : null,
            remainingQuota: typeof balance === 'number' ? Math.round(balance * 500000) : null,
            totalUsage: Math.round((data.total_used ?? 0) * 100),
            dailyUsage: 0,
            lastUpdated: new Date().toISOString(),
            endpoint: url.replace(root, ''),
            platform: 'generic',
          };
        }
      }
    } catch {}
  }
  
  return null;
}

/**
 * 主查询函数 — 自动检测平台并选择最佳策略
 */
async function queryProviderBalance(
  provider: ApiProvider,
  loginCredentials?: { username: string; password: string }
): Promise<BalanceInfo> {
  const base: BalanceInfo = {
    providerId: provider.id,
    providerName: provider.name || provider.displayName || 'Unknown',
    providerType: provider.modelType || provider.type || 'unknown',
    baseUrl: provider.baseUrl,
    balance: null,
    currency: 'CNY',
    totalQuota: null,
    usedQuota: null,
    remainingQuota: null,
    totalUsage: 0,
    dailyUsage: 0,
    lastUpdated: new Date().toISOString(),
  };
  
  const platform = detectPlatform(provider.baseUrl);
  base.platform = platform;
  
  const apiKey = provider.apiKey;
  
  // 根据平台选择策略
  switch (platform) {
    case 'openai': {
      const result = await queryOpenAIBalance(apiKey);
      return { ...base, ...result };
    }
    case '302ai': {
      const result = await query302AiBalance(apiKey);
      return { ...base, ...result };
    }
    case 'siliconflow': {
      const result = await querySiliconFlowBalance(apiKey);
      return { ...base, ...result };
    }
    case 'pearapi': {
      const result = await queryPearApiBalance(apiKey);
      return { ...base, ...result };
    }
    case 'one-api':
    case 'new-api':
    default: {
      // One API / New API 需要 username + password 登录
      if (loginCredentials?.username && loginCredentials?.password) {
        const result = await queryOneApiBalance(provider.baseUrl, loginCredentials.username, loginCredentials.password);
        return { ...base, ...result };
      }
      
      // 没有登录凭据，先尝试通用 API Key 查询
      const genericResult = await queryGenericBalance(provider.baseUrl, apiKey);
      if (genericResult && genericResult.balance !== null) {
        return { ...base, ...genericResult };
      }
      
      // 尝试 One API 用 API Key 作为 session token（部分平台支持）
      try {
        const root = getRootUrl(provider.baseUrl);
        const selfRes = await fetch(`${root}/api/user/self`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (selfRes.ok) {
          const selfData = await selfRes.json();
          if (selfData.success && selfData.data) {
            const user = selfData.data;
            const remainingQuota = user.quota ?? null;
            return {
              ...base,
              balance: quotaToYuan(remainingQuota),
              currency: 'CNY',
              totalQuota: user.total_quota ?? null,
              usedQuota: user.used_quota ?? null,
              remainingQuota,
              lastUpdated: new Date().toISOString(),
              endpoint: '/api/user/self',
              platform: 'new-api',
              loginRequired: false,
            };
          }
        }
      } catch {}
      
      // 所有策略失败，提示需要登录凭据
      return {
        ...base,
        error: '需要登录凭据才能查询余额，请在提供商设置中填写账号密码',
        platform: 'new-api',
        loginRequired: true,
      };
    }
  }
}

/**
 * GET — 查询所有提供商余额
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const providers = await getApiProviders();
    const results: BalanceInfo[] = [];
    
    // 并行查询所有提供商
    const promises = providers
      .filter(p => p.isEnabled !== false)
      .map(async (provider) => {
        return queryProviderBalance(provider);
      });
    
    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }
    
    return NextResponse.json({ success: true, providers: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST — 查询单个提供商余额（支持传入登录凭据）
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { providerId, username, password } = body as { providerId?: string; username?: string; password?: string };
    
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }
    
    const providers = await getApiProviders();
    const provider = providers.find(p => p.id === providerId);
    
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    
    const loginCredentials = (username && password) ? { username, password } : undefined;
    const result = await queryProviderBalance(provider, loginCredentials);
    
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
