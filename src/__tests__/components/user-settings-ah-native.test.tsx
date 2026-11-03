// @vitest-environment node
// AH integrated isolated native component checks; original OWN proposal retained.
// Run only through the controller serial gate; no cloud or real-device proof.
// 16 cases = gold/mono x 320x640/640x320 x four scenarios; no helper-only cases.
// Brief baseline (provided, not re-hashed by this author): UserSettingsTab
// 14702 bytes / 6c81ffb7f27776ceeafb9a33b57b57ae4cf1aefe887915545130407233e0955b.
// Runtime provenance below binds the bytes actually compiled, allowing deliberate
// controller product fixes without confusing an earlier bundle with later input.
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
type ThemeCallback = 'dark' | 'light' | 'system';
type Quality = 'standard' | 'high' | 'ultra';
interface Preferences {
  notifications: { taskComplete: boolean; creditsLow: boolean; systemUpdate: boolean };
  autoSave: boolean; imageQuality: Quality; defaultModel: string;
}
interface UiState {
  themes: ThemeCallback[]; toasts: string[]; theme: Theme | null;
  mounts: number; unmounts: number; mounted: boolean; disposed: boolean;
}
interface FixtureWindow extends Window {
  ahSettings: { state: UiState; mount(theme: Theme, saved: string | null): void; remount(): void; unmount(): void };
}
interface Session {
  context: BrowserContext; page: Page; mounted: boolean; closing: boolean;
  faults: string[]; counts: Map<string, number>; blockedHttp: number; blockedWs: number;
  pending: Set<Request>; seen: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  handlers: Set<Promise<void>>; waiters: Set<() => void>; yWheels: number;
}
interface Rect { x: number; y: number; width: number; height: number }
interface ControlObservation {
  name: string; disabled: boolean; width: number; height: number; font: number;
  clear: boolean; hit: boolean; glyphs: boolean; horizontalText: boolean; icons: boolean;
  trace: { rect: Rect; viewport: number[]; placeholder: string | null; id: string; tag: string; ancestors: Array<Record<string, unknown>> };
}
const ORIGIN = 'https://user-settings-ah-fixture.invalid';
const STORAGE_KEY = 'wujie_user_settings';
const USER_NAME = 'AH合成普通用户长中文姓名仅供移动布局验证_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEFAULTS: Preferences = {
  notifications: { taskComplete: true, creditsLow: true, systemUpdate: false },
  autoSave: true, imageQuality: 'high', defaultModel: '',
};
const SAVED: Preferences = {
  notifications: { taskComplete: false, creditsLow: false, systemUpdate: true },
  autoSave: false, imageQuality: 'ultra', defaultModel: 'ah-synthetic-saved-model-no-provider',
};
const MATRIX = [
  { theme: 'gold', width: 320, height: 640 }, { theme: 'gold', width: 640, height: 320 },
  { theme: 'mono', width: 320, height: 640 }, { theme: 'mono', width: 640, height: 320 },
] as const;
const SHELL_CLASS = 'dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden';
const MAIN_CLASS = 'dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0';
const ENTRY = String.raw`
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import UserSettingsTab from '@/components/dashboard/user-settings-tab';
type Theme='gold'|'mono';
type Callback='dark'|'light'|'system';
const state={themes:[] as Callback[],toasts:[] as string[],theme:null as Theme|null,mounts:0,unmounts:0,mounted:false,disposed:false};
const host=document.getElementById('ah-root');if(!host)throw Error('AH_HOST_REQUIRED');
let root:Root|undefined;
function render():void{
 if(state.mounted||state.disposed||!state.theme)throw Error('AH_INVALID_MOUNT');
 const isMonochrome=state.theme==='mono';
 const props={isDark:!isMonochrome,isMonochrome:!!isMonochrome,userRole:'user',userName:${JSON.stringify(USER_NAME)},
  onToggleTheme:(theme:Callback):void=>{state.themes.push(theme);},
  onToast:(message:string):void=>{state.toasts.push(message);}
 } satisfies React.ComponentProps<typeof UserSettingsTab>;
 root=createRoot(host);state.mounts++;state.mounted=true;
 // Exact shipped DashboardView shell/main classes. No additional CSS, dash-accent
 // inline variables, sidebar simulation, or fabricated product controls/labels.
 root.render(<div className=${JSON.stringify(SHELL_CLASS)}><main className=${JSON.stringify(MAIN_CLASS)}>
  <UserSettingsTab {...props}/>
 </main></div>);
}
Object.assign(window,{ahSettings:{state,
 mount(theme:Theme,saved:string|null):void{
  if(state.mounts!==0||state.disposed)throw Error('AH_INITIAL_MOUNT_ONLY');
  if(localStorage.length!==0)throw Error('AH_FRESH_CONTEXT_STORAGE_REQUIRED');
  state.theme=theme;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
  if(saved!==null)localStorage.setItem('wujie_user_settings',saved);
  render();
 },
 remount():void{
  if(!state.mounted||!root||state.disposed)throw Error('AH_REAL_ROOT_REQUIRED');
  root.unmount();state.unmounts++;state.mounted=false;root=undefined;
  // Real React disposal and new root. No storage re-seeding or in-memory prefs.
  render();
 },
 unmount():void{
  if(!state.disposed){if(state.mounted&&root){root.unmount();state.unmounts++;}
   state.mounted=false;state.disposed=true;root=undefined;}
 }
}});
`;
let browser: Browser | undefined;
let captureCount = 0;
let bundle = '', css = '', bundleInputVersion = '';
const inputDigests = new Map<string, string>(), inputContents = new Map<string, Buffer>();
const live = new Set<Session>(), contexts = new Set<BrowserContext>();
function digest(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
async function originalBytes(filename: string): Promise<Buffer> {
  const absolute = path.resolve(filename), bytes = await readFile(absolute), hash = digest(bytes);
  const previous = inputDigests.get(absolute);
  if (previous !== undefined && previous !== hash) throw Error('AH_INPUT_CHANGED ' + absolute);
  inputDigests.set(absolute, hash); inputContents.set(absolute, bytes); return bytes;
}
async function assertInputVersion(): Promise<void> {
  for (const [filename, hash] of inputDigests) {
    if (digest(await readFile(filename)) !== hash) throw Error('AH_INPUT_CHANGED ' + filename);
  }
  expect(bundleInputVersion, 'version binds actual compiled bytes, ENTRY, JS and CSS').toBe(
    digest(JSON.stringify([...inputDigests].sort(([a], [b]) => a.localeCompare(b))) + '\n' + ENTRY + '\n' + bundle + '\n' + css));
}
beforeAll(async (): Promise<void> => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('AH_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await originalBytes('tsconfig.json');
  const built = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'ah-user-settings-entry.tsx' },
    plugins: [{ name: 'ah-original-byte-provenance', setup(buildApi): void {
      buildApi.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path).slice(1);
        const loader: import('esbuild').Loader = extension === 'tsx' ? 'tsx' : extension === 'ts' ? 'ts'
          : extension === 'jsx' ? 'jsx' : extension === 'json' ? 'json' : 'js';
        return { contents: await originalBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AH_SINGLE_MEMORY_BUNDLE_REQUIRED');
  bundle = built.outputFiles[0].text;
  const inputs = Object.keys(built.metafile.inputs).filter(file => file !== 'ah-user-settings-entry.tsx');
  if (!inputs.some(file => path.resolve(file) === path.resolve('src/components/dashboard/user-settings-tab.tsx'))) throw Error('AH_REAL_USER_SETTINGS_INPUT_REQUIRED');
  for (const filename of inputs) if (!inputDigests.has(path.resolve(filename))) throw Error('AH_UNVERSIONED_BUNDLE_INPUT ' + filename);
  const sources = inputs.filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file)).map(file => {
    const bytes = inputContents.get(path.resolve(file)); if (!bytes) throw Error('AH_INPUT_BYTES_REQUIRED');
    return { content: bytes.toString('utf8'), extension: path.extname(file).slice(1) };
  });
  const shell = (await originalBytes('src/components/dashboard/dashboard-view.tsx')).toString('utf8');
  expect(shell.includes('className="' + SHELL_CLASS + '"'), 'copied real shell class list').toBe(true);
  expect(shell.includes('<main className="' + MAIN_CLASS + '"'), 'copied real main class list').toBe(true);
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile((await originalBytes('src/app/globals.css')).toString('utf8'), { base: process.cwd(),
    loadStylesheet: async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css'
        ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: filename, base: path.dirname(filename), content: (await originalBytes(filename)).toString('utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  bundleInputVersion = digest(JSON.stringify([...inputDigests].sort(([a], [b]) => a.localeCompare(b))) + '\n' + ENTRY + '\n' + bundle + '\n' + css);
  await assertInputVersion();
  console.log('AH_COMPILED_PROVENANCE', JSON.stringify({ version: bundleInputVersion,
    inputs: [...inputDigests].map(([filename, sha256]) => ({ filename, sha256, bytes: inputContents.get(filename)?.length })),
    entry: digest(ENTRY), javascript: digest(bundle), stylesheet: digest(css) }));
  browser = await chromium.launch({ headless: true });
}, 30000);

// AF calibrated closure and timing: unchanged bounds, no retries to hide failures.
async function bounded<T>(name: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([run(), new Promise<never>((_, reject): void => {
    timer = setTimeout((): void => reject(Error('AH_CLEANUP_TIMEOUT ' + name)), 2500);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function frames(page: Page): Promise<void> {
  await page.evaluate((): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function tracked(s: Session, run: () => Promise<void>): Promise<void> {
  const operation = run(); s.handlers.add(operation);
  try { await operation; } finally { s.handlers.delete(operation); }
}
async function pendingFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try { await bounded('native request completion', (): Promise<void> => new Promise(resolve => {
    notify = (): void => { if (s.pending.size === 0) resolve(); }; s.waiters.add(notify); notify();
  })); } finally { if (notify) s.waiters.delete(notify); }
}
async function drain(s: Session): Promise<void> {
  await bounded('route handlers', async (): Promise<void> => { await Promise.all([...s.handlers]); });
  await pendingFinished(s);
  await bounded('final route handlers', async (): Promise<void> => { await Promise.all([...s.handlers]); });
  if (s.handlers.size || s.pending.size) throw Error('AH_INFLIGHT_REMAINS');
}
async function state(s: Session): Promise<UiState> {
  return await s.page.evaluate((): UiState => {
    const value = (window as unknown as FixtureWindow).ahSettings.state;
    return { ...value, themes: [...value.themes], toasts: [...value.toasts] };
  });
}
async function storage(s: Session): Promise<Record<string, string>> {
  return await s.page.evaluate((): Record<string, string> => {
    const values: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); if (key !== null) values[key] = localStorage.getItem(key) ?? '';
    }
    return values;
  });
}
async function payload(s: Session, expected: Preferences | null): Promise<void> {
  expect(await storage(s), 'all local storage keys and exact literal serialized payload').toEqual(
    expected === null ? {} : { [STORAGE_KEY]: JSON.stringify(expected) });
}
async function quiet(s: Session): Promise<void> {
  await frames(s.page); await drain(s);
  expect(s.faults).toEqual([]); expect(s.blockedHttp).toBe(0); expect(s.blockedWs).toBe(0);
  expect([...s.counts.keys()].every(key => ['GET ' + ORIGIN + '/', 'GET ' + ORIGIN + '/ah.js', 'GET ' + ORIGIN + '/ah.css'].includes(key))).toBe(true);
}
async function open(theme: Theme, width: number, height: number, saved: Preferences | null): Promise<Session> {
  await assertInputVersion(); if (!browser) throw Error('AH_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  contexts.add(context); let session: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, mounted: false, closing: false, faults: [], counts: new Map(), blockedHttp: 0, blockedWs: 0,
      pending: new Set(), seen: new Set(), completed: new Set(), failed: new Set(), handlers: new Set(), waiters: new Set(), yWheels: 0 };
    session = s; live.add(s);
    context.on('request', (request): void => { s.seen.add(request); s.pending.add(request); });
    context.on('requestfinished', (request): void => { s.pending.delete(request); s.completed.add(request); for (const notify of s.waiters) notify(); });
    context.on('requestfailed', (request): void => { s.pending.delete(request); s.failed.add(request); for (const notify of s.waiters) notify(); });
    context.on('page', (other): void => { if (other !== page) s.faults.push('AH_UNEXPECTED_PAGE'); });
    page.on('pageerror', (error): void => { s.faults.push('AH_PAGEERROR ' + error.message); });
    page.on('console', (message): void => { if (message.type() === 'error') s.faults.push('AH_CONSOLE_ERROR ' + message.text()); });
    page.on('download', (): void => { s.faults.push('AH_UNEXPECTED_DOWNLOAD'); });
    page.on('dialog', (dialog): void => {
      s.faults.push('AH_UNEXPECTED_DIALOG');
      void tracked(s, async (): Promise<void> => { try { await dialog.dismiss(); } catch (error) { s.faults.push(String(error)); } });
    });
    await context.routeWebSocket('**/*', async (socket): Promise<void> => {
      await tracked(s, async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AH_UNKNOWN_WS ' + socket.url());
        try { await socket.close({ code: 1008, reason: 'AH isolated fixture' }); } catch (error) { s.faults.push(String(error)); }
      });
    });
    await context.route('**/*', async (route): Promise<void> => {
      await tracked(s, async (): Promise<void> => {
        const request = route.request(), key = request.method() + ' ' + request.url();
        const count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        try {
          const url = new URL(request.url()), headers = request.headers();
          if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || request.method() !== 'GET'
            || request.postData() !== null || count !== 1 || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('AH_UNKNOWN_HTTP ' + key);
          if (url.pathname === '/' && request.resourceType() === 'document' && request.isNavigationRequest()) {
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/ah.css"><script src="/ah.js" defer></script></head><body><div id="ah-root"></div></body></html>' }); return;
          }
          if (url.pathname === '/ah.js' && request.resourceType() === 'script') { await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle }); return; }
          if (url.pathname === '/ah.css' && request.resourceType() === 'stylesheet') { await route.fulfill({ contentType: 'text/css; charset=utf-8', body: css }); return; }
          throw Error('AH_UNKNOWN_HTTP ' + key);
        } catch (error) {
          s.blockedHttp++; s.faults.push(String(error));
          try { await route.abort('blockedbyclient'); } catch (abortError) { s.faults.push('AH_ABORT_ERROR ' + String(abortError)); }
        }
      });
    });
    await page.goto(ORIGIN + '/');
    s.mounted = true;
    await page.evaluate(({ theme, saved }): void => (window as unknown as FixtureWindow).ahSettings.mount(theme, saved),
      { theme, saved: saved === null ? null : JSON.stringify(saved) });
    await page.getByRole('heading', { name: '个人资料', exact: true }).waitFor(); await frames(page); await drain(s);
    expect(await page.locator('html').getAttribute('class')).toBe(theme === 'mono' ? 'theme-monochrome' : 'theme-gold');
    expect(await page.evaluate((): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.locator('html').evaluate((element): string => getComputedStyle(element).getPropertyValue('--primary').trim())).toBe(theme === 'mono' ? '#3b82f6' : '#d4af37');
    expect(await page.locator('html').evaluate((element): string => getComputedStyle(element).getPropertyValue('--card').trim())).toBe(theme === 'mono' ? '#f8fafc' : '#1c2333');
    await payload(s, saved); return s;
  } catch (error) {
    try {
      if (session) await dispose(session);
      else { await bounded('bootstrap context', async (): Promise<void> => { await context.close(); }); contexts.delete(context); }
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AH_BOOTSTRAP_AND_CLEANUP'); }
    throw error;
  }
}
async function dispose(s: Session): Promise<void> {
  const errors: unknown[] = []; s.closing = true;
  try {
    if (s.mounted) {
      const value = await bounded('unmount', (): Promise<UiState> => s.page.evaluate((): UiState => {
        const ui = (window as unknown as FixtureWindow).ahSettings; ui.unmount();
        return { ...ui.state, themes: [...ui.state.themes], toasts: [...ui.state.toasts] };
      }));
      expect(value.disposed, 'React root disposed').toBe(true); expect(value.mounted).toBe(false);
      expect(value.unmounts, 'every created React root really unmounted').toBe(value.mounts);
      await frames(s.page);
    }
    await drain(s); await assertInputVersion();
  } catch (error) { errors.push(error); }
  finally {
    try { await bounded('context close', async (): Promise<void> => { await s.context.close(); }); contexts.delete(s.context); live.delete(s); }
    catch (error) { errors.push(error); }
    try { await bounded('closed-context route drain', async (): Promise<void> => { await Promise.all([...s.handlers]); }); } catch (error) { errors.push(error); }
  }
  try {
    expect([...s.counts].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['GET ' + ORIGIN + '/', 1], ['GET ' + ORIGIN + '/ah.css', 1], ['GET ' + ORIGIN + '/ah.js', 1],
    ].sort(([a], [b]) => String(a).localeCompare(String(b))));
    expect(s.blockedHttp, 'unexpected HTTP is denied and recorded even if product catches fetch failure').toBe(0);
    expect(s.blockedWs, 'all WS attempts closed and recorded').toBe(0);
    expect(s.seen.size).toBe(3); expect(s.completed.size).toBe(3); expect(s.failed.size).toBe(0);
    expect([...s.seen].every(request => s.completed.has(request))).toBe(true);
    expect(s.pending.size).toBe(0); expect(s.handlers.size).toBe(0); expect(s.waiters.size).toBe(0);
    expect(s.faults).toEqual([]);
  } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'AH_DISPOSAL');
}
afterAll(async (): Promise<void> => {
  const errors: unknown[] = [];
  try {
    for (const s of [...live]) try { await dispose(s); } catch (error) { errors.push(error); }
    for (const context of [...contexts]) try { await bounded('remaining context', async (): Promise<void> => { await context.close(); }); contexts.delete(context); } catch (error) { errors.push(error); }
  } finally {
    try { await bounded('browser close', async (): Promise<void> => { await browser?.close(); }); } catch (error) { errors.push(error); }
    finally { browser = undefined; }
  }
  if (errors.length) throw new AggregateError(errors, 'AH_FINAL_CLEANUP');
}, 15000);

async function capture(s: Session, label: string): Promise<void> {
  const folder = path.resolve('output/playwright/user-settings-ah-native-20261019', String(process.pid));
  await mkdir(folder, {recursive:true});
  const size = s.page.viewportSize(), ui = await state(s);
  const file = path.join(folder, ui.theme + '-' + size?.width + 'x' + size?.height + '-' + (++captureCount) + '-' + label + '.png');
  await s.page.screenshot({path:file});
  console.log('AH_CAPTURE', JSON.stringify({path:file,label,inputVersion:bundleInputVersion}));
}
async function withSession(theme: Theme, width: number, height: number, saved: Preferences | null, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(theme, width, height, saved); let failure: unknown; let failed = false;
  try { await run(s); } catch (error) { failure = error; failed = true; }
  try { await capture(s, failed ? 'failure-state' : 'end-state'); } catch (captureError) { failure=failed ? new AggregateError([failure,captureError], 'AH_ASSERTION_AND_CAPTURE') : captureError; failed=true; }
  try { await dispose(s); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], 'AH_ASSERTION_AND_CLEANUP'); throw cleanup; }
  if (failed) throw failure;
}

// AF geometry: own border box is clipped ONLY by ancestors, while its own
// opacity/visibility/display are still mandatory. Glyphs include their own
// clipping containers. Keep the original 0.5px, 1px and 44px tolerances.
async function box(control: Locator): Promise<Rect> {
  const value = await control.boundingBox(); if (!value) throw Error('AH_NO_RENDERED_RECT'); return value;
}
async function observation(control: Locator): Promise<ControlObservation> {
  return await control.evaluate((element): ControlObservation => {
    const bounds = element.getBoundingClientRect(), own = getComputedStyle(element);
    const visible = (rect: DOMRect, node: Element): boolean => {
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight, opacity = 1;
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), r = parent.getBoundingClientRect(); opacity *= Number(css.opacity);
        if (css.display === 'none' || css.visibility !== 'visible') return false;
        if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth); }
        if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight); }
      }
      return opacity > 0 && rect.width > 0 && rect.height > 0 && rect.left >= left - 0.5 && rect.right <= right + 0.5 && rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5;
    };
    const points = [[bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      [bounds.left + 8, bounds.top + bounds.height / 2], [bounds.right - 8, bounds.top + bounds.height / 2],
      [bounds.left + bounds.width / 2, bounds.top + 8], [bounds.left + bounds.width / 2, bounds.bottom - 8]];
    const hit = points.every(([x, y]): boolean => { const target = document.elementFromPoint(x, y); return Boolean(target && element.contains(target)); });
    const tops = new Set<number>(); let glyphs = true;
    if (!element.matches('input,select,textarea')) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode; if (!node.textContent?.trim() || !node.parentElement) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) {
          if (!visible(rect, node.parentElement)) glyphs = false; tops.add(Math.round(rect.top));
        }
      }
    }
    return { name: element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent?.trim() ?? element.tagName,
      disabled: element.matches(':disabled'), width: bounds.width, height: bounds.height, font: Number.parseFloat(own.fontSize),
      clear: Number(own.opacity) > 0 && own.visibility === 'visible' && own.display !== 'none' && visible(bounds, element.parentElement ?? element), hit, glyphs,
      horizontalText: own.writingMode === 'horizontal-tb' && (!element.matches('button') || tops.size <= 1),
      icons: [...element.querySelectorAll('svg')].every(icon => visible(icon.getBoundingClientRect(), icon)),
      trace: { rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, viewport: [innerWidth, innerHeight],
        placeholder: element.getAttribute('placeholder'), id: element.id, tag: element.tagName,
        ancestors: (() => { const values: Array<Record<string, unknown>> = [];
          for (let node: Element | null = element; node && values.length < 12; node = node.parentElement) {
            const r = node.getBoundingClientRect(), style = getComputedStyle(node);
            values.push({ tag: node.tagName, class: node.getAttribute('class'), rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight, node.scrollLeft, node.scrollTop],
              overflow: [style.overflowX, style.overflowY], display: style.display, minWidth: style.minWidth, opacity: style.opacity });
          } return values; })() } };
  });
}
async function target(control: Locator): Promise<void> {
  const value = await observation(control);
  if (!value.clear || !value.glyphs || !value.horizontalText || !value.icons || (!value.disabled && (value.width < 44 || value.height < 44 || !value.hit))) console.log('AH_CONTROL_OBSERVATION', JSON.stringify(value));
  expect(value.clear, value.name + ' whole border box fits viewport and clipping ancestors').toBe(true);
  expect(value.glyphs, value.name + ' actual text glyphs fit').toBe(true);
  expect(value.horizontalText, value.name + ' button text horizontal and one line').toBe(true);
  expect(value.icons, value.name + ' icon glyphs fit').toBe(true);
  if (value.disabled) { expect(await control.isDisabled()).toBe(true); return; }
  expect(value.width, value.name + ' operative width').toBeGreaterThanOrEqual(44);
  expect(value.height, value.name + ' operative height').toBeGreaterThanOrEqual(44);
  expect(value.hit, value.name + ' five native hit samples belong to control').toBe(true);
  if (await control.evaluate((element): boolean => element.matches('input:not([type="checkbox"]),select,textarea'))) {
    expect(value.font, value.name + ' mobile form font').toBeGreaterThanOrEqual(16);
  }
}
async function revealY(s: Session, control: Locator): Promise<void> {
  for (let step = 0; step < 10; step++) {
    const move = await control.evaluate((element): { x: number; y: number; delta: number } | null => {
      const target = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (!/auto|scroll/.test(style.overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
        let left = Math.max(0, rect.left + parent.clientLeft), right = Math.min(innerWidth, rect.left + parent.clientLeft + parent.clientWidth);
        let top = Math.max(0, rect.top + parent.clientTop), bottom = Math.min(innerHeight, rect.top + parent.clientTop + parent.clientHeight);
        for (let outer = parent.parentElement; outer; outer = outer.parentElement) {
          const css = getComputedStyle(outer), r = outer.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, r.top + outer.clientTop); bottom = Math.min(bottom, r.top + outer.clientTop + outer.clientHeight); }
          if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, r.left + outer.clientLeft); right = Math.min(right, r.left + outer.clientLeft + outer.clientWidth); }
        }
        // Account for a real sticky header/footer only when it occupies an edge
        // of this scrollport and is not an ancestor of the target. No CSS edits.
        for (const sticky of parent.querySelectorAll<HTMLElement>('.sticky')) {
          if (sticky.contains(element) || getComputedStyle(sticky).position !== 'sticky') continue;
          const r = sticky.getBoundingClientRect();
          if (r.bottom >= bottom - 0.5 && r.top < bottom && r.top > top) bottom = r.top;
          else if (r.top <= top + 0.5 && r.bottom > top && r.bottom < bottom) top = r.bottom;
        }
        const delta = target.top < top + 2 ? target.top - top - 8 : target.bottom > bottom - 2 ? target.bottom - bottom + 8 : 0;
        if (right <= left || bottom <= top || delta === 0 || (delta < 0 && parent.scrollTop <= 0)
          || (delta > 0 && parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 1)) continue;
        return { x: (left + right) / 2, y: Math.max(top + 1, Math.min(bottom - 1, (top + bottom) / 2)), delta };
      }
      return null;
    });
    if (!move) return;
    await s.page.mouse.move(move.x, move.y); await s.page.mouse.wheel(0, move.delta); s.yWheels++; await frames(s.page);
  }
  // No forced/DOM scroll fallback. target() still must pass.
}
async function reach(s: Session, control: Locator): Promise<void> { await revealY(s, control); await target(control); }
async function click(s: Session, control: Locator): Promise<void> {
  await reach(s, control); expect(await control.isDisabled()).toBe(false);
  const r = await box(control); await s.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await frames(s.page);
}
async function fillFocused(s: Session, control: Locator, value: string): Promise<void> {
  expect(await control.evaluate((element): boolean => document.activeElement === element)).toBe(true);
  await s.page.keyboard.press('ControlOrMeta+A');
  if (value === '') await s.page.keyboard.press('Backspace'); else await s.page.keyboard.type(value);
  await frames(s.page); expect(await control.inputValue()).toBe(value);
}
async function choose(s: Session, select: Locator, value: Quality): Promise<void> {
  const values = await select.locator('option').evaluateAll((elements): string[] => elements.map(element => (element as HTMLOptionElement).value));
  const index = values.indexOf(value); expect(index).toBeGreaterThanOrEqual(0);
  await click(s, select); await s.page.keyboard.press('Escape');
  expect(await select.evaluate((element): boolean => document.activeElement === element)).toBe(true);
  await s.page.keyboard.press('Home'); for (let step = 0; step < index; step++) await s.page.keyboard.press('ArrowDown');
  await frames(s.page); expect(await select.inputValue()).toBe(value);
}

