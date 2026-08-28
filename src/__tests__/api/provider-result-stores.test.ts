import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const globals = globalThis as Record<string, unknown>;

describe('provider result stores', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));
    delete globals.__wujie_brand_results;
    delete globals.__wujie_refine_results__;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globals.__wujie_brand_results;
    delete globals.__wujie_refine_results__;
  });

  it('stores brand results under the existing globalThis key and expires them on read', async () => {
    const { getBrandResult, setBrandResult } = await import('@/app/api/brand-ecommerce/result-store');

    setBrandResult('brand-task', { directImageUrls: ['/brand.png'] });

    expect(getBrandResult('brand-task')).toEqual({
      directImageUrls: ['/brand.png'],
      _cachedAt: Date.now(),
    });
    expect(globals.__wujie_brand_results).toBeInstanceOf(Map);

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    expect(getBrandResult('brand-task')).toBeUndefined();
    expect((globals.__wujie_brand_results as Map<string, unknown>).has('brand-task')).toBe(false);
  });

  it('evicts brand entries above the existing limit', async () => {
    const { getBrandResult, setBrandResult } = await import('@/app/api/brand-ecommerce/result-store');

    for (let index = 0; index <= 200; index += 1) {
      vi.setSystemTime(Date.now() + 1);
      setBrandResult(`brand-${index}`, { index });
    }

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(getBrandResult('brand-0')).toBeUndefined();
    expect(getBrandResult('brand-200')).toMatchObject({ index: 200 });
    expect((globals.__wujie_brand_results as Map<string, unknown>).size).toBe(200);
  });

  it('stores refine results under the existing globalThis key and cleans up expired entries', async () => {
    const { getRefineResult, setRefineResult } = await import('@/app/api/refine-engine/result-store');
    const completedAt = Date.now();

    setRefineResult('refine-task', { directImageUrls: ['/refine.png'], completedAt });

    expect(getRefineResult('refine-task')).toEqual({
      directImageUrls: ['/refine.png'],
      completedAt,
    });
    expect(globals.__wujie_refine_results__).toBeInstanceOf(Map);

    vi.advanceTimersByTime(35 * 60 * 1000);

    expect(getRefineResult('refine-task')).toBeUndefined();
  });

  it('evicts the oldest refine entries above the existing limit', async () => {
    const { getRefineResult, setRefineResult } = await import('@/app/api/refine-engine/result-store');

    for (let index = 0; index <= 200; index += 1) {
      setRefineResult(`refine-${index}`, {
        directImageUrls: [`/${index}.png`],
        completedAt: Date.now() + index,
      });
    }

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(getRefineResult('refine-0')).toBeUndefined();
    expect(getRefineResult('refine-200')).toMatchObject({ directImageUrls: ['/200.png'] });
    expect((globals.__wujie_refine_results__ as Map<string, unknown>).size).toBe(200);
  });

  it('keeps both cleanup timers on the existing interval and unrefs them', async () => {
    vi.useRealTimers();
    const unref = vi.fn();
    const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((() => (
      { unref } as unknown as ReturnType<typeof setInterval>
    )) as unknown as typeof setInterval);

    await import('@/app/api/brand-ecommerce/result-store');
    await import('@/app/api/refine-engine/result-store');

    expect(intervalSpy).toHaveBeenCalledTimes(2);
    expect(intervalSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 5 * 60 * 1000);
    expect(intervalSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 5 * 60 * 1000);
    expect(unref).toHaveBeenCalledTimes(2);
  });
});
