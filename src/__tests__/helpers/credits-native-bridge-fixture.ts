// AO isolated native bridge: actual API response bytes; no real auth, PG driver, HTTP server or device acceptance.
import { readFile, mkdir } from 'node:fs/promises';

import { createHash } from 'node:crypto';

import path from 'node:path';

import { compile } from 'tailwindcss';

import { Scanner } from '@tailwindcss/oxide';

import {
  chromium, type Browser, type BrowserContext, type Page, type Locator,
  type Request, type Route, type WebSocketRoute,
} from '@playwright/test';

import { beforeAll, afterAll, expect } from 'vitest';

type Theme = 'gold' | 'mono';

export interface MatrixEntry { theme: Theme; width: number; height: number }

interface Rect { x: number; y: number; width: number; height: number }

interface UiState {
  theme: Theme | null; userId: string; toasts: string[];
  mounts: number; unmounts: number; mounted: boolean; disposed: boolean;
}

interface FixtureWindow extends Window {
  aoCredits: { state: UiState; mount(theme: Theme): void; unmount(): void };
}

interface Deferred {
  promise: Promise<void>; resolve(): void; settled: boolean;
}

export interface Session {
  context: BrowserContext; page: Page; kind: ScenarioKind; step: number; closing: boolean;
  actualGet: ActualGet; receipts: WireReceipt[]; expectedResourceErrors: string[];
  faults: string[]; blockedHttp: number; blockedWs: number;
  counts: Map<string, number>; handlers: Set<Promise<void>>;
  seen: Set<Request>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  waiters: Set<() => void>; initialArrived: Deferred; paymentArrived: Deferred; releaseRefresh: Deferred;
  contextClosed: boolean; pageClosed: boolean; disposePromise?: Promise<void>; wheels: number;
}

export type ScenarioKind = 'zero' | 'recovery';
export interface ApiScope { kind: ScenarioKind; step: number }
export type ActualGet = (url: string, scope: ApiScope) => Promise<Response>;
interface WireReceipt { url: string; step: number; status: number; sha256: string; bytes: number; headers: Record<string,string>; received: boolean; consoleObserved: boolean }



interface Geometry {
  name: string; rect: Rect; clear: boolean; glyphs: boolean; horizontal: boolean;
  cjkHorizontal: boolean; singleLine: boolean; iconsFit: boolean;
  iconsSeparate: boolean; fiveHits: boolean; font: number; disabled: boolean;
  trace: Array<Record<string, unknown>>;
}

interface ButtonLayout {
  name: string | undefined; rect: Rect; font: string; selected: string | null; class: string;
}

const ORIGIN = 'https://user-credits-ao-states-fixture.invalid';

const USER_ID = 'ao-credits-user';

export const MATRIX = [
  { theme: 'gold', width: 320, height: 640 },
  { theme: 'gold', width: 640, height: 320 },
  { theme: 'mono', width: 320, height: 640 },
  { theme: 'mono', width: 640, height: 320 },
] as const satisfies readonly MatrixEntry[];

const SHELL = 'dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden';

const MAIN = 'dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0';





const PAYMENT_STATUS = {
  success: true, canRecharge: false, methods: [],
  qrUrls: { wechat: '', alipay: '' }, payLinks: { wechat: '', alipay: '' },
  note: 'AO合成未配置收款状态，不进行支付操作', status: { wechat: false, alipay: false },
};







const SCENARIOS = {
 zero: { expected: [{ credits: 1, history: 1, total: 6 }], holdInitial: true },
 recovery: { expected: [
 { credits: 1, history: 0, total: 5 }, { credits: 2, history: 1, total: 7 },
 { credits: 3, history: 2, total: 9 }, { credits: 4, history: 2, total: 10 },
 { credits: 5, history: 3, total: 12 }], holdInitial: false },
} satisfies Record<ScenarioKind, {expected: {credits: number; history: number; total: number}[]; holdInitial: boolean}>;

const ENTRY = String.raw`
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import UserCreditsTab from '@/components/dashboard/user-credits-tab';
type Theme='gold'|'mono';
const state={theme:null as Theme|null,userId:'ao-credits-user',toasts:[] as string[],mounts:0,unmounts:0,mounted:false,disposed:false};
const host=document.getElementById('ao-root');if(!host)throw Error('AO_HOST_REQUIRED');
let root:Root|undefined;
Object.assign(window,{aoCredits:{state,
 mount(theme:Theme):void{
  if(state.mounts||state.disposed||localStorage.length||sessionStorage.length||document.cookie)throw Error('AO_FRESH_MOUNT_REQUIRED');
  state.theme=theme;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
  const props={isDark:theme==='gold',userId:'ao-credits-user',onToast:(message:string):void=>{state.toasts.push(message);}} satisfies React.ComponentProps<typeof UserCreditsTab>;
  root=createRoot(host);state.mounts++;state.mounted=true;
  root.render(<div className=${JSON.stringify(SHELL)}><main className=${JSON.stringify(MAIN)}><UserCreditsTab {...props}/></main></div>);
 },
 unmount():void{
  if(state.disposed)return;
  if(root){root.unmount();state.unmounts++;root=undefined;}
  state.mounted=false;state.disposed=true;
 }
}});
`;