function main(s: Session): Locator { return s.page.locator('main.dashboard-scrollable'); }
function section(s: Session, title: string): Locator {
  // Shipped heading -> header -> card; no fixture role/id/label additions.
  return main(s).getByRole('heading', { name: title, exact: true }).locator('..').locator('..');
}
function quality(s: Session): Locator { return section(s, '生成偏好').getByRole('combobox'); }
function toggle(s: Session, label: string): Locator {
  const card = section(s, label === '自动保存' ? '生成偏好' : '通知设置');
  return card.getByText(label, { exact: true }).locator('..').locator('..').locator('button');
}
function dirty(s: Session): Locator { return main(s).getByText('有未保存的修改', { exact: true }).locator('..'); }
function dialog(s: Session): Locator {
  return main(s).getByRole('heading', { name: '修改密码', exact: true }).locator('..');
}
async function readable(s: Session, text: Locator): Promise<void> {
  await revealY(s, text); const value = await observation(text);
  if (!value.clear || !value.glyphs || !value.horizontalText) console.log('AH_TEXT_OBSERVATION', JSON.stringify(value));
  expect(value.clear, value.name + ' readable full box').toBe(true);
  expect(value.glyphs, value.name + ' text ranges not clipped').toBe(true);
  expect(value.horizontalText, value.name + ' horizontal writing mode').toBe(true);
  // A horizontal writing-mode alone does not catch a one-CJK-glyph-wide column.
  // Measure literal CJK glyph ranges: any multi-character prose block must have
  // at least one line with two distinct horizontal glyph positions.
  const prose = await text.evaluate((element): { cjk: number; horizontalPair: boolean } => {
    const lines = new Map<number, number[]>(); let cjk = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, value = node.textContent ?? '';
      for (let index = 0; index < value.length; index++) {
        if (!/[\u3400-\u9fff]/.test(value[index])) continue;
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
        const r = range.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
        cjk++; const key = Math.round(r.top), positions = lines.get(key) ?? []; positions.push(r.left); lines.set(key, positions);
      }
    }
    return { cjk, horizontalPair: [...lines.values()].some(values => values.some(x => Math.abs(x - values[0]) > 0.5)) };
  });
  if (prose.cjk > 1) expect(prose.horizontalPair, 'multi-character CJK prose does not collapse to a vertical glyph column').toBe(true);
}
async function pageFits(s: Session, card?: Locator): Promise<void> {
  const violations = await s.page.evaluate((): string[] => {
    const bad: string[] = [];
    for (const selector of ['html', 'body', '.dashboard-root', 'main.dashboard-scrollable']) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.scrollWidth > element.clientWidth + 1) bad.push(selector + ':horizontal-scroll');
    }
    for (const element of document.querySelectorAll<HTMLElement>('#ah-root *')) {
      const r = element.getBoundingClientRect();
      if (r.width && r.height && (r.left < -0.5 || r.right > innerWidth + 0.5)) bad.push(element.tagName + ':' + element.getAttribute('class'));
    }
    return bad;
  });
  expect(violations, 'settings has no horizontal overflow, including hidden/clipped overflow').toEqual([]);
  if (card) expect(await card.evaluate((element): boolean => element.scrollWidth <= element.clientWidth + 1), 'card has no hidden horizontal content').toBe(true);
}
async function noOverlap(first: Locator, second: Locator): Promise<void> {
  const a = await box(first), b = await box(second);
  expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5, 'distinct controls do not overlap').toBe(false);
}
async function toggleIs(control: Locator, expected: boolean): Promise<void> {
  expect(await control.count(), 'one shipped toggle for the literal row').toBe(1);
  const checked = await control.getAttribute('aria-checked');
  if (checked !== null) expect(checked).toBe(String(expected));
  else {
    // Existing implementation paints state with these literal shipped classes;
    // do not invent ARIA in the fixture or read React internals.
    expect(await control.evaluate((element): boolean => element.classList.contains('bg-primary'))).toBe(expected);
    expect(await control.evaluate((element): boolean => element.classList.contains('bg-muted'))).toBe(!expected);
  }
}
async function valuesAre(s: Session, expected: Preferences): Promise<void> {
  expect(await quality(s).inputValue()).toBe(expected.imageQuality);
  await toggleIs(toggle(s, '自动保存'), expected.autoSave);
  await toggleIs(toggle(s, '任务完成通知'), expected.notifications.taskComplete);
  await toggleIs(toggle(s, '积分不足提醒'), expected.notifications.creditsLow);
  await toggleIs(toggle(s, '系统更新通知'), expected.notifications.systemUpdate);
}
async function preferenceGeometry(s: Session): Promise<void> {
  await reach(s, quality(s));
  for (const label of ['自动保存', '任务完成通知', '积分不足提醒', '系统更新通知']) {
    const control = toggle(s, label); await reach(s, control);
    const text = section(s, label === '自动保存' ? '生成偏好' : '通知设置').getByText(label, { exact: true });
    await readable(s, text); await noOverlap(text, control);
  }
}
async function stickyReach(s: Session): Promise<void> {
  const bar = dirty(s); expect(await bar.count()).toBe(1);
  expect(await bar.evaluate((element): string => getComputedStyle(element).position)).toBe('sticky');
  expect(await bar.evaluate((element): string => getComputedStyle(element).bottom)).toBe('0px');
  await readable(s, bar.getByText('有未保存的修改', { exact: true }));
  const reset = bar.getByRole('button', { name: '重置', exact: true }), save = bar.getByRole('button', { name: '保存设置', exact: true });
  await reach(s, reset); await reach(s, save); await noOverlap(reset, save);
  await noOverlap(bar.getByText('有未保存的修改', { exact: true }), reset);
  await pageFits(s, bar); await capture(s, 'dirty-bar');
}
async function saveLocal(s: Session, expected: Preferences, toasts: string[]): Promise<void> {
  await stickyReach(s);
  await click(s, dirty(s).getByRole('button', { name: '保存设置', exact: true }));
  await payload(s, expected); await valuesAre(s, expected);
  expect((await state(s)).toasts).toEqual(toasts);
  expect(await main(s).getByText('有未保存的修改', { exact: true }).count()).toBe(0);
  expect(await main(s).getByRole('button', { name: '保存设置', exact: true }).count()).toBe(0);
  expect(await main(s).getByRole('button', { name: '重置', exact: true }).count()).toBe(0);
  await quiet(s);
}
async function passwordOpen(s: Session): Promise<Locator> {
  await click(s, section(s, '安全与隐私').getByRole('button', { name: '修改密码', exact: true }));
  const card = dialog(s); await card.waitFor();
  expect(await card.locator('input[type="password"]').count()).toBe(2);
  await capture(s, 'password-open'); return card;
}
async function labelledPassword(s: Session, card: Locator, name: '新密码' | '确认密码'): Promise<Locator> {
  const control = card.getByLabel(name, { exact: true });
  // Hard requirement: on the supplied source unassociated labels must fail here.
  // No placeholder fallback, fake id/for/aria-label, or swallowed expected failure.
  expect(await control.count(), name + ' has an actual accessible label in product DOM').toBe(1);
  expect(await control.getAttribute('type')).toBe('password');
  const label = card.locator('label').filter({ hasText: new RegExp('^' + name + '$') });
  expect(await label.count()).toBe(1); await readable(s, label);
  expect(await control.evaluate((element, name): boolean => element instanceof HTMLInputElement
    && [...(element.labels ?? [])].some(value => value.textContent?.trim() === name), name), 'real HTML label association').toBe(true);
  return control;
}
async function focusViaLabel(s: Session, card: Locator, name: '新密码' | '确认密码', control: Locator): Promise<void> {
  const label = card.locator('label').filter({ hasText: new RegExp('^' + name + '$') }); await readable(s, label);
  const r = await box(label); await s.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await frames(s.page);
  expect(await control.evaluate((element): boolean => document.activeElement === element), 'native label click focuses its own input').toBe(true);
  await reach(s, control);
}
async function invalidSubmit(s: Session, card: Locator, expected: 'empty' | 'short' | 'mismatch', toasts: string[]): Promise<void> {
  const first = await card.getByLabel('新密码', { exact: true }).inputValue();
  const second = await card.getByLabel('确认密码', { exact: true }).inputValue();
  if (expected === 'empty') { expect(first).toBe(''); expect(second).toBe(''); }
  if (expected === 'short') { expect(first).toBe('Ah1'); expect(second).toBe('Ah2'); expect(first.length).toBeLessThan(6); }
  if (expected === 'mismatch') { expect(first).toBe('AhInvalidOne123!'); expect(second).toBe('AhDifferentTwo456!'); }
  expect(first.length < 6 || first !== second, 'literal prerequisite prevents every valid matching password submission').toBe(true);
  await click(s, card.getByRole('button', { name: '确认修改', exact: true }));
  expect((await state(s)).toasts).toEqual(toasts);
  expect(await dialog(s).count(), 'original validation keeps dialog open').toBe(1);
  await payload(s, null); await quiet(s);
}
async function closePasswordButton(s: Session, card: Locator): Promise<void> {
  // The supplied close button is a direct card child containing an X icon.
  // It is measured as shipped, without fabricating an accessible button name.
  const close = card.locator(':scope > button'); expect(await close.count()).toBe(1);
  expect(await close.locator('svg').count()).toBe(1);
  await reach(s, close); await noOverlap(card.getByRole('heading', { name: '修改密码', exact: true }), close);
  await click(s, close); expect(await dialog(s).count()).toBe(0);
}
async function closePasswordBackdrop(s: Session, card: Locator): Promise<void> {
  const backdrop = card.locator('..').locator(':scope > div').filter({ hasNot: s.page.getByRole('heading', { name: '修改密码', exact: true }) });
  expect(await backdrop.count()).toBe(1);
  const point = await backdrop.evaluate((element): { x: number; y: number } | null => {
    const r = element.getBoundingClientRect();
    for (const [x, y] of [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]]) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y); if (hit && element.contains(hit)) return { x, y };
    }
    return null;
  });
  expect(point, 'a visible real backdrop point, outside dialog, receives native click').not.toBeNull();
  if (!point) throw Error('AH_NATIVE_BACKDROP_POINT_REQUIRED');
  await s.page.mouse.click(point.x, point.y); await frames(s.page);
  expect(await dialog(s).count()).toBe(0); await quiet(s);
}
async function nativeScrollEvidenceIfNeeded(s: Session, card: Locator, bottomControl: Locator): Promise<void> {
  const request = await card.evaluate((element): { x: number; y: number; delta: number; offsets: number[] } | null => {
    const nodes = [element, ...element.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight);
    const node = nodes[0]; if (!node) return null;
    const r = node.getBoundingClientRect(), left = Math.max(0, r.left + node.clientLeft), right = Math.min(innerWidth, r.left + node.clientLeft + node.clientWidth);
    const top = Math.max(0, r.top + node.clientTop), bottom = Math.min(innerHeight, r.top + node.clientTop + node.clientHeight);
    return { x: (left + right) / 2, y: (top + bottom) / 2, delta: node.scrollTop > 0 ? -80 : 80, offsets: nodes.map(value => value.scrollTop) };
  });
  if (request) {
    await s.page.mouse.move(request.x, request.y); await s.page.mouse.wheel(0, request.delta); s.yWheels++; await frames(s.page);
    const after = await card.evaluate((element): number[] => [element, ...element.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight).map(node => node.scrollTop));
    expect(after.some((value, index) => Math.abs(value - request.offsets[index]) > 0.5), 'native wheel moves this actual password dialog scrollport').toBe(true);
  }
  await reach(s, bottomControl);
}

