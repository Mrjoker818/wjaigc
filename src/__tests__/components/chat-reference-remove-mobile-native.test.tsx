// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const requireFromProject = createRequire(path.join(root, 'package.json'));
const origin = 'https://chat-reference-regression.invalid';
const draft = '需要保留的合成草稿';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ChatPanel } from '@/components/chat-panel';
  const root = createRoot(document.getElementById('root')!);
  root.render(<div style={{height:'100dvh',width:'100vw'}}>
    <ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[]} chatTabOpen />
  </div>);
  Object.assign(window, { referenceFixtureUnmount: () => root.unmount() });
`;

let html = '';
let browser: Browser;

beforeAll(async () => {
  const { build } = requireFromProject('esbuild') as typeof import('esbuild');
  const result = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: root, tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', __dirname: '"/"' },
    inject: ['reference-test-next-process'],
    plugins: [{
      name: 'reference-test-next-process',
      setup(builder) {
        builder.onResolve({ filter: /^reference-test-next-process$/ }, () => ({ path: 'process', namespace: 'reference-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'reference-test' }, () => ({
          contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: root,
        }));
      },
    }],
    stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: 'chat-reference-entry.tsx' },
  });
  const source = await readFile(path.join(root, 'src/components/chat-panel.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.join(root, 'src/app/globals.css'), 'utf8'), {
    base: root,
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? requireFromProject.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.join(root, 'node_modules/tw-animate-css/dist/tw-animate.css')
          : requireFromProject.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  const css = compiler.build(new Scanner({}).scanFiles([{ content: source, extension: 'tsx' }, { content: entry, extension: 'tsx' }]));
  html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="icon" href="data:,"><style>' + css + '</style></head><body><div id="root"></div><script>'
    + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { await browser?.close(); });

function files(count: number, start = 0): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  return Array.from({ length: count }, (_, i) => ({
    name: '同名.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from([start + i])]),
  }));
}

async function openFixture(width: number, height: number, touch: boolean): Promise<{
  page: Page; context: BrowserContext; faults: string[]; requests: string[];
}> {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch,
    serviceWorkers: 'block', reducedMotion: 'reduce' });
  const faults: string[] = [], requests: string[] = [];
  await context.routeWebSocket('**/*', socket => { faults.push('unexpected WebSocket'); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);
    if (url.origin === origin && request.method() === 'GET' && url.pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else {
      await route.abort();
    }
  });
  const page = await context.newPage();
  page.on('pageerror', error => faults.push(error.message));
  await page.goto(`${origin}/`);
  const input = page.locator('textarea').last();
  await input.waitFor();
  await input.fill(draft);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(files(2));
  await page.getByText('2张图片引用', { exact: true }).waitFor();
  return { page, context, faults, requests };
}

describe('canvas chat reference removal', () => {
  it.each([[320, 640], [640, 320]])('keeps thumbnail touch separate and preserves the other image and draft at %ix%i', async (width, height) => {
    const { page, context, faults, requests } = await openFixture(width, height, true);
    try {
      const strip = page.getByText('2张图片引用', { exact: true }).locator('xpath=../..');
      const groups = strip.locator('div.group'), images = groups.locator('img');
      const first = page.getByRole('button', { name: '移除第1张参考图 同名.png' });
      const second = page.getByRole('button', { name: '移除第2张参考图 同名.png' });
      const secondSource = await images.nth(1).getAttribute('src');
      expect(await images.nth(0).getAttribute('src')).not.toEqual(secondSource);
      const geometry = await first.evaluate(button => {
        const image = button.parentElement?.querySelector('img');
        if (!image) throw new Error('missing reference image');
        const a = button.getBoundingClientRect(), b = image.getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        const buttonHit = document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2);
        return { button: { x: a.x, y: a.y, width: a.width, height: a.height, opacity: getComputedStyle(button).opacity },
          image: { x: b.x, y: b.y, width: b.width, height: b.height },
          imageHitsButton: Boolean(hit?.closest('button')), buttonHit: Boolean(buttonHit && button.contains(buttonHit)) };
      });
      expect(await second.count()).toBe(1);
      expect(geometry.button.width).toBeGreaterThanOrEqual(44);
      expect(geometry.button.height).toBeGreaterThanOrEqual(44);
      expect(Number(geometry.button.opacity)).toBeGreaterThan(0);
      expect(geometry.button.x).toBeGreaterThanOrEqual(geometry.image.x + geometry.image.width - 1);
      expect(geometry.imageHitsButton).toBe(false);
      expect(geometry.buttonHit).toBe(true);
      await page.touchscreen.tap(geometry.image.x + geometry.image.width / 2, geometry.image.y + geometry.image.height / 2);
      expect(await page.getByText('2张图片引用', { exact: true }).count()).toBe(1);
      await first.tap();
      const remaining = page.getByText('1张图片引用', { exact: true }).locator('xpath=../..');
      await remaining.waitFor();
      expect(await remaining.locator('div.group').count()).toBe(1);
      expect(await remaining.locator('img').getAttribute('src')).toBe(secondSource);
      expect(await page.locator('textarea').last().inputValue()).toBe(draft);

      await page.locator('input[type=file][accept="image/*"]').setInputFiles(files(8, 2));
      const count = page.getByText('9张图片引用', { exact: true });
      await count.waitFor();
      const many = count.locator('xpath=../..'), row = many.locator('div.overflow-x-auto');
      const box = await row.boundingBox();
      if (!box) throw new Error('missing reference strip');
      const client = await context.newCDPSession(page);
      const x = Math.floor(box.x + box.width - 16), y = Math.floor(box.y + box.height / 2), end = Math.floor(box.x + 16);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (end - x) * i / 8, y }] });
        await page.waitForTimeout(16);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(160);
      expect(await row.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      expect(await count.count()).toBe(1);
      expect(await many.locator('div.group').count()).toBe(9);
      expect(await page.locator('textarea').last().inputValue()).toBe(draft);
      expect(faults).toEqual([]);
      expect(requests).toContain('GET /');
    } finally { await context.close(); }
  }, 20000);

  it('retains desktop hover and exposes distinct keyboard names for same-name images', async () => {
    const { page, context, faults } = await openFixture(1024, 768, false);
    try {
      const first = page.getByRole('button', { name: '移除第1张参考图 同名.png' });
      const second = page.getByRole('button', { name: '移除第2张参考图 同名.png' });
      expect(await second.count()).toBe(1);
      const strip = page.getByText('2张图片引用', { exact: true }).locator('xpath=../..');
      const secondSource = await strip.locator('div.group').nth(1).locator('img').getAttribute('src');
      const initial = await first.evaluate(element => ({ width: element.getBoundingClientRect().width, opacity: getComputedStyle(element).opacity }));
      expect(initial.width).toBe(16);
      expect(Number(initial.opacity)).toBe(0);
      await strip.locator('div.group').first().hover();
      await page.waitForTimeout(180);
      expect(Number(await first.evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(0);
      await page.mouse.move(1014, 10);
      await page.locator('textarea').last().focus();
      let steps = 0;
      while (steps < 40 && !(await first.evaluate(element => document.activeElement === element))) {
        await page.keyboard.press('Shift+Tab'); steps++;
      }
      expect(steps).toBeLessThan(40);
      expect(Number(await first.evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(0);
      await page.keyboard.press('Enter');
      const remaining = page.getByText('1张图片引用', { exact: true }).locator('xpath=../..');
      await remaining.waitFor();
      expect(await remaining.locator('img').getAttribute('src')).toBe(secondSource);
      expect(await page.locator('textarea').last().inputValue()).toBe(draft);
      expect(faults).toEqual([]);
    } finally { await context.close(); }
  }, 20000);
});
