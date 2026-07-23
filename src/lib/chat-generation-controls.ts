import type { ApiProvider } from '@/lib/universal-api-types';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'maximum';
export type ResponseSpeed = 'fast' | 'balanced' | 'quality';

export type ReasoningControlMode = 'reasoning_effort' | 'thinking_budget' | 'thinking' | 'native' | 'none';

export interface ChatControlSupport {
  reasoningMode: ReasoningControlMode;
  supportsReasoning: boolean;
  supportedEfforts: ReasoningEffort[];
  speedStrategies: ResponseSpeed[];
}

export interface ResolvedChatControls {
  requestParams: Record<string, unknown>;
  support: ChatControlSupport;
  appliedReasoningEffort: ReasoningEffort | 'model-default';
  appliedResponseSpeed: ResponseSpeed | 'model-default';
  degraded: boolean;
  notices: string[];
}

const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'maximum'];
const SPEEDS: ResponseSpeed[] = ['fast', 'balanced', 'quality'];

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function isResponseSpeed(value: unknown): value is ResponseSpeed {
  return typeof value === 'string' && SPEEDS.includes(value as ResponseSpeed);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : 'medium';
}

export function normalizeResponseSpeed(value: unknown): ResponseSpeed {
  return isResponseSpeed(value) ? value : 'balanced';
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function inferReasoningMode(model: string): ReasoningControlMode {
  const id = model.toLowerCase();
  if (/^(o1|o3|o4)(-|$)|gpt-5|gpt-5\./.test(id)) return 'reasoning_effort';
  if (/gemini/.test(id)) return 'thinking_budget';
  if (/doubao-seed|seed-2|kimi-k2\.5|kimi-k2-5/.test(id)) return 'thinking';
  if (/deepseek-r1|deepseek-reasoner|qwq|qwen.*thinking/.test(id)) return 'native';
  return 'none';
}

function getReasoningMode(model: string, provider: ApiProvider): ReasoningControlMode {
  const configured = provider.advancedParams?.reasoningControl;
  if (configured === 'reasoning_effort' || configured === 'thinking_budget' || configured === 'thinking' || configured === 'native' || configured === 'none') {
    return configured;
  }
  return inferReasoningMode(model);
}

function reasoningEffortValue(effort: ReasoningEffort): string {
  if (effort === 'maximum') return 'high';
  return effort;
}

function thinkingBudget(effort: ReasoningEffort): number {
  const budgets: Record<ReasoningEffort, number> = {
    low: 1024,
    medium: 4096,
    high: 8192,
    maximum: 16384,
  };
  return budgets[effort];
}

function outputTokenLimit(speed: ResponseSpeed): number {
  return speed === 'fast' ? 2048 : speed === 'quality' ? 8192 : 4096;
}

export function getChatControlSupport(model: string, provider?: Pick<ApiProvider, 'advancedParams'>): ChatControlSupport {
  const safeProvider = provider || { advancedParams: undefined };
  const reasoningMode = getReasoningMode(model, safeProvider as ApiProvider);
  return {
    reasoningMode,
    supportsReasoning: reasoningMode !== 'none',
    supportedEfforts: reasoningMode === 'none' || reasoningMode === 'native' ? [] : REASONING_EFFORTS,
    speedStrategies: SPEEDS,
  };
}

export function resolveChatControls(
  model: string,
  provider: ApiProvider,
  requestedReasoning: unknown,
  requestedSpeed: unknown,
): ResolvedChatControls {
  const reasoningEffort = normalizeReasoningEffort(requestedReasoning);
  const responseSpeed = normalizeResponseSpeed(requestedSpeed);
  const hasReasoningPreference = requestedReasoning !== undefined;
  const hasSpeedPreference = requestedSpeed !== undefined;
  const support = getChatControlSupport(model, provider);
  const requestParams: Record<string, unknown> = {};
  const notices: string[] = [];
  let appliedReasoningEffort: ResolvedChatControls['appliedReasoningEffort'] = hasReasoningPreference
    ? reasoningEffort
    : 'model-default';

  const advanced = provider.advancedParams || {};
  const reasoningParam = advanced.reasoningParamName;

  if (!hasReasoningPreference) {
    // Preserve legacy callers: controls only affect upstream requests when explicitly selected.
  } else if (support.reasoningMode === 'reasoning_effort') {
    requestParams[reasoningParam || 'reasoning_effort'] = reasoningEffortValue(reasoningEffort);
    if (reasoningEffort === 'maximum') notices.push('当前协议最高支持 high，已将“极强”映射为 high。');
  } else if (support.reasoningMode === 'thinking_budget') {
    const budgetOverrides: Record<ReasoningEffort, number | undefined> = {
      low: parseInteger(advanced.thinkingBudgetLow),
      medium: parseInteger(advanced.thinkingBudgetMedium),
      high: parseInteger(advanced.thinkingBudgetHigh),
      maximum: parseInteger(advanced.thinkingBudgetMaximum),
    };
    requestParams[reasoningParam || 'thinking_budget'] = budgetOverrides[reasoningEffort] || thinkingBudget(reasoningEffort);
  } else if (support.reasoningMode === 'thinking') {
    requestParams[reasoningParam || 'thinking'] = reasoningEffort === 'low' ? 'disabled' : 'enabled';
    if (reasoningEffort === 'high' || reasoningEffort === 'maximum') {
      notices.push('当前协议仅支持开启或关闭思考，已按“开启思考”执行。');
    }
  } else if (support.reasoningMode === 'native') {
    appliedReasoningEffort = 'model-default';
    notices.push('当前模型使用原生固定推理模式，强度由模型自动决定。');
  } else {
    appliedReasoningEffort = 'model-default';
    notices.push('当前模型未声明推理强度参数，已使用模型默认策略。');
  }

  const tokenParam = advanced.chatTokenLimitParam || (/^(o1|o3|o4)(-|$)|gpt-5/.test(model.toLowerCase()) ? 'max_completion_tokens' : 'max_tokens');
  const useTokenBudget = hasSpeedPreference && parseBoolean(advanced.enableChatSpeedTokenBudget) === true;
  if (useTokenBudget) {
    const tokenOverrides: Record<ResponseSpeed, number | undefined> = {
      fast: parseInteger(advanced.chatTokenLimitFast),
      balanced: parseInteger(advanced.chatTokenLimitBalanced),
      quality: parseInteger(advanced.chatTokenLimitQuality),
    };
    requestParams[tokenParam] = tokenOverrides[responseSpeed] || outputTokenLimit(responseSpeed);
  }

  const supportsServiceTier = hasSpeedPreference && parseBoolean(advanced.supportsServiceTier) === true;
  let appliedResponseSpeed: ResolvedChatControls['appliedResponseSpeed'] = hasSpeedPreference
    ? responseSpeed
    : 'model-default';
  if (supportsServiceTier) {
    requestParams.service_tier = responseSpeed === 'fast' ? (advanced.fastServiceTier || 'priority') : 'auto';
  } else if (hasSpeedPreference && responseSpeed !== 'balanced' && useTokenBudget) {
    notices.push(responseSpeed === 'fast'
      ? '当前提供商未启用优先服务档位，已通过收紧输出预算降低延迟。'
      : '质量优先会放宽输出预算，响应时间和用量可能增加。');
  } else if (hasSpeedPreference && responseSpeed !== 'balanced') {
    appliedResponseSpeed = 'model-default';
    notices.push('当前提供商未配置响应速度参数，已使用模型默认执行策略。');
  }

  return {
    requestParams,
    support,
    appliedReasoningEffort,
    appliedResponseSpeed,
    degraded: notices.length > 0,
    notices,
  };
}
