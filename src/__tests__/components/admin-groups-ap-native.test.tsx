// @vitest-environment node
// AP: real full DashboardView and native production CSS; only persistence and exact synthetic HTTP reads isolated.
import { readFile, mkdir } from 'node:fs/promises';

import { createHash } from 'node:crypto';

import path from 'node:path';

import { compile } from 'tailwindcss';

import { Scanner } from '@tailwindcss/oxide';

import {
  chromium, type Browser, type BrowserContext, type Page, type Locator,
  type Request, type Route, type WebSocketRoute,
} from '@playwright/test';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';

interface MatrixEntry { theme: Theme; width: number; height: number }

interface Rect { x: number; y: number; width: number; height: number }

interface UiState {
  theme: Theme | null; userId: string; toasts: string[];
  mounts: number; unmounts: number; mounted: boolean; disposed: boolean;
}

interface FixtureWindow extends Window {
  apCredits: { state: UiState; mount(theme: Theme): void; unmount(): void };
}

interface Deferred {
  promise: Promise<void>; resolve(): void; settled: boolean;
}

interface Session {
  context: BrowserContext; page: Page; kind: ScenarioKind; step: number; closing: boolean;
  faults: string[]; blockedHttp: number; blockedWs: number;
  counts: Map<string, number>; handlers: Set<Promise<void>>;
  seen: Set<Request>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  waiters: Set<() => void>; initialArrived: Deferred; paymentArrived: Deferred; releaseRefresh: Deferred;
  contextClosed: boolean; pageClosed: boolean; disposePromise?: Promise<void>; wheels: number;
}

type ScenarioKind = 'empty' | 'groups';



interface Geometry {
  name: string; rect: Rect; clear: boolean; glyphs: boolean; horizontal: boolean;
  cjkHorizontal: boolean; singleLine: boolean; iconsFit: boolean;
  iconsSeparate: boolean; fiveHits: boolean; font: number; disabled: boolean;
  trace: Array<Record<string, unknown>>;
}

interface ButtonLayout {
  name: string | undefined; rect: Rect; font: string; selected: string | null; class: string;
}

const ORIGIN = 'https://admin-groups-ap-fixture.invalid';

const USER_ID = 'ap-admin';

const MATRIX = [
  { theme: 'gold', width: 320, height: 640 },
  { theme: 'gold', width: 640, height: 320 },
  { theme: 'mono', width: 320, height: 640 },
  { theme: 'mono', width: 640, height: 320 },
] as const satisfies readonly MatrixEntry[];

const SHELL = 'dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden';

const MAIN = 'dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0';





const LONG_GROUP_NAME = "APABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GROUPS = [
 {id:'ap-long',name:'AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出',product_types:['canvas','chat'],credit_quota:123456789,is_active:true,created_at:1,updated_at:1},
 {id:'ap-disabled',name:'AP停用分组',product_types:[],credit_quota:0,is_active:false,created_at:1,updated_at:1},
 {id:'ap-unbroken',name:LONG_GROUP_NAME,product_types:['canvas'],credit_quota:0,is_active:true,created_at:1,updated_at:1},
];
const REPLIES: Record<string,unknown> = {
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[],qrUrls:{wechat:'',alipay:''},payLinks:{wechat:'',alipay:''}},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[{id:'ap-member',name:'AP合成成员',password:'',role:'user',status:'active',createdAt:1,updatedAt:1,productType:'canvas',groupId:'ap-long'}]},
 '/api/admin/apis':{success:true,providers:[]},
 '/api/admin/api-balance':{success:true,balances:[]},
 '/api/ecom-templates':{success:true,templates:[]},
};







const SCENARIOS = {
 empty:{expected:[{total:10},{total:13}]},groups:{expected:[{total:10},{total:13}]},
} satisfies Record<ScenarioKind,{expected:{total:number}[]}>;

const PERSISTENCE_BOUNDARY = "const manager=new Proxy({getProjects(){return [];},getUsageStats(){return [];}},{get(target,key){if(Object.hasOwn(target,key))return Reflect.get(target,key);throw Error('AP_FORBIDDEN_PERSISTENCE_'+String(key));}});export const UserManager={getInstance(){return manager;}};";

