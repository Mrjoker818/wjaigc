// @vitest-environment node
// Real public-share leaf, sync-status leaf, MarkdownRenderer and production CSS.
// Owned .invalid receipts only: not current Coze, public permissions or Android.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Locator } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
type SyncStatus = 'loading' | 'syncing' | 'synced' | 'offline' | 'failed' | 'conflict';
type Variant = 'ready' | 'empty' | 'error' | 'loading' | 'non-json' | 'http-error' | 'broken-image';
interface Options { surface: 'share' | 'sync'; variant?: Variant; status?: SyncStatus; reduced?: boolean; boundary?: boolean }
interface FixtureWindow extends Window { publicUi: { mount(theme: Theme, options: Options): void; unmount(): void; retries: number; disposed: boolean } }
interface Session {
  context: BrowserContext; page: Page; options: Options; faults: string[];
  handlers: Set<Promise<void>>; pending: Set<Request>; counts: Map<string, number>;
  refusals: string[]; released: boolean; release(): void; gate: Promise<void>; mounted: boolean;
}
const ORIGIN = 'https://public-share-sync-mobile.invalid';
const SHARE_ID = '0123456789abcdef';
const TITLE = '合成分享_' + 'LONG_UNBROKEN_PROJECT_'.repeat(12);
const WORD = 'SYNTHETIC_LONG_MESSAGE_'.repeat(28);
const CODE = 'const synthetic = "只用于本地界面验收";\nconsole.log(synthetic);';
const MARKDOWN = '# 合成公开回复\n\n普通正文 **重要文字**\n\nhttps://link.invalid/' + WORD + '\n\n| Project name | Version name |\n| --- | --- |\n| 合成项目 | ' + WORD + ' |\n\n```javascript\n' + CODE + '\n```';
const LABELS: Record<SyncStatus, string> = {
  loading: '正在加载对话', syncing: '正在同步', synced: '已同步',
  offline: '离线，修改将在联网后同步', failed: '同步失败，点击重试', conflict: '同步冲突，点击重试',
};
const VIEWS = [[320, 640], [390, 844], [640, 320], [1440, 900]] as const;
const THEMES: Theme[] = ['gold', 'mono'];
const ENTRY = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import SharedViewClient from '@/app/shared/[shareId]/shared-view-client';
import {SimpleChatSyncStatusView} from '@/components/simple-chat/simple-chat-sync-status';
import {Providers} from '@/app/simple-chat/providers';
const root=createRoot(document.getElementById('fixture-root')!);
function Launch({options}){const[active,setActive]=useState(false);return !active?<button onClick={()=>setActive(true)}>进入隔离界面</button>:options.surface==='share'?<SharedViewClient shareId='0123456789abcdef'/>:<main className='min-h-dvh w-full bg-background p-3 text-foreground'><div className='flex min-h-7 w-full min-w-0 items-center justify-end border-b border-border'><SimpleChatSyncStatusView status={options.status??'synced'} error={['failed','conflict'].includes(options.status)?{code:'SYNTHETIC_SYNC_ERROR',message:'合成同步错误，不含真实用户数据',retryable:true}:null} onRetry={()=>{ui.retries++;}}/></div><p className='mt-3'>合成父容器，不是实际Page失败协调器</p></main>;}
const ui={retries:0,disposed:false,mount(theme,options){
 localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');
 root.render(<Providers><Launch options={options}/></Providers>);
},unmount(){if(!ui.disposed){ui.disposed=true;root.unmount();}}};
Object.assign(window,{publicUi:ui});
`;
let browser: Browser | undefined;
let bundle = '', css = '', png: Buffer;
const live = new Set<Session>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('PUBLIC_UI_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const built = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'public-share-sync-mobile-entry.tsx' } });
  if (built.outputFiles.length !== 1) throw Error('PUBLIC_UI_MEMORY_BUNDLE_REQUIRED');
  bundle = built.outputFiles[0].text;
  const files = Object.keys(built.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  const sharp = require('sharp') as typeof import('sharp').default;
  png = await sharp({ create: { width: 1600, height: 300, channels: 4, background: '#d4af37' } }).png().toBuffer();
  browser = await chromium.launch({ headless: true });
}, 30000);

async function frames(page: Page): Promise<void> {
  await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('PUBLIC_UI_DRAIN_TIMEOUT ' + label)), 4000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function drain(s: Session): Promise<void> {
  await bounded((async () => {
    while (s.handlers.size || s.pending.size) { await Promise.all([...s.handlers]); await frames(s.page); }
    await frames(s.page);
  })(), 'native requests');
}
async function dispose(s: Session): Promise<void> {
  const faults: string[] = [];
  try {
    s.release(); await drain(s);
    if (s.mounted) await s.page.evaluate(() => (window as unknown as FixtureWindow).publicUi.unmount());
    await frames(s.page); await drain(s);
    if (s.mounted && !(await s.page.evaluate(() => (window as unknown as FixtureWindow).publicUi.disposed))) faults.push('UNMOUNT_NOT_CONFIRMED');
    if (s.handlers.size || s.pending.size) faults.push('PENDING_HTTP');
  } catch (error) { faults.push(String(error)); }
  finally {
    try { await bounded(s.context.close(), 'context close'); } catch (error) { faults.push(String(error)); }
    live.delete(s);
  }
  faults.push(...s.faults); // Include faults delivered during awaited context.close().
  if (faults.length) throw Error('PUBLIC_UI_CLEANUP ' + faults.join('\n'));
}
afterAll(async () => {
  const faults: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { faults.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (faults.length) throw Error(faults.join('\n'));
}, 15000);

async function open(theme: Theme, width: number, height: number, options: Options): Promise<Session> {
  if (!browser) throw Error('PUBLIC_UI_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', hasTouch: width < 768,
    reducedMotion: options.reduced ? 'reduce' : 'no-preference', permissions: ['clipboard-read', 'clipboard-write'] });
  let s: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1800);
    let releaseGate: () => void = () => { throw Error('PUBLIC_UI_GATE_INIT'); };
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    const session: Session = { context, page, options, faults: [], handlers: new Set(), pending: new Set(), counts: new Map(),
      refusals: [], released: false, gate, mounted: false, release() { if (!session.released) { session.released = true; releaseGate(); } } };
    s = session; live.add(s);
    page.on('pageerror', error => { session.faults.push('PAGEERROR ' + error.message); });
    page.on('request', request => session.pending.add(request));
    page.on('requestfinished', request => session.pending.delete(request));
    page.on('requestfailed', request => {
      session.pending.delete(request);
      if (!options.boundary || !session.refusals.includes(request.method() + ' ' + request.url())) session.faults.push('UNEXPECTED_NATIVE_FAILURE ' + request.url());
    });
    await context.routeWebSocket('**/*', socket => {
      session.refusals.push('WS ' + socket.url());
      if (!options.boundary) session.faults.push('UNEXPECTED_WS ' + socket.url());
      socket.close();
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), key = request.method() + ' ' + request.url();
      const count = (session.counts.get(key) ?? 0) + 1; session.counts.set(key, count);
      const handle = async (): Promise<void> => {
        if (url.origin === ORIGIN && url.search === '' && request.method() === 'GET' && request.postData() === null && count === 1) {
          if (url.pathname === '/' && request.isNavigationRequest()) {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body style="margin:0"><div id="fixture-root"></div></body></html>' }); return;
          }
          if (options.surface === 'share' && url.pathname === '/api/simple-chat/share/' + SHARE_ID && request.resourceType() === 'fetch') {
            if (options.variant === 'loading') await session.gate;
            if (options.variant === 'non-json') { await route.fulfill({ status: 200, contentType: 'text/plain', body: 'not valid json' }); return; }
            if (options.variant === 'http-error') { await route.fulfill({ status: 503, json: {} }); return; }
            if (options.variant === 'error') { await route.fulfill({ status: 404, json: { error: '合成分享已失效_' + WORD } }); return; }
            await route.fulfill({ json: { title: TITLE, createdAt: '2026-10-19T00:00:00.000Z', viewCount: 123456,
              messages: options.variant === 'empty' ? [] : [
                { id: 'user-one', role: 'user', content: WORD, images: ['/fixture/input.png'], timestamp: 1 },
                { id: 'assistant-one', role: 'assistant', content: MARKDOWN, generatedImages: ['/fixture/output.png'], timestamp: 2 },
              ] } }); return;
          }
          if (options.surface === 'share' && ['/fixture/input.png', '/fixture/output.png'].includes(url.pathname) && request.resourceType() === 'image') {
            await route.fulfill(options.variant === 'broken-image' ? { status: 404, contentType: 'image/png', body: Buffer.alloc(0) } : { contentType: 'image/png', body: png }); return;
          }
        }
        session.refusals.push(key);
        if (!options.boundary) session.faults.push('UNEXPECTED_HTTP ' + key);
        await route.abort('blockedbyclient');
      };
      const pending = handle(); session.handlers.add(pending);
      try { await pending; } catch (error) { session.faults.push('ROUTE_ERROR ' + String(error)); }
      finally { session.handlers.delete(pending); }
    });
    await page.goto(ORIGIN + '/'); await page.addScriptTag({ content: bundle });
    s.mounted = true;
    await page.evaluate(({ theme, options }) => (window as unknown as FixtureWindow).publicUi.mount(theme, options), { theme, options });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theme'));
    await page.getByRole('button', { name: '进入隔离界面', exact: true }).click();
    if (options.surface === 'share' && options.variant !== 'loading') {
      await page.waitForFunction(() => document.querySelector('header') || !document.querySelector('svg.animate-spin'));
      await drain(s);
    } else await frames(page);
    return s;
  } catch (primary) {
    try { if (s) await dispose(s); else await context.close(); }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'PUBLIC_UI_INIT_AND_CLEANUP'); }
    throw primary;
  }
}
async function withPage(theme: Theme, width: number, height: number, options: Options, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(theme, width, height, options);
  let primary: unknown;
  try { await run(s); } catch (error) { primary = error; }
  try { await dispose(s); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'PUBLIC_UI_TEST_AND_CLEANUP'); throw cleanup; }
  if (primary) throw primary;
}
async function noOverflow(page: Page): Promise<void> {
  const observation = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(observation.root, 'public share sync t document width').toBeLessThanOrEqual(observation.width + 1);
  expect(observation.body, 'public share sync t body width').toBeLessThanOrEqual(observation.width + 1);
}
async function target(control: Locator): Promise<void> {
  const value = await control.evaluate(element => { const r = element.getBoundingClientRect(); return {
    width: r.width, height: r.height, visible: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    hit: element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
  }; });
  expect(value.width, 'public share sync t target width').toBeGreaterThanOrEqual(44);
  expect(value.height, 'public share sync t target height').toBeGreaterThanOrEqual(44);
  expect(value.visible, 'public share sync t whole target visible').toBe(true);
  expect(value.hit, 'public share sync t native hit').toBe(true);
}
async function contrast(control: Locator): Promise<number> {
  return control.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('PUBLIC_UI_CONTRAST_CANVAS');
    const layers: Element[] = []; for (let e: Element | null = element; e; e = e.parentElement) layers.unshift(e);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1);
    for (const e of layers) { ctx.fillStyle = getComputedStyle(e).backgroundColor; ctx.fillRect(0, 0, 1, 1); }
    const luminance = (data: Uint8ClampedArray): number => { const c = Array.from(data.slice(0, 3), value => { const x = value / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; };
    const bg = luminance(ctx.getImageData(0, 0, 1, 1).data);
    ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
    const fg = luminance(ctx.getImageData(0, 0, 1, 1).data);
    return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  });
}

async function readableText(control: Locator, scrollHost: Locator): Promise<void> {
  const host = await scrollHost.elementHandle();
  if (!host) throw Error('PUBLIC_UI_SCROLL_HOST_REQUIRED');
  const result = await control.evaluate((element, boundary) => {
    const own = element.getBoundingClientRect(), rects: DOMRect[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      rects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0));
    }
    const insideOwn = rects.length > 0 && rects.every(rect => rect.left >= own.left - 1 && rect.right <= own.right + 1 && rect.top >= own.top - 1 && rect.bottom <= own.bottom + 1);
    let insideAncestors = true, reached = element === boundary;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent === boundary) { reached = true; break; }
      const box = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(hidden|clip)/.test(style.overflowX) && rects.some(rect => rect.left < box.left + parent.clientLeft - 1 || rect.right > box.left + parent.clientLeft + parent.clientWidth + 1)) insideAncestors = false;
      if (/(hidden|clip)/.test(style.overflowY) && rects.some(rect => rect.top < box.top + parent.clientTop - 1 || rect.bottom > box.top + parent.clientTop + parent.clientHeight + 1)) insideAncestors = false;
    }
    return { insideOwn, insideAncestors, reached, noHiddenLines: element.scrollHeight <= element.clientHeight + 1 };
  }, host);
  expect(result.insideOwn, 'public share sync t text range fits its own box').toBe(true);
  expect(result.insideAncestors, 'public share sync t text not ancestor clipped').toBe(true);
  expect(result.reached, 'public share sync t known native scroll ancestor').toBe(true);
  expect(result.noHiddenLines, 'public share sync t no hidden wrapped lines').toBe(true);
}
async function decodedImages(page: Page): Promise<Array<{ alt: string; complete: boolean; width: number; right: number; viewport: number; decoded: boolean }>> {
  return bounded(page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
    const decoded = await Promise.allSettled(images.map(image => image.decode()));
    return images.map((image, i) => ({ alt: image.alt, complete: image.complete, width: image.naturalWidth,
      right: image.getBoundingClientRect().right, viewport: innerWidth, decoded: decoded[i].status === 'fulfilled' }));
  }), 'actual image decode');
}
async function nativeFooter(page: Page, scrollHost: Locator): Promise<void> {
  const footer = page.locator('footer'), initial = await scrollHost.evaluate(e => e.scrollTop);
  const viewport = page.viewportSize(); if (!viewport) throw Error('PUBLIC_UI_VIEWPORT_REQUIRED');
  await page.mouse.move(viewport.width / 2, viewport.height - 20);
  let visible = false;
  for (let attempt = 0; attempt < 12 && !visible; attempt++) {
    await page.mouse.wheel(0, Math.max(viewport.height * 2, 1200)); await frames(page);
    visible = await footer.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
  }
  expect(await scrollHost.evaluate(e => e.scrollTop), 'public share sync t native wheel moves the real share container').toBeGreaterThan(initial);
  expect(visible, 'public share sync t native wheel reaches readable footer').toBe(true);
}

async function capture(page: Page, name: string): Promise<void> {
  const dir = path.resolve('output/playwright/public-share-sync-native-20261019', String(process.pid));
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false });
}

describe('public share sync fixture boundary', () => {
  it('one exact synthetic GET and image reads, read-only surface', async () => {
    await withPage('gold', 390, 844, { surface: 'share' }, async s => {
      expect(await s.page.locator('h1').first().textContent()).toBe(TITLE);
      expect(s.counts.get('GET ' + ORIGIN + '/api/simple-chat/share/' + SHARE_ID)).toBe(1);
      expect(await s.page.locator('input,textarea').count()).toBe(0);
      expect(s.refusals).toEqual([]);
    });
  });
  it('sync leaf mounts without network operations', async () => {
    await withPage('mono', 320, 640, { surface: 'sync', status: 'synced' }, async s => {
      expect(await s.page.getByRole('status').textContent()).toContain('已同步');
      expect([...s.counts.keys()]).toEqual(['GET ' + ORIGIN + '/']);
    });
  });
  for (const [name, url, method] of [['external HTTP', 'https://outside.invalid/forbidden', 'GET'], ['unknown POST', ORIGIN + '/forbidden', 'POST']] as const) {
    it(name + ' is refused at native transport', async () => {
      await withPage('gold', 390, 844, { surface: 'sync', boundary: true }, async s => {
        const result = await s.page.evaluate(async ({ url, method }) => { try { await fetch(url, { method }); return 'escaped'; } catch { return 'blocked'; } }, { url, method });
        expect(result).toBe('blocked'); await drain(s); expect(s.refusals).toEqual([method + ' ' + url]);
      });
    });
  }
  it('unknown WebSocket is refused without a live service', async () => {
    await withPage('gold', 390, 844, { surface: 'sync', boundary: true }, async s => {
      await s.page.evaluate(async () => { await new Promise<void>(resolve => { const socket = new WebSocket('wss://outside.invalid/forbidden'); socket.onclose = () => resolve(); socket.onerror = () => resolve(); }); });
      expect(s.refusals).toEqual(['WS wss://outside.invalid/forbidden']);
    });
  });
});

describe('public share sync t', () => {
  for (const theme of THEMES) for (const [width, height] of VIEWS) {
    it(`share long content ${theme} ${width}x${height}`, async () => {
      await withPage(theme, width, height, { surface: 'share' }, async s => {
        await capture(s.page, `share-ready-${theme}-${width}x${height}`);
        await noOverflow(s.page);
        const heading = s.page.locator('header h1');
        expect(await heading.textContent()).toBe(TITLE);
        expect(await heading.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'public share sync t full title wraps').toBe(true);
        expect(await s.page.locator('header').getByText('无界AI', { exact: true }).evaluate(e => { const r = e.getBoundingClientRect(); return r.width >= 54 && r.right <= innerWidth; }), 'public share sync t brand label remains horizontal').toBe(true);
        const userContent = s.page.locator('main .whitespace-pre-wrap').filter({ hasText: WORD });
        expect(await userContent.count(), 'public share sync t one user message').toBe(1);
        expect(await userContent.textContent()).toBe(WORD);
        const scrollHost = s.page.locator('header').locator('..');
        await readableText(heading, scrollHost); await readableText(userContent, scrollHost);
        const images = await decodedImages(s.page);
        expect(images.length, 'public share sync t two decoded images').toBe(2);
        expect(images.every(image => image.decoded && image.complete && image.alt.trim().length > 0 && image.right <= image.viewport && image.width === 1600), 'public share sync t real images fit and have alternatives').toBe(true);
        for (const text of [s.page.locator('header p'), s.page.getByText('AI 助手', { exact: true }), s.page.locator('footer')]) {
          expect(await contrast(text), 'public share sync t secondary text contrast').toBeGreaterThanOrEqual(4.5);
        }
        await nativeFooter(s.page, scrollHost); await readableText(s.page.locator('footer'), scrollHost);
        expect(await s.page.locator('footer').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight + 1), 'public share sync t footer scroll reachable').toBe(true);
      });
    });
    it(`share expired error ${theme} ${width}x${height}`, async () => {
      await withPage(theme, width, height, { surface: 'share', variant: 'error' }, async s => {
        await capture(s.page, `share-error-${theme}-${width}x${height}`); await noOverflow(s.page);
        expect(await s.page.getByRole('alert').count(), 'public share sync t error announced').toBe(1);
        const message = s.page.getByText('合成分享已失效_' + WORD, { exact: true });
        expect(await message.textContent()).toBe('合成分享已失效_' + WORD);
        await readableText(message, s.page.getByRole('alert').locator('..'));
        expect(await contrast(s.page.getByText('该分享链接可能已被撤销或过期', { exact: true })), 'public share sync t error helper contrast').toBeGreaterThanOrEqual(4.5);
        expect(await s.page.locator('input,textarea').count()).toBe(0);
      });
    });
    it(`share empty ${theme} ${width}x${height}`, async () => {
      await withPage(theme, width, height, { surface: 'share', variant: 'empty' }, async s => {
        await noOverflow(s.page);
        expect(await s.page.getByRole('status').textContent(), 'public share sync t empty explanation').toContain('暂无对话内容');
        expect(await s.page.locator('input,textarea').count()).toBe(0);
      });
    });
    for (const status of ['failed', 'conflict'] as const) {
      it(`sync retry ${status} ${theme} ${width}x${height}`, async () => {
        await withPage(theme, width, height, { surface: 'sync', status }, async s => {
          await capture(s.page, `sync-${status}-${theme}-${width}x${height}`); await noOverflow(s.page);
          const button = s.page.getByRole('button', { name: '重试同步', exact: true }); await target(button);
          const label = s.page.getByText(LABELS[status], { exact: true });
          expect(await label.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'public share sync t retry label complete').toBe(true);
          expect(await contrast(label), 'public share sync t sync label contrast').toBeGreaterThanOrEqual(4.5);
          await button.click(); expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).publicUi.retries)).toBe(1);
          await button.focus(); await s.page.keyboard.press('Enter');
          expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).publicUi.retries)).toBe(2);
          expect([...s.counts.keys()]).toEqual(['GET ' + ORIGIN + '/']);
        });
      });
    }
  }
  for (const theme of THEMES) for (const [width, height] of [[320, 640], [640, 320]] as const) {
    it(`share loading reduced ${theme} ${width}x${height}`, async () => {
      await withPage(theme, width, height, { surface: 'share', variant: 'loading', reduced: true }, async s => {
        const status = s.page.getByRole('status');
        expect(await status.count(), 'public share sync t loading announced').toBe(1);
        expect(await status.textContent(), 'public share sync t loading text').toContain('正在加载分享');
        expect(await s.page.locator('svg').evaluate(e => getComputedStyle(e).animationName), 'public share sync t reduced loading motion').toBe('none');
        await noOverflow(s.page); s.release(); await drain(s);
        expect(await s.page.locator('header h1').textContent()).toBe(TITLE);
      });
    });
    for (const status of ['loading', 'syncing', 'synced', 'offline'] as const) {
      it(`sync feedback ${status} ${theme} ${width}x${height}`, async () => {
        await withPage(theme, width, height, { surface: 'sync', status, reduced: true }, async s => {
          const text = s.page.getByText(LABELS[status], { exact: true });
          expect(await s.page.getByRole('status').count()).toBe(1);
          expect(await text.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'public share sync t status text complete').toBe(true);
          expect(await contrast(text), 'public share sync t sync label contrast').toBeGreaterThanOrEqual(4.5);
          expect(await s.page.getByRole('button', { name: '重试同步' }).count()).toBe(0);
          if (status === 'loading' || status === 'syncing') expect(await s.page.locator('svg').evaluate(e => getComputedStyle(e).animationName), 'public share sync t reduced status motion').toBe('none');
          await noOverflow(s.page);
        });
      });
    }
  }
  for (const theme of THEMES) {
    it(`share native code copy ${theme}`, async () => {
      await withPage(theme, 390, 844, { surface: 'share' }, async s => {
        const copy = s.page.getByRole('button', { name: '复制', exact: true }); await copy.scrollIntoViewIfNeeded(); await target(copy); await copy.click();
        const copied = await s.page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toBe(process.platform === 'win32' ? CODE.replaceAll('\n', '\r\n') : CODE);
        expect(await s.page.getByRole('button', { name: '已复制', exact: true }).count()).toBe(1);
      });
    });
    it(`share rotation preserves response ${theme}`, async () => {
      await withPage(theme, 390, 844, { surface: 'share' }, async s => {
        const before = await s.page.locator('header h1').elementHandle();
        await s.page.setViewportSize({ width: 640, height: 320 }); await frames(s.page); await noOverflow(s.page);
        expect(await s.page.locator('header h1').evaluate((e, old) => e === old, before)).toBe(true);
        expect(s.counts.get('GET ' + ORIGIN + '/api/simple-chat/share/' + SHARE_ID)).toBe(1);
        await s.page.setViewportSize({ width: 320, height: 640 }); await frames(s.page); await noOverflow(s.page);
        expect(await s.page.locator('header h1').textContent()).toBe(TITLE);
      });
    });
    for (const variant of ['non-json', 'http-error'] as const) {
      it(`share protocol error ${variant} ${theme}`, async () => {
        await withPage(theme, 320, 640, { surface: 'share', variant }, async s => {
          expect(await s.page.getByRole('alert').count(), 'public share sync t failed receipt is not success').toBe(1);
          expect(await s.page.locator('header').count()).toBe(0); await noOverflow(s.page);
        });
      });
    }
    it(`share missing images retain alternatives ${theme}`, async () => {
      await withPage(theme, 320, 640, { surface: 'share', variant: 'broken-image' }, async s => {
        const images = await decodedImages(s.page);
        expect(images.length, 'public share sync t two failed images').toBe(2);
        expect(images.every(image => !image.decoded && image.alt.trim().length > 0 && image.complete && image.width === 0), 'public share sync t missing image alternatives').toBe(true);
        await noOverflow(s.page);
      });
    });
  }
});


describe('public share sync measurement guard', () => {
  it('detects clipped text without accepting exact textContent as visibility', async () => {
    await withPage('gold', 390, 844, { surface: 'share' }, async s => {
      const heading = s.page.locator('header h1'), scrollHost = s.page.locator('header').locator('..');
      const style = await heading.getAttribute('style');
      try {
        await heading.evaluate(element => { element.style.maxHeight = '10px'; element.style.overflow = 'hidden'; });
        expect(await heading.textContent()).toBe(TITLE);
        await expect(readableText(heading, scrollHost)).rejects.toThrow('public share sync t text range fits its own box');
      } finally { await heading.evaluate((element, style) => { if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style); }, style); }
    });
  });
  it('detects user-scroll refusal instead of forcing a programmatic scroll', async () => {
    await withPage('gold', 390, 844, { surface: 'share' }, async s => {
      const scrollHost = s.page.locator('header').locator('..'), style = await scrollHost.getAttribute('style');
      try {
        await scrollHost.evaluate(element => { element.style.overflowY = 'hidden'; });
        await expect(nativeFooter(s.page, scrollHost)).rejects.toThrow('public share sync t native wheel moves the real share container');
      } finally { await scrollHost.evaluate((element, style) => { if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style); }, style); }
    });
  });
});
