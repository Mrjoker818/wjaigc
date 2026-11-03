// AV real Dashboard/Data/CSS. Exact synthetic GETs never reach a server.
import { readFile, mkdir } from 'node:fs/promises';

import { createHash } from 'node:crypto';

import path from 'node:path';

import { compile } from 'tailwindcss';

import { Scanner } from '@tailwindcss/oxide';

import {
  chromium, type Browser, type BrowserContext, type Page, type Locator,
  type Request, type Route, type WebSocketRoute,
} from '@playwright/test';

import {beforeAll,afterAll,expect} from 'vitest';

type Theme = 'gold' | 'mono';

export interface MatrixEntry { theme: Theme; width: number; height: number }

interface Rect { x: number; y: number; width: number; height: number }

export interface UiState {
  theme: Theme | null; userId: string; toasts: string[]; clipboardWrites:string[]; storageFaults:string[]; persistenceFaults:string[];
  mounts: number; unmounts: number; mounted: boolean; disposed: boolean;
}

interface FixtureWindow extends Window {
  avDashboard: { state: UiState; mount(theme: Theme): void; unmount(): void; probePersistenceRejection():string };
}

interface Deferred {
  promise: Promise<void>; resolve(): void; settled: boolean;
}

export interface Session {
  downloadObserved: number;
  downloadReceipts: Array<{url:string;filename:string;bytes:number;sha256:string;text:string}>;
  expectedHttpConsole: Map<string, { status: number; expected: number; observed: number }>;
  resourceConsoleReceipts: Array<{ url: string; status: number; text: string }>;
  context: BrowserContext; page: Page; kind: NativePlan['kind']; plan:NativePlan; step: number; closing: boolean;
  faults: string[]; blockedHttp: number; blockedWs: number;
  counts: Map<string, number>; handlers: Set<Promise<void>>;
  seen: Set<Request>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  waiters: Set<() => void>; initialArrived: Deferred; paymentArrived: Deferred; releaseRefresh: Deferred;
  readHolds: Record<'old' | 'new', { arrived: Deferred; release: Deferred }>;
  contextClosed: boolean; pageClosed: boolean; disposePromise?: Promise<void>; wheels: number;
}

export interface ReadReply {count:number;body:unknown;status?:number;requestBody?:unknown;hold?:boolean|'old'|'new'}
export interface NativePlan {kind:'data';steps:readonly Readonly<Record<string,ReadReply>>[];downloadCounts?:readonly number[]}

interface Geometry {
  name: string; rect: Rect; clear: boolean; glyphs: boolean; horizontal: boolean;
  cjkHorizontal: boolean; singleLine: boolean; iconsFit: boolean;
  iconsSeparate: boolean; fiveHits: boolean; font: number; disabled: boolean;
  trace: Array<Record<string, unknown>>;
}

interface ButtonLayout {
  name: string | undefined; rect: Rect; font: string; selected: string | null; class: string;
}

export const ORIGIN = 'https://data-manager-av-fixture.invalid';

const USER_ID = 'av-admin';

export const MATRIX = [
  { theme: 'gold', width: 320, height: 640 },
  { theme: 'gold', width: 640, height: 320 },
  { theme: 'mono', width: 320, height: 640 },
  { theme: 'mono', width: 640, height: 320 },
] as const satisfies readonly MatrixEntry[];

const SHELL = 'dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden';

const MAIN = 'dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0';









const PERSISTENCE_BOUNDARY = "export const avPersistenceFaults=[];const manager=new Proxy({getProjects(){return [];},getUsageStats(){return [];}},{get(target,key){if(Object.hasOwn(target,key))return Reflect.get(target,key);const code='AV_FORBIDDEN_PERSISTENCE_'+String(key);avPersistenceFaults.push(code);throw Error(code);}});export const UserManager={getInstance(){return manager;}};";