const ENTRY = String.raw`
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import DashboardView from '@/components/dashboard/dashboard-view';
import type {User} from '@/lib/user-types';
type Theme='gold'|'mono';
const state={theme:null as Theme|null,userId:'ap-admin',toasts:[] as string[],mounts:0,unmounts:0,mounted:false,disposed:false};
const host=document.getElementById('ap-root');if(!host)throw Error('AP_HOST_REQUIRED');
let root:Root|undefined;
const forbidden=(kind:string):never=>{throw Error('AP_UNEXPECTED_CALLBACK_'+kind);};
Object.assign(window,{apCredits:{state,
 mount(theme:Theme):void{
  if(state.mounts||state.disposed||localStorage.length||sessionStorage.length||document.cookie)throw Error('AP_FRESH_MOUNT_REQUIRED');
  state.theme=theme;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
  const user={id:'ap-admin',name:'AP合成管理员',password:'',role:'admin',status:'active',createdAt:1,updatedAt:1,productType:'canvas'} satisfies User;
  root=createRoot(host);state.mounts++;state.mounted=true;
  root.render(<DashboardView user={user} isMonochrome={theme==='mono'} onOpenProject={()=>forbidden('project')} onNewProject={()=>forbidden('new')} onLogout={()=>forbidden('logout')}/>);
 },
 unmount():void{if(state.disposed)return;if(root){root.unmount();state.unmounts++;root=undefined;}state.mounted=false;state.disposed=true;}
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
  if (previous && previous.sha256 !== hash) throw Error('AP_INPUT_CHANGED ' + absolute);
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
  if (typeof process.getBuiltinModule !== 'function') throw Error('AP_INSTALLED_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await bindBytes('tsconfig.json');
  await bindBytes('src/lib/user-manager.ts');
  const built = await build({
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', write: false,
    bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'ap-dashboard-entry.tsx' },
    plugins: [{ name: 'ap-bind-actual-input-bytes', setup(api): void {
      api.onResolve({filter:/^@\/lib\/user-manager$/},()=>({path:'ap-local-persistence',namespace:'ap-boundary'}));
      api.onLoad({filter:/.*/,namespace:'ap-boundary'},()=>({contents:PERSISTENCE_BOUNDARY,loader:'js'}));
      api.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path);
        const loader: import('esbuild').Loader = extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts'
          : extension === '.jsx' ? 'jsx' : extension === '.json' ? 'json' : 'js';
        return { contents: await bindBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AP_SINGLE_IN_MEMORY_BUNDLE_REQUIRED');
  javascript = built.outputFiles[0].text;
  expect(Object.keys(built.metafile.inputs).filter(file => file.startsWith('ap-boundary:'))).toEqual(['ap-boundary:ap-local-persistence']);
  const filenames = Object.keys(built.metafile.inputs).filter((file: string): boolean => file !== 'ap-dashboard-entry.tsx' && file !== 'ap-boundary:ap-local-persistence');
  for (const required of ['src/components/dashboard/dashboard-view.tsx', 'src/components/custom-dialogs.tsx']) {
    if (!filenames.some((file: string): boolean => path.resolve(file) === path.resolve(required))) throw Error('AP_REAL_INPUT_REQUIRED ' + required);
  }
  const scan: Array<{ content: string; extension: string }> = [{ content: ENTRY, extension: 'tsx' }];
  for (const filename of filenames) {
    const input = inputs.get(path.resolve(filename)); if (!input) throw Error('AP_UNBOUND_INPUT ' + filename);
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
      if (/^(?:https?:|\/\/)/.test(id)) throw Error('AP_NO_REMOTE_STYLESHEETS');
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
        : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: filename, base: path.dirname(filename), content: (await bindBytes(filename)).toString('utf8') };
    },
  });
  stylesheet = compiler.build(new Scanner({}).scanFiles(scan));
  compiledVersion = version(); await unchangedInputs();
  console.log('AP_COMPILED_PROVENANCE', JSON.stringify({ version: compiledVersion,
    files: [...inputs].map(([filename, input]): Record<string, unknown> => ({ filename, bytes: input.bytes.length, sha256: input.sha256 })),
    localPersistenceBoundary:sha256(PERSISTENCE_BOUNDARY),entry: sha256(ENTRY), javascript: sha256(javascript), stylesheet: sha256(stylesheet) }));
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
      timer = setTimeout((): void => reject(Error('AP_BOUND_EXCEEDED ' + name)), 2500);
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
    const state = (window as unknown as FixtureWindow).apCredits.state;
    return { ...state, toasts: [...state.toasts] };
  });
}

async function noCredentialsOrStorage(s: Session): Promise<void> {
  expect(await s.context.cookies(), 'fresh context never acquires cookies').toEqual([]);
  expect(await s.page.evaluate((): { local: number; session: number; cookie: string } => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
  }))).toEqual({ local: 0, session: 0, cookie: '' });
}

function expectedCounts(s:Session):Array<[string,number]>{
 if(!SCENARIOS[s.kind].expected[s.step])throw Error('AP_EXACT_STEP_REQUIRED');
 return [['GET '+ORIGIN+'/',1],['GET '+ORIGIN+'/ap.js',1],['GET '+ORIGIN+'/ap.css',1],
 ...Object.keys(REPLIES).map((url):[string,number]=>['GET '+ORIGIN+url, s.step===1&&['/api/admin/users','/api/admin/apis'].includes(url)?2:1]),
 ['GET '+ORIGIN+'/api/admin/groups',s.step===1?2:1]];
}

async function quiet(s: Session): Promise<void> {
  await paintFrames(s.page); await drain(s); await noCredentialsOrStorage(s);
  expect((await ui(s)).toasts, 'callback log only; not real Toast acceptance').toEqual([]);
  expect([...s.counts].sort(([a], [b]): number => a.localeCompare(b))).toEqual(
    expectedCounts(s).sort(([a], [b]): number => a.localeCompare(b)));
  expect(s.faults).toEqual([]); expect(s.blockedHttp).toBe(0); expect(s.blockedWs).toBe(0);
}

async function deny(s: Session, route: Route, detail: string): Promise<void> {
  s.blockedHttp++; s.faults.push(detail);
  try { await route.abort('blockedbyclient'); } catch (error) { s.faults.push('AP_ABORT_FAILED ' + String(error)); }
}

async function dispatch(s: Session, route: Route): Promise<void> {
  const request = route.request(), key = request.method() + ' ' + request.url();
  const ordinal = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, ordinal);
  try {
    const url = new URL(request.url()), headers = await request.allHeaders();
    const credentialHeader = Object.keys(headers).some((name: string): boolean => /authorization|cookie|token|secret|key|credential/i.test(name));
    if (s.closing || url.origin !== ORIGIN || url.username || url.password || url.hash
      || request.method() !== 'GET' || request.postData() !== null || credentialHeader
      || request.frame() !== s.page.mainFrame()) throw Error('AP_FORBIDDEN_REQUEST ' + key);
    const resource = request.resourceType();
    if (url.pathname === '/' && !url.search && ordinal === 1 && resource === 'document' && request.isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/ap.css"><script src="/ap.js" defer></script></head><body><div id="ap-root"></div></body></html>' });
      return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/ap.js' && resource === 'script') {
      await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: javascript }); return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/ap.css' && resource === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css; charset=utf-8', body: stylesheet }); return;
    }
    if (!['fetch', 'xhr'].includes(resource) || request.isNavigationRequest()) throw Error('AP_UNKNOWN_RESOURCE ' + key);
    const expected=new Map(expectedCounts(s)).get(key);
    if(!expected||ordinal>expected)throw Error('AP_UNKNOWN_OR_EXTRA_GET '+key);
    if(url.pathname==='/api/admin/groups'&&!url.search){
      await route.fulfill({json:{success:true,groups:s.kind==='groups'?GROUPS:[]}});
      if(ordinal===1)s.initialArrived.resolve();return;
    }
    if(!url.search&&Object.hasOwn(REPLIES,url.pathname)){
      await route.fulfill({json:REPLIES[url.pathname]});
      if(url.pathname==='/api/credits/payment-config')s.paymentArrived.resolve();return;
    }
    throw Error('AP_UNKNOWN_HTTP ' + key);
  } catch (error) { await deny(s, route, String(error)); }
}

function watchPage(s: Session, page: Page): void {
  page.on('pageerror', (error: Error): void => { s.faults.push('AP_PAGE_ERROR ' + error.message); });
  page.on('console', (message): void => { if (message.type() === 'error') s.faults.push('AP_CONSOLE_ERROR ' + message.text()); });
  page.on('dialog', (dialog): void => {
    s.faults.push('AP_UNEXPECTED_DIALOG');
    void track(s, 'AP_DISMISS_DIALOG', async (): Promise<void> => { await dialog.dismiss(); });
  });
  page.on('download', (download): void => {
    s.faults.push('AP_UNEXPECTED_DOWNLOAD');
    void track(s, 'AP_CANCEL_DOWNLOAD', async (): Promise<void> => { await download.cancel(); });
  });
}

async function open(entry: MatrixEntry, kind: ScenarioKind): Promise<Session> {
  await unchangedInputs(); if (!browser) throw Error('AP_BROWSER_REQUIRED');
  const context = await browser.newContext({
    viewport: { width: entry.width, height: entry.height }, reducedMotion: 'reduce',
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: false,
  });
  contexts.add(context); let acquired: Session | undefined; let bootstrapClosed = false;
  context.once('close', (): void => { bootstrapClosed = true; });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = {
      context, page, kind, step: 0, closing: false, faults: [], blockedHttp: 0, blockedWs: 0,
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
      s.faults.push('AP_UNEXPECTED_PAGE'); watchPage(s, other);
      void track(s, 'AP_CLOSE_UNEXPECTED_PAGE', async (): Promise<void> => { await other.close(); });
    });
    await context.routeWebSocket('**/*', async (socket: WebSocketRoute): Promise<void> => {
      await track(s, 'AP_WS_HANDLER', async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AP_FORBIDDEN_WS ' + socket.url());
        // Never connectToServer: close at the browser transport boundary.
        await socket.close({ code: 1008, reason: 'AP isolated synthetic fixture' });
      });
    });
    await context.route('**/*', async (route: Route): Promise<void> => {
      await track(s, 'AP_HTTP_HANDLER', (): Promise<void> => dispatch(s, route));
    });
    await page.goto(ORIGIN + '/');
    await page.evaluate((theme: Theme): void => (window as unknown as FixtureWindow).apCredits.mount(theme), entry.theme);
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor();
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
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AP_OPEN_AND_DISPOSAL'); }
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
        const fixture = (window as unknown as FixtureWindow).apCredits;
        if (!fixture) throw Error('AP_FIXTURE_NOT_LOADED');
        fixture.unmount();
        return { state: { ...fixture.state, toasts: [...fixture.state.toasts] },
          empty: document.getElementById('ap-root')?.childElementCount === 0 };
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
    expect(s.faults, 'unexpected pages/downloads/dialogs/errors remain fatal').toEqual([]);
  } catch (error) { errors.push(error); }
  if (s.contextClosed) { contexts.delete(s.context); sessions.delete(s); }
  if (errors.length) throw new AggregateError(errors, 'AP_DISPOSAL');
}

async function dispose(s: Session): Promise<void> {
  // Cached promise prevents repeated unmount, route release or close operations.
  s.disposePromise ??= disposeOnce(s); await s.disposePromise;
}

let captureIndex = 0;

async function capture(s: Session, label: string): Promise<void> {
  const directory = path.resolve('output/playwright/admin-groups-ap-native-20261019', String(process.pid));
  await mkdir(directory, { recursive: true });
  const state = await ui(s);
  const size = s.page.viewportSize();
  const filename = path.join(directory, `${state.theme}-${size?.width}x${size?.height}-${++captureIndex}-${label}.png`);
  if (label === 'failure-state') console.log('AP_FAILURE_LAYOUT', JSON.stringify(await s.page.locator('#ap-root button').evaluateAll((elements: Element[]): ButtonLayout[] => elements.map((element: Element): ButtonLayout => {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { name: element.textContent?.trim(), rect: { x: box.x, y: box.y, width: box.width, height: box.height }, font: css.fontSize, selected: element.getAttribute('aria-pressed'), class: element.className };
  }))));
  await s.page.screenshot({ path: filename });
  console.log('AP_CAPTURE', JSON.stringify({ path: filename, label, inputVersion: compiledVersion }));
}

async function withSession(entry: MatrixEntry, kind: ScenarioKind, scenario: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(entry, kind); let original: unknown; let failed = false;
  try { await quiet(s); await scenario(s); await capture(s, 'end-state'); } catch (error) { original = error; failed = true; try { await capture(s, 'failure-state'); } catch (captureError) { original = new AggregateError([error, captureError], 'AP_FAILURE_AND_CAPTURE'); } }
  try { await dispose(s); }
  catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], 'AP_SCENARIO_AND_DISPOSAL'); throw cleanup; }
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
  if (errors.length) throw new AggregateError(errors, 'AP_FINAL_DISPOSAL');
}, 15000);

function main(s: Session): Locator { return s.page.locator('main.dashboard-scrollable'); }





async function rect(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox(); if (!value) throw Error('AP_RENDERED_RECT_REQUIRED'); return value;
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

async function readable(s: Session, locator: Locator, oneLine = false): Promise<void> {
  await reveal(s, locator); await visible(locator, oneLine);
}

async function reach(s: Session, locator: Locator, oneLine = true): Promise<void> {
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

async function noHorizontalOverflow(s: Session): Promise<void> {
  const bad = await s.page.evaluate((): string[] => {
    const result: string[] = [];
    for (const selector of ['html', 'body', '.dashboard-root', 'main.dashboard-scrollable']) {
      const element = document.querySelector(selector);
      if (!element || element.scrollWidth > element.clientWidth + 1) result.push(selector + ':horizontal-content');
    }
    for (const element of document.querySelectorAll('#ap-root *')) {
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














async function settle(s:Session):Promise<void>{await paintFrames(s.page);await drain(s);await paintFrames(s.page);}
async function navigateGroups(s:Session):Promise<void>{
 const trigger=s.page.getByRole('button',{name:'展开导航',exact:true});
 await trigger.click();await paintFrames(s.page);
 const destination=s.page.getByRole('navigation').getByRole('button',{name:/分组管理/});
 // Navigation is traversed natively, not declared fully touch-audited by this slice.
 await reveal(s,destination);await destination.click();await settle(s);
 expect(await main(s).getByRole('heading',{name:'分组管理',exact:true}).count()).toBe(1);
 expect(await trigger.getAttribute('aria-expanded')).toBe('false');
}
async function keyboardFill(s:Session,input:Locator,value:string):Promise<void>{
 await reach(s,input);await input.click();expect(await input.evaluate(e=>document.activeElement===e)).toBe(true);
 await s.page.keyboard.press('ControlOrMeta+A');await s.page.keyboard.insertText(value);await s.page.keyboard.press('Tab');await paintFrames(s.page);
 expect(await input.inputValue()).toBe(value);
}
function groupCard(s:Session,name:string):Locator{return main(s).getByText(name,{exact:true}).locator('..').locator('..').locator('..');}
describe.each(MATRIX)('AP full Dashboard groups $theme $width x $height',entry=>{
 it('create controls, permission state and empty-group feedback remain readable and operable without submitting a group',async():Promise<void>=>{
  // Break caught: undersized actions, missing form labels/state, overflow or a non-disableable empty create form.
  await withSession(entry,'empty',async(s:Session):Promise<void>=>{
   await navigateGroups(s);await noHorizontalOverflow(s);
   const refresh=main(s).getByRole('button',{name:'刷新',exact:true});await reach(s,refresh);
   const name=main(s).getByRole('textbox',{name:'分组名称',exact:true});
   const quota=main(s).getByRole('spinbutton',{name:'积分配额',exact:true});
   expect(await name.count(),'new-group name has a real label').toBe(1);expect(await quota.count()).toBe(1);
   const canvas=main(s).getByRole('button',{name:'无限画布',exact:true});const chat=main(s).getByRole('button',{name:'智能对话',exact:true});
   await reach(s,name);await reach(s,quota);await reach(s,canvas);await reach(s,chat);
   expect(await canvas.getAttribute('aria-pressed')).toBe('true');expect(await chat.getAttribute('aria-pressed')).toBe('false');
   await activate(s,chat);expect(await chat.getAttribute('aria-pressed')).toBe('true');
   await activate(s,canvas);expect(await canvas.getAttribute('aria-pressed')).toBe('false');
   const create=main(s).getByRole('button',{name:'创建',exact:true});expect(await create.isDisabled()).toBe(true);
   await keyboardFill(s,name,'AP新分组');await keyboardFill(s,quota,'125');expect(await create.isEnabled()).toBe(true);await reach(s,create);
   await keyboardFill(s,name,'');expect(await create.isDisabled()).toBe(true);
   await readable(s,main(s).getByText('暂无分组，请创建第一个分组',{exact:true}));await capture(s,'empty-create-controls');
   s.step=1;await activate(s,refresh);await settle(s);await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('long/disabled group cards support labelled edit, native inputs and cancel/delete-dialog dismissal without mutation',async():Promise<void>=>{
  // Break caught: overflowed group cards/inline editor, inaccessible icon actions, lost permission state or cancellation.
  await withSession(entry,'groups',async(s:Session):Promise<void>=>{
   await navigateGroups(s);await noHorizontalOverflow(s);
   const card=groupCard(s,'AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出');
   const edit=card.getByRole('button',{name:'编辑分组：AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出',exact:true});
   expect(await edit.count(),'group edit icon has an accessible name').toBe(1);await activate(s,edit);
   const name=main(s).getByRole('textbox',{name:'分组名称（编辑）',exact:true});const quota=main(s).getByRole('spinbutton',{name:'积分配额（编辑）',exact:true});
   expect(await name.inputValue()).toBe('AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出');expect(await quota.inputValue()).toBe('123456789');
   await keyboardFill(s,name,'AP修改但取消');await keyboardFill(s,quota,'234');
   const canvas=main(s).getByRole('button',{name:'画布',exact:true});const chat=main(s).getByRole('button',{name:'对话',exact:true});
   expect(await canvas.getAttribute('aria-pressed')).toBe('true');expect(await chat.getAttribute('aria-pressed')).toBe('true');
   await activate(s,chat);expect(await chat.getAttribute('aria-pressed')).toBe('false');
   await reach(s,main(s).getByRole('button',{name:'保存',exact:true}));await noHorizontalOverflow(s);await capture(s,'inline-edit-unsaved');
   await activate(s,main(s).getByRole('button',{name:'取消编辑分组：AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出',exact:true}));
   expect(await main(s).getByRole('textbox',{name:'分组名称（编辑）',exact:true}).count()).toBe(0);
   expect(await main(s).getByText('AP修改但取消',{exact:true}).count()).toBe(0);
   const original=groupCard(s,'AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出');
   await readable(s,original.getByText('积分配额：123456789',{exact:true}));
   await activate(s,original.getByRole('button',{name:'删除分组：AP合成长分组名称_ABCDEFGHIJKLMN_移动端不应溢出',exact:true}));
   const dialog=s.page.getByRole('dialog',{name:'删除分组',exact:true});expect(await dialog.count()).toBe(1);await readable(s,dialog.getByText('删除分组',{exact:true}));
   await reach(s,dialog.getByRole('button',{name:'关闭删除分组',exact:true}));await reach(s,dialog.getByRole('button',{name:'确定',exact:true}));
   await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));expect(await s.page.getByRole('dialog').count()).toBe(0);
   const disabled=groupCard(s,'AP停用分组');await readable(s,disabled.getByText('已停用',{exact:true}),true);await readable(s,disabled.getByText('未设置',{exact:true}),true);
   await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('unbroken group names remain fully readable inside the open deletion confirmation without submission',async():Promise<void>=>{
  // Break caught: a full, unspaced user group name overflows the confirmation body even though the title and buttons fit.
  await withSession(entry,'groups',async(s:Session):Promise<void>=>{
   await navigateGroups(s);await noHorizontalOverflow(s);
   const card=groupCard(s,LONG_GROUP_NAME);
   await activate(s,card.getByRole('button',{name:'删除分组：'+LONG_GROUP_NAME,exact:true}));
   const dialog=s.page.getByRole('dialog',{name:'删除分组',exact:true});expect(await dialog.count()).toBe(1);
   const message=dialog.locator('p');expect(await message.count()).toBe(1);
   expect(await message.textContent(), 'full user group identity is never shortened to hide overflow').toContain(LONG_GROUP_NAME);
   await readable(s,message);await noHorizontalOverflow(s);await capture(s,'unbroken-name-confirmation');
   await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));
   expect(await s.page.getByRole('dialog').count()).toBe(0);await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);

});