let browser: Browser | undefined;

let javascript = '', stylesheet = '', compiledVersion = '';

const inputs = new Map<string, { bytes: Buffer; sha256: string }>();

const sessions = new Set<Session>(), contexts = new Set<BrowserContext>();

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }

async function bindBytes(filename: string): Promise<Buffer> {
  const absolute = path.resolve(filename), bytes = await readFile(absolute), hash = sha256(bytes);
  const previous = inputs.get(absolute);
  if (previous && previous.sha256 !== hash) throw Error('AO_INPUT_CHANGED ' + absolute);
  inputs.set(absolute, { bytes, sha256: hash }); return bytes;
}

function version(): string {
  const manifest = [...inputs].map(([filename, value]): [string, string] => [filename, value.sha256])
    .sort(([a], [b]): number => a.localeCompare(b));
  return sha256(JSON.stringify(manifest) + '\n' + ENTRY + '\n' + javascript + '\n' + stylesheet);
}

async function unchangedInputs(): Promise<void> {
  for (const [filename, value] of inputs) {
    expect(sha256(await readFile(filename)), 'actual compiled input still current: ' + filename).toBe(value.sha256);
  }
  expect(version(), 'actual input bytes, entry, production JS and real compiled CSS bound together').toBe(compiledVersion);
}

