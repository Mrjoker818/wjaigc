// @vitest-environment node
// Real HumanRepairPanel and project styles; all HTTP responses are synthetic.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://human-mobile.invalid';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=';
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import HumanRepairPanel from '@/components/human-repair-panel';
const root = createRoot(document.getElementById('fixture-root')!);
const state = { added: 0, closed: 0 };
Object.assign(window, { humanRepairFixture: {
  state,
  mount(mono: boolean) {
    root.render(<HumanRepairPanel isMonochrome={mono}
      onClose={() => { state.closed++; root.render(null); }} onAddImage={() => { state.added++; }} />);
  },
  unmount() { root.unmount(); },
} });
`;
interface FixtureWindow extends Window {
  humanRepairFixture: { state: { added: number; closed: number }; mount(mono: boolean): void; unmount(): void };
}
interface Rect { x: number; y: number; width: number; height: number; right: number; bottom: number }
interface Scenario { name: string; width: number; height: number; mono: boolean; touch: boolean }

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const component = await readFile(path.resolve('src/components/human-repair-panel.tsx'), 'utf8');
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'human-repair-mobile-entry.tsx' } });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  try { await browser?.close(); } finally { browser = undefined; }
}, 15000);

const scenarios: Scenario[] = [
  { name: 'gold portrait', width: 320, height: 640, mono: false, touch: true },
  { name: 'mono portrait', width: 320, height: 640, mono: true, touch: true },
  { name: 'short landscape', width: 640, height: 320, mono: false, touch: true },
  { name: 'desktop', width: 1024, height: 768, mono: false, touch: false },
];

describe('human repair image input at mobile and desktop widths', () => {
  it.each(scenarios)('$name retains a usable input and detection action', async scenario => {
    if (!browser) throw Error('HUMAN_REPAIR_BROWSER_MISSING');
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
      hasTouch: scenario.touch, isMobile: scenario.touch, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const requests: string[] = [], errors: string[] = [];
    let analysisCalls = 0, mounted = false, contextClosed = false;
    context.once('close', () => { contextClosed = true; });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push('PAGE ' + error.message));
    await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), headers = await request.allHeaders();
      const key = request.method() + ' ' + url.pathname + url.search;
      requests.push(key);
      try {
        if (url.origin !== ORIGIN || headers.cookie || headers.authorization || headers['x-api-key']) throw Error('OUTSIDE_BOUNDARY ' + key);
        if (key === 'GET /') {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
          return;
        }
        if (key === 'GET /api/models?type=image') { await route.fulfill({ json: { models: [] } }); return; }
        if (key === 'POST /api/human/analyze') {
          analysisCalls++;
          const body = request.postDataJSON() as { imageId?: unknown; imageUrl?: unknown };
          if (analysisCalls !== 1 || body.imageId !== IMAGE || body.imageUrl !== IMAGE) throw Error('INVALID_ANALYSIS_BODY');
          await route.fulfill({ json: { analysis: { targets: [], scores: { overall: 80 }, detector: 'synthetic' } } });
          return;
        }
        throw Error('UNEXPECTED_REQUEST ' + key);
      } catch (error) { errors.push(String(error)); await route.abort(); }
    });

    try {
      await page.goto(ORIGIN + '/');
      await page.addScriptTag({ content: bundle });
      await page.evaluate(mono => (window as unknown as FixtureWindow).humanRepairFixture.mount(mono), scenario.mono);
      mounted = true;
      const panel = page.locator('[data-modal="human-repair"]');
      const input = panel.getByPlaceholder('粘贴图片 URL 开始检测…');
      const detect = panel.getByRole('button', { name: '检测人物', exact: true });
      await input.waitFor();
      if (scenario.touch) await input.tap(); else await input.click();
      await page.keyboard.insertText(IMAGE);
      expect(await input.inputValue()).toBe(IMAGE);
      expect(await detect.isEnabled()).toBe(true);
      const metrics = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('[data-modal="human-repair"]')!;
        const input = panel.querySelector<HTMLInputElement>('input')!;
        const button = [...panel.querySelectorAll('button')].find(element => element.textContent?.includes('检测人物'))!;
        const rect = (element: Element): Rect => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const hit = (element: Element): boolean => {
          const r = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        };
        return { panel: rect(panel), input: rect(input), button: rect(button), inputHit: hit(input), buttonHit: hit(button),
          scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth };
      });
      const inView = (rect: Rect): boolean => rect.x >= 0 && rect.y >= 0 && rect.right <= scenario.width && rect.bottom <= scenario.height;
      expect(inView(metrics.panel) && inView(metrics.input) && inView(metrics.button)).toBe(true);
      expect(metrics.input.x >= metrics.panel.x && metrics.button.right <= metrics.panel.right).toBe(true);
      expect(metrics.scrollWidth <= metrics.clientWidth).toBe(true);
      expect(metrics.input.width >= 44 && metrics.input.height >= 44 && metrics.inputHit).toBe(true);
      expect(metrics.button.width >= 44 && metrics.button.height >= 44 && metrics.buttonHit).toBe(true);
      if (scenario.touch) await detect.tap({ timeout: 3000 }); else await detect.click({ timeout: 3000 });
      await page.getByText('检测到 0 个区域', { exact: true }).waitFor({ timeout: 3000 });
      expect(analysisCalls).toBe(1);
      expect(await input.inputValue()).toBe(IMAGE);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).humanRepairFixture.state.added)).toBe(0);
    } finally {
      try { if (mounted) await page.evaluate(() => (window as unknown as FixtureWindow).humanRepairFixture.unmount()); }
      finally { await context.close(); }
      expect(contextClosed).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual(['GET /', 'GET /api/models?type=image', 'POST /api/human/analyze']);
    }
  }, 25000);
});
