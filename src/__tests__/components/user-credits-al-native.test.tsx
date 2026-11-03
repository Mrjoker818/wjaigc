// @vitest-environment node
// AL integrated isolated native component checks; original OWN proposal retained.
// Run only in the controller's original serial guard; not cloud/device evidence.
// Eight product cases: four literal matrix entries, two independent scenarios.
// No helpers-only cases, snapshots-as-behavior, production edits, order requests,
// payment activation, credentials, installed software changes or remote assets.
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
  alCredits: { state: UiState; mount(theme: Theme): void; unmount(): void };
}
interface Deferred {
  promise: Promise<void>; resolve(): void; settled: boolean;
}
interface Session {
  context: BrowserContext; page: Page; refreshed: boolean; refreshArmed: boolean; closing: boolean;
  faults: string[]; blockedHttp: number; blockedWs: number;
  counts: Map<string, number>; handlers: Set<Promise<void>>;
  seen: Set<Request>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>;
  waiters: Set<() => void>; refreshArrived: Deferred; releaseRefresh: Deferred;
  refreshTransactions: Deferred; contextClosed: boolean; pageClosed: boolean;
  disposePromise?: Promise<void>; wheels: number;
}
interface Geometry {
  name: string; rect: Rect; clear: boolean; glyphs: boolean; horizontal: boolean;
  cjkHorizontal: boolean; singleLine: boolean; iconsFit: boolean;
  iconsSeparate: boolean; fiveHits: boolean; font: number; disabled: boolean;
  trace: Array<Record<string, unknown>>;
}
interface RowExpectation {
  description: string; amount: string; balance: string; date: string;
}
interface Paint {
  border: string; background: string; shadow: string; borderWidth: number;
}
interface ButtonLayout {
  name: string | undefined; rect: Rect; font: string; selected: string | null; class: string;
}
interface PackageExpectation {
  amount: string; bonusOnTile: string | null; priceOnTile: string;
  preview: string; bonusInPreview: string | null; due: string; submit: string;
}

const ORIGIN = 'https://user-credits-al-fixture.invalid';
const USER_ID = 'al-credits-user';
const MATRIX = [
  { theme: 'gold', width: 320, height: 640 },
  { theme: 'gold', width: 640, height: 320 },
  { theme: 'mono', width: 320, height: 640 },
  { theme: 'mono', width: 640, height: 320 },
] as const satisfies readonly MatrixEntry[];
const SHELL = 'dashboard-root h-dvh md:h-screen w-screen flex flex-col md:flex-row overflow-hidden';
const MAIN = 'dashboard-scrollable flex-1 min-w-0 min-h-0 [&_h1]:shrink-0 [&_button]:whitespace-nowrap [&_button>svg]:shrink-0';

