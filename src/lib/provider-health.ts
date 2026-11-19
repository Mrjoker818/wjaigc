// 中转站健康状态追踪：记录各提供商近期的成功/失败，用于「同模型跨提供商自动切换」时
// 把最近不稳定的中转站动态降级排到后面，避免每次都先撞到故障站白白浪费一次超时。
//
// 设计要点：
// - 纯内存、进程级，fire-and-forget，不阻塞主流程，也不持久化（重启即清空，符合「近期健康」语义）。
// - 只记录「可重试类」故障（5xx/429/超时/网络错误），业务错误（401/402/404 等）不算中转站不健康。
// - 失败有冷却窗口：窗口内降级，过期自动恢复，故障站恢复后能重新被优先使用。

export interface ProviderHealthSnapshot {
  providerId: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  cooldownUntil: number;
}

interface HealthRecord {
  consecutiveFailures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  cooldownUntil: number;
}

// 基础冷却 30s，连续失败按次数指数增长，封顶 5 分钟。
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

const records = new Map<string, HealthRecord>();

function getRecord(providerId: string): HealthRecord {
  let rec = records.get(providerId);
  if (!rec) {
    rec = { consecutiveFailures: 0, lastFailureAt: 0, lastSuccessAt: 0, cooldownUntil: 0 };
    records.set(providerId, rec);
  }
  return rec;
}

/** 记录一次成功：清除连续失败与冷却，立即恢复健康。 */
export function recordProviderSuccess(providerId: string, now: number = Date.now()): void {
  if (!providerId) return;
  const rec = getRecord(providerId);
  rec.consecutiveFailures = 0;
  rec.cooldownUntil = 0;
  rec.lastSuccessAt = now;
}

/** 记录一次可重试故障：累加连续失败并进入冷却窗口（指数退避）。 */
export function recordProviderFailure(providerId: string, now: number = Date.now()): void {
  if (!providerId) return;
  const rec = getRecord(providerId);
  rec.consecutiveFailures += 1;
  rec.lastFailureAt = now;
  const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (rec.consecutiveFailures - 1), MAX_COOLDOWN_MS);
  rec.cooldownUntil = now + backoff;
}

/** 当前是否处于冷却（近期不健康）窗口内。 */
export function isProviderCoolingDown(providerId: string, now: number = Date.now()): boolean {
  const rec = records.get(providerId);
  if (!rec) return false;
  return rec.cooldownUntil > now;
}

/** 读取健康快照（用于观测/测试）。 */
export function getProviderHealth(providerId: string, now: number = Date.now()): ProviderHealthSnapshot {
  const rec = records.get(providerId);
  if (!rec) {
    return {
      providerId,
      healthy: true,
      consecutiveFailures: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      cooldownUntil: 0,
    };
  }
  return {
    providerId,
    healthy: rec.cooldownUntil <= now,
    consecutiveFailures: rec.consecutiveFailures,
    lastFailureAt: rec.lastFailureAt,
    lastSuccessAt: rec.lastSuccessAt,
    cooldownUntil: rec.cooldownUntil,
  };
}

/**
 * 按健康状态对提供商链稳定排序：冷却中的排到后面，其余保持原有优先级顺序。
 * 这样首选提供商若近期稳定仍最优先；若近期故障则临时让位给同模型的健康中转站。
 */
export function orderProvidersByHealth<T extends { id: string }>(
  providers: T[],
  now: number = Date.now(),
): T[] {
  return providers
    .map((provider, index) => ({ provider, index, cooling: isProviderCoolingDown(provider.id, now) }))
    .sort((a, b) => {
      if (a.cooling !== b.cooling) return a.cooling ? 1 : -1;
      return a.index - b.index;
    })
    .map(entry => entry.provider);
}

/** 仅测试用：清空所有健康记录。 */
export function __resetProviderHealthForTest(): void {
  records.clear();
}