describe.each(MATRIX)('AH ordinary user settings $theme $width x $height', ({ theme, width, height }): void => {
  it('initial profile/security/appearance/preferences/notifications literal content and native geometry', async (): Promise<void> => {
    await withSession(theme, width, height, null, async (s): Promise<void> => {
      await valuesAre(s, DEFAULTS);
      expect(await main(s).getByText('普通用户', { exact: true }).textContent()).toBe('普通用户');
      expect(await main(s).getByText('管理员', { exact: true }).count()).toBe(0);
      expect(await main(s).getByText(USER_NAME, { exact: true }).textContent()).toBe(USER_NAME);
      expect(await dirty(s).count()).toBe(0);
      const login = section(s, '安全与隐私').getByRole('button', { name: '登录记录', exact: true });
      await click(s, login);
      expect((await state(s)).toasts).toEqual(['登录记录功能即将上线，敬请期待']);
      expect((await state(s)).themes).toEqual([]); await payload(s, null);
      expect(await dirty(s).count(), 'read-only login record action does not dirty local prefs').toBe(0);
      for (const name of ['个人资料', '安全与隐私', '外观主题', '生成偏好', '通知设置']) {
        const card = section(s, name);
        await readable(s, card.getByRole('heading', { name, exact: true }));
        // All shipped headings, labels, body text and helper descriptions, not a
        // synthetic text sample; native wheel reveals each before measurement.
        for (const text of await card.locator('label,div.text-sm,div.text-xs').all()) await readable(s, text);
      }
      const name = main(s).getByText(USER_NAME, { exact: true }); await readable(s, name);
      expect(await name.evaluate((element): boolean => element.scrollWidth <= element.clientWidth + 1), 'long CJK plus unbroken username does not overflow its own box').toBe(true);
      for (const name of ['修改密码', '登录记录']) await reach(s, section(s, '安全与隐私').getByRole('button', { name, exact: true }));
      for (const name of ['深色', '浅色', '跟随系统']) await reach(s, section(s, '外观主题').getByRole('button', { name, exact: true }));
      await preferenceGeometry(s);
      expect(await main(s).locator('button,input,select,textarea').count(), 'all ten initial operative controls enumerated').toBe(10);
      await pageFits(s); await payload(s, null); await quiet(s);
    });
  }, 25000);

  it('literal theme callbacks and every local preference change save through reachable sticky bar', async (): Promise<void> => {
    await withSession(theme, width, height, null, async (s): Promise<void> => {
      const callbacks: ThemeCallback[] = [];
      for (const [label, value] of [['深色', 'dark'], ['浅色', 'light'], ['跟随系统', 'system']] as const) {
        await click(s, section(s, '外观主题').getByRole('button', { name: label, exact: true }));
        callbacks.push(value); expect((await state(s)).themes).toEqual(callbacks);
        expect(await dirty(s).count()).toBe(1); await payload(s, null);
      }
      // Dashboard integration resets monochrome through its parent callback.
      // This component fixture observes literal callbacks only; it intentionally
      // does not simulate a new theme state or claim app theme-switch coverage.
      expect(await s.page.locator('html').getAttribute('class')).toBe(theme === 'mono' ? 'theme-monochrome' : 'theme-gold');
      for (const value of ['standard', 'high', 'ultra'] as const) { await choose(s, quality(s), value); await payload(s, null); }
      for (const [label, before, after] of [
        ['自动保存', true, false], ['任务完成通知', true, false], ['积分不足提醒', true, false], ['系统更新通知', false, true],
      ] as const) {
        const control = toggle(s, label); await toggleIs(control, before); await click(s, control); await toggleIs(control, after);
        await payload(s, null); expect((await state(s)).toasts).toEqual([]);
      }
      const expected: Preferences = {
        notifications: { taskComplete: false, creditsLow: false, systemUpdate: true },
        autoSave: false, imageQuality: 'ultra', defaultModel: '',
      };
      await valuesAre(s, expected); await preferenceGeometry(s); await saveLocal(s, expected, ['设置已保存']);
      expect((await state(s)).themes).toEqual(['dark', 'light', 'system']);
      if (height === 320) {
        expect(s.yWheels, 'short viewport reached page controls using native vertical wheel').toBeGreaterThan(0);
        expect(await main(s).evaluate((element): number => element.scrollTop), 'actual main scroll offset moved').toBeGreaterThan(0);
      }
      await pageFits(s);
    });
  }, 25000);

  it('saved local preferences restore then reset save and real React unmount/remount reads complete defaults', async (): Promise<void> => {
    await withSession(theme, width, height, SAVED, async (s): Promise<void> => {
      await valuesAre(s, SAVED); await payload(s, SAVED); expect(await dirty(s).count()).toBe(0);
      expect((await state(s)).toasts).toEqual([]); expect((await state(s)).themes).toEqual([]);
      // Reset exists only after a change in the original component. Make one
      // real local edit to expose it; never invent an always-visible reset CTA.
      await choose(s, quality(s), 'standard'); expect(await dirty(s).count()).toBe(1); await payload(s, SAVED);
      await stickyReach(s); await click(s, dirty(s).getByRole('button', { name: '重置', exact: true }));
      await valuesAre(s, DEFAULTS); expect(await dirty(s).count()).toBe(1);
      await payload(s, SAVED); expect((await state(s)).toasts).toEqual([]);
      await saveLocal(s, {
        notifications: { taskComplete: true, creditsLow: true, systemUpdate: false },
        autoSave: true, imageQuality: 'high', defaultModel: '',
      }, ['设置已保存']);
      const before = await state(s); expect(before.mounts).toBe(1); expect(before.unmounts).toBe(0);
      await s.page.evaluate((): void => (window as unknown as FixtureWindow).ahSettings.remount());
      await main(s).getByRole('heading', { name: '个人资料', exact: true }).waitFor(); await frames(s.page);
      const after = await state(s); expect(after.mounts).toBe(2); expect(after.unmounts).toBe(1); expect(after.mounted).toBe(true);
      await valuesAre(s, DEFAULTS); await payload(s, DEFAULTS);
      expect(await dirty(s).count()).toBe(0); expect(after.toasts).toEqual(['设置已保存']); expect(after.themes).toEqual([]);
      await preferenceGeometry(s); await pageFits(s); await quiet(s);
    });
  }, 25000);

  it('password native labels focus scroll invalid-only validation and real button/backdrop close', async (): Promise<void> => {
    await withSession(theme, width, height, null, async (s): Promise<void> => {
      let card = await passwordOpen(s);
      const first = await labelledPassword(s, card, '新密码'), second = await labelledPassword(s, card, '确认密码');
      const submit = card.getByRole('button', { name: '确认修改', exact: true });
      await focusViaLabel(s, card, '新密码', first); await fillFocused(s, first, '');
      await focusViaLabel(s, card, '确认密码', second); await fillFocused(s, second, '');
      await invalidSubmit(s, card, 'empty', ['密码至少6位']);
      await focusViaLabel(s, card, '新密码', first); await fillFocused(s, first, 'Ah1');
      await focusViaLabel(s, card, '确认密码', second); await fillFocused(s, second, 'Ah2');
      await invalidSubmit(s, card, 'short', ['密码至少6位', '密码至少6位']);
      await focusViaLabel(s, card, '新密码', first); await fillFocused(s, first, 'AhInvalidOne123!');
      await focusViaLabel(s, card, '确认密码', second); await fillFocused(s, second, 'AhDifferentTwo456!');
      await s.page.keyboard.press('Tab');
      expect(await submit.evaluate((element): boolean => document.activeElement === element), 'native Tab reaches submit without activation').toBe(true);
      await nativeScrollEvidenceIfNeeded(s, card, submit);
      await invalidSubmit(s, card, 'mismatch', ['密码至少6位', '密码至少6位', '两次输入的密码不一致']);
      for (const control of await card.locator('button,input,select,textarea').all()) await reach(s, control);
      await noOverlap(first, second); await noOverlap(second, submit); await pageFits(s, card);
      await closePasswordButton(s, card); await payload(s, null);
      card = await passwordOpen(s);
      // Closing is not specified to clear drafts. Reopen, then explicitly clear
      // with real Backspace before preparing another mismatched, unsubmitted draft.
      const againFirst = await labelledPassword(s, card, '新密码'), againSecond = await labelledPassword(s, card, '确认密码');
      await focusViaLabel(s, card, '新密码', againFirst); await fillFocused(s, againFirst, '');
      await focusViaLabel(s, card, '确认密码', againSecond); await fillFocused(s, againSecond, '');
      await fillFocused(s, againSecond, 'AhNeverSubmittedTwo456!');
      await focusViaLabel(s, card, '新密码', againFirst); await fillFocused(s, againFirst, 'AhNeverSubmittedOne123!');
      expect(await againFirst.inputValue()).not.toBe(await againSecond.inputValue());
      await closePasswordBackdrop(s, card);
      // Both close paths must permit a real reopen. No focus-trap/autofocus,
      // Escape-close or close-clears-draft contract is invented by this suite.
      card = await passwordOpen(s); await pageFits(s, card); await closePasswordButton(s, card);
      expect((await state(s)).toasts).toEqual(['密码至少6位', '密码至少6位', '两次输入的密码不一致']);
      expect((await state(s)).themes).toEqual([]); expect(await dirty(s).count()).toBe(0);
      await payload(s, null); await valuesAre(s, DEFAULTS); await quiet(s);
    });
  }, 25000);
});