beforeAll(async (): Promise<void> => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('AO_INSTALLED_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await bindBytes('tsconfig.json');
  const built = await build({
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', write: false,
    bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'ao-user-credits-entry.tsx' },
    plugins: [{ name: 'ao-bind-actual-input-bytes', setup(api): void {
      api.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path);
        const loader: import('esbuild').Loader = extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts'
          : extension === '.jsx' ? 'jsx' : extension === '.json' ? 'json' : 'js';
        return { contents: await bindBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AO_SINGLE_IN_MEMORY_BUNDLE_REQUIRED');
  javascript = built.outputFiles[0].text;
  const filenames = Object.keys(built.metafile.inputs).filter((file: string): boolean => file !== 'ao-user-credits-entry.tsx');
  for (const required of ['src/components/dashboard/user-credits-tab.tsx', 'src/lib/credits-constants.ts']) {
    if (!filenames.some((file: string): boolean => path.resolve(file) === path.resolve(required))) throw Error('AO_REAL_INPUT_REQUIRED ' + required);
  }
  const scan: Array<{ content: string; extension: string }> = [{ content: ENTRY, extension: 'tsx' }];
  for (const filename of filenames) {
    const input = inputs.get(path.resolve(filename)); if (!input) throw Error('AO_UNBOUND_INPUT ' + filename);
    if (/^src[\\/]/.test(filename) && /\.[jt]sx?$/.test(filename)) {
      scan.push({ content: input.bytes.toString('utf8'), extension: path.extname(filename).slice(1) });
    }
  }
  const dashboard = (await bindBytes('src/components/dashboard/dashboard-view.tsx')).toString('utf8');
  // Source text checks here bind the fixture shell, not product behavior.
  expect(dashboard.includes('className="' + SHELL + '"'), 'current real Dashboard shell').toBe(true);
  expect(dashboard.includes('<main className="' + MAIN + '"'), 'current real Dashboard main').toBe(true);
  const compiler = await compile((await bindBytes('src/app/globals.css')).toString('utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
      if (/^(?:https?:|\/\/)/.test(id)) throw Error('AO_NO_REMOTE_STYLESHEETS');
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
        : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: filename, base: path.dirname(filename), content: (await bindBytes(filename)).toString('utf8') };
    },
  });
  stylesheet = compiler.build(new Scanner({}).scanFiles(scan));
  compiledVersion = version(); await unchangedInputs();
  console.log('AO_COMPILED_PROVENANCE', JSON.stringify({ version: compiledVersion,
    files: [...inputs].map(([filename, input]): Record<string, unknown> => ({ filename, bytes: input.bytes.length, sha256: input.sha256 })),
    entry: sha256(ENTRY), javascript: sha256(javascript), stylesheet: sha256(stylesheet) }));
  // Installed Chromium only. Never install/download, launch persistent profiles,
  // attach to an existing app, load credentials or contact the real application.
  browser = await chromium.launch({ headless: true });
}, 30000);

function deferred(): Deferred {
  let finish: (() => void) | undefined;
  const value: Deferred = {
    promise: new Promise<void>((resolve): void => { finish = resolve; }), settled: false,
    resolve(): void { if (!value.settled) { value.settled = true; finish?.(); } },
  };
  return value;
}

async function bounded<T>(name: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_resolve, reject): void => {
      timer = setTimeout((): void => reject(Error('AO_BOUND_EXCEEDED ' + name)), 2500);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function paintFrames(page: Page): Promise<void> {
  await page.evaluate((): Promise<void> => new Promise<void>((resolve): void => {
    requestAnimationFrame((): void => { requestAnimationFrame((): void => resolve()); });
  }));
}

async function track(s: Session, label: string, run: () => Promise<void>): Promise<void> {
  // Every async event/route operation is owned; rejections enter the final fault
  // ledger even if the product ignores a rejected fetch or an event is voided.
  const operation = Promise.resolve().then(run).catch((error: unknown): void => { s.faults.push(label + ' ' + String(error)); });
  s.handlers.add(operation);
  try { await operation; } finally { s.handlers.delete(operation); }
}

async function requestsSettled(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try {
    await bounded('all owned native requests finish', (): Promise<void> => new Promise<void>((resolve): void => {
      notify = (): void => { if (s.pending.size === 0) resolve(); };
      s.waiters.add(notify); notify();
    }));
  } finally { if (notify) s.waiters.delete(notify); }
}

async function drain(s: Session): Promise<void> {
  await bounded('owned route and event handlers', async (): Promise<void> => { await Promise.all([...s.handlers]); });
  await requestsSettled(s);
  await bounded('final owned handlers', async (): Promise<void> => { await Promise.all([...s.handlers]); });
  expect(s.pending.size, 'no unfinished native requests').toBe(0);
  expect(s.handlers.size, 'no unfinished route/event handlers').toBe(0);
}

async function ui(s: Session): Promise<UiState> {
  return await s.page.evaluate((): UiState => {
    const state = (window as unknown as FixtureWindow).aoCredits.state;
    return { ...state, toasts: [...state.toasts] };
  });
}

async function noCredentialsOrStorage(s: Session): Promise<void> {
  expect(await s.context.cookies(), 'fresh context never acquires cookies').toEqual([]);
  expect(await s.page.evaluate((): { local: number; session: number; cookie: string } => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
  }))).toEqual({ local: 0, session: 0, cookie: '' });
}

function expectedCounts(s: Session): Array<[string, number]> {
  const expected = SCENARIOS[s.kind].expected[s.step];
  if (!expected) throw Error('AO_EXACT_STEP_REQUIRED');
  return [
    ['GET ' + ORIGIN + '/', 1], ['GET ' + ORIGIN + '/ao.js', 1], ['GET ' + ORIGIN + '/ao.css', 1],
    ['GET ' + ORIGIN + '/api/credits', expected.credits],
    ...expected.history ? [['GET ' + ORIGIN + '/api/credits?action=transactions', expected.history] as [string, number]] : [],
    ['GET ' + ORIGIN + '/api/credits/payment-status', 1],
  ];
}

export async function quiet(s: Session): Promise<void> {
  await paintFrames(s.page); await drain(s); await noCredentialsOrStorage(s);
  expect((await ui(s)).toasts, 'callback log only; not real Toast acceptance').toEqual([]);
  expect([...s.counts].sort(([a], [b]): number => a.localeCompare(b))).toEqual(
    expectedCounts(s).sort(([a], [b]): number => a.localeCompare(b)));
  expect(s.receipts.every(r => r.received), 'every actual handler response checked at browser boundary').toBe(true);
  expect(s.faults).toEqual([]); expect(s.blockedHttp).toBe(0); expect(s.blockedWs).toBe(0);
}

async function deny(s: Session, route: Route, detail: string): Promise<void> {
  s.blockedHttp++; s.faults.push(detail);
  try { await route.abort('blockedbyclient'); } catch (error) { s.faults.push('AO_ABORT_FAILED ' + String(error)); }
}

async function dispatch(s: Session, route: Route): Promise<void> {
  const request = route.request(), key = request.method() + ' ' + request.url();
  const ordinal = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, ordinal);
  try {
    const url = new URL(request.url()), headers = await request.allHeaders();
    const credentialHeader = Object.keys(headers).some((name: string): boolean => /authorization|cookie|token|secret|key|credential/i.test(name));
    if (s.closing || url.origin !== ORIGIN || url.username || url.password || url.hash
      || request.method() !== 'GET' || request.postData() !== null || credentialHeader
      || request.frame() !== s.page.mainFrame()) throw Error('AO_FORBIDDEN_REQUEST ' + key);
    const resource = request.resourceType();
    if (url.pathname === '/' && !url.search && ordinal === 1 && resource === 'document' && request.isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/ao.css"><script src="/ao.js" defer></script></head><body><div id="ao-root"></div></body></html>' });
      return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/ao.js' && resource === 'script') {
      await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: javascript }); return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/ao.css' && resource === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css; charset=utf-8', body: stylesheet }); return;
    }
    if (!['fetch', 'xhr'].includes(resource) || request.isNavigationRequest()) throw Error('AO_UNKNOWN_RESOURCE ' + key);
    const plan = SCENARIOS[s.kind], expected = plan.expected[s.step];
    if (!expected) throw Error('AO_UNKNOWN_STEP');
    if (url.pathname === '/api/credits' && !url.search) {
      if (ordinal !== expected.credits) throw Error('AO_BALANCE_SEQUENCE ' + key);
      await actualReply(s, route, plan.holdInitial && ordinal === 1); return;
    }
    if (url.pathname === '/api/credits' && url.search === '?action=transactions') {
      if (ordinal !== expected.history
        || s.counts.get('GET ' + ORIGIN + '/api/credits') !== expected.credits
        || !s.receipts.some(r => r.step === s.step && r.url === ORIGIN + '/api/credits' && r.status === 200)
        || (plan.holdInitial && !s.releaseRefresh.settled)) throw Error('AO_HISTORY_SEQUENCE ' + key);
      await actualReply(s, route, false); return;
    }
    if (url.pathname === '/api/credits/payment-status' && !url.search && ordinal === 1) {
      await route.fulfill({ json: PAYMENT_STATUS }); s.paymentArrived.resolve(); return;
    }
    throw Error('AO_UNKNOWN_HTTP ' + key);
  } catch (error) { await deny(s, route, String(error)); }
}

