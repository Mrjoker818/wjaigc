// @vitest-environment node
// Real FontDesignPanel and project styles; all requests are synthetic.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';

const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import FontDesignPanel from '@/components/font-design-panel';
const state={closed:0,added:[],downloads:[]};const root=createRoot(document.getElementById('root'));window.fixture={state,mount(){root.render(<FontDesignPanel isMonochrome={false} onClose={()=>state.closed++} onAddImages={(images,meta)=>state.added.push({images,meta})} />)},unmount(){root.unmount()}};const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download')){state.downloads.push({href:this.getAttribute('href'),download:this.download});return;}return originalClick.call(this)};
`;
let browser: Browser | undefined;
let bundle = '', css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const variants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
  const browserFiles = new Map(variants.browserVariantModules.map(id => [require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`)]));
  const framework = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
  const result = await build({ write: false, outfile: 'simple-create-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' }, inject: ['simple-create-fixture-process'],
    plugins: [{ name: 'browser-fixture', setup(builder): void {
      builder.onResolve({ filter: new NativeRegExp('^simple-create-fixture-process$') }, () => ({ path: 'process', namespace: 'fixture' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'fixture' }, () => ({ contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd() }));
      const allowed = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && allowed.has(path.resolve(args.importer)) ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(framework.source, framework.flags) }, args => { if (!args.importer) return undefined; const file = browserFiles.get(createRequire(args.importer).resolve(args.path)); return file ? { path: file } : undefined; });
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-create-mobile-entry.tsx' } });
  bundle = result.outputFiles.filter(file => file.path.endsWith('.js'))[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(process.cwd(),file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' }, { content: await readFile(path.resolve('src/components/font-design-panel.tsx'), 'utf8'), extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(), loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.join(process.cwd(), 'node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

interface FixtureState {
  closed: number;
  added: Array<{ images: string[]; meta: { modelName?: string; apiProvider?: string } }>;
  downloads: Array<{ href: string | null; download: string }>;
}
interface FixtureWindow extends Window { fixture: { state: FixtureState; mount(): void; unmount(): void } }
const ORIGIN = 'https://font-result-fixture.invalid';
const IMAGE_URL = '/synthetic-result.png?fixture=1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function withResult(touch: boolean, run: (page: Page) => Promise<void>): Promise<void> {
  if (!browser) throw Error('FONT_RESULT_BROWSER_MISSING');
  const context = await browser.newContext({ viewport: touch ? { width: 320, height: 640 } : { width: 1280, height: 800 },
    isMobile: touch, hasTouch: touch, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  let mounted = false;
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket('**/*', socket => { errors.push('unexpected websocket'); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = await request.allHeaders();
    if (url.origin !== ORIGIN || headers.cookie || headers.authorization || headers['x-api-key']) {
      errors.push('outside synthetic network boundary'); return route.abort('blockedbyclient');
    }
    if (method === 'GET' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div>' });
    if (method === 'GET' && (url.pathname === '/logo.png' || url.pathname === '/synthetic-result.png')) return route.fulfill({ contentType: 'image/png', body: PNG });
    if (method === 'GET' && url.pathname === '/api/font-design/plan') return route.fulfill({ json: { styleCategories: [], scenes: [], strokeOptions: [], graphicElements: [], materials: [] } });
    if (method === 'GET' && url.pathname === '/api/models') return route.fulfill({ json: { providers: [], models: [] } });
    if (method === 'GET' && url.pathname === '/api/font-design/gallery') return route.fulfill({ json: { items: [], total: 0, totalPages: 0 } });
    if (method === 'POST' && url.pathname === '/api/font-design/prompt') return route.fulfill({ json: { prompt: '合成提示词' } });
    if (method === 'POST' && url.pathname === '/api/font-design/generate-image') return route.fulfill({ json: { taskId: 'synthetic-task', prompt: '合成提示词' } });
    if (method === 'POST' && url.pathname === '/api/poll-task') return route.fulfill({ json: { status: 'completed', imageUrl: IMAGE_URL } });
    errors.push('unexpected synthetic request: ' + method + ' ' + url.pathname);
    return route.abort('blockedbyclient');
  });
  try {
    await page.goto(ORIGIN + '/');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as FixtureWindow).fixture.mount());
    mounted = true;
    const input = page.getByPlaceholder('请输入中文标题、活动主题、封面标题或文字Logo名称');
    await input.fill('合成标题');
    const prompt = page.getByRole('button', { name: '生成即梦提示词' });
    await prompt.scrollIntoViewIfNeeded(); await prompt.click();
    await page.getByText('合成提示词', { exact: true }).first().waitFor();
    const generate = page.getByRole('button', { name: '发送到图像生成' });
    await generate.scrollIntoViewIfNeeded(); await generate.click();
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await page.locator('img[alt*="变体1"]').waitFor({ timeout: 10000 });
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    try { if (mounted) await page.evaluate(() => (window as unknown as FixtureWindow).fixture.unmount()); }
    finally { await context.close(); }
  }
}

async function geometry(target: Locator): Promise<{ opacity: number; width: number; height: number; inside: boolean; hit: boolean }> {
  return target.evaluate(element => {
    const rect = element.getBoundingClientRect(); let opacity = 1, inside = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); opacity *= Number(style.opacity);
      if (parent !== element && /(hidden|clip|auto|scroll)/.test(style.overflowX + ' ' + style.overflowY)) {
        const bounds = parent.getBoundingClientRect();
        if (rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5 || rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5) inside = false;
      }
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { opacity, width: rect.width, height: rect.height, inside, hit: hit !== null && element.contains(hit) };
  });
}

it('touch results expose unclipped actions and retain the original image URL and download name', async () => {
  await withResult(true, async page => {
    const image = page.locator('img[alt*="变体1"]'), card = image.locator('..');
    const add = card.getByRole('button', { name: '加入画布' }), download = card.getByRole('button', { name: '下载' });
    await page.mouse.move(0, 0);
    const layout = await image.evaluate(element => {
      const imageRect = element.getBoundingClientRect(), bar = element.nextElementSibling!.getBoundingClientRect();
      return { imageBottom: imageRect.bottom, barTop: bar.top, position: getComputedStyle(element.nextElementSibling!).position };
    });
    expect(layout.position).toBe('static');
    expect(layout.barTop).toBeGreaterThanOrEqual(layout.imageBottom - 0.5);
    for (const button of [add, download]) {
      await button.scrollIntoViewIfNeeded();
      const value = await geometry(button);
      expect(value.opacity).toBeGreaterThanOrEqual(0.99);
      expect(value.width).toBeGreaterThanOrEqual(44);
      expect(value.height).toBeGreaterThanOrEqual(44);
      expect(value.inside).toBe(true);
      expect(value.hit).toBe(true);
    }
    await add.scrollIntoViewIfNeeded(); await add.tap();
    await download.scrollIntoViewIfNeeded(); await download.tap();
    const state = await page.evaluate(() => (window as unknown as FixtureWindow).fixture.state);
    expect(state.added).toEqual([{ images: [IMAGE_URL], meta: {} }]);
    expect(state.downloads).toEqual([{ href: IMAGE_URL, download: 'font-design-1-1.png' }]);
  });
}, 30000);

it('desktop actions appear on hover and when reached by keyboard focus', async () => {
  await withResult(false, async page => {
    const image = page.locator('img[alt*="变体1"]'), card = image.locator('..');
    const add = card.getByRole('button', { name: '加入画布' }), download = card.getByRole('button', { name: '下载' });
    await card.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
    await expect.poll(async () => (await geometry(add)).opacity).toBeLessThan(0.01);
    await card.hover();
    await expect.poll(async () => (await geometry(add)).opacity).toBeGreaterThanOrEqual(0.99);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await geometry(add)).opacity).toBeLessThan(0.01);
    await add.focus();
    await page.keyboard.press('Tab');
    expect(await download.evaluate(element => document.activeElement === element)).toBe(true);
    await expect.poll(async () => (await geometry(download)).opacity).toBeGreaterThanOrEqual(0.99);
  });
}, 30000);