async function switchContrast(control: Locator): Promise<{edge:number;knob:number;surface:number[];track:number[];thumb:number[]}> {
  return await control.evaluate((element) => {
    const track = element.querySelector(':scope > span'), thumb = track?.querySelector(':scope > span');
    if (!track || !thumb) throw Error('AH_REAL_TRACK_AND_THUMB_REQUIRED');
    const canvas = document.createElement('canvas'); canvas.width=1; canvas.height=1;
    const context = canvas.getContext('2d'); if (!context) throw Error('AH_COLOR_CONTEXT_REQUIRED');
    const rgba=(value:string):number[]=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);const px=context.getImageData(0,0,1,1).data;return [px[0],px[1],px[2],px[3]/255];};
    const over=(fg:number[],bg:number[]):number[]=>[0,1,2].map(index=>fg[index]*fg[3]+bg[index]*(1-fg[3]));
    const background=(node:Element|null):number[]=>{const layers:number[][]=[];for(let current=node;current;current=current.parentElement){const color=rgba(getComputedStyle(current).backgroundColor);layers.push(color);if(color[3]===1)break;}let result=[255,255,255];for(const color of layers.reverse())result=over(color,result);return result;};
    const luminance=(rgb:number[]):number=>rgb.map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
    const ratio=(a:number[],b:number[]):number=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
    const surface=background(element),fill=background(track),dot=background(thumb),style=getComputedStyle(track);
    const border=over(rgba(style.borderTopColor),fill);
    return {edge:Math.max(ratio(fill,surface),parseFloat(style.borderTopWidth)>=1?ratio(border,surface):0),knob:ratio(dot,fill),surface,track:fill,thumb:dot};
  });
}