function watchPage(s: Session, page: Page): void {
  page.on('pageerror', (error: Error): void => { s.faults.push('AO_PAGE_ERROR ' + error.message); });
  page.on('console', (message): void => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    const receipt = s.receipts.find(r => r.url === location && r.status === 500 && !r.consoleObserved);
    if (/^Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)$/.test(message.text()) && receipt) {
      receipt.consoleObserved = true;
      s.expectedResourceErrors.push(JSON.stringify({url:location,text:message.text(),step:receipt.step,status:receipt.status,sha256:receipt.sha256}));
    } else s.faults.push('AO_CONSOLE_ERROR ' + location + ' ' + message.text());
  });
  page.on('response', response => {
    const url = response.url();
    if (new URL(url).pathname !== '/api/credits') return;
    void track(s, 'AO_VERIFY_ACTUAL_WIRE_RESPONSE', async (): Promise<void> => {
      const receipt = s.receipts.find(r => r.url === url && !r.received);
      if (!receipt) throw Error('AO_UNPLANNED_WIRE_RESPONSE ' + url);
      const bytes = await response.body();
      expect(response.status(), 'actual handler HTTP status reaches browser').toBe(receipt.status);
      expect(bytes.length, 'actual handler body size reaches browser').toBe(receipt.bytes);
      expect(sha256(bytes), 'actual handler exact body reaches browser').toBe(receipt.sha256);
      const headers = await response.allHeaders();
      for (const [name,value] of Object.entries(receipt.headers)) expect(headers[name], 'actual handler response header ' + name).toBe(value);
      receipt.received = true;
    });
  });
  page.on('dialog', (dialog): void => {
    s.faults.push('AO_UNEXPECTED_DIALOG');
    void track(s, 'AO_DISMISS_DIALOG', async (): Promise<void> => { await dialog.dismiss(); });
  });
  page.on('download', (download): void => {
    s.faults.push('AO_UNEXPECTED_DOWNLOAD');
    void track(s, 'AO_CANCEL_DOWNLOAD', async (): Promise<void> => { await download.cancel(); });
  });
}

