import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function loadBudget() {
  return import('@/app/api/svg-trace/wasm-budget');
}

const routeSource = readFileSync(
  join(process.cwd(), 'src/app/api/svg-trace/route.ts'),
  'utf8',
);

describe('svg-trace WASM pixel budget', () => {
  it('fixes the budget at 512 by 512 pixels', async () => {
    const { WASM_TRACER_MAX_PIXELS } = await loadBudget();

    expect(WASM_TRACER_MAX_PIXELS).toBe(262_144);
  });

  it.each([
    [256, 256],
    [512, 512],
  ])('keeps an in-budget %sx%s image unchanged', async (width, height) => {
    const { computeWasmTraceBudget } = await loadBudget();

    expect(computeWasmTraceBudget(width, height)).toEqual({
      scale: 1,
      width,
      height,
    });
  });

  it('reduces a 2048x2048 image to 512x512', async () => {
    const { computeWasmTraceBudget } = await loadBudget();

    expect(computeWasmTraceBudget(2048, 2048)).toEqual({
      scale: 0.25,
      width: 512,
      height: 512,
    });
  });

  it('limits a non-square image while preserving its aspect ratio', async () => {
    const {
      computeWasmTraceBudget,
      WASM_TRACER_MAX_PIXELS,
    } = await loadBudget();

    const result = computeWasmTraceBudget(1024, 512);

    expect(result.width * result.height).toBeLessThanOrEqual(WASM_TRACER_MAX_PIXELS);
    expect(result.width / result.height).toBeCloseTo(2, 2);
  });

  it.each([
    [Number.NaN, 2048, undefined],
    [Number.POSITIVE_INFINITY, 2048, undefined],
    [-4, 0, undefined],
    [2048, 2048, Number.NaN],
    [2048, 2048, -1],
  ])('returns finite positive integers for invalid dimensions or budgets', async (
    width,
    height,
    maxPixels,
  ) => {
    const { computeWasmTraceBudget } = await loadBudget();

    const result = computeWasmTraceBudget(width, height, maxPixels);

    expect(Number.isFinite(result.scale)).toBe(true);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('stays within the area budget after integer rounding', async () => {
    const { computeWasmTraceBudget } = await loadBudget();

    const result = computeWasmTraceBudget(1001, 777, 262_144);

    expect(result.width * result.height).toBeLessThanOrEqual(262_144);
  });

  it('applies the budget before synchronous WASM conversion only', () => {
    expect(routeSource).toContain("from './wasm-budget'");
    expect(routeSource).toContain(
      'const maxSize = params.colorPrecision >= 128 ? 4096 : 3072',
    );

    const functionStart = routeSource.indexOf('async function runWasmVTracer');
    const functionBody = routeSource.slice(functionStart, functionStart + 5000);
    const budgetIndex = functionBody.indexOf('computeWasmTraceBudget');
    const convertIndex = functionBody.indexOf('convertImageToSvg');

    expect(functionStart).toBeGreaterThan(-1);
    expect(budgetIndex).toBeGreaterThan(-1);
    expect(convertIndex).toBeGreaterThan(budgetIndex);
    expect(functionBody).toContain('.resize(budget.width, budget.height');
  });
});