describe.each(MATRIX)('AH switch visual states $theme $width x $height', ({theme,width,height}):void=>{
  it('real on/off track boundary and thumb remain distinguishable without changing preference payload',async():Promise<void>=>{
    await withSession(theme,width,height,null,async(s):Promise<void>=>{
      const control=toggle(s,'自动保存');
      for(const expected of [true,false] as const){
        await reach(s,control);await toggleIs(control,expected);
        await bounded('switch paint completion', () => control.evaluate(async(element):Promise<void> => { await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished)); }));
        const colors=await switchContrast(control);
        console.log('AH_SWITCH_CONTRAST',JSON.stringify({theme,width,height,expected,...colors}));
        expect(colors.edge,'actual track fill or border contrasts with surrounding card').toBeGreaterThanOrEqual(3);
        expect(colors.knob,'actual thumb contrasts with track fill').toBeGreaterThanOrEqual(3);
        if(expected)await click(s,control);
      }
      await payload(s,null);expect((await state(s)).toasts).toEqual([]);await quiet(s);
    });
  },25000);
});

// AI append-only integrated supplement; unrun OWN author draft retained.
// Geometry is a hand-stated visual contract, independent of translate classes:
// every painted box fits its clips; OFF/ON occupy opposite track halves; the
// thumb travels by more than 1px and returns within 1px relative to the track.
interface AiSwitchClip {
  tag: string;
  rect: Rect;
  client: Rect;
  overflowX: string;
  overflowY: string;
  opacity: number;
  display: string;
  visibility: string;
}
interface AiSwitchPaint {
  rect: Rect;
  opacity: number;
  effectiveOpacity: number;
  display: string;
  visibility: string;
  background: string;
  clips: AiSwitchClip[];
}
interface AiSwitchSample {
  checked: boolean;
  viewport: Rect;
  track: AiSwitchPaint;
  thumb: AiSwitchPaint;
}
type AiCalibrationKind = 'visible' | 'transparent-thumb' | 'ancestor-clip' | 'fixed-thumb';