async function open(entry: MatrixEntry, kind: ScenarioKind, actualGet: ActualGet): Promise<Session> {
  await unchangedInputs(); if (!browser) throw Error('AO_BROWSER_REQUIRED');
  const context = await browser.newContext({
    viewport: { width: entry.width, height: entry.height }, reducedMotion: 'reduce',
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: false,
  });
  contexts.add(context); let acquired: Session | undefined; let bootstrapClosed = false;
  context.once('close', (): void => { bootstrapClosed = true; });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = {
      context, page, kind, actualGet, receipts: [], expectedResourceErrors: [], step: 0, closing: false, faults: [], blockedHttp: 0, blockedWs: 0,
      counts: new Map(), handlers: new Set(), seen: new Set(), pending: new Set(), completed: new Set(), failed: new Set(),
      waiters: new Set(), initialArrived: deferred(), paymentArrived: deferred(), releaseRefresh: deferred(),
      contextClosed: false, pageClosed: false, wheels: 0,
    };
    acquired = s; sessions.add(s); watchPage(s, page);
    context.on('close', (): void => { s.contextClosed = true; });
    page.on('close', (): void => { s.pageClosed = true; });
    context.on('request', (request: Request): void => { s.seen.add(request); s.pending.add(request); });
    context.on('requestfinished', (request: Request): void => {
      s.pending.delete(request); s.completed.add(request); for (const notify of s.waiters) notify();
    });
    context.on('requestfailed', (request: Request): void => {
      s.pending.delete(request); s.failed.add(request); for (const notify of s.waiters) notify();
    });
    context.on('page', (other: Page): void => {
      if (other === page) return;
      s.faults.push('AO_UNEXPECTED_PAGE'); watchPage(s, other);
      void track(s, 'AO_CLOSE_UNEXPECTED_PAGE', async (): Promise<void> => { await other.close(); });
    });
    await context.routeWebSocket('**/*', async (socket: WebSocketRoute): Promise<void> => {
      await track(s, 'AO_WS_HANDLER', async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AO_FORBIDDEN_WS ' + socket.url());
        // Never connectToServer: close at the browser transport boundary.
        await socket.close({ code: 1008, reason: 'AO isolated synthetic fixture' });
      });
    });
    await context.route('**/*', async (route: Route): Promise<void> => {
      await track(s, 'AO_HTTP_HANDLER', (): Promise<void> => dispatch(s, route));
    });
    await page.goto(ORIGIN + '/');
    await page.evaluate((theme: Theme): void => (window as unknown as FixtureWindow).aoCredits.mount(theme), entry.theme);
    await page.getByRole('heading', { name: '我的积分', exact: true }).waitFor();
    await bounded('owned initial GET and payment configuration arrive', async (): Promise<void> => {
      await Promise.all([s.initialArrived.promise, s.paymentArrived.promise]);
    });
    await paintFrames(page);
    expect(await page.locator('html').getAttribute('class')).toBe(entry.theme === 'gold' ? 'theme-gold' : 'theme-monochrome');
    expect(await page.locator('html').evaluate((element: Element): string => getComputedStyle(element).getPropertyValue('--primary').trim()))
      .toBe(entry.theme === 'gold' ? '#d4af37' : '#3b82f6');
    expect(await page.locator('html').evaluate((element: Element): string => getComputedStyle(element).getPropertyValue('--card').trim()))
      .toBe(entry.theme === 'gold' ? '#1c2333' : '#f8fafc');
    expect(await page.evaluate((): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect((await ui(s)).userId).toBe(USER_ID); return s;
  } catch (error) {
    try {
      if (acquired) await dispose(acquired);
      else {
        await bounded('bootstrap context close', async (): Promise<void> => {
          await context.close(); expect(bootstrapClosed).toBe(true); expect(context.pages()).toEqual([]);
        });
        contexts.delete(context);
      }
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AO_OPEN_AND_DISPOSAL'); }
    throw error;
  }
}

async function disposeOnce(s: Session): Promise<void> {
  const errors: unknown[] = [];
  // Release before waiting or marking the boundary closed. A failed assertion
  // can never leave the controller's synthetic refresh response suspended.
  s.releaseRefresh.resolve();
  try {
    await bounded('release drain and final mounted paint', async (): Promise<void> => { await drain(s); await paintFrames(s.page); });
  } catch (error) { errors.push(error); }
  try {
    const result = await bounded('real React root unmount', (): Promise<{ state: UiState; empty: boolean }> =>
      s.page.evaluate((): { state: UiState; empty: boolean } => {
        const fixture = (window as unknown as FixtureWindow).aoCredits;
        if (!fixture) throw Error('AO_FIXTURE_NOT_LOADED');
        fixture.unmount();
        return { state: { ...fixture.state, toasts: [...fixture.state.toasts] },
          empty: document.getElementById('ao-root')?.childElementCount === 0 };
      }));
    expect(result.state.disposed).toBe(true); expect(result.state.mounted).toBe(false);
    expect(result.state.mounts, 'a successful product scenario mounted one actual React root').toBe(1);
    expect(result.state.unmounts, 'every mounted React root disposed').toBe(result.state.mounts);
    expect(result.empty, 'real root DOM removed by React').toBe(true);
    await bounded('unmounted paint requests and storage closure', async (): Promise<void> => {
      await paintFrames(s.page); await drain(s); await noCredentialsOrStorage(s);
    });
  } catch (error) { errors.push(error); }
  try { await bounded('final input-byte binding', unchangedInputs); } catch (error) { errors.push(error); }
  s.closing = true;
  try { await bounded('context close', (): Promise<void> => s.context.close()); }
  catch (error) { errors.push(error); }
  try { await bounded('closed context event/route drain', async (): Promise<void> => { await Promise.all([...s.handlers]); }); }
  catch (error) { errors.push(error); }
  try {
    expect(s.contextClosed, 'native context close event observed').toBe(true);
    expect(s.pageClosed && s.page.isClosed(), 'native owned page closed').toBe(true);
    expect(s.context.pages(), 'no open pages in closed context').toEqual([]);
    expect(s.releaseRefresh.settled, 'owned response release is idempotent and unconditional').toBe(true);
    expect([...s.counts].sort(([a], [b]): number => a.localeCompare(b))).toEqual(
      expectedCounts(s).sort(([a], [b]): number => a.localeCompare(b)));
    const expectedNativeRequests = SCENARIOS[s.kind].expected[s.step].total;
    expect(s.seen.size, 'only exact owned document/assets/GETs observed').toBe(expectedNativeRequests);
    expect(s.completed.size).toBe(expectedNativeRequests); expect(s.failed.size).toBe(0);
    expect([...s.seen].every((request: Request): boolean => s.completed.has(request))).toBe(true);
    expect(s.pending.size).toBe(0); expect(s.handlers.size).toBe(0); expect(s.waiters.size).toBe(0);
    expect(s.blockedHttp, 'denied HTTP/method/header attempts remain fatal even if product catches them').toBe(0);
    expect(s.blockedWs, 'denied WS attempts remain fatal').toBe(0);
    expect(s.receipts.every(r => r.received), 'all real API response receipts observed').toBe(true);
    console.log('AO_WIRE_CLOSURE', JSON.stringify({kind:s.kind,step:s.step,receipts:s.receipts,expectedResourceErrors:s.expectedResourceErrors}));
    expect(s.faults, 'unexpected pages/downloads/dialogs/errors remain fatal').toEqual([]);
  } catch (error) { errors.push(error); }
  if (s.contextClosed) { contexts.delete(s.context); sessions.delete(s); }
  if (errors.length) throw new AggregateError(errors, 'AO_DISPOSAL');
}

async function dispose(s: Session): Promise<void> {
  // Cached promise prevents repeated unmount, route release or close operations.
  s.disposePromise ??= disposeOnce(s); await s.disposePromise;
}

let captureIndex = 0;

export async function capture(s: Session, label: string): Promise<void> {
  const directory = path.resolve('output/playwright/user-credits-ao-states-native-20261019', String(process.pid));
  await mkdir(directory, { recursive: true });
  const state = await ui(s);
  const size = s.page.viewportSize();
  const filename = path.join(directory, `${state.theme}-${size?.width}x${size?.height}-${++captureIndex}-${label}.png`);
  if (label === 'failure-state') console.log('AO_FAILURE_LAYOUT', JSON.stringify(await s.page.locator('#ao-root button').evaluateAll((elements: Element[]): ButtonLayout[] => elements.map((element: Element): ButtonLayout => {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { name: element.textContent?.trim(), rect: { x: box.x, y: box.y, width: box.width, height: box.height }, font: css.fontSize, selected: element.getAttribute('aria-pressed'), class: element.className };
  }))));
  await s.page.screenshot({ path: filename });
  console.log('AO_CAPTURE', JSON.stringify({ path: filename, label, inputVersion: compiledVersion }));
}

export async function withSession(entry: MatrixEntry, kind: ScenarioKind, actualGet: ActualGet, scenario: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(entry, kind, actualGet); let original: unknown; let failed = false;
  try { await scenario(s); await capture(s, 'end-state'); } catch (error) { original = error; failed = true; try { await capture(s, 'failure-state'); } catch (captureError) { original = new AggregateError([error, captureError], 'AO_FAILURE_AND_CAPTURE'); } }
  try { await dispose(s); }
  catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], 'AO_SCENARIO_AND_DISPOSAL'); throw cleanup; }
  if (failed) throw original;
}

