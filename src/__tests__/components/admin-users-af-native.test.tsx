// @vitest-environment node
// AF integrated isolated native component checks; original OWN proposal retained.
// Four product scenarios at two viewports plus four helper calibrations.
// .invalid synthetic data only: no account mutation, Coze, physical touch or IME proof.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { AdminUser, AdminGroup } from '../../components/dashboard/admin-tabs';

const ORIGIN = 'https://admin-users-af-native.invalid';
const VIEWPORTS = [{ width: 320, height: 640 }, { width: 640, height: 320 }] as const;
const USERS: AdminUser[] = [
  { id: 'af-synthetic-long', name: 'AF合成长用户名_仅供移动布局验证_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789',
    email: 'af.synthetic.long.email.layout.only.abcdefghijklmnopqrstuvwxyz.0123456789@example.invalid',
    role: 'admin', status: 'disabled', groupId: 'af-synthetic-group', credits: 17, project_count: 3,
    created_at: '2026-10-01T00:00:00.000Z', last_login: '2026-10-02T00:00:00.000Z',
    productType: 'canvas,chat', chatModels: ['af-chat'], imageModels: ['af-image'],
    dailyTokenLimit: 11, monthlyTokenLimit: 22, dailyImageLimit: 33 },
  { id: 'af-synthetic-normal', name: 'AF合成普通用户', email: 'af.normal@example.invalid',
    role: 'user', status: 'active', credits: 29, project_count: 2,
    created_at: '2026-10-03T00:00:00.000Z', productType: 'chat' },
];
const GROUPS: AdminGroup[] = [
  { id: 'af-synthetic-group', name: 'AF合成长分组_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_布局专用',
    product_types: ['canvas', 'chat'], credit_quota: 0, is_active: true,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' },
];
interface UiState { mutations: string[]; allowed: string[]; mounted: boolean; disposed: boolean }
interface FixtureWindow extends Window { afUsers: { state: UiState; mount(): void; unmount(): void } }
interface Session {
  context: BrowserContext; page: Page; mounted: boolean; closing: boolean;
  faults: string[]; counts: Map<string, number>; blockedHttp: number; blockedWs: number;
  pending: Set<Request>; seen: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  handlers: Set<Promise<void>>; waiters: Set<() => void>; xWheels: number; yWheels: number;
}
interface Rect { x: number; y: number; width: number; height: number }
interface ControlObservation {
  name: string; disabled: boolean; width: number; height: number; font: number;
  clear: boolean; hit: boolean; glyphs: boolean; horizontalText: boolean; icons: boolean;
  trace?: { rect: Rect; viewport: number[]; placeholder: string | null; id: string; tag: string; ancestors: Array<Record<string, unknown>> };
}
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import AdminTabs,{type AdminUser,type AdminGroup} from '@/components/dashboard/admin-tabs';
const users:AdminUser[]=${JSON.stringify(USERS)};
const groups:AdminGroup[]=${JSON.stringify(GROUPS)};
const state={mutations:[] as string[],allowed:[] as string[],mounted:false,disposed:false};
function deny(name:string):never{state.mutations.push(name);throw Error('AF_FORBIDDEN_CALLBACK '+name);}
const props={activeTab:'users',adminUsers:users,adminGroups:groups,providers:[],
 onRefreshAdmin:():void=>{state.allowed.push('refresh');},
 onCreateUser:async():Promise<never>=>deny('create'),
 onRenameUser:async():Promise<never>=>deny('rename'),
 onResetPassword:async():Promise<never>=>deny('reset'),
 onToggleUser:async():Promise<never>=>deny('toggle'),
 onDeleteUser:():never=>deny('delete'),
 onBatchDeleteUsers:async():Promise<never>=>deny('batch-delete'),
 onToggleUserPermission:async():Promise<never>=>deny('permission'),
 onRechargeCredits:async():Promise<never>=>deny('recharge'),
 onUpdateUserGroup:async():Promise<never>=>deny('group'),
 onUpdateUserModels:async():Promise<never>=>deny('models'),
 onOpenApiManager:():never=>deny('api-manager'),
 onTabChange:(tab:string):void=>{if(tab!=='users')deny('tab:'+tab);state.allowed.push('tab:users');},
 adminChatModels:[{id:'af-chat',name:'AF合成聊天模型',providerId:'af-no-provider'}],
 adminImageModels:[{id:'af-image',name:'AF合成图像模型',providerId:'af-no-provider'}],
} satisfies React.ComponentProps<typeof AdminTabs>;
const host=document.getElementById('af-root');if(!host)throw Error('AF_HOST_REQUIRED');
const root=createRoot(host);
Object.assign(window,{afUsers:{state,mount():void{
 if(state.mounted||state.disposed)throw Error('AF_NO_REMOUNT');state.mounted=true;
 document.documentElement.classList.add('theme-gold');
 // These two class lists are copied from the shipped DashboardView shell/main.
 // No fixture CSS, inline sizing, fake controls or full dashboard/account mount.
 root.render(<div className="dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden">
  <main className="dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0">
   <AdminTabs {...props}/>
  </main></div>);
},unmount():void{if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '', bundleInputVersion = '';
const inputDigests = new Map<string, string>();
const inputContents = new Map<string, Buffer>();
const live = new Set<Session>(), contexts = new Set<BrowserContext>();
function digest(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
async function originalBytes(filename: string): Promise<Buffer> {
  const absolute = path.resolve(filename), bytes = await readFile(absolute), hash = digest(bytes);
  const previous = inputDigests.get(absolute);
  if (previous !== undefined && previous !== hash) throw Error('AF_INPUT_CHANGED ' + absolute);
  inputDigests.set(absolute, hash); inputContents.set(absolute, bytes); return bytes;
}
async function assertInputVersion(): Promise<void> {
  for (const [filename, hash] of inputDigests) {
    if (digest(await readFile(filename)) !== hash) throw Error('AF_INPUT_CHANGED ' + filename);
  }
  expect(bundleInputVersion, 'input version belongs to this in-memory bundle/CSS').toBe(
    digest(JSON.stringify([...inputDigests].sort(([a], [b]) => a.localeCompare(b))) + '\n' + ENTRY + '\n' + bundle + '\n' + css));
}
beforeAll(async (): Promise<void> => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('AF_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await originalBytes('tsconfig.json');
  const built = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'af-admin-users-entry.tsx' },
    plugins: [{ name: 'af-original-byte-provenance', setup(buildApi): void {
      // Read the very bytes esbuild compiles; no module replacement or mocks.
      buildApi.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path).slice(1);
        const loader: import('esbuild').Loader = extension === 'tsx' ? 'tsx' : extension === 'ts' ? 'ts'
          : extension === 'jsx' ? 'jsx' : extension === 'json' ? 'json' : 'js';
        return { contents: await originalBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AF_SINGLE_MEMORY_BUNDLE_REQUIRED');
  bundle = built.outputFiles[0].text;
  const inputs = Object.keys(built.metafile.inputs).filter(file => file !== 'af-admin-users-entry.tsx');
  if (!inputs.some(file => path.resolve(file) === path.resolve('src/components/dashboard/admin-tabs.tsx'))) throw Error('AF_REAL_ADMIN_TABS_INPUT_REQUIRED');
  for (const filename of inputs) if (!inputDigests.has(path.resolve(filename))) throw Error('AF_UNVERSIONED_BUNDLE_INPUT ' + filename);
  const sources = inputs.filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file)).map(file => {
    const bytes = inputContents.get(path.resolve(file)); if (!bytes) throw Error('AF_INPUT_BYTES_REQUIRED');
    return { content: bytes.toString('utf8'), extension: path.extname(file).slice(1) };
  });
  // Include the unchanged shell source for provenance; compile only shipped CSS.
  await originalBytes('src/components/dashboard/dashboard-view.tsx');
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
  browser = await chromium.launch({ headless: true });
}, 30000);

async function bounded<T>(name: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([run(), new Promise<never>((_, reject): void => {
    timer = setTimeout((): void => reject(Error('AF_CLEANUP_TIMEOUT ' + name)), 2500);
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
  if (s.handlers.size || s.pending.size) throw Error('AF_INFLIGHT_REMAINS');
}
async function open(width: number, height: number): Promise<Session> {
  await assertInputVersion(); if (!browser) throw Error('AF_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  contexts.add(context); let session: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, mounted: false, closing: false, faults: [], counts: new Map(), blockedHttp: 0, blockedWs: 0,
      pending: new Set(), seen: new Set(), completed: new Set(), failed: new Set(), handlers: new Set(), waiters: new Set(), xWheels: 0, yWheels: 0 };
    session = s; live.add(s);
    context.on('request', (request): void => { s.seen.add(request); s.pending.add(request); });
    context.on('requestfinished', (request): void => { s.pending.delete(request); s.completed.add(request); for (const notify of s.waiters) notify(); });
    context.on('requestfailed', (request): void => { s.pending.delete(request); s.failed.add(request); for (const notify of s.waiters) notify(); });
    context.on('page', (other): void => { if (other !== page) s.faults.push('AF_UNEXPECTED_PAGE'); });
    page.on('pageerror', (error): void => { s.faults.push('AF_PAGEERROR ' + error.message); });
    page.on('console', (message): void => { if (message.type() === 'error') s.faults.push('AF_CONSOLE_ERROR ' + message.text()); });
    page.on('download', (): void => { s.faults.push('AF_UNEXPECTED_DOWNLOAD'); });
    page.on('dialog', (dialog): void => {
      s.faults.push('AF_UNEXPECTED_DIALOG');
      void tracked(s, async (): Promise<void> => { try { await dialog.dismiss(); } catch (error) { s.faults.push(String(error)); } });
    });
    await context.routeWebSocket('**/*', async (socket): Promise<void> => {
      await tracked(s, async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AF_UNKNOWN_WS ' + socket.url());
        try { await socket.close({ code: 1008, reason: 'AF isolated fixture' }); } catch (error) { s.faults.push(String(error)); }
      });
    });
    await context.route('**/*', async (route): Promise<void> => {
      await tracked(s, async (): Promise<void> => {
        const request = route.request(), key = request.method() + ' ' + request.url();
        const count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        try {
          const url = new URL(request.url()), headers = request.headers();
          if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || request.method() !== 'GET'
            || request.postData() !== null || count !== 1 || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('AF_UNKNOWN_HTTP ' + key);
          if (url.pathname === '/' && request.resourceType() === 'document' && request.isNavigationRequest()) {
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/af.css"><script src="/af.js" defer></script></head><body><div id="af-root"></div></body></html>' }); return;
          }
          if (url.pathname === '/af.js' && request.resourceType() === 'script') { await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle }); return; }
          if (url.pathname === '/af.css' && request.resourceType() === 'stylesheet') { await route.fulfill({ contentType: 'text/css; charset=utf-8', body: css }); return; }
          throw Error('AF_UNKNOWN_HTTP ' + key);
        } catch (error) {
          s.blockedHttp++; s.faults.push(String(error));
          try { await route.abort('blockedbyclient'); } catch (abortError) { s.faults.push('AF_ABORT_ERROR ' + String(abortError)); }
        }
      });
    });
    await page.goto(ORIGIN + '/');
    // Mark first so cleanup still tries unmount if mount throws halfway through.
    s.mounted = true; await page.evaluate((): void => (window as unknown as FixtureWindow).afUsers.mount());
    await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor(); await frames(page); await drain(s);
    expect(await page.locator('html').getAttribute('class')).toContain('theme-gold');
    expect(await page.evaluate((): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.locator('html').evaluate((element): string => getComputedStyle(element).getPropertyValue('--primary').trim())).toBe('#d4af37');
    expect(await page.locator('html').evaluate((element): string => getComputedStyle(element).getPropertyValue('--card').trim())).toBe('#1c2333');
    return s;
  } catch (error) {
    try {
      if (session) await dispose(session);
      else { await bounded('bootstrap context', async (): Promise<void> => { await context.close(); }); contexts.delete(context); }
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AF_BOOTSTRAP_AND_CLEANUP'); }
    throw error;
  }
}
async function dispose(s: Session): Promise<void> {
  const errors: unknown[] = []; s.closing = true;
  try {
    if (s.mounted) {
      const state = await bounded('unmount', (): Promise<UiState> => s.page.evaluate((): UiState => {
        const ui = (window as unknown as FixtureWindow).afUsers; ui.unmount();
        return { ...ui.state, mutations: [...ui.state.mutations], allowed: [...ui.state.allowed] };
      }));
      expect(state.disposed, 'React root unmounted').toBe(true);
      expect(state.mutations, 'no mutation callbacks, including swallowed errors').toEqual([]);
      expect(state.allowed.every(value => value === 'refresh' || value === 'tab:users')).toBe(true);
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
      ['GET ' + ORIGIN + '/', 1], ['GET ' + ORIGIN + '/af.css', 1], ['GET ' + ORIGIN + '/af.js', 1],
    ].sort(([a], [b]) => String(a).localeCompare(String(b))));
    expect(s.blockedHttp, 'every unexpected HTTP request is blocked and counted').toBe(0);
    expect(s.blockedWs, 'every WebSocket attempt is closed and counted').toBe(0);
    expect(s.seen.size).toBe(3); expect(s.completed.size).toBe(3); expect(s.failed.size).toBe(0);
    expect([...s.seen].every(request => s.completed.has(request))).toBe(true);
    expect(s.pending.size).toBe(0); expect(s.handlers.size).toBe(0); expect(s.waiters.size).toBe(0);
    expect(s.faults).toEqual([]);
  } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'AF_DISPOSAL');
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
  if (errors.length) throw new AggregateError(errors, 'AF_FINAL_CLEANUP');
}, 15000);
async function withSession(width: number, height: number, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(width, height); let failure: unknown; let failed = false;
  try { await run(s); } catch (error) { failure = error; failed = true; }
  try { await dispose(s); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], 'AF_ASSERTION_AND_CLEANUP'); throw cleanup; }
  if (failed) throw failure;
}
function list(s: Session): Locator { return s.page.getByRole('region', { name: '用户列表，可横向滚动', exact: true }); }
function row(s: Session, user: AdminUser): Locator {
  // Shipped rows have no role/data-id. Match two independent literal cells,
  // not React internals or row counts alone; assert both strings below as well.
  return list(s).locator('.divide-y > div.grid').filter({ has: s.page.getByText(user.name, { exact: true }) })
    .filter({ has: s.page.getByText(user.email ?? '', { exact: true }) });
}
function panel(s: Session, heading: string): Locator {
  // Actual heading -> header -> drawer/dialog card; no injected ARIA/DOM hooks.
  return s.page.getByRole('heading', { name: heading, exact: true }).locator('..').locator('..');
}
async function box(control: Locator): Promise<Rect> {
  const value = await control.boundingBox(); if (!value) throw Error('AF_NO_RENDERED_RECT'); return value;
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
    const hit = points.every(([x, y], index): boolean => {
      const target = document.elementFromPoint(x, y); if (target && element.contains(target)) return true;
      // Only the reserved trailing point of a reset input may hit its own eye.
      const eye = target?.closest('button');
      return index === 2 && element instanceof HTMLInputElement && ['reset-new-password', 'reset-confirm-password'].includes(element.id)
        && Number.parseFloat(own.paddingRight) >= 44 && eye?.parentElement === element.parentElement
        && eye.type === 'button' && /^(显示|隐藏)(新密码|确认密码)$/.test(eye.getAttribute('aria-label') ?? '');
    });
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
      trace: { rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, viewport: [innerWidth, innerHeight], placeholder: element.getAttribute('placeholder'), id: element.id, tag: element.tagName, ancestors: (() => { const values: Array<Record<string, unknown>> = []; for (let node: Element | null = element; node && values.length < 12; node = node.parentElement) { const r = node.getBoundingClientRect(), style = getComputedStyle(node); values.push({ tag: node.tagName, class: node.getAttribute('class'), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight, node.scrollLeft, node.scrollTop], overflow: [style.overflowX, style.overflowY], display: style.display, minWidth: style.minWidth, opacity: style.opacity }); } return values; })() } };
  });
}
async function target(control: Locator): Promise<void> {
  const value = await observation(control);
  if (!value.clear || !value.glyphs || !value.horizontalText || !value.icons || (!value.disabled && (value.width < 44 || value.height < 44 || !value.hit))) console.log('AF_CONTROL_OBSERVATION', JSON.stringify(value));

  expect(value.clear, value.name + ' whole control fits viewport and clipping ancestors').toBe(true);
  expect(value.glyphs, value.name + ' text glyphs are not clipped').toBe(true);
  expect(value.horizontalText, value.name + ' button glyphs stay horizontal on one line').toBe(true);
  expect(value.icons, value.name + ' action/filter glyphs fit').toBe(true);
  if (value.disabled) {
    expect(await control.isDisabled(), value.name + ' separately classified disabled control').toBe(true);
    return;
  }
  expect(value.width, value.name + ' operative width').toBeGreaterThanOrEqual(44);
  expect(value.height, value.name + ' operative height').toBeGreaterThanOrEqual(44);
  expect(value.hit, value.name + ' native hit samples belong to control').toBe(true);
  if (await control.evaluate((element): boolean => element.matches('input:not([type="checkbox"]),select,textarea'))) {
    expect(value.font, value.name + ' mobile input readability').toBeGreaterThanOrEqual(16);
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
        const sticky = parent.querySelector(':scope > .sticky');
        if (sticky && !sticky.contains(element)) top = Math.max(top, sticky.getBoundingClientRect().bottom);
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
  // No forced scroll/click fallback. The subsequent geometry assertion remains mandatory.
}
async function revealX(s: Session, control: Locator): Promise<void> {
  for (let step = 0; step < 10; step++) {
    await revealY(s, control);
    const r = await box(control), region = await box(list(s)), viewport = s.page.viewportSize();
    if (!viewport) throw Error('AF_VIEWPORT_REQUIRED');
    const left = Math.max(0, region.x + 2), right = Math.min(viewport.width, region.x + region.width - 2);
    const delta = r.x < left ? r.x - left - 8 : r.x + r.width > right ? r.x + r.width - right + 8 : 0;
    if (delta === 0) return;
    const top = Math.max(0, region.y + 2), bottom = Math.min(viewport.height, region.y + region.height - 2);
    if (bottom <= top || right <= left) throw Error('AF_LIST_NATIVE_SCROLLPORT_NOT_VISIBLE');
    await s.page.mouse.move((left + right) / 2, Math.max(top + 1, Math.min(bottom - 1, r.y + r.height / 2)));
    await s.page.mouse.wheel(delta, 0); s.xWheels++; await frames(s.page);
  }
}
async function reach(s: Session, control: Locator): Promise<void> {
  await revealY(s, control);
  if (await control.evaluate((element): boolean => Boolean(element.closest('[role="region"][aria-label="用户列表，可横向滚动"]')))) await revealX(s, control);
  await target(control);
}
async function click(s: Session, control: Locator): Promise<void> {
  await reach(s, control); expect(await control.isDisabled()).toBe(false);
  const r = await box(control); await s.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await frames(s.page);
}
async function focusViaLabel(s: Session, label: Locator, control: Locator): Promise<void> {
  await revealY(s, label);
  const value = await observation(label); expect(value.clear && value.glyphs, 'actual label readable').toBe(true);
  const r = await box(label); await s.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await frames(s.page);
  expect(await control.evaluate((element): boolean => document.activeElement === element), 'native label click focuses associated input').toBe(true);
  await reach(s, control);
}
async function fillFocused(s: Session, control: Locator, value: string): Promise<void> {
  expect(await control.evaluate((element): boolean => document.activeElement === element)).toBe(true);
  await s.page.keyboard.press('ControlOrMeta+A');
  if (value === '') await s.page.keyboard.press('Backspace');
  else await s.page.keyboard.type(value);
  await frames(s.page);
  expect(await control.inputValue()).toBe(value);
}
async function choose(s: Session, select: Locator, value: string): Promise<void> {
  const values = await select.locator('option').evaluateAll((elements): string[] => elements.map(element => (element as HTMLOptionElement).value));
  const index = values.indexOf(value); expect(index).toBeGreaterThanOrEqual(0);
  await click(s, select); await s.page.keyboard.press('Escape');
  expect(await select.evaluate((element): boolean => document.activeElement === element)).toBe(true);
  // Closed native select navigation; no DOM selectOption, Enter or form submit.
  await s.page.keyboard.press('Home'); for (let step = 0; step < index; step++) await s.page.keyboard.press('ArrowDown');
  await frames(s.page); expect(await select.inputValue()).toBe(value);
}
async function pageFits(s: Session, card?: Locator): Promise<void> {
  const violations = await s.page.evaluate((): string[] => {
    const bad: string[] = [];
    for (const selector of ['html', 'body', '.dashboard-root', 'main.dashboard-scrollable']) {
      const element = document.querySelector<HTMLElement>(selector); if (!element || element.scrollWidth > element.clientWidth + 1) bad.push(selector + ':horizontal-scroll');
    }
    for (const element of document.querySelectorAll<HTMLElement>('#af-root *')) {
      if (element.closest('[role="region"][aria-label="用户列表，可横向滚动"]')) continue;
      const r = element.getBoundingClientRect(); if (r.width && r.height && (r.left < -0.5 || r.right > innerWidth + 0.5)) bad.push(element.tagName + ':' + element.className);
    }
    return bad;
  });
  expect(violations, 'horizontal overflow is confined to the explicit user-list region').toEqual([]);
  if (card) expect(await card.evaluate((element): boolean => element.scrollWidth <= element.clientWidth + 1), 'drawer/dialog has no hidden horizontal content').toBe(true);
}
async function noOverlap(first: Locator, second: Locator): Promise<void> {
  const a = await box(first), b = await box(second);
  expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5, 'distinct controls do not overlap').toBe(false);
}
async function rowsAre(s: Session, expected: AdminUser[]): Promise<void> {
  expect(await list(s).locator('.divide-y > div.grid').count()).toBe(expected.length);
  for (const user of USERS) {
    const item = row(s, user), present = expected.some(value => value.id === user.id);
    expect(await item.count(), 'literal fixture identity ' + user.id).toBe(present ? 1 : 0);
    if (present) {
      expect(await item.getByText(user.name, { exact: true }).textContent()).toBe(user.name);
      expect(await item.getByText(user.email ?? '', { exact: true }).textContent()).toBe(user.email);
      expect(await item.getByText(user.role, { exact: true }).textContent()).toBe(user.role);
      expect(await item.getByText(user.status === 'active' ? '活跃' : '禁用', { exact: true }).count()).toBe(1);
    }
  }
}
async function quiet(s: Session): Promise<void> {
  await frames(s.page); await drain(s);
  const state = await s.page.evaluate((): UiState => (window as unknown as FixtureWindow).afUsers.state);
  expect(state.mutations).toEqual([]); expect(s.faults).toEqual([]); expect(s.blockedHttp).toBe(0); expect(s.blockedWs).toBe(0);
  expect([...s.counts.keys()].every(key => ['GET ' + ORIGIN + '/', 'GET ' + ORIGIN + '/af.js', 'GET ' + ORIGIN + '/af.css'].includes(key))).toBe(true);
}
async function returnToList(s: Session): Promise<void> {
  expect(await s.page.getByRole('heading', { name: '用户详情', exact: true }).count()).toBe(0);
  expect(await s.page.getByRole('heading', { name: '新建用户', exact: true }).count()).toBe(0);
  expect(await s.page.getByRole('heading', { name: '重置用户密码', exact: true }).count()).toBe(0);
  expect(await s.page.locator('#af-root .fixed').count(), 'old overlays removed').toBe(0);
  const search = s.page.getByPlaceholder('搜索用户名 / 邮箱', { exact: true });
  await click(s, search); await fillFocused(s, search, USERS[1].email ?? ''); await rowsAre(s, [USERS[1]]);
  await fillFocused(s, search, ''); await rowsAre(s, USERS);
  await click(s, s.page.getByRole('button', { name: '刷新', exact: true }));
  expect(await s.page.evaluate((): string[] => (window as unknown as FixtureWindow).afUsers.state.allowed)).toEqual(['refresh']);
  await pageFits(s); await quiet(s);
}
async function openDetail(s: Session): Promise<Locator> {
  const action = row(s, USERS[0]).getByTitle('详情', { exact: true });
  expect(await list(s).evaluate((element): number => element.scrollLeft)).toBe(0);
  await click(s, action);
  expect(s.xWheels, '详情 reached through native horizontal mouse wheel').toBeGreaterThan(0);
  expect(await list(s).evaluate((element): number => element.scrollLeft)).toBeGreaterThan(0);
  const drawer = panel(s, '用户详情'); await drawer.waitFor();
  expect(await drawer.getByText(USERS[0].name, { exact: true }).textContent()).toBe(USERS[0].name);
  expect(await drawer.getByText(USERS[0].email ?? '', { exact: true }).textContent()).toBe(USERS[0].email);
  expect(await drawer.getByText(String(USERS[0].credits), { exact: true }).count()).toBe(1);
  expect(await drawer.getByRole('combobox').inputValue()).toBe(GROUPS[0].id);
  await pageFits(s, drawer); return drawer;
}
async function invalidConfirm(s: Session, dialog: Locator, mode: 'empty' | 'mismatch'): Promise<void> {
  const first = await dialog.locator('#reset-new-password').inputValue(), second = await dialog.locator('#reset-confirm-password').inputValue();
  if (mode === 'empty') { expect(first).toBe(''); expect(second).toBe(''); }
  else { expect(first).toBe('AfInvalidOne123!'); expect(second).toBe('AfDifferentTwo456!'); expect(first).not.toBe(second); }
  // Reviewed frozen handler returns before fetch for both states. Transport
  // still denies every POST if source drift violates that prerequisite.
  expect(first.length < 6 || first !== second, 'never allow a valid reset submission').toBe(true);
  await click(s, dialog.getByRole('button', { name: '确认重置', exact: true }));
  const message = dialog.getByText(mode === 'empty' ? '密码至少需要6个字符' : '两次输入的密码不一致', { exact: true });
  await revealY(s, message); const value = await observation(message); expect(value.clear && value.glyphs).toBe(true);
  expect(await message.textContent()).toBe(mode === 'empty' ? '密码至少需要6个字符' : '两次输入的密码不一致');
  await quiet(s);
}