async function aiSwitchSample(s: Session, control: Locator): Promise<AiSwitchSample> {
  await frames(s.page);
  await bounded('AI switch actual animation completion', (): Promise<void> => control.evaluate(async (element: Element): Promise<void> => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation: Animation): Promise<Animation> => animation.finished));
  }));
  await frames(s.page);
  return await control.evaluate((element: Element): AiSwitchSample => {
    const track = element.querySelector(':scope > span');
    const thumb = track?.querySelector(':scope > span');
    if (!track || !thumb) throw Error('AI_SWITCH_REAL_TRACK_AND_THUMB_REQUIRED');
    if (element.getAttribute('role') !== 'switch') throw Error('AI_SWITCH_ROLE_REQUIRED');
    const checked = element.getAttribute('aria-checked');
    if (checked !== 'true' && checked !== 'false') throw Error('AI_SWITCH_BOOLEAN_ARIA_REQUIRED');
    const rectOf = (rect: DOMRect): Rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    const paintOf = (node: Element): AiSwitchPaint => {
      const style = getComputedStyle(node);
      const clips: AiSwitchClip[] = [];
      let effectiveOpacity = Number(style.opacity);
      // No ancestor-count cap: nested scrollports and hidden/clip ancestors all
      // contribute their actual client box, including the track for the thumb.
      for (let ancestor: Element | null = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
        effectiveOpacity *= Number(css.opacity);
        clips.push({
          tag: ancestor.tagName,
          rect: rectOf(rect),
          client: { x: rect.left + ancestor.clientLeft, y: rect.top + ancestor.clientTop,
            width: ancestor.clientWidth, height: ancestor.clientHeight },
          overflowX: css.overflowX, overflowY: css.overflowY,
          opacity: Number(css.opacity), display: css.display, visibility: css.visibility,
        });
      }
      return { rect: rectOf(node.getBoundingClientRect()), opacity: Number(style.opacity), effectiveOpacity,
        display: style.display, visibility: style.visibility, background: style.backgroundColor, clips };
    };
    return { checked: checked === 'true', viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      track: paintOf(track), thumb: paintOf(thumb) };
  });
}