const ENTRY = String.raw`
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import DashboardView from '@/components/dashboard/dashboard-view';
import {Toaster} from '@/components/ui/sonner';
import {UserManager,avPersistenceFaults} from '@/lib/user-manager';
import type {User} from '@/lib/user-types';
type Theme='gold'|'mono';
const state={theme:null as Theme|null,userId:'av-admin',toasts:[] as string[],clipboardWrites:[] as string[],storageFaults:[] as string[],persistenceFaults:avPersistenceFaults as string[],mounts:0,unmounts:0,mounted:false,disposed:false};
const host=document.getElementById('av-root');if(!host)throw Error('AV_HOST_REQUIRED');
let root:Root|undefined;
const forbidden=(kind:string):never=>{throw Error('AV_UNEXPECTED_CALLBACK_'+kind);};
Object.assign(window,{avDashboard:{state,
 probePersistenceRejection():string{try{Reflect.get(UserManager.getInstance(),'saveProject');return 'not-rejected';}catch(error){return String(error);}},
 mount(theme:Theme):void{
  if(state.mounts||state.disposed||localStorage.length||sessionStorage.length||document.cookie)throw Error('AV_FRESH_MOUNT_REQUIRED');
  const denied=(code:string):never=>{state.storageFaults.push(code);throw Error(code);};
  Storage.prototype.setItem=function():never{return denied('AV_FORBIDDEN_STORAGE_SET');};
  Storage.prototype.removeItem=function():never{return denied('AV_FORBIDDEN_STORAGE_REMOVE');};
  Storage.prototype.clear=function():never{return denied('AV_FORBIDDEN_STORAGE_CLEAR');};
  state.theme=theme;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
  const user={id:'av-admin',name:'AV合成管理员',password:'',role:'admin',status:'active',createdAt:1,updatedAt:1,productType:'canvas'} satisfies User;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string):Promise<void>=>{state.clipboardWrites.push(value);}}});
  root=createRoot(host);state.mounts++;state.mounted=true;
  root.render(<><DashboardView user={user} isMonochrome={theme==='mono'} onOpenProject={()=>forbidden('project')} onNewProject={()=>forbidden('new')} onLogout={()=>forbidden('logout')}/><Toaster position="top-center" toastOptions={{className:theme==='mono'?'bg-white border border-gray-200 text-gray-900 shadow-lg shadow-gray-200/50':'bg-[#1a1a1a] border border-[#2a2a2a] text-white shadow-lg shadow-black/30',style:{borderRadius:'12px',fontSize:'13px'}}}/></>);
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
  if (previous && previous.sha256 !== hash) throw Error('AV_INPUT_CHANGED ' + absolute);
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
  if (typeof process.getBuiltinModule !== 'function') throw Error('AV_INSTALLED_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await bindBytes('tsconfig.json');
  await bindBytes('src/lib/user-manager.ts');
  await bindBytes('src/components/canvas-workspace.tsx');
  const built = await build({
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', write: false,
    bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'av-dashboard-entry.tsx' },
    plugins: [{ name: 'at-bind-actual-input-bytes', setup(api): void {
      api.onResolve({filter:/^@\/lib\/user-manager$/},()=>({path:'av-local-persistence',namespace:'av-boundary'}));
      api.onLoad({filter:/.*/,namespace:'av-boundary'},()=>({contents:PERSISTENCE_BOUNDARY,loader:'js'}));
      api.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path);
        const loader: import('esbuild').Loader = extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts'
          : extension === '.jsx' ? 'jsx' : extension === '.json' ? 'json' : 'js';
        return { contents: await bindBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AV_SINGLE_IN_MEMORY_BUNDLE_REQUIRED');
  javascript = built.outputFiles[0].text;
  expect(Object.keys(built.metafile.inputs).filter(file => file.startsWith('av-boundary:'))).toEqual(['av-boundary:av-local-persistence']);
  const filenames = Object.keys(built.metafile.inputs).filter((file: string): boolean => file !== 'av-dashboard-entry.tsx' && file !== 'av-boundary:av-local-persistence');
  for (const required of ['src/components/dashboard/dashboard-view.tsx', 'src/components/dashboard/data-manager-tab.tsx', 'src/components/ui/sheet.tsx', 'src/components/ui/dialog.tsx', 'src/components/ui/alert-dialog.tsx', 'src/components/ui/sonner.tsx']) {
    if (!filenames.some((file: string): boolean => path.resolve(file) === path.resolve(required))) throw Error('AV_REAL_INPUT_REQUIRED ' + required);
  }
  const scan: Array<{ content: string; extension: string }> = [{ content: ENTRY, extension: 'tsx' }];
  for (const filename of filenames) {
    const input = inputs.get(path.resolve(filename)); if (!input) throw Error('AV_UNBOUND_INPUT ' + filename);
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
      if (/^(?:https?:|\/\/)/.test(id)) throw Error('AV_NO_REMOTE_STYLESHEETS');
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
        : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: filename, base: path.dirname(filename), content: (await bindBytes(filename)).toString('utf8') };
    },
  });
  stylesheet = compiler.build(new Scanner({}).scanFiles(scan));
  compiledVersion = version(); await unchangedInputs();
  console.log('AV_COMPILED_PROVENANCE', JSON.stringify({ version: compiledVersion,
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
      timer = setTimeout((): void => reject(Error('AV_BOUND_EXCEEDED ' + name)), 2500);
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

export async function ui(s: Session): Promise<UiState> {
  return await s.page.evaluate((): UiState => {
    const state = (window as unknown as FixtureWindow).avDashboard.state;
    return { ...state, toasts: [...state.toasts] };
  });
}

async function noCredentialsOrStorage(s: Session): Promise<void> {
  expect((await ui(s)).storageFaults, 'storage attempts remain fatal even if caught').toEqual([]);
  expect((await ui(s)).persistenceFaults, 'persistence attempts remain fatal even if caught').toEqual([]);
  expect(await s.context.cookies(), 'fresh context never acquires cookies').toEqual([]);
  expect(await s.page.evaluate((): { local: number; session: number; cookie: string } => ({
    local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
  }))).toEqual({ local: 0, session: 0, cookie: '' });
}

function expectedCounts(s:Session):Array<[string,number]>{
 const replies=s.plan.steps[s.step];if(!replies)throw Error('AV_EXACT_STEP_REQUIRED');
 return [['GET '+ORIGIN+'/',1],['GET '+ORIGIN+'/av.js',1],['GET '+ORIGIN+'/av.css',1],
 ...Object.entries(replies).map(([key,reply]):[string,number]=>{const m=key.match(/^(GET|POST|PATCH|DELETE) (\/.*)$/);return [m?m[1]+' '+ORIGIN+m[2]:'GET '+ORIGIN+key,reply.count];})];
}

export async function quiet(s: Session): Promise<void> {
  await paintFrames(s.page); await drain(s); await noCredentialsOrStorage(s);
  expect((await ui(s)).toasts, 'callback log only; not real Toast acceptance').toEqual([]);
  expect([...s.counts].sort(([a], [b]): number => a.localeCompare(b))).toEqual(
    expectedCounts(s).sort(([a], [b]): number => a.localeCompare(b)));
  for (const receipt of s.expectedHttpConsole.values()) expect(receipt.observed, 'exact owned HTTP resource console count').toBe(receipt.expected);
  expect(s.resourceConsoleReceipts.length).toBe([...s.expectedHttpConsole.values()].reduce((n, r) => n + r.expected, 0));
  expect(s.downloadObserved).toBe(s.plan.downloadCounts?.[s.step]??0);
  expect(s.downloadReceipts.length).toBe(s.downloadObserved);
  expect(s.faults).toEqual([]); expect(s.blockedHttp).toBe(0); expect(s.blockedWs).toBe(0);
}

async function deny(s: Session, route: Route, detail: string): Promise<void> {
  s.blockedHttp++; s.faults.push(detail);
  try { await route.abort('blockedbyclient'); } catch (error) { s.faults.push('AV_ABORT_FAILED ' + String(error)); }
}

async function dispatch(s: Session, route: Route): Promise<void> {
  const request = route.request(), key = request.method() + ' ' + request.url();
  const ordinal = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, ordinal);
  try {
    const url = new URL(request.url()), headers = await request.allHeaders();
    const credentialHeader = Object.keys(headers).some((name: string): boolean => /authorization|cookie|token|secret|key|credential/i.test(name));
    if (s.closing || url.origin !== ORIGIN || url.username || url.password || url.hash
      || credentialHeader
      || request.frame() !== s.page.mainFrame()) throw Error('AV_FORBIDDEN_REQUEST ' + key);
    const resource = request.resourceType();
    if (request.method()!=='GET') throw Error('AV_FORBIDDEN_METHOD');
    if(request.method()==='GET'&&request.postData()!==null)throw Error('AV_GET_WITH_BODY');
    if (request.method()==='GET' && url.pathname === '/' && !url.search && ordinal === 1 && resource === 'document' && request.isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/av.css"><script src="/av.js" defer></script></head><body><div id="av-root"></div></body></html>' });
      return;
    }
    if (request.method()==='GET' && !url.search && ordinal === 1 && url.pathname === '/av.js' && resource === 'script') {
      await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: javascript }); return;
    }
    if (request.method()==='GET' && !url.search && ordinal === 1 && url.pathname === '/av.css' && resource === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css; charset=utf-8', body: stylesheet }); return;
    }
    if (!['fetch', 'xhr'].includes(resource) || request.isNavigationRequest()) throw Error('AV_UNKNOWN_RESOURCE ' + key);
    const entries=s.plan.steps[s.step];
    const reply=entries?.[request.method()+' '+url.pathname+url.search] ?? (request.method()==='GET'?entries?.[url.pathname+url.search]:undefined);
    if(!reply||ordinal>reply.count)throw Error('AV_UNKNOWN_OR_EXTRA_GET '+key);
    if(reply.requestBody!==undefined)throw Error('AV_GET_EXPECTED_BODY');
    if (reply.hold === 'old' || reply.hold === 'new') {
      const owned = s.readHolds[reply.hold]; owned.arrived.resolve(); await owned.release.promise;
    } else if(reply.hold)await s.releaseRefresh.promise;
    if (reply.status && reply.status >= 400) {
      if (reply.status !== 503 || url.pathname !== '/api/admin/user-images') throw Error('AV_ONLY_EXACT_DATA_503');
      const previous = s.expectedHttpConsole.get(url.href);
      if (previous && previous.status !== reply.status) throw Error('AV_HTTP_STATUS_DRIFT');
      s.expectedHttpConsole.set(url.href, { status: reply.status, expected: (previous?.expected ?? 0) + 1, observed: previous?.observed ?? 0 });
    }
    await route.fulfill({status:reply.status??200,json:reply.body});
    if(url.pathname==='/api/admin/groups'&&ordinal===1)s.initialArrived.resolve();
    if(url.pathname==='/api/credits/payment-config'&&ordinal===1)s.paymentArrived.resolve();return;
  } catch (error) { await deny(s, route, String(error)); }
}

function watchPage(s: Session, page: Page): void {
  page.on('pageerror', (error: Error): void => { s.faults.push('AV_PAGE_ERROR ' + error.message); });
  page.on('console', (message): void => {
    if (message.type() !== 'error') return;
    const location = message.location(), text = message.text(), owned = s.expectedHttpConsole.get(location.url);
    const exactResource = page === s.page && !s.closing && owned?.status === 503
      && owned.observed < owned.expected && location.lineNumber === 0 && location.columnNumber === 0
      && text === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
    console.log('AV_CONSOLE_OBSERVATION', JSON.stringify({text,location,exactResource}));
    if (exactResource && owned) { owned.observed++; s.resourceConsoleReceipts.push({url:location.url,status:503,text}); }
    else s.faults.push('AV_CONSOLE_ERROR ' + text);
  });
  page.on('dialog', (dialog): void => {
    s.faults.push('AV_UNEXPECTED_DIALOG');
    void track(s, 'AV_DISMISS_DIALOG', async (): Promise<void> => { await dialog.dismiss(); });
  });
  page.on('download', (download): void => {
    const allowed=s.plan.downloadCounts?.[s.step]??0,filename=download.suggestedFilename(),url=download.url();
    const exact=page===s.page&&!s.closing&&s.downloadObserved<allowed
      &&new RegExp('^blob:'+ORIGIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[0-9a-f-]{36}$').test(url)
      &&/^wujie-data-\d{4}-\d{2}-\d{2}\.json$/.test(filename);
    if(!exact){
      s.faults.push('AV_UNEXPECTED_DOWNLOAD');
      void track(s, 'AV_CANCEL_DOWNLOAD', async (): Promise<void> => { await download.cancel(); });return;
    }
    s.downloadObserved++;
    void track(s,'AV_NATIVE_JSON_DOWNLOAD',async():Promise<void>=>{
      const stream=await download.createReadStream();if(!stream)throw Error('AV_NATIVE_DOWNLOAD_STREAM');
      const chunks:Buffer[]=[];let bytes=0;
      try {
        for await(const chunk of stream){const b=Buffer.from(chunk as Uint8Array);bytes+=b.length;if(bytes>1024*1024)throw Error('AV_NATIVE_DOWNLOAD_SYNTHETIC_BYTE_LIMIT');chunks.push(b);}
        const failure=await download.failure();if(failure!==null)throw Error('AV_NATIVE_DOWNLOAD_FAILED '+failure);
        const content=Buffer.concat(chunks);JSON.parse(content.toString('utf8'));
        s.downloadReceipts.push({url,filename,bytes,sha256:sha256(content),text:content.toString('utf8')});
        console.log('AW_NATIVE_DOWNLOAD',JSON.stringify({url,filename,bytes,sha256:sha256(content)}));
      }catch(error){stream.destroy();await download.cancel();throw error;}
    });
  });
}

async function open(entry: MatrixEntry, plan: NativePlan): Promise<Session> {
  if(plan.downloadCounts&&!(plan.downloadCounts.length===plan.steps.length&&plan.downloadCounts.every(n=>n===0||n===1)))throw Error('AV_EXACT_NATIVE_DOWNLOAD_PLAN');
  await unchangedInputs(); if (!browser) throw Error('AV_BROWSER_REQUIRED');
  const context = await browser.newContext({
    viewport: { width: entry.width, height: entry.height }, reducedMotion: 'reduce', colorScheme:entry.theme==='gold'?'dark':'light',
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: Boolean(plan.downloadCounts),
  });
  contexts.add(context); let acquired: Session | undefined; let bootstrapClosed = false;
  context.once('close', (): void => { bootstrapClosed = true; });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = {
      downloadObserved:0,downloadReceipts:[],
      expectedHttpConsole: new Map(), resourceConsoleReceipts: [],
      context, page, kind:plan.kind, plan, step: 0, closing: false, faults: [], blockedHttp: 0, blockedWs: 0,
      counts: new Map(), handlers: new Set(), seen: new Set(), pending: new Set(), completed: new Set(), failed: new Set(),
      waiters: new Set(), initialArrived: deferred(), paymentArrived: deferred(), releaseRefresh: deferred(),
      readHolds: {old:{arrived:deferred(),release:deferred()},new:{arrived:deferred(),release:deferred()}},
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
      s.faults.push('AV_UNEXPECTED_PAGE'); watchPage(s, other);
      void track(s, 'AV_CLOSE_UNEXPECTED_PAGE', async (): Promise<void> => { await other.close(); });
    });
    await context.routeWebSocket('**/*', async (socket: WebSocketRoute): Promise<void> => {
      await track(s, 'AV_WS_HANDLER', async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AV_FORBIDDEN_WS ' + socket.url());
        // Never connectToServer: close at the browser transport boundary.
        await socket.close({ code: 1008, reason: 'AT isolated synthetic fixture' });
      });
    });
    await context.route('**/*', async (route: Route): Promise<void> => {
      await track(s, 'AV_HTTP_HANDLER', (): Promise<void> => dispatch(s, route));
    });
    await page.goto(ORIGIN + '/');
    await page.evaluate((theme: Theme): void => (window as unknown as FixtureWindow).avDashboard.mount(theme), entry.theme);
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
    console.log('AV_BOOTSTRAP_FAILURE', JSON.stringify({
      error: error instanceof Error ? {name:error.name,message:error.message,stack:error.stack} : String(error),
      faults: acquired?.faults ?? [], counts: acquired ? Object.fromEntries(acquired.counts) : {},
      pending: acquired?.pending.size ?? 0, handlers: acquired?.handlers.size ?? 0,
    }));
    try {
      if (acquired) await dispose(acquired);
      else {
        await bounded('bootstrap context close', async (): Promise<void> => {
          await context.close(); expect(bootstrapClosed).toBe(true); expect(context.pages()).toEqual([]);
        });
        contexts.delete(context);
      }
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AV_OPEN_AND_DISPOSAL'); }
    throw error;
  }
}

async function disposeOnce(s: Session): Promise<void> {
  const errors: unknown[] = [];
  // Release before waiting or marking the boundary closed. A failed assertion
  // can never leave the controller's synthetic refresh response suspended.
  s.releaseRefresh.resolve();
  s.readHolds.old.release.resolve(); s.readHolds.new.release.resolve();
  try {
    await bounded('release drain and final mounted paint', async (): Promise<void> => { await drain(s); await paintFrames(s.page); });
  } catch (error) { errors.push(error); }
  try {
    const result = await bounded('real React root unmount', (): Promise<{ state: UiState; empty: boolean }> =>
      s.page.evaluate((): { state: UiState; empty: boolean } => {
        const fixture = (window as unknown as FixtureWindow).avDashboard;
        if (!fixture) throw Error('AV_FIXTURE_NOT_LOADED');
        fixture.unmount();
        return { state: { ...fixture.state, toasts: [...fixture.state.toasts] },
          empty: document.getElementById('av-root')?.childElementCount === 0 };
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
    const expectedNativeRequests = expectedCounts(s).reduce((n,[,count])=>n+count,0);
    expect(s.seen.size, 'only exact owned document/assets/GETs observed').toBe(expectedNativeRequests);
    expect(s.completed.size).toBe(expectedNativeRequests); expect(s.failed.size).toBe(0);
    expect([...s.seen].every((request: Request): boolean => s.completed.has(request))).toBe(true);
    expect(s.pending.size).toBe(0); expect(s.handlers.size).toBe(0); expect(s.waiters.size).toBe(0);
    expect(s.blockedHttp, 'denied HTTP/method/header attempts remain fatal even if product catches them').toBe(0);
    expect(s.blockedWs, 'denied WS attempts remain fatal').toBe(0);
    for (const receipt of s.expectedHttpConsole.values()) expect(receipt.observed, 'owned error response resource messages closed').toBe(receipt.expected);
    expect(s.resourceConsoleReceipts.length).toBe([...s.expectedHttpConsole.values()].reduce((n, r) => n + r.expected, 0));
    expect(s.downloadObserved).toBe(s.plan.downloadCounts?.[s.step]??0);expect(s.downloadReceipts.length).toBe(s.downloadObserved);
    expect(s.faults, 'unexpected pages/downloads/dialogs/errors remain fatal').toEqual([]);
  } catch (error) { errors.push(error); }
  if (s.contextClosed) { contexts.delete(s.context); sessions.delete(s); }
  if (errors.length) throw new AggregateError(errors, 'AV_DISPOSAL');
}

async function dispose(s: Session): Promise<void> {
  // Cached promise prevents repeated unmount, route release or close operations.
  s.disposePromise ??= disposeOnce(s); await s.disposePromise;
}

export async function heldRead(s: Session, name: 'old' | 'new'): Promise<void> {
  await bounded('exact held data GET arrives '+name, (): Promise<void> => s.readHolds[name].arrived.promise);
}

// Transparent, local-only observation: delegate the original json parser and
// every property read unchanged. No setter interception, state injection or
// production-source rewrite. Validation reads the three root DTO fields; an
// accepted success additionally reads them for the three actual state setters.
export interface JsonReadReceipt { url: string; reads: string[] }
interface JsonObservedWindow extends Window { avJsonReads?: JsonReadReceipt[] }
export async function observeJsonReads(s: Session): Promise<void> {
  await s.page.evaluate((): void => {
    const target = window as JsonObservedWindow;
    if (target.avJsonReads) throw Error('AV_JSON_OBSERVER_ALREADY_INSTALLED');
    target.avJsonReads = [];
    const original = Response.prototype.json;
    Response.prototype.json = async function(this: Response): Promise<unknown> {
      const value: unknown = await original.call(this);
      if (new URL(this.url).origin !== location.origin || new URL(this.url).pathname !== '/api/admin/user-images'
        || typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      const receipt: JsonReadReceipt = {url:this.url,reads:[]}; target.avJsonReads!.push(receipt);
      return new Proxy(value, {get(object: object, key: string | symbol, receiver: unknown): unknown {
        if (typeof key === 'string' && ['images','total','stats'].includes(key)) receipt.reads.push(key);
        return Reflect.get(object,key,receiver);
      }});
    };
  });
}
export async function jsonReads(s: Session): Promise<JsonReadReceipt[]> {
  return await s.page.evaluate((): JsonReadReceipt[] => {
    const value = (window as JsonObservedWindow).avJsonReads;
    if (!value) throw Error('AV_JSON_OBSERVER_NOT_INSTALLED');
    return value.map(r=>({url:r.url,reads:[...r.reads]}));
  });
}

let captureIndex = 0;

export async function capture(s: Session, label: string): Promise<void> {
  const directory = path.resolve('output/playwright/data-manager-av-native-20261019', String(process.pid));
  await mkdir(directory, { recursive: true });
  const state = await ui(s);
  const size = s.page.viewportSize();
  const filename = path.join(directory, `${state.theme}-${size?.width}x${size?.height}-${++captureIndex}-${label}.png`);
  if (label === 'failure-state') console.log('AV_FAILURE_LAYOUT', JSON.stringify(await s.page.locator('#av-root button').evaluateAll((elements: Element[]): ButtonLayout[] => elements.map((element: Element): ButtonLayout => {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { name: element.textContent?.trim(), rect: { x: box.x, y: box.y, width: box.width, height: box.height }, font: css.fontSize, selected: element.getAttribute('aria-pressed'), class: element.className };
  }))));
  await s.page.screenshot({ path: filename });
  console.log('AV_CAPTURE', JSON.stringify({ path: filename, label, inputVersion: compiledVersion }));
}

export async function withSession(entry: MatrixEntry, plan: NativePlan, scenario: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(entry, plan); let original: unknown; let failed = false;
  try { await quiet(s); await scenario(s); await capture(s, 'end-state'); } catch (error) { original = error; failed = true; try { await capture(s, 'failure-state'); } catch (captureError) { original = new AggregateError([error, captureError], 'AV_FAILURE_AND_CATTURE'); } }
  try { await dispose(s); }
  catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], 'AV_SCENARIO_AND_DISPOSAL'); throw cleanup; }
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
  if (errors.length) throw new AggregateError(errors, 'AV_FINAL_DISPOSAL');
}, 15000);

export function main(s: Session): Locator { return s.page.locator('main.dashboard-scrollable'); }

// Synthetic geometry calibration only, never a substitute for a production render.
export async function withGeometryCalibration(entry: MatrixEntry, work: (page: Page) => Promise<void>): Promise<void> {
  if (!browser) throw Error('AV_BROWSER_REQUIRED');
  const context = await browser.newContext({viewport:{width:entry.width,height:entry.height},serviceWorkers:'block',acceptDownloads:false});
  contexts.add(context); const faults: string[] = []; let closed = false;
  context.once('close', ():void => {closed=true;});
  try {
    await context.route('**/*', async(route:Route):Promise<void> => {faults.push('AV_CALIBRATION_HTTP');await route.abort('blockedbyclient');});
    await context.routeWebSocket('**/*', async(socket:WebSocketRoute):Promise<void> => {faults.push('AV_CALIBRATION_WS');await socket.close({code:1008,reason:'isolated calibration'});});
    const page=await context.newPage();
    page.on('pageerror', (error:Error):void => {faults.push(error.message);});
    page.on('download', ():void => {faults.push('AV_CALIBRATION_DOWNLOAD');});
    page.on('dialog', ():void => {faults.push('AV_CALIBRATION_DIALOG');});
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{box-sizing:border-box;width:120px;height:44px;font:16px sans-serif}#clip{position:absolute;left:8px;top:70px;width:300px;height:100px;overflow:hidden}#viewport-fixed{position:fixed;left:8px;top:8px}#normal-clipped{position:absolute;left:160px;top:-62px}#transform-clip{position:absolute;left:8px;top:190px;width:300px;height:60px;overflow:hidden;transform:translateZ(0)}#fixed-clipped{position:fixed;left:0;top:-50px}#occluded{position:absolute;left:8px;top:82px}#cover{position:absolute;left:8px;top:82px;width:120px;height:44px;background:black;z-index:2}</style></head><body><div id="clip"><button id="viewport-fixed">Fixed<svg width="12" height="12"><path d="M0 0L12 12"/></svg></button><button id="normal-clipped">Clipped</button></div><div id="transform-clip"><button id="fixed-clipped">Fixed clipped</button></div><button id="occluded">Covered</button><div id="cover"></div></body></html>');
    await work(page); expect(faults).toEqual([]); expect(await context.cookies()).toEqual([]);
  } finally {
    await bounded('calibration context close', async():Promise<void> => {await context.close();expect(closed).toBe(true);expect(context.pages()).toEqual([]);});
    contexts.delete(context);
  }
}

async function rect(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox(); if (!value) throw Error('AV_RENDERED_RECT_REQUIRED'); return value;
}

export async function geometry(locator: Locator): Promise<Geometry> {
  return await locator.evaluate((element: Element): Geometry => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    const clips = (box: DOMRect, start: Element | null, subject: Element = start ?? element): boolean => {
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight, opacity = 1;
      // A viewport-fixed descendant escapes overflow ancestors outside its
      // containing block. Transformed/contained fixed descendants do not.
      const outsideFixedBlock = new Set<Element>();
      let fixed: Element | null = subject;
      while (fixed && getComputedStyle(fixed).position !== 'fixed') fixed = fixed.parentElement;
      if (fixed) {
        for (let ancestor=fixed.parentElement;ancestor;ancestor=ancestor.parentElement) {
          const css=getComputedStyle(ancestor);
          if (css.transform !== 'none' || css.perspective !== 'none' || css.filter !== 'none'
            || (css.backdropFilter && css.backdropFilter !== 'none')
            || /(?:layout|paint|strict|content)/.test(css.contain)
            || /(?:transform|perspective|filter)/.test(css.willChange)) break;
          outsideFixedBlock.add(ancestor);
        }
      }
      for (let ancestor = start; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), a = ancestor.getBoundingClientRect(); opacity *= Number(css.opacity);
        if (css.display === 'none' || css.visibility !== 'visible') return false;
        if (!outsideFixedBlock.has(ancestor) && /^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
          left = Math.max(left, a.left + ancestor.clientLeft); right = Math.min(right, a.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (!outsideFixedBlock.has(ancestor) && /^(auto|scroll|hidden|clip)$/.test(css.overflowY)) {
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
        const assistive = parent.closest('.sr-only');
        if (assistive) {
          const css = getComputedStyle(assistive);
          if (css.position === 'absolute' && assistive.clientWidth <= 1 && assistive.clientHeight <= 1
            && css.overflow === 'hidden' && css.clip !== 'auto') continue;
        }
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
      clear: Number(own.opacity) > 0 && own.display !== 'none' && own.visibility === 'visible' && clips(r, element.parentElement, element),
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

export async function visible(locator: Locator, oneLine = false): Promise<Geometry> {
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

export async function reveal(s: Session, locator: Locator): Promise<void> {
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
    return !/立即充值|请选择充值套餐|创建订单|完成付|确认付|查询订单|打开.*支付|扫码完成支付/.test(text); // gateway actions still require exact synthetic transport plan
  });
  expect(permitted, 'only pre-order choice/header/filter/input/close native activation allowed').toBe(true);
}

export async function activate(s: Session, locator: Locator, oneLine = true, alreadyVisible = false): Promise<void> {
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
    for (const element of document.querySelectorAll('#av-root *,[data-slot=sheet-content] *,[data-slot=dialog-content] *,[data-slot=alert-dialog-content] *')) {
      if (!(element instanceof HTMLElement) || element.matches('input,select,textarea')) continue;
      const r = element.getBoundingClientRect(), css = getComputedStyle(element);
      if (!r.width || !r.height || css.display === 'none') continue;
      if (element.matches('.sr-only') && css.position === 'absolute' && element.clientWidth <= 1
        && element.clientHeight <= 1 && css.overflow === 'hidden' && css.clip !== 'auto') continue;
      const localTable = element.closest('[role="region"][aria-label="操作日志列表，可横向滚动"]');
      if (localTable && localTable !== element) continue;
      if (r.left < -0.5 || r.right > innerWidth + 0.5) result.push(element.tagName + ':outside-viewport:' + element.className);
      // Checking scrollWidth even on overflow:hidden/clip rejects a fix which
      // merely conceals clipped controls, financial values or descriptions.
      if (!localTable && element.scrollWidth > element.clientWidth + 1) result.push(element.tagName + ':hidden-horizontal-content:' + element.className);
    }
    return result;
  });
  expect(bad, 'actual layout has no horizontal content concealed by clipping').toEqual([]);
}

export async function settle(s:Session):Promise<void>{await paintFrames(s.page);await drain(s);await paintFrames(s.page);}

// Detached one-pixel color compositing reads actual computed solid surfaces;
// it never adds DOM/CSS, fabricates text, or restyles the product under test.
export async function contrast(locator:Locator):Promise<number>{
  return await locator.evaluate((element:Element):number=>{
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('AV_COLOR_CANVAS_REQUIRED');
    const ancestors:Element[]=[];for(let at:Element|null=element;at;at=at.parentElement)ancestors.push(at);
    context.fillStyle='#fff';context.fillRect(0,0,1,1);
    for(const ancestor of ancestors.reverse()){
      const css=getComputedStyle(ancestor);if(css.backgroundImage!=='none')throw Error('AV_CONTRAST_SOLID_SURFACES_ONLY');
      context.fillStyle=css.backgroundColor;context.fillRect(0,0,1,1);
    }
    const background=context.getImageData(0,0,1,1).data;
    context.fillStyle=getComputedStyle(element).color;context.fillRect(0,0,1,1);
    const foreground=context.getImageData(0,0,1,1).data;
    const luminance=(rgba:Uint8ClampedArray):number=>{
      const values=Array.from(rgba.slice(0,3)).map((v:number):number=>{const x=v/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;});
      return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
    };
    const a=luminance(background),b=luminance(foreground);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  });
}