describe('AF admin users native8', (): void => {
  it.each(VIEWPORTS)('list filters and glyphs $width x $height', async ({ width, height }): Promise<void> => {
    await withSession(width, height, async (s): Promise<void> => {
      await rowsAre(s, USERS); await pageFits(s);
      const heading = s.page.getByRole('heading', { name: '用户管理', exact: true });
      await revealY(s, heading); const title = await observation(heading); expect(title.clear && title.glyphs).toBe(true);
      const search = s.page.getByPlaceholder('搜索用户名 / 邮箱', { exact: true });
      const filters = s.page.getByRole('combobox'); expect(await filters.count()).toBe(3);
      for (const control of [search, ...await filters.all(), s.page.getByRole('button', { name: '刷新', exact: true }), s.page.getByRole('button', { name: '添加用户', exact: true })]) await reach(s, control);
      for (const name of ['批量启用', '批量禁用', '批量删除']) {
        const button = s.page.getByRole('button', { name, exact: true }); expect(await button.isDisabled()).toBe(true); await reach(s, button);
      }
      // Actual row controls, including glyph-only mutation actions: measure only.
      for (const control of await list(s).locator('button,input').all()) await reach(s, control);
      expect(await list(s).evaluate((element): boolean => {
        const inner = element.firstElementChild; return Boolean(inner && getComputedStyle(element).overflowX === 'auto'
          && Number.parseFloat(getComputedStyle(inner).minWidth) === 1120 && element.scrollWidth > element.clientWidth);
      })).toBe(true);
      const [role, status, group] = await filters.all();
      for (const needle of [USERS[0].name, USERS[0].email ?? '']) {
        await click(s, search); await fillFocused(s, search, needle); await rowsAre(s, [USERS[0]]);
        await fillFocused(s, search, ''); await rowsAre(s, USERS);
      }
      await click(s, search); await fillFocused(s, search, 'af-no-matching-user@example.invalid'); await rowsAre(s, []);
      expect(await list(s).getByText('暂无用户数据', { exact: true }).count()).toBe(1);
      await fillFocused(s, search, ''); await rowsAre(s, USERS);
      for (const [select, value, expected] of [
        [role, 'admin', [USERS[0]]], [role, 'user', [USERS[1]]],
        [status, 'disabled', [USERS[0]]], [status, 'active', [USERS[1]]],
        [group, GROUPS[0].id, [USERS[0]]], [group, '', [USERS[1]]],
      ] as Array<[Locator, string, AdminUser[]]>) {
        await choose(s, select, value); await rowsAre(s, expected);
        await choose(s, select, 'all'); await rowsAre(s, USERS);
      }
      await choose(s, role, 'admin'); await choose(s, status, 'disabled'); await choose(s, group, GROUPS[0].id);
      await rowsAre(s, [USERS[0]]); await choose(s, status, 'active'); await rowsAre(s, []);
      await choose(s, role, 'all'); await choose(s, status, 'all'); await choose(s, group, 'all'); await rowsAre(s, USERS);
      await returnToList(s);
    });
  }, 25000);

  it.each(VIEWPORTS)('detail native wheel reach and close $width x $height', async ({ width, height }): Promise<void> => {
    await withSession(width, height, async (s): Promise<void> => {
      const drawer = await openDetail(s), close = drawer.getByRole('button', { name: '关闭用户详情', exact: true });
      await reach(s, close); await noOverlap(drawer.getByRole('heading', { name: '用户详情', exact: true }), close);
      const identity = drawer.getByText(USERS[0].name, { exact: true }); await revealY(s, identity);
      const identityView = await observation(identity); expect(identityView.clear && identityView.glyphs, 'literal long identity fits drawer').toBe(true);
      // No click/focus/change/blur on group, models, product switches or quotas.
      // Quota blur itself performs POST in the shipped component.
      for (const control of await drawer.locator('button,input,select').all()) await reach(s, control);
      const reset = drawer.getByRole('button', { name: '重置密码', exact: true });
      const enable = drawer.getByRole('button', { name: '启用用户', exact: true });
      const remove = drawer.getByRole('button', { name: '删除用户', exact: true });
      await noOverlap(reset, enable); await noOverlap(enable, remove);
      expect(s.yWheels, 'detail lower controls reached with native vertical scroll').toBeGreaterThan(0);
      await pageFits(s, drawer); await quiet(s); await click(s, close); await returnToList(s);
    });
  }, 25000);

  it.each(VIEWPORTS)('add draft native focus cancel and original reset $width x $height', async ({ width, height }): Promise<void> => {
    await withSession(width, height, async (s): Promise<void> => {
      const add = s.page.getByRole('button', { name: '添加用户', exact: true }); await click(s, add);
      const drawer = panel(s, '新建用户'), close = drawer.getByRole('button', { name: '关闭添加用户面板', exact: true });
      const form = drawer.locator('form'), group = form.getByRole('combobox'), create = form.getByRole('button', { name: '创建用户', exact: true });
      await pageFits(s, drawer); await reach(s, close);
      await noOverlap(drawer.getByRole('heading', { name: '新建用户', exact: true }), close);
      for (const [id, label, value] of [
        ['new-user-name', '用户名', 'AF合成未提交草稿'], ['new-user-password', '密码', 'AfDraftNeverSubmit123!'],
        ['new-user-email', '邮箱 (可选)', 'af.draft.never.submit@example.invalid'],
      ]) {
        const input = form.locator('#' + id), actualLabel = form.locator('label').filter({ hasText: label });
        expect(await input.inputValue()).toBe(''); expect(await actualLabel.count()).toBe(1);
        expect(await actualLabel.getAttribute('for')).toBe(id);
        await focusViaLabel(s, actualLabel, input); await fillFocused(s, input, value);
      }
      const groupLabel = form.locator('label').filter({ hasText: '分组 (可选)' }); await revealY(s, groupLabel);
      const labelView = await observation(groupLabel); expect(labelView.clear && labelView.glyphs).toBe(true);
      expect(await group.inputValue()).toBe(''); await choose(s, group, GROUPS[0].id);
      await reach(s, create); await noOverlap(group, create);
      await s.page.keyboard.press('Tab');
      expect(await create.evaluate((element): boolean => document.activeElement === element), 'bottom CTA reachable by native Tab without activation').toBe(true);
      await quiet(s); await click(s, close); expect(await drawer.count()).toBe(0); await click(s, add);
      for (const id of ['new-user-name', 'new-user-password', 'new-user-email']) expect(await panel(s, '新建用户').locator('#' + id).inputValue()).toBe('');
      expect(await panel(s, '新建用户').getByRole('combobox').inputValue()).toBe('');
      await reach(s, panel(s, '新建用户').getByRole('button', { name: '创建用户', exact: true }));
      if (height === 320) expect(s.yWheels, 'short-view bottom CTA reached with native wheel').toBeGreaterThan(0);
      await pageFits(s, panel(s, '新建用户'));
      await click(s, panel(s, '新建用户').getByRole('button', { name: '关闭添加用户面板', exact: true }));
      // No 创建用户 click, Enter, valid submit or creation callback in this case.
      await returnToList(s);
    });
  }, 25000);

  it.each(VIEWPORTS)('reset invalid only independent visibility and cancel $width x $height', async ({ width, height }): Promise<void> => {
    await withSession(width, height, async (s): Promise<void> => {
      const drawer = await openDetail(s); await click(s, drawer.getByRole('button', { name: '重置密码', exact: true }));
      let dialog = panel(s, '重置用户密码'); await pageFits(s, dialog);
      const resetClose = dialog.getByRole('heading', { name: '重置用户密码', exact: true }).locator('..').getByRole('button');
      await reach(s, resetClose); await noOverlap(dialog.getByRole('heading', { name: '重置用户密码', exact: true }), resetClose);
      expect(await dialog.getByText(USERS[0].name, { exact: true }).textContent()).toBe(USERS[0].name);
      for (const [id, label] of [['reset-new-password', '新密码'], ['reset-confirm-password', '确认密码']]) {
        const input = dialog.locator('#' + id), actualLabel = dialog.locator('label').filter({ hasText: label });
        expect(await actualLabel.getAttribute('for')).toBe(id); expect(await input.getAttribute('type')).toBe('password');
        expect(await input.inputValue()).toBe(''); await focusViaLabel(s, actualLabel, input);
      }
      for (const control of await dialog.locator('button,input').all()) await reach(s, control);
      await noOverlap(dialog.getByRole('button', { name: '取消', exact: true }), dialog.getByRole('button', { name: '确认重置', exact: true }));
      await invalidConfirm(s, dialog, 'empty'); await click(s, resetClose);
      expect(await dialog.count()).toBe(0); await quiet(s);
      await click(s, drawer.getByRole('button', { name: '重置密码', exact: true })); dialog = panel(s, '重置用户密码');
      const first = dialog.locator('#reset-new-password'), second = dialog.locator('#reset-confirm-password');
      expect(await first.inputValue()).toBe(''); expect(await second.inputValue()).toBe('');
      await focusViaLabel(s, dialog.locator('label[for="reset-new-password"]'), first); await fillFocused(s, first, 'AfInvalidOne123!');
      await focusViaLabel(s, dialog.locator('label[for="reset-confirm-password"]'), second); await fillFocused(s, second, 'AfDifferentTwo456!');
      await click(s, dialog.getByRole('button', { name: '显示新密码', exact: true }));
      expect(await first.getAttribute('type')).toBe('text'); expect(await second.getAttribute('type')).toBe('password');
      expect(await dialog.getByRole('button', { name: '隐藏新密码', exact: true }).getAttribute('aria-pressed')).toBe('true');
      await click(s, dialog.getByRole('button', { name: '显示确认密码', exact: true }));
      expect(await first.getAttribute('type')).toBe('text'); expect(await second.getAttribute('type')).toBe('text');
      await click(s, dialog.getByRole('button', { name: '隐藏新密码', exact: true }));
      expect(await first.getAttribute('type')).toBe('password'); expect(await second.getAttribute('type')).toBe('text');
      await click(s, dialog.getByRole('button', { name: '隐藏确认密码', exact: true }));
      expect(await first.getAttribute('type')).toBe('password'); expect(await second.getAttribute('type')).toBe('password');
      expect(await dialog.getByRole('button', { name: '显示新密码', exact: true }).getAttribute('aria-pressed')).toBe('false');
      expect(await dialog.getByRole('button', { name: '显示确认密码', exact: true }).getAttribute('aria-pressed')).toBe('false');
      await invalidConfirm(s, dialog, 'mismatch'); await pageFits(s, dialog);
      await click(s, dialog.getByRole('button', { name: '取消', exact: true })); expect(await dialog.count()).toBe(0);
      await click(s, drawer.getByRole('button', { name: '关闭用户详情', exact: true })); await returnToList(s);
    });
  }, 25000);
});