function aiAssertSwitchPaint(sample: AiSwitchSample): void {
  for (const name of ['track', 'thumb'] as const) {
    const paint = sample[name], rect = paint.rect;
    const detail = 'AI_SWITCH_PAINT ' + name + ' ';
    expect([rect.x, rect.y, rect.width, rect.height].every((value: number): boolean => Number.isFinite(value)), detail + 'finite border box').toBe(true);
    expect(rect.width, detail + 'positive width').toBeGreaterThan(0);
    expect(rect.height, detail + 'positive height').toBeGreaterThan(0);
    expect(paint.opacity, detail + 'opacity').toBeGreaterThan(0);
    expect(paint.effectiveOpacity, detail + 'ancestor opacity').toBeGreaterThan(0);
    expect(paint.display, detail + 'display').not.toBe('none');
    expect(paint.visibility, detail + 'visibility').toBe('visible');
    let left = sample.viewport.x, top = sample.viewport.y;
    let right = left + sample.viewport.width, bottom = top + sample.viewport.height;
    for (const ancestor of paint.clips) {
      expect(ancestor.opacity, detail + 'ancestor opacity ' + ancestor.tag).toBeGreaterThan(0);
      expect(ancestor.display, detail + 'ancestor display ' + ancestor.tag).not.toBe('none');
      expect(ancestor.visibility, detail + 'ancestor visibility ' + ancestor.tag).toBe('visible');
      if (/^(auto|scroll|hidden|clip)$/.test(ancestor.overflowX)) {
        left = Math.max(left, ancestor.client.x);
        right = Math.min(right, ancestor.client.x + ancestor.client.width);
      }
      if (/^(auto|scroll|hidden|clip)$/.test(ancestor.overflowY)) {
        top = Math.max(top, ancestor.client.y);
        bottom = Math.min(bottom, ancestor.client.y + ancestor.client.height);
      }
    }
    expect(rect.x >= left - 0.5 && rect.x + rect.width <= right + 0.5
      && rect.y >= top - 0.5 && rect.y + rect.height <= bottom + 0.5,
    detail + 'clips: full border box inside viewport and every overflow client box; ' + JSON.stringify(paint)).toBe(true);
  }
  const track = sample.track.rect, thumb = sample.thumb.rect;
  expect(thumb.x >= track.x - 0.5 && thumb.x + thumb.width <= track.x + track.width + 0.5
    && thumb.y >= track.y - 0.5 && thumb.y + thumb.height <= track.y + track.height + 0.5,
  'AI_SWITCH_PAINT thumb full border box inside track').toBe(true);
}

function aiAssertSwitchTravel(initial: AiSwitchSample, changed: AiSwitchSample, returned: AiSwitchSample): void {
  for (const sample of [initial, changed, returned]) aiAssertSwitchPaint(sample);
  expect(changed.checked, 'AI_SWITCH_MOVEMENT native first activation changes aria').toBe(!initial.checked);
  expect(returned.checked, 'AI_SWITCH_MOVEMENT native second activation restores aria').toBe(initial.checked);
  // ARIA selects which measured state is ON; its value is never evidence of
  // travel. These checks use actual coordinates rather than transform strings.
  for (const sample of [initial, changed, returned]) {
    const center = sample.thumb.rect.x - sample.track.rect.x + sample.thumb.rect.width / 2;
    if (sample.checked) expect(center, 'AI_SWITCH_MOVEMENT ON center in right track half').toBeGreaterThan(sample.track.rect.width / 2 + 0.5);
    else expect(center, 'AI_SWITCH_MOVEMENT OFF center in left track half').toBeLessThan(sample.track.rect.width / 2 - 0.5);
  }
  const on = initial.checked ? initial : changed, off = initial.checked ? changed : initial;
  expect((on.thumb.rect.x - on.track.rect.x) - (off.thumb.rect.x - off.track.rect.x),
    'AI_SWITCH_MOVEMENT distinguishable rightward travel relative to track').toBeGreaterThan(1);
  expect(Math.abs((returned.thumb.rect.x - returned.track.rect.x) - (initial.thumb.rect.x - initial.track.rect.x)),
    'AI_SWITCH_MOVEMENT returns to original relative x').toBeLessThanOrEqual(1);
  expect(Math.abs((returned.thumb.rect.y - returned.track.rect.y) - (initial.thumb.rect.y - initial.track.rect.y)),
    'AI_SWITCH_MOVEMENT returns to original relative y').toBeLessThanOrEqual(1);
  for (const sample of [changed, returned]) {
    for (const name of ['track', 'thumb'] as const) {
      expect(Math.abs(sample[name].rect.width - initial[name].rect.width), 'AI_SWITCH_MOVEMENT stable ' + name + ' width').toBeLessThanOrEqual(0.5);
      expect(Math.abs(sample[name].rect.height - initial[name].rect.height), 'AI_SWITCH_MOVEMENT stable ' + name + ' height').toBeLessThanOrEqual(0.5);
    }
  }
}

