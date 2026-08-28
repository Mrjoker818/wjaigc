// ─── Global Result Cache (survives module re-instantiation in dev mode) ────
function getBrandResultStore(): Map<string, Record<string, unknown>> {
  const g = globalThis as Record<string, unknown>;
  if (!g.__wujie_brand_results) g.__wujie_brand_results = new Map<string, Record<string, unknown>>();
  return g.__wujie_brand_results as Map<string, Record<string, unknown>>;
}

export function setBrandResult(taskId: string, result: Record<string, unknown>) {
  getBrandResultStore().set(taskId, { ...result, _cachedAt: Date.now() });
}

export function getBrandResult(taskId: string): Record<string, unknown> | undefined {
  const store = getBrandResultStore();
  const r = store.get(taskId);
  // Expire after 30 minutes
  if (r && Date.now() - ((r as Record<string, unknown>)._cachedAt as number) > 30 * 60 * 1000) {
    store.delete(taskId);
    return undefined;
  }
  return r;
}

// 定期清理过期结果 + 上限保护
const MAX_BRAND_RESULTS = 200;
if (typeof setInterval !== 'undefined') {
  const brandCleanupTimer = setInterval(() => {
    const store = getBrandResultStore();
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;
    for (const [id, r] of store) {
      if (now - ((r as Record<string, unknown>)._cachedAt as number) > THIRTY_MIN) {
        store.delete(id);
      }
    }
    // 超上限时淘汰最老
    if (store.size > MAX_BRAND_RESULTS) {
      const entries = Array.from(store.entries())
        .sort((a, b) => ((a[1] as Record<string, unknown>)._cachedAt as number) - ((b[1] as Record<string, unknown>)._cachedAt as number));
      const excess = store.size - MAX_BRAND_RESULTS;
      for (let i = 0; i < excess; i++) {
        store.delete(entries[i][0]);
      }
    }
  }, 5 * 60 * 1000);
  if (brandCleanupTimer && typeof brandCleanupTimer === 'object' && 'unref' in brandCleanupTimer) {
    brandCleanupTimer.unref();
  }
}
