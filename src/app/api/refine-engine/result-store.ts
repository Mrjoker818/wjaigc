// ─── Global Result Cache (shared across routes in dev mode) ───
interface RefineResult {
  directImageUrls: string[];
  completedAt: number;
}

function getGlobalRefineResults(): Map<string, RefineResult> {
  if (!(globalThis as Record<string, unknown>).__wujie_refine_results__) {
    (globalThis as Record<string, unknown>).__wujie_refine_results__ = new Map<string, RefineResult>();
  }
  return (globalThis as Record<string, unknown>).__wujie_refine_results__ as Map<string, RefineResult>;
}

export function setRefineResult(taskId: string, result: RefineResult) {
  getGlobalRefineResults().set(taskId, result);
}

export function getRefineResult(taskId: string): RefineResult | undefined {
  return getGlobalRefineResults().get(taskId);
}

// 定期清理过期结果 + 上限保护
const MAX_REFINE_RESULTS = 200;
const REFINE_RESULT_TTL = 30 * 60 * 1000; // 30分钟
if (typeof setInterval !== 'undefined') {
  const refineCleanupTimer = setInterval(() => {
    const store = getGlobalRefineResults();
    const now = Date.now();
    for (const [id, r] of store) {
      if (now - r.completedAt > REFINE_RESULT_TTL) {
        store.delete(id);
      }
    }
    // 超上限时淘汰最老
    if (store.size > MAX_REFINE_RESULTS) {
      const entries = Array.from(store.entries())
        .sort((a, b) => a[1].completedAt - b[1].completedAt);
      const excess = store.size - MAX_REFINE_RESULTS;
      for (let i = 0; i < excess; i++) {
        store.delete(entries[i][0]);
      }
    }
  }, 5 * 60 * 1000);
  if (refineCleanupTimer && typeof refineCleanupTimer === 'object' && 'unref' in refineCleanupTimer) {
    refineCleanupTimer.unref();
  }
}
