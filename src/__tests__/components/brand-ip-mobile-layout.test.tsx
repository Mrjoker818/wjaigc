// @vitest-environment node
// Real brand-IP component and shipped CSS in Chromium. Only the three read-only
// HTTP responses are fixtures. No generated UI, private state, or model calls.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface FixtureWindow extends Window {
  brandIpMobile: { mount(theme: Theme): void; unmount(): void; state: { mounts: number; closes: number; adds: number; disposed: boolean; backgroundClicks: number } };
}
interface Session {
  context: BrowserContext; page: Page; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; mounted: boolean;
  pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; nativeWaiters: Set<() => void>;
}
const ORIGIN = 'https://brand-ip-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import BrandIpPanel from '@/components/brand-ip-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={mounts:0,closes:0,adds:0,disposed:false,backgroundClicks:0};
Object.assign(window,{brandIpMobile:{state,mount(theme:'gold'|'mono'){
 if(state.mounts||state.disposed)throw Error('IP_FIXTURE_REMOUNT');state.mounts++;
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 // A parent-owned interaction probe verifies that the REAL minimized workspace
 // stops intercepting input outside its shell. It is not a copied product UI.
 root.render(<><button id="parent-action" style={{position:'fixed',right:16,bottom:16,width:44,height:44}}
 onClick={()=>{state.backgroundClicks++}}>父级操作</button><BrandIpPanel isMonochrome={theme==='mono'}
 onClose={()=>{state.closes++;root.render(null)}} onAddImages={()=>{state.adds++}}/></>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'brand-ip-mobile-entry.tsx' } });
  if (result.outputFiles.length !== 1) throw Error('IP_FIXTURE_MEMORY_BUNDLE');
  bundle = result.outputFiles[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
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
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  const errors: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { errors.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { errors.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (errors.length) throw Error(errors.join('\n'));
}, 15000);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function bounded(name: string, operation: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('IP_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function session(theme: Theme, width: number, height: number): Promise<Session> {
  if (!browser) throw Error('IP_FIXTURE_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), nativeWaiters: new Set() }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('IP_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('IP_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('IP_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count !== 1) throw Error('IP_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return;
        }
        if (key === '/api/brand-ip/projects') { await route.fulfill({ json: { projects: [] } }); return; }
        if (key === '/api/models?type=chat' || key === '/api/models?type=image') {
          const chat = key.endsWith('chat'); await route.fulfill({ json: { success: true,
            providers: [{ id: chat ? 'offline-chat' : 'offline-image', name: '离线供应商' }],
            models: [{ id: chat ? 'offline-vision' : 'gpt-image-2', name: chat ? '离线视觉模型' : '离线图像模型', providerId: chat ? 'offline-chat' : 'offline-image' }] } }); return;
        }
        throw Error('IP_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    await page.evaluate(t => (window as unknown as FixtureWindow).brandIpMobile.mount(t), theme); s.mounted = true;
    await shell(s).waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('.bi-field select option')]
      .some(option => (option as HTMLOptionElement).value === 'offline-chat::offline-vision')); await settle(page);
    return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'IP_FIXTURE_BOOTSTRAP'); }
    throw error;
  }
}
async function nativeRequestsFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try {
    await bounded('native requests', () => new Promise<void>(resolve => {
      notify = () => { if (s.pending.size === 0) resolve(); }; s.nativeWaiters.add(notify); notify();
    }));
  } finally { if (notify) s.nativeWaiters.delete(notify); }
}
async function dispose(s: Session, expectedRefusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: string[] = [];
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).brandIpMobile.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(String(error)); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolvedBeforeClose = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const required = ['/', '/api/brand-ip/projects', '/api/models?type=chat', '/api/models?type=image'];
  const requestKeys = expectedRefusal === 'http' ? [...required, '/unexpected'].sort() : required;
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(requestKeys) || [...s.counts.values()].some(n => n !== 1)) throw Error('IP_FIXTURE_REQUEST_VALIDATION');
  const completed = [...s.completed].map(r => `${r.method()} ${r.url()}`).sort();
  const expectedCompleted = required.map(key => `GET ${ORIGIN}${key}`).sort();
  const failed = [...s.failed];
  const validFailures = expectedRefusal === 'http'
    ? failed.length === 1 && failed[0].url() === ORIGIN + '/unexpected' && s.refused.has(failed[0])
    : failed.length === 0;
  if (unresolvedBeforeClose || s.pending.size || !validFailures || JSON.stringify(completed) !== JSON.stringify(expectedCompleted)) throw Error('IP_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: IP_FIXTURE_UNKNOWN_HTTP /unexpected' : 'IP_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('IP_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (failures.length) throw Error('IP_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (s.errors.length) throw Error('IP_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height); try { await run(s); } finally { await dispose(s); }
}
function shell(s: Session): Locator { return s.page.locator('.brand-ip-workspace .bi-shell'); }
function body(s: Session): Locator { return shell(s).locator(':scope > .overflow-y-auto'); }
function topAction(s: Session, index: number): Locator { return shell(s).locator('.bi-top-actions > button').nth(index); }
async function target(control: Locator, minimum = 44): Promise<void> {
  const info = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    let clear = own.visibility === 'visible' && Number(own.opacity) > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const b = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < b.left + parent.clientLeft - 0.5 || r.right > b.left + parent.clientLeft + parent.clientWidth + 0.5)) clear = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < b.top + parent.clientTop - 0.5 || r.bottom > b.top + parent.clientTop + parent.clientHeight + 0.5)) clear = false;
    }
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x: r.x, y: r.y, width: r.width, height: r.height, clear,
      hit: [[x, y], [r.left + 8, y], [r.right - 8, y], [x, r.top + 8], [x, r.bottom - 8]].every(([a, b]) => element.contains(document.elementFromPoint(a, b))) };
  });
  expect(info.clear, 'whole target visible ' + JSON.stringify(info)).toBe(true);
  expect(info.width, 'target width').toBeGreaterThanOrEqual(minimum); expect(info.height, 'target height').toBeGreaterThanOrEqual(minimum);
  expect(info.hit, 'native center and side hits').toBe(true);
}
async function nativeReveal(s: Session, scroll: Locator, control: Locator, horizontal = false): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const clip = await scroll.boundingBox(), r = await control.boundingBox(); if (!clip || !r) throw Error('IP_FIXTURE_SCROLL_RECT');
    const start = horizontal ? r.x : r.y, size = horizontal ? r.width : r.height, bound = horizontal ? clip.x : clip.y, available = horizontal ? clip.width : clip.height;
    if (start >= bound + 1 && start + size <= bound + available - 1) return;
    expect(available, 'scroller fits target').toBeGreaterThanOrEqual(size + 2);
    const delta = start < bound + 1 ? Math.floor(start - bound - 2) : Math.ceil(start + size - bound - available + 2);
    await s.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2); await s.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta); await settle(s.page);
  }
  throw Error('IP_FIXTURE_NATIVE_SCROLL_UNREACHED');
}
async function singleLine(control: Locator): Promise<void> {
  await target(control, 0);
  const text = await control.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    return { lines: [...new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)))].length, clipped: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(text.lines, 'horizontal title').toBe(1); expect(text.clipped, 'title not clipped').toBe(false);
}
async function checkLayout(s: Session, mobile = true): Promise<void> {
  await target(topAction(s, 2), mobile ? 44 : 32);
  await target(topAction(s, 1), mobile ? 44 : 32); await target(topAction(s, 0), mobile ? 44 : 32);
  await singleLine(shell(s).locator('.bi-brand-lockup strong'));
  expect(await shell(s).evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'shell no horizontal leak').toBe(true);
  const heading = shell(s).locator('.bi-product-header h1'); await nativeReveal(s, body(s), heading); await singleLine(heading);
  const nav = shell(s).locator('.bi-stage-nav'); await nativeReveal(s, body(s), nav);
  for (let index = 0; index < 5; index++) {
    const item = nav.getByRole('button').nth(index); if (mobile) await nativeReveal(s, nav, item, true);
    await target(item, mobile ? 44 : 32);
    const lines = await item.evaluate(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!text) throw Error('IP_FIXTURE_STAGE_LABEL_MISSING'); const range = document.createRange(); range.selectNodeContents(text); return range.getClientRects().length;
    }); expect(lines, 'stage label stays horizontal').toBe(1);
  }
  expect(await body(s).evaluate(element => element.scrollLeft)).toBe(0);
}
async function capture(s: Session, theme: Theme, width: number, height: number): Promise<void> {
  await nativeReveal(s, body(s), shell(s).locator('.bi-product-header h1'));
  if (width < 768) {
    const nav = shell(s).locator('.bi-stage-nav'); await nativeReveal(s, body(s), nav);
    await nativeReveal(s, nav, nav.getByRole('button').first(), true);
  }
  const directory = path.resolve('output/mobile-ui/brand-ip-native-20261018', String(process.pid)); await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${theme}-${width}x${height}.png`); await s.page.screenshot({ path: file });
  console.log('BRAND_IP_NATIVE_CAPTURE', JSON.stringify({ path: file, theme, width, height, physicalTouch: false }));
}

describe('mobile brand ip layout', () => {
  it.each(THEMES.flatMap(theme => [[320, 640], [390, 844], [640, 320]].map(([width, height]) => ({ theme, width, height }))))
  ('$theme $width x $height keeps title and window actions in bounds', async ({ theme, width, height }) => {
    await withSession(theme, width, height, async s => { await checkLayout(s); await capture(s, theme, width, height); await topAction(s, 2).click(); expect(await shell(s).count()).toBe(0); });
  }, 25000);
  it.each(THEMES)('%s preserves a draft and model through orientation changes', async theme => {
    await withSession(theme, 390, 844, async s => {
      await checkLayout(s); const input = s.page.getByPlaceholder('例如：中国劲酒年轻化品牌IP'); await nativeReveal(s, body(s), input); await input.fill('离线草稿不提交');
      const model = shell(s).locator('.bi-field select').first(); await nativeReveal(s, body(s), model); const selected = await model.inputValue();
      for (const [width, height] of [[640, 320], [320, 640], [1440, 900]]) {
        await s.page.setViewportSize({ width, height }); await settle(s.page); await checkLayout(s, width < 768);
        expect(await input.inputValue()).toBe('离线草稿不提交'); expect(await model.inputValue()).toBe(selected);
        expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).brandIpMobile.state.mounts)).toBe(1);
      }
    });
  }, 25000);
});

describe('brand ip narrow labels', () => {
  it.each(THEMES)('%s keeps work-path button text on one horizontal line', async theme => {
    await withSession(theme, 320, 640, async s => {
      const paths = shell(s).locator('.bi-path-grid > button');
      for (let index = 0; index < 5; index++) { const button = paths.nth(index); await nativeReveal(s, body(s), button); await target(button); await singleLine(button); }
    });
  }, 25000);
});

describe('brand ip narrow toggle', () => {
  it.each(THEMES)('%s offers a full-size smart toggle with a working label', async theme => {
    await withSession(theme, 320, 640, async s => {
      const label = shell(s).locator('.bi-smart-toggle'), checkbox = label.locator('input');
      await nativeReveal(s, body(s), label); await target(label);
      const initial = await checkbox.isChecked(); await label.click(); expect(await checkbox.isChecked()).toBe(!initial);
      await label.click(); expect(await checkbox.isChecked()).toBe(initial);
    });
  }, 25000);
});

describe('brand ip desktop layout', () => {
  it.each(THEMES)('%s retains the desktop window and close action', async theme => {
    await withSession(theme, 1440, 900, async s => { await checkLayout(s, false); await capture(s, theme, 1440, 900); await topAction(s, 2).click(); expect(await shell(s).count()).toBe(0); });
  }, 25000);
});

describe('brand ip stage accessibility', () => {
  it.each(THEMES)('%s keeps unavailable future stages natively disabled', async theme => {
    await withSession(theme, 390, 844, async s => {
      const buttons = shell(s).locator('.bi-stage-nav button');
      for (let index = 1; index < 5; index++) expect(await buttons.nth(index).isDisabled(), 'future stage is disabled').toBe(true);
      expect(await buttons.nth(0).isEnabled()).toBe(true); expect(await buttons.nth(0).getAttribute('aria-current')).toBe('step');
    });
  }, 25000);
});

describe('brand ip mobile interaction', () => {
  it.each(THEMES)('%s preserves draft across minimize and advanced drawer close', async theme => {
    await withSession(theme, 320, 640, async s => {
      await checkLayout(s); const input = s.page.getByPlaceholder('例如：中国劲酒年轻化品牌IP'); await nativeReveal(s, body(s), input); await input.fill('离线未保存草稿');
      await topAction(s, 1).click(); await settle(s.page); const small = await shell(s).boundingBox(); expect(small!.height, 'minimized is a compact bar').toBeLessThanOrEqual(120);
      const parentAction = s.page.locator('#parent-action'); await target(parentAction); await parentAction.click();
      expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).brandIpMobile.state.backgroundClicks)).toBe(1);
      await target(topAction(s, 2)); await target(topAction(s, 1)); await topAction(s, 1).click(); await settle(s.page); expect(await input.inputValue()).toBe('离线未保存草稿');
      await topAction(s, 0).click(); expect(await shell(s).getByText('暂无项目', { exact: true }).isVisible()).toBe(true); await topAction(s, 0).click();
      const advanced = shell(s).getByRole('button', { name: '高级设置', exact: true }); await nativeReveal(s, body(s), advanced); await target(advanced); await advanced.click();
      const drawer = shell(s).locator('.bi-advanced-drawer'), close = drawer.locator('.bi-drawer-head button'); await target(close);
      const constraint = drawer.getByPlaceholder('例如：后期需支持PVC公仔生产'); await nativeReveal(s, drawer, constraint); await constraint.fill('只改本地输入，不保存');
      const bottomClose = drawer.getByRole('button', { name: '关闭', exact: true }); await nativeReveal(s, drawer, bottomClose); await target(bottomClose); await bottomClose.click();
      await advanced.click(); expect(await constraint.inputValue()).toBe('只改本地输入，不保存'); await close.click(); expect(await drawer.count()).toBe(0);
      expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).brandIpMobile.state.adds)).toBe(0);
    });
  }, 25000);
});

describe('brand ip fixture boundary', () => {
  it.each(['http', 'websocket'] as const)('refuses %s and classifies it as infrastructure', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') expect(await s.page.evaluate(async () => { try { await fetch('/unexpected'); return false; } catch { return true; } })).toBe(true);
      else expect(await s.page.evaluate(() => new Promise<number>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('IP_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = event => { clearTimeout(timer); resolve(event.code); };
      }))).toBe(1008);
      let failure: unknown; try { await dispose(s, transport); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).name).toBe('Error');
      expect((failure as Error).message).toBe(transport === 'http'
        ? 'IP_FIXTURE_INFRASTRUCTURE: Error: IP_FIXTURE_UNKNOWN_HTTP /unexpected'
        : 'IP_FIXTURE_INFRASTRUCTURE: IP_FIXTURE_UNKNOWN_WS');
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});

describe('brand ip fixture cleanup isolation', () => {
  it.each(['http', 'websocket'] as const)('cannot absorb a cleanup fault into expected %s refusal', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') await s.page.evaluate(async () => { try { await fetch('/unexpected'); } catch { /* expected refusal */ } });
      else await s.page.evaluate(() => new Promise<void>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('IP_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = () => { clearTimeout(timer); resolve(); };
      }));
      let failure: unknown;
      try { await dispose(s, transport, () => { throw Error('IP_FIXTURE_INJECTED_CLEANUP'); }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('IP_FIXTURE_CLEANUP_FAILURE: Error: IP_FIXTURE_INJECTED_CLEANUP');
      expect(live.has(s)).toBe(false); expect(contexts.has(s.context)).toBe(false);
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});