afterAll(async (): Promise<void> => {
  const errors: unknown[] = [];
  try {
    for (const s of [...sessions]) { try { await dispose(s); } catch (error) { errors.push(error); } }
    for (const context of [...contexts]) {
      try { await bounded('remaining context close', (): Promise<void> => context.close()); contexts.delete(context); }
      catch (error) { errors.push(error); }
    }
  } finally {
    const owned = browser;
    try {
      if (owned) {
        await bounded('browser close', (): Promise<void> => owned.close());
        expect(owned.isConnected(), 'owned installed Chromium disconnected').toBe(false);
      }
    } catch (error) { errors.push(error); }
    finally { browser = undefined; }
  }
  if (errors.length) throw new AggregateError(errors, 'AO_FINAL_DISPOSAL');
}, 15000);

export function main(s: Session): Locator { return s.page.locator('main.dashboard-scrollable'); }

function root(s: Session): Locator { return main(s).locator(':scope > div'); }

export function history(s: Session): Locator { return root(s).locator(':scope > div').last(); }

async function rect(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox(); if (!value) throw Error('AO_RENDERED_RECT_REQUIRED'); return value;
}

async function geometry(locator: Locator): Promise<Geometry> {
  return await locator.evaluate((element: Element): Geometry => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    const clips = (box: DOMRect, start: Element | null): boolean => {
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight, opacity = 1;
      for (let ancestor = start; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), a = ancestor.getBoundingClientRect(); opacity *= Number(css.opacity);
        if (css.display === 'none' || css.visibility !== 'visible') return false;
        if (/^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
          left = Math.max(left, a.left + ancestor.clientLeft); right = Math.min(right, a.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (/^(auto|scroll|hidden|clip)$/.test(css.overflowY)) {
          top = Math.max(top, a.top + ancestor.clientTop); bottom = Math.min(bottom, a.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
      return opacity > 0 && box.width > 0 && box.height > 0 && box.left >= left - 0.5 && box.right <= right + 0.5
        && box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
    };
    const textBoxes: DOMRect[] = [], cjkLines = new Map<number, number[]>();
    let glyphs = true, horizontal = own.writingMode === 'horizontal-tb', cjk = 0;
    if (!element.matches('input,textarea,select')) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, value = node.textContent ?? '', parent = node.parentElement;
        if (!parent || !value.trim()) continue;
        const textCss = getComputedStyle(parent);
        horizontal &&= textCss.writingMode === 'horizontal-tb';
        if (textCss.color === 'rgba(0, 0, 0, 0)' || textCss.color === 'transparent') glyphs = false;
        for (let index = 0; index < value.length; index++) {
          if (!value[index].trim()) continue;
          const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
          const b = range.getBoundingClientRect();
          if (!clips(b, parent)) glyphs = false;
          textBoxes.push(b);
          if (/[\u3400-\u9fff]/.test(value[index])) {
            cjk++; const line = Math.round(b.top), positions = cjkLines.get(line) ?? [];
            positions.push(b.left); cjkLines.set(line, positions);
          }
        }
      }
    }
    const icons = [...element.querySelectorAll('svg')];
    const overlap = (a: DOMRect, b: DOMRect): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + r.height / 2],
      [r.right - 8, r.top + r.height / 2], [r.left + r.width / 2, r.top + 8], [r.left + r.width / 2, r.bottom - 8]];
    const trace: Array<Record<string, unknown>> = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor), b = ancestor.getBoundingClientRect();
      trace.push({ tag: ancestor.tagName, class: ancestor.getAttribute('class'),
        rect: { x: b.x, y: b.y, width: b.width, height: b.height },
        client: [ancestor.clientWidth, ancestor.clientHeight], scroll: [ancestor.scrollWidth, ancestor.scrollHeight, ancestor.scrollLeft, ancestor.scrollTop],
        overflow: [css.overflowX, css.overflowY], opacity: css.opacity, visibility: css.visibility, display: css.display });
    }
    return {
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      clear: Number(own.opacity) > 0 && own.display !== 'none' && own.visibility === 'visible' && clips(r, element.parentElement),
      glyphs, horizontal,
      cjkHorizontal: cjk <= 1 || [...cjkLines.values()].some((positions: number[]): boolean => positions.some((x: number): boolean => Math.abs(x - positions[0]) > 0.5)),
      singleLine: new Set(textBoxes.map((b: DOMRect): number => Math.round(b.top))).size <= 1,
      iconsFit: icons.every((icon: SVGSVGElement): boolean => clips(icon.getBoundingClientRect(), icon)),
      iconsSeparate: icons.every((icon: SVGSVGElement): boolean => textBoxes.every((b: DOMRect): boolean => !overlap(icon.getBoundingClientRect(), b))),
      fiveHits: points.every(([x, y]): boolean => { const hit = document.elementFromPoint(x, y); return !!hit && element.contains(hit); }),
      font: Number.parseFloat(own.fontSize), disabled: element.matches(':disabled'), trace,
    };
  });
}

