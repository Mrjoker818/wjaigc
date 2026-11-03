// @vitest-environment node
// Default-collected product regression; no standalone OWN diagnostic dependency.
// Existing run-isolated-vitest four-alias guard is intentionally unchanged.
import { describe, expect, it } from 'vitest';
import { runPromptTemplateLongContentRegression } from '../helpers/prompt-template-long-content-regression.mjs';

describe('prompt templates: long content and original parent callback', () => {
  it('preserves complete custom text and touch reachability in all four owned contexts', async (): Promise<void> => {
    const result = await runPromptTemplateLongContentRegression(process.cwd());
    expect(result.qualified, JSON.stringify({ primary: result.primary, cases: result.cases })).toBe(true);
    expect(result.counts).toEqual({ selected: 4, passed: 4, failed: 0 });
    expect(result.cases).toHaveLength(4);
    for (const item of result.cases) {
      expect(item.ready).toBe(true);
      expect(item.flowFinished).toBe(true);
      expect(item.status).toBe('passed');
      expect(item.bodyError).toBeNull();
      expect(item.defects).toEqual([]);
      expect(item.closed?.qualified).toBe(true);
    }
    expect(result.sourceChanged).toBe(false);
    expect(result.final.browserDisconnected).toBe(true);
    expect(result.final.live + result.final.admissionPending
      + result.final.operationsPending + result.final.closePending).toBe(0);
    expect([...result.final.admissionErrors, ...result.final.admissionLateErrors,
      ...result.final.operationErrors, ...result.final.operationLateErrors,
      ...result.final.closeErrors, ...result.final.closeLateErrors]).toEqual([]);
  // 30s build + 30s browser + 4*25s cases + 2.5s final close + scheduling margin.
  // Original action1500 / case25000 / drain2500 / close2500 budgets stay intact.
  }, 180000);
});