// Hand-checked synthetic fixtures, never imported from production calculators.
// 987654321012 - 864197532000 = 123456789012; refresh adds 10.
// A limited history need not equal lifetime totals. Its running balances do:
// 135802566896 + 345678901234 = 481481468130; +17 = 481481468147;
// -123456789012 = 358024679135; -234567890123 = 123456789012.
const INITIAL_CREDITS = {
  success: true,
  credits: { userId: 'al-credits-user', balance: 123456789012, totalRecharged: 987654321012, totalUsed: 864197532000 },
  pricing: {
    creditsToCNY: 0.01, cnyToCredits: 100,
    // Explicit unused pricing catalog subset: this component never reads it.
    // No provider IDs, models, credentials or external resources are supplied.
    imageModels: {}, videoModels: {}, chatModels: {},
    rechargePackages: [
      { amount: 100, bonus: 0, price: 1, label: '100积分' },
      { amount: 500, bonus: 25, price: 5, label: '500+25积分' },
      { amount: 1000, bonus: 100, price: 10, label: '1000+100积分', popular: true },
      { amount: 5000, bonus: 800, price: 50, label: '5000+800积分' },
      { amount: 10000, bonus: 2000, price: 100, label: '10000+2000积分' },
      { amount: 50000, bonus: 12000, price: 500, label: '50000+12000积分' },
    ],
  },
};
const REFRESHED_CREDITS = {
  ...INITIAL_CREDITS,
  credits: { userId: 'al-credits-user', balance: 123456789022, totalRecharged: 987654321022, totalUsed: 864197532000 },
};
const INITIAL_TRANSACTIONS = {
  success: true,
  transactions: [
    { id: 'al-spend', type: 'spend', amount: -234567890123, balanceAfter: 123456789012,
      description: 'AL图像生成支出长中文说明用于验证真实交易内容不会挤压金额与图标ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      createdAt: '2026-10-19T02:14:00.000Z' },
    { id: 'al-adjust', type: 'admin_adjust', amount: -123456789012, balanceAfter: 358024679135,
      description: 'AL历史管理员扣减', createdAt: '2026-10-19T02:13:00.000Z' },
    { id: 'al-bonus', type: 'daily_bonus', amount: 17, balanceAfter: 481481468147,
      description: 'AL每日奖励', createdAt: '2026-10-19T02:12:00.000Z' },
    { id: 'al-earned', type: 'earn', amount: 345678901234, balanceAfter: 481481468130,
      description: 'AL积分收入长中文说明用于验证真实交易内容不会变成竖排或被静默裁切ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      createdAt: '2026-10-19T02:11:00.000Z' },
  ],
};
const REFRESHED_TRANSACTIONS = {
  success: true,
  transactions: [
    { id: 'al-refresh-bonus', type: 'daily_bonus', amount: 10, balanceAfter: 123456789022,
      description: 'AL刷新后新增积分', createdAt: '2026-10-19T02:15:00.000Z' },
    ...INITIAL_TRANSACTIONS.transactions,
  ],
};
const PAYMENT_STATUS = {
  success: true, canRecharge: true, methods: ['wechat', 'alipay'],
  qrUrls: { wechat: '', alipay: '' }, payLinks: { wechat: '', alipay: '' },
  note: 'AL合成收款状态，仅验证下单前选择器', status: { wechat: true, alipay: true },
};
// Independent literal UI expectations: no .filter(amount), locale formatting,
// exchange-rate multiplication or RECHARGE_PACKAGES-derived expected values.
const SPEND: RowExpectation = {
  description: 'AL图像生成支出长中文说明用于验证真实交易内容不会挤压金额与图标ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  amount: '-234567890123', balance: '余额 123456789012', date: '10/19 10:14',
};
const ADJUST: RowExpectation = {
  description: 'AL历史管理员扣减', amount: '-123456789012', balance: '余额 358024679135', date: '10/19 10:13',
};
const BONUS: RowExpectation = {
  description: 'AL每日奖励', amount: '+17', balance: '余额 481481468147', date: '10/19 10:12',
};
const EARNED: RowExpectation = {
  description: 'AL积分收入长中文说明用于验证真实交易内容不会变成竖排或被静默裁切ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  amount: '+345678901234', balance: '余额 481481468130', date: '10/19 10:11',
};
const NEW_BONUS: RowExpectation = {
  description: 'AL刷新后新增积分', amount: '+10', balance: '余额 123456789022', date: '10/19 10:15',
};
const PACKAGES: readonly PackageExpectation[] = [
  { amount: '100', bonusOnTile: null, priceOnTile: '¥1', preview: '100积分', bonusInPreview: null, due: '¥1.00', submit: '立即充值 ¥1.00' },
  { amount: '500', bonusOnTile: '+赠送 25', priceOnTile: '¥5', preview: '500+25积分', bonusInPreview: '+25', due: '¥5.00', submit: '立即充值 ¥5.00' },
  { amount: '1,000', bonusOnTile: '+赠送 100', priceOnTile: '¥10', preview: '1000+100积分', bonusInPreview: '+100', due: '¥10.00', submit: '立即充值 ¥10.00' },
  { amount: '5,000', bonusOnTile: '+赠送 800', priceOnTile: '¥50', preview: '5000+800积分', bonusInPreview: '+800', due: '¥50.00', submit: '立即充值 ¥50.00' },
  { amount: '10,000', bonusOnTile: '+赠送 2,000', priceOnTile: '¥100', preview: '10000+2000积分', bonusInPreview: '+2,000', due: '¥100.00', submit: '立即充值 ¥100.00' },
  { amount: '50,000', bonusOnTile: '+赠送 12,000', priceOnTile: '¥500', preview: '50000+12000积分', bonusInPreview: '+12,000', due: '¥500.00', submit: '立即充值 ¥500.00' },
];

// The fixture owns only the host, real Dashboard shell/theme and callback log.
// No component state injection, React internals, product attributes or fake UI.
const ENTRY = String.raw`
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import UserCreditsTab from '@/components/dashboard/user-credits-tab';
type Theme='gold'|'mono';
const state={theme:null as Theme|null,userId:'al-credits-user',toasts:[] as string[],mounts:0,unmounts:0,mounted:false,disposed:false};
const host=document.getElementById('al-root');if(!host)throw Error('AL_HOST_REQUIRED');
let root:Root|undefined;
Object.assign(window,{alCredits:{state,
 mount(theme:Theme):void{
  if(state.mounts||state.disposed||localStorage.length||sessionStorage.length||document.cookie)throw Error('AL_FRESH_MOUNT_REQUIRED');
  state.theme=theme;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
  const props={isDark:theme==='gold',userId:'al-credits-user',onToast:(message:string):void=>{state.toasts.push(message);}} satisfies React.ComponentProps<typeof UserCreditsTab>;
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
  if (previous && previous.sha256 !== hash) throw Error('AL_INPUT_CHANGED ' + absolute);
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
  if (typeof process.getBuiltinModule !== 'function') throw Error('AL_INSTALLED_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  await bindBytes('tsconfig.json');
  const built = await build({
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', write: false,
    bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'al-user-credits-entry.tsx' },
    plugins: [{ name: 'al-bind-actual-input-bytes', setup(api): void {
      api.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async (args): Promise<import('esbuild').OnLoadResult> => {
        const extension = path.extname(args.path);
        const loader: import('esbuild').Loader = extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts'
          : extension === '.jsx' ? 'jsx' : extension === '.json' ? 'json' : 'js';
        return { contents: await bindBytes(args.path), loader };
      });
    } }],
  });
  if (built.outputFiles.length !== 1 || !built.metafile) throw Error('AL_SINGLE_IN_MEMORY_BUNDLE_REQUIRED');
  javascript = built.outputFiles[0].text;
  const filenames = Object.keys(built.metafile.inputs).filter((file: string): boolean => file !== 'al-user-credits-entry.tsx');
  for (const required of ['src/components/dashboard/user-credits-tab.tsx', 'src/lib/credits-constants.ts']) {
    if (!filenames.some((file: string): boolean => path.resolve(file) === path.resolve(required))) throw Error('AL_REAL_INPUT_REQUIRED ' + required);
  }
  const scan: Array<{ content: string; extension: string }> = [{ content: ENTRY, extension: 'tsx' }];
  for (const filename of filenames) {
    const input = inputs.get(path.resolve(filename)); if (!input) throw Error('AL_UNBOUND_INPUT ' + filename);
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
      if (/^(?:https?:|\/\/)/.test(id)) throw Error('AL_NO_REMOTE_STYLESHEETS');
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
        : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: filename, base: path.dirname(filename), content: (await bindBytes(filename)).toString('utf8') };
    },
  });
  stylesheet = compiler.build(new Scanner({}).scanFiles(scan));
  compiledVersion = version(); await unchangedInputs();
  console.log('AL_COMPILED_PROVENANCE', JSON.stringify({ version: compiledVersion,
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
      timer = setTimeout((): void => reject(Error('AL_BOUND_EXCEEDED ' + name)), 2500);
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
    const state = (window as unknown as FixtureWindow).alCredits.state;
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
  return [
    ['GET ' + ORIGIN + '/', 1], ['GET ' + ORIGIN + '/al.js', 1], ['GET ' + ORIGIN + '/al.css', 1],
    ['GET ' + ORIGIN + '/api/credits', s.refreshed ? 2 : 1],
    ['GET ' + ORIGIN + '/api/credits?action=transactions', s.refreshed ? 2 : 1],
    ['GET ' + ORIGIN + '/api/credits/payment-status', 1],
  ];
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
  try { await route.abort('blockedbyclient'); } catch (error) { s.faults.push('AL_ABORT_FAILED ' + String(error)); }
}
async function dispatch(s: Session, route: Route): Promise<void> {
  const request = route.request(), key = request.method() + ' ' + request.url();
  const ordinal = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, ordinal);
  try {
    const url = new URL(request.url()), headers = await request.allHeaders();
    const credentialHeader = Object.keys(headers).some((name: string): boolean => /authorization|cookie|token|secret|key|credential/i.test(name));
    if (s.closing || url.origin !== ORIGIN || url.username || url.password || url.hash
      || request.method() !== 'GET' || request.postData() !== null || credentialHeader
      || request.frame() !== s.page.mainFrame()) throw Error('AL_FORBIDDEN_REQUEST ' + key);
    const resource = request.resourceType();
    if (url.pathname === '/' && !url.search && ordinal === 1 && resource === 'document' && request.isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/al.css"><script src="/al.js" defer></script></head><body><div id="al-root"></div></body></html>' });
      return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/al.js' && resource === 'script') {
      await route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: javascript }); return;
    }
    if (!url.search && ordinal === 1 && url.pathname === '/al.css' && resource === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css; charset=utf-8', body: stylesheet }); return;
    }
    if (!['fetch', 'xhr'].includes(resource) || request.isNavigationRequest()) throw Error('AL_UNKNOWN_RESOURCE ' + key);
    if (url.pathname === '/api/credits' && !url.search && ordinal <= 2) {
      if (ordinal === 2) {
        if (!s.refreshArmed) throw Error('AL_UNEXPECTED_REFRESH ' + key);
        s.refreshed = true; s.refreshArrived.resolve();
        // A deliberately owned pending response, released by the scenario AND
        // unconditionally by disposal. No sleeps, timers or component patches.
        await s.releaseRefresh.promise;
      }
      await route.fulfill({ json: ordinal === 1 ? INITIAL_CREDITS : REFRESHED_CREDITS }); return;
    }
    if (url.pathname === '/api/credits' && url.search === '?action=transactions' && ordinal <= 2) {
      const creditRequests = s.counts.get('GET ' + ORIGIN + '/api/credits') ?? 0;
      if (creditRequests !== ordinal || (ordinal === 2 && !s.releaseRefresh.settled)) throw Error('AL_TRANSACTION_SEQUENCE ' + key);
      await route.fulfill({ json: ordinal === 1 ? INITIAL_TRANSACTIONS : REFRESHED_TRANSACTIONS });
      if (ordinal === 2) s.refreshTransactions.resolve();
      return;
    }
    if (url.pathname === '/api/credits/payment-status' && !url.search && ordinal === 1) {
      await route.fulfill({ json: PAYMENT_STATUS }); return;
    }
    throw Error('AL_UNKNOWN_HTTP ' + key);
  } catch (error) { await deny(s, route, String(error)); }
}
function watchPage(s: Session, page: Page): void {
  page.on('pageerror', (error: Error): void => { s.faults.push('AL_PAGE_ERROR ' + error.message); });
  page.on('console', (message): void => { if (message.type() === 'error') s.faults.push('AL_CONSOLE_ERROR ' + message.text()); });
  page.on('dialog', (dialog): void => {
    s.faults.push('AL_UNEXPECTED_DIALOG');
    void track(s, 'AL_DISMISS_DIALOG', async (): Promise<void> => { await dialog.dismiss(); });
  });
  page.on('download', (download): void => {
    s.faults.push('AL_UNEXPECTED_DOWNLOAD');
    void track(s, 'AL_CANCEL_DOWNLOAD', async (): Promise<void> => { await download.cancel(); });
  });
}
async function open(entry: MatrixEntry): Promise<Session> {
  await unchangedInputs(); if (!browser) throw Error('AL_BROWSER_REQUIRED');
  const context = await browser.newContext({
    viewport: { width: entry.width, height: entry.height }, reducedMotion: 'reduce',
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: false,
  });
  contexts.add(context); let acquired: Session | undefined; let bootstrapClosed = false;
  context.once('close', (): void => { bootstrapClosed = true; });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = {
      context, page, refreshed: false, refreshArmed: false, closing: false, faults: [], blockedHttp: 0, blockedWs: 0,
      counts: new Map(), handlers: new Set(), seen: new Set(), pending: new Set(), completed: new Set(), failed: new Set(),
      waiters: new Set(), refreshArrived: deferred(), releaseRefresh: deferred(), refreshTransactions: deferred(),
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
      s.faults.push('AL_UNEXPECTED_PAGE'); watchPage(s, other);
      void track(s, 'AL_CLOSE_UNEXPECTED_PAGE', async (): Promise<void> => { await other.close(); });
    });
    await context.routeWebSocket('**/*', async (socket: WebSocketRoute): Promise<void> => {
      await track(s, 'AL_WS_HANDLER', async (): Promise<void> => {
        s.blockedWs++; s.faults.push('AL_FORBIDDEN_WS ' + socket.url());
        // Never connectToServer: close at the browser transport boundary.
        await socket.close({ code: 1008, reason: 'AL isolated synthetic fixture' });
      });
    });
    await context.route('**/*', async (route: Route): Promise<void> => {
      await track(s, 'AL_HTTP_HANDLER', (): Promise<void> => dispatch(s, route));
    });
    await page.goto(ORIGIN + '/');
    await page.evaluate((theme: Theme): void => (window as unknown as FixtureWindow).alCredits.mount(theme), entry.theme);
    await page.getByText('123,456,789,012', { exact: true }).waitFor();
    await page.getByText('AL每日奖励', { exact: true }).waitFor();
    await page.getByRole('button', { name: '充值', exact: true }).waitFor();
    await paintFrames(page); await quiet(s);
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
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'AL_OPEN_AND_DISPOSAL'); }
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
        const fixture = (window as unknown as FixtureWindow).alCredits;
        if (!fixture) throw Error('AL_FIXTURE_NOT_LOADED');
        fixture.unmount();
        return { state: { ...fixture.state, toasts: [...fixture.state.toasts] },
          empty: document.getElementById('al-root')?.childElementCount === 0 };
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
    const expectedNativeRequests = s.refreshed ? 8 : 6;
    expect(s.seen.size, 'only exact owned document/assets/GETs observed').toBe(expectedNativeRequests);
    expect(s.completed.size).toBe(expectedNativeRequests); expect(s.failed.size).toBe(0);
    expect([...s.seen].every((request: Request): boolean => s.completed.has(request))).toBe(true);
    expect(s.pending.size).toBe(0); expect(s.handlers.size).toBe(0); expect(s.waiters.size).toBe(0);
    expect(s.blockedHttp, 'denied HTTP/method/header attempts remain fatal even if product catches them').toBe(0);
    expect(s.blockedWs, 'denied WS attempts remain fatal').toBe(0);
    expect(s.faults, 'unexpected pages/downloads/dialogs/errors remain fatal').toEqual([]);
  } catch (error) { errors.push(error); }
  if (s.contextClosed) { contexts.delete(s.context); sessions.delete(s); }
  if (errors.length) throw new AggregateError(errors, 'AL_DISPOSAL');
}
async function dispose(s: Session): Promise<void> {
  // Cached promise prevents repeated unmount, route release or close operations.
  s.disposePromise ??= disposeOnce(s); await s.disposePromise;
}
let captureIndex = 0;
async function capture(s: Session, label: string): Promise<void> {
  const directory = path.resolve('output/playwright/user-credits-al-native-20261019', String(process.pid));
  await mkdir(directory, { recursive: true });
  const state = await ui(s);
  const size = s.page.viewportSize();
  const filename = path.join(directory, `${state.theme}-${size?.width}x${size?.height}-${++captureIndex}-${label}.png`);
  if (label === 'failure-state') console.log('AL_FAILURE_LAYOUT', JSON.stringify(await s.page.locator('#al-root button').evaluateAll((elements: Element[]): ButtonLayout[] => elements.map((element: Element): ButtonLayout => {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { name: element.textContent?.trim(), rect: { x: box.x, y: box.y, width: box.width, height: box.height }, font: css.fontSize, selected: element.getAttribute('aria-pressed'), class: element.className };
  }))));
  await s.page.screenshot({ path: filename });
  console.log('AL_CAPTURE', JSON.stringify({ path: filename, label, inputVersion: compiledVersion }));
}
async function withSession(entry: MatrixEntry, scenario: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(entry); let original: unknown; let failed = false;
  try { await scenario(s); await capture(s, 'end-state'); } catch (error) { original = error; failed = true; try { await capture(s, 'failure-state'); } catch (captureError) { original = new AggregateError([error, captureError], 'AL_FAILURE_AND_CAPTURE'); } }
  try { await dispose(s); }
  catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], 'AL_SCENARIO_AND_DISPOSAL'); throw cleanup; }
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
  if (errors.length) throw new AggregateError(errors, 'AL_FINAL_DISPOSAL');
}, 15000);

function main(s: Session): Locator { return s.page.locator('main.dashboard-scrollable'); }
function root(s: Session): Locator { return main(s).locator(':scope > div'); }
function history(s: Session): Locator { return root(s).locator(':scope > div').last(); }
function modal(s: Session): Locator {
  return main(s).getByRole('heading', { name: '积分充值', exact: true }).locator('..').locator('..');
}
function modalHeader(s: Session): Locator { return modal(s).locator(':scope > div').first(); }
function modalBody(s: Session): Locator { return modal(s).locator(':scope > div').nth(1); }
function closeButton(s: Session): Locator { return modalHeader(s).locator(':scope > button'); }
function packageSection(s: Session): Locator {
  return modalBody(s).getByRole('heading', { name: '选择充值套餐', exact: true }).locator('..');
}
function packageTiles(s: Session): Locator {
  // The first direct content div is the real seven-option package/custom grid.
  // Scope here so a custom shortcut named 100/500 can never match a package.
  return packageSection(s).locator(':scope > div').first();
}
function packageButton(s: Session, amount: string): Locator {
  return packageTiles(s).getByText(amount, { exact: true }).locator('..');
}
function customButton(s: Session): Locator {
  return packageTiles(s).getByText('输入任意金额', { exact: true }).locator('..');
}
function preview(s: Session): Locator {
  return modalBody(s).getByText('充值套餐', { exact: true }).locator('..').locator('..');
}
function submit(s: Session): Locator {
  // Structural read/geometry only. This locator must NEVER reach activate().
  return modalBody(s).getByRole('button', { name: /^(请选择充值套餐|立即充值 ¥|创建订单中)/ });
}
async function rect(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox(); if (!value) throw Error('AL_RENDERED_RECT_REQUIRED'); return value;
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
async function typeNumber(s: Session, locator: Locator, value: string): Promise<void> {
  await activate(s, locator);
  expect(await locator.evaluate((element: Element): boolean => document.activeElement === element)).toBe(true);
  await s.page.keyboard.press('ControlOrMeta+A');
  if (value) await s.page.keyboard.type(value); else await s.page.keyboard.press('Backspace');
  await paintFrames(s.page); expect(await locator.inputValue()).toBe(value);
  // No Enter/Space while a quantity field or submit button has focus.
}
async function disjoint(first: Locator, second: Locator): Promise<void> {
  const a = await rect(first), b = await rect(second);
  expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5, 'separate real UI boxes do not overlap').toBe(false);
}
async function noHorizontalOverflow(s: Session): Promise<void> {
  const bad = await s.page.evaluate((): string[] => {
    const result: string[] = [];
    for (const selector of ['html', 'body', '.dashboard-root', 'main.dashboard-scrollable']) {
      const element = document.querySelector(selector);
      if (!element || element.scrollWidth > element.clientWidth + 1) result.push(selector + ':horizontal-content');
    }
    for (const element of document.querySelectorAll('#al-root *')) {
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
async function numbers(s: Session, balance: string, earned: string, spent: string): Promise<void> {
  for (const value of [balance, earned, spent]) {
    const label = main(s).getByText(value, { exact: true }); expect(await label.count()).toBe(1);
    await readable(s, label, true);
  }
  for (const title of ['当前余额', '累计获得', '累计消费']) await readable(s, main(s).getByText(title, { exact: true }));
  const earnedRow = main(s).getByText('累计获得', { exact: true }).locator('..');
  const spentRow = main(s).getByText('累计消费', { exact: true }).locator('..');
  await readable(s, earnedRow); await readable(s, spentRow); await disjoint(earnedRow, spentRow);
}
async function ledger(s: Session, rows: readonly RowExpectation[], count: number, absent: readonly string[]): Promise<void> {
  expect(await main(s).getByText('共 ' + count + ' 条记录', { exact: true }).count()).toBe(1);
  expect(await history(s).locator(':scope > div > div').count(), 'exact literal matching row count').toBe(count);
  const actualOrder = await history(s).locator(':scope > div > div').evaluateAll((elements: Element[]): string[] =>
    elements.map((element: Element): string => element.children[1]?.children[0]?.textContent ?? ''));
  expect(actualOrder, 'visible matching rows retain server order').toEqual(rows.map((row: RowExpectation): string => row.description));
  for (const missing of absent) expect(await history(s).getByText(missing, { exact: true }).count()).toBe(0);
  for (const expected of rows) {
    const description = history(s).getByText(expected.description, { exact: true });
    expect(await description.textContent()).toBe(expected.description);
    const row = description.locator('..').locator('..');
    for (const text of [expected.amount, expected.balance, expected.date]) {
      const actual = row.getByText(text, { exact: true }); expect(await actual.count()).toBe(1); await readable(s, actual, true);
    }
    await readable(s, description);
    await readable(s, row);
    expect(await row.locator('svg').count(), 'transaction and time icons are real component output').toBe(2);
    await disjoint(row.locator(':scope > div').first(), description);
    await disjoint(description, row.getByText(expected.amount, { exact: true }));
  }
  await noHorizontalOverflow(s);
}
async function filter(s: Session, name: '全部' | '收入' | '支出'): Promise<void> {
  await activate(s, main(s).getByRole('button', { name, exact: true }));
}
async function paint(locator: Locator): Promise<Paint> {
  await bounded('actual choice paint completion', (): Promise<void> => locator.evaluate(async (element: Element): Promise<void> => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation: Animation): Promise<Animation> => animation.finished));
  }));
  return await locator.evaluate((element: Element): Paint => {
    const css = getComputedStyle(element);
    return { border: css.borderTopColor, background: css.backgroundColor, shadow: css.boxShadow, borderWidth: Number.parseFloat(css.borderTopWidth) };
  });
}
async function selected(locator: Locator, wanted: boolean): Promise<void> {
  // No class-only accessibility fallback: the actual shipped choice needs a
  // semantic selected state. Never inject roles, aria-pressed or aria-checked.
  const role = await locator.getAttribute('role');
  if (role === 'radio') expect(await locator.getAttribute('aria-checked'), 'real radio selection').toBe(String(wanted));
  else {
    expect(await locator.evaluate((element: Element): boolean => element instanceof HTMLButtonElement)).toBe(true);
    expect(await locator.getAttribute('aria-pressed'), 'actual button exposes its selected state accessibly').toBe(String(wanted));
  }
}
async function choose(s: Session, locator: Locator, previous: Locator | null, oneLine = false): Promise<void> {
  await reach(s, locator, oneLine);
  await s.page.mouse.move(1, 1); await paintFrames(s.page);
  const before = await paint(locator);
  await activate(s, locator, oneLine, true);
  await s.page.mouse.move(1, 1); await paintFrames(s.page);
  await selected(locator, true); if (previous) await selected(previous, false);
  const after = await paint(locator);
  expect(after.borderWidth, 'selection has a visible border').toBeGreaterThanOrEqual(1);
  expect(after, 'visible selection paint changes on the actual choice').not.toEqual(before);
}
async function modalFits(s: Session): Promise<void> {
  expect(await modal(s).count()).toBe(1);
  // Structural boxes only here: offscreen body contents are checked individually
  // after native wheel traversal, never assumed visible because a modal exists.
  for (const locator of [modal(s), modalHeader(s), modalBody(s)]) {
    const value = await geometry(locator);
    expect(value.clear, 'modal/header/body border boxes fit current viewport and ancestor clips: ' + JSON.stringify(value)).toBe(true);
    expect(await locator.evaluate((element: Element): boolean => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  const body = modalBody(s);
  expect(await body.evaluate((element: Element): boolean => /^(auto|scroll)$/.test(getComputedStyle(element).overflowY)), 'actual modal body is its scrollport').toBe(true);
  await visible(modalHeader(s).getByRole('heading', { name: '积分充值', exact: true }), true);
  await control(closeButton(s));
  await disjoint(modalHeader(s).getByRole('heading', { name: '积分充值', exact: true }), closeButton(s));
  await disjoint(modalHeader(s), body); await noHorizontalOverflow(s);
}
async function wheelModal(s: Session): Promise<void> {
  const body = modalBody(s);
  const before = await body.evaluate((element: Element): { top: number; height: number; total: number; x: number; y: number } => {
    const r = element.getBoundingClientRect();
    return { top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(before.total, 'real recharge content exceeds actual body scrollport at both mobile heights').toBeGreaterThan(before.height);
  const background = await main(s).evaluate((element: Element): number => element.scrollTop);
  const delta = before.top > 0 ? -Math.min(120, before.top) : Math.min(120, before.height / 2);
  await s.page.mouse.move(before.x, before.y); await s.page.mouse.wheel(0, delta); s.wheels++;
  await paintFrames(s.page);
  const after = await body.evaluate((element: Element): number => element.scrollTop);
  expect(Math.abs(after - before.top), 'native wheel moved actual recharge body').toBeGreaterThan(0.5);
  expect(await main(s).evaluate((element: Element): number => element.scrollTop), 'modal wheel did not scroll background main').toBe(background);
}
async function openRecharge(s: Session): Promise<void> {
  await activate(s, main(s).getByRole('button', { name: '充值', exact: true }));
  await modal(s).waitFor(); await paintFrames(s.page);
  await modalFits(s);
  expect(await submit(s).isDisabled(), 'no default package submits an order').toBe(true);
  expect(await submit(s).textContent()).toBe('请选择充值套餐');
  expect(await modalBody(s).locator('input[type="number"]').count()).toBe(0);
  expect(await preview(s).count()).toBe(0);
}
async function actualQuantityLabel(s: Session): Promise<Locator> {
  const input = modalBody(s).locator('input[type="number"]'); expect(await input.count()).toBe(1);
  const labels = await input.evaluate((element: Element): string[] => element instanceof HTMLInputElement
    ? [...(element.labels ?? [])].map((label: HTMLLabelElement): string => label.textContent?.trim() ?? '') : []);
  expect(labels.length, 'product supplies an actual associated HTML label; placeholder is insufficient').toBeGreaterThan(0);
  const name = labels[0]; expect(name.trim().length, 'associated label contains real text').toBeGreaterThan(0);
  const labelled = modalBody(s).getByLabel(name, { exact: true }); expect(await labelled.count()).toBe(1);
  expect(await labelled.evaluate((element: Element): boolean => element.matches('input[type="number"]'))).toBe(true);
  const label = modalBody(s).locator('label').filter({ hasText: name }); expect(await label.count()).toBe(1);
  await readable(s, label); const box = await rect(label);
  await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await paintFrames(s.page);
  expect(await input.evaluate((element: Element): boolean => document.activeElement === element), 'native click on actual label focuses quantity').toBe(true);
  await reach(s, input); expect(await input.getAttribute('min')).toBe('10'); expect(await input.getAttribute('step')).toBe('10');
  return input;
}
async function customPreview(s: Session, expected: string, due: string, button: string): Promise<void> {
  const card = preview(s); expect(await card.count()).toBe(1);
  await readable(s, card.getByText(expected, { exact: true }));
  await readable(s, card.getByText(due, { exact: true }), true);
  expect(await card.getByText('赠送积分', { exact: true }).count()).toBe(0);
  expect(await submit(s).textContent()).toBe(button); expect(await submit(s).isEnabled()).toBe(true);
  await reach(s, submit(s)); // Geometry only. Never activate an enabled submit.
}
async function closeRecharge(s: Session): Promise<void> {
  // Deliberately no reveal before checking close: reaching low controls must not
  // hide the only escape in the short viewport or require scrolling to find it.
  await control(closeButton(s));
  await activate(s, closeButton(s), true, true);
  expect(await modal(s).count()).toBe(0); await quiet(s);
}

describe.each(MATRIX)('AL user credits $theme $width x $height', (entry: MatrixEntry): void => {
  it('AL user credits actual balance, refresh and signed ledger filters fit native mobile controls', async (): Promise<void> => {
    // Breaks caught: ignored/stale refresh; swapped lifetime totals; wrong sign
    // filtering (especially negative admin_adjust and positive daily_bonus);
    // compressed/overlapping header, hidden long text/numbers or sub-44px hits.
    await withSession(entry, async (s: Session): Promise<void> => {
      const heading = main(s).getByRole('heading', { name: '我的积分', exact: true });
      await readable(s, heading, true);
      await readable(s, main(s).getByText('查看积分余额、充值和使用记录', { exact: true }));
      const recharge = main(s).getByRole('button', { name: '充值', exact: true });
      const refresh = main(s).getByRole('button', { name: '刷新', exact: true });
      await reach(s, recharge); await reach(s, refresh); await disjoint(recharge, refresh); await disjoint(heading, recharge);
      for (const name of ['全部', '收入', '支出']) await reach(s, main(s).getByRole('button', { name, exact: true }));
      await numbers(s, '123,456,789,012', '987,654,321,012', '864,197,532,000');
      await ledger(s, [SPEND, ADJUST, BONUS, EARNED], 4, ['AL刷新后新增积分']);

      await filter(s, '全部');
      // Native keyboard path: Tab from actual All button to actual Income,
      // inspect focus before Space, and never focus/activate a financial submit.
      await s.page.keyboard.press('Tab'); await paintFrames(s.page);
      const income = main(s).getByRole('button', { name: '收入', exact: true });
      expect(await income.evaluate((element: Element): boolean => document.activeElement === element)).toBe(true);
      await control(income); await assertSafeActivation(income); await s.page.keyboard.press('Space'); await paintFrames(s.page);
      await ledger(s, [BONUS, EARNED], 2, [SPEND.description, ADJUST.description, 'AL刷新后新增积分']);
      await filter(s, '支出'); await ledger(s, [SPEND, ADJUST], 2, [BONUS.description, EARNED.description, 'AL刷新后新增积分']);
      await filter(s, '全部'); await ledger(s, [SPEND, ADJUST, BONUS, EARNED], 4, ['AL刷新后新增积分']);

      s.refreshArmed = true;
      try {
        await activate(s, refresh);
        await bounded('owned refresh response has arrived', (): Promise<void> => s.refreshArrived.promise);
        expect(await refresh.isDisabled(), 'real loading state disables refresh while the response is owned and held').toBe(true);
        await visible(refresh, true);
        // No time-based pending assertion: old observable values remain while
        // the second GET cannot resolve. A missing refresh cannot satisfy this.
        expect(await main(s).getByText('123,456,789,012', { exact: true }).count()).toBe(1);
        expect(await main(s).getByText('987,654,321,012', { exact: true }).count()).toBe(1);
        expect(await history(s).getByText('AL刷新后新增积分', { exact: true }).count()).toBe(0);
      } finally { s.releaseRefresh.resolve(); }
      await bounded('owned refreshed transaction response finishes', (): Promise<void> => s.refreshTransactions.promise);
      await history(s).getByText('AL刷新后新增积分', { exact: true }).waitFor();
      await paintFrames(s.page); await drain(s);
      expect(await refresh.isEnabled(), 'refresh recovers after owned response release').toBe(true);
      await numbers(s, '123,456,789,022', '987,654,321,022', '864,197,532,000');
      await ledger(s, [NEW_BONUS, SPEND, ADJUST, BONUS, EARNED], 5, []);
      await filter(s, '收入'); await ledger(s, [NEW_BONUS, BONUS, EARNED], 3, [SPEND.description, ADJUST.description]);
      await filter(s, '支出'); await ledger(s, [SPEND, ADJUST], 2, [NEW_BONUS.description, BONUS.description, EARNED.description]);
      await filter(s, '全部'); await ledger(s, [NEW_BONUS, SPEND, ADJUST, BONUS, EARNED], 5, []);
      // Both required snapshots have mixed signs. An empty matching subset is
      // impossible without an unrelated data-erasure/error scenario; not claimed.
      expect(await main(s).locator('button').count()).toBe(5);
      if (entry.height === 320) expect(s.wheels, 'short main reached through native vertical wheel').toBeGreaterThan(0);
      await noHorizontalOverflow(s); await quiet(s);
    });
  }, 25000);

  it('AL user credits recharge selector supports native package/custom/payment choices and invalid-only submission safety', async (): Promise<void> => {
    // Breaks caught: wrong package price/bonus/selection; missing semantic state
    // or actual quantity label; below-10 enabled submit; compressed shortcuts;
    // unreachable short-height controls/close; incorrect close/reopen reset.
    await withSession(entry, async (s: Session): Promise<void> => {
      await openRecharge(s); await wheelModal(s);
      let previous: Locator | null = null;
      for (const expected of PACKAGES) {
        const option = packageButton(s, expected.amount);
        expect(await option.evaluate((element: Element): boolean => element instanceof HTMLButtonElement)).toBe(true);
        expect(await option.getByText(expected.priceOnTile, { exact: true }).count()).toBe(1);
        expect(await option.getByText('约100积分/元', { exact: true }).count()).toBe(1);
        if (expected.bonusOnTile === null) expect(await option.getByText(/^\+赠送/).count()).toBe(0);
        else expect(await option.getByText(expected.bonusOnTile, { exact: true }).count()).toBe(1);
        await choose(s, option, previous); previous = option;
        const card = preview(s); expect(await card.count()).toBe(1);
        await readable(s, card.getByText(expected.preview, { exact: true }));
        await readable(s, card.getByText(expected.due, { exact: true }), true);
        if (expected.bonusInPreview === null) expect(await card.getByText('赠送积分', { exact: true }).count()).toBe(0);
        else {
          expect(await card.getByText('赠送积分', { exact: true }).count()).toBe(1);
          await readable(s, card.getByText(expected.bonusInPreview, { exact: true }), true);
        }
        expect(await submit(s).textContent()).toBe(expected.submit); expect(await submit(s).isEnabled()).toBe(true);
        await reach(s, submit(s)); await noHorizontalOverflow(s);
      }
      // This source uses three rows of packages; lowest packages and submit are
      // reached by actual modal-body wheel scrolling, never locator.click auto-scroll.
      expect(await modalBody(s).evaluate((element: Element): number => element.scrollTop)).toBeGreaterThan(0);
      const custom = customButton(s); await choose(s, custom, previous);
      for (const expected of PACKAGES) await selected(packageButton(s, expected.amount), false);
      const quantity = await actualQuantityLabel(s);
      expect(await quantity.inputValue()).toBe(''); expect(await preview(s).count()).toBe(0);
      expect(await submit(s).isDisabled()).toBe(true);
      await typeNumber(s, quantity, '9');
      expect(await submit(s).isDisabled(), 'below the literal minimum 10 stays disabled').toBe(true);
      expect(await preview(s).count(), 'invalid custom quantity has no valid order preview').toBe(0);
      expect(await modalBody(s).getByText('¥0.09', { exact: true }).count()).toBe(1);
      await reach(s, submit(s));
      // Disabled submit is measured only. No submit activation, even at 9.
      await typeNumber(s, quantity, '10');
      await customPreview(s, '自定义 10 积分', '¥0.10', '立即充值 ¥0.10');

      let shortcutPrevious: Locator | null = null;
      for (const [label, value, previewText, price, button] of [
        ['100', '100', '自定义 100 积分', '¥1.00', '立即充值 ¥1.00'],
        ['200', '200', '自定义 200 积分', '¥2.00', '立即充值 ¥2.00'],
        ['500', '500', '自定义 500 积分', '¥5.00', '立即充值 ¥5.00'],
        ['1000', '1000', '自定义 1,000 积分', '¥10.00', '立即充值 ¥10.00'],
        ['2000', '2000', '自定义 2,000 积分', '¥20.00', '立即充值 ¥20.00'],
        ['5000', '5000', '自定义 5,000 积分', '¥50.00', '立即充值 ¥50.00'],
      ] as const) {
        // Exact numeric accessible name excludes package cards with price/bonus.
        const shortcut = packageSection(s).getByRole('button', { name: label, exact: true });
        await choose(s, shortcut, shortcutPrevious, true); shortcutPrevious = shortcut;
        expect(await quantity.inputValue()).toBe(value); await selected(custom, true);
        await customPreview(s, previewText, price, button); await noHorizontalOverflow(s);
      }
      const shortcuts = ['100', '200', '500', '1000', '2000', '5000'].map((name: string): Locator =>
        packageSection(s).getByRole('button', { name, exact: true }));
      for (const shortcut of shortcuts) await reach(s, shortcut);
      for (let index = 1; index < shortcuts.length; index++) await disjoint(shortcuts[index - 1], shortcuts[index]);
      if (entry.width === 320) {
        const rows = await Promise.all(shortcuts.map(async (shortcut: Locator): Promise<number> => Math.round((await rect(shortcut)).y)));
        expect(new Set(rows).size, 'six 44px shortcuts plus actual gaps wrap within narrow modal body').toBeGreaterThan(1);
      }

      const wechat = modalBody(s).getByRole('button', { name: '微信支付', exact: true });
      const alipay = modalBody(s).getByRole('button', { name: '支付宝', exact: true });
      await selected(wechat, true); await selected(alipay, false);
      await choose(s, alipay, wechat, true); await customPreview(s, '自定义 5,000 积分', '¥50.00', '立即充值 ¥50.00');
      await choose(s, wechat, alipay, true); await customPreview(s, '自定义 5,000 积分', '¥50.00', '立即充值 ¥50.00');
      await readable(s, modalBody(s).getByText('充值流程', { exact: true }));
      for (const step of ['选择套餐', '扫码进入充值页', '点击付款', '积分到账']) {
        const label = modalBody(s).getByText(step, { exact: true });
        expect(await label.count(), 'all four real recharge workflow labels exist').toBe(1);
        await readable(s, label, true);
        expect((await geometry(label)).font, 'actual recharge workflow labels are at least 14px').toBeGreaterThanOrEqual(14);
      }
      await modalFits(s); await noHorizontalOverflow(s);
      await capture(s, 'recharge-custom-selection');
      expect(s.wheels, 'actual modal traversal used native wheel').toBeGreaterThan(0);
      await closeRecharge(s);
      await openRecharge(s);
      // The production close handler clears package, custom flag and amount.
      // Payment choice is not required to reset; it is returned to wechat above.
      for (const expected of PACKAGES) await selected(packageButton(s, expected.amount), false);
      await selected(customButton(s), false);
      await choose(s, customButton(s), null);
      const reopenedQuantity = await actualQuantityLabel(s);
      expect(await reopenedQuantity.inputValue(), 'close/reopen recovers an empty actual quantity editor').toBe('');
      expect(await preview(s).count()).toBe(0); expect(await submit(s).isDisabled()).toBe(true);
      await wheelModal(s); await reach(s, submit(s)); await modalFits(s); await closeRecharge(s);
      expect(await main(s).getByText('123,456,789,012', { exact: true }).count()).toBe(1);
      expect(await history(s).getByText('AL每日奖励', { exact: true }).count()).toBe(1);
      expect(s.refreshed, 'selector never dispatches even another balance refresh').toBe(false);
      await noHorizontalOverflow(s); await quiet(s);
      // Deliberate limits: order creation, valid request dispatch, pay links,
      // QR/order view, confirm-paid, query-order and real Toast remain untested.
    });
  }, 25000);
});