async function visible(locator: Locator, oneLine = false): Promise<Geometry> {
  const value = await geometry(locator), detail = value.name + ' ' + JSON.stringify(value);
  expect(value.clear, 'whole border box fits viewport/all ancestor clips: ' + detail).toBe(true);
  expect(value.glyphs, 'actual glyph ranges fit, including hidden/clip boxes: ' + detail).toBe(true);
  expect(value.horizontal && value.cjkHorizontal, 'actual horizontal prose, not a one-CJK-character column: ' + detail).toBe(true);
  expect(value.iconsFit && value.iconsSeparate, 'actual icons fit and do not overlap text: ' + detail).toBe(true);
  if (oneLine) expect(value.singleLine, 'short label or financial number stays on one line: ' + detail).toBe(true);
  return value;
}

async function control(locator: Locator, oneLine = true): Promise<void> {
  const value = await visible(locator, oneLine);
  if (value.disabled) return;
  expect(value.rect.width, value.name + ' operative width').toBeGreaterThanOrEqual(44);
  expect(value.rect.height, value.name + ' operative height').toBeGreaterThanOrEqual(44);
  expect(value.fiveHits, value.name + ' center/left/right/top/bottom native hit samples').toBe(true);
  if (await locator.evaluate((element: Element): boolean => element.matches('input,textarea,select'))) {
    expect(value.font, 'mobile input computed font is at least 16px').toBeGreaterThanOrEqual(16);
  }
}

async function reveal(s: Session, locator: Locator): Promise<void> {
  // At most ten geometry-directed wheel steps, as in the installed reference.
  // This is native traversal, not retrying assertions or relaxing tolerances.
  for (let step = 0; step < 10; step++) {
    const move = await locator.evaluate((element: Element): { x: number; y: number; delta: number } | null => {
      const target = element.getBoundingClientRect();
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
        if (!/^(auto|scroll)$/.test(css.overflowY) || ancestor.scrollHeight <= ancestor.clientHeight) continue;
        let left = Math.max(0, r.left + ancestor.clientLeft), right = Math.min(innerWidth, r.left + ancestor.clientLeft + ancestor.clientWidth);
        let top = Math.max(0, r.top + ancestor.clientTop), bottom = Math.min(innerHeight, r.top + ancestor.clientTop + ancestor.clientHeight);
        for (let outer = ancestor.parentElement; outer; outer = outer.parentElement) {
          const style = getComputedStyle(outer), b = outer.getBoundingClientRect();
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
            left = Math.max(left, b.left + outer.clientLeft); right = Math.min(right, b.left + outer.clientLeft + outer.clientWidth);
          }
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
            top = Math.max(top, b.top + outer.clientTop); bottom = Math.min(bottom, b.top + outer.clientTop + outer.clientHeight);
          }
        }
        for (const sticky of ancestor.querySelectorAll<HTMLElement>('.sticky')) {
          if (sticky.contains(element) || getComputedStyle(sticky).position !== 'sticky') continue;
          const b = sticky.getBoundingClientRect();
          if (b.top <= top + 0.5 && b.bottom > top && b.bottom < bottom) top = b.bottom;
          else if (b.bottom >= bottom - 0.5 && b.top > top && b.top < bottom) bottom = b.top;
        }
        const delta = target.top < top + 2 ? target.top - top - 8 : target.bottom > bottom - 2 ? target.bottom - bottom + 8 : 0;
        if (right <= left || bottom <= top || !delta || (delta < 0 && ancestor.scrollTop <= 0)
          || (delta > 0 && ancestor.scrollTop + ancestor.clientHeight >= ancestor.scrollHeight - 1)) continue;
        return { x: (left + right) / 2, y: (top + bottom) / 2, delta };
      }
      return null;
    });
    if (!move) return;
    await s.page.mouse.move(move.x, move.y); await s.page.mouse.wheel(0, move.delta); s.wheels++;
    await paintFrames(s.page);
  }
  // No DOM scroll, horizontal scroll, forced click or CSS fallback. The next
  // full geometry/hit assertion must pass with the actual resulting viewport.
}