// Helper-only appendix: four independent geometry/policy calibrations.
// These fixed, literal sandboxes exist only in this suite, outside #af-root.
// They are not AdminTabs controls or product/mobile acceptance evidence.
describe('AF geometry calibration', (): void => {
  it('own bordered overflow-clip input is fully visible', async (): Promise<void> => {
    await withSession(640, 320, async (s): Promise<void> => {
      try {
        await s.page.evaluate((): void => {
          const sandbox = document.createElement('div'); sandbox.id = 'af-calibration-own-border';
          sandbox.style.cssText = 'all:initial;position:fixed;left:24px;top:24px;width:400px;height:160px;display:block;visibility:visible;opacity:1;overflow:visible;pointer-events:auto;z-index:2147483647;box-sizing:border-box;background:#ffffff;';
          document.body.appendChild(sandbox);
          const input = document.createElement('input'); input.type = 'text';
          input.setAttribute('aria-label', 'AF calibration visible bordered input'); input.value = 'AF own border calibration';
          input.style.cssText = 'all:initial;position:absolute;left:16px;top:16px;width:256px;height:44px;box-sizing:border-box;border:1px solid #000000;padding:0 8px;display:block;visibility:visible;opacity:1;overflow:clip;pointer-events:auto;font:16px/20px sans-serif;color:#000000;background:#ffffff;';
          sandbox.appendChild(input);
        });
        await frames(s.page);
        const input = s.page.locator('#af-calibration-own-border > input');
        const measured = await input.evaluate((element): {
          borderWidth: number; borderHeight: number; clientWidth: number; clientHeight: number;
          borderLeft: number; borderTop: number; overflow: string[]; insideViewport: boolean;
        } => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { borderWidth: rect.width, borderHeight: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight,
            borderLeft: Number.parseFloat(style.borderLeftWidth), borderTop: Number.parseFloat(style.borderTopWidth),
            overflow: [style.overflowX, style.overflowY],
            insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
        });
        expect(measured.insideViewport, 'literal border box actually fits browser viewport').toBe(true);
        expect(measured.borderLeft).toBe(1); expect(measured.borderTop).toBe(1);
        expect(measured.borderWidth - measured.clientWidth, 'real own border exceeds own client width').toBe(2);
        expect(measured.borderHeight - measured.clientHeight, 'real own border exceeds own client height').toBe(2);
        expect(measured.overflow).toEqual(['clip', 'clip']);
        const value = await observation(input);
        expect(value.clear, 'own border is not clipped by its own client box').toBe(true);
        expect(value.hit, 'native hit samples reach this actual input').toBe(true);
        expect(value.glyphs).toBe(true);
        await target(input);
        await quiet(s);
        expect(await s.page.evaluate((): string[] => (window as unknown as FixtureWindow).afUsers.state.allowed)).toEqual([]);
      } finally {
        await s.page.evaluate((): void => { document.getElementById('af-calibration-own-border')?.remove(); });
        await frames(s.page);
        expect(await s.page.locator('#af-calibration-own-border').count(), 'owned sandbox removed even on assertion failure').toBe(0);
      }
    });
  }, 25000);

  it('same bordered overflow-clip input with own opacity zero is not clear', async (): Promise<void> => {
    await withSession(640, 320, async (s): Promise<void> => {
      try {
        await s.page.evaluate((): void => {
          const sandbox = document.createElement('div'); sandbox.id = 'af-calibration-own-opacity';
          sandbox.style.cssText = 'all:initial;position:fixed;left:24px;top:24px;width:400px;height:160px;display:block;visibility:visible;opacity:1;overflow:visible;pointer-events:auto;z-index:2147483647;box-sizing:border-box;background:#ffffff;';
          document.body.appendChild(sandbox);
          const input = document.createElement('input'); input.type = 'text';
          input.setAttribute('aria-label', 'AF calibration transparent bordered input'); input.value = 'AF own border calibration';
          input.style.cssText = 'all:initial;position:absolute;left:16px;top:16px;width:256px;height:44px;box-sizing:border-box;border:1px solid #000000;padding:0 8px;display:block;visibility:visible;opacity:0;overflow:clip;pointer-events:auto;font:16px/20px sans-serif;color:#000000;background:#ffffff;';
          sandbox.appendChild(input);
        });
        await frames(s.page);
        const input = s.page.locator('#af-calibration-own-opacity > input');
        const measured = await input.evaluate((element): {
          opacity: number; parentOpacity: number; visibility: string; display: string;
          borderWidth: number; borderHeight: number; clientWidth: number; clientHeight: number;
          overflow: string[]; insideViewport: boolean;
        } => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element), parent = element.parentElement;
          if (!parent) throw Error('AF_CALIBRATION_PARENT_REQUIRED');
          return { opacity: Number(style.opacity), parentOpacity: Number(getComputedStyle(parent).opacity), visibility: style.visibility,
            display: style.display, borderWidth: rect.width, borderHeight: rect.height,
            clientWidth: element.clientWidth, clientHeight: element.clientHeight, overflow: [style.overflowX, style.overflowY],
            insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
        });
        expect(measured.insideViewport).toBe(true); expect(measured.opacity).toBe(0); expect(measured.parentOpacity).toBe(1);
        expect(measured.visibility).toBe('visible'); expect(measured.display).toBe('block');
        expect(measured.borderWidth - measured.clientWidth).toBe(2); expect(measured.borderHeight - measured.clientHeight).toBe(2);
        expect(measured.overflow).toEqual(['clip', 'clip']);
        const value = await observation(input);
        expect(value.width).toBeGreaterThanOrEqual(44); expect(value.height).toBeGreaterThanOrEqual(44);
        expect(value.hit, 'opacity zero alone does not prevent native hit testing').toBe(true);
        expect(value.clear, 'own opacity still rejects an otherwise fitting input').toBe(false);
        expect(value.glyphs).toBe(true);
        await quiet(s);
        expect(await s.page.evaluate((): string[] => (window as unknown as FixtureWindow).afUsers.state.allowed)).toEqual([]);
      } finally {
        await s.page.evaluate((): void => { document.getElementById('af-calibration-own-opacity')?.remove(); });
        await frames(s.page);
        expect(await s.page.locator('#af-calibration-own-opacity').count(), 'owned sandbox removed even on assertion failure').toBe(0);
      }
    });
  }, 25000);

  it('bordered input clipped twenty pixels by its ancestor is not clear', async (): Promise<void> => {
    await withSession(640, 320, async (s): Promise<void> => {
      try {
        await s.page.evaluate((): void => {
          const sandbox = document.createElement('div'); sandbox.id = 'af-calibration-ancestor-clip';
          sandbox.style.cssText = 'all:initial;position:fixed;left:24px;top:24px;width:400px;height:160px;display:block;visibility:visible;opacity:1;overflow:visible;pointer-events:auto;z-index:2147483647;box-sizing:border-box;background:#ffffff;';
          document.body.appendChild(sandbox);
          const clipper = document.createElement('div');
          clipper.style.cssText = 'all:initial;position:absolute;left:16px;top:16px;width:236px;height:44px;box-sizing:border-box;border:0;padding:0;display:block;visibility:visible;opacity:1;overflow:hidden;';
          sandbox.appendChild(clipper);
          const input = document.createElement('input'); input.type = 'text';
          input.setAttribute('aria-label', 'AF calibration ancestor-clipped input'); input.value = 'AF own border calibration';
          input.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:256px;height:44px;box-sizing:border-box;border:1px solid #000000;padding:0 8px;display:block;visibility:visible;opacity:1;overflow:clip;pointer-events:auto;font:16px/20px sans-serif;color:#000000;background:#ffffff;';
          clipper.appendChild(input);
        });
        await frames(s.page);
        const input = s.page.locator('#af-calibration-ancestor-clip > div > input');
        const measured = await input.evaluate((element): {
          clippedPixels: number; sameLeft: boolean; fitsVertical: boolean; insideViewport: boolean;
          opacity: number; ancestorOverflow: string; parentWidth: number; width: number;
        } => {
          const parent = element.parentElement; if (!parent) throw Error('AF_CALIBRATION_PARENT_REQUIRED');
          const rect = element.getBoundingClientRect(), clip = parent.getBoundingClientRect();
          return { clippedPixels: rect.right - (clip.left + parent.clientLeft + parent.clientWidth), sameLeft: rect.left === clip.left,
            fitsVertical: rect.top >= clip.top && rect.bottom <= clip.bottom,
            insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            opacity: Number(getComputedStyle(element).opacity), ancestorOverflow: getComputedStyle(parent).overflowX,
            parentWidth: parent.clientWidth, width: rect.width };
        });
        expect(measured.insideViewport).toBe(true); expect(measured.sameLeft).toBe(true); expect(measured.fitsVertical).toBe(true);
        expect(measured.opacity).toBe(1); expect(measured.ancestorOverflow).toBe('hidden');
        expect(measured.clippedPixels, 'actual ancestor clips exactly twenty pixels').toBe(20);
        expect(measured.width - measured.parentWidth).toBe(measured.clippedPixels);
        const value = await observation(input);
        expect(value.width).toBeGreaterThanOrEqual(44); expect(value.height).toBeGreaterThanOrEqual(44);
        expect(value.clear, 'parent-client clipping remains enforced').toBe(false);
        expect(value.hit, 'trailing native hit sample is outside the clipper').toBe(false);
        expect(value.glyphs).toBe(true);
        await quiet(s);
        expect(await s.page.evaluate((): string[] => (window as unknown as FixtureWindow).afUsers.state.allowed)).toEqual([]);
      } finally {
        await s.page.evaluate((): void => { document.getElementById('af-calibration-ancestor-clip')?.remove(); });
        await frames(s.page);
        expect(await s.page.locator('#af-calibration-ancestor-clip').count(), 'owned sandbox removed even on assertion failure').toBe(0);
      }
    });
  }, 25000);

  it('visible button box retains negative glyph result for clipped inner text', async (): Promise<void> => {
    await withSession(640, 320, async (s): Promise<void> => {
      try {
        await s.page.evaluate((): void => {
          const sandbox = document.createElement('div'); sandbox.id = 'af-calibration-inner-glyph';
          sandbox.style.cssText = 'all:initial;position:fixed;left:24px;top:24px;width:400px;height:160px;display:block;visibility:visible;opacity:1;overflow:visible;pointer-events:auto;z-index:2147483647;box-sizing:border-box;background:#ffffff;';
          document.body.appendChild(sandbox);
          const button = document.createElement('button'); button.type = 'button';
          button.setAttribute('aria-label', 'AF calibration visible box clipped text');
          button.style.cssText = 'all:initial;position:absolute;left:16px;top:16px;width:256px;height:44px;box-sizing:border-box;border:1px solid #000000;padding:0;display:block;visibility:visible;opacity:1;overflow:visible;pointer-events:auto;font:14px/20px sans-serif;color:#000000;background:#ffffff;white-space:nowrap;writing-mode:horizontal-tb;';
          sandbox.appendChild(button);
          const span = document.createElement('span');
          span.style.cssText = 'all:initial;position:absolute;left:16px;top:11px;width:12px;height:20px;box-sizing:border-box;display:block;visibility:visible;opacity:1;overflow:hidden;font:14px/20px sans-serif;color:#000000;white-space:nowrap;writing-mode:horizontal-tb;';
          span.textContent = 'AF calibration intentionally clipped long button text';
          button.appendChild(span);
        });
        await frames(s.page);
        const button = s.page.locator('#af-calibration-inner-glyph > button');
        const measured = await button.evaluate((element): {
          insideViewport: boolean; font: number; spanWidth: number; spanClientWidth: number;
          spanScrollWidth: number; textWidth: number; textRight: number; clipRight: number; overflow: string;
        } => {
          const span = element.querySelector('span'); if (!span || !span.firstChild) throw Error('AF_CALIBRATION_TEXT_REQUIRED');
          const rect = element.getBoundingClientRect(), clip = span.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(span);
          const text = range.getBoundingClientRect();
          return { insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            font: Number.parseFloat(getComputedStyle(element).fontSize), spanWidth: clip.width, spanClientWidth: span.clientWidth,
            spanScrollWidth: span.scrollWidth, textWidth: text.width, textRight: text.right,
            clipRight: clip.left + span.clientLeft + span.clientWidth, overflow: getComputedStyle(span).overflowX };
        });
        expect(measured.insideViewport).toBe(true); expect(measured.font).toBe(14);
        expect(measured.spanWidth).toBe(12); expect(measured.spanClientWidth).toBe(12); expect(measured.overflow).toBe('hidden');
        expect(measured.spanScrollWidth).toBeGreaterThan(measured.spanClientWidth);
        expect(measured.textWidth).toBeGreaterThan(measured.spanWidth);
        expect(measured.textRight).toBeGreaterThan(measured.clipRight);
        const value = await observation(button);
        expect(value.width).toBeGreaterThanOrEqual(44); expect(value.height).toBeGreaterThanOrEqual(44);
        expect(value.clear, 'whole button border box remains visible').toBe(true);
        expect(value.hit, 'button hit areas remain unobscured').toBe(true);
        expect(value.horizontalText).toBe(true); expect(value.icons).toBe(true);
        expect(value.glyphs, 'inner overflow still rejects actual long text range').toBe(false);
        await quiet(s);
        expect(await s.page.evaluate((): string[] => (window as unknown as FixtureWindow).afUsers.state.allowed)).toEqual([]);
      } finally {
        await s.page.evaluate((): void => { document.getElementById('af-calibration-inner-glyph')?.remove(); });
        await frames(s.page);
        expect(await s.page.locator('#af-calibration-inner-glyph').count(), 'owned sandbox removed even on assertion failure').toBe(0);
      }
    });
  }, 25000);
});