async function aiWithCalibrationSandbox(s: Session, kind: AiCalibrationKind, run: (control: Locator) => Promise<void>): Promise<void> {
  const id = 'ai-user-settings-helper-owned-sandbox';
  let owned = false;
  try {
    await s.page.evaluate(({ id, kind }: { id: string; kind: AiCalibrationKind }): void => {
      if (document.getElementById(id)) throw Error('AI_CALIBRATION_SANDBOX_ALREADY_EXISTS');
      const host = document.createElement('div');
      host.id = id;
      host.setAttribute('data-ai-settings-owner', 'helper-calibration');
      Object.assign(host.style, { position: 'fixed', left: '16px', top: '16px', width: '100px', height: '64px',
        zIndex: '2147483647', backgroundColor: '#ffffff', padding: '0', margin: '0', opacity: '1', visibility: 'visible' });
      const clipper = document.createElement('div');
      Object.assign(clipper.style, { width: kind === 'ancestor-clip' ? '28px' : '44px', height: '44px',
        overflow: kind === 'ancestor-clip' ? 'hidden' : 'visible' });
      const control = document.createElement('button');
      control.type = 'button';
      control.setAttribute('role', 'switch');
      control.setAttribute('aria-label', 'AI helper calibration switch');
      control.setAttribute('aria-checked', 'false');
      Object.assign(control.style, { display: 'inline-flex', width: '44px', height: '44px', padding: '0', margin: '0',
        border: '0', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' });
      const track = document.createElement('span'), thumb = document.createElement('span');
      Object.assign(track.style, { position: 'relative', display: 'block', width: '44px', height: '24px',
        flexShrink: '0', border: '1px solid #000000', boxSizing: 'border-box', borderRadius: '12px', backgroundColor: '#222222' });
      Object.assign(thumb.style, { position: 'absolute', display: 'block', left: '4px', top: '3px', width: '16px', height: '16px',
        border: '0', boxSizing: 'border-box', borderRadius: '8px', backgroundColor: '#ffffff',
        opacity: kind === 'transparent-thumb' ? '0' : '1' });
      control.addEventListener('click', (): void => {
        const checked = control.getAttribute('aria-checked') !== 'true';
        control.setAttribute('aria-checked', String(checked));
        track.style.backgroundColor = checked ? '#0057b8' : '#222222';
        // A deliberately broken calibration keeps the same measured position
        // while both its accessible state and its visible colors change.
        thumb.style.left = checked && kind !== 'fixed-thumb' ? '24px' : '4px';
      });
      track.append(thumb); control.append(track); clipper.append(control); host.append(clipper);
      if (document.getElementById('ah-root')?.contains(host)) throw Error('AI_CALIBRATION_OUTSIDE_PRODUCT_REQUIRED');
      document.body.append(host);
    }, { id, kind });
    owned = true;
    await frames(s.page);
    await run(s.page.locator('#' + id).getByRole('switch', { name: 'AI helper calibration switch', exact: true }));
  } finally {
    if (owned) await s.page.evaluate((id: string): void => {
      const host = document.getElementById(id);
      if (host) {
        if (host.getAttribute('data-ai-settings-owner') !== 'helper-calibration'
          || host.parentElement !== document.body || document.getElementById('ah-root')?.contains(host)) {
          throw Error('AI_CALIBRATION_OWNERSHIP_REQUIRED_FOR_REMOVAL');
        }
        host.remove();
      }
    }, id);
    await frames(s.page);
    if (owned) expect(await s.page.locator('#' + id).count(), 'only owned helper sandbox removed in finally').toBe(0);
  }
}

describe.each(MATRIX)('AI user settings follow-up $theme $width x $height', ({ theme, width, height }: { theme: Theme; width: number; height: number }): void => {
  it('preserves nonempty saved defaultModel through quality saves and real remount; catches restore omission or empty-model save fallback', async (): Promise<void> => {
    await withSession(theme, width, height, SAVED, async (s: Session): Promise<void> => {
      await valuesAre(s, SAVED);
      expect(await dirty(s).count()).toBe(0);
      expect((await state(s)).toasts).toEqual([]);
      await choose(s, quality(s), 'standard');
      expect(await dirty(s).count()).toBe(1);
      await payload(s, SAVED);
      const firstExpected: Preferences = {
        notifications: { taskComplete: false, creditsLow: false, systemUpdate: true },
        autoSave: false, imageQuality: 'standard', defaultModel: 'ah-synthetic-saved-model-no-provider',
      };
      await saveLocal(s, firstExpected, ['设置已保存']);
      const before = await state(s);
      expect(before.mounts).toBe(1); expect(before.unmounts).toBe(0);
      await s.page.evaluate((): void => (window as unknown as FixtureWindow).ahSettings.remount());
      await main(s).getByRole('heading', { name: '个人资料', exact: true }).waitFor();
      await frames(s.page);
      const after = await state(s);
      expect(after.mounts).toBe(2); expect(after.unmounts).toBe(1); expect(after.mounted).toBe(true);
      expect(after.disposed).toBe(false);
      expect(after.toasts).toEqual(['设置已保存']); expect(after.themes).toEqual([]);
      await valuesAre(s, firstExpected);
      await payload(s, firstExpected);
      expect(await dirty(s).count()).toBe(0);
      // A second real UI edit/save makes restoration of the non-UI model field
      // observable in the product-written payload, without reading React state.
      await choose(s, quality(s), 'high');
      expect(await dirty(s).count()).toBe(1);
      await payload(s, firstExpected);
      const secondExpected: Preferences = {
        notifications: { taskComplete: false, creditsLow: false, systemUpdate: true },
        autoSave: false, imageQuality: 'high', defaultModel: 'ah-synthetic-saved-model-no-provider',
      };
      await saveLocal(s, secondExpected, ['设置已保存', '设置已保存']);
      expect((await state(s)).themes).toEqual([]);
      await pageFits(s); await quiet(s);
    });
  }, 25000);

  it('all four real switches paint unclipped and travel to opposite halves then return under native double activation', async (): Promise<void> => {
    await withSession(theme, width, height, null, async (s: Session): Promise<void> => {
      for (const [label, expected] of [
        ['自动保存', true], ['任务完成通知', true], ['积分不足提醒', true], ['系统更新通知', false],
      ] as const) {
        const control = toggle(s, label);
        expect(await control.count()).toBe(1);
        expect(await s.page.getByRole('switch', { name: label, exact: true }).count()).toBe(1);
        expect(await control.getAttribute('role')).toBe('switch');
        expect(await control.getAttribute('aria-checked'), label + ' initial aria state').toBe(String(expected));
        await reach(s, control);
        const text = section(s, label === '自动保存' ? '生成偏好' : '通知设置').getByText(label, { exact: true });
        await readable(s, text); await noOverlap(text, control); await reach(s, control);
        const initial = await aiSwitchSample(s, control);
        expect(initial.checked).toBe(expected); aiAssertSwitchPaint(initial);
        await click(s, control); await reach(s, control);
        const changed = await aiSwitchSample(s, control);
        expect(changed.checked).toBe(!expected); aiAssertSwitchPaint(changed);
        await click(s, control); await reach(s, control);
        const returned = await aiSwitchSample(s, control);
        expect(returned.checked).toBe(expected);
        aiAssertSwitchTravel(initial, changed, returned);
        console.log('AI_USER_SETTINGS_SWITCH_GEOMETRY', JSON.stringify({ theme, width, height, label, initial, changed, returned }));
        await payload(s, null); expect((await state(s)).toasts).toEqual([]); await quiet(s);
      }
      await valuesAre(s, DEFAULTS);
      expect((await state(s)).themes).toEqual([]);
      await pageFits(s); await quiet(s);
    });
  }, 25000);
});

describe('AI user settings helper calibration', (): void => {
  it('helper calibration accepts visible sandbox track/thumb with real two-state travel and return', async (): Promise<void> => {
    await withSession('gold', 320, 640, null, async (s: Session): Promise<void> => {
      await aiWithCalibrationSandbox(s, 'visible', async (control: Locator): Promise<void> => {
        await reach(s, control);
        const initial = await aiSwitchSample(s, control);
        await click(s, control);
        const changed = await aiSwitchSample(s, control);
        await click(s, control);
        const returned = await aiSwitchSample(s, control);
        expect(initial.checked).toBe(false);
        aiAssertSwitchTravel(initial, changed, returned);
        console.log('AI_USER_SETTINGS_HELPER_CALIBRATION', 'visible travel accepted; helper-only evidence');
      });
      await payload(s, null); await quiet(s);
    });
  }, 25000);

  it('helper calibration rejects opacity-zero thumb even when computed colors have sufficient contrast', async (): Promise<void> => {
    await withSession('gold', 320, 640, null, async (s: Session): Promise<void> => {
      await aiWithCalibrationSandbox(s, 'transparent-thumb', async (control: Locator): Promise<void> => {
        const colors = await switchContrast(control);
        expect(colors.edge).toBeGreaterThanOrEqual(3); expect(colors.knob).toBeGreaterThanOrEqual(3);
        const sample = await aiSwitchSample(s, control);
        expect(sample.thumb.background).toBe('rgb(255, 255, 255)');
        expect((): void => aiAssertSwitchPaint(sample)).toThrow('AI_SWITCH_PAINT thumb opacity');
        console.log('AI_USER_SETTINGS_HELPER_CALIBRATION', 'opacity-zero thumb rejected; helper-only evidence, not product RED');
      });
      await payload(s, null); await quiet(s);
    });
  }, 25000);

  it('helper calibration rejects actual ancestor clipping despite nonempty visible track and thumb boxes', async (): Promise<void> => {
    await withSession('gold', 320, 640, null, async (s: Session): Promise<void> => {
      await aiWithCalibrationSandbox(s, 'ancestor-clip', async (control: Locator): Promise<void> => {
        const sample = await aiSwitchSample(s, control);
        expect(sample.track.rect.width).toBeGreaterThan(0); expect(sample.thumb.rect.width).toBeGreaterThan(0);
        expect((): void => aiAssertSwitchPaint(sample)).toThrow('AI_SWITCH_PAINT track clips');
        console.log('AI_USER_SETTINGS_HELPER_CALIBRATION', 'ancestor client clipping rejected; helper-only evidence, not product RED');
      });
      await payload(s, null); await quiet(s);
    });
  }, 25000);

  it('helper calibration rejects stationary thumb even when native on/off state and track colors change', async (): Promise<void> => {
    await withSession('gold', 320, 640, null, async (s: Session): Promise<void> => {
      await aiWithCalibrationSandbox(s, 'fixed-thumb', async (control: Locator): Promise<void> => {
        await reach(s, control);
        const initial = await aiSwitchSample(s, control);
        await click(s, control);
        const changed = await aiSwitchSample(s, control);
        await click(s, control);
        const returned = await aiSwitchSample(s, control);
        for (const sample of [initial, changed, returned]) aiAssertSwitchPaint(sample);
        expect(initial.checked).toBe(false); expect(changed.checked).toBe(true); expect(returned.checked).toBe(false);
        expect(changed.track.background).not.toBe(initial.track.background);
        expect(returned.track.background).toBe(initial.track.background);
        expect((): void => aiAssertSwitchTravel(initial, changed, returned)).toThrow('AI_SWITCH_MOVEMENT');
        console.log('AI_USER_SETTINGS_HELPER_CALIBRATION', 'stationary thumb rejected; helper-only evidence, not product RED');
      });
      await payload(s, null); await quiet(s);
    });
  }, 25000);
});


describe.each(MATRIX)('AK input focus $theme $width x $height', ({ theme, width, height }: { theme: Theme; width: number; height: number }): void => {
  it('a newly dirty save bar never obscures the active quality field or the next keyboard target', async (): Promise<void> => {
    await withSession(theme, width, height, null, async (s: Session): Promise<void> => {
      const field = quality(s);
      await choose(s, field, 'ultra');
      expect(await dirty(s).count()).toBe(1);
      expect(await field.evaluate((element): boolean => document.activeElement === element)).toBe(true);
      // Do not reveal/reach/scroll after the edit: that would hide this regression.
      console.log('AK_DIRTY_FOCUS', JSON.stringify({ theme, width, height, observation: await observation(field) }));
      await target(field);
      await capture(s, 'ak-dirty-active-quality');
      await payload(s, null);
      await s.page.keyboard.press('Tab'); await frames(s.page);
      const next = toggle(s, '自动保存');
      expect(await next.evaluate((element): boolean => document.activeElement === element), 'native Tab reaches the next shipped control').toBe(true);
      await target(next);
      await s.page.keyboard.press('Shift+Tab'); await frames(s.page);
      expect(await field.evaluate((element): boolean => document.activeElement === element), 'reverse Tab returns to original field').toBe(true);
      await target(field);
      await s.page.setViewportSize({ width: height, height: width }); await frames(s.page);
      expect(await field.evaluate((element): boolean => document.activeElement === element), 'rotation preserves the current editor focus').toBe(true);
      await target(field);
      await s.page.setViewportSize({ width, height }); await frames(s.page);
      await target(field);
      expect((await state(s)).toasts).toEqual([]);
      expect((await state(s)).themes).toEqual([]);
      await quiet(s);
    });
  }, 25000);
});