export async function readable(s: Session, locator: Locator, oneLine = false): Promise<void> {
  await reveal(s, locator); await visible(locator, oneLine);
}

export async function reach(s: Session, locator: Locator, oneLine = true): Promise<void> {
  await reveal(s, locator); await control(locator, oneLine);
}

async function assertSafeActivation(locator: Locator): Promise<void> {
  expect(await locator.count()).toBe(1);
  const permitted = await locator.evaluate((element: Element): boolean => {
    if (element instanceof HTMLInputElement) return element.type === 'number' && !element.disabled;
    if (!(element instanceof HTMLButtonElement) || element.disabled) return false;
    const text = element.textContent?.trim() ?? '';
    // Defense in depth: even an accidentally broad caller selector cannot
    // activate any create-order, confirm-paid, query-order or payment control.
    return !/立即充值|请选择充值套餐|创建订单|完成付|确认付|查询订单|打开.*支付|扫码完成支付/.test(text);
  });
  expect(permitted, 'only pre-order choice/header/filter/input/close native activation allowed').toBe(true);
}

async function activate(s: Session, locator: Locator, oneLine = true, alreadyVisible = false): Promise<void> {
  await assertSafeActivation(locator);
  if (alreadyVisible) await control(locator, oneLine); else await reach(s, locator, oneLine);
  const box = await rect(locator); await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await paintFrames(s.page);
}

export async function noHorizontalOverflow(s: Session): Promise<void> {
  const bad = await s.page.evaluate((): string[] => {
    const result: string[] = [];
    for (const selector of ['html', 'body', '.dashboard-root', 'main.dashboard-scrollable']) {
      const element = document.querySelector(selector);
      if (!element || element.scrollWidth > element.clientWidth + 1) result.push(selector + ':horizontal-content');
    }
    for (const element of document.querySelectorAll('#ao-root *')) {
      if (!(element instanceof HTMLElement) || element.matches('input,select,textarea')) continue;
      const r = element.getBoundingClientRect(), css = getComputedStyle(element);
      if (!r.width || !r.height || css.display === 'none') continue;
      if (r.left < -0.5 || r.right > innerWidth + 0.5) result.push(element.tagName + ':outside-viewport:' + element.className);
      // Checking scrollWidth even on overflow:hidden/clip rejects a fix which
      // merely conceals clipped controls, financial values or descriptions.
      if (element.scrollWidth > element.clientWidth + 1) result.push(element.tagName + ':hidden-horizontal-content:' + element.className);
    }
    return result;
  });
  expect(bad, 'actual layout has no horizontal content concealed by clipping').toEqual([]);
}

export async function filter(s: Session, name: '全部' | '收入' | '支出'): Promise<void> {
  await activate(s, main(s).getByRole('button', { name, exact: true }));
}

function balanceFields(s: Session): readonly Locator[] {
  return [
    main(s).getByText('当前余额', { exact: true }).locator('..').locator(':scope > div').last(),
    main(s).getByText('累计获得', { exact: true }).locator('..').locator('span').last(),
    main(s).getByText('累计消费', { exact: true }).locator('..').locator('span').last(),
  ];
}

export async function balances(s: Session, expected: readonly string[]): Promise<void> {
  const fields = balanceFields(s);
  expect(fields.length).toBe(expected.length);
  for (let index = 0; index < fields.length; index++) {
    expect((await fields[index].textContent())?.trim(), 'real balance/totals distinguish absent data from known zero').toBe(expected[index]);
    await readable(s, fields[index], true);
  }
}

export async function settled(s: Session): Promise<void> {
  await paintFrames(s.page); await drain(s); await paintFrames(s.page); await quiet(s);
}

export async function advance(s: Session, step: number, button: Locator): Promise<void> {
  expect(step).toBe(s.step + 1);
  s.step = step; await activate(s, button); await settled(s);
}

export async function failure(s: Session, label: string): Promise<Locator> {
  const alert = main(s).getByRole('alert');
  expect(await alert.count(), 'failed data is visible, not silently represented as zero/empty').toBe(1);
  expect(await alert.textContent()).toContain(label);
  await readable(s, alert); await readable(s, alert.getByText(label, { exact: true }));
  const retry = alert.getByRole('button', { name: '重试加载', exact: true });
  await reach(s, retry); await noHorizontalOverflow(s); return retry;
}



async function actualReply(s: Session, route: Route, hold: boolean): Promise<void> {
  const url = route.request().url();
  const response = await s.actualGet(url, {kind:s.kind,step:s.step});
  const headers = Object.fromEntries(response.headers.entries());
  if (Object.keys(headers).some(name => /cookie|authorization|token|secret|credential/i.test(name))) throw Error('AO_SENSITIVE_RESPONSE_HEADER');
  const body = await response.text();
  const receipt: WireReceipt = {url,step:s.step,status:response.status,sha256:sha256(body),bytes:Buffer.byteLength(body),headers,received:false,consoleObserved:false};
  s.receipts.push(receipt);
  if (new URL(url).search === '' && s.step === 0) s.initialArrived.resolve();
  if (hold) await s.releaseRefresh.promise;
  await route.fulfill({status:response.status,headers,body});
}
