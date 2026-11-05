// @vitest-environment node
// Real VectorEditorDialog and project styles; no application server or network access.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://vector-editor-test.invalid';
const NORMAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" width="200" height="160"><rect x="10" y="10" width="80" height="140" fill="#ff0000"/><rect x="110" y="10" width="80" height="140" fill="#0000ff"/></svg>';
const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 800" width="200" height="800"><rect x="0" y="0" width="200" height="380" fill="#ff0000"/><rect x="0" y="420" width="200" height="380" fill="#0000ff"/></svg>';
const SQUARE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="220" height="220"><rect x="200" y="0" width="20" height="40" fill="#ff0000"/><rect x="20" y="120" width="80" height="80" fill="#0000ff"/></svg>';
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { VectorEditorDialog } from '@/components/vector-design/vector-editor-dialog';
const root = createRoot(document.getElementById('fixture-root')!);
const state = { closed: 0, saved: 0 };
Object.assign(window, { vectorFixture: {
  state,
  mount(svg: string) {
    root.render(<VectorEditorDialog asset={{ svg, svgUrl: '', previewUrl: '', width: 200, height: 160,
      pathCount: 2, model: 'synthetic', providerId: 'synthetic', providerName: 'synthetic', sourceType: 'synthetic' }}
      templateIds={[]} onClose={() => { state.closed++; root.render(null); }} onSave={() => { state.saved++; }} />);
  },
  unmount() { root.unmount(); },
} });
`;

interface FixtureWindow extends Window {
  vectorFixture: { state: { closed: number; saved: number }; mount(svg: string): void; unmount(): void };
}
interface Rect { x: number; y: number; width: number; height: number; right: number; bottom: number }
interface Metrics { rect: Rect; modal: Rect; hit: boolean; hitLabel: string | null }
interface Scenario { width: number; height: number; touch: boolean }

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const component = await readFile(path.resolve('src/components/vector-design/vector-editor-dialog.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: component, extension: 'tsx' }]));
  const result = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'vector-editor-mobile-entry.tsx' } });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { try { await browser?.close(); } finally { browser = undefined; } }, 15000);

async function metrics(locator: Locator): Promise<Metrics> {
  return locator.evaluate(element => {
    const box = (target: Element): Rect => {
      const r = target.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const rect = box(element);
    const modal = box(element.closest('[data-modal]')!.firstElementChild!);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { rect, modal, hit: hit !== null && (hit === element || element.contains(hit)),
      hitLabel: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.tagName ?? null };
  });
}

function expectReachable(value: Metrics, scenario: Scenario, minSize = 0): void {
  const { rect, modal, hit } = value;
  expect(rect.width).toBeGreaterThanOrEqual(minSize);
  expect(rect.height).toBeGreaterThanOrEqual(minSize);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(Math.max(0, modal.x));
  expect(rect.y).toBeGreaterThanOrEqual(Math.max(0, modal.y));
  expect(rect.right).toBeLessThanOrEqual(Math.min(scenario.width, modal.right));
  expect(rect.bottom).toBeLessThanOrEqual(Math.min(scenario.height, modal.bottom));
  expect(hit, JSON.stringify(value)).toBe(true);
}

function expectInside(inner: Rect, outer: Rect): void {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.right).toBeLessThanOrEqual(outer.right);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom);
}

async function activate(locator: Locator, scenario: Scenario): Promise<void> {
  if (scenario.touch) await locator.tap({ timeout: 3000 });
  else await locator.click({ timeout: 3000 });
}

async function withEditor(scenario: Scenario, svg: string, run: (page: Page) => Promise<void>): Promise<void> {
  if (!browser) throw Error('VECTOR_EDITOR_BROWSER_MISSING');
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
    hasTouch: scenario.touch, isMobile: scenario.touch, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const requests: string[] = [], errors: string[] = [];
  let mounted = false, contextClosed = false;
  context.once('close', () => { contextClosed = true; });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push('PAGE ' + error.message));
  page.on('download', () => errors.push('UNEXPECTED_DOWNLOAD'));
  await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), headers = await request.allHeaders();
    const key = request.method() + ' ' + url.pathname + url.search;
    requests.push(key);
    try {
      if (url.origin !== ORIGIN || headers.cookie || headers.authorization || headers['x-api-key']) throw Error('OUTSIDE_BOUNDARY ' + key);
      if (key !== 'GET /') throw Error('UNEXPECTED_REQUEST ' + key);
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
    } catch (error) { errors.push(String(error)); await route.abort(); }
  });
  try {
    await page.goto(ORIGIN + '/');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(value => (window as unknown as FixtureWindow).vectorFixture.mount(value), svg);
    mounted = true;
    await page.locator('.vector-edit-stage rect').first().waitFor({ state: 'attached' });
    await run(page);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.saved)).toBe(0);
  } finally {
    try { if (mounted) await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.unmount()); }
    finally { await context.close(); }
    expect(contextClosed).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual(['GET /']);
  }
}

async function recolorAndUndo(page: Page, scenario: Scenario): Promise<void> {
  const stage = page.locator('.vector-edit-stage');
  const first = stage.locator('rect').first();
  expectReachable(await metrics(first), scenario, 44);
  await activate(first, scenario);
  expect(await page.getByText('元素 1', { exact: true }).isVisible()).toBe(true);
  const color = page.getByRole('button', { name: '应用颜色', exact: true });
  await color.scrollIntoViewIfNeeded();
  expectReachable(await metrics(color), scenario, scenario.touch ? 44 : 0);
  const picker = page.locator('input[type="color"]');
  expectReachable(await metrics(picker), scenario, scenario.touch ? 44 : 0);
  await activate(color, scenario);
  expect(await stage.locator('rect').nth(0).getAttribute('fill')).toBe('#d4af37');
  expect(await stage.locator('rect').nth(1).getAttribute('fill')).toBe('#0000ff');
  const undo = page.getByRole('button', { name: '撤销上一步', exact: true });
  await undo.scrollIntoViewIfNeeded();
  expectReachable(await metrics(undo), scenario, scenario.touch ? 44 : 0);
  await activate(undo, scenario);
  expect(await stage.locator('rect').nth(0).getAttribute('fill')).toBe('#ff0000');
  expect(await stage.locator('rect').nth(1).getAttribute('fill')).toBe('#0000ff');
}

async function expectSaveAndDownloadEntrances(page: Page, scenario: Scenario): Promise<void> {
  for (const name of ['保存到画布', '下载 SVG', '下载 PNG', '下载 JPG']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    expect(await button.isEnabled()).toBe(true);
    expectReachable(await metrics(button), scenario);
  }
}

describe('vector element editor mobile and desktop layout', () => {
  const portrait: Scenario = { width: 320, height: 640, touch: true };
  const landscape: Scenario = { width: 640, height: 320, touch: true };
  const desktop: Scenario = { width: 1024, height: 768, touch: false };

  it('keeps the portrait stage nonzero and allows selection, recoloring and undo', async () => {
    await withEditor(portrait, NORMAL_SVG, async page => {
      const stage = await metrics(page.locator('.vector-edit-stage'));
      expect(stage.rect.width).toBeGreaterThan(0);
      expect(stage.rect.height).toBeGreaterThan(0);
      await recolorAndUndo(page, portrait);
    });
  }, 25000);

  it('closes immediately on short landscape without scrolling and keeps touch actions usable', async () => {
    await withEditor(landscape, NORMAL_SVG, async page => {
      const close = page.getByRole('button', { name: '关闭', exact: true });
      expect(await close.count()).toBe(1);
      expect(await page.locator('[data-modal]').evaluate(e => e.firstElementChild!.scrollTop)).toBe(0);
      expectReachable(await metrics(close), landscape, 44);
      await close.tap({ timeout: 3000 });
      expect(await page.locator('[data-modal]').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.closed)).toBe(1);
      await page.evaluate(svg => (window as unknown as FixtureWindow).vectorFixture.mount(svg), NORMAL_SVG);
      await page.locator('.vector-edit-stage rect').first().waitFor({ state: 'attached' });
      await recolorAndUndo(page, landscape);
      await expectSaveAndDownloadEntrances(page, landscape);
    });
  }, 25000);

  it('shows the full tall SVG and allows selecting both top and bottom shapes', async () => {
    await withEditor(portrait, TALL_SVG, async page => {
      const stage = page.locator('.vector-edit-stage');
      const stageRect = (await metrics(stage)).rect;
      const svg = await metrics(stage.locator('svg'));
      expectReachable(svg, portrait);
      expectInside(svg.rect, stageRect);
      for (let i = 0; i < 2; i++) {
        const shape = stage.locator('rect').nth(i);
        const box = await metrics(shape);
        expectReachable(box, portrait);
        expectInside(box.rect, stageRect);
        await shape.tap({ timeout: 3000 });
        expect(await page.getByText(`元素 ${i + 1}`, { exact: true }).isVisible()).toBe(true);
      }
    });
  }, 25000);

  it('selects a square SVG top-right shape without hitting close', async () => {
    await withEditor(portrait, SQUARE_SVG, async page => {
      const shape = page.locator('.vector-edit-stage rect').first();
      const point = await metrics(shape);
      expectReachable(point, portrait);
      await shape.tap({ timeout: 3000 });
      expect(await page.getByText('元素 1', { exact: true }).isVisible()).toBe(true);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.closed)).toBe(0);
      expect(await page.locator('[data-modal]').count()).toBe(1);
    });
  }, 25000);

  it('keeps the desktop side-by-side layout and the original single close control', async () => {
    await withEditor(desktop, NORMAL_SVG, async page => {
      const close = page.getByRole('button', { name: '关闭', exact: true });
      expect(await close.count()).toBe(1);
      expect(await close.evaluate(e => e.closest('aside') !== null)).toBe(true);
      expectReachable(await metrics(close), desktop);
      const main = (await metrics(page.locator('main'))).rect;
      const asides = page.locator('[data-modal] aside');
      const left = (await metrics(asides.nth(0))).rect;
      const right = (await metrics(asides.nth(1))).rect;
      expect(left.right).toBeLessThanOrEqual(main.x);
      expect(main.right).toBeLessThanOrEqual(right.x);
      await recolorAndUndo(page, desktop);
      await expectSaveAndDownloadEntrances(page, desktop);
      await close.click({ timeout: 3000 });
      expect(await page.locator('[data-modal]').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.closed)).toBe(1);
    });
  }, 25000);
});
