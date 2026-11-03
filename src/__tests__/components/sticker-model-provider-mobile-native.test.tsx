// @vitest-environment node
// Real StickerAssistantPanel and project styles; all requests are intercepted.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://sticker-label.invalid';
const PROVIDERS = [
  { id: 'synthetic-a', name: '供应商甲' },
  { id: 'synthetic-b', name: '供应商乙' },
  { id: 'synthetic-c', name: '供应商甲' },
];
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import StickerAssistantPanel from '@/components/sticker-assistant-panel';
const root = createRoot(document.getElementById('fixture-root')!);
const state = { closed: 0, added: 0 };
Object.assign(window, { stickerFixture: {
  state,
  mount() {
    root.render(<StickerAssistantPanel isOpen={true} isMonochrome={false}
      onClose={() => { state.closed++; root.render(null); }} onAddImages={() => { state.added++; }} />);
  },
  unmount() { root.unmount(); },
} });
`;
interface FixtureWindow extends Window {
  stickerFixture: { state: { closed: number; added: number }; mount(): void; unmount(): void };
}
interface Option { value: string; text: string; group: string }
interface Submission { route: string; model: unknown; providerId: unknown; stream?: unknown; n?: unknown }

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(path.resolve('src/components/sticker-assistant-panel.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: source, extension: 'tsx' }]));
  const result = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'sticker-model-provider-entry.tsx' } });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { try { await browser?.close(); } finally { browser = undefined; } }, 15000);

async function options(select: Locator): Promise<Option[]> {
  return select.evaluate(element => Array.from((element as HTMLSelectElement).options).map(option => ({
    value: option.value, text: option.textContent || '', group: (option.parentElement as HTMLOptGroupElement | null)?.label || '',
  })));
}

describe('sticker assistant provider labels and request identity', () => {
  it('distinguishes identical model names while preserving both selected provider identities', async () => {
    if (!browser) throw Error('STICKER_BROWSER_MISSING');
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true,
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    const requests: string[] = [], errors: string[] = [], submitted: Submission[] = [];
    let mounted = false, contextClosed = false;
    context.once('close', () => { contextClosed = true; });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
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
        if (key === 'GET /api/models?type=image' || key === 'GET /api/models?type=chat') {
          const type = url.searchParams.get('type');
          const id = type === 'image' ? 'synthetic-image' : 'synthetic-chat';
          await route.fulfill({ json: { success: true, providers: PROVIDERS,
            models: [...PROVIDERS.map(provider => ({ id, providerId: provider.id })), { id: `synthetic-legacy-${type}` }] } });
          return;
        }
        if (key === 'POST /api/chat') {
          const body = request.postDataJSON() as { model?: unknown; providerId?: unknown; stream?: unknown };
          submitted.push({ route: key, model: body.model, providerId: body.providerId, stream: body.stream });
          if (submitted.filter(item => item.route === key).length !== 1) throw Error('DUPLICATE_CHAT');
          await route.fulfill({ json: { content: '[{"caption":"合成","action":"挥手"}]' } });
          return;
        }
        if (key === 'POST /api/generate') {
          const body = request.postDataJSON() as { model?: unknown; providerId?: unknown; n?: unknown };
          submitted.push({ route: key, model: body.model, providerId: body.providerId, n: body.n });
          if (submitted.filter(item => item.route === key).length !== 1) throw Error('DUPLICATE_GENERATE');
          await new Promise(resolve => setTimeout(resolve, 120));
          await route.fulfill({ status: 503, json: { success: false, error: '受控合成失败' } });
          return;
        }
        throw Error('UNEXPECTED_REQUEST ' + key);
      } catch (error) { errors.push(String(error)); await route.abort(); }
    });

    try {
      await page.goto(ORIGIN + '/');
      await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as FixtureWindow).stickerFixture.mount());
      mounted = true;
      const panel = page.locator('[data-popup="sticker-assistant"]');
      const input = panel.getByPlaceholder('例如: 橘猫、奶茶杯、小恐龙...');
      const chat = panel.locator('select').nth(0), image = panel.locator('select').nth(1);
      await input.waitFor();
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLSelectElement>('[data-popup="sticker-assistant"] select')).every(select => select.options.length === 4));
      for (const [type, select] of [['chat', chat], ['image', image]] as const) {
        const list = await options(select);
        const named = list.filter(option => option.value.startsWith('synthetic-') && option.value.includes('::'));
        expect(named).toHaveLength(3);
        for (const option of named) {
          const id = option.value.split('::')[0];
          const provider = PROVIDERS.find(item => item.id === id);
          expect(provider).toBeDefined();
          expect(option.text).toContain(provider!.name);
          expect(option.text).toContain(id);
          expect(option.group).toBe(provider!.name);
        }
        expect(new Set(named.map(option => option.text)).size).toBe(3);
        expect(list.some(option => option.value === `synthetic-legacy-${type}`)).toBe(true);
      }
      await chat.selectOption('synthetic-b::synthetic-chat');
      await image.selectOption('synthetic-c::synthetic-image');
      expect(await chat.inputValue()).toBe('synthetic-b::synthetic-chat');
      expect(await image.inputValue()).toBe('synthetic-c::synthetic-image');
      await input.tap();
      await page.keyboard.insertText('合成主体');
      const plan = panel.getByRole('button', { name: '生成表情计划' });
      await plan.scrollIntoViewIfNeeded();
      await plan.tap();
      await panel.getByText('表情计划 (1个)', { exact: true }).waitFor();
      const start = panel.getByRole('button', { name: '开始生成' });
      await start.scrollIntoViewIfNeeded();
      await start.tap();
      await panel.getByRole('button', { name: '重试失败' }).waitFor();
      expect(submitted).toEqual([
        { route: 'POST /api/chat', model: 'synthetic-chat', providerId: 'synthetic-b', stream: false },
        { route: 'POST /api/generate', model: 'synthetic-image', providerId: 'synthetic-c', n: 1 },
      ]);
      expect(await panel.getByRole('button', { name: '重试失败' }).isVisible()).toBe(true);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).stickerFixture.state.added)).toBe(0);
      await panel.getByRole('button', { name: '关闭', exact: true }).tap();
      expect(await panel.count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).stickerFixture.state.closed)).toBe(1);
    } finally {
      try { if (mounted) await page.evaluate(() => (window as unknown as FixtureWindow).stickerFixture.unmount()); }
      finally { await context.close(); }
      expect(contextClosed).toBe(true);
      expect(errors).toEqual([]);
      expect(requests.slice().sort()).toEqual(['GET /', 'GET /api/models?type=chat', 'GET /api/models?type=image', 'POST /api/chat', 'POST /api/generate'].sort());
    }
  }, 25000);
});
